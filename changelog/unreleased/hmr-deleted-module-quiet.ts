import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Deleting a server module logged "failed to update; the previous version keeps serving" with an ENOENT error, though nothing failed: there is nothing to apply, and the modules that imported it change through their own edits. A deleted module is now an unchanged outcome and logs nothing. Recreating it still applies as an edit.',
	kind: 'fixed',
	summary: 'Deleting a server module no longer reports a failed hot update'
};
