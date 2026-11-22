import type { Change } from '@absolutejs/changelog';
import type * as Api from '../../src/index';

export const change: Change<typeof Api> = {
	detail: 'A dev server or reverse proxy can complete a normal WebSocket closure while the page stays open. The HMR client now reconnects in that case, checks the server snapshot and resumes delivery without a manual refresh.',
	kind: 'fixed',
	summary: 'hot reload reconnects after a clean server socket closure'
};
