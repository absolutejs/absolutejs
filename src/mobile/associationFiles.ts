import {
	access,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { MobileConfig } from '../../types/build';
import {
	normalizeAbsoluteMobileConfig,
	type NormalizedAbsoluteMobileConfig
} from './config';

const JSON_HEADERS: Record<string, string> = {
	'cache-control': 'public, max-age=300, must-revalidate',
	'content-type': 'application/json; charset=utf-8'
};
const OWNERSHIP_FILE = '.absolutejs-mobile-associations.json';
const HTTP_OK = 200;
const VERIFY_TIMEOUT_MS = 10_000;

type AssociationEndpoint = {
	document: unknown;
	host: string;
	path: string;
	platform: string;
};

export type AbsoluteAssociationRequest = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

export const ANDROID_ASSOCIATION_PATH = '/.well-known/assetlinks.json';
export const APPLE_ASSOCIATION_PATH = '/.well-known/apple-app-site-association';

export type AbsoluteMobileAssociationDocuments = {
	android?: readonly [
		{
			relation: readonly ['delegate_permission/common.handle_all_urls'];
			target: {
				namespace: 'android_app';
				package_name: string;
				sha256_cert_fingerprints: string[];
			};
		}
	];
	apple?: {
		applinks: {
			details: readonly [
				{
					appIDs: readonly [string];
					components: readonly [{ '/': '/*' }];
				}
			];
		};
	};
};

const missingIdentity = (field: string, platform: string) =>
	new TypeError(
		`${field} is required to publish ${platform} deep-link association files.`
	);

const createAppleDocument = (
	config: NormalizedAbsoluteMobileConfig,
	requireAll: boolean
) => {
	if (!config.platforms.includes('ios')) return undefined;
	if (!config.appleAppIdPrefix && requireAll) {
		throw missingIdentity('mobile.deepLinks.apple.appIdPrefix', 'iOS');
	}
	if (!config.appleAppIdPrefix) return undefined;

	return {
		applinks: {
			details: [
				{
					appIDs: [
						`${config.appleAppIdPrefix}.${config.appId}`
					] as const,
					components: [{ '/': '/*' as const }]
				}
			] as const
		}
	};
};

const createAndroidDocument = (
	config: NormalizedAbsoluteMobileConfig,
	requireAll: boolean
) => {
	if (!config.platforms.includes('android')) return undefined;
	if (config.androidCertificateFingerprints.length === 0 && requireAll) {
		throw missingIdentity(
			'mobile.deepLinks.android.sha256CertificateFingerprints',
			'Android'
		);
	}
	if (config.androidCertificateFingerprints.length === 0) return undefined;

	return [
		{
			relation: ['delegate_permission/common.handle_all_urls'] as const,
			target: {
				namespace: 'android_app' as const,
				package_name: config.appId,
				sha256_cert_fingerprints: config.androidCertificateFingerprints
			}
		}
	] as const;
};

export const createAbsoluteMobileAssociationDocuments = (
	config: NormalizedAbsoluteMobileConfig,
	options: { requireAll?: boolean } = {}
) => {
	const documents: AbsoluteMobileAssociationDocuments = {};
	const requireAll = options.requireAll === true;
	const android = createAndroidDocument(config, requireAll);
	const apple = createAppleDocument(config, requireAll);
	if (android) documents.android = android;
	if (apple) documents.apple = apple;

	return documents;
};

const jsonResponse = (value: unknown) =>
	new Response(`${JSON.stringify(value)}\n`, { headers: JSON_HEADERS });

export const createAbsoluteMobileAssociationPlugin = (
	mobile: MobileConfig | undefined,
	projectRoot: string,
	options: { requireAll?: boolean } = {}
) => {
	const plugin = new Elysia({ name: 'absolutejs-mobile-associations' });
	if (!mobile) return plugin;
	const config = normalizeAbsoluteMobileConfig(mobile, projectRoot);
	const documents = createAbsoluteMobileAssociationDocuments(config, options);
	if (documents.apple) {
		plugin.get(APPLE_ASSOCIATION_PATH, () => jsonResponse(documents.apple));
	}
	if (documents.android) {
		plugin.get(ANDROID_ASSOCIATION_PATH, () =>
			jsonResponse(documents.android)
		);
	}

	return plugin;
};

const writeAtomic = async (path: string, source: string) => {
	let current: string | undefined;
	try {
		current = await readFile(path, 'utf8');
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		) {
			throw error;
		}
	}
	if (current === source) return false;
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, path);

	return true;
};

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const assertOwnedOutput = async (root: string) => {
	const path = resolve(root, OWNERSHIP_FILE);
	let ownership: unknown;
	try {
		ownership = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		throw new TypeError(
			`Association output ${root} already exists and is not owned by AbsoluteJS.`
		);
	}
	if (
		typeof ownership !== 'object' ||
		ownership === null ||
		Reflect.get(ownership, 'format') !== 1
	) {
		throw new TypeError(
			`Association output ${root} has an unsupported ownership manifest.`
		);
	}
};

const publishGeneratedDirectory = async (temporary: string, root: string) => {
	const hasCurrent = await exists(root);
	if (hasCurrent) await assertOwnedOutput(root);
	const backup = `${root}.${crypto.randomUUID()}.previous`;
	if (hasCurrent) await rename(root, backup);
	try {
		await rename(temporary, root);
	} catch (error) {
		if (hasCurrent) await rename(backup, root);
		throw error;
	}
	if (hasCurrent) await rm(backup, { force: true, recursive: true });
};

const materializeHost = async (
	root: string,
	host: string,
	files: Array<[string, unknown]>
) => {
	const directory = resolve(root, host, '.well-known');
	await mkdir(directory, { recursive: true });

	return Promise.all(
		files.map(async ([name, document]) => {
			const path = resolve(directory, name);
			await writeAtomic(path, `${JSON.stringify(document, null, 2)}\n`);

			return path;
		})
	);
};

const associationEndpoints = (
	config: NormalizedAbsoluteMobileConfig,
	documents: AbsoluteMobileAssociationDocuments
) =>
	config.deepLinkHosts.flatMap((host) => {
		const endpoints: AssociationEndpoint[] = [];
		if (documents.android)
			endpoints.push({
				document: documents.android,
				host,
				path: ANDROID_ASSOCIATION_PATH,
				platform: 'Android'
			});
		if (documents.apple)
			endpoints.push({
				document: documents.apple,
				host,
				path: APPLE_ASSOCIATION_PATH,
				platform: 'Apple'
			});

		return endpoints;
	});

export const materializeAbsoluteMobileAssociationFiles = async (
	config: NormalizedAbsoluteMobileConfig,
	outputDirectory: string
) => {
	const root = resolve(outputDirectory);
	const temporary = `${root}.${crypto.randomUUID()}.tmp`;
	const documents = createAbsoluteMobileAssociationDocuments(config, {
		requireAll: true
	});
	const files: Array<[string, unknown]> = [];
	if (documents.android) files.push(['assetlinks.json', documents.android]);
	if (documents.apple) {
		files.push(['apple-app-site-association', documents.apple]);
	}
	await mkdir(temporary, { recursive: true });
	try {
		const temporaryPaths = (
			await Promise.all(
				config.deepLinkHosts.map((host) =>
					materializeHost(temporary, host, files)
				)
			)
		).flat();
		await writeAtomic(
			resolve(temporary, OWNERSHIP_FILE),
			`${JSON.stringify({ format: 1, hosts: config.deepLinkHosts }, null, 2)}\n`
		);
		await publishGeneratedDirectory(temporary, root);
		const written = temporaryPaths.map((path) =>
			resolve(root, path.slice(temporary.length + 1))
		);

		return { root, written };
	} catch (error) {
		await rm(temporary, { force: true, recursive: true });
		throw error;
	}
};

export const verifyAbsoluteMobileAssociationFiles = async (
	config: NormalizedAbsoluteMobileConfig,
	request: AbsoluteAssociationRequest = globalThis.fetch
) => {
	const documents = createAbsoluteMobileAssociationDocuments(config, {
		requireAll: true
	});
	const results = await Promise.all(
		associationEndpoints(config, documents).map(async (endpoint) => {
			const url = `https://${endpoint.host}${endpoint.path}`;
			const response = await request(url, {
				redirect: 'manual',
				signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
			});
			if (response.status !== HTTP_OK) {
				throw new TypeError(
					`${endpoint.platform} association verification failed for ${url}: HTTP ${response.status}; redirects are not allowed.`
				);
			}
			const contentType = response.headers.get('content-type') ?? '';
			if (!contentType.toLowerCase().startsWith('application/json')) {
				throw new TypeError(
					`${endpoint.platform} association verification failed for ${url}: expected application/json.`
				);
			}
			let document: unknown;
			try {
				document = await response.json();
			} catch {
				throw new TypeError(
					`${endpoint.platform} association verification failed for ${url}: invalid JSON.`
				);
			}
			if (
				JSON.stringify(document) !== JSON.stringify(endpoint.document)
			) {
				throw new TypeError(
					`${endpoint.platform} association verification failed for ${url}: the hosted identity does not match mobile config.`
				);
			}

			return { platform: endpoint.platform, url };
		})
	);

	return { results };
};
