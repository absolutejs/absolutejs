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

const createPatchedRouteMethod = (originalMethod: RouteMethod) =>
	function patchedRouteMethod(
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
			createPatchedRouteMethod(originalMethod)
		);
	});

	Reflect.set(globalThis, ROUTE_CALLSITE_PATCHED_KEY, true);
};
