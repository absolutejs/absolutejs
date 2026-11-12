import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Islands on HTML and HTMX pages server-rendered but never hydrated unless the islands bootstrap file happened to compile to the manifest key `BootstrapClient`, the only key the server looked for. A configured `islands.bootstrap` is now recorded under a reserved manifest key whatever its file name. With only `islands: { registry }` set, the build generates a default bootstrap that loads each island's chunk from the manifest, so no bootstrap file is needed. `createIslandManifestResolver()` defaults to the manifest the server injects. React islands now share one React vendor with the bootstrap even without a `reactDirectory`; before, a separately bundled bootstrap brought a second React and hydration failed on `useState`. A page with islands but no bootstrap now logs a warning outside production. Verified in Chromium: `load`, `idle` and `visible` hydrate, `none` doesn't, and React, Svelte and Vue islands hydrate on HTML and HTMX pages.",
	kind: 'fixed',
	summary:
		'Static-page islands hydrate with only `islands.registry`, or a bootstrap file of any name'
};
