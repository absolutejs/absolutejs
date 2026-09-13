export type AbsoluteIosInstalledApp = {
	appContainer: string;
	appId: string;
	buildNumber?: string;
	dataContainer: string;
	version?: string;
};

export type AbsoluteIosUpgradeCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
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

const requiredOutput = (
	result: AbsoluteIosUpgradeCommandResult,
	message: string
) => {
	const value = result.stdout.trim();
	if (result.exitCode !== 0 || !value)
		throw new Error(
			`${message}: ${result.stderr.trim() || value || 'no output'}`
		);

	return value;
};

export const inspectAbsoluteIosInstalledApp = async (
	xcrun: string,
	udid: string,
	appId: string,
	run: (
		command: string[]
	) => Promise<AbsoluteIosUpgradeCommandResult> = captureCommand,
	plutil = '/usr/bin/plutil'
) => {
	const dataContainer = requiredOutput(
		await run([xcrun, 'simctl', 'get_app_container', udid, appId, 'data']),
		`Could not inspect the installed iOS data container for ${appId}`
	);
	const appContainer = requiredOutput(
		await run([xcrun, 'simctl', 'get_app_container', udid, appId, 'app']),
		`Could not inspect the installed iOS application container for ${appId}`
	);
	const info = requiredOutput(
		await run([
			plutil,
			'-convert',
			'json',
			'-o',
			'-',
			`${appContainer}/Info.plist`
		]),
		`Could not inspect the installed iOS Info.plist for ${appId}`
	);

	return parseAbsoluteIosInstalledAppInfo(
		appId,
		appContainer,
		dataContainer,
		info
	);
};
export const parseAbsoluteIosInstalledAppInfo = (
	appId: string,
	appContainer: string,
	dataContainer: string,
	output: string
): AbsoluteIosInstalledApp => {
	let value: unknown;
	try {
		value = JSON.parse(output);
	} catch {
		throw new TypeError(
			'Invalid installed iOS application Info.plist JSON.'
		);
	}
	if (!value || typeof value !== 'object')
		throw new TypeError(
			'Invalid installed iOS application Info.plist JSON.'
		);
	const bundleId = Reflect.get(value, 'CFBundleIdentifier');
	if (bundleId !== appId)
		throw new Error(
			`Installed iOS application identifier mismatch (${String(bundleId)} != ${appId}).`
		);
	const buildNumber = Reflect.get(value, 'CFBundleVersion');
	const version = Reflect.get(value, 'CFBundleShortVersionString');

	return {
		appContainer,
		appId,
		...(typeof buildNumber === 'string' || typeof buildNumber === 'number'
			? { buildNumber: String(buildNumber) }
			: {}),
		dataContainer,
		...(typeof version === 'string' ? { version } : {})
	};
};

const numericBuild = (value: string | undefined) => {
	if (!value || !/^\d+$/u.test(value)) return undefined;

	return BigInt(value);
};

/** Prove that Simulator inspections describe one app replaced by a newer build. */
export const assertAbsoluteIosInstalledAppUpgrade = (
	before: AbsoluteIosInstalledApp,
	after: AbsoluteIosInstalledApp
) => {
	if (before.appId !== after.appId)
		throw new Error(
			`iOS bundle identifier changed during the replacement upgrade (${before.appId} -> ${after.appId}).`
		);
	if (!before.dataContainer || !after.dataContainer)
		throw new Error(
			'iOS did not report a data container for the upgrade proof.'
		);
	if (before.dataContainer !== after.dataContainer)
		throw new Error(
			'iOS data container changed during the replacement upgrade.'
		);
	const beforeBuild = numericBuild(before.buildNumber);
	const afterBuild = numericBuild(after.buildNumber);
	if (beforeBuild === undefined || afterBuild === undefined)
		throw new Error(
			'iOS did not report numeric CFBundleVersion values for the upgrade proof.'
		);
	if (afterBuild <= beforeBuild)
		throw new Error(
			`iOS CFBundleVersion did not increase (${before.buildNumber} -> ${after.buildNumber}).`
		);
};
