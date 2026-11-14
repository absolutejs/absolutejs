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
	vueModuleSourcePath,
	vueRelativeOutputImport
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
	const projectRoot = join(root, 'app');
	const source = join(root, 'outside', 'useCredits.ts');
	const client = join(root, 'client');
	expect(
		vueModuleSourcePath(
			client,
			vueModuleOutputPath(client, source, projectRoot),
			projectRoot
		)
	).toBe(source.replace(/\.ts$/, '.js'));
	// A file sharing only the filesystem root gets an opaque directory:
	// no identity, and none of its absolute path.
	const unrelated = vueModuleOutputPath(
		client,
		source,
		join('/', 'unrelated-project')
	);
	expect(relative(client, unrelated)).toMatch(
		/^sources[\\/]_external[\\/]h-[0-9a-z]{13}[\\/]useCredits\.js$/
	);
	expect(vueModuleSourcePath(client, unrelated, join('/', 'unrelated-project'))).toBeNull();
	expect(
		vueModuleSourcePath(client, join(root, 'server', 'other.js'))
	).toBeNull();
	for (const malformed of [
		['_external', 'x', 'other.js'],
		['_external', '0', 'other.js'],
		['_external', '2'],
		['_external', 'h-0123456789abc', 'other.js']
	])
		expect(
			vueModuleSourcePath(client, join(client, 'sources', ...malformed))
		).toBeNull();
});

test('generated source paths never contain the project root', () => {
	const projectRoot = join(tmpdir(), 'vue-mirror', 'machine', 'app');
	const client = join(projectRoot, '.absolutejs', 'generated', 'vue', 'client');
	const inside = join(projectRoot, 'src', 'frontend', 'vue', 'Lazy.vue');
	const sibling = join(projectRoot, '..', 'shared', 'useShared.ts');
	const hoisted = join(projectRoot, '..', '..', 'node_modules', 'ui', 'Btn.vue');
	const contained = (output: string) => relative(client, output);

	expect(contained(vueModuleOutputPath(client, inside, projectRoot))).toBe(
		join('sources', 'src', 'frontend', 'vue', 'Lazy.js')
	);
	expect(contained(vueModuleOutputPath(client, sibling, projectRoot))).toBe(
		join('sources', '_external', '1', 'shared', 'useShared.js')
	);
	expect(contained(vueModuleOutputPath(client, hoisted, projectRoot))).toBe(
		join('sources', '_external', '2', 'node_modules', 'ui', 'Btn.js')
	);
	for (const source of [inside, sibling, hoisted]) {
		const output = contained(
			vueModuleOutputPath(client, source, projectRoot)
		);
		expect(output).not.toContain('vue-mirror');
		expect(output).not.toContain('machine');
		expect(output).not.toContain('%2F');
		expect(
			vueModuleSourcePath(
				client,
				vueModuleOutputPath(client, source, projectRoot),
				projectRoot
			)
		).toBe(source.replace(/\.(vue|ts)$/, '.js'));
	}

	// Imports inside one region keep their shape; imports across the
	// project-root edge follow the generated layout.
	expect(
		vueRelativeOutputImport(
			inside,
			join(projectRoot, 'src', 'frontend', 'vue', 'Child.js'),
			projectRoot
		)
	).toBe('./Child.js');
	expect(
		vueRelativeOutputImport(
			inside,
			sibling.replace(/\.ts$/, '.js'),
			projectRoot
		)
	).toBe('../../../_external/1/shared/useShared.js');
	expect(
		vueRelativeOutputImport(
			sibling,
			join(projectRoot, 'src', 'util.js'),
			projectRoot
		)
	).toBe('../../../src/util.js');
	expect(
		vueRelativeOutputImport(sibling, hoisted.replace(/\.vue$/, '.js'), projectRoot)
	).toBe('../../2/node_modules/ui/Btn.js');
});

test('a Vue tree outside the project builds without its absolute path', async () => {
	// tmpdir shares only the filesystem root with the project, so every
	// directory of this fixture mirrors to its own hashed directory and the
	// imports between them (relative, directory index, lazy) are rewritten.
	const root = await mkdtemp(join(tmpdir(), 'vue-unrelated-tree-'));
	const vueRoot = join(root, 'vue');
	const page = join(vueRoot, 'pages', 'TreePage.vue');
	try {
		await Bun.write(
			page,
			`<script setup>import {defineAsyncComponent} from 'vue';import Card from '../components/Card.vue';import {label} from '../state';const Lazy=defineAsyncComponent(()=>import('../components/nested/Lazy.vue'));</script><template><main><Card />{{label}}<Lazy /></main></template>`
		);
		await Bun.write(
			join(vueRoot, 'components', 'Card.vue'),
			`<script setup>import {base} from '../state/base';</script><template><b>card {{base}}</b></template>`
		);
		await Bun.write(
			join(vueRoot, 'components', 'nested', 'Lazy.vue'),
			'<template><i>lazy</i></template>'
		);
		await Bun.write(
			join(vueRoot, 'state', 'index.ts'),
			"import {base} from './base';import {suffix} from '../shared/suffix';export const label=`${base}${suffix}`;"
		);
		await Bun.write(join(vueRoot, 'state', 'base.ts'), 'export const base=4;');
		await Bun.write(
			join(vueRoot, 'shared', 'suffix.ts'),
			"export const suffix='2';"
		);
		clearVueHmrCaches();
		const result = await compileVue([page], vueRoot, false);
		const browser = await Bun.build({
			entrypoints: [result.vueClientPaths[0]!],
			outdir: join(root, 'browser'),
			splitting: true,
			target: 'browser'
		});
		expect(browser.success).toBe(true);
		const generated = getFrameworkGeneratedDir('vue');
		for (const output of browser.outputs)
			expect(relative(join(root, 'browser'), output.path)).not.toContain(
				'vue-unrelated-tree-'
			);
		expect(
			relative(generated, result.vueClientPaths[0]!)
		).not.toContain('vue-unrelated-tree-');
		const server = await Bun.build({
			entrypoints: [result.vueServerPaths[0]!],
			outdir: join(root, 'bun'),
			target: 'bun'
		});
		expect(server.success).toBe(true);
		const entry = server.outputs.find((output) =>
			output.path.endsWith('.js')
		)!;
		const module = await import(pathToFileURL(entry.path).href);
		const html = await renderToString(createSSRApp(module.default));
		expect(html).toContain('card 4');
		expect(html).toContain('42');
	} finally {
		clearVueHmrCaches();
		await rm(root, { recursive: true, force: true });
	}
});
