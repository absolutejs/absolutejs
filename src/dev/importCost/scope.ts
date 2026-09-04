/* Which modules can be instrumented at all.
 *
 * Bun 1.4 has no CommonJS loader for plugins: whatever an `onLoad` hook
 * returns is parsed as an ES module, and a hook that matches a file *must*
 * return contents — there is no way to hand a file back to Bun untouched.
 * Instrumenting a CommonJS dependency therefore breaks it outright
 * (`Missing 'default' export in module …`), so CommonJS has to be excluded by
 * path, before Bun ever asks for the contents.
 *
 * The rule is Node's own, which is the one package authors write to: the
 * nearest `package.json` decides, and `.mjs` is ESM wherever it lives. That
 * nearest-manifest part matters — `entities` declares `"type": "module"` at
 * its root and ships a CommonJS build under `dist/commonjs/` with its own
 * manifest, and instrumenting that build takes Vue's compiler down.
 *
 * So the scan records two things: the directories that begin an ESM region,
 * and the directories inside them that switch back to CommonJS (a nested
 * manifest, or a nested `node_modules`, whose contents are somebody else's
 * package). What is left out — CommonJS dependencies and ESM-in-disguise
 * `.js` packages — is not mis-attributed: it evaluates outside every
 * instrumented module's body, so the replay charges it to the process root
 * and the report prints it as unattributed rather than crediting it to one of
 * the entry's imports. */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type EsmRegions = {
	/** Directories inside an ESM region that switch back to CommonJS. */
	cjsPrefixes: string[];
	/** Directories whose subtree is ESM. */
	esmPrefixes: string[];
};

const NESTED_SCAN_DEPTH = 6;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const SEPARATOR = '[\\\\/]';
const OUTSIDE_MODULES = `(?!.*${SEPARATOR}node_modules${SEPARATOR}).*`;
const SOURCE_EXTENSION = '\\.m?[jt]sx?$';
const ANY_MJS = '\\.mjs$';

const manifestType = (directory: string) => {
	try {
		const manifest: unknown = JSON.parse(
			readFileSync(join(directory, 'package.json'), 'utf8')
		);

		return Reflect.get(Object(manifest), 'type') === 'module'
			? 'module'
			: 'commonjs';
	} catch {
		return null;
	}
};

const subdirectories = (directory: string) => {
	try {
		return readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
};

/** Walks an ESM package for the manifests that switch its subtree back. */
const findCommonJsIslands = (
	directory: string,
	found: string[],
	depth: number
) => {
	if (depth > NESTED_SCAN_DEPTH) return;
	for (const name of subdirectories(directory)) {
		visitIsland(join(directory, name), name, found, depth);
	}
};

const visitIsland = (
	directory: string,
	name: string,
	found: string[],
	depth: number
) => {
	// A nested `node_modules` holds somebody else's packages, which this
	// package's manifest says nothing about.
	if (name === 'node_modules' || manifestType(directory) === 'commonjs') {
		found.push(directory);

		return;
	}
	findCommonJsIslands(directory, found, depth + 1);
};

const recordPackage = (directory: string, regions: EsmRegions) => {
	if (manifestType(directory) !== 'module') return;
	regions.esmPrefixes.push(directory);
	findCommonJsIslands(directory, regions.cjsPrefixes, 0);
};

const scanEntry = (modulesRoot: string, name: string, regions: EsmRegions) => {
	if (name.startsWith('.')) return;
	if (!name.startsWith('@')) {
		recordPackage(join(modulesRoot, name), regions);

		return;
	}
	for (const scoped of subdirectories(join(modulesRoot, name))) {
		recordPackage(join(modulesRoot, name, scoped), regions);
	}
};

const scanPackages = (modulesRoot: string, regions: EsmRegions) => {
	for (const name of subdirectories(modulesRoot)) {
		scanEntry(modulesRoot, name, regions);
	}
};

/** The ESM regions of an app's installed dependencies. */
export const esmRegions = (root: string) => {
	const regions: EsmRegions = { cjsPrefixes: [], esmPrefixes: [] };
	const modulesRoot = join(root, 'node_modules');
	try {
		statSync(modulesRoot);
	} catch {
		return regions;
	}
	// Resolve once so a symlinked `node_modules` (a scratch copy of an app,
	// a pnpm store) still produces prefixes that match the paths Bun reports.
	scanPackages(realpathSync(modulesRoot), regions);

	return regions;
};

const alternation = (prefixes: readonly string[]) =>
	prefixes.map((prefix) => prefix.replace(REGEX_SPECIAL, '\\$&')).join('|');

/** The `onLoad` filter: app sources, `.mjs`, and files in ESM regions. */
export const instrumentableFilter = (regions: EsmRegions) => {
	const inEsmRegion =
		regions.esmPrefixes.length === 0
			? ''
			: `|(?:${alternation(regions.esmPrefixes)}).*`;
	const notCommonJs =
		regions.cjsPrefixes.length === 0
			? ''
			: `(?!(?:${alternation(regions.cjsPrefixes)}))`;

	return new RegExp(
		`^${notCommonJs}(?:${OUTSIDE_MODULES}${inEsmRegion})${SOURCE_EXTENSION}|${ANY_MJS}`
	);
};
