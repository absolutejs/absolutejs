import { describe, expect, test, afterAll } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

	test('page HTML is served no-cache (so deploys are picked up)', async () => {
		// The HTML shell must always revalidate, or a cached index keeps
		// pointing at the previous deploy's hashed assets. Buffered pages also
		// carry a content-hash ETag (→ a 304 when byte-identical; the 304
		// mechanics are covered by the pageResponseCache unit test). Hashed
		// assets stay immutable — covered by the asset-cache test below.
		for (const route of ['/vue', '/svelte', '/angular', '/']) {
			const res = await fetch(`${server.baseUrl}${route}`);
			await res.text();
			expect(res.headers.get('content-type') ?? '').toContain(
				'text/html'
			);
			expect(res.headers.get('cache-control')).toBe('no-cache');
			// The internal streaming marker must never leak to the client.
			expect(res.headers.get('x-absolute-stream')).toBeNull();
		}
	});

	test('public JS bundles do not expose inline source maps', async () => {
		// Server bundles retain maps for stack traces but must be inaccessible
		// over HTTP. Check every inline map, including server output, against
		// the actual static routes rather than treating private files as public.
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
		for (const file of withInlineMap) {
			const path = relative(server.outdir, file);
			const response = await fetch(`${server.baseUrl}/${path}`);
			await response.text();
			expect(response.status).toBe(404);
		}
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
		/* Collected, then asserted as one object naming every URL with the
		 * header it answered. Asserting the number inside the loop reported
		 * `expected 0 to be >= 60` and nothing about WHICH asset served it,
		 * so the failure said nothing about where to look. */
		const served: Record<string, string> = {};
		for (const url of hashedUrls) {
			/* Both encodings, because they are answered by different
			 * plugins: a client that accepts gzip gets the precompressed
			 * copy from `onRequest`, which short-circuits the lifecycle and
			 * so never passes through the asset-cache `onAfterHandle`. That
			 * half served `max-age=0` on every hashed asset while this test
			 * passed — it only sent one request, and whichever half it hit
			 * said nothing about the other. */
			for (const encoding of ['gzip, br', 'identity']) {
				const res = await fetch(`${server.baseUrl}${url}`, {
					headers: { 'accept-encoding': encoding }
				});
				if (!res.ok) {
					// Some hashed-looking URLs in the HTML might be from
					// nested manifests we don't serve; skip 404s rather
					// than fail.
					continue;
				}
				served[`${url} (accept-encoding: ${encoding})`] =
					res.headers.get('cache-control') ?? '(none)';
			}
		}
		// `staticPlugin` puts `max-age=<seconds>` on hashed assets. We
		// require a non-zero max-age — anything < 60s would defeat
		// content-hash caching.
		const cacheable = (header: string) => {
			const maxAge = /max-age=(\d+)/.exec(header)?.[1];

			return maxAge !== undefined && Number(maxAge) >= 60;
		};
		const offenders = Object.fromEntries(
			Object.entries(served).filter(([, header]) => !cacheable(header))
		);

		expect(offenders).toEqual({});
	});

	test('prod bundle does not start an HMR WebSocket server', async () => {
		// `/hmr` is the dev WS upgrade path. In prod the HMR plugin
		// is stubbed → no upgrade handler, so a WS handshake here
		// should NOT succeed.
		const wsUrl = `ws://localhost:${server.port}/hmr`;
		const opened = await new Promise<boolean>((resolve) => {
			try {
				const ws = new WebSocket(wsUrl);
				const timer = setTimeout(() => {
					try {
						ws.close();
					} catch {
						/* */
					}
					resolve(false);
				}, 2_000);
				ws.onopen = () => {
					clearTimeout(timer);
					try {
						ws.close();
					} catch {
						/* */
					}
					resolve(true);
				};
				ws.onerror = () => {
					clearTimeout(timer);
					resolve(false);
				};
				ws.onclose = () => {
					clearTimeout(timer);
					resolve(false);
				};
			} catch {
				resolve(false);
			}
		});
		expect(opened).toBe(false);
	});
});
