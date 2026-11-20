import { Elysia } from 'elysia';
import type { ActionResult } from '../../types/formAction';
import {
	ACTION_ERROR_ATTRIBUTE,
	ACTION_FORM_ATTRIBUTE,
	ACTION_MESSAGE_ATTRIBUTE,
	ACTION_STATUS_ATTRIBUTE,
	ACTION_SUCCESS_ATTRIBUTE
} from '../utils/formActionProtocol';
import {
	ACTION_FLASH_COOKIE,
	readActionFlash,
	type ActionFlash
} from '../utils/formActionState';
import { csrfSetCookie, csrfTokenIssued } from './csrfToken';

export { ACTION_FLASH_COOKIE, readActionFlash };
export type { ActionFlash };

/* The result of a form submission made without JavaScript travels to the
 * page it redirects to in a cookie: HttpOnly, SameSite=Lax, one minute,
 * cleared by the first HTML page that is served while it is set. That
 * page reads it either in its route (`getActionState`) and passes it as a
 * prop, or, for static HTML / HTMX pages, gets it written into
 * `<form data-absolute-action>` by `formActionRuntime` below. */

const FLASH_MAX_AGE_SECONDS = 60;
/* A cookie must stay under 4096 bytes including its name and attributes. */
const FLASH_MAX_VALUE_BYTES = 3_500;

const cookieAttributes = (secure: boolean, maxAge: number) =>
	`Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const encodeValue = (flash: ActionFlash) =>
	Buffer.from(JSON.stringify(flash)).toString('base64url');

/* The flash, then smaller versions of it: without the echoed values (or
 * the success data), then with nothing but the outcome. */
const flashCandidates = (flash: ActionFlash) => {
	const { result } = flash;
	const candidates: ActionFlash[] = [flash];
	if (result.status === 'error')
		candidates.push(
			{ ...flash, result: { ...result, values: undefined } },
			{
				...flash,
				result: {
					errors: {},
					message: 'The form could not be submitted.',
					status: 'error'
				}
			}
		);
	else
		candidates.push(
			{ ...flash, result: { ...result, data: undefined } },
			{ ...flash, result: { status: 'success' } }
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

/** Sets the `absolute_csrf` cookie on a page that minted a token while
 *  rendering, and keeps a page carrying one visitor's token out of shared
 *  caches.
 *
 *  Returns undefined when there is nothing to add, so the response passes
 *  through untouched on every page that uses no token. */
export const attachCsrfCookie = (request: Request, response: unknown) => {
	if (!(response instanceof Response) || !csrfTokenIssued(request))
		return undefined;
	const secure = new URL(request.url).protocol === 'https:';
	const cookie = csrfSetCookie(request, secure);
	const headers = new Headers(response.headers);
	if (cookie) headers.append('set-cookie', cookie);
	// The HTML holds a token bound to this visitor's cookie. Served to
	// anyone else from a CDN it would fail the check, so the page that
	// embeds one is private by construction.
	headers.set('cache-control', 'private, no-store');
	headers.delete('etag');

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};

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
 *  form-action results on HTML pages, and issues CSRF cookies. */
export const formActionRuntime = () =>
	new Elysia({ name: 'absolutejs-form-action-runtime' }).mapResponse(
		'global',
		({ request, responseValue }) => {
			const consumed = consumeActionFlash(request, responseValue);

			return (
				attachCsrfCookie(request, consumed ?? responseValue) ?? consumed
			);
		}
	);
