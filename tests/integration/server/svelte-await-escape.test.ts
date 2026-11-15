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

/* A streamed Svelte `{#await}` (`<!-- absolute:stream -->`) resolves on the
 * server and streams its branch as HTML. Up to beta.181 the branch's
 * `{expressions}` went into that HTML unescaped, so a resolved value such
 * as `<img src=x onerror=…>` ran in the visitor's browser. Without
 * secureHeaders() nothing blocks the handler, so this app runs without it:
 * the payload must arrive as text in both the then and the catch branch,
 * in production and in dev. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PAYLOAD = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	svelteDirectory: 'src/frontend/svelte'
});
`,
	'package.json': `{ "name": "svelte-await-escape-app", "private": true, "type": "module" }
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
			indexPath: asset(manifest, 'AwaitEscapeIndex'),
			pagePath: asset(manifest, 'AwaitEscape')
		})
	)
	.use(networking);
`,
	'src/frontend/svelte/pages/AwaitEscape.svelte': `<script lang="ts">
	const payload = ${JSON.stringify(PAYLOAD)};
	const later = (ms: number) =>
		new Promise((done) => setTimeout(done, ms));
	const load = async () => {
		await later(20);

		return payload;
	};
	const fail = async (): Promise<string> => {
		await later(40);
		throw new Error(payload);
	};
</script>

<main>
	<h1>AWAIT_ESCAPE</h1>
	<!-- absolute:stream -->
	{#await load()}
		<p class="pending">loading</p>
	{:then value}
		<p class="done">{value}</p>
		<a class="link" href={value} title="see {value}">link</a>
	{/await}

	<!-- absolute:stream -->
	{#await fail()}
		<p class="pending">loading</p>
	{:then value}
		<p class="never">{value}</p>
	{:catch error}
		<p class="failed">{error.message}</p>
	{/await}
</main>
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
	const root = await mkdtemp(join(tmpdir(), 'absolute-await-escape-'));
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

const expectPayloadAsText = async (baseUrl: string) => {
	const session = await openPage(baseUrl);
	const { page } = session;
	try {
		await page.waitForSelector('p.done', { timeout: 15_000 });
		await page.waitForSelector('p.failed', { timeout: 15_000 });
		// Give an injected <img src=x> time to fail and fire onerror.
		await page.waitForTimeout(500);
		const result = await page.evaluate(() => ({
			done: document.querySelector('p.done')?.textContent,
			failed: document.querySelector('p.failed')?.textContent,
			href: document.querySelector('a.link')?.getAttribute('href'),
			images: document.querySelectorAll('main img').length,
			title: document.querySelector('a.link')?.getAttribute('title'),
			xss: (window as unknown as { __xss?: number }).__xss
		}));

		expect(result).toEqual({
			done: PAYLOAD,
			failed: PAYLOAD,
			href: PAYLOAD,
			images: 0,
			title: `see ${PAYLOAD}`,
			xss: undefined
		});
	} finally {
		await session.close();
	}
};

describe('streamed Svelte {#await} escaping in production', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			['start', 'src/backend/server.ts', '--outdir', 'start-build'],
			'production'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('a resolved or rejected value streams as text, not markup', async () => {
		if (!app) throw new Error('app did not start');
		await expectPayloadAsText(app.baseUrl);
	}, 120_000);
});

describe('streamed Svelte {#await} escaping in dev', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(['dev'], 'development');
	}, 600_000);

	afterAll(() => stopApp(app));

	test('a resolved or rejected value streams as text, not markup', async () => {
		if (!app) throw new Error('app did not start');
		await expectPayloadAsText(app.baseUrl);
	}, 120_000);
});
