import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	computeVendorCacheKey,
	readLockfileHash,
	restoreVendorCache,
	saveVendorCache,
	type VendorCacheInputs
} from '../../../src/build/vendorCache';

/* The vendor cache is what lets a restart skip rebuilding (and
 * re-rewriting) the dev vendor bundles. Its two load-bearing properties:
 * the key changes whenever anything the bundles depend on changes, and a
 * save/restore round trip reproduces the directories byte for byte. */

const temporaryDirs: string[] = [];

const makeProject = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-vendor-cache-'));
	temporaryDirs.push(root);

	return root;
};

afterEach(async () => {
	await Promise.all(
		temporaryDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const baseInputs: VendorCacheInputs = {
	frameworkVersion: '0.20.0',
	lockfileHash: 'lock-hash',
	runtimeVersion: '1.3.0',
	sourceDirs: ['/app/src/frontend'],
	specifiers: ['vue', '@tanstack/vue-query'],
	vendorDirs: ['/app/build/vue/vendor', '/app/build/vendor']
};

describe('computeVendorCacheKey', () => {
	test('is stable for the same inputs and order-independent', () => {
		expect(computeVendorCacheKey(baseInputs)).toBe(
			computeVendorCacheKey({
				...baseInputs,
				specifiers: ['@tanstack/vue-query', 'vue']
			})
		);
	});

	const changes: Array<[string, Partial<VendorCacheInputs>]> = [
		['lockfile', { lockfileHash: 'other-lock' }],
		['framework version', { frameworkVersion: '0.21.0' }],
		['runtime version', { runtimeVersion: '1.4.0' }],
		['source dirs', { sourceDirs: ['/app/src/other'] }],
		['specifier set', { specifiers: ['vue'] }],
		['vendor dirs', { vendorDirs: ['/app/build/react/vendor'] }]
	];

	for (const [label, change] of changes) {
		test(`changes when the ${label} changes`, () => {
			expect(computeVendorCacheKey({ ...baseInputs, ...change })).not.toBe(
				computeVendorCacheKey(baseInputs)
			);
		});
	}
});

describe('readLockfileHash', () => {
	test('is null without a lockfile, so the cache stays off', async () => {
		const root = await makeProject();

		expect(readLockfileHash(root)).toBeNull();
	});

	test('tracks the lockfile contents', async () => {
		const root = await makeProject();
		writeFileSync(join(root, 'bun.lock'), 'one');
		const first = readLockfileHash(root);
		writeFileSync(join(root, 'bun.lock'), 'two');

		expect(first).not.toBeNull();
		expect(readLockfileHash(root)).not.toBe(first);
	});
});

describe('save/restore round trip', () => {
	test('restores the vendor directories and the payload', async () => {
		const root = await makeProject();
		const vendorDir = join(root, 'build', 'vue', 'vendor');
		const depVendorDir = join(root, 'build', 'vendor');
		mkdirSync(join(vendorDir, 'nested'), { recursive: true });
		mkdirSync(depVendorDir, { recursive: true });
		writeFileSync(join(vendorDir, 'vue.js'), 'export const vue = 1;');
		writeFileSync(join(vendorDir, 'nested', 'chunk.js'), 'chunk');
		writeFileSync(join(depVendorDir, 'dep.js'), 'dep');

		const dirs = [vendorDir, depVendorDir];
		await saveVendorCache(
			'key-one',
			dirs,
			{ angularSpecifiers: ['@angular/core'], depPaths: { dep: '/vendor/dep.js' } },
			root
		);
		await rm(join(root, 'build'), { force: true, recursive: true });

		const restored = await restoreVendorCache('key-one', dirs, root);

		expect(restored?.depPaths).toEqual({ dep: '/vendor/dep.js' });
		expect(restored?.angularSpecifiers).toEqual(['@angular/core']);
		expect(await Bun.file(join(vendorDir, 'vue.js')).text()).toBe(
			'export const vue = 1;'
		);
		expect(await Bun.file(join(vendorDir, 'nested', 'chunk.js')).text()).toBe(
			'chunk'
		);
		expect(await Bun.file(join(depVendorDir, 'dep.js')).text()).toBe('dep');
	});

	test('an unknown key is a miss, not an error', async () => {
		const root = await makeProject();

		expect(
			await restoreVendorCache('never-saved', [join(root, 'build')], root)
		).toBeNull();
	});

	test('a cache entry missing one of its directories is a miss', async () => {
		const root = await makeProject();
		const vendorDir = join(root, 'build', 'vendor');
		mkdirSync(vendorDir, { recursive: true });
		writeFileSync(join(vendorDir, 'dep.js'), 'dep');
		await saveVendorCache('key-two', [vendorDir], { depPaths: {} }, root);

		// A second directory the cache entry never captured.
		const extraDir = join(root, 'build', 'vue', 'vendor');
		mkdirSync(extraDir, { recursive: true });

		expect(
			await restoreVendorCache('key-two', [vendorDir, extraDir], root)
		).toBeNull();
	});

	test('does not overwrite an existing entry for the same key', async () => {
		const root = await makeProject();
		const vendorDir = join(root, 'build', 'vendor');
		mkdirSync(vendorDir, { recursive: true });
		writeFileSync(join(vendorDir, 'dep.js'), 'first');
		await saveVendorCache('key-three', [vendorDir], { depPaths: {} }, root);
		writeFileSync(join(vendorDir, 'dep.js'), 'second');
		await saveVendorCache('key-three', [vendorDir], { depPaths: {} }, root);
		await rm(vendorDir, { force: true, recursive: true });
		await restoreVendorCache('key-three', [vendorDir], root);

		expect(await Bun.file(join(vendorDir, 'dep.js')).text()).toBe('first');
		expect(existsSync(join(root, '.absolutejs', 'vendor-cache'))).toBe(true);
	});
});
