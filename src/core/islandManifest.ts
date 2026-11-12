import type { IslandFramework } from '../../types/island';

/** Manifest key the server injects as the islands bootstrap script on any
 *  page with island markers. The build records the configured
 *  `islands.bootstrap` (whatever its file name) or a generated default under
 *  it — see build/islandBootstrap.ts. */
export const ISLAND_BOOTSTRAP_MANIFEST_KEY = 'AbsoluteIslandBootstrap';

/** Key a bootstrap file named `bootstrapClient.*` gets naturally, which is
 *  all the server used to look for. Still honored for manifests built
 *  before the reserved key existed. */
export const LEGACY_ISLAND_BOOTSTRAP_MANIFEST_KEY = 'BootstrapClient';

const toIslandFrameworkSegment = (framework: IslandFramework) =>
	framework[0]?.toUpperCase() + framework.slice(1);

const collectFrameworkIslands = (
	manifest: Record<string, string>,
	prefix: string
) => {
	const entries: Record<string, string> = {};
	let found = false;

	for (const [key, value] of Object.entries(manifest)) {
		if (!key.startsWith(prefix)) continue;

		const component = key.slice(prefix.length);
		if (!component) continue;

		entries[component] = value;
		found = true;
	}

	return found ? entries : undefined;
};

export const getIslandBootstrapPath = (manifest: Record<string, string>) =>
	manifest[ISLAND_BOOTSTRAP_MANIFEST_KEY] ??
	manifest[LEGACY_ISLAND_BOOTSTRAP_MANIFEST_KEY];
export const getIslandManifestEntries = (manifest: Record<string, string>) => {
	const islands: Partial<Record<IslandFramework, Record<string, string>>> =
		{};
	const frameworks: IslandFramework[] = ['react', 'svelte', 'vue', 'angular'];

	for (const framework of frameworks) {
		const prefix = `Island${toIslandFrameworkSegment(framework)}`;
		const entries = collectFrameworkIslands(manifest, prefix);
		if (entries) islands[framework] = entries;
	}

	return islands;
};
export const getIslandManifestKey = (
	framework: IslandFramework,
	component: string
) => `Island${toIslandFrameworkSegment(framework)}${component}`;
