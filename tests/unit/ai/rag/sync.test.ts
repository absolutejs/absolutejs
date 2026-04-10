import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, mock } from 'bun:test';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createRAGCollection } from '../../../../src/ai/rag/collection';
import {
	createRAGStorageSyncSource,
	createRAGDirectorySyncSource,
	createRAGEmailSyncSource,
	createRAGFileSyncStateStore,
	createRAGStaticEmailSyncClient,
	createRAGSyncManager,
	createRAGSyncScheduler,
	createRAGUrlSyncSource
} from '../../../../src/ai/rag/sync';

const createMockFetch = (response: Response): typeof fetch =>
	Object.assign(
		(..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
			Promise.resolve(response),
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
					status: 'completed'
				}
			});
			expect(deletedIds).toEqual(['stale-md']);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
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
			id: 'broken-source',
			lastError: 'sync exploded',
			retryAttempts: 1,
			status: 'failed'
		});
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
