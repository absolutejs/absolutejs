import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { invalidateTypeCache } from '@vue/compiler-sfc';
import { clearVueHmrCaches, compileVue } from '../../../src/build/compileVue';
import {
	hashContent,
	vueCompileCacheDir
} from '../../../src/build/vueCompileCache';
import { getFrameworkGeneratedDir } from '../../../src/utils/generatedDir';

const FILE_NAME_HASH_LENGTH = 32;
const cacheFileFor = (sourcePath: string) =>
	join(
		vueCompileCacheDir(),
		`${hashContent(sourcePath).slice(0, FILE_NAME_HASH_LENGTH)}.json`
	);

const parentSource = `<script setup lang="ts">
import Child from './components/Child.vue';
import type { Props } from './types';

defineProps<Props>();
</script>

<template><main><h1>{{ title }}</h1><Child /></main></template>`;

const childSource = (label: string) =>
	`<script setup lang="ts">
import type { Props } from '../types';

defineProps<Props>();
</script>

<template><aside>${label}</aside></template>

<style scoped>aside { color: red; }</style>`;

const typesSource = (extra: string) =>
	`export type Props = { title: string${extra} };`;

/* Simulate a fresh process: drop the in-memory caches and the generated
 * intermediates (which `cleanup/generated` removes after every build). */
const resetProcessState = async () => {
	clearVueHmrCaches();
	await rm(getFrameworkGeneratedDir('vue'), { force: true, recursive: true });
};

const readOutputs = (paths: string[]) =>
	paths.map((path) => readFileSync(path, 'utf-8'));

const tamper = (cacheFile: string, marker: string) => {
	const entry = JSON.parse(readFileSync(cacheFile, 'utf-8')) as {
		clientCode: string;
	};
	entry.clientCode += `\n/* ${marker} */`;
	writeFileSync(cacheFile, JSON.stringify(entry));
};

const cleanups: string[] = [];
afterEach(async () => {
	delete process.env.ABSOLUTE_COMPILE_CACHE;
	await resetProcessState();
	for (const path of cleanups.splice(0)) {
		await rm(path, { force: true, recursive: true });
	}
});

describe('vue compile cache', () => {
	test('survives a restart, invalidates on child and type-dependency edits', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-vue-cache-'));
		cleanups.push(root);
		const parentPath = join(root, 'Parent.vue');
		const childPath = join(root, 'components', 'Child.vue');
		const typesPath = join(root, 'types.ts');
		cleanups.push(cacheFileFor(parentPath), cacheFileFor(childPath));
		await Bun.write(parentPath, parentSource);
		await Bun.write(childPath, childSource('first'));
		await Bun.write(typesPath, typesSource(''));

		await resetProcessState();
		const fresh = await compileVue([parentPath], root, false);
		const freshOutputs = readOutputs([
			...fresh.vueClientPaths,
			...fresh.vueServerPaths
		]);
		expect(freshOutputs[0]).toContain('./components/Child.js');
		expect(
			readFileSync(
				join(fresh.vueClientPaths[0] ?? '', '..', 'components', 'Child.js'),
				'utf-8'
			)
		).toContain('first');
		expect(existsSync(cacheFileFor(parentPath))).toBe(true);
		expect(existsSync(cacheFileFor(childPath))).toBe(true);

		// Restart: identical output, and it really came from the cache.
		tamper(cacheFileFor(parentPath), 'FROM-CACHE');
		await resetProcessState();
		const restarted = await compileVue([parentPath], root, false);
		const restartedOutputs = readOutputs([
			...restarted.vueClientPaths,
			...restarted.vueServerPaths
		]);
		expect(restartedOutputs[0]).toContain('FROM-CACHE');
		expect(restartedOutputs[0]?.replace('\n/* FROM-CACHE */', '')).toBe(
			freshOutputs[0] ?? ''
		);
		expect(restartedOutputs.slice(1)).toEqual(freshOutputs.slice(1));
		expect(restarted.hmrMetadata.get(parentPath)?.hmrId).toBe(
			fresh.hmrMetadata.get(parentPath)?.hmrId
		);

		// Editing the child invalidates the parent too (its key folds in
		// the child's key), so the tampered parent entry is not reused.
		await Bun.write(childPath, childSource('second'));
		await resetProcessState();
		const childEdited = await compileVue([parentPath], root, false);
		const childEditedOutputs = readOutputs([
			...childEdited.vueClientPaths,
			...childEdited.vueServerPaths
		]);
		expect(childEditedOutputs[0]).not.toContain('FROM-CACHE');
		const childClient = readFileSync(
			join(childEdited.vueClientPaths[0] ?? '', '..', 'components', 'Child.js'),
			'utf-8'
		);
		expect(childClient).toContain('second');

		// Editing a file `compileScript` read for type resolution
		// invalidates the components that read it.
		tamper(cacheFileFor(childPath), 'STALE-CHILD');
		await Bun.write(typesPath, typesSource('; subtitle?: string'));
		// Vue's own in-process type-scope cache would otherwise serve the
		// old `types.ts`; a real restart starts with it empty.
		invalidateTypeCache(typesPath);
		await resetProcessState();
		const typesEdited = await compileVue([parentPath], root, false);
		const typesEditedChild = readFileSync(
			join(typesEdited.vueClientPaths[0] ?? '', '..', 'components', 'Child.js'),
			'utf-8'
		);
		expect(typesEditedChild).not.toContain('STALE-CHILD');
		expect(typesEditedChild).toContain('subtitle');
	}, 60_000);

	test('never caches components with external style dependencies', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-vue-cache-'));
		cleanups.push(root);
		const pagePath = join(root, 'Styled.vue');
		cleanups.push(cacheFileFor(pagePath));
		await Bun.write(
			pagePath,
			`<template><p>styled</p></template>
<style>@import './base.css';</style>`
		);
		await Bun.write(join(root, 'base.css'), 'p { margin: 0 }');

		await resetProcessState();
		await compileVue([pagePath], root, false);
		expect(existsSync(cacheFileFor(pagePath))).toBe(false);
	}, 30_000);

	test('ABSOLUTE_COMPILE_CACHE=0 opts out entirely', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-vue-cache-'));
		cleanups.push(root);
		const pagePath = join(root, 'Plain.vue');
		cleanups.push(cacheFileFor(pagePath));
		await Bun.write(pagePath, '<template><p>plain</p></template>');
		process.env.ABSOLUTE_COMPILE_CACHE = '0';

		await resetProcessState();
		await compileVue([pagePath], root, false);
		expect(existsSync(cacheFileFor(pagePath))).toBe(false);
	}, 30_000);
});
