import type { StreamingSlot } from '../utils/streamingSlots';
import {
	setStreamingSlotCollectionController,
	setStreamingSlotRegistrar
} from './streamingSlotRegistrar';

type SlotStore = Map<string, StreamingSlot>;
type AsyncLocalStorageType =
	import('node:async_hooks').AsyncLocalStorage<SlotStore>;

const STREAMING_SLOT_STORAGE_KEY = Symbol.for(
	'absolutejs.streamingSlotAsyncLocalStorage'
);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isAsyncLocalStorage = (value: unknown): value is AsyncLocalStorageType =>
	isObjectRecord(value) &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const getStorageGlobal = () => {
	const value = Reflect.get(globalThis, STREAMING_SLOT_STORAGE_KEY);
	if (value === null || typeof value === 'undefined') {
		return value;
	}

	return isAsyncLocalStorage(value) ? value : undefined;
};

const isServerRuntime = () =>
	typeof process !== 'undefined' &&
	typeof process.versions?.node === 'string';

const ensureAsyncLocalStorage = async () => {
	const storage = getStorageGlobal();
	if (typeof storage !== 'undefined') {
		return storage;
	}
	if (!isServerRuntime()) {
		Reflect.set(globalThis, STREAMING_SLOT_STORAGE_KEY, null);

		return getStorageGlobal();
	}

	const mod = await import('node:async_hooks');
	Reflect.set(
		globalThis,
		STREAMING_SLOT_STORAGE_KEY,
		new mod.AsyncLocalStorage<SlotStore>()
	);

	return getStorageGlobal();
};

const getActiveSlotStore = () => {
	const storage = getStorageGlobal();
	if (!storage) return undefined;

	return storage.getStore();
};

const registerStreamingSlot = (slot: StreamingSlot) => {
	const store = getActiveSlotStore();
	if (!store) return;
	store.set(slot.id, slot);
};

setStreamingSlotRegistrar(registerStreamingSlot);
setStreamingSlotCollectionController({
	isCollecting: () => getActiveSlotStore() !== undefined
});

export const hasActiveStreamingSlotRegistry = () =>
	getActiveSlotStore() !== undefined;

export const runWithStreamingSlotRegistry = async <T>(
	task: () => Promise<T> | T
) => {
	const storage = await ensureAsyncLocalStorage();
	if (!storage) {
		const slots: StreamingSlot[] = [];

		return {
			result: await task(),
			slots
		};
	}

	return storage.run(new Map<string, StreamingSlot>(), async () => {
		const result = await task();
		const store = storage.getStore();

		return {
			result,
			slots: store ? [...store.values()] : []
		};
	});
};
