import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExpandStaticRoutes } from '../../../types/staticRoutes';
import { prerender } from '../../../src/core/prerender';

/* The pre-render pass with an expander: what it is handed back is what
 * it renders, what the expander could not fill is reported with the
 * pages that failed to render, and the pages are rendered a few at a
 * time. A server that only counts and delays stands in for the app. */

const RENDER_MS = 30;

type Load = { active: number; peak: number; served: string[] };

const load: Load = { active: 0, peak: 0, served: [] };

let root = '';
let server: ReturnType<typeof Bun.serve> | undefined;

const page = (path: string) =>
	`<!DOCTYPE html><html><head><title>t</title></head><body>${path}</body></html>`;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-prerender-expansion-'));
	server = Bun.serve({
		port: 0,
		fetch: async (request) => {
			const { pathname } = new URL(request.url);
			load.active += 1;
			load.peak = Math.max(load.peak, load.active);
			await Bun.sleep(RENDER_MS);
			load.active -= 1;
			load.served.push(pathname);
			if (pathname === '/blog/gone')
				return new Response('missing', { status: 404 });

			return new Response(page(pathname), {
				headers: { 'content-type': 'text/html' }
			});
		}
	});
});

afterAll(async () => {
	await server?.stop(true);
	await rm(root, { force: true, recursive: true });
});

const reset = () => {
	load.active = 0;
	load.peak = 0;
	load.served = [];
};

describe('a pre-render pass given an expander', () => {
	test('renders the pages the expander returns, not the patterns', async () => {
		reset();
		const expand: ExpandStaticRoutes = async (listed) => ({
			failures: [],
			routes: listed.flatMap((path) =>
				path === '/blog/:slug' ? ['/blog/one', '/blog/two'] : [path]
			)
		});

		const result = await prerender(
			server?.port ?? 0,
			join(root, 'filled'),
			{ routes: ['/', '/blog/:slug'] },
			undefined,
			expand
		);

		expect([...result.routes.keys()].sort()).toEqual([
			'/',
			'/blog/one',
			'/blog/two'
		]);
		expect(load.served).not.toContain('/blog/:slug');
		expect(
			await readFile(
				join(root, 'filled', '_prerendered', 'blog', 'two.html'),
				'utf-8'
			)
		).toBe(page('/blog/two'));
	});

	test('reports what the expander could not fill beside what failed to render', async () => {
		reset();
		const expand: ExpandStaticRoutes = async () => ({
			failures: [
				{ reason: 'entries() could not be run', route: '/shop/:id' }
			],
			routes: ['/blog/one', '/blog/gone']
		});

		const result = await prerender(
			server?.port ?? 0,
			join(root, 'reported'),
			{ routes: ['/shop/:id', '/blog/:slug'] },
			undefined,
			expand
		);

		expect([...result.routes.keys()]).toEqual(['/blog/one']);
		expect(result.failures).toEqual([
			{ reason: 'entries() could not be run', route: '/shop/:id' },
			{
				reason: 'the route responded with HTTP 404',
				route: '/blog/gone'
			}
		]);
	});

	/* Not a clock. The server counts how many renders it is inside at
	 * once: more than one means the pass no longer queues every page
	 * behind the last, and a ceiling means a pattern standing for
	 * thousands does not open thousands of connections. */
	test('renders several pages at a time, and only several', async () => {
		reset();
		const routes = Array.from({ length: 24 }, (_, index) => `/p/${index}`);

		const result = await prerender(server?.port ?? 0, join(root, 'many'), {
			routes
		});

		expect(result.routes.size).toBe(24);
		expect(result.failures).toEqual([]);
		expect(load.peak).toBeGreaterThan(1);
		expect(load.peak).toBeLessThanOrEqual(4);
		expect(
			existsSync(join(root, 'many', '_prerendered', 'p', '23.html'))
		).toBe(true);
	});

	test('without an expander the list is rendered as written', async () => {
		reset();

		const result = await prerender(server?.port ?? 0, join(root, 'plain'), {
			routes: ['/about']
		});

		expect([...result.routes.keys()]).toEqual(['/about']);
	});
});
