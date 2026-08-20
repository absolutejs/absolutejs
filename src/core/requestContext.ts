import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';

type AbsoluteRequestStore = { request: Request };
type AbsoluteRequestStorage = AsyncLocalStorage<AbsoluteRequestStore>;

const REQUEST_STORAGE_KEY = Symbol.for('absolutejs.requestAsyncLocalStorage');

const isAbsoluteRequestStorage = (
	value: unknown
): value is AbsoluteRequestStorage =>
	typeof value === 'object' &&
	value !== null &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const getRequestStorage = () => {
	const value = Reflect.get(globalThis, REQUEST_STORAGE_KEY);

	return isAbsoluteRequestStorage(value) ? value : undefined;
};

const ensureRequestStorage = () => {
	const existing = getRequestStorage();
	if (existing) return existing;

	const storage = new AsyncLocalStorage<AbsoluteRequestStore>();
	Reflect.set(globalThis, REQUEST_STORAGE_KEY, storage);

	return storage;
};

export const absoluteRequestContext = new Elysia({
	name: 'absolutejs-request-context'
})
	.request(({ request }) => {
		ensureRequestStorage().enterWith({ request });
	})
	.as('global');
export const getCurrentAbsoluteRequest = () =>
	getRequestStorage()?.getStore()?.request;
export const runWithAbsoluteRequest = <Result>(
	request: Request,
	callback: () => Result
) => ensureRequestStorage().run({ request }, callback);
