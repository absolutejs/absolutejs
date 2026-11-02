import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

const CLI_PATH = resolve(import.meta.dir, '..', '..', '..', 'src/cli/index.ts');
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

/* A project whose tsconfig sets outDir (the docs site's does), with a test
 * that imports a script kept beside the project. TypeScript 7 requires
 * every source file under rootDir even when nothing is emitted: with
 * rootDir unset it defaulted to .absolutejs, the generated config's
 * directory, and every file failed with TS6059 (2026-11-01). */
const project = async (source: string) => {
	const workspace = await mkdtemp(join(tmpdir(), 'absolute-rootdir-'));
	directories.push(workspace);
	const root = join(workspace, 'app');
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(workspace, 'shared.ts'), 'export const shared = 1;\n');
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'rootdir-fixture', type: 'module' })
	);
	await writeFile(
		join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				module: 'ESNext',
				moduleResolution: 'bundler',
				outDir: 'dist',
				strict: true,
				target: 'ESNext'
			}
		})
	);
	await writeFile(join(root, 'src', 'index.ts'), source);

	return root;
};

const typecheck = async (cwd: string) => {
	const proc = Bun.spawn(['bun', CLI_PATH, 'typecheck'], {
		cwd,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);

	return { exitCode, output: `${stdout}\n${stderr}` };
};

describe('absolute typecheck with a project that sets outDir', () => {
	test('checks files inside and beside the project without TS6059', async () => {
		const root = await project(
			"import { shared } from '../../shared';\n\nexport const value: number = shared;\n"
		);
		const result = await typecheck(root);

		expect(result.output).not.toContain('TS6059');
		expect(result.exitCode).toBe(0);
	}, 120_000);

	test('still reports a real type error', async () => {
		const root = await project("export const value: number = 'text';\n");
		const result = await typecheck(root);

		expect(result.output).toContain('TS2322');
		expect(result.output).not.toContain('TS6059');
		expect(result.exitCode).not.toBe(0);
	}, 120_000);
});
