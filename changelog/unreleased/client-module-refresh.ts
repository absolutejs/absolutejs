import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'fixed',
	summary: 'Hot-reload a client module inside another app’s page',
	detail: 'Development clientModules connect to the serving app’s HMR socket. Component edits use the host React Fast Refresh runtime. Hosts can subscribe to the dev entry’s onClientModuleReplace(callback) to mount its current exports and remount after non-component edits. The subscription returns an unsubscribe function.',
	symbols: ['BaseBuildConfig']
};
