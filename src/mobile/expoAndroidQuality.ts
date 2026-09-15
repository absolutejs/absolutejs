const KIB_PER_MIB = 1024;
const XML_BOUND_BOTTOM_INDEX = 4;
const XML_BOUND_LEFT_INDEX = 1;
const XML_BOUND_RIGHT_INDEX = 3;
const XML_BOUND_TOP_INDEX = 2;

export type AbsoluteExpoAndroidLaunchTiming = {
	launchState?: string;
	thisTimeMs?: number;
	totalTimeMs: number;
	waitTimeMs: number;
};

export type AbsoluteExpoAndroidMemory = {
	totalPssKiB: number;
};

export type AbsoluteAndroidAccessibilityNode = {
	bounds: { bottom: number; left: number; right: number; top: number };
	className: string;
	clickable: boolean;
	contentDescription: string;
	enabled: boolean;
	packageName: string;
	resourceId: string;
	text: string;
	visible: boolean;
};

export type AbsoluteExpoAndroidQualityBudgets = {
	bridgeP95Ms: number;
	coldLaunchMs: number;
	hmrP95Ms: number;
	maxMemoryGrowthMiB: number;
	maxTotalPssMiB: number;
	minTouchTargetDp: number;
	warmLaunchMs: number;
};

export const DEFAULT_ABSOLUTE_EXPO_ANDROID_QUALITY_BUDGETS = {
	bridgeP95Ms: 500,
	coldLaunchMs: 25_000,
	hmrP95Ms: 10_000,
	maxMemoryGrowthMiB: 160,
	maxTotalPssMiB: 700,
	minTouchTargetDp: 44,
	warmLaunchMs: 5_000
} satisfies AbsoluteExpoAndroidQualityBudgets;

const requiredInteger = (source: string, name: string) => {
	const match = new RegExp(`^${name}:\\s*(\\d+)$`, 'mu').exec(source);
	const value = Number(match?.[1]);
	if (!Number.isSafeInteger(value))
		throw new TypeError(`Android launch output is missing ${name}.`);

	return value;
};

const optionalInteger = (source: string, name: string) => {
	const match = new RegExp(`^${name}:\\s*(\\d+)$`, 'mu').exec(source);
	if (!match) return undefined;
	const value = Number(match[1]);
	if (!Number.isSafeInteger(value))
		throw new TypeError(`Android launch output has invalid ${name}.`);

	return value;
};

export const parseAbsoluteExpoAndroidLaunchTiming = (source: string) => ({
	launchState: /^LaunchState:\s*(\S+)$/mu.exec(source)?.[1],
	thisTimeMs: optionalInteger(source, 'ThisTime'),
	totalTimeMs: requiredInteger(source, 'TotalTime'),
	waitTimeMs: requiredInteger(source, 'WaitTime')
});

export const parseAbsoluteExpoAndroidMemory = (source: string) => {
	const summary = /^\s*TOTAL PSS:\s*(\d+)/mu.exec(source)?.[1];
	const table = /^\s*TOTAL\s+(\d+)\s+/mu.exec(source)?.[1];
	const totalPssKiB = Number(summary ?? table);
	if (!Number.isSafeInteger(totalPssKiB) || totalPssKiB < 0)
		throw new TypeError('Android meminfo output is missing total PSS.');

	return { totalPssKiB } satisfies AbsoluteExpoAndroidMemory;
};

const decodeXml = (value: string) =>
	value
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');

const nodeAttributes = (source: string) =>
	Object.fromEntries(
		[...source.matchAll(/([\w:-]+)="([^"]*)"/gu)].map(
			([, name = '', value = '']) => [name, decodeXml(value)]
		)
	);

const nodeBounds = (source: string) => {
	const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u.exec(source);
	if (!match) return { bottom: 0, left: 0, right: 0, top: 0 };

	return {
		bottom: Number(match[XML_BOUND_BOTTOM_INDEX]),
		left: Number(match[XML_BOUND_LEFT_INDEX]),
		right: Number(match[XML_BOUND_RIGHT_INDEX]),
		top: Number(match[XML_BOUND_TOP_INDEX])
	};
};

export const absoluteAndroidNodeLabel = (
	node: AbsoluteAndroidAccessibilityNode
) => node.contentDescription.trim() || node.text.trim();
export const absoluteAndroidTouchTargetDp = (
	node: AbsoluteAndroidAccessibilityNode,
	density: number
) => {
	if (!Number.isFinite(density) || density <= 0)
		throw new TypeError('Android display density must be positive.');

	return {
		height: (node.bounds.bottom - node.bounds.top) / density,
		width: (node.bounds.right - node.bounds.left) / density
	};
};
export const absolutePercentile = (
	values: readonly number[],
	ratio: number
) => {
	if (values.length === 0)
		throw new TypeError('A percentile requires at least one measurement.');
	if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
		throw new TypeError('A percentile ratio must be between zero and one.');
	const ordered = [...values].sort((left, right) => left - right);
	const index = Math.ceil(ratio * ordered.length) - 1;

	return ordered[Math.max(0, index)] ?? 0;
};
export const absolutePssMiB = (memory: AbsoluteExpoAndroidMemory) =>
	memory.totalPssKiB / KIB_PER_MIB;
export const parseAbsoluteAndroidAccessibilityHierarchy = (source: string) =>
	[...source.matchAll(/<node\s+([^>]*?)\/?>(?:<\/node>)?/gu)].map(
		([, raw = '']) => {
			const attributes = nodeAttributes(raw);

			return {
				bounds: nodeBounds(attributes.bounds ?? ''),
				className: attributes.class ?? '',
				clickable: attributes.clickable === 'true',
				contentDescription: attributes['content-desc'] ?? '',
				enabled: attributes.enabled === 'true',
				packageName: attributes.package ?? '',
				resourceId: attributes['resource-id'] ?? '',
				text: attributes.text ?? '',
				visible: attributes['visible-to-user'] !== 'false'
			} satisfies AbsoluteAndroidAccessibilityNode;
		}
	);
