import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createModuleServer } from '../../../src/dev/moduleServer';

/* The dev module server bound the component to `__script__` by rewriting
 * `export default`, so a page whose plain `<script>` has no default export
 * (the README's defineRoutes SPA shell) referenced an undeclared
 * `__script__` and every route failed with a ReferenceError. */

const SOURCES: Record<string, string> = {
	BothScripts: `<script lang="ts">
export const pageLabel = 'BOTH';
</script>
<script setup lang="ts">
const word = 'BOTH';
</script>
<template><p>{{ word }}</p></template>`,
	NamedOnly: `<script lang="ts">
export const pageLabel = 'NAMED';
</script>
<template><p>NAMED</p></template>`,
	NoScript: `<template><p>NO_SCRIPT</p></template>`,
	NoTemplate: `<script lang="ts">
export const pageLabel = 'NO_TEMPLATE';
</script>`,
	PlainDefault: `<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'PlainDefault' });
</script>
<template><p>PLAIN</p></template>`,
	RoutedShell: `<script lang="ts">
export const routes = [{ path: '/app/one', component: { template: '<p>one</p>' } }];
</script>
<template><RouterView /></template>`
};

describe('Vue dev module server: plain <script> pages', () => {
	test('every SFC shape declares the component it exports', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-vue-plain-'));
		try {
			await Promise.all(
				Object.entries(SOURCES).map(([name, source]) =>
					writeFile(join(root, `${name}.vue`), source)
				)
			);
			const serve = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});
			for (const name of Object.keys(SOURCES)) {
				const response = await serve(`/@src/${name}.vue`);
				const code = (await response?.text()) ?? '';
				expect({ name, status: response?.status }).toEqual({
					name,
					status: 200
				});
				expect({
					declared: /\b(?:const|let|var)\s+__script__\s*=/.test(code),
					name
				}).toEqual({ declared: true, name });
				expect(code.match(/\bexport\s+default\b/g)).toEqual([
					'export default'
				]);
				expect(code).toContain('export default __hmr_comp__;');
			}
			const routed = await (await serve('/@src/RoutedShell.vue'))?.text();
			expect(routed).toContain('export const routes');
			expect(routed).toContain('export const setupApp');
			const named = await (await serve('/@src/NamedOnly.vue'))?.text();
			expect(named).toContain('export const pageLabel');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
