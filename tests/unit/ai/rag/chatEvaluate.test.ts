import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { ragChat } from '../../../../src/ai/rag/chat';
import { createRAGCollection } from '../../../../src/ai/rag/collection';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';

describe('ragChat evaluation workflow', () => {
	const provider = () => ({
		async *stream() {}
	});

	it('evaluates retrieval cases through the /evaluate route', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];
				if (text.includes('question about alpha')) return [1, 0];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'guide-1:001',
					metadata: { documentId: 'guide-1' },
					source: 'guide-1',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'guide-2:001',
					metadata: { documentId: 'guide-2' },
					source: 'guide-2',
					text: 'beta ingestion workflow'
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
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['guide-1'],
							id: 'alpha-doc',
							query: 'question about alpha',
							topK: 2
						}
					]
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			cases: Array<{
				caseId: string;
				mode: string;
				status: string;
				matchedIds: string[];
			}>;
			summary: { passedCases: number };
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.summary.passedCases).toBe(1);
		expect(body.cases[0]?.caseId).toBe('alpha-doc');
		expect(body.cases[0]?.mode).toBe('documentId');
		expect(body.cases[0]?.status).toBe('pass');
		expect(body.cases[0]?.matchedIds).toEqual(['guide-1']);
	});

	it('supports dry-run evaluation payloads without querying the collection', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({ dimensions: 2 })
		});
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedSources: ['docs/demo.md'],
							id: 'source-dry-run',
							query: 'anything'
						}
					],
					dryRun: true
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			cases: Array<{
				retrievedCount: number;
				status: string;
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.cases[0]?.retrievedCount).toBe(0);
		expect(body.cases[0]?.status).toBe('fail');
	});
});
