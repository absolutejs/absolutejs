import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeAbsoluteCapacitorWebBundle } from '../../../src/mobile/capacitorBundle';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { createAbsoluteMobileCompatibilityArtifact } from '../../../src/mobile/releaseArtifact';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('Capacitor local web bundle', () => {
	test('ships the signed page bundle and excludes the server producer', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-capacitor-bundle-')
		);
		temporaryDirectories.push(root);
		const buildDirectory = join(root, 'build');
		const pageSource =
			'import "/react/vendor/react.js"; globalThis.__MOBILE_PAGE_LOADED__ = true;';
		const pagePath = join(buildDirectory, 'generated', 'Account.js');
		await Bun.write(pagePath, pageSource);
		await Bun.write(
			join(buildDirectory, 'react', 'vendor', 'react.js'),
			'globalThis.__REACT_VENDOR_LOADED__ = true;'
		);
		const bundleHash = createHash('sha256')
			.update(pageSource)
			.digest('hex');
		const artifact = createAbsoluteMobileCompatibilityArtifact({
			appBuild: 'build-1',
			appId: 'com.example.product',
			generation: 1,
			pages: [
				{
					bundleHash,
					bundlePath: '/generated/Account.js',
					contract: 'account@1',
					framework: 'react',
					pageId: 'Account',
					propsSchemaHash: 'schema-account'
				}
			],
			producer: {
				bundleHash: 'server-producer-hash',
				bytes: 100,
				exportName: 'app',
				module: 'producer.js'
			},
			routes: [
				{ method: 'GET', pageId: 'Account', pattern: '/account/:id' }
			],
			runtime: '1'
		});
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				bundleDirectory: 'mobile-web',
				entry: '/account/Ada',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const manifest = await materializeAbsoluteCapacitorWebBundle({
			artifact,
			buildDirectory,
			config
		});
		const embedded = await readFile(
			join(root, 'mobile-web', manifest.pages[0]?.localBundlePath ?? ''),
			'utf8'
		);
		const bootstrap = await readFile(
			join(root, 'mobile-web', 'absolute-mobile-bootstrap.js'),
			'utf8'
		);
		const vendor = await readFile(
			join(root, 'mobile-web', 'react', 'vendor', 'react.js'),
			'utf8'
		);

		expect(embedded).toBe(pageSource);
		expect(vendor).toContain('__REACT_VENDOR_LOADED__');
		expect(bootstrap).toContain('appUrlOpen');
		expect(bootstrap).not.toContain('server-producer-hash');
		expect(
			await Bun.file(join(root, 'mobile-web', 'index.html')).exists()
		).toBe(true);
	});
});
