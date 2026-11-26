import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, readdirSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* `static.directory` under `absolute start`: the pre-rendered pages a
 * server serves and re-renders live outside the build.
 *
 * Three things are shown with one build, started three times:
 *
 * 1. the server serves from, and re-renders into, the configured
 *    directory, and leaves the build's own pages as the build made them;
 * 2. a restart of the same build keeps what was revalidated — the page
 *    is the changed one although the server's own counter is back at
 *    zero;
 * 3. when that directory can no longer be written, the server still
 *    starts, still serves what is there, and says nothing will change.
 *
 * The CLI and the fixture's imports are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const FRAMEWORK = join(repoRoot, 'src', 'index.ts').replace(/\\/g, '/');
const PORT = 4614;

const configFor = (
	directory: string
) => `import { defineConfig } from '${FRAMEWORK}';

export default defineConfig({
	buildDirectory: './build',
	static: { directory: '${directory}', routes: ['/count'] }
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { networking, prepare, revalidatePath } from '${FRAMEWORK}';

const { absolutejs } = await prepare();

let count = 0;

const page = () =>
	new Response(
		\`<!doctype html><html><head><title>Count</title></head><body><p id="count">count:\${count}</p></body></html>\`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

export const server = new Elysia()
	.use(absolutejs)
	.get('/count', page)
	.get('/live', page)
	.post('/bump', async () => {
		count += 1;

		return { count, revalidated: await revalidatePath('/count') };
	})
	.use(networking);
`;

let root = '';
let pages = '';
let server: ReturnType<typeof Bun.spawn> | undefined;
let output = '';

const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(target, { recursive: true });
	const entries = await readdir(source);
	await Promise.all(
		entries
			.filter((name) => name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name)))
	);
};

const url = (path: string) => `http://localhost:${PORT}${path}`;

const waitForServer = async (attempt = 0): Promise<void> => {
	if (attempt >= 480) throw new Error(`the server did not start:\n${output}`);
	const up = await fetch(url('/live'))
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (up) return;
	await Bun.sleep(250);
	await waitForServer(attempt + 1);
};

const collect = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) output += decoder.decode(chunk);
};

const start = async (prebuilt: boolean) => {
	output = '';
	const started = Bun.spawn(
		[
			'bun',
			CLI_ENTRY,
			'start',
			'server.ts',
			...(prebuilt ? ['--prebuilt'] : [])
		],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(PORT),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	void collect(started.stdout);
	void collect(started.stderr);
	server = started;
	await waitForServer();
};

const stop = async () => {
	server?.kill();
	await server?.exited;
	server = undefined;
};

const shown = async (path: string) => {
	const html = await (await fetch(url(path))).text();

	return /count:\d+/.exec(html)?.[0] ?? html;
};

const builtPage = () =>
	readFile(join(root, 'build', '_prerendered', 'count.html'), 'utf-8');

/* The one folder in the pages directory that is a build's. */
const liveFolder = () => {
	const [folder] = readdirSync(pages).filter((name) => !name.startsWith('.'));

	return join(pages, folder ?? '');
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-static-directory-'));
	pages = join(root, 'pages');
	await writeFile(join(root, 'absolute.config.ts'), configFor(pages));
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'static-directory-fixture', type: 'module' })
	);
	await linkNodeModules(root);
	await start(false);
}, 600_000);

afterAll(async () => {
	await stop();
	if (root) await rm(root, { force: true, recursive: true });
});

describe('static.directory under absolute start', () => {
	test('the build’s pages are copied into this build’s folder there', async () => {
		expect(
			await readFile(join(liveFolder(), 'count.html'), 'utf-8')
		).toContain('count:0');
		expect(await shown('/count')).toBe('count:0');
	});

	test('a revalidation rewrites the page there and leaves the build’s alone', async () => {
		const response = await fetch(url('/bump'), { method: 'POST' });

		expect(await response.json()).toEqual({ count: 1, revalidated: true });
		expect(await shown('/count')).toBe('count:1');
		expect(
			await readFile(join(liveFolder(), 'count.html'), 'utf-8')
		).toContain('count:1');
		expect(await builtPage()).toContain('count:0');
	});

	/* The server's counter starts again at zero, so a page rendered now
	 * would say 0. It says 1: it is the page from before the restart. */
	test('a restart of the same build keeps the revalidated page', async () => {
		await stop();
		await start(true);

		expect(await shown('/live')).toBe('count:0');
		expect(await shown('/count')).toBe('count:1');
		expect(
			readdirSync(pages).filter((name) => !name.startsWith('.'))
		).toHaveLength(1);
	}, 300_000);

	const isRoot = process.getuid?.() === 0;

	/* A volume that has gone read-only. The server must still start
	 * and serve what it has — and must say that nothing will change,
	 * which it used not to: a re-render that could not write failed
	 * without a word. */
	test.skipIf(isRoot)(
		'a directory it can no longer write: it serves what is there, and says so',
		async () => {
			await stop();
			const live = liveFolder();
			chmodSync(live, 0o555);
			try {
				await start(true);

				expect(await shown('/count')).toBe('count:1');
				expect(output).toContain('cannot be updated');
				const response = await fetch(url('/bump'), { method: 'POST' });
				expect(await response.json()).toEqual({
					count: 1,
					revalidated: false
				});
				expect(await shown('/count')).toBe('count:1');
			} finally {
				chmodSync(live, 0o755);
			}
		},
		300_000
	);
});
