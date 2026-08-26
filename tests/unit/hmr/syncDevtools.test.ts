import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	mock,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { SyncRuntimeInspection } from '@absolutejs/sync/client/runtime';
import {
	installAbsoluteNativeSyncDevtools,
	type SyncDevtoolsBridge
} from '../../../src/dev/client/syncDevtools';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => document.body.replaceChildren());

const inspection: SyncRuntimeInspection = {
	automaticResolutions: 2,
	clients: 1,
	conflicts: 1,
	deadLetters: [
		{
			attempts: 2,
			code: 'VERSION_CONFLICT',
			createdAt: 1,
			deadLetteredAt: 2,
			kind: 'conflict' as const,
			message: 'The record changed on the server.',
			name: 'comments:update',
			operationId: 'operation-1'
		}
	],
	pending: 3
};

describe('native Sync devtools', () => {
	test('renders redacted diagnostics and retries a retained operation', async () => {
		const retry = mock(async (_operationId: string) => undefined);
		const bridge: SyncDevtoolsBridge = {
			retry,
			discard: async () => undefined,
			inspect: async () => inspection,
			rebase: async () => 'operation-2'
		};
		const dispose = installAbsoluteNativeSyncDevtools(bridge);
		await Promise.resolve();
		const host = document.querySelector('#absolutejs-sync-devtools');
		const root = host?.shadowRoot;
		expect(root?.querySelector('.trigger')?.textContent).toBe('Sync · 1');
		(root?.querySelector('.trigger') as HTMLButtonElement).click();
		await Promise.resolve();
		expect(root?.textContent).toContain('comments:update');
		expect(root?.textContent).toContain('VERSION_CONFLICT');
		expect(root?.textContent).not.toContain('operation-1');
		(
			root?.querySelector('[data-action="retry"]') as HTMLButtonElement
		).click();
		await Promise.resolve();
		await Promise.resolve();
		expect(retry).toHaveBeenCalledWith('operation-1');
		dispose();
		expect(document.querySelector('#absolutejs-sync-devtools')).toBeNull();
	});
});
