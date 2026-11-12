import type {
	AllowedComponentProps,
	App,
	ComponentCustomProps,
	Ref,
	VNodeProps
} from 'vue';
import type { Router } from 'vue-router';

/** The vue-router instance AbsoluteJS auto-creates from a page's `routes`
 *  export. Aliased to vue-router's own `Router` so consumers get the full,
 *  always-current API (`onError`, `afterEach`, `resolve`, …) rather than a
 *  hand-mirrored subset that silently drifts out of date — the missing
 *  `onError` is exactly the kind of gap a duplicated type hides. `vue-router`
 *  is an optional peer dependency: only pages that export `routes` reference
 *  this type, and those pages already depend on vue-router. */
export type VueAutoRouter = Router;

export type VueSetupAppContext = {
	url: string;
	isServer: boolean;
	/** The vue-router instance AbsoluteJS auto-created from the page's
	 *  `routes` export, already installed on the app and navigated to
	 *  the request URL. `null` when the page didn't export `routes`. */
	router: Router | null;
	/** Server-only. Call to short-circuit SSR and emit an HTTP redirect
	 *  instead. Pass the destination location and an optional status
	 *  (defaults to `302`). */
	setRedirect: (location: string, status?: number) => void;
	/** Server-only. Mark the current SPA route as unmatched so the page
	 *  handler returns the project's not-found convention with HTTP 404. */
	setNotFound: () => void;
};

export type VueSetupApp = (
	app: App,
	ctx: VueSetupAppContext
) => void | Promise<void>;

/** Structural shape of a single vue-router route record. Kept loose
 *  because absolutejs doesn't depend on `vue-router` types — users who
 *  want stricter typing can annotate with `RouteRecordRaw[]` from
 *  vue-router themselves. */
export type VueRouteRecord = {
	path: string;
	component?: unknown;
	children?: VueRouteRecord[];
	name?: string;
	redirect?: string | { name: string };
	meta?: Record<string, unknown>;
};

export type VueRoutes = readonly VueRouteRecord[];

type ReservedVueProps =
	keyof VNodeProps | keyof AllowedComponentProps | keyof ComponentCustomProps;

export type VuePropsOf<C> = C extends new () => { $props: infer Props }
	? Omit<Props, ReservedVueProps>
	: C extends (props: infer Props, ...args: never[]) => unknown
		? Props extends Record<string, unknown>
			? Props
			: Record<string, never>
		: Record<string, never>;

export type VueVNode = {
	children?: VueVNode[];
	component?: VueComponentInstance;
};

export type VueComponentInstance = {
	setupState?: Record<string, unknown>;
	subTree?: VueVNode;
};

/** Loads the value `useServerData` stores under its key. Receives an
 *  `AbortSignal` that aborts when the component unmounts or `refresh()` runs
 *  again; pass it to `fetch` so stale requests are cancelled. */
export type ServerDataFetcher<T> = (signal: AbortSignal) => Promise<T>;

export type ServerDataOptions = {
	/** Run the fetcher during server rendering and send the result to the
	 *  browser with the page. Default: `true`. Set `false` to always load on
	 *  the client (the server renders the pending state). */
	server?: boolean;
};

export type ServerData<T> = {
	/** The loaded value, or `null` before the first successful load. */
	data: Ref<T | null>;
	/** The last load failure, or `null`. A failure on the server reaches the
	 *  browser as an `Error` with the same `name`; its message is replaced
	 *  with a generic one in production. */
	error: Ref<Error | null>;
	/** True while a load is in flight. */
	pending: Ref<boolean>;
	/** Runs the fetcher again in the browser. An in-flight load is aborted
	 *  first. */
	refresh: () => Promise<void>;
};

/** A serialized server failure, as written into the page. */
export type ServerDataErrorEntry = {
	error: { message: string; name: string };
};

/** One key's server result, as written into the page. */
export type ServerDataEntry = { data: unknown } | ServerDataErrorEntry;

/** Per-request store the Vue page handler puts on the SSR context. Keys are
 *  claimed during `setup()`; `json` holds each result already serialized so
 *  a value that cannot be serialized fails while the page renders, not
 *  while the tail is written. */
export type ServerDataCollector = {
	claimed: Set<string>;
	/** A render error recorded while setup() ran (a repeated key in
	 *  development), thrown by the page handler once rendering ends. */
	failure: Error | null;
	json: Map<string, string>;
};
