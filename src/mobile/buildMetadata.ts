import type { AbsoluteMobilePageFramework } from './pageProtocol';

export const ABSOLUTE_MOBILE_ROUTE_DETAIL = 'x-absolute-mobile' as const;

export type AbsoluteMobileBuildPageMetadata = {
	bundleKey: string;
	contract: string;
	framework: AbsoluteMobilePageFramework;
	pageId: string;
	propsSchemaHash: string;
};

const frameworks = new Set<string>([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isPageFramework = (
	value: unknown
): value is AbsoluteMobilePageFramework =>
	typeof value === 'string' && frameworks.has(value);

export const parseAbsoluteMobileBuildPageMetadata = (
	value: unknown
): AbsoluteMobileBuildPageMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.bundleKey !== 'string' ||
		typeof value.contract !== 'string' ||
		!isPageFramework(value.framework) ||
		typeof value.pageId !== 'string' ||
		typeof value.propsSchemaHash !== 'string'
	) {
		return undefined;
	}

	return {
		bundleKey: value.bundleKey,
		contract: value.contract,
		framework: value.framework,
		pageId: value.pageId,
		propsSchemaHash: value.propsSchemaHash
	};
};
