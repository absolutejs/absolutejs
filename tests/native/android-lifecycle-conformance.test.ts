import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test
} from 'bun:test';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../fixtures/mobile-native-conformance/absolute.config';
import { startDevServer, type DevServer } from '../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../helpers/file';
import {
	prepareAbsoluteAndroidDevProject,
	startAbsoluteAndroidDevSession,
	type AbsoluteAndroidDevProject,
	type AbsoluteAndroidDevSession
} from '../../src/mobile/androidEmulatorController';
import {
	attachAbsoluteAndroidWebView,
	type AbsoluteAndroidWebViewSession
} from '../../src/mobile/androidWebView';
import { inspectAbsoluteAndroidRoute } from '../../src/mobile/androidConformance';
import { createAbsoluteAndroidNativeWatcher } from '../../src/mobile/androidNativeWatcher';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import { inspectAbsoluteMobileRelease } from '../../src/mobile/releaseDoctor';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_ANDROID === '1';
const NATIVE_TEST_PORT =
	Number(process.env.ABSOLUTE_NATIVE_LIFECYCLE_TEST_PORT) || 39_078;
const WARM_START_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_WARM_START_BUDGET_MS) || 30_000;
const COLD_START_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_COLD_START_BUDGET_MS) || 600_000;
const RECOVERY_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_RECOVERY_BUDGET_MS) || 45_000;
const NATIVE_REBUILD_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_REBUILD_BUDGET_MS) || 300_000;
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/lifecycle-artifacts'
);
const CAPACITOR_CONFIG_PATH = resolve(PROJECT_ROOT, 'capacitor.config.ts');

let server: DevServer;
let project: AbsoluteAndroidDevProject;
let android: AbsoluteAndroidDevSession | undefined;
let webview: AbsoluteAndroidWebViewSession | undefined;
let originalCapacitorConfig: string | undefined;

const mobileConfig = () => {
	if (!config.mobile) throw new Error('Native mobile fixture is invalid.');

	return normalizeAbsoluteMobileConfig(config.mobile, PROJECT_ROOT);
};

const attachWebView = async () => {
	if (!android) throw new Error('Android lifecycle session is not running.');
	webview = await attachAbsoluteAndroidWebView({
		adb: project.adb,
		appId: mobileConfig().appId,
		serial: android.serial,
		timeoutMs: 60_000
	});

	return webview;
};

const route = async (path: string) => {
	if (!webview) throw new Error('Android WebView is not attached.');

	return inspectAbsoluteAndroidRoute(webview, {
		port: server.port,
		route: path,
		timeoutMs: RECOVERY_BUDGET_MS
	});
};

const waitForServerIdle = async () => {
	const deadline = Date.now() + RECOVERY_BUDGET_MS;
	while (Date.now() < deadline) {
		const response = await fetch(`${server.baseUrl}/hmr-status`).catch(
			() => undefined
		);
		if (response?.ok) {
			const status: unknown = await response.json();
			if (
				typeof status === 'object' &&
				status !== null &&
				Reflect.get(status, 'isRebuilding') === false &&
				(Reflect.get(status, 'rebuildQueue')?.length ?? 0) === 0
			) {
				return;
			}
		}
		await Bun.sleep(100);
	}
	throw new Error('Android lifecycle dev server did not become idle.');
};

const withTimeout = async <T>(
	operation: Promise<T>,
	timeoutMs: number,
	message: string
) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

const nativeTest = (name: string, fn: () => Promise<void>) =>
	test(
		name,
		async () => {
			try {
				await fn();
			} catch (error) {
				await mkdir(ARTIFACT_ROOT, { recursive: true });
				const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-');
				await webview
					?.screenshot(resolve(ARTIFACT_ROOT, `${slug}.png`))
					.catch(() => undefined);
				throw error;
			}
		},
		600_000
	);

describeNative('real Capacitor Android lifecycle conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		server = await startDevServer({
			configPath: CONFIG_PATH,
			port: NATIVE_TEST_PORT
		});
		const mobile = mobileConfig();
		project = await prepareAbsoluteAndroidDevProject(mobile, {
			createNativeProject: true,
			projectRoot: PROJECT_ROOT
		});
		android = await startAbsoluteAndroidDevSession({
			port: server.port,
			project,
			log: (message) => console.log(`[native-lifecycle] ${message}`)
		});
		await attachWebView();
	}, 900_000);

	afterEach(async () => {
		restoreAllFiles();
		await waitForServerIdle();
	}, 60_000);

	afterAll(async () => {
		restoreAllFiles();
		await webview?.close().catch(() => undefined);
		await android?.close().catch(() => undefined);
		await server?.kill().catch(() => undefined);
		if (originalCapacitorConfig === undefined) {
			await unlink(CAPACITOR_CONFIG_PATH).catch(() => undefined);
		} else {
			await writeFile(CAPACITOR_CONFIG_PATH, originalCapacitorConfig);
		}
	}, 120_000);

	nativeTest('enforces startup and no-op native cache budgets', async () => {
		if (!android)
			throw new Error('Android lifecycle session is not running.');
		const startupBudget = android.nativeCacheHit
			? WARM_START_BUDGET_MS
			: COLD_START_BUDGET_MS;
		expect(android.timings.total).toBeLessThan(startupBudget);
		const serverPid = server.proc.pid;
		await webview?.close();
		webview = undefined;
		const replacement = await android.rebuild();
		android = replacement;
		expect(replacement.nativeCacheHit).toBe(true);
		expect(replacement.timings.building).toBeUndefined();
		expect(server.proc.pid).toBe(serverPid);
		await attachWebView();
		const check = await route('/react');
		expect(check.hmrConnected).toBe(true);
	});

	nativeTest('recovers after the dev server transport restarts', async () => {
		await route('/react');
		if (!webview) throw new Error('Android WebView is not attached.');
		const recoveryStartedAt = performance.now();
		await server.kill();
		await webview.waitFor<boolean>(
			`document.querySelector('[data-hmr-overlay="true"]') !== null`,
			{ timeoutMs: RECOVERY_BUDGET_MS }
		);
		server = await startDevServer({
			configPath: CONFIG_PATH,
			port: NATIVE_TEST_PORT
		});
		await webview.waitFor<boolean>(
			`window.__HMR_WS__?.readyState === WebSocket.OPEN`,
			{ timeoutMs: RECOVERY_BUDGET_MS }
		);
		expect(performance.now() - recoveryStartedAt).toBeLessThan(
			RECOVERY_BUDGET_MS
		);
		const check = await route('/react');
		expect(check.overlayVisible).toBe(false);
	});

	nativeTest(
		'recovers after Android kills the application process',
		async () => {
			await route('/react');
			if (!android)
				throw new Error('Android lifecycle session is not running.');
			const { appId } = mobileConfig();
			const oldPid = Bun.spawnSync([
				project.adb,
				'-s',
				android.serial,
				'shell',
				'pidof',
				appId
			])
				.stdout.toString()
				.trim();
			const stopped = Bun.spawnSync([
				project.adb,
				'-s',
				android.serial,
				'shell',
				'am',
				'force-stop',
				appId
			]);
			expect(stopped.exitCode).toBe(0);
			await webview?.close().catch(() => undefined);
			webview = undefined;
			const recoveryStartedAt = performance.now();
			await android.relaunch();
			await attachWebView();
			const check = await route('/react');
			const newPid = Bun.spawnSync([
				project.adb,
				'-s',
				android.serial,
				'shell',
				'pidof',
				appId
			])
				.stdout.toString()
				.trim();
			expect(check.hmrConnected).toBe(true);
			expect(newPid).not.toBe('');
			expect(newPid).not.toBe(oldPid);
			expect(performance.now() - recoveryStartedAt).toBeLessThan(
				RECOVERY_BUDGET_MS
			);
		}
	);

	nativeTest(
		'automatically rebuilds a native edit without restarting Bun',
		async () => {
			if (!android)
				throw new Error('Android lifecycle session is not running.');
			const serverPid = server.proc.pid;
			const current = android;
			await webview?.close();
			webview = undefined;
			let resolveRebuild:
				| ((session: AbsoluteAndroidDevSession) => void)
				| undefined;
			let rejectRebuild: ((error: unknown) => void) | undefined;
			const rebuilt = new Promise<AbsoluteAndroidDevSession>(
				(_resolve, reject) => {
					resolveRebuild = _resolve;
					rejectRebuild = reject;
				}
			);
			const watcher = await createAbsoluteAndroidNativeWatcher({
				project,
				onChange: async () => {
					resolveRebuild?.(await current.rebuild());
				},
				onError: (error) => rejectRebuild?.(error)
			});
			const mainActivity = resolve(
				project.nativeDirectory,
				'app/src/main/java',
				...mobileConfig().appId.split('.'),
				'MainActivity.java'
			);
			const rebuildStartedAt = performance.now();
			mutateFile(mainActivity, (source) =>
				source.replace(
					/\}\s*$/u,
					'\t// AbsoluteJS native lifecycle conformance\n}\n'
				)
			);
			android = await withTimeout(
				rebuilt,
				NATIVE_REBUILD_BUDGET_MS,
				'Native watcher did not rebuild and reinstall the Android app in time.'
			);
			watcher.close();
			expect(android.nativeCacheHit).toBe(false);
			expect(android.timings.building).toBeGreaterThan(0);
			expect(server.proc.pid).toBe(serverPid);
			expect(performance.now() - rebuildStartedAt).toBeLessThan(
				NATIVE_REBUILD_BUDGET_MS
			);
			await attachWebView();
			const check = await route('/react');
			expect(check.hmrConnected).toBe(true);
		}
	);

	nativeTest(
		'restores production-safe native configuration on cleanup',
		async () => {
			const mobile = mobileConfig();
			const active = await inspectAbsoluteMobileRelease(
				mobile,
				PROJECT_ROOT
			);
			expect(active.ready).toBe(false);
			await webview?.close();
			webview = undefined;
			await android?.close();
			android = undefined;
			const released = await inspectAbsoluteMobileRelease(
				mobile,
				PROJECT_ROOT
			);
			expect(released.ready).toBe(true);
			expect(
				released.checks.every((check) => check.status === 'pass')
			).toBe(true);
		}
	);
});
