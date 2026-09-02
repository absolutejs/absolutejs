import { createHash } from 'node:crypto';
import {
	resolveAbsoluteDeviceCapabilityPlan,
	type AbsoluteDeviceCapabilityPlan
} from './deviceCapabilities';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	projectUsesAbsoluteSync,
	resolveAbsoluteMobileAuthManifest,
	type AbsoluteMobileAuthManifest
} from './nativeAuth';
import type { SyncLocalStoreSchemaBundle } from '@absolutejs/sync/client';
import { canonicalizeAbsoluteMobileUpdate } from './updateProtocol';
import { discoverAbsoluteSyncSchema } from './syncSchema';

export const ABSOLUTE_MOBILE_SHELL_ABI = 2 as const;
export const ABSOLUTE_MOBILE_UPDATE_RUNTIME_FORMAT = 1 as const;

export type AbsoluteMobileUpdateRuntimeDescriptor = {
	appId: string;
	auth: AbsoluteMobileAuthManifest | null;
	deepLinks: { hosts: string[]; scheme?: string };
	deviceCapabilities: AbsoluteDeviceCapabilityPlan;
	engine: 'capacitor' | 'expo';
	format: typeof ABSOLUTE_MOBILE_UPDATE_RUNTIME_FORMAT;
	shellAbi: typeof ABSOLUTE_MOBILE_SHELL_ABI;
	syncSchema: SyncLocalStoreSchemaBundle | null;
	updates: NormalizedAbsoluteMobileConfig['updates'] | null;
};

export const createAbsoluteMobileUpdateRuntimeDescriptor = (options: {
	auth?: AbsoluteMobileAuthManifest;
	config: NormalizedAbsoluteMobileConfig;
	deviceCapabilities: AbsoluteDeviceCapabilityPlan;
	syncSchema?: SyncLocalStoreSchemaBundle;
}): AbsoluteMobileUpdateRuntimeDescriptor => ({
	appId: options.config.appId,
	auth: options.auth ?? null,
	deepLinks: {
		hosts: options.config.deepLinkHosts,
		...(options.config.deepLinkScheme
			? { scheme: options.config.deepLinkScheme }
			: {})
	},
	deviceCapabilities: options.deviceCapabilities,
	engine: options.config.engine,
	format: ABSOLUTE_MOBILE_UPDATE_RUNTIME_FORMAT,
	shellAbi: ABSOLUTE_MOBILE_SHELL_ABI,
	syncSchema: options.syncSchema ?? null,
	updates: options.config.updates ?? null
});

export const fingerprintAbsoluteMobileUpdateRuntime = (
	descriptor: AbsoluteMobileUpdateRuntimeDescriptor
) =>
	createHash('sha256')
		.update(canonicalizeAbsoluteMobileUpdate(descriptor))
		.digest('hex');

/** Resolve the complete native contract once so store builds and OTA exports
 * can never disagree about runtime compatibility. */
export const resolveAbsoluteMobileUpdateRuntime = (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const auth = resolveAbsoluteMobileAuthManifest(projectRoot, config);
	const sync = auth !== undefined && projectUsesAbsoluteSync(projectRoot);
	const syncSchema = sync
		? discoverAbsoluteSyncSchema(projectRoot)
		: undefined;
	const deviceCapabilities = resolveAbsoluteDeviceCapabilityPlan(
		projectRoot,
		config.engine
	);
	const descriptor = createAbsoluteMobileUpdateRuntimeDescriptor({
		...(auth ? { auth } : {}),
		config,
		deviceCapabilities,
		...(syncSchema ? { syncSchema } : {})
	});

	return {
		auth,
		descriptor,
		deviceCapabilities,
		fingerprint: fingerprintAbsoluteMobileUpdateRuntime(descriptor),
		sync,
		syncSchema
	};
};
