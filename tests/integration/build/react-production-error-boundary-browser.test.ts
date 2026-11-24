import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* What a React render error does to a PRODUCTION page.
 *
 * The generated hydration index wraps the page in an error boundary only
 * in development, where the boundary renders `null` and shows the dev
 * overlay. A production build has no boundary, so an error thrown during
 * render propagates to the root and React unmounts it: the page the
 * visitor was reading is replaced by nothing at all, with the error only
 * in the console.
 *
 * The error here is a RENDER error rather than one thrown in an event
 * handler, because a boundary catches the former and not the latter —
 * testing the wrong one would say nothing about either. The button sets
 * state; the child throws while rendering that state. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`react-error-boundary-${process.pid}`
);

const PAGE = `import { useEffect, useState } from 'react';

const Boom = ({ explode }: { explode: boolean }) => {
	if (explode) throw new Error('render exploded');

	return <p id="fine">fine</p>;
};

export function ErrorPage() {
	const [explode, setExplode] = useState(false);

	useEffect(() => {
		Reflect.set(window, '__hydrated', true);
	}, []);

	return (
		<html lang="en">
			<head>
				<title>Error page</title>
			</head>
			<body>
				<div id="shell">
					<h1 id="heading">still here</h1>
					<button id="explode" onClick={() => setExplode(true)}>
						explode
					</button>
					<Boom explode={explode} />
				</div>
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

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await writeFile(join(fixtureRoot, 'react', 'pages', 'ErrorPage.tsx'), PAGE);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'ErrorPage.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'ErrorPage')
			: undefined;
	const buildDir = join(fixtureRoot, 'build');
	const server = Bun.serve({
		port: 0,
		fetch: async (request: Request) => {
			const { pathname } = new URL(request.url);
			if (pathname === '/' && isReactPage(Page))
				return handleReactPageRequest({
					index: manifest.ErrorPageIndex ?? '',
					Page,
					props: {},
					request
				});
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

const consoleErrors: string[] = [];

const open = async (run: (page: Page) => Promise<void>) => {
	consoleErrors.length = 0;
	const session: BrowserSession = await openPage(baseUrl(), {
		waitUntil: 'load',
		consoleLog: (message: string) => consoleErrors.push(message)
	});
	try {
		await run(session.page);
	} finally {
		await session.close();
	}
};

describe('a render error on a production React page', () => {
	test('does not leave the visitor with an empty document', async () => {
		await open(async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);

			expect(await page.locator('#fine').count()).toBe(1);

			await page.click('#explode');
			// The throw happens while rendering the new state, so let React
			// finish unwinding before looking.
			await page.waitForTimeout(1000);

			/* Whatever the page shows after the error, it must not be an
			 * empty body: the visitor was reading something. */
			/* The page is replaced by the boundary's fallback, which is
			 * React's semantics for a root boundary and what Next.js's
			 * `error.tsx` does too. So the assertion is that something a
			 * visitor can act on is there — not that the old page survived.
			 *
			 * `document.body.textContent` is NOT the check: the SSR
			 * baseline `<script>` lives in the body, so its source counts
			 * as body text and a blank page reads as non-empty. The first
			 * version of this test asserted exactly that and passed while
			 * the heading and every other element were gone. */
			await page.waitForSelector('[data-absolute-error="react"]', {
				timeout: 10_000
			});

			expect(
				await page.locator('[data-absolute-error] h1').textContent()
			).toContain('Something went wrong');
			expect(
				await page.locator('[data-absolute-error] button').count()
			).toBe(1);
			// And the error was reported rather than swallowed.
			expect(consoleErrors.join(' ')).toContain('render error');
		});
	}, 300_000);
});
