import { describe, expect, test } from 'bun:test';
import {
	absoluteCliVersion,
	GLOBAL_FLAGS,
	HELP_FLAGS,
	validateCommandFlags,
	validatesFlags,
	VERSION_FLAGS
} from '../../../src/cli/usage';

/* Flag validation, and the help/version words the dispatcher checks before
 * it treats the first argument as a command name.
 *
 * The behaviour before this existed, measured rather than assumed:
 * `absolute --help` printed `Unknown command: --help`, sent the whole
 * usage list to stderr and exited 1; `absolute --version` printed no
 * version at all; and `absolute typecheck --bogus-flag --config` ran the
 * full typecheck and exited 0, ignoring both the unknown flag and the
 * `--config` that had no value after it. */

describe('validateCommandFlags', () => {
	test('accepts a command’s own flags and the global ones', () => {
		expect(validateCommandFlags('dev', ['--eager'])).toBeNull();
		expect(validateCommandFlags('build', ['--outdir', 'out'])).toBeNull();
		expect(
			validateCommandFlags('typecheck', [
				'--config',
				'absolute.config.ts'
			])
		).toBeNull();
		expect(
			validateCommandFlags('dev', ['--android-device', 'emulator-5554'])
		).toBeNull();
	});

	/* A positional argument is the command's business: `dev [entry]` takes
	 * one and this must not reject it. */
	test('ignores positional arguments', () => {
		expect(validateCommandFlags('start', ['server.ts'])).toBeNull();
		expect(
			validateCommandFlags('compile', ['server.ts', '--outfile', 'app'])
		).toBeNull();
	});

	test('reports an unknown flag, naming the command', () => {
		const problem = validateCommandFlags('typecheck', ['--bogus-flag']);

		expect(problem?.message).toContain('Unknown flag');
		expect(problem?.message).toContain('absolute typecheck');
		expect(problem?.message).toContain('--bogus-flag');
	});

	/* A near miss is the case worth a suggestion: `--no-mobil` did nothing
	 * and said nothing, so a mobile build ran that the user meant to skip. */
	test('suggests the flag a typo was close to', () => {
		expect(validateCommandFlags('dev', ['--no-mobil'])?.message).toContain(
			'Did you mean --no-mobile?'
		);
		expect(
			validateCommandFlags('build', ['--outdi', 'x'])?.message
		).toContain('Did you mean --outdir?');
	});

	/* And a flag that is nothing like a real one gets no guess, rather
	 * than the nearest string by distance. */
	test('does not guess for a flag unlike any known one', () => {
		const problem = validateCommandFlags('build', ['--zzzzzzzzzzzz']);

		expect(problem?.message).toContain('Unknown flag');
		expect(problem?.message).not.toContain('Did you mean');
	});

	/* The silent one: the dispatcher read `args[idx + 1]`, got `undefined`
	 * and treated it as "not given", so a trailing `--config` used the
	 * default config and said nothing. */
	test('reports a value flag with no value, including one followed by a flag', () => {
		expect(validateCommandFlags('typecheck', ['--config'])?.message).toBe(
			'--config needs a value after it.'
		);
		expect(
			validateCommandFlags('build', ['--outdir', '--profile'])?.message
		).toBe('--outdir needs a value after it.');
	});

	test('a boolean flag needs no value', () => {
		expect(validateCommandFlags('build', ['--profile'])).toBeNull();
		expect(validateCommandFlags('start', ['--prebuilt'])).toBeNull();
	});

	/* 25 of the 37 commands forward their whole argument list to a script
	 * that parses it itself, so validating them here would reject
	 * arguments that work today. */
	test('a pass-through command is not validated', () => {
		for (const command of ['eslint', 'prettier', 'db', 'mobile', 'i18n'])
			expect(
				validateCommandFlags(command, ['--anything', '-x'])
			).toBeNull();
		expect(validatesFlags('eslint')).toBe(false);
		expect(validatesFlags('dev')).toBe(true);
	});
});

describe('help and version words', () => {
	test('cover the forms a user types', () => {
		for (const word of ['--help', '-h', 'help'])
			expect(HELP_FLAGS.has(word)).toBe(true);
		for (const word of ['--version', '-v'])
			expect(VERSION_FLAGS.has(word)).toBe(true);
	});

	test('--help is a global flag, so no command rejects it', () => {
		expect(GLOBAL_FLAGS['--help']).toBe('boolean');
		expect(validateCommandFlags('build', ['--help'])).toBeNull();
	});
});

describe('absoluteCliVersion', () => {
	/* Read from the package the CLI was loaded from, so the answer is what
	 * is running rather than what is installed nearby. */
	test('is this package’s version', async () => {
		const pkg: { version: string } = await Bun.file('package.json').json();

		expect(absoluteCliVersion()).toBe(pkg.version);
	});
});
