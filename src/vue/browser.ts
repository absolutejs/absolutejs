export { Island } from './Island.browser';
export { createTypedIsland } from './createIsland.browser';
export { useIslandStore } from './useIslandStore';
// Identity helpers — safe to import from page modules that run in both
// SSR and browser contexts (both are `(x) => x` at runtime).
export { defineRoutes, defineVueSetupApp } from './defineVuePage';
export type {
	VueAutoRouter,
	VueRouteRecord,
	VueRoutes,
	VueSetupApp,
	VueSetupAppContext
} from '../../types/vue';
