import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	createModuleServer,
	invalidateModule
} from '../../../src/dev/moduleServer';

describe('Vue development CSS imports', () => {
	test('inlines nested component styles and scopes imported selectors after a reload', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-vue-css-'));
		try {
			await mkdir(join(root, 'styles'));
			await writeFile(
				join(root, 'styles/tokens.css'),
				':root { --ember-size: 20px; }'
			);
			await writeFile(
				join(root, 'styles/ember.css'),
				'@import url("./tokens.css"); .ember { color: gold; }'
			);
			const source =
				'<template><span class="ember">Ember</span></template><style scoped>@import "./styles/ember.css";</style>';
			const path = join(root, 'Ember.vue');
			await writeFile(path, source);
			const serve = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});
			const response = await serve('/@src/Ember.vue');
			const code = await response?.text();
			expect(response?.status).toBe(200);
			expect(code).toContain('--ember-size: 20px');
			expect(code).toContain('.ember[data-v-ember]');
			expect(code).not.toContain('@import');
			await writeFile(
				path,
				source.replace('Ember</span>', 'Updated</span>')
			);
			invalidateModule(path);
			const updated = await (await serve('/@src/Ember.vue'))?.text();
			expect(updated).toContain('--ember-size: 20px');
			expect(updated).not.toContain('@import');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
