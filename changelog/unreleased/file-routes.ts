import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Opt-in file routes for React and Svelte pages. With `fileRoutes: true` in absolute.config.ts, each file under `<reactDirectory>/routes/` or `<svelteDirectory>/routes/` becomes a GET route: `index.tsx` serves `/`, `blog/index.tsx` serves `/blog`, and `blog/[slug].tsx` serves `/blog/:slug`. Files and folders starting with `_` are private, so components can live next to routes. A sibling `blog/[slug].server.ts` can export `load`, whose result becomes the page's props, and `beforeHandle`, which can answer the request first (for example with a redirect). The build writes a route module (`src/routes.gen.ts` by default, `fileRoutes.output` to change it); pass its `routeTree` to `fileRoutes(routeTree, manifest)` after `prepare()`. The route module checks types: `load` must take the route's params and return the page's props, so a renamed param or a missing prop is a type error. Explicit routes stay the default and win over a file route for the same path. In `absolute dev`, adding, renaming or removing a route file updates the routes without a restart. Catch-all, optional and group segments, Vue, Angular and HTML routes, and per-folder conventions are planned. See docs/FILE_ROUTER_PLAN.md.",
	kind: 'added',
	summary:
		'Opt-in file routes for React and Svelte pages, with typed `load` functions',
	symbols: [
		'fileRoutes',
		'reactFileRoute',
		'svelteFileRoute',
		'FileRouteContext'
	]
};
