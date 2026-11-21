import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A React SPA whose pages are lazyRoute()s, built for production and run
 * in a browser. The app's entry must not carry the pages; while a page's
 * chunk is still on its way the layout is already interactive and the
 * server's HTML for the page stays on screen; the page hydrates when its
 * code arrives; and a page loaded once is not fetched again. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(repoRoot, '.test-builds', `react-lazy-${process.pid}`);
const CHUNK_DELAY_MS = 1_500;

const SHELL = `import { Link, UniversalRouter, lazyRoute } from '@absolutejs/absolute/react/router';
import { useState } from 'react';
import { Route, Routes } from 'react-router';

const Billing = lazyRoute(() => import('../components/Billing'), 'Billing');
const Account = lazyRoute(() => import('../components/Account'), 'Account');

const Nav = () => {
	const [clicks, setClicks] = useState(0);

	return (
		<nav>
			<button id="nav-count" onClick={() => setClicks(clicks + 1)} type="button">
				nav {clicks}
			</button>
			<Link href="/billing" id="to-billing">Billing</Link>
			<Link href="/account" id="to-account">Account</Link>
		</nav>
	);
};

export function LazyShell({ url }: { url?: string }) {
	return (
		<html lang="en">
			<head>
				<title>Lazy routes</title>
			</head>
			<body>
				<UniversalRouter url={url}>
					<Nav />
					<main>
						<Routes>
							<Route element={<Billing />} path="/billing" />
							<Route element={<Account />} path="/account" />
						</Routes>
					</main>
				</UniversalRouter>
			</body>
		</html>
	);
}
`;

const page = (name: string, marker: string) => `import { useState } from 'react';

export function ${name}() {
	const [count, setCount] = useState(0);

	return (
		<section data-page="${marker}">
			<h1>${name}</h1>
			<button id="${marker}-count" onClick={() => setCount(count + 1)} type="button">
				${marker} {count}
			</button>
		</section>
	);
}
`;

const isReactPage = (
	value: unknown
): value is Parameters<typeof handleReactPageRequest>[0]['Page'] =>
	typeof value === 'function';

let stop: (() => void) | undefined;
let origin = '';
let entryPath = '';
const servedChunks: string[] = [];

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'react', 'components'), { recursive: true });
	await writeFile(join(fixtureRoot, 'react', 'pages', 'LazyShell.tsx'), SHELL);
	await writeFile(join(fixtureRoot, 'react', 'components', 'Billing.tsx'), page('Billing', 'billing'));
	await writeFile(join(fixtureRoot, 'react', 'components', 'Account.tsx'), page('Account', 'account'));
	const rel = (path: string) => relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const manifest = result?.manifest ?? {};
	entryPath = manifest.LazyShellIndex ?? '';
	const pageModule: unknown = await import(join(fixtureRoot, 'react', 'pages', 'LazyShell.tsx'));
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'LazyShell')
			: undefined;
	if (!isReactPage(Page)) throw new Error('LazyShell did not load');
	const buildDir = join(fixtureRoot, 'build');

	const server = Bun.serve({
		fetch: async (request) => {
			const { pathname } = new URL(request.url);
			if (extname(pathname) === '')
				return handleReactPageRequest({ index: entryPath, Page, request });
			const filePath = join(buildDir, pathname);
			if (!existsSync(filePath)) return new Response(null, { status: 404 });
			const source = await readFile(filePath, 'utf-8');
			// A page's own chunk: held back, as a slow network would.
			if (source.includes('data-page')) {
				servedChunks.push(pathname);
				await Bun.sleep(CHUNK_DELAY_MS);
			}

			return new Response(source, {
				headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
			});
		},
		port: 0
	});
	origin = `http://localhost:${server.port}`;
	stop = () => server.stop(true);
}, 300_000);

afterAll(async () => {
	stop?.();
	await rm(fixtureRoot, { force: true, recursive: true });
});

describe('React lazy routes', () => {
	test('the entry carries no page; each page is a chunk of its own', async () => {
		const entry = await readFile(join(fixtureRoot, 'build', entryPath), 'utf-8');

		expect(entry).not.toContain('data-page');
	});

	test('the layout is interactive before the page\'s code arrives; the page hydrates after; a loaded page is not fetched again', async () => {
		const errors: string[] = [];
		servedChunks.length = 0;
		const session = await openPage(`${origin}/billing`, { waitUntil: 'commit' });
		try {
			const { page: tab } = session;
			tab.on('pageerror', (error) => errors.push(error.message));
			tab.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});

			// The server rendered the page in full.
			await tab.waitForSelector('section[data-page="billing"]');
			// The layout hydrates while the page's chunk is still held back.
			await tab.waitForFunction(
				() => {
					const button = document.getElementById('nav-count');
					button?.click();

					return button?.textContent?.trim() !== 'nav 0';
				},
				undefined,
				{ polling: 50, timeout: 10_000 }
			);
			const pageButton = async () =>
				(await tab.textContent('#billing-count'))?.trim();
			// Server HTML still showing, not yet hydrated: a click does nothing.
			await tab.click('#billing-count');
			expect(await pageButton()).toBe('billing 0');
			// Once its code is in, the page hydrates and responds.
			await tab.waitForFunction(
				() => {
					const button = document.getElementById('billing-count');
					button?.click();

					return button?.textContent?.trim() !== 'billing 0';
				},
				undefined,
				{ polling: 100, timeout: CHUNK_DELAY_MS + 10_000 }
			);

			// To another page, client-side, then back: Billing is not fetched again.
			await tab.click('#to-account');
			await tab.waitForSelector('section[data-page="account"]', { timeout: 10_000 });
			const fetchedBefore = servedChunks.length;
			await tab.click('#to-billing');
			await tab.waitForSelector('section[data-page="billing"]', { timeout: 2_000 });
			expect(servedChunks.length).toBe(fetchedBefore);
			expect(errors.filter((text) => /hydrat|did(n't| not) match/i.test(text))).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});
