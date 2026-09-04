import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	cleanStaleAssets,
	populateAssetStore
} from '../../../src/dev/assetStore';

describe('asset store shared chunks', () => {
	test('populateAssetStore loads manifest chunk keys and never evicts chunks', async () => {
		const buildDir = mkdtempSync(join(tmpdir(), 'asset-store-chunks-'));
		writeFileSync(
			join(buildDir, 'chunk-aaaaaaaa.js'),
			'export var a = 1;\n'
		);
		writeFileSync(
			join(buildDir, 'chunk-bbbbbbbb.js'),
			'export var b = 2;\n'
		);
		const store = new Map<string, Uint8Array>();

		await populateAssetStore(
			store,
			{ ChunkAaaaaaaa: '/chunk-aaaaaaaa.js' },
			buildDir
		);
		expect(store.has('/chunk-aaaaaaaa.js')).toBe(true);
		// Chunks on disk but outside the (partial) manifest are picked up too.
		expect(store.has('/chunk-bbbbbbbb.js')).toBe(true);

		// A later partial manifest naming a different chunk must not evict
		// the earlier one — pages outside the partial build still import it.
		await populateAssetStore(
			store,
			{ ChunkBbbbbbbb: '/chunk-bbbbbbbb.js' },
			buildDir
		);
		expect(store.has('/chunk-aaaaaaaa.js')).toBe(true);
		expect(store.has('/chunk-bbbbbbbb.js')).toBe(true);
	});

	test('cleanStaleAssets drops chunk entries whose file left the disk', async () => {
		const buildDir = mkdtempSync(join(tmpdir(), 'asset-store-evict-'));
		writeFileSync(
			join(buildDir, 'chunk-aaaaaaaa.js'),
			'export var a = 1;\n'
		);
		const store = new Map<string, Uint8Array>([
			['/chunk-aaaaaaaa.js', new Uint8Array([1])],
			['/chunk-gone00000.js', new Uint8Array([2])]
		]);

		await cleanStaleAssets(store, {}, buildDir);

		expect(store.has('/chunk-aaaaaaaa.js')).toBe(true);
		expect(store.has('/chunk-gone00000.js')).toBe(false);
	});
});
