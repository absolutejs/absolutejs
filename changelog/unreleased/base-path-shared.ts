import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail:
		"An app served under a base path can share module prefixes with the app at the origin's root: `basePathShared: ['/react/vendor/']` (or `ABSOLUTE_BASE_PATH_SHARED`, comma separated) leaves those out of the base path's import map, so the page loads them from the root app. Studio, under `/studio/projects/<id>`, shares `/react/vendor/` with the platform so its page runs on one React, which components from both apps can then share. Both apps must build the shared modules from the same versions, in the same mode; only prefixes the import map would otherwise move can be shared.",
	kind: 'added',
	summary: 'basePathShared: an app under a base path can load module prefixes (one React) from the root app',
	symbols: ['BaseBuildConfig']
};
