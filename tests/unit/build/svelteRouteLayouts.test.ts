import { describe, expect, test } from 'bun:test';
import { parse } from 'svelte/compiler';
import { wrapSvelteRouteLayouts } from '../../../src/build/svelteRouteLayouts';

/* Wrapping a Svelte file route in its layouts, in the SOURCE.
 *
 * React composes its layouts at run time in two places that have to
 * agree. Svelte renders from one compiled module which both the server
 * and the client load, so the wrapping happens once, here, and the two
 * sides cannot disagree.
 *
 * The transform edits two regions of one string — an injected import and
 * the wrapped markup — and both offsets come from a single parse. Applying
 * them front to back would land the second edit at a stale offset, which
 * is the bug these tests are shaped to catch. */

const wrap = (source: string, specifiers: string[]) =>
	wrapSvelteRouteLayouts(source, { specifiers }, parse);

describe('wrapSvelteRouteLayouts', () => {
	test('wraps the markup outermost first and imports into the instance script', () => {
		const source = `<script lang="ts">
	let { title }: { title: string } = $props();
</script>

<h1>{title}</h1>
<p>body</p>
`;
		const result = wrap(source, ['./outer.svelte', './inner.svelte']);

		expect(result).not.toBeNull();
		// Both imports land inside the existing script, not in the markup.
		expect(result).toContain(
			"import AbsRouteLayout0 from './outer.svelte';"
		);
		expect(result).toContain(
			"import AbsRouteLayout1 from './inner.svelte';"
		);
		expect(result).toContain('let { title }');
		/* Outermost first, and the page's own markup intact between them.
		 * An ordered match, because asserting that both tags merely appear
		 * would pass with the nesting inverted. */
		expect(result).toMatch(
			/<AbsRouteLayout0><AbsRouteLayout1><h1>\{title\}<\/h1>\s*<p>body<\/p><\/AbsRouteLayout1><\/AbsRouteLayout0>/
		);
		// The import did not land inside the markup region.
		expect(result).not.toMatch(/<h1>[\s\S]*import AbsRouteLayout/);
	});

	test('adds a script when the page has none', () => {
		const result = wrap('<p>plain</p>\n', ['./outer.svelte']);

		expect(result).toContain('<script lang="ts">');
		expect(result).toContain(
			"import AbsRouteLayout0 from './outer.svelte';"
		);
		expect(result).toContain(
			'<AbsRouteLayout0><p>plain</p></AbsRouteLayout0>'
		);
	});

	/* `<svelte:options>` has to stay at the top level of a component, and
	 * the other `<svelte:…>` elements carry their own placement rules. A
	 * wrapped one fails to compile with an error about the layout rather
	 * than about the page, so they are left where the author put them. */
	test('leaves svelte: elements outside the wrapper', () => {
		const source = `<svelte:options runes={true} />

<svelte:head>
	<title>Page</title>
</svelte:head>

<p>content</p>
`;
		const result = wrap(source, ['./outer.svelte']) ?? '';

		expect(result).toContain(
			'<AbsRouteLayout0><p>content</p></AbsRouteLayout0>'
		);
		expect(result).not.toMatch(/<AbsRouteLayout0>[\s\S]*<svelte:head>/);
		expect(result).not.toMatch(/<AbsRouteLayout0>[\s\S]*<svelte:options/);
	});

	test('is a no-op without layouts, and on source it cannot parse', () => {
		expect(wrap('<p>x</p>', [])).toBeNull();
		expect(wrap('<p>{{{', ['./outer.svelte'])).toBeNull();
	});
});
