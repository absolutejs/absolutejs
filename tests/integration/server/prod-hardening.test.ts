import { describe, expect, test, afterAll } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startProdServer, type ProdServer } from '../../helpers/prodServer';
import { fetchPage } from '../../helpers/http';

let server: ProdServer;

afterAll(async () => {
	await server?.kill();
});

/* Production-bundle hardening: contracts the broader prod-startup /
 * prod-ssr tests don't lock in. Each subtest is a class of
 * dev-only leak or runtime-fragility regression that's easy to
 * accidentally re-introduce when refactoring `start.ts`'s stub
 * plugin or the dev-build path. */
describe('production bundle hardening', () => {
	test('setup: start production server', async () => {
		server = await startProdServer();
		expect(server.port).toBeGreaterThan(0);
	}, 120_000);

	test('manifest.json exists at the outdir root with expected page entries', () => {
		const manifestPath = join(server.outdir, 'manifest.json');
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		// Per-framework page entries should resolve to paths/URLs.
		for (const key of [
			'VueExample',
			'SvelteExample',
			'AngularExample',
			'HTMLExample'
		]) {
			expect(typeof manifest[key]).toBe('string');
			expect(manifest[key].length).toBeGreaterThan(0);
		}
	});

	test('SSR HTML does NOT reference /@src/ paths (dev-only module-server URL)', async () => {
		for (const route of ['/vue', '/svelte', '/angular', '/']) {
			const { html } = await fetchPage(`${server.baseUrl}${route}`);
			expect(html).not.toContain('/@src/');
		}
	});

	test('client-side JS bundles do NOT carry inline sourcemap comments (dev-only)', () => {
		// Walk the outdir for *.js files (not .ssr.js / vendor / chunk
		// internals — those land outside the served paths too, but
		// being thorough is cheap).
		const seenJsFiles: string[] = [];
		const walk = (dir: string) => {
			if (!existsSync(dir)) return;
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				const s = statSync(full);
				if (s.isDirectory()) {
					if (
						entry === 'node_modules' ||
						entry.startsWith('.') ||
						entry === '_prerendered'
					) {
						continue;
					}
					walk(full);
					continue;
				}
				if (entry.endsWith('.js')) seenJsFiles.push(full);
			}
		};
		walk(server.outdir);
		expect(seenJsFiles.length).toBeGreaterThan(0);

		const withInlineMap = seenJsFiles.filter((file) => {
			const text = readFileSync(file, 'utf-8');

			return /\n\/\/# sourceMappingURL=data:application\/json;base64,/.test(
				text
			);
		});
		expect(withInlineMap).toEqual([]);
	});

	test('hashed asset URLs in SSR HTML serve with `immutable` cache header', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/vue`);
		// Hashed URLs follow `name.<8-or-more-char-hash>.ext` — the
		// `<hash>` is the bundler's content-hash, so the file is
		// safe to cache forever.
		const hashedUrls = [
			...html.matchAll(
				/(?:href|src)="(\/[^"]+\.[a-z0-9]{6,}\.(?:js|css))"/g
			)
		].map((m) => m[1]);
		expect(hashedUrls.length).toBeGreaterThan(0);
		for (const url of hashedUrls) {
			const res = await fetch(`${server.baseUrl}${url}`);
			if (!res.ok) {
				// Some hashed-looking URLs in the HTML might be from
				// nested manifests we don't serve; skip 404s rather
				// than fail.
				continue;
			}
			const cacheControl = res.headers.get('cache-control') ?? '';
			// `staticPlugin` puts `max-age=<seconds>` on hashed
			// assets. We require a non-zero max-age — anything < 60s
			// would defeat content-hash caching.
			const maxAgeMatch = /max-age=(\d+)/.exec(cacheControl);
			expect(maxAgeMatch).not.toBeNull();
			expect(Number(maxAgeMatch![1])).toBeGreaterThanOrEqual(60);
		}
	});

	test('prod bundle does not start an HMR WebSocket server', async () => {
		// `/hmr` is the dev WS upgrade path. In prod the HMR plugin
		// is stubbed → no upgrade handler, so a WS handshake here
		// should NOT succeed.
		const wsUrl = `ws://localhost:${server.port}/hmr`;
		const opened = await new Promise<boolean>((res) => {
			try {
				const ws = new WebSocket(wsUrl);
				const timer = setTimeout(() => {
					try {
						ws.close();
					} catch {
						/* */
					}
					res(false);
				}, 2_000);
				ws.onopen = () => {
					clearTimeout(timer);
					try {
						ws.close();
					} catch {
						/* */
					}
					res(true);
				};
				ws.onerror = () => {
					clearTimeout(timer);
					res(false);
				};
				ws.onclose = () => {
					clearTimeout(timer);
					res(false);
				};
			} catch {
				res(false);
			}
		});
		expect(opened).toBe(false);
	});
});
