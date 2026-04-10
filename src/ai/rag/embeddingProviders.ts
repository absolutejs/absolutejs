import type { RAGEmbeddingProvider } from '../../../types/ai';
import { createRAGEmbeddingProvider } from './embedding';

type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit | BunFetchRequestInit
) => Promise<Response>;

export type OpenAIEmbeddingsConfig = {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	dimensions?: number;
	fetch?: FetchLike;
};

export type OpenAICompatibleEmbeddingsConfig = OpenAIEmbeddingsConfig & {
	baseUrl: string;
};

export type GeminiEmbeddingsConfig = {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	dimensions?: number;
	fetch?: FetchLike;
};

export type OllamaEmbeddingsConfig = {
	baseUrl?: string;
	defaultModel?: string;
	fetch?: FetchLike;
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isNumberArray = (value: unknown): value is number[] =>
	Array.isArray(value) &&
	value.every((item) => typeof item === 'number' && Number.isFinite(item));

const parseJsonResponse = async (response: Response) => {
	const text = await response.text();

	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`Embedding provider returned invalid JSON: ${text}`);
	}
};

const toErrorMessage = async (response: Response) => {
	const text = await response.text();

	return text || `Request failed with status ${response.status}`;
};

const readOpenAIEmbedding = (payload: unknown) => {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		throw new Error('OpenAI embeddings response is missing data.');
	}

	const [first] = payload.data;
	if (!isRecord(first) || !isNumberArray(first.embedding)) {
		throw new Error(
			'OpenAI embeddings response is missing embedding values.'
		);
	}

	return first.embedding;
};

const readGeminiEmbedding = (payload: unknown) => {
	if (
		!isRecord(payload) ||
		!isRecord(payload.embedding) ||
		!isNumberArray(payload.embedding.values)
	) {
		throw new Error(
			'Gemini embeddings response is missing embedding values.'
		);
	}

	return payload.embedding.values;
};

const readOllamaEmbedding = (payload: unknown) => {
	if (!isRecord(payload) || !isNumberArray(payload.embedding)) {
		throw new Error(
			'Ollama embeddings response is missing embedding values.'
		);
	}

	return payload.embedding;
};

export const alibabaEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode'
	});
export const deepseekEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://api.deepseek.com'
	});
export const geminiEmbeddings = (
	config: GeminiEmbeddingsConfig
): RAGEmbeddingProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_GEMINI_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGEmbeddingProvider({
		defaultModel: config.defaultModel,
		dimensions: config.dimensions,
		embed: async ({ model, signal, text }) => {
			const resolvedModel = model ?? config.defaultModel;
			if (!resolvedModel) {
				throw new Error(
					'Gemini embeddings require a model. Pass embeddingModel or configure defaultModel.'
				);
			}

			const body: Record<string, unknown> = {
				content: {
					parts: [{ text }]
				}
			};

			if (typeof config.dimensions === 'number') {
				body.outputDimensionality = config.dimensions;
			}

			const response = await fetchImpl(
				`${baseUrl}/v1beta/models/${resolvedModel}:embedContent?key=${config.apiKey}`,
				{
					body: JSON.stringify(body),
					headers: {
						'Content-Type': 'application/json'
					},
					method: 'POST',
					signal
				}
			);

			if (!response.ok) {
				throw new Error(
					`Gemini embeddings API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			return readGeminiEmbedding(await parseJsonResponse(response));
		}
	});
};
export const googleEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
	});
export const metaEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://api.llama.com/compat/v1'
	});
export const mistralaiEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://api.mistral.ai'
	});
export const moonshotEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://api.moonshot.ai'
	});
export const ollamaEmbeddings = (
	config: OllamaEmbeddingsConfig = {}
): RAGEmbeddingProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGEmbeddingProvider({
		defaultModel: config.defaultModel,
		embed: async ({ model, signal, text }) => {
			const resolvedModel = model ?? config.defaultModel;
			if (!resolvedModel) {
				throw new Error(
					'Ollama embeddings require a model. Pass embeddingModel or configure defaultModel.'
				);
			}

			const response = await fetchImpl(`${baseUrl}/api/embeddings`, {
				body: JSON.stringify({
					model: resolvedModel,
					prompt: text
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST',
				signal
			});

			if (!response.ok) {
				throw new Error(
					`Ollama embeddings API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			return readOllamaEmbedding(await parseJsonResponse(response));
		}
	});
};
export const openaiCompatibleEmbeddings = (
	config: OpenAICompatibleEmbeddingsConfig
): RAGEmbeddingProvider =>
	openaiEmbeddings({
		...config,
		baseUrl: config.baseUrl
	});
export const openaiEmbeddings = (
	config: OpenAIEmbeddingsConfig
): RAGEmbeddingProvider => {
	const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
	const fetchImpl = config.fetch ?? fetch;

	return createRAGEmbeddingProvider({
		defaultModel: config.defaultModel,
		dimensions: config.dimensions,
		embed: async ({ model, signal, text }) => {
			const resolvedModel = model ?? config.defaultModel;
			if (!resolvedModel) {
				throw new Error(
					'OpenAI embeddings require a model. Pass embeddingModel or configure defaultModel.'
				);
			}

			const body: Record<string, unknown> = {
				encoding_format: 'float',
				input: text,
				model: resolvedModel
			};

			if (typeof config.dimensions === 'number') {
				body.dimensions = config.dimensions;
			}

			const response = await fetchImpl(`${baseUrl}/v1/embeddings`, {
				body: JSON.stringify(body),
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					'Content-Type': 'application/json'
				},
				method: 'POST',
				signal
			});

			if (!response.ok) {
				throw new Error(
					`OpenAI embeddings API error ${response.status}: ${await toErrorMessage(response)}`
				);
			}

			return readOpenAIEmbedding(await parseJsonResponse(response));
		}
	});
};
export const xaiEmbeddings = (config: {
	apiKey: string;
}): RAGEmbeddingProvider =>
	openaiCompatibleEmbeddings({
		apiKey: config.apiKey,
		baseUrl: 'https://api.x.ai'
	});
