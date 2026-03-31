import type {
	AIProviderConfig,
	AIProviderContentBlock,
	AIProviderMessage,
	AIProviderStreamParams,
	AIProviderToolDefinition,
	AIUsage
} from '../../../types/ai';

type OpenAIConfig = {
	apiKey: string;
	baseUrl?: string;
};

type OpenAIMessage = {
	content: string | Array<Record<string, unknown>> | null;
	role: 'user' | 'assistant' | 'system' | 'tool';
	tool_call_id?: string;
	tool_calls?: Array<{
		function: { arguments: string; name: string };
		id: string;
		type: 'function';
	}>;
};

type PendingToolCall = {
	arguments: string;
	id: string;
	name: string;
};

type UsageRef = {
	current: AIUsage | undefined;
};

type StreamState = {
	buffer: string;
	pendingToolCalls: Map<number, PendingToolCall>;
	usageRef: UsageRef;
};

const DEFAULT_BASE_URL = 'https://api.openai.com';
const SSE_DATA_PREFIX_LENGTH = 6;
const DONE_SENTINEL = '[DONE]';
const NOT_FOUND = -1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isRecordArray = (
	value: unknown
): value is Array<Record<string, unknown>> =>
	Array.isArray(value) && value.length > 0 && isRecord(value[0]);

const hasArrayContent = (
	msg: AIProviderMessage
): msg is AIProviderMessage & { content: AIProviderContentBlock[] } =>
	typeof msg.content !== 'string' && Array.isArray(msg.content);

const buildToolMessages = (blocks: AIProviderContentBlock[]) => {
	const toolUseBlocks = blocks.filter((block) => block.type === 'tool_use');
	const toolResultBlocks = blocks.filter(
		(block) => block.type === 'tool_result'
	);
	const messages: OpenAIMessage[] = [];

	if (toolUseBlocks.length > 0) {
		messages.push({
			content: null,
			role: 'assistant',
			tool_calls: toolUseBlocks.map((block) => ({
				function: {
					arguments:
						typeof block.input === 'string'
							? block.input
							: JSON.stringify(block.input),
					name: block.name
				},
				id: block.id,
				type: 'function' as const
			}))
		});
	}

	for (const result of toolResultBlocks) {
		messages.push({
			content: typeof result.content === 'string' ? result.content : '',
			role: 'tool',
			tool_call_id: result.tool_use_id
		});
	}

	return messages;
};

const processMessageAtIndex = (
	result: OpenAIMessage[],
	msg: AIProviderMessage,
	idx: number
) => {
	if (!hasArrayContent(msg)) {
		return;
	}

	const hasToolBlocks = msg.content.some(
		(block) => block.type === 'tool_use' || block.type === 'tool_result'
	);

	if (!hasToolBlocks) {
		return;
	}

	const toolMessages = buildToolMessages(msg.content);
	result.splice(idx, 1, ...toolMessages);
};

const convertSingleMessage = (
	result: OpenAIMessage[],
	msg: AIProviderMessage | undefined,
	idx: number
) => {
	if (!msg) {
		return;
	}

	processMessageAtIndex(result, msg, idx);
};

const convertToolResultMessages = (
	messages: OpenAIMessage[],
	params: AIProviderStreamParams
) => {
	const result = [...messages];

	for (let idx = 0; idx < params.messages.length; idx++) {
		convertSingleMessage(result, params.messages[idx], idx);
	}

	return result;
};

const mapToolDefinitions = (tools: AIProviderToolDefinition[]) =>
	tools.map((tool) => ({
		function: {
			description: tool.description,
			name: tool.name,
			parameters: tool.input_schema
		},
		type: 'function'
	}));

const mapContentBlockToOpenAI = (block: AIProviderContentBlock) => {
	if (block.type === 'image') {
		return {
			image_url: {
				url: `data:${block.source.media_type};base64,${block.source.data}`
			},
			type: 'image_url'
		};
	}

	if (block.type === 'document') {
		return {
			file: {
				file_data: `data:${block.source.media_type};base64,${block.source.data}`,
				filename: block.name ?? 'document.pdf'
			},
			type: 'file'
		};
	}

	if (block.type === 'text') {
		return { text: block.content, type: 'text' };
	}

	return null;
};

const mapOpenAIContent = (msg: AIProviderStreamParams['messages'][number]) => {
	if (typeof msg.content === 'string') {
		return msg.content;
	}

	const hasMedia = msg.content.some(
		(block) => block.type === 'image' || block.type === 'document'
	);

	if (!hasMedia) {
		return null;
	}

	return msg.content
		.map(mapContentBlockToOpenAI)
		.filter((mapped) => mapped !== null);
};

const buildRequestBody = (params: AIProviderStreamParams) => {
	const messages = convertToolResultMessages(
		params.messages.map((msg) => ({
			content: mapOpenAIContent(msg),
			role: msg.role
		})),
		params
	);

	const body: Record<string, unknown> = {
		messages,
		model: params.model,
		stream: true,
		stream_options: { include_usage: true }
	};

	if (params.tools && params.tools.length > 0) {
		body.tools = mapToolDefinitions(params.tools);
	}

	return body;
};

const parseToolInput = (rawArguments: string) => {
	try {
		return JSON.parse(rawArguments);
	} catch {
		return rawArguments;
	}
};

const flushPendingToolCalls = function* (
	pendingToolCalls: Map<number, PendingToolCall>
) {
	for (const [, tool] of pendingToolCalls) {
		const input = parseToolInput(tool.arguments);
		yield {
			id: tool.id,
			input,
			name: tool.name,
			type: 'tool_use' as const
		};
	}

	pendingToolCalls.clear();
};

const extractUsage = (parsedUsage: Record<string, number>) => ({
	inputTokens: parsedUsage.prompt_tokens ?? 0,
	outputTokens: parsedUsage.completion_tokens ?? 0
});

const resolveToolCallIndex = (toolCall: Record<string, unknown>) => {
	const raw = typeof toolCall.index === 'number' ? toolCall.index : NOT_FOUND;

	return raw < 0 ? undefined : raw;
};

const initPendingToolCall = (
	toolCall: Record<string, unknown>,
	func: Record<string, unknown> | null,
	index: number,
	pendingToolCalls: Map<number, PendingToolCall>
) => {
	if (pendingToolCalls.has(index)) {
		return;
	}

	const toolId = typeof toolCall.id === 'string' ? toolCall.id : '';
	const toolName = func && typeof func.name === 'string' ? func.name : '';

	pendingToolCalls.set(index, {
		arguments: '',
		id: toolId,
		name: toolName
	});
};

const updatePendingToolCall = (
	toolCall: Record<string, unknown>,
	func: Record<string, unknown> | null,
	pending: PendingToolCall
) => {
	if (typeof toolCall.id === 'string') {
		pending.id = toolCall.id;
	}

	if (func && typeof func.name === 'string') {
		pending.name = func.name;
	}

	if (func && typeof func.arguments === 'string') {
		pending.arguments += func.arguments;
	}
};

const processToolCallDelta = (
	toolCall: Record<string, unknown>,
	pendingToolCalls: Map<number, PendingToolCall>
) => {
	const index = resolveToolCallIndex(toolCall);
	if (index === undefined) {
		return;
	}

	const func = isRecord(toolCall.function) ? toolCall.function : null;
	initPendingToolCall(toolCall, func, index, pendingToolCalls);

	const pending = pendingToolCalls.get(index);
	if (!pending) {
		return;
	}

	updatePendingToolCall(toolCall, func, pending);
};

const processToolCallDeltas = (
	toolCalls: Array<Record<string, unknown>>,
	pendingToolCalls: Map<number, PendingToolCall>
) => {
	for (const toolCall of toolCalls) {
		processToolCallDelta(toolCall, pendingToolCalls);
	}
};

const processDelta = function* (
	delta: Record<string, unknown>,
	pendingToolCalls: Map<number, PendingToolCall>
) {
	if (typeof delta.content === 'string') {
		yield { content: delta.content, type: 'text' as const };
	}

	if (isRecordArray(delta.tool_calls)) {
		processToolCallDeltas(delta.tool_calls, pendingToolCalls);
	}
};

const processChoice = function* (
	choice: Record<string, unknown>,
	pendingToolCalls: Map<number, PendingToolCall>
) {
	const delta = isRecord(choice.delta) ? choice.delta : null;
	if (delta) {
		yield* processDelta(delta, pendingToolCalls);
	}

	if (choice.finish_reason === 'tool_calls') {
		yield* flushPendingToolCalls(pendingToolCalls);
	}
};

const narrowUsageRecord = (parsed: Record<string, unknown>) => {
	if (!isRecord(parsed.usage)) {
		return undefined;
	}

	const { usage } = parsed;
	const promptTokens =
		typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
	const completionTokens =
		typeof usage.completion_tokens === 'number'
			? usage.completion_tokens
			: 0;

	return extractUsage({
		completion_tokens: completionTokens,
		prompt_tokens: promptTokens
	});
};

const processSSELine = function* (
	line: string,
	pendingToolCalls: Map<number, PendingToolCall>,
	currentUsage: AIUsage | undefined
) {
	const trimmed = line.trim();
	if (!trimmed || !trimmed.startsWith('data: ')) {
		return;
	}

	const data = trimmed.slice(SSE_DATA_PREFIX_LENGTH);
	if (data === DONE_SENTINEL) {
		yield* flushPendingToolCalls(pendingToolCalls);
		yield { type: 'done' as const, usage: currentUsage };

		return;
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(data);
	} catch {
		return;
	}

	const usageUpdate = narrowUsageRecord(parsed);
	if (usageUpdate) {
		yield { type: 'usage_update' as const, usage: usageUpdate };
	}

	const { choices } = parsed;
	if (!isRecordArray(choices)) {
		return;
	}

	const [firstChoice] = choices;
	if (!firstChoice) {
		return;
	}

	yield* processChoice(firstChoice, pendingToolCalls);
};

const isUsageUpdate = (chunk: {
	type: string;
	usage?: AIUsage;
}): chunk is { type: 'usage_update'; usage: AIUsage } =>
	chunk.type === 'usage_update';

const collectYieldableChunks = (
	line: string,
	pendingToolCalls: Map<number, PendingToolCall>,
	usageRef: UsageRef
) => {
	const allChunks = Array.from(
		processSSELine(line, pendingToolCalls, usageRef.current)
	);
	const usageChunks = allChunks.filter(isUsageUpdate);
	const lastUsage = usageChunks.at(NOT_FOUND);

	if (lastUsage) {
		usageRef.current = lastUsage.usage;
	}

	return allChunks.filter((chunk) => !isUsageUpdate(chunk));
};

const processSSELines = function* (
	lines: string[],
	pendingToolCalls: Map<number, PendingToolCall>,
	usageRef: UsageRef
) {
	for (const line of lines) {
		yield* collectYieldableChunks(line, pendingToolCalls, usageRef);
	}
};

const processStreamValue = (
	value: Uint8Array,
	decoder: TextDecoder,
	state: StreamState
) => {
	state.buffer += decoder.decode(value, { stream: true });
	const lines = state.buffer.split('\n');
	state.buffer = lines.pop() ?? '';

	return lines;
};

const drainReader = async function* (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	state: StreamState,
	signal?: AbortSignal
) {
	/* eslint-disable no-await-in-loop */
	for (
		let result = await reader.read();
		!result.done && !signal?.aborted;
		result = await reader.read()
	) {
		/* eslint-enable no-await-in-loop */
		const lines = processStreamValue(result.value, decoder, state);
		yield* processSSELines(lines, state.pendingToolCalls, state.usageRef);
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
		pendingToolCalls: new Map<number, PendingToolCall>(),
		usageRef: { current: undefined }
	};

	try {
		yield* drainReader(reader, decoder, state, signal);
		yield { type: 'done' as const, usage: state.usageRef.current };
	} finally {
		reader.releaseLock();
	}
};

const fetchOpenAIStream = async function* (
	baseUrl: string,
	apiKey: string,
	body: Record<string, unknown>,
	signal?: AbortSignal
) {
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
		throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
	}

	if (!response.body) {
		throw new Error('OpenAI API returned no response body');
	}

	yield* parseSSEStream(response.body, signal);
};

export const openai = (config: OpenAIConfig): AIProviderConfig => {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

	return {
		stream: (params: AIProviderStreamParams) => {
			const body = buildRequestBody(params);

			return fetchOpenAIStream(
				baseUrl,
				config.apiKey,
				body,
				params.signal
			);
		}
	};
};
