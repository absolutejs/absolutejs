import {
	createPrivateKey,
	createPublicKey,
	X509Certificate
} from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Elysia } from 'elysia';
import type { MobileUpdateRegistry } from '@absolutejs/deploy/mobile-update';
import type { NormalizedAbsoluteMobileConfig } from './config';

export const ABSOLUTE_MOBILE_UPDATE_SERVER_FORMAT = 1 as const;
export const DEFAULT_MOBILE_UPDATE_REGISTRY_MODULE = 'mobile.update.ts';

export type AbsoluteMobileUpdateServerMetadata = {
	format: typeof ABSOLUTE_MOBILE_UPDATE_SERVER_FORMAT;
	provider: string;
	storage: 'durable' | 'local';
};

export type AbsoluteMobileUpdateServerModule = {
	metadata: AbsoluteMobileUpdateServerMetadata;
	registry: MobileUpdateRegistry;
};

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const projectPath = (projectRoot: string, requested: string) => {
	const root = resolve(projectRoot);
	const path = resolve(root, requested);
	const projectRelative = relative(root, path);
	if (
		projectRelative === '..' ||
		projectRelative.startsWith(`..${sep}`) ||
		isAbsolute(projectRelative)
	)
		throw new TypeError(
			'mobile.updates.server.registry must remain inside the project.'
		);

	return path;
};

const isRegistry = (value: unknown): value is MobileUpdateRegistry =>
	object(value) &&
	[
		'publishUpdate',
		'promoteUpdate',
		'rollbackUpdate',
		'resolveUpdate',
		'readUpdateFile'
	].every((method) => typeof value[method] === 'function');

const serverMetadata = (value: unknown) => {
	if (!object(value))
		throw new TypeError(
			'Mobile update registry must export valid absoluteMobileUpdateServer metadata. Run `absolute mobile update provision`.'
		);
	const { format, provider, storage } = value;
	if (
		format !== ABSOLUTE_MOBILE_UPDATE_SERVER_FORMAT ||
		(storage !== 'local' && storage !== 'durable') ||
		typeof provider !== 'string' ||
		!provider
	)
		throw new TypeError(
			'Mobile update registry must export valid absoluteMobileUpdateServer metadata. Run `absolute mobile update provision`.'
		);

	const metadata: AbsoluteMobileUpdateServerMetadata = {
		format: ABSOLUTE_MOBILE_UPDATE_SERVER_FORMAT,
		provider,
		storage
	};

	return metadata;
};

export const loadAbsoluteMobileUpdateServerModule = async (
	projectRoot: string,
	requestedModulePath = DEFAULT_MOBILE_UPDATE_REGISTRY_MODULE
): Promise<AbsoluteMobileUpdateServerModule> => {
	const modulePath = projectPath(projectRoot, requestedModulePath);
	await access(modulePath).catch(() => {
		throw new TypeError(
			`Mobile update server registry does not exist: ${modulePath}. Run \`absolute mobile update provision\`.`
		);
	});
	const loaded: unknown = await import(pathToFileURL(modulePath).href);
	if (!object(loaded))
		throw new TypeError('Mobile update registry module has no exports.');
	const registry = loaded.default ?? loaded.registry;
	if (!isRegistry(registry))
		throw new TypeError(
			'Mobile update registry must implement publication, promotion, rollback, resolution, and file reads.'
		);

	return {
		metadata: serverMetadata(loaded.absoluteMobileUpdateServer),
		registry
	};
};

const expoSigningOptions = (config: NormalizedAbsoluteMobileConfig) => {
	if (!config.updates?.expoCodeSigning) return undefined;
	const entries = Object.entries(
		config.updateServer?.expoCodeSigningKeys ?? {}
	);
	const keys = Object.fromEntries(
		entries.map(([keyId, key]) => {
			const privateKey = process.env[key.privateKeyEnv];
			if (!privateKey)
				throw new TypeError(
					`Expo update serving requires ${key.privateKeyEnv} on the trusted server.`
				);
			try {
				const certificate = new X509Certificate(key.certificatePem);
				const expected = certificate.publicKey.export({
					format: 'der',
					type: 'spki'
				});
				const actual = createPublicKey(
					createPrivateKey(privateKey)
				).export({
					format: 'der',
					type: 'spki'
				});
				if (!expected.equals(actual)) throw new Error('key mismatch');
			} catch (error) {
				throw new TypeError(
					`${key.privateKeyEnv} must contain the RSA private key matching Expo update key ${keyId}.`,
					{ cause: error }
				);
			}

			return [keyId, { certificate: key.certificatePem, privateKey }];
		})
	);

	return { keys };
};

export const createAbsoluteMobileUpdateServerPlugin = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	options: { production?: boolean } = {}
) => {
	const { updates, updateServer: server } = config;
	if (!updates || !server?.autoMount)
		return new Elysia({ name: 'absolutejs-mobile-updates-disabled' });
	const module = await loadAbsoluteMobileUpdateServerModule(
		projectRoot,
		server.registryModule
	);
	if (options.production && module.metadata.storage !== 'durable')
		throw new TypeError(
			'Mobile production updates require durable object storage. Re-run `absolute mobile update provision --storage s3 --force` or configure a durable adapter.'
		);
	const manifest = new URL(updates.manifestUrl);
	if (!manifest.pathname.endsWith('/update.json'))
		throw new TypeError(
			'Auto-mounted mobile update manifests must end in /update.json.'
		);
	const route = manifest.pathname.slice(0, -'/update.json'.length);
	const { createMobileUpdateHandler } = await import(
		'@absolutejs/deploy/mobile-update'
	);
	const handler = createMobileUpdateHandler({
		appId: config.appId,
		channel: updates.channel,
		...(config.engine === 'expo'
			? { expoCodeSigning: expoSigningOptions(config) }
			: {}),
		registry: module.registry,
		route
	});

	return new Elysia({ name: 'absolutejs-mobile-updates' }).all(
		`${route}/*`,
		({ request }) => handler(request)
	);
};

export const inspectAbsoluteMobileUpdateServer = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	if (!config.updates) return undefined;
	const module = await loadAbsoluteMobileUpdateServerModule(
		projectRoot,
		config.updateServer?.registryModule
	);
	if (module.metadata.storage !== 'durable')
		throw new TypeError(
			'Mobile production updates require durable object storage; the configured registry is local-only.'
		);
	if (config.engine === 'expo') expoSigningOptions(config);

	return module.metadata;
};

const publicKeysSource = (publicKeys: Readonly<Record<string, string>>) =>
	JSON.stringify(publicKeys, null, '\t');

export const renderAbsoluteMobileUpdateRegistry = (options: {
	publicKeys: Readonly<Record<string, string>>;
	storage: 'local' | 's3';
}) => {
	const metadata = `export const absoluteMobileUpdateServer = {\n\tformat: 1,\n\tprovider: '${options.storage}',\n\tstorage: '${options.storage === 'local' ? 'local' : 'durable'}'\n} as const;`;
	if (options.storage === 'local')
		return `import { fileURLToPath } from 'node:url';\nimport { localBlobStore } from '@absolutejs/blob/local';\nimport { createMobileUpdateRegistry } from '@absolutejs/deploy/mobile-update';\n\n${metadata}\n\nconst store = localBlobStore({\n\troot: process.env.ABSOLUTE_MOBILE_UPDATE_LOCAL_ROOT ??\n\t\tfileURLToPath(new URL('./.absolutejs/mobile/update-registry/', import.meta.url))\n});\n\nexport default createMobileUpdateRegistry({\n\tpublicKeys: ${publicKeysSource(options.publicKeys)},\n\tstore\n});\n`;

	return `import { S3Client } from '@aws-sdk/client-s3';\nimport { awsS3BlobStore } from '@absolutejs/blob/aws-s3';\nimport { createMobileUpdateRegistry } from '@absolutejs/deploy/mobile-update';\n\n${metadata}\n\nconst required = (name: string) => {\n\tconst value = process.env[name];\n\tif (!value) throw new Error(\`Missing \${name}\`);\n\treturn value;\n};\n\nconst client = new S3Client({\n\tregion: process.env.ABSOLUTE_MOBILE_UPDATE_S3_REGION ?? 'auto',\n\tforcePathStyle: process.env.ABSOLUTE_MOBILE_UPDATE_S3_FORCE_PATH_STYLE === '1',\n\t...(process.env.ABSOLUTE_MOBILE_UPDATE_S3_ENDPOINT\n\t\t? { endpoint: process.env.ABSOLUTE_MOBILE_UPDATE_S3_ENDPOINT }\n\t\t: {})\n});\nconst store = awsS3BlobStore({\n\tbucket: required('ABSOLUTE_MOBILE_UPDATE_S3_BUCKET'),\n\tclient\n});\n\nexport default createMobileUpdateRegistry({\n\tpublicKeys: ${publicKeysSource(options.publicKeys)},\n\tstore\n});\n`;
};

export const writeAbsoluteMobileUpdateRegistry = async (options: {
	force?: boolean;
	modulePath?: string;
	projectRoot: string;
	publicKeys: Readonly<Record<string, string>>;
	storage: 'local' | 's3';
}) => {
	const path = projectPath(
		options.projectRoot,
		options.modulePath ?? DEFAULT_MOBILE_UPDATE_REGISTRY_MODULE
	);
	if (!options.force) {
		await access(path).then(
			() => {
				throw new TypeError(
					`Mobile update registry already exists: ${path}. Pass --force to replace it.`
				);
			},
			() => undefined
		);
	}
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(
		path,
		renderAbsoluteMobileUpdateRegistry({
			publicKeys: options.publicKeys,
			storage: options.storage
		})
	);

	return path;
};
