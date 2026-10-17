import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Production builds bundled React into its vendor files without setting `process.env.NODE_ENV`, so React picked its development build, unminified: `react-dom_client.js` was 903 KB, and React ran its development checks in every production page. Production builds now set `process.env.NODE_ENV` to `"production"` and minify the React vendor bundle: 181 KB. `absolute dev` is unchanged; Fast Refresh needs the development build.',
	kind: 'fixed',
	summary:
		"Production builds ship React's production build, minified (react-dom 903 KB → 181 KB)"
};
