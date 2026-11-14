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

/* An Angular page with two `@defer` blocks streams both resolved sections on
 * the server and keeps them after hydration, under `absolute dev` and
 * `absolute start`, in an app that uses the published package
 * (`@absolutejs/absolute` linked to this checkout's dist/).
 *
 * beta.172 streamed correctly, then the browser threw
 * `ReferenceError: process is not defined` from the defer slot's ngOnInit:
 * in the browser it still tried to register a server streaming slot, and
 * the missing-collector warning read NODE_ENV through `process.env`. The
 * exception aborted the first change detection, so both deferred sections
 * vanished, and dev added an NG0100 for the half-rendered second slot. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build'
});
`,
	'angular/pages/defer-page.ts': `import { Component } from '@angular/core';

@Component({
	selector: 'defer-page',
	standalone: true,
	template: \`
		<main>
			<h1 id="title">Defer page</h1>
			@defer (on timer(10ms)) {
				<section id="fast">fast resolved</section>
			} @placeholder {
				<p id="fast-loading">fast loading</p>
			}

			@defer (on timer(150ms)) {
				<section id="slow">slow resolved</section>
			} @placeholder {
				<p id="slow-loading">slow loading</p>
			}
		</main>
	\`
})
export class DeferPageComponent {}
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/defer', ({ request }) =>
		handleAngularPageRequest({
			collectStreamingSlots: true,
			indexPath: asset(manifest, 'DeferPageIndex'),
			pagePath: asset(manifest, 'DeferPage'),
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

const createApp = async (name: string) => {
	const root = await mkdtemp(
		join(tmpdir(), `absolute-angular-defer-${name}-`)
	);
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);

	return root;
};

/* Processes whose command line names the app folder: the server child that
 * `absolute dev` / `absolute start` spawned. */
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

const startApp = async (mode: 'dev' | 'start') => {
	const root = await createApp(mode);
	const port = await getAvailablePort();
	const args =
		mode === 'dev'
			? ['bun', CLI_ENTRY, 'dev', 'server.ts']
			: [
					'bun',
					CLI_ENTRY,
					'start',
					'server.ts',
					'--outdir',
					'start-build'
				];
	const proc = Bun.spawn(args, {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: mode === 'dev' ? 'development' : 'production',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'ignore'
	});
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
			// Dev builds Angular pages on first request, so wait for the
			// page itself rather than the server socket.
			const response = await fetch(`${baseUrl}/defer`);
			if (response.ok) return { baseUrl, stop };
		} catch {
			// not listening yet
		}
		await Bun.sleep(500);
	}

	await stop();
	throw new Error(`absolute ${mode} did not serve /defer`);
};

type RunningApp = Awaited<ReturnType<typeof startApp>>;

const expectStreamedInOrder = async (baseUrl: string) => {
	const response = await fetch(`${baseUrl}/defer`);
	const html = await response.text();
	const placeholder = html.indexOf('fast loading');
	const fast = html.indexOf('fast resolved');
	const slow = html.indexOf('slow resolved');

	expect(response.status).toBe(200);
	expect(placeholder).toBeGreaterThan(-1);
	expect(fast).toBeGreaterThan(placeholder);
	expect(slow).toBeGreaterThan(fast);
};

const expectHydratedDeferBlocks = async (baseUrl: string) => {
	const messages: string[] = [];
	const errors: string[] = [];
	const session = await openPage(`${baseUrl}/defer`, {
		consoleLog: (message) => messages.push(message)
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => errors.push(error.message));
		// On timeout, fall through so the assertions below report the
		// actual DOM state and console errors.
		await page
			.waitForFunction(
				() =>
					document.getElementById('fast')?.textContent ===
						'fast resolved' &&
					document.getElementById('slow')?.textContent ===
						'slow resolved',
				undefined,
				{ timeout: 20_000 }
			)
			.catch(() => undefined);
		// Interact, and give a late change-detection pass or slot flush the
		// chance to undo the resolved sections.
		await page.click('#title');
		await Bun.sleep(500);

		const state = await page.evaluate(() => ({
			fast: document.getElementById('fast')?.textContent ?? null,
			fastLoading: document.getElementById('fast-loading') !== null,
			slow: document.getElementById('slow')?.textContent ?? null,
			slowLoading: document.getElementById('slow-loading') !== null
		}));

		expect(
			messages.filter((text) =>
				/ERROR|NG0\d+|process is not defined/.test(text)
			)
		).toEqual([]);
		expect(errors).toEqual([]);
		expect(state).toEqual({
			fast: 'fast resolved',
			fastLoading: false,
			slow: 'slow resolved',
			slowLoading: false
		});
	} finally {
		await session.close();
	}
};

beforeAll(async () => {
	await ensureDistBuild();
}, 600_000);

describe.each(['dev', 'start'] as const)(
	'Angular @defer under absolute %s',
	(mode) => {
		let app: RunningApp | undefined;

		beforeAll(async () => {
			app = await startApp(mode);
		}, 240_000);

		afterAll(async () => {
			await app?.stop();
		}, 30_000);

		test('streams the placeholder, then the fast block, then the slow block', async () => {
			if (!app) throw new Error(`absolute ${mode} did not start`);
			await expectStreamedInOrder(app.baseUrl);
		}, 60_000);

		test('keeps both resolved sections after hydration, with no console errors', async () => {
			if (!app) throw new Error(`absolute ${mode} did not start`);
			await expectHydratedDeferBlocks(app.baseUrl);
		}, 90_000);
	}
);
