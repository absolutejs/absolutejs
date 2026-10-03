import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Each in-place swap compiled every route of the new Elysia app up front, which took about 2 seconds per edit on an app with a large route table. The new app now builds its router on the first request and compiles each route when that route is first hit, so a plugin or entry edit is served in a few hundred milliseconds. A slow update also names its slowest statements, and an edit to the server entry reports how long it took and which statements re-ran.',
	kind: 'changed',
	summary:
		'Server edits to plugins and the entry are served in hundreds of milliseconds, and slow ones say why'
};
