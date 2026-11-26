/* Where each registered route comes from, for `absolute routes`.
 *
 * Two kinds of answer, and they are different questions. A FILE route is
 * served by a file the router found (`react/routes/plans/pricing.tsx`),
 * and that file is the answer. Any other route was registered by a call
 * (`.get('/api/users', ...)`), and the answer is where that call is:
 * `server.ts:42:3`.
 *
 * Keyed by the handler function, not by method and path: a path written
 * at registration is not the path the route ends up with once a plugin
 * prefix or a group is applied, and Elysia carries the handler through
 * both unchanged.
 *
 * The map hangs off `globalThis` because the registration patch does:
 * a dev process can hold more than one copy of this module (the app's
 * own import of the package and the runtime's), and they must agree. */

export type RouteSource = {
	/** `file` for a file route, `call` for a registration call. */
	kind: 'call' | 'file';
	/** A project-relative file, with `:line:column` for a call. */
	location: string;
};

type RouteHandler = (...args: never[]) => unknown;

const ROUTE_SOURCES_KEY = Symbol.for('absolutejs.routeSources');

const isRouteHandler = (value: unknown): value is RouteHandler =>
	typeof value === 'function';

const routeSources = () => {
	const existing: unknown = Reflect.get(globalThis, ROUTE_SOURCES_KEY);
	if (existing instanceof WeakMap) return existing;
	const created = new WeakMap<RouteHandler, RouteSource>();
	Reflect.set(globalThis, ROUTE_SOURCES_KEY, created);

	return created;
};

export const recordRouteSource = (handler: unknown, source: RouteSource) => {
	if (!isRouteHandler(handler)) return;
	routeSources().set(handler, source);
};

export const routeSourceOf = (handler: unknown) => {
	if (!isRouteHandler(handler)) return undefined;
	const source: unknown = routeSources().get(handler);
	if (typeof source !== 'object' || source === null) return undefined;
	const kind: unknown = Reflect.get(source, 'kind');
	const location: unknown = Reflect.get(source, 'location');
	if (kind !== 'call' && kind !== 'file') return undefined;
	if (typeof location !== 'string') return undefined;
	const known: RouteSource = { kind, location };

	return known;
};
