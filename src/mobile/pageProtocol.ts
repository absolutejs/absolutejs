import {
	getCurrentAbsoluteMobileProducerContext,
	type AbsoluteMobileProducerContext
} from './producerContextState';

export const ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE =
	'application/vnd.absolute.page+json';
export const ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION = 1 as const;
export const ABSOLUTE_NATIVE_ROUTE_DATA_MEDIA_TYPE =
	'application/vnd.absolute.native-route+json';
/** Web route data: the props + asset list a browser `<Link>` prefetches
 *  alongside the document so the click that follows has the page's
 *  modules, CSS and data warm. Unlike the mobile media types it needs no
 *  client identity headers, is served in every environment, and is
 *  cacheable (`ETag` + `must-revalidate`) so a prefetch and the request
 *  that follows it can 304. */
export const ABSOLUTE_ROUTE_DATA_MEDIA_TYPE =
	'application/vnd.absolute.route+json';
export const ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION = 1 as const;
const BAD_REQUEST_STATUS = 400;
const METHOD_NOT_ALLOWED_STATUS = 405;
const NOT_MODIFIED_STATUS = 304;
const OK_STATUS = 200;
const SERVER_ERROR_STATUS = 500;
const UPGRADE_REQUIRED_STATUS = 426;

export const MOBILE_PAGE_REQUEST_HEADERS = {
	appBuild: 'x-absolute-mobile-app-build',
	pageBundle: 'x-absolute-mobile-page-bundle',
	pageContracts: 'x-absolute-mobile-page-contracts',
	pageId: 'x-absolute-mobile-page-id',
	protocol: 'x-absolute-mobile-protocol',
	runtime: 'x-absolute-mobile-runtime'
} as const;

export type AbsoluteMobilePageFramework =
	| 'angular'
	| 'ember'
	| 'html'
	| 'htmx'
	| 'react'
	| 'svelte'
	| 'vue';

export type AbsoluteMobilePageClient = {
	appBuild: string;
	pageBundle: string;
	pageContracts: string[];
	pageId: string;
	protocol: number;
	runtime: string;
};

export type AbsoluteMobilePageRepresentation<Props> = {
	/** Stable data contract understood by an embedded page bundle. */
	contract: string;
	/**
	 * Adapts the current route props to an older compatible contract. The
	 * current representation normally uses the identity function.
	 */
	mapProps: (props: Props) => Record<string, unknown>;
};

export type AbsoluteMobilePageCompatibility<Props> = {
	framework: AbsoluteMobilePageFramework;
	pageId: string;
	/** Newest representation first, followed by retained compatibility forms. */
	representations: readonly AbsoluteMobilePageRepresentation<Props>[];
	/** Current runtime plus every retained compatible runtime generation. */
	runtimes: readonly string[];
};

export type AbsoluteMobilePageResult = {
	kind: 'page';
	contract: string;
	framework: AbsoluteMobilePageFramework;
	pageId: string;
	props: Record<string, unknown>;
	status: number;
};

export type AbsoluteMobileUpgradeReason =
	| 'app-release'
	| 'page-contract'
	| 'protocol'
	| 'runtime';

export type AbsoluteMobileUpgradeRequiredResult = {
	kind: 'upgrade-required';
	reason: AbsoluteMobileUpgradeReason;
	pageId: string;
	supportedContracts?: string[];
	supportedRuntimes?: string[];
};

export type AbsoluteMobileInvalidRequestResult = {
	kind: 'invalid-request';
	message: string;
};

export type AbsoluteMobilePageErrorResult = {
	code: 'representation-failed';
	kind: 'error';
	pageId: string;
	status: typeof SERVER_ERROR_STATUS;
};

export type AbsoluteMobilePageEnvelope = {
	protocol: typeof ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION;
	response:
		| AbsoluteMobilePageErrorResult
		| AbsoluteMobileInvalidRequestResult
		| AbsoluteMobilePageResult
		| AbsoluteMobileUpgradeRequiredResult;
};

/** Hashed asset URLs a client can warm before navigating to the page. */
export type AbsoluteRouteDataAssets = {
	/** The page's client entry (hydration index). Absent for static pages. */
	index?: string;
	/** A separate client module besides the index, when the page has one. */
	client?: string;
	/** Stylesheets the page's `<head>` links. */
	css: string[];
};

export type AbsoluteRouteDataHead = {
	title?: string;
};

/** What a page handler knows about its assets / head when it answers a
 *  route-data request. Everything is optional: a handler without a
 *  `<head>` (React) still serves props + index. */
export type AbsoluteRouteDataInput = {
	assets?: {
		index?: string;
		client?: string;
		css?: readonly string[];
	};
	head?: AbsoluteRouteDataHead;
};

export type AbsoluteRouteDataEnvelope = {
	protocol: typeof ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION;
	kind: 'route';
	pageId: string;
	framework: AbsoluteMobilePageFramework;
	props: Record<string, unknown>;
	status: number;
	assets: AbsoluteRouteDataAssets;
	head?: AbsoluteRouteDataHead;
};

export type AbsoluteRouteDataErrorEnvelope = {
	protocol: typeof ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION;
	kind: 'error';
	code: 'representation-failed';
	pageId: string;
	status: typeof SERVER_ERROR_STATUS;
};

type ParsedMobilePageRequest =
	| { kind: 'not-mobile' }
	| { kind: 'invalid'; message: string }
	| { kind: 'mobile'; client: AbsoluteMobilePageClient };

type FinalizeAbsoluteMobilePageInput<Props> = {
	compatibility: AbsoluteMobilePageCompatibility<Props>;
	props: Props;
	request: Request | undefined;
	status?: number;
	/** Assets / head for the web route-data representation. A thunk is
	 *  only invoked for a route-data request, so handlers can defer the
	 *  `<head>` scan behind it. */
	route?: AbsoluteRouteDataInput | (() => AbsoluteRouteDataInput);
};

const parseMediaType = (value: string) =>
	value.split(';', 1)[0]?.trim().toLowerCase();

export const acceptsAbsoluteMobilePage = (request: Request | undefined) => {
	if (!request) return false;

	return (request.headers.get('accept') ?? '')
		.split(',')
		.some(
			(value) => parseMediaType(value) === ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE
		);
};

export const acceptsAbsoluteNativeRouteData = (
	request: Request | undefined
) => {
	if (!request) return false;

	return (request.headers.get('accept') ?? '')
		.split(',')
		.some(
			(value) =>
				parseMediaType(value) === ABSOLUTE_NATIVE_ROUTE_DATA_MEDIA_TYPE
		);
};

export const acceptsAbsoluteRouteData = (request: Request | undefined) => {
	if (!request) return false;

	return (request.headers.get('accept') ?? '')
		.split(',')
		.some(
			(value) => parseMediaType(value) === ABSOLUTE_ROUTE_DATA_MEDIA_TYPE
		);
};

const readRequiredHeader = (request: Request, name: string) => {
	const value = request.headers.get(name)?.trim();

	return value ? value : undefined;
};

export const parseAbsoluteMobilePageRequest = (
	request: Request | undefined
): ParsedMobilePageRequest => {
	if (!request || !acceptsAbsoluteMobilePage(request)) {
		return { kind: 'not-mobile' };
	}

	const protocolValue = readRequiredHeader(
		request,
		MOBILE_PAGE_REQUEST_HEADERS.protocol
	);
	const runtime = readRequiredHeader(
		request,
		MOBILE_PAGE_REQUEST_HEADERS.runtime
	);
	const appBuild = readRequiredHeader(
		request,
		MOBILE_PAGE_REQUEST_HEADERS.appBuild
	);
	const pageBundle = readRequiredHeader(
		request,
		MOBILE_PAGE_REQUEST_HEADERS.pageBundle
	);
	const pageContractsValue = readRequiredHeader(
		request,
		MOBILE_PAGE_REQUEST_HEADERS.pageContracts
	);
	const pageId = readRequiredHeader(
		request,
		MOBILE_PAGE_REQUEST_HEADERS.pageId
	);

	if (!protocolValue || !/^\d+$/.test(protocolValue)) {
		return {
			kind: 'invalid',
			message: `Missing or invalid ${MOBILE_PAGE_REQUEST_HEADERS.protocol} header.`
		};
	}
	if (!runtime) {
		return {
			kind: 'invalid',
			message: `Missing ${MOBILE_PAGE_REQUEST_HEADERS.runtime} header.`
		};
	}
	if (!appBuild) {
		return {
			kind: 'invalid',
			message: `Missing ${MOBILE_PAGE_REQUEST_HEADERS.appBuild} header.`
		};
	}
	if (!pageBundle) {
		return {
			kind: 'invalid',
			message: `Missing ${MOBILE_PAGE_REQUEST_HEADERS.pageBundle} header.`
		};
	}
	if (!pageContractsValue) {
		return {
			kind: 'invalid',
			message: `Missing ${MOBILE_PAGE_REQUEST_HEADERS.pageContracts} header.`
		};
	}
	if (!pageId) {
		return {
			kind: 'invalid',
			message: `Missing ${MOBILE_PAGE_REQUEST_HEADERS.pageId} header.`
		};
	}

	const pageContracts = [
		...new Set(
			pageContractsValue
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
	if (pageContracts.length === 0) {
		return {
			kind: 'invalid',
			message: `${MOBILE_PAGE_REQUEST_HEADERS.pageContracts} must contain at least one contract.`
		};
	}

	return {
		client: {
			appBuild,
			pageBundle,
			pageContracts,
			pageId,
			protocol: Number(protocolValue),
			runtime
		},
		kind: 'mobile'
	};
};

const responseHeaders = () => {
	const headers = new Headers({
		'cache-control': 'no-store',
		'content-type': `${ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE}; version=${ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION}`
	});
	headerVaryValues.forEach((value) => headers.append('vary', value));

	return headers;
};

const headerVaryValues = [
	'Accept',
	MOBILE_PAGE_REQUEST_HEADERS.protocol,
	MOBILE_PAGE_REQUEST_HEADERS.runtime,
	MOBILE_PAGE_REQUEST_HEADERS.appBuild,
	MOBILE_PAGE_REQUEST_HEADERS.pageBundle,
	MOBILE_PAGE_REQUEST_HEADERS.pageContracts,
	MOBILE_PAGE_REQUEST_HEADERS.pageId
];

const envelopeResponse = (
	response: AbsoluteMobilePageEnvelope['response'],
	status: number
) =>
	new Response(
		JSON.stringify({
			protocol: ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
			response
		} satisfies AbsoluteMobilePageEnvelope),
		{ headers: responseHeaders(), status }
	);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeJsonValue = (value: Record<string, unknown>) => {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new TypeError('Mobile page props must be JSON-serializable.');
	}

	const parsed: unknown = JSON.parse(serialized);
	if (!isRecord(parsed)) {
		throw new TypeError('Mobile page props must serialize to an object.');
	}

	return parsed;
};

const finalizeArchivedMobilePage = <Props>(
	context: AbsoluteMobileProducerContext,
	input: FinalizeAbsoluteMobilePageInput<Props>
) => {
	const { page } = context;
	if (
		page.pageId !== input.compatibility.pageId ||
		page.framework !== input.compatibility.framework
	) {
		return envelopeResponse(
			{
				kind: 'invalid-request',
				message:
					'Archived producer page identity does not match its release artifact.'
			},
			BAD_REQUEST_STATUS
		);
	}

	try {
		const [currentRepresentation] = input.compatibility.representations;
		if (!currentRepresentation) {
			throw new TypeError('Mobile page has no current representation.');
		}

		return envelopeResponse(
			{
				contract: page.contract,
				framework: page.framework,
				kind: 'page',
				pageId: page.pageId,
				props: normalizeJsonValue(
					currentRepresentation.mapProps(input.props)
				),
				status: input.status ?? OK_STATUS
			},
			input.status ?? OK_STATUS
		);
	} catch (error) {
		console.error(
			`[Mobile] Archived producer ${context.releaseId} failed for ${page.pageId}:`,
			error
		);

		return createAbsoluteMobilePageErrorResponse(page.pageId);
	}
};

const finalizeAbsoluteNativeRouteDevelopmentPage = <Props>(
	input: FinalizeAbsoluteMobilePageInput<Props>
) => {
	if (process.env.NODE_ENV !== 'development') {
		return createAbsoluteMobileInvalidRequestResponse(
			'The native-route development representation is disabled outside development.'
		);
	}
	if (input.request?.method !== 'GET') {
		return createAbsoluteMobileInvalidRequestResponse(
			'Native-route data requests must use GET.'
		);
	}
	if (
		input.request.headers.get(MOBILE_PAGE_REQUEST_HEADERS.protocol) !==
		String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION)
	) {
		return createAbsoluteMobileInvalidRequestResponse(
			`Native-route data requires protocol ${ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION}.`
		);
	}
	const [representation] = input.compatibility.representations;
	if (!representation) {
		return createAbsoluteMobilePageErrorResponse(
			input.compatibility.pageId
		);
	}

	try {
		return envelopeResponse(
			{
				contract: representation.contract,
				framework: input.compatibility.framework,
				kind: 'page',
				pageId: input.compatibility.pageId,
				props: normalizeJsonValue(representation.mapProps(input.props)),
				status: input.status ?? OK_STATUS
			},
			input.status ?? OK_STATUS
		);
	} catch (error) {
		console.error(
			`[Mobile] Failed to produce development native route ${input.compatibility.pageId}:`,
			error
		);

		return createAbsoluteMobilePageErrorResponse(
			input.compatibility.pageId
		);
	}
};

/* ------------------------------------------------------------------
 * Web route data
 * ---------------------------------------------------------------- */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const FNV_SECOND_SEED = 0x5bd1e995;
const HEX_RADIX = 16;
const HEX_WORD_LENGTH = 8;

const fnv1a32 = (value: string, seed: number) => {
	let hash = seed >>> 0;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}

	return hash;
};

const hexWord = (value: number) =>
	value.toString(HEX_RADIX).padStart(HEX_WORD_LENGTH, '0');

/** Weak content-hash ETag for a route-data body. Two seeded FNV-1a passes
 *  keep this dependency-free (this module ships in the mobile browser
 *  bundle, so `node:crypto` is off the table) while still telling any two
 *  realistic bodies apart. */
const routeDataEtag = (body: string) =>
	`W/"${hexWord(fnv1a32(body, FNV_OFFSET_BASIS))}${hexWord(
		fnv1a32(body, FNV_OFFSET_BASIS ^ FNV_SECOND_SEED)
	)}"`;

const ROUTE_DATA_CACHE_CONTROL = 'private, max-age=0, must-revalidate';

const routeDataHeaders = (etag?: string) => {
	const headers = new Headers({
		'cache-control': etag ? ROUTE_DATA_CACHE_CONTROL : 'no-store',
		'content-type': `${ABSOLUTE_ROUTE_DATA_MEDIA_TYPE}; version=${ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION}`,
		vary: 'Accept'
	});
	if (etag) headers.set('etag', etag);

	return headers;
};

const matchesIfNoneMatch = (request: Request, etag: string) => {
	const header = request.headers.get('if-none-match');
	if (!header) return false;

	return header
		.split(',')
		.map((value) => value.trim())
		.some((value) => value === '*' || value === etag);
};

const resolveRouteDataInput = <Props>(
	input: FinalizeAbsoluteMobilePageInput<Props>
) => (typeof input.route === 'function' ? input.route() : (input.route ?? {}));

const buildRouteDataAssets = (
	assets: AbsoluteRouteDataInput['assets']
): AbsoluteRouteDataAssets => ({
	...(assets?.index ? { index: assets.index } : {}),
	...(assets?.client ? { client: assets.client } : {}),
	css: [...new Set((assets?.css ?? []).filter((href) => href.length > 0))]
});

const buildRouteDataHead = (head: AbsoluteRouteDataHead | undefined) =>
	head?.title ? { title: head.title } : undefined;

const createRouteDataErrorResponse = (pageId: string) =>
	new Response(
		JSON.stringify({
			code: 'representation-failed',
			kind: 'error',
			pageId,
			protocol: ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION,
			status: SERVER_ERROR_STATUS
		} satisfies AbsoluteRouteDataErrorEnvelope),
		{ headers: routeDataHeaders(), status: SERVER_ERROR_STATUS }
	);

export const createAbsoluteMobileInvalidRequestResponse = (message: string) =>
	envelopeResponse({ kind: 'invalid-request', message }, BAD_REQUEST_STATUS);

export const createAbsoluteMobilePageErrorResponse = (pageId: string) =>
	envelopeResponse(
		{
			code: 'representation-failed',
			kind: 'error',
			pageId,
			status: SERVER_ERROR_STATUS
		},
		SERVER_ERROR_STATUS
	);

export const createAbsoluteMobileUpgradeResponse = (
	result: AbsoluteMobileUpgradeRequiredResult
) => envelopeResponse(result, UPGRADE_REQUIRED_STATUS);

/**
 * Serve the web route-data representation of a page when the request
 * asks for `application/vnd.absolute.route+json`; `undefined` otherwise.
 *
 * GET only, negotiated on `Accept` alone (no client identity headers),
 * available in every environment. The body is the page's props plus the
 * asset URLs a client needs to warm before navigating, and it carries a
 * content-hash `ETag` with `private, max-age=0, must-revalidate` so the
 * browser keeps a prefetched copy and revalidates it with a 304.
 */
export const finalizeAbsoluteRouteData = <Props>(
	input: FinalizeAbsoluteMobilePageInput<Props>
) => {
	if (!acceptsAbsoluteRouteData(input.request)) return undefined;
	const { request } = input;
	if (!request || request.method !== 'GET') {
		return new Response(null, {
			headers: { allow: 'GET', vary: 'Accept' },
			status: METHOD_NOT_ALLOWED_STATUS
		});
	}
	const { pageId } = input.compatibility;
	const [representation] = input.compatibility.representations;
	if (!representation) return createRouteDataErrorResponse(pageId);

	let body: string;
	const status = input.status ?? OK_STATUS;
	try {
		const route = resolveRouteDataInput(input);
		const head = buildRouteDataHead(route.head);
		const envelope: AbsoluteRouteDataEnvelope = {
			assets: buildRouteDataAssets(route.assets),
			framework: input.compatibility.framework,
			...(head ? { head } : {}),
			kind: 'route',
			pageId,
			props: normalizeJsonValue(representation.mapProps(input.props)),
			protocol: ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION,
			status
		};
		body = JSON.stringify(envelope);
	} catch (error) {
		console.error(
			`[Route] Failed to produce route data for ${pageId}:`,
			error
		);

		return createRouteDataErrorResponse(pageId);
	}

	const etag = routeDataEtag(body);
	if (matchesIfNoneMatch(request, etag)) {
		return new Response(null, {
			headers: routeDataHeaders(etag),
			status: NOT_MODIFIED_STATUS
		});
	}

	return new Response(body, { headers: routeDataHeaders(etag), status });
};

const ABSOLUTE_MEDIA_TYPE_MARKER = /vnd\.absolute/i;

/** Every AbsoluteJS page media type carries the `vnd.absolute` tree, so an
 *  Accept header without it is an ordinary browser request. Checking the raw
 *  header first keeps the common SSR path free of Accept parsing and of any
 *  allocation, and it never reads `compatibility`, so callers can defer that
 *  work behind a getter. */
const mentionsAbsoluteMediaType = (request: Request | undefined) => {
	const accept = request?.headers.get('accept');

	return (
		typeof accept === 'string' && ABSOLUTE_MEDIA_TYPE_MARKER.test(accept)
	);
};

export const finalizeAbsoluteMobilePage = <Props>(
	input: FinalizeAbsoluteMobilePageInput<Props>
) => {
	if (!mentionsAbsoluteMediaType(input.request)) return undefined;
	if (acceptsAbsoluteNativeRouteData(input.request)) {
		return finalizeAbsoluteNativeRouteDevelopmentPage(input);
	}
	const routeData = finalizeAbsoluteRouteData(input);
	if (routeData) return routeData;
	const parsed = parseAbsoluteMobilePageRequest(input.request);
	if (parsed.kind === 'not-mobile') return undefined;
	if (parsed.kind === 'invalid') {
		return envelopeResponse(
			{ kind: 'invalid-request', message: parsed.message },
			BAD_REQUEST_STATUS
		);
	}

	const { client } = parsed;
	if (client.pageId !== input.compatibility.pageId) {
		return envelopeResponse(
			{
				kind: 'invalid-request',
				message: `Requested mobile page ${client.pageId} does not match ${input.compatibility.pageId}.`
			},
			BAD_REQUEST_STATUS
		);
	}
	const producerContext = getCurrentAbsoluteMobileProducerContext();
	if (producerContext)
		return finalizeArchivedMobilePage(producerContext, input);
	if (client.protocol !== ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION) {
		return envelopeResponse(
			{
				kind: 'upgrade-required',
				pageId: input.compatibility.pageId,
				reason: 'protocol'
			},
			UPGRADE_REQUIRED_STATUS
		);
	}
	if (!input.compatibility.runtimes.includes(client.runtime)) {
		return envelopeResponse(
			{
				kind: 'upgrade-required',
				pageId: input.compatibility.pageId,
				reason: 'runtime',
				supportedRuntimes: [...input.compatibility.runtimes]
			},
			UPGRADE_REQUIRED_STATUS
		);
	}

	const clientContracts = new Set(client.pageContracts);
	const representation = input.compatibility.representations.find(
		({ contract }) => clientContracts.has(contract)
	);
	if (!representation) {
		return envelopeResponse(
			{
				kind: 'upgrade-required',
				pageId: input.compatibility.pageId,
				reason: 'page-contract',
				supportedContracts: input.compatibility.representations.map(
					({ contract }) => contract
				)
			},
			UPGRADE_REQUIRED_STATUS
		);
	}

	try {
		return envelopeResponse(
			{
				contract: representation.contract,
				framework: input.compatibility.framework,
				kind: 'page',
				pageId: input.compatibility.pageId,
				props: normalizeJsonValue(representation.mapProps(input.props)),
				status: input.status ?? OK_STATUS
			},
			input.status ?? OK_STATUS
		);
	} catch (error) {
		console.error(
			`[Mobile] Failed to produce ${input.compatibility.pageId} representation ${representation.contract}:`,
			error
		);

		return envelopeResponse(
			{
				code: 'representation-failed',
				kind: 'error',
				pageId: input.compatibility.pageId,
				status: SERVER_ERROR_STATUS
			},
			SERVER_ERROR_STATUS
		);
	}
};
