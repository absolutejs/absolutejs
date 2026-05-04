import type { VueRoutes, VueSetupApp } from '../../types/vue';

/** Identity helper that types a Vue page's `setupApp` export without
 *  forcing the user to `import type { VueSetupApp }` every time. Use as
 *  `export const setupApp = defineVueSetupApp(async (app, ctx) => { ... });` */
export const defineVueSetupApp = (hook: VueSetupApp) => hook;

/** Identity helper that signals — to humans and to TypeScript — that a
 *  Vue page's `routes` export is the input to AbsoluteJS's auto-generated
 *  vue-router. Without this, `export const routes = [...]` reads as an
 *  ordinary const that nobody references locally; the import + call make
 *  the contract explicit (mirroring Vue's `defineProps` convention).
 *
 *  At runtime this is identity (`(routes) => routes`); the actual
 *  router-creation code lives in the compile-time transform applied to
 *  the page's `<script>` block. Use as
 *  `export const routes = defineRoutes([{ path: '/foo', component: Foo }]);` */
export const defineRoutes = <T extends VueRoutes>(routes: T) => routes;
