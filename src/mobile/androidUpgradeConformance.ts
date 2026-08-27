import { performance } from 'node:perf_hooks';

export type AbsoluteAndroidInstalledApp = {
	appId: string;
	dataDirectory?: string;
	firstInstallTime?: string;
	lastUpdateTime?: string;
	uid?: string;
	versionCode?: number;
	versionName?: string;
};

export type AbsoluteAndroidUpgradeState = {
	authCredential: boolean;
	pendingOperations: boolean;
	syncDatabase: boolean;
};

export type AbsoluteAndroidCompatibilityMatrix = {
	nPlusOne: 'compatible' | 'upgrade-required';
	nPlusTwo: 'compatible' | 'upgrade-required';
	nPlusThree: 'compatible' | 'upgrade-required';
	rollback: 'compatible' | 'failed';
};

export type AbsoluteAndroidUpgradeConformanceResult = {
	after: AbsoluteAndroidInstalledApp;
	before: AbsoluteAndroidInstalledApp;
	compatibility?: AbsoluteAndroidCompatibilityMatrix;
	durationMs: number;
	installMs: number;
	outcome: 'fail' | 'pass';
	state: AbsoluteAndroidUpgradeState;
};

export type AbsoluteAndroidUpgradeCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type RunAbsoluteAndroidUpgradeConformanceOptions = {
	adb: string;
	afterInstall?: (installed: AbsoluteAndroidInstalledApp) => Promise<void>;
	apkPath: string;
	appId: string;
	compatibility?: AbsoluteAndroidCompatibilityMatrix;
	run?: (command: string[]) => Promise<AbsoluteAndroidUpgradeCommandResult>;
	serial: string;
	verifyState: () => Promise<AbsoluteAndroidUpgradeState>;
};

const captureCommand = async (command: string[]) => {
	const process = Bun.spawn(command, { stderr: 'pipe', stdout: 'pipe' });
	const [exitCode, stderr, stdout] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
		new Response(process.stdout).text()
	]);

	return { exitCode, stderr, stdout };
};

const field = (output: string, name: string) =>
	new RegExp(`^\\s*${name}=([^\\r\\n]+)$`, 'mu').exec(output)?.[1]?.trim();

export const inspectAbsoluteAndroidInstalledApp = async (
	adb: string,
	serial: string,
	appId: string,
	run: (
		command: string[]
	) => Promise<AbsoluteAndroidUpgradeCommandResult> = captureCommand
) => {
	const result = await run([
		adb,
		'-s',
		serial,
		'shell',
		'dumpsys',
		'package',
		appId
	]);
	if (result.exitCode !== 0)
		throw new Error(
			`Could not inspect installed Android app ${appId}: ${result.stderr.trim() || result.stdout.trim()}`
		);
	const installed = parseAbsoluteAndroidInstalledApp(appId, result.stdout);
	if (!installed)
		throw new Error(`Android app ${appId} is not installed on ${serial}.`);

	return installed;
};
export const parseAbsoluteAndroidInstalledApp = (
	appId: string,
	output: string
): AbsoluteAndroidInstalledApp | null => {
	const packageName = /^\s*Package \[([^\]]+)\]/mu.exec(output)?.[1];
	if (packageName !== appId && !output.includes(`package:${appId}`))
		return null;
	const versionCodeText = /^\s*versionCode=(\d+)/mu.exec(output)?.[1];

	return {
		appId,
		...(field(output, 'dataDir')
			? { dataDirectory: field(output, 'dataDir') }
			: {}),
		...(field(output, 'firstInstallTime')
			? { firstInstallTime: field(output, 'firstInstallTime') }
			: {}),
		...(field(output, 'lastUpdateTime')
			? { lastUpdateTime: field(output, 'lastUpdateTime') }
			: {}),
		...(field(output, 'userId') || field(output, 'appId')
			? { uid: field(output, 'userId') ?? field(output, 'appId') }
			: {}),
		...(versionCodeText ? { versionCode: Number(versionCodeText) } : {}),
		...(field(output, 'versionName')
			? { versionName: field(output, 'versionName') }
			: {})
	};
};

const unchanged = (
	name: string,
	before: string | undefined,
	after: string | undefined
) => {
	if (!before || !after)
		throw new Error(
			`Android did not report ${name} for the upgrade proof.`
		);
	if (before !== after)
		throw new Error(`Android ${name} changed during the in-place upgrade.`);
};

export const runAbsoluteAndroidUpgradeConformance = async (
	options: RunAbsoluteAndroidUpgradeConformanceOptions
): Promise<AbsoluteAndroidUpgradeConformanceResult> => {
	const run = options.run ?? captureCommand;
	const startedAt = performance.now();
	const before = await inspectAbsoluteAndroidInstalledApp(
		options.adb,
		options.serial,
		options.appId,
		run
	);
	const installStartedAt = performance.now();
	const installed = await run([
		options.adb,
		'-s',
		options.serial,
		'install',
		'-r',
		options.apkPath
	]);
	const installMs = Math.round(performance.now() - installStartedAt);
	if (installed.exitCode !== 0 || !installed.stdout.includes('Success'))
		throw new Error(
			`Android in-place upgrade failed: ${installed.stderr.trim() || installed.stdout.trim()}`
		);
	const after = await inspectAbsoluteAndroidInstalledApp(
		options.adb,
		options.serial,
		options.appId,
		run
	);
	unchanged('application UID', before.uid, after.uid);
	unchanged('data directory', before.dataDirectory, after.dataDirectory);
	unchanged(
		'first install timestamp',
		before.firstInstallTime,
		after.firstInstallTime
	);
	if (
		before.versionCode !== undefined &&
		after.versionCode !== undefined &&
		after.versionCode <= before.versionCode
	)
		throw new Error(
			`Android versionCode did not increase (${before.versionCode} -> ${after.versionCode}).`
		);
	await options.afterInstall?.(after);
	const state = await options.verifyState();
	const compatibilityPass =
		!options.compatibility ||
		(options.compatibility.nPlusOne === 'compatible' &&
			options.compatibility.nPlusTwo === 'compatible' &&
			options.compatibility.nPlusThree === 'upgrade-required' &&
			options.compatibility.rollback === 'compatible');
	const outcome =
		Object.values(state).every(Boolean) && compatibilityPass
			? 'pass'
			: 'fail';

	return {
		after,
		before,
		...(options.compatibility
			? { compatibility: options.compatibility }
			: {}),
		durationMs: Math.round(performance.now() - startedAt),
		installMs,
		outcome,
		state
	};
};
