import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`handleHTMLPageRequest` and `handleHTMXPageRequest` now render the error convention when a page can't be served (its file is missing or unreadable, or it fails a static-page check). They return status 500 with `<Page>.error.html` or `error.html`, like the framework handlers, and `{{ stack }}` is empty in production. Before, the error went unhandled. HTMX pages use the HTMX pages directory's error page first. An HTMX request (`HX-Request: true`) to an unknown route gets that directory's `not-found.html` first. Having `error.html` or `not-found.html` in both the HTML and HTMX directories no longer counts as a page name collision. `loading.html` doesn't apply to static pages; see docs/STATIC_PAGE_CONVENTIONS.md.",
	kind: 'fixed',
	summary:
		'HTML and HTMX pages render their error.html when they fail, and HTMX requests get the HTMX not-found.html',
	symbols: ['ConventionsMap']
};
