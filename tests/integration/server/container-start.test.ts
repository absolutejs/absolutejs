import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';

/* Starts a prepared build the way templates/container/Dockerfile runs it:
 * `bun dist/server.js` with the environment that Dockerfile sets, from an
 * app root that holds nothing but node_modules, over a build the server
 * cannot write, with an empty HOME. That is what a container that scales to
 * zero gets on every cold start. The server must answer within the budget,
 * and write nothing anywhere except TMPDIR. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = resolve(PROJECT_ROOT, 'src/cli/index.ts');
const SERVER_ENTRY = resolve(PROJECT_ROOT, 'example/server.ts');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
// Generous for a loaded CI machine; the example app answers in well under
// a second on a laptop.
const COLD_START_BUDGET_MS = 15_000;
const STOP_BUDGET_MS = 5_000;
const POLL_INTERVAL_MS = 10;
const POLL_TIMEOUT_MS = 1_000;

const listTree = async (root: string) => {
	const entries = await readdir(root, { recursive: true });

	return entries.sort();
};

const setTreeWritable = async (root: string, writable: boolean) => {
	await chmod(root, writable ? 0o755 : 0o555);
	const entries = await readdir(root, { withFileTypes: true });
	await Promise.all(
		entries.map((entry) => {
			const entryPath = join(root, entry.name);
			if (entry.isDirectory())
				return setTreeWritable(entryPath, writable);

			return chmod(entryPath, writable ? 0o644 : 0o444);
		})
	);
};

const readOutput = (stream: ReturnType<typeof Bun.spawn>['stdout']) =>
	typeof stream === 'number' || stream === undefined
		? Promise.resolve('')
		: new Response(stream).text();

const tryFetch = async (url: string) => {
	try {
		return await fetch(url, {
			signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
		});
	} catch {
		return null;
	}
};

const waitForFirstResponse = async (
	url: string,
	exited: Promise<number>,
	budgetMs: number
) => {
	let exitCode: number | undefined;
	void exited.then((code) => {
		exitCode = code;

		return code;
	});
	const startedAt = performance.now();
	while (performance.now() - startedAt < budgetMs) {
		if (exitCode !== undefined)
			throw new Error(`server exited before answering (${exitCode})`);
		const response = await tryFetch(url);
		if (response) return { response, startedAt };
		await Bun.sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`server did not answer within ${budgetMs} ms`);
};

let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
const scratch: string[] = [];
let outdir: string | undefined;

afterAll(async () => {
	if (serverProcess) {
		serverProcess.kill();
		await serverProcess.exited;
	}
	if (outdir) await setTreeWritable(outdir, true).catch(() => undefined);
	await Promise.all(
		[...scratch, ...(outdir ? [outdir] : [])].map((path) =>
			rm(path, { force: true, recursive: true })
		)
	);
});

describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
	'container start of a prepared build',
	() => {
		test('answers within the cold-start budget and writes only to TMPDIR', async () => {
			const stagingRoot = resolve(PROJECT_ROOT, '.test-builds');
			await mkdir(stagingRoot, { recursive: true });
			outdir = await mkdtemp(join(stagingRoot, 'container-'));
			const appRoot = await mkdtemp(join(tmpdir(), 'absolute-app-'));
			const home = await mkdtemp(join(tmpdir(), 'absolute-home-'));
			const runtimeTmp = await mkdtemp(join(tmpdir(), 'absolute-tmp-'));
			scratch.push(appRoot, home, runtimeTmp);
			await symlink(
				join(PROJECT_ROOT, 'node_modules'),
				join(appRoot, 'node_modules')
			);

			const prepare = Bun.spawn(
				[
					'bun',
					'run',
					CLI_PATH,
					'prepare',
					SERVER_ENTRY,
					'--outdir',
					outdir,
					'--config',
					CONFIG_PATH
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
			const [prepareExit, prepareStdout, prepareStderr] =
				await Promise.all([
					prepare.exited,
					readOutput(prepare.stdout),
					readOutput(prepare.stderr)
				]);
			expect(
				prepareExit,
				`prepare failed:\n${prepareStdout}\n${prepareStderr}`
			).toBe(0);

			const buildBefore = await listTree(outdir);
			await setTreeWritable(outdir, false);

			const port = await getAvailablePort();
			serverProcess = Bun.spawn(
				[process.execPath, join(outdir, 'server.js')],
				{
					cwd: appRoot,
					env: {
						ABSOLUTE_BUILD_DIR: outdir,
						ABSOLUTE_INSTANCE_MANAGED: '1',
						// Bun's own transpiler cache, which it keeps under
						// HOME on macOS (a Linux container writes none). Not
						// the framework's write; keep it out of HOME.
						BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(
							runtimeTmp,
							'bun-transpiler-cache'
						),
						FORCE_COLOR: '0',
						HOME: home,
						// The Dockerfile binds 0.0.0.0; a test has no reason to.
						HOST: '127.0.0.1',
						NODE_ENV: 'production',
						PATH: process.env.PATH ?? '',
						PORT: String(port),
						TELEMETRY_OFF: '1',
						TMPDIR: runtimeTmp
					},
					stderr: 'pipe',
					stdout: 'pipe'
				}
			);
			const baseUrl = `http://127.0.0.1:${port}`;
			const spawnedAt = performance.now();
			const first = await waitForFirstResponse(
				`${baseUrl}/`,
				serverProcess.exited,
				COLD_START_BUDGET_MS
			).catch(async (error) => {
				serverProcess?.kill();
				const [stdout, stderr] = await Promise.all([
					readOutput(serverProcess?.stdout),
					readOutput(serverProcess?.stderr)
				]);
				throw new Error(`${error}\n${stdout}\n${stderr}`);
			});
			const coldStartMs = performance.now() - spawnedAt;
			expect(first.response.status).toBe(200);
			expect(await first.response.text()).toContain('AbsoluteJS');
			expect(coldStartMs).toBeLessThan(COLD_START_BUDGET_MS);

			const routes = [
				'/react',
				'/svelte',
				'/vue',
				'/htmx',
				'/htmx/count'
			];
			const statuses = await Promise.all(
				routes.map(async (route) => {
					const response = await fetch(`${baseUrl}${route}`);
					await response.arrayBuffer();

					return [route, response.status];
				})
			);
			expect(Object.fromEntries(statuses)).toEqual(
				Object.fromEntries(routes.map((route) => [route, 200]))
			);
			// The image optimizer cannot cache into the read-only build; it
			// still answers.
			const image = await fetch(
				`${baseUrl}/_absolute/image?url=%2Fassets%2Fpng%2Fabsolutejs-temp.png&w=640&q=75`,
				{ headers: { accept: 'image/webp' } }
			);
			await image.arrayBuffer();
			expect(image.status).toBe(200);

			const stopStartedAt = performance.now();
			serverProcess.kill('SIGTERM');
			await serverProcess.exited;
			serverProcess = undefined;
			expect(performance.now() - stopStartedAt).toBeLessThan(
				STOP_BUDGET_MS
			);

			expect(await listTree(outdir)).toEqual(buildBefore);
			expect(await readdir(appRoot)).toEqual(['node_modules']);
			expect(await readdir(home)).toEqual([]);
		}, 240_000);
	}
);
