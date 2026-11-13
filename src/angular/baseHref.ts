/** Derives Angular's `APP_BASE_HREF` from the Elysia route pattern that
 *  matched the request, so a router page mounted at `/portal/*` gets
 *  `/portal/` however the `handleAngularPageRequest(...)` call is written
 *  (inline in `.get(...)` or inside a helper function).
 *
 *  Only wildcard mounts below the root have a base. Pattern segments
 *  before the wildcard are matched against the request path, so a
 *  parameterised mount like `/t/:tenant/*` yields the concrete
 *  `/t/acme/` for `/t/acme/settings`. Returns `null` when there is no
 *  base to set (no route, no wildcard, the root `/*`, or a request path
 *  that doesn't line up with the pattern). */
const WILDCARD_SUFFIX = '/*';

export const deriveAngularBaseHref = (
	route: string | undefined,
	pathname: string | undefined
) => {
	if (!route || !route.endsWith(WILDCARD_SUFFIX)) return null;
	const prefixSegments = route
		.slice(0, route.length - WILDCARD_SUFFIX.length)
		.split('/')
		.filter(Boolean);
	if (prefixSegments.length === 0) return null;

	const hasParams = prefixSegments.some((segment) => segment.startsWith(':'));
	if (!hasParams) return `/${prefixSegments.join('/')}/`;

	if (!pathname) return null;
	const pathSegments = pathname.split('/').filter(Boolean);
	if (pathSegments.length < prefixSegments.length) return null;
	const resolved = prefixSegments.map((segment, index) =>
		segment.startsWith(':') ? pathSegments[index] : segment
	);
	if (resolved.some((segment, index) => segment !== pathSegments[index]))
		return null;

	return `/${resolved.join('/')}/`;
};

const readRequestPathname = (request: Request | undefined) => {
	if (!request) return undefined;
	try {
		return new URL(request.url).pathname;
	} catch {
		return undefined;
	}
};

export const resolveRequestBaseHref = (
	route: string | undefined,
	request: Request | undefined
) => deriveAngularBaseHref(route, readRequestPathname(request));
