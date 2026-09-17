import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'bun:test';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { clearVueHmrCaches, compileVue } from '../../../src/build/compileVue';
import {
	vueModuleOutputPath,
	vueModuleSourcePath
} from '../../../src/build/vueModuleOutputPath';
import { getFrameworkGeneratedDir } from '../../../src/utils/generatedDir';

test('package Vue components, nested components and helpers keep separate browser and server outputs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'vue-package-output-'));
	const packageName = `@absolute-test/vue-${randomUUID()}`;
	const packageRoot = join(process.cwd(), 'node_modules', packageName);
	const vueRoot = join(root, 'app', 'vue');
	const page = join(vueRoot, 'pages', 'PackagePage.vue');
	const component = join(packageRoot, 'components', 'Picker.vue');
	const child = join(packageRoot, 'components', 'Child.vue');
	const helper = join(packageRoot, 'shared', 'amount.ts');
	const nestedHelper = join(packageRoot, 'shared', 'base.ts');
	const generated = getFrameworkGeneratedDir('vue');
	try {
		await Bun.write(
			join(packageRoot, 'package.json'),
			JSON.stringify({
				name: packageName,
				exports: { './Picker.vue': './components/Picker.vue' }
			})
		);
		await Bun.write(
			page,
			`<script setup>import Picker from '${packageName}/Picker.vue';</script><template><main><Picker /></main></template>`
		);
		await Bun.write(
			component,
			`<script setup>import {ref} from 'vue';import Child from './Child.vue';import {amount} from '../shared/amount';const count=ref(amount);</script><template><section><button @click="count++">{{count}}</button><Child /></section></template><style scoped>button{color:rgb(180,120,20)}</style>`
		);
		await Bun.write(
			child,
			'<template><span>package child</span></template>'
		);
		await Bun.write(
			helper,
			"import {base} from './base';export const amount=base+1;"
		);
		await Bun.write(nestedHelper, 'export const base=72;');
		clearVueHmrCaches();
		const result = await compileVue([page], vueRoot, false);
		for (const source of [page, component, child, helper, nestedHelper]) {
			const client = vueModuleOutputPath(
				join(generated, 'client'),
				source
			);
			const server = vueModuleOutputPath(
				join(generated, 'server'),
				source
			);
			expect(client).not.toBe(server);
			expect(
				relative(join(generated, 'client'), client).startsWith('..')
			).toBe(false);
			expect(await Bun.file(client).exists()).toBe(true);
			expect(await Bun.file(server).exists()).toBe(true);
			expect(await Bun.file(client).text()).not.toContain(
				'vue/server-renderer'
			);
			if (source.endsWith('.vue'))
				expect(await Bun.file(server).text()).toContain('ssrRender');
		}
		for (const target of ['browser', 'bun'] as const) {
			const entry =
				target === 'browser'
					? result.vueClientPaths[0]!
					: result.vueServerPaths[0]!;
			const build = await Bun.build({
				entrypoints: [entry],
				target,
				outdir: join(root, target)
			});
			expect(build.success).toBe(true);
			const artifact = build.outputs.find((output) =>
				output.path.endsWith('.js')
			)!;
			if (target === 'browser')
				expect(await artifact.text()).not.toContain('ssrInterpolate');
			else {
				const module = await import(pathToFileURL(artifact.path).href);
				const html = await renderToString(createSSRApp(module.default));
				expect(html).toContain('>73</button>');
				expect(html).toContain('package child');
			}
		}
		// A restart must restore the same contained paths from the disk cache.
		clearVueHmrCaches();
		await rm(vueModuleOutputPath(join(generated, 'client'), component));
		const restored = await compileVue([page], vueRoot, false);
		expect(restored.vueClientPaths).toEqual(result.vueClientPaths);
		expect(
			await Bun.file(
				vueModuleOutputPath(join(generated, 'client'), component)
			).text()
		).not.toContain('ssrRender');
	} finally {
		clearVueHmrCaches();
		await rm(root, { recursive: true, force: true });
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test('generated source identities reject escaped or malformed paths', () => {
	const root = join(tmpdir(), 'vue-output-identity');
	const source = join(tmpdir(), 'outside', 'useCredits.ts');
	const client = join(root, 'client');
	expect(
		vueModuleSourcePath(client, vueModuleOutputPath(client, source))
	).toBe(source.replace(/\.ts$/, '.js'));
	expect(
		vueModuleSourcePath(client, join(root, 'server', 'other.js'))
	).toBeNull();
	expect(
		vueModuleSourcePath(
			client,
			join(client, 'sources', '%invalid', 'other.js')
		)
	).toBeNull();
});
