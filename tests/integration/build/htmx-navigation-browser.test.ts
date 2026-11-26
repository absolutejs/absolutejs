import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { unservedPath } from '../../helpers/unservedPath';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleHTMXPageRequest } from '../../../src/core/pageHandlers';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* The HTMX row of the cross-framework navigation matrix (navigation plan
 * phase 3, and the last row phase 2's exit criteria needed).
 *
 * The question this row actually asks is not whether the swap happens —
 * an HTMX page is a static page, and those were covered in
 * static-page-navigation-browser.test.ts — but whether HTMX still WORKS
 * on a page the layer swapped in. htmx binds its `hx-*` attributes by
 * processing the document; the dev HMR handler calls
 * `window.htmx.process(container)` after it replaces markup
 * (src/dev/client/handlers/htmx.ts), and the navigation layer does not
 * call it anywhere. So either the re-inserted htmx script re-initialises
 * itself, or every `hx-*` attribute on a swapped-in page is dead. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`htmx-navigation-${process.pid}`
);

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

export function HtmxNavReact() {
	useEffect(() => {
		enableNavigation();
	}, []);

	return (
		<html lang="en">
			<head>
				<title>React page</title>
			</head>
			<body>
				<div id="react-page" data-hydrated="true">
					<a href="/htmx" id="to-htmx">htmx</a>
				</div>
			</body>
		</html>
	);
}
`;

/* A button whose only behaviour comes from htmx: if htmx has not bound
 * the page, clicking it does nothing at all. */
const HTMX_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<title>HTMX page</title>
		<script src="/htmx/htmx.min.js"></script>
	</head>
	<body>
		<div id="htmx-page">
			<button id="hx-button" hx-get="/fragment" hx-target="#hx-out" hx-swap="innerHTML">
				load
			</button>
			<output id="hx-out">empty</output>
			<a href="/react" id="to-react">react</a>
		</div>
	</body>
</html>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const isReactPage = (
	value: unknown
): value is Parameters<typeof handleReactPageRequest>[0]['Page'] =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';
	if (path.endsWith('.html')) return 'text/html; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	Page: Parameters<typeof handleReactPageRequest>[0]['Page']
) => {
	const renderPage = async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/react') {
			return handleReactPageRequest({
				index: manifest.HtmxNavReactIndex ?? '',
				Page,
				props: {},
				request
			});
		}
		if (pathname === '/htmx') {
			return handleHTMXPageRequest(manifest.HtmxNavPage ?? '');
		}
		// What the hx-get asks for.
		if (pathname === '/fragment') {
			return new Response('<span id="hx-loaded">loaded</span>', {
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		}

		return unservedPath(pathname);
	};

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (extname(pathname) === '') return renderPage(request);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};
};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'htmx', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'HtmxNavReact.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'htmx', 'pages', 'HtmxNavPage.html'),
		HTMX_PAGE
	);
	/* An app ships its own htmx vendor copy: `copyHtmxVendor` globs
	 * `htmx*.min.js` out of the configured htmx directory into
	 * `build/htmx/htmx.min.js`. Without one the page's script 404s and
	 * `window.htmx` never exists — which the control test catches as a
	 * fixture problem rather than a navigation one. */
	await copyFile(
		join(repoRoot, 'src', 'cli', 'htmx', 'htmx.min.js'),
		join(fixtureRoot, 'htmx', 'htmx.2.0.11.min.js')
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		htmxDirectory: rel('htmx'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'HtmxNavReact.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'HtmxNavReact')
			: undefined;
	if (!isReactPage(Page)) throw new Error('HtmxNavReact page did not load');
	const server = Bun.serve({
		fetch: createApp(join(fixtureRoot, 'build'), manifest, Page),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 300_000);

afterAll(async () => {
	app?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

type Observations = { documentLoads: string[]; errors: string[] };

const withPage = async (
	path: string,
	run: (page: Page, seen: Observations) => Promise<void>
) => {
	const seen: Observations = { documentLoads: [], errors: [] };
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => seen.errors.push(error.message));
		page.on('request', (request) => {
			if (request.resourceType() === 'document')
				seen.documentLoads.push(request.url());
		});
		await page.evaluate(() => Reflect.set(window, '__sameDocument', true));
		await run(page, seen);
	} finally {
		await session.close();
	}
};

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__sameDocument') === true);

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

describe('an HTMX page entered directly', () => {
	test('htmx binds its attributes, so the button works', async () => {
		// The control. If this fails the fixture is wrong, not the layer.
		await withPage('/htmx', async (page) => {
			await page.waitForFunction(
				() => Boolean(Reflect.get(window, 'htmx')),
				undefined,
				{ timeout: 15_000 }
			);
			await page.click('#hx-button');
			await page.waitForSelector('#hx-loaded', { timeout: 15_000 });

			expect(await page.locator('#hx-out').textContent()).toContain(
				'loaded'
			);
		});
	}, 120_000);
});

describe('an HTMX page swapped in by a soft navigation', () => {
	test('swaps in place, and htmx still binds the swapped-in markup', async () => {
		await withPage('/react', async (page, seen) => {
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});

			await page.click('#to-htmx');
			await page.waitForSelector('#htmx-page', { timeout: 20_000 });

			expect(pathnameOf(page)).toBe('/htmx');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);

			/* The row's real question: `hx-get` only does anything if htmx
			 * has processed this body. The navigation layer never calls
			 * `htmx.process`, unlike the dev HMR handler. */
			await page.click('#hx-button');
			await page.waitForSelector('#hx-loaded', { timeout: 15_000 });

			expect(await page.locator('#hx-out').textContent()).toContain(
				'loaded'
			);
			expect(await sameDocument(page)).toBe(true);
			expect(seen.errors).toEqual([]);
		});
	}, 120_000);

	test('and can be navigated away from', async () => {
		await withPage('/react', async (page, seen) => {
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});
			await page.click('#to-htmx');
			await page.waitForSelector('#htmx-page', { timeout: 20_000 });
			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(pathnameOf(page)).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
		});
	}, 120_000);
});
