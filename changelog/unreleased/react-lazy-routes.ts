import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A React SPA can load each page's code the first time the page is shown, instead of shipping every page with the app's entry: `const Billing = lazyRoute(() => import('./BillingView'), 'BillingView')` and `<Route element={<Billing />} path=\"/billing\" />`. The build puts the page in its own chunk. The server renders the page in full (its module starts loading when the route is defined, so a request never waits on it). In the browser the page sits in its own Suspense boundary: while its chunk is still loading during hydration, React keeps the server's HTML for it and makes the rest of the page (the layout, its navigation) interactive right away, then hydrates the page when its code arrives, with no blank and no mismatch. A page loaded once renders at once afterwards, and `preload()` starts a page's load ahead of time. The Svelte router's lazy routes already worked this way; this is the React counterpart, from `@absolutejs/absolute/react/router`.",
	kind: 'added',
	summary: 'React SPA pages load their code when first shown (lazyRoute)',
	symbols: ['lazyRoute', 'LazyRoute', 'LazyRouteOptions']
};
