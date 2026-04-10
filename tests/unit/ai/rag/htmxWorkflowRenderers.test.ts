import { describe, expect, it } from 'bun:test';
import { resolveRAGWorkflowRenderers } from '../../../../src/ai/rag/htmxWorkflowRenderers';

describe('resolveRAGWorkflowRenderers', () => {
	it('renders workflow fragments with sane defaults', () => {
		const renderers = resolveRAGWorkflowRenderers();

		expect(
			renderers.status({
				capabilities: {
					backend: 'sqlite',
					nativeVectorSearch: true,
					persistence: 'embedded',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				status: {
					backend: 'sqlite',
					dimensions: 24,
					native: {
						active: true,
						available: true,
						mode: 'vec0',
						requested: true
					},
					vectorMode: 'native_vec0'
				}
			})
		).toContain('native_vec0');

		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:001',
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Metadata filters narrow retrieval.'
					}
				]
			})
		).toContain('Metadata filters narrow retrieval.');

		expect(
			renderers.documents({
				documents: [
					{
						chunkCount: 3,
						chunkStrategy: 'source_aware',
						format: 'markdown',
						id: 'doc-1',
						source: 'guide/demo.md',
						title: 'Demo Guide'
					}
				]
			})
		).toContain('Demo Guide');

		expect(
			renderers.evaluateResult({
				cases: [
					{
						caseId: 'doc-hit',
						elapsedMs: 12,
						expectedCount: 1,
						expectedIds: ['guide/demo.md'],
						f1: 1,
						label: 'Demo guide',
						matchedCount: 1,
						matchedIds: ['guide/demo.md'],
						missingIds: [],
						mode: 'source',
						precision: 1,
						query: 'retrieval workflow',
						recall: 1,
						retrievedCount: 1,
						retrievedIds: ['guide/demo.md'],
						status: 'pass',
						topK: 3
					}
				],
				summary: {
					averageF1: 1,
					averageLatencyMs: 12,
					averagePrecision: 1,
					averageRecall: 1,
					failedCases: 0,
					partialCases: 0,
					passedCases: 1,
					totalCases: 1
				}
			})
		).toContain('Evaluation');
	});

	it('supports overriding individual renderers', () => {
		const renderers = resolveRAGWorkflowRenderers({
			error: (message) => `<p>${message}</p>`
		});

		expect(renderers.error('broken')).toBe('<p>broken</p>');
	});
});
