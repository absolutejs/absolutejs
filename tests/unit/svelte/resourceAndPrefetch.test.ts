import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { ResourceState } from '../../../types/resource';

/* The two Svelte primitives that only do anything in a browser: the
 * resource store loads on its first subscriber, and the prefetch action
 * listens on an element. */

beforeAll(() =>
	GlobalRegistrator.register({ url: 'http://localhost:3000/home' })
);
afterAll(() => GlobalRegistrator.unregister());

const { useResource } = await import('../../../src/svelte/resource');
const { usePrefetch } = await import('../../../src/svelte/prefetch');
const { hasPrefetched, resetPrefetchState } =
	await import('../../../src/client/prefetch');

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	resetPrefetchState();
	document.body.innerHTML = '';
});

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the store loads when something first subscribes, and tells it', async () => {
	let loads = 0;
	const store = useResource(async () => {
		loads += 1;

		return 'loaded';
	});
	expect(loads).toBe(0);

	const seen: ResourceState<string>[] = [];
	const leave = store.subscribe((state) => seen.push(state));
	const also = store.subscribe(() => undefined);
	await turn();
	leave();
	also();

	expect(loads).toBe(1);
	expect(seen[0]).toEqual({ data: null, error: null, loading: true });
	expect(seen.at(-1)).toEqual({
		data: 'loaded',
		error: null,
		loading: false
	});
});

test('the store’s load is stopped when its last subscriber leaves', async () => {
	const signals: AbortSignal[] = [];
	const store = useResource(
		(signal) =>
			new Promise<string>(() => {
				signals.push(signal);
			})
	);
	const first = store.subscribe(() => undefined);
	const second = store.subscribe(() => undefined);
	first();

	expect(signals[0]?.aborted).toBe(false);
	second();
	expect(signals[0]?.aborted).toBe(true);
});

/* A prefetch asks for the document; answering it is all a test needs. */
const answerFetches = () => {
	const stub = async () => new Response('<html></html>');
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});
};

const link = (href?: string) => {
	const anchor = document.createElement(href === undefined ? 'button' : 'a');
	if (href !== undefined) anchor.setAttribute('href', href);
	document.body.append(anchor);

	return anchor;
};

test('the action prefetches the element’s href on pointerdown', () => {
	answerFetches();
	const anchor = link('/pricing');
	const action = usePrefetch({ kind: 'document', mode: 'hover' })(anchor);
	expect(hasPrefetched('/pricing')).toBe(false);
	anchor.dispatchEvent(new Event('pointerdown'));

	expect(hasPrefetched('/pricing')).toBe(true);
	action.destroy();
});

test('the action takes its address from the parameter, and follows it', () => {
	answerFetches();
	const button = link();
	const action = usePrefetch({ kind: 'document', mode: 'hover' })(
		button,
		'/checkout'
	);
	button.dispatchEvent(new Event('pointerdown'));
	action.update('/cart');
	button.dispatchEvent(new Event('pointerdown'));

	expect(hasPrefetched('/checkout')).toBe(true);
	expect(hasPrefetched('/cart')).toBe(true);
	action.destroy();
});

test('the action does nothing once destroyed, for mode none, or for another site', () => {
	answerFetches();
	const gone = link('/gone');
	usePrefetch({ kind: 'document', mode: 'hover' })(gone).destroy();
	gone.dispatchEvent(new Event('pointerdown'));

	const off = link('/off');
	usePrefetch({ kind: 'document', mode: 'none' })(off);
	off.dispatchEvent(new Event('pointerdown'));

	const elsewhere = link('https://example.com/away');
	usePrefetch({ kind: 'document', mode: 'hover' })(elsewhere);
	elsewhere.dispatchEvent(new Event('pointerdown'));

	expect(hasPrefetched('/gone')).toBe(false);
	expect(hasPrefetched('/off')).toBe(false);
	expect(hasPrefetched('https://example.com/away')).toBe(false);
});
