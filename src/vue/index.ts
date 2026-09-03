export { handleVuePageRequest } from './pageHandler';
export { applyVueRouterRedirect } from './routerRedirectProviders';
export { defineRoutes, defineVueSetupApp } from './defineVuePage';
export type {
	VueAutoRouter,
	VueRouteRecord,
	VueRoutes,
	VueSetupApp,
	VueSetupAppContext
} from '../../types/vue';
export { Island } from './Island';
export { createTypedIsland } from './createIsland';
export { useIslandStore } from './useIslandStore';
export {
	captureSsrTextBaselines,
	prepareBrowserTranslationHydration,
	preserveBrowserTranslation
} from './browserTranslation';
export { Image } from './components/Image';
export { StreamSlot, SuspenseSlot } from './components';
export { useResource } from './useResource';
export { Link } from './router/Link';
export { usePrefetch } from './usePrefetch';
export type { UsePrefetchOptions } from './usePrefetch';
export type { PrefetchKind, PrefetchMode } from '../../types/prefetch';
export {
	ABSOLUTE_TELEPORT_TARGET,
	ABSOLUTE_TELEPORT_TARGET_ID
} from './teleports';
export type {
	Resource,
	ResourceFetcher,
	ResourceMutator,
	ResourceOptions,
	ResourceStart
} from './useResource';
