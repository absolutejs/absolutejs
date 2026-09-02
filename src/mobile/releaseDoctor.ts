import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { inspectAbsoluteMobileBundle } from './mobileBundleInspection';
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
	status: 'fail' | 'pass' | 'warn';
};

export type AbsoluteMobileReleaseDoctorResult = {
	checks: AbsoluteMobileReleaseCheck[];
	ready: boolean;
};

export const ABSOLUTE_MOBILE_COMPLIANCE_REPORT_FORMAT = 1 as const;

export type AbsoluteMobileComplianceReport = {
	app: {
		appId: string;
		engine: 'capacitor' | 'expo';
		platforms: string[];
		productionOrigin: string;
	};
	checks: Array<{
		id: string;
		status: AbsoluteMobileReleaseCheck['status'];
	}>;
	format: typeof ABSOLUTE_MOBILE_COMPLIANCE_REPORT_FORMAT;
	manualReview: string[];
	ready: boolean;
	summary: { failed: number; passed: number; warnings: number };
};

const HMR_ASSET_PATTERN =
	/(?:__HMR_WS__|hmr-timing|__absolute_target|absolutejs-error-overlay)/u;
const RELEASE_ASSET_EXTENSIONS = new Set(['.html', '.js', '.mjs']);
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const NOT_FOUND = -1;
const LOCK_FILES = [
	'bun.lock',
	'bun.lockb',
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock'
];
const MANUAL_REVIEW = [
	'physical-device',
	'store-privacy-questionnaire',
	'privacy-policy',
	'signing-key-custody',
	'native-sdk-data-practices'
];
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

const warn = (
	id: string,
	detail: string,
	path?: string,
	remediation?: string
): AbsoluteMobileReleaseCheck => ({
	detail,
	id,
	path,
	remediation,
	status: 'warn'
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readJsonObject = async (path: string) => {
	const value: unknown = JSON.parse(await readFile(path, 'utf8'));
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('JSON root must be an object.');

	return Object.fromEntries(Object.entries(value));
};

const packageDeclarations = (manifest: Record<string, unknown>) => {
	const declarations = new Map<string, string>();
	for (const field of ['dependencies', 'devDependencies']) {
		const value = manifest[field];
		if (typeof value !== 'object' || value === null || Array.isArray(value))
			continue;
		for (const [name, version] of Object.entries(value))
			if (typeof version === 'string') declarations.set(name, version);
	}

	return declarations;
};

const versionCore = (version: string) =>
	version.split('-')[0]?.split('.').slice(0, 2).join('.');

const capacitorVersionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifestPath = join(projectRoot, 'package.json');
	try {
		const manifest = await readJsonObject(manifestPath);
		const declarations = packageDeclarations(manifest);
		const names = [
			'@capacitor/core',
			'@capacitor/cli',
			...config.platforms.map((platform) => `@capacitor/${platform}`)
		];
		const versions = await Promise.all(
			names.map(async (name) => {
				const declared = declarations.get(name);
				if (!declared || !EXACT_VERSION_PATTERN.test(declared))
					throw new TypeError(
						`${name} must be a direct exact dependency.`
					);
				const installed = await readJsonObject(
					join(projectRoot, 'node_modules', name, 'package.json')
				);
				if (installed.version !== declared)
					throw new TypeError(
						`${name} does not match its installed version.`
					);

				return declared;
			})
		);
		const lines = new Set(versions.map(versionCore));
		if (lines.size !== 1)
			throw new TypeError(
				'Capacitor core, CLI, and platform packages must use one major/minor line.'
			);

		return pass(
			'mobile.capacitor-versions',
			`Capacitor core, CLI, and configured platforms are pinned and aligned on ${versions[0]}.`,
			manifestPath
		);
	} catch (error) {
		return fail(
			'mobile.capacitor-versions',
			error instanceof Error
				? error.message
				: 'Capacitor package versions could not be validated.',
			manifestPath,
			'Pin @capacitor/core, @capacitor/cli, and each configured platform to exact versions on the same major/minor line, then reinstall.'
		);
	}
};

const satisfiesGeneratedVersion = (declared: string, installed: string) => {
	if (EXACT_VERSION_PATTERN.test(declared)) return declared === installed;
	if (!declared.startsWith('~')) return false;
	const expected = declared.slice(1).split('.').map(Number);
	const actual = installed.split('.').map(Number);

	return (
		actual[0] === expected[0] &&
		actual[1] === expected[1] &&
		(actual[2] ?? NOT_FOUND) >= (expected[2] ?? 0)
	);
};

const expoVersionCheck = async (config: NormalizedAbsoluteMobileConfig) => {
	const manifestPath = join(config.nativeProjectDirectory, 'package.json');
	try {
		const manifest = await readJsonObject(manifestPath);
		const declarations = packageDeclarations(manifest);
		const required = ['expo', 'expo-router', 'react', 'react-native'];
		const missingRequired = required.find(
			(name) => !declarations.has(name)
		);
		if (missingRequired)
			throw new TypeError(
				`Generated Expo project is missing ${missingRequired}.`
			);
		const installedVersions = await Promise.all(
			[...declarations].map(async ([name, declared]) => ({
				declared,
				installed: await readJsonObject(
					join(
						config.nativeProjectDirectory,
						'node_modules',
						name,
						'package.json'
					)
				),
				name
			}))
		);
		const mismatch = installedVersions.find(
			({ declared, installed }) =>
				typeof installed.version !== 'string' ||
				!satisfiesGeneratedVersion(declared, installed.version)
		);
		if (mismatch)
			throw new TypeError(
				`Generated Expo dependency ${mismatch.name}@${mismatch.declared} does not match its installed version.`
			);
		if (
			!(await pathExists(join(config.nativeProjectDirectory, 'bun.lock')))
		)
			throw new TypeError(
				'Generated Expo dependency lockfile is missing.'
			);

		return pass(
			'mobile.expo-versions',
			`Generated Expo SDK dependencies are pinned, installed, and locked (${declarations.get('expo')}).`,
			manifestPath
		);
	} catch (error) {
		return fail(
			'mobile.expo-versions',
			error instanceof Error
				? error.message
				: 'Generated Expo dependency versions could not be validated.',
			manifestPath,
			'Run `absolute mobile init --yes`, then rebuild the production Expo project.'
		);
	}
};

const dependencyLockCheck = async (projectRoot: string) => {
	const present = (
		await Promise.all(
			LOCK_FILES.map(async (name) => ({
				exists: await pathExists(join(projectRoot, name)),
				name
			}))
		)
	).find(({ exists }) => exists);

	return present
		? pass(
				'mobile.dependency-lock',
				`Dependency graph is locked by ${present.name}.`,
				join(projectRoot, present.name)
			)
		: fail(
				'mobile.dependency-lock',
				'No supported dependency lockfile is present.',
				projectRoot,
				'Install dependencies with the project package manager and commit its lockfile before release.'
			);
};

const productionOriginCheck = (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const origin = new URL(config.productionOrigin);

	return origin.protocol === 'https:'
		? pass(
				'mobile.production-origin',
				'Production transport uses an HTTPS origin.'
			)
		: fail(
				'mobile.production-origin',
				'A loopback development origin cannot be used for a signed release.',
				projectRoot,
				'Configure mobile.server.productionOrigin with the deployed HTTPS origin.'
			);
};

const associationIdentityCheck = (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const missing = [
		...(config.platforms.includes('ios') && !config.appleAppIdPrefix
			? ['mobile.deepLinks.apple.appIdPrefix']
			: []),
		...(config.platforms.includes('android') &&
		config.androidCertificateFingerprints.length === 0
			? ['mobile.deepLinks.android.sha256CertificateFingerprints']
			: [])
	];

	return missing.length === 0
		? pass(
				'mobile.association-identities',
				'Deep-link association identities are configured for every release platform.'
			)
		: fail(
				'mobile.association-identities',
				`Release association identity is missing: ${missing.join(', ')}.`,
				projectRoot,
				'Configure the Apple application prefix and every Android signing-certificate SHA-256 fingerprint used for release.'
			);
};

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

const capacitorIdentityCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	platform: 'android' | 'ios',
	nativeConfigPath: string
) => {
	try {
		const parsed = await readJsonObject(nativeConfigPath);
		if (parsed.appId !== config.appId || parsed.appName !== config.appName)
			throw new TypeError(
				`${platform} packaged application identity does not match mobile config.`
			);

		return pass(
			`${platform}.app-identity`,
			`Packaged ${platform} application identity matches mobile config.`,
			nativeConfigPath
		);
	} catch (error) {
		return fail(
			`${platform}.app-identity`,
			error instanceof Error
				? error.message
				: `${platform} application identity could not be validated.`,
			nativeConfigPath,
			`Run \`absolute mobile sync ${platform}\` and review the generated Capacitor config.`
		);
	}
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

const embeddedBundleReleaseCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	platform: 'android' | 'ios',
	publicRoot: string
) => {
	const inspection = await inspectAbsoluteMobileBundle(
		{ ...config, bundleDirectory: publicRoot },
		projectRoot
	);
	if (inspection.status === 'valid')
		return pass(
			`${platform}.bundle-integrity`,
			`Packaged mobile manifest, runtime, routes, and ${inspection.pageCount ?? 0} page asset(s) passed structural and SHA-256 validation.`,
			join(publicRoot, 'absolute-mobile-manifest.json')
		);

	return fail(
		`${platform}.bundle-integrity`,
		inspection.status === 'missing'
			? 'The packaged mobile manifest is missing.'
			: `The packaged mobile bundle is invalid: ${inspection.issue ?? 'unknown validation error'}`,
		join(publicRoot, 'absolute-mobile-manifest.json'),
		'Rebuild the production mobile bundle and run Capacitor sync for this platform.'
	);
};

const contentSecurityPolicyCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	platform: 'android' | 'ios',
	publicRoot: string
) => {
	const path = join(publicRoot, 'index.html');
	try {
		const source = await readFile(path, 'utf8');
		const requirements = [
			'Content-Security-Policy',
			"default-src 'self'",
			"base-uri 'none'",
			"object-src 'none'",
			"script-src 'self'",
			"form-action 'none'",
			config.productionOrigin
		];
		const missing = requirements.filter((value) => !source.includes(value));
		if (missing.length > 0)
			throw new TypeError(
				'Packaged shell CSP is missing a required AbsoluteJS directive or backend origin.'
			);

		return pass(
			`${platform}.content-security-policy`,
			'Packaged shell CSP restricts scripts, objects, base URLs, forms, and backend connections.',
			path
		);
	} catch (error) {
		return fail(
			`${platform}.content-security-policy`,
			error instanceof Error
				? error.message
				: 'Packaged shell CSP could not be validated.',
			path,
			'Rebuild the production mobile bundle with the AbsoluteJS-generated shell.'
		);
	}
};

const expoApplicationConfigCheck = async (
	config: NormalizedAbsoluteMobileConfig
) => {
	const path = join(config.nativeProjectDirectory, 'app.json');
	try {
		const root = await readJsonObject(path);
		if (!isRecord(root.expo))
			throw new TypeError(
				'Generated Expo application config is invalid.'
			);
		const { expo } = root;
		if (
			expo.name !== config.appName ||
			(config.platforms.includes('android') &&
				(!isRecord(expo.android) ||
					expo.android.package !== config.appId)) ||
			(config.platforms.includes('ios') &&
				(!isRecord(expo.ios) ||
					expo.ios.bundleIdentifier !== config.appId))
		) {
			throw new TypeError(
				'Generated Expo application identity does not match mobile config.'
			);
		}
		if (
			!isRecord(expo.runtimeVersion) ||
			expo.runtimeVersion.policy !== 'appVersion'
		) {
			throw new TypeError(
				'Generated Expo runtimeVersion must follow the native app version.'
			);
		}
		if (
			Array.isArray(expo.plugins) &&
			expo.plugins.some(
				(plugin) =>
					typeof plugin === 'string' &&
					plugin.includes('withAbsoluteDevelopmentCa')
			)
		) {
			throw new TypeError(
				'Generated Expo production config includes the development CA plugin.'
			);
		}

		return pass(
			'expo.app-config',
			'Expo application identity and runtime policy match the production mobile config.',
			path
		);
	} catch (error) {
		return fail(
			'expo.app-config',
			error instanceof Error
				? error.message
				: 'Generated Expo application config could not be validated.',
			path,
			'Run `absolute mobile build <platform>`; do not edit the generated Expo project.'
		);
	}
};

const expoEmbeddedAssetsCheck = async (
	config: NormalizedAbsoluteMobileConfig
) => {
	const generated = join(
		config.nativeProjectDirectory,
		'src',
		'generated',
		'webAssets.ts'
	);
	const assetsRoot = join(
		config.nativeProjectDirectory,
		'assets',
		'absolute'
	);
	try {
		const [source, manifest] = await Promise.all([
			readFile(generated, 'utf8'),
			readJsonObject(
				join(config.bundleDirectory, 'absolute-mobile-manifest.json')
			)
		]);
		if (
			source.includes('embedded AbsoluteJS bundle is unavailable') ||
			typeof manifest.appBuild !== 'string' ||
			!source.includes(JSON.stringify(manifest.appBuild)) ||
			!source.includes(JSON.stringify(config.productionOrigin))
		) {
			throw new TypeError(
				'Generated Expo assets do not contain the prepared production release identity.'
			);
		}
		const sourceFiles = (
			await Array.fromAsync(
				new Bun.Glob('**/*').scan({
					cwd: config.bundleDirectory,
					onlyFiles: true
				})
			)
		).sort();
		const embeddedFiles = (
			await Array.fromAsync(
				new Bun.Glob('*.absasset').scan({
					cwd: assetsRoot,
					onlyFiles: true
				})
			)
		).sort();
		if (
			sourceFiles.length === 0 ||
			sourceFiles.length !== embeddedFiles.length
		)
			throw new TypeError(
				'Generated Expo asset count does not match the prepared mobile bundle.'
			);
		const matches = await Promise.all(
			sourceFiles.map(async (path, index) => {
				const embedded = embeddedFiles[index];
				if (!embedded) return false;
				const [left, right] = await Promise.all([
					readFile(join(config.bundleDirectory, path)),
					readFile(join(assetsRoot, embedded))
				]);

				return left.equals(right);
			})
		);
		if (matches.some((value) => !value))
			throw new TypeError(
				'Generated Expo asset bytes differ from the prepared mobile bundle.'
			);

		return pass(
			'expo.bundle-projection',
			`Expo embeds the complete signed mobile bundle as ${embeddedFiles.length} opaque asset(s).`,
			generated
		);
	} catch (error) {
		return fail(
			'expo.bundle-projection',
			error instanceof Error
				? error.message
				: 'Generated Expo assets could not be validated.',
			generated,
			'Run `absolute mobile build <platform>` to regenerate and verify the production asset projection.'
		);
	}
};

const sourceFiles = async (root: string, extensions: Set<string>) => {
	if (!(await pathExists(root))) return [];
	const files = await Array.fromAsync(
		new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true })
	);

	return files
		.filter((file) => extensions.has(extname(file)))
		.map((file) => join(root, file));
};

const containsPattern = async (paths: string[], pattern: RegExp) => {
	const sources = await Promise.all(
		paths.map((path) => readFile(path, 'utf8'))
	);
	const index = sources.findIndex((source) => pattern.test(source));

	return index === NOT_FOUND ? undefined : paths[index];
};

const androidNativeSecurityCheck = async (androidRoot: string) => {
	const manifestPath = join(androidRoot, 'app/src/main/AndroidManifest.xml');
	try {
		const manifest = await readFile(manifestPath, 'utf8');
		if (/android:debuggable=["']true["']/u.test(manifest))
			throw new TypeError(
				'Android release manifest explicitly enables application debugging.'
			);
		const sources = await sourceFiles(
			join(androidRoot, 'app/src/main'),
			new Set(['.java', '.kt'])
		);
		const debugSource = await containsPattern(
			sources,
			/setWebContentsDebuggingEnabled\s*\(\s*true\s*\)/u
		);
		if (debugSource)
			return fail(
				'android.native-debugging',
				'Android application source unconditionally enables WebView debugging.',
				debugSource,
				'Remove the unconditional WebView debugging call; use the platform debug-build behavior during development.'
			);

		return pass(
			'android.native-debugging',
			'Android does not explicitly enable app or WebView debugging in release source.',
			manifestPath
		);
	} catch (error) {
		return fail(
			'android.native-debugging',
			error instanceof Error
				? error.message
				: 'Android native debugging configuration could not be validated.',
			manifestPath,
			'Remove explicit release debugging settings and rerun mobile sync.'
		);
	}
};

const androidExportedComponentsCheck = async (manifestPath: string) => {
	const source = await readFile(manifestPath, 'utf8').catch(() => '');
	const exported = [
		...source.matchAll(
			/<(?:activity|activity-alias|provider|receiver|service)\b[^>]*>/giu
		)
	]
		.map(([tag]) => tag)
		.filter((tag) => /android:exported=["']true["']/iu.test(tag))
		.map((tag) => tag.match(/android:name=["']([^"']+)["']/iu)?.[1])
		.filter(
			(name): name is string => Boolean(name) && name !== '.MainActivity'
		);

	return exported.length === 0
		? pass(
				'android.exported-components',
				'No non-launcher Android component is explicitly exported.',
				manifestPath
			)
		: warn(
				'android.exported-components',
				`${exported.length} non-launcher Android component(s) are exported and require manual authorization review.`,
				manifestPath,
				'Confirm each exported component is intentional, permission-protected where appropriate, and documented in the mobile threat model review.'
			);
};

const androidDeepLinkProjectionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	manifestPath: string
) => {
	try {
		const source = await readFile(manifestPath, 'utf8');
		const hasWebHost = (host: string) =>
			[...source.matchAll(/<data\b[^>]*>/giu)].some(
				([tag]) =>
					tag.includes('android:scheme="https"') &&
					tag.includes(`android:host="${host}"`)
			);
		if (
			!source.includes('android:autoVerify="true"') ||
			!source.includes('android.intent.category.BROWSABLE') ||
			config.deepLinkHosts.some((host) => !hasWebHost(host)) ||
			(config.deepLinkScheme &&
				!source.includes(`android:scheme="${config.deepLinkScheme}"`))
		)
			throw new TypeError(
				'Android App Link or custom-scheme projection does not match mobile config.'
			);

		return pass(
			'android.deep-links',
			'Android verified links and custom scheme match the effective mobile config.',
			manifestPath
		);
	} catch (error) {
		return fail(
			'android.deep-links',
			error instanceof Error
				? error.message
				: 'Android deep-link projection could not be validated.',
			manifestPath,
			'Run `absolute mobile sync android` and review the AbsoluteJS-owned deep-link region.'
		);
	}
};

const nativeUpdateWatchdogCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	platform: 'android' | 'ios'
) => {
	if (!config.updates) return undefined;
	const timeout = String(config.updates.bootTimeoutMs);
	if (platform === 'ios') {
		const path = join(
			config.nativeProjectDirectory,
			'ios/App/App/AppDelegate.swift'
		);
		const configPath = join(
			config.nativeProjectDirectory,
			'ios/App/App/capacitor.config.json'
		);
		const [source, nativeConfig] = await Promise.all([
			readFile(path, 'utf8').catch(() => ''),
			readFile(configPath, 'utf8').catch(() => '')
		]);

		return source.includes('AbsoluteMobileUpdateWatchdogPlugin') &&
			source.includes('recoverInterruptedBoot()') &&
			source.includes(`.milliseconds(${timeout})`) &&
			source.includes('quarantinedReleases') &&
			nativeConfig.includes('AbsoluteMobileUpdateWatchdogPlugin')
			? pass(
					'ios.update-watchdog',
					`The native update boot watchdog is projected with a ${timeout}ms deadline.`,
					path
				)
			: fail(
					'ios.update-watchdog',
					'The iOS update boot watchdog does not match mobile config.',
					path,
					'Run `absolute mobile sync ios` before building the release.'
				);
	}
	const sourceRoot = join(
		config.nativeProjectDirectory,
		'android/app/src/main'
	);
	const sources = await sourceFiles(sourceRoot, new Set(['.java', '.kt']));
	const [activity, plugin] = await Promise.all([
		containsPattern(sources, /recoverInterruptedBoot\s*\(\s*this\s*\)/u),
		containsPattern(
			sources,
			new RegExp(
				`handler\\.postDelayed\\(deadline,\\s*${timeout}L\\)`,
				'u'
			)
		)
	]);

	return activity && plugin
		? pass(
				'android.update-watchdog',
				`The native update boot watchdog is projected with a ${timeout}ms deadline.`,
				plugin
			)
		: fail(
				'android.update-watchdog',
				'The Android update boot watchdog does not match mobile config.',
				plugin ?? sourceRoot,
				'Run `absolute mobile sync android` before building the release.'
			);
};

const iosNativeSecurityCheck = async (iosRoot: string) => {
	const applicationFiles = async (extensions: Set<string>) =>
		(await sourceFiles(iosRoot, extensions)).filter(
			(path) =>
				!relative(iosRoot, path)
					.split(/[\\/]/u)
					.some((part) =>
						['Pods', 'DerivedData', 'build'].includes(part)
					)
		);
	const entitlementPaths = await applicationFiles(new Set(['.entitlements']));
	const unsafeEntitlements = await containsPattern(
		entitlementPaths,
		/<key>(?:com\.apple\.security\.)?get-task-allow<\/key>\s*<true\s*\/>/u
	);
	if (unsafeEntitlements)
		return fail(
			'ios.native-debugging',
			'iOS source entitlements explicitly permit debugger attachment.',
			unsafeEntitlements,
			'Remove get-task-allow from source entitlements; Xcode supplies development entitlements only to debug builds.'
		);
	const sources = await applicationFiles(new Set(['.m', '.mm', '.swift']));
	const debugSource = await containsPattern(
		sources,
		/\.isInspectable\s*=\s*true|setInspectable\s*\(\s*true\s*\)/u
	);
	if (debugSource)
		return fail(
			'ios.native-debugging',
			'iOS application source unconditionally enables WebView inspection.',
			debugSource,
			'Remove unconditional WebView inspection from release source.'
		);

	return pass(
		'ios.native-debugging',
		'iOS source does not enable release debugger attachment or WebView inspection.',
		entitlementPaths[0] ?? iosRoot
	);
};

const iosDeepLinkProjectionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	iosRoot: string
) => {
	const infoPath = join(iosRoot, 'App/App/Info.plist');
	const entitlementsPath = join(iosRoot, 'App/AbsoluteJS.entitlements');
	const projectPath = join(iosRoot, 'App/App.xcodeproj/project.pbxproj');
	try {
		const [info, entitlements, project] = await Promise.all([
			readFile(infoPath, 'utf8'),
			readFile(entitlementsPath, 'utf8'),
			readFile(projectPath, 'utf8')
		]);
		if (
			config.deepLinkScheme &&
			(!info.includes('<key>CFBundleURLTypes</key>') ||
				!info.includes(`<string>${config.deepLinkScheme}</string>`))
		)
			throw new TypeError(
				'iOS custom URL scheme does not match mobile config.'
			);
		if (
			config.deepLinkHosts.some(
				(host) =>
					!entitlements.includes(`<string>applinks:${host}</string>`)
			)
		)
			throw new TypeError(
				'iOS associated domains do not match mobile config.'
			);
		if (
			!project.includes(
				'CODE_SIGN_ENTITLEMENTS = App/AbsoluteJS.entitlements;'
			)
		)
			throw new TypeError(
				'iOS target does not sign the AbsoluteJS entitlements file.'
			);

		return pass(
			'ios.deep-links',
			'iOS universal links, custom scheme, and signed entitlements match mobile config.',
			entitlementsPath
		);
	} catch (error) {
		return fail(
			'ios.deep-links',
			error instanceof Error
				? error.message
				: 'iOS deep-link projection could not be validated.',
			entitlementsPath,
			'Run `absolute mobile sync ios` and review the AbsoluteJS-owned deep-link and entitlement projection.'
		);
	}
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
	const iosRoot = join(config.nativeProjectDirectory, 'ios');
	const path =
		config.engine === 'expo'
			? await uniqueExpoIosFile(iosRoot, '**/Info.plist', 'Info.plist')
			: join(iosRoot, 'App/App/Info.plist');
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

const expoIosPrivacyCapabilityCheck = async (
	iosRoot: string,
	project: string,
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) => {
	if (requirements.iosPrivacyAccessedApis.length === 0) return undefined;
	const privacyPath = await uniqueExpoIosFile(
		iosRoot,
		'**/PrivacyInfo.xcprivacy',
		'privacy manifest'
	);
	const privacy = await readFile(privacyPath, 'utf8');
	const missing = requirements.iosPrivacyAccessedApis.some(
		({ api, reasons }) =>
			!privacy.includes(`<string>${api}</string>`) ||
			reasons.some(
				(reason) => !privacy.includes(`<string>${reason}</string>`)
			)
	);
	if (!missing && project.includes(privacyPath.split(/[\\/]/u).at(-1) ?? ''))
		return undefined;

	return fail(
		'mobile.device-capabilities',
		'Expo iOS privacy manifest or target membership does not match detected capabilities.',
		privacyPath,
		'Run `absolute mobile build ios` to regenerate detected Expo privacy declarations.'
	);
};

const expoIosPushCapabilityCheck = async (
	iosRoot: string,
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) => {
	if (!requirements.iosPushNotifications) return undefined;
	const entitlementsPath = await uniqueExpoIosFile(
		iosRoot,
		'**/*.entitlements',
		'entitlements'
	);
	const entitlements = await readFile(entitlementsPath, 'utf8');
	if (entitlements.includes('<key>aps-environment</key>')) return undefined;

	return fail(
		'mobile.device-capabilities',
		'Expo iOS push entitlement does not match detected capabilities.',
		entitlementsPath,
		'Run `absolute mobile build ios` to regenerate native push integration.'
	);
};

const expoIosCapabilityProjectionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) => {
	const iosRoot = join(config.nativeProjectDirectory, 'ios');
	const projectPath = await uniqueExpoIosFile(
		iosRoot,
		'**/*.xcodeproj/project.pbxproj',
		'Xcode project'
	);
	const project = await readFile(projectPath, 'utf8');
	const privacy = await expoIosPrivacyCapabilityCheck(
		iosRoot,
		project,
		requirements
	);
	if (privacy) return privacy;

	return expoIosPushCapabilityCheck(iosRoot, requirements);
};

const iosCapabilityProjectionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) => {
	if (!config.platforms.includes('ios')) return undefined;
	if (config.engine === 'expo')
		return expoIosCapabilityProjectionCheck(config, requirements);
	const appRoot = join(config.nativeProjectDirectory, 'ios/App/App');
	const infoPath = join(appRoot, 'Info.plist');
	const info = await readFile(infoPath, 'utf8').catch(() => '');
	if (
		requirements.iosSystemBars &&
		!/<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\s*\/>/u.test(
			info
		)
	)
		return fail(
			'mobile.device-capabilities',
			'iOS system-bar capability is missing its required view-controller setting.',
			infoPath,
			'Run `absolute mobile sync ios` to regenerate native capability settings.'
		);
	if (requirements.iosPrivacyAccessedApis.length > 0) {
		const privacyPath = join(appRoot, 'PrivacyInfo.xcprivacy');
		const projectPath = join(
			config.nativeProjectDirectory,
			'ios/App/App.xcodeproj/project.pbxproj'
		);
		const [privacy, project] = await Promise.all([
			readFile(privacyPath, 'utf8').catch(() => ''),
			readFile(projectPath, 'utf8').catch(() => '')
		]);
		const missing = requirements.iosPrivacyAccessedApis.some(
			({ api, reasons }) =>
				!privacy.includes(`<string>${api}</string>`) ||
				reasons.some(
					(reason) => !privacy.includes(`<string>${reason}</string>`)
				)
		);
		if (missing || !project.includes('PrivacyInfo.xcprivacy in Resources'))
			return fail(
				'mobile.device-capabilities',
				'iOS privacy manifest or target membership does not match detected native capabilities.',
				privacyPath,
				'Run `absolute mobile sync ios` to regenerate and target PrivacyInfo.xcprivacy.'
			);
	}
	if (requirements.iosPushNotifications) {
		const entitlementsPath = join(
			config.nativeProjectDirectory,
			'ios/App/AbsoluteJS.entitlements'
		);
		const delegatePath = join(appRoot, 'AppDelegate.swift');
		const [entitlements, delegate] = await Promise.all([
			readFile(entitlementsPath, 'utf8').catch(() => ''),
			readFile(delegatePath, 'utf8').catch(() => '')
		]);
		if (
			!entitlements.includes('<key>aps-environment</key>') ||
			!delegate.includes('capacitorDidRegisterForRemoteNotifications') ||
			!delegate.includes(
				'capacitorDidFailToRegisterForRemoteNotifications'
			)
		)
			return fail(
				'mobile.device-capabilities',
				'iOS push entitlement or AppDelegate forwarding does not match detected capabilities.',
				entitlementsPath,
				'Run `absolute mobile sync ios` to regenerate native push integration.'
			);
	}

	return undefined;
};

const deviceCapabilityReleaseCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifestPath = join(projectRoot, 'package.json');
	try {
		const plan = resolveAbsoluteDeviceCapabilityPlan(
			projectRoot,
			config.engine
		);
		const assertPackages = async () => {
			if (config.engine === 'capacitor')
				return assertAbsoluteDeviceCapabilityPackages(
					projectRoot,
					plan
				);
			const generated = await readJsonObject(
				join(config.nativeProjectDirectory, 'package.json')
			);
			const declarations = packageDeclarations(generated);
			const missing = plan.requiredPackages.filter((spec) => {
				const separator = spec.lastIndexOf('@');

				return (
					declarations.get(spec.slice(0, separator)) !==
					spec.slice(separator + 1)
				);
			});
			if (missing.length > 0)
				throw new TypeError(
					`Generated Expo project is missing detected capability packages: ${missing.join(', ')}.`
				);

			return undefined;
		};
		await assertPackages();
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
		const iosProjectionCheck = await iosCapabilityProjectionCheck(
			config,
			requirements
		);
		if (iosProjectionCheck) return iosProjectionCheck;

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
		capacitorIdentityCheck(config, 'android', nativeConfigPath),
		manifestReleaseCheck(manifestPath),
		hmrAssetsReleaseCheck(publicRoot),
		embeddedBundleReleaseCheck(config, projectRoot, 'android', publicRoot),
		contentSecurityPolicyCheck(config, 'android', publicRoot),
		androidNativeSecurityCheck(androidRoot),
		androidExportedComponentsCheck(manifestPath),
		androidDeepLinkProjectionCheck(config, manifestPath),
		nativeUpdateWatchdogCheck(config, 'android')
	]);

	return checks
		.filter((check) => check !== undefined)
		.map((check) => ({
			...check,
			path: check.path
				? relative(projectRoot, check.path).replaceAll('\\', '/') || '.'
				: undefined
		}));
};

const inspectExpoAndroidRelease = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const androidRoot = join(config.nativeProjectDirectory, 'android');
	const manifestPath = join(
		androidRoot,
		'app',
		'src',
		'main',
		'AndroidManifest.xml'
	);
	const journalPath = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'expo-dev-session',
		'journal.json'
	);
	const checks = await Promise.all([
		journalReleaseCheck(journalPath, 'android'),
		expoApplicationConfigCheck(config),
		expoEmbeddedAssetsCheck(config),
		manifestReleaseCheck(manifestPath),
		hmrAssetsReleaseCheck(config.bundleDirectory),
		embeddedBundleReleaseCheck(
			config,
			projectRoot,
			'android',
			config.bundleDirectory
		),
		contentSecurityPolicyCheck(config, 'android', config.bundleDirectory),
		androidNativeSecurityCheck(androidRoot),
		androidExportedComponentsCheck(manifestPath),
		androidDeepLinkProjectionCheck(config, manifestPath)
	]);

	return checks.map((check) => ({
		...check,
		path: check.path
			? relative(projectRoot, check.path).replaceAll('\\', '/') || '.'
			: undefined
	}));
};

const uniqueExpoIosFile = async (
	iosRoot: string,
	pattern: string,
	label: string
) => {
	const paths = (
		await Array.fromAsync(
			new Bun.Glob(pattern).scan({ cwd: iosRoot, onlyFiles: true })
		)
	).filter(
		(path) =>
			!path
				.split(/[\\/]/u)
				.some((part) => ['Pods', 'DerivedData', 'build'].includes(part))
	);
	if (paths.length !== 1)
		throw new TypeError(
			paths.length === 0
				? `Generated Expo iOS project is missing its ${label}.`
				: `Generated Expo iOS project contains ambiguous ${label} files.`
		);

	const [path] = paths;
	if (!path)
		throw new TypeError(
			`Generated Expo iOS project is missing its ${label}.`
		);

	return join(iosRoot, path);
};

const expoIosNativeProjectionCheck = async (
	config: NormalizedAbsoluteMobileConfig,
	iosRoot: string
) => {
	try {
		const [infoPath, entitlementsPath, projectPath] = await Promise.all([
			uniqueExpoIosFile(iosRoot, '**/Info.plist', 'Info.plist'),
			uniqueExpoIosFile(iosRoot, '**/*.entitlements', 'entitlements'),
			uniqueExpoIosFile(
				iosRoot,
				'**/*.xcodeproj/project.pbxproj',
				'Xcode project'
			)
		]);
		const [info, entitlements, project] = await Promise.all([
			readFile(infoPath, 'utf8'),
			readFile(entitlementsPath, 'utf8'),
			readFile(projectPath, 'utf8')
		]);
		if (/<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/u.test(info))
			throw new TypeError(
				'Expo iOS App Transport Security permits arbitrary network loads.'
			);
		if (
			config.deepLinkScheme &&
			(!info.includes('<key>CFBundleURLTypes</key>') ||
				!info.includes(`<string>${config.deepLinkScheme}</string>`))
		)
			throw new TypeError(
				'Expo iOS custom URL scheme does not match mobile config.'
			);
		if (
			config.deepLinkHosts.some(
				(host) =>
					!entitlements.includes(`<string>applinks:${host}</string>`)
			)
		)
			throw new TypeError(
				'Expo iOS associated domains do not match mobile config.'
			);
		if (!project.includes(entitlementsPath.split(/[\\/]/u).at(-1) ?? ''))
			throw new TypeError(
				'Expo iOS target does not sign its generated entitlements file.'
			);

		return pass(
			'ios.expo-native-projection',
			'Expo iOS transport security, URL schemes, universal links, and signed entitlements match mobile config.',
			entitlementsPath
		);
	} catch (error) {
		return fail(
			'ios.expo-native-projection',
			error instanceof Error
				? error.message
				: 'Expo iOS native projection could not be validated.',
			iosRoot,
			'Run `absolute mobile build ios` to regenerate the production Expo CNG project.'
		);
	}
};

const inspectExpoIosRelease = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const iosRoot = join(config.nativeProjectDirectory, 'ios');
	const journalPath = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'expo-dev-session',
		'journal.json'
	);
	const checks: AbsoluteMobileReleaseCheck[] = [
		await journalReleaseCheck(journalPath, 'ios')
	];
	checks.push(
		config.iosVersion
			? pass(
					'ios.marketing-version',
					`The iOS marketing version is ${config.iosVersion}.`
				)
			: fail(
					'ios.marketing-version',
					'iOS has no explicit App Store marketing version.',
					projectRoot,
					'Add mobile.ios.version to absolutejs.config.ts, for example 1.0.0.'
				)
	);
	checks.push(
		...(await Promise.all([
			expoApplicationConfigCheck(config),
			expoEmbeddedAssetsCheck(config),
			hmrAssetsReleaseCheck(config.bundleDirectory),
			embeddedBundleReleaseCheck(
				config,
				projectRoot,
				'ios',
				config.bundleDirectory
			),
			contentSecurityPolicyCheck(config, 'ios', config.bundleDirectory),
			expoIosNativeProjectionCheck(config, iosRoot),
			iosNativeSecurityCheck(iosRoot)
		]))
	);

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
	const updateWatchdog = config.updates
		? await nativeUpdateWatchdogCheck(config, 'ios')
		: undefined;
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
	checks.push(await capacitorIdentityCheck(config, 'ios', nativeConfigPath));
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
	checks.push(
		await embeddedBundleReleaseCheck(
			config,
			projectRoot,
			'ios',
			publicRoot
		),
		await contentSecurityPolicyCheck(config, 'ios', publicRoot),
		await iosNativeSecurityCheck(
			join(config.nativeProjectDirectory, 'ios')
		),
		await iosDeepLinkProjectionCheck(
			config,
			join(config.nativeProjectDirectory, 'ios')
		)
	);
	if (updateWatchdog) checks.push(updateWatchdog);

	return checks.map((check) => ({
		...check,
		path: check.path
			? relative(projectRoot, check.path).replaceAll('\\', '/') || '.'
			: undefined
	}));
};

export const createAbsoluteMobileComplianceReport = (
	config: NormalizedAbsoluteMobileConfig,
	result: AbsoluteMobileReleaseDoctorResult
): AbsoluteMobileComplianceReport => {
	const summary: AbsoluteMobileComplianceReport['summary'] = {
		failed: result.checks.filter(({ status }) => status === 'fail').length,
		passed: result.checks.filter(({ status }) => status === 'pass').length,
		warnings: result.checks.filter(({ status }) => status === 'warn').length
	};

	return {
		app: {
			appId: config.appId,
			engine: config.engine,
			platforms: [...config.platforms],
			productionOrigin: config.productionOrigin
		},
		checks: result.checks.map(({ id, status }) => ({ id, status })),
		format: ABSOLUTE_MOBILE_COMPLIANCE_REPORT_FORMAT,
		manualReview: [...MANUAL_REVIEW],
		ready: result.ready,
		summary
	};
};

export const inspectAbsoluteMobileRelease = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
): Promise<AbsoluteMobileReleaseDoctorResult> => {
	const globalChecks = await Promise.all([
		Promise.resolve(productionOriginCheck(config, projectRoot)),
		Promise.resolve(associationIdentityCheck(config, projectRoot)),
		dependencyLockCheck(projectRoot),
		config.engine === 'expo'
			? expoVersionCheck(config)
			: capacitorVersionCheck(config, projectRoot)
	]);
	const checks: AbsoluteMobileReleaseCheck[] = globalChecks.map((check) => ({
		...check,
		path: check.path
			? relative(projectRoot, check.path).replaceAll('\\', '/') || '.'
			: undefined
	}));
	if (config.platforms.includes('android'))
		checks.push(
			...(config.engine === 'expo'
				? await inspectExpoAndroidRelease(config, projectRoot)
				: await inspectAndroidRelease(config, projectRoot))
		);
	if (config.platforms.includes('ios'))
		checks.push(
			...(config.engine === 'expo'
				? await inspectExpoIosRelease(config, projectRoot)
				: await inspectIosRelease(config, projectRoot))
		);
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
			checks.every((check) => check.status !== 'fail')
	};
};
