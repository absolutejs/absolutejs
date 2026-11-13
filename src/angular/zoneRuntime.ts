/* Opt-in zone.js change detection for Angular pages
 * (`angular: { changeDetection: 'zone' }` in absolute.config.ts).
 *
 * zone.js replaces the process-wide `Promise` with `ZoneAwarePromise`.
 * Bun.serve only accepts a native Promise from a request handler: a
 * ZoneAwarePromise (which Elysia returns for every async route once
 * `Promise` is patched) is rejected with "Expected a Response object"
 * and the client silently gets Bun's 200 "Welcome to Bun!" page. So
 * installing zone.js on the server also wraps `Bun.serve` (and each
 * server's `reload`) to adopt thenables into native promises.
 *
 * The mode lives on globalThis: the build, the dev runtime and the
 * production server load this module from different bundles. */
import type { AngularChangeDetection } from '../../types/build';

const ZONE_NODE_SPECIFIER = 'zone.js/node';
const MISSING_ZONE_MESSAGE =
	'angular.changeDetection is "zone" but zone.js could not be loaded. Install it in your app (bun add zone.js).';

export const isAngularZoneMode = () =>
	globalThis.__absoluteAngularChangeDetection === 'zone';

export const setAngularChangeDetection = (
	mode: AngularChangeDetection | undefined
) => {
	globalThis.__absoluteAngularChangeDetection = mode ?? 'zoneless';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const adoptIntoNativePromise = (
	NativePromise: PromiseConstructor,
	value: unknown
) => {
	if (value instanceof NativePromise || !isRecord(value)) return value;
	const { then } = value;
	if (typeof then !== 'function') return value;

	return new NativePromise((resolve, reject) => {
		Reflect.apply(then, value, [resolve, reject]);
	});
};

const wrapHandler = (NativePromise: PromiseConstructor, handler: unknown) => {
	if (typeof handler !== 'function') return handler;

	return function nativePromiseHandler(this: unknown, ...args: unknown[]) {
		return adoptIntoNativePromise(
			NativePromise,
			Reflect.apply(handler, this, args)
		);
	};
};

// A route value is a Response/Blob (served as-is), a handler, or a
// `{ GET: handler, POST: handler }` method map.
const wrapRoute = (NativePromise: PromiseConstructor, route: unknown) => {
	if (typeof route === 'function') return wrapHandler(NativePromise, route);
	if (!isRecord(route) || route instanceof Response || route instanceof Blob)
		return route;

	return Object.fromEntries(
		Object.entries(route).map(([method, handler]) => [
			method,
			wrapHandler(NativePromise, handler)
		])
	);
};

const wrapServeOptions = (
	NativePromise: PromiseConstructor,
	options: unknown
) => {
	if (!isRecord(options)) return options;
	const wrapped: Record<string, unknown> = { ...options };
	if (options.fetch)
		wrapped.fetch = wrapHandler(NativePromise, options.fetch);
	if (options.error)
		wrapped.error = wrapHandler(NativePromise, options.error);
	if (isRecord(options.routes))
		wrapped.routes = Object.fromEntries(
			Object.entries(options.routes).map(([path, route]) => [
				path,
				wrapRoute(NativePromise, route)
			])
		);

	return wrapped;
};

const wrapServerReload = (
	NativePromise: PromiseConstructor,
	server: unknown
) => {
	if (!isRecord(server)) return;
	const { reload } = server;
	if (typeof reload !== 'function') return;
	Reflect.set(server, 'reload', (options: unknown) =>
		Reflect.apply(reload, server, [
			wrapServeOptions(NativePromise, options)
		])
	);
};

const patchBunServe = (NativePromise: PromiseConstructor) => {
	const originalServe = Bun.serve;
	Reflect.set(Bun, 'serve', (options: unknown) => {
		const server: unknown = Reflect.apply(originalServe, Bun, [
			wrapServeOptions(NativePromise, options)
		]);
		wrapServerReload(NativePromise, server);

		return server;
	});
	// A dev server bound before prepare() ran (backend HMR re-evaluation)
	// keeps its socket; wrap the reload it will receive.
	wrapServerReload(NativePromise, globalThis.__absoluteBunServer);
};

let installation: Promise<void> | null = null;

const isPromiseConstructor = (value: unknown): value is PromiseConstructor =>
	typeof value === 'function';

const install = async () => {
	setAngularChangeDetection('zone');
	// zone.js keeps the native Promise under this symbol when the app
	// already imported it itself.
	const savedNative: unknown = Reflect.get(
		globalThis,
		'__zone_symbol__Promise'
	);
	const NativePromise = isPromiseConstructor(savedNative)
		? savedNative
		: globalThis.Promise;
	try {
		// Resolved from the app's node_modules at runtime (zone.js is an
		// optional peer), never bundled into the framework.
		await import(ZONE_NODE_SPECIFIER);
	} catch (error) {
		throw new Error(MISSING_ZONE_MESSAGE, { cause: error });
	}
	patchBunServe(NativePromise);
};

/** Load zone.js into the server process once, before the app listens. */
export const installAngularZoneRuntime = () => {
	installation ??= install();

	return installation;
};
