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
 *  - `'superseded'` — a newer navigation started before this one finished.
 *  - `'cancelled'` — an `absolute:before-navigate` listener called
 *    `preventDefault()`. */
export type DocumentNavigationOutcome =
	'cancelled' | 'reloaded' | 'superseded' | 'swapped';

/** What started a document navigation. */
export type DocumentNavigationType = 'link' | 'navigate' | 'traverse';

export type EnableNavigationOptions = {
	/** Decide per URL whether the layer may soft-navigate to it. Return
	 *  `false` for a full page load. Runs after the built-in checks
	 *  (same origin, no `target` / `download` / modifier keys, no
	 *  `data-absolute-navigation="off"`). */
	shouldIntercept?: (url: URL) => boolean;
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
