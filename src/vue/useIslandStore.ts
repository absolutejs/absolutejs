import { customRef, onBeforeUnmount } from 'vue';
import type { StoreApi } from 'zustand/vanilla';
import {
	readIslandStore,
	subscribeIslandStore,
	type IslandStoreState
} from '../client/islandStore';

export const useIslandStore = <TState extends IslandStoreState, TSelected>(
	store: StoreApi<TState>,
	selector: (state: TState) => TSelected
) => {
	let current = readIslandStore(store, selector);
	let unsubscribe: (() => void) | undefined;

	const state = customRef<TSelected>((track, trigger) => {
		unsubscribe = subscribeIslandStore(store, selector, (value) => {
			current = value;
			trigger();
		});

		return {
			get() {
				track();

				return current;
			},
			set() {}
		};
	});

	onBeforeUnmount(() => {
		unsubscribe?.();
	});

	return state;
};
