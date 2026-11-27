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
/* What a slot written with no `resolve` is registered with
 * (`unresolvedSlot`, below) is marked, so that a page about to be sent
 * with one still in it can say so in the log: a slot that fails is
 * otherwise silent. */
const UNRESOLVED_SLOT = Symbol.for('absolutejs.unresolvedSlot');

export const isUnresolvedSlot = (slot: StreamingSlot) =>
	Reflect.get(slot.resolve, UNRESOLVED_SLOT) === true;
/* The request a slot was rendered for. Read through the shared storage's
 * global key (the one absoluteRequestContext enters on each request) so
 * this module, which components import, does not pull in Elysia. */
const REQUEST_STORAGE_KEY = Symbol.for('absolutejs.requestAsyncLocalStorage');

type RequestStorage = {
	getStore: () => unknown;
	run: <Result>(store: unknown, callback: () => Result) => Result;
};

const isRequestStorage = (value: unknown): value is RequestStorage =>
	isObjectRecord(value) &&
	typeof value.getStore === 'function' &&
	typeof value.run === 'function';

const getRequestStorage = () => {
	const value = Reflect.get(globalThis, REQUEST_STORAGE_KEY);

	return isRequestStorage(value) ? value : undefined;
};

/* A slot resolves while the response streams, after the request handler
 * has returned, where its request's context may already be gone. Each slot
 * keeps the context it was rendered in and resolves inside it, so code it
 * calls (getCurrentAbsoluteRequest, an in-process API client forwarding
 * the visitor's cookies) sees the request the slot belongs to. */
const resolveInRenderContext = (slot: StreamingSlot) => {
	const storage = getRequestStorage();
	const store = storage?.getStore();
	if (!storage || store === undefined) return slot;

	const resolve = () => storage.run(store, slot.resolve);
	if (isUnresolvedSlot(slot)) Reflect.set(resolve, UNRESOLVED_SLOT, true);

	return { ...slot, resolve };
};

export const registerStreamingSlot = (slot: StreamingSlot) => {
	getRegisteredStreamingSlotRegistrar()?.(resolveInRenderContext(slot));
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
/** A slot whose resolver runs in the context of the request being
 *  rendered now, as one registered from a component does. */
export const slotInRenderContext = (slot: StreamingSlot) =>
	resolveInRenderContext(slot);
/* A slot written with no `resolve` is the placeholder for a hole its
 * route declares (core/routeHoles.ts), and the route's resolver takes
 * this one's place before anything runs it. Reached only when the route
 * declared nothing for the id — and then it fails as a resolver that
 * threw does, and the slot shows its `errorHtml`. */
export const unresolvedSlot = (id: string) => {
	const resolve = () => {
		throw new Error(
			`Slot "${id}" has no \`resolve\`, and its route declares no hole "${id}".`
		);
	};
	Reflect.set(resolve, UNRESOLVED_SLOT, true);

	return resolve;
};
/* Warns in production too: a slot that silently stays on its fallback is
 * worse there. The controller logs each distinct warning once per process
 * in production. */
export const warnMissingStreamingSlotCollector = (primitiveName: string) => {
	if (isStreamingSlotCollectionActive()) {
		return;
	}

	getWarningController()?.maybeWarn(primitiveName);
};
