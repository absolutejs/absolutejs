import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { projectUsesAbsoluteSync } from './nativeAuth';
import { discoverAbsoluteSyncSchema } from './syncSchema';
import {
	absoluteDeviceNativeRequirements,
	assertAbsoluteDeviceCapabilityPackages,
	resolveAbsoluteDeviceCapabilityPlan,
	type AbsoluteIosUsageDescription
} from './deviceCapabilities';

export type AbsoluteMobileReleaseCheck = {
	detail: string;
	id: string;
	path?: string;
	remediation?: string;
	status: 'fail' | 'pass';
};

export type AbsoluteMobileReleaseDoctorResult = {
	checks: AbsoluteMobileReleaseCheck[];
	ready: boolean;
};

const HMR_ASSET_PATTERN =
	/(?:__HMR_WS__|hmr-timing|__absolute_target|absolutejs-error-overlay)/u;
const RELEASE_ASSET_EXTENSIONS = new Set(['.html', '.js', '.mjs']);
type HmrAssetFinder = (root: string) => Promise<string | undefined>;

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const inspectReleaseAsset = async (
	path: string,
	isDirectory: boolean,
	isFile: boolean
) => {
	if (isDirectory) return findHmrAsset(path);
	if (!isFile || !RELEASE_ASSET_EXTENSIONS.has(extname(path)))
		return undefined;
	const source = await readFile(path, 'utf8');

	return HMR_ASSET_PATTERN.test(source) ? path : undefined;
};

const findHmrAsset: HmrAssetFinder = async (root) => {
	if (!(await pathExists(root))) return undefined;
	const entries = await readdir(root, { withFileTypes: true });
	const matches = await Promise.all(
		entries.map((entry) =>
			inspectReleaseAsset(
				join(root, entry.name),
				entry.isDirectory(),
				entry.isFile()
			)
		)
	);

	return matches.find((match) => match !== undefined);
};

const pass = (
	id: string,
	detail: string,
	path?: string
): AbsoluteMobileReleaseCheck => ({ detail, id, path, status: 'pass' });

const fail = (
	id: string,
	detail: string,
	path: string,
	remediation: string
): AbsoluteMobileReleaseCheck => ({
	detail,
	id,
	path,
	remediation,
	status: 'fail'
});

const journalReleaseCheck = async (
	journalPath: string,
	platform: 'android' | 'ios'
) =>
	(await pathExists(journalPath))
		? fail(
				`${platform}.dev-journal`,
				'A live-reload recovery journal is still active.',
				journalPath,
				'Close the development session or run mobile doctor again after stale-session repair.'
			)
		: pass(
				`${platform}.dev-journal`,
				'No live-reload recovery journal is active.',
				journalPath
			);

const parsedJson = (source: string) => {
	try {
		const parsed: unknown = JSON.parse(source);

		return parsed;
	} catch {
		return undefined;
	}
};

const capacitorServer = (parsed: unknown) => {
	if (typeof parsed !== 'object' || parsed === null) return undefined;
	const server = Reflect.get(parsed, 'server');

	return typeof server === 'object' && server !== null ? server : undefined;
};

const isUnsafeCapacitorConfig = (source: string) => {
	const parsed = parsedJson(source);
	const server = capacitorServer(parsed);
	if (parsed === undefined) return true;
	if (!server) return false;
	const allowNavigation = Reflect.get(server, 'allowNavigation');

	return (
		typeof Reflect.get(server, 'url') === 'string' ||
		Reflect.get(server, 'cleartext') === true ||
		(Array.isArray(allowNavigation) && allowNavigation.length > 0)
	);
};

const capacitorConfigReleaseCheck = async (nativeConfigPath: string) => {
	if (!(await pathExists(nativeConfigPath))) {
		return fail(
			'android.capacitor-config',
			'The generated Android Capacitor config is missing.',
			nativeConfigPath,
			'Run `absolute mobile sync android` before release validation.'
		);
	}
	const unsafe = isUnsafeCapacitorConfig(
		await readFile(nativeConfigPath, 'utf8')
	);

	return unsafe
		? fail(
				'android.capacitor-config',
				'Android Capacitor config contains a development server URL, cleartext transport, navigation allowlist, or invalid JSON.',
				nativeConfigPath,
				'Run `absolute mobile sync android`; do not ship development transport overrides.'
			)
		: pass(
				'android.capacitor-config',
				'Android Capacitor config contains no development transport overrides.',
				nativeConfigPath
			);
};

const manifestReleaseCheck = async (manifestPath: string) => {
	if (!(await pathExists(manifestPath))) {
		return fail(
			'android.cleartext',
			'The Android manifest is missing.',
			manifestPath,
			'Run `absolute mobile sync android` before release validation.'
		);
	}
	const source = await readFile(manifestPath, 'utf8');
	const cleartext = /android:usesCleartextTraffic=["']true["']/u.test(source);
	const networkConfigName = source.match(
		/android:networkSecurityConfig=["']@xml\/([a-z0-9_]+)["']/u
	)?.[1];
	const networkConfigPath = networkConfigName
		? join(dirname(manifestPath), 'res', 'xml', `${networkConfigName}.xml`)
		: undefined;
	const developmentTrustReference =
		/android:networkSecurityConfig=["']@xml\/absolutejs_dev_network_security["']/u.test(
			source
		);
	const developmentTrustContents = networkConfigPath
		? await readFile(networkConfigPath, 'utf8')
				.then((value) => value.includes('@raw/absolutejs_dev_ca'))
				.catch(() => false)
		: false;
	const developmentTrust =
		developmentTrustReference || developmentTrustContents;

	return cleartext || developmentTrust
		? fail(
				'android.cleartext',
				developmentTrust
					? 'Android still references the AbsoluteJS development certificate authority.'
					: 'Android explicitly permits cleartext traffic.',
				manifestPath,
				'Run `absolute mobile sync android`; do not ship development transport or trust overrides.'
			)
		: pass(
				'android.cleartext',
				'Android does not explicitly permit cleartext traffic.',
				manifestPath
			);
};

const hmrAssetsReleaseCheck = async (publicRoot: string) => {
	const hmrAsset = await findHmrAsset(publicRoot);

	return hmrAsset
		? fail(
				'android.hmr-assets',
				'A packaged Android asset contains the development HMR client.',
				hmrAsset,
				'Rebuild the production mobile bundle and run Capacitor sync again.'
			)
		: pass(
				'android.hmr-assets',
				'Packaged Android assets contain no development HMR markers.',
				publicRoot
			);
};

const syncSchemaReleaseCheck = (projectRoot: string) => {
	if (!projectUsesAbsoluteSync(projectRoot)) return undefined;
	const manifestPath = join(projectRoot, 'package.json');
	try {
		const schema = discoverAbsoluteSyncSchema(projectRoot);
		const versions = schema.components
			.map((component) => `${component.id}@${component.version}`)
			.join(', ');
		const collectionRules = schema.components.flatMap(
			(component) => component.localData?.collections ?? []
		);
		const mutationRules = schema.components.flatMap(
			(component) => component.localData?.mutations ?? []
		);
		const protectedCount = [...collectionRules, ...mutationRules].filter(
			(rule) => rule.protection === 'required'
		).length;
		const memoryOnlyCount = [...collectionRules, ...mutationRules].filter(
			(rule) =>
				rule.persistence === 'memory-only' ||
				rule.onProtectionUnavailable === 'memory-only'
		).length;
		type ConflictCounts = {
			clientWins: number;
			manual: number;
			serverWins: number;
		};
		const conflictCounts: ConflictCounts = {
			clientWins: mutationRules.filter(
				(rule) => rule.conflict?.strategy === 'client-wins'
			).length,
			manual: mutationRules.filter(
				(rule) => rule.conflict?.strategy === 'manual'
			).length,
			serverWins: mutationRules.filter(
				(rule) => rule.conflict?.strategy === 'server-wins'
			).length
		};
		const quotas = schema.components
			.map((component) => component.localData?.maxBytesPerNamespace)
			.filter((value): value is number => value !== undefined);
		const policy = `${collectionRules.length} collection rule(s), ${mutationRules.length} mutation rule(s), ${protectedCount} encryption-required, ${memoryOnlyCount} memory-only fallback(s), conflicts ${conflictCounts.clientWins} client-wins/${conflictCounts.serverWins} server-wins/${conflictCounts.manual} manual${quotas.length > 0 ? `, ${Math.min(...quotas)}-byte effective quota` : ', no logical quota'}`;

		return pass(
			'sync.storage-schema',
			`Generated offline schema is compatible: ${versions}; ${policy}.`,
			manifestPath
		);
	} catch (error) {
		return fail(
			'sync.storage-schema',
			error instanceof Error
				? error.message
				: 'Generated offline schema metadata is invalid.',
			manifestPath,
			'Fix absolutejs.sync.localSchema metadata in the named app or package before releasing.'
		);
	}
};

const IOS_USAGE_KEYS: Record<AbsoluteIosUsageDescription, string> = {
	camera: 'NSCameraUsageDescription',
	'location-always': 'NSLocationAlwaysAndWhenInUseUsageDescription',
	'location-when-in-use': 'NSLocationWhenInUseUsageDescription',
	'photo-library': 'NSPhotoLibraryUsageDescription',
	'photo-library-add': 'NSPhotoLibraryAddUsageDescription'
};

const androidDevicePermissionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	permissions: string[]
) => {
	if (!config.platforms.includes('android') || permissions.length === 0)
		return undefined;
	const path = join(
		config.nativeProjectDirectory,
		'android/app/src/main/AndroidManifest.xml'
	);
	const source = await readFile(path, 'utf8');
	const missing = permissions.filter(
		(permission) =>
			!source.includes(`android:name="${permission}"`) &&
			!source.includes(`android:name='${permission}'`)
	);
	if (missing.length === 0) return undefined;

	return fail(
		'mobile.device-capabilities',
		`Android is missing native declarations for: ${missing.join(', ')}.`,
		path,
		'Run `absolute mobile sync android` to regenerate detected device permissions.'
	);
};

const iosDevicePermissionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	purposes: AbsoluteIosUsageDescription[]
) => {
	if (!config.platforms.includes('ios') || purposes.length === 0)
		return undefined;
	const path = join(config.nativeProjectDirectory, 'ios/App/App/Info.plist');
	const source = await readFile(path, 'utf8');
	const missing = purposes.filter(
		(purpose) => !source.includes(`<key>${IOS_USAGE_KEYS[purpose]}</key>`)
	);
	if (missing.length === 0) return undefined;

	return fail(
		'mobile.device-capabilities',
		`iOS is missing usage descriptions for: ${missing.join(', ')}.`,
		path,
		'Run `absolute mobile sync ios` to regenerate detected device usage descriptions.'
	);
};

const deviceCapabilityReleaseCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifestPath = join(projectRoot, 'package.json');
	try {
		const plan = resolveAbsoluteDeviceCapabilityPlan(projectRoot);
		assertAbsoluteDeviceCapabilityPackages(projectRoot, plan);
		const requirements = absoluteDeviceNativeRequirements(plan);
		const androidCheck = await androidDevicePermissionCheck(
			config,
			requirements.androidPermissions
		);
		if (androidCheck) return androidCheck;
		const iosCheck = await iosDevicePermissionCheck(
			config,
			requirements.iosUsageDescriptions
		);
		if (iosCheck) return iosCheck;

		return pass(
			'mobile.device-capabilities',
			plan.capabilities.length > 0
				? `Native provider packages and permission declarations match detected capabilities: ${plan.capabilities.join(', ')}.`
				: 'No optional native device capabilities are used.',
			manifestPath
		);
	} catch (error) {
		return fail(
			'mobile.device-capabilities',
			error instanceof Error
				? error.message
				: 'Native device capability provisioning is invalid.',
			manifestPath,
			'Run `absolute mobile sync` and approve the exact capability plugins before releasing.'
		);
	}
};

const inspectAndroidRelease = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const androidRoot = join(config.nativeProjectDirectory, 'android');
	const nativeConfigPath = join(
		androidRoot,
		'app',
		'src',
		'main',
		'assets',
		'capacitor.config.json'
	);
	const manifestPath = join(
		androidRoot,
		'app',
		'src',
		'main',
		'AndroidManifest.xml'
	);
	const publicRoot = join(
		androidRoot,
		'app',
		'src',
		'main',
		'assets',
		'public'
	);
	const journalPath = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'dev-session',
		'journal.json'
	);
	const checks = await Promise.all([
		journalReleaseCheck(journalPath, 'android'),
		capacitorConfigReleaseCheck(nativeConfigPath),
		manifestReleaseCheck(manifestPath),
		hmrAssetsReleaseCheck(publicRoot)
	]);

	return checks.map((check) => ({
		...check,
		path: check.path
			? relative(projectRoot, check.path).replaceAll('\\', '/') || '.'
			: undefined
	}));
};

const inspectIosRelease = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const iosAppRoot = join(config.nativeProjectDirectory, 'ios', 'App', 'App');
	const nativeConfigPath = join(iosAppRoot, 'capacitor.config.json');
	const infoPath = join(iosAppRoot, 'Info.plist');
	const publicRoot = join(iosAppRoot, 'public');
	const journalPath = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'ios-dev-session',
		'journal.json'
	);
	const checks: AbsoluteMobileReleaseCheck[] = [
		await journalReleaseCheck(journalPath, 'ios')
	];
	if (!config.iosVersion) {
		checks.push(
			fail(
				'ios.marketing-version',
				'iOS has no explicit App Store marketing version.',
				projectRoot,
				'Add mobile.ios.version to absolutejs.config.ts, for example 1.0.0.'
			)
		);
	} else {
		checks.push(
			pass(
				'ios.marketing-version',
				`The iOS marketing version is ${config.iosVersion}.`
			)
		);
	}
	if (!(await pathExists(nativeConfigPath))) {
		checks.push(
			fail(
				'ios.capacitor-config',
				'The generated iOS Capacitor config is missing.',
				nativeConfigPath,
				'Run `absolute mobile sync ios` before release validation.'
			)
		);
	} else if (
		isUnsafeCapacitorConfig(await readFile(nativeConfigPath, 'utf8'))
	) {
		checks.push(
			fail(
				'ios.capacitor-config',
				'iOS Capacitor config contains a development server URL, cleartext transport, navigation allowlist, or invalid JSON.',
				nativeConfigPath,
				'Run `absolute mobile sync ios`; do not ship development transport overrides.'
			)
		);
	} else {
		checks.push(
			pass(
				'ios.capacitor-config',
				'iOS Capacitor config contains no development transport overrides.',
				nativeConfigPath
			)
		);
	}
	if (!(await pathExists(infoPath))) {
		checks.push(
			fail(
				'ios.transport-security',
				'The iOS Info.plist is missing.',
				infoPath,
				'Run `absolute mobile sync ios` before release validation.'
			)
		);
	} else {
		const info = await readFile(infoPath, 'utf8');
		checks.push(
			/<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/u.test(info)
				? fail(
						'ios.transport-security',
						'iOS App Transport Security permits arbitrary network loads.',
						infoPath,
						'Remove NSAllowsArbitraryLoads from the release Info.plist.'
					)
				: pass(
						'ios.transport-security',
						'iOS App Transport Security does not permit arbitrary loads.',
						infoPath
					)
		);
	}
	const hmrAsset = await findHmrAsset(publicRoot);
	checks.push(
		hmrAsset
			? fail(
					'ios.hmr-assets',
					'A packaged iOS asset contains the development HMR client.',
					hmrAsset,
					'Rebuild the production mobile bundle and run Capacitor sync again.'
				)
			: pass(
					'ios.hmr-assets',
					'Packaged iOS assets contain no development HMR markers.',
					publicRoot
				)
	);

	return checks.map((check) => ({
		...check,
		path: check.path
			? relative(projectRoot, check.path).replaceAll('\\', '/') || '.'
			: undefined
	}));
};

export const inspectAbsoluteMobileRelease = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
): Promise<AbsoluteMobileReleaseDoctorResult> => {
	const checks: AbsoluteMobileReleaseCheck[] = config.platforms.includes(
		'android'
	)
		? await inspectAndroidRelease(config, projectRoot)
		: [];
	if (config.platforms.includes('ios')) {
		checks.push(...(await inspectIosRelease(config, projectRoot)));
	}
	const syncSchema = syncSchemaReleaseCheck(projectRoot);
	if (syncSchema) {
		checks.push({
			...syncSchema,
			path: syncSchema.path
				? relative(projectRoot, syncSchema.path).replaceAll(
						'\\',
						'/'
					) || '.'
				: undefined
		});
	}
	const deviceCapabilities = await deviceCapabilityReleaseCheck(
		config,
		projectRoot
	);
	checks.push({
		...deviceCapabilities,
		path: deviceCapabilities.path
			? relative(projectRoot, deviceCapabilities.path).replaceAll(
					'\\',
					'/'
				) || '.'
			: undefined
	});

	return {
		checks,
		ready:
			checks.length > 0 &&
			checks.every((check) => check.status === 'pass')
	};
};
