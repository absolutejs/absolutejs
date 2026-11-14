/* Dev: island server renders compile each component once and cache the
 * result (and Bun caches the imported module). After an island component
 * changes, the rebuild bumps this generation; each cache compares it on use
 * and starts over when it moved. A global, because the renderer and the
 * rebuild can come from different bundles of the package. */

const readGeneration = () => globalThis.__absoluteIslandServerGeneration ?? 0;

export const bumpIslandServerGeneration = () => {
	globalThis.__absoluteIslandServerGeneration = readGeneration() + 1;
};

/** Runs `reset` the first time it is called after the generation moved. */
export const createIslandGenerationGuard = (reset: () => void) => {
	let seen = readGeneration();

	return () => {
		const current = readGeneration();
		if (current === seen) return current;
		seen = current;
		reset();

		return current;
	};
};
