import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Set `reactServerComponentsDirectory` in absolute.config.ts and put pages in its `pages` folder. Pages are server components: they can be async and read data directly, and that code never ships to the browser. Components marked `"use client"` are server-rendered, then hydrated in the browser. Serve a page from any Elysia route with `handleReactServerPageRequest({ page: asset(manifest, \'<Page>RSC\'), props })`. `<Suspense>` boundaries stream, and the inline scripts carry the CSP nonce when `secureHeaders()` is on. Install `react-server-dom-webpack` at the same version as `react` (19.2.3 or later). Existing React pages are unchanged. Server Actions, client-side navigation and HMR for these pages are not available yet; edits reload after the dev server restarts.',
	kind: 'added',
	summary:
		'Opt-in React Server Components for React pages served from Elysia routes'
};
