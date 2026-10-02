import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Vue resolves an imported prop or emit type by probing the import path as written before trying `<path>.ts` and `<path>/index.ts`. AbsoluteJS answered that probe with `existsSync`, which is true for a directory, so Vue read the directory and the page failed to build with `EISDIR: illegal operation on a directory, read`. In development the page then answered `Asset \"<Page>\" not found in manifest`. Any type reached through `export * from './folder'` triggered it, which includes `@absolutejs/auth` 0.97's declarations. Type resolution and CSS `@import` inlining now accept only regular files.",
	kind: 'fixed',
	summary:
		'Vue pages whose prop types come through a directory index build again instead of failing with EISDIR'
};
