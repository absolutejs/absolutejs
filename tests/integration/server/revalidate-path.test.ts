import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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

/* `revalidatePath` and `revalidateAll` under `absolute start`: a page
 * pre-rendered at build time is served from its file until the app says
 * it is stale, and from the new file the moment that call resolves.
 *
 * The fixture's pages show a number the server holds. Two routes change
 * it — one says nothing, one revalidates — and that difference is the
 * whole test: the quiet change must NOT show (the page really is served
 * from the file), and the announced one must.
 *
 * No `static.revalidate` interval is set, so nothing but these calls
 * can have replaced a file.
 *
 * The fixture has no framework directory and no page file: every page
 * is a `Response` a route builds. That such an app starts at all is
 * asserted by this test running — a build with no entry points used to
 * write no manifest, and the production server died reading it.
 *
 * The CLI and the fixture's imports are this checkout's sources, not
 * the package name, which would run whatever was built into `dist/`
 * last. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const FRAMEWORK = join(repoRoot, 'src', 'index.ts').replace(/\\/g, '/');
const PORT = 4612;

const CONFIG = `import { defineConfig } from '${FRAMEWORK}';

export default defineConfig({
	buildDirectory: './build',
	static: { routes: ['/count', '/docs/count'] }
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import {
	networking,
	prepare,
	revalidateAll,
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
	.get('/docs/count', page)
	// Not in \`static.routes\`: rendered per request, never from a file.
	.get('/live', page)
	.post('/bump-quietly', () => {
		count += 1;

		return { count };
	})
	.post('/bump', async () => {
		count += 1;

		return { count, revalidated: await revalidatePath('/count') };
	})
	.post('/bump-all', async () => {
		count += 1;

		return { count, ...(await revalidateAll()) };
	})
	.post('/revalidate-unknown', async () => ({
		live: await revalidatePath('/live'),
		missing: await revalidatePath('/nowhere')
	}))
	.use(networking);
`;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

/* Every package from the repo's node_modules, so the fixture resolves
 * `elysia` and the rest exactly as the framework's own sources do. */
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
	if (attempt >= 480) throw new Error('production server did not start');
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

const shown = async (path: string) => {
	const html = await (await fetch(url(path))).text();

	return /count:\d+/.exec(html)?.[0] ?? html;
};

const post = async (path: string) => {
	const response = await fetch(url(path), { method: 'POST' });
	const body: unknown = await response.json();

	return body;
};

const prerendered = (name: string) => join(root, 'build', '_prerendered', name);

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-revalidate-path-'));
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'revalidate-path-fixture', type: 'module' })
	);
	await linkNodeModules(root);

	server = Bun.spawn(['bun', CLI_ENTRY, 'start', 'server.ts'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(PORT),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('revalidatePath under absolute start', () => {
	/* The tests run in order and share the server's counter: each
	 * builds on the number the one before it left. */
	test('a pre-rendered page is served from its file, whatever changed since', async () => {
		expect(existsSync(prerendered('count.html'))).toBe(true);
		expect(await shown('/count')).toBe('count:0');

		expect(await post('/bump-quietly')).toEqual({ count: 1 });

		// Changed on the server, and the page does not know.
		expect(await shown('/live')).toBe('count:1');
		expect(await shown('/count')).toBe('count:0');
	});

	test('the page is the new one as soon as revalidatePath resolves', async () => {
		expect(await post('/bump')).toEqual({ count: 2, revalidated: true });

		// No waiting: the call resolved after the file was replaced.
		expect(await shown('/count')).toBe('count:2');
		expect(await readFile(prerendered('count.html'), 'utf-8')).toContain(
			'count:2'
		);
	});

	test('it replaces only the page it names', async () => {
		expect(await shown('/docs/count')).toBe('count:0');
	});

	test('revalidateAll replaces every pre-rendered page', async () => {
		const result = await post('/bump-all');

		expect(result).toEqual({
			count: 3,
			failed: [],
			revalidated: expect.arrayContaining(['/count', '/docs/count'])
		});
		expect(await shown('/count')).toBe('count:3');
		expect(await shown('/docs/count')).toBe('count:3');
	});

	test('a path that is not pre-rendered is false, not an error', async () => {
		expect(await post('/revalidate-unknown')).toEqual({
			live: false,
			missing: false
		});
	});

	test('nothing is left staged beside the pages', async () => {
		const files = await readdir(join(root, 'build', '_prerendered'), {
			recursive: true
		});

		expect(files.filter((name) => name.includes('staging'))).toEqual([]);
		expect(
			await readdir(join(root, 'build', '.prerender-staging'))
		).toEqual([]);
	});
});
