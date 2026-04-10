/* AI/LLM streaming types for WebSocket-based AI communication */

/* ─── Provider types ─── */

export type AIUsage = {
	inputTokens: number;
	outputTokens: number;
};

export type RAGSource = {
	chunkId: string;
	score: number;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
};

export type RAGSourceGroup = {
	key: string;
	label: string;
	source?: string;
	title?: string;
	bestScore: number;
	count: number;
	chunks: RAGSource[];
};

export type RAGCitation = {
	key: string;
	label: string;
	chunkId: string;
	score: number;
	text: string;
	source?: string;
	title?: string;
	contextLabel?: string;
	provenanceLabel?: string;
	locatorLabel?: string;
	metadata?: Record<string, unknown>;
};

export type RAGCitationReferenceMap = Record<string, number>;

export type RAGSourceSummary = {
	key: string;
	label: string;
	source?: string;
	title?: string;
	bestScore: number;
	count: number;
	excerpt: string;
	chunkIds: string[];
	citationNumbers: number[];
	citations: RAGCitation[];
	contextLabel?: string;
	locatorLabel?: string;
	provenanceLabel?: string;
};

export type RAGGroundingReference = {
	number: number;
	chunkId: string;
	label: string;
	source?: string;
	title?: string;
	score: number;
	text: string;
	excerpt: string;
	contextLabel?: string;
	provenanceLabel?: string;
	locatorLabel?: string;
	metadata?: Record<string, unknown>;
};

export type RAGGroundedAnswerCitationDetail = {
	number: number;
	label: string;
	source?: string;
	title?: string;
	excerpt: string;
	contextLabel?: string;
	provenanceLabel?: string;
	locatorLabel?: string;
	evidenceLabel: string;
	evidenceSummary: string;
};

export type RAGGroundedAnswerPart =
	| {
			type: 'text';
			text: string;
	  }
	| {
			type: 'citation';
			text: string;
			referenceNumbers: number[];
			references: RAGGroundingReference[];
			referenceDetails: RAGGroundedAnswerCitationDetail[];
			unresolvedReferenceNumbers: number[];
	  };

export type RAGGroundedAnswer = {
	content: string;
	hasCitations: boolean;
	coverage: 'grounded' | 'partial' | 'ungrounded';
	parts: RAGGroundedAnswerPart[];
	references: RAGGroundingReference[];
	ungroundedReferenceNumbers: number[];
};

export type RAGRetrievedState = {
	conversationId: string;
	messageId: string;
	retrievalStartedAt?: number;
	retrievedAt?: number;
	retrievalDurationMs?: number;
	sources: RAGSource[];
	sourceGroups: RAGSourceGroup[];
	sourceSummaries: RAGSourceSummary[];
	citations: RAGCitation[];
	citationReferenceMap: RAGCitationReferenceMap;
	groundedAnswer: RAGGroundedAnswer;
};

export type RAGAnswerWorkflowState = {
	stage: RAGStreamStage;
	error: string | null;
	messages: AIMessage[];
	latestAssistantMessage?: AIMessage;
	retrieval: RAGRetrievedState | null;
	sources: RAGSource[];
	sourceGroups: RAGSourceGroup[];
	sourceSummaries: RAGSourceSummary[];
	citations: RAGCitation[];
	citationReferenceMap: RAGCitationReferenceMap;
	groundingReferences: RAGGroundingReference[];
	groundedAnswer: RAGGroundedAnswer;
	isIdle: boolean;
	isRunning: boolean;
	isSubmitting: boolean;
	isRetrieving: boolean;
	isRetrieved: boolean;
	isAnswerStreaming: boolean;
	isComplete: boolean;
	isError: boolean;
	hasSources: boolean;
	hasRetrieved: boolean;
	hasGrounding: boolean;
	hasCitations: boolean;
	coverage: RAGGroundedAnswer['coverage'];
	ungroundedReferenceNumbers: number[];
	retrievalDurationMs?: number;
	retrievalStartedAt?: number;
	retrievedAt?: number;
};

export type RAGStreamStage =
	| 'idle'
	| 'submitting'
	| 'retrieving'
	| 'retrieved'
	| 'streaming'
	| 'complete'
	| 'error';

export type RAGDocumentChunk = {
	chunkId: string;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
	embedding?: number[];
};

export type RAGEmbeddingInput = {
	text: string;
	model?: string;
	signal?: AbortSignal;
};

export type RAGEmbeddingFunction = (
	input: RAGEmbeddingInput
) => Promise<number[]>;

export type RAGEmbeddingProvider = {
	embed: RAGEmbeddingFunction;
	dimensions?: number;
	defaultModel?: string;
};

export type RAGEmbeddingProviderLike =
	| RAGEmbeddingFunction
	| RAGEmbeddingProvider;

export type RAGContentFormat = 'text' | 'markdown' | 'html';

export type RAGFileExtractionInput = {
	data: Uint8Array;
	path?: string;
	name?: string;
	source?: string;
	title?: string;
	format?: RAGContentFormat;
	contentType?: string;
	metadata?: Record<string, unknown>;
	chunking?: RAGChunkingOptions;
};

export type RAGExtractedFileDocument = RAGIngestDocument & {
	contentType?: string;
	extractor?: string;
};

export type RAGFileExtractor = {
	name: string;
	supports: (input: RAGFileExtractionInput) => boolean | Promise<boolean>;
	extract: (
		input: RAGFileExtractionInput
	) =>
		| RAGExtractedFileDocument
		| RAGExtractedFileDocument[]
		| Promise<RAGExtractedFileDocument | RAGExtractedFileDocument[]>;
};

export type RAGMediaTranscriptSegment = {
	text: string;
	startMs?: number;
	endMs?: number;
	speaker?: string;
};

export type RAGMediaTranscriptionResult = {
	text: string;
	title?: string;
	metadata?: Record<string, unknown>;
	segments?: RAGMediaTranscriptSegment[];
};

export type RAGMediaTranscriber = {
	name: string;
	transcribe: (
		input: RAGFileExtractionInput
	) => RAGMediaTranscriptionResult | Promise<RAGMediaTranscriptionResult>;
};

export type RAGOCRResult = {
	text: string;
	title?: string;
	metadata?: Record<string, unknown>;
};

export type RAGOCRProvider = {
	name: string;
	extractText: (
		input: RAGFileExtractionInput
	) => RAGOCRResult | Promise<RAGOCRResult>;
};

export type RAGPDFOCRExtractorOptions = {
	provider: RAGOCRProvider;
	alwaysOCR?: boolean;
	minExtractedTextLength?: number;
};

export type RAGArchiveEntry = {
	data: Uint8Array;
	path: string;
	contentType?: string;
	format?: RAGContentFormat;
	metadata?: Record<string, unknown>;
};

export type RAGArchiveExpansionResult = {
	entries: RAGArchiveEntry[];
	metadata?: Record<string, unknown>;
};

export type RAGArchiveExpander = {
	name: string;
	expand: (
		input: RAGFileExtractionInput
	) => RAGArchiveExpansionResult | Promise<RAGArchiveExpansionResult>;
};

export type RAGChunkingStrategy =
	| 'paragraphs'
	| 'sentences'
	| 'fixed'
	| 'source_aware';

export type RAGChunkingOptions = {
	maxChunkLength?: number;
	chunkOverlap?: number;
	minChunkLength?: number;
	strategy?: RAGChunkingStrategy;
};

export type RAGIngestDocument = {
	text: string;
	id?: string;
	title?: string;
	source?: string;
	format?: RAGContentFormat;
	metadata?: Record<string, unknown>;
	chunking?: RAGChunkingOptions;
};

export type RAGDocumentUrlInput = {
	url: string;
	title?: string;
	source?: string;
	format?: RAGContentFormat;
	contentType?: string;
	metadata?: Record<string, unknown>;
	chunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
};

export type RAGDocumentUrlIngestInput = {
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
	urls: RAGDocumentUrlInput[];
};

export type RAGPreparedDocument = {
	documentId: string;
	title: string;
	source: string;
	format: RAGContentFormat;
	metadata: Record<string, unknown>;
	normalizedText: string;
	chunks: RAGDocumentChunk[];
};

export type RAGDocumentFileInput = Omit<RAGIngestDocument, 'text'> & {
	path: string;
	contentType?: string;
	extractors?: RAGFileExtractor[];
};

export type RAGDirectoryIngestInput = {
	directory: string;
	recursive?: boolean;
	includeExtensions?: string[];
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
};

export type RAGQueryInput = {
	queryVector: number[];
	topK: number;
	filter?: Record<string, unknown>;
};

export type RAGLexicalQueryInput = {
	query: string;
	topK: number;
	filter?: Record<string, unknown>;
};

export type RAGQueryTransformInput = {
	query: string;
	topK: number;
	candidateTopK?: number;
	filter?: Record<string, unknown>;
	model?: string;
	scoreThreshold?: number;
};

export type RAGQueryTransformResult = {
	query: string;
	variants?: string[];
};

export type RAGQueryTransformer = (
	input: RAGQueryTransformInput
) => Promise<RAGQueryTransformResult> | RAGQueryTransformResult;

export type RAGQueryTransformProvider = {
	transform: RAGQueryTransformer;
	defaultModel?: string;
	providerName?: string;
};

export type RAGQueryTransformProviderLike =
	| RAGQueryTransformer
	| RAGQueryTransformProvider;

export type RAGRerankerInput = {
	query: string;
	queryVector: number[];
	model?: string;
	filter?: Record<string, unknown>;
	topK: number;
	candidateTopK?: number;
	scoreThreshold?: number;
	results: RAGQueryResult[];
};

export type RAGReranker = (
	input: RAGRerankerInput
) => Promise<RAGQueryResult[]> | RAGQueryResult[];

export type RAGRerankerProvider = {
	rerank: RAGReranker;
	defaultModel?: string;
	providerName?: string;
};

export type RAGRerankerProviderLike = RAGReranker | RAGRerankerProvider;

export type RAGQueryResult = {
	chunkId: string;
	score: number;
	chunkText: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
};

export type RAGHybridRetrievalMode = 'vector' | 'lexical' | 'hybrid';

export type RAGHybridFusionMode = 'rrf' | 'max';

export type RAGHybridSearchOptions = {
	mode?: RAGHybridRetrievalMode;
	lexicalTopK?: number;
	fusion?: RAGHybridFusionMode;
	fusionConstant?: number;
	lexicalWeight?: number;
	vectorWeight?: number;
};

export type RAGUpsertInput = {
	chunks: RAGDocumentChunk[];
};

export type RAGDocumentIngestInput = {
	documents: RAGIngestDocument[];
	defaultChunking?: RAGChunkingOptions;
};

export type RAGDocumentUploadInput = {
	name: string;
	content: string;
	contentType?: string;
	encoding?: 'base64' | 'utf8';
	format?: RAGContentFormat;
	source?: string;
	title?: string;
	chunking?: RAGChunkingOptions;
	metadata?: Record<string, unknown>;
};

export type RAGDocumentUploadIngestInput = {
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
	uploads: RAGDocumentUploadInput[];
};

export type RAGIndexedDocument = {
	id: string;
	title: string;
	source: string;
	text?: string;
	kind?: string;
	format?: RAGContentFormat;
	chunkStrategy?: RAGChunkingStrategy;
	chunkSize?: number;
	chunkCount?: number;
	createdAt?: number;
	updatedAt?: number;
	metadata?: Record<string, unknown>;
};

export type RAGDocumentChunkPreview = {
	document: Omit<RAGIndexedDocument, 'text' | 'metadata'> & {
		metadata?: Record<string, unknown>;
	};
	normalizedText: string;
	chunks: RAGDocumentChunk[];
};

export type RAGBackendDescriptor = {
	id: string;
	label: string;
	path?: string;
	available: boolean;
	reason?: string;
	lastSeedMs?: number;
	status?: RAGVectorStoreStatus;
	capabilities?: RAGBackendCapabilities;
};

export type RAGBackendsResponse = {
	ok: true;
	defaultMode?: string;
	activeModeCookie?: string;
	backends: RAGBackendDescriptor[];
};

export type SQLiteVecResolutionSource =
	| 'absolute-package'
	| 'explicit'
	| 'env'
	| 'database';

export type SQLiteVecResolutionStatus =
	| 'resolved'
	| 'not_configured'
	| 'unsupported_platform'
	| 'package_not_installed'
	| 'binary_missing'
	| 'package_invalid';

export type SQLiteVecResolution = {
	status: SQLiteVecResolutionStatus;
	source: SQLiteVecResolutionSource;
	platformKey: string;
	packageName?: string;
	packageVersion?: string;
	packageRoot?: string;
	libraryFile?: string;
	libraryPath?: string;
	reason?: string;
};

export type RAGSQLiteNativeDiagnostics = {
	requested: boolean;
	available: boolean;
	active: boolean;
	mode?: 'vec0';
	tableName?: string;
	distanceMetric?: 'cosine' | 'l2';
	resolution?: SQLiteVecResolution;
	fallbackReason?: string;
	lastLoadError?: string;
	lastQueryError?: string;
	lastUpsertError?: string;
};

export type RAGPostgresNativeDiagnostics = {
	requested: boolean;
	available: boolean;
	active: boolean;
	mode?: 'pgvector';
	extensionName?: string;
	schemaName?: string;
	tableName?: string;
	distanceMetric?: 'cosine' | 'l2' | 'inner_product';
	indexType?: 'none' | 'hnsw' | 'ivfflat';
	fallbackReason?: string;
	lastInitError?: string;
	lastQueryError?: string;
	lastUpsertError?: string;
	lastMigrationError?: string;
};

export type RAGVectorStoreStatus = {
	backend: 'in_memory' | 'sqlite' | 'postgres';
	vectorMode:
		| 'in_memory'
		| 'json_fallback'
		| 'native_vec0'
		| 'native_pgvector';
	dimensions?: number;
	native?: RAGSQLiteNativeDiagnostics | RAGPostgresNativeDiagnostics;
};

export type RAGBackendCapabilities = {
	backend: 'in_memory' | 'sqlite' | 'postgres' | 'custom';
	persistence: 'memory_only' | 'embedded' | 'external';
	nativeVectorSearch: boolean;
	serverSideFiltering: boolean;
	streamingIngestStatus: boolean;
};

export type RAGVectorStore = {
	embed: (input: RAGEmbeddingInput) => Promise<number[]>;
	query: (input: RAGQueryInput) => Promise<RAGQueryResult[]>;
	queryLexical?: (input: RAGLexicalQueryInput) => Promise<RAGQueryResult[]>;
	upsert: (input: RAGUpsertInput) => Promise<void>;
	clear?: () => Promise<void> | void;
	getStatus?: () => RAGVectorStoreStatus;
	getCapabilities?: () => RAGBackendCapabilities;
};

export type RAGCollectionSearchParams = {
	query: string;
	topK?: number;
	candidateTopK?: number;
	filter?: Record<string, unknown>;
	scoreThreshold?: number;
	queryTransform?: RAGQueryTransformProviderLike;
	rerank?: RAGRerankerProviderLike;
	retrieval?: RAGHybridSearchOptions | RAGHybridRetrievalMode;
	model?: string;
	signal?: AbortSignal;
};

export type RAGSearchRequest = Omit<
	RAGCollectionSearchParams,
	'signal' | 'rerank'
>;

export type RAGIngestResponse = {
	ok: boolean;
	count?: number;
	documentCount?: number;
	error?: string;
};

export type RAGDocumentSummary = {
	total: number;
	chunkCount: number;
	byKind: Record<string, number>;
};

export type RAGIngestJobStatus = 'running' | 'completed' | 'failed';

export type RAGIngestJobRecord = {
	id: string;
	status: RAGIngestJobStatus;
	startedAt: number;
	finishedAt?: number;
	elapsedMs?: number;
	inputKind: 'chunks' | 'documents' | 'urls' | 'uploads';
	requestedCount: number;
	chunkCount?: number;
	documentCount?: number;
	error?: string;
	extractorNames?: string[];
};

export type RAGCorpusHealth = {
	emptyDocuments: number;
	emptyChunks: number;
	duplicateSources: string[];
	duplicateSourceGroups: Array<{ source: string; count: number }>;
	duplicateDocumentIds: string[];
	duplicateDocumentIdGroups: Array<{ id: string; count: number }>;
	documentsMissingSource: number;
	documentsMissingTitle: number;
	documentsMissingMetadata: number;
	documentsMissingCreatedAt: number;
	documentsMissingUpdatedAt: number;
	documentsWithoutChunkPreview: number;
	coverageByFormat: Record<string, number>;
	coverageByKind: Record<string, number>;
	failedAdminJobs: number;
	failedIngestJobs: number;
	failuresByAdminAction: Record<string, number>;
	failuresByExtractor: Record<string, number>;
	failuresByInputKind: Record<string, number>;
	inspectedChunks: number;
	inspectedDocuments: number;
	lowSignalChunks: number;
	oldestDocumentAgeMs?: number;
	newestDocumentAgeMs?: number;
	staleAfterMs: number;
	staleDocuments: string[];
	averageChunksPerDocument: number;
};

export type RAGAdminActionRecord = {
	id: string;
	action:
		| 'clear_index'
		| 'create_document'
		| 'delete_document'
		| 'reindex_document'
		| 'reindex_source'
		| 'sync_all_sources'
		| 'sync_source'
		| 'reseed'
		| 'reset';
	status: 'completed' | 'failed';
	startedAt: number;
	finishedAt?: number;
	elapsedMs?: number;
	documentId?: string;
	target?: string;
	error?: string;
};

export type RAGAdminJobStatus = 'running' | 'completed' | 'failed';

export type RAGAdminJobRecord = {
	id: string;
	action:
		| 'clear_index'
		| 'create_document'
		| 'delete_document'
		| 'reindex_document'
		| 'reindex_source'
		| 'sync_all_sources'
		| 'sync_source'
		| 'reseed'
		| 'reset';
	status: RAGAdminJobStatus;
	startedAt: number;
	finishedAt?: number;
	elapsedMs?: number;
	target?: string;
	error?: string;
};

export type RAGAdminCapabilities = {
	canClearIndex: boolean;
	canCreateDocument: boolean;
	canDeleteDocument: boolean;
	canListSyncSources: boolean;
	canReindexDocument: boolean;
	canReindexSource: boolean;
	canReseed: boolean;
	canReset: boolean;
	canSyncAllSources: boolean;
	canSyncSource: boolean;
};

export type RAGSyncSourceStatus =
	| 'idle'
	| 'running'
	| 'completed'
	| 'failed'
	| 'disabled';

export type RAGSyncSourceRecord = {
	id: string;
	label: string;
	kind: 'directory' | 'url' | 'storage' | 'email' | 'custom';
	status: RAGSyncSourceStatus;
	description?: string;
	target?: string;
	lastStartedAt?: number;
	lastSyncedAt?: number;
	lastSyncDurationMs?: number;
	lastError?: string;
	lastSuccessfulSyncAt?: number;
	consecutiveFailures?: number;
	retryAttempts?: number;
	nextRetryAt?: number;
	documentCount?: number;
	chunkCount?: number;
	metadata?: Record<string, unknown>;
};

export type RAGSyncSourceRunResult = {
	documentCount?: number;
	chunkCount?: number;
	metadata?: Record<string, unknown>;
};

export type RAGSyncSourceDefinition = {
	id: string;
	label: string;
	kind: RAGSyncSourceRecord['kind'];
	description?: string;
	target?: string;
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
	sync: (
		input: RAGSyncSourceContext
	) => Promise<RAGSyncSourceRunResult> | RAGSyncSourceRunResult;
};

export type RAGSyncSourceContext = {
	collection: RAGCollection;
	listDocuments?: () => Promise<RAGIndexedDocument[]> | RAGIndexedDocument[];
	deleteDocument?: (id: string) => Promise<boolean> | boolean;
	signal?: AbortSignal;
};

export type RAGStorageSyncObject = {
	key: string;
	size?: number;
	etag?: string;
	lastModified?: number | string | Date;
	contentType?: string;
	metadata?: Record<string, unknown>;
};

export type RAGStorageSyncFile = {
	arrayBuffer: () => Promise<ArrayBuffer>;
	text?: () => Promise<string>;
	exists?: () => Promise<boolean>;
};

export type RAGStorageSyncListInput = {
	prefix?: string;
	startAfter?: string;
	maxKeys?: number;
};

export type RAGStorageSyncListResult = {
	contents: RAGStorageSyncObject[];
	isTruncated?: boolean;
	nextContinuationToken?: string;
};

export type RAGStorageSyncClient = {
	file: (key: string) => RAGStorageSyncFile;
	list: (
		input?: RAGStorageSyncListInput
	) => Promise<RAGStorageSyncListResult> | RAGStorageSyncListResult;
};

export type RAGDirectorySyncSourceOptions = {
	id: string;
	label: string;
	directory: string;
	description?: string;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
	includeExtensions?: string[];
	metadata?: Record<string, unknown>;
	recursive?: boolean;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGUrlSyncSourceOptions = {
	id: string;
	label: string;
	urls: RAGDocumentUrlInput[];
	description?: string;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGStorageSyncSourceOptions = {
	id: string;
	label: string;
	client: RAGStorageSyncClient;
	description?: string;
	prefix?: string;
	keys?: string[];
	maxKeys?: number;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGEmailSyncAttachment = {
	id?: string;
	name: string;
	content: string | Uint8Array;
	contentType?: string;
	encoding?: 'base64' | 'utf8';
	format?: RAGContentFormat;
	source?: string;
	title?: string;
	metadata?: Record<string, unknown>;
	chunking?: RAGChunkingOptions;
};

export type RAGEmailSyncMessage = {
	id: string;
	threadId?: string;
	subject?: string;
	from?: string;
	to?: string[];
	cc?: string[];
	sentAt?: number | string | Date;
	receivedAt?: number | string | Date;
	bodyText: string;
	bodyHtml?: string;
	metadata?: Record<string, unknown>;
	attachments?: RAGEmailSyncAttachment[];
};

export type RAGEmailSyncListInput = {
	cursor?: string;
	maxResults?: number;
};

export type RAGEmailSyncListResult = {
	messages: RAGEmailSyncMessage[];
	nextCursor?: string;
};

export type RAGEmailSyncClient = {
	listMessages: (
		input?: RAGEmailSyncListInput
	) => Promise<RAGEmailSyncListResult> | RAGEmailSyncListResult;
};

export type RAGEmailSyncSourceOptions = {
	id: string;
	label: string;
	client: RAGEmailSyncClient;
	description?: string;
	maxResults?: number;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	extractors?: RAGFileExtractor[];
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGSyncManager = Pick<
	RAGIndexManager,
	'listSyncSources' | 'syncSource' | 'syncAllSources'
>;

export type RAGSyncRunOptions = {
	background?: boolean;
};

export type CreateRAGSyncManagerOptions = {
	collection: RAGCollection;
	deleteDocument?: (id: string) => Promise<boolean> | boolean;
	listDocuments?: () => Promise<RAGIndexedDocument[]> | RAGIndexedDocument[];
	loadState?: () => Promise<RAGSyncSourceRecord[]> | RAGSyncSourceRecord[];
	saveState?: (records: RAGSyncSourceRecord[]) => Promise<void> | void;
	backgroundByDefault?: boolean;
	continueOnError?: boolean;
	retryAttempts?: number;
	retryDelayMs?: number;
	sources: RAGSyncSourceDefinition[];
};

export type RAGSyncStateStore = {
	load: () => Promise<RAGSyncSourceRecord[]> | RAGSyncSourceRecord[];
	save: (records: RAGSyncSourceRecord[]) => Promise<void> | void;
};

export type RAGSyncSchedule = {
	id: string;
	label?: string;
	sourceIds?: string[];
	intervalMs: number;
	runImmediately?: boolean;
	background?: boolean;
};

export type RAGSyncScheduler = {
	start: () => Promise<void> | void;
	stop: () => void;
	isRunning: () => boolean;
	listSchedules: () => RAGSyncSchedule[];
};

export type RAGSyncResponse =
	| {
			ok: true;
			source: RAGSyncSourceRecord;
			partial?: boolean;
	  }
	| {
			ok: true;
			sources: RAGSyncSourceRecord[];
			partial?: boolean;
			failedSourceIds?: string[];
			errorsBySource?: Record<string, string>;
	  }
	| { ok: false; error: string };

export type RAGExtractorReadiness = {
	providerConfigured: boolean;
	providerName?: string;
	model?: string;
	embeddingConfigured: boolean;
	embeddingModel?: string;
	rerankerConfigured: boolean;
	indexManagerConfigured: boolean;
	extractorsConfigured: boolean;
	extractorNames: string[];
};

export type RAGOperationsResponse = {
	ok: true;
	status?: RAGVectorStoreStatus;
	capabilities?: RAGBackendCapabilities;
	documents?: RAGDocumentSummary;
	admin: RAGAdminCapabilities;
	adminActions: RAGAdminActionRecord[];
	adminJobs: RAGAdminJobRecord[];
	health: RAGCorpusHealth;
	readiness: RAGExtractorReadiness;
	ingestJobs: RAGIngestJobRecord[];
	syncSources: RAGSyncSourceRecord[];
};

export type RAGStatusResponse = {
	ok: true;
	status?: RAGVectorStoreStatus;
	capabilities?: RAGBackendCapabilities;
	documents?: RAGDocumentSummary;
	admin?: RAGAdminCapabilities;
	adminActions?: RAGAdminActionRecord[];
	adminJobs?: RAGAdminJobRecord[];
	health?: RAGCorpusHealth;
	readiness?: RAGExtractorReadiness;
	ingestJobs?: RAGIngestJobRecord[];
	syncSources?: RAGSyncSourceRecord[];
};

export type RAGDocumentsResponse = {
	ok: true;
	documents: RAGIndexedDocument[];
	lastSeedMsByMode?: Record<string, number>;
};

export type RAGDocumentChunksResponse =
	| ({
			ok: true;
	  } & RAGDocumentChunkPreview)
	| { ok: false; error: string };

export type RAGMutationResponse = {
	ok: boolean;
	error?: string;
	deleted?: string;
	inserted?: string;
	reindexed?: string;
	status?: string;
	documents?: number;
	backendStats?: Record<
		string,
		{
			chunkCount: number;
			totalDocuments: number;
			elapsedMs: number;
		}
	>;
	document?: RAGIndexedDocument;
};

export type RAGEvaluationCase = {
	id: string;
	query: string;
	topK?: number;
	model?: string;
	scoreThreshold?: number;
	filter?: Record<string, unknown>;
	expectedChunkIds?: string[];
	expectedSources?: string[];
	expectedDocumentIds?: string[];
	label?: string;
	metadata?: Record<string, unknown>;
};

export type RAGAnswerGroundingEvaluationCase = {
	id: string;
	answer: string;
	sources: RAGSource[];
	query?: string;
	label?: string;
	expectedChunkIds?: string[];
	expectedSources?: string[];
	expectedDocumentIds?: string[];
	metadata?: Record<string, unknown>;
};

export type RAGAnswerGroundingEvaluationInput = {
	cases: RAGAnswerGroundingEvaluationCase[];
};

export type RAGAnswerGroundingEvaluationCaseResult = {
	caseId: string;
	answer: string;
	query?: string;
	label?: string;
	status: 'pass' | 'partial' | 'fail';
	mode: 'chunkId' | 'source' | 'documentId';
	coverage: RAGGroundedAnswer['coverage'];
	hasCitations: boolean;
	citationCount: number;
	referenceCount: number;
	resolvedCitationCount: number;
	unresolvedCitationCount: number;
	resolvedCitationRate: number;
	citationPrecision: number;
	citationRecall: number;
	citationF1: number;
	expectedCount: number;
	matchedCount: number;
	expectedIds: string[];
	citedIds: string[];
	matchedIds: string[];
	missingIds: string[];
	extraIds: string[];
	groundedAnswer: RAGGroundedAnswer;
	metadata?: Record<string, unknown>;
};

export type RAGAnswerGroundingEvaluationSummary = {
	totalCases: number;
	passedCases: number;
	partialCases: number;
	failedCases: number;
	groundedCases: number;
	partiallyGroundedCases: number;
	ungroundedCases: number;
	averageResolvedCitationRate: number;
	averageCitationPrecision: number;
	averageCitationRecall: number;
	averageCitationF1: number;
};

export type RAGAnswerGroundingEvaluationResponse = {
	ok: true;
	cases: RAGAnswerGroundingEvaluationCaseResult[];
	summary: RAGAnswerGroundingEvaluationSummary;
	totalCases: number;
	passingRate: number;
};

export type RAGAnswerGroundingEvaluationRun = {
	id: string;
	suiteId: string;
	label: string;
	startedAt: number;
	finishedAt: number;
	elapsedMs: number;
	response: RAGAnswerGroundingEvaluationResponse;
	metadata?: Record<string, unknown>;
};

export type RAGAnswerGroundingEvaluationHistoryStore = {
	saveRun: (run: RAGAnswerGroundingEvaluationRun) => Promise<void> | void;
	listRuns: (input?: {
		suiteId?: string;
		limit?: number;
	}) =>
		| Promise<RAGAnswerGroundingEvaluationRun[]>
		| RAGAnswerGroundingEvaluationRun[];
};

export type RAGAnswerGroundingEvaluationLeaderboardEntry = {
	runId: string;
	suiteId: string;
	label: string;
	passingRate: number;
	averageCitationF1: number;
	averageResolvedCitationRate: number;
	rank: number;
	totalCases: number;
};

export type RAGAnswerGroundingEvaluationCaseDifficultyEntry = {
	caseId: string;
	label?: string;
	query?: string;
	passRate: number;
	partialRate: number;
	failRate: number;
	groundedRate: number;
	averageCitationF1: number;
	averageResolvedCitationRate: number;
	rank: number;
	totalEvaluations: number;
};

export type RAGAnswerGroundingCaseDifficultyRun = {
	id: string;
	suiteId: string;
	label: string;
	startedAt: number;
	finishedAt: number;
	entries: RAGAnswerGroundingEvaluationCaseDifficultyEntry[];
	metadata?: Record<string, unknown>;
};

export type RAGAnswerGroundingCaseDifficultyHistoryStore = {
	saveRun: (run: RAGAnswerGroundingCaseDifficultyRun) => Promise<void> | void;
	listRuns: (input?: {
		suiteId?: string;
		limit?: number;
	}) =>
		| Promise<RAGAnswerGroundingCaseDifficultyRun[]>
		| RAGAnswerGroundingCaseDifficultyRun[];
};

export type RAGAnswerGroundingCaseDifficultyDiffEntry = {
	caseId: string;
	label?: string;
	query?: string;
	previousRank?: number;
	currentRank: number;
	previousPassRate?: number;
	currentPassRate: number;
	previousFailRate?: number;
	currentFailRate: number;
	previousAverageCitationF1?: number;
	currentAverageCitationF1: number;
};

export type RAGAnswerGroundingCaseDifficultyRunDiff = {
	suiteId: string;
	currentRunId: string;
	previousRunId?: string;
	harderCases: RAGAnswerGroundingCaseDifficultyDiffEntry[];
	easierCases: RAGAnswerGroundingCaseDifficultyDiffEntry[];
	unchangedCases: RAGAnswerGroundingCaseDifficultyDiffEntry[];
};

export type RAGAnswerGroundingCaseDifficultyHistory = {
	suiteId: string;
	suiteLabel?: string;
	runs: RAGAnswerGroundingCaseDifficultyRun[];
	latestRun?: RAGAnswerGroundingCaseDifficultyRun;
	previousRun?: RAGAnswerGroundingCaseDifficultyRun;
	diff?: RAGAnswerGroundingCaseDifficultyRunDiff;
	trends: {
		hardestCaseIds: string[];
		easiestCaseIds: string[];
		mostOftenHarderCaseIds: string[];
		mostOftenEasierCaseIds: string[];
		movementCounts: Record<
			string,
			{
				harder: number;
				easier: number;
				unchanged: number;
			}
		>;
	};
};

export type RAGAnswerGroundingEvaluationCaseDiff = {
	caseId: string;
	label?: string;
	query?: string;
	previousStatus?: RAGAnswerGroundingEvaluationCaseResult['status'];
	currentStatus: RAGAnswerGroundingEvaluationCaseResult['status'];
	previousCoverage?: RAGAnswerGroundingEvaluationCaseResult['coverage'];
	currentCoverage: RAGAnswerGroundingEvaluationCaseResult['coverage'];
	previousCitationF1?: number;
	currentCitationF1: number;
	previousCitedIds: string[];
	currentCitedIds: string[];
	previousMatchedIds: string[];
	currentMatchedIds: string[];
	previousMissingIds: string[];
	currentMissingIds: string[];
	previousExtraIds: string[];
	currentExtraIds: string[];
	previousReferenceCount?: number;
	currentReferenceCount: number;
	previousResolvedCitationCount?: number;
	currentResolvedCitationCount: number;
	previousUnresolvedCitationCount?: number;
	currentUnresolvedCitationCount: number;
	previousUngroundedReferenceNumbers: number[];
	currentUngroundedReferenceNumbers: number[];
	previousAnswer?: string;
	currentAnswer: string;
	answerChanged: boolean;
};

export type RAGAnswerGroundingEvaluationCaseSnapshot = {
	caseId: string;
	label?: string;
	query?: string;
	status: RAGAnswerGroundingEvaluationCaseResult['status'];
	coverage: RAGAnswerGroundingEvaluationCaseResult['coverage'];
	citationF1: number;
	resolvedCitationRate: number;
	citationCount: number;
	referenceCount: number;
	resolvedCitationCount: number;
	unresolvedCitationCount: number;
	citedIds: string[];
	matchedIds: string[];
	missingIds: string[];
	extraIds: string[];
	ungroundedReferenceNumbers: number[];
	answer: string;
	previousAnswer?: string;
	answerChange: 'new' | 'changed' | 'unchanged';
};

export type RAGAnswerGroundingEvaluationRunDiff = {
	suiteId: string;
	currentRunId: string;
	previousRunId?: string;
	regressedCases: RAGAnswerGroundingEvaluationCaseDiff[];
	improvedCases: RAGAnswerGroundingEvaluationCaseDiff[];
	unchangedCases: RAGAnswerGroundingEvaluationCaseDiff[];
	summaryDelta: {
		passingRate: number;
		averageCitationF1: number;
		averageResolvedCitationRate: number;
		passedCases: number;
		failedCases: number;
		partialCases: number;
	};
};

export type RAGAnswerGroundingEvaluationHistory = {
	suiteId: string;
	suiteLabel?: string;
	runs: RAGAnswerGroundingEvaluationRun[];
	leaderboard: RAGAnswerGroundingEvaluationLeaderboardEntry[];
	latestRun?: RAGAnswerGroundingEvaluationRun;
	previousRun?: RAGAnswerGroundingEvaluationRun;
	caseSnapshots: RAGAnswerGroundingEvaluationCaseSnapshot[];
	diff?: RAGAnswerGroundingEvaluationRunDiff;
};

export type RAGEvaluationInput = {
	cases: RAGEvaluationCase[];
	topK?: number;
	scoreThreshold?: number;
	model?: string;
	filter?: Record<string, unknown>;
	dryRun?: boolean;
};

export type RAGEvaluationCaseResult = {
	caseId: string;
	query: string;
	label?: string;
	status: 'pass' | 'partial' | 'fail';
	topK: number;
	elapsedMs: number;
	retrievedCount: number;
	expectedCount: number;
	matchedCount: number;
	precision: number;
	recall: number;
	f1: number;
	retrievedIds: string[];
	expectedIds: string[];
	matchedIds: string[];
	missingIds: string[];
	mode: 'chunkId' | 'source' | 'documentId';
	metadata?: Record<string, unknown>;
};

export type RAGEvaluationSummary = {
	totalCases: number;
	passedCases: number;
	partialCases: number;
	failedCases: number;
	averagePrecision: number;
	averageRecall: number;
	averageF1: number;
	averageLatencyMs: number;
};

export type RAGEvaluationResponse = {
	ok: true;
	cases: RAGEvaluationCaseResult[];
	summary: RAGEvaluationSummary;
	elapsedMs: number;
	totalCases: number;
	passingRate: number;
};

export type RAGEvaluationSuite = {
	id: string;
	label?: string;
	description?: string;
	input: RAGEvaluationInput;
	metadata?: Record<string, unknown>;
};

export type RAGEvaluationSuiteRun = {
	id: string;
	suiteId: string;
	label: string;
	startedAt: number;
	finishedAt: number;
	elapsedMs: number;
	response: RAGEvaluationResponse;
	metadata?: Record<string, unknown>;
};

export type RAGEvaluationHistoryStore = {
	saveRun: (run: RAGEvaluationSuiteRun) => Promise<void> | void;
	listRuns: (input?: {
		suiteId?: string;
		limit?: number;
	}) => Promise<RAGEvaluationSuiteRun[]> | RAGEvaluationSuiteRun[];
};

export type RAGEvaluationCaseDiff = {
	caseId: string;
	label?: string;
	query: string;
	previousStatus?: RAGEvaluationCaseResult['status'];
	currentStatus: RAGEvaluationCaseResult['status'];
	previousF1?: number;
	currentF1: number;
	previousMatchedIds: string[];
	currentMatchedIds: string[];
	previousMissingIds: string[];
	currentMissingIds: string[];
};

export type RAGEvaluationRunDiff = {
	suiteId: string;
	currentRunId: string;
	previousRunId?: string;
	regressedCases: RAGEvaluationCaseDiff[];
	improvedCases: RAGEvaluationCaseDiff[];
	unchangedCases: RAGEvaluationCaseDiff[];
	summaryDelta: {
		passingRate: number;
		averageF1: number;
		averageLatencyMs: number;
		passedCases: number;
		failedCases: number;
		partialCases: number;
	};
};

export type RAGEvaluationHistory = {
	suiteId: string;
	suiteLabel?: string;
	runs: RAGEvaluationSuiteRun[];
	leaderboard: RAGEvaluationLeaderboardEntry[];
	latestRun?: RAGEvaluationSuiteRun;
	previousRun?: RAGEvaluationSuiteRun;
	diff?: RAGEvaluationRunDiff;
};

export type RAGEvaluationLeaderboardEntry = {
	runId: string;
	suiteId: string;
	label: string;
	passingRate: number;
	averageF1: number;
	averageLatencyMs: number;
	totalCases: number;
	rank: number;
};

export type RAGRerankerCandidate = {
	id: string;
	label?: string;
	rerank?: RAGRerankerProviderLike;
};

export type RAGRetrievalCandidate = {
	id: string;
	label?: string;
	retrieval?: RAGCollectionSearchParams['retrieval'];
	queryTransform?: RAGQueryTransformProviderLike;
	rerank?: RAGRerankerProviderLike;
};

export type RAGRerankerComparisonEntry = {
	rerankerId: string;
	label: string;
	providerName?: string;
	response: RAGEvaluationResponse;
};

export type RAGRerankerComparisonSummary = {
	bestByPassingRate?: string;
	bestByAverageF1?: string;
	fastest?: string;
};

export type RAGRerankerComparison = {
	suiteId: string;
	suiteLabel: string;
	entries: RAGRerankerComparisonEntry[];
	summary: RAGRerankerComparisonSummary;
	leaderboard: RAGEvaluationLeaderboardEntry[];
};

export type RAGRetrievalComparisonEntry = {
	retrievalId: string;
	label: string;
	retrievalMode: RAGHybridRetrievalMode;
	response: RAGEvaluationResponse;
};

export type RAGRetrievalComparisonSummary = {
	bestByPassingRate?: string;
	bestByAverageF1?: string;
	fastest?: string;
};

export type RAGRetrievalComparison = {
	suiteId: string;
	suiteLabel: string;
	entries: RAGRetrievalComparisonEntry[];
	summary: RAGRetrievalComparisonSummary;
	leaderboard: RAGEvaluationLeaderboardEntry[];
};

export type RAGCollection = {
	store: RAGVectorStore;
	search: (input: RAGCollectionSearchParams) => Promise<RAGQueryResult[]>;
	ingest: (input: RAGUpsertInput) => Promise<void>;
	clear?: () => Promise<void> | void;
	getStatus?: () => RAGVectorStoreStatus;
	getCapabilities?: () => RAGBackendCapabilities;
};

export type RAGIndexManager = {
	listDocuments: (input?: {
		kind?: string;
	}) => Promise<RAGIndexedDocument[]> | RAGIndexedDocument[];
	createDocument?: (
		input: RAGIngestDocument
	) => Promise<RAGMutationResponse> | RAGMutationResponse;
	getDocumentChunks: (
		id: string
	) =>
		| Promise<RAGDocumentChunkPreview | null>
		| RAGDocumentChunkPreview
		| null;
	deleteDocument?: (id: string) => Promise<boolean> | boolean;
	reindexDocument?: (
		id: string
	) => Promise<RAGMutationResponse | void> | RAGMutationResponse | void;
	reindexSource?: (
		source: string
	) => Promise<RAGMutationResponse | void> | RAGMutationResponse | void;
	listSyncSources?: () =>
		| Promise<RAGSyncSourceRecord[]>
		| RAGSyncSourceRecord[];
	syncSource?: (
		id: string,
		options?: RAGSyncRunOptions
	) => Promise<RAGSyncResponse | void> | RAGSyncResponse | void;
	syncAllSources?: (
		options?: RAGSyncRunOptions
	) => Promise<RAGSyncResponse | void> | RAGSyncResponse | void;
	reseed?: () =>
		| Promise<RAGMutationResponse | void>
		| RAGMutationResponse
		| void;
	reset?: () =>
		| Promise<RAGMutationResponse | void>
		| RAGMutationResponse
		| void;
	listBackends?: () =>
		| Promise<Omit<RAGBackendsResponse, 'ok'> | RAGBackendDescriptor[]>
		| Omit<RAGBackendsResponse, 'ok'>
		| RAGBackendDescriptor[];
};

export type AITextChunk = {
	type: 'text';
	content: string;
};

export type AIToolUseChunk = {
	type: 'tool_use';
	id: string;
	name: string;
	input: unknown;
};

export type AIDoneChunk = {
	type: 'done';
	usage?: AIUsage;
};

export type AIThinkingChunk = {
	type: 'thinking';
	content: string;
	signature?: string;
};

export type AIImageChunk = {
	type: 'image';
	data: string;
	format: string;
	isPartial: boolean;
	revisedPrompt?: string;
	imageId?: string;
};

export type AIChunk =
	| AITextChunk
	| AIThinkingChunk
	| AIToolUseChunk
	| AIImageChunk
	| AIDoneChunk;

export type AIProviderStreamParams = {
	model: string;
	messages: AIProviderMessage[];
	tools?: AIProviderToolDefinition[];
	systemPrompt?: string;
	thinking?: { type: string; budget_tokens: number };
	signal?: AbortSignal;
};

export type AIProviderMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string | AIProviderContentBlock[];
};

export type AIImageSource = {
	type: 'base64';
	data: string;
	media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
};

export type AIDocumentSource = {
	type: 'base64';
	data: string;
	media_type: 'application/pdf';
};

export type AIProviderContentBlock =
	| { type: 'text'; content: string }
	| { type: 'thinking'; thinking: string; signature?: string }
	| { type: 'image'; source: AIImageSource }
	| { type: 'document'; source: AIDocumentSource; name?: string }
	| { type: 'tool_use'; id: string; name: string; input: unknown }
	| { type: 'tool_result'; tool_use_id: string; content: string };

export type AIProviderToolDefinition = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
};

export type AIProviderConfig = {
	stream: (params: AIProviderStreamParams) => AsyncIterable<AIChunk>;
};

/* ─── Tool types ─── */

export type AIToolDefinition = {
	description: string;
	input: Record<string, unknown>;
	handler: (input: unknown) => Promise<string> | string;
};

export type AIToolMap = Record<string, AIToolDefinition>;

/* ─── Wire protocol: Client → Server ─── */

export type AIAttachment = {
	data: string;
	media_type:
		| 'image/png'
		| 'image/jpeg'
		| 'image/gif'
		| 'image/webp'
		| 'application/pdf';
	name?: string;
};

export type AIMessageRequest = {
	type: 'message';
	content: string;
	conversationId?: string;
	attachments?: AIAttachment[];
};

export type AICancelRequest = {
	type: 'cancel';
	conversationId: string;
};

export type AIBranchRequest = {
	type: 'branch';
	messageId: string;
	content: string;
	conversationId: string;
};

export type AIClientMessage =
	| AIMessageRequest
	| AICancelRequest
	| AIBranchRequest;

/* ─── Wire protocol: Server → Client ─── */

export type AIChunkMessage = {
	type: 'chunk';
	content: string;
	messageId: string;
	conversationId: string;
};

export type AIThinkingMessage = {
	type: 'thinking';
	content: string;
	messageId: string;
	conversationId: string;
};

export type AIToolStatusMessage = {
	type: 'tool_status';
	name: string;
	status: 'running' | 'complete';
	input?: unknown;
	result?: string;
	messageId: string;
	conversationId: string;
};

export type AICompleteMessage = {
	type: 'complete';
	durationMs?: number;
	messageId: string;
	model?: string;
	conversationId: string;
	usage?: AIUsage;
	sources?: RAGSource[];
};

export type StreamAICompleteMetadata = {
	sources?: RAGSource[];
};

export type AIImageMessage = {
	type: 'image';
	data: string;
	format: string;
	isPartial: boolean;
	revisedPrompt?: string;
	imageId?: string;
	messageId: string;
	conversationId: string;
};

export type AIErrorMessage = {
	type: 'error';
	message: string;
	messageId?: string;
	conversationId?: string;
};

export type AIRetrievingMessage = {
	type: 'rag_retrieving';
	conversationId: string;
	messageId: string;
	retrievalStartedAt: number;
};

export type AIRetrievedMessage = {
	type: 'rag_retrieved';
	conversationId: string;
	messageId: string;
	retrievalStartedAt?: number;
	retrievedAt: number;
	retrievalDurationMs?: number;
	sources: RAGSource[];
};

export type AIServerMessage =
	| AIChunkMessage
	| AIThinkingMessage
	| AIToolStatusMessage
	| AIImageMessage
	| AICompleteMessage
	| AIRetrievingMessage
	| AIRetrievedMessage
	| AIErrorMessage;

/* ─── Conversation state ─── */

export type AIRole = 'user' | 'assistant' | 'system';

export type AIToolCall = {
	id: string;
	name: string;
	input: unknown;
	result?: string;
};

export type AIImageData = {
	data: string;
	format: string;
	isPartial: boolean;
	revisedPrompt?: string;
	imageId?: string;
};

export type AIMessage = {
	id: string;
	role: AIRole;
	content: string;
	conversationId: string;
	parentId?: string;
	attachments?: AIAttachment[];
	thinking?: string;
	toolCalls?: AIToolCall[];
	images?: AIImageData[];
	isStreaming?: boolean;
	model?: string;
	usage?: AIUsage;
	sources?: RAGSource[];
	retrievalStartedAt?: number;
	retrievedAt?: number;
	retrievalDurationMs?: number;
	durationMs?: number;
	timestamp: number;
};

export type AIConversation = {
	id: string;
	title?: string;
	messages: AIMessage[];
	activeStreamAbort?: AbortController;
	createdAt: number;
	lastMessageAt?: number;
};

export type AIConversationSummary = {
	id: string;
	title: string;
	messageCount: number;
	createdAt: number;
	lastMessageAt?: number;
};

/* ─── Configuration ─── */

export type StreamAIOptions = {
	provider: AIProviderConfig;
	model: string;
	messages?: AIProviderMessage[];
	systemPrompt?: string;
	tools?: AIToolMap;
	thinking?: boolean | { budgetTokens: number };
	onChunk?: (chunk: AITextChunk) => AITextChunk | void;
	onComplete?: (
		fullResponse: string,
		usage?: AIUsage,
		metadata?: StreamAICompleteMetadata
	) => void;
	onToolUse?: (name: string, input: unknown, result: string) => void;
	onImage?: (imageData: AIImageData) => void;
	maxTurns?: number;
	signal?: AbortSignal;
	completeMeta?: StreamAICompleteMetadata;
};

/* ─── Client-side state ─── */

export type AIStreamState = {
	conversations: Map<string, AIConversation>;
	activeConversationId: string | null;
	isStreaming: boolean;
	error: string | null;
};

export type AIStoreAction =
	| {
			type: 'chunk';
			conversationId: string;
			messageId: string;
			content: string;
	  }
	| {
			type: 'thinking';
			conversationId: string;
			messageId: string;
			content: string;
	  }
	| {
			type: 'tool_status';
			conversationId: string;
			messageId: string;
			name: string;
			status: 'running' | 'complete';
			input?: unknown;
			result?: string;
	  }
	| {
			type: 'complete';
			conversationId: string;
			durationMs?: number;
			messageId: string;
			model?: string;
			usage?: AIUsage;
			sources?: RAGSource[];
	  }
	| {
			type: 'image';
			conversationId: string;
			messageId: string;
			data: string;
			format: string;
			isPartial: boolean;
			revisedPrompt?: string;
			imageId?: string;
	  }
	| { type: 'error'; message: string }
	| {
			type: 'rag_retrieving';
			conversationId: string;
			messageId: string;
			retrievalStartedAt: number;
	  }
	| {
			type: 'rag_retrieved';
			conversationId: string;
			messageId: string;
			retrievalStartedAt?: number;
			retrievedAt: number;
			retrievalDurationMs?: number;
			sources: RAGSource[];
	  }
	| {
			type: 'send';
			content: string;
			conversationId: string;
			messageId: string;
			attachments?: AIAttachment[];
	  }
	| { type: 'cancel' }
	| {
			type: 'branch';
			oldConversationId: string;
			newConversationId: string;
			fromMessageId: string;
	  }
	| { type: 'set_conversation'; conversationId: string };

/* ─── WebSocket interface ─── */

export type AIWebSocket = {
	send(data: string): void;
	readyState: number;
};

/* ─── Conversation store ─── */

export type AIConversationStore = {
	get: (id: string) => Promise<AIConversation | undefined>;
	getOrCreate: (id: string) => Promise<AIConversation>;
	set: (id: string, conversation: AIConversation) => Promise<void>;
	list: () => Promise<AIConversationSummary[]>;
	remove: (id: string) => Promise<void>;
};

/* ─── HTMX render config ─── */

export type AIHTMXRenderConfig = {
	messageStart?: (input: {
		conversationId: string;
		messageId: string;
		content: string;
		sseUrl: string;
		cancelUrl: string;
	}) => string;
	chunk?: (text: string, fullContent: string) => string;
	thinking?: (text: string) => string;
	toolRunning?: (name: string, input: unknown) => string;
	toolComplete?: (name: string, result: string) => string;
	image?: (data: string, format: string, revisedPrompt?: string) => string;
	ragRetrieving?: (input?: {
		conversationId: string;
		messageId: string;
		retrievalStartedAt?: number;
	}) => string;
	complete?: (usage?: AIUsage, durationMs?: number, model?: string) => string;
	ragRetrieved?: (
		sources: RAGSource[],
		input?: {
			conversationId: string;
			messageId: string;
			retrievalStartedAt?: number;
			retrievedAt?: number;
			retrievalDurationMs?: number;
		}
	) => string;
	canceled?: () => string;
	error?: (message: string) => string;
};

export type RAGHTMXWorkflowRenderConfig = {
	status?: (input: {
		status?: RAGVectorStoreStatus;
		capabilities?: RAGBackendCapabilities;
		documents?: RAGDocumentSummary;
	}) => string;
	searchResults?: (input: { query: string; results: RAGSource[] }) => string;
	searchResultItem?: (source: RAGSource, index: number) => string;
	documents?: (input: { documents: RAGIndexedDocument[] }) => string;
	documentItem?: (document: RAGIndexedDocument, index: number) => string;
	chunkPreview?: (input: RAGDocumentChunkPreview) => string;
	evaluateResult?: (input: {
		cases: RAGEvaluationCaseResult[];
		summary: RAGEvaluationSummary;
	}) => string;
	mutationResult?: (input: RAGMutationResponse) => string;
	emptyState?: (
		kind:
			| 'documents'
			| 'searchResults'
			| 'chunkPreview'
			| 'status'
			| 'evaluation'
	) => string;
	error?: (message: string) => string;
};

export type RAGHTMXConfig = {
	render?: AIHTMXRenderConfig;
	workflowRender?: RAGHTMXWorkflowRenderConfig;
	/** @deprecated Use workflowRender instead. */
	workflow?: {
		render?: RAGHTMXWorkflowRenderConfig;
	};
};

/* ─── Plugin config ─── */

export type AIChatPluginConfig = {
	path?: string;
	provider: (providerName: string) => AIProviderConfig;
	model?: string | ((providerName: string) => string);
	tools?:
		| AIToolMap
		| ((providerName: string, model: string) => AIToolMap | undefined);
	thinking?:
		| boolean
		| { budgetTokens: number }
		| ((
				providerName: string,
				model: string
		  ) => boolean | { budgetTokens: number } | undefined);
	systemPrompt?: string;
	maxTurns?: number;
	parseProvider?: (content: string) => {
		content: string;
		model?: string;
		providerName: string;
	};
	onComplete?: (
		conversationId: string,
		fullResponse: string,
		usage?: AIUsage
	) => void;
	store?: AIConversationStore;
	htmx?:
		| boolean
		| {
				render?: AIHTMXRenderConfig;
		  };
};

export type RAGChatPluginConfig = AIChatPluginConfig & {
	path?: string;
	ragStore?: RAGVectorStore;
	collection?: RAGCollection;
	extractors?: RAGFileExtractor[];
	embedding?: RAGEmbeddingProviderLike;
	embeddingModel?: string;
	readinessProviderName?: string;
	rerank?: RAGRerankerProviderLike;
	indexManager?: RAGIndexManager;
	topK?: number;
	scoreThreshold?: number;
	staleAfterMs?: number;
	ragCompleteSources?: boolean;
	systemPrompt?: string;
	htmx?: boolean | RAGHTMXConfig;
	onComplete?: (
		conversationId: string,
		fullResponse: string,
		usage?: AIUsage,
		sources?: RAGSource[]
	) => void;
};

/* ─── Connection options ─── */

export type AIConnectionOptions = {
	protocols?: string[];
	reconnect?: boolean;
	pingInterval?: number;
	maxReconnectAttempts?: number;
};
