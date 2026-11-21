import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Navigation phase 2 listed HMR after a soft navigation as not verified, and it turns out to work: a test now drives a React page, soft-navigates to a Svelte page and edits that page's source, and the update applies with zero document requests. `window.__HMR_FRAMEWORK__`, which the HMR client is keyed on, reads `svelte` after the swap because the Svelte hydration index re-runs on swap-in, and no second client installs because the index delivers it with `import` and the navigation layer skips module URLs it has already evaluated. Nothing needed changing. It had never been checked because the example app calls `enableNavigation()` nowhere, so no app in the repo did both soft navigation and HMR, and writing one is not free: the dev watcher's hard-deny list includes `.test-builds`, the directory every build integration test puts its fixtures in, so a dev-HMR fixture there gets no rebuild, no WebSocket message and no log line — the test fails as a silent timeout. This one lives in `.hmr-temp/`, and the plan now says why. Vue and Ember emit the HMR client as an inline script a swap would re-execute, with no double-install guard; that is noted for phase 3, which is when those frameworks join.",
	kind: 'internal',
	summary: 'An HMR edit after a soft navigation is verified to apply'
};
