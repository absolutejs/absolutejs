import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findFreePort } from '../../src/cli/utils';
import { installAbsoluteExpoIosRelease } from '../../src/mobile/expoDevController';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	assertAbsoluteIosInstalledAppUpgrade,
	inspectAbsoluteIosInstalledApp
} from '../../src/mobile/iosUpgradeConformance';
import { writeAbsoluteExpoProject } from '../../src/mobile/expoProject';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_EXPO_IOS_UPGRADE === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/expo-ios-upgrade-conformance'
);
const NATIVE_PROJECT = resolve(FIXTURE_ROOT, 'native');
const ARTIFACT_ROOT = resolve(FIXTURE_ROOT, 'artifacts');
const APP_ID = `com.absolutejs.expoiosupgradeacceptance${Date.now()}`;
const CLIENT_ID = `absolutejs-native:${APP_ID}`;
const SENTINEL = 'expo-upgrade-private-sentinel';
const TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 20_000;

type Stage = 'v1-seed' | 'v1-relaunch' | 'v2-upgrade' | 'v2-relaunch';
type AppReport = {
	authenticated?: boolean;
	message?: string;
	pending?: number;
	phase?: Stage | 'error' | 'progress';
	schema?: { state?: string; storedVersion?: number; targetVersion?: number };
};
type SocketData = { authenticated: boolean };
type AuthorizationTransaction = {
	challenge: string;
	clientId: string;
	nonce: string;
	redirectUri: string;
};
type SigningJwk = JsonWebKey & {
	alg: string;
	kid: string;
	use: string;
};

let backend: ReturnType<typeof Bun.serve<SocketData>> | undefined;

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

const waitFor = async <T>(
	read: () => T | undefined,
	message: string | (() => string)
) => {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const value = read();
		if (value !== undefined) return value;
		await Bun.sleep(250);
	}
	throw new Error(typeof message === 'function' ? message() : message);
};

const waitForReport = async (
	reports: AppReport[],
	read: () => AppReport | undefined,
	message: string,
	requestCounts: Map<string, number>
) =>
	waitFor(
		() => {
			const error = reports.find((report) => report.phase === 'error');
			if (error)
				throw new Error(
					`Expo native runtime failed: ${error.message ?? 'unknown error'}. Backend requests: ${JSON.stringify(Object.fromEntries(requestCounts))}`
				);

			return read();
		},
		() =>
			`${message} Backend requests: ${JSON.stringify(Object.fromEntries(requestCounts))}`
	);

const relaunch = (xcrun: string, udid: string) => {
	Bun.spawnSync([xcrun, 'simctl', 'terminate', udid, APP_ID], {
		stderr: 'ignore',
		stdout: 'ignore'
	});
	command(
		xcrun,
		'simctl',
		'launch',
		'--terminate-running-process',
		udid,
		APP_ID
	);
};

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

const schema = (version: 1 | 2) => ({
	absolutejs: {
		sync: {
			localSchema:
				version === 1
					? { version: 1 }
					: {
							migrations: [
								{
									operations: [
										{
											collection: 'expo-upgrade',
											from: 'label',
											to: 'title',
											type: 'rename-field'
										}
									],
									toVersion: 2
								}
							],
							version: 2
						}
		}
	},
	dependencies: {
		'@absolutejs/auth': '0.76.3',
		'@absolutejs/sync': '2.31.0'
	},
	private: true
});

const routeSource = (
	port: number
) => `import { createAuthClient } from '@absolutejs/auth/client';
import { createSyncClient } from '@absolutejs/sync/client';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { getAbsoluteExpoSyncSchemaStatus } from '../src/generated/AbsoluteSync';

const ORIGIN = 'http://localhost:${port}';
const report = (value: Record<string, unknown>) => fetch(ORIGIN + '/report', {
  body: JSON.stringify(value), headers: { 'content-type': 'application/json' }, method: 'POST'
}).catch(() => undefined);

export default function UpgradeAcceptance() {
  useEffect(() => {
    let closed = false;
    let reported = false;
	let seedAttempted = false;
    void (async () => {
      try {
        const control = await fetch(ORIGIN + '/control').then(response => response.json()) as { stage: string };
        const auth = createAuthClient();
        let authStatus = await auth.status();
        if (authStatus.error) throw new Error(authStatus.error.message);
        if (!authStatus.data?.user) {
          const signedIn = await auth.signIn.email({ email: 'expo-upgrade@absolutejs.com', password: '' });
          if (signedIn.error) throw new Error(signedIn.error.message);
          authStatus = await auth.status();
          if (authStatus.error) throw new Error(authStatus.error.message);
        }
        if (!authStatus.data?.user) throw new Error('Native Auth did not restore a principal.');
        await report({ phase: 'progress', step: 'auth-ready' });
        const sync = createSyncClient({ maxReconnectMs: 100, reconnectMs: 50, url: 'ws://localhost:${port}/sync' });
        const collection = sync.collection<{ id: number; label?: string; title?: string }>({ collection: 'expo-upgrade' });
        const finish = async (pending: number) => {
          if (closed || reported) return;
          const stage = control.stage;
          const matches = stage === 'v1-seed' ? pending > 0 : stage === 'v1-relaunch' ? pending > 0 : pending === 0;
          if (!matches) return;
          reported = true;
          await report({ authenticated: true, pending, phase: stage, schema: await getAbsoluteExpoSyncSchemaStatus() });
        };
        sync.subscribeStatus(status => { void finish(status.pending); });
        collection.subscribe(snapshot => {
          if (snapshot.status !== 'ready') return;
          void report({ phase: 'progress', step: 'snapshot-ready' });
          if (control.stage === 'v1-seed' && !seedAttempted) {
			seedAttempted = true;
			void fetch(ORIGIN + '/claim-seed', { method: 'POST' }).then(response => response.json()).then(async (claim: { claimed: boolean }) => {
			  if (!claim.claimed) return;
			  await collection.mutate({
              args: { id: 2, label: '${SENTINEL}' },
              name: 'expo-upgrade-pending',
              optimisticOperations: [{ row: { id: 2, label: '${SENTINEL}' }, type: 'insert' }]
			  });
			  await report({ phase: 'progress', step: 'mutation-enqueued' });
			}).catch(error => report({ phase: 'error', message: error instanceof Error ? error.message : String(error) }));
          } else if (control.stage.startsWith('v2')) {
            setTimeout(() => { void sync.flush({ timeoutMs: 15_000 }).then(result => finish(result.pending)); }, 500);
          }
        });
      } catch (error) {
        await report({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { closed = true; };
  }, []);
  return <View><Text>AbsoluteJS Expo installed upgrade acceptance</Text></View>;
}
`;

const setBuildNumber = async (buildNumber: number) => {
	const path = resolve(NATIVE_PROJECT, 'app.json');
	const value = JSON.parse(await readFile(path, 'utf8'));
	value.expo.ios = { ...value.expo.ios, buildNumber: String(buildNumber) };
	value.expo.version = `0.0.${buildNumber}`;
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const inspectDatabase = async (dataContainer: string, needle: string) => {
	const databaseName = `absolutejs-sync-${createHash('sha256').update(APP_ID).digest('hex').slice(0, 24)}.db`;
	let found = false;
	let contains = false;
	for (const suffix of ['', '-wal']) {
		const path = resolve(
			dataContainer,
			'Documents',
			'SQLite',
			`${databaseName}${suffix}`
		);
		try {
			const bytes = await readFile(path);
			found = true;
			contains ||= bytes.includes(Buffer.from(needle));
		} catch {
			// SQLite may not create a WAL file for every transaction.
		}
	}

	return { contains, found };
};

afterAll(async () => {
	backend?.stop(true);
});

describeNative('real Expo iOS installed-app upgrade conformance', () => {
	test('retains Auth and encrypted Sync state, migrates it, and replays once', async () => {
		if (process.platform !== 'darwin')
			throw new Error(
				'Expo iOS installed-upgrade acceptance requires macOS and Xcode.'
			);
		const port = await findFreePort();
		let stage: Stage = 'v1-seed';
		let acceptMutations = false;
		let seedClaimed = false;
		let refreshRequests = 0;
		let acceptedEffects = 0;
		const reports: AppReport[] = [];
		const requestCounts = new Map<string, number>();
		const authorizationCodes = new Map<string, AuthorizationTransaction>();
		const accessTokens = new Set<string>();
		const refreshTokens = new Set<string>();
		const socketTickets = new Set<string>();
		const appliedOperations = new Set<string>();
		const keys = await crypto.subtle.generateKey(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			true,
			['sign', 'verify']
		);
		const publicJwk: SigningJwk = {
			...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
			alg: 'ES256',
			kid: 'expo-upgrade',
			use: 'sig'
		};
		const origin = `http://localhost:${port}`;
		const signIdToken = async (clientId: string, nonce: string) => {
			const header = base64Url(
				JSON.stringify({
					alg: 'ES256',
					kid: 'expo-upgrade',
					typ: 'JWT'
				})
			);
			const payload = base64Url(
				JSON.stringify({
					aud: clientId,
					exp: Math.floor(Date.now() / 1000) + 300,
					iat: Math.floor(Date.now() / 1000),
					iss: origin,
					nonce,
					sub: 'expo-upgrade-user'
				})
			);
			const input = `${header}.${payload}`;
			const signature = await crypto.subtle.sign(
				{ hash: 'SHA-256', name: 'ECDSA' },
				keys.privateKey,
				new TextEncoder().encode(input)
			);

			return `${input}.${base64Url(new Uint8Array(signature))}`;
		};
		backend = Bun.serve<SocketData>({
			hostname: '127.0.0.1',
			port,
			websocket: {
				message(socket, message) {
					const frame: unknown = JSON.parse(String(message));
					if (typeof frame !== 'object' || frame === null) return;
					const frameType = Reflect.get(frame, 'type');
					if (typeof frameType === 'string')
						requestCounts.set(
							`ws:${frameType}`,
							(requestCounts.get(`ws:${frameType}`) ?? 0) + 1
						);
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

						return;
					}
					if (!socket.data.authenticated) return;
					if (Reflect.get(frame, 'type') === 'subscribe') {
						socket.send(
							JSON.stringify({
								id: Reflect.get(frame, 'id'),
								rows: [{ id: 1, label: 'server-row' }],
								type: 'snapshot',
								version: 1
							})
						);
					}
					if (
						Reflect.get(frame, 'type') === 'mutate' &&
						acceptMutations
					) {
						const operationId = Reflect.get(frame, 'operationId');
						if (typeof operationId !== 'string') return;
						if (!appliedOperations.has(operationId)) {
							appliedOperations.add(operationId);
							acceptedEffects += 1;
						}
						socket.send(
							JSON.stringify({
								mutationId: Reflect.get(frame, 'mutationId'),
								operationId,
								result: { accepted: true },
								type: 'ack'
							})
						);
					}
				},
				open() {}
			},
			fetch: async (request, server) => {
				const url = new URL(request.url);
				requestCounts.set(
					url.pathname,
					(requestCounts.get(url.pathname) ?? 0) + 1
				);
				if (request.method === 'OPTIONS')
					return jsonResponse(null, { status: 204 });
				if (url.pathname === '/control') return jsonResponse({ stage });
				if (url.pathname === '/report' && request.method === 'POST') {
					reports.push((await request.json()) as AppReport);

					return new Response(null, { status: 204 });
				}
				if (
					url.pathname === '/claim-seed' &&
					request.method === 'POST'
				) {
					const claimed = !seedClaimed;
					seedClaimed = true;

					return jsonResponse({ claimed });
				}
				if (url.pathname === '/sync') {
					if (
						server.upgrade(request, {
							data: { authenticated: false }
						})
					) {
						// eslint-disable-next-line consistent-return -- Bun owns the upgraded response.
						return;
					}

					return new Response('WebSocket upgrade required', {
						status: 426
					});
				}
				if (url.pathname === '/.well-known/openid-configuration')
					return jsonResponse({
						authorization_endpoint: `${origin}/authorize`,
						code_challenge_methods_supported: ['S256'],
						issuer: origin,
						jwks_uri: `${origin}/jwks`,
						revocation_endpoint: `${origin}/revoke`,
						socket_ticket_endpoint: `${origin}/socket-ticket`,
						token_endpoint: `${origin}/token`,
						token_endpoint_auth_methods_supported: ['none'],
						userinfo_endpoint: `${origin}/userinfo`
					});
				if (url.pathname === '/jwks')
					return jsonResponse({ keys: [publicJwk] });
				if (url.pathname === '/authorize') {
					const code = crypto.randomUUID();
					const transaction: AuthorizationTransaction = {
						challenge: url.searchParams.get('code_challenge') ?? '',
						clientId: url.searchParams.get('client_id') ?? '',
						nonce: url.searchParams.get('nonce') ?? '',
						redirectUri: url.searchParams.get('redirect_uri') ?? ''
					};
					if (
						transaction.clientId !== CLIENT_ID ||
						!transaction.challenge ||
						!transaction.redirectUri
					)
						return jsonResponse(
							{ error: 'invalid_request' },
							{ status: 400 }
						);
					authorizationCodes.set(code, transaction);
					const callback = new URL(transaction.redirectUri);
					callback.searchParams.set('code', code);
					callback.searchParams.set('iss', origin);
					callback.searchParams.set(
						'state',
						url.searchParams.get('state') ?? ''
					);

					return new Response(null, {
						headers: { location: callback.href },
						status: 302
					});
				}
				if (url.pathname === '/token') {
					const body = new URLSearchParams(await request.text());
					let nonce = '';
					if (body.get('grant_type') === 'refresh_token') {
						refreshRequests += 1;
						if (
							!refreshTokens.delete(
								body.get('refresh_token') ?? ''
							)
						)
							return jsonResponse(
								{ error: 'invalid_grant' },
								{ status: 400 }
							);
					} else {
						const code = body.get('code') ?? '';
						const transaction = authorizationCodes.get(code);
						const challenge = createHash('sha256')
							.update(body.get('code_verifier') ?? '')
							.digest('base64url');
						if (!transaction) {
							requestCounts.set(
								'/token:unknown-code',
								(requestCounts.get('/token:unknown-code') ??
									0) + 1
							);

							return jsonResponse(
								{ error: 'invalid_grant' },
								{ status: 400 }
							);
						}
						let rejection: string | undefined;
						if (transaction.challenge !== challenge)
							rejection = 'pkce-mismatch';
						else if (transaction.clientId !== body.get('client_id'))
							rejection = 'client-mismatch';
						if (rejection) {
							requestCounts.set(
								`/token:${rejection}`,
								(requestCounts.get(`/token:${rejection}`) ??
									0) + 1
							);

							return jsonResponse(
								{ error: 'invalid_grant' },
								{ status: 400 }
							);
						}
						const { nonce: transactionNonce } = transaction;
						nonce = transactionNonce;
						authorizationCodes.delete(code);
					}
					const accessToken = `access-${crypto.randomUUID()}`;
					const refreshToken = `refresh-${crypto.randomUUID()}`;
					accessTokens.add(accessToken);
					refreshTokens.add(refreshToken);

					return jsonResponse({
						access_token: accessToken,
						expires_in: 300,
						id_token: await signIdToken(CLIENT_ID, nonce),
						refresh_token: refreshToken,
						scope: 'openid profile',
						token_type: 'Bearer'
					});
				}
				if (url.pathname === '/userinfo') {
					const token =
						request.headers
							.get('authorization')
							?.replace('Bearer ', '') ?? '';

					return accessTokens.has(token)
						? jsonResponse({
								email: 'expo-upgrade@absolutejs.com',
								sub: 'expo-upgrade-user'
							})
						: jsonResponse(
								{ error: 'invalid_token' },
								{ status: 401 }
							);
				}
				if (url.pathname === '/socket-ticket') {
					const token =
						request.headers
							.get('authorization')
							?.replace('Bearer ', '') ?? '';
					if (!accessTokens.has(token))
						return jsonResponse(
							{ error: 'invalid_token' },
							{ status: 401 }
						);
					const ticket = `ticket-${crypto.randomUUID()}`;
					socketTickets.add(ticket);

					return jsonResponse({ ticket });
				}
				if (url.pathname === '/revoke') return jsonResponse(null);

				return new Response('Not found', { status: 404 });
			}
		});

		await mkdir(FIXTURE_ROOT, { recursive: true });
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: APP_ID,
				appName: 'AbsoluteJS Expo iOS Upgrade Acceptance',
				engine: 'expo',
				nativeProject: { directory: 'native' },
				platforms: ['ios'],
				server: { productionOrigin: origin }
			},
			FIXTURE_ROOT
		);
		const writeGeneration = async (version: 1 | 2) => {
			await writeFile(
				resolve(FIXTURE_ROOT, 'package.json'),
				`${JSON.stringify(schema(version), null, 2)}\n`
			);
			await writeAbsoluteExpoProject(config, {
				force: true,
				projectRoot: FIXTURE_ROOT
			});
			await Promise.all([
				writeFile(
					resolve(NATIVE_PROJECT, 'app/index.tsx'),
					routeSource(port)
				),
				setBuildNumber(version)
			]);
			const install = Bun.spawn(['bun', 'install'], {
				cwd: NATIVE_PROJECT,
				stderr: 'inherit',
				stdout: 'inherit'
			});
			if ((await install.exited) !== 0)
				throw new Error(
					`Expo v${version} dependency installation failed.`
				);
		};
		await writeGeneration(1);
		const xcrun = 'xcrun';
		const firstInstallation = await installAbsoluteExpoIosRelease({
			config,
			xcrun,
			log: (line) => console.log(line)
		});
		const { udid } = firstInstallation;
		const v1Seed = await waitForReport(
			reports,
			() =>
				reports.find(
					(report) =>
						report.phase === 'v1-seed' && (report.pending ?? 0) > 0
				),
			'Expo v1 did not persist its Auth session and durable mutation.',
			requestCounts
		);
		expect(v1Seed.schema).toMatchObject({
			state: 'ready',
			storedVersion: 1,
			targetVersion: 1
		});
		const installedV1 = await inspectAbsoluteIosInstalledApp(
			xcrun,
			udid,
			APP_ID
		);
		const database = await inspectDatabase(
			installedV1.dataContainer,
			SENTINEL
		);
		expect(database.found).toBe(true);
		expect(database.contains).toBe(false);
		const beforeRelaunchRefreshes = refreshRequests;
		stage = 'v1-relaunch';
		relaunch(xcrun, udid);
		const v1Restored = await waitForReport(
			reports,
			() =>
				reports.find(
					(report) =>
						report.phase === 'v1-relaunch' &&
						(report.pending ?? 0) > 0
				),
			'Expo v1 did not restore Auth and the outbox after process death.',
			requestCounts
		);
		expect(v1Restored.authenticated).toBe(true);
		expect(refreshRequests).toBeGreaterThan(beforeRelaunchRefreshes);
		stage = 'v2-upgrade';
		acceptMutations = true;
		await writeGeneration(2);
		await installAbsoluteExpoIosRelease({
			config,
			iosDevice: udid,
			xcrun,
			log: (line) => console.log(line)
		});
		const installedV2 = await inspectAbsoluteIosInstalledApp(
			xcrun,
			udid,
			APP_ID
		);
		assertAbsoluteIosInstalledAppUpgrade(installedV1, installedV2);
		const v2 = await waitForReport(
			reports,
			() =>
				reports.find(
					(report) =>
						report.phase === 'v2-upgrade' &&
						report.pending === 0 &&
						acceptedEffects === 1
				),
			'Expo v2 did not migrate and acknowledge the retained mutation.',
			requestCounts
		);
		expect(v2.authenticated).toBe(true);
		expect(v2.schema).toMatchObject({
			state: 'ready',
			storedVersion: 2,
			targetVersion: 2
		});
		expect(acceptedEffects).toBe(1);
		stage = 'v2-relaunch';
		relaunch(xcrun, udid);
		await waitForReport(
			reports,
			() =>
				reports.find(
					(report) =>
						report.phase === 'v2-relaunch' && report.pending === 0
				),
			'Expo v2 did not restore its migrated empty outbox.',
			requestCounts
		);
		await Bun.sleep(2_000);
		expect(acceptedEffects).toBe(1);
		await mkdir(ARTIFACT_ROOT, { recursive: true });
		await writeFile(
			resolve(ARTIFACT_ROOT, 'expo-ios-upgrade-conformance.json'),
			`${JSON.stringify(
				{
					auth: {
						restoredAfterProcessDeath: true,
						restoredAfterUpgrade: true
					},
					engine: 'expo',
					outcome: 'pass',
					platform: 'ios',
					sync: {
						deliveredExactlyOnce: true,
						encryptedAtRest: true,
						pendingAfterAck: 0,
						pendingSurvivedProcessDeath: true,
						storedVersion: 2,
						targetVersion: 2
					},
					upgrade: {
						buildNumberAfter: installedV2.buildNumber,
						buildNumberBefore: installedV1.buildNumber,
						sameDataDirectory:
							installedV1.dataContainer ===
							installedV2.dataContainer
					}
				},
				null,
				2
			)}\n`
		);
	}, 1_800_000);
});
