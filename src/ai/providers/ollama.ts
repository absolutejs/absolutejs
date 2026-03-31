import type {
	AIChunk,
	AIDoneChunk,
	AIProviderConfig,
	AIProviderStreamParams,
	AIProviderToolDefinition
} from '../../../types/ai';

type OllamaConfig = {
	baseUrl?: string;
};

type OllamaMessage = {
	content: string;
	role: 'assistant' | 'system' | 'tool' | 'user';
	tool_calls?: Array<{
		function: { arguments: Record<string, unknown>; name: string };
	}>;
};

const DEFAULT_BASE_URL = 'http://localhost:11434';
const ZERO_TOKENS = 0;

const DONE_CHUNK: AIChunk = { type: 'done' };

const mapToolDefinitions = (tools: AIProviderToolDefinition[]) =>
	tools.map((tool) => ({
		function: {
			description: tool.description,
			name: tool.name,
			parameters: tool.input_schema
		},
		type: 'function'
	}));

const convertMessage = (msg: AIProviderStreamParams['messages'][number]) => {
	if (typeof msg.content === 'string') {
		return [{ content: msg.content, role: msg.role }];
	}

	const results: OllamaMessage[] = [];
	const toolUseBlocks = msg.content.filter(
		(block) => block.type === 'tool_use'
	);
	const toolResultBlocks = msg.content.filter(
		(block) => block.type === 'tool_result'
	);

	if (toolUseBlocks.length > 0) {
		results.push({
			content: '',
			role: 'assistant',
			tool_calls: toolUseBlocks.map((block) => ({
				function: {
					arguments:
						typeof block.input === 'object' && block.input !== null
							? { ...block.input }
							: {},
					name: block.name
				}
			}))
		});
	}

	for (const block of toolResultBlocks) {
		results.push({
			content: typeof block.content === 'string' ? block.content : '',
			role: 'tool'
		});
	}

	return results;
};

const buildRequestBody = (params: AIProviderStreamParams) => {
	const messages: OllamaMessage[] = params.messages.flatMap(convertMessage);

	if (params.systemPrompt) {
		messages.unshift({ content: params.systemPrompt, role: 'system' });
	}

	const body: Record<string, unknown> = {
		messages,
		model: params.model,
		stream: true
	};

	if (params.tools && params.tools.length > 0) {
		body.tools = mapToolDefinitions(params.tools);
	}

	return body;
};

const isRecord = (val: unknown): val is Record<string, unknown> =>
	val !== null && typeof val === 'object' && !Array.isArray(val);

const tryParseJSON = (text: string) => {
	try {
		const result: unknown = JSON.parse(text);
		if (isRecord(result)) {
			return result;
		}

		return null;
	} catch {
		return null;
	}
};

const buildDoneChunk = (parsed: Record<string, unknown>): AIDoneChunk => {
	const promptEvalCount =
		typeof parsed.prompt_eval_count === 'number'
			? parsed.prompt_eval_count
			: undefined;
	const evalCount =
		typeof parsed.eval_count === 'number' ? parsed.eval_count : undefined;
	const totalDuration =
		typeof parsed.total_duration === 'number'
			? parsed.total_duration
			: undefined;

	const hasTokenCounts =
		promptEvalCount !== undefined || evalCount !== undefined;
	if (hasTokenCounts) {
		return {
			type: 'done',
			usage: {
				inputTokens: promptEvalCount ?? ZERO_TOKENS,
				outputTokens: evalCount ?? ZERO_TOKENS
			}
		};
	}

	if (totalDuration !== undefined) {
		return {
			type: 'done',
			usage: { inputTokens: ZERO_TOKENS, outputTokens: ZERO_TOKENS }
		};
	}

	return { type: 'done' };
};

const buildTextChunk = (content: string): AIChunk => ({
	content,
	type: 'text'
});

const extractToolCalls = (message: Record<string, unknown>) => {
	const toolCalls = message.tool_calls;

	if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
		return [];
	}

	return toolCalls
		.filter(isRecord)
		.filter((call) => isRecord(call.function))
		.map((call) => {
			const func = call.function;

			if (!isRecord(func)) {
				return {
					id: crypto.randomUUID(),
					input: {},
					name: '',
					type: 'tool_use' as const
				};
			}

			return {
				id: crypto.randomUUID(),
				input: func.arguments ?? {},
				name: typeof func.name === 'string' ? func.name : '',
				type: 'tool_use' as const
			};
		});
};

const extractChunks = (parsed: Record<string, unknown>) => {
	const { message } = parsed;

	if (!isRecord(message)) {
		return [];
	}

	const toolChunks = extractToolCalls(message);

	if (toolChunks.length > 0) {
		return toolChunks;
	}

	const { content } = message;

	if (typeof content !== 'string' || !content) {
		return [];
	}

	return [buildTextChunk(content)];
};

const processLine = (line: string) => {
	const trimmed = line.trim();

	if (!trimmed) {
		return [];
	}

	const parsed = tryParseJSON(trimmed);

	if (!parsed) {
		return [];
	}

	if (parsed.done === true) {
		return [buildDoneChunk(parsed)];
	}

	return extractChunks(parsed);
};

const processBufferedLines = (lines: string[]) => lines.flatMap(processLine);

const readStreamChunks = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	buffer: string,
	signal?: AbortSignal
) => {
	const emptyChunks: AIChunk[] = [];

	if (signal?.aborted) {
		return {
			allChunks: emptyChunks,
			currentBuffer: buffer,
			finished: true
		};
	}

	const result = await reader.read();
	const { done, value } = result;

	if (done) {
		return {
			allChunks: emptyChunks,
			currentBuffer: buffer,
			finished: true
		};
	}

	const currentBuffer = buffer + decoder.decode(value, { stream: true });
	const lines = currentBuffer.split('\n');
	const remainder = lines.pop() ?? '';
	const allChunks = processBufferedLines(lines);
	const finished = allChunks.some((c) => c.type === 'done');

	return { allChunks, currentBuffer: remainder, finished };
};

const parseNDJSONStream = async function* (
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
) {
	const reader = body.getReader();

	try {
		yield* parseNDJSONStreamInner(reader, signal);
	} finally {
		reader.releaseLock();
	}
};

const parseNDJSONStreamInner = async function* (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal?: AbortSignal
) {
	const decoder = new TextDecoder();
	let buffer = '';
	let done = false;

	while (!done) {
		// eslint-disable-next-line no-await-in-loop
		const result = await readStreamChunks(reader, decoder, buffer, signal);
		buffer = result.currentBuffer;
		done = result.finished;

		yield* result.allChunks;
	}

	yield DONE_CHUNK;
};

const fetchAndStream = async function* (
	baseUrl: string,
	params: AIProviderStreamParams
) {
	const requestBody = buildRequestBody(params);

	const response = await fetch(`${baseUrl}/api/chat`, {
		body: JSON.stringify(requestBody),
		headers: { 'Content-Type': 'application/json' },
		method: 'POST',
		signal: params.signal
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Ollama API error ${response.status}: ${errorText}`);
	}

	if (!response.body) {
		throw new Error('Ollama API returned no response body');
	}

	yield* parseNDJSONStream(response.body, params.signal);
};

export const ollama = (config: OllamaConfig = {}): AIProviderConfig => {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

	return {
		stream: (params: AIProviderStreamParams) =>
			fetchAndStream(baseUrl, params)
	};
};
