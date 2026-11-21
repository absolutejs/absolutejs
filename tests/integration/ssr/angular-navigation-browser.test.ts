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

/* The Angular row of the cross-framework navigation matrix (navigation
 * plan phase 3): a soft navigation into an Angular page and back out of
 * it, with the Angular application torn down on the way.
 *
 * Driven as a real installed app — fixture files in a temp directory with
 * this checkout's `node_modules` symlinked in and `@absolutejs/absolute`
 * pointing at the repo, started through `dist/cli/index.js`. That is not
 * ceremony: an earlier attempt called `handleAngularPageRequest` directly
 * from the test process the way the `tests/integration/build` fixtures do,
 * and every SSR render failed with NG0203 (`inject()` outside an injection
 * context) from inside Angular's own root-view injector, before reaching
 * any navigation code. Importing `src/angular/injectorPatch`, including as
 * the first import in the file, did not help. Going through the package
 * entry in a real app does — the same harness the `@defer` hydration test
 * uses next door.
 *
 * Two links are covered: a plain anchor, and one carrying `absLink` — the
 * prefetching link directive (parity item 2.8). `routerLink` hand-off
 * from a page that installs the Angular router is still open. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build',
	reactDirectory: './react'
});
`,
	'angular/pages/ng-nav-page.ts': `import { Component } from '@angular/core';
import { AbsoluteLinkDirective } from '@absolutejs/absolute/angular/components';

@Component({
	imports: [AbsoluteLinkDirective],
	selector: 'ng-nav-page',
	standalone: true,
	template: \`
		<div id="angular-page" data-hydrated="true">
			<button id="ng-increment" (click)="count = count + 1">
				count {{ count }}
			</button>
			<a href="/react" id="to-react">react</a>
			<a absLink prefetch="hover" href="/react" id="to-react-prefetched">
				react, warmed
			</a>
		</div>
	\`
})
export class NgNavPage {
	count = 0;

	ngOnInit() {
		if (typeof window === 'undefined') return;
		// The layer is installed by whichever page calls this first; the
		// call is idempotent. Imported lazily because an Angular page is
		// server-rendered too.
		void import('@absolutejs/absolute/client/navigation').then(
			({ enableNavigation }) => {
				enableNavigation();
				Reflect.set(window, '__angularHydrated', true);
			}
		);
	}
}
`,
	'react/pages/NgNavReact.tsx': `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

export function NgNavReact() {
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
					<a href="/angular" id="to-angular">angular</a>
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
import { NgNavReact } from './react/pages/NgNavReact';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/react', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'NgNavReactIndex'),
			Page: NgNavReact,
			props: {},
			request
		})
	)
	.get('/angular', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'NgNavPageIndex'),
			pagePath: asset(manifest, 'NgNavPage'),
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
	const root = await mkdtemp(join(tmpdir(), 'absolute-angular-nav-'));
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
			const response = await fetch(`${baseUrl}/angular`);
			if (response.ok) return { baseUrl, stop };
		} catch {
			// not listening yet
		}
		await Bun.sleep(500);
	}

	await stop();
	throw new Error('absolute start did not serve /angular');
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

describe('React to Angular and back, in place', () => {
	test('the page swaps both ways and the Angular application is destroyed', async () => {
		const documentLoads: string[] = [];
		const errors: string[] = [];
		const session = await openPage(`${baseUrl()}/react`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('request', (request) => {
				if (request.resourceType() === 'document')
					documentLoads.push(request.url());
			});
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);

			await page.click('#to-angular');
			await page.waitForFunction(
				() => Reflect.get(window, '__angularHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);

			expect(pathnameOf(page)).toBe('/angular');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#react-page').count()).toBe(0);
			/* Truthy here so the falsy assertion after leaving means
			 * something: without this, "destroyed" would also pass if the
			 * global were never set at all. */
			expect(
				await page.evaluate(() =>
					Boolean(Reflect.get(window, '__ANGULAR_APP__'))
				)
			).toBe(true);

			// Interactive, so this is a hydrated application and not the
			// server's markup pasted into the document.
			await page.click('#ng-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('ng-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 15_000 }
			);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 30_000
			});

			expect(pathnameOf(page)).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			/* The teardown that matters for Angular: `compileAngular`
			 * registers an async dispose hook that awaits the page-ready
			 * promise and then destroys the application. If the layer did
			 * not await it, a zone, a change-detection loop and the whole
			 * injector tree would keep running against a body that is
			 * gone. */
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__ANGULAR_APP__')
				)
			).toBeFalsy();
			expect(documentLoads).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);

	test('absLink warms the target on hover, so the click is served from cache', async () => {
		/* The prefetching link for Angular. The directive reaches the
		 * prefetch runtime through the import-free indirection in
		 * utils/prefetchRef.ts — it cannot import src/client/prefetch,
		 * because an Angular component is partial-compiled in a workspace
		 * holding only its own directory.
		 *
		 * The assertion is request COUNT: hovering warms `/react`, and the
		 * navigation then consumes that response instead of fetching the
		 * document again. One request for two reasons to want it. */
		const reactRequests: string[] = [];
		const session = await openPage(`${baseUrl()}/angular`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__angularHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			// Counted after hydration so the page's own asset requests are
			// not in the tally.
			page.on('request', (request) => {
				if (new URL(request.url()).pathname === '/react')
					reactRequests.push(request.resourceType());
			});

			await page.hover('#to-react-prefetched');
			// The directive debounces hover by 250ms, and `kind: 'route'`
			// asks for two things — the document and the route-data payload
			// naming the modules and CSS to warm with it — so the count is
			// not asserted as a literal, only that warming happened.
			await page.waitForFunction(
				() => {
					const store = Reflect.get(
						globalThis,
						Symbol.for('absolutejs.prefetch')
					);

					return store instanceof Set
						? false
						: Boolean(store) &&
								Reflect.get(store ?? {}, 'cache') !== undefined;
				},
				undefined,
				{ timeout: 10_000 }
			);
			await page.waitForTimeout(1500);
			const warmedWith = reactRequests.length;

			expect(warmedWith).toBeGreaterThan(0);

			await page.click('#to-react-prefetched');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 30_000
			});

			expect(new URL(page.url()).pathname).toBe('/react');
			/* Unchanged across the click: the navigation consumed the
			 * warmed response instead of fetching the document again. That
			 * is the whole claim — counting requests before and after,
			 * rather than asserting a literal, which also survives the
			 * `route` kind issuing two. */
			expect(reactRequests.length).toBe(warmedWith);
			// And no document load: it was a swap, not a page load.
			expect(reactRequests).not.toContain('document');
		} finally {
			await session.close();
		}
	}, 300_000);
});
