import { MANIFEST_KEYS_DECLARATION } from '../../build/manifestKeys';

/* The note `absolute typecheck` prints when the project's editor can't see
 * the generated manifest-key declaration (.absolutejs/types/manifest.d.ts),
 * or null when tsconfig.json already puts it in the program.
 *
 * How tsc builds the program decides the advice: an `exclude` entry drops
 * matching files from `include`, but never from `files`. Scaffolds made
 * before beta.180 exclude ".absolutejs", so for them adding the path to
 * `include` changes nothing; `files` is the entry that works. Without such
 * an exclude, `include` is the better place: a `files` entry for a file that
 * doesn't exist yet (a fresh clone, before any absolute command) is error
 * TS6053, an `include` entry isn't. */

type TsconfigLists = {
	exclude?: unknown;
	files?: unknown;
	include?: unknown;
};

const toEntries = (value: unknown) =>
	Array.isArray(value)
		? value
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) =>
					entry
						.trim()
						.replace(/\\/g, '/')
						.replace(/^(?:\.\/)+/, '')
						.replace(/\/+$/, '')
				)
		: [];

const escapeRegex = (text: string) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/* tsc's wildcard rules: `*` and `?` match within one path segment, a `**` segment
 * any number of directories, and a wildcard never matches a name that starts
 * with a dot (".absolutejs" must be named). A pattern also covers everything
 * under a directory it matches. */
const patternMatches = (pattern: string, path: string) => {
	const source = pattern
		.split('/')
		.map((segment) => {
			if (segment === '**') return '(?:[^./][^/]*/)*';
			const body = escapeRegex(segment)
				.replace(/\*/g, '[^/]*')
				.replace(/\?/g, '[^/]');

			return /^[*?]/.test(segment) ? `(?!\\.)${body}/` : `${body}/`;
		})
		.join('');

	return new RegExp(`^${source}`).test(`${path}/`);
};

/** The note, or null when tsconfig.json (its `include`, `files` and
 *  `exclude`) already lists the declaration. */
export const manifestKeysEditorHint = (config: TsconfigLists) => {
	const path = MANIFEST_KEYS_DECLARATION;
	const files = toEntries(config.files);
	if (files.includes(path)) return null;
	const excluded = toEntries(config.exclude).some((pattern) =>
		patternMatches(pattern, path)
	);
	const included = toEntries(config.include).some((pattern) =>
		patternMatches(pattern, path)
	);
	if (included && !excluded) return null;
	const where = excluded
		? `to "files" in tsconfig.json ("exclude" removes it from "include", but not from "files"): "files": ["${path}"]`
		: `to "include" in tsconfig.json`;

	return `\x1b[33mnote\x1b[0m asset(manifest, key) keys are checked by this command. For the same check in your editor, add "${path}" ${where}.`;
};
