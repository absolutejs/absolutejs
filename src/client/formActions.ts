import type {
	ActionData,
	ActionErrorState,
	ActionFields,
	ActionPath,
	ActionResult,
	AnyFormAction
} from '../../types/formAction';
import {
	ACTION_ERROR_ATTRIBUTE,
	ACTION_FORM_ATTRIBUTE,
	ACTION_MESSAGE_ATTRIBUTE,
	ACTION_REQUEST_HEADER,
	ACTION_STATUS_ATTRIBUTE,
	ACTION_SUCCESS_ATTRIBUTE,
	isActionResult
} from '../utils/formActionProtocol';

/* Browser side of form actions. `submitFormAction` posts a FormData and
 * returns the typed result; `enhanceForms` upgrades plain
 * `<form data-absolute-action>` markup (static HTML and HTMX pages) so it
 * submits without a reload. Without JavaScript the same forms post
 * normally and the server renders the result. */

export type SubmitFormActionOptions = {
	signal?: AbortSignal;
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
	<Action extends AnyFormAction = AnyFormAction>(path: ActionPath<Action>) =>
	async (_previous: unknown, body: FormData) =>
		submitFormAction<Action>(path, body);

/** Posts `body` to the action at `path` and returns its result. Network
 *  and unexpected server failures come back as an error state with a
 *  `message`; an aborted request rejects with the abort error. */
export const submitFormAction = async <
	Action extends AnyFormAction = AnyFormAction
>(
	path: ActionPath<Action>,
	body: FormData,
	options: SubmitFormActionOptions = {}
) => {
	type Result = ActionResult<ActionData<Action>, ActionFields<Action>>;
	const response = await fetch(path, {
		body,
		credentials: 'same-origin',
		headers: { accept: 'application/json', [ACTION_REQUEST_HEADER]: '1' },
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
	if (isActionResult<ActionData<Action>, ActionFields<Action>>(payload))
		return payload;
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

/** Submits `form` with fetch instead of a page load. Returns a function
 *  that removes the enhancement. */
export const enhanceForm = (form: HTMLFormElement) => {
	let controller: AbortController | undefined;
	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		controller?.abort();
		const current = new AbortController();
		controller = current;
		const body = new FormData(form, event.submitter);
		setPending(form, true);
		const result = await submitFormAction(formActionUrl(form), body, {
			signal: current.signal
		}).catch(() => undefined);
		if (controller !== current) return;
		setPending(form, false);
		if (result) finishSubmission(form, result);
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
