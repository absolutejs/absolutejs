import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Glob } from 'bun';
import {
	buildOutputGlobs,
	loadBuildOutputGlobs
} from '../../../src/cli/buildOutputDirectories';

/* `absolute typecheck` and `absolute prettier` leave the build output
 * alone. Both did it with `**\/build/**`, which leaves alone every
 * directory NAMED `build`: a project's `src/build/` was never checked and
 * never formatted, and both commands said they had passed. */

const matches = (globs: string[], file: string) =>
	globs.some((glob) => new Glob(glob).match(file));

describe('buildOutputGlobs', () => {
	test('with nothing configured, it is the default output directory', () => {
		expect(buildOutputGlobs([{}])).toEqual(['build/**/*']);
	});

	test('source in a directory named build is not build output', () => {
		const globs = buildOutputGlobs([{}]);

		expect(matches(globs, 'build/react/Home.abc123.js')).toBe(true);
		expect(matches(globs, 'src/build/compile.ts')).toBe(false);
		expect(matches(globs, 'tests/unit/build/compile.test.ts')).toBe(false);
	});

	test('a configured directory replaces the default', () => {
		const globs = buildOutputGlobs([{ buildDirectory: 'out/site' }]);

		expect(globs).toEqual(['out/site/**/*']);
		expect(matches(globs, 'out/site/index.html')).toBe(true);
		expect(matches(globs, 'build/helpers.ts')).toBe(false);
	});

	test('a workspace gets one per service, without repeats', () => {
		expect(
			buildOutputGlobs([
				{ buildDirectory: 'build/api' },
				{ buildDirectory: 'build/web' },
				{ buildDirectory: './build/web' }
			])
		).toEqual(['build/api/**/*', 'build/web/**/*']);
	});
});

describe('loadBuildOutputGlobs', () => {
	const previous = process.env.ABSOLUTE_CONFIG;
	let directory = '';

	afterEach(async () => {
		if (previous === undefined) delete process.env.ABSOLUTE_CONFIG;
		else process.env.ABSOLUTE_CONFIG = previous;
		if (directory) await rm(directory, { force: true, recursive: true });
		directory = '';
	});

	const withConfig = async (body: string) => {
		directory = await mkdtemp(join(tmpdir(), 'absolute-build-output-'));
		const path = join(directory, 'absolute.config.mjs');
		await writeFile(path, body);
		process.env.ABSOLUTE_CONFIG = path;
	};

	test('reads the directory from the project config', async () => {
		await withConfig("export default { buildDirectory: 'out' };\n");

		expect(await loadBuildOutputGlobs()).toEqual(['out/**/*']);
	});

	test('reads each service of a workspace', async () => {
		await withConfig(
			"export default { api: { entry: 'a.ts', buildDirectory: 'build/api' }, web: { entry: 'w.ts', buildDirectory: 'build/web' } };\n"
		);

		expect(await loadBuildOutputGlobs()).toEqual([
			'build/api/**/*',
			'build/web/**/*'
		]);
	});

	test('a missing config has the default', async () => {
		process.env.ABSOLUTE_CONFIG = join(
			tmpdir(),
			'no-such-absolute.config.ts'
		);

		expect(await loadBuildOutputGlobs()).toEqual(['build/**/*']);
	});

	/* Formatting must not stop because the config does. */
	test('a config that does not load has the default', async () => {
		await withConfig("throw new Error('broken config');\n");

		expect(await loadBuildOutputGlobs()).toEqual(['build/**/*']);
	});
});
