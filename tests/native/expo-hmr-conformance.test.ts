import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { findFreePort } from '../../src/cli/utils';
import {
	inspectAbsoluteAndroidRoute,
	waitForAbsoluteAndroidHmrApply,
	type AbsoluteAndroidHmrApply
} from '../../src/mobile/androidConformance';
import {
	attachAbsoluteAndroidWebView,
	type AbsoluteAndroidWebViewSession
} from '../../src/mobile/androidWebView';
import {
	absoluteAndroidNodeLabel,
	absoluteAndroidTouchTargetDp,
	absolutePercentile,
	absolutePssMiB,
	DEFAULT_ABSOLUTE_EXPO_ANDROID_QUALITY_BUDGETS,
	parseAbsoluteAndroidAccessibilityHierarchy,
	parseAbsoluteExpoAndroidLaunchTiming,
	parseAbsoluteExpoAndroidMemory,
	type AbsoluteAndroidAccessibilityNode,
	type AbsoluteExpoAndroidLaunchTiming,
	type AbsoluteExpoAndroidMemory
} from '../../src/mobile/expoAndroidQuality';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	parseBootedAbsoluteExpoIosSimulators,
	startAbsoluteExpoDevSession,
	type AbsoluteExpoDevPhaseTiming,
	type AbsoluteExpoDevSession
} from '../../src/mobile/expoDevController';
import { createAbsoluteExpoNativeWatcher } from '../../src/mobile/expoNativeWatcher';
import { writeAbsoluteExpoProject } from '../../src/mobile/expoProject';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../src/mobile/emulatorDoctor';
import { startDevServer, type DevServer } from '../helpers/devServer';
import { mutateFile, restoreAllFiles, restoreFile } from '../helpers/file';

type Platform = 'android' | 'ios';
type NativeReport = { marker: string; stateToken: string };
type HmrProof = {
	durationMs?: number;
	kind: string;
	outcome: string;
	serverMs?: number;
};
type WebAccessibilityProof = {
	buttonFocused: boolean;
	buttonHeight: number;
	buttonLabelled: boolean;
	buttonWidth: number;
	headingPresent: boolean;
};

const PLATFORM = process.env.ABSOLUTE_TEST_NATIVE_EXPO_HMR_PLATFORM as
	| Platform
	| undefined;
const REUSE_ANDROID_INSTALL =
	process.env.ABSOLUTE_TEST_NATIVE_EXPO_HMR_REUSE_INSTALL === '1';
const QUALITY_ENABLED =
	process.env.ABSOLUTE_TEST_NATIVE_EXPO_ANDROID_QUALITY === '1';
const describeNative = PLATFORM ? describe : describe.skip;
const qualityTest =
	PLATFORM === 'android' && QUALITY_ENABLED ? test : test.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(PROJECT_ROOT, 'tests/fixtures/expo-hmr');
const NATIVE_PROJECT = resolve(FIXTURE_ROOT, '.absolutejs/native');
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/expo-hmr-conformance/artifacts'
);
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const NATIVE_ROUTE = resolve(
	PROJECT_ROOT,
	'tests/fixtures/expo-hmr/NativeRoute.tsx'
);
const APP_ID = 'com.absolutejs.expohmracceptance';
const SCHEME = 'absolute-expo-hmr';
const TIMEOUT_MS = 120_000;
const ANDROID_LAUNCH_MEASUREMENT_ATTEMPTS = 3;

let server: DevServer | undefined;
let relay: ReturnType<typeof Bun.serve> | undefined;
let expo: AbsoluteExpoDevSession | undefined;
let webview: AbsoluteAndroidWebViewSession | undefined;
let adb: string | undefined;
let androidSerial: string | undefined;
let iosUdid: string | undefined;
let originalReportOrigin: string | undefined;
const reports: NativeReport[] = [];
const phaseTimings: AbsoluteExpoDevPhaseTiming[] = [];
const hmrProofs: HmrProof[] = [];
let coldLaunchTiming: AbsoluteExpoAndroidLaunchTiming | undefined;
let initialMemory: AbsoluteExpoAndroidMemory | undefined;
let finalMemory: AbsoluteExpoAndroidMemory | undefined;
let nativeAccessibilityNodes: AbsoluteAndroidAccessibilityNode[] = [];
let webAccessibilityNodes: AbsoluteAndroidAccessibilityNode[] = [];
let webAccessibilityProof: WebAccessibilityProof | undefined;
let bridgeDurations: number[] = [];

const run = (executable: string, ...args: string[]) => {
	const result = Bun.spawnSync([executable, ...args], {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	if (result.exitCode !== 0)
		throw new Error(
			`${executable} ${args.join(' ')} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`
		);

	return result.stdout.toString().trim();
};

const androidMemory = (androidAdb: string, serial: string) =>
	parseAbsoluteExpoAndroidMemory(
		run(androidAdb, '-s', serial, 'shell', 'dumpsys', 'meminfo', APP_ID)
	);

const androidDensity = (androidAdb: string, serial: string) => {
	const values = [
		...run(androidAdb, '-s', serial, 'shell', 'wm', 'density').matchAll(
			/density:\s*(\d+)/giu
		)
	];
	const densityDpi = Number(values.at(-1)?.[1]);
	if (!Number.isFinite(densityDpi) || densityDpi <= 0)
		throw new Error('Android emulator did not report a display density.');

	return densityDpi / 160;
};

const androidAccessibilityNodes = (
	androidAdb: string,
	serial: string,
	name: string
) => {
	const path = `/sdcard/absolutejs-${name}-${Date.now()}-accessibility.xml`;
	Bun.spawnSync(
		[
			androidAdb,
			'-s',
			serial,
			'shell',
			'uiautomator',
			'dump',
			'--compressed',
			path
		],
		{ stderr: 'pipe', stdout: 'pipe' }
	);

	return parseAbsoluteAndroidAccessibilityHierarchy(
		run(androidAdb, '-s', serial, 'shell', 'cat', path)
	);
};

const tapAndroidNode = (
	androidAdb: string,
	serial: string,
	node: AbsoluteAndroidAccessibilityNode
) =>
	run(
		androidAdb,
		'-s',
		serial,
		'shell',
		'input',
		'tap',
		String(Math.round((node.bounds.left + node.bounds.right) / 2)),
		String(Math.round((node.bounds.top + node.bounds.bottom) / 2))
	);

const measureAndroidLaunch = async (
	androidAdb: string,
	serial: string,
	metroPort: number,
	forceStop: boolean
) => {
	let lastError: unknown;
	for (
		let attempt = 0;
		attempt < ANDROID_LAUNCH_MEASUREMENT_ATTEMPTS;
		attempt += 1
	) {
		if (forceStop)
			run(androidAdb, '-s', serial, 'shell', 'am', 'force-stop', APP_ID);
		try {
			return parseAbsoluteExpoAndroidLaunchTiming(
				run(
					androidAdb,
					'-s',
					serial,
					'shell',
					'am',
					'start',
					'-W',
					'-a',
					'android.intent.action.VIEW',
					'-d',
					developmentUrl(metroPort),
					APP_ID
				)
			);
		} catch (error) {
			lastError = error;
			await Bun.sleep(1_000);
		}
	}

	throw lastError;
};

const restartWslManagedEmulator = async (androidAdb: string) => {
	const stopScript = [
		"$ErrorActionPreference = 'SilentlyContinue'",
		"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'qemu-system-x86_64.exe' -and $_.CommandLine -match 'AbsoluteJS_API_36' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
		'Get-Process adb | Stop-Process -Force',
		'exit 0'
	].join('; ');
	run('powershell.exe', '-NoProfile', '-Command', stopScript);
	await Bun.sleep(2_000);
	const emulator = resolve(
		dirname(dirname(androidAdb)),
		'emulator',
		'emulator.exe'
	);
	const child = Bun.spawn(
		[emulator, '-avd', 'AbsoluteJS_API_36', '-no-snapshot-save'],
		{ stderr: 'ignore', stdout: 'ignore' }
	);
	child.unref();
	await Bun.sleep(8_000);
	await waitFor(() => {
		try {
			return run(androidAdb, 'devices').includes('emulator-5554\tdevice')
				? true
				: undefined;
		} catch {
			return undefined;
		}
	}, 'Managed Android emulator did not connect to adb.');
	await waitFor(() => {
		try {
			return run(
				androidAdb,
				'-s',
				'emulator-5554',
				'shell',
				'getprop',
				'sys.boot_completed'
			) === '1'
				? true
				: undefined;
		} catch {
			return undefined;
		}
	}, 'Managed Android emulator did not boot.');
};

const waitFor = async <T>(
	read: () => T | Promise<T | undefined> | undefined,
	message: string
) => {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== undefined) return value;
		await Bun.sleep(200);
	}
	throw new Error(message);
};

const developmentUrl = (metroPort: number) =>
	`exp+${APP_ID.replaceAll('.', '-')}://expo-development-client/?url=${encodeURIComponent(`http://localhost:${metroPort}`)}`;

const waitForTarget = async (target: 'expo-android' | 'expo-ios') => {
	if (!server) throw new Error('AbsoluteJS dev server is unavailable.');
	const currentServer = server;
	await waitFor(async () => {
		const response = await fetch(
			`${currentServer.baseUrl}/hmr-status`
		).catch(() => undefined);
		if (!response?.ok) return undefined;
		const status = (await response.json()) as {
			connectedTargets?: Record<string, number>;
		};

		return Number(status.connectedTargets?.[target]) > 0 ? true : undefined;
	}, `${target} did not connect to AbsoluteJS HMR.`);
};

const attachAndroidRoute = async (route: string) => {
	if (!adb || !androidSerial || !server)
		throw new Error('Expo Android WebView target is unavailable.');
	const androidAdb = adb;
	const serial = androidSerial;
	const currentServer = server;

	return waitFor(async () => {
		let candidate: AbsoluteAndroidWebViewSession | undefined;
		try {
			candidate = await attachAbsoluteAndroidWebView({
				adb: androidAdb,
				appId: APP_ID,
				serial,
				timeoutMs: 10_000
			});
			await inspectAbsoluteAndroidRoute(candidate, {
				navigation: 'none',
				port: currentServer.port,
				route,
				target: 'expo-android',
				timeoutMs: 5_000
			});

			return candidate;
		} catch {
			await candidate?.close().catch(() => undefined);

			return undefined;
		}
	}, `Expo Android native route ${route} did not expose a stable WebView.`);
};

const waitForExpoHmr = async (start: number, kind: string, record = true) => {
	if (!server) throw new Error('AbsoluteJS dev server is unavailable.');
	const target = `expo-${PLATFORM}`;
	const line = await waitFor(
		() =>
			server?.outputLines
				.slice(start)
				.find(
					(value) =>
						(value.includes(`[hmr:${target}]`) ||
							value.includes(`[ng-hmr:${target}]`)) &&
						value.includes(kind) &&
						/(applied in|falling back to reload after)/u.test(value)
				),
		`Expo ${PLATFORM} did not acknowledge ${kind} HMR.`
	);
	const match =
		/(applied in|falling back to reload after) (\d+)ms(?:; server (\d+)ms)/u.exec(
			line
		);
	if (record)
		hmrProofs.push({
			durationMs: Number(match?.[2]),
			kind,
			outcome: match?.[1] === 'applied in' ? 'applied' : 'reloaded',
			serverMs: match?.[3] ? Number(match[3]) : undefined
		});
};

const embeddedCases = [
	{
		file: 'example/angular/templates/counter.component.html',
		from: 'count is',
		kind: 'component',
		name: 'angular',
		path: '/angular',
		to: 'expo tally is'
	},
	{
		file: 'example/react/components/App.tsx',
		from: 'AbsoluteJS + React',
		kind: 'component',
		name: 'react',
		path: '/react',
		to: 'AbsoluteJS + React Expo HMR'
	},
	{
		file: 'example/vue/components/CountButton.vue',
		from: '</button>',
		kind: 'component',
		name: 'vue',
		path: '/vue',
		to: '</button><span>VUE_EXPO_HMR</span>'
	},
	{
		file: 'example/svelte/components/Counter.svelte',
		from: '</button>',
		kind: 'component',
		name: 'svelte',
		path: '/svelte',
		to: '</button><span>SVELTE_EXPO_HMR</span>'
	},
	{
		file: 'example/html/pages/HTMLExample.html',
		from: 'AbsoluteJS + HTML</h1>',
		kind: 'html',
		name: 'html',
		path: '/html',
		to: 'AbsoluteJS + HTML Expo HMR</h1>'
	},
	{
		file: 'example/htmx/pages/HTMXExample.html',
		from: 'AbsoluteJS + HTMX</h1>',
		kind: 'htmx',
		name: 'htmx',
		path: '/htmx',
		to: 'AbsoluteJS + HTMX Expo HMR</h1>'
	},
	{
		file: 'example/styles/indexes/react-example.css',
		from: '',
		kind: 'css',
		name: 'css',
		path: '/react',
		to: '/* expo-native-css-hmr */\n'
	}
] as const;

afterAll(async () => {
	restoreAllFiles();
	await webview?.close().catch(() => undefined);
	await expo?.close().catch(() => undefined);
	await server?.kill().catch(() => undefined);
	relay?.stop(true);
	if (originalReportOrigin === undefined)
		delete process.env.EXPO_PUBLIC_ABSOLUTE_HMR_REPORT_ORIGIN;
	else
		process.env.EXPO_PUBLIC_ABSOLUTE_HMR_REPORT_ORIGIN =
			originalReportOrigin;
});

describeNative(`real Expo ${PLATFORM ?? 'native'} HMR conformance`, () => {
	test('proves native Fast Refresh, embedded HMR, reconnect, rebuild, and sanitized timings', async () => {
		if (PLATFORM !== 'android' && PLATFORM !== 'ios')
			throw new Error('Select android or ios Expo HMR conformance.');
		// An interrupted acceptance run can leave the tracked Fast Refresh
		// marker at v2. Normalize the fixture before generation so the next run
		// remains deterministic even after a killed terminal or sleeping host.
		const nativeRouteSource = await readFile(NATIVE_ROUTE, 'utf8');
		await writeFile(
			NATIVE_ROUTE,
			nativeRouteSource
				.replace(
					'expo-native-fast-refresh-v2',
					'expo-native-fast-refresh-v1'
				)
				.replace(
					/<AbsoluteWebHost path="[^"]+" \/>/u,
					'<AbsoluteWebHost />'
				)
		);
		for (const item of embeddedCases) {
			const itemPath = resolve(PROJECT_ROOT, item.file);
			const source = await readFile(itemPath, 'utf8');
			await writeFile(itemPath, source.replace(item.to, item.from));
		}
		const relayPort = await findFreePort();
		const metroPort = await findFreePort();
		relay = Bun.serve({
			port: relayPort,
			fetch: async (request) => {
				const url = new URL(request.url);
				if (
					request.method === 'POST' &&
					url.pathname === '/native-report'
				) {
					reports.push((await request.json()) as NativeReport);

					return new Response(null, { status: 204 });
				}

				return new Response('Not found', { status: 404 });
			}
		});
		originalReportOrigin =
			process.env.EXPO_PUBLIC_ABSOLUTE_HMR_REPORT_ORIGIN;
		process.env.EXPO_PUBLIC_ABSOLUTE_HMR_REPORT_ORIGIN = `http://localhost:${relayPort}`;
		server = await startDevServer({ configPath: CONFIG_PATH });
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: APP_ID,
				appName: 'AbsoluteJS Expo HMR Acceptance',
				deepLinks: { scheme: SCHEME },
				engine: 'expo',
				nativeProject: { directory: '.absolutejs/native' },
				platforms: [PLATFORM],
				routes: { native: { '/': NATIVE_ROUTE } },
				server: { productionOrigin: 'https://example.invalid' }
			},
			FIXTURE_ROOT
		);
		await writeAbsoluteExpoProject(config, {
			force: true,
			projectRoot: FIXTURE_ROOT
		});
		if (!REUSE_ANDROID_INSTALL) {
			const install = Bun.spawn(['bun', 'install'], {
				cwd: NATIVE_PROJECT,
				stderr: 'inherit',
				stdout: 'inherit'
			});
			expect(await install.exited).toBe(0);
		}

		const host = detectAbsoluteMobileHost();
		const checks = await inspectAbsoluteMobileToolchain({ host });
		if (PLATFORM === 'android') {
			adb = checks.find(({ id }) => id === 'android.adb')?.path;
			if (!adb)
				throw new Error('Expo HMR acceptance requires Android adb.');
			if (host === 'wsl') await restartWslManagedEmulator(adb);
		} else if (host !== 'macos') {
			throw new Error('Expo iOS HMR acceptance must run on macOS.');
		}
		expo = await startAbsoluteExpoDevSession({
			androidOrigin: `http://localhost:${server.port}`,
			config,
			host,
			iosOrigin: `http://localhost:${server.port}`,
			metroPort,
			platforms:
				REUSE_ANDROID_INSTALL && PLATFORM === 'android'
					? []
					: [PLATFORM],
			log: (line) => console.log(`[expo-hmr] ${line}`),
			onPhaseTiming: (timing) => phaseTimings.push(timing)
		});
		if (PLATFORM === 'android') {
			const androidAdb = adb;
			if (!androidAdb)
				throw new Error('Expo HMR acceptance requires Android adb.');
			androidSerial = run(androidAdb, 'devices')
				.split(/\r?\n/u)
				.map((line) => /^(\S+)\s+device$/u.exec(line)?.[1])
				.find((value) => value?.startsWith('emulator-'));
			if (!androidSerial)
				throw new Error(
					'Expo HMR acceptance requires a running emulator.'
				);
			for (const port of [metroPort, relayPort, server.port])
				run(
					androidAdb,
					'-s',
					androidSerial,
					'reverse',
					`tcp:${port}`,
					`tcp:${port}`
				);
			if (QUALITY_ENABLED)
				coldLaunchTiming = await measureAndroidLaunch(
					androidAdb,
					androidSerial,
					metroPort,
					true
				);
			else {
				run(
					androidAdb,
					'-s',
					androidSerial,
					'shell',
					'am',
					'force-stop',
					APP_ID
				);
				run(
					androidAdb,
					'-s',
					androidSerial,
					'shell',
					'am',
					'start',
					'-a',
					'android.intent.action.VIEW',
					'-d',
					developmentUrl(metroPort),
					APP_ID
				);
			}
		} else {
			const [bootedUdid] = parseBootedAbsoluteExpoIosSimulators(
				run('xcrun', 'simctl', 'list', 'devices', 'booted', '--json')
			);
			iosUdid = bootedUdid;
			if (!iosUdid)
				throw new Error(
					'Expo HMR acceptance requires a booted simulator.'
				);
		}

		const first = await waitFor(
			() => reports.find((report) => report.marker.endsWith('-v1')),
			'Expo native route did not report its initial render.'
		);
		if (PLATFORM === 'android' && QUALITY_ENABLED) {
			if (!adb || !androidSerial)
				throw new Error('Expo Android quality target is unavailable.');
			const qualityAdb = adb;
			const qualitySerial = androidSerial;
			nativeAccessibilityNodes = await waitFor(() => {
				const nodes = androidAccessibilityNodes(
					qualityAdb,
					qualitySerial,
					'native'
				);
				const waitAction = nodes.find(
					(node) =>
						node.packageName === 'android' &&
						node.resourceId === 'android:id/aerr_wait' &&
						node.clickable
				);
				if (waitAction) {
					tapAndroidNode(qualityAdb, qualitySerial, waitAction);

					return undefined;
				}
				const expoContinue = nodes.find(
					(node) =>
						node.packageName === APP_ID && node.text === 'Continue'
				);
				if (expoContinue) {
					tapAndroidNode(qualityAdb, qualitySerial, expoContinue);

					return undefined;
				}
				if (
					nodes.some(
						(node) =>
							node.packageName === APP_ID &&
							node.text === 'Toggle performance monitor'
					)
				) {
					run(
						qualityAdb,
						'-s',
						qualitySerial,
						'shell',
						'input',
						'keyevent',
						'KEYCODE_BACK'
					);

					return undefined;
				}

				return nodes.some((node) =>
					absoluteAndroidNodeLabel(node).includes(
						'AbsoluteJS quality action'
					)
				)
					? nodes
					: undefined;
			}, 'Android accessibility did not expose the labelled native action.');
			initialMemory = androidMemory(qualityAdb, qualitySerial);
		}
		mutateFile(NATIVE_ROUTE, (source) =>
			source.replace(
				'expo-native-fast-refresh-v1',
				'expo-native-fast-refresh-v2'
			)
		);
		const refreshed = await waitFor(
			() => reports.find((report) => report.marker.endsWith('-v2')),
			'Expo native React Fast Refresh was not observed.'
		);
		expect(refreshed.stateToken).toBe(first.stateToken);
		if (PLATFORM === 'android') {
			if (!adb || !androidSerial)
				throw new Error('Expo Android WebView target is unavailable.');
			webview = await attachAbsoluteAndroidWebView({
				adb,
				appId: APP_ID,
				serial: androidSerial,
				timeoutMs: TIMEOUT_MS
			});
		} else await waitForTarget('expo-ios');

		for (const item of embeddedCases) {
			console.log(`[expo-hmr] checking ${item.name}`);
			if (webview) await webview.close().catch(() => undefined);
			const nativeSource = await readFile(NATIVE_ROUTE, 'utf8');
			await writeFile(
				NATIVE_ROUTE,
				nativeSource.replace(
					/<AbsoluteWebHost(?: path="[^"]+")? \/>/u,
					`<AbsoluteWebHost path=${JSON.stringify(item.path)} />`
				)
			);
			let baseline: number | undefined;
			if (webview) {
				webview = await attachAndroidRoute(item.path);
				await inspectAbsoluteAndroidRoute(webview, {
					navigation: 'none',
					port: server.port,
					route: item.path,
					target: 'expo-android',
					timeoutMs: TIMEOUT_MS
				});
				await server.waitForIdle({ timeoutMs: 30_000 });
				baseline = await webview.evaluate<number | undefined>(
					'window.__ABS_HMR_LAST_APPLY__?.updateId'
				);
			} else {
				await Bun.sleep(500);
				await waitForTarget('expo-ios');
				await server.waitForIdle({ timeoutMs: 30_000 });
			}
			const outputStart = server.outputLines.length;
			const itemPath = resolve(PROJECT_ROOT, item.file);
			const originalItem = await readFile(itemPath, 'utf8');
			if (!originalItem.includes(item.from))
				throw new Error(`${item.name} HMR fixture marker is missing.`);
			mutateFile(itemPath, (source) =>
				source.replace(item.from, item.to)
			);
			let changedApply: AbsoluteAndroidHmrApply | undefined;
			let restoreOutputStart: number | undefined;
			try {
				if (webview && item.kind !== 'html' && item.kind !== 'htmx') {
					try {
						changedApply = await waitForAbsoluteAndroidHmrApply(
							webview,
							{
								afterUpdateId: baseline,
								kind: item.kind,
								target: 'expo-android',
								timeoutMs: 30_000
							}
						);
					} catch {
						console.log(
							`[expo-hmr] retrying ${item.name} after a missed client apply`
						);
						restoreFile(itemPath);
						await server.waitForIdle({ timeoutMs: 30_000 });
						await webview.close().catch(() => undefined);
						webview = await attachAndroidRoute(item.path);
						baseline = await webview.evaluate<number | undefined>(
							'window.__ABS_HMR_LAST_APPLY__?.updateId'
						);
						mutateFile(itemPath, (source) =>
							source.replace(item.from, item.to)
						);
						changedApply = await waitForAbsoluteAndroidHmrApply(
							webview,
							{
								afterUpdateId: baseline,
								kind: item.kind,
								target: 'expo-android',
								timeoutMs: TIMEOUT_MS
							}
						);
					}
					hmrProofs.push({
						durationMs: changedApply.duration,
						kind: item.kind,
						outcome: changedApply.outcome,
						serverMs: changedApply.serverMs
					});
					expect(changedApply.target).toBe('expo-android');
				} else await waitForExpoHmr(outputStart, item.kind);
			} finally {
				restoreOutputStart = server.outputLines.length;
				restoreFile(itemPath);
			}
			await server.waitForIdle({ timeoutMs: 30_000 });
			// Let the client finish applying the restoration before navigating to
			// the next framework. Otherwise sessionStorage can retain an active HMR
			// transaction across navigation and suppress the next update.
			if (webview && item.kind !== 'html' && item.kind !== 'htmx') {
				try {
					await waitForAbsoluteAndroidHmrApply(webview, {
						afterUpdateId: changedApply?.updateId,
						kind: item.kind,
						target: 'expo-android',
						timeoutMs: 30_000
					});
				} catch {
					console.log(
						`[expo-hmr] reattaching ${item.name} after a missed restoration apply`
					);
					await webview.close().catch(() => undefined);
					webview = await attachAndroidRoute(item.path);
				}
			} else
				await waitForExpoHmr(
					restoreOutputStart ?? outputStart,
					item.kind,
					false
				);
			console.log(`[expo-hmr] ${item.name} applied and restored`);
			if (webview && QUALITY_ENABLED && item.name === 'react') {
				if (!adb || !androidSerial)
					throw new Error(
						'Expo Android quality target is unavailable.'
					);
				webAccessibilityNodes = androidAccessibilityNodes(
					adb,
					androidSerial,
					'web'
				);
				webAccessibilityProof =
					await webview.evaluate<WebAccessibilityProof>(`(() => {
	const heading = document.querySelector('h1');
	const button = document.querySelector('button');
	if (!(button instanceof HTMLElement)) return { buttonFocused: false, buttonHeight: 0, buttonLabelled: false, buttonWidth: 0, headingPresent: false };
	button.focus();
	const bounds = button.getBoundingClientRect();
	return {
		buttonFocused: document.activeElement === button,
		buttonHeight: bounds.height,
		buttonLabelled: (button.getAttribute('aria-label') || button.innerText || '').trim().length > 0,
		buttonWidth: bounds.width,
		headingPresent: heading?.textContent?.includes('AbsoluteJS + React') === true
	};
})()`);
				bridgeDurations = await webview.evaluate<
					number[]
				>(`(async () => {
	const durations = [];
	for (let index = 0; index < 20; index += 1) {
		const startedAt = performance.now();
		await globalThis.__absoluteExpoBridge.request('devices.platform.getInfo', {});
		durations.push(performance.now() - startedAt);
	}
	return durations;
})()`);
			}
		}

		const reportsBeforeReturn = reports.length;
		restoreAllFiles();
		await waitFor(
			() =>
				reports.length > reportsBeforeReturn &&
				reports.at(-1)?.marker.endsWith('-v1')
					? reports.at(-1)
					: undefined,
			'Expo native route did not return before native rebuild proof.'
		);
		const nativeReportsBeforeRebuild = reports.length;
		let rebuilt = false;
		const activeExpo = expo;
		if (!activeExpo)
			throw new Error('Expo development session is unavailable.');
		const watcher = await createAbsoluteExpoNativeWatcher({
			debounceMs: 50,
			expoProjectDirectory: NATIVE_PROJECT,
			projectRoot: FIXTURE_ROOT,
			onChange: async () => {
				expo = await activeExpo.rebuild();
				rebuilt = true;
			}
		});
		mutateFile(
			resolve(NATIVE_PROJECT, 'plugins/withAbsoluteDevelopmentCa.js'),
			(source) => `${source}\n// expo-hmr-native-rebuild-proof\n`
		);
		await waitFor(
			() => (rebuilt ? true : undefined),
			'Expo native watcher did not complete a rebuild.'
		);
		watcher.close();
		expect(expo.metroPort).toBe(metroPort);
		if (
			REUSE_ANDROID_INSTALL &&
			PLATFORM === 'android' &&
			adb &&
			androidSerial
		)
			run(
				adb,
				'-s',
				androidSerial,
				'shell',
				'am',
				'start',
				'-a',
				'android.intent.action.VIEW',
				'-d',
				developmentUrl(metroPort),
				APP_ID
			);
		await waitFor(
			() =>
				reports.length > nativeReportsBeforeRebuild
					? reports.at(-1)
					: undefined,
			'Expo app did not reconnect after its native rebuild.'
		);
		if (PLATFORM === 'android' && QUALITY_ENABLED) {
			if (!adb || !androidSerial)
				throw new Error('Expo Android quality target is unavailable.');
			finalMemory = androidMemory(adb, androidSerial);
		}

		await mkdir(ARTIFACT_ROOT, { recursive: true });
		await writeFile(
			resolve(ARTIFACT_ROOT, `${PLATFORM}-hmr-summary.json`),
			JSON.stringify(
				{
					embeddedHmr: hmrProofs,
					nativeFastRefresh: {
						statePreserved:
							refreshed.stateToken === first.stateToken
					},
					nativeRebuild: {
						completed: rebuilt,
						metroPreserved: expo.metroPort === metroPort
					},
					phaseTimings: phaseTimings.map(({ durationMs, phase }) => ({
						durationMs: Math.round(durationMs),
						phase
					})),
					platform: PLATFORM,
					reconnected: reports.length > nativeReportsBeforeRebuild
				},
				null,
				2
			)
		);
	}, 1_200_000);

	qualityTest(
		'enforces Android performance and accessibility budgets',
		async () => {
			if (
				!adb ||
				!androidSerial ||
				!expo ||
				!coldLaunchTiming ||
				!initialMemory ||
				!finalMemory ||
				!webAccessibilityProof
			)
				throw new Error(
					'Expo Android quality measurements are incomplete.'
				);
			const budgets = DEFAULT_ABSOLUTE_EXPO_ANDROID_QUALITY_BUDGETS;
			const density = androidDensity(adb, androidSerial);
			const nativeAction = nativeAccessibilityNodes.find((node) =>
				absoluteAndroidNodeLabel(node).includes(
					'AbsoluteJS quality action'
				)
			);
			if (!nativeAction)
				throw new Error(
					'Android accessibility did not expose the labelled native action.'
				);
			const nativeTouchTarget = absoluteAndroidTouchTargetDp(
				nativeAction,
				density
			);
			const hmrDurations = hmrProofs
				.map(({ durationMs }) => durationMs)
				.filter((value): value is number => Number.isFinite(value));
			if (hmrDurations.length !== embeddedCases.length)
				throw new Error(
					'Expo Android quality did not measure every HMR case.'
				);
			if (bridgeDurations.length !== 20)
				throw new Error(
					'Expo Android quality bridge samples are incomplete.'
				);
			const hmrP95Ms = absolutePercentile(hmrDurations, 0.95);
			const bridgeP95Ms = absolutePercentile(bridgeDurations, 0.95);
			const initialPssMiB = absolutePssMiB(initialMemory);
			const finalPssMiB = absolutePssMiB(finalMemory);
			const memoryGrowthMiB = finalPssMiB - initialPssMiB;
			const webViewExposed = webAccessibilityNodes.some((node) =>
				node.className.includes('WebView')
			);

			run(
				adb,
				'-s',
				androidSerial,
				'shell',
				'input',
				'keyevent',
				'KEYCODE_HOME'
			);
			const warmLaunch = await measureAndroidLaunch(
				adb,
				androidSerial,
				expo.metroPort,
				false
			);
			console.log(
				`[expo-quality] cold ${coldLaunchTiming.totalTimeMs}ms; warm ${warmLaunch.totalTimeMs}ms; HMR p95 ${Math.round(hmrP95Ms)}ms; bridge p95 ${Math.round(bridgeP95Ms)}ms; PSS ${Math.round(finalPssMiB)}MiB (${Math.round(memoryGrowthMiB)}MiB growth); native target ${Math.round(nativeTouchTarget.width)}x${Math.round(nativeTouchTarget.height)}dp; web target ${Math.round(webAccessibilityProof.buttonWidth)}x${Math.round(webAccessibilityProof.buttonHeight)}px`
			);

			expect(coldLaunchTiming.totalTimeMs).toBeLessThanOrEqual(
				budgets.coldLaunchMs
			);
			expect(warmLaunch.totalTimeMs).toBeLessThanOrEqual(
				budgets.warmLaunchMs
			);
			expect(hmrP95Ms).toBeLessThanOrEqual(budgets.hmrP95Ms);
			expect(bridgeP95Ms).toBeLessThanOrEqual(budgets.bridgeP95Ms);
			expect(finalPssMiB).toBeLessThanOrEqual(budgets.maxTotalPssMiB);
			expect(memoryGrowthMiB).toBeLessThanOrEqual(
				budgets.maxMemoryGrowthMiB
			);
			expect(nativeTouchTarget.height).toBeGreaterThanOrEqual(
				budgets.minTouchTargetDp
			);
			expect(nativeTouchTarget.width).toBeGreaterThanOrEqual(
				budgets.minTouchTargetDp
			);
			expect(nativeAction.clickable).toBe(true);
			expect(webViewExposed).toBe(true);
			expect(webAccessibilityProof).toMatchObject({
				buttonFocused: true,
				buttonLabelled: true,
				headingPresent: true
			});
			expect(webAccessibilityProof.buttonHeight).toBeGreaterThanOrEqual(
				budgets.minTouchTargetDp
			);
			expect(webAccessibilityProof.buttonWidth).toBeGreaterThanOrEqual(
				budgets.minTouchTargetDp
			);

			await mkdir(ARTIFACT_ROOT, { recursive: true });
			await writeFile(
				resolve(ARTIFACT_ROOT, 'android-quality-summary.json'),
				`${JSON.stringify(
					{
						accessibility: {
							nativeActionClickable: nativeAction.clickable,
							nativeActionLabelled:
								absoluteAndroidNodeLabel(nativeAction).length >
								0,
							nativeTouchTargetDp: {
								height: Math.round(nativeTouchTarget.height),
								width: Math.round(nativeTouchTarget.width)
							},
							webButtonFocused:
								webAccessibilityProof.buttonFocused,
							webButtonLabelled:
								webAccessibilityProof.buttonLabelled,
							webHeadingPresent:
								webAccessibilityProof.headingPresent,
							webTouchTargetCssPx: {
								height: Math.round(
									webAccessibilityProof.buttonHeight
								),
								width: Math.round(
									webAccessibilityProof.buttonWidth
								)
							},
							webViewExposed
						},
						bridge: {
							p95Ms: Math.round(bridgeP95Ms),
							samples: bridgeDurations.length
						},
						budgets,
						hmr: {
							p95Ms: Math.round(hmrP95Ms),
							samples: hmrDurations.length
						},
						launch: {
							coldMs: coldLaunchTiming.totalTimeMs,
							warmMs: warmLaunch.totalTimeMs
						},
						memory: {
							finalPssMiB: Math.round(finalPssMiB),
							growthMiB: Math.round(memoryGrowthMiB),
							initialPssMiB: Math.round(initialPssMiB)
						},
						platform: 'android'
					},
					null,
					2
				)}\n`
			);
		},
		120_000
	);
});
