import { describe, expect, test } from 'bun:test';
import type { DevicePushNotificationsCapability } from '@absolutejs/devices';
import type { AbsoluteMobileShellAuthRuntime } from '../../../src/mobile/shellBootstrap';
import { createAbsoluteMobileShellPush } from '../../../src/mobile/shellPush';

const createHarness = (responses: Response[], initialInstallation?: string) => {
	const values = new Map<string, string>();
	if (initialInstallation)
		values.set('absolutejs.push.installation-id', initialInstallation);
	const requests: Array<{ body: unknown; method: string }> = [];
	let principalListener:
		| ((principal: { namespace: string } | null) => void)
		| undefined;
	let disables = 0;
	let enables = 0;
	let permissionRequests = 0;
	const auth: AbsoluteMobileShellAuthRuntime = {
		clientId: 'native-client',
		issuer: 'https://api.example',
		principal: { namespace: 'principal-a' },
		redirectUri: 'com.example.app://auth/callback',
		fetch: async (_input, init) => {
			requests.push({
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				method: init?.method ?? 'GET'
			});

			return responses.shift() ?? new Response(null, { status: 500 });
		},
		onPrincipalChange: (listener) => {
			principalListener = listener;

			return () => undefined;
		},
		socketTicket: async () => 'ticket'
	};
	const capability: DevicePushNotificationsCapability = {
		capability: async () => ({ available: true, fidelity: 'native' }),
		disable: async () => {
			disables += 1;
		},
		enable: async () => {
			enables += 1;
		},
		onAction: async () => () => undefined,
		onReceived: async () => () => undefined,
		queryPermission: async () => ({ canRequest: true, state: 'granted' }),
		requestPermission: async () => {
			permissionRequests += 1;

			return { canRequest: true, state: 'granted' };
		}
	};
	const push = createAbsoluteMobileShellPush({
		storage: {
			get: async (key) => values.get(key) ?? null,
			remove: async (key) => {
				values.delete(key);
			},
			set: async (key, value) => {
				values.set(key, value);
			}
		}
	});
	push.connect(auth, capability);

	return {
		capabilityOptions: push.capabilityOptions,
		principalListener,
		push,
		requests,
		values,
		get disables() {
			return disables;
		},
		get enables() {
			return enables;
		},
		get permissionRequests() {
			return permissionRequests;
		}
	};
};

describe('native shell push lifecycle', () => {
	test('recovers from a prior account installation without exposing provider identity', async () => {
		const harness = createHarness(
			[
				Response.json(
					{ code: 'installation-ownership' },
					{ status: 409 }
				),
				Response.json({
					installationId: 'server-installation-new',
					registered: true
				})
			],
			'prior-account-installation'
		);

		await harness.capabilityOptions.onRegistration?.({
			platform: 'fcm',
			token: 'provider-token'
		});

		expect(harness.requests).toEqual([
			{
				body: {
					installationId: 'prior-account-installation',
					platform: 'fcm',
					token: 'provider-token'
				},
				method: 'POST'
			},
			{
				body: { platform: 'fcm', token: 'provider-token' },
				method: 'POST'
			}
		]);
		expect(installationValue(harness)).toBe('server-installation-new');
	});

	test('removes the server installation before clearing local identity', async () => {
		const harness = createHarness(
			[Response.json({ removed: true })],
			'server-installation-1'
		);
		await harness.capabilityOptions.onUnregistration?.();

		expect(harness.requests).toEqual([
			{
				body: { installationId: 'server-installation-1' },
				method: 'DELETE'
			}
		]);
		expect(installationValue(harness)).toBeUndefined();
	});

	test('re-enables an already granted capability after sign-in without prompting', async () => {
		const harness = createHarness([]);
		harness.principalListener?.({ namespace: 'principal-b' });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(harness.enables).toBe(1);
		expect(harness.permissionRequests).toBe(0);
		await harness.push.beforeSignOut();
		expect(harness.disables).toBe(1);
	});
});

const installationValue = (harness: ReturnType<typeof createHarness>) =>
	harness.values.get('absolutejs.push.installation-id');
