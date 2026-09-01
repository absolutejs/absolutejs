import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

export const ABSOLUTE_AUTH_PACKAGE = '@absolutejs/auth' as const;
export const ABSOLUTE_EXPO_AUTH_CORE_VERSION = '0.75.6' as const;
export const ABSOLUTE_EXPO_AUTH_PACKAGE = '@absolutejs/auth-expo' as const;
export const ABSOLUTE_EXPO_AUTH_VERSION = '0.0.2' as const;
export const ABSOLUTE_EXPO_SYNC_CORE_VERSION = '2.31.0' as const;
export const ABSOLUTE_EXPO_SYNC_PACKAGE = '@absolutejs/sync-expo' as const;
export const ABSOLUTE_EXPO_SYNC_VERSION = '0.0.2' as const;
export const ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV =
	'ABSOLUTE_AUTH_NATIVE_CLIENTS' as const;
export const ABSOLUTE_NATIVE_AUTH_SCOPES = ['openid', 'profile'] as const;
export const ABSOLUTE_SYNC_PACKAGE = '@absolutejs/sync' as const;

export type AbsoluteMobileAuthManifest = {
	clientId: string;
	issuer: string;
	redirectUri: string;
	scopes: string[];
};

const readPackageManifest = (projectRoot: string) => {
	try {
		return JSON.parse(
			readFileSync(join(projectRoot, 'package.json'), 'utf8')
		);
	} catch {
		return undefined;
	}
};

const packageManifestHas = (manifest: unknown, packageName: string) => {
	if (typeof manifest !== 'object' || manifest === null) return false;

	return [
		Reflect.get(manifest, 'dependencies'),
		Reflect.get(manifest, 'devDependencies'),
		Reflect.get(manifest, 'optionalDependencies'),
		Reflect.get(manifest, 'peerDependencies')
	].some(
		(dependencies) =>
			typeof dependencies === 'object' &&
			dependencies !== null &&
			Object.hasOwn(dependencies, packageName)
	);
};

export const createAbsoluteMobileAuthManifest = (
	config: NormalizedAbsoluteMobileConfig
): AbsoluteMobileAuthManifest => {
	const scheme = config.deepLinkScheme ?? config.appId.toLowerCase();

	return {
		clientId: `absolutejs-native:${config.appId}`,
		issuer: config.productionOrigin,
		redirectUri: `${scheme}://auth/callback`,
		scopes: [...ABSOLUTE_NATIVE_AUTH_SCOPES]
	};
};

export const installAbsoluteMobileAuthEnvironment = (
	projectRoot: string,
	config: NormalizedAbsoluteMobileConfig
) => {
	const auth = resolveAbsoluteMobileAuthManifest(projectRoot, config);
	const serialized = serializeAbsoluteMobileAuthEnvironment(config, auth);
	if (serialized === undefined)
		delete process.env[ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV];
	else process.env[ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV] = serialized;

	return auth;
};

export const projectUsesAbsoluteAuth = (projectRoot: string) =>
	packageManifestHas(readPackageManifest(projectRoot), ABSOLUTE_AUTH_PACKAGE);

export const projectUsesAbsoluteSync = (projectRoot: string) =>
	packageManifestHas(readPackageManifest(projectRoot), ABSOLUTE_SYNC_PACKAGE);

export const resolveAbsoluteMobileAuthManifest = (
	projectRoot: string,
	config: NormalizedAbsoluteMobileConfig
) =>
	projectUsesAbsoluteAuth(projectRoot)
		? createAbsoluteMobileAuthManifest(config)
		: undefined;

export const serializeAbsoluteMobileAuthEnvironment = (
	config: NormalizedAbsoluteMobileConfig,
	auth: AbsoluteMobileAuthManifest | undefined
) =>
	auth === undefined
		? undefined
		: JSON.stringify([
				{
					...auth,
					name: `${config.appName} native app`
				}
			]);
