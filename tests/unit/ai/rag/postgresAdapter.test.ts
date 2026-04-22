import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPostgresRAGStore } from '../../../../src/ai/rag/adapters/postgres';

type MockPostgresCall = {
	sql: string;
	params: unknown[];
};

type MockPostgresFilterDebug = {
	filter?: Record<string, unknown>;
	pushdownFilter?: Record<string, unknown>;
	countSql?: string;
	countParams?: unknown[];
	querySql?: string;
	queryParams?: unknown[];
	countResultRaw?: unknown;
	queryRowCount?: number;
};

const getPostgresFilterDebug = (
	store: ReturnType<typeof createPostgresRAGStore>
) => {
	return (
		store.getStatus?.()?.native as
			| { lastFilterDebug?: MockPostgresFilterDebug }
			| undefined
	)?.lastFilterDebug;
};

const createMockPostgresSql = ({
	count = 0,
	rows = []
}: {
	count?: number;
	rows?: Array<{
		chunk_id: string;
		text: string;
		embedding: string;
		source: string | null;
		title: string | null;
		metadata: string | null;
		distance?: string;
	}>;
} = {}) => {
	const calls: MockPostgresCall[] = [];
	const sql = {
		calls,
		unsafe: (query: string, ...params: unknown[]) => {
			const flatParams = (() => {
				if (params.length === 1 && Array.isArray(params[0])) {
					return params[0] as unknown[];
				}

				return params;
			})();

			calls.push({ sql: query, params: flatParams });
			if (query.includes('count(*)::int as count')) {
				return [{ count }];
			}

			if (query.includes('pg_relation_size($1::regclass)')) {
				return [
					{
						estimated_row_count: count,
						index_bytes: 16384,
						index_present: flatParams[3] !== '',
						table_bytes: 8192,
						total_bytes: 24576
					}
				];
			}

			if (query.includes('embedding::text as embedding')) {
				return rows;
			}

			if (
				query.includes('select chunk_id from') &&
				query.includes('where chunk_id in')
			) {
				return rows.filter(({ chunk_id }) =>
					flatParams.includes(chunk_id)
				);
			}

			if (
				query.includes(
					'select chunk_id, text, title, source, metadata from'
				)
			) {
				return rows;
			}

			return [];
		},
		close: async () => {
			return undefined;
		}
	};

	return { calls, sql };
};

const POSTGRES_URL =
	process.env.RAG_POSTGRES_TEST_URL ??
	process.env.RAG_POSTGRES_URL ??
	process.env.DATABASE_URL ??
	'postgres://postgres:postgres@localhost:55433/absolute_rag_demo';

const canConnectToPostgres = async () => {
	try {
		const db = new Bun.SQL(POSTGRES_URL);
		await db`select 1 as ok`;
		await db.close?.();
		return true;
	} catch {
		return false;
	}
};

const postgresAvailable = await canConnectToPostgres();
const itIfPostgres = postgresAvailable ? it : it.skip;
const openStores: Array<ReturnType<typeof createPostgresRAGStore>> = [];
const trackStore = (store: ReturnType<typeof createPostgresRAGStore>) => {
	openStores.push(store);
	return store;
};

afterEach(async () => {
	while (openStores.length > 0) {
		await openStores.pop()?.close?.();
	}
});

describe('createPostgresRAGStore (mocked SQL)', () => {
	it('keeps supported metadata clauses while dropping unsupported values', async () => {
		const mock = createMockPostgresSql({
			count: 4,
			rows: [
				{
					chunk_id: 'chunk-a',
					text: 'release notes',
					embedding: '[1, 0]',
					source: 'api',
					title: 'Release notes',
					metadata: JSON.stringify({ tenant: ['docs'] }),
					distance: '0.1'
				}
			]
		});

		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				sql: mock.sql as any,
				tableName: `rag_mock_${randomUUID().replaceAll('-', '_')}`
			})
		);

		const hits = await store.query({
			filter: {
				source: 'api',
				tenant: { $contains: { nested: 'value' } }
			},
			queryVector: [1, 0],
			topK: 2
		});

		expect(hits).toEqual([]);
		const debug = getPostgresFilterDebug(store);
		expect(debug?.pushdownFilter).toMatchObject({
			source: 'api'
		});
		expect(store.getStatus?.()?.native?.lastQueryPlan).toMatchObject({
			pushdownClauseCount: 1,
			pushdownCoverageRatio: 0.5,
			totalFilterClauseCount: 2,
			jsRemainderClauseCount: 1,
			pushdownMode: 'partial',
			queryMode: 'native_pgvector'
		});
		expect(debug?.querySql).toContain('source');
		expect(debug?.querySql).not.toContain('tenant');
	});

	it('reports no pushdown when filter cannot be SQL planned', async () => {
		const mock = createMockPostgresSql({
			count: 2,
			rows: []
		});

		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				sql: mock.sql as any,
				tableName: `rag_mock_${randomUUID().replaceAll('-', '_')}`
			})
		);

		const hits = await store.query({
			filter: {
				tenant: { $contains: { nested: 'value' } }
			},
			queryVector: [1, 0],
			topK: 2
		});

		expect(hits).toEqual([]);
		const debug = getPostgresFilterDebug(store);
		expect(debug?.pushdownFilter).toBe(undefined);
		expect(store.getStatus?.()?.native?.lastQueryPlan).toMatchObject({
			pushdownClauseCount: 0,
			pushdownCoverageRatio: 0,
			pushdownMode: 'none',
			totalFilterClauseCount: 1,
			jsRemainderClauseCount: 1
		});
		expect(debug?.countSql).not.toContain('where');
	});

	it('counts chunks with filter-only and id-based criteria', async () => {
		const mock = createMockPostgresSql({
			count: 3,
			rows: [
				{
					chunk_id: 'a',
					text: 'release alpha',
					embedding: '[1, 0]',
					source: 'api',
					title: 'Release',
					metadata: JSON.stringify({ tenant: 'acme' })
				},
				{
					chunk_id: 'b',
					text: 'release beta',
					embedding: '[0, 1]',
					source: 'api',
					title: 'Release',
					metadata: JSON.stringify({ tenant: 'beta' })
				}
			]
		});

		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				sql: mock.sql as any,
				tableName: `rag_mock_${randomUUID().replaceAll('-', '_')}`
			})
		);

		expect(await store.count?.()).toBe(3);
		expect(await store.count?.({ filter: { tenant: 'acme' } })).toBe(1);
		expect(await store.count?.({ chunkIds: ['a', 'missing'] })).toBe(1);
		expect(
			await store.count?.({ filter: { tenant: 'acme' }, chunkIds: ['b'] })
		).toBe(2);
	});

	it('deletes chunks by filter-id union semantics', async () => {
		const mock = createMockPostgresSql({
			count: 2,
			rows: [
				{
					chunk_id: 'a',
					text: 'release alpha',
					embedding: '[1, 0]',
					source: 'api',
					title: 'Release',
					metadata: JSON.stringify({ tenant: 'acme' })
				},
				{
					chunk_id: 'b',
					text: 'release beta',
					embedding: '[0, 1]',
					source: 'api',
					title: 'Release',
					metadata: JSON.stringify({ tenant: 'beta' })
				}
			]
		});

		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				sql: mock.sql as any,
				tableName: `rag_mock_${randomUUID().replaceAll('-', '_')}`
			})
		);

		expect(await store.delete?.()).toBe(0);
		expect(await store.delete?.({ chunkIds: ['a', 'missing'] })).toBe(1);
		expect(await store.delete?.({ filter: { tenant: 'beta' } })).toBe(1);
		expect(
			await store.delete?.({
				filter: { tenant: 'acme' },
				chunkIds: ['b']
			})
		).toBe(2);
	});

	it('creates configured pgvector indexes during initialization', async () => {
		const mock = createMockPostgresSql({ count: 0 });
		const tableName = `rag_mock_${randomUUID().replaceAll('-', '_')}`;
		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				hnswEfConstruction: 96,
				hnswM: 32,
				indexType: 'hnsw',
				sql: mock.sql as any,
				tableName
			})
		);

		await store.count?.();

		const indexCall = mock.calls.find((call) =>
			call.sql.includes('using hnsw')
		);
		expect(indexCall?.sql).toContain(
			`create index if not exists public_${tableName}_embedding_hnsw_idx`
		);
		expect(indexCall?.sql).toContain(
			'(embedding vector_cosine_ops) with (m = 32, ef_construction = 96)'
		);
		expect(store.getStatus?.()).toMatchObject({
			native: {
				estimatedRowCount: 0,
				indexBytes: 16384,
				indexName: `public_${tableName}_embedding_hnsw_idx`,
				indexPresent: true,
				indexType: 'hnsw'
			}
		});
	});

	it('creates ivfflat indexes with configurable list counts', async () => {
		const mock = createMockPostgresSql({ count: 0 });
		const tableName = `rag_mock_${randomUUID().replaceAll('-', '_')}`;
		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				distanceMetric: 'l2',
				indexLists: 48,
				indexType: 'ivfflat',
				sql: mock.sql as any,
				tableName
			})
		);

		await store.count?.();

		const indexCall = mock.calls.find((call) =>
			call.sql.includes('using ivfflat')
		);
		expect(indexCall?.sql).toContain(
			`create index if not exists public_${tableName}_embedding_ivfflat_idx`
		);
		expect(indexCall?.sql).toContain(
			'(embedding vector_l2_ops) with (lists = 48)'
		);
		expect(store.getStatus?.()).toMatchObject({
			native: {
				indexName: `public_${tableName}_embedding_ivfflat_idx`,
				indexPresent: true,
				indexType: 'ivfflat',
				tableBytes: 8192,
				totalBytes: 24576
			}
		});
	});

	it('runs analyze maintenance and records diagnostics', async () => {
		const mock = createMockPostgresSql({ count: 3 });
		const tableName = `rag_mock_${randomUUID().replaceAll('-', '_')}`;
		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				sql: mock.sql as any,
				tableName
			})
		);

		await store.analyze?.();

		expect(
			mock.calls.some(
				(call) => call.sql === `analyze public.${tableName}`
			)
		).toBe(true);
		expect(store.getStatus?.()).toMatchObject({
			native: {
				indexName: `public_${tableName}_embedding_hnsw_idx`,
				lastAnalyzeAt: expect.any(Number),
				lastAnalyzeError: undefined
			}
		});
	});

	it('rebuilds configured native indexes and refreshes health state', async () => {
		const mock = createMockPostgresSql({ count: 5 });
		const tableName = `rag_mock_${randomUUID().replaceAll('-', '_')}`;
		const store = trackStore(
			createPostgresRAGStore({
				dimensions: 2,
				hnswEfConstruction: 80,
				hnswM: 24,
				indexType: 'hnsw',
				sql: mock.sql as any,
				tableName
			})
		);

		await store.rebuildNativeIndex?.();

		expect(
			mock.calls.some(
				(call) =>
					call.sql ===
					`drop index if exists public_${tableName}_embedding_hnsw_idx`
			)
		).toBe(true);
		expect(
			mock.calls.some(
				(call) =>
					call.sql.includes(
						`create index public_${tableName}_embedding_hnsw_idx`
					) && call.sql.includes('using hnsw')
			)
		).toBe(true);
		expect(store.getStatus?.()).toMatchObject({
			native: {
				indexName: `public_${tableName}_embedding_hnsw_idx`,
				indexPresent: true,
				lastAnalyzeAt: expect.any(Number),
				lastReindexAt: expect.any(Number),
				lastReindexError: undefined
			}
		});
	});
});

describe('createPostgresRAGStore', () => {
	itIfPostgres(
		'retrieves nearest chunks with metadata filter support',
		async () => {
			const store = trackStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === 'alpha'
							? [1, 0]
							: text === 'beta'
								? [0, 1]
								: [0.5, 0.5],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);

			await store.upsert({
				chunks: [
					{
						chunkId: 'a',
						metadata: {
							labels: ['release'],
							scope: { region: 'us' },
							tenant: 'acme'
						},
						source: 'acme-feed',
						text: 'alpha',
						title: 'Alpha'
					},
					{
						chunkId: 'b',
						metadata: {
							labels: ['backlog'],
							scope: { region: 'us' },
							tenant: 'acme'
						},
						source: 'acme-feed',
						text: 'beta',
						title: 'Beta'
					},
					{
						chunkId: 'c',
						metadata: {
							labels: ['release'],
							scope: { region: 'eu' },
							tenant: 'beta'
						},
						source: 'beta-feed',
						text: 'alpha beta',
						title: 'Gamma'
					}
				]
			});

			const hits = await store.query({
				filter: {
					'scope.region': 'us',
					labels: { $contains: 'release' }
				},
				queryVector: [1, 0],
				topK: 2
			});

			expect(hits).toMatchObject([{ chunkId: 'a', title: 'Alpha' }]);
			expect(store.getStatus?.()).toMatchObject({
				backend: 'postgres',
				native: {
					active: true,
					available: true,
					lastFilterDebug: {
						countParams: ['us', 'release'],
						countResultRaw: {
							count: 1
						},
						countSql: expect.stringContaining(
							"metadata #> '{labels}'"
						),
						pushdownFilter: {
							labels: { $contains: 'release' },
							'scope.region': 'us'
						},
						queryParams: expect.arrayContaining(['us', 'release']),
						queryRowCount: 1,
						querySql: expect.stringContaining(
							"metadata #> '{labels}'"
						)
					},
					lastQueryPlan: {
						backfillCount: 0,
						candidateBudgetExhausted: true,
						candidateCoverage: 'under_target',
						filteredCandidateCount: 1,
						jsRemainderClauseCount: 0,
						jsRemainderRatio: 0,
						pushdownApplied: true,
						pushdownClauseCount: 2,
						pushdownCoverageRatio: 1,
						pushdownMode: 'full',
						queryMode: 'native_pgvector',
						returnedCount: 1,
						searchExpansionRatio: 1,
						topKFillRatio: 0.5,
						totalFilterClauseCount: 2,
						underfilledTopK: true
					},
					mode: 'pgvector'
				},
				vectorMode: 'native_pgvector'
			});
		}
	);

	itIfPostgres(
		'reports configured pgvector index mode in status',
		async () => {
			const store = trackStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					indexType: 'ivfflat',
					indexLists: 32,
					mockEmbedding: async () => [1, 0],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);

			await store.upsert({
				chunks: [{ chunkId: 'a', text: 'alpha' }]
			});

			expect(store.getStatus?.()).toMatchObject({
				backend: 'postgres',
				native: {
					active: true,
					available: true,
					estimatedRowCount: expect.any(Number),
					indexBytes: expect.any(Number),
					indexName: expect.stringContaining(
						'_embedding_ivfflat_idx'
					),
					indexPresent: true,
					indexType: 'ivfflat',
					lastHealthCheckAt: expect.any(Number),
					mode: 'pgvector'
				},
				vectorMode: 'native_pgvector'
			});
		}
	);

	itIfPostgres(
		'supports array membership operators with native pushdown',
		async () => {
			const store = trackStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === 'release'
							? [1, 0]
							: text === 'docs'
								? [0.8, 0]
								: [0.2, 1],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);

			await store.upsert({
				chunks: [
					{
						chunkId: 'a',
						metadata: { labels: ['release', 'docs'] },
						text: 'release'
					},
					{
						chunkId: 'b',
						metadata: { labels: ['release'] },
						text: 'docs'
					},
					{
						chunkId: 'c',
						metadata: { labels: ['backlog', 'infra'] },
						text: 'infra'
					}
				]
			});

			const containsAnyHits = await store.query({
				filter: {
					labels: { $containsAny: ['release', 'infra'] }
				},
				queryVector: [1, 0],
				topK: 3
			});
			expect(containsAnyHits.map((hit) => hit.chunkId)).toEqual([
				'a',
				'b',
				'c'
			]);

			const containsAllHits = await store.query({
				filter: {
					labels: { $containsAll: ['release', 'docs'] }
				},
				queryVector: [1, 0],
				topK: 3
			});
			expect(containsAllHits.map((hit) => hit.chunkId)).toEqual(['a']);

			expect(store.getStatus?.()).toMatchObject({
				native: {
					lastQueryPlan: {
						pushdownClauseCount: 1,
						pushdownCoverageRatio: 1,
						pushdownMode: 'full',
						totalFilterClauseCount: 1,
						jsRemainderClauseCount: 0
					}
				}
			});
		}
	);

	itIfPostgres('supports lexical queries and clearing', async () => {
		const store = trackStore(
			createPostgresRAGStore({
				connectionString: POSTGRES_URL,
				dimensions: 2,
				mockEmbedding: async () => [1, 0],
				tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
			})
		);

		await store.upsert({
			chunks: [
				{
					chunkId: 'alpha',
					metadata: { tenant: 'acme' },
					text: 'release policy alpha',
					title: 'Alpha release policy'
				},
				{
					chunkId: 'beta',
					metadata: { tenant: 'beta' },
					text: 'backlog beta note',
					title: 'Beta note'
				}
			]
		});

		const ranked = await store.queryLexical?.({
			filter: { tenant: 'acme' },
			query: 'release policy',
			topK: 2
		});

		expect(ranked).toMatchObject([{ chunkId: 'alpha' }]);

		await store.clear?.();

		const hits = await store.query({
			queryVector: [1, 0],
			topK: 2
		});
		expect(hits).toEqual([]);
	});

	itIfPostgres('supports count and delete with union semantics', async () => {
		const store = trackStore(
			createPostgresRAGStore({
				connectionString: POSTGRES_URL,
				dimensions: 2,
				mockEmbedding: async (text) =>
					text === 'alpha'
						? [1, 0]
						: text === 'beta'
							? [0, 1]
							: [0.2, 1],
				tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
			})
		);

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme' },
					text: 'alpha',
					title: 'Alpha'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'beta',
					title: 'Beta'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'gamma',
					title: 'Gamma'
				}
			]
		});

		expect(await store.count?.()).toBe(3);
		expect(await store.count?.({ filter: { tenant: 'acme' } })).toBe(2);
		expect(await store.count?.({ chunkIds: ['c', 'missing'] })).toBe(1);
		expect(await store.delete?.({ chunkIds: ['c', 'missing'] })).toBe(1);
		expect(await store.count?.()).toBe(2);
		expect(
			await store.delete?.({
				filter: { tenant: 'acme' },
				chunkIds: ['c']
			})
		).toBe(2);
	});

	itIfPostgres('supports per-query minResults overrides', async () => {
		const store = trackStore(
			createPostgresRAGStore({
				connectionString: POSTGRES_URL,
				dimensions: 2,
				mockEmbedding: async () => [1, 0],
				tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
			})
		);

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme' },
					text: 'release alpha'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'release beta'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'release gamma'
				}
			]
		});

		const hits = await store.query({
			candidateLimit: 3,
			minResults: 1,
			queryMultiplier: 1,
			queryVector: [1, 0],
			topK: 4
		});

		expect(hits.length).toBe(3);
		expect(store.getStatus?.()?.native?.lastQueryPlan).toMatchObject({
			backfillCount: 0,
			backfillLimitReached: false,
			candidateLimitUsed: 3,
			finalSearchK: 3,
			initialSearchK: 3,
			minResultsSatisfied: true,
			minResultsUsed: 1,
			queryMultiplierUsed: 1,
			returnedCount: 3
		});
	});

	itIfPostgres('supports strict_topk fill policy overrides', async () => {
		const store = trackStore(
			createPostgresRAGStore({
				connectionString: POSTGRES_URL,
				dimensions: 2,
				mockEmbedding: async () => [1, 0],
				tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
			})
		);

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme' },
					text: 'release alpha'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'release beta'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'release gamma'
				}
			]
		});

		const hits = await store.query({
			candidateLimit: 3,
			fillPolicy: 'strict_topk',
			maxBackfills: 0,
			minResults: 1,
			queryMultiplier: 1,
			queryVector: [1, 0],
			topK: 4
		});

		expect(hits.length).toBe(3);
		expect(store.getStatus?.()?.native?.lastQueryPlan).toMatchObject({
			backfillCount: 0,
			backfillLimitReached: true,
			candidateBudgetExhausted: true,
			candidateLimitUsed: 3,
			fillPolicyUsed: 'strict_topk',
			maxBackfillsUsed: 0,
			minResultsSatisfied: true,
			minResultsUsed: 1,
			returnedCount: 3,
			underfilledTopK: true
		});
	});

	itIfPostgres(
		'supports nested metadata operator pushdown for vector and lexical queries',
		async () => {
			const store = trackStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === 'priority alpha'
							? [1, 0]
							: text === 'priority beta'
								? [0.8, 0]
								: [0.2, 1],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);

			await store.upsert({
				chunks: [
					{
						chunkId: 'priority-a',
						metadata: {
							labels: ['release'],
							priority: { rank: 3 },
							scope: { region: 'us' }
						},
						source: 'priority-feed',
						text: 'priority alpha',
						title: 'Priority Alpha'
					},
					{
						chunkId: 'priority-b',
						metadata: {
							labels: ['release'],
							priority: { rank: 1 }
						},
						source: 'priority-feed',
						text: 'priority beta',
						title: 'Priority Beta'
					},
					{
						chunkId: 'priority-c',
						metadata: {
							labels: ['backlog'],
							priority: { rank: 5 },
							scope: { region: 'eu' }
						},
						source: 'priority-feed',
						text: 'priority gamma',
						title: 'Priority Gamma'
					}
				]
			});

			const vectorHits = await store.query({
				filter: {
					'priority.rank': { $gte: 2 },
					'scope.region': { $exists: true },
					labels: { $contains: 'release' }
				},
				queryVector: [1, 0],
				topK: 2
			});
			expect(vectorHits).toMatchObject([
				{ chunkId: 'priority-a', title: 'Priority Alpha' }
			]);

			const lexicalHits = await store.queryLexical?.({
				filter: {
					'priority.rank': { $in: [3, 5] },
					'scope.region': { $ne: 'eu' }
				},
				query: 'priority',
				topK: 2
			});
			expect(lexicalHits).toMatchObject([
				{ chunkId: 'priority-a', title: 'Priority Alpha' }
			]);

			expect(store.getStatus?.()).toMatchObject({
				native: {
					lastFilterDebug: {
						countSql: expect.stringContaining(
							"jsonb_extract_path_text(metadata, 'priority', 'rank')"
						),
						pushdownFilter: {
							'priority.rank': { $gte: 2 },
							'scope.region': { $exists: true },
							labels: { $contains: 'release' }
						}
					},
					lastQueryPlan: {
						jsRemainderClauseCount: 0,
						pushdownClauseCount: 3,
						pushdownCoverageRatio: 1,
						pushdownMode: 'full',
						totalFilterClauseCount: 3
					}
				}
			});
		}
	);

	itIfPostgres('supports per-query queryMultiplier overrides', async () => {
		const store = trackStore(
			createPostgresRAGStore({
				connectionString: POSTGRES_URL,
				dimensions: 2,
				mockEmbedding: async (text) =>
					text === 'alpha'
						? [1, 0]
						: text === 'beta'
							? [0.8, 0]
							: [0.6, 0],
				queryMultiplier: 2,
				tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
			})
		);

		await store.upsert({
			chunks: [
				{ chunkId: 'a', text: 'alpha' },
				{ chunkId: 'b', text: 'beta' },
				{ chunkId: 'c', text: 'gamma' }
			]
		});

		const hits = await store.query({
			candidateLimit: 2,
			queryMultiplier: 7,
			queryVector: [1, 0],
			topK: 1
		});

		expect(hits).toHaveLength(1);
		expect(store.getStatus?.()).toMatchObject({
			native: {
				lastQueryPlan: {
					candidateLimitUsed: 2,
					finalSearchK: 2,
					initialSearchK: 2,
					queryMultiplierUsed: 7,
					returnedCount: 1
				}
			}
		});
	});

	itIfPostgres('supports per-query maxBackfills overrides', async () => {
		const store = trackStore(
			createPostgresRAGStore({
				connectionString: POSTGRES_URL,
				dimensions: 2,
				mockEmbedding: async (text) =>
					text === 'alpha'
						? [1, 0]
						: text === 'beta'
							? [0.8, 0]
							: [0.6, 0],
				queryMultiplier: 2,
				tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
			})
		);

		await store.upsert({
			chunks: [
				{ chunkId: 'a', text: 'alpha' },
				{ chunkId: 'b', text: 'beta' },
				{ chunkId: 'c', text: 'gamma' }
			]
		});

		const hits = await store.query({
			candidateLimit: 3,
			maxBackfills: 0,
			queryMultiplier: 1,
			queryVector: [1, 0],
			topK: 4
		});

		expect(hits).toHaveLength(3);
		expect(store.getStatus?.()).toMatchObject({
			native: {
				lastQueryPlan: {
					backfillCount: 0,
					backfillLimitReached: true,
					candidateLimitUsed: 3,
					finalSearchK: 3,
					initialSearchK: 3,
					maxBackfillsUsed: 0,
					queryMultiplierUsed: 1,
					returnedCount: 3
				}
			}
		});
	});

	itIfPostgres(
		'supports typed metadata exact pushdown for boolean, number, and null values',
		async () => {
			const store = trackStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === 'typed alpha'
							? [1, 0]
							: text === 'typed beta'
								? [0.8, 0]
								: [0.3, 1],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);

			await store.upsert({
				chunks: [
					{
						chunkId: 'typed-a',
						metadata: {
							published: true,
							reviewState: null,
							scope: { priority: 3 }
						},
						text: 'typed alpha',
						title: 'Typed Alpha'
					},
					{
						chunkId: 'typed-b',
						metadata: {
							published: true,
							scope: { priority: 3 }
						},
						text: 'typed beta',
						title: 'Typed Beta'
					},
					{
						chunkId: 'typed-c',
						metadata: {
							published: false,
							reviewState: null,
							scope: { priority: 2 }
						},
						text: 'typed gamma',
						title: 'Typed Gamma'
					}
				]
			});

			const vectorHits = await store.query({
				filter: {
					published: true,
					reviewState: null,
					'scope.priority': 3
				},
				queryVector: [1, 0],
				topK: 2
			});
			expect(vectorHits).toMatchObject([
				{ chunkId: 'typed-a', title: 'Typed Alpha' }
			]);

			const lexicalHits = await store.queryLexical?.({
				filter: {
					published: true,
					reviewState: { $ne: null },
					'scope.priority': { $in: [3] }
				},
				query: 'typed',
				topK: 2
			});
			expect(lexicalHits).toMatchObject([
				{ chunkId: 'typed-b', title: 'Typed Beta' }
			]);

			expect(store.getStatus?.()).toMatchObject({
				native: {
					lastFilterDebug: {
						countSql: expect.stringContaining(
							"metadata #> '{reviewState}'"
						),
						pushdownFilter: {
							published: true,
							reviewState: null,
							'scope.priority': 3
						}
					},
					lastQueryPlan: {
						pushdownClauseCount: 3,
						pushdownCoverageRatio: 1,
						pushdownMode: 'full',
						totalFilterClauseCount: 3
					}
				}
			});
		}
	);
});
