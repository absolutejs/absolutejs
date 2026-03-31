import type {
	AIChunk,
	AIImageChunk,
	AIProviderMessage,
	AIServerMessage,
	AITextChunk,
	AIToolMap,
	AIUsage,
	AIWebSocket,
	StreamAIOptions
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

const sendMessage = async (socket: AIWebSocket, msg: AIServerMessage) => {
	if (socket.readyState !== WS_OPEN) {
		return false;
	}

	await checkBackpressure(socket);

	socket.send(serializeAIMessage(msg));

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

const buildToolUseBlock = (
	toolUseId: string,
	toolName: string,
	toolInput: unknown
) => [
	{
		id: toolUseId,
		input: toolInput,
		name: toolName,
		type: 'tool_use' as const
	}
];

const buildToolResultBlock = (toolUseId: string, result: string) => [
	{
		content: result,
		tool_use_id: toolUseId,
		type: 'tool_result' as const
	}
];

const serializeToolCall = (name: string, input: unknown) =>
	`${name}:${JSON.stringify(input)}`;

type ToolLoopState = {
	currentFullResponse: string;
	currentMessages: AIProviderMessage[];
	currentToolInput: unknown;
	currentToolName: string;
	currentToolUseId: string;
	currentTurn: number;
	currentUsage: AIUsage | undefined;
	previousToolCallKey: string;
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
	state.currentToolUseId = chunk.id;
	state.currentToolName = chunk.name;
	state.currentToolInput = chunk.input;
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
		case 'text':
			handleToolChunkText(
				chunk,
				state,
				options,
				socket,
				messageId,
				conversationId
			);
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
			handleToolChunkToolUse(chunk, state);
			hitAnotherTool = true;
			break;

		case 'done':
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
	await sendToolRunning(
		socket,
		state.currentToolName,
		state.currentToolInput,
		messageId,
		conversationId
	);

	const result = await executeTool(
		options,
		state.currentToolName,
		state.currentToolInput
	);

	await sendToolComplete(
		socket,
		state.currentToolName,
		result,
		messageId,
		conversationId
	);

	options.onToolUse?.(state.currentToolName, state.currentToolInput, result);

	state.currentMessages.push({
		content: buildToolUseBlock(
			state.currentToolUseId,
			state.currentToolName,
			state.currentToolInput
		),
		role: 'assistant'
	});

	state.currentMessages.push({
		content: buildToolResultBlock(state.currentToolUseId, result),
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

	return consumeToolStream(
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

		if (isToolHit) return true;
	}

	return false;
};

const shouldContinueToolLoop = (
	state: ToolLoopState,
	maxTurns: number,
	signal: AbortSignal
) => state.currentTurn < maxTurns && !signal.aborted;

const isRepeatedToolCall = (state: ToolLoopState) => {
	const currentKey = serializeToolCall(
		state.currentToolName,
		state.currentToolInput
	);

	if (currentKey === state.previousToolCallKey) {
		return true;
	}

	state.previousToolCallKey = currentKey;

	return false;
};

const buildToolLoopResult = (state: ToolLoopState) => ({
	fullResponse: state.currentFullResponse,
	usage: state.currentUsage
});

const executeToolLoop = async (
	socket: AIWebSocket,
	options: StreamAIOptions,
	messages: AIProviderMessage[],
	toolUseId: string,
	toolName: string,
	toolInput: unknown,
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	fullResponse: string,
	turn: number
) => {
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

	const state: ToolLoopState = {
		currentFullResponse: fullResponse,
		currentMessages: [...messages],
		currentToolInput: toolInput,
		currentToolName: toolName,
		currentToolUseId: toolUseId,
		currentTurn: turn,
		currentUsage: undefined,
		previousToolCallKey: ''
	};

	while (shouldContinueToolLoop(state, maxTurns, signal)) {
		if (isRepeatedToolCall(state)) break;

		// eslint-disable-next-line no-await-in-loop
		const hitAnotherTool = await processToolTurn(
			socket,
			options,
			state,
			messageId,
			conversationId,
			signal
		);

		if (!hitAnotherTool) return buildToolLoopResult(state);

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
	model?: string
) =>
	sendMessage(socket, {
		conversationId,
		durationMs,
		messageId,
		model,
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

const handleToolUseChunk = async (
	socket: AIWebSocket,
	options: StreamAIOptions,
	messages: AIProviderMessage[],
	chunkId: string,
	chunkName: string,
	chunkInput: unknown,
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
		chunkId,
		chunkName,
		chunkInput,
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
		options.model
	);
	options.onComplete?.(toolResult.fullResponse, toolResult.usage);

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

const processStreamToolUseChunk = async (
	chunk: AIChunk & { type: 'tool_use' },
	socket: AIWebSocket,
	options: StreamAIOptions,
	messages: AIProviderMessage[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	fullResponse: string,
	startTime: number
) => {
	await handleToolUseChunk(
		socket,
		options,
		messages,
		chunk.id,
		chunk.name,
		chunk.input,
		messageId,
		conversationId,
		signal,
		fullResponse,
		startTime
	);
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
		signal,
		startTime
	);

	if (!result.earlyReturn) {
		await sendComplete(
			socket,
			messageId,
			conversationId,
			result.usage,
			Date.now() - startTime,
			options.model
		);
		options.onComplete?.(result.fullResponse, result.usage);
	}
};

type ConsumeStreamResult = {
	earlyReturn: boolean;
	fullResponse: string;
	usage: AIUsage | undefined;
};

const consumeStreamChunk = async (
	chunk: AIChunk,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messages: AIProviderMessage[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	fullResponse: string,
	startTime: number
) => {
	switch (chunk.type) {
		case 'thinking':
			await sendMessage(socket, {
				content: chunk.content,
				conversationId,
				messageId,
				type: 'thinking'
			});

			return '';

		case 'text':
			return processStreamTextChunk(
				chunk,
				options,
				socket,
				messageId,
				conversationId
			);

		case 'image':
			await sendImageMessage(socket, chunk, messageId, conversationId);
			options.onImage?.({
				data: chunk.data,
				format: chunk.format,
				imageId: chunk.imageId,
				isPartial: chunk.isPartial,
				revisedPrompt: chunk.revisedPrompt
			});

			return '';

		case 'tool_use':
			await processStreamToolUseChunk(
				chunk,
				socket,
				options,
				messages,
				messageId,
				conversationId,
				signal,
				fullResponse,
				startTime
			);

			return { earlyReturn: true, fullResponse, usage: undefined };

		case 'done':
			return { earlyReturn: false, fullResponse, usage: chunk.usage };
	}

	return '';
};

type ConsumeStreamState = {
	fullResponse: string;
	usage: AIUsage | undefined;
};

const applyStreamChunkResult = (
	result: ConsumeStreamResult | string,
	state: ConsumeStreamState
) => {
	if (typeof result === 'string') {
		state.fullResponse += result;

		return undefined;
	}

	if (result.earlyReturn) return result;

	state.usage = result.usage;

	return undefined;
};

const consumeStream = async (
	stream: AsyncIterable<AIChunk>,
	options: StreamAIOptions,
	socket: AIWebSocket,
	messages: AIProviderMessage[],
	messageId: string,
	conversationId: string,
	signal: AbortSignal,
	startTime: number
) => {
	const state: ConsumeStreamState = { fullResponse: '', usage: undefined };

	for await (const chunk of stream) {
		if (signal.aborted) break;

		const result = await consumeStreamChunk(
			chunk,
			options,
			socket,
			messages,
			messageId,
			conversationId,
			signal,
			state.fullResponse,
			startTime
		);
		const earlyExit = applyStreamChunkResult(result, state);

		if (earlyExit) return earlyExit;
	}

	const finalResult: ConsumeStreamResult = {
		earlyReturn: false,
		fullResponse: state.fullResponse,
		usage: state.usage
	};

	return finalResult;
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
