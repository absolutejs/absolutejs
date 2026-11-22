import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';

/* `absolute --help`, `--version` and an unknown flag, through the real
 * CLI — because what was wrong with them was not the text but the STREAM
 * and the EXIT CODE, and a unit test of the validator cannot see either.
 *
 * Measured before the change: `absolute --help` printed
 * `Unknown command: --help`, wrote the whole usage list to stderr and
 * exited 1, so `absolute --help | less` showed nothing and any script
 * checking the status saw a failure. `--version` printed no version on
 * either stream. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');

const run = async (...args: string[]) => {
	const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
		cwd: repoRoot,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);

	return { exitCode, stderr, stdout };
};

describe('absolute --help', () => {
	test.each([['--help'], ['-h'], ['help']])(
		'%s prints the usage on stdout and exits 0',
		async (word) => {
			const { exitCode, stderr, stdout } = await run(word);

			expect(stdout).toContain('Usage: absolute <command>');
			expect(stdout).toContain('dev [entry]');
			/* `--config` is read by nine commands and was named on only
			 * some of their lines, so an accepted flag looked unknown. */
			expect(stdout).toContain('Global flags:');
			expect(stdout).toContain('--config <path>');
			// The whole point: usable in a pipe, and not an error.
			expect(exitCode).toBe(0);
			expect(stderr).not.toContain('Unknown command');
		},
		120_000
	);

	/* A command's own help request, rather than an argument for it to
	 * parse — and it must not run the command. */
	test('a command’s --help prints usage without running it', async () => {
		const { exitCode, stdout } = await run('build', '--help');

		expect(stdout).toContain('Usage: absolute <command>');
		expect(stdout).not.toContain('Build complete');
		expect(exitCode).toBe(0);
	}, 120_000);
});

describe('absolute --version', () => {
	test.each([['--version'], ['-v']])(
		'%s prints the package version on stdout and exits 0',
		async (word) => {
			const pkg: { version: string } = await Bun.file(
				join(repoRoot, 'package.json')
			).json();
			const { exitCode, stdout } = await run(word);

			expect(stdout.trim()).toBe(pkg.version);
			expect(exitCode).toBe(0);
		},
		120_000
	);
});

describe('flag validation', () => {
	test('an unknown flag fails with a message naming the command', async () => {
		const { exitCode, stderr } = await run('typecheck', '--bogus-flag');

		expect(stderr).toContain('Unknown flag for `absolute typecheck`');
		expect(stderr).toContain('--bogus-flag');
		expect(exitCode).toBe(1);
	}, 120_000);

	test('a near-miss suggests the real flag', async () => {
		const { exitCode, stderr } = await run('dev', '--no-mobil');

		expect(stderr).toContain('Did you mean --no-mobile?');
		expect(exitCode).toBe(1);
	}, 120_000);

	/* The silent one: this used to run the whole typecheck against the
	 * default config and exit 0. */
	test('a value flag with no value fails instead of using the default', async () => {
		const { exitCode, stderr, stdout } = await run('typecheck', '--config');

		expect(stderr).toContain('--config needs a value after it.');
		expect(stdout).not.toContain('Typecheck passed');
		expect(exitCode).toBe(1);
	}, 120_000);

	/* An unknown COMMAND keeps its old contract: stderr and exit 1. */
	test('an unknown command still reports on stderr and exits 1', async () => {
		const { exitCode, stderr, stdout } = await run('bogus-command');

		expect(stderr).toContain('Unknown command: bogus-command');
		expect(stderr).toContain('Usage: absolute <command>');
		expect(stdout).toBe('');
		expect(exitCode).toBe(1);
	}, 120_000);
});
