import { expect, test } from 'bun:test';
import { createMemorySyncLocalStore } from '@absolutejs/sync/client';
import { getSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { AbsoluteMobileShellPrincipal } from '../../../src/mobile/shellBootstrap';
import { installAbsoluteMobileShellSync } from '../../../src/mobile/shellSync';

test('provisions account-bound native durability and lifecycle without page wiring', async () => {
	let principalListener:
		| ((principal: AbsoluteMobileShellPrincipal | null) => void)
		| undefined;
	let principalListenerRemoved = 0;
	let lifecycleRemoved = 0;
	let reloads = 0;
	const store = createMemorySyncLocalStore();
	const dispose = installAbsoluteMobileShellSync(
		{
			fetch,
			principal: { namespace: 'principal-a' },
			redirectUri: 'com.example.app://auth/callback',
			onPrincipalChange: (listener) => {
				principalListener = listener;

				return () => {
					principalListenerRemoved += 1;
				};
			},
			socketTicket: async () => 'ticket'
		},
		{
			createStore: () => store,
			installLifecycle: async () => () => {
				lifecycleRemoved += 1;
			},
			reload: () => {
				reloads += 1;
			}
		}
	);
	const runtime = getSyncClientRuntimeTransport();
	expect(runtime?.durable).toEqual({
		namespace: 'principal-a',
		store
	});
	expect(await runtime?.socketTicket()).toBe('ticket');
	const removeClient = runtime?.registerClient?.({
		reconnect: () => undefined
	});
	removeClient?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(lifecycleRemoved).toBe(1);

	principalListener?.({ namespace: 'principal-a' });
	expect(reloads).toBe(0);
	principalListener?.(null);
	expect(reloads).toBe(1);

	dispose();
	dispose();
	expect(principalListenerRemoved).toBe(1);
});

test('does not expose a locked partition while signed out', () => {
	let createdStore = 0;
	const dispose = installAbsoluteMobileShellSync(
		{
			fetch,
			principal: null,
			redirectUri: 'com.example.app://auth/callback',
			onPrincipalChange: () => () => undefined,
			socketTicket: async () => 'ticket'
		},
		{
			createStore: () => {
				createdStore += 1;

				return createMemorySyncLocalStore();
			},
			installLifecycle: async () => () => undefined,
			reload: () => undefined
		}
	);
	expect(createdStore).toBe(0);
	expect(getSyncClientRuntimeTransport()?.durable).toBeUndefined();
	dispose();
});
