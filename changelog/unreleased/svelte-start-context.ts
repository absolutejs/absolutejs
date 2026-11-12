import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`absolute start` bundled its own copy of Svelte into the production server, while Svelte pages load Svelte from node_modules. The two copies kept separate component context, so a page calling `getContext` or `setContext` (the Svelte router does) answered every request with a 500 `lifecycle_outside_component`. The production server now keeps Svelte external when the app has Svelte pages, so there is one copy.',
	kind: 'fixed',
	summary:
		'Svelte pages that use `getContext` / `setContext`, including every Svelte router page, no longer fail under `absolute start`'
};
