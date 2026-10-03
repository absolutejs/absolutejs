import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Since 0.20.0-beta.128, editing a module shared by server and frontend code (a formatter, a constants file) could update the server but leave pages of other frameworks importing it on the old code until the next page edit. Frontend dependents of every framework are now rebuilt when a shared module changes.',
	kind: 'fixed',
	summary:
		'Editing a module shared by server and pages rebuilds every page that imports it'
};
