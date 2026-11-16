import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Saving a new component broken, together with the import that uses it, then fixing it, left the server stuck: the importer\'s update had failed on the broken import, its own file did not change again, and Bun kept the failed first load, so even later edits to the importer replayed the old error until the dev server restarted. A module whose first version never evaluated now loads afresh, and an update that failed is retried after the next one that applies. Separately, an error a full build stored for a file stayed after a fast-path update compiled that file cleanly, so every reload and every new tab showed the error overlay for code that compiled; the fast path now clears the stored errors for the files it compiled.',
	kind: 'fixed',
	summary: 'Fixing a broken new file recovers its importers on the server, and a fixed error stops being shown on reload'
};
