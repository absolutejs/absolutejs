// Svelte components are imported by their .svelte path, not from this entry:
//   import Router from '@absolutejs/absolute/svelte/router/Router.svelte';
//   import Route from '@absolutejs/absolute/svelte/router/Route.svelte';
//   import Link from '@absolutejs/absolute/svelte/router/Link.svelte';
//
// This entry only re-exports the non-component runtime API (programmatic
// navigation, reactive state, shallow routing). It mirrors the existing
// `@absolutejs/absolute/svelte/components/*.svelte` convention used by
// the framework's other Svelte components (Island, Image, StreamSlot,
// etc.) so user .svelte files can import the components directly via
// AbsoluteJS's Svelte compile pipeline.

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
