import { createHash } from 'node:crypto';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path';
import type { AbsoluteAndroidReleaseMetadata } from './androidRelease';
import {
	detectAbsoluteMobileHost,
	type AbsoluteMobileHost
} from './emulatorDoctor';
import {
	inspectAbsoluteAndroidInstalledApp,
	type AbsoluteAndroidInstalledApp
} from './androidUpgradeConformance';

export const ABSOLUTE_BUNDLETOOL_VERSION = '1.18.3';
export const ABSOLUTE_BUNDLETOOL_SHA256 =
	'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29';
export const ABSOLUTE_BUNDLETOOL_URL = `https://github.com/google/bundletool/releases/download/${ABSOLUTE_BUNDLETOOL_VERSION}/bundletool-all-${ABSOLUTE_BUNDLETOOL_VERSION}.jar`;

const EMBEDDED_READY_MARKERS = {
	capacitor: 'Capacitor embedded web content ready',
	expo: 'Expo embedded web content ready'
} as const;
const RELEASE_READY_POLL_MS = 250;
const RELEASE_READY_TIMEOUT_MS = 30_000;
const RELEASE_STABILITY_MS = 2_000;

type CommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

type RunCommand = (command: string[]) => Promise<CommandResult>;

type BundletoolInstallOptions = {
	approved: boolean;
	download?: (url: string) => Promise<Uint8Array>;
	root?: string;
};

export type AbsoluteAndroidRelease = {
	artifactPath: string;
	metadata: AbsoluteAndroidReleaseMetadata;
	metadataPath: string;
	releaseRoot: string;
};

export type AbsoluteAndroidReleaseAcceptanceResult = {
	apksBytes: number;
	artifactBytes: number;
	artifactSha256: string;
	durationMs: number;
	embeddedOffline: true;
	engine: 'capacitor' | 'expo';
	installMs: number;
	installed: Pick<AbsoluteAndroidInstalledApp, 'versionCode' | 'versionName'>;
	launchMs: number;
	releaseId: string;
	relaunchMs: number;
	signed: boolean;
	status: 'pass';
};

export type RunAbsoluteAndroidReleaseAcceptanceOptions = {
	adb: string;
	artifactDirectory: string;
	bundletool: string;
	java: string;
	launchUrl?: string;
	release: AbsoluteAndroidRelease;
	run?: RunCommand;
	serial: string;
	stabilityMs?: number;
	host?: AbsoluteMobileHost;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const sha256 = async (path: string) =>
	createHash('sha256')
		.update(await readFile(path))
		.digest('hex');

const inside = (root: string, candidate: string) => {
	const path = relative(resolve(root), resolve(candidate));

	return (
		path === '' ||
		(!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
	);
};

const requireString = (value: unknown, name: string) => {
	if (typeof value !== 'string' || !value)
		throw new TypeError(`Android release ${name} is invalid.`);

	return value;
};

const parseMetadata = (value: unknown) => {
	if (!isRecord(value))
		throw new TypeError('Android release metadata must contain an object.');
	const { bytes } = value;
	const { versionCode } = value;
	if (!Number.isSafeInteger(bytes) || Number(bytes) < 1)
		throw new TypeError('Android release bytes is invalid.');
	if (
		versionCode !== undefined &&
		(!Number.isSafeInteger(versionCode) || Number(versionCode) < 1)
	)
		throw new TypeError('Android release versionCode is invalid.');
	if (
		value.format !== 1 ||
		value.platform !== 'android' ||
		value.type !== 'aab' ||
		(value.engine !== 'capacitor' && value.engine !== 'expo') ||
		typeof value.signed !== 'boolean'
	)
		throw new TypeError('Android release metadata contract is invalid.');
	const metadata = {
		appBuild: requireString(value.appBuild, 'appBuild'),
		appId: requireString(value.appId, 'appId'),
		artifact: requireString(value.artifact, 'artifact'),
		bytes: Number(bytes),
		engine: value.engine,
		format: 1,
		platform: 'android',
		releaseId: requireString(value.releaseId, 'releaseId'),
		runtime: requireString(value.runtime, 'runtime'),
		sha256: requireString(value.sha256, 'sha256'),
		signed: value.signed,
		type: 'aab',
		...(versionCode === undefined
			? {}
			: { versionCode: Number(versionCode) })
	} satisfies AbsoluteAndroidReleaseMetadata;
	if (!/^[a-f0-9]{64}$/u.test(metadata.sha256))
		throw new TypeError('Android release sha256 is invalid.');
	if (metadata.releaseId !== `amobile_android_${metadata.sha256}`)
		throw new TypeError(
			'Android release ID does not match its artifact digest.'
		);

	return metadata;
};

/** Load and cryptographically revalidate an immutable Android release. */
export const absoluteBundletoolPath = (
	root = process.env.ABSOLUTE_BUNDLETOOL_ROOT ??
		join(homedir(), '.absolutejs', 'tools', 'bundletool')
) => join(root, ABSOLUTE_BUNDLETOOL_VERSION, 'bundletool.jar');
export const inspectAbsoluteBundletool = async (root?: string) => {
	const path = absoluteBundletoolPath(root);
	if (!(await exists(path))) return { path, ready: false as const };
	if ((await sha256(path)) !== ABSOLUTE_BUNDLETOOL_SHA256)
		throw new TypeError(
			`Managed Bundletool ${ABSOLUTE_BUNDLETOOL_VERSION} failed checksum verification. Remove ${path} and rerun the command.`
		);

	return { path, ready: true as const };
};
export const readAbsoluteAndroidRelease = async (
	projectRoot: string,
	requested: string
): Promise<AbsoluteAndroidRelease> => {
	const root = resolve(projectRoot);
	const selected = resolve(root, requested);
	if (!inside(root, selected))
		throw new TypeError(
			'mobile test android --release must remain inside the project.'
		);
	const metadataPath =
		basename(selected) === 'release.json'
			? selected
			: join(selected, 'release.json');
	const releaseRoot = dirname(metadataPath);
	const metadata = parseMetadata(
		JSON.parse(await readFile(metadataPath, 'utf8'))
	);
	const artifactPath = resolve(releaseRoot, metadata.artifact);
	if (
		!inside(releaseRoot, artifactPath) ||
		basename(artifactPath) !== metadata.artifact
	)
		throw new TypeError('Android release artifact path is invalid.');
	const [artifactStat, artifactSha256] = await Promise.all([
		stat(artifactPath),
		sha256(artifactPath)
	]);
	if (
		artifactStat.size !== metadata.bytes ||
		artifactSha256 !== metadata.sha256
	)
		throw new TypeError(
			`Immutable Android release ${metadata.releaseId} is missing or modified.`
		);

	return { artifactPath, metadata, metadataPath, releaseRoot };
};

const defaultDownload = async (url: string) => {
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`Bundletool download failed (${response.status}).`);

	return new Uint8Array(await response.arrayBuffer());
};

/** Install the pinned official Bundletool jar only after explicit approval. */
export const ensureAbsoluteBundletool = async (
	options: BundletoolInstallOptions
) => {
	const inspected = await inspectAbsoluteBundletool(options.root);
	if (inspected.ready) return inspected.path;
	if (!options.approved)
		throw new TypeError(
			`Bundletool ${ABSOLUTE_BUNDLETOOL_VERSION} is required. Rerun with --yes to download the checksum-pinned official release.`
		);
	const bytes = await (options.download ?? defaultDownload)(
		ABSOLUTE_BUNDLETOOL_URL
	);
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (digest !== ABSOLUTE_BUNDLETOOL_SHA256)
		throw new TypeError(
			'Downloaded Bundletool failed checksum verification.'
		);
	await mkdir(dirname(inspected.path), { recursive: true });
	const staging = await mkdtemp(join(dirname(inspected.path), '.install-'));
	const candidate = join(staging, 'bundletool.jar');
	try {
		await writeFile(candidate, bytes, { flag: 'wx' });
		await rename(candidate, inspected.path).catch(async (error) => {
			if (await exists(inspected.path)) return;
			throw error;
		});
	} finally {
		await rm(staging, { force: true, recursive: true });
	}
	if ((await sha256(inspected.path)) !== ABSOLUTE_BUNDLETOOL_SHA256)
		throw new TypeError(
			'Installed Bundletool failed checksum verification.'
		);

	return inspected.path;
};

const defaultRun: RunCommand = async (command) => {
	const process = Bun.spawn(command, {
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const [exitCode, stderr, stdout] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
		new Response(process.stdout).text()
	]);

	return { exitCode, stderr, stdout };
};

const requireSuccess = async (
	run: RunCommand,
	command: string[],
	label: string
) => {
	const result = await run(command);
	if (result.exitCode !== 0)
		throw new Error(
			`${label} failed: ${result.stderr.trim() || result.stdout.trim()}`
		);

	return result;
};

const adb = (path: string, serial: string, ...args: string[]) => [
	path,
	'-s',
	serial,
	...args
];

const waitForMarker = async (
	run: RunCommand,
	adbPath: string,
	serial: string,
	appId: string,
	engine: 'capacitor' | 'expo',
	timeoutMs: number
) => {
	const startedAt = performance.now();
	const inspect: () => Promise<void> = async () => {
		if (performance.now() - startedAt >= timeoutMs)
			throw new Error(
				'The installed release launched but its embedded web content did not become ready offline.'
			);
		const [logs, process] = await Promise.all([
			run(
				adb(
					adbPath,
					serial,
					'logcat',
					'-d',
					'-s',
					'AbsoluteJS:I',
					'*:S'
				)
			),
			run(adb(adbPath, serial, 'shell', 'pidof', appId))
		]);
		if (process.exitCode !== 0 || !process.stdout.trim())
			throw new Error(
				'The installed Android release exited before becoming ready.'
			);
		if (logs.stdout.includes(EMBEDDED_READY_MARKERS[engine])) return;
		const failedPhase =
			engine === 'expo'
				? /Expo embedded web phase: (assets-(?:root|directory|destination|module|source|download|copy|read|write|finalize|unexpected)|devices)-failed/u.exec(
						logs.stdout
					)?.[1]
				: undefined;
		if (failedPhase)
			throw new Error(
				`The installed release could not initialize its embedded ${failedPhase} runtime offline.`
			);
		await Bun.sleep(RELEASE_READY_POLL_MS);
		await inspect();
	};

	return inspect();
};

const launch = async (
	run: RunCommand,
	adbPath: string,
	serial: string,
	appId: string,
	launchUrl?: string
) => {
	const resolved = await requireSuccess(
		run,
		adb(
			adbPath,
			serial,
			'shell',
			'cmd',
			'package',
			'resolve-activity',
			'--brief',
			appId
		),
		'Android launch activity discovery'
	);
	const activity = resolved.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.findLast((line) => line.includes('/'));
	if (!activity)
		throw new Error(
			`Android could not resolve a launch activity for ${appId}.`
		);
	const startedAt = performance.now();
	await requireSuccess(
		run,
		adb(
			adbPath,
			serial,
			'shell',
			'am',
			'start',
			'-W',
			'-n',
			activity,
			...(launchUrl
				? ['-a', 'android.intent.action.VIEW', '-d', launchUrl]
				: [])
		),
		'Android release launch'
	);

	return Math.round(performance.now() - startedAt);
};

/** Install the APKs generated from one exact AAB and prove embedded offline boot. */
export const runAbsoluteAndroidReleaseAcceptance = async (
	options: RunAbsoluteAndroidReleaseAcceptanceOptions
): Promise<AbsoluteAndroidReleaseAcceptanceResult> => {
	if (!options.serial.startsWith('emulator-'))
		throw new TypeError(
			'Installed release acceptance changes network state and therefore requires an Android emulator.'
		);
	const run = options.run ?? defaultRun;
	const startedAt = performance.now();
	await mkdir(options.artifactDirectory, { recursive: true });
	const apksPath = join(options.artifactDirectory, 'release.apks');
	const windowsJava =
		(options.host ?? detectAbsoluteMobileHost()) === 'wsl' &&
		options.java.toLowerCase().endsWith('.exe');
	const toolPath = async (path: string) => {
		if (!windowsJava) return path;
		const converted = await requireSuccess(
			run,
			['wslpath', '-w', path],
			'Bundletool Windows path translation'
		);
		const translated = converted.stdout.trim();
		if (!translated)
			throw new Error(
				`Bundletool could not translate ${basename(path)} for the Windows JDK.`
			);

		return translated;
	};
	const [bundletoolPath, artifactPath, outputPath, adbPath] =
		await Promise.all([
			toolPath(options.bundletool),
			toolPath(options.release.artifactPath),
			toolPath(apksPath),
			toolPath(options.adb)
		]);
	await requireSuccess(
		run,
		[
			options.java,
			'-jar',
			bundletoolPath,
			'build-apks',
			`--bundle=${artifactPath}`,
			`--output=${outputPath}`,
			'--mode=universal',
			'--overwrite'
		],
		'Bundletool APK generation'
	);
	const installStartedAt = performance.now();
	await requireSuccess(
		run,
		[
			options.java,
			'-jar',
			bundletoolPath,
			'install-apks',
			`--apks=${outputPath}`,
			`--adb=${adbPath}`,
			`--device-id=${options.serial}`
		],
		'Bundletool release installation'
	);
	const installMs = Math.round(performance.now() - installStartedAt);
	const installed = await inspectAbsoluteAndroidInstalledApp(
		options.adb,
		options.serial,
		options.release.metadata.appId,
		run
	);
	if (
		options.release.metadata.versionCode !== undefined &&
		installed.versionCode !== options.release.metadata.versionCode
	)
		throw new Error(
			`Installed Android versionCode ${installed.versionCode ?? 'unknown'} does not match release ${options.release.metadata.versionCode}.`
		);
	await requireSuccess(
		run,
		adb(options.adb, options.serial, 'logcat', '-c'),
		'Android release log isolation'
	);
	const [wifi, mobile] = await Promise.all([
		requireSuccess(
			run,
			adb(
				options.adb,
				options.serial,
				'shell',
				'settings',
				'get',
				'global',
				'wifi_on'
			),
			'Android Wi-Fi state inspection'
		),
		requireSuccess(
			run,
			adb(
				options.adb,
				options.serial,
				'shell',
				'settings',
				'get',
				'global',
				'mobile_data'
			),
			'Android mobile-data state inspection'
		)
	]);
	let launchMs: number;
	let relaunchMs: number;
	try {
		await Promise.all([
			requireSuccess(
				run,
				adb(
					options.adb,
					options.serial,
					'shell',
					'svc',
					'wifi',
					'disable'
				),
				'Android Wi-Fi disable'
			),
			requireSuccess(
				run,
				adb(
					options.adb,
					options.serial,
					'shell',
					'svc',
					'data',
					'disable'
				),
				'Android mobile-data disable'
			)
		]);
		await requireSuccess(
			run,
			adb(
				options.adb,
				options.serial,
				'shell',
				'am',
				'force-stop',
				options.release.metadata.appId
			),
			'Android release stop'
		);
		launchMs = await launch(
			run,
			options.adb,
			options.serial,
			options.release.metadata.appId,
			options.launchUrl
		);
		await waitForMarker(
			run,
			options.adb,
			options.serial,
			options.release.metadata.appId,
			options.release.metadata.engine,
			RELEASE_READY_TIMEOUT_MS
		);
		await Bun.sleep(options.stabilityMs ?? RELEASE_STABILITY_MS);
		await requireSuccess(
			run,
			adb(
				options.adb,
				options.serial,
				'shell',
				'am',
				'force-stop',
				options.release.metadata.appId
			),
			'Android release relaunch stop'
		);
		await requireSuccess(
			run,
			adb(options.adb, options.serial, 'logcat', '-c'),
			'Android release relaunch log isolation'
		);
		relaunchMs = await launch(
			run,
			options.adb,
			options.serial,
			options.release.metadata.appId,
			options.launchUrl
		);
		await waitForMarker(
			run,
			options.adb,
			options.serial,
			options.release.metadata.appId,
			options.release.metadata.engine,
			RELEASE_READY_TIMEOUT_MS
		);
	} finally {
		await Promise.all([
			requireSuccess(
				run,
				adb(
					options.adb,
					options.serial,
					'shell',
					'svc',
					'wifi',
					wifi.stdout.trim() === '1' ? 'enable' : 'disable'
				),
				'Android Wi-Fi restore'
			),
			requireSuccess(
				run,
				adb(
					options.adb,
					options.serial,
					'shell',
					'svc',
					'data',
					mobile.stdout.trim() === '1' ? 'enable' : 'disable'
				),
				'Android mobile-data restore'
			)
		]);
	}

	return {
		apksBytes: await stat(apksPath).then(({ size }) => size),
		artifactBytes: options.release.metadata.bytes,
		artifactSha256: options.release.metadata.sha256,
		durationMs: Math.round(performance.now() - startedAt),
		embeddedOffline: true,
		engine: options.release.metadata.engine,
		installed: {
			...(installed.versionCode === undefined
				? {}
				: { versionCode: installed.versionCode }),
			...(installed.versionName === undefined
				? {}
				: { versionName: installed.versionName })
		},
		installMs,
		launchMs,
		relaunchMs,
		releaseId: options.release.metadata.releaseId,
		signed: options.release.metadata.signed,
		status: 'pass'
	};
};
