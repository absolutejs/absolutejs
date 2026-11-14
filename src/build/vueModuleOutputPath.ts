import {
	dirname,
	isAbsolute,
	join,
	parse,
	relative,
	resolve,
	sep
} from 'node:path';
import { BASE_36_RADIX } from '../constants';

/* Compiled Vue modules are mirrored under `<outputDir>/sources/`, and the
 * client half of that tree is bundled with the generated paths as chunk
 * names and import specifiers. Those paths ship to every browser, so they
 * must never contain the build machine's filesystem layout:
 *
 *   - a file inside the project root mirrors to `sources/<path from root>`;
 *   - a file outside it (a monorepo sibling, a hoisted node_modules package)
 *     mirrors to `sources/_external/<n>/<path>`, where `<n>` is how many
 *     levels above the project root the nearest shared ancestor is, and
 *     `<path>` is the part below that ancestor. Files under the same
 *     ancestor keep their relative layout, so their own relative imports
 *     still resolve;
 *   - a file that shares only the filesystem root with the project (or sits
 *     on another Windows drive) would otherwise keep its whole absolute
 *     path, so it goes to `sources/_external/h-<hash of its directory>/`.
 *
 * Relative imports that cross from one of these regions into another are
 * rewritten with `vueMirrorImport`.
 *
 * Both mirror trees (client and server) share this layout. */

const SOURCES_DIR = 'sources';
const EXTERNAL_DIR = '_external';
const UNRELATED_PREFIX = 'h-';
/* A 64-bit hash is at most 13 base-36 digits. */
const HASH_LENGTH = 13;

const toOutputName = (path: string) => path.replace(/\.(vue|ts)$/, '.js');

const unrelatedMirrorPath = (absolutePath: string) => {
	const directory = dirname(absolutePath);
	const directoryHash = Bun.hash(directory)
		.toString(BASE_36_RADIX)
		.padStart(HASH_LENGTH, '0');

	return join(
		EXTERNAL_DIR,
		`${UNRELATED_PREFIX}${directoryHash}`,
		toOutputName(relative(directory, absolutePath))
	);
};

const sourceMirrorPath = (sourcePath: string, projectRoot: string) => {
	const absolutePath = resolve(sourcePath);
	const root = resolve(projectRoot);
	const fromRoot = relative(root, absolutePath);
	if (isAbsolute(fromRoot)) return unrelatedMirrorPath(absolutePath);
	const segments = fromRoot.split(sep);
	const levelsUp = segments.findIndex((segment) => segment !== '..');
	if (levelsUp === 0) return toOutputName(fromRoot);
	// Sharing only the filesystem root, the path below the shared ancestor
	// would be the file's whole absolute path.
	const sharedAncestor = join(root, ...segments.slice(0, levelsUp));
	if (levelsUp < 0 || parse(sharedAncestor).root === sharedAncestor)
		return unrelatedMirrorPath(absolutePath);

	return join(
		EXTERNAL_DIR,
		String(levelsUp),
		toOutputName(segments.slice(levelsUp).join(sep))
	);
};

export const vueModuleOutputPath = (
	outputDir: string,
	sourcePath: string,
	projectRoot = process.cwd()
) => join(outputDir, SOURCES_DIR, sourceMirrorPath(sourcePath, projectRoot));

/** The specifier a compiled module at `importerSource` uses to import the
 *  compiled `targetSource`. Inside one region this is the original relative
 *  path; across regions it follows the generated layout instead. */
export const vueRelativeOutputImport = (
	importerSource: string,
	targetSource: string,
	projectRoot = process.cwd()
) => {
	const specifier = relative(
		dirname(sourceMirrorPath(importerSource, projectRoot)),
		sourceMirrorPath(targetSource, projectRoot)
	).replace(/\\/g, '/');

	return specifier.startsWith('../') ? specifier : `./${specifier}`;
};

/* The mirror keeps the source layout inside one region: the project root,
 * one `_external/<n>` ancestor, or one hashed directory. */
const mirrorRegion = (sourcePath: string, projectRoot: string) => {
	const [first, second] = sourceMirrorPath(sourcePath, projectRoot).split(
		sep
	);

	return first === EXTERNAL_DIR ? `${EXTERNAL_DIR}/${second}` : '';
};

/** `specifier` as written in `importerSource`, which resolves to
 *  `targetSource`, adjusted for the generated mirror: unchanged within one
 *  region, re-derived from the generated layout across regions. */
export const vueMirrorImport = (
	importerSource: string,
	specifier: string,
	targetSource: string,
	projectRoot = process.cwd()
) =>
	mirrorRegion(importerSource, projectRoot) ===
	mirrorRegion(targetSource, projectRoot)
		? specifier
		: vueRelativeOutputImport(importerSource, targetSource, projectRoot);

const isDecimal = (value: string) => /^\d+$/.test(value);

/** Reverse the generated mirror for composable hot-reload module identities. */
export const vueModuleSourcePath = (
	outputDir: string,
	outputPath: string,
	projectRoot = process.cwd()
) => {
	const within = relative(outputDir, outputPath);
	if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
		return null;
	const [namespace, ...parts] = within.split(sep);
	if (namespace !== SOURCES_DIR || !parts.length) return null;
	if (parts.includes('..')) return null;
	if (parts[0] !== EXTERNAL_DIR) return join(resolve(projectRoot), ...parts);
	const [, levels, ...rest] = parts;
	if (!levels || !isDecimal(levels) || !rest.length) return null;
	const levelsUp = Number(levels);
	if (levelsUp < 1) return null;

	return join(
		resolve(projectRoot),
		...Array.from({ length: levelsUp }, () => '..'),
		...rest
	);
};
