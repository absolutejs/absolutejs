import { S3Client } from 'bun';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type {
	CreateRAGSyncManagerOptions,
	RAGChunkingOptions,
	RAGChunkingRegistryLike,
	RAGFileExtractor,
	RAGFileExtractorRegistryLike,
	RAGSyncConflictResolutionAction,
	RAGSyncSourceDiagnostics,
	RAGSyncExtractionRecoveryAction,
	RAGSyncExtractionRecoveryHandlers,
	RAGSyncExtractionRecoveryPreview,
	RAGSyncExtractionRecoveryResult,
	RAGSyncExtractionFailure,
	RAGSyncConflictResolutionPreview,
	RAGSyncConflictResolutionResult,
	RAGSyncConflictResolutionStrategy,
	RAGCollection,
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
	RAGGmailLinkedEmailSyncSourceOptions,
	RAGFeedSyncInput,
	RAGFeedSyncSourceOptions,
	RAGGitHubRepoSyncInput,
	RAGGitHubSyncSourceOptions,
	RAGSitemapSyncInput,
	RAGSitemapSyncSourceOptions,
	RAGSiteDiscoveryInput,
	RAGSiteDiscoverySyncSourceOptions,
	RAGSyncSchedule,
	RAGSyncScheduler,
	RAGSyncStateStore,
	RAGSyncManager,
	RAGSyncRunOptions,
	RAGSyncResponse,
	RAGSyncSourceDefinition,
	RAGSyncSourceStatus,
	RAGSyncSourceReconciliationSummary,
	RAGSyncSourceRunResult,
	RAGIngestDocument,
	RAGSyncSourceRecord,
	RAGUrlSyncSourceOptions
} from '../../../types/ai';
import {
	loadRAGDocumentFile,
	loadRAGDocumentFromURL,
	loadRAGDocumentUpload,
	mergeMetadata,
	prepareRAGDocuments
} from './ingestion';
import { createRAGLinkedGmailEmailSyncClient } from './emailProviders';

const toSyncError = (caught: unknown) =>
	caught instanceof Error ? caught.message : String(caught);

const wait = async (delayMs: number) => {
	if (!(delayMs > 0)) {
		return;
	}

	await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const getSyncMetadataString = (
	metadata: Record<string, unknown> | undefined,
	key: string
) => (typeof metadata?.[key] === 'string' ? metadata[key] : undefined);

const getSyncMetadataBoolean = (
	metadata: Record<string, unknown> | undefined,
	key: string
) => metadata?.[key] === true;

const DEFAULT_DIRECTORY_EXTENSIONS = [
	'.txt',
	'.md',
	'.mdx',
	'.html',
	'.htm',
	'.json',
	'.csv',
	'.xml',
	'.yaml',
	'.yml',
	'.pdf'
];

const DEFAULT_GITHUB_EXTENSION_FILTER = DEFAULT_DIRECTORY_EXTENSIONS;
const DEFAULT_GITHUB_MAX_DEPTH = 12;

const isSyncExtractionFailure = (message: string) =>
	message.startsWith('No RAG file extractor matched') ||
	message.includes('could not extract readable text from this PDF') ||
	message.includes('detected malformed JSONL') ||
	message.includes('detected malformed CSV') ||
	message.includes('detected malformed TSV') ||
	message.includes('detected malformed XML') ||
	message.includes('detected malformed YAML') ||
	message.startsWith('RAG extractor ') ||
	message.includes('extract failed');

const inferSyncExtractionRemediation = (
	message: string
): RAGSyncExtractionFailure['remediation'] => {
	if (message.includes('could not extract readable text from this PDF')) {
		return 'add_ocr_extractor';
	}

	if (
		message.includes('detected malformed JSONL') ||
		message.includes('detected malformed CSV') ||
		message.includes('detected malformed TSV') ||
		message.includes('detected malformed XML') ||
		message.includes('detected malformed YAML')
	) {
		return 'inspect_file';
	}

	if (message.startsWith('No RAG file extractor matched')) {
		return 'configure_extractor';
	}

	return 'inspect_file';
};

const buildSyncExtractionFailure = (input: {
	itemKind: RAGSyncExtractionFailure['itemKind'];
	itemLabel: string;
	error: string;
}): RAGSyncExtractionFailure => ({
	itemKind: input.itemKind,
	itemLabel: input.itemLabel,
	reason: input.error,
	remediation: inferSyncExtractionRemediation(input.error)
});

const buildExtractionFailureDiagnostics = (
	failures: RAGSyncExtractionFailure[]
): RAGSyncSourceDiagnostics | undefined => {
	if (failures.length === 0) {
		return undefined;
	}

	const entries: RAGSyncSourceDiagnostics['entries'] = [
		{
			code: 'extraction_failures_detected',
			severity: 'warning',
			summary: `${failures.length} source item${failures.length === 1 ? '' : 's'} failed extraction and were skipped`
		}
	];
	const remediationKinds = new Set(
		failures.map((failure) => failure.remediation)
	);
	let retryGuidance: RAGSyncSourceDiagnostics['retryGuidance'] = {
		action: 'inspect_source',
		reason: 'Inspect skipped source items and rerun sync after fixing the extraction issue.'
	};

	if (remediationKinds.has('configure_extractor')) {
		entries.push({
			code: 'extractor_missing',
			severity: 'warning',
			summary:
				'At least one source item needs a matching extractor before it can be indexed'
		});
		retryGuidance = {
			action: 'configure_extractor',
			reason: 'Register or enable an extractor for the skipped source items, then rerun sync.'
		};
	}

	if (remediationKinds.has('add_ocr_extractor')) {
		entries.push({
			code: 'ocr_extractor_recommended',
			severity: 'warning',
			summary:
				'At least one PDF source item appears image-only and needs OCR extraction'
		});
		retryGuidance = {
			action: 'configure_extractor',
			reason: 'Add an OCR-capable PDF extractor for the skipped scanned documents, then rerun sync.'
		};
	}

	return {
		entries,
		extractionFailures: failures,
		retryGuidance,
		summary: entries.map((entry) => entry.summary).join(' | ')
	};
};

const extractionRecoveryPriority: Record<
	RAGSyncExtractionFailure['remediation'],
	number
> = {
	add_ocr_extractor: 0,
	configure_extractor: 1,
	inspect_file: 2
};

const formatExtractionRecoverySummary = (
	remediation: RAGSyncExtractionFailure['remediation'],
	count: number
) => {
	switch (remediation) {
		case 'add_ocr_extractor':
			return `${count} skipped item${count === 1 ? '' : 's'} need OCR extraction`;
		case 'configure_extractor':
			return `${count} skipped item${count === 1 ? '' : 's'} need a matching extractor`;
		case 'inspect_file':
		default:
			return `${count} skipped item${count === 1 ? '' : 's'} need manual file inspection`;
	}
};

export const previewRAGSyncExtractionRecovery = (input: {
	diagnostics?: RAGSyncSourceDiagnostics;
}): RAGSyncExtractionRecoveryPreview => {
	const failures = input.diagnostics?.extractionFailures ?? [];
	if (failures.length === 0) {
		return {
			actions: [],
			recommendedAction: undefined,
			summary: undefined,
			unresolvedFailures: []
		};
	}

	const actionMap = new Map<
		RAGSyncExtractionFailure['remediation'],
		RAGSyncExtractionRecoveryAction
	>();
	for (const failure of failures) {
		const existing = actionMap.get(failure.remediation);
		if (existing) {
			if (!existing.itemKinds.includes(failure.itemKind)) {
				existing.itemKinds.push(failure.itemKind);
			}
			if (!existing.itemLabels.includes(failure.itemLabel)) {
				existing.itemLabels.push(failure.itemLabel);
			}
			if (!existing.reasons.includes(failure.reason)) {
				existing.reasons.push(failure.reason);
			}
			existing.count += 1;
			existing.summary = formatExtractionRecoverySummary(
				failure.remediation,
				existing.count
			);
			continue;
		}

		actionMap.set(failure.remediation, {
			count: 1,
			itemKinds: [failure.itemKind],
			itemLabels: [failure.itemLabel],
			reasons: [failure.reason],
			remediation: failure.remediation,
			summary: formatExtractionRecoverySummary(failure.remediation, 1)
		});
	}

	const actions = [...actionMap.values()].sort((left, right) => {
		const priorityDelta =
			extractionRecoveryPriority[left.remediation] -
			extractionRecoveryPriority[right.remediation];
		if (priorityDelta !== 0) {
			return priorityDelta;
		}

		return right.count - left.count;
	});

	return {
		actions,
		recommendedAction: actions[0],
		summary: actions.map((action) => action.summary).join(' | '),
		unresolvedFailures: failures
	};
};

export const resolveRAGSyncExtractionRecovery = async (input: {
	diagnostics?: RAGSyncSourceDiagnostics;
	handlers?: RAGSyncExtractionRecoveryHandlers;
}): Promise<RAGSyncExtractionRecoveryResult> => {
	const preview = previewRAGSyncExtractionRecovery({
		diagnostics: input.diagnostics
	});
	const handlers = input.handlers ?? {};
	const completedActions: RAGSyncExtractionRecoveryAction[] = [];
	const failedActions: RAGSyncExtractionRecoveryAction[] = [];
	const skippedActions: RAGSyncExtractionRecoveryAction[] = [];
	const errorsByRemediation: Partial<
		Record<RAGSyncExtractionFailure['remediation'], string>
	> = {};

	for (const action of preview.actions) {
		const handler = handlers[action.remediation];
		if (!handler) {
			skippedActions.push(action);
			continue;
		}

		try {
			const result = await handler(action);
			if (result === false) {
				failedActions.push(action);
				errorsByRemediation[action.remediation] =
					'Recovery handler reported the action was not completed';
				continue;
			}

			completedActions.push(action);
		} catch (caught) {
			failedActions.push(action);
			errorsByRemediation[action.remediation] = toSyncError(caught);
		}
	}

	return {
		...preview,
		completedActions,
		errorsByRemediation:
			Object.keys(errorsByRemediation).length > 0
				? errorsByRemediation
				: undefined,
		failedActions,
		skippedActions
	};
};

const mergeSyncDiagnostics = (
	derived: RAGSyncSourceDiagnostics | undefined,
	explicit: RAGSyncSourceDiagnostics | undefined
): RAGSyncSourceDiagnostics | undefined => {
	if (!derived) {
		return explicit;
	}
	if (!explicit) {
		return derived;
	}

	return {
		entries: [...derived.entries, ...explicit.entries],
		extractionFailures: [
			...(derived.extractionFailures ?? []),
			...(explicit.extractionFailures ?? [])
		],
		retryGuidance: explicit.retryGuidance ?? derived.retryGuidance,
		summary: [...derived.entries, ...explicit.entries]
			.map((entry) => entry.summary)
			.join(' | ')
	};
};

const collectSyncDirectoryFiles = async (
	directory: string,
	recursive: boolean,
	includeExtensions: Set<string> | null
) => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];

	await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (recursive) {
					files.push(
						...(await collectSyncDirectoryFiles(
							fullPath,
							recursive,
							includeExtensions
						))
					);
				}
				return;
			}
			if (!entry.isFile()) {
				return;
			}

			const extension = extname(entry.name).toLowerCase();
			if (includeExtensions && !includeExtensions.has(extension)) {
				return;
			}

			files.push(fullPath);
		})
	);

	return files.sort();
};

const buildSyncSourceDiagnostics = (record: {
	kind: RAGSyncSourceRecord['kind'];
	status: RAGSyncSourceStatus;
	lastError?: string;
	nextRetryAt?: number;
	reconciliation?: RAGSyncSourceReconciliationSummary;
	metadata?: Record<string, unknown>;
}): RAGSyncSourceDiagnostics | undefined => {
	const entries: RAGSyncSourceDiagnostics['entries'] = [];
	let retryGuidance: RAGSyncSourceDiagnostics['retryGuidance'];

	if (record.status === 'failed') {
		entries.push({
			code: 'sync_failed',
			severity: 'error',
			summary:
				record.lastError && record.lastError.length > 0
					? `Sync failed: ${record.lastError}`
					: 'Sync failed before completion'
		});
		if (typeof record.nextRetryAt === 'number') {
			entries.push({
				code: 'retry_scheduled',
				severity: 'warning',
				summary: 'Retry is scheduled for this source'
			});
			retryGuidance = {
				action: 'wait_for_retry',
				nextRetryAt: record.nextRetryAt,
				reason: 'The sync manager already scheduled another retry attempt.'
			};
		} else {
			retryGuidance = {
				action: 'inspect_source',
				reason:
					record.lastError && record.lastError.length > 0
						? `Inspect the source failure and rerun sync after resolving: ${record.lastError}`
						: 'Inspect the source failure and rerun sync after resolving it.'
			};
		}
	}

	if (
		record.kind === 'storage' &&
		getSyncMetadataBoolean(record.metadata, 'resumePending')
	) {
		const resumeCursor = getSyncMetadataString(
			record.metadata,
			'resumeStartAfter'
		);
		entries.push({
			code: 'storage_resume_pending',
			severity: 'warning',
			summary:
				typeof resumeCursor === 'string'
					? `Storage sync paused mid-walk and can resume after ${resumeCursor}`
					: 'Storage sync paused mid-walk and can resume from the saved cursor'
		});
		retryGuidance ??= {
			action: 'resume_sync',
			reason: 'Run this storage sync again to continue the paged source walk before deleting stale documents.',
			resumeCursor
		};
	}

	if (
		record.kind === 'email' &&
		getSyncMetadataBoolean(record.metadata, 'resumePending')
	) {
		const resumeCursor = getSyncMetadataString(
			record.metadata,
			'resumeNextCursor'
		);
		entries.push({
			code: 'email_resume_pending',
			severity: 'warning',
			summary:
				typeof resumeCursor === 'string'
					? `Email sync paused mid-walk and can resume from cursor ${resumeCursor}`
					: 'Email sync paused mid-walk and can resume from the saved cursor'
		});
		retryGuidance ??= {
			action: 'resume_sync',
			reason: 'Run this email sync again to continue the paged mailbox walk before deleting stale documents.',
			resumeCursor
		};
	}

	if (record.reconciliation) {
		if (record.reconciliation.lineageConflicts.length > 0) {
			entries.push({
				code: 'lineage_conflict_detected',
				severity: 'warning',
				summary: `${record.reconciliation.lineageConflicts.length} sync lineage conflict${record.reconciliation.lineageConflicts.length === 1 ? '' : 's'} detected`
			});
			retryGuidance ??= {
				action: 'resolve_conflicts',
				reason: 'Resolve sync lineage conflicts before trusting stale/latest version cleanup.',
				syncKeys: record.reconciliation.lineageConflicts.map(
					(conflict) => conflict.syncKey
				)
			};
		}
		if (record.reconciliation.duplicateSyncKeyGroups.length > 0) {
			entries.push({
				code: 'duplicate_sync_key_detected',
				severity: 'warning',
				summary: `${record.reconciliation.duplicateSyncKeyGroups.length} duplicate sync-key group${record.reconciliation.duplicateSyncKeyGroups.length === 1 ? '' : 's'} detected`
			});
		}
		if (record.reconciliation.refreshMode === 'targeted') {
			entries.push({
				code: 'targeted_refresh_applied',
				severity: 'info',
				summary: `${record.reconciliation.targetedRefreshSyncKeys.length} sync key${record.reconciliation.targetedRefreshSyncKeys.length === 1 ? '' : 's'} refreshed or removed during targeted reconciliation`
			});
		}
		if (
			record.reconciliation.refreshMode === 'noop' &&
			record.status === 'completed'
		) {
			entries.push({
				code: 'noop_sync',
				severity: 'info',
				summary:
					'No managed source changes were detected during this sync run'
			});
		}
	}

	if (entries.length === 0) {
		return undefined;
	}

	return {
		entries,
		retryGuidance,
		summary: entries.map((entry) => entry.summary).join(' | ')
	};
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

const getDocumentSyncKey = (document: {
	id: string;
	metadata?: Record<string, unknown>;
	source?: string;
	title?: string;
}) =>
	typeof document.metadata?.syncKey === 'string'
		? document.metadata.syncKey
		: (document.source ?? document.title ?? document.id);

const getDocumentSyncLineageId = (document: RAGIndexedDocument | undefined) =>
	typeof document?.metadata?.syncLineageId === 'string'
		? document.metadata.syncLineageId
		: undefined;

const getDocumentSyncVersionId = (document: RAGIndexedDocument | undefined) =>
	typeof document?.metadata?.syncVersionId === 'string'
		? document.metadata.syncVersionId
		: undefined;

const getDocumentSyncVersionNumber = (
	document: RAGIndexedDocument | undefined
) =>
	typeof document?.metadata?.syncVersionNumber === 'number' &&
	Number.isFinite(document.metadata.syncVersionNumber) &&
	document.metadata.syncVersionNumber > 0
		? document.metadata.syncVersionNumber
		: undefined;

const isDocumentSyncLatestVersion = (document: RAGIndexedDocument) =>
	document.metadata?.syncIsLatestVersion === true;

const getLatestSyncLineageDocument = (documents: RAGIndexedDocument[]) =>
	[...documents].sort((left, right) => {
		const versionDelta =
			(getDocumentSyncVersionNumber(right) ?? 0) -
			(getDocumentSyncVersionNumber(left) ?? 0);
		if (versionDelta !== 0) {
			return versionDelta;
		}

		const updatedDelta = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
		if (updatedDelta !== 0) {
			return updatedDelta;
		}

		const createdDelta = (right.createdAt ?? 0) - (left.createdAt ?? 0);
		if (createdDelta !== 0) {
			return createdDelta;
		}

		return right.id.localeCompare(left.id);
	})[0];

const reconcileManagedDocuments = async (input: {
	collection: CreateRAGSyncManagerOptions['collection'];
	allowDeletions?: boolean;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	sourceId: string;
	documents: RAGIngestDocument[];
	listDocuments?: CreateRAGSyncManagerOptions['listDocuments'];
	deleteDocument?: CreateRAGSyncManagerOptions['deleteDocument'];
}) => {
	const existingDocuments = input.listDocuments
		? await input.listDocuments()
		: [];
	const managedDocuments = existingDocuments.filter((document) =>
		isManagedBySyncSource(document, input.sourceId)
	);
	const managedDocumentsBySyncKey = new Map<string, RAGIndexedDocument[]>();
	for (const document of managedDocuments) {
		const syncKey = getDocumentSyncKey(document);
		const entries = managedDocumentsBySyncKey.get(syncKey);
		if (entries) {
			entries.push(document);
		} else {
			managedDocumentsBySyncKey.set(syncKey, [document]);
		}
	}
	const duplicateSyncKeyGroups = [...managedDocumentsBySyncKey.entries()]
		.filter(([, documents]) => documents.length > 1)
		.map(([syncKey, documents]) => ({
			count: documents.length,
			documentIds: documents.map((document) => document.id),
			syncKey
		}));
	const lineageConflicts = [...managedDocumentsBySyncKey.entries()]
		.map(([syncKey, documents]) => {
			if (documents.length <= 1) {
				return undefined;
			}

			const lineageIds = [
				...new Set(
					documents
						.map((document) => getDocumentSyncLineageId(document))
						.filter(
							(value): value is string =>
								typeof value === 'string'
						)
				)
			];
			const versionIds = [
				...new Set(
					documents
						.map((document) => getDocumentSyncVersionId(document))
						.filter(
							(value): value is string =>
								typeof value === 'string'
						)
				)
			];
			const latestDocuments = documents.filter(
				isDocumentSyncLatestVersion
			);
			const reasons: Array<
				| 'duplicate_sync_key'
				| 'multiple_lineages'
				| 'multiple_versions'
				| 'multiple_latest_versions'
			> = ['duplicate_sync_key'];

			if (lineageIds.length > 1) {
				reasons.push('multiple_lineages');
			}
			if (versionIds.length > 1) {
				reasons.push('multiple_versions');
			}
			if (latestDocuments.length > 1) {
				reasons.push('multiple_latest_versions');
			}

			return {
				documentIds: documents.map((document) => document.id),
				documents: documents.map((document) => ({
					documentId: document.id,
					isLatestVersion: isDocumentSyncLatestVersion(document),
					lineageId: getDocumentSyncLineageId(document),
					versionId: getDocumentSyncVersionId(document),
					versionNumber: getDocumentSyncVersionNumber(document)
				})),
				latestDocumentIds: latestDocuments.map(
					(document) => document.id
				),
				lineageIds,
				reasons,
				syncKey,
				versionIds
			};
		})
		.filter((value): value is NonNullable<typeof value> => Boolean(value));
	const versionedDocuments = input.documents.map((document) => {
		const syncKey = getDocumentSyncKey({
			id:
				document.id?.trim() ||
				document.title?.trim() ||
				document.source?.trim() ||
				input.sourceId,
			metadata: document.metadata,
			source: document.source,
			title: document.title
		});
		const syncFingerprint = createSyncFingerprint(document);
		const lineageDocuments = managedDocumentsBySyncKey.get(syncKey) ?? [];
		const exactVersion = lineageDocuments.find(
			(entry) => getDocumentSyncFingerprint(entry) === syncFingerprint
		);
		const latestVersion = getLatestSyncLineageDocument(lineageDocuments);
		const lineageId =
			getDocumentSyncLineageId(exactVersion ?? latestVersion) ??
			`${input.sourceId}:${syncKey}`;
		const versionNumber =
			getDocumentSyncVersionNumber(exactVersion) ??
			(getDocumentSyncVersionNumber(latestVersion) ?? 0) +
				(exactVersion ? 0 : 1);
		const versionId =
			getDocumentSyncVersionId(exactVersion) ??
			`${lineageId}:${syncFingerprint}`;

		return {
			...document,
			metadata: {
				...(document.metadata ?? {}),
				syncIsLatestVersion: true,
				syncLineageId: lineageId,
				syncVersionId: versionId,
				syncVersionNumber: versionNumber,
				...(exactVersion
					? {}
					: {
							syncPreviousDocumentId: latestVersion?.id,
							syncPreviousVersionId:
								getDocumentSyncVersionId(latestVersion)
						})
			}
		} satisfies RAGIngestDocument;
	});
	const existingById = new Map(
		managedDocuments.map((document) => [document.id, document] as const)
	);
	const prepared = prepareRAGDocuments({
		chunkingRegistry: input.chunkingRegistry,
		defaultChunking: input.defaultChunking,
		documents: versionedDocuments
	});
	const nextDocumentIds = new Set(
		prepared.map((document) => document.documentId)
	);
	const nextFingerprintById = new Map(
		prepared.map(
			(document, index) =>
				[
					document.documentId,
					createSyncFingerprint(versionedDocuments[index]!)
				] as const
		)
	);
	const staleDocuments = managedDocuments.filter(
		(document) => !nextDocumentIds.has(document.id)
	);
	const changedPrepared = prepared.filter((document) => {
		const existing = existingById.get(document.documentId);
		if (!existing) {
			return true;
		}

		return (
			getDocumentSyncFingerprint(existing) !==
			nextFingerprintById.get(document.documentId)
		);
	});
	const unchangedDocuments = prepared.filter((document) => {
		const existing = existingById.get(document.documentId);
		if (!existing) {
			return false;
		}

		return (
			getDocumentSyncFingerprint(existing) ===
			nextFingerprintById.get(document.documentId)
		);
	});
	const reconciliation: RAGSyncSourceReconciliationSummary = {
		duplicateSyncKeyGroups,
		lineageConflicts,
		refreshMode:
			staleDocuments.length > 0 || changedPrepared.length > 0
				? 'targeted'
				: 'noop',
		refreshedDocumentIds: changedPrepared.map(
			(document) => document.documentId
		),
		refreshedSyncKeys: changedPrepared.map((document) =>
			getDocumentSyncKey({
				id: document.documentId,
				metadata: document.metadata,
				source: document.source,
				title: document.title
			})
		),
		staleDocumentIds: staleDocuments.map((document) => document.id),
		staleSyncKeys: staleDocuments.map((document) =>
			getDocumentSyncKey(document)
		),
		targetedRefreshSyncKeys: [
			...new Set([
				...staleDocuments.map((document) =>
					getDocumentSyncKey(document)
				),
				...changedPrepared.map((document) =>
					getDocumentSyncKey({
						id: document.documentId,
						metadata: document.metadata,
						source: document.source,
						title: document.title
					})
				)
			])
		],
		unchangedDocumentIds: unchangedDocuments.map(
			(document) => document.documentId
		),
		unchangedSyncKeys: unchangedDocuments.map((document) =>
			getDocumentSyncKey({
				id: document.documentId,
				metadata: document.metadata,
				source: document.source,
				title: document.title
			})
		)
	};

	if (input.allowDeletions !== false && input.deleteDocument) {
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
		reconciliation,
		updatedCount: changedPrepared.length
	};
};

const buildSyncConflictResolutionAction = (
	conflict: RAGSyncSourceReconciliationSummary['lineageConflicts'][number],
	strategy: RAGSyncConflictResolutionStrategy
): RAGSyncConflictResolutionAction | undefined => {
	const latestKeeper =
		conflict.latestDocumentIds.length === 1
			? conflict.documents.find(
					(document) =>
						document.documentId === conflict.latestDocumentIds[0]
				)
			: undefined;
	const highestVersionDocuments = [...conflict.documents]
		.filter(
			(
				document
			): document is typeof document & { versionNumber: number } =>
				typeof document.versionNumber === 'number' &&
				Number.isFinite(document.versionNumber)
		)
		.sort((left, right) => right.versionNumber - left.versionNumber);
	const highestVersion =
		highestVersionDocuments.length > 0
			? highestVersionDocuments[0]?.versionNumber
			: undefined;
	const highestVersionCandidates =
		typeof highestVersion === 'number'
			? highestVersionDocuments.filter(
					(document) => document.versionNumber === highestVersion
				)
			: [];
	const highestVersionKeeper =
		highestVersionCandidates.length === 1
			? highestVersionCandidates[0]
			: undefined;
	const keeper =
		strategy === 'keep_highest_version'
			? (highestVersionKeeper ?? latestKeeper)
			: latestKeeper;
	if (!keeper) {
		return undefined;
	}

	const deleteDocumentIds = conflict.documentIds.filter(
		(documentId) => documentId !== keeper.documentId
	);
	if (deleteDocumentIds.length === 0) {
		return undefined;
	}

	return {
		deleteDocumentIds,
		keepDocumentId: keeper.documentId,
		reasons: conflict.reasons,
		syncKey: conflict.syncKey
	};
};

export const previewRAGSyncConflictResolutions = (input: {
	reconciliation?: RAGSyncSourceReconciliationSummary;
	strategy?: RAGSyncConflictResolutionStrategy;
}): RAGSyncConflictResolutionPreview => {
	const strategy = input.strategy ?? 'keep_latest';
	const reconciliation = input.reconciliation;
	if (!reconciliation) {
		return {
			actions: [],
			strategy,
			unresolvedConflicts: [],
			unresolvedSyncKeys: []
		};
	}

	const actions = reconciliation.lineageConflicts
		.map((conflict) =>
			buildSyncConflictResolutionAction(conflict, strategy)
		)
		.filter((action): action is RAGSyncConflictResolutionAction =>
			Boolean(action)
		);
	const resolvedSyncKeys = new Set(actions.map((action) => action.syncKey));
	const unresolvedConflicts = reconciliation.lineageConflicts
		.filter((conflict) => !resolvedSyncKeys.has(conflict.syncKey))
		.map((conflict) => {
			const highestVersionDocuments = conflict.documents
				.filter(
					(
						document
					): document is typeof document & {
						versionNumber: number;
					} =>
						typeof document.versionNumber === 'number' &&
						Number.isFinite(document.versionNumber)
				)
				.sort(
					(left, right) => right.versionNumber - left.versionNumber
				);
			const highestVersion =
				highestVersionDocuments.length > 0
					? highestVersionDocuments[0]?.versionNumber
					: undefined;
			const highestVersionCandidates =
				typeof highestVersion === 'number'
					? highestVersionDocuments.filter(
							(document) =>
								document.versionNumber === highestVersion
						)
					: [];

			return {
				candidateDocumentIds:
					conflict.latestDocumentIds.length > 0
						? conflict.latestDocumentIds
						: conflict.documentIds,
				reasons: conflict.reasons,
				recommendedStrategy:
					conflict.latestDocumentIds.length !== 1 &&
					highestVersionCandidates.length === 1
						? ('keep_highest_version' as const)
						: undefined,
				syncKey: conflict.syncKey
			};
		});

	return {
		actions,
		strategy,
		unresolvedConflicts,
		unresolvedSyncKeys: unresolvedConflicts.map(
			(conflict) => conflict.syncKey
		)
	};
};

export const resolveRAGSyncConflictResolutions = async (input: {
	deleteDocument: (id: string) => Promise<boolean> | boolean;
	reconciliation?: RAGSyncSourceReconciliationSummary;
	strategy?: RAGSyncConflictResolutionStrategy;
}): Promise<RAGSyncConflictResolutionResult> => {
	const preview = previewRAGSyncConflictResolutions({
		reconciliation: input.reconciliation,
		strategy: input.strategy
	});
	const deletedDocumentIds: string[] = [];
	const failedDocumentIds: string[] = [];
	const errorsByDocumentId: Record<string, string> = {};

	for (const action of preview.actions) {
		for (const documentId of action.deleteDocumentIds) {
			try {
				const deleted = await input.deleteDocument(documentId);
				if (deleted === false) {
					failedDocumentIds.push(documentId);
					errorsByDocumentId[documentId] =
						'Delete hook reported the document was not removed';
					continue;
				}

				deletedDocumentIds.push(documentId);
			} catch (caught) {
				failedDocumentIds.push(documentId);
				errorsByDocumentId[documentId] = toSyncError(caught);
			}
		}
	}

	return {
		...preview,
		deletedDocumentIds,
		errorsByDocumentId:
			Object.keys(errorsByDocumentId).length > 0
				? errorsByDocumentId
				: undefined,
		failedDocumentIds
	};
};

const toSourceRecord = (
	source: RAGSyncSourceDefinition,
	overrides?: Partial<RAGSyncSourceRecord>
): RAGSyncSourceRecord => {
	const record: RAGSyncSourceRecord = {
		description: source.description,
		id: source.id,
		kind: source.kind,
		label: source.label,
		metadata: source.metadata,
		status: 'idle',
		target: source.target,
		...overrides
	};

	return {
		...record,
		diagnostics: mergeSyncDiagnostics(
			buildSyncSourceDiagnostics(record),
			overrides?.diagnostics
		)
	};
};

const recoverSyncSourceRecord = (
	source: RAGSyncSourceDefinition,
	record: RAGSyncSourceRecord,
	recoveredAt: number
) =>
	record.status === 'running'
		? toSourceRecord(source, {
				...record,
				lastError:
					record.lastError ??
					'Interrupted before completion during recovery',
				lastSyncedAt: recoveredAt,
				nextRetryAt: undefined,
				status: 'failed'
			})
		: toSourceRecord(source, {
				...record,
				metadata: {
					...(source.metadata ?? {}),
					...(record.metadata ?? {})
				}
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
		const root = resolve(options.directory);
		const includeExtensions =
			options.includeExtensions === undefined &&
			(options.extractors?.length || options.extractorRegistry)
				? null
				: new Set(
						(
							options.includeExtensions ??
							DEFAULT_DIRECTORY_EXTENSIONS
						).map((entry) =>
							entry.startsWith('.')
								? entry.toLowerCase()
								: `.${entry.toLowerCase()}`
						)
					);
		const files = await collectSyncDirectoryFiles(
			root,
			options.recursive !== false,
			includeExtensions
		);
		const extractionFailures: RAGSyncExtractionFailure[] = [];
		const loadedDocuments = await Promise.all(
			files.map(async (path) => {
				try {
					const source = relative(root, path).replace(/\\/g, '/');
					const document = await loadRAGDocumentFile({
						chunking: options.defaultChunking,
						contentType: undefined,
						extractorRegistry: options.extractorRegistry,
						extractors: options.extractors,
						metadata: {
							fileName: basename(path),
							relativePath: source
						},
						path,
						source
					});

					return [
						{
							...document,
							metadata: mergeMetadata(
								document.metadata,
								undefined,
								options.baseMetadata
							)
						}
					];
				} catch (caught) {
					const message = toSyncError(caught);
					if (!isSyncExtractionFailure(message)) {
						throw caught;
					}
					extractionFailures.push(
						buildSyncExtractionFailure({
							error: message,
							itemKind: 'directory_file',
							itemLabel: relative(root, path).replace(/\\/g, '/')
						})
					);
					return [];
				}
			})
		);
		const managedDocuments = loadedDocuments
			.flat()
			.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					typeof document.metadata?.relativePath === 'string'
						? document.metadata.relativePath
						: (document.source ?? document.title ?? '')
				)
			);
		const reconciled = await reconcileManagedDocuments({
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id
		});

		return {
			chunkCount: reconciled.chunkCount,
			diagnostics: buildExtractionFailureDiagnostics(extractionFailures),
			documentCount: reconciled.documentCount,
			reconciliation: reconciled.reconciliation,
			metadata: {
				deletedCount: reconciled.deletedCount,
				directory: options.directory,
				recursive: options.recursive !== false,
				updatedCount: reconciled.updatedCount
			}
		};
	}
});

type ParsedFeedEntry = {
	url: string;
	title?: string;
};

const decodeFeedEntity = (value: string) =>
	value
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");

const extractFeedText = (value: string) =>
	decodeFeedEntity(
		value
			.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);

const resolveFeedEntryURL = (feedURL: string, candidate: string) => {
	try {
		return new URL(candidate, feedURL).toString();
	} catch {
		return candidate;
	}
};

const parseRSSFeedEntries = (feedURL: string, value: string) => {
	const entries: ParsedFeedEntry[] = [];
	for (const item of value.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
		const block = item[0] ?? '';
		const link =
			block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ??
			block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1];
		const title = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
		const normalizedLink = extractFeedText(link ?? '');
		if (!normalizedLink) {
			continue;
		}
		entries.push({
			title: extractFeedText(title ?? ''),
			url: resolveFeedEntryURL(feedURL, normalizedLink)
		});
	}
	return entries;
};

const parseAtomFeedEntries = (feedURL: string, value: string) => {
	const entries: ParsedFeedEntry[] = [];
	for (const entry of value.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
		const block = entry[0] ?? '';
		const hrefMatch = block.match(
			/<link\b[^>]*href=["']([^"']+)["'][^>]*?(?:rel=["']alternate["'])?[^>]*\/?>/i
		);
		const idMatch = block.match(/<id\b[^>]*>([\s\S]*?)<\/id>/i);
		const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
		const normalizedLink = extractFeedText(
			hrefMatch?.[1] ?? idMatch?.[1] ?? ''
		);
		if (!normalizedLink) {
			continue;
		}
		entries.push({
			title: extractFeedText(titleMatch?.[1] ?? ''),
			url: resolveFeedEntryURL(feedURL, normalizedLink)
		});
	}
	return entries;
};

const parseFeedEntries = (feed: RAGFeedSyncInput, value: string) => {
	const trimmed = value.trim();
	const parsed =
		trimmed.includes('<rss') || trimmed.includes('<channel')
			? parseRSSFeedEntries(feed.url, trimmed)
			: parseAtomFeedEntries(feed.url, trimmed);
	const deduped = new Map<string, ParsedFeedEntry>();
	for (const entry of parsed) {
		if (!entry.url || deduped.has(entry.url)) {
			continue;
		}
		deduped.set(entry.url, entry);
	}
	return [...deduped.values()];
};

const isFeedDocument = (value: string) => {
	const trimmed = value.trim();
	return (
		trimmed.includes('<rss') ||
		trimmed.includes('<channel') ||
		trimmed.includes('<feed') ||
		trimmed.includes('<entry')
	);
};

const discoverFeedsFromHTML = async (feed: RAGFeedSyncInput) => {
	const response = await fetch(feed.url);
	if (!response.ok) {
		return [];
	}
	const text = await response.text();
	if (isFeedDocument(text)) {
		return [feed];
	}

	const discovered = new Map<string, RAGFeedSyncInput>();
	const addCandidate = (candidate: string | undefined) => {
		if (!candidate) {
			return;
		}
		const resolved = resolveFeedEntryURL(feed.url, candidate);
		if (!discovered.has(resolved)) {
			discovered.set(resolved, {
				metadata: feed.metadata,
				title: feed.title,
				url: resolved
			});
		}
	};

	for (const match of text.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0] ?? '';
		const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase();
		const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase();
		const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
		if (!href || !rel?.includes('alternate')) {
			continue;
		}
		if (
			type?.includes('rss') ||
			type?.includes('atom') ||
			type?.includes('xml')
		) {
			addCandidate(href);
		}
	}

	for (const path of [
		'/feed.xml',
		'/rss.xml',
		'/atom.xml',
		'/feed',
		'/rss',
		'/atom'
	]) {
		addCandidate(resolveSiblingURL(feed.url, path));
	}

	const validated: RAGFeedSyncInput[] = [];
	for (const candidate of discovered.values()) {
		const candidateResponse = await fetch(candidate.url);
		if (!candidateResponse.ok) {
			continue;
		}
		const candidateText = await candidateResponse.text();
		if (!isFeedDocument(candidateText)) {
			continue;
		}
		validated.push(candidate);
	}

	return validated;
};

type ParsedSitemapEntry = {
	url: string;
};

const resolveSiblingURL = (baseURL: string, nextPath: string) => {
	try {
		const base = new URL(baseURL);
		return new URL(nextPath, `${base.origin}/`).toString();
	} catch {
		return nextPath;
	}
};

const parseSitemapURLSetEntries = (
	sitemap: RAGSitemapSyncInput,
	value: string
) => {
	const entries: ParsedSitemapEntry[] = [];
	for (const urlMatch of value.matchAll(/<url\b[\s\S]*?<\/url>/gi)) {
		const block = urlMatch[0] ?? '';
		const location = block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1];
		const normalized = extractFeedText(location ?? '');
		if (!normalized) {
			continue;
		}
		entries.push({
			url: resolveFeedEntryURL(sitemap.url, normalized)
		});
	}
	return entries;
};

const parseSitemapIndexEntries = (
	sitemap: RAGSitemapSyncInput,
	value: string
) => {
	const entries: ParsedSitemapEntry[] = [];
	for (const sitemapMatch of value.matchAll(
		/<sitemap\b[\s\S]*?<\/sitemap>/gi
	)) {
		const block = sitemapMatch[0] ?? '';
		const location = block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1];
		const normalized = extractFeedText(location ?? '');
		if (!normalized) {
			continue;
		}
		entries.push({
			url: resolveFeedEntryURL(sitemap.url, normalized)
		});
	}
	return entries;
};

const parseSitemapEntries = (sitemap: RAGSitemapSyncInput, value: string) => {
	const trimmed = value.trim();
	const parsed = trimmed.includes('<sitemapindex')
		? parseSitemapIndexEntries(sitemap, trimmed)
		: parseSitemapURLSetEntries(sitemap, trimmed);
	const deduped = new Map<string, ParsedSitemapEntry>();
	for (const entry of parsed) {
		if (!entry.url || deduped.has(entry.url)) {
			continue;
		}
		deduped.set(entry.url, entry);
	}
	return [...deduped.values()];
};

const discoverSitemapsFromRobots = async (sitemap: RAGSitemapSyncInput) => {
	const robotsURL = resolveSiblingURL(sitemap.url, '/robots.txt');
	const response = await fetch(robotsURL);
	if (!response.ok) {
		return [];
	}
	const text = await response.text();
	const discovered: RAGSitemapSyncInput[] = [];
	for (const match of text.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)) {
		const candidate = match[1]?.trim();
		if (!candidate) {
			continue;
		}
		discovered.push({
			metadata: sitemap.metadata,
			title: sitemap.title,
			url: resolveFeedEntryURL(robotsURL, candidate)
		});
	}
	return discovered;
};

const loadRobotsDisallowRules = async (siteURL: string) => {
	const robotsURL = resolveSiblingURL(siteURL, '/robots.txt');
	const response = await fetch(robotsURL);
	if (!response.ok) {
		return [];
	}
	const text = await response.text();
	const rules: string[] = [];
	let inGlobalAgent = false;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+#.*$/, '').trim();
		if (!line) {
			continue;
		}
		const agentMatch = line.match(/^User-agent:\s*(.+)$/i);
		if (agentMatch) {
			inGlobalAgent = agentMatch[1]?.trim() === '*';
			continue;
		}
		if (!inGlobalAgent) {
			continue;
		}
		const disallowMatch = line.match(/^Disallow:\s*(.*)$/i);
		const path = disallowMatch?.[1]?.trim();
		if (typeof path === 'string' && path.length > 0) {
			rules.push(path);
		}
	}
	return rules;
};

const discoverRecursiveSitemapURLs = async (input: {
	sitemap: RAGSitemapSyncInput;
	maxNestedSitemaps?: number;
}): Promise<RAGSitemapSyncInput[]> => {
	const queue: Array<{ depth: number; sitemap: RAGSitemapSyncInput }> = [
		{ depth: 0, sitemap: input.sitemap }
	];
	const seen = new Set<string>();
	const resolved: RAGSitemapSyncInput[] = [];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || seen.has(current.sitemap.url)) {
			continue;
		}
		seen.add(current.sitemap.url);
		resolved.push(current.sitemap);

		const response = await fetch(current.sitemap.url);
		if (!response.ok) {
			throw new Error(
				`Failed to load sitemap ${current.sitemap.url}: ${response.status} ${response.statusText}`
			);
		}
		const text = await response.text();
		if (!text.includes('<sitemapindex')) {
			continue;
		}
		if (
			typeof input.maxNestedSitemaps === 'number' &&
			current.depth >= Math.max(0, input.maxNestedSitemaps)
		) {
			continue;
		}

		for (const nested of parseSitemapIndexEntries(current.sitemap, text)) {
			queue.push({
				depth: current.depth + 1,
				sitemap: {
					metadata: current.sitemap.metadata,
					title: current.sitemap.title,
					url: nested.url
				}
			});
		}
	}

	return resolved;
};

const normalizeOrigin = (value: string) => {
	try {
		return new URL(value).origin;
	} catch {
		return undefined;
	}
};

const isLikelyHTMLDocument = (value: string, contentType?: string | null) => {
	const normalizedType = contentType?.toLowerCase() ?? '';
	if (
		normalizedType.includes('text/html') ||
		normalizedType.includes('application/xhtml+xml')
	) {
		return true;
	}
	const trimmed = value.trim();
	return (
		trimmed.startsWith('<!doctype html') ||
		trimmed.startsWith('<html') ||
		trimmed.includes('<body') ||
		trimmed.includes('<a ')
	);
};

const getCanonicalURL = (pageURL: string, value: string) => {
	const href =
		value.match(
			/<link\b[^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i
		)?.[1] ??
		value.match(
			/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i
		)?.[1];
	if (!href) {
		return pageURL;
	}
	return resolveFeedEntryURL(pageURL, href.trim());
};

const getRobotsMeta = (value: string) =>
	value
		.match(
			/<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i
		)?.[1]
		?.toLowerCase() ??
	value
		.match(
			/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']robots["'][^>]*>/i
		)?.[1]
		?.toLowerCase();

const normalizeCanonicalURL = (value: string) => {
	try {
		const url = new URL(value);
		url.hash = '';
		const query = new URLSearchParams(url.search);
		const kept = new URLSearchParams();
		for (const [key, rawValue] of query.entries()) {
			if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) {
				continue;
			}
			kept.append(key, rawValue);
		}
		const search = kept.toString();
		url.search = search ? `?${search}` : '';
		return url.toString();
	} catch {
		return value;
	}
};

const isBlockedByRobotsRules = (url: string, disallowRules: string[]) => {
	try {
		const path = new URL(url).pathname;
		return disallowRules.some(
			(rule) => rule !== '/' && path.startsWith(rule)
		);
	} catch {
		return false;
	}
};

const buildDiscoveryPruneDiagnostics = (counts: {
	canonicalDedupedCount: number;
	robotsBlockedCount: number;
	nofollowSkippedCount: number;
	noindexSkippedCount: number;
}): RAGSyncSourceDiagnostics | undefined => {
	const entries: RAGSyncSourceDiagnostics['entries'] = [];

	if (counts.canonicalDedupedCount > 0) {
		entries.push({
			code: 'canonical_dedupe_applied',
			severity: 'info',
			summary: `${counts.canonicalDedupedCount} discovered page candidate${counts.canonicalDedupedCount === 1 ? '' : 's'} were collapsed onto canonical URLs`
		});
	}
	if (counts.robotsBlockedCount > 0) {
		entries.push({
			code: 'robots_blocked',
			severity: 'info',
			summary: `${counts.robotsBlockedCount} page candidate${counts.robotsBlockedCount === 1 ? '' : 's'} were skipped by robots rules`
		});
	}
	if (counts.nofollowSkippedCount > 0) {
		entries.push({
			code: 'nofollow_skipped',
			severity: 'info',
			summary: `${counts.nofollowSkippedCount} HTML page${counts.nofollowSkippedCount === 1 ? '' : 's'} stopped link expansion because of nofollow`
		});
	}
	if (counts.noindexSkippedCount > 0) {
		entries.push({
			code: 'noindex_skipped',
			severity: 'info',
			summary: `${counts.noindexSkippedCount} page${counts.noindexSkippedCount === 1 ? '' : 's'} were excluded because of noindex`
		});
	}

	if (entries.length === 0) {
		return undefined;
	}

	return {
		entries,
		summary: entries.map((entry) => entry.summary).join(' | ')
	};
};

const discoverLinkedPagesFromHTML = async (input: {
	site: RAGSiteDiscoveryInput;
	seedURLs: string[];
	maxLinkedPages?: number;
	maxLinksPerPage?: number;
	maxLinkDepth?: number;
}) => {
	const siteOrigin = normalizeOrigin(input.site.url);
	if (!siteOrigin) {
		return {
			diagnostics: undefined,
			pages: []
		};
	}
	const disallowRules = await loadRobotsDisallowRules(input.site.url);

	const queue: Array<{ depth: number; url: string }> = input.seedURLs.map(
		(url) => ({
			depth: 0,
			url
		})
	);
	const seenPages = new Set<string>();
	const excludedPages = new Set<string>();
	const discovered = new Map<
		string,
		{ metadata?: Record<string, unknown>; title?: string; url: string }
	>();
	const pruneCounts = {
		canonicalDedupedCount: 0,
		nofollowSkippedCount: 0,
		noindexSkippedCount: 0,
		robotsBlockedCount: 0
	};
	const maxDepth = Math.max(0, input.maxLinkDepth ?? 0);
	const maxPages = Math.max(1, input.maxLinkedPages ?? 25);
	const maxLinksPerPage = Math.max(1, input.maxLinksPerPage ?? 20);

	while (queue.length > 0 && discovered.size < maxPages) {
		const current = queue.shift();
		if (!current || seenPages.has(current.url)) {
			continue;
		}
		seenPages.add(current.url);

		const currentOrigin = normalizeOrigin(current.url);
		if (!currentOrigin || currentOrigin !== siteOrigin) {
			continue;
		}
		if (isBlockedByRobotsRules(current.url, disallowRules)) {
			pruneCounts.robotsBlockedCount += 1;
			continue;
		}

		const response = await fetch(current.url);
		if (!response.ok) {
			continue;
		}
		const text = await response.text();
		if (!isLikelyHTMLDocument(text, response.headers.get('content-type'))) {
			continue;
		}
		const robotsMeta = getRobotsMeta(text);
		if (robotsMeta?.includes('nofollow')) {
			pruneCounts.nofollowSkippedCount += 1;
			continue;
		}
		const canonicalURL = normalizeCanonicalURL(
			getCanonicalURL(current.url, text)
		);
		if (canonicalURL !== current.url) {
			pruneCounts.canonicalDedupedCount += 1;
		}
		if (robotsMeta?.includes('noindex')) {
			pruneCounts.noindexSkippedCount += 1;
			excludedPages.add(current.url);
			excludedPages.add(canonicalURL);
			discovered.delete(current.url);
			discovered.delete(canonicalURL);
			seenPages.add(canonicalURL);
			continue;
		}
		if (canonicalURL !== current.url && seenPages.has(canonicalURL)) {
			pruneCounts.canonicalDedupedCount += 1;
			continue;
		}
		seenPages.add(canonicalURL);

		let linksSeen = 0;
		for (const match of text.matchAll(
			/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi
		)) {
			if (linksSeen >= maxLinksPerPage || discovered.size >= maxPages) {
				break;
			}
			const href = match[1]?.trim();
			if (!href) {
				continue;
			}
			const rawResolved = resolveFeedEntryURL(canonicalURL, href);
			const resolved = normalizeCanonicalURL(rawResolved);
			if (resolved !== rawResolved) {
				pruneCounts.canonicalDedupedCount += 1;
			}
			if (resolved === current.url || resolved === canonicalURL) {
				if (resolved === canonicalURL) {
					pruneCounts.canonicalDedupedCount += 1;
				}
				continue;
			}
			const resolvedOrigin = normalizeOrigin(resolved);
			if (!resolvedOrigin || resolvedOrigin !== siteOrigin) {
				continue;
			}
			if (isBlockedByRobotsRules(resolved, disallowRules)) {
				pruneCounts.robotsBlockedCount += 1;
				continue;
			}
			if (excludedPages.has(resolved)) {
				continue;
			}
			if (
				/\.(xml|rss|atom|json|jsonl|csv|tsv|pdf|png|jpg|jpeg|gif|webp|svg|zip)(?:[?#].*)?$/i.test(
					resolved
				)
			) {
				continue;
			}
			linksSeen += 1;
			if (!discovered.has(resolved)) {
				discovered.set(resolved, {
					metadata: {
						crawlDepth: current.depth + 1,
						discoveredFromUrl: canonicalURL,
						siteTitle: input.site.title,
						siteUrl: input.site.url
					},
					url: resolved
				});
			}
			if (
				current.depth < maxDepth &&
				!seenPages.has(resolved) &&
				!queue.some((entry) => entry.url === resolved)
			) {
				queue.push({
					depth: current.depth + 1,
					url: resolved
				});
			}
		}
	}

	return {
		diagnostics: buildDiscoveryPruneDiagnostics(pruneCounts),
		pages: [...discovered.values()].filter(
			(entry) => !excludedPages.has(entry.url)
		)
	};
};

const loadDiscoveredURLDocuments = async (input: {
	sourceId: string;
	collection: RAGCollection;
	deleteDocument?: (id: string) => Promise<boolean> | boolean;
	listDocuments?: () => Promise<RAGIndexedDocument[]> | RAGIndexedDocument[];
	chunkingRegistry?: RAGChunkingRegistryLike;
	defaultChunking?: RAGChunkingOptions;
	extractorRegistry?: RAGFileExtractorRegistryLike;
	extractors?: RAGFileExtractor[];
	baseMetadata?: Record<string, unknown>;
	urlEntries: Array<{
		url: string;
		title?: string;
		metadata?: Record<string, unknown>;
	}>;
}): Promise<RAGSyncSourceRunResult> => {
	const extractionFailures: RAGSyncExtractionFailure[] = [];
	const seen = new Set<string>();
	const dedupedEntries = input.urlEntries.filter((entry) => {
		if (!entry.url || seen.has(entry.url)) {
			return false;
		}
		seen.add(entry.url);
		return true;
	});

	const loadedDocuments = await Promise.all(
		dedupedEntries.map(async (entry) => {
			try {
				const document = await loadRAGDocumentFromURL({
					chunking: input.defaultChunking,
					extractorRegistry: input.extractorRegistry,
					extractors: input.extractors,
					metadata: entry.metadata,
					title: entry.title,
					url: entry.url
				});

				return [
					{
						...document,
						metadata: mergeMetadata(
							document.metadata,
							{
								sourceUrl: entry.url
							},
							input.baseMetadata
						)
					}
				];
			} catch (caught) {
				const message = toSyncError(caught);
				if (!isSyncExtractionFailure(message)) {
					throw caught;
				}
				extractionFailures.push(
					buildSyncExtractionFailure({
						error: message,
						itemKind: 'url',
						itemLabel: entry.url
					})
				);
				return [];
			}
		})
	);
	const managedDocuments = loadedDocuments
		.flat()
		.map((document) =>
			toManagedSyncDocument(
				input.sourceId,
				document,
				typeof document.metadata?.sourceUrl === 'string'
					? document.metadata.sourceUrl
					: (document.source ?? document.title ?? '')
			)
		);
	const reconciled = await reconcileManagedDocuments({
		chunkingRegistry: input.chunkingRegistry,
		collection: input.collection,
		defaultChunking: input.defaultChunking,
		deleteDocument: input.deleteDocument ?? (() => false),
		documents: managedDocuments,
		listDocuments: input.listDocuments ?? (() => []),
		sourceId: input.sourceId
	});

	return {
		chunkCount: reconciled.chunkCount,
		diagnostics: buildExtractionFailureDiagnostics(extractionFailures),
		documentCount: reconciled.documentCount,
		reconciliation: reconciled.reconciliation,
		metadata: {
			deletedCount: reconciled.deletedCount,
			updatedCount: reconciled.updatedCount
		}
	};
};

type GitHubContentsItem = {
	type?: 'file' | 'dir' | 'submodule' | 'symlink';
	path?: string;
	name?: string;
	download_url?: string | null;
	url?: string;
};

type GitHubDiscoveredFile = {
	metadata: Record<string, unknown>;
	path: string;
	url: string;
	repository: string;
	repoPath: string;
	repoBranch?: string;
	source: string;
	title?: string;
};

const normalizeGitHubPath = (path: string | undefined) =>
	path
		?.trim()
		.replace(/^[\\/]+/g, '')
		.replace(/[\\]+/g, '/')
		.replace(/\/+/g, '/')
		.replace(/\/$/, '');

const normalizeGitHubPathFilter = (path: string | undefined) =>
	normalizeGitHubPath(path)?.toLowerCase();

const matchesPathFilter = (path: string, pattern: string) => {
	const normalizedPath = normalizeGitHubPath(path)?.toLowerCase();
	const normalizedPattern = normalizeGitHubPathFilter(pattern);
	if (!normalizedPath || !normalizedPattern) {
		return false;
	}

	const isDirectory = normalizedPattern.endsWith('/');
	const patternWithoutTrailingSlash = isDirectory
		? normalizedPattern.replace(/\/$/, '')
		: normalizedPattern;

	if (normalizedPath === patternWithoutTrailingSlash) {
		return true;
	}

	if (
		isDirectory &&
		normalizedPath.startsWith(`${patternWithoutTrailingSlash}/`)
	) {
		return true;
	}

	return normalizedPath.includes(normalizedPattern);
};

const shouldIncludeGitHubPath = (
	path: string,
	input: {
		includeExtensions: Set<string>;
		includePaths?: string[];
		excludePaths?: string[];
	}
) => {
	const normalizedPath = normalizeGitHubPath(path)?.toLowerCase();
	if (!normalizedPath) {
		return false;
	}

	const extension = normalizedPath.includes('.')
		? normalizedPath.slice(normalizedPath.lastIndexOf('.'))
		: '';
	if (!input.includeExtensions.has(extension)) {
		return false;
	}

	if ((input.includePaths?.length ?? 0) > 0) {
		const matchedInclude = input.includePaths?.some((pattern) =>
			matchesPathFilter(normalizedPath, pattern)
		);
		if (!matchedInclude) {
			return false;
		}
	}

	if ((input.excludePaths?.length ?? 0) > 0) {
		if (
			(input.excludePaths ?? []).some((pattern) =>
				matchesPathFilter(normalizedPath, pattern)
			)
		) {
			return false;
		}
	}

	return true;
};

const buildGitHubHeaders = (token?: string) => {
	if (!token) {
		return undefined;
	}

	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};
};

const buildGitHubContentsURL = (input: {
	apiBaseURL: string;
	repo: RAGGitHubRepoSyncInput;
	path?: string;
	branch?: string;
}) => {
	const apiBase = input.apiBaseURL.replace(/\/$/, '');
	const normalizedPath = normalizeGitHubPath(input.path);
	const encodedPath =
		normalizedPath
			?.split('/')
			.filter(Boolean)
			.map((segment) => encodeURIComponent(segment))
			.join('/') ?? '';
	const endpoint = `/repos/${encodeURIComponent(input.repo.owner)}/${encodeURIComponent(input.repo.repo)}/contents`;
	const url = new URL(
		encodedPath ? `${endpoint}/${encodedPath}` : endpoint,
		`${apiBase}/`
	);
	if (input.branch) {
		url.searchParams.set('ref', input.branch);
	}

	url.searchParams.set('per_page', '100');

	return url.toString();
};

const parseGitHubContents = async (
	response: Response,
	path: string
): Promise<GitHubContentsItem[]> => {
	const body = await response.json();
	if (Array.isArray(body)) {
		return body as GitHubContentsItem[];
	}
	if (
		body &&
		typeof body === 'object' &&
		typeof (body as GitHubContentsItem).type === 'string'
	) {
		return [body as GitHubContentsItem];
	}

	throw new Error(`Unexpected GitHub contents response at ${path}`);
};

const buildGitHubRawURL = (input: {
	repo: RAGGitHubRepoSyncInput;
	path: string;
	branch?: string;
	fallbackDownloadURL?: string | null;
}) => {
	if (
		input.fallbackDownloadURL &&
		typeof input.fallbackDownloadURL === 'string'
	) {
		return input.fallbackDownloadURL;
	}

	const branch = input.branch ?? 'main';
	const encodedPath =
		normalizeGitHubPath(input.path)
			?.split('/')
			.filter(Boolean)
			.map((segment) => encodeURIComponent(segment))
			.join('/') ?? '';

	return `https://raw.githubusercontent.com/${encodeURIComponent(input.repo.owner)}/${encodeURIComponent(input.repo.repo)}/${encodeURIComponent(branch)}/${encodedPath}`;
};

const loadDiscoveredGitHubRepositoryFiles = async (input: {
	includeExtensions: Set<string>;
	maxDepth: number;
	maxFilesPerRepo?: number;
	repo: RAGGitHubRepoSyncInput;
	apiBaseURL: string;
	requestHeaders?: ReturnType<typeof buildGitHubHeaders>;
	source: string;
	branch?: string;
	defaults?: {
		repoMetadata?: Record<string, unknown>;
	};
}): Promise<GitHubDiscoveredFile[]> => {
	const queue: Array<{ depth: number; path: string | undefined }> = [
		{ depth: 0, path: normalizeGitHubPath(input.repo.pathPrefix) }
	];
	const seen = new Set<string>();
	const collected: GitHubDiscoveredFile[] = [];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) {
			continue;
		}

		const currentPath = normalizeGitHubPath(current.path) ?? '';
		if (seen.has(currentPath)) {
			continue;
		}
		seen.add(currentPath);

		const requestURL = buildGitHubContentsURL({
			apiBaseURL: input.apiBaseURL,
			branch: input.branch ?? input.repo.branch,
			path: currentPath,
			repo: input.repo
		});
		const response = await fetch(requestURL, {
			headers: input.requestHeaders
		});
		if (!response.ok) {
			throw new Error(
				`Failed to list GitHub repo contents at ${currentPath || `${input.repo.owner}/${input.repo.repo}`}: ${response.status} ${response.statusText}`
			);
		}

		const entries = await parseGitHubContents(response, requestURL);
		for (const entry of entries) {
			if (
				typeof entry.path !== 'string' ||
				typeof entry.type !== 'string'
			) {
				continue;
			}

			if (entry.type === 'file') {
				if (
					!shouldIncludeGitHubPath(entry.path, {
						excludePaths: input.repo.excludePaths,
						includeExtensions: input.includeExtensions,
						includePaths: input.repo.includePaths
					})
				) {
					continue;
				}
				const repoBranch = input.repo.branch ?? input.branch;
				const fileURL = buildGitHubRawURL({
					repo: input.repo,
					branch: repoBranch,
					fallbackDownloadURL: entry.download_url,
					path: entry.path
				});
				const fileRepo = `${input.repo.owner}/${input.repo.repo}`;
				collected.push({
					repository: fileRepo,
					repoBranch,
					repoPath: currentPath,
					metadata: {
						...(input.defaults?.repoMetadata ?? {}),
						repo: fileRepo,
						repoBranch,
						repoName: input.repo.repo,
						repoOwner: input.repo.owner,
						repoPath: entry.path,
						...(input.repo.metadata ?? {}),
						source: input.source
					},
					source: input.source,
					path: entry.path,
					title: `${input.repo.owner}/${input.repo.repo}:${entry.path}`,
					url: fileURL
				});

				if (
					typeof input.maxFilesPerRepo === 'number' &&
					collected.length >= input.maxFilesPerRepo
				) {
					return collected;
				}
				continue;
			}

			if (entry.type === 'dir' && current.depth < input.maxDepth) {
				queue.push({ depth: current.depth + 1, path: entry.path });
			}
		}
	}

	return collected;
};

const buildGitHubExtensionSet = (value?: string[]) => {
	const extensionValues =
		value === undefined || value.length === 0
			? DEFAULT_GITHUB_EXTENSION_FILTER
			: value;
	const extensions = new Set<string>();
	for (const raw of extensionValues) {
		const normalized =
			typeof raw === 'string' && raw.trim().length > 0
				? raw.trim().startsWith('.')
					? raw.trim().toLowerCase()
					: `.${raw.trim().toLowerCase()}`
				: undefined;
		if (normalized) {
			extensions.add(normalized);
		}
	}

	if (extensions.size === 0) {
		for (const extension of DEFAULT_GITHUB_EXTENSION_FILTER) {
			extensions.add(extension);
		}
	}

	return extensions;
};

export const createRAGGitHubSyncSource = (
	options: RAGGitHubSyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'url',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target:
		options.repos.length === 1
			? `${options.repos[0]?.owner ?? 'unknown'}/${options.repos[0]?.repo ?? 'repo'}`
			: `${options.repos.length} repos`,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const requestHeaders = buildGitHubHeaders(options.token);
		const extensionFilter = buildGitHubExtensionSet(
			options.includeExtensions
		);
		const apiBaseURL =
			options.apiBaseUrl?.trim().replace(/\/$/, '') ||
			'https://api.github.com';
		const maxDepth = Math.max(
			0,
			Math.min(options.maxDepth ?? DEFAULT_GITHUB_MAX_DEPTH, 64)
		);
		const discoveredFiles = (
			await Promise.all(
				options.repos.map(async (repo) => {
					return loadDiscoveredGitHubRepositoryFiles({
						branch: repo.branch,
						apiBaseURL,
						includeExtensions: extensionFilter,
						maxDepth,
						maxFilesPerRepo: options.maxFilesPerRepo,
						repo,
						requestHeaders,
						source: options.label,
						defaults: {
							repoMetadata: {
								repoOwner: repo.owner,
								repoName: repo.repo,
								repoBranch: repo.branch,
								repoPrefix: repo.pathPrefix ?? ''
							}
						}
					});
				})
			)
		).flat();
		const result = await loadDiscoveredURLDocuments({
			baseMetadata: options.baseMetadata,
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			extractorRegistry: options.extractorRegistry,
			extractors: options.extractors,
			listDocuments,
			sourceId: options.id,
			urlEntries: discoveredFiles.map((entry) => ({
				metadata: {
					...entry.metadata,
					repoPath: entry.path,
					repoBranch: entry.repoBranch,
					repo: entry.repository,
					sourcePath: entry.path
				},
				title: entry.title,
				url: entry.url
			}))
		});

		return {
			...result,
			metadata: {
				...(result.metadata ?? {}),
				discoveredFileCount: discoveredFiles.length,
				repoCount: options.repos.length
			}
		};
	}
});

export const createRAGFeedSyncSource = (
	options: RAGFeedSyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'url',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target:
		options.feeds.length === 1
			? options.feeds[0]?.url
			: `${options.feeds.length} feeds`,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const feedMap = new Map<string, RAGFeedSyncInput>();
		const discoveredFeeds = options.autoDiscoverFromHTML
			? (
					await Promise.all(
						options.feeds.map(async (feed) => [
							feed,
							...(await discoverFeedsFromHTML(feed))
						])
					)
				).flat()
			: options.feeds;
		for (const feed of discoveredFeeds) {
			if (!feedMap.has(feed.url)) {
				feedMap.set(feed.url, feed);
			}
			if (
				typeof options.maxDiscoveredFeeds === 'number' &&
				feedMap.size >= Math.max(1, options.maxDiscoveredFeeds)
			) {
				break;
			}
		}
		const discoveredEntries = (
			await Promise.all(
				[...feedMap.values()].map(async (feed) => {
					const response = await fetch(feed.url);
					if (!response.ok) {
						throw new Error(
							`Failed to load feed ${feed.url}: ${response.status} ${response.statusText}`
						);
					}
					const text = await response.text();
					const entries = parseFeedEntries(feed, text);
					const limited =
						typeof options.maxEntriesPerFeed === 'number'
							? entries.slice(
									0,
									Math.max(1, options.maxEntriesPerFeed)
								)
							: entries;
					return limited.map((entry) => ({
						entry,
						feed
					}));
				})
			)
		).flat();
		const result = await loadDiscoveredURLDocuments({
			baseMetadata: options.baseMetadata,
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			extractorRegistry: options.extractorRegistry,
			extractors: options.extractors,
			listDocuments,
			sourceId: options.id,
			urlEntries: discoveredEntries.map(({ entry, feed }) => ({
				metadata: {
					...(feed.metadata ?? {}),
					feedTitle: feed.title,
					feedUrl: feed.url,
					feedEntryTitle: entry.title
				},
				title: entry.title,
				url: entry.url
			}))
		});

		return {
			...result,
			metadata: {
				...(result.metadata ?? {}),
				discoveredEntryCount: discoveredEntries.length,
				feedCount: feedMap.size
			}
		};
	}
});

export const createRAGSitemapSyncSource = (
	options: RAGSitemapSyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'url',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target:
		options.sitemaps.length === 1
			? options.sitemaps[0]?.url
			: `${options.sitemaps.length} sitemaps`,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const seedSitemaps = options.autoDiscoverFromRobots
			? (
					await Promise.all(
						options.sitemaps.map(async (sitemap) => [
							sitemap,
							...(await discoverSitemapsFromRobots(sitemap))
						])
					)
				).flat()
			: options.sitemaps;
		const sitemapMap = new Map<string, RAGSitemapSyncInput>();
		for (const sitemap of seedSitemaps) {
			if (!sitemapMap.has(sitemap.url)) {
				sitemapMap.set(sitemap.url, sitemap);
			}
		}
		const recursiveSitemaps = (
			await Promise.all(
				[...sitemapMap.values()].map((sitemap) =>
					discoverRecursiveSitemapURLs({
						maxNestedSitemaps: options.maxNestedSitemaps,
						sitemap
					})
				)
			)
		).flat();
		const resolvedSitemapMap = new Map<string, RAGSitemapSyncInput>();
		for (const sitemap of recursiveSitemaps) {
			if (!resolvedSitemapMap.has(sitemap.url)) {
				resolvedSitemapMap.set(sitemap.url, sitemap);
			}
		}
		const discoveredEntries = (
			await Promise.all(
				[...resolvedSitemapMap.values()].map(async (sitemap) => {
					const response = await fetch(sitemap.url);
					if (!response.ok) {
						throw new Error(
							`Failed to load sitemap ${sitemap.url}: ${response.status} ${response.statusText}`
						);
					}
					const text = await response.text();
					const entries = parseSitemapEntries(sitemap, text).filter(
						(entry) => !entry.url.endsWith('.xml')
					);
					const limited =
						typeof options.maxUrlsPerSitemap === 'number'
							? entries.slice(
									0,
									Math.max(1, options.maxUrlsPerSitemap)
								)
							: entries;
					return limited.map((entry) => ({
						entry,
						sitemap
					}));
				})
			)
		).flat();
		const result = await loadDiscoveredURLDocuments({
			baseMetadata: options.baseMetadata,
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			extractorRegistry: options.extractorRegistry,
			extractors: options.extractors,
			listDocuments,
			sourceId: options.id,
			urlEntries: discoveredEntries.map(({ entry, sitemap }) => ({
				metadata: {
					...(sitemap.metadata ?? {}),
					sitemapTitle: sitemap.title,
					sitemapUrl: sitemap.url
				},
				url: entry.url
			}))
		});

		return {
			...result,
			metadata: {
				...(result.metadata ?? {}),
				discoveredUrlCount: discoveredEntries.length,
				sitemapCount: resolvedSitemapMap.size
			}
		};
	}
});

// Build-time app sitemap generation lives in src/utils/generateSitemap.ts.
// This source is only for external-site discovery into a RAG corpus.
export const createRAGSiteDiscoverySyncSource = (
	options: RAGSiteDiscoverySyncSourceOptions
): RAGSyncSourceDefinition => ({
	description: options.description,
	id: options.id,
	kind: 'url',
	label: options.label,
	metadata: options.metadata,
	retryAttempts: options.retryAttempts,
	retryDelayMs: options.retryDelayMs,
	target:
		options.sites.length === 1
			? options.sites[0]?.url
			: `${options.sites.length} sites`,
	sync: async ({ collection, deleteDocument, listDocuments }) => {
		const discoveredURLMap = new Map<
			string,
			{ title?: string; metadata?: Record<string, unknown>; url: string }
		>();
		let discoveryDiagnostics: RAGSyncSourceDiagnostics | undefined;

		for (const site of options.sites) {
			if (options.autoDiscoverFeeds !== false) {
				const feedMap = new Map<string, RAGFeedSyncInput>();
				for (const feed of [
					site,
					...(await discoverFeedsFromHTML(site))
				]) {
					if (!feedMap.has(feed.url)) {
						feedMap.set(feed.url, feed);
					}
					if (
						typeof options.maxDiscoveredFeeds === 'number' &&
						feedMap.size >= Math.max(1, options.maxDiscoveredFeeds)
					) {
						break;
					}
				}
				const feedEntries = (
					await Promise.all(
						[...feedMap.values()].map(async (feed) => {
							const response = await fetch(feed.url);
							if (!response.ok) {
								throw new Error(
									`Failed to load feed ${feed.url}: ${response.status} ${response.statusText}`
								);
							}
							const text = await response.text();
							const entries = parseFeedEntries(feed, text);
							return (
								typeof options.maxEntriesPerFeed === 'number'
									? entries.slice(
											0,
											Math.max(
												1,
												options.maxEntriesPerFeed
											)
										)
									: entries
							).map((entry) => ({
								metadata: {
									...(site.metadata ?? {}),
									...(feed.metadata ?? {}),
									feedTitle: feed.title,
									feedUrl: feed.url,
									feedEntryTitle: entry.title,
									siteTitle: site.title,
									siteUrl: site.url
								},
								title: entry.title,
								url: entry.url
							}));
						})
					)
				).flat();
				for (const entry of feedEntries) {
					if (!discoveredURLMap.has(entry.url)) {
						discoveredURLMap.set(entry.url, entry);
					}
				}
			}

			if (options.autoDiscoverSitemaps !== false) {
				const seedSitemaps = [
					{
						metadata: site.metadata,
						title: site.title,
						url: resolveSiblingURL(site.url, '/sitemap.xml')
					},
					...(await discoverSitemapsFromRobots({
						metadata: site.metadata,
						title: site.title,
						url: site.url
					}))
				];
				const sitemapMap = new Map<string, RAGSitemapSyncInput>();
				for (const sitemap of seedSitemaps) {
					if (!sitemapMap.has(sitemap.url)) {
						sitemapMap.set(sitemap.url, sitemap);
					}
				}
				const resolvedSitemaps = (
					await Promise.all(
						[...sitemapMap.values()].map((sitemap) =>
							discoverRecursiveSitemapURLs({
								maxNestedSitemaps: options.maxNestedSitemaps,
								sitemap
							})
						)
					)
				).flat();
				const sitemapEntries = (
					await Promise.all(
						resolvedSitemaps.map(async (sitemap) => {
							const response = await fetch(sitemap.url);
							if (!response.ok) {
								throw new Error(
									`Failed to load sitemap ${sitemap.url}: ${response.status} ${response.statusText}`
								);
							}
							const text = await response.text();
							const entries = parseSitemapEntries(
								sitemap,
								text
							).filter((entry) => !entry.url.endsWith('.xml'));
							return (
								typeof options.maxUrlsPerSitemap === 'number'
									? entries.slice(
											0,
											Math.max(
												1,
												options.maxUrlsPerSitemap
											)
										)
									: entries
							).map((entry) => ({
								metadata: {
									...(site.metadata ?? {}),
									...(sitemap.metadata ?? {}),
									siteTitle: site.title,
									siteUrl: site.url,
									sitemapTitle: sitemap.title,
									sitemapUrl: sitemap.url
								},
								url: entry.url
							}));
						})
					)
				).flat();
				for (const entry of sitemapEntries) {
					if (!discoveredURLMap.has(entry.url)) {
						discoveredURLMap.set(entry.url, entry);
					}
				}
			}
		}

		if (options.autoDiscoverLinkedPages) {
			for (const site of options.sites) {
				const seedURLs = [
					site.url,
					...[...discoveredURLMap.values()]
						.filter((entry) => {
							const entrySiteURL =
								typeof entry.metadata?.siteUrl === 'string'
									? entry.metadata.siteUrl
									: undefined;
							return entrySiteURL
								? entrySiteURL === site.url
								: true;
						})
						.map((entry) => entry.url)
				];
				const linkedPages = await discoverLinkedPagesFromHTML({
					maxLinkDepth: options.maxLinkDepth,
					maxLinkedPages: options.maxLinkedPages,
					maxLinksPerPage: options.maxLinksPerPage,
					seedURLs,
					site
				});
				discoveryDiagnostics = mergeSyncDiagnostics(
					discoveryDiagnostics,
					linkedPages.diagnostics
				);
				for (const entry of linkedPages.pages) {
					if (!discoveredURLMap.has(entry.url)) {
						discoveredURLMap.set(entry.url, entry);
					}
				}
			}
		}

		const result = await loadDiscoveredURLDocuments({
			baseMetadata: options.baseMetadata,
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			extractorRegistry: options.extractorRegistry,
			extractors: options.extractors,
			listDocuments,
			sourceId: options.id,
			urlEntries: [...discoveredURLMap.values()]
		});

		return {
			...result,
			diagnostics: mergeSyncDiagnostics(
				discoveryDiagnostics,
				result.diagnostics
			),
			metadata: {
				...(result.metadata ?? {}),
				discoveredUrlCount: discoveredURLMap.size,
				siteCount: options.sites.length
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
		const extractionFailures: RAGSyncExtractionFailure[] = [];
		const loadedDocuments = await Promise.all(
			options.urls.map(async (urlInput) => {
				try {
					const document = await loadRAGDocumentFromURL({
						...urlInput,
						extractorRegistry:
							urlInput.extractorRegistry ??
							options.extractorRegistry,
						extractors: urlInput.extractors ?? options.extractors
					});

					return [
						{
							...document,
							metadata: mergeMetadata(
								document.metadata,
								{ sourceUrl: urlInput.url },
								options.baseMetadata
							)
						}
					];
				} catch (caught) {
					const message = toSyncError(caught);
					if (!isSyncExtractionFailure(message)) {
						throw caught;
					}
					extractionFailures.push(
						buildSyncExtractionFailure({
							error: message,
							itemKind: 'url',
							itemLabel: urlInput.url
						})
					);
					return [];
				}
			})
		);
		const managedDocuments = loadedDocuments
			.flat()
			.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					typeof document.metadata?.sourceUrl === 'string'
						? document.metadata.sourceUrl
						: (document.source ?? document.title ?? '')
				)
			);
		const reconciled = await reconcileManagedDocuments({
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id
		});

		return {
			chunkCount: reconciled.chunkCount,
			diagnostics: buildExtractionFailureDiagnostics(extractionFailures),
			documentCount: reconciled.documentCount,
			reconciliation: reconciled.reconciliation,
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
	sync: async ({
		collection,
		deleteDocument,
		listDocuments,
		sourceRecord
	}) => {
		const storageListing =
			options.keys && options.keys.length > 0
				? {
						complete: true,
						keys: options.keys,
						pageCount: 1,
						resumeStartAfter: undefined as string | undefined
					}
				: await (async () => {
						const listed: string[] = [];
						let startAfter =
							options.resumeFromLastCursor === false
								? undefined
								: getSyncMetadataString(
										sourceRecord?.metadata,
										'resumeStartAfter'
									);
						let remaining = options.maxKeys;
						let pageCount = 0;
						let complete = false;

						for (;;) {
							const response = await options.client.list({
								maxKeys:
									typeof remaining === 'number'
										? Math.max(1, remaining)
										: undefined,
								prefix: options.prefix,
								startAfter
							});
							pageCount += 1;

							for (const entry of response.contents) {
								listed.push(entry.key);
								startAfter = entry.key;
								if (
									typeof remaining === 'number' &&
									listed.length >= remaining
								) {
									return {
										complete: false,
										keys: listed,
										pageCount,
										resumeStartAfter: startAfter
									};
								}
							}

							if (
								!response.isTruncated ||
								response.contents.length === 0
							) {
								complete = true;
								return {
									complete,
									keys: listed,
									pageCount,
									resumeStartAfter: undefined
								};
							}

							if (
								typeof options.maxPagesPerRun === 'number' &&
								pageCount >= Math.max(1, options.maxPagesPerRun)
							) {
								break;
							}

							if (typeof remaining === 'number') {
								remaining -= response.contents.length;
								if (remaining <= 0) {
									return {
										complete: false,
										keys: listed,
										pageCount,
										resumeStartAfter: startAfter
									};
								}
							}
						}

						return {
							complete,
							keys: listed,
							pageCount,
							resumeStartAfter: startAfter
						};
					})();
		const resolvedKeys = storageListing.keys;

		const uploads = await Promise.all(
			resolvedKeys.map(async (key) => {
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
		const extractionFailures: RAGSyncExtractionFailure[] = [];
		const loadedDocuments = await Promise.all(
			uploads.map(async (upload) => {
				try {
					const document = await loadRAGDocumentUpload({
						...upload,
						extractorRegistry: options.extractorRegistry,
						extractors: options.extractors
					});

					return [
						{
							...document,
							metadata: mergeMetadata(
								document.metadata,
								{ uploadFile: upload.name },
								options.baseMetadata
							)
						}
					];
				} catch (caught) {
					const message = toSyncError(caught);
					if (!isSyncExtractionFailure(message)) {
						throw caught;
					}
					extractionFailures.push(
						buildSyncExtractionFailure({
							error: message,
							itemKind: 'storage_object',
							itemLabel:
								typeof upload.metadata?.storageKey === 'string'
									? upload.metadata.storageKey
									: upload.name
						})
					);
					return [];
				}
			})
		);
		const managedDocuments = loadedDocuments
			.flat()
			.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					typeof document.metadata?.storageKey === 'string'
						? document.metadata.storageKey
						: (document.source ?? document.title ?? '')
				)
			);
		const reconciled = await reconcileManagedDocuments({
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id,
			allowDeletions: storageListing.complete
		});

		return {
			chunkCount: reconciled.chunkCount,
			diagnostics: buildExtractionFailureDiagnostics(extractionFailures),
			documentCount: reconciled.documentCount,
			reconciliation: reconciled.reconciliation,
			metadata: {
				deletedCount: reconciled.deletedCount,
				keyCount: resolvedKeys.length,
				listedPageCount: storageListing.pageCount,
				prefix: options.prefix,
				resumePending: storageListing.complete !== true,
				resumeStartAfter:
					storageListing.complete === true
						? undefined
						: storageListing.resumeStartAfter,
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
	sync: async ({
		collection,
		deleteDocument,
		listDocuments,
		sourceRecord
	}) => {
		const listed = await (async () => {
			let cursor =
				options.resumeFromLastCursor === false
					? undefined
					: getSyncMetadataString(
							sourceRecord?.metadata,
							'resumeNextCursor'
						);
			const messages: RAGEmailSyncMessage[] = [];
			let pageCount = 0;
			let nextCursor: string | undefined;

			for (;;) {
				const response = await options.client.listMessages({
					cursor,
					maxResults: options.maxResults
				});
				pageCount += 1;
				messages.push(...response.messages);
				nextCursor = response.nextCursor;
				if (!response.nextCursor) {
					break;
				}
				if (
					typeof options.maxPagesPerRun === 'number' &&
					pageCount >= Math.max(1, options.maxPagesPerRun)
				) {
					break;
				}
				cursor = response.nextCursor;
			}

			return {
				messages,
				nextCursor,
				pageCount,
				complete: !nextCursor
			};
		})();
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
		const extractionFailures: RAGSyncExtractionFailure[] = [];
		const loadedAttachments =
			attachmentUploads.length > 0
				? (
						await Promise.all(
							attachmentUploads.map(async (upload) => {
								try {
									const document =
										await loadRAGDocumentUpload({
											...upload,
											extractorRegistry:
												options.extractorRegistry,
											extractors: options.extractors
										});
									return [
										{
											...document,
											metadata: mergeMetadata(
												document.metadata,
												{ uploadFile: upload.name },
												options.baseMetadata
											)
										}
									];
								} catch (caught) {
									const message = toSyncError(caught);
									if (!isSyncExtractionFailure(message)) {
										throw caught;
									}
									extractionFailures.push(
										buildSyncExtractionFailure({
											error: message,
											itemKind: 'email_attachment',
											itemLabel: upload.name
										})
									);
									return [];
								}
							})
						)
					).flat()
				: [];
		const managedDocuments = [
			...messageDocuments.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					`message:${document.metadata?.messageId as string}`
				)
			),
			...loadedAttachments.map((document) =>
				toManagedSyncDocument(
					options.id,
					document,
					`attachment:${String(document.metadata?.attachmentId ?? document.source ?? document.title ?? '')}`
				)
			)
		];
		const reconciled = await reconcileManagedDocuments({
			chunkingRegistry: options.chunkingRegistry,
			collection,
			defaultChunking: options.defaultChunking,
			deleteDocument,
			documents: managedDocuments,
			listDocuments,
			sourceId: options.id,
			allowDeletions: listed.complete
		});

		return {
			chunkCount: reconciled.chunkCount,
			diagnostics: buildExtractionFailureDiagnostics(extractionFailures),
			documentCount: reconciled.documentCount,
			reconciliation: reconciled.reconciliation,
			metadata: {
				deletedCount: reconciled.deletedCount,
				messageCount: listed.messages.length,
				listedPageCount: listed.pageCount,
				nextCursor: listed.nextCursor,
				resumeNextCursor:
					listed.complete === true ? undefined : listed.nextCursor,
				resumePending: listed.complete !== true,
				updatedCount: reconciled.updatedCount
			}
		};
	}
});

export const createRAGLinkedGmailEmailSyncSource = (
	options: RAGGmailLinkedEmailSyncSourceOptions
): RAGSyncSourceDefinition =>
	createRAGEmailSyncSource({
		...options,
		client: createRAGLinkedGmailEmailSyncClient(options)
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
					const recoveredAt = Date.now();
					for (const record of records ?? []) {
						const source = sourceMap.get(record.id);
						if (!source) {
							continue;
						}

						state.set(
							record.id,
							recoverSyncSourceRecord(source, record, recoveredAt)
						);
					}
				}
			);
		}

		await hydrationPromise;
		await persistState();
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
			reconciliation: previous?.reconciliation,
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
						listDocuments: options.listDocuments,
						sourceRecord: previous
					});
					const finishedAt = Date.now();
					const completed = toSourceRecord(source, {
						chunkCount: result.chunkCount,
						consecutiveFailures: 0,
						diagnostics: result.diagnostics,
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
						reconciliation: result.reconciliation,
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
						reconciliation: previous?.reconciliation,
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
						reconciliation: existingRecord?.reconciliation,
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
