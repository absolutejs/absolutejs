import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Elysia 2.0.0-rc.0 renamed every lifecycle hook to its `on` form (request → onRequest, beforeHandle → onBeforeHandle, afterHandle → onAfterHandle, afterResponse → onAfterResponse, error → onError, parse → onParse, transform → onTransform) and removed setup/cleanup in favour of onStart/onStop. The framework now builds, tests and ships against Elysia 2.0.0-rc.0 and the matching @elysia plugins, and requires `elysia ^2.0.0-rc.0`, so it also accepts later release candidates and 2.0.0. It moves with the packages that made the same change: @absolutejs/auth 0.101 and @absolutejs/sync 3, plus pwa, sync-capacitor and sync-expo releases that accept sync 3.',
	kind: 'breaking',
	migration: {
		instruction:
			'Upgrade `elysia` and every `@elysia/*` package to 2.0.0-rc.0 or later, `@absolutejs/auth` to 0.101 or later and `@absolutejs/sync` to 3. Then rename lifecycle hooks in your server: request → onRequest, beforeHandle → onBeforeHandle, afterHandle → onAfterHandle, afterResponse → onAfterResponse, error → onError, parse → onParse, transform → onTransform; replace setup/cleanup with onStart/onStop. The codemod at absolutejs/scripts codemods/elysia-rc-hooks.ts does the renames (run it before upgrading Elysia).',
		manual: true
	},
	summary:
		'Requires Elysia 2.0.0-rc.0, @absolutejs/auth 0.101 and @absolutejs/sync 3',
	symbols: ['prepare', 'startDevPrebuild']
};
