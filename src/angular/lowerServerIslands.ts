import type {
	IslandFramework,
	IslandHydrate,
	RuntimeIslandRenderProps
} from '../../types/island';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { renderIslandMarkup } from '../core/renderIslandMarkup';

const ANGULAR_ISLAND_TAG_RE =
	/<absolute-island\b([^>]*)>[\s\S]*?<\/absolute-island>/gi;
const ATTRIBUTE_RE =
	/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

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

const decodeHtmlAttribute = (value: string) =>
	value
		.replaceAll('&quot;', '"')
		.replaceAll('&#34;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&#39;', "'")
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isIslandFramework = (value: string): value is IslandFramework =>
	islandFrameworks.some((framework) => framework === value);

const isIslandHydrate = (value: string): value is IslandHydrate =>
	islandHydrationModes.some((mode) => mode === value);

const parseAttributes = (attributeString: string) => {
	const attributes = new Map<string, string>();
	let match = ATTRIBUTE_RE.exec(attributeString);

	while (match) {
		const [, key, doubleQuotedValue, singleQuotedValue] = match;
		match = ATTRIBUTE_RE.exec(attributeString);
		if (!key) continue;

		attributes.set(
			key,
			decodeHtmlAttribute(doubleQuotedValue ?? singleQuotedValue ?? '')
		);
	}

	ATTRIBUTE_RE.lastIndex = 0;

	return attributes;
};

const parseAngularIslandProps = (
	attributeString: string
): RuntimeIslandRenderProps | null => {
	const attributes = parseAttributes(attributeString);
	const component = attributes.get('component');
	const framework = attributes.get('framework');
	const hydrate = attributes.get('hydrate') ?? 'load';
	const serializedProps = attributes.get('data-abs-props') ?? '{}';

	if (!component || !framework) {
		return null;
	}

	if (!isIslandFramework(framework) || !isIslandHydrate(hydrate)) {
		return null;
	}

	let parsedProps: Record<string, unknown> = {};
	try {
		const candidate: unknown = JSON.parse(serializedProps);
		parsedProps = isRecord(candidate) ? candidate : {};
	} catch {
		// parsedProps remains default {}
	}

	return {
		component,
		framework,
		hydrate,
		props: parsedProps
	};
};

export const lowerAngularServerIslands = async (html: string) => {
	if (!ANGULAR_ISLAND_TAG_RE.test(html)) {
		return html;
	}

	const registry = requireCurrentIslandRegistry();
	ANGULAR_ISLAND_TAG_RE.lastIndex = 0;

	const segments: {
		before: string;
		props: ReturnType<typeof parseAngularIslandProps>;
		fullMatch: string;
	}[] = [];
	let lastIndex = 0;
	let match = ANGULAR_ISLAND_TAG_RE.exec(html);

	while (match) {
		const [fullMatch, rawAttributeString] = match;
		const attributeString = rawAttributeString ?? '';
		segments.push({
			before: html.slice(lastIndex, match.index),
			fullMatch,
			props: parseAngularIslandProps(attributeString)
		});
		lastIndex = match.index + fullMatch.length;
		match = ANGULAR_ISLAND_TAG_RE.exec(html);
	}

	ANGULAR_ISLAND_TAG_RE.lastIndex = 0;

	const renderedSegments = await Promise.all(
		segments.map(
			async (segment) =>
				segment.before +
				(segment.props
					? await renderIslandMarkup(registry, segment.props)
					: segment.fullMatch)
		)
	);

	return renderedSegments.join('') + html.slice(lastIndex);
};
