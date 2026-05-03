import type { GotoOptions, RouterMode } from '../../../types/svelteRouter';
import { buildHashHref } from './hashMode';
import { setPage } from './page.svelte';
import { consumePrefetch } from './prefetchCache';
import { withViewTransition } from './viewTransitions';

let activeMode: RouterMode = 'history';

/**
 * Internal — called by Router.svelte on mount so navigation primitives
 * know which URL strategy to use. Hash mode rewrites the URL bar to
 * `#/path` instead of `/path`.
 */
export const setRouterMode = (mode: RouterMode) => {
	activeMode = mode;
};

const resolveAbsoluteUrl = (target: string) => {
	if (typeof window === 'undefined') {
		// Programmatic goto on the server is rare but we tolerate it as a
		// way for tests to drive the router without a real DOM.
		return new URL(target, 'http://localhost/');
	}

	return new URL(target, window.location.href);
};

const isExternal = (target: URL) => {
	if (typeof window === 'undefined') return false;

	return target.origin !== window.location.origin;
};

const writeHistory = (target: URL, options: GotoOptions) => {
	if (typeof window === 'undefined') return;

	const href =
		activeMode === 'hash'
			? `${window.location.pathname}${window.location.search}${buildHashHref(target.pathname + target.search)}`
			: `${target.pathname}${target.search}${target.hash}`;

	const method = options.replaceState
		? window.history.replaceState
		: window.history.pushState;
	method.call(window.history, options.state ?? null, '', href);
};

const applyScrollAndFocus = (options: GotoOptions) => {
	if (typeof window === 'undefined') return;

	if (!options.noScroll) window.scrollTo({ left: 0, top: 0 });
	if (!options.keepFocus && document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
};

/**
 * Programmatically navigate to a URL. Updates `page.url`, writes history,
 * and (when supported) wraps the swap in `document.startViewTransition`.
 *
 * Mirrors SvelteKit's `goto` from `$app/navigation` — same name, same
 * options shape, so a SvelteKit user finds the primitive familiar.
 */
export const goto = async (target: string, options: GotoOptions = {}) => {
	const url = resolveAbsoluteUrl(target);

	if (isExternal(url)) {
		// External URLs go through the browser — we don't try to SPA them.
		if (typeof window !== 'undefined') {
			window.location.href = url.href;
		}

		return;
	}

	consumePrefetch(target);

	const mutate = () => {
		writeHistory(url, options);
		setPage({
			params: {},
			state: options.state ?? null,
			url
		});
		applyScrollAndFocus(options);
	};

	await withViewTransition(mutate);
};
