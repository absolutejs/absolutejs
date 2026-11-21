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
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Event replay: a click made BEFORE an Angular page finishes hydrating has
 * to arrive once it has.
 *
 * `provideClientHydration()` with no features gives DOM hydration and the
 * transfer cache and nothing else, so every tap in the window between the
 * server's HTML and the client's bootstrap was dropped — silently, and
 * worst on the slow devices where that window is widest. Angular's own SSR
 * scaffold enables `withEventReplay()`, so the default here was behind the
 * framework's own.
 *
 * The window is made wide on purpose here: the Angular vendor chunk is
 * held for a second by a route handler, the button is clicked while the
 * page is still server markup, and the assertion is that the count reaches
 * 1 after hydration. Without replay the click lands on markup with no
 * listener and nothing ever happens — which is also why the test asserts
 * the page was NOT hydrated at click time, since a click after hydration
 * would pass without any of this. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build'
});
`,
	'angular/pages/ng-replay-page.ts': `import { Component } from '@angular/core';

@Component({
	selector: 'ng-replay-page',
	standalone: true,
	template: \`
		<div id="angular-page">
			<button id="counter" (click)="count = count + 1">count {{ count }}</button>
		</div>
	\`
})
export class NgReplayPage {
	count = 0;

	ngOnInit() {
		if (typeof window === 'undefined') return;
		Reflect.set(window, '__angularHydrated', true);
	}
}
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/angular', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'NgReplayPageIndex'),
			pagePath: asset(manifest, 'NgReplayPage'),
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
	const root = await mkdtemp(join(tmpdir(), 'absolute-angular-replay-'));
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

const HOLD_VENDOR_MS = 1_000;

describe('a click before an Angular page hydrates', () => {
	test('is replayed once hydration finishes', async () => {
		const session = await openPage(`${baseUrl()}/angular`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			/* Hold the Angular runtime so the page stays server markup long
			 * enough to click it. Set after the first load, then the page is
			 * reloaded so the route applies. */
			await page.route('**/angular/vendor/**', async (route) => {
				await Bun.sleep(HOLD_VENDOR_MS);
				await route.continue();
			});
			await page.evaluate(() =>
				Reflect.deleteProperty(window, '__angularHydrated')
			);
			await page.goto(`${baseUrl()}/angular`, {
				waitUntil: 'domcontentloaded'
			});
			await page.waitForSelector('#counter', { timeout: 20_000 });

			/* The click has to land on markup that is not yet live, or the
			 * test proves nothing: a click after hydration works with or
			 * without replay. */
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__angularHydrated')
				)
			).toBeUndefined();

			await page.click('#counter');

			// Still not hydrated, so nothing has handled it yet.
			expect(
				await page.evaluate(() =>
					document.getElementById('counter')?.textContent?.trim()
				)
			).toBe('count 0');

			await page.waitForFunction(
				() => Reflect.get(window, '__angularHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			// And the click arrives: the count catches up by itself.
			await page.waitForFunction(
				() =>
					document.getElementById('counter')?.textContent?.trim() ===
					'count 1',
				undefined,
				{ timeout: 15_000 }
			);
		} finally {
			await session.close();
		}
	}, 300_000);

	test('the page is still interactive the normal way', async () => {
		/* The control: replay must not break an ordinary click made after
		 * hydration, which is the case every other Angular test covers
		 * implicitly and none asserts next to this one. */
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
			await page.click('#counter');
			await page.waitForFunction(
				() =>
					document.getElementById('counter')?.textContent?.trim() ===
					'count 1',
				undefined,
				{ timeout: 15_000 }
			);
		} finally {
			await session.close();
		}
	}, 300_000);
});
