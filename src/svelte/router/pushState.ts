import { setPage } from './page.svelte';

const resolveTarget = (target: string) => {
	if (typeof window === 'undefined')
		return new URL(target, 'http://localhost/');

	return new URL(target, window.location.href);
};

/**
 * Shallow routing: update the URL bar and `page.state` without re-running
 * `<Route>` matching. Useful for modals / drawers / overlays that want a
 * shareable URL without swapping the active route's content.
 *
 * Mirrors SvelteKit's `pushState` from `$app/navigation`.
 */
export const pushState = (target: string, state: unknown) => {
	if (typeof window === 'undefined') return;

	const url = resolveTarget(target);
	window.history.pushState(state, '', url.href);
	setPage({ state, url });
};

/**
 * Same as `pushState` but uses `history.replaceState`. Mirrors SvelteKit's
 * `replaceState` from `$app/navigation`.
 */
export const replaceState = (target: string, state: unknown) => {
	if (typeof window === 'undefined') return;

	const url = resolveTarget(target);
	window.history.replaceState(state, '', url.href);
	setPage({ state, url });
};
