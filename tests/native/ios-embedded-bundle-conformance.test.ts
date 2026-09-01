import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
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
import { sanitizeNativeReportText } from '../../src/mobile/nativeTestReport';

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

const mobileConfig = () => {
	if (!config.mobile) throw new Error('Native mobile fixture is invalid.');

	return normalizeAbsoluteMobileConfig(
		{
			...config.mobile,
			server: { productionOrigin: `http://localhost:${port}` }
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
				ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN: `http://localhost:${port}`
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
			`http://localhost:${compiledPort}/react`
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

const proxyCompiledBackend = async (request: Request) => {
	const target = new URL(request.url);
	target.hostname = 'localhost';
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
	storageValue: localStorage.getItem(storageKey)
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
		300_000
	);

describeNative('real Capacitor iOS embedded-bundle conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		port = await findFreePort();
		await runPrepare();
		await installReporter('build-1', true);
		backend = Bun.serve({
			hostname: '127.0.0.1',
			port,
			fetch: async (request) => {
				const url = new URL(request.url);
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
							: null
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
});
