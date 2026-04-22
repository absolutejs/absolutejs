import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { ragChat } from '../../../../src/ai/rag/chat';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createRAGCollection } from '../../../../src/ai/rag/collection';
import type { RAGCollectionSearchParams } from '../../../../types/ai';
import {
	createRAGFileSearchTracePruneHistoryStore,
	createRAGFileSearchTraceStore
} from '../../../../src/ai/rag/quality';

const provider = () => ({
	async *stream() {}
});

describe('ragChat search route', () => {
	it('returns trace when includeTrace is true', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async (text) => {
					if (text.includes('alpha')) return [1, 0];

					return [0, 1];
				}
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'notes/alpha.md',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'notes/beta.md',
					text: 'beta retrieval workflow'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					includeTrace: true,
					query: 'alpha',
					topK: 1
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			results: Array<{ chunkId: string }>;
			trace?: {
				steps: Array<{ stage: string; label: string }>;
			};
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.results?.[0]).toEqual(
			expect.objectContaining({ chunkId: 'alpha-doc' })
		);
		expect(body.trace).toBeDefined();
		expect(body.trace?.steps?.length).toBeGreaterThan(0);
	});

	it('passes native planner controls through the search route', async () => {
		const seen: RAGCollectionSearchParams[] = [];
		const app = new Elysia().use(
			ragChat({
				collection: {
					async ingest() {},
					async search() {
						return [];
					},
					async searchWithTrace(input) {
						seen.push(input);
						return {
							results: [],
							trace: {
								candidateTopK: 4,
								lexicalTopK: 4,
								mode: 'vector',
								query: String(input.query),
								resultCounts: {
									final: 0,
									fused: 0,
									lexical: 0,
									reranked: 0,
									vector: 0
								},
								runLexical: false,
								runVector: true,
								steps: [],
								topK: input.topK ?? 4,
								transformedQuery: String(input.query),
								variantQueries: []
							}
						};
					},
					store: createInMemoryRAGStore({ dimensions: 1 })
				},
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					includeTrace: true,
					nativeCandidateLimit: 9,
					nativeFillPolicy: 'strict_topk',
					nativeMaxBackfills: 2,
					nativeMinResults: 1,
					nativeQueryProfile: 'recall',
					nativeQueryMultiplier: 7,
					query: 'alpha',
					topK: 1
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);

		expect(response.status).toBe(200);
		expect(seen[0]?.nativeCandidateLimit).toBe(9);
		expect(seen[0]?.nativeFillPolicy).toBe('strict_topk');
		expect(seen[0]?.nativeMaxBackfills).toBe(2);
		expect(seen[0]?.nativeMinResults).toBe(1);
		expect(seen[0]?.nativeQueryProfile).toBe('recall');
		expect(seen[0]?.nativeQueryMultiplier).toBe(7);
	});

	it('returns plain search results when includeTrace is not provided', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 1
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'just-one',
					text: 'single result',
					source: 'notes/single.md'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					query: 'single',
					topK: 1
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			results: Array<{ chunkId: string }>;
			trace?: unknown;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.results?.[0]).toEqual(
			expect.objectContaining({ chunkId: 'just-one' })
		);
		expect(body.trace).toBeUndefined();
	});

	it('enriches search results with source labels from retrieval metadata', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 1
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'pdf-region-hit',
					metadata: {
						ocrEngine: 'demo_pdf_ocr',
						ocrRegionConfidence: 0.91,
						pageNumber: 7,
						regionNumber: 2,
						sourceNativeKind: 'pdf_region'
					},
					source: 'notes/scan.pdf',
					text: 'region result'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					query: 'region',
					topK: 1
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			results: Array<{
				chunkId: string;
				labels?: {
					contextLabel?: string;
					locatorLabel?: string;
					provenanceLabel?: string;
				};
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.results?.[0]?.chunkId).toBe('pdf-region-hit');
		expect(body.results?.[0]?.labels).toMatchObject({
			contextLabel: 'OCR page 7 region 2',
			locatorLabel: 'Page 7 · Region 2',
			provenanceLabel: 'OCR demo_pdf_ocr · Confidence 0.91'
		});
	});

	it('enriches search results with section and adjacency structure', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 1
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'section-hit',
					metadata: {
						nextChunkId: 'section-hit:002',
						sectionChunkCount: 2,
						sectionChunkId:
							'docs-release-html:section:stable-blockers',
						sectionChunkIndex: 0,
						sectionDepth: 2,
						sectionKind: 'html_heading',
						sectionPath: [
							'Release Ops Overview',
							'Stable blockers'
						],
						sectionTitle: 'Stable blockers'
					},
					source: 'docs/release.html',
					text: 'stable blockers result'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					query: 'stable blockers',
					topK: 1
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			results: Array<{
				chunkId: string;
				structure?: {
					section?: {
						path?: string[];
						title?: string;
					};
					sequence?: {
						nextChunkId?: string;
						sectionChunkCount?: number;
						sectionChunkIndex?: number;
					};
				};
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.results?.[0]?.chunkId).toBe('section-hit');
		expect(body.results?.[0]?.structure).toMatchObject({
			section: {
				path: ['Release Ops Overview', 'Stable blockers'],
				title: 'Stable blockers'
			},
			sequence: {
				nextChunkId: 'section-hit:002',
				sectionChunkCount: 2,
				sectionChunkIndex: 0
			}
		});
	});

	it('rejects search payloads missing query', async () => {
		const app = new Elysia().use(
			ragChat({
				collection: createRAGCollection({
					store: createInMemoryRAGStore()
				}),
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({ topK: 1 }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as { ok: false; error: string };

		expect(response.status).toBe(400);
		expect(body.ok).toBe(false);
		expect(body.error).toBe('Expected payload shape: { query: string }');
	});

	it('rejects invalid retrieval payloads on search', async () => {
		const app = new Elysia().use(
			ragChat({
				collection: createRAGCollection({
					store: createInMemoryRAGStore()
				}),
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					query: 'anything',
					retrieval: 'vectorish'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as { ok: false; error: string };

		expect(response.status).toBe(400);
		expect(body.ok).toBe(false);
		expect(body.error).toBe('Expected payload shape: { query: string }');
	});

	it('persists trace history and exposes trace history routes', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async (text) => {
					if (text.includes('alpha')) return [1, 0];

					return [0, 1];
				}
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'notes/alpha.md',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'notes/beta.md',
					text: 'beta retrieval workflow'
				}
			]
		});

		const traceStore = createRAGFileSearchTraceStore(
			`/tmp/rag-chat-search-traces-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				searchTraceStore: traceStore
			})
		);

		const searchResponse = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					includeTrace: true,
					persistTrace: true,
					query: 'alpha',
					topK: 1,
					traceGroupKey: 'docs-search',
					traceTags: ['docs', 'alpha']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/traces?query=alpha&groupKey=docs-search&tag=docs&limit=5'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			history?: {
				query?: string;
				groupKey?: string;
				tag?: string;
				traces: Array<{
					query: string;
					groupKey?: string;
					tags?: string[];
				}>;
				latestTrace?: {
					query: string;
					groupKey?: string;
					tags?: string[];
				};
			};
		};

		expect(historyResponse.status).toBe(200);
		expect(historyBody.ok).toBe(true);
		expect(historyBody.history?.query).toBe('alpha');
		expect(historyBody.history?.groupKey).toBe('docs-search');
		expect(historyBody.history?.tag).toBe('docs');
		expect(historyBody.history?.latestTrace?.groupKey).toBe('docs-search');
		expect(historyBody.history?.latestTrace?.query).toBe('alpha');
		expect(historyBody.history?.latestTrace?.tags).toEqual([
			'alpha',
			'docs'
		]);
		expect(historyBody.history?.traces).toHaveLength(1);

		const groupHistoryResponse = await app.handle(
			new Request('http://localhost/rag/traces/groups?tag=docs&limit=5')
		);
		const groupHistoryBody = (await groupHistoryResponse.json()) as {
			ok: boolean;
			history?: {
				tag?: string;
				groups: Array<{
					groupKey: string;
					traceCount: number;
					latestTrace?: { query: string };
				}>;
			};
		};

		expect(groupHistoryResponse.status).toBe(200);
		expect(groupHistoryBody.ok).toBe(true);
		expect(groupHistoryBody.history?.tag).toBe('docs');
		expect(groupHistoryBody.history?.groups).toEqual([
			expect.objectContaining({
				groupKey: 'docs-search',
				traceCount: 1,
				latestTrace: expect.objectContaining({ query: 'alpha' })
			})
		]);
	});

	it('rejects trace history routes when no trace store is configured', async () => {
		const app = new Elysia().use(
			ragChat({
				collection: createRAGCollection({
					store: createInMemoryRAGStore()
				}),
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/traces?query=alpha')
		);
		const body = (await response.json()) as { ok: false; error: string };

		expect(response.status).toBe(400);
		expect(body.ok).toBe(false);
		expect(body.error).toBe('RAG search trace store is not configured');
	});

	it('applies configured trace retention automatically after persisted searches', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async (text) => {
					if (text.includes('alpha newer')) return [1, 0];
					if (text.includes('alpha')) return [0.9, 0.1];

					return [0, 1];
				}
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-old',
					metadata: { documentId: 'alpha-old' },
					source: 'notes/alpha-old.md',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'alpha-new',
					metadata: { documentId: 'alpha-new' },
					source: 'notes/alpha-new.md',
					text: 'alpha newer retrieval workflow'
				}
			]
		});

		const traceStore = createRAGFileSearchTraceStore(
			`/tmp/rag-chat-retention-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				searchTraceRetention: {
					maxRecordsPerGroup: 1
				},
				searchTraceStore: traceStore
			})
		);

		for (const query of ['alpha', 'alpha newer']) {
			const response = await app.handle(
				new Request('http://localhost/rag/search', {
					body: JSON.stringify({
						includeTrace: true,
						persistTrace: true,
						query,
						topK: 1,
						traceGroupKey: 'docs-search',
						traceTags: ['docs']
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				})
			);

			expect(response.status).toBe(200);
		}

		const historyResponse = await app.handle(
			new Request('http://localhost/rag/traces?groupKey=docs-search')
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			history?: {
				traces: Array<{ query: string }>;
				latestTrace?: { query: string };
			};
		};

		expect(historyResponse.status).toBe(200);
		expect(historyBody.ok).toBe(true);
		expect(historyBody.history?.traces).toHaveLength(1);
		expect(historyBody.history?.latestTrace?.query).toBe('alpha newer');
	});

	it('exposes trace stats and prune ops endpoints', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async (text) => {
					if (text.includes('alpha newer')) return [1, 0];
					if (text.includes('alpha')) return [0.9, 0.1];

					return [0, 1];
				}
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-old',
					metadata: { documentId: 'alpha-old' },
					source: 'notes/alpha-old.md',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'alpha-new',
					metadata: { documentId: 'alpha-new' },
					source: 'notes/alpha-new.md',
					text: 'alpha newer retrieval workflow'
				}
			]
		});

		const traceStore = createRAGFileSearchTraceStore(
			`/tmp/rag-chat-ops-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				searchTraceRetention: {
					maxRecordsPerGroup: 2
				},
				searchTraceStore: traceStore
			})
		);

		for (const query of ['alpha', 'alpha newer']) {
			const response = await app.handle(
				new Request('http://localhost/rag/search', {
					body: JSON.stringify({
						includeTrace: true,
						persistTrace: true,
						query,
						topK: 1,
						traceGroupKey: 'docs-search',
						traceTags: ['docs']
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				})
			);

			expect(response.status).toBe(200);
		}

		const statsResponse = await app.handle(
			new Request('http://localhost/rag/traces/stats?tag=docs')
		);
		const statsBody = (await statsResponse.json()) as {
			ok: boolean;
			stats?: {
				totalTraces: number;
				groupCount: number;
				queryCount: number;
			};
		};
		expect(statsResponse.status).toBe(200);
		expect(statsBody).toEqual(
			expect.objectContaining({
				ok: true,
				stats: expect.objectContaining({
					groupCount: 1,
					queryCount: 2,
					totalTraces: 2
				})
			})
		);

		const previewResponse = await app.handle(
			new Request('http://localhost/rag/traces/prune/preview', {
				body: JSON.stringify({
					maxRecordsPerGroup: 1,
					tag: 'docs'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const previewBody = (await previewResponse.json()) as {
			ok: boolean;
			preview?: {
				result: { keptCount: number; removedCount: number };
				statsBefore: { totalTraces: number };
				statsAfter: { totalTraces: number };
			};
		};
		expect(previewResponse.status).toBe(200);
		expect(previewBody.preview?.statsBefore.totalTraces).toBe(2);
		expect(previewBody.preview?.statsAfter.totalTraces).toBe(1);
		expect(previewBody.preview?.result).toEqual({
			keptCount: 1,
			removedCount: 1
		});

		const pruneResponse = await app.handle(
			new Request('http://localhost/rag/traces/prune', {
				body: JSON.stringify({
					maxRecordsPerGroup: 1,
					tag: 'docs'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const pruneBody = (await pruneResponse.json()) as {
			ok: boolean;
			result?: { keptCount: number; removedCount: number };
			stats?: { totalTraces: number };
		};
		expect(pruneResponse.status).toBe(200);
		expect(pruneBody.result).toEqual({
			keptCount: 1,
			removedCount: 1
		});
		expect(pruneBody.stats?.totalTraces).toBe(1);

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			ok: boolean;
			searchTraces?: {
				configured: boolean;
				retention?: { maxRecordsPerGroup?: number };
				stats?: { totalTraces: number };
			};
		};
		expect(opsResponse.status).toBe(200);
		expect(opsBody.searchTraces).toEqual(
			expect.objectContaining({
				configured: true,
				retention: {
					maxRecordsPerGroup: 2
				},
				stats: expect.objectContaining({
					totalTraces: 1
				})
			})
		);
	});

	it('reports scheduled trace retention runs in ops', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async (text) => {
					if (text.includes('alpha')) return [1, 0];

					return [0, 1];
				}
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'notes/alpha.md',
					text: 'alpha retrieval workflow'
				}
			]
		});

		const traceStore = createRAGFileSearchTraceStore(
			`/tmp/rag-chat-scheduled-prune-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				searchTraceRetention: {
					maxRecordsPerGroup: 1
				},
				searchTraceRetentionSchedule: {
					intervalMs: 25,
					runImmediately: false
				},
				searchTraceStore: traceStore
			})
		);

		const searchResponse = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					includeTrace: true,
					persistTrace: true,
					query: 'alpha',
					topK: 1,
					traceGroupKey: 'docs-search',
					traceTags: ['docs']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			ok: boolean;
			searchTraces?: {
				configured: boolean;
				running?: boolean;
				totalRuns?: number;
				lastFinishedAt?: number;
				nextScheduledAt?: number;
				lastResult?: { keptCount: number; removedCount: number };
				schedule?: { intervalMs: number; runImmediately?: boolean };
			};
		};

		expect(opsResponse.status).toBe(200);
		expect(opsBody.searchTraces).toEqual(
			expect.objectContaining({
				configured: true,
				lastResult: {
					keptCount: expect.any(Number),
					removedCount: expect.any(Number)
				},
				running: expect.any(Boolean),
				schedule: {
					intervalMs: 25,
					runImmediately: false
				},
				totalRuns: expect.any(Number)
			})
		);
		expect((opsBody.searchTraces?.totalRuns ?? 0) >= 1).toBe(true);
		expect(typeof opsBody.searchTraces?.lastFinishedAt).toBe('number');
		expect(typeof opsBody.searchTraces?.nextScheduledAt).toBe('number');
	});

	it('persists prune run history and exposes it through routes and ops', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async () => [1, 0]
			})
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'notes/alpha.md',
					text: 'alpha retrieval workflow'
				}
			]
		});

		const traceStore = createRAGFileSearchTraceStore(
			`/tmp/rag-chat-prune-history-traces-${Date.now()}.json`
		);
		const pruneHistoryStore = createRAGFileSearchTracePruneHistoryStore(
			`/tmp/rag-chat-prune-history-runs-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				searchTracePruneHistoryStore: pruneHistoryStore,
				searchTraceStore: traceStore
			})
		);

		const searchResponse = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					includeTrace: true,
					persistTrace: true,
					query: 'alpha',
					topK: 1,
					traceGroupKey: 'docs-search',
					traceTags: ['docs']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);

		const pruneResponse = await app.handle(
			new Request('http://localhost/rag/traces/prune', {
				body: JSON.stringify({
					maxRecordsPerGroup: 1,
					tag: 'docs'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(pruneResponse.status).toBe(200);

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/traces/prune/history?trigger=manual&limit=5'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			runs?: Array<{
				trigger: string;
				result?: { keptCount: number; removedCount: number };
			}>;
		};
		expect(historyResponse.status).toBe(200);
		expect(historyBody.runs?.[0]).toEqual(
			expect.objectContaining({
				trigger: 'manual',
				result: {
					keptCount: 1,
					removedCount: 0
				}
			})
		);

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			ok: boolean;
			searchTraces?: {
				recentRuns?: Array<{ trigger: string }>;
			};
		};
		expect(opsResponse.status).toBe(200);
		expect(opsBody.searchTraces?.recentRuns?.[0]).toEqual(
			expect.objectContaining({
				trigger: 'manual'
			})
		);
	});
});
