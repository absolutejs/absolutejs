import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Editing server code that rebuilds the app used to run the replaced app\'s `onStop` hooks on every hot swap. An `onStop` is usually the app\'s shutdown: it closes the database pool, the audit log and the queues, which unchanged top-level statements created and the new app keeps. After the swap the new app held closed resources, so routes that used them failed until the dev server was restarted. Lifecycle hooks are now treated like statements: when the new app\'s `onStart`/`onStop` hooks are the same code as the replaced app\'s, their effect carries across the swap and neither runs. Editing a hook still stops the old app and starts the new one, once each.',
	kind: 'fixed',
	summary:
		'A hot swap no longer runs the app\'s shutdown hooks against resources the new app still uses'
};
