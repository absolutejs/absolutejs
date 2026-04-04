import type { IslandFramework, IslandHydrate } from '../../types/island';

export type PageIslandUsage = {
	component: string;
	framework: IslandFramework;
	hydrate?: IslandHydrate;
	source?: string;
};

const islandFrameworks: IslandFramework[] = [
	'react',
	'svelte',
	'vue',
	'angular'
];

const islandHydrationModes: IslandHydrate[] = [
	'load',
	'idle',
	'visible',
	'none'
];

const isIslandFramework = (value: string): value is IslandFramework =>
	islandFrameworks.some((framework) => framework === value);

const isIslandHydrate = (value: string): value is IslandHydrate =>
	islandHydrationModes.some((hydrate) => hydrate === value);

const parseIslandTagAttributes = (attributeString: string) => {
	const frameworkMatch = attributeString.match(
		/\bframework\s*=\s*["']([^"']+)["']/
	);
	const componentMatch = attributeString.match(
		/\bcomponent\s*=\s*["']([^"']+)["']/
	);
	const hydrateMatch = attributeString.match(
		/\bhydrate\s*=\s*["']([^"']+)["']/
	);
	const framework = frameworkMatch?.[1];
	const component = componentMatch?.[1];
	if (!framework || !component) {
		return null;
	}
	if (!isIslandFramework(framework)) {
		return null;
	}

	const hydrateCandidate = hydrateMatch?.[1];

	return {
		component,
		framework,
		hydrate:
			hydrateCandidate && isIslandHydrate(hydrateCandidate)
				? hydrateCandidate
				: undefined
	} satisfies PageIslandUsage;
};

const normalizeUsage = (usage: PageIslandUsage) =>
	`${usage.framework}:${usage.component}:${usage.hydrate ?? ''}`;

const addUsage = (
	usageMap: Map<string, PageIslandUsage>,
	usage: PageIslandUsage | null
) => {
	if (!usage) return;
	usageMap.set(normalizeUsage(usage), usage);
};

const addRenderCallUsage = (
	usageMap: Map<string, PageIslandUsage>,
	match: RegExpExecArray
) => {
	const [, framework, component, hydrate] = match;
	if (!framework || !component || !isIslandFramework(framework)) {
		return;
	}

	addUsage(usageMap, {
		component,
		framework,
		hydrate: hydrate && isIslandHydrate(hydrate) ? hydrate : undefined
	});
};

export const buildIslandMetadataExports = (source: string) => {
	const usages = extractIslandUsagesFromSource(source);
	const serialized = JSON.stringify(usages);

	return `\nexport const __ABSOLUTE_PAGE_ISLANDS__ = ${serialized};\nexport const __ABSOLUTE_PAGE_HAS_ISLANDS__ = ${usages.length > 0};\n`;
};
export const extractIslandUsagesFromSource = (source: string) => {
	const usageMap = new Map<string, PageIslandUsage>();

	const islandTagRegex =
		/<Island\b([\s\S]*?)(?:\/>|>(?:[\s\S]*?)<\/Island>)/g;
	let islandTagMatch = islandTagRegex.exec(source);
	while (islandTagMatch) {
		addUsage(usageMap, parseIslandTagAttributes(islandTagMatch[1] ?? ''));
		islandTagMatch = islandTagRegex.exec(source);
	}

	const absoluteIslandTagRegex =
		/<absolute-island\b([\s\S]*?)(?:\/>|>(?:[\s\S]*?)<\/absolute-island>)/g;
	let absoluteIslandMatch = absoluteIslandTagRegex.exec(source);
	while (absoluteIslandMatch) {
		addUsage(
			usageMap,
			parseIslandTagAttributes(absoluteIslandMatch[1] ?? '')
		);
		absoluteIslandMatch = absoluteIslandTagRegex.exec(source);
	}

	const staticRenderCallRegex =
		/renderIsland\s*\(\s*\{[\s\S]*?\bframework\s*:\s*['"]([^'"]+)['"][\s\S]*?\bcomponent\s*:\s*['"]([^'"]+)['"](?:[\s\S]*?\bhydrate\s*:\s*['"]([^'"]+)['"])?[\s\S]*?\}\s*\)/g;
	let renderMatch = staticRenderCallRegex.exec(source);
	while (renderMatch) {
		addRenderCallUsage(usageMap, renderMatch);
		renderMatch = staticRenderCallRegex.exec(source);
	}

	return [...usageMap.values()];
};
export const hasIslandUsageInSource = (source: string) =>
	extractIslandUsagesFromSource(source).length > 0;
