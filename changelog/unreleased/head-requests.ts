import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Elysia 2 no longer answers HEAD for a GET route, so every AbsoluteJS app answered HEAD with 404 while GET answered 200, pages and static files alike. Uptime monitors, link checkers, crawlers and validators ask with HEAD and read that as down. `networking()` now adds a HEAD fallback that runs the request as GET and returns its status and headers without a body, compiled executables included. A route the app declares with `.head()` still wins.',
	kind: 'fixed',
	summary:
		'HEAD requests answer like GET (status and headers, no body) instead of 404'
};
