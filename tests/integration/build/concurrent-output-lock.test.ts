import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'dist/cli/index.js');
const DIST_INDEX = resolve(PROJECT_ROOT, 'dist/index.js');
const tempRoots = new Set<string>();

const makeTempDir = async (name: string) => {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempRoots.add(dir);

	return dir;
};

const normalizeImportPath = (path: string) => path.replace(/\\/g, '/');

const createApp = async (workspaceRoot: string, name: string) => {
	const appRoot = join(workspaceRoot, name);
	await mkdir(join(appRoot, 'react', 'pages'), { recursive: true });
	await writeFile(
		join(appRoot, 'absolute.config.ts'),
		`import { defineConfig } from '${normalizeImportPath(DIST_INDEX)}';

export default defineConfig({
	reactDirectory: '${normalizeImportPath(join(appRoot, 'react'))}'
});
`
	);
	await writeFile(
		join(appRoot, 'react', 'pages', 'Home.tsx'),
		`export function Home() {
	return <h1>${name.toUpperCase()}_HOME</h1>;
}
`
	);

	return appRoot;
};

const runBuild = async (
	workspaceRoot: string,
	appRoot: string,
	sharedOutdir: string
) => {
	const proc = Bun.spawn(
		[
			'bun',
			CLI_ENTRY,
			'build',
			'--outdir',
			sharedOutdir,
			'--config',
			join(appRoot, 'absolute.config.ts')
		],
		{
			cwd: workspaceRoot,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);

	return { exitCode, stderr, stdout };
};

afterEach(async () => {
	for (const root of [...tempRoots]) {
		await rm(root, { force: true, recursive: true }).catch(() => {});
		tempRoots.delete(root);
	}
});

describe('build directory locking', () => {
	test('serializes concurrent builds that target the same resolved outdir', async () => {
		await ensureDistBuild();
		const workspaceRoot = await makeTempDir('absolute-shared-build');
		await symlink(
			resolve(PROJECT_ROOT, 'node_modules'),
			join(workspaceRoot, 'node_modules'),
			'dir'
		);
		const sharedOutdir = join(workspaceRoot, 'shared-build');
		const [appA, appB] = await Promise.all([
			createApp(workspaceRoot, 'app-a'),
			createApp(workspaceRoot, 'app-b')
		]);

		const [buildA, buildB] = await Promise.all([
			runBuild(workspaceRoot, appA, sharedOutdir),
			runBuild(workspaceRoot, appB, sharedOutdir)
		]);

		expect(buildA.exitCode, buildA.stderr || buildA.stdout).toBe(0);
		expect(buildB.exitCode, buildB.stderr || buildB.stdout).toBe(0);
		expect(`${buildA.stderr}\n${buildB.stderr}`).not.toContain('ENOENT');
		expect(`${buildA.stderr}\n${buildB.stderr}`).not.toContain(
			'EADDRINUSE'
		);
		expect(existsSync(join(sharedOutdir, 'manifest.json'))).toBe(true);
		expect(
			existsSync(join(workspaceRoot, '.absolutejs', 'build.lock'))
		).toBe(false);

		const manifest = JSON.parse(
			await readFile(join(sharedOutdir, 'manifest.json'), 'utf-8')
		) as Record<string, string>;
		expect(Object.keys(manifest).length).toBeGreaterThan(0);
	});
});
