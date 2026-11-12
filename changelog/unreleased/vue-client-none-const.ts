import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The build drops the client bundle of a Vue page registered with `client: 'none'`, but it only recognised a string literal. `client: CLIENT_MODE` with `const CLIENT_MODE = 'none'` in the same file still built an unused hydration bundle. The scanner now resolves same-file `const` strings for `client` and for the `asset(manifest, …)` key, including `as const`, `satisfies` and the shorthand `{ client }`. A value it can't know at build time (an import, a `let`, a call) keeps the client bundle, which still works and just isn't trimmed.",
	kind: 'fixed',
	summary:
		"Vue pages with `client: 'none'` set through a same-file const skip their unused client bundle"
};
