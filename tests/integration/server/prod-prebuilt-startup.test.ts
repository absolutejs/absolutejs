import { afterAll, describe, expect, test } from 'bun:test';
import {
	chmod,
	mkdtemp,
	mkdir,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fetchPage, waitForServer } from '../../helpers/http';
import { getAvailablePort } from '../../helpers/ports';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = resolve(PROJECT_ROOT, 'src/cli/index.ts');
const SERVER_ENTRY = resolve(PROJECT_ROOT, 'example/server.ts');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'example/absolute.config.ts');

const readProcessOutput = (stream: ReturnType<typeof Bun.spawn>['stdout']) =>
	typeof stream === 'number' || stream === undefined
		? Promise.resolve('')
		: new Response(stream).text();

const setTreeWritable = async (root: string, writable: boolean) => {
	await chmod(root, writable ? 0o755 : 0o555);
	const entries = await readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = join(root, entry.name);
		if (entry.isDirectory()) {
			await setTreeWritable(entryPath, writable);
		} else {
			await chmod(entryPath, writable ? 0o644 : 0o444);
		}
	}
};

let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let outdir: string | undefined;
let runtimeDir: string | undefined;

afterAll(async () => {
	if (serverProcess) {
		serverProcess.kill();
		await serverProcess.exited;
	}
	if (outdir) {
		await setTreeWritable(outdir, true).catch(() => {});
		await rm(outdir, { force: true, recursive: true });
	}
	if (runtimeDir) await rm(runtimeDir, { force: true, recursive: true });
});

describe('prebuilt production server startup', () => {
	test('serves a prepared build without writing to its immutable output tree', async () => {
		const stagingRoot = resolve(PROJECT_ROOT, '.test-builds');
		await mkdir(stagingRoot, { recursive: true });
		outdir = await mkdtemp(join(stagingRoot, 'prebuilt-'));
		runtimeDir = await mkdtemp(join(stagingRoot, 'prebuilt-runtime-'));
		const runtimeConfigPath = join(runtimeDir, 'absolute.config.ts');
		await writeFile(
			runtimeConfigPath,
			`import config from ${JSON.stringify(CONFIG_PATH)};\n` +
				`export default { ...config, images: { ...config.images, cacheDirectory: ${JSON.stringify(join(runtimeDir, 'image-cache'))} } };\n`
		);
		const port = await getAvailablePort();
		const env: NodeJS.ProcessEnv = {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		};

		const prepareProcess = Bun.spawn(
			[
				'bun',
				'run',
				CLI_PATH,
				'prepare',
				SERVER_ENTRY,
				'--outdir',
				outdir,
				'--config',
				runtimeConfigPath
			],
			{
				cwd: PROJECT_ROOT,
				env,
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);
		const [prepareExit, prepareStdout, prepareStderr] = await Promise.all([
			prepareProcess.exited,
			new Response(prepareProcess.stdout).text(),
			new Response(prepareProcess.stderr).text()
		]);
		expect(
			prepareExit,
			`prepare failed:\n${prepareStdout}\n${prepareStderr}`
		).toBe(0);

		await setTreeWritable(outdir, false);
		serverProcess = Bun.spawn(
			[
				'bun',
				'run',
				CLI_PATH,
				'start',
				SERVER_ENTRY,
				'--outdir',
				outdir,
				'--config',
				runtimeConfigPath,
				'--prebuilt'
			],
			{
				cwd: PROJECT_ROOT,
				env,
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);

		const baseUrl = `http://localhost:${port}`;
		try {
			await Promise.race([
				waitForServer(baseUrl, 120),
				serverProcess.exited.then((exitCode) => {
					throw new Error(
						`Prebuilt server exited before readiness (${exitCode}).`
					);
				})
			]);
		} catch (error) {
			serverProcess.kill();
			const [serverExit, serverStdout, serverStderr] = await Promise.all([
				serverProcess.exited,
				readProcessOutput(serverProcess.stdout),
				readProcessOutput(serverProcess.stderr)
			]);
			serverProcess = undefined;
			throw new Error(
				`prebuilt start failed (${serverExit}):\n${serverStdout}\n${serverStderr}`,
				{ cause: error }
			);
		}
		const { html, status } = await fetchPage(baseUrl);
		expect(status).toBe(200);
		expect(html).toContain('AbsoluteJS');
	}, 180_000);
});
