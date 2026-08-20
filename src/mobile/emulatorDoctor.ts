import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isWSLEnvironment } from '../cli/utils';

export type AbsoluteMobileHost = 'macos' | 'windows' | 'linux' | 'wsl';
export type AbsoluteMobileDoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';
export const ABSOLUTE_ANDROID_AVD_NAME = 'AbsoluteJS_API_36';

export type AbsoluteMobileDoctorCheck = {
	id: string;
	label: string;
	path?: string;
	platform: 'host' | 'android' | 'ios';
	remediation?: string;
	status: AbsoluteMobileDoctorStatus;
};

export type InspectAbsoluteMobileToolchainOptions = {
	androidRoot?: string | null;
	capture?: (command: string[]) => { exitCode: number; stdout: string };
	env?: Record<string, string | undefined>;
	exists?: (path: string) => Promise<boolean>;
	host?: AbsoluteMobileHost;
	which?: (command: string) => string | null;
};

const captureCommand = (command: string[]) => {
	try {
		const result = Bun.spawnSync(command, {
			stderr: 'ignore',
			stdout: 'pipe'
		});

		return {
			exitCode: result.exitCode,
			stdout: result.stdout.toString()
		};
	} catch {
		return { exitCode: 1, stdout: '' };
	}
};

const hasAvailableIosRuntime = (output: string) => {
	try {
		const parsed: unknown = JSON.parse(output);
		if (typeof parsed !== 'object' || parsed === null) return false;
		const runtimes = Reflect.get(parsed, 'runtimes');
		if (!Array.isArray(runtimes)) return false;

		return runtimes.some(
			(runtime) =>
				typeof runtime === 'object' &&
				runtime !== null &&
				Reflect.get(runtime, 'isAvailable') === true &&
				typeof Reflect.get(runtime, 'identifier') === 'string' &&
				String(Reflect.get(runtime, 'identifier')).includes('iOS')
		);
	} catch {
		return false;
	}
};

const windowsPathToWsl = (path: string) => {
	const match = /^([a-z]):[\\/](.*)$/i.exec(path.trim());
	if (!match) return path.trim().replaceAll('\\', '/');

	return `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll('\\', '/')}`;
};

const windowsLocalAppDataFromWsl = () => {
	try {
		const result = Bun.spawnSync(
			['cmd.exe', '/d', '/c', 'echo', '%LOCALAPPDATA%'],
			{ stderr: 'ignore', stdout: 'pipe' }
		);
		if (result.exitCode !== 0) return undefined;
		const output = result.stdout.toString().trim();
		if (!output || output === '%LOCALAPPDATA%') return undefined;

		return windowsPathToWsl(output);
	} catch {
		return undefined;
	}
};

export const absoluteManagedAndroidSdkRoot = (
	host: AbsoluteMobileHost,
	env: Record<string, string | undefined> = process.env
) => {
	if (host === 'windows') {
		return join(
			env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
			'AbsoluteJS',
			'Android',
			'Sdk'
		);
	}
	if (host === 'wsl') {
		const localAppData = windowsLocalAppDataFromWsl();
		if (localAppData) {
			return join(localAppData, 'AbsoluteJS', 'Android', 'Sdk');
		}
	}

	return join(homedir(), '.absolutejs', 'android-sdk');
};

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

export const detectAbsoluteMobileHost = (
	platform = process.platform,
	wsl = isWSLEnvironment()
) => {
	if (platform === 'darwin') return 'macos';
	if (platform === 'win32') return 'windows';
	if (platform === 'linux' && wsl) return 'wsl';

	return 'linux';
};

const executableNames = (host: AbsoluteMobileHost, name: string) => {
	if (host === 'wsl') return [`${name}.exe`, `${name}.bat`, name];
	if (host === 'windows') return [name, `${name}.exe`, `${name}.bat`];

	return [name];
};

const findExecutable = async (
	name: string,
	paths: string[],
	options: Required<
		Pick<InspectAbsoluteMobileToolchainOptions, 'exists' | 'which'>
	>,
	host: AbsoluteMobileHost
) => {
	const existing = await Promise.all(
		paths.map(async (path) =>
			(await options.exists(path)) ? path : undefined
		)
	);
	const configured = existing.find((path) => path !== undefined);
	if (configured) return configured;
	for (const candidate of executableNames(host, name)) {
		const path = options.which(candidate);
		if (path) return path;
	}

	return undefined;
};

const toolCheck = (
	id: string,
	label: string,
	platform: 'android' | 'ios',
	path: string | undefined,
	remediation: string
) =>
	path
		? ({
				id,
				label,
				path,
				platform,
				status: 'pass'
			} satisfies AbsoluteMobileDoctorCheck)
		: ({
				id,
				label,
				platform,
				remediation,
				status: 'fail'
			} satisfies AbsoluteMobileDoctorCheck);

export const inspectAbsoluteMobileToolchain = async (
	input: InspectAbsoluteMobileToolchainOptions = {}
) => {
	const env = input.env ?? process.env;
	const host = input.host ?? detectAbsoluteMobileHost();
	const exists = input.exists ?? pathExists;
	const which = input.which ?? ((command: string) => Bun.which(command));
	const capture = input.capture ?? captureCommand;
	const androidRoot =
		input.androidRoot === null
			? undefined
			: (input.androidRoot ??
				env.ANDROID_HOME ??
				env.ANDROID_SDK_ROOT ??
				absoluteManagedAndroidSdkRoot(host, env));
	const windowsAndroidTools = host === 'windows' || host === 'wsl';
	const android = (segments: string[]) =>
		androidRoot ? join(androidRoot, ...segments) : undefined;
	const paths = (values: Array<string | undefined>) =>
		values.filter((value): value is string => Boolean(value));
	const adb = await findExecutable(
		'adb',
		paths([
			android(['platform-tools', windowsAndroidTools ? 'adb.exe' : 'adb'])
		]),
		{ exists, which },
		host
	);
	const emulator = await findExecutable(
		'emulator',
		paths([
			android([
				'emulator',
				windowsAndroidTools ? 'emulator.exe' : 'emulator'
			])
		]),
		{ exists, which },
		host
	);
	const sdkmanager = await findExecutable(
		'sdkmanager',
		paths([
			android([
				'cmdline-tools',
				'latest',
				'bin',
				windowsAndroidTools ? 'sdkmanager.bat' : 'sdkmanager'
			])
		]),
		{ exists, which },
		host
	);
	const avdmanager = await findExecutable(
		'avdmanager',
		paths([
			android([
				'cmdline-tools',
				'latest',
				'bin',
				windowsAndroidTools ? 'avdmanager.bat' : 'avdmanager'
			])
		]),
		{ exists, which },
		host
	);
	const java = await findExecutable('java', [], { exists, which }, host);
	const checks: AbsoluteMobileDoctorCheck[] = [
		{
			id: 'host',
			label: `Development host: ${host}`,
			platform: 'host',
			status: 'pass'
		},
		toolCheck(
			'android.adb',
			'Android Debug Bridge',
			'android',
			adb,
			'Install Android SDK Platform Tools or expose adb on PATH.'
		),
		toolCheck(
			'android.emulator',
			'Android Emulator',
			'android',
			emulator,
			'Install the Android Emulator from Android Studio SDK Manager.'
		),
		toolCheck(
			'android.sdkmanager',
			'Android SDK Manager',
			'android',
			sdkmanager,
			'Install Android SDK Command-line Tools (latest).'
		),
		toolCheck(
			'android.avdmanager',
			'Android Virtual Device Manager',
			'android',
			avdmanager,
			'Install Android SDK Command-line Tools (latest).'
		),
		toolCheck(
			'android.java',
			'Java runtime',
			'android',
			java,
			'Install the JDK required by the configured Android Gradle plugin.'
		)
	];
	if (emulator) {
		const avds = capture([emulator, '-list-avds']);
		const hasManagedAvd =
			avds.exitCode === 0 &&
			avds.stdout.split(/\r?\n/).includes(ABSOLUTE_ANDROID_AVD_NAME);
		checks.push({
			id: 'android.avd',
			label: `AbsoluteJS Android emulator (${ABSOLUTE_ANDROID_AVD_NAME})`,
			platform: 'android',
			remediation: hasManagedAvd
				? undefined
				: 'Run absolute mobile doctor android --fix to provision the managed emulator.',
			status: hasManagedAvd ? 'pass' : 'fail'
		});
	}

	if (host === 'wsl') {
		checks.push({
			id: 'android.virtualization',
			label: adb?.endsWith('.exe')
				? 'Windows-host Android bridge available to WSL'
				: 'WSL requires a Windows-host emulator bridge or Linux KVM',
			platform: 'android',
			remediation: adb?.endsWith('.exe')
				? undefined
				: 'Expose the Windows Android SDK adb.exe to WSL, or enable /dev/kvm for a Linux SDK.',
			status: adb?.endsWith('.exe') ? 'pass' : 'warn'
		});
	} else if (host === 'linux') {
		const hasKvm = await exists('/dev/kvm');
		checks.push({
			id: 'android.virtualization',
			label: 'Linux KVM acceleration',
			platform: 'android',
			remediation: hasKvm
				? undefined
				: 'Enable KVM and grant the current user access to /dev/kvm.',
			status: hasKvm ? 'pass' : 'warn'
		});
	}

	if (host !== 'macos') {
		checks.push({
			id: 'ios.simulator',
			label: 'iOS Simulator requires macOS and Xcode',
			platform: 'ios',
			status: 'skip'
		});

		return checks;
	}

	const xcrun = await findExecutable('xcrun', [], { exists, which }, host);
	const xcodebuild = await findExecutable(
		'xcodebuild',
		[],
		{ exists, which },
		host
	);
	checks.push(
		toolCheck(
			'ios.xcrun',
			'Xcode command runner',
			'ios',
			xcrun,
			'Install Xcode and select it with xcode-select.'
		),
		toolCheck(
			'ios.xcodebuild',
			'Xcode build system',
			'ios',
			xcodebuild,
			'Install Xcode and select it with xcode-select.'
		)
	);
	if (xcrun) {
		const runtimes = capture([
			xcrun,
			'simctl',
			'list',
			'runtimes',
			'--json'
		]);
		const hasRuntime =
			runtimes.exitCode === 0 && hasAvailableIosRuntime(runtimes.stdout);
		checks.push({
			id: 'ios.runtime',
			label: 'iOS Simulator runtime',
			platform: 'ios',
			remediation: hasRuntime
				? undefined
				: 'Run absolute mobile doctor ios --fix to download an iOS Simulator runtime.',
			status: hasRuntime ? 'pass' : 'fail'
		});
	}

	return checks;
};
