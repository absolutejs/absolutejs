import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	OUTPUT_RECORD,
	cleanStaleOutputs
} from '../../../src/utils/cleanStaleOutputs';

type ScaffoldFiles = {
	liveChunk: string;
	livePage: string;
	manifest: string;
	staleChunk: string;
	stalePage: string;
	vendor: string;
	vendorChunk: string;
};

const scaffold = () => {
	const buildDir = mkdtempSync(join(tmpdir(), 'clean-stale-outputs-'));
	mkdirSync(join(buildDir, 'vue', 'indexes'), { recursive: true });
	const files: ScaffoldFiles = {
		liveChunk: join(buildDir, 'chunk-a1b2c3d4.js'),
		livePage: join(buildDir, 'vue', 'indexes', 'Page.a1b2c3d4.js'),
		manifest: join(buildDir, 'manifest.json'),
		staleChunk: join(buildDir, 'chunk-deadbeef.js'),
		stalePage: join(buildDir, 'vue', 'indexes', 'Page.deadbeef.js'),
		vendor: join(buildDir, 'vue', 'vendor', 'vue.js'),
		vendorChunk: join(buildDir, 'react', 'vendor', 'chunk-ffffffff.js')
	};
	mkdirSync(join(buildDir, 'vue', 'vendor'), { recursive: true });
	mkdirSync(join(buildDir, 'react', 'vendor'), { recursive: true });
	for (const path of Object.values(files)) writeFileSync(path, '// x\n');

	return { buildDir, files };
};

describe('cleanStaleOutputs', () => {
	test('removes root chunks the current build did not emit', async () => {
		const { buildDir, files } = scaffold();
		await cleanStaleOutputs(buildDir, [files.livePage, files.liveChunk]);

		expect(existsSync(files.livePage)).toBe(true);
		expect(existsSync(files.liveChunk)).toBe(true);
		expect(existsSync(files.stalePage)).toBe(false);
		expect(existsSync(files.staleChunk)).toBe(false);
		// Vendor bundles emit their own chunks outside this pass — keep them.
		expect(existsSync(files.vendorChunk)).toBe(true);
	});

	test('removes older base36-hashed versions of current outputs', async () => {
		const buildDir = mkdtempSync(join(tmpdir(), 'clean-stale-outputs-'));
		const dir = join(buildDir, 'react', 'server', 'rsc');
		mkdirSync(join(buildDir, 'react', 'rsc'), { recursive: true });
		mkdirSync(dir, { recursive: true });
		const live = join(dir, 'Dashboard.k3x9a0bq.js');
		const stale = join(dir, 'Dashboard.zz81mq0p.js');
		const staleMap = join(dir, 'Dashboard.zz81mq0p.js.map');
		const liveChunk = join(buildDir, 'react', 'rsc', 'chunk-m2n4p6q8.js');
		const staleChunk = join(buildDir, 'react', 'rsc', 'chunk-r5t7v9x1.js');
		const userFile = join(buildDir, 'fonts', 'inter.variable.woff2');
		mkdirSync(join(buildDir, 'fonts'), { recursive: true });
		const staleBrotli = `${stale}.br`;
		const liveBrotli = `${live}.br`;
		for (const path of [
			live,
			stale,
			staleMap,
			staleBrotli,
			liveBrotli,
			liveChunk,
			staleChunk
		])
			writeFileSync(path, '// x\n');
		writeFileSync(userFile, 'font');

		await cleanStaleOutputs(buildDir, [live, `${live}.map`, liveChunk]);

		expect(existsSync(live)).toBe(true);
		expect(existsSync(liveChunk)).toBe(true);
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(staleMap)).toBe(false);
		expect(existsSync(staleChunk)).toBe(false);
		expect(existsSync(staleBrotli)).toBe(false);
		expect(existsSync(liveBrotli)).toBe(true);
		expect(existsSync(userFile)).toBe(true);
	});

	test('removes outputs of a deleted page via the previous build record', async () => {
		const buildDir = mkdtempSync(join(tmpdir(), 'clean-stale-outputs-'));
		mkdirSync(join(buildDir, 'svelte', 'pages'), { recursive: true });
		const kept = join(buildDir, 'svelte', 'pages', 'Home.k3x9a0bq.js');
		const deleted = join(buildDir, 'svelte', 'pages', 'Gone.zz81mq0p.js');
		const userFile = join(
			buildDir,
			'svelte',
			'pages',
			'notes.abcdefgh.txt'
		);
		for (const path of [kept, deleted, userFile]) writeFileSync(path, 'x');

		await cleanStaleOutputs(buildDir, [kept, deleted]);
		expect(existsSync(join(buildDir, OUTPUT_RECORD))).toBe(true);

		// A dev full build skips unopened pages, so it never prunes by record.
		await cleanStaleOutputs(buildDir, [kept], { pruneRecorded: false });
		expect(existsSync(deleted)).toBe(true);

		await cleanStaleOutputs(buildDir, [kept]);
		expect(existsSync(kept)).toBe(true);
		expect(existsSync(deleted)).toBe(false);
		expect(existsSync(userFile)).toBe(true);
	});

	test('leaves non-content-addressed files alone', async () => {
		const { buildDir, files } = scaffold();
		await cleanStaleOutputs(buildDir, []);

		expect(existsSync(files.manifest)).toBe(true);
		expect(existsSync(files.vendor)).toBe(true);
	});
});
