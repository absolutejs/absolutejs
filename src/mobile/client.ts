import {
	ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
	type AbsoluteMobilePageEnvelope,
	type AbsoluteMobilePageFramework,
	type AbsoluteMobilePageResult,
	type AbsoluteMobileUpgradeReason,
	type AbsoluteMobileUpgradeRequiredResult
} from './pageProtocol';

type AbsoluteMobileClientTarget = {
	__ABSOLUTE_PAGE_RENDER_MODE__?: 'client' | 'hydrate';
	__INITIAL_PROPS__?: Record<string, unknown>;
};

export type AbsoluteMobilePageLoader = (input: {
	contract: string;
	pageId: string;
}) => Promise<unknown>;

export type AbsoluteMobilePageActivation =
	| {
			kind: 'rendered';
			contract: string;
			pageId: string;
	  }
	| AbsoluteMobileUpgradeRequiredResult;

type AbsoluteMobilePageActivationOptions = {
	loadPage: AbsoluteMobilePageLoader;
	target?: AbsoluteMobileClientTarget;
};

export class AbsoluteMobilePageProtocolError extends Error {
	readonly code:
		| 'invalid-envelope'
		| 'invalid-props'
		| 'server-error'
		| 'server-rejected-request';

	constructor(
		code: AbsoluteMobilePageProtocolError['code'],
		message: string
	) {
		super(message);
		this.name = 'AbsoluteMobilePageProtocolError';
		this.code = code;
	}
}

const frameworks = new Set<string>([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);
const upgradeReasons = new Set<string>([
	'app-release',
	'page-contract',
	'protocol',
	'runtime'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isFramework = (value: unknown): value is AbsoluteMobilePageFramework =>
	typeof value === 'string' && frameworks.has(value);

const isUpgradeReason = (
	value: unknown
): value is AbsoluteMobileUpgradeReason =>
	typeof value === 'string' && upgradeReasons.has(value);

const parsePageResult = (
	value: Record<string, unknown>
): AbsoluteMobilePageResult => {
	if (
		typeof value.contract !== 'string' ||
		!isFramework(value.framework) ||
		typeof value.pageId !== 'string' ||
		typeof value.status !== 'number'
	) {
		throw new AbsoluteMobilePageProtocolError(
			'invalid-envelope',
			'The mobile page response is missing required page metadata.'
		);
	}
	if (!isRecord(value.props)) {
		throw new AbsoluteMobilePageProtocolError(
			'invalid-props',
			'The mobile page response must contain an object props value.'
		);
	}

	return {
		contract: value.contract,
		framework: value.framework,
		kind: 'page',
		pageId: value.pageId,
		props: value.props,
		status: value.status
	};
};

const parseUpgradeResult = (
	value: Record<string, unknown>
): AbsoluteMobileUpgradeRequiredResult => {
	if (typeof value.pageId !== 'string' || !isUpgradeReason(value.reason)) {
		throw new AbsoluteMobilePageProtocolError(
			'invalid-envelope',
			'The update response is missing its page or reason.'
		);
	}

	return {
		kind: 'upgrade-required',
		pageId: value.pageId,
		reason: value.reason,
		supportedContracts: Array.isArray(value.supportedContracts)
			? value.supportedContracts.filter(
					(contract): contract is string =>
						typeof contract === 'string'
				)
			: undefined,
		supportedRuntimes: Array.isArray(value.supportedRuntimes)
			? value.supportedRuntimes.filter(
					(runtime): runtime is string => typeof runtime === 'string'
				)
			: undefined
	};
};

export const activateAbsoluteMobilePage = async (
	value: unknown,
	options: AbsoluteMobilePageActivationOptions
) => {
	const envelope = parseAbsoluteMobilePageEnvelope(value);
	if (envelope.response.kind === 'upgrade-required') {
		return envelope.response;
	}
	if (envelope.response.kind !== 'page') {
		throw new AbsoluteMobilePageProtocolError(
			'invalid-envelope',
			'Expected a renderable mobile page response.'
		);
	}

	const target = options.target ?? window;
	target.__INITIAL_PROPS__ = envelope.response.props;
	target.__ABSOLUTE_PAGE_RENDER_MODE__ = 'client';
	await options.loadPage({
		contract: envelope.response.contract,
		pageId: envelope.response.pageId
	});

	return {
		contract: envelope.response.contract,
		kind: 'rendered',
		pageId: envelope.response.pageId
	} satisfies AbsoluteMobilePageActivation;
};

export const parseAbsoluteMobilePageEnvelope = (value: unknown) => {
	if (!isRecord(value) || !isRecord(value.response)) {
		throw new AbsoluteMobilePageProtocolError(
			'invalid-envelope',
			'The server did not return an AbsoluteJS mobile page envelope.'
		);
	}
	if (value.protocol !== ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION) {
		throw new AbsoluteMobilePageProtocolError(
			'invalid-envelope',
			`Unsupported mobile page protocol ${String(value.protocol)}.`
		);
	}

	const { kind } = value.response;
	if (kind === 'page') {
		return {
			protocol: ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
			response: parsePageResult(value.response)
		} satisfies AbsoluteMobilePageEnvelope;
	}
	if (kind === 'upgrade-required') {
		return {
			protocol: ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
			response: parseUpgradeResult(value.response)
		} satisfies AbsoluteMobilePageEnvelope;
	}
	if (kind === 'invalid-request') {
		throw new AbsoluteMobilePageProtocolError(
			'server-rejected-request',
			typeof value.response.message === 'string'
				? value.response.message
				: 'The server rejected the mobile page request.'
		);
	}
	if (kind === 'error') {
		throw new AbsoluteMobilePageProtocolError(
			'server-error',
			'The server could not create a compatible mobile page representation.'
		);
	}

	throw new AbsoluteMobilePageProtocolError(
		'invalid-envelope',
		`Unknown mobile page response kind ${String(kind)}.`
	);
};
