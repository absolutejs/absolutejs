export { Island } from './Island.browser';
export { createTypedIsland } from './createIsland.browser';

export const renderIsland = async () => {
	throw new Error(
		'renderIsland is server-only. Use it during SSR, not in the browser.'
	);
};
export { IslandStore } from './islandStore';
export { DeferSlotComponent } from './components/defer-slot.component';
export {
	DeferErrorTemplateDirective,
	DeferFallbackTemplateDirective,
	DeferResolvedTemplateDirective
} from './components/defer-slot-templates.directive';
export { ImageComponent } from './components/image.component';
export { StreamSlotComponent } from './components/stream-slot.component';
