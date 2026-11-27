import type { ActionErrorState, ActionResult } from '../../types/formAction';
import { csrfHeaders } from '../utils/csrfTokenRef';
import {
	ACTION_ERROR_ATTRIBUTE,
	ACTION_FORM_ATTRIBUTE,
	ACTION_INVALIDATE_ATTRIBUTE,
	ACTION_MESSAGE_ATTRIBUTE,
	ACTION_REQUEST_HEADER,
	ACTION_STATUS_ATTRIBUTE,
	ACTION_SUCCESS_ATTRIBUTE,
	isActionResult
} from '../utils/formActionProtocol';
import { invalidate, invalidateKeepingPage } from './invalidate';

/* Browser side of form actions. `submitFormAction` posts a FormData and
 * returns the typed result; `enhanceForms` upgrades plain
 * `<form data-absolute-action>` markup (static HTML and HTMX pages) so it
 * submits without a reload. Without JavaScript the same forms post
 * normally and the server renders the result. */

export type SubmitFormActionOptions = {
	/** What happens to the page once the action succeeds without
	 *  redirecting (a redirect loads a page anyway).
	 *
	 *  Left out, the page's data is refreshed if that can be done
	 *  without disturbing the page: a mounted page is handed new props,
	 *  a page with no framework is patched where it differs. What was
	 *  typed, what is open and what the form's own state holds all stay.
	 *  A page that cannot be refreshed that way is left as it is.
	 *
	 *  `true` refreshes at any cost, as `invalidate()` does: a page that
	 *  cannot be refreshed in place is mounted again or reloaded.
	 *  `false` leaves the page alone — for an action that changes
	 *  nothing the page shows. */
	invalidate?: boolean;
	signal?: AbortSignal;
};

const refreshes = (result: ActionResult, mode: boolean | undefined) =>
	mode !== false && result.status === 'success' && !result.redirect;

const refreshPage = (mode: boolean | undefined) =>
	mode === true ? invalidate() : invalidateKeepingPage();

/* After the caller has the result, not before: whoever awaited the
 * submission gets to act on it while its page is still the one mounted.
 * A timer and not a microtask, because a microtask queued here runs
 * ahead of the caller's own continuation. */
const refreshAfter = <Result extends ActionResult>(
	result: Result,
	options: SubmitFormActionOptions
) => {
	if (refreshes(result, options.invalidate))
		setTimeout(() => {
			void refreshPage(options.invalidate);
		}, 0);

	return result;
};

const failure = (message: string): ActionErrorState => ({
	errors: {},
	message,
	status: 'error'
});

const readPayload = async (response: Response) => {
	try {
		const payload: unknown = await response.json();

		return payload;
	} catch {
		return undefined;
	}
};

/** A reducer for React 19's `useActionState` (JavaScript-only: React
 *  renders function form actions as `javascript:` URLs on the server; use
 *  `useFormAction` for forms that also work without JavaScript). */
export const formActionReducer =
	<Data = unknown, Fields extends string = string>(path: string) =>
	async (_previous: unknown, body: FormData) =>
		submitFormAction<Data, Fields>(path, body);

/** Posts `body` to the form route at `path` and returns its result.
 *  Network and unexpected server failures come back as an error state
 *  with a `message`; an aborted request rejects with the abort error.
 *  `createFormActionClient` types it by path. */
export const submitFormAction = async <
	Data = unknown,
	Fields extends string = string
>(
	path: string,
	body: FormData,
	options: SubmitFormActionOptions = {}
) => {
	type Result = ActionResult<Data, Fields>;
	const response = await fetch(path, {
		body,
		credentials: 'same-origin',
		headers: {
			accept: 'application/json',
			[ACTION_REQUEST_HEADER]: '1',
			// A server-rendered form already carries the token in its
			// hidden field, but a pre-rendered one cannot: the page was
			// built before any visitor had a cookie. Sending the header
			// whenever the cookie is readable covers both, and costs a
			// header on apps that use no tokens at all.
			...csrfHeaders()
		},
		method: 'POST',
		signal: options.signal
	}).catch((error: unknown) => {
		if (options.signal?.aborted) throw error;

		return undefined;
	});
	if (!response) {
		const result: Result = failure('Network error: the form was not sent.');

		return result;
	}
	const payload = await readPayload(response);
	if (isActionResult<Data, Fields>(payload))
		return refreshAfter(payload, options);
	const result: Result = failure(
		`The server could not handle the form (HTTP ${response.status}).`
	);

	return result;
};

/* ---------------------------------------------------------------- *
 * Plain <form data-absolute-action> enhancement
 * ---------------------------------------------------------------- */

export type FormActionEventDetail = { result: ActionResult };

/** Fired on the form after every enhanced submission. */
export const FORM_ACTION_EVENT = 'absolute:form-action';

const namedControls = (form: HTMLFormElement) =>
	Array.from(form.elements).filter(
		(element): element is HTMLElement & { name: string } =>
			element instanceof HTMLElement &&
			'name' in element &&
			typeof element.name === 'string' &&
			element.name !== ''
	);

const markControls = (form: HTMLFormElement, result: ActionResult) => {
	const errors = result.status === 'error' ? result.errors : {};
	const invalid = namedControls(form).filter((control) => {
		const message = errors[control.name];
		if (message) control.setAttribute('aria-invalid', 'true');
		else control.removeAttribute('aria-invalid');

		return Boolean(message);
	});

	return invalid[0];
};

const fillErrors = (form: HTMLFormElement, result: ActionResult) => {
	const errors = result.status === 'error' ? result.errors : {};
	form.querySelectorAll<HTMLElement>(`[${ACTION_ERROR_ATTRIBUTE}]`).forEach(
		(element) => {
			const name = element.getAttribute(ACTION_ERROR_ATTRIBUTE) ?? '';
			const message = errors[name] ?? '';
			element.textContent = message;
			element.hidden = message === '';
		}
	);
};

const fillMessages = (form: HTMLFormElement, result: ActionResult) => {
	const message = result.status === 'error' ? (result.message ?? '') : '';
	form.querySelectorAll<HTMLElement>(`[${ACTION_MESSAGE_ATTRIBUTE}]`).forEach(
		(element) => {
			element.textContent = message;
			element.hidden = message === '';
		}
	);
	form.querySelectorAll<HTMLElement>(`[${ACTION_SUCCESS_ATTRIBUTE}]`).forEach(
		(element) => {
			element.hidden = result.status !== 'success';
		}
	);
};

/** Writes `result` into a plain form: field errors into
 *  `[data-action-error="field"]`, the message into `[data-action-message]`,
 *  `[data-action-success]` shown on success, `aria-invalid` on the fields
 *  and `data-action-status` on the form. Focuses the first invalid field. */
export const applyActionResult = (
	form: HTMLFormElement,
	result: ActionResult
) => {
	form.setAttribute(ACTION_STATUS_ATTRIBUTE, result.status);
	fillErrors(form, result);
	fillMessages(form, result);
	const firstInvalid = markControls(form, result);
	firstInvalid?.focus();
};

const setPending = (form: HTMLFormElement, pending: boolean) => {
	form.toggleAttribute('aria-busy', pending);
	form.toggleAttribute('data-action-pending', pending);
	form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
		'button[type="submit"], button:not([type]), input[type="submit"]'
	).forEach((button) => {
		button.disabled = pending;
	});
};

const finishSubmission = (form: HTMLFormElement, result: ActionResult) => {
	applyActionResult(form, result);
	const detail: FormActionEventDetail = { result };
	form.dispatchEvent(
		new CustomEvent(FORM_ACTION_EVENT, { bubbles: true, detail })
	);
	if (result.status !== 'success') return;
	if (result.redirect) window.location.assign(result.redirect);
	else form.reset();
};

const formActionUrl = (form: HTMLFormElement) => {
	const url = new URL(form.action, window.location.href);

	return `${url.pathname}${url.search}`;
};

/* Present is yes, `="false"` is no, and absent leaves it to the default
 * (see `SubmitFormActionOptions.invalidate`). */
const invalidateModeOf = (form: HTMLFormElement) => {
	const value = form.getAttribute(ACTION_INVALIDATE_ATTRIBUTE);
	if (value === null) return undefined;

	return value !== 'false';
};

/** Submits `form` with fetch instead of a page load. Returns a function
 *  that removes the enhancement. */
export const enhanceForm = (form: HTMLFormElement) => {
	let controller: AbortController | undefined;
	/* The refresh is run here and not by `submitFormAction`, because on
	 * a page with no framework it rewrites the form from the server's
	 * copy — which has never heard of this result. The result is
	 * written into the form again once the refresh is done. */
	const refresh = async (result: ActionResult, current: AbortController) => {
		const mode = invalidateModeOf(form);
		if (!refreshes(result, mode)) return;
		await refreshPage(mode).catch(() => undefined);
		if (controller === current && form.isConnected)
			applyActionResult(form, result);
	};
	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		controller?.abort();
		const current = new AbortController();
		controller = current;
		const body = new FormData(form, event.submitter);
		setPending(form, true);
		const result = await submitFormAction(formActionUrl(form), body, {
			invalidate: false,
			signal: current.signal
		}).catch(() => undefined);
		if (controller !== current) return;
		setPending(form, false);
		if (!result) return;
		finishSubmission(form, result);
		await refresh(result, current);
	};
	const listener = (event: SubmitEvent) => {
		void submit(event);
	};
	form.addEventListener('submit', listener);

	return () => {
		controller?.abort();
		form.removeEventListener('submit', listener);
	};
};

/* htmx:configRequest carries the request's headers in `event.detail`.
 * Read defensively: the event is HTMX's, not ours, and this file is typed
 * without it. */
const htmxHeadersOf = (event: Event) => {
	if (!('detail' in event)) return undefined;
	const { detail } = event;
	if (typeof detail !== 'object' || detail === null || !('headers' in detail))
		return undefined;
	const { headers } = detail;

	return typeof headers === 'object' && headers !== null
		? headers
		: undefined;
};

/** Adds the CSRF token header to every HTMX request, for a page whose
 *  forms HTMX submits rather than `enhanceForms`.
 *
 *  A server-rendered HTMX page can simply include `csrfField()` in the
 *  form; this is for a pre-rendered one, which has no per-visitor token to
 *  embed. Does nothing on a page with no token cookie. Returns a function
 *  that removes the listener. */
export const enhanceHtmxCsrf = (root: EventTarget = document) => {
	const listener = (event: Event) => {
		const headers = htmxHeadersOf(event);
		if (headers) Object.assign(headers, csrfHeaders());
	};
	root.addEventListener('htmx:configRequest', listener);

	return () => root.removeEventListener('htmx:configRequest', listener);
};

/* HTMX already submits these; enhancing them too would post twice. */
const isHtmxForm = (form: HTMLFormElement) =>
	form.hasAttribute('hx-post') || form.hasAttribute('data-hx-post');

/** Enhances every `<form data-absolute-action>` under `root` (except
 *  `hx-post` forms, which HTMX submits). Returns a function that removes
 *  the enhancements. */
export const enhanceForms = (root: ParentNode = document) => {
	const cleanups = Array.from(
		root.querySelectorAll<HTMLFormElement>(`form[${ACTION_FORM_ATTRIBUTE}]`)
	)
		.filter((form) => !isHtmxForm(form))
		.map((form) => enhanceForm(form));

	return () => cleanups.forEach((cleanup) => cleanup());
};
