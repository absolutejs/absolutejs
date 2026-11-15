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

/* A streamed Svelte `{#await}` (`<!-- absolute:stream -->`) sends its
 * branches as HTML strings. Up to beta.181 those elements never got the
 * component's scoped-CSS class, and Svelte pruned every selector that only
 * matched them as unused, so the page's own `<style>` styled nothing in the
 * pending, then or catch branch. Each branch here is styled by a rule that
 * matches nothing else in the page; the colours must apply in production
 * and in dev. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const COLORS: Record<'done' | 'failed' | 'intro' | 'pending', string> = {
	done: 'rgb(200, 0, 0)',
	failed: 'rgb(0, 120, 0)',
	intro: 'rgb(90, 90, 90)',
	pending: 'rgb(0, 0, 210)'
};

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	svelteDirectory: 'src/frontend/svelte'
});
`,
	'package.json': `{ "name": "svelte-await-scoped-css-app", "private": true, "type": "module" }
`,
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () =>
		handleSveltePageRequest({
			collectStreamingSlots: true,
			indexPath: asset(manifest, 'AwaitScopedIndex'),
			pagePath: asset(manifest, 'AwaitScoped')
		})
	)
	.use(networking);
`,
	'src/frontend/svelte/pages/AwaitScoped.svelte': `<script lang="ts">
	const later = (ms: number) =>
		new Promise((done) => setTimeout(done, ms));
	const load = async () => {
		await later(3500);

		return 'ready';
	};
	const fail = async (): Promise<string> => {
		await later(3500);
		throw new Error('nope');
	};
</script>

<main>
	<p class="intro">intro</p>
	<!-- absolute:stream -->
	{#await load()}
		<p class="pending">loading</p>
	{:then value}
		<section><p class="done" data-state={value}>{value}</p></section>
	{/await}

	<!-- absolute:stream -->
	{#await fail()}
		<span>waiting</span>
	{:then value}
		<p>{value}</p>
	{:catch error}
		<p class="failed">{error.message}</p>
	{/await}
</main>

<style>
	.intro {
		color: ${COLORS.intro};
	}
	p.pending {
		color: ${COLORS.pending};
	}
	section > p.done[data-state='ready'] {
		color: ${COLORS.done};
	}
	.failed {
		color: ${COLORS.failed};
	}
</style>
`
};

/* The repo's node_modules may hold an older published
 * @absolutejs/absolute; link every package from it except that one, which
 * points at this checkout (its dist/). */
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

type RunningApp = {
	baseUrl: string;
	root: string;
	server: ReturnType<typeof Bun.spawn>;
};

const waitForApp = async (
	baseUrl: string,
	server: ReturnType<typeof Bun.spawn>,
	attempt = 0
): Promise<void> => {
	if (server.exitCode !== null) {
		throw new Error(`the app exited with ${server.exitCode}`);
	}
	if (attempt >= 480) throw new Error('the app did not start');
	const ready = await fetch(baseUrl)
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (ready) return;
	await Bun.sleep(250);
	await waitForApp(baseUrl, server, attempt + 1);
};

const startApp = async (args: string[], nodeEnv: string) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-await-scoped-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const baseUrl = `http://localhost:${port}`;
	const server = Bun.spawn(['bun', CLI_ENTRY, ...args], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: nodeEnv,
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'ignore'
	});
	const app: RunningApp = { baseUrl, root, server };
	await waitForApp(baseUrl, server);

	return app;
};

const stopApp = async (app: RunningApp | undefined) => {
	if (!app) return;
	app.server.kill();
	await app.server.exited;
	await rm(app.root, { force: true, recursive: true });
};

/** The computed colour of `selector`, once it is `expected` or the wait
 *  runs out (then whatever it is, so a failure shows the actual colour). */
const colorOf = async (page: Page, selector: string, expected: string) => {
	await page.waitForSelector(selector, { timeout: 15_000 });
	await page
		.waitForFunction(
			([target, color]) => {
				const element = document.querySelector(target ?? '');

				return (
					element !== null &&
					getComputedStyle(element).color === color
				);
			},
			[selector, expected],
			{ timeout: 2_000 }
		)
		.catch(() => undefined);

	return page.evaluate((target) => {
		const element = document.querySelector(target);

		return element ? getComputedStyle(element).color : null;
	}, selector);
};

const expectStyledBranches = async (baseUrl: string) => {
	// 'commit', not 'load': the page loads only once the slots resolve,
	// and the pending branch is gone by then.
	const session = await openPage(baseUrl, { waitUntil: 'commit' });
	const { page } = session;
	try {
		const pending = await colorOf(page, 'p.pending', COLORS.pending);
		const intro = await colorOf(page, 'p.intro', COLORS.intro);
		const done = await colorOf(page, 'p.done', COLORS.done);
		const failed = await colorOf(page, 'p.failed', COLORS.failed);
		const scoped = await page.evaluate(() =>
			Array.from(document.querySelectorAll('p.done, p.failed')).map(
				(element) =>
					Array.from(element.classList).some((name) =>
						name.startsWith('svelte-')
					)
			)
		);

		expect({ done, failed, intro, pending, scoped }).toEqual({
			...COLORS,
			scoped: [true, true]
		});
	} finally {
		await session.close();
	}
};

describe('streamed Svelte {#await} scoped CSS in production', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			['start', 'src/backend/server.ts', '--outdir', 'start-build'],
			'production'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('the page style applies in the pending, then and catch branches', async () => {
		if (!app) throw new Error('app did not start');
		await expectStyledBranches(app.baseUrl);
	}, 120_000);
});

describe('streamed Svelte {#await} scoped CSS in dev', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(['dev'], 'development');
	}, 600_000);

	afterAll(() => stopApp(app));

	test('the page style applies in the pending, then and catch branches', async () => {
		if (!app) throw new Error('app did not start');
		await expectStyledBranches(app.baseUrl);
	}, 120_000);
});
