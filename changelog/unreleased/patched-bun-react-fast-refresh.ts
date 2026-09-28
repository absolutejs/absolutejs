import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Stock Bun ignores `reactFastRefresh` on `Bun.Transpiler` (oven-sh/bun#32919), so React edits in `absolute dev` remounted the page and lost component state. AbsoluteJS now publishes Bun 1.4.0 with just that fix for every platform Bun ships (github.com/absolutejs/patched-bun). In React projects on stock Bun, `absolute dev` offers it once (Install now / Ask me later / Don't ask again); it installs to ~/.absolutejs/bun, is checked against a pinned SHA-256, and only the dev server uses it, so your `bun` is unchanged. `absolute bun-patch [status|install|remove|reset]` manages it; `ABSOLUTE_PATCHED_BUN=0` opts out.",
	kind: 'added',
	summary:
		"React Fast Refresh keeps component state: `absolute dev` can run on AbsoluteJS's patched Bun"
};
