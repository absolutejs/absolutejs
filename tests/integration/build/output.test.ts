import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, rm, mkdtemp } from 'node:fs/promises';
import { describe, expect, test, afterAll } from 'bun:test';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const TEST_BUILD_BASE = resolve(PROJECT_ROOT, '.test-builds');

let outdir: string;
let manifest: Record<string, string>;

afterAll(async () => {
	if (outdir) {
		await rm(outdir, { force: true, recursive: true }).catch(() => {});
	}
});

describe('build output validation', () => {
	test(
		'setup: run production build',
		async () => {
			await mkdir(TEST_BUILD_BASE, { recursive: true });
			outdir = await mkdtemp(resolve(TEST_BUILD_BASE, 'build-output-'));

			// Run build in a subprocess to avoid process.exit(1) killing the test runner
			const proc = Bun.spawn(
				[
					'bun',
					'run',
					resolve(PROJECT_ROOT, 'src/cli/index.ts'),
					'start',
					resolve(PROJECT_ROOT, 'example/server.ts'),
					'--outdir',
					outdir,
					'--config',
					resolve(PROJECT_ROOT, 'example/absolute.config.ts')
				],
				{
					cwd: PROJECT_ROOT,
					env: {
						...process.env,
						FORCE_COLOR: '0',
						NODE_ENV: 'production',
						PORT: '0',
						TELEMETRY_OFF: '1'
					},
					stderr: 'ignore',
					stdout: 'ignore'
				}
			);

			// Wait for the build to produce manifest.json, then kill the server
			const maxWaitMs = 60_000;
			const pollMs = 500;
			const manifestPath = resolve(outdir, 'manifest.json');
			const start = Date.now();

			while (Date.now() - start < maxWaitMs) {
				if (existsSync(manifestPath)) break;
				await Bun.sleep(pollMs);
			}

			proc.kill();
			await proc.exited;

			expect(existsSync(manifestPath)).toBe(true);
		},
		120_000
	);

	test('manifest.json is valid JSON with entries', async () => {
		const manifestPath = resolve(outdir, 'manifest.json');
		const raw = await Bun.file(manifestPath).text();
		manifest = JSON.parse(raw);

		expect(Object.keys(manifest).length).toBeGreaterThan(0);
	});

	test('manifest contains entries for each framework', () => {
		const keys = Object.keys(manifest);
		const hasFramework = (name: string) =>
			keys.some((k) => k.toLowerCase().includes(name.toLowerCase()));

		expect(hasFramework('React')).toBe(true);
		expect(hasFramework('Svelte')).toBe(true);
		expect(hasFramework('Vue')).toBe(true);
		expect(hasFramework('Angular')).toBe(true);
		expect(hasFramework('HTML')).toBe(true);
		expect(hasFramework('HTMX')).toBe(true);
	});

	test('manifest CSS entries exist', () => {
		const cssKeys = Object.keys(manifest).filter((k) =>
			k.toLowerCase().includes('css')
		);
		expect(cssKeys.length).toBeGreaterThan(0);
	});

	test('client-side JS files referenced in manifest exist', () => {
		// Manifest has two kinds of paths:
		// - Relative web paths starting with "/" (client-side assets)
		// - Absolute filesystem paths (server-side SSR modules, HTML pages)
		const webPaths = Object.values(manifest).filter(
			(v) => v.startsWith('/') && !v.startsWith('/home')
		);
		expect(webPaths.length).toBeGreaterThan(0);

		for (const relPath of webPaths) {
			const fullPath = resolve(outdir, relPath.slice(1));
			expect(existsSync(fullPath)).toBe(true);
		}
	});

	test('compiled intermediates are cleaned up', () => {
		// Svelte and Vue compiled dirs are removed after build
		expect(existsSync(resolve(outdir, 'svelte/compiled'))).toBe(false);
		expect(existsSync(resolve(outdir, 'vue/compiled'))).toBe(false);
	});

	test('angular source compiled dir is cleaned up', () => {
		// Angular compiled/ in the source tree is removed after bundling
		const angularSourceCompiled = resolve(
			PROJECT_ROOT,
			'example/angular/compiled'
		);
		expect(existsSync(angularSourceCompiled)).toBe(false);
	});

	test('html pages have updated asset paths', async () => {
		const htmlKey = Object.keys(manifest).find(
			(k) =>
				k.toLowerCase().includes('html') &&
				!k.toLowerCase().includes('css') &&
				!k.toLowerCase().includes('htmx')
		);
		expect(htmlKey).toBeDefined();

		// HTML page paths are absolute filesystem paths in the manifest
		const htmlPath = htmlKey ? manifest[htmlKey] : undefined;
		expect(htmlPath).toBeDefined();
		if (!htmlPath) return;
		expect(existsSync(htmlPath)).toBe(true);

		const content = await Bun.file(htmlPath).text();
		expect(content).toMatch(/\.css/);
	});
});
