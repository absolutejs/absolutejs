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
const TOKEN = 'static-directory-test-token';

const configFor = (
	directory: string
) => `import { defineConfig } from '${FRAMEWORK}';

export default defineConfig({
	buildDirectory: './build',
	static: {
		directory: '${directory}',
		revalidateToken: '${TOKEN}',
		routes: ['/count', '/personal']
	}
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import {
	cookies,
	headers,
	networking,
	prepare,
	revalidatePath
} from '${FRAMEWORK}';

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
	// Pre-rendered, and it should not be: it is different for each
	// visitor, and the pre-renderer is not one of them.
	.get(
		'/personal',
		() =>
			new Response(
				\`<!doctype html><html><head><title>P</title></head><body><p>hello \${cookies().get('user') ?? 'stranger'} at \${headers().get('host')}</p></body></html>\`,
				{ headers: { 'content-type': 'text/html; charset=utf-8' } }
			)
	)
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

const start = async (prebuilt: boolean, extra: Record<string, string> = {}) => {
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
				TELEMETRY_OFF: '1',
				...extra
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

const callEndpoint = (token: string) =>
	fetch(url('/__absolute/revalidate'), {
		body: JSON.stringify({ paths: ['/count'] }),
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json'
		},
		method: 'POST'
	});

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

describe('a pre-rendered page that reads the request', () => {
	/* `/personal` greets whoever the cookie names. Pre-rendered, it
	 * greets nobody, for everybody, and nothing else would say so. */
	test('is named in the build’s output, with what it read', async () => {
		expect(output).toContain(
			'/personal read the request while it was pre-rendered'
		);
		expect(output).toContain("cookies().get('user')");
		expect(output).toContain("headers().get('host')");
		// A page that reads nothing is not mentioned.
		expect(output).not.toContain('/count read the request');
	});

	test('and is served as the pre-renderer saw it, whoever asks', async () => {
		const response = await fetch(url('/personal'), {
			headers: { cookie: 'user=ada' }
		});

		expect(await response.text()).toContain('hello stranger');
	});
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

	/* `absolute start` built this app and launched its server in one
	 * step, so the config's token reached the server — through the
	 * server's environment, not through anything on disk. */
	test('the token is not written into the build', async () => {
		const files = readdirSync(join(root, 'build'), { recursive: true })
			.map(String)
			.filter((name) => /\.(json|js|mjs)$/.test(name));
		const holding = await Promise.all(
			files.map(async (name) =>
				(await readFile(join(root, 'build', name), 'utf-8')).includes(
					TOKEN
				)
					? name
					: undefined
			)
		);

		expect(files).toContain('absolute-runtime.json');
		expect(holding.filter((name) => name !== undefined)).toEqual([]);
	});

	/* The last test restarted from the build alone (`--prebuilt`), which
	 * reads what the build wrote. The token is not there, so the
	 * endpoint is not either — and the server says what is missing. */
	test('a server started from the build without the token has no endpoint, and says why', async () => {
		expect((await callEndpoint(TOKEN)).status).toBe(404);
		expect(output).toContain('ABSOLUTE_REVALIDATE_TOKEN');
	});

	/* What a deployment does: the path and the secret come from the
	 * machine the server runs on, not from the one that built it. */
	test('the environment supplies the token and the directory at start', async () => {
		await stop();
		const elsewhere = join(root, 'pages-on-this-machine');
		await start(true, {
			ABSOLUTE_REVALIDATE_TOKEN: 'a-token-from-the-environment',
			ABSOLUTE_STATIC_DIRECTORY: elsewhere
		});

		// A different directory: seeded from the build, so the page
		// is the build's and not the one revalidated in the other.
		expect(await shown('/count')).toBe('count:0');
		expect(readdirSync(elsewhere).length).toBeGreaterThan(0);
		// The environment's token is the one that works; the config's,
		// which this server never saw, does not.
		expect(
			(await callEndpoint('a-token-from-the-environment')).status
		).toBe(200);
		expect((await callEndpoint(TOKEN)).status).toBe(401);
		expect(output).not.toContain('Set ABSOLUTE_REVALIDATE_TOKEN');

		await stop();
		await start(true);
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
