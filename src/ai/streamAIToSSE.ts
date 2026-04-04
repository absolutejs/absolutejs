import type {
	AIChunk,
	AIProviderContentBlock,
	AIProviderMessage,
	AIToolMap,
	AIUsage,
	StreamAIOptions
} from '../../types/ai';
import type { ResolvedRenderers } from './htmxRenderers';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_THINKING_BUDGET = 10_000;

type PendingToolCall = {
	id: string;
	input: unknown;
	name: string;
};

type ThinkingAccumulator = {
	signature: string;
	text: string;
};

const buildToolDefinitions = (tools: AIToolMap) =>
	Object.entries(tools).map(([name, def]) => ({
		description: def.description,
		input_schema: def.input,
		name
	}));

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

const buildThinkingConfig = (options: StreamAIOptions) =>
	options.thinking
		? {
				budget_tokens:
					typeof options.thinking === 'object'
						? options.thinking.budgetTokens
						: DEFAULT_THINKING_BUDGET,
				type: 'enabled'
			}
		: undefined;

const serializeToolCall = (name: string, input: unknown) =>
	`${name}:${JSON.stringify(input)}`;

export const streamAIToSSE = async function* (
	conversationId: string,
	messageId: string,
	options: StreamAIOptions,
	renderers: ResolvedRenderers
) {
	const signal = options.signal ?? new AbortController().signal;
	const startTime = Date.now();
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

	const messages: AIProviderMessage[] = options.messages
		? [...options.messages]
		: [];

	try {
		yield* streamTurns(
			options,
			renderers,
			messages,
			signal,
			startTime,
			maxTurns
		);
	} catch (err) {
		if (signal.aborted) return;

		yield {
			data: renderers.error(
				err instanceof Error ? err.message : String(err)
			),
			event: 'status'
		};
	}
};

type TurnState = {
	allToolsHtml: string;
	currentMessages: AIProviderMessage[];
	executedToolKeys: Set<string>;
	fullResponse: string;
	turn: number;
};

type ChunkState = {
	contentBlocks: AIProviderContentBlock[];
	currentThinking: ThinkingAccumulator | null;
	pendingToolCalls: PendingToolCall[];
	usage: AIUsage | undefined;
};

const flushThinking = (
	thinking: ThinkingAccumulator,
	contentBlocks: AIProviderContentBlock[]
) => {
	contentBlocks.push({
		signature: thinking.signature || undefined,
		thinking: thinking.text,
		type: 'thinking'
	});
};

const yieldCompletion = (
	renderers: ResolvedRenderers,
	options: StreamAIOptions,
	fullResponse: string,
	usage: AIUsage | undefined,
	startTime: number
) => {
	const durationMs = Date.now() - startTime;
	options.onComplete?.(fullResponse, usage);

	return {
		data: renderers.complete(usage, durationMs, options.model),
		event: 'status'
	};
};

const processThinkingChunk = function* (
	content: string,
	signature: string | undefined,
	chunkState: ChunkState,
	renderers: ResolvedRenderers
) {
	chunkState.currentThinking ??= { signature: '', text: '' };
	chunkState.currentThinking.text += content;
	chunkState.currentThinking.signature =
		signature ?? chunkState.currentThinking.signature;
	yield {
		data: renderers.thinking(chunkState.currentThinking.text),
		event: 'thinking'
	};
};

const maybeFlushThinking = (chunkState: ChunkState) => {
	if (!chunkState.currentThinking) return;

	flushThinking(chunkState.currentThinking, chunkState.contentBlocks);
	chunkState.currentThinking = null;
};

const processTextChunk = function* (
	content: string,
	chunkState: ChunkState,
	renderers: ResolvedRenderers,
	fullResponse: string
) {
	maybeFlushThinking(chunkState);
	chunkState.contentBlocks.push({
		content,
		type: 'text'
	});
	yield {
		data: renderers.chunk(content, fullResponse + content),
		event: 'content'
	};
};

const processImageChunk = function* (
	chunk: AIChunk & { type: 'image' },
	renderers: ResolvedRenderers,
	options: StreamAIOptions
) {
	yield {
		data: renderers.image(chunk.data, chunk.format, chunk.revisedPrompt),
		event: 'images'
	};
	options.onImage?.({
		data: chunk.data,
		format: chunk.format,
		imageId: chunk.imageId,
		isPartial: chunk.isPartial,
		revisedPrompt: chunk.revisedPrompt
	});
};

const processToolUseChunk = (
	chunk: AIChunk & { type: 'tool_use' },
	chunkState: ChunkState
) => {
	maybeFlushThinking(chunkState);
	chunkState.pendingToolCalls.push({
		id: chunk.id,
		input: chunk.input,
		name: chunk.name
	});
	chunkState.contentBlocks.push({
		id: chunk.id,
		input:
			typeof chunk.input === 'object' && chunk.input !== null
				? chunk.input
				: {},
		name: chunk.name,
		type: 'tool_use'
	});
};

const processChunk = function* (
	chunk: AIChunk,
	chunkState: ChunkState,
	renderers: ResolvedRenderers,
	options: StreamAIOptions,
	fullResponse: string
) {
	switch (chunk.type) {
		case 'thinking':
			yield* processThinkingChunk(
				chunk.content,
				chunk.signature,
				chunkState,
				renderers
			);
			break;

		case 'text':
			yield* processTextChunk(
				chunk.content,
				chunkState,
				renderers,
				fullResponse
			);
			break;

		case 'image':
			yield* processImageChunk(chunk, renderers, options);
			break;

		case 'tool_use':
			processToolUseChunk(chunk, chunkState);
			break;

		case 'done':
			maybeFlushThinking(chunkState);
			chunkState.usage = chunk.usage;
			break;
	}
};

const executeToolCalls = async function* (
	pendingToolCalls: PendingToolCall[],
	options: StreamAIOptions,
	renderers: ResolvedRenderers,
	turnState: TurnState
) {
	const toolResultBlocks: Array<{
		content: string;
		tool_use_id: string;
		type: 'tool_result';
	}> = [];

	for (const toolCall of pendingToolCalls) {
		turnState.allToolsHtml += renderers.toolRunning(
			toolCall.name,
			toolCall.input
		);
		yield { data: turnState.allToolsHtml, event: 'tools' };

		// eslint-disable-next-line no-await-in-loop
		const result = await executeTool(
			options,
			toolCall.name,
			toolCall.input
		);

		turnState.allToolsHtml = turnState.allToolsHtml.replace(
			renderers.toolRunning(toolCall.name, toolCall.input),
			renderers.toolComplete(toolCall.name, result)
		);
		yield { data: turnState.allToolsHtml, event: 'tools' };

		options.onToolUse?.(toolCall.name, toolCall.input, result);

		toolResultBlocks.push({
			content: result,
			tool_use_id: toolCall.id,
			type: 'tool_result'
		});

		turnState.executedToolKeys.add(
			serializeToolCall(toolCall.name, toolCall.input)
		);
	}

	return toolResultBlocks;
};

const consumeStream = async function* (
	stream: AsyncIterable<AIChunk>,
	chunkState: ChunkState,
	renderers: ResolvedRenderers,
	options: StreamAIOptions,
	turnState: TurnState,
	signal: AbortSignal
) {
	for await (const chunk of stream) {
		if (signal.aborted) break;

		const prevResponse = turnState.fullResponse;
		yield* processChunk(
			chunk,
			chunkState,
			renderers,
			options,
			turnState.fullResponse
		);
		if (chunk.type !== 'text') continue;

		turnState.fullResponse = prevResponse + chunk.content;
	}
};

const shouldStopToolLoop = (
	chunkState: ChunkState,
	turnState: TurnState,
	signal: AbortSignal
) => {
	if (chunkState.pendingToolCalls.length === 0 || signal.aborted) {
		return true;
	}

	return chunkState.pendingToolCalls.every((toolCall) =>
		turnState.executedToolKeys.has(
			serializeToolCall(toolCall.name, toolCall.input)
		)
	);
};

const processTurn = async function* (
	chunkState: ChunkState,
	options: StreamAIOptions,
	renderers: ResolvedRenderers,
	turnState: TurnState
) {
	turnState.currentMessages.push({
		content: chunkState.contentBlocks,
		role: 'assistant'
	});

	const toolResults = yield* executeToolCalls(
		chunkState.pendingToolCalls,
		options,
		renderers,
		turnState
	);

	turnState.currentMessages.push({
		content: toolResults,
		role: 'user'
	});
};

const streamTurns = async function* (
	options: StreamAIOptions,
	renderers: ResolvedRenderers,
	messages: AIProviderMessage[],
	signal: AbortSignal,
	startTime: number,
	maxTurns: number
) {
	const turnState: TurnState = {
		allToolsHtml: '',
		currentMessages: [...messages],
		executedToolKeys: new Set<string>(),
		fullResponse: '',
		turn: 0
	};

	const toolDefs = options.tools
		? buildToolDefinitions(options.tools)
		: undefined;
	const thinkingConfig = buildThinkingConfig(options);

	for (; turnState.turn <= maxTurns && !signal.aborted; turnState.turn++) {
		const chunkState: ChunkState = {
			contentBlocks: [],
			currentThinking: null,
			pendingToolCalls: [],
			usage: undefined
		};

		const stream = options.provider.stream({
			messages: turnState.currentMessages,
			model: options.model,
			signal,
			systemPrompt: options.systemPrompt,
			thinking: thinkingConfig,
			tools: toolDefs
		});

		yield* consumeStream(
			stream,
			chunkState,
			renderers,
			options,
			turnState,
			signal
		);

		if (shouldStopToolLoop(chunkState, turnState, signal)) {
			return void (yield yieldCompletion(
				renderers,
				options,
				turnState.fullResponse,
				chunkState.usage,
				startTime
			));
		}

		yield* processTurn(chunkState, options, renderers, turnState);
	}

	return undefined;
};
