import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Elysia } from 'elysia';
import type { MobileConfig } from '../../types/build';
import { buildAbsoluteMobileCompatibilityRelease } from './buildRelease';
import { materializeAbsoluteCapacitorWebBundle } from './capacitorBundle';
import { normalizeAbsoluteMobileConfig } from './config';
import {
	materializeAbsoluteMobileCompatibilityBundle,
	readAbsoluteMobileMaterializedReleases
} from './materializedBundle';
import { ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION } from './pageProtocol';
import { retainAbsoluteMobileCompatibilityArtifacts } from './releaseArtifact';
import {
	projectUsesAbsoluteSync,
	resolveAbsoluteMobileAuthManifest
} from './nativeAuth';
import { discoverAbsoluteSyncSchema } from './syncSchema';
import {
	assertAbsoluteDeviceCapabilityPackages,
	resolveAbsoluteDeviceCapabilityPlan
} from './deviceCapabilities';

export type FinalizeAbsoluteMobileBuildOptions = {
	buildDirectory: string;
	configPath?: string;
	mobile: MobileConfig;
	producerPath: string;
	projectRoot: string;
};

type ServerModule = {
	app?: unknown;
	default?: unknown;
	server?: unknown;
};

type StringRecord = Record<string, string>;

const isElysiaApp = (
	value: unknown
): value is Pick<Elysia, 'compile' | 'modules' | 'routes'> =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'compile') === 'function' &&
	Array.isArray(Reflect.get(value, 'routes'));

const isStringRecord = (value: unknown): value is StringRecord =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	Object.values(value).every((entry) => typeof entry === 'string');

const serverExportName = (loaded: ServerModule, app: unknown) => {
	if (loaded.server === app) return 'server';
	if (loaded.app === app) return 'app';

	return 'default';
};

const restoreEnvironmentVariable = (
	name:
		| 'ABSOLUTE_BUILD_DIR'
		| 'ABSOLUTE_COMPILED_RUNTIME'
		| 'ABSOLUTE_CONFIG',
	previous: string | undefined
) => {
	if (previous !== undefined) process.env[name] = previous;
	else delete process.env[name];
};

const requireRelease = <T>(releases: Map<string, T>, releaseId: string) => {
	const release = releases.get(releaseId);
	if (!release) {
		throw new TypeError(`Missing retained mobile release ${releaseId}.`);
	}

	return release;
};

const loadServerApp = async (producerPath: string) => {
	const loaded: ServerModule = await import(
		`${pathToFileURL(producerPath).href}?absolute-mobile-capture=${crypto.randomUUID()}`
	);
	const candidates = [loaded.server, loaded.app, loaded.default];
	const app = candidates.find(isElysiaApp);
	if (!app) {
		throw new TypeError(
			'Mobile builds require the server entry to export its Elysia app as server, app, or default.'
		);
	}
	const exportName = serverExportName(loaded, app);

	return { app, exportName };
};

export const finalizeAbsoluteMobileCompatibilityBuild = async (
	options: FinalizeAbsoluteMobileBuildOptions
) => {
	const buildDirectory = resolve(options.buildDirectory);
	const mobile = normalizeAbsoluteMobileConfig(
		options.mobile,
		options.projectRoot
	);
	const root = join(buildDirectory, '.absolutejs', 'mobile-compatibility');
	const [manifestSource, previous] = await Promise.all([
		readFile(join(buildDirectory, 'manifest.json'), 'utf8'),
		readAbsoluteMobileMaterializedReleases(root)
	]);
	const manifest: unknown = JSON.parse(manifestSource);
	if (!isStringRecord(manifest)) {
		throw new TypeError(
			'Invalid AbsoluteJS build manifest for mobile capture.'
		);
	}
	const previousBuildDirectory = process.env.ABSOLUTE_BUILD_DIR;
	const previousCompiledRuntime = process.env.ABSOLUTE_COMPILED_RUNTIME;
	const previousConfigPath = process.env.ABSOLUTE_CONFIG;
	process.env.ABSOLUTE_BUILD_DIR = buildDirectory;
	process.env.ABSOLUTE_COMPILED_RUNTIME = '1';
	if (options.configPath) {
		process.env.ABSOLUTE_CONFIG = resolve(
			options.projectRoot,
			options.configPath
		);
	}
	let loaded: Awaited<ReturnType<typeof loadServerApp>>;
	try {
		loaded = await loadServerApp(resolve(options.producerPath));
	} finally {
		restoreEnvironmentVariable(
			'ABSOLUTE_BUILD_DIR',
			previousBuildDirectory
		);
		restoreEnvironmentVariable(
			'ABSOLUTE_COMPILED_RUNTIME',
			previousCompiledRuntime
		);
		restoreEnvironmentVariable('ABSOLUTE_CONFIG', previousConfigPath);
	}
	const current = await buildAbsoluteMobileCompatibilityRelease({
		app: loaded.app,
		appId: mobile.appId,
		buildDirectory,
		manifest,
		previousArtifacts: previous.map(({ artifact }) => artifact),
		producerExport: loaded.exportName,
		producerPath: resolve(options.producerPath),
		runtime: String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION)
	});
	const auth = resolveAbsoluteMobileAuthManifest(options.projectRoot, mobile);
	const sync =
		auth !== undefined && projectUsesAbsoluteSync(options.projectRoot);
	const syncSchema = sync
		? discoverAbsoluteSyncSchema(options.projectRoot)
		: undefined;
	const deviceCapabilities = resolveAbsoluteDeviceCapabilityPlan(
		options.projectRoot
	);
	const usesPush =
		deviceCapabilities.capabilities.includes('pushNotifications');
	if (usesPush && !auth)
		throw new TypeError(
			'Portable push notifications require @absolutejs/auth so provider tokens can be registered without exposing identity controls to page code.'
		);
	if (
		usesPush &&
		!loaded.app.routes.some((route) => route.path === '/auth/mobile/push')
	)
		throw new TypeError(
			'@absolutejs/devices pushNotifications is used, but Auth nativePush is not configured. Pass a server-side registrar to auth({ nativePush: ... }).'
		);
	assertAbsoluteDeviceCapabilityPackages(
		options.projectRoot,
		deviceCapabilities
	);
	if (
		auth &&
		!loaded.app.routes.some(
			(route) => route.path === '/.well-known/openid-configuration'
		)
	) {
		throw new TypeError(
			'@absolutejs/auth is installed, but its OIDC provider is not mounted. Native authentication requires the auth oidc configuration so AbsoluteJS can provision a public PKCE client.'
		);
	}
	const releasesById = new Map(
		[current, ...previous].map((release) => [
			release.artifact.releaseId,
			release
		])
	);
	const retained = retainAbsoluteMobileCompatibilityArtifacts(
		[...releasesById.values()].map(({ artifact }) => artifact)
	);
	await materializeAbsoluteMobileCompatibilityBundle({
		currentReleaseId: current.artifact.releaseId,
		releases: retained.map((artifact) =>
			requireRelease(releasesById, artifact.releaseId)
		),
		root
	});
	await materializeAbsoluteCapacitorWebBundle({
		artifact: current.artifact,
		...(auth ? { auth } : {}),
		buildDirectory,
		config: mobile,
		deviceCapabilities,
		projectRoot: options.projectRoot,
		...(sync ? { sync: true } : {}),
		...(syncSchema
			? { syncSchema: { components: syncSchema.components } }
			: {})
	});

	return current.artifact;
};
