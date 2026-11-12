import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`pageRouterPlugin` was a placeholder that only logged "Page Router Plugin Not Implemented Yet" and registered nothing, so removing it changes no behavior.',
	kind: 'removed',
	migration: {
		instruction:
			'Delete the `pageRouterPlugin` import and call; it never did anything. Register page routes with Elysia (`.get(path, () => handle…PageRequest(…))`) as before.',
		manual: true
	},
	summary: 'Remove the unimplemented `pageRouterPlugin` export',
	symbols: ['pageRouterPlugin']
};
