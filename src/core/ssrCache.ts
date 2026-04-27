import type { IslandFramework } from '../../types/island';

const dirtyFrameworks = new Set<IslandFramework>();

export const isSsrCacheDirty = (framework: IslandFramework) =>
	dirtyFrameworks.has(framework);
export const markSsrCacheDirty = (framework: IslandFramework) => {
	dirtyFrameworks.add(framework);
};
