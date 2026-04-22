import type { SessionStore } from './session';
import type {
	LinkedConnectorProvider,
	LinkedProviderAccessTokenLease,
	LinkedProviderAccountType,
	LinkedProviderBinding,
	LinkedProviderBindingStatus,
	LinkedProviderCredentialFailureReport,
	LinkedProviderCredentialResolver,
	LinkedProviderFailureCode,
	LinkedProviderFamily,
	LinkedProviderResolutionPurpose,
	ResolveLinkedProviderCredentialInput,
	ResolvedLinkedProviderCredential
} from '@absolutejs/linked-providers';

/* AI/LLM streaming types for WebSocket-based AI communication */

/* ─── Provider types ─── */

export type AIUsage = {
	inputTokens: number;
	outputTokens: number;
};

export type RAGExcerptMode = 'chunk' | 'window' | 'section';

export type RAGExcerptPromotionReason =
	| 'single_chunk'
	| 'chunk_too_narrow'
	| 'section_small_enough'
	| 'section_too_large_use_window';

export type RAGExcerptSelection = {
	mode: RAGExcerptMode;
	reason: RAGExcerptPromotionReason;
};

export type RAGExcerptModeCounts = Record<RAGExcerptMode, number>;

export type RAGSource = {
	chunkId: string;
	corpusKey?: string;
	score: number;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
	labels?: RAGSourceLabels;
	structure?: RAGChunkStructure;
};

export type RAGSourceGroup = {
	key: string;
	label: string;
	source?: string;
	title?: string;
	bestScore: number;
	count: number;
	chunks: RAGSource[];
	labels?: RAGSourceLabels;
	structure?: RAGChunkStructure;
};

export type RAGCitation = {
	key: string;
	label: string;
	chunkId: string;
	score: number;
	text: string;
	excerpt?: string;
	excerpts?: RAGChunkExcerpts;
	excerptSelection?: RAGExcerptSelection;
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
	excerpts?: RAGChunkExcerpts;
	excerptSelection?: RAGExcerptSelection;
	chunkIds: string[];
	citationNumbers: number[];
	citations: RAGCitation[];
	contextLabel?: string;
	locatorLabel?: string;
	provenanceLabel?: string;
	structure?: RAGChunkStructure;
};

export type RAGSectionRetrievalReason =
	| 'best_hit'
	| 'multi_hit_section'
	| 'dominant_within_parent'
	| 'only_section_in_parent'
	| 'concentrated_evidence';

export type RAGSectionTraceWeightReason =
	| 'rerank_preserved_lead'
	| 'final_stage_concentration'
	| 'final_stage_dominant_within_parent'
	| 'stage_runner_up_pressure'
	| 'stage_expanded'
	| 'stage_held'
	| 'stage_narrowed';

export type RAGSectionQueryAttributionReason =
	| 'base_query_only'
	| 'transformed_query_only'
	| 'variant_only'
	| 'transform_introduced'
	| 'variant_supported'
	| 'mixed_query_sources';

export type RAGSectionRetrievalDiagnostic = {
	key: string;
	label: string;
	path?: string[];
	parentLabel?: string;
	count: number;
	sourceCount: number;
	bestScore: number;
	averageScore: number;
	totalScore: number;
	scoreShare: number;
	parentShare?: number;
	parentShareGap?: number;
	siblingCount: number;
	strongestSiblingLabel?: string;
	strongestSiblingScore?: number;
	siblingScoreGap?: number;
	topChunkId?: string;
	topSource?: string;
	topContextLabel?: string;
	topLocatorLabel?: string;
	sourceAwareChunkReasonLabel?: string;
	sourceAwareUnitScopeLabel?: string;
	vectorHits: number;
	lexicalHits: number;
	hybridHits: number;
	stageCounts: Array<{
		stage: RAGRetrievalTraceStage;
		count: number;
	}>;
	stageWeights: Array<{
		stage: RAGRetrievalTraceStage;
		count: number;
		previousStage?: RAGRetrievalTraceStage;
		previousCount?: number;
		countDelta?: number;
		retentionRate?: number;
		totalScore?: number;
		stageScoreShare?: number;
		parentStageScoreShare?: number;
		stageScoreShareGap?: number;
		parentStageScoreShareGap?: number;
		stageShare: number;
		parentStageShare?: number;
		stageShareGap?: number;
		parentStageShareGap?: number;
		strongestSiblingLabel?: string;
		strongestSiblingCount?: number;
		reasons: RAGSectionTraceWeightReason[];
	}>;
	firstSeenStage?: RAGRetrievalTraceStage;
	lastSeenStage?: RAGRetrievalTraceStage;
	peakStage?: RAGRetrievalTraceStage;
	peakCount: number;
	finalCount?: number;
	finalRetentionRate?: number;
	dropFromPeak?: number;
	queryAttribution: {
		primaryHits: number;
		transformedHits: number;
		variantHits: number;
		mode: 'primary' | 'transformed' | 'variant' | 'mixed';
		reasons: RAGSectionQueryAttributionReason[];
	};
	requestedMode?: RAGHybridRetrievalMode;
	retrievalMode?: RAGHybridRetrievalMode;
	routingProvider?: string;
	routingLabel?: string;
	routingReason?: string;
	queryTransformProvider?: string;
	queryTransformLabel?: string;
	queryTransformReason?: string;
	evidenceReconcileApplied?: boolean;
	rerankApplied?: boolean;
	sourceBalanceApplied?: boolean;
	scoreThresholdApplied?: boolean;
	parentDistribution: Array<{
		key: string;
		label: string;
		count: number;
		totalScore: number;
		parentShare: number;
		isActive: boolean;
	}>;
	reasons: RAGSectionRetrievalReason[];
	summary: string;
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
	excerpts?: RAGChunkExcerpts;
	excerptSelection?: RAGExcerptSelection;
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
	excerpts?: RAGChunkExcerpts;
	excerptSelection?: RAGExcerptSelection;
	contextLabel?: string;
	provenanceLabel?: string;
	locatorLabel?: string;
	evidenceLabel: string;
	evidenceSummary: string;
};

export type RAGGroundedAnswerSectionSummary = {
	key: string;
	label: string;
	summary: string;
	count: number;
	excerpt?: string;
	excerpts?: RAGChunkExcerpts;
	excerptSelection?: RAGExcerptSelection;
	chunkIds: string[];
	referenceNumbers: number[];
	references: RAGGroundingReference[];
	contextLabel?: string;
	locatorLabel?: string;
	provenanceLabel?: string;
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
	sectionSummaries: RAGGroundedAnswerSectionSummary[];
	excerptModeCounts: RAGExcerptModeCounts;
	ungroundedReferenceNumbers: number[];
};

export type RAGRetrievedState = {
	conversationId: string;
	messageId: string;
	retrievalStartedAt?: number;
	retrievedAt?: number;
	retrievalDurationMs?: number;
	trace?: RAGRetrievalTrace;
	sources: RAGSource[];
	sourceGroups: RAGSourceGroup[];
	sourceSummaries: RAGSourceSummary[];
	sectionDiagnostics: RAGSectionRetrievalDiagnostic[];
	citations: RAGCitation[];
	citationReferenceMap: RAGCitationReferenceMap;
	excerptModeCounts: RAGExcerptModeCounts;
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
	sectionDiagnostics: RAGSectionRetrievalDiagnostic[];
	citations: RAGCitation[];
	citationReferenceMap: RAGCitationReferenceMap;
	groundingReferences: RAGGroundingReference[];
	groundedAnswer: RAGGroundedAnswer;
	excerptModeCounts: RAGExcerptModeCounts;
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
	corpusKey?: string;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
	embedding?: number[];
	embeddingVariants?: RAGDocumentChunkEmbeddingVariant[];
	structure?: RAGChunkStructure;
};

export type RAGDocumentChunkEmbeddingVariant = {
	id: string;
	label?: string;
	text?: string;
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

export type RAGContentFormat =
	| 'text'
	| 'markdown'
	| 'html'
	| 'jsonl'
	| 'tsv'
	| 'csv'
	| 'xml'
	| 'yaml';

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
	extractorRegistry?: RAGFileExtractorRegistryLike;
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

export type RAGFileExtractorRegistryInput = RAGFileExtractionInput & {
	inferredContentType?: string | null;
	inferredExtension?: string | null;
	inferredFormat?: RAGContentFormat;
};

export type RAGFileExtractorRegistration = {
	extractor: RAGFileExtractor;
	name?: string;
	priority?: number;
	contentTypes?: string[];
	extensions?: string[];
	formats?: RAGContentFormat[];
	names?: string[];
	match?: (
		input: RAGFileExtractorRegistryInput
	) => boolean | Promise<boolean>;
};

export type RAGFileExtractorRegistry = {
	registrations: RAGFileExtractorRegistration[];
	includeDefaults?: boolean;
	defaultOrder?: 'registry_first' | 'defaults_first';
};

export type RAGFileExtractorRegistryLike =
	| RAGFileExtractorRegistry
	| RAGFileExtractorRegistration[];

export type RAGMediaTranscriptSegment = {
	text: string;
	startMs?: number;
	endMs?: number;
	speaker?: string;
	channel?: string;
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

export type RAGOCRRegion = {
	text: string;
	confidence?: number;
	page?: number;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type RAGOCRResult = {
	text: string;
	title?: string;
	metadata?: Record<string, unknown>;
	confidence?: number;
	regions?: RAGOCRRegion[];
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

export type RAGChunkingProfileInput = {
	document: RAGIngestDocument;
	format: RAGContentFormat;
	normalizedText: string;
	metadata: Record<string, unknown>;
	sourceNativeKind?: string;
	defaults?: RAGChunkingOptions;
};

export type RAGChunkingProfile = {
	name: string;
	resolve: (
		input: RAGChunkingProfileInput
	) => Partial<RAGChunkingOptions> | undefined;
};

export type RAGChunkingProfileRegistration = {
	name?: string;
	documentIds?: string[];
	formats?: RAGContentFormat[];
	priority?: number;
	profile:
		| Partial<RAGChunkingOptions>
		| {
				options?: Partial<RAGChunkingOptions>;
		  };
	sourceNativeKinds?: string[];
	sources?: string[];
};

export type RAGChunkingRegistry = {
	profiles: Array<RAGChunkingProfile | RAGChunkingProfileRegistration>;
};

export type RAGChunkingRegistryLike =
	| RAGChunkingRegistry
	| Array<RAGChunkingProfile | RAGChunkingProfileRegistration>;

export type RAGIngestDocument = {
	text: string;
	corpusKey?: string;
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
	extractorRegistry?: RAGFileExtractorRegistryLike;
};

export type RAGDocumentUrlIngestInput = {
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	urls: RAGDocumentUrlInput[];
};

export type RAGPreparedDocument = {
	corpusKey?: string;
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
	extractorRegistry?: RAGFileExtractorRegistryLike;
};

export type RAGDirectoryIngestInput = {
	directory: string;
	recursive?: boolean;
	includeExtensions?: string[];
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
};

export type RAGQueryInput = {
	queryVector: number[];
	topK: number;
	filter?: Record<string, unknown>;
	plannerProfile?: RAGNativeQueryProfile;
	queryMultiplier?: number;
	candidateLimit?: number;
	maxBackfills?: number;
	minResults?: number;
	fillPolicy?: 'strict_topk' | 'satisfy_min_results';
};

export type RAGLexicalQueryInput = {
	query: string;
	topK: number;
	filter?: Record<string, unknown>;
};

export type RAGNativeQueryProfile = 'latency' | 'balanced' | 'recall';

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
	label?: string;
	reason?: string;
	metadata?: Record<string, string | number | boolean | null>;
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

export type RAGRetrievalStrategyDecision = {
	mode?: RAGHybridRetrievalMode;
	lexicalTopK?: number;
	maxResultsPerSource?: number;
	sourceBalanceStrategy?: RAGSourceBalanceStrategy;
	diversityStrategy?: RAGDiversityStrategy;
	mmrLambda?: number;
	fusion?: RAGHybridFusionMode;
	fusionConstant?: number;
	lexicalWeight?: number;
	vectorWeight?: number;
	label?: string;
	reason?: string;
	metadata?: Record<string, string | number | boolean | null>;
};

export type RAGRetrievalStrategyInput = {
	query: string;
	transformedQuery: string;
	variantQueries: string[];
	topK: number;
	candidateTopK: number;
	filter?: Record<string, unknown>;
	scoreThreshold?: number;
	model?: string;
	retrieval: RAGHybridSearchOptions;
};

export type RAGRetrievalStrategySelector = (
	input: RAGRetrievalStrategyInput
) =>
	| Promise<RAGRetrievalStrategyDecision | undefined>
	| RAGRetrievalStrategyDecision
	| undefined;

export type RAGRetrievalStrategyProvider = {
	select: RAGRetrievalStrategySelector;
	providerName?: string;
	defaultLabel?: string;
};

export type RAGRetrievalStrategyProviderLike =
	| RAGRetrievalStrategySelector
	| RAGRetrievalStrategyProvider;

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
	embedding?: number[];
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
};

export type RAGHybridRetrievalMode = 'vector' | 'lexical' | 'hybrid';

export type RAGHybridFusionMode = 'rrf' | 'max';

export type RAGSourceBalanceStrategy = 'cap' | 'round_robin';

export type RAGDiversityStrategy = 'none' | 'mmr';

export type RAGHybridSearchOptions = {
	mode?: RAGHybridRetrievalMode;
	lexicalTopK?: number;
	maxResultsPerSource?: number;
	sourceBalanceStrategy?: RAGSourceBalanceStrategy;
	diversityStrategy?: RAGDiversityStrategy;
	mmrLambda?: number;
	fusion?: RAGHybridFusionMode;
	fusionConstant?: number;
	lexicalWeight?: number;
	vectorWeight?: number;
	nativeQueryProfile?: RAGNativeQueryProfile;
	nativeCandidateLimit?: number;
	nativeMaxBackfills?: number;
	nativeMinResults?: number;
	nativeFillPolicy?: 'strict_topk' | 'satisfy_min_results';
};

export type RAGUpsertInput = {
	chunks: RAGDocumentChunk[];
};

export type RAGDocumentIngestInput = {
	documents: RAGIngestDocument[];
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
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
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	uploads: RAGDocumentUploadInput[];
};

export type RAGIndexedDocument = {
	corpusKey?: string;
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
	labels?: RAGSourceLabels;
};

export type RAGDocumentChunkPreview = {
	document: Omit<RAGIndexedDocument, 'text' | 'metadata'> & {
		metadata?: Record<string, unknown>;
		labels?: RAGSourceLabels;
	};
	normalizedText: string;
	chunks: Array<
		RAGDocumentChunk & {
			labels?: RAGSourceLabels;
			excerpts?: RAGChunkExcerpts;
			excerptSelection?: RAGExcerptSelection;
			structure?: RAGChunkStructure;
		}
	>;
};

export type RAGChunkExcerpts = {
	chunkExcerpt: string;
	windowExcerpt: string;
	sectionExcerpt: string;
};

export type RAGSourceLabels = {
	contextLabel?: string;
	locatorLabel?: string;
	provenanceLabel?: string;
};

export type RAGChunkSection = {
	title?: string;
	path?: string[];
	depth?: number;
	kind?:
		| 'markdown_heading'
		| 'html_heading'
		| 'office_heading'
		| 'office_block'
		| 'pdf_block'
		| 'spreadsheet_rows'
		| 'presentation_slide';
};

export type RAGChunkSequence = {
	sectionChunkId?: string;
	sectionChunkIndex?: number;
	sectionChunkCount?: number;
	previousChunkId?: string;
	nextChunkId?: string;
};

export type RAGChunkStructure = {
	section?: RAGChunkSection;
	sequence?: RAGChunkSequence;
};

export type RAGChunkGraphNode = {
	chunkId: string;
	label: string;
	source?: string;
	title?: string;
	score?: number;
	contextLabel?: string;
	locatorLabel?: string;
	provenanceLabel?: string;
	structure?: RAGChunkStructure;
};

export type RAGChunkGraphEdge = {
	fromChunkId: string;
	toChunkId: string;
	relation: 'previous' | 'next' | 'section_parent' | 'section_child';
};

export type RAGChunkGraphSectionGroup = {
	id: string;
	title?: string;
	path?: string[];
	depth?: number;
	kind?:
		| 'markdown_heading'
		| 'html_heading'
		| 'office_heading'
		| 'office_block'
		| 'pdf_block'
		| 'spreadsheet_rows'
		| 'presentation_slide';
	chunkIds: string[];
	chunkCount: number;
	leadChunkId?: string;
	parentSectionId?: string;
	childSectionIds: string[];
};

export type RAGChunkGraph = {
	nodes: RAGChunkGraphNode[];
	edges: RAGChunkGraphEdge[];
	sections: RAGChunkGraphSectionGroup[];
};

export type RAGChunkGraphNavigation = {
	activeChunkId?: string;
	activeNode?: RAGChunkGraphNode;
	previousNode?: RAGChunkGraphNode;
	nextNode?: RAGChunkGraphNode;
	section?: RAGChunkGraphSectionGroup;
	parentSection?: RAGChunkGraphSectionGroup;
	childSections: RAGChunkGraphSectionGroup[];
	siblingSections: RAGChunkGraphSectionGroup[];
	sectionNodes: RAGChunkGraphNode[];
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
	rowCount?: number;
	pageCount?: number;
	freelistCount?: number;
	databaseBytes?: number;
	lastHealthCheckAt?: number;
	lastAnalyzeAt?: number;
	resolution?: SQLiteVecResolution;
	fallbackReason?: string;
	lastAnalyzeError?: string;
	lastHealthError?: string;
	lastLoadError?: string;
	lastQueryError?: string;
	lastUpsertError?: string;
	lastQueryPlan?: {
		pushdownMode: 'none' | 'partial' | 'full';
		pushdownApplied: boolean;
		pushdownClauseCount: number;
		totalFilterClauseCount: number;
		jsRemainderClauseCount: number;
		plannerProfileUsed?: RAGNativeQueryProfile;
		queryMultiplierUsed?: number;
		candidateLimitUsed?: number;
		maxBackfillsUsed?: number;
		minResultsUsed?: number;
		fillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
		pushdownCoverageRatio?: number;
		jsRemainderRatio?: number;
		filteredCandidateCount?: number;
		initialSearchK?: number;
		finalSearchK?: number;
		searchExpansionRatio?: number;
		backfillCount?: number;
		backfillLimitReached?: boolean;
		minResultsSatisfied?: boolean;
		returnedCount?: number;
		candidateYieldRatio?: number;
		topKFillRatio?: number;
		underfilledTopK?: boolean;
		candidateBudgetExhausted?: boolean;
		candidateCoverage?: 'empty' | 'under_target' | 'target_sized' | 'broad';
		queryMode: 'json_fallback' | 'native_vec0';
	};
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
	indexName?: string;
	indexPresent?: boolean;
	estimatedRowCount?: number;
	tableBytes?: number;
	indexBytes?: number;
	totalBytes?: number;
	lastHealthCheckAt?: number;
	lastAnalyzeAt?: number;
	lastReindexAt?: number;
	fallbackReason?: string;
	lastAnalyzeError?: string;
	lastInitError?: string;
	lastQueryError?: string;
	lastReindexError?: string;
	lastUpsertError?: string;
	lastMigrationError?: string;
	lastHealthError?: string;
	lastFilterDebug?: {
		filter?: Record<string, unknown>;
		pushdownFilter?: Record<string, unknown>;
		countSql?: string;
		countParams?: unknown[];
		querySql?: string;
		queryParams?: unknown[];
		countResultRaw?: unknown;
		queryRowCount?: number;
	};
	lastQueryPlan?: {
		pushdownMode: 'none' | 'partial' | 'full';
		pushdownApplied: boolean;
		pushdownClauseCount: number;
		totalFilterClauseCount: number;
		jsRemainderClauseCount: number;
		plannerProfileUsed?: RAGNativeQueryProfile;
		queryMultiplierUsed?: number;
		candidateLimitUsed?: number;
		maxBackfillsUsed?: number;
		minResultsUsed?: number;
		fillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
		pushdownCoverageRatio?: number;
		jsRemainderRatio?: number;
		filteredCandidateCount?: number;
		initialSearchK?: number;
		finalSearchK?: number;
		searchExpansionRatio?: number;
		backfillCount?: number;
		backfillLimitReached?: boolean;
		minResultsSatisfied?: boolean;
		returnedCount?: number;
		candidateYieldRatio?: number;
		topKFillRatio?: number;
		underfilledTopK?: boolean;
		candidateBudgetExhausted?: boolean;
		candidateCoverage?: 'empty' | 'under_target' | 'target_sized' | 'broad';
		queryMode: 'native_pgvector';
	};
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

export type RAGVectorCountInput = {
	filter?: Record<string, unknown>;
	chunkIds?: string[];
};

export type RAGVectorDeleteInput = {
	filter?: Record<string, unknown>;
	chunkIds?: string[];
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
	count?: (input?: RAGVectorCountInput) => Promise<number>;
	delete?: (input?: RAGVectorDeleteInput) => Promise<number>;
	analyze?: () => Promise<void> | void;
	rebuildNativeIndex?: () => Promise<void> | void;
	upsert: (input: RAGUpsertInput) => Promise<void>;
	clear?: () => Promise<void> | void;
	close?: () => Promise<void> | void;
	getStatus?: () => RAGVectorStoreStatus;
	getCapabilities?: () => RAGBackendCapabilities;
};

export type RAGCollectionSearchParams = {
	query: string;
	topK?: number;
	candidateTopK?: number;
	nativeQueryProfile?: RAGNativeQueryProfile;
	nativeQueryMultiplier?: number;
	nativeCandidateLimit?: number;
	nativeMaxBackfills?: number;
	nativeMinResults?: number;
	nativeFillPolicy?: 'strict_topk' | 'satisfy_min_results';
	filter?: Record<string, unknown>;
	scoreThreshold?: number;
	queryTransform?: RAGQueryTransformProviderLike;
	retrievalStrategy?: RAGRetrievalStrategyProviderLike;
	rerank?: RAGRerankerProviderLike;
	retrieval?: RAGHybridSearchOptions | RAGHybridRetrievalMode;
	model?: string;
	signal?: AbortSignal;
};

export type RAGRetrievalTraceStage =
	| 'input'
	| 'query_transform'
	| 'routing'
	| 'embed'
	| 'vector_search'
	| 'lexical_search'
	| 'fusion'
	| 'rerank'
	| 'diversity'
	| 'source_balance'
	| 'evidence_reconcile'
	| 'score_filter'
	| 'finalize';

export type RAGRetrievalTraceStep = {
	stage: RAGRetrievalTraceStage;
	label: string;
	durationMs?: number;
	count?: number;
	sectionCounts?: Array<{
		key: string;
		label: string;
		count: number;
	}>;
	sectionScores?: Array<{
		key: string;
		label: string;
		totalScore: number;
	}>;
	metadata?: Record<string, string | number | boolean | null>;
};

export type RAGRetrievalTrace = {
	query: string;
	transformedQuery: string;
	variantQueries: string[];
	queryTransformProvider?: string;
	queryTransformLabel?: string;
	queryTransformReason?: string;
	topK: number;
	candidateTopK: number;
	lexicalTopK: number;
	requestedMode?: RAGHybridRetrievalMode;
	maxResultsPerSource?: number;
	sourceBalanceStrategy?: RAGSourceBalanceStrategy;
	diversityStrategy?: RAGDiversityStrategy;
	mmrLambda?: number;
	mode: RAGHybridRetrievalMode;
	routingProvider?: string;
	routingLabel?: string;
	routingReason?: string;
	runVector: boolean;
	runLexical: boolean;
	scoreThreshold?: number;
	resultCounts: {
		vector: number;
		lexical: number;
		fused: number;
		reranked: number;
		final: number;
	};
	multiVector?: {
		configured: boolean;
		vectorVariantHits: number;
		lexicalVariantHits: number;
		collapsedParents: number;
	};
	steps: RAGRetrievalTraceStep[];
};

export type RAGCollectionSearchResult = {
	results: RAGQueryResult[];
	trace: RAGRetrievalTrace;
};

export type RAGSearchRequest = Omit<
	RAGCollectionSearchParams,
	'signal' | 'rerank'
> & {
	includeTrace?: boolean;
	persistTrace?: boolean;
	traceGroupKey?: string;
	traceTags?: string[];
};

export type RAGSearchResponse = {
	ok: boolean;
	results?: RAGSource[];
	trace?: RAGRetrievalTrace;
	error?: string;
};

export type RAGSearchTraceHistoryResponse = {
	ok: boolean;
	history?: RAGSearchTraceHistory;
	error?: string;
};

export type RAGSearchTraceGroupHistoryResponse = {
	ok: boolean;
	history?: RAGSearchTraceGroupHistory;
	error?: string;
};

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
	inspection?: {
		corpusKeys: Record<string, number>;
		sourceNativeKinds: Record<string, number>;
		extractorRegistryMatches: Record<string, number>;
		chunkingProfiles: Record<string, number>;
		documentsWithSourceLabels: number;
		chunksWithSourceLabels: number;
		sampleDocuments: Array<{
			corpusKey?: string;
			id: string;
			title: string;
			source: string;
			sourceNativeKind?: string;
			extractorRegistryMatch?: string;
			chunkingProfile?: string;
			labels?: RAGSourceLabels;
		}>;
		sampleChunks: Array<{
			chunkId: string;
			corpusKey?: string;
			documentId?: string;
			source?: string;
			sourceNativeKind?: string;
			extractorRegistryMatch?: string;
			chunkingProfile?: string;
			labels?: RAGSourceLabels;
		}>;
	};
};

export type RAGAdminActionRecord = {
	id: string;
	action:
		| 'analyze_backend'
		| 'rebuild_native_index'
		| 'clear_index'
		| 'create_document'
		| 'delete_document'
		| 'promote_retrieval_baseline'
		| 'revert_retrieval_baseline'
		| 'prune_search_traces'
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
		| 'analyze_backend'
		| 'rebuild_native_index'
		| 'clear_index'
		| 'create_document'
		| 'delete_document'
		| 'promote_retrieval_baseline'
		| 'revert_retrieval_baseline'
		| 'prune_search_traces'
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

export type RAGJobState = {
	adminActions: RAGAdminActionRecord[];
	ingestJobs: RAGIngestJobRecord[];
	adminJobs: RAGAdminJobRecord[];
	syncJobs: RAGAdminJobRecord[];
};

export type RAGJobStateStore = {
	load: () =>
		| Promise<Partial<RAGJobState> | undefined>
		| Partial<RAGJobState>
		| undefined;
	save: (state: RAGJobState) => Promise<void> | void;
};

export type RAGJobHistoryRetention = {
	maxAdminActions?: number;
	maxAdminJobs?: number;
	maxIngestJobs?: number;
	maxSyncJobs?: number;
};

export type RAGAdminCapabilities = {
	canAnalyzeBackend: boolean;
	canClearIndex: boolean;
	canCreateDocument: boolean;
	canDeleteDocument: boolean;
	canListSyncSources: boolean;
	canManageRetrievalBaselines: boolean;
	canPruneSearchTraces: boolean;
	canRebuildNativeIndex: boolean;
	canReindexDocument: boolean;
	canReindexSource: boolean;
	canReseed: boolean;
	canReset: boolean;
	canSyncAllSources: boolean;
	canSyncSource: boolean;
};

export type RAGBackendMaintenanceRecommendation = {
	code:
		| 'backend_statistics_refresh_recommended'
		| 'native_backend_inactive'
		| 'native_backend_recent_errors'
		| 'native_index_missing'
		| 'native_index_rebuild_recommended'
		| 'sqlite_storage_optimization_recommended';
	message: string;
	severity: 'info' | 'warning' | 'error';
	action?: 'analyze_backend' | 'rebuild_native_index';
};

export type RAGBackendMaintenanceSummary = {
	backend: Exclude<RAGVectorStoreStatus['backend'], 'in_memory'>;
	activeJobs: Array<{
		action: 'analyze_backend' | 'rebuild_native_index';
		startedAt: number;
		target?: string;
	}>;
	recentActions: Array<{
		action: 'analyze_backend' | 'rebuild_native_index';
		status: RAGAdminActionRecord['status'];
		finishedAt?: number;
		target?: string;
		error?: string;
	}>;
	recommendations: RAGBackendMaintenanceRecommendation[];
};

export type RAGAuthorizedAction =
	| 'analyze_backend'
	| 'rebuild_native_index'
	| 'clear_index'
	| 'create_document'
	| 'delete_document'
	| 'ingest'
	| 'list_sync_sources'
	| 'manage_retrieval_admin'
	| 'manage_retrieval_baselines'
	| 'prune_search_traces'
	| 'reindex_document'
	| 'reindex_source'
	| 'reseed'
	| 'reset'
	| 'sync_all_sources'
	| 'sync_source';

export type RAGAuthorizationResource = {
	documentId?: string;
	path?: string;
	source?: string;
	sourceId?: string;
};

export type RAGAuthorizationDecision =
	| boolean
	| {
			allowed: boolean;
			reason?: string;
	  };

export type RAGAuthorizationContext = {
	action: RAGAuthorizedAction;
	request: Request;
	resource?: RAGAuthorizationResource;
};

export type RAGAuthorizationProvider = (
	context: RAGAuthorizationContext
) => Promise<RAGAuthorizationDecision> | RAGAuthorizationDecision;

export type RAGAccessScope = {
	allowedComparisonGroupKeys?: string[];
	allowedCorpusGroupKeys?: string[];
	allowedCorpusKeys?: string[];
	allowedDocumentIds?: string[];
	allowedSourcePrefixes?: string[];
	allowedSources?: string[];
	allowedSyncSourceIds?: string[];
	requiredMetadata?: Record<string, unknown>;
};

export type RAGAccessScopeProvider = (
	request: Request
) => Promise<RAGAccessScope | undefined> | RAGAccessScope | undefined;

export type RAGAccessControlContextResolver<TContext = unknown> = (
	request: Request
) => Promise<TContext | undefined> | TContext | undefined;

export type RAGAccessControlAuthorizeResolver<TContext = unknown> = (
	input: RAGAuthorizationContext & {
		context: TContext | undefined;
	}
) => Promise<RAGAuthorizationDecision> | RAGAuthorizationDecision;

export type RAGAccessControlScopeResolver<TContext = unknown> = (input: {
	context: TContext | undefined;
	request: Request;
}) => Promise<RAGAccessScope | undefined> | RAGAccessScope | undefined;

export type CreateRAGAccessControlOptions<TContext = unknown> = {
	resolveContext: RAGAccessControlContextResolver<TContext>;
	authorize?: RAGAccessControlAuthorizeResolver<TContext>;
	resolveScope?: RAGAccessControlScopeResolver<TContext>;
};

export type RAGSyncSourceStatus =
	| 'idle'
	| 'running'
	| 'completed'
	| 'failed'
	| 'disabled';

export type RAGSyncSourceDiagnosticCode =
	| 'sync_failed'
	| 'retry_scheduled'
	| 'storage_resume_pending'
	| 'email_resume_pending'
	| 'lineage_conflict_detected'
	| 'duplicate_sync_key_detected'
	| 'targeted_refresh_applied'
	| 'noop_sync'
	| 'extraction_failures_detected'
	| 'extractor_missing'
	| 'ocr_extractor_recommended'
	| 'canonical_dedupe_applied'
	| 'robots_blocked'
	| 'nofollow_skipped'
	| 'noindex_skipped';

export type RAGSyncSourceDiagnosticEntry = {
	code: RAGSyncSourceDiagnosticCode;
	severity: 'info' | 'warning' | 'error';
	summary: string;
};

export type RAGSyncRetryGuidance = {
	action:
		| 'wait_for_retry'
		| 'resume_sync'
		| 'resolve_conflicts'
		| 'rerun_sync'
		| 'inspect_source'
		| 'configure_extractor';
	reason: string;
	nextRetryAt?: number;
	resumeCursor?: string;
	syncKeys?: string[];
};

export type RAGSyncExtractionFailure = {
	itemLabel: string;
	itemKind: 'directory_file' | 'url' | 'storage_object' | 'email_attachment';
	reason: string;
	remediation: 'configure_extractor' | 'add_ocr_extractor' | 'inspect_file';
};

export type RAGSyncExtractionRecoveryAction = {
	remediation: RAGSyncExtractionFailure['remediation'];
	itemKinds: RAGSyncExtractionFailure['itemKind'][];
	itemLabels: string[];
	reasons: string[];
	count: number;
	summary: string;
};

export type RAGSyncExtractionRecoveryPreview = {
	actions: RAGSyncExtractionRecoveryAction[];
	recommendedAction?: RAGSyncExtractionRecoveryAction;
	unresolvedFailures: RAGSyncExtractionFailure[];
	summary?: string;
};

export type RAGSyncExtractionRecoveryHandler = (
	action: RAGSyncExtractionRecoveryAction
) => Promise<boolean | void> | boolean | void;

export type RAGSyncExtractionRecoveryHandlers = Partial<
	Record<
		RAGSyncExtractionFailure['remediation'],
		RAGSyncExtractionRecoveryHandler
	>
>;

export type RAGSyncExtractionRecoveryResult =
	RAGSyncExtractionRecoveryPreview & {
		completedActions: RAGSyncExtractionRecoveryAction[];
		failedActions: RAGSyncExtractionRecoveryAction[];
		skippedActions: RAGSyncExtractionRecoveryAction[];
		errorsByRemediation?: Partial<
			Record<RAGSyncExtractionFailure['remediation'], string>
		>;
	};

export type RAGSyncSourceDiagnostics = {
	summary: string;
	entries: RAGSyncSourceDiagnosticEntry[];
	extractionFailures?: RAGSyncExtractionFailure[];
	retryGuidance?: RAGSyncRetryGuidance;
};

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
	reconciliation?: RAGSyncSourceReconciliationSummary;
	diagnostics?: RAGSyncSourceDiagnostics;
	metadata?: Record<string, unknown>;
};

export type RAGSyncSourceReconciliationSummary = {
	refreshMode: 'noop' | 'targeted';
	staleDocumentIds: string[];
	staleSyncKeys: string[];
	refreshedDocumentIds: string[];
	refreshedSyncKeys: string[];
	unchangedDocumentIds: string[];
	unchangedSyncKeys: string[];
	targetedRefreshSyncKeys: string[];
	duplicateSyncKeyGroups: Array<{
		syncKey: string;
		count: number;
		documentIds: string[];
	}>;
	lineageConflicts: Array<{
		syncKey: string;
		lineageIds: string[];
		versionIds: string[];
		latestDocumentIds: string[];
		documentIds: string[];
		documents: Array<{
			documentId: string;
			lineageId?: string;
			versionId?: string;
			versionNumber?: number;
			isLatestVersion: boolean;
		}>;
		reasons: Array<
			| 'duplicate_sync_key'
			| 'multiple_lineages'
			| 'multiple_versions'
			| 'multiple_latest_versions'
		>;
	}>;
};

export type RAGSyncConflictResolutionStrategy =
	| 'keep_latest'
	| 'keep_highest_version';

export type RAGSyncConflictResolutionAction = {
	syncKey: string;
	keepDocumentId: string;
	deleteDocumentIds: string[];
	reasons: RAGSyncSourceReconciliationSummary['lineageConflicts'][number]['reasons'];
};

export type RAGSyncConflictResolutionAmbiguity = {
	syncKey: string;
	reasons: RAGSyncSourceReconciliationSummary['lineageConflicts'][number]['reasons'];
	candidateDocumentIds: string[];
	recommendedStrategy?: RAGSyncConflictResolutionStrategy;
};

export type RAGSyncConflictResolutionPreview = {
	strategy: RAGSyncConflictResolutionStrategy;
	actions: RAGSyncConflictResolutionAction[];
	unresolvedSyncKeys: string[];
	unresolvedConflicts: RAGSyncConflictResolutionAmbiguity[];
};

export type RAGSyncConflictResolutionResult =
	RAGSyncConflictResolutionPreview & {
		deletedDocumentIds: string[];
		failedDocumentIds: string[];
		errorsByDocumentId?: Record<string, string>;
	};

export type RAGSyncSourceRunResult = {
	documentCount?: number;
	chunkCount?: number;
	reconciliation?: RAGSyncSourceReconciliationSummary;
	diagnostics?: RAGSyncSourceDiagnostics;
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
	sourceRecord?: RAGSyncSourceRecord;
	signal?: AbortSignal;
};

export type RAGSQLiteStoreMigrationIssue = {
	tableName: string;
	columnName: string;
	definition: string;
};

export type RAGSQLiteStoreMigrationInspection = {
	issues: RAGSQLiteStoreMigrationIssue[];
	summary?: string;
};

export type RAGSQLiteStoreMigrationResult =
	RAGSQLiteStoreMigrationInspection & {
		applied: RAGSQLiteStoreMigrationIssue[];
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
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
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
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGFeedSyncInput = {
	url: string;
	title?: string;
	metadata?: Record<string, unknown>;
};

export type RAGFeedSyncSourceOptions = {
	id: string;
	label: string;
	feeds: RAGFeedSyncInput[];
	description?: string;
	autoDiscoverFromHTML?: boolean;
	maxEntriesPerFeed?: number;
	maxDiscoveredFeeds?: number;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGSitemapSyncInput = {
	url: string;
	title?: string;
	metadata?: Record<string, unknown>;
};

export type RAGSitemapSyncSourceOptions = {
	id: string;
	label: string;
	sitemaps: RAGSitemapSyncInput[];
	description?: string;
	maxUrlsPerSitemap?: number;
	autoDiscoverFromRobots?: boolean;
	maxNestedSitemaps?: number;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGSiteDiscoveryInput = {
	url: string;
	title?: string;
	metadata?: Record<string, unknown>;
};

export type RAGSiteDiscoverySyncSourceOptions = {
	id: string;
	label: string;
	sites: RAGSiteDiscoveryInput[];
	description?: string;
	autoDiscoverFeeds?: boolean;
	autoDiscoverSitemaps?: boolean;
	autoDiscoverLinkedPages?: boolean;
	maxDiscoveredFeeds?: number;
	maxEntriesPerFeed?: number;
	maxUrlsPerSitemap?: number;
	maxNestedSitemaps?: number;
	maxLinkedPages?: number;
	maxLinksPerPage?: number;
	maxLinkDepth?: number;
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	metadata?: Record<string, unknown>;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGGitHubRepoSyncInput = {
	owner: string;
	repo: string;
	branch?: string;
	pathPrefix?: string;
	includePaths?: string[];
	excludePaths?: string[];
	metadata?: Record<string, unknown>;
};

export type RAGGitHubSyncSourceOptions = {
	id: string;
	label: string;
	repos: RAGGitHubRepoSyncInput[];
	description?: string;
	apiBaseUrl?: string;
	token?: string;
	maxDepth?: number;
	maxFilesPerRepo?: number;
	includeExtensions?: string[];
	baseMetadata?: Record<string, unknown>;
	defaultChunking?: RAGChunkingOptions;
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
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
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	maxPagesPerRun?: number;
	metadata?: Record<string, unknown>;
	resumeFromLastCursor?: boolean;
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
	chunkingRegistry?: RAGChunkingRegistryLike;
	extractors?: RAGFileExtractor[];
	extractorRegistry?: RAGFileExtractorRegistryLike;
	maxPagesPerRun?: number;
	metadata?: Record<string, unknown>;
	resumeFromLastCursor?: boolean;
	retryAttempts?: number;
	retryDelayMs?: number;
};

export type RAGGmailLinkedEmailSyncClientOptions = {
	resolver: RAGLinkedProviderCredentialResolver;
	ownerRef: string;
	bindingId?: string;
	externalAccountId?: string;
	purpose?: RAGLinkedProviderResolutionPurpose;
	requiredScopes?: string[];
	minValidityMs?: number;
	userId?: string;
	query?: string;
	labelIds?: string[];
	includeSpamTrash?: boolean;
	maxResults?: number;
	fetch?: typeof fetch;
};

export type RAGGmailLinkedEmailSyncSourceOptions = Omit<
	RAGEmailSyncSourceOptions,
	'client'
> &
	RAGGmailLinkedEmailSyncClientOptions;

export type RAGLinkedProviderFamily = LinkedProviderFamily;
export type RAGConnectorProvider = LinkedConnectorProvider;
export type RAGLinkedProviderAccountType = LinkedProviderAccountType;
export type RAGLinkedProviderBindingStatus = LinkedProviderBindingStatus;
export type RAGLinkedProviderResolutionPurpose =
	LinkedProviderResolutionPurpose;
export type RAGLinkedProviderFailureCode = LinkedProviderFailureCode;
export type RAGLinkedProviderBinding = LinkedProviderBinding;
export type RAGResolvedLinkedProviderCredential =
	ResolvedLinkedProviderCredential;
export type RAGLinkedProviderAccessTokenLease = LinkedProviderAccessTokenLease;
export type RAGLinkedProviderCredentialFailureReport =
	LinkedProviderCredentialFailureReport;
export type ResolveRAGLinkedProviderCredentialInput =
	ResolveLinkedProviderCredentialInput;
export type RAGLinkedProviderCredentialResolver =
	LinkedProviderCredentialResolver;

export type RAGConnectorCheckpoint = Record<string, unknown>;

export type RAGConnectorItem = {
	id: string;
	kind: string;
	threadId?: string;
	title?: string;
	text?: string;
	html?: string;
	url?: string;
	createdAt?: number | string | Date;
	updatedAt?: number | string | Date;
	metadata?: Record<string, unknown>;
	attachments?: RAGEmailSyncAttachment[];
};

export type RAGConnectorSyncInput = {
	credential: RAGResolvedLinkedProviderCredential;
	resolver: RAGLinkedProviderCredentialResolver;
	checkpoint?: RAGConnectorCheckpoint;
	signal?: AbortSignal;
};

export type RAGConnectorSyncResult = {
	items: RAGConnectorItem[];
	nextCheckpoint?: RAGConnectorCheckpoint;
	diagnostics?: Record<string, unknown>;
};

export type RAGConnectorRuntime = {
	provider: RAGConnectorProvider;
	requiredScopes: (input?: {
		mode?: 'read' | 'write' | 'messages';
	}) => string[];
	sync: (
		input: RAGConnectorSyncInput
	) => Promise<RAGConnectorSyncResult> | RAGConnectorSyncResult;
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
	maintenance?: RAGBackendMaintenanceSummary;
	health: RAGCorpusHealth;
	readiness: RAGExtractorReadiness;
	ingestJobs: RAGIngestJobRecord[];
	syncSources: RAGSyncSourceRecord[];
	searchTraces?: RAGSearchTraceRetentionRuntime;
	retrievalComparisons?: RAGRetrievalComparisonRuntime;
};

export type RAGStatusResponse = {
	ok: true;
	status?: RAGVectorStoreStatus;
	capabilities?: RAGBackendCapabilities;
	documents?: RAGDocumentSummary;
	admin?: RAGAdminCapabilities;
	adminActions?: RAGAdminActionRecord[];
	adminJobs?: RAGAdminJobRecord[];
	maintenance?: RAGBackendMaintenanceSummary;
	health?: RAGCorpusHealth;
	readiness?: RAGExtractorReadiness;
	ingestJobs?: RAGIngestJobRecord[];
	syncSources?: RAGSyncSourceRecord[];
	searchTraces?: RAGSearchTraceRetentionRuntime;
	retrievalComparisons?: RAGRetrievalComparisonRuntime;
};

export type RAGRetrievalReleaseStatusResponse = {
	ok: true;
	retrievalComparisons?: RAGRetrievalComparisonRuntime;
};

export type RAGRetrievalReleaseDriftStatusResponse = {
	ok: true;
	handoffDriftRollups?: RAGRetrievalComparisonRuntime['handoffDriftRollups'];
	handoffDriftCountsByLane?: RAGRetrievalComparisonRuntime['handoffDriftCountsByLane'];
};

export type RAGRemediationAction = {
	kind:
		| 'approve_candidate'
		| 'acknowledge_incident'
		| 'resolve_incident'
		| 'view_release_status'
		| 'view_release_drift'
		| 'view_handoffs';
	label: string;
	method: 'GET' | 'POST';
	path: string;
	payload?: Record<string, unknown>;
};

export type RAGRemediationStep = {
	kind:
		| 'renew_approval'
		| 'record_approval'
		| 'inspect_gate'
		| 'rerun_comparison'
		| 'restore_source_lane'
		| 'review_readiness'
		| 'monitor_lane';
	label: string;
	actions?: RAGRemediationAction[];
};

export type RAGRetrievalLaneHandoffIncidentSummary = {
	openCount: number;
	resolvedCount: number;
	staleOpenCount: number;
	acknowledgedOpenCount: number;
	unacknowledgedOpenCount: number;
	latestTriggeredAt?: number;
	latestResolvedAt?: number;
	oldestOpenTriggeredAt?: number;
	oldestOpenAgeMs?: number;
};

export type RAGRetrievalLaneHandoffFreshnessWindow = {
	groupKey: string;
	sourceRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['sourceRolloutLabel'];
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	candidateRetrievalId?: string;
	sourceRunId?: string;
	latestApprovedAt?: number;
	approvalAgeMs?: number;
	staleAfterMs?: number;
	expiresAt?: number;
	freshnessStatus: 'fresh' | 'expired' | 'not_applicable';
};

export type RAGRetrievalLaneHandoffAutoCompleteSummary = {
	groupKey: string;
	sourceRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['sourceRolloutLabel'];
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	candidateRetrievalId?: string;
	sourceRunId?: string;
	enabled: boolean;
	ready: boolean;
	maxApprovedDecisionAgeMs?: number;
	latestApprovedAt?: number;
	approvalAgeMs?: number;
	approvalExpiresAt?: number;
	freshnessStatus: 'fresh' | 'expired' | 'not_applicable';
	reasons: string[];
};

export type RAGRetrievalLaneHandoffIncidentStatusResponse = {
	ok: true;
	incidents?: RAGRetrievalLaneHandoffIncidentRecord[];
	incidentSummary?: RAGRetrievalLaneHandoffIncidentSummary;
	freshnessWindows?: RAGRetrievalLaneHandoffFreshnessWindow[];
	recentHistory?: RAGRetrievalLaneHandoffIncidentHistoryRecord[];
};

export type RAGRetrievalLaneHandoffStatusResponse = {
	ok: true;
	handoffs?: RAGRetrievalReleaseLaneHandoffSummary[];
	decisions?: RAGRetrievalLaneHandoffDecisionRecord[];
	incidents?: RAGRetrievalLaneHandoffIncidentRecord[];
	incidentSummary?: RAGRetrievalLaneHandoffIncidentSummary;
	freshnessWindows?: RAGRetrievalLaneHandoffFreshnessWindow[];
	autoComplete?: RAGRetrievalLaneHandoffAutoCompleteSummary[];
	recentHistory?: RAGRetrievalLaneHandoffIncidentHistoryRecord[];
};

export type RAGSearchTraceStatsResponse = {
	ok: boolean;
	stats?: RAGSearchTraceStats;
	error?: string;
};

export type RAGSearchTracePrunePreviewResponse = {
	ok: boolean;
	preview?: RAGSearchTracePrunePreview;
	error?: string;
};

export type RAGSearchTracePruneResponse = {
	ok: boolean;
	result?: RAGSearchTracePruneResult;
	stats?: RAGSearchTraceStats;
	error?: string;
};

export type RAGSearchTracePruneHistoryResponse = {
	ok: boolean;
	runs?: RAGSearchTracePruneRun[];
	error?: string;
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
	maintenance?: RAGBackendMaintenanceSummary;
	workflowStatus?: RAGVectorStoreStatus;
	admin?: RAGAdminCapabilities;
	adminActions?: RAGAdminActionRecord[];
	adminJobs?: RAGAdminJobRecord[];
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
	corpusKey?: string;
	topK?: number;
	model?: string;
	scoreThreshold?: number;
	filter?: Record<string, unknown>;
	retrieval?: RAGCollectionSearchParams['retrieval'];
	expectedChunkIds?: string[];
	expectedSources?: string[];
	expectedDocumentIds?: string[];
	goldenSet?: boolean;
	hardNegativeChunkIds?: string[];
	hardNegativeSources?: string[];
	hardNegativeDocumentIds?: string[];
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
	failureClasses?: Array<
		| 'no_expected_targets'
		| 'no_citations'
		| 'unresolved_citations'
		| 'missing_expected_sources'
		| 'extra_citations'
		| 'section_source_miss'
		| 'section_graph_source_miss'
		| 'section_hierarchy_source_miss'
		| 'spreadsheet_source_miss'
		| 'media_source_miss'
		| 'ocr_source_miss'
	>;
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
	pruneRuns?: (
		input?: RAGEvaluationHistoryPruneInput
	) =>
		| Promise<RAGEvaluationHistoryPruneResult>
		| RAGEvaluationHistoryPruneResult;
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
	previousFailureClasses?: NonNullable<
		RAGAnswerGroundingEvaluationCaseResult['failureClasses']
	>;
	currentFailureClasses?: NonNullable<
		RAGAnswerGroundingEvaluationCaseResult['failureClasses']
	>;
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
	failureClasses?: NonNullable<
		RAGAnswerGroundingEvaluationCaseResult['failureClasses']
	>;
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

export type RAGAnswerGroundingCaseSnapshotPresentation = {
	caseId: string;
	label: string;
	summary: string;
	answerChange: RAGAnswerGroundingEvaluationCaseSnapshot['answerChange'];
	rows: RAGLabelValueRow[];
};

export type RAGEvaluationInput = {
	cases: RAGEvaluationCase[];
	topK?: number;
	scoreThreshold?: number;
	model?: string;
	filter?: Record<string, unknown>;
	retrieval?: RAGCollectionSearchParams['retrieval'];
	dryRun?: boolean;
};

export type RAGEvaluationCaseResult = {
	caseId: string;
	corpusKey?: string;
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
	failureClasses?: Array<
		| 'no_expected_targets'
		| 'no_results'
		| 'no_match'
		| 'partial_recall'
		| 'extra_noise'
		| 'section_evidence_miss'
		| 'section_graph_miss'
		| 'section_hierarchy_miss'
		| 'spreadsheet_evidence_miss'
		| 'media_evidence_miss'
		| 'ocr_evidence_miss'
		| 'routing_miss'
	>;
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
	corpusKeys?: string[];
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

export type RAGEvaluationSuiteDatasetSummary = {
	suiteId: string;
	caseCount: number;
	goldenSetCount: number;
	hardNegativeCaseCount: number;
	hardNegativeChunkIdCount: number;
	hardNegativeSourceCount: number;
	hardNegativeDocumentIdCount: number;
};

export type RAGEvaluationSuiteGenerationOptions = {
	suiteId: string;
	documents: RAGIndexedDocument[];
	label?: string;
	description?: string;
	maxCases?: number;
	topK?: number;
	scoreThreshold?: number;
	filter?: Record<string, unknown>;
	retrieval?: RAGCollectionSearchParams['retrieval'];
	includeGoldenSet?: boolean;
	hardNegativePerCase?: number;
	metadata?: Record<string, unknown>;
};

export type RAGEvaluationSuiteSnapshot = {
	id: string;
	suiteId: string;
	label?: string;
	description?: string;
	version: number;
	createdAt: number;
	caseCount: number;
	suite: RAGEvaluationSuite;
	metadata?: Record<string, unknown>;
};

export type RAGEvaluationSuiteSnapshotDiff = {
	suiteId: string;
	currentSnapshotId: string;
	previousSnapshotId?: string;
	addedCaseIds: string[];
	removedCaseIds: string[];
	changedCaseIds: string[];
	unchangedCaseIds: string[];
	orderChanged: boolean;
	caseCountDelta: number;
};

export type RAGEvaluationSuiteSnapshotHistoryStore = {
	saveSnapshot: (
		snapshot: RAGEvaluationSuiteSnapshot
	) => Promise<void> | void;
	listSnapshots: (input?: {
		suiteId?: string;
		limit?: number;
	}) => Promise<RAGEvaluationSuiteSnapshot[]> | RAGEvaluationSuiteSnapshot[];
	pruneSnapshots?: (
		input?: RAGEvaluationHistoryPruneInput
	) =>
		| Promise<RAGEvaluationHistoryPruneResult>
		| RAGEvaluationHistoryPruneResult;
};

export type RAGEvaluationSuiteSnapshotHistory = {
	suiteId: string;
	suiteLabel?: string;
	snapshots: RAGEvaluationSuiteSnapshot[];
	latestSnapshot?: RAGEvaluationSuiteSnapshot;
	previousSnapshot?: RAGEvaluationSuiteSnapshot;
	diff?: RAGEvaluationSuiteSnapshotDiff;
};

export type RAGEvaluationSuiteRun = {
	id: string;
	suiteId: string;
	label: string;
	startedAt: number;
	finishedAt: number;
	elapsedMs: number;
	response: RAGEvaluationResponse;
	traceSummary?: RAGRetrievalTraceComparisonSummary;
	caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[];
	metadata?: Record<string, unknown>;
};

export type RAGRetrievalTraceSummaryRun = {
	id: string;
	label?: string;
	finishedAt: number;
	traceSummary?: RAGRetrievalTraceComparisonSummary;
};

export type RAGEvaluationHistoryStore = {
	saveRun: (run: RAGEvaluationSuiteRun) => Promise<void> | void;
	listRuns: (input?: {
		suiteId?: string;
		limit?: number;
	}) => Promise<RAGEvaluationSuiteRun[]> | RAGEvaluationSuiteRun[];
	pruneRuns?: (
		input?: RAGEvaluationHistoryPruneInput
	) =>
		| Promise<RAGEvaluationHistoryPruneResult>
		| RAGEvaluationHistoryPruneResult;
};

export type RAGEvaluationHistoryPruneInput = {
	suiteId?: string;
	maxAgeMs?: number;
	maxRunsPerSuite?: number;
	now?: number;
};

export type RAGEvaluationHistoryPruneResult = {
	removedCount: number;
	keptCount: number;
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
	previousFailureClasses?: NonNullable<
		RAGEvaluationCaseResult['failureClasses']
	>;
	currentFailureClasses?: NonNullable<
		RAGEvaluationCaseResult['failureClasses']
	>;
};

export type RAGEvaluationRunDiff = {
	suiteId: string;
	currentRunId: string;
	previousRunId?: string;
	regressedCases: RAGEvaluationCaseDiff[];
	improvedCases: RAGEvaluationCaseDiff[];
	unchangedCases: RAGEvaluationCaseDiff[];
	traceLeadChanges?: Array<{
		caseId: string;
		label?: string;
		previousLead?: string;
		currentLead: string;
	}>;
	summaryDelta: {
		passingRate: number;
		averageF1: number;
		averageLatencyMs: number;
		passedCases: number;
		failedCases: number;
		partialCases: number;
	};
	traceSummaryDelta?: {
		modesChanged: boolean;
		sourceBalanceStrategiesChanged: boolean;
		vectorCases: number;
		lexicalCases: number;
		balancedCases: number;
		roundRobinCases: number;
		transformedCases: number;
		variantCases: number;
		averageFinalCount: number;
		averageVectorCount: number;
		averageLexicalCount: number;
		averageCandidateTopK: number;
		averageLexicalTopK: number;
		officeEvidenceReconcileCasesDelta: number;
		officeParagraphEvidenceReconcileCasesDelta?: number;
		officeListEvidenceReconcileCasesDelta?: number;
		officeTableEvidenceReconcileCasesDelta?: number;
		pdfEvidenceReconcileCasesDelta: number;
		stageCounts: Partial<Record<RAGRetrievalTraceStage, number>>;
	};
};

export type RAGEvaluationCaseTraceSnapshot = {
	caseId: string;
	corpusKey?: string;
	label?: string;
	query: string;
	status: RAGEvaluationCaseResult['status'];
	inputFilter?: Record<string, unknown>;
	previousInputFilter?: Record<string, unknown>;
	inputRetrieval?: RAGCollectionSearchParams['retrieval'];
	previousInputRetrieval?: RAGCollectionSearchParams['retrieval'];
	traceMode?: RAGHybridRetrievalMode;
	previousTraceMode?: RAGHybridRetrievalMode;
	sourceBalanceStrategy?: RAGSourceBalanceStrategy;
	previousSourceBalanceStrategy?: RAGSourceBalanceStrategy;
	transformedQuery?: string;
	previousTransformedQuery?: string;
	variantQueries: string[];
	previousVariantQueries: string[];
	finalCount: number;
	previousFinalCount?: number;
	vectorCount: number;
	previousVectorCount?: number;
	lexicalCount: number;
	previousLexicalCount?: number;
	candidateTopK: number;
	previousCandidateTopK?: number;
	lexicalTopK: number;
	previousLexicalTopK?: number;
	topContextLabel?: string;
	previousTopContextLabel?: string;
	topLocatorLabel?: string;
	previousTopLocatorLabel?: string;
	leadPresentationCue?: 'body' | 'notes' | 'title';
	previousLeadPresentationCue?: 'body' | 'notes' | 'title';
	leadSpreadsheetCue?: 'column' | 'sheet' | 'table';
	previousLeadSpreadsheetCue?: 'column' | 'sheet' | 'table';
	leadSpeakerCue?: string;
	previousLeadSpeakerCue?: string;
	leadSpeakerAttributionCue?: string;
	previousLeadSpeakerAttributionCue?: string;
	leadChannelCue?: string;
	previousLeadChannelCue?: string;
	leadChannelAttributionCue?: string;
	previousLeadChannelAttributionCue?: string;
	leadContinuityCue?: string;
	previousLeadContinuityCue?: string;
	sqliteQueryMode?: 'json_fallback' | 'native_vec0';
	previousSqliteQueryMode?: 'json_fallback' | 'native_vec0';
	sqliteQueryPushdownMode?: 'none' | 'partial' | 'full';
	previousSqliteQueryPushdownMode?: 'none' | 'partial' | 'full';
	sqliteQueryPushdownApplied?: boolean;
	previousSqliteQueryPushdownApplied?: boolean;
	sqliteQueryPushdownClauseCount?: number;
	previousSqliteQueryPushdownClauseCount?: number;
	sqliteQueryTotalFilterClauseCount?: number;
	previousSqliteQueryTotalFilterClauseCount?: number;
	sqliteQueryJsRemainderClauseCount?: number;
	previousSqliteQueryJsRemainderClauseCount?: number;
	sqliteQueryMultiplierUsed?: number;
	previousSqliteQueryMultiplierUsed?: number;
	sqliteQueryPlannerProfileUsed?: RAGNativeQueryProfile;
	previousSqliteQueryPlannerProfileUsed?: RAGNativeQueryProfile;
	sqliteQueryCandidateLimitUsed?: number;
	previousSqliteQueryCandidateLimitUsed?: number;
	sqliteQueryMaxBackfillsUsed?: number;
	previousSqliteQueryMaxBackfillsUsed?: number;
	sqliteQueryMinResultsUsed?: number;
	previousSqliteQueryMinResultsUsed?: number;
	sqliteQueryFillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
	previousSqliteQueryFillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
	sqliteQueryPushdownCoverageRatio?: number;
	previousSqliteQueryPushdownCoverageRatio?: number;
	sqliteQueryJsRemainderRatio?: number;
	previousSqliteQueryJsRemainderRatio?: number;
	sqliteQueryFilteredCandidates?: number;
	previousSqliteQueryFilteredCandidates?: number;
	sqliteQueryInitialSearchK?: number;
	previousSqliteQueryInitialSearchK?: number;
	sqliteQueryFinalSearchK?: number;
	previousSqliteQueryFinalSearchK?: number;
	sqliteQuerySearchExpansionRatio?: number;
	previousSqliteQuerySearchExpansionRatio?: number;
	sqliteQueryBackfillCount?: number;
	previousSqliteQueryBackfillCount?: number;
	sqliteQueryBackfillLimitReached?: boolean;
	previousSqliteQueryBackfillLimitReached?: boolean;
	sqliteQueryMinResultsSatisfied?: boolean;
	previousSqliteQueryMinResultsSatisfied?: boolean;
	sqliteQueryReturnedCount?: number;
	previousSqliteQueryReturnedCount?: number;
	sqliteQueryCandidateYieldRatio?: number;
	previousSqliteQueryCandidateYieldRatio?: number;
	sqliteQueryTopKFillRatio?: number;
	previousSqliteQueryTopKFillRatio?: number;
	sqliteQueryUnderfilledTopK?: boolean;
	previousSqliteQueryUnderfilledTopK?: boolean;
	sqliteQueryCandidateBudgetExhausted?: boolean;
	previousSqliteQueryCandidateBudgetExhausted?: boolean;
	sqliteQueryCandidateCoverage?:
		| 'empty'
		| 'under_target'
		| 'target_sized'
		| 'broad';
	previousSqliteQueryCandidateCoverage?:
		| 'empty'
		| 'under_target'
		| 'target_sized'
		| 'broad';
	postgresQueryMode?: 'native_pgvector';
	previousPostgresQueryMode?: 'native_pgvector';
	postgresQueryPushdownMode?: 'none' | 'partial' | 'full';
	previousPostgresQueryPushdownMode?: 'none' | 'partial' | 'full';
	postgresQueryPushdownApplied?: boolean;
	previousPostgresQueryPushdownApplied?: boolean;
	postgresQueryPushdownClauseCount?: number;
	previousPostgresQueryPushdownClauseCount?: number;
	postgresQueryTotalFilterClauseCount?: number;
	previousPostgresQueryTotalFilterClauseCount?: number;
	postgresQueryJsRemainderClauseCount?: number;
	previousPostgresQueryJsRemainderClauseCount?: number;
	postgresQueryMultiplierUsed?: number;
	previousPostgresQueryMultiplierUsed?: number;
	postgresQueryPlannerProfileUsed?: RAGNativeQueryProfile;
	previousPostgresQueryPlannerProfileUsed?: RAGNativeQueryProfile;
	postgresQueryCandidateLimitUsed?: number;
	previousPostgresQueryCandidateLimitUsed?: number;
	postgresQueryMaxBackfillsUsed?: number;
	previousPostgresQueryMaxBackfillsUsed?: number;
	postgresQueryMinResultsUsed?: number;
	previousPostgresQueryMinResultsUsed?: number;
	postgresQueryFillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
	previousPostgresQueryFillPolicyUsed?: 'strict_topk' | 'satisfy_min_results';
	postgresQueryPushdownCoverageRatio?: number;
	previousPostgresQueryPushdownCoverageRatio?: number;
	postgresQueryJsRemainderRatio?: number;
	previousPostgresQueryJsRemainderRatio?: number;
	postgresQueryFilteredCandidates?: number;
	previousPostgresQueryFilteredCandidates?: number;
	postgresQueryInitialSearchK?: number;
	previousPostgresQueryInitialSearchK?: number;
	postgresQueryFinalSearchK?: number;
	previousPostgresQueryFinalSearchK?: number;
	postgresQuerySearchExpansionRatio?: number;
	previousPostgresQuerySearchExpansionRatio?: number;
	postgresQueryBackfillCount?: number;
	previousPostgresQueryBackfillCount?: number;
	postgresQueryBackfillLimitReached?: boolean;
	previousPostgresQueryBackfillLimitReached?: boolean;
	postgresQueryMinResultsSatisfied?: boolean;
	previousPostgresQueryMinResultsSatisfied?: boolean;
	postgresQueryReturnedCount?: number;
	previousPostgresQueryReturnedCount?: number;
	postgresQueryCandidateYieldRatio?: number;
	previousPostgresQueryCandidateYieldRatio?: number;
	postgresQueryTopKFillRatio?: number;
	previousPostgresQueryTopKFillRatio?: number;
	postgresQueryUnderfilledTopK?: boolean;
	previousPostgresQueryUnderfilledTopK?: boolean;
	postgresQueryCandidateBudgetExhausted?: boolean;
	previousPostgresQueryCandidateBudgetExhausted?: boolean;
	postgresQueryCandidateCoverage?:
		| 'empty'
		| 'under_target'
		| 'target_sized'
		| 'broad';
	previousPostgresQueryCandidateCoverage?:
		| 'empty'
		| 'under_target'
		| 'target_sized'
		| 'broad';
	postgresIndexType?: 'none' | 'hnsw' | 'ivfflat';
	previousPostgresIndexType?: 'none' | 'hnsw' | 'ivfflat';
	postgresIndexName?: string;
	previousPostgresIndexName?: string;
	postgresIndexPresent?: boolean;
	previousPostgresIndexPresent?: boolean;
	postgresEstimatedRowCount?: number;
	previousPostgresEstimatedRowCount?: number;
	postgresTableBytes?: number;
	previousPostgresTableBytes?: number;
	postgresIndexBytes?: number;
	previousPostgresIndexBytes?: number;
	postgresTotalBytes?: number;
	previousPostgresTotalBytes?: number;
	postgresIndexStorageRatio?: number;
	previousPostgresIndexStorageRatio?: number;
	sourceAwareChunkReasonLabel?: string;
	previousSourceAwareChunkReasonLabel?: string;
	sourceAwareUnitScopeLabel?: string;
	previousSourceAwareUnitScopeLabel?: string;
	stageCounts: Partial<Record<RAGRetrievalTraceStage, number>>;
	previousStageCounts: Partial<Record<RAGRetrievalTraceStage, number>>;
	traceChange: 'new' | 'changed' | 'unchanged';
};

export type RAGEvaluationHistory = {
	suiteId: string;
	suiteLabel?: string;
	runs: RAGEvaluationSuiteRun[];
	leaderboard: RAGEvaluationLeaderboardEntry[];
	retrievalTraceTrend?: RAGRetrievalTraceTrend;
	caseTraceSnapshots: RAGEvaluationCaseTraceSnapshot[];
	latestRun?: RAGEvaluationSuiteRun;
	previousRun?: RAGEvaluationSuiteRun;
	diff?: RAGEvaluationRunDiff;
};

export type RAGLabelValueRow = {
	label: string;
	value: string;
};

export type RAGRetrievalTraceStepPresentation = {
	stage: RAGRetrievalTraceStage;
	label: string;
	count?: number;
	rows: RAGLabelValueRow[];
};

export type RAGRetrievalTracePresentation = {
	stats: RAGLabelValueRow[];
	details: RAGLabelValueRow[];
	steps: RAGRetrievalTraceStepPresentation[];
};

export type RAGSummarySectionPresentation = {
	label: string;
	title: string;
	summary: string;
	rows?: RAGLabelValueRow[];
	tags?: string[];
};

export type RAGReadinessPresentation = {
	sections: RAGSummarySectionPresentation[];
};

export type RAGCorpusHealthPresentation = {
	sections: RAGSummarySectionPresentation[];
};

export type RAGSyncOverviewPresentation = {
	rows: RAGLabelValueRow[];
	sections: RAGSummarySectionPresentation[];
};

export type RAGSyncSourceRunPresentation = {
	label: string;
	status: string;
	summary: string;
	rows?: RAGLabelValueRow[];
};

export type RAGSyncSourcePresentation = {
	id: string;
	label: string;
	kind: RAGSyncSourceRecord['kind'];
	status: RAGSyncSourceRecord['status'];
	summary: string;
	rows: RAGLabelValueRow[];
	tags?: string[];
	extendedSummary?: string;
	runs?: RAGSyncSourceRunPresentation[];
};

export type RAGAdminJobPresentation = {
	id: string;
	action: RAGAdminJobRecord['action'];
	status: RAGAdminJobRecord['status'];
	summary: string;
	rows: RAGLabelValueRow[];
};

export type RAGAdminActionPresentation = {
	id: string;
	action: RAGAdminActionRecord['action'];
	status: RAGAdminActionRecord['status'];
	summary: string;
	rows: RAGLabelValueRow[];
};

export type RAGEvaluationCaseTracePresentation = {
	caseId: string;
	label: string;
	summary: string;
	traceChange: RAGEvaluationCaseTraceSnapshot['traceChange'];
	rows: RAGLabelValueRow[];
};

export type RAGEvaluationHistoryPresentation = {
	summary: string;
	rows: RAGLabelValueRow[];
	caseTraces: RAGEvaluationCaseTracePresentation[];
};

export type RAGEvaluationSuiteSnapshotPresentation = {
	id: string;
	label: string;
	summary: string;
	version: number;
	rows: RAGLabelValueRow[];
};

export type RAGEvaluationSuiteSnapshotHistoryPresentation = {
	summary: string;
	rows: RAGLabelValueRow[];
	snapshots: RAGEvaluationSuiteSnapshotPresentation[];
};

export type RAGAdaptiveNativePlannerBenchmarkRuntime = {
	suiteId: string;
	suiteLabel: string;
	groupKey?: string;
	corpusGroupKey?: string;
	latestFixtureVariant?: string;
	fixtureVariants?: string[];
	recommendedGroupKey?: string;
	recommendedTags?: string[];
	latestRun?: RAGRetrievalComparisonRun;
	recentRuns?: RAGRetrievalComparisonRun[];
	historyPresentation?: RAGRetrievalReleaseGroupHistoryPresentation;
	snapshotHistory?: RAGEvaluationSuiteSnapshotHistory;
	snapshotHistoryPresentation?: RAGEvaluationSuiteSnapshotHistoryPresentation;
};

export type RAGNativeBackendComparisonBenchmarkRuntime =
	RAGAdaptiveNativePlannerBenchmarkRuntime;

export type RAGPresentationCueBenchmarkRuntime =
	RAGAdaptiveNativePlannerBenchmarkRuntime;

export type RAGSpreadsheetCueBenchmarkRuntime =
	RAGAdaptiveNativePlannerBenchmarkRuntime;

export type RAGAdaptiveNativePlannerBenchmarkResponse = {
	ok: boolean;
	suite?: RAGEvaluationSuite;
	comparison?: RAGRetrievalComparison;
	groupKey?: string;
	corpusGroupKey?: string;
	latestFixtureVariant?: string;
	fixtureVariants?: string[];
	latestRun?: RAGRetrievalComparisonRun;
	recentRuns?: RAGRetrievalComparisonRun[];
	historyPresentation?: RAGRetrievalReleaseGroupHistoryPresentation;
	snapshotHistory?: RAGEvaluationSuiteSnapshotHistory;
	snapshotHistoryPresentation?: RAGEvaluationSuiteSnapshotHistoryPresentation;
	error?: string;
};

export type RAGNativeBackendComparisonBenchmarkResponse =
	RAGAdaptiveNativePlannerBenchmarkResponse;

export type RAGPresentationCueBenchmarkResponse =
	RAGAdaptiveNativePlannerBenchmarkResponse;

export type RAGSpreadsheetCueBenchmarkResponse =
	RAGAdaptiveNativePlannerBenchmarkResponse;

export type RAGAdaptiveNativePlannerBenchmarkSnapshotResponse = {
	ok: boolean;
	suite?: RAGEvaluationSuite;
	snapshot?: RAGEvaluationSuiteSnapshot;
	snapshotHistory?: RAGEvaluationSuiteSnapshotHistory;
	snapshotHistoryPresentation?: RAGEvaluationSuiteSnapshotHistoryPresentation;
	error?: string;
};

export type RAGNativeBackendComparisonBenchmarkSnapshotResponse =
	RAGAdaptiveNativePlannerBenchmarkSnapshotResponse;

export type RAGPresentationCueBenchmarkSnapshotResponse =
	RAGAdaptiveNativePlannerBenchmarkSnapshotResponse;

export type RAGSpreadsheetCueBenchmarkSnapshotResponse =
	RAGAdaptiveNativePlannerBenchmarkSnapshotResponse;

export type RAGRetrievalReleaseHistoryRunPresentation = {
	runId: string;
	label: string;
	summary: string;
	rows: RAGLabelValueRow[];
};

export type RAGRetrievalReleaseGroupHistoryPresentation = {
	summary: string;
	rows: RAGLabelValueRow[];
	recentRuns: RAGRetrievalReleaseHistoryRunPresentation[];
};

export type RAGAnswerGroundingHistoryPresentation = {
	summary: string;
	rows: RAGLabelValueRow[];
	caseSnapshots: RAGAnswerGroundingCaseSnapshotPresentation[];
};

export type RAGEvaluationEntityQualitySummary = {
	key: string;
	label: string;
	entityType: 'source' | 'document';
	totalCases: number;
	passedCases: number;
	partialCases: number;
	failedCases: number;
	passingRate: number;
	averageF1: number;
	failureCounts: Record<string, number>;
	caseIds: string[];
};

export type RAGAnswerGroundingEntityQualitySummary = {
	key: string;
	label: string;
	entityType: 'source' | 'document';
	totalCases: number;
	passedCases: number;
	partialCases: number;
	failedCases: number;
	passingRate: number;
	averageCitationF1: number;
	averageResolvedCitationRate: number;
	failureCounts: Record<string, number>;
	caseIds: string[];
};

export type RAGEvaluationEntityQualityView = {
	bySource: RAGEvaluationEntityQualitySummary[];
	byDocument: RAGEvaluationEntityQualitySummary[];
};

export type RAGAnswerGroundingEntityQualityView = {
	bySource: RAGAnswerGroundingEntityQualitySummary[];
	byDocument: RAGAnswerGroundingEntityQualitySummary[];
};

export type RAGEntityQualityPresentation = {
	key: string;
	label: string;
	summary: string;
	rows: RAGLabelValueRow[];
};

export type RAGEntityQualityViewPresentation = {
	summary: string;
	rows: RAGLabelValueRow[];
	entities: RAGEntityQualityPresentation[];
};

export type RAGComparisonPresentation = {
	id: string;
	label: string;
	summary: string;
	traceSummaryRows: RAGLabelValueRow[];
	diffLabel: string;
	diffRows: RAGLabelValueRow[];
};

export type RAGComparisonOverviewPresentation = {
	winnerLabel: string;
	summary: string;
	rows: RAGLabelValueRow[];
};

export type RAGGroundingProviderPresentation = {
	id: string;
	label: string;
	summary: string;
};

export type RAGGroundingProviderOverviewPresentation = {
	winnerLabel: string;
	summary: string;
	rows: RAGLabelValueRow[];
};

export type RAGQualityOverviewPresentation = {
	rows: RAGLabelValueRow[];
};

export type RAGGroundingOverviewPresentation = {
	rows: RAGLabelValueRow[];
};

export type RAGGroundingProviderCaseComparisonPresentation = {
	caseId: string;
	label: string;
	summary: string;
	rows: RAGLabelValueRow[];
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

export type RAGRetrievalTraceComparisonSummary = {
	totalCases: number;
	modes: RAGHybridRetrievalMode[];
	sourceBalanceStrategies: RAGSourceBalanceStrategy[];
	vectorCases: number;
	lexicalCases: number;
	balancedCases: number;
	roundRobinCases: number;
	transformedCases: number;
	variantCases: number;
	multiVectorCases: number;
	multiVectorVectorHitCases: number;
	multiVectorLexicalHitCases: number;
	multiVectorCollapsedCases: number;
	officeEvidenceReconcileCases: number;
	officeParagraphEvidenceReconcileCases?: number;
	officeListEvidenceReconcileCases?: number;
	officeTableEvidenceReconcileCases?: number;
	pdfEvidenceReconcileCases: number;
	runtimeCandidateBudgetExhaustedCases: number;
	runtimeUnderfilledTopKCases: number;
	averageFinalCount: number;
	averageVectorCount: number;
	averageLexicalCount: number;
	averageCandidateTopK: number;
	averageLexicalTopK: number;
	stageCounts: Partial<Record<RAGRetrievalTraceStage, number>>;
};

export type RAGTraceSummaryListDelta<T extends string> = {
	current: T[];
	previous: T[];
	added: T[];
	removed: T[];
};

export type RAGTraceSummaryTrendDirection = 'flat' | 'up' | 'down';

export type RAGTraceSummaryNumericDelta = {
	metric: string;
	current: number;
	previous: number;
	delta: number;
	direction: RAGTraceSummaryTrendDirection;
};

export type RAGTraceSummaryListTrend<T extends string> = {
	current: T[];
	previous: T[];
	appeared: T[];
	disappeared: T[];
	stable: T[];
	frequency: Record<T, number>;
};

export type RAGTraceSummaryStageTrend = {
	netDelta: number;
	latestDelta: number;
	stage: RAGRetrievalTraceStage;
	totalChanges: number;
};

export type RAGRetrievalTraceHistoryWindow = {
	current: RAGRetrievalTraceComparisonSummary;
	currentRunId: string;
	currentRunLabel?: string;
	delta?: RAGRetrievalTraceComparisonSummaryDiff;
	previous: RAGRetrievalTraceComparisonSummary;
	previousRunId: string;
	previousRunLabel?: string;
};

export type RAGRetrievalTraceTrend = {
	aggregate: RAGTraceSummaryNumericDelta[];
	latestToPrevious?: RAGRetrievalTraceComparisonSummaryDiff;
	modeTurnover: RAGTraceSummaryListTrend<RAGHybridRetrievalMode>;
	runsWithTraceSummary: number;
	stageChurn: RAGTraceSummaryStageTrend[];
	sourceBalanceStrategyTurnover: RAGTraceSummaryListTrend<RAGSourceBalanceStrategy>;
	summaryTrendWindows: RAGRetrievalTraceHistoryWindow[];
	worstMetric: RAGTraceSummaryNumericDelta | undefined;
	bestMetric: RAGTraceSummaryNumericDelta | undefined;
	worstVolatileStage: RAGTraceSummaryStageTrend | undefined;
};

export type RAGSearchTraceResultSnapshot = {
	chunkId: string;
	corpusKey?: string;
	score: number;
	source?: string;
	title?: string;
	documentId?: string;
};

export type RAGSearchTraceRecord = {
	id: string;
	label: string;
	query: string;
	groupKey?: string;
	tags?: string[];
	startedAt: number;
	finishedAt: number;
	elapsedMs: number;
	trace: RAGRetrievalTrace;
	summary: RAGRetrievalTraceComparisonSummary;
	results: RAGSearchTraceResultSnapshot[];
	metadata?: Record<string, unknown>;
};

export type RAGSearchTraceStore = {
	saveTrace: (trace: RAGSearchTraceRecord) => Promise<void> | void;
	listTraces: (input?: {
		query?: string;
		groupKey?: string;
		tag?: string;
		limit?: number;
	}) => Promise<RAGSearchTraceRecord[]> | RAGSearchTraceRecord[];
	pruneTraces: (
		input?: RAGSearchTracePruneInput
	) => Promise<RAGSearchTracePruneResult> | RAGSearchTracePruneResult;
};

export type RAGSearchTracePruneInput = {
	maxAgeMs?: number;
	maxRecordsPerQuery?: number;
	maxRecordsPerGroup?: number;
	now?: number;
	tag?: string;
};

export type RAGSearchTracePruneResult = {
	removedCount: number;
	keptCount: number;
};

export type RAGSearchTraceStats = {
	totalTraces: number;
	queryCount: number;
	groupCount: number;
	tagCounts: Record<string, number>;
	oldestFinishedAt?: number;
	newestFinishedAt?: number;
};

export type RAGSearchTracePrunePreview = {
	input?: RAGSearchTracePruneInput;
	statsBefore: RAGSearchTraceStats;
	statsAfter: RAGSearchTraceStats;
	result: RAGSearchTracePruneResult;
};

export type RAGSearchTraceRetentionSchedule = {
	intervalMs: number;
	runImmediately?: boolean;
};

export type RAGSearchTraceRetentionRuntime = {
	configured: boolean;
	retention?: RAGSearchTracePruneInput;
	schedule?: RAGSearchTraceRetentionSchedule;
	stats?: RAGSearchTraceStats;
	running?: boolean;
	totalRuns?: number;
	lastStartedAt?: number;
	lastFinishedAt?: number;
	lastResult?: RAGSearchTracePruneResult;
	lastError?: string;
	nextScheduledAt?: number;
	recentRuns?: RAGSearchTracePruneRun[];
};

export type RAGSearchTracePruneRun = {
	id: string;
	startedAt: number;
	finishedAt: number;
	elapsedMs: number;
	trigger: 'manual' | 'write' | 'schedule';
	input?: RAGSearchTracePruneInput;
	result?: RAGSearchTracePruneResult;
	statsBefore?: RAGSearchTraceStats;
	statsAfter?: RAGSearchTraceStats;
	error?: string;
};

export type RAGSearchTracePruneHistoryStore = {
	saveRun: (run: RAGSearchTracePruneRun) => Promise<void> | void;
	listRuns: (input?: {
		limit?: number;
		trigger?: RAGSearchTracePruneRun['trigger'];
	}) => Promise<RAGSearchTracePruneRun[]> | RAGSearchTracePruneRun[];
};

export type RAGSearchTraceDiff = {
	currentTraceId: string;
	previousTraceId?: string;
	summaryDelta?: RAGRetrievalTraceComparisonSummaryDiff;
	addedChunkIds: string[];
	removedChunkIds: string[];
	retainedChunkIds: string[];
	topResultChanged: boolean;
};

export type RAGSearchTraceHistory = {
	query?: string;
	groupKey?: string;
	tag?: string;
	traces: RAGSearchTraceRecord[];
	latestTrace?: RAGSearchTraceRecord;
	previousTrace?: RAGSearchTraceRecord;
	diff?: RAGSearchTraceDiff;
	retrievalTraceTrend: RAGRetrievalTraceTrend;
};

export type RAGSearchTraceGroupHistoryEntry = {
	groupKey: string;
	traceCount: number;
	latestTrace?: RAGSearchTraceRecord;
	previousTrace?: RAGSearchTraceRecord;
	diff?: RAGSearchTraceDiff;
	retrievalTraceTrend: RAGRetrievalTraceTrend;
};

export type RAGSearchTraceGroupHistory = {
	groups: RAGSearchTraceGroupHistoryEntry[];
	tag?: string;
};

export type RAGTraceSummaryStageCountsDelta = {
	previous: number;
	current: number;
	delta: number;
};

export type RAGRetrievalTraceComparisonSummaryDiff = {
	current: RAGRetrievalTraceComparisonSummary;
	previous: RAGRetrievalTraceComparisonSummary;
	totalCasesDelta: number;
	averageFinalCountDelta: number;
	averageVectorCountDelta: number;
	averageLexicalCountDelta: number;
	averageCandidateTopKDelta: number;
	averageLexicalTopKDelta: number;
	vectorCasesDelta: number;
	lexicalCasesDelta: number;
	balancedCasesDelta: number;
	roundRobinCasesDelta: number;
	transformedCasesDelta: number;
	variantCasesDelta: number;
	multiVectorCasesDelta: number;
	multiVectorVectorHitCasesDelta: number;
	multiVectorLexicalHitCasesDelta: number;
	multiVectorCollapsedCasesDelta: number;
	officeEvidenceReconcileCasesDelta: number;
	officeParagraphEvidenceReconcileCasesDelta?: number;
	officeListEvidenceReconcileCasesDelta?: number;
	officeTableEvidenceReconcileCasesDelta?: number;
	pdfEvidenceReconcileCasesDelta: number;
	runtimeCandidateBudgetExhaustedCasesDelta: number;
	runtimeUnderfilledTopKCasesDelta: number;
	modeDelta: RAGTraceSummaryListDelta<RAGHybridRetrievalMode>;
	sourceBalanceStrategyDelta: RAGTraceSummaryListDelta<RAGSourceBalanceStrategy>;
	stageCountsDelta: Partial<
		Record<RAGRetrievalTraceStage, RAGTraceSummaryStageCountsDelta>
	>;
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
	traceSummary?: RAGRetrievalTraceComparisonSummary;
	caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[];
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
	traceSummary?: RAGRetrievalTraceComparisonSummary;
	caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[];
};

export type RAGRetrievalComparisonSummary = {
	bestByPassingRate?: string;
	bestByAverageF1?: string;
	fastest?: string;
	bestByPresentationTitleCueCases?: string;
	bestByPresentationBodyCueCases?: string;
	bestByPresentationNotesCueCases?: string;
	bestBySpreadsheetSheetCueCases?: string;
	bestBySpreadsheetTableCueCases?: string;
	bestBySpreadsheetColumnCueCases?: string;
	bestByMultivectorCollapsedCases?: string;
	bestByMultivectorLexicalHitCases?: string;
	bestByMultivectorVectorHitCases?: string;
	bestByEvidenceReconcileCases?: string;
	bestByOfficeEvidenceReconcileCases?: string;
	bestByOfficeParagraphEvidenceReconcileCases?: string;
	bestByOfficeListEvidenceReconcileCases?: string;
	bestByOfficeTableEvidenceReconcileCases?: string;
	bestByPDFEvidenceReconcileCases?: string;
	bestByLowestRuntimeCandidateBudgetExhaustedCases?: string;
	bestByLowestRuntimeUnderfilledTopKCases?: string;
};

export type RAGRetrievalComparison = {
	suiteId: string;
	suiteLabel: string;
	corpusGroupKey?: string;
	corpusKeys?: string[];
	entries: RAGRetrievalComparisonEntry[];
	summary: RAGRetrievalComparisonSummary;
	leaderboard: RAGEvaluationLeaderboardEntry[];
};

export type RAGRetrievalComparisonCandidateInput = {
	id: string;
	label?: string;
	retrieval?: RAGCollectionSearchParams['retrieval'];
};

export type RAGRetrievalComparisonRequest = RAGEvaluationInput & {
	retrievals: RAGRetrievalComparisonCandidateInput[];
	suiteId?: string;
	label?: string;
	persistRun?: boolean;
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	corpusGroupKey?: string;
	groupKey?: string;
	tags?: string[];
};

export type RAGRetrievalComparisonResponse = {
	ok: boolean;
	comparison?: RAGRetrievalComparison;
	error?: string;
};

export type RAGRetrievalComparisonRun = {
	id: string;
	label: string;
	suiteId: string;
	suiteLabel: string;
	corpusGroupKey?: string;
	corpusKeys?: string[];
	groupKey?: string;
	tags?: string[];
	startedAt: number;
	finishedAt: number;
	elapsedMs: number;
	comparison: RAGRetrievalComparison;
	decisionSummary?: RAGRetrievalComparisonDecisionSummary;
	releaseVerdict?: RAGRetrievalReleaseVerdict;
};

export type RAGRetrievalComparisonDecisionDelta = {
	passingRateDelta: number;
	averageF1Delta: number;
	elapsedMsDelta: number;
	presentationTitleCueCasesDelta?: number;
	presentationBodyCueCasesDelta?: number;
	presentationNotesCueCasesDelta?: number;
	spreadsheetSheetCueCasesDelta?: number;
	spreadsheetTableCueCasesDelta?: number;
	spreadsheetColumnCueCasesDelta?: number;
	multiVectorCollapsedCasesDelta?: number;
	multiVectorLexicalHitCasesDelta?: number;
	multiVectorVectorHitCasesDelta?: number;
	evidenceReconcileCasesDelta?: number;
	officeEvidenceReconcileCasesDelta?: number;
	officeParagraphEvidenceReconcileCasesDelta?: number;
	officeListEvidenceReconcileCasesDelta?: number;
	officeTableEvidenceReconcileCasesDelta?: number;
	pdfEvidenceReconcileCasesDelta?: number;
	runtimeCandidateBudgetExhaustedCasesDelta?: number;
	runtimeUnderfilledTopKCasesDelta?: number;
};

export type RAGRetrievalBaselineGatePolicy = {
	minPassingRateDelta?: number;
	minAverageF1Delta?: number;
	maxElapsedMsDelta?: number;
	minPresentationTitleCueCasesDelta?: number;
	minPresentationBodyCueCasesDelta?: number;
	minPresentationNotesCueCasesDelta?: number;
	minSpreadsheetSheetCueCasesDelta?: number;
	minSpreadsheetTableCueCasesDelta?: number;
	minSpreadsheetColumnCueCasesDelta?: number;
	minMultiVectorCollapsedCasesDelta?: number;
	minMultiVectorLexicalHitCasesDelta?: number;
	minMultiVectorVectorHitCasesDelta?: number;
	minEvidenceReconcileCasesDelta?: number;
	maxRuntimeCandidateBudgetExhaustedCasesDelta?: number;
	maxRuntimeUnderfilledTopKCasesDelta?: number;
	severity?: 'warn' | 'fail';
};

export type RAGRetrievalComparisonGateResult = {
	status: 'pass' | 'warn' | 'fail';
	reasons: string[];
	policy?: RAGRetrievalBaselineGatePolicy;
};

export type RAGRetrievalReleaseVerdict = {
	status: 'pass' | 'warn' | 'fail' | 'needs_review';
	summary: string;
	baselineGroupKey?: string;
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	gate?: RAGRetrievalComparisonGateResult;
	delta?: RAGRetrievalComparisonDecisionDelta;
};

export type RAGRetrievalComparisonDecisionSummary = {
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	winnerByPassingRate?: string;
	winnerByAverageF1?: string;
	fastest?: string;
	winnerByPresentationTitleCueCases?: string;
	winnerByPresentationBodyCueCases?: string;
	winnerByPresentationNotesCueCases?: string;
	winnerBySpreadsheetSheetCueCases?: string;
	winnerBySpreadsheetTableCueCases?: string;
	winnerBySpreadsheetColumnCueCases?: string;
	winnerByMultivectorCollapsedCases?: string;
	winnerByMultivectorLexicalHitCases?: string;
	winnerByMultivectorVectorHitCases?: string;
	winnerByEvidenceReconcileCases?: string;
	winnerByOfficeEvidenceReconcileCases?: string;
	winnerByPDFEvidenceReconcileCases?: string;
	winnerByLowestRuntimeCandidateBudgetExhaustedCases?: string;
	winnerByLowestRuntimeUnderfilledTopKCases?: string;
	baseline?: {
		retrievalId: string;
		label: string;
		passingRate: number;
		averageF1: number;
		elapsedMs: number;
		presentationTitleCueCases?: number;
		presentationBodyCueCases?: number;
		presentationNotesCueCases?: number;
		spreadsheetSheetCueCases?: number;
		spreadsheetTableCueCases?: number;
		spreadsheetColumnCueCases?: number;
		multiVectorCollapsedCases?: number;
		multiVectorLexicalHitCases?: number;
		multiVectorVectorHitCases?: number;
		evidenceReconcileCases?: number;
		officeEvidenceReconcileCases?: number;
		pdfEvidenceReconcileCases?: number;
		runtimeCandidateBudgetExhaustedCases?: number;
		runtimeUnderfilledTopKCases?: number;
	};
	candidate?: {
		retrievalId: string;
		label: string;
		passingRate: number;
		averageF1: number;
		elapsedMs: number;
		presentationTitleCueCases?: number;
		presentationBodyCueCases?: number;
		presentationNotesCueCases?: number;
		spreadsheetSheetCueCases?: number;
		spreadsheetTableCueCases?: number;
		spreadsheetColumnCueCases?: number;
		multiVectorCollapsedCases?: number;
		multiVectorLexicalHitCases?: number;
		multiVectorVectorHitCases?: number;
		evidenceReconcileCases?: number;
		officeEvidenceReconcileCases?: number;
		pdfEvidenceReconcileCases?: number;
		runtimeCandidateBudgetExhaustedCases?: number;
		runtimeUnderfilledTopKCases?: number;
	};
	delta?: RAGRetrievalComparisonDecisionDelta;
	gate?: RAGRetrievalComparisonGateResult;
};

export type RAGRetrievalComparisonHistoryStore = {
	saveRun: (run: RAGRetrievalComparisonRun) => Promise<void> | void;
	listRuns: (input?: {
		limit?: number;
		suiteId?: string;
		label?: string;
		winnerId?: string;
		corpusGroupKey?: string;
		groupKey?: string;
		tag?: string;
	}) => Promise<RAGRetrievalComparisonRun[]> | RAGRetrievalComparisonRun[];
};

export type RAGRetrievalComparisonHistoryResponse = {
	ok: boolean;
	runs?: RAGRetrievalComparisonRun[];
	error?: string;
};

export type RAGRetrievalBaselineRecord = {
	id: string;
	corpusGroupKey?: string;
	groupKey: string;
	version: number;
	status: 'active' | 'superseded';
	rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
	retrievalId: string;
	label: string;
	suiteId?: string;
	suiteLabel?: string;
	sourceRunId?: string;
	promotedAt: number;
	tags?: string[];
	approvedBy?: string;
	approvedAt?: number;
	approvalNotes?: string;
	policy?: RAGRetrievalBaselineGatePolicy;
	metadata?: Record<string, unknown>;
};

export type RAGRetrievalBaselineStore = {
	saveBaseline: (record: RAGRetrievalBaselineRecord) => Promise<void> | void;
	listBaselines: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		tag?: string;
		limit?: number;
		status?: RAGRetrievalBaselineRecord['status'];
	}) => Promise<RAGRetrievalBaselineRecord[]> | RAGRetrievalBaselineRecord[];
	getBaseline?: (
		groupKey: string
	) =>
		| Promise<RAGRetrievalBaselineRecord | null | undefined>
		| RAGRetrievalBaselineRecord
		| null
		| undefined;
};

export type RAGRetrievalBaselinePromotionRequest = {
	corpusGroupKey?: string;
	groupKey: string;
	retrievalId: string;
	rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
	label?: string;
	suiteId?: string;
	suiteLabel?: string;
	sourceRunId?: string;
	tags?: string[];
	approvedBy?: string;
	approvedAt?: number;
	approvalNotes?: string;
	policy?: RAGRetrievalBaselineGatePolicy;
	metadata?: Record<string, unknown>;
};

export type RAGRetrievalBaselinePromotionFromRunRequest = {
	corpusGroupKey?: string;
	groupKey: string;
	sourceRunId: string;
	retrievalId?: string;
	rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
	overrideGate?: boolean;
	overrideReason?: string;
	approvedBy?: string;
	approvedAt?: number;
	approvalNotes?: string;
	policy?: RAGRetrievalBaselineGatePolicy;
	metadata?: Record<string, unknown>;
};

export type RAGRetrievalBaselineRevertRequest = {
	corpusGroupKey?: string;
	groupKey: string;
	version?: number;
	baselineId?: string;
	approvedBy?: string;
	approvedAt?: number;
	approvalNotes?: string;
	metadata?: Record<string, unknown>;
};

export type RAGRetrievalBaselineResponse = {
	ok: boolean;
	baseline?: RAGRetrievalBaselineRecord;
	rolloutState?: RAGRetrievalLanePromotionStateSummary;
	error?: string;
};

export type RAGRetrievalBaselineListResponse = {
	ok: boolean;
	baselines?: RAGRetrievalBaselineRecord[];
	error?: string;
};

export type RAGRetrievalReleaseDecisionRecord = {
	id: string;
	kind: 'approve' | 'promote' | 'reject' | 'revert';
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	baselineId?: string;
	retrievalId: string;
	version?: number;
	decidedAt: number;
	decidedBy?: string;
	notes?: string;
	sourceRunId?: string;
	restoredFromBaselineId?: string;
	restoredFromVersion?: number;
	gateStatus?: RAGRetrievalComparisonGateResult['status'];
	overrideGate?: boolean;
	overrideReason?: string;
	freshnessStatus?: 'fresh' | 'expired' | 'not_applicable';
	expiresAt?: number;
	ageMs?: number;
};

export type RAGRetrievalPromotionReadiness = {
	ready: boolean;
	reasons: string[];
	targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	sourceRunId?: string;
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	gateStatus?: RAGRetrievalComparisonGateResult['status'];
	requiresApproval?: boolean;
	requiresOverride?: boolean;
	effectiveReleasePolicy?: RAGRetrievalReleasePolicy;
	effectiveBaselineGatePolicy?: RAGRetrievalBaselineGatePolicy;
};

export type RAGRetrievalPromotionCandidate = {
	sourceRunId: string;
	groupKey?: string;
	label: string;
	suiteId: string;
	suiteLabel: string;
	finishedAt: number;
	targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	candidateRetrievalId?: string;
	baselineRetrievalId?: string;
	gateStatus?: RAGRetrievalComparisonGateResult['status'];
	reviewStatus: 'approved' | 'blocked' | 'needs_review' | 'ready';
	priority:
		| 'ready_now'
		| 'needs_review'
		| 'gate_warn'
		| 'gate_fail'
		| 'blocked';
	priorityScore: number;
	sortReason: string;
	ready: boolean;
	reasons: string[];
	requiresApproval: boolean;
	approved: boolean;
	approvedAt?: number;
	approvedBy?: string;
	approvalFreshnessStatus?: 'fresh' | 'expired' | 'not_applicable';
	approvalExpiresAt?: number;
	approvalAgeMs?: number;
	effectiveReleasePolicy?: RAGRetrievalReleasePolicy;
	effectiveBaselineGatePolicy?: RAGRetrievalBaselineGatePolicy;
	delta?: RAGRetrievalComparisonDecisionDelta;
	releaseVerdictStatus?: RAGRetrievalReleaseVerdict['status'];
	tags?: string[];
};

export type RAGRetrievalReleasePolicy = {
	requireApprovalBeforePromotion?: boolean;
	approvalMaxAgeMs?: number;
};

export type RAGRetrievalReleaseLanePolicySummary = RAGRetrievalReleasePolicy & {
	groupKey?: string;
	rolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	scope: 'rollout_label' | 'group_rollout_label';
};

export type RAGRetrievalReleaseLanePolicyHistoryRecord = {
	id: string;
	corpusGroupKey?: string;
	groupKey?: string;
	rolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	scope: 'rollout_label' | 'group_rollout_label';
	requireApprovalBeforePromotion?: boolean;
	approvalMaxAgeMs?: number;
	recordedAt: number;
	changeKind: 'snapshot' | 'changed';
	previousRequireApprovalBeforePromotion?: boolean;
	previousApprovalMaxAgeMs?: number;
};

export type RAGRetrievalReleaseLanePolicyHistoryStore = {
	saveRecord: (
		record: RAGRetrievalReleaseLanePolicyHistoryRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		rolloutLabel?: RAGRetrievalReleaseLanePolicyHistoryRecord['rolloutLabel'];
		scope?: RAGRetrievalReleaseLanePolicyHistoryRecord['scope'];
	}) =>
		| Promise<RAGRetrievalReleaseLanePolicyHistoryRecord[]>
		| RAGRetrievalReleaseLanePolicyHistoryRecord[];
};

export type RAGRetrievalReleaseLanePolicyHistoryResponse = {
	ok: boolean;
	records?: RAGRetrievalReleaseLanePolicyHistoryRecord[];
	error?: string;
};

export type RAGRetrievalBaselineGatePolicySummary = {
	groupKey?: string;
	rolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	scope: 'rollout_label' | 'group_rollout_label';
	policy: RAGRetrievalBaselineGatePolicy;
};

export type RAGRetrievalBaselineGatePolicyHistoryRecord = {
	id: string;
	corpusGroupKey?: string;
	groupKey?: string;
	rolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	scope: 'rollout_label' | 'group_rollout_label';
	policy: RAGRetrievalBaselineGatePolicy;
	recordedAt: number;
	changeKind: 'snapshot' | 'changed';
	previousPolicy?: RAGRetrievalBaselineGatePolicy;
};

export type RAGRetrievalBaselineGatePolicyHistoryStore = {
	saveRecord: (
		record: RAGRetrievalBaselineGatePolicyHistoryRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		rolloutLabel?: RAGRetrievalBaselineGatePolicyHistoryRecord['rolloutLabel'];
		scope?: RAGRetrievalBaselineGatePolicyHistoryRecord['scope'];
	}) =>
		| Promise<RAGRetrievalBaselineGatePolicyHistoryRecord[]>
		| RAGRetrievalBaselineGatePolicyHistoryRecord[];
};

export type RAGRetrievalBaselineGatePolicyHistoryResponse = {
	ok: boolean;
	records?: RAGRetrievalBaselineGatePolicyHistoryRecord[];
	error?: string;
};

export type RAGRetrievalReleaseIncidentSummary = {
	openCount: number;
	resolvedCount: number;
	acknowledgedOpenCount: number;
	unacknowledgedOpenCount: number;
	latestAcknowledgedAt?: number;
};

export type RAGRetrievalIncidentRemediationDecisionRecord = {
	id: string;
	incidentId: string;
	idempotencyKey?: string;
	groupKey: string;
	targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
	incidentKind?: RAGRetrievalReleaseIncidentRecord['kind'];
	remediationKind: RAGRemediationStep['kind'];
	status: 'planned' | 'applied' | 'dismissed';
	decidedAt: number;
	decidedBy?: string;
	notes?: string;
	action?: RAGRemediationAction;
};

export type RAGRetrievalIncidentRemediationDecisionRequest = {
	incidentId: string;
	remediationKind: RAGRemediationStep['kind'];
	status?: RAGRetrievalIncidentRemediationDecisionRecord['status'];
	decidedAt?: number;
	decidedBy?: string;
	notes?: string;
	action?: RAGRemediationAction;
};

export type RAGRetrievalIncidentRemediationDecisionStore = {
	saveRecord: (
		record: RAGRetrievalIncidentRemediationDecisionRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		incidentId?: string;
		limit?: number;
		remediationKind?: RAGRetrievalIncidentRemediationDecisionRecord['remediationKind'];
		status?: RAGRetrievalIncidentRemediationDecisionRecord['status'];
		targetRolloutLabel?: RAGRetrievalIncidentRemediationDecisionRecord['targetRolloutLabel'];
	}) =>
		| Promise<RAGRetrievalIncidentRemediationDecisionRecord[]>
		| RAGRetrievalIncidentRemediationDecisionRecord[];
};

export type RAGRetrievalIncidentRemediationDecisionListResponse = {
	ok: boolean;
	records?: RAGRetrievalIncidentRemediationDecisionRecord[];
	error?: string;
};

export type RAGRetrievalIncidentRemediationExecutionRequest = {
	incidentId?: string;
	idempotencyKey?: string;
	remediationKind?: RAGRemediationStep['kind'];
	decidedAt?: number;
	decidedBy?: string;
	notes?: string;
	persistDecision?: boolean;
	action: RAGRemediationAction;
};

export type RAGRetrievalIncidentRemediationExecutionCode =
	| 'approval_recorded'
	| 'incident_acknowledged'
	| 'incident_resolved'
	| 'release_status_loaded'
	| 'release_drift_loaded'
	| 'handoff_status_loaded'
	| 'guardrail_blocked'
	| 'idempotent_replay';

export type RAGRetrievalIncidentRemediationExecutionResult = {
	action: RAGRemediationAction;
	code: RAGRetrievalIncidentRemediationExecutionCode;
	idempotentReplay?: boolean;
	incidents?: RAGRetrievalReleaseIncidentRecord[];
	decisions?: RAGRetrievalReleaseDecisionRecord[];
	releaseStatus?: RAGRetrievalComparisonRuntime;
	releaseIncidentStatus?: RAGRetrievalReleaseIncidentStatusResponse;
	releaseDriftStatus?: RAGRetrievalReleaseDriftStatusResponse;
	handoffStatus?: RAGRetrievalLaneHandoffStatusResponse;
	followUpSteps?: RAGRemediationStep[];
};

export type RAGRetrievalIncidentRemediationExecutionResponse = {
	ok: boolean;
	execution?: RAGRetrievalIncidentRemediationExecutionResult;
	record?: RAGRetrievalIncidentRemediationDecisionRecord;
	error?: string;
};

export type RAGRetrievalIncidentRemediationExecutionHistoryRecord = {
	id: string;
	executedAt: number;
	groupKey?: string;
	incidentId?: string;
	incidentKind?: RAGRetrievalReleaseIncidentRecord['kind'];
	targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
	remediationKind?: RAGRemediationStep['kind'];
	action: RAGRemediationAction;
	code: RAGRetrievalIncidentRemediationExecutionCode;
	ok: boolean;
	error?: string;
	idempotencyKey?: string;
	idempotentReplay?: boolean;
	mutationSkipped?: boolean;
	blockedByGuardrail?: boolean;
	guardrailKind?:
		| 'bulk_mutation_opt_in_required'
		| 'bulk_missing_idempotency_key';
	bulkExecutionId?: string;
	bulkIndex?: number;
};

export type RAGRetrievalIncidentRemediationExecutionHistoryStore = {
	saveRecord: (
		record: RAGRetrievalIncidentRemediationExecutionHistoryRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		groupKey?: string;
		incidentId?: string;
		limit?: number;
		actionKind?: RAGRemediationAction['kind'];
		code?: RAGRetrievalIncidentRemediationExecutionCode;
		blockedByGuardrail?: boolean;
		idempotentReplay?: boolean;
		targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
	}) =>
		| Promise<RAGRetrievalIncidentRemediationExecutionHistoryRecord[]>
		| RAGRetrievalIncidentRemediationExecutionHistoryRecord[];
};

export type RAGRetrievalIncidentRemediationExecutionHistoryResponse = {
	ok: boolean;
	records?: RAGRetrievalIncidentRemediationExecutionHistoryRecord[];
	error?: string;
};

export type RAGRetrievalIncidentRemediationExecutionSummary = {
	totalCount: number;
	replayCount: number;
	replayRate: number;
	guardrailBlockedCount: number;
	guardrailBlockRate: number;
	mutationSkippedReplayCount: number;
	recentMutationSkippedReplays: RAGRetrievalIncidentRemediationExecutionHistoryRecord[];
	recentGuardrailBlocks: RAGRetrievalIncidentRemediationExecutionHistoryRecord[];
};

export type RAGRetrievalIncidentRemediationBulkExecutionRequest = {
	items: RAGRetrievalIncidentRemediationExecutionRequest[];
	allowMutationExecution?: boolean;
	stopOnError?: boolean;
};

export type RAGRetrievalIncidentRemediationBulkExecutionResponse = {
	ok: boolean;
	results?: Array<{
		index: number;
		ok: boolean;
		execution?: RAGRetrievalIncidentRemediationExecutionResult;
		record?: RAGRetrievalIncidentRemediationDecisionRecord;
		error?: string;
	}>;
	error?: string;
};

export type RAGRetrievalReleaseGroupSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	classification?: 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue';
	escalationSeverity: 'none' | 'info' | 'warning' | 'critical';
	recommendedAction:
		| 'promote_candidate'
		| 'renew_approval'
		| 'await_approval'
		| 'investigate_regression'
		| 'monitor';
	recommendedActionReasons: string[];
	approvalRequired: boolean;
	approvalMaxAgeMs?: number;
	blockedReasons: string[];
	actionRequired: boolean;
	actionRequiredReasons: string[];
	activeBaselineRetrievalId?: string;
	activeBaselineVersion?: number;
	activeBaselineRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
	latestDecisionKind?: RAGRetrievalReleaseDecisionRecord['kind'];
	latestDecisionAt?: number;
	latestRejectedCandidateRetrievalId?: string;
	pendingCandidateCount: number;
	openIncidentCount: number;
	acknowledgedOpenIncidentCount: number;
	unacknowledgedOpenIncidentCount: number;
	activeBaselineGatePolicy?: RAGRetrievalBaselineGatePolicy;
};

export type RAGRetrievalReleaseTimelineSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	lastApprovedAt?: number;
	lastPromotedAt?: number;
	lastRejectedAt?: number;
	lastRevertedAt?: number;
	latestDecisionKind?: RAGRetrievalReleaseDecisionRecord['kind'];
	latestDecisionAt?: number;
	latestDecisionFreshnessStatus?: RAGRetrievalReleaseDecisionRecord['freshnessStatus'];
};

export type RAGRetrievalReleaseLaneTimelineSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	lastApprovedAt?: number;
	lastPromotedAt?: number;
	lastRejectedAt?: number;
	lastRevertedAt?: number;
	latestDecisionKind?: RAGRetrievalReleaseDecisionRecord['kind'];
	latestDecisionAt?: number;
	latestDecisionFreshnessStatus?: RAGRetrievalReleaseDecisionRecord['freshnessStatus'];
};

export type RAGRetrievalReleaseLaneDecisionSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	decisionCount: number;
	approvalCount: number;
	promotionCount: number;
	rejectionCount: number;
	revertCount: number;
	latestDecisionKind?: RAGRetrievalReleaseDecisionRecord['kind'];
	latestDecisionAt?: number;
	latestDecisionBy?: string;
};

export type RAGRetrievalReleaseApprovalScopeSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	status: 'approved' | 'rejected' | 'none';
	latestDecisionKind?: 'approve' | 'reject';
	latestDecisionAt?: number;
	latestApprovedAt?: number;
	latestApprovedBy?: string;
	latestRejectedAt?: number;
	latestRejectedBy?: string;
};

export type RAGRetrievalReleaseLaneEscalationPolicySummary = {
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	openIncidentSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	regressionSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	gateFailureSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	approvalExpiredSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
};

export type RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord = {
	id: string;
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	openIncidentSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	regressionSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	gateFailureSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	approvalExpiredSeverity: RAGRetrievalReleaseIncidentRecord['severity'];
	recordedAt: number;
	changeKind: 'snapshot' | 'changed';
	previousOpenIncidentSeverity?: RAGRetrievalReleaseIncidentRecord['severity'];
	previousRegressionSeverity?: RAGRetrievalReleaseIncidentRecord['severity'];
	previousGateFailureSeverity?: RAGRetrievalReleaseIncidentRecord['severity'];
	previousApprovalExpiredSeverity?: RAGRetrievalReleaseIncidentRecord['severity'];
};

export type RAGRetrievalReleaseLaneEscalationPolicyHistoryStore = {
	saveRecord: (
		record: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		targetRolloutLabel?: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord['targetRolloutLabel'];
	}) =>
		| Promise<RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord[]>
		| RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord[];
};

export type RAGRetrievalReleaseLaneEscalationPolicyHistoryResponse = {
	ok: boolean;
	records?: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord[];
	error?: string;
};

export type RAGRetrievalReleaseLaneAuditSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	activeBaselineRetrievalId?: string;
	activeBaselineVersion?: number;
	latestDecisionKind?: RAGRetrievalReleaseDecisionRecord['kind'];
	latestDecisionAt?: number;
	lastApprovedAt?: number;
	lastApprovedBy?: string;
	lastPromotedAt?: number;
	lastPromotedBy?: string;
	lastRejectedAt?: number;
	lastRejectedBy?: string;
	lastRevertedAt?: number;
	lastRevertedBy?: string;
};

export type RAGRetrievalReleaseLaneRecommendationSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	classification?: 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue';
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	recommendedAction:
		| 'promote_candidate'
		| 'renew_approval'
		| 'await_approval'
		| 'investigate_regression'
		| 'monitor';
	recommendedActionReasons: string[];
	ready: boolean;
	requiresApproval: boolean;
	requiresOverride?: boolean;
	reviewStatus?: RAGRetrievalPromotionCandidate['reviewStatus'];
	gateStatus?: RAGRetrievalPromotionCandidate['gateStatus'];
	candidateRetrievalId?: string;
	baselineRetrievalId?: string;
	sourceRunId?: string;
	effectiveReleasePolicy?: RAGRetrievalPromotionCandidate['effectiveReleasePolicy'];
	effectiveBaselineGatePolicy?: RAGRetrievalPromotionCandidate['effectiveBaselineGatePolicy'];
	remediationActions?: string[];
	remediationSteps?: RAGRemediationStep[];
};

export type RAGRetrievalReleaseLaneHandoffSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	sourceRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	sourceBaselineRetrievalId?: string;
	targetBaselineRetrievalId?: string;
	candidateRetrievalId?: string;
	sourceActive: boolean;
	targetActive: boolean;
	readyForHandoff: boolean;
	reasons: string[];
	policyDelta: {
		requireApprovalBeforePromotionChanged: boolean;
		approvalMaxAgeMsDelta?: number;
		gateSeverityChanged: boolean;
		minPassingRateDeltaDelta?: number;
		minAverageF1DeltaDelta?: number;
	};
	targetReadiness?: RAGRetrievalPromotionReadiness;
};

export type RAGRetrievalLanePromotionStateSummary = {
	groupKey: string;
	classification?: 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue';
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	sourceRunId?: string;
	ready: boolean;
	reasons: string[];
	gateStatus?: RAGRetrievalPromotionCandidate['gateStatus'];
	reviewStatus?: RAGRetrievalPromotionCandidate['reviewStatus'];
	requiresApproval: boolean;
	requiresOverride?: boolean;
	effectiveReleasePolicy?: RAGRetrievalPromotionCandidate['effectiveReleasePolicy'];
	effectiveBaselineGatePolicy?: RAGRetrievalPromotionCandidate['effectiveBaselineGatePolicy'];
	remediationActions?: string[];
	remediationSteps?: RAGRemediationStep[];
};

export type RAGRetrievalReleaseIncidentRecord = {
	id: string;
	groupKey: string;
	corpusGroupKey?: string;
	targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	severity: 'warning' | 'critical';
	status: 'open' | 'resolved';
	kind:
		| 'approval_expired'
		| 'baseline_regression'
		| 'gate_failure'
		| 'handoff_stale';
	message: string;
	triggeredAt: number;
	resolvedAt?: number;
	candidateRetrievalId?: string;
	baselineRetrievalId?: string;
	sourceRunId?: string;
	acknowledgedAt?: number;
	acknowledgedBy?: string;
	acknowledgementNotes?: string;
	notes?: string;
	classification?: 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue';
};

export type RAGRetrievalLaneHandoffIncidentRecord = Omit<
	RAGRetrievalReleaseIncidentRecord,
	'kind'
> & {
	corpusGroupKey?: string;
	kind: 'handoff_stale';
	sourceRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['sourceRolloutLabel'];
};

export type RAGRetrievalReleaseLaneIncidentSummary = {
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	openCount: number;
	resolvedCount: number;
	acknowledgedOpenCount: number;
	unacknowledgedOpenCount: number;
	latestTriggeredAt?: number;
	latestResolvedAt?: number;
	latestKind?: RAGRetrievalReleaseIncidentRecord['kind'];
	highestSeverity?: RAGRetrievalReleaseIncidentRecord['severity'];
};

export type RAGRetrievalReleaseIncidentAcknowledgeRequest = {
	incidentId: string;
	acknowledgedAt?: number;
	acknowledgedBy?: string;
	acknowledgementNotes?: string;
};

export type RAGRetrievalReleaseIncidentUnacknowledgeRequest = {
	incidentId: string;
};

export type RAGRetrievalReleaseIncidentResolveRequest = {
	incidentId: string;
	resolvedAt?: number;
	resolvedBy?: string;
	resolutionNotes?: string;
};

export type RAGRetrievalReleaseIncidentStore = {
	saveIncident: (
		record: RAGRetrievalReleaseIncidentRecord
	) => Promise<void> | void;
	listIncidents: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
		status?: RAGRetrievalReleaseIncidentRecord['status'];
		severity?: RAGRetrievalReleaseIncidentRecord['severity'];
	}) =>
		| Promise<RAGRetrievalReleaseIncidentRecord[]>
		| RAGRetrievalReleaseIncidentRecord[];
};

export type RAGRetrievalLaneHandoffIncidentStore = {
	saveIncident: (
		record: RAGRetrievalLaneHandoffIncidentRecord
	) => Promise<void> | void;
	listIncidents: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		targetRolloutLabel?: RAGRetrievalLaneHandoffIncidentRecord['targetRolloutLabel'];
		status?: RAGRetrievalLaneHandoffIncidentRecord['status'];
		severity?: RAGRetrievalLaneHandoffIncidentRecord['severity'];
	}) =>
		| Promise<RAGRetrievalLaneHandoffIncidentRecord[]>
		| RAGRetrievalLaneHandoffIncidentRecord[];
};

export type RAGRetrievalLaneHandoffIncidentListResponse = {
	ok: boolean;
	incidents?: RAGRetrievalLaneHandoffIncidentRecord[];
	error?: string;
};

export type RAGRetrievalLaneHandoffIncidentHistoryRecord = {
	id: string;
	incidentId: string;
	corpusGroupKey?: string;
	groupKey: string;
	kind: 'handoff_stale';
	targetRolloutLabel?: RAGRetrievalLaneHandoffIncidentRecord['targetRolloutLabel'];
	sourceRolloutLabel?: RAGRetrievalLaneHandoffIncidentRecord['sourceRolloutLabel'];
	action: 'opened' | 'acknowledged' | 'unacknowledged' | 'resolved';
	recordedAt: number;
	recordedBy?: string;
	notes?: string;
	status?: RAGRetrievalLaneHandoffIncidentRecord['status'];
	severity?: RAGRetrievalLaneHandoffIncidentRecord['severity'];
};

export type RAGRetrievalLaneHandoffIncidentHistoryStore = {
	saveRecord: (
		record: RAGRetrievalLaneHandoffIncidentHistoryRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		incidentId?: string;
		limit?: number;
		targetRolloutLabel?: RAGRetrievalLaneHandoffIncidentRecord['targetRolloutLabel'];
		action?: RAGRetrievalLaneHandoffIncidentHistoryRecord['action'];
	}) =>
		| Promise<RAGRetrievalLaneHandoffIncidentHistoryRecord[]>
		| RAGRetrievalLaneHandoffIncidentHistoryRecord[];
};

export type RAGRetrievalLaneHandoffIncidentHistoryResponse = {
	ok: boolean;
	records?: RAGRetrievalLaneHandoffIncidentHistoryRecord[];
	error?: string;
};

export type RAGRetrievalLaneHandoffAutoCompletePolicy = {
	enabled?: boolean;
	maxApprovedDecisionAgeMs?: number;
};

export type RAGRetrievalLaneHandoffAutoCompletePolicySummary = {
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	enabled: boolean;
	maxApprovedDecisionAgeMs?: number;
	scope: 'group_target_rollout_label';
};

export type RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord = {
	id: string;
	corpusGroupKey?: string;
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	enabled: boolean;
	maxApprovedDecisionAgeMs?: number;
	recordedAt: number;
	changeKind: 'snapshot' | 'changed';
	previousEnabled?: boolean;
	previousMaxApprovedDecisionAgeMs?: number;
};

export type RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore = {
	saveRecord: (
		record: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord
	) => Promise<void> | void;
	listRecords: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		targetRolloutLabel?: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord['targetRolloutLabel'];
	}) =>
		| Promise<RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord[]>
		| RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord[];
};

export type RAGRetrievalLaneHandoffAutoCompletePolicyHistoryResponse = {
	ok: boolean;
	records?: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord[];
	error?: string;
};

export type RAGRetrievalLaneAutoCompleteSafetySummary = {
	groupKey: string;
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	safe: boolean;
	enabled: boolean;
	reasons: string[];
	candidateRetrievalId?: string;
	sourceRunId?: string;
	latestApprovedAt?: number;
	approvalExpiresAt?: number;
	freshnessStatus: 'fresh' | 'expired' | 'not_applicable';
};

export type RAGRetrievalLaneHandoffDriftRollup = {
	kind:
		| 'handoff_auto_complete_policy_drift'
		| 'handoff_auto_complete_stale_approval'
		| 'handoff_auto_complete_source_lane_missing'
		| 'handoff_auto_complete_gate_blocked'
		| 'handoff_auto_complete_approval_missing';
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	count: number;
	groupKeys: string[];
	severity: 'warning';
	remediationHints: string[];
	remediationSteps?: RAGRemediationStep[];
};

export type RAGRetrievalLaneHandoffDriftCountByLane = {
	targetRolloutLabel: Exclude<
		RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'],
		undefined
	>;
	totalCount: number;
	countsByKind: Record<RAGRetrievalLaneHandoffDriftRollup['kind'], number>;
};

export type RAGRetrievalReleaseIncidentListResponse = {
	ok: boolean;
	incidents?: RAGRetrievalReleaseIncidentRecord[];
	error?: string;
};

export type RAGRetrievalReleaseIncidentStatusResponse = {
	ok: true;
	incidentSummary?: RAGRetrievalComparisonRuntime['incidentSummary'];
	incidentClassificationSummary?: RAGRetrievalIncidentClassificationSummary;
	releaseLaneIncidentSummaries?: RAGRetrievalComparisonRuntime['releaseLaneIncidentSummaries'];
	recentIncidents?: RAGRetrievalComparisonRuntime['recentIncidents'];
	recentIncidentRemediationDecisions?: RAGRetrievalComparisonRuntime['recentIncidentRemediationDecisions'];
	recentIncidentRemediationExecutions?: RAGRetrievalComparisonRuntime['recentIncidentRemediationExecutions'];
	incidentRemediationExecutionSummary?: RAGRetrievalComparisonRuntime['incidentRemediationExecutionSummary'];
	recentReleaseLaneEscalationPolicyHistory?: RAGRetrievalComparisonRuntime['recentReleaseLaneEscalationPolicyHistory'];
};

export type RAGRetrievalIncidentRemediationStatusResponse = {
	ok: true;
	incidentClassificationSummary?: RAGRetrievalIncidentClassificationSummary;
	recentIncidentRemediationExecutions?: RAGRetrievalComparisonRuntime['recentIncidentRemediationExecutions'];
	incidentRemediationExecutionSummary?: RAGRetrievalComparisonRuntime['incidentRemediationExecutionSummary'];
};

export type RAGRetrievalIncidentClassificationSummary = {
	totalGeneralCount: number;
	totalMultiVectorCount: number;
	totalRuntimeCount: number;
	totalEvidenceCount: number;
	totalCueCount: number;
	openGeneralCount: number;
	openMultiVectorCount: number;
	openRuntimeCount: number;
	openEvidenceCount: number;
	openCueCount: number;
	resolvedGeneralCount: number;
	resolvedMultiVectorCount: number;
	resolvedRuntimeCount: number;
	resolvedEvidenceCount: number;
	resolvedCueCount: number;
};

export type RAGRetrievalReleaseEvent = {
	kind: 'incident_opened' | 'incident_resolved';
	incident: RAGRetrievalReleaseIncidentRecord;
};

export type RAGRetrievalReleasePolicySummary = RAGRetrievalReleasePolicy & {
	groupKey: string;
	rolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
};

export type RAGRetrievalReleaseDecisionStore = {
	saveDecision: (
		record: RAGRetrievalReleaseDecisionRecord
	) => Promise<void> | void;
	listDecisions: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		limit?: number;
		kind?: RAGRetrievalReleaseDecisionRecord['kind'];
	}) =>
		| Promise<RAGRetrievalReleaseDecisionRecord[]>
		| RAGRetrievalReleaseDecisionRecord[];
};

export type RAGRetrievalReleaseDecisionActionRequest = {
	corpusGroupKey?: string;
	groupKey: string;
	sourceRunId: string;
	targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	retrievalId?: string;
	decidedBy?: string;
	decidedAt?: number;
	notes?: string;
	overrideGate?: boolean;
	overrideReason?: string;
};

export type RAGRetrievalReleaseDecisionResponse = {
	ok: boolean;
	decision?: RAGRetrievalReleaseDecisionRecord;
	error?: string;
};

export type RAGRetrievalReleaseDecisionListResponse = {
	ok: boolean;
	decisions?: RAGRetrievalReleaseDecisionRecord[];
	error?: string;
};

export type RAGRetrievalLaneHandoffDecisionRecord = {
	id: string;
	corpusGroupKey?: string;
	groupKey: string;
	sourceRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	kind: 'approve' | 'reject' | 'complete';
	decidedAt: number;
	decidedBy?: string;
	notes?: string;
	candidateRetrievalId?: string;
	sourceBaselineRetrievalId?: string;
	targetBaselineRetrievalId?: string;
	sourceRunId?: string;
};

export type RAGRetrievalLaneHandoffDecisionStore = {
	saveDecision: (
		record: RAGRetrievalLaneHandoffDecisionRecord
	) => Promise<void> | void;
	listDecisions: (input?: {
		corpusGroupKey?: string;
		groupKey?: string;
		sourceRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['sourceRolloutLabel'];
		targetRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'];
		kind?: RAGRetrievalLaneHandoffDecisionRecord['kind'];
		limit?: number;
	}) =>
		| Promise<RAGRetrievalLaneHandoffDecisionRecord[]>
		| RAGRetrievalLaneHandoffDecisionRecord[];
};

export type RAGRetrievalLaneHandoffDecisionRequest = {
	corpusGroupKey?: string;
	groupKey: string;
	sourceRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	targetRolloutLabel: Exclude<
		RAGRetrievalBaselineRecord['rolloutLabel'],
		undefined
	>;
	kind: RAGRetrievalLaneHandoffDecisionRecord['kind'];
	decidedBy?: string;
	decidedAt?: number;
	notes?: string;
	candidateRetrievalId?: string;
	sourceRunId?: string;
	executePromotion?: boolean;
};

export type RAGRetrievalLaneHandoffDecisionResponse = {
	ok: boolean;
	decision?: RAGRetrievalLaneHandoffDecisionRecord;
	baseline?: RAGRetrievalBaselineRecord;
	rolloutState?: RAGRetrievalLanePromotionStateSummary;
	error?: string;
};

export type RAGRetrievalLaneHandoffDecisionListResponse = {
	ok: boolean;
	decisions?: RAGRetrievalLaneHandoffDecisionRecord[];
	error?: string;
};

export type RAGRetrievalLaneHandoffListResponse = {
	ok: boolean;
	handoffs?: RAGRetrievalReleaseLaneHandoffSummary[];
	error?: string;
};

export type RAGRetrievalReleaseGroupHistoryResponse = {
	ok: boolean;
	corpusGroupKey?: string;
	groupKey?: string;
	decisions?: RAGRetrievalReleaseDecisionRecord[];
	baselines?: RAGRetrievalBaselineRecord[];
	runs?: RAGRetrievalComparisonRun[];
	timeline?: RAGRetrievalReleaseTimelineSummary;
	presentation?: RAGRetrievalReleaseGroupHistoryPresentation;
	adaptiveNativePlannerBenchmark?: RAGAdaptiveNativePlannerBenchmarkRuntime;
	nativeBackendComparisonBenchmark?: RAGNativeBackendComparisonBenchmarkRuntime;
	presentationCueBenchmark?: RAGPresentationCueBenchmarkRuntime;
	spreadsheetCueBenchmark?: RAGSpreadsheetCueBenchmarkRuntime;
	error?: string;
};

export type RAGRetrievalPromotionCandidateListResponse = {
	ok: boolean;
	candidates?: RAGRetrievalPromotionCandidate[];
	error?: string;
};

export type RAGRetrievalComparisonLatestSummary = {
	id: string;
	label: string;
	suiteId: string;
	suiteLabel: string;
	corpusGroupKey?: string;
	groupKey?: string;
	tags?: string[];
	finishedAt: number;
	elapsedMs: number;
	bestByPassingRate?: string;
	bestByAverageF1?: string;
	fastest?: string;
	bestByPresentationTitleCueCases?: string;
	bestByPresentationBodyCueCases?: string;
	bestByPresentationNotesCueCases?: string;
	bestBySpreadsheetSheetCueCases?: string;
	bestBySpreadsheetTableCueCases?: string;
	bestBySpreadsheetColumnCueCases?: string;
	bestByMultivectorCollapsedCases?: string;
	bestByMultivectorLexicalHitCases?: string;
	bestByMultivectorVectorHitCases?: string;
	bestByEvidenceReconcileCases?: string;
	bestByOfficeEvidenceReconcileCases?: string;
	bestByOfficeParagraphEvidenceReconcileCases?: string;
	bestByOfficeListEvidenceReconcileCases?: string;
	bestByOfficeTableEvidenceReconcileCases?: string;
	bestByPDFEvidenceReconcileCases?: string;
	bestByLowestRuntimeCandidateBudgetExhaustedCases?: string;
	bestByLowestRuntimeUnderfilledTopKCases?: string;
	decisionSummary?: RAGRetrievalComparisonDecisionSummary;
	releaseVerdict?: RAGRetrievalReleaseVerdict;
};

export type RAGRetrievalComparisonWinnerTrend = {
	retrievalId: string;
	runCount: number;
	latestFinishedAt: number;
};

export type RAGRetrievalComparisonAlert = {
	kind:
		| 'stable_winner_changed'
		| 'baseline_regression'
		| 'baseline_gate_failed'
		| 'handoff_auto_complete_policy_drift'
		| 'handoff_auto_complete_stale_approval'
		| 'handoff_auto_complete_source_lane_missing'
		| 'handoff_auto_complete_gate_blocked'
		| 'handoff_auto_complete_approval_missing';
	severity: 'info' | 'warning';
	message: string;
	latestRunId: string;
	retrievalId?: string;
	corpusGroupKey?: string;
	groupKey?: string;
	tag?: string;
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	delta?: RAGRetrievalComparisonDecisionDelta;
	gate?: RAGRetrievalComparisonGateResult;
	classification?: 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue';
};

export type RAGRetrievalComparisonRuntime = {
	configured: boolean;
	recentRuns?: RAGRetrievalComparisonRun[];
	latest?: RAGRetrievalComparisonLatestSummary;
	adaptiveNativePlannerBenchmark?: RAGAdaptiveNativePlannerBenchmarkRuntime;
	nativeBackendComparisonBenchmark?: RAGNativeBackendComparisonBenchmarkRuntime;
	presentationCueBenchmark?: RAGPresentationCueBenchmarkRuntime;
	spreadsheetCueBenchmark?: RAGSpreadsheetCueBenchmarkRuntime;
	stableWinnerByPassingRate?: RAGRetrievalComparisonWinnerTrend;
	alerts?: RAGRetrievalComparisonAlert[];
	activeBaselines?: RAGRetrievalBaselineRecord[];
	baselineHistory?: RAGRetrievalBaselineRecord[];
	recentDecisions?: RAGRetrievalReleaseDecisionRecord[];
	latestRejectedCandidate?: RAGRetrievalReleaseDecisionRecord;
	readyToPromote?: RAGRetrievalPromotionReadiness;
	readyToPromoteByLane?: RAGRetrievalPromotionReadiness[];
	promotionCandidates?: RAGRetrievalPromotionCandidate[];
	releaseGroups?: RAGRetrievalReleaseGroupSummary[];
	releasePolicies?: RAGRetrievalReleasePolicySummary[];
	releaseLanePolicies?: RAGRetrievalReleaseLanePolicySummary[];
	releaseGatePolicies?: RAGRetrievalBaselineGatePolicySummary[];
	releaseTimelines?: RAGRetrievalReleaseTimelineSummary[];
	releaseLaneTimelines?: RAGRetrievalReleaseLaneTimelineSummary[];
	releaseLaneDecisions?: RAGRetrievalReleaseLaneDecisionSummary[];
	approvalScopes?: RAGRetrievalReleaseApprovalScopeSummary[];
	releaseLaneEscalationPolicies?: RAGRetrievalReleaseLaneEscalationPolicySummary[];
	releaseLaneAudits?: RAGRetrievalReleaseLaneAuditSummary[];
	releaseLaneRecommendations?: RAGRetrievalReleaseLaneRecommendationSummary[];
	releaseLaneIncidentSummaries?: RAGRetrievalReleaseLaneIncidentSummary[];
	releaseLaneHandoffs?: RAGRetrievalReleaseLaneHandoffSummary[];
	recentLaneHandoffDecisions?: RAGRetrievalLaneHandoffDecisionRecord[];
	recentLaneHandoffIncidents?: RAGRetrievalLaneHandoffIncidentRecord[];
	handoffFreshnessWindows?: RAGRetrievalLaneHandoffFreshnessWindow[];
	handoffAutoComplete?: RAGRetrievalLaneHandoffAutoCompleteSummary[];
	handoffAutoCompletePolicies?: RAGRetrievalLaneHandoffAutoCompletePolicySummary[];
	handoffAutoCompleteSafety?: RAGRetrievalLaneAutoCompleteSafetySummary[];
	handoffDriftRollups?: RAGRetrievalLaneHandoffDriftRollup[];
	handoffDriftCountsByLane?: RAGRetrievalLaneHandoffDriftCountByLane[];
	recentHandoffAutoCompletePolicyHistory?: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord[];
	recentReleaseLanePolicyHistory?: RAGRetrievalReleaseLanePolicyHistoryRecord[];
	recentBaselineGatePolicyHistory?: RAGRetrievalBaselineGatePolicyHistoryRecord[];
	recentReleaseLaneEscalationPolicyHistory?: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord[];
	recentLaneHandoffIncidentHistory?: RAGRetrievalLaneHandoffIncidentHistoryRecord[];
	recentIncidents?: RAGRetrievalReleaseIncidentRecord[];
	recentIncidentRemediationDecisions?: RAGRetrievalIncidentRemediationDecisionRecord[];
	recentIncidentRemediationExecutions?: RAGRetrievalIncidentRemediationExecutionHistoryRecord[];
	incidentRemediationExecutionSummary?: RAGRetrievalIncidentRemediationExecutionSummary;
	incidentSummary?: RAGRetrievalReleaseIncidentSummary;
	relatedSearchTraces?: RAGSearchTraceStats;
	relatedPruneRun?: RAGSearchTracePruneRun;
};

export type RAGCollection = {
	store: RAGVectorStore;
	search: (input: RAGCollectionSearchParams) => Promise<RAGQueryResult[]>;
	searchWithTrace: (
		input: RAGCollectionSearchParams
	) => Promise<RAGCollectionSearchResult>;
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
	trace?: RAGRetrievalTrace;
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
	retrievalTrace?: RAGRetrievalTrace;
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
			trace?: RAGRetrievalTrace;
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

export type AIConversationStore = SessionStore<
	AIConversation,
	AIConversationSummary
>;

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
			trace?: RAGRetrievalTrace;
		}
	) => string;
	canceled?: () => string;
	error?: (message: string) => string;
};

export type RAGHTMXWorkflowRenderConfig = {
	status?: (input: {
		admin?: RAGAdminCapabilities;
		adminActions?: RAGAdminActionRecord[];
		adminJobs?: RAGAdminJobRecord[];
		maintenance?: RAGBackendMaintenanceSummary;
		retrievalComparisons?: RAGOperationsResponse['retrievalComparisons'];
		path?: string;
		status?: RAGVectorStoreStatus;
		capabilities?: RAGBackendCapabilities;
		documents?: RAGDocumentSummary;
	}) => string;
	maintenance?: (input: {
		admin?: RAGAdminCapabilities;
		adminActions?: RAGAdminActionRecord[];
		adminJobs?: RAGAdminJobRecord[];
		maintenance?: RAGBackendMaintenanceSummary;
		path?: string;
		status?: RAGVectorStoreStatus;
	}) => string;
	searchResults?: (input: {
		query: string;
		results: RAGSource[];
		trace?: RAGRetrievalTrace;
	}) => string;
	searchResultItem?: (source: RAGSource, index: number) => string;
	documents?: (input: { documents: RAGIndexedDocument[] }) => string;
	documentItem?: (document: RAGIndexedDocument, index: number) => string;
	chunkPreview?: (input: RAGDocumentChunkPreview) => string;
	evaluateResult?: (input: {
		cases: RAGEvaluationCaseResult[];
		summary: RAGEvaluationSummary;
	}) => string;
	adaptiveNativePlannerBenchmark?: (
		input: RAGAdaptiveNativePlannerBenchmarkResponse
	) => string;
	nativeBackendComparisonBenchmark?: (
		input: RAGNativeBackendComparisonBenchmarkResponse
	) => string;
	presentationCueBenchmark?: (
		input: RAGPresentationCueBenchmarkResponse
	) => string;
	spreadsheetCueBenchmark?: (
		input: RAGSpreadsheetCueBenchmarkResponse
	) => string;
	adaptiveNativePlannerBenchmarkSnapshot?: (
		input: RAGAdaptiveNativePlannerBenchmarkSnapshotResponse
	) => string;
	nativeBackendComparisonBenchmarkSnapshot?: (
		input: RAGNativeBackendComparisonBenchmarkSnapshotResponse
	) => string;
	presentationCueBenchmarkSnapshot?: (
		input: RAGPresentationCueBenchmarkSnapshotResponse
	) => string;
	spreadsheetCueBenchmarkSnapshot?: (
		input: RAGSpreadsheetCueBenchmarkSnapshotResponse
	) => string;
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
	jobStateStore?: RAGJobStateStore;
	evaluationSuiteSnapshotHistoryStore?: RAGEvaluationSuiteSnapshotHistoryStore;
	authorizeRAGAction?: RAGAuthorizationProvider;
	resolveRAGAccessScope?: RAGAccessScopeProvider;
	jobHistoryRetention?: RAGJobHistoryRetention;
	searchTraceStore?: RAGSearchTraceStore;
	searchTraceRetention?: RAGSearchTracePruneInput;
	searchTraceRetentionSchedule?: RAGSearchTraceRetentionSchedule;
	searchTracePruneHistoryStore?: RAGSearchTracePruneHistoryStore;
	retrievalComparisonHistoryStore?: RAGRetrievalComparisonHistoryStore;
	retrievalBaselineStore?: RAGRetrievalBaselineStore;
	retrievalReleaseDecisionStore?: RAGRetrievalReleaseDecisionStore;
	retrievalLaneHandoffDecisionStore?: RAGRetrievalLaneHandoffDecisionStore;
	retrievalLaneHandoffIncidentStore?: RAGRetrievalLaneHandoffIncidentStore;
	retrievalLaneHandoffIncidentHistoryStore?: RAGRetrievalLaneHandoffIncidentHistoryStore;
	retrievalLaneHandoffAutoCompletePolicyHistoryStore?: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore;
	retrievalReleaseLanePolicyHistoryStore?: RAGRetrievalReleaseLanePolicyHistoryStore;
	retrievalBaselineGatePolicyHistoryStore?: RAGRetrievalBaselineGatePolicyHistoryStore;
	retrievalReleaseLaneEscalationPolicyHistoryStore?: RAGRetrievalReleaseLaneEscalationPolicyHistoryStore;
	retrievalReleaseIncidentStore?: RAGRetrievalReleaseIncidentStore;
	retrievalIncidentRemediationDecisionStore?: RAGRetrievalIncidentRemediationDecisionStore;
	retrievalIncidentRemediationExecutionHistoryStore?: RAGRetrievalIncidentRemediationExecutionHistoryStore;
	retrievalLaneHandoffAutoCompletePoliciesByGroupAndTargetRolloutLabel?: Record<
		string,
		Partial<
			Record<
				Exclude<RAGRetrievalBaselineRecord['rolloutLabel'], undefined>,
				RAGRetrievalLaneHandoffAutoCompletePolicy
			>
		>
	>;
	retrievalReleasePolicies?: Record<string, RAGRetrievalReleasePolicy>;
	retrievalReleasePoliciesByRolloutLabel?: Partial<
		Record<
			Exclude<RAGRetrievalBaselineRecord['rolloutLabel'], undefined>,
			RAGRetrievalReleasePolicy
		>
	>;
	retrievalReleasePoliciesByGroupAndRolloutLabel?: Record<
		string,
		Partial<
			Record<
				Exclude<RAGRetrievalBaselineRecord['rolloutLabel'], undefined>,
				RAGRetrievalReleasePolicy
			>
		>
	>;
	retrievalBaselineGatePoliciesByRolloutLabel?: Partial<
		Record<
			Exclude<RAGRetrievalBaselineRecord['rolloutLabel'], undefined>,
			RAGRetrievalBaselineGatePolicy
		>
	>;
	retrievalBaselineGatePoliciesByGroup?: Record<
		string,
		RAGRetrievalBaselineGatePolicy
	>;
	retrievalBaselineGatePoliciesByGroupAndRolloutLabel?: Record<
		string,
		Partial<
			Record<
				Exclude<RAGRetrievalBaselineRecord['rolloutLabel'], undefined>,
				RAGRetrievalBaselineGatePolicy
			>
		>
	>;
	onRetrievalReleaseEvent?: (
		event: RAGRetrievalReleaseEvent
	) => void | Promise<void>;
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
