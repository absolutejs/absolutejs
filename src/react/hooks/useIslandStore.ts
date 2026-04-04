import { useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import {
	getIslandStoreServerSnapshot,
	readIslandStore,
	subscribeIslandStore,
	type IslandStoreState
} from '../../client/islandStore';

export const useIslandStore = <TState extends IslandStoreState, TSelected>(
	store: StoreApi<TState>,
	selector: (state: TState) => TSelected
) =>
	useSyncExternalStore(
		(listener) =>
			subscribeIslandStore(store, selector, () => {
				listener();
			}),
		() => readIslandStore(store, selector),
		() => getIslandStoreServerSnapshot(store, selector)
	);
