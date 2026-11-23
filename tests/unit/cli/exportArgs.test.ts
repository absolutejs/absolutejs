import { describe, expect, test } from 'bun:test';
import {
	assertSafeDestination,
	positionalEntry
} from '../../../src/cli/scripts/export';

/* The two argument paths in `absolute export` whose failures are expensive.
 *
 * The entry: the first version of the command did not read one, so it
 * passed the default `server.ts` to the bundler and an export of the
 * example app — whose server is `example/server.ts` — died with
 * `ModuleNotFound resolving .../server.ts`. The flag it needed was not
 * missing from the command line, it was missing from the parser.
 *
 * The destination: the export empties its directory before writing, so a
 * destination that resolves to the project root deletes the project. */

describe('positionalEntry', () => {
	test('reads the entry before the flags', () => {
		expect(
			positionalEntry(['example/server.ts', '--to', 'out', '--flat'])
		).toBe('example/server.ts');
	});

	test('reads the entry after the flags', () => {
		expect(
			positionalEntry(['--to', 'out', '--flat', 'example/server.ts'])
		).toBe('example/server.ts');
	});

	/* The bug this exists for: `out` is the VALUE of `--to`, not the entry.
	 * Taking it would bundle a directory name as the server. */
	test('a value flag’s value is not the entry', () => {
		expect(positionalEntry(['--to', 'out'])).toBeUndefined();
		expect(
			positionalEntry(['--config', 'example/absolute.config.ts'])
		).toBeUndefined();
		expect(positionalEntry(['--outdir', 'build'])).toBeUndefined();
	});

	test('a boolean flag does not swallow the entry after it', () => {
		expect(positionalEntry(['--flat', 'server.ts'])).toBe('server.ts');
		expect(positionalEntry(['--json', '--precompressed', 'srv.ts'])).toBe(
			'srv.ts'
		);
	});

	test('no entry given', () => {
		expect(positionalEntry([])).toBeUndefined();
		expect(positionalEntry(['--json'])).toBeUndefined();
	});
});

describe('assertSafeDestination', () => {
	const cwd = '/project';

	test('a directory beside the build is fine', () => {
		expect(() =>
			assertSafeDestination('/project/out', '/project/build', cwd)
		).not.toThrow();
	});

	/* `--to .` */
	test('the project directory itself is refused', () => {
		expect(() =>
			assertSafeDestination('/project', '/project/build', cwd)
		).toThrow('contains the project');
	});

	/* `--to ..` — the parent, which holds the project. */
	test('an ancestor of the project is refused', () => {
		expect(() => assertSafeDestination('/', '/project/build', cwd)).toThrow(
			'contains the project'
		);
	});

	/* Exporting into the build directory would delete the build it is
	 * reading from, mid-copy. */
	test('the build directory is refused', () => {
		expect(() =>
			assertSafeDestination('/project/build', '/project/build', cwd)
		).toThrow('build directory');
	});

	test('a parent of the build directory is refused', () => {
		expect(() =>
			assertSafeDestination('/elsewhere', '/elsewhere/build', cwd)
		).toThrow('build directory');
	});

	/* A sibling whose name merely starts with the same characters is not an
	 * ancestor: a prefix test without the separator would reject it. */
	test('a lookalike sibling is allowed', () => {
		expect(() =>
			assertSafeDestination('/project-out', '/project/build', cwd)
		).not.toThrow();
	});
});
