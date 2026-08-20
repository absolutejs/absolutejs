import { createHash } from 'node:crypto';
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import {
	parseAbsoluteMobileCompatibilityArtifact,
	retainAbsoluteMobileCompatibilityArtifacts,
	type AbsoluteMobileCompatibilityArtifact
} from './releaseArtifact';

export type AbsoluteMobileStoredCompatibilityRelease = {
	artifact: AbsoluteMobileCompatibilityArtifact;
	producer: Blob;
};

export type AbsoluteMobileCompatibilityArtifactStore = {
	delete: (appId: string, releaseId: string) => Promise<void>;
	list: (appId: string) => Promise<AbsoluteMobileCompatibilityArtifact[]>;
	read: (
		appId: string,
		releaseId: string
	) => Promise<AbsoluteMobileStoredCompatibilityRelease | null>;
	write: (release: AbsoluteMobileStoredCompatibilityRelease) => Promise<void>;
};

export type AbsoluteMobileFileArtifactStoreOptions = {
	maxProducerBytes?: number;
	root: string;
};

export type AbsoluteMobileBlobStore = {
	delete: (key: string) => Promise<void>;
	get: (key: string) => Promise<Uint8Array | null>;
	list: (options: { cursor?: string; prefix: string }) => Promise<{
		cursor?: string;
		objects: Array<{ key: string }>;
		truncated: boolean;
	}>;
	put: (
		key: string,
		body: ReadableStream<Uint8Array> | Uint8Array | string,
		options?: {
			contentType?: string;
			maxBytes?: number;
			metadata?: Record<string, string>;
		}
	) => Promise<unknown>;
};

export type AbsoluteMobileBlobArtifactStoreOptions = {
	maxProducerBytes?: number;
	prefix?: string;
	store: AbsoluteMobileBlobStore;
};

export type AbsoluteMobileCarryForwardInput = {
	current: AbsoluteMobileStoredCompatibilityRelease;
	store: AbsoluteMobileCompatibilityArtifactStore;
};

const DEFAULT_MAX_PRODUCER_BYTES = 134_217_728;
const SHA_256 = 'sha256';
const ARTIFACT_FILE = 'artifact.json';
const RELEASE_ID_PATTERN = /^amc_[a-f0-9]{64}$/;
const DEFAULT_BLOB_PREFIX = 'absolutejs/mobile-compatibility';

const hashBlob = async (blob: Blob) => {
	const bytes = new Uint8Array(await blob.arrayBuffer());

	return createHash(SHA_256).update(bytes).digest('hex');
};

const blobFromBytes = (bytes: Uint8Array) => {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);

	return new Blob([buffer]);
};

const errorHasCode = (error: unknown, code: string) =>
	typeof error === 'object' &&
	error !== null &&
	Reflect.get(error, 'code') === code;

const appDirectoryName = (appId: string) =>
	createHash(SHA_256).update(appId).digest('hex');

const requireReleaseId = (releaseId: string) => {
	if (!RELEASE_ID_PATTERN.test(releaseId)) {
		throw new TypeError('Invalid mobile compatibility release id.');
	}

	return releaseId;
};

const readStoredArtifact = async (releaseDirectory: string) => {
	const serialized = await readFile(
		join(releaseDirectory, ARTIFACT_FILE),
		'utf8'
	);
	const parsed: unknown = JSON.parse(serialized);

	return parseAbsoluteMobileCompatibilityArtifact(parsed);
};

const validateStoredIdentity = (
	artifact: AbsoluteMobileCompatibilityArtifact,
	appId: string,
	releaseId: string
) => {
	if (artifact.appId !== appId || artifact.releaseId !== releaseId) {
		throw new TypeError(
			'Stored mobile compatibility identity does not match.'
		);
	}

	return artifact;
};

type BlobKeyLister = (
	store: AbsoluteMobileBlobStore,
	prefix: string,
	cursor?: string,
	keys?: string[]
) => Promise<string[]>;

const listBlobKeys: BlobKeyLister = async (
	store,
	prefix,
	cursor,
	keys = []
) => {
	const result = await store.list({ cursor, prefix });
	const collected = [...keys, ...result.objects.map(({ key }) => key)];
	if (!result.truncated) return collected;
	if (!result.cursor) {
		throw new TypeError('Truncated blob listing did not provide a cursor.');
	}

	return listBlobKeys(store, prefix, result.cursor, collected);
};

const normalizeBlobPrefix = (prefix: string) => {
	const normalized = prefix.replace(/^\/+|\/+$/g, '');
	if (!normalized || normalized.split('/').includes('..')) {
		throw new TypeError('Mobile compatibility blob prefix is invalid.');
	}

	return normalized;
};
export const carryForwardAbsoluteMobileCompatibilityReleases = async (
	input: AbsoluteMobileCarryForwardInput
) => {
	await verifyAbsoluteMobileCompatibilityProducer(input.current);
	await input.store.write(input.current);
	const available = await input.store.list(input.current.artifact.appId);
	const retained = retainAbsoluteMobileCompatibilityArtifacts(available);
	if (retained[0]?.releaseId !== input.current.artifact.releaseId) {
		throw new TypeError(
			'Current mobile release generation must be newer than stored history.'
		);
	}
	const releases = await Promise.all(
		retained.map(({ releaseId }) =>
			input.store.read(input.current.artifact.appId, releaseId)
		)
	);

	return Promise.all(
		releases.map((release) => {
			if (!release) {
				throw new TypeError(
					'Compatibility store listed a release it could not read.'
				);
			}

			return verifyAbsoluteMobileCompatibilityProducer(release);
		})
	);
};

export const createAbsoluteMobileBlobArtifactStore = (
	options: AbsoluteMobileBlobArtifactStoreOptions
): AbsoluteMobileCompatibilityArtifactStore => {
	const prefix = normalizeBlobPrefix(options.prefix ?? DEFAULT_BLOB_PREFIX);
	const maxProducerBytes =
		options.maxProducerBytes ?? DEFAULT_MAX_PRODUCER_BYTES;
	const appPrefix = (appId: string) =>
		`${prefix}/${appDirectoryName(appId)}/releases`;
	const releasePrefix = (appId: string, releaseId: string) =>
		`${appPrefix(appId)}/${requireReleaseId(releaseId)}`;
	const artifactKey = (appId: string, releaseId: string) =>
		`${releasePrefix(appId, releaseId)}/${ARTIFACT_FILE}`;
	const producerKey = (artifact: AbsoluteMobileCompatibilityArtifact) =>
		`${releasePrefix(artifact.appId, artifact.releaseId)}/${artifact.producer.module}`;
	const readArtifact = async (appId: string, releaseId: string) => {
		const bytes = await options.store.get(artifactKey(appId, releaseId));
		if (!bytes) return null;
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

		return validateStoredIdentity(
			parseAbsoluteMobileCompatibilityArtifact(parsed),
			appId,
			releaseId
		);
	};

	return {
		delete: async (appId, releaseId) => {
			const artifact = await readArtifact(appId, releaseId);
			if (artifact) await options.store.delete(producerKey(artifact));
			await options.store.delete(artifactKey(appId, releaseId));
		},
		list: async (appId) => {
			const releaseRoot = `${appPrefix(appId)}/`;
			const keys = await listBlobKeys(options.store, releaseRoot);
			const releaseIds = keys
				.filter((key) => key.endsWith(`/${ARTIFACT_FILE}`))
				.map((key) => key.slice(releaseRoot.length).split('/')[0])
				.filter(
					(releaseId): releaseId is string =>
						typeof releaseId === 'string' &&
						RELEASE_ID_PATTERN.test(releaseId)
				);
			const artifacts = await Promise.all(
				[...new Set(releaseIds)].map((releaseId) =>
					readArtifact(appId, releaseId)
				)
			);

			return artifacts
				.filter(
					(
						artifact
					): artifact is AbsoluteMobileCompatibilityArtifact =>
						artifact !== null
				)
				.sort((left, right) => right.generation - left.generation);
		},
		read: async (appId, releaseId) => {
			const artifact = await readArtifact(appId, releaseId);
			if (!artifact) return null;
			const bytes = await options.store.get(producerKey(artifact));
			if (!bytes) {
				throw new TypeError(
					'Mobile compatibility artifact is missing its producer.'
				);
			}

			return { artifact, producer: blobFromBytes(bytes) };
		},
		write: async (release) => {
			const artifact = parseAbsoluteMobileCompatibilityArtifact(
				release.artifact
			);
			const validated = await verifyAbsoluteMobileCompatibilityProducer(
				{ artifact, producer: release.producer },
				maxProducerBytes
			);
			await options.store.put(
				producerKey(validated.artifact),
				validated.producer.stream(),
				{
					contentType: 'text/javascript; charset=utf-8',
					maxBytes: maxProducerBytes,
					metadata: {
						appId: validated.artifact.appId,
						releaseId: validated.artifact.releaseId,
						sha256: validated.artifact.producer.bundleHash
					}
				}
			);
			await options.store.put(
				artifactKey(
					validated.artifact.appId,
					validated.artifact.releaseId
				),
				`${JSON.stringify(validated.artifact, null, '\t')}\n`,
				{ contentType: 'application/json' }
			);
		}
	};
};

export const createAbsoluteMobileFileArtifactStore = (
	options: AbsoluteMobileFileArtifactStoreOptions
): AbsoluteMobileCompatibilityArtifactStore => {
	const root = resolvePath(options.root);
	const maxProducerBytes =
		options.maxProducerBytes ?? DEFAULT_MAX_PRODUCER_BYTES;
	const appDirectory = (appId: string) => join(root, appDirectoryName(appId));
	const releaseDirectory = (appId: string, releaseId: string) =>
		join(appDirectory(appId), requireReleaseId(releaseId));
	const acceptExistingRelease = async (
		error: unknown,
		artifact: AbsoluteMobileCompatibilityArtifact
	) => {
		if (
			!errorHasCode(error, 'EEXIST') &&
			!errorHasCode(error, 'ENOTEMPTY')
		) {
			return false;
		}
		const existing = await readStoredArtifact(
			releaseDirectory(artifact.appId, artifact.releaseId)
		);

		return existing.releaseId === artifact.releaseId;
	};

	return {
		delete: async (appId, releaseId) => {
			await rm(releaseDirectory(appId, releaseId), {
				force: true,
				recursive: true
			});
		},
		list: async (appId) => {
			let entries;
			try {
				entries = await readdir(appDirectory(appId), {
					withFileTypes: true
				});
			} catch (error) {
				if (errorHasCode(error, 'ENOENT')) return [];

				throw error;
			}
			const artifacts = await Promise.all(
				entries
					.filter(
						(entry) =>
							entry.isDirectory() &&
							RELEASE_ID_PATTERN.test(entry.name)
					)
					.map(async ({ name }) =>
						validateStoredIdentity(
							await readStoredArtifact(
								releaseDirectory(appId, name)
							),
							appId,
							name
						)
					)
			);

			return artifacts.sort(
				(left, right) => right.generation - left.generation
			);
		},
		read: async (appId, releaseId) => {
			const directory = releaseDirectory(appId, releaseId);
			let artifact;
			try {
				artifact = validateStoredIdentity(
					await readStoredArtifact(directory),
					appId,
					releaseId
				);
			} catch (error) {
				if (errorHasCode(error, 'ENOENT')) return null;

				throw error;
			}

			return {
				artifact,
				producer: Bun.file(join(directory, artifact.producer.module))
			};
		},
		write: async (release) => {
			const validatedArtifact = parseAbsoluteMobileCompatibilityArtifact(
				release.artifact
			);
			const validated = await verifyAbsoluteMobileCompatibilityProducer(
				{ artifact: validatedArtifact, producer: release.producer },
				maxProducerBytes
			);
			const parent = appDirectory(validated.artifact.appId);
			await mkdir(parent, { recursive: true });
			const staging = await mkdtemp(join(parent, '.stage-'));
			const producerPath = join(
				staging,
				validated.artifact.producer.module
			);
			try {
				await mkdir(resolvePath(producerPath, '..'), {
					recursive: true
				});
				await Promise.all([
					writeFile(
						join(staging, ARTIFACT_FILE),
						`${JSON.stringify(validated.artifact, null, '\t')}\n`
					),
					writeFile(
						producerPath,
						new Uint8Array(await validated.producer.arrayBuffer())
					)
				]);
				await rename(
					staging,
					releaseDirectory(
						validated.artifact.appId,
						validated.artifact.releaseId
					)
				);
			} catch (error) {
				await rm(staging, { force: true, recursive: true });
				if (await acceptExistingRelease(error, validated.artifact))
					return;

				throw error;
			}
		}
	};
};

export const verifyAbsoluteMobileCompatibilityProducer = async (
	release: AbsoluteMobileStoredCompatibilityRelease,
	maxProducerBytes = DEFAULT_MAX_PRODUCER_BYTES
) => {
	const { artifact, producer } = release;
	if (
		producer.size !== artifact.producer.bytes ||
		producer.size > maxProducerBytes
	) {
		throw new TypeError(
			'Mobile compatibility producer size does not match its artifact.'
		);
	}
	if ((await hashBlob(producer)) !== artifact.producer.bundleHash) {
		throw new TypeError(
			'Mobile compatibility producer hash does not match its artifact.'
		);
	}

	return release;
};
