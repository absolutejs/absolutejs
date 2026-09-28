import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The dev server decides between React Fast Refresh and the stock-Bun remount fallback by transpiling a probe component. The probe was named `__AbsoluteRefreshProbe`; React Fast Refresh registers only capitalized components, so it reported "unsupported" even on a Bun with the reactFastRefresh fix, and React edits always remounted with a warning. It now uses a capitalized name.',
	kind: 'fixed',
	summary:
		'React Fast Refresh is used when Bun supports it, instead of always falling back to a remount'
};
