import type { LazyRouteLoader } from '../../../types/svelteRouter';
import {
	type LazyComponent,
	readSeededLazy,
	toLazyComponent
} from './lazyModule';

/* Browser-side cache of lazy route components. A `<Route loader>` usually
 * passes an inline arrow, so a fresh function arrives with every Route
 * instance; the cache is keyed by the route pattern plus the loader's
 * source text instead, which is stable for the life of the bundle. A
 * route visited (or prefetched) once therefore renders synchronously the
 * next time it becomes active — no pending flash on revisits. */

const resolvedComponents = new Map<string, LazyComponent>();
const inflightLoads = new Map<string, Promise<LazyComponent>>();
const LAZY_SETTLE_TIMEOUT_MS = 3_000;

/** Forget a failed (or stale) load so the next attempt calls the loader
 *  again. */
export const forgetLazy = (key: string) => {
	resolvedComponents.delete(key);
	inflightLoads.delete(key);
};

export const hasPendingLazyLoads = () => inflightLoads.size > 0;

export const lazyCacheKey = (pattern: string, loader: LazyRouteLoader) =>
	`${pattern}\u0000${String(loader)}`;

/** Load (once) and cache the component behind `loader`. */
export const loadLazy = (key: string, loader: LazyRouteLoader) => {
	const cached = resolvedComponents.get(key);
	if (cached) return Promise.resolve(cached);
	const inflight = inflightLoads.get(key);
	if (inflight) return inflight;

	const load = loader()
		.then((value) => {
			const component = toLazyComponent(value);
			if (!component) {
				throw new Error(
					'A lazy <Route> loader must resolve to a Svelte component or to a module whose default export is one, e.g. `() => import("./Page.svelte")`.'
				);
			}
			resolvedComponents.set(key, component);

			return component;
		})
		.finally(() => {
			inflightLoads.delete(key);
		});
	inflightLoads.set(key, load);

	return load;
};

/** The component for `key` if it has already loaded — or, during the
 *  first hydration, the module the hydration entry loaded ahead of time
 *  for this route pattern. */
export const peekLazy = (key: string, pattern: string) => {
	const cached = resolvedComponents.get(key);
	if (cached) return cached;
	const seeded = readSeededLazy(pattern);
	if (seeded) resolvedComponents.set(key, seeded);

	return seeded;
};

/** Resolves once every lazy route load in flight has settled, or after a
 *  few seconds — scroll restoration waits on this so it doesn't restore a
 *  position into content that hasn't rendered yet. */
export const whenLazySettled = async () => {
	if (inflightLoads.size === 0) return;
	const settled = Promise.allSettled(Array.from(inflightLoads.values()));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, LAZY_SETTLE_TIMEOUT_MS);
	});
	await Promise.race([settled, timeout]);
	clearTimeout(timer);
};
