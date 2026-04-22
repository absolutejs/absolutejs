import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type {
	RAGJobState,
	RAGRetrievalBaselineStore
} from '../../../../types/ai';
import { ragChat } from '../../../../src/ai/rag/chat';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createSQLiteRAGStore } from '../../../../src/ai/rag/adapters/sqlite';
import { createRAGAccessControl } from '../../../../src/ai/rag/accessControl';
import { createRAGFileExtractor } from '../../../../src/ai/rag/ingestion';
import { createRAGFileJobStateStore } from '../../../../src/ai/rag/jobState';
import {
	createRAGFileEvaluationSuiteSnapshotHistoryStore,
	createRAGFileRetrievalComparisonHistoryStore
} from '../../../../src/ai/rag/quality';

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

	it('reports backend maintenance summaries in ops and status', async () => {
		const store = createSQLiteRAGStore({
			db: new Database(':memory:'),
			dimensions: 2,
			mockEmbedding: async () => [1, 0],
			native: {
				mode: 'vec0'
			}
		});
		const plugin = ragChat({
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		await store.upsert({
			chunks: [{ chunkId: 'sqlite-ops-a', text: 'alpha' }]
		});

		const analyzeResponse = await plugin.handle(
			new Request('http://absolute.local/rag/backend/analyze', {
				method: 'POST'
			})
		);
		expect(analyzeResponse.status).toBe(200);
		expect(await analyzeResponse.json()).toMatchObject({
			admin: {
				canAnalyzeBackend: true
			},
			maintenance: {
				backend: 'sqlite',
				recentActions: [
					{
						action: 'analyze_backend',
						status: 'completed'
					}
				]
			},
			ok: true,
			status: expect.any(String),
			workflowStatus: {
				backend: 'sqlite',
				native: {
					lastAnalyzeAt: expect.any(Number),
					lastHealthCheckAt: expect.any(Number),
					rowCount: 1
				}
			}
		});

		const opsResponse = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		expect(opsResponse.status).toBe(200);
		expect(await opsResponse.json()).toMatchObject({
			admin: {
				canAnalyzeBackend: true
			},
			maintenance: {
				activeJobs: [],
				backend: 'sqlite',
				recentActions: [
					{
						action: 'analyze_backend',
						status: 'completed'
					}
				],
				recommendations: [
					{
						code: 'native_backend_inactive',
						severity: 'error'
					}
				]
			},
			status: {
				backend: 'sqlite',
				native: {
					active: false,
					lastAnalyzeAt: expect.any(Number),
					lastHealthCheckAt: expect.any(Number),
					requested: true,
					rowCount: 1
				},
				vectorMode: 'json_fallback'
			}
		});

		const statusResponse = await plugin.handle(
			new Request('http://absolute.local/rag/status')
		);
		expect(statusResponse.status).toBe(200);
		expect(await statusResponse.json()).toMatchObject({
			admin: {
				canAnalyzeBackend: true
			},
			maintenance: {
				backend: 'sqlite',
				recommendations: [
					{
						code: 'native_backend_inactive',
						severity: 'error'
					}
				],
				recentActions: [
					{
						action: 'analyze_backend',
						status: 'completed'
					}
				]
			}
		});

		const maintenanceResponse = await plugin.handle(
			new Request('http://absolute.local/rag/status/maintenance')
		);
		expect(maintenanceResponse.status).toBe(200);
		expect(await maintenanceResponse.json()).toMatchObject({
			admin: {
				canAnalyzeBackend: true
			},
			maintenance: {
				backend: 'sqlite',
				recentActions: [
					{
						action: 'analyze_backend',
						status: 'completed'
					}
				]
			},
			ok: true,
			status: {
				backend: 'sqlite'
			}
		});
	});

	it('returns out-of-band maintenance updates for HTMX maintenance mutations', async () => {
		const store = createSQLiteRAGStore({
			db: new Database(':memory:'),
			dimensions: 2,
			mockEmbedding: async () => [1, 0],
			native: {
				mode: 'vec0'
			}
		});
		const plugin = ragChat({
			htmx: true,
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		await store.upsert({
			chunks: [{ chunkId: 'sqlite-htmx-a', text: 'alpha' }]
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/backend/analyze', {
				headers: {
					'HX-Request': 'true'
				},
				method: 'POST'
			})
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('HX-Trigger')).toBeNull();

		const html = await response.text();
		expect(html).toContain('backend analyze completed successfully');
		expect(html).toContain('id="rag-status-maintenance-panel"');
		expect(html).toContain('hx-swap-oob="outerHTML"');
		expect(html).toContain('Backend maintenance');
	});

	it('renders benchmark history and snapshot fragments for HTMX benchmark routes', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolutejs-rag-htmx-benchmarks-')
		);
		const plugin = ragChat({
			evaluationSuiteSnapshotHistoryStore:
				createRAGFileEvaluationSuiteSnapshotHistoryStore(
					join(tempDir, 'suite-snapshots.json')
				),
			htmx: true,
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: createInMemoryRAGStore({ dimensions: 2 }),
			retrievalComparisonHistoryStore:
				createRAGFileRetrievalComparisonHistoryStore(
					join(tempDir, 'retrieval-history.json')
				)
		});

		try {
			const historyResponse = await plugin.handle(
				new Request(
					'http://absolute.local/rag/compare/retrieval/benchmarks/adaptive-native-planner',
					{
						headers: {
							'HX-Request': 'true'
						}
					}
				)
			);

			expect(historyResponse.status).toBe(200);
			const historyHtml = await historyResponse.text();
			expect(historyHtml).toContain('Adaptive native planner benchmark');
			expect(historyHtml).toContain('No persisted benchmark runs yet.');
			expect(historyHtml).toContain('No saved suite snapshots yet.');

			const snapshotResponse = await plugin.handle(
				new Request(
					'http://absolute.local/rag/compare/retrieval/benchmarks/adaptive-native-planner/snapshots',
					{
						headers: {
							'HX-Request': 'true'
						},
						method: 'POST'
					}
				)
			);

			expect(snapshotResponse.status).toBe(200);
			const snapshotHtml = await snapshotResponse.text();
			expect(snapshotHtml).toContain('Adaptive native planner snapshots');
			expect(snapshotHtml).toContain('Latest snapshot');
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('tracks admin actions in the ops endpoint', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const documents: Array<{
			id: string;
			text: string;
			chunkCount?: number;
			source?: string;
			title?: string;
			format?:
				| 'text'
				| 'markdown'
				| 'html'
				| 'jsonl'
				| 'tsv'
				| 'csv'
				| 'xml'
				| 'yaml';
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

	it('denies mutating routes through authorizeRAGAction', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			authorizeRAGAction({ action }) {
				if (action === 'create_document') {
					return {
						allowed: false,
						reason: 'Document writes require admin role'
					};
				}

				return { allowed: true };
			},
			indexManager: {
				createDocument() {
					return { ok: true };
				},
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
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

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: 'Document writes require admin role',
			ok: false
		});
	});

	it('filters admin capabilities in ops through authorizeRAGAction', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			authorizeRAGAction({ action }) {
				return {
					allowed:
						action !== 'create_document' &&
						action !== 'manage_retrieval_admin' &&
						action !== 'reindex_document' &&
						action !== 'reset'
				};
			},
			indexManager: {
				createDocument() {
					return { ok: true };
				},
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [];
				},
				reindexDocument() {
					return { ok: true };
				},
				reset() {
					return { ok: true };
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			retrievalBaselineStore: {
				listBaselines() {
					return [];
				},
				saveBaseline() {}
			} satisfies RAGRetrievalBaselineStore,
			ragStore: store
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			admin: {
				canClearIndex: true,
				canCreateDocument: false,
				canDeleteDocument: false,
				canListSyncSources: false,
				canManageRetrievalBaselines: false,
				canPruneSearchTraces: false,
				canReindexDocument: false,
				canReindexSource: false,
				canReseed: false,
				canReset: false,
				canSyncAllSources: false,
				canSyncSource: false
			},
			ok: true
		});
	});

	it('denies retrieval admin mutations through authorizeRAGAction', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			authorizeRAGAction({ action }) {
				if (action === 'manage_retrieval_admin') {
					return {
						allowed: false,
						reason: 'Retrieval administration requires operator role'
					};
				}

				return { allowed: true };
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
			new Request(
				'http://absolute.local/rag/compare/retrieval/baselines/promote',
				{
					body: JSON.stringify({
						caseIds: ['case-1'],
						groupKey: 'ops'
					}),
					headers: {
						'Content-Type': 'application/json'
					},
					method: 'POST'
				}
			)
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: 'Retrieval administration requires operator role',
			ok: false
		});
	});

	it('applies request-scoped RAG access across documents, chunks, sync sources, and search', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		await store.upsert({
			chunks: [
				{
					chunkId: 'doc-1:001',
					text: 'Alpha workspace release checklist and billing policy.',
					metadata: {
						documentId: 'doc-1',
						workspace: 'alpha'
					},
					source: 'alpha/release.md',
					title: 'Alpha release'
				},
				{
					chunkId: 'doc-2:001',
					text: 'Beta workspace incident notes and rollout policy.',
					metadata: {
						documentId: 'doc-2',
						workspace: 'beta'
					},
					source: 'beta/incident.md',
					title: 'Beta incident'
				}
			]
		});

		const previews = new Map([
			[
				'doc-1',
				{
					chunks: [
						{
							chunkId: 'doc-1:001',
							text: 'Alpha workspace release checklist and billing policy.',
							metadata: {
								documentId: 'doc-1',
								workspace: 'alpha'
							},
							source: 'alpha/release.md',
							title: 'Alpha release'
						}
					],
					document: {
						id: 'doc-1',
						metadata: {
							workspace: 'alpha'
						},
						source: 'alpha/release.md',
						title: 'Alpha release'
					},
					normalizedText:
						'Alpha workspace release checklist and billing policy.'
				}
			],
			[
				'doc-2',
				{
					chunks: [
						{
							chunkId: 'doc-2:001',
							text: 'Beta workspace incident notes and rollout policy.',
							metadata: {
								documentId: 'doc-2',
								workspace: 'beta'
							},
							source: 'beta/incident.md',
							title: 'Beta incident'
						}
					],
					document: {
						id: 'doc-2',
						metadata: {
							workspace: 'beta'
						},
						source: 'beta/incident.md',
						title: 'Beta incident'
					},
					normalizedText:
						'Beta workspace incident notes and rollout policy.'
				}
			]
		]);

		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					return previews.get(id) ?? null;
				},
				listDocuments() {
					return [
						{
							id: 'doc-1',
							metadata: { workspace: 'alpha' },
							source: 'alpha/release.md',
							title: 'Alpha release'
						},
						{
							id: 'doc-2',
							metadata: { workspace: 'beta' },
							source: 'beta/incident.md',
							title: 'Beta incident'
						}
					];
				},
				listSyncSources() {
					return [
						{
							id: 'sync-alpha',
							kind: 'directory' as const,
							label: 'Alpha docs',
							status: 'idle' as const
						},
						{
							id: 'sync-beta',
							kind: 'directory' as const,
							label: 'Beta docs',
							status: 'idle' as const
						}
					];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store,
			resolveRAGAccessScope() {
				return {
					allowedDocumentIds: ['doc-1'],
					allowedSyncSourceIds: ['sync-alpha'],
					requiredMetadata: { workspace: 'alpha' }
				};
			}
		});

		const documentsResponse = await plugin.handle(
			new Request('http://absolute.local/rag/documents')
		);
		expect(documentsResponse.status).toBe(200);
		expect(await documentsResponse.json()).toMatchObject({
			documents: [{ id: 'doc-1', source: 'alpha/release.md' }],
			ok: true
		});

		const chunkResponse = await plugin.handle(
			new Request('http://absolute.local/rag/documents/doc-2/chunks')
		);
		expect(chunkResponse.status).toBe(404);

		const syncResponse = await plugin.handle(
			new Request('http://absolute.local/rag/sync')
		);
		expect(syncResponse.status).toBe(200);
		expect(await syncResponse.json()).toMatchObject({
			ok: true,
			sources: [{ id: 'sync-alpha' }]
		});

		const searchResponse = await plugin.handle(
			new Request('http://absolute.local/rag/search', {
				body: JSON.stringify({
					query: 'workspace policy',
					topK: 5
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);
		expect(await searchResponse.json()).toMatchObject({
			ok: true,
			results: [{ chunkId: 'doc-1:001', source: 'alpha/release.md' }]
		});
	});

	it('applies request-scoped comparison group access to retrieval evaluation routes', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		await store.upsert({
			chunks: [
				{
					chunkId: 'doc-1:001',
					metadata: { documentId: 'doc-1', workspace: 'alpha' },
					source: 'alpha/release.md',
					text: 'Alpha workspace release checklist.',
					title: 'Alpha release'
				}
			]
		});

		const plugin = ragChat({
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store,
			resolveRAGAccessScope() {
				return {
					allowedComparisonGroupKeys: ['alpha-group'],
					requiredMetadata: { workspace: 'alpha' }
				};
			}
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/compare/retrieval', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['doc-1'],
							id: 'case-1',
							query: 'alpha release'
						}
					],
					groupKey: 'beta-group',
					retrievals: [{ id: 'vector' }]
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'Retrieval comparison group is outside the allowed RAG access scope',
			ok: false
		});
	});

	it('applies request-scoped corpus access independently of metadata and source rules', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		await store.upsert({
			chunks: [
				{
					chunkId: 'doc-alpha:001',
					corpusKey: 'alpha',
					metadata: {
						corpusKey: 'alpha',
						documentId: 'doc-alpha',
						workspace: 'shared'
					},
					source: 'shared/policy.md',
					text: 'Alpha corpus billing policy and release checklist.',
					title: 'Shared policy'
				},
				{
					chunkId: 'doc-beta:001',
					corpusKey: 'beta',
					metadata: {
						corpusKey: 'beta',
						documentId: 'doc-beta',
						workspace: 'shared'
					},
					source: 'shared/policy.md',
					text: 'Beta corpus incident playbook and rollout notes.',
					title: 'Shared policy'
				}
			]
		});

		const previews = new Map([
			[
				'doc-alpha',
				{
					chunks: [
						{
							chunkId: 'doc-alpha:001',
							corpusKey: 'alpha',
							metadata: {
								corpusKey: 'alpha',
								documentId: 'doc-alpha',
								workspace: 'shared'
							},
							source: 'shared/policy.md',
							text: 'Alpha corpus billing policy and release checklist.',
							title: 'Shared policy'
						}
					],
					document: {
						corpusKey: 'alpha',
						id: 'doc-alpha',
						metadata: {
							corpusKey: 'alpha',
							workspace: 'shared'
						},
						source: 'shared/policy.md',
						title: 'Shared policy'
					},
					normalizedText:
						'Alpha corpus billing policy and release checklist.'
				}
			],
			[
				'doc-beta',
				{
					chunks: [
						{
							chunkId: 'doc-beta:001',
							corpusKey: 'beta',
							metadata: {
								corpusKey: 'beta',
								documentId: 'doc-beta',
								workspace: 'shared'
							},
							source: 'shared/policy.md',
							text: 'Beta corpus incident playbook and rollout notes.',
							title: 'Shared policy'
						}
					],
					document: {
						corpusKey: 'beta',
						id: 'doc-beta',
						metadata: {
							corpusKey: 'beta',
							workspace: 'shared'
						},
						source: 'shared/policy.md',
						title: 'Shared policy'
					},
					normalizedText:
						'Beta corpus incident playbook and rollout notes.'
				}
			]
		]);

		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					return previews.get(id) ?? null;
				},
				listDocuments() {
					return [
						{
							corpusKey: 'alpha',
							id: 'doc-alpha',
							metadata: {
								corpusKey: 'alpha',
								workspace: 'shared'
							},
							source: 'shared/policy.md',
							title: 'Shared policy'
						},
						{
							corpusKey: 'beta',
							id: 'doc-beta',
							metadata: {
								corpusKey: 'beta',
								workspace: 'shared'
							},
							source: 'shared/policy.md',
							title: 'Shared policy'
						}
					];
				},
				listSyncSources() {
					return [];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store,
			resolveRAGAccessScope() {
				return {
					allowedCorpusKeys: ['alpha']
				};
			}
		});

		const documentsResponse = await plugin.handle(
			new Request('http://absolute.local/rag/documents')
		);
		expect(documentsResponse.status).toBe(200);
		expect(await documentsResponse.json()).toMatchObject({
			documents: [{ id: 'doc-alpha', source: 'shared/policy.md' }],
			ok: true
		});

		const chunkResponse = await plugin.handle(
			new Request('http://absolute.local/rag/documents/doc-beta/chunks')
		);
		expect(chunkResponse.status).toBe(404);

		const searchResponse = await plugin.handle(
			new Request('http://absolute.local/rag/search', {
				body: JSON.stringify({
					query: 'policy',
					topK: 5
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);
		expect(await searchResponse.json()).toMatchObject({
			ok: true,
			results: [{ chunkId: 'doc-alpha:001', source: 'shared/policy.md' }]
		});
	});

	it('reports corpus keys in ops inspection samples and counts', async () => {
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					if (id === 'doc-alpha') {
						return {
							chunks: [
								{
									chunkId: 'doc-alpha:001',
									corpusKey: 'alpha',
									metadata: {
										corpusKey: 'alpha',
										documentId: 'doc-alpha'
									},
									source: 'shared/policy.md',
									text: 'Alpha shared policy.',
									title: 'Shared policy'
								}
							],
							document: {
								corpusKey: 'alpha',
								id: 'doc-alpha',
								metadata: { corpusKey: 'alpha' },
								source: 'shared/policy.md',
								title: 'Shared policy'
							},
							normalizedText: 'Alpha shared policy.'
						};
					}

					return {
						chunks: [
							{
								chunkId: 'doc-beta:001',
								corpusKey: 'beta',
								metadata: {
									corpusKey: 'beta',
									documentId: 'doc-beta'
								},
								source: 'shared/policy.md',
								text: 'Beta shared policy.',
								title: 'Shared policy'
							}
						],
						document: {
							corpusKey: 'beta',
							id: 'doc-beta',
							metadata: { corpusKey: 'beta' },
							source: 'shared/policy.md',
							title: 'Shared policy'
						},
						normalizedText: 'Beta shared policy.'
					};
				},
				listDocuments() {
					return [
						{
							chunkCount: 1,
							corpusKey: 'alpha',
							id: 'doc-alpha',
							metadata: { corpusKey: 'alpha' },
							source: 'shared/policy.md',
							title: 'Shared policy'
						},
						{
							chunkCount: 1,
							corpusKey: 'beta',
							id: 'doc-beta',
							metadata: { corpusKey: 'beta' },
							source: 'shared/policy.md',
							title: 'Shared policy'
						}
					];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			}
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/ops')
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			health: {
				inspection: {
					corpusKeys: {
						alpha: 2,
						beta: 2
					},
					sampleChunks: [
						{ chunkId: 'doc-alpha:001', corpusKey: 'alpha' },
						{ chunkId: 'doc-beta:001', corpusKey: 'beta' }
					],
					sampleDocuments: [
						{ corpusKey: 'alpha', id: 'doc-alpha' },
						{ corpusKey: 'beta', id: 'doc-beta' }
					]
				}
			},
			ok: true
		});
	});

	it('composes authorization and scope from one resolved request context', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		let resolveCount = 0;
		await store.upsert({
			chunks: [
				{
					chunkId: 'doc-1:001',
					metadata: { workspace: 'alpha' },
					source: 'alpha/release.md',
					text: 'Alpha workspace release checklist.',
					title: 'Alpha release'
				},
				{
					chunkId: 'doc-2:001',
					metadata: { workspace: 'beta' },
					source: 'beta/release.md',
					text: 'Beta workspace release checklist.',
					title: 'Beta release'
				}
			]
		});

		const accessControl = createRAGAccessControl<{
			role: string;
			workspace: string;
		}>({
			authorize({ action, context }) {
				if (action === 'create_document' && context?.role !== 'admin') {
					return {
						allowed: false,
						reason: 'Admin role required for document writes'
					};
				}

				return { allowed: true };
			},
			resolveContext(request) {
				resolveCount += 1;
				return {
					role: request.headers.get('x-role') ?? 'viewer',
					workspace: request.headers.get('x-workspace') ?? 'alpha'
				};
			},
			resolveScope({ context }) {
				return {
					requiredMetadata: {
						workspace: context?.workspace ?? 'alpha'
					}
				};
			}
		});

		const plugin = ragChat({
			...accessControl,
			indexManager: {
				createDocument() {
					return { ok: true };
				},
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const searchResponse = await plugin.handle(
			new Request('http://absolute.local/rag/search', {
				body: JSON.stringify({
					query: 'workspace release',
					topK: 5
				}),
				headers: {
					'Content-Type': 'application/json',
					'x-role': 'viewer',
					'x-workspace': 'alpha'
				},
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);
		expect(await searchResponse.json()).toMatchObject({
			ok: true,
			results: [{ chunkId: 'doc-1:001' }]
		});

		const deniedWrite = await plugin.handle(
			new Request('http://absolute.local/rag/documents', {
				body: JSON.stringify({
					id: 'doc-3',
					metadata: { workspace: 'alpha' },
					source: 'alpha/new.md',
					text: 'New alpha document'
				}),
				headers: {
					'Content-Type': 'application/json',
					'x-role': 'viewer',
					'x-workspace': 'alpha'
				},
				method: 'POST'
			})
		);
		expect(deniedWrite.status).toBe(403);
		expect(await deniedWrite.json()).toEqual({
			error: 'Admin role required for document writes',
			ok: false
		});

		expect(resolveCount).toBe(2);
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
				metadata: {
					chunkingProfile: 'markdown-source-aware',
					extractorRegistryMatch: 'markdown-registry-override',
					owner: 'docs'
				},
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
											metadata: {
												chunkingProfile:
													'markdown-source-aware',
												extractorRegistryMatch:
													'markdown-registry-override',
												ocrEngine: 'demo_pdf_ocr',
												ocrRegionConfidence: 0.91,
												pageNumber: 4,
												regionNumber: 1,
												sourceNativeKind: 'pdf_region'
											},
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
		expect(payload.health.inspection).toMatchObject({
			chunkingProfiles: {
				'markdown-source-aware': 3
			},
			chunksWithSourceLabels: 2,
			documentsWithSourceLabels: 1,
			extractorRegistryMatches: {
				'markdown-registry-override': 3
			},
			sourceNativeKinds: {
				pdf_region: 2
			}
		});
		expect(payload.health.inspection.sampleDocuments[0]).toMatchObject({
			chunkingProfile: 'markdown-source-aware',
			extractorRegistryMatch: 'markdown-registry-override',
			id: 'dup-doc',
			labels: {
				provenanceLabel:
					'Extractor markdown-registry-override · Chunking markdown-source-aware'
			}
		});
		expect(payload.health.inspection.sampleChunks[0]).toMatchObject({
			chunkId: 'dup-doc:1',
			documentId: 'dup-doc',
			chunkingProfile: 'markdown-source-aware',
			extractorRegistryMatch: 'markdown-registry-override',
			labels: {
				locatorLabel: 'Page 4 · Region 1',
				provenanceLabel:
					'OCR demo_pdf_ocr · Extractor markdown-registry-override · Chunking markdown-source-aware · Confidence 0.91'
			},
			sourceNativeKind: 'pdf_region'
		});
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

	it('persists ingest and admin jobs and recovers interrupted running jobs', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		let persistedState: Partial<RAGJobState> | undefined;
		const jobStateStore = {
			load() {
				return persistedState;
			},
			save(state: RAGJobState) {
				persistedState = JSON.parse(
					JSON.stringify(state)
				) as typeof persistedState;
			}
		};
		let releaseReseed: (() => void) | undefined;
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
			jobStateStore,
			path: '/rag',
			ragStore: store,
			provider: () => {
				throw new Error('not used');
			}
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

		const clearIndexResponse = await plugin.handle(
			new Request('http://absolute.local/rag/index', {
				method: 'DELETE'
			})
		);
		expect(clearIndexResponse.status).toBe(200);

		const reseedPromise = plugin.handle(
			new Request('http://absolute.local/rag/reseed', { method: 'POST' })
		);

		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const recoveredPlugin = ragChat({
			jobStateStore,
			path: '/rag',
			ragStore: store,
			provider: () => {
				throw new Error('not used');
			}
		});
		const opsResponse = await recoveredPlugin.handle(
			new Request('http://absolute.local/rag/ops')
		);
		const payload = await opsResponse.json();

		expect(payload.ingestJobs[0]).toMatchObject({
			extractorNames: ['test_upload_audio'],
			inputKind: 'uploads',
			status: 'completed'
		});
		expect(payload.adminActions[0]).toMatchObject({
			action: 'clear_index',
			status: 'completed'
		});
		expect(
			payload.adminJobs.find(
				(job: { action?: string; status?: string }) =>
					job.action === 'reseed' && job.status === 'failed'
			)
		).toMatchObject({
			action: 'reseed',
			error: 'Interrupted before completion during recovery',
			status: 'failed'
		});

		releaseReseed?.();
		await reseedPromise;
	});

	it('applies bounded retention to persisted admin and ingest history', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const documents: Array<{ id: string }> = [];
		let persistedState: Partial<RAGJobState> | undefined;
		const jobStateStore = {
			load() {
				return persistedState;
			},
			save(state: RAGJobState) {
				persistedState = JSON.parse(
					JSON.stringify(state)
				) as typeof persistedState;
			}
		};
		const plugin = ragChat({
			indexManager: {
				createDocument(input) {
					documents.push({ id: input.id ?? 'doc' });
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
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [];
				}
			},
			jobHistoryRetention: {
				maxAdminActions: 1,
				maxAdminJobs: 1,
				maxIngestJobs: 1,
				maxSyncJobs: 1
			},
			jobStateStore,
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
					source: 'docs/one.md',
					text: 'one',
					title: 'One'
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/documents/doc-1', {
				method: 'DELETE'
			})
		);
		await plugin.handle(
			new Request('http://absolute.local/rag/ingest', {
				body: JSON.stringify({
					documents: [
						{
							id: 'doc-1',
							source: 'docs/one.md',
							text: 'one',
							title: 'One'
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
			new Request('http://absolute.local/rag/ingest', {
				body: JSON.stringify({
					documents: [
						{
							id: 'doc-2',
							source: 'docs/two.md',
							text: 'two',
							title: 'Two'
						}
					]
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
		);

		expect(persistedState?.adminActions).toHaveLength(1);
		expect(persistedState?.adminJobs).toHaveLength(1);
		expect(persistedState?.ingestJobs).toHaveLength(1);
		expect(persistedState?.adminActions?.[0]).toMatchObject({
			action: 'delete_document'
		});
		expect(persistedState?.adminJobs?.[0]).toMatchObject({
			action: 'delete_document'
		});
		expect(persistedState?.ingestJobs?.[0]).toMatchObject({
			inputKind: 'documents',
			requestedCount: 1
		});
	});

	it('tolerates corrupted persisted job state files', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-job-state-corrupt-')
		);
		const jobStatePath = join(tempDir, 'job-state.json');
		const store = createInMemoryRAGStore({ dimensions: 8 });

		try {
			writeFileSync(jobStatePath, '{ not valid json', 'utf8');
			const plugin = ragChat({
				jobStateStore: createRAGFileJobStateStore(jobStatePath),
				path: '/rag',
				ragStore: store,
				provider: () => {
					throw new Error('not used');
				}
			});

			const opsResponse = await plugin.handle(
				new Request('http://absolute.local/rag/ops')
			);
			const payload = await opsResponse.json();

			expect(payload.adminActions).toEqual([]);
			expect(payload.adminJobs).toEqual([]);
			expect(payload.ingestJobs).toEqual([]);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
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

	it('enriches document chunk previews with source labels from extractor metadata', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					if (id !== 'pdf-region-doc') {
						return null;
					}

					return {
						chunks: [
							{
								chunkId: 'pdf-region-doc:001',
								metadata: {
									ocrEngine: 'demo_pdf_ocr',
									ocrRegionConfidence: 0.91,
									pageNumber: 7,
									regionNumber: 2,
									sourceNativeKind: 'pdf_region'
								},
								source: 'fixtures/scan.pdf',
								text: 'Region text for citation.',
								title: 'OCR scan'
							}
						],
						document: {
							format: 'text',
							id: 'pdf-region-doc',
							kind: 'report',
							metadata: {
								ocrEngine: 'demo_pdf_ocr',
								pageNumber: 7,
								pdfTextMode: 'ocr',
								sourceNativeKind: 'pdf_page'
							},
							source: 'fixtures/scan.pdf',
							title: 'OCR scan'
						},
						normalizedText: 'Region text for citation.'
					};
				},
				listDocuments() {
					return [];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
			new Request(
				'http://absolute.local/rag/documents/pdf-region-doc/chunks'
			)
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.ok).toBe(true);
		expect(payload.document.labels).toMatchObject({
			contextLabel: 'OCR page 7',
			locatorLabel: 'Page 7',
			provenanceLabel: 'PDF ocr · OCR demo_pdf_ocr'
		});
		expect(payload.chunks[0].labels).toMatchObject({
			contextLabel: 'OCR page 7 region 2',
			locatorLabel: 'Page 7 · Region 2',
			provenanceLabel: 'OCR demo_pdf_ocr · Confidence 0.91'
		});
		expect(payload.chunks[0].structure).toBeUndefined();
	});

	it('enriches chunk previews with section and adjacency structure', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					if (id !== 'section-doc') {
						return null;
					}

					return {
						chunks: [
							{
								chunkId: 'section-doc:002',
								metadata: {
									nextChunkId: 'section-doc:003',
									previousChunkId: 'section-doc:001',
									sectionChunkCount: 3,
									sectionChunkId:
										'section-doc:section:stable-blockers',
									sectionChunkIndex: 1,
									sectionDepth: 2,
									sectionKind: 'html_heading',
									sectionPath: [
										'Release Ops Overview',
										'Stable blockers'
									],
									sectionTitle: 'Stable blockers'
								},
								source: 'docs/release.html',
								text: 'Stable blockers stay explicit.',
								title: 'docs-release-html · Stable blockers'
							}
						],
						document: {
							format: 'html',
							id: 'section-doc',
							kind: 'guide',
							metadata: {},
							source: 'docs/release.html',
							title: 'Release guide'
						},
						normalizedText: 'Stable blockers stay explicit.'
					};
				},
				listDocuments() {
					return [];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
			new Request(
				'http://absolute.local/rag/documents/section-doc/chunks'
			)
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.ok).toBe(true);
		expect(payload.chunks[0].structure).toMatchObject({
			section: {
				depth: 2,
				kind: 'html_heading',
				path: ['Release Ops Overview', 'Stable blockers'],
				title: 'Stable blockers'
			},
			sequence: {
				nextChunkId: 'section-doc:003',
				previousChunkId: 'section-doc:001',
				sectionChunkCount: 3,
				sectionChunkId: 'section-doc:section:stable-blockers',
				sectionChunkIndex: 1
			}
		});
		expect(payload.chunks[0].excerpts).toMatchObject({
			chunkExcerpt: 'Stable blockers stay explicit.',
			sectionExcerpt: 'Stable blockers stay explicit.',
			windowExcerpt: 'Stable blockers stay explicit.'
		});
		expect(payload.chunks[0].excerptSelection).toMatchObject({
			mode: 'section',
			reason: 'section_small_enough'
		});
	});

	it('enriches chunk previews with block-aware pdf labels and structure', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks(id) {
					if (id !== 'pdf-block-doc') {
						return null;
					}

					return {
						chunks: [
							{
								chunkId: 'pdf-block-doc:002',
								metadata: {
									pageNumber: 2,
									pdfBlockNumber: 3,
									pdfTextKind: 'table_like',
									pdfTextMode: 'native',
									sectionKind: 'pdf_block',
									sectionPath: ['Page 2 Table Block'],
									sectionTitle: 'Page 2 Table Block'
								},
								source: 'docs/report.pdf',
								text: 'Metric | Status',
								title: 'report-pdf · Page 2 Table Block'
							}
						],
						document: {
							format: 'text',
							id: 'pdf-block-doc',
							kind: 'report',
							metadata: {},
							source: 'docs/report.pdf',
							title: 'Report'
						},
						normalizedText: 'Metric | Status'
					};
				},
				listDocuments() {
					return [];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
			new Request(
				'http://absolute.local/rag/documents/pdf-block-doc/chunks'
			)
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.ok).toBe(true);
		expect(payload.chunks[0].labels).toMatchObject({
			contextLabel: 'PDF table block Page 2 Table Block',
			locatorLabel: 'Page 2 · Table Block 3',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Page 2 Table Block'
		});
		expect(payload.chunks[0].structure).toMatchObject({
			section: {
				kind: 'pdf_block',
				path: ['Page 2 Table Block'],
				title: 'Page 2 Table Block'
			}
		});
	});

	it('enriches document listings with source labels from extractor metadata', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const plugin = ragChat({
			indexManager: {
				getDocumentChunks() {
					return null;
				},
				listDocuments() {
					return [
						{
							chunkCount: 1,
							format: 'text' as const,
							id: 'sheet-doc',
							kind: 'report',
							metadata: {
								sheetName: 'Regional Growth',
								sourceNativeKind: 'spreadsheet_sheet'
							},
							source: 'fixtures/workbook.xlsx',
							title: 'Workbook sheet'
						}
					];
				}
			},
			path: '/rag',
			provider: () => {
				throw new Error('not used');
			},
			ragStore: store
		});

		const response = await plugin.handle(
			new Request('http://absolute.local/rag/documents')
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.ok).toBe(true);
		expect(payload.documents[0].labels).toMatchObject({
			contextLabel: 'Sheet Regional Growth',
			locatorLabel: 'Sheet Regional Growth'
		});
	});
});
