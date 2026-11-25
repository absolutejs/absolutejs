import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

/* Whether a bare import is one of the app's own workspace packages: one that
 * resolves to source outside any node_modules (Bun links a workspace package
 * straight to its folder). That code is the app's, not a library's, so the
 * dev server serves and hot-reloads it like the app's files instead of
 * freezing it into a vendor chunk. Anything that does not resolve is not. */
const NODE_MODULES_SEGMENT = `${sep}node_modules${sep}`;
const verdicts = new Map<string, boolean>();

const resolvesOutsideNodeModules = (specifier: string, projectRoot: string) => {
	try {
		const resolved = realpathSync(Bun.resolveSync(specifier, projectRoot));

		return !resolved.includes(NODE_MODULES_SEGMENT);
	} catch {
		return false;
	}
};

const readManifest = (projectRoot: string) => {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(projectRoot, 'package.json'), 'utf-8')
		);

		return typeof parsed === 'object' && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
};

const linkedPackageDir = (projectRoot: string, name: string) => {
	try {
		return realpathSync(join(projectRoot, 'node_modules', name));
	} catch {
		// Not installed: nothing to watch.
		return undefined;
	}
};

export const isWorkspacePackageSpecifier = (
	specifier: string,
	projectRoot = process.cwd()
) => {
	const key = `${projectRoot}\u0000${specifier}`;
	const known = verdicts.get(key);
	if (known !== undefined) return known;
	const verdict = resolvesOutsideNodeModules(specifier, projectRoot);
	verdicts.set(key, verdict);

	return verdict;
};

/* The source folders of the app's own workspace packages: every dependency
 * in its package.json whose link resolves outside node_modules. The dev
 * watcher adds them, so editing a shared package reloads the page the way
 * editing the app does -- what `dev.watchDirs: ['../core']` was written by
 * hand to do. */
export const workspacePackageDirs = (projectRoot = process.cwd()) => {
	const manifest = readManifest(projectRoot);
	if (manifest === null) return [];
	const names = [
		'dependencies',
		'devDependencies',
		'optionalDependencies'
	].flatMap((field) => {
		const deps: unknown = Reflect.get(manifest, field);

		return deps && typeof deps === 'object' ? Object.keys(deps) : [];
	});
	const dirs = new Set<string>();
	for (const name of names) {
		const linked = linkedPackageDir(projectRoot, name);
		if (
			linked !== undefined &&
			!`${linked}${sep}`.includes(NODE_MODULES_SEGMENT)
		)
			dirs.add(linked);
	}

	return [...dirs];
};
