/* Wrapping a Vue file route in its layouts.
 *
 * Same shape as Svelte's (`svelteRouteLayouts.ts`) and for the same
 * reason: a Vue page renders from one compiled module that both the
 * server and the client load, so the layouts are wrapped around the
 * page's template in the SOURCE and the two sides cannot disagree about
 * the order. React is the odd one out, composing at run time in two
 * places that have to be kept in step.
 *
 * Simpler than the Svelte transform in two ways. An SFC's `<template>` is
 * one block with a single body, so there is no node list to rebuild and
 * no `<svelte:…>` equivalent to hoist out. And a component imported in
 * `<script setup>` is available to the template without being registered,
 * so the import is all it takes.
 *
 * A page with only a plain `<script>` gets a `<script setup>` added
 * beside it, which Vue allows: the plain block still runs once at module
 * scope, and the setup block is where the layout components land. The
 * alternative — adding them to a `components: {}` option — would mean
 * editing an object literal in someone else's script.
 */

const TEMPLATE_RE = /(<template\b[^>]*>)([\s\S]*)(<\/template>)/;
const SCRIPT_SETUP_OPEN_RE = /<script\b(?=[^>]*\bsetup\b)[^>]*>/;

/** A local component name for each layout. Capitalised so the template
 *  reads it as a component rather than an element, which is also what
 *  Svelte requires — the same mistake costs a `tag_invalid_name` there
 *  and a silently unresolved custom element here. */
const localNameFor = (index: number) => `AbsRouteLayout${index}`;

export type VueLayoutWrap = {
	/** Import specifiers for the layouts, outermost first. */
	specifiers: readonly string[];
};

/** The page's source with its template wrapped in the layouts, or `null`
 *  when there is nothing to wrap or no `<template>` to wrap it in. */
export const wrapVueRouteLayouts = (
	source: string,
	{ specifiers }: VueLayoutWrap
) => {
	if (specifiers.length === 0) return null;
	const template = TEMPLATE_RE.exec(source);
	const [, openTag, body, closeTag] = template ?? [];
	if (!template || !openTag || body === undefined || !closeTag) return null;

	const open = specifiers
		.map((_, index) => `<${localNameFor(index)}>`)
		.join('');
	const close = specifiers
		.map((_, index) => `</${localNameFor(specifiers.length - 1 - index)}>`)
		.join('');
	const imports = specifiers
		.map(
			(specifier, index) =>
				`import ${localNameFor(index)} from '${specifier}';`
		)
		.join('\n');

	const wrappedTemplate = `${openTag}${open}${body.trim()}${close}${closeTag}`;
	const withTemplate =
		source.slice(0, template.index) +
		wrappedTemplate +
		source.slice(template.index + template[0].length);

	/* The imports go into the existing `<script setup>` when there is one,
	 * so they share its scope. The template edit is applied first and this
	 * one searches the result, rather than both using offsets from one
	 * pass over the original — the Svelte transform had that bug. */
	const setupOpen = SCRIPT_SETUP_OPEN_RE.exec(withTemplate);
	if (setupOpen) {
		const contentStart = setupOpen.index + setupOpen[0].length;

		return `${withTemplate.slice(0, contentStart)}\n${imports}${withTemplate.slice(contentStart)}`;
	}

	return `<script setup lang="ts">\n${imports}\n</script>\n\n${withTemplate}`;
};
