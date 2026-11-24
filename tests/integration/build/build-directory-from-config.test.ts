import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* `buildDirectory` in `absolute.config.ts` was ignored by the CLI.
 *
 * Measured on this repository's own example app, whose config says
 * `example/build`:
 *
 *   absolute build   wrote ./build          (resolve(outdir ?? 'build'))
 *   absolute start   wrote ./dist           (resolve(outdir ?? 'dist'))
 *   prepare()        read  ./example/build  (config.buildDirectory)
 *   absolute analyze read  ./example/build  (config.buildDirectory)
 *
 * Three directories for one concept. The documented flow — `absolute
 * build`, then a server calling `prepare()` — therefore reads a directory
 * the build never wrote, for any project whose config does not happen to
 * say `build`. Both example configs in the README say exactly `build`,
 * which is what kept it hidden.
 *
 * Nothing fails loudly: the build succeeds, the server starts, and pages
 * 404 or serve stale assets.
 *
 * These run the real CLI, because the defect was in the CLI's argument
 * handling rather than in `build()`. */

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'index.ts');
const roots: string[] = [];

const project = async (name: string, buildDirectory: string) => {
	const root = join(
		REPO_ROOT,
		'.test-builds',
		`build-dir-${name}-${process.pid}`
	);
	roots.push(root);
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: `fixture-${name}` })
	);
	await writeFile(
		join(root, 'absolute.config.ts'),
		`import { defineConfig } from ${JSON.stringify(join(REPO_ROOT, 'src', 'utils', 'defineConfig.ts'))};\n\nexport default defineConfig({\n\tbuildDirectory: ${JSON.stringify(buildDirectory)},\n\treactDirectory: 'react'\n});\n`
	);
	await writeFile(
		join(root, 'react', 'pages', 'Home.tsx'),
		'export const Home = () => (\n\t<html lang="en">\n\t\t<head>\n\t\t\t<title>Home</title>\n\t\t</head>\n\t\t<body>\n\t\t\t<h1>Home</h1>\n\t\t</body>\n\t</html>\n);\n'
	);

	return root;
};

const runBuild = async (root: string, extra: string[] = []) => {
	const child = Bun.spawn(
		[
			'bun',
			CLI,
			'build',
			'--config',
			join(root, 'absolute.config.ts'),
			...extra
		],
		{
			cwd: root,
			env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);

	return { exitCode, output: `${stdout}\n${stderr}` };
};

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('absolute build', () => {
	test('writes to the buildDirectory the config declares', async () => {
		const root = await project('declared', 'custom-output');
		const { exitCode, output } = await runBuild(root);

		expect({ code: exitCode, output }).toMatchObject({ code: 0 });
		/* Where `prepare()` will look. */
		expect(existsSync(join(root, 'custom-output', 'manifest.json'))).toBe(
			true
		);
		/* And not the CLI's own former default, which nothing reads. */
		expect(existsSync(join(root, 'build'))).toBe(false);
	}, 180_000);

	test('--outdir still wins over the config', async () => {
		const root = await project('explicit', 'custom-output');
		const { exitCode } = await runBuild(root, ['--outdir', 'elsewhere']);

		expect(exitCode).toBe(0);
		expect(existsSync(join(root, 'elsewhere', 'manifest.json'))).toBe(true);
		expect(existsSync(join(root, 'custom-output'))).toBe(false);
	}, 180_000);

	test('falls back to ./build when the config declares none', async () => {
		const root = join(
			REPO_ROOT,
			'.test-builds',
			`build-dir-none-${process.pid}`
		);
		roots.push(root);
		await mkdir(join(root, 'react', 'pages'), { recursive: true });
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({ name: 'fixture-none' })
		);
		await writeFile(
			join(root, 'absolute.config.ts'),
			`import { defineConfig } from ${JSON.stringify(join(REPO_ROOT, 'src', 'utils', 'defineConfig.ts'))};\n\nexport default defineConfig({ reactDirectory: 'react' });\n`
		);
		await writeFile(
			join(root, 'react', 'pages', 'Home.tsx'),
			'export const Home = () => <html lang="en"><head><title>H</title></head><body>H</body></html>;\n'
		);

		const { exitCode } = await runBuild(root);

		expect(exitCode).toBe(0);
		expect(existsSync(join(root, 'build', 'manifest.json'))).toBe(true);
	}, 180_000);
});
