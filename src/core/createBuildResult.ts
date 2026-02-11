import type { BuildResult } from '../types';
import { asset as lookupAsset } from './lookup';

export function createBuildResult(
	manifest: Record<string, string>,
	buildDir: string
): BuildResult {
	return {
		manifest,
		buildDir,
		asset: (name: string) => lookupAsset(manifest, name)
	};
}
