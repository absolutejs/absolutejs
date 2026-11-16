import type { ActionResult } from '../../types/formAction';
import { isActionResult } from './formActionProtocol';

/* Reading the result a submission without JavaScript left for the page
 * (the `absolute_action` cookie). Browser safe: no server imports, so the
 * typed client (`createFormActionClient`) can live in a module that pages
 * and the server both import. On the server the current request comes
 * from the request context's storage, which `requestContext.ts` keeps on
 * `globalThis`; in the browser there is none and the state is undefined. */

export const ACTION_FLASH_COOKIE = 'absolute_action';

/* Same key as `REQUEST_STORAGE_KEY` in src/core/requestContext.ts. */
const REQUEST_STORAGE_KEY = Symbol.for('absolutejs.requestAsyncLocalStorage');

export type ActionFlash = {
	/** The path the form posted to. */
	action: string;
	result: ActionResult;
	/** The route pattern that answered, when it differs from `action`
	 *  (a route with path parameters). */
	route?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const requestOf = (store: unknown) => {
	const request = isRecord(store) ? store.request : undefined;

	return request instanceof Request ? request : undefined;
};

/** The request being served, when called on the server inside a request
 *  that the `absolutejs` plugin's request context saw. */
export const currentActionRequest = () => {
	const storage: unknown = Reflect.get(globalThis, REQUEST_STORAGE_KEY);
	if (typeof storage !== 'object' || storage === null) return undefined;
	const getStore: unknown = Reflect.get(storage, 'getStore');
	if (typeof getStore !== 'function') return undefined;
	const store: unknown = Reflect.apply(getStore, storage, []);

	return requestOf(store);
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

const BASE64_BLOCK = 4;

const decodeBase64Url = (value: string) => {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding =
		(BASE64_BLOCK - (base64.length % BASE64_BLOCK)) % BASE64_BLOCK;
	const binary = atob(base64 + '='.repeat(padding));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

	return new TextDecoder().decode(bytes);
};

const decodeFlash = (value: string) => {
	try {
		const parsed: unknown = JSON.parse(decodeBase64Url(value));

		return parsed;
	} catch {
		return undefined;
	}
};

/** The result the last submission to the form route at `path` left for
 *  this page, when the browser posted without JavaScript and was
 *  redirected here. `path` is the route's path as declared
 *  (`/actions/signup`, or a pattern such as `/items/:id`) or the concrete
 *  path that was posted to. Read it in the page's route and pass it to the
 *  page as a prop. Undefined when there is none, and always in the
 *  browser. */
export const getActionState = <Data = unknown, Fields extends string = string>(
	path: string,
	request: Request | undefined = currentActionRequest()
) => {
	const flash = request ? readActionFlash(request) : undefined;
	if (!flash || (flash.action !== path && flash.route !== path))
		return undefined;
	const { result } = flash;
	// Unknown first, so the guard types it with the caller's fields.
	const candidate: unknown = result;

	return isActionResult<Data, Fields>(candidate) ? candidate : undefined;
};

/** The flash the request carries, when it is well-formed. */
export const readActionFlash = (request: Request) => {
	const value = cookieValue(request, ACTION_FLASH_COOKIE);
	if (!value) return undefined;
	const parsed = decodeFlash(value);
	if (!isRecord(parsed)) return undefined;
	const { action, result, route } = parsed;
	if (typeof action !== 'string' || !isActionResult(result)) return undefined;
	const flash: ActionFlash =
		typeof route === 'string'
			? { action, result, route }
			: { action, result };

	return flash;
};
