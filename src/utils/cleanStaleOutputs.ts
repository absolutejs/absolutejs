import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Glob } from 'bun';

const HASHED_FILE_PATTERN = /\.[a-f0-9]{8,}\.\w+$/;

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
		if (!HASHED_FILE_PATTERN.test(relative)) continue;

		removals.push(rm(absolute, { force: true }));
	}

	await Promise.all(removals);
};
