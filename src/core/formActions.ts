import { Elysia, type UnwrapSchema } from 'elysia';
import type { TObject } from 'typebox';
import { Value } from 'typebox/value';
import type {
	ActionErrorState,
	ActionFieldErrors,
	ActionFormValues,
	ActionResult,
	ActionData,
	ActionFields,
	ActionSuccessState,
	AnyFormAction,
	FormActionDefinition
} from '../../types/formAction';
import {
	ACTION_REQUEST_HEADER,
	isActionResult
} from '../utils/formActionProtocol';
import {
	encodeActionFlash,
	readActionFlash,
	type ActionFlash
} from './formActionFlash';
import { getCurrentAbsoluteRequest } from './requestContext';

/* Form actions: one POST handler that serves a plain <form> (no
 * JavaScript), the browser helpers (fetch + JSON) and HTMX.
 *
 *   export const createUser = defineAction('/users', {
 *   	body: t.Object({ name: t.String({ minLength: 2 }) }),
 *   	handler: async ({ body, fail }) => {
 *   		if (await taken(body.name)) return fail({ name: 'Taken' });
 *   		return { id: await insert(body) };
 *   	}
 *   });
 *   app.use(createUser);
 *
 * The body schema is the route's Elysia schema, so Eden sees it. A
 * submission that fails validation reaches the route's error hook, which
 * turns Elysia's validation errors into one message per field.
 *
 * How the answer is shaped depends on who asked:
 *   - a plain form post: 303 to the page (Post/Redirect/Get) with the
 *     result in a short-lived cookie the page reads on its next render
 *     (`getActionState`, or the built-in HTML rewriting for
 *     `<form data-absolute-action>`);
 *   - the browser helpers or a JSON body: the result as JSON (422 on
 *     error);
 *   - HTMX: the `htmx` option's HTML, else an `HX-Redirect` that does
 *     the same as a plain post. */

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const SECRET_FIELD = /pass(?:word|phrase|code)?|secret|token|card|cvc|cvv/i;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_SEE_OTHER = 303;
const HTTP_UNPROCESSABLE = 422;

type FieldKind = 'array' | 'boolean' | 'file' | 'files' | 'number' | 'other';

/** What `fail(...)` returns; the action answers with an error state. */
export class ActionFailure<Fields extends string = string> {
	readonly errors: ActionFieldErrors<Fields>;
	readonly message: string | undefined;
	constructor(errors: ActionFieldErrors<Fields>, message?: string) {
		this.errors = errors;
		this.message = message;
	}
}

/** Thrown before validation: the request is cross-origin or too large. */
class ActionRejection extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export type ActionCsrfOptions = {
	/** Origins (scheme://host[:port]) allowed to post besides the page's
	 *  own, e.g. a separate front-end domain. */
	trustedOrigins?: readonly string[];
};

/** What a handler returning `Result` hands the page on success. */
export type ActionDataOf<Result, Fields extends string = string> = Exclude<
	Awaited<Result>,
	ActionFailure<Fields> | Response
>;

export type ActionHandlerContext<Body, Fields extends string> = {
	body: Body;
	/** The full Elysia context (derived values such as the signed-in user
	 *  live here). Untyped in Phase 1. */
	context: Record<string, unknown>;
	/** Answer with field errors (and an optional form-level message)
	 *  instead of a result. */
	fail: (
		errors: ActionFieldErrors<Fields>,
		message?: string
	) => ActionFailure<Fields>;
	request: Request;
	set: { headers: Record<string, unknown>; status?: unknown };
};

export type DefineActionOptions<
	Schema extends TObject,
	Result,
	Fields extends string = Extract<keyof UnwrapSchema<Schema>, string>
> = {
	/** The form's fields (an Elysia `t.Object`). Field names are the keys;
	 *  add `error: 'message'` to a property for a friendlier message than
	 *  the validator's. */
	body: Schema;
	/** Runs after validation, before the handler; return a response (e.g.
	 *  `status(401)`) to stop. Use it for auth checks. */
	beforeHandle?: (context: {
		request: Request;
		set: { headers: Record<string, unknown>; status?: unknown };
	}) => unknown;
	/** Cross-origin protection: requests whose `Sec-Fetch-Site` / `Origin`
	 *  say another site sent them get 403. Default on; `false` turns it
	 *  off (for an API meant to be called from other sites). */
	csrf?: ActionCsrfOptions | false;
	handler: (
		context: ActionHandlerContext<UnwrapSchema<Schema>, Fields>
	) => Result | Promise<Result>;
	/** HTMX requests only: the HTML fragment to swap in for a result
	 *  (answered with 200, which HTMX swaps by default). Return undefined
	 *  to fall back to the no-JavaScript behaviour (`HX-Redirect`). The
	 *  result's type comes from `handler` only. */
	htmx?: (
		result: ActionResult<NoInfer<ActionDataOf<Result, Fields>>, Fields>,
		request: Request
	) => string | undefined | Promise<string | undefined>;
	/** Bytes; requests that declare a larger body get 413 before it is
	 *  read. Default 10 MiB. */
	maxBodySize?: number;
	/** Echo what the user typed back to the page after a failed
	 *  submission without JavaScript (files and secret-looking fields are
	 *  never echoed). Default true. */
	preserveValues?: boolean;
	/** Where to send the browser after success. Default: back to the page
	 *  the form was on. */
	redirect?:
		string | ((data: NoInfer<ActionDataOf<Result, Fields>>) => string);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/* ---------------------------------------------------------------- *
 * Request classification
 * ---------------------------------------------------------------- */

type ResponseMode = 'document' | 'htmx' | 'json';

const wantsJson = (headers: Headers) => {
	if (headers.has(ACTION_REQUEST_HEADER)) return true;
	if ((headers.get('content-type') ?? '').includes('application/json'))
		return true;
	const accept = headers.get('accept') ?? '';

	return accept.includes('application/json') && !accept.includes('text/html');
};

const responseModeOf = (request: Request) => {
	const { headers } = request;
	let mode: ResponseMode = 'document';
	if (wantsJson(headers)) mode = 'json';
	if (headers.get('hx-request') === 'true') mode = 'htmx';

	return mode;
};

const hostOf = (request: Request) =>
	request.headers.get('host') ?? new URL(request.url).host;

const originHost = (origin: string) => {
	try {
		return new URL(origin).host;
	} catch {
		return undefined;
	}
};

/* Same rules as Go's CrossOriginProtection: trust Sec-Fetch-Site when the
 * browser sends it, else compare Origin with Host, else (no browser
 * signal at all: curl, server-to-server, very old browsers) allow. */
export const isCrossOriginRequest = (
	request: Request,
	trustedOrigins: readonly string[] = []
) => {
	const origin = request.headers.get('origin');
	if (origin && trustedOrigins.includes(origin)) return false;
	const site = request.headers.get('sec-fetch-site');
	if (site) return site !== 'same-origin' && site !== 'none';
	if (!origin) return false;

	return originHost(origin) !== hostOf(request);
};

const rejectionFor = (
	request: Request,
	csrf: ActionCsrfOptions | false | undefined,
	maxBodySize: number
) => {
	if (csrf !== false && isCrossOriginRequest(request, csrf?.trustedOrigins))
		return new ActionRejection(
			HTTP_FORBIDDEN,
			'Cross-origin form submission rejected'
		);
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (declared > maxBodySize)
		return new ActionRejection(
			HTTP_PAYLOAD_TOO_LARGE,
			'Form submission is too large'
		);

	return undefined;
};

/* Elysia turns an error thrown while parsing into a generic 400, so the
 * parse hook records the rejection and skips reading the body (an empty
 * object stands in for it); the transform hook then throws it, which
 * reaches the route's error hook before validation runs. */
const pendingRejections = new WeakMap<Request, ActionRejection>();

/* ---------------------------------------------------------------- *
 * Form body normalisation (before validation)
 * ---------------------------------------------------------------- */

const KIND_PRIORITY: FieldKind[] = [
	'files',
	'file',
	'array',
	'number',
	'boolean'
];

const isFileSchema = (schema: unknown) =>
	isRecord(schema) && schema['~kind'] === 'File';

/* One schema without unions: t.File, t.Boolean, t.Number, t.Array… */
const kindOfMember = (schema: unknown) => {
	if (!isRecord(schema)) return 'other';
	if (isFileSchema(schema)) return 'file';
	const { type } = schema;
	if (type === 'boolean') return 'boolean';
	if (type === 'number' || type === 'integer') return 'number';
	if (type !== 'array') return 'other';

	return isFileSchema(schema.items) ? 'files' : 'array';
};

/* Unions (t.Numeric, t.Files, t.Optional wrappers) take their most
 * form-relevant member's kind. */
const kindOf = (schema: unknown) => {
	const members =
		isRecord(schema) && Array.isArray(schema.anyOf)
			? schema.anyOf
			: [schema];
	const kinds: FieldKind[] = members.map(kindOfMember);

	return KIND_PRIORITY.find((kind) => kinds.includes(kind)) ?? 'other';
};

const FALSE_VALUES = new Set(['', '0', 'false', 'off']);

const isEmptyFile = (value: unknown) =>
	value instanceof File && value.size === 0 && value.name === '';

const normalizeBoolean = (value: unknown) => {
	if (value === undefined) return false;
	if (typeof value !== 'string') return value;

	return !FALSE_VALUES.has(value.toLowerCase());
};

const normalizeArray = (value: unknown) => {
	if (value === undefined || value === '') return [];

	return Array.isArray(value) ? value : [value];
};

const normalizeFiles = (value: unknown) => {
	const list = Array.isArray(value) ? value : [value];
	const files = list.filter((entry) => !isEmptyFile(entry));

	return files.length > 0 ? files : undefined;
};

/* '' (an empty number input) is "not given"; a numeric string becomes the
 * number; anything else stays a string and fails validation. */
const normalizeNumber = (value: unknown) => {
	if (typeof value !== 'string') return value;
	if (value.trim() === '') return undefined;
	const parsed = Number(value);

	return Number.isFinite(parsed) ? parsed : value;
};

const normalizeField = (kind: FieldKind, value: unknown) => {
	if (kind === 'boolean') return normalizeBoolean(value);
	if (kind === 'array') return normalizeArray(value);
	if (kind === 'files') return normalizeFiles(value);
	if (kind === 'file') return isEmptyFile(value) ? undefined : value;
	if (kind === 'number') return normalizeNumber(value);

	return value;
};

/* A browser form sends strings: an unchecked checkbox sends nothing, an
 * empty number input sends '', one checked box of a group sends a single
 * value and an empty file input sends an empty File. Map those onto what
 * the schema expects so validation judges what the user meant. */
const normalizeFormBody = (schema: TObject, body: Record<string, unknown>) => {
	for (const [key, property] of Object.entries(schema.properties)) {
		const value = normalizeField(kindOf(property), body[key]);
		if (value === undefined) Reflect.deleteProperty(body, key);
		else Reflect.set(body, key, value);
	}
};

const isFormContent = (request: Request) => {
	const type = request.headers.get('content-type') ?? '';

	return (
		type.includes('application/x-www-form-urlencoded') ||
		type.includes('multipart/form-data')
	);
};

/* ---------------------------------------------------------------- *
 * Submitted values (echoed back without JavaScript)
 * ---------------------------------------------------------------- */

const submittedValues = new WeakMap<Request, ActionFormValues>();

const echoableValue = (value: unknown) => {
	if (typeof value === 'string') return value;
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((entry) => typeof entry === 'string');

	return strings.length === value.length ? strings : undefined;
};

const captureValues = (request: Request, body: Record<string, unknown>) => {
	const values: ActionFormValues = {};
	for (const [key, value] of Object.entries(body)) {
		const echoable = SECRET_FIELD.test(key)
			? undefined
			: echoableValue(value);
		if (echoable !== undefined) values[key] = echoable;
	}
	submittedValues.set(request, values);
};

/* ---------------------------------------------------------------- *
 * Validation errors → one message per field
 * ---------------------------------------------------------------- */

const pathToField = (instancePath: string) =>
	instancePath.replace(/^\//, '').split('/').join('.');

const customMessage = (schema: TObject, field: string) => {
	const [top = field] = field.split('.');
	const property: unknown = schema.properties[top];
	if (!isRecord(property)) return undefined;

	return typeof property.error === 'string' ? property.error : undefined;
};

const requiredFields = (entry: Record<string, unknown>) => {
	const { params } = entry;
	if (!isRecord(params) || !Array.isArray(params.requiredProperties))
		return [];

	return params.requiredProperties.filter(
		(name): name is string => typeof name === 'string'
	);
};

const entryFields = (entry: Record<string, unknown>) => {
	if (entry.keyword === 'required') return requiredFields(entry);
	const path =
		typeof entry.instancePath === 'string' ? entry.instancePath : '';

	return [pathToField(path)];
};

const entryMessage = (entry: Record<string, unknown>) => {
	if (entry.keyword === 'required') return 'Required';

	return typeof entry.message === 'string' ? entry.message : 'Invalid value';
};

const fieldErrorsFrom = (schema: TObject, entries: unknown[]) => {
	const errors: ActionFieldErrors = {};
	for (const entry of entries.filter(isRecord)) {
		const fields = entryFields(entry).filter((field) => !(field in errors));
		const fallback = entryMessage(entry);
		fields.forEach((field) => {
			errors[field] = customMessage(schema, field) ?? fallback;
		});
	}

	return errors;
};

/* Elysia's error lists every problem only outside production: in
 * production, with a custom `error` message on the schema, it stops at the
 * first one. A form needs all of them, so the body Elysia rejected is
 * checked again here (failures only) and Elysia's list is the fallback. */
const validationEntries = (error: unknown, schema: TObject) => {
	if (!isRecord(error) && !(error instanceof Error)) return undefined;
	if (Reflect.get(error, 'code') !== 'validation') return undefined;
	if (Reflect.get(error, 'type') !== 'body') return undefined;
	const value: unknown = Reflect.get(error, 'value');
	const full: unknown[] = [...Value.Errors(schema, value)];
	if (full.length > 0) return full;
	const entries: unknown = Reflect.get(error, 'errors');

	return Array.isArray(entries) ? entries : [];
};

/* ---------------------------------------------------------------- *
 * Answering
 * ---------------------------------------------------------------- */

const backTarget = (request: Request) => {
	const reference =
		request.headers.get('hx-current-url') ?? request.headers.get('referer');
	if (!reference) return '/';
	try {
		const url = new URL(reference);

		return url.host === hostOf(request)
			? `${url.pathname}${url.search}`
			: '/';
	} catch {
		return '/';
	}
};

const flashCookie = (request: Request, flash: ActionFlash) => {
	const secure = new URL(request.url).protocol === 'https:';

	return encodeActionFlash(flash, secure);
};

type AnswerSettings<Data, Fields extends string> = {
	actionPath: string;
	htmx:
		| ((
				result: ActionResult<Data, Fields>,
				request: Request
		  ) => string | undefined | Promise<string | undefined>)
		| undefined;
	preserveValues: boolean;
	redirect: string | ((data: Data) => string) | undefined;
};

const flashFor = <Data, Fields extends string>(
	request: Request,
	result: ActionResult<Data, Fields>,
	settings: AnswerSettings<Data, Fields>
) => {
	const values = settings.preserveValues
		? submittedValues.get(request)
		: undefined;
	const flash: ActionFlash = {
		action: settings.actionPath,
		result:
			result.status === 'success'
				? {
						data: result.data,
						redirect: result.redirect,
						status: 'success'
					}
				: { ...result, values }
	};

	return flash;
};

const navigationTarget = <Data, Fields extends string>(
	request: Request,
	result: ActionResult<Data, Fields>
) =>
	result.status === 'success' && result.redirect
		? result.redirect
		: backTarget(request);

const answerHtmx = async <Data, Fields extends string>(
	request: Request,
	result: ActionResult<Data, Fields>,
	settings: AnswerSettings<Data, Fields>
) => {
	const html = await settings.htmx?.(result, request);
	if (html !== undefined)
		return new Response(html, {
			headers: { 'content-type': 'text/html; charset=utf-8' }
		});
	const headers = new Headers({
		'hx-redirect': navigationTarget(request, result)
	});
	headers.append(
		'set-cookie',
		flashCookie(request, flashFor(request, result, settings))
	);

	return new Response(null, { headers, status: HTTP_OK });
};

const answerDocument = <Data, Fields extends string>(
	request: Request,
	result: ActionResult<Data, Fields>,
	settings: AnswerSettings<Data, Fields>
) => {
	const headers = new Headers({
		location: navigationTarget(request, result)
	});
	headers.append(
		'set-cookie',
		flashCookie(request, flashFor(request, result, settings))
	);

	return new Response(null, { headers, status: HTTP_SEE_OTHER });
};

const answer = <Data, Fields extends string>(
	request: Request,
	result: ActionResult<Data, Fields>,
	settings: AnswerSettings<Data, Fields>
) => {
	const mode = responseModeOf(request);
	if (mode === 'htmx') return answerHtmx(request, result, settings);
	if (mode === 'document') return answerDocument(request, result, settings);

	// The browser helpers read the outcome from the body; a 422 would only
	// add a "Failed to load resource" console error per invalid form. Other
	// JSON clients (Eden, fetch) get the 422.
	const fromHelpers = request.headers.has(ACTION_REQUEST_HEADER);
	const invalid = result.status === 'error' && !fromHelpers;

	return Response.json(result, {
		status: invalid ? HTTP_UNPROCESSABLE : HTTP_OK
	});
};

const answerRejection = (request: Request, rejection: ActionRejection) => {
	if (responseModeOf(request) === 'document')
		return new Response(rejection.message, {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
			status: rejection.status
		});
	const result: ActionErrorState = {
		errors: {},
		message: rejection.message,
		status: 'error'
	};

	return Response.json(result, { status: rejection.status });
};

const successResult = <Data, Fields extends string>(
	settings: AnswerSettings<Data, Fields>,
	data: Data
) => {
	const { redirect } = settings;
	const target = typeof redirect === 'function' ? redirect(data) : redirect;
	const result: ActionSuccessState<Data> =
		target === undefined
			? { data, status: 'success' }
			: { data, redirect: target, status: 'success' };

	return result;
};

const failureResult = <Fields extends string>(
	failure: ActionFailure<Fields>
) => {
	const result: ActionErrorState<Fields> =
		failure.message === undefined
			? { errors: failure.errors, status: 'error' }
			: {
					errors: failure.errors,
					message: failure.message,
					status: 'error'
				};

	return result;
};

/* ---------------------------------------------------------------- *
 * defineAction
 * ---------------------------------------------------------------- */

const fail = <Fields extends string>(
	errors: ActionFieldErrors<Fields>,
	message?: string
) => new ActionFailure<Fields>(errors, message);

/* Elysia validated the body before the handler runs; this re-checks only
 * that the schema's required fields are present, which is what lets the
 * handler see it as the schema's type. */
const hasSchemaShape = <Body>(schema: TObject, value: unknown): value is Body =>
	isRecord(value) &&
	(schema.required ?? []).every((key: string) => key in value);

/* Success data is whatever the handler returned that isn't a failure or a
 * raw Response; that's the definition of `ActionDataOf`. */
const isActionData = <Data>(value: unknown): value is Data =>
	!(value instanceof ActionFailure) && !(value instanceof Response);

/** Defines a form action: a POST route at `path` that validates its body
 *  against `options.body` and works with or without JavaScript. Mount it
 *  with `app.use(action)`. */
export const defineAction = <
	const Path extends string,
	const Schema extends TObject,
	Result
>(
	path: Path,
	options: DefineActionOptions<Schema, Result>
) => {
	type Body = UnwrapSchema<Schema>;
	type Fields = Extract<keyof Body, string>;
	type Data = ActionDataOf<Result, Fields>;
	const schema = options.body;
	const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_BYTES;
	const settings: AnswerSettings<Data, Fields> = {
		actionPath: path,
		htmx: options.htmx,
		preserveValues: options.preserveValues !== false,
		redirect: options.redirect
	};
	const run = async (context: Record<string, unknown>) => {
		const { body, request, set } = context;
		if (
			!(request instanceof Request) ||
			!hasSchemaShape<Body>(schema, body)
		)
			return new Response('Bad Request', { status: 400 });
		const outcome = await options.handler({
			body,
			context,
			fail,
			request,
			set: isRecord(set) ? { headers: {}, ...set } : { headers: {} }
		});
		if (outcome instanceof Response) return outcome;
		if (outcome instanceof ActionFailure)
			return answer(request, failureResult<Fields>(outcome), settings);
		if (!isActionData<Data>(outcome))
			return new Response('Internal Server Error', { status: 500 });

		return answer(request, successResult(settings, outcome), settings);
	};

	const plugin = new Elysia({ name: `absolutejs-action:${path}` }).post(
		path,
		{
			beforeHandle: options.beforeHandle,
			body: schema,
			error: ({ error, request }) => {
				if (error instanceof ActionRejection)
					return answerRejection(request, error);
				const entries = validationEntries(error, schema);
				if (!entries) return undefined;
				const result: ActionErrorState<Fields> = {
					errors: fieldErrorsFrom(schema, entries),
					status: 'error'
				};

				return answer(request, result, settings);
			},
			parse: ({ request }) => {
				const rejection = rejectionFor(
					request,
					options.csrf,
					maxBodySize
				);
				if (!rejection) return undefined;
				pendingRejections.set(request, rejection);

				return {};
			},
			transform: ({ body, request }) => {
				const rejection = pendingRejections.get(request);
				if (rejection) throw rejection;
				if (!isRecord(body) || !isFormContent(request)) return;
				captureValues(request, body);
				normalizeFormBody(schema, body);
			}
		},
		(context) => run(context)
	);
	const definition: FormActionDefinition<Path, Body, Data> = {
		actionPath: path
	};

	return Object.assign(plugin, definition);
};

/** The result the last submission of `action` left for this page, when
 *  the browser posted without JavaScript and was redirected here. Read it
 *  in the page's route and pass it to the page as a prop. Undefined when
 *  there is none. */
export const getActionState = <Action extends AnyFormAction>(
	action: Action | Action['actionPath'],
	request: Request | undefined = getCurrentAbsoluteRequest()
) => {
	const flash = request ? readActionFlash(request) : undefined;
	const path = typeof action === 'string' ? action : action.actionPath;
	if (!flash || flash.action !== path) return undefined;

	const { result } = flash;

	return isActionResult<ActionData<Action>, ActionFields<Action>>(result)
		? result
		: undefined;
};
