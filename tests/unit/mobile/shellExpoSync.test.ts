import { expect, test } from 'bun:test';
import { createMemorySyncLocalStore } from '@absolutejs/sync/client';
import { getSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import { createExpoSyncBridgeHost } from '@absolutejs/sync-expo/bridge';
import type { AbsoluteMobileShellPrincipal } from '../../../src/mobile/shellBootstrap';
import {
	installAbsoluteExpoShellSync,
	type AbsoluteExpoShellSyncOptions
} from '../../../src/mobile/shellExpoSync';

test('provisions WebView Sync through a single native-owned principal', async () => {
	const nativeStore = createMemorySyncLocalStore();
	const host = createExpoSyncBridgeHost({
		namespace: 'principal-a',
		store: nativeStore
	});
	const listeners = new Map<
		string,
		Set<(payload: Record<string, unknown>) => void>
	>();
	const provider: NonNullable<AbsoluteExpoShellSyncOptions['provider']> = {
		request: host.request,
		on: (
			event: 'sync.socket' | 'sync.wake',
			listener: (payload: Record<string, unknown>) => void
		) => {
			const values = listeners.get(event) ?? new Set();
			values.add(listener);
			listeners.set(event, values);

			return () => values.delete(listener);
		}
	};
	let principalListener:
		| ((principal: AbsoluteMobileShellPrincipal | null) => void)
		| undefined;
	let reloads = 0;
	const dispose = installAbsoluteExpoShellSync(
		{
			clientId: 'native-client',
			fetch,
			issuer: 'https://api.example.com',
			principal: { namespace: 'principal-a' },
			redirectUri: 'example://auth/callback',
			onPrincipalChange: (listener) => {
				principalListener = listener;

				return () => undefined;
			},
			socketTicket: async () => {
				throw new Error('ticket must remain native');
			}
		},
		{
			background: {
				endpoint: 'https://api.example.com/__absolute/sync/background',
				intervalMinutes: 15
			},
			socketTickets: true,
			storageSchema: {
				components: [{ id: '@absolutejs/app', version: 1 }]
			}
		},
		{ provider, reload: () => (reloads += 1) }
	);
	const runtime = getSyncClientRuntimeTransport();
	expect(runtime?.durable?.namespace).toBe('principal-a');
	expect(runtime?.socketTicket).toBeUndefined();
	expect(runtime?.webSocketImpl).toBeFunction();
	await runtime?.durable?.store.transaction(
		'page-controlled-namespace',
		'readwrite',
		(tx) => tx.setInstallationId('native-installation')
	);
	await expect(
		nativeStore.transaction('principal-a', 'readonly', (tx) =>
			tx.getInstallationId()
		)
	).resolves.toBe('native-installation');
	await expect(
		nativeStore.transaction('page-controlled-namespace', 'readonly', (tx) =>
			tx.getInstallationId()
		)
	).resolves.toBeUndefined();
	let reconnects = 0;
	let flushes = 0;
	const removeClient = runtime?.registerClient?.({
		discardDeadLetter: async () => undefined,
		flush: async () => {
			flushes += 1;

			return { deadLetters: 0, pending: 0, timedOut: false };
		},
		listDeadLetters: async () => [],
		rebaseDeadLetter: async () => 'rebased',
		reconnect: () => {
			reconnects += 1;
		},
		retryDeadLetter: async () => undefined,
		status: () => ({
			automaticResolutions: 0,
			conflicts: 0,
			connection: 'offline',
			deadLetters: 0,
			pending: 1
		}),
		subscribeStatus: () => () => undefined
	});
	for (const listener of listeners.get('sync.wake') ?? []) listener({});
	await Promise.resolve();
	expect({ flushes, reconnects }).toEqual({ flushes: 1, reconnects: 1 });
	principalListener?.({ namespace: 'principal-a' });
	principalListener?.({ namespace: 'principal-b' });
	expect(reloads).toBe(1);
	removeClient?.();
	dispose();
	await host.close();
});
