import { afterEach, describe, expect, test } from 'bun:test';
import { createAuthClient } from '@absolutejs/auth/client';
import { createAbsoluteExpoShellAuth } from '../../../src/mobile/shellExpoAuth';

afterEach(() => {
	Reflect.deleteProperty(globalThis, '__absoluteExpoBridge');
});

describe('Expo embedded-web Auth provider', () => {
	test('keeps credentials native while exposing typed Auth and HTTP operations', async () => {
		const requests: { method: string; params: Record<string, unknown> }[] =
			[];
		const eventListeners = new Map<
			string,
			Set<(payload: Record<string, unknown>) => void>
		>();
		Reflect.set(globalThis, '__absoluteExpoBridge', {
			on: (
				event: string,
				listener: (payload: Record<string, unknown>) => void
			) => {
				const values = eventListeners.get(event) ?? new Set();
				values.add(listener);
				eventListeners.set(event, values);

				return () => values.delete(listener);
			},
			request: async (
				method: string,
				params: Record<string, unknown>
			) => {
				requests.push({ method, params });
				if (method === 'http.fetch')
					return {
						body: '{"ok":true}',
						headers: { 'content-type': 'application/json' },
						status: 200
					};
				if (method === 'auth.signOut') return null;

				return {
					principal: { namespace: 'principal_hash' },
					user: { name: 'Ada', sub: 'user_1' }
				};
			}
		});
		const auth = await createAbsoluteExpoShellAuth({
			clientId: 'absolutejs-native:com.example.product',
			issuer: 'https://api.example.com',
			redirectUri: 'product://auth/callback',
			scopes: ['openid', 'profile']
		});
		const client = createAuthClient({ baseUrl: 'https://api.example.com' });

		expect(await client.status()).toEqual({
			data: { user: { name: 'Ada', sub: 'user_1' } },
			error: null
		});
		expect(
			await client.signIn.email({
				email: 'ada@example.com',
				password: 'must-not-cross'
			})
		).toEqual({ data: { status: 'authenticated' }, error: null });
		const response = await auth.fetch('https://api.example.com/private', {
			body: '{"value":1}',
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		});
		expect(await response.json()).toEqual({ ok: true });
		await expect(auth.socketTicket()).rejects.toThrow('native-only');
		expect(requests).toContainEqual({
			method: 'auth.signIn',
			params: { email: 'ada@example.com', signup: false }
		});
		expect(
			requests.find((request) => request.method === 'auth.signIn')?.params
		).not.toHaveProperty('password');
		expect(
			requests.find((request) => request.method === 'http.fetch')?.params
		).toMatchObject({
			body: '{"value":1}',
			headers: { 'content-type': 'application/json' },
			method: 'POST',
			url: 'https://api.example.com/private'
		});
		let { principal } = auth;
		const stop = auth.onPrincipalChange((value) => {
			principal = value;
		});
		for (const listener of eventListeners.get('auth.principal') ?? [])
			listener({ principal: null });
		expect(principal).toBeNull();
		stop();
	});
});
