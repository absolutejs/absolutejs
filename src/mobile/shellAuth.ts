import { lifecycle, links, secureStorage } from '@absolutejs/devices';
import {
	createMobileAuthClient,
	createMobileAuthTransport,
	installAuthClientRuntimeTransport,
	type MobileAuthPrincipal
} from '@absolutejs/auth/client/mobile';
import type { AbsoluteMobileAuthManifest } from './nativeAuth';
import type { AbsoluteMobileFetch } from './transport';

type AbsoluteMobileAuthLinks = Pick<
	typeof links,
	'getLaunchUrl' | 'onOpen' | 'openExternal'
>;

type AbsoluteMobileAuthLinkReceiptStorage = Pick<
	typeof secureStorage,
	'get' | 'set'
>;

type AbsoluteMobileAuthLinkBoundary = AbsoluteMobileAuthLinks & {
	commitConsumed: () => Promise<void>;
};

const MAX_CONSUMED_AUTH_LINKS = 8;
const AUTH_LINK_RECEIPTS_KEY = 'absolutejs.auth.callback-receipts.v1';

const authLinkReceipt = async (url: string) =>
	[
		...new Uint8Array(
			await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
		)
	]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');

const parseAuthLinkReceipts = (value: string | null) => {
	if (!value) return [];
	try {
		const parsed: unknown = JSON.parse(value);

		return Array.isArray(parsed)
			? parsed.filter(
					(receipt): receipt is string =>
						typeof receipt === 'string' &&
						/^[a-f0-9]{64}$/u.test(receipt)
				)
			: [];
	} catch {
		return [];
	}
};

export const createAbsoluteMobileAuthLinks = (
	provider: AbsoluteMobileAuthLinks = links,
	storage?: AbsoluteMobileAuthLinkReceiptStorage
): AbsoluteMobileAuthLinkBoundary => {
	const consumed = new Set<string>();
	const delivered = new Set<string>();
	let operation = Promise.resolve();
	const serialize = <T>(run: () => Promise<T>) => {
		const result = operation.then(run, run);
		operation = result.then(
			() => undefined,
			() => undefined
		);

		return result;
	};
	const consume = (url: string) =>
		serialize(async () => {
			const receipt = await authLinkReceipt(url);
			if (consumed.has(receipt)) return false;
			consumed.add(receipt);
			if (consumed.size > MAX_CONSUMED_AUTH_LINKS) {
				const oldest = consumed.values().next().value;
				if (oldest) consumed.delete(oldest);
			}
			if (
				storage &&
				parseAuthLinkReceipts(
					await storage.get(AUTH_LINK_RECEIPTS_KEY).catch(() => null)
				).includes(receipt)
			)
				return false;
			delivered.add(receipt);

			return true;
		});

	return {
		openExternal: provider.openExternal,
		commitConsumed: () =>
			serialize(async () => {
				if (!storage || delivered.size === 0) return;
				const existing = parseAuthLinkReceipts(
					await storage.get(AUTH_LINK_RECEIPTS_KEY).catch(() => null)
				);
				const receipts = [
					...new Set([...existing, ...delivered])
				].slice(-MAX_CONSUMED_AUTH_LINKS);
				await storage.set(
					AUTH_LINK_RECEIPTS_KEY,
					JSON.stringify(receipts)
				);
			}),
		getLaunchUrl: async () => {
			const url = await provider.getLaunchUrl();

			return url && (await consume(url)) ? url : null;
		},
		onOpen: (listener) =>
			provider.onOpen((url) => {
				void consume(url).then((accepted) => {
					if (accepted) listener(url);
				});
			})
	};
};

export type AbsoluteMobileShellAuth = {
	clientId: string;
	fetch: AbsoluteMobileFetch;
	onPrincipalChange: (
		listener: (principal: MobileAuthPrincipal | null) => void
	) => () => void;
	principal: MobileAuthPrincipal | null;
	redirectUri: string;
	issuer: string;
	socketTicket: (audience?: string) => Promise<string>;
};

export const createAbsoluteMobileShellAuth = async (
	config: AbsoluteMobileAuthManifest,
	options: { beforeSignOut?: () => Promise<void> | void } = {}
): Promise<AbsoluteMobileShellAuth> => {
	const authLinks = createAbsoluteMobileAuthLinks(links, secureStorage);
	const client = createMobileAuthClient({
		allowedOrigins: [config.issuer],
		beforeSignOut: options.beforeSignOut,
		clientId: config.clientId,
		issuer: config.issuer,
		lifecycle,
		links: authLinks,
		redirectUri: config.redirectUri,
		resource: config.issuer,
		scopes: config.scopes,
		storage: secureStorage
	});
	client.onPrincipalChange((next) => {
		if (next) void authLinks.commitConsumed().catch(() => undefined);
	});
	await client.start();
	const principal = await client.principal();
	if (principal) await authLinks.commitConsumed().catch(() => undefined);
	installAuthClientRuntimeTransport(
		createMobileAuthTransport(client, { baseUrl: config.issuer })
	);

	return {
		clientId: config.clientId,
		fetch: client.fetchOptional,
		issuer: config.issuer,
		onPrincipalChange: client.onPrincipalChange,
		principal,
		redirectUri: config.redirectUri,
		socketTicket: client.socketTicket
	};
};
