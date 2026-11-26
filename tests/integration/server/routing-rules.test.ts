import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';

/* `redirects`, `rewrites` and `headers` from the config, on a running
 * server, in both modes.
 *
 * Production matters most and is the one a unit test cannot see: a
 * production server reads a trimmed copy of the config, listing the keys
 * it needs, and `basePath`, `logging` and `shutdown` were each left off
 * that list once — working under `absolute dev` and doing nothing where
 * it counts. And only a real server shows a rewrite going back through
 * `fetch`, and a header rule reaching a file the static plugin serves. */

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const CLI = resolve(PROJECT_ROOT, 'src/cli/index.ts');
const SRC = resolve(PROJECT_ROOT, 'src').replace(/\\/g, '/');
const STARTUP_TIMEOUT_MS = 120_000;
const POLL_MS = 150;
const HOOK_TIMEOUT_MS = 180_000;

const RULES = `	redirects: [
		{ from: '/old-home', to: '/' },
		{ from: '/blog/:slug', status: 301, to: 'https://blog.example.com/:slug' }
	],
	rewrites: [{ from: '/i/:id', to: '/api/items/:id' }],
	headers: [
		{ path: '/*', headers: { 'x-frame-options': 'DENY' } },
		{ path: '/assets/*', headers: { 'cache-control': 'public, max-age=600' } }
	]`;

const writeApp = async (directory: string, rules: string) => {
	const root = directory.replace(/\\/g, '/');
	await mkdir(join(directory, 'html', 'pages'), { recursive: true });
	await mkdir(join(directory, 'assets'), { recursive: true });
	await writeFile(
		join(directory, 'html', 'pages', 'Home.html'),
		'<!doctype html><html><head><title>Home</title></head><body><h1>RULES_HOME</h1></body></html>\n'
	);
	await writeFile(join(directory, 'assets', 'note.txt'), 'a static note\n');
	await writeFile(
		join(directory, 'absolute.config.ts'),
		`import { defineConfig } from '${SRC}/utils/defineConfig';

export default defineConfig({
	assetsDirectory: '${root}/assets',
	buildDirectory: '${root}/build',
	htmlDirectory: '${root}/html',
${rules}
});
`
	);
	await writeFile(
		join(directory, 'server.ts'),
		`import { Elysia } from 'elysia';
import { asset, prepare } from '${SRC}/index';
import { handleHTMLPageRequest } from '${SRC}/core/pageHandlers';
import { networking } from '${SRC}/plugins/networking';

const { absolutejs, manifest } = await prepare();

new Elysia()
	.use(absolutejs)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'Home')))
	.get('/api/items/:id', ({ params, query }) => ({
		id: params.id,
		sort: query.sort ?? null
	}))
	.post('/api/items/:id', async ({ params, request }) => ({
		body: await request.text(),
		id: params.id
	}))
	.use(networking);
`
	);
};

type OutputSink = { text: string };

type Running = {
	baseUrl: string;
	output: () => string;
	proc: Bun.Subprocess;
};

const spawnCli = (
	directory: string,
	command: 'dev' | 'start',
	port: number
) => {
	const args =
		command === 'start'
			? [
					'start',
					join(directory, 'server.ts'),
					'--outdir',
					join(directory, 'build')
				]
			: ['dev', join(directory, 'server.ts'), '--port', String(port)];
	const proc = Bun.spawn(
		[
			process.execPath,
			'run',
			CLI,
			...args,
			'--config',
			join(directory, 'absolute.config.ts')
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: command === 'start' ? 'production' : 'development',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		}
	);
	const sink: OutputSink = { text: '' };
	const collect = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) sink.text += decoder.decode(chunk);
	};
	void collect(proc.stdout);
	void collect(proc.stderr);

	return { proc, output: () => sink.text };
};

const waitUntilServing = async (
	running: Running,
	deadline: number
): Promise<void> => {
	if (running.proc.exitCode !== null)
		throw new Error(`The server exited:\n${running.output().slice(-2000)}`);
	const response = await fetch(`${running.baseUrl}/`).catch(() => null);
	if (response?.ok) return;
	if (performance.now() > deadline)
		throw new Error(`No server:\n${running.output().slice(-2000)}`);
	await Bun.sleep(POLL_MS);
	await waitUntilServing(running, deadline);
};

const stagingRoot = resolve(PROJECT_ROOT, '.test-builds');
const directories: string[] = [];

const stage = async (rules: string) => {
	await mkdir(stagingRoot, { recursive: true });
	const directory = await mkdtemp(join(stagingRoot, 'routing-rules-'));
	directories.push(directory);
	await writeApp(directory, rules);

	return directory;
};

afterAll(async () => {
	await Promise.all(
		directories.map((directory) =>
			rm(directory, { force: true, recursive: true })
		)
	);
});

describe.each([['start'], ['dev']] as const)(
	'config routing rules under absolute %s',
	(command) => {
		let running: Running | undefined;

		beforeAll(async () => {
			const directory = await stage(RULES);
			const port = await getAvailablePort();
			const started: Running = {
				baseUrl: `http://localhost:${port}`,
				...spawnCli(directory, command, port)
			};
			running = started;
			await waitUntilServing(
				started,
				performance.now() + STARTUP_TIMEOUT_MS
			);
		}, HOOK_TIMEOUT_MS);

		afterAll(async () => {
			running?.proc.kill('SIGTERM');
			await running?.proc.exited;
		});

		const get = (path: string, init?: RequestInit) =>
			fetch(`${running?.baseUrl}${path}`, {
				redirect: 'manual',
				...init
			});

		test('a redirect answers, query string included', async () => {
			const response = await get('/old-home?ref=mail');

			expect(response.status).toBe(308);
			expect(response.headers.get('location')).toBe('/?ref=mail');
		});

		test('a redirect answers for a path no route serves', async () => {
			const response = await get('/blog/launch');

			expect(response.status).toBe(301);
			expect(response.headers.get('location')).toBe(
				'https://blog.example.com/launch'
			);
		});

		test('a rewrite serves the other route at the address asked for', async () => {
			const response = await get('/i/42?sort=new');

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: '42', sort: 'new' });
		});

		test('a rewrite carries the method and the body', async () => {
			const response = await get('/i/7', {
				body: 'hello',
				method: 'POST'
			});

			expect(await response.json()).toEqual({ body: 'hello', id: '7' });
		});

		test('headers reach a page', async () => {
			const response = await get('/');

			expect(await response.text()).toContain('RULES_HOME');
			expect(response.headers.get('x-frame-options')).toBe('DENY');
		});

		test('headers reach a static file', async () => {
			const response = await get('/assets/note.txt');

			expect(await response.text()).toBe('a static note\n');
			expect(response.headers.get('x-frame-options')).toBe('DENY');
			expect(response.headers.get('cache-control')).toBe(
				'public, max-age=600'
			);
		});

		test("the framework's own endpoints are left where they are", async () => {
			const response = await get('/__absolute/live');

			expect(response.status).toBe(200);
		});
	}
);

describe('a malformed rule', () => {
	test(
		'stops absolute start, saying which rule and why',
		async () => {
			const directory = await stage(
				`	redirects: [{ from: '/a/:id', to: '/b/:slug' }]`
			);
			const { output, proc } = spawnCli(
				directory,
				'start',
				await getAvailablePort()
			);
			const exitCode = await proc.exited;

			expect(exitCode).not.toBe(0);
			expect(output()).toContain(
				'redirects[0].to uses :slug, which "/a/:id" does not capture.'
			);
		},
		HOOK_TIMEOUT_MS
	);
});

/* A static host has no server to apply the rules, so an export hands
 * them over in the two files Netlify and Cloudflare Pages read. */
describe('absolute export', () => {
	test(
		'writes the rules as _redirects and _headers beside the pages',
		async () => {
			const directory = await stage(RULES);
			const out = join(directory, 'out');
			const proc = Bun.spawn(
				[
					process.execPath,
					'run',
					CLI,
					'export',
					join(directory, 'server.ts'),
					'--outdir',
					join(directory, 'build'),
					'--to',
					out,
					'--config',
					join(directory, 'absolute.config.ts')
				],
				{
					cwd: PROJECT_ROOT,
					env: {
						...process.env,
						FORCE_COLOR: '0',
						NODE_ENV: 'production',
						TELEMETRY_OFF: '1'
					},
					stderr: 'pipe',
					stdout: 'pipe'
				}
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited
			]);

			expect(`${stdout}\n${stderr}`).toContain(
				'wrote _redirects and _headers'
			);
			expect(exitCode).toBe(0);
			expect(await Bun.file(join(out, '_redirects')).text()).toBe(
				'/old-home / 308\n/blog/:slug https://blog.example.com/:slug 301\n/i/:id /api/items/:id 200\n'
			);
			expect(await Bun.file(join(out, '_headers')).text()).toBe(
				'/*\n  x-frame-options: DENY\n\n/assets/*\n  cache-control: public, max-age=600\n'
			);
			expect(await Bun.file(join(out, 'index.html')).text()).toContain(
				'RULES_HOME'
			);
		},
		HOOK_TIMEOUT_MS
	);
});
