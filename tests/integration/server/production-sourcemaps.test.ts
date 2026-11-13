import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	cp,
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
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `absolute start` bundled the server without a source map, so production
 * stack traces pointed into dist/server.js, and the Svelte/Vue/Angular SSR
 * bundles were built with no map either. The build directory is also the
 * static root, which meant `GET /server.js` downloaded the whole backend;
 * server-only files are now kept off the static routes before any map is
 * written next to them. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4471;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;
let log = '';
const responses: Record<string, { body: string; status: number }> = {};
let serverOutputs: string[] = [];
let serverOutputStatuses: number[] = [];

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte/server';

const { absolutejs, manifest } = await prepare();

const failRoute = () => {
	throw new Error('ROUTE_HANDLER_FAILURE');
};

export const server = new Elysia()
	.use(absolutejs)
	// Registered before the routes: Elysia applies a local onError hook to
	// the routes that follow it.
	.onError(({ error }) => {
		console.error('ROUTE_STACK', error instanceof Error ? error.stack : error);
	})
	.get('/', () =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'HomeIndex'),
			pagePath: asset(manifest, 'Home')
		})
	)
	.get('/boom', () =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'BoomIndex'),
			pagePath: asset(manifest, 'Boom')
		})
	)
	.get('/route-boom', failRoute)
	.use(networking);
`;

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

const waitForServer = async () => {
	for (let attempt = 0; attempt < 240; attempt++) {
		try {
			await fetch(`http://localhost:${PORT}/`);

			return;
		} catch {
			await Bun.sleep(250);
		}
	}
	throw new Error('production server did not start');
};

const get = async (path: string, headers: Record<string, string> = {}) => {
	const response = await fetch(`http://localhost:${PORT}${path}`, {
		headers
	});

	return { body: await response.text(), status: response.status };
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-prod-sourcemaps-'));
	await cp(join(repoRoot, 'tests', 'fixtures', 'compile-svelte'), root, {
		recursive: true,
		filter: (source) => !/[\\/]node_modules([\\/]|$)/.test(source)
	});
	await linkNodeModules(root);
	await writeFile(join(root, 'server.ts'), SERVER_TS);

	const proc = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
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
	server = proc;
	await waitForServer();
	responses.routeBoom = await get('/route-boom');
	responses.pageBoom = await get('/boom');
	responses.bundle = await get('/server.js');
	responses.bundleBrotli = await get('/server.js', {
		'accept-encoding': 'br'
	});
	responses.bundleCompressed = await get('/server.js.gz');
	responses.map = await get('/server.js.map');
	responses.runtime = await get('/absolute-runtime.json');
	// Every file the server pass wrote, wherever this project's layout put
	// it (a single-framework build writes Svelte pages to svelte/pages/).
	const serverOutputsList: unknown = JSON.parse(
		await readFile(join(root, 'start-build', 'server-outputs.json'), 'utf8')
	);
	serverOutputs = Array.isArray(serverOutputsList)
		? serverOutputsList.filter(
				(entry): entry is string => typeof entry === 'string'
			)
		: [];
	serverOutputStatuses = await Promise.all(
		serverOutputs.map(async (path) => (await get(`/${path}`)).status)
	);
	responses.home = await get('/');
	// Let the server flush its error logs before stopping it.
	await Bun.sleep(1_000);
	proc.kill();
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	server = undefined;
	// Strip ANSI colors from Bun's formatted stack traces.
	log = Bun.stripANSI(`${stdout}\n${stderr}`);
}, 600_000);

afterAll(async () => {
	server?.kill();
	if (root) await rm(root, { force: true, recursive: true });
});

describe('production server source maps', () => {
	test('a route handler error points at server.ts', () => {
		expect(responses.routeBoom?.status).toBe(500);
		expect(log).toContain('ROUTE_HANDLER_FAILURE');
		expect(log).toMatch(/failRoute \([^)]*\/server\.ts:8:\d+\)/);
		expect(log).not.toMatch(/failRoute \([^)]*server\.js:/);
	});

	test('a page component error points at its .svelte source', () => {
		expect(log).toContain('SVELTE_BOOM_FAILURE');
		expect(log).toMatch(/\(([^)]*)\/svelte\/pages\/Boom\.svelte:2:\d+\)/);
		// The original file, not a path next to the build output.
		expect(log).not.toContain('start-build/svelte/pages/Boom.svelte');
	});

	test('start prints no source map decode warning', () => {
		expect(log).not.toContain('Could not decode sourcemap');
	});
});

describe('server-only build files are not served', () => {
	test('the server bundle, its compressed copies and its map are 404', () => {
		expect(responses.bundle?.status).toBe(404);
		expect(responses.bundleBrotli?.status).toBe(404);
		expect(responses.bundleCompressed?.status).toBe(404);
		expect(responses.map?.status).toBe(404);
	});

	test('runtime manifests and SSR bundles are 404, pages still render', () => {
		expect(responses.runtime?.status).toBe(404);
		expect(
			serverOutputs.some((path) => /Boom\.[a-z0-9]+\.js$/.test(path))
		).toBe(true);
		expect(serverOutputStatuses.length).toBe(serverOutputs.length);
		expect(serverOutputStatuses.every((status) => status === 404)).toBe(
			true
		);
		expect(responses.home?.status).toBe(200);
	});
});
