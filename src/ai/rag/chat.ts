import { Elysia } from 'elysia';
import {
	HTTP_STATUS_BAD_REQUEST,
	HTTP_STATUS_NOT_FOUND,
	HTTP_STATUS_OK
} from '../../constants';
import type {
	AIAttachment,
	AIChatPluginConfig,
	AIConversation,
	AIConversationStore,
	AIMessage,
	AIUsage,
	RAGEvaluationInput,
	RAGEvaluationResponse,
	RAGAdminActionRecord,
	RAGAdminCapabilities,
	RAGAccessScope,
	RAGAuthorizedAction,
	RAGAuthorizationDecision,
	RAGAuthorizationResource,
	RAGAdminJobRecord,
	RAGBackendsResponse,
	RAGBackendMaintenanceSummary,
	RAGDocumentChunk,
	RAGDocumentChunksResponse,
	RAGDocumentIngestInput,
	RAGDocumentsResponse,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGIndexedDocument,
	RAGChatPluginConfig,
	RAGCorpusHealth,
	RAGIngestJobRecord,
	RAGMutationResponse,
	RAGOperationsResponse,
	RAGRetrievalBaselineListResponse,
	RAGRetrievalBaselinePromotionFromRunRequest,
	RAGRetrievalBaselinePromotionRequest,
	RAGRetrievalBaselineGatePolicy,
	RAGRetrievalBaselineRecord,
	RAGRetrievalBaselineRevertRequest,
	RAGRetrievalReleaseDecisionActionRequest,
	RAGRetrievalReleaseDecisionRecord,
	RAGRetrievalLaneHandoffDecisionListResponse,
	RAGRetrievalLaneHandoffDecisionRecord,
	RAGRetrievalLaneHandoffDecisionRequest,
	RAGRetrievalLaneHandoffDecisionResponse,
	RAGRetrievalLaneHandoffAutoCompletePolicyHistoryResponse,
	RAGRetrievalLanePromotionStateSummary,
	RAGRetrievalReleaseLanePolicyHistoryResponse,
	RAGRetrievalBaselineGatePolicyHistoryResponse,
	RAGRetrievalReleaseLaneEscalationPolicyHistoryResponse,
	RAGRetrievalLaneHandoffIncidentHistoryResponse,
	RAGRetrievalLaneHandoffIncidentListResponse,
	RAGRetrievalLaneHandoffIncidentRecord,
	RAGRetrievalLaneHandoffIncidentStatusResponse,
	RAGRetrievalLaneHandoffListResponse,
	RAGRetrievalIncidentRemediationDecisionListResponse,
	RAGRetrievalIncidentRemediationDecisionRecord,
	RAGRetrievalIncidentRemediationDecisionRequest,
	RAGRetrievalIncidentClassificationSummary,
	RAGRetrievalIncidentRemediationExecutionHistoryResponse,
	RAGRetrievalIncidentRemediationExecutionHistoryRecord,
	RAGRetrievalIncidentRemediationExecutionSummary,
	RAGRetrievalIncidentRemediationBulkExecutionRequest,
	RAGRetrievalIncidentRemediationBulkExecutionResponse,
	RAGRetrievalIncidentRemediationExecutionCode,
	RAGRetrievalIncidentRemediationExecutionRequest,
	RAGRetrievalIncidentRemediationExecutionResponse,
	RAGRetrievalIncidentRemediationStatusResponse,
	RAGRetrievalReleaseIncidentListResponse,
	RAGRetrievalReleaseIncidentStatusResponse,
	RAGRetrievalReleaseIncidentRecord,
	RAGRetrievalReleasePolicy,
	RAGAdaptiveNativePlannerBenchmarkRuntime,
	RAGAdaptiveNativePlannerBenchmarkResponse,
	RAGAdaptiveNativePlannerBenchmarkSnapshotResponse,
	RAGNativeBackendComparisonBenchmarkRuntime,
	RAGNativeBackendComparisonBenchmarkResponse,
	RAGNativeBackendComparisonBenchmarkSnapshotResponse,
	RAGPresentationCueBenchmarkRuntime,
	RAGPresentationCueBenchmarkResponse,
	RAGPresentationCueBenchmarkSnapshotResponse,
	RAGSpreadsheetCueBenchmarkRuntime,
	RAGSpreadsheetCueBenchmarkResponse,
	RAGSpreadsheetCueBenchmarkSnapshotResponse,
	RAGRemediationAction,
	RAGRemediationStep,
	RAGRetrievalReleaseGroupHistoryResponse,
	RAGRetrievalReleaseApprovalScopeSummary,
	RAGRetrievalBaselineResponse,
	RAGRetrievalPromotionCandidate,
	RAGRetrievalPromotionCandidateListResponse,
	RAGRetrievalReleaseDecisionListResponse,
	RAGRetrievalTrace,
	RAGRetrievalComparisonResponse,
	RAGRetrievalComparisonDecisionDelta,
	RAGRetrievalComparisonHistoryResponse,
	RAGRetrievalComparisonRequest,
	RAGRetrievalComparisonRun,
	RAGSearchResponse,
	RAGSearchTracePruneInput,
	RAGSearchTracePruneHistoryResponse,
	RAGSearchTracePrunePreviewResponse,
	RAGSearchTracePruneResponse,
	RAGSearchTracePruneRun,
	RAGSearchTraceRetentionRuntime,
	RAGSearchTraceStatsResponse,
	RAGSearchTraceGroupHistoryResponse,
	RAGSearchTraceHistoryResponse,
	RAGCollectionSearchParams,
	RAGSyncResponse,
	RAGSource,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { createMemoryStore } from '../memoryStore';
import { generateId, parseAIMessage } from '../protocol';
import { streamAI } from '../streamAI';
import { streamAIToSSE } from '../streamAIToSSE';
import { resolveRenderers } from '../htmxRenderers';
import { createRAGCollection } from './collection';
import { resolveRAGWorkflowRenderers } from './htmxWorkflowRenderers';
import {
	buildRAGChunkExcerpts,
	buildRAGExcerptSelection,
	buildRAGChunkStructure,
	buildRAGSourceLabels,
	buildRAGEvaluationSuiteSnapshotHistoryPresentation,
	buildRAGRetrievalReleaseGroupHistoryPresentation
} from './presentation';
import {
	buildRAGSearchTraceRecord,
	createRAGAdaptiveNativePlannerBenchmarkSnapshot,
	createRAGAdaptiveNativePlannerBenchmarkSuite,
	createRAGNativeBackendComparisonBenchmarkSnapshot,
	createRAGNativeBackendComparisonBenchmarkSuite,
	createRAGPresentationCueBenchmarkSnapshot,
	createRAGPresentationCueBenchmarkSuite,
	createRAGSpreadsheetCueBenchmarkSnapshot,
	createRAGSpreadsheetCueBenchmarkSuite,
	buildRAGRetrievalComparisonDecisionSummary,
	buildRAGRetrievalReleaseVerdict,
	compareRAGRetrievalStrategies,
	loadRAGRetrievalBaselines,
	loadRAGRetrievalReleaseDecisions,
	loadRAGRetrievalLaneHandoffDecisions,
	loadRAGRetrievalReleaseIncidents,
	evaluateRAGCollection,
	loadRAGSearchTraceGroupHistory,
	loadRAGSearchTraceHistory,
	loadRAGSearchTracePruneHistory,
	loadRAGRetrievalComparisonHistory,
	loadRAGRetrievalLaneHandoffIncidents,
	loadRAGRetrievalLaneHandoffIncidentHistory,
	loadRAGRetrievalIncidentRemediationDecisions,
	loadRAGRetrievalIncidentRemediationExecutionHistory,
	loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory,
	loadRAGRetrievalReleaseLanePolicyHistory,
	loadRAGRetrievalBaselineGatePolicyHistory,
	loadRAGRetrievalReleaseLaneEscalationPolicyHistory,
	loadRAGEvaluationSuiteSnapshotHistory,
	previewRAGSearchTraceStorePrune,
	persistRAGRetrievalBaseline,
	persistRAGRetrievalComparisonRun,
	persistRAGRetrievalReleaseDecision,
	persistRAGRetrievalLaneHandoffDecision,
	persistRAGRetrievalLaneHandoffIncident,
	persistRAGRetrievalLaneHandoffIncidentHistory,
	persistRAGRetrievalIncidentRemediationDecision,
	persistRAGRetrievalIncidentRemediationExecutionHistory,
	persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory,
	persistRAGRetrievalReleaseLanePolicyHistory,
	persistRAGRetrievalBaselineGatePolicyHistory,
	persistRAGRetrievalReleaseLaneEscalationPolicyHistory,
	persistRAGRetrievalReleaseIncident,
	persistRAGSearchTracePruneRun,
	pruneRAGSearchTraceStore,
	persistRAGSearchTraceRecord,
	summarizeRAGSearchTraceStore
} from './quality';
import {
	buildRAGUpsertInputFromDocuments,
	buildRAGUpsertInputFromUploads,
	buildRAGUpsertInputFromURLs
} from './ingestion';
import { createHeuristicRAGQueryTransform } from './queryTransforms';
import { createHeuristicRAGReranker } from './reranking';
import { buildRAGContext } from './types';

const DEFAULT_PATH = '/rag';
const DEFAULT_TOP_K = 6;
const DEFAULT_PREFIX_LEN = 12;
const DEFAULT_PROVIDER = 'anthropic';
const TITLE_MAX_LENGTH = 80;
const MAX_INGEST_JOBS = 20;
const MAX_ADMIN_ACTIONS = 20;
const MAX_ADMIN_JOBS = 20;
const DEFAULT_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7;

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' } as const;

const defaultParseProvider = (content: string) => {
	const colonIdx = content.indexOf(':');
	const hasPrefix = colonIdx > 0 && colonIdx < DEFAULT_PREFIX_LEN;

	return {
		content: hasPrefix ? content.slice(colonIdx + 1) : content,
		model: undefined,
		providerName: hasPrefix ? content.slice(0, colonIdx) : DEFAULT_PROVIDER
	};
};

const normalizeScore = (value: number) => (Number.isFinite(value) ? value : 0);

const isHTMXRequest = (request: Request) =>
	request.headers.get('HX-Request') === 'true';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const getStringProperty = (value: unknown, key: string) => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	return typeof value[key] === 'string' ? value[key] : undefined;
};

const getObjectProperty = (value: unknown, key: string) => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	return isObjectRecord(value[key]) ? value[key] : undefined;
};

const getNumberProperty = (value: unknown, key: string) => {
	const candidate = isObjectRecord(value) ? value[key] : undefined;

	return typeof candidate === 'number' ? candidate : undefined;
};

const getIntegerLikeProperty = (value: unknown, key: string) => {
	const candidate = isObjectRecord(value) ? value[key] : undefined;

	if (typeof candidate === 'number' && Number.isFinite(candidate)) {
		return candidate;
	}

	if (typeof candidate !== 'string') {
		return undefined;
	}

	const parsed = Number(candidate);

	return Number.isFinite(parsed) ? parsed : undefined;
};

const isMetadataMap = (value: unknown): value is Record<string, unknown> =>
	isObjectRecord(value);

const markMaintenancePanelOutOfBand = (html: string) =>
	html.replace(
		'<div id="rag-status-maintenance-panel"',
		'<div id="rag-status-maintenance-panel" hx-swap-oob="outerHTML"'
	);

const normalizeStringArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((candidate) => typeof candidate === 'string')
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0);
};

const normalizeChunkingOptions = (value: unknown) =>
	isMetadataMap(value) ? value : undefined;

const parseRAGSearchTracePruneInput = (
	value: unknown
): RAGSearchTracePruneInput | null | undefined => {
	if (value === undefined) {
		return undefined;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	const pruneInput: RAGSearchTracePruneInput = {};

	const maxAgeMs = getIntegerLikeProperty(value, 'maxAgeMs');
	if (getOwnProperty(value, 'maxAgeMs') && maxAgeMs === undefined) {
		return null;
	}
	if (maxAgeMs !== undefined) {
		pruneInput.maxAgeMs = maxAgeMs;
	}

	const maxRecordsPerQuery = getIntegerLikeProperty(
		value,
		'maxRecordsPerQuery'
	);
	if (
		getOwnProperty(value, 'maxRecordsPerQuery') &&
		maxRecordsPerQuery === undefined
	) {
		return null;
	}
	if (maxRecordsPerQuery !== undefined) {
		pruneInput.maxRecordsPerQuery = maxRecordsPerQuery;
	}

	const maxRecordsPerGroup = getIntegerLikeProperty(
		value,
		'maxRecordsPerGroup'
	);
	if (
		getOwnProperty(value, 'maxRecordsPerGroup') &&
		maxRecordsPerGroup === undefined
	) {
		return null;
	}
	if (maxRecordsPerGroup !== undefined) {
		pruneInput.maxRecordsPerGroup = maxRecordsPerGroup;
	}

	const now = getIntegerLikeProperty(value, 'now');
	if (getOwnProperty(value, 'now') && now === undefined) {
		return null;
	}
	if (now !== undefined) {
		pruneInput.now = now;
	}

	const tag = getStringProperty(value, 'tag');
	if (getOwnProperty(value, 'tag') && tag === undefined) {
		return null;
	}
	if (tag) {
		pruneInput.tag = tag;
	}

	return pruneInput;
};

const getOwnProperty = (value: unknown, key: string) =>
	isObjectRecord(value)
		? Object.prototype.hasOwnProperty.call(value, key)
		: false;

const parseRetrievalMode = (
	value: unknown
): 'vector' | 'lexical' | 'hybrid' | null => {
	if (value === 'vector' || value === 'lexical' || value === 'hybrid') {
		return value;
	}

	return null;
};

const parseRAGRetrieval = (value: unknown) => {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value === 'string') {
		return parseRetrievalMode(value);
	}

	if (!isMetadataMap(value)) {
		return null;
	}

	const allowedFields = new Set([
		'mode',
		'candidateTopK',
		'lexicalTopK',
		'maxResultsPerSource',
		'sourceBalanceStrategy',
		'diversityStrategy',
		'mmrLambda',
		'fusion',
		'fusionConstant',
		'lexicalWeight',
		'vectorWeight',
		'nativeQueryProfile',
		'nativeCandidateLimit',
		'nativeMaxBackfills',
		'nativeMinResults',
		'nativeFillPolicy'
	]);
	for (const key of Object.keys(value)) {
		if (!allowedFields.has(key)) {
			return null;
		}
	}

	const retrieval: Record<string, unknown> = {};

	if (getOwnProperty(value, 'mode')) {
		if (typeof value.mode === 'undefined') {
			return null;
		}

		retrieval.mode = parseRetrievalMode(value.mode);
		if (retrieval.mode === null) {
			return null;
		}
	}

	if (getOwnProperty(value, 'lexicalTopK')) {
		if (typeof value.lexicalTopK !== 'number') {
			return null;
		}
		retrieval.lexicalTopK = value.lexicalTopK;
	}

	if (getOwnProperty(value, 'maxResultsPerSource')) {
		if (typeof value.maxResultsPerSource !== 'number') {
			return null;
		}
		retrieval.maxResultsPerSource = value.maxResultsPerSource;
	}

	if (getOwnProperty(value, 'candidateTopK')) {
		if (typeof value.candidateTopK !== 'number') {
			return null;
		}
		retrieval.candidateTopK = value.candidateTopK;
	}

	if (getOwnProperty(value, 'sourceBalanceStrategy')) {
		if (
			value.sourceBalanceStrategy !== 'cap' &&
			value.sourceBalanceStrategy !== 'round_robin'
		) {
			return null;
		}
		retrieval.sourceBalanceStrategy = value.sourceBalanceStrategy;
	}

	if (getOwnProperty(value, 'diversityStrategy')) {
		if (
			value.diversityStrategy !== 'none' &&
			value.diversityStrategy !== 'mmr'
		) {
			return null;
		}
		retrieval.diversityStrategy = value.diversityStrategy;
	}

	if (getOwnProperty(value, 'mmrLambda')) {
		if (typeof value.mmrLambda !== 'number') {
			return null;
		}
		retrieval.mmrLambda = value.mmrLambda;
	}

	if (getOwnProperty(value, 'fusion')) {
		if (value.fusion !== 'rrf' && value.fusion !== 'max') {
			return null;
		}
		retrieval.fusion = value.fusion;
	}

	if (getOwnProperty(value, 'fusionConstant')) {
		if (typeof value.fusionConstant !== 'number') {
			return null;
		}
		retrieval.fusionConstant = value.fusionConstant;
	}

	if (getOwnProperty(value, 'lexicalWeight')) {
		if (typeof value.lexicalWeight !== 'number') {
			return null;
		}
		retrieval.lexicalWeight = value.lexicalWeight;
	}

	if (getOwnProperty(value, 'vectorWeight')) {
		if (typeof value.vectorWeight !== 'number') {
			return null;
		}
		retrieval.vectorWeight = value.vectorWeight;
	}

	if (getOwnProperty(value, 'nativeQueryProfile')) {
		if (
			value.nativeQueryProfile !== 'latency' &&
			value.nativeQueryProfile !== 'balanced' &&
			value.nativeQueryProfile !== 'recall'
		) {
			return null;
		}
		retrieval.nativeQueryProfile =
			value.nativeQueryProfile as RAGCollectionSearchParams['nativeQueryProfile'];
	}

	if (getOwnProperty(value, 'nativeCandidateLimit')) {
		if (typeof value.nativeCandidateLimit !== 'number') {
			return null;
		}
		retrieval.nativeCandidateLimit = value.nativeCandidateLimit;
	}

	if (getOwnProperty(value, 'nativeMaxBackfills')) {
		if (typeof value.nativeMaxBackfills !== 'number') {
			return null;
		}
		retrieval.nativeMaxBackfills = value.nativeMaxBackfills;
	}

	if (getOwnProperty(value, 'nativeMinResults')) {
		if (typeof value.nativeMinResults !== 'number') {
			return null;
		}
		retrieval.nativeMinResults = value.nativeMinResults;
	}

	if (getOwnProperty(value, 'nativeFillPolicy')) {
		if (
			value.nativeFillPolicy !== 'strict_topk' &&
			value.nativeFillPolicy !== 'satisfy_min_results'
		) {
			return null;
		}
		retrieval.nativeFillPolicy =
			value.nativeFillPolicy as RAGCollectionSearchParams['nativeFillPolicy'];
	}

	return retrieval as RAGCollectionSearchParams['retrieval'];
};

const getNumericStatus = (status: unknown) =>
	typeof status === 'number' ? status : HTTP_STATUS_OK;

const classifyGovernanceReasons = (
	reasons?: string[]
): 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue' => {
	const normalized = (reasons ?? []).map((reason) => reason.toLowerCase());
	if (normalized.some((reason) => reason.includes('multivector'))) {
		return 'multivector';
	}
	if (
		normalized.some(
			(reason) =>
				reason.includes('runtime ') ||
				reason.includes('planner') ||
				reason.includes('candidate-budget-exhausted') ||
				reason.includes('underfilled-topk')
		)
	) {
		return 'runtime';
	}
	if (
		normalized.some(
			(reason) =>
				reason.includes('presentation title') ||
				reason.includes('presentation body') ||
				reason.includes('presentation notes') ||
				reason.includes('spreadsheet sheet') ||
				reason.includes('spreadsheet table') ||
				reason.includes('spreadsheet column')
		)
	) {
		return 'cue';
	}
	if (
		normalized.some(
			(reason) =>
				reason.includes('evidence reconcile') ||
				reason.includes('office structure') ||
				reason.includes('office narrative') ||
				reason.includes('office checklist') ||
				reason.includes('office table') ||
				reason.includes('pdf native') ||
				reason.includes('hybrid evidence') ||
				reason.includes('ocr supplement')
		)
	) {
		return 'evidence';
	}
	return 'general';
};

const buildRegressionRemediationLabel = (
	classification: 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue',
	reasons?: string[]
) =>
	classification === 'multivector'
		? 'Inspect multivector coverage deltas, variant-hit traces, and collapsed-parent recovery before promotion.'
		: classification === 'cue'
			? (() => {
					const normalized = (reasons ?? []).map((reason) =>
						reason.toLowerCase()
					);
					if (
						normalized.some(
							(reason) =>
								reason.includes('presentation title') ||
								reason.includes('slide title')
						)
					) {
						return 'Inspect repeated-title slide selection, title-local evidence weighting, and slide-ordinal provenance before promotion.';
					}
					if (
						normalized.some(
							(reason) =>
								reason.includes('presentation body') ||
								reason.includes('slide body')
						)
					) {
						return 'Inspect presentation body weighting, repeated-title slide body selection, and slide-local narrative provenance before promotion.';
					}
					if (
						normalized.some(
							(reason) =>
								reason.includes('presentation notes') ||
								reason.includes('speaker notes')
						)
					) {
						return 'Inspect presentation notes weighting, repeated-title slide note selection, and notes-local provenance before promotion.';
					}
					if (
						normalized.some((reason) =>
							reason.includes('spreadsheet sheet')
						)
					) {
						return 'Inspect workbook sheet selection, sheet-local spreadsheet evidence weighting, and repeated-sheet lineage before promotion.';
					}
					if (
						normalized.some((reason) =>
							reason.includes('spreadsheet table')
						)
					) {
						return 'Inspect spreadsheet table-family selection, repeated-table lineage, and table-local workbook evidence before promotion.';
					}
					if (
						normalized.some((reason) =>
							reason.includes('spreadsheet column')
						)
					) {
						return 'Inspect spreadsheet column-span weighting, shifted-column table selection, and column-local workbook provenance before promotion.';
					}
					return 'Inspect presentation and spreadsheet cue weighting, repeated-title/lineage selection, and cue-local provenance before promotion.';
				})()
			: classification === 'evidence'
				? (() => {
						const normalized = (reasons ?? []).map((reason) =>
							reason.toLowerCase()
						);
						if (
							normalized.some(
								(reason) =>
									reason.includes('office narrative') ||
									reason.includes('paragraph') ||
									reason.includes('review notes')
							)
						) {
							return 'Inspect office narrative scope reconciliation, repeated review-note branch selection, and paragraph-local evidence provenance before promotion.';
						}
						if (
							normalized.some(
								(reason) =>
									reason.includes('office checklist') ||
									reason.includes('checklist')
							)
						) {
							return 'Inspect office checklist scope reconciliation, repeated checklist branch selection, and list-local evidence provenance before promotion.';
						}
						if (
							normalized.some(
								(reason) =>
									reason.includes('office table') ||
									reason.includes('owner table') ||
									reason.includes('evidence table')
							)
						) {
							return 'Inspect office table scope reconciliation, repeated table-family selection, and table-local evidence provenance before promotion.';
						}
						if (
							normalized.some(
								(reason) =>
									reason.includes('office structure') ||
									reason.includes('office evidence')
							)
						) {
							return 'Inspect office-structure scope reconciliation, repeated-section checklist and table selection, and office evidence provenance before promotion.';
						}
						if (
							normalized.some(
								(reason) =>
									reason.includes('pdf native') ||
									reason.includes('hybrid evidence') ||
									reason.includes('ocr supplement')
							)
						) {
							return 'Inspect hybrid evidence reconciliation, native-vs-OCR passage selection, and PDF evidence provenance before promotion.';
						}
						return 'Inspect office-structure scope reconciliation, repeated-section office evidence, hybrid native-vs-OCR passage selection, and PDF evidence provenance before promotion.';
					})()
				: classification === 'runtime'
					? 'Inspect planner-profile shifts, candidate-budget exhaustion, and underfilled native retrieval before promotion.'
					: 'Inspect the latest retrieval comparison deltas and resolve the gate failure before promotion.';

const summarizeIncidentClassifications = (
	incidents?: RAGRetrievalReleaseIncidentRecord[]
): RAGRetrievalIncidentClassificationSummary => {
	const allIncidents = incidents ?? [];
	const countBy = (
		status: RAGRetrievalReleaseIncidentRecord['status'],
		classification:
			| 'general'
			| 'multivector'
			| 'runtime'
			| 'evidence'
			| 'cue'
	) =>
		allIncidents.filter(
			(entry) =>
				entry.status === status &&
				(entry.classification ?? 'general') === classification
		).length;
	return {
		openGeneralCount: countBy('open', 'general'),
		openMultiVectorCount: countBy('open', 'multivector'),
		openRuntimeCount: countBy('open', 'runtime'),
		openEvidenceCount: countBy('open', 'evidence'),
		openCueCount: countBy('open', 'cue'),
		resolvedGeneralCount: countBy('resolved', 'general'),
		resolvedMultiVectorCount: countBy('resolved', 'multivector'),
		resolvedRuntimeCount: countBy('resolved', 'runtime'),
		resolvedEvidenceCount: countBy('resolved', 'evidence'),
		resolvedCueCount: countBy('resolved', 'cue'),
		totalGeneralCount: allIncidents.filter(
			(entry) => (entry.classification ?? 'general') === 'general'
		).length,
		totalMultiVectorCount: allIncidents.filter(
			(entry) => (entry.classification ?? 'general') === 'multivector'
		).length,
		totalRuntimeCount: allIncidents.filter(
			(entry) => (entry.classification ?? 'general') === 'runtime'
		).length,
		totalEvidenceCount: allIncidents.filter(
			(entry) => (entry.classification ?? 'general') === 'evidence'
		).length,
		totalCueCount: allIncidents.filter(
			(entry) => (entry.classification ?? 'general') === 'cue'
		).length
	};
};

const getBooleanProperty = (value: unknown, key: string) => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	return typeof value[key] === 'boolean' ? value[key] : undefined;
};

const isRAGDocumentChunk = (value: unknown): value is RAGDocumentChunk =>
	isObjectRecord(value) &&
	typeof value.chunkId === 'string' &&
	typeof value.text === 'string';

const isRAGDocument = (
	value: unknown
): value is RAGDocumentIngestInput['documents'][number] =>
	isObjectRecord(value) && typeof value.text === 'string';

const isRAGDocumentUrl = (
	value: unknown
): value is RAGDocumentUrlIngestInput['urls'][number] =>
	isObjectRecord(value) &&
	typeof value.url === 'string' &&
	value.url.trim().length > 0;

const isRAGDocumentArray = (
	value: unknown
): value is RAGDocumentIngestInput['documents'] =>
	Array.isArray(value) && value.every((entry) => isRAGDocument(entry));

const isRAGDocumentUpload = (
	value: unknown
): value is RAGDocumentUploadIngestInput['uploads'][number] =>
	isObjectRecord(value) &&
	typeof value.name === 'string' &&
	typeof value.content === 'string';

const isRAGDocumentUploadArray = (
	value: unknown
): value is RAGDocumentUploadIngestInput['uploads'] =>
	Array.isArray(value) && value.every((entry) => isRAGDocumentUpload(entry));

const isRAGDocumentUrlArray = (
	value: unknown
): value is RAGDocumentUrlIngestInput['urls'] =>
	Array.isArray(value) && value.every((entry) => isRAGDocumentUrl(entry));

const isRAGDocumentChunkArray = (value: unknown): value is RAGDocumentChunk[] =>
	Array.isArray(value) && value.every((entry) => isRAGDocumentChunk(entry));

const buildSources = (
	results: Array<{
		chunkId: string;
		corpusKey?: string;
		chunkText: string;
		score: number;
		title?: string;
		source?: string;
		metadata?: Record<string, unknown>;
	}>
) =>
	results.map((result) => ({
		chunkId: result.chunkId,
		corpusKey:
			result.corpusKey ??
			(typeof result.metadata?.corpusKey === 'string'
				? result.metadata.corpusKey
				: undefined),
		labels: buildRAGSourceLabels({
			metadata: result.metadata,
			source: result.source,
			title: result.title
		}),
		metadata: result.metadata,
		score: normalizeScore(result.score),
		source: result.source,
		structure: buildRAGChunkStructure(result.metadata),
		text: result.chunkText,
		title: result.title
	}));

const toAssistantTextBlock = (content: string) => [
	{ content, type: 'text' as const }
];

const resolveTools = (
	config: AIChatPluginConfig,
	providerName: string,
	model: string
) =>
	typeof config.tools === 'function'
		? config.tools(providerName, model)
		: config.tools;

const resolveThinking = (
	config: AIChatPluginConfig,
	providerName: string,
	model: string
) =>
	typeof config.thinking === 'function'
		? config.thinking(providerName, model)
		: config.thinking;

const resolveModel = (
	config: AIChatPluginConfig,
	parsed: { model?: string; providerName: string }
) => {
	if (parsed.model) {
		return parsed.model;
	}

	if (typeof config.model === 'string') {
		return config.model;
	}

	if (typeof config.model === 'function') {
		return config.model(parsed.providerName);
	}

	return parsed.providerName;
};

const buildHistory = (conversation: AIConversation) =>
	conversation.messages.map((msg) => ({
		content: msg.content,
		role: msg.role
	}));

const buildUserMessage = (
	content: string,
	attachments?: AIAttachment[],
	extraContext?: string
) => {
	if (attachments && attachments.length > 0) {
		const contextContent = extraContext
			? `${content}\n\n${extraContext}`
			: content;
		const attachmentsBlocks = attachments.map((att) => {
			if (att.media_type === 'application/pdf') {
				return {
					name: att.name,
					source: {
						data: att.data,
						media_type: att.media_type,
						type: 'base64' as const
					},
					type: 'document' as const
				};
			}

			return {
				source: {
					data: att.data,
					media_type: att.media_type,
					type: 'base64' as const
				},
				type: 'image' as const
			};
		});

		return {
			content: [
				...attachmentsBlocks,
				...toAssistantTextBlock(contextContent)
			],
			role: 'user' as const
		};
	}

	return {
		content: extraContext ? `${content}\n\n${extraContext}` : content,
		role: 'user' as const
	};
};

const branchConversation = (source: AIConversation, fromMessageId: string) => {
	const cutoffIndex = source.messages.findIndex(
		(msg) => msg.id === fromMessageId
	);
	if (cutoffIndex < 0) {
		return null;
	}

	const newId = generateId();
	const branchedMessages = source.messages
		.slice(0, cutoffIndex + 1)
		.map((msg) => ({ ...msg, conversationId: newId }));

	const branchedConversation: AIConversation = {
		createdAt: Date.now(),
		id: newId,
		messages: branchedMessages
	};

	return branchedConversation;
};

type RAGQueryContext = {
	ragContext: string;
	sources: RAGSource[];
	trace?: RAGRetrievalTrace;
};

const persistSearchTraceIfConfigured = async (input: {
	store?: RAGChatPluginConfig['searchTraceStore'];
	retention?: RAGChatPluginConfig['searchTraceRetention'];
	onPrune?: (input?: RAGSearchTracePruneInput) => Promise<unknown>;
	trace?: RAGRetrievalTrace;
	results?: Array<{
		chunkId: string;
		score: number;
		source?: string;
		title?: string;
		metadata?: Record<string, unknown>;
	}>;
	label?: string;
	groupKey?: string;
	tags?: string[];
	startedAt?: number;
	finishedAt?: number;
	metadata?: Record<string, unknown>;
}) => {
	if (!input.store || !input.trace) {
		return;
	}

	const record = buildRAGSearchTraceRecord({
		finishedAt: input.finishedAt,
		groupKey: input.groupKey,
		label: input.label,
		metadata: input.metadata,
		results: input.results,
		startedAt: input.startedAt,
		tags: input.tags,
		trace: input.trace
	});

	await persistRAGSearchTraceRecord({
		record,
		store: input.store
	});

	if (input.retention) {
		await input.onPrune?.(input.retention);
	}
};

const buildRAGContextFromQuery = async (
	config: Pick<
		RAGChatPluginConfig,
		| 'collection'
		| 'ragStore'
		| 'embedding'
		| 'embeddingModel'
		| 'rerank'
		| 'searchTraceStore'
		| 'searchTraceRetention'
	>,
	topK: number,
	scoreThreshold: number | undefined,
	queryText: string,
	ragModel: string,
	embedding: RAGChatPluginConfig['embedding'] | undefined,
	embeddingModel: string | undefined
): Promise<RAGQueryContext> => {
	const collection =
		config.collection ??
		(config.ragStore
			? createRAGCollection({
					defaultModel: embeddingModel ?? ragModel,
					defaultTopK: topK,
					embedding,
					rerank: config.rerank,
					store: config.ragStore
				})
			: null);

	if (!collection) {
		return {
			ragContext: '',
			sources: []
		};
	}

	const queried = await collection.searchWithTrace({
		model: embeddingModel ?? ragModel,
		query: queryText,
		scoreThreshold,
		topK
	});
	const sources = buildSources(queried.results);
	await persistSearchTraceIfConfigured({
		finishedAt: Date.now(),
		groupKey: 'workflow',
		label: queryText,
		results: queried.results,
		startedAt: undefined,
		store: config.searchTraceStore,
		retention: config.searchTraceRetention,
		tags: ['workflow'],
		trace: queried.trace
	});

	return {
		ragContext: buildRAGContext(queried.results),
		sources,
		trace: queried.trace
	};
};

export const ragChat = (config: RAGChatPluginConfig) => {
	const path = config.path ?? DEFAULT_PATH;
	const authorizeRAGAction = config.authorizeRAGAction;
	const resolveRAGAccessScope = config.resolveRAGAccessScope;
	const topK = config.topK ?? DEFAULT_TOP_K;
	const { scoreThreshold } = config;
	const { extractors } = config;
	const ragStore = config.ragStore ?? config.collection?.store;
	const parseProvider = config.parseProvider ?? defaultParseProvider;
	const store: AIConversationStore = config.store ?? createMemoryStore();
	const abortControllers = new Map<string, AbortController>();
	const includeCompleteSources = config.ragCompleteSources === true;
	const staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
	const { indexManager } = config;
	const ingestJobs: RAGIngestJobRecord[] = [];
	const adminActions: RAGAdminActionRecord[] = [];
	const adminJobs: RAGAdminJobRecord[] = [];
	const syncJobs: RAGAdminJobRecord[] = [];
	const { jobStateStore } = config;
	const jobHistoryRetention = {
		maxAdminActions:
			config.jobHistoryRetention?.maxAdminActions ?? MAX_ADMIN_ACTIONS,
		maxAdminJobs:
			config.jobHistoryRetention?.maxAdminJobs ?? MAX_ADMIN_JOBS,
		maxIngestJobs:
			config.jobHistoryRetention?.maxIngestJobs ?? MAX_INGEST_JOBS,
		maxSyncJobs: config.jobHistoryRetention?.maxSyncJobs ?? MAX_ADMIN_JOBS
	};
	const { searchTraceStore } = config;
	const { searchTraceRetention } = config;
	const { searchTraceRetentionSchedule } = config;
	const { searchTracePruneHistoryStore } = config;
	const { retrievalComparisonHistoryStore } = config;
	const { retrievalBaselineStore } = config;
	const { retrievalReleasePolicies } = config;
	const { retrievalReleasePoliciesByRolloutLabel } = config;
	const { retrievalReleasePoliciesByGroupAndRolloutLabel } = config;
	const { retrievalBaselineGatePoliciesByGroup } = config;
	const { retrievalBaselineGatePoliciesByRolloutLabel } = config;
	const { retrievalBaselineGatePoliciesByGroupAndRolloutLabel } = config;
	const workflowRenderConfig =
		typeof config.htmx === 'object'
			? (config.htmx.workflowRender ?? config.htmx.workflow?.render)
			: undefined;
	const workflowRenderers = resolveRAGWorkflowRenderers(workflowRenderConfig);
	const searchTraceRuntime: RAGSearchTraceRetentionRuntime = {
		configured: Boolean(searchTraceStore),
		retention: searchTraceRetention,
		schedule: searchTraceRetentionSchedule
	};
	let jobStateLoaded = false;
	let jobStateLoadPromise: Promise<void> | undefined;

	const normalizeAuthorizationDecision = (
		decision: RAGAuthorizationDecision | undefined
	) =>
		typeof decision === 'boolean'
			? { allowed: decision }
			: (decision ?? { allowed: true });

	const checkAuthorization = async (
		request: Request,
		action: RAGAuthorizedAction,
		resource?: RAGAuthorizationResource
	): Promise<{ allowed: boolean; reason?: string }> => {
		if (!authorizeRAGAction) {
			return { allowed: true };
		}

		return normalizeAuthorizationDecision(
			await authorizeRAGAction({
				action,
				request,
				resource
			})
		);
	};

	const isAuthorized = async (
		request: Request,
		action: RAGAuthorizedAction,
		resource?: RAGAuthorizationResource
	) => (await checkAuthorization(request, action, resource)).allowed;

	const buildAuthorizationFailure = (
		decision: Awaited<ReturnType<typeof checkAuthorization>>,
		fallback = 'Forbidden'
	): RAGMutationResponse => ({
		error: decision.reason ?? fallback,
		ok: false
	});

	const isAccessScopeError = (error: string | undefined) =>
		typeof error === 'string' &&
		(error.includes('allowed RAG access scope') ||
			error.includes('Scoped sync-all is not allowed'));

	const authorizeMutationRoute = async (
		request: Request,
		action: RAGAuthorizedAction,
		input: {
			fallback: string;
			resource?: RAGAuthorizationResource;
		}
	) => {
		const decision = await checkAuthorization(
			request,
			action,
			input.resource
		);
		return decision.allowed
			? null
			: buildAuthorizationFailure(decision, input.fallback);
	};

	const normalizeAccessScope = (
		scope: RAGAccessScope | undefined
	): RAGAccessScope | undefined => {
		if (!scope) {
			return undefined;
		}

		const normalizeStringArray = (values?: string[]) => {
			const next = (values ?? [])
				.map((value) => value.trim())
				.filter((value) => value.length > 0);
			return next.length > 0 ? [...new Set(next)] : undefined;
		};

		const requiredMetadata =
			scope.requiredMetadata &&
			Object.keys(scope.requiredMetadata).length > 0
				? scope.requiredMetadata
				: undefined;

		return {
			allowedComparisonGroupKeys: normalizeStringArray(
				scope.allowedComparisonGroupKeys
			),
			allowedCorpusGroupKeys: normalizeStringArray(
				scope.allowedCorpusGroupKeys
			),
			allowedCorpusKeys: normalizeStringArray(scope.allowedCorpusKeys),
			allowedDocumentIds: normalizeStringArray(scope.allowedDocumentIds),
			allowedSourcePrefixes: normalizeStringArray(
				scope.allowedSourcePrefixes
			),
			allowedSources: normalizeStringArray(scope.allowedSources),
			allowedSyncSourceIds: normalizeStringArray(
				scope.allowedSyncSourceIds
			),
			requiredMetadata
		};
	};

	const loadAccessScope = async (request?: Request) =>
		request && resolveRAGAccessScope
			? normalizeAccessScope(await resolveRAGAccessScope(request))
			: undefined;

	const matchesRequiredMetadata = (
		requiredMetadata: Record<string, unknown> | undefined,
		metadata: Record<string, unknown> | undefined
	) => {
		if (!requiredMetadata) {
			return true;
		}

		return Object.entries(requiredMetadata).every(
			([key, value]) => metadata?.[key] === value
		);
	};

	const matchesAccessScope = (
		scope: RAGAccessScope | undefined,
		input: {
			corpusKey?: string;
			documentId?: string;
			metadata?: Record<string, unknown>;
			source?: string;
		}
	) => {
		if (!scope) {
			return true;
		}

		const corpusKey =
			input.corpusKey ??
			(typeof input.metadata?.corpusKey === 'string'
				? input.metadata.corpusKey
				: undefined);

		if (
			scope.allowedCorpusKeys?.length &&
			(!corpusKey || !scope.allowedCorpusKeys.includes(corpusKey))
		) {
			return false;
		}

		if (
			scope.allowedDocumentIds?.length &&
			(!input.documentId ||
				!scope.allowedDocumentIds.includes(input.documentId))
		) {
			return false;
		}

		if (
			scope.allowedSources?.length &&
			(!input.source || !scope.allowedSources.includes(input.source))
		) {
			return false;
		}

		if (
			scope.allowedSourcePrefixes?.length &&
			(!input.source ||
				!scope.allowedSourcePrefixes.some((prefix) =>
					(input.source ?? '').startsWith(prefix)
				))
		) {
			return false;
		}

		return matchesRequiredMetadata(scope.requiredMetadata, input.metadata);
	};

	const matchesSyncSourceScope = (
		scope: RAGAccessScope | undefined,
		source: { id: string }
	) =>
		!scope?.allowedSyncSourceIds?.length ||
		scope.allowedSyncSourceIds.includes(source.id);

	const deriveCorpusGroupKey = (input: {
		corpusGroupKey?: string;
		corpusKeys?: string[];
	}) => {
		const explicitCorpusGroupKey = input.corpusGroupKey?.trim();
		if (explicitCorpusGroupKey) {
			return explicitCorpusGroupKey;
		}

		const normalizedCorpusKeys = [
			...new Set(
				(input.corpusKeys ?? [])
					.map((value) => value.trim())
					.filter((value) => value.length > 0)
			)
		].sort((left, right) => left.localeCompare(right));

		if (normalizedCorpusKeys.length === 0) {
			return undefined;
		}
		if (normalizedCorpusKeys.length === 1) {
			return normalizedCorpusKeys[0];
		}

		return normalizedCorpusKeys.join('+');
	};

	const isAllowedCorpusGroupKey = (
		scope: RAGAccessScope | undefined,
		corpusGroupKey?: string
	) =>
		!scope?.allowedCorpusGroupKeys?.length ||
		(typeof corpusGroupKey === 'string' &&
			scope.allowedCorpusGroupKeys.includes(corpusGroupKey));

	const isAllowedComparisonGroupKey = (
		scope: RAGAccessScope | undefined,
		groupKey?: string
	) =>
		!scope?.allowedComparisonGroupKeys?.length ||
		(typeof groupKey === 'string' &&
			scope.allowedComparisonGroupKeys.includes(groupKey));

	const filterByComparisonGroupKey = <T extends { groupKey?: string }>(
		scope: RAGAccessScope | undefined,
		records: T[]
	) =>
		scope?.allowedComparisonGroupKeys?.length
			? records.filter((record) =>
					isAllowedComparisonGroupKey(scope, record.groupKey)
				)
			: records;

	const filterByCorpusGroupKey = <T extends { corpusGroupKey?: string }>(
		scope: RAGAccessScope | undefined,
		records: T[]
	) =>
		scope?.allowedCorpusGroupKeys?.length
			? records.filter((record) =>
					isAllowedCorpusGroupKey(scope, record.corpusGroupKey)
				)
			: records;

	const persistJobStateIfConfigured = async () => {
		if (!jobStateStore) {
			return;
		}

		await jobStateStore.save({
			adminActions: adminActions.slice(
				0,
				Math.max(0, jobHistoryRetention.maxAdminActions)
			),
			adminJobs: adminJobs.slice(
				0,
				Math.max(0, jobHistoryRetention.maxAdminJobs)
			),
			ingestJobs: ingestJobs.slice(
				0,
				Math.max(0, jobHistoryRetention.maxIngestJobs)
			),
			syncJobs: syncJobs.slice(
				0,
				Math.max(0, jobHistoryRetention.maxSyncJobs)
			)
		});
	};

	const recoverIngestJob = (
		job: RAGIngestJobRecord,
		recoveredAt: number
	): RAGIngestJobRecord =>
		job.status === 'running'
			? {
					...job,
					elapsedMs: Math.max(0, recoveredAt - job.startedAt),
					error:
						job.error ??
						'Interrupted before completion during recovery',
					finishedAt: recoveredAt,
					status: 'failed'
				}
			: job;

	const recoverAdminJob = (
		job: RAGAdminJobRecord,
		recoveredAt: number
	): RAGAdminJobRecord =>
		job.status === 'running'
			? {
					...job,
					elapsedMs: Math.max(0, recoveredAt - job.startedAt),
					error:
						job.error ??
						'Interrupted before completion during recovery',
					finishedAt: recoveredAt,
					status: 'failed'
				}
			: job;

	const ensureJobStateLoaded = async () => {
		if (jobStateLoaded) {
			return;
		}
		if (jobStateLoadPromise) {
			await jobStateLoadPromise;
			return;
		}

		jobStateLoadPromise = (async () => {
			if (!jobStateStore) {
				jobStateLoaded = true;
				return;
			}

			const loaded = await jobStateStore.load();
			const recoveredAt = Date.now();
			const nextIngestJobs = (loaded?.ingestJobs ?? [])
				.map((job) => recoverIngestJob(job, recoveredAt))
				.slice(0, Math.max(0, jobHistoryRetention.maxIngestJobs));
			const nextAdminActions = (loaded?.adminActions ?? []).slice(
				0,
				Math.max(0, jobHistoryRetention.maxAdminActions)
			);
			const nextAdminJobs = (loaded?.adminJobs ?? [])
				.map((job) => recoverAdminJob(job, recoveredAt))
				.slice(0, Math.max(0, jobHistoryRetention.maxAdminJobs));
			const nextSyncJobs = (loaded?.syncJobs ?? [])
				.map((job) => recoverAdminJob(job, recoveredAt))
				.slice(0, Math.max(0, jobHistoryRetention.maxSyncJobs));
			adminActions.splice(0, adminActions.length, ...nextAdminActions);
			ingestJobs.splice(0, ingestJobs.length, ...nextIngestJobs);
			adminJobs.splice(0, adminJobs.length, ...nextAdminJobs);
			syncJobs.splice(0, syncJobs.length, ...nextSyncJobs);
			jobStateLoaded = true;
			await persistJobStateIfConfigured();
		})();

		try {
			await jobStateLoadPromise;
		} finally {
			jobStateLoadPromise = undefined;
		}
	};

	const createIngestJob = (
		inputKind: RAGIngestJobRecord['inputKind'],
		requestedCount: number
	) => {
		const job: RAGIngestJobRecord = {
			id: generateId(),
			inputKind,
			requestedCount,
			startedAt: Date.now(),
			status: 'running'
		};
		ingestJobs.unshift(job);
		if (ingestJobs.length > jobHistoryRetention.maxIngestJobs) {
			ingestJobs.length = jobHistoryRetention.maxIngestJobs;
		}
		void persistJobStateIfConfigured();

		return job;
	};

	const completeIngestJob = (
		job: RAGIngestJobRecord,
		input: {
			chunkCount?: number;
			documentCount?: number;
			extractorNames?: string[];
		}
	) => {
		const finishedAt = Date.now();
		job.status = 'completed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		job.chunkCount = input.chunkCount;
		job.documentCount = input.documentCount;
		job.extractorNames = input.extractorNames;
		void persistJobStateIfConfigured();
	};

	const failIngestJob = (
		job: RAGIngestJobRecord,
		error: string,
		extractorNames?: string[]
	) => {
		const finishedAt = Date.now();
		job.status = 'failed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		job.error = error;
		job.extractorNames = extractorNames;
		void persistJobStateIfConfigured();
	};

	const createAdminAction = (
		action: RAGAdminActionRecord['action'],
		documentId?: string,
		target?: string
	) => {
		const record: RAGAdminActionRecord = {
			action,
			documentId,
			id: generateId(),
			startedAt: Date.now(),
			status: 'completed',
			target
		};
		adminActions.unshift(record);
		if (adminActions.length > jobHistoryRetention.maxAdminActions) {
			adminActions.length = jobHistoryRetention.maxAdminActions;
		}
		void persistJobStateIfConfigured();

		return record;
	};

	const createAdminJob = (
		action: RAGAdminJobRecord['action'],
		target?: string,
		bucket: RAGAdminJobRecord[] = adminJobs
	) => {
		const job: RAGAdminJobRecord = {
			action,
			id: generateId(),
			startedAt: Date.now(),
			status: 'running',
			target
		};
		bucket.unshift(job);
		const maxJobs =
			bucket === syncJobs
				? jobHistoryRetention.maxSyncJobs
				: jobHistoryRetention.maxAdminJobs;
		if (bucket.length > maxJobs) {
			bucket.length = maxJobs;
		}
		void persistJobStateIfConfigured();

		return job;
	};

	const completeAdminAction = (record: RAGAdminActionRecord) => {
		const finishedAt = Date.now();
		record.status = 'completed';
		record.finishedAt = finishedAt;
		record.elapsedMs = finishedAt - record.startedAt;
		void persistJobStateIfConfigured();
	};

	const failAdminAction = (record: RAGAdminActionRecord, error: string) => {
		const finishedAt = Date.now();
		record.status = 'failed';
		record.finishedAt = finishedAt;
		record.elapsedMs = finishedAt - record.startedAt;
		record.error = error;
		void persistJobStateIfConfigured();
	};

	const completeAdminJob = (job: RAGAdminJobRecord) => {
		const finishedAt = Date.now();
		job.status = 'completed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		void persistJobStateIfConfigured();
	};

	const failAdminJob = (job: RAGAdminJobRecord, error: string) => {
		const finishedAt = Date.now();
		job.status = 'failed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		job.error = error;
		void persistJobStateIfConfigured();
	};

	const runSearchTracePrune = async (
		input?: RAGSearchTracePruneInput,
		trigger: RAGSearchTracePruneRun['trigger'] = 'manual'
	) => {
		await ensureJobStateLoaded();
		if (!searchTraceStore) {
			throw new Error('RAG search trace store is not configured');
		}

		const effectiveInput = input ?? searchTraceRetention;
		const job = createAdminJob('prune_search_traces');
		const action = createAdminAction('prune_search_traces');
		searchTraceRuntime.running = true;
		searchTraceRuntime.lastStartedAt = job.startedAt;

		try {
			const statsBefore = await summarizeRAGSearchTraceStore({
				store: searchTraceStore,
				tag: effectiveInput?.tag
			});
			const result = await pruneRAGSearchTraceStore({
				input: effectiveInput,
				store: searchTraceStore
			});
			const stats = await summarizeRAGSearchTraceStore({
				store: searchTraceStore,
				tag: effectiveInput?.tag
			});

			completeAdminJob(job);
			completeAdminAction(action);
			searchTraceRuntime.lastError = undefined;
			searchTraceRuntime.lastFinishedAt = job.finishedAt;
			searchTraceRuntime.lastResult = result;
			searchTraceRuntime.running = false;
			searchTraceRuntime.stats = stats;
			searchTraceRuntime.totalRuns =
				(searchTraceRuntime.totalRuns ?? 0) + 1;
			if (searchTraceRetentionSchedule?.intervalMs) {
				searchTraceRuntime.nextScheduledAt =
					Date.now() + searchTraceRetentionSchedule.intervalMs;
			}
			const run: RAGSearchTracePruneRun = {
				elapsedMs: job.elapsedMs ?? 0,
				finishedAt: job.finishedAt ?? Date.now(),
				id: generateId(),
				input: effectiveInput,
				result,
				startedAt: job.startedAt,
				statsAfter: stats,
				statsBefore,
				trigger
			};
			if (searchTracePruneHistoryStore) {
				await persistRAGSearchTracePruneRun({
					run,
					store: searchTracePruneHistoryStore
				});
				searchTraceRuntime.recentRuns =
					await loadRAGSearchTracePruneHistory({
						limit: 5,
						store: searchTracePruneHistoryStore
					});
			}

			return { result, stats };
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Search trace prune failed';
			failAdminJob(job, message);
			failAdminAction(action, message);
			searchTraceRuntime.lastError = message;
			searchTraceRuntime.lastFinishedAt = job.finishedAt;
			searchTraceRuntime.running = false;
			searchTraceRuntime.totalRuns =
				(searchTraceRuntime.totalRuns ?? 0) + 1;
			if (searchTraceRetentionSchedule?.intervalMs) {
				searchTraceRuntime.nextScheduledAt =
					Date.now() + searchTraceRetentionSchedule.intervalMs;
			}
			const run: RAGSearchTracePruneRun = {
				elapsedMs: job.elapsedMs ?? 0,
				error: message,
				finishedAt: job.finishedAt ?? Date.now(),
				id: generateId(),
				input: effectiveInput,
				startedAt: job.startedAt,
				trigger
			};
			if (searchTracePruneHistoryStore) {
				await persistRAGSearchTracePruneRun({
					run,
					store: searchTracePruneHistoryStore
				});
				searchTraceRuntime.recentRuns =
					await loadRAGSearchTracePruneHistory({
						limit: 5,
						store: searchTracePruneHistoryStore
					});
			}

			throw error;
		}
	};

	const buildSyncSources = async (scope?: RAGAccessScope) => {
		if (!indexManager?.listSyncSources) {
			return [];
		}

		const sources = await indexManager.listSyncSources();
		return sources.filter((source) =>
			matchesSyncSourceScope(scope, source)
		);
	};

	const toHTMXResponse = (
		html: string,
		status?: number,
		extraHeaders?: Record<string, string>
	) =>
		new Response(html, {
			headers: {
				...HTML_HEADERS,
				...extraHeaders
			},
			status: typeof status === 'number' ? status : HTTP_STATUS_OK
		});

	const appendMessage = (
		conversation: AIConversation,
		message: AIMessage
	) => {
		conversation.messages.push(message);
		conversation.lastMessageAt = Date.now();

		if (!conversation.title && message.role === 'user') {
			conversation.title = message.content.slice(0, TITLE_MAX_LENGTH);
		}
	};

	const appendAssistantMessage = async (
		conversationId: string,
		messageId: string,
		content: string,
		sources: RAGSource[],
		usage?: AIUsage,
		model?: string,
		retrievalStartedAt?: number,
		retrievedAt?: number,
		retrievalDurationMs?: number,
		retrievalTrace?: RAGRetrievalTrace
	) => {
		const conv = await store.get(conversationId);
		if (!conv) {
			return;
		}

		appendMessage(conv, {
			content,
			conversationId,
			id: messageId,
			model,
			role: 'assistant',
			retrievalDurationMs,
			retrievalStartedAt,
			retrievalTrace,
			retrievedAt,
			sources,
			timestamp: Date.now(),
			usage
		});

		await store.set(conversationId, conv);
	};

	const handleCancel = (conversationId: string) => {
		const controller = abortControllers.get(conversationId);

		if (controller) {
			controller.abort();
			abortControllers.delete(conversationId);
		}
	};

	const handleBranch = async (
		ws: { send: (data: string) => void },
		messageId: string,
		conversationId: string
	) => {
		const source = await store.get(conversationId);
		if (!source) {
			return;
		}

		const branched = branchConversation(source, messageId);
		if (!branched) {
			return;
		}

		await store.set(branched.id, branched);
		ws.send(
			JSON.stringify({
				conversationId: branched.id,
				type: 'branched'
			})
		);
	};

	const handleRAGRetrieved = (
		ws: { send: (data: string) => void },
		conversationId: string,
		messageId: string,
		sources: RAGSource[],
		retrievalStartedAt: number,
		retrievedAt: number,
		retrievalDurationMs: number,
		trace?: RAGRetrievalTrace
	) => {
		ws.send(
			JSON.stringify({
				conversationId,
				messageId,
				retrievalDurationMs: retrievedAt - retrievalStartedAt,
				retrievalStartedAt,
				retrievedAt,
				sources,
				trace,
				type: 'rag_retrieved'
			})
		);
	};

	const handleRAGRetrieving = (
		ws: { send: (data: string) => void },
		conversationId: string,
		messageId: string,
		retrievalStartedAt: number
	) => {
		ws.send(
			JSON.stringify({
				conversationId,
				messageId,
				retrievalStartedAt,
				type: 'rag_retrieving'
			})
		);
	};

	const handleMessage = async (
		ws: { readyState: number; send: (data: string) => void },
		rawContent: string,
		rawConversationId?: string,
		rawAttachments?: AIAttachment[]
	) => {
		const parsed = parseProvider(rawContent);
		const { content, providerName } = parsed;
		const userMessageId = generateId();
		const assistantMessageId = generateId();
		const conversationId = rawConversationId ?? generateId();
		const conversation = await store.getOrCreate(conversationId);
		const history = buildHistory(conversation);
		const model = resolveModel(config, parsed);
		const ragModel = parsed.model ?? model;

		appendMessage(conversation, {
			attachments: rawAttachments,
			content,
			conversationId,
			id: userMessageId,
			role: 'user',
			timestamp: Date.now()
		});
		await store.set(conversationId, conversation);

		const retrievalStartedAt = Date.now();
		handleRAGRetrieving(
			ws,
			conversationId,
			assistantMessageId,
			retrievalStartedAt
		);
		const provider = config.provider(providerName);
		const rag = await buildRAGContextFromQuery(
			config,
			topK,
			scoreThreshold,
			content,
			ragModel,
			config.embedding,
			config.embeddingModel
		);

		const controller = new AbortController();
		abortControllers.set(conversationId, controller);
		const { ragContext, sources, trace } = rag;
		const retrievedAt = Date.now();
		const retrievalDurationMs = retrievedAt - retrievalStartedAt;

		handleRAGRetrieved(
			ws,
			conversationId,
			assistantMessageId,
			sources,
			retrievalStartedAt,
			retrievedAt,
			retrievalDurationMs,
			trace
		);

		await streamAI(ws, conversationId, assistantMessageId, {
			completeMeta: includeCompleteSources ? { sources } : undefined,
			maxTurns: config.maxTurns,
			messages: [
				...history,
				buildUserMessage(content, rawAttachments, ragContext)
			],
			model,
			provider,
			signal: controller.signal,
			systemPrompt: config.systemPrompt,
			thinking: resolveThinking(config, providerName, model),
			tools: resolveTools(config, providerName, model),
			onComplete: async (fullResponse, usage) => {
				await appendAssistantMessage(
					conversationId,
					assistantMessageId,
					fullResponse,
					sources,
					usage,
					model,
					retrievalStartedAt,
					retrievedAt,
					retrievalDurationMs,
					trace
				);

				abortControllers.delete(conversationId);
				config.onComplete?.(
					conversationId,
					fullResponse,
					usage,
					sources
				);
			}
		});
	};

	const resolveCollection = () =>
		config.collection ??
		(ragStore
			? createRAGCollection({
					defaultModel: config.embeddingModel,
					defaultTopK: topK,
					embedding: config.embedding,
					rerank: config.rerank,
					store: ragStore
				})
			: null);

	const toRAGEvaluationInput = (body: unknown) => {
		if (!isObjectRecord(body) || !Array.isArray(body.cases)) {
			return null;
		}

		const parsedCases = body.cases
			.map(
				(
					candidate,
					caseIndex
				): RAGEvaluationInput['cases'][number] | null => {
					if (!isObjectRecord(candidate)) {
						return null;
					}

					const query =
						getStringProperty(candidate, 'query')?.trim() ?? '';
					if (!query) {
						return null;
					}

					const caseMetadata = isObjectRecord(candidate.metadata)
						? candidate.metadata
						: undefined;
					const expectedChunkIds = normalizeStringArray(
						candidate.expectedChunkIds
					);
					const expectedSources = normalizeStringArray(
						candidate.expectedSources
					);
					const expectedDocumentIds = normalizeStringArray(
						candidate.expectedDocumentIds
					);
					if (
						expectedChunkIds.length === 0 &&
						expectedSources.length === 0 &&
						expectedDocumentIds.length === 0
					) {
						return null;
					}

					const caseFilter = getObjectProperty(candidate, 'filter');
					if (caseFilter && !isMetadataMap(caseFilter)) {
						return null;
					}

					const hasCaseRetrieval = getOwnProperty(
						candidate,
						'retrieval'
					);
					const parsedCaseRetrieval = parseRAGRetrieval(
						(candidate as { retrieval?: unknown }).retrieval
					);

					if (hasCaseRetrieval && parsedCaseRetrieval === null) {
						return null;
					}

					return {
						corpusKey:
							getStringProperty(candidate, 'corpusKey') ??
							undefined,
						filter: caseFilter,
						id:
							getStringProperty(candidate, 'id') ??
							`case-${caseIndex + 1}`,
						retrieval:
							parsedCaseRetrieval === undefined ||
							parsedCaseRetrieval === null
								? undefined
								: parsedCaseRetrieval,
						label:
							getStringProperty(candidate, 'label') ?? undefined,
						expectedChunkIds,
						expectedDocumentIds,
						expectedSources,
						metadata: caseMetadata,
						model: getStringProperty(candidate, 'model'),
						query,
						scoreThreshold:
							typeof candidate.scoreThreshold === 'number'
								? candidate.scoreThreshold
								: undefined,
						topK:
							typeof candidate.topK === 'number'
								? candidate.topK
								: undefined
					};
				}
			)
			.filter(
				(value): value is RAGEvaluationInput['cases'][number] =>
					value !== null
			);

		if (parsedCases.length === 0) {
			return null;
		}

		const globalFilter = getObjectProperty(body, 'filter');
		if (globalFilter && !isMetadataMap(globalFilter)) {
			return null;
		}
		const hasGlobalRetrieval = getOwnProperty(body, 'retrieval');
		const globalRetrievalRaw = parseRAGRetrieval(
			(body as { retrieval?: unknown }).retrieval
		);
		if (hasGlobalRetrieval && globalRetrievalRaw === null) {
			return null;
		}
		const globalRetrieval =
			globalRetrievalRaw === undefined || globalRetrievalRaw === null
				? undefined
				: globalRetrievalRaw;

		return {
			cases: parsedCases,
			retrieval: globalRetrieval,
			topK:
				typeof getNumberProperty(body, 'topK') === 'number'
					? getNumberProperty(body, 'topK')
					: undefined,
			dryRun:
				body.dryRun === true
					? true
					: body.dryRun === false
						? false
						: undefined,
			filter: globalFilter,
			model: getStringProperty(body, 'model'),
			scoreThreshold:
				typeof getNumberProperty(body, 'scoreThreshold') === 'number'
					? getNumberProperty(body, 'scoreThreshold')
					: undefined
		} satisfies RAGEvaluationInput;
	};

	const handleEvaluate = async (
		body: unknown,
		request?: Request
	): Promise<
		| {
				error: string;
				ok: false;
		  }
		| ({
				ok: true;
		  } & RAGEvaluationResponse)
	> => {
		const input = toRAGEvaluationInput(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { cases: [{ id, query, expectedChunkIds|expectedSources|expectedDocumentIds }] }',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		for (const evaluationCase of input.cases) {
			if (
				(evaluationCase.corpusKey &&
					!matchesAccessScope(accessScope, {
						corpusKey: evaluationCase.corpusKey
					})) ||
				(evaluationCase.expectedDocumentIds ?? []).some(
					(documentId) =>
						!matchesAccessScope(accessScope, { documentId })
				) ||
				(evaluationCase.expectedSources ?? []).some(
					(source) => !matchesAccessScope(accessScope, { source })
				)
			) {
				return {
					error: 'Evaluation case is outside the allowed RAG access scope',
					ok: false
				};
			}
		}

		const collection = resolveCollection();
		if (!collection) {
			return {
				error: 'RAG collection is not configured',
				ok: false
			};
		}

		return evaluateRAGCollection({
			collection,
			defaultTopK: topK,
			input
		});
	};

	const toRAGRetrievalComparisonRequest = (
		body: unknown
	): RAGRetrievalComparisonRequest | null => {
		const input = toRAGEvaluationInput(body);
		if (
			!input ||
			!isObjectRecord(body) ||
			!Array.isArray(body.retrievals)
		) {
			return null;
		}

		const retrievals = body.retrievals
			.map((candidate, index) => {
				if (!isObjectRecord(candidate)) {
					return null;
				}

				const id =
					getStringProperty(candidate, 'id') ??
					`retrieval-${index + 1}`;
				const label = getStringProperty(candidate, 'label');
				const hasRetrieval = getOwnProperty(candidate, 'retrieval');
				const parsedRetrieval = parseRAGRetrieval(
					(candidate as { retrieval?: unknown }).retrieval
				);

				if (hasRetrieval && parsedRetrieval === null) {
					return null;
				}

				return {
					id,
					label,
					retrieval:
						parsedRetrieval === undefined ||
						parsedRetrieval === null
							? undefined
							: parsedRetrieval
				};
			})
			.filter((value) => value !== null);

		if (
			retrievals.length === 0 ||
			retrievals.length !== body.retrievals.length
		) {
			return null;
		}

		return {
			...input,
			baselineRetrievalId: getStringProperty(body, 'baselineRetrievalId'),
			candidateRetrievalId: getStringProperty(
				body,
				'candidateRetrievalId'
			),
			corpusGroupKey: getStringProperty(body, 'corpusGroupKey'),
			groupKey: getStringProperty(body, 'groupKey'),
			label: getStringProperty(body, 'label'),
			persistRun: getBooleanProperty(body, 'persistRun') === true,
			suiteId: getStringProperty(body, 'suiteId'),
			tags: normalizeStringArray((body as { tags?: unknown }).tags),
			retrievals
		};
	};

	const toRAGRetrievalBaselinePromotionRequest = (
		body: unknown
	): RAGRetrievalBaselinePromotionRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const groupKey = getStringProperty(body, 'groupKey');
		const retrievalId = getStringProperty(body, 'retrievalId');
		if (!groupKey || !retrievalId) {
			return null;
		}

		return {
			corpusGroupKey: getStringProperty(body, 'corpusGroupKey'),
			groupKey,
			approvedAt: getIntegerLikeProperty(body, 'approvedAt'),
			approvedBy: getStringProperty(body, 'approvedBy'),
			approvalNotes: getStringProperty(body, 'approvalNotes'),
			label: getStringProperty(body, 'label'),
			metadata: getObjectProperty(body, 'metadata'),
			policy: getObjectProperty(body, 'policy') as
				| RAGRetrievalBaselinePromotionRequest['policy']
				| undefined,
			retrievalId,
			rolloutLabel: (() => {
				const value = getStringProperty(body, 'rolloutLabel');
				return value === 'canary' ||
					value === 'stable' ||
					value === 'rollback_target'
					? value
					: undefined;
			})(),
			sourceRunId: getStringProperty(body, 'sourceRunId'),
			suiteId: getStringProperty(body, 'suiteId'),
			suiteLabel: getStringProperty(body, 'suiteLabel'),
			tags: normalizeStringArray((body as { tags?: unknown }).tags)
		};
	};

	const toRAGRetrievalBaselinePromotionFromRunRequest = (
		body: unknown
	): RAGRetrievalBaselinePromotionFromRunRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const groupKey = getStringProperty(body, 'groupKey');
		const sourceRunId = getStringProperty(body, 'sourceRunId');
		if (!groupKey || !sourceRunId) {
			return null;
		}

		return {
			corpusGroupKey: getStringProperty(body, 'corpusGroupKey'),
			groupKey,
			overrideGate: getBooleanProperty(body, 'overrideGate') === true,
			overrideReason: getStringProperty(body, 'overrideReason'),
			sourceRunId,
			approvedAt: getIntegerLikeProperty(body, 'approvedAt'),
			approvedBy: getStringProperty(body, 'approvedBy'),
			approvalNotes: getStringProperty(body, 'approvalNotes'),
			metadata: getObjectProperty(body, 'metadata'),
			policy: getObjectProperty(body, 'policy') as
				| RAGRetrievalBaselinePromotionFromRunRequest['policy']
				| undefined,
			retrievalId: getStringProperty(body, 'retrievalId'),
			rolloutLabel: (() => {
				const value = getStringProperty(body, 'rolloutLabel');
				return value === 'canary' ||
					value === 'stable' ||
					value === 'rollback_target'
					? value
					: undefined;
			})()
		};
	};

	const toRAGRetrievalBaselineRevertRequest = (
		body: unknown
	): RAGRetrievalBaselineRevertRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const groupKey = getStringProperty(body, 'groupKey');
		if (!groupKey) {
			return null;
		}

		const version = getIntegerLikeProperty(body, 'version');
		const baselineId = getStringProperty(body, 'baselineId');
		if (typeof version !== 'number' && !baselineId) {
			return null;
		}

		return {
			corpusGroupKey: getStringProperty(body, 'corpusGroupKey'),
			groupKey,
			approvedAt: getIntegerLikeProperty(body, 'approvedAt'),
			approvedBy: getStringProperty(body, 'approvedBy'),
			approvalNotes: getStringProperty(body, 'approvalNotes'),
			baselineId,
			metadata: getObjectProperty(body, 'metadata'),
			version
		};
	};

	const toRAGRetrievalReleaseDecisionActionRequest = (
		body: unknown
	): RAGRetrievalReleaseDecisionActionRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const groupKey = getStringProperty(body, 'groupKey');
		const sourceRunId = getStringProperty(body, 'sourceRunId');
		if (!groupKey || !sourceRunId) {
			return null;
		}

		return {
			decidedBy: getStringProperty(body, 'decidedBy'),
			decidedAt: getIntegerLikeProperty(body, 'decidedAt'),
			groupKey,
			notes: getStringProperty(body, 'notes'),
			overrideGate: getBooleanProperty(body, 'overrideGate') === true,
			overrideReason: getStringProperty(body, 'overrideReason'),
			targetRolloutLabel: (() => {
				const value = getStringProperty(body, 'targetRolloutLabel');
				return value === 'canary' ||
					value === 'stable' ||
					value === 'rollback_target'
					? value
					: undefined;
			})(),
			retrievalId: getStringProperty(body, 'retrievalId'),
			sourceRunId
		};
	};

	const toRAGRetrievalLaneHandoffDecisionRequest = (
		body: unknown
	): RAGRetrievalLaneHandoffDecisionRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const groupKey = getStringProperty(body, 'groupKey');
		const sourceRolloutLabel = getStringProperty(
			body,
			'sourceRolloutLabel'
		);
		const targetRolloutLabel = getStringProperty(
			body,
			'targetRolloutLabel'
		);
		const kind = getStringProperty(body, 'kind');
		if (
			!groupKey ||
			(sourceRolloutLabel !== 'canary' &&
				sourceRolloutLabel !== 'stable' &&
				sourceRolloutLabel !== 'rollback_target') ||
			(targetRolloutLabel !== 'canary' &&
				targetRolloutLabel !== 'stable' &&
				targetRolloutLabel !== 'rollback_target') ||
			(kind !== 'approve' && kind !== 'reject' && kind !== 'complete')
		) {
			return null;
		}

		return {
			candidateRetrievalId: getStringProperty(
				body,
				'candidateRetrievalId'
			),
			corpusGroupKey: getStringProperty(body, 'corpusGroupKey'),
			decidedAt: getIntegerLikeProperty(body, 'decidedAt'),
			decidedBy: getStringProperty(body, 'decidedBy'),
			executePromotion:
				getBooleanProperty(body, 'executePromotion') === true,
			groupKey,
			kind,
			notes: getStringProperty(body, 'notes'),
			sourceRolloutLabel,
			sourceRunId: getStringProperty(body, 'sourceRunId'),
			targetRolloutLabel
		};
	};

	const toRAGRetrievalReleaseIncidentAcknowledgeRequest = (body: unknown) => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const incidentId = getStringProperty(body, 'incidentId');
		if (!incidentId) {
			return null;
		}

		return {
			acknowledgedAt: getIntegerLikeProperty(body, 'acknowledgedAt'),
			acknowledgedBy: getStringProperty(body, 'acknowledgedBy'),
			acknowledgementNotes: getStringProperty(
				body,
				'acknowledgementNotes'
			),
			incidentId
		};
	};

	const toRAGRetrievalReleaseIncidentUnacknowledgeRequest = (
		body: unknown
	) => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const incidentId = getStringProperty(body, 'incidentId');
		if (!incidentId) {
			return null;
		}

		return { incidentId };
	};

	const toRAGRetrievalReleaseIncidentResolveRequest = (body: unknown) => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const incidentId = getStringProperty(body, 'incidentId');
		if (!incidentId) {
			return null;
		}

		return {
			incidentId,
			resolvedAt: getIntegerLikeProperty(body, 'resolvedAt'),
			resolvedBy: getStringProperty(body, 'resolvedBy'),
			resolutionNotes: getStringProperty(body, 'resolutionNotes')
		};
	};

	const toRAGRemediationAction = (value: unknown) => {
		if (!isObjectRecord(value)) {
			return undefined;
		}
		const kind = getStringProperty(value, 'kind');
		const label = getStringProperty(value, 'label');
		const method = getStringProperty(value, 'method');
		const routePath = getStringProperty(value, 'path');
		if (
			!kind ||
			!label ||
			(method !== 'GET' && method !== 'POST') ||
			!routePath
		) {
			return undefined;
		}
		return {
			kind,
			label,
			method,
			path: routePath,
			payload: getObjectProperty(value, 'payload')
		} as RAGRemediationAction;
	};

	const toRAGRetrievalIncidentRemediationDecisionRequest = (
		body: unknown
	): RAGRetrievalIncidentRemediationDecisionRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}

		const incidentId = getStringProperty(body, 'incidentId');
		const remediationKind = getStringProperty(body, 'remediationKind');
		const status = getStringProperty(body, 'status');
		if (
			!incidentId ||
			(remediationKind !== 'renew_approval' &&
				remediationKind !== 'record_approval' &&
				remediationKind !== 'inspect_gate' &&
				remediationKind !== 'rerun_comparison' &&
				remediationKind !== 'restore_source_lane' &&
				remediationKind !== 'review_readiness' &&
				remediationKind !== 'monitor_lane') ||
			(status !== undefined &&
				status !== 'planned' &&
				status !== 'applied' &&
				status !== 'dismissed')
		) {
			return null;
		}

		return {
			action: toRAGRemediationAction(getObjectProperty(body, 'action')),
			decidedAt: getIntegerLikeProperty(body, 'decidedAt'),
			decidedBy: getStringProperty(body, 'decidedBy'),
			incidentId,
			notes: getStringProperty(body, 'notes'),
			remediationKind,
			status:
				(status as RAGRetrievalIncidentRemediationDecisionRecord['status']) ??
				undefined
		};
	};

	const toRAGRetrievalIncidentRemediationExecutionRequest = (
		body: unknown
	): RAGRetrievalIncidentRemediationExecutionRequest | null => {
		if (!isObjectRecord(body)) {
			return null;
		}
		const action = toRAGRemediationAction(
			getObjectProperty(body, 'action')
		);
		if (!action) {
			return null;
		}
		const remediationKind = getStringProperty(body, 'remediationKind');
		return {
			action,
			decidedAt: getIntegerLikeProperty(body, 'decidedAt'),
			decidedBy: getStringProperty(body, 'decidedBy'),
			incidentId: getStringProperty(body, 'incidentId'),
			idempotencyKey: getStringProperty(body, 'idempotencyKey'),
			notes: getStringProperty(body, 'notes'),
			persistDecision: getBooleanProperty(body, 'persistDecision'),
			remediationKind:
				remediationKind === 'renew_approval' ||
				remediationKind === 'record_approval' ||
				remediationKind === 'inspect_gate' ||
				remediationKind === 'rerun_comparison' ||
				remediationKind === 'restore_source_lane' ||
				remediationKind === 'review_readiness' ||
				remediationKind === 'monitor_lane'
					? remediationKind
					: undefined
		};
	};

	const toRAGRetrievalIncidentRemediationBulkExecutionRequest = (
		body: unknown
	): RAGRetrievalIncidentRemediationBulkExecutionRequest | null => {
		if (!isObjectRecord(body) || !Array.isArray(body.items)) {
			return null;
		}
		const items = body.items
			.map((entry) =>
				toRAGRetrievalIncidentRemediationExecutionRequest(entry)
			)
			.filter(
				(
					entry
				): entry is RAGRetrievalIncidentRemediationExecutionRequest =>
					Boolean(entry)
			);
		if (items.length !== body.items.length) {
			return null;
		}
		return {
			allowMutationExecution:
				getBooleanProperty(body, 'allowMutationExecution') === true,
			items,
			stopOnError: getBooleanProperty(body, 'stopOnError') === true
		};
	};

	const buildRemediationStepActions = (input: {
		candidateRetrievalId?: string;
		groupKey?: string;
		incident?: Pick<
			RAGRetrievalReleaseIncidentRecord,
			'id' | 'status' | 'groupKey' | 'targetRolloutLabel'
		>;
		sourceRunId?: string;
		stepKind: RAGRemediationStep['kind'];
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	}): RAGRemediationAction[] => {
		const actions: RAGRemediationAction[] = [];
		const push = (action: RAGRemediationAction | undefined) => {
			if (!action) {
				return;
			}
			if (
				actions.some(
					(entry) =>
						entry.kind === action.kind &&
						entry.method === action.method &&
						entry.path === action.path &&
						JSON.stringify(entry.payload ?? null) ===
							JSON.stringify(action.payload ?? null)
				)
			) {
				return;
			}
			actions.push(action);
		};
		const approvePayload =
			input.groupKey &&
			input.candidateRetrievalId &&
			input.sourceRunId &&
			input.targetRolloutLabel
				? {
						candidateRetrievalId: input.candidateRetrievalId,
						groupKey: input.groupKey,
						sourceRunId: input.sourceRunId,
						targetRolloutLabel: input.targetRolloutLabel
					}
				: undefined;
		const incidentLifecycleActions = () => {
			if (!input.incident || input.incident.status !== 'open') {
				return;
			}
			push({
				kind: 'acknowledge_incident',
				label: 'Acknowledge this release incident.',
				method: 'POST',
				path: `${path}/compare/retrieval/incidents/acknowledge`,
				payload: { incidentId: input.incident.id }
			});
			push({
				kind: 'resolve_incident',
				label: 'Resolve this release incident.',
				method: 'POST',
				path: `${path}/compare/retrieval/incidents/resolve`,
				payload: { incidentId: input.incident.id }
			});
		};
		switch (input.stepKind) {
			case 'renew_approval':
			case 'record_approval':
				if (approvePayload) {
					push({
						kind: 'approve_candidate',
						label: 'Record or renew approval for this candidate.',
						method: 'POST',
						path: `${path}/compare/retrieval/baselines/approve`,
						payload: approvePayload
					});
				}
				push({
					kind: 'view_release_status',
					label: 'Inspect release readiness before deciding.',
					method: 'GET',
					path: `${path}/status/release`
				});
				break;
			case 'inspect_gate':
				push({
					kind: 'view_release_drift',
					label: 'Inspect release drift and gate blockers.',
					method: 'GET',
					path: `${path}/status/release/drift`
				});
				push({
					kind: 'view_release_status',
					label: 'Inspect the current release lane state.',
					method: 'GET',
					path: `${path}/status/release`
				});
				break;
			case 'rerun_comparison':
				push({
					kind: 'view_release_status',
					label: 'Inspect release state before re-running comparison.',
					method: 'GET',
					path: `${path}/status/release`
				});
				break;
			case 'restore_source_lane':
				push({
					kind: 'view_handoffs',
					label: 'Inspect handoff posture and source-lane state.',
					method: 'GET',
					path: `${path}/status/handoffs`
				});
				break;
			case 'review_readiness':
			case 'monitor_lane':
				push({
					kind: 'view_release_status',
					label: 'Inspect the current release lane state.',
					method: 'GET',
					path: `${path}/status/release`
				});
				break;
		}
		incidentLifecycleActions();
		return actions;
	};

	const buildRemediationExecutionFollowUpSteps = (input: {
		actionKind: RAGRemediationAction['kind'];
		incident?: RAGRetrievalReleaseIncidentRecord;
	}): RAGRemediationStep[] => {
		const step = (
			kind: RAGRemediationStep['kind'],
			label: string
		): RAGRemediationStep => ({
			actions: buildRemediationStepActions({
				candidateRetrievalId: input.incident?.candidateRetrievalId,
				groupKey: input.incident?.groupKey,
				incident: input.incident
					? {
							groupKey: input.incident.groupKey,
							id: input.incident.id,
							status: input.incident.status,
							targetRolloutLabel:
								input.incident.targetRolloutLabel
						}
					: undefined,
				sourceRunId: input.incident?.sourceRunId,
				stepKind: kind,
				targetRolloutLabel: input.incident?.targetRolloutLabel
			}),
			kind,
			label
		});
		switch (input.actionKind) {
			case 'approve_candidate':
				return [
					step(
						'monitor_lane',
						'Monitor the active lane and verify post-promotion behavior.'
					)
				];
			case 'acknowledge_incident':
				return [
					step(
						'inspect_gate',
						'Inspect the latest release or gate state before resolving the incident.'
					)
				];
			case 'resolve_incident':
				return [
					step(
						'monitor_lane',
						'Monitor the lane after incident resolution to confirm the issue stays contained.'
					)
				];
			case 'view_release_status':
				return [
					step(
						'review_readiness',
						'Review the current release readiness and decide on the next operator action.'
					)
				];
			case 'view_release_drift':
				return [
					step(
						'inspect_gate',
						'Inspect drift and gate blockers, then decide whether to rerun comparison or renew approval.'
					)
				];
			case 'view_handoffs':
				return [
					step(
						'restore_source_lane',
						'Review source-lane posture and handoff readiness before continuing.'
					)
				];
		}
	};

	const inferRemediationExecutionCodeFromAction = (
		actionKind: RAGRemediationAction['kind']
	): RAGRetrievalIncidentRemediationExecutionCode =>
		actionKind === 'approve_candidate'
			? 'approval_recorded'
			: actionKind === 'acknowledge_incident'
				? 'incident_acknowledged'
				: actionKind === 'resolve_incident'
					? 'incident_resolved'
					: actionKind === 'view_release_status'
						? 'release_status_loaded'
						: actionKind === 'view_release_drift'
							? 'release_drift_loaded'
							: 'handoff_status_loaded';

	const persistIncidentRemediationExecutionHistory = async ({
		action,
		blockedByGuardrail,
		bulkExecutionId,
		bulkIndex,
		code,
		error,
		guardrailKind,
		idempotencyKey,
		idempotentReplay,
		incident,
		mutationSkipped,
		ok,
		remediationKind
	}: {
		action: RAGRemediationAction;
		blockedByGuardrail?: boolean;
		bulkExecutionId?: string;
		bulkIndex?: number;
		code: RAGRetrievalIncidentRemediationExecutionCode;
		error?: string;
		guardrailKind?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['guardrailKind'];
		idempotencyKey?: string;
		idempotentReplay?: boolean;
		incident?: RAGRetrievalReleaseIncidentRecord;
		mutationSkipped?: boolean;
		ok: boolean;
		remediationKind?: RAGRemediationStep['kind'];
	}) => {
		if (!config.retrievalIncidentRemediationExecutionHistoryStore) {
			return;
		}

		await persistRAGRetrievalIncidentRemediationExecutionHistory({
			record: {
				action,
				blockedByGuardrail,
				bulkExecutionId,
				bulkIndex,
				code,
				error,
				executedAt: Date.now(),
				groupKey: incident?.groupKey,
				guardrailKind,
				id: generateId(),
				idempotencyKey,
				idempotentReplay,
				incidentId: incident?.id,
				incidentKind: incident?.kind,
				mutationSkipped,
				ok,
				remediationKind,
				targetRolloutLabel: incident?.targetRolloutLabel
			},
			store: config.retrievalIncidentRemediationExecutionHistoryStore
		});
	};

	const buildIncidentRemediationExecutionSummary = (
		records:
			| RAGRetrievalIncidentRemediationExecutionHistoryRecord[]
			| undefined
	): RAGRetrievalIncidentRemediationExecutionSummary | undefined => {
		if (!records || records.length === 0) {
			return undefined;
		}

		const replayCount = records.filter(
			(entry) => entry.idempotentReplay
		).length;
		const guardrailBlockedCount = records.filter(
			(entry) => entry.blockedByGuardrail
		).length;
		const mutationSkippedReplayCount = records.filter(
			(entry) => entry.idempotentReplay && entry.mutationSkipped
		).length;
		const totalCount = records.length;

		return {
			guardrailBlockedCount,
			guardrailBlockRate:
				totalCount > 0 ? guardrailBlockedCount / totalCount : 0,
			mutationSkippedReplayCount,
			recentGuardrailBlocks: records
				.filter((entry) => entry.blockedByGuardrail)
				.slice(0, 5),
			recentMutationSkippedReplays: records
				.filter(
					(entry) => entry.idempotentReplay && entry.mutationSkipped
				)
				.slice(0, 5),
			replayCount,
			replayRate: totalCount > 0 ? replayCount / totalCount : 0,
			totalCount
		};
	};

	const loadReleaseIncidentById = async (incidentId?: string) => {
		if (!incidentId || !config.retrievalReleaseIncidentStore) {
			return undefined;
		}

		const incidents = await loadRAGRetrievalReleaseIncidents({
			limit: 200,
			store: config.retrievalReleaseIncidentStore
		});
		return incidents.find((entry) => entry.id === incidentId);
	};

	const handleEvaluateRetrievals = async (
		body: unknown,
		request?: Request
	): Promise<RAGRetrievalComparisonResponse> => {
		const input = toRAGRetrievalComparisonRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { cases: [...], retrievals: [{ id, retrieval? }] }',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (!isAllowedComparisonGroupKey(accessScope, input.groupKey)) {
			return {
				error: 'Retrieval comparison group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, input.corpusGroupKey)) {
			return {
				error: 'Retrieval comparison corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		for (const evaluationCase of input.cases) {
			if (
				(evaluationCase.corpusKey &&
					!matchesAccessScope(accessScope, {
						corpusKey: evaluationCase.corpusKey
					})) ||
				(evaluationCase.expectedDocumentIds ?? []).some(
					(documentId) =>
						!matchesAccessScope(accessScope, { documentId })
				) ||
				(evaluationCase.expectedSources ?? []).some(
					(source) => !matchesAccessScope(accessScope, { source })
				)
			) {
				return {
					error: 'Retrieval comparison case is outside the allowed RAG access scope',
					ok: false
				};
			}
		}

		const collection = resolveCollection();
		if (!collection) {
			return {
				error: 'RAG collection is not configured',
				ok: false
			};
		}

		const activeBaseline =
			retrievalBaselineStore && input.groupKey
				? await Promise.resolve(
						retrievalBaselineStore.getBaseline?.(input.groupKey) ??
							loadRAGRetrievalBaselines({
								groupKey: input.groupKey,
								limit: 1,
								store: retrievalBaselineStore
							}).then((baselines) => baselines[0] ?? null)
					)
				: null;
		const baselineRetrievalId =
			input.baselineRetrievalId ?? activeBaseline?.retrievalId;
		const candidateRetrievalId =
			input.candidateRetrievalId ??
			input.retrievals.find((entry) => entry.id !== baselineRetrievalId)
				?.id;
		const startedAt = Date.now();
		const suiteId = input.suiteId ?? generateId();
		const suiteLabel = input.label ?? 'Retrieval comparison';
		const comparison = await compareRAGRetrievalStrategies({
			collection,
			defaultTopK: topK,
			retrievals: input.retrievals,
			suite: {
				id: suiteId,
				input: {
					cases: input.cases,
					dryRun: input.dryRun,
					filter: input.filter,
					model: input.model,
					retrieval: input.retrieval,
					scoreThreshold: input.scoreThreshold,
					topK: input.topK
				},
				label: suiteLabel
			}
		});
		const corpusGroupKey = deriveCorpusGroupKey({
			corpusGroupKey: input.corpusGroupKey,
			corpusKeys: comparison.corpusKeys
		});
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval comparison corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (corpusGroupKey) {
			comparison.corpusGroupKey = corpusGroupKey;
		}

		if (input.persistRun && retrievalComparisonHistoryStore) {
			const finishedAt = Date.now();
			const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
				baselineRetrievalId,
				candidateRetrievalId,
				comparison,
				policy: getEffectiveRetrievalBaselineGatePolicy({
					baselinePolicy: activeBaseline?.policy,
					groupKey: input.groupKey,
					rolloutLabel: activeBaseline?.rolloutLabel,
					suiteId
				})
			});
			await persistRAGRetrievalComparisonRun({
				run: {
					comparison,
					corpusGroupKey,
					corpusKeys: comparison.corpusKeys,
					decisionSummary,
					elapsedMs: finishedAt - startedAt,
					finishedAt,
					groupKey: input.groupKey,
					id: generateId(),
					label: suiteLabel,
					releaseVerdict: buildRAGRetrievalReleaseVerdict({
						decisionSummary,
						groupKey: input.groupKey
					}),
					startedAt,
					suiteId,
					suiteLabel,
					tags: input.tags
				},
				store: retrievalComparisonHistoryStore
			});
		}

		return {
			comparison,
			ok: true
		};
	};

	const handleRetrievalComparisonHistory = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalComparisonHistoryResponse> => {
		if (!retrievalComparisonHistoryStore) {
			return {
				error: 'RAG retrieval comparison history store is not configured',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval comparison group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval comparison corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const runs = await loadRAGRetrievalComparisonHistory({
			corpusGroupKey,
			groupKey,
			label: getStringProperty(queryInput, 'label'),
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			store: retrievalComparisonHistoryStore,
			suiteId: getStringProperty(queryInput, 'suiteId'),
			tag: getStringProperty(queryInput, 'tag'),
			winnerId: getStringProperty(queryInput, 'winnerId')
		});

		return {
			ok: true,
			runs: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, runs)
			)
		};
	};

	const handleRetrievalBaselineList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalBaselineListResponse> => {
		if (!retrievalBaselineStore) {
			return {
				error: 'RAG retrieval baseline store is not configured',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval baseline group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval baseline corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const baselines = await loadRAGRetrievalBaselines({
			corpusGroupKey,
			groupKey,
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			status:
				getStringProperty(queryInput, 'status') === 'active' ||
				getStringProperty(queryInput, 'status') === 'superseded'
					? (getStringProperty(queryInput, 'status') as
							| 'active'
							| 'superseded')
					: undefined,
			store: retrievalBaselineStore,
			tag: getStringProperty(queryInput, 'tag')
		});

		return {
			baselines: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, baselines)
			),
			ok: true
		};
	};

	const persistRetrievalReleaseDecisionIfConfigured = async (input: {
		baseline?: NonNullable<RAGRetrievalBaselineResponse['baseline']>;
		kind: 'approve' | 'promote' | 'reject' | 'revert';
		corpusGroupKey?: string;
		groupKey?: string;
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		retrievalId?: string;
		decidedBy?: string;
		decidedAt?: number;
		notes?: string;
		sourceRunId?: string;
		restoredFromBaselineId?: string;
		restoredFromVersion?: number;
		gateStatus?: 'pass' | 'warn' | 'fail';
		overrideGate?: boolean;
		overrideReason?: string;
	}) => {
		if (!config.retrievalReleaseDecisionStore) {
			return;
		}

		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: input.baseline?.id,
				corpusGroupKey:
					input.baseline?.corpusGroupKey ?? input.corpusGroupKey,
				decidedAt:
					input.baseline?.promotedAt ?? input.decidedAt ?? Date.now(),
				decidedBy: input.decidedBy,
				groupKey: input.baseline?.groupKey ?? input.groupKey!,
				id: generateId(),
				kind: input.kind,
				notes: input.notes,
				overrideGate: input.overrideGate,
				overrideReason: input.overrideReason,
				targetRolloutLabel:
					input.baseline?.rolloutLabel ?? input.targetRolloutLabel,
				restoredFromBaselineId: input.restoredFromBaselineId,
				restoredFromVersion: input.restoredFromVersion,
				gateStatus: input.gateStatus,
				retrievalId: input.baseline?.retrievalId ?? input.retrievalId!,
				sourceRunId: input.sourceRunId ?? input.baseline?.sourceRunId,
				version: input.baseline?.version
			},
			store: config.retrievalReleaseDecisionStore
		});
	};

	const getRetrievalReleasePolicy = (
		groupKey?: string,
		rolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel']
	) => ({
		...((groupKey ? retrievalReleasePolicies?.[groupKey] : undefined) ??
			{}),
		...((rolloutLabel
			? retrievalReleasePoliciesByRolloutLabel?.[rolloutLabel]
			: undefined) ?? {}),
		...((groupKey && rolloutLabel
			? retrievalReleasePoliciesByGroupAndRolloutLabel?.[groupKey]?.[
					rolloutLabel
				]
			: undefined) ?? {})
	});

	const getRetrievalLaneHandoffAutoCompletePolicy = (
		groupKey?: string,
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel']
	) =>
		(groupKey && targetRolloutLabel
			? config
					.retrievalLaneHandoffAutoCompletePoliciesByGroupAndTargetRolloutLabel?.[
					groupKey
				]?.[targetRolloutLabel]
			: undefined) ?? {};

	const getDefaultRetrievalBaselineGatePolicy = (
		groupKey?: string,
		rolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel']
	) => ({
		...((groupKey
			? retrievalBaselineGatePoliciesByGroup?.[groupKey]
			: undefined) ?? {}),
		...((rolloutLabel
			? retrievalBaselineGatePoliciesByRolloutLabel?.[rolloutLabel]
			: undefined) ?? {}),
		...((groupKey && rolloutLabel
			? retrievalBaselineGatePoliciesByGroupAndRolloutLabel?.[groupKey]?.[
					rolloutLabel
				]
			: undefined) ?? {})
	});

	const buildRuntimeRetrievalBenchmarkRecommendedGatePolicy =
		(): RAGRetrievalBaselineGatePolicy => ({
			minEvidenceReconcileCasesDelta: 0,
			minPresentationTitleCueCasesDelta: 0,
			minPresentationBodyCueCasesDelta: 0,
			minPresentationNotesCueCasesDelta: 0,
			minSpreadsheetSheetCueCasesDelta: 0,
			minSpreadsheetTableCueCasesDelta: 0,
			minSpreadsheetColumnCueCasesDelta: 0,
			maxRuntimeCandidateBudgetExhaustedCasesDelta: 0,
			maxRuntimeUnderfilledTopKCasesDelta: 0,
			minAverageF1Delta: 0,
			minPassingRateDelta: 0,
			severity: 'fail'
		});

	const getRecommendedBenchmarkBaselineGatePolicy = (input: {
		groupKey?: string;
		suiteId?: string;
	}) => {
		const adaptiveSuite = createRAGAdaptiveNativePlannerBenchmarkSuite();
		const backendSuite = createRAGNativeBackendComparisonBenchmarkSuite();
		const presentationSuite = createRAGPresentationCueBenchmarkSuite();
		const spreadsheetSuite = createRAGSpreadsheetCueBenchmarkSuite();
		if (
			input.groupKey ===
				(typeof adaptiveSuite.metadata?.recommendedGroupKey === 'string'
					? adaptiveSuite.metadata.recommendedGroupKey
					: undefined) ||
			input.suiteId === adaptiveSuite.id
		) {
			return buildRuntimeRetrievalBenchmarkRecommendedGatePolicy();
		}

		if (
			input.groupKey ===
				(typeof backendSuite.metadata?.recommendedGroupKey === 'string'
					? backendSuite.metadata.recommendedGroupKey
					: undefined) ||
			input.suiteId === backendSuite.id
		) {
			return buildRuntimeRetrievalBenchmarkRecommendedGatePolicy();
		}
		if (
			input.groupKey ===
				(typeof presentationSuite.metadata?.recommendedGroupKey ===
				'string'
					? presentationSuite.metadata.recommendedGroupKey
					: undefined) ||
			input.suiteId === presentationSuite.id
		) {
			return buildRuntimeRetrievalBenchmarkRecommendedGatePolicy();
		}
		if (
			input.groupKey ===
				(typeof spreadsheetSuite.metadata?.recommendedGroupKey ===
				'string'
					? spreadsheetSuite.metadata.recommendedGroupKey
					: undefined) ||
			input.suiteId === spreadsheetSuite.id
		) {
			return buildRuntimeRetrievalBenchmarkRecommendedGatePolicy();
		}

		return undefined;
	};

	const getEffectiveRetrievalBaselineGatePolicy = (input: {
		groupKey?: string;
		rolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		suiteId?: string;
		baselinePolicy?: RAGRetrievalBaselineGatePolicy;
	}) => {
		if (
			input.baselinePolicy &&
			Object.keys(input.baselinePolicy).length > 0
		) {
			return input.baselinePolicy;
		}

		const defaultPolicy = getDefaultRetrievalBaselineGatePolicy(
			input.groupKey,
			input.rolloutLabel
		);
		if (Object.keys(defaultPolicy).length > 0) {
			return defaultPolicy;
		}

		return getRecommendedBenchmarkBaselineGatePolicy({
			groupKey: input.groupKey,
			suiteId: input.suiteId
		});
	};

	const getRetrievalReleaseIncidentSeverity = (
		rolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel']
	): RAGRetrievalReleaseIncidentRecord['severity'] =>
		rolloutLabel === 'stable' ? 'critical' : 'warning';

	const getLatestLaneHandoffDecision = (input: {
		decisions?: RAGRetrievalLaneHandoffDecisionRecord[];
		groupKey: string;
		sourceRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['sourceRolloutLabel'];
		targetRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'];
		kind?: RAGRetrievalLaneHandoffDecisionRecord['kind'];
	}) =>
		input.decisions?.find(
			(entry) =>
				entry.groupKey === input.groupKey &&
				entry.sourceRolloutLabel === input.sourceRolloutLabel &&
				entry.targetRolloutLabel === input.targetRolloutLabel &&
				(!input.kind || entry.kind === input.kind)
		);

	const getLaneHandoffFreshnessWindow = (input: {
		handoff: NonNullable<
			NonNullable<
				RAGOperationsResponse['retrievalComparisons']
			>['releaseLaneHandoffs']
		>[number];
		decisions?: RAGRetrievalLaneHandoffDecisionRecord[];
		now?: number;
	}) => {
		const now = input.now ?? Date.now();
		const latestApprovedDecision = getLatestLaneHandoffDecision({
			decisions: input.decisions,
			groupKey: input.handoff.groupKey,
			kind: 'approve',
			sourceRolloutLabel: input.handoff.sourceRolloutLabel,
			targetRolloutLabel: input.handoff.targetRolloutLabel
		});
		const staleAfterMs =
			getRetrievalReleasePolicy(
				input.handoff.groupKey,
				input.handoff.targetRolloutLabel
			).approvalMaxAgeMs ?? DEFAULT_STALE_AFTER_MS;
		if (!latestApprovedDecision) {
			return {
				approvalAgeMs: undefined,
				candidateRetrievalId: input.handoff.candidateRetrievalId,
				expiresAt: undefined,
				freshnessStatus: 'not_applicable' as const,
				groupKey: input.handoff.groupKey,
				latestApprovedAt: undefined,
				sourceRolloutLabel: input.handoff.sourceRolloutLabel,
				sourceRunId: input.handoff.targetReadiness?.sourceRunId,
				staleAfterMs,
				targetRolloutLabel: input.handoff.targetRolloutLabel
			};
		}
		const approvalAgeMs = Math.max(
			0,
			now - latestApprovedDecision.decidedAt
		);
		const expiresAt = latestApprovedDecision.decidedAt + staleAfterMs;
		return {
			approvalAgeMs,
			candidateRetrievalId:
				latestApprovedDecision.candidateRetrievalId ??
				input.handoff.candidateRetrievalId,
			expiresAt,
			freshnessStatus:
				now > expiresAt ? ('expired' as const) : ('fresh' as const),
			groupKey: input.handoff.groupKey,
			latestApprovedAt: latestApprovedDecision.decidedAt,
			sourceRolloutLabel: input.handoff.sourceRolloutLabel,
			sourceRunId:
				latestApprovedDecision.sourceRunId ??
				input.handoff.targetReadiness?.sourceRunId,
			staleAfterMs,
			targetRolloutLabel: input.handoff.targetRolloutLabel
		};
	};

	const summarizeRetrievalLaneHandoffIncidents = (
		incidents?: RAGRetrievalLaneHandoffIncidentRecord[]
	) => {
		const openIncidents = (incidents ?? []).filter(
			(entry) => entry.status === 'open'
		);
		const acknowledgedOpenCount = openIncidents.filter(
			(entry) => typeof entry.acknowledgedAt === 'number'
		).length;
		const resolvedIncidents = (incidents ?? []).filter(
			(entry) => entry.status === 'resolved'
		);
		const oldestOpenTriggeredAt = openIncidents
			.map((entry) => entry.triggeredAt)
			.sort((left, right) => left - right)[0];
		return {
			acknowledgedOpenCount,
			latestResolvedAt: resolvedIncidents
				.map((entry) => entry.resolvedAt)
				.filter((entry): entry is number => typeof entry === 'number')
				.sort((left, right) => right - left)[0],
			latestTriggeredAt: (incidents ?? [])
				.map((entry) => entry.triggeredAt)
				.sort((left, right) => right - left)[0],
			oldestOpenAgeMs:
				typeof oldestOpenTriggeredAt === 'number'
					? Math.max(0, Date.now() - oldestOpenTriggeredAt)
					: undefined,
			oldestOpenTriggeredAt,
			openCount: openIncidents.length,
			resolvedCount: resolvedIncidents.length,
			staleOpenCount: openIncidents.filter(
				(entry) => entry.kind === 'handoff_stale'
			).length,
			unacknowledgedOpenCount:
				openIncidents.length - acknowledgedOpenCount
		};
	};

	const getLatestCandidateDecision = (input: {
		decisions?: NonNullable<
			RAGRetrievalReleaseDecisionListResponse['decisions']
		>;
		sourceRunId: string;
		retrievalId: string;
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
	}) =>
		input.decisions?.find(
			(entry) =>
				entry.sourceRunId === input.sourceRunId &&
				entry.retrievalId === input.retrievalId &&
				(entry.targetRolloutLabel ?? undefined) ===
					(input.targetRolloutLabel ?? undefined) &&
				(entry.kind === 'approve' || entry.kind === 'reject')
		);

	const getDecisionFreshness = (input: {
		record: RAGRetrievalReleaseDecisionRecord;
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		now?: number;
	}) => {
		const now = input.now ?? Date.now();
		const ageMs = Math.max(0, now - input.record.decidedAt);
		const policy = getRetrievalReleasePolicy(
			input.record.groupKey,
			input.targetRolloutLabel ?? input.record.targetRolloutLabel
		);
		if (
			input.record.kind !== 'approve' ||
			typeof policy.approvalMaxAgeMs !== 'number'
		) {
			return {
				ageMs,
				expiresAt: undefined,
				freshnessStatus: 'not_applicable' as const
			};
		}

		const expiresAt = input.record.decidedAt + policy.approvalMaxAgeMs;
		return {
			ageMs,
			expiresAt,
			freshnessStatus:
				now > expiresAt ? ('expired' as const) : ('fresh' as const)
		};
	};

	const emitRetrievalReleaseEvent = async (
		event: NonNullable<
			RAGChatPluginConfig['onRetrievalReleaseEvent']
		> extends (event: infer T) => unknown
			? T
			: never
	) => {
		await config.onRetrievalReleaseEvent?.(event);
	};

	const persistLaneHandoffIncidentHistoryRecord = async (input: {
		incident: RAGRetrievalLaneHandoffIncidentRecord;
		action: 'opened' | 'acknowledged' | 'unacknowledged' | 'resolved';
		recordedAt?: number;
		recordedBy?: string;
		notes?: string;
	}) => {
		if (!config.retrievalLaneHandoffIncidentHistoryStore) {
			return;
		}
		await persistRAGRetrievalLaneHandoffIncidentHistory({
			record: {
				action: input.action,
				corpusGroupKey: input.incident.corpusGroupKey,
				groupKey: input.incident.groupKey,
				id: generateId(),
				incidentId: input.incident.id,
				kind: 'handoff_stale',
				notes: input.notes,
				recordedAt: input.recordedAt ?? Date.now(),
				recordedBy: input.recordedBy,
				severity: input.incident.severity,
				sourceRolloutLabel: input.incident.sourceRolloutLabel,
				status: input.incident.status,
				targetRolloutLabel: input.incident.targetRolloutLabel
			},
			store: config.retrievalLaneHandoffIncidentHistoryStore
		});
	};

	const persistLaneHandoffAutoCompletePolicyHistoryRecord = async (input: {
		changeKind: 'snapshot' | 'changed';
		corpusGroupKey?: string;
		groupKey: string;
		targetRolloutLabel: 'canary' | 'stable' | 'rollback_target';
		enabled: boolean;
		maxApprovedDecisionAgeMs?: number;
		previousEnabled?: boolean;
		previousMaxApprovedDecisionAgeMs?: number;
		recordedAt?: number;
	}) => {
		if (!config.retrievalLaneHandoffAutoCompletePolicyHistoryStore) {
			return;
		}
		await persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory({
			record: {
				changeKind: input.changeKind,
				corpusGroupKey: input.corpusGroupKey,
				enabled: input.enabled,
				groupKey: input.groupKey,
				id: generateId(),
				maxApprovedDecisionAgeMs: input.maxApprovedDecisionAgeMs,
				previousEnabled: input.previousEnabled,
				previousMaxApprovedDecisionAgeMs:
					input.previousMaxApprovedDecisionAgeMs,
				recordedAt: input.recordedAt ?? Date.now(),
				targetRolloutLabel: input.targetRolloutLabel
			},
			store: config.retrievalLaneHandoffAutoCompletePolicyHistoryStore
		});
	};

	const persistReleaseLanePolicyHistoryRecord = async (input: {
		changeKind: 'snapshot' | 'changed';
		rolloutLabel: 'canary' | 'stable' | 'rollback_target';
		scope: 'rollout_label' | 'group_rollout_label';
		corpusGroupKey?: string;
		groupKey?: string;
		requireApprovalBeforePromotion?: boolean;
		approvalMaxAgeMs?: number;
		previousRequireApprovalBeforePromotion?: boolean;
		previousApprovalMaxAgeMs?: number;
		recordedAt?: number;
	}) => {
		if (!config.retrievalReleaseLanePolicyHistoryStore) {
			return;
		}
		await persistRAGRetrievalReleaseLanePolicyHistory({
			record: {
				approvalMaxAgeMs: input.approvalMaxAgeMs,
				changeKind: input.changeKind,
				corpusGroupKey: input.corpusGroupKey,
				groupKey: input.groupKey,
				id: generateId(),
				previousApprovalMaxAgeMs: input.previousApprovalMaxAgeMs,
				previousRequireApprovalBeforePromotion:
					input.previousRequireApprovalBeforePromotion,
				recordedAt: input.recordedAt ?? Date.now(),
				requireApprovalBeforePromotion:
					input.requireApprovalBeforePromotion,
				rolloutLabel: input.rolloutLabel,
				scope: input.scope
			},
			store: config.retrievalReleaseLanePolicyHistoryStore
		});
	};

	const persistBaselineGatePolicyHistoryRecord = async (input: {
		changeKind: 'snapshot' | 'changed';
		rolloutLabel: 'canary' | 'stable' | 'rollback_target';
		scope: 'rollout_label' | 'group_rollout_label';
		corpusGroupKey?: string;
		groupKey?: string;
		policy: RAGRetrievalBaselineGatePolicy;
		previousPolicy?: RAGRetrievalBaselineGatePolicy;
		recordedAt?: number;
	}) => {
		if (!config.retrievalBaselineGatePolicyHistoryStore) {
			return;
		}
		await persistRAGRetrievalBaselineGatePolicyHistory({
			record: {
				changeKind: input.changeKind,
				corpusGroupKey: input.corpusGroupKey,
				groupKey: input.groupKey,
				id: generateId(),
				policy: input.policy,
				previousPolicy: input.previousPolicy,
				recordedAt: input.recordedAt ?? Date.now(),
				rolloutLabel: input.rolloutLabel,
				scope: input.scope
			},
			store: config.retrievalBaselineGatePolicyHistoryStore
		});
	};

	const persistReleaseLaneEscalationPolicyHistoryRecord = async (input: {
		changeKind: 'snapshot' | 'changed';
		corpusGroupKey?: string;
		groupKey: string;
		targetRolloutLabel: 'canary' | 'stable' | 'rollback_target';
		openIncidentSeverity: 'warning' | 'critical';
		regressionSeverity: 'warning' | 'critical';
		gateFailureSeverity: 'warning' | 'critical';
		approvalExpiredSeverity: 'warning' | 'critical';
		previousOpenIncidentSeverity?: 'warning' | 'critical';
		previousRegressionSeverity?: 'warning' | 'critical';
		previousGateFailureSeverity?: 'warning' | 'critical';
		previousApprovalExpiredSeverity?: 'warning' | 'critical';
		recordedAt?: number;
	}) => {
		if (!config.retrievalReleaseLaneEscalationPolicyHistoryStore) {
			return;
		}
		await persistRAGRetrievalReleaseLaneEscalationPolicyHistory({
			record: {
				approvalExpiredSeverity: input.approvalExpiredSeverity,
				changeKind: input.changeKind,
				corpusGroupKey: input.corpusGroupKey,
				gateFailureSeverity: input.gateFailureSeverity,
				groupKey: input.groupKey,
				id: generateId(),
				openIncidentSeverity: input.openIncidentSeverity,
				previousApprovalExpiredSeverity:
					input.previousApprovalExpiredSeverity,
				previousGateFailureSeverity: input.previousGateFailureSeverity,
				previousOpenIncidentSeverity:
					input.previousOpenIncidentSeverity,
				previousRegressionSeverity: input.previousRegressionSeverity,
				recordedAt: input.recordedAt ?? Date.now(),
				regressionSeverity: input.regressionSeverity,
				targetRolloutLabel: input.targetRolloutLabel
			},
			store: config.retrievalReleaseLaneEscalationPolicyHistoryStore
		});
	};

	const syncRetrievalReleaseIncidents = async (input: {
		promotionCandidates: RAGRetrievalPromotionCandidate[];
		handoffs?: NonNullable<
			NonNullable<
				RAGOperationsResponse['retrievalComparisons']
			>['releaseLaneHandoffs']
		>;
		handoffDecisions?: RAGRetrievalLaneHandoffDecisionRecord[];
	}) => {
		if (!config.retrievalReleaseIncidentStore) {
			return undefined;
		}

		const existing = await loadRAGRetrievalReleaseIncidents({
			limit: 100,
			store: config.retrievalReleaseIncidentStore
		});
		const baselineCorpusGroups = config.retrievalBaselineStore
			? await loadRAGRetrievalBaselines({
					limit: 200,
					store: config.retrievalBaselineStore
				})
			: [];
		const comparisonRunCorpusGroups = config.retrievalComparisonHistoryStore
			? await loadRAGRetrievalComparisonHistory({
					limit: 200,
					store: config.retrievalComparisonHistoryStore
				})
			: [];
		const releaseDecisionCorpusGroups = config.retrievalReleaseDecisionStore
			? await loadRAGRetrievalReleaseDecisions({
					limit: 200,
					store: config.retrievalReleaseDecisionStore
				})
			: [];
		const resolveIncidentCorpusGroupKey = (groupKey?: string) => {
			if (!groupKey) {
				return undefined;
			}

			return (
				existing.find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey ??
				comparisonRunCorpusGroups.find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey ??
				baselineCorpusGroups.find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey ??
				releaseDecisionCorpusGroups.find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey
			);
		};
		const nextByKey = new Map<string, RAGRetrievalReleaseIncidentRecord>();
		const classifyPromotionIncident = (reasons?: string[]) =>
			classifyGovernanceReasons(reasons);
		for (const candidate of input.promotionCandidates) {
			if (!candidate.groupKey || !candidate.targetRolloutLabel) {
				continue;
			}
			const kind =
				candidate.reviewStatus === 'needs_review'
					? 'approval_expired'
					: candidate.priority === 'gate_fail'
						? 'gate_failure'
						: candidate.priority === 'gate_warn'
							? 'baseline_regression'
							: undefined;
			if (!kind) {
				continue;
			}
			const key = `${candidate.groupKey}:${candidate.targetRolloutLabel}:${kind}`;
			nextByKey.set(key, {
				baselineRetrievalId: candidate.baselineRetrievalId,
				candidateRetrievalId: candidate.candidateRetrievalId,
				corpusGroupKey: resolveIncidentCorpusGroupKey(
					candidate.groupKey
				),
				groupKey: candidate.groupKey,
				id: key,
				kind,
				message:
					candidate.reasons[0] ??
					candidate.sortReason ??
					'release action required',
				classification: classifyPromotionIncident(candidate.reasons),
				severity: getRetrievalReleaseIncidentSeverity(
					candidate.targetRolloutLabel
				),
				sourceRunId: candidate.sourceRunId,
				status: 'open',
				targetRolloutLabel: candidate.targetRolloutLabel,
				triggeredAt: candidate.finishedAt ?? Date.now()
			});
		}
		for (const handoff of input.handoffs ?? []) {
			const decisions = (input.handoffDecisions ?? [])
				.filter(
					(entry) =>
						entry.groupKey === handoff.groupKey &&
						entry.sourceRolloutLabel ===
							handoff.sourceRolloutLabel &&
						entry.targetRolloutLabel === handoff.targetRolloutLabel
				)
				.sort((left, right) => right.decidedAt - left.decidedAt);
			const latestDecision = decisions[0];
			if (
				latestDecision?.kind !== 'approve' ||
				handoff.readyForHandoff !== true
			) {
				continue;
			}
			const staleAfterMs =
				getRetrievalReleasePolicy(
					handoff.groupKey,
					handoff.targetRolloutLabel
				).approvalMaxAgeMs ?? DEFAULT_STALE_AFTER_MS;
			if (Date.now() - latestDecision.decidedAt < staleAfterMs) {
				continue;
			}
			const key = `${handoff.groupKey}:${handoff.targetRolloutLabel}:handoff_stale`;
			nextByKey.set(key, {
				baselineRetrievalId: handoff.targetBaselineRetrievalId,
				candidateRetrievalId: handoff.candidateRetrievalId,
				corpusGroupKey: handoff.corpusGroupKey,
				groupKey: handoff.groupKey,
				id: key,
				kind: 'handoff_stale',
				message: `approved ${handoff.sourceRolloutLabel} -> ${handoff.targetRolloutLabel} handoff is stale and must be completed or re-approved`,
				severity: getRetrievalReleaseIncidentSeverity(
					handoff.targetRolloutLabel
				),
				sourceRunId:
					latestDecision.sourceRunId ??
					handoff.targetReadiness?.sourceRunId,
				status: 'open',
				targetRolloutLabel: handoff.targetRolloutLabel,
				triggeredAt: latestDecision.decidedAt + staleAfterMs
			});
		}

		for (const incident of nextByKey.values()) {
			const matchingIncidents = existing
				.filter(
					(entry) =>
						entry.corpusGroupKey === incident.corpusGroupKey &&
						entry.groupKey === incident.groupKey &&
						entry.kind === incident.kind &&
						(entry.targetRolloutLabel ?? undefined) ===
							(incident.targetRolloutLabel ?? undefined)
				)
				.sort((left, right) => right.triggeredAt - left.triggeredAt);
			const openIncident = matchingIncidents.find(
				(entry) => entry.status === 'open'
			);
			const latestMatchingIncident = matchingIncidents[0];
			if (!openIncident) {
				if (
					latestMatchingIncident &&
					latestMatchingIncident.status === 'resolved' &&
					latestMatchingIncident.triggeredAt >= incident.triggeredAt
				) {
					continue;
				}
				await persistRAGRetrievalReleaseIncident({
					record: incident,
					store: config.retrievalReleaseIncidentStore
				});
				if (
					incident.kind === 'handoff_stale' &&
					config.retrievalLaneHandoffIncidentStore
				) {
					const matchingHandoff = (input.handoffs ?? []).find(
						(entry) =>
							entry.groupKey === incident.groupKey &&
							entry.targetRolloutLabel ===
								incident.targetRolloutLabel
					);
					const laneIncident = {
						...incident,
						corpusGroupKey: matchingHandoff?.corpusGroupKey,
						kind: 'handoff_stale' as const,
						sourceRolloutLabel: matchingHandoff?.sourceRolloutLabel
					};
					await persistRAGRetrievalLaneHandoffIncident({
						record: laneIncident,
						store: config.retrievalLaneHandoffIncidentStore
					});
					await persistLaneHandoffIncidentHistoryRecord({
						action: 'opened',
						incident: laneIncident,
						notes: incident.message,
						recordedAt: incident.triggeredAt
					});
				}
				await emitRetrievalReleaseEvent({
					incident,
					kind: 'incident_opened'
				});
			}
		}

		for (const incident of existing) {
			const desired = nextByKey.get(
				`${incident.groupKey}:${incident.targetRolloutLabel ?? 'none'}:${incident.kind}`
			);
			if (incident.status !== 'open' || desired) {
				continue;
			}
			const resolved = {
				...incident,
				resolvedAt: Date.now(),
				status: 'resolved' as const
			};
			await persistRAGRetrievalReleaseIncident({
				record: resolved,
				store: config.retrievalReleaseIncidentStore
			});
			if (
				resolved.kind === 'handoff_stale' &&
				config.retrievalLaneHandoffIncidentStore
			) {
				const laneIncident = {
					...resolved,
					kind: 'handoff_stale' as const
				};
				await persistRAGRetrievalLaneHandoffIncident({
					record: laneIncident,
					store: config.retrievalLaneHandoffIncidentStore
				});
				await persistLaneHandoffIncidentHistoryRecord({
					action: 'resolved',
					incident: laneIncident,
					notes: resolved.notes,
					recordedAt: resolved.resolvedAt
				});
			}
			await emitRetrievalReleaseEvent({
				incident: resolved,
				kind: 'incident_resolved'
			});
		}

		return loadRAGRetrievalReleaseIncidents({
			limit: 20,
			store: config.retrievalReleaseIncidentStore
		});
	};

	const getPromotionCandidateState = (input: {
		run: NonNullable<RAGRetrievalComparisonHistoryResponse['runs']>[number];
		decisions?: NonNullable<
			RAGRetrievalReleaseDecisionListResponse['decisions']
		>;
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		now?: number;
	}): {
		approved: boolean;
		approvedAt?: number;
		approvedBy?: string;
		baselineRetrievalId?: string;
		candidateRetrievalId?: string;
		gateStatus?: RAGRetrievalPromotionCandidate['gateStatus'];
		priority: RAGRetrievalPromotionCandidate['priority'];
		priorityScore: number;
		sortReason: string;
		approvalFreshnessStatus: RAGRetrievalPromotionCandidate['approvalFreshnessStatus'];
		approvalExpiresAt?: number;
		approvalAgeMs?: number;
		effectiveReleasePolicy: RAGRetrievalReleasePolicy;
		effectiveBaselineGatePolicy?: RAGRetrievalBaselineGatePolicy;
		delta?: RAGRetrievalPromotionCandidate['delta'];
		releaseVerdictStatus?: RAGRetrievalPromotionCandidate['releaseVerdictStatus'];
		latestDecision?: ReturnType<typeof getLatestCandidateDecision>;
		reviewStatus: RAGRetrievalPromotionCandidate['reviewStatus'];
		ready: boolean;
		reasons: string[];
		requiresApproval: boolean;
	} => {
		const decision = input.run.decisionSummary;
		const retrievalId =
			decision?.candidateRetrievalId ??
			input.run.comparison.summary.bestByPassingRate;
		const latestDecision = retrievalId
			? getLatestCandidateDecision({
					decisions: input.decisions,
					retrievalId,
					sourceRunId: input.run.id,
					targetRolloutLabel: input.targetRolloutLabel
				})
			: undefined;
		const gate = decision?.gate;
		const reasons =
			gate?.status && gate.status !== 'pass'
				? gate.reasons.length > 0
					? [...gate.reasons]
					: [`gate status is ${gate.status}`]
				: [];
		const effectiveReleasePolicy = getRetrievalReleasePolicy(
			input.run.groupKey,
			input.targetRolloutLabel
		);
		const effectiveBaselineGatePolicy =
			getEffectiveRetrievalBaselineGatePolicy({
				groupKey: input.run.groupKey,
				rolloutLabel: input.targetRolloutLabel,
				suiteId: input.run.suiteId
			}) ?? {};
		const requiresApproval = Boolean(
			effectiveReleasePolicy.requireApprovalBeforePromotion
		);
		const approvalFreshness = latestDecision
			? getDecisionFreshness({
					now: input.now,
					record: latestDecision,
					targetRolloutLabel: input.targetRolloutLabel
				})
			: {
					ageMs: undefined,
					expiresAt: undefined,
					freshnessStatus: 'not_applicable' as const
				};
		const approvalExpired =
			latestDecision?.kind === 'approve' &&
			approvalFreshness.freshnessStatus === 'expired';
		const approved =
			latestDecision?.kind === 'approve' && approvalExpired !== true;
		const approvalReasons = requiresApproval
			? approved
				? []
				: [
						approvalExpired
							? 'approval has expired and must be renewed before promotion'
							: 'explicit approval is required before promotion'
					]
			: [];
		const reviewStatus: RAGRetrievalPromotionCandidate['reviewStatus'] =
			approvalExpired
				? 'needs_review'
				: (!gate || gate.status === 'pass') &&
					  (!requiresApproval || approved)
					? approved
						? 'approved'
						: 'ready'
					: 'blocked';
		const priority: RAGRetrievalPromotionCandidate['priority'] =
			reviewStatus === 'needs_review'
				? 'needs_review'
				: reviewStatus === 'approved' || reviewStatus === 'ready'
					? 'ready_now'
					: gate?.status === 'warn'
						? 'gate_warn'
						: gate?.status === 'fail'
							? 'gate_fail'
							: 'blocked';
		const priorityScore =
			priority === 'ready_now'
				? 5
				: priority === 'needs_review'
					? 4
					: priority === 'gate_warn'
						? 3
						: priority === 'gate_fail'
							? 2
							: 1;
		const sortReason =
			priority === 'ready_now'
				? approved
					? 'candidate is approved and ready for promotion'
					: 'candidate passed the gate and is ready for promotion'
				: priority === 'needs_review'
					? 'candidate approval expired and needs review'
					: priority === 'gate_warn'
						? 'candidate is blocked by a gate warning'
						: priority === 'gate_fail'
							? 'candidate is blocked by a gate failure'
							: 'candidate is blocked pending release approval';

		return {
			approved,
			approvalAgeMs: approvalFreshness.ageMs,
			approvalExpiresAt: approvalFreshness.expiresAt,
			approvalFreshnessStatus:
				latestDecision?.kind === 'approve'
					? approvalFreshness.freshnessStatus
					: 'not_applicable',
			approvedAt:
				latestDecision?.kind === 'approve'
					? latestDecision.decidedAt
					: undefined,
			approvedBy:
				latestDecision?.kind === 'approve'
					? latestDecision.decidedBy
					: undefined,
			baselineRetrievalId: decision?.baselineRetrievalId,
			candidateRetrievalId: retrievalId,
			delta: decision?.delta,
			effectiveBaselineGatePolicy:
				Object.keys(effectiveBaselineGatePolicy).length > 0
					? effectiveBaselineGatePolicy
					: undefined,
			effectiveReleasePolicy,
			gateStatus: gate?.status,
			latestDecision,
			priority,
			priorityScore,
			releaseVerdictStatus: input.run.releaseVerdict?.status,
			reviewStatus,
			ready:
				(!gate || gate.status === 'pass') &&
				(!requiresApproval || approved),
			reasons: [...reasons, ...approvalReasons],
			requiresApproval,
			sortReason
		};
	};

	const buildLanePromotionStateSummary = async (input: {
		groupKey: string;
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		sourceRunId?: string;
		retrievalId?: string;
		baseline?: RAGRetrievalBaselineRecord;
	}): Promise<RAGRetrievalLanePromotionStateSummary> => {
		const toRemediationActions = (reasons: string[]) => {
			const actions = new Set<string>();
			for (const reason of reasons) {
				if (reason.includes('approval')) {
					actions.add(
						'Renew or record the required approval for this rollout lane.'
					);
				}
				if (
					reason.includes('gate') ||
					reason.includes('passing rate') ||
					reason.includes('average') ||
					reason.includes('evidence reconcile') ||
					reason.includes('presentation title') ||
					reason.includes('presentation body') ||
					reason.includes('presentation notes') ||
					reason.includes('ocr supplement') ||
					reason.includes('hybrid evidence')
				) {
					actions.add(
						buildRegressionRemediationLabel(
							classifyGovernanceReasons([reason]),
							[reason]
						)
					);
				}
				if (reason.includes('source comparison run was not found')) {
					actions.add(
						'Re-run the comparison so the rollout action has a valid source run.'
					);
				}
				if (reason.includes('baseline is active')) {
					actions.add(
						'Monitor the active lane and verify post-promotion behavior.'
					);
				}
			}
			if (actions.size === 0) {
				actions.add(
					'Review the latest lane readiness reasons before continuing.'
				);
			}
			return [...actions];
		};
		const toRemediationSteps = (
			reasons: string[]
		): RAGRemediationStep[] => {
			const steps: RAGRemediationStep[] = [];
			for (const reason of reasons) {
				if (reason.includes('approval')) {
					steps.push({
						kind: 'renew_approval',
						label: 'Renew or record the required approval for this rollout lane.',
						actions: buildRemediationStepActions({
							candidateRetrievalId: input.retrievalId,
							groupKey: input.groupKey,
							sourceRunId: input.sourceRunId,
							stepKind: 'renew_approval',
							targetRolloutLabel: targetRolloutLabel ?? 'canary'
						})
					});
				}
				if (
					reason.includes('gate') ||
					reason.includes('passing rate') ||
					reason.includes('average') ||
					reason.includes('evidence reconcile') ||
					reason.includes('presentation title') ||
					reason.includes('presentation body') ||
					reason.includes('presentation notes') ||
					reason.includes('ocr supplement') ||
					reason.includes('hybrid evidence')
				) {
					steps.push({
						kind: 'inspect_gate',
						label: buildRegressionRemediationLabel(
							classifyGovernanceReasons([reason]),
							[reason]
						),
						actions: buildRemediationStepActions({
							candidateRetrievalId: input.retrievalId,
							groupKey: input.groupKey,
							sourceRunId: input.sourceRunId,
							stepKind: 'inspect_gate',
							targetRolloutLabel: targetRolloutLabel ?? 'canary'
						})
					});
				}
				if (reason.includes('source comparison run was not found')) {
					steps.push({
						kind: 'rerun_comparison',
						label: 'Re-run the comparison so the rollout action has a valid source run.',
						actions: buildRemediationStepActions({
							candidateRetrievalId: input.retrievalId,
							groupKey: input.groupKey,
							sourceRunId: input.sourceRunId,
							stepKind: 'rerun_comparison',
							targetRolloutLabel: targetRolloutLabel ?? 'canary'
						})
					});
				}
				if (reason.includes('baseline is active')) {
					steps.push({
						kind: 'monitor_lane',
						label: 'Monitor the active lane and verify post-promotion behavior.',
						actions: buildRemediationStepActions({
							candidateRetrievalId: input.retrievalId,
							groupKey: input.groupKey,
							sourceRunId: input.sourceRunId,
							stepKind: 'monitor_lane',
							targetRolloutLabel: targetRolloutLabel ?? 'canary'
						})
					});
				}
			}
			if (steps.length === 0) {
				steps.push({
					kind: 'review_readiness',
					label: 'Review the latest lane readiness reasons before continuing.',
					actions: buildRemediationStepActions({
						candidateRetrievalId: input.retrievalId,
						groupKey: input.groupKey,
						sourceRunId: input.sourceRunId,
						stepKind: 'review_readiness',
						targetRolloutLabel: targetRolloutLabel ?? 'canary'
					})
				});
			}
			return steps.filter(
				(step, index, all) =>
					all.findIndex(
						(candidate) =>
							candidate.kind === step.kind &&
							candidate.label === step.label
					) === index
			);
		};
		const targetRolloutLabel =
			input.targetRolloutLabel ?? input.baseline?.rolloutLabel;
		const baselineRetrievalId = input.baseline?.retrievalId;
		const base: RAGRetrievalLanePromotionStateSummary = {
			baselineRetrievalId,
			candidateRetrievalId: input.retrievalId,
			classification: input.baseline ? ('general' as const) : undefined,
			effectiveBaselineGatePolicy:
				targetRolloutLabel || input.groupKey
					? getEffectiveRetrievalBaselineGatePolicy({
							groupKey: input.groupKey,
							rolloutLabel: targetRolloutLabel
						})
					: undefined,
			effectiveReleasePolicy: getRetrievalReleasePolicy(
				input.groupKey,
				targetRolloutLabel
			),
			groupKey: input.groupKey,
			gateStatus: undefined,
			ready: Boolean(input.baseline),
			reasons: input.baseline
				? ([
						'baseline is active in the target rollout lane'
					] as string[])
				: ([] as string[]),
			requiresApproval: Boolean(
				getRetrievalReleasePolicy(input.groupKey, targetRolloutLabel)
					.requireApprovalBeforePromotion
			),
			requiresOverride: false,
			remediationActions: input.baseline
				? [
						'Monitor the active lane and verify post-promotion behavior.'
					]
				: [
						'Review the latest lane readiness reasons before continuing.'
					],
			remediationSteps: input.baseline
				? [
						{
							kind: 'monitor_lane' as const,
							label: 'Monitor the active lane and verify post-promotion behavior.',
							actions: buildRemediationStepActions({
								candidateRetrievalId: input.retrievalId,
								groupKey: input.groupKey,
								sourceRunId: input.sourceRunId,
								stepKind: 'monitor_lane',
								targetRolloutLabel:
									targetRolloutLabel ?? 'canary'
							})
						}
					]
				: [
						{
							kind: 'review_readiness' as const,
							label: 'Review the latest lane readiness reasons before continuing.',
							actions: buildRemediationStepActions({
								candidateRetrievalId: input.retrievalId,
								groupKey: input.groupKey,
								sourceRunId: input.sourceRunId,
								stepKind: 'review_readiness',
								targetRolloutLabel:
									targetRolloutLabel ?? 'canary'
							})
						}
					],
			reviewStatus: undefined as
				| RAGRetrievalPromotionCandidate['reviewStatus']
				| undefined,
			sourceRunId: input.sourceRunId,
			targetRolloutLabel: targetRolloutLabel ?? ('canary' as const)
		};
		if (!retrievalComparisonHistoryStore || !input.sourceRunId) {
			return base;
		}
		const runs = await loadRAGRetrievalComparisonHistory({
			groupKey: input.groupKey,
			limit: 50,
			store: retrievalComparisonHistoryStore
		});
		const sourceRun = runs.find((run) => run.id === input.sourceRunId);
		if (!sourceRun) {
			return {
				...base,
				classification: 'general' as const,
				reasons: [
					'source comparison run was not found for this rollout action'
				],
				remediationActions: [
					'Re-run the comparison so the rollout action has a valid source run.'
				],
				remediationSteps: [
					{
						kind: 'rerun_comparison' as const,
						label: 'Re-run the comparison so the rollout action has a valid source run.',
						actions: buildRemediationStepActions({
							candidateRetrievalId: input.retrievalId,
							groupKey: input.groupKey,
							sourceRunId: input.sourceRunId,
							stepKind: 'rerun_comparison',
							targetRolloutLabel: targetRolloutLabel ?? 'canary'
						})
					}
				]
			};
		}
		const decisions = config.retrievalReleaseDecisionStore
			? await loadRAGRetrievalReleaseDecisions({
					groupKey: input.groupKey,
					limit: 50,
					store: config.retrievalReleaseDecisionStore
				})
			: undefined;
		const state = getPromotionCandidateState({
			decisions,
			now: Date.now(),
			run: sourceRun,
			targetRolloutLabel
		});
		return {
			baselineRetrievalId:
				state.baselineRetrievalId ?? baselineRetrievalId,
			candidateRetrievalId:
				state.candidateRetrievalId ?? input.retrievalId,
			classification: classifyGovernanceReasons(state.reasons),
			effectiveBaselineGatePolicy: state.effectiveBaselineGatePolicy,
			effectiveReleasePolicy: state.effectiveReleasePolicy,
			gateStatus: state.gateStatus,
			groupKey: input.groupKey,
			ready: state.ready,
			reasons: state.reasons,
			requiresApproval: state.requiresApproval,
			requiresOverride: Boolean(
				state.gateStatus && state.gateStatus !== 'pass'
			),
			remediationActions: toRemediationActions(state.reasons),
			remediationSteps: toRemediationSteps(state.reasons),
			reviewStatus: state.reviewStatus,
			sourceRunId: sourceRun.id,
			targetRolloutLabel: targetRolloutLabel ?? ('canary' as const)
		};
	};

	const buildRetrievalPromotionCandidates = (input: {
		runs?: NonNullable<RAGRetrievalComparisonHistoryResponse['runs']>;
		decisions?: NonNullable<
			RAGRetrievalReleaseDecisionListResponse['decisions']
		>;
		activeBaselines?: RAGRetrievalBaselineRecord[];
		targetRolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		limit?: number;
		groupKey?: string;
		tag?: string;
		sortBy?:
			| 'approvalFreshness'
			| 'finishedAt'
			| 'gateSeverity'
			| 'priority';
		sortDirection?: 'asc' | 'desc';
	}): RAGRetrievalPromotionCandidate[] => {
		const candidates: RAGRetrievalPromotionCandidate[] = (input.runs ?? [])
			.filter(
				(run) =>
					(!input.groupKey || run.groupKey === input.groupKey) &&
					(!input.tag || (run.tags ?? []).includes(input.tag))
			)
			.map((run) => {
				const targetRolloutLabel =
					input.targetRolloutLabel ??
					input.activeBaselines?.find(
						(entry) =>
							entry.groupKey === run.groupKey &&
							entry.status === 'active'
					)?.rolloutLabel;
				const state = getPromotionCandidateState({
					decisions: input.decisions,
					now: Date.now(),
					targetRolloutLabel,
					run
				});

				return {
					approved: state.approved,
					approvalAgeMs: state.approvalAgeMs,
					approvalExpiresAt: state.approvalExpiresAt,
					approvalFreshnessStatus: state.approvalFreshnessStatus,
					approvedAt: state.approvedAt,
					approvedBy: state.approvedBy,
					baselineRetrievalId: state.baselineRetrievalId,
					candidateRetrievalId: state.candidateRetrievalId,
					delta: state.delta,
					effectiveBaselineGatePolicy:
						state.effectiveBaselineGatePolicy,
					effectiveReleasePolicy: state.effectiveReleasePolicy,
					finishedAt: run.finishedAt,
					gateStatus: state.gateStatus,
					groupKey: run.groupKey,
					label: run.label,
					priority: state.priority,
					priorityScore: state.priorityScore,
					releaseVerdictStatus: state.releaseVerdictStatus,
					reviewStatus: state.reviewStatus,
					ready: state.ready,
					reasons: state.reasons,
					requiresApproval: state.requiresApproval,
					sortReason: state.sortReason,
					targetRolloutLabel,
					sourceRunId: run.id,
					suiteId: run.suiteId,
					suiteLabel: run.suiteLabel,
					tags: run.tags
				};
			})
			.sort((left, right) => {
				const sortBy = input.sortBy ?? 'priority';
				const direction = input.sortDirection ?? 'desc';
				const multiplier = direction === 'asc' ? 1 : -1;
				if (sortBy === 'finishedAt') {
					return multiplier * (left.finishedAt - right.finishedAt);
				}
				if (sortBy === 'approvalFreshness') {
					const leftValue =
						left.approvalExpiresAt ?? Number.POSITIVE_INFINITY;
					const rightValue =
						right.approvalExpiresAt ?? Number.POSITIVE_INFINITY;
					if (leftValue !== rightValue) {
						return multiplier * (leftValue - rightValue);
					}
				}
				if (sortBy === 'gateSeverity') {
					const toSeverity = (
						value?: RAGRetrievalPromotionCandidate['gateStatus']
					) => (value === 'fail' ? 3 : value === 'warn' ? 2 : 1);
					const leftValue = toSeverity(left.gateStatus);
					const rightValue = toSeverity(right.gateStatus);
					if (leftValue !== rightValue) {
						return multiplier * (leftValue - rightValue);
					}
				}
				if (left.priorityScore !== right.priorityScore) {
					return (
						multiplier * (left.priorityScore - right.priorityScore)
					);
				}
				return right.finishedAt - left.finishedAt;
			});

		return typeof input.limit === 'number'
			? candidates.slice(0, input.limit)
			: candidates;
	};

	const promoteRetrievalBaselineRecord = async (input: {
		corpusGroupKey?: string;
		groupKey: string;
		retrievalId: string;
		rolloutLabel?: RAGRetrievalBaselineRecord['rolloutLabel'];
		label?: string;
		suiteId?: string;
		suiteLabel?: string;
		sourceRunId?: string;
		tags?: string[];
		approvedBy?: string;
		approvedAt?: number;
		approvalNotes?: string;
		policy?: RAGRetrievalBaselinePromotionRequest['policy'];
		metadata?: Record<string, unknown>;
	}) => {
		const previousVersion =
			(
				await loadRAGRetrievalBaselines({
					groupKey: input.groupKey,
					limit: 1,
					store: retrievalBaselineStore!
				})
			)[0]?.version ?? 0;
		const baseline = await persistRAGRetrievalBaseline({
			record: {
				approvedAt: input.approvedAt,
				approvedBy: input.approvedBy,
				approvalNotes: input.approvalNotes,
				corpusGroupKey: input.corpusGroupKey,
				groupKey: input.groupKey,
				id: generateId(),
				label: input.label ?? input.retrievalId,
				metadata: input.metadata,
				policy: input.policy,
				promotedAt: Date.now(),
				retrievalId: input.retrievalId,
				rolloutLabel: input.rolloutLabel,
				sourceRunId: input.sourceRunId,
				status: 'active',
				suiteId: input.suiteId,
				suiteLabel: input.suiteLabel,
				tags: input.tags,
				version: previousVersion + 1
			},
			store: retrievalBaselineStore!
		});

		return baseline;
	};

	const handlePromoteRetrievalBaseline = async (
		body: unknown,
		request?: Request
	): Promise<RAGRetrievalBaselineResponse> => {
		if (!retrievalBaselineStore) {
			return {
				error: 'RAG retrieval baseline store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalBaselinePromotionRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { groupKey, retrievalId }',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		if (!isAllowedComparisonGroupKey(accessScope, input.groupKey)) {
			return {
				error: 'Retrieval baseline group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, input.corpusGroupKey)) {
			return {
				error: 'Retrieval baseline corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob(
			'promote_retrieval_baseline',
			input.groupKey
		);
		const action = createAdminAction(
			'promote_retrieval_baseline',
			undefined,
			input.groupKey
		);

		try {
			const releasePolicy = getRetrievalReleasePolicy(
				input.groupKey,
				input.rolloutLabel
			);
			if (releasePolicy.requireApprovalBeforePromotion === true) {
				if (!retrievalComparisonHistoryStore) {
					throw new Error(
						'retrieval comparison history store is required for approval-gated direct promotion'
					);
				}
				const runs = await loadRAGRetrievalComparisonHistory({
					groupKey: input.groupKey,
					store: retrievalComparisonHistoryStore
				});
				if (runs.length > 0 && !input.sourceRunId) {
					throw new Error(
						'group policy requires sourceRunId and explicit approval before direct promotion'
					);
				}
				const sourceRun = runs.find(
					(run) => run.id === input.sourceRunId
				);
				if (runs.length > 0 && !sourceRun) {
					throw new Error(
						'Retrieval comparison run was not found for direct promotion'
					);
				}
				if (!sourceRun) {
					// Allow initial bootstrap promotions when no comparison history exists yet.
				} else {
					const state = getPromotionCandidateState({
						decisions: config.retrievalReleaseDecisionStore
							? await loadRAGRetrievalReleaseDecisions({
									groupKey: input.groupKey,
									limit: 50,
									store: config.retrievalReleaseDecisionStore
								})
							: undefined,
						now: Date.now(),
						targetRolloutLabel: input.rolloutLabel,
						run: sourceRun
					});
					if (state.candidateRetrievalId !== input.retrievalId) {
						throw new Error(
							'direct promotion retrievalId must match the approved candidate for the source run'
						);
					}
					if (!state.ready) {
						throw new Error(
							`direct promotion is blocked: ${state.reasons.join('; ')}`
						);
					}
				}
			}
			const baseline = await promoteRetrievalBaselineRecord({
				approvedAt: input.approvedAt,
				approvedBy: input.approvedBy,
				approvalNotes: input.approvalNotes,
				corpusGroupKey: input.corpusGroupKey,
				groupKey: input.groupKey,
				label: input.label,
				metadata: input.metadata,
				policy:
					input.policy ??
					getDefaultRetrievalBaselineGatePolicy(
						input.groupKey,
						input.rolloutLabel
					),
				retrievalId: input.retrievalId,
				rolloutLabel: input.rolloutLabel,
				sourceRunId: input.sourceRunId,
				suiteId: input.suiteId,
				suiteLabel: input.suiteLabel,
				tags: input.tags
			});
			await persistRetrievalReleaseDecisionIfConfigured({
				baseline,
				corpusGroupKey: baseline.corpusGroupKey,
				decidedBy: input.approvedBy,
				kind: 'promote',
				notes: input.approvalNotes,
				sourceRunId: input.sourceRunId
			});

			completeAdminJob(job);
			completeAdminAction(action);

			return {
				baseline,
				rolloutState: await buildLanePromotionStateSummary({
					baseline,
					groupKey: input.groupKey,
					retrievalId: input.retrievalId,
					sourceRunId: input.sourceRunId,
					targetRolloutLabel: input.rolloutLabel
				}),
				ok: true
			};
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Failed to promote retrieval baseline';
			failAdminJob(job, message);
			failAdminAction(action, message);
			return {
				error: message,
				ok: false
			};
		}
	};

	const handlePromoteRetrievalBaselineFromRun = async (
		body: unknown,
		request?: Request
	): Promise<RAGRetrievalBaselineResponse> => {
		if (!retrievalBaselineStore || !retrievalComparisonHistoryStore) {
			return {
				error: 'RAG retrieval baseline store and retrieval comparison history store are required',
				ok: false
			};
		}

		const input = toRAGRetrievalBaselinePromotionFromRunRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { groupKey, sourceRunId }',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		if (!isAllowedComparisonGroupKey(accessScope, input.groupKey)) {
			return {
				error: 'Retrieval baseline group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, input.corpusGroupKey)) {
			return {
				error: 'Retrieval baseline corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob(
			'promote_retrieval_baseline',
			input.groupKey
		);
		const action = createAdminAction(
			'promote_retrieval_baseline',
			undefined,
			input.groupKey
		);

		try {
			const runs = await loadRAGRetrievalComparisonHistory({
				groupKey: input.groupKey,
				store: retrievalComparisonHistoryStore
			});
			const sourceRun = runs.find((run) => run.id === input.sourceRunId);
			if (!sourceRun) {
				throw new Error('Retrieval comparison run was not found');
			}
			const corpusGroupKey = deriveCorpusGroupKey({
				corpusGroupKey:
					input.corpusGroupKey ??
					sourceRun.corpusGroupKey ??
					sourceRun.comparison.corpusGroupKey,
				corpusKeys:
					sourceRun.corpusKeys ?? sourceRun.comparison.corpusKeys
			});
			if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
				throw new Error(
					'Retrieval baseline corpus group is outside the allowed RAG access scope'
				);
			}

			const retrievalId =
				input.retrievalId ??
				sourceRun.decisionSummary?.candidateRetrievalId ??
				sourceRun.comparison.summary.bestByPassingRate ??
				sourceRun.comparison.entries[0]?.retrievalId;
			if (!retrievalId) {
				throw new Error(
					'Unable to resolve retrieval candidate from comparison run'
				);
			}

			const entry = sourceRun.comparison.entries.find(
				(candidate) => candidate.retrievalId === retrievalId
			);
			const gate = sourceRun.decisionSummary?.gate;
			const latestDecision = getLatestCandidateDecision({
				decisions: config.retrievalReleaseDecisionStore
					? await loadRAGRetrievalReleaseDecisions({
							groupKey: input.groupKey,
							limit: 50,
							store: config.retrievalReleaseDecisionStore
						})
					: undefined,
				retrievalId,
				sourceRunId: sourceRun.id,
				targetRolloutLabel: input.rolloutLabel
			});
			const releasePolicy = getRetrievalReleasePolicy(
				input.groupKey,
				input.rolloutLabel
			);
			if (gate && gate.status !== 'pass' && input.overrideGate !== true) {
				const reasons =
					gate.reasons.length > 0
						? `: ${gate.reasons.join('; ')}`
						: '';
				throw new Error(
					`Retrieval comparison run is not ready to promote because gate status is ${gate.status}${reasons}. Set overrideGate to true to force promotion.`
				);
			}
			if (input.overrideGate === true && !input.overrideReason?.trim()) {
				throw new Error(
					'overrideReason is required when overrideGate is true'
				);
			}
			if (
				releasePolicy.requireApprovalBeforePromotion === true &&
				latestDecision?.kind !== 'approve'
			) {
				throw new Error(
					'Retrieval candidate requires an explicit approval decision before promotion'
				);
			}
			const baseline = await promoteRetrievalBaselineRecord({
				approvedAt: input.approvedAt,
				approvedBy: input.approvedBy,
				approvalNotes: input.approvalNotes,
				corpusGroupKey,
				groupKey: input.groupKey,
				label: entry?.label ?? retrievalId,
				metadata: input.metadata,
				policy:
					input.policy ??
					getDefaultRetrievalBaselineGatePolicy(
						input.groupKey,
						input.rolloutLabel
					),
				retrievalId,
				rolloutLabel: input.rolloutLabel,
				sourceRunId: sourceRun.id,
				suiteId: sourceRun.suiteId,
				suiteLabel: sourceRun.suiteLabel,
				tags: sourceRun.tags
			});
			await persistRetrievalReleaseDecisionIfConfigured({
				baseline,
				corpusGroupKey,
				decidedBy: input.approvedBy,
				gateStatus: gate?.status,
				kind: 'promote',
				notes: input.approvalNotes,
				overrideGate: input.overrideGate,
				overrideReason: input.overrideReason,
				sourceRunId: sourceRun.id
			});

			completeAdminJob(job);
			completeAdminAction(action);

			return {
				baseline,
				rolloutState: await buildLanePromotionStateSummary({
					baseline,
					groupKey: input.groupKey,
					retrievalId,
					sourceRunId: sourceRun.id,
					targetRolloutLabel: input.rolloutLabel
				}),
				ok: true
			};
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Failed to promote retrieval baseline from comparison run';
			failAdminJob(job, message);
			failAdminAction(action, message);
			return {
				error: message,
				ok: false
			};
		}
	};

	const handleRevertRetrievalBaseline = async (
		body: unknown,
		request?: Request
	): Promise<RAGRetrievalBaselineResponse> => {
		if (!retrievalBaselineStore) {
			return {
				error: 'RAG retrieval baseline store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalBaselineRevertRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { groupKey, version? | baselineId? }',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		if (!isAllowedComparisonGroupKey(accessScope, input.groupKey)) {
			return {
				error: 'Retrieval baseline group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, input.corpusGroupKey)) {
			return {
				error: 'Retrieval baseline corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob('revert_retrieval_baseline', input.groupKey);
		const action = createAdminAction(
			'revert_retrieval_baseline',
			undefined,
			input.groupKey
		);

		try {
			const baselines = await loadRAGRetrievalBaselines({
				groupKey: input.groupKey,
				store: retrievalBaselineStore
			});
			const targetBaseline = baselines.find(
				(entry) =>
					(typeof input.version === 'number' &&
						entry.version === input.version) ||
					(input.baselineId && entry.id === input.baselineId)
			);
			if (!targetBaseline) {
				throw new Error('Retrieval baseline version was not found');
			}
			if (
				!isAllowedCorpusGroupKey(
					accessScope,
					targetBaseline.corpusGroupKey
				)
			) {
				throw new Error(
					'Retrieval baseline corpus group is outside the allowed RAG access scope'
				);
			}

			const baseline = await promoteRetrievalBaselineRecord({
				approvedAt: input.approvedAt,
				approvedBy: input.approvedBy,
				approvalNotes: input.approvalNotes,
				corpusGroupKey: targetBaseline.corpusGroupKey,
				groupKey: input.groupKey,
				label: targetBaseline.label,
				metadata: {
					...(targetBaseline.metadata ?? {}),
					...(input.metadata ?? {})
				},
				policy:
					targetBaseline.policy ??
					getDefaultRetrievalBaselineGatePolicy(
						input.groupKey,
						targetBaseline.rolloutLabel
					),
				retrievalId: targetBaseline.retrievalId,
				rolloutLabel: targetBaseline.rolloutLabel,
				sourceRunId: targetBaseline.sourceRunId,
				suiteId: targetBaseline.suiteId,
				suiteLabel: targetBaseline.suiteLabel,
				tags: targetBaseline.tags
			});
			await persistRetrievalReleaseDecisionIfConfigured({
				baseline,
				corpusGroupKey: baseline.corpusGroupKey,
				decidedBy: input.approvedBy,
				kind: 'revert',
				notes: input.approvalNotes,
				restoredFromBaselineId: targetBaseline.id,
				restoredFromVersion: targetBaseline.version,
				sourceRunId: targetBaseline.sourceRunId
			});

			completeAdminJob(job);
			completeAdminAction(action);

			return {
				baseline,
				rolloutState: await buildLanePromotionStateSummary({
					baseline,
					groupKey: input.groupKey,
					retrievalId: targetBaseline.retrievalId,
					sourceRunId: targetBaseline.sourceRunId,
					targetRolloutLabel: targetBaseline.rolloutLabel
				}),
				ok: true
			};
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Failed to revert retrieval baseline';
			failAdminJob(job, message);
			failAdminAction(action, message);
			return {
				error: message,
				ok: false
			};
		}
	};

	const handleRetrievalReleaseDecisionList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalReleaseDecisionListResponse> => {
		if (!config.retrievalReleaseDecisionStore) {
			return {
				error: 'RAG retrieval release decision store is not configured',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval release decision group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval release decision corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const kind = getStringProperty(queryInput, 'kind');
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const freshnessStatusFilter = getStringProperty(
			queryInput,
			'freshnessStatus'
		);
		const decisions = await loadRAGRetrievalReleaseDecisions({
			corpusGroupKey,
			groupKey,
			kind:
				kind === 'approve' ||
				kind === 'promote' ||
				kind === 'reject' ||
				kind === 'revert'
					? kind
					: undefined,
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			store: config.retrievalReleaseDecisionStore
		});

		return {
			decisions: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, decisions)
			)
				.map((decision) => ({
					...decision,
					...getDecisionFreshness({ record: decision })
				}))
				.filter((decision) => {
					if (
						targetRolloutLabel &&
						targetRolloutLabel !== 'canary' &&
						targetRolloutLabel !== 'stable' &&
						targetRolloutLabel !== 'rollback_target'
					) {
						return false;
					}
					if (
						(targetRolloutLabel === 'canary' ||
							targetRolloutLabel === 'stable' ||
							targetRolloutLabel === 'rollback_target') &&
						decision.targetRolloutLabel !== targetRolloutLabel
					) {
						return false;
					}
					if (
						freshnessStatusFilter &&
						(freshnessStatusFilter === 'fresh' ||
							freshnessStatusFilter === 'expired' ||
							freshnessStatusFilter === 'not_applicable') &&
						decision.freshnessStatus !== freshnessStatusFilter
					) {
						return false;
					}
					return true;
				}),
			ok: true
		};
	};

	const handleRetrievalReleaseDecisionAction = async (
		body: unknown,
		kind: 'approve' | 'reject',
		request?: Request
	): Promise<RAGRetrievalReleaseDecisionListResponse> => {
		if (
			!retrievalComparisonHistoryStore ||
			!config.retrievalReleaseDecisionStore
		) {
			return {
				error: 'RAG retrieval comparison history store and release decision store are required',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseDecisionActionRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { groupKey, sourceRunId }',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		if (!isAllowedComparisonGroupKey(accessScope, input.groupKey)) {
			return {
				error: 'Retrieval release decision group is outside the allowed RAG access scope',
				ok: false
			};
		}

		const runs = await loadRAGRetrievalComparisonHistory({
			groupKey: input.groupKey,
			store: retrievalComparisonHistoryStore
		});
		const sourceRun = runs.find((run) => run.id === input.sourceRunId);
		if (!sourceRun) {
			return {
				error: 'Retrieval comparison run was not found',
				ok: false
			};
		}
		const corpusGroupKey = deriveCorpusGroupKey({
			corpusGroupKey:
				sourceRun.corpusGroupKey ?? sourceRun.comparison.corpusGroupKey,
			corpusKeys: sourceRun.corpusKeys ?? sourceRun.comparison.corpusKeys
		});
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval release decision corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}

		const retrievalId =
			input.retrievalId ??
			sourceRun.decisionSummary?.candidateRetrievalId ??
			sourceRun.comparison.summary.bestByPassingRate ??
			sourceRun.comparison.entries[0]?.retrievalId;
		if (!retrievalId) {
			return {
				error: 'Unable to resolve retrieval candidate from comparison run',
				ok: false
			};
		}

		const gate = sourceRun.decisionSummary?.gate;
		if (
			kind === 'approve' &&
			gate &&
			gate.status !== 'pass' &&
			input.overrideGate !== true
		) {
			return {
				error: `Retrieval comparison run is not ready to approve because gate status is ${gate.status}. Set overrideGate to true to force approval.`,
				ok: false
			};
		}
		if (input.overrideGate === true && !input.overrideReason?.trim()) {
			return {
				error: 'overrideReason is required when overrideGate is true',
				ok: false
			};
		}
		if (kind === 'reject' && !input.notes?.trim()) {
			return {
				error: 'notes are required when rejecting a retrieval candidate',
				ok: false
			};
		}

		const decidedAt = Date.now();
		await persistRetrievalReleaseDecisionIfConfigured({
			baseline: undefined,
			corpusGroupKey,
			decidedAt: input.decidedAt,
			decidedBy: input.decidedBy,
			gateStatus: gate?.status,
			groupKey: input.groupKey,
			kind,
			notes: input.notes,
			overrideGate: input.overrideGate,
			overrideReason: input.overrideReason,
			retrievalId,
			sourceRunId: sourceRun.id,
			targetRolloutLabel: input.targetRolloutLabel
		});

		const decisions = await loadRAGRetrievalReleaseDecisions({
			corpusGroupKey,
			groupKey: input.groupKey,
			limit: 10,
			store: config.retrievalReleaseDecisionStore
		});

		void decidedAt;
		return {
			decisions: filterByCorpusGroupKey(accessScope, decisions),
			ok: true
		};
	};

	const handleRetrievalReleaseGroupHistory = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalReleaseGroupHistoryResponse> => {
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		if (!groupKey) {
			return {
				error: 'groupKey is required',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval release decision group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval release corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}

		const decisions = config.retrievalReleaseDecisionStore
			? (
					await loadRAGRetrievalReleaseDecisions({
						corpusGroupKey,
						groupKey,
						limit:
							getIntegerLikeProperty(
								queryInput,
								'decisionLimit'
							) ?? 20,
						store: config.retrievalReleaseDecisionStore
					})
				)
					.map((decision) => ({
						...decision,
						...getDecisionFreshness({ record: decision })
					}))
					.filter((decision) =>
						targetRolloutLabel === 'canary' ||
						targetRolloutLabel === 'stable' ||
						targetRolloutLabel === 'rollback_target'
							? decision.targetRolloutLabel === targetRolloutLabel
							: true
					)
			: undefined;
		const baselines = retrievalBaselineStore
			? await loadRAGRetrievalBaselines({
					corpusGroupKey,
					groupKey,
					limit:
						getIntegerLikeProperty(queryInput, 'baselineLimit') ??
						20,
					store: retrievalBaselineStore
				}).then((entries) =>
					targetRolloutLabel === 'canary' ||
					targetRolloutLabel === 'stable' ||
					targetRolloutLabel === 'rollback_target'
						? entries.filter(
								(entry) =>
									entry.rolloutLabel === targetRolloutLabel
							)
						: entries
				)
			: undefined;
		const runs = retrievalComparisonHistoryStore
			? await loadRAGRetrievalComparisonHistory({
					corpusGroupKey,
					groupKey,
					limit: getIntegerLikeProperty(queryInput, 'runLimit') ?? 20,
					store: retrievalComparisonHistoryStore
				})
			: undefined;
		const latest = decisions?.[0];
		const adaptiveNativePlannerBenchmark =
			await loadAdaptiveNativePlannerBenchmarkRuntime({
				corpusGroupKey: getStringProperty(
					queryInput,
					'benchmarkCorpusGroupKey'
				),
				groupKey: getStringProperty(queryInput, 'benchmarkGroupKey'),
				historyLimit:
					getIntegerLikeProperty(queryInput, 'benchmarkRunLimit') ??
					getIntegerLikeProperty(queryInput, 'benchmarkLimit') ??
					5,
				queryInput,
				snapshotLimit:
					getIntegerLikeProperty(queryInput, 'benchmarkLimit') ?? 5
			});
		const nativeBackendComparisonBenchmark =
			await loadNativeBackendComparisonBenchmarkRuntime({
				corpusGroupKey: getStringProperty(
					queryInput,
					'backendBenchmarkCorpusGroupKey'
				),
				groupKey: getStringProperty(
					queryInput,
					'backendBenchmarkGroupKey'
				),
				historyLimit:
					getIntegerLikeProperty(
						queryInput,
						'backendBenchmarkRunLimit'
					) ??
					getIntegerLikeProperty(
						queryInput,
						'backendBenchmarkLimit'
					) ??
					5,
				queryInput,
				snapshotLimit:
					getIntegerLikeProperty(
						queryInput,
						'backendBenchmarkLimit'
					) ?? 5
			});
		const presentationCueBenchmark =
			await loadPresentationCueBenchmarkRuntime({
				corpusGroupKey: getStringProperty(
					queryInput,
					'presentationBenchmarkCorpusGroupKey'
				),
				groupKey: getStringProperty(
					queryInput,
					'presentationBenchmarkGroupKey'
				),
				historyLimit:
					getIntegerLikeProperty(
						queryInput,
						'presentationBenchmarkRunLimit'
					) ??
					getIntegerLikeProperty(
						queryInput,
						'presentationBenchmarkLimit'
					) ??
					5,
				queryInput,
				snapshotLimit:
					getIntegerLikeProperty(
						queryInput,
						'presentationBenchmarkLimit'
					) ?? 5
			});
		const spreadsheetCueBenchmark =
			await loadSpreadsheetCueBenchmarkRuntime({
				corpusGroupKey: getStringProperty(
					queryInput,
					'spreadsheetBenchmarkCorpusGroupKey'
				),
				groupKey: getStringProperty(
					queryInput,
					'spreadsheetBenchmarkGroupKey'
				),
				historyLimit:
					getIntegerLikeProperty(
						queryInput,
						'spreadsheetBenchmarkRunLimit'
					) ??
					getIntegerLikeProperty(
						queryInput,
						'spreadsheetBenchmarkLimit'
					) ??
					5,
				queryInput,
				snapshotLimit:
					getIntegerLikeProperty(
						queryInput,
						'spreadsheetBenchmarkLimit'
					) ?? 5
			});
		const presentation = buildRAGRetrievalReleaseGroupHistoryPresentation({
			runs,
			timeline: {
				corpusGroupKey:
					corpusGroupKey ??
					decisions?.[0]?.corpusGroupKey ??
					baselines?.[0]?.corpusGroupKey ??
					runs?.[0]?.corpusGroupKey,
				groupKey,
				lastApprovedAt: decisions?.find(
					(entry) => entry.kind === 'approve'
				)?.decidedAt,
				lastPromotedAt: decisions?.find(
					(entry) => entry.kind === 'promote'
				)?.decidedAt,
				lastRejectedAt: decisions?.find(
					(entry) => entry.kind === 'reject'
				)?.decidedAt,
				lastRevertedAt: decisions?.find(
					(entry) => entry.kind === 'revert'
				)?.decidedAt,
				latestDecisionAt: latest?.decidedAt,
				latestDecisionFreshnessStatus: latest?.freshnessStatus,
				latestDecisionKind: latest?.kind
			}
		});

		return {
			adaptiveNativePlannerBenchmark,
			baselines,
			corpusGroupKey:
				corpusGroupKey ??
				decisions?.[0]?.corpusGroupKey ??
				baselines?.[0]?.corpusGroupKey ??
				runs?.[0]?.corpusGroupKey,
			decisions,
			groupKey,
			ok: true,
			presentation,
			runs,
			timeline: {
				corpusGroupKey:
					corpusGroupKey ??
					decisions?.[0]?.corpusGroupKey ??
					baselines?.[0]?.corpusGroupKey ??
					runs?.[0]?.corpusGroupKey,
				groupKey,
				lastApprovedAt: decisions?.find(
					(entry) => entry.kind === 'approve'
				)?.decidedAt,
				lastPromotedAt: decisions?.find(
					(entry) => entry.kind === 'promote'
				)?.decidedAt,
				lastRejectedAt: decisions?.find(
					(entry) => entry.kind === 'reject'
				)?.decidedAt,
				lastRevertedAt: decisions?.find(
					(entry) => entry.kind === 'revert'
				)?.decidedAt,
				latestDecisionAt: latest?.decidedAt,
				latestDecisionFreshnessStatus: latest?.freshnessStatus,
				latestDecisionKind: latest?.kind
			},
			nativeBackendComparisonBenchmark,
			presentationCueBenchmark,
			spreadsheetCueBenchmark
		};
	};

	const loadAdaptiveNativePlannerBenchmarkRuntime = async (input?: {
		suite?: ReturnType<typeof createRAGAdaptiveNativePlannerBenchmarkSuite>;
		queryInput?: unknown;
		groupKey?: string;
		corpusGroupKey?: string;
		historyLimit?: number;
		snapshotLimit?: number;
	}): Promise<RAGAdaptiveNativePlannerBenchmarkRuntime> => {
		const suite =
			input?.suite ?? createRAGAdaptiveNativePlannerBenchmarkSuite();
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata?.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: undefined;
		const groupKey =
			input?.groupKey ??
			getStringProperty(input?.queryInput, 'benchmarkGroupKey') ??
			recommendedGroupKey;
		const corpusGroupKey =
			input?.corpusGroupKey ??
			getStringProperty(input?.queryInput, 'benchmarkCorpusGroupKey');
		const recentRuns = retrievalComparisonHistoryStore
			? await loadRAGRetrievalComparisonHistory({
					corpusGroupKey,
					groupKey,
					limit: input?.historyLimit ?? 5,
					store: retrievalComparisonHistoryStore,
					suiteId: suite.id
				})
			: undefined;
		const historyTimelineGroupKey = groupKey ?? recentRuns?.[0]?.groupKey;
		const historyPresentation =
			recentRuns && recentRuns.length > 0
				? buildRAGRetrievalReleaseGroupHistoryPresentation({
						runs: recentRuns,
						timeline: historyTimelineGroupKey
							? {
									corpusGroupKey:
										corpusGroupKey ??
										recentRuns[0]?.corpusGroupKey,
									groupKey: historyTimelineGroupKey
								}
							: undefined
					})
				: undefined;
		const snapshotHistory = config.evaluationSuiteSnapshotHistoryStore
			? await loadRAGEvaluationSuiteSnapshotHistory({
					limit: input?.snapshotLimit ?? 5,
					store: config.evaluationSuiteSnapshotHistoryStore,
					suite
				})
			: undefined;
		const fixtureVariants =
			getRetrievalBenchmarkFixtureVariants(recentRuns);

		return {
			corpusGroupKey,
			fixtureVariants,
			groupKey,
			historyPresentation,
			latestFixtureVariant: fixtureVariants[0],
			latestRun: recentRuns?.[0],
			recentRuns,
			recommendedGroupKey,
			recommendedTags,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suiteId: suite.id,
			suiteLabel: suite.label ?? suite.id
		};
	};

	const buildRetrievalBenchmarkBackendTags = () => {
		const status = resolveCollection()?.getStatus?.();
		const fixtureVariant = 'current-collection';
		if (!status) {
			return [`fixture:${fixtureVariant}`];
		}

		const tags = [
			`fixture:${fixtureVariant}`,
			`backend:${status.backend}`,
			`vector-mode:${status.vectorMode}`
		];
		if (status.native && 'mode' in status.native) {
			tags.push(`native-mode:${status.native.mode}`);
		}
		return tags;
	};

	const getRetrievalBenchmarkFixtureVariants = (
		runs?: RAGRetrievalComparisonRun[]
	) =>
		(runs ?? [])
			.flatMap((run) => run.tags ?? [])
			.filter((tag) => tag.startsWith('fixture:'))
			.map((tag) => tag.slice('fixture:'.length))
			.filter(
				(tag, index, all) =>
					tag.trim().length > 0 && all.indexOf(tag) === index
			);

	const ensureRetrievalBenchmarkFixtureTag = (tags: string[]) => {
		if (tags.some((tag) => tag.startsWith('fixture:'))) {
			return tags;
		}

		const fixtureTags = buildRetrievalBenchmarkBackendTags().filter((tag) =>
			tag.startsWith('fixture:')
		);
		return [...tags, ...fixtureTags].filter(
			(tag, index, all) => all.indexOf(tag) === index
		);
	};

	const loadNativeBackendComparisonBenchmarkRuntime = async (input?: {
		suite?: ReturnType<
			typeof createRAGNativeBackendComparisonBenchmarkSuite
		>;
		queryInput?: unknown;
		groupKey?: string;
		corpusGroupKey?: string;
		historyLimit?: number;
		snapshotLimit?: number;
	}): Promise<RAGNativeBackendComparisonBenchmarkRuntime> => {
		const suite =
			input?.suite ?? createRAGNativeBackendComparisonBenchmarkSuite();
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: undefined;
		const groupKey =
			input?.groupKey ??
			getStringProperty(input?.queryInput, 'benchmarkGroupKey') ??
			recommendedGroupKey;
		const corpusGroupKey =
			input?.corpusGroupKey ??
			getStringProperty(input?.queryInput, 'benchmarkCorpusGroupKey');
		const recentRuns = retrievalComparisonHistoryStore
			? await loadRAGRetrievalComparisonHistory({
					corpusGroupKey,
					groupKey,
					limit: input?.historyLimit ?? 5,
					store: retrievalComparisonHistoryStore,
					suiteId: suite.id
				})
			: undefined;
		const historyTimelineGroupKey = groupKey ?? recentRuns?.[0]?.groupKey;
		const historyPresentation =
			recentRuns && recentRuns.length > 0
				? buildRAGRetrievalReleaseGroupHistoryPresentation({
						runs: recentRuns,
						timeline: historyTimelineGroupKey
							? {
									corpusGroupKey:
										corpusGroupKey ??
										recentRuns[0]?.corpusGroupKey,
									groupKey: historyTimelineGroupKey
								}
							: undefined
					})
				: undefined;
		const snapshotHistory = config.evaluationSuiteSnapshotHistoryStore
			? await loadRAGEvaluationSuiteSnapshotHistory({
					limit: input?.snapshotLimit ?? 5,
					store: config.evaluationSuiteSnapshotHistoryStore,
					suite
				})
			: undefined;
		const fixtureVariants =
			getRetrievalBenchmarkFixtureVariants(recentRuns);

		return {
			corpusGroupKey,
			fixtureVariants,
			groupKey,
			historyPresentation,
			latestFixtureVariant: fixtureVariants[0],
			latestRun: recentRuns?.[0],
			recentRuns,
			recommendedGroupKey,
			recommendedTags,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suiteId: suite.id,
			suiteLabel: suite.label ?? suite.id
		};
	};

	const loadPresentationCueBenchmarkRuntime = async (input?: {
		suite?: ReturnType<typeof createRAGPresentationCueBenchmarkSuite>;
		queryInput?: unknown;
		groupKey?: string;
		corpusGroupKey?: string;
		historyLimit?: number;
		snapshotLimit?: number;
	}): Promise<RAGPresentationCueBenchmarkRuntime> => {
		const suite = input?.suite ?? createRAGPresentationCueBenchmarkSuite();
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: undefined;
		const groupKey =
			input?.groupKey ??
			getStringProperty(input?.queryInput, 'benchmarkGroupKey') ??
			recommendedGroupKey;
		const corpusGroupKey =
			input?.corpusGroupKey ??
			getStringProperty(input?.queryInput, 'benchmarkCorpusGroupKey');
		const recentRuns = retrievalComparisonHistoryStore
			? await loadRAGRetrievalComparisonHistory({
					corpusGroupKey,
					groupKey,
					limit: input?.historyLimit ?? 5,
					store: retrievalComparisonHistoryStore,
					suiteId: suite.id
				})
			: undefined;
		const historyTimelineGroupKey = groupKey ?? recentRuns?.[0]?.groupKey;
		const historyPresentation =
			recentRuns && recentRuns.length > 0
				? buildRAGRetrievalReleaseGroupHistoryPresentation({
						runs: recentRuns,
						timeline: historyTimelineGroupKey
							? {
									corpusGroupKey:
										corpusGroupKey ??
										recentRuns[0]?.corpusGroupKey,
									groupKey: historyTimelineGroupKey
								}
							: undefined
					})
				: undefined;
		const snapshotHistory = config.evaluationSuiteSnapshotHistoryStore
			? await loadRAGEvaluationSuiteSnapshotHistory({
					limit: input?.snapshotLimit ?? 5,
					store: config.evaluationSuiteSnapshotHistoryStore,
					suite
				})
			: undefined;
		const fixtureVariants =
			getRetrievalBenchmarkFixtureVariants(recentRuns);

		return {
			corpusGroupKey,
			fixtureVariants,
			groupKey,
			historyPresentation,
			latestFixtureVariant: fixtureVariants[0],
			latestRun: recentRuns?.[0],
			recentRuns,
			recommendedGroupKey,
			recommendedTags,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suiteId: suite.id,
			suiteLabel: suite.label ?? suite.id
		};
	};

	const loadSpreadsheetCueBenchmarkRuntime = async (input?: {
		suite?: ReturnType<typeof createRAGSpreadsheetCueBenchmarkSuite>;
		queryInput?: unknown;
		groupKey?: string;
		corpusGroupKey?: string;
		historyLimit?: number;
		snapshotLimit?: number;
	}): Promise<RAGSpreadsheetCueBenchmarkRuntime> => {
		const suite = input?.suite ?? createRAGSpreadsheetCueBenchmarkSuite();
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: undefined;
		const groupKey =
			input?.groupKey ??
			getStringProperty(input?.queryInput, 'benchmarkGroupKey') ??
			recommendedGroupKey;
		const corpusGroupKey =
			input?.corpusGroupKey ??
			getStringProperty(input?.queryInput, 'benchmarkCorpusGroupKey');
		const recentRuns = retrievalComparisonHistoryStore
			? await loadRAGRetrievalComparisonHistory({
					corpusGroupKey,
					groupKey,
					limit: input?.historyLimit ?? 5,
					store: retrievalComparisonHistoryStore,
					suiteId: suite.id
				})
			: undefined;
		const historyTimelineGroupKey = groupKey ?? recentRuns?.[0]?.groupKey;
		const historyPresentation =
			recentRuns && recentRuns.length > 0
				? buildRAGRetrievalReleaseGroupHistoryPresentation({
						runs: recentRuns,
						timeline: historyTimelineGroupKey
							? {
									corpusGroupKey:
										corpusGroupKey ??
										recentRuns[0]?.corpusGroupKey,
									groupKey: historyTimelineGroupKey
								}
							: undefined
					})
				: undefined;
		const snapshotHistory = config.evaluationSuiteSnapshotHistoryStore
			? await loadRAGEvaluationSuiteSnapshotHistory({
					limit: input?.snapshotLimit ?? 5,
					store: config.evaluationSuiteSnapshotHistoryStore,
					suite
				})
			: undefined;
		const fixtureVariants =
			getRetrievalBenchmarkFixtureVariants(recentRuns);

		return {
			corpusGroupKey,
			fixtureVariants,
			groupKey,
			historyPresentation,
			latestFixtureVariant: fixtureVariants[0],
			latestRun: recentRuns?.[0],
			recentRuns,
			recommendedGroupKey,
			recommendedTags,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suiteId: suite.id,
			suiteLabel: suite.label ?? suite.id
		};
	};

	const handleAdaptiveNativePlannerBenchmark = async (
		queryInput: unknown
	): Promise<RAGAdaptiveNativePlannerBenchmarkResponse> => {
		const suite = createRAGAdaptiveNativePlannerBenchmarkSuite({
			description: getStringProperty(queryInput, 'description'),
			label: getStringProperty(queryInput, 'label'),
			metadata: getObjectProperty(queryInput, 'metadata'),
			topK: getIntegerLikeProperty(queryInput, 'topK') ?? undefined
		});
		const runtime = await loadAdaptiveNativePlannerBenchmarkRuntime({
			historyLimit: getIntegerLikeProperty(queryInput, 'runLimit') ?? 5,
			queryInput,
			snapshotLimit: getIntegerLikeProperty(queryInput, 'limit') ?? 5,
			suite
		});

		return {
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handleNativeBackendComparisonBenchmark = async (
		queryInput: unknown
	): Promise<RAGNativeBackendComparisonBenchmarkResponse> => {
		const suite = createRAGNativeBackendComparisonBenchmarkSuite({
			description: getStringProperty(queryInput, 'description'),
			label: getStringProperty(queryInput, 'label'),
			metadata: getObjectProperty(queryInput, 'metadata'),
			topK: getIntegerLikeProperty(queryInput, 'topK') ?? undefined
		});
		const runtime = await loadNativeBackendComparisonBenchmarkRuntime({
			historyLimit: getIntegerLikeProperty(queryInput, 'runLimit') ?? 5,
			queryInput,
			snapshotLimit: getIntegerLikeProperty(queryInput, 'limit') ?? 5,
			suite
		});

		return {
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handlePresentationCueBenchmark = async (
		queryInput: unknown
	): Promise<RAGPresentationCueBenchmarkResponse> => {
		const suite = createRAGPresentationCueBenchmarkSuite({
			description: getStringProperty(queryInput, 'description'),
			label: getStringProperty(queryInput, 'label'),
			metadata: getObjectProperty(queryInput, 'metadata'),
			topK: getIntegerLikeProperty(queryInput, 'topK') ?? undefined
		});
		const runtime = await loadPresentationCueBenchmarkRuntime({
			historyLimit: getIntegerLikeProperty(queryInput, 'runLimit') ?? 5,
			queryInput,
			snapshotLimit: getIntegerLikeProperty(queryInput, 'limit') ?? 5,
			suite
		});

		return {
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handleSpreadsheetCueBenchmark = async (
		queryInput: unknown
	): Promise<RAGSpreadsheetCueBenchmarkResponse> => {
		const suite = createRAGSpreadsheetCueBenchmarkSuite({
			description: getStringProperty(queryInput, 'description'),
			label: getStringProperty(queryInput, 'label'),
			metadata: getObjectProperty(queryInput, 'metadata'),
			topK: getIntegerLikeProperty(queryInput, 'topK') ?? undefined
		});
		const runtime = await loadSpreadsheetCueBenchmarkRuntime({
			historyLimit: getIntegerLikeProperty(queryInput, 'runLimit') ?? 5,
			queryInput,
			snapshotLimit: getIntegerLikeProperty(queryInput, 'limit') ?? 5,
			suite
		});

		return {
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handleRunAdaptiveNativePlannerBenchmark = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGAdaptiveNativePlannerBenchmarkResponse> => {
		const suite = createRAGAdaptiveNativePlannerBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata'),
			topK: getIntegerLikeProperty(bodyInput, 'topK') ?? undefined
		});
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: [];
		const explicitTags = normalizeStringArray(
			(bodyInput as { tags?: unknown })?.tags
		);
		const comparisonBody = {
			...suite.input,
			baselineRetrievalId:
				getStringProperty(bodyInput, 'baselineRetrievalId') ??
				'native-latency',
			candidateRetrievalId:
				getStringProperty(bodyInput, 'candidateRetrievalId') ??
				'native-adaptive',
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			label: suite.label,
			persistRun: getBooleanProperty(bodyInput, 'persistRun') !== false,
			suiteId: suite.id,
			retrievals: Array.isArray(
				(bodyInput as { retrievals?: unknown })?.retrievals
			)
				? (bodyInput as { retrievals: unknown[] }).retrievals
				: [
						{
							id: 'native-latency',
							label: 'Native latency',
							retrieval: {
								mode: 'vector',
								nativeQueryProfile: 'latency'
							}
						},
						{
							id: 'native-adaptive',
							label: 'Adaptive native planner',
							retrieval: {
								mode: 'vector'
							}
						},
						{
							id: 'hybrid-adaptive',
							label: 'Hybrid adaptive',
							retrieval: {
								mode: 'hybrid'
							}
						},
						{
							id: 'hybrid-transform',
							label: 'Hybrid transform',
							queryTransform: createHeuristicRAGQueryTransform(),
							retrieval: {
								mode: 'hybrid'
							}
						}
					],
			tags:
				explicitTags.length > 0
					? ensureRetrievalBenchmarkFixtureTag(explicitTags)
					: ensureRetrievalBenchmarkFixtureTag(recommendedTags)
		};
		const comparisonResult = await handleEvaluateRetrievals(
			comparisonBody,
			request
		);
		if (!comparisonResult.ok) {
			return {
				error: comparisonResult.error,
				ok: false
			};
		}

		const runtime = await loadAdaptiveNativePlannerBenchmarkRuntime({
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			historyLimit: getIntegerLikeProperty(bodyInput, 'runLimit') ?? 5,
			snapshotLimit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			suite
		});

		return {
			comparison: comparisonResult.comparison,
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handleRunNativeBackendComparisonBenchmark = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGNativeBackendComparisonBenchmarkResponse> => {
		const suite = createRAGNativeBackendComparisonBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata'),
			topK: getIntegerLikeProperty(bodyInput, 'topK') ?? undefined
		});
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: [];
		const explicitTags = normalizeStringArray(
			(bodyInput as { tags?: unknown })?.tags
		);
		const comparisonBody = {
			...suite.input,
			baselineRetrievalId:
				getStringProperty(bodyInput, 'baselineRetrievalId') ??
				'native-latency',
			candidateRetrievalId:
				getStringProperty(bodyInput, 'candidateRetrievalId') ??
				'native-adaptive',
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			label: suite.label,
			persistRun: getBooleanProperty(bodyInput, 'persistRun') !== false,
			suiteId: suite.id,
			retrievals: Array.isArray(
				(bodyInput as { retrievals?: unknown })?.retrievals
			)
				? (bodyInput as { retrievals: unknown[] }).retrievals
				: [
						{
							id: 'native-latency',
							label: 'Native latency',
							retrieval: {
								mode: 'vector',
								nativeQueryProfile: 'latency'
							}
						},
						{
							id: 'native-adaptive',
							label: 'Adaptive native planner',
							retrieval: {
								mode: 'vector'
							}
						},
						{
							id: 'hybrid-adaptive',
							label: 'Hybrid adaptive',
							retrieval: {
								mode: 'hybrid'
							}
						},
						{
							id: 'hybrid-transform',
							label: 'Hybrid transform',
							queryTransform: createHeuristicRAGQueryTransform(),
							retrieval: {
								mode: 'hybrid'
							}
						}
					],
			tags:
				explicitTags.length > 0
					? ensureRetrievalBenchmarkFixtureTag(explicitTags)
					: ensureRetrievalBenchmarkFixtureTag([
							...recommendedTags,
							...buildRetrievalBenchmarkBackendTags()
						])
		};
		const comparisonResult = await handleEvaluateRetrievals(
			comparisonBody,
			request
		);
		if (!comparisonResult.ok) {
			return {
				error: comparisonResult.error,
				ok: false
			};
		}

		const runtime = await loadNativeBackendComparisonBenchmarkRuntime({
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			historyLimit: getIntegerLikeProperty(bodyInput, 'runLimit') ?? 5,
			snapshotLimit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			suite
		});

		return {
			comparison: comparisonResult.comparison,
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handleRunPresentationCueBenchmark = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGPresentationCueBenchmarkResponse> => {
		const suite = createRAGPresentationCueBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata'),
			topK: getIntegerLikeProperty(bodyInput, 'topK') ?? undefined
		});
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: [];
		const explicitTags = normalizeStringArray(
			(bodyInput as { tags?: unknown })?.tags
		);
		const comparisonBody = {
			...suite.input,
			baselineRetrievalId:
				getStringProperty(bodyInput, 'baselineRetrievalId') ??
				'presentation-baseline',
			candidateRetrievalId:
				getStringProperty(bodyInput, 'candidateRetrievalId') ??
				'presentation-cue-aware',
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			label: suite.label,
			persistRun: getBooleanProperty(bodyInput, 'persistRun') !== false,
			suiteId: suite.id,
			retrievals: Array.isArray(
				(bodyInput as { retrievals?: unknown })?.retrievals
			)
				? (bodyInput as { retrievals: unknown[] }).retrievals
				: [
						{
							id: 'presentation-baseline',
							label: 'Presentation baseline',
							retrieval: {
								mode: 'vector'
							}
						},
						{
							id: 'presentation-cue-aware',
							label: 'Presentation cue aware',
							rerank: createHeuristicRAGReranker(),
							retrieval: {
								mode: 'vector'
							}
						}
					],
			tags:
				explicitTags.length > 0
					? ensureRetrievalBenchmarkFixtureTag(explicitTags)
					: ensureRetrievalBenchmarkFixtureTag(recommendedTags)
		};
		const comparisonResult = await handleEvaluateRetrievals(
			comparisonBody,
			request
		);
		if (!comparisonResult.ok) {
			return {
				error: comparisonResult.error,
				ok: false
			};
		}

		const runtime = await loadPresentationCueBenchmarkRuntime({
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			historyLimit: getIntegerLikeProperty(bodyInput, 'runLimit') ?? 5,
			snapshotLimit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			suite
		});

		return {
			comparison: comparisonResult.comparison,
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handleRunSpreadsheetCueBenchmark = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGSpreadsheetCueBenchmarkResponse> => {
		const suite = createRAGSpreadsheetCueBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata'),
			topK: getIntegerLikeProperty(bodyInput, 'topK') ?? undefined
		});
		const recommendedGroupKey =
			typeof suite.metadata?.recommendedGroupKey === 'string'
				? suite.metadata.recommendedGroupKey
				: undefined;
		const recommendedTags = Array.isArray(suite.metadata?.recommendedTags)
			? suite.metadata.recommendedTags.filter(
					(entry): entry is string => typeof entry === 'string'
				)
			: [];
		const explicitTags = normalizeStringArray(
			(bodyInput as { tags?: unknown })?.tags
		);
		const comparisonBody = {
			...suite.input,
			baselineRetrievalId:
				getStringProperty(bodyInput, 'baselineRetrievalId') ??
				'spreadsheet-baseline',
			candidateRetrievalId:
				getStringProperty(bodyInput, 'candidateRetrievalId') ??
				'spreadsheet-cue-aware',
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			label: suite.label,
			persistRun: getBooleanProperty(bodyInput, 'persistRun') !== false,
			suiteId: suite.id,
			retrievals: Array.isArray(
				(bodyInput as { retrievals?: unknown })?.retrievals
			)
				? (bodyInput as { retrievals: unknown[] }).retrievals
				: [
						{
							id: 'spreadsheet-baseline',
							label: 'Spreadsheet baseline',
							retrieval: {
								mode: 'vector'
							}
						},
						{
							id: 'spreadsheet-cue-aware',
							label: 'Spreadsheet cue aware',
							rerank: createHeuristicRAGReranker(),
							retrieval: {
								mode: 'vector'
							}
						}
					],
			tags:
				explicitTags.length > 0
					? ensureRetrievalBenchmarkFixtureTag(explicitTags)
					: ensureRetrievalBenchmarkFixtureTag(recommendedTags)
		};
		const comparisonResult = await handleEvaluateRetrievals(
			comparisonBody,
			request
		);
		if (!comparisonResult.ok) {
			return {
				error: comparisonResult.error,
				ok: false
			};
		}

		const runtime = await loadSpreadsheetCueBenchmarkRuntime({
			corpusGroupKey: getStringProperty(bodyInput, 'corpusGroupKey'),
			groupKey:
				getStringProperty(bodyInput, 'groupKey') ?? recommendedGroupKey,
			historyLimit: getIntegerLikeProperty(bodyInput, 'runLimit') ?? 5,
			snapshotLimit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			suite
		});

		return {
			comparison: comparisonResult.comparison,
			corpusGroupKey: runtime.corpusGroupKey,
			fixtureVariants: runtime.fixtureVariants,
			groupKey: runtime.groupKey,
			historyPresentation: runtime.historyPresentation,
			latestFixtureVariant: runtime.latestFixtureVariant,
			latestRun: runtime.latestRun,
			ok: true,
			recentRuns: runtime.recentRuns,
			snapshotHistory: runtime.snapshotHistory,
			snapshotHistoryPresentation: runtime.snapshotHistoryPresentation,
			suite
		};
	};

	const handlePersistAdaptiveNativePlannerBenchmarkSnapshot = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGAdaptiveNativePlannerBenchmarkSnapshotResponse> => {
		if (request) {
			const decision = await checkAuthorization(
				request,
				'manage_retrieval_admin'
			);
			if (!decision.allowed) {
				return {
					error: decision.reason ?? 'Forbidden',
					ok: false
				};
			}
		}

		if (!config.evaluationSuiteSnapshotHistoryStore) {
			return {
				error: 'Evaluation suite snapshot history store is not configured',
				ok: false
			};
		}

		const suite = createRAGAdaptiveNativePlannerBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata')
		});
		const previousHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: 1,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});
		const snapshot = createRAGAdaptiveNativePlannerBenchmarkSnapshot({
			createdAt: getNumberProperty(bodyInput, 'createdAt'),
			metadata: getObjectProperty(bodyInput, 'snapshotMetadata'),
			suite,
			version:
				getIntegerLikeProperty(bodyInput, 'version') ??
				(previousHistory.latestSnapshot?.version ?? 0) + 1
		});
		await config.evaluationSuiteSnapshotHistoryStore.saveSnapshot(snapshot);
		const snapshotHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});

		return {
			ok: true,
			snapshot,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suite
		};
	};

	const handlePersistNativeBackendComparisonBenchmarkSnapshot = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGNativeBackendComparisonBenchmarkSnapshotResponse> => {
		if (request) {
			const decision = await checkAuthorization(
				request,
				'manage_retrieval_admin'
			);
			if (!decision.allowed) {
				return {
					error: decision.reason ?? 'Forbidden',
					ok: false
				};
			}
		}

		if (!config.evaluationSuiteSnapshotHistoryStore) {
			return {
				error: 'Evaluation suite snapshot history store is not configured',
				ok: false
			};
		}

		const suite = createRAGNativeBackendComparisonBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata')
		});
		const previousHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: 1,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});
		const snapshot = createRAGNativeBackendComparisonBenchmarkSnapshot({
			createdAt: getNumberProperty(bodyInput, 'createdAt'),
			metadata: getObjectProperty(bodyInput, 'snapshotMetadata'),
			suite,
			version:
				getIntegerLikeProperty(bodyInput, 'version') ??
				(previousHistory.latestSnapshot?.version ?? 0) + 1
		});
		await config.evaluationSuiteSnapshotHistoryStore.saveSnapshot(snapshot);
		const snapshotHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});

		return {
			ok: true,
			snapshot,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suite
		};
	};

	const handlePersistPresentationCueBenchmarkSnapshot = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGPresentationCueBenchmarkSnapshotResponse> => {
		if (request) {
			const decision = await checkAuthorization(
				request,
				'manage_retrieval_admin'
			);
			if (!decision.allowed) {
				return {
					error: decision.reason ?? 'Forbidden',
					ok: false
				};
			}
		}

		if (!config.evaluationSuiteSnapshotHistoryStore) {
			return {
				error: 'Evaluation suite snapshot history store is not configured',
				ok: false
			};
		}

		const suite = createRAGPresentationCueBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata')
		});
		const previousHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: 1,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});
		const snapshot = createRAGPresentationCueBenchmarkSnapshot({
			createdAt: getNumberProperty(bodyInput, 'createdAt'),
			metadata: getObjectProperty(bodyInput, 'snapshotMetadata'),
			suite,
			version:
				getIntegerLikeProperty(bodyInput, 'version') ??
				(previousHistory.latestSnapshot?.version ?? 0) + 1
		});
		await config.evaluationSuiteSnapshotHistoryStore.saveSnapshot(snapshot);
		const snapshotHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});

		return {
			ok: true,
			snapshot,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suite
		};
	};

	const handlePersistSpreadsheetCueBenchmarkSnapshot = async (
		bodyInput: unknown,
		request?: Request
	): Promise<RAGSpreadsheetCueBenchmarkSnapshotResponse> => {
		if (request) {
			const decision = await checkAuthorization(
				request,
				'manage_retrieval_admin'
			);
			if (!decision.allowed) {
				return {
					error: decision.reason ?? 'Forbidden',
					ok: false
				};
			}
		}

		if (!config.evaluationSuiteSnapshotHistoryStore) {
			return {
				error: 'Evaluation suite snapshot history store is not configured',
				ok: false
			};
		}

		const suite = createRAGSpreadsheetCueBenchmarkSuite({
			description: getStringProperty(bodyInput, 'description'),
			label: getStringProperty(bodyInput, 'label'),
			metadata: getObjectProperty(bodyInput, 'metadata')
		});
		const previousHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: 1,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});
		const snapshot = createRAGSpreadsheetCueBenchmarkSnapshot({
			createdAt: getNumberProperty(bodyInput, 'createdAt'),
			metadata: getObjectProperty(bodyInput, 'snapshotMetadata'),
			suite,
			version:
				getIntegerLikeProperty(bodyInput, 'version') ??
				(previousHistory.latestSnapshot?.version ?? 0) + 1
		});
		await config.evaluationSuiteSnapshotHistoryStore.saveSnapshot(snapshot);
		const snapshotHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			limit: getIntegerLikeProperty(bodyInput, 'limit') ?? 5,
			store: config.evaluationSuiteSnapshotHistoryStore,
			suite
		});

		return {
			ok: true,
			snapshot,
			snapshotHistory,
			snapshotHistoryPresentation:
				buildRAGEvaluationSuiteSnapshotHistoryPresentation(
					snapshotHistory
				),
			suite
		};
	};

	const handleRetrievalLaneHandoffList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalLaneHandoffListResponse> => {
		const result = await buildOperationsPayload();
		const accessScope = await loadAccessScope(request);
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const sourceRolloutLabel = getStringProperty(
			queryInput,
			'sourceRolloutLabel'
		);
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const limit = getIntegerLikeProperty(queryInput, 'limit');
		const handoffs = (
			result.retrievalComparisons?.releaseLaneHandoffs ?? []
		).filter(
			(entry) =>
				(!corpusGroupKey || entry.corpusGroupKey === corpusGroupKey) &&
				(!getStringProperty(queryInput, 'groupKey') ||
					entry.groupKey ===
						getStringProperty(queryInput, 'groupKey')) &&
				((sourceRolloutLabel !== 'canary' &&
					sourceRolloutLabel !== 'stable' &&
					sourceRolloutLabel !== 'rollback_target') ||
					entry.sourceRolloutLabel === sourceRolloutLabel) &&
				((targetRolloutLabel !== 'canary' &&
					targetRolloutLabel !== 'stable' &&
					targetRolloutLabel !== 'rollback_target') ||
					entry.targetRolloutLabel === targetRolloutLabel)
		);
		return {
			handoffs:
				typeof limit === 'number' ? handoffs.slice(0, limit) : handoffs,
			ok: true
		};
	};

	const handleRetrievalLaneHandoffDecisionList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalLaneHandoffDecisionListResponse> => {
		if (!config.retrievalLaneHandoffDecisionStore) {
			return {
				error: 'RAG retrieval lane handoff decision store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval lane handoff decision group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff decision corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const sourceRolloutLabel = getStringProperty(
			queryInput,
			'sourceRolloutLabel'
		);
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const kind = getStringProperty(queryInput, 'kind');
		const decisions = await loadRAGRetrievalLaneHandoffDecisions({
			corpusGroupKey,
			groupKey,
			kind:
				kind === 'approve' || kind === 'reject' || kind === 'complete'
					? kind
					: undefined,
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			sourceRolloutLabel:
				sourceRolloutLabel === 'canary' ||
				sourceRolloutLabel === 'stable' ||
				sourceRolloutLabel === 'rollback_target'
					? sourceRolloutLabel
					: undefined,
			store: config.retrievalLaneHandoffDecisionStore,
			targetRolloutLabel:
				targetRolloutLabel === 'canary' ||
				targetRolloutLabel === 'stable' ||
				targetRolloutLabel === 'rollback_target'
					? targetRolloutLabel
					: undefined
		});
		return {
			decisions: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, decisions)
			),
			ok: true
		};
	};

	const handleRetrievalLaneHandoffIncidentList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalLaneHandoffIncidentListResponse> => {
		if (!config.retrievalLaneHandoffIncidentStore) {
			return {
				error: 'RAG retrieval lane handoff incident store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval lane handoff incident group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff incident corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const status = getStringProperty(queryInput, 'status');
		const severity = getStringProperty(queryInput, 'severity');
		const incidents = await loadRAGRetrievalLaneHandoffIncidents({
			corpusGroupKey,
			groupKey,
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			severity:
				severity === 'warning' || severity === 'critical'
					? severity
					: undefined,
			status:
				status === 'open' || status === 'resolved' ? status : undefined,
			store: config.retrievalLaneHandoffIncidentStore,
			targetRolloutLabel:
				targetRolloutLabel === 'canary' ||
				targetRolloutLabel === 'stable' ||
				targetRolloutLabel === 'rollback_target'
					? targetRolloutLabel
					: undefined
		});
		return {
			incidents: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, incidents)
			),
			ok: true
		};
	};

	const handleRetrievalLaneHandoffIncidentHistoryList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalLaneHandoffIncidentHistoryResponse> => {
		if (!config.retrievalLaneHandoffIncidentHistoryStore) {
			return {
				error: 'RAG retrieval lane handoff incident history store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval lane handoff incident history group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff incident history corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const action = getStringProperty(queryInput, 'action');
		const records = await loadRAGRetrievalLaneHandoffIncidentHistory({
			corpusGroupKey,
			action:
				action === 'opened' ||
				action === 'acknowledged' ||
				action === 'unacknowledged' ||
				action === 'resolved'
					? action
					: undefined,
			groupKey,
			incidentId: getStringProperty(queryInput, 'incidentId'),
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			store: config.retrievalLaneHandoffIncidentHistoryStore,
			targetRolloutLabel:
				targetRolloutLabel === 'canary' ||
				targetRolloutLabel === 'stable' ||
				targetRolloutLabel === 'rollback_target'
					? targetRolloutLabel
					: undefined
		});
		return {
			ok: true,
			records: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, records)
			)
		};
	};

	const handleRetrievalLaneHandoffAutoCompletePolicyHistoryList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalLaneHandoffAutoCompletePolicyHistoryResponse> => {
		if (!config.retrievalLaneHandoffAutoCompletePolicyHistoryStore) {
			return {
				error: 'RAG retrieval lane handoff auto-complete policy history store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval lane handoff auto-complete policy group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff auto-complete policy corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const records =
			await loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory({
				corpusGroupKey,
				groupKey,
				limit: getIntegerLikeProperty(queryInput, 'limit'),
				store: config.retrievalLaneHandoffAutoCompletePolicyHistoryStore,
				targetRolloutLabel:
					targetRolloutLabel === 'canary' ||
					targetRolloutLabel === 'stable' ||
					targetRolloutLabel === 'rollback_target'
						? targetRolloutLabel
						: undefined
			});
		return {
			ok: true,
			records: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, records)
			)
		};
	};

	const handleRetrievalReleaseLanePolicyHistoryList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalReleaseLanePolicyHistoryResponse> => {
		if (!config.retrievalReleaseLanePolicyHistoryStore) {
			return {
				error: 'RAG retrieval release lane policy history store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval release lane policy group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval release lane policy corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const rolloutLabel = getStringProperty(queryInput, 'rolloutLabel');
		const scope = getStringProperty(queryInput, 'scope');
		const records = await loadRAGRetrievalReleaseLanePolicyHistory({
			corpusGroupKey,
			groupKey,
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			rolloutLabel:
				rolloutLabel === 'canary' ||
				rolloutLabel === 'stable' ||
				rolloutLabel === 'rollback_target'
					? rolloutLabel
					: undefined,
			scope:
				scope === 'rollout_label' || scope === 'group_rollout_label'
					? scope
					: undefined,
			store: config.retrievalReleaseLanePolicyHistoryStore
		});
		return {
			ok: true,
			records: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, records)
			)
		};
	};

	const handleRetrievalBaselineGatePolicyHistoryList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalBaselineGatePolicyHistoryResponse> => {
		if (!config.retrievalBaselineGatePolicyHistoryStore) {
			return {
				error: 'RAG retrieval baseline gate policy history store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval baseline gate policy group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval baseline gate policy corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const rolloutLabel = getStringProperty(queryInput, 'rolloutLabel');
		const scope = getStringProperty(queryInput, 'scope');
		const records = await loadRAGRetrievalBaselineGatePolicyHistory({
			corpusGroupKey,
			groupKey,
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			rolloutLabel:
				rolloutLabel === 'canary' ||
				rolloutLabel === 'stable' ||
				rolloutLabel === 'rollback_target'
					? rolloutLabel
					: undefined,
			scope:
				scope === 'rollout_label' || scope === 'group_rollout_label'
					? scope
					: undefined,
			store: config.retrievalBaselineGatePolicyHistoryStore
		});
		return {
			ok: true,
			records: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, records)
			)
		};
	};

	const handleRetrievalReleaseLaneEscalationPolicyHistoryList = async (
		queryInput: unknown,
		request?: Request
	): Promise<RAGRetrievalReleaseLaneEscalationPolicyHistoryResponse> => {
		if (!config.retrievalReleaseLaneEscalationPolicyHistoryStore) {
			return {
				error: 'RAG retrieval release lane escalation policy history store is not configured',
				ok: false
			};
		}
		const accessScope = await loadAccessScope(request);
		const groupKey = getStringProperty(queryInput, 'groupKey');
		const corpusGroupKey = getStringProperty(queryInput, 'corpusGroupKey');
		if (!isAllowedComparisonGroupKey(accessScope, groupKey)) {
			return {
				error: 'Retrieval release lane escalation policy group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval release lane escalation policy corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const records =
			await loadRAGRetrievalReleaseLaneEscalationPolicyHistory({
				corpusGroupKey,
				groupKey,
				limit: getIntegerLikeProperty(queryInput, 'limit'),
				store: config.retrievalReleaseLaneEscalationPolicyHistoryStore,
				targetRolloutLabel:
					targetRolloutLabel === 'canary' ||
					targetRolloutLabel === 'stable' ||
					targetRolloutLabel === 'rollback_target'
						? targetRolloutLabel
						: undefined
			});
		return {
			ok: true,
			records: filterByCorpusGroupKey(
				accessScope,
				filterByComparisonGroupKey(accessScope, records)
			)
		};
	};

	const handleRetrievalLaneHandoffDecision = async (
		body: unknown
	): Promise<RAGRetrievalLaneHandoffDecisionResponse> => {
		if (!config.retrievalLaneHandoffDecisionStore) {
			return {
				error: 'RAG retrieval lane handoff decision store is not configured',
				ok: false
			};
		}
		const input = toRAGRetrievalLaneHandoffDecisionRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { groupKey, sourceRolloutLabel, targetRolloutLabel, kind }',
				ok: false
			};
		}
		const accessScope = await loadAccessScope();
		if (!isAllowedComparisonGroupKey(accessScope, input.groupKey)) {
			return {
				error: 'Retrieval lane handoff group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (!isAllowedCorpusGroupKey(accessScope, input.corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		const ops = await buildOperationsPayload();
		const handoff = ops.retrievalComparisons?.releaseLaneHandoffs?.find(
			(entry) =>
				entry.groupKey === input.groupKey &&
				entry.sourceRolloutLabel === input.sourceRolloutLabel &&
				entry.targetRolloutLabel === input.targetRolloutLabel
		);
		if (!handoff) {
			return {
				error: 'Retrieval lane handoff was not found',
				ok: false
			};
		}
		const corpusGroupKey = input.corpusGroupKey ?? handoff.corpusGroupKey;
		if (!isAllowedCorpusGroupKey(accessScope, corpusGroupKey)) {
			return {
				error: 'Retrieval lane handoff corpus group is outside the allowed RAG access scope',
				ok: false
			};
		}
		if (input.kind === 'approve' && handoff.readyForHandoff !== true) {
			return {
				error: `handoff is not ready: ${handoff.reasons.join('; ')}`,
				ok: false
			};
		}
		if (input.kind === 'reject' && !input.notes?.trim()) {
			return {
				error: 'notes are required when rejecting a handoff',
				ok: false
			};
		}
		let promotionResult: RAGRetrievalBaselineResponse | undefined;
		if (input.kind === 'complete' && input.executePromotion === true) {
			if (handoff.readyForHandoff !== true) {
				return {
					error: `handoff is not ready: ${handoff.reasons.join('; ')}`,
					ok: false
				};
			}
			promotionResult = await handlePromoteRetrievalBaselineFromRun({
				approvalNotes: input.notes,
				approvedAt: input.decidedAt,
				approvedBy: input.decidedBy,
				corpusGroupKey,
				groupKey: input.groupKey,
				retrievalId:
					input.candidateRetrievalId ?? handoff.candidateRetrievalId,
				rolloutLabel: input.targetRolloutLabel,
				sourceRunId:
					input.sourceRunId ?? handoff.targetReadiness?.sourceRunId
			});
			if (!promotionResult.ok || !promotionResult.baseline) {
				return {
					error:
						promotionResult.error ??
						'failed to complete retrieval lane handoff promotion',
					ok: false
				};
			}
		}
		const decision = await persistRAGRetrievalLaneHandoffDecision({
			record: {
				candidateRetrievalId:
					input.candidateRetrievalId ?? handoff.candidateRetrievalId,
				corpusGroupKey,
				decidedAt: input.decidedAt ?? Date.now(),
				decidedBy: input.decidedBy,
				groupKey: input.groupKey,
				id: generateId(),
				kind: input.kind,
				notes: input.notes,
				sourceBaselineRetrievalId: handoff.sourceBaselineRetrievalId,
				sourceRolloutLabel: input.sourceRolloutLabel,
				sourceRunId:
					input.sourceRunId ?? handoff.targetReadiness?.sourceRunId,
				targetBaselineRetrievalId: handoff.targetBaselineRetrievalId,
				targetRolloutLabel: input.targetRolloutLabel
			},
			store: config.retrievalLaneHandoffDecisionStore
		});
		const autoCompletePolicy = getRetrievalLaneHandoffAutoCompletePolicy(
			input.groupKey,
			input.targetRolloutLabel
		);
		if (
			input.kind === 'approve' &&
			autoCompletePolicy.enabled === true &&
			handoff.readyForHandoff === true
		) {
			const approvedAt = input.decidedAt ?? Date.now();
			if (
				typeof autoCompletePolicy.maxApprovedDecisionAgeMs ===
					'number' &&
				Date.now() - approvedAt >
					autoCompletePolicy.maxApprovedDecisionAgeMs
			) {
				return {
					error: 'auto-complete policy requires a fresher handoff approval before promotion',
					ok: false
				};
			}
			promotionResult = await handlePromoteRetrievalBaselineFromRun({
				approvalNotes: input.notes,
				approvedAt,
				approvedBy: input.decidedBy,
				corpusGroupKey,
				groupKey: input.groupKey,
				retrievalId:
					input.candidateRetrievalId ?? handoff.candidateRetrievalId,
				rolloutLabel: input.targetRolloutLabel,
				sourceRunId:
					input.sourceRunId ?? handoff.targetReadiness?.sourceRunId
			});
			if (!promotionResult.ok || !promotionResult.baseline) {
				return {
					error:
						promotionResult.error ??
						'failed to auto-complete retrieval lane handoff promotion',
					ok: false
				};
			}
			await persistRAGRetrievalLaneHandoffDecision({
				record: {
					candidateRetrievalId:
						input.candidateRetrievalId ??
						handoff.candidateRetrievalId,
					corpusGroupKey,
					decidedAt: Date.now(),
					decidedBy: input.decidedBy,
					groupKey: input.groupKey,
					id: generateId(),
					kind: 'complete',
					notes: 'auto-completed after approved handoff',
					sourceBaselineRetrievalId:
						handoff.sourceBaselineRetrievalId,
					sourceRolloutLabel: input.sourceRolloutLabel,
					sourceRunId:
						input.sourceRunId ??
						handoff.targetReadiness?.sourceRunId,
					targetBaselineRetrievalId:
						promotionResult.baseline.retrievalId,
					targetRolloutLabel: input.targetRolloutLabel
				},
				store: config.retrievalLaneHandoffDecisionStore
			});
		}
		return {
			baseline: promotionResult?.baseline,
			decision,
			rolloutState: promotionResult?.rolloutState,
			ok: true
		};
	};

	const handleRetrievalReleaseIncidentList = async (
		queryInput: unknown
	): Promise<RAGRetrievalReleaseIncidentListResponse> => {
		if (!config.retrievalReleaseIncidentStore) {
			return {
				error: 'RAG retrieval release incident store is not configured',
				ok: false
			};
		}

		const severity = getStringProperty(queryInput, 'severity');
		const status = getStringProperty(queryInput, 'status');
		const kind = getStringProperty(queryInput, 'kind');
		const acknowledged = getStringProperty(queryInput, 'acknowledged');
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const incidents = await loadRAGRetrievalReleaseIncidents({
			corpusGroupKey: getStringProperty(queryInput, 'corpusGroupKey'),
			groupKey: getStringProperty(queryInput, 'groupKey'),
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			severity:
				severity === 'warning' || severity === 'critical'
					? severity
					: undefined,
			status:
				status === 'open' || status === 'resolved' ? status : undefined,
			targetRolloutLabel:
				targetRolloutLabel === 'canary' ||
				targetRolloutLabel === 'stable' ||
				targetRolloutLabel === 'rollback_target'
					? targetRolloutLabel
					: undefined,
			store: config.retrievalReleaseIncidentStore
		});
		return {
			incidents: incidents.filter((incident) => {
				if (
					kind &&
					kind !== 'approval_expired' &&
					kind !== 'baseline_regression' &&
					kind !== 'gate_failure' &&
					kind !== 'handoff_stale'
				) {
					return false;
				}
				if (kind && incident.kind !== kind) {
					return false;
				}
				if (
					acknowledged === 'true' &&
					typeof incident.acknowledgedAt !== 'number'
				) {
					return false;
				}
				if (
					acknowledged === 'false' &&
					typeof incident.acknowledgedAt === 'number'
				) {
					return false;
				}
				return true;
			}),
			ok: true
		};
	};

	const handleRetrievalIncidentRemediationDecisionList = async (
		queryInput: unknown
	): Promise<RAGRetrievalIncidentRemediationDecisionListResponse> => {
		if (!config.retrievalIncidentRemediationDecisionStore) {
			return {
				error: 'RAG retrieval incident remediation decision store is not configured',
				ok: false
			};
		}

		const remediationKind = getStringProperty(
			queryInput,
			'remediationKind'
		);
		const status = getStringProperty(queryInput, 'status');
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		return {
			ok: true,
			records: await loadRAGRetrievalIncidentRemediationDecisions({
				groupKey: getStringProperty(queryInput, 'groupKey'),
				incidentId: getStringProperty(queryInput, 'incidentId'),
				limit: getIntegerLikeProperty(queryInput, 'limit'),
				remediationKind:
					remediationKind === 'renew_approval' ||
					remediationKind === 'record_approval' ||
					remediationKind === 'inspect_gate' ||
					remediationKind === 'rerun_comparison' ||
					remediationKind === 'restore_source_lane' ||
					remediationKind === 'review_readiness' ||
					remediationKind === 'monitor_lane'
						? remediationKind
						: undefined,
				status:
					status === 'planned' ||
					status === 'applied' ||
					status === 'dismissed'
						? status
						: undefined,
				store: config.retrievalIncidentRemediationDecisionStore,
				targetRolloutLabel:
					targetRolloutLabel === 'canary' ||
					targetRolloutLabel === 'stable' ||
					targetRolloutLabel === 'rollback_target'
						? targetRolloutLabel
						: undefined
			})
		};
	};

	const handleRecordRetrievalIncidentRemediationDecision = async (
		body: unknown
	): Promise<RAGRetrievalIncidentRemediationDecisionListResponse> => {
		if (!config.retrievalIncidentRemediationDecisionStore) {
			return {
				error: 'RAG retrieval incident remediation decision store is not configured',
				ok: false
			};
		}
		if (!config.retrievalReleaseIncidentStore) {
			return {
				error: 'RAG retrieval release incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalIncidentRemediationDecisionRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId, remediationKind, status?, decidedAt?, decidedBy?, notes?, action? }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalReleaseIncidents({
			limit: 200,
			store: config.retrievalReleaseIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval release incident was not found',
				ok: false
			};
		}

		await persistRAGRetrievalIncidentRemediationDecision({
			record: {
				action: input.action,
				decidedAt: input.decidedAt ?? Date.now(),
				decidedBy: input.decidedBy,
				groupKey: incident.groupKey,
				id: generateId(),
				incidentId: incident.id,
				incidentKind: incident.kind,
				notes: input.notes,
				remediationKind: input.remediationKind,
				status: input.status ?? 'planned',
				targetRolloutLabel: incident.targetRolloutLabel
			},
			store: config.retrievalIncidentRemediationDecisionStore
		});

		return {
			ok: true,
			records: await loadRAGRetrievalIncidentRemediationDecisions({
				groupKey: incident.groupKey,
				incidentId: incident.id,
				limit: 20,
				store: config.retrievalIncidentRemediationDecisionStore,
				targetRolloutLabel: incident.targetRolloutLabel
			})
		};
	};

	const handleExecuteRetrievalIncidentRemediation = async (
		body: unknown,
		executionMeta?: {
			bulkExecutionId?: string;
			bulkIndex?: number;
		}
	): Promise<RAGRetrievalIncidentRemediationExecutionResponse> => {
		const input = toRAGRetrievalIncidentRemediationExecutionRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { action, incidentId?, remediationKind?, decidedAt?, decidedBy?, notes?, persistDecision? }',
				ok: false
			};
		}

		const actionPayload = input.action.payload ?? {};
		const resolvedIncidentId =
			input.incidentId ??
			(typeof actionPayload.incidentId === 'string'
				? actionPayload.incidentId
				: undefined);
		let incident: RAGRetrievalReleaseIncidentRecord | undefined;
		if (resolvedIncidentId) {
			if (!config.retrievalReleaseIncidentStore) {
				return {
					error: 'RAG retrieval release incident store is not configured',
					ok: false
				};
			}
			incident = await loadReleaseIncidentById(resolvedIncidentId);
			if (!incident) {
				return {
					error: 'Retrieval release incident was not found',
					ok: false
				};
			}
		}
		if (
			input.idempotencyKey &&
			config.retrievalIncidentRemediationDecisionStore &&
			incident
		) {
			const existingRecords =
				await loadRAGRetrievalIncidentRemediationDecisions({
					incidentId: incident.id,
					limit: 100,
					store: config.retrievalIncidentRemediationDecisionStore,
					targetRolloutLabel: incident.targetRolloutLabel
				});
			const existingRecord = existingRecords.find(
				(entry) => entry.idempotencyKey === input.idempotencyKey
			);
			if (existingRecord) {
				await persistIncidentRemediationExecutionHistory({
					action: existingRecord.action ?? input.action,
					bulkExecutionId: executionMeta?.bulkExecutionId,
					bulkIndex: executionMeta?.bulkIndex,
					code: 'idempotent_replay',
					idempotencyKey: input.idempotencyKey,
					idempotentReplay: true,
					incident,
					mutationSkipped: input.action.method === 'POST',
					ok: true,
					remediationKind:
						existingRecord.remediationKind ?? input.remediationKind
				});
				return {
					execution: {
						action: existingRecord.action ?? input.action,
						code: 'idempotent_replay',
						followUpSteps: buildRemediationExecutionFollowUpSteps({
							actionKind: (existingRecord.action ?? input.action)
								.kind,
							incident
						}),
						idempotentReplay: true
					},
					ok: true,
					record: existingRecord
				};
			}
		}

		let execution:
			| RAGRetrievalIncidentRemediationExecutionResponse['execution']
			| undefined;
		let code: RAGRetrievalIncidentRemediationExecutionCode;
		switch (input.action.kind) {
			case 'approve_candidate': {
				const result = await handleRetrievalReleaseDecisionAction(
					actionPayload,
					'approve'
				);
				if (!result.ok || !result.decisions) {
					return {
						error: result.error ?? 'Retrieval approval failed',
						ok: false
					};
				}
				code = 'approval_recorded';
				execution = {
					action: input.action,
					code,
					decisions: result.decisions
				};
				break;
			}
			case 'acknowledge_incident': {
				const result =
					await handleAcknowledgeRetrievalReleaseIncident(
						actionPayload
					);
				if (!result.ok || !result.incidents) {
					return {
						error:
							result.error ??
							'Retrieval release incident acknowledgement failed',
						ok: false
					};
				}
				code = 'incident_acknowledged';
				execution = {
					action: input.action,
					code,
					incidents: result.incidents
				};
				break;
			}
			case 'resolve_incident': {
				const result =
					await handleResolveRetrievalReleaseIncident(actionPayload);
				if (!result.ok || !result.incidents) {
					return {
						error:
							result.error ??
							'Retrieval release incident resolve failed',
						ok: false
					};
				}
				code = 'incident_resolved';
				execution = {
					action: input.action,
					code,
					incidents: result.incidents
				};
				break;
			}
			case 'view_release_status':
				code = 'release_status_loaded';
				execution = {
					action: input.action,
					code,
					releaseStatus: (await handleRetrievalReleaseStatus())
						.retrievalComparisons
				};
				break;
			case 'view_release_drift':
				code = 'release_drift_loaded';
				execution = {
					action: input.action,
					code,
					releaseDriftStatus:
						await handleRetrievalReleaseDriftStatus()
				};
				break;
			case 'view_handoffs':
				code = 'handoff_status_loaded';
				execution = {
					action: input.action,
					code,
					handoffStatus: await handleRetrievalLaneHandoffStatus()
				};
				break;
			default:
				return {
					error: 'Unsupported remediation action kind',
					ok: false
				};
		}

		let record: RAGRetrievalIncidentRemediationDecisionRecord | undefined;
		if (
			(input.persistDecision ?? input.action.method === 'POST') &&
			config.retrievalIncidentRemediationDecisionStore &&
			incident
		) {
			record = await persistRAGRetrievalIncidentRemediationDecision({
				record: {
					action: input.action,
					decidedAt: input.decidedAt ?? Date.now(),
					decidedBy: input.decidedBy,
					groupKey: incident.groupKey,
					id: generateId(),
					idempotencyKey: input.idempotencyKey,
					incidentId: incident.id,
					incidentKind: incident.kind,
					notes: input.notes,
					remediationKind:
						input.remediationKind ??
						(input.action.kind === 'approve_candidate'
							? 'renew_approval'
							: input.action.kind === 'acknowledge_incident' ||
								  input.action.kind === 'resolve_incident'
								? 'review_readiness'
								: input.action.kind === 'view_release_drift'
									? 'inspect_gate'
									: input.action.kind === 'view_handoffs'
										? 'restore_source_lane'
										: 'review_readiness'),
					status: 'applied',
					targetRolloutLabel: incident.targetRolloutLabel
				},
				store: config.retrievalIncidentRemediationDecisionStore
			});
		}
		if (execution) {
			execution.followUpSteps = buildRemediationExecutionFollowUpSteps({
				actionKind: input.action.kind,
				incident
			});
			await persistIncidentRemediationExecutionHistory({
				action: input.action,
				bulkExecutionId: executionMeta?.bulkExecutionId,
				bulkIndex: executionMeta?.bulkIndex,
				code,
				idempotencyKey: input.idempotencyKey,
				idempotentReplay: execution.idempotentReplay,
				incident,
				mutationSkipped:
					execution.idempotentReplay === true &&
					input.action.method === 'POST',
				ok: true,
				remediationKind:
					record?.remediationKind ?? input.remediationKind
			});
		}

		return {
			execution,
			ok: true,
			record
		};
	};

	const handleBulkExecuteRetrievalIncidentRemediations = async (
		body: unknown
	): Promise<RAGRetrievalIncidentRemediationBulkExecutionResponse> => {
		const input =
			toRAGRetrievalIncidentRemediationBulkExecutionRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { items: [...] }',
				ok: false
			};
		}
		const mutationItems = input.items.filter(
			(item) => item.action.method === 'POST'
		);
		const bulkExecutionId = generateId();
		if (mutationItems.length > 0 && input.allowMutationExecution !== true) {
			await Promise.all(
				mutationItems.map(async (item, index) =>
					persistIncidentRemediationExecutionHistory({
						action: item.action,
						blockedByGuardrail: true,
						bulkExecutionId,
						bulkIndex: index,
						code: 'guardrail_blocked',
						error: 'Bulk remediation execution requires allowMutationExecution: true when mutation actions are included',
						guardrailKind: 'bulk_mutation_opt_in_required',
						idempotencyKey: item.idempotencyKey,
						incident: await loadReleaseIncidentById(
							item.incidentId
						),
						ok: false,
						remediationKind: item.remediationKind
					})
				)
			);
			return {
				error: 'Bulk remediation execution requires allowMutationExecution: true when mutation actions are included',
				ok: false
			};
		}
		const missingMutationIdempotency = mutationItems.find(
			(item) => !item.idempotencyKey
		);
		if (missingMutationIdempotency) {
			await Promise.all(
				mutationItems
					.filter((item) => !item.idempotencyKey)
					.map(async (item, index) =>
						persistIncidentRemediationExecutionHistory({
							action: item.action,
							blockedByGuardrail: true,
							bulkExecutionId,
							bulkIndex: index,
							code: 'guardrail_blocked',
							error: 'Bulk remediation mutation actions require idempotencyKey on every POST item',
							guardrailKind: 'bulk_missing_idempotency_key',
							incident: await loadReleaseIncidentById(
								item.incidentId
							),
							ok: false,
							remediationKind: item.remediationKind
						})
					)
			);
			return {
				error: 'Bulk remediation mutation actions require idempotencyKey on every POST item',
				ok: false
			};
		}
		const results: NonNullable<
			RAGRetrievalIncidentRemediationBulkExecutionResponse['results']
		> = [];
		for (const [index, item] of input.items.entries()) {
			const result = await handleExecuteRetrievalIncidentRemediation(
				item,
				{
					bulkExecutionId,
					bulkIndex: index
				}
			);
			results.push({
				error: result.error,
				execution: result.execution,
				index,
				ok: result.ok,
				record: result.record
			});
			if (input.stopOnError === true && !result.ok) {
				break;
			}
		}
		return {
			ok: true,
			results
		};
	};

	const handleRetrievalReleaseIncidentStatus = async (
		request?: Request
	): Promise<RAGRetrievalReleaseIncidentStatusResponse> => {
		const ops = await buildOperationsPayload(request);
		const recentIncidents = ops.retrievalComparisons?.recentIncidents;
		return {
			incidentClassificationSummary:
				summarizeIncidentClassifications(recentIncidents),
			incidentRemediationExecutionSummary:
				ops.retrievalComparisons?.incidentRemediationExecutionSummary,
			incidentSummary: ops.retrievalComparisons?.incidentSummary,
			ok: true,
			recentIncidentRemediationDecisions:
				ops.retrievalComparisons?.recentIncidentRemediationDecisions,
			recentIncidentRemediationExecutions:
				ops.retrievalComparisons?.recentIncidentRemediationExecutions,
			recentIncidents,
			recentReleaseLaneEscalationPolicyHistory:
				ops.retrievalComparisons
					?.recentReleaseLaneEscalationPolicyHistory,
			releaseLaneIncidentSummaries:
				ops.retrievalComparisons?.releaseLaneIncidentSummaries
		};
	};

	const handleRetrievalIncidentRemediationExecutionHistoryList = async (
		query: unknown
	): Promise<RAGRetrievalIncidentRemediationExecutionHistoryResponse> => {
		if (!config.retrievalIncidentRemediationExecutionHistoryStore) {
			return {
				error: 'RAG retrieval incident remediation execution history store is not configured',
				ok: false
			};
		}

		return {
			ok: true,
			records: await loadRAGRetrievalIncidentRemediationExecutionHistory({
				actionKind: getStringProperty(query, 'actionKind') as
					| RAGRemediationAction['kind']
					| undefined,
				blockedByGuardrail:
					getStringProperty(query, 'blockedByGuardrail') === 'true'
						? true
						: getStringProperty(query, 'blockedByGuardrail') ===
							  'false'
							? false
							: undefined,
				code: getStringProperty(query, 'code') as
					| RAGRetrievalIncidentRemediationExecutionCode
					| undefined,
				groupKey: getStringProperty(query, 'groupKey'),
				idempotentReplay:
					getStringProperty(query, 'idempotentReplay') === 'true'
						? true
						: getStringProperty(query, 'idempotentReplay') ===
							  'false'
							? false
							: undefined,
				incidentId: getStringProperty(query, 'incidentId'),
				limit: getIntegerLikeProperty(query, 'limit'),
				store: config.retrievalIncidentRemediationExecutionHistoryStore,
				targetRolloutLabel: getStringProperty(
					query,
					'targetRolloutLabel'
				) as
					| RAGRetrievalReleaseIncidentRecord['targetRolloutLabel']
					| undefined
			})
		};
	};

	const handleRetrievalIncidentRemediationStatus = async (
		request?: Request
	): Promise<RAGRetrievalIncidentRemediationStatusResponse> => {
		const ops = await buildOperationsPayload(request);
		return {
			incidentClassificationSummary: summarizeIncidentClassifications(
				ops.retrievalComparisons?.recentIncidents
			),
			incidentRemediationExecutionSummary:
				ops.retrievalComparisons?.incidentRemediationExecutionSummary,
			ok: true,
			recentIncidentRemediationExecutions:
				ops.retrievalComparisons?.recentIncidentRemediationExecutions
		};
	};

	const handleRetrievalLaneHandoffIncidentAcknowledge = async (
		body: unknown
	): Promise<RAGRetrievalLaneHandoffIncidentListResponse> => {
		if (!config.retrievalLaneHandoffIncidentStore) {
			return {
				error: 'RAG retrieval lane handoff incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseIncidentAcknowledgeRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalLaneHandoffIncidents({
			limit: 200,
			store: config.retrievalLaneHandoffIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval lane handoff incident was not found',
				ok: false
			};
		}

		const nextRecord = {
			...incident,
			acknowledgedAt: input.acknowledgedAt ?? Date.now(),
			acknowledgedBy: input.acknowledgedBy,
			acknowledgementNotes: input.acknowledgementNotes
		} as const;
		await persistRAGRetrievalLaneHandoffIncident({
			record: nextRecord,
			store: config.retrievalLaneHandoffIncidentStore
		});
		await persistLaneHandoffIncidentHistoryRecord({
			action: 'acknowledged',
			incident: nextRecord,
			notes: nextRecord.acknowledgementNotes,
			recordedAt: nextRecord.acknowledgedAt,
			recordedBy: nextRecord.acknowledgedBy
		});
		if (config.retrievalReleaseIncidentStore) {
			const releaseIncidents = await loadRAGRetrievalReleaseIncidents({
				limit: 200,
				store: config.retrievalReleaseIncidentStore
			});
			const releaseIncident = releaseIncidents.find(
				(entry) =>
					entry.id === input.incidentId &&
					entry.kind === 'handoff_stale'
			);
			if (releaseIncident) {
				await persistRAGRetrievalReleaseIncident({
					record: {
						...releaseIncident,
						acknowledgedAt: nextRecord.acknowledgedAt,
						acknowledgedBy: nextRecord.acknowledgedBy,
						acknowledgementNotes: nextRecord.acknowledgementNotes
					},
					store: config.retrievalReleaseIncidentStore
				});
			}
		}

		return {
			incidents: await loadRAGRetrievalLaneHandoffIncidents({
				groupKey: incident.groupKey,
				limit: 20,
				store: config.retrievalLaneHandoffIncidentStore,
				targetRolloutLabel: incident.targetRolloutLabel
			}),
			ok: true
		};
	};

	const handleRetrievalLaneHandoffIncidentUnacknowledge = async (
		body: unknown
	): Promise<RAGRetrievalLaneHandoffIncidentListResponse> => {
		if (!config.retrievalLaneHandoffIncidentStore) {
			return {
				error: 'RAG retrieval lane handoff incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseIncidentUnacknowledgeRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalLaneHandoffIncidents({
			limit: 200,
			store: config.retrievalLaneHandoffIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval lane handoff incident was not found',
				ok: false
			};
		}

		const nextRecord = {
			...incident,
			acknowledgedAt: undefined,
			acknowledgedBy: undefined,
			acknowledgementNotes: undefined
		} as const;
		await persistRAGRetrievalLaneHandoffIncident({
			record: nextRecord,
			store: config.retrievalLaneHandoffIncidentStore
		});
		await persistLaneHandoffIncidentHistoryRecord({
			action: 'unacknowledged',
			incident: nextRecord,
			recordedAt: Date.now()
		});
		if (config.retrievalReleaseIncidentStore) {
			const releaseIncidents = await loadRAGRetrievalReleaseIncidents({
				limit: 200,
				store: config.retrievalReleaseIncidentStore
			});
			const releaseIncident = releaseIncidents.find(
				(entry) =>
					entry.id === input.incidentId &&
					entry.kind === 'handoff_stale'
			);
			if (releaseIncident) {
				await persistRAGRetrievalReleaseIncident({
					record: {
						...releaseIncident,
						acknowledgedAt: undefined,
						acknowledgedBy: undefined,
						acknowledgementNotes: undefined
					},
					store: config.retrievalReleaseIncidentStore
				});
			}
		}

		return {
			incidents: await loadRAGRetrievalLaneHandoffIncidents({
				groupKey: incident.groupKey,
				limit: 20,
				store: config.retrievalLaneHandoffIncidentStore,
				targetRolloutLabel: incident.targetRolloutLabel
			}),
			ok: true
		};
	};

	const handleResolveRetrievalLaneHandoffIncident = async (
		body: unknown
	): Promise<RAGRetrievalLaneHandoffIncidentListResponse> => {
		if (!config.retrievalLaneHandoffIncidentStore) {
			return {
				error: 'RAG retrieval lane handoff incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseIncidentResolveRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalLaneHandoffIncidents({
			limit: 200,
			store: config.retrievalLaneHandoffIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval lane handoff incident was not found',
				ok: false
			};
		}

		const nextRecord = {
			...incident,
			notes: input.resolutionNotes ?? incident.notes,
			resolvedAt: input.resolvedAt ?? Date.now(),
			status: 'resolved' as const
		};
		await persistRAGRetrievalLaneHandoffIncident({
			record: nextRecord,
			store: config.retrievalLaneHandoffIncidentStore
		});
		await persistLaneHandoffIncidentHistoryRecord({
			action: 'resolved',
			incident: nextRecord,
			notes: nextRecord.notes,
			recordedAt: nextRecord.resolvedAt
		});
		if (config.retrievalReleaseIncidentStore) {
			const releaseIncidents = await loadRAGRetrievalReleaseIncidents({
				limit: 200,
				store: config.retrievalReleaseIncidentStore
			});
			const releaseIncident = releaseIncidents.find(
				(entry) =>
					entry.id === input.incidentId &&
					entry.kind === 'handoff_stale'
			);
			if (releaseIncident) {
				await persistRAGRetrievalReleaseIncident({
					record: {
						...releaseIncident,
						notes: nextRecord.notes,
						resolvedAt: nextRecord.resolvedAt,
						status: 'resolved'
					},
					store: config.retrievalReleaseIncidentStore
				});
			}
		}

		return {
			incidents: await loadRAGRetrievalLaneHandoffIncidents({
				groupKey: incident.groupKey,
				limit: 20,
				store: config.retrievalLaneHandoffIncidentStore,
				targetRolloutLabel: incident.targetRolloutLabel
			}),
			ok: true
		};
	};

	const handleAcknowledgeRetrievalReleaseIncident = async (
		body: unknown
	): Promise<RAGRetrievalReleaseIncidentListResponse> => {
		if (!config.retrievalReleaseIncidentStore) {
			return {
				error: 'RAG retrieval release incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseIncidentAcknowledgeRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalReleaseIncidents({
			limit: 200,
			store: config.retrievalReleaseIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval release incident was not found',
				ok: false
			};
		}

		await persistRAGRetrievalReleaseIncident({
			record: {
				...incident,
				acknowledgedAt: input.acknowledgedAt ?? Date.now(),
				acknowledgedBy: input.acknowledgedBy,
				acknowledgementNotes: input.acknowledgementNotes
			},
			store: config.retrievalReleaseIncidentStore
		});

		return {
			incidents: await loadRAGRetrievalReleaseIncidents({
				corpusGroupKey: incident.corpusGroupKey,
				groupKey: incident.groupKey,
				limit: 20,
				store: config.retrievalReleaseIncidentStore
			}),
			ok: true
		};
	};

	const handleUnacknowledgeRetrievalReleaseIncident = async (
		body: unknown
	): Promise<RAGRetrievalReleaseIncidentListResponse> => {
		if (!config.retrievalReleaseIncidentStore) {
			return {
				error: 'RAG retrieval release incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseIncidentUnacknowledgeRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalReleaseIncidents({
			limit: 200,
			store: config.retrievalReleaseIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval release incident was not found',
				ok: false
			};
		}

		await persistRAGRetrievalReleaseIncident({
			record: {
				...incident,
				acknowledgedAt: undefined,
				acknowledgedBy: undefined,
				acknowledgementNotes: undefined
			},
			store: config.retrievalReleaseIncidentStore
		});

		return {
			incidents: await loadRAGRetrievalReleaseIncidents({
				corpusGroupKey: incident.corpusGroupKey,
				groupKey: incident.groupKey,
				limit: 20,
				store: config.retrievalReleaseIncidentStore
			}),
			ok: true
		};
	};

	const handleResolveRetrievalReleaseIncident = async (
		body: unknown
	): Promise<RAGRetrievalReleaseIncidentListResponse> => {
		if (!config.retrievalReleaseIncidentStore) {
			return {
				error: 'RAG retrieval release incident store is not configured',
				ok: false
			};
		}

		const input = toRAGRetrievalReleaseIncidentResolveRequest(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { incidentId }',
				ok: false
			};
		}

		const incidents = await loadRAGRetrievalReleaseIncidents({
			limit: 200,
			store: config.retrievalReleaseIncidentStore
		});
		const incident = incidents.find(
			(entry) => entry.id === input.incidentId
		);
		if (!incident) {
			return {
				error: 'Retrieval release incident was not found',
				ok: false
			};
		}

		await persistRAGRetrievalReleaseIncident({
			record: {
				...incident,
				notes: input.resolutionNotes ?? incident.notes,
				resolvedAt: input.resolvedAt ?? Date.now(),
				status: 'resolved'
			},
			store: config.retrievalReleaseIncidentStore
		});

		return {
			incidents: await loadRAGRetrievalReleaseIncidents({
				corpusGroupKey: incident.corpusGroupKey,
				groupKey: incident.groupKey,
				limit: 20,
				store: config.retrievalReleaseIncidentStore
			}),
			ok: true
		};
	};

	const handlePromoteRetrievalBaselineToLane = async (
		body: unknown
	): Promise<RAGRetrievalBaselineResponse> => {
		if (!isObjectRecord(body)) {
			return {
				error: 'Expected payload shape: { groupKey, retrievalId, rolloutLabel }',
				ok: false
			};
		}
		const rolloutLabel = getStringProperty(body, 'rolloutLabel');
		if (
			rolloutLabel !== 'canary' &&
			rolloutLabel !== 'stable' &&
			rolloutLabel !== 'rollback_target'
		) {
			return {
				error: 'rolloutLabel is required and must be one of canary, stable, rollback_target',
				ok: false
			};
		}

		return handlePromoteRetrievalBaseline({
			...body,
			rolloutLabel
		});
	};

	const handleRetrievalPromotionCandidateList = async (
		queryInput: unknown
	): Promise<RAGRetrievalPromotionCandidateListResponse> => {
		if (!retrievalComparisonHistoryStore) {
			return {
				error: 'RAG retrieval comparison history store is not configured',
				ok: false
			};
		}

		const runs = await loadRAGRetrievalComparisonHistory({
			groupKey: getStringProperty(queryInput, 'groupKey'),
			limit: getIntegerLikeProperty(queryInput, 'limit') ?? 20,
			store: retrievalComparisonHistoryStore,
			tag: getStringProperty(queryInput, 'tag')
		});
		const decisions = config.retrievalReleaseDecisionStore
			? await loadRAGRetrievalReleaseDecisions({
					groupKey: getStringProperty(queryInput, 'groupKey'),
					limit: 50,
					store: config.retrievalReleaseDecisionStore
				})
			: undefined;

		const approvedFilter = getStringProperty(queryInput, 'approved');
		const readyFilter = getStringProperty(queryInput, 'ready');
		const blockedFilter = getStringProperty(queryInput, 'blocked');
		const reviewStatusFilter = getStringProperty(
			queryInput,
			'reviewStatus'
		);
		const freshnessStatusFilter = getStringProperty(
			queryInput,
			'freshnessStatus'
		);
		const targetRolloutLabel = getStringProperty(
			queryInput,
			'targetRolloutLabel'
		);
		const sortBy = getStringProperty(queryInput, 'sortBy');
		const sortDirection = getStringProperty(queryInput, 'sortDirection');

		return {
			candidates: buildRetrievalPromotionCandidates({
				activeBaselines: retrievalBaselineStore
					? await loadRAGRetrievalBaselines({
							groupKey: getStringProperty(queryInput, 'groupKey'),
							limit: 20,
							status: 'active',
							store: retrievalBaselineStore
						})
					: undefined,
				decisions,
				groupKey: getStringProperty(queryInput, 'groupKey'),
				limit: getIntegerLikeProperty(queryInput, 'limit') ?? 20,
				runs,
				targetRolloutLabel:
					targetRolloutLabel === 'canary' ||
					targetRolloutLabel === 'stable' ||
					targetRolloutLabel === 'rollback_target'
						? targetRolloutLabel
						: undefined,
				sortBy:
					sortBy === 'approvalFreshness' ||
					sortBy === 'finishedAt' ||
					sortBy === 'gateSeverity' ||
					sortBy === 'priority'
						? sortBy
						: undefined,
				sortDirection:
					sortDirection === 'asc' || sortDirection === 'desc'
						? sortDirection
						: undefined,
				tag: getStringProperty(queryInput, 'tag')
			}).filter((candidate) => {
				if (
					(approvedFilter === 'true' &&
						candidate.approved !== true) ||
					(approvedFilter === 'false' && candidate.approved !== false)
				) {
					return false;
				}
				if (
					(readyFilter === 'true' && candidate.ready !== true) ||
					(readyFilter === 'false' && candidate.ready !== false)
				) {
					return false;
				}
				if (
					(blockedFilter === 'true' &&
						candidate.reviewStatus !== 'blocked') ||
					(blockedFilter === 'false' &&
						candidate.reviewStatus === 'blocked')
				) {
					return false;
				}
				if (
					reviewStatusFilter &&
					(reviewStatusFilter === 'approved' ||
						reviewStatusFilter === 'blocked' ||
						reviewStatusFilter === 'needs_review' ||
						reviewStatusFilter === 'ready') &&
					candidate.reviewStatus !== reviewStatusFilter
				) {
					return false;
				}
				if (
					freshnessStatusFilter &&
					(freshnessStatusFilter === 'fresh' ||
						freshnessStatusFilter === 'expired' ||
						freshnessStatusFilter === 'not_applicable') &&
					candidate.approvalFreshnessStatus !== freshnessStatusFilter
				) {
					return false;
				}
				return true;
			}),
			ok: true
		};
	};

	const handleIngest = async (
		body: unknown
	): Promise<{
		count?: number;
		documentCount?: number;
		ok: boolean;
		error?: string;
	}> => {
		if (!isObjectRecord(body)) {
			return { error: 'Invalid payload', ok: false };
		}

		if (!ragStore) {
			return { error: 'RAG store is not configured', ok: false };
		}

		const chunksValue = body.chunks;
		if (isRAGDocumentChunkArray(chunksValue)) {
			const job = createIngestJob('chunks', chunksValue.length);
			try {
				await ragStore.upsert({ chunks: chunksValue });
				completeIngestJob(job, { chunkCount: chunksValue.length });

				return { count: chunksValue.length, ok: true };
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				failIngestJob(job, message);

				return { error: message, ok: false };
			}
		}

		const documentsValue = body.documents;
		if (!isRAGDocumentArray(documentsValue)) {
			const urlsValue = body.urls;
			if (isRAGDocumentUrlArray(urlsValue)) {
				const job = createIngestJob('urls', urlsValue.length);
				try {
					const prepared = await buildRAGUpsertInputFromURLs({
						baseMetadata:
							getObjectProperty(body, 'baseMetadata') ??
							undefined,
						defaultChunking: normalizeChunkingOptions(
							getObjectProperty(body, 'defaultChunking')
						),
						extractors,
						urls: urlsValue
					});
					await ragStore.upsert(prepared);
					completeIngestJob(job, {
						chunkCount: prepared.chunks.length,
						documentCount: urlsValue.length,
						extractorNames: Array.from(
							new Set(
								prepared.chunks
									.map((chunk) => chunk.metadata?.extractor)
									.filter(
										(value): value is string =>
											typeof value === 'string'
									)
							)
						)
					});

					return {
						count: prepared.chunks.length,
						documentCount: urlsValue.length,
						ok: true
					};
				} catch (caught) {
					const message =
						caught instanceof Error
							? caught.message
							: String(caught);
					failIngestJob(
						job,
						message,
						(extractors ?? []).map((extractor) => extractor.name)
					);

					return { error: message, ok: false };
				}
			}

			const uploadsValue = body.uploads;
			if (isRAGDocumentUploadArray(uploadsValue)) {
				const job = createIngestJob('uploads', uploadsValue.length);
				try {
					const prepared = await buildRAGUpsertInputFromUploads({
						baseMetadata:
							getObjectProperty(body, 'baseMetadata') ??
							undefined,
						defaultChunking: normalizeChunkingOptions(
							getObjectProperty(body, 'defaultChunking')
						),
						extractors,
						uploads: uploadsValue
					});
					await ragStore.upsert(prepared);
					completeIngestJob(job, {
						chunkCount: prepared.chunks.length,
						documentCount: uploadsValue.length,
						extractorNames: Array.from(
							new Set(
								prepared.chunks
									.map((chunk) => chunk.metadata?.extractor)
									.filter(
										(value): value is string =>
											typeof value === 'string'
									)
							)
						)
					});

					return {
						count: prepared.chunks.length,
						documentCount: uploadsValue.length,
						ok: true
					};
				} catch (caught) {
					const message =
						caught instanceof Error
							? caught.message
							: String(caught);
					failIngestJob(
						job,
						message,
						(extractors ?? []).map((extractor) => extractor.name)
					);

					return { error: message, ok: false };
				}
			}

			return {
				error: 'Expected payload shape: { chunks: [...] } or { documents: [...] } or { urls: [...] } or { uploads: [...] }',
				ok: false
			};
		}

		const job = createIngestJob('documents', documentsValue.length);
		try {
			const prepared = buildRAGUpsertInputFromDocuments({
				documents: documentsValue
			});
			await ragStore.upsert(prepared);
			completeIngestJob(job, {
				chunkCount: prepared.chunks.length,
				documentCount: documentsValue.length
			});

			return {
				count: prepared.chunks.length,
				documentCount: documentsValue.length,
				ok: true
			};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failIngestJob(job, message);

			return { error: message, ok: false };
		}
	};

	const handleSearch = async (
		body: unknown,
		request?: Request
	): Promise<RAGSearchResponse> => {
		if (!isObjectRecord(body)) {
			return { error: 'Invalid payload', ok: false };
		}

		const query = (getStringProperty(body, 'query') ?? '').trim();

		if (!query) {
			return {
				error: 'Expected payload shape: { query: string }',
				ok: false
			};
		}

		const collection = resolveCollection();
		const accessScope = await loadAccessScope(request);

		if (!collection) {
			return { error: 'RAG collection is not configured', ok: false };
		}

		const input = {
			filter: getObjectProperty(body, 'filter'),
			nativeQueryProfile:
				body.nativeQueryProfile === 'latency' ||
				body.nativeQueryProfile === 'balanced' ||
				body.nativeQueryProfile === 'recall'
					? (body.nativeQueryProfile as RAGCollectionSearchParams['nativeQueryProfile'])
					: undefined,
			nativeCandidateLimit:
				typeof body.nativeCandidateLimit === 'number'
					? body.nativeCandidateLimit
					: undefined,
			nativeMaxBackfills:
				typeof body.nativeMaxBackfills === 'number'
					? body.nativeMaxBackfills
					: undefined,
			nativeMinResults:
				typeof body.nativeMinResults === 'number'
					? body.nativeMinResults
					: undefined,
			nativeFillPolicy:
				body.nativeFillPolicy === 'strict_topk' ||
				body.nativeFillPolicy === 'satisfy_min_results'
					? (body.nativeFillPolicy as RAGCollectionSearchParams['nativeFillPolicy'])
					: undefined,
			nativeQueryMultiplier:
				typeof body.nativeQueryMultiplier === 'number'
					? body.nativeQueryMultiplier
					: undefined,
			retrieval: undefined as
				| RAGCollectionSearchParams['retrieval']
				| undefined,
			model: getStringProperty(body, 'model'),
			query,
			scoreThreshold:
				typeof body.scoreThreshold === 'number'
					? body.scoreThreshold
					: undefined,
			topK: typeof body.topK === 'number' ? body.topK : undefined
		};
		const persistTrace = getBooleanProperty(body, 'persistTrace') === true;
		const traceGroupKey = getStringProperty(body, 'traceGroupKey');
		const traceTags = normalizeStringArray(
			isObjectRecord(body) ? body.traceTags : undefined
		);
		const hasSearchRetrieval = getOwnProperty(body, 'retrieval');
		const parsedSearchRetrieval = parseRAGRetrieval(
			(body as { retrieval?: unknown }).retrieval
		);

		if (hasSearchRetrieval && parsedSearchRetrieval === null) {
			return {
				error: 'Expected payload shape: { query: string }',
				ok: false
			};
		}
		if (parsedSearchRetrieval !== null) {
			input.retrieval = parsedSearchRetrieval;
		}

		if (getBooleanProperty(body, 'includeTrace') === true) {
			const startedAt = Date.now();
			const result = await collection.searchWithTrace(input);
			if (persistTrace) {
				await persistSearchTraceIfConfigured({
					finishedAt: Date.now(),
					groupKey: traceGroupKey,
					label: query,
					results: result.results,
					retention: searchTraceRetention,
					onPrune: (input) => runSearchTracePrune(input, 'write'),
					startedAt,
					store: searchTraceStore,
					tags: traceTags,
					trace: result.trace
				});
			}

			const scopedResults = buildSources(result.results).filter((entry) =>
				matchesAccessScope(accessScope, {
					corpusKey: entry.corpusKey,
					documentId:
						typeof entry.metadata?.documentId === 'string'
							? entry.metadata.documentId
							: entry.chunkId.split(':')[0],
					metadata: entry.metadata,
					source: entry.source
				})
			);
			return {
				ok: true,
				results: scopedResults,
				trace: result.trace
			};
		}

		const results = await collection.search(input);

		return {
			ok: true,
			results: buildSources(results).filter((entry) =>
				matchesAccessScope(accessScope, {
					corpusKey: entry.corpusKey,
					documentId:
						typeof entry.metadata?.documentId === 'string'
							? entry.metadata.documentId
							: entry.chunkId.split(':')[0],
					metadata: entry.metadata,
					source: entry.source
				})
			)
		};
	};

	const handleTraceHistory = async (
		queryInput: unknown
	): Promise<RAGSearchTraceHistoryResponse> => {
		if (!searchTraceStore) {
			return {
				error: 'RAG search trace store is not configured',
				ok: false
			};
		}

		const limit = getIntegerLikeProperty(queryInput, 'limit');
		const history = await loadRAGSearchTraceHistory({
			groupKey: getStringProperty(queryInput, 'groupKey'),
			limit,
			query: getStringProperty(queryInput, 'query'),
			store: searchTraceStore,
			tag: getStringProperty(queryInput, 'tag')
		});

		return {
			history,
			ok: true
		};
	};

	const handleTraceGroupHistory = async (
		queryInput: unknown
	): Promise<RAGSearchTraceGroupHistoryResponse> => {
		if (!searchTraceStore) {
			return {
				error: 'RAG search trace store is not configured',
				ok: false
			};
		}

		const history = await loadRAGSearchTraceGroupHistory({
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			store: searchTraceStore,
			tag: getStringProperty(queryInput, 'tag')
		});

		return {
			history,
			ok: true
		};
	};

	const handleTraceStats = async (
		queryInput: unknown
	): Promise<RAGSearchTraceStatsResponse> => {
		if (!searchTraceStore) {
			return {
				error: 'RAG search trace store is not configured',
				ok: false
			};
		}

		const stats = await summarizeRAGSearchTraceStore({
			store: searchTraceStore,
			tag: getStringProperty(queryInput, 'tag')
		});

		return {
			ok: true,
			stats
		};
	};

	const handleTracePrunePreview = async (
		body: unknown
	): Promise<RAGSearchTracePrunePreviewResponse> => {
		if (!searchTraceStore) {
			return {
				error: 'RAG search trace store is not configured',
				ok: false
			};
		}

		const input = parseRAGSearchTracePruneInput(body);
		if (input === null) {
			return {
				error: 'Expected payload shape: { maxAgeMs?: number, maxRecordsPerQuery?: number, maxRecordsPerGroup?: number, now?: number, tag?: string }',
				ok: false
			};
		}

		const preview = await previewRAGSearchTraceStorePrune({
			input,
			store: searchTraceStore
		});

		return {
			ok: true,
			preview
		};
	};

	const handleTracePrune = async (
		body: unknown
	): Promise<RAGSearchTracePruneResponse> => {
		if (!searchTraceStore) {
			return {
				error: 'RAG search trace store is not configured',
				ok: false
			};
		}

		const input = parseRAGSearchTracePruneInput(body);
		if (input === null) {
			return {
				error: 'Expected payload shape: { maxAgeMs?: number, maxRecordsPerQuery?: number, maxRecordsPerGroup?: number, now?: number, tag?: string }',
				ok: false
			};
		}

		const { result, stats } = await runSearchTracePrune(input, 'manual');

		return {
			ok: true,
			result,
			stats
		};
	};

	const handleTracePruneHistory = async (
		queryInput: unknown
	): Promise<RAGSearchTracePruneHistoryResponse> => {
		if (!searchTracePruneHistoryStore) {
			return {
				error: 'RAG search trace prune history store is not configured',
				ok: false
			};
		}

		const runs = await loadRAGSearchTracePruneHistory({
			limit: getIntegerLikeProperty(queryInput, 'limit'),
			store: searchTracePruneHistoryStore,
			trigger:
				getStringProperty(queryInput, 'trigger') === 'manual' ||
				getStringProperty(queryInput, 'trigger') === 'write' ||
				getStringProperty(queryInput, 'trigger') === 'schedule'
					? (getStringProperty(
							queryInput,
							'trigger'
						) as RAGSearchTracePruneRun['trigger'])
					: undefined
		});

		return {
			ok: true,
			runs
		};
	};

	const summarizeDocuments = (documents: RAGIndexedDocument[]) => ({
		byKind: documents.reduce<Record<string, number>>((acc, document) => {
			const kind = document.kind ?? 'unknown';
			acc[kind] = (acc[kind] ?? 0) + 1;

			return acc;
		}, {}),
		chunkCount: documents.reduce(
			(sum, document) => sum + (document.chunkCount ?? 0),
			0
		),
		total: documents.length
	});

	const summarizeHealth = async (
		documents: RAGIndexedDocument[]
	): Promise<RAGCorpusHealth> => {
		const sourceCounts = new Map<string, number>();
		const documentIdCounts = new Map<string, number>();
		const coverageByFormat = new Map<string, number>();
		const coverageByKind = new Map<string, number>();
		const failuresByExtractor = new Map<string, number>();
		const failuresByInputKind = new Map<string, number>();
		const failuresByAdminAction = new Map<string, number>();
		let emptyDocuments = 0;
		let emptyChunks = 0;
		let lowSignalChunks = 0;
		let documentsMissingSource = 0;
		let documentsMissingTitle = 0;
		let documentsMissingMetadata = 0;
		let documentsMissingCreatedAt = 0;
		let documentsMissingUpdatedAt = 0;
		let documentsWithoutChunkPreview = 0;
		let inspectedDocuments = 0;
		let inspectedChunks = 0;
		let documentsWithSourceLabels = 0;
		let chunksWithSourceLabels = 0;
		const corpusKeys = new Map<string, number>();
		const sourceNativeKinds = new Map<string, number>();
		const extractorRegistryMatches = new Map<string, number>();
		const chunkingProfiles = new Map<string, number>();
		const sampleDocuments: NonNullable<
			RAGCorpusHealth['inspection']
		>['sampleDocuments'] = [];
		const sampleChunks: NonNullable<
			RAGCorpusHealth['inspection']
		>['sampleChunks'] = [];
		let oldestDocumentAgeMs: number | undefined;
		let newestDocumentAgeMs: number | undefined;
		const staleDocuments: string[] = [];
		const now = Date.now();

		for (const document of documents) {
			documentIdCounts.set(
				document.id,
				(documentIdCounts.get(document.id) ?? 0) + 1
			);
			const source = document.source.trim();
			if (source) {
				sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
			} else {
				documentsMissingSource += 1;
			}
			if (!document.title.trim()) {
				documentsMissingTitle += 1;
			}
			if (
				!document.metadata ||
				Object.keys(document.metadata).length === 0
			) {
				documentsMissingMetadata += 1;
			}
			if (typeof document.createdAt !== 'number') {
				documentsMissingCreatedAt += 1;
			}
			if (typeof document.updatedAt !== 'number') {
				documentsMissingUpdatedAt += 1;
			}
			const latestTimestamp =
				typeof document.updatedAt === 'number'
					? document.updatedAt
					: typeof document.createdAt === 'number'
						? document.createdAt
						: undefined;
			if (typeof latestTimestamp === 'number') {
				const ageMs = Math.max(0, now - latestTimestamp);
				oldestDocumentAgeMs =
					typeof oldestDocumentAgeMs === 'number'
						? Math.max(oldestDocumentAgeMs, ageMs)
						: ageMs;
				newestDocumentAgeMs =
					typeof newestDocumentAgeMs === 'number'
						? Math.min(newestDocumentAgeMs, ageMs)
						: ageMs;
				if (ageMs >= staleAfterMs) {
					staleDocuments.push(document.id);
				}
			}
			const format = document.format?.trim() || 'unknown';
			const kind = document.kind?.trim() || 'unknown';
			coverageByFormat.set(
				format,
				(coverageByFormat.get(format) ?? 0) + 1
			);
			coverageByKind.set(kind, (coverageByKind.get(kind) ?? 0) + 1);
			if ((document.chunkCount ?? 0) === 0) {
				emptyDocuments += 1;
			}
			const documentLabels = buildRAGSourceLabels({
				metadata: document.metadata,
				source: document.source,
				title: document.title
			});
			if (documentLabels) {
				documentsWithSourceLabels += 1;
			}
			const documentSourceNativeKind =
				typeof document.metadata?.sourceNativeKind === 'string'
					? document.metadata.sourceNativeKind
					: undefined;
			const documentCorpusKey =
				document.corpusKey ??
				(typeof document.metadata?.corpusKey === 'string'
					? document.metadata.corpusKey
					: undefined);
			const documentExtractorRegistryMatch =
				typeof document.metadata?.extractorRegistryMatch === 'string'
					? document.metadata.extractorRegistryMatch
					: undefined;
			const documentChunkingProfile =
				typeof document.metadata?.chunkingProfile === 'string'
					? document.metadata.chunkingProfile
					: undefined;
			if (documentSourceNativeKind) {
				sourceNativeKinds.set(
					documentSourceNativeKind,
					(sourceNativeKinds.get(documentSourceNativeKind) ?? 0) + 1
				);
			}
			if (documentCorpusKey) {
				corpusKeys.set(
					documentCorpusKey,
					(corpusKeys.get(documentCorpusKey) ?? 0) + 1
				);
			}
			if (documentExtractorRegistryMatch) {
				extractorRegistryMatches.set(
					documentExtractorRegistryMatch,
					(extractorRegistryMatches.get(
						documentExtractorRegistryMatch
					) ?? 0) + 1
				);
			}
			if (documentChunkingProfile) {
				chunkingProfiles.set(
					documentChunkingProfile,
					(chunkingProfiles.get(documentChunkingProfile) ?? 0) + 1
				);
			}
			if (
				sampleDocuments.length < 5 &&
				(documentCorpusKey ||
					documentLabels ||
					documentSourceNativeKind ||
					documentExtractorRegistryMatch ||
					documentChunkingProfile)
			) {
				sampleDocuments.push({
					corpusKey: documentCorpusKey,
					chunkingProfile: documentChunkingProfile,
					extractorRegistryMatch: documentExtractorRegistryMatch,
					id: document.id,
					labels: documentLabels,
					source: document.source,
					sourceNativeKind: documentSourceNativeKind,
					title: document.title
				});
			}

			if (indexManager?.getDocumentChunks) {
				const preview = await indexManager.getDocumentChunks(
					document.id
				);
				if (!preview) {
					documentsWithoutChunkPreview += 1;
					continue;
				}
				inspectedDocuments += 1;
				for (const chunk of preview.chunks) {
					inspectedChunks += 1;
					const chunkLabels = buildRAGSourceLabels({
						metadata: chunk.metadata,
						source: chunk.source ?? preview.document.source,
						title: chunk.title ?? preview.document.title
					});
					if (chunkLabels) {
						chunksWithSourceLabels += 1;
					}
					const chunkSourceNativeKind =
						typeof chunk.metadata?.sourceNativeKind === 'string'
							? chunk.metadata.sourceNativeKind
							: undefined;
					const chunkCorpusKey =
						chunk.corpusKey ??
						(typeof chunk.metadata?.corpusKey === 'string'
							? chunk.metadata.corpusKey
							: documentCorpusKey);
					const chunkExtractorRegistryMatch =
						typeof chunk.metadata?.extractorRegistryMatch ===
						'string'
							? chunk.metadata.extractorRegistryMatch
							: undefined;
					const chunkChunkingProfile =
						typeof chunk.metadata?.chunkingProfile === 'string'
							? chunk.metadata.chunkingProfile
							: undefined;
					if (chunkSourceNativeKind) {
						sourceNativeKinds.set(
							chunkSourceNativeKind,
							(sourceNativeKinds.get(chunkSourceNativeKind) ??
								0) + 1
						);
					}
					if (chunkCorpusKey) {
						corpusKeys.set(
							chunkCorpusKey,
							(corpusKeys.get(chunkCorpusKey) ?? 0) + 1
						);
					}
					if (chunkExtractorRegistryMatch) {
						extractorRegistryMatches.set(
							chunkExtractorRegistryMatch,
							(extractorRegistryMatches.get(
								chunkExtractorRegistryMatch
							) ?? 0) + 1
						);
					}
					if (chunkChunkingProfile) {
						chunkingProfiles.set(
							chunkChunkingProfile,
							(chunkingProfiles.get(chunkChunkingProfile) ?? 0) +
								1
						);
					}
					if (
						sampleChunks.length < 8 &&
						(chunkCorpusKey ||
							chunkLabels ||
							chunkSourceNativeKind ||
							chunkExtractorRegistryMatch ||
							chunkChunkingProfile)
					) {
						sampleChunks.push({
							chunkId: chunk.chunkId,
							chunkingProfile: chunkChunkingProfile,
							corpusKey: chunkCorpusKey,
							documentId: document.id,
							extractorRegistryMatch: chunkExtractorRegistryMatch,
							labels: chunkLabels,
							source: chunk.source ?? preview.document.source,
							sourceNativeKind: chunkSourceNativeKind
						});
					}
					const normalized = chunk.text.trim();
					if (!normalized) {
						emptyChunks += 1;
						continue;
					}

					const tokenCount = normalized
						.split(/\s+/)
						.filter(Boolean).length;
					if (normalized.length < 24 || tokenCount < 4) {
						lowSignalChunks += 1;
					}
				}
			}
		}

		for (const job of ingestJobs) {
			if (job.status !== 'failed') {
				continue;
			}

			failuresByInputKind.set(
				job.inputKind,
				(failuresByInputKind.get(job.inputKind) ?? 0) + 1
			);
			for (const extractorName of job.extractorNames ?? []) {
				failuresByExtractor.set(
					extractorName,
					(failuresByExtractor.get(extractorName) ?? 0) + 1
				);
			}
		}

		for (const job of adminJobs) {
			if (job.status !== 'failed') {
				continue;
			}

			failuresByAdminAction.set(
				job.action,
				(failuresByAdminAction.get(job.action) ?? 0) + 1
			);
		}

		for (const job of syncJobs) {
			if (job.status !== 'failed') {
				continue;
			}

			failuresByAdminAction.set(
				job.action,
				(failuresByAdminAction.get(job.action) ?? 0) + 1
			);
		}

		return {
			averageChunksPerDocument:
				documents.length > 0
					? Number(
							(
								documents.reduce(
									(sum, document) =>
										sum + (document.chunkCount ?? 0),
									0
								) / documents.length
							).toFixed(2)
						)
					: 0,
			duplicateDocumentIds: [...documentIdCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([id]) => id),
			duplicateDocumentIdGroups: [...documentIdCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([id, count]) => ({ count, id }))
				.sort((left, right) => right.count - left.count),
			duplicateSources: [...sourceCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([source]) => source),
			duplicateSourceGroups: [...sourceCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([source, count]) => ({ count, source }))
				.sort((left, right) => right.count - left.count),
			documentsMissingMetadata,
			documentsMissingSource,
			documentsMissingTitle,
			documentsMissingCreatedAt,
			documentsMissingUpdatedAt,
			documentsWithoutChunkPreview,
			emptyChunks,
			emptyDocuments,
			coverageByFormat: Object.fromEntries(coverageByFormat.entries()),
			coverageByKind: Object.fromEntries(coverageByKind.entries()),
			failedAdminJobs: adminJobs.filter((job) => job.status === 'failed')
				.length,
			failedIngestJobs: ingestJobs.filter(
				(job) => job.status === 'failed'
			).length,
			failuresByAdminAction: Object.fromEntries(
				failuresByAdminAction.entries()
			),
			failuresByExtractor: Object.fromEntries(
				failuresByExtractor.entries()
			),
			failuresByInputKind: Object.fromEntries(
				failuresByInputKind.entries()
			),
			inspectedChunks,
			inspectedDocuments,
			inspection: {
				chunkingProfiles: Object.fromEntries(
					chunkingProfiles.entries()
				),
				corpusKeys: Object.fromEntries(corpusKeys.entries()),
				chunksWithSourceLabels,
				documentsWithSourceLabels,
				extractorRegistryMatches: Object.fromEntries(
					extractorRegistryMatches.entries()
				),
				sampleChunks,
				sampleDocuments,
				sourceNativeKinds: Object.fromEntries(
					sourceNativeKinds.entries()
				)
			},
			lowSignalChunks,
			newestDocumentAgeMs,
			oldestDocumentAgeMs,
			staleAfterMs,
			staleDocuments
		} as RAGCorpusHealth;
	};

	const buildReadiness = () => ({
		embeddingConfigured: Boolean(config.embedding ?? config.collection),
		embeddingModel:
			config.embeddingModel ??
			(config.collection ? 'collection-managed embeddings' : undefined),
		extractorNames: (extractors ?? []).map((extractor) => extractor.name),
		extractorsConfigured: (extractors?.length ?? 0) > 0,
		indexManagerConfigured: Boolean(indexManager),
		model: typeof config.model === 'string' ? config.model : undefined,
		providerConfigured: typeof config.provider === 'function',
		providerName:
			typeof config.provider === 'function'
				? config.readinessProviderName
				: undefined,
		rerankerConfigured: Boolean(config.rerank ?? config.collection)
	});

	const buildAdminCapabilities = async (request?: Request) => ({
		canAnalyzeBackend:
			Boolean(ragStore?.analyze) &&
			(request ? await isAuthorized(request, 'analyze_backend') : true),
		canClearIndex:
			Boolean(ragStore?.clear) &&
			(request ? await isAuthorized(request, 'clear_index') : true),
		canCreateDocument:
			Boolean(indexManager?.createDocument) &&
			(request ? await isAuthorized(request, 'create_document') : true),
		canDeleteDocument:
			Boolean(indexManager?.deleteDocument) &&
			(request ? await isAuthorized(request, 'delete_document') : true),
		canListSyncSources:
			Boolean(indexManager?.listSyncSources) &&
			(request ? await isAuthorized(request, 'list_sync_sources') : true),
		canManageRetrievalBaselines:
			Boolean(retrievalBaselineStore) &&
			(request
				? await isAuthorized(request, 'manage_retrieval_admin')
				: true),
		canPruneSearchTraces:
			Boolean(searchTraceStore) &&
			(request
				? await isAuthorized(request, 'prune_search_traces')
				: true),
		canRebuildNativeIndex:
			Boolean(ragStore?.rebuildNativeIndex) &&
			(request
				? await isAuthorized(request, 'rebuild_native_index')
				: true),
		canReindexDocument:
			Boolean(indexManager?.reindexDocument) &&
			(request ? await isAuthorized(request, 'reindex_document') : true),
		canReindexSource:
			Boolean(indexManager?.reindexSource) &&
			(request ? await isAuthorized(request, 'reindex_source') : true),
		canReseed:
			Boolean(indexManager?.reseed) &&
			(request ? await isAuthorized(request, 'reseed') : true),
		canReset:
			Boolean(indexManager?.reset) &&
			(request ? await isAuthorized(request, 'reset') : true),
		canSyncAllSources:
			Boolean(indexManager?.syncAllSources) &&
			(request ? await isAuthorized(request, 'sync_all_sources') : true),
		canSyncSource:
			Boolean(indexManager?.syncSource) &&
			(request ? await isAuthorized(request, 'sync_source') : true)
	});

	const isBackendMaintenanceAction = (
		action: RAGAdminActionRecord['action'] | RAGAdminJobRecord['action']
	): action is 'analyze_backend' | 'rebuild_native_index' =>
		action === 'analyze_backend' || action === 'rebuild_native_index';

	const isActiveBackendMaintenanceJob = (
		job: RAGAdminJobRecord
	): job is RAGAdminJobRecord & {
		action: 'analyze_backend' | 'rebuild_native_index';
	} => job.status === 'running' && isBackendMaintenanceAction(job.action);

	const isBackendMaintenanceHistoryAction = (
		action: RAGAdminActionRecord
	): action is RAGAdminActionRecord & {
		action: 'analyze_backend' | 'rebuild_native_index';
	} => isBackendMaintenanceAction(action.action);

	const buildBackendMaintenanceSummary = (input: {
		admin: RAGAdminCapabilities;
		adminActions: RAGAdminActionRecord[];
		adminJobs: RAGAdminJobRecord[];
		status?: RAGVectorStoreStatus;
	}): RAGBackendMaintenanceSummary | undefined => {
		if (!input.status || input.status.backend === 'in_memory') {
			return undefined;
		}

		const activeJobs = input.adminJobs
			.filter(isActiveBackendMaintenanceJob)
			.map((job) => ({
				action: job.action,
				startedAt: job.startedAt,
				target: job.target
			}));
		const recentActions = input.adminActions
			.filter(isBackendMaintenanceHistoryAction)
			.slice(0, 4)
			.map((action) => ({
				action: action.action,
				error: action.error,
				finishedAt: action.finishedAt,
				status: action.status,
				target: action.target
			}));

		const recommendations =
			input.status.backend === 'postgres' &&
			input.status.native &&
			'mode' in input.status.native &&
			input.status.native.mode === 'pgvector'
				? [
						input.status.native.indexPresent === false &&
						input.admin.canRebuildNativeIndex
							? {
									action: 'rebuild_native_index' as const,
									code: 'native_index_missing' as const,
									message:
										'Index is missing. Rebuild the native index now.',
									severity: 'error' as const
								}
							: null,
						input.status.native.lastHealthError &&
						input.admin.canAnalyzeBackend
							? {
									action: 'analyze_backend' as const,
									code: 'backend_statistics_refresh_recommended' as const,
									message:
										'Health checks are failing. Run analyze after correcting backend state.',
									severity: 'warning' as const
								}
							: null,
						typeof input.status.native.estimatedRowCount ===
							'number' &&
						input.status.native.estimatedRowCount >= 1000 &&
						typeof input.status.native.lastAnalyzeAt !== 'number' &&
						input.admin.canAnalyzeBackend
							? {
									action: 'analyze_backend' as const,
									code: 'backend_statistics_refresh_recommended' as const,
									message:
										'Larger corpus detected without analyze history. Run analyze to refresh planner statistics.',
									severity: 'warning' as const
								}
							: null,
						typeof input.status.native.lastReindexAt === 'number' &&
						(typeof input.status.native.lastAnalyzeAt !==
							'number' ||
							input.status.native.lastAnalyzeAt <
								input.status.native.lastReindexAt) &&
						input.admin.canAnalyzeBackend
							? {
									action: 'analyze_backend' as const,
									code: 'backend_statistics_refresh_recommended' as const,
									message:
										'Analyze is older than the last index rebuild. Refresh planner statistics.',
									severity: 'warning' as const
								}
							: null
					].filter((entry): entry is NonNullable<typeof entry> =>
						Boolean(entry)
					)
				: input.status.backend === 'sqlite' &&
					  input.status.native &&
					  'mode' in input.status.native &&
					  input.status.native.mode === 'vec0'
					? [
							input.status.native.lastLoadError
								? {
										code: 'native_backend_inactive' as const,
										message:
											'Native sqlite-vec is inactive. Fix extension loading before expecting native acceleration.',
										severity: 'error' as const
									}
								: null,
							input.status.native.active &&
							typeof input.status.native.lastAnalyzeAt !==
								'number' &&
							input.admin.canAnalyzeBackend
								? {
										action: 'analyze_backend' as const,
										code: 'backend_statistics_refresh_recommended' as const,
										message:
											'Run backend analyze to refresh SQLite planner statistics and optimize storage.',
										severity: 'warning' as const
									}
								: null,
							typeof input.status.native.pageCount === 'number' &&
							typeof input.status.native.freelistCount ===
								'number' &&
							input.status.native.pageCount > 0 &&
							input.status.native.freelistCount /
								input.status.native.pageCount >=
								0.2 &&
							input.admin.canAnalyzeBackend
								? {
										action: 'analyze_backend' as const,
										code: 'sqlite_storage_optimization_recommended' as const,
										message:
											'SQLite freelist growth is high. Run backend analyze to let SQLite optimize storage.',
										severity: 'warning' as const
									}
								: null,
							(input.status.native.lastQueryError ||
								input.status.native.lastUpsertError) &&
							input.admin.canAnalyzeBackend
								? {
										action: 'analyze_backend' as const,
										code: 'native_backend_recent_errors' as const,
										message:
											'Native sqlite-vec saw recent errors. Run backend analyze after correcting database state.',
										severity: 'warning' as const
									}
								: null
						].filter((entry): entry is NonNullable<typeof entry> =>
							Boolean(entry)
						)
					: [];

		return {
			activeJobs,
			backend: input.status.backend,
			recentActions,
			recommendations
		};
	};

	const buildOperationsPayload = async (
		request?: Request
	): Promise<RAGOperationsResponse> => {
		const accessScope = await loadAccessScope(request);
		const filterScopedGovernanceEntries = <
			T extends { groupKey?: string; corpusGroupKey?: string }
		>(
			entries: T[] | undefined
		) =>
			entries
				? filterByCorpusGroupKey(
						accessScope,
						filterByComparisonGroupKey(accessScope, entries)
					)
				: undefined;
		const collection =
			config.collection ??
			(ragStore
				? createRAGCollection({
						defaultModel: config.embeddingModel,
						defaultTopK: topK,
						embedding: config.embedding,
						store: ragStore
					})
				: null);
		const indexedDocuments = indexManager
			? (await indexManager.listDocuments({})).filter((document) =>
					matchesAccessScope(accessScope, {
						corpusKey: document.corpusKey,
						documentId: document.id,
						metadata: document.metadata,
						source: document.source
					})
				)
			: [];

		const traceStats = searchTraceStore
			? await summarizeRAGSearchTraceStore({
					store: searchTraceStore
				})
			: undefined;
		const recentTraceRuns = searchTracePruneHistoryStore
			? await loadRAGSearchTracePruneHistory({
					limit: 5,
					store: searchTracePruneHistoryStore
				})
			: undefined;
		const recentRetrievalComparisonRuns = filterScopedGovernanceEntries(
			retrievalComparisonHistoryStore
				? await loadRAGRetrievalComparisonHistory({
						limit: 5,
						store: retrievalComparisonHistoryStore
					})
				: undefined
		);
		const activeRetrievalBaselines = filterScopedGovernanceEntries(
			retrievalBaselineStore
				? await loadRAGRetrievalBaselines({
						limit: 5,
						status: 'active',
						store: retrievalBaselineStore
					})
				: undefined
		);
		const retrievalBaselineHistory = filterScopedGovernanceEntries(
			retrievalBaselineStore
				? await loadRAGRetrievalBaselines({
						limit: 10,
						store: retrievalBaselineStore
					})
				: undefined
		);
		const recentRetrievalReleaseDecisions = filterScopedGovernanceEntries(
			config.retrievalReleaseDecisionStore
				? await loadRAGRetrievalReleaseDecisions({
						limit: 10,
						store: config.retrievalReleaseDecisionStore
					})
				: undefined
		);
		const recentRetrievalLaneHandoffDecisions =
			filterScopedGovernanceEntries(
				config.retrievalLaneHandoffDecisionStore
					? await loadRAGRetrievalLaneHandoffDecisions({
							limit: 10,
							store: config.retrievalLaneHandoffDecisionStore
						})
					: undefined
			);
		const recentRetrievalLaneHandoffIncidents =
			filterScopedGovernanceEntries(
				config.retrievalLaneHandoffIncidentStore
					? await loadRAGRetrievalLaneHandoffIncidents({
							limit: 10,
							store: config.retrievalLaneHandoffIncidentStore
						})
					: undefined
			);
		const recentRetrievalLaneHandoffIncidentHistory =
			filterScopedGovernanceEntries(
				config.retrievalLaneHandoffIncidentHistoryStore
					? await loadRAGRetrievalLaneHandoffIncidentHistory({
							limit: 10,
							store: config.retrievalLaneHandoffIncidentHistoryStore
						})
					: undefined
			);
		const recentHandoffAutoCompletePolicyHistory =
			filterScopedGovernanceEntries(
				config.retrievalLaneHandoffAutoCompletePolicyHistoryStore
					? await loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory(
							{
								limit: 10,
								store: config.retrievalLaneHandoffAutoCompletePolicyHistoryStore
							}
						)
					: undefined
			);
		const recentReleaseLanePolicyHistory = filterScopedGovernanceEntries(
			config.retrievalReleaseLanePolicyHistoryStore
				? await loadRAGRetrievalReleaseLanePolicyHistory({
						limit: 10,
						store: config.retrievalReleaseLanePolicyHistoryStore
					})
				: undefined
		);
		const recentBaselineGatePolicyHistory = filterScopedGovernanceEntries(
			config.retrievalBaselineGatePolicyHistoryStore
				? await loadRAGRetrievalBaselineGatePolicyHistory({
						limit: 10,
						store: config.retrievalBaselineGatePolicyHistoryStore
					})
				: undefined
		);
		const recentReleaseLaneEscalationPolicyHistory =
			filterScopedGovernanceEntries(
				config.retrievalReleaseLaneEscalationPolicyHistoryStore
					? await loadRAGRetrievalReleaseLaneEscalationPolicyHistory({
							limit: 10,
							store: config.retrievalReleaseLaneEscalationPolicyHistoryStore
						})
					: undefined
			);
		const recentIncidentRemediationDecisions =
			config.retrievalIncidentRemediationDecisionStore
				? await loadRAGRetrievalIncidentRemediationDecisions({
						limit: 10,
						store: config.retrievalIncidentRemediationDecisionStore
					})
				: undefined;
		const recentIncidentRemediationExecutions =
			config.retrievalIncidentRemediationExecutionHistoryStore
				? filterScopedGovernanceEntries(
						await loadRAGRetrievalIncidentRemediationExecutionHistory(
							{
								limit: 25,
								store: config.retrievalIncidentRemediationExecutionHistoryStore
							}
						)
					)
				: undefined;
		const incidentRemediationExecutionSummary =
			buildIncidentRemediationExecutionSummary(
				recentIncidentRemediationExecutions
			);
		const enrichedRecentRetrievalReleaseDecisions =
			recentRetrievalReleaseDecisions?.map((decision) => ({
				...decision,
				...getDecisionFreshness({ record: decision })
			}));
		const promotionCandidates = buildRetrievalPromotionCandidates({
			activeBaselines: activeRetrievalBaselines,
			decisions: recentRetrievalReleaseDecisions,
			limit: 10,
			runs: recentRetrievalComparisonRuns
		});
		const latestRejectedCandidate =
			enrichedRecentRetrievalReleaseDecisions?.find(
				(entry) => entry.kind === 'reject'
			);
		const latestRetrievalComparisonRun = recentRetrievalComparisonRuns?.[0];
		const adaptiveNativePlannerBenchmark =
			await loadAdaptiveNativePlannerBenchmarkRuntime({
				historyLimit: 5,
				snapshotLimit: 5
			});
		const nativeBackendComparisonBenchmark =
			await loadNativeBackendComparisonBenchmarkRuntime({
				historyLimit: 5,
				snapshotLimit: 5
			});
		const presentationCueBenchmark =
			await loadPresentationCueBenchmarkRuntime({
				historyLimit: 5,
				snapshotLimit: 5
			});
		const spreadsheetCueBenchmark =
			await loadSpreadsheetCueBenchmarkRuntime({
				historyLimit: 5,
				snapshotLimit: 5
			});
		const latestPromotionReadiness = latestRetrievalComparisonRun
			? (() => {
					const activeTargetRolloutLabel =
						activeRetrievalBaselines?.find(
							(entry) =>
								entry.groupKey ===
								latestRetrievalComparisonRun.groupKey
						)?.rolloutLabel;
					const state = getPromotionCandidateState({
						decisions: recentRetrievalReleaseDecisions,
						now: Date.now(),
						targetRolloutLabel: activeTargetRolloutLabel,
						run: latestRetrievalComparisonRun
					});
					return {
						baselineRetrievalId: state.baselineRetrievalId,
						candidateRetrievalId: state.candidateRetrievalId,
						effectiveBaselineGatePolicy:
							state.effectiveBaselineGatePolicy,
						effectiveReleasePolicy: state.effectiveReleasePolicy,
						gateStatus: state.gateStatus,
						ready: state.ready,
						reasons: state.reasons,
						requiresApproval: state.requiresApproval,
						requiresOverride: Boolean(
							state.gateStatus && state.gateStatus !== 'pass'
						),
						targetRolloutLabel: activeTargetRolloutLabel,
						sourceRunId: latestRetrievalComparisonRun.id
					};
				})()
			: undefined;
		const latestPromotionReadinessByLane = latestRetrievalComparisonRun
			? (['canary', 'stable', 'rollback_target'] as const).map(
					(targetRolloutLabel) => {
						const state = getPromotionCandidateState({
							decisions: recentRetrievalReleaseDecisions,
							now: Date.now(),
							targetRolloutLabel,
							run: latestRetrievalComparisonRun
						});
						return {
							baselineRetrievalId: state.baselineRetrievalId,
							candidateRetrievalId: state.candidateRetrievalId,
							effectiveBaselineGatePolicy:
								state.effectiveBaselineGatePolicy,
							effectiveReleasePolicy:
								state.effectiveReleasePolicy,
							gateStatus: state.gateStatus,
							ready: state.ready,
							reasons: state.reasons,
							requiresApproval: state.requiresApproval,
							requiresOverride: Boolean(
								state.gateStatus && state.gateStatus !== 'pass'
							),
							sourceRunId: latestRetrievalComparisonRun.id,
							targetRolloutLabel
						};
					}
				)
			: undefined;
		const getComparisonCorpusGroupKey = (groupKey?: string) => {
			if (!groupKey) {
				return undefined;
			}

			return (
				(recentRetrievalComparisonRuns ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey ??
				(activeRetrievalBaselines ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey ??
				(recentRetrievalReleaseDecisions ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						typeof entry.corpusGroupKey === 'string'
				)?.corpusGroupKey
			);
		};
		const baseReleaseGroups = (() => {
			const groups = new Set<string>();
			for (const run of recentRetrievalComparisonRuns ?? []) {
				if (run.groupKey) groups.add(run.groupKey);
			}
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groups.add(baseline.groupKey);
			}
			for (const decision of recentRetrievalReleaseDecisions ?? []) {
				if (decision.groupKey) groups.add(decision.groupKey);
			}
			return [...groups]
				.map((groupKey) => {
					const latestDecision = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).find((entry) => entry.groupKey === groupKey);
					const activeBaseline = (
						activeRetrievalBaselines ?? []
					).find((entry) => entry.groupKey === groupKey);
					const latestRejected = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).find(
						(entry) =>
							entry.groupKey === groupKey &&
							entry.kind === 'reject'
					);
					const groupCandidates = promotionCandidates.filter(
						(entry) => entry.groupKey === groupKey
					);
					const pendingCandidateCount = groupCandidates.filter(
						(entry) => entry.ready
					).length;
					const blockedReasons = [
						...new Set(
							groupCandidates
								.filter((entry) => !entry.ready)
								.flatMap((entry) => entry.reasons)
						)
					];
					const actionRequiredReasons = [
						...new Set(
							groupCandidates
								.filter(
									(entry) =>
										entry.reviewStatus === 'needs_review' ||
										!entry.ready
								)
								.flatMap((entry) =>
									entry.reviewStatus === 'needs_review'
										? [
												'approval renewal is required before this group can promote its latest candidate'
											]
										: entry.reasons
								)
						)
					];
					const recommendedActionReasons = (() => {
						if (
							groupCandidates.some(
								(entry) => entry.priority === 'gate_fail'
							)
						) {
							const gateFailReason = groupCandidates.find(
								(entry) =>
									entry.priority === 'gate_fail' &&
									entry.reasons[0]
							)?.reasons[0];
							return [
								gateFailReason ??
									'candidate regressed or failed the active gate and should be investigated'
							];
						}
						if (
							groupCandidates.some(
								(entry) => entry.reviewStatus === 'needs_review'
							)
						) {
							return [
								'approval has gone stale and should be renewed before promotion'
							];
						}
						if (
							groupCandidates.some(
								(entry) =>
									entry.requiresApproval &&
									entry.approved !== true &&
									entry.reviewStatus === 'blocked'
							)
						) {
							return [
								'candidate needs an explicit approval decision before promotion'
							];
						}
						if (groupCandidates.some((entry) => entry.ready)) {
							return ['latest candidate is ready to promote'];
						}
						return ['continue monitoring release state'];
					})();
					const classification = classifyGovernanceReasons([
						...blockedReasons,
						...actionRequiredReasons,
						...recommendedActionReasons
					]);
					const recommendedAction: NonNullable<
						NonNullable<
							RAGOperationsResponse['retrievalComparisons']
						>['releaseGroups']
					>[number]['recommendedAction'] = groupCandidates.some(
						(entry) => entry.priority === 'gate_fail'
					)
						? 'investigate_regression'
						: groupCandidates.some(
									(entry) =>
										entry.reviewStatus === 'needs_review'
							  )
							? 'renew_approval'
							: groupCandidates.some(
										(entry) =>
											entry.requiresApproval &&
											entry.approved !== true &&
											entry.reviewStatus === 'blocked'
								  )
								? 'await_approval'
								: groupCandidates.some((entry) => entry.ready)
									? 'promote_candidate'
									: 'monitor';
					const escalationSeverity: NonNullable<
						NonNullable<
							RAGOperationsResponse['retrievalComparisons']
						>['releaseGroups']
					>[number]['escalationSeverity'] = groupCandidates.some(
						(entry) => entry.priority === 'gate_fail'
					)
						? 'critical'
						: groupCandidates.some(
									(entry) =>
										entry.reviewStatus === 'needs_review' ||
										entry.priority === 'gate_warn'
							  )
							? 'warning'
							: actionRequiredReasons.length > 0
								? 'info'
								: 'none';
					return {
						activeBaselineRetrievalId: activeBaseline?.retrievalId,
						activeBaselineGatePolicy: activeBaseline?.policy,
						activeBaselineRolloutLabel:
							activeBaseline?.rolloutLabel,
						activeBaselineVersion: activeBaseline?.version,
						actionRequired: actionRequiredReasons.length > 0,
						actionRequiredReasons,
						approvalMaxAgeMs:
							getRetrievalReleasePolicy(groupKey)
								.approvalMaxAgeMs,
						approvalRequired:
							getRetrievalReleasePolicy(groupKey)
								.requireApprovalBeforePromotion === true,
						blockedReasons,
						classification,
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						escalationSeverity,
						groupKey,
						latestDecisionAt: latestDecision?.decidedAt,
						latestDecisionKind: latestDecision?.kind,
						latestRejectedCandidateRetrievalId:
							latestRejected?.retrievalId,
						openIncidentCount: 0,
						acknowledgedOpenIncidentCount: 0,
						unacknowledgedOpenIncidentCount: 0,
						pendingCandidateCount,
						recommendedAction,
						recommendedActionReasons
					};
				})
				.sort((left, right) =>
					left.groupKey.localeCompare(right.groupKey)
				);
		})();
		const buildReleaseGroupsWithIncidentCounts = (
			groups: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseGroups']
			>,
			incidents?: RAGRetrievalReleaseIncidentRecord[]
		) =>
			groups.map((group) => {
				const groupOpenIncidents = (incidents ?? []).filter(
					(entry) =>
						entry.groupKey === group.groupKey &&
						entry.status === 'open'
				);
				const acknowledgedOpenIncidentCount = groupOpenIncidents.filter(
					(entry) => typeof entry.acknowledgedAt === 'number'
				).length;
				return {
					...group,
					acknowledgedOpenIncidentCount,
					classification: groupOpenIncidents.some(
						(entry) => entry.classification === 'runtime'
					)
						? 'runtime'
						: groupOpenIncidents.some(
									(entry) => entry.classification === 'cue'
							  )
							? 'cue'
							: groupOpenIncidents.some(
										(entry) =>
											entry.classification === 'evidence'
								  )
								? 'evidence'
								: groupOpenIncidents.some(
											(entry) =>
												entry.classification ===
												'multivector'
									  )
									? 'multivector'
									: group.classification,
					openIncidentCount: groupOpenIncidents.length,
					unacknowledgedOpenIncidentCount:
						groupOpenIncidents.length -
						acknowledgedOpenIncidentCount
				};
			});
		const buildIncidentSummary = (
			incidents?: RAGRetrievalReleaseIncidentRecord[]
		): NonNullable<
			NonNullable<
				RAGOperationsResponse['retrievalComparisons']
			>['incidentSummary']
		> => {
			const allIncidents = incidents ?? [];
			const openIncidents = allIncidents.filter(
				(entry) => entry.status === 'open'
			);
			const acknowledgedOpenCount = openIncidents.filter(
				(entry) => typeof entry.acknowledgedAt === 'number'
			).length;
			return {
				acknowledgedOpenCount,
				latestAcknowledgedAt: allIncidents
					.filter((entry) => typeof entry.acknowledgedAt === 'number')
					.map((entry) => entry.acknowledgedAt ?? 0)
					.sort((left, right) => right - left)[0],
				openCount: openIncidents.length,
				resolvedCount: allIncidents.filter(
					(entry) => entry.status === 'resolved'
				).length,
				unacknowledgedOpenCount:
					openIncidents.length - acknowledgedOpenCount
			};
		};
		let recentIncidents = filterScopedGovernanceEntries(
			await syncRetrievalReleaseIncidents({
				promotionCandidates
			})
		);
		let releaseGroups = buildReleaseGroupsWithIncidentCounts(
			baseReleaseGroups,
			recentIncidents
		);
		let incidentSummary = buildIncidentSummary(recentIncidents);
		const releaseTimelines = (() => {
			const groups = new Set<string>();
			for (const decision of enrichedRecentRetrievalReleaseDecisions ??
				[]) {
				if (decision.groupKey) groups.add(decision.groupKey);
			}
			return [...groups]
				.map((groupKey) => {
					const groupDecisions = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).filter((entry) => entry.groupKey === groupKey);
					const latest = groupDecisions[0];
					return {
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						lastApprovedAt: groupDecisions.find(
							(entry) => entry.kind === 'approve'
						)?.decidedAt,
						lastPromotedAt: groupDecisions.find(
							(entry) => entry.kind === 'promote'
						)?.decidedAt,
						lastRejectedAt: groupDecisions.find(
							(entry) => entry.kind === 'reject'
						)?.decidedAt,
						lastRevertedAt: groupDecisions.find(
							(entry) => entry.kind === 'revert'
						)?.decidedAt,
						latestDecisionAt: latest?.decidedAt,
						latestDecisionFreshnessStatus: latest?.freshnessStatus,
						latestDecisionKind: latest?.kind
					};
				})
				.sort((left, right) =>
					left.groupKey.localeCompare(right.groupKey)
				);
		})();
		const releaseLaneTimelines = (() => {
			const groupKeys = new Set<string>();
			for (const decision of enrichedRecentRetrievalReleaseDecisions ??
				[]) {
				if (decision.groupKey) groupKeys.add(decision.groupKey);
			}
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groupKeys.add(baseline.groupKey);
			}
			const summaries: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseLaneTimelines']
			> = [];
			for (const groupKey of groupKeys) {
				for (const targetRolloutLabel of [
					'canary',
					'stable',
					'rollback_target'
				] as const) {
					const laneDecisions = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).filter(
						(entry) =>
							entry.groupKey === groupKey &&
							(entry.targetRolloutLabel ?? undefined) ===
								targetRolloutLabel
					);
					const latest = laneDecisions[0];
					summaries.push({
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						lastApprovedAt: laneDecisions.find(
							(entry) => entry.kind === 'approve'
						)?.decidedAt,
						lastPromotedAt: laneDecisions.find(
							(entry) => entry.kind === 'promote'
						)?.decidedAt,
						lastRejectedAt: laneDecisions.find(
							(entry) => entry.kind === 'reject'
						)?.decidedAt,
						lastRevertedAt: laneDecisions.find(
							(entry) => entry.kind === 'revert'
						)?.decidedAt,
						latestDecisionAt: latest?.decidedAt,
						latestDecisionFreshnessStatus: latest?.freshnessStatus,
						latestDecisionKind: latest?.kind,
						targetRolloutLabel
					});
				}
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		const releaseLaneDecisions = (() => {
			const groupKeys = new Set<string>();
			for (const decision of enrichedRecentRetrievalReleaseDecisions ??
				[]) {
				if (decision.groupKey) groupKeys.add(decision.groupKey);
			}
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groupKeys.add(baseline.groupKey);
			}
			const summaries: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseLaneDecisions']
			> = [];
			for (const groupKey of groupKeys) {
				for (const targetRolloutLabel of [
					'canary',
					'stable',
					'rollback_target'
				] as const) {
					const laneDecisions = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).filter(
						(entry) =>
							entry.groupKey === groupKey &&
							(entry.targetRolloutLabel ?? undefined) ===
								targetRolloutLabel
					);
					const latest = laneDecisions[0];
					summaries.push({
						approvalCount: laneDecisions.filter(
							(entry) => entry.kind === 'approve'
						).length,
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						decisionCount: laneDecisions.length,
						groupKey,
						latestDecisionAt: latest?.decidedAt,
						latestDecisionBy: latest?.decidedBy,
						latestDecisionKind: latest?.kind,
						promotionCount: laneDecisions.filter(
							(entry) => entry.kind === 'promote'
						).length,
						rejectionCount: laneDecisions.filter(
							(entry) => entry.kind === 'reject'
						).length,
						revertCount: laneDecisions.filter(
							(entry) => entry.kind === 'revert'
						).length,
						targetRolloutLabel
					});
				}
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		const approvalScopes = (() => {
			const scopes = new Map<
				string,
				RAGRetrievalReleaseApprovalScopeSummary
			>();
			for (const targetRolloutLabel of [
				'canary',
				'stable',
				'rollback_target'
			] as const) {
				for (const groupKey of new Set([
					...((recentRetrievalComparisonRuns ?? [])
						.map((entry) => entry.groupKey)
						.filter(Boolean) as string[]),
					...((activeRetrievalBaselines ?? [])
						.map((entry) => entry.groupKey)
						.filter(Boolean) as string[])
				])) {
					const scopedDecisions = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).filter(
						(entry) =>
							entry.groupKey === groupKey &&
							entry.targetRolloutLabel === targetRolloutLabel &&
							(entry.kind === 'approve' ||
								entry.kind === 'reject')
					);
					const latest = scopedDecisions[0];
					const latestApproved = scopedDecisions.find(
						(entry) => entry.kind === 'approve'
					);
					const latestRejected = scopedDecisions.find(
						(entry) => entry.kind === 'reject'
					);
					scopes.set(`${groupKey}:${targetRolloutLabel}`, {
						groupKey,
						latestApprovedAt: latestApproved?.decidedAt,
						latestApprovedBy: latestApproved?.decidedBy,
						latestDecisionAt: latest?.decidedAt,
						latestDecisionKind:
							latest?.kind === 'approve' ||
							latest?.kind === 'reject'
								? latest.kind
								: undefined,
						latestRejectedAt: latestRejected?.decidedAt,
						latestRejectedBy: latestRejected?.decidedBy,
						status:
							latest?.kind === 'approve'
								? 'approved'
								: latest?.kind === 'reject'
									? 'rejected'
									: 'none',
						targetRolloutLabel
					});
				}
			}
			return [...scopes.values()].sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		const releaseLaneAudits = (() => {
			const groupKeys = new Set<string>();
			for (const run of recentRetrievalComparisonRuns ?? []) {
				if (run.groupKey) groupKeys.add(run.groupKey);
			}
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groupKeys.add(baseline.groupKey);
			}
			for (const decision of enrichedRecentRetrievalReleaseDecisions ??
				[]) {
				if (decision.groupKey) groupKeys.add(decision.groupKey);
			}
			const summaries = [];
			for (const groupKey of groupKeys) {
				for (const targetRolloutLabel of [
					'canary',
					'stable',
					'rollback_target'
				] as const) {
					const laneDecisions = (
						enrichedRecentRetrievalReleaseDecisions ?? []
					).filter(
						(entry) =>
							entry.groupKey === groupKey &&
							(entry.targetRolloutLabel ?? undefined) ===
								targetRolloutLabel
					);
					const activeBaseline = (
						activeRetrievalBaselines ?? []
					).find(
						(entry) =>
							entry.groupKey === groupKey &&
							(entry.rolloutLabel ?? undefined) ===
								targetRolloutLabel
					);
					const latest = laneDecisions[0];
					summaries.push({
						activeBaselineRetrievalId: activeBaseline?.retrievalId,
						activeBaselineVersion: activeBaseline?.version,
						groupKey,
						lastApprovedAt: laneDecisions.find(
							(entry) => entry.kind === 'approve'
						)?.decidedAt,
						lastApprovedBy: laneDecisions.find(
							(entry) => entry.kind === 'approve'
						)?.decidedBy,
						lastPromotedAt: laneDecisions.find(
							(entry) => entry.kind === 'promote'
						)?.decidedAt,
						lastPromotedBy: laneDecisions.find(
							(entry) => entry.kind === 'promote'
						)?.decidedBy,
						lastRejectedAt: laneDecisions.find(
							(entry) => entry.kind === 'reject'
						)?.decidedAt,
						lastRejectedBy: laneDecisions.find(
							(entry) => entry.kind === 'reject'
						)?.decidedBy,
						lastRevertedAt: laneDecisions.find(
							(entry) => entry.kind === 'revert'
						)?.decidedAt,
						lastRevertedBy: laneDecisions.find(
							(entry) => entry.kind === 'revert'
						)?.decidedBy,
						latestDecisionAt: latest?.decidedAt,
						latestDecisionKind: latest?.kind,
						targetRolloutLabel
					});
				}
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		const releaseLaneRecommendations = (() => {
			const summaries: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseLaneRecommendations']
			> = [];
			for (const group of releaseGroups) {
				for (const targetRolloutLabel of [
					'canary',
					'stable',
					'rollback_target'
				] as const) {
					const candidate = promotionCandidates.find(
						(entry) =>
							entry.groupKey === group.groupKey &&
							entry.targetRolloutLabel === targetRolloutLabel
					);
					const recommendedAction =
						candidate?.priority === 'gate_fail'
							? 'investigate_regression'
							: candidate?.reviewStatus === 'needs_review'
								? 'renew_approval'
								: candidate &&
									  candidate.requiresApproval &&
									  candidate.approved !== true &&
									  candidate.reviewStatus === 'blocked'
									? 'await_approval'
									: candidate?.ready
										? 'promote_candidate'
										: 'monitor';
					const recommendedActionReasons =
						candidate?.priority === 'gate_fail'
							? [
									candidate.reasons[0] ??
										'candidate regressed or failed the active gate and should be investigated'
								]
							: candidate?.reviewStatus === 'needs_review'
								? [
										'approval has gone stale and should be renewed before promotion'
									]
								: candidate &&
									  candidate.requiresApproval &&
									  candidate.approved !== true &&
									  candidate.reviewStatus === 'blocked'
									? [
											'candidate needs an explicit approval decision before promotion'
										]
									: candidate?.ready
										? [
												'latest candidate is ready to promote'
											]
										: ['continue monitoring release state'];
					const classification = candidate?.reasons?.length
						? classifyGovernanceReasons(candidate.reasons)
						: (recentIncidents ?? []).some(
									(entry) =>
										entry.groupKey === group.groupKey &&
										entry.targetRolloutLabel ===
											targetRolloutLabel &&
										entry.classification === 'runtime'
							  )
							? ('runtime' as const)
							: (recentIncidents ?? []).some(
										(entry) =>
											entry.groupKey === group.groupKey &&
											entry.targetRolloutLabel ===
												targetRolloutLabel &&
											entry.classification === 'cue'
								  )
								? ('cue' as const)
								: (recentIncidents ?? []).some(
											(entry) =>
												entry.groupKey ===
													group.groupKey &&
												entry.targetRolloutLabel ===
													targetRolloutLabel &&
												entry.classification ===
													'evidence'
									  )
									? ('evidence' as const)
									: (recentIncidents ?? []).some(
												(entry) =>
													entry.groupKey ===
														group.groupKey &&
													entry.targetRolloutLabel ===
														targetRolloutLabel &&
													entry.classification ===
														'multivector'
										  )
										? ('multivector' as const)
										: ('general' as const);
					summaries.push({
						baselineRetrievalId: candidate?.baselineRetrievalId,
						candidateRetrievalId: candidate?.candidateRetrievalId,
						classification,
						effectiveBaselineGatePolicy:
							candidate?.effectiveBaselineGatePolicy,
						effectiveReleasePolicy:
							candidate?.effectiveReleasePolicy,
						gateStatus: candidate?.gateStatus,
						groupKey: group.groupKey,
						ready: candidate?.ready ?? false,
						recommendedAction,
						recommendedActionReasons,
						remediationActions:
							recommendedAction === 'investigate_regression'
								? [
										buildRegressionRemediationLabel(
											classification,
											candidate?.reasons
										)
									]
								: [...recommendedActionReasons],
						remediationSteps: recommendedActionReasons.map(
							(label) => ({
								kind:
									recommendedAction === 'renew_approval'
										? 'renew_approval'
										: recommendedAction === 'await_approval'
											? 'record_approval'
											: recommendedAction ===
												  'investigate_regression'
												? 'inspect_gate'
												: recommendedAction ===
													  'promote_candidate'
													? 'monitor_lane'
													: 'review_readiness',
								label:
									recommendedAction ===
									'investigate_regression'
										? buildRegressionRemediationLabel(
												classification,
												candidate?.reasons
											)
										: label,
								actions: buildRemediationStepActions({
									candidateRetrievalId:
										candidate?.candidateRetrievalId,
									groupKey: group.groupKey,
									sourceRunId: candidate?.sourceRunId,
									stepKind:
										recommendedAction === 'renew_approval'
											? 'renew_approval'
											: recommendedAction ===
												  'await_approval'
												? 'record_approval'
												: recommendedAction ===
													  'investigate_regression'
													? 'inspect_gate'
													: recommendedAction ===
														  'promote_candidate'
														? 'monitor_lane'
														: 'review_readiness',
									targetRolloutLabel
								})
							})
						),
						requiresApproval: candidate?.requiresApproval ?? false,
						requiresOverride: Boolean(
							candidate?.gateStatus &&
								candidate.gateStatus !== 'pass'
						),
						reviewStatus: candidate?.reviewStatus,
						sourceRunId: candidate?.sourceRunId,
						targetRolloutLabel
					});
				}
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		const releaseLaneHandoffs = (() => {
			const groupKeys = new Set<string>();
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groupKeys.add(baseline.groupKey);
			}
			for (const run of recentRetrievalComparisonRuns ?? []) {
				if (run.groupKey) groupKeys.add(run.groupKey);
			}
			const summaries: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseLaneHandoffs']
			> = [];
			for (const groupKey of groupKeys) {
				const sourceRolloutLabel = 'canary' as const;
				const targetRolloutLabel = 'stable' as const;
				const sourceBaseline = (activeRetrievalBaselines ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						(entry.rolloutLabel ?? undefined) === sourceRolloutLabel
				);
				const targetBaseline = (activeRetrievalBaselines ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						(entry.rolloutLabel ?? undefined) === targetRolloutLabel
				);
				const latestGroupRun = (
					recentRetrievalComparisonRuns ?? []
				).find((entry) => entry.groupKey === groupKey);
				const targetReadiness = latestGroupRun
					? (() => {
							const state = getPromotionCandidateState({
								decisions: recentRetrievalReleaseDecisions,
								now: Date.now(),
								targetRolloutLabel,
								run: latestGroupRun
							});
							return {
								baselineRetrievalId: state.baselineRetrievalId,
								candidateRetrievalId:
									state.candidateRetrievalId,
								effectiveBaselineGatePolicy:
									state.effectiveBaselineGatePolicy,
								effectiveReleasePolicy:
									state.effectiveReleasePolicy,
								gateStatus: state.gateStatus,
								ready: state.ready,
								reasons: state.reasons,
								requiresApproval: state.requiresApproval,
								requiresOverride: Boolean(
									state.gateStatus &&
										state.gateStatus !== 'pass'
								),
								sourceRunId: latestGroupRun.id,
								targetRolloutLabel
							};
						})()
					: undefined;
				const candidateRetrievalId =
					targetReadiness?.candidateRetrievalId ??
					latestGroupRun?.decisionSummary?.candidateRetrievalId ??
					latestGroupRun?.comparison.summary.bestByPassingRate;
				const sourcePolicy = getRetrievalReleasePolicy(
					groupKey,
					sourceRolloutLabel
				);
				const targetPolicy = getRetrievalReleasePolicy(
					groupKey,
					targetRolloutLabel
				);
				const sourceGatePolicy = getDefaultRetrievalBaselineGatePolicy(
					groupKey,
					sourceRolloutLabel
				);
				const targetGatePolicy = getDefaultRetrievalBaselineGatePolicy(
					groupKey,
					targetRolloutLabel
				);
				const reasons = [];
				if (!sourceBaseline) {
					reasons.push(
						'no active canary baseline exists for this group'
					);
				}
				if (!candidateRetrievalId) {
					reasons.push(
						'no stable-target promotion candidate is available'
					);
				}
				if (targetReadiness && targetReadiness.ready !== true) {
					reasons.push(...targetReadiness.reasons);
				}
				if (
					sourceBaseline &&
					candidateRetrievalId &&
					sourceBaseline.retrievalId !== candidateRetrievalId
				) {
					reasons.push(
						'stable handoff candidate does not match the active canary baseline retrieval'
					);
				}
				summaries.push({
					candidateRetrievalId:
						candidateRetrievalId ?? sourceBaseline?.retrievalId,
					groupKey,
					policyDelta: {
						approvalMaxAgeMsDelta:
							typeof targetPolicy.approvalMaxAgeMs === 'number' ||
							typeof sourcePolicy.approvalMaxAgeMs === 'number'
								? (targetPolicy.approvalMaxAgeMs ?? 0) -
									(sourcePolicy.approvalMaxAgeMs ?? 0)
								: undefined,
						gateSeverityChanged:
							(targetGatePolicy.severity ?? undefined) !==
							(sourceGatePolicy.severity ?? undefined),
						minAverageF1DeltaDelta:
							typeof targetGatePolicy.minAverageF1Delta ===
								'number' ||
							typeof sourceGatePolicy.minAverageF1Delta ===
								'number'
								? (targetGatePolicy.minAverageF1Delta ?? 0) -
									(sourceGatePolicy.minAverageF1Delta ?? 0)
								: undefined,
						minPassingRateDeltaDelta:
							typeof targetGatePolicy.minPassingRateDelta ===
								'number' ||
							typeof sourceGatePolicy.minPassingRateDelta ===
								'number'
								? (targetGatePolicy.minPassingRateDelta ?? 0) -
									(sourceGatePolicy.minPassingRateDelta ?? 0)
								: undefined,
						requireApprovalBeforePromotionChanged:
							Boolean(
								targetPolicy.requireApprovalBeforePromotion
							) !==
							Boolean(sourcePolicy.requireApprovalBeforePromotion)
					},
					readyForHandoff:
						Boolean(sourceBaseline) &&
						Boolean(candidateRetrievalId) &&
						targetReadiness?.ready === true &&
						(sourceBaseline?.retrievalId ?? undefined) ===
							(candidateRetrievalId ?? undefined),
					reasons,
					sourceActive: Boolean(sourceBaseline),
					sourceBaselineRetrievalId: sourceBaseline?.retrievalId,
					sourceRolloutLabel,
					targetActive: Boolean(targetBaseline),
					targetBaselineRetrievalId: targetBaseline?.retrievalId,
					targetReadiness,
					targetRolloutLabel
				});
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.sourceRolloutLabel}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.sourceRolloutLabel}:${right.targetRolloutLabel}`
				)
			);
		})();
		recentIncidents = filterScopedGovernanceEntries(
			await syncRetrievalReleaseIncidents({
				handoffDecisions: recentRetrievalLaneHandoffDecisions,
				handoffs: releaseLaneHandoffs,
				promotionCandidates
			})
		);
		releaseGroups = buildReleaseGroupsWithIncidentCounts(
			baseReleaseGroups,
			recentIncidents
		);
		incidentSummary = buildIncidentSummary(recentIncidents);
		const effectiveRecentRetrievalLaneHandoffIncidents =
			config.retrievalLaneHandoffIncidentStore
				? await loadRAGRetrievalLaneHandoffIncidents({
						limit: 10,
						store: config.retrievalLaneHandoffIncidentStore
					})
				: recentRetrievalLaneHandoffIncidents;
		const handoffFreshnessWindows = (releaseLaneHandoffs ?? []).map(
			(handoff) =>
				getLaneHandoffFreshnessWindow({
					decisions: recentRetrievalLaneHandoffDecisions,
					handoff
				})
		);
		const handoffAutoComplete = (releaseLaneHandoffs ?? []).map(
			(handoff) => {
				const policy = getRetrievalLaneHandoffAutoCompletePolicy(
					handoff.groupKey,
					handoff.targetRolloutLabel
				);
				const freshnessWindow = handoffFreshnessWindows.find(
					(entry) =>
						entry.groupKey === handoff.groupKey &&
						entry.sourceRolloutLabel ===
							handoff.sourceRolloutLabel &&
						entry.targetRolloutLabel === handoff.targetRolloutLabel
				);
				const reasons: string[] = [];
				if (policy.enabled !== true) {
					reasons.push(
						'auto-complete is not enabled for this handoff lane'
					);
				}
				if (handoff.readyForHandoff !== true) {
					reasons.push(
						...(handoff.reasons.length > 0
							? handoff.reasons
							: ['handoff is not ready for completion'])
					);
				}
				if (!freshnessWindow?.latestApprovedAt) {
					reasons.push(
						'approved handoff decision is required before auto-complete'
					);
				}
				if (
					typeof policy.maxApprovedDecisionAgeMs === 'number' &&
					typeof freshnessWindow?.approvalAgeMs === 'number' &&
					freshnessWindow.approvalAgeMs >
						policy.maxApprovedDecisionAgeMs
				) {
					reasons.push(
						'latest approved handoff decision is older than the auto-complete policy allows'
					);
				}
				const ready =
					policy.enabled === true &&
					handoff.readyForHandoff === true &&
					typeof freshnessWindow?.latestApprovedAt === 'number' &&
					!(
						typeof policy.maxApprovedDecisionAgeMs === 'number' &&
						typeof freshnessWindow.approvalAgeMs === 'number' &&
						freshnessWindow.approvalAgeMs >
							policy.maxApprovedDecisionAgeMs
					);
				return {
					approvalAgeMs: freshnessWindow?.approvalAgeMs,
					approvalExpiresAt:
						typeof freshnessWindow?.latestApprovedAt === 'number' &&
						typeof policy.maxApprovedDecisionAgeMs === 'number'
							? freshnessWindow.latestApprovedAt +
								policy.maxApprovedDecisionAgeMs
							: undefined,
					candidateRetrievalId: handoff.candidateRetrievalId,
					enabled: policy.enabled === true,
					freshnessStatus:
						freshnessWindow?.freshnessStatus ?? 'not_applicable',
					groupKey: handoff.groupKey,
					latestApprovedAt: freshnessWindow?.latestApprovedAt,
					maxApprovedDecisionAgeMs: policy.maxApprovedDecisionAgeMs,
					ready,
					reasons: [...new Set(reasons)],
					sourceRolloutLabel: handoff.sourceRolloutLabel,
					sourceRunId: handoff.targetReadiness?.sourceRunId,
					targetRolloutLabel: handoff.targetRolloutLabel
				};
			}
		);
		const handoffAutoCompleteSafety = handoffAutoComplete.map((entry) => ({
			approvalExpiresAt: entry.approvalExpiresAt,
			candidateRetrievalId: entry.candidateRetrievalId,
			enabled: entry.enabled,
			freshnessStatus: entry.freshnessStatus,
			groupKey: entry.groupKey,
			latestApprovedAt: entry.latestApprovedAt,
			reasons: entry.reasons,
			safe: entry.ready,
			sourceRunId: entry.sourceRunId,
			targetRolloutLabel: entry.targetRolloutLabel
		}));
		const handoffAutoCompletePolicies = [
			...Object.entries(
				config.retrievalLaneHandoffAutoCompletePoliciesByGroupAndTargetRolloutLabel ??
					{}
			).flatMap(([groupKey, rolloutPolicies]) =>
				Object.entries(rolloutPolicies ?? {}).flatMap(
					([rolloutLabel, policy]) =>
						rolloutLabel === 'canary' ||
						rolloutLabel === 'stable' ||
						rolloutLabel === 'rollback_target'
							? [
									{
										enabled: policy?.enabled === true,
										groupKey,
										maxApprovedDecisionAgeMs:
											policy?.maxApprovedDecisionAgeMs,
										scope: 'group_target_rollout_label' as const,
										targetRolloutLabel: rolloutLabel as
											| 'canary'
											| 'stable'
											| 'rollback_target'
									}
								]
							: []
				)
			)
		].sort((left, right) =>
			`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
				`${right.groupKey}:${right.targetRolloutLabel}`
			)
		);
		if (config.retrievalLaneHandoffAutoCompletePolicyHistoryStore) {
			for (const policy of handoffAutoCompletePolicies) {
				const latest = (
					recentHandoffAutoCompletePolicyHistory ?? []
				).find(
					(entry) =>
						entry.groupKey === policy.groupKey &&
						entry.targetRolloutLabel === policy.targetRolloutLabel
				);
				if (!latest) {
					await persistLaneHandoffAutoCompletePolicyHistoryRecord({
						changeKind: 'snapshot',
						corpusGroupKey: getComparisonCorpusGroupKey(
							policy.groupKey
						),
						enabled: policy.enabled,
						groupKey: policy.groupKey,
						maxApprovedDecisionAgeMs:
							policy.maxApprovedDecisionAgeMs,
						targetRolloutLabel: policy.targetRolloutLabel
					});
					continue;
				}
				if (
					latest.enabled !== policy.enabled ||
					latest.maxApprovedDecisionAgeMs !==
						policy.maxApprovedDecisionAgeMs
				) {
					await persistLaneHandoffAutoCompletePolicyHistoryRecord({
						changeKind: 'changed',
						corpusGroupKey: getComparisonCorpusGroupKey(
							policy.groupKey
						),
						enabled: policy.enabled,
						groupKey: policy.groupKey,
						maxApprovedDecisionAgeMs:
							policy.maxApprovedDecisionAgeMs,
						previousEnabled: latest.enabled,
						previousMaxApprovedDecisionAgeMs:
							latest.maxApprovedDecisionAgeMs,
						targetRolloutLabel: policy.targetRolloutLabel
					});
				}
			}
		}
		const effectiveRecentHandoffAutoCompletePolicyHistory =
			config.retrievalLaneHandoffAutoCompletePolicyHistoryStore
				? await loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory({
						limit: 10,
						store: config.retrievalLaneHandoffAutoCompletePolicyHistoryStore
					})
				: recentHandoffAutoCompletePolicyHistory;
		const releaseLaneIncidentSummaries = (() => {
			const groupKeys = new Set<string>();
			for (const run of recentRetrievalComparisonRuns ?? []) {
				if (run.groupKey) groupKeys.add(run.groupKey);
			}
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groupKeys.add(baseline.groupKey);
			}
			const summaries: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseLaneIncidentSummaries']
			> = [];
			for (const groupKey of groupKeys) {
				for (const targetRolloutLabel of [
					'canary',
					'stable',
					'rollback_target'
				] as const) {
					const laneIncidents = (recentIncidents ?? []).filter(
						(entry) =>
							entry.groupKey === groupKey &&
							(entry.targetRolloutLabel ?? undefined) ===
								targetRolloutLabel
					);
					const openIncidents = laneIncidents.filter(
						(entry) => entry.status === 'open'
					);
					const acknowledgedOpenCount = openIncidents.filter(
						(entry) => typeof entry.acknowledgedAt === 'number'
					).length;
					const latest = laneIncidents[0];
					summaries.push({
						acknowledgedOpenCount,
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						highestSeverity: laneIncidents.some(
							(entry) => entry.severity === 'critical'
						)
							? 'critical'
							: laneIncidents.some(
										(entry) => entry.severity === 'warning'
								  )
								? 'warning'
								: undefined,
						latestKind: latest?.kind,
						latestResolvedAt: laneIncidents
							.filter(
								(entry) => typeof entry.resolvedAt === 'number'
							)
							.map((entry) => entry.resolvedAt ?? 0)
							.sort((left, right) => right - left)[0],
						latestTriggeredAt: latest?.triggeredAt,
						openCount: openIncidents.length,
						resolvedCount: laneIncidents.filter(
							(entry) => entry.status === 'resolved'
						).length,
						targetRolloutLabel,
						unacknowledgedOpenCount:
							openIncidents.length - acknowledgedOpenCount
					});
				}
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		const releasePolicies = Object.entries(retrievalReleasePolicies ?? {})
			.map(([groupKey, policy]) => ({
				approvalMaxAgeMs: policy.approvalMaxAgeMs,
				groupKey,
				requireApprovalBeforePromotion:
					policy.requireApprovalBeforePromotion
			}))
			.sort((left, right) => left.groupKey.localeCompare(right.groupKey));
		const releaseLanePolicies = [
			...Object.entries(retrievalReleasePoliciesByRolloutLabel ?? {}).map(
				([rolloutLabel, policy]) => ({
					approvalMaxAgeMs: policy.approvalMaxAgeMs,
					requireApprovalBeforePromotion:
						policy.requireApprovalBeforePromotion,
					rolloutLabel: rolloutLabel as Exclude<
						RAGRetrievalBaselineRecord['rolloutLabel'],
						undefined
					>,
					scope: 'rollout_label' as const
				})
			),
			...Object.entries(
				retrievalReleasePoliciesByGroupAndRolloutLabel ?? {}
			).flatMap(([groupKey, policiesByRolloutLabel]) =>
				Object.entries(policiesByRolloutLabel ?? {}).map(
					([rolloutLabel, policy]) => ({
						approvalMaxAgeMs: policy?.approvalMaxAgeMs,
						groupKey,
						requireApprovalBeforePromotion:
							policy?.requireApprovalBeforePromotion,
						rolloutLabel: rolloutLabel as Exclude<
							RAGRetrievalBaselineRecord['rolloutLabel'],
							undefined
						>,
						scope: 'group_rollout_label' as const
					})
				)
			)
		].sort((left, right) =>
			`${'groupKey' in left ? (left.groupKey ?? '') : ''}:${left.rolloutLabel}`.localeCompare(
				`${'groupKey' in right ? (right.groupKey ?? '') : ''}:${right.rolloutLabel}`
			)
		);
		const releaseGatePolicies = [
			...Object.entries(
				retrievalBaselineGatePoliciesByRolloutLabel ?? {}
			).map(([rolloutLabel, policy]) => ({
				policy,
				rolloutLabel: rolloutLabel as Exclude<
					RAGRetrievalBaselineRecord['rolloutLabel'],
					undefined
				>,
				scope: 'rollout_label' as const
			})),
			...Object.entries(
				retrievalBaselineGatePoliciesByGroupAndRolloutLabel ?? {}
			).flatMap(([groupKey, policiesByRolloutLabel]) =>
				Object.entries(policiesByRolloutLabel ?? {}).map(
					([rolloutLabel, policy]) => ({
						groupKey,
						policy,
						rolloutLabel: rolloutLabel as Exclude<
							RAGRetrievalBaselineRecord['rolloutLabel'],
							undefined
						>,
						scope: 'group_rollout_label' as const
					})
				)
			)
		].sort((left, right) =>
			`${'groupKey' in left ? (left.groupKey ?? '') : ''}:${left.rolloutLabel}`.localeCompare(
				`${'groupKey' in right ? (right.groupKey ?? '') : ''}:${right.rolloutLabel}`
			)
		);
		if (config.retrievalReleaseLanePolicyHistoryStore) {
			for (const policy of releaseLanePolicies) {
				const groupKey =
					'groupKey' in policy ? policy.groupKey : undefined;
				const latest = (recentReleaseLanePolicyHistory ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						entry.rolloutLabel === policy.rolloutLabel &&
						entry.scope === policy.scope
				);
				if (!latest) {
					await persistReleaseLanePolicyHistoryRecord({
						approvalMaxAgeMs: policy.approvalMaxAgeMs,
						changeKind: 'snapshot',
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						requireApprovalBeforePromotion:
							policy.requireApprovalBeforePromotion,
						rolloutLabel: policy.rolloutLabel,
						scope: policy.scope
					});
					continue;
				}
				if (
					latest.approvalMaxAgeMs !== policy.approvalMaxAgeMs ||
					latest.requireApprovalBeforePromotion !==
						policy.requireApprovalBeforePromotion
				) {
					await persistReleaseLanePolicyHistoryRecord({
						approvalMaxAgeMs: policy.approvalMaxAgeMs,
						changeKind: 'changed',
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						previousApprovalMaxAgeMs: latest.approvalMaxAgeMs,
						previousRequireApprovalBeforePromotion:
							latest.requireApprovalBeforePromotion,
						requireApprovalBeforePromotion:
							policy.requireApprovalBeforePromotion,
						rolloutLabel: policy.rolloutLabel,
						scope: policy.scope
					});
				}
			}
		}
		if (config.retrievalBaselineGatePolicyHistoryStore) {
			for (const policy of releaseGatePolicies) {
				const groupKey =
					'groupKey' in policy ? policy.groupKey : undefined;
				const latest = (recentBaselineGatePolicyHistory ?? []).find(
					(entry) =>
						entry.groupKey === groupKey &&
						entry.rolloutLabel === policy.rolloutLabel &&
						entry.scope === policy.scope
				);
				const currentPolicy = JSON.stringify(policy.policy ?? {});
				const previousPolicy = JSON.stringify(latest?.policy ?? {});
				if (!latest) {
					await persistBaselineGatePolicyHistoryRecord({
						changeKind: 'snapshot',
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						policy: policy.policy,
						rolloutLabel: policy.rolloutLabel,
						scope: policy.scope
					});
					continue;
				}
				if (previousPolicy !== currentPolicy) {
					await persistBaselineGatePolicyHistoryRecord({
						changeKind: 'changed',
						corpusGroupKey: getComparisonCorpusGroupKey(groupKey),
						groupKey,
						policy: policy.policy,
						previousPolicy: latest.policy,
						rolloutLabel: policy.rolloutLabel,
						scope: policy.scope
					});
				}
			}
		}
		const effectiveRecentReleaseLanePolicyHistory =
			config.retrievalReleaseLanePolicyHistoryStore
				? await loadRAGRetrievalReleaseLanePolicyHistory({
						limit: 10,
						store: config.retrievalReleaseLanePolicyHistoryStore
					})
				: recentReleaseLanePolicyHistory;
		const effectiveRecentBaselineGatePolicyHistory =
			config.retrievalBaselineGatePolicyHistoryStore
				? await loadRAGRetrievalBaselineGatePolicyHistory({
						limit: 10,
						store: config.retrievalBaselineGatePolicyHistoryStore
					})
				: recentBaselineGatePolicyHistory;
		const releaseLaneEscalationPolicies = (() => {
			const groupKeys = new Set<string>();
			for (const run of recentRetrievalComparisonRuns ?? []) {
				if (run.groupKey) groupKeys.add(run.groupKey);
			}
			for (const baseline of activeRetrievalBaselines ?? []) {
				if (baseline.groupKey) groupKeys.add(baseline.groupKey);
			}
			const summaries: NonNullable<
				NonNullable<
					RAGOperationsResponse['retrievalComparisons']
				>['releaseLaneEscalationPolicies']
			> = [];
			for (const groupKey of groupKeys) {
				for (const targetRolloutLabel of [
					'canary',
					'stable',
					'rollback_target'
				] as const) {
					const severity =
						getRetrievalReleaseIncidentSeverity(targetRolloutLabel);
					summaries.push({
						approvalExpiredSeverity: severity,
						gateFailureSeverity: severity,
						groupKey,
						openIncidentSeverity: severity,
						regressionSeverity: severity,
						targetRolloutLabel
					});
				}
			}
			return summaries.sort((left, right) =>
				`${left.groupKey}:${left.targetRolloutLabel}`.localeCompare(
					`${right.groupKey}:${right.targetRolloutLabel}`
				)
			);
		})();
		if (config.retrievalReleaseLaneEscalationPolicyHistoryStore) {
			for (const policy of releaseLaneEscalationPolicies) {
				const latest = (
					recentReleaseLaneEscalationPolicyHistory ?? []
				).find(
					(entry) =>
						entry.groupKey === policy.groupKey &&
						entry.targetRolloutLabel === policy.targetRolloutLabel
				);
				if (!latest) {
					await persistReleaseLaneEscalationPolicyHistoryRecord({
						approvalExpiredSeverity: policy.approvalExpiredSeverity,
						changeKind: 'snapshot',
						corpusGroupKey: getComparisonCorpusGroupKey(
							policy.groupKey
						),
						gateFailureSeverity: policy.gateFailureSeverity,
						groupKey: policy.groupKey,
						openIncidentSeverity: policy.openIncidentSeverity,
						regressionSeverity: policy.regressionSeverity,
						targetRolloutLabel: policy.targetRolloutLabel
					});
					continue;
				}
				if (
					latest.openIncidentSeverity !==
						policy.openIncidentSeverity ||
					latest.regressionSeverity !== policy.regressionSeverity ||
					latest.gateFailureSeverity !== policy.gateFailureSeverity ||
					latest.approvalExpiredSeverity !==
						policy.approvalExpiredSeverity
				) {
					await persistReleaseLaneEscalationPolicyHistoryRecord({
						approvalExpiredSeverity: policy.approvalExpiredSeverity,
						changeKind: 'changed',
						corpusGroupKey: getComparisonCorpusGroupKey(
							policy.groupKey
						),
						gateFailureSeverity: policy.gateFailureSeverity,
						groupKey: policy.groupKey,
						openIncidentSeverity: policy.openIncidentSeverity,
						previousApprovalExpiredSeverity:
							latest.approvalExpiredSeverity,
						previousGateFailureSeverity: latest.gateFailureSeverity,
						previousOpenIncidentSeverity:
							latest.openIncidentSeverity,
						previousRegressionSeverity: latest.regressionSeverity,
						regressionSeverity: policy.regressionSeverity,
						targetRolloutLabel: policy.targetRolloutLabel
					});
				}
			}
		}
		const effectiveRecentReleaseLaneEscalationPolicyHistory =
			config.retrievalReleaseLaneEscalationPolicyHistoryStore
				? await loadRAGRetrievalReleaseLaneEscalationPolicyHistory({
						limit: 10,
						store: config.retrievalReleaseLaneEscalationPolicyHistoryStore
					})
				: recentReleaseLaneEscalationPolicyHistory;
		const stableWinnerByPassingRate = (() => {
			const counts = new Map<
				string,
				{ latestFinishedAt: number; runCount: number }
			>();
			for (const run of recentRetrievalComparisonRuns ?? []) {
				const winnerId = run.comparison.summary.bestByPassingRate;
				if (!winnerId) {
					continue;
				}
				const current = counts.get(winnerId);
				if (current) {
					current.runCount += 1;
					current.latestFinishedAt = Math.max(
						current.latestFinishedAt,
						run.finishedAt
					);
					continue;
				}
				counts.set(winnerId, {
					latestFinishedAt: run.finishedAt,
					runCount: 1
				});
			}
			return [...counts.entries()]
				.sort((left, right) => {
					if (right[1].runCount !== left[1].runCount) {
						return right[1].runCount - left[1].runCount;
					}
					return right[1].latestFinishedAt - left[1].latestFinishedAt;
				})
				.map(([retrievalId, summary]) => ({
					latestFinishedAt: summary.latestFinishedAt,
					retrievalId,
					runCount: summary.runCount
				}))[0];
		})();
		const retrievalComparisonAlerts = (() => {
			const alerts: NonNullable<
				RAGOperationsResponse['retrievalComparisons']
			>['alerts'] = [];
			if (!latestRetrievalComparisonRun) {
				return alerts;
			}

			const classifyRetrievalRegression = (input: {
				reasons?: string[];
				delta?: RAGRetrievalComparisonDecisionDelta;
			}): 'general' | 'multivector' | 'runtime' | 'evidence' | 'cue' =>
				classifyGovernanceReasons([
					...(input.reasons ?? []),
					...((input.delta?.multiVectorCollapsedCasesDelta ?? 0) < 0
						? [
								`multivector collapsed delta ${input.delta?.multiVectorCollapsedCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.multiVectorLexicalHitCasesDelta ?? 0) < 0
						? [
								`multivector lexical-hit delta ${input.delta?.multiVectorLexicalHitCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.multiVectorVectorHitCasesDelta ?? 0) < 0
						? [
								`multivector vector-hit delta ${input.delta?.multiVectorVectorHitCasesDelta ?? 0}`
							]
						: []),
					...((input.delta
						?.runtimeCandidateBudgetExhaustedCasesDelta ?? 0) > 0
						? [
								`runtime candidate-budget-exhausted delta ${input.delta?.runtimeCandidateBudgetExhaustedCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.runtimeUnderfilledTopKCasesDelta ?? 0) > 0
						? [
								`runtime underfilled-topk delta ${input.delta?.runtimeUnderfilledTopKCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.evidenceReconcileCasesDelta ?? 0) < 0
						? [
								`evidence reconcile delta ${input.delta?.evidenceReconcileCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.presentationTitleCueCasesDelta ?? 0) < 0
						? [
								`presentation title cue delta ${input.delta?.presentationTitleCueCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.presentationBodyCueCasesDelta ?? 0) < 0
						? [
								`presentation body cue delta ${input.delta?.presentationBodyCueCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.presentationNotesCueCasesDelta ?? 0) < 0
						? [
								`presentation notes cue delta ${input.delta?.presentationNotesCueCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.spreadsheetSheetCueCasesDelta ?? 0) < 0
						? [
								`spreadsheet sheet cue delta ${input.delta?.spreadsheetSheetCueCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.spreadsheetTableCueCasesDelta ?? 0) < 0
						? [
								`spreadsheet table cue delta ${input.delta?.spreadsheetTableCueCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.spreadsheetColumnCueCasesDelta ?? 0) < 0
						? [
								`spreadsheet column cue delta ${input.delta?.spreadsheetColumnCueCasesDelta ?? 0}`
							]
						: []),
					...((input.delta
						?.officeParagraphEvidenceReconcileCasesDelta ?? 0) < 0
						? [
								`office narrative evidence reconcile delta ${input.delta?.officeParagraphEvidenceReconcileCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.officeListEvidenceReconcileCasesDelta ??
						0) < 0
						? [
								`office checklist evidence reconcile delta ${input.delta?.officeListEvidenceReconcileCasesDelta ?? 0}`
							]
						: []),
					...((input.delta?.officeTableEvidenceReconcileCasesDelta ??
						0) < 0
						? [
								`office table evidence reconcile delta ${input.delta?.officeTableEvidenceReconcileCasesDelta ?? 0}`
							]
						: [])
				]);

			const latestWinner =
				latestRetrievalComparisonRun.comparison.summary
					.bestByPassingRate;
			if (
				latestWinner &&
				stableWinnerByPassingRate?.retrievalId &&
				stableWinnerByPassingRate.retrievalId !== latestWinner
			) {
				alerts.push({
					corpusGroupKey: latestRetrievalComparisonRun.corpusGroupKey,
					groupKey: latestRetrievalComparisonRun.groupKey,
					kind: 'stable_winner_changed',
					latestRunId: latestRetrievalComparisonRun.id,
					message: `Latest retrieval winner changed from ${stableWinnerByPassingRate.retrievalId} to ${latestWinner}.`,
					retrievalId: latestWinner,
					severity: 'warning',
					tag: latestRetrievalComparisonRun.tags?.[0]
				});
			}

			const delta = latestRetrievalComparisonRun.decisionSummary?.delta;
			const gate = latestRetrievalComparisonRun.decisionSummary?.gate;
			if (
				delta &&
				(delta.passingRateDelta < 0 || delta.averageF1Delta < 0)
			) {
				alerts.push({
					baselineRetrievalId:
						latestRetrievalComparisonRun.decisionSummary
							?.baselineRetrievalId,
					candidateRetrievalId:
						latestRetrievalComparisonRun.decisionSummary
							?.candidateRetrievalId,
					delta,
					corpusGroupKey: latestRetrievalComparisonRun.corpusGroupKey,
					groupKey: latestRetrievalComparisonRun.groupKey,
					kind: 'baseline_regression',
					latestRunId: latestRetrievalComparisonRun.id,
					message:
						'Candidate retrieval regressed against the baseline on the latest persisted comparison run.',
					classification: classifyRetrievalRegression({ delta }),
					severity: 'warning',
					tag: latestRetrievalComparisonRun.tags?.[0]
				});
			}
			if (gate && gate.status !== 'pass') {
				const gateReasonText =
					gate.reasons.length > 0
						? ` ${gate.reasons.join('; ')}`
						: '';
				alerts.push({
					baselineRetrievalId:
						latestRetrievalComparisonRun.decisionSummary
							?.baselineRetrievalId,
					candidateRetrievalId:
						latestRetrievalComparisonRun.decisionSummary
							?.candidateRetrievalId,
					delta,
					gate,
					corpusGroupKey: latestRetrievalComparisonRun.corpusGroupKey,
					groupKey: latestRetrievalComparisonRun.groupKey,
					kind: 'baseline_gate_failed',
					latestRunId: latestRetrievalComparisonRun.id,
					message:
						gate.status === 'warn'
							? `Candidate retrieval triggered a baseline gate warning.${gateReasonText}`
							: `Candidate retrieval failed the active baseline gate.${gateReasonText}`,
					classification: classifyRetrievalRegression({
						delta,
						reasons: gate.reasons
					}),
					severity: gate.status === 'warn' ? 'warning' : 'warning',
					tag: latestRetrievalComparisonRun.tags?.[0]
				});
			}
			for (const entry of handoffAutoComplete) {
				if (entry.enabled !== true || entry.ready === true) {
					continue;
				}
				const reasonSet = new Set(entry.reasons);
				const reasonText = entry.reasons.join(' ');
				const kind = reasonSet.has(
					'no active canary baseline exists for this group'
				)
					? 'handoff_auto_complete_source_lane_missing'
					: reasonSet.has(
								'latest approved handoff decision is older than the auto-complete policy allows'
						  )
						? 'handoff_auto_complete_stale_approval'
						: reasonSet.has(
									'approved handoff decision is required before auto-complete'
							  )
							? 'handoff_auto_complete_approval_missing'
							: reasonText.includes('gate') ||
								  reasonText.includes('passing rate delta') ||
								  reasonText.includes('average') ||
								  reasonText.includes(
										'candidate does not match'
								  )
								? 'handoff_auto_complete_gate_blocked'
								: 'handoff_auto_complete_policy_drift';
				alerts.push({
					candidateRetrievalId: entry.candidateRetrievalId,
					corpusGroupKey: getComparisonCorpusGroupKey(entry.groupKey),
					groupKey: entry.groupKey,
					kind,
					latestRunId:
						entry.sourceRunId ?? latestRetrievalComparisonRun.id,
					message:
						kind === 'handoff_auto_complete_source_lane_missing'
							? `Auto-complete is enabled for ${entry.groupKey}:${entry.targetRolloutLabel} but no active source lane baseline exists.`
							: kind === 'handoff_auto_complete_stale_approval'
								? `Auto-complete is enabled for ${entry.groupKey}:${entry.targetRolloutLabel} but the latest handoff approval is stale.`
								: kind ===
									  'handoff_auto_complete_approval_missing'
									? `Auto-complete is enabled for ${entry.groupKey}:${entry.targetRolloutLabel} but no approved handoff decision exists yet.`
									: kind ===
										  'handoff_auto_complete_gate_blocked'
										? `Auto-complete is enabled for ${entry.groupKey}:${entry.targetRolloutLabel} but the handoff is blocked by lane readiness or gate state.`
										: `Auto-complete is enabled for ${entry.groupKey}:${entry.targetRolloutLabel} but the latest handoff is not safe to auto-complete.`,
					retrievalId: entry.candidateRetrievalId,
					severity: 'warning'
				});
			}

			return alerts;
		})();
		const handoffDriftRollups = (() => {
			const remediationHintsByKind = {
				handoff_auto_complete_approval_missing: [
					'Approve the lane handoff before relying on auto-complete.',
					'Confirm the candidate run and target lane still match the intended promotion path.'
				],
				handoff_auto_complete_gate_blocked: [
					'Inspect the latest target-lane readiness and gate delta before promotion.',
					'Run a fresh comparison if the current candidate or baseline changed.'
				],
				handoff_auto_complete_policy_drift: [
					'Review the lane auto-complete policy against current release behavior.',
					'Confirm the configured source lane and target lane still represent the intended rollout path.'
				],
				handoff_auto_complete_source_lane_missing: [
					'Restore or promote the required source-lane baseline before using auto-complete.',
					'Check whether the lane handoff should still originate from canary for this group.'
				],
				handoff_auto_complete_stale_approval: [
					'Renew the handoff approval so it falls within the configured freshness window.',
					'Re-verify candidate readiness before allowing auto-complete again.'
				]
			} as const;
			const rollups = new Map<
				string,
				NonNullable<
					NonNullable<
						RAGOperationsResponse['retrievalComparisons']
					>['handoffDriftRollups']
				>[number]
			>();
			for (const alert of retrievalComparisonAlerts) {
				if (
					alert.kind === 'stable_winner_changed' ||
					alert.kind === 'baseline_regression' ||
					alert.kind === 'baseline_gate_failed' ||
					!alert.groupKey
				) {
					continue;
				}
				const targetRolloutLabel = handoffAutoComplete.find(
					(entry) =>
						entry.groupKey === alert.groupKey &&
						entry.candidateRetrievalId ===
							alert.candidateRetrievalId
				)?.targetRolloutLabel;
				if (!targetRolloutLabel) {
					continue;
				}
				const key = `${alert.kind}:${targetRolloutLabel}`;
				const current = rollups.get(key);
				if (current) {
					current.count += 1;
					if (!current.groupKeys.includes(alert.groupKey)) {
						current.groupKeys.push(alert.groupKey);
						current.groupKeys.sort((left, right) =>
							left.localeCompare(right)
						);
					}
					continue;
				}
				rollups.set(key, {
					count: 1,
					groupKeys: [alert.groupKey],
					kind: alert.kind,
					remediationHints: [...remediationHintsByKind[alert.kind]],
					remediationSteps: remediationHintsByKind[alert.kind].map(
						(label) => ({
							kind:
								alert.kind ===
								'handoff_auto_complete_stale_approval'
									? 'renew_approval'
									: alert.kind ===
										  'handoff_auto_complete_source_lane_missing'
										? 'restore_source_lane'
										: alert.kind ===
											  'handoff_auto_complete_gate_blocked'
											? 'inspect_gate'
											: alert.kind ===
												  'handoff_auto_complete_approval_missing'
												? 'record_approval'
												: 'review_readiness',
							label,
							actions: buildRemediationStepActions({
								groupKey: alert.groupKey,
								stepKind:
									alert.kind ===
									'handoff_auto_complete_stale_approval'
										? 'renew_approval'
										: alert.kind ===
											  'handoff_auto_complete_source_lane_missing'
											? 'restore_source_lane'
											: alert.kind ===
												  'handoff_auto_complete_gate_blocked'
												? 'inspect_gate'
												: alert.kind ===
													  'handoff_auto_complete_approval_missing'
													? 'record_approval'
													: 'review_readiness',
								targetRolloutLabel
							})
						})
					),
					severity: 'warning',
					targetRolloutLabel
				});
			}
			return [...rollups.values()].sort((left, right) =>
				`${left.targetRolloutLabel}:${left.kind}`.localeCompare(
					`${right.targetRolloutLabel}:${right.kind}`
				)
			);
		})();
		const handoffDriftCountsByLane = (() => {
			const kinds = [
				'handoff_auto_complete_policy_drift',
				'handoff_auto_complete_stale_approval',
				'handoff_auto_complete_source_lane_missing',
				'handoff_auto_complete_gate_blocked',
				'handoff_auto_complete_approval_missing'
			] as const;
			const counts = new Map<
				string,
				NonNullable<
					NonNullable<
						RAGOperationsResponse['retrievalComparisons']
					>['handoffDriftCountsByLane']
				>[number]
			>();
			for (const rollup of handoffDriftRollups) {
				const current = counts.get(rollup.targetRolloutLabel) ?? {
					countsByKind: Object.fromEntries(
						kinds.map((kind) => [kind, 0])
					) as Record<(typeof kinds)[number], number>,
					targetRolloutLabel: rollup.targetRolloutLabel,
					totalCount: 0
				};
				current.countsByKind[rollup.kind] =
					(current.countsByKind[rollup.kind] ?? 0) + rollup.count;
				current.totalCount += rollup.count;
				counts.set(rollup.targetRolloutLabel, current);
			}
			return [...counts.values()].sort((left, right) =>
				left.targetRolloutLabel.localeCompare(right.targetRolloutLabel)
			);
		})();
		searchTraceRuntime.stats = traceStats;
		searchTraceRuntime.recentRuns = recentTraceRuns;

		const admin = await buildAdminCapabilities(request);
		const adminActionHistory = [...adminActions];
		const adminJobHistory = [...adminJobs, ...syncJobs].sort(
			(left, right) => right.startedAt - left.startedAt
		);
		const status = collection?.getStatus?.();

		return {
			admin,
			adminActions: adminActionHistory,
			adminJobs: adminJobHistory,
			capabilities: collection?.getCapabilities?.(),
			documents: indexManager
				? summarizeDocuments(indexedDocuments)
				: undefined,
			health: await summarizeHealth(indexedDocuments),
			ingestJobs: [...ingestJobs],
			maintenance: buildBackendMaintenanceSummary({
				admin,
				adminActions: adminActionHistory,
				adminJobs: adminJobHistory,
				status
			}),
			ok: true,
			readiness: buildReadiness(),
			retrievalComparisons: {
				adaptiveNativePlannerBenchmark,
				nativeBackendComparisonBenchmark,
				presentationCueBenchmark,
				spreadsheetCueBenchmark,
				configured: Boolean(retrievalComparisonHistoryStore),
				latest: latestRetrievalComparisonRun
					? {
							bestByAverageF1:
								latestRetrievalComparisonRun.comparison.summary
									.bestByAverageF1,
							bestByPresentationTitleCueCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByPresentationTitleCueCases,
							bestByPresentationBodyCueCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByPresentationBodyCueCases,
							bestByPresentationNotesCueCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByPresentationNotesCueCases,
							bestBySpreadsheetSheetCueCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestBySpreadsheetSheetCueCases,
							bestBySpreadsheetTableCueCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestBySpreadsheetTableCueCases,
							bestBySpreadsheetColumnCueCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestBySpreadsheetColumnCueCases,
							bestByMultivectorCollapsedCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByMultivectorCollapsedCases,
							bestByMultivectorLexicalHitCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByMultivectorLexicalHitCases,
							bestByMultivectorVectorHitCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByMultivectorVectorHitCases,
							bestByEvidenceReconcileCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByEvidenceReconcileCases,
							bestByOfficeEvidenceReconcileCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByOfficeEvidenceReconcileCases,
							bestByOfficeParagraphEvidenceReconcileCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByOfficeParagraphEvidenceReconcileCases,
							bestByOfficeListEvidenceReconcileCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByOfficeListEvidenceReconcileCases,
							bestByOfficeTableEvidenceReconcileCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByOfficeTableEvidenceReconcileCases,
							bestByPDFEvidenceReconcileCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByPDFEvidenceReconcileCases,
							bestByLowestRuntimeCandidateBudgetExhaustedCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByLowestRuntimeCandidateBudgetExhaustedCases,
							bestByLowestRuntimeUnderfilledTopKCases:
								latestRetrievalComparisonRun.comparison.summary
									.bestByLowestRuntimeUnderfilledTopKCases,
							bestByPassingRate:
								latestRetrievalComparisonRun.comparison.summary
									.bestByPassingRate,
							corpusGroupKey:
								latestRetrievalComparisonRun.corpusGroupKey,
							elapsedMs: latestRetrievalComparisonRun.elapsedMs,
							fastest:
								latestRetrievalComparisonRun.comparison.summary
									.fastest,
							finishedAt: latestRetrievalComparisonRun.finishedAt,
							groupKey: latestRetrievalComparisonRun.groupKey,
							id: latestRetrievalComparisonRun.id,
							label: latestRetrievalComparisonRun.label,
							decisionSummary:
								latestRetrievalComparisonRun.decisionSummary,
							releaseVerdict:
								latestRetrievalComparisonRun.releaseVerdict,
							suiteId: latestRetrievalComparisonRun.suiteId,
							suiteLabel: latestRetrievalComparisonRun.suiteLabel,
							tags: latestRetrievalComparisonRun.tags
						}
					: undefined,
				alerts: retrievalComparisonAlerts,
				activeBaselines: activeRetrievalBaselines,
				baselineHistory: retrievalBaselineHistory,
				latestRejectedCandidate,
				promotionCandidates,
				recentIncidents,
				recentIncidentRemediationDecisions,
				recentIncidentRemediationExecutions:
					recentIncidentRemediationExecutions?.slice(0, 10),
				incidentRemediationExecutionSummary,
				recentDecisions: enrichedRecentRetrievalReleaseDecisions,
				readyToPromote: latestPromotionReadiness,
				readyToPromoteByLane: latestPromotionReadinessByLane,
				releaseGroups,
				incidentSummary,
				releasePolicies,
				releaseLanePolicies,
				releaseGatePolicies,
				releaseTimelines,
				releaseLaneTimelines,
				releaseLaneDecisions,
				approvalScopes,
				releaseLaneEscalationPolicies,
				releaseLaneAudits,
				releaseLaneRecommendations,
				releaseLaneIncidentSummaries,
				releaseLaneHandoffs,
				handoffAutoComplete,
				handoffAutoCompletePolicies,
				handoffAutoCompleteSafety,
				handoffDriftRollups,
				handoffDriftCountsByLane,
				recentHandoffAutoCompletePolicyHistory:
					effectiveRecentHandoffAutoCompletePolicyHistory,
				recentReleaseLanePolicyHistory:
					effectiveRecentReleaseLanePolicyHistory,
				recentBaselineGatePolicyHistory:
					effectiveRecentBaselineGatePolicyHistory,
				recentReleaseLaneEscalationPolicyHistory:
					effectiveRecentReleaseLaneEscalationPolicyHistory,
				handoffFreshnessWindows,
				recentLaneHandoffIncidentHistory:
					recentRetrievalLaneHandoffIncidentHistory,
				recentLaneHandoffDecisions: recentRetrievalLaneHandoffDecisions,
				recentLaneHandoffIncidents:
					effectiveRecentRetrievalLaneHandoffIncidents,
				recentRuns: recentRetrievalComparisonRuns,
				stableWinnerByPassingRate,
				relatedPruneRun: recentTraceRuns?.[0],
				relatedSearchTraces: traceStats
			},
			searchTraces: {
				...searchTraceRuntime,
				configured: Boolean(searchTraceStore),
				retention: searchTraceRetention,
				schedule: searchTraceRetentionSchedule,
				recentRuns: recentTraceRuns,
				stats: traceStats
			},
			status,
			syncSources: await buildSyncSources(accessScope)
		};
	};

	const handleStatus = async (request?: Request) =>
		buildOperationsPayload(request);
	const handleRetrievalReleaseStatus = async (request?: Request) => {
		const result = await buildOperationsPayload(request);
		return {
			ok: true as const,
			retrievalComparisons: result.retrievalComparisons
		};
	};
	const handleRetrievalReleaseDriftStatus = async (request?: Request) => {
		const result = await buildOperationsPayload(request);
		return {
			handoffDriftCountsByLane:
				result.retrievalComparisons?.handoffDriftCountsByLane,
			handoffDriftRollups:
				result.retrievalComparisons?.handoffDriftRollups,
			ok: true as const
		};
	};
	const handleRetrievalLaneHandoffIncidentStatus = async (
		request?: Request
	): Promise<RAGRetrievalLaneHandoffIncidentStatusResponse> => {
		const result = await buildOperationsPayload(request);
		const incidents =
			result.retrievalComparisons?.recentLaneHandoffIncidents;
		return {
			freshnessWindows:
				result.retrievalComparisons?.handoffFreshnessWindows,
			incidentSummary: summarizeRetrievalLaneHandoffIncidents(incidents),
			incidents,
			recentHistory:
				result.retrievalComparisons?.recentLaneHandoffIncidentHistory,
			ok: true as const
		};
	};
	const handleRetrievalLaneHandoffStatus = async (request?: Request) => {
		const result = await buildOperationsPayload(request);
		const incidents =
			result.retrievalComparisons?.recentLaneHandoffIncidents;
		return {
			autoComplete: result.retrievalComparisons?.handoffAutoComplete,
			decisions: result.retrievalComparisons?.recentLaneHandoffDecisions,
			freshnessWindows:
				result.retrievalComparisons?.handoffFreshnessWindows,
			handoffs: result.retrievalComparisons?.releaseLaneHandoffs,
			incidentSummary: summarizeRetrievalLaneHandoffIncidents(incidents),
			incidents,
			recentHistory:
				result.retrievalComparisons?.recentLaneHandoffIncidentHistory,
			ok: true as const
		};
	};

	const handleOps = async (request?: Request) =>
		buildOperationsPayload(request);

	if (
		searchTraceStore &&
		searchTraceRetention &&
		searchTraceRetentionSchedule
	) {
		const runScheduledSearchTracePrune = async () => {
			searchTraceRuntime.nextScheduledAt =
				Date.now() + searchTraceRetentionSchedule.intervalMs;
			try {
				await runSearchTracePrune(searchTraceRetention, 'schedule');
			} catch {
				// runtime state is updated inside runSearchTracePrune
			}
		};

		if (searchTraceRetentionSchedule.runImmediately) {
			void runScheduledSearchTracePrune();
		} else {
			searchTraceRuntime.nextScheduledAt =
				Date.now() + searchTraceRetentionSchedule.intervalMs;
		}

		const timer = setInterval(() => {
			void runScheduledSearchTracePrune();
		}, searchTraceRetentionSchedule.intervalMs);
		timer.unref?.();
	}

	const handleDocuments = async (
		kind?: string,
		request?: Request
	): Promise<RAGDocumentsResponse | { ok: false; error: string }> => {
		if (!indexManager) {
			return {
				error: 'RAG index document management is not configured',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		const documents = (await indexManager.listDocuments({ kind })).filter(
			(document) =>
				matchesAccessScope(accessScope, {
					corpusKey: document.corpusKey,
					documentId: document.id,
					metadata: document.metadata,
					source: document.source
				})
		);

		return {
			documents: documents.map((document) => ({
				...document,
				labels: buildRAGSourceLabels({
					metadata: document.metadata,
					source: document.source,
					title: document.title
				})
			})),
			ok: true
		};
	};

	const handleCreateDocument = async (body: unknown, request?: Request) => {
		if (!indexManager?.createDocument) {
			return {
				error: 'RAG document creation is not configured',
				ok: false
			};
		}

		if (!isObjectRecord(body)) {
			return {
				error: 'Invalid payload',
				ok: false
			};
		}

		if (!isRAGDocument(body)) {
			return {
				error: 'Invalid payload',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (
			!matchesAccessScope(accessScope, {
				documentId: body.id,
				corpusKey: body.corpusKey,
				metadata: body.metadata,
				source: body.source
			})
		) {
			return {
				error: 'Document is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob('create_document', body.id);

		try {
			const result = await indexManager.createDocument(body);
			const action = createAdminAction('create_document', body.id);
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('create_document', body.id);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleDocumentChunks = async (
		id: string,
		request?: Request
	): Promise<RAGDocumentChunksResponse> => {
		if (!indexManager) {
			return {
				error: 'RAG chunk preview is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'document id is required',
				ok: false
			};
		}

		const preview = await indexManager.getDocumentChunks(id);

		if (!preview) {
			return {
				error: 'document not found',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (
			!matchesAccessScope(accessScope, {
				documentId: preview.document.id,
				corpusKey: preview.document.corpusKey,
				metadata: preview.document.metadata,
				source: preview.document.source
			})
		) {
			return {
				error: 'document not found',
				ok: false
			};
		}

		const chunks = preview.chunks.map((chunk) => ({
			...chunk,
			labels: buildRAGSourceLabels({
				metadata: chunk.metadata,
				source: chunk.source ?? preview.document.source,
				title: chunk.title ?? preview.document.title
			}),
			structure: buildRAGChunkStructure(chunk.metadata)
		}));

		return {
			ok: true,
			...preview,
			document: {
				...preview.document,
				labels: buildRAGSourceLabels({
					metadata: preview.document.metadata,
					source: preview.document.source,
					title: preview.document.title
				})
			},
			chunks: chunks.map((chunk) => {
				const excerpts = buildRAGChunkExcerpts(chunks, chunk.chunkId);
				return {
					...chunk,
					excerpts,
					excerptSelection: buildRAGExcerptSelection(
						excerpts,
						chunk.structure
					)
				};
			})
		};
	};

	const handleDeleteDocument = async (
		id: string,
		request?: Request
	): Promise<RAGMutationResponse> => {
		if (!indexManager?.deleteDocument) {
			return {
				error: 'RAG document deletion is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'document id is required',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (
			accessScope &&
			!matchesAccessScope(accessScope, { documentId: id })
		) {
			return {
				error: 'Document is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob('delete_document', id);
		const deleted = await indexManager.deleteDocument(id);

		if (!deleted) {
			failAdminJob(job, 'document not found');
			const action = createAdminAction('delete_document', id);
			failAdminAction(action, 'document not found');

			return {
				error: 'document not found',
				ok: false
			};
		}

		const action = createAdminAction('delete_document', id);
		completeAdminJob(job);
		completeAdminAction(action);

		return {
			deleted: id,
			ok: true
		};
	};

	const handleReindexDocument = async (
		id: string,
		request?: Request
	): Promise<RAGMutationResponse> => {
		if (!indexManager?.reindexDocument) {
			return {
				error: 'RAG document reindex is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'document id is required',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (
			accessScope &&
			!matchesAccessScope(accessScope, { documentId: id })
		) {
			return {
				error: 'Document is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob('reindex_document', id);

		try {
			const result = {
				ok: true,
				reindexed: id,
				...(await indexManager.reindexDocument(id))
			};
			const action = createAdminAction('reindex_document', id);
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reindex_document', id);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleReindexSource = async (
		source: string,
		request?: Request
	): Promise<RAGMutationResponse> => {
		if (!indexManager?.reindexSource) {
			return {
				error: 'RAG source reindex is not configured',
				ok: false
			};
		}

		if (!source) {
			return {
				error: 'source is required',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (
			!matchesAccessScope(accessScope, {
				source
			})
		) {
			return {
				error: 'Source is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob('reindex_source', source);

		try {
			const result = {
				ok: true,
				reindexed: source,
				...(await indexManager.reindexSource(source))
			};
			const action = createAdminAction('reindex_source');
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reindex_source');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleReseed = async (): Promise<RAGMutationResponse> => {
		if (!indexManager?.reseed) {
			return {
				error: 'RAG reseed is not configured',
				ok: false
			};
		}

		const job = createAdminJob('reseed');

		try {
			const result = {
				ok: true,
				...(await indexManager.reseed())
			};
			const action = createAdminAction('reseed');
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reseed');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleReset = async (): Promise<RAGMutationResponse> => {
		if (!indexManager?.reset) {
			return {
				error: 'RAG reset is not configured',
				ok: false
			};
		}

		const job = createAdminJob('reset');

		try {
			const result = {
				ok: true,
				...(await indexManager.reset())
			};
			const action = createAdminAction('reset');
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reset');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleAnalyzeBackend = async (): Promise<RAGMutationResponse> => {
		if (!ragStore?.analyze) {
			return {
				error: 'RAG backend analyze is not configured',
				ok: false
			};
		}

		const job = createAdminJob('analyze_backend');

		try {
			await ragStore.analyze();
			const action = createAdminAction('analyze_backend');
			completeAdminJob(job);
			completeAdminAction(action);

			return {
				ok: true,
				status: 'backend analyze completed successfully'
			};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('analyze_backend');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleRebuildNativeIndex = async (): Promise<RAGMutationResponse> => {
		if (!ragStore?.rebuildNativeIndex) {
			return {
				error: 'RAG native index rebuild is not configured',
				ok: false
			};
		}

		const job = createAdminJob('rebuild_native_index');

		try {
			await ragStore.rebuildNativeIndex();
			const action = createAdminAction('rebuild_native_index');
			completeAdminJob(job);
			completeAdminAction(action);

			return {
				ok: true,
				status: 'native index rebuild completed successfully'
			};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('rebuild_native_index');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const renderMaintenanceMutationHTMXResponse = async (
		request: Request,
		result: RAGMutationResponse
	) => {
		const refreshed = await handleStatus(request);
		const maintenanceHtml = markMaintenancePanelOutOfBand(
			workflowRenderers.maintenance({
				admin: refreshed.admin,
				adminActions: refreshed.adminActions,
				adminJobs: refreshed.adminJobs,
				maintenance: refreshed.maintenance,
				path,
				status: refreshed.status
			})
		);

		return `${workflowRenderers.mutationResult(result)}${maintenanceHtml}`;
	};

	const enrichMaintenanceMutationResponse = async (
		request: Request,
		result: RAGMutationResponse
	): Promise<RAGMutationResponse> => {
		const statusSnapshot = await handleStatus(request);

		return {
			...result,
			admin: statusSnapshot.admin,
			adminActions: statusSnapshot.adminActions,
			adminJobs: statusSnapshot.adminJobs,
			maintenance: statusSnapshot.maintenance,
			workflowStatus: statusSnapshot.status
		};
	};

	const handleBackends = async (): Promise<
		RAGBackendsResponse | { ok: false; error: string }
	> => {
		if (!indexManager?.listBackends) {
			return {
				error: 'RAG backend discovery is not configured',
				ok: false
			};
		}

		const result = await indexManager.listBackends();
		const normalized = Array.isArray(result)
			? { backends: result }
			: result;

		return {
			ok: true,
			...normalized
		};
	};

	const handleSyncSources = async (
		request?: Request
	): Promise<RAGSyncResponse> => {
		if (!indexManager?.listSyncSources) {
			return {
				error: 'RAG source sync is not configured',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		return {
			ok: true,
			sources: await buildSyncSources(accessScope)
		};
	};

	const handleSyncAllSources = async (
		request?: Request,
		options?: {
			background?: boolean;
		}
	): Promise<RAGSyncResponse> => {
		if (!indexManager?.syncAllSources) {
			return {
				error: 'RAG source sync is not configured',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (accessScope?.allowedSyncSourceIds?.length) {
			return {
				error: 'Scoped sync-all is not allowed; sync individual sources instead',
				ok: false
			};
		}
		const job = createAdminJob('sync_all_sources', undefined, syncJobs);
		const action = createAdminAction('sync_all_sources');

		try {
			const result = await indexManager.syncAllSources(options);
			if (result && 'ok' in result) {
				if (!result.ok) {
					failAdminJob(job, result.error);
					failAdminAction(action, result.error);

					return result;
				}

				if (result.partial) {
					const failedSourceIds =
						'sources' in result
							? result.failedSourceIds
							: undefined;
					const message = failedSourceIds?.length
						? `Partial source sync failure: ${failedSourceIds.join(', ')}`
						: 'Partial source sync failure';
					failAdminJob(job, message);
					failAdminAction(action, message);

					return result;
				}

				completeAdminJob(job);
				completeAdminAction(action);

				return result;
			}

			completeAdminJob(job);
			completeAdminAction(action);

			return {
				ok: true,
				sources: await buildSyncSources(accessScope)
			};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleSyncSource = async (
		id: string,
		request?: Request,
		options?: {
			background?: boolean;
		}
	): Promise<RAGSyncResponse> => {
		if (!indexManager?.syncSource) {
			return {
				error: 'RAG source sync is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'sync source id is required',
				ok: false
			};
		}

		const accessScope = await loadAccessScope(request);
		if (!matchesSyncSourceScope(accessScope, { id })) {
			return {
				error: 'Sync source is outside the allowed RAG access scope',
				ok: false
			};
		}

		const job = createAdminJob('sync_source', id, syncJobs);
		const action = createAdminAction('sync_source', undefined, id);

		try {
			const result = await indexManager.syncSource(id, options);
			if (result && 'ok' in result) {
				if (!result.ok) {
					failAdminJob(job, result.error);
					failAdminAction(action, result.error);

					return result;
				}

				completeAdminJob(job);
				completeAdminAction(action);

				return result;
			}

			completeAdminJob(job);
			completeAdminAction(action);

			const source = (await buildSyncSources(accessScope)).find(
				(record) => record.id === id
			);

			return source
				? { ok: true, source }
				: {
						error: 'sync source not found',
						ok: false
					};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const htmxRoutes = () => {
		if (!config.htmx) {
			return new Elysia();
		}

		const renderers = resolveRenderers(
			typeof config.htmx === 'object' ? config.htmx.render : undefined
		);

		return new Elysia()
			.post(`${path}/message`, async ({ body }) => {
				const requestBody =
					body && typeof body === 'object' ? body : {};
				const rawContent =
					'content' in requestBody
						? String(requestBody.content)
						: undefined;
				const rawConversationId =
					'conversationId' in requestBody
						? String(requestBody.conversationId)
						: undefined;
				const rawAttachmentsValue =
					'attachments' in requestBody
						? requestBody.attachments
						: undefined;
				const rawAttachments: AIAttachment[] | undefined =
					Array.isArray(rawAttachmentsValue)
						? rawAttachmentsValue
						: undefined;

				if (!rawContent) {
					return new Response('Missing content', {
						status: HTTP_STATUS_BAD_REQUEST
					});
				}

				const conversationId = rawConversationId || generateId();
				const messageId = generateId();
				const conversation = await store.getOrCreate(conversationId);
				const parsed = parseProvider(rawContent);
				const { content } = parsed;

				appendMessage(conversation, {
					attachments: rawAttachments,
					content,
					conversationId,
					id: messageId,
					role: 'user',
					timestamp: Date.now()
				});
				await store.set(conversationId, conversation);

				const sseUrl = `${path}/sse/${conversationId}/${messageId}`;
				const cancelUrl = `${path}/cancel/${conversationId}/${messageId}`;

				return new Response(
					renderers.messageStart({
						cancelUrl,
						content,
						conversationId,
						messageId,
						sseUrl
					}),
					{ headers: { 'Content-Type': 'text/html' } }
				);
			})
			.post(`${path}/cancel/:conversationId/:messageId`, ({ params }) => {
				handleCancel(params.conversationId);

				return new Response(renderers.canceled(), {
					headers: { 'Content-Type': 'text/html' }
				});
			})
			.get(
				`${path}/sse/:conversationId/:messageId`,
				async function* ({ params }) {
					const { conversationId, messageId } = params;
					const conversation = await store.get(conversationId);

					if (!conversation) {
						yield {
							data: renderers.error('Conversation not found'),
							event: 'status'
						};

						return;
					}

					const lastMessage = conversation.messages.findLast(
						(message) =>
							message.id === messageId && message.role === 'user'
					);

					if (!lastMessage) {
						yield {
							data: renderers.error('Message not found'),
							event: 'status'
						};

						return;
					}

					const parsed = parseProvider(lastMessage.content);
					const { content, providerName } = parsed;
					const model = resolveModel(config, parsed);
					const ragModel = parsed.model ?? model;
					const assistantMessageId = generateId();
					const retrievalStartedAt = Date.now();
					yield {
						data: renderers.ragRetrieving({
							conversationId,
							messageId,
							retrievalStartedAt
						}),
						event: 'retrieval'
					};
					const provider = config.provider(providerName);
					const { ragContext, sources, trace } =
						await buildRAGContextFromQuery(
							config,
							topK,
							scoreThreshold,
							content,
							ragModel,
							config.embedding,
							config.embeddingModel
						);
					const retrievedAt = Date.now();
					const retrievalDurationMs =
						retrievedAt - retrievalStartedAt;

					yield {
						data: '',
						event: 'retrieval'
					};

					yield {
						data: renderers.ragRetrieved(sources, {
							conversationId,
							messageId,
							retrievalDurationMs,
							retrievalStartedAt,
							retrievedAt,
							trace
						}),
						event: 'sources'
					};

					const controller = new AbortController();
					abortControllers.set(conversationId, controller);

					const history = buildHistory(conversation);
					const lastMessageIndex = conversation.messages.findIndex(
						(message) => message.id === messageId
					);
					const userHistory =
						lastMessageIndex >= 0
							? history.slice(0, lastMessageIndex)
							: history;
					const messageWithContext = buildUserMessage(
						content,
						lastMessage.attachments,
						ragContext
					);
					const sseStream = streamAIToSSE(
						conversationId,
						assistantMessageId,
						{
							completeMeta: includeCompleteSources
								? { sources }
								: undefined,
							maxTurns: config.maxTurns,
							messages: [...userHistory, messageWithContext],
							model,
							provider,
							signal: controller.signal,
							systemPrompt: config.systemPrompt,
							thinking: resolveThinking(
								config,
								providerName,
								model
							),
							tools: resolveTools(config, providerName, model),
							onComplete: async (fullResponse, usage) => {
								await appendAssistantMessage(
									conversationId,
									assistantMessageId,
									fullResponse,
									sources,
									usage,
									model,
									retrievalStartedAt,
									retrievedAt,
									retrievalDurationMs
								);
								config.onComplete?.(
									conversationId,
									fullResponse,
									usage,
									sources
								);
								abortControllers.delete(conversationId);
							}
						},
						renderers
					);

					for await (const event of sseStream) {
						yield event;
					}
				}
			);
	};

	return new Elysia()
		.ws(path, {
			message: async (ws, raw) => {
				const message = parseAIMessage(raw);

				if (!message) {
					return;
				}

				if (message.type === 'cancel') {
					handleCancel(message.conversationId);

					return;
				}

				if (message.type === 'branch') {
					await handleBranch(
						ws,
						message.messageId,
						message.conversationId
					);

					return;
				}

				if (message.type === 'message') {
					await handleMessage(
						ws,
						message.content,
						message.conversationId,
						message.attachments
					);
				}
			}
		})
		.post(`${path}/search`, async ({ body, request, set }) => {
			const result = await handleSearch(body, request);

			if (!result.ok) {
				set.status =
					result.error === 'Invalid payload' ||
					result.error?.startsWith('Expected payload shape:')
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Search failed'
						),
						getNumericStatus(set.status)
					);
				}

				const query = getStringProperty(body, 'query') ?? '';

				return toHTMXResponse(
					workflowRenderers.searchResults({
						query,
						results: result.results ?? [],
						trace: result.trace
					})
				);
			}

			return result;
		})
		.get(`${path}/traces`, async ({ query, request, set }) => {
			const result = await handleTraceHistory(query);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Search trace history failed'
						),
						getNumericStatus(set.status)
					);
				}

				return new Response('', {
					headers: HTML_HEADERS,
					status: getNumericStatus(set.status)
				});
			}

			return result;
		})
		.get(`${path}/traces/groups`, async ({ query, request, set }) => {
			const result = await handleTraceGroupHistory(query);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Search trace group history failed'
						),
						getNumericStatus(set.status)
					);
				}

				return new Response('', {
					headers: HTML_HEADERS,
					status: getNumericStatus(set.status)
				});
			}

			return result;
		})
		.get(`${path}/traces/stats`, async ({ query, request, set }) => {
			const result = await handleTraceStats(query);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Search trace stats failed'
						),
						getNumericStatus(set.status)
					);
				}

				return new Response('', {
					headers: HTML_HEADERS,
					status: getNumericStatus(set.status)
				});
			}

			return result;
		})
		.post(
			`${path}/traces/prune/preview`,
			async ({ body, request, set }) => {
				const result = await handleTracePrunePreview(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Search trace prune preview failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(`${path}/traces/prune`, async ({ body, request, set }) => {
			const denied = await authorizeMutationRoute(
				request,
				'prune_search_traces',
				{
					fallback: 'Search trace pruning is not allowed'
				}
			);
			if (denied) {
				set.status = 403;
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							denied.error ?? 'Search trace prune failed'
						),
						getNumericStatus(set.status)
					);
				}
				return denied;
			}
			const result = await handleTracePrune(body);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Search trace prune failed'
						),
						getNumericStatus(set.status)
					);
				}

				return new Response('', {
					headers: HTML_HEADERS,
					status: getNumericStatus(set.status)
				});
			}

			return result;
		})
		.get(
			`${path}/traces/prune/history`,
			async ({ query, request, set }) => {
				const result = await handleTracePruneHistory(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Search trace prune history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(`${path}/compare/retrieval`, async ({ body, request, set }) => {
			const result = await handleEvaluateRetrievals(body, request);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Retrieval comparison failed'
						),
						getNumericStatus(set.status)
					);
				}

				return new Response('', {
					headers: HTML_HEADERS,
					status: getNumericStatus(set.status)
				});
			}

			return result;
		})
		.get(
			`${path}/compare/retrieval/history`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalComparisonHistory(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval comparison history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/benchmarks/adaptive-native-planner`,
			async ({ query, request, set }) => {
				const result =
					await handleAdaptiveNativePlannerBenchmark(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Adaptive native planner benchmark failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.adaptiveNativePlannerBenchmark(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/benchmarks/native-backend-comparison`,
			async ({ query, request, set }) => {
				const result =
					await handleNativeBackendComparisonBenchmark(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Native backend comparison benchmark failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.nativeBackendComparisonBenchmark(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/benchmarks/presentation-cue`,
			async ({ query, request, set }) => {
				const result = await handlePresentationCueBenchmark(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Presentation cue benchmark failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.presentationCueBenchmark(result),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/benchmarks/spreadsheet-cue`,
			async ({ query, request, set }) => {
				const result = await handleSpreadsheetCueBenchmark(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Spreadsheet cue benchmark failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.spreadsheetCueBenchmark(result),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/adaptive-native-planner/run`,
			async ({ body, request, set }) => {
				const result = await handleRunAdaptiveNativePlannerBenchmark(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Adaptive native planner benchmark run failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.adaptiveNativePlannerBenchmark(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/native-backend-comparison/run`,
			async ({ body, request, set }) => {
				const result = await handleRunNativeBackendComparisonBenchmark(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Native backend comparison benchmark run failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.nativeBackendComparisonBenchmark(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/presentation-cue/run`,
			async ({ body, request, set }) => {
				const result = await handleRunPresentationCueBenchmark(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Presentation cue benchmark run failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.presentationCueBenchmark(result),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/spreadsheet-cue/run`,
			async ({ body, request, set }) => {
				const result = await handleRunSpreadsheetCueBenchmark(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Spreadsheet cue benchmark run failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.spreadsheetCueBenchmark(result),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/adaptive-native-planner/snapshots`,
			async ({ body, request, set }) => {
				const result =
					await handlePersistAdaptiveNativePlannerBenchmarkSnapshot(
						body,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Adaptive native planner benchmark snapshot failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.adaptiveNativePlannerBenchmarkSnapshot(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/native-backend-comparison/snapshots`,
			async ({ body, request, set }) => {
				const result =
					await handlePersistNativeBackendComparisonBenchmarkSnapshot(
						body,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Native backend comparison benchmark snapshot failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.nativeBackendComparisonBenchmarkSnapshot(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/presentation-cue/snapshots`,
			async ({ body, request, set }) => {
				const result =
					await handlePersistPresentationCueBenchmarkSnapshot(
						body,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Presentation cue benchmark snapshot failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.presentationCueBenchmarkSnapshot(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/benchmarks/spreadsheet-cue/snapshots`,
			async ({ body, request, set }) => {
				const result =
					await handlePersistSpreadsheetCueBenchmarkSnapshot(
						body,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Spreadsheet cue benchmark snapshot failed'
							),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.spreadsheetCueBenchmarkSnapshot(
							result
						),
						getNumericStatus(set.status)
					);
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/baselines`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalBaselineList(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ?? 'Retrieval baseline list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/baselines/decisions`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalReleaseDecisionList(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release decision list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/release-history`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalReleaseGroupHistory(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release group history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/handoffs`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalLaneHandoffList(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/handoffs/decisions`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalLaneHandoffDecisionList(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff decision list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/handoffs/incidents`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalLaneHandoffIncidentList(
					query,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff incident list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/handoffs/incidents/history`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalLaneHandoffIncidentHistoryList(
						query,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff incident history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/handoffs/policies/history`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalLaneHandoffAutoCompletePolicyHistoryList(
						query
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff auto-complete policy history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/handoffs/incidents/acknowledge`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval lane handoff incident acknowledgement is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval lane handoff incident acknowledgement failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleRetrievalLaneHandoffIncidentAcknowledge(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff incident acknowledgement failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/handoffs/incidents/unacknowledge`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval lane handoff incident unacknowledge is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval lane handoff incident unacknowledge failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleRetrievalLaneHandoffIncidentUnacknowledge(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff incident unacknowledge failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/handoffs/incidents/resolve`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval lane handoff incident resolve is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval lane handoff incident resolve failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleResolveRetrievalLaneHandoffIncident(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff incident resolve failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/handoffs/decide`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval lane handoff decision is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval lane handoff decision failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handleRetrievalLaneHandoffDecision(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval lane handoff decision failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/incidents`,
			async ({ query, request, set }) => {
				const result = await handleRetrievalReleaseIncidentList(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release incident list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/incidents/remediations`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalIncidentRemediationDecisionList(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval incident remediation decision list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/incidents/remediations/executions`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalIncidentRemediationExecutionHistoryList(
						query
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval incident remediation execution history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/incidents/remediations`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval incident remediation decision record is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval incident remediation decision record failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleRecordRetrievalIncidentRemediationDecision(
						body
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval incident remediation decision record failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/incidents/remediations/execute`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval incident remediation execution is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval incident remediation execution failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleExecuteRetrievalIncidentRemediation(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval incident remediation execution failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/incidents/remediations/execute/bulk`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Bulk retrieval incident remediation execution is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Bulk retrieval incident remediation execution failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleBulkExecuteRetrievalIncidentRemediations(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Bulk retrieval incident remediation execution failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/incidents/acknowledge`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval release incident acknowledgement is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval release incident acknowledgement failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleAcknowledgeRetrievalReleaseIncident(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release incident acknowledgement failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/incidents/unacknowledge`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval release incident unacknowledge is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval release incident unacknowledge failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleUnacknowledgeRetrievalReleaseIncident(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release incident unacknowledge failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/incidents/resolve`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval release incident resolve is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval release incident resolve failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result =
					await handleResolveRetrievalReleaseIncident(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release incident resolve failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/candidates`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalPromotionCandidateList(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval promotion candidate list failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/baselines/approve`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{ fallback: 'Retrieval approval is not allowed' }
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ?? 'Retrieval approval failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handleRetrievalReleaseDecisionAction(
					body,
					'approve',
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ?? 'Retrieval approval failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/baselines/reject`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{ fallback: 'Retrieval rejection is not allowed' }
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ?? 'Retrieval rejection failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handleRetrievalReleaseDecisionAction(
					body,
					'reject',
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ?? 'Retrieval rejection failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/baselines/promote`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{ fallback: 'Retrieval baseline promotion is not allowed' }
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval baseline promotion failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handlePromoteRetrievalBaseline(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval baseline promotion failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/baselines/promote-lane`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval rollout-lane promotion is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval rollout-lane promotion failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handlePromoteRetrievalBaselineToLane(body);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval rollout-lane promotion failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/baselines/promote-run`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{
						fallback:
							'Retrieval baseline promotion from run is not allowed'
					}
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval baseline promotion from run failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handlePromoteRetrievalBaselineFromRun(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval baseline promotion from run failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(
			`${path}/compare/retrieval/baselines/revert`,
			async ({ body, request, set }) => {
				const denied = await authorizeMutationRoute(
					request,
					'manage_retrieval_admin',
					{ fallback: 'Retrieval baseline revert is not allowed' }
				);
				if (denied) {
					set.status = 403;
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								denied.error ??
									'Retrieval baseline revert failed'
							),
							getNumericStatus(set.status)
						);
					}
					return denied;
				}
				const result = await handleRevertRetrievalBaseline(
					body,
					request
				);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval baseline revert failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.post(`${path}/evaluate`, async ({ body, request, set }) => {
			const result = await handleEvaluate(body, request);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(result.error),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.evaluateResult({
						cases: result.cases,
						summary: result.summary
					}),
					HTTP_STATUS_OK
				);
			}

			return result;
		})
		.get(`${path}/status`, async ({ request }) => {
			const result = await handleStatus(request);

			if (config.htmx && isHTMXRequest(request)) {
				return toHTMXResponse(
					workflowRenderers.status({
						admin: result.admin,
						adminActions: result.adminActions,
						adminJobs: result.adminJobs,
						capabilities: result.capabilities,
						documents: result.documents,
						maintenance: result.maintenance,
						retrievalComparisons: result.retrievalComparisons,
						path,
						status: result.status
					})
				);
			}

			return result;
		})
		.get(
			`${path}/compare/retrieval/release-policies/history`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalReleaseLanePolicyHistoryList(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release lane policy history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/gate-policies/history`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalBaselineGatePolicyHistoryList(query);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval baseline gate policy history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/escalation-policies/history`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalReleaseLaneEscalationPolicyHistoryList(
						query,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release lane escalation policy history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(
			`${path}/compare/retrieval/incident-policies/history`,
			async ({ query, request, set }) => {
				const result =
					await handleRetrievalReleaseLaneEscalationPolicyHistoryList(
						query,
						request
					);

				if (!result.ok) {
					set.status = HTTP_STATUS_BAD_REQUEST;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ??
									'Retrieval release incident policy history failed'
							),
							getNumericStatus(set.status)
						);
					}

					return new Response('', {
						headers: HTML_HEADERS,
						status: getNumericStatus(set.status)
					});
				}

				return result;
			}
		)
		.get(`${path}/status/release`, async ({ request }) => {
			return handleRetrievalReleaseStatus(request);
		})
		.get(`${path}/status/maintenance`, async ({ request }) => {
			const result = await handleStatus(request);

			if (config.htmx && isHTMXRequest(request)) {
				return toHTMXResponse(
					workflowRenderers.maintenance({
						admin: result.admin,
						adminActions: result.adminActions,
						adminJobs: result.adminJobs,
						maintenance: result.maintenance,
						path,
						status: result.status
					})
				);
			}

			return {
				admin: result.admin,
				adminActions: result.adminActions,
				adminJobs: result.adminJobs,
				maintenance: result.maintenance,
				ok: true as const,
				status: result.status
			};
		})
		.get(`${path}/status/release/incidents`, async ({ request }) => {
			return handleRetrievalReleaseIncidentStatus(request);
		})
		.get(`${path}/status/release/remediations`, async ({ request }) => {
			return handleRetrievalIncidentRemediationStatus(request);
		})
		.get(`${path}/status/release/drift`, async ({ request }) => {
			return handleRetrievalReleaseDriftStatus(request);
		})
		.get(`${path}/status/handoffs/incidents`, async ({ request }) => {
			return handleRetrievalLaneHandoffIncidentStatus(request);
		})
		.get(`${path}/status/handoffs`, async ({ request }) => {
			return handleRetrievalLaneHandoffStatus(request);
		})
		.get(`${path}/ops`, async ({ request }) => {
			await ensureJobStateLoaded();
			const result = await handleOps(request);

			if (config.htmx && isHTMXRequest(request)) {
				return toHTMXResponse(
					workflowRenderers.status({
						admin: result.admin,
						adminActions: result.adminActions,
						adminJobs: result.adminJobs,
						capabilities: result.capabilities,
						documents: result.documents,
						maintenance: result.maintenance,
						retrievalComparisons: result.retrievalComparisons,
						path,
						status: result.status
					})
				);
			}

			return result;
		})
		.get(`${path}/documents`, async ({ query, request, set }) => {
			const result = await handleDocuments(
				getStringProperty(query, 'kind'),
				request
			);

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(result.error),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.documents({
						documents: result.documents
					})
				);
			}

			return result;
		})
		.post(`${path}/documents`, async ({ body, request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(
				request,
				'create_document'
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Document creation is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to create document'
						),
						getNumericStatus(set.status)
					);
				}
				return result;
			}
			const result = await handleCreateDocument(body, request);

			if (!result.ok) {
				const status = isAccessScopeError(result.error)
					? 403
					: result.error?.includes('not configured')
						? HTTP_STATUS_NOT_FOUND
						: HTTP_STATUS_BAD_REQUEST;
				set.status = status;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to create document'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.get(
			`${path}/documents/:id/chunks`,
			async ({ params, request, set }) => {
				const result = await handleDocumentChunks(
					typeof params.id === 'string' ? params.id.trim() : '',
					request
				);

				if (!result.ok) {
					const status = isAccessScopeError(result.error)
						? 403
						: result.error === 'document id is required'
							? HTTP_STATUS_BAD_REQUEST
							: HTTP_STATUS_NOT_FOUND;
					set.status = status;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(result.error),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.chunkPreview(result)
					);
				}

				return result;
			}
		)
		.get(`${path}/backends`, async ({ set }) => {
			const result = await handleBackends();

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
				if (isAccessScopeError(result.error)) {
					set.status = 403;
				}
			}

			return result;
		})
		.get(`${path}/sync`, async ({ request, set }) => {
			const result = await handleSyncSources(request);

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(result.error),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.mutationResult({
						ok: true,
						status: `loaded ${
							'sources' in result ? result.sources.length : 1
						} sync sources`
					})
				);
			}

			return result;
		})
		.post(`${path}/sync`, async ({ body, request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(
				request,
				'sync_all_sources'
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Source sync is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to sync sources'
						),
						getNumericStatus(set.status)
					);
				}
				return result;
			}
			const background = getBooleanProperty(body, 'background');
			const result = await handleSyncAllSources(request, { background });

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult({
							ok: true,
							status:
								background === true
									? 'source sync queued in the background'
									: 'source sync started and completed successfully'
						})
					: workflowRenderers.error(
							result.error ?? 'Failed to sync sources'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/sync/:id`, async ({ body, params, request, set }) => {
			await ensureJobStateLoaded();
			const syncSourceId =
				typeof params.id === 'string' ? params.id.trim() : '';
			const authorization = await checkAuthorization(
				request,
				'sync_source',
				{
					sourceId: syncSourceId
				}
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Source sync is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to sync source'
						),
						getNumericStatus(set.status)
					);
				}
				return result;
			}
			const background = getBooleanProperty(body, 'background');
			const result = await handleSyncSource(syncSourceId, request, {
				background
			});

			if (!result.ok) {
				set.status =
					result.error === 'sync source id is required'
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
				if (isAccessScopeError(result.error)) {
					set.status = 403;
				}
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult({
							ok: true,
							status:
								background === true
									? 'source sync queued in the background'
									: 'source sync started and completed successfully'
						})
					: workflowRenderers.error(
							result.error ?? 'Failed to sync source'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/ingest`, async ({ body, request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(request, 'ingest', {
				path: `${path}/ingest`
			});
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'RAG ingest is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'RAG ingest failed'
						),
						getNumericStatus(set.status)
					);
				}
				return result;
			}
			const result = await handleIngest(body);
			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'RAG ingest failed'
						),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.mutationResult(result),
					HTTP_STATUS_OK,
					{ 'HX-Trigger': 'rag:mutated' }
				);
			}

			return result;
		})
		.delete(`${path}/index`, async ({ request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(
				request,
				'clear_index'
			);
			if (!authorization.allowed) {
				set.status = 403;
				return buildAuthorizationFailure(
					authorization,
					'Index clearing is not allowed'
				);
			}
			if (!ragStore) {
				return { ok: false };
			}

			const job = createAdminJob('clear_index');
			try {
				await ragStore.clear?.();
				const action = createAdminAction('clear_index');
				completeAdminJob(job);
				completeAdminAction(action);
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				failAdminJob(job, message);
				const action = createAdminAction('clear_index');
				failAdminAction(action, message);
				throw caught;
			}

			return { ok: true };
		})
		.post(`${path}/backend/analyze`, async ({ request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(
				request,
				'analyze_backend'
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Backend analyze is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to analyze backend'
						),
						getNumericStatus(set.status),
						{ 'HX-Trigger': 'rag:mutated' }
					);
				}
				return result;
			}

			const result = await handleAnalyzeBackend();

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to analyze backend'
						),
						getNumericStatus(set.status),
						{
							'HX-Trigger': 'rag:mutated'
						}
					);
				}

				return toHTMXResponse(
					await renderMaintenanceMutationHTMXResponse(
						request,
						result
					),
					getNumericStatus(set.status)
				);
			}

			return result.ok
				? await enrichMaintenanceMutationResponse(request, result)
				: result;
		})
		.post(`${path}/backend/reindex-native`, async ({ request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(
				request,
				'rebuild_native_index'
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Native index rebuild is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to rebuild native index'
						),
						getNumericStatus(set.status),
						{ 'HX-Trigger': 'rag:mutated' }
					);
				}
				return result;
			}

			const result = await handleRebuildNativeIndex();

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to rebuild native index'
						),
						getNumericStatus(set.status),
						{
							'HX-Trigger': 'rag:mutated'
						}
					);
				}

				return toHTMXResponse(
					await renderMaintenanceMutationHTMXResponse(
						request,
						result
					),
					getNumericStatus(set.status)
				);
			}

			return result.ok
				? await enrichMaintenanceMutationResponse(request, result)
				: result;
		})
		.delete(`${path}/documents/:id`, async ({ params, request, set }) => {
			await ensureJobStateLoaded();
			const documentId =
				typeof params.id === 'string' ? params.id.trim() : '';
			const authorization = await checkAuthorization(
				request,
				'delete_document',
				{
					documentId
				}
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Document deletion is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to delete document'
						),
						getNumericStatus(set.status),
						{ 'HX-Trigger': 'rag:mutated' }
					);
				}
				return result;
			}
			const result = await handleDeleteDocument(documentId, request);

			if (!result.ok) {
				const status = isAccessScopeError(result.error)
					? 403
					: result.error === 'document id is required'
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
				set.status = status;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to delete document'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(
			`${path}/reindex/documents/:id`,
			async ({ params, request, set }) => {
				await ensureJobStateLoaded();
				const documentId =
					typeof params.id === 'string' ? params.id.trim() : '';
				const authorization = await checkAuthorization(
					request,
					'reindex_document',
					{ documentId }
				);
				if (!authorization.allowed) {
					set.status = 403;
					const result = buildAuthorizationFailure(
						authorization,
						'Document reindex is not allowed'
					);
					if (config.htmx && isHTMXRequest(request)) {
						return toHTMXResponse(
							workflowRenderers.error(
								result.error ?? 'Failed to reindex document'
							),
							getNumericStatus(set.status),
							{ 'HX-Trigger': 'rag:mutated' }
						);
					}
					return result;
				}
				const result = await handleReindexDocument(documentId, request);

				if (!result.ok) {
					set.status = isAccessScopeError(result.error)
						? 403
						: result.error === 'document id is required'
							? HTTP_STATUS_BAD_REQUEST
							: HTTP_STATUS_NOT_FOUND;
				}

				if (config.htmx && isHTMXRequest(request)) {
					const html = result.ok
						? workflowRenderers.mutationResult(result)
						: workflowRenderers.error(
								result.error ?? 'Failed to reindex document'
							);

					return toHTMXResponse(html, getNumericStatus(set.status), {
						'HX-Trigger': 'rag:mutated'
					});
				}

				return result;
			}
		)
		.post(`${path}/reindex/source`, async ({ body, request, set }) => {
			await ensureJobStateLoaded();
			const source = getStringProperty(body, 'source')?.trim() ?? '';
			const authorization = await checkAuthorization(
				request,
				'reindex_source',
				{
					source
				}
			);
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Source reindex is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to reindex source'
						),
						getNumericStatus(set.status),
						{ 'HX-Trigger': 'rag:mutated' }
					);
				}
				return result;
			}
			const result = await handleReindexSource(source, request);

			if (!result.ok) {
				set.status = isAccessScopeError(result.error)
					? 403
					: result.error === 'source is required'
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to reindex source'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/reseed`, async ({ request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(request, 'reseed');
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Index reseed is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to reseed index'
						),
						getNumericStatus(set.status),
						{ 'HX-Trigger': 'rag:mutated' }
					);
				}
				return result;
			}
			const result = await handleReseed();

			if (!result.ok) {
				set.status = 404;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to reseed index'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/reset`, async ({ request, set }) => {
			await ensureJobStateLoaded();
			const authorization = await checkAuthorization(request, 'reset');
			if (!authorization.allowed) {
				set.status = 403;
				const result = buildAuthorizationFailure(
					authorization,
					'Index reset is not allowed'
				);
				if (config.htmx && isHTMXRequest(request)) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Failed to reset index'
						),
						getNumericStatus(set.status),
						{ 'HX-Trigger': 'rag:mutated' }
					);
				}
				return result;
			}
			const result = await handleReset();

			if (!result.ok) {
				set.status = 404;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to reset index'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.get(`${path}/conversations`, () => store.list())
		.get(`${path}/conversations/:id`, async ({ params }) => {
			const conv = await store.get(params.id);

			if (!conv) {
				return new Response('Not found', { status: 404 });
			}

			return {
				id: conv.id,
				messages: conv.messages,
				title: conv.title ?? 'Untitled'
			};
		})
		.delete(`${path}/conversations/:id`, async ({ params }) => {
			await store.remove(params.id);

			return { ok: true };
		})
		.use(htmxRoutes());
};
