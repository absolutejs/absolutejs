/**
 * Types for the typed API client (`createApiClient`,
 * `src/client/apiClient.ts`): every call is addressed by a route's path
 * and checked against the app's own routes — the tree Elysia keeps on
 * `typeof server['~Routes']`, which is also what Eden reads.
 */

export type ApiMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

type RoutesOf<App> = App extends { '~Routes': infer Routes } ? Routes : never;

/* What marks a node of the route tree as a route rather than a path
 * segment: Elysia gives every route these, schema or no schema. */
type RouteLeaf = {
	headers: unknown;
	params: unknown;
	query: unknown;
	response: unknown;
};

type MaxRouteDepth = 16;

/* Walks the tree and collects the path of every route registered for
 * `Method`. A node's keys are either methods (`get`, `post`, …) holding a
 * route, or path segments (`todos`, `:id`) holding more tree. */
type PathsIn<
	Routes,
	Method extends string,
	Prefix extends string,
	Depth extends 1[]
> = Depth['length'] extends MaxRouteDepth
	? never
	: {
			[Key in keyof Routes & string]: Routes[Key] extends RouteLeaf
				? Key extends Method
					? Prefix extends ''
						? '/'
						: Prefix
					: never
				: PathsIn<
						Routes[Key],
						Method,
						`${Prefix}/${Key}`,
						[...Depth, 1]
					>;
		}[keyof Routes & string];

type PathSegments<Path extends string> = Path extends `/${infer Rest}`
	? PathSegments<Rest>
	: Path extends ''
		? []
		: Path extends `${infer Head}/${infer Rest}`
			? [Head, ...PathSegments<Rest>]
			: [Path];

type RoutesAt<Routes, Segments> = Segments extends [
	infer Head extends string,
	...infer Rest
]
	? RoutesAt<Routes[Head & keyof Routes], Rest>
	: Routes;

/** Every path in `App` (`typeof server`) that answers `Method`. */
export type ApiPaths<App, Method extends ApiMethod> = PathsIn<
	RoutesOf<App>,
	Method,
	'',
	[]
>;

/** The route `App` registers for `Method` at `Path`. */
export type ApiRouteAt<App, Method extends ApiMethod, Path extends string> =
	RoutesAt<RoutesOf<App>, PathSegments<Path>> extends infer Node
		? Method extends keyof Node
			? Node[Method]
			: never
		: never;

type IsUnknown<Value> = unknown extends Value ? true : false;

type RequiredKeysOf<Value> = {
	[Key in keyof Value]-?: undefined extends Value[Key] ? never : Key;
}[keyof Value];

/* One request field. Left out of the options entirely when the route
 * declares nothing for it, optional when everything in it is optional,
 * required otherwise — so a route with a `:id` cannot be called without
 * one, and a route with no body is not offered a `body`. */
type Field<Name extends string, Value> =
	IsUnknown<Value> extends true
		? { [Key in Name]?: never }
		: [Value] extends [undefined]
			? { [Key in Name]?: never }
			: [keyof Value] extends [never]
				? { [Key in Name]?: Value }
				: [RequiredKeysOf<Value>] extends [never]
					? { [Key in Name]?: Value }
					: { [Key in Name]: Value };

/* A body is one value, not a bag of optional parts: required whenever
 * the route's schema does not accept `undefined`. */
type BodyField<Value> =
	IsUnknown<Value> extends true
		? { body?: unknown }
		: undefined extends Value
			? { body?: Value }
			: { body: Value };

export type ApiCallOptions = {
	/** Extra request headers, on top of the client's own. */
	headers?: Record<string, string>;
	/** Refresh the page's data once the call succeeds: the page is
	 *  fetched again and swapped in place (`invalidate()`). For a call
	 *  that changed something the page shows. Not done for a failed
	 *  call. */
	invalidate?: boolean;
	signal?: AbortSignal;
};

type RouteField<Route, Name extends string> = Name extends keyof Route
	? Route[Name]
	: unknown;

/** The options a call to `Route` takes: its `params`, `query` and `body`
 *  as the route declares them, plus the call's own. */
export type ApiRequestOptions<Route> = ApiCallOptions &
	BodyField<RouteField<Route, 'body'>> &
	Field<'params', RouteField<Route, 'params'>> &
	Field<'query', RouteField<Route, 'query'>>;

/* `[options?]` when nothing in them is required, `[options]` otherwise:
 * `api.get('/health')` stays a one-argument call. */
export type ApiCallArguments<Route> = [
	RequiredKeysOf<ApiRequestOptions<Route>>
] extends [never]
	? [options?: ApiRequestOptions<Route>]
	: [options: ApiRequestOptions<Route>];

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206;

type ResponsesOf<Route> = Route extends { response: infer Responses }
	? Responses
	: never;

/* A handler that returns a `Response` it built has told the types
 * nothing about what is in it; the client still reads the body, so the
 * honest type for that is `unknown`, not `Response`. */
type Readable<Value> = Value extends Response ? unknown : Value;

/** What `Route` answers when it succeeds: its 2xx responses. */
export type ApiDataOf<Route> =
	ResponsesOf<Route> extends infer Responses
		? [Extract<keyof Responses, SuccessStatus>] extends [never]
			? unknown
			: Readable<Responses[Extract<keyof Responses, SuccessStatus>]>
		: unknown;

/** A response `Route` declares that is not a success, by status. */
export type ApiDeclaredErrorOf<Route> =
	ResponsesOf<Route> extends infer Responses
		? {
				[
					Status in Exclude<keyof Responses, SuccessStatus>
				]: Status extends number
					? { status: Status; value: Readable<Responses[Status]> }
					: never;
			}[Exclude<keyof Responses, SuccessStatus>]
		: never;

/** A response nothing declared — a proxy's 502, a 500 with a body the
 *  route never typed. `status` is whatever arrived. */
export type ApiUndeclaredError = { status: number; value: unknown };

/** The request never got an answer: offline, DNS, a dropped connection.
 *  `status` is 0, which no response has. */
export type ApiNetworkError = { status: 0; value: Error };

export type ApiErrorOf<Route> =
	ApiDeclaredErrorOf<Route> | ApiNetworkError | ApiUndeclaredError;

/** What a call resolves to. It does not reject for an HTTP error or a
 *  network failure — check `error` — so the failure paths are in the
 *  types. (An aborted call does reject, with the abort error.) */
export type ApiResult<Data, Failure> =
	| {
			data: Data;
			error: null;
			/** The raw response, for a header or a stream. */
			response: Response;
			status: number;
	  }
	| {
			data: null;
			error: Failure;
			/** Absent when the request never got an answer. */
			response: Response | undefined;
			status: number;
	  };

export type ApiResultOf<Route> = ApiResult<ApiDataOf<Route>, ApiErrorOf<Route>>;

export type ApiClientOptions = {
	/** Prefix for every path. Default `''`: the page's own origin. Give
	 *  an absolute URL to call the app from outside a browser. */
	baseUrl?: string;
	/** The `fetch` to use. Default: the global one. */
	fetch?: (input: string, init: RequestInit) => Promise<Response>;
	/** Headers for every call; a function is asked per call. */
	headers?: Record<string, string> | (() => Record<string, string>);
};

/** One method of the client: `api.get(path, options)`. */
export type ApiMethodCall<App, Method extends ApiMethod> = <
	Path extends ApiPaths<App, Method>
>(
	path: Path,
	...rest: ApiCallArguments<ApiRouteAt<App, Method, Path>>
) => Promise<ApiResultOf<ApiRouteAt<App, Method, Path>>>;

export type ApiClient<App> = {
	[Method in ApiMethod]: ApiMethodCall<App, Method>;
};
