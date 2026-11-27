/**
 * Public type surface for cross-framework document navigation
 * (`src/client/navigation.ts`, `@absolutejs/absolute/client/navigation`).
 */

/** How a navigation ended.
 *
 *  - `'swapped'` — the target page replaced the current one in place: no
 *    full page load.
 *  - `'reloaded'` — the layer handed the navigation to the browser (an
 *    error, a non-HTML / non-2xx response, a cross-origin redirect, or a
 *    current page that can't be torn down).
 *  - `'updated'` — a refresh gave the mounted page new data without
 *    unmounting it: nothing its components were holding was lost.
 *  - `'superseded'` — a newer navigation started before this one finished.
 *  - `'cancelled'` — an `absolute:before-navigate` listener called
 *    `preventDefault()`. */
export type DocumentNavigationOutcome =
	'cancelled' | 'reloaded' | 'superseded' | 'swapped' | 'updated';

/** What started a document navigation. `'refresh'` is `invalidate()`:
 *  the current page fetched again and swapped in place. */
export type DocumentNavigationType =
	'link' | 'navigate' | 'refresh' | 'traverse';

export type EnableNavigationOptions = {
	/** Decide per URL whether the layer may soft-navigate to it. Return
	 *  `false` for a full page load. Runs after the built-in checks
	 *  (same origin, no `target` / `download` / modifier keys, no
	 *  `data-absolute-navigation="off"`). */
	shouldIntercept?: (url: URL) => boolean;
	/** Navigating to the page that is already on screen, at another
	 *  address.
	 *
	 *  `'query'` (the default) covers an address that differs only in its
	 *  query string — the next page of a list, a filter, a sort order.
	 *  It hands the mounted page the new data and
	 *  leaves it mounted: no document is fetched, nothing is torn down,
	 *  and what the page's components hold stays — the open filter
	 *  panel, the text in the search box. History, scroll and the page
	 *  announcement work as for any navigation, and the outcome is
	 *  `'updated'`.
	 *
	 *  That means a component is NOT started afresh when only the query
	 *  changes. One that copies a query-derived prop into its own state
	 *  keeps the old copy; derive it instead, or set `false` to have
	 *  every navigation replace the page as before.
	 *
	 *  `'always'` does the same when the path changes too, wherever the
	 *  destination is rendered by the page already mounted: `/blog/a` to
	 *  `/blog/b`. The server is told which page is mounted and answers
	 *  with data for that page and the document for any other, in one
	 *  request. For an app written with it in mind: a component then
	 *  outlives the post it was first shown for, so whatever it keeps in
	 *  its own state has to follow its props, or be keyed by them. */
	inPlace?: 'always' | 'query' | false;
	/** Wrap the swap in `document.startViewTransition` where supported.
	 *  Default `true`; skipped for users who prefer reduced motion. */
	viewTransition?: boolean;
};

export type NavigateDocumentOptions = {
	/** Replace the current history entry instead of pushing one. */
	replace?: boolean;
};

/** `detail` of the `absolute:before-navigate` (cancelable) and
 *  `absolute:after-navigate` events dispatched on `window`. */
export type DocumentNavigationEventDetail = {
	type: DocumentNavigationType;
	url: string;
};
