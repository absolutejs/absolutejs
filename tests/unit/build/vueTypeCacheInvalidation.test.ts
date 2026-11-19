import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { clearVueHmrCaches, compileVue } from '../../../src/build/compileVue';
import { getFrameworkGeneratedDir } from '../../../src/utils/generatedDir';
import { getBuildWorkerPool } from '../../../src/build/workerPool';

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((r) => rm(r, { force: true, recursive: true }))
	);
});

test('a type edit is picked up without invalidateTypeCache', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolutejs-typecache-'));
	roots.push(root);
	const page = join(root, 'Page.vue');
	const types = join(root, 'types.ts');
	await Bun.write(types, 'export type Props = { title: string };');
	await Bun.write(
		page,
		`<script setup lang="ts">
import type { Props } from './types';

defineProps<Props>();
</script>

<template><h1>{{ title }}</h1></template>`
	);

	const first = await compileVue([page], root, false);
	expect(readFileSync(first.vueClientPaths[0] ?? '', 'utf-8')).toContain(
		'title'
	);

	// Edit the type file only. A dev rebuild does exactly this, and never
	// calls @vue/compiler-sfc's invalidateTypeCache.
	await Bun.write(
		types,
		'export type Props = { title: string; subtitle: string };'
	);
	clearVueHmrCaches();
	await rm(getFrameworkGeneratedDir('vue'), { force: true, recursive: true });
	await rm(join(root, '.absolutejs'), { force: true, recursive: true });

	const second = await compileVue([page], root, false);
	const out = readFileSync(second.vueClientPaths[0] ?? '', 'utf-8');
	expect(out).toContain('subtitle');
});

test('a worker-run compile also picks up a type edit', async () => {
	// Once the pool is warm, every compile goes to a worker whatever the
	// batch size (`shouldUse` is `isWarm() || jobCount >= minBatch`), and a
	// worker keeps Vue's parsed type scopes from the compiles it already
	// ran. That is the path the CI flake took: whether this test's compiles
	// ran inline or on a warm worker depended on which files Bun happened to
	// walk first, which differs per platform.
	const pool = getBuildWorkerPool();
	pool.warm('vue-sfc');
	const before = pool.stats();
	const workerJobsBefore = before.jobs - before.inlineJobs;

	const root = await mkdtemp(join(tmpdir(), 'absolutejs-typecache-worker-'));
	roots.push(root);
	const page = join(root, 'Worker.vue');
	const types = join(root, 'types.ts');
	await Bun.write(types, 'export type Props = { title: string };');
	await Bun.write(
		page,
		`<script setup lang="ts">
import type { Props } from './types';

defineProps<Props>();
</script>

<template><h1>{{ title }}</h1></template>`
	);

	const first = await compileVue([page], root, false);
	expect(readFileSync(first.vueClientPaths[0] ?? '', 'utf-8')).toContain(
		'title'
	);

	await Bun.write(
		types,
		'export type Props = { title: string; subtitle: string };'
	);
	clearVueHmrCaches();
	await rm(getFrameworkGeneratedDir('vue'), { force: true, recursive: true });

	const second = await compileVue([page], root, false);

	// Worthless unless a worker really ran the compile, so say so.
	const after = pool.stats();
	expect(after.jobs - after.inlineJobs).toBeGreaterThan(workerJobsBefore);

	expect(readFileSync(second.vueClientPaths[0] ?? '', 'utf-8')).toContain(
		'subtitle'
	);
}, 120_000);
