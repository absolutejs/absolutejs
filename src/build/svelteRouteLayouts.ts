/* Wrapping a Svelte file route in its layouts.
 *
 * React composes layouts at run time, in two places that have to agree
 * (`react/fileRoute.ts` and the generated hydration index). Svelte cannot:
 * its page renders from one compiled module, which both the server and the
 * client load. So the wrapping happens in the SOURCE, once, and the two
 * sides agree by construction — there is only one module.
 *
 * The page's markup is wrapped in `<Layout0><Layout1>…</Layout1></Layout0>`,
 * outermost first, and each layout renders `{@render children()}` the way
 * any Svelte 5 component takes slotted content.
 *
 * `<svelte:…>` elements are hoisted out of the wrapper rather than wrapped
 * with the rest. `<svelte:options>` must be at the top level of a
 * component, and the others carry placement rules of their own; keeping
 * them where they are is both correct and the conservative choice, since a
 * wrapped one would fail to compile with an error about the layout rather
 * than about the page.
 *
 * An injected `import` is also what makes the layout COMPILE: compileSvelte
 * discovers a file route's children from its imports, so the layout is
 * built and its specifier rewritten with the rest.
 */

type Node = { end: number; start: number; type: string };

type ParseSvelte = (
	source: string,
	options: { modern: true }
) => { fragment?: unknown; instance?: unknown; module?: unknown };

const isNode = (value: unknown): value is Node =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'type') === 'string' &&
	typeof Reflect.get(value, 'start') === 'number' &&
	typeof Reflect.get(value, 'end') === 'number';

const nodesOf = (value: unknown) =>
	Array.isArray(value) ? value.filter(isNode) : [];

/* A `<svelte:…>` element, which the Svelte AST names by its own node type
 * rather than as a regular element. */
const SVELTE_NODE_TYPES = new Set([
	'SvelteBody',
	'SvelteBoundary',
	'SvelteDocument',
	'SvelteHead',
	'SvelteOptions',
	'SvelteWindow'
]);

const isSvelteElement = (node: Node) => SVELTE_NODE_TYPES.has(node.type);

/** A local component name for each layout, stable and collision-free
 *  within the file: `AbsRouteLayout0`, `AbsRouteLayout1`, …
 *
 *  It has to START WITH A CAPITAL: Svelte reads a lowercase or
 *  underscore-prefixed tag as an element, not a component, and refuses it
 *  with `tag_invalid_name`. A leading `__` was the first attempt and every
 *  Svelte route in the fixture failed to build. */
const localNameFor = (index: number) => `AbsRouteLayout${index}`;

export type SvelteLayoutWrap = {
	/** Import specifiers for the layouts, outermost first. */
	specifiers: readonly string[];
};

/** The page's source with its markup wrapped in the layouts, or `null`
 *  when there is nothing to wrap. */
export const wrapSvelteRouteLayouts = (
	source: string,
	{ specifiers }: SvelteLayoutWrap,
	parse: ParseSvelte
) => {
	if (specifiers.length === 0) return null;
	let ast: { fragment?: unknown; instance?: unknown; module?: unknown };
	try {
		ast = parse(source, { modern: true });
	} catch {
		// The compiler reports the syntax error itself, against the source
		// as the author wrote it.
		return null;
	}
	const nodes = nodesOf(Reflect.get(ast.fragment ?? {}, 'nodes'));
	const wrappable = nodes.filter((node) => !isSvelteElement(node));
	const hoisted = nodes.filter(isSvelteElement);
	const imports = specifiers
		.map(
			(specifier, index) =>
				`\timport ${localNameFor(index)} from '${specifier}';`
		)
		.join('\n');
	const open = specifiers
		.map((_, index) => `<${localNameFor(index)}>`)
		.join('');
	const close = specifiers
		.map((_, index) => `</${localNameFor(specifiers.length - 1 - index)}>`)
		.join('');

	/* Both edits are expressed against the ORIGINAL source and applied
	 * back to front, so the second one's offsets are still valid. Editing
	 * the string twice with offsets from one parse is how an injected
	 * import silently lands in the middle of the markup. */
	const edits: { end: number; start: number; text: string }[] = [];
	const starts = nodes.map((node) => node.start);
	const ends = nodes.map((node) => node.end);
	if (nodes.length > 0) {
		/* The whole template region is replaced, and rebuilt from the
		 * nodes: the `<svelte:…>` elements first, then the wrapper around
		 * everything else. Slicing from the first wrappable node to the
		 * last would swallow any `<svelte:…>` element BETWEEN them, which
		 * is where a `<svelte:head>` usually sits. */
		const text = `${hoisted
			.map((node) => source.slice(node.start, node.end))
			.join('\n')}${hoisted.length > 0 ? '\n' : ''}${open}${wrappable
			.map((node) => source.slice(node.start, node.end))
			.join('')
			.trim()}${close}`;
		edits.push({
			end: Math.max(...ends),
			start: Math.min(...starts),
			text
		});
	} else {
		// No markup of its own: the layouts become the whole template.
		edits.push({
			end: source.length,
			start: source.length,
			text: `\n${open}${close}\n`
		});
	}

	const instance = ast.instance;
	if (isNode(instance)) {
		const contentStart = source.indexOf('>', instance.start) + 1;
		edits.push({
			end: contentStart,
			start: contentStart,
			text: `\n${imports}`
		});
	} else {
		edits.push({
			end: 0,
			start: 0,
			text: `<script lang="ts">\n${imports}\n</script>\n\n`
		});
	}

	return edits
		.sort((left, right) => right.start - left.start)
		.reduce(
			(text, edit) =>
				`${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`,
			source
		);
};
