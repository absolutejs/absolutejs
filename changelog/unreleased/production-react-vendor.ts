import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Production builds bundled React into its vendor files without setting `process.env.NODE_ENV`, so React picked its development build: `react-dom_client.js` was 903 KB, and React ran its development checks in every production page. Production builds now set `process.env.NODE_ENV` to `"production"`: 400 KB, 81 KB gzipped. Only whitespace is minified; renaming identifiers or minifying syntax across the split vendor chunks makes Bun emit an export named `__INVALID__REF__`, which stopped compiled executables from hydrating. `absolute dev` is unchanged; Fast Refresh needs the development build.',
	kind: 'fixed',
	summary:
		"Production builds ship React's production build, minified (react-dom 903 KB → 181 KB)"
};
