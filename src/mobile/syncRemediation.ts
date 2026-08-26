import {
	discardSyncRuntimeDeadLetter,
	inspectSyncRuntime,
	rebaseSyncRuntimeDeadLetter,
	retrySyncRuntimeDeadLetter,
	type SyncRuntimeInspection
} from '@absolutejs/sync/client/runtime';

export type AbsoluteMobileSyncRemediation = {
	discard: (operationId: string) => Promise<void>;
	inspect: () => Promise<SyncRuntimeInspection>;
	rebase: (operationId: string, args: unknown) => Promise<string>;
	retry: (operationId: string) => Promise<void>;
};

type Installation = { bridge: AbsoluteMobileSyncRemediation };
type Registry = { installations: Installation[] };
const REMEDIATION_REGISTRY = Symbol.for('@absolutejs/mobile-sync-remediation');
const LAST_INSTALLATION_OFFSET = -1;
const isRegistry = (value: unknown): value is Registry =>
	typeof value === 'object' &&
	value !== null &&
	Array.isArray(Reflect.get(value, 'installations'));
const resolveRegistry = () => {
	const existing: unknown = Reflect.get(globalThis, REMEDIATION_REGISTRY);
	if (isRegistry(existing)) return existing;
	const created: Registry = { installations: [] };
	Object.defineProperty(globalThis, REMEDIATION_REGISTRY, {
		configurable: false,
		enumerable: false,
		value: created,
		writable: false
	});

	return created;
};
const registry = resolveRegistry();

/** Install the native shell's framework-neutral, redacted remediation bridge. */
export const getAbsoluteMobileSyncRemediation = () =>
	registry.installations.at(LAST_INSTALLATION_OFFSET)?.bridge;
export const installAbsoluteMobileSyncRemediation = (
	bridge: AbsoluteMobileSyncRemediation = {
		discard: discardSyncRuntimeDeadLetter,
		inspect: inspectSyncRuntime,
		rebase: rebaseSyncRuntimeDeadLetter,
		retry: retrySyncRuntimeDeadLetter
	}
) => {
	const installation: Installation = { bridge };
	registry.installations.push(installation);

	return () => {
		const index = registry.installations.indexOf(installation);
		if (index >= 0) registry.installations.splice(index, 1);
	};
};
