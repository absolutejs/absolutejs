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
	prepareAbsoluteIosDevProject,
	startAbsoluteIosDevSession,
	type AbsoluteIosDevProject,
	type AbsoluteIosDevSession
} from '../../src/mobile/iosSimulatorController';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_IOS === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/ios-artifacts'
);
const CAPACITOR_CONFIG_PATH = resolve(PROJECT_ROOT, 'capacitor.config.ts');
const NATIVE_TEST_PORT =
	Number(process.env.ABSOLUTE_NATIVE_IOS_TEST_PORT) || 39_079;
const WARM_START_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_IOS_WARM_START_BUDGET_MS) || 30_000;
const COLD_START_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_IOS_COLD_START_BUDGET_MS) || 600_000;
const HMR_BUDGET_MS =
	Number(process.env.ABSOLUTE_NATIVE_IOS_HMR_BUDGET_MS) || 45_000;

let server: DevServer;
let project: AbsoluteIosDevProject;
let ios: AbsoluteIosDevSession | undefined;
let originalCapacitorConfig: string | undefined;

const mobileConfig = () => {
	if (!config.mobile) throw new Error('Native mobile fixture is invalid.');

	return normalizeAbsoluteMobileConfig(config.mobile, PROJECT_ROOT);
};

const waitForIosClient = async () => {
	const deadline = Date.now() + HMR_BUDGET_MS;
	while (Date.now() < deadline) {
		const response = await fetch(`${server.baseUrl}/hmr-status`).catch(
			() => undefined
		);
		if (response?.ok) {
			const status: unknown = await response.json();
			const targets =
				typeof status === 'object' && status !== null
					? Reflect.get(status, 'connectedTargets')
					: undefined;
			if (
				typeof targets === 'object' &&
				targets !== null &&
				Number(Reflect.get(targets, 'capacitor-ios')) > 0
			)
				return;
		}
		await Bun.sleep(100);
	}
	throw new Error('The real iOS WebView did not connect to native HMR.');
};

const waitForIosHmrOutput = async (outputStart: number, kind: string) => {
	const deadline = Date.now() + HMR_BUDGET_MS;
	while (Date.now() < deadline) {
		const line = server.outputLines
			.slice(outputStart)
			.find(
				(value) =>
					value.includes('[hmr:ios]') &&
					value.includes(kind) &&
					/(applied in|falling back to reload after)/u.test(value)
			);
		if (line) return line;
		await Bun.sleep(100);
	}
	throw new Error(
		`No iOS ${kind} HMR acknowledgement was observed within ${HMR_BUDGET_MS}ms.`
	);
};

const nativeTest = (name: string, operation: () => Promise<void>) =>
	test(
		name,
		async () => {
			try {
				await operation();
			} catch (error) {
				await mkdir(ARTIFACT_ROOT, { recursive: true });
				const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-');
				await ios
					?.screenshot(resolve(ARTIFACT_ROOT, `${slug}.png`))
					.catch(() => undefined);
				throw error;
			}
		},
		600_000
	);

describeNative('real Capacitor iOS simulator lifecycle conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		server = await startDevServer({
			configPath: CONFIG_PATH,
			port: NATIVE_TEST_PORT
		});
		project = await prepareAbsoluteIosDevProject(mobileConfig(), {
			createNativeProject: true,
			projectRoot: PROJECT_ROOT
		});
		ios = await startAbsoluteIosDevSession({
			port: server.port,
			project,
			log: (message) => console.log(`[native-ios] ${message}`)
		});
		await waitForIosClient();
	}, 900_000);

	afterEach(() => restoreAllFiles());

	afterAll(async () => {
		restoreAllFiles();
		await ios?.close().catch(() => undefined);
		await server?.kill().catch(() => undefined);
		if (originalCapacitorConfig === undefined)
			await unlink(CAPACITOR_CONFIG_PATH).catch(() => undefined);
		else await writeFile(CAPACITOR_CONFIG_PATH, originalCapacitorConfig);
	}, 120_000);

	nativeTest('enforces startup and no-op native cache budgets', async () => {
		if (!ios) throw new Error('iOS lifecycle session is not running.');
		const budget = ios.nativeCacheHit
			? WARM_START_BUDGET_MS
			: COLD_START_BUDGET_MS;
		expect(ios.timings.total).toBeLessThan(budget);
		const serverPid = server.proc.pid;
		ios = await ios.rebuild();
		expect(ios.nativeCacheHit).toBe(true);
		expect(ios.timings.building).toBeUndefined();
		expect(server.proc.pid).toBe(serverPid);
		await waitForIosClient();
	});

	nativeTest('applies React component HMR in the iOS WebView', async () => {
		const outputStart = server.outputLines.length;
		mutateFile(
			resolve(PROJECT_ROOT, 'example/react/components/App.tsx'),
			(source) =>
				source.replace(
					'AbsoluteJS + React',
					'AbsoluteJS + React iOS Native'
				)
		);
		const line = await waitForIosHmrOutput(outputStart, 'component');
		expect(line).toContain('applied in');
	});

	nativeTest('applies CSS HMR without reinstalling the app', async () => {
		if (!ios) throw new Error('iOS lifecycle session is not running.');
		const outputStart = server.outputLines.length;
		const originalUdid = ios.udid;
		mutateFile(
			resolve(PROJECT_ROOT, 'example/styles/indexes/react-example.css'),
			(source) => `${source}\n/* real-ios-css-conformance */\n`
		);
		const line = await waitForIosHmrOutput(outputStart, 'css');
		expect(line).toContain('applied in');
		expect(ios.udid).toBe(originalUdid);
	});

	nativeTest('survives app termination and relaunch', async () => {
		if (!ios) throw new Error('iOS lifecycle session is not running.');
		await ios.relaunch();
		await waitForIosClient();
		const screenshot = await ios.screenshot(
			resolve(ARTIFACT_ROOT, 'relaunch.png')
		);
		expect(await Bun.file(screenshot).exists()).toBe(true);
	});

	nativeTest('reconnects after the dev server restarts', async () => {
		const previousPid = server.proc.pid;
		await server.kill();
		server = await startDevServer({
			configPath: CONFIG_PATH,
			port: NATIVE_TEST_PORT
		});
		expect(server.proc.pid).not.toBe(previousPid);
		await waitForIosClient();
	});

	nativeTest('rebuilds native edits without restarting Bun', async () => {
		if (!ios) throw new Error('iOS lifecycle session is not running.');
		const sourcePath = resolve(
			project.nativeDirectory,
			'App/App/AppDelegate.swift'
		);
		const original = await readFile(sourcePath, 'utf8');
		const serverPid = server.proc.pid;
		await writeFile(
			sourcePath,
			`${original}\n// AbsoluteJS iOS native rebuild\n`
		);
		try {
			ios = await ios.rebuild();
			expect(ios.nativeCacheHit).toBe(false);
			expect(ios.timings.building).toBeNumber();
			expect(server.proc.pid).toBe(serverPid);
			await waitForIosClient();
		} finally {
			await writeFile(sourcePath, original);
		}
	});
});
