import { lifecycle, network } from '@absolutejs/devices';
import {
	createCapacitorSyncLocalStore,
	createCapacitorSyncProtection,
	AbsoluteBackgroundSync,
	configureCapacitorBackgroundSync,
	installCapacitorSyncLifecycle,
	type CapacitorSyncLifecycleOptions,
	type CapacitorSyncLocalStoreOptions
} from '@absolutejs/sync-capacitor';
import type {
	SyncClientStatus,
	SyncLocalStore,
	SyncLocalStoreSchemaStatus
} from '@absolutejs/sync/client';
import { installSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { AbsoluteMobileShellAuthRuntime } from './shellBootstrap';
import type { AbsoluteMobileClientManifest } from './transport';
import { installAbsoluteMobileSyncRemediation } from './syncRemediation';

export type AbsoluteMobileShellSyncOptions = {
	createStore?: (options?: CapacitorSyncLocalStoreOptions) => SyncLocalStore;
	installLifecycle?: (
		options: CapacitorSyncLifecycleOptions
	) => Promise<() => void>;
	reload?: () => void;
	reportStatus?: (status: SyncClientStatus) => void;
	reportSchemaState?: (state: AbsoluteMobileSyncSchemaState) => void;
	configureBackground?: typeof configureCapacitorBackgroundSync;
	clearBackground?: () => Promise<void>;
};

const reloadShell = () => globalThis.location.reload();
export const ABSOLUTE_MOBILE_SYNC_SCHEMA_EVENT = 'absolute:sync-schema';
export const ABSOLUTE_MOBILE_SYNC_SCHEMA_STATE_KEY =
	'absolutejs.mobile.sync.schema-state';
export const ABSOLUTE_MOBILE_SYNC_STATUS_EVENT = 'absolute:sync-status';

export type AbsoluteMobileSyncSchemaFailureCode =
	| 'INVALID_PLAN'
	| 'MIGRATION_MISSING'
	| 'SCHEMA_TOO_NEW'
	| 'SCHEMA_TOO_OLD'
	| 'UNKNOWN';

export type AbsoluteMobileSyncSchemaState =
	| { state: 'preparing' }
	| SyncLocalStoreSchemaStatus
	| {
			code: AbsoluteMobileSyncSchemaFailureCode;
			state: 'failed';
			storedVersion?: number;
			targetVersion?: number;
	  };

const schemaStateSymbol = () =>
	Symbol.for(ABSOLUTE_MOBILE_SYNC_SCHEMA_STATE_KEY);

export const readAbsoluteMobileSyncSchemaState = () => {
	const value: unknown = Reflect.get(globalThis, schemaStateSymbol());
	if (typeof value !== 'object' || value === null) return undefined;
	const state = Reflect.get(value, 'state');
	if (state === 'preparing') return { state };
	if (state === 'failed') return schemaFailureState(value);
	const minimumCompatibleVersion = Reflect.get(
		value,
		'minimumCompatibleVersion'
	);
	const storedVersion = Reflect.get(value, 'storedVersion');
	const targetVersion = Reflect.get(value, 'targetVersion');
	if (
		state !== 'ready' ||
		typeof minimumCompatibleVersion !== 'number' ||
		typeof storedVersion !== 'number' ||
		typeof targetVersion !== 'number'
	)
		return undefined;

	return {
		minimumCompatibleVersion,
		state,
		storedVersion,
		targetVersion
	};
};

const reportShellSchemaState = (state: AbsoluteMobileSyncSchemaState) => {
	Reflect.set(globalThis, schemaStateSymbol(), state);
	globalThis.dispatchEvent(
		new CustomEvent(ABSOLUTE_MOBILE_SYNC_SCHEMA_EVENT, { detail: state })
	);
};

const schemaFailureState = (error: unknown): AbsoluteMobileSyncSchemaState => {
	if (typeof error !== 'object' || error === null)
		return { code: 'UNKNOWN', state: 'failed' };
	const rawCode = Reflect.get(error, 'code');
	const code: AbsoluteMobileSyncSchemaFailureCode =
		rawCode === 'INVALID_PLAN' ||
		rawCode === 'MIGRATION_MISSING' ||
		rawCode === 'SCHEMA_TOO_NEW' ||
		rawCode === 'SCHEMA_TOO_OLD'
			? rawCode
			: 'UNKNOWN';
	const storedVersion = Reflect.get(error, 'storedVersion');
	const targetVersion = Reflect.get(error, 'targetVersion');

	return {
		code,
		state: 'failed',
		...(typeof storedVersion === 'number' ? { storedVersion } : {}),
		...(typeof targetVersion === 'number' ? { targetVersion } : {})
	};
};
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
		? (options.createStore?.({
				protection: createCapacitorSyncProtection(),
				storageSchema: config?.storageSchema
			}) ??
			createCapacitorSyncLocalStore({
				protection: createCapacitorSyncProtection(),
				storageSchema: config?.storageSchema
			}))
		: undefined;
	const installLifecycle =
		options.installLifecycle ?? installCapacitorSyncLifecycle;
	const reportStatus = options.reportStatus ?? reportShellStatus;
	const reportSchemaState =
		options.reportSchemaState ?? reportShellSchemaState;
	const configureBackground =
		options.configureBackground ?? configureCapacitorBackgroundSync;
	const clearBackground =
		options.clearBackground ?? (() => AbsoluteBackgroundSync.clear());
	if (store?.getSchemaStatus) {
		reportSchemaState({ state: 'preparing' });
		void store
			.getSchemaStatus()
			.then(reportSchemaState)
			.catch((error) => reportSchemaState(schemaFailureState(error)));
	}
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
	const removeRemediation = installAbsoluteMobileSyncRemediation();
	const reload = options.reload ?? reloadShell;
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
