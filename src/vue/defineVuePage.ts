import type { VueRoutes, VueSetupApp } from '../../types/vue';

/** Identity helper that types a Vue page's `setupApp` export without
 *  forcing the user to `import type { VueSetupApp }` every time. Use as
 *  `export const setupApp = defineVueSetupApp(async (app, ctx) => { ... });` */
export const defineRoutes = <T extends VueRoutes>(routes: T) => routes;
export const defineVueSetupApp = (hook: VueSetupApp) => hook;
