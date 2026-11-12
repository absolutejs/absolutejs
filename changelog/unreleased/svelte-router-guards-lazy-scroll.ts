import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Route guards: a `guard` on `<Route>` or `<Router>`, and `beforeNavigate()` for browser-only checks, runs before `<Link>` clicks, `goto()` and back/forward, and can be async. It returns nothing to allow, `false` to cancel or a URL / `redirect()` to redirect. Cancelling back/forward puts the URL back. Route and Router guards also run during the server render, where a redirect is a 302. Lazy routes: `<Route loader={() => import("./Page.svelte")}>` puts the component in its own chunk, loaded when the route is first visited or when a `<Link>` to it is prefetched, with optional `pending` and `error` snippets. The server renders the real component and the browser loads its chunk before hydrating, so the page doesn\'t flash. Scroll restoration: while a router is mounted, new navigations start at the top or at the `#hash` target, and back/forward and reload return to where you were. `goto(url, { noScroll: true })` leaves the scroll alone. `goto()` now resolves to what happened (`"committed"`, `"cancelled"`, `"redirected"`, …), and `history.state` holds the router\'s bookkeeping next to your state, which `page.state` still returns unchanged. Smaller additions that support this: `renderToReadableStream` takes a Svelte `context`, a `settle` callback that can ask for another render pass, and a function for `bootstrapScriptContent`; `observeViewport` and `scheduleHoverPrefetch` take an `onVisible` / `onPrefetch` callback; and the `noScroll` doc on `GotoOptions` now covers `#hash` targets.',
	kind: 'added',
	summary:
		'Svelte router: route guards with server redirects, lazy routes, and scroll restoration',
	symbols: [
		'goto',
		'beforeNavigate',
		'redirect',
		'preloadRoute',
		'GotoOptions',
		'renderToReadableStream',
		'observeViewport'
	]
};
