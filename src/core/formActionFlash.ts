import { Elysia } from 'elysia';
import type { ActionResult } from '../../types/formAction';
import {
	ACTION_ERROR_ATTRIBUTE,
	ACTION_FORM_ATTRIBUTE,
	ACTION_MESSAGE_ATTRIBUTE,
	ACTION_STATUS_ATTRIBUTE,
	ACTION_SUCCESS_ATTRIBUTE,
	isActionResult
} from '../utils/formActionProtocol';

/* The result of a form submission made without JavaScript travels to the
 * page it redirects to in a cookie: HttpOnly, SameSite=Lax, one minute,
 * cleared by the first HTML page that is served while it is set. That
 * page reads it either in its route (`getActionState`) and passes it as a
 * prop, or, for static HTML / HTMX pages, gets it written into
 * `<form data-absolute-action>` by `formActionRuntime` below. */

export const ACTION_FLASH_COOKIE = 'absolute_action';
const FLASH_MAX_AGE_SECONDS = 60;
/* A cookie must stay under 4096 bytes including its name and attributes. */
const FLASH_MAX_VALUE_BYTES = 3_500;

export type ActionFlash = { action: string; result: ActionResult };

const cookieAttributes = (secure: boolean, maxAge: number) =>
	`Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const encodeValue = (flash: ActionFlash) =>
	Buffer.from(JSON.stringify(flash)).toString('base64url');

/* The flash, then smaller versions of it: without the echoed values (or
 * the success data), then with nothing but the outcome. */
const flashCandidates = (flash: ActionFlash) => {
	const { action, result } = flash;
	const candidates: ActionFlash[] = [flash];
	if (result.status === 'error')
		candidates.push(
			{ action, result: { ...result, values: undefined } },
			{
				action,
				result: {
					errors: {},
					message: 'The form could not be submitted.',
					status: 'error'
				}
			}
		);
	else
		candidates.push(
			{ action, result: { ...result, data: undefined } },
			{ action, result: { status: 'success' } }
		);

	return candidates;
};

export const clearActionFlashCookie = (secure: boolean) =>
	`${ACTION_FLASH_COOKIE}=; ${cookieAttributes(secure, 0)}`;

/** `Set-Cookie` value carrying `flash`, shrunk (values or data first, then
 *  details) until it fits a cookie. */
export const encodeActionFlash = (flash: ActionFlash, secure: boolean) => {
	const encoded = flashCandidates(flash).map(encodeValue);
	const value =
		encoded.find(
			(candidate) => candidate.length <= FLASH_MAX_VALUE_BYTES
		) ?? encoded[encoded.length - 1];

	return `${ACTION_FLASH_COOKIE}=${value}; ${cookieAttributes(secure, FLASH_MAX_AGE_SECONDS)}`;
};

const cookieValue = (request: Request, name: string) => {
	const header = request.headers.get('cookie');
	if (!header) return undefined;
	const prefix = `${name}=`;
	const pair = header
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(prefix));

	return pair?.slice(prefix.length);
};

const decodeFlash = (value: string) => {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8')
		);

		return parsed;
	} catch {
		return undefined;
	}
};

/** The flash the request carries, when it is well-formed. */
export const readActionFlash = (request: Request) => {
	const value = cookieValue(request, ACTION_FLASH_COOKIE);
	if (!value) return undefined;
	const parsed = decodeFlash(value);
	if (typeof parsed !== 'object' || parsed === null) return undefined;
	const action: unknown = Reflect.get(parsed, 'action');
	const result: unknown = Reflect.get(parsed, 'result');
	if (typeof action !== 'string' || !isActionResult(result)) return undefined;
	const flash: ActionFlash = { action, result };

	return flash;
};

/* ---------------------------------------------------------------- *
 * No-JavaScript rendering for <form data-absolute-action>
 * ---------------------------------------------------------------- */

const SKIPPED_INPUT_TYPES = new Set([
	'button',
	'file',
	'hidden',
	'image',
	'password',
	'reset',
	'submit'
]);

type RewriteState = {
	flash: ActionFlash;
	inForm: boolean;
	pageUrl: string;
	select: string | undefined;
};

const formMatches = (actionAttribute: string | null, state: RewriteState) => {
	try {
		const target = new URL(actionAttribute ?? '', state.pageUrl);

		return target.pathname === state.flash.action;
	} catch {
		return false;
	}
};

const errorsOf = (result: ActionResult) =>
	result.status === 'error' ? result.errors : {};

const valuesOf = (result: ActionResult) =>
	result.status === 'error' ? (result.values ?? {}) : {};

const valueList = (value: string | string[] | undefined) => {
	if (value === undefined) return undefined;

	return Array.isArray(value) ? value : [value];
};

const markInvalid = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	const name = element.getAttribute('name') ?? '';
	if (errorsOf(state.flash.result)[name])
		element.setAttribute('aria-invalid', 'true');
};

const restoreChoice = (
	element: HTMLRewriterTypes.Element,
	submitted: string[]
) => {
	const value = element.getAttribute('value') ?? 'on';
	if (submitted.includes(value)) element.setAttribute('checked', '');
	else element.removeAttribute('checked');
};

const restoreInput = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	if (!state.inForm) return;
	markInvalid(element, state);
	const type = (element.getAttribute('type') ?? 'text').toLowerCase();
	const name = element.getAttribute('name') ?? '';
	const submitted = valueList(valuesOf(state.flash.result)[name]);
	if (SKIPPED_INPUT_TYPES.has(type) || state.flash.result.status !== 'error')
		return;
	if (type === 'checkbox' || type === 'radio')
		restoreChoice(element, submitted ?? []);
	else if (submitted) element.setAttribute('value', submitted[0] ?? '');
};

const restoreTextarea = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	if (!state.inForm) return;
	markInvalid(element, state);
	const name = element.getAttribute('name') ?? '';
	const [submitted] = valueList(valuesOf(state.flash.result)[name]) ?? [];
	if (submitted !== undefined) element.setInnerContent(submitted);
};

const enterSelect = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	if (!state.inForm) return;
	markInvalid(element, state);
	state.select = element.getAttribute('name') ?? undefined;
	element.onEndTag(() => {
		state.select = undefined;
	});
};

const restoreOption = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	const value = element.getAttribute('value');
	if (!state.inForm || state.select === undefined || value === null) return;
	const submitted = valueList(valuesOf(state.flash.result)[state.select]);
	if (!submitted) return;
	if (submitted.includes(value)) element.setAttribute('selected', '');
	else element.removeAttribute('selected');
};

const fillError = (element: HTMLRewriterTypes.Element, state: RewriteState) => {
	if (!state.inForm) return;
	const name = element.getAttribute(ACTION_ERROR_ATTRIBUTE) ?? '';
	const message = errorsOf(state.flash.result)[name];
	if (!message) return;
	element.setInnerContent(message);
	element.removeAttribute('hidden');
};

const fillMessage = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	const { result } = state.flash;
	if (!state.inForm || result.status !== 'error' || !result.message) return;
	element.setInnerContent(result.message);
	element.removeAttribute('hidden');
};

const revealSuccess = (
	element: HTMLRewriterTypes.Element,
	state: RewriteState
) => {
	if (state.inForm && state.flash.result.status === 'success')
		element.removeAttribute('hidden');
};

const enterForm = (element: HTMLRewriterTypes.Element, state: RewriteState) => {
	state.inForm = formMatches(element.getAttribute('action'), state);
	if (!state.inForm) return;
	element.setAttribute(ACTION_STATUS_ATTRIBUTE, state.flash.result.status);
	element.onEndTag(() => {
		state.inForm = false;
	});
};

/** Writes `flash` into the page's matching `<form data-absolute-action>`:
 *  field errors, the form message, the success element, `aria-invalid`
 *  and (after an error) the values the user typed. */
export const rewriteActionForms = (
	response: Response,
	flash: ActionFlash,
	pageUrl: string
) => {
	const state: RewriteState = {
		flash,
		inForm: false,
		pageUrl,
		select: undefined
	};
	const attach = (
		handler: (
			element: HTMLRewriterTypes.Element,
			state: RewriteState
		) => void
	) => ({
		element: (element: HTMLRewriterTypes.Element) => handler(element, state)
	});

	return new HTMLRewriter()
		.on(`form[${ACTION_FORM_ATTRIBUTE}]`, attach(enterForm))
		.on(`[${ACTION_ERROR_ATTRIBUTE}]`, attach(fillError))
		.on(`[${ACTION_MESSAGE_ATTRIBUTE}]`, attach(fillMessage))
		.on(`[${ACTION_SUCCESS_ATTRIBUTE}]`, attach(revealSuccess))
		.on('input[name]', attach(restoreInput))
		.on('textarea[name]', attach(restoreTextarea))
		.on('select[name]', attach(enterSelect))
		.on('option', attach(restoreOption))
		.transform(response);
};

const isHtmlResponse = (response: Response) =>
	(response.headers.get('content-type') ?? '').includes('text/html');

/** Consumes the flash on the first HTML page served while it is set. */
export const consumeActionFlash = (request: Request, response: unknown) => {
	if (request.method !== 'GET' || !(response instanceof Response))
		return undefined;
	if (!isHtmlResponse(response)) return undefined;
	const flash = readActionFlash(request);
	if (!flash && !request.headers.get('cookie')?.includes(ACTION_FLASH_COOKIE))
		return undefined;
	const body =
		flash && !response.headers.has('content-encoding')
			? rewriteActionForms(response, flash, request.url)
			: response;
	const headers = new Headers(body.headers);
	const secure = new URL(request.url).protocol === 'https:';
	headers.append('set-cookie', clearActionFlashCookie(secure));
	// This copy shows one user's result: never cache it, and don't let it
	// stand in for the page's normal ETag.
	headers.set('cache-control', 'no-store');
	headers.delete('etag');

	return new Response(body.body, {
		headers,
		status: body.status,
		statusText: body.statusText
	});
};

/** Part of the `absolutejs` plugin from `prepare()`: renders and clears
 *  form-action results on HTML pages. */
export const formActionRuntime = () =>
	new Elysia({ name: 'absolutejs-form-action-runtime' }).mapResponse(
		'global',
		({ request, responseValue }) =>
			consumeActionFlash(request, responseValue)
	);
