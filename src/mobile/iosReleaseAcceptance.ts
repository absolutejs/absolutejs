import { createHash } from 'node:crypto';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat
} from 'node:fs/promises';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	requireAbsoluteIosReleaseMetadata,
	resolveAbsoluteIosXcodeProject,
	type AbsoluteIosReleaseMetadata
} from './iosRelease';
import { inspectAbsoluteIosInstalledApp } from './iosUpgradeConformance';

const READY_MARKERS = {
	capacitor: 'Capacitor embedded web content ready',
	expo: 'Expo embedded web content ready'
} as const;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;

type CommandOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
};

export type AbsoluteIosReleaseCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type AbsoluteIosReleaseCommand = (
	command: string[],
	options?: CommandOptions
) => Promise<AbsoluteIosReleaseCommandResult>;

export type AbsoluteIosRelease = {
	artifactPath: string;
	metadata: AbsoluteIosReleaseMetadata;
	metadataPath: string;
	releaseRoot: string;
	registeredArtifactPath?: string;
};

export type AbsoluteIosReleaseAcceptanceResult = {
	artifactBytes: number;
	artifactExactness:
		| 'archive-equivalent'
		| 'source-equivalent'
		| 'store-delivered';
	artifactSha256: string;
	buildNumber?: number;
	distribution: 'apple-processed' | 'registered-device' | 'simulator-release';
	durationMs: number;
	embeddedLocal: true;
	engine: 'capacitor' | 'expo';
	installMs: number;
	launchMs: number;
	marketingVersion: string;
	networkUnavailable: 'not-proven' | 'user-confirmed';
	relaunchMs: number;
	releaseId: string;
	signed: boolean;
	status: 'pass';
	target: 'device' | 'simulator';
};

const defaultRun: AbsoluteIosReleaseCommand = async (command, options = {}) => {
	const process = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
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

const requireSuccess = async (
	run: AbsoluteIosReleaseCommand,
	command: string[],
	label: string,
	options?: CommandOptions
) => {
	const result = await run(command, options);
	if (result.exitCode !== 0)
		throw new Error(
			`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `status ${result.exitCode}`}`
		);

	return result;
};

const findByExtension = async (
	root: string,
	extension: string
): Promise<string | undefined> => {
	if (!(await exists(root))) return undefined;
	const entries = await readdir(root, { withFileTypes: true });
	const matches = await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			if (entry.name.endsWith(extension)) return path;

			return entry.isDirectory()
				? findByExtension(path, extension)
				: undefined;
		})
	);

	return matches.find((match) => match !== undefined);
};

/** Revalidate an immutable AbsoluteJS iOS release and optional registered-device export. */
export const readAbsoluteIosRelease = async (
	projectRoot: string,
	requested: string
): Promise<AbsoluteIosRelease> => {
	const root = resolve(projectRoot);
	const selected = resolve(root, requested);
	if (!inside(root, selected))
		throw new TypeError(
			'mobile test ios --release must remain inside the project.'
		);
	const metadataPath =
		basename(selected) === 'release.json'
			? selected
			: join(selected, 'release.json');
	const releaseRoot = dirname(metadataPath);
	const metadata = requireAbsoluteIosReleaseMetadata(
		JSON.parse(await readFile(metadataPath, 'utf8'))
	);
	const artifactPath = resolve(releaseRoot, metadata.artifact);
	if (!inside(releaseRoot, artifactPath))
		throw new TypeError('iOS release artifact path is invalid.');
	const [artifactStat, artifactSha256] = await Promise.all([
		stat(artifactPath),
		sha256(artifactPath)
	]);
	if (
		artifactStat.size !== metadata.bytes ||
		artifactSha256 !== metadata.sha256
	)
		throw new TypeError(
			`Immutable iOS release ${metadata.releaseId} is missing or modified.`
		);
	const registered = metadata.registeredDevice;
	let registeredArtifactPath: string | undefined;
	if (registered) {
		registeredArtifactPath = resolve(releaseRoot, registered.artifact);
		if (!inside(releaseRoot, registeredArtifactPath))
			throw new TypeError(
				'iOS registered-device artifact path is invalid.'
			);
		const [registeredStat, registeredSha256] = await Promise.all([
			stat(registeredArtifactPath),
			sha256(registeredArtifactPath)
		]);
		if (
			registeredStat.size !== registered.bytes ||
			registeredSha256 !== registered.sha256
		)
			throw new TypeError(
				`Registered-device export for ${metadata.releaseId} is missing or modified.`
			);
	}

	return {
		artifactPath,
		metadata,
		metadataPath,
		registeredArtifactPath,
		releaseRoot
	};
};

const releaseMarker = (release: AbsoluteIosRelease) => {
	const marker = READY_MARKERS[release.metadata.engine];

	return release.metadata.buildNumber === undefined
		? marker
		: `${marker}; version=${release.metadata.marketingVersion}; build=${release.metadata.buildNumber}`;
};

const waitForSimulatorMarker = async (options: {
	release: AbsoluteIosRelease;
	run: AbsoluteIosReleaseCommand;
	signal?: AbortSignal;
	udid: string;
	xcrun: string;
	startedAt: Date;
}) => {
	const startedAt = performance.now();
	const poll = async (): Promise<void> => {
		options.signal?.throwIfAborted();
		if (performance.now() - startedAt >= READY_TIMEOUT_MS)
			throw new Error(
				'The installed iOS Release app launched but its embedded content did not become ready.'
			);
		const logs = await options.run([
			options.xcrun,
			'simctl',
			'spawn',
			options.udid,
			'log',
			'show',
			'--style',
			'compact',
			'--start',
			options.startedAt.toISOString(),
			'--predicate',
			`eventMessage CONTAINS "${releaseMarker(options.release)}"`
		]);
		if (
			logs.exitCode === 0 &&
			logs.stdout.includes(releaseMarker(options.release))
		)
			return;
		await Bun.sleep(READY_POLL_MS);

		await poll();
	};

	await poll();
};

const launchSimulator = async (options: {
	release: AbsoluteIosRelease;
	run: AbsoluteIosReleaseCommand;
	signal?: AbortSignal;
	udid: string;
	xcrun: string;
}) => {
	const startedAt = performance.now();
	const logStartedAt = new Date();
	await requireSuccess(
		options.run,
		[
			options.xcrun,
			'simctl',
			'launch',
			'--terminate-running-process',
			options.udid,
			options.release.metadata.appId
		],
		'iOS Simulator Release launch'
	);
	await waitForSimulatorMarker({ ...options, startedAt: logStartedAt });

	return Math.round(performance.now() - startedAt);
};

export const runAbsoluteIosSimulatorReleaseAcceptance = async (options: {
	artifactDirectory: string;
	config: NormalizedAbsoluteMobileConfig;
	release: AbsoluteIosRelease;
	run?: AbsoluteIosReleaseCommand;
	signal?: AbortSignal;
	udid: string;
	xcodebuild?: string;
	xcrun?: string;
}): Promise<AbsoluteIosReleaseAcceptanceResult> => {
	const baseRun = options.run ?? defaultRun;
	const run: AbsoluteIosReleaseCommand = (command, commandOptions = {}) =>
		baseRun(command, {
			...commandOptions,
			...(options.signal ? { signal: options.signal } : {})
		});
	options.signal?.throwIfAborted();
	const xcodebuild = options.xcodebuild ?? '/usr/bin/xcodebuild';
	const xcrun = options.xcrun ?? '/usr/bin/xcrun';
	const startedAt = performance.now();
	const iosRoot = join(options.config.nativeProjectDirectory, 'ios');
	const xcode = await resolveAbsoluteIosXcodeProject(iosRoot);
	const derivedData = join(options.artifactDirectory, 'DerivedData');
	await mkdir(options.artifactDirectory, { recursive: true });
	await requireSuccess(
		run,
		[
			xcodebuild,
			'-workspace',
			xcode.workspacePath,
			'-scheme',
			xcode.scheme,
			'-configuration',
			'Release',
			'-destination',
			`platform=iOS Simulator,id=${options.udid}`,
			'-derivedDataPath',
			derivedData,
			`MARKETING_VERSION=${options.release.metadata.marketingVersion}`,
			...(options.release.metadata.buildNumber === undefined
				? []
				: [
						`CURRENT_PROJECT_VERSION=${options.release.metadata.buildNumber}`
					]),
			'build'
		],
		'iOS Simulator Release build',
		{ cwd: iosRoot }
	);
	const app = await findByExtension(
		join(derivedData, 'Build', 'Products'),
		'.app'
	);
	if (!app) throw new Error('Xcode did not produce a Simulator Release app.');
	const installStartedAt = performance.now();
	await requireSuccess(
		run,
		[xcrun, 'simctl', 'install', options.udid, app],
		'iOS Simulator Release installation'
	);
	const installMs = Math.round(performance.now() - installStartedAt);
	const installed = await inspectAbsoluteIosInstalledApp(
		xcrun,
		options.udid,
		options.release.metadata.appId,
		(command) => run(command)
	);
	if (installed.version !== options.release.metadata.marketingVersion)
		throw new Error(
			`Installed iOS version ${installed.version ?? 'unknown'} does not match release ${options.release.metadata.marketingVersion}.`
		);
	if (
		options.release.metadata.buildNumber !== undefined &&
		installed.buildNumber !== String(options.release.metadata.buildNumber)
	)
		throw new Error(
			`Installed iOS build ${installed.buildNumber ?? 'unknown'} does not match release ${options.release.metadata.buildNumber}.`
		);
	const launchMs = await launchSimulator({
		release: options.release,
		run,
		udid: options.udid,
		xcrun
	});
	await requireSuccess(
		run,
		[
			xcrun,
			'simctl',
			'terminate',
			options.udid,
			options.release.metadata.appId
		],
		'iOS Simulator Release termination'
	);
	const relaunchMs = await launchSimulator({
		release: options.release,
		run,
		udid: options.udid,
		xcrun
	});

	return {
		artifactBytes: options.release.metadata.bytes,
		artifactExactness: 'source-equivalent',
		artifactSha256: options.release.metadata.sha256,
		...(options.release.metadata.buildNumber === undefined
			? {}
			: { buildNumber: options.release.metadata.buildNumber }),
		distribution: 'simulator-release',
		durationMs: Math.round(performance.now() - startedAt),
		embeddedLocal: true,
		engine: options.release.metadata.engine,
		installMs,
		launchMs,
		marketingVersion: options.release.metadata.marketingVersion,
		networkUnavailable: 'not-proven',
		relaunchMs,
		releaseId: options.release.metadata.releaseId,
		signed: options.release.metadata.signed,
		status: 'pass',
		target: 'simulator'
	};
};

const readUntilMarker = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	marker: string,
	output = ''
): Promise<{ found: boolean; output: string }> => {
	const { done, value } = await reader.read();
	if (done) return { found: false, output };
	const next = `${output}${new TextDecoder().decode(value)}`;
	if (next.includes(marker)) return { found: true, output: next };

	return readUntilMarker(reader, marker, next);
};

const observeDeviceLaunch = async (options: {
	appId: string;
	device: string;
	marker: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	xcrun: string;
}) => {
	const startedAt = performance.now();
	const process = Bun.spawn(
		[
			options.xcrun,
			'devicectl',
			'device',
			'process',
			'launch',
			'--console',
			'--terminate-existing',
			'--device',
			options.device,
			options.appId
		],
		{
			signal: options.signal,
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		}
	);
	const stdoutReader = process.stdout.getReader();
	const stderrReader = process.stderr.getReader();
	const requireMarker = async (
		reader: ReadableStreamDefaultReader<Uint8Array>
	) => {
		const result = await readUntilMarker(reader, options.marker);
		if (!result.found)
			throw new Error(
				`Console stream closed before readiness.${result.output.trim() ? ` Output: ${result.output.trim()}` : ''}`
			);

		return result;
	};
	const observed = Promise.any([
		requireMarker(stdoutReader),
		requireMarker(stderrReader)
	]);
	try {
		const result = await Promise.race([
			observed
				.then((value) => ({ type: 'output' as const, value }))
				.catch(() => ({ type: 'closed' as const })),
			Bun.sleep(options.timeoutMs ?? READY_TIMEOUT_MS).then(() => ({
				type: 'timeout' as const
			}))
		]);
		if (result.type === 'output' && result.value.found)
			return Math.round(performance.now() - startedAt);
		if (result.type === 'closed')
			throw new Error(
				'The physical iOS app exited before embedded content became ready.'
			);
		throw new Error(
			'The physical iOS app did not report embedded readiness before the timeout.'
		);
	} finally {
		process.kill();
		await Promise.all([
			stdoutReader.cancel().catch(() => undefined),
			stderrReader.cancel().catch(() => undefined)
		]);
		stdoutReader.releaseLock();
		stderrReader.releaseLock();
	}
};

type DeviceInstallationOptions = {
	device: string;
	release: AbsoluteIosRelease;
	run: AbsoluteIosReleaseCommand;
	xcrun: string;
};

const installRegisteredDeviceRelease = async (
	options: DeviceInstallationOptions
) => {
	if (!options.release.registeredArtifactPath)
		throw new TypeError(
			'This release has no same-archive registered-device IPA. Rebuild with `absolute mobile build ios --registered-device-artifact`.'
		);
	const staging = await mkdtemp(
		join(dirname(options.release.releaseRoot), '.ios-device-')
	);
	try {
		await requireSuccess(
			options.run,
			[
				'/usr/bin/ditto',
				'-x',
				'-k',
				options.release.registeredArtifactPath,
				staging
			],
			'iOS registered-device IPA extraction'
		);
		const app = await findByExtension(staging, '.app');
		if (!app)
			throw new Error(
				'The registered-device IPA contains no installable app.'
			);
		const startedAt = performance.now();
		await requireSuccess(
			options.run,
			[
				options.xcrun,
				'devicectl',
				'device',
				'install',
				'app',
				'--device',
				options.device,
				app
			],
			'iOS registered-device Release installation'
		);

		return Math.round(performance.now() - startedAt);
	} finally {
		await rm(staging, { force: true, recursive: true });
	}
};

const inspectTestFlightInstallation = async (
	options: DeviceInstallationOptions
) => {
	const apps = await requireSuccess(
		options.run,
		[
			options.xcrun,
			'devicectl',
			'device',
			'info',
			'apps',
			'--device',
			options.device
		],
		'TestFlight installation inspection'
	);
	if (!apps.stdout.includes(options.release.metadata.appId))
		throw new Error(
			'The selected device does not have the requested TestFlight app installed.'
		);

	return 0;
};

export const runAbsoluteIosDeviceReleaseAcceptance = async (options: {
	device: string;
	distribution: 'registered-device' | 'testflight';
	networkUnavailableConfirmed: boolean;
	observeLaunch?: (options: {
		appId: string;
		device: string;
		marker: string;
	}) => Promise<number>;
	release: AbsoluteIosRelease;
	run?: AbsoluteIosReleaseCommand;
	signal?: AbortSignal;
	xcrun?: string;
}): Promise<AbsoluteIosReleaseAcceptanceResult> => {
	if (!options.networkUnavailableConfirmed)
		throw new TypeError(
			'Physical iOS offline acceptance requires explicit confirmation that Airplane Mode is enabled and Wi-Fi is disabled in Settings.'
		);
	const baseRun = options.run ?? defaultRun;
	const run: AbsoluteIosReleaseCommand = (command, commandOptions = {}) =>
		baseRun(command, {
			...commandOptions,
			...(options.signal ? { signal: options.signal } : {})
		});
	options.signal?.throwIfAborted();
	const xcrun = options.xcrun ?? '/usr/bin/xcrun';
	const startedAt = performance.now();
	await requireSuccess(
		run,
		[
			xcrun,
			'devicectl',
			'device',
			'info',
			'details',
			'--device',
			options.device
		],
		'iOS physical-device availability inspection'
	);
	const installation: DeviceInstallationOptions = {
		device: options.device,
		release: options.release,
		run,
		xcrun
	};
	const installMs =
		options.distribution === 'registered-device'
			? await installRegisteredDeviceRelease(installation)
			: await inspectTestFlightInstallation(installation);
	const observe =
		options.observeLaunch ??
		((launch) =>
			observeDeviceLaunch({
				...launch,
				...(options.signal ? { signal: options.signal } : {}),
				xcrun
			}));
	const marker = releaseMarker(options.release);
	const launchMs = await observe({
		appId: options.release.metadata.appId,
		device: options.device,
		marker
	});
	const relaunchMs = await observe({
		appId: options.release.metadata.appId,
		device: options.device,
		marker
	});

	return {
		artifactBytes: options.release.metadata.bytes,
		artifactExactness:
			options.distribution === 'testflight'
				? 'store-delivered'
				: 'archive-equivalent',
		artifactSha256: options.release.metadata.sha256,
		...(options.release.metadata.buildNumber === undefined
			? {}
			: { buildNumber: options.release.metadata.buildNumber }),
		distribution:
			options.distribution === 'testflight'
				? 'apple-processed'
				: 'registered-device',
		durationMs: Math.round(performance.now() - startedAt),
		embeddedLocal: true,
		engine: options.release.metadata.engine,
		installMs,
		launchMs,
		marketingVersion: options.release.metadata.marketingVersion,
		networkUnavailable: 'user-confirmed',
		relaunchMs,
		releaseId: options.release.metadata.releaseId,
		signed: options.release.metadata.signed,
		status: 'pass',
		target: 'device'
	};
};
