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
	| RouteMatch<Params>
	| RouteMiss;

export type RouterMode = 'history' | 'hash';

export type GotoOptions = {
	/** Use `history.replaceState` instead of `pushState`. */
	replaceState?: boolean;
	/** Don't reset focus to body on navigation. */
	keepFocus?: boolean;
	/** Don't scroll to top on navigation. */
	noScroll?: boolean;
	/** Value attached to `history.state`. */
	state?: unknown;
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
