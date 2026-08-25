import { lifecycle, network } from '@absolutejs/devices';
import {
	createCapacitorSyncLocalStore,
	AbsoluteBackgroundSync,
	configureCapacitorBackgroundSync,
	installCapacitorSyncLifecycle,
	type CapacitorSyncLifecycleOptions
} from '@absolutejs/sync-capacitor';
import type { SyncClientStatus, SyncLocalStore } from '@absolutejs/sync/client';
import { installSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { AbsoluteMobileShellAuthRuntime } from './shellBootstrap';
import type { AbsoluteMobileClientManifest } from './transport';

export type AbsoluteMobileShellSyncOptions = {
	createStore?: () => SyncLocalStore;
	installLifecycle?: (
		options: CapacitorSyncLifecycleOptions
	) => Promise<() => void>;
	reload?: () => void;
	reportStatus?: (status: SyncClientStatus) => void;
	configureBackground?: typeof configureCapacitorBackgroundSync;
	clearBackground?: () => Promise<void>;
};

const reloadShell = () => globalThis.location.reload();
export const ABSOLUTE_MOBILE_SYNC_STATUS_EVENT = 'absolute:sync-status';
const reportShellStatus = (status: SyncClientStatus) =>
	globalThis.dispatchEvent(
		new CustomEvent(ABSOLUTE_MOBILE_SYNC_STATUS_EVENT, { detail: status })
	);

/**
 * Provisions unchanged Sync clients with native durability, Auth isolation, and
 * foreground/connectivity reconnects. An identity change reloads the shell so
 * no page-held client can retain the previous account's in-memory rows.
 */
export const installAbsoluteMobileShellSync = (
	auth: AbsoluteMobileShellAuthRuntime,
	config?: NonNullable<AbsoluteMobileClientManifest['sync']>,
	options: AbsoluteMobileShellSyncOptions = {}
) => {
	const namespace = auth.principal?.namespace;
	const store = namespace
		? (options.createStore?.() ?? createCapacitorSyncLocalStore())
		: undefined;
	const installLifecycle =
		options.installLifecycle ?? installCapacitorSyncLifecycle;
	const reportStatus = options.reportStatus ?? reportShellStatus;
	const configureBackground =
		options.configureBackground ?? configureCapacitorBackgroundSync;
	const clearBackground =
		options.clearBackground ?? (() => AbsoluteBackgroundSync.clear());
	if (namespace && config) {
		void configureBackground({
			clientId: auth.clientId,
			endpoint: config.background.endpoint,
			intervalMinutes: config.background.intervalMinutes,
			issuer: auth.issuer,
			namespace
		}).catch((error) =>
			console.error(
				'[Absolute Mobile] Background Sync configuration failed:',
				error
			)
		);
	} else {
		void clearBackground().catch(() => undefined);
	}
	const removeTransport = installSyncClientRuntimeTransport({
		...(namespace && store ? { durable: { namespace, store } } : {}),
		socketTicket: auth.socketTicket,
		registerClient: (client) => {
			let active = true;
			const removeStatus = client.subscribeStatus(reportStatus);
			const reportLifecycleFailure = (error: unknown) =>
				console.error(
					'[Absolute Mobile] Sync lifecycle installation failed:',
					error
				);
			const removal = installLifecycle({
				client,
				lifecycle,
				network
			}).catch((error) => {
				reportLifecycleFailure(error);

				return undefined;
			});

			return () => {
				if (!active) return;
				active = false;
				removeStatus();
				void removal.then((remove) => remove?.());
			};
		}
	});
	const reload = options.reload ?? reloadShell;
	const removePrincipalListener = auth.onPrincipalChange((principal) => {
		if (principal?.namespace !== namespace) reload();
	});
	let active = true;

	return () => {
		if (!active) return;
		active = false;
		removePrincipalListener();
		removeTransport();
	};
};
