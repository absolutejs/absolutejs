import type { StoreApi } from 'zustand/vanilla';
import {
	readIslandStore,
	subscribeIslandStore,
	type IslandStoreState
} from '../client/islandStore';

export const useIslandStore = <TState extends IslandStoreState, TSelected>(
	store: StoreApi<TState>,
	selector: (state: TState) => TSelected
) => ({
	subscribe(listener: (value: TSelected) => void) {
		listener(readIslandStore(store, selector));

		return subscribeIslandStore(store, selector, listener);
	}
});
