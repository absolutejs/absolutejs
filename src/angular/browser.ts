export type {
	AngularPageDefinition,
	AngularPagePropsOf
} from '../../types/angular';
export {
	ABSOLUTE_HTTP_TRANSFER_CACHE_SKIP_HEADER,
	buildAbsoluteHttpTransferCacheOptions
} from './httpTransferCache';
export {
	createDeterministicRandom,
	DETERMINISTIC_NOW,
	DETERMINISTIC_RANDOM,
	DETERMINISTIC_SEED,
	provideDeterministicEnv
} from './deterministicEnv';
export { defineAngularPage } from './page';
export { preserveAcrossHmr } from './preserveAcrossHmr';
export { Island } from './Island.browser';
export { withPendingTask } from './pendingTask';
export { REQUEST, REQUEST_CONTEXT, RESPONSE_INIT } from './requestProviders';
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
