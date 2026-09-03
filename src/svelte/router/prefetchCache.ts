// The prefetch cache used to live here. It is now the framework-neutral
// `src/client/prefetch.ts` (shared with the React and Vue `<Link>`s) —
// this module keeps the Svelte router's public API stable by re-exporting
// the same names from the shared implementation.
export {
	canPrefetch,
	clearPrefetchCache,
	consumePrefetch,
	hasPrefetched,
	observeViewport,
	prefetch,
	preloadModule,
	resolveDefaultPrefetchMode,
	scheduleHoverPrefetch,
	speculate
} from '../../client/prefetch';
