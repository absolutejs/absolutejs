import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
	ABSOLUTE_ANDROID_AVD_NAME,
	absoluteManagedAndroidSdkRoot,
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain,
	type AbsoluteMobileDoctorCheck,
	type AbsoluteMobileHost
} from './emulatorDoctor';

const ANDROID_API = 36;
const ANDROID_BUILD_TOOLS = '36.0.0';
const COMMAND_LINE_TOOLS_VERSION = '15859902';
const LICENSE_ACCEPTANCE_RESPONSES = 100;

type CommandLineToolsRelease = {
	sha256: string;
	url: string;
};

const COMMAND_LINE_TOOLS: Record<string, CommandLineToolsRelease> = {
	'darwin-arm64': {
		sha256: '835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e',
		url: `https://dl.google.com/android/repository/commandlinetools-mac_arm64-${COMMAND_LINE_TOOLS_VERSION}_latest.zip`
	},
	'darwin-x64': {
		sha256: 'c5a6378ab5cf7e0d5701921405115befff13e9ff7417fb588389338f8bd050f3',
		url: `https://dl.google.com/android/repository/commandlinetools-mac_x86_64-${COMMAND_LINE_TOOLS_VERSION}_latest.zip`
	},
	'linux-x64': {
		sha256: '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583',
		url: `https://dl.google.com/android/repository/commandlinetools-linux-${COMMAND_LINE_TOOLS_VERSION}_latest.zip`
	},
	'windows-x64': {
		sha256: '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a',
		url: `https://dl.google.com/android/repository/commandlinetools-win-${COMMAND_LINE_TOOLS_VERSION}_latest.zip`
	}
};

export type AbsoluteMobileInstallStep = {
	detail: string;
	id: string;
	label: string;
};

export type AbsoluteMobileInstallPlan = {
	androidRoot: string;
	host: AbsoluteMobileHost;
	platform: 'android' | 'ios';
	steps: AbsoluteMobileInstallStep[];
};

export type AbsoluteMobileInstallResult = {
	checks: AbsoluteMobileDoctorCheck[];
	completed: string[];
	plan: AbsoluteMobileInstallPlan;
};

type RunOptions = {
	env?: Record<string, string | undefined>;
	input?: string;
};

type CaptureResult = {
	exitCode: number;
	stdout: string;
};

type PackageManagerCandidate = {
	command: string[];
	manager: string;
};

type AbsoluteMobileInstallerDependencies = {
	arch?: string;
	capture?: (command: string[], options?: RunOptions) => CaptureResult;
	download?: (url: string) => Promise<Uint8Array>;
	env?: Record<string, string | undefined>;
	exists?: (path: string) => Promise<boolean>;
	host?: AbsoluteMobileHost;
	log?: (message: string) => void;
	run?: (command: string[], options?: RunOptions) => Promise<number>;
	which?: (command: string) => string | null;
};

const defaultRun = async (command: string[], options: RunOptions = {}) => {
	const subprocess = Bun.spawn(command, {
		env: options.env,
		stderr: 'inherit',
		stdin: options.input === undefined ? 'inherit' : 'pipe',
		stdout: 'inherit'
	});
	if (options.input !== undefined) {
		const { stdin } = subprocess;
		if (!stdin) throw new Error('Failed to open subprocess input.');
		stdin.write(options.input);
		stdin.end();
	}

	return subprocess.exited;
};

const defaultDownload = async (url: string) => {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to download Android command-line tools (${response.status}).`
		);
	}

	return new Uint8Array(await response.arrayBuffer());
};

const defaultCapture = (command: string[], options: RunOptions = {}) => {
	const result = Bun.spawnSync(command, {
		env: options.env,
		stderr: 'ignore',
		stdout: 'pipe'
	});

	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString()
	};
};

const commandPath = (
	root: string,
	host: AbsoluteMobileHost,
	tool: 'avdmanager' | 'sdkmanager'
) =>
	join(
		root,
		'cmdline-tools',
		'latest',
		'bin',
		host === 'windows' || host === 'wsl' ? `${tool}.bat` : tool
	);

const executablePath = (
	root: string,
	host: AbsoluteMobileHost,
	directory: string,
	tool: string
) =>
	join(
		root,
		directory,
		host === 'windows' || host === 'wsl' ? `${tool}.exe` : tool
	);

const windowsPath = (path: string) => {
	const match = /^\/mnt\/([a-z])\/(.*)$/i.exec(path);
	if (!match) return path;

	return `${match[1]?.toUpperCase()}:\\${match[2]?.replaceAll('/', '\\')}`;
};

const runnableCommand = (
	host: AbsoluteMobileHost,
	path: string,
	args: string[]
) => {
	if (host !== 'wsl' || !path.endsWith('.bat')) return [path, ...args];

	return ['cmd.exe', '/d', '/c', windowsPath(path), ...args];
};

const systemImageFor = (host: AbsoluteMobileHost, arch: string) => {
	const imageArch =
		host === 'macos' && arch === 'arm64' ? 'arm64-v8a' : 'x86_64';

	return `system-images;android-${ANDROID_API};google_apis;${imageArch}`;
};

export const planAbsoluteMobileEmulatorInstall = (
	platform: 'android' | 'ios',
	input: AbsoluteMobileInstallerDependencies = {}
): AbsoluteMobileInstallPlan => {
	const host = input.host ?? detectAbsoluteMobileHost();
	const env: Record<string, string | undefined> = {
		...process.env,
		...input.env
	};
	const androidRoot =
		env.ANDROID_HOME ??
		env.ANDROID_SDK_ROOT ??
		absoluteManagedAndroidSdkRoot(host, env);
	if (platform === 'ios') {
		return {
			androidRoot,
			host,
			platform,
			steps: [
				{
					detail:
						host === 'macos'
							? 'Use Xcode to download the current iOS Simulator runtime.'
							: 'iOS Simulator setup must run on a macOS host.',
					id: 'ios.runtime',
					label: 'Install iOS Simulator runtime'
				}
			]
		};
	}

	return {
		androidRoot,
		host,
		platform,
		steps: [
			{
				detail: `Download Google's pinned command-line tools into ${androidRoot} and verify their SHA-256 checksum.`,
				id: 'android.command-line-tools',
				label: 'Install Android command-line tools'
			},
			{
				detail: `Review Android SDK licenses, then install platform-tools, emulator, API ${ANDROID_API}, and build-tools ${ANDROID_BUILD_TOOLS}.`,
				id: 'android.sdk-packages',
				label: 'Install Android SDK and emulator packages'
			},
			{
				detail: `Create ${ABSOLUTE_ANDROID_AVD_NAME} using a Google APIs system image.`,
				id: 'android.avd',
				label: 'Provision an AbsoluteJS Android emulator'
			}
		]
	};
};

const releaseFor = (host: AbsoluteMobileHost, arch: string) => {
	let platform: string = host;
	if (host === 'wsl') platform = 'windows';
	if (host === 'macos') platform = 'darwin';
	const release = COMMAND_LINE_TOOLS[`${platform}-${arch}`];
	if (!release) {
		throw new Error(
			`Automatic Android command-line-tools installation is not available for ${host}/${arch}.`
		);
	}

	return release;
};

const installCommandLineTools = async (
	plan: AbsoluteMobileInstallPlan,
	input: Required<
		Pick<
			AbsoluteMobileInstallerDependencies,
			'arch' | 'download' | 'log' | 'run'
		>
	>
) => {
	const release = releaseFor(plan.host, input.arch);
	input.log(`Downloading ${basename(release.url)}...`);
	const bytes = await input.download(release.url);
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (digest !== release.sha256) {
		throw new Error(
			`Android command-line-tools checksum mismatch: expected ${release.sha256}, received ${digest}.`
		);
	}
	const temporary = await mkdtemp(join(tmpdir(), 'absolutejs-android-sdk-'));
	try {
		const archive = join(temporary, 'command-line-tools.zip');
		const extracted = join(temporary, 'extracted');
		await Bun.write(archive, bytes);
		await mkdir(extracted, { recursive: true });
		const extraction =
			plan.host === 'windows'
				? [
						'powershell.exe',
						'-NoProfile',
						'-Command',
						'Expand-Archive',
						'-LiteralPath',
						archive,
						'-DestinationPath',
						extracted,
						'-Force'
					]
				: ['unzip', '-q', archive, '-d', extracted];
		if ((await input.run(extraction)) !== 0) {
			throw new Error('Failed to extract Android command-line tools.');
		}
		const destination = join(plan.androidRoot, 'cmdline-tools', 'latest');
		await mkdir(join(plan.androidRoot, 'cmdline-tools'), {
			recursive: true
		});
		await rm(destination, { force: true, recursive: true });
		await cp(join(extracted, 'cmdline-tools'), destination, {
			recursive: true
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
};

const ensureCommand = async (
	command: string[],
	label: string,
	run: NonNullable<AbsoluteMobileInstallerDependencies['run']>,
	options?: RunOptions
) => {
	if ((await run(command, options)) !== 0) {
		throw new Error(`${label} failed.`);
	}
};

const installJavaRuntime = async (
	host: AbsoluteMobileHost,
	run: NonNullable<AbsoluteMobileInstallerDependencies['run']>,
	which: NonNullable<AbsoluteMobileInstallerDependencies['which']>
) => {
	if (host === 'windows' || host === 'wsl') {
		const winget = host === 'wsl' ? 'winget.exe' : 'winget';
		if (!which(winget)) {
			throw new Error(
				'Java 21 is required. Install Temurin 21 or make winget available, then run mobile doctor --fix again.'
			);
		}
		const command = [
			winget,
			'install',
			'--exact',
			'--id',
			'EclipseAdoptium.Temurin.21.JDK',
			'--accept-package-agreements',
			'--accept-source-agreements'
		];
		await ensureCommand(
			host === 'wsl' ? ['cmd.exe', '/d', '/c', ...command] : command,
			'Java 21 installation',
			run
		);

		return;
	}
	if (host === 'macos') {
		if (!which('brew')) {
			throw new Error(
				'Java 21 is required. Install Homebrew or Temurin 21, then run mobile doctor --fix again.'
			);
		}
		await ensureCommand(
			['brew', 'install', '--cask', 'temurin@21'],
			'Java 21 installation',
			run
		);

		return;
	}
	const candidates: PackageManagerCandidate[] = [
		{
			command: ['sudo', 'apt-get', 'install', '-y', 'openjdk-21-jdk'],
			manager: 'apt-get'
		},
		{
			command: ['sudo', 'dnf', 'install', '-y', 'java-21-openjdk-devel'],
			manager: 'dnf'
		},
		{
			command: ['sudo', 'pacman', '-S', '--noconfirm', 'jdk21-openjdk'],
			manager: 'pacman'
		}
	];
	const candidate = candidates.find(({ manager }) => which(manager));
	if (!candidate) {
		throw new Error(
			'Java 21 is required and no supported package manager was found. Install a JDK, then run mobile doctor --fix again.'
		);
	}
	await ensureCommand(candidate.command, 'Java 21 installation', run);
};

export const fixAbsoluteMobileEmulatorToolchain = async (
	platform: 'android' | 'ios',
	options: AbsoluteMobileInstallerDependencies & {
		acceptLicenses?: boolean;
	} = {}
): Promise<AbsoluteMobileInstallResult> => {
	const plan = planAbsoluteMobileEmulatorInstall(platform, options);
	const run = options.run ?? defaultRun;
	const capture = options.capture ?? defaultCapture;
	const log = options.log ?? console.log;
	const which = options.which ?? ((command: string) => Bun.which(command));
	if (platform === 'ios') {
		if (plan.host !== 'macos') {
			throw new Error(
				'iOS Simulator installation requires macOS and Xcode.'
			);
		}
		if (!which('xcodebuild') || !which('xcrun')) {
			throw new Error(
				'iOS Simulator installation requires a complete Xcode installation selected with xcode-select.'
			);
		}
		await ensureCommand(
			['xcodebuild', '-downloadPlatform', 'iOS'],
			'iOS Simulator runtime installation',
			run
		);
		const checks = await inspectAbsoluteMobileToolchain({
			host: plan.host
		});

		return { checks, completed: ['ios.runtime'], plan };
	}

	const arch = options.arch ?? process.arch;
	const exists =
		options.exists ??
		(async (path: string) => {
			try {
				await readFile(path);

				return true;
			} catch {
				return false;
			}
		});
	const completed: string[] = [];
	const javaCommand = plan.host === 'wsl' ? 'java.exe' : 'java';
	if (!which(javaCommand)) {
		await installJavaRuntime(plan.host, run, which);
		completed.push('android.java');
	}
	const sdkmanager = commandPath(plan.androidRoot, plan.host, 'sdkmanager');
	if (!(await exists(sdkmanager))) {
		await installCommandLineTools(plan, {
			arch,
			download: options.download ?? defaultDownload,
			log,
			run
		});
		completed.push('android.command-line-tools');
	}
	const sdkEnv: Record<string, string | undefined> = {
		...process.env,
		...options.env,
		ANDROID_HOME:
			plan.host === 'wsl'
				? windowsPath(plan.androidRoot)
				: plan.androidRoot
	};
	const licenses = runnableCommand(plan.host, sdkmanager, ['--licenses']);
	await ensureCommand(
		licenses,
		'Android SDK license acceptance',
		run,
		options.acceptLicenses
			? {
					env: sdkEnv,
					input: 'y\n'.repeat(LICENSE_ACCEPTANCE_RESPONSES)
				}
			: { env: sdkEnv }
	);
	const systemImage = systemImageFor(plan.host, arch);
	await ensureCommand(
		runnableCommand(plan.host, sdkmanager, [
			'platform-tools',
			'emulator',
			`platforms;android-${ANDROID_API}`,
			`build-tools;${ANDROID_BUILD_TOOLS}`,
			systemImage
		]),
		'Android SDK package installation',
		run,
		{ env: sdkEnv }
	);
	completed.push('android.sdk-packages');

	const emulator = executablePath(
		plan.androidRoot,
		plan.host,
		'emulator',
		'emulator'
	);
	const avdName = ABSOLUTE_ANDROID_AVD_NAME;
	const list = capture(runnableCommand(plan.host, emulator, ['-list-avds']), {
		env: sdkEnv
	});
	if (!list.stdout.split(/\r?\n/).includes(avdName)) {
		const avdmanager = commandPath(
			plan.androidRoot,
			plan.host,
			'avdmanager'
		);
		await ensureCommand(
			runnableCommand(plan.host, avdmanager, [
				'create',
				'avd',
				'--force',
				'--name',
				avdName,
				'--package',
				systemImage,
				'--device',
				'pixel_7'
			]),
			'Android emulator provisioning',
			run,
			{ env: sdkEnv, input: 'no\n' }
		);
		completed.push('android.avd');
	}
	const checks = await inspectAbsoluteMobileToolchain({
		androidRoot: plan.androidRoot,
		env: { ...options.env, ANDROID_HOME: plan.androidRoot },
		exists,
		host: plan.host,
		which,
		capture: (command) => capture(command)
	});

	return { checks, completed, plan };
};
