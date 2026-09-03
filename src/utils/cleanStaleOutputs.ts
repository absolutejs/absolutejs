import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Glob } from 'bun';

const HASHED_FILE_PATTERN = /\.[a-f0-9]{8,}\.\w+$/;
// Code-splitting outputs are content-addressed too (`chunk-<hash>.js`, no
// `.<hash>.` segment) — a chunk absent from the current build's outputs is
// a leftover from an earlier one and nothing in this build imports it. Only
// the build root qualifies: that is where every client pass (`outdir:
// buildPath`) emits its chunks. Vendor bundles (`react/vendor/`,
// `angular/vendor/server/`, `vendor/`, ...) emit their own chunks into their
// directories and are built outside this pass, so those are never touched.
const ROOT_CHUNK_PATTERN = /^chunk-[a-z0-9]{8,}\.js$/;

const isContentAddressedOutput = (relativePath: string) =>
	HASHED_FILE_PATTERN.test(relativePath) ||
	ROOT_CHUNK_PATTERN.test(relativePath);

export const cleanStaleOutputs = async (
	buildPath: string,
	currentOutputPaths: string[]
) => {
	const currentPaths = new Set(
		currentOutputPaths.map((path) => resolve(path))
	);

	const glob = new Glob('**/*');
	const removals: Promise<void>[] = [];

	for (const relative of glob.scanSync({ cwd: buildPath })) {
		const absolute = resolve(buildPath, relative);
		if (currentPaths.has(absolute)) continue;
		if (!isContentAddressedOutput(relative)) continue;

		removals.push(rm(absolute, { force: true }));
	}

	await Promise.all(removals);
};
