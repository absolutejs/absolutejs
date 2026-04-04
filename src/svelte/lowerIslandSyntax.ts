import { BASE_36_RADIX } from '../constants';

const ISLAND_TAG_RE = /<Island\b([\s\S]*?)\/>/g;

const extractBracedExpression = (text: string, braceStart: number) => {
	let depth = 0;
	for (let index = braceStart; index < text.length; index += 1) {
		const char = text[index];
		if (char === '{') depth += 1;
		if (char === '}') depth -= 1;
		if (depth === 0) {
			return text.slice(braceStart + 1, index).trim();
		}
	}

	return null;
};

const extractIslandAttribute = (attributeString: string, name: string) => {
	const quotedMatch = attributeString.match(
		new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`)
	);
	if (quotedMatch?.[1]) {
		return { expression: JSON.stringify(quotedMatch[1]), found: true };
	}

	const attributeIndex = attributeString.search(
		new RegExp(`\\b${name}\\s*=\\s*\\{`)
	);
	if (attributeIndex < 0) {
		return { expression: '', found: false };
	}

	const braceStart = attributeString.indexOf('{', attributeIndex);
	if (braceStart < 0) {
		return { expression: '', found: false };
	}

	const expression = extractBracedExpression(attributeString, braceStart);
	if (expression === null) {
		return { expression: '', found: false };
	}

	return { expression, found: true };
};

export const lowerSvelteIslandSyntax = (
	source: string,
	_mode: 'server' | 'client' = 'server'
) => {
	if (!source.includes('<Island')) {
		return { code: source, transformed: false };
	}

	let islandIndex = 0;
	const transformedMarkup = source.replace(
		ISLAND_TAG_RE,
		(fullMatch, attributeString: string) => {
			const framework = extractIslandAttribute(
				attributeString,
				'framework'
			);
			const component = extractIslandAttribute(
				attributeString,
				'component'
			);
			if (!framework.found || !component.found) {
				return fullMatch;
			}

			const hydrate = extractIslandAttribute(attributeString, 'hydrate');
			const props = extractIslandAttribute(attributeString, 'props');
			const slotId = `absolute-svelte-island-${islandIndex.toString(BASE_36_RADIX)}`;
			islandIndex += 1;

			const resolveExpression = `await __absoluteResolveIslandHtml(${JSON.stringify(
				slotId
			)}, { component: ${component.expression}, framework: ${framework.expression}, hydrate: ${
				hydrate.found ? hydrate.expression : JSON.stringify('load')
			}, props: ${props.found ? props.expression : '{}'} })`;

			return `<div data-absolute-island-slot="${slotId}" style="display: contents">{@html ${resolveExpression}}</div>`;
		}
	);

	const importLine =
		'import { resolveIslandHtml as __absoluteResolveIslandHtml } from "@absolutejs/absolute/svelte";';

	if (transformedMarkup.includes('<script')) {
		return {
			code: transformedMarkup.replace(
				/<script(\s[^>]*)?>/,
				(match) => `${match}\n${importLine}\n`
			),
			transformed: true
		};
	}

	return {
		code: `<script lang="ts">\n${importLine}\n</script>\n${transformedMarkup}`,
		transformed: true
	};
};
