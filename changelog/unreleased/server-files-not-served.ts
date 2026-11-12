import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`absolute start` writes the bundled server into the build directory, and that directory is also the static root, so `GET /server.js` downloaded the whole backend. The same applied to its `.br`/`.gz` copies, to the Svelte/Vue/Angular SSR page bundles under `<framework>/server/`, to the compiled convention pages, and to `absolute-runtime.json`, `conventions.json` and `spa-routes.json`. Production static serving now excludes those, plus `.map` files and native `.node` addons. The precompressed handler applies the same list. The server still reads all of them from disk.',
	kind: 'security',
	summary:
		'Production servers no longer serve their own server bundle, SSR bundles or runtime manifests as static files'
};
