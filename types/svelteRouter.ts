/**
 * Public type surface for the AbsoluteJS Svelte router.
 *
 * `ExtractRouteParams<P>` walks a path-pattern string literal and produces
 * a typed `params` shape:
 *
 *   ExtractRouteParams<'/users/:id'>            → { id: string }
 *   ExtractRouteParams<'/users/:id/posts/:pid'> → { id: string; pid: string }
 *   ExtractRouteParams<'/users/:id?'>           → { id: string | undefined }
 *   ExtractRouteParams<'/files/*'>              → { wildcard: string }
 *   ExtractRouteParams<'/dashboard'>            → Record<string, never>
 *
 * Edge cases:
 *  - Optional params (`:name?`) appear as `string | undefined`
 *  - Wildcard tail (`*`) is exposed as the `wildcard` key
 *  - Same-name twice in one path is intentionally not detected at the type
 *    level (it's a logic bug in the user's pattern, not something the type
 *    system meaningfully rescues).
 */

type IsOptionalParamSegment<Segment extends string> =
	Segment extends `${string}?` ? true : false;

type StripOptionalSuffix<Segment extends string> =
	Segment extends `${infer Name}?` ? Name : Segment;

type WildcardSegment = '*' | `*${string}`;

type ParseSegment<Segment extends string> = Segment extends WildcardSegment
	? { wildcard: string }
	: Segment extends `:${infer Name}`
		? IsOptionalParamSegment<Name> extends true
			? { [K in StripOptionalSuffix<Name>]: string | undefined }
			: { [K in Name]: string }
		: Record<never, never>;

type SplitPath<Path extends string> = Path extends `/${infer Rest}`
	? SplitPath<Rest>
	: Path extends `${infer Head}/${infer Tail}`
		? ParseSegment<Head> & SplitPath<Tail>
		: ParseSegment<Path>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type ExtractRouteParams<Path extends string> = string extends Path
	? Record<string, string>
	: Simplify<SplitPath<Path>> extends infer Result
		? keyof Result extends never
			? Record<string, never>
			: Result
		: never;

export type RouteMatch<Params extends Record<string, unknown>> = {
	matched: true;
	params: Params;
};

export type RouteMiss = {
	matched: false;
};

export type RouteMatchResult<Params extends Record<string, unknown>> =
	RouteMatch<Params> | RouteMiss;

export type RouterMode = 'history' | 'hash';

export type GotoOptions = {
	/** Use `history.replaceState` instead of `pushState`. */
	replaceState?: boolean;
	/** Don't reset focus to body on navigation. */
	keepFocus?: boolean;
	/** Leave the scroll position alone: no scroll to the top, no scroll to
	 *  the `#hash` target. */
	noScroll?: boolean;
	/** Value attached to `history.state`, read back as `page.state`. */
	state?: unknown;
};

/** How a navigation started.
 *
 *  - `'link'` — a `<Link>` click.
 *  - `'goto'` — a programmatic `goto()` call.
 *  - `'popstate'` — the browser's back / forward buttons (or `history.go`).
 *  - `'enter'` — the first render of the page: the server render, or the
 *    first client render in hash mode (the server never sees the hash). */
export type NavigationType = 'link' | 'goto' | 'popstate' | 'enter';

/** What a guard sees about the navigation it is asked to allow. */
export type NavigationContext = {
	/** The URL being left. `null` on the first render (`type: 'enter'`). */
	from: URL | null;
	/** The URL being entered. In hash mode `to.pathname` is the routed path. */
	to: URL;
	/** Params of the route the guard belongs to, matched against `to`.
	 *  Empty for `beforeNavigate` guards and for a `<Router guard>` whose
	 *  routes don't match `to`. */
	params: Record<string, string | undefined>;
	type: NavigationType;
	/** The incoming request during the server render, so a guard can read
	 *  cookies or headers. `undefined` in the browser. */
	request: Request | undefined;
};

/** Redirect the navigation somewhere else. `replace: true` replaces the
 *  current history entry instead of adding one (browser only; the server
 *  always answers a redirect with a 302). */
export type NavigationRedirectTarget = {
	redirect: string;
	replace?: boolean;
};

/** What a guard returns.
 *
 *  - nothing / `undefined` / `true` — allow.
 *  - `false` — cancel: the URL and the rendered route stay as they were.
 *  - a URL string or `{ redirect }` — navigate there instead. */
export type RouteGuardResult =
	undefined | void | boolean | string | NavigationRedirectTarget;

export type RouteGuard = (
	navigation: NavigationContext
) => RouteGuardResult | Promise<RouteGuardResult>;

/** What `goto()` resolves to once the navigation has settled. */
export type NavigationOutcome =
	'committed' | 'cancelled' | 'redirected' | 'superseded' | 'external';

/** A lazily loaded route component: the module namespace returned by
 *  `import('./Page.svelte')`, or the component itself. */
export type LazyRouteModule<
	Props extends Record<string, unknown> = Record<string, unknown>
> =
	| { default: import('svelte').Component<Props> }
	| import('svelte').Component<Props>;

export type LazyRouteLoader<
	Props extends Record<string, unknown> = Record<string, unknown>
> = () => Promise<LazyRouteModule<Props>>;

export type ScrollPosition = { x: number; y: number };

/** Router bookkeeping stored in `history.state`, next to the user's own
 *  state (which `page.state` exposes unchanged). */
export type RouterHistoryMeta = {
	index: number;
	key: string;
	scroll?: ScrollPosition;
};

/** @internal What the server records for a lazy route it rendered. */
export type SvelteRouterSsrResolved =
	| {
			component: import('svelte').Component<Record<string, unknown>>;
			source: string | undefined;
	  }
	| { error: unknown };

/** @internal What a server-side guard decided for the whole request. */
export type SvelteRouterSsrOutcome =
	{ kind: 'redirect'; location: string } | { kind: 'cancel' };

/** @internal Per-request state the Svelte page handler passes the router
 *  through Svelte context, so guards and lazy routes can be awaited
 *  between render passes. */
export type SvelteRouterSsrState = {
	/** Queue work (a guard chain) to run once the current pass ends. */
	afterRender: (task: () => Promise<void>) => void;
	/** Start loading a lazy route's component; the page handler awaits it
	 *  and renders again with the component in `resolved`. */
	load: (key: string, loader: () => Promise<unknown>) => void;
	outcome: () => SvelteRouterSsrOutcome | undefined;
	request: Request | undefined;
	resolved: Map<string, SvelteRouterSsrResolved>;
	/** Guard chains already run, so a later pass doesn't run them again. */
	settledGuards: Set<string>;
	setOutcome: (outcome: SvelteRouterSsrOutcome) => void;
};

export type LinkPrefetchMode = 'hover' | 'viewport' | 'none';

export type PageState = {
	url: URL;
	params: Record<string, string | undefined>;
	state: unknown;
};

export type RouterContextValue = {
	/** Stacked basepath from outer to inner Router (joined). */
	basepath: string;
	mode: RouterMode;
};
