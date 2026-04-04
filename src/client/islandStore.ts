import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla';
import { combine } from 'zustand/middleware';

export type IslandStoreState = object;
type IslandStoreSnapshot = Record<string, unknown>;
type IslandStoreShape<
	TState extends IslandStoreState,
	TActions extends object
> = Omit<TState, keyof TActions> & TActions;
export type IslandStateSnapshot = Record<string, IslandStoreSnapshot>;
type AnyIslandStore = StoreApi<object>;
type IslandStoreInstance = {
	applyExternalSnapshot: (snapshot: IslandStoreSnapshot) => void;
	store: AnyIslandStore;
};

const ABSOLUTE_ISLAND_STATE = '__ABS_ISLAND_STATE__';
const ABSOLUTE_ISLAND_STORES = '__ABS_ISLAND_STORES__';

declare global {
	var __ABS_ISLAND_STATE__: IslandStateSnapshot | undefined;
	var __ABS_ISLAND_STORES__:
		| Map<string, Set<IslandStoreInstance>>
		| undefined;
}

const getIslandStoreSnapshot = () => {
	globalThis.__ABS_ISLAND_STATE__ ??= {};

	return globalThis.__ABS_ISLAND_STATE__;
};

const getIslandStores = () => {
	globalThis.__ABS_ISLAND_STORES__ ??= new Map();

	return globalThis.__ABS_ISLAND_STORES__;
};

const isSerializableValue = (value: unknown) =>
	typeof value !== 'function' && value !== undefined;

const toSerializableState = <T extends object>(state: T) =>
	Object.fromEntries(
		Object.entries(state).filter(([, value]) => isSerializableValue(value))
	);

const applySnapshot = <T extends object>(
	store: StoreApi<T>,
	snapshot: IslandStoreSnapshot | undefined
) => {
	if (!snapshot) {
		return;
	}

	store.setState({
		...store.getState(),
		...snapshot
	});
};

const getPeerStores = (
	storeInstances: Set<IslandStoreInstance>,
	ownerStore: AnyIslandStore
) => [...storeInstances].filter((peer) => peer.store !== ownerStore);

const syncIslandSnapshot = <
	TState extends IslandStoreState,
	TActions extends object
>(
	storeId: string,
	state: IslandStoreShape<TState, TActions>,
	storeInstances: Set<IslandStoreInstance>,
	ownerStore: AnyIslandStore
) => {
	const nextSnapshot = toSerializableState(state);
	getIslandStoreSnapshot()[storeId] = nextSnapshot;

	for (const peerStore of getPeerStores(storeInstances, ownerStore)) {
		peerStore.applyExternalSnapshot(nextSnapshot);
	}
};

export const createIslandStore = <
	TState extends IslandStoreState,
	TActions extends object
>(
	storeId: string,
	initialState: TState,
	createState: StateCreator<TState, [], [], TActions>
) => {
	const store = createStore(combine(initialState, createState));
	const stores = getIslandStores();
	const storeInstances =
		stores.get(storeId) ?? new Set<IslandStoreInstance>();
	const initialSnapshot = getIslandStoreSnapshot()[storeId];
	applySnapshot(store, initialSnapshot);
	let isApplyingExternalSnapshot = false;

	const applyExternalSnapshot = (snapshot: IslandStoreSnapshot) => {
		isApplyingExternalSnapshot = true;
		applySnapshot(store, snapshot);
	};

	storeInstances.add({
		applyExternalSnapshot,
		store
	});
	stores.set(storeId, storeInstances);

	syncIslandSnapshot(storeId, store.getState(), storeInstances, store);
	store.subscribe((state) => {
		if (isApplyingExternalSnapshot) {
			isApplyingExternalSnapshot = false;

			return;
		}

		syncIslandSnapshot(storeId, state, storeInstances, store);
	});

	return store;
};
export const getIslandStoreServerSnapshot = <
	TState extends IslandStoreState,
	TSelected
>(
	store: StoreApi<TState>,
	selector: (state: TState) => TSelected
) => selector(store.getInitialState());
const applySnapshotToStoreInstances = (
	storeId: string,
	instances: Set<IslandStoreInstance>,
	snapshot: IslandStateSnapshot
) => {
	for (const instance of instances) {
		instance.applyExternalSnapshot(snapshot[storeId] ?? {});
	}
};

export const initializeIslandStores = (state: IslandStateSnapshot) => {
	const currentSnapshot = getIslandStoreSnapshot();
	const nextSnapshot: IslandStateSnapshot = {
		...state,
		...currentSnapshot
	};

	globalThis.__ABS_ISLAND_STATE__ = nextSnapshot;

	for (const [storeId, store] of getIslandStores()) {
		applySnapshotToStoreInstances(storeId, store, nextSnapshot);
	}
};
export const readIslandStore = <TState extends IslandStoreState, TSelected>(
	store: StoreApi<TState>,
	selector: (state: TState) => TSelected
) => selector(store.getState());
export const resetIslandStoreForTesting = () => {
	delete globalThis.__ABS_ISLAND_STATE__;
	delete globalThis.__ABS_ISLAND_STORES__;
};
export const subscribeIslandStore = <
	TState extends IslandStoreState,
	TSelected
>(
	store: StoreApi<TState>,
	selector: (state: TState) => TSelected,
	listener: (value: TSelected) => void
) => {
	let currentSelection = selector(store.getState());

	return store.subscribe((state) => {
		const nextSelection = selector(state);
		if (Object.is(nextSelection, currentSelection)) {
			return;
		}

		currentSelection = nextSelection;
		listener(nextSelection);
	});
};

export { ABSOLUTE_ISLAND_STATE, ABSOLUTE_ISLAND_STORES };
