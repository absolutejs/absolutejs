import { relative, resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';
import { buildReactServerComponentsPass } from '../build/buildReactServerComponents';
import { normalizePath } from '../utils/normalizePath';
import { logError, logHmrUpdate } from '../utils/logger';
import { populateAssetStore } from './assetStore';
import type { HMRState } from './clientManager';

const toError = (error: unknown) =>
	error instanceof Error ? error : new Error(String(error));

const runPass = async (state: HMRState, directory: string) => {
	const { buildDir } = state.resolvedPaths;
	const result = await buildReactServerComponentsPass({
		buildPath: buildDir,
		directory,
		incrementalFiles: undefined,
		isDev: true,
		projectRoot: process.cwd()
	});
	if (!result) return;
	if (!result.success) {
		throw new Error(result.logs.map((log) => log.message).join('\n'));
	}
	Object.assign(state.manifest, result.manifest);
	await populateAssetStore(state.assetStore, result.manifest, buildDir);
};

/* Dev rebuild for an edit under `reactServerComponentsDirectory`
 * (docs/REACT_SERVER_COMPONENTS_PLAN.md, Phase 1). The `.tsx` files there
 * would otherwise take the classic React fast path, which never rebuilds the
 * react-server bundles. Re-runs just the RSC pass and swaps the manifest
 * entries in place; the next request (a browser reload) renders the edit.
 * Pushing the update to open pages is Phase 3. Returns whether it handled
 * the file. */
export const rebuildReactServerComponents = async (
	state: HMRState,
	config: BuildConfig,
	filePath: string,
	currentHash: number
) => {
	const directory = config.reactServerComponentsDirectory;
	if (!directory) return false;
	const absolutePath = normalizePath(resolve(filePath));
	if (!absolutePath.startsWith(`${normalizePath(resolve(directory))}/`))
		return false;

	state.fileHashes.set(absolutePath, currentHash);
	const startedAt = performance.now();
	try {
		await runPass(state, directory);
		logHmrUpdate(
			relative(process.cwd(), filePath),
			'react-server',
			Math.round(performance.now() - startedAt)
		);
	} catch (error) {
		logError('React Server Components build failed', toError(error));
	}

	return true;
};
