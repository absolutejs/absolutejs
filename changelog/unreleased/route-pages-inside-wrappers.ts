import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A route's page is split even when the route wraps it: an auth guard, an error boundary, or a page frame like `<Route element={<AdminPage title=\"Today\"><TodayView /></AdminPage>} />` (React Router's own documented `RequireAuth` shape). Inside a route's element, every component imported from the app that wraps no content of its own loads the first time the route is shown; the wrappers stay in the entry, so they render at once. In Svelte the same holds inside a route's `content` snippet: the page becomes a lazy page in place (the wrapper and any markup beside it stay), with its props still in the snippet's scope, so it may use the route params as it likes; the server still renders it in full and the browser loads it before hydrating. Vue and Angular routes name their component directly and need nothing new.",
	kind: 'changed',
	summary:
		"A route's page is split even inside a wrapper (a guard, a page frame)",
	// The new `svelte/router/LazyPage` subpath's default export: the
	// component the build writes in place of a wrapped page.
	symbols: ['default']
};
