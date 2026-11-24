import { BASE_36_RADIX } from '../constants';
import { projectRoot } from '../utils/projectRoot';
import type { SvelteCssHashGetter } from '../../types/svelte';

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
 * markup, so they may hold elements, `{expressions}` (escaped exactly as
 * Svelte's SSR escapes them) and `{@html}` only. Anything Svelte has to
 * render (a component, `{#if}`, `{#each}`, an event handler, …) is rejected
 * at build time rather than shipped as text, and the page doesn't hydrate,
 * because the streamed HTML isn't Svelte's to claim.
 *
 *   <!-- absolute:stream -->
 *   {#await loadPrices()}
 *     <p>Loading…</p>
 *   {:then prices}
 *     <p>{prices.length} prices</p>
 *   {/await}
 *
 * `<!-- absolute:stream dynamic -->` marks the slot dynamic: on a
 * pre-rendered page it stays a hole in the cached shell and streams on
 * every request (partial prerendering).
 */
export const AWAIT_STREAM_DIRECTIVE = '<!-- absolute:stream -->';

const DIRECTIVE_RE = /<!--\s*absolute:stream(\s+dynamic)?\s*-->\s*/g;
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

/* The streamed branches are HTML strings, so every `{expression}` in them is
 * escaped the way Svelte's own SSR escapes it (svelte/internal/server
 * `escape`, `attr`, `attr_class`, `attr_style`, `stringify`, `clsx`):
 *
 *   text            {value}            & and < escaped
 *   attribute       name={value}       & " < escaped, null/undefined omits
 *                                      it, boolean attributes as in Svelte
 *   class / style   class={value}      clsx for class, omitted when empty
 *   mixed value     title="a {value}"  each expression stringified and
 *                                      escaped, the value double-quoted
 *   raw HTML        {@html value}      not escaped (Svelte's opt-out)
 *
 * The helpers are inlined into the lowered component rather than imported,
 * so the lowering needs nothing beyond `AwaitSlot.svelte` at runtime. They
 * are plain JavaScript so they work in a `lang="ts"` script and a plain one.
 *
 * Every element in a branch also gets the component's scoped-CSS class
 * (`svelte-xyz`, added as Svelte's SSR adds it, after any class of its own),
 * so the component's `<style>` applies inside the streamed HTML as it does
 * to the rest of the component. Svelte only settles that class while it
 * compiles the component, so the helpers carry a placeholder that every
 * compile of a lowered component replaces with the class Svelte computed
 * (`createAwaitScopeClassCapture`). */
const HTML_HELPERS = '__absoluteAwaitHtml';

export const AWAIT_SCOPE_CLASS_PLACEHOLDER = '__absoluteAwaitScopeClass__';

export const AWAIT_HTML_HELPERS_SOURCE = [
	`const ${HTML_HELPERS} = (() => {`,
	`\tconst scope = ${JSON.stringify(AWAIT_SCOPE_CLASS_PLACEHOLDER)};`,
	"\tconst escape = (value, isAttr) => String(value ?? '').replace(isAttr ? /[&\"<]/g : /[&<]/g, (char) => char === '&' ? '&amp;' : char === '\"' ? '&quot;' : '&lt;');",
	"\tconst stringify = (value) => typeof value === 'string' ? value : value == null ? '' : value + '';",
	"\tconst classNames = (value) => { if (Array.isArray(value)) return value.filter(Boolean).map(classNames).filter(Boolean).join(' '); if (value && typeof value === 'object') return Object.keys(value).filter((key) => value[key]).join(' '); return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; };",
	'\treturn {',
	"\t\tattr: (name, value, isBoolean) => { const boolean = isBoolean || (name === 'hidden' && value !== 'until-found'); if (value == null || (!value && boolean)) return ''; const normalized = name === 'translate' && typeof value === 'boolean' ? (value ? 'yes' : 'no') : value; return boolean ? ' ' + name + '=\"\"' : ' ' + name + '=\"' + escape(normalized, true) + '\"'; },",
	"\t\tclass: (value) => { const resolved = typeof value === 'object' ? classNames(value) : value ?? ''; let name = '' + resolved; if (scope) name = name ? name + ' ' + scope : scope; return name ? ' class=\"' + escape(name, true) + '\"' : ''; },",
	"\t\thtml: (value) => String(value ?? ''),",
	"\t\tjoin: (...values) => values.map(stringify).join(''),",
	'\t\tpart: (value) => escape(stringify(value), true),',
	"\t\tscope: () => scope ? ' class=\"' + scope + '\"' : '',",
	"\t\tscoped: () => scope ? ' ' + scope : '',",
	// Never true: it guards the copy of the branches Svelte compiles only
	// to keep their CSS selectors (see `shadowMarkup`).
	'\t\tshadow: false,',
	"\t\tstyle: (value) => { const style = value == null ? '' : String(value); return style ? ' style=\"' + escape(style, true) + '\"' : ''; },",
	'\t\ttext: (value) => escape(value, false)',
	'\t};',
	'})();'
].join('\n');

/** Puts `scopeClass` (or nothing, for a component without a `<style>`)
 *  where the lowering left the scoped-CSS class placeholder. */
export const applyAwaitScopeClass = (code: string, scopeClass: string) =>
	code.replaceAll(AWAIT_SCOPE_CLASS_PLACEHOLDER, scopeClass);

/** A `cssHash` compile option that hashes exactly as Svelte's default does
 *  (svelte/src/compiler/validate-options.js) and remembers the class, plus
 *  `apply`, which writes that class into the compiled code of a lowered
 *  component. Svelte only calls `cssHash` for a component with a `<style>`,
 *  so without one the placeholder becomes an empty string. One capture per
 *  `compile` call. */
export const createAwaitScopeClassCapture = () => {
	let scopeClass = '';
	const cssHash: SvelteCssHashGetter = ({ css, filename, hash }) => {
		scopeClass = `svelte-${hash(filename === '(unknown)' ? css : (filename ?? css))}`;

		return scopeClass;
	};
	const apply = (code: string) => applyAwaitScopeClass(code, scopeClass);

	return { apply, cssHash };
};

/* Svelte's boolean attributes (svelte/src/utils.js), rendered as `name=""`
 * when truthy and left out when falsy. */
const BOOLEAN_ATTRIBUTES = new Set([
	'allowfullscreen',
	'async',
	'autofocus',
	'autoplay',
	'checked',
	'controls',
	'default',
	'defer',
	'disabled',
	'disablepictureinpicture',
	'disableremoteplayback',
	'formnovalidate',
	'indeterminate',
	'inert',
	'ismap',
	'loop',
	'multiple',
	'muted',
	'nomodule',
	'novalidate',
	'open',
	'playsinline',
	'readonly',
	'required',
	'reversed',
	'seamless',
	'selected',
	'webkitdirectory'
]);
const DIRECTIVE_ATTRIBUTE_RE =
	/^(?:animate|bind|class|in|let|on|out|style|transition|use):/;
const ATTRIBUTE_NAME_END_RE = /[\s=>/{]/;
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

type AttributeChunk = { code: string } | { text: string };

/* Besides the HTML template literal, the scan builds a "shadow" of each
 * branch: its elements and attributes as Svelte markup, with every
 * expression swapped for an opaque value. The lowered component renders the
 * shadow under a condition that is never true, so it costs nothing at run
 * time, but Svelte's CSS analysis sees the branch elements in it. Without it
 * Svelte would prune every selector that only matches elements inside a
 * streamed branch as unused, and the scoped class would style nothing. */
type MarkupScan = {
	branch: string;
	filePath: string | undefined;
	/** Whether the start tag being copied has a class attribute yet. */
	hasClass: boolean;
	index: number;
	literal: string;
	shadow: string;
	source: string;
};

const helperCall = (name: string, ...args: string[]) =>
	`\${${HTML_HELPERS}.${name}(${args.join(', ')})}`;

const SHADOW_VALUE = `{${HTML_HELPERS}.shadow}`;
const END_TAG_RE = /<\/[A-Za-z][^\s>]*\s*>/g;

/** Whether the shadow keeps an attribute: event handlers and directives
 *  don't affect which selectors match, and Svelte would compile them. */
const isShadowAttribute = (name: string) =>
	!DIRECTIVE_ATTRIBUTE_RE.test(name) && !/^on/i.test(name);

const pushText = (scan: MarkupScan, text: string) => {
	scan.literal += escapeTemplateLiteral(text);
};

/** Reads the `{...}` tag at `scan.index` and returns its trimmed contents. */
const readExpressionTag = (scan: MarkupScan) => {
	const end = findTagEnd(scan.source, scan.index);
	if (end === -1) {
		fail(scan.filePath, `unterminated tag in the ${scan.branch} branch`);
	}
	const inner = scan.source.slice(scan.index + 1, end - 1).trim();
	scan.index = end;

	return inner;
};

const failAttribute = (scan: MarkupScan, detail: string) =>
	fail(
		scan.filePath,
		`the ${scan.branch} branch of a streamed {#await} has ${detail}`
	);

/** Whether the scan sits at the end of an attribute value: its closing
 *  quote, or for an unquoted value whitespace or the tag's end. */
const atValueEnd = (scan: MarkupScan, quote: string | undefined) => {
	const char = scan.source[scan.index] ?? '';
	if (quote) return char === quote;

	return /[\s>]/.test(char) || scan.source.startsWith('/>', scan.index);
};

/** Reads attribute-value text up to the next `{` or the value's end. */
const readValueText = (scan: MarkupScan, quote: string | undefined) => {
	const start = scan.index;
	while (
		scan.index < scan.source.length &&
		scan.source[scan.index] !== '{' &&
		!atValueEnd(scan, quote)
	) {
		scan.index += 1;
	}

	return scan.source.slice(start, scan.index);
};

/** Reads an attribute value after its `=`: quoted, a lone `{expression}`,
 *  or unquoted text. */
const readAttributeValue = (scan: MarkupScan) => {
	const { source } = scan;
	const quote = source[scan.index];
	const chunks: AttributeChunk[] = [];
	const isQuoted = quote === '"' || quote === "'";
	if (isQuoted) scan.index += 1;
	if (!isQuoted && source[scan.index] === '{') {
		chunks.push({ code: readExpressionTag(scan) });

		return chunks;
	}
	const valueQuote = isQuoted ? quote : undefined;
	while (scan.index < source.length && !atValueEnd(scan, valueQuote)) {
		chunks.push({ text: readValueText(scan, valueQuote) });
		if (source[scan.index] === '{')
			chunks.push({ code: readExpressionTag(scan) });
	}
	if (isQuoted) scan.index += 1;

	return chunks.filter((chunk) => !('text' in chunk) || chunk.text !== '');
};

/** Emits one attribute whose value holds expressions, through the same
 *  helpers Svelte's SSR uses. */
const pushDynamicAttribute = (
	scan: MarkupScan,
	name: string,
	chunks: AttributeChunk[]
) => {
	// An event handler's value is code, not text: escaping can't make an
	// interpolated value safe there, and Svelte never server-renders one.
	if (DIRECTIVE_ATTRIBUTE_RE.test(name) || /^on/i.test(name)) {
		failAttribute(
			scan,
			`an expression in ${name}= (directives and event handlers need Svelte to run them)`
		);
	}
	const tag = chunks.find(
		(chunk) => 'code' in chunk && /^[#:/@]/.test(chunk.code)
	);
	if (tag && 'code' in tag) {
		failAttribute(scan, `{${tag.code}} in the ${name}= attribute`);
	}
	if (isShadowAttribute(name)) scan.shadow += ` ${name}=${SHADOW_VALUE}`;
	const isClass = name === 'class';
	if (isClass) scan.hasClass = true;
	const [only] = chunks;
	const codes = chunks.flatMap((chunk) =>
		'code' in chunk ? [`(${chunk.code})`] : []
	);
	// `class="{a}{b}"`: Svelte renders it through attr_class, so it gets the
	// scoped class too and is left out when it comes out empty.
	if (isClass && chunks.length > 1 && codes.length === chunks.length) {
		scan.literal += helperCall(
			'class',
			`${HTML_HELPERS}.join(${codes.join(', ')})`
		);

		return;
	}
	if (chunks.length === 1 && only && 'code' in only) {
		const value = `(${only.code})`;
		if (name === 'class') scan.literal += helperCall('class', value);
		else if (name === 'style') scan.literal += helperCall('style', value);
		else
			scan.literal += helperCall(
				'attr',
				JSON.stringify(name),
				value,
				String(BOOLEAN_ATTRIBUTES.has(name))
			);

		return;
	}
	pushText(scan, ` ${name}="`);
	for (const chunk of chunks) {
		if ('code' in chunk)
			scan.literal += helperCall('part', `(${chunk.code})`);
		else pushText(scan, chunk.text.replaceAll('"', '&quot;'));
	}
	if (isClass) scan.literal += helperCall('scoped');
	pushText(scan, '"');
};

/** Copies a static attribute; a class gets the scoped class appended. */
const pushStaticAttribute = (
	scan: MarkupScan,
	whitespace: string,
	name: string,
	value: string
) => {
	if (isShadowAttribute(name)) scan.shadow += `${whitespace}${name}=${value}`;
	if (name !== 'class') {
		pushText(scan, `${whitespace}${name}=${value}`);

		return;
	}
	scan.hasClass = true;
	const [first = ''] = value;
	const isQuoted = first === '"' || first === "'";
	const quote = isQuoted ? first : '"';
	const classes = isQuoted ? value.slice(1, -1) : value;
	// Svelte drops an empty class="" (or makes it the scoped class).
	if (classes === '') {
		scan.literal += helperCall('class', "''");

		return;
	}
	pushText(scan, `${whitespace}${name}=${quote}${classes}`);
	scan.literal += helperCall('scoped');
	pushText(scan, quote);
};

const readAttributeName = (scan: MarkupScan) => {
	const { source } = scan;
	const start = scan.index;
	while (
		scan.index < source.length &&
		!ATTRIBUTE_NAME_END_RE.test(source[scan.index] ?? '')
	) {
		scan.index += 1;
	}

	return source.slice(start, scan.index);
};

const skipWhitespace = (scan: MarkupScan) => {
	const start = scan.index;
	while (/\s/.test(scan.source[scan.index] ?? '')) scan.index += 1;

	return scan.source.slice(start, scan.index);
};

/** Handles a `{...}` directly inside a start tag: the `{name}` shorthand
 *  for `name={name}`; spreads and attachments need Svelte. */
const pushTagExpression = (scan: MarkupScan) => {
	const inner = readExpressionTag(scan);
	if (!/^[A-Za-z_$][\w$]*$/.test(inner)) {
		failAttribute(scan, `{${inner}} in a start tag`);
	}
	pushDynamicAttribute(scan, inner, [{ code: inner }]);
};

/** Reads one attribute (or the tag's end) inside a start tag. Returns
 *  false once the tag is closed. */
const pushAttribute = (scan: MarkupScan) => {
	const { source } = scan;
	const whitespace = skipWhitespace(scan);
	const closing = source.startsWith('/>', scan.index) ? '/>' : '>';
	const isEnd = scan.index >= source.length;
	if (isEnd || source.startsWith(closing, scan.index)) {
		// An element without a class attribute still gets the scoped class.
		if (!scan.hasClass) scan.literal += helperCall('scope');
		const tagEnd = isEnd ? '' : closing;
		pushText(scan, whitespace + tagEnd);
		scan.shadow += whitespace + (isEnd ? '>' : closing);
		scan.index += tagEnd.length;

		return false;
	}
	if (source[scan.index] === '{') {
		pushTagExpression(scan);

		return true;
	}
	const name = readAttributeName(scan);
	if (!name) {
		pushText(scan, whitespace + (source[scan.index] ?? ''));
		scan.index += 1;

		return true;
	}
	const beforeEquals = scan.index;
	skipWhitespace(scan);
	if (source[scan.index] !== '=') {
		scan.index = beforeEquals;
		pushText(scan, whitespace + name);
		if (isShadowAttribute(name)) scan.shadow += whitespace + name;

		return true;
	}
	scan.index += 1;
	skipWhitespace(scan);
	const valueStart = scan.index;
	const chunks = readAttributeValue(scan);
	if (chunks.some((chunk) => 'code' in chunk)) {
		pushDynamicAttribute(scan, name, chunks);

		return true;
	}
	pushStaticAttribute(
		scan,
		whitespace,
		name,
		source.slice(valueStart, scan.index)
	);

	return true;
};

/** Copies a start tag, escaping any expressions in its attributes. Returns
 *  the lower-cased tag name. */
const pushStartTag = (scan: MarkupScan) => {
	const { source } = scan;
	const nameMatch = source.slice(scan.index + 1).match(/^[^\s/>{]+/);
	const tagName = nameMatch?.[0] ?? '';
	pushText(scan, `<${tagName}`);
	scan.shadow += `<${tagName}`;
	// A `<script>` or `<style>` isn't styled, so it doesn't need the class.
	scan.hasClass = RAW_TEXT_ELEMENTS.has(tagName.toLowerCase());
	scan.index += 1 + tagName.length;
	while (pushAttribute(scan));

	return tagName.toLowerCase();
};

/** Copies a raw-text element's content and end tag verbatim: Svelte
 *  doesn't read `{...}` inside `<script>` or `<style>`. The shadow leaves
 *  the element out, `shadowStart` being where its start tag began. */
const pushRawText = (
	scan: MarkupScan,
	tagName: string,
	shadowStart: number
) => {
	const { source } = scan;
	const close = source.toLowerCase().indexOf(`</${tagName}`, scan.index);
	const closeEnd = close === -1 ? -1 : source.indexOf('>', close);
	const end = closeEnd === -1 ? source.length : closeEnd + 1;
	pushText(scan, source.slice(scan.index, end));
	scan.shadow = scan.shadow.slice(0, shadowStart);
	scan.index = end;
};

/** Handles a `{...}` in text: `{@html value}` stays raw, everything else
 *  is escaped as text. */
const pushTextExpression = (scan: MarkupScan) => {
	const inner = readExpressionTag(scan);
	const rawHtml = inner.match(/^@html\s([\s\S]*)$/);
	if (rawHtml) {
		scan.literal += helperCall('html', `(${(rawHtml[1] ?? '').trim()})`);

		return;
	}
	scan.literal += helperCall('text', `(${inner})`);
};

const pushComment = (scan: MarkupScan) => {
	const close = scan.source.indexOf('-->', scan.index + '<!--'.length);
	const end = close === -1 ? scan.source.length : close + '-->'.length;
	pushText(scan, scan.source.slice(scan.index, end));
	scan.index = end;
};

/** Advances the scan by one construct in text position. */
const scanTextPosition = (scan: MarkupScan) => {
	const { index, source } = scan;
	if (source.startsWith('<!--', index)) {
		pushComment(scan);

		return;
	}
	if (source[index] === '<' && /[A-Za-z]/.test(source[index + 1] ?? '')) {
		const shadowStart = scan.shadow.length;
		const tagName = pushStartTag(scan);
		if (RAW_TEXT_ELEMENTS.has(tagName))
			pushRawText(scan, tagName, shadowStart);

		return;
	}
	if (source[index] === '{') {
		pushTextExpression(scan);

		return;
	}
	const next = source.slice(index + 1).search(/[<{]/);
	const end = next === -1 ? source.length : index + 1 + next;
	const text = source.slice(index, end);
	pushText(scan, text);
	// The shadow keeps the element structure only: end tags, not text.
	scan.shadow += (text.match(END_TAG_RE) ?? []).join('');
	scan.index = end;
};

/** Lowers a branch's markup to a JS template literal that renders it,
 *  escaping every expression as Svelte's SSR would, and to its shadow. */
const lowerBranch = (markup: string, branch: string, filePath?: string) => {
	const scan: MarkupScan = {
		branch,
		filePath,
		hasClass: false,
		index: 0,
		literal: '',
		shadow: '',
		source: markup.trim()
	};
	while (scan.index < scan.source.length) scanTextPosition(scan);

	return { literal: `\`${scan.literal}\``, shadow: scan.shadow };
};

/** Turns a branch's markup into a JS template literal that renders it,
 *  escaping every expression as Svelte's SSR would. */
export const branchMarkupToTemplateLiteral = (
	markup: string,
	branch = 'then',
	filePath?: string
) => lowerBranch(markup, branch, filePath).literal;

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
	// `{@html value}` streams raw, as in Svelte; every other block or tag
	// (`{#if}`, `{@const}`, `{@render}`, …) needs Svelte to run it.
	const nestedTag = topLevelTags(markup).find(({ text }) =>
		/^\{(?:[#:/]|@(?!html\s))/.test(text)
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

const renderSlot = (
	block: StreamedAwait,
	slotId: string,
	dynamic: boolean,
	filePath: string | undefined
) => {
	const thenValueIdentifier = block.thenIdentifier ?? '__awaitValue';
	const catchValueIdentifier = block.catchIdentifier ?? '__awaitError';
	const pending = lowerBranch(block.pendingMarkup, 'pending', filePath);
	const then = lowerBranch(block.thenMarkup, 'then', filePath);
	const caught =
		block.catchMarkup === undefined
			? undefined
			: lowerBranch(block.catchMarkup, 'catch', filePath);
	const catchBranch = caught
		? `catch (${catchValueIdentifier}) { return ${caught.literal}; }`
		: 'catch (_absoluteAwaitError) { throw _absoluteAwaitError; }';
	// Each branch's shadow sits in a stand-in for the slot's wrapper
	// (`StreamSlot.svelte`'s div). `<svelte:element>` keeps Svelte from
	// checking the branch's elements against the page's own nesting (the
	// real wrapper lives in another component, so the page never sees it).
	const shadows = [pending, then, caught]
		.map((branch) =>
			branch
				? `<svelte:element this={'div'} data-absolute-slot="true">${branch.shadow}</svelte:element>`
				: ''
		)
		.join('');

	return `<AbsoluteAwaitSlot id="${slotId}"${dynamic ? ' dynamic' : ''} fallbackHtml={${
		pending.literal
	}} resolve={async () => { try { const ${thenValueIdentifier} = await (${
		block.expression
	}); return ${then.literal}; } ${catchBranch} }} />{#if ${HTML_HELPERS}.shadow}${shadows}{/if}`;
};

/* The index alone is not an id. It restarts at zero in every file, so
 * two components that each stream one `{#await}` both produced
 * `absolute-svelte-await-0` — measured by lowering two files and reading
 * the ids back. A slot id is how a streamed chunk finds the placeholder
 * it belongs to, so on a page rendering both components the second
 * chunk's content could land in the first component's hole.
 *
 * The file is folded in as a short hash rather than a readable path: the
 * id goes in an attribute the server writes and the client matches, so it
 * has to be stable, short, and free of characters a path would bring with
 * it. Deterministic, because SSR and hydration both compute it — a random
 * id would differ between the two and match nothing.
 *
 * The path is hashed RELATIVE TO THE PROJECT ROOT, with separators
 * normalised. The value handed in is absolute — a resolved path on the
 * build machine — so hashing it as-is would give the same component a
 * different id in a different checkout, and two builds of the same source
 * would differ byte for byte for no reason. Only the server and client
 * halves of ONE build have to agree, so that would not break anything;
 * it would just make a reproducible build impossible to verify. */
const FILE_HASH_LENGTH = 6;

const awaitSlotFileHash = (filePath: string | undefined) => {
	if (filePath === undefined) return 'anon';
	const normalized = filePath.replaceAll('\\', '/');
	const root = projectRoot.replaceAll('\\', '/');
	const withinProject = normalized.startsWith(`${root}/`)
		? normalized.slice(root.length + 1)
		: normalized;
	const hasher = new Bun.CryptoHasher('sha256');
	hasher.update(withinProject);

	return hasher.digest('hex').slice(0, FILE_HASH_LENGTH);
};

const awaitSlotId = (filePath: string | undefined, index: number) =>
	`absolute-svelte-await-${awaitSlotFileHash(filePath)}-${index.toString(BASE_36_RADIX)}`;

const IMPORT_LINE =
	'import AbsoluteAwaitSlot from "@absolutejs/absolute/svelte/components/AwaitSlot.svelte";';
const INJECTED_SCRIPT = `${IMPORT_LINE}\n${AWAIT_HTML_HELPERS_SOURCE}`;

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
		const slotId = awaitSlotId(filePath, awaitIndex);
		awaitIndex += 1;
		lowered += source.slice(cursor, directive.index);
		lowered += renderSlot(
			block,
			slotId,
			directive[1] !== undefined,
			filePath
		);
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
				(match) => `${match}\n${INJECTED_SCRIPT}\n`
			),
			transformed: true
		};
	}

	return {
		code: `<script lang="ts">\n${INJECTED_SCRIPT}\n</script>\n${lowered}`,
		transformed: true
	};
};
