import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { StoreApi } from 'zustand/vanilla';
import {
	readIslandStore,
	subscribeIslandStore,
	type IslandStoreState
} from '../client/islandStore';

class IslandStoreImpl {
	get<TState extends IslandStoreState, TSelected>(
		store: StoreApi<TState>,
		selector: (state: TState) => TSelected
	) {
		return readIslandStore(store, selector);
	}

	select<TState extends IslandStoreState, TSelected>(
		store: StoreApi<TState>,
		selector: (state: TState) => TSelected
	) {
		return new Observable<TSelected>((subscriber) => {
			subscriber.next(readIslandStore(store, selector));

			return subscribeIslandStore(store, selector, (value) => {
				subscriber.next(value);
			});
		});
	}
}

Injectable({
	providedIn: 'root'
})(IslandStoreImpl);

export const IslandStore = IslandStoreImpl;
