import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findFreePort } from '../../src/cli/utils';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	startAbsoluteExpoDevSession,
	type AbsoluteExpoDevSession
} from '../../src/mobile/expoDevController';
import { writeAbsoluteExpoProject } from '../../src/mobile/expoProject';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../src/mobile/emulatorDoctor';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_EXPO_ANDROID === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/expo-android-observability-conformance'
);
const NATIVE_PROJECT = resolve(FIXTURE_ROOT, 'native');
const ARTIFACT_ROOT = resolve(FIXTURE_ROOT, 'artifacts');
const APP_ID = 'com.absolutejs.expoobservabilityacceptance';
const TEST_ID = 'absolutejs-expo-android-observability-v1';
const TIMEOUT_MS = 120_000;

type NativeEvent = {
	at?: number;
	extra?: { nativeDiagnosticId?: string };
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
	let message = '';
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = Bun.spawnSync([executable, ...args], {
			stderr: 'pipe',
			stdout: 'pipe'
		});
		if (result.exitCode === 0) return result.stdout.toString().trim();
		message =
			result.stderr.toString().trim() || result.stdout.toString().trim();
	}
	throw new Error(`${executable} ${args.join(' ')} failed: ${message}`);
};

const readyAndroidSerials = (adb: string) =>
	command(adb, 'devices')
		.split(/\r?\n/u)
		.flatMap((line) => {
			const match = /^(\S+)\s+device$/u.exec(line.trim());

			return match?.[1] ? [match[1]] : [];
		});

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
	`exp+${APP_ID.replaceAll('.', '-')}://expo-development-client/?url=${encodeURIComponent(`http://localhost:${metroPort}`)}`;

const relaunch = (adb: string, serial: string, metroPort: number) => {
	command(adb, '-s', serial, 'shell', 'am', 'force-stop', APP_ID);
	command(
		adb,
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
	);
};

afterAll(async () => {
	await expoSession?.close().catch(() => undefined);
	relay?.stop(true);
});

describeNative('real Expo Android native observability conformance', () => {
	test('retains a rejected native crash, retries it, acknowledges it, and does not duplicate it', async () => {
		const relayPort = await findFreePort();
		const metroPort = await findFreePort();
		const requests: unknown[] = [];
		let accept = false;
		relay = Bun.serve({
			port: relayPort,
			fetch: async (request) => {
				const url = new URL(request.url);
				if (request.method === 'POST' && url.pathname === '/relay') {
					requests.push(await request.json().catch(() => undefined));

					return new Response(null, { status: accept ? 202 : 503 });
				}
				if (request.method === 'POST' && url.pathname === '/ready') {
					return new Response(null, { status: 204 });
				}

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
				appName: 'AbsoluteJS Expo Observability Acceptance',
				engine: 'expo',
				nativeProject: { directory: 'native' },
				observability: {
					project: 'expo-android-native-acceptance',
					route: '/relay'
				},
				platforms: ['android'],
				server: {
					productionOrigin: `http://localhost:${relayPort}`
				}
			},
			FIXTURE_ROOT
		);
		await writeAbsoluteExpoProject(config, {
			force: true,
			projectRoot: FIXTURE_ROOT
		});
		if (!config.observability)
			throw new Error('Expo acceptance observability is missing.');
		const manifest: AcceptanceManifest = {
			appBuild: 'expo-android-observability-acceptance',
			observability: config.observability,
			pages: [],
			productionOrigin: config.productionOrigin,
			routes: [],
			runtime: 'expo-android-observability-v1'
		};
		await Promise.all([
			writeFile(
				resolve(NATIVE_PROJECT, 'src/generated/webAssets.ts'),
				`// Generated acceptance fixture.\nexport const materializeAbsoluteWebBundle = async () => { throw new Error('No web bundle in native acceptance.'); };\nexport const ABSOLUTE_MOBILE_MANIFEST = ${JSON.stringify(manifest)} as const;\n`
			),
			writeFile(
				resolve(NATIVE_PROJECT, 'app/index.tsx'),
				`import { useEffect } from 'react';\nimport { Text, View } from 'react-native';\nimport { crashAbsoluteExpoNativeObservabilityForTesting } from '../src/generated/AbsoluteNativeObservability';\nconst READY = 'http://localhost:${relayPort}/ready';\nexport default function Acceptance() {\n  useEffect(() => {\n    void fetch(READY, { method: 'POST' }).catch(() => undefined).finally(() => {\n      setTimeout(() => { void crashAbsoluteExpoNativeObservabilityForTesting('${TEST_ID}'); }, 250);\n    });\n  }, []);\n  return <View><Text>AbsoluteJS Expo native observability acceptance</Text></View>;\n}\n`
			)
		]);
		const install = Bun.spawn(['bun', 'install'], {
			cwd: NATIVE_PROJECT,
			stderr: 'inherit',
			stdout: 'inherit'
		});
		if ((await install.exited) !== 0)
			throw new Error('Expo acceptance dependency installation failed.');

		const host = detectAbsoluteMobileHost();
		const checks = await inspectAbsoluteMobileToolchain({ host });
		const adb = checks.find(({ id }) => id === 'android.adb')?.path;
		if (!adb) throw new Error('Expo acceptance requires Android adb.');
		for (const serial of readyAndroidSerials(adb)) {
			Bun.spawnSync([adb, '-s', serial, 'uninstall', APP_ID], {
				stderr: 'ignore',
				stdout: 'ignore'
			});
		}

		const startedAt = Date.now();
		expoSession = await startAbsoluteExpoDevSession({
			androidOrigin: `http://localhost:${relayPort}`,
			config,
			host,
			metroPort,
			platforms: ['android'],
			log: (line) => console.log(line)
		});
		const serial = await waitFor(
			() =>
				readyAndroidSerials(adb).find((value) =>
					value.startsWith('emulator-')
				),
			'Expo acceptance did not find a ready Android emulator.'
		);
		command(
			adb,
			'-s',
			serial,
			'reverse',
			`tcp:${relayPort}`,
			`tcp:${relayPort}`
		);
		await waitFor(
			() =>
				command(
					adb,
					'-s',
					serial,
					'shell',
					'dumpsys',
					'activity',
					'exit-info',
					APP_ID
				).includes('reason=4 (APP CRASH')
					? true
					: undefined,
			'Android did not record the injected Expo process crash.'
		);
		relaunch(adb, serial, metroPort);

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
						event.groupingKey?.startsWith(
							'absolute-native:android:'
						) &&
						(event.at ?? 0) >= startedAt - 2_000
				),
			'Expo relay did not receive the injected Android crash.'
		);
		const diagnosticId = rejected.extra?.nativeDiagnosticId;
		expect(diagnosticId).toBeString();
		accept = true;
		relaunch(adb, serial, metroPort);
		const accepted = await waitFor(() => {
			const matches = events().filter(
				(event) => event.extra?.nativeDiagnosticId === diagnosticId
			);

			return matches.length >= 2 ? matches.at(-1) : undefined;
		}, 'Expo relay did not retry the same retained Android diagnostic.');
		expect(accepted.tags).toMatchObject({
			absoluteMobile: 'true',
			mobileEngine: 'expo',
			mobileFailurePhase: 'native-process',
			mobilePlatform: 'android'
		});
		await Bun.sleep(1_000);
		relaunch(adb, serial, metroPort);
		await Bun.sleep(5_000);
		expect(
			events().filter(
				(event) => event.extra?.nativeDiagnosticId === diagnosticId
			)
		).toHaveLength(2);
		await mkdir(ARTIFACT_ROOT, { recursive: true });
		await writeFile(
			resolve(ARTIFACT_ROOT, 'expo-android-native-observability.json'),
			`${JSON.stringify(
				{
					acknowledgedAfterAcceptedResponse: true,
					kind: accepted.groupingKey?.split(':').at(-1),
					platform: 'android',
					relayAttemptsForDiagnostic: 2,
					retainedAfterRejectedResponse: true,
					retriedSameDiagnostic: true,
					tagKeys: Object.keys(accepted.tags ?? {}).sort()
				},
				null,
				2
			)}\n`
		);
	}, 900_000);
});
