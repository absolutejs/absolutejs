import { Elysia } from 'elysia';
import {
	createAbsoluteMobileInvalidRequestResponse,
	createAbsoluteMobilePageErrorResponse,
	createAbsoluteMobileUpgradeResponse,
	parseAbsoluteMobilePageRequest
} from './pageProtocol';
import {
	resolveAbsoluteMobileCompatibilityRelease,
	retainAbsoluteMobileCompatibilityArtifacts,
	type AbsoluteMobileCompatibilityArtifact
} from './releaseArtifact';
import {
	getCurrentAbsoluteMobileProducerContext,
	runWithAbsoluteMobileProducer
} from './producerContext';

export type AbsoluteMobileCompatibilityProducerHandler = {
	handle: (request: Request) => Promise<Response> | Response;
};

export type AbsoluteMobileCompatibilityProducerLoader = (
	artifact: AbsoluteMobileCompatibilityArtifact
) => Promise<AbsoluteMobileCompatibilityProducerHandler>;

export type AbsoluteMobileCompatibilityDispatcherOptions = {
	artifacts: readonly AbsoluteMobileCompatibilityArtifact[];
	currentReleaseId: string;
	loadProducer: AbsoluteMobileCompatibilityProducerLoader;
};

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

const routeSegmentPattern = (segment: string) => {
	if (segment === '*') return '.*';
	if (segment.startsWith(':') && segment.endsWith('?')) return '[^/]*';
	if (segment.startsWith(':')) return '[^/]+';

	return segment.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
};

const matchesRoutePattern = (pattern: string, pathname: string) => {
	const expression = pattern.split('/').map(routeSegmentPattern).join('/');

	return new RegExp(`^${expression}/?$`).test(pathname);
};

const artifactOwnsRequest = (
	artifact: AbsoluteMobileCompatibilityArtifact,
	pageId: string,
	request: Request
) => {
	const { pathname } = new URL(request.url);

	return artifact.routes.some(
		(route) =>
			route.pageId === pageId &&
			route.method === request.method &&
			matchesRoutePattern(route.pattern, pathname)
	);
};

const createProducerResolver = (
	loadProducer: AbsoluteMobileCompatibilityProducerLoader
) => {
	const producers = new Map<
		string,
		Promise<AbsoluteMobileCompatibilityProducerHandler>
	>();

	return (artifact: AbsoluteMobileCompatibilityArtifact) => {
		const cached = producers.get(artifact.releaseId);
		if (cached) return cached;

		const loading = loadProducer(artifact).catch((error: unknown) => {
			producers.delete(artifact.releaseId);

			throw error;
		});
		producers.set(artifact.releaseId, loading);

		return loading;
	};
};

export const createAbsoluteMobileCompatibilityDispatcher = (
	options: AbsoluteMobileCompatibilityDispatcherOptions
) => {
	const artifacts = retainAbsoluteMobileCompatibilityArtifacts(
		options.artifacts
	);
	if (
		!artifacts.some(
			({ releaseId }) => releaseId === options.currentReleaseId
		)
	) {
		throw new TypeError(
			'currentReleaseId must identify a retained compatibility artifact.'
		);
	}
	const resolveProducer = createProducerResolver(options.loadProducer);

	return new Elysia({ name: 'absolutejs-mobile-compatibility-dispatcher' })
		.request(async ({ request }) => {
			if (getCurrentAbsoluteMobileProducerContext()) return undefined;
			const parsed = parseAbsoluteMobilePageRequest(request);
			if (parsed.kind !== 'mobile') return undefined;

			const resolved = resolveAbsoluteMobileCompatibilityRelease(
				parsed.client,
				artifacts
			);
			if (resolved.kind === 'upgrade-required') {
				return createAbsoluteMobileUpgradeResponse(resolved.result);
			}
			if (
				!artifactOwnsRequest(
					resolved.artifact,
					parsed.client.pageId,
					request
				)
			) {
				return createAbsoluteMobileInvalidRequestResponse(
					'The requested URL is not assigned to this mobile page.'
				);
			}
			if (resolved.artifact.releaseId === options.currentReleaseId) {
				return undefined;
			}

			try {
				const producer = await resolveProducer(resolved.artifact);

				return runWithAbsoluteMobileProducer(
					{
						page: resolved.page,
						releaseId: resolved.artifact.releaseId
					},
					() => producer.handle(request)
				);
			} catch (error) {
				console.error(
					`[Mobile] Failed to load retained producer ${resolved.artifact.releaseId}:`,
					error
				);

				return createAbsoluteMobilePageErrorResponse(
					parsed.client.pageId
				);
			}
		})
		.as('global');
};
