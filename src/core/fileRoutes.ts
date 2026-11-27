import { recordRouteSource } from './routeSources';
import { HTML_CONTENT_TYPE } from '../constants';
import { Elysia, NotFound, type AnyElysia } from 'elysia';
import type {
	FileRouteContext,
	FileRouteDefinition,
	FileRouteRedirectStatus
} from '../../types/fileRoutes';
import {
	markCurrentFileRoute,
	markCurrentRouteHead
} from '../utils/fileRouteRef';
import {
	mergeRouteMetadata,
	routeHeadTags,
	type RouteHeadTag
} from '../utils/routeMetadata';
import {
	isPageRequest,
	renderConventionError,
	renderRouteNotFound
} from '../utils/resolveConvention';
import { logWarn } from '../utils/logger';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { asksForMarkdownSource } from '../utils/pageMarkdownRef';
import { withPageCacheHeaders } from './pageResponseCache';
import { reportServerError } from './errorReporter';
import { registerRouteHoles } from './routeHoles';

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

/* Elysia's own context keys, so everything else on the context is
 * something the app's plugins derived and belongs in a route's `load`.
 *
 * A deny-list rather than an allow-list, because the derived keys are the
 * ones nobody here can name: `@absolutejs/auth`'s session, an
 * `onBeforeHandle`'s own values, whatever a project's plugin adds.
 *
 * Measured against the Elysia in this repo rather than guessed, and it
 * differs between versions — `body` appears only on a request that has
 * one, `store` and `url` are own keys on some versions and not others,
 * and `qi` and anything `~`-prefixed are internals. So the list is the
 * union of what was observed, plus the `~` rule, and a key a later
 * version adds would show up as though a plugin had derived it: harmless
 * until something collides with it, and visible in the unit test that
 * asserts exactly which keys reach a `load`.
 *
 * The keys are filtered BEFORE any value is read. They are all plain
 * values on this version, but `server` is a getter on others, and
 * copying the whole context would invoke it on every request. */
const ELYSIA_CONTEXT_KEYS = new Set([
	'body',
	'cookie',
	'headers',
	'params',
	'path',
	'qi',
	'query',
	'redirect',
	'request',
	'route',
	'server',
	'set',
	'status',
	'store',
	'url'
]);

const isDerivedKey = (key: string) =>
	!key.startsWith('~') && !ELYSIA_CONTEXT_KEYS.has(key);

const derivedOf = (context: RouteRequestContext) =>
	Object.fromEntries(
		Object.keys(context)
			.filter(isDerivedKey)
			.map((key) => [key, Reflect.get(context, key)])
	);

const toFileRouteContext = (
	context: RouteRequestContext,
	catchAll?: string
) => {
	const fileRouteContext: FileRouteContext = {
		/* First, so the documented keys below are the ones a route gets
		 * from this object. That is not protection against a plugin that
		 * derives `params`: Elysia replaces the key on the context itself,
		 * before anything here runs, so the route's own params are already
		 * gone by then (a unit test records that). */
		...derivedOf(context),
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
	reportServerError({ error, kind: 'load', page: route.source });
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

type RouteHead = { tags: RouteHeadTag[]; title: string | undefined };

/* A route's `metadata`, every level of it, resolved for this request
 * and turned into head tags. Metadata that cannot be worked out costs
 * the page its metadata and nothing else: a title is not worth a 500. */
const routeHeadFor = async (
	route: FileRouteDefinition,
	context: RouteRequestContext,
	props: Record<string, unknown>
) => {
	if (!route.metadata) return undefined;
	try {
		const levels = await route.metadata(
			toFileRouteContext(context, route.catchAll),
			props
		);
		if (levels.length === 0) return undefined;
		const resolved = mergeRouteMetadata(levels);
		const head: RouteHead = {
			tags: routeHeadTags(resolved),
			title: resolved.title
		};
		markCurrentRouteHead(head.tags);

		return head;
	} catch (error) {
		console.error(
			`[file-routes] metadata failed for ${route.source}:`,
			error
		);
		reportServerError({ error, kind: 'load', page: route.source });

		return undefined;
	}
};

const ROUTE_DATA_MEDIA_TYPE = 'application/vnd.absolute.route+json';

/* A request for the page's DATA is answered with no document, so there
 * is no head to put the tags in: they go with the data, and the browser
 * that hands the data to a mounted page swaps them into the head it
 * has (client/refreshInPlace.ts). */
const withRouteDataHead = async (response: Response, head: RouteHead) => {
	const contentType = response.headers.get('content-type') ?? '';
	if (!response.ok || !contentType.includes(ROUTE_DATA_MEDIA_TYPE))
		return response;
	const envelope: unknown = await response.json();
	if (!isRecord(envelope)) return response;
	const headers = new Headers(response.headers);
	// Neither describes the body any longer.
	headers.delete('etag');
	headers.delete('content-length');

	return new Response(
		JSON.stringify({
			...envelope,
			head: {
				...(isRecord(envelope.head) ? envelope.head : {}),
				tags: head.tags.map((tag) => tag.html).join(''),
				...(head.title === undefined ? {} : { title: head.title })
			}
		}),
		{ headers, status: response.status }
	);
};

/* A page, so only for a request that wants one: a client asking for
 * JSON keeps Elysia's JSON 404, as it does for the app-wide not-found. */
const routeNotFound = async (route: FileRouteDefinition, request: Request) =>
	isPageRequest(request) ? renderRouteNotFound(route.framework) : null;

/* `throw new NotFound()` from `load` renders the not-found page: the
 * nearest in the route's folders, or failing that the app's, which the
 * error handler renders when this is thrown on. Anything else `load`
 * threw renders the error page. */
const answerLoadFailure = async (
	route: FileRouteDefinition,
	request: Request,
	error: unknown
) => {
	if (!(error instanceof NotFound))
		return withPageCacheHeaders(
			await renderLoadError(route, error),
			request
		);
	const notFound = await routeNotFound(route, request);
	if (notFound) return notFound;

	throw error;
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
	// So that whatever renders an error or a 404 for this request can
	// find this route's own, in its route folder (fileRouteRef.ts).
	markCurrentFileRoute(route.name);
	let loaded: unknown;
	try {
		loaded = await loadProps(route, context);
	} catch (error) {
		return answerLoadFailure(route, context.request, error);
	}
	if (loaded instanceof Response) return loaded;
	const props = isRecord(loaded) ? loaded : {};
	// The Markdown plugin asking for this page (pageMarkdown.ts): a
	// route that says what its Markdown is answers with it, unrendered.
	const own = asksForMarkdownSource(context.request)
		? await route.markdown?.(
				toFileRouteContext(context, route.catchAll),
				props
			)
		: undefined;
	if (typeof own === 'string')
		return new Response(own.endsWith('\n') ? own : `${own}\n`, {
			headers: { 'content-type': 'text/markdown; charset=utf-8' }
		});
	// The route's metadata, noted for the response to be given it in
	// its head (routeHead.ts) — or, for a request for the page's data,
	// alongside the data.
	const head = await routeHeadFor(route, context, props);
	/* Asked after `load`, not before: `load` runs on the server either
	 * way, and its redirect or 404 must still answer a route whose page
	 * the server does not render. */
	const rendersOnServer = route.ssr ? await route.ssr() : true;
	const response = await route.render({
		manifest,
		props,
		request: context.request,
		...(rendersOnServer ? {} : { ssr: false })
	});

	return head ? withRouteDataHead(response, head) : response;
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
	const { beforeHandle, holes } = route;
	// The server module's `holes`, read when a request first needs them.
	if (holes) registerRouteHoles(route.path, holes, route.catchAll);
	const handle = (context: RouteRequestContext) =>
		serveFileRoute(route, manifest, context);
	recordRouteSource(handle, { kind: 'file', location: route.source });
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
