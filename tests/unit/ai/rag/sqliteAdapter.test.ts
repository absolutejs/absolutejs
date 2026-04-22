import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import {
	planNativeCandidateSearchBackfillK,
	planNativeCandidateSearchK,
	summarizeSQLiteCandidateCoverage
} from '../../../../src/ai/rag/adapters/queryPlanning';
import { createSQLiteRAGStore } from '../../../../src/ai/rag/adapters/sqlite';

const vectorFixture: Record<string, number[]> = {
	a: [1, 0],
	b: [0, 1],
	c: [0.4, 0.9]
};

describe('createSQLiteRAGStore', () => {
	it('plans native candidate counts conservatively from filtered row counts', () => {
		expect(
			planNativeCandidateSearchK({
				candidateLimit: 50,
				filteredCandidateCount: 3,
				queryMultiplier: 4,
				topK: 5
			})
		).toBe(3);

		expect(
			planNativeCandidateSearchK({
				candidateLimit: 50,
				filteredCandidateCount: 0,
				queryMultiplier: 4,
				topK: 5
			})
		).toBe(0);

		expect(
			planNativeCandidateSearchK({
				candidateLimit: 10,
				filteredCandidateCount: 200,
				queryMultiplier: 4,
				topK: 5
			})
		).toBe(10);

		expect(
			planNativeCandidateSearchBackfillK({
				candidateLimit: 50,
				currentSearchK: 5,
				filteredCandidateCount: 12
			})
		).toBe(10);

		expect(
			planNativeCandidateSearchBackfillK({
				candidateLimit: 50,
				currentSearchK: 10,
				filteredCandidateCount: 12
			})
		).toBe(12);

		expect(
			planNativeCandidateSearchBackfillK({
				candidateLimit: 50,
				currentSearchK: 12,
				filteredCandidateCount: 12
			})
		).toBe(12);

		expect(
			summarizeSQLiteCandidateCoverage({
				filteredCandidateCount: 0,
				topK: 5
			})
		).toBe('empty');
		expect(
			summarizeSQLiteCandidateCoverage({
				filteredCandidateCount: 3,
				topK: 5
			})
		).toBe('under_target');
		expect(
			summarizeSQLiteCandidateCoverage({
				filteredCandidateCount: 5,
				topK: 5
			})
		).toBe('target_sized');
		expect(
			summarizeSQLiteCandidateCoverage({
				filteredCandidateCount: 20,
				topK: 5
			})
		).toBe('broad');
	});

	it('retrieves nearest chunks with metadata filter support', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			dimensions: 2,
			mockEmbedding: (text) =>
				Promise.resolve(vectorFixture[text] ?? [0.1, 0.9])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme' },
					source: 'docs',
					text: 'a',
					title: 'Apple'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'b'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'c'
				}
			]
		});

		const full = await store.query({ queryVector: [0.9, 0.1], topK: 3 });
		const filtered = await store.query({
			filter: { tenant: 'acme' },
			queryVector: [0.9, 0.1],
			topK: 3
		});

		expect(full).toHaveLength(3);
		expect(full[0]?.chunkId).toBe('a');
		expect(full[0]?.score).toBeGreaterThan(full[1]?.score ?? 0);
		expect(full[1]?.chunkId).toBe('c');
		expect(full[0]?.score).toBeLessThanOrEqual(1);

		expect(filtered).toHaveLength(2);
		expect(filtered.every((hit) => hit.metadata?.tenant === 'acme')).toBe(
			true
		);
	});

	it('supports operator-based metadata filters consistently across sqlite and in-memory stores', async () => {
		const stores = [
			createSQLiteRAGStore({
				db: new Database(':memory:'),
				dimensions: 2,
				mockEmbedding: (text) =>
					Promise.resolve(vectorFixture[text] ?? [0.1, 0.9])
			}),
			createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: (text) =>
					Promise.resolve(vectorFixture[text] ?? [0.1, 0.9])
			})
		];

		for (const store of stores) {
			await store.upsert({
				chunks: [
					{
						chunkId: 'a',
						metadata: {
							labels: ['urgent', 'release'],
							priority: 5,
							scope: { region: 'us', tier: 1 },
							tenant: 'acme',
							tags: ['ops']
						},
						source: 'docs',
						text: 'a',
						title: 'Apple'
					},
					{
						chunkId: 'b',
						metadata: {
							labels: ['backlog'],
							priority: 2,
							scope: { region: 'eu', tier: 2 },
							tenant: 'acme'
						},
						source: 'notes',
						text: 'b',
						title: 'Banana'
					},
					{
						chunkId: 'c',
						metadata: {
							labels: ['release', 'finance'],
							priority: 7,
							scope: { region: 'us', tier: 3 },
							tenant: 'beta'
						},
						text: 'c'
					}
				]
			});

			expect(
				await store.query({
					filter: { tenant: { $in: ['beta'] } },
					queryVector: [0.1, 0.9],
					topK: 5
				})
			).toMatchObject([{ chunkId: 'c' }]);

			expect(
				await store.query({
					filter: { priority: { $gte: 5 } },
					queryVector: [0.9, 0.1],
					topK: 5
				})
			).toMatchObject([{ chunkId: 'a' }, { chunkId: 'c' }]);

			expect(
				await store.query({
					filter: {
						source: { $ne: 'docs' },
						title: { $exists: true }
					},
					queryVector: [0.1, 0.9],
					topK: 5
				})
			).toMatchObject([{ chunkId: 'b' }]);

			const missingTags = await store.query({
				filter: { tags: { $exists: false } },
				queryVector: [0.1, 0.9],
				topK: 5
			});

			expect(missingTags.map((hit) => hit.chunkId).sort()).toEqual([
				'b',
				'c'
			]);

			const nested = await store.query({
				filter: { 'scope.region': 'us', 'scope.tier': { $gte: 3 } },
				queryVector: [0.1, 0.9],
				topK: 5
			});

			expect(nested).toMatchObject([{ chunkId: 'c' }]);

			const boolean = await store.query({
				filter: {
					$or: [
						{ source: 'docs' },
						{ $and: [{ tenant: 'beta' }, { 'scope.region': 'us' }] }
					],
					$not: { priority: { $lt: 5 } }
				},
				queryVector: [0.1, 0.9],
				topK: 5
			});

			expect(boolean.map((hit) => hit.chunkId).sort()).toEqual([
				'a',
				'c'
			]);

			const scalarArrayMatch = await store.query({
				filter: { labels: 'release' },
				queryVector: [0.1, 0.9],
				topK: 5
			});

			expect(scalarArrayMatch.map((hit) => hit.chunkId).sort()).toEqual([
				'a',
				'c'
			]);

			const containsAny = await store.query({
				filter: { labels: { $containsAny: ['finance', 'urgent'] } },
				queryVector: [0.1, 0.9],
				topK: 5
			});

			expect(containsAny.map((hit) => hit.chunkId).sort()).toEqual([
				'a',
				'c'
			]);

			const containsAll = await store.query({
				filter: { labels: { $containsAll: ['release', 'urgent'] } },
				queryVector: [0.1, 0.9],
				topK: 5
			});

			expect(containsAll).toMatchObject([{ chunkId: 'a' }]);
		}
	});

	it('retains partial SQL pushdown while honoring JS-only array filter clauses', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			dimensions: 2,
			native: {
				mode: 'vec0'
			},
			mockEmbedding: (text) =>
				Promise.resolve(vectorFixture[text] ?? [0.1, 0.9])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { labels: ['release'], tenant: 'acme' },
					text: 'a'
				},
				{
					chunkId: 'b',
					metadata: { labels: ['backlog'], tenant: 'acme' },
					text: 'b'
				},
				{
					chunkId: 'c',
					metadata: { labels: ['release'], tenant: 'beta' },
					text: 'c'
				}
			]
		});

		const hits = await store.query({
			filter: {
				tenant: 'acme',
				labels: { $contains: 'release' }
			},
			queryMultiplier: 7,
			queryVector: [0.9, 0.1],
			topK: 5
		});

		expect(hits).toMatchObject([{ chunkId: 'a' }]);
		expect(store.getStatus?.()).toMatchObject({
			backend: 'sqlite',
			native: {
				lastQueryPlan: {
					backfillCount: 0,
					candidateBudgetExhausted: false,
					candidateCoverage: 'under_target',
					candidateYieldRatio: 0.5,
					filteredCandidateCount: 2,
					pushdownApplied: true,
					pushdownClauseCount: 1,
					pushdownCoverageRatio: 0.5,
					pushdownMode: 'partial',
					queryMultiplierUsed: 7,
					queryMode: 'json_fallback',
					jsRemainderClauseCount: 1,
					jsRemainderRatio: 0.5,
					returnedCount: 1,
					searchExpansionRatio: 1,
					topKFillRatio: 0.2,
					totalFilterClauseCount: 2,
					underfilledTopK: true
				}
			}
		});
	});

	it('records sqlite maintenance diagnostics for vec0-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			dimensions: 2,
			native: {
				mode: 'vec0'
			},
			mockEmbedding: (text) =>
				Promise.resolve(vectorFixture[text] ?? [0.1, 0.9])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'sqlite-maint-a',
					text: 'a'
				}
			]
		});
		await store.analyze?.();

		expect(store.getStatus?.()).toMatchObject({
			backend: 'sqlite',
			native: {
				databaseBytes: expect.any(Number),
				freelistCount: expect.any(Number),
				lastAnalyzeAt: expect.any(Number),
				lastAnalyzeError: undefined,
				lastHealthCheckAt: expect.any(Number),
				pageCount: expect.any(Number),
				requested: true,
				rowCount: 1,
				tableName: expect.stringContaining('rag_chunks')
			}
		});
	});

	it('updates embeddings on duplicate chunk id', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			mockEmbedding: (text) =>
				Promise.resolve(text === 'first' ? [1, 0] : [0, 1])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'dup',
					metadata: { revision: 'v1' },
					text: 'first'
				}
			]
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'dup',
					metadata: { revision: 'v2' },
					text: 'second'
				}
			]
		});

		const hits = await store.query({
			queryVector: [1, 0],
			topK: 1
		});

		expect(hits).toHaveLength(1);
		expect(hits[0]?.chunkId).toBe('dup');
		expect(hits[0]?.metadata?.revision).toBe('v2');
	});

	it('clears stored chunks', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			mockEmbedding: () => Promise.resolve([1, 1])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'x',
					text: 'x'
				}
			]
		});

		await store.clear?.();
		const hits = await store.query({
			queryVector: [1, 1],
			topK: 10
		});

		expect(hits).toHaveLength(0);
	});

	it('counts chunks with filters and chunk-id inputs', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			mockEmbedding: () => Promise.resolve([1, 1])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme' },
					text: 'a'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'b'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'c'
				}
			]
		});

		expect(await store.count?.()).toBe(3);
		expect(await store.count?.({ filter: { tenant: 'acme' } })).toBe(2);
		expect(await store.count?.({ chunkIds: ['a', 'c'] })).toBe(2);
		expect(
			await store.count?.({
				filter: { tenant: 'acme' },
				chunkIds: ['c']
			})
		).toBe(3);
		expect(await store.count?.({ chunkIds: ['missing'] })).toBe(0);
		expect(await store.count?.({ filter: {} })).toBe(3);
	});

	it('deletes chunks by filters, ids, and unioned criteria', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			mockEmbedding: () => Promise.resolve([1, 1])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme', labels: ['release'] },
					text: 'a'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'b'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'c'
				}
			]
		});

		expect(await store.delete?.()).toBe(0);
		expect(await store.delete?.({ chunkIds: ['a', 'a', 'missing'] })).toBe(
			1
		);
		expect(await store.count?.()).toBe(2);

		expect(await store.delete?.({ filter: { tenant: 'acme' } })).toBe(1);
		expect(await store.count?.()).toBe(1);

		expect(
			await store.delete?.({
				filter: { labels: 'release' },
				chunkIds: ['c']
			})
		).toBe(1);
		expect(await store.count?.()).toBe(0);
	});

	it('falls back to JS similarity when vec0 is unavailable', async () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			native: {
				mode: 'vec0'
			},
			mockEmbedding: (text) =>
				Promise.resolve(vectorFixture[text] ?? [0.1, 0.9])
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'fallback-a',
					metadata: { tenant: 'acme' },
					text: 'a'
				},
				{
					chunkId: 'fallback-b',
					metadata: { tenant: 'beta' },
					text: 'b'
				}
			]
		});

		const hits = await store.query({
			queryVector: [0.9, 0.1],
			topK: 1
		});

		expect(hits).toHaveLength(1);
		expect(hits[0]?.chunkId).toBe('fallback-a');
		expect(store.getStatus?.()).toMatchObject({
			backend: 'sqlite',
			native: {
				active: false,
				requested: true
			},
			vectorMode: 'json_fallback'
		});
	});

	it('throws when native vec0 backend is explicitly required but unavailable', () => {
		const db = new Database(':memory:');

		expect(() =>
			createSQLiteRAGStore({
				db,
				native: {
					mode: 'vec0',
					requireAvailable: true
				}
			})
		).toThrow('Failed to initialize sqlite vec0 backend');
	});

	it('reports missing explicit sqlite-vec binaries in diagnostics', () => {
		const db = new Database(':memory:');
		const store = createSQLiteRAGStore({
			db,
			native: {
				extensionPath: '/definitely/missing/sqlite-vec.so',
				mode: 'vec0'
			}
		});

		expect(store.getStatus?.()).toMatchObject({
			backend: 'sqlite',
			native: {
				active: false,
				requested: true,
				resolution: {
					libraryPath: '/definitely/missing/sqlite-vec.so',
					source: 'explicit',
					status: 'binary_missing'
				}
			},
			vectorMode: 'json_fallback'
		});
	});

	it('exposes stable status for in-memory stores', () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });

		expect(store.getStatus?.()).toEqual({
			backend: 'in_memory',
			dimensions: 8,
			vectorMode: 'in_memory'
		});
	});
});
