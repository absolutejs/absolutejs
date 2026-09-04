import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanWorkerReferences } from '../../../src/core/build';

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('worker reference scanning', () => {
	test('does not promote test-only URL references into browser entries', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-worker-scan-'));
		tempDirs.push(dir);
		const productionWorker = join(dir, 'productionWorker.ts');
		const testWorker = join(dir, 'testWorker.ts');
		const nestedTestWorker = join(dir, 'nestedTestWorker.ts');
		writeFileSync(productionWorker, 'self.postMessage("production");');
		writeFileSync(testWorker, 'self.postMessage("test");');
		writeFileSync(nestedTestWorker, 'self.postMessage("nested-test");');
		writeFileSync(
			join(dir, 'entry.ts'),
			'new Worker(new URL("./productionWorker.ts", import.meta.url));'
		);
		writeFileSync(
			join(dir, 'entry.test.ts'),
			'new URL("./testWorker.ts", import.meta.url);'
		);
		mkdirSync(join(dir, '__tests__'));
		writeFileSync(
			join(dir, '__tests__', 'entry.tsx'),
			'new URL("../nestedTestWorker.ts", import.meta.url);'
		);

		expect(new Set(await scanWorkerReferences([dir]))).toEqual(
			new Set([productionWorker])
		);
	});

	test('memoised scans still see a worker reference added after the first scan', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-worker-memo-'));
		tempDirs.push(dir);
		const worker = join(dir, 'worker.ts');
		const entry = join(dir, 'entry.ts');
		writeFileSync(worker, 'self.postMessage("worker");');
		writeFileSync(entry, 'export const noop = () => {};');

		expect(await scanWorkerReferences([dir], true)).toEqual([]);

		writeFileSync(
			entry,
			'new Worker(new URL("./worker.ts", import.meta.url));'
		);

		expect(await scanWorkerReferences([dir], true)).toEqual([worker]);
	});

	test('memoised scans still see a newly created worker target', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-worker-memo-target-'));
		tempDirs.push(dir);
		const worker = join(dir, 'worker.ts');
		writeFileSync(
			join(dir, 'entry.ts'),
			'new Worker(new URL("./worker.ts", import.meta.url));'
		);

		// The referencing file never changes, so a memo that cached the
		// resolved paths rather than the raw specifiers would miss this.
		expect(await scanWorkerReferences([dir], true)).toEqual([]);

		writeFileSync(worker, 'self.postMessage("worker");');

		expect(await scanWorkerReferences([dir], true)).toEqual([worker]);
	});

	test('memoised scans drop a worker reference removed after the first scan', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-worker-memo-drop-'));
		tempDirs.push(dir);
		const worker = join(dir, 'worker.ts');
		const entry = join(dir, 'entry.ts');
		writeFileSync(worker, 'self.postMessage("worker");');
		writeFileSync(
			entry,
			'new Worker(new URL("./worker.ts", import.meta.url));'
		);

		expect(await scanWorkerReferences([dir], true)).toEqual([worker]);

		rmSync(entry);

		expect(await scanWorkerReferences([dir], true)).toEqual([]);
	});
});
