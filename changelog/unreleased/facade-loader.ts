import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'With 0.20.0-beta.129, a server module re-exporting with an inline `type` specifier (`export { x, type T } from "./x"`) failed to parse in development (`Expected "}" but found "T"`), and the dev server could not start. Re-exports are now loaded with the module\'s own TypeScript loader.',
	kind: 'fixed',
	summary:
		'The dev server starts when a server module re-exports with inline `type` specifiers'
};
