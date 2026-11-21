import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A React SPA's pages load their code the first time they are shown, with nothing to write. A component imported from the app's own code and placed as the element of a leaf `<Route>` (react-router) becomes its own chunk: the app's entry no longer carries every page, the layout and its navigation are interactive while a page's code is still on its way (React keeps the server's HTML for the page meanwhile), the page hydrates when its code arrives, and a page loaded once opens at once after. Every build applies it the same way (the dev module server, the dev server with backend HMR on or off, the browser build, and `absolute start` / `compile`), so the server always renders the boundaries the browser hydrates. A layout route (one with child routes) stays in the entry, and so does a component the file also uses anywhere else. Pages imported from a package stay eager. `lazyRoute` remains exported: it is what the build writes, and it serves a lazy component outside a route.",
	kind: 'changed',
	summary: 'React router pages load when first shown, automatically'
};
