// Browsers — Chrome especially — cache favicons in a store that is separate
// from (and far stickier than) the HTTP cache. It ignores `must-revalidate`
// and even survives a hard reload, and it caches *negative* results ("this
// origin has no favicon") when an early request 404s. The only reliable way
// to force a re-fetch is to change the icon's URL. Rather than make every app
// hand-rename `favicon-v2.ico`, `favicon-v3.ico`, ... on each change, the
// framework appends a content-hash query (`?v=<hash>`) to the favicon href so
// the URL changes automatically whenever the icon bytes change.
//
// The hash is computed server-side (it needs filesystem access to the build
// dir), so this module holds an optional resolver that `prepare` registers at
// startup. `generateHeadElement` — which also runs in client bundles where no
// resolver is set — calls `applyIconVersion`, which is a no-op until the
// resolver is registered. That keeps the head builder isomorphic-safe.

type IconVersionResolver = (href: string) => string;

export const iconMimeType = (icon: string) => {
	if (icon.endsWith('.svg')) return 'image/svg+xml';
	if (icon.endsWith('.png')) return 'image/png';

	return 'image/x-icon';
};

let resolver: IconVersionResolver | undefined;

export const applyIconVersion = (href: string) =>
	resolver ? resolver(href) : href;

export const setIconVersionResolver = (
	resolverFn: IconVersionResolver | undefined
) => {
	resolver = resolverFn;
};
