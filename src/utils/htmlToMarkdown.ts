/* A page's HTML as Markdown, for a reader that wants the text.
 *
 * Written on Bun's own HTML parser (`HTMLRewriter`), so it costs no
 * dependency. It is deliberately small: headings, paragraphs, links,
 * emphasis, code, lists, quotes, images and simple tables become their
 * Markdown, and any other element is read for its text. That is what a
 * page's content is made of; a converter that tried to carry every
 * element across would mostly carry layout.
 *
 * What is converted is the page's `<main>`, or failing that its
 * `<article>`, or failing that its body without the parts that are the
 * site's rather than the page's: navigation, header, footer, aside and
 * forms. Scripts, styles and templates are never text.
 *
 * `HTMLRewriter` reports start tags, end tags and text, not a tree: an
 * element whose end tag was left out (`<li>one<li>two`) is closed here
 * by the rules a browser uses for the common cases, and anything still
 * open when its parent ends is closed with it. */

const BLOCKS = new Set([
	'address',
	'article',
	'blockquote',
	'details',
	'div',
	'dl',
	'dd',
	'dt',
	'fieldset',
	'figcaption',
	'figure',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'li',
	'main',
	'ol',
	'p',
	'pre',
	'section',
	'summary',
	'table',
	'ul'
]);
/* Never text, wherever they are. */
const UNREAD = new Set([
	'button',
	'canvas',
	'dialog',
	'head',
	'iframe',
	'input',
	'noscript',
	'object',
	'script',
	'select',
	'style',
	'svg',
	'template',
	'textarea',
	'video'
]);
/* The site's, not the page's: left out when the page marks no `<main>`
 * or `<article>` of its own. */
const SITE_CHROME = new Set(['aside', 'footer', 'form', 'header', 'nav']);
const HEADING_RE = /^h([1-6])$/;
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	copy: '©',
	gt: '>',
	hellip: '…',
	laquo: '«',
	ldquo: '“',
	lsquo: '‘',
	lt: '<',
	mdash: '—',
	nbsp: ' ',
	ndash: '–',
	quot: '"',
	raquo: '»',
	rdquo: '”',
	reg: '®',
	rsquo: '’',
	trade: '™'
};
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

const codePoint = (value: number, fallback: string) => {
	try {
		return String.fromCodePoint(value);
	} catch {
		return fallback;
	}
};

const decodeEntities = (text: string) =>
	text.replace(
		/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi,
		(match, hex?: string, decimal?: string, name?: string) => {
			if (hex) return codePoint(Number.parseInt(hex, HEX_RADIX), match);
			if (decimal)
				return codePoint(
					Number.parseInt(decimal, DECIMAL_RADIX),
					match
				);

			return NAMED_ENTITIES[(name ?? '').toLowerCase()] ?? match;
		}
	);

/* The characters that would start Markdown of their own in running
 * text. Underscores inside a word do not, and escaping them would put
 * a backslash in every identifier. */
const escapeText = (text: string) => text.replace(/[\\`*[\]<]/g, '\\$&');

type Frame = {
	attributes: Record<string, string | null>;
	cells: string[];
	/** A list's next number, when it is an ordered one. */
	counter: number;
	parts: string[];
	rows: string[][];
	tag: string;
	unread: boolean;
};

const frameFor = (
	tag: string,
	unread: boolean,
	attributes: Record<string, string | null> = {}
) => {
	const frame: Frame = {
		attributes,
		cells: [],
		counter: Number.parseInt(attributes.start ?? '1', DECIMAL_RADIX) || 1,
		parts: [],
		rows: [],
		tag,
		unread
	};

	return frame;
};

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

const block = (text: string) => {
	const trimmed = text.trim();

	return trimmed === '' ? '' : `\n\n${trimmed}\n\n`;
};

const indent = (text: string, prefix: string) =>
	text
		.split('\n')
		.map((line, index) =>
			index === 0 || line === '' ? line : prefix + line
		)
		.join('\n');

const tidy = (text: string) => text.trim().replace(/\n{3,}/g, '\n\n');

const fence = (code: string) => {
	const longest = Math.max(
		2,
		...(code.match(/`+/g) ?? []).map((run) => run.length)
	);

	return '`'.repeat(longest + 1);
};

const LANGUAGE_RE = /(?:^|\s)lang(?:uage)?-([\w+#-]+)/;

const tableOf = (rows: string[][]) => {
	const [header, ...body] = rows.filter((row) => row.length > 0);
	if (!header) return '';
	const line = (cells: string[]) =>
		`| ${header.map((_, index) => cells[index] ?? '').join(' | ')} |`;

	return block(
		[line(header), line(header.map(() => '---')), ...body.map(line)].join(
			'\n'
		)
	);
};

/* A space or a parenthesis would end the address. */
const encodeAddress = (address: string) =>
	address.replace(
		/[\s()]/g,
		(char) => `%${char.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`
	);

const linkOf = (inner: string, href: string | null | undefined) => {
	const text = oneLine(inner);
	if (text === '') return '';
	if (!href || href.startsWith('javascript:')) return text;

	return `[${text}](${encodeAddress(href)})`;
};

const imageOf = (attributes: Record<string, string | null>) => {
	const { alt, src } = attributes;
	if (!src || src.startsWith('data:')) return oneLine(alt ?? '');

	return `![${escapeText(oneLine(alt ?? ''))}](${encodeAddress(src)})`;
};

const wrapped = (inner: string, mark: string) => {
	const text = inner.trim();
	if (text === '') return inner;
	const lead = inner.startsWith(' ') ? ' ' : '';
	const trail = inner.endsWith(' ') ? ' ' : '';

	return `${lead}${mark}${text}${mark}${trail}`;
};

const inlineCode = (inner: string) => {
	const code = inner.trim();
	if (code === '') return '';
	const mark = code.includes('`') ? '``' : '`';

	return `${mark}${code.includes('`') ? ` ${code} ` : code}${mark}`;
};

const preOf = (frame: Frame, inner: string) => {
	const code = inner.replace(/^\n/, '').replace(/\s+$/, '');
	const mark = fence(code);
	const [, language = ''] =
		LANGUAGE_RE.exec(frame.attributes.codeClass ?? '') ?? [];

	return `\n\n${mark}${language}\n${code}\n${mark}\n\n`;
};

type Markup = (frame: Frame, inner: string, parent: Frame) => string;

/* What a closed element contributes to its parent. Anything not named
 * here contributes its text, as a block or in line. */
const MARKUP: Record<string, Markup> = {
	a: (frame, inner) => linkOf(inner, frame.attributes.href),
	b: (_, inner) => wrapped(inner, '**'),
	blockquote: (_, inner) =>
		block(
			tidy(inner)
				.split('\n')
				.map((line) => (line === '' ? '>' : `> ${line}`))
				.join('\n')
		),
	code: (_, inner, parent) =>
		parent.tag === 'pre' ? inner : inlineCode(inner),
	del: (_, inner) => wrapped(inner, '~~'),
	em: (_, inner) => wrapped(inner, '*'),
	i: (_, inner) => wrapped(inner, '*'),
	li: (_, inner, parent) => {
		const marker = parent.tag === 'ol' ? `${parent.counter}. ` : '- ';
		if (parent.tag === 'ol') parent.counter += 1;

		// A list inside an item follows its text directly.
		const text = tidy(inner).replace(/\n\n(?=- |\d+\. )/g, '\n');

		return `\n${marker}${indent(text, ' '.repeat(marker.length))}`;
	},
	ol: (_, inner) => block(inner),
	pre: (frame, inner) => preOf(frame, inner),
	s: (_, inner) => wrapped(inner, '~~'),
	strong: (_, inner) => wrapped(inner, '**'),
	table: (frame) => tableOf(frame.rows),
	ul: (_, inner) => block(inner)
};

const cellOf = (inner: string) => oneLine(inner).replace(/\|/g, '\\|');

const closeFrame = (frame: Frame, parent: Frame) => {
	if (frame.unread) return;
	const inner = frame.parts.join('');
	const { tag } = frame;
	if (tag === 'td' || tag === 'th') {
		parent.cells.push(cellOf(inner));

		return;
	}
	if (tag === 'tr') {
		// The row belongs to the table, through any tbody or thead.
		parent.rows.push(frame.cells);

		return;
	}
	if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
		parent.rows.push(...frame.rows);

		return;
	}
	const heading = HEADING_RE.exec(tag);
	if (heading) {
		const text = oneLine(inner);
		parent.parts.push(
			text === ''
				? ''
				: block(`${'#'.repeat(Number(heading[1]))} ${text}`)
		);

		return;
	}
	const markup = MARKUP[tag];
	if (markup) {
		parent.parts.push(markup(frame, inner, parent));

		return;
	}
	parent.parts.push(BLOCKS.has(tag) ? block(inner) : inner);
};

/* The open elements a start tag closes, where an end tag may be left
 * out: an `<li>` ends the one before it, and so on. */
const IMPLIED_END: Record<string, readonly string[]> = {
	dd: ['dd', 'dt'],
	dt: ['dd', 'dt'],
	li: ['li'],
	td: ['td', 'th'],
	th: ['td', 'th'],
	// Closing the row closes the cell left open in it.
	tr: ['tr']
};
/* …and what stops the search for one: an `<li>` in a nested list does
 * not end the item the list is in. */
const IMPLIED_END_SCOPE = new Set(['ol', 'table', 'ul']);

const impliedEnds = (tag: string) =>
	IMPLIED_END[tag] ?? (BLOCKS.has(tag) ? ['p'] : []);

type Conversion = { stack: Frame[]; unreadTags: ReadonlySet<string> };

const top = ({ stack }: Conversion) => stack[stack.length - 1];

const popTo = (conversion: Conversion, index: number) => {
	const { stack } = conversion;
	while (stack.length > index) {
		const frame = stack.pop();
		const parent = top(conversion);
		if (frame && parent) closeFrame(frame, parent);
	}
};

const closeImplied = (conversion: Conversion, tag: string) => {
	const closes = impliedEnds(tag);
	if (closes.length === 0) return;
	const { stack } = conversion;
	const scope = stack.findLastIndex((frame) =>
		IMPLIED_END_SCOPE.has(frame.tag)
	);
	const open = stack.findLastIndex((frame) => closes.includes(frame.tag));
	if (open > Math.max(scope, 0)) popTo(conversion, open);
};

const attributesOf = (element: HTMLRewriterTypes.Element) =>
	Object.fromEntries(
		['alt', 'class', 'href', 'src', 'start'].flatMap((name) => {
			const value = element.getAttribute(name);

			return value === null ? [] : [[name, decodeEntities(value)]];
		})
	);

const VOID_MARKUP: Record<
	string,
	(attributes: Record<string, string | null>) => string
> = {
	br: () => '  \n',
	hr: () => '\n\n---\n\n',
	img: (attributes) => imageOf(attributes)
};

const startElement = (
	conversion: Conversion,
	element: HTMLRewriterTypes.Element
) => {
	const tag = element.tagName.toLowerCase();
	closeImplied(conversion, tag);
	const parent = top(conversion);
	if (!parent) return;
	const attributes = attributesOf(element);
	if (!element.canHaveContent) {
		const markup = VOID_MARKUP[tag];
		if (markup && !parent.unread) parent.parts.push(markup(attributes));

		return;
	}
	// A code block's language is on the `<code>` inside the `<pre>`.
	if (tag === 'code' && parent.tag === 'pre')
		parent.attributes.codeClass = attributes.class ?? null;
	const frame = frameFor(
		tag,
		parent.unread || conversion.unreadTags.has(tag),
		attributes
	);
	conversion.stack.push(frame);
	element.onEndTag(() => {
		const index = conversion.stack.lastIndexOf(frame);
		if (index > 0) popTo(conversion, index);
	});
};

const addText = (conversion: Conversion, raw: string) => {
	const frame = top(conversion);
	if (!frame || frame.unread || raw === '') return;
	const isCode = conversion.stack.some(
		({ tag }) => tag === 'pre' || tag === 'code'
	);
	const text = decodeEntities(raw);
	if (isCode) {
		frame.parts.push(text);

		return;
	}
	const collapsed = text.replace(/\s+/g, ' ');
	// Space between two blocks is the source's layout, not the page's.
	const previous = frame.parts[frame.parts.length - 1] ?? '\n';
	if (collapsed === ' ' && previous.endsWith('\n')) return;
	frame.parts.push(escapeText(collapsed));
};

const ELEMENT_RE = (tag: string) =>
	new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*</${tag}\\s*>`, 'i');

/* The part of the document that is the page: its `<main>`, its
 * `<article>`, or its body. */
const contentOf = (html: string) => {
	const [marked] =
		ELEMENT_RE('main').exec(html) ?? ELEMENT_RE('article').exec(html) ?? [];
	if (marked) return { html: marked, isMarked: true };
	const [body] = ELEMENT_RE('body').exec(html) ?? [];

	return { html: body ?? html, isMarked: false };
};

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;

const titleOf = (html: string) => {
	const [, title = ''] = TITLE_RE.exec(html) ?? [];

	return oneLine(decodeEntities(title));
};

/** The page in `html` as Markdown. Headed by the document's title when
 *  the content has no top-level heading of its own. */
export const htmlToMarkdown = async (html: string) => {
	const content = contentOf(html);
	const conversion: Conversion = {
		stack: [frameFor('#root', false)],
		unreadTags: content.isMarked
			? UNREAD
			: new Set([...UNREAD, ...SITE_CHROME])
	};
	await new HTMLRewriter()
		.on('*', {
			element: (element) => startElement(conversion, element),
			text: (chunk) => addText(conversion, chunk.text)
		})
		.transform(new Response(content.html))
		.text();
	popTo(conversion, 1);
	const markdown = tidy(
		(conversion.stack[0]?.parts.join('') ?? '')
			.replace(/[ \t]+\n/g, (spaces) =>
				spaces === '  \n' ? spaces : '\n'
			)
			.replace(/\n[ \t]+(?=\n)/g, '\n')
	);
	const title = titleOf(html);
	const headed =
		title === '' || /^# /m.test(markdown)
			? markdown
			: `# ${escapeText(title)}\n\n${markdown}`;

	return `${headed.trim()}\n`;
};

const SLOT_PATCH_RE =
	/__ABS_SLOT_PENDING__\[i\]=p;\}\)\(("(?:[^"\\]|\\.)*"),([\s\S]*?)\);<\/script>/g;

const patchOf = (id: string, payload: string) => {
	try {
		const parsedId: unknown = JSON.parse(id);
		const parsed: unknown = JSON.parse(payload);
		const html =
			typeof parsed === 'object' && parsed !== null
				? Reflect.get(parsed, 'html')
				: parsed;

		return typeof parsedId === 'string' && typeof html === 'string'
			? [{ html, id: parsedId }]
			: [];
	} catch {
		return [];
	}
};

/** `html` with each streamed slot's content where its fallback is.
 *
 *  A streamed slot is sent as its fallback, and its content follows in
 *  the same response inside the script that swaps it in
 *  (utils/streamingSlots.ts). A reader of the text gets the fallback.
 *  This does the swap the script would, so the Markdown of a page says
 *  what the page says. */
export const inlineStreamedSlots = async (html: string) => {
	const patches = [...html.matchAll(SLOT_PATCH_RE)].flatMap(
		([, id = '', payload = '']) => patchOf(id, payload)
	);
	if (patches.length === 0) return html;
	const rewriter = patches.reduce(
		(pending, patch) =>
			pending.on(`[id=${JSON.stringify(patch.id)}]`, {
				element: (element) => {
					element.setInnerContent(patch.html, { html: true });
				}
			}),
		new HTMLRewriter()
	);

	return rewriter.transform(new Response(html)).text();
};
