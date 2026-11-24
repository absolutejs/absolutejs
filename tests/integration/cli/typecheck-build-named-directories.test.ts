import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/* `absolute typecheck` leaves the build output out of the program, and
 * did it by leaving out every directory NAMED `build`. Source in
 * `src/build/` or `tests/build/` was never checked and the command said
 * it passed. In this repository that was 107 test files, with 25 type
 * errors in them and one `@ts-expect-error` pin that had never held.
 *
 * What is left out now is where the config says the build goes. */

const BROKEN = "export const value: number = 'text';\n";
const SOUND = 'export const value: number = 1;\n';

const project = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-build-named-'));
	directories.push(root);
	const all: Record<string, string> = {
		'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
		'tsconfig.json': JSON.stringify({
			compilerOptions: {
				module: 'ESNext',
				moduleResolution: 'bundler',
				strict: true,
				target: 'ESNext'
			},
			include: ['**/*.ts']
		}),
		...files
	};
	await Promise.all(
		Object.entries(all).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);

	return root;
};

/* A plain shell, whoever runs the suite: bun check prints a different
 * shape under a coding agent, and these read file names out of it. */
const AGENT_MARKERS = ['AGENT', 'AI_AGENT', 'CLAUDECODE', 'REPL_ID'];

const typecheck = async (cwd: string) => {
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(
			([name]) => !AGENT_MARKERS.includes(name)
		)
	);
	const proc = Bun.spawn(['bun', CLI_PATH, 'typecheck'], {
		cwd,
		env: { ...inherited, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
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

describe('absolute typecheck and directories named build', () => {
	test('source in a directory named build is checked', async () => {
		const root = await project({
			'src/build/compile.ts': BROKEN,
			'src/index.ts': SOUND,
			'tests/build/compile.test.ts': BROKEN
		});
		const result = await typecheck(root);

		expect(result.output).toContain('src/build/compile.ts');
		expect(result.output).toContain('tests/build/compile.test.ts');
		expect(result.exitCode).not.toBe(0);
	}, 120_000);

	test('the default build output is still left out', async () => {
		const root = await project({
			'build/generated-entry.ts': BROKEN,
			'src/index.ts': SOUND
		});
		const result = await typecheck(root);

		expect(result.output).not.toContain('generated-entry.ts');
		expect(result.exitCode).toBe(0);
	}, 120_000);

	/* The config moves the output, so the exclusion moves with it — and
	 * `build/` is then a directory like any other. */
	test('a configured buildDirectory is left out instead', async () => {
		const root = await project({
			'absolute.config.ts': "export default { buildDirectory: 'out' };\n",
			'build/helpers.ts': BROKEN,
			'out/generated-entry.ts': BROKEN,
			'src/index.ts': SOUND
		});
		const result = await typecheck(root);

		expect(result.output).toContain('build/helpers.ts');
		expect(result.output).not.toContain('generated-entry.ts');
		expect(result.exitCode).not.toBe(0);
	}, 120_000);
});
