import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Call `enableNavigation()` from `@absolutejs/absolute/client/navigation` on your pages and a link from a page in one framework to a page in another (a React page to a Svelte page, say) no longer reloads the browser. The target page's HTML is fetched, its stylesheets load first, the current page is torn down, the head and body are swapped (in a View Transition where the browser supports one), and the target page hydrates. Island stores made with `createIslandStore` keep their values, back and forward work across the two pages with their scroll positions, and the new page's title is announced to screen readers. Links inside a framework's own router still navigate through that router. Under `secureHeaders()` the swapped-in page's scripts and styles run with the current page's nonce, but only those that carried their own response's nonce. Add `data-absolute-navigation=\"off\"` to a link (or a parent) to get a normal page load; any failure also falls back to one. The Svelte router's `<Link>` now leaves a URL that no mounted `<Router>` matches to this navigation when it is enabled. This release is tested with React and Svelte pages. Vue and Angular pages have the same teardown hook but are not tested yet. HTML and HTMX pages have none, so leaving one is still a normal page load.",
	kind: 'added',
	summary:
		'Links between pages built with different frameworks can navigate without a full page reload'
};
