import { describe, expect, it } from 'bun:test';
import {
	createHeuristicRAGQueryTransform,
	createHeuristicRAGReranker,
	createRAGCollection,
	ingestRAGDocuments
} from '../../../../src/ai';
import { createRAGEmbeddingProvider } from '../../../../src/ai/rag/embedding';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';

describe('createRAGCollection', () => {
	it('passes store status and capabilities through the collection', () => {
		const store = createInMemoryRAGStore({ dimensions: 16 });
		const collection = createRAGCollection({ store });

		expect(collection.getCapabilities?.()).toEqual({
			backend: 'in_memory',
			nativeVectorSearch: false,
			persistence: 'memory_only',
			serverSideFiltering: false,
			streamingIngestStatus: false
		});
		expect(collection.getStatus?.()).toEqual({
			backend: 'in_memory',
			dimensions: 16,
			vectorMode: 'in_memory'
		});
	});

	it('applies collection-level score filtering above the store', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'alpha') return [1, 0];
				if (text === 'beta') return [0, 1];
				if (text === 'query') return [1, 0];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({
			defaultTopK: 5,
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'a', text: 'alpha' },
				{ chunkId: 'b', text: 'beta' }
			]
		});

		const results = await collection.search({
			query: 'query',
			scoreThreshold: 0.9
		});

		expect(results.map((entry) => entry.chunkId)).toEqual(['a']);
	});

	it('applies reranking before the final topK slice', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text === 'search query' ? [1, 0] : [0, 1]
		});
		const callArgs: Array<{ model?: string; topK: number }> = [];
		const collection = createRAGCollection({
			defaultModel: 'rerank-model',
			store,
			rerank: ({ model, topK, results }) => {
				callArgs.push({ model, topK });

				return [...results].reverse();
			}
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'first', embedding: [1, 0], text: 'one' },
				{ chunkId: 'second', embedding: [0, 1], text: 'two' },
				{ chunkId: 'third', embedding: [-1, 0], text: 'three' }
			]
		});

		const results = await collection.search({
			query: 'search query',
			topK: 3
		});

		expect(callArgs).toEqual([{ model: 'rerank-model', topK: 3 }]);
		expect(results.map((entry) => entry.chunkId)).toEqual([
			'third',
			'second',
			'first'
		]);
	});

	it('retrieves a larger candidate pool before reranking', async () => {
		const seenQueryTopK: number[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		store.query = async (input) => {
			seenQueryTopK.push(input.topK);

			return originalQuery(input);
		};
		const collection = createRAGCollection({
			rerank: ({ results }) => [...results].reverse(),
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'one', embedding: [1, 0], text: 'one' },
				{ chunkId: 'two', embedding: [1, 0], text: 'two' },
				{ chunkId: 'three', embedding: [1, 0], text: 'three' },
				{ chunkId: 'four', embedding: [1, 0], text: 'four' }
			]
		});

		const results = await collection.search({
			query: 'one',
			topK: 2
		});

		expect(seenQueryTopK).toEqual([8]);
		expect(results).toHaveLength(2);
	});

	it('retrieves a larger candidate pool for hybrid and transformed retrieval', async () => {
		const seenVectorTopK: number[] = [];
		const seenLexicalTopK: number[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		const originalLexical = store.queryLexical?.bind(store);
		store.query = async (input) => {
			seenVectorTopK.push(input.topK);

			return originalQuery(input);
		};
		store.queryLexical = async (input) => {
			seenLexicalTopK.push(input.topK);

			return originalLexical?.(input) ?? Promise.resolve([]);
		};
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'one', embedding: [1, 0], text: 'one' },
				{ chunkId: 'two', embedding: [1, 0], text: 'two' },
				{ chunkId: 'three', embedding: [1, 0], text: 'three' },
				{ chunkId: 'four', embedding: [1, 0], text: 'four' }
			]
		});

		await collection.search({
			query: 'regional growth sheet',
			retrieval: 'hybrid',
			topK: 2
		});

		expect(seenVectorTopK.every((value) => value === 8)).toBe(true);
		expect(seenLexicalTopK.every((value) => value === 8)).toBe(true);
		expect(seenVectorTopK.length).toBeGreaterThan(0);
		expect(seenLexicalTopK.length).toBeGreaterThan(0);
	});

	it('uses reranker provider defaults when no search model is supplied', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const seenModels: string[] = [];
		const collection = createRAGCollection({
			rerank: {
				defaultModel: 'provider-rerank-model',
				providerName: 'demo-reranker',
				rerank: ({ model, results }) => {
					seenModels.push(model ?? 'missing');

					return results;
				}
			},
			store
		});

		await collection.ingest({
			chunks: [{ chunkId: 'alpha', embedding: [1, 0], text: 'alpha' }]
		});

		await collection.search({ query: 'alpha' });
		expect(seenModels).toEqual(['provider-rerank-model']);
	});

	it('ships a first-party heuristic reranker that can reorder lexical matches', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'A generic chunk with weaker lexical overlap.'
				},
				{
					chunkId: 'metadata',
					embedding: [1, 0],
					text: 'Metadata filters improve retrieval quality and metadata discipline.'
				}
			]
		});

		const results = await collection.search({
			query: 'metadata filters'
		});

		expect(results[0]?.chunkId).toBe('metadata');
	});

	it('scores metadata-aware matches in the heuristic reranker', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General workflow summary.'
				},
				{
					chunkId: 'sheet-hit',
					embedding: [1, 0],
					metadata: { sheetName: 'Regional Growth' },
					source: 'files/revenue-forecast.xlsx',
					text: 'Quarterly planning workbook.'
				}
			]
		});

		const results = await collection.search({
			query: 'regional growth sheet'
		});

		expect(results[0]?.chunkId).toBe('sheet-hit');
	});

	it('prefers archive entry paths over generic chunk text in lexical retrieval', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General recovery notes and generic archive guidance.'
				},
				{
					chunkId: 'archive-hit',
					embedding: [1, 0],
					metadata: {
						archivePath: 'runbooks/recovery.md',
						fileKind: 'archive'
					},
					source: 'archives/support-bundle.zip#runbooks/recovery.md',
					text: 'Escalation and packaging notes.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which archive entry explains recovery procedures?',
			retrieval: 'lexical',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('archive-hit');
	});

	it('prefers media transcript segments over generic workflow chunks in lexical retrieval', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'Generic workflow overview for the product demo.'
				},
				{
					chunkId: 'media-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						sourceNativeKind: 'media_segment',
						mediaSegmentStartMs: 0,
						mediaSegmentEndMs: 8000,
						mediaSegments: [
							{
								speaker: 'Alex',
								text: 'AbsoluteJS keeps retrieval and evaluation aligned across every frontend.'
							}
						]
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:08.000. Daily standup transcript.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which source says the workflow stays aligned across every frontend?',
			retrieval: 'lexical',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-hit');
	});

	it('prefers media timestamp evidence for timestamp-oriented lexical queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'Generic workflow overview for the product demo.'
				},
				{
					chunkId: 'media-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						sourceNativeKind: 'media_segment',
						mediaSegmentStartMs: 0,
						mediaSegmentEndMs: 8000,
						mediaSegments: [
							{
								endMs: 8000,
								speaker: 'Alex',
								startMs: 0,
								text: 'Retrieval, citations, evaluation, and ingest workflows stay aligned across every frontend.'
							}
						]
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:08.000 from daily-standup.mp3. Audio timestamp evidence.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which audio timestamp says retrieval, citations, evaluation, and ingest workflows stay aligned across every frontend?',
			retrieval: 'lexical',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-hit');
	});

	it('supports first-class hybrid retrieval with lexical fusion', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'regional growth sheet') return [1, 0];
				if (text.includes('generic')) return [1, 0];
				if (text.includes('Spreadsheet workbook')) return [0.2, 0.8];

				return [0, 1];
			}
		});
		const collection = createRAGCollection({
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					text: 'generic generic generic'
				},
				{
					chunkId: 'target:001',
					embedding: [0.2, 0.8],
					metadata: { sheetName: 'Regional Growth' },
					source: 'files/revenue-forecast.xlsx',
					text: 'Spreadsheet workbook.'
				}
			]
		});

		const vectorOnly = await collection.search({
			query: 'regional growth sheet',
			retrieval: 'vector',
			topK: 1
		});
		const hybrid = await collection.search({
			query: 'regional growth sheet',
			retrieval: 'hybrid',
			topK: 1
		});

		expect(vectorOnly[0]?.chunkId).toBe('generic:001');
		expect(hybrid[0]?.chunkId).toBe('target:001');
		expect(hybrid[0]?.metadata).toMatchObject({
			retrievalSignals: {
				lexical: true
			}
		});
	});

	it('ingests document inputs through the collection helper', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('glacier-fox-9182') ? [1, 0] : [0, 1]
		});
		const collection = createRAGCollection({ store });

		await ingestRAGDocuments(collection, {
			documents: [
				{
					id: 'launch-checklist',
					source: 'notes/launch-checklist.md',
					text: '# Launch Checklist\n\nAbsoluteJS demo verification phrase: glacier-fox-9182.'
				}
			]
		});

		const results = await collection.search({
			query: 'glacier-fox-9182'
		});

		expect(results[0]?.chunkId).toBe('launch-checklist:001');
		expect(results[0]?.source).toBe('notes/launch-checklist.md');
		expect(results[0]?.metadata).toMatchObject({
			documentId: 'launch-checklist',
			format: 'markdown'
		});
	});

	it('uses an explicit embedding provider for search', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [0, 1]
		});
		const collection = createRAGCollection({
			embedding: createRAGEmbeddingProvider({
				dimensions: 2,
				embed: async () => [1, 0]
			}),
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'alpha', embedding: [1, 0], text: 'alpha' },
				{ chunkId: 'beta', embedding: [0, 1], text: 'beta' }
			]
		});

		const results = await collection.search({
			query: 'which one is alpha?'
		});

		expect(results[0]?.chunkId).toBe('alpha');
	});

	it('uses an explicit embedding provider for ingest and respects collection model defaults', async () => {
		const seenModels: string[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [0, 1]
		});
		const collection = createRAGCollection({
			defaultModel: 'demo-embed-small',
			embedding: createRAGEmbeddingProvider({
				defaultModel: 'provider-default',
				dimensions: 2,
				embed: async ({ model, text }) => {
					seenModels.push(model ?? 'missing');

					return text.includes('glacier-fox-9182') ? [1, 0] : [0, 1];
				}
			}),
			store
		});

		await ingestRAGDocuments(collection, {
			documents: [
				{
					id: 'provider-proof',
					source: 'notes/provider-proof.md',
					text: '# Provider Proof\n\nglacier-fox-9182'
				}
			]
		});

		const results = await collection.search({
			model: 'query-override',
			query: 'glacier-fox-9182'
		});

		expect(results[0]?.chunkId).toBe('provider-proof:001');
		expect(seenModels).toContain('demo-embed-small');
		expect(seenModels).toContain('query-override');
	});

	it('rejects embedding vectors with mismatched dimensions', async () => {
		const collection = createRAGCollection({
			embedding: createRAGEmbeddingProvider({
				dimensions: 3,
				embed: async () => [1, 0]
			}),
			store: createInMemoryRAGStore({ dimensions: 3 })
		});

		await expect(
			collection.search({ query: 'bad dimensions' })
		).rejects.toThrow(
			'RAG query embedding dimension mismatch. Expected 3, received 2.'
		);
	});

	it('supports first-party query transforms before retrieval and reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('workbook') ? [0, 1] : [1, 0]
		});
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General workflow summary.'
				},
				{
					chunkId: 'sheet-hit',
					embedding: [0, 1],
					metadata: { sheetName: 'Regional Growth' },
					source: 'files/revenue-forecast.xlsx',
					text: 'Quarterly planning workbook.'
				}
			]
		});

		const results = await collection.search({
			query: 'regional growth sheet',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('sheet-hit');
	});

	it('treats transformed query variants as fallback candidates instead of co-equal primaries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('00:00') ? [0, 1] : [1, 0]
		});
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-hit',
					embedding: [0, 1],
					metadata: {
						mediaKind: 'audio',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'At timestamp 00:00 to 00:08, the daily standup audio says retrieval stays aligned across every frontend.'
				},
				{
					chunkId: 'generic-hit',
					embedding: [1, 0],
					source: 'playbook/ops.md',
					text: 'Retrieval and evaluation workflows stay aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which daily standup audio timestamp 00:00 to 00:08 says retrieval stays aligned across every frontend?',
			retrieval: 'hybrid',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-hit');
	});

	it('leans harder into sheet-named workbook queries and media timestamp queries', async () => {
		const queryTransform = createHeuristicRAGQueryTransform();
		const spreadsheet = await queryTransform.transform({
			query: 'Which workbook sheet is named Regional Growth?',
			topK: 4
		});
		const media = await queryTransform.transform({
			query: 'Which audio timestamp says the workflow stays aligned?',
			topK: 4
		});

		expect(
			(spreadsheet.variants ?? []).some(
				(variant) =>
					variant.includes('regional') &&
					variant.includes('growth') &&
					variant.includes('spreadsheet') &&
					variant.includes('worksheet') &&
					variant.includes('named')
			)
		).toBe(true);
		expect(
			(media.variants ?? []).some(
				(variant) =>
					variant.includes('audio') &&
					variant.includes('timestamp') &&
					variant.includes('media') &&
					variant.includes('transcript') &&
					variant.includes('segment')
			)
		).toBe(true);
	});

	it('preserves exact source-native queries as the primary query', async () => {
		const queryTransform = createHeuristicRAGQueryTransform();
		const spreadsheet = await queryTransform.transform({
			query: 'Which revenue forecast workbook sheet named Regional Growth tracks market expansion by territory?',
			topK: 4
		});
		const media = await queryTransform.transform({
			query: 'Which daily standup audio timestamp 00:00 to 00:08 says retrieval stays aligned across every frontend?',
			topK: 4
		});

		expect(spreadsheet.query).toBe(
			'Which revenue forecast workbook sheet named Regional Growth tracks market expansion by territory?'
		);
		expect(media.query).toBe(
			'Which daily standup audio timestamp 00:00 to 00:08 says retrieval stays aligned across every frontend?'
		);
		expect((spreadsheet.variants ?? []).length).toBeGreaterThan(0);
		expect(media.variants ?? []).toHaveLength(0);
	});
});
