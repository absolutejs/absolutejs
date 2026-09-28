import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Elysia 2 hands every open, message and close event of a WebSocket a new wrapper object. The dev server tracked HMR clients by that wrapper, so a closed browser tab was never removed (it stayed until a broadcast send threw) and each `ready` message counted the same tab again under `connectedTargets`, so `/hmr-status` reported clients that were gone and more web targets than open sockets. Clients are now tracked by the underlying socket.',
	kind: 'fixed',
	summary: '`/hmr-status` no longer counts closed or duplicate HMR clients'
};
