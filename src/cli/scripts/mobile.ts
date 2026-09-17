import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile
} from 'node:fs/promises';
import { createPublicKey, randomUUID } from 'node:crypto';
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
import { applyAbsoluteNativeUpdates } from '../../mobile/nativeUpdates';
import { applyAbsoluteNativeObservability } from '../../mobile/nativeObservability';
import { applyAbsoluteNativeReleaseReadiness } from '../../mobile/nativeReleaseReadiness';
import {
	ABSOLUTE_ANDROID_AVD_NAME,
	detectAbsoluteMobileHost,
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
import {
	ABSOLUTE_BUNDLETOOL_VERSION,
	ensureAbsoluteBundletool,
	inspectAbsoluteBundletool,
	readAbsoluteAndroidRelease,
	runAbsoluteAndroidReleaseAcceptance
} from '../../mobile/androidReleaseAcceptance';
import { buildAbsoluteIosRelease } from '../../mobile/iosRelease';
import {
	readAbsoluteIosRelease,
	runAbsoluteIosDeviceReleaseAcceptance,
	runAbsoluteIosSimulatorReleaseAcceptance,
	type AbsoluteIosReleaseAcceptanceResult
} from '../../mobile/iosReleaseAcceptance';
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
	createAbsoluteMobileReleaseCertification,
	readAbsoluteMobileReleaseCertification,
	resolveAbsoluteMobileCertificationRequirement,
	verifyAbsoluteMobileReleaseCertification,
	writeAbsoluteMobileReleaseCertification,
	serializeAbsoluteMobileReleaseCertification,
	type AbsoluteMobileCertifiableRelease,
	type AbsoluteMobileCertificationRequirement
} from '../../mobile/releaseCertification';
import {
	createAbsoluteMobileCertificationVerification,
	readAbsoluteMobileCertificationVerification,
	readAbsoluteSigstoreBundle,
	writeAbsoluteMobileCertificationVerification
} from '../../mobile/certificationVerification';
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
import { formatBytes } from '../../utils/formatBytes';
import {
	listAbsoluteRemoteMacProfiles,
	buildAbsoluteRemoteIosRelease,
	createAbsoluteRemoteIosDevProject,
	getAbsoluteRemoteMacProfile,
	inspectAbsoluteRemoteMac,
	inspectAbsoluteRemoteMacWorkspace,
	cleanAbsoluteRemoteMacWorkspace,
	captureAbsoluteRemoteMacCommand,
	pairAbsoluteRemoteMac,
	removeAbsoluteRemoteMacProfile,
	runAbsoluteRemoteIosReleaseAcceptance,
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
import {
	auditAbsoluteMobileCiPromotion,
	discoverAbsoluteMobilePromotionRun,
	inspectAbsoluteMobileCiRun,
	watchAbsoluteMobileCiRun,
	type AbsoluteMobileCiRunStatus
} from '../../mobile/ciPromotionAudit';
import {
	buildAbsoluteMobileUpdate,
	verifyAbsoluteMobileUpdateSignature
} from '../../mobile/updateSigning';
import { finalizeAbsoluteExpoUpdateExport } from '../../mobile/expoUpdate';
import { generateAbsoluteExpoCodeSigning } from '../../mobile/expoCodeSigning';
import { resolveAbsoluteMobileUpdateRuntime } from '../../mobile/updateRuntime';
import {
	advanceAbsoluteMobileUpdateRollout,
	cancelAbsoluteMobileUpdateRollout,
	inspectAbsoluteMobileUpdateHealth,
	inspectAbsoluteMobileUpdateRollout,
	inspectAbsoluteMobileUpdateStorage,
	loadAbsoluteMobileUpdatePublisher,
	pauseAbsoluteMobileUpdateRollout,
	promoteAbsoluteMobileUpdate,
	pruneAbsoluteMobileUpdates,
	publishAbsoluteMobileUpdate,
	reconcileAbsoluteMobileUpdateRollout,
	resumeAbsoluteMobileUpdateRollout,
	rollbackAbsoluteMobileUpdate
} from '../../mobile/updatePublisher';
import { writeAbsoluteMobileUpdateRegistry } from '../../mobile/updateServer';

const NOT_FOUND = -1;
const ANDROID_EMULATOR_BOOT_POLL_MS = 500;
const ANDROID_EMULATOR_BOOT_TIMEOUT_MS = 180_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const expoPublicConfig = (config: Record<string, unknown>) => {
	const result: Record<string, unknown> = { ...config };
	if (!isRecord(result.updates)) return result;
	const {
		codeSigningCertificate: _codeSigningCertificate,
		codeSigningMetadata: _codeSigningMetadata,
		...publicUpdates
	} = result.updates;
	result.updates = publicUpdates;

	return result;
};

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

const ensureCapacitorPackages = async (
	projectRoot: string,
	args: string[],
	mobile?: NormalizedAbsoluteMobileConfig
) => {
	const specs = [
		...CAPACITOR_PACKAGE_SPECS,
		...(mobile?.updates ? ['@capacitor/filesystem@8.1.3'] : []),
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

const runCapacitor = async (projectRoot: string, args: string[]) => {
	const process = Bun.spawn(['bun', 'x', '--no-install', 'cap', ...args], {
		cwd: projectRoot,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new TypeError(
			`Capacitor exited with status ${exitCode}. Ensure this app directly depends on: ${CAPACITOR_PACKAGES.join(' ')}`
		);
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
	if (args[0] === 'inspect') {
		const requested = args[1]?.startsWith('-') ? undefined : args[1];
		const profile = await getAbsoluteRemoteMacProfile(
			requested,
			remoteProfilePath()
		);
		if (!profile)
			throw new TypeError(
				'No Remote Mac is selected. Pair one before inspecting its workspace.'
			);
		const inspection = await inspectAbsoluteRemoteMacWorkspace(profile);
		console.log(
			args.includes('--json')
				? JSON.stringify(inspection, null, 2)
				: [
						`Remote Mac: ${inspection.profile}`,
						`Workspace: ${inspection.workspaceRoot}`,
						`Cache: ${(inspection.bytes / 1_048_576).toFixed(1)} MiB across ${inspection.projectCount} project(s) and ${inspection.agentCount} agent artifact(s)`,
						`Active release leases: ${inspection.leaseCount}`
					].join('\n')
		);

		return;
	}
	if (args[0] === 'clean') {
		if (!args.includes('--yes'))
			throw new TypeError(
				'Remote Mac cleanup requires --yes. It removes only abandoned staging directories older than one day.'
			);
		const requested = args[1]?.startsWith('-') ? undefined : args[1];
		const profile = await getAbsoluteRemoteMacProfile(
			requested,
			remoteProfilePath()
		);
		if (!profile)
			throw new TypeError(
				'No Remote Mac is selected. Pair one before cleaning its workspace.'
			);
		const result = await cleanAbsoluteRemoteMacWorkspace(profile);
		console.log(
			`Removed ${result.removed} abandoned Remote Mac staging director${result.removed === 1 ? 'y' : 'ies'}; project caches, releases, and active leases were retained.`
		);

		return;
	}
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
			'Experimental: Expo Android and iOS release automation is available; real macOS and physical-device acceptance remains pending.'
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
	await ensureCapacitorPackages(projectRoot, args, mobile);
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
	await applyAbsoluteNativeUpdates(mobile);
	await applyAbsoluteNativeObservability(mobile);
	await applyAbsoluteNativeReleaseReadiness(mobile);
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
	await ensureCapacitorPackages(projectRoot, args, mobile);
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
	await applyAbsoluteNativeUpdates(mobile, platforms);
	await applyAbsoluteNativeObservability(mobile, platforms);
	await applyAbsoluteNativeReleaseReadiness(mobile, platforms);
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
	if (result.publishing)
		console.log(
			'After later installed-app certification, run `absolute mobile ci promote <platform> --run-id <source-run> --certification <path> ...` to publish the exact retained artifact without rebuilding.'
		);

	return publicResult;
};

const createGithubCertificationVerification = async (args: string[]) => {
	const bundlePath = valueAfter(args, '--bundle');
	const outputPath = valueAfter(args, '--out');
	if (
		!bundlePath ||
		bundlePath.startsWith('-') ||
		!outputPath ||
		outputPath.startsWith('-')
	)
		throw new TypeError(
			'Usage: absolute mobile ci verification --bundle bundle.json --out verification.json'
		);
	const projectRoot = process.cwd();
	const bundle = await readAbsoluteSigstoreBundle(projectRoot, bundlePath);
	const verification = createAbsoluteMobileCertificationVerification(bundle, {
		GITHUB_REF: process.env.GITHUB_REF,
		GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
		GITHUB_SHA: process.env.GITHUB_SHA,
		GITHUB_WORKFLOW_REF: process.env.GITHUB_WORKFLOW_REF
	});
	const path = await writeAbsoluteMobileCertificationVerification(
		projectRoot,
		outputPath,
		verification
	);
	console.log(relative(projectRoot, path).replaceAll('\\', '/'));

	return verification;
};

type GithubMobilePromotionDispatchResult = {
	auditDirectory: string | null;
	dispatchId: string;
	platform: 'android' | 'ios';
	releaseId: string;
	runId: string;
	sourceRunId: string;
	status: string;
	url: string;
};

type AuditDispatchedGithubMobilePromotionOptions = {
	args: string[];
	platform: 'android' | 'ios';
	projectRoot: string;
	repository?: string;
	runId: string;
};

const auditDispatchedGithubMobilePromotion = async (
	options: AuditDispatchedGithubMobilePromotionOptions
) => {
	const startedAt = performance.now();
	try {
		const audited = await auditAbsoluteMobileCiPromotion({
			outputDirectory: valueAfter(options.args, '--outdir'),
			projectRoot: options.projectRoot,
			...(options.repository ? { repository: options.repository } : {}),
			runId: options.runId
		});
		sendTelemetryEvent('mobile:ci-promotion-audit', {
			durationMs: Math.round(performance.now() - startedAt),
			platform: options.platform,
			provider: 'github-actions',
			success: true
		});

		return audited;
	} catch (error) {
		sendTelemetryEvent('mobile:ci-promotion-audit', {
			durationMs: Math.round(performance.now() - startedAt),
			platform: options.platform,
			provider: 'github-actions',
			success: false
		});
		throw error;
	}
};

const dispatchGithubMobilePromotion = async (args: string[]) => {
	const [platform] = args;
	if (platform !== 'android' && platform !== 'ios')
		throw new TypeError(
			'Usage: absolute mobile ci promote <android|ios> --run-id id --certification directory-or-json [--channel name] [store options] [--watch] [--audit]'
		);
	const sourceRunId = valueAfter(args, '--run-id');
	if (!sourceRunId || !/^[1-9][0-9]*$/u.test(sourceRunId))
		throw new TypeError('mobile ci promote requires a numeric --run-id.');
	const requestedCertification = valueAfter(args, '--certification');
	if (!requestedCertification || requestedCertification.startsWith('-'))
		throw new TypeError(
			'mobile ci promote requires --certification <directory-or-json>.'
		);
	const configPath = valueAfter(args, '--config');
	const { mobile, projectRoot } = await loadMobile(configPath);
	const { certification } = await readAbsoluteMobileReleaseCertification(
		projectRoot,
		requestedCertification
	);
	if (
		certification.release.platform !== platform ||
		certification.release.appId !== mobile.appId ||
		certification.release.engine !== mobile.engine
	)
		throw new TypeError(
			'The certification does not match this application platform, app ID, or engine.'
		);
	const channel = valueAfter(args, '--channel') ?? '';
	const playTrack = valueAfter(args, '--play-track') ?? 'registry-only';
	const testflightGroup = valueAfter(args, '--testflight-group') ?? '';
	if (
		channel === '' &&
		(platform === 'android'
			? playTrack === 'registry-only'
			: testflightGroup === '')
	)
		throw new TypeError(
			'mobile ci promote requires --channel or a platform store target.'
		);
	const certificationBase64 = Buffer.from(
		serializeAbsoluteMobileReleaseCertification(certification)
	).toString('base64');
	if (certificationBase64.length > 48_000)
		throw new TypeError(
			'Mobile certification is too large for protected GitHub dispatch.'
		);
	const workflow =
		valueAfter(args, '--workflow') ??
		'.github/workflows/absolute-mobile.yml';
	const dispatchId = `amp_${randomUUID().replaceAll('-', '')}`;
	const repository = valueAfter(args, '--repo');
	const command = [
		'workflow',
		'run',
		workflow,
		'-f',
		'operation=promote',
		'-f',
		`platform=${platform}`,
		'-f',
		`source_run_id=${sourceRunId}`,
		'-f',
		`dispatch_id=${dispatchId}`,
		'-f',
		`certification_base64=${certificationBase64}`,
		'-f',
		`channel=${channel}`
	];
	if (platform === 'android') command.push('-f', `play_track=${playTrack}`);
	else {
		command.push('-f', `testflight_group=${testflightGroup}`);
		command.push(
			'-f',
			`submit_testflight_review=${args.includes('--testflight-submit-review')}`
		);
	}
	const ref = valueAfter(args, '--ref');
	if (ref) command.push('--ref', ref);
	if (repository) command.push('--repo', repository);
	const child = Bun.spawn(['gh', ...command], {
		cwd: projectRoot,
		stderr: 'pipe',
		stdin: 'inherit',
		stdout: 'pipe'
	});
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
		new Response(child.stdout).text()
	]);
	if (exitCode !== 0)
		throw new TypeError(
			`GitHub promotion dispatch exited with status ${exitCode}: ${stderr.trim() || 'unknown GitHub CLI error'}`
		);
	const promotion = await discoverAbsoluteMobilePromotionRun({
		dispatchId,
		projectRoot,
		...(repository ? { repository } : {}),
		workflow
	});
	sendTelemetryEvent('mobile:ci-promotion-dispatched', {
		discovery: 'correlated',
		platform,
		provider: 'github-actions',
		storeTarget:
			platform === 'android'
				? playTrack !== 'registry-only'
				: testflightGroup !== ''
	});
	if (!args.includes('--json')) {
		console.log(
			`Dispatched protected ${platform} promotion ${promotion.runId} for ${certification.release.releaseId} from workflow run ${sourceRunId}.`
		);
		console.log(promotion.url);
	}
	const shouldWatch = args.includes('--watch') || args.includes('--audit');
	if (shouldWatch && !args.includes('--json'))
		console.log(`Watching GitHub run ${promotion.runId} until completion…`);
	const status = shouldWatch
		? await watchAbsoluteMobileCiRun({
				projectRoot,
				...(repository ? { repository } : {}),
				runId: promotion.runId
			})
		: null;
	const audited = args.includes('--audit')
		? await auditDispatchedGithubMobilePromotion({
				args,
				platform,
				projectRoot,
				...(repository ? { repository } : {}),
				runId: promotion.runId
			})
		: null;
	const result: GithubMobilePromotionDispatchResult = {
		auditDirectory: audited
			? relative(projectRoot, audited.directory).replaceAll('\\', '/')
			: null,
		dispatchId,
		platform,
		releaseId: certification.release.releaseId,
		runId: promotion.runId,
		sourceRunId,
		status: status?.status ?? 'dispatched',
		url: promotion.url
	};
	if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
	if (args.includes('--json')) return result;
	if (status) renderGithubMobileRunStatus(status);
	if (audited) renderGithubMobilePromotionAudit(audited, projectRoot);

	return result;
};

const githubMobileRunId = (args: string[]) => {
	const value = valueAfter(args, '--run-id');
	if (!value || !/^[1-9][0-9]*$/u.test(value))
		throw new TypeError('mobile ci command requires a numeric --run-id.');

	return value;
};

const renderGithubMobileRunStatus = (status: AbsoluteMobileCiRunStatus) => {
	console.log(
		`GitHub run ${status.runId}: ${status.status}${status.conclusion ? ` / ${status.conclusion}` : ''}`
	);
	console.log(`Workflow: ${status.workflowName}`);
	console.log(`Commit: ${status.headSha} (${status.headBranch})`);
	status.jobs.forEach((job) =>
		console.log(
			`  ${job.name}: ${job.status}${job.conclusion ? ` / ${job.conclusion}` : ''}`
		)
	);
	console.log(status.url);
};

const inspectGithubMobileRun = async (args: string[]) => {
	const projectRoot = process.cwd();
	const requestedRunId = githubMobileRunId(args);
	const repository = valueAfter(args, '--repo');
	if (args.includes('--watch') && !args.includes('--json'))
		console.log(`Watching GitHub run ${requestedRunId} until completion…`);
	const status = args.includes('--watch')
		? await watchAbsoluteMobileCiRun({
				projectRoot,
				...(repository ? { repository } : {}),
				runId: requestedRunId
			})
		: await inspectAbsoluteMobileCiRun({
				projectRoot,
				...(repository ? { repository } : {}),
				runId: requestedRunId
			});
	sendTelemetryEvent('mobile:ci-status', {
		conclusion: status.conclusion ?? 'pending',
		provider: 'github-actions',
		status: status.status,
		watched: args.includes('--watch')
	});
	if (args.includes('--json')) console.log(JSON.stringify(status, null, 2));
	else renderGithubMobileRunStatus(status);

	return status;
};

const renderGithubMobilePromotionAudit = (
	result: Awaited<ReturnType<typeof auditAbsoluteMobileCiPromotion>>,
	projectRoot: string
) => {
	console.log(
		`✓ Verified ${result.audit.platform} promotion ${result.audit.github.promotionRunId} for ${result.audit.release.releaseId}.`
	);
	console.log(`Audit: ${relative(projectRoot, result.directory)}`);
};

const auditGithubMobilePromotion = async (args: string[]) => {
	const projectRoot = process.cwd();
	const requestedRunId = githubMobileRunId(args);
	const repository = valueAfter(args, '--repo');
	const sourceRunId = valueAfter(args, '--source-run-id');
	const startedAt = performance.now();
	try {
		const result = await auditAbsoluteMobileCiPromotion({
			outputDirectory: valueAfter(args, '--outdir'),
			projectRoot,
			...(repository ? { repository } : {}),
			runId: requestedRunId,
			...(sourceRunId ? { sourceRunId } : {})
		});
		sendTelemetryEvent('mobile:ci-promotion-audit', {
			durationMs: Math.round(performance.now() - startedAt),
			platform: result.audit.platform,
			provider: 'github-actions',
			success: true
		});
		if (args.includes('--json'))
			console.log(JSON.stringify(result.audit, null, 2));
		else renderGithubMobilePromotionAudit(result, projectRoot);

		return result;
	} catch (error) {
		sendTelemetryEvent('mobile:ci-promotion-audit', {
			durationMs: Math.round(performance.now() - startedAt),
			provider: 'github-actions',
			success: false
		});
		throw error;
	}
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
		'--classification',
		'--config',
		'--outdir',
		'--play-name',
		'--play-notes',
		'--play-rollout',
		'--play-status',
		'--play-track',
		'--play-update-priority',
		'--registry',
		'--key-id',
		'--signing-key',
		'--remote',
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

const requireUpdateClassification = (value?: string) => {
	if (value === 'bug-fix' || value === 'content' || value === 'security')
		return value;
	throw new TypeError(
		'mobile update build requires --classification bug-fix|content|security.'
	);
};

const prepareExpoMobileUpdateExport = async (options: {
	args: string[];
	mobile: NormalizedAbsoluteMobileConfig;
	projectRoot: string;
	runtimeFingerprint: string;
}) => {
	const { mobile } = options;
	if (mobile.engine !== 'expo')
		return {
			bundleDirectory: mobile.bundleDirectory,
			temporaryDirectory: undefined
		};
	await ensureExpoPackages(mobile.nativeProjectDirectory, options.args);
	const temporaryParent = join(
		options.projectRoot,
		'.absolutejs',
		'mobile',
		'expo-update-exports'
	);
	await mkdir(temporaryParent, { recursive: true });
	const temporaryDirectory = await mkdtemp(join(temporaryParent, '.stage-'));
	try {
		await runExpo(
			mobile.nativeProjectDirectory,
			[
				'export',
				'--platform',
				'ios',
				'--platform',
				'android',
				'--output-dir',
				temporaryDirectory,
				'--clear'
			],
			{ production: true }
		);
		const generatedApp: unknown = JSON.parse(
			await readFile(
				join(mobile.nativeProjectDirectory, 'app.json'),
				'utf8'
			)
		);
		const expoConfig = isRecord(generatedApp)
			? generatedApp.expo
			: undefined;
		if (!isRecord(expoConfig))
			throw new TypeError('Generated Expo app configuration is invalid.');
		const publicExpoConfig = expoPublicConfig(expoConfig);
		const computedRuntime = resolveAbsoluteMobileUpdateRuntime(
			mobile,
			options.projectRoot
		).fingerprint;
		if (computedRuntime !== options.runtimeFingerprint)
			throw new TypeError(
				'Expo native runtime changed while exporting the update.'
			);
		await finalizeAbsoluteExpoUpdateExport({
			expoConfig: publicExpoConfig,
			exportDirectory: temporaryDirectory,
			runtimeVersion: options.runtimeFingerprint
		});

		return {
			bundleDirectory: temporaryDirectory,
			temporaryDirectory
		};
	} catch (error) {
		await rm(temporaryDirectory, { force: true, recursive: true });
		throw error;
	}
};

const buildMobileUpdate = async (args: string[]) => {
	const configPath = valueAfter(args, '--config');
	const { mobile, projectRoot } = await loadMobile(configPath);
	if (!mobile.updates)
		throw new TypeError(
			'mobile update build requires mobile.updates.publicKeys in absolute.config.ts.'
		);
	if (mobile.engine === 'expo' && !mobile.updates.expoCodeSigning)
		throw new TypeError(
			'Expo production updates require mobile.updates.expoCodeSigning. Run `absolute mobile update signing generate --private-key <path outside the project>` first.'
		);
	if (!args.includes('--within-submitted-purpose'))
		throw new TypeError(
			'mobile update build requires --within-submitted-purpose to attest that the update does not change the submitted app purpose.'
		);
	const classification = requireUpdateClassification(
		valueAfter(args, '--classification')
	);
	const keyId = valueAfter(args, '--key-id');
	if (!keyId || !mobile.updates.publicKeys[keyId])
		throw new TypeError(
			'mobile update build requires --key-id matching mobile.updates.publicKeys.'
		);
	const signingKeyPath = valueAfter(args, '--signing-key');
	if (!signingKeyPath)
		throw new TypeError(
			'mobile update build requires --signing-key <private-key.pem>.'
		);

	const startedAt = performance.now();
	let success = false;
	let expoExportDirectory: string | undefined;
	try {
		await start(
			mobileBuildServerEntry(args),
			valueAfter(args, '--web-outdir'),
			configPath,
			{ prepareOnly: true }
		);
		const embedded: unknown = JSON.parse(
			await readFile(
				join(mobile.bundleDirectory, 'absolute-mobile-manifest.json'),
				'utf8'
			)
		);
		const runtimeFingerprint = isRecord(embedded)
			? embedded.nativeRuntime
			: undefined;
		if (
			typeof runtimeFingerprint !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(runtimeFingerprint)
		)
			throw new TypeError(
				'Prepared mobile bundle is missing its native runtime fingerprint.'
			);
		const privateKey = await readFile(resolve(projectRoot, signingKeyPath));
		const configuredPublicKey = Buffer.from(
			mobile.updates.publicKeys[keyId],
			'base64'
		);
		const derivedPublicKey = createPublicKey(privateKey).export({
			format: 'der',
			type: 'spki'
		});
		if (!configuredPublicKey.equals(derivedPublicKey))
			throw new TypeError(
				`The private key does not match mobile.updates.publicKeys.${keyId}.`
			);
		const expoExport = await prepareExpoMobileUpdateExport({
			args,
			mobile,
			projectRoot,
			runtimeFingerprint
		});
		expoExportDirectory = expoExport.temporaryDirectory;
		const result = await buildAbsoluteMobileUpdate({
			appId: mobile.appId,
			bundleDirectory: expoExport.bundleDirectory,
			channel: mobile.updates.channel,
			classification,
			keyId,
			outputDirectory:
				valueAfter(args, '--outdir') ??
				join(projectRoot, '.absolutejs', 'mobile', 'updates'),
			privateKey,
			runtimeFingerprint
		});
		verifyAbsoluteMobileUpdateSignature(result.manifest, derivedPublicKey);
		success = true;
		console.log(`Built signed mobile update ${result.manifest.releaseId}.`);
		console.log(`Release: ${result.outputDirectory}`);
		console.log(`Manifest: ${result.manifestPath}`);

		return result;
	} finally {
		if (expoExportDirectory)
			await rm(expoExportDirectory, { force: true, recursive: true });
		sendTelemetryEvent('mobile:update-build', {
			classification: classification ?? 'invalid',
			durationMs: Math.round(performance.now() - startedAt),
			engine: mobile.engine,
			success
		});
	}
};

const generateExpoUpdateSigning = async (args: string[]) => {
	const configPath = valueAfter(args, '--config');
	const { mobile, projectRoot } = await loadMobile(configPath);
	if (mobile.engine !== 'expo')
		throw new TypeError('Expo code signing requires mobile.engine: expo.');
	const privateKeyPath = valueAfter(args, '--private-key');
	if (!privateKeyPath)
		throw new TypeError(
			'mobile update signing generate requires --private-key <path outside the project>.'
		);
	const validityValue = valueAfter(args, '--validity-years');
	const validityYears =
		validityValue === undefined ? undefined : Number(validityValue);
	const keyId = valueAfter(args, '--key-id') ?? 'main';
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId))
		throw new TypeError(
			'mobile update signing generate --key-id contains unsupported characters.'
		);
	const result = await generateAbsoluteExpoCodeSigning({
		certificatePath:
			valueAfter(args, '--certificate') ??
			'mobile/code-signing/expo-update-certificate.pem',
		commonName:
			valueAfter(args, '--common-name') ?? `${mobile.appName} Updates`,
		privateKeyPath,
		projectRoot,
		...(valueAfter(args, '--public-key')
			? { publicKeyPath: valueAfter(args, '--public-key') }
			: {}),
		...(validityYears === undefined ? {} : { validityYears })
	});
	const certificatePath = relative(
		projectRoot,
		result.certificatePath
	).replaceAll('\\', '/');
	sendTelemetryEvent('mobile:update-code-signing-generated', {
		engine: 'expo',
		validityYears: validityYears ?? 10
	});
	console.log(`Generated Expo update certificate ${certificatePath}.`);
	console.log(
		`Keep the private key outside source control and provision it only to the trusted update server: ${result.privateKeyPath}`
	);
	console.log(
		`Add expoCodeSigning: { certificatePath: '${certificatePath}', keyId: '${keyId}' } to mobile.updates, then run absolute mobile sync.`
	);

	return result;
};

const updateRollout = (args: string[], fallback?: number) => {
	const value = valueAfter(args, '--rollout');
	if (value === undefined) {
		if (fallback !== undefined) return fallback;
		throw new TypeError('This command requires --rollout <fraction>.');
	}
	const rollout = Number(value);
	if (!Number.isFinite(rollout) || rollout <= 0 || rollout > 1)
		throw new TypeError('--rollout must be greater than 0 and at most 1.');

	return rollout;
};

const mobileUpdatePublisher = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	if (!mobile.updates || !mobile.updateServer)
		throw new TypeError('Mobile updates are not configured.');
	const modulePath =
		valueAfter(args, '--registry') ?? mobile.updateServer.registryModule;

	return {
		mobile,
		projectRoot,
		publisher: await loadAbsoluteMobileUpdatePublisher(
			projectRoot,
			modulePath
		)
	};
};

const provisionMobileUpdate = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	if (!mobile.updates || !mobile.updateServer)
		throw new TypeError(
			'mobile update provision requires mobile.updates.publicKeys in absolute.config.ts.'
		);
	const requestedStorage = valueAfter(args, '--storage') ?? 'local';
	if (requestedStorage !== 'local' && requestedStorage !== 's3')
		throw new TypeError('--storage must be local or s3.');
	const modulePath =
		valueAfter(args, '--registry') ?? mobile.updateServer.registryModule;
	const packages = [
		'@absolutejs/deploy@0.26.0',
		'@absolutejs/blob@0.5.2',
		...(requestedStorage === 's3'
			? [
					'@aws-sdk/client-s3@3.1095.0',
					'@aws-sdk/lib-storage@3.1095.0',
					'@aws-sdk/s3-request-presigner@3.1095.0'
				]
			: [])
	];
	const installed = await directProjectPackages(projectRoot);
	const missing = packages.filter(
		(spec) => !installed.has(packageNameFromSpec(spec))
	);
	await installApprovedPackages(
		projectRoot,
		args,
		`Mobile update serving needs ${missing.map(packageNameFromSpec).join(', ')}. Install them now?`,
		missing
	);
	const path = await writeAbsoluteMobileUpdateRegistry({
		force: args.includes('--force'),
		...(mobile.updateServer.health
			? { health: mobile.updateServer.health }
			: {}),
		...(mobile.updateServer.rollout
			? { rollout: mobile.updateServer.rollout }
			: {}),
		modulePath,
		projectRoot,
		publicKeys: mobile.updates.publicKeys,
		storage: requestedStorage
	});
	console.log(
		`Provisioned ${requestedStorage === 'local' ? 'local development' : 'durable S3-compatible'} mobile update storage in ${relative(projectRoot, path).replaceAll('\\', '/')}.`
	);
	if (requestedStorage === 'local')
		console.log(
			'Production release checks will require durable storage. Re-run with --storage s3 --force before deploying.'
		);
	else
		console.log(
			`Set ABSOLUTE_MOBILE_UPDATE_S3_BUCKET${mobile.updateServer.health ? `, ${mobile.updateServer.health.secretEnv},` : ''} and standard AWS credentials on the trusted server; endpoint and region overrides are optional.`
		);
	const expoSigning = mobile.updates.expoCodeSigning;
	if (expoSigning) {
		const signingKey =
			mobile.updateServer.expoCodeSigningKeys[expoSigning.keyId];
		if (!signingKey)
			throw new TypeError(
				'The active Expo server signing key is missing.'
			);
		console.log(
			`Set ${signingKey.privateKeyEnv} only on the trusted server.`
		);
	}

	return path;
};

const publishMobileUpdate = async (args: string[]) => {
	const releaseDirectory = args.find((value, index) => {
		if (value.startsWith('-')) return false;
		const previous = args[index - 1];

		return !['--config', '--registry', '--rollout'].includes(
			previous ?? ''
		);
	});
	if (!releaseDirectory)
		throw new TypeError(
			'mobile update publish requires a release directory.'
		);
	const { mobile, projectRoot, publisher } =
		await mobileUpdatePublisher(args);
	const result = await publishAbsoluteMobileUpdate({
		projectRoot,
		publisher,
		releaseDirectory,
		rollout: updateRollout(
			args,
			mobile.updateServer?.rollout?.stages[0]?.rollout ?? 0.05
		)
	});
	console.log(
		`${result.reused ? 'Reused' : 'Published'} mobile update ${result.releaseId} to ${result.channel} at ${Math.round(result.rollout * 100)}%.`
	);
	if (
		result.storedBytes !== undefined &&
		result.reusedBytes !== undefined &&
		result.storedFiles !== undefined &&
		result.reusedFiles !== undefined
	)
		console.log(
			`Stored ${formatBytes(result.storedBytes)} in ${result.storedFiles} new content blobs; reused ${formatBytes(result.reusedBytes)} across ${result.reusedFiles} files.`
		);

	return result;
};

const promoteMobileUpdate = async (args: string[]) => {
	const { mobile } = await loadMobile(valueAfter(args, '--config'));
	if (!mobile.updates)
		throw new TypeError(
			'mobile update promote requires mobile.updates config.'
		);
	const releaseId = valueAfter(args, '--release');
	if (!releaseId)
		throw new TypeError(
			'mobile update promote requires --release <release-id>.'
		);
	const { publisher } = await mobileUpdatePublisher(args);
	const result = await promoteAbsoluteMobileUpdate({
		appId: mobile.appId,
		channel: mobile.updates.channel,
		publisher,
		releaseId,
		rollout: updateRollout(args)
	});
	console.log(
		`Promoted mobile update ${result.releaseId} to ${Math.round(result.rollout * 100)}%.`
	);

	return result;
};

const rollbackMobileUpdate = async (args: string[]) => {
	const { mobile } = await loadMobile(valueAfter(args, '--config'));
	if (!mobile.updates)
		throw new TypeError(
			'mobile update rollback requires mobile.updates config.'
		);
	const { publisher } = await mobileUpdatePublisher(args);
	const releaseId = valueAfter(args, '--release');
	const result = await rollbackAbsoluteMobileUpdate({
		appId: mobile.appId,
		channel: mobile.updates.channel,
		publisher,
		...(releaseId ? { releaseId } : {})
	});
	console.log(
		result.releaseId
			? `Rolled ${result.channel} back to ${result.releaseId}.`
			: `Rolled ${result.channel} back to the embedded store build.`
	);

	return result;
};

const mobileUpdateDays = (args: string[], flag: string) => {
	const value = valueAfter(args, flag);
	if (value === undefined) return undefined;
	const parsed = Number(value);
	const milliseconds = parsed * 24 * 60 * 60 * 1000;
	if (
		!Number.isFinite(parsed) ||
		parsed < 0 ||
		!Number.isSafeInteger(milliseconds)
	)
		throw new TypeError(`${flag} must be a non-negative number of days.`);

	return milliseconds;
};

const mobileUpdateRetention = (args: string[]) => {
	const retainedValue = valueAfter(args, '--retain');
	const retainRecent =
		retainedValue === undefined ? undefined : Number(retainedValue);
	if (
		retainRecent !== undefined &&
		(!Number.isSafeInteger(retainRecent) || retainRecent < 0)
	)
		throw new TypeError('--retain must be a non-negative integer.');

	return {
		minAgeMs: mobileUpdateDays(args, '--min-age-days'),
		retainRecent
	};
};

const printMobileUpdateStorage = (
	report: Awaited<ReturnType<typeof inspectAbsoluteMobileUpdateStorage>>
) => {
	console.log(
		`${report.appId}: ${report.releaseCount} releases use ${formatBytes(report.releaseBytes)}; ${formatBytes(report.reclaimableBytes)} is eligible across ${report.totalObjectCount} stored objects.`
	);
	if (
		typeof report.contentBlobCount === 'number' &&
		typeof report.contentBlobBytes === 'number' &&
		typeof report.reclaimableContentBytes === 'number' &&
		report.contentBlobCount > 0
	)
		console.log(
			`  Shared content: ${report.contentBlobCount} blobs use ${formatBytes(report.contentBlobBytes)}; ${formatBytes(report.reclaimableContentBytes)} becomes reclaimable with the eligible releases.`
		);
	for (const release of report.releases) {
		let state = 'eligible';
		if (release.protectedBy.length > 0)
			state = `kept: ${release.protectedBy.join(', ')}`;
		else if (release.markedAt) state = `marked ${release.markedAt}`;
		console.log(
			`  ${release.releaseId} ${release.channel} ${formatBytes(release.bytes)} (${state})`
		);
	}
	if (report.untrackedBytes > 0)
		console.log(
			`${formatBytes(report.untrackedBytes)} is used by channels, collection markers, or incomplete/unrecognized objects and will not be swept as a release.`
		);
};

const inspectMobileUpdateStorage = async (args: string[]) => {
	const startedAt = performance.now();
	const { mobile } = await loadMobile(valueAfter(args, '--config'));
	if (!mobile.updates)
		throw new TypeError(
			'mobile update storage requires mobile.updates config.'
		);
	const policy = mobileUpdateRetention(args);
	const { publisher } = await mobileUpdatePublisher(args);
	const report = await inspectAbsoluteMobileUpdateStorage({
		appId: mobile.appId,
		publisher,
		...(policy.minAgeMs === undefined ? {} : { minAgeMs: policy.minAgeMs }),
		...(policy.retainRecent === undefined
			? {}
			: { retainRecent: policy.retainRecent })
	});
	if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
	else printMobileUpdateStorage(report);
	sendTelemetryEvent('mobile:update-storage', {
		durationMs: Math.round(performance.now() - startedAt),
		reclaimableReleaseCount: report.releases.filter(
			(release) => release.protectedBy.length === 0
		).length,
		releaseCount: report.releaseCount
	});

	return report;
};

const inspectMobileUpdateHealth = async (args: string[]) => {
	const { mobile } = await loadMobile(valueAfter(args, '--config'));
	if (!mobile.updates)
		throw new TypeError(
			'mobile update status requires mobile.updates config.'
		);
	const { publisher } = await mobileUpdatePublisher(args);
	const releaseId = valueAfter(args, '--release');
	const rolloutReport = mobile.updateServer?.rollout
		? await inspectAbsoluteMobileUpdateRollout({
				appId: mobile.appId,
				channel: mobile.updates.channel,
				publisher
			})
		: undefined;
	const report = mobile.updateServer?.rollout
		? rolloutReport
		: await inspectAbsoluteMobileUpdateHealth({
				appId: mobile.appId,
				channel: mobile.updates.channel,
				publisher,
				...(releaseId ? { releaseId } : {})
			});
	if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
	else if (!report)
		console.log(
			`No active mobile update exists on ${mobile.updates.channel}.`
		);
	else {
		console.log(
			`${report.releaseId} is ${rolloutReport?.status.toUpperCase() ?? (report.paused ? 'PAUSED' : 'ACTIVE')} at ${Math.round(report.rollout * 100)}%: ${report.terminalReports} terminal reports, ${report.failures} failures (${(report.failureRate * 100).toFixed(1)}%).`
		);
		if (rolloutReport)
			console.log(
				`  Stage ${rolloutReport.currentStage + 1} entered ${rolloutReport.enteredAt}; advancement is ${rolloutReport.automatic ? 'automatic' : 'manual'}${rolloutReport.nextStage ? `, next ${Math.round(rolloutReport.nextStage.rollout * 100)}%` : ''}${rolloutReport.pausedBy ? `, paused by ${rolloutReport.pausedBy}` : ''}.`
			);
		console.log(
			`  ${report.activated} activated, ${report.rolledBack} rolled back, ${report.quarantined} quarantined, ${report.downloaded} downloaded, ${report.downloadFailed} download failures.`
		);
		console.log(
			`  Transfer: ${formatBytes(report.transfer.downloadedBytes)} downloaded, ${formatBytes(report.transfer.avoidedBytes)} avoided (${formatBytes(report.transfer.resumedBytes)} resumed, ${formatBytes(report.transfer.reusedBytes)} reused).`
		);
	}

	return report;
};

type MobileUpdateRolloutAction =
	| 'advance'
	| 'cancel'
	| 'pause'
	| 'reconcile'
	| 'resume';
const MOBILE_UPDATE_ROLLOUT_ACTION_LABEL: Record<
	MobileUpdateRolloutAction,
	string
> = {
	advance: 'Advanced',
	cancel: 'Cancelled',
	pause: 'Paused',
	reconcile: 'Reconciled',
	resume: 'Resumed'
};
const isMobileUpdateRolloutAction = (
	value: string | undefined
): value is MobileUpdateRolloutAction =>
	value !== undefined &&
	Object.hasOwn(MOBILE_UPDATE_ROLLOUT_ACTION_LABEL, value);

const controlMobileUpdateRollout = async (
	action: MobileUpdateRolloutAction,
	args: string[]
) => {
	const startedAt = performance.now();
	const { mobile } = await loadMobile(valueAfter(args, '--config'));
	if (!mobile.updates || !mobile.updateServer?.rollout)
		throw new TypeError(
			`mobile update ${action} requires mobile.updates.server.rollout config.`
		);
	const { publisher } = await mobileUpdatePublisher(args);
	const options = {
		appId: mobile.appId,
		channel: mobile.updates.channel,
		publisher
	} satisfies Parameters<typeof pauseAbsoluteMobileUpdateRollout>[0];
	const requestedRollout = valueAfter(args, '--rollout');
	let report;
	switch (action) {
		case 'advance':
			report = await advanceAbsoluteMobileUpdateRollout({
				...options,
				...(requestedRollout ? { rollout: updateRollout(args) } : {})
			});
			break;
		case 'cancel':
			report = await cancelAbsoluteMobileUpdateRollout(options);
			break;
		case 'pause':
			report = await pauseAbsoluteMobileUpdateRollout(options);
			break;
		case 'reconcile':
			report = await reconcileAbsoluteMobileUpdateRollout(options);
			break;
		case 'resume':
			report = await resumeAbsoluteMobileUpdateRollout(options);
	}
	if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
	else if (!report)
		console.log(
			`No active mobile update exists on ${mobile.updates.channel}.`
		);
	else
		console.log(
			`${MOBILE_UPDATE_ROLLOUT_ACTION_LABEL[action]} ${report.releaseId}: ${report.status.toUpperCase()} at ${Math.round(report.rollout * 100)}% (stage ${report.currentStage + 1}).`
		);
	sendTelemetryEvent('mobile:update-rollout', {
		action,
		durationMs: Math.round(performance.now() - startedAt),
		...(report
			? {
					automatic: report.automatic,
					status: report.status
				}
			: { status: 'empty' })
	});

	return report;
};

const collectMobileUpdates = async (args: string[]) => {
	const startedAt = performance.now();
	const { mobile } = await loadMobile(valueAfter(args, '--config'));
	if (!mobile.updates)
		throw new TypeError('mobile update gc requires mobile.updates config.');
	const policy = mobileUpdateRetention(args);
	const gracePeriodMs = mobileUpdateDays(args, '--grace-days');
	const { publisher } = await mobileUpdatePublisher(args);
	const result = await pruneAbsoluteMobileUpdates({
		appId: mobile.appId,
		apply: args.includes('--apply'),
		publisher,
		...(gracePeriodMs === undefined ? {} : { gracePeriodMs }),
		...(policy.minAgeMs === undefined ? {} : { minAgeMs: policy.minAgeMs }),
		...(policy.retainRecent === undefined
			? {}
			: { retainRecent: policy.retainRecent })
	});
	if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
	else {
		printMobileUpdateStorage(result);
		if (result.dryRun)
			console.log(
				'No storage was changed. Re-run with --apply to mark eligible releases and sweep releases whose grace period has elapsed.'
			);
		else
			console.log(
				`Collection applied: ${result.marked.length} marked, ${result.restored.length} restored, ${result.swept.length} swept, ${formatBytes(result.reclaimedBytes)} reclaimed.`
			);
	}
	sendTelemetryEvent('mobile:update-gc', {
		applied: !result.dryRun,
		durationMs: Math.round(performance.now() - startedAt),
		markedCount: result.marked.length,
		restoredCount: result.restored.length,
		sweptCount: result.swept.length
	});

	return result;
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
	await applyAbsoluteNativeUpdates(mobile, ['ios']);
	await applyAbsoluteNativeObservability(mobile, ['ios']);
	await applyAbsoluteNativeReleaseReadiness(mobile, ['ios']);
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
	await applyAbsoluteNativeUpdates(mobile, ['android']);
	await applyAbsoluteNativeObservability(mobile, ['android']);
	await applyAbsoluteNativeReleaseReadiness(mobile, ['android']);
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
	const host = detectAbsoluteMobileHost();
	const runPhase = async <T>(
		phase: 'bundle' | 'native-build' | 'native-project' | 'release-doctor',
		action: () => Promise<T>
	) => {
		const phaseStartedAt = performance.now();
		let phaseSuccess = false;
		try {
			const result = await action();
			phaseSuccess = true;

			return result;
		} finally {
			const durationMs = Math.round(performance.now() - phaseStartedAt);
			console.log(
				`[mobile:android-release] ${phase} ${phaseSuccess ? 'completed' : 'failed'} in ${getDurationString(durationMs)}`
			);
			sendTelemetryEvent('mobile:android-release-phase', {
				durationMs,
				engine: mobile.engine,
				host,
				phase,
				platform: 'android',
				success: phaseSuccess
			});
		}
	};
	let success = false;
	try {
		if (mobile.engine === 'capacitor')
			await repairAbsoluteAndroidDevSession(projectRoot);
		await runPhase('bundle', () =>
			start(
				mobileBuildServerEntry(args),
				valueAfter(args, '--web-outdir'),
				configPath,
				{ prepareOnly: true }
			)
		);
		await runPhase('native-project', () =>
			prepareAndroidReleaseProject(mobile, projectRoot, args)
		);
		await runPhase('release-doctor', () =>
			requireAndroidReleaseReady(mobile, projectRoot)
		);
		const release = await runPhase('native-build', () =>
			buildAbsoluteAndroidRelease({
				allowUnsigned: args.includes('--unsigned'),
				config: mobile,
				...(mobile.engine === 'expo'
					? { env: expoProductionEnvironment() }
					: {}),
				host,
				outputDirectory: valueAfter(args, '--outdir'),
				projectRoot,
				signing: androidCiSigning(),
				...(prepareVersionCode === undefined
					? {}
					: { prepareVersionCode })
			})
		);
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
			host,
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

const buildAndroidCommand = async (args: string[]) => {
	const googlePlay = googlePlayTarget(args);
	if (!googlePlay) return buildAndroid(args);
	const registryModule = args.includes('--registry')
		? requireValueAfter(args, '--registry')
		: 'mobile.release.ts';
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	const publisher = await loadAbsoluteNativeReleasePublisher(
		projectRoot,
		registryModule
	);

	return buildAndroid(args, (buildIdentity) =>
		prepareAbsoluteAndroidRelease(publisher, {
			buildIdentity,
			googlePlay,
			packageName: mobile.appId
		})
	);
};

const requirePublicationReleaseIdentity = (
	mobile: NormalizedAbsoluteMobileConfig,
	release: AbsoluteMobileCertifiableRelease,
	platform: 'android' | 'ios'
) => {
	if (
		release.metadata.platform !== platform ||
		release.metadata.appId !== mobile.appId ||
		release.metadata.engine !== mobile.engine
	)
		throw new TypeError(
			`The existing ${platform} release does not match this application's platform, app ID, or engine.`
		);
};

const loadPublicationCertification = async (options: {
	args: string[];
	platform: 'android' | 'ios';
	projectRoot: string;
	release: AbsoluteMobileCertifiableRelease;
	requirement?: AbsoluteMobileCertificationRequirement;
}) => {
	const requested = valueAfter(options.args, '--certification');
	if (
		options.args.includes('--certification') &&
		(!requested || requested.startsWith('-'))
	)
		throw new TypeError(
			`mobile publish ${options.platform} requires --certification <directory-or-json>.`
		);
	if (!requested) {
		if (options.requirement)
			throw new TypeError(
				`mobile publish ${options.platform} requires --certification with ${options.requirement} evidence for this release target.`
			);

		return undefined;
	}
	const loaded = await readAbsoluteMobileReleaseCertification(
		options.projectRoot,
		requested
	);

	return verifyAbsoluteMobileReleaseCertification(
		loaded.certification,
		options.release,
		options.requirement
	);
};

const loadPublicationCertificationVerification = async (options: {
	args: string[];
	certificationLoaded: boolean;
	projectRoot: string;
}) => {
	const requested = valueAfter(options.args, '--certification-attestation');
	if (
		options.args.includes('--certification-attestation') &&
		(!requested || requested.startsWith('-'))
	)
		throw new TypeError(
			'mobile publish requires --certification-attestation <verification-json>.'
		);
	if (!requested) return undefined;
	if (!options.certificationLoaded)
		throw new TypeError(
			'mobile publish --certification-attestation requires --certification.'
		);

	return readAbsoluteMobileCertificationVerification(
		options.projectRoot,
		requested
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
	const certificationRequirement =
		resolveAbsoluteMobileCertificationRequirement(mobile, {
			channel,
			googlePlayTrack: googlePlay?.track,
			platform: 'android'
		});
	const startedAt = performance.now();
	let reused = false;
	let success = false;
	try {
		const publisher = await loadAbsoluteNativeReleasePublisher(
			projectRoot,
			registryModule
		);
		const requestedRelease = args.includes('--release')
			? requireValueAfter(args, '--release')
			: undefined;
		const release = requestedRelease
			? await readAbsoluteAndroidRelease(projectRoot, requestedRelease)
			: await buildAndroid(
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
		requirePublicationReleaseIdentity(mobile, release, 'android');
		const certification = await loadPublicationCertification({
			args,
			platform: 'android',
			projectRoot,
			release,
			...(certificationRequirement
				? { requirement: certificationRequirement }
				: {})
		});
		const certificationVerification =
			await loadPublicationCertificationVerification({
				args,
				certificationLoaded: certification !== undefined,
				projectRoot
			});
		const publication = await publishAbsoluteAndroidRelease({
			allowUnsigned: args.includes('--unsigned'),
			channel,
			...(certification ? { certification } : {}),
			...(certificationRequirement ? { certificationRequirement } : {}),
			...(certificationVerification ? { certificationVerification } : {}),
			googlePlay,
			modulePath: registryModule,
			projectRoot,
			release
		});
		const { reused: publicationReused } = publication;
		reused = publicationReused;
		success = true;
		if (args.includes('--json'))
			return (
				console.log(JSON.stringify(publication, null, 2)), publication
			);
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

type BuildLocalIosReleaseOptions = {
	args: string[];
	mobile: NormalizedAbsoluteMobileConfig;
	prepareBuildNumber?: (buildIdentity: string) => Promise<number>;
	projectRoot: string;
};

const buildLocalIosRelease = async (options: BuildLocalIosReleaseOptions) => {
	await prepareIosReleaseProject(
		options.mobile,
		options.projectRoot,
		options.args
	);
	await requireIosReleaseReady(options.mobile, options.projectRoot);

	return buildAbsoluteIosRelease({
		allowUnsigned: options.args.includes('--unsigned'),
		config: options.mobile,
		developmentTeam: process.env.ABSOLUTE_IOS_DEVELOPMENT_TEAM,
		...(options.mobile.engine === 'expo'
			? { env: expoProductionEnvironment() }
			: {}),
		outputDirectory: valueAfter(options.args, '--outdir'),
		registeredDeviceArtifact: options.args.includes(
			'--registered-device-artifact'
		),
		...(options.prepareBuildNumber === undefined
			? {}
			: { prepareBuildNumber: options.prepareBuildNumber }),
		projectRoot: options.projectRoot
	});
};

const listenForRemoteReleaseCancellation = (
	cancellation: AbortController | undefined
) => {
	if (!cancellation) return () => undefined;
	const cancel = () =>
		cancellation.abort(new Error('Remote iOS release interrupted.'));
	process.once('SIGINT', cancel);
	process.once('SIGTERM', cancel);

	return () => {
		process.removeListener('SIGINT', cancel);
		process.removeListener('SIGTERM', cancel);
	};
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
	const requestedRemote = valueAfter(args, '--remote');
	if (
		args.includes('--remote') &&
		(!requestedRemote || requestedRemote.startsWith('-'))
	)
		throw new TypeError('mobile build ios requires --remote <name>.');
	const remoteProfile =
		requestedRemote !== undefined || process.platform !== 'darwin'
			? await getAbsoluteRemoteMacProfile(
					requestedRemote,
					remoteProfilePath()
				)
			: undefined;
	if (process.platform !== 'darwin' && !remoteProfile)
		throw new TypeError(
			'iOS release builds require macOS or a paired Remote Mac. Run `absolute mobile pair mac <name> <user@host>`.'
		);
	let success = false;
	const cancellation = remoteProfile ? new AbortController() : undefined;
	let stopListeningForCancellation: () => void = () => undefined;
	try {
		if (!remoteProfile && mobile.engine === 'capacitor')
			await repairAbsoluteIosDevSession(projectRoot);
		await start(
			mobileBuildServerEntry(args),
			valueAfter(args, '--web-outdir'),
			configPath,
			{ prepareOnly: true }
		);
		stopListeningForCancellation =
			listenForRemoteReleaseCancellation(cancellation);
		const release = remoteProfile
			? await buildAbsoluteRemoteIosRelease({
					allowUnsigned: args.includes('--unsigned'),
					developmentTeam: process.env.ABSOLUTE_IOS_DEVELOPMENT_TEAM,
					outputDirectory: valueAfter(args, '--outdir'),
					log: (message) => console.log(`[remote] ${message}`),
					onPhaseTiming: ({ durationMs, phase }) => {
						console.log(
							`[mobile:ios-release] ${phase} ${getDurationString(durationMs)}`
						);
						sendTelemetryEvent('mobile:ios-release-phase', {
							durationMs: Math.round(durationMs),
							engine: mobile.engine,
							phase,
							platform: 'ios',
							provider: 'remote-mac'
						});
					},
					...(prepareBuildNumber === undefined
						? {}
						: { prepareBuildNumber }),
					project: createAbsoluteRemoteIosDevProject(
						mobile,
						projectRoot,
						remoteProfile
					),
					registeredDeviceArtifact: args.includes(
						'--registered-device-artifact'
					),
					signal: cancellation?.signal
				})
			: await buildLocalIosRelease({
					args,
					mobile,
					...(prepareBuildNumber === undefined
						? {}
						: { prepareBuildNumber }),
					projectRoot
				});
		success = true;
		const durationMs = Math.round(performance.now() - startedAt);
		console.log(
			`Built ${release.metadata.signed ? 'signed' : 'unsigned'} iOS IPA ${release.metadata.marketingVersion}${release.metadata.buildNumber ? ` (${release.metadata.buildNumber})` : ''} in ${getDurationString(durationMs)}.`
		);
		console.log(`Artifact: ${release.artifactPath}`);
		if (release.registeredArtifactPath)
			console.log(
				`Registered-device artifact: ${release.registeredArtifactPath}`
			);
		console.log(`Metadata: ${join(release.releaseRoot, 'release.json')}`);

		return release;
	} finally {
		stopListeningForCancellation();
		sendTelemetryEvent('mobile:ios-release-build', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: mobile.engine,
			platform: 'ios',
			remote: remoteProfile !== undefined,
			success,
			type: 'ipa',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const buildIosCommand = async (args: string[]) => {
	const appStoreConnect = appStoreConnectTarget(args);
	if (!appStoreConnect) return buildIos(args);
	const registryModule = args.includes('--registry')
		? requireIosValueAfter(args, '--registry')
		: 'mobile.release.ts';
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	const marketingVersion = mobile.iosVersion;
	if (!marketingVersion)
		throw new TypeError(
			'iOS App Store build allocation requires mobile.ios.version.'
		);
	const publisher = await loadAbsoluteNativeReleasePublisher(
		projectRoot,
		registryModule
	);

	return buildIos(args, (buildIdentity) =>
		prepareAbsoluteIosRelease(publisher, {
			buildIdentity,
			bundleId: mobile.appId,
			marketingVersion
		})
	);
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
	const certificationRequirement =
		resolveAbsoluteMobileCertificationRequirement(mobile, {
			channel,
			platform: 'ios'
		});
	const startedAt = performance.now();
	let reused = false;
	let success = false;
	try {
		const publisher = await loadAbsoluteNativeReleasePublisher(
			projectRoot,
			registryModule
		);
		const requestedRelease = args.includes('--release')
			? requireIosValueAfter(args, '--release')
			: undefined;
		const release = requestedRelease
			? await readAbsoluteIosRelease(projectRoot, requestedRelease)
			: await buildIos(
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
		requirePublicationReleaseIdentity(mobile, release, 'ios');
		const certification = await loadPublicationCertification({
			args,
			platform: 'ios',
			projectRoot,
			release,
			...(certificationRequirement
				? { requirement: certificationRequirement }
				: {})
		});
		const certificationVerification =
			await loadPublicationCertificationVerification({
				args,
				certificationLoaded: certification !== undefined,
				projectRoot
			});
		const publication = await publishAbsoluteIosRelease({
			allowUnsigned: args.includes('--unsigned'),
			appStoreConnect,
			channel,
			...(certification ? { certification } : {}),
			...(certificationRequirement ? { certificationRequirement } : {}),
			...(certificationVerification ? { certificationVerification } : {}),
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
		if (args.includes('--json'))
			return (
				console.log(JSON.stringify(publication, null, 2)), publication
			);
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

const selectOrStartAndroidReleaseEmulator = async (
	adb: string,
	emulator: string | undefined,
	explicitSerial: string | undefined,
	json: boolean
) => {
	if (explicitSerial) return selectAndroidSerial(adb, explicitSerial);
	const current = captureCommand([adb, 'devices']);
	const ready =
		current.exitCode === 0
			? parseAdbDevices(current.stdout).find((serial) =>
					serial.startsWith('emulator-')
				)
			: undefined;
	if (ready) return ready;
	if (!emulator)
		throw new TypeError(
			'Android Emulator is unavailable. Run `absolute mobile doctor android --fix`.'
		);
	(json ? console.error : console.log)(
		`Starting managed Android emulator ${ABSOLUTE_ANDROID_AVD_NAME}…`
	);
	const launched = Bun.spawn(
		[
			emulator,
			'-avd',
			ABSOLUTE_ANDROID_AVD_NAME,
			'-netdelay',
			'none',
			'-netspeed',
			'full'
		],
		{ stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' }
	);
	launched.unref();
	const startedAt = performance.now();
	const bootedSerial = () => {
		const devices = captureCommand([adb, 'devices']);
		const serial =
			devices.exitCode === 0
				? parseAdbDevices(devices.stdout).find((candidate) =>
						candidate.startsWith('emulator-')
					)
				: undefined;
		if (!serial) return undefined;
		const booted = captureCommand([
			adb,
			'-s',
			serial,
			'shell',
			'getprop',
			'sys.boot_completed'
		]);

		return booted.exitCode === 0 && booted.stdout.trim() === '1'
			? serial
			: undefined;
	};
	const waitForBoot: () => Promise<string> = async () => {
		if (performance.now() - startedAt >= ANDROID_EMULATOR_BOOT_TIMEOUT_MS)
			throw new Error(
				`Managed Android emulator ${ABSOLUTE_ANDROID_AVD_NAME} did not finish booting within 180 seconds.`
			);
		const serial = bootedSerial();
		if (serial) return serial;
		await Bun.sleep(ANDROID_EMULATOR_BOOT_POLL_MS);

		return waitForBoot();
	};

	return waitForBoot();
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

const captureAndroidReleaseScreenshot = async (
	adb: string,
	serial: string,
	destination: string
) => {
	const process = Bun.spawn(
		[adb, '-s', serial, 'exec-out', 'screencap', '-p'],
		{ stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' }
	);
	const [exitCode, bytes, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).bytes(),
		new Response(process.stderr).text()
	]);
	if (exitCode !== 0)
		throw new Error(
			`Android release screenshot failed: ${stderr.trim() || `status ${exitCode}`}`
		);
	await writeFile(destination, bytes);

	return destination;
};

const printAndroidReleaseAcceptance = (
	result: Awaited<ReturnType<typeof runAbsoluteAndroidReleaseAcceptance>>,
	json: boolean
) => {
	if (json) {
		console.log(JSON.stringify(result, null, 2));

		return;
	}
	console.log(
		`✓ Installed immutable ${result.engine} release ${result.releaseId} with Bundletool in ${getDurationString(result.installMs)}.`
	);
	console.log(
		`✓ Embedded web content booted offline in ${getDurationString(result.launchMs)} and relaunched in ${getDurationString(result.relaunchMs)}.`
	);
};

const testAndroidRelease = async (
	args: string[],
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const requested = valueAfter(args, '--release');
	if (!requested || requested.startsWith('--'))
		throw new TypeError(
			'mobile test android --release requires a release directory or release.json path.'
		);
	if (!mobile.platforms.includes('android'))
		throw new TypeError(
			'mobile test android requires android in mobile.platforms.'
		);
	const release = await readAbsoluteAndroidRelease(projectRoot, requested);
	if (release.metadata.appId !== mobile.appId)
		throw new TypeError(
			`Android release app ID ${release.metadata.appId} does not match mobile.appId ${mobile.appId}.`
		);
	if (release.metadata.engine !== mobile.engine)
		throw new TypeError(
			`Android release engine ${release.metadata.engine} does not match configured engine ${mobile.engine}.`
		);
	if (mobile.engine === 'expo' && mobile.expoNativeRoutes[mobile.entry])
		throw new TypeError(
			'Offline Expo release acceptance requires mobile.entry to be an embedded web route; the configured entry is native and requires trusted server page data.'
		);
	const checks = await inspectAbsoluteMobileToolchain();
	const adb = checks.find(
		(check) => check.id === 'android.adb' && check.status === 'pass'
	)?.path;
	const java = checks.find(
		(check) => check.id === 'android.java' && check.status === 'pass'
	)?.path;
	const emulator = checks.find(
		(check) => check.id === 'android.emulator' && check.status === 'pass'
	)?.path;
	if (!adb)
		throw new TypeError(
			'Android Debug Bridge is unavailable. Run `absolute mobile doctor android --fix`.'
		);
	if (!java)
		throw new TypeError(
			'Java is unavailable. Install the JDK required by the Android toolchain and rerun `absolute mobile doctor android`.'
		);
	const serial = await selectOrStartAndroidReleaseEmulator(
		adb,
		emulator,
		valueAfter(args, '--serial'),
		args.includes('--json')
	);
	const inspectedBundletool = await inspectAbsoluteBundletool();
	const approved =
		inspectedBundletool.ready ||
		args.includes('--yes') ||
		(await confirmInstall(
			`Bundletool ${ABSOLUTE_BUNDLETOOL_VERSION} is required to install the exact App Bundle. Download and checksum-verify it now?`
		));
	const bundletool = await ensureAbsoluteBundletool({
		approved: approved === true
	});
	const reportRoot = nativeReportRoot(args, projectRoot, 'android');
	const artifactRoot =
		reportRoot ??
		safeArtifactRoot(
			projectRoot,
			valueAfter(args, '--artifacts') ??
				`.absolutejs/mobile/test-artifacts/${release.metadata.releaseId}`
		);
	const startedAt = performance.now();
	try {
		const result = await runAbsoluteAndroidReleaseAcceptance({
			adb,
			artifactDirectory: artifactRoot,
			bundletool,
			host: detectAbsoluteMobileHost(),
			java,
			...(mobile.deepLinkScheme
				? {
						launchUrl: `${mobile.deepLinkScheme}://${mobile.entry}`
					}
				: {}),
			release,
			serial
		});
		const screenshot = reportRoot
			? await captureAndroidReleaseScreenshot(
					adb,
					serial,
					join(reportRoot, 'android-release.png')
				)
			: undefined;
		sendTelemetryEvent('mobile:android-release-conformance', {
			durationMs: result.durationMs,
			engine: result.engine,
			installMs: result.installMs,
			launchMs: result.launchMs,
			platform: 'android',
			relaunchMs: result.relaunchMs,
			success: true
		});
		await writeRequestedAndroidReport({
			adb,
			args,
			projectRoot,
			provider: mobile.engine,
			reportRoot,
			run: {
				appId: mobile.appId,
				durationMs: result.durationMs,
				hmrConnected: false,
				release: {
					apksBytes: result.apksBytes,
					artifactBytes: result.artifactBytes,
					artifactSha256: result.artifactSha256,
					embeddedOffline: result.embeddedOffline,
					engine: result.engine,
					installMs: result.installMs,
					launchMs: result.launchMs,
					relaunchMs: result.relaunchMs,
					releaseId: result.releaseId,
					signed: result.signed
				},
				...(screenshot ? { screenshot } : {}),
				serial,
				status: 'pass'
			}
		});
		printAndroidReleaseAcceptance(result, args.includes('--json'));

		return result;
	} catch (error) {
		const durationMs = Math.round(performance.now() - startedAt);
		sendTelemetryEvent('mobile:android-release-conformance', {
			durationMs,
			engine: mobile.engine,
			platform: 'android',
			success: false
		});
		await mkdir(artifactRoot, { recursive: true });
		const diagnosticPath = join(
			artifactRoot,
			'android-release-failure.json'
		);
		await writeFile(
			diagnosticPath,
			`${JSON.stringify(
				{
					error: sanitizeNativeReportText(
						error instanceof Error ? error.message : String(error)
					),
					platform: 'android',
					provider: mobile.engine,
					releaseId: release.metadata.releaseId,
					status: 'fail'
				},
				null,
				2
			)}\n`
		);
		await writeRequestedAndroidReport({
			adb,
			args,
			projectRoot,
			provider: mobile.engine,
			reportRoot,
			run: {
				appId: mobile.appId,
				durationMs,
				error: 'Installed release acceptance failed; inspect the local diagnostic artifact before sharing evidence.',
				hmrConnected: false,
				release: {
					apksBytes: 0,
					artifactBytes: release.metadata.bytes,
					artifactSha256: release.metadata.sha256,
					embeddedOffline: false,
					engine: release.metadata.engine,
					installMs: 0,
					launchMs: 0,
					relaunchMs: 0,
					releaseId: release.metadata.releaseId,
					signed: release.metadata.signed
				},
				serial,
				status: 'fail'
			}
		});
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Failure diagnostics: ${diagnosticPath}`,
			{ cause: error }
		);
	}
};

const testAndroid = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	if (args.includes('--release')) {
		return testAndroidRelease(args, mobile, projectRoot);
	}
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

const selectOrStartIosReleaseSimulator = async (
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
	const selected = explicitUdid
		? devices.find((device) => device.udid === explicitUdid)
		: devices.find((device) => device.name === ABSOLUTE_IOS_SIMULATOR_NAME);
	if (!selected)
		throw new TypeError(
			explicitUdid
				? `iOS simulator ${explicitUdid} is unavailable.`
				: 'No managed AbsoluteJS iOS simulator was found. Run `absolute mobile doctor ios --fix`.'
		);
	if (selected.state !== 'Booted') {
		requireCapturedCommand(
			[xcrun, 'simctl', 'boot', selected.udid],
			'iOS Simulator boot'
		);
		requireCapturedCommand(
			[xcrun, 'simctl', 'bootstatus', selected.udid, '-b'],
			'iOS Simulator readiness'
		);
	}

	return { ...selected, state: 'Booted' as const };
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
	provider?: 'capacitor' | 'expo';
	reportRoot?: string;
	run: Parameters<typeof createAbsoluteAndroidTestReport>[0]['run'];
}) => {
	const reportRoot =
		options.reportRoot ??
		nativeReportRoot(options.args, options.projectRoot, 'android');
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
		...(options.provider ? { provider: options.provider } : {}),
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
	provider?: 'capacitor' | 'expo';
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
		createAbsoluteIosPartnerReport({
			...metadata,
			...(options.provider ? { provider: options.provider } : {}),
			run: options.run
		})
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

const printIosReleaseAcceptance = (
	result: AbsoluteIosReleaseAcceptanceResult,
	json: boolean
) => {
	if (json) {
		console.log(JSON.stringify(result, null, 2));

		return;
	}
	console.log(
		`✓ ${result.artifactExactness} ${result.engine} iOS release evidence passed via ${result.distribution}.`
	);
	console.log(
		`✓ Embedded local content launched in ${getDurationString(result.launchMs)} and relaunched in ${getDurationString(result.relaunchMs)}.`
	);
	console.log(
		result.networkUnavailable === 'user-confirmed'
			? '✓ Physical-device network-unavailable state was explicitly confirmed.'
			: 'ℹ Simulator evidence does not claim physical-device offline behavior.'
	);
};

const iosReleaseRun = (
	result: AbsoluteIosReleaseAcceptanceResult,
	appId: string,
	targetId: string,
	remote: boolean
): AbsoluteIosAutomatedResult => ({
	appId,
	durationMs: result.durationMs,
	hmrConnected: false,
	iosRelease: {
		artifactBytes: result.artifactBytes,
		artifactExactness: result.artifactExactness,
		artifactSha256: result.artifactSha256,
		distribution: result.distribution,
		embeddedLocal: result.embeddedLocal,
		engine: result.engine,
		installMs: result.installMs,
		launchMs: result.launchMs,
		networkUnavailable: result.networkUnavailable,
		relaunchMs: result.relaunchMs,
		releaseId: result.releaseId,
		remote,
		signed: result.signed
	},
	status: 'pass',
	targetId,
	targetKind: result.target
});

const runIosPhysicalReleaseTarget = async (options: {
	args: string[];
	device: string;
	release: Awaited<ReturnType<typeof readAbsoluteIosRelease>>;
	xcrun: string;
}) => {
	const confirmed =
		options.args.includes('--yes') ||
		(await confirmInstall(
			'On the selected iPhone, enable Airplane Mode and then disable Wi-Fi in Settings. Confirm both are still disabled and continue with two release launches?'
		));
	if (!confirmed)
		throw new TypeError(
			'Physical iOS offline acceptance was cancelled because network-unavailable state was not confirmed.'
		);
	const targetId = normalizeAbsoluteIosDeviceIdentifier(options.device);
	const result = await runAbsoluteIosDeviceReleaseAcceptance({
		device: targetId,
		distribution: options.args.includes('--testflight')
			? 'testflight'
			: 'registered-device',
		networkUnavailableConfirmed: true,
		release: options.release,
		xcrun: options.xcrun
	});

	return { result, targetId };
};

const runIosSimulatorReleaseTarget = async (options: {
	args: string[];
	artifactRoot: string;
	mobile: NormalizedAbsoluteMobileConfig;
	release: Awaited<ReturnType<typeof readAbsoluteIosRelease>>;
	xcrun: string;
}) => {
	const simulator = await selectOrStartIosReleaseSimulator(
		options.xcrun,
		valueAfter(options.args, '--udid') ??
			valueAfter(options.args, '--serial')
	);
	const xcodebuild = requireCapturedCommand(
		[options.xcrun, '--find', 'xcodebuild'],
		'Xcode build-tool inspection'
	).stdout.trim();
	const result = await runAbsoluteIosSimulatorReleaseAcceptance({
		artifactDirectory: options.artifactRoot,
		config: options.mobile,
		release: options.release,
		udid: simulator.udid,
		xcodebuild,
		xcrun: options.xcrun
	});

	return { result, targetId: simulator.udid };
};

type RemoteIosReleaseTargetOptions = {
	args: string[];
	cancellation?: AbortController;
	mobile: NormalizedAbsoluteMobileConfig;
	profile: AbsoluteRemoteMacProfile;
	projectRoot: string;
	release: Awaited<ReturnType<typeof readAbsoluteIosRelease>>;
	requestedDevice?: string;
};

const runRemoteIosReleaseTarget = async (
	options: RemoteIosReleaseTargetOptions
) => {
	const physical = options.requestedDevice !== undefined;
	const confirmed =
		!physical ||
		options.args.includes('--yes') ||
		(await confirmInstall(
			'On the selected iPhone, enable Airplane Mode and then disable Wi-Fi in Settings. Confirm both are still disabled and continue with two release launches on the Remote Mac?'
		));
	if (!confirmed)
		throw new TypeError(
			'Physical iOS offline acceptance was cancelled because network-unavailable state was not confirmed.'
		);
	let distribution: 'registered-device' | 'simulator-release' | 'testflight' =
		'simulator-release';
	if (options.requestedDevice) distribution = 'registered-device';
	if (options.args.includes('--testflight')) distribution = 'testflight';
	const simulatorUdid =
		valueAfter(options.args, '--udid') ??
		valueAfter(options.args, '--serial');
	const remoteAcceptance = await runAbsoluteRemoteIosReleaseAcceptance({
		...(options.requestedDevice
			? {
					deviceIdentifier: normalizeAbsoluteIosDeviceIdentifier(
						options.requestedDevice
					),
					networkUnavailableConfirmed: true
				}
			: {}),
		distribution,
		project: createAbsoluteRemoteIosDevProject(
			options.mobile,
			options.projectRoot,
			options.profile
		),
		release: options.release,
		signal: options.cancellation?.signal,
		log: (message) => console.log(`[remote] ${message}`),
		onPhaseTiming: ({ durationMs, phase }) => {
			console.log(
				`[mobile:ios-release-test] ${phase} ${getDurationString(durationMs)}`
			);
			sendTelemetryEvent('mobile:ios-release-test-phase', {
				durationMs: Math.round(durationMs),
				engine: options.mobile.engine,
				phase,
				platform: 'ios',
				provider: 'remote-mac'
			});
		},
		...(simulatorUdid ? { simulatorUdid } : {})
	});

	return {
		result: remoteAcceptance.result,
		targetId: remoteAcceptance.targetId
	};
};

const testIosRelease = async (
	args: string[],
	mobile: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const requested = valueAfter(args, '--release');
	if (!requested || requested.startsWith('--'))
		throw new TypeError(
			'mobile test ios --release requires a release directory or release.json path.'
		);
	if (!mobile.platforms.includes('ios'))
		throw new TypeError(
			'mobile test ios requires ios in mobile.platforms.'
		);
	const requestedRemote = valueAfter(args, '--remote');
	if (
		args.includes('--remote') &&
		(!requestedRemote || requestedRemote.startsWith('-'))
	)
		throw new TypeError(
			'mobile test ios --release requires --remote <name>.'
		);
	const remoteProfile =
		requestedRemote !== undefined || process.platform !== 'darwin'
			? await getAbsoluteRemoteMacProfile(
					requestedRemote,
					remoteProfilePath()
				)
			: undefined;
	if (process.platform !== 'darwin' && !remoteProfile)
		throw new TypeError(
			'iOS release acceptance requires macOS or a paired Remote Mac. Run `absolute mobile pair mac <name> <user@host>`.'
		);
	const release = await readAbsoluteIosRelease(projectRoot, requested);
	if (release.metadata.appId !== mobile.appId)
		throw new TypeError(
			`iOS release app ID ${release.metadata.appId} does not match mobile.appId ${mobile.appId}.`
		);
	if (release.metadata.engine !== mobile.engine)
		throw new TypeError(
			`iOS release engine ${release.metadata.engine} does not match configured engine ${mobile.engine}.`
		);
	if (mobile.engine === 'expo' && mobile.expoNativeRoutes[mobile.entry])
		throw new TypeError(
			'Embedded-local Expo release acceptance requires mobile.entry to be a web route; native Expo routes may depend on trusted-server page data.'
		);
	const requestedDevice = valueAfter(args, '--device');
	if (args.includes('--device') && !requestedDevice)
		throw new TypeError(
			'mobile test ios --release --device requires a device identifier or name.'
		);
	if (args.includes('--testflight') && !requestedDevice)
		throw new TypeError(
			'mobile test ios --release --testflight requires --device.'
		);
	if (
		requestedDevice &&
		(valueAfter(args, '--udid') || valueAfter(args, '--serial'))
	)
		throw new TypeError(
			'mobile test ios --release --device cannot be combined with a simulator selector.'
		);
	const xcrun = remoteProfile ? undefined : await requireIosXcrun();
	const reportRoot = nativeReportRoot(args, projectRoot, 'ios');
	const artifactRoot =
		reportRoot ??
		safeArtifactRoot(
			projectRoot,
			valueAfter(args, '--artifacts') ??
				`.absolutejs/mobile/test-artifacts/${release.metadata.releaseId}`
		);
	const startedAt = performance.now();
	let targetId = requestedDevice ?? 'ios-simulator';
	let remoteReportMetadata:
		| Awaited<ReturnType<typeof iosReportMetadata>>
		| undefined;
	if (remoteProfile && reportRoot) {
		const macos = await captureAbsoluteRemoteMacCommand(remoteProfile, [
			'/usr/bin/sw_vers',
			'-productVersion'
		]);
		if (macos.exitCode !== 0)
			throw new Error('Remote Mac version inspection failed.');
		remoteReportMetadata = {
			absolutejsVersion: await absolutejsVersionForReport(),
			bunVersion: Bun.version,
			macosVersion: macos.stdout.trim(),
			xcodeVersion: remoteProfile.xcodeVersion
		};
	}
	const cancellation = remoteProfile ? new AbortController() : undefined;
	const stopListeningForCancellation = remoteProfile
		? listenForRemoteReleaseCancellation(cancellation)
		: () => undefined;
	try {
		let acceptance;
		if (remoteProfile)
			acceptance = await runRemoteIosReleaseTarget({
				args,
				...(cancellation ? { cancellation } : {}),
				mobile,
				profile: remoteProfile,
				projectRoot,
				release,
				...(requestedDevice ? { requestedDevice } : {})
			});
		else if (!xcrun)
			throw new Error('Local iOS release acceptance requires xcrun.');
		else if (requestedDevice)
			acceptance = await runIosPhysicalReleaseTarget({
				args,
				device: requestedDevice,
				release,
				xcrun
			});
		else
			acceptance = await runIosSimulatorReleaseTarget({
				args,
				artifactRoot,
				mobile,
				release,
				xcrun
			});
		const { result, targetId: acceptedTargetId } = acceptance;
		targetId = acceptedTargetId;
		sendTelemetryEvent('mobile:ios-release-conformance', {
			artifactExactness: result.artifactExactness,
			distribution: result.distribution,
			durationMs: result.durationMs,
			engine: result.engine,
			installMs: result.installMs,
			launchMs: result.launchMs,
			platform: 'ios',
			relaunchMs: result.relaunchMs,
			remote: remoteProfile !== undefined,
			success: true
		});
		await writeRequestedIosReport({
			args,
			...(remoteReportMetadata ? { metadata: remoteReportMetadata } : {}),
			projectRoot,
			provider: mobile.engine,
			run: iosReleaseRun(
				result,
				mobile.appId,
				targetId,
				remoteProfile !== undefined
			),
			...(xcrun ? { xcrun } : {})
		});
		printIosReleaseAcceptance(result, args.includes('--json'));

		return result;
	} catch (error) {
		const durationMs = Math.round(performance.now() - startedAt);
		sendTelemetryEvent('mobile:ios-release-conformance', {
			durationMs,
			engine: mobile.engine,
			platform: 'ios',
			remote: remoteProfile !== undefined,
			success: false
		});
		await mkdir(artifactRoot, { recursive: true });
		const diagnosticPath = join(artifactRoot, 'ios-release-failure.json');
		await writeFile(
			diagnosticPath,
			`${JSON.stringify(
				{
					error: sanitizeIosReportText(
						error instanceof Error ? error.message : String(error)
					),
					platform: 'ios',
					provider: mobile.engine,
					releaseId: release.metadata.releaseId,
					status: 'fail'
				},
				null,
				2
			)}\n`
		);
		if (reportRoot)
			await writeRequestedIosReport({
				args,
				...(remoteReportMetadata
					? { metadata: remoteReportMetadata }
					: {}),
				projectRoot,
				provider: mobile.engine,
				run: {
					appId: mobile.appId,
					durationMs,
					error: 'Installed iOS release acceptance failed; inspect the local diagnostic artifact before sharing evidence.',
					hmrConnected: false,
					status: 'fail',
					targetId,
					targetKind: requestedDevice ? 'device' : 'simulator'
				},
				...(xcrun ? { xcrun } : {})
			});
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Failure diagnostics: ${diagnosticPath}`,
			{ cause: error }
		);
	} finally {
		stopListeningForCancellation();
	}
};

const testIos = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	if (args.includes('--release'))
		return testIosRelease(args, mobile, projectRoot);
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

const readCertifiableMobileRelease = async (
	projectRoot: string,
	requested: string
) => {
	let androidError: unknown;
	try {
		return await readAbsoluteAndroidRelease(projectRoot, requested);
	} catch (error) {
		androidError = error;
	}
	try {
		return await readAbsoluteIosRelease(projectRoot, requested);
	} catch (iosError) {
		throw new TypeError(
			`Unable to read an immutable Android or iOS release from ${requested}. Android: ${androidError instanceof Error ? androidError.message : String(androidError)} iOS: ${iosError instanceof Error ? iosError.message : String(iosError)}`,
			{ cause: iosError }
		);
	}
};

const mobileCertificationRequirement = (value: string | undefined) => {
	if (value === undefined) return undefined;
	if (
		value !== 'installed' &&
		value !== 'simulator' &&
		value !== 'device' &&
		value !== 'store'
	)
		throw new TypeError(
			'mobile certify --require must be installed, simulator, device, or store.'
		);

	return value;
};

const mobileCertificationValue = (args: string[], flag: string) => {
	const value = valueAfter(args, flag);
	if (args.includes(flag) && (!value || value.startsWith('--')))
		throw new TypeError(`mobile certify ${flag} requires a value.`);

	return value;
};

type MobileCertificationCommandOptions = {
	args: string[];
	projectRoot: string;
	release: AbsoluteMobileCertifiableRelease;
	requirement?: AbsoluteMobileCertificationRequirement;
	startedAt: number;
};

const verifyMobileCertification = async (
	options: MobileCertificationCommandOptions & { verifyPath: string }
) => {
	if (valuesAfter(options.args, '--evidence').length > 0)
		throw new TypeError(
			'mobile certify --verify cannot be combined with --evidence.'
		);
	const loaded = await readAbsoluteMobileReleaseCertification(
		options.projectRoot,
		options.verifyPath
	);
	const certification = verifyAbsoluteMobileReleaseCertification(
		loaded.certification,
		options.release,
		options.requirement
	);
	sendTelemetryEvent('mobile:release-certification', {
		durationMs: Math.round(performance.now() - options.startedAt),
		engine: options.release.metadata.engine,
		mode: 'verify',
		platform: options.release.metadata.platform,
		requirement: options.requirement ?? certification.requirement,
		strength: certification.strength,
		success: true
	});
	if (options.args.includes('--json'))
		console.log(JSON.stringify(certification, null, 2));
	else
		console.log(
			`✓ ${certification.strength} certification ${certification.certificationId} still matches ${certification.release.releaseId}.`
		);

	return certification;
};

const createMobileCertification = async (
	options: MobileCertificationCommandOptions
) => {
	const evidencePaths = valuesAfter(options.args, '--evidence');
	const certification = await createAbsoluteMobileReleaseCertification({
		evidencePaths,
		projectRoot: options.projectRoot,
		release: options.release,
		...(options.requirement ? { requirement: options.requirement } : {})
	});
	const output = await writeAbsoluteMobileReleaseCertification(
		options.projectRoot,
		certification,
		mobileCertificationValue(options.args, '--outdir')
	);
	sendTelemetryEvent('mobile:release-certification', {
		durationMs: Math.round(performance.now() - options.startedAt),
		engine: options.release.metadata.engine,
		evidenceCount: certification.evidence.length,
		mode: 'create',
		platform: options.release.metadata.platform,
		requirement: certification.requirement,
		strength: certification.strength,
		success: true
	});
	if (options.args.includes('--json'))
		console.log(JSON.stringify(certification, null, 2));
	else {
		console.log(
			`✓ Certified immutable ${certification.release.platform} release ${certification.release.releaseId} at ${certification.strength} strength.`
		);
		console.log(`Certification: ${output.jsonPath}`);
		console.log(`Summary: ${output.markdownPath}`);
	}

	return certification;
};

const certifyMobileRelease = async (args: string[]) => {
	const [requested] = args;
	if (!requested || requested.startsWith('--'))
		throw new TypeError(
			'mobile certify requires a release directory or release.json path.'
		);
	const projectRoot = process.cwd();
	const release = await readCertifiableMobileRelease(projectRoot, requested);
	const requirement = mobileCertificationRequirement(
		mobileCertificationValue(args, '--require')
	);
	const verifyPath = mobileCertificationValue(args, '--verify');
	const startedAt = performance.now();
	try {
		const options: MobileCertificationCommandOptions = {
			args,
			projectRoot,
			release,
			...(requirement ? { requirement } : {}),
			startedAt
		};

		return verifyPath
			? await verifyMobileCertification({ ...options, verifyPath })
			: await createMobileCertification(options);
	} catch (error) {
		sendTelemetryEvent('mobile:release-certification', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: release.metadata.engine,
			mode: verifyPath ? 'verify' : 'create',
			platform: release.metadata.platform,
			...(requirement ? { requirement } : {}),
			success: false
		});
		throw error;
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
		if (args[1] === 'promote')
			await dispatchGithubMobilePromotion(args.slice(2));
		else if (args[1] === 'status')
			await inspectGithubMobileRun(args.slice(2));
		else if (args[1] === 'audit')
			await auditGithubMobilePromotion(args.slice(2));
		else if (args[1] === 'verification')
			await createGithubCertificationVerification(args.slice(2));
		else await generateGithubCi(args.slice(1));

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
	if (command === 'certify') {
		await certifyMobileRelease(args.slice(1));

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
		await buildAndroidCommand(args.slice(2));

		return;
	}
	if (command === 'build' && args[1] === 'ios') {
		await buildIosCommand(args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'build') {
		await buildMobileUpdate(args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'provision') {
		await provisionMobileUpdate(args.slice(2));

		return;
	}
	if (
		command === 'update' &&
		args[1] === 'signing' &&
		args[2] === 'generate'
	) {
		await generateExpoUpdateSigning(args.slice(3));

		return;
	}
	if (command === 'update' && args[1] === 'publish') {
		await publishMobileUpdate(args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'promote') {
		await promoteMobileUpdate(args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'rollback') {
		await rollbackMobileUpdate(args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'storage') {
		await inspectMobileUpdateStorage(args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'status') {
		await inspectMobileUpdateHealth(args.slice(2));

		return;
	}
	if (command === 'update' && isMobileUpdateRolloutAction(args[1])) {
		await controlMobileUpdateRollout(args[1], args.slice(2));

		return;
	}
	if (command === 'update' && args[1] === 'gc') {
		await collectMobileUpdates(args.slice(2));

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
		'Usage: absolute mobile <pair mac <name> <user@host> [--port n] [--workspace path] | remotes [inspect [name] [--json] | clean [name] --yes | --json] | unpair mac <name> | init [--no-native] [--force] | sync [ios|android] | inspect [--json] [--require-bundle] | certify <release-dir> [--evidence report-dir]... [--require installed|simulator|device|store] [--outdir dir] [--json] | certify <release-dir> --verify certification-dir [--require installed|simulator|device|store] [--json] | associations [--outdir dir] [--verify] | ci github [server-entry] [--publish] [--registry module] [--secret-env NAME] [--output path] [--force] [--json] | ci promote <android|ios> --run-id id --certification path [--channel name] [--play-track track|--testflight-group group] [--ref branch] [--repo owner/name] [--watch] [--audit] [--outdir path] [--json] | ci status --run-id id [--watch] [--repo owner/name] [--json] | ci audit --run-id id [--source-run-id id] [--repo owner/name] [--outdir path] [--json] | doctor [ios|android|release [ios|android]] [--remote name] [--json|--fix [--yes]] | build <android|ios> [server-entry] [--remote name] [--registered-device-artifact] [--outdir dir] [--web-outdir dir] [--unsigned] | update provision [--storage local|s3] [--registry module] [--force] [--yes] | update signing generate --private-key path [--certificate path] [--public-key path] [--key-id id] [--common-name name] [--validity-years n] | update build [server-entry] --classification bug-fix|content|security --key-id id --signing-key path --within-submitted-purpose [--outdir dir] [--web-outdir dir] | update publish <release-directory> [--rollout fraction] [--registry module] | update promote --release id --rollout fraction [--registry module] | update rollback [--release id] [--registry module] | update status [--registry module] [--json] | update advance [--rollout fraction] [--registry module] [--json] | update pause|resume|cancel|reconcile [--registry module] [--json] | update storage [--retain count] [--min-age-days days] [--registry module] [--json] | update gc [--retain count] [--min-age-days days] [--grace-days days] [--apply] [--registry module] [--json] | publish android [server-entry] [--release release-dir] [--certification certification-dir] [--certification-attestation verification-json] [--registry module] [--channel name] [--play-track track] [--play-status completed|draft|halted|in-progress] [--play-rollout fraction] [--play-name name] [--play-notes language=text] [--play-update-priority 0..5] [--play-hold-review] [--play-cancel-existing-review] [--outdir dir] [--web-outdir dir] [--unsigned] | publish ios [server-entry] [--release release-dir] [--certification certification-dir] [--certification-attestation verification-json] [--remote name] [--registry module] [--channel name] [--testflight-group name-or-id] [--testflight-notes locale=text] [--testflight-submit-review] [--outdir dir] [--web-outdir dir] [--unsigned] | test android [--release release-dir [--yes] | --route path [--wait-for-hmr] [--port n]] [--report [dir]] [--serial id] [--artifacts dir] [--json] [--config path] | test ios [--release release-dir [--remote name] [--device id [--testflight] --yes] | --wait-for-hmr] [--report [dir]] [--udid id] [--artifacts dir] [--json] [--config path]'
	);
};
