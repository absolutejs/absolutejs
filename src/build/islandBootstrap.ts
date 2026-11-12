import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import type { BuildArtifact } from 'bun';
import { normalizePath } from '../utils/normalizePath';

/* The islands bootstrap is the browser script that calls `startIslands` on
 * any page whose HTML carries island markers. The server injects whatever
 * the manifest maps `ISLAND_BOOTSTRAP_MANIFEST_KEY` to (see
 * core/islandPageContext.ts), so the build always records the bootstrap
 * under that key:
 *   - `islands.bootstrap` configured → that file's client output, whatever
 *     the file is called;
 *   - only `islands.registry` configured → a generated default bootstrap
 *     that resolves every island from the manifest. Each registry entry is
 *     already built as its own lazily-imported chunk (`Island<Fw><Name>`),
 *     so the default never bundles a component a page doesn't use. */

/** Base name of the generated default bootstrap. Its natural manifest key
 *  (the PascalCased name) IS the reserved key, so no alias is needed and no
 *  second key is created (asserted in tests). */
export const DEFAULT_ISLAND_BOOTSTRAP_NAME = 'absoluteIslandBootstrap';

export const DEFAULT_ISLAND_BOOTSTRAP_SOURCE = `import {
	createIslandManifestResolver,
	startIslands
} from '@absolutejs/absolute/client';

startIslands({
	registry: {},
	resolveComponent: createIslandManifestResolver()
});
`;

/** Writes the default bootstrap into the island-entry root (the island
 *  client pass's `root`), so it builds to `<build>/islands/` beside the
 *  island chunks. Returns the entry path. */
export const writeDefaultIslandBootstrap = (islandEntriesRoot: string) => {
	const entryPath = join(
		islandEntriesRoot,
		'islands',
		`${DEFAULT_ISLAND_BOOTSTRAP_NAME}.js`
	);
	mkdirSync(dirname(entryPath), { recursive: true });
	writeFileSync(entryPath, DEFAULT_ISLAND_BOOTSTRAP_SOURCE);

	return entryPath;
};

const artifactStem = (artifact: Pick<BuildArtifact, 'hash' | 'path'>) => {
	const fileName = basename(artifact.path);
	const stem = fileName.slice(0, fileName.length - extname(fileName).length);
	const hashSuffix = artifact.hash ? `.${artifact.hash}` : '';

	return hashSuffix && stem.endsWith(hashSuffix)
		? stem.slice(0, stem.length - hashSuffix.length)
		: stem;
};

/** Web path of a configured bootstrap's client output: the entry-point
 *  artifact Bun wrote for `bootstrapPath` under `[dir]/[name].[hash].js`,
 *  with `[dir]` relative to the pass's `root`. Matched by name (and, when the
 *  pass root is known, directory), not by manifest key, because the key
 *  depends on the file name. */
export type BootstrapOutputLookup = {
	bootstrapPath: string;
	buildPath: string;
	outputs: Pick<BuildArtifact, 'hash' | 'kind' | 'path'>[];
	passRoot: string | undefined;
};

export const findBootstrapOutputPath = ({
	bootstrapPath,
	buildPath,
	outputs,
	passRoot
}: BootstrapOutputLookup) => {
	const expectedDir =
		passRoot === undefined
			? undefined
			: normalizePath(
					join(buildPath, relative(passRoot, dirname(bootstrapPath)))
				);
	const expectedStem = basename(bootstrapPath, extname(bootstrapPath));
	const artifact = outputs.find(
		(output) =>
			output.kind === 'entry-point' &&
			extname(output.path) === '.js' &&
			(expectedDir === undefined ||
				normalizePath(dirname(output.path)) === expectedDir) &&
			artifactStem(output) === expectedStem
	);
	if (!artifact) return undefined;
	const webPath = normalizePath(relative(buildPath, artifact.path));

	return `/${webPath}`;
};
