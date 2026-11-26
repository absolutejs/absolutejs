import type { ActionResult, ActionState } from '../../types/formAction';

/* The wire contract between `form` routes (server) and the browser
 * helpers (`submitFormAction`, `enhanceForms`, `useFormAction`). Browser
 * safe: no server imports. */

/* - ACTION_ERROR_ATTRIBUTE: element whose text becomes the named field's
 *   error (`data-action-error="email"`).
 * - ACTION_INVALIDATE_ATTRIBUTE: on an enhanced <form>, refreshes the
 *   page's data after a successful submission (`invalidate()`).
 * - ACTION_FORM_ATTRIBUTE: marks a plain <form> for `enhanceForms()` and
 *   for the server's no-JS result rendering.
 * - ACTION_MESSAGE_ATTRIBUTE: element whose text becomes the form-level
 *   error message.
 * - ACTION_REQUEST_HEADER: sent by the browser helpers so the action
 *   answers with JSON instead of redirecting.
 * - ACTION_STATUS_ATTRIBUTE: set on the form, `success` or `error`.
 * - ACTION_SUCCESS_ATTRIBUTE: element shown (its `hidden` removed) after
 *   a successful submission. */
export const ACTION_ERROR_ATTRIBUTE = 'data-action-error';
export const ACTION_FORM_ATTRIBUTE = 'data-absolute-action';
export const ACTION_INVALIDATE_ATTRIBUTE = 'data-action-invalidate';
export const ACTION_MESSAGE_ATTRIBUTE = 'data-action-message';
export const ACTION_REQUEST_HEADER = 'x-absolute-action';
export const ACTION_STATUS_ATTRIBUTE = 'data-action-status';
export const ACTION_SUCCESS_ATTRIBUTE = 'data-action-success';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown) =>
	isRecord(value) &&
	Object.values(value).every((entry) => typeof entry === 'string');

const isOptionalString = (value: unknown) =>
	value === undefined || typeof value === 'string';

/** True for a well-formed action result. The type parameters let callers
 *  name the action's data and fields; only the shape is checked. */
export const isActionResult = <Data = unknown, Fields extends string = string>(
	value: unknown
): value is ActionResult<Data, Fields> => {
	if (!isRecord(value)) return false;
	if (value.status === 'success') return isOptionalString(value.redirect);

	return (
		value.status === 'error' &&
		isStringRecord(value.errors) &&
		isOptionalString(value.message)
	);
};

/** True for a well-formed form state (idle, or a result). */
export const isActionState = <Data = unknown, Fields extends string = string>(
	value: ActionState
): value is ActionState<Data, Fields> =>
	value.status === 'idle' || isActionResult<Data, Fields>(value);

/** The provisional value an `optimistic` mapper returns, wrapped so that
 *  a mapper returning undefined stays distinguishable from no submission
 *  at all.
 *
 *  A mapper that throws must not take the submission down with it: it
 *  decorates the wait, and the form still has work to do. But it cannot
 *  be silent either — the binding's own submit handler swallows
 *  rejections to ignore aborted submissions, so an exception here would
 *  vanish and leave a form that just never updates. So it is reported and
 *  the submission proceeds with no provisional value. */
export const optimisticValue = <Data>(
	mapper: ((body: FormData) => Data) | undefined,
	body: FormData
) => {
	if (!mapper) return undefined;
	try {
		return { value: mapper(body) };
	} catch (error) {
		console.error(
			"[absolute] a form action's `optimistic` mapper threw; the submission continues without a provisional value.",
			error
		);

		return undefined;
	}
};

/** What a binding shows as `data`: the provisional value while a
 *  submission is in flight, else the handler's return value from a
 *  successful result.
 *
 *  Shared so the four bindings cannot drift on it. The provisional value
 *  is wrapped by its caller, so a mapper that returns undefined is
 *  distinguishable from no submission at all. */
export const shownActionData = <Data, Fields extends string>(
	state: ActionState<Data, Fields>,
	optimistic: { value: Data } | undefined
) => {
	if (optimistic) return optimistic.value;

	return state.status === 'success' ? state.data : undefined;
};
