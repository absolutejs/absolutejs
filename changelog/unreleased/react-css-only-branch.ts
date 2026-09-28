import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The React HMR client had a CSS-only branch that looked up the example app's `ReactExampleCSS` manifest key, so it could never work in another app; the server never sends a CSS-only React update, so it was also unreachable. Removed. Stylesheet edits on React pages go through the general stylesheet swap, now covered by a browser test (the rule applies, component state and the document are kept).",
	kind: 'fixed',
	summary: 'Removed a React HMR CSS branch that only matched the example app'
};
