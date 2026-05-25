import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';

type RouteCallsiteStore = { callsite?: string };
type RouteCallsiteStorage = AsyncLocalStorage<RouteCallsiteStore>;
type RouteMethod = (this: unknown, ...args: unknown[]) => unknown;

const ROUTE_CALLSITE_STORAGE_KEY = Symbol.for(
	'absolutejs.devRouteRegistrationCallsiteStorage'
);
const ROUTE_CALLSITE_PATCHED_KEY = Symbol.for(
	'absolutejs.devRouteRegistrationCallsitePatched'
);

const ROUTE_METHOD_NAMES = [
	'all',
	'delete',
	'get',
	'head',
	'options',
	'patch',
	'post',
	'put'
] as const;

// Names of the framework page-request helpers. A GET route whose
// handler source mentions any of these is treated as a page route by
// the sitemap generator. Keep in sync with the page handlers exported
// from each framework's pageHandler module.
const PAGE_HANDLER_NAMES = [
	'handleReactPageRequest',
	'handleSveltePageRequest',
	'handleVuePageRequest',
	'handleAngularPageRequest',
	'handleHTMLPageRequest',
	'handleHTMXPageRequest'
] as const;

/* In dev, the registration patch replaces each handler with a wrapper
 * whose `.toString()` no longer mentions the original page-helper name —
 * which used to break sitemap discovery. We instead peek at the raw
 * handler at registration time (where it still has its real source) and
 * record per-route info keyed by the resulting wrapper here. The
 * sitemap looks up `route.handler` to identify page routes and to read
 * any literal `sitemap: { ... }` block the user passed to a
 * `handle*PageRequest` call. In prod no wrapping happens, so the same
 * helpers fall through to inspecting the raw handler directly. */
type PageHandlerInfo = {
	/** The unwrapped handler function — its `.toString()` exposes the
	 *  literal `handle*PageRequest({ ... })` call source. */
	originalHandler: (...args: unknown[]) => unknown;
};

const pageHandlerWrappers = new WeakMap<
	(...args: unknown[]) => unknown,
	PageHandlerInfo
>();

const handlerSourceMentionsPageHelper = (
	handler: (...args: unknown[]) => unknown
) => {
	const source = handler.toString();

	return PAGE_HANDLER_NAMES.some((name) => source.includes(name));
};

export const getOriginalPageHandlerSource = (
	handler: unknown
): string | undefined => {
	if (typeof handler !== 'function') return undefined;
	const fn = handler as (...args: unknown[]) => unknown;
	const info = pageHandlerWrappers.get(fn);

	return (info?.originalHandler ?? fn).toString();
};
export const isPageHandler = (handler: unknown): boolean => {
	if (typeof handler !== 'function') return false;
	const fn = handler as (...args: unknown[]) => unknown;
	if (pageHandlerWrappers.has(fn)) return true;

	return handlerSourceMentionsPageHelper(fn);
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isAsyncLocalStorage = (value: unknown): value is RouteCallsiteStorage =>
	isObjectRecord(value) &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const isRouteMethod = (value: unknown): value is RouteMethod =>
	typeof value === 'function';

const getRouteCallsiteStorage = () => {
	const value = Reflect.get(globalThis, ROUTE_CALLSITE_STORAGE_KEY);
	if (value === null || typeof value === 'undefined') {
		return undefined;
	}

	return isAsyncLocalStorage(value) ? value : undefined;
};

const ensureRouteCallsiteStorage = () => {
	const existing = getRouteCallsiteStorage();
	if (existing) {
		return existing;
	}

	const storage = new AsyncLocalStorage<RouteCallsiteStore>();
	Reflect.set(globalThis, ROUTE_CALLSITE_STORAGE_KEY, storage);

	return storage;
};

const normalizeCallsitePath = (value: string) =>
	value
		.replace(`${process.cwd()}/`, '')
		.replace(process.cwd(), '')
		.replace(/^\.\/+/, '');

const shouldIgnoreRouteCallsiteFrame = (frame: string) =>
	frame.includes('/node_modules/') ||
	frame.includes('/dist/') ||
	frame.includes('/src/core/devRouteRegistrationCallsite.');

const getRouteCallsiteLocation = (frame: string) =>
	frame.match(/\((\/[^)]+:\d+:\d+)\)$/)?.[1] ??
	frame.match(/at (\/[^ ]+:\d+:\d+)$/)?.[1];

const extractRouteRegistrationCallsite = (stack: string) => {
	const location = stack
		.split('\n')
		.slice(1)
		.map((line) => line.trim())
		.filter((frame) => !shouldIgnoreRouteCallsiteFrame(frame))
		.map((frame) => getRouteCallsiteLocation(frame))
		.find((frameLocation) => frameLocation !== undefined);

	return location ? normalizeCallsitePath(location) : undefined;
};

const captureRouteRegistrationCallsite = () => {
	const { stack } = new Error();
	if (!stack) {
		return undefined;
	}

	return extractRouteRegistrationCallsite(stack);
};

const wrapRouteHandlerWithCallsite = (handler: unknown, callsite?: string) => {
	if (typeof handler !== 'function' || !callsite) {
		return handler;
	}

	const storage = ensureRouteCallsiteStorage();
	const routeHandler = handler;

	return function wrappedRouteHandler(this: unknown, ...args: unknown[]) {
		return storage.run({ callsite }, () =>
			Reflect.apply(routeHandler, this, args)
		);
	};
};

const createPatchedRouteMethod = (
	originalMethod: RouteMethod,
	methodName: string
) =>
	function patchedRouteMethod(
		this: unknown,
		path: unknown,
		handler: unknown,
		...rest: unknown[]
	) {
		const callsite = captureRouteRegistrationCallsite();
		const wrapped = wrapRouteHandlerWithCallsite(handler, callsite);

		/* Record page-route registrations now, while the raw handler
		 * still exposes its real source. After this point the wrapper
		 * replaces it and `.toString()` no longer mentions the
		 * `handle*PageRequest` helper, so the sitemap can't discover
		 * the route by inspection. The wrapper itself goes into the
		 * `pageHandlerWrappers` map keyed by reference, with the
		 * original handler kept alive for later `.toString()` reads
		 * (used to extract literal `sitemap: { ... }` metadata). */
		if (
			methodName === 'get' &&
			typeof handler === 'function' &&
			typeof wrapped === 'function' &&
			handlerSourceMentionsPageHelper(
				handler as (...args: unknown[]) => unknown
			)
		) {
			pageHandlerWrappers.set(
				wrapped as (...args: unknown[]) => unknown,
				{
					originalHandler: handler as (...args: unknown[]) => unknown
				}
			);
		}

		return Reflect.apply(originalMethod, this, [path, wrapped, ...rest]);
	};

export const getCurrentRouteRegistrationCallsite = () =>
	getRouteCallsiteStorage()?.getStore()?.callsite;
export const patchElysiaRouteRegistrationCallsites = () => {
	if (process.env.NODE_ENV === 'production') {
		return;
	}

	if (Reflect.get(globalThis, ROUTE_CALLSITE_PATCHED_KEY) === true) {
		return;
	}

	const { prototype } = Elysia;
	ROUTE_METHOD_NAMES.forEach((methodName) => {
		const originalMethod = Reflect.get(prototype, methodName);
		if (!isRouteMethod(originalMethod)) return;
		Reflect.set(
			prototype,
			methodName,
			createPatchedRouteMethod(originalMethod, methodName)
		);
	});

	Reflect.set(globalThis, ROUTE_CALLSITE_PATCHED_KEY, true);
};
