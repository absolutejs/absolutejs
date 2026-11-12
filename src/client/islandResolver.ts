import type { IslandFramework } from '../../types/island';
import {
	getIslandManifestEntries,
	getIslandManifestKey
} from '../core/islandManifest';

const isStringRecord = (value: unknown): value is Record<string, string> =>
	typeof value === 'object' &&
	value !== null &&
	Object.values(value).every((entry) => typeof entry === 'string');

/** The manifest the server injects as `window.__ABSOLUTE_MANIFEST__` on any
 *  page with islands (core/islandPageContext.ts). */
const readInjectedManifest = () => {
	const injected: unknown = Reflect.get(globalThis, '__ABSOLUTE_MANIFEST__');

	return isStringRecord(injected) ? injected : {};
};

/** Resolves island components from the build manifest's per-island chunks.
 *  Defaults to the manifest the server injected into the page. */
export const createIslandManifestResolver = (
	manifest: Record<string, string> = readInjectedManifest()
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
