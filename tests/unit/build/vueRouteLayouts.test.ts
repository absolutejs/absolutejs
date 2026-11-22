import { describe, expect, test } from 'bun:test';
import { wrapVueRouteLayouts } from '../../../src/build/vueRouteLayouts';

/* Wrapping a Vue file route in its layouts, in the SOURCE — the same
 * approach as Svelte's, because a Vue page also renders from one compiled
 * module that the server and the client both load.
 *
 * The two edits (the wrapped template, the injected imports) are applied
 * in sequence, with the second searching the result of the first rather
 * than using offsets from a single pass. The Svelte transform had exactly
 * that bug, so these tests check the import does not land in the
 * template. */

const wrap = (source: string, specifiers: string[]) =>
	wrapVueRouteLayouts(source, { specifiers });

describe('wrapVueRouteLayouts', () => {
	test('wraps the template outermost first and imports into script setup', () => {
		const source = `<script setup lang="ts">
const { topic } = defineProps<{ topic: string }>();
</script>

<template>
	<h1>{{ topic }}</h1>
</template>
`;
		const result = wrap(source, ['./outer.vue', './plans/inner.vue']) ?? '';

		expect(result).toContain("import AbsRouteLayout0 from './outer.vue';");
		expect(result).toContain(
			"import AbsRouteLayout1 from './plans/inner.vue';"
		);
		expect(result).toContain('defineProps');
		/* Ordered, because asserting that both tags merely appear would
		 * pass with the nesting inverted. */
		expect(result).toMatch(
			/<AbsRouteLayout0><AbsRouteLayout1><h1>\{\{ topic \}\}<\/h1><\/AbsRouteLayout1><\/AbsRouteLayout0>/
		);
		// The import stayed in the script, not in the markup.
		expect(result).not.toMatch(/<template>[\s\S]*import AbsRouteLayout/);
	});

	/* Vue allows a plain `<script>` and a `<script setup>` side by side:
	 * the plain one runs once at module scope. Adding the setup block is
	 * less invasive than editing a `components: {}` option in someone
	 * else's script. */
	test('adds a script setup when the page has only a plain script', () => {
		const source = `<script lang="ts">
export const routes = [];
</script>

<template><p>plain</p></template>
`;
		const result = wrap(source, ['./outer.vue']) ?? '';

		expect(result).toContain('<script setup lang="ts">');
		expect(result).toContain('export const routes = []');
		expect(result).toContain(
			'<template><AbsRouteLayout0><p>plain</p></AbsRouteLayout0></template>'
		);
	});

	test('is a no-op without layouts, or without a template', () => {
		expect(wrap('<template><p>x</p></template>', [])).toBeNull();
		expect(
			wrap('<script setup lang="ts"></script>', ['./outer.vue'])
		).toBeNull();
	});
});
