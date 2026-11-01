import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A production server imported absolute.config.ts from source at every boot, through `prepare()` and again in the `absolute start --prebuilt` controller. That evaluated the framework's own unbundled package and everything the config imports beside the server bundle that already contains it: the AbsoluteJS docs site's config imported its sitemap routes, which pulled in every docs page, its data and its highlighter, about 735 modules and roughly 70 MB of the server's memory plus 55 MB of the controller's. `absolute start` and `absolute prepare` now write the plain-data fields the runtime reads to `absolute-runtime.json` in the build directory, and a production `prepare()` (with `ABSOLUTE_BUILD_DIR` set, as `absolute start` sets it) and a prebuilt start read that instead of importing the config. A build without the file, from an older framework or another pipeline, loads the config as before. Production `prepare()` also no longer scans and reads every page source at boot for island metadata that only dev rebuilds use.",
	kind: 'changed',
	summary:
		'Production servers no longer import absolute.config.ts at runtime',
	symbols: ['prepare']
};
