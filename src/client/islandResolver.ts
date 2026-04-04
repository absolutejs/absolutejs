import type { IslandFramework } from '../../types/island';
import {
	getIslandManifestEntries,
	getIslandManifestKey
} from '../core/islandManifest';

export const createIslandManifestResolver = (
	manifest: Record<string, string>
) => {
	const islandManifest = getIslandManifestEntries(manifest);

	return async (framework: IslandFramework, component: string) => {
		const modulePath =
			islandManifest[framework]?.[component] ??
			manifest[getIslandManifestKey(framework, component)];
		if (!modulePath) return undefined;

		const loadedModule = await import(modulePath);

		return loadedModule.default;
	};
};
