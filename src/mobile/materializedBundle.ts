import { createHash } from 'node:crypto';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	verifyAbsoluteMobileCompatibilityProducer,
	type AbsoluteMobileStoredCompatibilityRelease
} from './artifactStore';
import type {
	AbsoluteMobileCompatibilityDispatcherOptions,
	AbsoluteMobileCompatibilityProducerHandler
} from './compatibilityDispatcher';
import {
	parseAbsoluteMobileCompatibilityArtifact,
	retainAbsoluteMobileCompatibilityArtifacts,
	type AbsoluteMobileCompatibilityArtifact
} from './releaseArtifact';

export const ABSOLUTE_MOBILE_MATERIALIZED_BUNDLE_FORMAT = 1 as const;

export type AbsoluteMobileMaterializedBundleInput = {
	currentReleaseId: string;
	releases: readonly AbsoluteMobileStoredCompatibilityRelease[];
	root: string;
};

export type AbsoluteMobileMaterializedBundleIndex = {
	bundleId: string;
	currentReleaseId: string;
	format: typeof ABSOLUTE_MOBILE_MATERIALIZED_BUNDLE_FORMAT;
	releases: AbsoluteMobileCompatibilityArtifact[];
};

type CompatibilityModule = Record<string, unknown>;
type CompatibilityModuleLoader = (
	modulePath: string
) => Promise<CompatibilityModule>;

const CURRENT_BUNDLE_FILE = 'current.json';
const BUNDLES_DIRECTORY = 'bundles';
const ARTIFACT_FILE = 'artifact.json';
const BUNDLE_ID_PATTERN = /^amb_[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const errorHasCode = (error: unknown, code: string) =>
	typeof error === 'object' &&
	error !== null &&
	Reflect.get(error, 'code') === code;

const bundleIdFor = (
	currentReleaseId: string,
	releases: readonly AbsoluteMobileCompatibilityArtifact[]
) => {
	const identity = JSON.stringify({
		currentReleaseId,
		releases: releases.map(({ releaseId }) => releaseId)
	});

	return `amb_${createHash('sha256').update(identity).digest('hex')}`;
};

const parseBundleIndex = (value: unknown) => {
	if (
		!isRecord(value) ||
		value.format !== ABSOLUTE_MOBILE_MATERIALIZED_BUNDLE_FORMAT ||
		typeof value.bundleId !== 'string' ||
		!BUNDLE_ID_PATTERN.test(value.bundleId) ||
		typeof value.currentReleaseId !== 'string' ||
		!Array.isArray(value.releases)
	) {
		throw new TypeError(
			'Invalid materialized mobile compatibility bundle.'
		);
	}
	const releases = value.releases.map(
		parseAbsoluteMobileCompatibilityArtifact
	);
	const retained = retainAbsoluteMobileCompatibilityArtifacts(releases);
	if (
		retained.length !== releases.length ||
		retained.some(
			({ releaseId }, index) => releaseId !== releases[index]?.releaseId
		)
	) {
		throw new TypeError(
			'Materialized mobile bundle releases are not a retained generation window.'
		);
	}
	const expectedBundleId = bundleIdFor(value.currentReleaseId, releases);
	if (value.bundleId !== expectedBundleId) {
		throw new TypeError('Materialized mobile bundle integrity failed.');
	}
	if (releases[0]?.releaseId !== value.currentReleaseId) {
		throw new TypeError(
			'Materialized mobile bundle current release is not its newest generation.'
		);
	}

	return {
		bundleId: value.bundleId,
		currentReleaseId: value.currentReleaseId,
		format: ABSOLUTE_MOBILE_MATERIALIZED_BUNDLE_FORMAT,
		releases
	} satisfies AbsoluteMobileMaterializedBundleIndex;
};

const writeRelease = async (
	root: string,
	release: AbsoluteMobileStoredCompatibilityRelease
) => {
	const directory = join(root, release.artifact.releaseId);
	const producerPath = join(directory, release.artifact.producer.module);
	await mkdir(dirname(producerPath), { recursive: true });
	await Promise.all([
		writeFile(
			join(directory, ARTIFACT_FILE),
			`${JSON.stringify(release.artifact, null, '\t')}\n`
		),
		writeFile(
			producerPath,
			new Uint8Array(await release.producer.arrayBuffer())
		)
	]);
};

const installImmutableBundle = async (
	bundlesRoot: string,
	bundleId: string,
	releases: readonly AbsoluteMobileStoredCompatibilityRelease[]
) => {
	const destination = join(bundlesRoot, bundleId);
	try {
		await access(destination);

		return destination;
	} catch (error) {
		if (!errorHasCode(error, 'ENOENT')) throw error;
	}

	const staging = await mkdtemp(join(bundlesRoot, '.stage-'));
	try {
		await Promise.all(
			releases.map((release) => writeRelease(staging, release))
		);
		await rename(staging, destination);
	} catch (error) {
		await rm(staging, { force: true, recursive: true });
		if (errorHasCode(error, 'EEXIST') || errorHasCode(error, 'ENOTEMPTY')) {
			return destination;
		}

		throw error;
	}

	return destination;
};

const readCompatibilityModule: CompatibilityModuleLoader = (modulePath) =>
	import(pathToFileURL(modulePath).href);

const resolveProducerHandler = (
	loaded: CompatibilityModule,
	exportName: string
) => {
	const value = loaded[exportName];
	if (!isRecord(value) || typeof value.handle !== 'function') {
		throw new TypeError(
			`Compatibility producer export ${exportName} must expose handle(request).`
		);
	}

	const { handle } = value;

	return {
		handle: async (request) => {
			const response: unknown = await Reflect.apply(handle, value, [
				request
			]);
			if (!(response instanceof Response)) {
				throw new TypeError(
					`Compatibility producer ${exportName} returned a non-Response value.`
				);
			}

			return response;
		}
	} satisfies AbsoluteMobileCompatibilityProducerHandler;
};

export const loadAbsoluteMobileMaterializedBundle = async (
	root: string
): Promise<AbsoluteMobileCompatibilityDispatcherOptions> => {
	const resolvedRoot = resolvePath(root);
	const serialized = await readFile(
		join(resolvedRoot, CURRENT_BUNDLE_FILE),
		'utf8'
	);
	const parsed: unknown = JSON.parse(serialized);
	const index = parseBundleIndex(parsed);
	const bundleRoot = join(resolvedRoot, BUNDLES_DIRECTORY, index.bundleId);

	return {
		artifacts: index.releases,
		currentReleaseId: index.currentReleaseId,
		loadProducer: async (artifact) => {
			const modulePath = join(
				bundleRoot,
				artifact.releaseId,
				artifact.producer.module
			);
			await verifyAbsoluteMobileCompatibilityProducer({
				artifact,
				producer: Bun.file(modulePath)
			});
			const loaded = await readCompatibilityModule(modulePath);

			return resolveProducerHandler(loaded, artifact.producer.exportName);
		}
	};
};

export const materializeAbsoluteMobileCompatibilityBundle = async (
	input: AbsoluteMobileMaterializedBundleInput
) => {
	const releases = await Promise.all(
		input.releases.map((release) =>
			verifyAbsoluteMobileCompatibilityProducer(release)
		)
	);
	const artifacts = retainAbsoluteMobileCompatibilityArtifacts(
		releases.map(({ artifact }) => artifact)
	);
	if (artifacts.length !== releases.length) {
		throw new TypeError(
			'Materialization input must already contain only retained releases.'
		);
	}
	if (artifacts[0]?.releaseId !== input.currentReleaseId) {
		throw new TypeError(
			'Materialization current release must be the newest generation.'
		);
	}
	const orderedReleases = artifacts.map((artifact) => {
		const release = releases.find(
			(candidate) => candidate.artifact.releaseId === artifact.releaseId
		);
		if (!release) {
			throw new TypeError('Materialization input is missing a producer.');
		}

		return release;
	});
	const root = resolvePath(input.root);
	const bundlesRoot = join(root, BUNDLES_DIRECTORY);
	await mkdir(bundlesRoot, { recursive: true });
	const bundleId = bundleIdFor(input.currentReleaseId, artifacts);
	await installImmutableBundle(bundlesRoot, bundleId, orderedReleases);
	const index = {
		bundleId,
		currentReleaseId: input.currentReleaseId,
		format: ABSOLUTE_MOBILE_MATERIALIZED_BUNDLE_FORMAT,
		releases: artifacts
	} satisfies AbsoluteMobileMaterializedBundleIndex;
	const pointerPath = join(root, CURRENT_BUNDLE_FILE);
	const temporaryPointerPath = join(
		root,
		`.current-${crypto.randomUUID()}.json`
	);
	await writeFile(
		temporaryPointerPath,
		`${JSON.stringify(index, null, '\t')}\n`,
		{ flag: 'wx' }
	);
	await rename(temporaryPointerPath, pointerPath);

	return index;
};
