import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Svelte to Vue and back is now covered, the first verified pair in the cross-framework navigation matrix that does not involve React. It is worth its own test rather than being assumed from the React rows: each framework's client pass bundles its own copy of the client runtime, so the copy that installs the navigation layer and the copy that hydrated the page being torn down can be different modules, and that is where this area's real bugs have been — the prefetch cache was one store per bundle copy, and the island disposer registry had to move to a shared key for a React page's layer to see a Svelte island's disposer. The trip is driven from both entry points, because `enableNavigation()` is idempotent and the first caller wins, so which copy owns the layer depends on which page the session started at, and the teardown path differs per framework. No framework change was needed. The first draft of the test was wrong in a way worth recording: `window` survives a soft navigation by design, so a hydration flag set by the first visit is still true when the second starts and waiting on it returns immediately, which asserted the URL before the navigation had finished.",
	kind: 'internal',
	summary: 'Svelte to Vue is a verified pair in the navigation matrix'
};
