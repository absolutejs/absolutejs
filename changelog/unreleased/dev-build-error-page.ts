import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'When a page failed its on-demand build in development, the handler threw `Asset "<Page>" not found in manifest.` and left the response to whichever error handler answered first. An app with its own `onError` (most real apps) showed its generic error page, so the actual cause — a missing import, a syntax error — was only in the terminal. Page handlers for Vue, React, Svelte, Angular and Ember now return a Build Error page themselves, with the build\'s own error message, and the page reloads by itself once a rebuild lands or the dev server comes back. AbsoluteJS\'s fallback error page for missing assets shows the same build error.',
	kind: 'fixed',
	summary:
		'A page that fails to build in development shows the real build error and reloads itself once fixed'
};
