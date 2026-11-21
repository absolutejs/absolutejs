import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Pages in a Svelte, Vue or Angular SPA now load their code the first time they are shown, with nothing to write, as React's do. Svelte: a `<Route>` whose `content` snippet is just a component imported from a local `.svelte` file becomes a lazy route (route params passed through under their own name still reach it as props). Vue: a leaf route's `component` in `defineRoutes([...])`, imported from a local `.vue` file, becomes `() => import(...)`, at any depth under a layout route. Angular: a leaf route's `component`, a named import from a local file, becomes `loadComponent`, in a `Routes` array or one passed to `provideRouter`. In every framework a layout route stays in the entry, and so does a page the file also uses elsewhere; the server renders the lazy page in full and the browser loads it before hydrating. Angular's injected router now waits for the first navigation (`withEnabledBlockingInitialNavigation`) so a lazy page is in place before hydration. Fixed with it: under `absolute start`, a Vue SPA's routed pages rendered empty on the server (`<!---->`) and hydrated with a mismatch, because the server bundle carried its own copy of Vue while the page installed its router on the one in node_modules; Vue now stays external, as Svelte does. A Vue route at an empty path under a layout route, and lazy routes nested under one, now get their own compile entry and CSS.",
	kind: 'changed',
	summary:
		'Svelte, Vue and Angular router pages load when first shown, automatically'
};
