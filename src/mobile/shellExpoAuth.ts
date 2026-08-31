import {
	installAuthClientRuntimeTransport,
	type MobileAuthPrincipal
} from '@absolutejs/auth/client/mobile';
import type { AbsoluteMobileAuthManifest } from './nativeAuth';
import type { AbsoluteMobileFetch } from './transport';
import { createAbsoluteExpoBridgeFetch } from './shellExpoDevices';

type ExpoAuthStatus = {
	principal: Pick<MobileAuthPrincipal, 'namespace'> | null;
	user: unknown | null;
};

type ExpoBridge = {
	on?: (
		event: string,
		listener: (payload: Record<string, unknown>) => void
	) => () => void;
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
};

const requireBridge = (): ExpoBridge => {
	const value: unknown = Reflect.get(globalThis, '__absoluteExpoBridge');
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof Reflect.get(value, 'request') !== 'function'
	) {
		throw new TypeError('The Expo Auth bridge is unavailable.');
	}

	return {
		on:
			typeof Reflect.get(value, 'on') === 'function'
				? (event, listener) =>
						Reflect.apply(Reflect.get(value, 'on'), value, [
							event,
							listener
						])
				: undefined,
		request: (method, params) =>
			Promise.resolve(
				Reflect.apply(Reflect.get(value, 'request'), value, [
					method,
					params
				])
			)
	};
};

const parseStatus = (value: unknown): ExpoAuthStatus => {
	if (typeof value !== 'object' || value === null)
		throw new TypeError('The Expo Auth bridge returned an invalid status.');
	const principal = Reflect.get(value, 'principal');
	if (
		principal !== null &&
		(typeof principal !== 'object' ||
			principal === null ||
			typeof Reflect.get(principal, 'namespace') !== 'string')
	) {
		throw new TypeError(
			'The Expo Auth bridge returned an invalid principal.'
		);
	}

	return {
		principal:
			principal === null
				? null
				: { namespace: String(Reflect.get(principal, 'namespace')) },
		user: Reflect.get(value, 'user') ?? null
	};
};

export const createAbsoluteExpoShellAuth = async (
	config: AbsoluteMobileAuthManifest
) => {
	const provider = requireBridge();
	const fetch: AbsoluteMobileFetch = createAbsoluteExpoBridgeFetch();
	const authFetch: AbsoluteMobileFetch = (input, init) => {
		const resolved =
			typeof input === 'string' || input instanceof URL
				? new URL(String(input), config.issuer)
				: input;

		return fetch(resolved, init);
	};
	let status: ExpoAuthStatus = { principal: null, user: null };
	const listeners = new Set<
		(principal: Pick<MobileAuthPrincipal, 'namespace'> | null) => void
	>();
	provider.on?.('auth.principal', (payload) => {
		status = parseStatus({
			principal: payload.principal,
			user: status.user
		});
		for (const listener of listeners) listener(status.principal);
	});
	installAuthClientRuntimeTransport({
		fetch: authFetch,
		signInEmail: async ({ email }) => {
			status = parseStatus(
				await provider.request('auth.signIn', { email, signup: false })
			);

			return { status: 'authenticated' };
		},
		signOut: async () => {
			await provider.request('auth.signOut', {});
			status = { principal: null, user: null };

			return null;
		},
		signUpEmail: async ({ email }) => {
			status = parseStatus(
				await provider.request('auth.signIn', { email, signup: true })
			);

			return { status: 'authenticated' };
		},
		status: async () => {
			status = parseStatus(await provider.request('auth.status', {}));

			return { user: status.user };
		}
	});
	status = parseStatus(await provider.request('auth.status', {}));

	return {
		clientId: config.clientId,
		fetch,
		issuer: config.issuer,
		principal: status.principal,
		redirectUri: config.redirectUri,
		onPrincipalChange: (
			listener: (
				principal: Pick<MobileAuthPrincipal, 'namespace'> | null
			) => void
		) => {
			listeners.add(listener);
			listener(status.principal);

			return () => listeners.delete(listener);
		},
		socketTicket: async () => {
			throw new TypeError(
				'Expo socket tickets remain native-only until @absolutejs/sync-expo is installed.'
			);
		}
	};
};
