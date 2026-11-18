import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A streaming slot resolves while the response streams, after the request handler has returned. Each slot now keeps the request context it was rendered in and resolves inside it, so getCurrentAbsoluteRequest, and anything built on it such as an in-process API client that forwards the visitor's cookies, sees the request the slot belongs to.",
	kind: 'fixed',
	summary:
		'Streaming slots resolve inside the request they were rendered for',
	symbols: ['getCurrentAbsoluteRequest', 'SuspenseSlot', 'StreamSlot']
};
