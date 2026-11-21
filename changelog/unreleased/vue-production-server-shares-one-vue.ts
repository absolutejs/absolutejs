import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The production server bundle inlined the runtime of every framework the app used, while each Vue, Svelte and Angular page is compiled to its own SSR asset that keeps `vue` / `svelte` / `@angular/*` bare so all pages share one instance. The server therefore rendered with a second copy, whose module state the page never saw: a Vue page exporting routes resolved <RouterView /> to nothing and answered an empty #root, with no warning, because a production Vue build has no component-resolution warning. Only React, whose pages reach the server through its own import graph, is still inlined. Unrelated, the island runtime chunks are now classified by the framework packages they import rather than by chunk name, so a React-only app no longer ships an islands chunk that imports @angular/core.',
	kind: 'fixed',
	summary:
		'A production Vue page with routes renders its route, not an empty page'
};
