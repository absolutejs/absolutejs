import { lifecycle, links, secureStorage } from '@absolutejs/devices';
import { installCapacitorDeviceAdapter } from '@absolutejs/devices-capacitor';
import {
	createMobileAuthClient,
	createMobileAuthTransport,
	installAuthClientRuntimeTransport
} from '@absolutejs/auth/client/mobile';
import type { AbsoluteMobileAuthManifest } from './nativeAuth';
import type { AbsoluteMobileFetch } from './transport';

export type AbsoluteMobileShellAuth = {
	fetch: AbsoluteMobileFetch;
	redirectUri: string;
	socketTicket: (audience?: string) => Promise<string>;
};

let installed = false;

export const createAbsoluteMobileShellAuth = async (
	config: AbsoluteMobileAuthManifest
): Promise<AbsoluteMobileShellAuth> => {
	if (!installed) {
		installCapacitorDeviceAdapter({
			storagePrefix: `absolutejs.${config.clientId}.`
		});
		installed = true;
	}
	const client = createMobileAuthClient({
		allowedOrigins: [config.issuer],
		clientId: config.clientId,
		issuer: config.issuer,
		lifecycle,
		links,
		redirectUri: config.redirectUri,
		resource: config.issuer,
		scopes: config.scopes,
		storage: secureStorage
	});
	await client.start();
	installAuthClientRuntimeTransport(
		createMobileAuthTransport(client, { baseUrl: config.issuer })
	);

	return {
		fetch: client.fetchOptional,
		redirectUri: config.redirectUri,
		socketTicket: client.socketTicket
	};
};
