import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

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

	return /android:usesCleartextTraffic=["']true["']/u.test(source)
		? fail(
				'android.cleartext',
				'Android explicitly permits cleartext traffic.',
				manifestPath,
				'Remove usesCleartextTraffic="true" from the release manifest.'
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

	return {
		checks,
		ready:
			checks.length > 0 &&
			checks.every((check) => check.status === 'pass')
	};
};
