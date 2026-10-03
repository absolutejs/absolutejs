import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Two causes of unneeded restarts are fixed. First, the CLI restarted the server for any file saved in the server entry's own folder, including code modules next to the entry. The server process already updates those in place, or asks for a restart when it cannot, so the CLI now leaves code, documents and tests to it and restarts only for other files there (such as `.env`). Second, after a checkout or pull, the first save in a folder made the dev server treat every recently touched file there as edited. A file that has not changed since the dev server started is no longer reported as an edit.",
	kind: 'fixed',
	summary:
		'Saving a file next to the server entry, or soon after a checkout, no longer restarts or rebuilds unrelated code'
};
