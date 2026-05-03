// Browser entry — same shape as ./index.ts. Components are imported by
// their .svelte path; this entry exposes only the runtime API.

export { goto } from './goto';
export { page } from './page.svelte';
export { pushState, replaceState } from './pushState';

export type {
	ExtractRouteParams,
	GotoOptions,
	LinkPrefetchMode,
	PageState,
	RouterMode
} from '../../../types/svelteRouter';
