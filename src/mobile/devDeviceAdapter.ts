import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MobileConfig } from '../../types/build';
import { normalizeAbsoluteMobileConfig } from './config';
import { resolveAbsoluteDeviceCapabilityPlan } from './deviceCapabilities';
import {
	projectUsesAbsoluteAuth,
	projectUsesAbsoluteSync,
	resolveAbsoluteMobileAuthManifest
} from './nativeAuth';
import { discoverAbsoluteSyncSchema } from './syncSchema';

export const absoluteNativeDevAdapterSource = (
	projectRoot: string,
	mobile: MobileConfig,
	resolveModule: (specifier: string) => string = (specifier) => specifier,
	expoAdapterModule = '@absolutejs/absolute/mobile/expo-devices',
	expoAuthModule = '@absolutejs/absolute/mobile/expo-auth',
	expoSyncModule = '@absolutejs/absolute/mobile/expo-sync'
) => {
	if ((mobile.engine ?? 'capacitor') === 'expo') {
		const normalized = normalizeAbsoluteMobileConfig(mobile, projectRoot);
		const auth = projectUsesAbsoluteAuth(projectRoot)
			? resolveAbsoluteMobileAuthManifest(projectRoot, normalized)
			: undefined;
		const sync = Boolean(auth && projectUsesAbsoluteSync(projectRoot));
		const syncConfig = sync
			? {
					background: {
						endpoint: new URL(
							'/__absolute/sync/background',
							normalized.productionOrigin
						).href,
						intervalMinutes: 15
					},
					socketTickets: true as const,
					storageSchema: discoverAbsoluteSyncSchema(projectRoot)
				}
			: undefined;

		return `import { installAbsoluteExpoWebDeviceAdapter } from ${JSON.stringify(expoAdapterModule)};
${auth ? `import { createAbsoluteExpoShellAuth } from ${JSON.stringify(expoAuthModule)};` : ''}
${sync ? `import { installAbsoluteExpoShellSync } from ${JSON.stringify(expoSyncModule)};` : ''}
installAbsoluteExpoWebDeviceAdapter();
${auth ? `void createAbsoluteExpoShellAuth(${JSON.stringify(auth)}).then(auth => { ${sync ? `installAbsoluteExpoShellSync(auth, ${JSON.stringify(syncConfig)});` : ''} }).catch(error => console.error('[Absolute Mobile] Expo runtime initialization failed:', error));` : ''}`;
	}
	const plan = resolveAbsoluteDeviceCapabilityPlan(projectRoot);
	const imports = plan.capabilities.map((name, index) => {
		const provider = plan.providers[name];
		if (!provider)
			throw new TypeError(`Missing device capability provider ${name}.`);

		return `import { ${provider.factory} as absoluteDeviceCapability${index} } from ${JSON.stringify(resolveModule(provider.module))};`;
	});
	const capabilities = plan.capabilities
		.map(
			(name, index) =>
				`${JSON.stringify(name)}: absoluteDeviceCapability${index}()`
		)
		.join(', ');

	return [
		`import { installCapacitorDeviceAdapterIfNative } from ${JSON.stringify(resolveModule('@absolutejs/devices-capacitor'))};`,
		...imports,
		`installCapacitorDeviceAdapterIfNative({ storagePrefix: ${JSON.stringify(`absolutejs.${mobile.appId}.`)}${capabilities ? `, ${capabilities}` : ''} });`
	].join('\n');
};

const expoAdapterPath = async () => {
	const candidates = await Promise.all(
		['ts', 'js'].map(async (extension) => {
			const path = join(import.meta.dir, `shellExpoDevices.${extension}`);
			try {
				await access(path);

				return path;
			} catch {
				return undefined;
			}
		})
	);
	const path = candidates.find((candidate) => candidate !== undefined);
	if (path) return path;
	throw new TypeError('The AbsoluteJS Expo development adapter is missing.');
};

const expoAuthPath = async () => {
	const candidates = await Promise.all(
		['ts', 'js'].map(async (extension) => {
			const path = join(import.meta.dir, `shellExpoAuth.${extension}`);
			try {
				await access(path);

				return path;
			} catch {
				return undefined;
			}
		})
	);
	const path = candidates.find((candidate) => candidate !== undefined);
	if (path) return path;
	throw new TypeError(
		'The AbsoluteJS Expo Auth development adapter is missing.'
	);
};

const expoSyncPath = async () => {
	const candidates = await Promise.all(
		['ts', 'js'].map(async (extension) => {
			const path = join(import.meta.dir, `shellExpoSync.${extension}`);
			try {
				await access(path);

				return path;
			} catch {
				return undefined;
			}
		})
	);
	const path = candidates.find((candidate) => candidate !== undefined);
	if (path) return path;
	throw new TypeError(
		'The AbsoluteJS Expo Sync development adapter is missing.'
	);
};

export const buildAbsoluteNativeDevAdapter = async (
	projectRoot: string,
	mobile: MobileConfig
) => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'absolutejs-native-dev-adapter-')
	);
	const entry = join(temporaryDirectory, 'entry.ts');
	try {
		await writeFile(
			entry,
			absoluteNativeDevAdapterSource(
				projectRoot,
				mobile,
				(specifier) => Bun.resolveSync(specifier, projectRoot),
				await expoAdapterPath(),
				await expoAuthPath(),
				await expoSyncPath()
			)
		);
		const result = await Bun.build({
			entrypoints: [entry],
			format: 'esm',
			minify: true,
			target: 'browser'
		});
		if (!result.success || result.outputs.length !== 1) {
			throw new AggregateError(
				result.logs,
				'Failed to build the AbsoluteJS native development device adapter.'
			);
		}

		return result.outputs[0]?.text() ?? '';
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
};
