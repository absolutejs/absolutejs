import type {
	RAGFileExtractionInput,
	RAGMediaTranscriber,
	RAGOCRProvider
} from '../../../types/ai';
import { createRAGMediaTranscriber, createRAGOCRProvider } from './ingestion';

type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit | BunFetchRequestInit
) => Promise<Response>;

export type OpenAITranscriptionConfig = {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
	language?: string;
	prompt?: string;
};

export type OpenAICompatibleTranscriptionConfig = OpenAITranscriptionConfig & {
	baseUrl: string;
};

export type OpenAIOCRConfig = {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
	prompt?: string;
};

export type OpenAICompatibleOCRConfig = OpenAIOCRConfig & {
	baseUrl: string;
};

export type GeminiOCRConfig = {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
	prompt?: string;
};

export type OllamaOCRConfig = {
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
	prompt?: string;
};

export type OllamaTranscriptionConfig = {
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
	prompt?: string;
};

export type AnthropicOCRConfig = {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
	prompt?: string;
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_TRANSCRIPTION_PROMPT =
	'Transcribe the full spoken content as clean text. Preserve names, dates, and factual wording.';
const DEFAULT_OCR_PROMPT =
	'Extract all readable text exactly and return only the text content in reading order.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const toErrorMessage = async (response: Response) => {
	const text = await response.text();

	return text || `Request failed with status ${response.status}`;
};

const parseJsonResponse = async (response: Response) => {
	const text = await response.text();

	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`Provider returned invalid JSON: ${text}`);
	}
};

const inferFileName = (input: RAGFileExtractionInput, fallback: string) =>
	input.name ??
	input.path?.split(/[\\/]/).at(-1) ??
	input.source?.split('/').at(-1) ??
	fallback;

const inferContentType = (input: RAGFileExtractionInput, fallback: string) =>
	input.contentType ?? fallback;

const buildDataUrl = (input: RAGFileExtractionInput, fallbackType: string) =>
	`data:${inferContentType(input, fallbackType)};base64,${Buffer.from(input.data).toString('base64')}`;

const readOpenAIResponsesText = (payload: unknown) => {
	if (!isRecord(payload)) {
		throw new Error('OCR provider returned an invalid response payload.');
	}

	if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
		return payload.output_text.trim();
	}

	if (!Array.isArray(payload.output)) {
		throw new Error('OCR provider response is missing output text.');
	}

	const parts = payload.output.flatMap((entry) => {
		if (!isRecord(entry) || !Array.isArray(entry.content)) {
			return [];
		}

		return entry.content
			.filter(
				(content): content is Record<string, unknown> =>
					isRecord(content) &&
					content.type === 'output_text' &&
					typeof content.text === 'string'
			)
			.map((content) => String(content.text));
	});

	const combined = parts.join('\n').trim();
	if (!combined) {
		throw new Error('OCR provider response did not contain text.');
	}

	return combined;
};

const createOpenAITranscriptionRequest = (
	input: RAGFileExtractionInput,
	config: OpenAITranscriptionConfig,
	model: string
) => {
	const form = new FormData();
	form.append(
		'file',
		new File([Buffer.from(input.data)], inferFileName(input, 'audio.bin'), {
			type: inferContentType(input, 'application/octet-stream')
		})
	);
	form.append('model', model);
	form.append('response_format', 'verbose_json');

	if (config.language) {
		form.append('language', config.language);
	}
	if (config.prompt) {
		form.append('prompt', config.prompt);
	}

	return form;
};

const createOpenAIOCRInput = (
	input: RAGFileExtractionInput,
	prompt: string
) => {
	const content: Array<Record<string, unknown>> = [
		{
			text: prompt,
			type: 'input_text'
		}
	];

	const contentType = inferContentType(input, 'application/octet-stream');
	if (contentType.startsWith('image/')) {
		content.push({
			image_url: buildDataUrl(input, contentType),
			type: 'input_image'
		});
	} else {
		content.push({
			file_data: buildDataUrl(input, contentType),
			filename: inferFileName(input, 'document.pdf'),
			type: 'input_file'
		});
	}

	return [
		{
			content,
			role: 'user',
			type: 'message'
		}
	];
};

export const anthropicOCR = (config: AnthropicOCRConfig): RAGOCRProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGOCRProvider({
		name: 'anthropic',
		extractText: async (input) => {
			const model = config.defaultModel ?? 'claude-3-5-sonnet-latest';
			const contentType = inferContentType(
				input,
				'application/octet-stream'
			);
			const mediaBlock = contentType.startsWith('image/')
				? {
						source: {
							data: Buffer.from(input.data).toString('base64'),
							media_type: contentType,
							type: 'base64'
						},
						type: 'image'
					}
				: {
						source: {
							data: Buffer.from(input.data).toString('base64'),
							media_type: 'application/pdf',
							type: 'base64'
						},
						type: 'document'
					};
			const response = await fetchImpl(`${baseUrl}/v1/messages`, {
				body: JSON.stringify({
					max_tokens: 2048,
					messages: [
						{
							content: [
								{
									text: config.prompt ?? DEFAULT_OCR_PROMPT,
									type: 'text'
								},
								mediaBlock
							],
							role: 'user'
						}
					],
					model
				}),
				headers: {
					'anthropic-version': ANTHROPIC_API_VERSION,
					'content-type': 'application/json',
					'x-api-key': config.apiKey
				},
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(
					`Anthropic OCR API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			const payload = await parseJsonResponse(response);
			const text =
				isRecord(payload) && Array.isArray(payload.content)
					? payload.content
							.filter(
								(part): part is Record<string, unknown> =>
									isRecord(part) &&
									part.type === 'text' &&
									typeof part.text === 'string'
							)
							.map((part) => String(part.text))
							.join('\n')
							.trim()
					: '';

			if (!text) {
				throw new Error('Anthropic OCR response did not contain text.');
			}

			return {
				metadata: {
					ocrModel: model,
					providerName: 'anthropic'
				},
				text
			};
		}
	});
};
export const geminiOCR = (config: GeminiOCRConfig): RAGOCRProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_GEMINI_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGOCRProvider({
		name: 'gemini',
		extractText: async (input) => {
			const model = config.defaultModel ?? 'gemini-2.5-flash';
			const response = await fetchImpl(
				`${baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
				{
					body: JSON.stringify({
						contents: [
							{
								parts: [
									{
										text:
											config.prompt ?? DEFAULT_OCR_PROMPT
									},
									{
										inlineData: {
											data: Buffer.from(
												input.data
											).toString('base64'),
											mimeType: inferContentType(
												input,
												'application/octet-stream'
											)
										}
									}
								]
							}
						]
					}),
					headers: {
						'Content-Type': 'application/json'
					},
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(
					`Gemini OCR API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			const payload = await parseJsonResponse(response);
			const text =
				isRecord(payload) &&
				Array.isArray(payload.candidates) &&
				isRecord(payload.candidates[0]) &&
				isRecord(payload.candidates[0].content) &&
				Array.isArray(payload.candidates[0].content.parts)
					? payload.candidates[0].content.parts
							.filter(
								(part): part is Record<string, unknown> =>
									isRecord(part) &&
									typeof part.text === 'string'
							)
							.map((part) => String(part.text))
							.join('\n')
							.trim()
					: '';

			if (!text) {
				throw new Error('Gemini OCR response did not contain text.');
			}

			return {
				metadata: {
					ocrModel: model,
					providerName: 'gemini'
				},
				text
			};
		}
	});
};
export const ollamaOCR = (config: OllamaOCRConfig = {}): RAGOCRProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGOCRProvider({
		name: 'ollama',
		extractText: async (input) => {
			const model = config.defaultModel ?? 'llava';
			const response = await fetchImpl(`${baseUrl}/api/generate`, {
				body: JSON.stringify({
					model,
					prompt: config.prompt ?? DEFAULT_OCR_PROMPT,
					images: [Buffer.from(input.data).toString('base64')],
					stream: false
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(
					`Ollama OCR API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			const payload = await parseJsonResponse(response);
			if (!isRecord(payload) || typeof payload.response !== 'string') {
				throw new Error('Ollama OCR response did not contain text.');
			}

			return {
				metadata: {
					ocrModel: model,
					providerName: 'ollama'
				},
				text: payload.response.trim()
			};
		}
	});
};
export const ollamaTranscriber = (
	config: OllamaTranscriptionConfig = {}
): RAGMediaTranscriber => {
	const baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGMediaTranscriber({
		name: 'ollama',
		transcribe: async (input) => {
			const model = config.defaultModel ?? 'qwen2.5vl';
			const response = await fetchImpl(`${baseUrl}/api/generate`, {
				body: JSON.stringify({
					model,
					prompt: config.prompt ?? DEFAULT_TRANSCRIPTION_PROMPT,
					images: [Buffer.from(input.data).toString('base64')],
					stream: false
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(
					`Ollama transcription API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			const payload = await parseJsonResponse(response);
			if (!isRecord(payload) || typeof payload.response !== 'string') {
				throw new Error(
					'Ollama transcription response did not contain text.'
				);
			}

			return {
				metadata: {
					providerName: 'ollama',
					transcriptionModel: model
				},
				text: payload.response.trim()
			};
		}
	});
};
export const openaiCompatibleOCR = (
	config: OpenAICompatibleOCRConfig
): RAGOCRProvider =>
	openaiOCR({
		...config,
		baseUrl: config.baseUrl
	});
export const openaiCompatibleTranscriber = (
	config: OpenAICompatibleTranscriptionConfig
): RAGMediaTranscriber =>
	openaiTranscriber({
		...config,
		baseUrl: config.baseUrl
	});
export const openaiOCR = (config: OpenAIOCRConfig): RAGOCRProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGOCRProvider({
		name: 'openai',
		extractText: async (input) => {
			const model = config.defaultModel ?? 'gpt-4.1-mini';
			const response = await fetchImpl(`${baseUrl}/v1/responses`, {
				body: JSON.stringify({
					input: createOpenAIOCRInput(
						input,
						config.prompt ?? DEFAULT_OCR_PROMPT
					),
					model
				}),
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					'Content-Type': 'application/json'
				},
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(
					`OpenAI OCR API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			return {
				metadata: {
					ocrModel: model,
					providerName: 'openai'
				},
				text: readOpenAIResponsesText(await parseJsonResponse(response))
			};
		}
	});
};
export const openaiTranscriber = (
	config: OpenAITranscriptionConfig
): RAGMediaTranscriber => {
	const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGMediaTranscriber({
		name: 'openai',
		transcribe: async (input) => {
			const model = config.defaultModel ?? 'gpt-4o-mini-transcribe';
			const response = await fetchImpl(
				`${baseUrl}/v1/audio/transcriptions`,
				{
					body: createOpenAITranscriptionRequest(
						input,
						config,
						model
					),
					headers: {
						Authorization: `Bearer ${config.apiKey}`
					},
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(
					`OpenAI transcription API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			const payload = await parseJsonResponse(response);
			if (!isRecord(payload) || typeof payload.text !== 'string') {
				throw new Error(
					'OpenAI transcription response is missing text.'
				);
			}

			return {
				metadata: {
					providerName: 'openai',
					transcriptionModel: model
				},
				text: payload.text
			};
		}
	});
};
