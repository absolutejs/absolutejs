import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	createBuildWorkerPool,
	resolveBuildWorkerCount,
	resolveBuildWorkerEntry
} from '../../../src/build/workerPool';
import type { BuildWorkerPool } from '../../../types/workerPool';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const SOURCE_ENTRY = join(PROJECT_ROOT, 'src', 'build', 'buildWorker.ts');
const DIST_ENTRY = join(PROJECT_ROOT, 'dist', 'build', 'buildWorker.js');

const pools: BuildWorkerPool[] = [];
const makePool = (
	options: Parameters<typeof createBuildWorkerPool>[0] = {}
) => {
	const pool = createBuildWorkerPool({ size: 2, ...options });
	pools.push(pool);

	return pool;
};

afterEach(async () => {
	await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sleep = (ms: number) => Bun.sleep(ms);

describe('resolveBuildWorkerCount', () => {
	test('ABSOLUTE_BUILD_WORKERS overrides the machine default', () => {
		expect(resolveBuildWorkerCount({ ABSOLUTE_BUILD_WORKERS: '0' })).toBe(
			0
		);
		expect(resolveBuildWorkerCount({ ABSOLUTE_BUILD_WORKERS: '1' })).toBe(
			1
		);
		expect(resolveBuildWorkerCount({ ABSOLUTE_BUILD_WORKERS: '3' })).toBe(
			3
		);
		expect(
			resolveBuildWorkerCount({ ABSOLUTE_BUILD_WORKERS: '-4' })
		).toBe(0);
	});

	test('falls back to at least two workers, at most eight, on nonsense', () => {
		for (const env of [{}, { ABSOLUTE_BUILD_WORKERS: 'many' }]) {
			const count = resolveBuildWorkerCount(env);
			expect(count).toBeGreaterThanOrEqual(2);
			expect(count).toBeLessThanOrEqual(8);
		}
	});
});

describe('resolveBuildWorkerEntry', () => {
	test('a source checkout runs the .ts entry', () => {
		expect(resolveBuildWorkerEntry()).toBe(SOURCE_ENTRY);
	});

	test('code running from dist/ prefers the bundled entry', () => {
		const entry = resolveBuildWorkerEntry(join(PROJECT_ROOT, 'dist', 'cli'));
		expect(entry).toBe(existsSync(DIST_ENTRY) ? DIST_ENTRY : SOURCE_ENTRY);
	});

	test('outside the package there is no entry (pool runs inline)', () => {
		expect(resolveBuildWorkerEntry('/')).toBeNull();
	});
});

describe('build worker pool', () => {
	test('round-trips a job through a worker', async () => {
		const pool = makePool();
		const payload = { nested: { list: [1, 'two', null] }, text: 'hi' };
		const result = await pool.run('echo', { value: payload });
		expect(result).toEqual(payload);
		expect(pool.isWarm()).toBe(true);
		const stats = pool.stats();
		expect(stats.jobs).toBe(1);
		expect(stats.inlineJobs).toBe(0);
		expect(stats.size).toBe(2);
	});

	test('propagates a job failure with the worker stack', async () => {
		const pool = makePool();
		const missing = join(PROJECT_ROOT, 'does-not-exist', 'bundle.js');
		const failure = await pool
			.run('sourcemap-chain', {
				bundleFilePath: missing,
				sourcesContent: false
			})
			.then(
				() => null,
				(error: unknown) => error
			);
		expect(failure).toBeInstanceOf(Error);
		if (!(failure instanceof Error)) return;
		expect(failure.message).toContain('does-not-exist');
		expect(failure.stack).toContain('dispatched from the build worker pool');
		// The pool survives a failed job.
		expect(await pool.run('echo', { value: 42 })).toBe(42);
	});

	test('size 0 and 1 run every job inline on the main thread', async () => {
		for (const size of [0, 1]) {
			const pool = makePool({ size });
			expect(pool.shouldUse(1000)).toBe(false);
			expect(await pool.run('echo', { value: 'inline' })).toBe('inline');
			expect(pool.isWarm()).toBe(false);
			const stats = pool.stats();
			expect(stats.inlineJobs).toBe(1);
			expect(stats.jobs).toBe(1);
			expect(stats.workers).toEqual([]);
		}
	});

	test('a missing worker entry runs inline', async () => {
		const pool = makePool({ entry: null });
		expect(pool.shouldUse(1000)).toBe(false);
		expect(await pool.run('echo', { value: 1 })).toBe(1);
		expect(pool.isWarm()).toBe(false);
	});

	test('small batches stay inline until the pool is warm', async () => {
		const pool = makePool({ minBatch: 4 });
		expect(pool.shouldUse(3)).toBe(false);
		expect(pool.shouldUse(4)).toBe(true);
		await pool.run('echo', { value: 'x' }, { inline: true });
		expect(pool.isWarm()).toBe(false);
		expect(pool.stats().inlineJobs).toBe(1);
		await pool.run('echo', { value: 'y' });
		expect(pool.isWarm()).toBe(true);
		expect(pool.shouldUse(1)).toBe(true);
	});

	test('terminates idle workers after the idle timeout', async () => {
		const pool = makePool({ idleTimeoutMs: 60 });
		await pool.run('echo', { value: 1 });
		expect(pool.isWarm()).toBe(true);
		await sleep(250);
		expect(pool.isWarm()).toBe(false);
		// ...and respawns on the next job.
		expect(await pool.run('echo', { value: 2 })).toBe(2);
		expect(pool.isWarm()).toBe(true);
		expect(pool.stats().jobs).toBe(2);
	});

	test('records per-worker busy time and pool utilisation', async () => {
		const pool = makePool();
		const results = await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				pool.run('echo', { delayMs: 40, value: index })
			)
		);
		expect(results).toEqual([0, 1, 2, 3, 4, 5]);
		const stats = pool.stats();
		expect(stats.jobs).toBe(6);
		expect(stats.workers).toHaveLength(2);
		expect(stats.workers.reduce((sum, w) => sum + w.jobs, 0)).toBe(6);
		// Six 40 ms jobs ≈ 240 ms of busy time spread over two workers.
		expect(stats.busyMs).toBeGreaterThanOrEqual(200);
		expect(stats.wallMs).toBeGreaterThan(0);
		expect(stats.wallMs).toBeLessThan(stats.busyMs);
		expect(stats.utilisation).toBeGreaterThan(0);
		expect(stats.utilisation).toBeLessThanOrEqual(1);
		for (const worker of stats.workers) {
			expect(worker.jobs).toBeGreaterThan(0);
			expect(worker.busyMs).toBeGreaterThan(0);
		}
	});

	test('affinity keeps a key on one worker without starving the queue', async () => {
		const pool = makePool();
		const results = await Promise.all([
			...Array.from({ length: 4 }, (_, index) =>
				pool.run(
					'echo',
					{ delayMs: 10, value: `a${index}` },
					{ affinity: 'dir-a' }
				)
			),
			...Array.from({ length: 4 }, (_, index) =>
				pool.run(
					'echo',
					{ delayMs: 10, value: `b${index}` },
					{ affinity: 'dir-b' }
				)
			)
		]);
		expect(results).toHaveLength(8);
		const stats = pool.stats();
		expect(stats.jobs).toBe(8);
		for (const worker of stats.workers) {
			expect(worker.jobs).toBeGreaterThan(0);
		}
	});

	test('shutdown waits for in-flight jobs and tears the workers down', async () => {
		const pool = makePool();
		const pending = pool.run('echo', { delayMs: 80, value: 'late' });
		await sleep(10);
		await pool.shutdown();
		expect(pool.isWarm()).toBe(false);
		expect(await pending).toBe('late');
	});

	test('the published dist entry runs as a worker', async () => {
		if (!existsSync(DIST_ENTRY)) {
			console.warn('dist/build/buildWorker.js missing — run bun run build');

			return;
		}
		const pool = makePool({ entry: DIST_ENTRY });
		expect(await pool.run('echo', { value: 'dist' })).toBe('dist');
		expect(pool.stats().inlineJobs).toBe(0);
	});
});
