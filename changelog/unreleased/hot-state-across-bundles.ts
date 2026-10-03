import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "In 0.20.0-beta.129 the published package bundles the dev bootstrap separately from the code that reacts to file changes, and each bundle kept its own copy of the hot runtime's state. The file-change side never saw what the bootstrap had installed, so every server edit was reported as not hot-managed and restarted the server, which is the behaviour backend HMR was meant to remove. The state now lives on `globalThis`, so every bundle shares one runtime. A server edit now updates in place in the published package as well, at about 50–250ms for a handler and about 150–300ms for a plugin or the server entry on a large app.",
	kind: 'fixed',
	summary:
		'Server edits update in place in the published package instead of restarting'
};
