import {
	appendStreamingSlotPatchesToStream,
	type AppendStreamingSlotsOptions,
	injectStreamingRuntimeIntoStream,
	type StreamingSlotPolicy,
	type StreamingSlot
} from '../utils/streamingSlots';
import { uncompressedPage } from './compressPageStream';
import { STREAMING_PAGE_HEADER } from './pageResponseCache';
import {
	activePartialHolesSink,
	encodePartialHoles,
	isDynamicStreamingSlot,
	isPartialShellCapture,
	PARTIAL_HOLES_HEADER
} from './partialPrerender';
import { getCurrentAbsoluteRequest } from './requestContext';
import { warnUnfilledSlots, withRouteHoles } from './routeHoles';
import { runWithStreamingSlotRegistry } from './streamingSlotRegistry';

type ResponseLike = Response | Promise<Response>;

export type StreamingSlotEnhancerOptions = Omit<
	AppendStreamingSlotsOptions,
	'injectRuntime'
> & {
	streamingSlots?: StreamingSlot[];
	policy?: StreamingSlotPolicy;
};

/* A handler's response has been through the page funnel, and may be
 * leaving compressed (compressPageStream.ts). Everything here reads or
 * adds to the page's HTML, so it takes the page back first. */
const toResponse = async (responseLike: ResponseLike) =>
	uncompressedPage(await responseLike);

const cloneHeaders = (response: Response) => {
	const headers = new Headers(response.headers);

	return headers;
};

export const enhanceHtmlResponseWithStreamingSlots = (
	response: Response,
	{
		nonce,
		onError,
		runtimePlacement,
		runtimePreludeScript,
		streamingSlots = [],
		policy
	}: StreamingSlotEnhancerOptions = {}
) => {
	if (!response.body || streamingSlots.length === 0) {
		return response;
	}

	const body = appendStreamingSlotPatchesToStream(
		response.body,
		streamingSlots,
		{
			nonce,
			onError,
			policy,
			runtimePlacement,
			runtimePreludeScript
		}
	);

	// This response now streams, so it can't carry a content-hash ETag — tag it
	// so withPageCacheHeaders marks it no-cache instead of buffering to hash.
	const headers = cloneHeaders(response);
	headers.set(STREAMING_PAGE_HEADER, '1');

	return new Response(body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};

export const withStreamingSlots = async (
	responseLike: ResponseLike,
	options: StreamingSlotEnhancerOptions = {}
) =>
	enhanceHtmlResponseWithStreamingSlots(
		await toResponse(responseLike),
		options
	);

const mergeStreamingSlots = (
	registered: StreamingSlot[],
	explicit: StreamingSlot[]
) => {
	const merged = new Map<string, StreamingSlot>();
	for (const slot of registered) merged.set(slot.id, slot);
	for (const slot of explicit) merged.set(slot.id, slot);

	return [...merged.values()];
};

/* Partial prerendering's shell capture: static slots resolve into the page,
 * dynamic ones keep their fallback and are listed in PARTIAL_HOLES_HEADER.
 * The swap runtime goes in even with no static slot, for the holes' patches
 * streamed at request time. */
const captureStaticShell = async (
	responseLike: ResponseLike,
	slots: StreamingSlot[],
	options: StreamingSlotEnhancerOptions
) => {
	const holes = slots.filter(isDynamicStreamingSlot);
	const staticSlots = slots.filter((slot) => !isDynamicStreamingSlot(slot));
	const response = await withStreamingSlots(responseLike, {
		...options,
		streamingSlots: staticSlots
	});
	if (holes.length === 0 || !response.body) return response;

	const headers = cloneHeaders(response);
	headers.set(
		PARTIAL_HOLES_HEADER,
		encodePartialHoles(holes.map((slot) => slot.id))
	);
	const body =
		staticSlots.length > 0
			? response.body
			: injectStreamingRuntimeIntoStream(
					response.body,
					options.nonce,
					options.runtimePlacement,
					options.runtimePreludeScript
				);

	return new Response(body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};

/* Partial prerendering's hole collection: the server already sent the
 * cached shell, so the page hands over its dynamic slots and its own HTML
 * is dropped. */
const handOverHoles = async (
	responseLike: ResponseLike,
	slots: StreamingSlot[],
	sink: NonNullable<ReturnType<typeof activePartialHolesSink>>
) => {
	sink.slots = slots.filter(isDynamicStreamingSlot);
	const response = await toResponse(responseLike);
	await response.body?.cancel().catch(() => undefined);

	return new Response(null, { status: 204 });
};

export const withRegisteredStreamingSlots = async (
	renderResponse: () => ResponseLike,
	options: StreamingSlotEnhancerOptions = {}
) => {
	const { result, slots } =
		await runWithStreamingSlotRegistry(renderResponse);
	const explicit = options.streamingSlots ?? [];
	const request = getCurrentAbsoluteRequest();
	// A slot the route declared a hole for is filled by the route's
	// resolver, wherever the page is rendered (routeHoles.ts).
	const streamingSlots = await withRouteHoles(
		mergeStreamingSlots(slots, explicit),
		request
	);
	warnUnfilledSlots(streamingSlots, request);
	const holesSink = activePartialHolesSink();
	if (holesSink) return handOverHoles(result, streamingSlots, holesSink);
	if (isPartialShellCapture(request)) {
		return captureStaticShell(result, streamingSlots, options);
	}

	return withStreamingSlots(result, {
		...options,
		streamingSlots
	});
};
