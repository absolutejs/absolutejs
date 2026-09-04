/**
 * Public type surface for the framework-neutral navigation prefetch
 * primitive (`src/client/prefetch.ts`) shared by the React, Vue and
 * Svelte `<Link>` components.
 */

/** What a prefetch should warm.
 *
 *  - `'document'` — the target page's HTML. Fetched with same-origin
 *    credentials so the browser's HTTP cache (content-hash `ETag`) has
 *    it before the real navigation.
 *  - `'module'` — a client module. Injects `<link rel="modulepreload">`
 *    so the module graph is parsed and compiled ahead of time.
 *  - `'data'` — the page's route data (`application/vnd.absolute.route+json`):
 *    the page's props plus the client entry and stylesheets it needs, which
 *    are `modulepreload`ed / prefetched as the payload lands. Harmless when
 *    the server does not implement it yet: a 404 / 406 is remembered as
 *    "no data" and never re-requested.
 *  - `'route'` — everything a navigation needs: the document AND the route
 *    data (and therefore the page's modules and CSS). What a `<Link>` warms
 *    on hover / pointerdown. */
export type PrefetchKind = 'document' | 'module' | 'data' | 'route';

export type PrefetchOptions = {
	/** Defaults to `'document'`. */
	kind?: PrefetchKind;
};

/** When a `<Link>` prefetches its target.
 *
 *  - `'viewport'` — when the link scrolls into view (128px margin) and on
 *    hover / pointerdown. Production default.
 *  - `'hover'` — only on hover / focus / pointerdown. Development default,
 *    so a page full of links doesn't hammer the dev server.
 *  - `'none'` — never. */
export type PrefetchMode = 'hover' | 'viewport' | 'none';

/** Options for a hover / pointerdown trigger. `kind` defaults to
 *  `'route'` here rather than `'document'`: the trigger is a deliberate
 *  one, so it is worth warming the page's data and modules too. */
export type HoverPrefetchOptions = PrefetchOptions & {
	/** Also inject a prerender speculation rule when the hover fires. */
	prerender?: boolean;
};

export type HoverPrefetchHandle = {
	cancel: () => void;
};
