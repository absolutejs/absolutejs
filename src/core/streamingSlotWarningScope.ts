import { AsyncLocalStorage } from 'node:async_hooks';
import { logWarn } from '../utils/logger';
import { setStreamingSlotWarningController } from './streamingSlotRegistrar';

type WarningStore = {
	handlerCallsite?: string;
	hasWarned: boolean;
};

type WarningStorage = AsyncLocalStorage<WarningStore>;

const STREAMING_SLOT_WARNING_STORAGE_KEY = Symbol.for(
	'absolutejs.streamingSlotWarningAsyncLocalStorage'
);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isAsyncLocalStorage = (value: unknown): value is WarningStorage =>
	isObjectRecord(value) &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const getWarningStorage = () => {
	const value = Reflect.get(globalThis, STREAMING_SLOT_WARNING_STORAGE_KEY);
	if (value === null || typeof value === 'undefined') {
		return undefined;
	}

	return isAsyncLocalStorage(value) ? value : undefined;
};

const ensureWarningStorage = () => {
	const existing = getWarningStorage();
	if (existing) {
		return existing;
	}

	const storage = new AsyncLocalStorage<WarningStore>();
	Reflect.set(globalThis, STREAMING_SLOT_WARNING_STORAGE_KEY, storage);

	return storage;
};

const normalizeCallsitePath = (value: string) =>
	value
		.replace(`${process.cwd()}/`, '')
		.replace(process.cwd(), '')
		.replace(/^\.\/+/, '');

const formatWarningCallsite = (callsite: string) => {
	const match = callsite.match(/^(.*?)(:\d+:\d+)$/);
	if (!match) {
		return `\x1b[36m${callsite}\x1b[0m`;
	}

	return `\x1b[36m${match[1]}\x1b[33m${match[2]}\x1b[0m`;
};

const shouldIgnoreWarningFrame = (frame: string) =>
	frame.includes('/node_modules/') ||
	frame.includes('/dist/') ||
	frame.includes('/src/react/pageHandler.') ||
	frame.includes('/src/vue/pageHandler.') ||
	frame.includes('/src/svelte/pageHandler.') ||
	frame.includes('/src/angular/pageHandler.') ||
	frame.includes('/src/core/streamingSlotWarningScope.');

const getWarningLocation = (frame: string) =>
	frame.match(/\((\/[^)]+:\d+:\d+)\)$/)?.[1] ??
	frame.match(/at (\/[^ ]+:\d+:\d+)$/)?.[1];

const extractCallsiteFromStack = (stack: string) => {
	const location = stack
		.split('\n')
		.slice(1)
		.map((line) => line.trim())
		.filter((frame) => !shouldIgnoreWarningFrame(frame))
		.map((frame) => getWarningLocation(frame))
		.find((frameLocation) => frameLocation !== undefined);

	return location ? normalizeCallsitePath(location) : undefined;
};

const buildMissingCollectorWarning = (
	primitiveName: string,
	handlerCallsite?: string
) =>
	`${primitiveName} rendered during SSR without streaming slot collection enabled. Add { collectStreamingSlots: true } to this page handler to enable out-of-order streaming for this route.${handlerCallsite ? ` Update ${formatWarningCallsite(handlerCallsite)}.` : ''}`;

setStreamingSlotWarningController({
	maybeWarn: (primitiveName: string) => {
		const store = getWarningStorage()?.getStore();
		if (!store || store.hasWarned) {
			return;
		}

		store.hasWarned = true;
		logWarn(
			buildMissingCollectorWarning(primitiveName, store.handlerCallsite)
		);
	}
});

export const captureStreamingSlotWarningCallsite = () => {
	if (process.env.NODE_ENV === 'production') {
		return undefined;
	}

	const { stack } = new Error();
	if (!stack) {
		return undefined;
	}

	return extractCallsiteFromStack(stack);
};

export const runWithStreamingSlotWarningScope = <T>(
	task: () => Promise<T> | T,
	metadata?: {
		handlerCallsite?: string;
	}
) =>
	ensureWarningStorage().run(
		{ handlerCallsite: metadata?.handlerCallsite, hasWarned: false },
		task
	);
