import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findFreePort } from '../../src/cli/utils';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	parseBootedAbsoluteExpoIosSimulators,
	startAbsoluteExpoDevSession,
	type AbsoluteExpoDevSession
} from '../../src/mobile/expoDevController';
import { writeAbsoluteExpoProject } from '../../src/mobile/expoProject';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_EXPO_IOS_OBSERVABILITY === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/expo-ios-observability-conformance'
);
const NATIVE_PROJECT = resolve(FIXTURE_ROOT, 'native');
const ARTIFACT_ROOT = resolve(FIXTURE_ROOT, 'artifacts');
const APP_ID = `com.absolutejs.expoiosobservabilityacceptance${Date.now()}`;
const TEST_ID = 'absolutejs-expo-ios-observability-v1';
const TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 20_000;

type NativeEvent = {
	at?: number;
	extra?: {
		nativeDiagnostic?: Record<string, unknown>;
		nativeDiagnosticId?: string;
	};
	groupingKey?: string;
	name?: string;
	tags?: Record<string, string>;
};

type AcceptanceManifest = {
	appBuild: string;
	observability: NonNullable<
		ReturnType<typeof normalizeAbsoluteMobileConfig>['observability']
	>;
	pages: [];
	productionOrigin: string;
	routes: [];
	runtime: string;
};

let expoSession: AbsoluteExpoDevSession | undefined;
let relay: ReturnType<typeof Bun.serve> | undefined;

const command = (executable: string, ...args: string[]) => {
	const result = Bun.spawnSync([executable, ...args], {
		killSignal: 'SIGKILL',
		stderr: 'pipe',
		stdout: 'pipe',
		timeout: COMMAND_TIMEOUT_MS
	});
	if (result.exitCode === 0) return result.stdout.toString().trim();
	throw new Error(
		`${executable} ${args.join(' ')} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`
	);
};

const waitFor = async <T>(read: () => T | undefined, message: string) => {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const value = read();
		if (value !== undefined) return value;
		await Bun.sleep(250);
	}
	throw new Error(message);
};

const developmentUrl = (metroPort: number) =>
	`exp+${APP_ID.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}://expo-development-client/?url=${encodeURIComponent(`http://localhost:${metroPort}`)}`;

const relaunch = (udid: string, metroPort: number) => {
	Bun.spawnSync(['xcrun', 'simctl', 'terminate', udid, APP_ID], {
		stderr: 'ignore',
		stdout: 'ignore'
	});
	command('xcrun', 'simctl', 'openurl', udid, developmentUrl(metroPort));
};

afterAll(async () => {
	await expoSession?.close().catch(() => undefined);
	relay?.stop(true);
});

describeNative('real Expo iOS native observability conformance', () => {
	test('retains a rejected diagnostic, retries it, acknowledges it, and does not duplicate it', async () => {
		if (process.platform !== 'darwin')
			throw new Error(
				'Expo iOS observability acceptance requires macOS and Xcode.'
			);
		const relayPort = await findFreePort();
		const metroPort = await findFreePort();
		const requests: unknown[] = [];
		let accept = false;
		let inject = true;
		relay = Bun.serve({
			port: relayPort,
			fetch: async (request) => {
				const url = new URL(request.url);
				if (request.method === 'POST' && url.pathname === '/relay') {
					requests.push(await request.json().catch(() => undefined));

					return new Response(null, { status: accept ? 202 : 503 });
				}
				if (url.pathname === '/control')
					return Response.json({ inject });
				if (request.method === 'POST' && url.pathname === '/ready')
					return new Response(null, { status: 204 });

				return new Response('Not found', { status: 404 });
			}
		});
		await mkdir(FIXTURE_ROOT, { recursive: true });
		await writeFile(
			resolve(FIXTURE_ROOT, 'package.json'),
			'{"dependencies":{},"private":true}\n'
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: APP_ID,
				appName: 'AbsoluteJS Expo iOS Observability Acceptance',
				engine: 'expo',
				nativeProject: { directory: 'native' },
				observability: {
					project: 'expo-ios-native-acceptance',
					route: '/relay'
				},
				platforms: ['ios'],
				server: { productionOrigin: `http://localhost:${relayPort}` }
			},
			FIXTURE_ROOT
		);
		await writeAbsoluteExpoProject(config, {
			force: true,
			projectRoot: FIXTURE_ROOT
		});
		if (!config.observability)
			throw new Error('Expo iOS acceptance observability is missing.');
		const manifest: AcceptanceManifest = {
			appBuild: 'expo-ios-observability-acceptance',
			observability: config.observability,
			pages: [],
			productionOrigin: config.productionOrigin,
			routes: [],
			runtime: 'expo-ios-observability-v1'
		};
		await Promise.all([
			writeFile(
				resolve(NATIVE_PROJECT, 'src/generated/webAssets.ts'),
				`// Generated acceptance fixture.\nexport const materializeAbsoluteWebBundle = async () => { throw new Error('No web bundle in native acceptance.'); };\nexport const ABSOLUTE_MOBILE_MANIFEST = ${JSON.stringify(manifest)} as const;\n`
			),
			writeFile(
				resolve(NATIVE_PROJECT, 'app/index.tsx'),
				`import { useEffect } from 'react';\nimport { Text, View } from 'react-native';\nimport { enqueueAbsoluteExpoNativeObservabilityForTesting } from '../src/generated/AbsoluteNativeObservability';\nconst ORIGIN = 'http://localhost:${relayPort}';\nexport default function Acceptance() {\n  useEffect(() => {\n    void fetch(ORIGIN + '/control').then(response => response.json()).then(async (control: { inject: boolean }) => {\n      await fetch(ORIGIN + '/ready', { method: 'POST' });\n      if (control.inject) await enqueueAbsoluteExpoNativeObservabilityForTesting('${TEST_ID}');\n    }).catch(() => undefined);\n  }, []);\n  return <View><Text>AbsoluteJS Expo iOS native observability acceptance</Text></View>;\n}\n`
			)
		]);
		const install = Bun.spawn(['bun', 'install'], {
			cwd: NATIVE_PROJECT,
			stderr: 'inherit',
			stdout: 'inherit'
		});
		if ((await install.exited) !== 0)
			throw new Error(
				'Expo iOS acceptance dependency installation failed.'
			);

		const startedAt = Date.now();
		expoSession = await startAbsoluteExpoDevSession({
			config,
			iosOrigin: `http://localhost:${relayPort}`,
			metroPort,
			platforms: ['ios'],
			log: (line) => console.log(line)
		});
		const [udid] = parseBootedAbsoluteExpoIosSimulators(
			command('xcrun', 'simctl', 'list', 'devices', 'booted', '-j')
		);
		if (!udid)
			throw new Error(
				'Expo acceptance did not find a booted iOS Simulator.'
			);

		const events = () =>
			requests.flatMap((request) => {
				if (typeof request !== 'object' || request === null) return [];
				const value = Reflect.get(request, 'events');

				return Array.isArray(value) ? (value as NativeEvent[]) : [];
			});
		const rejected = await waitFor(
			() =>
				events().find(
					(event) =>
						event.name === 'AbsoluteMobileNativeDiagnostic' &&
						event.groupingKey === 'absolute-native:ios:crash' &&
						(event.at ?? 0) >= startedAt - 2_000
				),
			'Expo relay did not receive the injected iOS diagnostic.'
		);
		const diagnosticId = rejected.extra?.nativeDiagnosticId;
		expect(diagnosticId).toBeString();
		expect(JSON.stringify(rejected.extra?.nativeDiagnostic)).not.toContain(
			'mobile-observability-secret'
		);
		expect(JSON.stringify(rejected.extra?.nativeDiagnostic)).toContain(
			'[REDACTED]'
		);

		inject = false;
		accept = true;
		relaunch(udid, metroPort);
		const accepted = await waitFor(() => {
			const matches = events().filter(
				(event) => event.extra?.nativeDiagnosticId === diagnosticId
			);

			return matches.length >= 2 ? matches.at(-1) : undefined;
		}, 'Expo relay did not retry the same retained iOS diagnostic.');
		expect(accepted.tags).toMatchObject({
			absoluteMobile: 'true',
			mobileEngine: 'expo',
			mobileFailurePhase: 'native-process',
			mobilePlatform: 'ios'
		});
		await Bun.sleep(1_000);
		relaunch(udid, metroPort);
		await Bun.sleep(5_000);
		expect(
			events().filter(
				(event) => event.extra?.nativeDiagnosticId === diagnosticId
			)
		).toHaveLength(2);
		await mkdir(ARTIFACT_ROOT, { recursive: true });
		await writeFile(
			resolve(ARTIFACT_ROOT, 'expo-ios-native-observability.json'),
			`${JSON.stringify(
				{
					acknowledgedAfterAcceptedResponse: true,
					debugOnlyInjection: true,
					kind: 'crash',
					platform: 'ios',
					relayAttemptsForDiagnostic: 2,
					retainedAfterRejectedResponse: true,
					retriedSameDiagnostic: true,
					sensitiveCanaryRedacted: true,
					tagKeys: Object.keys(accepted.tags ?? {}).sort()
				},
				null,
				2
			)}\n`
		);
	}, 900_000);
});
