import type { IslandFramework } from '../../types/island';

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
