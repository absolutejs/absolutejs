import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "beta.199 changed what the backend HMR analyzer records (each statement's `reaches`) without bumping `ANALYZER_VERSION`, the key of the on-disk analysis cache. A project's unchanged modules were read back from the cache without `reaches`, so editing a factory reached through another factory still kept the old sub-app until a restart. The version is bumped, and a test now pins the analysis shape to it, so a future change to the shape fails until the version moves.",
	kind: 'fixed',
	summary:
		'Factory edits reached through another factory update the server in projects with a warm analysis cache'
};
