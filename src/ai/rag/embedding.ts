import type {
	RAGEmbeddingFunction,
	RAGEmbeddingInput,
	RAGEmbeddingProvider,
	RAGEmbeddingProviderLike
} from '../../../types/ai';

export type CreateRAGEmbeddingProviderOptions = {
	embed: RAGEmbeddingFunction;
	dimensions?: number;
	defaultModel?: string;
};

const isEmbeddingProvider = (
	value: RAGEmbeddingProviderLike | undefined
): value is RAGEmbeddingProvider =>
	typeof value === 'object' &&
	value !== null &&
	typeof value.embed === 'function';

export const createRAGEmbeddingProvider = (
	options: CreateRAGEmbeddingProviderOptions
): RAGEmbeddingProvider => options;

export const resolveRAGEmbeddingProvider = (
	providerLike: RAGEmbeddingProviderLike | undefined,
	fallbackEmbed?: RAGEmbeddingFunction,
	defaultModel?: string
): RAGEmbeddingProvider => {
	const provider = isEmbeddingProvider(providerLike)
		? providerLike
		: typeof providerLike === 'function'
			? { embed: providerLike }
			: fallbackEmbed
				? { embed: fallbackEmbed }
				: null;

	if (!provider) {
		throw new Error(
			'No RAG embedding provider is configured. Pass collection.embedding or use a store that provides embed().'
		);
	}

	const resolvedDefaultModel = provider.defaultModel ?? defaultModel;

	return {
		defaultModel: resolvedDefaultModel,
		dimensions: provider.dimensions,
		embed: (input: RAGEmbeddingInput) =>
			provider.embed({
				...input,
				model: input.model ?? resolvedDefaultModel
			})
	};
};

export const validateRAGEmbeddingDimensions = (
	vector: number[],
	expectedDimensions: number | undefined,
	context: 'query' | 'chunk'
) => {
	if (
		typeof expectedDimensions === 'number' &&
		vector.length !== expectedDimensions
	) {
		throw new Error(
			`RAG ${context} embedding dimension mismatch. Expected ${expectedDimensions}, received ${vector.length}.`
		);
	}
};
