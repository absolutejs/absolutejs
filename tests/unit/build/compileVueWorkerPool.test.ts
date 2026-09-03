import { readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { clearVueHmrCaches, compileVue } from '../../../src/build/compileVue';
import {
	getBuildWorkerPool,
	resetBuildWorkerPool
} from '../../../src/build/workerPool';
import { getFrameworkGeneratedDir } from '../../../src/utils/generatedDir';

/* Pooled compile must be byte-for-byte the serial compile. The example
 * app's Vue pages cover script setup + module script, cross-file
 * imports, SPA route shells with lazy children, scoped styles and CSS
 * imports — every path the worker payload has to carry. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const VUE_DIR = join(PROJECT_ROOT, 'example', 'vue');
const PAGES_DIR = join(VUE_DIR, 'pages');
const GENERATED_DIR = getFrameworkGeneratedDir('vue');

const previousEnv = {
	compileCache: process.env.ABSOLUTE_COMPILE_CACHE,
	workers: process.env.ABSOLUTE_BUILD_WORKERS
};

const restoreEnv = () => {
	if (previousEnv.compileCache === undefined)
		delete process.env.ABSOLUTE_COMPILE_CACHE;
	else process.env.ABSOLUTE_COMPILE_CACHE = previousEnv.compileCache;
	if (previousEnv.workers === undefined)
		delete process.env.ABSOLUTE_BUILD_WORKERS;
	else process.env.ABSOLUTE_BUILD_WORKERS = previousEnv.workers;
};

const listFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);

		return entry.isDirectory() ? listFiles(path) : [path];
	});

const snapshotGenerated = () => {
	const snapshot = new Map<string, string>();
	for (const path of listFiles(GENERATED_DIR).sort()) {
		snapshot.set(relative(GENERATED_DIR, path), readFileSync(path, 'utf-8'));
	}

	return snapshot;
};

const pages = readdirSync(PAGES_DIR)
	.filter((name) => name.endsWith('.vue'))
	.sort()
	.map((name) => join(PAGES_DIR, name));

const compileFresh = async (workers: string) => {
	await resetBuildWorkerPool();
	process.env.ABSOLUTE_BUILD_WORKERS = workers;
	clearVueHmrCaches();
	await rm(GENERATED_DIR, { force: true, recursive: true });
	const result = await compileVue(pages, VUE_DIR, true);
	const stats = getBuildWorkerPool().stats();

	return { result, snapshot: snapshotGenerated(), stats };
};

beforeAll(() => {
	// The restart-surviving cache would turn the second compile into a
	// pure re-materialisation — this test wants two real compiles.
	process.env.ABSOLUTE_COMPILE_CACHE = '0';
});

afterAll(async () => {
	await resetBuildWorkerPool();
	restoreEnv();
	clearVueHmrCaches();
	await rm(GENERATED_DIR, { force: true, recursive: true });
});

describe('compileVue on the build worker pool', () => {
	test(
		'pooled output is byte-for-byte the inline output',
		async () => {
			expect(pages.length).toBeGreaterThanOrEqual(4);

			const inline = await compileFresh('0');
			expect(inline.stats.jobs).toBeGreaterThanOrEqual(pages.length);
			expect(inline.stats.inlineJobs).toBe(inline.stats.jobs);
			expect(inline.stats.workers).toEqual([]);

			const pooled = await compileFresh('2');
			expect(pooled.stats.inlineJobs).toBe(0);
			expect(pooled.stats.jobs).toBeGreaterThanOrEqual(pages.length);
			expect(pooled.stats.workers).toHaveLength(2);
			expect(pooled.stats.busyMs).toBeGreaterThan(0);

			expect([...pooled.snapshot.keys()]).toEqual([
				...inline.snapshot.keys()
			]);
			for (const [file, content] of inline.snapshot) {
				expect(pooled.snapshot.get(file)).toBe(content);
			}
			expect(pooled.result.vueServerPaths).toEqual(
				inline.result.vueServerPaths
			);
			expect(pooled.result.vueClientPaths).toEqual(
				inline.result.vueClientPaths
			);
			expect(pooled.result.vueCssPaths).toEqual(inline.result.vueCssPaths);
			expect([...pooled.result.vueSpaRoutesBySource]).toEqual([
				...inline.result.vueSpaRoutesBySource
			]);
			// Map insertion order follows completion order, which the pool
			// legitimately changes; the entries themselves must match.
			const sortedEntries = (map: Map<string, unknown>) =>
				[...map].sort(([left], [right]) => left.localeCompare(right));
			expect(sortedEntries(pooled.result.hmrMetadata)).toEqual(
				sortedEntries(inline.result.hmrMetadata)
			);
		},
		60_000
	);

	test('a single-page rebuild stays on the main thread while the pool is cold', async () => {
		await resetBuildWorkerPool();
		process.env.ABSOLUTE_BUILD_WORKERS = '2';
		clearVueHmrCaches();
		await rm(GENERATED_DIR, { force: true, recursive: true });
		const [firstPage] = pages;
		if (!firstPage) throw new Error('example has no Vue pages');
		await compileVue([firstPage], VUE_DIR, true);
		const stats = getBuildWorkerPool().stats();
		expect(stats.inlineJobs).toBe(stats.jobs);
		expect(getBuildWorkerPool().isWarm()).toBe(false);
	}, 30_000);
});
