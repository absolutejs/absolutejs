import type {
	AIProviderConfig,
	AIProviderContentBlock,
	AIProviderMessage,
	AIProviderStreamParams,
	AIProviderToolDefinition,
	AIUsage
} from '../../../types/ai';

type OpenAIResponsesConfig = {
	apiKey: string;
	baseUrl?: string;
	imageModels?: Set<string> | string[];
};

type PendingFunctionCall = {
	callId: string;
	name: string;
	arguments: string;
};

type StreamState = {
	buffer: string;
	currentEvent: string;
	pendingCalls: Map<string, PendingFunctionCall>;
	usage: AIUsage | undefined;
};

const DEFAULT_BASE_URL = 'https://api.openai.com';
const EVENT_PREFIX_LENGTH = 7;
const DATA_PREFIX_LENGTH = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isRecordArray = (
	value: unknown
): value is Array<Record<string, unknown>> =>
	Array.isArray(value) && value.length > 0 && isRecord(value[0]);

/* ─── Message conversion ─── */

const mapBlockToResponsesFormat = (block: AIProviderContentBlock) => {
	if (block.type === 'text') {
		return { text: block.content, type: 'input_text' };
	}

	if (block.type === 'image') {
		return {
			image_url: {
				url: `data:${block.source.media_type};base64,${block.source.data}`
			},
			type: 'input_image'
		};
	}

	if (block.type === 'document') {
		return {
			file: {
				file_data: `data:${block.source.media_type};base64,${block.source.data}`,
				filename: block.name ?? 'document.pdf'
			},
			type: 'input_file'
		};
	}

	return null;
};

const mapContentToResponsesFormat = (
	content: string | AIProviderContentBlock[]
) => {
	if (typeof content === 'string') {
		return content;
	}

	const parts = content
		.map(mapBlockToResponsesFormat)
		.filter((mapped) => mapped !== null);

	return parts.length > 0 ? parts : '';
};

const hasToolBlocks = (content: AIProviderContentBlock[]) =>
	content.some(
		(block) => block.type === 'tool_use' || block.type === 'tool_result'
	);

const convertToolBlock = (block: AIProviderContentBlock) => {
	if (block.type === 'tool_use') {
		return {
			arguments:
				typeof block.input === 'string'
					? block.input
					: JSON.stringify(block.input),
			call_id: block.id,
			name: block.name,
			type: 'function_call'
		};
	}

	if (block.type === 'tool_result') {
		return {
			call_id: block.tool_use_id,
			output: typeof block.content === 'string' ? block.content : '',
			type: 'function_call_output'
		};
	}

	return null;
};

const convertToolBlocks = (content: AIProviderContentBlock[]) =>
	content.map(convertToolBlock).filter((converted) => converted !== null);

const convertMessage = (msg: AIProviderMessage) => {
	if (
		typeof msg.content !== 'string' &&
		Array.isArray(msg.content) &&
		hasToolBlocks(msg.content)
	) {
		return convertToolBlocks(msg.content);
	}

	const content = mapContentToResponsesFormat(msg.content);

	return [
		{
			content,
			role: msg.role === 'system' ? 'developer' : msg.role,
			type: 'message'
		}
	];
};

const buildInput = (messages: AIProviderMessage[]) => {
	const input: Array<Record<string, unknown>> = [];

	for (const msg of messages) {
		input.push(...convertMessage(msg));
	}

	return input;
};

const mapToolDefinition = (tool: AIProviderToolDefinition) => ({
	description: tool.description,
	name: tool.name,
	parameters: tool.input_schema,
	type: 'function'
});

const buildTools = (
	tools: AIProviderToolDefinition[] | undefined,
	isImageModel: boolean
) => {
	const mapped = tools ? tools.map(mapToolDefinition) : [];
	const result: Array<Record<string, unknown>> = [...mapped];

	if (isImageModel) {
		result.push({ type: 'image_generation' });
	}

	return result.length > 0 ? result : undefined;
};

const buildRequestBody = (
	params: AIProviderStreamParams,
	isImageModel: boolean
) => {
	const body: Record<string, unknown> = {
		input: buildInput(params.messages),
		model: params.model,
		stream: true
	};

	if (params.systemPrompt) {
		body.instructions = params.systemPrompt;
	}

	const tools = buildTools(params.tools, isImageModel);

	if (tools) {
		body.tools = tools;
	}

	// Enable reasoning summary for models that support thinking/reasoning
	if (params.thinking) {
		body.reasoning = {
			effort: 'high',
			summary: 'auto'
		};
	}

	return body;
};

/* ─── SSE parsing ─── */

const parseJSON = (data: string) => {
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
};

const parseToolInput = (rawArguments: string) => {
	try {
		return JSON.parse(rawArguments);
	} catch {
		return rawArguments;
	}
};

const extractUsage = (response: Record<string, unknown>) => {
	if (!isRecord(response.usage)) {
		return undefined;
	}

	const { usage } = response;

	return {
		inputTokens:
			typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
		outputTokens:
			typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
	};
};

const extractMimeFormat = (mimeType: unknown) => {
	if (typeof mimeType !== 'string') {
		return 'png';
	}

	if (mimeType.includes('jpeg')) return 'jpeg';
	if (mimeType.includes('webp')) return 'webp';

	return 'png';
};

const processTextDelta = function* (parsed: Record<string, unknown>) {
	if (typeof parsed.delta === 'string') {
		yield { content: parsed.delta, type: 'text' as const };
	}
};

const processPartialImage = function* (parsed: Record<string, unknown>) {
	const itemId =
		typeof parsed.item_id === 'string' ? parsed.item_id : undefined;
	const b64 =
		typeof parsed.partial_image_b64 === 'string'
			? parsed.partial_image_b64
			: undefined;

	if (b64) {
		yield {
			data: b64,
			format: 'png',
			imageId: itemId,
			isPartial: true,
			type: 'image' as const
		};
	}
};

const processFunctionCallArgumentsDelta = (
	parsed: Record<string, unknown>,
	pendingCalls: Map<string, PendingFunctionCall>
) => {
	const itemId = typeof parsed.item_id === 'string' ? parsed.item_id : '';
	const callId = typeof parsed.call_id === 'string' ? parsed.call_id : '';
	const delta =
		typeof parsed.arguments_delta === 'string'
			? parsed.arguments_delta
			: '';

	const existing = pendingCalls.get(itemId);

	if (existing) {
		existing.arguments += delta;
	} else {
		pendingCalls.set(itemId, {
			arguments: delta,
			callId,
			name: ''
		});
	}
};

const processFunctionCallArgumentsDone = function* (
	parsed: Record<string, unknown>,
	pendingCalls: Map<string, PendingFunctionCall>
) {
	const itemId = typeof parsed.item_id === 'string' ? parsed.item_id : '';
	const callId = typeof parsed.call_id === 'string' ? parsed.call_id : '';
	const fullArgs =
		typeof parsed.arguments === 'string' ? parsed.arguments : '';

	const pending = pendingCalls.get(itemId);
	const name = pending?.name ?? '';
	const args = fullArgs || pending?.arguments || '';

	pendingCalls.delete(itemId);

	yield {
		id: callId || pending?.callId || itemId,
		input: parseToolInput(args),
		name,
		type: 'tool_use' as const
	};
};

const processOutputItemAdded = (
	parsed: Record<string, unknown>,
	pendingCalls: Map<string, PendingFunctionCall>
) => {
	if (!isRecord(parsed.item)) {
		return;
	}

	const { item } = parsed;
	const itemId = typeof item.id === 'string' ? item.id : '';
	const itemType = typeof item.type === 'string' ? item.type : '';

	if (itemType !== 'function_call') {
		return;
	}

	const callId = typeof item.call_id === 'string' ? item.call_id : '';
	const name = typeof item.name === 'string' ? item.name : '';

	pendingCalls.set(itemId, {
		arguments: '',
		callId,
		name
	});
};

const isCompletedImageGeneration = (item: Record<string, unknown>) =>
	item.type === 'image_generation_call' &&
	item.status === 'completed' &&
	typeof item.result === 'string' &&
	item.result !== '';

const buildImageChunk = (item: Record<string, unknown>) => ({
	data: typeof item.result === 'string' ? item.result : '',
	format: extractMimeFormat(item.output_format),
	imageId: typeof item.id === 'string' ? item.id : undefined,
	isPartial: false,
	revisedPrompt:
		typeof item.revised_prompt === 'string'
			? item.revised_prompt
			: undefined,
	type: 'image' as const
});

const extractImageFromOutput = function* (
	output: Array<Record<string, unknown>>
) {
	const completedImages = output.filter(isCompletedImageGeneration);

	for (const item of completedImages) {
		yield buildImageChunk(item);
	}
};

const processCompleted = function* (parsed: Record<string, unknown>) {
	if (!isRecord(parsed.response)) {
		yield { type: 'done' as const, usage: undefined };

		return;
	}

	const { response } = parsed;
	const usage = extractUsage(response);

	if (isRecordArray(response.output)) {
		yield* extractImageFromOutput(response.output);
	}

	yield { type: 'done' as const, usage };
};

const processSSEEvent = function* (
	eventType: string,
	parsed: Record<string, unknown>,
	pendingCalls: Map<string, PendingFunctionCall>
) {
	switch (eventType) {
		case 'response.reasoning_summary_text.delta': {
			const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
			if (!delta) break;

			yield {
				content: delta,
				type: 'thinking' as const
			};

			break;
		}

		case 'response.output_text.delta':
			yield* processTextDelta(parsed);
			break;

		case 'response.image_generation_call.partial_image':
			yield* processPartialImage(parsed);
			break;

		case 'response.output_item.added':
			processOutputItemAdded(parsed, pendingCalls);
			break;

		case 'response.function_call_arguments.delta':
			processFunctionCallArgumentsDelta(parsed, pendingCalls);
			break;

		case 'response.function_call_arguments.done':
			yield* processFunctionCallArgumentsDone(parsed, pendingCalls);
			break;

		case 'response.completed':
			yield* processCompleted(parsed);
			break;

		case 'response.failed':
		case 'response.incomplete': {
			const respObj = isRecord(parsed.response)
				? parsed.response
				: parsed;
			const errMsg =
				isRecord(respObj.error) &&
				typeof respObj.error.message === 'string'
					? respObj.error.message
					: `OpenAI Responses API: ${eventType}`;
			throw new Error(errMsg);
		}
	}
};

const flushSSEBuffer = function* (state: StreamState) {
	if (!state.currentEvent || !state.buffer) {
		return;
	}

	const parsed = parseJSON(state.buffer);

	if (parsed) {
		yield* processSSEEvent(state.currentEvent, parsed, state.pendingCalls);
	}

	state.currentEvent = '';
	state.buffer = '';
};

const parseSSELine = (trimmed: string, state: StreamState) => {
	if (trimmed.startsWith('event: ')) {
		state.currentEvent = trimmed.slice(EVENT_PREFIX_LENGTH);
	} else if (trimmed.startsWith('data: ')) {
		state.buffer = trimmed.slice(DATA_PREFIX_LENGTH);
	}
};

const processSSELine = function* (line: string, state: StreamState) {
	const trimmed = line.trim();

	if (trimmed) {
		parseSSELine(trimmed, state);

		return;
	}

	yield* flushSSEBuffer(state);
};

const processSSELines = function* (lines: string[], state: StreamState) {
	for (const line of lines) {
		yield* processSSELine(line, state);
	}
};

const drainReader = async function* (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	state: StreamState,
	signal?: AbortSignal
) {
	let textBuffer = '';

	for (
		let result = await reader.read();
		!result.done && !signal?.aborted;
		// eslint-disable-next-line no-await-in-loop
		result = await reader.read()
	) {
		textBuffer += decoder.decode(result.value, { stream: true });
		const lines = textBuffer.split('\n');
		textBuffer = lines.pop() ?? '';

		yield* processSSELines(lines, state);
	}

	if (textBuffer.trim()) {
		yield* processSSELines([textBuffer, ''], state);
	}
};

const parseSSEStream = async function* (
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const state: StreamState = {
		buffer: '',
		currentEvent: '',
		pendingCalls: new Map(),
		usage: undefined
	};

	try {
		yield* drainReader(reader, decoder, state, signal);
	} finally {
		reader.releaseLock();
	}
};

const fetchResponsesStream = async function* (
	baseUrl: string,
	apiKey: string,
	body: Record<string, unknown>,
	signal?: AbortSignal
) {
	const response = await fetch(`${baseUrl}/v1/responses`, {
		body: JSON.stringify(body),
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		method: 'POST',
		signal
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`OpenAI Responses API error ${response.status}: ${errorText}`
		);
	}

	if (!response.body) {
		throw new Error('OpenAI Responses API returned no response body');
	}

	yield* parseSSEStream(response.body, signal);
};

const resolveImageModels = (
	imageModels: Set<string> | string[] | undefined
) => {
	if (!imageModels) {
		return new Set<string>();
	}

	if (imageModels instanceof Set) {
		return imageModels;
	}

	return new Set(imageModels);
};

export const openaiResponses = (config: OpenAIResponsesConfig) => {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const imageModels = resolveImageModels(config.imageModels);

	return {
		stream: (params: AIProviderStreamParams) => {
			const isImageModel = imageModels.has(params.model);
			const body = buildRequestBody(params, isImageModel);

			return fetchResponsesStream(
				baseUrl,
				config.apiKey,
				body,
				params.signal
			);
		}
	} satisfies AIProviderConfig;
};
