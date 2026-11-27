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
export {
	useFormAction,
	usePageContext,
	usePageData,
	useResource,
	useSubscription,
	useTimers
} from './composables';
export type {
	FormAction,
	Observer,
	Resource,
	ResourceFetcher,
	ResourceMutator,
	ResourceOptions,
	ResourceStart
} from './composables';
export { preserveAcrossHmr } from './preserveAcrossHmr';
export { Island } from './Island.browser';
export { withPendingTask } from './pendingTask';
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
export { CsrfFieldComponent } from './components/csrf-field.component';
export { ABSOLUTE_I18N, type AngularI18n } from './components/i18n.token';
export { TPipe } from './components/t.pipe';
export { ABSOLUTE_I18N_PAYLOAD, injectI18n, provideAbsoluteI18n } from './i18n';
export { StreamSlotComponent } from './components/stream-slot.component';
