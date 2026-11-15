import { describe, expect, test } from 'bun:test';
import { manifestKeysEditorHint } from '../../../src/cli/scripts/manifestKeysEditorHint';

/* The typecheck note told every project to add the manifest-key
 * declaration to `include`. Scaffolds made before beta.180 exclude
 * ".absolutejs", and `exclude` wins over `include`, so following the note
 * changed nothing: the editor still never saw the keys. A project that
 * excludes .absolutejs is told to use `files` (which `exclude` doesn't
 * touch), and no note prints once tsconfig.json puts the file in the
 * program. */

const PATH = '.absolutejs/types/manifest.d.ts';

describe('manifestKeysEditorHint', () => {
	test('a tsconfig that excludes .absolutejs is told to use "files"', () => {
		const hint = manifestKeysEditorHint({
			exclude: ['node_modules', 'build', '.absolutejs'],
			include: ['**/*']
		});

		expect(hint).toContain(`"files": ["${PATH}"]`);
		expect(hint).toContain('"exclude" removes it from "include"');
	});

	test('listing it in "include" does not help while .absolutejs is excluded', () => {
		for (const exclude of [
			['.absolutejs'],
			['./.absolutejs/'],
			['.absolutejs/**'],
			['.absolutejs/**/*'],
			['.absolutejs/types']
		]) {
			expect({
				exclude,
				hint: manifestKeysEditorHint({
					exclude,
					include: ['src', PATH]
				})
			}).toEqual({ exclude, hint: expect.stringContaining('"files"') });
		}
	});

	test('no note once "files" lists it', () => {
		for (const files of [[PATH], [`./${PATH}`]])
			expect(
				manifestKeysEditorHint({
					exclude: ['.absolutejs'],
					files,
					include: ['**/*']
				})
			).toBeNull();
	});

	test('no note when "include" covers it and nothing excludes it', () => {
		for (const include of [
			['**/*', PATH],
			['src', `./${PATH}`],
			['.absolutejs/types/*.d.ts'],
			['.absolutejs']
		])
			expect({
				hint: manifestKeysEditorHint({
					exclude: ['node_modules', 'dist'],
					include
				}),
				include
			}).toEqual({ hint: null, include });
	});

	test('without an exclude, it suggests "include"', () => {
		// `**/*` skips dot-directories, so .absolutejs must be named.
		for (const config of [
			{},
			{ include: ['**/*'] },
			{ exclude: ['node_modules'], include: ['src'] }
		]) {
			const hint = manifestKeysEditorHint(config);
			expect(hint).toContain(`add "${PATH}" to "include"`);
			expect(hint).not.toContain('"files"');
		}
	});
});
