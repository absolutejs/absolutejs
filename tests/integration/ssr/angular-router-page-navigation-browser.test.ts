import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* The Angular row of the navigation matrix for a page that installs the
 * Angular ROUTER — the case `angular-navigation-browser` next door does
 * not cover, because its page has no `routes` and therefore no router to
 * compete with the layer.
 *
 * Two boundaries meet on such a page, and each is a way for the feature
 * to be wrong:
 *
 *   - a link the Angular router owns must stay the router's. `RouterLink`
 *     calls `preventDefault`, and the layer's window listener is
 *     bubble-phase and skips a prevented click — so the router navigates
 *     its own outlet and the layer never sees a reason to swap the
 *     document. If it did swap, an in-app route change would tear down
 *     and re-bootstrap the application on every click.
 *   - a link OUT of the app must leave it. `routerLink` cannot be that
 *     link: the router's URL space is relative to `APP_BASE_HREF`, so
 *     `routerLink="/react"` on a page mounted at `/ng/*` means `/ng/react`
 *     to the router, not another framework's page. `absLink` (parity item
 *     2.8) is the API for leaving — it warms the target and never
 *     prevents the click.
 *
 * And the one that is neither: arriving at a sub-route from outside.
 * `/ng/inner` entered by a soft navigation has to render the inner route,
 * which means the router's initial navigation has to read the base href
 * the swapped-in page carries rather than whatever the previous page left
 * behind.
 *
 * Driven as a real installed app for the reason recorded in
 * `angular-navigation-browser`: calling `handleAngularPageRequest`
 * in-process fails every SSR render with NG0203 from inside Angular's own
 * root-view injector. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

/* Colocated routed children, then the page component last — the shape
 * `tests/fixtures/angular/colocated-routes-page.ts` uses and the build's
 * providers injection scans for (`export const routes` in the page file
 * becomes `provideRouter(routes, ...)` in its compiled providers). */
const ROUTED_PAGE = `import { Component } from '@angular/core';
import { RouterLink, RouterOutlet, type Routes } from '@angular/router';
import { AbsoluteLinkDirective } from '@absolutejs/absolute/angular/components';

@Component({
	selector: 'routed-home',
	standalone: true,
	template: '<p id="routed-home">HOME</p>'
})
export class RoutedHomeComponent {}

@Component({
	selector: 'routed-inner',
	standalone: true,
	template: '<p id="routed-inner">INNER</p>'
})
export class RoutedInnerComponent {}

export const routes: Routes = [
	{ component: RoutedHomeComponent, path: '' },
	{ component: RoutedInnerComponent, path: 'inner' }
];

@Component({
	imports: [AbsoluteLinkDirective, RouterLink, RouterOutlet],
	selector: 'ng-routed-page',
	standalone: true,
	template: \`
		<div id="angular-page" data-hydrated="true">
			<button id="ng-increment" (click)="count = count + 1">
				count {{ count }}
			</button>
			<a routerLink="/inner" id="to-inner">inner</a>
			<a absLink href="/react" id="to-react">react</a>
			<a routerLink="/react" id="to-react-routerlink">react, via routerLink</a>
			<main id="shell"><router-outlet /></main>
		</div>
	\`
})
export class NgRoutedPage {
	count = 0;

	ngOnInit() {
		if (typeof window === 'undefined') return;
		void import('@absolutejs/absolute/client/navigation').then(
			({ enableNavigation }) => {
				enableNavigation();
				Reflect.set(window, '__angularHydrated', true);
			}
		);
	}
}
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build',
	reactDirectory: './react'
});
`,
	'angular/pages/ng-routed-page.ts': ROUTED_PAGE,
	'package.json': `{ "name": "angular-router-page-navigation-app", "private": true, "type": "module" }
`,
	'react/pages/RoutedNavReact.tsx': `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

export function RoutedNavReact() {
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
					<a href="/ng/" id="to-angular-home">angular</a>
					<a href="/ng/inner" id="to-angular-inner">angular inner</a>
				</div>
			</body>
		</html>
	);
}
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { RoutedNavReact } from './react/pages/RoutedNavReact';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/react', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'RoutedNavReactIndex'),
			Page: RoutedNavReact,
			props: {},
			request
		})
	)
	/* A React page sitting INSIDE the Angular app's mount, before the
	 * wildcard. The router's URL space is relative to \`APP_BASE_HREF\`, so
	 * \`routerLink="/react"\` on this page means \`/ng/react\` as a document
	 * URL — this is the page that answers it. */
	.get('/ng/react', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'RoutedNavReactIndex'),
			Page: RoutedNavReact,
			props: {},
			request
		})
	)
	.get('/ng/*', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'NgRoutedPageIndex'),
			pagePath: asset(manifest, 'NgRoutedPage'),
			request
		})
	)
	.use(networking);
`
};

const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs' && name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};

/* Processes whose command line names the app folder: the server child
 * `absolute start` spawned. */
const killSurvivors = async (root: string) => {
	const pgrep = Bun.spawn(['pgrep', '-f', root], {
		stderr: 'ignore',
		stdout: 'pipe'
	});
	const output = await new Response(pgrep.stdout).text();
	output
		.split('\n')
		.map(Number)
		.filter(
			(pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid
		)
		.forEach((pid) => {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				// already gone
			}
		});
};

const startApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-ng-router-nav-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const proc = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'inherit',
			stdout: 'ignore'
		}
	);
	const baseUrl = `http://localhost:${port}`;
	const stop = async () => {
		proc.kill();
		await proc.exited;
		await killSurvivors(root);
		await rm(root, { force: true, recursive: true });
	};

	for (let attempt = 0; attempt < 360; attempt++) {
		if (proc.exitCode !== null) break;
		try {
			const response = await fetch(`${baseUrl}/ng/`);
			if (response.ok) return { baseUrl, stop };
		} catch {
			// not listening yet
		}
		await Bun.sleep(500);
	}

	await stop();
	throw new Error('absolute start did not serve /ng/');
};

type RunningApp = Awaited<ReturnType<typeof startApp>>;

let app: RunningApp | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	app = await startApp();
}, 600_000);

afterAll(async () => {
	await app?.stop();
}, 60_000);

const baseUrl = () => {
	if (!app) throw new Error('app is not running');

	return app.baseUrl;
};

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__sameDocument') === true);

const angularLive = (page: Page) =>
	page.evaluate(() => Boolean(Reflect.get(window, '__ANGULAR_APP__')));

const hydratedAngular = (page: Page) =>
	page.waitForFunction(
		() => Reflect.get(window, '__angularHydrated') === true,
		undefined,
		{ timeout: 30_000 }
	);

type Watched = { documentLoads: string[]; errors: string[] };

const watch = (page: Page) => {
	const seen: Watched = { documentLoads: [], errors: [] };
	page.on('pageerror', (error) => seen.errors.push(error.message));
	page.on('request', (request) => {
		if (request.resourceType() === 'document')
			seen.documentLoads.push(request.url());
	});

	return seen;
};

describe('a page that installs the Angular router', () => {
	test('a routerLink stays the router’s: the outlet changes, the document does not', async () => {
		const session = await openPage(`${baseUrl()}/ng/`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			const seen = watch(page);
			await hydratedAngular(page);
			await page.waitForSelector('#routed-home', { timeout: 15_000 });
			/* Marked on the live DOM, so a body swap would lose it. The
			 * layer swapping here would be a bug that still looks right:
			 * the inner route would render, from a re-bootstrapped
			 * application. */
			await page.evaluate(() => {
				Reflect.set(window, '__sameDocument', true);
				const shell = document.getElementById('shell');
				if (shell) shell.dataset.marker = 'kept';
			});

			await page.click('#to-inner');
			await page.waitForSelector('#routed-inner', { timeout: 15_000 });

			expect(pathnameOf(page)).toBe('/ng/inner');
			expect(await page.locator('#routed-home').count()).toBe(0);
			expect(await sameDocument(page)).toBe(true);
			expect(
				await page.evaluate(
					() => document.getElementById('shell')?.dataset.marker
				)
			).toBe('kept');
			// The application the router navigated in is still the one that
			// hydrated: no teardown, no re-bootstrap.
			expect(await angularLive(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);

	test('a routerLink no route matches hands the URL to the layer', async () => {
		/* Before this shipped, the click did NOTHING: the router failed to
		 * match, the address bar never changed, and the only trace was
		 * `ERROR RuntimeError: NG04002: 'react'` in the console — which in
		 * a production build does not even name the route table it failed
		 * against. A link that silently does nothing is the worst shape a
		 * defect can take, so the console is asserted too.
		 *
		 * `/ng/react` rather than `/react` is the point of the mount: the
		 * router's URL space is relative to `APP_BASE_HREF`, so
		 * `routerLink="/react"` means `/ng/react` as a document URL, and
		 * that is what gets handed off. Leaving the mount is `absLink`'s
		 * job, which the test below covers. */
		const consoleErrors: string[] = [];
		const session = await openPage(`${baseUrl()}/ng/`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			const seen = watch(page);
			page.on('console', (message) => {
				if (message.type() === 'error')
					consoleErrors.push(message.text());
			});
			await hydratedAngular(page);
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);

			await page.click('#to-react-routerlink');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 30_000
			});

			expect(pathnameOf(page)).toBe('/ng/react');
			// A swap, not a page load: the hand-off goes through the layer
			// when one is installed, and only falls back to a page load.
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(await page.locator('#angular-page').count()).toBe(0);
			expect(await angularLive(page)).toBe(false);
			// Nothing reported: the handler returns a redirect to the page
			// the document is leaving, so the router has no error to throw
			// and no rejected navigation promise to surface.
			expect(consoleErrors.join('\n')).not.toContain('NG04002');
			expect(seen.errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);

	test('absLink leaves the app: React swaps in and the application is destroyed', async () => {
		const session = await openPage(`${baseUrl()}/ng/`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			const seen = watch(page);
			await hydratedAngular(page);
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);
			// Interactive first, so what follows tears down a hydrated
			// application rather than server markup.
			await page.click('#ng-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('ng-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 15_000 }
			);

			expect(await angularLive(page)).toBe(true);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 30_000
			});

			expect(pathnameOf(page)).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#angular-page').count()).toBe(0);
			/* The router does not change the teardown contract, but it adds
			 * to what a missed teardown leaves running: the router's own
			 * `popstate` subscription, on top of the zone and the injector
			 * tree. */
			expect(await angularLive(page)).toBe(false);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);

	test('a soft navigation to a sub-route renders that route, not the index', async () => {
		/* The assertion that needs both halves: `#routed-inner` present AND
		 * `#routed-home` absent. The router's initial navigation has to
		 * read the URL and the base href of the page that was just swapped
		 * in; reading either one wrong lands on the index route, which is a
		 * page that renders fine and is the wrong one. */
		const session = await openPage(`${baseUrl()}/react`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			const seen = watch(page);
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);

			await page.click('#to-angular-inner');
			await hydratedAngular(page);
			await page.waitForSelector('#angular-page', { timeout: 30_000 });

			expect(pathnameOf(page)).toBe('/ng/inner');
			expect(await sameDocument(page)).toBe(true);
			await page.waitForSelector('#routed-inner', { timeout: 15_000 });

			expect(await page.locator('#routed-home').count()).toBe(0);
			// Hydrated here too, so the outlet above is the router's work
			// and not the server's markup left in place.
			await page.click('#ng-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('ng-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 15_000 }
			);

			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);
});
