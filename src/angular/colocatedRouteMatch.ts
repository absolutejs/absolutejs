/* Whether a page's colocated `export const routes` (the table the build
 * wires into `provideRouter`) can match a request path, the way Angular's
 * router recognizes a URL. The page handler uses it to answer 404 for a
 * sub-path no route matches. The mount path comes from the Elysia route
 * that matched the request, so the check runs per request against the
 * page module's runtime `routes` array.
 *
 * Every rule errs towards "matches": a route the server can't resolve
 * (a `matcher` function, `loadChildren`, a malformed entry) counts as
 * matching everything under its prefix, so the page renders as before. */

const MAX_ROUTE_DEPTH = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const PRIMARY_OUTLET = 'primary';

const routeOutlet = (route: Record<string, unknown>) =>
	typeof route.outlet === 'string' ? route.outlet : PRIMARY_OUTLET;

/* How one route matches `segments`: `true` (it does, or this can't tell
 * statically), `false` (it can't), or the children that must match the
 * segments its own path leaves over. */
const matchRoute = (route: unknown, segments: string[]) => {
	if (!isRecord(route)) return true;
	// Named-outlet routes never match the primary URL path.
	if (routeOutlet(route) !== PRIMARY_OUTLET) return false;
	if (typeof route.matcher === 'function') return true;
	if (typeof route.path !== 'string') return true;

	const { path } = route;
	const parts = path.split('/').filter((part) => part !== '');
	if (parts.includes('**')) return true;

	const isFull = route.pathMatch === 'full';
	if (parts.length > segments.length) return false;
	if (isFull && parts.length < segments.length) return false;
	const consumed = parts.every(
		(part, index) => part.startsWith(':') || part === segments[index]
	);
	if (!consumed) return false;

	const rest = segments.slice(parts.length);
	// A redirect source counts as a match; the redirect target is the
	// browser's next request.
	if (route.redirectTo !== undefined) return true;
	// Lazy children can't be resolved on the server: anything under the
	// prefix may match.
	if (route.loadChildren !== undefined) return true;
	if (route.children !== undefined) return { children: route.children, rest };

	return rest.length === 0;
};

const matchRoutes = (
	routes: unknown,
	segments: string[],
	depth: number
): boolean => {
	if (!Array.isArray(routes) || depth > MAX_ROUTE_DEPTH) return true;
	// Angular accepts an exhausted URL at any level, even with no
	// empty-path route: the outlet just renders nothing.
	if (segments.length === 0) return true;

	return routes.some((route) => {
		const result = matchRoute(route, segments);
		if (typeof result === 'boolean') return result;

		return matchRoutes(result.children, result.rest, depth + 1);
	});
};

const decodeSegment = (segment: string) => {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
};

/* The URL segments Angular's router sees for a path below the base href:
 * empty segments dropped, matrix parameters (`;key=value`) stripped,
 * percent-escapes decoded. `null` when the path holds syntax this matcher
 * doesn't model (auxiliary outlets in parentheses, bad escapes). */
const toUrlSegments = (path: string) => {
	if (path.includes('(') || path.includes(')')) return null;
	const decoded = path
		.split('/')
		.map((raw) => raw.split(';')[0] ?? '')
		.filter((segment) => segment !== '')
		.map(decodeSegment);
	if (decoded.some((segment) => segment === null)) return null;

	return decoded.filter((segment): segment is string => segment !== null);
};

/** True when `routes` (a page's runtime `Routes` array) can match `path`,
 *  the request path with the base href removed. Conservative: unsure
 *  cases match. */
export const matchesAngularColocatedRoutes = (
	routes: unknown,
	path: string
) => {
	const segments = toUrlSegments(path);
	if (segments === null) return true;

	return matchRoutes(routes, segments, 0);
};

/** The request path below `baseHref` (which ends in `/`), or `null` when the
 *  path isn't under it. Repeated slashes collapse first, as they do in the
 *  URL the page renders for. */
export const pathBelowBaseHref = (pathname: string, baseHref: string) => {
	const collapsed = pathname.replace(/\/{2,}/g, '/');
	const base = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
	if (`${collapsed}/` === base) return '';
	if (!collapsed.startsWith(base)) return null;

	return collapsed.slice(base.length);
};

const WILDCARD_SUFFIX = '/*';
const ROOT_WILDCARD = '/*';
const MAX_PROVIDER_DEPTH = 8;

/* Whether the handler call's own `providers` set APP_BASE_HREF. That
 * override beats the base derived from the Elysia route, so the router's
 * base is then unknown here. Matched by the token's description to stay
 * independent of which `@angular/common` instance created it. */
const providesBaseHref = (provider: unknown, depth = 0): boolean => {
	if (depth > MAX_PROVIDER_DEPTH) return true;
	if (Array.isArray(provider))
		return provider.some((entry) => providesBaseHref(entry, depth + 1));
	if (!isRecord(provider)) return false;
	const nested = Reflect.get(provider, 'ɵproviders');
	if (Array.isArray(nested)) return providesBaseHref(nested, depth + 1);
	if (!('provide' in provider)) return false;

	return String(provider.provide).includes('appBaseHref');
};

type ColocatedRouteRequest = {
	handlerProviders: unknown;
	pageModule: Record<string, unknown>;
	request: Request | undefined;
	/** The Elysia route pattern that matched this request. */
	route: string | undefined;
	/** The base href derived from `route` for this request. */
	runtimeBaseHref: string | null;
};

/** True only when the page's colocated routes certainly can't match this
 *  request: the page exports `routes` and the build wired them into its
 *  `providers`, the Elysia route is a wildcard mount whose base is known
 *  for this request, and no route matches the path below it. */
export const isUnmatchedColocatedRoute = ({
	handlerProviders,
	pageModule,
	request,
	route,
	runtimeBaseHref
}: ColocatedRouteRequest) => {
	if (!request || !route?.endsWith(WILDCARD_SUFFIX)) return false;
	const { providers, routes } = pageModule;
	if (!Array.isArray(routes) || !Array.isArray(providers)) return false;
	if (providesBaseHref(handlerProviders)) return false;

	const baseHref = runtimeBaseHref ?? (route === ROOT_WILDCARD ? '/' : null);
	if (baseHref === null) return false;

	let pathname: string;
	try {
		({ pathname } = new URL(request.url));
	} catch {
		return false;
	}
	const path = pathBelowBaseHref(pathname, baseHref);
	if (path === null) return false;

	return !matchesAngularColocatedRoutes(routes, path);
};
