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

/* `await` on the server, nothing on the client — which is the difference
 * between an island that hydrates once and one that hydrates twice.
 *
 * The server resolver renders the island (`renderIslandMarkup`) and is
 * async; the browser resolver reads the markup snapshot the page index
 * captured and is synchronous. Awaiting it anyway made the `{@html}` block
 * resolve AFTER hydration, so Svelte wrote the slot's markup afresh over
 * an island the islands runtime had already hydrated: the runtime then
 * hydrated the new copy as well, and the first instance was left running
 * on detached nodes — two island instances, two disposers, one element.
 *
 * Synchronous on the client, the block has its content while hydrating, so
 * Svelte hydrates the markup that is already there instead of replacing
 * it. */
export const lowerSvelteIslandSyntax = (
	source: string,
	mode: 'server' | 'client' = 'server'
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

			const call = `__absoluteResolveIslandHtml(${JSON.stringify(
				slotId
			)}, { component: ${component.expression}, framework: ${framework.expression}, hydrate: ${
				hydrate.found ? hydrate.expression : JSON.stringify('load')
			}, props: ${props.found ? props.expression : '{}'} })`;
			const resolveExpression =
				mode === 'server' ? `await ${call}` : call;

			if (mode === 'server') {
				return `<div data-absolute-island-slot="${slotId}" style="display: contents">{@html ${resolveExpression}}</div>`;
			}

			/* No children in the client template, so Svelte hydration
			 * leaves the markup already in the slot exactly where it is.
			 * The action fills the slot only when it is empty, which is
			 * every mounting render.
			 *
			 * An `{#if}` around the `{@html}` was tried instead and is
			 * worse than either: the block's hydration anchors make Svelte
			 * remove the nodes between them, so the island disappears from
			 * a hydrating page altogether. */
			return `<div data-absolute-island-slot="${slotId}" style="display: contents" use:__absoluteIslandSlot={() => ${resolveExpression}}></div>`;
		}
	);

	const importLine =
		'import { resolveIslandHtml as __absoluteResolveIslandHtml, absoluteIslandSlot as __absoluteIslandSlot } from "@absolutejs/absolute/svelte";';

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
