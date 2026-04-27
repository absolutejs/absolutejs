import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createModuleServer } from '../../../src/dev/moduleServer';

const projectRoot = resolve(import.meta.dir, '..', '..', '..');
const awaitFixture = resolve(
	projectRoot,
	'tests',
	'fixtures',
	'svelte',
	'AwaitStreamingPage.svelte'
);
const awaitFixtureUrl = `/@src/${relative(projectRoot, awaitFixture).replace(/\\/g, '/')}`;

describe('createModuleServer Svelte transforms', () => {
	test('lowers #await blocks in dev client modules', async () => {
		const moduleServer = createModuleServer({
			projectRoot,
			vendorPaths: {}
		});

		const response = await moduleServer(awaitFixtureUrl);
		expect(response?.status).toBe(200);
		if (!response) {
			throw new Error('Expected module server response');
		}

		const code = await response.text();

		expect(code).toContain('AwaitSlot.svelte');
		expect(code).not.toContain('{#await');
	});

	test('uses configured preprocessors for Svelte style blocks', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-module-svelte-'));
		try {
			const component = join(root, 'Preprocessed.svelte');
			await writeFile(
				component,
				'<p class="proof">Svelte</p><style lang="scss">.proof { color: $brand; }</style>'
			);
			const moduleServer = createModuleServer({
				projectRoot: root,
				stylePreprocessors: {
					scss: { additionalData: '$brand: #be123c;' }
				},
				vendorPaths: {}
			});

			const response = await moduleServer('/@src/Preprocessed.svelte');
			expect(response?.status).toBe(200);
			const code = await response?.text();
			expect(code).toContain('/@src/Preprocessed.svelte.css');

			const cssResponse = await moduleServer(
				'/@src/Preprocessed.svelte.css'
			);
			expect(cssResponse?.status).toBe(200);
			const cssModule = await cssResponse?.text();
			expect(cssModule).toContain('color: #be123c');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('uses configured preprocessors for Vue style blocks', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-module-vue-'));
		try {
			await writeFile(
				join(root, 'Preprocessed.vue'),
				'<script setup lang="ts">const label = "Vue";</script><template><p class="proof">{{ label }}</p></template><style lang="less">.proof { color: @brand; }</style>'
			);
			const moduleServer = createModuleServer({
				projectRoot: root,
				stylePreprocessors: {
					less: { additionalData: '@brand: #0369a1;' }
				},
				vendorPaths: {}
			});

			const response = await moduleServer('/@src/Preprocessed.vue');
			expect(response?.status).toBe(200);
			const code = await response?.text();
			expect(code).toContain('color: #0369a1');
			expect(code).not.toContain('@brand');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
