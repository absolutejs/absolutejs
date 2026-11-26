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
import { getAvailablePort } from '../../helpers/ports';

/* `absolute compile` on an app with no pages: an API, plus one page a
 * route builds as a `Response`.
 *
 * Such an app has no framework directory, so its build has no entry
 * points. That build used to write no `manifest.json`, and compile —
 * which starts the bundled server to pre-render — died reading it. The
 * build-level fix has its own test
 * (tests/integration/build/empty-build-manifest.test.ts); this is the
 * same thing from the outside: the command succeeds and the executable
 * it makes answers requests.
 *
 * The CLI and the fixture's imports are this checkout's sources, not
 * the package name, which would run whatever was built into `dist/`
 * last. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const FRAMEWORK = join(repoRoot, 'src', 'index.ts').replace(/\\/g, '/');

const CONFIG = `import { defineConfig } from '${FRAMEWORK}';

export default defineConfig({ buildDirectory: './build' });
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { networking, prepare } from '${FRAMEWORK}';

const { absolutejs } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get(
		'/',
		() =>
			new Response(
				'<!doctype html><html><head><title>Pageless</title></head><body><p>PAGELESS_OK</p></body></html>',
				{ headers: { 'content-type': 'text/html; charset=utf-8' } }
			)
	)
	.get('/api/ping', () => ({ pong: true }))
	.use(networking);
`;

let root = '';
let compileOutput = '';
let compileExit = -1;
let port = 0;
let app: ReturnType<typeof Bun.spawn> | undefined;

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

const url = (path: string) => `http://localhost:${port}${path}`;

const waitForApp = async (attempt = 0): Promise<void> => {
	if (attempt >= 240) throw new Error('the compiled server did not start');
	const up = await fetch(url('/api/ping'))
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (up) return;
	await Bun.sleep(250);
	await waitForApp(attempt + 1);
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-compile-pageless-'));
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'compile-pageless-fixture', type: 'module' })
	);
	await linkNodeModules(root);

	const compile = Bun.spawn(
		[
			'bun',
			CLI_ENTRY,
			'compile',
			'server.ts',
			'--outdir',
			'out',
			'--outfile',
			'out/app'
		],
		{
			cwd: root,
			env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const [stdout, stderr, exit] = await Promise.all([
		new Response(compile.stdout).text(),
		new Response(compile.stderr).text(),
		compile.exited
	]);
	compileOutput = `${stdout}\n${stderr}`;
	compileExit = exit;
	if (exit !== 0 || !existsSync(join(root, 'out', 'app'))) return;

	port = await getAvailablePort();
	app = Bun.spawn([join(root, 'out', 'app')], {
		cwd: join(root, 'out'),
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	await waitForApp();
}, 600_000);

afterAll(async () => {
	app?.kill();
	await app?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('absolute compile on an app with no pages', () => {
	test('succeeds, and writes an empty manifest beside the executable', async () => {
		// The output is the message: on a failure it is the only thing
		// that says why.
		expect({ exit: compileExit, output: compileOutput }).toEqual({
			exit: 0,
			output: expect.not.stringContaining('ENOENT')
		});
		expect(existsSync(join(root, 'out', 'app'))).toBe(true);
		expect(
			JSON.parse(
				await readFile(join(root, 'out', 'manifest.json'), 'utf-8')
			)
		).toEqual({});
	});

	test('the executable serves its API route', async () => {
		const response = await fetch(url('/api/ping'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ pong: true });
	});

	test('the executable serves a page a route builds', async () => {
		const response = await fetch(url('/'));

		expect(response.status).toBe(200);
		expect(await response.text()).toContain('PAGELESS_OK');
	});

	test('the executable answers 404 for a path nothing serves', async () => {
		expect((await fetch(url('/nowhere'))).status).toBe(404);
	});
});
