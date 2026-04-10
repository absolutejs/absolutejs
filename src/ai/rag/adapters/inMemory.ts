import type { RAGQueryInput, RAGUpsertInput } from '../types';
import { createRAGVector, normalizeVector, querySimilarity } from './utils';
import type {
	RAGBackendCapabilities,
	RAGLexicalQueryInput,
	RAGVectorStore,
	RAGVectorStoreStatus
} from '../../../../types/ai';
import { RAG_VECTOR_DIMENSIONS_DEFAULT } from '../../../constants';
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
	const valuesMatch = (expected: unknown, actual: unknown) => {
		if (actual === expected) {
			return true;
		}

		if (
			typeof actual === 'object' &&
			actual !== null &&
			typeof expected === 'object' &&
			expected !== null
		) {
			return JSON.stringify(actual) === JSON.stringify(expected);
		}

		return false;
	};
	const matchesFilter = (
		chunk: InternalChunk,
		filter?: Record<string, unknown>
	) => {
		if (!filter) {
			return true;
		}

		return Object.entries(filter).every(([key, value]) => {
			if (key === 'chunkId') {
				return valuesMatch(value, chunk.chunkId);
			}

			if (key === 'source') {
				return valuesMatch(value, chunk.source);
			}

			if (key === 'title') {
				return valuesMatch(value, chunk.title);
			}

			if (!chunk.metadata) {
				return false;
			}

			return valuesMatch(value, chunk.metadata[key]);
		});
	};

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

	return {
		clear,
		embed,
		query,
		queryLexical,
		upsert,
		getCapabilities: () => capabilities,
		getStatus: () => createInMemoryStatus(dimensions)
	};
};

export { createRAGVector, normalizeVector, querySimilarity };
