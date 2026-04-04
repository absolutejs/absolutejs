export { default as Island } from './components/Island.svelte';
export { createTypedIsland } from './createIsland.browser';
export { resolveIslandHtml } from './resolveIslandHtml.browser';
export { useIslandStore } from './islandStore';

export const renderIsland = async () => {
	throw new Error(
		'renderIsland is server-only. Use it during SSR, not in the browser.'
	);
};
