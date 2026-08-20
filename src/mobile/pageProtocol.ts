import {
	getCurrentAbsoluteMobileProducerContext,
	type AbsoluteMobileProducerContext
} from './producerContextState';

export const ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE =
	'application/vnd.absolute.page+json';
export const ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION = 1 as const;
const BAD_REQUEST_STATUS = 400;
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

type ParsedMobilePageRequest =
	| { kind: 'not-mobile' }
	| { kind: 'invalid'; message: string }
	| { kind: 'mobile'; client: AbsoluteMobilePageClient };

type FinalizeAbsoluteMobilePageInput<Props> = {
	compatibility: AbsoluteMobilePageCompatibility<Props>;
	props: Props;
	request: Request | undefined;
	status?: number;
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

export const finalizeAbsoluteMobilePage = <Props>(
	input: FinalizeAbsoluteMobilePageInput<Props>
) => {
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
