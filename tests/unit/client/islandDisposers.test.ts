import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;

GlobalRegistrator.register();

globalThis.fetch = nativeFetch;
globalThis.Request = nativeRequest;
globalThis.Response = nativeResponse;
globalThis.Headers = nativeHeaders;

afterAll(() => GlobalRegistrator.unregister());

import {
	disposeIslandsIn,
	registeredIslandCount,
	registerIslandDisposer
} from '../../../src/client/islandDisposers';

/* A soft navigation replaces `<body>`. Until this registry existed the old
 * page's islands were never unmounted — their roots, effects, timers and
 * listeners stayed alive attached to detached nodes, and every navigation
 * left another page's worth. The first listed limitation of navigation
 * phase 1. */

const STORE_KEY = Symbol.for('absolute.islandDisposers');

const island = (parent: Element) => {
	const element = document.createElement('div');
	element.dataset.island = 'true';
	parent.append(element);

	return element;
};

beforeEach(() => {
	document.body.replaceChildren();
	Reflect.set(globalThis, STORE_KEY, undefined);
});

afterEach(() => {
	Reflect.set(globalThis, STORE_KEY, undefined);
});

describe('unmounting islands with the markup that held them', () => {
	test('every island inside the replaced root is disposed', async () => {
		const unmounted: string[] = [];
		const first = island(document.body);
		const second = island(document.body);
		registerIslandDisposer(first, () => unmounted.push('first'));
		registerIslandDisposer(second, () => unmounted.push('second'));

		expect(registeredIslandCount()).toBe(2);
		expect(await disposeIslandsIn(document.body)).toBe(2);
		expect(unmounted.sort()).toEqual(['first', 'second']);
		// Disposed once and forgotten: a second navigation must not call a
		// disposer whose root is already gone.
		expect(registeredIslandCount()).toBe(0);
		expect(await disposeIslandsIn(document.body)).toBe(0);
	});

	test('an island nested deeper than the root is still found', async () => {
		let unmounted = false;
		const layout = document.createElement('section');
		document.body.append(layout);
		const nested = island(layout);
		registerIslandDisposer(nested, () => {
			unmounted = true;
		});

		await disposeIslandsIn(document.body);

		expect(unmounted).toBe(true);
	});

	test('an island outside the root is left mounted', async () => {
		/* The shape persistent layouts need (phase 5): a navbar island
		 * outside the swapped region keeps running across a navigation. */
		const persistent = document.createElement('header');
		document.documentElement.append(persistent);
		const kept = island(persistent);
		const swapped = island(document.body);
		let keptUnmounted = false;
		let swappedUnmounted = false;
		registerIslandDisposer(kept, () => {
			keptUnmounted = true;
		});
		registerIslandDisposer(swapped, () => {
			swappedUnmounted = true;
		});

		expect(await disposeIslandsIn(document.body)).toBe(1);
		expect(swappedUnmounted).toBe(true);
		expect(keptUnmounted).toBe(false);
		expect(registeredIslandCount()).toBe(1);
		persistent.remove();
	});

	test('an island its own framework already removed is pruned', async () => {
		/* The registry holds elements strongly, so an island removed by its
		 * host framework rather than by a navigation would be held here
		 * instead — one leak traded for a smaller one. Every pass drops
		 * entries whose element has left the document. */
		const detached = island(document.body);
		let unmounted = false;
		registerIslandDisposer(detached, () => {
			unmounted = true;
		});
		detached.remove();
		const other = document.createElement('aside');
		document.documentElement.append(other);

		expect(await disposeIslandsIn(other)).toBe(1);
		expect(unmounted).toBe(true);
		expect(registeredIslandCount()).toBe(0);
		other.remove();
	});

	test('re-registering the same element replaces its disposer', async () => {
		// A dev HMR remount creates a new root for the same element; the
		// stale disposer would unmount a root that is no longer there.
		const element = island(document.body);
		const calls: string[] = [];
		registerIslandDisposer(element, () => calls.push('old'));
		registerIslandDisposer(element, () => calls.push('new'));

		expect(registeredIslandCount()).toBe(1);
		await disposeIslandsIn(document.body);

		expect(calls).toEqual(['new']);
	});

	test('one failing disposer does not keep the others mounted', async () => {
		// Nor abort the navigation that asked for this.
		const failing = island(document.body);
		const working = island(document.body);
		let unmounted = false;
		registerIslandDisposer(failing, () => {
			throw new Error('unmount blew up');
		});
		registerIslandDisposer(working, () => {
			unmounted = true;
		});

		expect(await disposeIslandsIn(document.body)).toBe(2);
		expect(unmounted).toBe(true);
		expect(registeredIslandCount()).toBe(0);
	});

	test('an async disposer is awaited', async () => {
		// Svelte's `unmount` returns a promise, and the swap must not
		// replace the body while it is still running.
		const element = island(document.body);
		let finished = false;
		registerIslandDisposer(element, async () => {
			await Promise.resolve();
			finished = true;
		});

		await disposeIslandsIn(document.body);

		expect(finished).toBe(true);
	});
});

describe('the store is shared, not per bundle copy', () => {
	test('it lives on a Symbol.for key every copy resolves to', async () => {
		/* Each framework's client pass bundles its own copy of
		 * `@absolutejs/absolute/client`, so a module-level collection would
		 * be one store per copy: the React page's navigation layer would not
		 * see the Svelte island's disposer. This is the same pattern the
		 * island store snapshot and the streaming-slot registrar use. */
		const element = island(document.body);
		let unmounted = false;
		registerIslandDisposer(element, () => {
			unmounted = true;
		});
		const store: unknown = Reflect.get(globalThis, STORE_KEY);

		expect(store).toBeInstanceOf(Set);

		// What a second bundle copy of this module would do on first use:
		// find the store already there rather than create its own.
		await disposeIslandsIn(document.body);

		expect(unmounted).toBe(true);
		expect(Reflect.get(globalThis, STORE_KEY)).toBe(store);
	});
});
