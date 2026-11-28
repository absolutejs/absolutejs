import { describe, expect, test } from 'bun:test';
import { createResource } from '../../../src/client/resource';
import { useResource as svelteResource } from '../../../src/svelte/resource';
import type { ResourceState } from '../../../types/resource';

/* A component-scoped async value: what React's and Svelte's
 * `useResource` are both made of. */

type Deferred<Value> = {
	promise: Promise<Value>;
	reject: (reason: unknown) => void;
	resolve: (value: Value) => void;
	signal: AbortSignal;
};

/* A fetcher whose every call is answered by hand, in any order. */
const manual = <Value>() => {
	const calls: Deferred<Value>[] = [];
	const fetcher = (signal: AbortSignal) => {
		const { promise, reject, resolve } = Promise.withResolvers<Value>();
		calls.push({ promise, reject, resolve, signal });

		return promise;
	};

	return { calls, fetcher };
};

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('when the first load happens', () => {
	test('immediate: on mount, and loading from the start', async () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher);

		expect(resource.snapshot()).toEqual({
			data: null,
			error: null,
			loading: true
		});
		expect(calls).toHaveLength(0);
		resource.mount();
		expect(calls).toHaveLength(1);
		calls[0]?.resolve('loaded');
		await turn();

		expect(resource.snapshot()).toEqual({
			data: 'loaded',
			error: null,
			loading: false
		});
	});

	test('pending: not until refresh, and loading all the same', () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher, 'pending');
		resource.mount();

		expect(calls).toHaveLength(0);
		expect(resource.snapshot().loading).toBe(true);
	});

	test('idle: not until asked, and not loading', () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher, 'idle');
		resource.mount();

		expect(calls).toHaveLength(0);
		expect(resource.snapshot().loading).toBe(false);
	});

	test('mounting twice loads once', () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher);
		resource.mount();
		resource.mount();

		expect(calls).toHaveLength(1);
	});
});

describe('a load', () => {
	test('that fails leaves the reason, and the value as it was', async () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher, 'idle');
		resource.mutate('kept');
		void resource.refresh();
		calls[0]?.reject(new Error('down'));
		await turn();

		const { data, error, loading } = resource.snapshot();
		expect(data).toBe('kept');
		expect(error).toEqual(new Error('down'));
		expect(loading).toBe(false);
	});

	/* The later call is what the component asked for last. */
	test('that was overtaken by another says nothing, whatever it answers', async () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher, 'idle');
		void resource.refresh();
		void resource.refresh();

		expect(calls[0]?.signal.aborted).toBe(true);
		calls[1]?.resolve('second');
		await turn();
		calls[0]?.resolve('first, late');
		await turn();

		expect(resource.snapshot().data).toBe('second');

		void resource.refresh();
		void resource.refresh();
		calls[2]?.reject(new Error('late failure'));
		await turn();

		expect(resource.snapshot().error).toBeNull();
		expect(resource.snapshot().loading).toBe(true);
	});

	test('is stopped when the component goes away, and its answer dropped', async () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher);
		resource.mount();
		resource.unmount();

		expect(calls[0]?.signal.aborted).toBe(true);
		calls[0]?.resolve('too late');
		await turn();

		expect(resource.snapshot().data).toBeNull();
	});

	/* React's strict mode mounts, unmounts and mounts again. */
	test('happens again when the component is mounted again', () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher);
		resource.mount();
		resource.unmount();
		resource.mount();

		expect(calls).toHaveLength(2);
		expect(calls[1]?.signal.aborted).toBe(false);
	});
});

describe('mutate', () => {
	test('sets the value, or works it out from the one there', () => {
		const resource = createResource<number>(async () => 0, 'idle');
		resource.mutate(2);
		resource.mutate((previous) => (previous ?? 0) + 3);

		expect(resource.snapshot()).toEqual({
			data: 5,
			error: null,
			loading: false
		});
	});

	test('stops a load in flight, so a slower answer cannot overwrite it', async () => {
		const { calls, fetcher } = manual<string>();
		const resource = createResource(fetcher);
		resource.mount();
		resource.mutate('edited');
		calls[0]?.resolve('stale');
		await turn();

		expect(resource.snapshot()).toEqual({
			data: 'edited',
			error: null,
			loading: false
		});
	});
});

describe('a subscriber', () => {
	test('is told of each change, until it leaves', async () => {
		const resource = createResource<string>(async () => 'x', 'idle');
		let told = 0;
		const leave = resource.subscribe(() => {
			told += 1;
		});
		resource.mutate('a');
		leave();
		resource.mutate('b');

		expect(told).toBe(1);
	});
});

/* The Svelte store, on the server: read once, with nothing loaded.
 * (In the browser it loads on the first subscriber; this process has
 * no `window`.) */
describe('the Svelte store, where there is no browser', () => {
	test('gives the starting state and does not load', () => {
		const { calls, fetcher } = manual<string>();
		const store = svelteResource(fetcher);
		const seen: ResourceState<string>[] = [];
		const leave = store.subscribe((state) => seen.push(state));
		leave();

		expect(seen).toEqual([{ data: null, error: null, loading: true }]);
		expect(calls).toHaveLength(0);
	});

	test('still follows a change made by hand', () => {
		const store = svelteResource<string>(async () => 'x', {
			start: 'idle'
		});
		const seen: (string | null)[] = [];
		const leave = store.subscribe((state) => seen.push(state.data));
		store.mutate('edited');
		leave();
		store.mutate('unseen');

		expect(seen).toEqual([null, 'edited']);
	});
});
