import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute dev` now selects AbsoluteJS's patched Bun 1.4.4 (`1.4.4+absolute.1`, installed and signature-checked by bvm) for React Fast Refresh. Stock Bun 1.4.4 still ignores `reactFastRefresh` on `Bun.Transpiler` (oven-sh/bun#32919), so React edits keep component state only on the patched build. The patched build now reports its full version as `Bun.version`, and the install check accepts it. Projects on the 1.4.2 patched build are offered the update.",
	kind: 'changed',
	summary: 'absolute dev uses the patched Bun 1.4.4 build'
};
