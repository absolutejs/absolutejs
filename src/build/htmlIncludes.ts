import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/* Build-time includes for HTML and HTMX pages.
 *
 *   <abs-include src="../partials/header.html"></abs-include>
 *
 * is replaced with that file's contents; `src` is relative to the file that
 * contains the tag, and included files may include others. A layout marks
 * where content goes with <abs-slot></abs-slot> (default) and
 * <abs-slot name="head"></abs-slot> (named); whatever an <abs-slot> holds
 * is its fallback. A page fills them through the include's children:
 *
 *   <abs-include src="../layouts/base.html">
 *     <template slot="head"><title>About</title></template>
 *     <main>…</main>                        ← the default slot
 *   </abs-include>
 *
 * Each of these tags may also be written self-closing, as an empty element
 * (<abs-include src="…" />, <abs-slot name="head" />), anywhere, including
 * inside another include's children. An unclosed <abs-include> or
 * <abs-slot> fails the build with its file and line.
 *
 * HTML only, no expressions. Runs on the copied pages before asset paths,
 * images and islands are processed, so included markup gets all three. */

export type HtmlIncludeResult = {
	/** Every file pulled in, directly or through another include. */
	dependencies: string[];
	html: string;
};

type ReadFile = (path: string) => string;

type Element = {
	attributes: string;
	/** Index just past the element (closing tag included). */
	end: number;
	inner: string;
	start: number;
};

type ExpandContext = {
	chain: string[];
	dependencies: Set<string>;
	readFile: ReadFile;
	root: string;
};

const describe = (path: string, root: string) => relative(root, path) || path;

const includeError = (context: ExpandContext, message: string) =>
	new Error(
		`${message}\n  include chain: ${context.chain
			.map((path) => describe(path, context.root))
			.join(' → ')}`
	);

/** Index just past the `>` ending the tag that starts at `start`, skipping
 *  quoted attribute values (so `src="a/b.html"` or `data-x="a>b"` neither
 *  ends nor self-closes it); -1 when the tag never ends. */
const findTagClose = (html: string, start: number) => {
	const match = /^<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/.exec(
		html.slice(start)
	);

	return match ? start + match[0].length : -1;
};

type Tag = {
	/** Raw text between the tag name and `>` (a self-closing `/` removed). */
	attributes: string;
	closing: boolean;
	/** Index just past the tag's `>`; -1 when the tag never ends. */
	end: number;
	selfClosing: boolean;
	start: number;
};

const readOpeningTag = (html: string, tag: string, start: number) => {
	const end = findTagClose(html, start);
	const raw = html.slice(
		start + tag.length + 1,
		end === -1 ? html.length : end - 1
	);
	const selfClosing = end !== -1 && raw.trimEnd().endsWith('/');
	const opening: Tag = {
		attributes: selfClosing ? raw.trimEnd().slice(0, -1) : raw,
		closing: false,
		end,
		selfClosing,
		start
	};

	return opening;
};

/** The next `<tag …>`, `<tag …/>` or `</tag>` at or after `from`. Callers
 *  continue from the previous tag's `end`, which skips its attributes as a
 *  whole, so a quoted value can't hide or fake a tag. */
const nextTag = (html: string, tag: string, from: number) => {
	const tokens = new RegExp(`<${tag}(?=[\\s/>])|</${tag}\\s*>`, 'gi');
	tokens.lastIndex = from;
	const token = tokens.exec(html);
	if (!token) return null;
	if (!token[0].startsWith('</'))
		return readOpeningTag(html, tag, token.index);
	const closing: Tag = {
		attributes: '',
		closing: true,
		end: token.index + token[0].length,
		selfClosing: false,
		start: token.index
	};

	return closing;
};

/** How a tag changes the nesting depth: a self-closing one is an empty
 *  element, so it opens nothing. */
const depthChange = (token: Tag) => {
	if (token.selfClosing) return 0;

	return token.closing ? -1 : 1;
};

/** The first `<tag …>…</tag>` (or self-closing `<tag …/>`) at or after
 *  `from`, its closing tag matched across nested elements of the same name.
 *  Null when there is none or it never closes. */
const findElement = (html: string, tag: string, from: number) => {
	let open = nextTag(html, tag, from);
	// A stray `</tag>` before any opening one is left as it is.
	while (open?.closing) open = nextTag(html, tag, open.end);
	if (!open || open.end === -1) return null;
	if (open.selfClosing) {
		const empty: Element = {
			attributes: open.attributes,
			end: open.end,
			inner: '',
			start: open.start
		};

		return empty;
	}
	let depth = 1;
	let token = nextTag(html, tag, open.end);
	while (token && token.end !== -1) {
		depth += depthChange(token);
		if (depth === 0) break;
		token = nextTag(html, tag, token.end);
	}
	if (!token || token.end === -1) return null;
	const element: Element = {
		attributes: open.attributes,
		end: token.end,
		inner: html.slice(open.end, token.start),
		start: open.start
	};

	return element;
};

const lineOf = (html: string, index: number) =>
	html.slice(0, index).split('\n').length;

/** Fails on a `tag` in one file's own source that never ends, never closes
 *  or closes nothing, naming the file and line. Left alone, the expansion
 *  would stop there and ship the raw tags. */
const assertBalanced = (
	html: string,
	tag: string,
	file: string,
	context: ExpandContext
) => {
	const open: Tag[] = [];
	let token = nextTag(html, tag, 0);
	while (token) {
		const where = `${describe(file, context.root)}:${lineOf(html, token.start)}`;
		if (token.end === -1)
			throw includeError(
				context,
				`Unterminated <${tag}> tag in ${where}`
			);
		if (token.closing && !open.pop())
			throw includeError(
				context,
				`</${tag}> without a matching <${tag}> in ${where}`
			);
		if (!token.closing && !token.selfClosing) open.push(token);
		token = nextTag(html, tag, token.end);
	}
	const [unclosed] = open;
	if (!unclosed) return;
	throw includeError(
		context,
		`Unclosed <${tag}${unclosed.attributes.trimEnd()}> in ${describe(file, context.root)}:${lineOf(html, unclosed.start)}: close it with </${tag}> or make it self-closing (<${tag} … />)`
	);
};

const INCLUDE_TAGS = ['abs-include', 'abs-slot'];

/** Checks a file's own source before any of it is expanded, so the line
 *  numbers are that file's. */
const assertIncludeTagsBalanced = (
	html: string,
	file: string,
	context: ExpandContext
) => {
	for (const tag of INCLUDE_TAGS) assertBalanced(html, tag, file, context);
};

const readAttribute = (attributes: string, name: string) =>
	new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
		.exec(attributes)
		?.slice(1)
		.find((value) => value !== undefined);

const replaceElements = (
	html: string,
	tag: string,
	replace: (element: Element) => string
) => {
	let output = '';
	let cursor = 0;
	let element = findElement(html, tag, 0);
	while (element) {
		output += html.slice(cursor, element.start) + replace(element);
		cursor = element.end;
		element = findElement(html, tag, cursor);
	}

	return output + html.slice(cursor);
};

const DEFAULT_SLOT = '';

/** Splits an include's children into slot values: `<template slot="x">`
 *  children by name, everything else as the default slot. */
const collectSlotValues = (children: string) => {
	const values = new Map<string, string>();
	const rest = replaceElements(children, 'template', (element) => {
		const slot = readAttribute(element.attributes, 'slot');
		if (slot === undefined)
			return children.slice(element.start, element.end);
		values.set(slot, (values.get(slot) ?? '') + element.inner);

		return '';
	});
	if (rest.trim() !== '') values.set(DEFAULT_SLOT, rest);

	return values;
};

const fillSlots = (html: string, values: Map<string, string>) =>
	replaceElements(html, 'abs-slot', (element) => {
		const name = readAttribute(element.attributes, 'name') ?? DEFAULT_SLOT;

		return (
			values.get(name === 'default' ? DEFAULT_SLOT : name) ??
			element.inner
		);
	});

const expandWithin = (
	html: string,
	file: string,
	context: ExpandContext
): string =>
	replaceElements(html, 'abs-include', (element) => {
		const src = readAttribute(element.attributes, 'src');
		if (!src)
			throw includeError(
				context,
				`<abs-include> without a src in ${describe(file, context.root)}`
			);
		const target = resolve(dirname(file), src);
		const chain = [...context.chain, target];
		if (context.chain.includes(target)) {
			throw includeError(
				{ ...context, chain },
				`Include cycle: ${describe(target, context.root)} includes itself`
			);
		}
		let source: string;
		try {
			source = context.readFile(target);
		} catch {
			throw includeError(
				{ ...context, chain },
				`<abs-include src="${src}"> in ${describe(file, context.root)}: file not found (${target})`
			);
		}
		context.dependencies.add(target);
		assertIncludeTagsBalanced(source, target, { ...context, chain });
		// The children belong to the including file: expand them there,
		// then place them into the included file's slots before expanding
		// its own includes (so a layout can pass slots on to another).
		const values = new Map(
			[...collectSlotValues(element.inner)].map(([name, value]) => [
				name,
				expandWithin(value, file, context)
			])
		);

		return expandWithin(fillSlots(source, values), target, {
			...context,
			chain
		});
	});

const readUtf8: ReadFile = (path) => readFileSync(path, 'utf-8');

/** The files `filePath` includes, directly or through other includes.
 *  Empty when it includes nothing or can't be read/expanded. */
export const collectHtmlIncludeDependencies = (filePath: string) => {
	try {
		return expandHtmlIncludes(readUtf8(filePath), filePath).dependencies;
	} catch {
		return [];
	}
};

/** Expands every <abs-include> in `html`, which was read from `filePath`.
 *  Throws on a missing file or an include cycle, naming the chain. */
export const expandHtmlIncludes = (
	html: string,
	filePath: string,
	options: { readFile?: ReadFile; root?: string } = {}
): HtmlIncludeResult => {
	const file = resolve(filePath);
	if (!/<abs-include(?=[\s/>])/i.test(html))
		return { dependencies: [], html };
	const context: ExpandContext = {
		chain: [file],
		dependencies: new Set(),
		readFile: options.readFile ?? readUtf8,
		root: options.root ?? process.cwd()
	};

	assertIncludeTagsBalanced(html, file, context);
	// Expand first: `dependencies` fills in as includes are read.
	const expanded = expandWithin(html, file, context);

	return { dependencies: [...context.dependencies], html: expanded };
};
