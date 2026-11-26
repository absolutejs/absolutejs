import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* A page store under `absolute start`: three servers running one build,
 * each with its own page directory and its own in-memory data, sharing
 * nothing but a store the app registered.
 *
 * Every page says which machine rendered it. So when machine B shows a
 * page "by A", it did not render it — its own data would have said
 * something else — it was handed the page A rendered. That is the
 * difference between this and each machine quietly re-rendering.
 *
 * The store is written in the fixture's own `server.ts`, on top of a
 * directory: the four functions an app would write for whatever it has.
 *
 * The CLI and the fixture's imports are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const FRAMEWORK = join(repoRoot, 'src', 'index.ts').replace(/\\/g, '/');
type MachineName = 'a' | 'b' | 'c';

const PORTS: Record<MachineName, number> = { a: 4616, b: 4617, c: 4618 };
const INTERVAL_MS = 150;

/* Set, this whole file runs against a real Redis chosen in the config
 * (`static.store: { type: 'redis' }`) in place of the store the fixture
 * registers in code. Same servers, same assertions: what changes is
 * which store carries the pages, and which way it was configured. */
const redisUrl = process.env.PAGE_STORE_TEST_REDIS_URL;
const REDIS_STORE = `store: { interval: ${INTERVAL_MS}, prefix: 'e2e-${crypto.randomUUID()}:', type: 'redis' },`;

const CONFIG = `import { defineConfig } from '${FRAMEWORK}';

export default defineConfig({
	buildDirectory: './build',
	static: {
		${redisUrl ? REDIS_STORE : ''}
		routes: ['/count', '/post/:slug']
	}
});
`;

const SERVER_TS = `import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Elysia } from 'elysia';
import {
	networking,
	prepare,
	registerPageStore,
	revalidatePath
} from '${FRAMEWORK}';

const machine = process.env.MACHINE ?? '?';
const storeRoot = process.env.STORE_DIRECTORY ?? '';

const keysIn = (directory: string, prefix = ''): string[] => {
	try {
		return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory()
				? keysIn(join(directory, entry.name), \`\${prefix}\${entry.name}/\`)
				: [\`\${prefix}\${entry.name}\`]
		);
	} catch {
		return [];
	}
};

// A store over a directory: get, put, delete, list.
if (storeRoot !== '')
	registerPageStore(
		{
			delete: async (key) => rmSync(join(storeRoot, key), { force: true }),
			get: async (key) => {
				try {
					return readFileSync(join(storeRoot, key), 'utf-8');
				} catch {
					return undefined;
				}
			},
			list: async (prefix) =>
				keysIn(storeRoot)
					.filter((key) => key.startsWith(prefix) && !key.endsWith('.writing'))
					.map((key) => {
						const stat = statSync(join(storeRoot, key));

						return { key, version: \`\${stat.mtimeMs}-\${stat.size}\` };
					}),
			put: async (key, body) => {
				const target = join(storeRoot, key);
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(\`\${target}.writing\`, body);
				renameSync(\`\${target}.writing\`, target);
			}
		},
		{ interval: ${INTERVAL_MS} }
	);

const { absolutejs } = await prepare();

let count = 0;
const posts = new Map<string, string>();

const html = (body: string) =>
	new Response(
		\`<!doctype html><html><head><title>t</title></head><body><p>\${body}</p></body></html>\`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

export const server = new Elysia()
	.use(absolutejs)
	.get('/count', () => html(\`count:\${count} by \${machine}\`))
	.get('/live', () => html(\`count:\${count} by \${machine}\`))
	.get('/post/:slug', ({ params, status }) => {
		const body = posts.get(params.slug);

		return body === undefined
			? status(404, 'no such post')
			: html(\`post:\${body} by \${machine}\`);
	})
	.post('/bump', async () => {
		count += 1;

		return { revalidated: await revalidatePath('/count') };
	})
	.post('/posts/:slug/:body', async ({ params }) => {
		posts.set(params.slug, params.body);

		return { revalidated: await revalidatePath(\`/post/\${params.slug}\`) };
	})
	.delete('/posts/:slug', async ({ params }) => {
		posts.delete(params.slug);

		return { revalidated: await revalidatePath(\`/post/\${params.slug}\`) };
	})
	.use(networking);
`;

let root = '';
const running = new Map<MachineName, ReturnType<typeof Bun.spawn>>();

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

const url = (machine: MachineName, path: string) =>
	`http://localhost:${PORTS[machine]}${path}`;

const waitForServer = async (
	machine: MachineName,
	attempt = 0
): Promise<void> => {
	if (attempt >= 480) throw new Error(`machine ${machine} did not start`);
	const up = await fetch(url(machine, '/live'))
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (up) return;
	await Bun.sleep(250);
	await waitForServer(machine, attempt + 1);
};

const start = async (machine: MachineName, prebuilt: boolean) => {
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
				ABSOLUTE_STATIC_DIRECTORY: join(root, `pages-${machine}`),
				FORCE_COLOR: '0',
				MACHINE: machine.toUpperCase(),
				NODE_ENV: 'production',
				PORT: String(PORTS[machine]),
				// One or the other: the config's Redis, or the
				// directory store the fixture registers itself.
				...(redisUrl
					? { REDIS_URL: redisUrl }
					: { STORE_DIRECTORY: join(root, 'store') }),
				TELEMETRY_OFF: '1'
			},
			stderr: 'inherit',
			stdout: 'inherit'
		}
	);
	running.set(machine, started);
	await waitForServer(machine);
};

type Shown = { status: number; text: string };

const shown = async (machine: MachineName, path: string) => {
	const response = await fetch(url(machine, path));
	const html = await response.text();
	const seen: Shown = {
		status: response.status,
		text: /<p>([^<]*)<\/p>/.exec(html)?.[1] ?? ''
	};

	return seen;
};

/* The other machines are behind by at most the interval, so what they
 * show is waited for, with a generous ceiling for a loaded CI machine. */
const eventually = async (
	read: () => Promise<Shown>,
	wanted: (seen: Shown) => boolean,
	attempt = 0
): Promise<Shown> => {
	const seen = await read();
	if (wanted(seen) || attempt >= 80) return seen;
	await Bun.sleep(INTERVAL_MS);

	return eventually(read, wanted, attempt + 1);
};

const send = (machine: MachineName, method: string, path: string) =>
	fetch(url(machine, path), { method }).then((response) => response.json());

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-page-store-'));
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'page-store-fixture', type: 'module' })
	);
	await linkNodeModules(root);
	// A builds; B starts from that build, as a second machine would.
	await start('a', false);
	await start('b', true);
}, 600_000);

afterAll(async () => {
	await Promise.all(
		[...running.values()].map(async (server) => {
			server.kill();
			await server.exited;
		})
	);
	if (root) await rm(root, { force: true, recursive: true });
});

describe(`machines sharing a page store${redisUrl ? ' (a real Redis, from static.store)' : ''}`, () => {
	test('each starts with the build’s pages in a directory of its own', async () => {
		expect(existsSync(join(root, 'pages-a'))).toBe(true);
		expect(existsSync(join(root, 'pages-b'))).toBe(true);
		// Rendered by the build, which machine A ran — so B, which
		// only started from that build, shows A's name too.
		expect((await shown('a', '/count')).text).toBe('count:0 by A');
		expect((await shown('b', '/count')).text).toBe('count:0 by A');
	});

	/* B's own counter is still 0. Had B rendered the page it would say
	 * "count:0 by B"; it says what A rendered. */
	test('a page one machine revalidates reaches the other, as that machine rendered it', async () => {
		expect(await send('a', 'POST', '/bump')).toEqual({ revalidated: true });
		expect((await shown('a', '/count')).text).toBe('count:1 by A');

		const onB = await eventually(
			() => shown('b', '/count'),
			(seen) => seen.text === 'count:1 by A'
		);

		expect(onB.text).toBe('count:1 by A');
		expect((await shown('b', '/live')).text).toBe('count:0 by B');
	});

	test('and it works in the other direction', async () => {
		await send('b', 'POST', '/bump');

		const onA = await eventually(
			() => shown('a', '/count'),
			(seen) => seen.text === 'count:1 by B'
		);

		expect(onA.text).toBe('count:1 by B');
	});

	/* B has never heard of this post: asked to render it, B answers 404. */
	test('a page one machine creates is served by the other', async () => {
		expect((await shown('b', '/post/hello')).status).toBe(404);
		await send('a', 'POST', '/posts/hello/first');

		const onB = await eventually(
			() => shown('b', '/post/hello'),
			(seen) => seen.status === 200
		);

		expect(onB).toEqual({ status: 200, text: 'post:first by A' });
	});

	test('a page one machine takes down comes down on the other', async () => {
		await send('a', 'DELETE', '/posts/hello');

		const onB = await eventually(
			() => shown('b', '/post/hello'),
			(seen) => seen.status === 404
		);

		expect(onB.status).toBe(404);
	});

	/* A machine added later starts from the build. Without the store it
	 * would serve the build's "count:0 by A" until something
	 * revalidated it. */
	test('a machine that starts late has every change from its first request', async () => {
		await send('a', 'POST', '/posts/later/kept');
		await eventually(
			() => shown('b', '/post/later'),
			(seen) => seen.status === 200
		);

		await start('c', true);

		expect((await shown('c', '/count')).text).toBe('count:1 by B');
		expect(await shown('c', '/post/later')).toEqual({
			status: 200,
			text: 'post:kept by A'
		});
		expect((await shown('c', '/post/hello')).status).toBe(404);
	}, 300_000);

	test.skipIf(Boolean(redisUrl))(
		'the store holds this build’s pages and nothing is left half-written',
		async () => {
			const builds = readdirSync(join(root, 'store'));
			const files = readdirSync(join(root, 'store'), {
				recursive: true
			}).map(String);

			expect(builds).toHaveLength(1);
			expect(files.filter((name) => name.endsWith('.writing'))).toEqual(
				[]
			);
			expect(
				files.some((name) => name.endsWith('pages/count.html'))
			).toBe(true);
		}
	);
});
