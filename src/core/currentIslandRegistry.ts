import type { IslandRegistryInput } from '../../types/island';

declare global {
	var __absoluteIslandRegistry: IslandRegistryInput | undefined;
}

export const getCurrentIslandRegistry = () =>
	globalThis.__absoluteIslandRegistry;
export const requireCurrentIslandRegistry = () => {
	const registry = globalThis.__absoluteIslandRegistry;
	if (!registry) {
		throw new Error(
			'No island registry is active. Configure `islands.registry` in absolute.config.ts before rendering <Island />.'
		);
	}

	return registry;
};
export const setCurrentIslandRegistry = (
	registry: IslandRegistryInput | undefined
) => {
	globalThis.__absoluteIslandRegistry = registry;
};
