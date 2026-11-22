import type { FileRouteParams } from './fileRoutes';

/* The project's routes, as types, so a link can be checked.
 *
 * `route('/blog/:slug', { slug })` builds the URL, and the path and its
 * params are both checked: an unknown path, a missing param and a
 * misspelled one are all `tsc` errors naming the route.
 *
 * Why a function and not a typed `href`: because of where links are
 * written. The cross-framework navigation layer intercepts plain
 * `a[href]` (client/navigation.ts), and the example app holds 76 `<a>` to
 * one `<Link>`. React, Svelte and Vue do each have a `Link` whose `href`
 * prop a typed union could check — their own checkers check component
 * props — but those are per-framework router links, a small minority of
 * the link sites. Angular's is a directive on a plain `<a>`, so the
 * `href` is the native attribute and not checkable at all, and an
 * `<a href>` anywhere, or a link in an HTML or HTMX route, is beyond any
 * union's reach.
 *
 * A function covers all of that, and two places a prop cannot go at all:
 * the `redirect` of a server module, and a prefetch call.
 *
 * Filled in by declaration merging, exactly as `AbsoluteManifestKeys` is
 * (types/manifest.ts): `absolute dev`, `absolute build` and
 * `absolute typecheck` derive the project's routes from its source tree —
 * no build needed — and write `.absolutejs/types/routes.d.ts`:
 *
 *   declare module '@absolutejs/absolute' {
 *     interface AbsoluteRouteMap { '/blog/:slug': true; … }
 *   }
 *
 * The keys are TYPED paths (`:name`, and `:name?` for an `[[optional]]`
 * segment), not the paths Elysia registers: `[...rest]` registers as
 * `/docs/*` and is typed `/docs/:rest`, which is the name the route file
 * gave it and the one a caller has to supply.
 */
// An interface, not a type: declaration merging is how the routes get in.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type
export interface AbsoluteRouteMap {}

/** A route of this project once it has them, any string before — a
 *  project with no file routes, or one that has never run an AbsoluteJS
 *  command. Mirrors `ManifestKey`. */
/* Written as an indexed access over a mapped type rather than
 * `Extract<keyof AbsoluteRouteMap, string>`, because TypeScript resolves
 * this one to the concrete union and so PRINTS the project's routes in
 * the error for a path that is not one of them. With `Extract` the same
 * error said only "not assignable to parameter of type
 * 'keyof AbsoluteRouteMap'", which names nothing a reader can act on. */
export type AbsoluteRoutePath = [keyof AbsoluteRouteMap] extends [never]
	? string
	: { [Key in keyof AbsoluteRouteMap]: Key }[keyof AbsoluteRouteMap] & string;

/** A param value `route()` accepts. Numbers are common enough in a path
 *  (`/posts/:id`) that requiring `String(id)` at every call site would be
 *  noise; they are stringified on the way in. */
export type RouteParamValue = number | string;

type ParamsOf<Path extends string> = {
	[
		Key in keyof FileRouteParams<Path>
	]: undefined extends FileRouteParams<Path>[Key]
		? RouteParamValue | undefined
		: RouteParamValue;
};

/** `route()`'s second argument: absent for a path with no params,
 *  required for one with them.
 *
 *  Two branches exist only to keep the ERROR MESSAGE honest, and both were
 *  measured rather than reasoned about:
 *
 *  `string extends Path` — a project with no generated route map has
 *  `AbsoluteRoutePath = string`, and `FileRouteParams<string>` is
 *  `Record<string, string>`, whose `keyof` is `string`, not `never`.
 *  Without this branch params would be REQUIRED for every call in exactly
 *  the projects that have no types to check them against.
 *
 *  `Path extends AbsoluteRoutePath` — a path that is not a route at all
 *  still infers as its own literal, so without this branch the params
 *  were computed from the CONSTRAINT instead, and a typo reported
 *  "Expected 2 arguments, but got 1" rather than naming the path. Being
 *  permissive about params for a path that cannot be a route leaves the
 *  constraint violation as the only error, which is the one worth
 *  reading: it names the bad path and lists the real ones. */
export type RouteParamsArgs<Path extends string> = string extends Path
	? [params?: Record<string, RouteParamValue | undefined>]
	: Path extends AbsoluteRoutePath
		? [keyof ParamsOf<Path>] extends [never]
			? []
			: [params: ParamsOf<Path>]
		: [params?: Record<string, RouteParamValue | undefined>];
