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

/** Index of the `>` ending the tag that starts at `start`, skipping quoted
 *  attribute values. */
const findTagClose = (html: string, start: number) => {
	const match = /^<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/.exec(
		html.slice(start)
	);

	return match ? start + match[0].length : -1;
};

/** The first `<tag …>…</tag>` (or `<tag …/>`) at or after `from`, with its
 *  closing tag matched across nested elements of the same name. */
const findElement = (html: string, tag: string, from: number) => {
	const opening = new RegExp(`<${tag}(?=[\\s/>])`, 'gi');
	opening.lastIndex = from;
	const first = opening.exec(html);
	if (!first) return null;
	const tagEnd = findTagClose(html, first.index);
	if (tagEnd === -1) return null;
	const attributes = html.slice(first.index + tag.length + 1, tagEnd - 1);
	if (attributes.trimEnd().endsWith('/')) {
		const selfClosing: Element = {
			attributes: attributes.trimEnd().slice(0, -1),
			end: tagEnd,
			inner: '',
			start: first.index
		};

		return selfClosing;
	}

	const tokens = new RegExp(`<${tag}(?=[\\s/>])|</${tag}\\s*>`, 'gi');
	tokens.lastIndex = tagEnd;
	let depth = 1;
	let token = tokens.exec(html);
	while (token && depth > 0) {
		depth += token[0].startsWith('</') ? -1 : 1;
		if (depth > 0) token = tokens.exec(html);
	}
	if (!token) return null;
	const element: Element = {
		attributes,
		end: token.index + token[0].length,
		inner: html.slice(tagEnd, token.index),
		start: first.index
	};

	return element;
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

	// Expand first: `dependencies` fills in as includes are read.
	const expanded = expandWithin(html, file, context);

	return { dependencies: [...context.dependencies], html: expanded };
};
