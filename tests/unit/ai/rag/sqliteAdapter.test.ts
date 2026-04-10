import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createSQLiteRAGStore } from '../../../../src/ai/rag/adapters/sqlite';

const vectorFixture: Record<string, number[]> = {
	a: [1, 0],
	b: [0, 1],
	c: [0.4, 0.9]
};

describe('createSQLiteRAGStore', () => {
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
