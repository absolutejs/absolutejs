import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { Glob } from 'bun';

// Removes the outputs an earlier build left behind once the current build has
// written its own. Only files that are provably build outputs are touched;
// anything else in the build directory (copied assets, files the user put
// there, vendor bundles built outside this pass) is left alone. A file the
// current build did not emit is removed when any of these hold:
//
// 1. The previous build recorded it as one of its outputs. Every full build
//    writes its output list to `OUTPUT_RECORD`, so a page that was deleted
//    from the source is cleaned up on the next build. Only production builds
//    act on the record (`pruneRecorded`): a dev full build skips the pages
//    nobody has opened yet, so its output list is not the whole app. It adds
//    its outputs to the record instead.
// 2. It is an older version of a file this build emitted: same directory,
//    same name and extension, a different content hash. Bun's `[hash]` is 8+
//    characters of base36 (`Page.k3x9a0bq.js`), not hex, so this covers the
//    first build after an upgrade, before any record exists.
// 3. It is a code-splitting chunk (`chunk-<hash>.js`, no `.<hash>.` segment)
//    in the build root, where every client pass emits its chunks, or in a
//    directory this build emitted chunks into (React Server Components put
//    theirs in `react/rsc/`). Vendor bundles (`react/vendor/`, `vendor/`,
//    `angular/vendor/server/`) emit their own chunks outside this pass and
//    are never touched.
//
// A `.br` or `.gz` copy goes with the file it compresses.
//
// Dot-directories are scanned too: the Svelte and Vue hydration bundles land
// in `<build>/.absolutejs/generated/`.

// At the build root, beside `server-outputs.json`, and kept off the static
// routes the same way (`serverOnlyStaticFiles.ts`). Not under `.absolutejs/`,
// which production serves as hydration bundles.
export const OUTPUT_RECORD = 'build-outputs.json';

// `Name.<hash>.ext`, also `.ext.map` sourcemaps and Vue's `.js.spa.json`
// side manifests. The greedy name keeps the hash the last 8+ char segment.
const HASHED_NAME_PATTERN =
	/^(.+)\.[a-z0-9]{8,}(\.[a-z0-9]+(?:\.map|\.spa\.json)?)$/;
const CHUNK_PATTERN = /^chunk-[a-z0-9]{8,}\.js$/;
const COMPRESSED_COPY_PATTERN = /^(.+)\.(?:br|gz)$/;

const toRelative = (buildPath: string, path: string) =>
	relative(buildPath, resolve(path)).split(sep).join('/');

const hashedIdentity = (relativePath: string) => {
	const slash = relativePath.lastIndexOf('/');
	const dir = relativePath.slice(0, slash + 1);
	const match = relativePath.slice(slash + 1).match(HASHED_NAME_PATTERN);

	return match ? `${dir}${match[1]}${match[2]}` : null;
};

const chunkDirectory = (relativePath: string) => {
	const slash = relativePath.lastIndexOf('/');
	if (!CHUNK_PATTERN.test(relativePath.slice(slash + 1))) return null;

	return relativePath.slice(0, slash + 1);
};

const readOutputRecord = (buildPath: string) => {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(buildPath, OUTPUT_RECORD), 'utf-8')
		);

		return Array.isArray(parsed)
			? new Set(
					parsed.filter(
						(entry): entry is string => typeof entry === 'string'
					)
				)
			: new Set<string>();
	} catch {
		return new Set<string>();
	}
};

const writeOutputRecord = (buildPath: string, outputs: Set<string>) => {
	const file = join(buildPath, OUTPUT_RECORD);
	try {
		mkdirSync(buildPath, { recursive: true });
		writeFileSync(file, JSON.stringify([...outputs].sort()));
	} catch {
		// An unwritable build directory only costs the deleted-page cleanup.
	}
};

const scanBuildDirectory = (buildPath: string) => {
	try {
		return [...new Glob('**/*').scanSync({ cwd: buildPath, dot: true })];
	} catch {
		return [];
	}
};

export const cleanStaleOutputs = async (
	buildPath: string,
	currentOutputPaths: string[],
	{ pruneRecorded = true }: { pruneRecorded?: boolean } = {}
) => {
	const current = new Set(
		currentOutputPaths
			.map((path) => toRelative(buildPath, path))
			.filter((path) => !path.startsWith('..'))
	);
	const previous = readOutputRecord(buildPath);
	const currentIdentities = new Set<string>();
	const chunkDirectories = new Set<string>(['']);
	for (const path of current) {
		const identity = hashedIdentity(path);
		if (identity) currentIdentities.add(identity);
		const directory = chunkDirectory(path);
		if (directory !== null) chunkDirectories.add(directory);
	}

	const isStale = (path: string): boolean => {
		if (current.has(path)) return false;
		// `.br` / `.gz` copies (`precompressed.ts`) follow the file they
		// compress; the build writes fresh copies of the current outputs.
		const compressed = path.match(COMPRESSED_COPY_PATTERN);
		if (compressed?.[1]) return isStale(compressed[1]);
		if (pruneRecorded && previous.has(path)) return true;
		const identity = hashedIdentity(path);
		if (identity && currentIdentities.has(identity)) return true;
		const directory = chunkDirectory(path);

		return directory !== null && chunkDirectories.has(directory);
	};

	const removals = scanBuildDirectory(buildPath)
		.map((path) => path.split(sep).join('/'))
		.filter(isStale)
		.map((path) =>
			rm(join(buildPath, path), { force: true }).catch(() => {
				// A read-only build directory keeps its old files.
			})
		);

	await Promise.all(removals);
	// A dev build keeps what it did not prune on the record, so the next
	// production build still removes it.
	const record = pruneRecorded
		? current
		: new Set(
				[...previous]
					.filter((path) => existsSync(join(buildPath, path)))
					.concat([...current])
			);
	writeOutputRecord(buildPath, record);
};
