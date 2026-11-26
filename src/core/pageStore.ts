import type { PageStore, PageStoreOptions } from '../../types/pageStore';

/* The page store an app registered, for `prepare()` to find.
 *
 * Registered in code and not named in `absolute.config.ts`, because a
 * production server never reads that file: it reads what the build wrote
 * down from it, and a store is functions, which cannot be written down.
 * `registerHealthCheck` and `onServerError` are registered the same way
 * for the same reason. */

const PAGE_STORE_KEY = Symbol.for('absolutejs.pageStore');

type Registered = { options: PageStoreOptions; store: PageStore };

const isRegistered = (value: unknown): value is Registered =>
	typeof value === 'object' &&
	value !== null &&
	'store' in value &&
	typeof value.store === 'object' &&
	value.store !== null &&
	'options' in value;

/** @internal The store `registerPageStore` was given, if any. */
export const currentPageStore = () => {
	const value: unknown = Reflect.get(globalThis, PAGE_STORE_KEY);

	return isRegistered(value) ? value : undefined;
};

/** Keeps pre-rendered pages in step across machines that do not share
 *  a disk, through a store they can all reach.
 *
 *      registerPageStore(myStore);
 *      const { absolutejs } = await prepare();
 *
 *  Call it BEFORE `prepare()`, which is what starts the copying. Each
 *  machine goes on serving from its own files; a page one of them
 *  re-renders, creates or takes down is written to the store, and the
 *  others pull it within `options.interval` (5 seconds by default). A
 *  machine starting up pulls first, so it is never behind the rest.
 *
 *  Pass `undefined` to stop using one. */
export const registerPageStore = (
	store: PageStore | undefined,
	options: PageStoreOptions = {}
) => {
	if (store === undefined) {
		Reflect.deleteProperty(globalThis, PAGE_STORE_KEY);

		return;
	}
	const registered: Registered = { options, store };
	Reflect.set(globalThis, PAGE_STORE_KEY, registered);
};
