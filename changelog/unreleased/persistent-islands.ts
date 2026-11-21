import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'An island rendered with `persist="<key>"` keeps running across a cross-framework soft navigation when the page being swapped in renders an island with the same key: the live element is moved into the new document instead of being re-created, so the instance is never unmounted and never hydrated again and its DOM state comes with it — what was typed into it, an open menu, a playing video, a scrolled list. `createIslandStore` state already survived a navigation; this is the state a store cannot carry. A navbar island therefore keeps its state across React to Svelte, which is navigation plan phase 5\'s exit criterion. An island is the unit rather than an arbitrary subtree because an island is already the one thing every framework\'s hydration leaves alone, while page-owned markup is not: the page app is unmounted on every navigation, so persisting markup it owns would keep nodes whose component is gone. A page that renders no island with the key tears it down like any other, so a layout the next page never asked for does not outlive it. Verified both directions between React and Svelte pages; a Vue or Angular page as the destination of a persisted island is not yet verified.',
	kind: 'added',
	summary: 'Islands can persist across a navigation with a `persist` key',
	symbols: [
		'RuntimeIslandRenderProps',
		'TypedIslandRenderProps',
		'renderIslandResult'
	]
};
