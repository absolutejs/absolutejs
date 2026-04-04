import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	createIslandStore,
	initializeIslandStores,
	readIslandStore,
	resetIslandStoreForTesting,
	subscribeIslandStore
} from '../../../src/client/islandStore';

beforeEach(() => {
	resetIslandStoreForTesting();
});

afterEach(() => {
	resetIslandStoreForTesting();
});

describe('island stores', () => {
	test('creates a zustand-style store with state and actions', () => {
		const counterStore = createIslandStore(
			'counter',
			{
				count: 0
			},
			(set) => ({
				increment: () =>
					set((state) => ({
						count: Number(state.count) + 1
					}))
			})
		);

		counterStore.getState().increment();

		expect(counterStore.getState().count).toBe(1);
	});

	test('hydrates store state from SSR snapshot', () => {
		initializeIslandStores({
			counter: {
				count: 3
			}
		});

		const counterStore = createIslandStore(
			'counter',
			{
				count: 0
			},
			() => ({
				increment: () => {}
			})
		);

		expect(counterStore.getState().count).toBe(3);
	});

	test('preserves client-created store state when SSR initializes later', () => {
		const counterStore = createIslandStore(
			'counter',
			{
				count: 0
			},
			(set) => ({
				increment: () =>
					set((state) => ({
						count: Number(state.count) + 1
					}))
			})
		);

		counterStore.getState().increment();
		counterStore.getState().increment();

		initializeIslandStores({
			counter: {
				count: 1
			}
		});

		expect(counterStore.getState().count).toBe(2);
	});

	test('subscribes to selected store state', () => {
		const counterStore = createIslandStore(
			'counter',
			{
				count: 0,
				label: 'counter'
			},
			(set) => ({
				increment: () =>
					set((state) => ({
						count: Number(state.count) + 1
					}))
			})
		);
		let calls = 0;

		const unsubscribe = subscribeIslandStore(
			counterStore,
			(state) => state.count,
			() => {
				calls += 1;
			}
		);

		counterStore.setState({
			...counterStore.getState(),
			label: 'renamed'
		});
		counterStore.getState().increment();
		counterStore.getState().increment();
		unsubscribe();
		counterStore.getState().increment();

		expect(calls).toBe(2);
	});

	test('reads selected store state', () => {
		const counterStore = createIslandStore(
			'counter',
			{
				count: 7
			},
			() => ({
				increment: () => {}
			})
		);

		expect(readIslandStore(counterStore, (state) => state.count)).toBe(7);
	});
});
