export { getI18n, setI18n } from './i18n';
export { formAction } from './formAction';
export { createTypedIsland } from './createIsland.browser';
export {
	absoluteIslandSlot,
	resolveIslandHtml
} from './resolveIslandHtml.browser';
export { useIslandStore } from './islandStore';

export const renderIsland = async () => {
	throw new Error(
		'renderIsland is server-only. Use it during SSR, not in the browser.'
	);
};
