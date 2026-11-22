/* The note `absolute typecheck` prints when the project's editor can't see
 * the generated declarations — the manifest keys
 * (.absolutejs/types/manifest.d.ts) and the route map
 * (.absolutejs/types/routes.d.ts) — or null when tsconfig.json already puts
 * them in the program.
 *
 * Every declaration the command WROTE is named, because an editor that
 * cannot see one of them does not report what this command reports:
 * `asset(manifest, 'Abuot')` and `route('/abuot')` are errors here and
 * silently fine there. They share a directory, so one verdict covers them
 * all.
 *
 * Only the ones that exist, though: a `files` entry for a file that is not
 * there is error TS6053, and the route map is absent in any project
 * without file routes. That is the same trap the `include`-versus-`files`
 * advice below exists for, one level up.
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
 *  `exclude`) already lists every declaration in `declarations`, or when
 *  there are none. */
export const manifestKeysEditorHint = (
	config: TsconfigLists,
	declarations: readonly string[]
) => {
	const paths = [...new Set(declarations)].sort();
	/* One verdict covers them all: they share a directory, so whatever
	 * `include`/`exclude` says about the first says it about the rest. */
	const [path] = paths;
	if (path === undefined) return null;
	const files = toEntries(config.files);
	if (paths.every((entry) => files.includes(entry))) return null;
	const excluded = toEntries(config.exclude).some((pattern) =>
		patternMatches(pattern, path)
	);
	const included = toEntries(config.include).some((pattern) =>
		patternMatches(pattern, path)
	);
	if (included && !excluded) return null;
	const listed = paths.map((entry) => `"${entry}"`).join(', ');
	const where = excluded
		? `to "files" in tsconfig.json ("exclude" removes them from "include", but not from "files"): "files": [${listed}]`
		: `to "include" in tsconfig.json`;

	return `\x1b[33mnote\x1b[0m asset(manifest, key) keys and route() paths are checked by this command. For the same checks in your editor, add ${listed} ${where}.`;
};
