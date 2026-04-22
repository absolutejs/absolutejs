import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, mock } from 'bun:test';
import type { RAGSyncSourceReconciliationSummary } from '../../../../types/ai';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createRAGCollection } from '../../../../src/ai/rag/collection';
import {
	createRAGChunkingRegistry,
	createRAGFileExtractor,
	createRAGFileExtractorRegistry,
	loadRAGDocumentsFromDirectory,
	prepareRAGDocuments
} from '../../../../src/ai/rag/ingestion';
import {
	createRAGStorageSyncSource,
	createRAGDirectorySyncSource,
	createRAGEmailSyncSource,
	createRAGFeedSyncSource,
	createRAGGitHubSyncSource,
	createRAGSitemapSyncSource,
	createRAGFileSyncStateStore,
	createRAGSiteDiscoverySyncSource,
	previewRAGSyncConflictResolutions,
	previewRAGSyncExtractionRecovery,
	createRAGStaticEmailSyncClient,
	resolveRAGSyncExtractionRecovery,
	resolveRAGSyncConflictResolutions,
	createRAGSyncManager,
	createRAGSyncScheduler,
	createRAGUrlSyncSource
} from '../../../../src/ai/rag/sync';
import { createRAGFileJobStateStore } from '../../../../src/ai/rag/jobState';

const createMockFetch = (response: Response): typeof fetch =>
	Object.assign(
		(..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
			Promise.resolve(response.clone()),
		{ preconnect: fetch.preconnect }
	) as typeof fetch;

const createMockFetchMap = (
	responses: Record<string, Response>
): typeof fetch =>
	Object.assign(
		(input: Parameters<typeof fetch>[0]): ReturnType<typeof fetch> => {
			const url = String(input);
			const response = responses[url];
			if (!response) {
				return Promise.reject(new Error(`Unhandled fetch for ${url}`));
			}
			return Promise.resolve(response.clone());
		},
		{ preconnect: fetch.preconnect }
	) as typeof fetch;

describe('RAG sync helpers', () => {
	it('syncs directory sources into a collection and tracks completed state', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-sync-'));
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync keeps retrieval aligned.'
			);

			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			expect(await syncManager.listSyncSources?.()).toMatchObject([
				{
					id: 'docs-folder',
					status: 'idle'
				}
			]);

			const response = await syncManager.syncSource?.('docs-folder');
			expect(response).toMatchObject({
				ok: true,
				source: {
					chunkCount: 1,
					documentCount: 1,
					id: 'docs-folder',
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'directory sync retrieval',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('guide.md');
			expect((await syncManager.listSyncSources?.())?.[0]).toMatchObject({
				id: 'docs-folder',
				status: 'completed'
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('threads extractor and chunking registries through directory sync sources', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-registry-')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const extractorRegistry = createRAGFileExtractorRegistry([
			{
				extensions: ['.note'],
				extractor: createRAGFileExtractor({
					name: 'demo_note_sync_extractor',
					supports: () => true,
					extract: (input) => ({
						format: 'markdown',
						source: input.source ?? input.path ?? input.name,
						text: '# Alpha\n\nRegistry-managed sync text.\n\n## Beta\n\nChunk through the registry.',
						title: 'sync-note'
					})
				}),
				priority: 10
			}
		]);
		const chunkingRegistry = createRAGChunkingRegistry([
			{
				formats: ['markdown'],
				profile: {
					options: {
						maxChunkLength: 48,
						strategy: 'source_aware'
					}
				},
				priority: 10
			}
		]);

		try {
			writeFileSync(join(tempDir, 'custom.note'), 'ignored', 'utf8');

			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGDirectorySyncSource({
						chunkingRegistry,
						directory: tempDir,
						extractorRegistry,
						id: 'registry-folder',
						label: 'Registry folder'
					})
				]
			});

			const response = await syncManager.syncSource?.('registry-folder');
			expect(response).toMatchObject({
				ok: true,
				source: {
					chunkCount: 2,
					documentCount: 1,
					id: 'registry-folder',
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'chunk through the registry',
				retrieval: 'hybrid',
				topK: 3
			});
			const sectionedHit = hits.find(
				(hit) => hit.metadata?.sectionKind === 'markdown_heading'
			);

			expect(hits[0]?.source).toBe('custom.note');
			expect(hits[0]?.metadata?.extractor).toBe(
				'demo_note_sync_extractor'
			);
			expect(sectionedHit?.metadata?.sectionTitle).toBeDefined();
			expect(sectionedHit?.metadata?.sectionKind).toBe(
				'markdown_heading'
			);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('skips unsupported directory files and emits extractor guidance', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-extraction-skip-')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync keeps supported files searchable.'
			);
			writeFileSync(join(tempDir, 'raw.bin'), 'binary-ish');

			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						extractors: [
							createRAGFileExtractor({
								name: 'missing_bin_extractor',
								supports: (input) =>
									String(
										input.path ?? input.source ?? ''
									).endsWith('.bin'),
								extract() {
									throw new Error(
										'No RAG file extractor matched raw.bin. Register a custom extractor for this file type.'
									);
								}
							})
						],
						id: 'docs-folder',
						includeExtensions: ['.md', '.bin'],
						label: 'Docs folder'
					})
				]
			});

			const response = await syncManager.syncSource?.('docs-folder');
			expect(response).toMatchObject({
				ok: true,
				source: {
					diagnostics: {
						entries: expect.arrayContaining([
							expect.objectContaining({
								code: 'extraction_failures_detected'
							}),
							expect.objectContaining({
								code: 'extractor_missing'
							})
						]),
						extractionFailures: [
							expect.objectContaining({
								itemKind: 'directory_file',
								itemLabel: 'raw.bin',
								remediation: 'configure_extractor'
							})
						],
						retryGuidance: {
							action: 'configure_extractor'
						}
					},
					documentCount: 1,
					id: 'docs-folder',
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'supported files searchable',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('guide.md');
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('reconciles removed directory documents through list/delete hooks', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-reconcile-')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const deletedIds: string[] = [];

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync keeps retrieval aligned.'
			);

			const syncManager = createRAGSyncManager({
				collection,
				deleteDocument(id) {
					deletedIds.push(id);

					return true;
				},
				listDocuments() {
					return [
						{
							id: 'guide-md',
							metadata: {
								syncFingerprint: 'old-hash',
								syncKey: 'guide.md',
								syncSourceId: 'docs-folder'
							},
							source: 'guide.md',
							title: 'guide-md'
						},
						{
							id: 'stale-md',
							metadata: {
								syncFingerprint: 'stale-hash',
								syncKey: 'stale.md',
								syncSourceId: 'docs-folder'
							},
							source: 'stale.md',
							title: 'stale-md'
						}
					];
				},
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			const response = await syncManager.syncSource?.('docs-folder');
			expect(response).toMatchObject({
				ok: true,
				source: {
					id: 'docs-folder',
					reconciliation: {
						refreshMode: 'targeted',
						refreshedDocumentIds: ['guide-md'],
						refreshedSyncKeys: ['guide.md'],
						staleDocumentIds: ['stale-md'],
						staleSyncKeys: ['stale.md'],
						targetedRefreshSyncKeys: ['stale.md', 'guide.md'],
						unchangedDocumentIds: [],
						unchangedSyncKeys: []
					},
					status: 'completed'
				}
			});
			expect(deletedIds).toEqual(['stale-md']);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('persists targeted refresh and noop reconciliation summaries on sync source records', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-targeted-refresh-')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync keeps retrieval aligned.'
			);

			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			const first = await syncManager.syncSource?.('docs-folder');
			expect(first).toMatchObject({
				ok: true,
				source: {
					id: 'docs-folder',
					reconciliation: {
						refreshMode: 'targeted',
						refreshedDocumentIds: ['guide-md'],
						refreshedSyncKeys: ['guide.md'],
						staleDocumentIds: [],
						staleSyncKeys: [],
						targetedRefreshSyncKeys: ['guide.md'],
						unchangedDocumentIds: [],
						unchangedSyncKeys: []
					},
					status: 'completed'
				}
			});

			const loaded = await loadRAGDocumentsFromDirectory({
				directory: tempDir
			});
			const prepared = prepareRAGDocuments({
				documents: loaded.documents.map((document) => ({
					...document,
					metadata: {
						...(document.metadata ?? {}),
						syncFingerprint: '',
						syncKey:
							typeof document.metadata?.relativePath === 'string'
								? document.metadata.relativePath
								: (document.source ?? document.title ?? ''),
						syncSourceId: 'docs-folder'
					}
				}))
			});
			const preparedGuide = prepared[0]!;
			const syncFingerprint = createHash('sha1')
				.update(loaded.documents[0]?.source ?? '')
				.update('\n')
				.update(loaded.documents[0]?.title ?? '')
				.update('\n')
				.update(loaded.documents[0]?.text ?? '')
				.digest('hex');
			const noopSyncManager = createRAGSyncManager({
				collection,
				listDocuments() {
					return [
						{
							id: preparedGuide.documentId,
							metadata: {
								syncFingerprint,
								syncKey: 'guide.md',
								syncSourceId: 'docs-folder'
							},
							source: loaded.documents[0]?.source ?? 'guide.md',
							title: loaded.documents[0]?.title ?? 'Guide'
						}
					];
				},
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			const second = await noopSyncManager.syncSource?.('docs-folder');
			expect(second).toMatchObject({
				ok: true,
				source: {
					id: 'docs-folder',
					reconciliation: {
						refreshMode: 'noop',
						refreshedDocumentIds: [],
						refreshedSyncKeys: [],
						staleDocumentIds: [],
						staleSyncKeys: [],
						targetedRefreshSyncKeys: [],
						unchangedDocumentIds: [preparedGuide.documentId],
						unchangedSyncKeys: ['guide.md']
					},
					status: 'completed'
				}
			});

			expect(await noopSyncManager.listSyncSources?.()).toMatchObject([
				{
					id: 'docs-folder',
					reconciliation: {
						refreshMode: 'noop',
						unchangedDocumentIds: [preparedGuide.documentId],
						unchangedSyncKeys: ['guide.md']
					},
					status: 'completed'
				}
			]);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('stamps refreshed sync documents with version lineage metadata', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-lineage-')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync now carries explicit version lineage.'
			);

			const previousFingerprint = createHash('sha1')
				.update('guide.md')
				.update('\n')
				.update('Guide')
				.update('\n')
				.update('# Guide\n\nOlder directory sync content.')
				.digest('hex');
			const previousLineageId = 'docs-folder:guide.md';
			const previousVersionId = `${previousLineageId}:${previousFingerprint}`;

			const syncManager = createRAGSyncManager({
				collection,
				listDocuments() {
					return [
						{
							id: 'guide-md',
							metadata: {
								syncFingerprint: previousFingerprint,
								syncKey: 'guide.md',
								syncLineageId: previousLineageId,
								syncSourceId: 'docs-folder',
								syncVersionId: previousVersionId,
								syncVersionNumber: 2
							},
							source: 'guide.md',
							title: 'Guide'
						}
					];
				},
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			const response = await syncManager.syncSource?.('docs-folder');
			expect(response).toMatchObject({
				ok: true,
				source: {
					id: 'docs-folder',
					reconciliation: {
						refreshMode: 'targeted',
						refreshedSyncKeys: ['guide.md']
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'explicit version lineage',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.metadata?.syncLineageId).toBe(previousLineageId);
			expect(hits[0]?.metadata?.syncVersionNumber).toBe(3);
			expect(hits[0]?.metadata?.syncPreviousVersionId).toBe(
				previousVersionId
			);
			expect(hits[0]?.metadata?.syncPreviousDocumentId).toBe('guide-md');
			expect(hits[0]?.metadata?.syncVersionId).not.toBe(
				previousVersionId
			);
			expect(hits[0]?.metadata?.syncIsLatestVersion).toBe(true);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('surfaces duplicate sync-key and lineage conflicts in reconciliation summaries', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-conflicts-')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync conflict visibility matters.'
			);

			const syncManager = createRAGSyncManager({
				collection,
				listDocuments() {
					return [
						{
							id: 'guide-md-v2a',
							metadata: {
								syncFingerprint: 'fp-a',
								syncIsLatestVersion: true,
								syncKey: 'guide.md',
								syncLineageId: 'docs-folder:guide.md',
								syncSourceId: 'docs-folder',
								syncVersionId: 'docs-folder:guide.md:fp-a',
								syncVersionNumber: 2
							},
							source: 'guide.md',
							title: 'Guide'
						},
						{
							id: 'guide-md-v2b',
							metadata: {
								syncFingerprint: 'fp-b',
								syncIsLatestVersion: true,
								syncKey: 'guide.md',
								syncLineageId: 'docs-folder:guide.md-alt',
								syncSourceId: 'docs-folder',
								syncVersionId: 'docs-folder:guide.md-alt:fp-b',
								syncVersionNumber: 2
							},
							source: 'guide.md',
							title: 'Guide'
						}
					];
				},
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			const response = await syncManager.syncSource?.('docs-folder');
			expect(response).toMatchObject({
				ok: true,
				source: {
					id: 'docs-folder',
					reconciliation: {
						duplicateSyncKeyGroups: [
							{
								count: 2,
								documentIds: ['guide-md-v2a', 'guide-md-v2b'],
								syncKey: 'guide.md'
							}
						],
						lineageConflicts: [
							{
								documentIds: ['guide-md-v2a', 'guide-md-v2b'],
								latestDocumentIds: [
									'guide-md-v2a',
									'guide-md-v2b'
								],
								lineageIds: [
									'docs-folder:guide.md',
									'docs-folder:guide.md-alt'
								],
								reasons: [
									'duplicate_sync_key',
									'multiple_lineages',
									'multiple_versions',
									'multiple_latest_versions'
								],
								syncKey: 'guide.md',
								versionIds: [
									'docs-folder:guide.md:fp-a',
									'docs-folder:guide.md-alt:fp-b'
								]
							}
						]
					},
					status: 'completed'
				}
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('previews and resolves only safe single-latest sync conflicts', async () => {
		const reconciliation: RAGSyncSourceReconciliationSummary = {
			duplicateSyncKeyGroups: [
				{
					count: 2,
					documentIds: ['guide-md-v2a', 'guide-md-v2b'],
					syncKey: 'guide.md'
				},
				{
					count: 2,
					documentIds: ['faq-md-v1a', 'faq-md-v1b'],
					syncKey: 'faq.md'
				}
			],
			lineageConflicts: [
				{
					documentIds: ['guide-md-v2a', 'guide-md-v2b'],
					documents: [
						{
							documentId: 'guide-md-v2a',
							isLatestVersion: true,
							lineageId: 'docs-folder:guide.md',
							versionId: 'docs-folder:guide.md:fp-a',
							versionNumber: 2
						},
						{
							documentId: 'guide-md-v2b',
							isLatestVersion: false,
							lineageId: 'docs-folder:guide.md',
							versionId: 'docs-folder:guide.md:fp-b',
							versionNumber: 1
						}
					],
					latestDocumentIds: ['guide-md-v2a'],
					lineageIds: ['docs-folder:guide.md'],
					reasons: ['duplicate_sync_key', 'multiple_versions'],
					syncKey: 'guide.md',
					versionIds: [
						'docs-folder:guide.md:fp-a',
						'docs-folder:guide.md:fp-b'
					]
				},
				{
					documentIds: ['faq-md-v1a', 'faq-md-v1b'],
					documents: [
						{
							documentId: 'faq-md-v1a',
							isLatestVersion: true,
							lineageId: 'docs-folder:faq.md',
							versionId: 'docs-folder:faq.md:fp-a',
							versionNumber: 1
						},
						{
							documentId: 'faq-md-v1b',
							isLatestVersion: true,
							lineageId: 'docs-folder:faq.md-alt',
							versionId: 'docs-folder:faq.md-alt:fp-b',
							versionNumber: 1
						}
					],
					latestDocumentIds: ['faq-md-v1a', 'faq-md-v1b'],
					lineageIds: [
						'docs-folder:faq.md',
						'docs-folder:faq.md-alt'
					],
					reasons: [
						'duplicate_sync_key',
						'multiple_lineages',
						'multiple_versions',
						'multiple_latest_versions'
					],
					syncKey: 'faq.md',
					versionIds: [
						'docs-folder:faq.md:fp-a',
						'docs-folder:faq.md-alt:fp-b'
					]
				}
			],
			refreshMode: 'targeted' as const,
			refreshedDocumentIds: [],
			refreshedSyncKeys: [],
			staleDocumentIds: [],
			staleSyncKeys: [],
			targetedRefreshSyncKeys: [],
			unchangedDocumentIds: [],
			unchangedSyncKeys: []
		};

		expect(previewRAGSyncConflictResolutions({ reconciliation })).toEqual({
			actions: [
				{
					deleteDocumentIds: ['guide-md-v2b'],
					keepDocumentId: 'guide-md-v2a',
					reasons: ['duplicate_sync_key', 'multiple_versions'],
					syncKey: 'guide.md'
				}
			],
			strategy: 'keep_latest',
			unresolvedConflicts: [
				{
					candidateDocumentIds: ['faq-md-v1a', 'faq-md-v1b'],
					reasons: [
						'duplicate_sync_key',
						'multiple_lineages',
						'multiple_versions',
						'multiple_latest_versions'
					],
					syncKey: 'faq.md'
				}
			],
			unresolvedSyncKeys: ['faq.md']
		});

		const deletedIds: string[] = [];
		await expect(
			resolveRAGSyncConflictResolutions({
				deleteDocument(id) {
					deletedIds.push(id);
					return true;
				},
				reconciliation
			})
		).resolves.toEqual({
			actions: [
				{
					deleteDocumentIds: ['guide-md-v2b'],
					keepDocumentId: 'guide-md-v2a',
					reasons: ['duplicate_sync_key', 'multiple_versions'],
					syncKey: 'guide.md'
				}
			],
			deletedDocumentIds: ['guide-md-v2b'],
			failedDocumentIds: [],
			strategy: 'keep_latest',
			unresolvedConflicts: [
				{
					candidateDocumentIds: ['faq-md-v1a', 'faq-md-v1b'],
					reasons: [
						'duplicate_sync_key',
						'multiple_lineages',
						'multiple_versions',
						'multiple_latest_versions'
					],
					syncKey: 'faq.md'
				}
			],
			unresolvedSyncKeys: ['faq.md']
		});
		expect(deletedIds).toEqual(['guide-md-v2b']);
	});

	it('resolves ambiguous multi-latest conflicts with keep_highest_version when version ordering is unique', async () => {
		const reconciliation: RAGSyncSourceReconciliationSummary = {
			duplicateSyncKeyGroups: [
				{
					count: 2,
					documentIds: ['guide-v2', 'guide-v3'],
					syncKey: 'guide.md'
				}
			],
			lineageConflicts: [
				{
					documentIds: ['guide-v2', 'guide-v3'],
					documents: [
						{
							documentId: 'guide-v2',
							isLatestVersion: true,
							lineageId: 'docs:guide',
							versionId: 'docs:guide:fp-v2',
							versionNumber: 2
						},
						{
							documentId: 'guide-v3',
							isLatestVersion: true,
							lineageId: 'docs:guide',
							versionId: 'docs:guide:fp-v3',
							versionNumber: 3
						}
					],
					latestDocumentIds: ['guide-v2', 'guide-v3'],
					lineageIds: ['docs:guide'],
					reasons: [
						'duplicate_sync_key',
						'multiple_versions',
						'multiple_latest_versions'
					],
					syncKey: 'guide.md',
					versionIds: ['docs:guide:fp-v2', 'docs:guide:fp-v3']
				}
			],
			refreshMode: 'targeted' as const,
			refreshedDocumentIds: [],
			refreshedSyncKeys: [],
			staleDocumentIds: [],
			staleSyncKeys: [],
			targetedRefreshSyncKeys: [],
			unchangedDocumentIds: [],
			unchangedSyncKeys: []
		};

		expect(
			previewRAGSyncConflictResolutions({
				reconciliation,
				strategy: 'keep_latest'
			})
		).toEqual({
			actions: [],
			strategy: 'keep_latest',
			unresolvedConflicts: [
				{
					candidateDocumentIds: ['guide-v2', 'guide-v3'],
					reasons: [
						'duplicate_sync_key',
						'multiple_versions',
						'multiple_latest_versions'
					],
					recommendedStrategy: 'keep_highest_version',
					syncKey: 'guide.md'
				}
			],
			unresolvedSyncKeys: ['guide.md']
		});

		expect(
			previewRAGSyncConflictResolutions({
				reconciliation,
				strategy: 'keep_highest_version'
			})
		).toEqual({
			actions: [
				{
					deleteDocumentIds: ['guide-v2'],
					keepDocumentId: 'guide-v3',
					reasons: [
						'duplicate_sync_key',
						'multiple_versions',
						'multiple_latest_versions'
					],
					syncKey: 'guide.md'
				}
			],
			strategy: 'keep_highest_version',
			unresolvedConflicts: [],
			unresolvedSyncKeys: []
		});

		const deletedIds: string[] = [];
		await expect(
			resolveRAGSyncConflictResolutions({
				deleteDocument(id) {
					deletedIds.push(id);
					return true;
				},
				reconciliation,
				strategy: 'keep_highest_version'
			})
		).resolves.toEqual({
			actions: [
				{
					deleteDocumentIds: ['guide-v2'],
					keepDocumentId: 'guide-v3',
					reasons: [
						'duplicate_sync_key',
						'multiple_versions',
						'multiple_latest_versions'
					],
					syncKey: 'guide.md'
				}
			],
			deletedDocumentIds: ['guide-v2'],
			failedDocumentIds: [],
			strategy: 'keep_highest_version',
			unresolvedConflicts: [],
			unresolvedSyncKeys: []
		});
		expect(deletedIds).toEqual(['guide-v2']);
	});

	it('syncs URL sources into a collection and tracks completed state', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetch(
			new Response(
				'# URL Guide\n\nURL sync brings remote docs into the collection.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			)
		);

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGUrlSyncSource({
						id: 'remote-guide',
						label: 'Remote guide',
						urls: [{ url: 'https://example.com/guide.md' }]
					})
				]
			});

			const response = await syncManager.syncAllSources?.();
			expect(response).toMatchObject({
				ok: true,
				sources: [
					{
						chunkCount: 1,
						documentCount: 1,
						id: 'remote-guide',
						status: 'completed'
					}
				]
			});

			const hits = await collection.search({
				query: 'remote docs in the collection',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('https://example.com/guide.md');
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('syncs GitHub repo sources by discovering and filtering files via the contents API', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://api.github.test/repos/octo-org/roadmap/contents/docs?ref=main&per_page=100':
				new Response(
					JSON.stringify([
						{
							type: 'dir',
							path: 'docs/guides'
						},
						{
							type: 'file',
							path: 'docs/readme.md',
							download_url:
								'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/readme.md'
						},
						{
							type: 'file',
							path: 'docs/notes.txt',
							download_url:
								'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/notes.txt'
						}
					]),
					{
						headers: {
							'content-type': 'application/json'
						},
						status: 200
					}
				),
			'https://api.github.test/repos/octo-org/roadmap/contents/docs/guides?ref=main&per_page=100':
				new Response(
					JSON.stringify([
						{
							type: 'file',
							path: 'docs/guides/intro.md',
							download_url:
								'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/guides/intro.md'
						},
						{
							type: 'file',
							path: 'docs/guides/archive/old.md',
							download_url:
								'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/guides/archive/old.md'
						}
					]),
					{
						headers: {
							'content-type': 'application/json'
						},
						status: 200
					}
				),
			'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/guides/intro.md':
				new Response(
					'# Welcome\n\nRepository sync indexes discovered guides.',
					{
						headers: {
							'content-type': 'text/markdown'
						},
						status: 200
					}
				)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGGitHubSyncSource({
						apiBaseUrl: 'https://api.github.test',
						id: 'github-roadmap',
						includeExtensions: ['.md'],
						label: 'GitHub roadmap',
						maxDepth: 2,
						repos: [
							{
								branch: 'main',
								excludePaths: ['docs/guides/archive'],
								includePaths: ['guides/'],
								metadata: {
									repoTeam: 'docs'
								},
								owner: 'octo-org',
								pathPrefix: 'docs',
								repo: 'roadmap'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('github-roadmap');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 1,
					id: 'github-roadmap',
					metadata: {
						discoveredFileCount: 1,
						repoCount: 1
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'Repository sync indexes discovered guides',
				retrieval: 'hybrid',
				topK: 3
			});
			expect(hits[0]?.source).toBe(
				'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/guides/intro.md'
			);
			expect(hits[0]?.metadata).toMatchObject({
				repo: 'octo-org/roadmap',
				repoOwner: 'octo-org',
				repoName: 'roadmap',
				repoBranch: 'main',
				repoPath: 'docs/guides/intro.md',
				repoPrefix: 'docs',
				repoTeam: 'docs',
				sourcePath: 'docs/guides/intro.md',
				sourceUrl:
					'https://raw.githubusercontent.com/octo-org/roadmap/main/docs/guides/intro.md'
			});
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('syncs feed sources by discovering RSS entries and ingesting their URLs', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/feed.xml': new Response(
				[
					'<rss><channel>',
					'<title>Release Feed</title>',
					'<item><title>Guide</title><link>https://example.com/guide.md</link></item>',
					'<item><title>Status</title><link>https://example.com/status.md</link></item>',
					'</channel></rss>'
				].join(''),
				{
					headers: { 'content-type': 'application/rss+xml' },
					status: 200
				}
			),
			'https://example.com/guide.md': new Response(
				'# Guide\n\nFeed sync expands discovered release guidance.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			),
			'https://example.com/status.md': new Response(
				'# Status\n\nFeed sync also indexes the linked status document.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGFeedSyncSource({
						feeds: [
							{
								title: 'Release Feed',
								url: 'https://example.com/feed.xml'
							}
						],
						id: 'release-feed',
						label: 'Release feed'
					})
				]
			});

			const response = await syncManager.syncSource?.('release-feed');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 2,
					id: 'release-feed',
					metadata: {
						discoveredEntryCount: 2,
						feedCount: 1
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'linked status document',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('https://example.com/status.md');
			expect(hits[0]?.metadata).toMatchObject({
				feedEntryTitle: 'Status',
				feedTitle: 'Release Feed',
				feedUrl: 'https://example.com/feed.xml',
				sourceUrl: 'https://example.com/status.md'
			});
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('auto-discovers feeds from HTML alternate links and common endpoints before ingesting entries', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/blog': new Response(
				[
					'<html><head>',
					'<link rel="alternate" type="application/rss+xml" href="/feed.xml" />',
					'</head><body>Blog home</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/feed.xml': new Response(
				[
					'<rss><channel>',
					'<title>Blog Feed</title>',
					'<item><title>Launch</title><link>https://example.com/posts/launch.md</link></item>',
					'</channel></rss>'
				].join(''),
				{
					headers: { 'content-type': 'application/rss+xml' },
					status: 200
				}
			),
			'https://example.com/rss.xml': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/atom.xml': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/feed': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/rss': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/atom': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/posts/launch.md': new Response(
				'# Launch\n\nFeed autodiscovery brought this entry into sync.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGFeedSyncSource({
						autoDiscoverFromHTML: true,
						feeds: [
							{
								title: 'Blog root',
								url: 'https://example.com/blog'
							}
						],
						id: 'blog-feed',
						label: 'Blog feed',
						maxDiscoveredFeeds: 3
					})
				]
			});

			const response = await syncManager.syncSource?.('blog-feed');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 1,
					id: 'blog-feed',
					metadata: {
						discoveredEntryCount: 1,
						feedCount: 2
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'autodiscovery brought this entry',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('https://example.com/posts/launch.md');
			expect(hits[0]?.metadata).toMatchObject({
				feedTitle: 'Blog root',
				feedUrl: 'https://example.com/feed.xml',
				sourceUrl: 'https://example.com/posts/launch.md'
			});
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('syncs sitemap sources by discovering URL entries and ingesting their URLs', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/sitemap.xml': new Response(
				[
					'<urlset>',
					'<url><loc>https://example.com/docs/guide.md</loc></url>',
					'<url><loc>https://example.com/docs/status.md</loc></url>',
					'</urlset>'
				].join(''),
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/docs/guide.md': new Response(
				'# Guide\n\nSitemap sync expands discovered documentation URLs.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			),
			'https://example.com/docs/status.md': new Response(
				'# Status\n\nSitemap sync also indexes the linked status page.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGSitemapSyncSource({
						id: 'docs-sitemap',
						label: 'Docs sitemap',
						sitemaps: [
							{
								title: 'Docs sitemap',
								url: 'https://example.com/sitemap.xml'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('docs-sitemap');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 2,
					id: 'docs-sitemap',
					metadata: {
						discoveredUrlCount: 2,
						sitemapCount: 1
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'linked status page',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('https://example.com/docs/status.md');
			expect(hits[0]?.metadata).toMatchObject({
				sitemapTitle: 'Docs sitemap',
				sitemapUrl: 'https://example.com/sitemap.xml',
				sourceUrl: 'https://example.com/docs/status.md'
			});
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('auto-discovers robots sitemaps and follows sitemap indexes before ingesting URLs', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/robots.txt': new Response(
				'Sitemap: https://example.com/sitemap-index.xml',
				{
					headers: { 'content-type': 'text/plain' },
					status: 200
				}
			),
			'https://example.com/sitemap.xml': new Response(
				'<urlset></urlset>',
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/sitemap-index.xml': new Response(
				[
					'<sitemapindex>',
					'<sitemap><loc>https://example.com/docs.xml</loc></sitemap>',
					'</sitemapindex>'
				].join(''),
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/docs.xml': new Response(
				[
					'<urlset>',
					'<url><loc>https://example.com/docs/guide.md</loc></url>',
					'<url><loc>https://example.com/docs/release.md</loc></url>',
					'</urlset>'
				].join(''),
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/docs/guide.md': new Response(
				'# Guide\n\nRobots discovery finds nested sitemap content.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			),
			'https://example.com/docs/release.md': new Response(
				'# Release\n\nNested sitemap indexes also ingest release pages.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGSitemapSyncSource({
						autoDiscoverFromRobots: true,
						id: 'site-discovery',
						label: 'Site discovery',
						maxNestedSitemaps: 2,
						sitemaps: [
							{
								title: 'Primary site',
								url: 'https://example.com/sitemap.xml'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('site-discovery');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 2,
					id: 'site-discovery',
					metadata: {
						discoveredUrlCount: 2,
						sitemapCount: 3
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'nested sitemap content',
				retrieval: 'hybrid',
				topK: 3
			});

			expect(hits[0]?.source).toBe('https://example.com/docs/guide.md');
			expect(hits[0]?.metadata).toMatchObject({
				sitemapTitle: 'Primary site',
				sourceUrl: 'https://example.com/docs/guide.md'
			});
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('composes feed and sitemap discovery into one site-discovery source without overlapping app sitemap generation', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/blog': new Response(
				[
					'<html><head>',
					'<link rel="alternate" type="application/rss+xml" href="/feed.xml" />',
					'</head><body>Blog home</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/feed.xml': new Response(
				'<rss><channel><item><title>Launch</title><link>https://example.com/posts/launch.md</link></item></channel></rss>',
				{
					headers: { 'content-type': 'application/rss+xml' },
					status: 200
				}
			),
			'https://example.com/rss.xml': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/atom.xml': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/feed': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/rss': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/atom': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/robots.txt': new Response(
				'Sitemap: https://example.com/sitemap-index.xml',
				{
					headers: { 'content-type': 'text/plain' },
					status: 200
				}
			),
			'https://example.com/sitemap.xml': new Response(
				'<urlset></urlset>',
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/sitemap-index.xml': new Response(
				'<sitemapindex><sitemap><loc>https://example.com/docs.xml</loc></sitemap></sitemapindex>',
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/docs.xml': new Response(
				'<urlset><url><loc>https://example.com/docs/status.md</loc></url></urlset>',
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/posts/launch.md': new Response(
				'# Launch\n\nSite discovery pulled this feed entry.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			),
			'https://example.com/docs/status.md': new Response(
				'# Status\n\nSite discovery also pulled this sitemap page.',
				{
					headers: { 'content-type': 'text/markdown' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGSiteDiscoverySyncSource({
						id: 'site-discovery',
						label: 'Site discovery',
						maxDiscoveredFeeds: 3,
						maxNestedSitemaps: 2,
						sites: [
							{
								title: 'Blog root',
								url: 'https://example.com/blog'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('site-discovery');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 2,
					id: 'site-discovery',
					metadata: {
						discoveredUrlCount: 2,
						siteCount: 1
					},
					status: 'completed'
				}
			});

			const hits = await collection.search({
				query: 'sitemap page',
				retrieval: 'hybrid',
				topK: 5
			});

			const sources = hits.map((hit) => hit.source);
			expect(sources).toContain('https://example.com/posts/launch.md');
			expect(sources).toContain('https://example.com/docs/status.md');
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('discovers bounded same-origin linked pages from site-discovery seeds without creating a crawler subsystem', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/blog': new Response(
				[
					'<html><head>',
					'<link rel="alternate" type="application/rss+xml" href="/feed.xml" />',
					'</head><body><a href="/docs/start">Start</a></body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/feed.xml': new Response(
				'<rss><channel><item><title>Launch</title><link>https://example.com/posts/launch</link></item></channel></rss>',
				{
					headers: { 'content-type': 'application/rss+xml' },
					status: 200
				}
			),
			'https://example.com/rss.xml': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/atom.xml': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/feed': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/rss': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/atom': new Response('not a feed', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/robots.txt': new Response(
				'Sitemap: https://example.com/sitemap.xml',
				{
					headers: { 'content-type': 'text/plain' },
					status: 200
				}
			),
			'https://example.com/sitemap.xml': new Response(
				'<urlset><url><loc>https://example.com/docs/start</loc></url></urlset>',
				{
					headers: { 'content-type': 'application/xml' },
					status: 200
				}
			),
			'https://example.com/posts/launch': new Response(
				[
					'<html><body>',
					'<h1>Launch</h1>',
					'<a href="/docs/start">Docs start</a>',
					'<a href="/docs/deep">Deep docs</a>',
					'<a href="https://outside.example.com/ignored">Ignore outside</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/docs/start': new Response(
				[
					'<html><body>',
					'<h1>Start</h1>',
					'<p>Bounded linked-page discovery should ingest this page.</p>',
					'<a href="/docs/deep">Deep docs</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/docs/deep': new Response(
				[
					'<html><body>',
					'<h1>Deep</h1>',
					'<p>Same-origin crawl discovered this page from existing seeds.</p>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGSiteDiscoverySyncSource({
						autoDiscoverLinkedPages: true,
						id: 'site-discovery',
						label: 'Site discovery',
						maxDiscoveredFeeds: 3,
						maxLinkDepth: 1,
						maxLinkedPages: 2,
						maxLinksPerPage: 2,
						maxNestedSitemaps: 1,
						sites: [
							{
								title: 'Blog root',
								url: 'https://example.com/blog'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('site-discovery');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 3,
					id: 'site-discovery',
					status: 'completed'
				}
			});

			const deepHits = await collection.search({
				query: 'same-origin crawl discovered this page',
				retrieval: 'hybrid',
				topK: 5
			});
			expect(deepHits[0]?.source).toBe('https://example.com/docs/deep');
			expect(deepHits[0]?.metadata).toMatchObject({
				crawlDepth: 1,
				discoveredFromUrl: 'https://example.com/posts/launch',
				siteUrl: 'https://example.com/blog'
			});

			const allSources = (
				await collection.search({
					query: 'page',
					retrieval: 'hybrid',
					topK: 10
				})
			).map((hit) => hit.source);
			expect(allSources).not.toContain(
				'https://outside.example.com/ignored'
			);
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('respects canonical URLs and basic robots restrictions during bounded linked-page discovery', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/blog': new Response(
				'<html><body><a href="/posts/launch?ref=nav">Launch</a></body></html>',
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/robots.txt': new Response(
				['User-agent: *', 'Disallow: /private'].join('\n'),
				{
					headers: { 'content-type': 'text/plain' },
					status: 200
				}
			),
			'https://example.com/posts/launch?ref=nav': new Response(
				[
					'<html><head>',
					'<link rel="canonical" href="https://example.com/posts/launch" />',
					'</head><body>',
					'<a href="/docs/public">Public docs</a>',
					'<a href="/docs/nofollow">Nofollow docs</a>',
					'<a href="/private/secret">Private docs</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/posts/launch': new Response(
				[
					'<html><body>',
					'<h1>Launch</h1>',
					'<a href="/docs/public">Public docs</a>',
					'<a href="/docs/nofollow">Nofollow docs</a>',
					'<a href="/private/secret">Private docs</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/docs/public': new Response(
				'<html><body><p>Canonical page discovery kept this public page.</p></body></html>',
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/docs/nofollow': new Response(
				[
					'<html><head>',
					'<meta name="robots" content="nofollow" />',
					'</head><body><p>Nofollow page is indexed but not expanded.</p></body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/private/secret': new Response(
				'<html><body><p>This should never be crawled.</p></body></html>',
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGSiteDiscoverySyncSource({
						autoDiscoverFeeds: false,
						autoDiscoverLinkedPages: true,
						autoDiscoverSitemaps: false,
						id: 'site-discovery',
						label: 'Site discovery',
						maxLinkDepth: 2,
						maxLinkedPages: 5,
						maxLinksPerPage: 3,
						sites: [
							{
								title: 'Blog root',
								url: 'https://example.com/blog'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('site-discovery');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 3,
					id: 'site-discovery',
					status: 'completed'
				}
			});
			if (!response || !response.ok || !('source' in response)) {
				throw new Error(
					'Expected a successful single-source sync response'
				);
			}
			expect(
				response.source.diagnostics?.entries.map(
					(entry) => entry.code
				) ?? []
			).toEqual(
				expect.arrayContaining([
					'canonical_dedupe_applied',
					'robots_blocked',
					'nofollow_skipped'
				])
			);

			const hits = await collection.search({
				query: 'canonical page discovery kept this public page',
				retrieval: 'hybrid',
				topK: 5
			});
			expect(hits[0]?.source).toBe('https://example.com/docs/public');
			expect(hits[0]?.metadata).toMatchObject({
				discoveredFromUrl: 'https://example.com/posts/launch',
				siteUrl: 'https://example.com/blog'
			});

			const allSources = (
				await collection.search({
					query: 'page',
					retrieval: 'hybrid',
					topK: 10
				})
			).map((hit) => hit.source);
			expect(allSources).not.toContain(
				'https://example.com/private/secret'
			);
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('dedupes canonical page variants and skips noindex pages during bounded linked-page discovery', async () => {
		const fetchOriginal = globalThis.fetch;
		globalThis.fetch = createMockFetchMap({
			'https://example.com/blog': new Response(
				[
					'<html><body>',
					'<a href="/posts/launch?utm_source=nav">Launch nav</a>',
					'<a href="/posts/launch?ref=home">Launch home</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/robots.txt': new Response('User-agent: *', {
				headers: { 'content-type': 'text/plain' },
				status: 200
			}),
			'https://example.com/posts/launch?utm_source=nav': new Response(
				[
					'<html><head>',
					'<link rel="canonical" href="https://example.com/posts/launch" />',
					'</head><body>',
					'<a href="/docs/public?utm_medium=email">Public docs</a>',
					'<a href="/docs/draft">Draft docs</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/posts/launch?ref=home': new Response(
				[
					'<html><head>',
					'<link rel="canonical" href="https://example.com/posts/launch" />',
					'</head><body>',
					'<p>Duplicate variant.</p>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/posts/launch': new Response(
				[
					'<html><body>',
					'<a href="/docs/public?utm_medium=email">Public docs</a>',
					'<a href="/docs/draft">Draft docs</a>',
					'</body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/docs/public': new Response(
				'<html><body><p>Canonical dedupe kept only the public page.</p></body></html>',
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			),
			'https://example.com/docs/draft': new Response(
				[
					'<html><head>',
					'<meta name="robots" content="noindex" />',
					'</head><body><p>Draft page should be skipped.</p></body></html>'
				].join(''),
				{
					headers: { 'content-type': 'text/html' },
					status: 200
				}
			)
		});

		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			const syncManager = createRAGSyncManager({
				collection,
				sources: [
					createRAGSiteDiscoverySyncSource({
						autoDiscoverFeeds: false,
						autoDiscoverLinkedPages: true,
						autoDiscoverSitemaps: false,
						id: 'site-discovery',
						label: 'Site discovery',
						maxLinkDepth: 2,
						maxLinkedPages: 4,
						maxLinksPerPage: 4,
						sites: [
							{
								title: 'Blog root',
								url: 'https://example.com/blog'
							}
						]
					})
				]
			});

			const response = await syncManager.syncSource?.('site-discovery');
			expect(response).toMatchObject({
				ok: true,
				source: {
					documentCount: 2,
					id: 'site-discovery',
					status: 'completed'
				}
			});
			if (!response || !response.ok || !('source' in response)) {
				throw new Error(
					'Expected a successful single-source sync response'
				);
			}
			expect(
				response.source.diagnostics?.entries.map(
					(entry) => entry.code
				) ?? []
			).toEqual(
				expect.arrayContaining([
					'canonical_dedupe_applied',
					'noindex_skipped'
				])
			);

			const hits = await collection.search({
				query: 'canonical dedupe kept only the public page',
				retrieval: 'hybrid',
				topK: 5
			});
			expect(hits[0]?.source).toBe('https://example.com/docs/public');

			const allSources = (
				await collection.search({
					query: 'page',
					retrieval: 'hybrid',
					topK: 10
				})
			).map((hit) => hit.source);
			expect(allSources).not.toContain('https://example.com/docs/draft');
			expect(allSources).not.toContain(
				'https://example.com/posts/launch?ref=home'
			);
			expect(allSources).not.toContain(
				'https://example.com/posts/launch?utm_source=nav'
			);
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('syncs storage sources into a collection and tracks completed state', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const files = new Map<string, string>([
			[
				'docs/release.md',
				'# Release\n\nStorage sync keeps object-backed knowledge bases aligned.'
			]
		]);
		const storageClient = {
			file(key: string) {
				return {
					arrayBuffer: async () =>
						new TextEncoder().encode(files.get(key) ?? '').buffer
				};
			},
			list() {
				return {
					contents: [{ key: 'docs/release.md' }]
				};
			}
		};

		const syncManager = createRAGSyncManager({
			collection,
			sources: [
				createRAGStorageSyncSource({
					client: storageClient,
					id: 'storage-docs',
					label: 'Storage docs',
					prefix: 'docs/'
				})
			]
		});

		const response = await syncManager.syncSource?.('storage-docs');
		expect(response).toMatchObject({
			ok: true,
			source: {
				chunkCount: 1,
				documentCount: 1,
				id: 'storage-docs',
				status: 'completed'
			}
		});

		const hits = await collection.search({
			query: 'object backed knowledge base',
			retrieval: 'hybrid',
			topK: 3
		});

		expect(hits[0]?.source).toBe('storage/docs/release.md');
		expect((await syncManager.listSyncSources?.())?.[0]).toMatchObject({
			id: 'storage-docs',
			status: 'completed'
		});
	});

	it('resumes paged storage sync runs and defers stale deletion until completion', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const deletedIds: string[] = [];
		const storageClient = {
			file(key: string) {
				return {
					arrayBuffer: async () =>
						new TextEncoder().encode(
							key === 'docs/guide-1.md'
								? '# Guide 1\n\nStorage page one.'
								: '# Guide 2\n\nStorage page two.'
						).buffer
				};
			},
			list(input?: { startAfter?: string }) {
				if (!input?.startAfter) {
					return {
						contents: [{ key: 'docs/guide-1.md' }],
						isTruncated: true
					};
				}

				return {
					contents: [{ key: 'docs/guide-2.md' }],
					isTruncated: false
				};
			}
		};

		const syncManager = createRAGSyncManager({
			collection,
			deleteDocument(id) {
				deletedIds.push(id);
				return true;
			},
			listDocuments() {
				return [
					{
						id: 'stale-storage-doc',
						metadata: {
							syncFingerprint: 'stale-fp',
							syncKey: 'docs/stale.md',
							syncSourceId: 'storage-docs'
						},
						source: 'storage/docs/stale.md',
						title: 'stale.md'
					}
				];
			},
			sources: [
				createRAGStorageSyncSource({
					client: storageClient,
					id: 'storage-docs',
					label: 'Storage docs',
					maxPagesPerRun: 1,
					prefix: 'docs/'
				})
			]
		});

		const first = await syncManager.syncSource?.('storage-docs');
		expect(first).toMatchObject({
			ok: true,
			source: {
				diagnostics: {
					entries: expect.arrayContaining([
						expect.objectContaining({
							code: 'storage_resume_pending'
						}),
						expect.objectContaining({
							code: 'targeted_refresh_applied'
						})
					]),
					retryGuidance: {
						action: 'resume_sync',
						resumeCursor: 'docs/guide-1.md'
					}
				},
				id: 'storage-docs',
				metadata: {
					keyCount: 1,
					listedPageCount: 1,
					resumePending: true,
					resumeStartAfter: 'docs/guide-1.md'
				},
				status: 'completed'
			}
		});
		expect(deletedIds).toEqual([]);

		const second = await syncManager.syncSource?.('storage-docs');
		expect(second).toMatchObject({
			ok: true,
			source: {
				diagnostics: {
					entries: [
						{
							code: 'targeted_refresh_applied'
						}
					]
				},
				id: 'storage-docs',
				metadata: {
					keyCount: 1,
					listedPageCount: 1,
					resumePending: false,
					resumeStartAfter: undefined
				},
				status: 'completed'
			}
		});
		expect(deletedIds).toEqual(['stale-storage-doc']);
	});

	it('syncs email sources with thread metadata and attachment lineage', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const syncManager = createRAGSyncManager({
			collection,
			sources: [
				createRAGEmailSyncSource({
					client: createRAGStaticEmailSyncClient({
						messages: [
							{
								attachments: [
									{
										content:
											'# Attachment\n\nThe attachment says the refund workflow must keep sender context and attachment lineage.',
										contentType: 'text/markdown',
										name: 'refund-policy.md'
									}
								],
								bodyText:
									'Customer email thread says refund approvals should preserve thread metadata and sender identity.',
								from: 'ops@example.com',
								id: 'msg-1',
								subject: 'Refund workflow',
								threadId: 'thread-1',
								to: ['support@example.com']
							}
						]
					}),
					id: 'support-mailbox',
					label: 'Support mailbox'
				})
			]
		});

		const response = await syncManager.syncSource?.('support-mailbox');
		expect(response).toMatchObject({
			ok: true,
			source: {
				documentCount: 2,
				id: 'support-mailbox',
				status: 'completed'
			}
		});

		const messageHits = await collection.search({
			query: 'preserve thread metadata and sender identity',
			retrieval: 'hybrid',
			topK: 3
		});
		expect(messageHits[0]?.source).toBe('email/thread-1');
		expect(messageHits[0]?.metadata?.threadTopic).toBe('Refund workflow');

		const attachmentHits = await collection.search({
			query: 'attachment lineage',
			retrieval: 'hybrid',
			topK: 3
		});
		expect(String(attachmentHits[0]?.source)).toContain(
			'attachments/refund-policy.md'
		);
		expect(attachmentHits[0]?.metadata?.emailKind).toBe('attachment');
	});

	it('emits OCR remediation guidance for skipped scanned email attachments', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const syncManager = createRAGSyncManager({
			collection,
			sources: [
				createRAGEmailSyncSource({
					client: createRAGStaticEmailSyncClient({
						messages: [
							{
								attachments: [
									{
										content: new Uint8Array([1, 2, 3, 4]),
										contentType: 'application/pdf',
										name: 'scan.pdf'
									}
								],
								bodyText: 'Mailbox body remains searchable.',
								id: 'msg-ocr',
								subject: 'Scanned attachment'
							}
						]
					}),
					extractors: [
						createRAGFileExtractor({
							name: 'failing_pdf_extractor',
							supports: (input) =>
								String(
									input.name ?? input.source ?? ''
								).endsWith('.pdf'),
							extract() {
								throw new Error(
									'AbsoluteJS could not extract readable text from this PDF. Supply a custom extractor for scanned or image-only PDFs.'
								);
							}
						})
					],
					id: 'support-mailbox',
					label: 'Support mailbox'
				})
			]
		});

		const response = await syncManager.syncSource?.('support-mailbox');
		expect(response).toMatchObject({
			ok: true,
			source: {
				diagnostics: {
					entries: expect.arrayContaining([
						expect.objectContaining({
							code: 'extraction_failures_detected'
						}),
						expect.objectContaining({
							code: 'ocr_extractor_recommended'
						})
					]),
					extractionFailures: [
						expect.objectContaining({
							itemKind: 'email_attachment',
							itemLabel: 'scan.pdf',
							remediation: 'add_ocr_extractor'
						})
					],
					retryGuidance: {
						action: 'configure_extractor'
					}
				},
				documentCount: 1,
				id: 'support-mailbox',
				status: 'completed'
			}
		});

		const hits = await collection.search({
			query: 'mailbox body searchable',
			retrieval: 'hybrid',
			topK: 3
		});
		expect(hits[0]?.source).toBe('email/msg-ocr');
	});

	it('classifies malformed structured text sync failures as inspect-file remediation', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const syncManager = createRAGSyncManager({
			collection,
			sources: [
				createRAGStorageSyncSource({
					client: {
						file: () => ({
							arrayBuffer: async () =>
								new Uint8Array(
									Buffer.from('tenant,status\nacme,"ready')
								).buffer
						}),
						list: async () => ({
							contents: [{ key: 'broken.csv' }],
							isTruncated: false
						})
					},
					id: 'storage-source',
					label: 'Storage source',
					prefix: 'docs/'
				})
			]
		});

		const response = await syncManager.syncSource?.('storage-source');
		expect(response).toMatchObject({
			ok: true,
			source: {
				diagnostics: {
					extractionFailures: [
						expect.objectContaining({
							itemKind: 'storage_object',
							itemLabel: 'broken.csv',
							remediation: 'inspect_file',
							reason: expect.stringContaining(
								'malformed CSV at line 2'
							)
						})
					],
					retryGuidance: {
						action: 'inspect_source'
					}
				},
				documentCount: 0,
				id: 'storage-source',
				status: 'completed'
			}
		});
	});

	it('resumes paged email sync runs from the saved cursor', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const client = {
			listMessages(input?: { cursor?: string }) {
				if (!input?.cursor) {
					return {
						messages: [
							{
								bodyText: 'First mailbox page.',
								id: 'msg-1',
								subject: 'Page one'
							}
						],
						nextCursor: 'page-2'
					};
				}

				return {
					messages: [
						{
							bodyText: 'Second mailbox page.',
							id: 'msg-2',
							subject: 'Page two'
						}
					]
				};
			}
		};

		const syncManager = createRAGSyncManager({
			collection,
			sources: [
				createRAGEmailSyncSource({
					client,
					id: 'support-mailbox',
					label: 'Support mailbox',
					maxPagesPerRun: 1
				})
			]
		});

		const first = await syncManager.syncSource?.('support-mailbox');
		expect(first).toMatchObject({
			ok: true,
			source: {
				diagnostics: {
					entries: expect.arrayContaining([
						expect.objectContaining({
							code: 'email_resume_pending'
						}),
						expect.objectContaining({
							code: 'targeted_refresh_applied'
						})
					]),
					retryGuidance: {
						action: 'resume_sync',
						resumeCursor: 'page-2'
					}
				},
				id: 'support-mailbox',
				metadata: {
					listedPageCount: 1,
					messageCount: 1,
					resumeNextCursor: 'page-2',
					resumePending: true
				},
				status: 'completed'
			}
		});

		const second = await syncManager.syncSource?.('support-mailbox');
		expect(second).toMatchObject({
			ok: true,
			source: {
				id: 'support-mailbox',
				metadata: {
					listedPageCount: 1,
					messageCount: 1,
					resumeNextCursor: undefined,
					resumePending: false
				},
				status: 'completed'
			}
		});
	});

	it('marks failing sync sources as failed and preserves retry metadata', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const sync = mock(() => {
			throw new Error('sync exploded');
		});
		const syncManager = createRAGSyncManager({
			collection,
			retryAttempts: 1,
			retryDelayMs: 0,
			sources: [
				{
					id: 'broken-source',
					kind: 'custom',
					label: 'Broken source',
					sync
				}
			]
		});

		await expect(
			syncManager.syncSource?.('broken-source')
		).resolves.toMatchObject({
			error: 'sync exploded',
			ok: false
		});
		expect(sync).toHaveBeenCalledTimes(2);
		expect((await syncManager.listSyncSources?.())?.[0]).toMatchObject({
			consecutiveFailures: 2,
			diagnostics: {
				entries: [
					{
						code: 'sync_failed'
					}
				],
				retryGuidance: {
					action: 'inspect_source'
				}
			},
			id: 'broken-source',
			lastError: 'sync exploded',
			retryAttempts: 1,
			status: 'failed'
		});
	});

	it('derives conflict diagnostics and resolution guidance from reconciliation summaries', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const syncManager = createRAGSyncManager({
			collection,
			sources: [
				{
					id: 'conflicted-source',
					kind: 'custom',
					label: 'Conflicted source',
					sync() {
						return {
							chunkCount: 0,
							documentCount: 0,
							reconciliation: {
								duplicateSyncKeyGroups: [
									{
										count: 2,
										documentIds: ['doc-a', 'doc-b'],
										syncKey: 'docs/guide.md'
									}
								],
								lineageConflicts: [
									{
										documentIds: ['doc-a', 'doc-b'],
										documents: [
											{
												documentId: 'doc-a',
												isLatestVersion: true,
												lineageId: 'lineage-a',
												versionId: 'version-2',
												versionNumber: 2
											},
											{
												documentId: 'doc-b',
												isLatestVersion: true,
												lineageId: 'lineage-b',
												versionId: 'version-1',
												versionNumber: 1
											}
										],
										latestDocumentIds: ['doc-a', 'doc-b'],
										lineageIds: ['lineage-a', 'lineage-b'],
										reasons: [
											'duplicate_sync_key',
											'multiple_lineages',
											'multiple_versions',
											'multiple_latest_versions'
										],
										syncKey: 'docs/guide.md',
										versionIds: ['version-2', 'version-1']
									}
								],
								refreshMode: 'targeted',
								refreshedDocumentIds: ['doc-a'],
								refreshedSyncKeys: ['docs/guide.md'],
								staleDocumentIds: [],
								staleSyncKeys: [],
								targetedRefreshSyncKeys: ['docs/guide.md'],
								unchangedDocumentIds: [],
								unchangedSyncKeys: []
							}
						};
					}
				}
			]
		});

		const response = await syncManager.syncSource?.('conflicted-source');
		expect(response).toMatchObject({
			ok: true,
			source: {
				diagnostics: {
					entries: [
						{
							code: 'lineage_conflict_detected'
						},
						{
							code: 'duplicate_sync_key_detected'
						},
						{
							code: 'targeted_refresh_applied'
						}
					],
					retryGuidance: {
						action: 'resolve_conflicts',
						syncKeys: ['docs/guide.md']
					}
				},
				id: 'conflicted-source',
				status: 'completed'
			}
		});
	});

	it('builds extraction recovery previews from sync diagnostics', async () => {
		const directoryPreview = previewRAGSyncExtractionRecovery({
			diagnostics: {
				entries: [],
				extractionFailures: [
					{
						itemKind: 'directory_file',
						itemLabel: 'raw.bin',
						reason: 'No RAG file extractor matched raw.bin. Register a custom extractor for this file type.',
						remediation: 'configure_extractor'
					},
					{
						itemKind: 'directory_file',
						itemLabel: 'legacy.dat',
						reason: 'No RAG file extractor matched legacy.dat. Register a custom extractor for this file type.',
						remediation: 'configure_extractor'
					}
				],
				summary: 'directory extraction failures'
			}
		});
		expect(directoryPreview).toMatchObject({
			actions: [
				{
					count: 2,
					itemKinds: ['directory_file'],
					itemLabels: ['raw.bin', 'legacy.dat'],
					remediation: 'configure_extractor'
				}
			],
			recommendedAction: {
				remediation: 'configure_extractor'
			}
		});

		const mixedPreview = previewRAGSyncExtractionRecovery({
			diagnostics: {
				entries: [],
				extractionFailures: [
					{
						itemKind: 'email_attachment',
						itemLabel: 'scan.pdf',
						reason: 'AbsoluteJS could not extract readable text from this PDF. Supply a custom extractor for scanned or image-only PDFs.',
						remediation: 'add_ocr_extractor'
					},
					{
						itemKind: 'storage_object',
						itemLabel: 'docs/raw.bin',
						reason: 'Extractor returned malformed output.',
						remediation: 'inspect_file'
					}
				],
				summary: 'mixed extraction failures'
			}
		});
		expect(mixedPreview).toMatchObject({
			actions: [
				{
					count: 1,
					itemKinds: ['email_attachment'],
					itemLabels: ['scan.pdf'],
					remediation: 'add_ocr_extractor'
				},
				{
					count: 1,
					itemKinds: ['storage_object'],
					itemLabels: ['docs/raw.bin'],
					remediation: 'inspect_file'
				}
			],
			recommendedAction: {
				remediation: 'add_ocr_extractor'
			},
			unresolvedFailures: [
				{
					itemLabel: 'scan.pdf'
				},
				{
					itemLabel: 'docs/raw.bin'
				}
			]
		});
	});

	it('orchestrates extraction recovery actions through remediation handlers', async () => {
		const configureExtractor = mock(() => true);
		const addOCRExtractor = mock(() => {
			throw new Error('ocr provider unavailable');
		});

		await expect(
			resolveRAGSyncExtractionRecovery({
				diagnostics: {
					entries: [],
					extractionFailures: [
						{
							itemKind: 'directory_file',
							itemLabel: 'raw.bin',
							reason: 'No RAG file extractor matched raw.bin. Register a custom extractor for this file type.',
							remediation: 'configure_extractor'
						},
						{
							itemKind: 'email_attachment',
							itemLabel: 'scan.pdf',
							reason: 'AbsoluteJS could not extract readable text from this PDF. Supply a custom extractor for scanned or image-only PDFs.',
							remediation: 'add_ocr_extractor'
						},
						{
							itemKind: 'storage_object',
							itemLabel: 'docs/raw.dat',
							reason: 'Extractor returned malformed output.',
							remediation: 'inspect_file'
						}
					],
					summary: 'recovery actions'
				},
				handlers: {
					add_ocr_extractor: addOCRExtractor,
					configure_extractor: configureExtractor
				}
			})
		).resolves.toMatchObject({
			completedActions: [
				{
					remediation: 'configure_extractor'
				}
			],
			errorsByRemediation: {
				add_ocr_extractor: 'ocr provider unavailable'
			},
			failedActions: [
				{
					remediation: 'add_ocr_extractor'
				}
			],
			skippedActions: [
				{
					remediation: 'inspect_file'
				}
			]
		});
		expect(configureExtractor).toHaveBeenCalledTimes(1);
		expect(addOCRExtractor).toHaveBeenCalledTimes(1);
	});

	it('returns partial sync results when one source fails and keeps successful sources', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-partial-')
		);

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync keeps retrieval aligned.'
			);

			const syncManager = createRAGSyncManager({
				collection,
				retryAttempts: 0,
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					}),
					{
						id: 'broken-source',
						kind: 'custom',
						label: 'Broken source',
						sync() {
							throw new Error('sync exploded');
						}
					}
				]
			});

			const response = await syncManager.syncAllSources?.();
			expect(response).toMatchObject({
				errorsBySource: {
					'broken-source': 'sync exploded'
				},
				failedSourceIds: ['broken-source'],
				ok: true,
				partial: true
			});
			expect(response && 'sources' in response).toBe(true);
			const sources =
				response && 'sources' in response
					? response.sources.map(
							(entry: { id: string; status: string }) =>
								[entry.id, entry.status] as const
						)
					: [];
			expect(sources).toEqual([
				['docs-folder', 'completed'],
				['broken-source', 'failed']
			]);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('hydrates persisted sync state and saves new records after sync runs', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-persist-')
		);
		const savedSnapshots: Array<Array<{ id: string; status: string }>> = [];

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nDirectory sync keeps retrieval aligned.'
			);

			const syncManager = createRAGSyncManager({
				collection,
				loadState() {
					return [
						{
							id: 'docs-folder',
							kind: 'directory',
							label: 'Docs folder',
							lastSuccessfulSyncAt: 123,
							status: 'completed'
						}
					];
				},
				saveState(records) {
					savedSnapshots.push(
						records.map((record) => ({
							id: record.id,
							status: record.status
						}))
					);
				},
				sources: [
					createRAGDirectorySyncSource({
						directory: tempDir,
						id: 'docs-folder',
						label: 'Docs folder'
					})
				]
			});

			expect(await syncManager.listSyncSources?.()).toMatchObject([
				{
					id: 'docs-folder',
					lastSuccessfulSyncAt: 123,
					status: 'completed'
				}
			]);

			await syncManager.syncSource?.('docs-folder');
			expect(savedSnapshots.length).toBeGreaterThan(0);
			expect(savedSnapshots.at(-1)).toEqual([
				{ id: 'docs-folder', status: 'completed' }
			]);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('recovers interrupted running sync source records during hydration', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		const savedSnapshots: Array<
			Array<{ id: string; lastError?: string; status: string }>
		> = [];

		const syncManager = createRAGSyncManager({
			collection,
			loadState() {
				return [
					{
						id: 'docs-folder',
						kind: 'directory',
						label: 'Docs folder',
						lastStartedAt: 123,
						status: 'running'
					}
				];
			},
			saveState(records) {
				savedSnapshots.push(
					records.map((record) => ({
						id: record.id,
						lastError: record.lastError,
						status: record.status
					}))
				);
			},
			sources: [
				{
					id: 'docs-folder',
					kind: 'custom',
					label: 'Docs folder',
					sync: async () => ({
						chunkCount: 0,
						documentCount: 0
					})
				}
			]
		});

		expect(await syncManager.listSyncSources?.()).toMatchObject([
			{
				id: 'docs-folder',
				lastError: 'Interrupted before completion during recovery',
				status: 'failed'
			}
		]);
		expect(savedSnapshots.at(-1)).toEqual([
			{
				id: 'docs-folder',
				lastError: 'Interrupted before completion during recovery',
				status: 'failed'
			}
		]);
	});

	it('can queue background sync runs and expose running state immediately', async () => {
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		const syncManager = createRAGSyncManager({
			backgroundByDefault: false,
			collection,
			sources: [
				{
					id: 'slow-source',
					kind: 'custom',
					label: 'Slow source',
					async sync() {
						await gate;
						return {
							chunkCount: 0,
							documentCount: 0
						};
					}
				}
			]
		});

		const queued = await syncManager.syncSource?.('slow-source', {
			background: true
		});
		expect(queued).toMatchObject({
			ok: true,
			source: {
				id: 'slow-source',
				status: 'running'
			}
		});
		expect(await syncManager.listSyncSources?.()).toMatchObject([
			{
				id: 'slow-source',
				status: 'running'
			}
		]);

		release();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(await syncManager.listSyncSources?.()).toMatchObject([
			{
				id: 'slow-source',
				status: 'completed'
			}
		]);
	});

	it('persists sync state records to a file-backed store', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-sync-state-'));
		const store = createRAGFileSyncStateStore(
			join(tempDir, 'sync-state.json')
		);

		try {
			await store.save([
				{
					id: 'docs-folder',
					kind: 'directory',
					label: 'Docs folder',
					lastSuccessfulSyncAt: 123,
					status: 'completed'
				}
			]);

			await expect(store.load()).resolves.toMatchObject([
				{
					id: 'docs-folder',
					lastSuccessfulSyncAt: 123,
					status: 'completed'
				}
			]);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('falls back to empty job state when the file-backed job store is corrupted', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-job-state-'));
		const store = createRAGFileJobStateStore(
			join(tempDir, 'job-state.json')
		);

		try {
			writeFileSync(join(tempDir, 'job-state.json'), '{ nope', 'utf8');

			await expect(store.load()).resolves.toEqual({
				adminActions: [],
				adminJobs: [],
				ingestJobs: [],
				syncJobs: []
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('persists recovered failed sync state records through the file-backed store', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-sync-state-recovery-')
		);
		const stateStore = createRAGFileSyncStateStore(
			join(tempDir, 'sync-state.json')
		);
		const store = createInMemoryRAGStore({ dimensions: 8 });
		const collection = createRAGCollection({ store });

		try {
			await stateStore.save([
				{
					id: 'docs-folder',
					kind: 'directory',
					label: 'Docs folder',
					lastStartedAt: 123,
					status: 'running'
				}
			]);

			const syncManager = createRAGSyncManager({
				collection,
				loadState() {
					return stateStore.load();
				},
				saveState(records) {
					return stateStore.save(records);
				},
				sources: [
					{
						id: 'docs-folder',
						kind: 'custom',
						label: 'Docs folder',
						sync: async () => ({
							chunkCount: 0,
							documentCount: 0
						})
					}
				]
			});

			await syncManager.listSyncSources?.();
			await expect(stateStore.load()).resolves.toMatchObject([
				{
					id: 'docs-folder',
					lastError: 'Interrupted before completion during recovery',
					status: 'failed'
				}
			]);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('runs scheduled sync jobs through the sync scheduler', async () => {
		const calls: string[] = [];
		const scheduler = createRAGSyncScheduler({
			manager: {
				syncAllSources: async () => {
					calls.push('all');
					return { ok: true, sources: [] };
				},
				syncSource: async (id) => {
					calls.push(id);
					return {
						ok: true,
						source: {
							id,
							kind: 'custom',
							label: id,
							status: 'completed'
						}
					};
				}
			},
			schedules: [
				{
					id: 'all-sources',
					intervalMs: 1000,
					runImmediately: true
				},
				{
					id: 'single-source',
					intervalMs: 1000,
					runImmediately: true,
					sourceIds: ['docs-folder']
				}
			]
		});

		await scheduler.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(scheduler.isRunning()).toBe(true);
		expect(scheduler.listSchedules()).toHaveLength(2);
		expect(calls).toEqual(['all', 'docs-folder']);
		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});
});
