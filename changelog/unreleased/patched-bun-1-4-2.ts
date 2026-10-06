import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Stock Bun still ignores `reactFastRefresh` on `Bun.Transpiler` in 1.4.2 (oven-sh/bun#32919). The patched build `absolute dev` offers was Bun 1.4.0, and the CLI never replaces a newer Bun with an older patched one, so anyone on Bun 1.4.1 or 1.4.2 lost the offer and React edits fell back to a remount. The CLI now offers `bun-v1.4.2-absolute.1`, Bun 1.4.2 with only that fix, checked against its pinned SHA-256 for every platform.',
	kind: 'fixed',
	summary: 'React Fast Refresh is offered again on Bun 1.4.1 and newer'
};
