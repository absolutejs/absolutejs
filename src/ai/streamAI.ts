import type {
	AIChunk,
	AIImageChunk,
	AIProviderContentBlock,
	AIProviderMessage,
	AIServerMessage,
	AITextChunk,
	AIToolMap,
	AIUsage,
	AIWebSocket,
	StreamAIOptions,
	StreamAICompleteMetadata
} from '../../types/ai';
import { serializeAIMessage } from './protocol';

const WS_OPEN = 1;
const BACKPRESSURE_THRESHOLD = 1_048_576;
const BACKPRESSURE_DELAY = 10;
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_THINKING_BUDGET = 10_000;
const INITIAL_TURN = 0;

const delay = (milliseconds: number) =>
	// eslint-disable-next-line promise/avoid-new
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const checkBackpressure = async (socket: AIWebSocket) => {
	if (!('raw' in socket)) {
		return;
	}

	const { raw } = socket;

	if (
		raw &&
		typeof raw === 'object' &&
		'bufferedAmount' in raw &&
		typeof raw.bufferedAmount === 'number' &&
		raw.bufferedAmount > BACKPRESSURE_THRESHOLD
	) {
		await delay(BACKPRESSURE_DELAY);
	}
};

const sendMessage = async (socket: AIWebSocket, message: AIServerMessage) => {
	if (socket.readyState !== WS_OPEN) {
		return false;
	}

	await checkBackpressure(socket);

	socket.send(serializeAIMessage(message));

	return true;
};

const buildToolDefinitions = (tools: AIToolMap) =>
	Object.entries(tools).map(([name, def]) => ({
		description: def.description,
		input_schema: def.input,
		name
	}));

const extractTextContent = (
	chunk: AITextChunk,
	onChunk?: (chunk: AITextChunk) => AITextChunk | void
) => {
	if (!onChunk) {
		return chunk.content;
	}

	const transformed = onChunk(chunk);

	if (
		transformed &&
		typeof transformed === 'object' &&
		'content' in transformed
	) {
		return transformed.content;
	}

	return chunk.content;
};

const sendImageMessage = async (
	socket: AIWebSocket,
	chunk: AIImageChunk,
	messageId: string,
	conversationId: string
) =>
	sendMessage(socket, {
		conversationId,
		data: chunk.data,
		format: chunk.format,
		imageId: chunk.imageId,
		isPartial: chunk.isPartial,
		messageId,
		revisedPrompt: chunk.revisedPrompt,
		type: 'image'
	});

const sendToolRunning = async (
	socket: AIWebSocket,
	toolName: string,
	toolInput: unknown,
	messageId: string,
	conversationId: string
) =>
	sendMessage(socket, {
		conversationId,
		input: toolInput,
		messageId,
		name: toolName,
		status: 'running',
		type: 'tool_status'
	});

const sendToolComplete = async (
	socket: AIWebSocket,
	toolName: string,
	result: string,
	messageId: string,
	conversationId: string
) =>
	sendMessage(socket, {
		conversationId,
		messageId,
		name: toolName,
		result,
		status: 'complete',
		type: 'tool_status'
	});

const executeTool = async (
	options: StreamAIOptions,
	toolName: string,
	toolInput: unknown
) => {
	const toolDef = options.tools?.[toolName];

	if (!toolDef) {
		return `Error: unknown tool "${toolName}"`;
	}

	try {
		return await toolDef.handler(toolInput);
	} catch (err) {
		return `Error: ${err instanceof Error ? err.message : String(err)}`;
	}
};

const serializeToolCall = (name: string, input: unknown) =>
	`${name}:${JSON.stringify(input)}`;

type PendingToolCall = {
	id: string;
	input: unknown;
	name: string;
};

type ContentBlock = AIProviderContentBlock;

type ThinkingAccumulator = {
	signature: string;
	text: string;
};

type ToolLoopState = {
	contentBlocks: ContentBlock[];
	currentFullResponse: string;
	currentThinking: ThinkingAccumulator | null;
	currentMessages: AIProviderMessage[];
	currentTurn: number;
	currentUsage: AIUsage | undefined;
	executedToolKeys: Set<string>;
	pendingToolCalls: PendingToolCall[];
};

const handleToolChunkText = (
	chunk: AITextChunk,
	state: ToolLoopState,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messageId: string,
	conversationId: string
) => {
	const textContent = extractTextContent(chunk, options.onChunk);
	state.currentFullResponse += textContent;
	sendMessage(socket, {
		content: textContent,
		conversationId,
		messageId,
		type: 'chunk'
	});
};

const handleToolChunkToolUse = (
	chunk: AIChunk & { type: 'tool_use' },
	state: ToolLoopState
) => {
	state.pendingToolCalls.push({
		id: chunk.id,
		input: chunk.input,
		name: chunk.name
	});
};

const flushThinking = (state: ToolLoopState) => {
	if (state.currentThinking) {
		state.contentBlocks.push({
			signature: state.currentThinking.signature || undefined,
			thinking: state.currentThinking.text,
			type: 'thinking'
		});
		state.currentThinking = null;
	}
};

const processToolChunk = (
	chunk: AIChunk,
	state: ToolLoopState,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messageId: string,
	conversationId: string
) => {
	let hitAnotherTool = false;

	switch (chunk.type) {
		case 'thinking':
			if (chunk.content) {
				sendMessage(socket, {
					content: chunk.content,
					conversationId,
					messageId,
					type: 'thinking'
				});
			}
			if (!state.currentThinking) {
				state.currentThinking = { signature: '', text: '' };
			}
			state.currentThinking.text += chunk.content;
			if (chunk.signature) {
				state.currentThinking.signature = chunk.signature;
			}
			break;

		case 'text':
			flushThinking(state);
			handleToolChunkText(
				chunk,
				state,
				options,
				socket,
				messageId,
				conversationId
			);
			state.contentBlocks.push({
				content: chunk.content,
				type: 'text'
			});
			break;

		case 'image':
			sendImageMessage(socket, chunk, messageId, conversationId);
			options.onImage?.({
				data: chunk.data,
				format: chunk.format,
				imageId: chunk.imageId,
				isPartial: chunk.isPartial,
				revisedPrompt: chunk.revisedPrompt
			});
			break;

		case 'tool_use':
			flushThinking(state);
			handleToolChunkToolUse(chunk, state);
			state.contentBlocks.push({
				id: chunk.id,
				input:
					typeof chunk.input === 'object' && chunk.input !== null
						? chunk.input
						: {},
				name: chunk.name,
				type: 'tool_use'
			});
			hitAnotherTool = true;
			break;

		case 'done':
			flushThinking(state);
			state.currentUsage = chunk.usage;
			break;
	}

	return hitAnotherTool;
};

const processToolTurn = async (
	socket: AIWebSocket,
	options: StreamAIOptions,
	state: ToolLoopState,
	messageId: string,
	conversationId: string,
	signal: AbortSignal
) => {
	const toolCalls = [...state.pendingToolCalls];
	state.pendingToolCalls = [];

	// Build assistant message with all content blocks (thinking + text + tool_use)
	// Anthropic requires the complete assistant response when extended thinking is enabled
	state.currentMessages.push({
		content: state.contentBlocks,
		role: 'assistant'
	});
	state.contentBlocks = [];

	// Execute all tool calls and collect results
	const toolResultBlocks: Array<{
		content: string;
		tool_use_id: string;
		type: 'tool_result';
	}> = [];

	for (const toolCall of toolCalls) {
		// eslint-disable-next-line no-await-in-loop
		await sendToolRunning(
			socket,
			toolCall.name,
			toolCall.input,
			messageId,
			conversationId
		);

		// eslint-disable-next-line no-await-in-loop
		const result = await executeTool(
			options,
			toolCall.name,
			toolCall.input
		);

		// eslint-disable-next-line no-await-in-loop
		await sendToolComplete(
			socket,
			toolCall.name,
			result,
			messageId,
			conversationId
		);

		options.onToolUse?.(toolCall.name, toolCall.input, result);

		toolResultBlocks.push({
			content: result,
			tool_use_id: toolCall.id,
			type: 'tool_result' as const
		});

		state.executedToolKeys.add(
			serializeToolCall(toolCall.name, toolCall.input)
		);
	}

	state.currentMessages.push({
		content: toolResultBlocks,
		role: 'user'
	});

	const toolDefs = options.tools
		? buildToolDefinitions(options.tools)
		: undefined;

	const thinkingConfig = options.thinking
		? {
				budget_tokens:
					typeof options.thinking === 'object'
						? options.thinking.budgetTokens
						: DEFAULT_THINKING_BUDGET,
				type: 'enabled'
			}
		: undefined;

	const stream = options.provider.stream({
		messages: state.currentMessages,
		model: options.model,
		signal,
		systemPrompt: options.systemPrompt,
		thinking: thinkingConfig,
		tools: toolDefs
	});

	await consumeToolStream(
		stream,
		state,
		options,
		socket,
		messageId,
		conversationId,
		signal
	);
};

const consumeToolStream = async (
	stream: AsyncIterable<AIChunk>,
	state: ToolLoopState,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messageId: string,
	conversationId: string,
	signal: AbortSignal
) => {
	let hitAnotherTool = false;

	for await (const chunk of stream) {
		if (signal.aborted) break;

		const isToolHit = processToolChunk(
			chunk,
			state,
			options,
			socket,
			messageId,
			conversationId
		);

		if (isToolHit) hitAnotherTool = true;

		// Don't return early on tool_use — continue consuming
		// the stream to capture usage from the done chunk
	}

	return hitAnotherTool;
};

const shouldContinueToolLoop = (
	state: ToolLoopState,
	maxTurns: number,
	signal: AbortSignal
) =>
	state.pendingToolCalls.length > 0 &&
	state.currentTurn < maxTurns &&
	!signal.aborted;

const areAllRepeatedToolCalls = (state: ToolLoopState) =>
	state.pendingToolCalls.every((toolCall) =>
		state.executedToolKeys.has(
			serializeToolCall(toolCall.name, toolCall.input)
		)
	);

const buildToolLoopResult = (state: ToolLoopState) => ({
	fullResponse: state.currentFullResponse,
	usage: state.currentUsage
});

const executeToolLoop = async (
	socket: AIWebSocket,
	options: StreamAIOptions,
	messages: AIProviderMessage[],
	initialToolCalls: PendingToolCall[],
	initialContentBlocks: ContentBlock[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	fullResponse: string,
	turn: number
) => {
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

	const state: ToolLoopState = {
		contentBlocks: initialContentBlocks,
		currentFullResponse: fullResponse,
		currentMessages: [...messages],
		currentThinking: null,
		currentTurn: turn,
		currentUsage: undefined,
		executedToolKeys: new Set<string>(),
		pendingToolCalls: initialToolCalls
	};

	while (shouldContinueToolLoop(state, maxTurns, signal)) {
		if (areAllRepeatedToolCalls(state)) break;

		// eslint-disable-next-line no-await-in-loop
		await processToolTurn(
			socket,
			options,
			state,
			messageId,
			conversationId,
			signal
		);

		state.currentTurn++;
	}

	return buildToolLoopResult(state);
};

const sendComplete = async (
	socket: AIWebSocket,
	messageId: string,
	conversationId: string,
	usage?: AIUsage,
	durationMs?: number,
	model?: string,
	completeMeta?: StreamAICompleteMetadata
) =>
	sendMessage(socket, {
		conversationId,
		durationMs,
		messageId,
		model,
		sources: completeMeta?.sources,
		type: 'complete',
		usage
	});

const sendError = async (
	socket: AIWebSocket,
	err: unknown,
	messageId: string,
	conversationId: string
) =>
	sendMessage(socket, {
		conversationId,
		message: err instanceof Error ? err.message : String(err),
		messageId,
		type: 'error'
	});

const handleTextChunk = async (
	chunk: AITextChunk,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messageId: string,
	conversationId: string
) => {
	const textContent = extractTextContent(chunk, options.onChunk);

	await sendMessage(socket, {
		content: textContent,
		conversationId,
		messageId,
		type: 'chunk'
	});

	return textContent;
};

const handleToolCalls = async (
	socket: AIWebSocket,
	options: StreamAIOptions,
	messages: AIProviderMessage[],
	toolCalls: PendingToolCall[],
	contentBlocks: ContentBlock[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	fullResponse: string,
	startTime: number
) => {
	const toolResult = await executeToolLoop(
		socket,
		options,
		messages,
		toolCalls,
		contentBlocks,
		messageId,
		conversationId,
		signal,
		fullResponse,
		INITIAL_TURN
	);

	await sendComplete(
		socket,
		messageId,
		conversationId,
		toolResult.usage,
		Date.now() - startTime,
		options.model,
		options.completeMeta
	);
	options.onComplete?.(
		toolResult.fullResponse,
		toolResult.usage,
		options.completeMeta
	);

	return toolResult;
};

const processStreamTextChunk = async (
	chunk: AITextChunk,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messageId: string,
	conversationId: string
) => {
	const textContent = await handleTextChunk(
		chunk,
		options,
		socket,
		messageId,
		conversationId
	);

	return textContent;
};

const processStream = async (
	socket: AIWebSocket,
	options: StreamAIOptions,
	messages: AIProviderMessage[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	startTime: number
) => {
	const toolDefs = options.tools
		? buildToolDefinitions(options.tools)
		: undefined;

	const thinkingConfig = options.thinking
		? {
				budget_tokens:
					typeof options.thinking === 'object'
						? options.thinking.budgetTokens
						: DEFAULT_THINKING_BUDGET,
				type: 'enabled'
			}
		: undefined;

	const stream = options.provider.stream({
		messages,
		model: options.model,
		signal,
		systemPrompt: options.systemPrompt,
		thinking: thinkingConfig,
		tools: toolDefs
	});

	const result = await consumeStream(
		stream,
		options,
		socket,
		messages,
		messageId,
		conversationId,
		signal
	);

	if (result.pendingToolCalls.length > 0) {
		await handleToolCalls(
			socket,
			options,
			messages,
			result.pendingToolCalls,
			result.contentBlocks,
			messageId,
			conversationId,
			signal,
			result.fullResponse,
			startTime
		);
	} else {
		await sendComplete(
			socket,
			messageId,
			conversationId,
			result.usage,
			Date.now() - startTime,
			options.model,
			options.completeMeta
		);
		options.onComplete?.(
			result.fullResponse,
			result.usage,
			options.completeMeta
		);
	}
};

type ConsumeStreamState = {
	contentBlocks: ContentBlock[];
	currentThinking: ThinkingAccumulator | null;
	fullResponse: string;
	pendingToolCalls: PendingToolCall[];
	usage: AIUsage | undefined;
};

const flushStreamThinking = (state: ConsumeStreamState) => {
	if (state.currentThinking) {
		state.contentBlocks.push({
			signature: state.currentThinking.signature || undefined,
			thinking: state.currentThinking.text,
			type: 'thinking'
		});
		state.currentThinking = null;
	}
};

const consumeStreamChunk = async (
	chunk: AIChunk,
	options: StreamAIOptions,
	socket: AIWebSocket,
	state: ConsumeStreamState,
	messageId: string,
	conversationId: string
) => {
	switch (chunk.type) {
		case 'thinking':
			if (chunk.content) {
				await sendMessage(socket, {
					content: chunk.content,
					conversationId,
					messageId,
					type: 'thinking'
				});
			}
			if (!state.currentThinking) {
				state.currentThinking = { signature: '', text: '' };
			}
			state.currentThinking.text += chunk.content;
			if (chunk.signature) {
				state.currentThinking.signature = chunk.signature;
			}
			break;

		case 'text':
			flushStreamThinking(state);
			state.fullResponse += await processStreamTextChunk(
				chunk,
				options,
				socket,
				messageId,
				conversationId
			);
			state.contentBlocks.push({ content: chunk.content, type: 'text' });
			break;

		case 'image':
			await sendImageMessage(socket, chunk, messageId, conversationId);
			options.onImage?.({
				data: chunk.data,
				format: chunk.format,
				imageId: chunk.imageId,
				isPartial: chunk.isPartial,
				revisedPrompt: chunk.revisedPrompt
			});
			break;

		case 'tool_use':
			flushStreamThinking(state);
			state.pendingToolCalls.push({
				id: chunk.id,
				input: chunk.input,
				name: chunk.name
			});
			state.contentBlocks.push({
				id: chunk.id,
				input:
					typeof chunk.input === 'object' && chunk.input !== null
						? chunk.input
						: {},
				name: chunk.name,
				type: 'tool_use'
			});
			break;

		case 'done':
			flushStreamThinking(state);
			state.usage = chunk.usage;
			break;
	}
};

const consumeStream = async (
	stream: AsyncIterable<AIChunk>,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messages: AIProviderMessage[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal
) => {
	const state: ConsumeStreamState = {
		contentBlocks: [],
		currentThinking: null,
		fullResponse: '',
		pendingToolCalls: [],
		usage: undefined
	};

	for await (const chunk of stream) {
		if (signal.aborted) break;

		await consumeStreamChunk(
			chunk,
			options,
			socket,
			state,
			messageId,
			conversationId
		);
	}

	return state;
};

export const streamAI = async (
	socket: AIWebSocket,
	conversationId: string,
	messageId: string,
	options: StreamAIOptions
) => {
	const signal = options.signal ?? new AbortController().signal;
	const startTime = Date.now();

	const messages: AIProviderMessage[] = options.messages
		? [...options.messages]
		: [];

	try {
		await processStream(
			socket,
			options,
			messages,
			messageId,
			conversationId,
			signal,
			startTime
		);
	} catch (err) {
		await handleStreamError(
			socket,
			err,
			messageId,
			conversationId,
			signal,
			startTime
		);
	}
};

const handleStreamError = async (
	socket: AIWebSocket,
	err: unknown,
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	startTime: number
) => {
	if (signal.aborted) {
		await sendComplete(
			socket,
			messageId,
			conversationId,
			undefined,
			Date.now() - startTime
		);

		return;
	}

	await sendError(socket, err, messageId, conversationId);
};
