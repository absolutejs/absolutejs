import { setPage } from './page.svelte';
import { writeHistoryEntry } from './scroll';

const resolveTarget = (target: string) => {
	if (typeof window === 'undefined')
		return new URL(target, 'http://localhost/');

	return new URL(target, window.location.href);
};

/**
 * Shallow routing: update the URL bar and `page.state` without re-running
 * `<Route>` matching, guards or scrolling. Useful for modals / drawers /
 * overlays that want a shareable URL without swapping the active route's
 * content. The scroll position of the entry being left is saved, so
 * going back restores it.
 *
 * Mirrors SvelteKit's `pushState` from `$app/navigation`.
 */
export const pushState = (target: string, state: unknown) => {
	if (typeof window === 'undefined') return;

	const url = resolveTarget(target);
	writeHistoryEntry(url.href, state, 'push');
	setPage({ state, url });
};

/**
 * Same as `pushState` but uses `history.replaceState`. Mirrors SvelteKit's
 * `replaceState` from `$app/navigation`.
 */
export const replaceState = (target: string, state: unknown) => {
	if (typeof window === 'undefined') return;

	const url = resolveTarget(target);
	writeHistoryEntry(url.href, state, 'replace');
	setPage({ state, url });
};
