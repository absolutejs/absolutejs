import { Elysia } from 'elysia';
import {
	createAbsoluteMobileInvalidRequestResponse,
	createAbsoluteMobilePageErrorResponse,
	createAbsoluteMobileUpgradeResponse,
	MOBILE_PAGE_REQUEST_HEADERS,
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
import { matchesAbsoluteMobileRoutePattern } from './routeMatcher';

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

const MOBILE_WEBVIEW_ORIGINS = new Set([
	'capacitor://localhost',
	'http://localhost',
	'https://localhost'
]);
const MOBILE_REQUEST_HEADER_NAMES = Object.values(MOBILE_PAGE_REQUEST_HEADERS);
const MOBILE_CORS_ALLOW_HEADERS = [
	'accept',
	'content-type',
	'authorization',
	'hx-current-url',
	'hx-request',
	'hx-target',
	'hx-trigger',
	'hx-trigger-name',
	...MOBILE_REQUEST_HEADER_NAMES
].join(', ');
const MOBILE_CORS_METHODS = new Set([
	'DELETE',
	'GET',
	'HEAD',
	'OPTIONS',
	'PATCH',
	'POST',
	'PUT'
]);

const mobileWebViewOrigin = (request: Request) => {
	const origin = request.headers.get('origin');

	return origin && MOBILE_WEBVIEW_ORIGINS.has(origin) ? origin : undefined;
};

const applyMobileCorsHeaders = (response: Response, origin: string) => {
	response.headers.set('access-control-allow-credentials', 'true');
	response.headers.set('access-control-allow-origin', origin);
	response.headers.append('vary', 'Origin');

	return response;
};

const finalizeMobileResponse = (request: Request, response: Response) => {
	const origin = mobileWebViewOrigin(request);

	return origin ? applyMobileCorsHeaders(response, origin) : response;
};

const mobilePreflightResponse = (request: Request) => {
	if (request.method !== 'OPTIONS') return undefined;
	const origin = mobileWebViewOrigin(request);
	if (!origin) return undefined;
	const requestedHeaders = request.headers.get(
		'access-control-request-headers'
	);
	const requestedMethod =
		request.headers.get('access-control-request-method')?.toUpperCase() ??
		'';
	if (!MOBILE_CORS_METHODS.has(requestedMethod)) return undefined;

	return new Response(null, {
		headers: {
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers':
				requestedHeaders || MOBILE_CORS_ALLOW_HEADERS,
			'access-control-allow-methods': [...MOBILE_CORS_METHODS].join(', '),
			'access-control-allow-origin': origin,
			'access-control-max-age': '600',
			vary: 'Origin, Access-Control-Request-Headers'
		},
		status: 204
	});
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
			matchesAbsoluteMobileRoutePattern(route.pattern, pathname)
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
			const preflight = mobilePreflightResponse(request);
			if (preflight) return preflight;
			const parsed = parseAbsoluteMobilePageRequest(request);
			if (parsed.kind !== 'mobile') return undefined;

			const resolved = resolveAbsoluteMobileCompatibilityRelease(
				parsed.client,
				artifacts
			);
			if (resolved.kind === 'upgrade-required') {
				return finalizeMobileResponse(
					request,
					createAbsoluteMobileUpgradeResponse(resolved.result)
				);
			}
			if (
				!artifactOwnsRequest(
					resolved.artifact,
					parsed.client.pageId,
					request
				)
			) {
				return finalizeMobileResponse(
					request,
					createAbsoluteMobileInvalidRequestResponse(
						'The requested URL is not assigned to this mobile page.'
					)
				);
			}
			if (resolved.artifact.releaseId === options.currentReleaseId) {
				return undefined;
			}

			try {
				const producer = await resolveProducer(resolved.artifact);

				const response = await runWithAbsoluteMobileProducer(
					{
						page: resolved.page,
						releaseId: resolved.artifact.releaseId
					},
					() => producer.handle(request)
				);

				return finalizeMobileResponse(request, response);
			} catch (error) {
				console.error(
					`[Mobile] Failed to load retained producer ${resolved.artifact.releaseId}:`,
					error
				);

				return finalizeMobileResponse(
					request,
					createAbsoluteMobilePageErrorResponse(parsed.client.pageId)
				);
			}
		})
		.afterHandle('global', ({ request, responseValue }) => {
			const origin = mobileWebViewOrigin(request);
			if (!origin || !(responseValue instanceof Response)) return;

			applyMobileCorsHeaders(responseValue, origin);
		})
		.as('global');
};
