import { afterEach, describe, expect, test } from 'bun:test';
import {
	getPrefetchRuntime,
	registerPrefetchRuntime,
	requestPrefetch,
	requestSpeculation,
	type PrefetchRuntime
} from '../../../src/utils/prefetchRef';

/* The import-free indirection that lets an Angular component reach the
 * prefetch runtime. A component in `src/angular/components` is
 * partial-compiled in a workspace holding that directory alone, so it
 * cannot import `src/client/prefetch`; this module is copied in beside it
 * instead (scripts/build.ts). */

const RUNTIME_KEY = Symbol.for('absolutejs.prefetchRuntime');

type Calls = { prefetched: string[]; speculated: string[] };

const install = (calls: Calls, overrides: Partial<PrefetchRuntime> = {}) => {
	Reflect.set(globalThis, RUNTIME_KEY, undefined);
	registerPrefetchRuntime({
		canPrefetch: () => true,
		isPrefetchableHref: (href) => href.startsWith('/'),
		prefetch: (url) => calls.prefetched.push(url),
		resolveDefaultPrefetchMode: () => 'viewport',
		speculate: (url) => calls.speculated.push(url),
		...overrides
	});
};

afterEach(() => {
	Reflect.set(globalThis, RUNTIME_KEY, undefined);
});

describe('with no runtime on the page', () => {
	test('every call is a no-op rather than a failure', () => {
		Reflect.set(globalThis, RUNTIME_KEY, undefined);

		// A page that ships no client runtime has nothing to prefetch
		// into, and a link that still works is the right outcome.
		expect(getPrefetchRuntime()).toBeUndefined();
		expect(requestPrefetch('/pricing')).toBe(false);
		expect(requestSpeculation('/pricing')).toBe(false);
	});

	test('a half-shaped runtime is not accepted', () => {
		// Guards against a stale or foreign value on the shared key.
		Reflect.set(globalThis, RUNTIME_KEY, { prefetch: () => undefined });

		expect(getPrefetchRuntime()).toBeUndefined();
		expect(requestPrefetch('/pricing')).toBe(false);
	});
});

describe('with the runtime registered', () => {
	test('a prefetchable href is passed through', () => {
		const calls: Calls = { prefetched: [], speculated: [] };
		install(calls);

		expect(requestPrefetch('/pricing', 'route')).toBe(true);
		expect(calls.prefetched).toEqual(['/pricing']);
	});

	test('the runtime decides what is prefetchable', () => {
		const calls: Calls = { prefetched: [], speculated: [] };
		install(calls);

		// `isPrefetchableHref` here rejects anything not starting with `/`,
		// standing in for the real one's cross-origin and scheme checks.
		expect(requestPrefetch('https://example.test/pricing')).toBe(false);
		expect(calls.prefetched).toEqual([]);
	});

	test('and whether prefetching is allowed at all', () => {
		// Save-Data, a 2g connection, `prefers-reduced-data`, or the page
		// opting out with `__ABSOLUTE_PREFETCH__ = false`.
		const calls: Calls = { prefetched: [], speculated: [] };
		install(calls, { canPrefetch: () => false });

		expect(requestPrefetch('/pricing')).toBe(false);
		expect(requestSpeculation('/pricing')).toBe(false);
		expect(calls.prefetched).toEqual([]);
	});

	test('speculation goes through the same guards', () => {
		const calls: Calls = { prefetched: [], speculated: [] };
		install(calls);

		expect(requestSpeculation('/pricing')).toBe(true);
		expect(calls.speculated).toEqual(['/pricing']);
	});

	test('the first registration wins', () => {
		/* Each framework's client pass bundles its own copy of the prefetch
		 * module, so several copies may try to register. They share one
		 * store either way, so the first is as good as any — what matters
		 * is not swapping the runtime under a link that already read it. */
		const first: Calls = { prefetched: [], speculated: [] };
		const second: Calls = { prefetched: [], speculated: [] };
		install(first);
		registerPrefetchRuntime({
			canPrefetch: () => true,
			isPrefetchableHref: () => true,
			prefetch: (url) => second.prefetched.push(url),
			resolveDefaultPrefetchMode: () => 'hover',
			speculate: (url) => second.speculated.push(url)
		});

		expect(requestPrefetch('/pricing')).toBe(true);
		expect(first.prefetched).toEqual(['/pricing']);
		expect(second.prefetched).toEqual([]);
	});
});

describe('the real prefetch module registers itself', () => {
	test('loading it makes the indirection live', async () => {
		/* The link directive only works because importing
		 * `src/client/prefetch` — which `enableNavigation()` does — leaves
		 * a runtime on the shared key. */
		Reflect.set(globalThis, RUNTIME_KEY, undefined);
		const built = await Bun.build({
			entrypoints: ['src/client/prefetch.ts'],
			format: 'cjs',
			target: 'browser',
			throw: false
		});

		expect(built.success).toBe(true);

		const code = (await built.outputs[0]?.text()) ?? '';
		const module: { exports: unknown } = { exports: {} };
		new Function('module', 'exports', code)(module, module.exports);

		expect(getPrefetchRuntime()).toBeDefined();
	});
});
