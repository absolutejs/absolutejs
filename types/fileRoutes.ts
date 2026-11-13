import type { Context } from 'elysia';

/* File-system routing (opt-in). See docs/FILE_ROUTER_PLAN.md.
 *
 * A route file under `<frameworkDirectory>/routes/` becomes a GET route:
 * `blog/[slug].tsx` serves `/blog/:slug`. A sibling `blog/[slug].server.ts`
 * may export `load` (returns the page's props) and `beforeHandle` (a guard
 * that can answer the request itself). The build writes a route module
 * (`fileRoutes.output`) the server passes to `fileRoutes()`. */

export type FileRouteFramework = 'react' | 'svelte';

export type FileRoutesConfig = {
	/** Folder inside each framework directory that holds route files.
	 *  Default `routes`, so React routes live in `<reactDirectory>/routes`. */
	directory?: string;
	/** Where the generated route module is written, relative to the project
	 *  root. Your server imports `routeTree` from it. Default
	 *  `src/routes.gen.ts`. */
	output?: string;
};

type ParamNamesOf<Path extends string> =
	Path extends `${string}:${infer Param}/${infer Rest}`
		? Param | ParamNamesOf<`/${Rest}`>
		: Path extends `${string}:${infer Param}`
			? Param
			: never;

/** The params of an Elysia-style path: `'/blog/:slug'` → `{ slug: string }`.
 *  An unknown path (`string`) has string params of any name. */
export type FileRouteParams<Path extends string> = string extends Path
	? Record<string, string>
	: { [Name in ParamNamesOf<Path>]: string };

export type FileRouteRedirectStatus = 301 | 302 | 303 | 307 | 308;

/** What `load` and `beforeHandle` receive for a request to `Path`. */
export type FileRouteContext<Path extends string = string> = {
	headers: Record<string, string | undefined>;
	params: FileRouteParams<Path>;
	path: string;
	query: Record<string, string | undefined>;
	request: Request;
	/** Response status and headers, as on an Elysia context. */
	set: Context['set'];
	/** A redirect response; return it from `beforeHandle` or `load`. */
	redirect: (url: string, status?: FileRouteRedirectStatus) => Response;
};

type MaybePromise<Value> = Value | Promise<Value>;

/** The shape of a route's co-located `<Route>.server.ts` module. */
export type FileRouteServerModule<
	Path extends string = string,
	Props = Record<string, unknown>
> = {
	/** Runs before `load`; return a value (a `Response`, a redirect) to
	 *  answer the request instead of rendering the page. */
	beforeHandle?: (context: FileRouteContext<Path>) => unknown;
	/** Returns the props the page renders with. */
	load?: (context: FileRouteContext<Path>) => MaybePromise<Props | Response>;
};

type RequiredKeysOf<Value> = {
	[Key in keyof Value]-?: undefined extends Value[Key] ? never : Key;
}[keyof Value];

/** Props a route's `load` has to supply: the page's props minus the `url`
 *  the page handler fills in from the request. */
export type FileRouteLoadProps<Props> = Omit<Props, 'url'>;

/** A route with required page props needs a server module whose `load`
 *  returns them; otherwise the server module is optional. */
export type FileRouteServerModuleFor<Path extends string, Props> = [
	RequiredKeysOf<FileRouteLoadProps<Props>>
] extends [never]
	? FileRouteServerModule<Path, FileRouteLoadProps<Props>> | undefined
	: FileRouteServerModule<Path, FileRouteLoadProps<Props>> & {
			load: (
				context: FileRouteContext<Path>
			) => MaybePromise<FileRouteLoadProps<Props> | Response>;
		};

/** What `fileRoutes()` needs to serve one request. Built by the framework
 *  adapters (`reactFileRoute`, `svelteFileRoute`) in the generated module. */
export type FileRouteRenderInput = {
	manifest: Record<string, string>;
	props: Record<string, unknown>;
	request: Request;
};

export type FileRouteDefinition = {
	framework: FileRouteFramework;
	/** Page name in the manifest (`<name>Index`, …). */
	name: string;
	/** Elysia path, e.g. `/blog/:slug`. */
	path: string;
	/** Route file, relative to the project root. */
	source: string;
	beforeHandle?: (context: FileRouteContext) => unknown;
	load?: (context: FileRouteContext) => Promise<unknown>;
	render: (input: FileRouteRenderInput) => Promise<Response>;
};
