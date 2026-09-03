import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanStaleOutputs } from '../../../src/utils/cleanStaleOutputs';

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

	test('leaves non-content-addressed files alone', async () => {
		const { buildDir, files } = scaffold();
		await cleanStaleOutputs(buildDir, []);

		expect(existsSync(files.manifest)).toBe(true);
		expect(existsSync(files.vendor)).toBe(true);
	});
});
