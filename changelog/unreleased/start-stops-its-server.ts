import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Stopping an `absolute start` that had built (not `--prebuilt`) with SIGTERM left the server it spawned running and holding its port. The build directory lock handles SIGTERM by releasing its locks and exiting, and its handler is registered while the build runs, before `absolute start` installs the one that stops the server, so the process exited first. `absolute start` now also stops its server from an `exit` listener, which runs on any exit, `process.exit` included, as `absolute dev` already does for its child.',
	kind: 'fixed',
	summary: 'Stopping `absolute start` also stops the server it started'
};
