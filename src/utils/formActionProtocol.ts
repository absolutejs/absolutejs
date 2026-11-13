import type { ActionResult } from '../../types/formAction';

/* The wire contract between `defineAction` (server) and the browser
 * helpers (`submitFormAction`, `enhanceForms`, `useFormAction`). Browser
 * safe: no server imports. */

/* - ACTION_ERROR_ATTRIBUTE: element whose text becomes the named field's
 *   error (`data-action-error="email"`).
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
