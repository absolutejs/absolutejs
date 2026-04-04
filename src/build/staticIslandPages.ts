import { readFileSync, writeFileSync } from 'node:fs';
import type {
	IslandFramework,
	IslandHydrate,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { renderIslandMarkup } from '../core/renderIslandMarkup';
import { loadIslandRegistryBuildInfo } from './islandEntries';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';

const ISLAND_TAG_RE_SOURCE =
	'<(?:absolute-island|island)\\b([^>]*?)(?:\\/\\>|>(?:[\\s\\S]*?)<\\/(?:absolute-island|island)>)';
const ATTRIBUTE_RE_SOURCE =
	'([A-Za-z_:][-A-Za-z0-9_:.]*)\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')';

const islandFrameworks: IslandFramework[] = [
	'react',
	'svelte',
	'vue',
	'angular'
];

const islandHydrationModes = ['load', 'idle', 'visible', 'none'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isIslandFramework = (value: string): value is IslandFramework =>
	islandFrameworks.some((framework) => framework === value);

const isIslandHydrationMode = (
	value: string
): value is IslandHydrate =>
	islandHydrationModes.some((mode) => mode === value);

const parseIslandAttributes = (attributeString: string) => {
	const attributeRe = new RegExp(ATTRIBUTE_RE_SOURCE, 'g');
	const attributes = new Map<string, string>();
	let match = attributeRe.exec(attributeString);

	while (match) {
		const [, key, doubleQuotedValue, singleQuotedValue] = match;
		match = attributeRe.exec(attributeString);
		if (!key) continue;

		const value = doubleQuotedValue ?? singleQuotedValue ?? '';
		attributes.set(key, value);
	}

	return attributes;
};

const parseIslandTag = (
	attributeString: string
): RuntimeIslandRenderProps | null => {
	const attributes = parseIslandAttributes(attributeString);
	const framework = attributes.get('framework');
	const component = attributes.get('component');
	const hydrate = attributes.get('hydrate') ?? 'load';
	const propsSource = attributes.get('props') ?? '{}';

	if (!framework || !component) {
		return null;
	}

	if (!isIslandFramework(framework)) {
		throw new Error(`Unsupported static island framework "${framework}".`);
	}

	if (!isIslandHydrationMode(hydrate)) {
		throw new Error(`Unsupported static island hydrate mode "${hydrate}".`);
	}

	let parsedProps: Record<string, unknown>;
	try {
		const candidate: unknown = JSON.parse(propsSource);
		parsedProps = isRecord(candidate) ? candidate : {};
	} catch (error) {
		throw new Error(
			`Failed to parse static island props JSON for ${framework}:${component}: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ cause: error }
		);
	}

	return {
		component,
		framework,
		hydrate,
		props: parsedProps
	};
};

export const transformStaticPageHtml = async (
	originalHtml: string,
	registry: IslandRegistryInput
) => {
	const islandTagRe = new RegExp(ISLAND_TAG_RE_SOURCE, 'gi');
	if (!islandTagRe.test(originalHtml)) {
		return originalHtml;
	}

	islandTagRe.lastIndex = 0;

	const segments: { before: string; props: ReturnType<typeof parseIslandTag>; fullMatch: string }[] = [];
	let lastIndex = 0;
	let match = islandTagRe.exec(originalHtml);

	while (match) {
		const [fullMatch, rawAttributeString] = match;
		const attributeString = rawAttributeString ?? '';
		segments.push({
			before: originalHtml.slice(lastIndex, match.index),
			fullMatch,
			props: parseIslandTag(attributeString)
		});
		lastIndex = match.index + fullMatch.length;
		match = islandTagRe.exec(originalHtml);
	}

	const renderedSegments = await Promise.all(
		segments.map(async (segment) =>
			segment.before + (segment.props ? await renderIslandMarkup(registry, segment.props) : segment.fullMatch)
		)
	);

	return renderedSegments.join('') + originalHtml.slice(lastIndex);
};

const transformStaticPage = async (
	pagePath: string,
	registry: IslandRegistryInput
) => {
	const originalHtml = readFileSync(pagePath, 'utf-8');
	const transformedHtml = await transformStaticPageHtml(
		originalHtml,
		registry
	);

	if (transformedHtml !== originalHtml) {
		writeFileSync(pagePath, transformedHtml);
	}
};

export const transformCurrentStaticPageHtml = async (html: string) =>
	transformStaticPageHtml(html, requireCurrentIslandRegistry());
export const transformStaticPagesWithIslands = async (
	registryPath: string | undefined,
	pagePaths: string[]
) => {
	if (!registryPath || pagePaths.length === 0) {
		return;
	}

	const { registry } = await loadIslandRegistryBuildInfo(registryPath);

	await Promise.all(
		pagePaths.map((pagePath) => transformStaticPage(pagePath, registry))
	);
};
