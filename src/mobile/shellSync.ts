import { lifecycle, network } from '@absolutejs/devices';
import {
	createCapacitorSyncLocalStore,
	installCapacitorSyncLifecycle,
	type CapacitorSyncLifecycleOptions
} from '@absolutejs/sync-capacitor';
import type { SyncLocalStore } from '@absolutejs/sync/client';
import { installSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { AbsoluteMobileShellAuthRuntime } from './shellBootstrap';

export type AbsoluteMobileShellSyncOptions = {
	createStore?: () => SyncLocalStore;
	installLifecycle?: (
		options: CapacitorSyncLifecycleOptions
	) => Promise<() => void>;
	reload?: () => void;
};

const reloadShell = () => globalThis.location.reload();

/**
 * Provisions unchanged Sync clients with native durability, Auth isolation, and
 * foreground/connectivity reconnects. An identity change reloads the shell so
 * no page-held client can retain the previous account's in-memory rows.
 */
export const installAbsoluteMobileShellSync = (
	auth: AbsoluteMobileShellAuthRuntime,
	options: AbsoluteMobileShellSyncOptions = {}
) => {
	const namespace = auth.principal?.namespace;
	const store = namespace
		? (options.createStore?.() ?? createCapacitorSyncLocalStore())
		: undefined;
	const installLifecycle =
		options.installLifecycle ?? installCapacitorSyncLifecycle;
	const removeTransport = installSyncClientRuntimeTransport({
		...(namespace && store ? { durable: { namespace, store } } : {}),
		socketTicket: auth.socketTicket,
		registerClient: (client) => {
			let active = true;
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
