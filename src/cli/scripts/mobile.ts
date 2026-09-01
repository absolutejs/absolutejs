import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { MobileConfig } from '../../../types/build';
import { installPackages } from '../add/dependencies';
import { writeAbsoluteCapacitorConfig } from '../../mobile/capacitorProject';
import {
	syncAbsoluteExpoWebAssets,
	writeAbsoluteExpoProject
} from '../../mobile/expoProject';
import {
	normalizeAbsoluteMobileConfig,
	type NormalizedAbsoluteMobileConfig
} from '../../mobile/config';
import { applyAbsoluteNativeDeepLinks } from '../../mobile/nativeDeepLinks';
import { applyAbsoluteNativeDeviceCapabilities } from '../../mobile/nativeDeviceCapabilities';
import { applyAbsoluteNativeBackgroundSync } from '../../mobile/nativeBackgroundSync';
import {
	inspectAbsoluteMobileToolchain,
	type AbsoluteMobileDoctorCheck
} from '../../mobile/emulatorDoctor';
import {
	fixAbsoluteMobileEmulatorToolchain,
	planAbsoluteMobileEmulatorInstall
} from '../../mobile/emulatorInstaller';
import {
	materializeAbsoluteMobileAssociationFiles,
	verifyAbsoluteMobileAssociationFiles
} from '../../mobile/associationFiles';
import { loadConfig } from '../../utils/loadConfig';
import { listLiveInstances } from '../../utils/instanceRegistry';
import {
	parseAdbDevices,
	repairAbsoluteAndroidDevSession
} from '../../mobile/androidEmulatorController';
import { attachAbsoluteAndroidWebView } from '../../mobile/androidWebView';
import {
	inspectAbsoluteAndroidRoute,
	waitForAbsoluteAndroidHmrApply,
	type AbsoluteAndroidHmrApply,
	type AbsoluteAndroidRouteCheck
} from '../../mobile/androidConformance';
import { sendTelemetryEvent } from '../telemetryEvent';
import {
	createAbsoluteMobileComplianceReport,
	inspectAbsoluteMobileRelease
} from '../../mobile/releaseDoctor';
import { buildAbsoluteAndroidRelease } from '../../mobile/androidRelease';
import { buildAbsoluteIosRelease } from '../../mobile/iosRelease';
import {
	ABSOLUTE_IOS_SIMULATOR_NAME,
	parseIosSimulators,
	repairAbsoluteIosDevSession
} from '../../mobile/iosSimulatorController';
import { normalizeAbsoluteIosDeviceIdentifier } from '../../mobile/iosPhysicalDeviceTransport';
import { testAbsoluteIosPhysicalDevice } from '../../mobile/iosDeviceAcceptance';
import {
	waitForAbsoluteIosHmrLog,
	type AbsoluteIosHmrApply
} from '../../mobile/iosConformance';
import {
	createAbsoluteIosPartnerReport,
	readPackageVersionForIosReport,
	sanitizeIosReportText,
	writeAbsoluteIosPartnerReport,
	type AbsoluteIosAutomatedResult
} from '../../mobile/iosTestReport';
import { createAbsoluteAndroidTestReport } from '../../mobile/androidTestReport';
import {
	sanitizeNativeReportText,
	writeAbsoluteNativeTestReport
} from '../../mobile/nativeTestReport';
import {
	loadAbsoluteNativeReleasePublisher,
	prepareAbsoluteAndroidRelease,
	prepareAbsoluteIosRelease,
	publishAbsoluteAndroidRelease,
	publishAbsoluteIosRelease,
	type AbsoluteAppStoreConnectReleaseTarget,
	type AbsoluteGooglePlayReleaseTarget,
	type AbsoluteNativeReleasePublication
} from '../../mobile/releasePublisher';
import { start } from './start';
import { DEFAULT_SERVER_ENTRY } from '../utils';
import { getDurationString } from '../../utils/getDurationString';
import {
	listAbsoluteRemoteMacProfiles,
	getAbsoluteRemoteMacProfile,
	inspectAbsoluteRemoteMac,
	captureAbsoluteRemoteMacCommand,
	pairAbsoluteRemoteMac,
	removeAbsoluteRemoteMacProfile,
	type AbsoluteRemoteMacProfile
} from '../../mobile/remoteMacProtocol';
import { projectUsesAbsoluteSync } from '../../mobile/nativeAuth';
import { discoverAbsoluteSyncSchema } from '../../mobile/syncSchema';
import { resolveAbsoluteDeviceCapabilityPlan } from '../../mobile/deviceCapabilities';
import {
	inspectAbsoluteMobileProject,
	renderAbsoluteMobileProjectInspection
} from '../../mobile/mobileInspect';
import { writeAbsoluteMobileGithubWorkflow } from '../../mobile/ciWorkflow';

const NOT_FOUND = -1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

type AndroidSession = Awaited<ReturnType<typeof attachAbsoluteAndroidWebView>>;

type AndroidTestReport = {
	checks: AbsoluteAndroidRouteCheck[];
	diagnostics: AndroidSession['diagnostics'];
	durationMs: number;
	hmrApply?: AbsoluteAndroidHmrApply;
	platform: 'android';
	port: number;
	provider: 'capacitor';
	serial: string;
	status: 'pass';
};

type AndroidFailureArtifactOptions = {
	artifactRoot: string;
	error: unknown;
	port: number;
	serial: string;
	session?: AndroidSession;
};

type IosTestReport = {
	appId: string;
	durationMs: number;
	hmrConnected: true;
	hmrApply?: AbsoluteIosHmrApply;
	platform: 'ios';
	port: number;
	provider: 'capacitor';
	screenshot?: string;
	status: 'pass';
	target: 'device' | 'simulator';
	targetId: string;
};

type MobileCiPublicResult = {
	changed: boolean;
	format: number;
	path: string;
	platforms: ('android' | 'ios')[];
	publishing: boolean;
	requiredSecrets: string[];
};

const CAPACITOR_PACKAGES = [
	'@capacitor/core',
	'@capacitor/app',
	'@capacitor/browser',
	'@capacitor/network',
	'@capacitor/preferences',
	'@capacitor/cli',
	'@capacitor/android',
	'@capacitor/ios',
	'@absolutejs/devices',
	'@absolutejs/devices-capacitor'
];

const CAPACITOR_PACKAGE_SPECS = [
	'@capacitor/core@8.5.0',
	'@capacitor/app@8.1.1',
	'@capacitor/browser@8.0.4',
	'@capacitor/network@8.0.1',
	'@capacitor/preferences@8.0.1',
	'@capacitor/cli@8.5.0',
	'@capacitor/android@8.5.0',
	'@capacitor/ios@8.5.0',
	'@absolutejs/devices@0.5.0',
	'@absolutejs/devices-capacitor@0.6.1'
];

const CAPACITOR_SYNC_PACKAGE_SPECS = [
	'@absolutejs/sync-capacitor@0.9.1',
	'@capacitor-community/sqlite@8.1.1'
];

const packageNameFromSpec = (spec: string) =>
	spec.slice(0, spec.lastIndexOf('@'));

const directProjectPackages = async (projectRoot: string) => {
	const manifest: unknown = JSON.parse(
		await readFile(join(projectRoot, 'package.json'), 'utf8')
	);
	if (!isRecord(manifest))
		throw new TypeError('Application package.json must contain an object.');
	const names = new Set<string>();
	for (const field of ['dependencies', 'devDependencies']) {
		const dependencies = Reflect.get(manifest, field);
		if (isRecord(dependencies))
			for (const name of Object.keys(dependencies)) names.add(name);
	}

	return names;
};

const resolvedPackageVersion = async (
	projectRoot: string,
	packageName: string
) => {
	try {
		const manifest: unknown = JSON.parse(
			await readFile(
				join(projectRoot, 'node_modules', packageName, 'package.json'),
				'utf8'
			)
		);

		return isRecord(manifest) && typeof manifest.version === 'string'
			? manifest.version
			: undefined;
	} catch {
		return undefined;
	}
};

const exactVersionFromSpec = (spec: string) =>
	spec.slice(spec.lastIndexOf('@') + 1);

const installApprovedPackages = async (
	projectRoot: string,
	args: string[],
	message: string,
	specs: string[]
) => {
	if (specs.length === 0) return;
	const approved = args.includes('--yes') || (await confirmInstall(message));
	if (!approved)
		throw new TypeError(
			`Mobile initialization requires: bun add ${specs.join(' ')}`
		);
	if (!installPackages(projectRoot, specs))
		throw new TypeError(
			'Failed to install the AbsoluteJS mobile toolchain.'
		);
};

const packagesNeedingExactInstall = async (
	projectRoot: string,
	specs: string[],
	installed: ReadonlySet<string>,
	exactPackages: ReadonlySet<string>
) =>
	(
		await Promise.all(
			specs.map(async (spec) => {
				const name = packageNameFromSpec(spec);
				const needsInstall =
					!installed.has(name) ||
					(exactPackages.has(name) &&
						(await resolvedPackageVersion(projectRoot, name)) !==
							exactVersionFromSpec(spec));

				return needsInstall ? spec : undefined;
			})
		)
	).filter((spec): spec is string => spec !== undefined);

const ensureCapacitorPackages = async (projectRoot: string, args: string[]) => {
	const specs = [
		...CAPACITOR_PACKAGE_SPECS,
		...(projectUsesAbsoluteSync(projectRoot)
			? CAPACITOR_SYNC_PACKAGE_SPECS
			: [])
	];
	const installed = await directProjectPackages(projectRoot);
	const missing = await packagesNeedingExactInstall(
		projectRoot,
		specs,
		installed,
		new Set(['@absolutejs/devices', '@absolutejs/devices-capacitor'])
	);
	await installApprovedPackages(
		projectRoot,
		args,
		'Capacitor and the AbsoluteJS native adapters are missing or outdated. Install the tested mobile toolchain now?',
		missing
	);
	const capabilityPlan = resolveAbsoluteDeviceCapabilityPlan(projectRoot);
	const directCapabilityPackages = await directProjectPackages(projectRoot);
	const capabilityPackages = await packagesNeedingExactInstall(
		projectRoot,
		capabilityPlan.requiredPackages,
		directCapabilityPackages,
		new Set(capabilityPlan.requiredPackages.map(packageNameFromSpec))
	);
	await installApprovedPackages(
		projectRoot,
		args,
		`AbsoluteJS detected native device capabilities (${capabilityPlan.capabilities.join(', ')}). Install only their required Capacitor plugins now?`,
		capabilityPackages
	);
};

const valueAfter = (args: string[], flag: string) => {
	const index = args.indexOf(flag);

	return index === NOT_FOUND ? undefined : args[index + 1];
};

const valuesAfter = (args: string[], flag: string) =>
	args.flatMap((value, index) => {
		const next = args[index + 1];

		return value === flag && next !== undefined ? [next] : [];
	});

const isMobileConfig = (value: unknown): value is MobileConfig =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'appId') === 'string' &&
	typeof Reflect.get(value, 'appName') === 'string' &&
	typeof Reflect.get(value, 'server') === 'object';

const requireMobileConfig = (value: unknown) => {
	if (!isMobileConfig(value)) {
		throw new TypeError(
			'absolute.config.ts must define mobile before running this command.'
		);
	}

	return value;
};

const capacitorExecutable = async (projectRoot: string) => {
	const executable = join(projectRoot, 'node_modules', '.bin', 'cap');
	try {
		await access(executable);

		return executable;
	} catch {
		throw new TypeError(
			`Capacitor is not installed in this app. Run: bun add ${CAPACITOR_PACKAGES.join(' ')}`
		);
	}
};

const runCapacitor = async (projectRoot: string, args: string[]) => {
	const executable = await capacitorExecutable(projectRoot);
	const process = Bun.spawn([executable, ...args], {
		cwd: projectRoot,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new TypeError(`Capacitor exited with status ${exitCode}.`);
	}
};

const runCapacitorForPlatforms = (
	projectRoot: string,
	command: 'add' | 'sync',
	platforms: readonly string[]
) =>
	platforms.reduce(
		(pending, platform) =>
			pending.then(() => runCapacitor(projectRoot, [command, platform])),
		Promise.resolve()
	);

const expoExecutable = async (project: string) => {
	const executable = join(project, 'node_modules', '.bin', 'expo');
	try {
		await access(executable);

		return executable;
	} catch {
		throw new TypeError(
			'Expo dependencies are not installed in the generated shell. Run `absolute mobile init --yes`.'
		);
	}
};

const expoProductionEnvironment = () => {
	const env: Record<string, string | undefined> = { ...process.env };
	delete env.ABSOLUTE_EXPO_DEVELOPMENT;
	delete env.ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH;
	delete env.EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN;
	delete env.EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN;
	env.BABEL_ENV = 'production';
	env.NODE_ENV = 'production';

	return env;
};

const runExpo = async (
	project: string,
	args: string[],
	options: { production?: boolean } = {}
) => {
	const executable = await expoExecutable(project);
	const env = options.production
		? expoProductionEnvironment()
		: { ...process.env };
	const subprocess = Bun.spawn([executable, ...args], {
		cwd: project,
		env,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== 0)
		throw new TypeError(`Expo exited with status ${exitCode}.`);
};

const ensureExpoPackages = async (project: string, args: string[]) => {
	try {
		const manifest: unknown = JSON.parse(
			await readFile(join(project, 'package.json'), 'utf8')
		);
		const dependencies =
			typeof manifest === 'object' && manifest !== null
				? Reflect.get(manifest, 'dependencies')
				: undefined;
		if (
			typeof dependencies !== 'object' ||
			dependencies === null ||
			Array.isArray(dependencies)
		)
			throw new TypeError('Generated Expo dependencies are invalid.');
		await Promise.all(
			Object.entries(dependencies).map(async ([name, expected]) => {
				if (typeof expected !== 'string')
					throw new TypeError(
						'Generated Expo dependency version is invalid.'
					);
				const installed: unknown = JSON.parse(
					await readFile(
						join(project, 'node_modules', name, 'package.json'),
						'utf8'
					)
				);
				const actual =
					typeof installed === 'object' && installed !== null
						? Reflect.get(installed, 'version')
						: undefined;
				if (typeof actual !== 'string')
					throw new TypeError(
						'Installed Expo dependency version is invalid.'
					);
				if (/^\d+\.\d+\.\d+$/u.test(expected) && actual !== expected)
					throw new TypeError(
						'Installed Expo dependency is outdated.'
					);
				if (expected.startsWith('~')) {
					const wanted = expected.slice(1).split('.').map(Number);
					const found = actual.split('.').map(Number);
					if (
						found[0] !== wanted[0] ||
						found[1] !== wanted[1] ||
						(found[2] ?? -1) < (wanted[2] ?? 0)
					)
						throw new TypeError(
							'Installed Expo dependency is outdated.'
						);
				}
			})
		);

		return;
	} catch {
		// The generated shell has its own dependency tree.
	}
	const approved =
		args.includes('--yes') ||
		(await confirmInstall(
			'The experimental Expo shell dependencies are missing. Install the pinned Expo SDK 57 toolchain now?'
		));
	if (!approved)
		throw new TypeError(
			`Expo initialization requires running \`bun install\` in ${project}.`
		);
	const process = Bun.spawn(['bun', 'install'], {
		cwd: project,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await process.exited;
	if (exitCode !== 0)
		throw new TypeError(
			`Expo dependency installation exited with status ${exitCode}.`
		);
};

const loadMobile = async (configPath: string | undefined) => {
	const projectRoot = process.cwd();
	const config = await loadConfig(configPath);
	const mobile = normalizeAbsoluteMobileConfig(
		requireMobileConfig(config.mobile),
		projectRoot
	);

	return { mobile, projectRoot };
};

const requireCapacitorEngine = (
	mobile: Awaited<ReturnType<typeof loadMobile>>['mobile'],
	command: string
) => {
	if (mobile.engine === 'capacitor') return;
	throw new TypeError(`${command} is not available for the Expo engine yet.`);
};

const inspectMobile = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	const report = await inspectAbsoluteMobileProject(mobile, projectRoot, {
		absolutejsVersion: await absolutejsVersionForReport()
	});
	const requireBundle = () => {
		if (!args.includes('--require-bundle')) return;
		if (
			report.bundle.status !== 'valid' ||
			report.capabilities.issue ||
			report.capabilities.embeddedMatchesCurrent !== true
		)
			throw new TypeError(
				'Mobile bundle validation failed. Regenerate the production bundle and resolve capability drift.'
			);
	};
	if (args.includes('--json')) {
		console.log(JSON.stringify(report, null, 2));
		requireBundle();

		return report;
	}
	console.log(renderAbsoluteMobileProjectInspection(report).trimEnd());
	requireBundle();

	return report;
};

const remoteProfilePath = () =>
	process.env.ABSOLUTE_REMOTE_MAC_PROFILE_PATH || undefined;

const pairRemoteMac = async (args: string[]) => {
	if (args[0] !== 'mac' || !args[1] || !args[2])
		throw new TypeError(
			'Usage: absolute mobile pair mac <name> <user@host> [--port n] [--workspace path]'
		);
	const portValue = valueAfter(args, '--port');
	const port = portValue === undefined ? undefined : Number(portValue);
	const profile = await pairAbsoluteRemoteMac({
		destination: args[2],
		name: args[1],
		...(port === undefined ? {} : { port }),
		profilePath: remoteProfilePath(),
		workspaceRoot: valueAfter(args, '--workspace')
	});
	sendTelemetryEvent('mobile:remote-mac-paired', {
		platform: 'ios',
		provider: 'ssh'
	});
	console.log(
		`Paired remote Mac ${profile.name} (${profile.xcodeVersion}) and selected it as the default iOS development host.`
	);
};

const listRemoteMacs = async (args: string[]) => {
	const result = await listAbsoluteRemoteMacProfiles(remoteProfilePath());
	if (args.includes('--json')) {
		console.log(JSON.stringify(result, null, 2));

		return;
	}
	if (result.profiles.length === 0) {
		console.log(
			'No remote Macs are paired. Run `absolute mobile pair mac <name> <user@host>`.'
		);

		return;
	}
	for (const profile of result.profiles) {
		console.log(
			`${profile.name === result.defaultProfile ? '* ' : '  '}${profile.name}  ${profile.destination}  ${profile.xcodeVersion}`
		);
	}
};

const unpairRemoteMac = async (args: string[]) => {
	if (args[0] !== 'mac' || !args[1])
		throw new TypeError('Usage: absolute mobile unpair mac <name>');
	const removed = await removeAbsoluteRemoteMacProfile(
		args[1],
		remoteProfilePath()
	);
	console.log(
		removed
			? `Removed remote Mac profile ${args[1]}.`
			: `Remote Mac profile ${args[1]} was not found.`
	);
};

const initialize = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	if (mobile.engine === 'expo') {
		console.warn(
			'Experimental: Expo Android builds and publishing are available; iOS releases and physical-device acceptance are not complete.'
		);
		const generated = await writeAbsoluteExpoProject(mobile, {
			force: args.includes('--force'),
			projectRoot
		});
		console.log(
			`${generated.changed > 0 ? 'Generated' : 'Verified'} Expo shell ${generated.path}`
		);
		await ensureExpoPackages(generated.path, args);
		if (args.includes('--no-native')) return;
		await runExpo(generated.path, [
			'prebuild',
			'--no-install',
			'--platform',
			mobile.platforms.length === 2
				? 'all'
				: (mobile.platforms[0] ?? 'all')
		]);

		return;
	}
	await ensureCapacitorPackages(projectRoot, args);
	const generated = await writeAbsoluteCapacitorConfig(mobile, {
		force: args.includes('--force'),
		projectRoot
	});
	console.log(
		`${generated.changed ? 'Generated' : 'Verified'} ${generated.path}`
	);
	if (args.includes('--no-native')) return;
	await runCapacitorForPlatforms(projectRoot, 'add', mobile.platforms);
	await applyAbsoluteNativeDeepLinks(mobile);
	await applyAbsoluteNativeDeviceCapabilities(projectRoot, mobile);
	await applyAbsoluteNativeBackgroundSync(projectRoot, mobile);
};

const sync = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	if (mobile.engine === 'expo') {
		console.warn(
			'Experimental: syncing the Expo CNG shell and embedded AbsoluteJS bundle.'
		);
		await writeAbsoluteExpoProject(mobile, {
			force: args.includes('--force'),
			projectRoot
		});
		await ensureExpoPackages(mobile.nativeProjectDirectory, args);
		const assets = await syncAbsoluteExpoWebAssets(mobile);
		console.log(
			`Synced ${assets.assets} embedded AbsoluteJS assets for ${assets.appBuild}.`
		);
		const platform = args.find(
			(value) => value === 'android' || value === 'ios'
		);
		const platforms = platform ? [platform] : mobile.platforms;
		await runExpo(mobile.nativeProjectDirectory, [
			'prebuild',
			'--no-install',
			'--platform',
			platforms.length === 2 ? 'all' : (platforms[0] ?? 'all')
		]);

		return;
	}
	await ensureCapacitorPackages(projectRoot, args);
	const platform = args.find(
		(value) => value === 'android' || value === 'ios'
	);
	const platforms = platform ? [platform] : mobile.platforms;
	if (platforms.includes('android'))
		await repairAbsoluteAndroidDevSession(projectRoot);
	if (platforms.includes('ios'))
		await repairAbsoluteIosDevSession(projectRoot);
	await runCapacitorForPlatforms(projectRoot, 'sync', platforms);
	await applyAbsoluteNativeDeepLinks(mobile, platforms);
	await applyAbsoluteNativeDeviceCapabilities(projectRoot, mobile, platforms);
	await applyAbsoluteNativeBackgroundSync(projectRoot, mobile, platforms);
};

const associations = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	const outputDirectory = resolve(
		projectRoot,
		valueAfter(args, '--outdir') ?? '.absolutejs/mobile/associations'
	);
	if (args.includes('--verify')) {
		const result = await verifyAbsoluteMobileAssociationFiles(mobile);
		console.log(
			`Verified ${result.results.length} hosted association files`
		);

		return;
	}
	if (
		outputDirectory !== projectRoot &&
		!outputDirectory.startsWith(`${projectRoot}/`)
	) {
		throw new TypeError(
			'mobile associations --outdir must remain inside the project.'
		);
	}
	const result = await materializeAbsoluteMobileAssociationFiles(
		mobile,
		outputDirectory
	);
	console.log(
		`Generated ${result.written.length} association files in ${result.root}`
	);
};

const mobileCiServerEntry = (args: string[]) => {
	const valueFlags = new Set([
		'--config',
		'--output',
		'--registry',
		'--secret-env'
	]);
	const skipped = new Set<number>();
	args.forEach((value, index) => {
		if (!valueFlags.has(value)) return;
		skipped.add(index);
		skipped.add(index + 1);
	});

	return (
		args.find(
			(value, index) =>
				!skipped.has(index) &&
				value !== 'github' &&
				!value.startsWith('-')
		) ?? DEFAULT_SERVER_ENTRY
	);
};

const generateGithubCi = async (args: string[]) => {
	if (args[0] !== 'github')
		throw new TypeError(
			'Usage: absolute mobile ci github [server-entry] [--publish] [--registry module] [--secret-env NAME] [--output path] [--force] [--json] [--config path]'
		);
	const configPath = valueAfter(args, '--config');
	const { mobile, projectRoot } = await loadMobile(configPath);
	const result = await writeAbsoluteMobileGithubWorkflow({
		config: mobile,
		configPath,
		force: args.includes('--force'),
		includePublishing: args.includes('--publish'),
		outputPath: valueAfter(args, '--output'),
		projectRoot,
		registryModule: valueAfter(args, '--registry'),
		secretEnvironment: valuesAfter(args, '--secret-env'),
		serverEntry: mobileCiServerEntry(args)
	});
	sendTelemetryEvent('mobile:ci-generated', {
		platformCount: result.platforms.length,
		provider: 'github-actions',
		publishing: result.publishing
	});
	const publicResult: MobileCiPublicResult = {
		changed: result.changed,
		format: result.format,
		path: relative(projectRoot, result.path).replaceAll('\\', '/'),
		platforms: result.platforms,
		publishing: result.publishing,
		requiredSecrets: result.requiredSecrets
	};
	if (args.includes('--json')) {
		console.log(JSON.stringify(publicResult, null, 2));

		return publicResult;
	}
	console.log(
		`${result.changed ? 'Generated' : 'Verified'} ${publicResult.path} for ${result.platforms.join(' and ')}.`
	);
	console.log(
		'Create a protected GitHub environment named absolute-mobile-release, then add these secrets:'
	);
	result.requiredSecrets.forEach((name) => console.log(`  ${name}`));
	console.log(
		'Pull requests run the secret-free release audit. Signed builds and optional publishing run only through manual workflow dispatch.'
	);

	return publicResult;
};

const doctorMark = (status: AbsoluteMobileDoctorCheck['status']) => {
	if (status === 'pass') return '\x1b[32m✓\x1b[0m';
	if (status === 'fail') return '\x1b[31m✗\x1b[0m';
	if (status === 'warn') return '\x1b[33m!\x1b[0m';

	return '\x1b[2m-\x1b[0m';
};

const confirmInstall = async (message: string) => {
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
		console.error(
			'Cannot prompt for emulator installation without a TTY. Re-run with --yes to approve the displayed installation plan, or omit --fix.'
		);
		process.exitCode = 1;

		return null;
	}
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout
	});
	try {
		const answer = (await prompt.question(`${message} [Y/n] `))
			.trim()
			.toLowerCase();

		return answer === '' || answer === 'y' || answer === 'yes';
	} finally {
		prompt.close();
	}
};

const printDoctorChecks = (checks: AbsoluteMobileDoctorCheck[]) => {
	for (const check of checks) {
		console.log(
			`${doctorMark(check.status)} ${check.label}${check.path ? ` (${check.path})` : ''}`
		);
		if (check.remediation) console.log(`  ${check.remediation}`);
	}
};

const runReleaseDoctor = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	const platform = args.find(
		(value) => value === 'android' || value === 'ios'
	);
	const effectiveMobile = platform
		? { ...mobile, platforms: [platform] }
		: mobile;
	const result = await inspectAbsoluteMobileRelease(
		effectiveMobile,
		projectRoot
	);
	if (args.includes('--json')) {
		console.log(
			JSON.stringify(
				createAbsoluteMobileComplianceReport(effectiveMobile, result),
				null,
				2
			)
		);
	} else {
		result.checks.forEach((check) => {
			console.log(
				`${doctorMark(check.status)} ${check.detail}${check.path ? ` (${check.path})` : ''}`
			);
			if (check.remediation) console.log(`  ${check.remediation}`);
		});
		console.log(
			result.ready
				? '\nMobile release security and compliance checks passed.'
				: '\nMobile release security and compliance checks failed.'
		);
	}
	if (!result.ready) {
		throw new TypeError(
			'Mobile release validation failed. Resolve every failed check before signing or publishing the app.'
		);
	}
};

const mobileBuildServerEntry = (args: string[]) => {
	const valueFlags = new Set([
		'--channel',
		'--config',
		'--outdir',
		'--play-name',
		'--play-notes',
		'--play-rollout',
		'--play-status',
		'--play-track',
		'--play-update-priority',
		'--registry',
		'--testflight-group',
		'--testflight-notes',
		'--web-outdir'
	]);
	const skipped = new Set<number>();
	args.forEach((value, index) => {
		if (valueFlags.has(value)) {
			skipped.add(index);
			skipped.add(index + 1);
		}
	});

	return (
		args.find(
			(value, index) =>
				!skipped.has(index) &&
				value !== '--unsigned' &&
				!value.startsWith('-')
		) ?? DEFAULT_SERVER_ENTRY
	);
};

const requireValueAfter = (args: string[], flag: string) => {
	const value = valueAfter(args, flag);
	if (!value || value.startsWith('-')) {
		throw new TypeError(`mobile publish android requires ${flag} <value>.`);
	}

	return value;
};

const requireIosValueAfter = (args: string[], flag: string) => {
	const value = valueAfter(args, flag);
	if (!value || value.startsWith('-')) {
		throw new TypeError(`mobile publish ios requires ${flag} <value>.`);
	}

	return value;
};

const appStoreConnectTarget = (
	args: string[]
): AbsoluteAppStoreConnectReleaseTarget | undefined => {
	const testFlightFlags = args.filter((value) =>
		value.startsWith('--testflight-')
	);
	if (testFlightFlags.length === 0) return undefined;
	if (
		args.some(
			(value, index) =>
				(value === '--testflight-group' ||
					value === '--testflight-notes') &&
				(!args[index + 1] || args[index + 1]?.startsWith('-'))
		)
	) {
		throw new TypeError(
			'mobile publish ios requires a value after every TestFlight group or notes flag.'
		);
	}
	const groups = valuesAfter(args, '--testflight-group');
	const submitForReview = args.includes('--testflight-submit-review');
	if (submitForReview && groups.length === 0) {
		throw new TypeError(
			'mobile publish ios --testflight-submit-review requires at least one --testflight-group.'
		);
	}
	const whatsNew = valuesAfter(args, '--testflight-notes').map((note) => {
		const separator = note.indexOf('=');
		if (separator < 1 || separator === note.length - 1) {
			throw new TypeError(
				'mobile publish ios --testflight-notes must use locale=text.'
			);
		}

		return {
			locale: note.slice(0, separator),
			text: note.slice(separator + 1)
		};
	});

	return {
		...(groups.length === 0 ? {} : { groups }),
		submitForReview,
		...(whatsNew.length === 0 ? {} : { whatsNew })
	};
};

const googlePlayTarget = (
	args: string[]
): AbsoluteGooglePlayReleaseTarget | undefined => {
	const playFlags = args.filter((value) => value.startsWith('--play-'));
	if (playFlags.length === 0) return undefined;
	if (!args.includes('--play-track')) {
		throw new TypeError(
			'mobile publish android requires --play-track <track> when using Google Play options.'
		);
	}
	const track = requireValueAfter(args, '--play-track');
	const rolloutValue = args.includes('--play-rollout')
		? requireValueAfter(args, '--play-rollout')
		: undefined;
	const userFraction =
		rolloutValue === undefined ? undefined : Number(rolloutValue);
	if (
		userFraction !== undefined &&
		(!Number.isFinite(userFraction) ||
			userFraction <= 0 ||
			userFraction >= 1)
	) {
		throw new TypeError(
			'mobile publish android --play-rollout must be greater than 0 and less than 1.'
		);
	}
	const requestedStatus = args.includes('--play-status')
		? requireValueAfter(args, '--play-status')
		: undefined;
	const statuses = {
		completed: 'completed',
		draft: 'draft',
		halted: 'halted',
		'in-progress': 'inProgress'
	} as const;
	if (requestedStatus !== undefined && !(requestedStatus in statuses)) {
		throw new TypeError(
			'mobile publish android --play-status must be completed, draft, halted, or in-progress.'
		);
	}
	let status: (typeof statuses)[keyof typeof statuses];
	if (requestedStatus === undefined) {
		status = userFraction === undefined ? 'completed' : 'inProgress';
	} else if (requestedStatus === 'in-progress') {
		status = statuses['in-progress'];
	} else if (requestedStatus === 'completed') {
		status = statuses.completed;
	} else if (requestedStatus === 'draft') {
		status = statuses.draft;
	} else {
		status = statuses.halted;
	}
	if (
		userFraction === undefined
			? status === 'inProgress' || status === 'halted'
			: status !== 'inProgress' && status !== 'halted'
	) {
		throw new TypeError(
			'mobile publish android staged statuses require --play-rollout, and other statuses forbid it.'
		);
	}
	const priorityValue = args.includes('--play-update-priority')
		? requireValueAfter(args, '--play-update-priority')
		: undefined;
	const inAppUpdatePriority =
		priorityValue === undefined ? undefined : Number(priorityValue);
	if (
		inAppUpdatePriority !== undefined &&
		(!Number.isInteger(inAppUpdatePriority) ||
			inAppUpdatePriority < 0 ||
			inAppUpdatePriority > 5)
	) {
		throw new TypeError(
			'mobile publish android --play-update-priority must be an integer from 0 through 5.'
		);
	}
	if (
		args.some(
			(value, index) =>
				value === '--play-notes' &&
				(!args[index + 1] || args[index + 1]?.startsWith('-'))
		)
	) {
		throw new TypeError(
			'mobile publish android requires --play-notes <language=text>.'
		);
	}
	const releaseNotes = valuesAfter(args, '--play-notes').map((note) => {
		const separator = note.indexOf('=');
		if (separator < 1 || separator === note.length - 1) {
			throw new TypeError(
				'mobile publish android --play-notes must use language=text.'
			);
		}

		return {
			language: note.slice(0, separator),
			text: note.slice(separator + 1)
		};
	});

	return {
		changesNotSentForReview: args.includes('--play-hold-review'),
		...(inAppUpdatePriority === undefined ? {} : { inAppUpdatePriority }),
		...(args.includes('--play-name')
			? { name: requireValueAfter(args, '--play-name') }
			: {}),
		...(releaseNotes.length === 0 ? {} : { releaseNotes }),
		reviewBehavior: args.includes('--play-cancel-existing-review')
			? 'CANCEL_IN_REVIEW_AND_SUBMIT'
			: 'ERROR_IF_IN_REVIEW',
		status,
		track,
		...(userFraction === undefined ? {} : { userFraction })
	};
};

const requireAndroidReleaseReady = async (
	mobile: Awaited<ReturnType<typeof loadMobile>>['mobile'],
	projectRoot: string
) => {
	const releaseCheck = await inspectAbsoluteMobileRelease(
		{ ...mobile, platforms: ['android'] },
		projectRoot
	);
	if (releaseCheck.ready) return;
	printDoctorChecks(
		releaseCheck.checks.map((check) => ({
			id: check.id,
			label: check.detail,
			path: check.path,
			platform: 'android',
			remediation: check.remediation,
			status: check.status
		}))
	);
	throw new TypeError(
		'Android release validation failed before Gradle signing.'
	);
};

const androidCiSigning = () => {
	const keyAlias = process.env.ABSOLUTE_ANDROID_KEY_ALIAS;
	const keyPassword = process.env.ABSOLUTE_ANDROID_KEY_PASSWORD;
	const keystorePath = process.env.ABSOLUTE_ANDROID_KEYSTORE_PATH;
	const storePassword = process.env.ABSOLUTE_ANDROID_KEYSTORE_PASSWORD;
	const supplied = [
		keyAlias,
		keyPassword,
		keystorePath,
		storePassword
	].filter((value) => value !== undefined && value !== '').length;
	if (supplied === 0) return undefined;
	if (!keyAlias || !keyPassword || !keystorePath || !storePassword)
		throw new TypeError(
			'AbsoluteJS CI signing requires ABSOLUTE_ANDROID_KEYSTORE_PATH, ABSOLUTE_ANDROID_KEYSTORE_PASSWORD, ABSOLUTE_ANDROID_KEY_ALIAS, and ABSOLUTE_ANDROID_KEY_PASSWORD together.'
		);

	return {
		keyAlias,
		keyPasswordEnvironment: 'ABSOLUTE_ANDROID_KEY_PASSWORD',
		keystorePath,
		storePasswordEnvironment: 'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD'
	};
};

const prepareExpoAndroidReleaseProject = async (
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	args: string[]
) => {
	await writeAbsoluteExpoProject(mobile, { projectRoot });
	await ensureExpoPackages(mobile.nativeProjectDirectory, [...args, '--yes']);
	await syncAbsoluteExpoWebAssets(mobile);
	await runExpo(
		mobile.nativeProjectDirectory,
		['prebuild', '--clean', '--no-install', '--platform', 'android'],
		{ production: true }
	);
};

const prepareExpoIosReleaseProject = async (
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	args: string[]
) => {
	await writeAbsoluteExpoProject(mobile, { projectRoot });
	await ensureExpoPackages(mobile.nativeProjectDirectory, [...args, '--yes']);
	await syncAbsoluteExpoWebAssets(mobile);
	await runExpo(
		mobile.nativeProjectDirectory,
		['prebuild', '--clean', '--platform', 'ios'],
		{ production: true }
	);
};

const prepareCapacitorIosReleaseProject = async (
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	await writeAbsoluteCapacitorConfig(mobile, { projectRoot });
	await runCapacitorForPlatforms(projectRoot, 'sync', ['ios']);
	await applyAbsoluteNativeDeepLinks(mobile, ['ios']);
	await applyAbsoluteNativeDeviceCapabilities(projectRoot, mobile, ['ios']);
	await applyAbsoluteNativeBackgroundSync(projectRoot, mobile, ['ios']);
};

const prepareIosReleaseProject = (
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	args: string[]
) =>
	mobile.engine === 'expo'
		? prepareExpoIosReleaseProject(mobile, projectRoot, args)
		: prepareCapacitorIosReleaseProject(mobile, projectRoot);

const prepareCapacitorAndroidReleaseProject = async (
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	await writeAbsoluteCapacitorConfig(mobile, { projectRoot });
	await runCapacitorForPlatforms(projectRoot, 'sync', ['android']);
	await applyAbsoluteNativeDeepLinks(mobile, ['android']);
	await applyAbsoluteNativeDeviceCapabilities(projectRoot, mobile, [
		'android'
	]);
	await applyAbsoluteNativeBackgroundSync(projectRoot, mobile, ['android']);
};

const prepareAndroidReleaseProject = (
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	args: string[]
) =>
	mobile.engine === 'expo'
		? prepareExpoAndroidReleaseProject(mobile, projectRoot, args)
		: prepareCapacitorAndroidReleaseProject(mobile, projectRoot);

const buildAndroid = async (
	args: string[],
	prepareVersionCode?: (buildIdentity: string) => Promise<number>
) => {
	const configPath = valueAfter(args, '--config');
	const { mobile, projectRoot } = await loadMobile(configPath);
	if (!mobile.platforms.includes('android')) {
		throw new TypeError(
			'mobile build android requires android in mobile.platforms.'
		);
	}
	const startedAt = performance.now();
	let success = false;
	try {
		if (mobile.engine === 'capacitor')
			await repairAbsoluteAndroidDevSession(projectRoot);
		await start(
			mobileBuildServerEntry(args),
			valueAfter(args, '--web-outdir'),
			configPath,
			{ prepareOnly: true }
		);
		await prepareAndroidReleaseProject(mobile, projectRoot, args);
		await requireAndroidReleaseReady(mobile, projectRoot);
		const release = await buildAbsoluteAndroidRelease({
			allowUnsigned: args.includes('--unsigned'),
			config: mobile,
			...(mobile.engine === 'expo'
				? { env: expoProductionEnvironment() }
				: {}),
			outputDirectory: valueAfter(args, '--outdir'),
			projectRoot,
			signing: androidCiSigning(),
			...(prepareVersionCode === undefined ? {} : { prepareVersionCode })
		});
		success = true;
		const durationMs = Math.round(performance.now() - startedAt);
		console.log(
			`Built ${release.metadata.signed ? 'signed' : 'unsigned'} Android App Bundle in ${getDurationString(durationMs)}.`
		);
		console.log(`Artifact: ${release.artifactPath}`);
		console.log(`Metadata: ${join(release.releaseRoot, 'release.json')}`);

		return release;
	} finally {
		sendTelemetryEvent('mobile:android-release-build', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: mobile.engine,
			platform: 'android',
			success,
			type: 'aab',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const printGooglePlayPublication = (
	googlePlay: NonNullable<AbsoluteNativeReleasePublication['googlePlay']>
) => {
	console.log(
		`${googlePlay.reused ? 'Reused' : 'Committed'} Google Play version ${googlePlay.receipt.versionCode} on ${googlePlay.receipt.intent.track}.`
	);
};

const printAppStoreConnectPublication = (
	publication: NonNullable<
		AbsoluteNativeReleasePublication['appStoreConnect']
	>
) => {
	const { receipt } = publication;

	console.log(
		`${publication.reused ? 'Reused' : 'Uploaded'} App Store Connect build ${receipt.marketingVersion} (${receipt.buildNumber}); ${receipt.stage}.`
	);
};

const publishAndroid = async (args: string[]) => {
	const registryModule = args.includes('--registry')
		? requireValueAfter(args, '--registry')
		: 'mobile.release.ts';
	const channel = args.includes('--channel')
		? requireValueAfter(args, '--channel')
		: undefined;
	const configPath = valueAfter(args, '--config');
	const googlePlay = googlePlayTarget(args);
	const { mobile, projectRoot } = await loadMobile(configPath);
	const startedAt = performance.now();
	let reused = false;
	let success = false;
	try {
		const publisher = await loadAbsoluteNativeReleasePublisher(
			projectRoot,
			registryModule
		);
		const release = await buildAndroid(
			args,
			googlePlay
				? (buildIdentity) =>
						prepareAbsoluteAndroidRelease(publisher, {
							buildIdentity,
							googlePlay,
							packageName: mobile.appId
						})
				: undefined
		);
		const publication = await publishAbsoluteAndroidRelease({
			allowUnsigned: args.includes('--unsigned'),
			channel,
			googlePlay,
			modulePath: registryModule,
			projectRoot,
			release
		});
		const { reused: publicationReused } = publication;
		reused = publicationReused;
		success = true;
		console.log(
			`${publication.reused ? 'Reused' : 'Published'} Android release ${release.metadata.releaseId}${publication.channel ? ` on ${publication.channel.channel}` : ''}.`
		);
		if (publication.googlePlay)
			printGooglePlayPublication(publication.googlePlay);

		return publication;
	} finally {
		sendTelemetryEvent('mobile:android-release-publish', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: mobile.engine,
			platform: 'android',
			provider: googlePlay ? 'google-play' : 'registry-module',
			reused,
			success,
			type: 'aab',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const requireIosReleaseReady = async (
	mobile: Awaited<ReturnType<typeof loadMobile>>['mobile'],
	projectRoot: string
) => {
	const releaseCheck = await inspectAbsoluteMobileRelease(
		{ ...mobile, platforms: ['ios'] },
		projectRoot
	);
	if (releaseCheck.ready) return;
	printDoctorChecks(
		releaseCheck.checks.map((check) => ({
			id: check.id,
			label: check.detail,
			path: check.path,
			platform: 'ios',
			remediation: check.remediation,
			status: check.status
		}))
	);
	throw new TypeError('iOS release validation failed before Xcode signing.');
};

const buildIos = async (
	args: string[],
	prepareBuildNumber?: (buildIdentity: string) => Promise<number>
) => {
	const configPath = valueAfter(args, '--config');
	const { mobile, projectRoot } = await loadMobile(configPath);
	if (!mobile.platforms.includes('ios')) {
		throw new TypeError(
			'mobile build ios requires ios in mobile.platforms.'
		);
	}
	const startedAt = performance.now();
	let success = false;
	try {
		if (mobile.engine === 'capacitor')
			await repairAbsoluteIosDevSession(projectRoot);
		await start(
			mobileBuildServerEntry(args),
			valueAfter(args, '--web-outdir'),
			configPath,
			{ prepareOnly: true }
		);
		await prepareIosReleaseProject(mobile, projectRoot, args);
		await requireIosReleaseReady(mobile, projectRoot);
		const release = await buildAbsoluteIosRelease({
			allowUnsigned: args.includes('--unsigned'),
			config: mobile,
			developmentTeam: process.env.ABSOLUTE_IOS_DEVELOPMENT_TEAM,
			...(mobile.engine === 'expo'
				? { env: expoProductionEnvironment() }
				: {}),
			outputDirectory: valueAfter(args, '--outdir'),
			...(prepareBuildNumber === undefined ? {} : { prepareBuildNumber }),
			projectRoot
		});
		success = true;
		const durationMs = Math.round(performance.now() - startedAt);
		console.log(
			`Built ${release.metadata.signed ? 'signed' : 'unsigned'} iOS IPA ${release.metadata.marketingVersion}${release.metadata.buildNumber ? ` (${release.metadata.buildNumber})` : ''} in ${getDurationString(durationMs)}.`
		);
		console.log(`Artifact: ${release.artifactPath}`);
		console.log(`Metadata: ${join(release.releaseRoot, 'release.json')}`);

		return release;
	} finally {
		sendTelemetryEvent('mobile:ios-release-build', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: mobile.engine,
			platform: 'ios',
			success,
			type: 'ipa',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const publishIos = async (args: string[]) => {
	const registryModule = args.includes('--registry')
		? requireIosValueAfter(args, '--registry')
		: 'mobile.release.ts';
	const channel = args.includes('--channel')
		? requireIosValueAfter(args, '--channel')
		: undefined;
	const configPath = valueAfter(args, '--config');
	const appStoreConnect = appStoreConnectTarget(args);
	const { mobile, projectRoot } = await loadMobile(configPath);
	const startedAt = performance.now();
	let reused = false;
	let success = false;
	try {
		const publisher = await loadAbsoluteNativeReleasePublisher(
			projectRoot,
			registryModule
		);
		const release = await buildIos(
			args,
			appStoreConnect
				? (buildIdentity) => {
						if (!mobile.iosVersion)
							throw new TypeError(
								'iOS publishing requires mobile.ios.version.'
							);

						return prepareAbsoluteIosRelease(publisher, {
							buildIdentity,
							bundleId: mobile.appId,
							marketingVersion: mobile.iosVersion
						});
					}
				: undefined
		);
		const publication = await publishAbsoluteIosRelease({
			allowUnsigned: args.includes('--unsigned'),
			appStoreConnect,
			channel,
			modulePath: registryModule,
			projectRoot,
			release
		});
		const {
			appStoreConnect: appStoreConnectPublication,
			reused: publicationReused
		} = publication;

		reused = publicationReused;
		success = true;
		console.log(
			`${publication.reused ? 'Reused' : 'Published'} iOS release ${release.metadata.releaseId}${publication.channel ? ` on ${publication.channel.channel}` : ''}.`
		);
		if (appStoreConnectPublication)
			printAppStoreConnectPublication(appStoreConnectPublication);

		return publication;
	} finally {
		sendTelemetryEvent('mobile:ios-release-publish', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: mobile.engine,
			platform: 'ios',
			provider: appStoreConnect ? 'app-store-connect' : 'registry-module',
			reused,
			success,
			type: 'ipa',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const inspectRemoteMacForDoctor = async (profile: AbsoluteRemoteMacProfile) => {
	try {
		const inspection = await inspectAbsoluteRemoteMac(profile.destination, {
			port: profile.port
		});

		return [
			{
				id: 'ios.remote-ssh',
				label: `Remote Mac ${profile.name} is reachable`,
				platform: 'ios',
				status: 'pass'
			},
			{
				id: 'ios.remote-bun',
				label: `Remote Bun ${inspection.bunPath}`,
				path: inspection.bunPath,
				platform: 'ios',
				status: 'pass'
			},
			{
				id: 'ios.remote-xcode',
				label: inspection.xcodeVersion,
				platform: 'ios',
				status: 'pass'
			}
		] satisfies AbsoluteMobileDoctorCheck[];
	} catch (error) {
		return [
			{
				id: 'ios.remote-ssh',
				label: `Remote Mac ${profile.name} is unavailable`,
				platform: 'ios',
				remediation:
					error instanceof Error ? error.message : String(error),
				status: 'fail'
			}
		] satisfies AbsoluteMobileDoctorCheck[];
	}
};

const appendSyncSchemaDoctorCheck = (
	checks: AbsoluteMobileDoctorCheck[],
	projectRoot: string
) => {
	if (!projectUsesAbsoluteSync(projectRoot)) return;
	try {
		const schema = discoverAbsoluteSyncSchema(projectRoot);
		checks.push({
			id: 'sync.storage-schema',
			label: `Offline schema ${schema.components
				.map((component) => `${component.id}@${component.version}`)
				.join(', ')}`,
			path: join(projectRoot, 'package.json'),
			platform: 'host',
			status: 'pass'
		});
	} catch (error) {
		checks.push({
			id: 'sync.storage-schema',
			label: 'Offline schema metadata is invalid',
			path: join(projectRoot, 'package.json'),
			platform: 'host',
			remediation: error instanceof Error ? error.message : String(error),
			status: 'fail'
		});
	}
};

const doctor = async (args: string[]) => {
	if (args.includes('release')) {
		await runReleaseDoctor(args);

		return;
	}
	const platform = args.find(
		(value) => value === 'android' || value === 'ios'
	);
	const requestedRemote = valueAfter(args, '--remote');
	const remoteProfile =
		platform === 'ios' &&
		(requestedRemote !== undefined || process.platform !== 'darwin')
			? await getAbsoluteRemoteMacProfile(
					requestedRemote,
					remoteProfilePath()
				)
			: undefined;
	if (remoteProfile) {
		if (args.includes('--fix'))
			throw new TypeError(
				'Remote Mac doctor is read-only. Configure Xcode or Bun on the Mac, then rerun doctor.'
			);
		const selected = await inspectRemoteMacForDoctor(remoteProfile);
		if (args.includes('--json'))
			console.log(JSON.stringify({ checks: selected }, null, 2));
		else printDoctorChecks(selected);

		return;
	}
	const checks = await inspectAbsoluteMobileToolchain();
	appendSyncSchemaDoctorCheck(checks, process.cwd());
	const selected = platform
		? checks.filter(
				(check) =>
					check.platform === 'host' || check.platform === platform
			)
		: checks;
	if (args.includes('--json')) {
		if (args.includes('--fix')) {
			throw new TypeError(
				'mobile doctor --json cannot be combined with --fix.'
			);
		}
		console.log(JSON.stringify({ checks: selected }, null, 2));

		return;
	}
	printDoctorChecks(selected);
	if (!args.includes('--fix')) return;
	const installPlatform = platform ?? 'android';
	const relevantFailures = selected.filter(
		(check) =>
			check.platform === installPlatform &&
			(check.status === 'fail' || check.status === 'warn')
	);
	if (relevantFailures.length === 0) {
		console.log(`\n${installPlatform} emulator prerequisites are ready.`);

		return;
	}
	const plan = planAbsoluteMobileEmulatorInstall(installPlatform);
	console.log(`\nAbsoluteJS can configure ${installPlatform} emulation:`);
	for (const [index, step] of plan.steps.entries()) {
		console.log(`  ${index + 1}. ${step.label}`);
		console.log(`     ${step.detail}`);
	}
	const approved =
		args.includes('--yes') ||
		(await confirmInstall(
			`Install and configure ${installPlatform} emulator prerequisites now?`
		));
	if (approved === null) return;
	if (!approved) {
		console.log('Installation skipped. No machine changes were made.');

		return;
	}
	console.log('');
	const result = await fixAbsoluteMobileEmulatorToolchain(installPlatform, {
		acceptLicenses: args.includes('--yes')
	});
	console.log('\nEmulator setup verification:');
	printDoctorChecks(
		result.checks.filter(
			(check) =>
				check.platform === 'host' || check.platform === installPlatform
		)
	);
};

const captureCommand = (command: string[]) => {
	const result = Bun.spawnSync(command, {
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});

	return {
		exitCode: result.exitCode,
		stderr: result.stderr.toString(),
		stdout: result.stdout.toString()
	};
};

const requireAndroidTestPort = (args: string[], projectRoot: string) => {
	const explicit = valueAfter(args, '--port');
	if (explicit !== undefined) {
		const port = Number(explicit);
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new TypeError('mobile test --port must be a valid TCP port.');
		}

		return { https: args.includes('--https'), port };
	}
	const instances = listLiveInstances().filter(
		(instance) =>
			resolve(instance.cwd) === resolve(projectRoot) &&
			instance.source === 'dev' &&
			instance.port !== null
	);
	if (instances.length !== 1) {
		throw new TypeError(
			instances.length === 0
				? 'No running AbsoluteJS dev server was found for this project. Start `bun dev`, wait for Android to report ready, then run `absolute mobile test android`.'
				: 'Multiple dev servers are running for this project. Select one with mobile test android --port <port>.'
		);
	}
	const [instance] = instances;
	if (!instance || instance.port === null) {
		throw new TypeError('The selected dev server has no resolved port.');
	}

	return { https: instance.https, port: instance.port };
};

const androidTestTimeout = (args: string[]) => {
	const explicit = valueAfter(args, '--timeout');
	if (explicit === undefined) return 30_000;
	const timeout = Number(explicit);
	if (!Number.isInteger(timeout) || timeout < 1) {
		throw new TypeError(
			'mobile test --timeout must be a positive number of milliseconds.'
		);
	}

	return timeout;
};

const requireAndroidAdb = async () => {
	const checks = await inspectAbsoluteMobileToolchain();
	const adb = checks.find(
		(check) => check.id === 'android.adb' && check.status === 'pass'
	)?.path;
	if (!adb) {
		throw new TypeError(
			'Android Debug Bridge is unavailable. Run `absolute mobile doctor android --fix`.'
		);
	}

	return adb;
};

const selectAndroidSerial = (
	adb: string,
	explicitSerial: string | undefined
) => {
	const devices = captureCommand([adb, 'devices']);
	if (devices.exitCode !== 0) {
		throw new Error(
			`Could not list Android targets: ${devices.stderr.trim() || devices.stdout.trim()}`
		);
	}
	const ready = parseAdbDevices(devices.stdout);
	if (explicitSerial) {
		if (!ready.includes(explicitSerial)) {
			throw new TypeError(
				`Android target ${explicitSerial} is not connected and ready.`
			);
		}

		return explicitSerial;
	}
	const selected = ready.find((serial) => serial.startsWith('emulator-'));
	if (!selected) {
		throw new TypeError(
			'No ready Android emulator was found. Start `bun dev` and wait for the Android target to become ready.'
		);
	}

	return selected;
};

const safeArtifactRoot = (projectRoot: string, value: string | undefined) => {
	const root = resolve(
		projectRoot,
		value ?? '.absolutejs/mobile/test-artifacts'
	);
	if (root !== projectRoot && !root.startsWith(`${resolve(projectRoot)}/`)) {
		throw new TypeError(
			'mobile test --artifacts must remain inside the project.'
		);
	}

	return root;
};

const inspectAndroidRoutes = (
	session: AndroidSession,
	routes: string[],
	options: { https: boolean; port: number; timeoutMs: number }
) =>
	routes.reduce<Promise<AbsoluteAndroidRouteCheck[]>>(
		async (pending, route) => [
			...(await pending),
			await inspectAbsoluteAndroidRoute(session, { ...options, route })
		],
		Promise.resolve([])
	);

const printAndroidTestReport = (report: AndroidTestReport) => {
	report.checks.forEach((check) => {
		console.log(
			`✓ Android WebView ${check.route}: ${check.title || '(untitled)'}; HMR connected; target ${check.nativeTarget}`
		);
	});
	if (!report.hmrApply) return;
	console.log(
		`✓ Native HMR ${report.hmrApply.kind ?? 'update'} ${report.hmrApply.outcome} in ${report.hmrApply.duration}ms (server ${report.hmrApply.serverMs}ms, client ${report.hmrApply.clientMs}ms).`
	);
};

const waitForRequestedAndroidHmr = async (
	args: string[],
	session: AndroidSession,
	checks: AbsoluteAndroidRouteCheck[],
	timeoutMs: number
) => {
	if (!args.includes('--wait-for-hmr')) return undefined;
	if (!args.includes('--json'))
		console.log(
			'Android WebView is ready. Save a source edit now; waiting for a native HMR acknowledgement…'
		);

	return waitForAbsoluteAndroidHmrApply(session, {
		afterUpdateId: checks.at(-1)?.lastApply?.updateId,
		timeoutMs
	});
};

const writeAndroidFailureArtifacts = async (
	options: AndroidFailureArtifactOptions
) => {
	await mkdir(options.artifactRoot, { recursive: true });
	const screenshot = options.session
		? await options.session
				.screenshot(join(options.artifactRoot, 'android-failure.png'))
				.catch(() => undefined)
		: undefined;
	const diagnosticPath = join(options.artifactRoot, 'android-failure.json');
	await writeFile(
		diagnosticPath,
		`${JSON.stringify(
			{
				diagnostics: options.session?.diagnostics ?? [],
				error:
					options.error instanceof Error
						? options.error.message
						: String(options.error),
				platform: 'android',
				port: options.port,
				screenshot,
				serial: options.serial,
				status: 'fail'
			},
			null,
			2
		)}\n`
	);

	return { diagnosticPath, screenshot };
};

const testAndroid = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	requireCapacitorEngine(mobile, 'mobile test android');
	if (!mobile.platforms.includes('android')) {
		throw new TypeError(
			'mobile test android requires android in mobile.platforms.'
		);
	}
	const { https, port } = requireAndroidTestPort(args, projectRoot);
	const timeoutMs = androidTestTimeout(args);
	const adb = await requireAndroidAdb();
	const serial = selectAndroidSerial(adb, valueAfter(args, '--serial'));
	const routes = valuesAfter(args, '--route');
	if (routes.length === 0) routes.push(mobile.entry);
	const reportRoot = nativeReportRoot(args, projectRoot, 'android');
	const artifactRoot =
		reportRoot ??
		safeArtifactRoot(projectRoot, valueAfter(args, '--artifacts'));
	const startedAt = performance.now();
	let session: AndroidSession | undefined;
	try {
		session = await attachAbsoluteAndroidWebView({
			adb,
			appId: mobile.appId,
			serial,
			timeoutMs
		});
		const checks = await inspectAndroidRoutes(session, routes, {
			https,
			port,
			timeoutMs
		});
		const hmrApply = await waitForRequestedAndroidHmr(
			args,
			session,
			checks,
			timeoutMs
		);
		const report: AndroidTestReport = {
			checks,
			diagnostics: session.diagnostics,
			durationMs: Math.round(performance.now() - startedAt),
			hmrApply,
			platform: 'android',
			port,
			provider: 'capacitor',
			serial,
			status: 'pass'
		};
		sendTelemetryEvent('mobile:android-conformance', {
			durationMs: report.durationMs,
			platform: report.platform,
			provider: report.provider,
			routeCount: report.checks.length,
			success: true,
			waitedForHmr: args.includes('--wait-for-hmr')
		});
		if (args.includes('--json'))
			console.log(JSON.stringify(report, null, 2));
		else printAndroidTestReport(report);
		const screenshot = reportRoot
			? await session.screenshot(
					join(artifactRoot, 'android-emulator.png')
				)
			: undefined;
		await writeRequestedAndroidReport({
			adb,
			args,
			projectRoot,
			run: {
				appId: mobile.appId,
				durationMs: report.durationMs,
				...(hmrApply
					? {
							hmr: {
								clientMs: hmrApply.clientMs,
								durationMs: hmrApply.duration,
								outcome: hmrApply.outcome,
								serverMs: hmrApply.serverMs
							}
						}
					: {}),
				hmrConnected: true,
				port,
				routes: checks.map(({ route }) => route),
				...(screenshot ? { screenshot } : {}),
				serial,
				status: 'pass'
			}
		});

		return report;
	} catch (error) {
		const durationMs = Math.round(performance.now() - startedAt);
		sendTelemetryEvent('mobile:android-conformance', {
			durationMs,
			platform: 'android',
			provider: 'capacitor',
			routeCount: routes.length,
			success: false,
			waitedForHmr: args.includes('--wait-for-hmr')
		});
		const { diagnosticPath, screenshot } =
			await writeAndroidFailureArtifacts({
				artifactRoot,
				error,
				port,
				serial,
				session
			});
		await writeRequestedAndroidReport({
			adb,
			args,
			projectRoot,
			run: {
				appId: mobile.appId,
				durationMs,
				error: sanitizeNativeReportText(
					error instanceof Error ? error.message : String(error)
				),
				hmrConnected: false,
				port,
				routes,
				...(screenshot ? { screenshot } : {}),
				serial,
				status: 'fail'
			}
		});
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Failure diagnostics: ${diagnosticPath}${screenshot ? `; screenshot: ${screenshot}` : ''}`,
			{ cause: error }
		);
	} finally {
		await session?.close();
	}
};

const requireIosTestContext = (args: string[], projectRoot: string) => {
	const explicit = valueAfter(args, '--port');
	if (explicit !== undefined) {
		const port = Number(explicit);
		if (!Number.isInteger(port) || port < 1 || port > 65_535)
			throw new TypeError('mobile test --port must be a valid TCP port.');
		const instance = listLiveInstances().find(
			(candidate) =>
				resolve(candidate.cwd) === resolve(projectRoot) &&
				candidate.source === 'dev' &&
				candidate.port === port
		);

		return {
			https: instance?.https ?? args.includes('--https'),
			instance,
			port
		};
	}
	const instances = listLiveInstances().filter(
		(instance) =>
			resolve(instance.cwd) === resolve(projectRoot) &&
			instance.source === 'dev' &&
			instance.port !== null
	);
	if (instances.length !== 1)
		throw new TypeError(
			instances.length === 0
				? 'No running AbsoluteJS dev server was found for this project. Start `bun dev`, wait for iOS to report ready, then run `absolute mobile test ios`.'
				: 'Multiple dev servers are running for this project. Select one with mobile test ios --port <port>.'
		);
	const [instance] = instances;
	if (!instance || instance.port === null)
		throw new TypeError('The selected dev server has no resolved port.');

	return { https: instance.https, instance, port: instance.port };
};

const waitForIosHmrClient = async (options: {
	https: boolean;
	port: number;
	timeoutMs: number;
}) => {
	const deadline = Date.now() + options.timeoutMs;
	const statusUrl = `${options.https ? 'https' : 'http'}://localhost:${options.port}/hmr-status`;
	const poll = async (): Promise<void> => {
		if (Date.now() > deadline)
			throw new Error(
				`The iOS app did not establish its native HMR connection within ${options.timeoutMs}ms.`
			);
		const response = await fetch(statusUrl, { cache: 'no-store' }).catch(
			() => undefined
		);
		const status: unknown = response?.ok
			? await response.json().catch(() => null)
			: null;
		const targets =
			isRecord(status) && isRecord(status.connectedTargets)
				? status.connectedTargets
				: undefined;
		if (
			targets &&
			typeof targets['capacitor-ios'] === 'number' &&
			targets['capacitor-ios'] > 0
		)
			return;
		await Bun.sleep(100);
		await poll();
	};

	await poll();
};

const waitForRequestedIosHmr = async (
	args: string[],
	instance: ReturnType<typeof listLiveInstances>[number] | undefined,
	timeoutMs: number
) => {
	if (!args.includes('--wait-for-hmr')) return undefined;
	if (!instance?.logFile)
		throw new TypeError(
			'The selected dev server has no session log. Run `bun dev` normally before requesting --wait-for-hmr.'
		);
	if (!args.includes('--json'))
		console.log(
			'iOS app is ready. Save a source edit now; waiting for a native HMR acknowledgement…'
		);

	return waitForAbsoluteIosHmrLog({
		logPath: instance.logFile,
		timeoutMs
	});
};

const printIosTestReport = (report: IosTestReport, asJson: boolean) => {
	if (asJson) {
		console.log(JSON.stringify(report, null, 2));

		return;
	}
	console.log(
		report.target === 'device'
			? `✓ Physical iOS app ${report.appId} relaunched and reconnected to HMR; no device identifier or screenshot was recorded.`
			: `✓ iOS simulator ${report.targetId}: ${report.appId} launched; screenshot ${report.screenshot}.`
	);
	if (!report.hmrApply) return;
	const timing =
		report.hmrApply.serverMs === undefined
			? ''
			: ` (server ${report.hmrApply.serverMs}ms, client ${report.hmrApply.clientMs}ms)`;
	console.log(
		`✓ Native iOS HMR ${report.hmrApply.outcome} in ${report.hmrApply.duration}ms${timing}.`
	);
};

const requireIosXcrun = async () => {
	const checks = await inspectAbsoluteMobileToolchain();
	const xcrun = checks.find(
		(check) => check.id === 'ios.xcrun' && check.status === 'pass'
	)?.path;
	if (!xcrun)
		throw new TypeError(
			'iOS simulator tools are unavailable. Run this command on macOS after `absolute mobile doctor ios --fix`.'
		);

	return xcrun;
};

const runningIosDevice = (
	instance: ReturnType<typeof listLiveInstances>[number] | undefined
) => {
	if (!instance) return undefined;
	const index = instance.command.indexOf('--ios-device');

	return index === NOT_FOUND ? undefined : instance.command[index + 1];
};

const physicalIosCapture = async (options: {
	args: string[];
	instance: ReturnType<typeof listLiveInstances>[number];
}) => {
	const remoteName = valueAfter(options.args, '--remote');
	if (
		remoteName &&
		options.instance.iosRemoteMac &&
		remoteName !== options.instance.iosRemoteMac
	)
		throw new TypeError(
			'--remote must match the Remote Mac used by the running bun dev session.'
		);
	const selectedRemoteName = remoteName ?? options.instance.iosRemoteMac;
	const remote =
		process.platform === 'darwin' && !selectedRemoteName
			? undefined
			: await getAbsoluteRemoteMacProfile(selectedRemoteName);
	if (process.platform !== 'darwin' && !remote)
		throw new TypeError(
			'Physical iOS acceptance requires macOS or a paired Remote Mac.'
		);
	if (remote) {
		const macos = await captureAbsoluteRemoteMacCommand(remote, [
			'/usr/bin/sw_vers',
			'-productVersion'
		]);
		if (macos.exitCode !== 0)
			throw new Error('Remote Mac version inspection failed.');

		return {
			macosVersion: macos.stdout.trim(),
			remote: true,
			xcodeVersion: remote.xcodeVersion,
			xcrun: '/usr/bin/xcrun',
			capture: (command: string[]) =>
				captureAbsoluteRemoteMacCommand(remote, command)
		};
	}

	return {
		macosVersion: requireCapturedCommand(
			['/usr/bin/sw_vers', '-productVersion'],
			'macOS version inspection'
		).stdout.trim(),
		remote: false,
		xcodeVersion: requireCapturedCommand(
			['/usr/bin/xcodebuild', '-version'],
			'Xcode version inspection'
		).stdout.trim(),
		xcrun: '/usr/bin/xcrun',
		capture: async (command: string[]) => captureCommand(command)
	};
};

const selectIosSimulator = (
	xcrun: string,
	explicitUdid: string | undefined
) => {
	const result = captureCommand([
		xcrun,
		'simctl',
		'list',
		'devices',
		'available',
		'-j'
	]);
	if (result.exitCode !== 0)
		throw new Error(
			`Could not list iOS simulators: ${result.stderr.trim() || result.stdout.trim()}`
		);
	const devices = parseIosSimulators(result.stdout).filter(
		(device) => device.isAvailable
	);
	if (explicitUdid) {
		const explicit = devices.find((device) => device.udid === explicitUdid);
		if (!explicit || explicit.state !== 'Booted')
			throw new TypeError(
				`iOS simulator ${explicitUdid} is not booted and ready.`
			);

		return explicit;
	}
	const selected = devices.find(
		(device) =>
			device.name === ABSOLUTE_IOS_SIMULATOR_NAME &&
			device.state === 'Booted'
	);
	if (!selected)
		throw new TypeError(
			'No ready AbsoluteJS iOS simulator was found. Start `bun dev` and wait for the iOS target to become ready.'
		);

	return selected;
};

const requireCapturedCommand = (command: string[], label: string) => {
	const result = captureCommand(command);
	if (result.exitCode !== 0)
		throw new Error(
			`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `status ${result.exitCode}`}`
		);

	return result;
};

const writeIosFailureArtifacts = async (options: {
	appId: string;
	artifactRoot: string;
	error: unknown;
	port: number;
	udid: string;
	xcrun: string;
}) => {
	await mkdir(options.artifactRoot, { recursive: true });
	const screenshot = join(options.artifactRoot, 'ios-failure.png');
	const screenshotResult = captureCommand([
		options.xcrun,
		'simctl',
		'io',
		options.udid,
		'screenshot',
		screenshot
	]);
	const diagnosticPath = join(options.artifactRoot, 'ios-failure.json');
	await writeFile(
		diagnosticPath,
		`${JSON.stringify(
			{
				appId: options.appId,
				error:
					options.error instanceof Error
						? options.error.message
						: String(options.error),
				platform: 'ios',
				port: options.port,
				screenshot:
					screenshotResult.exitCode === 0 ? screenshot : undefined,
				status: 'fail',
				udid: options.udid
			},
			null,
			2
		)}\n`
	);

	return {
		diagnosticPath,
		screenshot: screenshotResult.exitCode === 0 ? screenshot : undefined
	};
};

const nativeReportRoot = (
	args: string[],
	projectRoot: string,
	platform: 'android' | 'ios'
) => {
	const index = args.indexOf('--report');
	if (index === NOT_FOUND) return undefined;
	const candidate = args[index + 1];
	const explicit = candidate?.startsWith('--') ? undefined : candidate;
	const timestamp = new Date().toISOString().replaceAll(':', '-');

	return safeArtifactRoot(
		projectRoot,
		explicit ?? `.absolutejs/mobile/test-reports/${platform}-${timestamp}`
	);
};

const absolutejsVersionForReport = async () => {
	let absolutejsVersion = process.env.ABSOLUTE_VERSION ?? 'unknown';
	const versions = await Promise.all(
		[
			resolve(import.meta.dir, '..', '..', 'package.json'),
			resolve(import.meta.dir, '..', '..', '..', 'package.json')
		].map((candidate) =>
			readPackageVersionForIosReport(candidate).catch(() => 'unknown')
		)
	);
	for (const version of versions) {
		if (version === 'unknown') continue;
		absolutejsVersion = version;
		break;
	}

	return absolutejsVersion;
};

const writeRequestedAndroidReport = async (options: {
	adb: string;
	args: string[];
	projectRoot: string;
	run: Parameters<typeof createAbsoluteAndroidTestReport>[0]['run'];
}) => {
	const reportRoot = nativeReportRoot(
		options.args,
		options.projectRoot,
		'android'
	);
	if (!reportRoot) return undefined;
	const adbVersion = requireCapturedCommand(
		[options.adb, 'version'],
		'ADB version inspection'
	).stdout.trim();
	const report = createAbsoluteAndroidTestReport({
		absolutejsVersion: await absolutejsVersionForReport(),
		adbVersion,
		bunVersion: Bun.version,
		host: `${process.platform}-${process.arch}`,
		run: options.run
	});
	const paths = await writeAbsoluteNativeTestReport(reportRoot, report);
	const print = options.args.includes('--json') ? console.error : console.log;
	print(`Android test report: ${paths.markdownPath}`);
	print(`Return this report directory: ${paths.directory}`);

	return paths;
};

const iosReportMetadata = async (xcrun: string) => {
	const xcodebuildPath = requireCapturedCommand(
		[xcrun, '--find', 'xcodebuild'],
		'Xcode version inspection'
	).stdout.trim();
	const xcodeVersion = requireCapturedCommand(
		[xcodebuildPath, '-version'],
		'Xcode version inspection'
	).stdout.trim();
	const macosVersion = requireCapturedCommand(
		['/usr/bin/sw_vers', '-productVersion'],
		'macOS version inspection'
	).stdout.trim();

	return {
		absolutejsVersion: await absolutejsVersionForReport(),
		bunVersion: Bun.version,
		macosVersion,
		xcodeVersion
	};
};

const writeRequestedIosReport = async (options: {
	args: string[];
	metadata?: Awaited<ReturnType<typeof iosReportMetadata>>;
	projectRoot: string;
	run: AbsoluteIosAutomatedResult;
	xcrun?: string;
}) => {
	const reportRoot = nativeReportRoot(
		options.args,
		options.projectRoot,
		'ios'
	);
	if (!reportRoot) return undefined;
	const metadata =
		options.metadata ??
		(options.xcrun ? await iosReportMetadata(options.xcrun) : undefined);
	if (!metadata)
		throw new Error('iOS report metadata could not be inspected.');
	const paths = await writeAbsoluteIosPartnerReport(
		reportRoot,
		createAbsoluteIosPartnerReport({ ...metadata, run: options.run })
	);
	const print = options.args.includes('--json') ? console.error : console.log;
	print(`iOS partner report: ${paths.markdownPath}`);
	print(`Return this report directory: ${paths.directory}`);

	return paths;
};

type PhysicalIosTestOptions = {
	args: string[];
	device: string;
	https: boolean;
	instance: NonNullable<ReturnType<typeof listLiveInstances>[number]>;
	mobile: ReturnType<typeof normalizeAbsoluteMobileConfig>;
	port: number;
	projectRoot: string;
	timeoutMs: number;
};

const testPhysicalIos = async (options: PhysicalIosTestOptions) => {
	const {
		args,
		device,
		https,
		instance,
		mobile,
		port,
		projectRoot,
		timeoutMs
	} = options;
	const transport = await physicalIosCapture({ args, instance });
	const reportRoot = nativeReportRoot(args, projectRoot, 'ios');
	const startedAt = performance.now();
	try {
		const acceptance = await testAbsoluteIosPhysicalDevice({
			appId: mobile.appId,
			capture: transport.capture,
			device,
			xcrun: transport.xcrun,
			waitForHmr: () => waitForIosHmrClient({ https, port, timeoutMs })
		});
		const hmrApply = await waitForRequestedIosHmr(
			args,
			instance,
			timeoutMs
		);
		const report: IosTestReport = {
			appId: mobile.appId,
			durationMs: Math.round(performance.now() - startedAt),
			...(hmrApply ? { hmrApply } : {}),
			hmrConnected: true,
			platform: 'ios',
			port,
			provider: 'capacitor',
			status: 'pass',
			target: 'device',
			targetId: 'physical-device'
		};
		sendTelemetryEvent('mobile:ios-device-conformance', {
			durationMs: report.durationMs,
			platform: report.platform,
			provider: report.provider,
			remote: transport.remote,
			success: true,
			waitedForHmr: args.includes('--wait-for-hmr')
		});
		printIosTestReport(report, args.includes('--json'));
		await writeRequestedIosReport({
			args,
			metadata: {
				absolutejsVersion: await absolutejsVersionForReport(),
				bunVersion: Bun.version,
				macosVersion: transport.macosVersion,
				xcodeVersion: transport.xcodeVersion
			},
			projectRoot,
			run: {
				appId: report.appId,
				deviceAcceptance: {
					https: true,
					relaunchMs: acceptance.relaunchMs,
					remote: transport.remote
				},
				durationMs: report.durationMs,
				...(hmrApply
					? {
							hmr: {
								durationMs: hmrApply.duration,
								outcome: hmrApply.outcome,
								...(hmrApply.clientMs === undefined
									? {}
									: { clientMs: hmrApply.clientMs }),
								...(hmrApply.serverMs === undefined
									? {}
									: { serverMs: hmrApply.serverMs })
							}
						}
					: {}),
				hmrConnected: true,
				port,
				status: 'pass',
				targetId: 'physical-device',
				targetKind: 'device'
			}
		});

		return report;
	} catch (error) {
		const durationMs = Math.round(performance.now() - startedAt);
		sendTelemetryEvent('mobile:ios-device-conformance', {
			durationMs,
			platform: 'ios',
			provider: 'capacitor',
			remote: transport.remote,
			success: false,
			waitedForHmr: args.includes('--wait-for-hmr')
		});
		if (reportRoot)
			await writeRequestedIosReport({
				args,
				metadata: {
					absolutejsVersion: await absolutejsVersionForReport(),
					bunVersion: Bun.version,
					macosVersion: transport.macosVersion,
					xcodeVersion: transport.xcodeVersion
				},
				projectRoot,
				run: {
					appId: mobile.appId,
					durationMs,
					error: sanitizeIosReportText(
						error instanceof Error ? error.message : String(error)
					),
					hmrConnected: false,
					port,
					status: 'fail',
					targetId: 'physical-device',
					targetKind: 'device'
				}
			});
		throw error;
	}
};

const testIos = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	requireCapacitorEngine(mobile, 'mobile test ios');
	const { https, instance, port } = requireIosTestContext(args, projectRoot);
	if (!mobile.platforms.includes('ios'))
		throw new TypeError(
			'mobile test ios requires ios in mobile.platforms.'
		);
	if (args.includes('--route'))
		throw new TypeError(
			'iOS simulator route selection is not exposed through simctl; configure mobile.entry for the native route matrix.'
		);
	const timeoutMs = androidTestTimeout(args);
	const requestedDevice = valueAfter(args, '--device');
	if (args.includes('--device') && !requestedDevice)
		throw new TypeError(
			'mobile test ios --device requires a device identifier or name.'
		);
	if (
		requestedDevice &&
		(valueAfter(args, '--udid') || valueAfter(args, '--serial'))
	)
		throw new TypeError(
			'mobile test ios --device cannot be combined with a simulator selector.'
		);
	if (!requestedDevice && args.includes('--remote'))
		throw new TypeError(
			'mobile test ios --remote is available only with --device.'
		);
	if (requestedDevice) {
		const device = normalizeAbsoluteIosDeviceIdentifier(requestedDevice);
		const activeDevice = runningIosDevice(instance);
		if (!activeDevice)
			throw new TypeError(
				'The selected dev server is not running a physical iOS session. Start bun dev with --ios-device first.'
			);
		if (activeDevice !== device)
			throw new TypeError(
				'--device must match the --ios-device value used by the running bun dev session.'
			);
		if (!https)
			throw new TypeError(
				'Physical iOS acceptance requires dev.https: true so the report can prove the native trust path.'
			);
		if (!instance)
			throw new TypeError(
				'Physical iOS acceptance requires a registered bun dev session.'
			);

		return testPhysicalIos({
			args,
			device,
			https,
			instance,
			mobile,
			port,
			projectRoot,
			timeoutMs
		});
	}
	const xcrun = await requireIosXcrun();
	const simulator = selectIosSimulator(
		xcrun,
		valueAfter(args, '--udid') ?? valueAfter(args, '--serial')
	);
	const reportRoot = nativeReportRoot(args, projectRoot, 'ios');
	const artifactRoot =
		reportRoot ??
		safeArtifactRoot(projectRoot, valueAfter(args, '--artifacts'));
	const startedAt = performance.now();
	try {
		requireCapturedCommand(
			[
				xcrun,
				'simctl',
				'get_app_container',
				simulator.udid,
				mobile.appId,
				'app'
			],
			'iOS installed-app inspection'
		);
		requireCapturedCommand(
			[
				xcrun,
				'simctl',
				'launch',
				'--terminate-running-process',
				simulator.udid,
				mobile.appId
			],
			'iOS app launch'
		);
		await waitForIosHmrClient({ https, port, timeoutMs });
		await mkdir(artifactRoot, { recursive: true });
		const screenshot = join(artifactRoot, 'ios-simulator.png');
		requireCapturedCommand(
			[xcrun, 'simctl', 'io', simulator.udid, 'screenshot', screenshot],
			'iOS simulator screenshot'
		);
		const hmrApply = await waitForRequestedIosHmr(
			args,
			instance,
			timeoutMs
		);
		const report: IosTestReport = {
			appId: mobile.appId,
			durationMs: Math.round(performance.now() - startedAt),
			...(hmrApply ? { hmrApply } : {}),
			hmrConnected: true,
			platform: 'ios',
			port,
			provider: 'capacitor',
			screenshot,
			status: 'pass',
			target: 'simulator',
			targetId: simulator.udid
		};
		sendTelemetryEvent('mobile:ios-conformance', {
			durationMs: report.durationMs,
			platform: report.platform,
			provider: report.provider,
			success: true,
			waitedForHmr: args.includes('--wait-for-hmr')
		});
		printIosTestReport(report, args.includes('--json'));
		await writeRequestedIosReport({
			args,
			projectRoot,
			run: {
				appId: report.appId,
				durationMs: report.durationMs,
				...(report.hmrApply
					? {
							hmr: {
								...(report.hmrApply.clientMs === undefined
									? {}
									: { clientMs: report.hmrApply.clientMs }),
								durationMs: report.hmrApply.duration,
								outcome: report.hmrApply.outcome,
								...(report.hmrApply.serverMs === undefined
									? {}
									: { serverMs: report.hmrApply.serverMs })
							}
						}
					: {}),
				hmrConnected: report.hmrConnected,
				port: report.port,
				screenshot: report.screenshot,
				status: report.status,
				targetId: report.targetId,
				targetKind: report.target
			},
			xcrun
		});

		return report;
	} catch (error) {
		const durationMs = Math.round(performance.now() - startedAt);
		sendTelemetryEvent('mobile:ios-conformance', {
			durationMs,
			platform: 'ios',
			provider: 'capacitor',
			success: false,
			waitedForHmr: args.includes('--wait-for-hmr')
		});
		const { diagnosticPath, screenshot } = await writeIosFailureArtifacts({
			appId: mobile.appId,
			artifactRoot,
			error,
			port,
			udid: simulator.udid,
			xcrun
		});
		await writeRequestedIosReport({
			args,
			projectRoot,
			run: {
				appId: mobile.appId,
				durationMs,
				error: sanitizeIosReportText(
					error instanceof Error ? error.message : String(error)
				),
				hmrConnected: false,
				port,
				...(screenshot ? { screenshot } : {}),
				status: 'fail',
				targetId: simulator.udid,
				targetKind: 'simulator'
			},
			xcrun
		});
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Failure diagnostics: ${diagnosticPath}${screenshot ? `; screenshot: ${screenshot}` : ''}`,
			{ cause: error }
		);
	}
};

export const runMobile = async (args: string[]) => {
	const [command] = args;
	if (command === 'pair') {
		await pairRemoteMac(args.slice(1));

		return;
	}
	if (command === 'remotes') {
		await listRemoteMacs(args.slice(1));

		return;
	}
	if (command === 'unpair') {
		await unpairRemoteMac(args.slice(1));

		return;
	}
	if (command === 'init') {
		await initialize(args.slice(1));

		return;
	}
	if (command === 'sync') {
		await sync(args.slice(1));

		return;
	}
	if (command === 'associations') {
		await associations(args.slice(1));

		return;
	}
	if (command === 'ci') {
		await generateGithubCi(args.slice(1));

		return;
	}
	if (command === 'doctor') {
		await doctor(args.slice(1));

		return;
	}
	if (command === 'inspect') {
		await inspectMobile(args.slice(1));

		return;
	}
	if (command === 'test' && args[1] === 'android') {
		await testAndroid(args.slice(2));

		return;
	}
	if (command === 'test' && args[1] === 'ios') {
		await testIos(args.slice(2));

		return;
	}
	if (command === 'build' && args[1] === 'android') {
		await buildAndroid(args.slice(2));

		return;
	}
	if (command === 'build' && args[1] === 'ios') {
		await buildIos(args.slice(2));

		return;
	}
	if (command === 'publish' && args[1] === 'android') {
		await publishAndroid(args.slice(2));

		return;
	}
	if (command === 'publish' && args[1] === 'ios') {
		await publishIos(args.slice(2));

		return;
	}

	throw new TypeError(
		'Usage: absolute mobile <pair mac <name> <user@host> [--port n] [--workspace path] | remotes [--json] | unpair mac <name> | init [--no-native] [--force] | sync [ios|android] | inspect [--json] [--require-bundle] | associations [--outdir dir] [--verify] | ci github [server-entry] [--publish] [--registry module] [--secret-env NAME] [--output path] [--force] [--json] | doctor [ios|android|release [ios|android]] [--remote name] [--json|--fix [--yes]] | build <android|ios> [server-entry] [--outdir dir] [--web-outdir dir] [--unsigned] | publish android [server-entry] [--registry module] [--channel name] [--play-track track] [--play-status completed|draft|halted|in-progress] [--play-rollout fraction] [--play-name name] [--play-notes language=text] [--play-update-priority 0..5] [--play-hold-review] [--play-cancel-existing-review] [--outdir dir] [--web-outdir dir] [--unsigned] | publish ios [server-entry] [--registry module] [--channel name] [--testflight-group name-or-id] [--testflight-notes locale=text] [--testflight-submit-review] [--outdir dir] [--web-outdir dir] [--unsigned] | test android [--route path] [--wait-for-hmr] [--report [dir]] [--timeout ms] [--port n] [--serial id] [--artifacts dir] [--json] | test ios [--device identifier [--remote name] | --udid id] [--wait-for-hmr] [--report [dir]] [--timeout ms] [--port n] [--artifacts dir] [--json]> [--config path]'
	);
};
