import {
	createExpoSyncBridgeLocalStore,
	createExpoSyncBridgeWebSocket,
	type AbsoluteExpoSyncBridgeProvider
} from '@absolutejs/sync-expo/client';
import type { SyncClientStatus } from '@absolutejs/sync/client';
import { installSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { AbsoluteMobileShellAuthRuntime } from './shellBootstrap';
import type { AbsoluteMobileClientManifest } from './transport';
import { installAbsoluteMobileSyncRemediation } from './syncRemediation';

type ExpoBridge = AbsoluteExpoSyncBridgeProvider & {
	on(
		event: 'sync.socket' | 'sync.wake',
		listener: (payload: Record<string, unknown>) => void
	): () => void;
};

export type AbsoluteExpoShellSyncOptions = {
	provider?: ExpoBridge;
	reload?: () => void;
	reportStatus?: (status: SyncClientStatus) => void;
};

const requireBridge = (): ExpoBridge => {
	const value: unknown = Reflect.get(globalThis, '__absoluteExpoBridge');
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof Reflect.get(value, 'request') !== 'function' ||
		typeof Reflect.get(value, 'on') !== 'function'
	)
		throw new TypeError('The Expo Sync bridge is unavailable.');

	return {
		on: (event, listener) =>
			Reflect.apply(Reflect.get(value, 'on'), value, [event, listener]),
		request: (method, params) =>
			Promise.resolve(
				Reflect.apply(Reflect.get(value, 'request'), value, [
					method,
					params
				])
			)
	};
};

const reportShellStatus = (status: SyncClientStatus) =>
	globalThis.dispatchEvent(
		new CustomEvent('absolute:sync-status', { detail: status })
	);

/**
 * Gives unchanged WebView page clients native-owned SQLite and sockets. Auth
 * namespaces and socket tickets never cross into page-controlled JavaScript.
 */
export const installAbsoluteExpoShellSync = (
	auth: AbsoluteMobileShellAuthRuntime,
	config?: NonNullable<AbsoluteMobileClientManifest['sync']>,
	options: AbsoluteExpoShellSyncOptions = {}
) => {
	const provider = options.provider ?? requireBridge();
	const namespace = auth.principal?.namespace;
	const store =
		namespace && config
			? createExpoSyncBridgeLocalStore({
					provider,
					storageSchema: config.storageSchema
				})
			: undefined;
	const WebSocketImpl = createExpoSyncBridgeWebSocket(provider);
	const reportStatus = options.reportStatus ?? reportShellStatus;
	const removeTransport = installSyncClientRuntimeTransport({
		...(namespace && store ? { durable: { namespace, store } } : {}),
		webSocketImpl: WebSocketImpl,
		registerClient: (client) => {
			const removeStatus = client.subscribeStatus(reportStatus);
			const removeWake = provider.on('sync.wake', () => {
				client.reconnect();
				void client.flush({ timeoutMs: 10_000 }).catch(() => undefined);
			});

			return () => {
				removeStatus();
				removeWake();
			};
		}
	});
	const removeRemediation = installAbsoluteMobileSyncRemediation();
	const reload = options.reload ?? (() => globalThis.location.reload());
	const removePrincipalListener = auth.onPrincipalChange((principal) => {
		if (principal?.namespace !== namespace) reload();
	});
	let active = true;

	return () => {
		if (!active) return;
		active = false;
		removePrincipalListener();
		removeRemediation();
		removeTransport();
	};
};
