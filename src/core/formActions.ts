import { Elysia, ElysiaStatus, macroType, status } from 'elysia';
import type { TObject } from 'typebox';
import { Value } from 'typebox/value';
import type {
	ActionCsrfOptions,
	ActionErrorState,
	ActionFieldErrors,
	ActionFormValues,
	ActionResult,
	ActionSuccessState,
	FormActionErrorContext,
	FormActionFailure,
	FormActionHookContext,
	FormActionMacroType,
	FormActionOptions,
	FormActionResponseContext,
	FormActionRouteMeta,
	FormActionValue
} from '../../types/formAction';
import { CSRF_FIELD_NAME } from '../utils/csrfTokenRef';
import {
	ACTION_REQUEST_HEADER,
	isActionResult
} from '../utils/formActionProtocol';
import { verifyCsrfToken } from './csrfToken';

import {
	encodeActionFlash,
	formActionRuntime,
	type ActionFlash
} from './formActionFlash';

export { getActionState } from '../utils/formActionState';

/* Form actions: a POST route with a `form` schema serves a plain <form>
 * (no JavaScript), the browser helpers (fetch + JSON) and HTMX.
 *
 *   app.post(
 *   	'/users',
 *   	{ form: t.Object({ name: t.String({ minLength: 2 }) }) },
 *   	async ({ body, fail, user }) => {
 *   		if (await taken(body.name)) return fail({ name: 'Taken' });
 *   		return { id: await insert(body, user) };
 *   	}
 *   );
 *
 * `form` is an Elysia macro (the `formActions()` plugin, part of the
 * `absolutejs` plugin from `prepare()`). Its schema becomes the route's
 * body schema, so Eden sees it; `fail` is typed by the schema's fields. A
 * submission that fails validation reaches the route's error hook, which
 * turns Elysia's validation errors into one message per field.
 * `form: { body: schema, redirect, htmx, csrf, maxBodySize,
 * preserveValues }` adds options.
 *
 * How the answer is shaped depends on who asked:
 *   - a plain form post: 303 to the page (Post/Redirect/Get) with the
 *     result in a short-lived cookie the page reads on its next render
 *     (`getActionState`, or the built-in HTML rewriting for
 *     `<form data-absolute-action>`);
 *   - the browser helpers: the result as JSON (200, even on error);
 *   - other JSON clients (Eden, fetch): the handler's data with 200, or
 *     the field errors with 422;
 *   - HTMX: the `htmx` option's HTML, else an `HX-Redirect` that does
 *     the same as a plain post. */

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const SECRET_FIELD = /pass(?:word|phrase|code)?|secret|token|card|cvc|cvv/i;
const HTTP_FIRST_ERROR = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_SEE_OTHER = 303;
const HTTP_UNPROCESSABLE = 422;

type FieldKind = 'array' | 'boolean' | 'file' | 'files' | 'number' | 'other';

/** Thrown before validation: the request is cross-origin or too large. */
class ActionRejection extends Error {
	readonly status: number;
	constructor(code: number, message: string) {
		super(message);
		this.status = code;
	}
}

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

/* The token half of the CSRF check, when `csrf: { token: true }` asks for
 * it. Separate from rejectionFor because it needs the parsed body: the
 * header arrives with the request, but the hidden field — the only half a
 * page without JavaScript can send — exists only once the body is read. */
const tokenRejectionFor = (
	request: Request,
	csrf: ActionCsrfOptions | false | undefined,
	body: unknown
) => {
	if (csrf === false || !csrf?.token) return undefined;
	if (verifyCsrfToken(request, body)) return undefined;

	return new ActionRejection(HTTP_FORBIDDEN, 'Missing or invalid CSRF token');
};

/* ---------------------------------------------------------------- *
 * Bounded body reads
 * ---------------------------------------------------------------- */

/* `maxBodySize` was enforced from `content-length`, which a chunked
 * request does not send: `fetch` with a stream body, or any client using
 * `Transfer-Encoding: chunked`, declared nothing and so passed the check
 * no matter how much it then sent. A route with `maxBodySize: 10` would
 * hand its handler megabytes.
 *
 * So when nothing was declared, read the body here with a cap and stop at
 * the first chunk that crosses it. The bytes already read are then served
 * back through the same request, by overriding the four methods Elysia's
 * parser calls on it, which leaves Elysia the only thing that parses a
 * body: a reimplementation here would mean one shape for declared bodies
 * and another for chunked ones, differing in whatever its query parser
 * does that a hand-rolled one does not. */

const concatChunks = (chunks: readonly Uint8Array[], total: number) => {
	// Backed by an explicit ArrayBuffer, so the view types as
	// Uint8Array<ArrayBuffer> and counts as a BodyInit.
	const bytes = new Uint8Array(new ArrayBuffer(total));
	let offset = 0;
	chunks.forEach((chunk) => {
		bytes.set(chunk, offset);
		offset += chunk.length;
	});

	return bytes;
};

/* Recursive rather than a while loop, so each read is awaited without
 * `no-await-in-loop`. Resolves the collected chunks, or undefined once
 * the cap is crossed — the remaining chunks are never read. */
const readCapped = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	limit: number,
	chunks: Uint8Array[],
	total: number
): Promise<{ bytes: Uint8Array<ArrayBuffer> } | undefined> => {
	const { done, value } = await reader.read();
	if (done) return { bytes: concatChunks(chunks, total) };
	const size = total + value.length;
	if (size > limit) {
		await reader.cancel();

		return undefined;
	}
	chunks.push(value);

	return readCapped(reader, limit, chunks, size);
};

/* The methods Elysia's web-standard parser calls (see its
 * adapter/web-standard/parse.ts), answered from bytes already in hand.
 * Own properties shadow the prototype's, so the request keeps its
 * identity — several WeakMaps here and in the request context are keyed
 * on it. */
const serveCollectedBody = (
	request: Request,
	bytes: Uint8Array<ArrayBuffer>
) => {
	const { headers } = request;
	const define = (name: string, value: () => unknown) => {
		Object.defineProperty(request, name, { configurable: true, value });
	};
	define('arrayBuffer', () => new Response(bytes, { headers }).arrayBuffer());
	define('blob', () => new Response(bytes, { headers }).blob());
	define('bytes', () => new Response(bytes, { headers }).bytes());
	define('formData', () => new Response(bytes, { headers }).formData());
	define('json', () => new Response(bytes, { headers }).json());
	define('text', () => new Response(bytes, { headers }).text());
};

/** A 413 when an undeclared body runs past `maxBodySize`, after reading no
 *  more than that. Undefined when the size was declared (already checked),
 *  when there is no body, or when it fits. */
const overflowRejection = async (request: Request, maxBodySize: number) => {
	if (request.headers.get('content-length') !== null) return undefined;
	const { body } = request;
	if (!body) return undefined;
	const collected = await readCapped(body.getReader(), maxBodySize, [], 0);
	if (!collected)
		return new ActionRejection(
			HTTP_PAYLOAD_TOO_LARGE,
			'Form submission is too large'
		);
	serveCollectedBody(request, collected.bytes);

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

type AnswerSettings = {
	htmx: FormActionOptions['htmx'];
	preserveValues: boolean;
	redirect: FormActionOptions['redirect'];
};

/* Where the answered form posted: the concrete path, plus the route
 * pattern when it differs (a route with path parameters), so the page can
 * name the action either way. */
type ActionTarget = { action: string; route: string | undefined };

const flashFor = (
	request: Request,
	result: ActionResult,
	settings: AnswerSettings,
	target: ActionTarget
) => {
	const values = settings.preserveValues
		? submittedValues.get(request)
		: undefined;
	const flash: ActionFlash = {
		action: target.action,
		...(target.route && target.route !== target.action
			? { route: target.route }
			: {}),
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

const navigationTarget = (request: Request, result: ActionResult) =>
	result.status === 'success' && result.redirect
		? result.redirect
		: backTarget(request);

const answerHtmx = async (
	request: Request,
	result: ActionResult,
	settings: AnswerSettings,
	target: ActionTarget
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
		flashCookie(request, flashFor(request, result, settings, target))
	);

	return new Response(null, { headers, status: HTTP_OK });
};

const answerDocument = (
	request: Request,
	result: ActionResult,
	settings: AnswerSettings,
	target: ActionTarget
) => {
	const headers = new Headers({
		location: navigationTarget(request, result)
	});
	headers.append(
		'set-cookie',
		flashCookie(request, flashFor(request, result, settings, target))
	);

	return new Response(null, { headers, status: HTTP_SEE_OTHER });
};

/* The answer for callers that don't take the route's own JSON: a plain
 * form post (303 back to the page), HTMX (a fragment or HX-Redirect) and
 * the browser helpers, which read an error from a 200 body (a 422 would
 * only add a "Failed to load resource" console error per invalid form).
 * Undefined for other JSON clients (Eden, fetch): they get the route's
 * typed answer, the handler's data with 200 or the field errors with
 * 422. */
const respond = (
	request: Request,
	result: ActionResult,
	settings: AnswerSettings,
	target: ActionTarget
) => {
	const mode = responseModeOf(request);
	if (mode === 'htmx') return answerHtmx(request, result, settings, target);
	if (mode === 'document')
		return answerDocument(request, result, settings, target);
	if (request.headers.has(ACTION_REQUEST_HEADER))
		return Response.json(result, { status: HTTP_OK });

	return undefined;
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

const successResult = (settings: AnswerSettings, data: unknown) => {
	const { redirect } = settings;
	const target = typeof redirect === 'function' ? redirect(data) : redirect;
	const result: ActionSuccessState =
		target === undefined
			? { data, status: 'success' }
			: { data, redirect: target, status: 'success' };

	return result;
};

const failureBody = <Fields extends string>(
	errors: ActionFieldErrors<Fields>,
	message?: string
) => {
	const body: FormActionFailure<Fields> =
		message === undefined
			? { errors, status: 'error' }
			: { errors, message, status: 'error' };

	return body;
};

/* ---------------------------------------------------------------- *
 * The `form` macro
 * ---------------------------------------------------------------- */

/* Typed by the macro's `FormActionMacroType` output instead: the two
 * would intersect into overloads and this loosely typed one would win. */
const fail = (errors: ActionFieldErrors, message?: string) =>
	status(HTTP_UNPROCESSABLE, failureBody(errors, message));
type FailContext = { fail: typeof fail };
const failContext = () => {
	const fields: FailContext = { fail };
	const context: Record<never, never> = fields;

	return context;
};

const FORM_ACTION_META: FormActionRouteMeta = { absoluteFormAction: true };

/* `form: t.Object(…)` or `form: { body: t.Object(…), …options }`. A
 * TypeBox object schema is `{ type: 'object', properties }`; the options
 * shape has neither (its fields live under `body.properties`). */
const isObjectSchema = (value: FormActionValue): value is TObject =>
	Reflect.get(value, 'type') === 'object' &&
	isRecord(Reflect.get(value, 'properties'));

const optionsOf = (value: FormActionValue) => {
	const options: FormActionOptions = isObjectSchema(value)
		? { body: value }
		: value;

	return options;
};

const isErrorStatus = (code: unknown) =>
	typeof code === 'number' && code >= HTTP_FIRST_ERROR;

/* What the route answered, as an action result: the field errors inside
 * `status(422, …)` (from `fail` or the error hook), or the handler's data
 * when it answered normally. Anything else (a raw Response, another
 * status, an error another hook answered) is not shaped. */
const routeResult = (
	value: unknown,
	settings: AnswerSettings,
	statusCode: unknown
) => {
	if (value instanceof Response) return undefined;
	if (value instanceof ElysiaStatus) {
		const body: unknown = value.response;
		const failed =
			value.status === HTTP_UNPROCESSABLE &&
			isActionResult(body) &&
			body.status === 'error';

		return failed ? body : undefined;
	}
	if (isErrorStatus(statusCode)) return undefined;

	return successResult(settings, value);
};

/* The route's error hook: a rejection (cross-origin, too large) answers
 * at once; a body that failed validation answers like `fail`, shaped for
 * the caller by mapResponse; anything else is left to the app. */
const errorAnswer = (error: unknown, request: Request, schema: TObject) => {
	if (error instanceof ActionRejection)
		return answerRejection(request, error);
	const entries = validationEntries(error, schema);
	if (!entries) return undefined;
	const result: ActionErrorState = {
		errors: fieldErrorsFrom(schema, entries),
		status: 'error'
	};

	return status(HTTP_UNPROCESSABLE, result);
};

const actionTarget = (request: Request, route: unknown) => {
	const target: ActionTarget = {
		action: new URL(request.url).pathname,
		route: typeof route === 'string' ? route : undefined
	};

	return target;
};

/* The `form` macro: the route's body schema, `fail`, its Eden `meta` and
 * the Phase 1 hooks. The hooks take named context types rather than
 * Elysia's inferred ones, which keeps the published declaration of the
 * `absolutejs` plugin small. */
const formMacro = (value: FormActionValue) => {
	const options = optionsOf(value);
	const schema = options.body;
	const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_BYTES;
	const settings: AnswerSettings = {
		htmx: options.htmx,
		preserveValues: options.preserveValues !== false,
		redirect: options.redirect
	};

	return {
		$type: macroType<FormActionMacroType>(),
		body: schema,
		derive: failContext,
		meta: FORM_ACTION_META,
		// Typed `unknown` so its answers add nothing to the route's type:
		// the 422 is the macro's field-error shape.
		error: ({ error, request }: FormActionErrorContext) => {
			const answer: unknown = errorAnswer(error, request, schema);

			return answer;
		},
		// The handler answers with typed values (its data, or the field
		// errors in a 422), which is what Eden sees; this turns them into
		// what a plain form, HTMX or the browser helpers expect.
		mapResponse: async ({
			request,
			responseValue,
			route,
			set
		}: FormActionResponseContext) => {
			const result = routeResult(responseValue, settings, set.status);
			const response = result
				? await respond(
						request,
						result,
						settings,
						actionTarget(request, route)
					)
				: undefined;
			// After a validation error Elysia applies the 422 it recorded
			// to whatever comes back, even a 200 the caller asked for (HTMX
			// swaps only 2xx; the browser helpers read errors from a 200).
			// The answer's own status wins.
			if (response) set.status = response.status;

			return response;
		},
		parse: async ({ request }: FormActionHookContext) => {
			const rejection =
				rejectionFor(request, options.csrf, maxBodySize) ??
				(await overflowRejection(request, maxBodySize));
			if (rejection) {
				pendingRejections.set(request, rejection);

				return {};
			}
			// With no content-type there is nothing for Elysia to parse, so
			// `body` stays undefined and the schema reports one error
			// against the whole body: `{ '': 'must be object' }`. A form's
			// errors are per field, and `must be object` is the validator's
			// language rather than anything a visitor should read. An empty
			// object says the same thing in the shape the rest of the
			// pipeline expects: every required field Required.
			if (!request.headers.get('content-type')) return {};

			return undefined;
		},
		transform: ({ body, request }: FormActionHookContext) => {
			const rejection =
				pendingRejections.get(request) ??
				tokenRejectionFor(request, options.csrf, body);
			if (rejection) throw rejection;
			if (!isRecord(body) || !isFormContent(request)) return;
			// The token is protocol, not one of the form's fields: leaving
			// it in would reach the schema as an unknown property and show
			// up among the values echoed back into the re-rendered form.
			delete body[CSRF_FIELD_NAME];
			captureValues(request, body);
			normalizeFormBody(schema, body);
		}
	};
};

/** The `form` route option alone (no lifecycle hooks of its own until a
 *  route uses it). `prepare()` gives the `absolutejs` plugin its type
 *  with this; apps use `formActions()`. */
export const formActionMacro = () =>
	new Elysia({ name: 'absolutejs-form-action-macro' }).macro({
		form: formMacro
	});

/** An Elysia instance whose routes accept the `form` option: the type
 *  of the `absolutejs` plugin from `prepare()`. */
export type FormActionsPlugin = ReturnType<typeof formActionMacro>;

/** Form actions for a plain Elysia app: the `form` route option plus the
 *  runtime that renders and clears no-JavaScript results on HTML pages.
 *  The `absolutejs` plugin from `prepare()` already includes both.
 *
 *    new Elysia()
 *    	.use(formActions())
 *    	.post('/signup', { form: t.Object({ … }) }, ({ body, fail }) => …)
 *    	.post('/signup', { form: { body: t.Object({ … }), redirect: '/' } }, …)
 */
export const formActions = () =>
	new Elysia({ name: 'absolutejs-form-actions' })
		.use(formActionRuntime())
		.use(formActionMacro());
