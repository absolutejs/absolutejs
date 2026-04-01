import type {
	AIChunk,
	AIProviderConfig,
	AIProviderContentBlock,
	AIProviderMessage,
	AIProviderStreamParams,
	AIProviderToolDefinition,
	AIUsage
} from '../../../types/ai';
import type {
	AnthropicConfig,
	AnthropicMessage,
	AnthropicSSEState
} from '../../../types/anthropic';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';
const MAX_TOKENS = 8192;
const EVENT_PREFIX_LENGTH = 7;
const DATA_PREFIX_LENGTH = 6;

const EMPTY_CHUNKS: AIChunk[] = [];

const isRecord = (val: unknown): val is Record<string, unknown> =>
	typeof val === 'object' && val !== null;

const mapContentBlock = (block: AIProviderContentBlock) => {
	if (block.type === 'thinking') {
		return {
			signature: block.signature,
			thinking: block.thinking,
			type: 'thinking'
		};
	}

	if (block.type === 'image') {
		return {
			source: block.source,
			type: 'image'
		};
	}

	if (block.type === 'document') {
		return {
			source: block.source,
			type: 'document'
		};
	}

	if (block.type === 'tool_result') {
		return {
			content: block.content,
			tool_use_id: block.tool_use_id,
			type: 'tool_result'
		};
	}

	if (block.type === 'tool_use') {
		return {
			id: block.id,
			input: block.input,
			name: block.name,
			type: 'tool_use'
		};
	}

	return { text: block.content, type: 'text' };
};

const mapMessage = (msg: AIProviderMessage): AnthropicMessage => ({
	content:
		typeof msg.content === 'string'
			? msg.content
			: msg.content.map(mapContentBlock),
	role: msg.role === 'system' ? 'user' : msg.role
});

const mapToolDefinition = (tool: AIProviderToolDefinition) => ({
	description: tool.description,
	input_schema: tool.input_schema,
	name: tool.name
});

const buildRequestBody = (params: AIProviderStreamParams) => {
	const messages: AnthropicMessage[] = params.messages
		.filter((msg) => msg.role !== 'system')
		.map(mapMessage);

	const body: Record<string, unknown> = {
		max_tokens: MAX_TOKENS,
		messages,
		model: params.model,
		stream: true
	};

	if (params.systemPrompt) {
		body.system = params.systemPrompt;
	}

	if (params.tools && params.tools.length > 0) {
		body.tools = params.tools.map(mapToolDefinition);
	}

	if (params.thinking) {
		body.thinking = params.thinking;
		// When thinking is enabled, max_tokens must be higher
		body.max_tokens = Math.max(
			MAX_TOKENS,
			params.thinking.budget_tokens + MAX_TOKENS
		);
	}

	return body;
};

const classifyLine = (line: string) => {
	if (line.startsWith('event: ')) {
		return {
			field: 'event' as const,
			value: line.slice(EVENT_PREFIX_LENGTH)
		};
	}

	if (line.startsWith('data: ')) {
		return {
			field: 'data' as const,
			value: line.slice(DATA_PREFIX_LENGTH)
		};
	}

	return undefined;
};

const applyClassified = (
	acc: { eventData: string; eventType: string },
	classified: { field: 'event' | 'data'; value: string } | undefined
) => {
	if (!classified) {
		return acc;
	}

	if (classified.field === 'event') {
		return { eventData: acc.eventData, eventType: classified.value };
	}

	return { eventData: classified.value, eventType: acc.eventType };
};

const parseEventLines = (event: string) =>
	event
		.split('\n')
		.reduce((acc, line) => applyClassified(acc, classifyLine(line)), {
			eventData: '',
			eventType: ''
		});

const safeParse = (text: string) => {
	try {
		const result: unknown = JSON.parse(text);

		return result;
	} catch {
		return undefined;
	}
};

const tryParseJson = (text: string) => {
	const result = safeParse(text);

	if (isRecord(result)) {
		return result;
	}

	return undefined;
};

const getRecord = (obj: Record<string, unknown>, key: string) => {
	const val = obj[key];

	if (isRecord(val)) {
		return val;
	}

	return undefined;
};

const getString = (obj: Record<string, unknown>, key: string) => {
	const val = obj[key];

	if (typeof val === 'string') {
		return val;
	}

	return '';
};

const getNumber = (obj: Record<string, unknown>, key: string) => {
	const val = obj[key];

	if (typeof val === 'number') {
		return val;
	}

	return 0;
};

const handleContentBlockStart = (
	parsed: Record<string, unknown>,
	state: AnthropicSSEState
) => {
	const block = getRecord(parsed, 'content_block');

	if (block && block.type === 'tool_use') {
		state.currentToolId = getString(block, 'id');
		state.currentToolName = getString(block, 'name');
		state.toolInputJson = '';
		state.isThinkingBlock = false;
	} else if (block && block.type === 'thinking') {
		state.isThinkingBlock = true;
		state.thinkingSignature = '';
	} else {
		state.isThinkingBlock = false;
	}
};

const handleContentBlockDelta = (
	parsed: Record<string, unknown>,
	state: AnthropicSSEState
) => {
	const delta = getRecord(parsed, 'delta');

	if (!delta) {
		return undefined;
	}

	if (delta.type === 'thinking_delta') {
		return {
			content: getString(delta, 'thinking'),
			type: 'thinking'
		} satisfies AIChunk;
	}

	if (delta.type === 'text_delta') {
		return {
			content: getString(delta, 'text'),
			type: 'text'
		} satisfies AIChunk;
	}

	if (delta.type === 'input_json_delta') {
		state.toolInputJson += getString(delta, 'partial_json');
	}

	if (delta.type === 'signature_delta') {
		state.thinkingSignature += getString(delta, 'signature');
	}

	return undefined;
};

const handleContentBlockStop = (state: AnthropicSSEState) => {
	// Emit thinking signature when thinking block completes
	if (state.isThinkingBlock && state.thinkingSignature) {
		state.isThinkingBlock = false;
		const signature = state.thinkingSignature;
		state.thinkingSignature = '';

		return {
			content: '',
			signature,
			type: 'thinking'
		} satisfies AIChunk;
	}

	if (!state.currentToolId) {
		return undefined;
	}

	const input = tryParseJson(state.toolInputJson) ?? state.toolInputJson;

	const chunk: AIChunk = {
		id: state.currentToolId,
		input,
		name: state.currentToolName,
		type: 'tool_use'
	};

	state.currentToolId = '';
	state.currentToolName = '';
	state.toolInputJson = '';

	return chunk;
};

const extractUsage = (
	usageRecord: Record<string, unknown> | undefined,
	existingUsage: AIUsage | undefined
) => {
	if (!usageRecord) {
		return existingUsage;
	}

	return {
		inputTokens:
			getNumber(usageRecord, 'input_tokens') ||
			existingUsage?.inputTokens ||
			0,
		outputTokens:
			getNumber(usageRecord, 'output_tokens') ||
			existingUsage?.outputTokens ||
			0
	};
};

const handleMessageDelta = (
	parsed: Record<string, unknown>,
	state: AnthropicSSEState
) => {
	const deltaUsage = getRecord(parsed, 'usage');
	state.usage = extractUsage(deltaUsage, state.usage);
};

const handleMessageStart = (
	parsed: Record<string, unknown>,
	state: AnthropicSSEState
) => {
	const message = getRecord(parsed, 'message');

	if (!message) {
		return;
	}

	const startUsage = getRecord(message, 'usage');
	state.usage = extractUsage(startUsage, state.usage);
};

const handleError = (parsed: Record<string, unknown>) => {
	const error = getRecord(parsed, 'error');
	const errorMessage = error ? getString(error, 'message') : '';

	throw new Error(errorMessage || 'Anthropic API error');
};

const processEvent = (
	eventType: string,
	parsed: Record<string, unknown>,
	state: AnthropicSSEState
) => {
	switch (eventType) {
		case 'content_block_start': {
			handleContentBlockStart(parsed, state);

			return undefined;
		}

		case 'content_block_delta': {
			return handleContentBlockDelta(parsed, state);
		}

		case 'content_block_stop': {
			return handleContentBlockStop(state);
		}

		case 'message_delta': {
			handleMessageDelta(parsed, state);

			return undefined;
		}

		case 'message_start': {
			handleMessageStart(parsed, state);

			return undefined;
		}

		case 'message_stop': {
			return { type: 'done' as const, usage: state.usage };
		}

		case 'error': {
			handleError(parsed);

			return undefined;
		}

		default: {
			return undefined;
		}
	}
};

const processSingleEvent = (event: string, state: AnthropicSSEState) => {
	if (!event.trim()) {
		return undefined;
	}

	const { eventData, eventType } = parseEventLines(event);

	if (!eventData) {
		return undefined;
	}

	const parsed = tryParseJson(eventData);

	if (!parsed) {
		return undefined;
	}

	return processEvent(eventType, parsed, state);
};

const collectChunk = (event: string, state: AnthropicSSEState) => {
	const chunk = processSingleEvent(event, state);

	return chunk ? [chunk] : [];
};

const processBufferedEvents = (
	eventsText: string,
	state: AnthropicSSEState
) => {
	const events = eventsText.split('\n\n');
	state.buffer = events.pop() ?? '';

	return events.flatMap((event) => collectChunk(event, state));
};

const readNextChunks = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	state: AnthropicSSEState,
	signal?: AbortSignal
) => {
	if (signal?.aborted) {
		return { chunks: EMPTY_CHUNKS, done: true };
	}

	const { done, value } = await reader.read();

	if (done) {
		return { chunks: EMPTY_CHUNKS, done: true };
	}

	const rawText = state.buffer + decoder.decode(value, { stream: true });
	const chunks = processBufferedEvents(rawText, state);

	return { chunks, done: false };
};

const findDoneChunk = (chunks: AIChunk[]) =>
	chunks.findIndex((c) => c.type === 'done');

const sseStreamLoop = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	state: AnthropicSSEState,
	signal?: AbortSignal
) => {
	const result = await readNextChunks(reader, decoder, state, signal);

	if (result.done) {
		return { chunks: result.chunks, finished: true };
	}

	const doneIdx = findDoneChunk(result.chunks);

	if (doneIdx >= 0) {
		return { chunks: result.chunks.slice(0, doneIdx + 1), finished: true };
	}

	return { chunks: result.chunks, finished: false };
};

// eslint-disable-next-line func-style
async function* streamChunks(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	state: AnthropicSSEState,
	signal?: AbortSignal
) {
	let finished = false;

	while (!finished) {
		// eslint-disable-next-line no-await-in-loop
		const result = await sseStreamLoop(reader, decoder, state, signal);
		({ finished } = result);
		yield* result.chunks;
	}
}

// eslint-disable-next-line func-style
async function* parseSSEStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
) {
	const reader = body.getReader();
	const decoder = new TextDecoder();

	const state: AnthropicSSEState = {
		buffer: '',
		currentToolId: '',
		currentToolName: '',
		isThinkingBlock: false,
		thinkingSignature: '',
		toolInputJson: '',
		usage: undefined
	};

	try {
		yield* streamChunks(reader, decoder, state, signal);
	} finally {
		reader.releaseLock();
	}
}

const fetchAndStream = async function* (
	baseUrl: string,
	config: AnthropicConfig,
	params: AIProviderStreamParams
) {
	const body = buildRequestBody(params);

	const response = await fetch(`${baseUrl}/v1/messages`, {
		body: JSON.stringify(body),
		headers: {
			'anthropic-version': API_VERSION,
			'Content-Type': 'application/json',
			'x-api-key': config.apiKey
		},
		method: 'POST',
		signal: params.signal
	});

	if (!response.ok) {
		const errorText = await response.text();

		throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
	}

	if (!response.body) {
		throw new Error('Anthropic API returned no response body');
	}

	yield* parseSSEStream(response.body, params.signal);
};

export const anthropic = (config: AnthropicConfig): AIProviderConfig => {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

	return {
		stream: (params: AIProviderStreamParams) =>
			fetchAndStream(baseUrl, config, params)
	};
};
