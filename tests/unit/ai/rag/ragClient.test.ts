import { describe, expect, it } from 'bun:test';
import { createRAGClient } from '../../../../src/ai/client/ragClient';

describe('createRAGClient', () => {
	it('calls search and returns normalized results', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/search');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({ query: 'hello', topK: 2 })
			);

			return new Response(
				JSON.stringify({
					ok: true,
					results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }]
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const results = await client.search({ query: 'hello', topK: 2 });
		expect(results).toEqual([{ chunkId: 'a', score: 0.9, text: 'alpha' }]);
	});

	it('surfaces ingest errors as structured responses', async () => {
		const fetchMock = (async () =>
			new Response(JSON.stringify({ error: 'bad ingest' }), {
				status: 400
			})) as unknown as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingest([{ chunkId: 'a', text: 'hello' }]);
		expect(response).toEqual({
			error: 'bad ingest',
			ok: false
		});
	});

	it('posts document ingest payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/ingest');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					documents: [
						{
							source: 'notes/demo.md',
							text: '# Demo\n\nAbsoluteJS retrieval workflow.'
						}
					]
				})
			);

			return new Response(
				JSON.stringify({
					count: 2,
					documentCount: 1,
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingestDocuments({
			documents: [
				{
					source: 'notes/demo.md',
					text: '# Demo\n\nAbsoluteJS retrieval workflow.'
				}
			]
		});
		expect(response).toEqual({
			count: 2,
			documentCount: 1,
			ok: true
		});
	});

	it('posts URL ingest payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/ingest');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					urls: [
						{
							url: 'https://example.com/guide.md'
						}
					]
				})
			);

			return new Response(
				JSON.stringify({
					count: 1,
					documentCount: 1,
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingestUrls({
			urls: [{ url: 'https://example.com/guide.md' }]
		});
		expect(response).toEqual({
			count: 1,
			documentCount: 1,
			ok: true
		});
	});

	it('posts upload ingest payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/ingest');
			expect(init?.method).toBe('POST');
			expect(JSON.parse(init?.body as string)).toEqual({
				baseMetadata: { source: 'upload' },
				uploads: [
					{
						content: 'hello',
						encoding: 'utf8',
						name: 'notes.txt'
					}
				]
			});

			return new Response(
				JSON.stringify({
					count: 1,
					documentCount: 1,
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingestUploads({
			baseMetadata: { source: 'upload' },
			uploads: [
				{
					content: 'hello',
					encoding: 'utf8',
					name: 'notes.txt'
				}
			]
		});
		expect(response).toEqual({
			count: 1,
			documentCount: 1,
			ok: true
		});
	});

	it('loads status from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/status');

			return new Response(
				JSON.stringify({
					capabilities: {
						backend: 'sqlite',
						nativeVectorSearch: false,
						persistence: 'embedded',
						serverSideFiltering: false,
						streamingIngestStatus: false
					},
					ok: true,
					status: {
						backend: 'sqlite',
						vectorMode: 'json_fallback'
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag/'
		});

		const response = await client.status();
		expect(response.ok).toBe(true);
		expect(response.status?.vectorMode).toBe('json_fallback');
		expect(response.capabilities?.backend).toBe('sqlite');
	});

	it('loads ops from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/ops');

			return new Response(
				JSON.stringify({
					admin: {
						canClearIndex: true,
						canCreateDocument: true,
						canDeleteDocument: true,
						canListSyncSources: true,
						canReindexDocument: true,
						canReindexSource: true,
						canReseed: true,
						canReset: true,
						canSyncAllSources: true,
						canSyncSource: true
					},
					adminActions: [
						{
							action: 'reseed',
							id: 'admin-1',
							startedAt: 1,
							status: 'completed'
						}
					],
					adminJobs: [
						{
							action: 'reseed',
							id: 'job-1',
							startedAt: 1,
							status: 'completed'
						}
					],
					capabilities: {
						backend: 'sqlite',
						nativeVectorSearch: false,
						persistence: 'embedded',
						serverSideFiltering: false,
						streamingIngestStatus: false
					},
					documents: {
						byKind: { note: 1 },
						chunkCount: 3,
						total: 1
					},
					health: {
						averageChunksPerDocument: 3,
						coverageByFormat: { markdown: 1 },
						coverageByKind: { note: 1 },
						documentsMissingCreatedAt: 0,
						documentsMissingMetadata: 0,
						documentsMissingSource: 0,
						documentsMissingTitle: 0,
						documentsMissingUpdatedAt: 0,
						documentsWithoutChunkPreview: 0,
						duplicateDocumentIdGroups: [],
						duplicateDocumentIds: [],
						duplicateSourceGroups: [],
						duplicateSources: [],
						emptyChunks: 0,
						emptyDocuments: 0,
						failedAdminJobs: 0,
						failedIngestJobs: 0,
						failuresByAdminAction: {},
						failuresByExtractor: {},
						failuresByInputKind: {},
						inspectedChunks: 3,
						inspectedDocuments: 1,
						lowSignalChunks: 0,
						newestDocumentAgeMs: 10,
						oldestDocumentAgeMs: 10,
						staleAfterMs: 604800000,
						staleDocuments: []
					},
					ingestJobs: [
						{
							chunkCount: 3,
							documentCount: 1,
							id: 'job-1',
							inputKind: 'documents',
							requestedCount: 1,
							startedAt: 1,
							status: 'completed'
						}
					],
					ok: true,
					readiness: {
						embeddingConfigured: false,
						extractorNames: ['pdf'],
						extractorsConfigured: true,
						indexManagerConfigured: true,
						providerConfigured: true,
						rerankerConfigured: false
					},
					syncSources: [
						{
							id: 'sync-1',
							kind: 'directory',
							label: 'Docs folder',
							status: 'completed',
							target: '/docs'
						}
					],
					status: {
						backend: 'sqlite',
						vectorMode: 'json_fallback'
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag/'
		});

		const response = await client.ops();
		expect(response.ok).toBe(true);
		expect(response.admin.canReseed).toBe(true);
		expect(response.adminActions[0]?.action).toBe('reseed');
		expect(response.adminJobs?.[0]?.status).toBe('completed');
		expect(response.documents?.chunkCount).toBe(3);
		expect(response.health.duplicateSourceGroups).toEqual([]);
		expect(response.health.coverageByFormat).toEqual({ markdown: 1 });
		expect(response.ingestJobs[0]?.status).toBe('completed');
		expect(response.readiness.extractorNames).toEqual(['pdf']);
		expect(response.syncSources[0]?.id).toBe('sync-1');
	});

	it('posts reindex mutations to the workflow endpoints', async () => {
		const calls: Array<{ input: string; method?: string; body?: string }> =
			[];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		await client.reindexDocument('doc-1');
		await client.reindexSource('docs/a.md');

		expect(calls).toEqual([
			{
				body: undefined,
				input: '/rag/reindex/documents/doc-1',
				method: 'POST'
			},
			{
				body: JSON.stringify({ source: 'docs/a.md' }),
				input: '/rag/reindex/source',
				method: 'POST'
			}
		]);
	});

	it('lists and triggers source sync workflow endpoints', async () => {
		const calls: Array<{
			body?: string;
			input: string;
			method?: string;
		}> = [];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			return new Response(
				JSON.stringify({
					ok: true,
					sources: [
						{
							id: 'sync-1',
							kind: 'directory',
							label: 'Docs folder',
							status: 'completed'
						}
					]
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		await client.syncSources();
		await client.syncAllSources({ background: true });
		await client.syncSource('sync-1', { background: true });

		expect(calls).toEqual([
			{
				body: undefined,
				input: '/rag/sync',
				method: undefined
			},
			{
				body: JSON.stringify({ background: true }),
				input: '/rag/sync',
				method: 'POST'
			},
			{
				body: JSON.stringify({ background: true }),
				input: '/rag/sync/sync-1',
				method: 'POST'
			}
		]);
	});

	it('posts evaluation payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/evaluate');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['guide-1'],
							id: 'doc-hit',
							query: 'how does retrieval work?',
							topK: 3
						}
					],
					topK: 5
				})
			);

			return new Response(
				JSON.stringify({
					cases: [
						{
							caseId: 'doc-hit',
							elapsedMs: 4,
							expectedCount: 1,
							expectedIds: ['guide-1'],
							f1: 1,
							matchedCount: 1,
							matchedIds: ['guide-1'],
							missingIds: [],
							mode: 'documentId',
							precision: 1,
							query: 'how does retrieval work?',
							recall: 1,
							retrievedCount: 1,
							retrievedIds: ['guide-1'],
							status: 'pass',
							topK: 3
						}
					],
					elapsedMs: 4,
					ok: true,
					passingRate: 100,
					summary: {
						averageF1: 1,
						averageLatencyMs: 4,
						averagePrecision: 1,
						averageRecall: 1,
						failedCases: 0,
						partialCases: 0,
						passedCases: 1,
						totalCases: 1
					},
					totalCases: 1
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.evaluate({
			cases: [
				{
					expectedDocumentIds: ['guide-1'],
					id: 'doc-hit',
					query: 'how does retrieval work?',
					topK: 3
				}
			],
			topK: 5
		});

		expect(response.summary.passedCases).toBe(1);
		expect(response.cases[0]?.mode).toBe('documentId');
	});

	it('loads indexed documents from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/documents?kind=custom');

			return new Response(
				JSON.stringify({
					documents: [
						{
							chunkCount: 2,
							id: 'doc-1',
							source: 'notes/demo.md',
							title: 'Demo'
						}
					],
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.documents('custom');
		expect(response.documents[0]?.id).toBe('doc-1');
	});

	it('loads document chunk previews from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/documents/doc-1/chunks');

			return new Response(
				JSON.stringify({
					chunks: [{ chunkId: 'doc-1:001', text: 'Alpha' }],
					document: {
						id: 'doc-1',
						source: 'notes/demo.md',
						title: 'Demo'
					},
					normalizedText: 'Alpha',
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.documentChunks('doc-1');
		expect(response.ok).toBe(true);
		if (response.ok) {
			expect(response.chunks).toHaveLength(1);
		}
	});

	it('posts document creation to the managed documents endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/documents');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					source: 'custom/demo.md',
					text: '# Demo'
				})
			);

			return new Response(
				JSON.stringify({
					document: {
						id: 'custom-demo',
						source: 'custom/demo.md',
						title: 'custom-demo'
					},
					inserted: 'custom-demo',
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.createDocument({
			source: 'custom/demo.md',
			text: '# Demo'
		});
		expect(response.ok).toBe(true);
		expect(response.inserted).toBe('custom-demo');
	});

	it('posts reseed and reset mutations to the workflow endpoints', async () => {
		const calls: Array<{ input: unknown; method?: string }> = [];
		const fetchMock = (async (input, init) => {
			calls.push({ input, method: init?.method });

			return new Response(JSON.stringify({ ok: true, status: 'ok' }), {
				status: 200
			});
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		await client.reseed();
		await client.reset();

		expect(calls).toEqual([
			{ input: '/rag/reseed', method: 'POST' },
			{ input: '/rag/reset', method: 'POST' }
		]);
	});
});
