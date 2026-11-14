import { warnMissingStreamingSlotCollector } from '../../../src/core/streamingSlotRegistrar';
import {
	getNodeEnv,
	isDevelopmentRuntime,
	isProductionRuntime
} from '../../../src/utils/runtimeMode';

Reflect.set(globalThis, '__exports', {
	getNodeEnv,
	isDevelopmentRuntime,
	isProductionRuntime,
	warnMissingStreamingSlotCollector
});
