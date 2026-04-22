import type {
	RAGDocumentChunk,
	RAGDocumentChunkEmbeddingVariant,
	RAGQueryInput,
	RAGQueryResult,
	RAGUpsertInput
} from '../../../types/ai';

export type {
	AIHTMXRenderConfig,
	RAGAnswerWorkflowState,
	RAGBackendCapabilities,
	RAGCitation,
	RAGCitationReferenceMap,
	RAGGroundedAnswer,
	RAGGroundedAnswerPart,
	RAGGroundingReference,
	RAGChunkingOptions,
	RAGChunkingStrategy,
	RAGCollection,
	RAGCollectionSearchParams,
	RAGContentFormat,
	RAGHTMXConfig,
	RAGHybridFusionMode,
	RAGHybridRetrievalMode,
	RAGHybridSearchOptions,
	RAGDocumentChunk,
	RAGDocumentChunkEmbeddingVariant,
	RAGDocumentChunkPreview,
	RAGArchiveEntry,
	RAGArchiveExpander,
	RAGArchiveExpansionResult,
	RAGExtractedFileDocument,
	RAGFileExtractionInput,
	RAGFileExtractor,
	RAGPDFOCRExtractorOptions,
	RAGDirectoryIngestInput,
	RAGDirectorySyncSourceOptions,
	RAGDocumentFileInput,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUploadInput,
	RAGEmbeddingFunction,
	RAGEmbeddingInput,
	RAGEmbeddingProvider,
	RAGEmbeddingProviderLike,
	RAGBackendDescriptor,
	RAGHTMXWorkflowRenderConfig,
	RAGIngestDocument,
	RAGIndexedDocument,
	RAGMediaTranscriber,
	RAGMediaTranscriptSegment,
	RAGMediaTranscriptionResult,
	RAGLexicalQueryInput,
	RAGDocumentUrlInput,
	RAGDocumentUrlIngestInput,
	RAGEmailSyncAttachment,
	RAGEmailSyncClient,
	RAGEmailSyncListInput,
	RAGEmailSyncListResult,
	RAGEmailSyncMessage,
	RAGEmailSyncSourceOptions,
	RAGFeedSyncInput,
	RAGFeedSyncSourceOptions,
	RAGGitHubRepoSyncInput,
	RAGGitHubSyncSourceOptions,
	RAGSitemapSyncInput,
	RAGSitemapSyncSourceOptions,
	RAGSiteDiscoveryInput,
	RAGSiteDiscoverySyncSourceOptions,
	RAGStorageSyncClient,
	RAGStorageSyncFile,
	RAGStorageSyncListInput,
	RAGStorageSyncListResult,
	RAGStorageSyncObject,
	RAGStorageSyncSourceOptions,
	RAGOCRProvider,
	RAGOCRResult,
	RAGPreparedDocument,
	RAGSource,
	RAGSourceGroup,
	RAGSourceSummary,
	RAGIngestResponse,
	RAGMutationResponse,
	RAGPostgresNativeDiagnostics,
	RAGQueryInput,
	RAGQueryResult,
	RAGQueryTransformInput,
	RAGQueryTransformProvider,
	RAGQueryTransformProviderLike,
	RAGQueryTransformResult,
	RAGQueryTransformer,
	RAGSearchRequest,
	RAGSyncManager,
	RAGSyncRunOptions,
	RAGSyncSchedule,
	RAGSyncScheduler,
	RAGSyncResponse,
	RAGSyncStateStore,
	RAGSyncSourceContext,
	RAGSyncSourceDefinition,
	RAGSyncSourceRecord,
	RAGSyncSourceRunResult,
	RAGUrlSyncSourceOptions,
	RAGSQLiteNativeDiagnostics,
	RAGStatusResponse,
	RAGStreamStage,
	RAGAnswerGroundingEvaluationCase,
	RAGAnswerGroundingEvaluationCaseDifficultyEntry,
	RAGAnswerGroundingCaseDifficultyDiffEntry,
	RAGAnswerGroundingCaseDifficultyHistory,
	RAGAnswerGroundingCaseDifficultyHistoryStore,
	RAGAnswerGroundingCaseDifficultyRun,
	RAGAnswerGroundingCaseDifficultyRunDiff,
	RAGAnswerGroundingEvaluationCaseDiff,
	RAGAnswerGroundingEvaluationCaseResult,
	RAGAnswerGroundingEvaluationHistory,
	RAGAnswerGroundingEvaluationLeaderboardEntry,
	RAGAnswerGroundingEvaluationHistoryStore,
	RAGAnswerGroundingEvaluationInput,
	RAGAnswerGroundingEvaluationResponse,
	RAGAnswerGroundingEvaluationRun,
	RAGAnswerGroundingEvaluationRunDiff,
	RAGAnswerGroundingEvaluationSummary,
	RAGEvaluationCase,
	RAGEvaluationCaseDiff,
	RAGEvaluationHistory,
	RAGEvaluationHistoryStore,
	RAGEvaluationCaseResult,
	RAGEvaluationLeaderboardEntry,
	RAGEvaluationInput,
	RAGEvaluationResponse,
	RAGEvaluationRunDiff,
	RAGEvaluationSummary,
	RAGEvaluationSuite,
	RAGEvaluationSuiteRun,
	RAGRetrievalCandidate,
	RAGRetrievalComparison,
	RAGRetrievalComparisonEntry,
	RAGRetrievalComparisonSummary,
	RAGUpsertInput,
	RAGVectorStore,
	RAGVectorStoreStatus,
	SQLiteVecResolution
} from '../../../types/ai';

export type InternalRAGStoredChunk = RAGDocumentChunk & {
	vector: number[];
	sourceId: string;
};

export type { RAGUpsertInput as RAGDocumentBatch };
export type { RAGQueryInput as RAGQueryParams };
export type {
	GeminiEmbeddingsConfig,
	OllamaEmbeddingsConfig,
	OpenAICompatibleEmbeddingsConfig,
	OpenAIEmbeddingsConfig
} from './embeddingProviders';
export type {
	RAGReranker,
	RAGRerankerCandidate,
	RAGRerankerComparison,
	RAGRerankerComparisonEntry,
	RAGRerankerComparisonSummary,
	RAGRerankerInput,
	RAGRerankerProvider,
	RAGRerankerProviderLike
} from '../../../types/ai';

const getContextNumber = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getContextString = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;

const formatMediaTimestamp = (value: unknown) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	const totalSeconds = Math.floor(value / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const milliseconds = Math.floor(value % 1000);

	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
		2,
		'0'
	)}.${String(milliseconds).padStart(3, '0')}`;
};

const buildRAGContextLocatorLabel = (
	metadata?: Record<string, unknown>,
	source?: string,
	title?: string
) => {
	if (!metadata) {
		return undefined;
	}

	const page =
		getContextNumber(metadata.page) ??
		getContextNumber(metadata.pageNumber) ??
		(typeof metadata.pageIndex === 'number'
			? metadata.pageIndex + 1
			: undefined);
	const region =
		getContextNumber(metadata.regionNumber) ??
		(typeof metadata.regionIndex === 'number'
			? metadata.regionIndex + 1
			: undefined);
	if (page && region) {
		return `Page ${page} · Region ${region}`;
	}
	if (page) {
		return `Page ${page}`;
	}

	const sheet =
		getContextString(metadata.sheetName) ??
		(Array.isArray(metadata.sheetNames)
			? getContextString(metadata.sheetNames[0])
			: undefined);
	if (sheet) {
		return `Sheet ${sheet}`;
	}

	const slide =
		getContextNumber(metadata.slide) ??
		getContextNumber(metadata.slideNumber) ??
		(typeof metadata.slideIndex === 'number'
			? metadata.slideIndex + 1
			: undefined);
	if (slide) {
		return `Slide ${slide}`;
	}

	const archiveEntry =
		getContextString(metadata.archiveEntryPath) ??
		getContextString(metadata.entryPath);
	if (archiveEntry) {
		return `Archive entry ${archiveEntry}`;
	}

	const emailKind = getContextString(metadata.emailKind);
	if (emailKind === 'attachment') {
		const attachmentName =
			getContextString(metadata.attachmentName) ??
			source?.split('/').at(-1) ??
			title?.split(' · ').at(-1);
		return attachmentName ? `Attachment ${attachmentName}` : 'Attachment';
	}

	const mediaStart = formatMediaTimestamp(metadata.startMs);
	const mediaEnd = formatMediaTimestamp(metadata.endMs);
	if (mediaStart && mediaEnd) {
		return `Timestamp ${mediaStart} - ${mediaEnd}`;
	}

	if (mediaStart) {
		return `Timestamp ${mediaStart}`;
	}

	return undefined;
};

const buildRAGContextProvenanceLabel = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const pdfTextMode = getContextString(metadata.pdfTextMode);
	const ocrEngine = getContextString(metadata.ocrEngine);
	const mediaKind = getContextString(metadata.mediaKind);
	const transcriptSource = getContextString(metadata.transcriptSource);
	const threadTopic = getContextString(metadata.threadTopic);
	const from = getContextString(metadata.from);
	const speaker = getContextString(metadata.speaker);
	const mediaChannel = getContextString(metadata.mediaChannel);
	const mediaSegmentGroupDurationMs = getContextNumber(
		metadata.mediaSegmentGroupDurationMs
	);
	const mediaSegmentGapFromPreviousMs = getContextNumber(
		metadata.mediaSegmentGapFromPreviousMs
	);
	const ocrConfidence =
		getContextNumber(metadata.ocrRegionConfidence) ??
		getContextNumber(metadata.ocrConfidence);

	const labels = [
		pdfTextMode ? `PDF ${pdfTextMode}` : '',
		ocrEngine ? `OCR ${ocrEngine}` : '',
		typeof ocrConfidence === 'number'
			? `Confidence ${ocrConfidence.toFixed(2)}`
			: '',
		mediaKind ? `Media ${mediaKind}` : '',
		transcriptSource ? `Transcript ${transcriptSource}` : '',
		threadTopic ? `Thread ${threadTopic}` : '',
		speaker ? `Speaker ${speaker}` : '',
		mediaChannel ? `Channel ${mediaChannel}` : '',
		typeof mediaSegmentGroupDurationMs === 'number'
			? `Segment window ${String(Math.floor(mediaSegmentGroupDurationMs / 1000))}s`
			: '',
		typeof mediaSegmentGapFromPreviousMs === 'number'
			? `Segment gap ${String(Math.floor(mediaSegmentGapFromPreviousMs / 1000))}s`
			: '',
		from ? `Sender ${from}` : ''
	].filter((value) => value.length > 0);

	return labels.length > 0 ? labels.join(' · ') : undefined;
};

const buildRAGContextCitationGuidance = (hits: RAGQueryResult[]) => {
	const needsPageGuidance = hits.some((hit) => {
		const metadata = hit.metadata;
		if (!metadata) {
			return false;
		}

		return (
			getContextNumber(metadata.page) !== undefined ||
			getContextNumber(metadata.pageNumber) !== undefined ||
			typeof metadata.pageIndex === 'number'
		);
	});
	const needsSheetGuidance = hits.some((hit) => {
		const metadata = hit.metadata;
		if (!metadata) {
			return false;
		}

		return (
			getContextString(metadata.sheetName) !== undefined ||
			(Array.isArray(metadata.sheetNames) &&
				getContextString(metadata.sheetNames[0]) !== undefined)
		);
	});
	const needsSlideGuidance = hits.some((hit) => {
		const metadata = hit.metadata;
		if (!metadata) {
			return false;
		}

		return (
			getContextNumber(metadata.slide) !== undefined ||
			getContextNumber(metadata.slideNumber) !== undefined ||
			typeof metadata.slideIndex === 'number'
		);
	});
	const needsTimestampGuidance = hits.some((hit) => {
		const metadata = hit.metadata;
		if (!metadata) {
			return false;
		}

		return (
			typeof metadata.startMs === 'number' ||
			typeof metadata.endMs === 'number'
		);
	});
	const needsAttachmentGuidance = hits.some(
		(hit) => getContextString(hit.metadata?.emailKind) === 'attachment'
	);
	const needsThreadGuidance = hits.some(
		(hit) =>
			getContextString(hit.metadata?.threadTopic) !== undefined ||
			getContextString(hit.metadata?.from) !== undefined
	);
	const needsArchiveGuidance = hits.some((hit) => {
		const metadata = hit.metadata;
		return (
			getContextString(metadata?.archiveEntryPath) !== undefined ||
			getContextString(metadata?.entryPath) !== undefined
		);
	});

	const guidanceLines = [
		'When you use retrieved context, cite it inline with [1], [2]. Prefer the most specific evidence available and preserve page, sheet, slide, timestamp, attachment, archive entry, or thread cues when the context provides them.',
		needsPageGuidance
			? 'For PDF evidence, keep the cited page number in the answer when the context includes one.'
			: '',
		needsSheetGuidance
			? 'For spreadsheet evidence, name the worksheet when the context identifies a sheet.'
			: '',
		needsSlideGuidance
			? 'For presentation evidence, keep the slide number in the answer when the context provides it.'
			: '',
		needsTimestampGuidance
			? 'For media evidence, preserve the cited timestamp range in the answer.'
			: '',
		needsAttachmentGuidance
			? 'For email attachment evidence, distinguish the attachment from the parent message.'
			: '',
		needsThreadGuidance
			? 'For email message evidence, preserve sender or thread cues when they matter to the claim.'
			: '',
		needsArchiveGuidance
			? 'For archive evidence, identify the archive entry path instead of only naming the outer archive.'
			: ''
	].filter((value) => value.length > 0);

	return guidanceLines.join('\n');
};

export const buildRAGContext = (hits: RAGQueryResult[]) => {
	if (hits.length === 0) {
		return '';
	}

	const sourceLines = hits.map((hit, index) => {
		const source = hit.source ? ` (${hit.source})` : '';
		const title = hit.title ? ` ${hit.title}` : '';
		const locatorLabel = buildRAGContextLocatorLabel(
			hit.metadata,
			hit.source,
			hit.title
		);
		const provenanceLabel = buildRAGContextProvenanceLabel(hit.metadata);
		const evidenceLines = [
			`[${index + 1}]${title}${source}`,
			locatorLabel ? `Location: ${locatorLabel}` : '',
			provenanceLabel ? `Provenance: ${provenanceLabel}` : '',
			hit.chunkText.trim()
		].filter((value) => value.length > 0);

		return evidenceLines.join('\n');
	});

	return `Use the following context for this question:\n${sourceLines.join(
		'\n\n'
	)}\n\n${buildRAGContextCitationGuidance(hits)}`;
};
