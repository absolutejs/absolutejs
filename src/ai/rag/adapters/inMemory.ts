import type { RAGQueryInput, RAGUpsertInput } from '../types';
import { createRAGVector, normalizeVector, querySimilarity } from './utils';
import type {
	RAGBackendCapabilities,
	RAGVectorCountInput,
	RAGVectorDeleteInput,
	RAGLexicalQueryInput,
	RAGVectorStore,
	RAGVectorStoreStatus
} from '../../../../types/ai';
import { RAG_VECTOR_DIMENSIONS_DEFAULT } from '../../../constants';
import { matchesMetadataFilterRecord } from './filtering';
import { rankRAGLexicalMatches } from '../lexical';

export type InMemoryRAGStoreOptions = {
	dimensions?: number;
	mockEmbedding?: (text: string) => Promise<number[]>;
};

const createInMemoryStatus = (dimensions: number): RAGVectorStoreStatus => ({
	backend: 'in_memory',
	dimensions,
	vectorMode: 'in_memory'
});

export const createInMemoryRAGStore = (
	options: InMemoryRAGStoreOptions = {}
): RAGVectorStore => {
	type InternalChunk = {
		chunkId: string;
		text: string;
		vector: number[];
		title?: string;
		source?: string;
		metadata?: Record<string, unknown>;
	};
	const matchesFilter = (
		chunk: InternalChunk,
		filter?: Record<string, unknown>
	) =>
		matchesMetadataFilterRecord(
			{
				chunkId: chunk.chunkId,
				metadata: chunk.metadata,
				source: chunk.source,
				title: chunk.title,
				...(chunk.metadata ?? {})
			},
			filter
		);

	const storeChunk = (chunk: InternalChunk) => {
		const existingIndex = chunks.findIndex(
			(item) => item.chunkId === chunk.chunkId
		);
		if (existingIndex < 0) {
			chunks.push(chunk);

			return;
		}

		chunks[existingIndex] = chunk;
	};

	const chunks: InternalChunk[] = [];
	const dimensions = options.dimensions ?? RAG_VECTOR_DIMENSIONS_DEFAULT;
	const capabilities: RAGBackendCapabilities = {
		backend: 'in_memory',
		nativeVectorSearch: false,
		persistence: 'memory_only',
		serverSideFiltering: false,
		streamingIngestStatus: false
	};

	const embed = async (input: {
		text: string;
		model?: string;
		signal?: AbortSignal;
	}) => {
		void input.model;
		void input.signal;

		if (options.mockEmbedding) {
			return options.mockEmbedding(input.text);
		}

		return normalizeVector(createRAGVector(input.text, dimensions));
	};

	const query = async (input: RAGQueryInput) => {
		const queryVector = normalizeVector(input.queryVector);
		const results: Array<{ chunk: InternalChunk; score: number }> = [];

		for (const chunk of chunks) {
			if (!matchesFilter(chunk, input.filter)) {
				continue;
			}

			const score = querySimilarity(
				queryVector,
				normalizeVector(chunk.vector)
			);
			if (!Number.isFinite(score)) continue;
			results.push({ chunk, score });
		}

		results.sort((first, second) => second.score - first.score);

		return results.slice(0, input.topK).map((entry) => ({
			chunkId: entry.chunk.chunkId,
			chunkText: entry.chunk.text,
			embedding: entry.chunk.vector,
			metadata: entry.chunk.metadata,
			score: entry.score,
			source: entry.chunk.source,
			title: entry.chunk.title
		}));
	};

	const queryLexical = async (input: RAGLexicalQueryInput) => {
		const filtered = chunks.filter((chunk) =>
			matchesFilter(chunk, input.filter)
		);
		const ranked = rankRAGLexicalMatches(input.query, filtered);

		return ranked.slice(0, input.topK).map(({ result, score }) => ({
			chunkId: result.chunkId,
			chunkText: result.text,
			metadata: result.metadata,
			score,
			source: result.source,
			title: result.title
		}));
	};

	const upsert = async (input: RAGUpsertInput) => {
		const next = await Promise.all(
			input.chunks.map(async (chunk) => ({
				...chunk,
				vector: chunk.embedding
					? normalizeVector(chunk.embedding)
					: normalizeVector(await embed({ text: chunk.text }))
			}))
		);

		for (const chunk of next) {
			storeChunk(chunk);
		}
	};

	const clear = () => {
		chunks.splice(0, chunks.length);
	};

	const count = async (input: RAGVectorCountInput = {}) => {
		const filter = input.filter;
		const chunkIds = input.chunkIds;
		const hasChunkFilter = Boolean(
			filter && Object.keys(filter).length > 0
		);
		const chunkIdSet = new Set(chunkIds ?? []);
		const hasChunkIds = chunkIdSet.size > 0;

		if (!hasChunkIds && !hasChunkFilter) {
			return chunks.length;
		}

		return chunks.filter((chunk) => {
			const matchesChunkIds = hasChunkIds
				? chunkIdSet.has(chunk.chunkId)
				: true;
			const matchesChunkFilter = hasChunkFilter
				? matchesFilter(chunk, filter)
				: true;
			return hasChunkIds && hasChunkFilter
				? matchesChunkIds || matchesChunkFilter
				: hasChunkIds
					? matchesChunkIds
					: matchesChunkFilter;
		}).length;
	};

	const remove = async (input: RAGVectorDeleteInput = {}) => {
		const filter = input.filter;
		const chunkIds = input.chunkIds;
		const hasChunkFilter = Boolean(
			filter && Object.keys(filter).length > 0
		);
		const chunkIdSet = new Set(chunkIds ?? []);
		const hasChunkIds = chunkIdSet.size > 0;

		if (!hasChunkIds && !hasChunkFilter) {
			return 0;
		}

		const removeByFilter = (chunk: InternalChunk) => {
			const matchesChunkIds = hasChunkIds
				? chunkIdSet.has(chunk.chunkId)
				: false;
			const matchesChunkFilter = hasChunkFilter
				? matchesFilter(chunk, filter)
				: false;

			return hasChunkIds && hasChunkFilter
				? matchesChunkIds || matchesChunkFilter
				: hasChunkIds
					? matchesChunkIds
					: matchesChunkFilter;
		};

		let removed = 0;
		for (let index = chunks.length - 1; index >= 0; index -= 1) {
			if (!removeByFilter(chunks[index]!)) {
				continue;
			}

			chunks.splice(index, 1);
			removed += 1;
		}

		return removed;
	};

	return {
		clear,
		embed,
		query,
		queryLexical,
		count,
		delete: remove,
		upsert,
		getCapabilities: () => capabilities,
		getStatus: () => createInMemoryStatus(dimensions)
	};
};

export { createRAGVector, normalizeVector, querySimilarity };
