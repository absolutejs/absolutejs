import type { Context } from 'elysia';
import type { PageAction } from './pageAction';
import type { RouteHoles } from './routeHoles';

/* File-system routing (opt-in). See docs/FILE_ROUTER_PLAN.md.
 *
 * A route file under `<frameworkDirectory>/routes/` becomes a GET route:
 * `blog/[slug].tsx` serves `/blog/:slug`. A sibling `blog/[slug].server.ts`
 * may export `load` (returns the page's props) and `beforeHandle` (a guard
 * that can answer the request itself). The build writes a route module
 * (`fileRoutes.output`) the server passes to `fileRoutes()`. */

export type FileRouteFramework =
	'angular' | 'html' | 'htmx' | 'react' | 'svelte' | 'vue';

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

/* A `[[optional]]` segment is typed `:name?`, so its name arrives here with
 * the `?` still attached: `/:lang?/about` names `lang?`. The `?` is dropped
 * from the key and spent on the value instead — the route is registered
 * under both `/about` and `/:lang/about`, and on the first of them the
 * param is genuinely absent. */
type ParamKeyOf<Name extends string> = Name extends `${infer Base}?`
	? Base
	: Name;

/* One mapped type, deliberately, rather than a required half intersected
 * with an optional half. An intersection of two mapped types over a
 * deferred `ParamNamesOf<Path>` stops being assignable from
 * `Record<string, string>`, which is what `FileRouteParams<string>` is —
 * so the adapters, which pass their params through a `string`-pathed hook
 * type, no longer type-check. */
/** The params of an Elysia-style path: `'/blog/:slug'` →
 *  `{ slug: string }`, `'/:lang?/about'` → `{ lang: string | undefined }`.
 *  An unknown path (`string`) has string params of any name. */
export type FileRouteParams<Path extends string> = string extends Path
	? Record<string, string>
	: {
			[
				Name in ParamNamesOf<Path> as ParamKeyOf<Name>
			]: Name extends `${string}?` ? string | undefined : string;
		};

export type FileRouteRedirectStatus = 301 | 302 | 303 | 307 | 308;

/* What the app's plugins derive onto a request, as the app declares it.
 *
 * Empty here on purpose: `fileRoutes()` passes through whatever the
 * plugins registered before it put on the context — `@absolutejs/auth`'s
 * session, an `onBeforeHandle`'s own values — and only the app knows what
 * those are. An app declares them once:
 *
 *   declare module '@absolutejs/absolute' {
 *     interface FileRouteDerivedContext {
 *       session: Session | null;
 *     }
 *   }
 *
 * and every route's `load` and `beforeHandle` sees them typed, with no
 * per-route annotation and nothing to keep in step.
 *
 * Declared rather than inferred, because the generated route module never
 * imports the server: it cannot see the app's Elysia type, so there is
 * nothing to infer from. Which means this is a claim the app makes, like
 * Elysia's own context augmentation — a key declared here that no plugin
 * actually derives arrives as `undefined`. Inferring it from the server
 * instead is still open. */
// An interface, not a type: declaration merging is how the keys get in,
// as for `AbsoluteManifestKeys` in types/manifest.ts.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type
export interface FileRouteDerivedContext {}

/** What `load` and `beforeHandle` receive for a request to `Path`. */
export type FileRouteContext<Path extends string = string> =
	FileRouteDerivedContext & {
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
	/** This route's form action, made with `defineAction`: registered
	 *  as `POST` on the route's own path, so the page's `<form
	 *  method="post">` posts to it with no `action` attribute. An
	 *  ordinary form action in every other way. The server module is
	 *  then imported when the server starts, not on first request: a
	 *  route's schema has to exist when the route is registered. */
	// The schema and result are the action's own, checked where it is
	// defined; any of them is a server module's `action`.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	action?: PageAction<any, any>;
	/** Runs before `load`; return a value (a `Response`, a redirect) to
	 *  answer the request instead of rendering the page. */
	beforeHandle?: (context: FileRouteContext<Path>) => unknown;
	/** The param sets this route serves, for the paths a build has to
	 *  enumerate: the sitemap today, prerendering next.
	 *
	 *  A dynamic route cannot be enumerated from its file name —
	 *  `blog/[slug].tsx` says nothing about which slugs exist — so a
	 *  route without this is simply left out of the sitemap rather than
	 *  guessed at. The shape is the route's own params, so a renamed
	 *  `[slug]` is a type error here as well as in `load`.
	 *
	 *  Called at BUILD time, in the build's own process, so it may read a
	 *  database or the filesystem but should not expect a request. */
	entries?: () => MaybePromise<readonly FileRouteParams<Path>[]>;
	/** The dynamic parts of this route's pre-rendered page, keyed by the
	 *  `id` of the slot each fills: `<StreamSlot dynamic id="cart" />`
	 *  in the page, `cart` here. When every dynamic slot has one, a
	 *  request for the pre-rendered page is answered without running
	 *  the route — no `load`, no `beforeHandle`, no page render — so a
	 *  hole that shows something private checks the request itself.
	 *  See `defineHoles`. */
	holes?: RouteHoles<FileRouteParams<Path>>;
	/** Returns the props the page renders with. */
	load?: (context: FileRouteContext<Path>) => MaybePromise<Props | Response>;
	/** `false` skips the server render for this route: the server sends
	 *  the document shell and the browser renders the page. `load` and
	 *  `beforeHandle` still run on the server. See `PageSsrOption`. */
	ssr?: boolean;
};

/** The shape of a folder's `layout.server.ts` module: a guard for every
 *  route in that folder and below it.
 *
 *  It runs before each of those routes' own `beforeHandle`, outermost
 *  folder first, and a returned value answers the request instead of the
 *  page — a redirect to `/login`, a 403. Returning nothing lets the
 *  request through to the next guard.
 *
 *  The context's `params` are the request's, untyped: one guard serves
 *  routes with different params, so it cannot be written against one
 *  route's path. */
export type FileRouteGuardModule = {
	beforeHandle?: (context: FileRouteContext) => unknown;
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
	/** `false` when the route's server module exports `ssr = false`. */
	ssr?: boolean;
};

export type FileRouteDefinition = {
	framework: FileRouteFramework;
	/** Page name in the manifest (`<name>Index`, …). */
	name: string;
	/** Elysia path, e.g. `/blog/:slug`. */
	path: string;
	/** Route file, relative to the project root. */
	source: string;
	/** The name the route file gave its catch-all segment. Elysia calls the
	 *  param `*`; the context exposes it under this name as well, which is
	 *  the name `[...rest].tsx` led its `load` to expect. */
	catchAll?: string;
	beforeHandle?: (context: FileRouteContext) => unknown;
	/** The server module's `holes`, when the route has a server module. */
	holes?: () => Promise<RouteHoles | undefined>;
	load?: (context: FileRouteContext) => Promise<unknown>;
	/** Whether the route's page is rendered on the server. Absent means
	 *  it is. */
	ssr?: () => Promise<boolean>;
	render: (input: FileRouteRenderInput) => Promise<Response>;
};
