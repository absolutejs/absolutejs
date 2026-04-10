import { getStreamSwapRuntimeScript } from '../client/streamSwap';
import { BASE_36_RADIX, RANDOM_ID_END_INDEX } from '../constants';
import { escapeScriptContent } from './escapeScriptContent';

const SLOT_ID_PREFIX = 'abs-slot-';
const CLOSING_BODY_TAG = '</body>';
const CLOSING_HEAD_TAG = '</head>';
const CLOSING_BODY_TAG_LENGTH = CLOSING_BODY_TAG.length;
const CLOSING_HEAD_TAG_LENGTH = CLOSING_HEAD_TAG.length;
const CLOSING_PAGE_TAG_REGEX = /<\/body>\s*<\/html>\s*$/i;
const STREAMING_RUNTIME_GLOBAL = '__ABS_SLOT_ENQUEUE__';
const STREAMING_PENDING_GLOBAL = '__ABS_SLOT_PENDING__';
const STREAM_TAIL_LOOKBEHIND = 128;
const STREAMING_SLOT_TIMEOUT_MS = 5_000;
const STREAMING_SLOT_MAX_PER_RESPONSE = 128;
const STREAMING_SLOT_MAX_HTML_BYTES = 64_000;

type SlotResolver = () => Promise<unknown> | unknown;
type SlotErrorHandler = (error: unknown, slot: StreamingSlot) => void;
type StreamReader = ReadableStreamDefaultReader<string | Uint8Array>;
type StreamReadPromise = ReturnType<StreamReader['read']>;
export type StreamingSlotMetricType =
	| 'prepared'
	| 'dropped'
	| 'resolved'
	| 'patched'
	| 'timeout'
	| 'size_exceeded'
	| 'error';
export type StreamingSlotMetric = {
	type: StreamingSlotMetricType;
	slotId: string;
	durationMs?: number;
	bytes?: number;
	reason?: string;
	error?: unknown;
};
export type StreamingSlotMetricHandler = (metric: StreamingSlotMetric) => void;

export type StreamingSlotPolicy = {
	timeoutMs?: number;
	fallbackHtml?: unknown;
	errorHtml?: unknown;
	maxSlotsPerResponse?: number;
	maxSlotHtmlSizeBytes?: number;
	onError?: SlotErrorHandler;
	onSlotMetric?: StreamingSlotMetricHandler;
};

type StreamingSlotPolicyValue = {
	timeoutMs: number;
	fallbackHtml: string;
	errorHtml?: string;
	maxSlotsPerResponse: number;
	maxSlotHtmlSizeBytes: number;
	onError?: SlotErrorHandler;
	onSlotMetric?: StreamingSlotMetricHandler;
};

export type StreamingSlot = {
	errorHtml?: unknown;
	fallbackHtml?: unknown;
	id: string;
	timeoutMs?: number;
	resolve: SlotResolver;
};

export type StreamingSlotPatchPayload =
	| string
	| {
			[key: string]: unknown;
			html: string;
	  };

type DeferredStreamingSlot = Omit<StreamingSlot, 'id'> & { id?: string };

export type AppendStreamingSlotsOptions = {
	injectRuntime?: boolean;
	nonce?: string;
	runtimePreludeScript?: string;
	policy?: StreamingSlotPolicy;
	onSlotMetric?: StreamingSlotMetricHandler;
	onError?: (error: unknown, slot: StreamingSlot) => void;
	runtimePlacement?: 'body' | 'head';
};

export type StreamOutOfOrderSlotsOptions = {
	footerHtml?: string;
	headerHtml?: string;
	nonce?: string;
	policy?: StreamingSlotPolicy;
	onSlotMetric?: StreamingSlotMetricHandler;
	onError?: (error: unknown, slot: StreamingSlot) => void;
	slots: DeferredStreamingSlot[];
};

const createSlotPatchStatement = (
	id: string,
	payload: StreamingSlotPatchPayload
) =>
	`(window.${STREAMING_RUNTIME_GLOBAL}||function(i,p){window.${STREAMING_PENDING_GLOBAL}=window.${STREAMING_PENDING_GLOBAL}||{};window.${STREAMING_PENDING_GLOBAL}[i]=p;})(${JSON.stringify(id)},${JSON.stringify(payload)});`;

const createNonceAttr = (nonce?: string) => (nonce ? ` nonce="${nonce}"` : '');

export const createStreamingSlotId = () =>
	`${SLOT_ID_PREFIX}${Math.random().toString(BASE_36_RADIX).slice(2, RANDOM_ID_END_INDEX)}`;
export const getStreamingSlotsRuntimeScript = () =>
	getStreamSwapRuntimeScript();
export const injectHtmlIntoBody = (html: string, injection: string) => {
	const closingBodyIndex = html.indexOf(CLOSING_BODY_TAG);
	if (closingBodyIndex >= 0) {
		return `${html.slice(0, closingBodyIndex)}${injection}${html.slice(closingBodyIndex)}`;
	}

	return `${html}${injection}`;
};
export const injectHtmlIntoHead = (html: string, injection: string) => {
	const closingHeadIndex = html.indexOf(CLOSING_HEAD_TAG);
	if (closingHeadIndex >= 0) {
		return `${html.slice(0, closingHeadIndex)}${injection}${html.slice(closingHeadIndex)}`;
	}

	return `${html}${injection}`;
};
export const renderStreamingSlotPatchTag = (
	id: string,
	payload: StreamingSlotPatchPayload,
	nonce?: string
) =>
	`<script${createNonceAttr(nonce)}>${escapeScriptContent(
		createSlotPatchStatement(id, payload)
	)}</script>`;
export const renderStreamingSlotPlaceholder = (id: string, fallbackHtml = '') =>
	`<div id="${id}" data-absolute-slot="true" data-absolute-slot-state="fallback">${fallbackHtml}</div>`;
export const renderStreamingSlotsRuntimeTag = (
	nonce?: string,
	runtimePreludeScript?: string
) => {
	const runtimeBody = [
		runtimePreludeScript?.trim() ? runtimePreludeScript.trim() : '',
		getStreamingSlotsRuntimeScript()
	]
		.filter(Boolean)
		.join(';');

	return `<script${createNonceAttr(nonce)}>${escapeScriptContent(runtimeBody)}</script>`;
};

const toUint8 = (value: string, encoder: TextEncoder) => encoder.encode(value);

type SafeHtmlLike = {
	changingThisBreaksApplicationSecurity: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isSafeHtmlLike = (value: unknown): value is SafeHtmlLike =>
	isRecord(value) &&
	typeof value.changingThisBreaksApplicationSecurity === 'string';

const normalizeSafeHtml = (value: unknown) => {
	if (isSafeHtmlLike(value)) {
		return value.changingThisBreaksApplicationSecurity;
	}

	return value;
};

let currentStreamingSlotPolicy: StreamingSlotPolicyValue = {
	errorHtml: undefined,
	fallbackHtml: '',
	maxSlotHtmlSizeBytes: STREAMING_SLOT_MAX_HTML_BYTES,
	maxSlotsPerResponse: STREAMING_SLOT_MAX_PER_RESPONSE,
	timeoutMs: STREAMING_SLOT_TIMEOUT_MS
};

const clonePolicy = (
	policy: StreamingSlotPolicyValue
): StreamingSlotPolicyValue => ({
	...policy
});

const normalizeSlotBytes = (value: unknown, fallback: number) => {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
		return Math.floor(value);
	}

	return fallback;
};

const normalizeSlotText = (value: unknown, fallback: string) => {
	const normalizedValue = normalizeSafeHtml(value);

	return typeof normalizedValue === 'string' ? normalizedValue : fallback;
};
const normalizeSlotError = (
	value: unknown,
	fallback: string | undefined = undefined
) => {
	const safeValue = normalizeSafeHtml(value);
	if (typeof safeValue === 'string') return safeValue;

	return fallback;
};
const hasPolicyValue = (
	policy: StreamingSlotPolicy,
	key: keyof StreamingSlotPolicy
) => Object.prototype.hasOwnProperty.call(policy, key);

const applyStreamingSlotPolicyOverrides = (
	base: StreamingSlotPolicyValue,
	overridePolicy: StreamingSlotPolicy = {}
) => ({
	errorHtml: hasPolicyValue(overridePolicy, 'errorHtml')
		? normalizeSlotError(overridePolicy.errorHtml)
		: base.errorHtml,
	fallbackHtml: hasPolicyValue(overridePolicy, 'fallbackHtml')
		? normalizeSlotText(overridePolicy.fallbackHtml, '')
		: base.fallbackHtml,
	maxSlotHtmlSizeBytes: hasPolicyValue(overridePolicy, 'maxSlotHtmlSizeBytes')
		? normalizeSlotBytes(
				overridePolicy.maxSlotHtmlSizeBytes,
				base.maxSlotHtmlSizeBytes
			)
		: base.maxSlotHtmlSizeBytes,
	maxSlotsPerResponse: hasPolicyValue(overridePolicy, 'maxSlotsPerResponse')
		? normalizeSlotBytes(
				overridePolicy.maxSlotsPerResponse,
				base.maxSlotsPerResponse
			)
		: base.maxSlotsPerResponse,
	onError: hasPolicyValue(overridePolicy, 'onError')
		? overridePolicy.onError
		: base.onError,
	onSlotMetric: hasPolicyValue(overridePolicy, 'onSlotMetric')
		? overridePolicy.onSlotMetric
		: base.onSlotMetric,
	timeoutMs: hasPolicyValue(overridePolicy, 'timeoutMs')
		? normalizeSlotBytes(overridePolicy.timeoutMs, base.timeoutMs)
		: base.timeoutMs
});

const createCombinedSlotErrorHandler = (
	policyOnError?: SlotErrorHandler,
	enhancerOnError?: SlotErrorHandler
) => {
	if (!policyOnError && !enhancerOnError) return undefined;

	return (error: unknown, slot: StreamingSlot) => {
		policyOnError?.(error, slot);
		enhancerOnError?.(error, slot);
	};
};

const createCombinedSlotMetricHandler = (
	policyOnSlotMetric?: StreamingSlotMetricHandler,
	callOnSlotMetric?: StreamingSlotMetricHandler
) => {
	if (!policyOnSlotMetric && !callOnSlotMetric) return undefined;

	return (metric: StreamingSlotMetric) => {
		policyOnSlotMetric?.(metric);
		callOnSlotMetric?.(metric);
	};
};

const resolveStreamingSlotPolicy = (
	overridePolicy: StreamingSlotPolicy = {}
) => {
	const base = getStreamingSlotPolicy();

	return applyStreamingSlotPolicyOverrides(base, overridePolicy);
};

export const getStreamingSlotPolicy = () =>
	clonePolicy(currentStreamingSlotPolicy);

export const setStreamingSlotPolicy = (policy: StreamingSlotPolicy = {}) => {
	const base = getStreamingSlotPolicy();

	currentStreamingSlotPolicy = applyStreamingSlotPolicyOverrides(
		base,
		policy
	);
};

export const withStreamingSlotPolicy = async <T>(
	policy: StreamingSlotPolicy,
	callback: () => Promise<T> | T
) => {
	const previous = getStreamingSlotPolicy();

	setStreamingSlotPolicy(policy);
	try {
		return await callback();
	} finally {
		currentStreamingSlotPolicy = previous;
	}
};

const emitSlotMetric = (
	metric: StreamingSlotMetric,
	onSlotMetric?: StreamingSlotMetricHandler
) => {
	onSlotMetric?.(metric);
};

const createTimeoutError = (slot: StreamingSlot, timeoutMs: number) => {
	const error = Object.assign(
		new Error(`Streaming slot "${slot.id}" timed out after ${timeoutMs}ms`),
		{ __absTimeout: true }
	);

	return error;
};

const isSlotPatchPayloadObject = (
	value: unknown
): value is Record<string, unknown> & { html: unknown } =>
	isRecord(value) && 'html' in value;

const isTimeoutError = (
	error: unknown
): error is Error & { __absTimeout: true } =>
	isRecord(error) && error.__absTimeout === true;

const toStreamingSlot = (
	slot: DeferredStreamingSlot,
	policy: StreamingSlotPolicyValue
): StreamingSlot => ({
	errorHtml: slot.errorHtml === undefined ? policy.errorHtml : slot.errorHtml,
	fallbackHtml: normalizeSlotText(slot.fallbackHtml, policy.fallbackHtml),
	id: slot.id ?? createStreamingSlotId(),
	resolve: slot.resolve,
	timeoutMs: normalizeSlotBytes(slot.timeoutMs, policy.timeoutMs)
});

const prepareSlots = ({
	policy,
	slots,
	onError,
	onSlotMetric
}: {
	policy: StreamingSlotPolicyValue;
	slots: DeferredStreamingSlot[];
	onError?: SlotErrorHandler;
	onSlotMetric?: StreamingSlotMetricHandler;
}) => {
	const preparedSlots = slots.map((slot) => toStreamingSlot(slot, policy));
	const emitPreparedSlotMetric = (slot: StreamingSlot) => {
		emitSlotMetric(
			{
				slotId: slot.id,
				type: 'prepared'
			},
			onSlotMetric
		);
	};
	const dropPreparedSlot = (slot: StreamingSlot, reason: string) => {
		onError?.(new Error(reason), slot);
		emitSlotMetric(
			{
				reason,
				slotId: slot.id,
				type: 'dropped'
			},
			onSlotMetric
		);
	};

	const { maxSlotsPerResponse } = policy;
	if (maxSlotsPerResponse === 0) {
		preparedSlots.forEach((slot) =>
			dropPreparedSlot(slot, 'maxSlotsPerResponse is 0')
		);

		return [];
	}

	if (preparedSlots.length <= maxSlotsPerResponse) {
		preparedSlots.forEach(emitPreparedSlotMetric);

		return preparedSlots;
	}

	const keptSlots = preparedSlots.slice(0, maxSlotsPerResponse);
	const droppedSlots = preparedSlots.slice(maxSlotsPerResponse);
	droppedSlots.forEach((slot) => {
		dropPreparedSlot(
			slot,
			`Streaming slot "${slot.id}" dropped because ${maxSlotsPerResponse} slots is the configured maximum`
		);
	});
	keptSlots.forEach(emitPreparedSlotMetric);

	return keptSlots;
};

const htmlByteLength = (value: string, encoder: TextEncoder) =>
	encoder.encode(value).length;

type ResolvedStreamingSlot = {
	payload: StreamingSlotPatchPayload | null;
	id: string;
	durationMs: number;
	bytes: number;
};

const normalizeSlotPatchPayload = (value: unknown) => {
	const safeValue = normalizeSafeHtml(value);
	if (
		isSlotPatchPayloadObject(safeValue) &&
		typeof safeValue.html === 'string'
	) {
		return {
			...safeValue,
			html: normalizeSlotText(safeValue.html, '')
		};
	}

	return typeof safeValue === 'string' ? safeValue : `${safeValue}`;
};

const getPayloadHtml = (payload: StreamingSlotPatchPayload) =>
	typeof payload === 'string' ? payload : payload.html;

const enqueueEncodedText = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	encoder: TextEncoder,
	value: string
) => {
	if (value.length === 0) {
		return;
	}

	controller.enqueue(encoder.encode(value));
};

const readStreamingRuntimeChunk = async (
	reader: ReadableStreamDefaultReader<string | Uint8Array>
) => {
	const { done, value } = await reader.read();
	if (done || !value) {
		return { done, value: undefined };
	}

	return { done, value };
};

const applyBaseWinnerState = (
	state: {
		baseDone: boolean;
		baseRead: StreamReadPromise;
		footer: string;
		handled: boolean;
		tail: string;
	},
	winner:
		| {
				done: boolean;
				kind: 'base';
				value?: string | Uint8Array;
		  }
		| {
				kind: 'slot';
				original: Promise<{
					payload: StreamingSlotPatchPayload | null;
					id: string;
					durationMs: number;
					bytes: number;
				}>;
				result: {
					payload: StreamingSlotPatchPayload | null;
					id: string;
					durationMs: number;
					bytes: number;
				};
		  },
	handleResolved: (winner: {
		kind: 'slot';
		original: Promise<{
			payload: StreamingSlotPatchPayload | null;
			id: string;
			durationMs: number;
			bytes: number;
		}>;
		result: {
			payload: StreamingSlotPatchPayload | null;
			id: string;
			durationMs: number;
			bytes: number;
		};
	}) => void
) => {
	if (!state.handled && winner.kind === 'slot') {
		handleResolved(winner);
	}

	return state;
};

const resolveOversizedSlotPayload = (input: {
	encoder: TextEncoder;
	html: string;
	maxSlotHtmlSizeBytes: number;
	onError?: SlotErrorHandler;
	onSlotMetric?: StreamingSlotMetricHandler;
	slot: StreamingSlot;
	start: number;
}) => {
	const {
		encoder,
		html,
		maxSlotHtmlSizeBytes,
		onError,
		onSlotMetric,
		slot,
		start
	} = input;
	const bytes = htmlByteLength(html, encoder);
	if (bytes <= maxSlotHtmlSizeBytes) {
		return null;
	}

	const error = new Error(
		`Streaming slot "${slot.id}" exceeded max payload size of ${maxSlotHtmlSizeBytes} bytes`
	);
	const durationMs = Date.now() - start;
	onError?.(error, slot);
	emitSlotMetric(
		{
			bytes,
			durationMs,
			error,
			slotId: slot.id,
			type: 'size_exceeded'
		},
		onSlotMetric
	);

	const fallbackHtml = normalizeSlotError(slot.errorHtml, undefined);

	return {
		bytes:
			fallbackHtml === undefined
				? 0
				: htmlByteLength(fallbackHtml, encoder),
		durationMs,
		id: slot.id,
		payload: fallbackHtml === undefined ? null : fallbackHtml
	};
};

const raceWithTimeout = (promise: Promise<unknown>, slot: StreamingSlot) => {
	const { timeoutMs } = slot;
	if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
		return promise;
	}

	const { promise: timeoutPromise, reject } =
		Promise.withResolvers<StreamingSlotPatchPayload>();

	setTimeout(() => {
		reject(createTimeoutError(slot, timeoutMs));
	}, timeoutMs);

	return Promise.race([promise, timeoutPromise]);
};

const resolveSlot = async (
	slot: StreamingSlot,
	onError?: SlotErrorHandler,
	policy?: StreamingSlotPolicyValue,
	onSlotMetric?: StreamingSlotMetricHandler
) => {
	const safePolicy = policy ?? getStreamingSlotPolicy();
	const encoder = new TextEncoder();
	const start = Date.now();
	try {
		const maybeAsyncValue = Promise.resolve(slot.resolve());
		const resolved = await raceWithTimeout(maybeAsyncValue, slot);
		const payload = normalizeSlotPatchPayload(resolved);
		const html = getPayloadHtml(payload);
		const oversizedResult =
			safePolicy.maxSlotHtmlSizeBytes > 0
				? resolveOversizedSlotPayload({
						encoder,
						html,
						maxSlotHtmlSizeBytes: safePolicy.maxSlotHtmlSizeBytes,
						onError,
						onSlotMetric,
						slot,
						start
					})
				: null;
		if (oversizedResult) {
			return oversizedResult;
		}
		const durationMs = Date.now() - start;
		const bytes = htmlByteLength(html, encoder);
		emitSlotMetric(
			{
				bytes,
				durationMs,
				slotId: slot.id,
				type: 'resolved'
			},
			onSlotMetric
		);

		return {
			bytes,
			durationMs,
			id: slot.id,
			payload
		};
	} catch (error) {
		const durationMs = Date.now() - start;
		onError?.(error, slot);
		emitSlotMetric(
			{
				durationMs,
				error,
				slotId: slot.id,
				type: isTimeoutError(error) ? 'timeout' : 'error'
			},
			onSlotMetric
		);
		const html = normalizeSlotError(slot.errorHtml, undefined);
		if (html) {
			return {
				bytes: htmlByteLength(html, encoder),
				durationMs,
				id: slot.id,
				payload: html
			};
		}

		return {
			bytes: 0,
			durationMs,
			id: slot.id,
			payload: null
		};
	}
};

const nextResolvedSlot = async (
	pending: Array<Promise<ResolvedStreamingSlot>>
) => {
	const wrapped = pending.map((promise) =>
		promise.then((result) => ({
			original: promise,
			result
		}))
	);

	return Promise.race(wrapped);
};

const streamChunkToString = (
	value: string | Uint8Array,
	decoder: TextDecoder
) =>
	typeof value === 'string' ? value : decoder.decode(value, { stream: true });

export const appendStreamingSlotPatchesToStream = (
	stream: ReadableStream<string | Uint8Array>,
	slots: DeferredStreamingSlot[] = [],
	{
		injectRuntime = true,
		nonce,
		onError,
		onSlotMetric,
		policy,
		runtimePreludeScript,
		runtimePlacement = 'head'
	}: AppendStreamingSlotsOptions = {}
) => {
	const resolvedPolicy = resolveStreamingSlotPolicy(policy);
	const combinedOnError = createCombinedSlotErrorHandler(
		resolvedPolicy.onError,
		onError
	);
	const combinedOnSlotMetric = createCombinedSlotMetricHandler(
		resolvedPolicy.onSlotMetric,
		onSlotMetric
	);
	const effectivePolicy: StreamingSlotPolicyValue = {
		...resolvedPolicy,
		onSlotMetric: combinedOnSlotMetric
	};
	const preparedSlots = prepareSlots({
		onError: combinedOnError,
		onSlotMetric: combinedOnSlotMetric,
		policy: effectivePolicy,
		slots
	});
	if (preparedSlots.length === 0) return stream;

	const source = injectRuntime
		? injectStreamingRuntimeIntoStream(
				stream,
				nonce,
				runtimePlacement,
				runtimePreludeScript
			)
		: stream;
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const reader = source.getReader();
	const pending: Array<Promise<ResolvedStreamingSlot>> = preparedSlots.map(
		(slot) =>
			resolveSlot(
				slot,
				combinedOnError,
				effectivePolicy,
				combinedOnSlotMetric
			)
	);
	const createRaceCandidates = (
		baseDone: boolean,
		baseRead: StreamReadPromise
	) => {
		const racers: Array<
			Promise<
				| {
						done: boolean;
						kind: 'base';
						value?: string | Uint8Array;
				  }
				| {
						kind: 'slot';
						original: Promise<{
							payload: StreamingSlotPatchPayload | null;
							id: string;
							durationMs: number;
							bytes: number;
						}>;
						result: {
							payload: StreamingSlotPatchPayload | null;
							id: string;
							durationMs: number;
							bytes: number;
						};
				  }
			>
		> = [];

		if (!baseDone) {
			racers.push(
				baseRead.then(({ done, value }) => ({
					done,
					kind: 'base' as const,
					value
				}))
			);
		}
		if (pending.length > 0) {
			racers.push(
				nextResolvedSlot(pending).then((resolved) => ({
					kind: 'slot' as const,
					...resolved
				}))
			);
		}

		return racers;
	};
	const flushTailLookbehind = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		tail: string
	) => {
		if (tail.length <= STREAM_TAIL_LOOKBEHIND) {
			return tail;
		}

		const content = tail.slice(0, tail.length - STREAM_TAIL_LOOKBEHIND);
		controller.enqueue(encoder.encode(content));

		return tail.slice(-STREAM_TAIL_LOOKBEHIND);
	};
	const finalizeCompletedBaseWinner = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		decodedTail: string,
		baseRead: StreamReadPromise
	) => {
		const footerStart = decodedTail.search(CLOSING_PAGE_TAG_REGEX);
		if (footerStart < 0) {
			enqueueEncodedText(controller, encoder, decodedTail);

			return {
				baseDone: true,
				baseRead,
				footer: '',
				handled: true,
				tail: ''
			};
		}

		const content = decodedTail.slice(0, footerStart);
		const nextFooter = decodedTail.slice(footerStart);
		enqueueEncodedText(controller, encoder, content);

		return {
			baseDone: true,
			baseRead,
			footer: nextFooter,
			handled: true,
			tail: ''
		};
	};
	const handleBaseWinner = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		winner:
			| {
					done: boolean;
					kind: 'base';
					value?: string | Uint8Array;
			  }
			| {
					kind: 'slot';
					original: Promise<{
						payload: StreamingSlotPatchPayload | null;
						id: string;
						durationMs: number;
						bytes: number;
					}>;
					result: {
						payload: StreamingSlotPatchPayload | null;
						id: string;
						durationMs: number;
						bytes: number;
					};
			  },
		baseRead: StreamReadPromise,
		tail: string,
		footer: string
	) => {
		if (winner.kind !== 'base') {
			return { baseDone: false, baseRead, footer, handled: false, tail };
		}

		if (winner.done) {
			return finalizeCompletedBaseWinner(
				controller,
				tail + decoder.decode(),
				baseRead
			);
		}

		if (!winner.value) {
			return { baseDone: false, baseRead, footer, handled: true, tail };
		}

		const nextTail = flushTailLookbehind(
			controller,
			tail + streamChunkToString(winner.value, decoder)
		);

		return {
			baseDone: false,
			baseRead: reader.read(),
			footer,
			handled: true,
			tail: nextTail
		};
	};
	const handleResolvedSlot = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		winner: {
			kind: 'slot';
			original: Promise<{
				payload: StreamingSlotPatchPayload | null;
				id: string;
				durationMs: number;
				bytes: number;
			}>;
			result: {
				payload: StreamingSlotPatchPayload | null;
				id: string;
				durationMs: number;
				bytes: number;
			};
		}
	) => {
		const index = pending.indexOf(winner.original);
		if (index >= 0) pending.splice(index, 1);
		if (winner.result.payload === null) {
			return;
		}

		emitSlotMetric(
			{
				bytes: winner.result.bytes,
				durationMs: winner.result.durationMs,
				slotId: winner.result.id,
				type: 'patched'
			},
			combinedOnSlotMetric
		);

		controller.enqueue(
			encoder.encode(
				renderStreamingSlotPatchTag(
					winner.result.id,
					winner.result.payload,
					nonce
				)
			)
		);
	};

	const runPatchedStreamLoop = async (
		controller: ReadableStreamDefaultController<Uint8Array>
	) => {
		let baseDone = false;
		let baseRead = reader.read();
		let tail = '';
		let footer = '';
		const readNextRaceWinner = async () => {
			const racers = createRaceCandidates(baseDone, baseRead);
			if (racers.length === 0) {
				return footer;
			}

			const winner = await Promise.race(racers);
			const baseWinnerState = applyBaseWinnerState(
				handleBaseWinner(controller, winner, baseRead, tail, footer),
				winner,
				(slotWinner) => {
					handleResolvedSlot(controller, slotWinner);
				}
			);
			({ baseDone, baseRead, footer, tail } = baseWinnerState);
			if (baseDone && pending.length === 0) {
				return footer;
			}

			return readNextRaceWinner();
		};

		return readNextRaceWinner();
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const footer = await runPatchedStreamLoop(controller);
				enqueueEncodedText(controller, encoder, footer);
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		}
	});
};
export const injectStreamingRuntimeIntoStream = (
	stream: ReadableStream<string | Uint8Array>,
	nonce?: string,
	runtimePlacement: 'body' | 'head' = 'head',
	runtimePreludeScript?: string
) => {
	const runtimeTag = renderStreamingSlotsRuntimeTag(
		nonce,
		runtimePreludeScript
	);
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const closingTag =
		runtimePlacement === 'body' ? CLOSING_BODY_TAG : CLOSING_HEAD_TAG;
	const lookbehind =
		(runtimePlacement === 'body'
			? CLOSING_BODY_TAG_LENGTH
			: CLOSING_HEAD_TAG_LENGTH) - 1;
	const flushRuntimeLookbehind = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string
	) => {
		if (pending.length <= lookbehind) {
			return pending;
		}

		const safeText = pending.slice(0, pending.length - lookbehind);
		controller.enqueue(encoder.encode(safeText));

		return pending.slice(-lookbehind);
	};
	const injectRuntimeIntoPending = (pending: string) =>
		runtimePlacement === 'body'
			? injectHtmlIntoBody(pending, runtimeTag)
			: injectHtmlIntoHead(pending, runtimeTag);
	const processRuntimePending = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string,
		injected: boolean
	) => {
		if (injected) {
			controller.enqueue(encoder.encode(pending));

			return { injected, pending: '' };
		}

		const closingTagIndex = pending.indexOf(closingTag);
		if (closingTagIndex >= 0) {
			const withRuntime = `${pending.slice(0, closingTagIndex)}${runtimeTag}${pending.slice(closingTagIndex)}`;
			controller.enqueue(encoder.encode(withRuntime));

			return { injected: true, pending: '' };
		}

		return {
			injected,
			pending: flushRuntimeLookbehind(controller, pending)
		};
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = stream.getReader();
			let injected = false;
			let pending = '';
			const enqueuePending = () =>
				enqueueEncodedText(controller, encoder, pending);
			const consumeRuntimeChunk = async () => {
				const { done, value } = await readStreamingRuntimeChunk(reader);
				if (done || !value) {
					return done;
				}

				pending += streamChunkToString(value, decoder);
				({ injected, pending } = processRuntimePending(
					controller,
					pending,
					injected
				));

				return false;
			};

			const runRuntimeInjectionLoop = async () => {
				const done = await consumeRuntimeChunk();
				if (done) {
					return;
				}

				await runRuntimeInjectionLoop();
			};

			try {
				await runRuntimeInjectionLoop();

				pending += decoder.decode();
				pending = injected
					? pending
					: injectRuntimeIntoPending(pending);
				enqueuePending();
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		}
	});
};
export const streamOutOfOrderSlots = ({
	footerHtml = '',
	headerHtml = '',
	nonce,
	policy,
	onSlotMetric,
	onError,
	slots
}: StreamOutOfOrderSlotsOptions) => {
	const resolvedPolicy = resolveStreamingSlotPolicy(policy);
	const combinedOnError = createCombinedSlotErrorHandler(
		resolvedPolicy.onError,
		onError
	);
	const combinedOnSlotMetric = createCombinedSlotMetricHandler(
		resolvedPolicy.onSlotMetric,
		onSlotMetric
	);
	const effectivePolicy: StreamingSlotPolicyValue = {
		...resolvedPolicy,
		onSlotMetric: combinedOnSlotMetric
	};
	const preparedSlots = prepareSlots({
		onError: combinedOnError,
		onSlotMetric: combinedOnSlotMetric,
		policy: effectivePolicy,
		slots
	});
	const encoder = new TextEncoder();
	const createPendingSlots = (
		controller: ReadableStreamDefaultController<Uint8Array>
	) =>
		preparedSlots.map((slot) => {
			const fallback = renderStreamingSlotPlaceholder(
				slot.id,
				normalizeSlotText(slot.fallbackHtml, '')
			);
			controller.enqueue(toUint8(fallback, encoder));

			return resolveSlot(
				slot,
				combinedOnError,
				effectivePolicy,
				combinedOnSlotMetric
			);
		});
	const handleResolvedPreparedSlot = async (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: Array<
			Promise<{
				payload: StreamingSlotPatchPayload | null;
				id: string;
				durationMs: number;
				bytes: number;
			}>
		>
	) => {
		const { original, result } = await nextResolvedSlot(pending);
		const index = pending.indexOf(original);
		if (index >= 0) pending.splice(index, 1);
		if (result.payload === null) {
			return;
		}

		emitSlotMetric(
			{
				bytes: result.bytes,
				durationMs: result.durationMs,
				slotId: result.id,
				type: 'patched'
			},
			combinedOnSlotMetric
		);
		controller.enqueue(
			toUint8(
				renderStreamingSlotPatchTag(result.id, result.payload, nonce),
				encoder
			)
		);
	};

	const streamPreparedSlots = async (
		controller: ReadableStreamDefaultController<Uint8Array>
	) => {
		const pending = createPendingSlots(controller);
		const streamNextPreparedSlot = async () => {
			if (pending.length === 0) {
				return;
			}

			await handleResolvedPreparedSlot(controller, pending);

			await streamNextPreparedSlot();
		};

		await streamNextPreparedSlot();
	};
	const resolveHeaderHtml = () => {
		const needsRuntimeTag =
			preparedSlots.length > 0 &&
			!headerHtml.includes(STREAMING_RUNTIME_GLOBAL);
		if (!needsRuntimeTag) {
			return headerHtml;
		}

		return injectHtmlIntoHead(
			headerHtml,
			renderStreamingSlotsRuntimeTag(nonce)
		);
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const header = resolveHeaderHtml();
				controller.enqueue(toUint8(header, encoder));
				await streamPreparedSlots(controller);

				enqueueEncodedText(controller, encoder, footerHtml);
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		}
	});
};
