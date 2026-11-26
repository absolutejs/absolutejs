import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';

/* `headers()` and `cookies()` on a running server, in both modes.
 *
 * The unit tests drive the helpers through an Elysia app in one process.
 * What only a real server shows is that the request they read survives
 * the way an app is actually put together: `absolute start` bundles the
 * server, so the module that stores the request and the module that reads
 * it can be separate copies, and the two must still agree. The helper
 * calls here are in a module of their own, away from the route, which is
 * the use they exist for. */

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const CLI = resolve(PROJECT_ROOT, 'src/cli/index.ts');
const SRC = resolve(PROJECT_ROOT, 'src').replace(/\\/g, '/');
const STARTUP_TIMEOUT_MS = 120_000;
const POLL_MS = 150;
const HOOK_TIMEOUT_MS = 180_000;

const writeApp = async (directory: string) => {
	const root = directory.replace(/\\/g, '/');
	await mkdir(join(directory, 'html', 'pages'), { recursive: true });
	await writeFile(
		join(directory, 'html', 'pages', 'Home.html'),
		'<!doctype html><html><head><title>Home</title></head><body><h1>HELPERS_HOME</h1></body></html>\n'
	);
	await writeFile(
		join(directory, 'absolute.config.ts'),
		`import { defineConfig } from '${SRC}/utils/defineConfig';

export default defineConfig({
	buildDirectory: '${root}/build',
	htmlDirectory: '${root}/html'
});
`
	);
	await writeFile(
		join(directory, 'preferences.ts'),
		`import { cookies, headers } from '${SRC}/index';

export const readPreferences = () => ({
	language: headers().get('accept-language'),
	theme: cookies().get('theme') ?? null
});

export const rememberTheme = (theme: string) => {
	cookies().set('theme', theme, { maxAge: 3600 });
};

export const forgetTheme = () => {
	cookies().delete('theme');
};
`
	);
	await writeFile(
		join(directory, 'server.ts'),
		`import { Elysia } from 'elysia';
import { asset, prepare } from '${SRC}/index';
import { handleHTMLPageRequest } from '${SRC}/core/pageHandlers';
import { networking } from '${SRC}/plugins/networking';
import { forgetTheme, readPreferences, rememberTheme } from './preferences';

const { absolutejs, manifest } = await prepare();

new Elysia()
	.use(absolutejs)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'Home')))
	.get('/preferences', () => readPreferences())
	.post('/theme/:name', ({ params }) => {
		rememberTheme(params.name);

		return readPreferences();
	})
	.delete('/theme', () => {
		forgetTheme();

		return readPreferences();
	})
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

const directories: string[] = [];

afterAll(async () => {
	await Promise.all(
		directories.map((directory) =>
			rm(directory, { force: true, recursive: true })
		)
	);
});

describe.each([['start'], ['dev']] as const)(
	'headers() and cookies() under absolute %s',
	(command) => {
		let running: Running | undefined;

		beforeAll(async () => {
			const parent = resolve(PROJECT_ROOT, '.test-builds');
			await mkdir(parent, { recursive: true });
			const directory = await mkdtemp(join(parent, 'request-helpers-'));
			directories.push(directory);
			await writeApp(directory);
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

		const send = (path: string, init?: RequestInit) =>
			fetch(`${running?.baseUrl}${path}`, init);

		test('a module that was not handed the request reads it', async () => {
			const response = await send('/preferences', {
				headers: { 'accept-language': 'fr-CA', cookie: 'theme=dark' }
			});

			expect(await response.json()).toEqual({
				language: 'fr-CA',
				theme: 'dark'
			});
		});

		test('a cookie set there leaves on the response', async () => {
			const response = await send('/theme/solar', { method: 'POST' });

			expect(response.headers.getSetCookie()).toEqual([
				'theme=solar; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax'
			]);
			// And the same request already reads it back.
			expect(await response.json()).toMatchObject({ theme: 'solar' });
		});

		test('and one deleted there is expired', async () => {
			const response = await send('/theme', {
				headers: { cookie: 'theme=solar' },
				method: 'DELETE'
			});

			expect(response.headers.getSetCookie()).toEqual([
				'theme=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
			]);
			expect(await response.json()).toMatchObject({ theme: null });
		});

		test('requests in flight together each read their own', async () => {
			const themes = ['a', 'b', 'c', 'd', 'e', 'f'];
			const answers = await Promise.all(
				themes.map(async (theme) => {
					const response = await send('/preferences', {
						headers: { cookie: `theme=${theme}` }
					});
					const body: { theme: string } = await response.json();

					return body.theme;
				})
			);

			expect(answers).toEqual(themes);
		});

		test('a page that sets no cookie sends none', async () => {
			const response = await send('/');

			expect(await response.text()).toContain('HELPERS_HOME');
			expect(response.headers.getSetCookie()).toEqual([]);
		});
	}
);
