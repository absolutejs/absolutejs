import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The production server bundle had no source map, so errors logged by `absolute start` pointed into dist/server.js. The Svelte, Vue and Angular SSR page bundles had none either; only dev chained their maps back to the source. The server bundle now gets a linked map, and the SSR page bundles get the same inline-and-chained maps as dev. A route handler error points at its line in your server file, and a page component error at its `.svelte`/`.vue` file. Svelte frames used to name a nonexistent file next to the build output (`build/svelte/pages/Page.svelte`), because Svelte records the source by basename; they now resolve to the original file, in dev too. Neither map is served publicly. The "Could not decode sourcemap" warning was fixed in the previous release.',
	kind: 'fixed',
	summary:
		'Production stack traces point at your server file and page components instead of the bundled output'
};
