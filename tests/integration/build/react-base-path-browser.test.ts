import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A React page served under a base path, behind a proxy that strips it:
 * the browser only reaches the app through `/base`, so the page hydrates
 * only if its entry, its vendor imports and the import map that moves
 * them all go under the prefix. The page renders its own inline <head>
 * script, which React used to pair with the framework's import map while
 * hydrating (a mismatch on every load). */

const BASE = '/base';
const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(repoRoot, '.test-builds', `base-path-${process.pid}`);

const PAGE = `import { useEffect, useState } from 'react';

export function BasePathPage() {
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	return (
		<html lang="en">
			<head>
				<title>Base path page</title>
				<script dangerouslySetInnerHTML={{ __html: 'window.__headScript = true;' }} />
			</head>
			<body>
				<main id="page" data-hydrated={hydrated ? 'true' : 'false'}>hello</main>
			</body>
		</html>
	);
}
`;

const isReactPage = (
	value: unknown
): value is Parameters<typeof handleReactPageRequest>[0]['Page'] =>
	typeof value === 'function';

let stop: (() => void) | undefined;
let origin = '';
const previousBase = process.env.ABSOLUTE_BASE_PATH;

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await writeFile(join(fixtureRoot, 'react', 'pages', 'BasePathPage.tsx'), PAGE);
	const rel = (path: string) => relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'BasePathPage.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'BasePathPage')
			: undefined;
	if (!isReactPage(Page)) throw new Error('BasePathPage did not load');
	const buildDir = join(fixtureRoot, 'build');
	process.env.ABSOLUTE_BASE_PATH = BASE;

	// The app, at its own root.
	const app = (request: Request) => {
		const { pathname } = new URL(request.url);
		if (extname(pathname) === '')
			return handleReactPageRequest({
				index: manifest.BasePathPageIndex ?? '',
				Page,
				request
			});
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
		});
	};
	// The proxy: only `/base/...` reaches the app, without the prefix.
	const server = Bun.serve({
		fetch: (request) => {
			const url = new URL(request.url);
			if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`))
				return new Response('outside the base', { status: 404 });
			url.pathname = url.pathname.slice(BASE.length) || '/';

			return app(new Request(url, request));
		},
		port: 0
	});
	origin = `http://localhost:${server.port}`;
	stop = () => server.stop(true);
}, 300_000);

afterAll(async () => {
	stop?.();
	if (previousBase === undefined) delete process.env.ABSOLUTE_BASE_PATH;
	else process.env.ABSOLUTE_BASE_PATH = previousBase;
	await rm(fixtureRoot, { force: true, recursive: true });
});

describe('a React page under a base path', () => {
	test('hydrates through the prefix, with no mismatch and nothing left over', async () => {
		const errors: string[] = [];
		const outside: string[] = [];
		const session = await openPage(`${origin}${BASE}/`, {
			consoleLog: (message) => errors.push(message),
			waitUntil: 'commit'
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			page.on('response', (response) => {
				if (response.status() === 404) outside.push(response.url());
			});
			await page.waitForSelector('#page[data-hydrated="true"]', {
				timeout: 20_000
			});
			const head = await page.evaluate(() => ({
				base: Reflect.get(window, '__ABSOLUTE_BASE_PATH__'),
				headScript: Reflect.get(window, '__headScript'),
				scripts: [...document.head.querySelectorAll('script')].map(
					(script) => script.type || 'classic'
				)
			}));

			expect(head.base).toBe(BASE);
			expect(head.headScript).toBe(true);
			// The import map and the base script removed themselves.
			expect(head.scripts).toEqual(['classic']);
			expect(outside).toEqual([]);
			expect(errors.filter((text) => /hydrat|did(n't| not) match/i.test(text))).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});
