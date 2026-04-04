export { Island } from './Island.browser';
export { createTypedIsland } from './createIsland.browser';

export const renderIsland = async () => {
	throw new Error(
		'renderIsland is server-only. Use it during SSR, not in the browser.'
	);
};
export { IslandStore } from './islandStore';
