import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Backend HMR re-ran an importer's statement only when it called the changed export itself. An app built through two factories, such as an entry calling `createProjectApplication()`, which calls `createDeliveryApplication()` from a third module, kept serving the old sub-app after `createDeliveryApplication` was edited: its routes and lifecycle hooks only changed on a restart. An export whose function calls a changed export while it runs now counts as changed too, so the statement that called it re-runs. Functions that only use the change inside callbacks they create, like route handlers, still rebuild nothing. See docs/BACKEND_HMR.md.",
	kind: 'fixed',
	summary:
		'Editing a factory reached through another factory updates the running server'
};
