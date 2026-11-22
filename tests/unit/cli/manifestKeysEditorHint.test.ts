import { describe, expect, test } from 'bun:test';
import { manifestKeysEditorHint } from '../../../src/cli/scripts/manifestKeysEditorHint';

/* The typecheck note told every project to add the manifest-key
 * declaration to `include`. Scaffolds made before beta.180 exclude
 * ".absolutejs", and `exclude` wins over `include`, so following the note
 * changed nothing: the editor still never saw the keys. A project that
 * excludes .absolutejs is told to use `files` (which `exclude` doesn't
 * touch), and no note prints once tsconfig.json puts the file in the
 * program.
 *
 * Both generated declarations are named now — the manifest keys and the
 * route map — because an editor that sees one and not the other silently
 * accepts exactly what this command rejects. They share a directory, so an
 * `include` pattern covers both at once while a `files` list has to name
 * each. */

const PATH = '.absolutejs/types/manifest.d.ts';
const ROUTES = '.absolutejs/types/routes.d.ts';

/* The declarations the command actually wrote, which is what it passes.
 * Only those are named: a `files` entry for a file that is not there is
 * TS6053, and the route map is absent in any project with no file
 * routes. */
const hint = (config: Parameters<typeof manifestKeysEditorHint>[0]) =>
	manifestKeysEditorHint(config, [PATH, ROUTES]);

describe('manifestKeysEditorHint', () => {
	test('a tsconfig that excludes .absolutejs is told to use "files"', () => {
		const note = hint({
			exclude: ['node_modules', 'build', '.absolutejs'],
			include: ['**/*']
		});

		expect(note).toContain(`"files": ["${PATH}", "${ROUTES}"]`);
		expect(note).toContain('"exclude" removes them from "include"');
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
				hint: hint({ exclude, include: ['src', PATH] })
			}).toEqual({ exclude, hint: expect.stringContaining('"files"') });
		}
	});

	test('no note once "files" lists them', () => {
		for (const files of [
			[PATH, ROUTES],
			[`./${PATH}`, `./${ROUTES}`]
		])
			expect(
				hint({ exclude: ['.absolutejs'], files, include: ['**/*'] })
			).toBeNull();
	});

	/* Half-listed is not listed: the route map would still be invisible,
	 * and `route('/abuot')` silently fine in the editor. */
	test('a "files" list naming only one of them still warns', () => {
		expect(
			hint({
				exclude: ['.absolutejs'],
				files: [PATH],
				include: ['**/*']
			})
		).toContain(ROUTES);
	});

	test('no note when "include" covers it and nothing excludes it', () => {
		for (const include of [
			['**/*', PATH],
			['src', `./${PATH}`],
			['.absolutejs/types/*.d.ts'],
			['.absolutejs']
		])
			expect({
				hint: hint({ exclude: ['node_modules', 'dist'], include }),
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
			const note = hint(config);
			expect(note).toContain(`add "${PATH}", "${ROUTES}" to "include"`);
			expect(note).not.toContain('"files"');
		}
	});

	/* A project with no file routes has no route map to name, and naming
	 * it anyway would be TS6053 in the editor the note is advising. */
	test('names only the declarations it was given', () => {
		const note = manifestKeysEditorHint({ include: ['src'] }, [PATH]);

		expect(note).toContain(`add "${PATH}" to "include"`);
		expect(note).not.toContain(ROUTES);
	});

	test('no note when nothing was written', () => {
		expect(manifestKeysEditorHint({ include: ['src'] }, [])).toBeNull();
	});
});
