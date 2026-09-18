import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import {
	createAuthenticatedReleaseProofBackend,
	type AuthenticatedProofRow
} from '../helpers/authenticatedReleaseProofBackend';
import {
	createMemorySyncLocalStore,
	createSyncClient,
	type SyncClient
} from '@absolutejs/sync/client';
import { pollNative } from '../helpers/androidLocalHttps';

const origin = 'https://localhost:48443';
const appId = 'com.absolutejs.authenticatedproof';

test('authenticated release proof uses real PKCE, bearer Sync, atomic receipts and account filters', async () => {
	const backend = await createAuthenticatedReleaseProofBackend({
		appId,
		challenge: 'synthetic-proof',
		origin
	});
	let client: SyncClient | undefined;
	const request = (path: string, init?: RequestInit) =>
		backend.app.handle(new Request(new URL(path, origin), init));
	const signIn = async (account: string) => {
		const verifier = randomUUID() + randomUUID();
		const redirectUri = `${appId}://auth/callback`;
		const params = new URLSearchParams({
			client_id: `absolutejs-native:${appId}`,
			code_challenge: createHash('sha256')
				.update(verifier)
				.digest('base64url'),
			code_challenge_method: 'S256',
			nonce: randomUUID(),
			redirect_uri: redirectUri,
			resource: origin,
			response_type: 'code',
			scope: 'openid profile',
			state: randomUUID()
		});
		const authorization = await request(`/oauth2/authorize?${params}`);
		expect(authorization.status).toBe(302);
		const location = authorization.headers.get('location');
		if (!location) throw new Error('Missing synthetic login redirect');
		const login = await request(location);
		const html = await login.text();
		const nonce = /name="nonce" value="([^"]+)"/u.exec(html)?.[1];
		if (!nonce) throw new Error('Missing synthetic login form');
		const approved = await request('/__proof/login', {
			body: new URLSearchParams({ account, nonce }),
			headers: { Origin: origin },
			method: 'POST'
		});
		expect(approved.status).toBe(303);
		const cookie = approved.headers.get('set-cookie')?.split(';')[0];
		if (!cookie) throw new Error('Missing synthetic browser session');
		const callback = await request(`/oauth2/authorize?${params}`, {
			headers: { Cookie: cookie }
		});
		const callbackLocation = callback.headers.get('location');
		if (!callbackLocation) throw new Error('Missing native callback');
		const code = new URL(callbackLocation).searchParams.get('code');
		if (!code) throw new Error('Missing authorization code');
		const tokenRequest = (codeVerifier: string) =>
			request('/oauth2/token', {
				body: new URLSearchParams({
					client_id: `absolutejs-native:${appId}`,
					code,
					code_verifier: codeVerifier,
					grant_type: 'authorization_code',
					redirect_uri: redirectUri
				}),
				method: 'POST'
			});
		const token = await tokenRequest(verifier);
		expect(token.status).toBe(200);
		const body = (await token.json()) as {
			access_token: string;
			refresh_token: string;
			id_token: string;
		};
		expect(typeof body.access_token).toBe('string');
		expect(typeof body.refresh_token).toBe('string');
		expect(typeof body.id_token).toBe('string');

		return body.access_token;
	};
	const exchange = async (
		token?: string,
		operation = 'operation-one',
		challenge = 'synthetic-proof'
	) => {
		const response = await request('/__absolute/sync/background', {
			body: JSON.stringify({
				mutations: [
					{
						args: { challenge },
						name: 'recordAuthenticatedProof',
						operationId: operation
					}
				],
				pulls: [{ collection: 'authenticated-proof', id: 'rows' }],
				version: 1
			}),
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			method: 'POST'
		});

		return {
			body: response.ok ? await response.json() : undefined,
			status: response.status
		};
	};
	try {
		expect((await exchange()).status).toBe(401);
		const a = await signIn('account-a');
		const first = await exchange(a);
		expect(first.status).toBe(200);
		expect(first.body.mutations[0]?.status).toBe('ack');
		expect(backend.facts().writes).toBe(1);
		await Promise.all([exchange(a), exchange(a)]);
		expect(backend.facts().writes).toBe(1);
		expect(
			(await exchange(a, 'operation-one', 'altered-proof')).body
				.mutations[0]?.status
		).toBe('reject');
		expect(
			(await exchange(a, 'bad-operation', 'wrong-proof')).body
				.mutations[0]?.status
		).toBe('reject');
		expect(backend.facts().writes).toBe(1);
		expect(
			(
				await request('/__proof/sync-gate', {
					body: 'closed',
					method: 'POST'
				})
			).status
		).toBe(403);
		expect(
			(
				await request('/__proof/sync-gate', {
					body: 'closed',
					headers: { 'x-proof-control': 'synthetic-proof' },
					method: 'POST'
				})
			).status
		).toBe(200);
		expect((await exchange(a)).status).toBe(503);
		const b = await signIn('account-b');
		expect(
			(
				await request('/__proof/sync-gate', {
					body: 'open',
					headers: { 'x-proof-control': 'synthetic-proof' },
					method: 'POST'
				})
			).status
		).toBe(200);
		const second = await exchange(b);
		expect(second.body.mutations[0]?.status).toBe('ack');
		expect(second.body.pulls[0]?.rows).toHaveLength(1);
		expect(second.body.pulls[0]?.rows[0]?.owner).toBe('account-b');
		expect((await exchange(a)).body.pulls[0]?.rows[0]?.owner).toBe(
			'account-a'
		);
		expect(backend.facts().writes).toBe(2);
		await exchange(a, 'distinct-operation');
		expect(backend.facts().writes).toBe(3);
		backend.app.listen({ hostname: '127.0.0.1', port: 0 });
		if (!backend.app.server)
			throw new Error('Synthetic Sync server did not start');
		let tickets = 0;
		client = createSyncClient({
			durable: {
				namespace: 'synthetic-account-a',
				store: createMemorySyncLocalStore()
			},
			url: `ws://127.0.0.1:${backend.app.server.port}/sync/ws`,
			socketTicket: async () => {
				const response = await request('/oauth2/socket-ticket', {
					body: '{}',
					headers: {
						Authorization: `Bearer ${a}`,
						'Content-Type': 'application/json'
					},
					method: 'POST'
				});
				expect(response.status).toBe(200);
				const body = (await response.json()) as { ticket: string };
				tickets += 1;

				return body.ticket;
			}
		});
		const collection = client.collection<AuthenticatedProofRow>({
			collection: 'authenticated-proof'
		});
		await pollNative(
			async () => collection.get().data.length === 2,
			'authenticated socket snapshot',
			5000
		);
		expect(
			collection.get().data.every((row) => row.owner === 'account-a')
		).toBe(true);
		await collection.mutate({
			args: { challenge: 'synthetic-proof' },
			name: 'recordAuthenticatedProof'
		});
		expect(backend.facts().writes).toBe(4);
		client.reconnect();
		await pollNative(
			async () =>
				tickets >= 2 && client?.status().connection === 'online',
			'fresh ticket reconnect',
			5000
		);
		expect(backend.facts().writes).toBe(4);
	} finally {
		client?.close();
		if (backend.app.server) await backend.app.stop();
		await backend.close();
	}
}, 15_000);
