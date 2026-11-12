import { BASE_36_RADIX } from '../constants';

/* Opt-in streaming for Svelte `{#await}` blocks.
 *
 * A plain `{#await}` is left alone: Svelte server-renders its pending branch
 * and the client resolves the promise and hydrates every branch, components
 * and logic included.
 *
 * Marked with the directive comment directly before it, a block is instead
 * lowered to an `AbsoluteAwaitSlot` streaming slot: the server sends the
 * pending HTML, resolves the promise itself and streams the resolved HTML
 * into the slot. The streamed branches become HTML strings, not Svelte
 * markup, so they may hold elements and `{expressions}` only. Anything
 * Svelte has to render (a component, `{#if}`, `{#each}`, `{@html}`, …) is
 * rejected at build time rather than shipped as text, and the page doesn't
 * hydrate, because the streamed HTML isn't Svelte's to claim.
 *
 *   <!-- absolute:stream -->
 *   {#await loadPrices()}
 *     <p>Loading…</p>
 *   {:then prices}
 *     <p>{prices.length} prices</p>
 *   {/await}
 */
export const AWAIT_STREAM_DIRECTIVE = '<!-- absolute:stream -->';

const DIRECTIVE_RE = /<!--\s*absolute:stream\s*-->\s*/g;
const BRANCH_TAG_RE = /^\{:(then|catch)(?:\s+([A-Za-z_$][\w$]*))?\s*\}$/;
const SVELTE_ONLY_MARKUP_RE = /\{[#:/@]|<[A-Z]|<svelte:/;

type TagScan = { depth: number; escaped: boolean; quote: string | null };

const QUOTES = new Set(['"', "'", '`']);

/** Advances the scan by one character of a `{...}` tag. */
const scanCharacter = (scan: TagScan, char: string) => {
	if (scan.escaped) {
		scan.escaped = false;

		return;
	}
	if (scan.quote) {
		scan.escaped = char === '\\';
		if (char === scan.quote) scan.quote = null;

		return;
	}
	if (QUOTES.has(char)) scan.quote = char;
	if (char === '{') scan.depth += 1;
	if (char === '}') scan.depth -= 1;
};

/** Index just past the `}` closing the tag that opens at `start`, skipping
 *  nested braces and string literals in the expression. */
const findTagEnd = (source: string, start: number) => {
	const scan: TagScan = { depth: 0, escaped: false, quote: null };
	for (let index = start; index < source.length; index += 1) {
		scanCharacter(scan, source[index] ?? '');
		if (scan.depth === 0) return index + 1;
	}

	return -1;
};

/** The `{...}` tags at the top level of `markup`, in order. */
const topLevelTags = (markup: string) => {
	const tags: { end: number; start: number; text: string }[] = [];
	let index = markup.indexOf('{');
	while (index !== -1) {
		const end = findTagEnd(markup, index);
		if (end === -1) break;
		tags.push({ end, start: index, text: markup.slice(index, end) });
		index = markup.indexOf('{', end);
	}

	return tags;
};

const escapeTemplateLiteral = (value: string) =>
	value
		.replaceAll('\\', '\\\\')
		.replaceAll('`', '\\`')
		.replaceAll('${', '\\${');

const markupToTemplateLiteral = (markup: string) => {
	const parts = topLevelTags(markup.trim());
	const trimmed = markup.trim();
	let cursor = 0;
	let literal = '';
	for (const { end, start, text } of parts) {
		literal += escapeTemplateLiteral(trimmed.slice(cursor, start));
		literal += `\${${text.slice(1, -1).trim()}}`;
		cursor = end;
	}
	literal += escapeTemplateLiteral(trimmed.slice(cursor));

	return `\`${literal}\``;
};

type StreamedAwait = {
	catchIdentifier: string | undefined;
	catchMarkup: string | undefined;
	end: number;
	expression: string;
	pendingMarkup: string;
	thenIdentifier: string | undefined;
	thenMarkup: string;
};

const fail = (filePath: string | undefined, message: string) => {
	throw new Error(
		`${filePath ? `${filePath}: ` : ''}${message} (${AWAIT_STREAM_DIRECTIVE} streams plain HTML; remove the directive to let Svelte render the block and hydrate it)`
	);
};

const assertPlainHtml = (
	markup: string,
	branch: string,
	filePath: string | undefined
) => {
	const withoutExpressions = topLevelTags(markup).reduceRight(
		(text, { end, start }) => text.slice(0, start) + text.slice(end),
		markup
	);
	const nestedTag = topLevelTags(markup).find(({ text }) =>
		/^\{[#:/@]/.test(text)
	);
	if (nestedTag || SVELTE_ONLY_MARKUP_RE.test(withoutExpressions)) {
		fail(
			filePath,
			`the ${branch} branch of a streamed {#await} holds Svelte markup (${
				nestedTag?.text ??
				withoutExpressions.match(SVELTE_ONLY_MARKUP_RE)?.[0]
			}…)`
		);
	}
};

/** Parses the `{#await}` block whose header opens at `start`. */
const parseStreamedAwait = (
	source: string,
	start: number,
	filePath: string | undefined
): StreamedAwait => {
	if (!source.startsWith('{#await', start)) {
		fail(
			filePath,
			`${AWAIT_STREAM_DIRECTIVE} must come directly before an {#await} block`
		);
	}
	const headerEnd = findTagEnd(source, start);
	if (headerEnd === -1) fail(filePath, 'unterminated {#await} tag');
	const expression = source
		.slice(start + '{#await'.length, headerEnd - 1)
		.trim();
	if (!expression) fail(filePath, '{#await} without an expression');
	if (/\s(?:then|catch)\b/.test(` ${expression}`)) {
		fail(
			filePath,
			'a streamed {#await} needs a pending branch; the shorthand {#await … then …} has none'
		);
	}

	const close = source.indexOf('{/await}', headerEnd);
	if (close === -1) fail(filePath, '{#await} without a matching {/await}');
	const body = source.slice(headerEnd, close);
	const branchTags = topLevelTags(body).filter(({ text }) =>
		/^\{:/.test(text)
	);
	const [thenTag, catchTag, extra] = branchTags;
	const thenMatch = thenTag?.text.match(BRANCH_TAG_RE);
	const catchMatch = catchTag?.text.match(BRANCH_TAG_RE);
	if (
		!thenTag ||
		thenMatch?.[1] !== 'then' ||
		(catchTag && catchMatch?.[1] !== 'catch') ||
		extra
	) {
		fail(
			filePath,
			'a streamed {#await} takes exactly one {:then} and at most one {:catch}, in that order'
		);
	}

	const pendingMarkup = body.slice(0, thenTag?.start);
	const thenMarkup = body.slice(thenTag?.end, catchTag?.start);
	const catchMarkup = catchTag ? body.slice(catchTag.end) : undefined;
	assertPlainHtml(pendingMarkup, 'pending', filePath);
	assertPlainHtml(thenMarkup, 'then', filePath);
	if (catchMarkup !== undefined)
		assertPlainHtml(catchMarkup, 'catch', filePath);

	return {
		catchIdentifier: catchMatch?.[2],
		catchMarkup,
		end: close + '{/await}'.length,
		expression,
		pendingMarkup,
		thenIdentifier: thenMatch?.[2],
		thenMarkup
	};
};

const renderSlot = (block: StreamedAwait, slotId: string) => {
	const thenValueIdentifier = block.thenIdentifier ?? '__awaitValue';
	const catchValueIdentifier = block.catchIdentifier ?? '__awaitError';
	const catchBranch =
		block.catchMarkup === undefined
			? 'catch (_absoluteAwaitError) { throw _absoluteAwaitError; }'
			: `catch (${catchValueIdentifier}) { return ${markupToTemplateLiteral(block.catchMarkup)}; }`;

	return `<AbsoluteAwaitSlot id="${slotId}" fallbackHtml={${markupToTemplateLiteral(
		block.pendingMarkup
	)}} resolve={async () => { try { const ${thenValueIdentifier} = await (${
		block.expression
	}); return ${markupToTemplateLiteral(block.thenMarkup)}; } ${catchBranch} }} />`;
};

const IMPORT_LINE =
	'import AbsoluteAwaitSlot from "@absolutejs/absolute/svelte/components/AwaitSlot.svelte";';

/** Lowers every `{#await}` marked with `AWAIT_STREAM_DIRECTIVE` to a
 *  streaming slot and leaves every other block to Svelte. Throws for a
 *  marked block it can't stream. */
export const lowerSvelteAwaitSlotSyntax = (
	source: string,
	filePath?: string
) => {
	if (!source.includes('absolute:stream')) {
		return { code: source, transformed: false };
	}

	let lowered = '';
	let cursor = 0;
	let awaitIndex = 0;
	for (const directive of source.matchAll(DIRECTIVE_RE)) {
		const awaitStart = directive.index + directive[0].length;
		if (awaitStart < cursor) continue;
		const block = parseStreamedAwait(source, awaitStart, filePath);
		const slotId = `absolute-svelte-await-${awaitIndex.toString(BASE_36_RADIX)}`;
		awaitIndex += 1;
		lowered += source.slice(cursor, directive.index);
		lowered += renderSlot(block, slotId);
		cursor = block.end;
	}

	if (awaitIndex === 0) {
		return { code: source, transformed: false };
	}
	lowered += source.slice(cursor);

	if (lowered.includes('<script')) {
		return {
			code: lowered.replace(
				/<script(\s[^>]*)?>/,
				(match) => `${match}\n${IMPORT_LINE}\n`
			),
			transformed: true
		};
	}

	return {
		code: `<script lang="ts">\n${IMPORT_LINE}\n</script>\n${lowered}`,
		transformed: true
	};
};
