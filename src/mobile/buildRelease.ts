import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Elysia } from 'elysia';
import {
	ABSOLUTE_MOBILE_ROUTE_DETAIL,
	parseAbsoluteMobileBuildPageMetadata,
	type AbsoluteMobileBuildPageMetadata
} from './buildMetadata';
import {
	createAbsoluteMobileCompatibilityArtifact,
	type AbsoluteMobileCompatibilityArtifact,
	type AbsoluteMobileCompatibilityPage,
	type AbsoluteMobileCompatibilityRoute
} from './releaseArtifact';
import type { AbsoluteMobileStoredCompatibilityRelease } from './artifactStore';

export type AbsoluteMobileBuildReleaseOptions = {
	app: Pick<Elysia, 'compile' | 'modules' | 'routes'>;
	appId: string;
	buildDirectory: string;
	manifest: Record<string, string>;
	previousArtifacts?: readonly AbsoluteMobileCompatibilityArtifact[];
	producerExport?: string;
	producerModule?: string;
	producerPath: string;
	runtime: string;
};

const sha256 = (bytes: Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex');

const readPageMetadata = (route: {
	hooks?: { detail?: Record<string, unknown> };
}) =>
	parseAbsoluteMobileBuildPageMetadata(
		route.hooks?.detail?.[ABSOLUTE_MOBILE_ROUTE_DETAIL]
	);

const resolveAssetPath = (buildDirectory: string, assetPath: string) => {
	const resolvedBuildDirectory = resolve(buildDirectory);
	const resolvedAsset = resolve(assetPath);
	if (resolvedAsset.startsWith(`${resolvedBuildDirectory}/`)) {
		return resolvedAsset;
	}

	return join(buildDirectory, assetPath.replace(/^\/+/, ''));
};

const pageFor = async (
	metadata: AbsoluteMobileBuildPageMetadata,
	manifest: Record<string, string>,
	buildDirectory: string
) => {
	const assetPath = manifest[metadata.bundleKey];
	if (!assetPath) {
		throw new TypeError(
			`Mobile page ${metadata.pageId} references missing manifest asset ${metadata.bundleKey}.`
		);
	}
	const resolvedAssetPath = resolveAssetPath(buildDirectory, assetPath);
	const pageAssetKey = metadata.bundleKey.replace(/Index$/u, '');
	const styleAssetPath = [
		`${pageAssetKey}BundledCSS`,
		`${pageAssetKey}CompiledCSS`
	]
		.map((key) => manifest[key])
		.find((path): path is string => typeof path === 'string');
	const resolvedStylePath = styleAssetPath
		? resolveAssetPath(buildDirectory, styleAssetPath)
		: undefined;
	const [bytes, styleBytes] = await Promise.all([
		readFile(resolvedAssetPath),
		resolvedStylePath ? readFile(resolvedStylePath) : undefined
	]);
	const bundlePath = `/${relative(resolve(buildDirectory), resolvedAssetPath).replaceAll('\\', '/')}`;
	const styleBundlePath = resolvedStylePath
		? `/${relative(resolve(buildDirectory), resolvedStylePath).replaceAll('\\', '/')}`
		: undefined;

	return {
		bundleHash: sha256(bytes),
		bundlePath,
		contract: metadata.contract,
		framework: metadata.framework,
		pageId: metadata.pageId,
		propsSchemaHash: metadata.propsSchemaHash,
		...(styleBytes && styleBundlePath
			? {
					styleBundleHash: sha256(styleBytes),
					styleBundlePath
				}
			: {})
	} satisfies AbsoluteMobileCompatibilityPage;
};

export const buildAbsoluteMobileCompatibilityRelease = async (
	options: AbsoluteMobileBuildReleaseOptions
): Promise<AbsoluteMobileStoredCompatibilityRelease> => {
	const [captured, producerBytes] = await Promise.all([
		captureAbsoluteMobileRouteGraph(options.app),
		readFile(options.producerPath)
	]);
	if (captured.length === 0) {
		throw new TypeError(
			'No instrumented AbsoluteJS mobile page routes were found in the finalized Elysia route graph.'
		);
	}
	const metadataByPage = new Map<string, AbsoluteMobileBuildPageMetadata>();
	for (const { metadata } of captured) {
		const prior = metadataByPage.get(metadata.pageId);
		if (prior && JSON.stringify(prior) !== JSON.stringify(metadata)) {
			throw new TypeError(
				`Mobile page ${metadata.pageId} has inconsistent generated contracts.`
			);
		}
		metadataByPage.set(metadata.pageId, metadata);
	}
	const pages = await Promise.all(
		[...metadataByPage.values()].map((metadata) =>
			pageFor(metadata, options.manifest, options.buildDirectory)
		)
	);
	const producerHash = sha256(producerBytes);
	const appBuild = `ambuild_${sha256(
		new TextEncoder().encode(
			JSON.stringify({
				pages: pages.map(
					({
						bundleHash,
						bundlePath,
						contract,
						pageId,
						styleBundleHash,
						styleBundlePath
					}) => ({
						bundleHash,
						bundlePath,
						contract,
						pageId,
						...(styleBundleHash && styleBundlePath
							? { styleBundleHash, styleBundlePath }
							: {})
					})
				),
				producerHash,
				runtime: options.runtime
			})
		)
	)}`;
	const priorAppIds = new Set(
		(options.previousArtifacts ?? []).map(({ appId }) => appId)
	);
	if (
		priorAppIds.size > 1 ||
		(priorAppIds.size === 1 && !priorAppIds.has(options.appId))
	) {
		throw new TypeError(
			'Previous mobile compatibility artifacts belong to another app.'
		);
	}
	const unchanged = options.previousArtifacts?.find(
		(artifact) =>
			artifact.appBuild === appBuild &&
			artifact.runtime === options.runtime
	);
	const generation =
		unchanged?.generation ??
		Math.max(
			0,
			...(options.previousArtifacts ?? []).map(
				(artifact) => artifact.generation
			)
		) + 1;
	const artifact = createAbsoluteMobileCompatibilityArtifact({
		appBuild,
		appId: options.appId,
		generation,
		pages,
		producer: {
			bundleHash: producerHash,
			bytes: producerBytes.byteLength,
			exportName: options.producerExport ?? 'server',
			module: options.producerModule ?? 'producer.js'
		},
		routes: captured.map(({ route }) => route),
		runtime: options.runtime
	});

	return { artifact, producer: new Blob([producerBytes]) };
};
export const captureAbsoluteMobileRouteGraph = async (
	app: Pick<Elysia, 'compile' | 'modules' | 'routes'>
) => {
	if (app.modules) await app.modules;
	app.compile();
	const captured = app.routes.flatMap((route) => {
		const metadata = readPageMetadata(route);
		if (!metadata || (route.method !== 'GET' && route.method !== 'HEAD')) {
			return [];
		}

		return [
			{
				metadata,
				route: {
					method: route.method === 'GET' ? 'GET' : 'HEAD',
					pageId: metadata.pageId,
					pattern: route.path
				} satisfies AbsoluteMobileCompatibilityRoute
			}
		];
	});
	const identities = new Map<string, string>();
	for (const { metadata, route } of captured) {
		const prior = identities.get(`${route.method}:${route.pattern}`);
		if (prior && prior !== metadata.pageId) {
			throw new TypeError(
				`Mobile route ${route.method} ${route.pattern} resolves to multiple pages.`
			);
		}
		identities.set(`${route.method}:${route.pattern}`, metadata.pageId);
	}

	return captured;
};
