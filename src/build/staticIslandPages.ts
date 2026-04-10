import { readFileSync, writeFileSync } from 'node:fs';
import type {
	IslandFramework,
	IslandHydrate,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { renderStreamingSlotPlaceholder } from '../utils/streamingSlots';
import { renderIslandMarkup } from '../core/renderIslandMarkup';
import { loadIslandRegistryBuildInfo } from './islandEntries';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { extractStaticStreamingTags } from '../core/staticStreaming';

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

type HTMLAttributeMap = Map<string, string>;

const parseHtmlAttributes = (attributeString: string): HTMLAttributeMap => {
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
	const attributes = parseHtmlAttributes(attributeString);
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

const HTMX_STREAM_SLOT_TAG_RE =
	/<abs-htmx-stream-slot\b([^>]*?)(?:\/>|>([\s\S]*?)<\/abs-htmx-stream-slot>)/gi;

const requireAttribute = (
	attributes: HTMLAttributeMap,
	name: string
) => {
	const value = attributes.get(name)?.trim();
	if (!value) {
		throw new Error(
			`Static <abs-htmx-stream-slot> requires a "${name}" attribute.`
		);
	}

	return value;
};

const injectAttributesIntoSingleRootElement = (
	fallbackHtml: string,
	attributes: HTMLAttributeMap
) => {
	const trimmed = fallbackHtml.trim();
	if (!trimmed) {
		throw new Error(
			'Static <abs-htmx-stream-slot> requires fallback HTML inside the element body.'
		);
	}

	const openingTagMatch = trimmed.match(/^<([A-Za-z][\w:-]*)([^>]*)>/);
	if (!openingTagMatch) {
		throw new Error(
			'Static <abs-htmx-stream-slot> fallback must start with a single root HTML element.'
		);
	}

	const attributeSource = [...attributes.entries()]
		.map(([key, value]) => `${key}="${value}"`)
		.join(' ');
	if (!attributeSource) {
		return trimmed;
	}

	const [openingTag, tagName, rawExistingAttributes = ''] = openingTagMatch;
	const existingAttributes = rawExistingAttributes.trim();
	const mergedAttributes = existingAttributes
		? `${existingAttributes} ${attributeSource}`
		: attributeSource;

	return trimmed.replace(openingTag, `<${tagName} ${mergedAttributes}>`);
};

export const transformStaticHTMXStreamSlotHtml = (originalHtml: string) => {
	let nextIndex = 0;
	let result = '';
	let match = HTMX_STREAM_SLOT_TAG_RE.exec(originalHtml);

	while (match) {
		const [fullMatch, rawAttributeString = '', innerHtml = ''] = match;
		const attributes = parseHtmlAttributes(rawAttributeString);
		const loweredAttributes = new Map<string, string>([
			['hx-get', requireAttribute(attributes, 'src')],
			['hx-trigger', attributes.get('trigger') ?? 'load'],
			['hx-swap', attributes.get('swap') ?? 'outerHTML'],
			['hx-target', attributes.get('target') ?? 'this']
		]);

		result += originalHtml.slice(nextIndex, match.index);
		result += injectAttributesIntoSingleRootElement(innerHtml, loweredAttributes);
		nextIndex = match.index + fullMatch.length;
		match = HTMX_STREAM_SLOT_TAG_RE.exec(originalHtml);
	}

	return result + originalHtml.slice(nextIndex);
};

export const transformStaticStreamingSlotHtml = (originalHtml: string) => {
	const slotDefinitions = extractStaticStreamingTags(originalHtml);
	if (slotDefinitions.length === 0) {
		return originalHtml;
	}

	const tagRe =
		/<abs-stream-slot\b([^>]*?)(?:\/>|>([\s\S]*?)<\/abs-stream-slot>)/gi;
	let nextIndex = 0;
	let slotIndex = 0;
	let result = '';
	let match = tagRe.exec(originalHtml);

	while (match) {
		const [fullMatch] = match;
		const tag = slotDefinitions[slotIndex++];
		if (!tag) {
			throw new Error(
				'Static streaming slot transform lost sync with parsed slot definitions.'
			);
		}
		result += originalHtml.slice(nextIndex, match.index);
		result += renderStreamingSlotPlaceholder(tag.id, tag.fallbackHtml);
		nextIndex = match.index + fullMatch.length;
		match = tagRe.exec(originalHtml);
	}

	return result + originalHtml.slice(nextIndex);
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

export const transformCurrentStaticPageHtml = async (
	html: string,
	options: {
		enableHTMXStreaming?: boolean;
		enableStaticStreaming?: boolean;
	} = {}
) => {
	const transformedHTMXStreamingHtml =
		options.enableHTMXStreaming === false
			? html
			: transformStaticHTMXStreamSlotHtml(html);
	const transformedStreamingHtml =
		options.enableStaticStreaming === false
			? transformedHTMXStreamingHtml
			: transformStaticStreamingSlotHtml(transformedHTMXStreamingHtml);
	const islandTagRe = new RegExp(ISLAND_TAG_RE_SOURCE, 'i');
	if (!islandTagRe.test(transformedStreamingHtml)) {
		return transformedStreamingHtml;
	}

	return transformStaticPageHtml(
		transformedStreamingHtml,
		requireCurrentIslandRegistry()
	);
};
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
