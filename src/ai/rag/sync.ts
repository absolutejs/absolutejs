import { S3Client } from 'bun';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
	CreateRAGSyncManagerOptions,
	RAGIndexedDocument,
	RAGDirectorySyncSourceOptions,
	RAGStorageSyncClient,
	RAGStorageSyncListInput,
	RAGStorageSyncListResult,
	RAGStorageSyncSourceOptions,
	RAGEmailSyncAttachment,
	RAGEmailSyncClient,
	RAGEmailSyncListInput,
	RAGEmailSyncListResult,
	RAGEmailSyncMessage,
	RAGEmailSyncSourceOptions,
	RAGSyncSchedule,
	RAGSyncScheduler,
	RAGSyncStateStore,
	RAGSyncManager,
	RAGSyncRunOptions,
	RAGSyncResponse,
	RAGSyncSourceDefinition,
	RAGIngestDocument,
	RAGSyncSourceRecord,
	RAGUrlSyncSourceOptions
} from '../../../types/ai';
import {
	loadRAGDocumentsFromDirectory,
	loadRAGDocumentsFromUploads,
	loadRAGDocumentsFromURLs,
	prepareRAGDocuments
} from './ingestion';

const toSyncError = (caught: unknown) =>
	caught instanceof Error ? caught.message : String(caught);

const wait = async (delayMs: number) => {
	if (!(delayMs > 0)) {
		return;
	}

	await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const parseSyncState = (content: string) => {
	try {
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

const createSyncFingerprint = (document: RAGIngestDocument) =>
	createHash('sha1')
		.update(document.source ?? '')
		.update('\n')
		.update(document.title ?? '')
		.update('\n')
		.update(document.text)
		.digest('hex');

const toManagedSyncDocument = (
	sourceId: string,
	document: RAGIngestDocument,
	syncKey: string
): RAGIngestDocument => ({
	...document,
	metadata: {
		...(document.metadata ?? {}),
		syncFingerprint: createSyncFingerprint(document),
		syncKey,
		syncSourceId: sourceId
	}
});

const encodeAttachmentContent = (attachment: RAGEmailSyncAttachment) =>
	typeof attachment.content === 'string'
		? {
				content: attachment.content,
				encoding: attachment.encoding ?? 'utf8'
			}
		: {
				content: Buffer.from(attachment.content).toString('base64'),
				encoding: 'base64' as const
			};

const toTimestamp = (value: number | string | Date | undefined) => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' || value instanceof Date) {
		const parsed = new Date(value).getTime();
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
};

const isManagedBySyncSource = (
	document: RAGIndexedDocument,
	sourceId: string
) => document.metadata?.syncSourceId === sourceId;

const getDocumentSyncFingerprint = (document: RAGIndexedDocument) =>
	typeof document.metadata?.syncFingerprint === 'string'
		? document.metadata.syncFingerprint
		: undefined;

const reconcileManagedDocuments = async (input: {
	collection: CreateRAGSyncManagerOptions['collection'];
	sourceId: string;
	documents: RAGIngestDocument[];
	listDocuments?: CreateRAGSyncManagerOptions['listDocuments'];
	deleteDocument?: CreateRAGSyncManagerOptions['deleteDocument'];
}) => {
	const prepared = prepareRAGDocuments({
		documents: input.documents
	});
	const nextDocumentIds = new Set(
		prepared.map((document) => document.documentId)
	);
	const nextFingerprintById = new Map(
		prepared.map(
			(document, index) =>
				[
					document.documentId,
					createSyncFingerprint(input.documents[index]!)
				] as const
		)
	);
	const existingDocuments = input.listDocuments
		? await input.listDocuments()
		: [];
	const managedDocuments = existingDocuments.filter((document) =>
		isManagedBySyncSource(document, input.sourceId)
	);
	const staleDocuments = managedDocuments.filter(
		(document) => !nextDocumentIds.has(document.id)
	);
	const changedPrepared = prepared.filter((document) => {
		const existing = managedDocuments.find(
			(entry) => entry.id === document.documentId
		);
		if (!existing) {
			return true;
		}

		return (
			getDocumentSyncFingerprint(existing) !==
			nextFingerprintById.get(document.documentId)
		);
	});

	if (input.deleteDocument) {
		await Promise.all(
			staleDocuments.map(async (document) => {
				await input.deleteDocument?.(document.id);
			})
		);
	}

	if (changedPrepared.length > 0) {
		await input.collection.ingest({
			chunks: changedPrepared.flatMap((document) => document.chunks)
		});
	}

	return {
		chunkCount: prepared.reduce(
			(sum, document) => sum + document.chunks.length,
			0
		),
		deletedCount: staleDocuments.length,
		documentCount: prepared.length,
		updatedCount: changedPrepared.length
	};
};

const toSourceRecord = (
	source: RAGSyncSourceDefinition,
	overrides?: Partial<RAGSyncSourceRecord>
): RAGSyncSourceRecord => ({
	description: source.description,
	id: source.id,
	kind: source.kind,
	label: source.label,
	metadata: source.metadata,
	status: 'idle',
	target: source.target,
	...overrides
});

export const createRAGDirectorySyncSource = (
	options: RAGDirectorySyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'directory',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target: options.directory,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const loaded = await loadRAGDocumentsFromDirectory({
			baseMetadata: options.baseMetadata,
			defaultChunking: options.defaultChunking,
			directory: options.directory,
			extractors: options.extractors,
			includeExtensions: options.includeExtensions,
			recursive: options.recursive
		});
		const managedDocuments = loaded.documents.map((document) =>
			toManagedSyncDocument(
				options.id,
				document,
				typeof document.metadata?.relativePath === 'string'
					? document.metadata.relativePath
					: (document.source ?? document.title ?? '')
			)
		);
		const reconciled = await reconcileManagedDocuments({
			collection,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id
		});

		return {
			chunkCount: reconciled.chunkCount,
			documentCount: reconciled.documentCount,
			metadata: {
				deletedCount: reconciled.deletedCount,
				directory: options.directory,
				recursive: options.recursive !== false,
				updatedCount: reconciled.updatedCount
			}
		};
	}
});

export const createRAGUrlSyncSource = (
	options: RAGUrlSyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'url',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target:
		options.urls.length === 1
			? options.urls[0]?.url
			: `${options.urls.length} urls`,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const loaded = await loadRAGDocumentsFromURLs({
			baseMetadata: options.baseMetadata,
			defaultChunking: options.defaultChunking,
			extractors: options.extractors,
			urls: options.urls
		});
		const managedDocuments = loaded.documents.map((document) =>
			toManagedSyncDocument(
				options.id,
				document,
				typeof document.metadata?.sourceUrl === 'string'
					? document.metadata.sourceUrl
					: (document.source ?? document.title ?? '')
			)
		);
		const reconciled = await reconcileManagedDocuments({
			collection,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id
		});

		return {
			chunkCount: reconciled.chunkCount,
			documentCount: reconciled.documentCount,
			metadata: {
				deletedCount: reconciled.deletedCount,
				updatedCount: reconciled.updatedCount,
				urlCount: options.urls.length
			}
		};
	}
});

export const createRAGBunS3SyncClient = (
	input: S3Client | ConstructorParameters<typeof S3Client>[0]
): RAGStorageSyncClient => {
	const client = input instanceof S3Client ? input : new S3Client(input);

	return {
		file: (key) => client.file(key),
		list: async (options?: RAGStorageSyncListInput) => {
			const result = await client.list({
				maxKeys: options?.maxKeys,
				prefix: options?.prefix,
				startAfter: options?.startAfter
			});

			return {
				contents: (result.contents ?? []).map((entry) => ({
					etag: entry.eTag,
					key: entry.key,
					lastModified: entry.lastModified,
					size: entry.size
				})),
				isTruncated: result.isTruncated,
				nextContinuationToken: result.nextContinuationToken
			} satisfies RAGStorageSyncListResult;
		}
	};
};

export const createRAGStorageSyncSource = (
	options: RAGStorageSyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'storage',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target: options.keys?.length
		? `${options.keys.length} object${options.keys.length === 1 ? '' : 's'}`
		: (options.prefix ?? 'storage://'),
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const keys =
			options.keys && options.keys.length > 0
				? options.keys
				: await (async () => {
						const listed: string[] = [];
						let startAfter: string | undefined;
						let remaining = options.maxKeys;

						for (;;) {
							const response = await options.client.list({
								maxKeys:
									typeof remaining === 'number'
										? Math.max(1, remaining)
										: undefined,
								prefix: options.prefix,
								startAfter
							});

							for (const entry of response.contents) {
								listed.push(entry.key);
								startAfter = entry.key;
								if (
									typeof remaining === 'number' &&
									listed.length >= remaining
								) {
									return listed;
								}
							}

							if (
								!response.isTruncated ||
								response.contents.length === 0
							) {
								return listed;
							}

							if (typeof remaining === 'number') {
								remaining -= response.contents.length;
								if (remaining <= 0) {
									return listed;
								}
							}
						}
					})();

		const uploads = await Promise.all(
			keys.map(async (key) => {
				const object = options.client.file(key);
				const bytes = new Uint8Array(await object.arrayBuffer());

				return {
					chunking: options.defaultChunking,
					content: Buffer.from(bytes).toString('base64'),
					contentType: undefined,
					encoding: 'base64' as const,
					metadata: {
						...(options.baseMetadata ?? {}),
						storageKey: key
					},
					name: key.split('/').at(-1) ?? key,
					source: `storage/${key}`,
					title: key.split('/').at(-1) ?? key
				};
			})
		);

		const loaded = await loadRAGDocumentsFromUploads({
			baseMetadata: options.baseMetadata,
			defaultChunking: options.defaultChunking,
			extractors: options.extractors,
			uploads
		});
		const managedDocuments = loaded.documents.map((document) =>
			toManagedSyncDocument(
				options.id,
				document,
				typeof document.metadata?.storageKey === 'string'
					? document.metadata.storageKey
					: (document.source ?? document.title ?? '')
			)
		);
		const reconciled = await reconcileManagedDocuments({
			collection,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id
		});

		return {
			chunkCount: reconciled.chunkCount,
			documentCount: reconciled.documentCount,
			metadata: {
				deletedCount: reconciled.deletedCount,
				keyCount: keys.length,
				prefix: options.prefix,
				updatedCount: reconciled.updatedCount
			}
		};
	}
});

export const createRAGStaticEmailSyncClient = (input: {
	messages: RAGEmailSyncMessage[];
}): RAGEmailSyncClient => ({
	listMessages: (options?: RAGEmailSyncListInput) => ({
		messages:
			typeof options?.maxResults === 'number'
				? input.messages.slice(0, options.maxResults)
				: input.messages
	})
});

export const createRAGEmailSyncSource = (
	options: RAGEmailSyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'email',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target: options.label,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const listed = await options.client.listMessages({
			maxResults: options.maxResults
		});
		const messageDocuments: RAGIngestDocument[] = listed.messages.map(
			(message) => ({
				chunking: options.defaultChunking,
				format: message.bodyHtml ? 'html' : 'text',
				id: `email-${message.id}`,
				metadata: {
					...(options.baseMetadata ?? {}),
					...(message.metadata ?? {}),
					emailKind: 'message',
					from: message.from,
					hasAttachments: (message.attachments?.length ?? 0) > 0,
					messageId: message.id,
					receivedAt: toTimestamp(message.receivedAt),
					sentAt: toTimestamp(message.sentAt),
					threadId: message.threadId,
					threadTopic: message.subject,
					to: message.to,
					cc: message.cc
				},
				source: `email/${message.threadId ?? message.id}`,
				text: message.bodyText,
				title: message.subject ?? message.id
			})
		);
		const attachmentUploads = listed.messages.flatMap((message) =>
			(message.attachments ?? []).map((attachment, index) => ({
				...encodeAttachmentContent(attachment),
				chunking: attachment.chunking ?? options.defaultChunking,
				contentType: attachment.contentType,
				format: attachment.format,
				metadata: {
					...(options.baseMetadata ?? {}),
					...(attachment.metadata ?? {}),
					attachmentId:
						attachment.id ??
						`${message.id}-attachment-${index + 1}`,
					emailKind: 'attachment',
					from: message.from,
					messageId: message.id,
					sentAt: toTimestamp(message.sentAt),
					threadId: message.threadId,
					threadTopic: message.subject
				},
				name: attachment.name,
				source:
					attachment.source ??
					`email/${message.threadId ?? message.id}/attachments/${attachment.name}`,
				title:
					attachment.title ??
					`${message.subject ?? message.id} · ${attachment.name}`
			}))
		);
		const loadedAttachments =
			attachmentUploads.length > 0
				? await loadRAGDocumentsFromUploads({
						baseMetadata: options.baseMetadata,
						defaultChunking: options.defaultChunking,
						extractors: options.extractors,
						uploads: attachmentUploads
					})
				: { documents: [] };
		const managedDocuments = [
			...messageDocuments.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					`message:${document.metadata?.messageId as string}`
				)
			),
			...loadedAttachments.documents.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					`attachment:${String(document.metadata?.attachmentId ?? document.source ?? document.title ?? '')}`
				)
			)
		];
		const reconciled = await reconcileManagedDocuments({
			collection,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id
		});

		return {
			chunkCount: reconciled.chunkCount,
			documentCount: reconciled.documentCount,
			metadata: {
				deletedCount: reconciled.deletedCount,
				messageCount: listed.messages.length,
				nextCursor: listed.nextCursor,
				updatedCount: reconciled.updatedCount
			}
		};
	}
});

export const createRAGSyncManager = (
	options: CreateRAGSyncManagerOptions
): RAGSyncManager => {
	const sourceMap = new Map(
		options.sources.map((source) => [source.id, source] as const)
	);
	const state = new Map<string, RAGSyncSourceRecord>(
		options.sources.map((source) => [source.id, toSourceRecord(source)])
	);
	const activeRuns = new Map<string, Promise<RAGSyncSourceRecord>>();
	let hydrationPromise: Promise<void> | null = null;

	const persistState = async () => {
		if (!options.saveState) {
			return;
		}

		await options.saveState([...state.values()]);
	};

	const ensureHydrated = async () => {
		if (!options.loadState) {
			return;
		}

		if (!hydrationPromise) {
			hydrationPromise = Promise.resolve(options.loadState()).then(
				(records) => {
					for (const record of records ?? []) {
						const source = sourceMap.get(record.id);
						if (!source) {
							continue;
						}

						state.set(
							record.id,
							toSourceRecord(source, {
								...record,
								metadata: {
									...(source.metadata ?? {}),
									...(record.metadata ?? {})
								}
							})
						);
					}
				}
			);
		}

		await hydrationPromise;
	};

	const resolveRetryAttempts = (source: RAGSyncSourceDefinition) =>
		Math.max(0, source.retryAttempts ?? options.retryAttempts ?? 0);

	const resolveRetryDelayMs = (source: RAGSyncSourceDefinition) =>
		Math.max(0, source.retryDelayMs ?? options.retryDelayMs ?? 0);

	const setSourceState = async (record: RAGSyncSourceRecord) => {
		state.set(record.id, record);
		await persistState();
	};

	const runSource = async (
		source: RAGSyncSourceDefinition
	): Promise<RAGSyncSourceRecord> => {
		await ensureHydrated();
		const existingRun = activeRuns.get(source.id);
		if (existingRun) {
			return existingRun;
		}

		const previous = state.get(source.id);
		const retryAttempts = resolveRetryAttempts(source);
		const retryDelayMs = resolveRetryDelayMs(source);
		const startedAt = Date.now();
		const running = toSourceRecord(source, {
			chunkCount: previous?.chunkCount,
			consecutiveFailures: previous?.consecutiveFailures ?? 0,
			documentCount: previous?.documentCount,
			lastError: undefined,
			lastStartedAt: startedAt,
			lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt,
			lastSyncedAt: previous?.lastSyncedAt,
			lastSyncDurationMs: previous?.lastSyncDurationMs,
			nextRetryAt: undefined,
			retryAttempts,
			status: 'running'
		});
		const runPromise = (async () => {
			await setSourceState(running);

			for (let attempt = 0; attempt <= retryAttempts; attempt++) {
				try {
					const result = await source.sync({
						collection: options.collection,
						deleteDocument: options.deleteDocument,
						listDocuments: options.listDocuments
					});
					const finishedAt = Date.now();
					const completed = toSourceRecord(source, {
						chunkCount: result.chunkCount,
						consecutiveFailures: 0,
						documentCount: result.documentCount,
						lastError: undefined,
						lastStartedAt: startedAt,
						lastSuccessfulSyncAt: finishedAt,
						lastSyncedAt: finishedAt,
						lastSyncDurationMs: finishedAt - startedAt,
						metadata:
							result.metadata === undefined
								? source.metadata
								: {
										...(source.metadata ?? {}),
										...result.metadata
									},
						nextRetryAt: undefined,
						retryAttempts,
						status: 'completed'
					});
					await setSourceState(completed);

					return completed;
				} catch (caught) {
					const message = toSyncError(caught);
					const finishedAt = Date.now();
					const hasRetriesRemaining = attempt < retryAttempts;
					const consecutiveFailures =
						(previous?.consecutiveFailures ?? 0) + attempt + 1;
					const failed = toSourceRecord(source, {
						chunkCount: previous?.chunkCount,
						consecutiveFailures,
						documentCount: previous?.documentCount,
						lastError: message,
						lastStartedAt: startedAt,
						lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt,
						lastSyncedAt: finishedAt,
						lastSyncDurationMs: finishedAt - startedAt,
						nextRetryAt: hasRetriesRemaining
							? finishedAt + retryDelayMs
							: undefined,
						retryAttempts,
						status: 'failed'
					});
					await setSourceState(failed);

					if (!hasRetriesRemaining) {
						return failed;
					}

					await wait(retryDelayMs);
				}
			}

			return (
				state.get(source.id) ??
				toSourceRecord(source, { status: 'failed' })
			);
		})().finally(() => {
			activeRuns.delete(source.id);
		});

		activeRuns.set(source.id, runPromise);
		return runPromise;
	};

	const resolveBackground = (runOptions?: RAGSyncRunOptions) =>
		runOptions?.background ?? options.backgroundByDefault ?? false;

	return {
		listSyncSources: async () => {
			await ensureHydrated();

			return [...state.values()];
		},
		syncAllSources: async (
			runOptions?: RAGSyncRunOptions
		): Promise<RAGSyncResponse> => {
			await ensureHydrated();
			if (resolveBackground(runOptions)) {
				for (const source of options.sources) {
					void runSource(source);
				}

				return {
					ok: true,
					sources: [...state.values()]
				};
			}

			const sources: RAGSyncSourceRecord[] = [];
			const failedSourceIds: string[] = [];
			const errorsBySource: Record<string, string> = {};

			for (const source of options.sources) {
				const record = await runSource(source);
				sources.push(record);

				if (record.status === 'failed') {
					failedSourceIds.push(record.id);
					if (record.lastError) {
						errorsBySource[record.id] = record.lastError;
					}

					if (options.continueOnError === false) {
						return {
							errorsBySource,
							failedSourceIds,
							ok: true,
							partial: true,
							sources
						};
					}
				}
			}

			return {
				errorsBySource:
					failedSourceIds.length > 0 ? errorsBySource : undefined,
				failedSourceIds:
					failedSourceIds.length > 0 ? failedSourceIds : undefined,
				ok: true,
				partial: failedSourceIds.length > 0,
				sources
			};
		},
		syncSource: async (
			id: string,
			runOptions?: RAGSyncRunOptions
		): Promise<RAGSyncResponse> => {
			await ensureHydrated();
			const source = sourceMap.get(id);
			if (!source) {
				return {
					error: `RAG sync source ${id} is not configured`,
					ok: false
				};
			}

			if (resolveBackground(runOptions)) {
				const existingRecord = state.get(id);
				if (existingRecord?.status !== 'running') {
					const running = toSourceRecord(source, {
						chunkCount: existingRecord?.chunkCount,
						consecutiveFailures:
							existingRecord?.consecutiveFailures ?? 0,
						documentCount: existingRecord?.documentCount,
						lastError: undefined,
						lastStartedAt: Date.now(),
						lastSuccessfulSyncAt:
							existingRecord?.lastSuccessfulSyncAt,
						lastSyncedAt: existingRecord?.lastSyncedAt,
						lastSyncDurationMs: existingRecord?.lastSyncDurationMs,
						nextRetryAt: undefined,
						retryAttempts: resolveRetryAttempts(source),
						status: 'running'
					});
					await setSourceState(running);
					void runSource(source);
				}

				return {
					ok: true,
					source:
						state.get(id) ??
						toSourceRecord(source, {
							status: 'running'
						})
				};
			}

			const record = await runSource(source);
			if (record.status === 'failed') {
				return {
					error: record.lastError ?? `RAG sync source ${id} failed`,
					ok: false
				};
			}

			return {
				ok: true,
				source: record
			};
		}
	};
};

export const createRAGFileSyncStateStore = (
	path: string
): RAGSyncStateStore => {
	const resolvedPath = resolve(path);

	return {
		load: async () => {
			try {
				return parseSyncState(await readFile(resolvedPath, 'utf8'));
			} catch {
				return [];
			}
		},
		save: async (records) => {
			await mkdir(dirname(resolvedPath), { recursive: true });
			await writeFile(
				resolvedPath,
				JSON.stringify(records, null, 2),
				'utf8'
			);
		}
	};
};

export const createRAGSyncScheduler = (input: {
	manager: RAGSyncManager;
	schedules: RAGSyncSchedule[];
}): RAGSyncScheduler => {
	const timers = new Map<string, ReturnType<typeof setInterval>>();
	let running = false;

	const runSchedule = async (schedule: RAGSyncSchedule) => {
		if (schedule.sourceIds?.length) {
			for (const sourceId of schedule.sourceIds) {
				await input.manager.syncSource?.(sourceId, {
					background: schedule.background
				});
			}
			return;
		}

		await input.manager.syncAllSources?.({
			background: schedule.background
		});
	};

	return {
		start: async () => {
			if (running) {
				return;
			}

			running = true;
			for (const schedule of input.schedules) {
				if (schedule.runImmediately) {
					void runSchedule(schedule);
				}

				timers.set(
					schedule.id,
					setInterval(() => {
						void runSchedule(schedule);
					}, schedule.intervalMs)
				);
			}
		},
		stop: () => {
			for (const timer of timers.values()) {
				clearInterval(timer);
			}
			timers.clear();
			running = false;
		},
		isRunning: () => running,
		listSchedules: () => [...input.schedules]
	};
};
