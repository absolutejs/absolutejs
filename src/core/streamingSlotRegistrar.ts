import type { StreamingSlot } from '../utils/streamingSlots';

type StreamingSlotRegistrar = (slot: StreamingSlot) => void;
type StreamingSlotWarningController = {
	maybeWarn(primitiveName: string): void;
};
type StreamingSlotCollectionController = {
	isCollecting(): boolean;
};

const STREAMING_SLOT_REGISTRAR_KEY = Symbol.for(
	'absolutejs.streamingSlotRegistrar'
);
const STREAMING_SLOT_WARNING_STORAGE_KEY = Symbol.for(
	'absolutejs.streamingSlotWarningController'
);
const STREAMING_SLOT_COLLECTION_STORAGE_KEY = Symbol.for(
	'absolutejs.streamingSlotCollectionController'
);

const getRegisteredStreamingSlotRegistrar = () => {
	const value = Reflect.get(globalThis, STREAMING_SLOT_REGISTRAR_KEY);
	if (typeof value === 'function' || value === null) {
		return value;
	}

	return undefined;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isStreamingSlotWarningController = (
	value: unknown
): value is StreamingSlotWarningController =>
	isObjectRecord(value) &&
	'maybeWarn' in value &&
	typeof value.maybeWarn === 'function';

const isStreamingSlotCollectionController = (
	value: unknown
): value is StreamingSlotCollectionController =>
	isObjectRecord(value) &&
	'isCollecting' in value &&
	typeof value.isCollecting === 'function';

const getWarningController = () => {
	const value = Reflect.get(globalThis, STREAMING_SLOT_WARNING_STORAGE_KEY);
	if (value === null || typeof value === 'undefined') return undefined;

	return isStreamingSlotWarningController(value) ? value : undefined;
};

const getCollectionController = () => {
	const value = Reflect.get(
		globalThis,
		STREAMING_SLOT_COLLECTION_STORAGE_KEY
	);
	if (value === null || typeof value === 'undefined') return undefined;

	return isStreamingSlotCollectionController(value) ? value : undefined;
};

export const hasRegisteredStreamingSlotRegistrar = () =>
	typeof getRegisteredStreamingSlotRegistrar() === 'function';
export const isStreamingSlotCollectionActive = () =>
	getCollectionController()?.isCollecting() === true;
export const registerStreamingSlot = (slot: StreamingSlot) => {
	getRegisteredStreamingSlotRegistrar()?.(slot);
};
export const setStreamingSlotCollectionController = (
	controller: StreamingSlotCollectionController | null
) => {
	Reflect.set(globalThis, STREAMING_SLOT_COLLECTION_STORAGE_KEY, controller);
};
export const setStreamingSlotRegistrar = (
	nextRegistrar: StreamingSlotRegistrar | null
) => {
	Reflect.set(globalThis, STREAMING_SLOT_REGISTRAR_KEY, nextRegistrar);
};
export const setStreamingSlotWarningController = (
	controller: StreamingSlotWarningController | null
) => {
	Reflect.set(globalThis, STREAMING_SLOT_WARNING_STORAGE_KEY, controller);
};
export const warnMissingStreamingSlotCollector = (primitiveName: string) => {
	if (
		process.env.NODE_ENV === 'production' ||
		isStreamingSlotCollectionActive()
	) {
		return;
	}

	getWarningController()?.maybeWarn(primitiveName);
};
