export { Island } from './Island.browser';
export { createTypedIsland } from './createIsland.browser';
export { useIslandStore } from './useIslandStore';
// Identity helpers — safe to import from page modules that run in both
// SSR and browser contexts (both are `(x) => x` at runtime).
export { defineRoutes, defineVueSetupApp } from './defineVuePage';
// Exported from browser too so user setupApp() bodies can call the
// redirect helper unconditionally — it's a pure path-comparison and a
// call to a server-supplied `setRedirect` callback, so it has no SSR-
// only dependencies and is safely a no-op on the client when guarded
// by `ctx.isServer`.
export { applyVueRouterRedirect } from './routerRedirectProviders';
export type {
	VueAutoRouter,
	VueRouteRecord,
	VueRoutes,
	VueSetupApp,
	VueSetupAppContext
} from '../../types/vue';
