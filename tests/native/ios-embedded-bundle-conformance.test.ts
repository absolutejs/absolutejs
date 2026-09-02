import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { cp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import config from '../fixtures/mobile-native-conformance/absolute.config';
import { findFreePort } from '../../src/cli/utils';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	prepareAbsoluteIosDevProject,
	startAbsoluteIosDevSession,
	type AbsoluteIosDevProject,
	type AbsoluteIosDevSession
} from '../../src/mobile/iosSimulatorController';
import { applyAbsoluteNativeDeepLinks } from '../../src/mobile/nativeDeepLinks';
import { applyAbsoluteNativeDeviceCapabilities } from '../../src/mobile/nativeDeviceCapabilities';
import { applyAbsoluteNativeUpdates } from '../../src/mobile/nativeUpdates';
import { sanitizeNativeReportText } from '../../src/mobile/nativeTestReport';
import { buildAbsoluteMobileUpdate } from '../../src/mobile/updateSigning';
import type { AbsoluteMobileClientManifest } from '../../src/mobile/transport';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_IOS === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const BUILD_DIRECTORY = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/ios-embedded-server'
);
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/ios-embedded-artifacts'
);
const UPDATE_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/ios-updates'
);
const UPDATE_STATE_KEY = 'absolute.mobile.update.state.v1';
const UPDATE_PATH_PREFIX = '/__absolute/mobile/updates/production/';
const CAPACITOR_CONFIG_PATH = resolve(PROJECT_ROOT, 'capacitor.config.ts');
const REPORTER_FILE = 'absolute-ios-conformance.js';
const TIMEOUT_MS = 60_000;

type IosEmbeddedCommand = {
	click?: string;
	route?: string;
	sequence: number;
	storageValue?: string;
};

type IosEmbeddedObservation = {
	bodyText: string;
	build: string;
	counter: string | null;
	location: string;
	navigationMethod: string | null;
	sequence: number;
	storageValue: string | null;
	updateResults: IosUpdateResult[];
};

type IosUpdateResult = {
	durationMs?: number;
	kind: string;
	reason?: string;
	releaseId?: string;
};

type BuiltUpdate = Awaited<ReturnType<typeof buildAbsoluteMobileUpdate>>;
type BuildNativeUpdateOptions = { broken?: boolean; createdAt: string };
type IosUpdateConformanceReport = {
	durationMs: number;
	releases: {
		brokenInterrupted: string;
		brokenTimeout: string;
		corrected: string;
		healthy: string;
	};
	state: {
		brokenReleaseRedownloaded: boolean;
		localStorage: boolean;
		processDeathRecovered: boolean;
		timeoutRecovered: boolean;
	};
};

let backend: ReturnType<typeof Bun.serve> | undefined;
let compiledBackend: ReturnType<typeof Bun.spawn> | undefined;
let compiledPort = 0;
let port = 0;
let project: AbsoluteIosDevProject;
let ios: AbsoluteIosDevSession;
let originalCapacitorConfig: string | undefined;
let command: IosEmbeddedCommand = { sequence: 0 };
let observation: IosEmbeddedObservation | undefined;
let updatePrivateKey = '';
let updatePublicKey = '';
let offeredUpdate: string | undefined;
const servedUpdates = new Map<string, BuiltUpdate>();
const updateFileRequests = new Map<string, number>();

const mobileConfig = () => {
	if (!config.mobile) throw new Error('Native mobile fixture is invalid.');

	return normalizeAbsoluteMobileConfig(
		{
			...config.mobile,
			server: { productionOrigin: `http://localhost:${port}` },
			updates: {
				bootTimeoutMs: 5_000,
				channel: 'production',
				manifestUrl: `http://localhost:${port}${UPDATE_PATH_PREFIX}update.json`,
				publicKeys: { 'native-conformance': updatePublicKey }
			}
		},
		PROJECT_ROOT
	);
};

const runPrepare = async () => {
	const process = Bun.spawn(
		[
			'bun',
			'run',
			'src/cli/index.ts',
			'prepare',
			'example/server.ts',
			'--outdir',
			BUILD_DIRECTORY,
			'--config',
			CONFIG_PATH
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...Bun.env,
				ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN: `http://localhost:${port}`,
				ABSOLUTE_NATIVE_CONFORMANCE_UPDATE_MANIFEST: `http://localhost:${port}${UPDATE_PATH_PREFIX}update.json`,
				ABSOLUTE_NATIVE_CONFORMANCE_UPDATE_PUBLIC_KEY: updatePublicKey
			},
			stderr: 'inherit',
			stdout: 'inherit'
		}
	);
	const exitCode = await process.exited;
	if (exitCode !== 0)
		throw new Error(`Embedded iOS production build failed (${exitCode}).`);
};

const startCompiledBackend = async () => {
	compiledBackend = Bun.spawn(['bun', 'server.js'], {
		cwd: BUILD_DIRECTORY,
		env: {
			...Bun.env,
			ABSOLUTE_BUILD_DIR: BUILD_DIRECTORY,
			ABSOLUTE_CONFIG: CONFIG_PATH,
			ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN: `http://localhost:${port}`,
			NODE_ENV: 'production',
			PORT: String(compiledPort)
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (compiledBackend.exitCode !== null)
			throw new Error(
				`Compiled iOS conformance backend exited (${compiledBackend.exitCode}).`
			);
		const response = await fetch(
			`http://127.0.0.1:${compiledPort}/react`
		).catch(() => undefined);
		if (response?.ok) return;
		await Bun.sleep(100);
	}

	throw new Error('Compiled iOS conformance backend did not become ready.');
};

const corsJson = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		headers: {
			'access-control-allow-headers': 'content-type',
			'access-control-allow-methods': 'GET,POST,OPTIONS',
			'access-control-allow-origin': '*',
			'content-type': 'application/json'
		},
		status
	});

const nativeUpdateResponse = async (request: Request) => {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(UPDATE_PATH_PREFIX)) return undefined;
	const relativePath = url.pathname.slice(UPDATE_PATH_PREFIX.length);
	const headers: HeadersInit = {
		'access-control-allow-headers':
			request.headers.get('access-control-request-headers') ??
			'x-absolute-mobile-app,x-absolute-mobile-channel,x-absolute-mobile-installation,x-absolute-mobile-release,x-absolute-mobile-runtime',
		'access-control-allow-methods': 'GET,OPTIONS',
		'access-control-allow-origin': '*',
		'cache-control': 'no-store'
	};
	if (request.method === 'OPTIONS')
		return new Response(null, { headers, status: 204 });
	if (relativePath === 'update.json') {
		if (!offeredUpdate) return new Response(null, { headers, status: 204 });
		const update = servedUpdates.get(offeredUpdate);
		if (!update)
			return new Response('Unknown update.', { headers, status: 404 });

		return new Response(JSON.stringify(update.manifest), {
			headers: { ...headers, 'content-type': 'application/json' }
		});
	}
	const separator = relativePath.indexOf('/files/');
	if (separator < 1)
		return new Response('Unknown update path.', { headers, status: 404 });
	const releaseId = relativePath.slice(0, separator);
	const update = servedUpdates.get(releaseId);
	if (!update)
		return new Response('Unknown update.', { headers, status: 404 });
	let filePath: string;
	try {
		filePath = relativePath
			.slice(separator + '/files/'.length)
			.split('/')
			.map(decodeURIComponent)
			.join('/');
	} catch {
		return new Response('Invalid update path.', { headers, status: 400 });
	}
	if (!update.manifest.files.some(({ path }) => path === filePath))
		return new Response('Unknown update file.', { headers, status: 404 });
	const file = Bun.file(
		resolve(update.outputDirectory, 'files', ...filePath.split('/'))
	);
	if (!(await file.exists()))
		return new Response('Missing update file.', { headers, status: 404 });
	updateFileRequests.set(
		releaseId,
		(updateFileRequests.get(releaseId) ?? 0) + 1
	);

	return new Response(file, { headers });
};

const proxyCompiledBackend = async (request: Request) => {
	const target = new URL(request.url);
	target.hostname = '127.0.0.1';
	target.port = String(compiledPort);
	const response = await fetch(new Request(target, request));
	const headers = new Headers(response.headers);
	headers.set('access-control-allow-origin', '*');

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};

const reporterSource = (build: string) => `const endpoint = ${JSON.stringify(
	`http://localhost:${port}/__absolute/ios-conformance`
)};
const build = ${JSON.stringify(build)};
const storageKey = 'absolute-ios-upgrade-marker';
let lastSequence = -1;
let navigationMethod = sessionStorage.getItem('absolute-ios-navigation-method');
let busy = false;
const snapshot = () => ({
	bodyText: String(document.body?.innerText ?? '').slice(0, 20000),
	build,
	counter: document.querySelector('#counter')?.textContent?.trim() ?? null,
	location: location.pathname,
	navigationMethod,
	sequence: lastSequence,
	storageValue: localStorage.getItem(storageKey),
	updateResults: Reflect.get(globalThis, Symbol.for('absolutejs.mobile.update.results')) ?? []
});
const applyCommand = (next) => {
	if (!next || !Number.isInteger(next.sequence) || next.sequence <= lastSequence) return;
	lastSequence = next.sequence;
	if (typeof next.storageValue === 'string') localStorage.setItem(storageKey, next.storageValue);
	if (typeof next.click === 'string') document.querySelector(next.click)?.click();
	if (typeof next.route === 'string' && location.pathname !== next.route) {
		const existing = [...document.querySelectorAll('a[href]')].find((candidate) => {
			try { return new URL(candidate.href).pathname === next.route; }
			catch { return false; }
		});
		const anchor = existing instanceof HTMLAnchorElement ? existing : document.createElement('a');
		if (!(existing instanceof HTMLAnchorElement)) {
			anchor.href = next.route;
			anchor.hidden = true;
			document.body.append(anchor);
			navigationMethod = 'generated-link';
		} else navigationMethod = 'existing-link';
		sessionStorage.setItem('absolute-ios-navigation-method', navigationMethod);
		anchor.click();
	}
};
const tick = async () => {
	if (busy) return;
	busy = true;
	try {
		await fetch(endpoint, {
			body: JSON.stringify(snapshot()),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		});
		const response = await fetch(endpoint, { cache: 'no-store' });
		if (response.ok) applyCommand(await response.json());
	} catch {}
	finally { busy = false; }
};
setInterval(tick, 200);
addEventListener('pageshow', tick);
void tick();
`;

const buildNativeUpdate = async (
	marker: string,
	options: BuildNativeUpdateOptions
) => {
	const source = resolve(UPDATE_ROOT, 'sources', marker);
	await rm(source, { force: true, recursive: true });
	await cp(project.config.bundleDirectory, source, { recursive: true });
	await writeFile(join(source, REPORTER_FILE), reporterSource(marker));
	if (options.broken) {
		await writeFile(
			join(source, 'index.html'),
			'<!doctype html><title>Broken update fixture</title><p>Broken update fixture</p>\n'
		);
	}
	const clientManifest: AbsoluteMobileClientManifest = JSON.parse(
		await readFile(
			join(
				project.config.bundleDirectory,
				'absolute-mobile-manifest.json'
			),
			'utf8'
		)
	);
	const update = await buildAbsoluteMobileUpdate({
		appId: project.config.appId,
		bundleDirectory: source,
		channel: 'production',
		classification: 'bug-fix',
		createdAt: new Date(options.createdAt),
		keyId: 'native-conformance',
		outputDirectory: resolve(UPDATE_ROOT, 'releases'),
		privateKey: updatePrivateKey,
		runtimeFingerprint: clientManifest.nativeRuntime
	});
	servedUpdates.set(update.manifest.releaseId, update);

	return update;
};

const installReporter = async (build: string, injectIndex: boolean) => {
	const { bundleDirectory } = mobileConfig();
	await writeFile(
		join(bundleDirectory, REPORTER_FILE),
		reporterSource(build)
	);
	if (!injectIndex) return;
	const indexPath = join(bundleDirectory, 'index.html');
	const index = await readFile(indexPath, 'utf8');
	const script = `\t\t<script type="module" src="./${REPORTER_FILE}"></script>\n`;
	if (index.includes(REPORTER_FILE)) return;
	if (!index.includes('</body>'))
		throw new Error('Generated mobile index omitted its closing body tag.');
	await writeFile(indexPath, index.replace('</body>', `${script}\t</body>`));
};

const issueCommand = (next: Omit<IosEmbeddedCommand, 'sequence'>) => {
	command = { ...next, sequence: command.sequence + 1 };
};

const parseUpdateResult = (value: unknown): IosUpdateResult | null => {
	if (typeof value !== 'object' || value === null) return null;
	const kind = Reflect.get(value, 'kind');
	if (typeof kind !== 'string') return null;
	const durationMs = Reflect.get(value, 'durationMs');
	const reason = Reflect.get(value, 'reason');
	const releaseId = Reflect.get(value, 'releaseId');

	return {
		...(typeof durationMs === 'number' && Number.isFinite(durationMs)
			? { durationMs }
			: {}),
		kind: kind.slice(0, 100),
		...(typeof reason === 'string' ? { reason: reason.slice(0, 100) } : {}),
		...(typeof releaseId === 'string'
			? { releaseId: releaseId.slice(0, 100) }
			: {})
	};
};

const parseUpdateResults = (value: unknown) =>
	Array.isArray(value)
		? value
				.map(parseUpdateResult)
				.filter((result): result is IosUpdateResult => result !== null)
				.slice(-8)
		: [];

const waitForObservation = async (
	label: string,
	predicate: (value: IosEmbeddedObservation) => boolean
) => {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (observation && predicate(observation)) return observation;
		await Bun.sleep(100);
	}

	throw new Error(
		`Timed out waiting for iOS embedded ${label}. Last observation: ${JSON.stringify(observation)}`
	);
};

const waitForUpdateResult = (
	build: string,
	kind: string,
	releaseId: string,
	reason?: string
) =>
	waitForObservation(
		`${kind} result for ${releaseId}`,
		(value) =>
			value.build === build &&
			value.updateResults.some(
				(result) =>
					result.kind === kind &&
					result.releaseId === releaseId &&
					(reason === undefined || result.reason === reason)
			)
	);

const requireIosCommand = (args: string[], label: string) => {
	const result = Bun.spawnSync(args);
	if (result.exitCode !== 0) {
		throw new Error(
			`${label} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`
		);
	}

	return result.stdout.toString().trim();
};

let iosDataContainer: string | undefined;
const parseEncodedUpdateState = (encoded: string) => {
	try {
		let state: unknown = JSON.parse(encoded);
		if (typeof state === 'string') state = JSON.parse(state);

		return typeof state === 'object' && state !== null
			? (state as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
};

const readIosUpdateState = async () => {
	if (ios.targetKind !== 'simulator')
		throw new Error(
			'iOS OTA process-recovery conformance requires the Simulator.'
		);
	const liveDefaults = Bun.spawnSync([
		project.xcrun,
		'simctl',
		'spawn',
		ios.udid,
		'defaults',
		'read',
		project.config.appId,
		UPDATE_STATE_KEY
	]);
	if (liveDefaults.exitCode === 0)
		return parseEncodedUpdateState(liveDefaults.stdout.toString().trim());
	iosDataContainer ??= requireIosCommand(
		[
			project.xcrun,
			'simctl',
			'get_app_container',
			ios.udid,
			project.config.appId,
			'data'
		],
		'iOS data-container lookup'
	);
	const preferences = join(
		iosDataContainer,
		'Library',
		'Preferences',
		`${project.config.appId}.plist`
	);
	const converted = Bun.spawnSync([
		'/usr/bin/plutil',
		'-convert',
		'json',
		'-o',
		'-',
		preferences
	]);
	if (converted.exitCode !== 0) return {};
	const plist: unknown = JSON.parse(converted.stdout.toString());
	if (typeof plist !== 'object' || plist === null) return {};
	const encoded = Reflect.get(plist, UPDATE_STATE_KEY);
	if (typeof encoded !== 'string') return {};

	return parseEncodedUpdateState(encoded);
};

const waitForIosPendingUpdate = async (releaseId: string) => {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		if ((await readIosUpdateState()).pendingRelease === releaseId) return;
		await Bun.sleep(100);
	}

	throw new Error(
		`iOS did not persist pending mobile update ${releaseId} before the watchdog deadline.`
	);
};

const terminateIosApp = () => {
	requireIosCommand(
		[project.xcrun, 'simctl', 'terminate', ios.udid, project.config.appId],
		'iOS process termination'
	);
};

const navigate = async (route: string, expectedText: string) => {
	issueCommand({ route });
	const result = await waitForObservation(
		`${route} to render ${expectedText}`,
		(value) =>
			value.sequence === command.sequence &&
			value.location === route &&
			value.bodyText.includes(expectedText)
	);
	expect(result.navigationMethod).toBe('existing-link');
};

const nativeTest = (
	name: string,
	operation: () => Promise<void>,
	timeoutMs = 300_000
) =>
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
				await writeFile(
					resolve(ARTIFACT_ROOT, `${slug}.json`),
					`${JSON.stringify(
						{
							error:
								error instanceof Error
									? {
											message: sanitizeNativeReportText(
												error.message
											),
											stack: sanitizeNativeReportText(
												error.stack ?? ''
											)
										}
									: sanitizeNativeReportText(String(error)),
							observation
						},
						null,
						2
					)}\n`
				).catch(() => undefined);
				throw error;
			}
		},
		timeoutMs
	);

describeNative('real Capacitor iOS embedded-bundle conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		const updateKeys = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		updatePrivateKey = updateKeys.privateKey
			.export({ format: 'pem', type: 'pkcs8' })
			.toString();
		updatePublicKey = updateKeys.publicKey
			.export({ format: 'der', type: 'spki' })
			.toString('base64');
		await rm(UPDATE_ROOT, { force: true, recursive: true });
		port = await findFreePort();
		await runPrepare();
		await installReporter('build-1', true);
		backend = Bun.serve({
			hostname: '127.0.0.1',
			port,
			fetch: async (request) => {
				const url = new URL(request.url);
				const updateResponse = await nativeUpdateResponse(request);
				if (updateResponse) return updateResponse;
				if (url.pathname !== '/__absolute/ios-conformance')
					return proxyCompiledBackend(request);
				if (request.method === 'OPTIONS') return corsJson(null, 204);
				if (request.method === 'GET') return corsJson(command);
				if (request.method !== 'POST')
					return corsJson({ error: 'method-not-allowed' }, 405);
				const value: unknown = await request
					.json()
					.catch(() => undefined);
				if (typeof value !== 'object' || value === null)
					return corsJson({ error: 'invalid-observation' }, 400);
				const next = value as Partial<IosEmbeddedObservation>;
				if (
					typeof next.bodyText !== 'string' ||
					typeof next.build !== 'string' ||
					typeof next.location !== 'string' ||
					typeof next.sequence !== 'number'
				)
					return corsJson({ error: 'invalid-observation' }, 400);
				observation = {
					bodyText: next.bodyText.slice(0, 20_000),
					build: next.build.slice(0, 100),
					counter:
						typeof next.counter === 'string'
							? next.counter.slice(0, 100)
							: null,
					location: next.location.slice(0, 500),
					navigationMethod:
						typeof next.navigationMethod === 'string'
							? next.navigationMethod.slice(0, 100)
							: null,
					sequence: next.sequence,
					storageValue:
						typeof next.storageValue === 'string'
							? next.storageValue.slice(0, 500)
							: null,
					updateResults: parseUpdateResults(
						Reflect.get(next, 'updateResults')
					)
				};

				return corsJson({ accepted: true });
			}
		});
		// Bind the observation/proxy port before selecting the compiled server
		// port so two sequential free-port probes cannot race onto one port.
		compiledPort = await findFreePort();
		await startCompiledBackend();
		const mobile = mobileConfig();
		project = await prepareAbsoluteIosDevProject(mobile, {
			createNativeProject: true,
			projectRoot: PROJECT_ROOT
		});
		await applyAbsoluteNativeDeepLinks(mobile, ['ios']);
		await applyAbsoluteNativeDeviceCapabilities(PROJECT_ROOT, mobile, [
			'ios'
		]);
		await applyAbsoluteNativeUpdates(mobile, ['ios']);
		ios = await startAbsoluteIosDevSession({
			embeddedBundle: true,
			port,
			project,
			log: (message) => console.log(`[native-ios-bundle] ${message}`)
		});
		await waitForObservation(
			'initial React route',
			(value) =>
				value.build === 'build-1' &&
				value.location === '/react' &&
				value.bodyText.includes('AbsoluteJS + React')
		);
		const nativeConfig: unknown = JSON.parse(
			await readFile(
				join(
					project.nativeDirectory,
					'App',
					'App',
					'capacitor.config.json'
				),
				'utf8'
			)
		);
		expect(
			typeof nativeConfig === 'object' && nativeConfig !== null
				? Reflect.get(Reflect.get(nativeConfig, 'server') ?? {}, 'url')
				: undefined
		).toBeUndefined();
	}, 900_000);

	afterAll(async () => {
		await ios?.close().catch(() => undefined);
		backend?.stop(true);
		compiledBackend?.kill();
		await compiledBackend?.exited.catch(() => undefined);
		offeredUpdate = undefined;
		servedUpdates.clear();
		updateFileRequests.clear();
		await rm(UPDATE_ROOT, { force: true, recursive: true });
		if (originalCapacitorConfig === undefined)
			await unlink(CAPACITOR_CONFIG_PATH).catch(() => undefined);
		else await writeFile(CAPACITOR_CONFIG_PATH, originalCapacitorConfig);
	}, 120_000);

	nativeTest(
		'renders every supported framework through ordinary embedded-app links',
		async () => {
			await navigate('/angular', 'AbsoluteJS + Angular');
			await navigate('/vue', 'AbsoluteJS + Vue');
			await navigate('/svelte', 'AbsoluteJS + Svelte');
			await navigate('/html', 'AbsoluteJS + HTML');
			await navigate('/htmx', 'AbsoluteJS + HTMX');
			await navigate('/react', 'AbsoluteJS + React');
		}
	);

	nativeTest(
		'executes the hashed local HTML application script',
		async () => {
			await navigate('/html', 'AbsoluteJS + HTML');
			issueCommand({ click: '#counter-button' });
			await waitForObservation(
				'local HTML counter',
				(value) =>
					value.sequence === command.sequence && value.counter === '1'
			);
		}
	);

	nativeTest(
		'survives termination and relaunch from embedded assets',
		async () => {
			await navigate('/svelte', 'AbsoluteJS + Svelte');
			observation = undefined;
			await ios.relaunch();
			await waitForObservation(
				'Svelte route after relaunch',
				(value) =>
					value.sequence === command.sequence &&
					value.location === '/svelte' &&
					value.bodyText.includes('AbsoluteJS + Svelte')
			);
		}
	);

	nativeTest(
		'installs an embedded bundle upgrade without erasing application data',
		async () => {
			issueCommand({
				route: '/react',
				storageValue: 'upgrade-survives'
			});
			await waitForObservation(
				'pre-upgrade storage marker',
				(value) =>
					value.sequence === command.sequence &&
					value.location === '/react' &&
					value.storageValue === 'upgrade-survives'
			);
			await installReporter('build-2', false);
			const projectPath = join(
				project.nativeDirectory,
				'App',
				'App.xcodeproj',
				'project.pbxproj'
			);
			const projectSource = await readFile(projectPath, 'utf8');
			const upgradedProject = projectSource.replace(
				/CURRENT_PROJECT_VERSION = (\d+);/gu,
				(_entry, version: string) =>
					`CURRENT_PROJECT_VERSION = ${Number(version) + 1};`
			);
			if (upgradedProject === projectSource)
				throw new Error(
					'Generated iOS project omitted CURRENT_PROJECT_VERSION.'
				);
			await writeFile(projectPath, upgradedProject);
			observation = undefined;
			try {
				ios = await ios.rebuild();
				expect(ios.nativeCacheHit).toBe(false);
				const upgraded = await waitForObservation(
					'post-upgrade embedded bundle and storage marker',
					(value) =>
						value.build === 'build-2' &&
						value.location === '/react' &&
						value.bodyText.includes('AbsoluteJS + React') &&
						value.storageValue === 'upgrade-survives'
				);
				expect(upgraded.storageValue).toBe('upgrade-survives');
			} finally {
				await writeFile(projectPath, projectSource);
			}
		}
	);

	nativeTest(
		'activates, rolls back, quarantines, and process-recovers signed web updates',
		async () => {
			issueCommand({ route: '/react', storageValue: 'ota-survives' });
			await waitForObservation(
				'pre-update durable storage marker',
				(value) =>
					value.sequence === command.sequence &&
					value.location === '/react' &&
					value.storageValue === 'ota-survives'
			);
			await Bun.sleep(5_000);
			const [healthy, brokenTimeout, corrected, brokenInterrupted] =
				await Promise.all([
					buildNativeUpdate('healthy', {
						createdAt: '2026-09-02T00:00:11.000Z'
					}),
					buildNativeUpdate('broken-timeout', {
						broken: true,
						createdAt: '2026-09-02T00:00:12.000Z'
					}),
					buildNativeUpdate('corrected', {
						createdAt: '2026-09-02T00:00:13.000Z'
					}),
					buildNativeUpdate('broken-interrupted', {
						broken: true,
						createdAt: '2026-09-02T00:00:14.000Z'
					})
				]);
			const startedAt = performance.now();

			offeredUpdate = healthy.manifest.releaseId;
			observation = undefined;
			await ios.relaunch();
			const activated = await waitForUpdateResult(
				'healthy',
				'activated',
				healthy.manifest.releaseId
			);
			expect(activated.storageValue).toBe('ota-survives');

			offeredUpdate = brokenTimeout.manifest.releaseId;
			observation = undefined;
			await ios.relaunch();
			const timeoutRecovery = await waitForUpdateResult(
				'healthy',
				'rolled-back',
				brokenTimeout.manifest.releaseId,
				'boot-timeout'
			);
			expect(
				timeoutRecovery.updateResults.find(
					(result) =>
						result.kind === 'rolled-back' &&
						result.releaseId === brokenTimeout.manifest.releaseId
				)?.durationMs
			).toBeNumber();
			expect(timeoutRecovery.storageValue).toBe('ota-survives');
			const brokenTimeoutRequests =
				updateFileRequests.get(brokenTimeout.manifest.releaseId) ?? 0;
			expect(brokenTimeoutRequests).toBeGreaterThan(0);

			observation = undefined;
			await ios.relaunch();
			await waitForUpdateResult(
				'healthy',
				'quarantined',
				brokenTimeout.manifest.releaseId
			);
			await Bun.sleep(1_000);
			expect(
				updateFileRequests.get(brokenTimeout.manifest.releaseId) ?? 0
			).toBe(brokenTimeoutRequests);

			offeredUpdate = corrected.manifest.releaseId;
			observation = undefined;
			await ios.relaunch();
			const correctedActivation = await waitForUpdateResult(
				'corrected',
				'activated',
				corrected.manifest.releaseId
			);
			expect(correctedActivation.storageValue).toBe('ota-survives');

			offeredUpdate = brokenInterrupted.manifest.releaseId;
			observation = undefined;
			await ios.relaunch();
			await waitForIosPendingUpdate(brokenInterrupted.manifest.releaseId);
			terminateIosApp();
			await ios.relaunch();
			const processRecovery = await waitForUpdateResult(
				'corrected',
				'rolled-back',
				brokenInterrupted.manifest.releaseId,
				'boot-interrupted'
			);
			expect(
				processRecovery.updateResults.find(
					(result) =>
						result.kind === 'rolled-back' &&
						result.releaseId ===
							brokenInterrupted.manifest.releaseId
				)?.durationMs
			).toBeNumber();
			expect(processRecovery.storageValue).toBe('ota-survives');
			const state = await readIosUpdateState();
			expect(state.activeRelease).toBe(corrected.manifest.releaseId);
			expect(state.pendingRelease).toBeUndefined();
			expect(state.quarantinedReleases).toContain(
				brokenInterrupted.manifest.releaseId
			);

			const report: IosUpdateConformanceReport = {
				durationMs: Math.round(performance.now() - startedAt),
				releases: {
					brokenInterrupted: brokenInterrupted.manifest.releaseId,
					brokenTimeout: brokenTimeout.manifest.releaseId,
					corrected: corrected.manifest.releaseId,
					healthy: healthy.manifest.releaseId
				},
				state: {
					brokenReleaseRedownloaded: false,
					localStorage: true,
					processDeathRecovered: true,
					timeoutRecovered: true
				}
			};
			await mkdir(ARTIFACT_ROOT, { recursive: true });
			await writeFile(
				resolve(ARTIFACT_ROOT, 'ios-update-conformance.json'),
				`${JSON.stringify(report, null, 2)}\n`
			);
			offeredUpdate = undefined;
		},
		900_000
	);
});
