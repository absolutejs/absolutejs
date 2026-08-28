import { expect, test } from 'bun:test';
import { createMemorySyncLocalStore } from '@absolutejs/sync/client';
import { getSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { CapacitorSyncLocalStoreOptions } from '@absolutejs/sync-capacitor';
import type { AbsoluteMobileShellPrincipal } from '../../../src/mobile/shellBootstrap';
import { installAbsoluteMobileShellSync } from '../../../src/mobile/shellSync';

test('provisions account-bound native durability and lifecycle without page wiring', async () => {
	let principalListener:
		| ((principal: AbsoluteMobileShellPrincipal | null) => void)
		| undefined;
	let principalListenerRemoved = 0;
	let lifecycleRemoved = 0;
	let reloads = 0;
	const statuses: unknown[] = [];
	const schemaStates: unknown[] = [];
	let backgroundConfiguration: unknown;
	let storeOptions: CapacitorSyncLocalStoreOptions | undefined;
	const store = createMemorySyncLocalStore();
	const dispose = installAbsoluteMobileShellSync(
		{
			clientId: 'native-client',
			fetch,
			issuer: 'https://app.example',
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
			background: {
				endpoint: 'https://app.example/__absolute/sync/background',
				intervalMinutes: 15
			},
			socketTickets: true,
			storageSchema: {
				components: [{ id: '@absolutejs/app', version: 1 }]
			}
		},
		{
			configureBackground: async (configuration) => {
				backgroundConfiguration = configuration;
			},
			createStore: (options) => {
				storeOptions = options;

				return store;
			},
			installLifecycle: async () => () => {
				lifecycleRemoved += 1;
			},
			reload: () => {
				reloads += 1;
			},
			reportSchemaState: (state) => schemaStates.push(state),
			reportStatus: (status) => statuses.push(status)
		}
	);
	const runtime = getSyncClientRuntimeTransport();
	expect(runtime?.durable).toEqual({
		namespace: 'principal-a',
		store
	});
	expect(runtime?.socketTicket).toBeDefined();
	expect(storeOptions).toMatchObject({
		storageSchema: {
			components: [{ id: '@absolutejs/app', version: 1 }]
		}
	});
	expect(storeOptions?.protection?.prepare).toBeFunction();
	expect(await runtime?.socketTicket?.()).toBe('ticket');
	expect(backgroundConfiguration).toEqual({
		clientId: 'native-client',
		endpoint: 'https://app.example/__absolute/sync/background',
		intervalMinutes: 15,
		issuer: 'https://app.example',
		namespace: 'principal-a'
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(schemaStates).toEqual([
		{ state: 'preparing' },
		{
			minimumCompatibleVersion: 1,
			state: 'ready',
			storedVersion: 1,
			targetVersion: 1
		}
	]);
	let statusListenerRemoved = 0;
	const removeClient = runtime?.registerClient?.({
		discardDeadLetter: async () => undefined,
		flush: async () => ({ deadLetters: 0, pending: 0, timedOut: false }),
		listDeadLetters: async () => [],
		rebaseDeadLetter: async () => 'rebased',
		reconnect: () => undefined,
		retryDeadLetter: async () => undefined,
		status: () => ({
			automaticResolutions: 0,
			conflicts: 1,
			connection: 'online',
			deadLetters: 1,
			pending: 0
		}),
		subscribeStatus: (listener) => {
			listener({
				automaticResolutions: 0,
				conflicts: 1,
				connection: 'online',
				deadLetters: 1,
				pending: 0
			});

			return () => {
				statusListenerRemoved += 1;
			};
		}
	});
	expect(statuses).toEqual([
		{
			automaticResolutions: 0,
			conflicts: 1,
			connection: 'online',
			deadLetters: 1,
			pending: 0
		}
	]);
	removeClient?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(lifecycleRemoved).toBe(1);
	expect(statusListenerRemoved).toBe(1);

	principalListener?.({ namespace: 'principal-a' });
	expect(reloads).toBe(0);
	principalListener?.(null);
	expect(reloads).toBe(1);

	dispose();
	dispose();
	expect(principalListenerRemoved).toBe(1);
});

test('reports only typed schema failure evidence from native migration errors', async () => {
	const schemaStates: unknown[] = [];
	const store = createMemorySyncLocalStore();
	store.getSchemaStatus = async () =>
		Promise.reject({
			code: 'INVALID_PLAN',
			message: 'secret row and field detail',
			storedVersion: 1,
			targetVersion: 2
		});
	const dispose = installAbsoluteMobileShellSync(
		{
			clientId: 'native-client',
			fetch,
			issuer: 'https://app.example',
			principal: { namespace: 'principal-a' },
			redirectUri: 'com.example.app://auth/callback',
			onPrincipalChange: () => () => undefined,
			socketTicket: async () => 'ticket'
		},
		undefined,
		{
			clearBackground: async () => undefined,
			createStore: () => store,
			installLifecycle: async () => () => undefined,
			reportSchemaState: (state) => schemaStates.push(state)
		}
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(schemaStates).toEqual([
		{ state: 'preparing' },
		{
			code: 'INVALID_PLAN',
			state: 'failed',
			storedVersion: 1,
			targetVersion: 2
		}
	]);
	expect(JSON.stringify(schemaStates)).not.toContain('secret');
	dispose();
});

test('does not expose a locked partition and clears native work while signed out', async () => {
	let createdStore = 0;
	let backgroundClears = 0;
	const dispose = installAbsoluteMobileShellSync(
		{
			clientId: 'native-client',
			fetch,
			issuer: 'https://app.example',
			principal: null,
			redirectUri: 'com.example.app://auth/callback',
			onPrincipalChange: () => () => undefined,
			socketTicket: async () => 'ticket'
		},
		{
			background: {
				endpoint: 'https://app.example/__absolute/sync/background',
				intervalMinutes: 15
			},
			socketTickets: true,
			storageSchema: {
				components: [{ id: '@absolutejs/app', version: 1 }]
			}
		},
		{
			clearBackground: async () => {
				backgroundClears += 1;
			},
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
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(backgroundClears).toBe(1);
	dispose();
});
