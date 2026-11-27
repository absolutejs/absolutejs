import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A React error, not-found or loading page was bundled with its own copy of React, while the renderer used the app's, so any hook it called threw \"Invalid hook call\" and the response fell back to plain JSON. absolutejs.ai's 404 page did this after its upgrade to beta.434, where route-folder conventions route unmatched addresses through the not-found page. A convention page's `react`, `react/jsx-runtime` and `react/jsx-dev-runtime` imports now compile to small modules that read the React the renderer installs just before importing the page, so it always calls hooks on the React that renders it, whether the server runs from source, as a bundled `absolute start` build or as a compiled executable. The route-folder convention tests now use hooks in every page, convention and route alike.",
	kind: 'fixed',
	summary:
		'React convention pages (error, not-found, loading) can use hooks in production',
	symbols: []
};
