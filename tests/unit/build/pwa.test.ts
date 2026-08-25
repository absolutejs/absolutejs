import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	injectPwaBootstrapHtml,
	materializeAbsolutePwa
} from '../../../src/build/pwa';

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-pwa-'));
	roots.push(root);

	return {
		buildPath: join(root, 'build'),
		generatedRoot: join(root, '.absolutejs', 'generated')
	};
};

describe('AbsoluteJS PWA build integration', () => {
	test('materializes one shared bootstrap, manifest, and Sync worker', async () => {
		const paths = await fixture();
		const artifacts = await materializeAbsolutePwa({
			...paths,
			config: {
				manifest: {
					icons: [
						{ src: '/icon.png', sizes: '512x512', type: 'image/png' }
					],
					name: 'Absolute App',
					shortName: 'Absolute'
				},
				serviceWorker: {
					offline: { fallback: '/offline.html' }
				},
				sync: true
			}
		});

		expect(artifacts).toMatchObject({
			bootstrapPublicPath: '/__absolute/pwa/bootstrap.js',
			manifestPath: '/manifest.webmanifest',
			serviceWorkerPath: '/sw.js'
		});
		const worker = await readFile(join(paths.buildPath, 'sw.js'), 'utf8');
		expect(worker).toContain('ABSOLUTE_SYNC_CONFIGURE');
		const manifest = JSON.parse(
			await readFile(
				join(paths.buildPath, 'manifest.webmanifest'),
				'utf8'
			)
		);
		expect(manifest).toMatchObject({
			display: 'standalone',
			name: 'Absolute App',
			short_name: 'Absolute'
		});
		const browserBootstrap = await readFile(
			join(paths.buildPath, '__absolute', 'pwa', 'bootstrap.js'),
			'utf8'
		);
		expect(browserBootstrap).toContain('/manifest.webmanifest');
		expect(browserBootstrap).toContain('/sw.js');
		expect(browserBootstrap).toContain('__absolute/sync/background');
		expect(artifacts.bootstrapBanner).toContain('await import(new URL');
		expect(artifacts.bootstrapBanner).toContain(
			'/__absolute/pwa/bootstrap.js'
		);
		const pageEntry = join(paths.generatedRoot, 'page.ts');
		await writeFile(pageEntry, 'globalThis.__absolutePageStarted = true;\n');
		const pageBuild = await Bun.build({
			banner: artifacts.bootstrapBanner,
			entrypoints: [pageEntry],
			outdir: join(paths.buildPath, 'page'),
			target: 'browser'
		});
		expect(pageBuild.success).toBe(true);
		const pageOutput = await pageBuild.outputs[0]?.text();
		expect(pageOutput).toContain('await import(new URL');
		expect(pageOutput).toContain('__absolutePageStarted');
	});

	test('rejects worker and manifest paths that can leave the public boundary', async () => {
		const paths = await fixture();
		await expect(
			materializeAbsolutePwa({
				...paths,
				config: { serviceWorkerPath: '/../outside.js' }
			})
		).rejects.toThrow('traversal');
		await expect(
			materializeAbsolutePwa({
				...paths,
				config: {
					manifest: {
						icons: [],
						name: 'App',
						path: 'https://attacker.example/manifest.json',
						shortName: 'App'
					}
				}
			})
		).rejects.toThrow('absolute same-origin');
		await expect(
			materializeAbsolutePwa({
				...paths,
				config: { serviceWorkerPath: '/workers/sw.js' }
			})
		).rejects.toThrow('root-level');
	});

	test('injects the static-page bootstrap once before head closes', () => {
		const once = injectPwaBootstrapHtml(
			'<!doctype html><html><head><title>App</title></head><body></body></html>'
		);
		const twice = injectPwaBootstrapHtml(once);
		expect(once).toContain(
			'<script type="module" src="/__absolute/pwa/bootstrap.js" data-absolute-pwa></script></head>'
		);
		expect(twice).toBe(once);
	});
});
