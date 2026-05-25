import type { PageState } from '../../../types/svelteRouter';

const initialUrl = () => {
	if (typeof window !== 'undefined') {
		return new URL(window.location.href);
	}

	// On the server we don't know the URL yet — Router.svelte initializes
	// it from its `url` prop. Use a placeholder that Router.svelte will
	// overwrite immediately.
	return new URL('http://localhost/');
};

const initialState = (): PageState => ({
	params: {},
	state: undefined,
	url: initialUrl()
});

const inner = $state<PageState>(initialState());

/**
 * Reactive route state. Mirrors SvelteKit's `page` from `$app/state`:
 *
 *   import { page } from '@absolutejs/absolute/svelte/router';
 *   page.url.pathname        // current path (reactive)
 *   page.url.searchParams    // parsed URLSearchParams (reactive)
 *   page.params.id           // active route params (reactive)
 *   page.state               // history.state for the current entry
 *
 * Backed by `$state`. Direct property access in templates re-renders.
 */
export const page = inner;
export const seedPage = (
	url: URL,
	params: Record<string, string | undefined> = {}
) => {
	inner.url = url;
	inner.params = params;
	inner.state = undefined;
};
export const setPage = (next: Partial<PageState>) => {
	if (next.url !== undefined) inner.url = next.url;
	if (next.params !== undefined) inner.params = next.params;
	if (next.state !== undefined) inner.state = next.state;
};
