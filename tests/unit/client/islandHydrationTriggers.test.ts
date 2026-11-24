import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
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

import { startIslands } from '../../../src/client/islandRuntime';

/* `load`, `idle`, `visible` and `none` were the whole set. Two more, both
 * about not paying for a component nobody wants yet: `interaction`, for
 * something heavy until someone reaches for it, and `media`, for a widget
 * that belongs to one layout — where `visible` still pays the moment it
 * scrolls past on the layout that hides it. */

type MediaListener = (event: { matches: boolean }) => void;

let resolved: string[] = [];

const resolveComponent = async (framework: string, component: string) => {
	resolved.push(`${framework}:${component}`);

	/* The test is about WHETHER hydration starts. Resolving to nothing
	 * lets the runtime finish its attempt and mark the element, which is
	 * closer to a real miss than a promise that never settles. */
	return undefined;
};

/* Each test gets its own root. The runtime installs a MutationObserver
 * per root and keeps its bookkeeping on `globalThis`, so observers from
 * earlier tests stay alive for the file — watching `document.body` from
 * all of them meant the next test's island was scheduled twice, once by
 * its own start and once by a previous observer. */
let root: HTMLElement | undefined;

const island = (hydrate: string, media?: string) => {
	root = document.createElement('div');
	document.body.append(root);
	const element = document.createElement('div');
	element.setAttribute('data-island', 'true');
	element.setAttribute('data-component', 'Widget');
	element.setAttribute('data-framework', 'svelte');
	element.setAttribute('data-hydrate', hydrate);
	element.setAttribute('data-props', '{}');
	if (media !== undefined) element.setAttribute('data-hydrate-media', media);
	root.append(element);

	return element;
};

/* Scheduling is asynchronous — the runtime waits for a page root before
 * it walks the document — so every assertion needs a turn of the loop
 * first. A synchronous read sees nothing, including for `load`. */
const SCHEDULING_MS = 15;

const tick = () => new Promise((resolve) => setTimeout(resolve, SCHEDULING_MS));

const start = async () => {
	startIslands({ registry: {}, resolveComponent, root: root ?? document });
	await tick();
};

const stubMatchMedia = (matches: boolean) => {
	const listeners: MediaListener[] = [];
	Reflect.set(window, 'matchMedia', () => ({
		matches,
		addEventListener: (_name: string, listener: MediaListener) => {
			listeners.push(listener);
		},
		removeEventListener: (_name: string, listener: MediaListener) => {
			const index = listeners.indexOf(listener);
			if (index !== -1) listeners.splice(index, 1);
		}
	}));

	return listeners;
};

beforeEach(() => {
	resolved = [];
	document.body.innerHTML = '';
});

describe('hydrate on interaction', () => {
	test('does not hydrate before anyone touches it', async () => {
		island('interaction');
		await start();

		expect(resolved).toEqual([]);
	});

	test('hydrates on the first pointer press', async () => {
		const element = island('interaction');
		await start();
		element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await tick();

		expect(resolved).toEqual(['svelte:Widget']);
	});

	/* `focus` does not bubble, so a keyboard user landing on a control
	 * INSIDE the island would never trigger it. `focusin` does. */
	test('hydrates when focus lands inside it', async () => {
		const element = island('interaction');
		const input = document.createElement('input');
		element.append(input);
		await start();
		input.dispatchEvent(new Event('focusin', { bubbles: true }));
		await tick();

		expect(resolved).toEqual(['svelte:Widget']);
	});

	test('a second interaction does not hydrate it twice', async () => {
		const element = island('interaction');
		await start();
		element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await tick();
		element.dispatchEvent(new Event('keydown', { bubbles: true }));
		await tick();

		expect(resolved).toEqual(['svelte:Widget']);
	});
});

describe('hydrate on a media query', () => {
	test('hydrates immediately when the query already matches', async () => {
		stubMatchMedia(true);
		island('media', '(min-width: 48rem)');
		await start();

		expect(resolved).toEqual(['svelte:Widget']);
	});

	test('waits while the query does not match', async () => {
		stubMatchMedia(false);
		island('media', '(min-width: 48rem)');
		await start();

		expect(resolved).toEqual([]);
	});

	/* The listener is the difference between "hydrate if it matched at
	 * first paint" and the promise this actually makes: a window resized
	 * across a breakpoint, a phone rotated. */
	test('hydrates later when the query starts matching', async () => {
		const listeners = stubMatchMedia(false);
		island('media', '(min-width: 48rem)');
		await start();
		for (const listener of listeners) listener({ matches: true });
		await tick();

		expect(resolved).toEqual(['svelte:Widget']);
	});

	test('a change that still does not match leaves it alone', async () => {
		const listeners = stubMatchMedia(false);
		island('media', '(min-width: 48rem)');
		await start();
		for (const listener of listeners) listener({ matches: false });
		await tick();

		expect(resolved).toEqual([]);
	});

	/* An island that was swapped out by a navigation while its query did
	 * not match would otherwise be held alive by the listener for the
	 * life of the document. */
	test('a detached island stops listening', async () => {
		const listeners = stubMatchMedia(false);
		const element = island('media', '(min-width: 48rem)');
		await start();
		element.remove();
		for (const listener of [...listeners]) listener({ matches: true });
		await tick();

		expect(resolved).toEqual([]);
		expect(listeners).toHaveLength(0);
	});

	/* The safe direction: an island that works beats one that never
	 * appears. */
	test('no matchMedia at all hydrates immediately', async () => {
		Reflect.deleteProperty(window, 'matchMedia');
		island('media', '(min-width: 48rem)');
		await start();

		expect(resolved).toEqual(['svelte:Widget']);
	});

	test('a media island with no query hydrates immediately', async () => {
		stubMatchMedia(false);
		island('media');
		await start();

		expect(resolved).toEqual(['svelte:Widget']);
	});
});

describe('an unknown strategy', () => {
	/* It still hydrates — an island that works is the safe direction —
	 * but before this nothing said so, and `hydrate="vislble"` looked
	 * exactly like the strategy quietly not working. */
	test('hydrates immediately rather than never', async () => {
		island('vislble');
		await start();

		expect(resolved).toEqual(['svelte:Widget']);
	});
});
