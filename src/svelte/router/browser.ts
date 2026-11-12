// Browser entry — same shape as ./index.ts. Components are imported by
// their .svelte path; this entry exposes only the runtime API.

export { goto } from './goto';
export { NavigationRedirect, redirect } from './guards';
export { beforeNavigate, preloadRoute } from './navigation';
export { page } from './page.svelte';
export { pushState, replaceState } from './pushState';

export type {
	ExtractRouteParams,
	GotoOptions,
	LazyRouteLoader,
	LazyRouteModule,
	LinkPrefetchMode,
	NavigationContext,
	NavigationOutcome,
	NavigationRedirectTarget,
	NavigationType,
	PageState,
	RouteGuard,
	RouteGuardResult,
	RouterMode
} from '../../../types/svelteRouter';
