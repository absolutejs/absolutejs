import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { MobileConfig } from '../../../types/build';
import { writeAbsoluteCapacitorConfig } from '../../mobile/capacitorProject';
import { normalizeAbsoluteMobileConfig } from '../../mobile/config';
import { applyAbsoluteNativeDeepLinks } from '../../mobile/nativeDeepLinks';
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
import { inspectAbsoluteMobileRelease } from '../../mobile/releaseDoctor';
import { buildAbsoluteAndroidRelease } from '../../mobile/androidRelease';
import {
	loadAbsoluteNativeReleasePublisher,
	publishAbsoluteAndroidRelease
} from '../../mobile/releasePublisher';
import { start } from './start';
import { DEFAULT_SERVER_ENTRY } from '../utils';
import { getDurationString } from '../../utils/getDurationString';

const NOT_FOUND = -1;

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

const CAPACITOR_PACKAGES = [
	'@capacitor/core',
	'@capacitor/app',
	'@capacitor/cli',
	'@capacitor/android',
	'@capacitor/ios'
];

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

const loadMobile = async (configPath: string | undefined) => {
	const projectRoot = process.cwd();
	const config = await loadConfig(configPath);
	const mobile = normalizeAbsoluteMobileConfig(
		requireMobileConfig(config.mobile),
		projectRoot
	);

	return { mobile, projectRoot };
};

const initialize = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
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
};

const sync = async (args: string[]) => {
	const { mobile, projectRoot } = await loadMobile(
		valueAfter(args, '--config')
	);
	const platform = args.find(
		(value) => value === 'android' || value === 'ios'
	);
	const platforms = platform ? [platform] : mobile.platforms;
	await runCapacitorForPlatforms(projectRoot, 'sync', platforms);
	await applyAbsoluteNativeDeepLinks(mobile, platforms);
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
	const result = await inspectAbsoluteMobileRelease(mobile, projectRoot);
	if (args.includes('--json')) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		result.checks.forEach((check) => {
			console.log(
				`${doctorMark(check.status)} ${check.detail}${check.path ? ` (${check.path})` : ''}`
			);
			if (check.remediation) console.log(`  ${check.remediation}`);
		});
		console.log(
			result.ready
				? '\nMobile release transport checks passed.'
				: '\nMobile release transport checks failed.'
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
		'--registry',
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

const buildAndroid = async (args: string[]) => {
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
		await repairAbsoluteAndroidDevSession(projectRoot);
		await start(
			mobileBuildServerEntry(args),
			valueAfter(args, '--web-outdir'),
			configPath,
			{ prepareOnly: true }
		);
		await writeAbsoluteCapacitorConfig(mobile, { projectRoot });
		await runCapacitorForPlatforms(projectRoot, 'sync', ['android']);
		await applyAbsoluteNativeDeepLinks(mobile, ['android']);
		await requireAndroidReleaseReady(mobile, projectRoot);
		const release = await buildAbsoluteAndroidRelease({
			allowUnsigned: args.includes('--unsigned'),
			config: mobile,
			outputDirectory: valueAfter(args, '--outdir'),
			projectRoot
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
			engine: 'capacitor',
			platform: 'android',
			success,
			type: 'aab',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const publishAndroid = async (args: string[]) => {
	const registryModule = args.includes('--registry')
		? requireValueAfter(args, '--registry')
		: 'mobile.release.ts';
	const channel = args.includes('--channel')
		? requireValueAfter(args, '--channel')
		: undefined;
	const configPath = valueAfter(args, '--config');
	const { projectRoot } = await loadMobile(configPath);
	const startedAt = performance.now();
	let reused = false;
	let success = false;
	try {
		await loadAbsoluteNativeReleasePublisher(projectRoot, registryModule);
		const release = await buildAndroid(args);
		const publication = await publishAbsoluteAndroidRelease({
			allowUnsigned: args.includes('--unsigned'),
			channel,
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

		return publication;
	} finally {
		sendTelemetryEvent('mobile:android-release-publish', {
			durationMs: Math.round(performance.now() - startedAt),
			engine: 'capacitor',
			platform: 'android',
			provider: 'registry-module',
			reused,
			success,
			type: 'aab',
			unsignedAllowed: args.includes('--unsigned')
		});
	}
};

const doctor = async (args: string[]) => {
	if (args.includes('release')) {
		await runReleaseDoctor(args);

		return;
	}
	const checks = await inspectAbsoluteMobileToolchain();
	const platform = args.find(
		(value) => value === 'android' || value === 'ios'
	);
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
	const artifactRoot = safeArtifactRoot(
		projectRoot,
		valueAfter(args, '--artifacts')
	);
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
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Failure diagnostics: ${diagnosticPath}${screenshot ? `; screenshot: ${screenshot}` : ''}`,
			{ cause: error }
		);
	} finally {
		await session?.close();
	}
};

export const runMobile = async (args: string[]) => {
	const [command] = args;
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
	if (command === 'doctor') {
		await doctor(args.slice(1));

		return;
	}
	if (command === 'test' && args[1] === 'android') {
		await testAndroid(args.slice(2));

		return;
	}
	if (command === 'build' && args[1] === 'android') {
		await buildAndroid(args.slice(2));

		return;
	}
	if (command === 'publish' && args[1] === 'android') {
		await publishAndroid(args.slice(2));

		return;
	}

	throw new TypeError(
		'Usage: absolute mobile <init [--no-native] [--force] | sync [ios|android] | associations [--outdir dir] [--verify] | doctor [ios|android|release] [--json|--fix [--yes]] | build android [server-entry] [--outdir dir] [--web-outdir dir] [--unsigned] | publish android [server-entry] [--registry module] [--channel name] [--outdir dir] [--web-outdir dir] [--unsigned] | test android [--route path] [--wait-for-hmr] [--timeout ms] [--port n] [--serial id] [--artifacts dir] [--json]> [--config path]'
	);
};
