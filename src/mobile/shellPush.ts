import {
	secureStorage,
	type DevicePushNotificationsCapability
} from '@absolutejs/devices';
import type {
	CapacitorPushNotificationsOptions,
	CapacitorPushRegistration
} from '@absolutejs/devices-capacitor/push-notifications';
import type { AbsoluteMobileShellAuthRuntime } from './shellBootstrap';

const INSTALLATION_KEY = 'absolutejs.push.installation-id';
export const ABSOLUTE_PUSH_ROUTE = '/auth/push' as const;

type RegistrationResponse = {
	installationId: string;
	registered: true;
};

const requireResponse = async <T>(
	response: Response,
	operation: string
): Promise<T> => {
	if (!response.ok)
		throw new Error(
			`AbsoluteJS native push ${operation} failed with HTTP ${response.status}.`
		);

	return response.json();
};

const validInstallationId = (value: unknown) => {
	const id =
		typeof value === 'object' && value !== null
			? Reflect.get(value, 'installationId')
			: undefined;
	if (typeof id !== 'string' || id.length === 0 || id.length > 128)
		throw new Error(
			'AbsoluteJS native push registration returned an invalid installation identity.'
		);

	return id;
};

const isOwnershipConflict = async (response: Response) => {
	if (response.status !== 409) return false;

	const body: unknown = await response
		.clone()
		.json()
		.catch(() => undefined);

	return (
		typeof body === 'object' &&
		body !== null &&
		Reflect.get(body, 'code') === 'installation-ownership'
	);
};

export const createAbsoluteMobileShellPush = ({
	storage = secureStorage
}: {
	storage?: Pick<typeof secureStorage, 'get' | 'remove' | 'set'>;
} = {}) => {
	let auth: AbsoluteMobileShellAuthRuntime | undefined;
	let capability: DevicePushNotificationsCapability | undefined;
	let removePrincipalListener: (() => void) | undefined;
	const requireAuth = () => {
		if (!auth)
			throw new Error('AbsoluteJS native push is not connected to Auth.');

		return auth;
	};
	const installationId = () => storage.get(INSTALLATION_KEY);
	const capabilityOptions: CapacitorPushNotificationsOptions = {
		onRegistration: async (registration: CapacitorPushRegistration) => {
			const client = requireAuth();
			const currentInstallation = await installationId();
			const register = (knownInstallation?: string | null) =>
				client.fetch(ABSOLUTE_PUSH_ROUTE, {
					body: JSON.stringify({
						...(knownInstallation
							? { installationId: knownInstallation }
							: {}),
						...(typeof navigator !== 'undefined' &&
						navigator.language
							? { locale: navigator.language }
							: {}),
						platform: registration.platform,
						token: registration.token
					}),
					headers: { 'content-type': 'application/json' },
					method: 'POST'
				});
			let response = await register(currentInstallation);
			if (currentInstallation && (await isOwnershipConflict(response))) {
				await storage.remove(INSTALLATION_KEY);
				response = await register();
			}
			const result = await requireResponse<RegistrationResponse>(
				response,
				'registration'
			);
			await storage.set(INSTALLATION_KEY, validInstallationId(result));
		},
		onUnregistration: async () => {
			const currentInstallation = await installationId();
			if (!currentInstallation) return;
			const response = await requireAuth().fetch(ABSOLUTE_PUSH_ROUTE, {
				body: JSON.stringify({
					installationId: currentInstallation
				}),
				headers: { 'content-type': 'application/json' },
				method: 'DELETE'
			});
			await requireResponse(response, 'removal');
			await storage.remove(INSTALLATION_KEY);
		}
	};

	return {
		capabilityOptions,
		beforeSignOut: async () => {
			if (!capability) return;
			await capability.disable();
		},
		connect: (
			nextAuth: AbsoluteMobileShellAuthRuntime,
			nextCapability: DevicePushNotificationsCapability
		) => {
			auth = nextAuth;
			capability = nextCapability;
			removePrincipalListener?.();
			removePrincipalListener = nextAuth.onPrincipalChange(
				(principal) => {
					if (!principal) return;
					void nextCapability
						.queryPermission()
						.then((permission) =>
							permission.state === 'granted'
								? nextCapability.enable()
								: undefined
						)
						.catch(() => undefined);
				}
			);
		}
	};
};
