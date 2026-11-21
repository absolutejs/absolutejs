import { HTML_CONTENT_TYPE } from '../constants';
import { Elysia, NotFound, type AnyElysia } from 'elysia';
import type {
	FileRouteContext,
	FileRouteDefinition,
	FileRouteRedirectStatus
} from '../../types/fileRoutes';
import { renderConventionError } from '../utils/resolveConvention';
import { logWarn } from '../utils/logger';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { withPageCacheHeaders } from './pageResponseCache';

/* `fileRoutes()` — serve the routes of the generated route module (see
 * docs/FILE_ROUTER_PLAN.md). Each route becomes a real Elysia GET route, so
 * `absolute routes`, OpenAPI and the HEAD fallback see it like any other.
 *
 *   import { routeTree } from './routes.gen';
 *   new Elysia().use(absolutejs).use(fileRoutes(routeTree, manifest))
 *
 * Explicit routes win: a route registered before `.use(fileRoutes(...))` is
 * skipped here, and one registered after replaces the file route (Elysia
 * keeps the last handler for a method and path). */

const DEFAULT_REDIRECT_STATUS = 302;

const redirect = (
	url: string,
	status: FileRouteRedirectStatus = DEFAULT_REDIRECT_STATUS
) => new Response(null, { headers: { location: url }, status });

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/* The part of an Elysia handler context a file route reads. */
type RouteRequestContext = Omit<FileRouteContext, 'redirect'>;

/* Elysia names a wildcard param `*`, but the route file named it:
 * `docs/[...rest].tsx` is why a `load` reads `params.rest`, and that is what
 * the route's types promise. So the declared name is filled in from `*`,
 * which is left in place as well — a route can still read `params['*']`.
 *
 * An absent `*` becomes an empty string rather than being left off, because
 * `/docs/*` matches `/docs/` with nothing after it, and a param the types
 * call `string` should not arrive as `undefined`. */
/* Elysia leaves `params` off a context for a route whose path has none, so
 * a `load` that reads `params.anything` throws rather than seeing
 * `undefined`. An `[[optional]]` route makes that ordinary — one of the
 * paths it registers has no params at all — so the object is always there. */
const EMPTY_PARAMS: FileRouteContext['params'] = {};

const paramsOf = (context: RouteRequestContext) =>
	context.params ?? EMPTY_PARAMS;

const withCatchAllParam = (
	params: FileRouteContext['params'],
	catchAll: string | undefined
) => {
	if (catchAll === undefined) return params;
	const wildcard = Reflect.get(params, '*');

	return {
		...params,
		[catchAll]: typeof wildcard === 'string' ? wildcard : ''
	};
};

const toFileRouteContext = (
	context: RouteRequestContext,
	catchAll?: string
) => {
	const fileRouteContext: FileRouteContext = {
		headers: context.headers,
		params: withCatchAllParam(paramsOf(context), catchAll),
		path: context.path,
		query: context.query,
		redirect,
		request: context.request,
		set: context.set
	};

	return fileRouteContext;
};

const renderLoadError = async (route: FileRouteDefinition, error: unknown) => {
	console.error(`[file-routes] load failed for ${route.source}:`, error);
	const conventionResponse = await renderConventionError(
		route.framework,
		route.name,
		error
	);

	return (
		conventionResponse ??
		new Response(ssrErrorPage(route.framework, error), {
			headers: { 'Content-Type': HTML_CONTENT_TYPE },
			status: 500
		})
	);
};

const loadProps = async (
	route: FileRouteDefinition,
	context: RouteRequestContext
) => {
	if (!route.load) return {};

	return route.load(toFileRouteContext(context, route.catchAll));
};

const serveFileRoute = async (
	route: FileRouteDefinition,
	manifest: Record<string, string>,
	context: RouteRequestContext
) => {
	let loaded: unknown;
	try {
		loaded = await loadProps(route, context);
	} catch (error) {
		// `throw new NotFound()` from `load` renders the not-found page.
		if (error instanceof NotFound) throw error;

		return withPageCacheHeaders(
			await renderLoadError(route, error),
			context.request
		);
	}
	if (loaded instanceof Response) return loaded;

	return route.render({
		manifest,
		props: isRecord(loaded) ? loaded : {},
		request: context.request
	});
};

/* Once per route per process: a dev entry re-run registers every route
 * again and would repeat it on each edit. */
const shadowedWarnings = new Set<string>();
const warnShadowedOnce = (route: FileRouteDefinition) => {
	const key = `${route.source}:${route.path}`;
	if (shadowedWarnings.has(key)) return;
	shadowedWarnings.add(key);
	logWarn(
		`File route ${route.source} is not served: an explicit route already handles GET ${route.path}.`
	);
};

const registeredGetPaths = (app: AnyElysia) =>
	new Set(
		app.routes
			.filter((route) => route.method === 'GET')
			.map((route) => route.path)
	);

const registerRoute = (
	plugin: Elysia,
	route: FileRouteDefinition,
	manifest: Record<string, string>
) => {
	const { beforeHandle } = route;
	const handle = (context: RouteRequestContext) =>
		serveFileRoute(route, manifest, context);
	if (!beforeHandle) {
		plugin.get(route.path, handle);

		return;
	}
	plugin.get(
		route.path,
		{
			beforeHandle: (context: RouteRequestContext) =>
				beforeHandle(toFileRouteContext(context, route.catchAll))
		},
		handle
	);
};

/** Register every file route on the app. Pass the `routeTree` the build
 *  generates and the manifest from `prepare()`. */
export const fileRoutes =
	(
		routes: readonly FileRouteDefinition[],
		manifest: Record<string, string>
	) =>
	<App extends AnyElysia>(app: App) => {
		const explicit = registeredGetPaths(app);
		const shadowed = routes.filter((route) => explicit.has(route.path));
		shadowed.forEach(warnShadowedOnce);
		const plugin = new Elysia();
		routes
			.filter((route) => !explicit.has(route.path))
			.forEach((route) => registerRoute(plugin, route, manifest));
		app.use(plugin);

		return app;
	};
