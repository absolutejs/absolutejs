import { describe, expect, it } from 'bun:test';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';

describe('createInMemoryRAGStore', () => {
	it('counts chunks with filters and chunk-id inputs', async () => {
		const store = createInMemoryRAGStore({
			mockEmbedding: async (text) =>
				text === 'alpha'
					? [1, 0]
					: text === 'beta'
						? [0, 1]
						: [0.5, 0.5]
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme', labels: ['release'] },
					text: 'alpha'
				},
				{ chunkId: 'b', metadata: { tenant: 'acme' }, text: 'beta' },
				{ chunkId: 'c', metadata: { tenant: 'beta' }, text: 'gamma' }
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

	it('deletes chunks by filter, ids, and unioned criteria', async () => {
		const store = createInMemoryRAGStore({
			mockEmbedding: async (text) =>
				text === 'alpha'
					? [1, 0]
					: text === 'beta'
						? [0, 1]
						: [0.5, 0.5]
		});

		await store.upsert({
			chunks: [
				{
					chunkId: 'a',
					metadata: { tenant: 'acme', labels: ['release'] },
					text: 'alpha'
				},
				{
					chunkId: 'b',
					metadata: { tenant: 'acme' },
					text: 'beta'
				},
				{
					chunkId: 'c',
					metadata: { tenant: 'beta' },
					text: 'gamma'
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
});
