export type AbsoluteIosDeviceAcceptanceResult = {
	hmrConnected: true;
	installed: true;
	relaunchMs: number;
};

type CommandResult = { exitCode: number; stderr: string; stdout: string };

export const absoluteIosDeviceAcceptanceCommands = (options: {
	appId: string;
	device: string;
	xcrun?: string;
}) => {
	const xcrun = options.xcrun ?? '/usr/bin/xcrun';
	const prefix = [xcrun, 'devicectl', 'device'];

	return {
		apps: [...prefix, 'info', 'apps', '--device', options.device],
		details: [...prefix, 'info', 'details', '--device', options.device],
		launch: [
			...prefix,
			'process',
			'launch',
			'--terminate-existing',
			'--device',
			options.device,
			options.appId
		]
	};
};

const requireSuccess = (result: CommandResult, message: string) => {
	if (result.exitCode !== 0) throw new Error(message);

	return result;
};

/**
 * Validate and relaunch a physical iOS app without retaining device inventory,
 * signing output, or console output in the acceptance result.
 */
export const testAbsoluteIosPhysicalDevice = async (options: {
	appId: string;
	capture: (command: string[]) => Promise<CommandResult>;
	device: string;
	now?: () => number;
	waitForHmr: () => Promise<void>;
	xcrun?: string;
}): Promise<AbsoluteIosDeviceAcceptanceResult> => {
	const commands = absoluteIosDeviceAcceptanceCommands(options);
	requireSuccess(
		await options.capture(commands.details),
		'The selected physical iOS device is unavailable. Pair it in Xcode Device Hub, trust this Mac, unlock it, and enable Developer Mode.'
	);
	const apps = requireSuccess(
		await options.capture(commands.apps),
		'AbsoluteJS could not inspect installed apps on the physical iOS device.'
	);
	if (!apps.stdout.includes(options.appId))
		throw new Error(
			'The AbsoluteJS app is not installed on the selected physical iOS device. Start bun dev with the same --ios-device value first.'
		);
	const now = options.now ?? performance.now.bind(performance);
	const startedAt = now();
	requireSuccess(
		await options.capture(commands.launch),
		'AbsoluteJS could not relaunch the app on the physical iOS device.'
	);
	await options.waitForHmr();

	return {
		hmrConnected: true,
		installed: true,
		relaunchMs: Math.round(now() - startedAt)
	};
};
