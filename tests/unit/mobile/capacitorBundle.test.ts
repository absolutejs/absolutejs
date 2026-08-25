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
		const styleSource = '.account{background:url("/assets/account.png")}';
		const stylePath = join(buildDirectory, 'generated', 'Account.css');
		await Bun.write(pagePath, pageSource);
		await Bun.write(stylePath, styleSource);
		await Bun.write(
			join(buildDirectory, 'assets', 'account.png'),
			new Uint8Array([1, 2, 3])
		);
		await Bun.write(
			join(buildDirectory, 'react', 'vendor', 'react.js'),
			'import "./chunk-react.js"; const diagnostic = `from "./NotAnImport.js"`; globalThis.__REACT_VENDOR_LOADED__ = diagnostic;'
		);
		await Bun.write(
			join(buildDirectory, 'react', 'vendor', 'chunk-react.js'),
			'import "./chunk-shared.js"; globalThis.__REACT_CHUNK_LOADED__ = true;'
		);
		await Bun.write(
			join(buildDirectory, 'react', 'vendor', 'chunk-shared.js'),
			'globalThis.__REACT_SHARED_CHUNK_LOADED__ = true;'
		);
		const bundleHash = createHash('sha256')
			.update(pageSource)
			.digest('hex');
		const styleBundleHash = createHash('sha256')
			.update(styleSource)
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
					propsSchemaHash: 'schema-account',
					styleBundleHash,
					styleBundlePath: '/generated/Account.css'
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
			auth: {
				clientId: 'absolutejs-native:com.example.product',
				issuer: 'https://api.example.com',
				redirectUri: 'com.example.product://auth/callback',
				scopes: ['openid', 'profile']
			},
			buildDirectory,
			config,
			sync: true
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
		const localStylePath = manifest.pages[0]?.localStylePath;

		expect(embedded).toBe(pageSource);
		expect(localStylePath).toBeDefined();
		expect(
			await Bun.file(
				join(root, 'mobile-web', localStylePath ?? '')
			).text()
		).toBe(styleSource);
		expect(
			await Bun.file(
				join(root, 'mobile-web', 'assets', 'account.png')
			).exists()
		).toBe(true);
		expect(vendor).toContain('__REACT_VENDOR_LOADED__');
		expect(
			await Bun.file(
				join(root, 'mobile-web', 'react', 'vendor', 'chunk-shared.js')
			).exists()
		).toBe(true);
		expect(bootstrap).toContain('appUrlOpen');
		expect(bootstrap).toContain('AbsoluteSecureStorage');
		expect(bootstrap).toContain('oidc.refresh');
		expect(bootstrap).toContain('client-runtime-transport');
		expect(bootstrap).toContain('absolute_sync_metadata');
		expect(bootstrap).toContain('registerClient');
		expect(bootstrap).toContain('networkStatusChange');
		expect(bootstrap).toContain('absoluteMobilePageStyle');
		expect(bootstrap).not.toContain('server-producer-hash');
		expect(
			await Bun.file(join(root, 'mobile-web', 'index.html')).exists()
		).toBe(true);
		expect(manifest.auth).toEqual({
			clientId: 'absolutejs-native:com.example.product',
			issuer: 'https://api.example.com',
			redirectUri: 'com.example.product://auth/callback',
			scopes: ['openid', 'profile']
		});
		expect(manifest.sync).toEqual({ socketTickets: true });
	});

	test('embeds every completed client framework and defers Ember', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-capacitor-frameworks-')
		);
		temporaryDirectories.push(root);
		const buildDirectory = join(root, 'build');
		const frameworks = [
			'angular',
			'html',
			'htmx',
			'react',
			'svelte',
			'vue'
		] as const;
		const sourceFor = (framework: (typeof frameworks)[number]) => {
			if (framework === 'html') {
				return '<script type="module" src="/example/html/app.js"></script>';
			}
			if (framework === 'htmx') {
				return '<script src="/htmx/htmx.min.js"></script>';
			}

			return `globalThis.__${framework.toUpperCase()}_MOBILE__ = true;`;
		};
		const pages = await Promise.all(
			frameworks.map(async (framework) => {
				const source = sourceFor(framework);
				const extension =
					framework === 'html' || framework === 'htmx'
						? 'html'
						: 'js';
				const bundlePath = `/generated/${framework}.${extension}`;
				await Bun.write(join(buildDirectory, bundlePath), source);

				return {
					bundleHash: createHash('sha256')
						.update(source)
						.digest('hex'),
					bundlePath,
					contract: `${framework}@1`,
					framework,
					pageId: framework,
					propsSchemaHash: `schema-${framework}`
				};
			})
		);
		await Bun.write(
			join(buildDirectory, 'example', 'html', 'app.js'),
			'globalThis.__HTML_MOBILE__ = true;'
		);
		await Bun.write(
			join(buildDirectory, 'htmx', 'htmx.min.js'),
			'globalThis.htmx = {};'
		);
		const artifact = createAbsoluteMobileCompatibilityArtifact({
			appBuild: 'build-frameworks',
			appId: 'com.example.frameworks',
			generation: 1,
			pages,
			producer: {
				bundleHash: 'producer',
				bytes: 1,
				exportName: 'app',
				module: 'producer.js'
			},
			routes: frameworks.map((framework) => ({
				method: 'GET' as const,
				pageId: framework,
				pattern: `/${framework}`
			})),
			runtime: '1'
		});
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.frameworks',
				appName: 'Frameworks',
				bundleDirectory: 'mobile-web',
				entry: '/react',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const manifest = await materializeAbsoluteCapacitorWebBundle({
			artifact,
			buildDirectory,
			config
		});

		expect(manifest.pages.map(({ framework }) => framework).sort()).toEqual(
			[...frameworks].sort()
		);
		for (const page of manifest.pages) {
			expect(
				await Bun.file(
					join(root, 'mobile-web', page.localBundlePath)
				).exists()
			).toBe(true);
		}
		expect(
			await Bun.file(
				join(root, 'mobile-web', 'example', 'html', 'app.js')
			).exists()
		).toBe(true);
		expect(
			await Bun.file(
				join(root, 'mobile-web', 'htmx', 'htmx.min.js')
			).exists()
		).toBe(true);

		const [firstPage] = pages;
		if (!firstPage) throw new Error('Expected a framework page.');
		const emberArtifact = createAbsoluteMobileCompatibilityArtifact({
			...artifact,
			appBuild: 'build-ember',
			pages: [
				{
					...firstPage,
					contract: 'ember@1',
					framework: 'ember',
					pageId: 'ember'
				}
			],
			routes: [{ method: 'GET', pageId: 'ember', pattern: '/ember' }]
		});
		await expect(
			materializeAbsoluteCapacitorWebBundle({
				artifact: emberArtifact,
				buildDirectory,
				config: normalizeAbsoluteMobileConfig(
					{
						appId: 'com.example.frameworks',
						appName: 'Frameworks',
						bundleDirectory: 'mobile-ember',
						entry: '/ember',
						server: {
							productionOrigin: 'https://api.example.com'
						}
					},
					root
				)
			})
		).rejects.toThrow('does not yet support ember');
	});
});
