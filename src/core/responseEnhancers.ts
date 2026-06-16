import {
	appendStreamingSlotPatchesToStream,
	type AppendStreamingSlotsOptions,
	type StreamingSlotPolicy,
	type StreamingSlot
} from '../utils/streamingSlots';
import { STREAMING_PAGE_HEADER } from './pageResponseCache';
import { runWithStreamingSlotRegistry } from './streamingSlotRegistry';

type ResponseLike = Response | Promise<Response>;

export type StreamingSlotEnhancerOptions = Omit<
	AppendStreamingSlotsOptions,
	'injectRuntime'
> & {
	streamingSlots?: StreamingSlot[];
	policy?: StreamingSlotPolicy;
};

const toResponse = async (responseLike: ResponseLike) => responseLike;

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

export const withRegisteredStreamingSlots = async (
	renderResponse: () => ResponseLike,
	options: StreamingSlotEnhancerOptions = {}
) => {
	const { result, slots } =
		await runWithStreamingSlotRegistry(renderResponse);
	const explicit = options.streamingSlots ?? [];

	return withStreamingSlots(result, {
		...options,
		streamingSlots: mergeStreamingSlots(slots, explicit)
	});
};
