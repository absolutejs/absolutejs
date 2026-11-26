import type {
	ApiClient,
	ApiClientOptions,
	ApiMethod,
	ApiMethodCall,
	ApiNetworkError,
	ApiResult,
	ApiUndeclaredError
} from '../../types/apiClient';
import { csrfHeaders } from '../utils/csrfTokenRef';
import { invalidate } from './invalidate';

/* The typed API client: the app's own routes, called from the browser
 * with their types.
 *
 * An Elysia route already says everything a caller needs — its path, its
 * params, the body it validates, what it answers and with which status —
 * and the app's type carries all of it. Until now nothing on the browser
 * side read that: a page called its own API with `fetch` and an
 * annotation someone kept in step by hand. This is the missing half. It
 * adds no server concept; the route IS the server function, with its
 * guards and validation exactly as they are.
 *
 * Addressed by path, like `createFormActionClient`, so one line finds
 * every caller of a route and a renamed route is a compile error at each
 * of them. Browser safe: the app is imported as a type only, so no
 * server code reaches a bundle. */

const HTTP_NO_CONTENT = 204;
const HTTP_RESET_CONTENT = 205;
const NETWORK_FAILURE_STATUS = 0;
const SAFE_METHODS = new Set<ApiMethod>(['get']);
const PARAM_SEGMENT = /^:([^?]+)(\?)?$/;

type CallOptions = {
	body: unknown;
	headers: Record<string, string>;
	invalidate: boolean;
	params: Record<string, unknown>;
	query: Record<string, unknown>;
	signal: AbortSignal | undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const stringRecord = (value: unknown) =>
	Object.fromEntries(
		Object.entries(isRecord(value) ? value : {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		)
	);

/* The call's options arrive typed per route; here they are read as plain
 * data, so nothing below depends on a route's shape. */
const readOptions = (value: unknown) => {
	const given = isRecord(value) ? value : {};
	const options: CallOptions = {
		body: given.body,
		headers: stringRecord(given.headers),
		invalidate: given.invalidate === true,
		params: isRecord(given.params) ? given.params : {},
		query: isRecord(given.query) ? given.query : {},
		signal: given.signal instanceof AbortSignal ? given.signal : undefined
	};

	return options;
};

const missingParam = (path: string, name: string) =>
	new TypeError(
		`The route ${path} needs params.${name}, and the call did not give one.`
	);

/* `:id` takes its param, `:id?` takes it or drops the segment, `*` takes
 * the rest of the path with its slashes left alone. */
const fillSegment = (
	segment: string,
	path: string,
	params: Record<string, unknown>
) => {
	if (segment === '*') return String(params['*'] ?? '');
	const match = PARAM_SEGMENT.exec(segment);
	if (!match) return segment;
	const [, name = '', optional] = match;
	const value = params[name];
	if (value !== undefined && value !== null)
		return encodeURIComponent(String(value));
	if (optional === undefined) throw missingParam(path, name);

	return undefined;
};

const fillPath = (path: string, params: Record<string, unknown>) =>
	path
		.split('/')
		.map((segment) => fillSegment(segment, path, params))
		.filter((segment) => segment !== undefined)
		.join('/');

const appendQueryValue = (search: URLSearchParams, key: string) => {
	const append = (value: unknown) => {
		if (value === undefined || value === null) return;
		search.append(
			key,
			value instanceof Date ? value.toISOString() : String(value)
		);
	};

	return append;
};

/* An array is the key repeated, which is how a form and Elysia's query
 * parser both spell it. `undefined` and `null` are left out rather than
 * sent as the words. */
const queryString = (query: Record<string, unknown>) => {
	const search = new URLSearchParams();
	Object.entries(query).forEach(([key, value]) => {
		const append = appendQueryValue(search, key);
		if (Array.isArray(value)) value.forEach(append);
		else append(value);
	});
	const text = search.toString();

	return text === '' ? '' : `?${text}`;
};

/* What `fetch` sends as it is, with the content type it implies. */
const isRawBody = (body: unknown): body is BodyInit =>
	typeof body === 'string' ||
	body instanceof FormData ||
	body instanceof URLSearchParams ||
	body instanceof Blob ||
	body instanceof ArrayBuffer ||
	ArrayBuffer.isView(body) ||
	body instanceof ReadableStream;

type EncodedBody = {
	content: BodyInit | undefined;
	headers: Record<string, string>;
};

const encodeBody = (body: unknown) => {
	const encoded: EncodedBody = { content: undefined, headers: {} };
	if (body === undefined) return encoded;
	if (isRawBody(body)) return { ...encoded, content: body };
	const json: EncodedBody = {
		content: JSON.stringify(body),
		headers: { 'content-type': 'application/json' }
	};

	return json;
};

const hasNoContent = (response: Response) =>
	response.status === HTTP_NO_CONTENT ||
	response.status === HTTP_RESET_CONTENT ||
	response.headers.get('content-length') === '0';

/* By what the server says it sent: JSON parsed, text as text, anything
 * else as a Blob. An answer with no content type is read as text — it
 * is what a handler returning a bare string produces. JSON that does
 * not parse is handed over as its text rather than thrown: the caller
 * asked a question and gets whatever the answer was. */
const readBody = async (response: Response) => {
	if (hasNoContent(response)) return undefined;
	const contentType = response.headers.get('content-type') ?? 'text/plain';
	if (!contentType.includes('json') && !contentType.startsWith('text/'))
		return response.blob();
	const text = await response.text();
	if (!contentType.includes('json')) return text;
	try {
		const parsed: unknown = JSON.parse(text);

		return parsed;
	} catch {
		return text;
	}
};

const clientHeaders = (headers: ApiClientOptions['headers']) =>
	typeof headers === 'function' ? headers() : (headers ?? {});

/* The result's type is the route's, which only the caller's types know;
 * what is built here is the same shape for every route. */
const isResult = <Result>(value: unknown): value is Result =>
	isRecord(value) && 'error' in value && 'data' in value;

const networkFailure = (error: unknown) => {
	const failure: ApiNetworkError = {
		status: NETWORK_FAILURE_STATUS,
		value: error instanceof Error ? error : new Error(String(error))
	};
	const result: ApiResult<never, ApiNetworkError> = {
		data: null,
		error: failure,
		response: undefined,
		status: NETWORK_FAILURE_STATUS
	};

	return result;
};

const answered = async (response: Response) => {
	const value = await readBody(response);
	if (response.ok) {
		const result: ApiResult<unknown, never> = {
			data: value,
			error: null,
			response,
			status: response.status
		};

		return result;
	}
	const failure: ApiUndeclaredError = { status: response.status, value };
	const result: ApiResult<never, ApiUndeclaredError> = {
		data: null,
		error: failure,
		response,
		status: response.status
	};

	return result;
};

/* After the caller has the result — see `refreshAfter` in
 * formActions.ts for why a timer and not a microtask. */
const refreshLater = () => {
	setTimeout(() => {
		void invalidate();
	}, 0);
};

const send = async (
	client: ApiClientOptions,
	method: ApiMethod,
	path: string,
	options: CallOptions
) => {
	const url = `${client.baseUrl ?? ''}${fillPath(path, options.params)}${queryString(options.query)}`;
	const body = encodeBody(options.body);
	const request = client.fetch ?? fetch;
	const response = await request(url, {
		body: body.content,
		credentials: 'same-origin',
		headers: {
			accept: 'application/json',
			// A changing call carries the CSRF token when the page has
			// one, as a form action does; a read has nothing to protect.
			...(SAFE_METHODS.has(method) ? {} : csrfHeaders()),
			...body.headers,
			...clientHeaders(client.headers),
			...options.headers
		},
		method: method.toUpperCase(),
		signal: options.signal
	}).catch((error: unknown) => {
		// An abort is the caller's own doing, not a failed request.
		if (options.signal?.aborted) throw error;

		return networkFailure(error);
	});
	if (!(response instanceof Response)) return response;
	const result = await answered(response);
	if (result.error === null && options.invalidate) refreshLater();

	return result;
};

const methodCall = <App, Method extends ApiMethod>(
	client: ApiClientOptions,
	method: Method
) => {
	const call: ApiMethodCall<App, Method> = async (path, ...rest) => {
		const result: unknown = await send(
			client,
			method,
			path,
			readOptions(rest[0])
		);
		if (isResult<Awaited<ReturnType<typeof call>>>(result)) return result;
		throw new Error('unreachable: an API call produced no result');
	};

	return call;
};

/** Builds a typed client for the routes of `App` (`typeof server`).
 *  Import the app as a type, so no server code reaches the browser:
 *
 *      import type { server } from './server';
 *      export const api = createApiClient<typeof server>();
 *
 *      const { data, error } = await api.get('/todos/:id', {
 *          params: { id: '3' }
 *      });
 *
 *  The path, `params`, `query` and `body` are checked against the
 *  route, and `data` and `error` are typed from what it answers. A call
 *  resolves for an HTTP error or a network failure — check `error` —
 *  and rejects only when aborted. `invalidate: true` refreshes the
 *  page's data after a call that succeeded. */
export const createApiClient = <App>(options: ApiClientOptions = {}) => {
	const client: ApiClient<App> = {
		delete: methodCall<App, 'delete'>(options, 'delete'),
		get: methodCall<App, 'get'>(options, 'get'),
		patch: methodCall<App, 'patch'>(options, 'patch'),
		post: methodCall<App, 'post'>(options, 'post'),
		put: methodCall<App, 'put'>(options, 'put')
	};

	return client;
};
