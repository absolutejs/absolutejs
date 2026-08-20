import type { AbsoluteMobileCompatibilityPage } from './releaseArtifact';

export type AbsoluteMobileProducerContext = {
	page: AbsoluteMobileCompatibilityPage;
	releaseId: string;
};

export const ABSOLUTE_MOBILE_PRODUCER_STORAGE_KEY = Symbol.for(
	'absolutejs.mobileProducerAsyncLocalStorage'
);

const frameworks = new Set<string>([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);

const isCompatibilityPage = (
	value: unknown
): value is AbsoluteMobileCompatibilityPage =>
	typeof value === 'object' &&
	value !== null &&
	'bundleHash' in value &&
	typeof value.bundleHash === 'string' &&
	'contract' in value &&
	typeof value.contract === 'string' &&
	'framework' in value &&
	typeof value.framework === 'string' &&
	frameworks.has(value.framework) &&
	'pageId' in value &&
	typeof value.pageId === 'string' &&
	'propsSchemaHash' in value &&
	typeof value.propsSchemaHash === 'string';

export const getCurrentAbsoluteMobileProducerContext = () => {
	const value: unknown = Reflect.get(
		globalThis,
		ABSOLUTE_MOBILE_PRODUCER_STORAGE_KEY
	);
	if (
		typeof value !== 'object' ||
		value === null ||
		!('getStore' in value) ||
		typeof value.getStore !== 'function'
	) {
		return undefined;
	}
	const context: unknown = value.getStore();
	if (
		typeof context !== 'object' ||
		context === null ||
		!('page' in context) ||
		!isCompatibilityPage(context.page) ||
		!('releaseId' in context) ||
		typeof context.releaseId !== 'string'
	) {
		return undefined;
	}

	return { page: context.page, releaseId: context.releaseId };
};
