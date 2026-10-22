import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An app that imports one of its own workspace packages (`\"@acme/core\": \"workspace:*\"`) did not run under `absolute dev`. With Bun's isolated linker, the default for a workspace, the dev build imported the package from the framework's own folder, could not find it, and the server crash-looped. With the hoisted linker the page rendered but never hydrated: modules outside the app's folder were addressed as `/@src/../…`, which a browser collapses before asking, so they 404ed. Now a package that resolves to source outside node_modules is the app's own code: served and transpiled like the app's files rather than vendored, its folder watched, and an edit to it hot-reloads in place (server and browser) instead of restarting the server or reloading the page. Packages are read from the app's folder, so any dependency only the app declares also works under the isolated linker, and the dev server serves files outside the app folder (a workspace package, a node_modules hoisted to the workspace root) through `/@src/@up/…`. A `dev.watchDirs` entry or a symlink written to work around this is no longer needed.",
	kind: 'fixed',
	summary:
		"`absolute dev` runs apps that import their own workspace packages, under Bun's isolated or hoisted linker, with hot reload"
};
