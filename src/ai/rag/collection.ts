import type {
	RAGCollection,
	RAGHybridRetrievalMode,
	RAGCollectionSearchParams,
	RAGRerankerProviderLike,
	RAGDocumentIngestInput,
	RAGEmbeddingInput,
	RAGEmbeddingProviderLike,
	RAGQueryResult,
	RAGQueryTransformProviderLike,
	RAGUpsertInput,
	RAGVectorStore
} from '../../../types/ai';
import { fuseRAGQueryResults, resolveRAGHybridSearchOptions } from './lexical';
import { applyRAGQueryTransform } from './queryTransforms';
import { applyRAGReranking } from './reranking';
import {
	resolveRAGEmbeddingProvider,
	validateRAGEmbeddingDimensions
} from './embedding';
import { buildRAGUpsertInputFromDocuments } from './ingestion';

const DEFAULT_TOP_K = 6;

export type CreateRAGCollectionOptions = {
	store: RAGVectorStore;
	embedding?: RAGEmbeddingProviderLike;
	defaultTopK?: number;
	defaultCandidateMultiplier?: number;
	defaultModel?: string;
	queryTransform?: RAGQueryTransformProviderLike;
	rerank?: RAGRerankerProviderLike;
};

const VARIANT_RESULT_WEIGHT = 0.92;

const mergeQueryResults = (results: RAGQueryResult[]) => {
	const merged = new Map<string, RAGQueryResult>();

	for (const result of results) {
		const existing = merged.get(result.chunkId);
		if (!existing || result.score > existing.score) {
			merged.set(result.chunkId, result);
		}
	}

	return [...merged.values()].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.chunkId.localeCompare(right.chunkId);
	});
};

const weightQueryResults = (results: RAGQueryResult[], queryIndex: number) => {
	if (queryIndex === 0) {
		return results;
	}

	const weight = Math.pow(VARIANT_RESULT_WEIGHT, queryIndex);
	return results.map((result) => ({
		...result,
		score: result.score * weight
	}));
};

const shouldRunVectorRetrieval = (mode: RAGHybridRetrievalMode) =>
	mode === 'vector' || mode === 'hybrid';

const shouldRunLexicalRetrieval = (
	mode: RAGHybridRetrievalMode,
	store: RAGVectorStore
) => mode === 'lexical' || (mode === 'hybrid' && Boolean(store.queryLexical));

export const createRAGCollection = (
	options: CreateRAGCollectionOptions
): RAGCollection => {
	const defaultTopK = options.defaultTopK ?? DEFAULT_TOP_K;
	const defaultCandidateMultiplier = Math.max(
		1,
		Math.floor(options.defaultCandidateMultiplier ?? 4)
	);
	const { getCapabilities } = options.store;
	const { getStatus } = options.store;
	const embeddingProvider = resolveRAGEmbeddingProvider(
		options.embedding,
		options.store.embed,
		options.defaultModel
	);
	const getExpectedDimensions = () =>
		embeddingProvider.dimensions ?? getStatus?.()?.dimensions;

	const embed = async (
		input: RAGEmbeddingInput,
		context: 'query' | 'chunk'
	) => {
		const vector = await embeddingProvider.embed(input);
		validateRAGEmbeddingDimensions(
			vector,
			getExpectedDimensions(),
			context
		);

		return vector;
	};

	const search = async (input: RAGCollectionSearchParams) => {
		const model = input.model ?? options.defaultModel;
		const topK = input.topK ?? defaultTopK;
		const hasReranker = Boolean(input.rerank ?? options.rerank);
		const retrieval = resolveRAGHybridSearchOptions(input.retrieval);
		const hasQueryTransform = Boolean(
			input.queryTransform ?? options.queryTransform
		);
		const shouldExpandCandidates =
			hasReranker || hasQueryTransform || retrieval.mode !== 'vector';
		const candidateTopK = Math.max(
			topK,
			Math.floor(
				input.candidateTopK ??
					(shouldExpandCandidates
						? topK * defaultCandidateMultiplier
						: topK)
			)
		);
		const transformed = await applyRAGQueryTransform({
			input: {
				candidateTopK,
				filter: input.filter,
				model,
				query: input.query,
				scoreThreshold: input.scoreThreshold,
				topK
			},
			queryTransform: input.queryTransform ?? options.queryTransform
		});
		const searchQueries = Array.from(
			new Set([transformed.query, ...(transformed.variants ?? [])])
		).filter(Boolean);
		const runVector = shouldRunVectorRetrieval(retrieval.mode);
		const runLexical = shouldRunLexicalRetrieval(
			retrieval.mode,
			options.store
		);
		const lexicalTopK = Math.max(
			topK,
			Math.floor(retrieval.lexicalTopK ?? candidateTopK)
		);
		const queryVector = runVector
			? await embed(
					{
						model,
						signal: input.signal,
						text: input.query
					},
					'query'
				)
			: [];
		const resultGroups = await Promise.all(
			searchQueries.map(async (query, queryIndex) => {
				const [vectorResults, lexicalResults] = await Promise.all([
					runVector
						? embed(
								{
									model,
									signal: input.signal,
									text: query
								},
								'query'
							).then((nextQueryVector) =>
								options.store.query({
									filter: input.filter,
									queryVector: nextQueryVector,
									topK: candidateTopK
								})
							)
						: Promise.resolve([]),
					runLexical
						? (options.store.queryLexical?.({
								filter: input.filter,
								query,
								topK: lexicalTopK
							}) ?? Promise.resolve([]))
						: Promise.resolve([])
				]);

				return {
					lexicalResults: weightQueryResults(
						lexicalResults,
						queryIndex
					),
					vectorResults: weightQueryResults(vectorResults, queryIndex)
				};
			})
		);
		const vectorResults = mergeQueryResults(
			resultGroups.flatMap((group) => group.vectorResults)
		);
		const lexicalResults = mergeQueryResults(
			resultGroups.flatMap((group) => group.lexicalResults)
		);
		const results =
			retrieval.mode === 'lexical'
				? lexicalResults
				: retrieval.mode === 'vector'
					? vectorResults
					: fuseRAGQueryResults({
							fusion: retrieval.fusion,
							fusionConstant: retrieval.fusionConstant,
							lexical: lexicalResults,
							lexicalWeight: retrieval.lexicalWeight,
							vector: vectorResults,
							vectorWeight: retrieval.vectorWeight
						});
		const rerankInput = {
			candidateTopK,
			filter: input.filter,
			model,
			query: transformed.query,
			queryVector,
			results,
			scoreThreshold: input.scoreThreshold,
			topK
		};
		const reranked = await applyRAGReranking({
			input: rerankInput,
			reranker: input.rerank ?? options.rerank
		});
		const limited = reranked.slice(0, topK);

		if (typeof input.scoreThreshold !== 'number') {
			return limited;
		}

		const { scoreThreshold } = input;

		return limited.filter((entry) => entry.score >= scoreThreshold);
	};

	const ingest = async (input: RAGUpsertInput) => {
		const chunks = await Promise.all(
			input.chunks.map(async (chunk) => {
				if (chunk.embedding) {
					validateRAGEmbeddingDimensions(
						chunk.embedding,
						getExpectedDimensions(),
						'chunk'
					);

					return chunk;
				}

				return {
					...chunk,
					embedding: await embed(
						{
							model: options.defaultModel,
							text: chunk.text
						},
						'chunk'
					)
				};
			})
		);

		await options.store.upsert({ chunks });
	};

	return {
		clear:
			typeof options.store.clear === 'function'
				? () => options.store.clear?.()
				: undefined,
		getCapabilities:
			typeof getCapabilities === 'function'
				? () => getCapabilities()
				: undefined,
		getStatus:
			typeof getStatus === 'function' ? () => getStatus() : undefined,
		search,
		store: options.store,
		ingest
	};
};
export const ingestDocuments = async (
	collection: RAGCollection,
	input: RAGUpsertInput
) => collection.ingest(input);
export const ingestRAGDocuments = async (
	collection: RAGCollection,
	input: RAGDocumentIngestInput
) => collection.ingest(buildRAGUpsertInputFromDocuments(input));
export const searchDocuments = async (
	collection: RAGCollection,
	input: RAGCollectionSearchParams
) => collection.search(input);
