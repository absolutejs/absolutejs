import type {
	AIProviderConfig,
	AIProviderContentBlock,
	AIProviderMessage,
	AIProviderStreamParams,
	AIProviderToolDefinition,
	AIUsage
} from '../../../types/ai';

type GeminiConfig = {
	apiKey: string;
	baseUrl?: string;
	imageModels?: Set<string> | string[];
};

type StreamState = {
	buffer: string;
	usage: AIUsage | undefined;
};

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const SSE_DATA_PREFIX_LENGTH = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isRecordArray = (
	value: unknown
): value is Array<Record<string, unknown>> =>
	Array.isArray(value) && value.length > 0 && isRecord(value[0]);

/* ─── Message conversion ─── */

const mapRole = (role: string) => {
	if (role === 'assistant' || role === 'system') return 'model';

	return 'user';
};

const mapContentBlock = (block: AIProviderContentBlock) => {
	switch (block.type) {
		case 'text':
			return { text: block.content };
		case 'image':
			return {
				inlineData: {
					data: block.source.data,
					mimeType: block.source.media_type
				}
			};
		case 'document':
			return {
				inlineData: {
					data: block.source.data,
					mimeType: block.source.media_type
				}
			};
		case 'tool_use':
			return {
				functionCall: {
					args:
						typeof block.input === 'string'
							? JSON.parse(block.input)
							: block.input,
					name: block.name
				}
			};
		case 'tool_result':
			return {
				functionResponse: {
					name: block.tool_use_id,
					response: { result: block.content }
				}
			};
		default:
			return null;
	}
};

const convertMessageContent = (content: string | AIProviderContentBlock[]) => {
	if (typeof content === 'string') {
		return [{ text: content }];
	}

	return content.map(mapContentBlock).filter((mapped) => mapped !== null);
};

const hasFunctionResponse = (content: AIProviderContentBlock[]) =>
	content.some((block) => block.type === 'tool_result');

const convertSingleMessage = (msg: AIProviderMessage) => {
	if (typeof msg.content !== 'string' && hasFunctionResponse(msg.content)) {
		return { parts: convertMessageContent(msg.content), role: 'user' };
	}

	return {
		parts: convertMessageContent(msg.content),
		role: mapRole(msg.role)
	};
};

const convertMessages = (messages: AIProviderMessage[]) =>
	messages.map(convertSingleMessage);

const mapToolDefinitions = (tools: AIProviderToolDefinition[]) =>
	tools.map((tool) => ({
		description: tool.description,
		name: tool.name,
		parameters: tool.input_schema
	}));

const buildRequestBody = (
	params: AIProviderStreamParams,
	isImageModel: boolean
) => {
	const body: Record<string, unknown> = {
		contents: convertMessages(params.messages)
	};

	if (isImageModel) {
		body.generationConfig = {
			responseModalities: ['TEXT', 'IMAGE']
		};
	}

	if (params.systemPrompt) {
		body.systemInstruction = {
			parts: [{ text: params.systemPrompt }]
		};
	}

	if (params.tools && params.tools.length > 0) {
		body.tools = [
			{ functionDeclarations: mapToolDefinitions(params.tools) }
		];
	}

	return body;
};

/* ─── SSE parsing ─── */

const extractMimeFormat = (mimeType: unknown) => {
	if (typeof mimeType !== 'string') {
		return 'png';
	}

	if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpeg';
	if (mimeType.includes('webp')) return 'webp';

	return 'png';
};

const processTextPart = function* (part: Record<string, unknown>) {
	if (typeof part.text === 'string' && part.text) {
		yield { content: part.text, type: 'text' as const };
	}
};

const processInlineDataPart = function* (inlineData: Record<string, unknown>) {
	const data = typeof inlineData.data === 'string' ? inlineData.data : '';
	const { mimeType } = inlineData;

	if (!data) {
		return;
	}

	yield {
		data,
		format: extractMimeFormat(mimeType),
		isPartial: false,
		type: 'image' as const
	};
};

const processFunctionCallPart = function* (
	functionCall: Record<string, unknown>
) {
	const name = typeof functionCall.name === 'string' ? functionCall.name : '';
	const args = functionCall.args ?? {};

	yield {
		id: `gemini-${name}-${Date.now()}`,
		input: args,
		name,
		type: 'tool_use' as const
	};
};

const processPart = function* (part: Record<string, unknown>) {
	if ('text' in part) {
		yield* processTextPart(part);
	}

	if (isRecord(part.inlineData)) {
		yield* processInlineDataPart(part.inlineData);
	}

	if (isRecord(part.functionCall)) {
		yield* processFunctionCallPart(part.functionCall);
	}
};

const extractUsage = (parsed: Record<string, unknown>): AIUsage | undefined => {
	if (!isRecord(parsed.usageMetadata)) {
		return undefined;
	}

	const { usageMetadata } = parsed;

	return {
		inputTokens:
			typeof usageMetadata.promptTokenCount === 'number'
				? usageMetadata.promptTokenCount
				: 0,
		outputTokens:
			typeof usageMetadata.candidatesTokenCount === 'number'
				? usageMetadata.candidatesTokenCount
				: 0
	};
};

const processChunk = function* (
	parsed: Record<string, unknown>,
	state: StreamState
) {
	const usage = extractUsage(parsed);

	if (usage) {
		state.usage = usage;
	}

	if (!isRecordArray(parsed.candidates)) {
		return;
	}

	const [candidate] = parsed.candidates;

	if (!candidate || !isRecord(candidate.content)) {
		return;
	}

	const { content } = candidate;

	if (!isRecordArray(content.parts)) {
		return;
	}

	for (const part of content.parts) {
		yield* processPart(part);
	}
};

const processSSELine = function* (line: string, state: StreamState) {
	const trimmed = line.trim();

	if (!trimmed || !trimmed.startsWith('data: ')) {
		return;
	}

	const data = trimmed.slice(SSE_DATA_PREFIX_LENGTH);

	let parsed: Record<string, unknown>;

	try {
		parsed = JSON.parse(data);
	} catch {
		return;
	}

	yield* processChunk(parsed, state);
};

const processSSEBuffer = function* (lines: string[], state: StreamState) {
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

		yield* processSSEBuffer(lines, state);
	}

	if (textBuffer.trim()) {
		yield* processSSELine(textBuffer, state);
	}

	yield { type: 'done' as const, usage: state.usage };
};

const parseSSEStream = async function* (
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const state: StreamState = {
		buffer: '',
		usage: undefined
	};

	try {
		yield* drainReader(reader, decoder, state, signal);
	} finally {
		reader.releaseLock();
	}
};

const fetchGeminiStream = async function* (
	baseUrl: string,
	apiKey: string,
	model: string,
	body: Record<string, unknown>,
	signal?: AbortSignal
) {
	const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

	const response = await fetch(url, {
		body: JSON.stringify(body),
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST',
		signal
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error ${response.status}: ${errorText}`);
	}

	if (!response.body) {
		throw new Error('Gemini API returned no response body');
	}

	yield* parseSSEStream(response.body, signal);
};

const resolveImageModels = (raw: Set<string> | string[] | undefined) => {
	if (!raw) {
		return new Set<string>();
	}

	if (raw instanceof Set) {
		return raw;
	}

	return new Set(raw);
};

export const gemini = (config: GeminiConfig): AIProviderConfig => {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const imageModels = resolveImageModels(config.imageModels);

	return {
		stream: (params: AIProviderStreamParams) => {
			const isImageModel = imageModels.has(params.model);
			const body = buildRequestBody(params, isImageModel);

			return fetchGeminiStream(
				baseUrl,
				config.apiKey,
				params.model,
				body,
				params.signal
			);
		}
	};
};
