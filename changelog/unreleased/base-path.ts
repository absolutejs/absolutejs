import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An app can now be served under a URL prefix, behind a proxy that strips the prefix before the request reaches it (`/studio/projects/abc` on another app's origin). Set `basePath` in the config, or `ABSOLUTE_BASE_PATH` per process. The app's routes, the dev module server and the HMR socket stay at the root of the app's own server; every URL the framework hands the browser carries the prefix: a React page's entry script and its route data, the HMR socket, CSS and static-asset HMR, and the dev server's hashless-asset redirect. An import map written first in the page's `<head>` moves the root-absolute module specifiers that bundles and dev modules use (`/@src/`, `/react/vendor/`, `/vendor/`, ...) under the prefix, so dev HMR works through such a proxy as it does at the root. `withBasePath(path)` prefixes a URL the app renders itself, such as a stylesheet `<link>`; `asset()` stays unprefixed. Without a base path nothing changes.",
	kind: 'added',
	summary: 'Serve an app, and its dev HMR, under a URL prefix',
	symbols: ['BaseBuildConfig', 'getBasePath', 'withBasePath']
};
