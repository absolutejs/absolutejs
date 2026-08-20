import { AsyncLocalStorage } from 'node:async_hooks';
import {
	ABSOLUTE_MOBILE_PRODUCER_STORAGE_KEY,
	type AbsoluteMobileProducerContext
} from './producerContextState';

export type { AbsoluteMobileProducerContext } from './producerContextState';
export { getCurrentAbsoluteMobileProducerContext } from './producerContextState';

type AbsoluteMobileProducerStorage =
	AsyncLocalStorage<AbsoluteMobileProducerContext>;

const isProducerStorage = (
	value: unknown
): value is AbsoluteMobileProducerStorage =>
	typeof value === 'object' &&
	value !== null &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const getProducerStorage = () => {
	const value = Reflect.get(globalThis, ABSOLUTE_MOBILE_PRODUCER_STORAGE_KEY);

	return isProducerStorage(value) ? value : undefined;
};

const ensureProducerStorage = () => {
	const existing = getProducerStorage();
	if (existing) return existing;

	const storage = new AsyncLocalStorage<AbsoluteMobileProducerContext>();
	Reflect.set(globalThis, ABSOLUTE_MOBILE_PRODUCER_STORAGE_KEY, storage);

	return storage;
};

export const runWithAbsoluteMobileProducer = <Result>(
	context: AbsoluteMobileProducerContext,
	callback: () => Result
) => ensureProducerStorage().run(context, callback);
