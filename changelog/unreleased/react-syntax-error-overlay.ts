import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A React edit that failed to compile was still broadcast as an update. The browser imported a module that answered 500 and fell back to a full reload, which showed the last good page and no error. The dev server now checks the edited modules compile first and sends the error overlay (file, line and source line) instead; the save that fixes it applies as a normal in-place update. The module server handler and its transform errors also moved to globalThis: after a `bun --hot` reload failed part-way, later imports of the module server got a fresh instance that was never configured, so pre-transforming the changed module silently did nothing.',
	kind: 'fixed',
	summary:
		'A syntax error in a React component shows the error overlay instead of reloading the page'
};
