import { describe, expect, it } from 'bun:test';
import { ragChat } from '../../../../src/ai/rag/chat';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createRAGFileExtractor } from '../../../../src/ai/rag/ingestion';

describe('ragChat ingest workflow', () => {
	it('uses configured extractors for upload ingest', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			extractors: [
				createRAGFileExtractor({
					name: 'test_upload_audio',
					extract: () => ({
						format: 'text',
						metadata: {
							fileKind: 'media',
							transcriptSource: 'unit-test'
						},
						source: 'uploads/meeting.mp3',
						text: 'Uploaded audio transcript for the workflow test.',
						title: 'Meeting audio'
					}),
					supports: (input) => input.name === 'meeting.mp3'
				})
			],
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/ingest', {
				body: JSON.stringify({
					uploads: [
						{
							content: Buffer.from([1, 2, 3, 4]).toString(
								'base64'
							),
							contentType: 'audio/mpeg',
							encoding: 'base64',
							name: 'meeting.mp3'
						}
					]
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			count: 1,
			documentCount: 1,
			ok: true
		});

		const results = await store.query({
			queryVector: await store.embed({ text: 'workflow transcript' }),
			topK: 5
		});

		expect(results[0]?.source).toBe('uploads/meeting.mp3');
		expect(results[0]?.metadata).toMatchObject({
			extractor: 'test_upload_audio',
			fileKind: 'media',
			transcriptSource: 'unit-test'
		});
	});

	it('reports ingest jobs and readiness from the ops endpoint', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			extractors: [
				createRAGFileExtractor({
					name: 'test_upload_audio',
					extract: () => ({
						format: 'text',
						metadata: {
							fileKind: 'media',
							transcriptSource: 'unit-test'
						},
						source: 'uploads/meeting.mp3',
						text: 'Uploaded audio transcript for the workflow test.',
						title: 'Meeting audio'
					}),
					supports: (input) => input.name === 'meeting.mp3'
				})
			],
			path: '/rag',
			provider: function unitTestProvider() {
				throw new Error('not used');
			},
			readinessProviderName: 'unit test provider registry',
			ragStore: store
		});

		const ingestResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ingest', {
				body: JSON.stringify({
					uploads: [
						{
							content: Buffer.from([1, 2, 3, 4]).toString(
								'base64'
							),
							contentType: 'audio/mpeg',
							encoding: 'base64',
							name: 'meeting.mp3'
						}
					]
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);

		expect(ingestResponse.status).toBe(200);

		const opsResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);

		expect(opsResponse.status).toBe(200);
		expect(await opsResponse.json()).toMatchObject({
			admin: {
				canClearIndex: true,
				canCreateDocument: false,
				canDeleteDocument: false,
				canListSyncSources: false,
				canReindexDocument: false,
				canReindexSource: false,
				canReseed: false,
				canReset: false,
				canSyncAllSources: false,
				canSyncSource: false
			},
			adminActions: [],
			adminJobs: [],
			capabilities: {
				backend: 'in_memory',
				persistence: 'memory_only'
			},
			health: {
				averageChunksPerDocument: 0,
				coverageByFormat: {},
				coverageByKind: {},
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
				inspectedChunks: 0,
				inspectedDocuments: 0,
				lowSignalChunks: 0,
				staleAfterMs: 604800000,
				staleDocuments: []
			},
			ingestJobs: [
				{
					chunkCount: 1,
					documentCount: 1,
					extractorNames: ['test_upload_audio'],
					inputKind: 'uploads',
					requestedCount: 1,
					status: 'completed'
				}
			],
			ok: true,
			readiness: {
				embeddingConfigured: false,
				extractorNames: ['test_upload_audio'],
				extractorsConfigured: true,
				indexManagerConfigured: false,
				providerConfigured: true,
				providerName: 'unit test provider registry',
				rerankerConfigured: false
			},
			syncSources: [],
			status: {
				backend: 'in_memory',
				vectorMode: 'in_memory'
			}
		});
	});

	it('tracks admin actions in the ops endpoint', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const documents: Array<{
			id: string;
			text: string;
			chunkCount?: number;
			source?: string;
			title?: string;
			format?: 'text' | 'markdown' | 'html';
			kind?: string;
			metadata?: Record<string, unknown>;
		}> = [];
		const plugin = ragChat({
			indexManager: {
				createDocument(input) {
					documents.push({
						chunkCount: 1,
						format: input.format,
						id: input.id ?? 'doc-1',
						kind: 'manual',
						metadata: input.metadata,
						source: input.source ?? '',
						text: input.text,
						title: input.title ?? ''
					});

					return { ok: true };
				},
				deleteDocument(id) {
					const index = documents.findIndex(
						(document) => document.id === id
					);
					if (index < 0) {
						return false;
					}
					documents.splice(index, 1);

					return true;
				},
				getDocumentChunks(id) {
					const document = documents.find((entry) => entry.id === id);
					if (!document) {
						return null;
					}

					return {
						chunks: [
							{
								chunkId: `${id}:0`,
								text: document.text ?? ''
							}
						],
						document: {
							chunkCount: document.chunkCount,
							format: document.format,
							id: document.id,
							kind: document.kind,
							source: document.source ?? '',
							title: document.title ?? ''
						},
						normalizedText: document.text ?? ''
					};
				},
				listDocuments() {
					return documents.map((document) => ({
						...document,
						source: document.source ?? '',
						title: document.title ?? ''
					}));
				},
				reindexDocument(id) {
					const document = documents.find((entry) => entry.id === id);
					if (!document) {
						return {
							error: 'document not found',
							ok: false
						};
					}

					return {
						ok: true,
						reindexed: id,
						status: 'reindexed'
					};
				},
				reindexSource(source) {
					const matched = documents.filter(
						(entry) => entry.source === source
					);

					return {
						documents: matched.length,
						ok: true,
						reindexed: source,
						status: 'reindexed'
					};
				},
				reseed() {
					return { ok: true };
				},
				reset() {
					documents.length = 0;

					return { ok: true };
				}
			},
			path: '/rag',
			ragStore: store,
			provider: () => {
				throw new Error('not used');
			}
		});

		await plugin.handle(
			new Request('http://absolute.local/rag/documents', {
				body: JSON.stringify({
					id: 'doc-1',
					source: 'ops/manual.txt',
					text: 'Admin action coverage document.'
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/reindex/documents/doc-1', {
				method: 'POST'
			})
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/reindex/source', {
				body: JSON.stringify({ source: 'ops/manual.txt' }),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/reseed', { method: 'POST' })
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/reset', { method: 'POST' })
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/index', { method: 'DELETE' })
		);

		const opsResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const payload = await opsResponse.json();

		expect(payload.admin).toMatchObject({
			canClearIndex: true,
			canCreateDocument: true,
			canDeleteDocument: true,
			canListSyncSources: false,
			canReindexDocument: true,
			canReindexSource: true,
			canReseed: true,
			canReset: true,
			canSyncAllSources: false,
			canSyncSource: false
		});
		expect(payload.adminActions).toHaveLength(6);
		expect(
			payload.adminActions.map(
				(entry: { action: string }) => entry.action
			)
		).toEqual([
			'clear_index',
			'reset',
			'reseed',
			'reindex_source',
			'reindex_document',
			'create_document'
		]);
		expect(
			payload.adminActions.every(
				(entry: { status: string }) => entry.status === 'completed'
			)
		).toBe(true);
		expect(payload.adminJobs).toHaveLength(6);
		expect(
			payload.adminJobs.every(
				(entry: { status: string }) => entry.status === 'completed'
			)
		).toBe(true);
		expect(payload.syncSources).toEqual([]);
	});

	it('lists and runs configured source sync operations', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		let sourceStatus: 'idle' | 'completed' = 'idle';
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [];
				},
				listSyncSources() {
					return [
						{
							id: 'docs-folder',
							kind: 'directory' as const,
							label: 'Docs folder',
							status: sourceStatus,
							target: '/docs'
						}
					];
				},
				syncAllSources() {
					sourceStatus = 'completed';

					return {
						ok: true,
						sources: [
							{
								id: 'docs-folder',
								kind: 'directory' as const,
								label: 'Docs folder',
								status: sourceStatus,
								target: '/docs'
							}
						]
					};
				},
				syncSource(id) {
					sourceStatus = 'completed';

					return {
						ok: true,
						source: {
							id,
							kind: 'directory' as const,
							label: 'Docs folder',
							status: sourceStatus,
							target: '/docs'
						}
					};
				}
			},
			path: '/rag',
			ragStore: store,
			provider: () => {
				throw new Error('not used');
			}
		});

		const listResponse = await plugin.handle(
			new Request('http://absolute.local/rag/sync')
		);
		expect(await listResponse.json()).toMatchObject({
			ok: true,
			sources: [
				{
					id: 'docs-folder',
					status: 'idle'
				}
			]
		});

		const singleResponse = await plugin.handle(
			new Request('http://absolute.local/rag/sync/docs-folder', {
				method: 'POST'
			})
		);
		expect(await singleResponse.json()).toMatchObject({
			ok: true,
			source: {
				id: 'docs-folder',
				status: 'completed'
			}
		});

		const allResponse = await plugin.handle(
			new Request('http://absolute.local/rag/sync', {
				method: 'POST'
			})
		);
		expect(await allResponse.json()).toMatchObject({
			ok: true,
			sources: [
				{
					id: 'docs-folder',
					status: 'completed'
				}
			]
		});

		const opsResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const opsPayload = await opsResponse.json();

		expect(opsPayload.admin).toMatchObject({
			canListSyncSources: true,
			canSyncAllSources: true,
			canSyncSource: true
		});
		expect(opsPayload.syncSources).toMatchObject([
			{
				id: 'docs-folder',
				status: 'completed'
			}
		]);
		expect(
			opsPayload.adminActions.map(
				(entry: { action: string }) => entry.action
			)
		).toEqual(['sync_all_sources', 'sync_source']);
		expect(
			opsPayload.adminJobs.map(
				(entry: { action: string }) => entry.action
			)
		).toEqual(['sync_all_sources', 'sync_source']);
	});

	it('reports duplicate and coverage diagnostics in ops health', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const documents = [
			{
				chunkCount: 1,
				format: 'markdown' as const,
				id: 'dup-doc',
				kind: 'guide',
				metadata: {},
				source: 'docs/shared.md',
				text: 'tiny',
				title: ''
			},
			{
				chunkCount: 2,
				format: 'markdown' as const,
				id: 'dup-doc',
				kind: 'guide',
				metadata: { owner: 'docs' },
				source: 'docs/shared.md',
				text: 'This is a richer chunk preview for the duplicated guide.',
				title: 'Shared guide'
			},
			{
				chunkCount: 0,
				format: 'html' as const,
				id: 'missing-preview',
				kind: 'reference',
				metadata: { owner: 'docs' },
				source: '',
				text: '',
				title: 'Missing preview'
			}
		];
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					if (id === 'missing-preview') {
						return null;
					}

					const document = documents.find((entry) => entry.id === id);
					if (!document) {
						return null;
					}

					return {
						chunks:
							id === 'dup-doc'
								? [
										{ chunkId: `${id}:0`, text: 'tiny' },
										{
											chunkId: `${id}:1`,
											text: 'This is a richer chunk preview for the duplicated guide.'
										}
									]
								: [],
						document: {
							chunkCount: document.chunkCount,
							format: document.format,
							id: document.id,
							kind: document.kind,
							source: document.source,
							title: document.title
						},
						normalizedText: document.text
					};
				},
				listDocuments() {
					return documents;
				}
			},
			path: '/rag',
			ragStore: store,
			provider: () => {
				throw new Error('not used');
			}
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const payload = await response.json();

		expect(payload.health).toMatchObject({
			coverageByFormat: {
				html: 1,
				markdown: 2
			},
			coverageByKind: {
				guide: 2,
				reference: 1
			},
			documentsMissingCreatedAt: 3,
			documentsMissingMetadata: 1,
			documentsMissingSource: 1,
			documentsMissingTitle: 1,
			documentsMissingUpdatedAt: 3,
			documentsWithoutChunkPreview: 1,
			duplicateDocumentIdGroups: [{ count: 2, id: 'dup-doc' }],
			duplicateDocumentIds: ['dup-doc'],
			duplicateSourceGroups: [{ count: 2, source: 'docs/shared.md' }],
			duplicateSources: ['docs/shared.md'],
			emptyDocuments: 1,
			failedAdminJobs: 0,
			failedIngestJobs: 0,
			failuresByAdminAction: {},
			failuresByExtractor: {},
			failuresByInputKind: {},
			inspectedDocuments: 2
		});
		expect(payload.health.inspectedChunks).toBe(4);
		expect(payload.health.lowSignalChunks).toBeGreaterThanOrEqual(1);
		expect(payload.health.staleDocuments).toEqual([]);
	});

	it('exposes running admin jobs while long-running rebuild work is in flight', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		let releaseReseed: (() => void) | undefined;
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [];
				},
				reseed() {
					return new Promise<void>((resolve) => {
						releaseReseed = resolve;
					});
				}
			},
			path: '/rag',
			ragStore: store,
			provider: () => {
				throw new Error('not used');
			}
		});

		const reseedPromise = plugin.handle(
			new Request('http://absolute.local/rag/reseed', { method: 'POST' })
		);

		await Promise.resolve();

		const duringResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const duringPayload = await duringResponse.json();

		expect(duringPayload.adminJobs).toHaveLength(1);
		expect(duringPayload.adminJobs[0]).toMatchObject({
			action: 'reseed',
			status: 'running'
		});
		expect(duringPayload.adminActions).toEqual([]);

		releaseReseed?.();
		await reseedPromise;

		const afterResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const afterPayload = await afterResponse.json();

		expect(afterPayload.adminJobs[0]).toMatchObject({
			action: 'reseed',
			status: 'completed'
		});
		expect(afterPayload.adminActions[0]).toMatchObject({
			action: 'reseed',
			status: 'completed'
		});
	});

	it('reports stale documents and failure diagnostics in ops health', async () => {
		const now = Date.now();
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			extractors: [
				createRAGFileExtractor({
					name: 'failing_upload_extractor',
					extract: () => {
						throw new Error('extract failed');
					},
					supports: (input) => input.name === 'broken.mp3'
				})
			],
			indexManager: {
				getDocumentChunks(id) {
					if (id === 'stale-doc') {
						return {
							chunks: [
								{
									chunkId: 'stale-doc:0',
									text: 'A stale but valid chunk.'
								}
							],
							document: {
								chunkCount: 1,
								format: 'markdown',
								id: 'stale-doc',
								kind: 'guide',
								source: 'docs/stale.md',
								title: 'Stale doc'
							},
							normalizedText: 'A stale but valid chunk.'
						};
					}

					return null;
				},
				listDocuments() {
					return [
						{
							chunkCount: 1,
							createdAt: now - 1000 * 60 * 60 * 24 * 10,
							format: 'markdown' as const,
							id: 'stale-doc',
							kind: 'guide',
							metadata: { owner: 'docs' },
							source: 'docs/stale.md',
							title: 'Stale doc',
							updatedAt: now - 1000 * 60 * 60 * 24 * 10
						},
						{
							chunkCount: 1,
							createdAt: now - 1000 * 60 * 10,
							format: 'markdown' as const,
							id: 'fresh-doc',
							kind: 'guide',
							metadata: { owner: 'docs' },
							source: 'docs/fresh.md',
							title: 'Fresh doc',
							updatedAt: now - 1000 * 60 * 5
						}
					];
				},
				reindexSource() {
					throw new Error('reindex failed');
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store,
			staleAfterMs: 1000 * 60 * 60 * 24 * 7
		});

		await plugin.handle(
			new Request('http://absolute.local/rag/ingest', {
				body: JSON.stringify({
					uploads: [
						{
							content: Buffer.from([1, 2, 3, 4]).toString(
								'base64'
							),
							contentType: 'audio/mpeg',
							encoding: 'base64',
							name: 'broken.mp3'
						}
					]
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);

		await plugin.handle(
			new Request('http://absolute.local/rag/reindex/source', {
				body: JSON.stringify({ source: 'docs/stale.md' }),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const payload = await response.json();

		expect(payload.health).toMatchObject({
			failedAdminJobs: 1,
			failedIngestJobs: 1,
			failuresByAdminAction: {
				reindex_source: 1
			},
			failuresByExtractor: {
				failing_upload_extractor: 1
			},
			failuresByInputKind: {
				uploads: 1
			},
			staleAfterMs: 1000 * 60 * 60 * 24 * 7,
			staleDocuments: ['stale-doc']
		});
		expect(payload.health.oldestDocumentAgeMs).toBeGreaterThan(
			payload.health.newestDocumentAgeMs
		);
	});
});
