import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';

type RouteCallsiteStore = { callsite?: string };
type RouteCallsiteStorage = AsyncLocalStorage<RouteCallsiteStore>;

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

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isAsyncLocalStorage = (value: unknown): value is RouteCallsiteStorage =>
	isObjectRecord(value) &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

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

const extractRouteRegistrationCallsite = (stack: string) => {
	const frames = stack
		.split('\n')
		.slice(1)
		.map((line) => line.trim());
	for (const frame of frames) {
		if (
			frame.includes('/node_modules/') ||
			frame.includes('/dist/') ||
			frame.includes('/src/core/devRouteRegistrationCallsite.')
		) {
			continue;
		}

		const locationMatch =
			frame.match(/\((\/[^)]+:\d+:\d+)\)$/) ??
			frame.match(/at (\/[^ ]+:\d+:\d+)$/);
		if (locationMatch?.[1]) {
			return normalizeCallsitePath(locationMatch[1]);
		}
	}

	return undefined;
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

	return function wrappedRouteHandler(this: unknown, ...args: unknown[]) {
		return storage.run({ callsite }, () =>
			Reflect.apply(
				handler as (...handlerArgs: unknown[]) => unknown,
				this,
				args
			)
		);
	};
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

	const prototype = Elysia.prototype as unknown as Record<string, unknown>;
	for (const methodName of ROUTE_METHOD_NAMES) {
		const originalMethod = prototype[methodName];
		if (typeof originalMethod !== 'function') {
			continue;
		}

		prototype[methodName] = function patchedRouteMethod(
			this: unknown,
			path: unknown,
			handler: unknown,
			...rest: unknown[]
		) {
			const callsite = captureRouteRegistrationCallsite();

			return Reflect.apply(originalMethod, this, [
				path,
				wrapRouteHandlerWithCallsite(handler, callsite),
				...rest
			]);
		};
	}

	Reflect.set(globalThis, ROUTE_CALLSITE_PATCHED_KEY, true);
};
