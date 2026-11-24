import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* What a hydration mismatch does to a PRODUCTION React page.
 *
 * The generated index's mismatch recovery — unmount the root and
 * re-render client-only through `createRoot` — runs only in development
 * (`generateReactIndexes.ts`, guarded on `isDev`), which reads as a page
 * left unrecovered in the environment where a mismatch is most likely to
 * reach a user. It is not: React 19 answers a mismatch by discarding the
 * server tree and rendering the root again on the client, which is that
 * same recovery. Development's version adds the error overlay and the
 * HMR beacon, which are development's business.
 *
 * So this file measures production rather than changing it, and is the
 * evidence for leaving it alone. Three pages: no mismatch, a text
 * mismatch, and an element-tag mismatch — the last two because they are
 * not obviously the same case and React treats them the same anyway.
 * Each is checked for what a visitor gets (the text they read, whether
 * the page is interactive, whether anything was reported) and for which
 * of the server's own DOM nodes survived, since "React recovered" and
 * "the page works" are different claims.
 *
 * The no-mismatch page is load-bearing, not a courtesy: every assertion
 * here reads a missing mark as "React re-created this node", and a
 * marking script that never ran would read identically. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`react-hydration-mismatch-${process.pid}`
);

/* Two pages, because React answers the two kinds of mismatch
 * differently and a page carrying both can only show the louder one.
 * `kind` picks which mismatch the page commits. */
const pageSource = (
	name: string,
	kind: 'none' | 'tag' | 'text'
) => `import { useEffect, useState } from 'react';

const onServer = () => typeof window === 'undefined';

export function ${name}() {
	const [count, setCount] = useState(0);

	useEffect(() => {
		Reflect.set(window, '__hydrated', true);
	}, []);

	// Text: the same expression, a different answer on each side.
	const label = ${kind === 'text' ? "onServer() ? 'SERVER_TEXT' : 'CLIENT_TEXT'" : "'SAME_TEXT'"};
	// Tag: a different ELEMENT, which React cannot patch in place.
	const Tag = ${kind === 'tag' ? "onServer() ? 'section' : 'article'" : "'section'"};

	return (
		<html lang="en">
			<head>
				<title>Mismatch page</title>
			</head>
			<body>
				<div id="shell">
					<h1 id="heading">still here</h1>
					<p id="text-mismatch">{label}</p>
					<Tag id="tag-mismatch">tag content</Tag>
					<button id="bump" onClick={() => setCount(count + 1)}>
						count {count}
					</button>
				</div>
				{/* Runs while the document parses, before hydration, and
				 * marks every element the SERVER sent. Whatever still
				 * carries the mark afterwards is the server's own node,
				 * kept rather than re-created. */}
				<script
					dangerouslySetInnerHTML={{
						__html: "for (const el of document.querySelectorAll('#shell [id]')) el.setAttribute('data-from-server', '1');"
					}}
				/>
			</body>
		</html>
	);
}
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

	return 'application/octet-stream';
};

const PAGES = {
	NoMismatch: 'none',
	TagMismatch: 'tag',
	TextMismatch: 'text'
} as const;

const serverHtml: Record<string, string> = {};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	for (const [name, kind] of Object.entries(PAGES)) {
		await writeFile(
			join(fixtureRoot, 'react', 'pages', `${name}.tsx`),
			pageSource(name, kind)
		);
	}
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const manifest = result?.manifest ?? {};
	const components: Record<string, unknown> = {};
	for (const name of Object.keys(PAGES)) {
		const pageModule: unknown = await import(
			join(fixtureRoot, 'react', 'pages', `${name}.tsx`)
		);
		components[name] =
			typeof pageModule === 'object' && pageModule !== null
				? Reflect.get(pageModule, name)
				: undefined;
	}
	const buildDir = join(fixtureRoot, 'build');
	const server = Bun.serve({
		port: 0,
		fetch: async (request: Request) => {
			const { pathname } = new URL(request.url);
			const name = pathname.slice(1);
			const Page = components[name];
			if (Page !== undefined && isReactPage(Page)) {
				const response = await handleReactPageRequest({
					index: manifest[`${name}Index`] ?? '',
					Page,
					props: {},
					request
				});
				const [forTest, forClient] = response.body?.tee() ?? [];
				if (forTest)
					serverHtml[name] = await new Response(forTest).text();

				return new Response(forClient, {
					headers: response.headers,
					status: response.status
				});
			}
			if (extname(pathname) === '')
				return new Response('not found', { status: 404 });
			const filePath = join(buildDir, pathname);
			if (!existsSync(filePath))
				return new Response(null, { status: 404 });

			return new Response(Bun.file(filePath), {
				headers: { 'Content-Type': contentType(filePath) }
			});
		}
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

const consoleMessages: string[] = [];

const open = async (name: string, run: (page: Page) => Promise<void>) => {
	consoleMessages.length = 0;
	const session: BrowserSession = await openPage(`${baseUrl()}/${name}`, {
		waitUntil: 'load',
		consoleLog: (message: string) => consoleMessages.push(message)
	});
	try {
		await run(session.page);
	} finally {
		await session.close();
	}
};

/** Which of the server's own elements are still in the document. The
 *  inline script marked them while the document parsed; anything React
 *  re-created lost the mark. */
const survivingServerNodes = (page: Page) =>
	page.evaluate(() =>
		Object.fromEntries(
			['heading', 'text-mismatch', 'tag-mismatch', 'bump'].map((id) => [
				id,
				document.getElementById(id)?.hasAttribute('data-from-server') ??
					null
			])
		)
	);

const staysInteractive = async (page: Page) => {
	await page.click('#bump');
	await page.waitForFunction(
		() =>
			document.querySelector('#bump')?.textContent?.trim() === 'count 1',
		undefined,
		{ timeout: 10_000 }
	);
};

/* The control, and it is not optional: every assertion below reads the
 * absence of a mark as "React re-created this node", and a marking
 * script that never ran would read exactly the same. This page agrees
 * with itself on both sides, so its marks MUST survive. */
describe('a production React page with no mismatch', () => {
	test('hydrates onto the server markup, marks intact', async () => {
		await open('NoMismatch', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			await staysInteractive(page);

			expect(await survivingServerNodes(page)).toEqual({
				bump: true,
				heading: true,
				'tag-mismatch': true,
				'text-mismatch': true
			});
			expect(consoleMessages.join(' ')).not.toContain(
				'React recoverable error'
			);
		});
	}, 300_000);
});

describe('a text mismatch on a production React page', () => {
	test('re-renders the root on the client, and the page works', async () => {
		await open('TextMismatch', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			// The server really did send the other text, or this measures an
			// ordinary page and every assertion below is vacuous.
			expect(serverHtml.TextMismatch).toContain('SERVER_TEXT');

			expect(await page.locator('#text-mismatch').textContent()).toBe(
				'CLIENT_TEXT'
			);
			expect(await page.locator('#heading').textContent()).toBe(
				'still here'
			);
			await staysInteractive(page);

			/* No server node survives — not even `#heading`, which both
			 * sides agreed about. A mismatch of one text node costs the
			 * whole server tree: React discards it and renders the root
			 * again on the client, which is the same recovery development's
			 * `handleHydrationFallback` performs by hand (unmount,
			 * `createRoot`, render). Production is therefore not missing
			 * that recovery; it is already doing it, and the measurement
			 * that says so is this one, against the control above. */
			expect(await survivingServerNodes(page)).toEqual({
				bump: false,
				heading: false,
				'tag-mismatch': false,
				'text-mismatch': false
			});

			/* Reported rather than swallowed. In production React minifies
			 * its own message to an error code with a link that decodes it,
			 * which is React's doing, not something the generated index can
			 * improve on. */
			expect(consoleMessages.join(' ')).toContain(
				'React recoverable error'
			);
			expect(consoleMessages.join(' ')).toContain('react.dev/errors/418');
		});
	}, 300_000);
});

describe('an element mismatch on a production React page', () => {
	test('re-renders the root on the client, and the page works', async () => {
		await open('TagMismatch', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			expect(serverHtml.TagMismatch).toContain(
				'<section id="tag-mismatch"'
			);

			expect(await page.locator('article#tag-mismatch').count()).toBe(1);
			expect(await page.locator('section#tag-mismatch').count()).toBe(0);
			expect(await page.locator('#heading').textContent()).toBe(
				'still here'
			);
			await staysInteractive(page);
			// Not a blank page, which is the failure this guards against.
			expect(await page.locator('#shell').count()).toBe(1);

			/* The same outcome as the text mismatch: the server tree goes
			 * and the root is rendered again on the client. Both kinds are
			 * checked because they are not obviously the same case — a
			 * changed tag cannot be patched, a changed text node plainly
			 * can — and React answers both the same way regardless. */
			expect(await survivingServerNodes(page)).toEqual({
				bump: false,
				heading: false,
				'tag-mismatch': false,
				'text-mismatch': false
			});
			expect(consoleMessages.join(' ')).toContain(
				'React recoverable error'
			);
		});
	}, 300_000);
});
