import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Database } from 'bun:sqlite';
import type {
	RAGAnswerGroundingCaseDifficultyDiffEntry,
	RAGAnswerGroundingCaseDifficultyHistory,
	RAGAnswerGroundingCaseDifficultyHistoryStore,
	RAGAnswerGroundingCaseDifficultyRun,
	RAGAnswerGroundingCaseDifficultyRunDiff,
	RAGAnswerGroundingEvaluationCaseDiff,
	RAGAnswerGroundingEvaluationCase,
	RAGAnswerGroundingEvaluationCaseDifficultyEntry,
	RAGAnswerGroundingEvaluationCaseSnapshot,
	RAGAnswerGroundingEvaluationCaseResult,
	RAGAnswerGroundingEvaluationHistory,
	RAGAnswerGroundingEvaluationLeaderboardEntry,
	RAGAnswerGroundingEvaluationHistoryStore,
	RAGAnswerGroundingEvaluationInput,
	RAGAnswerGroundingEvaluationResponse,
	RAGAnswerGroundingEvaluationRun,
	RAGAnswerGroundingEvaluationRunDiff,
	RAGCollection,
	RAGIndexedDocument,
	RAGEvaluationCase,
	RAGEvaluationCaseDiff,
	RAGEvaluationCaseTraceSnapshot,
	RAGEvaluationCaseResult,
	RAGEvaluationHistory,
	RAGEvaluationHistoryStore,
	RAGEvaluationHistoryPruneInput,
	RAGEvaluationHistoryPruneResult,
	RAGEvaluationInput,
	RAGEvaluationLeaderboardEntry,
	RAGEvaluationResponse,
	RAGEvaluationRunDiff,
	RAGLabelValueRow,
	RAGComparisonPresentation,
	RAGComparisonOverviewPresentation,
	RAGGroundingProviderPresentation,
	RAGGroundingProviderOverviewPresentation,
	RAGGroundingProviderCaseComparisonPresentation,
	RAGGroundingOverviewPresentation,
	RAGQualityOverviewPresentation,
	RAGDocumentChunk,
	RAGEvaluationSuite,
	RAGEvaluationSuiteGenerationOptions,
	RAGEvaluationSuiteDatasetSummary,
	RAGEvaluationSuiteSnapshot,
	RAGEvaluationSuiteSnapshotDiff,
	RAGEvaluationSuiteSnapshotHistory,
	RAGEvaluationSuiteSnapshotHistoryStore,
	RAGEvaluationSuiteRun,
	RAGEvaluationEntityQualitySummary,
	RAGEvaluationEntityQualityView,
	RAGAnswerGroundingEntityQualitySummary,
	RAGAnswerGroundingEntityQualityView,
	RAGRetrievalTraceSummaryRun,
	RAGHybridRetrievalMode,
	RAGSourceBalanceStrategy,
	RAGRetrievalCandidate,
	RAGRetrievalComparison,
	RAGRetrievalBaselineGatePolicy,
	RAGRetrievalBaselineGatePolicyHistoryRecord,
	RAGRetrievalBaselineGatePolicyHistoryStore,
	RAGRetrievalComparisonDecisionSummary,
	RAGRetrievalComparisonGateResult,
	RAGRetrievalReleaseVerdict,
	RAGRetrievalComparisonHistoryStore,
	RAGRetrievalBaselineRecord,
	RAGRetrievalBaselineStore,
	RAGRetrievalLaneHandoffDecisionRecord,
	RAGRetrievalLaneHandoffDecisionStore,
	RAGRetrievalLaneHandoffIncidentHistoryRecord,
	RAGRetrievalLaneHandoffIncidentHistoryStore,
	RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord,
	RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore,
	RAGRetrievalLaneHandoffIncidentRecord,
	RAGRetrievalLaneHandoffIncidentStore,
	RAGRetrievalIncidentRemediationDecisionRecord,
	RAGRetrievalIncidentRemediationDecisionStore,
	RAGRetrievalIncidentRemediationExecutionHistoryRecord,
	RAGRetrievalIncidentRemediationExecutionHistoryStore,
	RAGRetrievalReleaseDecisionRecord,
	RAGRetrievalReleaseLanePolicyHistoryRecord,
	RAGRetrievalReleaseLanePolicyHistoryStore,
	RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord,
	RAGRetrievalReleaseLaneEscalationPolicyHistoryStore,
	RAGRetrievalReleaseDecisionStore,
	RAGRetrievalReleaseIncidentRecord,
	RAGRetrievalReleaseIncidentStore,
	RAGRetrievalComparisonRun,
	RAGRetrievalComparisonEntry,
	RAGRetrievalTrace,
	RAGRetrievalTraceComparisonSummary,
	RAGRetrievalTraceComparisonSummaryDiff,
	RAGRetrievalTraceStep,
	RAGRetrievalTraceStage,
	RAGQueryResult,
	RAGTraceSummaryListTrend,
	RAGTraceSummaryTrendDirection,
	RAGTraceSummaryNumericDelta,
	RAGTraceSummaryStageTrend,
	RAGTraceSummaryStageCountsDelta,
	RAGRetrievalComparisonSummary,
	RAGRetrievalTraceHistoryWindow,
	RAGRerankerCandidate,
	RAGRerankerComparison,
	RAGRerankerComparisonEntry,
	RAGRerankerComparisonSummary,
	RAGRerankerProviderLike,
	RAGRetrievalTraceTrend,
	RAGSearchTraceDiff,
	RAGSearchTraceGroupHistory,
	RAGSearchTraceGroupHistoryEntry,
	RAGSearchTraceHistory,
	RAGChatPluginConfig,
	RAGSearchTracePruneInput,
	RAGSearchTracePruneHistoryStore,
	RAGSearchTracePruneRun,
	RAGSearchTracePrunePreview,
	RAGSearchTracePruneResult,
	RAGSearchTraceRecord,
	RAGSearchTraceResultSnapshot,
	RAGSearchTraceStats,
	RAGSearchTraceStore,
	RAGRemediationAction,
	RAGSource,
	RAGCollectionSearchParams,
	RAGSQLiteStoreMigrationInspection,
	RAGSQLiteStoreMigrationIssue,
	RAGSQLiteStoreMigrationResult
} from '../../../types/ai';
import { generateId } from '../protocol';
import { buildRAGGroundedAnswer } from './grounding';
import { buildRAGSourceLabels } from './presentation';

const DEFAULT_TOP_K = 6;
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_SEARCH_TRACE_TABLE_NAME = 'rag_search_traces';

const getTraceLabelString = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;

const getTraceLabelNumber = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const formatTraceSpreadsheetTableLabel = (
	tableIndex?: number,
	tableCount?: number
) => {
	if (
		typeof tableIndex !== 'number' ||
		!Number.isFinite(tableIndex) ||
		tableIndex < 1
	) {
		return undefined;
	}

	if (
		typeof tableCount === 'number' &&
		Number.isFinite(tableCount) &&
		tableCount >= tableIndex
	) {
		return `Table ${tableIndex} of ${tableCount}`;
	}

	return `Table ${tableIndex}`;
};

const formatTraceSourceAwareChunkReason = (value: unknown) => {
	const reason = getTraceLabelString(value);
	if (reason === 'section_boundary') {
		return 'Chunk boundary section';
	}
	if (reason === 'size_limit') {
		return 'Chunk boundary size limit';
	}
	if (reason === 'source_native_unit') {
		return 'Chunk boundary source-native unit';
	}
	return undefined;
};

const buildTraceSourceAwareUnitScopeLabel = (
	metadata?: Record<string, unknown>
) => {
	if (!metadata) {
		return undefined;
	}

	const sectionKind = getTraceLabelString(metadata.sectionKind);
	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getTraceLabelString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const sectionTitle =
		getTraceLabelString(metadata.sectionTitle) ?? sectionPath.at(-1);
	const pdfTextKind = getTraceLabelString(metadata.pdfTextKind);
	const officeBlockKind = getTraceLabelString(metadata.officeBlockKind);
	const sheetName = getTraceLabelString(metadata.sheetName);
	const spreadsheetTableLabel = formatTraceSpreadsheetTableLabel(
		getTraceLabelNumber(metadata.spreadsheetTableIndex),
		getTraceLabelNumber(metadata.spreadsheetTableCount)
	);
	const slideTitle = getTraceLabelString(metadata.slideTitle);
	const slideNumber =
		getTraceLabelNumber(metadata.slideNumber) ??
		(typeof metadata.slideIndex === 'number'
			? metadata.slideIndex + 1
			: undefined);

	if (
		sectionPath.length > 0 &&
		(sectionKind === 'markdown_heading' ||
			sectionKind === 'html_heading' ||
			sectionKind === 'office_heading' ||
			sectionKind === undefined)
	) {
		return `Source-aware section ${sectionPath.join(' > ')}`;
	}

	if (sectionKind === 'pdf_block') {
		if (pdfTextKind === 'table_like' && sectionTitle) {
			return `Source-aware PDF table block ${sectionTitle}`;
		}
		if (sectionTitle) {
			return `Source-aware PDF block ${sectionTitle}`;
		}
		return 'Source-aware PDF block';
	}

	if (sectionKind === 'office_block') {
		if (officeBlockKind && sectionTitle) {
			return `Source-aware office ${officeBlockKind} block ${sectionTitle}`;
		}
		if (sectionTitle) {
			return `Source-aware office block ${sectionTitle}`;
		}
		return 'Source-aware office block';
	}

	if (
		sectionKind === 'spreadsheet_rows' ||
		(sectionKind === undefined &&
			(sheetName ||
				spreadsheetTableLabel ||
				getTraceLabelNumber(metadata.spreadsheetRowStart) !==
					undefined ||
				getTraceLabelNumber(metadata.spreadsheetRowEnd) !== undefined))
	) {
		if (sheetName && spreadsheetTableLabel) {
			return `Source-aware spreadsheet ${sheetName} ${spreadsheetTableLabel}`;
		}
		if (sheetName) {
			return `Source-aware spreadsheet ${sheetName}`;
		}
		return 'Source-aware spreadsheet';
	}

	if (sectionKind === 'presentation_slide') {
		if (slideNumber && slideTitle) {
			return `Source-aware slide ${slideNumber} ${slideTitle}`;
		}
		if (slideTitle) {
			return `Source-aware slide ${slideTitle}`;
		}
		if (slideNumber) {
			return `Source-aware slide ${slideNumber}`;
		}
		return 'Source-aware slide';
	}

	return undefined;
};

const buildEvaluationLeadSnapshot = (input?: {
	metadata?: Record<string, unknown>;
	source?: string;
	title?: string;
}): Pick<
	RAGEvaluationCaseTraceSnapshot,
	| 'topContextLabel'
	| 'topLocatorLabel'
	| 'sourceAwareChunkReasonLabel'
	| 'sourceAwareUnitScopeLabel'
> => {
	const labels = buildRAGSourceLabels({
		metadata: input?.metadata,
		source: input?.source,
		title: input?.title
	});

	return {
		sourceAwareChunkReasonLabel: formatTraceSourceAwareChunkReason(
			input?.metadata?.sourceAwareChunkReason
		),
		sourceAwareUnitScopeLabel: buildTraceSourceAwareUnitScopeLabel(
			input?.metadata
		),
		topContextLabel: labels?.contextLabel,
		topLocatorLabel: labels?.locatorLabel
	};
};

const buildEvaluationLeadMediaCueSnapshot = (
	trace?: RAGRetrievalTrace
): Pick<
	RAGEvaluationCaseTraceSnapshot,
	| 'leadSpeakerCue'
	| 'leadSpeakerAttributionCue'
	| 'leadChannelCue'
	| 'leadChannelAttributionCue'
	| 'leadContinuityCue'
> => {
	const rerankStep = trace?.steps.find((step) => step.stage === 'rerank');
	const metadata = rerankStep?.metadata ?? {};

	return {
		leadChannelAttributionCue:
			typeof metadata.leadChannelAttributionCue === 'string'
				? metadata.leadChannelAttributionCue
				: undefined,
		leadChannelCue:
			typeof metadata.leadChannelCue === 'string'
				? metadata.leadChannelCue
				: undefined,
		leadContinuityCue:
			typeof metadata.leadContinuityCue === 'string'
				? metadata.leadContinuityCue
				: undefined,
		leadSpeakerAttributionCue:
			typeof metadata.leadSpeakerAttributionCue === 'string'
				? metadata.leadSpeakerAttributionCue
				: undefined,
		leadSpeakerCue:
			typeof metadata.leadSpeakerCue === 'string'
				? metadata.leadSpeakerCue
				: undefined
	};
};

const buildEvaluationLeadPresentationCueSnapshot = (
	trace?: RAGRetrievalTrace
): Pick<RAGEvaluationCaseTraceSnapshot, 'leadPresentationCue'> => {
	const rerankStep = trace?.steps.find((step) => step.stage === 'rerank');
	const metadata = rerankStep?.metadata ?? {};
	const cue = metadata.leadPresentationCue;

	return {
		leadPresentationCue:
			cue === 'title' || cue === 'body' || cue === 'notes'
				? cue
				: undefined
	};
};

const buildEvaluationLeadSpreadsheetCueSnapshot = (
	trace?: RAGRetrievalTrace
): Pick<RAGEvaluationCaseTraceSnapshot, 'leadSpreadsheetCue'> => {
	const rerankStep = trace?.steps.find((step) => step.stage === 'rerank');
	const metadata = rerankStep?.metadata ?? {};
	const cue = metadata.leadSpreadsheetCue;

	return {
		leadSpreadsheetCue:
			cue === 'sheet' || cue === 'table' || cue === 'column'
				? cue
				: undefined
	};
};

const buildEvaluationSQLiteQueryPlanSnapshot = (
	trace?: RAGRetrievalTrace
): Pick<
	RAGEvaluationCaseTraceSnapshot,
	| 'sqliteQueryMode'
	| 'sqliteQueryPushdownMode'
	| 'sqliteQueryPushdownApplied'
	| 'sqliteQueryPushdownClauseCount'
	| 'sqliteQueryTotalFilterClauseCount'
	| 'sqliteQueryJsRemainderClauseCount'
	| 'sqliteQueryMultiplierUsed'
	| 'sqliteQueryCandidateLimitUsed'
	| 'sqliteQueryMaxBackfillsUsed'
	| 'sqliteQueryMinResultsUsed'
	| 'sqliteQueryFillPolicyUsed'
	| 'sqliteQueryPushdownCoverageRatio'
	| 'sqliteQueryJsRemainderRatio'
	| 'sqliteQueryFilteredCandidates'
	| 'sqliteQueryInitialSearchK'
	| 'sqliteQueryFinalSearchK'
	| 'sqliteQuerySearchExpansionRatio'
	| 'sqliteQueryBackfillCount'
	| 'sqliteQueryBackfillLimitReached'
	| 'sqliteQueryMinResultsSatisfied'
	| 'sqliteQueryReturnedCount'
	| 'sqliteQueryCandidateYieldRatio'
	| 'sqliteQueryTopKFillRatio'
	| 'sqliteQueryUnderfilledTopK'
	| 'sqliteQueryCandidateBudgetExhausted'
	| 'sqliteQueryCandidateCoverage'
> => {
	const vectorStep = trace?.steps.find(
		(step) => step.stage === 'vector_search'
	);
	const metadata = vectorStep?.metadata ?? {};

	return {
		sqliteQueryBackfillCount:
			typeof metadata.sqliteQueryBackfillCount === 'number'
				? metadata.sqliteQueryBackfillCount
				: undefined,
		sqliteQueryCandidateBudgetExhausted:
			typeof metadata.sqliteQueryCandidateBudgetExhausted === 'boolean'
				? metadata.sqliteQueryCandidateBudgetExhausted
				: undefined,
		sqliteQueryCandidateCoverage:
			metadata.sqliteQueryCandidateCoverage === 'empty' ||
			metadata.sqliteQueryCandidateCoverage === 'under_target' ||
			metadata.sqliteQueryCandidateCoverage === 'target_sized' ||
			metadata.sqliteQueryCandidateCoverage === 'broad'
				? metadata.sqliteQueryCandidateCoverage
				: undefined,
		sqliteQueryFilteredCandidates:
			typeof metadata.sqliteQueryFilteredCandidates === 'number'
				? metadata.sqliteQueryFilteredCandidates
				: undefined,
		sqliteQueryFinalSearchK:
			typeof metadata.sqliteQueryFinalSearchK === 'number'
				? metadata.sqliteQueryFinalSearchK
				: undefined,
		sqliteQueryInitialSearchK:
			typeof metadata.sqliteQueryInitialSearchK === 'number'
				? metadata.sqliteQueryInitialSearchK
				: undefined,
		sqliteQuerySearchExpansionRatio:
			typeof metadata.sqliteQuerySearchExpansionRatio === 'number'
				? metadata.sqliteQuerySearchExpansionRatio
				: undefined,
		sqliteQueryMode:
			metadata.sqliteQueryMode === 'json_fallback' ||
			metadata.sqliteQueryMode === 'native_vec0'
				? metadata.sqliteQueryMode
				: undefined,
		sqliteQueryPushdownMode:
			metadata.sqliteQueryPushdownMode === 'none' ||
			metadata.sqliteQueryPushdownMode === 'partial' ||
			metadata.sqliteQueryPushdownMode === 'full'
				? metadata.sqliteQueryPushdownMode
				: undefined,
		sqliteQueryPushdownApplied:
			typeof metadata.sqliteQueryPushdownApplied === 'boolean'
				? metadata.sqliteQueryPushdownApplied
				: undefined,
		sqliteQueryPushdownClauseCount:
			typeof metadata.sqliteQueryPushdownClauseCount === 'number'
				? metadata.sqliteQueryPushdownClauseCount
				: undefined,
		sqliteQueryTotalFilterClauseCount:
			typeof metadata.sqliteQueryTotalFilterClauseCount === 'number'
				? metadata.sqliteQueryTotalFilterClauseCount
				: undefined,
		sqliteQueryJsRemainderClauseCount:
			typeof metadata.sqliteQueryJsRemainderClauseCount === 'number'
				? metadata.sqliteQueryJsRemainderClauseCount
				: undefined,
		sqliteQueryMultiplierUsed:
			typeof metadata.sqliteQueryMultiplierUsed === 'number'
				? metadata.sqliteQueryMultiplierUsed
				: undefined,
		sqliteQueryCandidateLimitUsed:
			typeof metadata.sqliteQueryCandidateLimitUsed === 'number'
				? metadata.sqliteQueryCandidateLimitUsed
				: undefined,
		sqliteQueryMaxBackfillsUsed:
			typeof metadata.sqliteQueryMaxBackfillsUsed === 'number'
				? metadata.sqliteQueryMaxBackfillsUsed
				: undefined,
		sqliteQueryMinResultsUsed:
			typeof metadata.sqliteQueryMinResultsUsed === 'number'
				? metadata.sqliteQueryMinResultsUsed
				: undefined,
		sqliteQueryFillPolicyUsed:
			metadata.sqliteQueryFillPolicyUsed === 'strict_topk' ||
			metadata.sqliteQueryFillPolicyUsed === 'satisfy_min_results'
				? metadata.sqliteQueryFillPolicyUsed
				: undefined,
		sqliteQueryPushdownCoverageRatio:
			typeof metadata.sqliteQueryPushdownCoverageRatio === 'number'
				? metadata.sqliteQueryPushdownCoverageRatio
				: undefined,
		sqliteQueryJsRemainderRatio:
			typeof metadata.sqliteQueryJsRemainderRatio === 'number'
				? metadata.sqliteQueryJsRemainderRatio
				: undefined,
		sqliteQueryReturnedCount:
			typeof metadata.sqliteQueryReturnedCount === 'number'
				? metadata.sqliteQueryReturnedCount
				: undefined,
		sqliteQueryCandidateYieldRatio:
			typeof metadata.sqliteQueryCandidateYieldRatio === 'number'
				? metadata.sqliteQueryCandidateYieldRatio
				: undefined,
		sqliteQueryBackfillLimitReached:
			typeof metadata.sqliteQueryBackfillLimitReached === 'boolean'
				? metadata.sqliteQueryBackfillLimitReached
				: undefined,
		sqliteQueryMinResultsSatisfied:
			typeof metadata.sqliteQueryMinResultsSatisfied === 'boolean'
				? metadata.sqliteQueryMinResultsSatisfied
				: undefined,
		sqliteQueryTopKFillRatio:
			typeof metadata.sqliteQueryTopKFillRatio === 'number'
				? metadata.sqliteQueryTopKFillRatio
				: undefined,
		sqliteQueryUnderfilledTopK:
			typeof metadata.sqliteQueryUnderfilledTopK === 'boolean'
				? metadata.sqliteQueryUnderfilledTopK
				: undefined
	};
};

const buildEvaluationPostgresQueryPlanSnapshot = (
	trace?: RAGRetrievalTrace
): Pick<
	RAGEvaluationCaseTraceSnapshot,
	| 'postgresQueryMode'
	| 'postgresQueryPushdownMode'
	| 'postgresQueryPushdownApplied'
	| 'postgresQueryPushdownClauseCount'
	| 'postgresQueryTotalFilterClauseCount'
	| 'postgresQueryJsRemainderClauseCount'
	| 'postgresQueryMultiplierUsed'
	| 'postgresQueryCandidateLimitUsed'
	| 'postgresQueryMaxBackfillsUsed'
	| 'postgresQueryMinResultsUsed'
	| 'postgresQueryFillPolicyUsed'
	| 'postgresQueryPushdownCoverageRatio'
	| 'postgresQueryJsRemainderRatio'
	| 'postgresQueryFilteredCandidates'
	| 'postgresQueryInitialSearchK'
	| 'postgresQueryFinalSearchK'
	| 'postgresQuerySearchExpansionRatio'
	| 'postgresQueryBackfillCount'
	| 'postgresQueryBackfillLimitReached'
	| 'postgresQueryMinResultsSatisfied'
	| 'postgresQueryReturnedCount'
	| 'postgresQueryCandidateYieldRatio'
	| 'postgresQueryTopKFillRatio'
	| 'postgresQueryUnderfilledTopK'
	| 'postgresQueryCandidateBudgetExhausted'
	| 'postgresQueryCandidateCoverage'
> => {
	const vectorStep = trace?.steps.find(
		(step) => step.stage === 'vector_search'
	);
	const metadata = vectorStep?.metadata ?? {};

	return {
		postgresQueryBackfillCount:
			typeof metadata.postgresQueryBackfillCount === 'number'
				? metadata.postgresQueryBackfillCount
				: undefined,
		postgresQueryCandidateBudgetExhausted:
			typeof metadata.postgresQueryCandidateBudgetExhausted === 'boolean'
				? metadata.postgresQueryCandidateBudgetExhausted
				: undefined,
		postgresQueryCandidateCoverage:
			metadata.postgresQueryCandidateCoverage === 'empty' ||
			metadata.postgresQueryCandidateCoverage === 'under_target' ||
			metadata.postgresQueryCandidateCoverage === 'target_sized' ||
			metadata.postgresQueryCandidateCoverage === 'broad'
				? metadata.postgresQueryCandidateCoverage
				: undefined,
		postgresQueryFilteredCandidates:
			typeof metadata.postgresQueryFilteredCandidates === 'number'
				? metadata.postgresQueryFilteredCandidates
				: undefined,
		postgresQueryFinalSearchK:
			typeof metadata.postgresQueryFinalSearchK === 'number'
				? metadata.postgresQueryFinalSearchK
				: undefined,
		postgresQueryInitialSearchK:
			typeof metadata.postgresQueryInitialSearchK === 'number'
				? metadata.postgresQueryInitialSearchK
				: undefined,
		postgresQuerySearchExpansionRatio:
			typeof metadata.postgresQuerySearchExpansionRatio === 'number'
				? metadata.postgresQuerySearchExpansionRatio
				: undefined,
		postgresQueryMode:
			metadata.postgresQueryMode === 'native_pgvector'
				? metadata.postgresQueryMode
				: undefined,
		postgresQueryPushdownMode:
			metadata.postgresQueryPushdownMode === 'none' ||
			metadata.postgresQueryPushdownMode === 'partial' ||
			metadata.postgresQueryPushdownMode === 'full'
				? metadata.postgresQueryPushdownMode
				: undefined,
		postgresQueryPushdownApplied:
			typeof metadata.postgresQueryPushdownApplied === 'boolean'
				? metadata.postgresQueryPushdownApplied
				: undefined,
		postgresQueryPushdownClauseCount:
			typeof metadata.postgresQueryPushdownClauseCount === 'number'
				? metadata.postgresQueryPushdownClauseCount
				: undefined,
		postgresQueryTotalFilterClauseCount:
			typeof metadata.postgresQueryTotalFilterClauseCount === 'number'
				? metadata.postgresQueryTotalFilterClauseCount
				: undefined,
		postgresQueryJsRemainderClauseCount:
			typeof metadata.postgresQueryJsRemainderClauseCount === 'number'
				? metadata.postgresQueryJsRemainderClauseCount
				: undefined,
		postgresQueryMultiplierUsed:
			typeof metadata.postgresQueryMultiplierUsed === 'number'
				? metadata.postgresQueryMultiplierUsed
				: undefined,
		postgresQueryCandidateLimitUsed:
			typeof metadata.postgresQueryCandidateLimitUsed === 'number'
				? metadata.postgresQueryCandidateLimitUsed
				: undefined,
		postgresQueryMaxBackfillsUsed:
			typeof metadata.postgresQueryMaxBackfillsUsed === 'number'
				? metadata.postgresQueryMaxBackfillsUsed
				: undefined,
		postgresQueryMinResultsUsed:
			typeof metadata.postgresQueryMinResultsUsed === 'number'
				? metadata.postgresQueryMinResultsUsed
				: undefined,
		postgresQueryFillPolicyUsed:
			metadata.postgresQueryFillPolicyUsed === 'strict_topk' ||
			metadata.postgresQueryFillPolicyUsed === 'satisfy_min_results'
				? metadata.postgresQueryFillPolicyUsed
				: undefined,
		postgresQueryPushdownCoverageRatio:
			typeof metadata.postgresQueryPushdownCoverageRatio === 'number'
				? metadata.postgresQueryPushdownCoverageRatio
				: undefined,
		postgresQueryJsRemainderRatio:
			typeof metadata.postgresQueryJsRemainderRatio === 'number'
				? metadata.postgresQueryJsRemainderRatio
				: undefined,
		postgresQueryReturnedCount:
			typeof metadata.postgresQueryReturnedCount === 'number'
				? metadata.postgresQueryReturnedCount
				: undefined,
		postgresQueryCandidateYieldRatio:
			typeof metadata.postgresQueryCandidateYieldRatio === 'number'
				? metadata.postgresQueryCandidateYieldRatio
				: undefined,
		postgresQueryBackfillLimitReached:
			typeof metadata.postgresQueryBackfillLimitReached === 'boolean'
				? metadata.postgresQueryBackfillLimitReached
				: undefined,
		postgresQueryMinResultsSatisfied:
			typeof metadata.postgresQueryMinResultsSatisfied === 'boolean'
				? metadata.postgresQueryMinResultsSatisfied
				: undefined,
		postgresQueryTopKFillRatio:
			typeof metadata.postgresQueryTopKFillRatio === 'number'
				? metadata.postgresQueryTopKFillRatio
				: undefined,
		postgresQueryUnderfilledTopK:
			typeof metadata.postgresQueryUnderfilledTopK === 'boolean'
				? metadata.postgresQueryUnderfilledTopK
				: undefined
	};
};
const DEFAULT_RETRIEVAL_COMPARISON_HISTORY_TABLE_NAME =
	'rag_retrieval_comparison_history';
const DEFAULT_RETRIEVAL_RELEASE_DECISION_TABLE_NAME =
	'rag_retrieval_release_decisions';
const DEFAULT_RETRIEVAL_BASELINE_TABLE_NAME = 'rag_retrieval_baselines';
const DEFAULT_RETRIEVAL_RELEASE_INCIDENT_TABLE_NAME =
	'rag_retrieval_release_incidents';
type BunSQLiteModule = {
	Database: new (path?: string) => Database;
};

type ImportMetaWithRequire = ImportMeta & {
	require?: (specifier: string) => unknown;
};

const loadBunSQLiteModule = (): BunSQLiteModule => {
	const runtimeRequire = (import.meta as ImportMetaWithRequire).require;
	if (typeof runtimeRequire !== 'function') {
		throw new Error(
			'SQLite trace storage requires Bun runtime support for import.meta.require.'
		);
	}

	return runtimeRequire('bun:sqlite') as BunSQLiteModule;
};

const normalizeStringArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((candidate) => typeof candidate === 'string')
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0);
};

const normalizeLabelFilter = (value?: string) => {
	if (typeof value !== 'string') {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
};

const normalizeRetrievalBaselineRecords = (
	records: RAGRetrievalBaselineRecord[]
) => [...records].sort((left, right) => right.promotedAt - left.promotedAt);

const normalizeRetrievalReleaseDecisionRecords = (
	records: RAGRetrievalReleaseDecisionRecord[]
) => [...records].sort((left, right) => right.decidedAt - left.decidedAt);

const normalizeRetrievalLaneHandoffDecisionRecords = (
	records: RAGRetrievalLaneHandoffDecisionRecord[]
) => [...records].sort((left, right) => right.decidedAt - left.decidedAt);

const normalizeRetrievalReleaseIncidentRecords = (
	records: RAGRetrievalReleaseIncidentRecord[]
) => [...records].sort((left, right) => right.triggeredAt - left.triggeredAt);

const normalizeRetrievalIncidentRemediationDecisionRecords = (
	records: RAGRetrievalIncidentRemediationDecisionRecord[]
) => [...records].sort((left, right) => right.decidedAt - left.decidedAt);

const normalizeRetrievalIncidentRemediationExecutionHistoryRecords = (
	records: RAGRetrievalIncidentRemediationExecutionHistoryRecord[]
) => [...records].sort((left, right) => right.executedAt - left.executedAt);

const matchesWinner = (run: RAGRetrievalComparisonRun, winnerId?: string) => {
	if (!winnerId) {
		return true;
	}

	return (
		run.comparison.summary.bestByPassingRate === winnerId ||
		run.decisionSummary?.winnerByPassingRate === winnerId
	);
};

const findRetrievalComparisonEntry = (
	comparison: RAGRetrievalComparison,
	retrievalId?: string
) => {
	if (!retrievalId) {
		return undefined;
	}

	return comparison.entries.find(
		(entry) => entry.retrievalId === retrievalId
	);
};

const evaluateRetrievalComparisonGate = ({
	delta,
	policy
}: {
	delta?: {
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
		runtimeCandidateBudgetExhaustedCasesDelta?: number;
		runtimeUnderfilledTopKCasesDelta?: number;
	};
	policy?: RAGRetrievalBaselineGatePolicy;
}): RAGRetrievalComparisonGateResult | undefined => {
	if (!delta || !policy) {
		return undefined;
	}

	const reasons: string[] = [];
	if (
		typeof policy.minPassingRateDelta === 'number' &&
		delta.passingRateDelta < policy.minPassingRateDelta
	) {
		reasons.push(
			`passing rate delta ${delta.passingRateDelta} is below ${policy.minPassingRateDelta}`
		);
	}
	if (
		typeof policy.minAverageF1Delta === 'number' &&
		delta.averageF1Delta < policy.minAverageF1Delta
	) {
		reasons.push(
			`average F1 delta ${delta.averageF1Delta} is below ${policy.minAverageF1Delta}`
		);
	}
	if (
		typeof policy.maxElapsedMsDelta === 'number' &&
		delta.elapsedMsDelta > policy.maxElapsedMsDelta
	) {
		reasons.push(
			`elapsed ms delta ${delta.elapsedMsDelta} exceeds ${policy.maxElapsedMsDelta}`
		);
	}
	if (
		typeof policy.minPresentationTitleCueCasesDelta === 'number' &&
		(delta.presentationTitleCueCasesDelta ?? 0) <
			policy.minPresentationTitleCueCasesDelta
	) {
		reasons.push(
			`presentation title cue delta ${delta.presentationTitleCueCasesDelta ?? 0} is below ${policy.minPresentationTitleCueCasesDelta}`
		);
	}
	if (
		typeof policy.minPresentationBodyCueCasesDelta === 'number' &&
		(delta.presentationBodyCueCasesDelta ?? 0) <
			policy.minPresentationBodyCueCasesDelta
	) {
		reasons.push(
			`presentation body cue delta ${delta.presentationBodyCueCasesDelta ?? 0} is below ${policy.minPresentationBodyCueCasesDelta}`
		);
	}
	if (
		typeof policy.minPresentationNotesCueCasesDelta === 'number' &&
		(delta.presentationNotesCueCasesDelta ?? 0) <
			policy.minPresentationNotesCueCasesDelta
	) {
		reasons.push(
			`presentation notes cue delta ${delta.presentationNotesCueCasesDelta ?? 0} is below ${policy.minPresentationNotesCueCasesDelta}`
		);
	}
	if (
		typeof policy.minSpreadsheetSheetCueCasesDelta === 'number' &&
		(delta.spreadsheetSheetCueCasesDelta ?? 0) <
			policy.minSpreadsheetSheetCueCasesDelta
	) {
		reasons.push(
			`spreadsheet sheet cue delta ${delta.spreadsheetSheetCueCasesDelta ?? 0} is below ${policy.minSpreadsheetSheetCueCasesDelta}`
		);
	}
	if (
		typeof policy.minSpreadsheetTableCueCasesDelta === 'number' &&
		(delta.spreadsheetTableCueCasesDelta ?? 0) <
			policy.minSpreadsheetTableCueCasesDelta
	) {
		reasons.push(
			`spreadsheet table cue delta ${delta.spreadsheetTableCueCasesDelta ?? 0} is below ${policy.minSpreadsheetTableCueCasesDelta}`
		);
	}
	if (
		typeof policy.minSpreadsheetColumnCueCasesDelta === 'number' &&
		(delta.spreadsheetColumnCueCasesDelta ?? 0) <
			policy.minSpreadsheetColumnCueCasesDelta
	) {
		reasons.push(
			`spreadsheet column cue delta ${delta.spreadsheetColumnCueCasesDelta ?? 0} is below ${policy.minSpreadsheetColumnCueCasesDelta}`
		);
	}
	if (
		typeof policy.minMultiVectorCollapsedCasesDelta === 'number' &&
		(delta.multiVectorCollapsedCasesDelta ?? 0) <
			policy.minMultiVectorCollapsedCasesDelta
	) {
		reasons.push(
			`multivector collapsed delta ${delta.multiVectorCollapsedCasesDelta ?? 0} is below ${policy.minMultiVectorCollapsedCasesDelta}`
		);
	}
	if (
		typeof policy.minMultiVectorLexicalHitCasesDelta === 'number' &&
		(delta.multiVectorLexicalHitCasesDelta ?? 0) <
			policy.minMultiVectorLexicalHitCasesDelta
	) {
		reasons.push(
			`multivector lexical-hit delta ${delta.multiVectorLexicalHitCasesDelta ?? 0} is below ${policy.minMultiVectorLexicalHitCasesDelta}`
		);
	}
	if (
		typeof policy.minMultiVectorVectorHitCasesDelta === 'number' &&
		(delta.multiVectorVectorHitCasesDelta ?? 0) <
			policy.minMultiVectorVectorHitCasesDelta
	) {
		reasons.push(
			`multivector vector-hit delta ${delta.multiVectorVectorHitCasesDelta ?? 0} is below ${policy.minMultiVectorVectorHitCasesDelta}`
		);
	}
	if (
		typeof policy.minEvidenceReconcileCasesDelta === 'number' &&
		(delta.evidenceReconcileCasesDelta ?? 0) <
			policy.minEvidenceReconcileCasesDelta
	) {
		reasons.push(
			`evidence reconcile delta ${delta.evidenceReconcileCasesDelta ?? 0} is below ${policy.minEvidenceReconcileCasesDelta}`
		);
	}
	if (
		typeof policy.maxRuntimeCandidateBudgetExhaustedCasesDelta ===
			'number' &&
		(delta.runtimeCandidateBudgetExhaustedCasesDelta ?? 0) >
			policy.maxRuntimeCandidateBudgetExhaustedCasesDelta
	) {
		reasons.push(
			`runtime candidate-budget-exhausted delta ${delta.runtimeCandidateBudgetExhaustedCasesDelta ?? 0} exceeds ${policy.maxRuntimeCandidateBudgetExhaustedCasesDelta}`
		);
	}
	if (
		typeof policy.maxRuntimeUnderfilledTopKCasesDelta === 'number' &&
		(delta.runtimeUnderfilledTopKCasesDelta ?? 0) >
			policy.maxRuntimeUnderfilledTopKCasesDelta
	) {
		reasons.push(
			`runtime underfilled-topk delta ${delta.runtimeUnderfilledTopKCasesDelta ?? 0} exceeds ${policy.maxRuntimeUnderfilledTopKCasesDelta}`
		);
	}

	if (reasons.length === 0) {
		return {
			policy,
			reasons: [],
			status: 'pass'
		};
	}

	return {
		policy,
		reasons,
		status: policy.severity === 'warn' ? 'warn' : 'fail'
	};
};

export const buildRAGRetrievalReleaseVerdict = ({
	groupKey,
	decisionSummary
}: {
	groupKey?: string;
	decisionSummary?: RAGRetrievalComparisonDecisionSummary;
}): RAGRetrievalReleaseVerdict | undefined => {
	if (!decisionSummary) {
		return undefined;
	}

	const gate = decisionSummary.gate;
	const delta = decisionSummary.delta;
	const baselineRetrievalId = decisionSummary.baselineRetrievalId;
	const candidateRetrievalId = decisionSummary.candidateRetrievalId;

	if (gate) {
		if (gate.status === 'pass') {
			return {
				baselineGroupKey: groupKey,
				baselineRetrievalId,
				candidateRetrievalId,
				delta,
				gate,
				status: 'pass',
				summary: 'Candidate passed the active baseline gate.'
			};
		}

		return {
			baselineGroupKey: groupKey,
			baselineRetrievalId,
			candidateRetrievalId,
			delta,
			gate,
			status: gate.status,
			summary:
				gate.status === 'warn'
					? 'Candidate triggered a baseline gate warning.'
					: 'Candidate failed the active baseline gate.'
		};
	}

	if (delta) {
		const requiresReview =
			delta.passingRateDelta < 0 ||
			delta.averageF1Delta < 0 ||
			(delta.evidenceReconcileCasesDelta ?? 0) < 0 ||
			(delta.presentationTitleCueCasesDelta ?? 0) < 0 ||
			(delta.presentationBodyCueCasesDelta ?? 0) < 0 ||
			(delta.presentationNotesCueCasesDelta ?? 0) < 0 ||
			(delta.spreadsheetSheetCueCasesDelta ?? 0) < 0 ||
			(delta.spreadsheetTableCueCasesDelta ?? 0) < 0 ||
			(delta.spreadsheetColumnCueCasesDelta ?? 0) < 0;
		return {
			baselineGroupKey: groupKey,
			baselineRetrievalId,
			candidateRetrievalId,
			delta,
			status: requiresReview ? 'needs_review' : 'pass',
			summary: requiresReview
				? 'Candidate should be reviewed before promotion.'
				: 'Candidate improved or matched the baseline.'
		};
	}

	return {
		baselineGroupKey: groupKey,
		baselineRetrievalId,
		candidateRetrievalId,
		status: 'needs_review',
		summary: 'No explicit baseline verdict could be determined.'
	};
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const parseJSONRecord = (value: string | null) => {
	if (value === null) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value);

		return isObjectRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};

const parseJSONArray = <T>(value: string | null, fallback: T[]): T[] => {
	if (value === null) {
		return fallback;
	}

	try {
		const parsed = JSON.parse(value);

		return Array.isArray(parsed) ? (parsed as T[]) : fallback;
	} catch {
		return fallback;
	}
};

const normalizeExpectedIds = (input: string[]) =>
	Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)));

const hasSourceExtension = (
	value: string | undefined,
	extensions: string[]
) => {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();

	return extensions.some((extension) => normalized.endsWith(extension));
};

const hasMetadataNumber = (
	metadata: Record<string, unknown> | undefined,
	key: string
) => typeof metadata?.[key] === 'number';

const hasMetadataString = (
	metadata: Record<string, unknown> | undefined,
	key: string
) => typeof metadata?.[key] === 'string' && metadata[key] !== '';

const hasMetadataArray = (
	metadata: Record<string, unknown> | undefined,
	key: string
) => Array.isArray(metadata?.[key]) && metadata[key].length > 0;

const detectSectionEvidence = (
	ids: string[],
	sources: Array<Pick<RAGSource, 'source' | 'metadata'>> = []
) =>
	sources.some(
		(source) =>
			hasMetadataArray(source.metadata, 'sectionPath') ||
			hasMetadataString(source.metadata, 'sectionTitle') ||
			hasMetadataString(source.metadata, 'sectionKind')
	);

const detectSectionGraphEvidence = (
	sources: Array<Pick<RAGSource, 'source' | 'metadata'>> = []
) =>
	sources.some(
		(source) =>
			hasMetadataString(source.metadata, 'sectionChunkId') ||
			hasMetadataNumber(source.metadata, 'sectionChunkIndex') ||
			(hasMetadataNumber(source.metadata, 'sectionChunkCount') &&
				Number(source.metadata?.sectionChunkCount) > 1)
	);

const detectSectionHierarchyEvidence = (
	sources: Array<Pick<RAGSource, 'source' | 'metadata'>> = []
) =>
	sources.some((source) => {
		const path = Array.isArray(source.metadata?.sectionPath)
			? source.metadata.sectionPath.filter(
					(entry): entry is string =>
						typeof entry === 'string' && entry.trim().length > 0
				)
			: [];

		return path.length > 1;
	});

const detectSpreadsheetEvidence = (
	ids: string[],
	sources: Array<Pick<RAGSource, 'source' | 'metadata'>> = []
) =>
	ids.some((id) =>
		hasSourceExtension(id, ['.xlsx', '.xls', '.csv', '.ods', '.tsv'])
	) ||
	sources.some(
		(source) =>
			hasSourceExtension(source.source, [
				'.xlsx',
				'.xls',
				'.csv',
				'.ods',
				'.tsv'
			]) ||
			hasMetadataString(source.metadata, 'sheetName') ||
			hasMetadataNumber(source.metadata, 'spreadsheetRowStart') ||
			hasMetadataNumber(source.metadata, 'spreadsheetTableIndex')
	);

const detectMediaEvidence = (
	ids: string[],
	sources: Array<Pick<RAGSource, 'source' | 'metadata'>> = []
) =>
	ids.some((id) =>
		hasSourceExtension(id, [
			'.mp3',
			'.wav',
			'.m4a',
			'.aac',
			'.ogg',
			'.flac',
			'.mp4',
			'.mov',
			'.mkv',
			'.webm'
		])
	) ||
	sources.some(
		(source) =>
			hasSourceExtension(source.source, [
				'.mp3',
				'.wav',
				'.m4a',
				'.aac',
				'.ogg',
				'.flac',
				'.mp4',
				'.mov',
				'.mkv',
				'.webm'
			]) ||
			hasMetadataString(source.metadata, 'mediaKind') ||
			hasMetadataString(source.metadata, 'speaker') ||
			hasMetadataNumber(source.metadata, 'startMs')
	);

const detectOCREvidence = (
	ids: string[],
	sources: Array<Pick<RAGSource, 'source' | 'metadata'>> = []
) =>
	ids.some((id) =>
		hasSourceExtension(id, ['.png', '.jpg', '.jpeg', '.webp'])
	) ||
	sources.some(
		(source) =>
			hasSourceExtension(source.source, [
				'.png',
				'.jpg',
				'.jpeg',
				'.webp'
			]) ||
			hasMetadataNumber(source.metadata, 'ocrConfidence') ||
			hasMetadataNumber(source.metadata, 'ocrRegionConfidence') ||
			hasMetadataString(source.metadata, 'ocrEngine') ||
			source.metadata?.pdfTextMode === 'ocr'
	);

const getRetrievalTrace = (
	trace: RAGSearchTraceRecord | RAGRetrievalTrace | undefined
) => (trace && 'trace' in trace ? trace.trace : trace);

const classifyRAGEvaluationFailure = (input: {
	expectedCount: number;
	matchedCount: number;
	missingIds: string[];
	retrievedCount: number;
	retrievedIds: string[];
	retrievedSources?: RAGSource[];
	trace?: RAGSearchTraceRecord | RAGRetrievalTrace;
}): NonNullable<RAGEvaluationCaseResult['failureClasses']> => {
	const classes: NonNullable<RAGEvaluationCaseResult['failureClasses']> = [];
	if (input.expectedCount === 0) {
		classes.push('no_expected_targets');
	}
	if (input.retrievedCount === 0) {
		classes.push('no_results');
	}
	if (input.expectedCount > 0 && input.matchedCount === 0) {
		classes.push('no_match');
	}
	if (
		input.expectedCount > 0 &&
		input.matchedCount > 0 &&
		input.matchedCount < input.expectedCount
	) {
		classes.push('partial_recall');
	}
	if (input.retrievedIds.length > input.matchedCount) {
		classes.push('extra_noise');
	}
	const sourceSignals = input.retrievedSources ?? [];
	const relevantIds = [...input.missingIds, ...input.retrievedIds];
	if (
		(input.missingIds.length > 0 || input.matchedCount === 0) &&
		detectSectionEvidence(relevantIds, sourceSignals)
	) {
		classes.push('section_evidence_miss');
		if (detectSectionGraphEvidence(sourceSignals)) {
			classes.push('section_graph_miss');
		}
		if (detectSectionHierarchyEvidence(sourceSignals)) {
			classes.push('section_hierarchy_miss');
		}
	}
	if (
		(input.missingIds.length > 0 || input.matchedCount === 0) &&
		detectSpreadsheetEvidence(relevantIds, sourceSignals)
	) {
		classes.push('spreadsheet_evidence_miss');
	}
	if (
		(input.missingIds.length > 0 || input.matchedCount === 0) &&
		detectMediaEvidence(relevantIds, sourceSignals)
	) {
		classes.push('media_evidence_miss');
	}
	if (
		(input.missingIds.length > 0 || input.matchedCount === 0) &&
		detectOCREvidence(relevantIds, sourceSignals)
	) {
		classes.push('ocr_evidence_miss');
	}
	const retrievalTrace = getRetrievalTrace(input.trace);
	if (
		(input.retrievedCount === 0 || input.matchedCount === 0) &&
		(retrievalTrace?.routingLabel || retrievalTrace?.routingReason)
	) {
		classes.push('routing_miss');
	}

	return classes;
};

const classifyRAGGroundingFailure = (input: {
	expectedCount: number;
	matchedCount: number;
	missingIds: string[];
	extraIds: string[];
	citationCount: number;
	unresolvedCitationCount: number;
	availableSources?: RAGSource[];
}): NonNullable<RAGAnswerGroundingEvaluationCaseResult['failureClasses']> => {
	const classes: NonNullable<
		RAGAnswerGroundingEvaluationCaseResult['failureClasses']
	> = [];
	if (input.expectedCount === 0) {
		classes.push('no_expected_targets');
	}
	if (input.citationCount === 0) {
		classes.push('no_citations');
	}
	if (input.unresolvedCitationCount > 0) {
		classes.push('unresolved_citations');
	}
	if (
		input.missingIds.length > 0 ||
		input.matchedCount < input.expectedCount
	) {
		classes.push('missing_expected_sources');
	}
	if (input.extraIds.length > 0) {
		classes.push('extra_citations');
	}
	const sourceSignals = input.availableSources ?? [];
	const relevantIds = [...input.missingIds, ...input.extraIds];
	if (
		(input.missingIds.length > 0 || input.citationCount === 0) &&
		detectSectionEvidence(relevantIds, sourceSignals)
	) {
		classes.push('section_source_miss');
		if (detectSectionGraphEvidence(sourceSignals)) {
			classes.push('section_graph_source_miss');
		}
		if (detectSectionHierarchyEvidence(sourceSignals)) {
			classes.push('section_hierarchy_source_miss');
		}
	}
	if (
		(input.missingIds.length > 0 || input.citationCount === 0) &&
		detectSpreadsheetEvidence(relevantIds, sourceSignals)
	) {
		classes.push('spreadsheet_source_miss');
	}
	if (
		(input.missingIds.length > 0 || input.citationCount === 0) &&
		detectMediaEvidence(relevantIds, sourceSignals)
	) {
		classes.push('media_source_miss');
	}
	if (
		(input.missingIds.length > 0 || input.citationCount === 0) &&
		detectOCREvidence(relevantIds, sourceSignals)
	) {
		classes.push('ocr_source_miss');
	}

	return classes;
};

const normalizeSyntheticText = (value: string) =>
	value
		.replace(/^#+\s*/gm, '')
		.replace(/`+/g, '')
		.replace(/\[(.*?)\]\((.*?)\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();

const buildSyntheticEvaluationQuery = (document: RAGIndexedDocument) => {
	const title = normalizeSyntheticText(document.title);
	const sourceTail = normalizeSyntheticText(
		document.source.split('/').at(-1) ?? document.source
	);
	const text = normalizeSyntheticText(document.text ?? '');
	const firstSentence =
		text
			.split(/(?<=[.!?])\s+/)
			.map((entry) => entry.trim())
			.find((entry) => entry.length >= 24) ??
		text
			.split(/\n+/)
			.map((entry) => entry.trim())
			.find((entry) => entry.length >= 24) ??
		title ??
		sourceTail;
	const prefixedSentence =
		title.length > 0 &&
		firstSentence.toLowerCase().startsWith(title.toLowerCase())
			? firstSentence
			: [title, firstSentence].filter(Boolean).join(' ');
	const queryTerms = normalizeSyntheticText(prefixedSentence)
		.split(/\s+/)
		.slice(0, 12)
		.join(' ');

	return queryTerms.length > 0 ? queryTerms : sourceTail;
};

const resolveEvaluationMode = (caseInput: {
	expectedChunkIds?: string[];
	expectedSources?: string[];
	expectedDocumentIds?: string[];
}): 'chunkId' | 'source' | 'documentId' => {
	if (normalizeStringArray(caseInput.expectedChunkIds).length > 0) {
		return 'chunkId';
	}
	if (normalizeStringArray(caseInput.expectedSources).length > 0) {
		return 'source';
	}

	return 'documentId';
};

const getDocumentId = (source: RAGSource): string => {
	const metadataDocumentId =
		typeof source.metadata?.documentId === 'string'
			? source.metadata.documentId
			: undefined;
	if (metadataDocumentId) {
		return metadataDocumentId;
	}
	if (source.source) {
		return source.source;
	}

	const [documentId] = source.chunkId.split(':');

	return documentId ?? source.chunkId;
};

const extractExpectedId = (
	source: RAGSource,
	mode: 'chunkId' | 'source' | 'documentId'
): string =>
	mode === 'chunkId'
		? source.chunkId
		: mode === 'source'
			? (source.source ?? source.title ?? source.chunkId)
			: getDocumentId(source);

const buildSources = (
	results: Array<{
		chunkId: string;
		chunkText: string;
		score: number;
		title?: string;
		source?: string;
		metadata?: Record<string, unknown>;
	}>
) =>
	results.map((result) => ({
		chunkId: result.chunkId,
		metadata: result.metadata,
		score: Number.isFinite(result.score) ? result.score : 0,
		source: result.source,
		text: result.chunkText,
		title: result.title
	}));

const buildAnswerGroundingStatus = ({
	coverage,
	expectedCount,
	matchedCount,
	unresolvedCitationCount,
	resolvedCitationCount
}: {
	coverage: RAGAnswerGroundingEvaluationCaseResult['coverage'];
	expectedCount: number;
	matchedCount: number;
	unresolvedCitationCount: number;
	resolvedCitationCount: number;
}): RAGAnswerGroundingEvaluationCaseResult['status'] => {
	if (expectedCount > 0) {
		if (
			matchedCount === expectedCount &&
			unresolvedCitationCount === 0 &&
			coverage !== 'ungrounded'
		) {
			return 'pass';
		}

		if (matchedCount > 0 || resolvedCitationCount > 0) {
			return 'partial';
		}

		return 'fail';
	}

	if (coverage === 'grounded' && unresolvedCitationCount === 0) {
		return 'pass';
	}

	if (resolvedCitationCount > 0 || coverage === 'partial') {
		return 'partial';
	}

	return 'fail';
};

export const buildRAGEvaluationLeaderboard = (
	runs: RAGEvaluationSuiteRun[]
) => {
	const sorted = [...runs].sort((left, right) => {
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});

	return sorted.map<RAGEvaluationLeaderboardEntry>((run, index) => ({
		averageF1: run.response.summary.averageF1,
		averageLatencyMs: run.response.summary.averageLatencyMs,
		label: run.label,
		passingRate: run.response.passingRate,
		rank: index + 1,
		runId: run.id,
		suiteId: run.suiteId,
		totalCases: run.response.totalCases
	}));
};

export const buildRAGAnswerGroundingEvaluationLeaderboard = (
	runs: RAGAnswerGroundingEvaluationRun[]
) => {
	const sorted = [...runs].sort((left, right) => {
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageCitationF1 !==
			left.response.summary.averageCitationF1
		) {
			return (
				right.response.summary.averageCitationF1 -
				left.response.summary.averageCitationF1
			);
		}
		if (
			right.response.summary.averageResolvedCitationRate !==
			left.response.summary.averageResolvedCitationRate
		) {
			return (
				right.response.summary.averageResolvedCitationRate -
				left.response.summary.averageResolvedCitationRate
			);
		}

		return left.elapsedMs - right.elapsedMs;
	});

	return sorted.map<RAGAnswerGroundingEvaluationLeaderboardEntry>(
		(run, index) => ({
			averageCitationF1: run.response.summary.averageCitationF1,
			averageResolvedCitationRate:
				run.response.summary.averageResolvedCitationRate,
			label: run.label,
			passingRate: run.response.passingRate,
			rank: index + 1,
			runId: run.id,
			suiteId: run.suiteId,
			totalCases: run.response.totalCases
		})
	);
};

const buildTraceStageCounts = (traces: RAGRetrievalTrace[]) => {
	const counts: Partial<
		Record<RAGRetrievalTrace['steps'][number]['stage'], number>
	> = {};

	for (const trace of traces) {
		for (const step of trace.steps) {
			counts[step.stage] = (counts[step.stage] ?? 0) + 1;
		}
	}

	return counts;
};

const diffTraceStageCounts = ({
	current,
	previous
}: {
	current: Partial<
		Record<RAGRetrievalTrace['steps'][number]['stage'], number>
	>;
	previous: Partial<
		Record<RAGRetrievalTrace['steps'][number]['stage'], number>
	>;
}) => {
	const next: Partial<
		Record<RAGRetrievalTrace['steps'][number]['stage'], number>
	> = {};
	const stages = new Set([
		...Object.keys(current),
		...Object.keys(previous)
	] as RAGRetrievalTrace['steps'][number]['stage'][]);

	for (const stage of stages) {
		const delta = (current[stage] ?? 0) - (previous[stage] ?? 0);
		if (delta !== 0) {
			next[stage] = delta;
		}
	}

	return next;
};

const normalizeSummaryList = <T extends string>(values: T[]) =>
	Array.from(new Set(values)).sort();

const buildSummaryListDelta = <T extends string>(
	current: T[],
	previous: T[]
) => {
	const currentSet = new Set(current);
	const previousSet = new Set(previous);
	const added = current.filter((value) => !previousSet.has(value));
	const removed = previous.filter((value) => !currentSet.has(value));

	return {
		added: normalizeSummaryList(Array.from(new Set(added))),
		current: normalizeSummaryList(current),
		previous: normalizeSummaryList(previous),
		removed: normalizeSummaryList(Array.from(new Set(removed)))
	};
};

function summarizeListTurnover<T extends string>(params: {
	current: T[];
	previous: T[];
	history: T[][];
}): RAGTraceSummaryListTrend<T> {
	const { current, previous, history } = params;
	const currentSet = new Set(current);
	const previousSet = new Set(previous);
	const frequency: Record<string, number> = {};

	for (const entry of history) {
		for (const value of entry) {
			frequency[value] = (frequency[value] ?? 0) + 1;
		}
	}

	return {
		appeared: normalizeSummaryList(
			Array.from(
				new Set(current.filter((value) => !previousSet.has(value)))
			)
		),
		current: normalizeSummaryList(current),
		disappeared: normalizeSummaryList(
			Array.from(
				new Set(previous.filter((value) => !currentSet.has(value)))
			)
		),
		frequency,
		previous: normalizeSummaryList(previous),
		stable: normalizeSummaryList(
			Array.from(
				new Set(current.filter((value) => previousSet.has(value)))
			)
		)
	};
}

const diffTraceSummaryStageCounts = ({
	current,
	previous
}: {
	current: RAGRetrievalTraceComparisonSummary['stageCounts'];
	previous: RAGRetrievalTraceComparisonSummary['stageCounts'];
}) => {
	const stages = new Set([
		...Object.keys(current),
		...Object.keys(previous)
	]) as Set<RAGRetrievalTraceStep['stage']>;
	const next: Partial<
		Record<RAGRetrievalTraceStage, RAGTraceSummaryStageCountsDelta>
	> = {};

	for (const stage of stages) {
		const currentCount = current[stage] ?? 0;
		const previousCount = previous[stage] ?? 0;
		const delta = currentCount - previousCount;
		if (delta !== 0 || currentCount !== 0 || previousCount !== 0) {
			next[stage] = {
				current: currentCount,
				delta,
				previous: previousCount
			};
		}
	}

	return next;
};

const roundTraceAverage = (value: number, total: number) =>
	total > 0 ? Number((value / total).toFixed(2)) : 0;

const buildTraceSummaryDirection = (
	delta: number
): RAGTraceSummaryTrendDirection =>
	delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

const buildTraceSummaryAggregate = ({
	summaries
}: {
	summaries: RAGRetrievalTraceComparisonSummary[];
}): {
	aggregate: RAGTraceSummaryNumericDelta[];
	bestMetric: RAGTraceSummaryNumericDelta | undefined;
	worstMetric: RAGTraceSummaryNumericDelta | undefined;
} => {
	if (summaries.length === 0) {
		const aggregate: RAGTraceSummaryNumericDelta[] = [
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'totalCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'averageFinalCount',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'averageVectorCount',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'averageLexicalCount',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'averageCandidateTopK',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'averageLexicalTopK',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'vectorCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'lexicalCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'balancedCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'roundRobinCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'transformedCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'variantCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'multiVectorCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'multiVectorVectorHitCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'multiVectorLexicalHitCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'multiVectorCollapsedCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'runtimeCandidateBudgetExhaustedCases',
				previous: 0
			},
			{
				current: 0,
				delta: 0,
				direction: 'flat',
				metric: 'runtimeUnderfilledTopKCases',
				previous: 0
			}
		];

		return {
			aggregate,
			bestMetric: undefined,
			worstMetric: undefined
		};
	}

	const latest = summaries[0]!;
	const previous = summaries[summaries.length - 1]!;
	const aggregate: RAGTraceSummaryNumericDelta[] = [
		{
			current: latest.totalCases,
			delta: latest.totalCases - previous.totalCases,
			direction: buildTraceSummaryDirection(
				latest.totalCases - previous.totalCases
			),
			metric: 'totalCases',
			previous: previous.totalCases
		},
		{
			current: latest.averageFinalCount,
			delta: latest.averageFinalCount - previous.averageFinalCount,
			direction: buildTraceSummaryDirection(
				latest.averageFinalCount - previous.averageFinalCount
			),
			metric: 'averageFinalCount',
			previous: previous.averageFinalCount
		},
		{
			current: latest.averageVectorCount,
			delta: latest.averageVectorCount - previous.averageVectorCount,
			direction: buildTraceSummaryDirection(
				latest.averageVectorCount - previous.averageVectorCount
			),
			metric: 'averageVectorCount',
			previous: previous.averageVectorCount
		},
		{
			current: latest.averageLexicalCount,
			delta: latest.averageLexicalCount - previous.averageLexicalCount,
			direction: buildTraceSummaryDirection(
				latest.averageLexicalCount - previous.averageLexicalCount
			),
			metric: 'averageLexicalCount',
			previous: previous.averageLexicalCount
		},
		{
			current: latest.averageCandidateTopK,
			delta: latest.averageCandidateTopK - previous.averageCandidateTopK,
			direction: buildTraceSummaryDirection(
				latest.averageCandidateTopK - previous.averageCandidateTopK
			),
			metric: 'averageCandidateTopK',
			previous: previous.averageCandidateTopK
		},
		{
			current: latest.averageLexicalTopK,
			delta: latest.averageLexicalTopK - previous.averageLexicalTopK,
			direction: buildTraceSummaryDirection(
				latest.averageLexicalTopK - previous.averageLexicalTopK
			),
			metric: 'averageLexicalTopK',
			previous: previous.averageLexicalTopK
		},
		{
			current: latest.vectorCases,
			delta: latest.vectorCases - previous.vectorCases,
			direction: buildTraceSummaryDirection(
				latest.vectorCases - previous.vectorCases
			),
			metric: 'vectorCases',
			previous: previous.vectorCases
		},
		{
			current: latest.lexicalCases,
			delta: latest.lexicalCases - previous.lexicalCases,
			direction: buildTraceSummaryDirection(
				latest.lexicalCases - previous.lexicalCases
			),
			metric: 'lexicalCases',
			previous: previous.lexicalCases
		},
		{
			current: latest.balancedCases,
			delta: latest.balancedCases - previous.balancedCases,
			direction: buildTraceSummaryDirection(
				latest.balancedCases - previous.balancedCases
			),
			metric: 'balancedCases',
			previous: previous.balancedCases
		},
		{
			current: latest.roundRobinCases,
			delta: latest.roundRobinCases - previous.roundRobinCases,
			direction: buildTraceSummaryDirection(
				latest.roundRobinCases - previous.roundRobinCases
			),
			metric: 'roundRobinCases',
			previous: previous.roundRobinCases
		},
		{
			current: latest.transformedCases,
			delta: latest.transformedCases - previous.transformedCases,
			direction: buildTraceSummaryDirection(
				latest.transformedCases - previous.transformedCases
			),
			metric: 'transformedCases',
			previous: previous.transformedCases
		},
		{
			current: latest.variantCases,
			delta: latest.variantCases - previous.variantCases,
			direction: buildTraceSummaryDirection(
				latest.variantCases - previous.variantCases
			),
			metric: 'variantCases',
			previous: previous.variantCases
		},
		{
			current: latest.multiVectorCases,
			delta: latest.multiVectorCases - previous.multiVectorCases,
			direction: buildTraceSummaryDirection(
				latest.multiVectorCases - previous.multiVectorCases
			),
			metric: 'multiVectorCases',
			previous: previous.multiVectorCases
		},
		{
			current: latest.multiVectorVectorHitCases,
			delta:
				latest.multiVectorVectorHitCases -
				previous.multiVectorVectorHitCases,
			direction: buildTraceSummaryDirection(
				latest.multiVectorVectorHitCases -
					previous.multiVectorVectorHitCases
			),
			metric: 'multiVectorVectorHitCases',
			previous: previous.multiVectorVectorHitCases
		},
		{
			current: latest.multiVectorLexicalHitCases,
			delta:
				latest.multiVectorLexicalHitCases -
				previous.multiVectorLexicalHitCases,
			direction: buildTraceSummaryDirection(
				latest.multiVectorLexicalHitCases -
					previous.multiVectorLexicalHitCases
			),
			metric: 'multiVectorLexicalHitCases',
			previous: previous.multiVectorLexicalHitCases
		},
		{
			current: latest.multiVectorCollapsedCases,
			delta:
				latest.multiVectorCollapsedCases -
				previous.multiVectorCollapsedCases,
			direction: buildTraceSummaryDirection(
				latest.multiVectorCollapsedCases -
					previous.multiVectorCollapsedCases
			),
			metric: 'multiVectorCollapsedCases',
			previous: previous.multiVectorCollapsedCases
		},
		{
			current: latest.runtimeCandidateBudgetExhaustedCases,
			delta:
				latest.runtimeCandidateBudgetExhaustedCases -
				previous.runtimeCandidateBudgetExhaustedCases,
			direction: buildTraceSummaryDirection(
				latest.runtimeCandidateBudgetExhaustedCases -
					previous.runtimeCandidateBudgetExhaustedCases
			),
			metric: 'runtimeCandidateBudgetExhaustedCases',
			previous: previous.runtimeCandidateBudgetExhaustedCases
		},
		{
			current: latest.runtimeUnderfilledTopKCases,
			delta:
				latest.runtimeUnderfilledTopKCases -
				previous.runtimeUnderfilledTopKCases,
			direction: buildTraceSummaryDirection(
				latest.runtimeUnderfilledTopKCases -
					previous.runtimeUnderfilledTopKCases
			),
			metric: 'runtimeUnderfilledTopKCases',
			previous: previous.runtimeUnderfilledTopKCases
		}
	];
	const absoluteSorted = [...aggregate].sort(
		(left, right) =>
			Math.abs(right.delta) - Math.abs(left.delta) ||
			left.metric.localeCompare(right.metric)
	);

	return {
		aggregate,
		bestMetric: absoluteSorted[0],
		worstMetric: absoluteSorted[absoluteSorted.length - 1]
	};
};

const buildRAGRetrievalTraceStageChurn = ({
	windows
}: {
	windows: RAGRetrievalTraceHistoryWindow[];
}): RAGTraceSummaryStageTrend[] => {
	const stages = new Set<RAGRetrievalTraceStep['stage']>();
	for (const window of windows) {
		for (const stage of Object.keys(window.current.stageCounts) as Array<
			RAGRetrievalTraceStep['stage']
		>) {
			stages.add(stage);
		}
		for (const stage of Object.keys(window.previous.stageCounts) as Array<
			RAGRetrievalTraceStep['stage']
		>) {
			stages.add(stage);
		}
	}

	return [...stages]
		.map((stage) => {
			let netDelta = 0;
			let totalChanges = 0;
			for (const window of windows) {
				const delta = window.delta?.stageCountsDelta[stage]?.delta ?? 0;
				netDelta += delta;
				totalChanges += Math.abs(delta);
			}
			return {
				latestDelta:
					windows[0]?.delta?.stageCountsDelta[stage]?.delta ?? 0,
				netDelta,
				stage,
				totalChanges
			};
		})
		.sort(
			(left, right) =>
				right.totalChanges - left.totalChanges ||
				left.stage.localeCompare(right.stage)
		);
};

const summarizeRetrievalTraces = (
	traces: RAGRetrievalTrace[]
): RAGRetrievalTraceComparisonSummary | undefined => {
	if (traces.length === 0) {
		return undefined;
	}

	const totalCases = traces.length;
	const modeSet = new Set<RAGHybridRetrievalMode>();
	const sourceBalanceStrategySet = new Set<RAGSourceBalanceStrategy>();
	let vectorCases = 0;
	let lexicalCases = 0;
	let balancedCases = 0;
	let roundRobinCases = 0;
	let transformedCases = 0;
	let variantCases = 0;
	let multiVectorCases = 0;
	let multiVectorVectorHitCases = 0;
	let multiVectorLexicalHitCases = 0;
	let multiVectorCollapsedCases = 0;
	let officeEvidenceReconcileCases = 0;
	let officeParagraphEvidenceReconcileCases = 0;
	let officeListEvidenceReconcileCases = 0;
	let officeTableEvidenceReconcileCases = 0;
	let pdfEvidenceReconcileCases = 0;
	let runtimeCandidateBudgetExhaustedCases = 0;
	let runtimeUnderfilledTopKCases = 0;
	let finalCountSum = 0;
	let vectorCountSum = 0;
	let lexicalCountSum = 0;
	let candidateTopKSum = 0;
	let lexicalTopKSum = 0;

	for (const trace of traces) {
		const vectorSearchMetadata = trace.steps.find(
			(step) => step.stage === 'vector_search'
		)?.metadata;
		modeSet.add(trace.mode);
		sourceBalanceStrategySet.add(trace.sourceBalanceStrategy ?? 'cap');
		if (trace.runVector) {
			vectorCases += 1;
		}
		if (trace.runLexical) {
			lexicalCases += 1;
		}
		if (typeof trace.maxResultsPerSource === 'number') {
			balancedCases += 1;
			if (trace.sourceBalanceStrategy === 'round_robin') {
				roundRobinCases += 1;
			}
		}
		if (trace.transformedQuery !== trace.query) {
			transformedCases += 1;
		}
		if (trace.variantQueries.length > 0) {
			variantCases += 1;
		}
		if (trace.multiVector?.configured) {
			multiVectorCases += 1;
		}
		if ((trace.multiVector?.vectorVariantHits ?? 0) > 0) {
			multiVectorVectorHitCases += 1;
		}
		if ((trace.multiVector?.lexicalVariantHits ?? 0) > 0) {
			multiVectorLexicalHitCases += 1;
		}
		if ((trace.multiVector?.collapsedParents ?? 0) > 0) {
			multiVectorCollapsedCases += 1;
		}
		const evidenceReconcileMetadata = trace.steps.find(
			(step) => step.stage === 'evidence_reconcile'
		)?.metadata;
		if (
			typeof evidenceReconcileMetadata?.officeAffectedScopes ===
				'number' &&
			evidenceReconcileMetadata.officeAffectedScopes > 0
		) {
			officeEvidenceReconcileCases += 1;
		}
		if (
			typeof evidenceReconcileMetadata?.officeParagraphAffectedScopes ===
				'number' &&
			evidenceReconcileMetadata.officeParagraphAffectedScopes > 0
		) {
			officeParagraphEvidenceReconcileCases += 1;
		}
		if (
			typeof evidenceReconcileMetadata?.officeListAffectedScopes ===
				'number' &&
			evidenceReconcileMetadata.officeListAffectedScopes > 0
		) {
			officeListEvidenceReconcileCases += 1;
		}
		if (
			typeof evidenceReconcileMetadata?.officeTableAffectedScopes ===
				'number' &&
			evidenceReconcileMetadata.officeTableAffectedScopes > 0
		) {
			officeTableEvidenceReconcileCases += 1;
		}
		if (
			typeof evidenceReconcileMetadata?.pdfAffectedScopes === 'number' &&
			evidenceReconcileMetadata.pdfAffectedScopes > 0
		) {
			pdfEvidenceReconcileCases += 1;
		}
		if (vectorSearchMetadata?.sqliteQueryCandidateBudgetExhausted) {
			runtimeCandidateBudgetExhaustedCases += 1;
		}
		if (vectorSearchMetadata?.postgresQueryCandidateBudgetExhausted) {
			runtimeCandidateBudgetExhaustedCases += 1;
		}
		if (vectorSearchMetadata?.sqliteQueryUnderfilledTopK) {
			runtimeUnderfilledTopKCases += 1;
		}
		if (vectorSearchMetadata?.postgresQueryUnderfilledTopK) {
			runtimeUnderfilledTopKCases += 1;
		}
		finalCountSum += trace.resultCounts.final;
		vectorCountSum += trace.resultCounts.vector;
		lexicalCountSum += trace.resultCounts.lexical;
		candidateTopKSum += trace.candidateTopK;
		lexicalTopKSum += trace.lexicalTopK;
	}

	return {
		averageCandidateTopK: roundTraceAverage(candidateTopKSum, totalCases),
		averageFinalCount: roundTraceAverage(finalCountSum, totalCases),
		averageLexicalCount: roundTraceAverage(lexicalCountSum, totalCases),
		averageLexicalTopK: roundTraceAverage(lexicalTopKSum, totalCases),
		balancedCases,
		averageVectorCount: roundTraceAverage(vectorCountSum, totalCases),
		lexicalCases,
		modes: Array.from(modeSet),
		roundRobinCases,
		sourceBalanceStrategies: Array.from(sourceBalanceStrategySet),
		stageCounts: buildTraceStageCounts(traces),
		totalCases,
		transformedCases,
		variantCases,
		multiVectorCases,
		multiVectorVectorHitCases,
		multiVectorLexicalHitCases,
		multiVectorCollapsedCases,
		officeEvidenceReconcileCases,
		officeParagraphEvidenceReconcileCases,
		officeListEvidenceReconcileCases,
		officeTableEvidenceReconcileCases,
		pdfEvidenceReconcileCases,
		runtimeCandidateBudgetExhaustedCases,
		runtimeUnderfilledTopKCases,
		vectorCases
	};
};

const evaluateRAGCollectionCases = async ({
	collection,
	input,
	defaultTopK = DEFAULT_TOP_K,
	rerank,
	includeTrace = false
}: {
	collection: RAGCollection;
	input: RAGEvaluationInput;
	defaultTopK?: number;
	rerank?: RAGRerankerProviderLike;
	includeTrace?: boolean;
}): Promise<
	Array<{
		caseResult: RAGEvaluationCaseResult;
		trace?: RAGRetrievalTrace;
		filter?: Record<string, unknown>;
		retrieval?: RAGCollectionSearchParams['retrieval'];
		topResult?: RAGQueryResult;
	}>
> => {
	if (input.dryRun) {
		return executeDryRunRAGEvaluation(input, defaultTopK).map(
			(caseResult, caseIndex) => ({
				caseResult,
				filter:
					typeof input.cases?.[caseIndex]?.filter === 'object'
						? input.cases[caseIndex]?.filter
						: input.filter,
				retrieval:
					input.cases?.[caseIndex]?.retrieval ?? input.retrieval,
				topResult: undefined,
				trace: undefined
			})
		);
	}

	return Promise.all(
		input.cases.map(async (caseInput, caseIndex) => {
			const startedAt = Date.now();
			const mode = resolveEvaluationMode(caseInput);
			const query = caseInput.query.trim();
			const expectedIds = normalizeExpectedIds(
				mode === 'chunkId'
					? (caseInput.expectedChunkIds ?? [])
					: mode === 'source'
						? (caseInput.expectedSources ?? [])
						: (caseInput.expectedDocumentIds ?? [])
			);
			const topK =
				typeof caseInput.topK === 'number'
					? caseInput.topK
					: typeof input.topK === 'number'
						? input.topK
						: defaultTopK;
			const searchInput = {
				filter: caseInput.corpusKey
					? {
							...((typeof caseInput.filter === 'object'
								? caseInput.filter
								: input.filter) ?? {}),
							corpusKey: caseInput.corpusKey
						}
					: typeof caseInput.filter === 'object'
						? caseInput.filter
						: input.filter,
				model: caseInput.model ?? input.model,
				query,
				rerank,
				scoreThreshold:
					typeof caseInput.scoreThreshold === 'number'
						? caseInput.scoreThreshold
						: input.scoreThreshold,
				retrieval: caseInput.retrieval ?? input.retrieval,
				topK
			};
			const searchOutcome = includeTrace
				? await collection.searchWithTrace(searchInput)
				: {
						results: await collection.search(searchInput),
						trace: undefined
					};
			const sources = buildSources(searchOutcome.results);
			const elapsedMs = Date.now() - startedAt;
			const retrievedIds = normalizeExpectedIds(
				sources.map((source) => extractExpectedId(source, mode))
			);

			return {
				caseResult: summarizeRAGEvaluationCase({
					caseIndex,
					caseInput: { ...caseInput, topK },
					elapsedMs,
					expectedIds,
					mode,
					query,
					retrievedIds,
					retrievedSources: sources,
					trace: searchOutcome.trace
				}),
				trace: searchOutcome.trace,
				filter: searchInput.filter,
				retrieval: searchInput.retrieval,
				topResult: searchOutcome.results[0]
			};
		})
	);
};

export const buildRAGAnswerGroundingCaseDifficultyLeaderboard = (
	entries: Array<{
		label: string;
		response: RAGAnswerGroundingEvaluationResponse;
	}>
) => {
	const grouped = new Map<
		string,
		{
			caseId: string;
			label?: string;
			query?: string;
			passCount: number;
			partialCount: number;
			failCount: number;
			groundedCount: number;
			totalEvaluations: number;
			totalCitationF1: number;
			totalResolvedCitationRate: number;
		}
	>();

	for (const entry of entries) {
		for (const result of entry.response.cases) {
			const current = grouped.get(result.caseId) ?? {
				caseId: result.caseId,
				failCount: 0,
				groundedCount: 0,
				label: result.label,
				passCount: 0,
				partialCount: 0,
				query: result.query,
				totalCitationF1: 0,
				totalEvaluations: 0,
				totalResolvedCitationRate: 0
			};
			current.label ??= result.label;
			current.query ??= result.query;
			current.totalEvaluations += 1;
			current.totalCitationF1 += result.citationF1;
			current.totalResolvedCitationRate += result.resolvedCitationRate;
			if (result.status === 'pass') {
				current.passCount += 1;
			} else if (result.status === 'partial') {
				current.partialCount += 1;
			} else {
				current.failCount += 1;
			}
			if (result.coverage === 'grounded') {
				current.groundedCount += 1;
			}
			grouped.set(result.caseId, current);
		}
	}

	const ranked = Array.from(grouped.values()).sort((left, right) => {
		const leftPassRate = left.passCount / left.totalEvaluations;
		const rightPassRate = right.passCount / right.totalEvaluations;
		if (leftPassRate !== rightPassRate) {
			return leftPassRate - rightPassRate;
		}
		const leftCitationF1 = left.totalCitationF1 / left.totalEvaluations;
		const rightCitationF1 = right.totalCitationF1 / right.totalEvaluations;
		if (leftCitationF1 !== rightCitationF1) {
			return leftCitationF1 - rightCitationF1;
		}
		const leftResolved =
			left.totalResolvedCitationRate / left.totalEvaluations;
		const rightResolved =
			right.totalResolvedCitationRate / right.totalEvaluations;
		if (leftResolved !== rightResolved) {
			return leftResolved - rightResolved;
		}

		return left.caseId.localeCompare(right.caseId);
	});

	return ranked.map<RAGAnswerGroundingEvaluationCaseDifficultyEntry>(
		(entry, index) => ({
			averageCitationF1: entry.totalCitationF1 / entry.totalEvaluations,
			averageResolvedCitationRate:
				entry.totalResolvedCitationRate / entry.totalEvaluations,
			caseId: entry.caseId,
			failRate: (entry.failCount / entry.totalEvaluations) * 100,
			groundedRate: (entry.groundedCount / entry.totalEvaluations) * 100,
			label: entry.label,
			passRate: (entry.passCount / entry.totalEvaluations) * 100,
			partialRate: (entry.partialCount / entry.totalEvaluations) * 100,
			query: entry.query,
			rank: index + 1,
			totalEvaluations: entry.totalEvaluations
		})
	);
};

const buildGroundingDifficultyDiffEntry = (
	current: RAGAnswerGroundingEvaluationCaseDifficultyEntry,
	previous?: RAGAnswerGroundingEvaluationCaseDifficultyEntry
): RAGAnswerGroundingCaseDifficultyDiffEntry => ({
	caseId: current.caseId,
	currentAverageCitationF1: current.averageCitationF1,
	currentFailRate: current.failRate,
	currentPassRate: current.passRate,
	currentRank: current.rank,
	label: current.label,
	previousAverageCitationF1: previous?.averageCitationF1,
	previousFailRate: previous?.failRate,
	previousPassRate: previous?.passRate,
	previousRank: previous?.rank,
	query: current.query
});

const buildRAGAnswerGroundingCaseDifficultyTrends = ({
	runs
}: {
	runs: RAGAnswerGroundingCaseDifficultyRun[];
}) => {
	const movementCounts = new Map<
		string,
		{
			label?: string;
			harder: number;
			easier: number;
			unchanged: number;
		}
	>();

	for (let index = 0; index < runs.length - 1; index += 1) {
		const current = runs[index];
		const previous = runs[index + 1];
		if (!current || !previous) {
			continue;
		}
		const diff = buildRAGAnswerGroundingCaseDifficultyRunDiff({
			current,
			previous
		});

		for (const entry of diff.harderCases) {
			const currentCounts = movementCounts.get(entry.caseId) ?? {
				easier: 0,
				harder: 0,
				label: entry.label,
				unchanged: 0
			};
			currentCounts.harder += 1;
			currentCounts.label ??= entry.label;
			movementCounts.set(entry.caseId, currentCounts);
		}

		for (const entry of diff.easierCases) {
			const currentCounts = movementCounts.get(entry.caseId) ?? {
				easier: 0,
				harder: 0,
				label: entry.label,
				unchanged: 0
			};
			currentCounts.easier += 1;
			currentCounts.label ??= entry.label;
			movementCounts.set(entry.caseId, currentCounts);
		}

		for (const entry of diff.unchangedCases) {
			const currentCounts = movementCounts.get(entry.caseId) ?? {
				easier: 0,
				harder: 0,
				label: entry.label,
				unchanged: 0
			};
			currentCounts.unchanged += 1;
			currentCounts.label ??= entry.label;
			movementCounts.set(entry.caseId, currentCounts);
		}
	}

	const movementEntries = [...movementCounts.entries()];
	const mostOftenHarderCaseIds = movementEntries
		.filter(([, counts]) => counts.harder > 0)
		.sort((left, right) => {
			if (right[1].harder !== left[1].harder) {
				return right[1].harder - left[1].harder;
			}
			return left[0].localeCompare(right[0]);
		})
		.map(([caseId]) => caseId);
	const mostOftenEasierCaseIds = movementEntries
		.filter(([, counts]) => counts.easier > 0)
		.sort((left, right) => {
			if (right[1].easier !== left[1].easier) {
				return right[1].easier - left[1].easier;
			}
			return left[0].localeCompare(right[0]);
		})
		.map(([caseId]) => caseId);

	return {
		easiestCaseIds:
			runs[runs.length - 1]?.entries
				.map((entry) => entry.caseId)
				.reverse() ?? [],
		hardestCaseIds: runs[0]?.entries.map((entry) => entry.caseId) ?? [],
		mostOftenEasierCaseIds,
		mostOftenHarderCaseIds,
		movementCounts: Object.fromEntries(
			movementEntries.map(([caseId, counts]) => [
				caseId,
				{
					easier: counts.easier,
					harder: counts.harder,
					unchanged: counts.unchanged
				}
			])
		)
	};
};

export const buildRAGAnswerGroundingCaseDifficultyRunDiff = ({
	current,
	previous
}: {
	current: RAGAnswerGroundingCaseDifficultyRun;
	previous?: RAGAnswerGroundingCaseDifficultyRun;
}): RAGAnswerGroundingCaseDifficultyRunDiff => {
	const previousEntries = new Map(
		(previous?.entries ?? []).map((entry) => [entry.caseId, entry])
	);
	const diffs = current.entries.map((entry) =>
		buildGroundingDifficultyDiffEntry(
			entry,
			previousEntries.get(entry.caseId)
		)
	);

	return {
		currentRunId: current.id,
		easierCases: diffs.filter((entry) => {
			const previousRank = entry.previousRank ?? entry.currentRank;
			return entry.currentRank > previousRank;
		}),
		harderCases: diffs.filter((entry) => {
			const previousRank = entry.previousRank ?? Number.MAX_SAFE_INTEGER;
			return entry.currentRank < previousRank;
		}),
		previousRunId: previous?.id,
		suiteId: current.suiteId,
		unchangedCases: diffs.filter((entry) => {
			const previousRank = entry.previousRank ?? entry.currentRank;
			return entry.currentRank === previousRank;
		})
	};
};

const toHistorySortOrder = (
	left: RAGEvaluationSuiteRun,
	right: RAGEvaluationSuiteRun
) => right.finishedAt - left.finishedAt;

const normalizeHistoryRuns = (runs: RAGEvaluationSuiteRun[]) =>
	[...runs].sort(toHistorySortOrder);

const normalizeRetrievalComparisonRuns = (runs: RAGRetrievalComparisonRun[]) =>
	[...runs].sort((left, right) => right.finishedAt - left.finishedAt);

const toTraceSummaryRunSortOrder = (
	left: RAGRetrievalTraceSummaryRun,
	right: RAGRetrievalTraceSummaryRun
) => right.finishedAt - left.finishedAt;

const normalizeTraceSummaryRuns = <TRun extends RAGRetrievalTraceSummaryRun>(
	runs: TRun[]
) => [...runs].sort(toTraceSummaryRunSortOrder);

const applyRAGEvaluationHistoryPrunePolicy = <
	TRun extends {
		id: string;
		suiteId: string;
		finishedAt?: number;
		createdAt?: number;
	}
>({
	input,
	runs,
	sort
}: {
	input?: RAGEvaluationHistoryPruneInput;
	runs: TRun[];
	sort: (runs: TRun[]) => TRun[];
}): {
	next: TRun[];
	removed: TRun[];
	keptCount: number;
	removedCount: number;
} => {
	const sorted = sort(runs);
	const targeted = sorted.filter(
		(run) => !input?.suiteId || run.suiteId === input.suiteId
	);
	const untouched = sorted.filter(
		(run) => input?.suiteId && run.suiteId !== input.suiteId
	);
	const now = input?.now ?? Date.now();
	let kept = [...targeted];

	if (
		typeof input?.maxAgeMs === 'number' &&
		Number.isFinite(input.maxAgeMs)
	) {
		const cutoff = now - input.maxAgeMs;
		kept = kept.filter((run) => {
			const timestamp = run.finishedAt ?? run.createdAt ?? 0;
			return timestamp >= cutoff;
		});
	}

	if (
		typeof input?.maxRunsPerSuite === 'number' &&
		Number.isFinite(input.maxRunsPerSuite) &&
		input.maxRunsPerSuite >= 0
	) {
		const remainingBySuite = new Map<string, number>();
		kept = kept.filter((run) => {
			const current = remainingBySuite.get(run.suiteId) ?? 0;
			if (current >= input.maxRunsPerSuite!) {
				return false;
			}
			remainingBySuite.set(run.suiteId, current + 1);
			return true;
		});
	}

	const keptIds = new Set(kept.map((run) => run.id));
	const removed = targeted.filter((run) => !keptIds.has(run.id));
	const next = sort([...untouched, ...kept]);

	return {
		keptCount: next.length,
		next,
		removed,
		removedCount: removed.length
	};
};

const applyRAGSearchTracePrunePolicy = ({
	input,
	traces
}: {
	input?: RAGSearchTracePruneInput;
	traces: RAGSearchTraceRecord[];
}) => {
	const sorted = normalizeTraceSummaryRuns(traces);
	const matchesTag = (trace: RAGSearchTraceRecord) =>
		!input?.tag || (trace.tags ?? []).includes(input.tag);
	const targeted = sorted.filter(matchesTag);
	const untouched = sorted.filter((trace) => !matchesTag(trace));
	const now = input?.now ?? Date.now();
	let kept = [...targeted];

	if (
		typeof input?.maxAgeMs === 'number' &&
		Number.isFinite(input.maxAgeMs)
	) {
		const cutoff = now - input.maxAgeMs;
		kept = kept.filter((trace) => trace.finishedAt >= cutoff);
	}

	if (
		typeof input?.maxRecordsPerQuery === 'number' &&
		Number.isFinite(input.maxRecordsPerQuery) &&
		input.maxRecordsPerQuery >= 0
	) {
		const remainingByQuery = new Map<string, number>();
		kept = kept.filter((trace) => {
			const current = remainingByQuery.get(trace.query) ?? 0;
			if (current >= input.maxRecordsPerQuery!) {
				return false;
			}
			remainingByQuery.set(trace.query, current + 1);
			return true;
		});
	}

	if (
		typeof input?.maxRecordsPerGroup === 'number' &&
		Number.isFinite(input.maxRecordsPerGroup) &&
		input.maxRecordsPerGroup >= 0
	) {
		const remainingByGroup = new Map<string, number>();
		kept = kept.filter((trace) => {
			if (!trace.groupKey) {
				return true;
			}

			const current = remainingByGroup.get(trace.groupKey) ?? 0;
			if (current >= input.maxRecordsPerGroup!) {
				return false;
			}
			remainingByGroup.set(trace.groupKey, current + 1);
			return true;
		});
	}

	const keptIds = new Set(kept.map((trace) => trace.id));
	const removed = targeted.filter((trace) => !keptIds.has(trace.id));
	const next = normalizeTraceSummaryRuns([...untouched, ...kept]);

	return {
		keptCount: next.length,
		next,
		removed,
		removedCount: removed.length
	};
};

const buildRAGSearchTraceStatsFromTraces = (
	traces: RAGSearchTraceRecord[]
): RAGSearchTraceStats => {
	const queryKeys = new Set<string>();
	const groupKeys = new Set<string>();
	const tagCounts = new Map<string, number>();
	let oldestFinishedAt: number | undefined;
	let newestFinishedAt: number | undefined;

	for (const trace of traces) {
		queryKeys.add(trace.query);
		if (trace.groupKey) {
			groupKeys.add(trace.groupKey);
		}
		for (const tag of trace.tags ?? []) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
		oldestFinishedAt =
			typeof oldestFinishedAt === 'number'
				? Math.min(oldestFinishedAt, trace.finishedAt)
				: trace.finishedAt;
		newestFinishedAt =
			typeof newestFinishedAt === 'number'
				? Math.max(newestFinishedAt, trace.finishedAt)
				: trace.finishedAt;
	}

	return {
		groupCount: groupKeys.size,
		newestFinishedAt,
		oldestFinishedAt,
		queryCount: queryKeys.size,
		tagCounts: Object.fromEntries(tagCounts.entries()),
		totalTraces: traces.length
	};
};

const normalizeTraceTags = (tags?: string[]) =>
	Array.from(
		new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))
	).sort((left, right) => left.localeCompare(right));

const toGroundingHistorySortOrder = (
	left: RAGAnswerGroundingEvaluationRun,
	right: RAGAnswerGroundingEvaluationRun
) => right.finishedAt - left.finishedAt;

const normalizeGroundingHistoryRuns = (
	runs: RAGAnswerGroundingEvaluationRun[]
) => [...runs].sort(toGroundingHistorySortOrder);

const toSearchTracePruneRunSortOrder = (
	left: RAGSearchTracePruneRun,
	right: RAGSearchTracePruneRun
) => right.finishedAt - left.finishedAt;

const normalizeSearchTracePruneRuns = (runs: RAGSearchTracePruneRun[]) =>
	[...runs].sort(toSearchTracePruneRunSortOrder);

const toGroundingDifficultyHistorySortOrder = (
	left: RAGAnswerGroundingCaseDifficultyRun,
	right: RAGAnswerGroundingCaseDifficultyRun
) => right.finishedAt - left.finishedAt;

const normalizeGroundingDifficultyHistoryRuns = (
	runs: RAGAnswerGroundingCaseDifficultyRun[]
) => [...runs].sort(toGroundingDifficultyHistorySortOrder);

const buildCaseDiff = (
	currentCase: RAGEvaluationCaseResult,
	previousCase?: RAGEvaluationCaseResult
): RAGEvaluationCaseDiff => ({
	caseId: currentCase.caseId,
	currentF1: currentCase.f1,
	currentMatchedIds: currentCase.matchedIds,
	currentMissingIds: currentCase.missingIds,
	currentStatus: currentCase.status,
	label: currentCase.label,
	previousF1: previousCase?.f1,
	previousMatchedIds: previousCase?.matchedIds ?? [],
	previousMissingIds: previousCase?.missingIds ?? [],
	previousStatus: previousCase?.status,
	previousFailureClasses: previousCase?.failureClasses ?? [],
	query: currentCase.query,
	currentFailureClasses: currentCase.failureClasses ?? []
});

const buildGroundingCaseDiff = (
	currentCase: RAGAnswerGroundingEvaluationCaseResult,
	previousCase?: RAGAnswerGroundingEvaluationCaseResult
): RAGAnswerGroundingEvaluationCaseDiff => ({
	answerChanged:
		typeof previousCase?.answer === 'string'
			? previousCase.answer !== currentCase.answer
			: true,
	caseId: currentCase.caseId,
	currentCitationF1: currentCase.citationF1,
	currentCitedIds: currentCase.citedIds,
	currentCoverage: currentCase.coverage,
	currentExtraIds: currentCase.extraIds,
	currentMatchedIds: currentCase.matchedIds,
	currentMissingIds: currentCase.missingIds,
	currentReferenceCount: currentCase.referenceCount,
	currentResolvedCitationCount: currentCase.resolvedCitationCount,
	currentAnswer: currentCase.answer,
	currentStatus: currentCase.status,
	currentUngroundedReferenceNumbers:
		currentCase.groundedAnswer.ungroundedReferenceNumbers,
	currentUnresolvedCitationCount: currentCase.unresolvedCitationCount,
	label: currentCase.label,
	previousAnswer: previousCase?.answer,
	previousCitationF1: previousCase?.citationF1,
	previousCitedIds: previousCase?.citedIds ?? [],
	previousCoverage: previousCase?.coverage,
	previousExtraIds: previousCase?.extraIds ?? [],
	previousFailureClasses: previousCase?.failureClasses ?? [],
	previousMatchedIds: previousCase?.matchedIds ?? [],
	previousMissingIds: previousCase?.missingIds ?? [],
	previousReferenceCount: previousCase?.referenceCount,
	previousResolvedCitationCount: previousCase?.resolvedCitationCount,
	previousStatus: previousCase?.status,
	previousUngroundedReferenceNumbers:
		previousCase?.groundedAnswer.ungroundedReferenceNumbers ?? [],
	previousUnresolvedCitationCount: previousCase?.unresolvedCitationCount,
	query: currentCase.query,
	currentFailureClasses: currentCase.failureClasses ?? []
});

const buildGroundingCaseSnapshots = ({
	current,
	previous
}: {
	current?: RAGAnswerGroundingEvaluationRun;
	previous?: RAGAnswerGroundingEvaluationRun;
}): RAGAnswerGroundingEvaluationCaseSnapshot[] => {
	if (!current) {
		return [];
	}

	const previousCases = new Map(
		(previous?.response.cases ?? []).map((entry) => [entry.caseId, entry])
	);

	return current.response.cases.map((entry) => {
		const previousCase = previousCases.get(entry.caseId);
		return {
			answer: entry.answer,
			answerChange:
				typeof previousCase?.answer === 'string'
					? previousCase.answer === entry.answer
						? 'unchanged'
						: 'changed'
					: 'new',
			caseId: entry.caseId,
			citationCount: entry.citationCount,
			citationF1: entry.citationF1,
			citedIds: entry.citedIds,
			coverage: entry.coverage,
			extraIds: entry.extraIds,
			failureClasses: entry.failureClasses,
			label: entry.label,
			matchedIds: entry.matchedIds,
			missingIds: entry.missingIds,
			previousAnswer: previousCase?.answer,
			query: entry.query,
			referenceCount: entry.referenceCount,
			resolvedCitationCount: entry.resolvedCitationCount,
			resolvedCitationRate: entry.resolvedCitationRate,
			status: entry.status,
			ungroundedReferenceNumbers:
				entry.groundedAnswer.ungroundedReferenceNumbers,
			unresolvedCitationCount: entry.unresolvedCitationCount
		};
	});
};

const areStageCountsEqual = (
	left: Partial<Record<RAGRetrievalTraceStage, number>>,
	right: Partial<Record<RAGRetrievalTraceStage, number>>
) => {
	const keys = new Set([
		...Object.keys(left),
		...Object.keys(right)
	]) as Set<RAGRetrievalTraceStage>;

	for (const key of keys) {
		if ((left[key] ?? 0) !== (right[key] ?? 0)) {
			return false;
		}
	}

	return true;
};

const buildEvaluationCaseTraceSnapshot = ({
	caseResult,
	filter,
	retrieval,
	currentTrace,
	previousTrace,
	currentSnapshot,
	topResult
}: {
	caseResult: RAGEvaluationCaseResult;
	filter?: Record<string, unknown>;
	retrieval?: RAGCollectionSearchParams['retrieval'];
	currentTrace?: RAGRetrievalTrace;
	previousTrace?: RAGEvaluationCaseTraceSnapshot;
	currentSnapshot?: RAGEvaluationCaseTraceSnapshot;
	topResult?: RAGQueryResult;
}): RAGEvaluationCaseTraceSnapshot => {
	const stageCounts = currentTrace
		? buildTraceStageCounts([currentTrace])
		: {};
	const previousStageCounts = previousTrace?.stageCounts ?? {};
	const currentLeadSnapshot =
		topResult || currentSnapshot
			? buildEvaluationLeadSnapshot({
					metadata: topResult?.metadata,
					source: topResult?.source,
					title: topResult?.title
				})
			: {};
	const topContextLabel =
		currentLeadSnapshot.topContextLabel ?? currentSnapshot?.topContextLabel;
	const topLocatorLabel =
		currentLeadSnapshot.topLocatorLabel ?? currentSnapshot?.topLocatorLabel;
	const sourceAwareChunkReasonLabel =
		currentLeadSnapshot.sourceAwareChunkReasonLabel ??
		currentSnapshot?.sourceAwareChunkReasonLabel;
	const sourceAwareUnitScopeLabel =
		currentLeadSnapshot.sourceAwareUnitScopeLabel ??
		currentSnapshot?.sourceAwareUnitScopeLabel;
	const currentLeadMediaCueSnapshot = currentTrace
		? buildEvaluationLeadMediaCueSnapshot(currentTrace)
		: {};
	const currentLeadPresentationCueSnapshot = currentTrace
		? buildEvaluationLeadPresentationCueSnapshot(currentTrace)
		: {};
	const currentLeadSpreadsheetCueSnapshot = currentTrace
		? buildEvaluationLeadSpreadsheetCueSnapshot(currentTrace)
		: {};
	const currentSQLiteQueryPlanSnapshot = currentTrace
		? buildEvaluationSQLiteQueryPlanSnapshot(currentTrace)
		: {};
	const currentPostgresQueryPlanSnapshot = currentTrace
		? buildEvaluationPostgresQueryPlanSnapshot(currentTrace)
		: {};
	const leadSpeakerCue =
		currentLeadMediaCueSnapshot.leadSpeakerCue ??
		currentSnapshot?.leadSpeakerCue;
	const leadPresentationCue =
		currentLeadPresentationCueSnapshot.leadPresentationCue ??
		currentSnapshot?.leadPresentationCue;
	const leadSpreadsheetCue =
		currentLeadSpreadsheetCueSnapshot.leadSpreadsheetCue ??
		currentSnapshot?.leadSpreadsheetCue;
	const leadSpeakerAttributionCue =
		currentLeadMediaCueSnapshot.leadSpeakerAttributionCue ??
		currentSnapshot?.leadSpeakerAttributionCue;
	const leadChannelCue =
		currentLeadMediaCueSnapshot.leadChannelCue ??
		currentSnapshot?.leadChannelCue;
	const leadChannelAttributionCue =
		currentLeadMediaCueSnapshot.leadChannelAttributionCue ??
		currentSnapshot?.leadChannelAttributionCue;
	const leadContinuityCue =
		currentLeadMediaCueSnapshot.leadContinuityCue ??
		currentSnapshot?.leadContinuityCue;
	const sqliteQueryMode =
		currentSQLiteQueryPlanSnapshot.sqliteQueryMode ??
		currentSnapshot?.sqliteQueryMode;
	const sqliteQueryPushdownMode =
		currentSQLiteQueryPlanSnapshot.sqliteQueryPushdownMode ??
		currentSnapshot?.sqliteQueryPushdownMode;
	const sqliteQueryPushdownApplied =
		currentSQLiteQueryPlanSnapshot.sqliteQueryPushdownApplied ??
		currentSnapshot?.sqliteQueryPushdownApplied;
	const sqliteQueryPushdownClauseCount =
		currentSQLiteQueryPlanSnapshot.sqliteQueryPushdownClauseCount ??
		currentSnapshot?.sqliteQueryPushdownClauseCount;
	const sqliteQueryTotalFilterClauseCount =
		currentSQLiteQueryPlanSnapshot.sqliteQueryTotalFilterClauseCount ??
		currentSnapshot?.sqliteQueryTotalFilterClauseCount;
	const sqliteQueryJsRemainderClauseCount =
		currentSQLiteQueryPlanSnapshot.sqliteQueryJsRemainderClauseCount ??
		currentSnapshot?.sqliteQueryJsRemainderClauseCount;
	const sqliteQueryMultiplierUsed =
		currentSQLiteQueryPlanSnapshot.sqliteQueryMultiplierUsed ??
		currentSnapshot?.sqliteQueryMultiplierUsed;
	const sqliteQueryCandidateLimitUsed =
		currentSQLiteQueryPlanSnapshot.sqliteQueryCandidateLimitUsed ??
		currentSnapshot?.sqliteQueryCandidateLimitUsed;
	const sqliteQueryMaxBackfillsUsed =
		currentSQLiteQueryPlanSnapshot.sqliteQueryMaxBackfillsUsed ??
		currentSnapshot?.sqliteQueryMaxBackfillsUsed;
	const sqliteQueryMinResultsUsed =
		currentSQLiteQueryPlanSnapshot.sqliteQueryMinResultsUsed ??
		currentSnapshot?.sqliteQueryMinResultsUsed;
	const sqliteQueryFillPolicyUsed =
		currentSQLiteQueryPlanSnapshot.sqliteQueryFillPolicyUsed ??
		currentSnapshot?.sqliteQueryFillPolicyUsed;
	const sqliteQueryPushdownCoverageRatio =
		currentSQLiteQueryPlanSnapshot.sqliteQueryPushdownCoverageRatio ??
		currentSnapshot?.sqliteQueryPushdownCoverageRatio;
	const sqliteQueryJsRemainderRatio =
		currentSQLiteQueryPlanSnapshot.sqliteQueryJsRemainderRatio ??
		currentSnapshot?.sqliteQueryJsRemainderRatio;
	const sqliteQueryFilteredCandidates =
		currentSQLiteQueryPlanSnapshot.sqliteQueryFilteredCandidates ??
		currentSnapshot?.sqliteQueryFilteredCandidates;
	const sqliteQueryInitialSearchK =
		currentSQLiteQueryPlanSnapshot.sqliteQueryInitialSearchK ??
		currentSnapshot?.sqliteQueryInitialSearchK;
	const sqliteQueryFinalSearchK =
		currentSQLiteQueryPlanSnapshot.sqliteQueryFinalSearchK ??
		currentSnapshot?.sqliteQueryFinalSearchK;
	const sqliteQuerySearchExpansionRatio =
		currentSQLiteQueryPlanSnapshot.sqliteQuerySearchExpansionRatio ??
		currentSnapshot?.sqliteQuerySearchExpansionRatio;
	const sqliteQueryBackfillCount =
		currentSQLiteQueryPlanSnapshot.sqliteQueryBackfillCount ??
		currentSnapshot?.sqliteQueryBackfillCount;
	const sqliteQueryBackfillLimitReached =
		currentSQLiteQueryPlanSnapshot.sqliteQueryBackfillLimitReached ??
		currentSnapshot?.sqliteQueryBackfillLimitReached;
	const sqliteQueryMinResultsSatisfied =
		currentSQLiteQueryPlanSnapshot.sqliteQueryMinResultsSatisfied ??
		currentSnapshot?.sqliteQueryMinResultsSatisfied;
	const sqliteQueryReturnedCount =
		currentSQLiteQueryPlanSnapshot.sqliteQueryReturnedCount ??
		currentSnapshot?.sqliteQueryReturnedCount;
	const sqliteQueryCandidateYieldRatio =
		currentSQLiteQueryPlanSnapshot.sqliteQueryCandidateYieldRatio ??
		currentSnapshot?.sqliteQueryCandidateYieldRatio;
	const sqliteQueryTopKFillRatio =
		currentSQLiteQueryPlanSnapshot.sqliteQueryTopKFillRatio ??
		currentSnapshot?.sqliteQueryTopKFillRatio;
	const sqliteQueryUnderfilledTopK =
		currentSQLiteQueryPlanSnapshot.sqliteQueryUnderfilledTopK ??
		currentSnapshot?.sqliteQueryUnderfilledTopK;
	const sqliteQueryCandidateBudgetExhausted =
		currentSQLiteQueryPlanSnapshot.sqliteQueryCandidateBudgetExhausted ??
		currentSnapshot?.sqliteQueryCandidateBudgetExhausted;
	const sqliteQueryCandidateCoverage =
		currentSQLiteQueryPlanSnapshot.sqliteQueryCandidateCoverage ??
		currentSnapshot?.sqliteQueryCandidateCoverage;
	const postgresQueryMode =
		currentPostgresQueryPlanSnapshot.postgresQueryMode ??
		currentSnapshot?.postgresQueryMode;
	const postgresQueryPushdownMode =
		currentPostgresQueryPlanSnapshot.postgresQueryPushdownMode ??
		currentSnapshot?.postgresQueryPushdownMode;
	const postgresQueryPushdownApplied =
		currentPostgresQueryPlanSnapshot.postgresQueryPushdownApplied ??
		currentSnapshot?.postgresQueryPushdownApplied;
	const postgresQueryPushdownClauseCount =
		currentPostgresQueryPlanSnapshot.postgresQueryPushdownClauseCount ??
		currentSnapshot?.postgresQueryPushdownClauseCount;
	const postgresQueryTotalFilterClauseCount =
		currentPostgresQueryPlanSnapshot.postgresQueryTotalFilterClauseCount ??
		currentSnapshot?.postgresQueryTotalFilterClauseCount;
	const postgresQueryJsRemainderClauseCount =
		currentPostgresQueryPlanSnapshot.postgresQueryJsRemainderClauseCount ??
		currentSnapshot?.postgresQueryJsRemainderClauseCount;
	const postgresQueryMultiplierUsed =
		currentPostgresQueryPlanSnapshot.postgresQueryMultiplierUsed ??
		currentSnapshot?.postgresQueryMultiplierUsed;
	const postgresQueryCandidateLimitUsed =
		currentPostgresQueryPlanSnapshot.postgresQueryCandidateLimitUsed ??
		currentSnapshot?.postgresQueryCandidateLimitUsed;
	const postgresQueryMaxBackfillsUsed =
		currentPostgresQueryPlanSnapshot.postgresQueryMaxBackfillsUsed ??
		currentSnapshot?.postgresQueryMaxBackfillsUsed;
	const postgresQueryMinResultsUsed =
		currentPostgresQueryPlanSnapshot.postgresQueryMinResultsUsed ??
		currentSnapshot?.postgresQueryMinResultsUsed;
	const postgresQueryFillPolicyUsed =
		currentPostgresQueryPlanSnapshot.postgresQueryFillPolicyUsed ??
		currentSnapshot?.postgresQueryFillPolicyUsed;
	const postgresQueryPushdownCoverageRatio =
		currentPostgresQueryPlanSnapshot.postgresQueryPushdownCoverageRatio ??
		currentSnapshot?.postgresQueryPushdownCoverageRatio;
	const postgresQueryJsRemainderRatio =
		currentPostgresQueryPlanSnapshot.postgresQueryJsRemainderRatio ??
		currentSnapshot?.postgresQueryJsRemainderRatio;
	const postgresQueryFilteredCandidates =
		currentPostgresQueryPlanSnapshot.postgresQueryFilteredCandidates ??
		currentSnapshot?.postgresQueryFilteredCandidates;
	const postgresQueryInitialSearchK =
		currentPostgresQueryPlanSnapshot.postgresQueryInitialSearchK ??
		currentSnapshot?.postgresQueryInitialSearchK;
	const postgresQueryFinalSearchK =
		currentPostgresQueryPlanSnapshot.postgresQueryFinalSearchK ??
		currentSnapshot?.postgresQueryFinalSearchK;
	const postgresQuerySearchExpansionRatio =
		currentPostgresQueryPlanSnapshot.postgresQuerySearchExpansionRatio ??
		currentSnapshot?.postgresQuerySearchExpansionRatio;
	const postgresQueryBackfillCount =
		currentPostgresQueryPlanSnapshot.postgresQueryBackfillCount ??
		currentSnapshot?.postgresQueryBackfillCount;
	const postgresQueryBackfillLimitReached =
		currentPostgresQueryPlanSnapshot.postgresQueryBackfillLimitReached ??
		currentSnapshot?.postgresQueryBackfillLimitReached;
	const postgresQueryMinResultsSatisfied =
		currentPostgresQueryPlanSnapshot.postgresQueryMinResultsSatisfied ??
		currentSnapshot?.postgresQueryMinResultsSatisfied;
	const postgresQueryReturnedCount =
		currentPostgresQueryPlanSnapshot.postgresQueryReturnedCount ??
		currentSnapshot?.postgresQueryReturnedCount;
	const postgresQueryCandidateYieldRatio =
		currentPostgresQueryPlanSnapshot.postgresQueryCandidateYieldRatio ??
		currentSnapshot?.postgresQueryCandidateYieldRatio;
	const postgresQueryTopKFillRatio =
		currentPostgresQueryPlanSnapshot.postgresQueryTopKFillRatio ??
		currentSnapshot?.postgresQueryTopKFillRatio;
	const postgresQueryUnderfilledTopK =
		currentPostgresQueryPlanSnapshot.postgresQueryUnderfilledTopK ??
		currentSnapshot?.postgresQueryUnderfilledTopK;
	const postgresQueryCandidateBudgetExhausted =
		currentPostgresQueryPlanSnapshot.postgresQueryCandidateBudgetExhausted ??
		currentSnapshot?.postgresQueryCandidateBudgetExhausted;
	const postgresQueryCandidateCoverage =
		currentPostgresQueryPlanSnapshot.postgresQueryCandidateCoverage ??
		currentSnapshot?.postgresQueryCandidateCoverage;
	const currentFilterSignature = JSON.stringify(filter ?? undefined);
	const previousFilterSignature = JSON.stringify(
		previousTrace?.inputFilter ?? undefined
	);
	const currentRetrievalSignature = JSON.stringify(retrieval ?? undefined);
	const previousRetrievalSignature = JSON.stringify(
		previousTrace?.inputRetrieval ?? undefined
	);
	const traceChange = !previousTrace
		? currentTrace
			? 'new'
			: 'unchanged'
		: previousTrace.traceMode !== currentTrace?.mode ||
			  previousFilterSignature !== currentFilterSignature ||
			  previousRetrievalSignature !== currentRetrievalSignature ||
			  previousTrace.sourceBalanceStrategy !==
					currentTrace?.sourceBalanceStrategy ||
			  previousTrace.transformedQuery !==
					(currentTrace?.transformedQuery || undefined) ||
			  previousTrace.variantQueries.join('|') !==
					(currentTrace?.variantQueries ?? []).join('|') ||
			  previousTrace.finalCount !==
					(currentTrace?.resultCounts.final ?? 0) ||
			  previousTrace.vectorCount !==
					(currentTrace?.resultCounts.vector ?? 0) ||
			  previousTrace.lexicalCount !==
					(currentTrace?.resultCounts.lexical ?? 0) ||
			  previousTrace.candidateTopK !==
					(currentTrace?.candidateTopK ?? 0) ||
			  previousTrace.lexicalTopK !== (currentTrace?.lexicalTopK ?? 0) ||
			  previousTrace.topContextLabel !== topContextLabel ||
			  previousTrace.topLocatorLabel !== topLocatorLabel ||
			  previousTrace.sourceAwareChunkReasonLabel !==
					sourceAwareChunkReasonLabel ||
			  previousTrace.sourceAwareUnitScopeLabel !==
					sourceAwareUnitScopeLabel ||
			  previousTrace.leadSpeakerCue !== leadSpeakerCue ||
			  previousTrace.leadPresentationCue !== leadPresentationCue ||
			  previousTrace.leadSpreadsheetCue !== leadSpreadsheetCue ||
			  previousTrace.leadSpeakerAttributionCue !==
					leadSpeakerAttributionCue ||
			  previousTrace.leadChannelCue !== leadChannelCue ||
			  previousTrace.leadChannelAttributionCue !==
					leadChannelAttributionCue ||
			  previousTrace.leadContinuityCue !== leadContinuityCue ||
			  previousTrace.sqliteQueryMode !== sqliteQueryMode ||
			  previousTrace.sqliteQueryPushdownMode !==
					sqliteQueryPushdownMode ||
			  previousTrace.sqliteQueryPushdownApplied !==
					sqliteQueryPushdownApplied ||
			  previousTrace.sqliteQueryPushdownClauseCount !==
					sqliteQueryPushdownClauseCount ||
			  previousTrace.sqliteQueryTotalFilterClauseCount !==
					sqliteQueryTotalFilterClauseCount ||
			  previousTrace.sqliteQueryJsRemainderClauseCount !==
					sqliteQueryJsRemainderClauseCount ||
			  previousTrace.sqliteQueryMultiplierUsed !==
					sqliteQueryMultiplierUsed ||
			  previousTrace.sqliteQueryCandidateLimitUsed !==
					sqliteQueryCandidateLimitUsed ||
			  previousTrace.sqliteQueryMaxBackfillsUsed !==
					sqliteQueryMaxBackfillsUsed ||
			  previousTrace.sqliteQueryMinResultsUsed !==
					sqliteQueryMinResultsUsed ||
			  previousTrace.sqliteQueryFillPolicyUsed !==
					sqliteQueryFillPolicyUsed ||
			  previousTrace.sqliteQueryPushdownCoverageRatio !==
					sqliteQueryPushdownCoverageRatio ||
			  previousTrace.sqliteQueryJsRemainderRatio !==
					sqliteQueryJsRemainderRatio ||
			  previousTrace.sqliteQueryFilteredCandidates !==
					sqliteQueryFilteredCandidates ||
			  previousTrace.sqliteQueryInitialSearchK !==
					sqliteQueryInitialSearchK ||
			  previousTrace.sqliteQueryFinalSearchK !==
					sqliteQueryFinalSearchK ||
			  previousTrace.sqliteQuerySearchExpansionRatio !==
					sqliteQuerySearchExpansionRatio ||
			  previousTrace.sqliteQueryBackfillCount !==
					sqliteQueryBackfillCount ||
			  previousTrace.sqliteQueryBackfillLimitReached !==
					sqliteQueryBackfillLimitReached ||
			  previousTrace.sqliteQueryMinResultsSatisfied !==
					sqliteQueryMinResultsSatisfied ||
			  previousTrace.sqliteQueryReturnedCount !==
					sqliteQueryReturnedCount ||
			  previousTrace.sqliteQueryCandidateYieldRatio !==
					sqliteQueryCandidateYieldRatio ||
			  previousTrace.sqliteQueryTopKFillRatio !==
					sqliteQueryTopKFillRatio ||
			  previousTrace.sqliteQueryUnderfilledTopK !==
					sqliteQueryUnderfilledTopK ||
			  previousTrace.sqliteQueryCandidateBudgetExhausted !==
					sqliteQueryCandidateBudgetExhausted ||
			  previousTrace.sqliteQueryCandidateCoverage !==
					sqliteQueryCandidateCoverage ||
			  previousTrace.postgresQueryMode !== postgresQueryMode ||
			  previousTrace.postgresQueryPushdownMode !==
					postgresQueryPushdownMode ||
			  previousTrace.postgresQueryPushdownApplied !==
					postgresQueryPushdownApplied ||
			  previousTrace.postgresQueryPushdownClauseCount !==
					postgresQueryPushdownClauseCount ||
			  previousTrace.postgresQueryTotalFilterClauseCount !==
					postgresQueryTotalFilterClauseCount ||
			  previousTrace.postgresQueryJsRemainderClauseCount !==
					postgresQueryJsRemainderClauseCount ||
			  previousTrace.postgresQueryMultiplierUsed !==
					postgresQueryMultiplierUsed ||
			  previousTrace.postgresQueryCandidateLimitUsed !==
					postgresQueryCandidateLimitUsed ||
			  previousTrace.postgresQueryMaxBackfillsUsed !==
					postgresQueryMaxBackfillsUsed ||
			  previousTrace.postgresQueryMinResultsUsed !==
					postgresQueryMinResultsUsed ||
			  previousTrace.postgresQueryFillPolicyUsed !==
					postgresQueryFillPolicyUsed ||
			  previousTrace.postgresQueryPushdownCoverageRatio !==
					postgresQueryPushdownCoverageRatio ||
			  previousTrace.postgresQueryJsRemainderRatio !==
					postgresQueryJsRemainderRatio ||
			  previousTrace.postgresQueryFilteredCandidates !==
					postgresQueryFilteredCandidates ||
			  previousTrace.postgresQueryInitialSearchK !==
					postgresQueryInitialSearchK ||
			  previousTrace.postgresQueryFinalSearchK !==
					postgresQueryFinalSearchK ||
			  previousTrace.postgresQuerySearchExpansionRatio !==
					postgresQuerySearchExpansionRatio ||
			  previousTrace.postgresQueryBackfillCount !==
					postgresQueryBackfillCount ||
			  previousTrace.postgresQueryBackfillLimitReached !==
					postgresQueryBackfillLimitReached ||
			  previousTrace.postgresQueryMinResultsSatisfied !==
					postgresQueryMinResultsSatisfied ||
			  previousTrace.postgresQueryReturnedCount !==
					postgresQueryReturnedCount ||
			  previousTrace.postgresQueryCandidateYieldRatio !==
					postgresQueryCandidateYieldRatio ||
			  previousTrace.postgresQueryTopKFillRatio !==
					postgresQueryTopKFillRatio ||
			  previousTrace.postgresQueryUnderfilledTopK !==
					postgresQueryUnderfilledTopK ||
			  previousTrace.postgresQueryCandidateBudgetExhausted !==
					postgresQueryCandidateBudgetExhausted ||
			  previousTrace.postgresQueryCandidateCoverage !==
					postgresQueryCandidateCoverage ||
			  !areStageCountsEqual(previousStageCounts, stageCounts)
			? 'changed'
			: 'unchanged';

	return {
		candidateTopK: currentTrace?.candidateTopK ?? 0,
		caseId: caseResult.caseId,
		corpusKey: caseResult.corpusKey,
		inputFilter: filter,
		finalCount: currentTrace?.resultCounts.final ?? 0,
		label: caseResult.label,
		lexicalCount: currentTrace?.resultCounts.lexical ?? 0,
		lexicalTopK: currentTrace?.lexicalTopK ?? 0,
		inputRetrieval: retrieval,
		previousCandidateTopK: previousTrace?.candidateTopK,
		previousFinalCount: previousTrace?.finalCount,
		previousLexicalCount: previousTrace?.lexicalCount,
		previousLexicalTopK: previousTrace?.lexicalTopK,
		previousInputFilter: previousTrace?.inputFilter,
		previousInputRetrieval: previousTrace?.inputRetrieval,
		previousLeadChannelAttributionCue:
			previousTrace?.leadChannelAttributionCue,
		previousLeadChannelCue: previousTrace?.leadChannelCue,
		previousLeadContinuityCue: previousTrace?.leadContinuityCue,
		previousLeadPresentationCue: previousTrace?.leadPresentationCue,
		previousLeadSpreadsheetCue: previousTrace?.leadSpreadsheetCue,
		previousLeadSpeakerAttributionCue:
			previousTrace?.leadSpeakerAttributionCue,
		previousLeadSpeakerCue: previousTrace?.leadSpeakerCue,
		previousSqliteQueryBackfillCount:
			previousTrace?.sqliteQueryBackfillCount,
		previousSqliteQueryBackfillLimitReached:
			previousTrace?.sqliteQueryBackfillLimitReached,
		previousSqliteQueryMinResultsSatisfied:
			previousTrace?.sqliteQueryMinResultsSatisfied,
		previousSqliteQueryCandidateBudgetExhausted:
			previousTrace?.sqliteQueryCandidateBudgetExhausted,
		previousSqliteQueryCandidateCoverage:
			previousTrace?.sqliteQueryCandidateCoverage,
		previousSqliteQueryFilteredCandidates:
			previousTrace?.sqliteQueryFilteredCandidates,
		previousSqliteQueryFinalSearchK: previousTrace?.sqliteQueryFinalSearchK,
		previousSqliteQueryInitialSearchK:
			previousTrace?.sqliteQueryInitialSearchK,
		previousSqliteQuerySearchExpansionRatio:
			previousTrace?.sqliteQuerySearchExpansionRatio,
		previousSqliteQueryMode: previousTrace?.sqliteQueryMode,
		previousSqliteQueryPushdownMode: previousTrace?.sqliteQueryPushdownMode,
		previousSqliteQueryPushdownApplied:
			previousTrace?.sqliteQueryPushdownApplied,
		previousSqliteQueryPushdownClauseCount:
			previousTrace?.sqliteQueryPushdownClauseCount,
		previousSqliteQueryTotalFilterClauseCount:
			previousTrace?.sqliteQueryTotalFilterClauseCount,
		previousSqliteQueryJsRemainderClauseCount:
			previousTrace?.sqliteQueryJsRemainderClauseCount,
		previousSqliteQueryMultiplierUsed:
			previousTrace?.sqliteQueryMultiplierUsed,
		previousSqliteQueryCandidateLimitUsed:
			previousTrace?.sqliteQueryCandidateLimitUsed,
		previousSqliteQueryMaxBackfillsUsed:
			previousTrace?.sqliteQueryMaxBackfillsUsed,
		previousSqliteQueryMinResultsUsed:
			previousTrace?.sqliteQueryMinResultsUsed,
		previousSqliteQueryFillPolicyUsed:
			previousTrace?.sqliteQueryFillPolicyUsed,
		previousSqliteQueryPushdownCoverageRatio:
			previousTrace?.sqliteQueryPushdownCoverageRatio,
		previousSqliteQueryJsRemainderRatio:
			previousTrace?.sqliteQueryJsRemainderRatio,
		previousSqliteQueryReturnedCount:
			previousTrace?.sqliteQueryReturnedCount,
		previousSqliteQueryCandidateYieldRatio:
			previousTrace?.sqliteQueryCandidateYieldRatio,
		previousSqliteQueryTopKFillRatio:
			previousTrace?.sqliteQueryTopKFillRatio,
		previousSqliteQueryUnderfilledTopK:
			previousTrace?.sqliteQueryUnderfilledTopK,
		previousPostgresQueryBackfillCount:
			previousTrace?.postgresQueryBackfillCount,
		previousPostgresQueryBackfillLimitReached:
			previousTrace?.postgresQueryBackfillLimitReached,
		previousPostgresQueryMinResultsSatisfied:
			previousTrace?.postgresQueryMinResultsSatisfied,
		previousPostgresQueryCandidateBudgetExhausted:
			previousTrace?.postgresQueryCandidateBudgetExhausted,
		previousPostgresQueryCandidateCoverage:
			previousTrace?.postgresQueryCandidateCoverage,
		previousPostgresQueryFilteredCandidates:
			previousTrace?.postgresQueryFilteredCandidates,
		previousPostgresQueryFinalSearchK:
			previousTrace?.postgresQueryFinalSearchK,
		previousPostgresQueryInitialSearchK:
			previousTrace?.postgresQueryInitialSearchK,
		previousPostgresQuerySearchExpansionRatio:
			previousTrace?.postgresQuerySearchExpansionRatio,
		previousPostgresQueryMode: previousTrace?.postgresQueryMode,
		previousPostgresQueryPushdownMode:
			previousTrace?.postgresQueryPushdownMode,
		previousPostgresQueryPushdownApplied:
			previousTrace?.postgresQueryPushdownApplied,
		previousPostgresQueryPushdownClauseCount:
			previousTrace?.postgresQueryPushdownClauseCount,
		previousPostgresQueryTotalFilterClauseCount:
			previousTrace?.postgresQueryTotalFilterClauseCount,
		previousPostgresQueryJsRemainderClauseCount:
			previousTrace?.postgresQueryJsRemainderClauseCount,
		previousPostgresQueryMultiplierUsed:
			previousTrace?.postgresQueryMultiplierUsed,
		previousPostgresQueryCandidateLimitUsed:
			previousTrace?.postgresQueryCandidateLimitUsed,
		previousPostgresQueryMaxBackfillsUsed:
			previousTrace?.postgresQueryMaxBackfillsUsed,
		previousPostgresQueryMinResultsUsed:
			previousTrace?.postgresQueryMinResultsUsed,
		previousPostgresQueryFillPolicyUsed:
			previousTrace?.postgresQueryFillPolicyUsed,
		previousPostgresQueryPushdownCoverageRatio:
			previousTrace?.postgresQueryPushdownCoverageRatio,
		previousPostgresQueryJsRemainderRatio:
			previousTrace?.postgresQueryJsRemainderRatio,
		previousPostgresQueryReturnedCount:
			previousTrace?.postgresQueryReturnedCount,
		previousPostgresQueryCandidateYieldRatio:
			previousTrace?.postgresQueryCandidateYieldRatio,
		previousPostgresQueryTopKFillRatio:
			previousTrace?.postgresQueryTopKFillRatio,
		previousPostgresQueryUnderfilledTopK:
			previousTrace?.postgresQueryUnderfilledTopK,
		previousSourceBalanceStrategy: previousTrace?.sourceBalanceStrategy,
		previousSourceAwareChunkReasonLabel:
			previousTrace?.sourceAwareChunkReasonLabel,
		previousStageCounts,
		previousTopContextLabel: previousTrace?.topContextLabel,
		previousTopLocatorLabel: previousTrace?.topLocatorLabel,
		previousTraceMode: previousTrace?.traceMode,
		previousTransformedQuery: previousTrace?.transformedQuery,
		previousSourceAwareUnitScopeLabel:
			previousTrace?.sourceAwareUnitScopeLabel,
		previousVariantQueries: previousTrace?.variantQueries ?? [],
		previousVectorCount: previousTrace?.vectorCount,
		query: caseResult.query,
		leadChannelAttributionCue,
		leadChannelCue,
		leadContinuityCue,
		leadPresentationCue,
		leadSpreadsheetCue,
		leadSpeakerAttributionCue,
		leadSpeakerCue,
		sqliteQueryBackfillCount,
		sqliteQueryBackfillLimitReached,
		sqliteQueryMinResultsSatisfied,
		sqliteQueryCandidateBudgetExhausted,
		sqliteQueryCandidateCoverage,
		sqliteQueryFilteredCandidates,
		sqliteQueryFinalSearchK,
		sqliteQueryInitialSearchK,
		sqliteQuerySearchExpansionRatio,
		sqliteQueryMode,
		sqliteQueryPushdownMode,
		sqliteQueryPushdownApplied,
		sqliteQueryPushdownClauseCount,
		sqliteQueryTotalFilterClauseCount,
		sqliteQueryJsRemainderClauseCount,
		sqliteQueryMultiplierUsed,
		sqliteQueryCandidateLimitUsed,
		sqliteQueryMaxBackfillsUsed,
		sqliteQueryMinResultsUsed,
		sqliteQueryFillPolicyUsed,
		sqliteQueryPushdownCoverageRatio,
		sqliteQueryJsRemainderRatio,
		sqliteQueryReturnedCount,
		sqliteQueryCandidateYieldRatio,
		sqliteQueryTopKFillRatio,
		sqliteQueryUnderfilledTopK,
		postgresQueryBackfillCount,
		postgresQueryBackfillLimitReached,
		postgresQueryMinResultsSatisfied,
		postgresQueryCandidateBudgetExhausted,
		postgresQueryCandidateCoverage,
		postgresQueryFilteredCandidates,
		postgresQueryFinalSearchK,
		postgresQueryInitialSearchK,
		postgresQuerySearchExpansionRatio,
		postgresQueryMode,
		postgresQueryPushdownMode,
		postgresQueryPushdownApplied,
		postgresQueryPushdownClauseCount,
		postgresQueryTotalFilterClauseCount,
		postgresQueryJsRemainderClauseCount,
		postgresQueryMultiplierUsed,
		postgresQueryCandidateLimitUsed,
		postgresQueryMaxBackfillsUsed,
		postgresQueryMinResultsUsed,
		postgresQueryFillPolicyUsed,
		postgresQueryPushdownCoverageRatio,
		postgresQueryJsRemainderRatio,
		postgresQueryReturnedCount,
		postgresQueryCandidateYieldRatio,
		postgresQueryTopKFillRatio,
		postgresQueryUnderfilledTopK,
		sourceAwareChunkReasonLabel,
		sourceAwareUnitScopeLabel,
		stageCounts,
		status: caseResult.status,
		sourceBalanceStrategy: currentTrace?.sourceBalanceStrategy,
		topContextLabel,
		topLocatorLabel,
		traceChange,
		traceMode: currentTrace?.mode,
		transformedQuery: currentTrace?.transformedQuery || undefined,
		variantQueries: currentTrace?.variantQueries ?? [],
		vectorCount: currentTrace?.resultCounts.vector ?? 0
	};
};

const buildEvaluationCaseTraceSnapshotsFromEvaluated = (
	evaluated: Array<{
		caseResult: RAGEvaluationCaseResult;
		trace?: RAGRetrievalTrace;
		filter?: Record<string, unknown>;
		retrieval?: RAGCollectionSearchParams['retrieval'];
		topResult?: RAGQueryResult;
	}>
): RAGEvaluationCaseTraceSnapshot[] =>
	evaluated.map(({ caseResult, filter, retrieval, trace, topResult }) =>
		buildEvaluationCaseTraceSnapshot({
			caseResult,
			filter,
			retrieval,
			currentTrace: trace,
			topResult
		})
	);

const buildEvaluationCaseTraceSnapshots = ({
	current,
	previous
}: {
	current?: RAGEvaluationSuiteRun;
	previous?: RAGEvaluationSuiteRun;
}): RAGEvaluationCaseTraceSnapshot[] => {
	if (!current) {
		return [];
	}

	const currentTraces = new Map(
		(current.caseTraceSnapshots ?? []).map((entry) => [entry.caseId, entry])
	);
	const previousTraces = new Map(
		(previous?.caseTraceSnapshots ?? []).map((entry) => [
			entry.caseId,
			entry
		])
	);

	return current.response.cases.map((caseResult) =>
		buildEvaluationCaseTraceSnapshot({
			caseResult,
			currentSnapshot: currentTraces.get(caseResult.caseId),
			currentTrace: (() => {
				const currentSnapshot = currentTraces.get(caseResult.caseId);
				if (!currentSnapshot) {
					return undefined;
				}

				return {
					candidateTopK: currentSnapshot.candidateTopK,
					lexicalTopK: currentSnapshot.lexicalTopK,
					mode: currentSnapshot.traceMode ?? 'vector',
					query: caseResult.query,
					resultCounts: {
						final: currentSnapshot.finalCount,
						fused: currentSnapshot.finalCount,
						lexical: currentSnapshot.lexicalCount,
						reranked: currentSnapshot.finalCount,
						vector: currentSnapshot.vectorCount
					},
					runLexical: currentSnapshot.lexicalCount > 0,
					runVector: currentSnapshot.vectorCount > 0,
					sourceBalanceStrategy:
						currentSnapshot.sourceBalanceStrategy ?? 'cap',
					steps: [],
					topK: caseResult.topK,
					transformedQuery:
						currentSnapshot.transformedQuery ?? caseResult.query,
					variantQueries: currentSnapshot.variantQueries
				} satisfies RAGRetrievalTrace;
			})(),
			previousTrace: previousTraces.get(caseResult.caseId)
		})
	);
};

const getStatusRank = (status: RAGEvaluationCaseResult['status']) =>
	status === 'pass' ? 2 : status === 'partial' ? 1 : 0;

const buildCaseTraceLeadLabel = (
	trace?: Pick<
		RAGEvaluationCaseTraceSnapshot,
		| 'topLocatorLabel'
		| 'topContextLabel'
		| 'sourceAwareUnitScopeLabel'
		| 'sourceAwareChunkReasonLabel'
	>
) =>
	trace?.topLocatorLabel ??
	trace?.topContextLabel ??
	trace?.sourceAwareUnitScopeLabel ??
	trace?.sourceAwareChunkReasonLabel;

export const buildRAGEvaluationRunDiff = ({
	current,
	previous
}: {
	current: RAGEvaluationSuiteRun;
	previous?: RAGEvaluationSuiteRun;
}): RAGEvaluationRunDiff => {
	const previousCases = new Map(
		(previous?.response.cases ?? []).map((entry) => [entry.caseId, entry])
	);
	const diffs = current.response.cases.map((entry) =>
		buildCaseDiff(entry, previousCases.get(entry.caseId))
	);
	const regressedCases = diffs.filter(
		(entry) =>
			getStatusRank(entry.currentStatus) <
			getStatusRank(entry.previousStatus ?? 'fail')
	);
	const improvedCases = diffs.filter(
		(entry) =>
			getStatusRank(entry.currentStatus) >
			getStatusRank(entry.previousStatus ?? 'fail')
	);
	const unchangedCases = diffs.filter(
		(entry) =>
			getStatusRank(entry.currentStatus) ===
			getStatusRank(entry.previousStatus ?? 'fail')
	);
	const previousCaseTraces = new Map(
		(previous?.caseTraceSnapshots ?? []).map((entry) => [
			entry.caseId,
			entry
		])
	);
	const traceLeadChanges = (current.caseTraceSnapshots ?? [])
		.map((entry) => {
			const previousEntry = previousCaseTraces.get(entry.caseId);
			const currentLead = buildCaseTraceLeadLabel(entry);
			const previousLead = buildCaseTraceLeadLabel(previousEntry);
			if (!currentLead || currentLead === previousLead) {
				return undefined;
			}

			return {
				caseId: entry.caseId,
				currentLead,
				label: entry.label,
				previousLead
			};
		})
		.filter(
			(entry): entry is NonNullable<typeof entry> =>
				typeof entry !== 'undefined'
		);

	return {
		currentRunId: current.id,
		improvedCases,
		previousRunId: previous?.id,
		regressedCases,
		suiteId: current.suiteId,
		traceLeadChanges:
			traceLeadChanges.length > 0 ? traceLeadChanges : undefined,
		summaryDelta: {
			averageF1:
				current.response.summary.averageF1 -
				(previous?.response.summary.averageF1 ?? 0),
			averageLatencyMs:
				current.response.summary.averageLatencyMs -
				(previous?.response.summary.averageLatencyMs ?? 0),
			failedCases:
				current.response.summary.failedCases -
				(previous?.response.summary.failedCases ?? 0),
			passedCases:
				current.response.summary.passedCases -
				(previous?.response.summary.passedCases ?? 0),
			passingRate:
				current.response.passingRate -
				(previous?.response.passingRate ?? 0),
			partialCases:
				current.response.summary.partialCases -
				(previous?.response.summary.partialCases ?? 0)
		},
		traceSummaryDelta:
			current.traceSummary || previous?.traceSummary
				? {
						averageCandidateTopK:
							(current.traceSummary?.averageCandidateTopK ?? 0) -
							(previous?.traceSummary?.averageCandidateTopK ?? 0),
						averageFinalCount:
							(current.traceSummary?.averageFinalCount ?? 0) -
							(previous?.traceSummary?.averageFinalCount ?? 0),
						averageLexicalCount:
							(current.traceSummary?.averageLexicalCount ?? 0) -
							(previous?.traceSummary?.averageLexicalCount ?? 0),
						averageLexicalTopK:
							(current.traceSummary?.averageLexicalTopK ?? 0) -
							(previous?.traceSummary?.averageLexicalTopK ?? 0),
						averageVectorCount:
							(current.traceSummary?.averageVectorCount ?? 0) -
							(previous?.traceSummary?.averageVectorCount ?? 0),
						balancedCases:
							(current.traceSummary?.balancedCases ?? 0) -
							(previous?.traceSummary?.balancedCases ?? 0),
						officeEvidenceReconcileCasesDelta:
							(current.traceSummary
								?.officeEvidenceReconcileCases ?? 0) -
							(previous?.traceSummary
								?.officeEvidenceReconcileCases ?? 0),
						officeParagraphEvidenceReconcileCasesDelta:
							(current.traceSummary
								?.officeParagraphEvidenceReconcileCases ?? 0) -
							(previous?.traceSummary
								?.officeParagraphEvidenceReconcileCases ?? 0),
						officeListEvidenceReconcileCasesDelta:
							(current.traceSummary
								?.officeListEvidenceReconcileCases ?? 0) -
							(previous?.traceSummary
								?.officeListEvidenceReconcileCases ?? 0),
						officeTableEvidenceReconcileCasesDelta:
							(current.traceSummary
								?.officeTableEvidenceReconcileCases ?? 0) -
							(previous?.traceSummary
								?.officeTableEvidenceReconcileCases ?? 0),
						pdfEvidenceReconcileCasesDelta:
							(current.traceSummary?.pdfEvidenceReconcileCases ??
								0) -
							(previous?.traceSummary
								?.pdfEvidenceReconcileCases ?? 0),
						lexicalCases:
							(current.traceSummary?.lexicalCases ?? 0) -
							(previous?.traceSummary?.lexicalCases ?? 0),
						modesChanged:
							(current.traceSummary?.modes ?? []).join('|') !==
							(previous?.traceSummary?.modes ?? []).join('|'),
						roundRobinCases:
							(current.traceSummary?.roundRobinCases ?? 0) -
							(previous?.traceSummary?.roundRobinCases ?? 0),
						stageCounts: diffTraceStageCounts({
							current: current.traceSummary?.stageCounts ?? {},
							previous: previous?.traceSummary?.stageCounts ?? {}
						}),
						sourceBalanceStrategiesChanged:
							(
								current.traceSummary?.sourceBalanceStrategies ??
								[]
							).join('|') !==
							(
								previous?.traceSummary
									?.sourceBalanceStrategies ?? []
							).join('|'),
						transformedCases:
							(current.traceSummary?.transformedCases ?? 0) -
							(previous?.traceSummary?.transformedCases ?? 0),
						variantCases:
							(current.traceSummary?.variantCases ?? 0) -
							(previous?.traceSummary?.variantCases ?? 0),
						vectorCases:
							(current.traceSummary?.vectorCases ?? 0) -
							(previous?.traceSummary?.vectorCases ?? 0)
					}
				: undefined,
		unchangedCases
	};
};

export const buildRAGAnswerGroundingEvaluationRunDiff = ({
	current,
	previous
}: {
	current: RAGAnswerGroundingEvaluationRun;
	previous?: RAGAnswerGroundingEvaluationRun;
}): RAGAnswerGroundingEvaluationRunDiff => {
	const previousCases = new Map(
		(previous?.response.cases ?? []).map((entry) => [entry.caseId, entry])
	);
	const diffs = current.response.cases.map((entry) =>
		buildGroundingCaseDiff(entry, previousCases.get(entry.caseId))
	);
	const regressedCases = diffs.filter(
		(entry) =>
			getStatusRank(entry.currentStatus) <
			getStatusRank(entry.previousStatus ?? 'fail')
	);
	const improvedCases = diffs.filter(
		(entry) =>
			getStatusRank(entry.currentStatus) >
			getStatusRank(entry.previousStatus ?? 'fail')
	);
	const unchangedCases = diffs.filter(
		(entry) =>
			getStatusRank(entry.currentStatus) ===
			getStatusRank(entry.previousStatus ?? 'fail')
	);

	return {
		currentRunId: current.id,
		improvedCases,
		previousRunId: previous?.id,
		regressedCases,
		suiteId: current.suiteId,
		summaryDelta: {
			averageCitationF1:
				current.response.summary.averageCitationF1 -
				(previous?.response.summary.averageCitationF1 ?? 0),
			averageResolvedCitationRate:
				current.response.summary.averageResolvedCitationRate -
				(previous?.response.summary.averageResolvedCitationRate ?? 0),
			failedCases:
				current.response.summary.failedCases -
				(previous?.response.summary.failedCases ?? 0),
			passedCases:
				current.response.summary.passedCases -
				(previous?.response.summary.passedCases ?? 0),
			passingRate:
				current.response.passingRate -
				(previous?.response.passingRate ?? 0),
			partialCases:
				current.response.summary.partialCases -
				(previous?.response.summary.partialCases ?? 0)
		},
		unchangedCases
	};
};

export const createRAGFileEvaluationHistoryStore = (
	path: string
): RAGEvaluationHistoryStore => ({
	listRuns: async ({ limit, suiteId } = {}) => {
		let parsed: RAGEvaluationSuiteRun[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) => !suiteId || entry.suiteId === suiteId
		);
		const sorted = normalizeHistoryRuns(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveRun: async (run) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeHistoryRuns([
			run,
			...existing.filter(
				(entry: RAGEvaluationSuiteRun) => entry.id !== run.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	},
	pruneRuns: async (input) => {
		let existing: RAGEvaluationSuiteRun[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			existing = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const pruned = applyRAGEvaluationHistoryPrunePolicy({
			input,
			runs: existing,
			sort: normalizeHistoryRuns
		});
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(pruned.next, null, '\t') + '\n',
			'utf8'
		);
		return {
			keptCount: pruned.keptCount,
			removedCount: pruned.removedCount
		} satisfies RAGEvaluationHistoryPruneResult;
	}
});

const normalizeEvaluationSuiteSnapshots = (
	snapshots: RAGEvaluationSuiteSnapshot[]
) =>
	[...snapshots].sort((left, right) => {
		if (right.createdAt !== left.createdAt) {
			return right.createdAt - left.createdAt;
		}
		if (right.version !== left.version) {
			return right.version - left.version;
		}
		return right.id.localeCompare(left.id);
	});

export const createRAGFileEvaluationSuiteSnapshotHistoryStore = (
	path: string
): RAGEvaluationSuiteSnapshotHistoryStore => ({
	listSnapshots: async ({ limit, suiteId } = {}) => {
		let parsed: RAGEvaluationSuiteSnapshot[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) => !suiteId || entry.suiteId === suiteId
		);
		const sorted = normalizeEvaluationSuiteSnapshots(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveSnapshot: async (snapshot) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeEvaluationSuiteSnapshots([
			snapshot,
			...existing.filter(
				(entry: RAGEvaluationSuiteSnapshot) => entry.id !== snapshot.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	},
	pruneSnapshots: async (input) => {
		let existing: RAGEvaluationSuiteSnapshot[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			existing = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const pruned = applyRAGEvaluationHistoryPrunePolicy({
			input,
			runs: existing,
			sort: normalizeEvaluationSuiteSnapshots
		});
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(pruned.next, null, '\t') + '\n',
			'utf8'
		);
		return {
			keptCount: pruned.keptCount,
			removedCount: pruned.removedCount
		} satisfies RAGEvaluationHistoryPruneResult;
	}
});

export const createRAGFileRetrievalComparisonHistoryStore = (
	path: string
): RAGRetrievalComparisonHistoryStore => ({
	listRuns: async ({
		groupKey,
		label,
		limit,
		suiteId,
		tag,
		winnerId
	} = {}) => {
		let parsed: RAGRetrievalComparisonRun[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const normalizedLabel = normalizeLabelFilter(label);
		const filtered = parsed.filter(
			(entry) =>
				(!suiteId || entry.suiteId === suiteId) &&
				(!groupKey || entry.groupKey === groupKey) &&
				(!tag || (entry.tags ?? []).includes(tag)) &&
				(!normalizedLabel ||
					entry.label.toLowerCase().includes(normalizedLabel) ||
					entry.suiteLabel.toLowerCase().includes(normalizedLabel)) &&
				matchesWinner(entry, winnerId)
		);
		const sorted = normalizeRetrievalComparisonRuns(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveRun: async (run) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeRetrievalComparisonRuns([
			run,
			...existing.filter(
				(entry: RAGRetrievalComparisonRun) => entry.id !== run.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalBaselineStore = (
	path: string
): RAGRetrievalBaselineStore => {
	const listBaselines: RAGRetrievalBaselineStore['listBaselines'] = async ({
		groupKey,
		limit,
		tag,
		status
	} = {}) => {
		let parsed: RAGRetrievalBaselineRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) =>
				(!groupKey || entry.groupKey === groupKey) &&
				(!tag || (entry.tags ?? []).includes(tag)) &&
				(!status || entry.status === status)
		);
		const sorted = normalizeRetrievalBaselineRecords(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	};

	return {
		getBaseline: async (groupKey) => {
			const baselines = await Promise.resolve(
				listBaselines({ groupKey, limit: 1 })
			);
			return baselines[0] ?? null;
		},
		listBaselines,
		saveBaseline: async (record) => {
			const existing = await (async () => {
				try {
					const content = await readFile(path, 'utf8');
					const value = JSON.parse(content);
					return Array.isArray(value) ? value : [];
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw error;
					}
					return [];
				}
			})();
			const currentVersion =
				existing
					.filter(
						(entry: RAGRetrievalBaselineRecord) =>
							entry.groupKey === record.groupKey
					)
					.reduce(
						(max, entry) => Math.max(max, entry.version ?? 0),
						0
					) ?? 0;
			const next = normalizeRetrievalBaselineRecords([
				{
					...record,
					status: 'active',
					version:
						typeof record.version === 'number'
							? record.version
							: currentVersion + 1
				},
				...existing.map((entry: RAGRetrievalBaselineRecord) =>
					entry.groupKey === record.groupKey &&
					(entry.rolloutLabel ?? undefined) ===
						(record.rolloutLabel ?? undefined)
						? { ...entry, status: 'superseded' as const }
						: entry
				)
			]);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(
				path,
				JSON.stringify(next, null, '\t') + '\n',
				'utf8'
			);
		}
	};
};

export const createRAGFileRetrievalReleaseDecisionStore = (
	path: string
): RAGRetrievalReleaseDecisionStore => ({
	listDecisions: async ({ groupKey, kind, limit } = {}) => {
		let parsed: RAGRetrievalReleaseDecisionRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) =>
				(!groupKey || entry.groupKey === groupKey) &&
				(!kind || entry.kind === kind)
		);
		const sorted = normalizeRetrievalReleaseDecisionRecords(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveDecision: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeRetrievalReleaseDecisionRecords([
			record,
			...existing.filter(
				(entry: RAGRetrievalReleaseDecisionRecord) =>
					entry.id !== record.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalLaneHandoffDecisionStore = (
	path: string
): RAGRetrievalLaneHandoffDecisionStore => ({
	listDecisions: async ({
		groupKey,
		kind,
		limit,
		sourceRolloutLabel,
		targetRolloutLabel
	} = {}) => {
		let parsed: RAGRetrievalLaneHandoffDecisionRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) =>
				(!groupKey || entry.groupKey === groupKey) &&
				(!kind || entry.kind === kind) &&
				(!sourceRolloutLabel ||
					entry.sourceRolloutLabel === sourceRolloutLabel) &&
				(!targetRolloutLabel ||
					entry.targetRolloutLabel === targetRolloutLabel)
		);
		const sorted = normalizeRetrievalLaneHandoffDecisionRecords(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveDecision: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeRetrievalLaneHandoffDecisionRecords([
			record,
			...existing.filter(
				(entry: RAGRetrievalLaneHandoffDecisionRecord) =>
					entry.id !== record.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalReleaseIncidentStore = (
	path: string
): RAGRetrievalReleaseIncidentStore => ({
	listIncidents: async ({
		corpusGroupKey,
		groupKey,
		limit,
		severity,
		status,
		targetRolloutLabel
	} = {}) => {
		let parsed: RAGRetrievalReleaseIncidentRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) =>
				(!corpusGroupKey || entry.corpusGroupKey === corpusGroupKey) &&
				(!groupKey || entry.groupKey === groupKey) &&
				(!targetRolloutLabel ||
					entry.targetRolloutLabel === targetRolloutLabel) &&
				(!severity || entry.severity === severity) &&
				(!status || entry.status === status)
		);
		const sorted = normalizeRetrievalReleaseIncidentRecords(filtered);
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveIncident: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeRetrievalReleaseIncidentRecords([
			record,
			...existing.filter(
				(entry: RAGRetrievalReleaseIncidentRecord) =>
					entry.id !== record.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalLaneHandoffIncidentStore = (
	path: string
): RAGRetrievalLaneHandoffIncidentStore => ({
	listIncidents: async ({
		groupKey,
		limit,
		severity,
		status,
		targetRolloutLabel
	} = {}) => {
		let parsed: RAGRetrievalLaneHandoffIncidentRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) =>
				(!groupKey || entry.groupKey === groupKey) &&
				(!targetRolloutLabel ||
					entry.targetRolloutLabel === targetRolloutLabel) &&
				(!severity || entry.severity === severity) &&
				(!status || entry.status === status)
		);
		const sorted = normalizeRetrievalReleaseIncidentRecords(
			filtered as RAGRetrievalReleaseIncidentRecord[]
		) as RAGRetrievalLaneHandoffIncidentRecord[];
		return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
	},
	saveIncident: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeRetrievalReleaseIncidentRecords([
			record as RAGRetrievalReleaseIncidentRecord,
			...existing.filter(
				(entry: RAGRetrievalLaneHandoffIncidentRecord) =>
					entry.id !== record.id
			)
		]) as RAGRetrievalLaneHandoffIncidentRecord[];
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalLaneHandoffIncidentHistoryStore = (
	path: string
): RAGRetrievalLaneHandoffIncidentHistoryStore => ({
	listRecords: async ({
		action,
		groupKey,
		incidentId,
		limit,
		targetRolloutLabel
	} = {}) => {
		let parsed: RAGRetrievalLaneHandoffIncidentHistoryRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed
			.filter(
				(entry) =>
					(!action || entry.action === action) &&
					(!groupKey || entry.groupKey === groupKey) &&
					(!incidentId || entry.incidentId === incidentId) &&
					(!targetRolloutLabel ||
						entry.targetRolloutLabel === targetRolloutLabel)
			)
			.sort((left, right) => right.recordedAt - left.recordedAt);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = [record, ...existing].sort(
			(
				left: RAGRetrievalLaneHandoffIncidentHistoryRecord,
				right: RAGRetrievalLaneHandoffIncidentHistoryRecord
			) => right.recordedAt - left.recordedAt
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalIncidentRemediationDecisionStore = (
	path: string
): RAGRetrievalIncidentRemediationDecisionStore => ({
	listRecords: async ({
		groupKey,
		incidentId,
		limit,
		remediationKind,
		status,
		targetRolloutLabel
	} = {}) => {
		let parsed: RAGRetrievalIncidentRemediationDecisionRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const filtered = normalizeRetrievalIncidentRemediationDecisionRecords(
			parsed
		).filter(
			(entry) =>
				(!groupKey || entry.groupKey === groupKey) &&
				(!incidentId || entry.incidentId === incidentId) &&
				(!remediationKind ||
					entry.remediationKind === remediationKind) &&
				(!status || entry.status === status) &&
				(!targetRolloutLabel ||
					entry.targetRolloutLabel === targetRolloutLabel)
		);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeRetrievalIncidentRemediationDecisionRecords([
			record,
			...existing
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalIncidentRemediationExecutionHistoryStore = (
	path: string
): RAGRetrievalIncidentRemediationExecutionHistoryStore => ({
	listRecords: async ({
		actionKind,
		blockedByGuardrail,
		code,
		groupKey,
		idempotentReplay,
		incidentId,
		limit,
		targetRolloutLabel
	} = {}) => {
		let parsed: RAGRetrievalIncidentRemediationExecutionHistoryRecord[] =
			[];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const filtered =
			normalizeRetrievalIncidentRemediationExecutionHistoryRecords(
				parsed
			).filter(
				(entry) =>
					(!groupKey || entry.groupKey === groupKey) &&
					(!incidentId || entry.incidentId === incidentId) &&
					(!actionKind || entry.action.kind === actionKind) &&
					(!code || entry.code === code) &&
					(typeof blockedByGuardrail !== 'boolean' ||
						entry.blockedByGuardrail === blockedByGuardrail) &&
					(typeof idempotentReplay !== 'boolean' ||
						entry.idempotentReplay === idempotentReplay) &&
					(!targetRolloutLabel ||
						entry.targetRolloutLabel === targetRolloutLabel)
			);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next =
			normalizeRetrievalIncidentRemediationExecutionHistoryRecords([
				record,
				...existing
			]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalLaneHandoffAutoCompletePolicyHistoryStore = (
	path: string
): RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore => ({
	listRecords: async ({ groupKey, limit, targetRolloutLabel } = {}) => {
		let parsed: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord[] =
			[];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const filtered = parsed
			.filter(
				(entry) =>
					(!groupKey || entry.groupKey === groupKey) &&
					(!targetRolloutLabel ||
						entry.targetRolloutLabel === targetRolloutLabel)
			)
			.sort((left, right) => right.recordedAt - left.recordedAt);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = [record, ...existing].sort(
			(
				left: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord,
				right: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord
			) => right.recordedAt - left.recordedAt
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalReleaseLanePolicyHistoryStore = (
	path: string
): RAGRetrievalReleaseLanePolicyHistoryStore => ({
	listRecords: async ({ groupKey, limit, rolloutLabel, scope } = {}) => {
		let parsed: RAGRetrievalReleaseLanePolicyHistoryRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const filtered = parsed
			.filter(
				(entry) =>
					(!groupKey || entry.groupKey === groupKey) &&
					(!rolloutLabel || entry.rolloutLabel === rolloutLabel) &&
					(!scope || entry.scope === scope)
			)
			.sort((left, right) => right.recordedAt - left.recordedAt);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = [record, ...existing].sort(
			(
				left: RAGRetrievalReleaseLanePolicyHistoryRecord,
				right: RAGRetrievalReleaseLanePolicyHistoryRecord
			) => right.recordedAt - left.recordedAt
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalBaselineGatePolicyHistoryStore = (
	path: string
): RAGRetrievalBaselineGatePolicyHistoryStore => ({
	listRecords: async ({ groupKey, limit, rolloutLabel, scope } = {}) => {
		let parsed: RAGRetrievalBaselineGatePolicyHistoryRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const filtered = parsed
			.filter(
				(entry) =>
					(!groupKey || entry.groupKey === groupKey) &&
					(!rolloutLabel || entry.rolloutLabel === rolloutLabel) &&
					(!scope || entry.scope === scope)
			)
			.sort((left, right) => right.recordedAt - left.recordedAt);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = [record, ...existing].sort(
			(
				left: RAGRetrievalBaselineGatePolicyHistoryRecord,
				right: RAGRetrievalBaselineGatePolicyHistoryRecord
			) => right.recordedAt - left.recordedAt
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileRetrievalReleaseLaneEscalationPolicyHistoryStore = (
	path: string
): RAGRetrievalReleaseLaneEscalationPolicyHistoryStore => ({
	listRecords: async ({ groupKey, limit, targetRolloutLabel } = {}) => {
		let parsed: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		const filtered = parsed
			.filter(
				(entry) =>
					(!groupKey || entry.groupKey === groupKey) &&
					(!targetRolloutLabel ||
						entry.targetRolloutLabel === targetRolloutLabel)
			)
			.sort((left, right) => right.recordedAt - left.recordedAt);
		return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
	},
	saveRecord: async (record) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = [record, ...existing].sort(
			(
				left: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord,
				right: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord
			) => right.recordedAt - left.recordedAt
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export const createRAGFileSearchTraceStore = (
	path: string
): RAGSearchTraceStore => ({
	async listTraces(input) {
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				traces?: RAGSearchTraceRecord[];
			};
			const traces = Array.isArray(data.traces) ? data.traces : [];
			const filtered = traces.filter((trace) => {
				if (input?.query && trace.query !== input.query) {
					return false;
				}
				if (input?.groupKey && trace.groupKey !== input.groupKey) {
					return false;
				}
				if (input?.tag && !(trace.tags ?? []).includes(input.tag)) {
					return false;
				}
				return true;
			});

			return normalizeTraceSummaryRuns(filtered).slice(
				0,
				input?.limit ?? DEFAULT_HISTORY_LIMIT
			);
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return [];
			}

			throw error;
		}
	},
	async saveTrace(trace) {
		let traces: RAGSearchTraceRecord[] = [];
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				traces?: RAGSearchTraceRecord[];
			};
			traces = Array.isArray(data.traces) ? data.traces : [];
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			) {
				throw error;
			}
		}

		const nextTraces = normalizeTraceSummaryRuns([
			trace,
			...traces.filter((entry) => entry.id !== trace.id)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(
				{
					traces: nextTraces
				},
				null,
				2
			)
		);
	},
	async pruneTraces(input) {
		let traces: RAGSearchTraceRecord[] = [];
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				traces?: RAGSearchTraceRecord[];
			};
			traces = Array.isArray(data.traces) ? data.traces : [];
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			) {
				throw error;
			}
		}

		const pruned = applyRAGSearchTracePrunePolicy({
			input,
			traces
		});
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(
				{
					traces: pruned.next
				},
				null,
				2
			)
		);

		return {
			keptCount: pruned.keptCount,
			removedCount: pruned.removedCount
		};
	}
});

export const createRAGFileSearchTracePruneHistoryStore = (
	path: string
): RAGSearchTracePruneHistoryStore => ({
	listRuns: async (input) => {
		let parsed: RAGSearchTracePruneRun[] = [];
		try {
			const content = await readFile(path, 'utf8');
			const value = JSON.parse(content);
			parsed = Array.isArray(value) ? value : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const filtered = parsed.filter(
			(entry) => !input?.trigger || entry.trigger === input.trigger
		);
		const sorted = normalizeSearchTracePruneRuns(filtered);
		return typeof input?.limit === 'number'
			? sorted.slice(0, input.limit)
			: sorted;
	},
	saveRun: async (run) => {
		const existing = await (async () => {
			try {
				const content = await readFile(path, 'utf8');
				const value = JSON.parse(content);
				return Array.isArray(value) ? value : [];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				return [];
			}
		})();
		const next = normalizeSearchTracePruneRuns([
			run,
			...existing.filter(
				(entry: RAGSearchTracePruneRun) => entry.id !== run.id
			)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	}
});

export type SQLiteRAGSearchTraceStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGEvaluationHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGEvaluationSuiteSnapshotHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGAnswerGroundingEvaluationHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGSearchTracePruneHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalComparisonHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalReleaseDecisionStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalBaselineStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalReleaseIncidentStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalLaneHandoffDecisionStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalLaneHandoffIncidentStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalLaneHandoffIncidentHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalIncidentRemediationDecisionStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalIncidentRemediationExecutionHistoryStoreOptions =
	{
		db?: Database;
		path?: string;
		tableName?: string;
	};

export type SQLiteRAGRetrievalLaneHandoffAutoCompletePolicyHistoryStoreOptions =
	{
		db?: Database;
		path?: string;
		tableName?: string;
	};

export type SQLiteRAGRetrievalReleaseLanePolicyHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalBaselineGatePolicyHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGRetrievalReleaseLaneEscalationPolicyHistoryStoreOptions = {
	db?: Database;
	path?: string;
	tableName?: string;
};

export type SQLiteRAGGovernanceStoreBundleOptions = {
	db?: Database;
	path?: string;
	tablePrefix?: string;
};

export const createRAGSQLiteEvaluationHistoryStore = (
	options: SQLiteRAGEvaluationHistoryStoreOptions
): RAGEvaluationHistoryStore => {
	const tableName = options.tableName ?? 'rag_evaluation_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			suite_id TEXT NOT NULL,
			finished_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_suite_finished_at_idx ON ${tableName} (suite_id, finished_at DESC)`
	);

	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			suite_id,
			finished_at,
			record_json
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			suite_id = excluded.suite_id,
			finished_at = excluded.finished_at,
			record_json = excluded.record_json
	`);

	return {
		listRuns(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];
			if (input.suiteId) {
				where.push('suite_id = ?');
				params.push(input.suiteId);
			}
			const sql =
				`SELECT record_json FROM ${tableName}` +
				`${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY finished_at DESC';
			const rows = db.prepare(sql).all(...params) as Array<{
				record_json: string;
			}>;
			const runs = normalizeHistoryRuns(
				rows.map(
					(row) =>
						JSON.parse(row.record_json) as RAGEvaluationSuiteRun
				)
			);

			return typeof input.limit === 'number'
				? runs.slice(0, input.limit)
				: runs;
		},
		saveRun(run) {
			insert.run(
				run.id,
				run.suiteId,
				run.finishedAt,
				JSON.stringify(run)
			);
		},
		pruneRuns(input) {
			const allRows = db
				.prepare(`SELECT record_json FROM ${tableName}`)
				.all() as Array<{
				record_json: string;
			}>;
			const pruned = applyRAGEvaluationHistoryPrunePolicy({
				input,
				runs: allRows.map(
					(row) =>
						JSON.parse(row.record_json) as RAGEvaluationSuiteRun
				),
				sort: normalizeHistoryRuns
			});
			for (const run of pruned.removed) {
				db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(run.id);
			}
			return {
				keptCount: pruned.keptCount,
				removedCount: pruned.removedCount
			} satisfies RAGEvaluationHistoryPruneResult;
		}
	};
};

export const createRAGSQLiteEvaluationSuiteSnapshotHistoryStore = (
	options: SQLiteRAGEvaluationSuiteSnapshotHistoryStoreOptions
): RAGEvaluationSuiteSnapshotHistoryStore => {
	const tableName =
		options.tableName ?? 'rag_evaluation_suite_snapshot_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			suite_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_suite_created_at_idx ON ${tableName} (suite_id, created_at DESC, version DESC)`
	);

	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			suite_id,
			version,
			created_at,
			record_json
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			suite_id = excluded.suite_id,
			version = excluded.version,
			created_at = excluded.created_at,
			record_json = excluded.record_json
	`);

	return {
		listSnapshots(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];
			if (input.suiteId) {
				where.push('suite_id = ?');
				params.push(input.suiteId);
			}
			const sql =
				`SELECT record_json FROM ${tableName}` +
				`${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY created_at DESC, version DESC';
			const rows = db.prepare(sql).all(...params) as Array<{
				record_json: string;
			}>;
			const snapshots = normalizeEvaluationSuiteSnapshots(
				rows.map(
					(row) =>
						JSON.parse(
							row.record_json
						) as RAGEvaluationSuiteSnapshot
				)
			);

			return typeof input.limit === 'number'
				? snapshots.slice(0, input.limit)
				: snapshots;
		},
		saveSnapshot(snapshot) {
			insert.run(
				snapshot.id,
				snapshot.suiteId,
				snapshot.version,
				snapshot.createdAt,
				JSON.stringify(snapshot)
			);
		},
		pruneSnapshots(input) {
			const allRows = db
				.prepare(`SELECT record_json FROM ${tableName}`)
				.all() as Array<{
				record_json: string;
			}>;
			const pruned = applyRAGEvaluationHistoryPrunePolicy({
				input,
				runs: allRows.map(
					(row) =>
						JSON.parse(
							row.record_json
						) as RAGEvaluationSuiteSnapshot
				),
				sort: normalizeEvaluationSuiteSnapshots
			});
			for (const snapshot of pruned.removed) {
				db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(
					snapshot.id
				);
			}
			return {
				keptCount: pruned.keptCount,
				removedCount: pruned.removedCount
			} satisfies RAGEvaluationHistoryPruneResult;
		}
	};
};

export const createRAGSQLiteAnswerGroundingEvaluationHistoryStore = (
	options: SQLiteRAGAnswerGroundingEvaluationHistoryStoreOptions
): RAGAnswerGroundingEvaluationHistoryStore => {
	const tableName = options.tableName ?? 'rag_answer_grounding_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			suite_id TEXT NOT NULL,
			finished_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_suite_finished_at_idx ON ${tableName} (suite_id, finished_at DESC)`
	);

	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			suite_id,
			finished_at,
			record_json
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			suite_id = excluded.suite_id,
			finished_at = excluded.finished_at,
			record_json = excluded.record_json
	`);

	return {
		listRuns(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];
			if (input.suiteId) {
				where.push('suite_id = ?');
				params.push(input.suiteId);
			}
			const sql =
				`SELECT record_json FROM ${tableName}` +
				`${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY finished_at DESC';
			const rows = db.prepare(sql).all(...params) as Array<{
				record_json: string;
			}>;
			const runs = normalizeGroundingHistoryRuns(
				rows.map(
					(row) =>
						JSON.parse(
							row.record_json
						) as RAGAnswerGroundingEvaluationRun
				)
			);

			return typeof input.limit === 'number'
				? runs.slice(0, input.limit)
				: runs;
		},
		saveRun(run) {
			insert.run(
				run.id,
				run.suiteId,
				run.finishedAt,
				JSON.stringify(run)
			);
		},
		pruneRuns(input) {
			const allRows = db
				.prepare(`SELECT record_json FROM ${tableName}`)
				.all() as Array<{
				record_json: string;
			}>;
			const pruned = applyRAGEvaluationHistoryPrunePolicy({
				input,
				runs: allRows.map(
					(row) =>
						JSON.parse(
							row.record_json
						) as RAGAnswerGroundingEvaluationRun
				),
				sort: normalizeGroundingHistoryRuns
			});
			for (const run of pruned.removed) {
				db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(run.id);
			}
			return {
				keptCount: pruned.keptCount,
				removedCount: pruned.removedCount
			} satisfies RAGEvaluationHistoryPruneResult;
		}
	};
};

type SQLiteSearchTraceRow = {
	id: string;
	query: string;
	label: string;
	group_key: string | null;
	tags_json: string | null;
	started_at: number;
	finished_at: number;
	elapsed_ms: number;
	trace_json: string;
	summary_json: string;
	results_json: string;
	metadata_json: string | null;
};

type SQLiteSearchTracePruneHistoryRow = {
	id: string;
	trigger: string;
	started_at: number;
	finished_at: number;
	elapsed_ms: number;
	run_json: string;
};

const isSQLiteSearchTraceRow = (
	value: unknown
): value is SQLiteSearchTraceRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.query === 'string' &&
	typeof value.label === 'string' &&
	(typeof value.group_key === 'string' || value.group_key === null) &&
	(typeof value.tags_json === 'string' || value.tags_json === null) &&
	typeof value.started_at === 'number' &&
	typeof value.finished_at === 'number' &&
	typeof value.elapsed_ms === 'number' &&
	typeof value.trace_json === 'string' &&
	typeof value.summary_json === 'string' &&
	typeof value.results_json === 'string' &&
	(typeof value.metadata_json === 'string' || value.metadata_json === null);

const isSQLiteSearchTracePruneHistoryRow = (
	value: unknown
): value is SQLiteSearchTracePruneHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.trigger === 'string' &&
	typeof value.started_at === 'number' &&
	typeof value.finished_at === 'number' &&
	typeof value.elapsed_ms === 'number' &&
	typeof value.run_json === 'string';

type SQLiteRetrievalComparisonHistoryRow = {
	id: string;
	suite_id: string;
	suite_label: string;
	label: string;
	corpus_group_key: string | null;
	group_key: string | null;
	tags_json: string | null;
	started_at: number;
	finished_at: number;
	elapsed_ms: number;
	comparison_json: string;
	decision_summary_json: string | null;
};

const isSQLiteRetrievalComparisonHistoryRow = (
	value: unknown
): value is SQLiteRetrievalComparisonHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.suite_id === 'string' &&
	typeof value.suite_label === 'string' &&
	typeof value.label === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	(typeof value.group_key === 'string' || value.group_key === null) &&
	(typeof value.tags_json === 'string' || value.tags_json === null) &&
	typeof value.started_at === 'number' &&
	typeof value.finished_at === 'number' &&
	typeof value.elapsed_ms === 'number' &&
	typeof value.comparison_json === 'string' &&
	(typeof value.decision_summary_json === 'string' ||
		value.decision_summary_json === null);

type SQLiteRetrievalReleaseDecisionRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	kind: string;
	decided_at: number;
	record_json: string;
};

const isSQLiteRetrievalReleaseDecisionRow = (
	value: unknown
): value is SQLiteRetrievalReleaseDecisionRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	typeof value.kind === 'string' &&
	typeof value.decided_at === 'number' &&
	typeof value.record_json === 'string';

type SQLiteRetrievalBaselineRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	rollout_label: string | null;
	promoted_at: number;
	status: string;
	version: number;
	tags_json: string | null;
	record_json: string;
};

const isSQLiteRetrievalBaselineRow = (
	value: unknown
): value is SQLiteRetrievalBaselineRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	(typeof value.rollout_label === 'string' || value.rollout_label === null) &&
	typeof value.promoted_at === 'number' &&
	typeof value.status === 'string' &&
	typeof value.version === 'number' &&
	(typeof value.tags_json === 'string' || value.tags_json === null) &&
	typeof value.record_json === 'string';

type SQLiteRetrievalReleaseIncidentRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	target_rollout_label: string | null;
	severity: string;
	status: string;
	triggered_at: number;
	record_json: string;
};

type SQLiteRetrievalLaneHandoffDecisionRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	source_rollout_label: string;
	target_rollout_label: string;
	kind: string;
	decided_at: number;
	record_json: string;
};

type SQLiteRetrievalLaneHandoffIncidentRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	target_rollout_label: string | null;
	source_rollout_label: string | null;
	severity: string;
	status: string;
	triggered_at: number;
	record_json: string;
};

type SQLiteRetrievalLaneHandoffIncidentHistoryRow = {
	id: string;
	incident_id: string;
	corpus_group_key: string | null;
	group_key: string;
	target_rollout_label: string | null;
	action: string;
	recorded_at: number;
	record_json: string;
};

type SQLiteRetrievalIncidentRemediationDecisionRow = {
	id: string;
	incident_id: string;
	group_key: string;
	target_rollout_label: string | null;
	remediation_kind: string;
	status: string;
	decided_at: number;
	record_json: string;
};

type SQLiteRetrievalIncidentRemediationExecutionHistoryRow = {
	id: string;
	incident_id: string | null;
	group_key: string | null;
	target_rollout_label: string | null;
	action_kind: string;
	code: string;
	blocked_by_guardrail: number;
	idempotent_replay: number;
	executed_at: number;
	record_json: string;
};

type SQLiteLaneHandoffAutoCompletePolicyHistoryRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	target_rollout_label: string;
	recorded_at: number;
	record_json: string;
};

type SQLiteReleaseLanePolicyHistoryRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string | null;
	rollout_label: string;
	scope: string;
	recorded_at: number;
	record_json: string;
};

type SQLiteBaselineGatePolicyHistoryRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string | null;
	rollout_label: string;
	scope: string;
	recorded_at: number;
	record_json: string;
};

type SQLiteReleaseLaneEscalationPolicyHistoryRow = {
	id: string;
	corpus_group_key: string | null;
	group_key: string;
	target_rollout_label: string;
	recorded_at: number;
	record_json: string;
};

const isSQLiteRetrievalReleaseIncidentRow = (
	value: unknown
): value is SQLiteRetrievalReleaseIncidentRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	(typeof value.target_rollout_label === 'string' ||
		value.target_rollout_label === null) &&
	typeof value.severity === 'string' &&
	typeof value.status === 'string' &&
	typeof value.triggered_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteRetrievalLaneHandoffDecisionRow = (
	value: unknown
): value is SQLiteRetrievalLaneHandoffDecisionRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	typeof value.source_rollout_label === 'string' &&
	typeof value.target_rollout_label === 'string' &&
	typeof value.kind === 'string' &&
	typeof value.decided_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteRetrievalLaneHandoffIncidentRow = (
	value: unknown
): value is SQLiteRetrievalLaneHandoffIncidentRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	(typeof value.target_rollout_label === 'string' ||
		value.target_rollout_label === null) &&
	(typeof value.source_rollout_label === 'string' ||
		value.source_rollout_label === null) &&
	typeof value.severity === 'string' &&
	typeof value.status === 'string' &&
	typeof value.triggered_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteRetrievalLaneHandoffIncidentHistoryRow = (
	value: unknown
): value is SQLiteRetrievalLaneHandoffIncidentHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.incident_id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	(typeof value.target_rollout_label === 'string' ||
		value.target_rollout_label === null) &&
	typeof value.action === 'string' &&
	typeof value.recorded_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteRetrievalIncidentRemediationDecisionRow = (
	value: unknown
): value is SQLiteRetrievalIncidentRemediationDecisionRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.incident_id === 'string' &&
	typeof value.group_key === 'string' &&
	(typeof value.target_rollout_label === 'string' ||
		value.target_rollout_label === null) &&
	typeof value.remediation_kind === 'string' &&
	typeof value.status === 'string' &&
	typeof value.decided_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteRetrievalIncidentRemediationExecutionHistoryRow = (
	value: unknown
): value is SQLiteRetrievalIncidentRemediationExecutionHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.incident_id === 'string' || value.incident_id === null) &&
	(typeof value.group_key === 'string' || value.group_key === null) &&
	(typeof value.target_rollout_label === 'string' ||
		value.target_rollout_label === null) &&
	typeof value.action_kind === 'string' &&
	typeof value.code === 'string' &&
	typeof value.blocked_by_guardrail === 'number' &&
	typeof value.idempotent_replay === 'number' &&
	typeof value.executed_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteLaneHandoffAutoCompletePolicyHistoryRow = (
	value: unknown
): value is SQLiteLaneHandoffAutoCompletePolicyHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	typeof value.target_rollout_label === 'string' &&
	typeof value.recorded_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteReleaseLanePolicyHistoryRow = (
	value: unknown
): value is SQLiteReleaseLanePolicyHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	(typeof value.group_key === 'string' || value.group_key === null) &&
	typeof value.rollout_label === 'string' &&
	typeof value.scope === 'string' &&
	typeof value.recorded_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteBaselineGatePolicyHistoryRow = (
	value: unknown
): value is SQLiteBaselineGatePolicyHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	(typeof value.group_key === 'string' || value.group_key === null) &&
	typeof value.rollout_label === 'string' &&
	typeof value.scope === 'string' &&
	typeof value.recorded_at === 'number' &&
	typeof value.record_json === 'string';

const isSQLiteReleaseLaneEscalationPolicyHistoryRow = (
	value: unknown
): value is SQLiteReleaseLaneEscalationPolicyHistoryRow =>
	isObjectRecord(value) &&
	typeof value.id === 'string' &&
	(typeof value.corpus_group_key === 'string' ||
		value.corpus_group_key === null) &&
	typeof value.group_key === 'string' &&
	typeof value.target_rollout_label === 'string' &&
	typeof value.recorded_at === 'number' &&
	typeof value.record_json === 'string';

const assertSupportedIdentifier = (name: string) => {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		throw new Error(
			`Invalid SQLite search trace table name "${name}". Only alphanumeric and underscore names are allowed.`
		);
	}
};

const ensureSQLiteColumns = (
	db: Database,
	tableName: string,
	columns: Array<{ name: string; definition: string }>
) => {
	const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all();
	const existing = new Set(
		Array.isArray(pragma)
			? pragma
					.filter(
						(row): row is { name?: unknown } =>
							isObjectRecord(row) && 'name' in row
					)
					.map((row) =>
						typeof row.name === 'string' ? row.name : undefined
					)
					.filter((name): name is string => typeof name === 'string')
			: []
	);

	for (const column of columns) {
		if (existing.has(column.name)) {
			continue;
		}
		db.exec(
			`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`
		);
	}
};

const getMissingSQLiteColumns = (
	db: Database,
	tableName: string,
	columns: Array<{ name: string; definition: string }>
): RAGSQLiteStoreMigrationIssue[] => {
	const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all();
	const existing = new Set(
		Array.isArray(pragma)
			? pragma
					.filter(
						(row): row is { name?: unknown } =>
							isObjectRecord(row) && 'name' in row
					)
					.map((row) =>
						typeof row.name === 'string' ? row.name : undefined
					)
					.filter((name): name is string => typeof name === 'string')
			: []
	);

	return columns
		.filter((column) => !existing.has(column.name))
		.map((column) => ({
			columnName: column.name,
			definition: column.definition,
			tableName
		}));
};

type SQLiteStoreMigrationDescriptor = {
	tableName: string;
	columns: Array<{ name: string; definition: string }>;
};

const getDefaultSQLiteStoreMigrationDescriptors =
	(): SQLiteStoreMigrationDescriptor[] => [
		{
			tableName: DEFAULT_RETRIEVAL_COMPARISON_HISTORY_TABLE_NAME,
			columns: [{ definition: 'TEXT', name: 'corpus_group_key' }]
		},
		{
			tableName: DEFAULT_RETRIEVAL_RELEASE_DECISION_TABLE_NAME,
			columns: [{ definition: 'TEXT', name: 'corpus_group_key' }]
		},
		{
			tableName: DEFAULT_RETRIEVAL_BASELINE_TABLE_NAME,
			columns: [
				{ definition: 'TEXT', name: 'group_key' },
				{ definition: 'TEXT', name: 'corpus_group_key' }
			]
		}
	];

const summarizeSQLiteStoreMigrationIssues = (
	issues: RAGSQLiteStoreMigrationIssue[]
) =>
	issues.length > 0
		? `${issues.length} SQLite schema migration issue${issues.length === 1 ? '' : 's'} detected`
		: undefined;

export type SQLiteRAGStoreMigrationOptions = {
	db?: Database;
	path?: string;
	descriptors?: SQLiteStoreMigrationDescriptor[];
};

export const inspectRAGSQLiteStoreMigrations = (
	options: SQLiteRAGStoreMigrationOptions = {}
): RAGSQLiteStoreMigrationInspection => {
	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');
	const descriptors =
		options.descriptors ?? getDefaultSQLiteStoreMigrationDescriptors();
	const issues = descriptors.flatMap((descriptor) =>
		getMissingSQLiteColumns(db, descriptor.tableName, descriptor.columns)
	);

	return {
		issues,
		summary: summarizeSQLiteStoreMigrationIssues(issues)
	};
};

export const applyRAGSQLiteStoreMigrations = (
	options: SQLiteRAGStoreMigrationOptions = {}
): RAGSQLiteStoreMigrationResult => {
	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');
	const descriptors =
		options.descriptors ?? getDefaultSQLiteStoreMigrationDescriptors();
	const inspection = inspectRAGSQLiteStoreMigrations({
		db,
		descriptors
	});

	for (const descriptor of descriptors) {
		ensureSQLiteColumns(db, descriptor.tableName, descriptor.columns);
	}

	return {
		...inspection,
		applied: inspection.issues
	};
};

const mapSQLiteSearchTraceRow = (
	row: SQLiteSearchTraceRow
): RAGSearchTraceRecord => ({
	elapsedMs: row.elapsed_ms,
	finishedAt: row.finished_at,
	groupKey: row.group_key ?? undefined,
	id: row.id,
	label: row.label,
	metadata: parseJSONRecord(row.metadata_json),
	query: row.query,
	results: parseJSONArray(row.results_json, []),
	startedAt: row.started_at,
	summary: JSON.parse(row.summary_json),
	tags: normalizeStringArray(parseJSONArray(row.tags_json, [])),
	trace: JSON.parse(row.trace_json)
});

const mapSQLiteSearchTracePruneHistoryRow = (
	row: SQLiteSearchTracePruneHistoryRow
): RAGSearchTracePruneRun => JSON.parse(row.run_json);

const mapSQLiteRetrievalComparisonHistoryRow = (
	row: SQLiteRetrievalComparisonHistoryRow
): RAGRetrievalComparisonRun => ({
	comparison: JSON.parse(row.comparison_json),
	corpusGroupKey: row.corpus_group_key ?? undefined,
	decisionSummary: row.decision_summary_json
		? JSON.parse(row.decision_summary_json)
		: undefined,
	elapsedMs: row.elapsed_ms,
	finishedAt: row.finished_at,
	groupKey: row.group_key ?? undefined,
	id: row.id,
	label: row.label,
	startedAt: row.started_at,
	suiteId: row.suite_id,
	suiteLabel: row.suite_label,
	tags: normalizeStringArray(parseJSONArray(row.tags_json, []))
});

const mapSQLiteRetrievalReleaseDecisionRow = (
	row: SQLiteRetrievalReleaseDecisionRow
): RAGRetrievalReleaseDecisionRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalBaselineRow = (
	row: SQLiteRetrievalBaselineRow
): RAGRetrievalBaselineRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalReleaseIncidentRow = (
	row: SQLiteRetrievalReleaseIncidentRow
): RAGRetrievalReleaseIncidentRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalLaneHandoffDecisionRow = (
	row: SQLiteRetrievalLaneHandoffDecisionRow
): RAGRetrievalLaneHandoffDecisionRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalLaneHandoffIncidentRow = (
	row: SQLiteRetrievalLaneHandoffIncidentRow
): RAGRetrievalLaneHandoffIncidentRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalLaneHandoffIncidentHistoryRow = (
	row: SQLiteRetrievalLaneHandoffIncidentHistoryRow
): RAGRetrievalLaneHandoffIncidentHistoryRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalIncidentRemediationDecisionRow = (
	row: SQLiteRetrievalIncidentRemediationDecisionRow
): RAGRetrievalIncidentRemediationDecisionRecord => JSON.parse(row.record_json);

const mapSQLiteRetrievalIncidentRemediationExecutionHistoryRow = (
	row: SQLiteRetrievalIncidentRemediationExecutionHistoryRow
): RAGRetrievalIncidentRemediationExecutionHistoryRecord =>
	JSON.parse(row.record_json);

const mapSQLiteLaneHandoffAutoCompletePolicyHistoryRow = (
	row: SQLiteLaneHandoffAutoCompletePolicyHistoryRow
): RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord =>
	JSON.parse(row.record_json);

const mapSQLiteReleaseLanePolicyHistoryRow = (
	row: SQLiteReleaseLanePolicyHistoryRow
): RAGRetrievalReleaseLanePolicyHistoryRecord => JSON.parse(row.record_json);

const mapSQLiteBaselineGatePolicyHistoryRow = (
	row: SQLiteBaselineGatePolicyHistoryRow
): RAGRetrievalBaselineGatePolicyHistoryRecord => JSON.parse(row.record_json);

const mapSQLiteReleaseLaneEscalationPolicyHistoryRow = (
	row: SQLiteReleaseLaneEscalationPolicyHistoryRow
): RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord =>
	JSON.parse(row.record_json);

export const createRAGSQLiteSearchTraceStore = (
	options: SQLiteRAGSearchTraceStoreOptions
): RAGSearchTraceStore => {
	const tableName = options.tableName ?? DEFAULT_SEARCH_TRACE_TABLE_NAME;
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			query TEXT NOT NULL,
			label TEXT NOT NULL,
			group_key TEXT,
			tags_json TEXT,
			started_at INTEGER NOT NULL,
			finished_at INTEGER NOT NULL,
			elapsed_ms INTEGER NOT NULL,
			trace_json TEXT NOT NULL,
			summary_json TEXT NOT NULL,
			results_json TEXT NOT NULL,
			metadata_json TEXT
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_query_finished_at_idx ON ${tableName} (query, finished_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_finished_at_idx ON ${tableName} (group_key, finished_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_finished_at_idx ON ${tableName} (finished_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			query,
			label,
			group_key,
			tags_json,
			started_at,
			finished_at,
			elapsed_ms,
			trace_json,
			summary_json,
			results_json,
			metadata_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			query,
			label,
			group_key,
			tags_json,
			started_at,
			finished_at,
			elapsed_ms,
			trace_json,
			summary_json,
			results_json,
			metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			query = excluded.query,
			label = excluded.label,
			group_key = excluded.group_key,
			tags_json = excluded.tags_json,
			started_at = excluded.started_at,
			finished_at = excluded.finished_at,
			elapsed_ms = excluded.elapsed_ms,
			trace_json = excluded.trace_json,
			summary_json = excluded.summary_json,
			results_json = excluded.results_json,
			metadata_json = excluded.metadata_json
	`);
	const remove = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);

	return {
		listTraces(input) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input?.query) {
				where.push('query = ?');
				params.push(input.query);
			}

			if (input?.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY finished_at DESC';
			const rows = db.prepare(sql).all(...params);
			const traces = Array.isArray(rows)
				? rows
						.filter(isSQLiteSearchTraceRow)
						.map(mapSQLiteSearchTraceRow)
				: [];
			const filtered = input?.tag
				? traces.filter((trace) =>
						(trace.tags ?? []).includes(input.tag as string)
					)
				: traces;

			return normalizeTraceSummaryRuns(filtered).slice(
				0,
				input?.limit ?? DEFAULT_HISTORY_LIMIT
			);
		},
		saveTrace(trace) {
			insert.run(
				trace.id,
				trace.query,
				trace.label,
				trace.groupKey ?? null,
				JSON.stringify(trace.tags ?? []),
				trace.startedAt,
				trace.finishedAt,
				trace.elapsedMs,
				JSON.stringify(trace.trace),
				JSON.stringify(trace.summary),
				JSON.stringify(trace.results),
				trace.metadata === undefined
					? null
					: JSON.stringify(trace.metadata)
			);
		},
		pruneTraces(input) {
			const rows = db
				.prepare(`${listBase} ORDER BY finished_at DESC`)
				.all();
			const traces = Array.isArray(rows)
				? rows
						.filter(isSQLiteSearchTraceRow)
						.map(mapSQLiteSearchTraceRow)
				: [];
			const pruned = applyRAGSearchTracePrunePolicy({
				input,
				traces
			});

			for (const trace of pruned.removed) {
				remove.run(trace.id);
			}

			return {
				keptCount: pruned.keptCount,
				removedCount: pruned.removedCount
			};
		}
	};
};

export const createRAGSQLiteSearchTracePruneHistoryStore = (
	options: SQLiteRAGSearchTracePruneHistoryStoreOptions
): RAGSearchTracePruneHistoryStore => {
	const tableName = options.tableName ?? 'rag_search_trace_prune_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			trigger TEXT NOT NULL,
			started_at INTEGER NOT NULL,
			finished_at INTEGER NOT NULL,
			elapsed_ms INTEGER NOT NULL,
			run_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_trigger_finished_at_idx ON ${tableName} (trigger, finished_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_finished_at_idx ON ${tableName} (finished_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			trigger,
			started_at,
			finished_at,
			elapsed_ms,
			run_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			trigger,
			started_at,
			finished_at,
			elapsed_ms,
			run_json
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			trigger = excluded.trigger,
			started_at = excluded.started_at,
			finished_at = excluded.finished_at,
			elapsed_ms = excluded.elapsed_ms,
			run_json = excluded.run_json
	`);

	return {
		listRuns(input) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input?.trigger) {
				where.push('trigger = ?');
				params.push(input.trigger);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY finished_at DESC';
			const rows = db.prepare(sql).all(...params);
			const runs = Array.isArray(rows)
				? rows
						.filter(isSQLiteSearchTracePruneHistoryRow)
						.map(mapSQLiteSearchTracePruneHistoryRow)
				: [];
			const sorted = normalizeSearchTracePruneRuns(runs);
			return typeof input?.limit === 'number'
				? sorted.slice(0, input.limit)
				: sorted;
		},
		saveRun(run) {
			insert.run(
				run.id,
				run.trigger,
				run.startedAt,
				run.finishedAt,
				run.elapsedMs,
				JSON.stringify(run)
			);
		}
	};
};

export const createRAGSQLiteRetrievalComparisonHistoryStore = (
	options: SQLiteRAGRetrievalComparisonHistoryStoreOptions
): RAGRetrievalComparisonHistoryStore => {
	const tableName =
		options.tableName ?? DEFAULT_RETRIEVAL_COMPARISON_HISTORY_TABLE_NAME;
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			suite_id TEXT NOT NULL,
			suite_label TEXT NOT NULL,
			label TEXT NOT NULL,
			corpus_group_key TEXT,
			group_key TEXT,
			tags_json TEXT,
			started_at INTEGER NOT NULL,
			finished_at INTEGER NOT NULL,
			elapsed_ms INTEGER NOT NULL,
			comparison_json TEXT NOT NULL,
			decision_summary_json TEXT
		)
	`);
	ensureSQLiteColumns(db, tableName, [
		{ definition: 'TEXT', name: 'corpus_group_key' }
	]);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_suite_finished_at_idx ON ${tableName} (suite_id, finished_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_finished_at_idx ON ${tableName} (group_key, finished_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_finished_at_idx ON ${tableName} (corpus_group_key, finished_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_finished_at_idx ON ${tableName} (finished_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			suite_id,
			suite_label,
			label,
			corpus_group_key,
			group_key,
			tags_json,
			started_at,
			finished_at,
			elapsed_ms,
			comparison_json,
			decision_summary_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			suite_id,
			suite_label,
			label,
			corpus_group_key,
			group_key,
			tags_json,
			started_at,
			finished_at,
			elapsed_ms,
			comparison_json,
			decision_summary_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			suite_id = excluded.suite_id,
			suite_label = excluded.suite_label,
			label = excluded.label,
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			tags_json = excluded.tags_json,
			started_at = excluded.started_at,
			finished_at = excluded.finished_at,
			elapsed_ms = excluded.elapsed_ms,
			comparison_json = excluded.comparison_json,
			decision_summary_json = excluded.decision_summary_json
	`);

	return {
		listRuns(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.suiteId) {
				where.push('suite_id = ?');
				params.push(input.suiteId);
			}

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY finished_at DESC';
			const rows = db.prepare(sql).all(...params);
			const runs = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalComparisonHistoryRow)
						.map(mapSQLiteRetrievalComparisonHistoryRow)
				: [];
			const normalizedLabel = normalizeLabelFilter(input.label);
			const filtered = normalizeRetrievalComparisonRuns(
				runs.filter(
					(entry) =>
						(!input.tag ||
							(entry.tags ?? []).includes(input.tag)) &&
						(!normalizedLabel ||
							entry.label
								.toLowerCase()
								.includes(normalizedLabel) ||
							entry.suiteLabel
								.toLowerCase()
								.includes(normalizedLabel)) &&
						matchesWinner(entry, input.winnerId)
				)
			);

			return typeof input.limit === 'number'
				? filtered.slice(0, input.limit)
				: filtered;
		},
		saveRun(run) {
			insert.run(
				run.id,
				run.suiteId,
				run.suiteLabel,
				run.label,
				run.corpusGroupKey ?? null,
				run.groupKey ?? null,
				JSON.stringify(run.tags ?? []),
				run.startedAt,
				run.finishedAt,
				run.elapsedMs,
				JSON.stringify(run.comparison),
				run.decisionSummary === undefined
					? null
					: JSON.stringify(run.decisionSummary)
			);
		}
	};
};

export const createRAGSQLiteRetrievalReleaseDecisionStore = (
	options: SQLiteRAGRetrievalReleaseDecisionStoreOptions
): RAGRetrievalReleaseDecisionStore => {
	const tableName =
		options.tableName ?? DEFAULT_RETRIEVAL_RELEASE_DECISION_TABLE_NAME;
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT NOT NULL,
			kind TEXT NOT NULL,
			decided_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	ensureSQLiteColumns(db, tableName, [
		{ definition: 'TEXT', name: 'corpus_group_key' }
	]);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_decided_at_idx ON ${tableName} (group_key, decided_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_decided_at_idx ON ${tableName} (corpus_group_key, decided_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_kind_decided_at_idx ON ${tableName} (kind, decided_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			kind,
			decided_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			kind,
			decided_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			kind = excluded.kind,
			decided_at = excluded.decided_at,
			record_json = excluded.record_json
	`);

	return {
		listDecisions(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			if (input.kind) {
				where.push('kind = ?');
				params.push(input.kind);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY decided_at DESC';
			const rows = db.prepare(sql).all(...params);
			const decisions = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalReleaseDecisionRow)
						.map(mapSQLiteRetrievalReleaseDecisionRow)
				: [];
			const sorted = normalizeRetrievalReleaseDecisionRecords(decisions);

			return typeof input.limit === 'number'
				? sorted.slice(0, input.limit)
				: sorted;
		},
		saveDecision(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey,
				record.kind,
				record.decidedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalBaselineStore = (
	options: SQLiteRAGRetrievalBaselineStoreOptions
): RAGRetrievalBaselineStore => {
	const tableName =
		options.tableName ?? DEFAULT_RETRIEVAL_BASELINE_TABLE_NAME;
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT NOT NULL,
			rollout_label TEXT,
			promoted_at INTEGER NOT NULL,
			status TEXT NOT NULL,
			version INTEGER NOT NULL,
			tags_json TEXT,
			record_json TEXT NOT NULL
		)
	`);
	ensureSQLiteColumns(db, tableName, [
		{ definition: 'TEXT', name: 'corpus_group_key' }
	]);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_promoted_at_idx ON ${tableName} (group_key, promoted_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_promoted_at_idx ON ${tableName} (corpus_group_key, promoted_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_rollout_status_idx ON ${tableName} (group_key, rollout_label, status)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			promoted_at,
			status,
			version,
			tags_json,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			promoted_at,
			status,
			version,
			tags_json,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			rollout_label = excluded.rollout_label,
			promoted_at = excluded.promoted_at,
			status = excluded.status,
			version = excluded.version,
			tags_json = excluded.tags_json,
			record_json = excluded.record_json
	`);
	const updateExisting = db.prepare(`
		UPDATE ${tableName}
		SET
			status = ?,
			record_json = ?
		WHERE id = ?
	`);
	const currentVersion = db.prepare(`
		SELECT COALESCE(MAX(version), 0) AS max_version
		FROM ${tableName}
		WHERE group_key = ?
	`);
	const matchingRolloutRows = db.prepare(`
		SELECT
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			promoted_at,
			status,
			version,
			tags_json,
			record_json
		FROM ${tableName}
		WHERE group_key = ?
			AND (
				(rollout_label IS NULL AND ? IS NULL) OR
				rollout_label = ?
			)
	`);

	const listBaselinesSync = (
		input: Parameters<RAGRetrievalBaselineStore['listBaselines']>[0] = {}
	): RAGRetrievalBaselineRecord[] => {
		const where: string[] = [];
		const params: Array<string | number> = [];

		if (input.corpusGroupKey) {
			where.push('corpus_group_key = ?');
			params.push(input.corpusGroupKey);
		}

		if (input.groupKey) {
			where.push('group_key = ?');
			params.push(input.groupKey);
		}

		if (input.status) {
			where.push('status = ?');
			params.push(input.status);
		}

		const sql =
			`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
			'ORDER BY promoted_at DESC';
		const rows = db.prepare(sql).all(...params);
		const baselines = Array.isArray(rows)
			? rows
					.filter(isSQLiteRetrievalBaselineRow)
					.map(mapSQLiteRetrievalBaselineRow)
			: [];
		const tag = typeof input.tag === 'string' ? input.tag : undefined;
		const filtered = tag
			? baselines.filter((entry) => (entry.tags ?? []).includes(tag))
			: baselines;
		const sorted = normalizeRetrievalBaselineRecords(filtered);

		return typeof input.limit === 'number'
			? sorted.slice(0, input.limit)
			: sorted;
	};

	return {
		getBaseline(groupKey) {
			const baselines = listBaselinesSync({ groupKey, limit: 1 });
			return Promise.resolve(baselines[0] ?? null);
		},
		listBaselines(input) {
			return Promise.resolve(listBaselinesSync(input));
		},
		saveBaseline(record) {
			const versionRow = currentVersion.get(record.groupKey) as
				| { max_version?: number }
				| undefined;
			const nextVersion =
				typeof record.version === 'number'
					? record.version
					: (versionRow?.max_version ?? 0) + 1;
			const nextRecord: RAGRetrievalBaselineRecord = {
				...record,
				status: 'active',
				version: nextVersion
			};

			const rows = matchingRolloutRows.all(
				record.groupKey,
				record.rolloutLabel ?? null,
				record.rolloutLabel ?? null
			);
			const existing = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalBaselineRow)
						.map(mapSQLiteRetrievalBaselineRow)
				: [];

			for (const entry of existing) {
				updateExisting.run(
					'superseded',
					JSON.stringify({
						...entry,
						status: 'superseded'
					}),
					entry.id
				);
			}

			insert.run(
				nextRecord.id,
				nextRecord.corpusGroupKey ?? null,
				nextRecord.groupKey,
				nextRecord.rolloutLabel ?? null,
				nextRecord.promotedAt,
				nextRecord.status,
				nextRecord.version,
				JSON.stringify(nextRecord.tags ?? []),
				JSON.stringify(nextRecord)
			);
		}
	};
};

export const createRAGSQLiteRetrievalReleaseIncidentStore = (
	options: SQLiteRAGRetrievalReleaseIncidentStoreOptions
): RAGRetrievalReleaseIncidentStore => {
	const tableName =
		options.tableName ?? DEFAULT_RETRIEVAL_RELEASE_INCIDENT_TABLE_NAME;
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT NOT NULL,
			target_rollout_label TEXT,
			severity TEXT NOT NULL,
			status TEXT NOT NULL,
			triggered_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_triggered_at_idx ON ${tableName} (group_key, triggered_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_status_idx ON ${tableName} (corpus_group_key, status, triggered_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			target_rollout_label,
			severity,
			status,
			triggered_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			target_rollout_label,
			severity,
			status,
			triggered_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			target_rollout_label = excluded.target_rollout_label,
			severity = excluded.severity,
			status = excluded.status,
			triggered_at = excluded.triggered_at,
			record_json = excluded.record_json
	`);

	return {
		listIncidents(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			if (input.targetRolloutLabel) {
				where.push('target_rollout_label = ?');
				params.push(input.targetRolloutLabel);
			}

			if (input.severity) {
				where.push('severity = ?');
				params.push(input.severity);
			}

			if (input.status) {
				where.push('status = ?');
				params.push(input.status);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY triggered_at DESC';
			const rows = db.prepare(sql).all(...params);
			const incidents = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalReleaseIncidentRow)
						.map(mapSQLiteRetrievalReleaseIncidentRow)
				: [];
			const sorted = normalizeRetrievalReleaseIncidentRecords(incidents);

			return typeof input.limit === 'number'
				? sorted.slice(0, input.limit)
				: sorted;
		},
		saveIncident(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey,
				record.targetRolloutLabel ?? null,
				record.severity,
				record.status,
				record.triggeredAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalLaneHandoffDecisionStore = (
	options: SQLiteRAGRetrievalLaneHandoffDecisionStoreOptions
): RAGRetrievalLaneHandoffDecisionStore => {
	const tableName =
		options.tableName ?? 'rag_retrieval_lane_handoff_decisions';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT NOT NULL,
			source_rollout_label TEXT NOT NULL,
			target_rollout_label TEXT NOT NULL,
			kind TEXT NOT NULL,
			decided_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_decided_at_idx ON ${tableName} (group_key, decided_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_rollout_idx ON ${tableName} (corpus_group_key, source_rollout_label, target_rollout_label, decided_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			source_rollout_label,
			target_rollout_label,
			kind,
			decided_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			source_rollout_label,
			target_rollout_label,
			kind,
			decided_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			source_rollout_label = excluded.source_rollout_label,
			target_rollout_label = excluded.target_rollout_label,
			kind = excluded.kind,
			decided_at = excluded.decided_at,
			record_json = excluded.record_json
	`);

	return {
		listDecisions(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			if (input.kind) {
				where.push('kind = ?');
				params.push(input.kind);
			}

			if (input.sourceRolloutLabel) {
				where.push('source_rollout_label = ?');
				params.push(input.sourceRolloutLabel);
			}

			if (input.targetRolloutLabel) {
				where.push('target_rollout_label = ?');
				params.push(input.targetRolloutLabel);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY decided_at DESC';
			const rows = db.prepare(sql).all(...params);
			const decisions = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalLaneHandoffDecisionRow)
						.map(mapSQLiteRetrievalLaneHandoffDecisionRow)
				: [];
			const sorted =
				normalizeRetrievalLaneHandoffDecisionRecords(decisions);

			return typeof input.limit === 'number'
				? sorted.slice(0, input.limit)
				: sorted;
		},
		saveDecision(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey,
				record.sourceRolloutLabel,
				record.targetRolloutLabel,
				record.kind,
				record.decidedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalLaneHandoffIncidentStore = (
	options: SQLiteRAGRetrievalLaneHandoffIncidentStoreOptions
): RAGRetrievalLaneHandoffIncidentStore => {
	const tableName =
		options.tableName ?? 'rag_retrieval_lane_handoff_incidents';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT NOT NULL,
			target_rollout_label TEXT,
			source_rollout_label TEXT,
			severity TEXT NOT NULL,
			status TEXT NOT NULL,
			triggered_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_triggered_at_idx ON ${tableName} (group_key, triggered_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_status_idx ON ${tableName} (corpus_group_key, status, triggered_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			target_rollout_label,
			source_rollout_label,
			severity,
			status,
			triggered_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			target_rollout_label,
			source_rollout_label,
			severity,
			status,
			triggered_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			target_rollout_label = excluded.target_rollout_label,
			source_rollout_label = excluded.source_rollout_label,
			severity = excluded.severity,
			status = excluded.status,
			triggered_at = excluded.triggered_at,
			record_json = excluded.record_json
	`);

	return {
		listIncidents(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			if (input.targetRolloutLabel) {
				where.push('target_rollout_label = ?');
				params.push(input.targetRolloutLabel);
			}

			if (input.severity) {
				where.push('severity = ?');
				params.push(input.severity);
			}

			if (input.status) {
				where.push('status = ?');
				params.push(input.status);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY triggered_at DESC';
			const rows = db.prepare(sql).all(...params);
			const incidents = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalLaneHandoffIncidentRow)
						.map(mapSQLiteRetrievalLaneHandoffIncidentRow)
				: [];
			const sorted = normalizeRetrievalReleaseIncidentRecords(
				incidents as RAGRetrievalReleaseIncidentRecord[]
			) as RAGRetrievalLaneHandoffIncidentRecord[];

			return typeof input.limit === 'number'
				? sorted.slice(0, input.limit)
				: sorted;
		},
		saveIncident(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey,
				record.targetRolloutLabel ?? null,
				record.sourceRolloutLabel ?? null,
				record.severity,
				record.status,
				record.triggeredAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalLaneHandoffIncidentHistoryStore = (
	options: SQLiteRAGRetrievalLaneHandoffIncidentHistoryStoreOptions
): RAGRetrievalLaneHandoffIncidentHistoryStore => {
	const tableName =
		options.tableName ?? 'rag_retrieval_lane_handoff_incident_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			incident_id TEXT NOT NULL,
			corpus_group_key TEXT,
			group_key TEXT NOT NULL,
			target_rollout_label TEXT,
			action TEXT NOT NULL,
			recorded_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_recorded_at_idx ON ${tableName} (group_key, recorded_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_incident_recorded_at_idx ON ${tableName} (incident_id, recorded_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			incident_id,
			corpus_group_key,
			group_key,
			target_rollout_label,
			action,
			recorded_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			incident_id,
			corpus_group_key,
			group_key,
			target_rollout_label,
			action,
			recorded_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			incident_id = excluded.incident_id,
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			target_rollout_label = excluded.target_rollout_label,
			action = excluded.action,
			recorded_at = excluded.recorded_at,
			record_json = excluded.record_json
	`);

	return {
		listRecords(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			if (input.incidentId) {
				where.push('incident_id = ?');
				params.push(input.incidentId);
			}

			if (input.targetRolloutLabel) {
				where.push('target_rollout_label = ?');
				params.push(input.targetRolloutLabel);
			}

			if (input.action) {
				where.push('action = ?');
				params.push(input.action);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY recorded_at DESC';
			const rows = db.prepare(sql).all(...params);
			const records = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalLaneHandoffIncidentHistoryRow)
						.map(mapSQLiteRetrievalLaneHandoffIncidentHistoryRow)
				: [];

			return typeof input.limit === 'number'
				? records.slice(0, input.limit)
				: records;
		},
		saveRecord(record) {
			insert.run(
				record.id,
				record.incidentId,
				record.corpusGroupKey ?? null,
				record.groupKey,
				record.targetRolloutLabel ?? null,
				record.action,
				record.recordedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalIncidentRemediationDecisionStore = (
	options: SQLiteRAGRetrievalIncidentRemediationDecisionStoreOptions
): RAGRetrievalIncidentRemediationDecisionStore => {
	const tableName =
		options.tableName ?? 'rag_retrieval_incident_remediation_decisions';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			incident_id TEXT NOT NULL,
			group_key TEXT NOT NULL,
			target_rollout_label TEXT,
			remediation_kind TEXT NOT NULL,
			status TEXT NOT NULL,
			decided_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_decided_at_idx ON ${tableName} (group_key, decided_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_incident_status_idx ON ${tableName} (incident_id, status, decided_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			incident_id,
			group_key,
			target_rollout_label,
			remediation_kind,
			status,
			decided_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			incident_id,
			group_key,
			target_rollout_label,
			remediation_kind,
			status,
			decided_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			incident_id = excluded.incident_id,
			group_key = excluded.group_key,
			target_rollout_label = excluded.target_rollout_label,
			remediation_kind = excluded.remediation_kind,
			status = excluded.status,
			decided_at = excluded.decided_at,
			record_json = excluded.record_json
	`);

	return {
		listRecords(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}

			if (input.incidentId) {
				where.push('incident_id = ?');
				params.push(input.incidentId);
			}

			if (input.remediationKind) {
				where.push('remediation_kind = ?');
				params.push(input.remediationKind);
			}

			if (input.status) {
				where.push('status = ?');
				params.push(input.status);
			}

			if (input.targetRolloutLabel) {
				where.push('target_rollout_label = ?');
				params.push(input.targetRolloutLabel);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY decided_at DESC';
			const rows = db.prepare(sql).all(...params);
			const records = Array.isArray(rows)
				? rows
						.filter(isSQLiteRetrievalIncidentRemediationDecisionRow)
						.map(mapSQLiteRetrievalIncidentRemediationDecisionRow)
				: [];
			const sorted =
				normalizeRetrievalIncidentRemediationDecisionRecords(records);

			return typeof input.limit === 'number'
				? sorted.slice(0, input.limit)
				: sorted;
		},
		saveRecord(record) {
			insert.run(
				record.id,
				record.incidentId,
				record.groupKey,
				record.targetRolloutLabel ?? null,
				record.remediationKind,
				record.status,
				record.decidedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalIncidentRemediationExecutionHistoryStore =
	(
		options: SQLiteRAGRetrievalIncidentRemediationExecutionHistoryStoreOptions
	): RAGRetrievalIncidentRemediationExecutionHistoryStore => {
		const tableName =
			options.tableName ??
			'rag_retrieval_incident_remediation_execution_history';
		assertSupportedIdentifier(tableName);

		const db =
			options.db ??
			new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

		db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			incident_id TEXT,
			group_key TEXT,
			target_rollout_label TEXT,
			action_kind TEXT NOT NULL,
			code TEXT NOT NULL,
			blocked_by_guardrail INTEGER NOT NULL,
			idempotent_replay INTEGER NOT NULL,
			executed_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
		db.exec(
			`CREATE INDEX IF NOT EXISTS ${tableName}_group_executed_at_idx ON ${tableName} (group_key, executed_at DESC)`
		);
		db.exec(
			`CREATE INDEX IF NOT EXISTS ${tableName}_incident_code_idx ON ${tableName} (incident_id, code, executed_at DESC)`
		);

		const listBase = `
		SELECT
			id,
			incident_id,
			group_key,
			target_rollout_label,
			action_kind,
			code,
			blocked_by_guardrail,
			idempotent_replay,
			executed_at,
			record_json
		FROM ${tableName}
	`;
		const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			incident_id,
			group_key,
			target_rollout_label,
			action_kind,
			code,
			blocked_by_guardrail,
			idempotent_replay,
			executed_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			incident_id = excluded.incident_id,
			group_key = excluded.group_key,
			target_rollout_label = excluded.target_rollout_label,
			action_kind = excluded.action_kind,
			code = excluded.code,
			blocked_by_guardrail = excluded.blocked_by_guardrail,
			idempotent_replay = excluded.idempotent_replay,
			executed_at = excluded.executed_at,
			record_json = excluded.record_json
	`);

		return {
			listRecords(input = {}) {
				const where: string[] = [];
				const params: Array<string | number> = [];

				if (input.groupKey) {
					where.push('group_key = ?');
					params.push(input.groupKey);
				}

				if (input.incidentId) {
					where.push('incident_id = ?');
					params.push(input.incidentId);
				}

				if (input.actionKind) {
					where.push('action_kind = ?');
					params.push(input.actionKind);
				}

				if (input.code) {
					where.push('code = ?');
					params.push(input.code);
				}

				if (typeof input.blockedByGuardrail === 'boolean') {
					where.push('blocked_by_guardrail = ?');
					params.push(input.blockedByGuardrail ? 1 : 0);
				}

				if (typeof input.idempotentReplay === 'boolean') {
					where.push('idempotent_replay = ?');
					params.push(input.idempotentReplay ? 1 : 0);
				}

				if (input.targetRolloutLabel) {
					where.push('target_rollout_label = ?');
					params.push(input.targetRolloutLabel);
				}

				const sql =
					`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
					'ORDER BY executed_at DESC';
				const rows = db.prepare(sql).all(...params);
				const records = Array.isArray(rows)
					? rows
							.filter(
								isSQLiteRetrievalIncidentRemediationExecutionHistoryRow
							)
							.map(
								mapSQLiteRetrievalIncidentRemediationExecutionHistoryRow
							)
					: [];
				const sorted =
					normalizeRetrievalIncidentRemediationExecutionHistoryRecords(
						records
					);

				return typeof input.limit === 'number'
					? sorted.slice(0, input.limit)
					: sorted;
			},
			saveRecord(record) {
				insert.run(
					record.id,
					record.incidentId ?? null,
					record.groupKey ?? null,
					record.targetRolloutLabel ?? null,
					record.action.kind,
					record.code,
					record.blockedByGuardrail ? 1 : 0,
					record.idempotentReplay ? 1 : 0,
					record.executedAt,
					JSON.stringify(record)
				);
			}
		};
	};

export const createRAGSQLiteRetrievalLaneHandoffAutoCompletePolicyHistoryStore =
	(
		options: SQLiteRAGRetrievalLaneHandoffAutoCompletePolicyHistoryStoreOptions
	): RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore => {
		const tableName =
			options.tableName ??
			'rag_retrieval_lane_handoff_auto_complete_policy_history';
		assertSupportedIdentifier(tableName);

		const db =
			options.db ??
			new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

		db.exec(`
			CREATE TABLE IF NOT EXISTS ${tableName} (
				id TEXT PRIMARY KEY,
				corpus_group_key TEXT,
				group_key TEXT NOT NULL,
				target_rollout_label TEXT NOT NULL,
				recorded_at INTEGER NOT NULL,
				record_json TEXT NOT NULL
			)
		`);
		db.exec(
			`CREATE INDEX IF NOT EXISTS ${tableName}_group_recorded_at_idx ON ${tableName} (group_key, recorded_at DESC)`
		);
		db.exec(
			`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_target_idx ON ${tableName} (corpus_group_key, target_rollout_label, recorded_at DESC)`
		);

		const listBase = `
			SELECT
				id,
				corpus_group_key,
				group_key,
				target_rollout_label,
				recorded_at,
				record_json
			FROM ${tableName}
		`;
		const insert = db.prepare(`
			INSERT INTO ${tableName} (
				id,
				corpus_group_key,
				group_key,
				target_rollout_label,
				recorded_at,
				record_json
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				corpus_group_key = excluded.corpus_group_key,
				group_key = excluded.group_key,
				target_rollout_label = excluded.target_rollout_label,
				recorded_at = excluded.recorded_at,
				record_json = excluded.record_json
		`);

		return {
			listRecords(input = {}) {
				const where: string[] = [];
				const params: Array<string | number> = [];

				if (input.corpusGroupKey) {
					where.push('corpus_group_key = ?');
					params.push(input.corpusGroupKey);
				}
				if (input.groupKey) {
					where.push('group_key = ?');
					params.push(input.groupKey);
				}
				if (input.targetRolloutLabel) {
					where.push('target_rollout_label = ?');
					params.push(input.targetRolloutLabel);
				}

				const sql =
					`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
					'ORDER BY recorded_at DESC';
				const rows = db.prepare(sql).all(...params);
				const records = Array.isArray(rows)
					? rows
							.filter(
								isSQLiteLaneHandoffAutoCompletePolicyHistoryRow
							)
							.map(
								mapSQLiteLaneHandoffAutoCompletePolicyHistoryRow
							)
					: [];
				return typeof input.limit === 'number'
					? records.slice(0, input.limit)
					: records;
			},
			saveRecord(record) {
				insert.run(
					record.id,
					record.corpusGroupKey ?? null,
					record.groupKey,
					record.targetRolloutLabel,
					record.recordedAt,
					JSON.stringify(record)
				);
			}
		};
	};

export const createRAGSQLiteRetrievalReleaseLanePolicyHistoryStore = (
	options: SQLiteRAGRetrievalReleaseLanePolicyHistoryStoreOptions
): RAGRetrievalReleaseLanePolicyHistoryStore => {
	const tableName =
		options.tableName ?? 'rag_retrieval_release_lane_policy_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT,
			rollout_label TEXT NOT NULL,
			scope TEXT NOT NULL,
			recorded_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_rollout_recorded_at_idx ON ${tableName} (rollout_label, recorded_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_scope_idx ON ${tableName} (group_key, scope, recorded_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			scope,
			recorded_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			scope,
			recorded_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			rollout_label = excluded.rollout_label,
			scope = excluded.scope,
			recorded_at = excluded.recorded_at,
			record_json = excluded.record_json
	`);

	return {
		listRecords(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}
			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}
			if (input.rolloutLabel) {
				where.push('rollout_label = ?');
				params.push(input.rolloutLabel);
			}
			if (input.scope) {
				where.push('scope = ?');
				params.push(input.scope);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY recorded_at DESC';
			const rows = db.prepare(sql).all(...params);
			const records = Array.isArray(rows)
				? rows
						.filter(isSQLiteReleaseLanePolicyHistoryRow)
						.map(mapSQLiteReleaseLanePolicyHistoryRow)
				: [];
			return typeof input.limit === 'number'
				? records.slice(0, input.limit)
				: records;
		},
		saveRecord(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey ?? null,
				record.rolloutLabel,
				record.scope,
				record.recordedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalBaselineGatePolicyHistoryStore = (
	options: SQLiteRAGRetrievalBaselineGatePolicyHistoryStoreOptions
): RAGRetrievalBaselineGatePolicyHistoryStore => {
	const tableName =
		options.tableName ?? 'rag_retrieval_baseline_gate_policy_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id TEXT PRIMARY KEY,
			corpus_group_key TEXT,
			group_key TEXT,
			rollout_label TEXT NOT NULL,
			scope TEXT NOT NULL,
			recorded_at INTEGER NOT NULL,
			record_json TEXT NOT NULL
		)
	`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_rollout_recorded_at_idx ON ${tableName} (rollout_label, recorded_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_scope_idx ON ${tableName} (group_key, scope, recorded_at DESC)`
	);

	const listBase = `
		SELECT
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			scope,
			recorded_at,
			record_json
		FROM ${tableName}
	`;
	const insert = db.prepare(`
		INSERT INTO ${tableName} (
			id,
			corpus_group_key,
			group_key,
			rollout_label,
			scope,
			recorded_at,
			record_json
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			corpus_group_key = excluded.corpus_group_key,
			group_key = excluded.group_key,
			rollout_label = excluded.rollout_label,
			scope = excluded.scope,
			recorded_at = excluded.recorded_at,
			record_json = excluded.record_json
	`);

	return {
		listRecords(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}
			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}
			if (input.rolloutLabel) {
				where.push('rollout_label = ?');
				params.push(input.rolloutLabel);
			}
			if (input.scope) {
				where.push('scope = ?');
				params.push(input.scope);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY recorded_at DESC';
			const rows = db.prepare(sql).all(...params);
			const records = Array.isArray(rows)
				? rows
						.filter(isSQLiteBaselineGatePolicyHistoryRow)
						.map(mapSQLiteBaselineGatePolicyHistoryRow)
				: [];
			return typeof input.limit === 'number'
				? records.slice(0, input.limit)
				: records;
		},
		saveRecord(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey ?? null,
				record.rolloutLabel,
				record.scope,
				record.recordedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGSQLiteRetrievalReleaseLaneEscalationPolicyHistoryStore = (
	options: SQLiteRAGRetrievalReleaseLaneEscalationPolicyHistoryStoreOptions
): RAGRetrievalReleaseLaneEscalationPolicyHistoryStore => {
	const tableName =
		options.tableName ??
		'rag_retrieval_release_lane_escalation_policy_history';
	assertSupportedIdentifier(tableName);

	const db =
		options.db ??
		new (loadBunSQLiteModule().Database)(options.path ?? ':memory:');

	db.exec(`
			CREATE TABLE IF NOT EXISTS ${tableName} (
				id TEXT PRIMARY KEY,
				corpus_group_key TEXT,
				group_key TEXT NOT NULL,
				target_rollout_label TEXT NOT NULL,
				recorded_at INTEGER NOT NULL,
				record_json TEXT NOT NULL
			)
		`);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_group_recorded_at_idx ON ${tableName} (group_key, recorded_at DESC)`
	);
	db.exec(
		`CREATE INDEX IF NOT EXISTS ${tableName}_corpus_target_idx ON ${tableName} (corpus_group_key, target_rollout_label, recorded_at DESC)`
	);

	const listBase = `
			SELECT
				id,
				corpus_group_key,
				group_key,
				target_rollout_label,
				recorded_at,
				record_json
			FROM ${tableName}
		`;
	const insert = db.prepare(`
			INSERT INTO ${tableName} (
				id,
				corpus_group_key,
				group_key,
				target_rollout_label,
				recorded_at,
				record_json
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				corpus_group_key = excluded.corpus_group_key,
				group_key = excluded.group_key,
				target_rollout_label = excluded.target_rollout_label,
				recorded_at = excluded.recorded_at,
				record_json = excluded.record_json
		`);

	return {
		listRecords(input = {}) {
			const where: string[] = [];
			const params: Array<string | number> = [];

			if (input.corpusGroupKey) {
				where.push('corpus_group_key = ?');
				params.push(input.corpusGroupKey);
			}
			if (input.groupKey) {
				where.push('group_key = ?');
				params.push(input.groupKey);
			}
			if (input.targetRolloutLabel) {
				where.push('target_rollout_label = ?');
				params.push(input.targetRolloutLabel);
			}

			const sql =
				`${listBase}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ` +
				'ORDER BY recorded_at DESC';
			const rows = db.prepare(sql).all(...params);
			const records = Array.isArray(rows)
				? rows
						.filter(isSQLiteReleaseLaneEscalationPolicyHistoryRow)
						.map(mapSQLiteReleaseLaneEscalationPolicyHistoryRow)
				: [];
			return typeof input.limit === 'number'
				? records.slice(0, input.limit)
				: records;
		},
		saveRecord(record) {
			insert.run(
				record.id,
				record.corpusGroupKey ?? null,
				record.groupKey,
				record.targetRolloutLabel,
				record.recordedAt,
				JSON.stringify(record)
			);
		}
	};
};

export const createRAGFileAnswerGroundingEvaluationHistoryStore = (
	path: string
): RAGAnswerGroundingEvaluationHistoryStore => ({
	async listRuns(input) {
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				runs?: RAGAnswerGroundingEvaluationRun[];
			};
			const runs = Array.isArray(data.runs) ? data.runs : [];
			const filtered = input?.suiteId
				? runs.filter((run) => run.suiteId === input.suiteId)
				: runs;

			return filtered
				.sort(toGroundingHistorySortOrder)
				.slice(0, input?.limit ?? DEFAULT_HISTORY_LIMIT);
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return [];
			}

			throw error;
		}
	},
	async saveRun(run) {
		let runs: RAGAnswerGroundingEvaluationRun[] = [];
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				runs?: RAGAnswerGroundingEvaluationRun[];
			};
			runs = Array.isArray(data.runs) ? data.runs : [];
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			) {
				throw error;
			}
		}

		const nextRuns = normalizeGroundingHistoryRuns([
			run,
			...runs.filter((entry) => entry.id !== run.id)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(
				{
					runs: nextRuns
				},
				null,
				2
			)
		);
	},
	async pruneRuns(input) {
		let runs: RAGAnswerGroundingEvaluationRun[] = [];
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				runs?: RAGAnswerGroundingEvaluationRun[];
			};
			runs = Array.isArray(data.runs) ? data.runs : [];
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			) {
				throw error;
			}
		}

		const pruned = applyRAGEvaluationHistoryPrunePolicy({
			input,
			runs,
			sort: normalizeGroundingHistoryRuns
		});
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(
				{
					runs: pruned.next
				},
				null,
				2
			)
		);
		return {
			keptCount: pruned.keptCount,
			removedCount: pruned.removedCount
		} satisfies RAGEvaluationHistoryPruneResult;
	}
});

export const createRAGFileAnswerGroundingCaseDifficultyHistoryStore = (
	path: string
): RAGAnswerGroundingCaseDifficultyHistoryStore => ({
	async listRuns(input) {
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				runs?: RAGAnswerGroundingCaseDifficultyRun[];
			};
			const runs = Array.isArray(data.runs) ? data.runs : [];
			const filtered = input?.suiteId
				? runs.filter((run) => run.suiteId === input.suiteId)
				: runs;

			return normalizeGroundingDifficultyHistoryRuns(filtered).slice(
				0,
				input?.limit ?? DEFAULT_HISTORY_LIMIT
			);
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return [];
			}

			throw error;
		}
	},
	async saveRun(run) {
		let runs: RAGAnswerGroundingCaseDifficultyRun[] = [];
		try {
			const raw = await readFile(path, 'utf8');
			const data = JSON.parse(raw) as {
				runs?: RAGAnswerGroundingCaseDifficultyRun[];
			};
			runs = Array.isArray(data.runs) ? data.runs : [];
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			) {
				throw error;
			}
		}

		const nextRuns = normalizeGroundingDifficultyHistoryRuns([
			run,
			...runs.filter((entry) => entry.id !== run.id)
		]);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(
				{
					runs: nextRuns
				},
				null,
				2
			)
		);
	}
});

export const loadRAGEvaluationHistory = async ({
	store,
	suite,
	limit = DEFAULT_HISTORY_LIMIT
}: {
	store: RAGEvaluationHistoryStore;
	suite: RAGEvaluationSuite;
	limit?: number;
}): Promise<RAGEvaluationHistory> => {
	const runs = normalizeHistoryRuns(
		await Promise.resolve(store.listRuns({ limit, suiteId: suite.id }))
	);
	const latestRun = runs[0];
	const previousRun = runs[1];

	return {
		caseTraceSnapshots: buildEvaluationCaseTraceSnapshots({
			current: latestRun,
			previous: previousRun
		}),
		retrievalTraceTrend: buildRAGRetrievalTraceHistoryTrend({
			runs
		}),
		diff:
			latestRun && previousRun
				? buildRAGEvaluationRunDiff({
						current: latestRun,
						previous: previousRun
					})
				: undefined,
		latestRun,
		leaderboard: buildRAGEvaluationLeaderboard(runs),
		previousRun,
		runs,
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id
	};
};

export const loadRAGEvaluationSuiteSnapshotHistory = async ({
	store,
	suite,
	limit = DEFAULT_HISTORY_LIMIT
}: {
	store: RAGEvaluationSuiteSnapshotHistoryStore;
	suite: Pick<RAGEvaluationSuite, 'id' | 'label'>;
	limit?: number;
}): Promise<RAGEvaluationSuiteSnapshotHistory> => {
	const snapshots = normalizeEvaluationSuiteSnapshots(
		await Promise.resolve(
			store.listSnapshots({
				limit,
				suiteId: suite.id
			})
		)
	);
	const latestSnapshot = snapshots[0];
	const previousSnapshot = snapshots[1];

	return {
		diff:
			latestSnapshot && previousSnapshot
				? buildRAGEvaluationSuiteSnapshotDiff({
						current: latestSnapshot,
						previous: previousSnapshot
					})
				: undefined,
		latestSnapshot,
		previousSnapshot,
		snapshots,
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id
	};
};

export const loadRAGSearchTraceHistory = async ({
	store,
	query,
	groupKey,
	tag,
	limit = DEFAULT_HISTORY_LIMIT
}: {
	store: RAGSearchTraceStore;
	query?: string;
	groupKey?: string;
	tag?: string;
	limit?: number;
}): Promise<RAGSearchTraceHistory> => {
	const traces = normalizeTraceSummaryRuns(
		await Promise.resolve(store.listTraces({ groupKey, limit, query, tag }))
	);
	const latestTrace = traces[0];
	const previousTrace = traces[1];

	return {
		diff:
			latestTrace && previousTrace
				? buildRAGSearchTraceDiff({
						current: latestTrace,
						previous: previousTrace
					})
				: undefined,
		latestTrace,
		previousTrace,
		groupKey,
		query,
		tag,
		retrievalTraceTrend: buildRAGRetrievalTraceHistoryTrend({
			runs: traces.map((trace) => ({
				finishedAt: trace.finishedAt,
				id: trace.id,
				label: trace.label,
				traceSummary: trace.summary
			}))
		}),
		traces
	};
};

export const loadRAGSearchTraceGroupHistory = async ({
	store,
	tag,
	limit = DEFAULT_HISTORY_LIMIT
}: {
	store: RAGSearchTraceStore;
	tag?: string;
	limit?: number;
}): Promise<RAGSearchTraceGroupHistory> => {
	const traces = normalizeTraceSummaryRuns(
		await Promise.resolve(store.listTraces({ limit, tag }))
	);
	const grouped = new Map<string, RAGSearchTraceRecord[]>();

	for (const trace of traces) {
		const groupKey = trace.groupKey ?? trace.query;
		const existing = grouped.get(groupKey);
		if (existing) {
			existing.push(trace);
			continue;
		}
		grouped.set(groupKey, [trace]);
	}

	const groups = Array.from(grouped.entries())
		.map(([groupKey, entries]): RAGSearchTraceGroupHistoryEntry => {
			const normalizedEntries = normalizeTraceSummaryRuns(entries);
			const latestTrace = normalizedEntries[0];
			const previousTrace = normalizedEntries[1];

			return {
				diff:
					latestTrace && previousTrace
						? buildRAGSearchTraceDiff({
								current: latestTrace,
								previous: previousTrace
							})
						: undefined,
				groupKey,
				latestTrace,
				previousTrace,
				retrievalTraceTrend: buildRAGRetrievalTraceHistoryTrend({
					runs: normalizedEntries.map((trace) => ({
						finishedAt: trace.finishedAt,
						id: trace.id,
						label: trace.label,
						traceSummary: trace.summary
					}))
				}),
				traceCount: normalizedEntries.length
			};
		})
		.sort((left, right) => {
			const leftFinishedAt = left.latestTrace?.finishedAt ?? 0;
			const rightFinishedAt = right.latestTrace?.finishedAt ?? 0;
			return rightFinishedAt - leftFinishedAt;
		});

	return {
		groups,
		tag
	};
};

export const summarizeRAGSearchTraceStore = async ({
	store,
	tag
}: {
	store: RAGSearchTraceStore;
	tag?: string;
}): Promise<RAGSearchTraceStats> => {
	const traces = normalizeTraceSummaryRuns(
		await Promise.resolve(store.listTraces({ tag }))
	);

	return buildRAGSearchTraceStatsFromTraces(traces);
};

export const previewRAGSearchTraceStorePrune = async ({
	store,
	input
}: {
	store: RAGSearchTraceStore;
	input?: RAGSearchTracePruneInput;
}): Promise<RAGSearchTracePrunePreview> => {
	const traces = normalizeTraceSummaryRuns(
		await Promise.resolve(store.listTraces({ tag: input?.tag }))
	);
	const pruned = applyRAGSearchTracePrunePolicy({
		input,
		traces
	});

	return {
		input,
		result: {
			keptCount: pruned.keptCount,
			removedCount: pruned.removedCount
		},
		statsAfter: buildRAGSearchTraceStatsFromTraces(pruned.next),
		statsBefore: buildRAGSearchTraceStatsFromTraces(traces)
	};
};

export const loadRAGAnswerGroundingEvaluationHistory = async ({
	store,
	suite,
	limit = DEFAULT_HISTORY_LIMIT
}: {
	store: RAGAnswerGroundingEvaluationHistoryStore;
	suite: Pick<RAGEvaluationSuite, 'id' | 'label'>;
	limit?: number;
}): Promise<RAGAnswerGroundingEvaluationHistory> => {
	const runs = normalizeGroundingHistoryRuns(
		await Promise.resolve(
			store.listRuns({
				limit,
				suiteId: suite.id
			})
		)
	);
	const latestRun = runs[0];
	const previousRun = runs[1];

	return {
		caseSnapshots: buildGroundingCaseSnapshots({
			current: latestRun,
			previous: previousRun
		}),
		diff:
			latestRun && previousRun
				? buildRAGAnswerGroundingEvaluationRunDiff({
						current: latestRun,
						previous: previousRun
					})
				: undefined,
		latestRun,
		leaderboard: buildRAGAnswerGroundingEvaluationLeaderboard(runs),
		previousRun,
		runs,
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id
	};
};

export const loadRAGAnswerGroundingCaseDifficultyHistory = async ({
	store,
	suite,
	limit = DEFAULT_HISTORY_LIMIT
}: {
	store: RAGAnswerGroundingCaseDifficultyHistoryStore;
	suite: Pick<RAGEvaluationSuite, 'id' | 'label'>;
	limit?: number;
}): Promise<RAGAnswerGroundingCaseDifficultyHistory> => {
	const runs = normalizeGroundingDifficultyHistoryRuns(
		await Promise.resolve(
			store.listRuns({
				limit,
				suiteId: suite.id
			})
		)
	);
	const latestRun = runs[0];
	const previousRun = runs[1];

	return {
		diff:
			latestRun && previousRun
				? buildRAGAnswerGroundingCaseDifficultyRunDiff({
						current: latestRun,
						previous: previousRun
					})
				: undefined,
		latestRun,
		previousRun,
		runs,
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id,
		trends: buildRAGAnswerGroundingCaseDifficultyTrends({ runs })
	};
};

export const persistRAGEvaluationSuiteRun = async ({
	store,
	run
}: {
	store: RAGEvaluationHistoryStore;
	run: RAGEvaluationSuiteRun;
}) => {
	await Promise.resolve(store.saveRun(run));
	return run;
};

export const persistRAGAnswerGroundingEvaluationRun = async ({
	store,
	run
}: {
	store: RAGAnswerGroundingEvaluationHistoryStore;
	run: RAGAnswerGroundingEvaluationRun;
}) => {
	await Promise.resolve(store.saveRun(run));
	return run;
};

export const persistRAGAnswerGroundingCaseDifficultyRun = async ({
	store,
	run
}: {
	store: RAGAnswerGroundingCaseDifficultyHistoryStore;
	run: RAGAnswerGroundingCaseDifficultyRun;
}) => {
	await Promise.resolve(store.saveRun(run));
	return run;
};

export const persistRAGSearchTraceRecord = async ({
	store,
	record
}: {
	store: RAGSearchTraceStore;
	record: RAGSearchTraceRecord;
}) => {
	await Promise.resolve(store.saveTrace(record));
	return record;
};

export const pruneRAGSearchTraceStore = async ({
	store,
	input
}: {
	store: RAGSearchTraceStore;
	input?: RAGSearchTracePruneInput;
}): Promise<RAGSearchTracePruneResult> =>
	Promise.resolve(store.pruneTraces(input));

export const persistRAGSearchTracePruneRun = async ({
	store,
	run
}: {
	store: RAGSearchTracePruneHistoryStore;
	run: RAGSearchTracePruneRun;
}) => {
	await Promise.resolve(store.saveRun(run));
	return run;
};

export const persistRAGRetrievalComparisonRun = async ({
	store,
	run
}: {
	store: RAGRetrievalComparisonHistoryStore;
	run: RAGRetrievalComparisonRun;
}) => {
	await Promise.resolve(store.saveRun(run));
	return run;
};

export const buildRAGRetrievalComparisonDecisionSummary = ({
	comparison,
	baselineRetrievalId,
	candidateRetrievalId,
	policy
}: {
	comparison: RAGRetrievalComparison;
	baselineRetrievalId?: string;
	candidateRetrievalId?: string;
	policy?: RAGRetrievalBaselineGatePolicy;
}): RAGRetrievalComparisonDecisionSummary | undefined => {
	const baselineEntry =
		findRetrievalComparisonEntry(comparison, baselineRetrievalId) ??
		comparison.entries[0];
	const candidateEntry =
		findRetrievalComparisonEntry(comparison, candidateRetrievalId) ??
		comparison.entries.find(
			(entry) => entry.retrievalId !== baselineEntry?.retrievalId
		) ??
		comparison.entries[1];

	if (!baselineEntry && !candidateEntry) {
		return undefined;
	}

	const delta =
		baselineEntry && candidateEntry
			? {
					averageF1Delta:
						candidateEntry.response.summary.averageF1 -
						baselineEntry.response.summary.averageF1,
					elapsedMsDelta:
						candidateEntry.response.elapsedMs -
						baselineEntry.response.elapsedMs,
					passingRateDelta:
						candidateEntry.response.passingRate -
						baselineEntry.response.passingRate,
					...(countPresentationCueCases(baselineEntry, 'title') > 0 ||
					countPresentationCueCases(candidateEntry, 'title') > 0
						? {
								presentationTitleCueCasesDelta:
									countPresentationCueCases(
										candidateEntry,
										'title'
									) -
									countPresentationCueCases(
										baselineEntry,
										'title'
									)
							}
						: {}),
					...(countPresentationCueCases(baselineEntry, 'body') > 0 ||
					countPresentationCueCases(candidateEntry, 'body') > 0
						? {
								presentationBodyCueCasesDelta:
									countPresentationCueCases(
										candidateEntry,
										'body'
									) -
									countPresentationCueCases(
										baselineEntry,
										'body'
									)
							}
						: {}),
					...(countPresentationCueCases(baselineEntry, 'notes') > 0 ||
					countPresentationCueCases(candidateEntry, 'notes') > 0
						? {
								presentationNotesCueCasesDelta:
									countPresentationCueCases(
										candidateEntry,
										'notes'
									) -
									countPresentationCueCases(
										baselineEntry,
										'notes'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(baselineEntry, 'sheet') > 0 ||
					countSpreadsheetCueCases(candidateEntry, 'sheet') > 0
						? {
								spreadsheetSheetCueCasesDelta:
									countSpreadsheetCueCases(
										candidateEntry,
										'sheet'
									) -
									countSpreadsheetCueCases(
										baselineEntry,
										'sheet'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(baselineEntry, 'table') > 0 ||
					countSpreadsheetCueCases(candidateEntry, 'table') > 0
						? {
								spreadsheetTableCueCasesDelta:
									countSpreadsheetCueCases(
										candidateEntry,
										'table'
									) -
									countSpreadsheetCueCases(
										baselineEntry,
										'table'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(baselineEntry, 'column') > 0 ||
					countSpreadsheetCueCases(candidateEntry, 'column') > 0
						? {
								spreadsheetColumnCueCasesDelta:
									countSpreadsheetCueCases(
										candidateEntry,
										'column'
									) -
									countSpreadsheetCueCases(
										baselineEntry,
										'column'
									)
							}
						: {}),
					multiVectorCollapsedCasesDelta:
						(candidateEntry.traceSummary
							?.multiVectorCollapsedCases ?? 0) -
						(baselineEntry.traceSummary
							?.multiVectorCollapsedCases ?? 0),
					multiVectorLexicalHitCasesDelta:
						(candidateEntry.traceSummary
							?.multiVectorLexicalHitCases ?? 0) -
						(baselineEntry.traceSummary
							?.multiVectorLexicalHitCases ?? 0),
					multiVectorVectorHitCasesDelta:
						(candidateEntry.traceSummary
							?.multiVectorVectorHitCases ?? 0) -
						(baselineEntry.traceSummary
							?.multiVectorVectorHitCases ?? 0),
					evidenceReconcileCasesDelta:
						(candidateEntry.traceSummary?.stageCounts
							?.evidence_reconcile ?? 0) -
						(baselineEntry.traceSummary?.stageCounts
							?.evidence_reconcile ?? 0),
					officeEvidenceReconcileCasesDelta:
						(candidateEntry.traceSummary
							?.officeEvidenceReconcileCases ?? 0) -
						(baselineEntry.traceSummary
							?.officeEvidenceReconcileCases ?? 0),
					pdfEvidenceReconcileCasesDelta:
						(candidateEntry.traceSummary
							?.pdfEvidenceReconcileCases ?? 0) -
						(baselineEntry.traceSummary
							?.pdfEvidenceReconcileCases ?? 0),
					runtimeCandidateBudgetExhaustedCasesDelta:
						(candidateEntry.traceSummary
							?.runtimeCandidateBudgetExhaustedCases ?? 0) -
						(baselineEntry.traceSummary
							?.runtimeCandidateBudgetExhaustedCases ?? 0),
					runtimeUnderfilledTopKCasesDelta:
						(candidateEntry.traceSummary
							?.runtimeUnderfilledTopKCases ?? 0) -
						(baselineEntry.traceSummary
							?.runtimeUnderfilledTopKCases ?? 0)
				}
			: undefined;

	return {
		baseline: baselineEntry
			? {
					averageF1: baselineEntry.response.summary.averageF1,
					elapsedMs: baselineEntry.response.elapsedMs,
					label: baselineEntry.label,
					...(countPresentationCueCases(baselineEntry, 'title') > 0
						? {
								presentationTitleCueCases:
									countPresentationCueCases(
										baselineEntry,
										'title'
									)
							}
						: {}),
					...(countPresentationCueCases(baselineEntry, 'body') > 0
						? {
								presentationBodyCueCases:
									countPresentationCueCases(
										baselineEntry,
										'body'
									)
							}
						: {}),
					...(countPresentationCueCases(baselineEntry, 'notes') > 0
						? {
								presentationNotesCueCases:
									countPresentationCueCases(
										baselineEntry,
										'notes'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(baselineEntry, 'sheet') > 0
						? {
								spreadsheetSheetCueCases:
									countSpreadsheetCueCases(
										baselineEntry,
										'sheet'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(baselineEntry, 'table') > 0
						? {
								spreadsheetTableCueCases:
									countSpreadsheetCueCases(
										baselineEntry,
										'table'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(baselineEntry, 'column') > 0
						? {
								spreadsheetColumnCueCases:
									countSpreadsheetCueCases(
										baselineEntry,
										'column'
									)
							}
						: {}),
					multiVectorCollapsedCases:
						baselineEntry.traceSummary?.multiVectorCollapsedCases,
					multiVectorLexicalHitCases:
						baselineEntry.traceSummary?.multiVectorLexicalHitCases,
					multiVectorVectorHitCases:
						baselineEntry.traceSummary?.multiVectorVectorHitCases,
					evidenceReconcileCases:
						baselineEntry.traceSummary?.stageCounts
							?.evidence_reconcile,
					officeEvidenceReconcileCases:
						baselineEntry.traceSummary
							?.officeEvidenceReconcileCases,
					pdfEvidenceReconcileCases:
						baselineEntry.traceSummary?.pdfEvidenceReconcileCases,
					runtimeCandidateBudgetExhaustedCases:
						baselineEntry.traceSummary
							?.runtimeCandidateBudgetExhaustedCases,
					runtimeUnderfilledTopKCases:
						baselineEntry.traceSummary?.runtimeUnderfilledTopKCases,
					passingRate: baselineEntry.response.passingRate,
					retrievalId: baselineEntry.retrievalId
				}
			: undefined,
		baselineRetrievalId: baselineEntry?.retrievalId,
		candidate: candidateEntry
			? {
					averageF1: candidateEntry.response.summary.averageF1,
					elapsedMs: candidateEntry.response.elapsedMs,
					label: candidateEntry.label,
					...(countPresentationCueCases(candidateEntry, 'title') > 0
						? {
								presentationTitleCueCases:
									countPresentationCueCases(
										candidateEntry,
										'title'
									)
							}
						: {}),
					...(countPresentationCueCases(candidateEntry, 'body') > 0
						? {
								presentationBodyCueCases:
									countPresentationCueCases(
										candidateEntry,
										'body'
									)
							}
						: {}),
					...(countPresentationCueCases(candidateEntry, 'notes') > 0
						? {
								presentationNotesCueCases:
									countPresentationCueCases(
										candidateEntry,
										'notes'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(candidateEntry, 'sheet') > 0
						? {
								spreadsheetSheetCueCases:
									countSpreadsheetCueCases(
										candidateEntry,
										'sheet'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(candidateEntry, 'table') > 0
						? {
								spreadsheetTableCueCases:
									countSpreadsheetCueCases(
										candidateEntry,
										'table'
									)
							}
						: {}),
					...(countSpreadsheetCueCases(candidateEntry, 'column') > 0
						? {
								spreadsheetColumnCueCases:
									countSpreadsheetCueCases(
										candidateEntry,
										'column'
									)
							}
						: {}),
					multiVectorCollapsedCases:
						candidateEntry.traceSummary?.multiVectorCollapsedCases,
					multiVectorLexicalHitCases:
						candidateEntry.traceSummary?.multiVectorLexicalHitCases,
					multiVectorVectorHitCases:
						candidateEntry.traceSummary?.multiVectorVectorHitCases,
					evidenceReconcileCases:
						candidateEntry.traceSummary?.stageCounts
							?.evidence_reconcile,
					officeEvidenceReconcileCases:
						candidateEntry.traceSummary
							?.officeEvidenceReconcileCases,
					pdfEvidenceReconcileCases:
						candidateEntry.traceSummary?.pdfEvidenceReconcileCases,
					runtimeCandidateBudgetExhaustedCases:
						candidateEntry.traceSummary
							?.runtimeCandidateBudgetExhaustedCases,
					runtimeUnderfilledTopKCases:
						candidateEntry.traceSummary
							?.runtimeUnderfilledTopKCases,
					passingRate: candidateEntry.response.passingRate,
					retrievalId: candidateEntry.retrievalId
				}
			: undefined,
		candidateRetrievalId: candidateEntry?.retrievalId,
		delta,
		fastest: comparison.summary.fastest,
		gate: evaluateRetrievalComparisonGate({ delta, policy }),
		winnerByAverageF1: comparison.summary.bestByAverageF1,
		winnerByPassingRate: comparison.summary.bestByPassingRate,
		...(comparison.summary.bestByPresentationTitleCueCases
			? {
					winnerByPresentationTitleCueCases:
						comparison.summary.bestByPresentationTitleCueCases
				}
			: {}),
		...(comparison.summary.bestByPresentationBodyCueCases
			? {
					winnerByPresentationBodyCueCases:
						comparison.summary.bestByPresentationBodyCueCases
				}
			: {}),
		...(comparison.summary.bestByPresentationNotesCueCases
			? {
					winnerByPresentationNotesCueCases:
						comparison.summary.bestByPresentationNotesCueCases
				}
			: {}),
		...(comparison.summary.bestBySpreadsheetSheetCueCases
			? {
					winnerBySpreadsheetSheetCueCases:
						comparison.summary.bestBySpreadsheetSheetCueCases
				}
			: {}),
		...(comparison.summary.bestBySpreadsheetTableCueCases
			? {
					winnerBySpreadsheetTableCueCases:
						comparison.summary.bestBySpreadsheetTableCueCases
				}
			: {}),
		...(comparison.summary.bestBySpreadsheetColumnCueCases
			? {
					winnerBySpreadsheetColumnCueCases:
						comparison.summary.bestBySpreadsheetColumnCueCases
				}
			: {}),
		winnerByMultivectorCollapsedCases:
			comparison.summary.bestByMultivectorCollapsedCases,
		winnerByMultivectorLexicalHitCases:
			comparison.summary.bestByMultivectorLexicalHitCases,
		winnerByMultivectorVectorHitCases:
			comparison.summary.bestByMultivectorVectorHitCases,
		winnerByEvidenceReconcileCases:
			comparison.summary.bestByEvidenceReconcileCases,
		winnerByOfficeEvidenceReconcileCases:
			comparison.summary.bestByOfficeEvidenceReconcileCases,
		winnerByPDFEvidenceReconcileCases:
			comparison.summary.bestByPDFEvidenceReconcileCases,
		winnerByLowestRuntimeCandidateBudgetExhaustedCases:
			comparison.summary.bestByLowestRuntimeCandidateBudgetExhaustedCases,
		winnerByLowestRuntimeUnderfilledTopKCases:
			comparison.summary.bestByLowestRuntimeUnderfilledTopKCases
	};
};

export const loadRAGSearchTracePruneHistory = async ({
	store,
	limit,
	trigger
}: {
	store: RAGSearchTracePruneHistoryStore;
	limit?: number;
	trigger?: RAGSearchTracePruneRun['trigger'];
}) =>
	normalizeSearchTracePruneRuns(
		await Promise.resolve(store.listRuns({ limit, trigger }))
	);

export const loadRAGRetrievalComparisonHistory = async ({
	store,
	limit,
	suiteId,
	label,
	winnerId,
	corpusGroupKey,
	groupKey,
	tag
}: {
	store: RAGRetrievalComparisonHistoryStore;
	limit?: number;
	suiteId?: string;
	label?: string;
	winnerId?: string;
	corpusGroupKey?: string;
	groupKey?: string;
	tag?: string;
}) =>
	normalizeRetrievalComparisonRuns(
		await Promise.resolve(
			store.listRuns({
				corpusGroupKey,
				groupKey,
				label,
				limit,
				suiteId,
				tag,
				winnerId
			})
		)
	);

export const loadRAGRetrievalBaselines = async ({
	store,
	corpusGroupKey,
	groupKey,
	tag,
	limit,
	status
}: {
	store: RAGRetrievalBaselineStore;
	corpusGroupKey?: string;
	groupKey?: string;
	tag?: string;
	limit?: number;
	status?: RAGRetrievalBaselineRecord['status'];
}) =>
	normalizeRetrievalBaselineRecords(
		await Promise.resolve(
			store.listBaselines({
				corpusGroupKey,
				groupKey,
				limit,
				status,
				tag
			})
		)
	);

export const persistRAGRetrievalBaseline = async ({
	store,
	record
}: {
	store: RAGRetrievalBaselineStore;
	record: RAGRetrievalBaselineRecord;
}) => {
	await Promise.resolve(store.saveBaseline(record));
	return record;
};

export const loadRAGRetrievalReleaseDecisions = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	kind
}: {
	store: RAGRetrievalReleaseDecisionStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	kind?: RAGRetrievalReleaseDecisionRecord['kind'];
}) =>
	normalizeRetrievalReleaseDecisionRecords(
		await Promise.resolve(
			store.listDecisions({ corpusGroupKey, groupKey, kind, limit })
		)
	);

export const loadRAGRetrievalLaneHandoffDecisions = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	kind,
	sourceRolloutLabel,
	targetRolloutLabel
}: {
	store: RAGRetrievalLaneHandoffDecisionStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	kind?: RAGRetrievalLaneHandoffDecisionRecord['kind'];
	sourceRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['sourceRolloutLabel'];
	targetRolloutLabel?: RAGRetrievalLaneHandoffDecisionRecord['targetRolloutLabel'];
}) =>
	normalizeRetrievalLaneHandoffDecisionRecords(
		await Promise.resolve(
			store.listDecisions({
				corpusGroupKey,
				groupKey,
				kind,
				limit,
				sourceRolloutLabel,
				targetRolloutLabel
			})
		)
	);

export const loadRAGRetrievalReleaseIncidents = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	targetRolloutLabel,
	status,
	severity
}: {
	store: RAGRetrievalReleaseIncidentStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
	status?: RAGRetrievalReleaseIncidentRecord['status'];
	severity?: RAGRetrievalReleaseIncidentRecord['severity'];
}) =>
	normalizeRetrievalReleaseIncidentRecords(
		await Promise.resolve(
			store.listIncidents({
				corpusGroupKey,
				groupKey,
				limit,
				severity,
				status,
				targetRolloutLabel
			})
		)
	);

export const loadRAGRetrievalLaneHandoffIncidents = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	targetRolloutLabel,
	status,
	severity
}: {
	store: RAGRetrievalLaneHandoffIncidentStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	targetRolloutLabel?: RAGRetrievalLaneHandoffIncidentRecord['targetRolloutLabel'];
	status?: RAGRetrievalLaneHandoffIncidentRecord['status'];
	severity?: RAGRetrievalLaneHandoffIncidentRecord['severity'];
}) =>
	normalizeRetrievalReleaseIncidentRecords(
		(await Promise.resolve(
			store.listIncidents({
				corpusGroupKey,
				groupKey,
				limit,
				severity,
				status,
				targetRolloutLabel
			})
		)) as RAGRetrievalReleaseIncidentRecord[]
	) as RAGRetrievalLaneHandoffIncidentRecord[];

export const loadRAGRetrievalLaneHandoffIncidentHistory = async ({
	store,
	corpusGroupKey,
	action,
	groupKey,
	incidentId,
	limit,
	targetRolloutLabel
}: {
	store: RAGRetrievalLaneHandoffIncidentHistoryStore;
	corpusGroupKey?: string;
	action?: RAGRetrievalLaneHandoffIncidentHistoryRecord['action'];
	groupKey?: string;
	incidentId?: string;
	limit?: number;
	targetRolloutLabel?: RAGRetrievalLaneHandoffIncidentRecord['targetRolloutLabel'];
}) =>
	(await Promise.resolve(
		store.listRecords({
			corpusGroupKey,
			action,
			groupKey,
			incidentId,
			limit,
			targetRolloutLabel
		})
	)) as RAGRetrievalLaneHandoffIncidentHistoryRecord[];

export const loadRAGRetrievalIncidentRemediationDecisions = async ({
	store,
	groupKey,
	incidentId,
	limit,
	remediationKind,
	status,
	targetRolloutLabel
}: {
	store: RAGRetrievalIncidentRemediationDecisionStore;
	groupKey?: string;
	incidentId?: string;
	limit?: number;
	remediationKind?: RAGRetrievalIncidentRemediationDecisionRecord['remediationKind'];
	status?: RAGRetrievalIncidentRemediationDecisionRecord['status'];
	targetRolloutLabel?: RAGRetrievalIncidentRemediationDecisionRecord['targetRolloutLabel'];
}) =>
	normalizeRetrievalIncidentRemediationDecisionRecords(
		await Promise.resolve(
			store.listRecords({
				groupKey,
				incidentId,
				limit,
				remediationKind,
				status,
				targetRolloutLabel
			})
		)
	);

export const loadRAGRetrievalIncidentRemediationExecutionHistory = async ({
	store,
	actionKind,
	blockedByGuardrail,
	code,
	groupKey,
	idempotentReplay,
	incidentId,
	limit,
	targetRolloutLabel
}: {
	store: RAGRetrievalIncidentRemediationExecutionHistoryStore;
	actionKind?: RAGRemediationAction['kind'];
	blockedByGuardrail?: boolean;
	code?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['code'];
	groupKey?: string;
	idempotentReplay?: boolean;
	incidentId?: string;
	limit?: number;
	targetRolloutLabel?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['targetRolloutLabel'];
}) =>
	normalizeRetrievalIncidentRemediationExecutionHistoryRecords(
		await Promise.resolve(
			store.listRecords({
				actionKind,
				blockedByGuardrail,
				code,
				groupKey,
				idempotentReplay,
				incidentId,
				limit,
				targetRolloutLabel
			})
		)
	);

export const loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	targetRolloutLabel
}: {
	store: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	targetRolloutLabel?: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord['targetRolloutLabel'];
}) =>
	(await Promise.resolve(
		store.listRecords({
			corpusGroupKey,
			groupKey,
			limit,
			targetRolloutLabel
		})
	)) as RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord[];

export const loadRAGRetrievalReleaseLanePolicyHistory = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	rolloutLabel,
	scope
}: {
	store: RAGRetrievalReleaseLanePolicyHistoryStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	rolloutLabel?: RAGRetrievalReleaseLanePolicyHistoryRecord['rolloutLabel'];
	scope?: RAGRetrievalReleaseLanePolicyHistoryRecord['scope'];
}) =>
	(await Promise.resolve(
		store.listRecords({
			corpusGroupKey,
			groupKey,
			limit,
			rolloutLabel,
			scope
		})
	)) as RAGRetrievalReleaseLanePolicyHistoryRecord[];

export const loadRAGRetrievalBaselineGatePolicyHistory = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	rolloutLabel,
	scope
}: {
	store: RAGRetrievalBaselineGatePolicyHistoryStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	rolloutLabel?: RAGRetrievalBaselineGatePolicyHistoryRecord['rolloutLabel'];
	scope?: RAGRetrievalBaselineGatePolicyHistoryRecord['scope'];
}) =>
	(await Promise.resolve(
		store.listRecords({
			corpusGroupKey,
			groupKey,
			limit,
			rolloutLabel,
			scope
		})
	)) as RAGRetrievalBaselineGatePolicyHistoryRecord[];

export const loadRAGRetrievalReleaseLaneEscalationPolicyHistory = async ({
	store,
	corpusGroupKey,
	groupKey,
	limit,
	targetRolloutLabel
}: {
	store: RAGRetrievalReleaseLaneEscalationPolicyHistoryStore;
	corpusGroupKey?: string;
	groupKey?: string;
	limit?: number;
	targetRolloutLabel?: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord['targetRolloutLabel'];
}) =>
	(await Promise.resolve(
		store.listRecords({
			groupKey,
			limit,
			targetRolloutLabel
		})
	)) as RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord[];

export const persistRAGRetrievalReleaseDecision = async ({
	store,
	record
}: {
	store: RAGRetrievalReleaseDecisionStore;
	record: RAGRetrievalReleaseDecisionRecord;
}) => {
	await Promise.resolve(store.saveDecision(record));
	return record;
};

export const persistRAGRetrievalLaneHandoffDecision = async ({
	store,
	record
}: {
	store: RAGRetrievalLaneHandoffDecisionStore;
	record: RAGRetrievalLaneHandoffDecisionRecord;
}) => {
	await Promise.resolve(store.saveDecision(record));
	return record;
};

export const persistRAGRetrievalReleaseIncident = async ({
	store,
	record
}: {
	store: RAGRetrievalReleaseIncidentStore;
	record: RAGRetrievalReleaseIncidentRecord;
}) => {
	await Promise.resolve(store.saveIncident(record));
	return record;
};

export const persistRAGRetrievalLaneHandoffIncident = async ({
	store,
	record
}: {
	store: RAGRetrievalLaneHandoffIncidentStore;
	record: RAGRetrievalLaneHandoffIncidentRecord;
}) => {
	await Promise.resolve(store.saveIncident(record));
	return record;
};

export const persistRAGRetrievalIncidentRemediationDecision = async ({
	store,
	record
}: {
	store: RAGRetrievalIncidentRemediationDecisionStore;
	record: RAGRetrievalIncidentRemediationDecisionRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const persistRAGRetrievalIncidentRemediationExecutionHistory = async ({
	store,
	record
}: {
	store: RAGRetrievalIncidentRemediationExecutionHistoryStore;
	record: RAGRetrievalIncidentRemediationExecutionHistoryRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const persistRAGRetrievalLaneHandoffIncidentHistory = async ({
	store,
	record
}: {
	store: RAGRetrievalLaneHandoffIncidentHistoryStore;
	record: RAGRetrievalLaneHandoffIncidentHistoryRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory = async ({
	store,
	record
}: {
	store: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryStore;
	record: RAGRetrievalLaneHandoffAutoCompletePolicyHistoryRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const persistRAGRetrievalReleaseLanePolicyHistory = async ({
	store,
	record
}: {
	store: RAGRetrievalReleaseLanePolicyHistoryStore;
	record: RAGRetrievalReleaseLanePolicyHistoryRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const persistRAGRetrievalBaselineGatePolicyHistory = async ({
	store,
	record
}: {
	store: RAGRetrievalBaselineGatePolicyHistoryStore;
	record: RAGRetrievalBaselineGatePolicyHistoryRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const persistRAGRetrievalReleaseLaneEscalationPolicyHistory = async ({
	store,
	record
}: {
	store: RAGRetrievalReleaseLaneEscalationPolicyHistoryStore;
	record: RAGRetrievalReleaseLaneEscalationPolicyHistoryRecord;
}) => {
	await Promise.resolve(store.saveRecord(record));
	return record;
};

export const createRAGSQLiteGovernanceStores = (
	options: SQLiteRAGGovernanceStoreBundleOptions = {}
): Pick<
	RAGChatPluginConfig,
	| 'searchTraceStore'
	| 'searchTracePruneHistoryStore'
	| 'retrievalComparisonHistoryStore'
	| 'retrievalBaselineStore'
	| 'retrievalReleaseDecisionStore'
	| 'retrievalLaneHandoffDecisionStore'
	| 'retrievalLaneHandoffIncidentStore'
	| 'retrievalLaneHandoffIncidentHistoryStore'
	| 'retrievalLaneHandoffAutoCompletePolicyHistoryStore'
	| 'retrievalReleaseLanePolicyHistoryStore'
	| 'retrievalBaselineGatePolicyHistoryStore'
	| 'retrievalReleaseLaneEscalationPolicyHistoryStore'
	| 'retrievalReleaseIncidentStore'
	| 'retrievalIncidentRemediationDecisionStore'
	| 'retrievalIncidentRemediationExecutionHistoryStore'
> => {
	const prefix = options.tablePrefix?.trim();
	const table = (suffix: string) =>
		prefix && prefix.length > 0 ? `${prefix}_${suffix}` : suffix;

	return {
		searchTraceStore: createRAGSQLiteSearchTraceStore({
			db: options.db,
			path: options.path,
			tableName: table('rag_search_traces')
		}),
		searchTracePruneHistoryStore:
			createRAGSQLiteSearchTracePruneHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_search_trace_prune_history')
			}),
		retrievalComparisonHistoryStore:
			createRAGSQLiteRetrievalComparisonHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_comparison_history')
			}),
		retrievalBaselineStore: createRAGSQLiteRetrievalBaselineStore({
			db: options.db,
			path: options.path,
			tableName: table('rag_retrieval_baselines')
		}),
		retrievalReleaseDecisionStore:
			createRAGSQLiteRetrievalReleaseDecisionStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_release_decisions')
			}),
		retrievalLaneHandoffDecisionStore:
			createRAGSQLiteRetrievalLaneHandoffDecisionStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_lane_handoff_decisions')
			}),
		retrievalLaneHandoffIncidentStore:
			createRAGSQLiteRetrievalLaneHandoffIncidentStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_lane_handoff_incidents')
			}),
		retrievalLaneHandoffIncidentHistoryStore:
			createRAGSQLiteRetrievalLaneHandoffIncidentHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_lane_handoff_incident_history')
			}),
		retrievalLaneHandoffAutoCompletePolicyHistoryStore:
			createRAGSQLiteRetrievalLaneHandoffAutoCompletePolicyHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table(
					'rag_retrieval_lane_handoff_auto_complete_policy_history'
				)
			}),
		retrievalReleaseLanePolicyHistoryStore:
			createRAGSQLiteRetrievalReleaseLanePolicyHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_release_lane_policy_history')
			}),
		retrievalBaselineGatePolicyHistoryStore:
			createRAGSQLiteRetrievalBaselineGatePolicyHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_baseline_gate_policy_history')
			}),
		retrievalReleaseLaneEscalationPolicyHistoryStore:
			createRAGSQLiteRetrievalReleaseLaneEscalationPolicyHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table(
					'rag_retrieval_release_lane_escalation_policy_history'
				)
			}),
		retrievalReleaseIncidentStore:
			createRAGSQLiteRetrievalReleaseIncidentStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_release_incidents')
			}),
		retrievalIncidentRemediationDecisionStore:
			createRAGSQLiteRetrievalIncidentRemediationDecisionStore({
				db: options.db,
				path: options.path,
				tableName: table('rag_retrieval_incident_remediation_decisions')
			}),
		retrievalIncidentRemediationExecutionHistoryStore:
			createRAGSQLiteRetrievalIncidentRemediationExecutionHistoryStore({
				db: options.db,
				path: options.path,
				tableName: table(
					'rag_retrieval_incident_remediation_execution_history'
				)
			})
	};
};

export const buildRAGEvaluationResponse = (
	cases: RAGEvaluationCaseResult[]
): RAGEvaluationResponse => {
	const totalCases = cases.length;
	const corpusKeys = [
		...new Set(cases.flatMap((entry) => entry.corpusKey ?? []))
	];
	const passedCases = cases.filter((entry) => entry.status === 'pass').length;
	const partialCases = cases.filter(
		(entry) => entry.status === 'partial'
	).length;
	const failedCases = cases.filter((entry) => entry.status === 'fail').length;

	return {
		cases,
		...(corpusKeys.length > 0 ? { corpusKeys } : {}),
		elapsedMs: cases.reduce((sum, result) => sum + result.elapsedMs, 0),
		ok: true,
		passingRate: totalCases > 0 ? (passedCases / totalCases) * 100 : 0,
		summary: {
			averageF1:
				cases.reduce((sum, result) => sum + result.f1, 0) /
				(totalCases || 1),
			averageLatencyMs:
				cases.reduce((sum, result) => sum + result.elapsedMs, 0) /
				(totalCases || 1),
			averagePrecision:
				cases.reduce((sum, result) => sum + result.precision, 0) /
				(totalCases || 1),
			averageRecall:
				cases.reduce((sum, result) => sum + result.recall, 0) /
				(totalCases || 1),
			failedCases,
			partialCases,
			passedCases,
			totalCases
		},
		totalCases
	};
};

const incrementFailureCounts = (
	target: Record<string, number>,
	failureClasses: string[] | undefined
) => {
	for (const failureClass of failureClasses ?? []) {
		target[failureClass] = (target[failureClass] ?? 0) + 1;
	}
};

const sortEntityQualitySummaries = <
	T extends { passingRate: number; totalCases: number; label: string }
>(
	entries: T[]
) =>
	entries.sort((left, right) => {
		if (right.passingRate !== left.passingRate) {
			return right.passingRate - left.passingRate;
		}
		if (right.totalCases !== left.totalCases) {
			return right.totalCases - left.totalCases;
		}

		return left.label.localeCompare(right.label);
	});

export const buildRAGEvaluationEntityQualityView = (
	response: RAGEvaluationResponse
): RAGEvaluationEntityQualityView => {
	const bySource = new Map<string, RAGEvaluationEntityQualitySummary>();
	const byDocument = new Map<string, RAGEvaluationEntityQualitySummary>();
	for (const entry of response.cases) {
		const targets =
			entry.mode === 'source'
				? entry.expectedIds
				: entry.mode === 'documentId'
					? entry.expectedIds
					: [];
		const targetMap =
			entry.mode === 'source'
				? bySource
				: entry.mode === 'documentId'
					? byDocument
					: undefined;
		if (!targetMap) {
			continue;
		}
		for (const target of targets) {
			const current =
				targetMap.get(target) ??
				({
					averageF1: 0,
					caseIds: [],
					entityType: entry.mode === 'source' ? 'source' : 'document',
					failedCases: 0,
					failureCounts: {},
					key: target,
					label: target,
					passedCases: 0,
					passingRate: 0,
					partialCases: 0,
					totalCases: 0
				} satisfies RAGEvaluationEntityQualitySummary);
			current.totalCases += 1;
			current.averageF1 += entry.f1;
			current.caseIds.push(entry.caseId);
			if (entry.status === 'pass') {
				current.passedCases += 1;
			} else if (entry.status === 'partial') {
				current.partialCases += 1;
			} else {
				current.failedCases += 1;
			}
			incrementFailureCounts(current.failureCounts, entry.failureClasses);
			targetMap.set(target, current);
		}
	}

	for (const map of [bySource, byDocument]) {
		for (const entry of map.values()) {
			entry.averageF1 =
				entry.totalCases > 0 ? entry.averageF1 / entry.totalCases : 0;
			entry.passingRate =
				entry.totalCases > 0
					? (entry.passedCases / entry.totalCases) * 100
					: 0;
		}
	}

	return {
		byDocument: sortEntityQualitySummaries([...byDocument.values()]),
		bySource: sortEntityQualitySummaries([...bySource.values()])
	};
};

export const buildRAGAnswerGroundingEntityQualityView = (
	response: RAGAnswerGroundingEvaluationResponse
): RAGAnswerGroundingEntityQualityView => {
	const bySource = new Map<string, RAGAnswerGroundingEntityQualitySummary>();
	const byDocument = new Map<
		string,
		RAGAnswerGroundingEntityQualitySummary
	>();
	for (const entry of response.cases) {
		const targetMap =
			entry.mode === 'source'
				? bySource
				: entry.mode === 'documentId'
					? byDocument
					: undefined;
		if (!targetMap) {
			continue;
		}
		for (const target of entry.expectedIds) {
			const current =
				targetMap.get(target) ??
				({
					averageCitationF1: 0,
					averageResolvedCitationRate: 0,
					caseIds: [],
					entityType: entry.mode === 'source' ? 'source' : 'document',
					failedCases: 0,
					failureCounts: {},
					key: target,
					label: target,
					passedCases: 0,
					passingRate: 0,
					partialCases: 0,
					totalCases: 0
				} satisfies RAGAnswerGroundingEntityQualitySummary);
			current.totalCases += 1;
			current.averageCitationF1 += entry.citationF1;
			current.averageResolvedCitationRate += entry.resolvedCitationRate;
			current.caseIds.push(entry.caseId);
			if (entry.status === 'pass') {
				current.passedCases += 1;
			} else if (entry.status === 'partial') {
				current.partialCases += 1;
			} else {
				current.failedCases += 1;
			}
			incrementFailureCounts(current.failureCounts, entry.failureClasses);
			targetMap.set(target, current);
		}
	}

	for (const map of [bySource, byDocument]) {
		for (const entry of map.values()) {
			entry.averageCitationF1 =
				entry.totalCases > 0
					? entry.averageCitationF1 / entry.totalCases
					: 0;
			entry.averageResolvedCitationRate =
				entry.totalCases > 0
					? entry.averageResolvedCitationRate / entry.totalCases
					: 0;
			entry.passingRate =
				entry.totalCases > 0
					? (entry.passedCases / entry.totalCases) * 100
					: 0;
		}
	}

	return {
		byDocument: sortEntityQualitySummaries([...byDocument.values()]),
		bySource: sortEntityQualitySummaries([...bySource.values()])
	};
};

export const evaluateRAGAnswerGroundingCase = ({
	caseIndex,
	caseInput
}: {
	caseIndex: number;
	caseInput: RAGAnswerGroundingEvaluationCase;
}): RAGAnswerGroundingEvaluationCaseResult => {
	const mode = resolveEvaluationMode(caseInput);
	const expectedIds = normalizeExpectedIds(
		mode === 'chunkId'
			? (caseInput.expectedChunkIds ?? [])
			: mode === 'source'
				? (caseInput.expectedSources ?? [])
				: (caseInput.expectedDocumentIds ?? [])
	);
	const groundedAnswer = buildRAGGroundedAnswer(
		caseInput.answer,
		caseInput.sources
	);
	const citedReferences = groundedAnswer.parts.flatMap((part) =>
		part.type === 'citation' ? part.references : []
	);
	const citedIds = normalizeExpectedIds(
		citedReferences.map((reference) => extractExpectedId(reference, mode))
	);
	const expectedSet = new Set(expectedIds);
	const citedSet = new Set(citedIds);
	const matchedIds = normalizeExpectedIds(
		[...expectedSet].filter((id) => citedSet.has(id))
	);
	const missingIds = normalizeExpectedIds(
		[...expectedSet].filter((id) => !citedSet.has(id))
	);
	const extraIds = normalizeExpectedIds(
		[...citedSet].filter((id) => !expectedSet.has(id))
	);
	const matchedCount = matchedIds.length;
	const expectedCount = expectedIds.length;
	const citedCount = citedIds.length;
	const precision = citedCount > 0 ? matchedCount / citedCount : 0;
	const recall = expectedCount > 0 ? matchedCount / expectedCount : 0;
	const citationF1 =
		precision + recall > 0
			? (2 * precision * recall) / (precision + recall)
			: 0;
	const citationCount = groundedAnswer.parts.filter(
		(part) => part.type === 'citation'
	).length;
	const unresolvedCitationCount = new Set(
		groundedAnswer.ungroundedReferenceNumbers
	).size;
	const resolvedCitationCount = citedReferences.length;
	const resolvedCitationRate =
		citationCount > 0
			? Math.min(1, resolvedCitationCount / citationCount)
			: 0;

	return {
		answer: caseInput.answer,
		caseId: caseInput.id ?? `case-${caseIndex + 1}`,
		citationCount,
		citationF1,
		citationPrecision: precision,
		citationRecall: recall,
		citedIds,
		coverage: groundedAnswer.coverage,
		expectedCount,
		expectedIds,
		extraIds,
		groundedAnswer,
		hasCitations: groundedAnswer.hasCitations,
		label: caseInput.label,
		matchedCount,
		matchedIds,
		failureClasses: classifyRAGGroundingFailure({
			availableSources: caseInput.sources,
			citationCount,
			expectedCount,
			extraIds,
			matchedCount,
			missingIds,
			unresolvedCitationCount
		}),
		metadata: caseInput.metadata,
		missingIds,
		mode,
		query: caseInput.query,
		referenceCount: groundedAnswer.references.length,
		resolvedCitationCount,
		resolvedCitationRate,
		status: buildAnswerGroundingStatus({
			coverage: groundedAnswer.coverage,
			expectedCount,
			matchedCount,
			resolvedCitationCount,
			unresolvedCitationCount
		}),
		unresolvedCitationCount
	};
};

export const buildRAGAnswerGroundingEvaluationResponse = (
	cases: RAGAnswerGroundingEvaluationCaseResult[]
): RAGAnswerGroundingEvaluationResponse => {
	const totalCases = cases.length;
	const passedCases = cases.filter((entry) => entry.status === 'pass').length;
	const partialCases = cases.filter(
		(entry) => entry.status === 'partial'
	).length;
	const failedCases = cases.filter((entry) => entry.status === 'fail').length;
	const groundedCases = cases.filter(
		(entry) => entry.coverage === 'grounded'
	).length;
	const partiallyGroundedCases = cases.filter(
		(entry) => entry.coverage === 'partial'
	).length;
	const ungroundedCases = cases.filter(
		(entry) => entry.coverage === 'ungrounded'
	).length;

	return {
		cases,
		ok: true,
		passingRate: totalCases > 0 ? (passedCases / totalCases) * 100 : 0,
		summary: {
			averageCitationF1:
				cases.reduce((sum, result) => sum + result.citationF1, 0) /
				(totalCases || 1),
			averageCitationPrecision:
				cases.reduce(
					(sum, result) => sum + result.citationPrecision,
					0
				) / (totalCases || 1),
			averageCitationRecall:
				cases.reduce((sum, result) => sum + result.citationRecall, 0) /
				(totalCases || 1),
			averageResolvedCitationRate:
				cases.reduce(
					(sum, result) => sum + result.resolvedCitationRate,
					0
				) / (totalCases || 1),
			failedCases,
			groundedCases,
			partiallyGroundedCases,
			passedCases,
			partialCases,
			totalCases,
			ungroundedCases
		},
		totalCases
	};
};

export const evaluateRAGAnswerGrounding = (
	input: RAGAnswerGroundingEvaluationInput
): RAGAnswerGroundingEvaluationResponse =>
	buildRAGAnswerGroundingEvaluationResponse(
		input.cases.map((caseInput, caseIndex) =>
			evaluateRAGAnswerGroundingCase({ caseIndex, caseInput })
		)
	);
export const compareRAGRerankers = async ({
	collection,
	suite,
	rerankers,
	defaultTopK = DEFAULT_TOP_K
}: {
	collection: RAGCollection;
	suite: RAGEvaluationSuite;
	rerankers: RAGRerankerCandidate[];
	defaultTopK?: number;
}): Promise<RAGRerankerComparison> => {
	const entries = await Promise.all(
		rerankers.map(async (candidate) => {
			const evaluated = await evaluateRAGCollectionCases({
				collection,
				defaultTopK,
				input: suite.input,
				includeTrace: true,
				rerank: candidate.rerank
			});
			const response = buildRAGEvaluationResponse(
				evaluated.map((entry) => entry.caseResult)
			);

			return {
				caseTraceSnapshots:
					buildEvaluationCaseTraceSnapshotsFromEvaluated(evaluated),
				label: candidate.label ?? candidate.id,
				providerName:
					typeof candidate.rerank === 'function'
						? undefined
						: candidate.rerank?.providerName,
				response,
				rerankerId: candidate.id,
				traceSummary: summarizeRetrievalTraces(
					evaluated
						.map((entry) => entry.trace)
						.filter((trace): trace is RAGRetrievalTrace =>
							Boolean(trace)
						)
				)
			} satisfies RAGRerankerComparisonEntry;
		})
	);

	const leaderboard = buildRAGEvaluationLeaderboard(
		entries.map((entry) => ({
			elapsedMs: entry.response.elapsedMs,
			finishedAt: 0,
			id: entry.rerankerId,
			label: entry.label,
			response: entry.response,
			startedAt: 0,
			suiteId: suite.id,
			traceSummary: entry.traceSummary
		}))
	);

	return {
		entries,
		leaderboard,
		summary: summarizeRAGRerankerComparison(entries),
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id
	};
};
const summarizeEvaluationResponseComparison = <
	TEntry extends {
		response: RAGEvaluationResponse;
		[key: string]: unknown;
	}
>(
	entries: TEntry[],
	idKey: keyof TEntry
) => {
	if (entries.length === 0) {
		return {};
	}

	const byPassingRate = [...entries].sort((left, right) => {
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});
	const byAverageF1 = [...entries].sort(
		(left, right) =>
			right.response.summary.averageF1 - left.response.summary.averageF1
	);
	const byLatency = [...entries].sort(
		(left, right) =>
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
	);
	const getId = (entry: TEntry) =>
		typeof entry[idKey] === 'string' ? (entry[idKey] as string) : undefined;

	return {
		bestByAverageF1: getId(byAverageF1[0] as TEntry),
		bestByPassingRate: getId(byPassingRate[0] as TEntry),
		fastest: getId(byLatency[0] as TEntry)
	};
};

const selectComparisonEntryByTraceMetric = <
	TEntry extends {
		traceSummary?: RAGRetrievalTraceComparisonSummary;
		response: RAGEvaluationResponse;
		[key: string]: unknown;
	}
>(
	entries: TEntry[],
	idKey: keyof TEntry,
	metric: keyof Pick<
		RAGRetrievalTraceComparisonSummary,
		| 'multiVectorCollapsedCases'
		| 'multiVectorLexicalHitCases'
		| 'multiVectorVectorHitCases'
		| 'officeEvidenceReconcileCases'
		| 'officeParagraphEvidenceReconcileCases'
		| 'officeListEvidenceReconcileCases'
		| 'officeTableEvidenceReconcileCases'
		| 'pdfEvidenceReconcileCases'
	>
) => {
	const ranked = [...entries].sort((left, right) => {
		const leftMetric = left.traceSummary?.[metric] ?? 0;
		const rightMetric = right.traceSummary?.[metric] ?? 0;
		if (rightMetric !== leftMetric) {
			return rightMetric - leftMetric;
		}
		const leftEvidenceScore =
			(left.traceSummary?.multiVectorCollapsedCases ?? 0) +
			(left.traceSummary?.multiVectorLexicalHitCases ?? 0) +
			(left.traceSummary?.multiVectorVectorHitCases ?? 0);
		const rightEvidenceScore =
			(right.traceSummary?.multiVectorCollapsedCases ?? 0) +
			(right.traceSummary?.multiVectorLexicalHitCases ?? 0) +
			(right.traceSummary?.multiVectorVectorHitCases ?? 0);
		if (rightEvidenceScore !== leftEvidenceScore) {
			return rightEvidenceScore - leftEvidenceScore;
		}
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});
	const winner = ranked[0];
	if (!winner || (winner.traceSummary?.[metric] ?? 0) === 0) {
		return undefined;
	}

	return typeof winner[idKey] === 'string'
		? (winner[idKey] as string)
		: undefined;
};

const selectComparisonEntryByLowestTraceMetric = <
	TEntry extends {
		traceSummary?: RAGRetrievalTraceComparisonSummary;
		response: RAGEvaluationResponse;
		[key: string]: unknown;
	}
>(
	entries: TEntry[],
	idKey: keyof TEntry,
	metric: keyof Pick<
		RAGRetrievalTraceComparisonSummary,
		'runtimeCandidateBudgetExhaustedCases' | 'runtimeUnderfilledTopKCases'
	>
) => {
	const ranked = [...entries].sort((left, right) => {
		const leftMetric = left.traceSummary?.[metric] ?? 0;
		const rightMetric = right.traceSummary?.[metric] ?? 0;
		if (leftMetric !== rightMetric) {
			return leftMetric - rightMetric;
		}
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});
	const winner = ranked[0];
	return typeof winner?.[idKey] === 'string'
		? (winner[idKey] as string)
		: undefined;
};

const selectComparisonEntryByTraceStageCount = <
	TEntry extends {
		traceSummary?: RAGRetrievalTraceComparisonSummary;
		response: RAGEvaluationResponse;
		[key: string]: unknown;
	}
>(
	entries: TEntry[],
	idKey: keyof TEntry,
	stage: RAGRetrievalTraceStage
) => {
	const ranked = [...entries].sort((left, right) => {
		const leftMetric = left.traceSummary?.stageCounts?.[stage] ?? 0;
		const rightMetric = right.traceSummary?.stageCounts?.[stage] ?? 0;
		if (rightMetric !== leftMetric) {
			return rightMetric - leftMetric;
		}
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});
	const winner = ranked[0];
	if (!winner || (winner.traceSummary?.stageCounts?.[stage] ?? 0) === 0) {
		return undefined;
	}

	return typeof winner?.[idKey] === 'string'
		? (winner[idKey] as string)
		: undefined;
};

const countPresentationCueCases = <
	TEntry extends { caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[] }
>(
	entry: TEntry,
	cue: 'body' | 'notes' | 'title'
) =>
	(entry.caseTraceSnapshots ?? []).filter(
		(snapshot) => snapshot.leadPresentationCue === cue
	).length;

const selectComparisonEntryByPresentationCueCases = <
	TEntry extends {
		caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[];
		response: RAGEvaluationResponse;
		[key: string]: unknown;
	}
>(
	entries: TEntry[],
	idKey: keyof TEntry,
	cue: 'body' | 'notes' | 'title'
) => {
	const ranked = [...entries].sort((left, right) => {
		const leftMetric = countPresentationCueCases(left, cue);
		const rightMetric = countPresentationCueCases(right, cue);
		if (rightMetric !== leftMetric) {
			return rightMetric - leftMetric;
		}
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});
	const winner = ranked[0];
	if (!winner || countPresentationCueCases(winner, cue) === 0) {
		return undefined;
	}

	return typeof winner?.[idKey] === 'string'
		? (winner[idKey] as string)
		: undefined;
};

const countSpreadsheetCueCases = <
	TEntry extends { caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[] }
>(
	entry: TEntry,
	cue: 'column' | 'sheet' | 'table'
) =>
	(entry.caseTraceSnapshots ?? []).filter(
		(snapshot) => snapshot.leadSpreadsheetCue === cue
	).length;

const selectComparisonEntryBySpreadsheetCueCases = <
	TEntry extends {
		caseTraceSnapshots?: RAGEvaluationCaseTraceSnapshot[];
		response: RAGEvaluationResponse;
		[key: string]: unknown;
	}
>(
	entries: TEntry[],
	idKey: keyof TEntry,
	cue: 'column' | 'sheet' | 'table'
) => {
	const ranked = [...entries].sort((left, right) => {
		const leftMetric = countSpreadsheetCueCases(left, cue);
		const rightMetric = countSpreadsheetCueCases(right, cue);
		if (rightMetric !== leftMetric) {
			return rightMetric - leftMetric;
		}
		if (right.response.passingRate !== left.response.passingRate) {
			return right.response.passingRate - left.response.passingRate;
		}
		if (
			right.response.summary.averageF1 !== left.response.summary.averageF1
		) {
			return (
				right.response.summary.averageF1 -
				left.response.summary.averageF1
			);
		}

		return (
			left.response.summary.averageLatencyMs -
			right.response.summary.averageLatencyMs
		);
	});
	const winner = ranked[0];
	if (!winner || countSpreadsheetCueCases(winner, cue) === 0) {
		return undefined;
	}

	return typeof winner?.[idKey] === 'string'
		? (winner[idKey] as string)
		: undefined;
};

const resolveRetrievalMode = (
	candidate: RAGRetrievalCandidate
): RAGHybridRetrievalMode => {
	if (!candidate.retrieval) {
		return 'vector';
	}

	return typeof candidate.retrieval === 'string'
		? candidate.retrieval
		: (candidate.retrieval.mode ?? 'vector');
};
export const compareRAGRetrievalStrategies = async ({
	collection,
	suite,
	retrievals,
	defaultTopK = DEFAULT_TOP_K
}: {
	collection: RAGCollection;
	suite: RAGEvaluationSuite;
	retrievals: RAGRetrievalCandidate[];
	defaultTopK?: number;
}): Promise<RAGRetrievalComparison> => {
	const entries = await Promise.all(
		retrievals.map(async (candidate) => {
			const tracedCollection = {
				...collection,
				search: (input) =>
					collection.search({
						...input,
						queryTransform:
							candidate.queryTransform ?? input.queryTransform,
						rerank: candidate.rerank ?? input.rerank,
						retrieval: candidate.retrieval ?? input.retrieval
					}),
				searchWithTrace: (input) =>
					collection.searchWithTrace({
						...input,
						queryTransform:
							candidate.queryTransform ?? input.queryTransform,
						rerank: candidate.rerank ?? input.rerank,
						retrieval: candidate.retrieval ?? input.retrieval
					})
			} satisfies RAGCollection;
			const evaluated = await evaluateRAGCollectionCases({
				collection: {
					...tracedCollection
				},
				defaultTopK,
				input: suite.input,
				includeTrace: true,
				rerank: candidate.rerank
			});
			const response = buildRAGEvaluationResponse(
				evaluated.map((entry) => entry.caseResult)
			);

			return {
				caseTraceSnapshots:
					buildEvaluationCaseTraceSnapshotsFromEvaluated(evaluated),
				label: candidate.label ?? candidate.id,
				response,
				retrievalId: candidate.id,
				retrievalMode: resolveRetrievalMode(candidate),
				traceSummary: summarizeRetrievalTraces(
					evaluated
						.map((entry) => entry.trace)
						.filter((trace): trace is RAGRetrievalTrace =>
							Boolean(trace)
						)
				)
			} satisfies RAGRetrievalComparisonEntry;
		})
	);

	const leaderboard = buildRAGEvaluationLeaderboard(
		entries.map((entry) => ({
			elapsedMs: entry.response.elapsedMs,
			finishedAt: 0,
			id: entry.retrievalId,
			label: entry.label,
			response: entry.response,
			startedAt: 0,
			suiteId: suite.id,
			traceSummary: entry.traceSummary
		}))
	);

	return {
		corpusKeys: [
			...new Set(
				entries.flatMap((entry) => entry.response.corpusKeys ?? [])
			)
		],
		entries,
		leaderboard,
		summary: summarizeRAGRetrievalComparison(entries),
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id
	};
};

export const summarizeRAGRetrievalTraces = (
	traces: RAGRetrievalTrace[]
): RAGRetrievalTraceComparisonSummary | undefined =>
	summarizeRetrievalTraces(traces);

export const compareRAGRetrievalTraceSummaries = (
	current: RAGRetrievalTraceComparisonSummary,
	previous: RAGRetrievalTraceComparisonSummary
): RAGRetrievalTraceComparisonSummaryDiff => ({
	averageCandidateTopKDelta:
		current.averageCandidateTopK - previous.averageCandidateTopK,
	averageFinalCountDelta:
		current.averageFinalCount - previous.averageFinalCount,
	averageLexicalCountDelta:
		current.averageLexicalCount - previous.averageLexicalCount,
	averageLexicalTopKDelta:
		current.averageLexicalTopK - previous.averageLexicalTopK,
	averageVectorCountDelta:
		current.averageVectorCount - previous.averageVectorCount,
	balancedCasesDelta: current.balancedCases - previous.balancedCases,
	current,
	lexicalCasesDelta: current.lexicalCases - previous.lexicalCases,
	modeDelta: buildSummaryListDelta(current.modes, previous.modes),
	previous,
	roundRobinCasesDelta: current.roundRobinCases - previous.roundRobinCases,
	sourceBalanceStrategyDelta: buildSummaryListDelta(
		current.sourceBalanceStrategies,
		previous.sourceBalanceStrategies
	),
	stageCountsDelta: diffTraceSummaryStageCounts({
		current: current.stageCounts,
		previous: previous.stageCounts
	}),
	totalCasesDelta: current.totalCases - previous.totalCases,
	transformedCasesDelta: current.transformedCases - previous.transformedCases,
	vectorCasesDelta: current.vectorCases - previous.vectorCases,
	variantCasesDelta: current.variantCases - previous.variantCases,
	multiVectorCasesDelta: current.multiVectorCases - previous.multiVectorCases,
	multiVectorVectorHitCasesDelta:
		current.multiVectorVectorHitCases - previous.multiVectorVectorHitCases,
	multiVectorLexicalHitCasesDelta:
		current.multiVectorLexicalHitCases -
		previous.multiVectorLexicalHitCases,
	multiVectorCollapsedCasesDelta:
		current.multiVectorCollapsedCases - previous.multiVectorCollapsedCases,
	officeEvidenceReconcileCasesDelta:
		current.officeEvidenceReconcileCases -
		previous.officeEvidenceReconcileCases,
	officeParagraphEvidenceReconcileCasesDelta:
		(current.officeParagraphEvidenceReconcileCases ?? 0) -
		(previous.officeParagraphEvidenceReconcileCases ?? 0),
	officeListEvidenceReconcileCasesDelta:
		(current.officeListEvidenceReconcileCases ?? 0) -
		(previous.officeListEvidenceReconcileCases ?? 0),
	officeTableEvidenceReconcileCasesDelta:
		(current.officeTableEvidenceReconcileCases ?? 0) -
		(previous.officeTableEvidenceReconcileCases ?? 0),
	pdfEvidenceReconcileCasesDelta:
		current.pdfEvidenceReconcileCases - previous.pdfEvidenceReconcileCases,
	runtimeCandidateBudgetExhaustedCasesDelta:
		current.runtimeCandidateBudgetExhaustedCases -
		previous.runtimeCandidateBudgetExhaustedCases,
	runtimeUnderfilledTopKCasesDelta:
		current.runtimeUnderfilledTopKCases -
		previous.runtimeUnderfilledTopKCases
});

const buildSearchTraceResultSnapshots = (
	results: Array<{
		chunkId: string;
		corpusKey?: string;
		score: number;
		source?: string;
		title?: string;
		metadata?: Record<string, unknown>;
	}>
): RAGSearchTraceResultSnapshot[] =>
	results.map((result) => ({
		chunkId: result.chunkId,
		corpusKey:
			result.corpusKey ??
			(typeof result.metadata?.corpusKey === 'string'
				? result.metadata.corpusKey
				: undefined),
		documentId:
			typeof result.metadata?.documentId === 'string'
				? result.metadata.documentId
				: undefined,
		score: result.score,
		source: result.source,
		title: result.title
	}));

export const buildRAGSearchTraceRecord = (input: {
	trace: RAGRetrievalTrace;
	results?: Array<{
		chunkId: string;
		score: number;
		source?: string;
		title?: string;
		metadata?: Record<string, unknown>;
	}>;
	id?: string;
	label?: string;
	groupKey?: string;
	tags?: string[];
	startedAt?: number;
	finishedAt?: number;
	elapsedMs?: number;
	metadata?: Record<string, unknown>;
}): RAGSearchTraceRecord => {
	const startedAt = input.startedAt ?? Date.now();
	const finishedAt = input.finishedAt ?? startedAt;
	const elapsedMs = input.elapsedMs ?? Math.max(0, finishedAt - startedAt);
	const summary =
		summarizeRetrievalTraces([input.trace]) ??
		summarizeRetrievalTraces([
			{
				...input.trace,
				steps: [...input.trace.steps]
			}
		]);

	if (!summary) {
		throw new Error('Failed to summarize retrieval trace');
	}

	return {
		elapsedMs,
		finishedAt,
		groupKey: input.groupKey,
		id: input.id ?? generateId(),
		label: input.label ?? input.trace.query,
		metadata: input.metadata,
		query: input.trace.query,
		results: buildSearchTraceResultSnapshots(input.results ?? []),
		startedAt,
		summary,
		tags: normalizeTraceTags(input.tags),
		trace: input.trace
	};
};

export const buildRAGSearchTraceDiff = ({
	current,
	previous
}: {
	current: RAGSearchTraceRecord;
	previous?: RAGSearchTraceRecord;
}): RAGSearchTraceDiff => {
	const currentChunkIds = current.results.map((entry) => entry.chunkId);
	const previousChunkIds =
		previous?.results.map((entry) => entry.chunkId) ?? [];
	const previousSet = new Set(previousChunkIds);
	const currentSet = new Set(currentChunkIds);

	return {
		addedChunkIds: currentChunkIds.filter(
			(chunkId) => !previousSet.has(chunkId)
		),
		currentTraceId: current.id,
		previousTraceId: previous?.id,
		removedChunkIds: previousChunkIds.filter(
			(chunkId) => !currentSet.has(chunkId)
		),
		retainedChunkIds: currentChunkIds.filter((chunkId) =>
			previousSet.has(chunkId)
		),
		summaryDelta: previous?.summary
			? compareRAGRetrievalTraceSummaries(
					current.summary,
					previous.summary
				)
			: undefined,
		topResultChanged:
			(current.results[0]?.chunkId ?? undefined) !==
			(previous?.results[0]?.chunkId ?? undefined)
	};
};

export const buildRAGRetrievalTraceHistoryTrend = ({
	runs
}: {
	runs: RAGRetrievalTraceSummaryRun[];
}): RAGRetrievalTraceTrend => {
	const sortedRuns = normalizeTraceSummaryRuns(runs);
	const runsWithSummary = sortedRuns.filter(
		(run) => run.traceSummary && run.label
	);
	const traceSummaries = runsWithSummary
		.map((run) => run.traceSummary)
		.filter((summary): summary is RAGRetrievalTraceComparisonSummary =>
			Boolean(summary)
		);
	const summaryTrendWindows: RAGRetrievalTraceHistoryWindow[] = [];

	for (let index = 0; index < runsWithSummary.length - 1; index += 1) {
		const currentRun = runsWithSummary[index]!;
		const previousRun = runsWithSummary[index + 1]!;
		if (!currentRun.traceSummary || !previousRun.traceSummary) {
			continue;
		}
		const current = currentRun.traceSummary;
		const previous = previousRun.traceSummary;
		const delta = compareRAGRetrievalTraceSummaries(current, previous);
		summaryTrendWindows.push({
			current,
			currentRunId: currentRun.id,
			currentRunLabel: currentRun.label,
			delta,
			previous,
			previousRunId: previousRun.id,
			previousRunLabel: previousRun.label
		});
	}

	const latest = runsWithSummary[0]?.traceSummary;
	const previous = runsWithSummary[1]?.traceSummary;
	const latestToPrevious =
		latest && previous
			? compareRAGRetrievalTraceSummaries(latest, previous)
			: undefined;
	const listHistoryModes = traceSummaries.map((summary) => summary.modes);
	const listHistorySourceStrategies = traceSummaries.map(
		(summary) => summary.sourceBalanceStrategies
	);
	const modes = summarizeListTurnover<RAGHybridRetrievalMode>({
		current: normalizeSummaryList(latest?.modes ?? []),
		history: listHistoryModes,
		previous: normalizeSummaryList(previous?.modes ?? [])
	});
	const sourceBalanceStrategies =
		summarizeListTurnover<RAGSourceBalanceStrategy>({
			current: normalizeSummaryList(
				latest?.sourceBalanceStrategies ?? []
			),
			history: listHistorySourceStrategies,
			previous: normalizeSummaryList(
				previous?.sourceBalanceStrategies ?? []
			)
		});
	const { aggregate, bestMetric, worstMetric } = buildTraceSummaryAggregate({
		summaries: traceSummaries
	});
	const stageChurn = buildRAGRetrievalTraceStageChurn({
		windows: summaryTrendWindows
	});

	return {
		aggregate,
		bestMetric,
		modeTurnover: modes,
		runsWithTraceSummary: traceSummaries.length,
		sourceBalanceStrategyTurnover: sourceBalanceStrategies,
		stageChurn,
		summaryTrendWindows,
		worstMetric,
		worstVolatileStage: stageChurn.find((entry) => entry.totalChanges > 0),
		latestToPrevious
	};
};
export const createRAGEvaluationSuite = (
	suite: RAGEvaluationSuite
): RAGEvaluationSuite => {
	const cases = suite.input.cases.map((entry) => ({
		...entry,
		...(entry.goldenSet === true ? { goldenSet: true } : {}),
		...(entry.expectedChunkIds
			? { expectedChunkIds: [...entry.expectedChunkIds] }
			: {}),
		...(entry.expectedSources
			? { expectedSources: [...entry.expectedSources] }
			: {}),
		...(entry.expectedDocumentIds
			? { expectedDocumentIds: [...entry.expectedDocumentIds] }
			: {}),
		...(entry.hardNegativeChunkIds
			? {
					hardNegativeChunkIds: normalizeExpectedIds(
						entry.hardNegativeChunkIds
					)
				}
			: {}),
		...(entry.hardNegativeSources
			? {
					hardNegativeSources: normalizeExpectedIds(
						entry.hardNegativeSources
					)
				}
			: {}),
		...(entry.hardNegativeDocumentIds
			? {
					hardNegativeDocumentIds: normalizeExpectedIds(
						entry.hardNegativeDocumentIds
					)
				}
			: {}),
		...(entry.filter ? { filter: { ...entry.filter } } : {}),
		...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
		...(entry.retrieval ? { retrieval: entry.retrieval } : {})
	}));
	const duplicateCaseIds = Array.from(
		new Set(
			cases
				.map((entry) => entry.id)
				.filter(
					(id, index, ids) =>
						typeof id === 'string' && ids.indexOf(id) !== index
				)
		)
	);
	if (duplicateCaseIds.length > 0) {
		throw new Error(
			`RAG evaluation suite contains duplicate case ids: ${duplicateCaseIds.join(', ')}`
		);
	}

	return {
		...suite,
		input: {
			...suite.input,
			cases,
			...(suite.input.filter
				? { filter: { ...suite.input.filter } }
				: {}),
			...(suite.input.retrieval
				? { retrieval: suite.input.retrieval }
				: {})
		},
		...(suite.metadata ? { metadata: { ...suite.metadata } } : {})
	};
};

export const addRAGEvaluationSuiteCase = ({
	suite,
	caseInput,
	index
}: {
	suite: RAGEvaluationSuite;
	caseInput: RAGEvaluationCase;
	index?: number;
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	if (
		normalizedSuite.input.cases.some((entry) => entry.id === caseInput.id)
	) {
		throw new Error(
			`RAG evaluation suite already contains case id ${caseInput.id}`
		);
	}

	const nextCases = [...normalizedSuite.input.cases];
	const insertAt =
		typeof index === 'number' && Number.isFinite(index)
			? Math.max(0, Math.min(nextCases.length, Math.trunc(index)))
			: nextCases.length;
	nextCases.splice(insertAt, 0, caseInput);

	return createRAGEvaluationSuite({
		...normalizedSuite,
		input: {
			...normalizedSuite.input,
			cases: nextCases
		}
	});
};

export const updateRAGEvaluationSuiteCase = ({
	suite,
	caseId,
	caseInput
}: {
	suite: RAGEvaluationSuite;
	caseId: string;
	caseInput: RAGEvaluationCase;
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const targetIndex = normalizedSuite.input.cases.findIndex(
		(entry) => entry.id === caseId
	);
	if (targetIndex < 0) {
		throw new Error(
			`RAG evaluation suite does not contain case id ${caseId}`
		);
	}
	if (
		caseInput.id !== caseId &&
		normalizedSuite.input.cases.some((entry) => entry.id === caseInput.id)
	) {
		throw new Error(
			`RAG evaluation suite already contains case id ${caseInput.id}`
		);
	}

	const nextCases = [...normalizedSuite.input.cases];
	nextCases[targetIndex] = caseInput;

	return createRAGEvaluationSuite({
		...normalizedSuite,
		input: {
			...normalizedSuite.input,
			cases: nextCases
		}
	});
};

export const removeRAGEvaluationSuiteCase = ({
	suite,
	caseId
}: {
	suite: RAGEvaluationSuite;
	caseId: string;
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const nextCases = normalizedSuite.input.cases.filter(
		(entry) => entry.id !== caseId
	);
	if (nextCases.length === normalizedSuite.input.cases.length) {
		throw new Error(
			`RAG evaluation suite does not contain case id ${caseId}`
		);
	}

	return {
		...normalizedSuite,
		input: {
			...normalizedSuite.input,
			cases: nextCases
		}
	};
};

export const reorderRAGEvaluationSuiteCases = ({
	suite,
	caseIds
}: {
	suite: RAGEvaluationSuite;
	caseIds: string[];
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const caseMap = new Map(
		normalizedSuite.input.cases.map((entry) => [entry.id, entry])
	);
	if (caseIds.length !== normalizedSuite.input.cases.length) {
		throw new Error(
			'RAG evaluation suite reorder requires exactly one id per case'
		);
	}
	const unknownCaseIds = caseIds.filter((id) => !caseMap.has(id));
	if (unknownCaseIds.length > 0) {
		throw new Error(
			`RAG evaluation suite reorder contains unknown case ids: ${unknownCaseIds.join(', ')}`
		);
	}
	if (new Set(caseIds).size !== caseIds.length) {
		throw new Error(
			'RAG evaluation suite reorder contains duplicate case ids'
		);
	}

	return {
		...normalizedSuite,
		input: {
			...normalizedSuite.input,
			cases: caseIds.map((id) => caseMap.get(id)!)
		}
	};
};

export const setRAGEvaluationSuiteCaseGoldenSet = ({
	suite,
	caseId,
	goldenSet
}: {
	suite: RAGEvaluationSuite;
	caseId: string;
	goldenSet: boolean;
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const target = normalizedSuite.input.cases.find(
		(entry) => entry.id === caseId
	);
	if (!target) {
		throw new Error(
			`RAG evaluation suite does not contain case id ${caseId}`
		);
	}

	return updateRAGEvaluationSuiteCase({
		caseId,
		caseInput: {
			...target,
			...(goldenSet ? { goldenSet: true } : { goldenSet: undefined })
		},
		suite: normalizedSuite
	});
};

const resolveHardNegativeCaseField = (
	kind: 'chunkId' | 'source' | 'documentId'
) =>
	kind === 'chunkId'
		? 'hardNegativeChunkIds'
		: kind === 'source'
			? 'hardNegativeSources'
			: 'hardNegativeDocumentIds';

export const addRAGEvaluationSuiteCaseHardNegative = ({
	suite,
	caseId,
	kind,
	value
}: {
	suite: RAGEvaluationSuite;
	caseId: string;
	kind: 'chunkId' | 'source' | 'documentId';
	value: string;
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const target = normalizedSuite.input.cases.find(
		(entry) => entry.id === caseId
	);
	if (!target) {
		throw new Error(
			`RAG evaluation suite does not contain case id ${caseId}`
		);
	}

	const field = resolveHardNegativeCaseField(kind);
	const nextValues = normalizeExpectedIds([
		...normalizeStringArray(target[field]),
		value
	]);

	return updateRAGEvaluationSuiteCase({
		caseId,
		caseInput: {
			...target,
			[field]: nextValues
		},
		suite: normalizedSuite
	});
};

export const removeRAGEvaluationSuiteCaseHardNegative = ({
	suite,
	caseId,
	kind,
	value
}: {
	suite: RAGEvaluationSuite;
	caseId: string;
	kind: 'chunkId' | 'source' | 'documentId';
	value: string;
}): RAGEvaluationSuite => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const target = normalizedSuite.input.cases.find(
		(entry) => entry.id === caseId
	);
	if (!target) {
		throw new Error(
			`RAG evaluation suite does not contain case id ${caseId}`
		);
	}

	const field = resolveHardNegativeCaseField(kind);
	const nextValues = normalizeStringArray(target[field]).filter(
		(entry) => entry !== value.trim()
	);

	return updateRAGEvaluationSuiteCase({
		caseId,
		caseInput: {
			...target,
			[field]: nextValues.length > 0 ? nextValues : undefined
		},
		suite: normalizedSuite
	});
};

export const summarizeRAGEvaluationSuiteDataset = ({
	suite
}: {
	suite: RAGEvaluationSuite;
}): RAGEvaluationSuiteDatasetSummary => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	const cases = normalizedSuite.input.cases;

	return {
		caseCount: cases.length,
		goldenSetCount: cases.filter((entry) => entry.goldenSet === true)
			.length,
		hardNegativeCaseCount: cases.filter(
			(entry) =>
				normalizeStringArray(entry.hardNegativeChunkIds).length > 0 ||
				normalizeStringArray(entry.hardNegativeSources).length > 0 ||
				normalizeStringArray(entry.hardNegativeDocumentIds).length > 0
		).length,
		hardNegativeChunkIdCount: cases.reduce(
			(sum, entry) =>
				sum + normalizeStringArray(entry.hardNegativeChunkIds).length,
			0
		),
		hardNegativeDocumentIdCount: cases.reduce(
			(sum, entry) =>
				sum +
				normalizeStringArray(entry.hardNegativeDocumentIds).length,
			0
		),
		hardNegativeSourceCount: cases.reduce(
			(sum, entry) =>
				sum + normalizeStringArray(entry.hardNegativeSources).length,
			0
		),
		suiteId: normalizedSuite.id
	};
};

export const generateRAGEvaluationSuiteFromDocuments = ({
	suiteId,
	documents,
	label,
	description,
	maxCases = 20,
	topK = 5,
	scoreThreshold,
	filter,
	retrieval,
	includeGoldenSet = true,
	hardNegativePerCase = 1,
	metadata
}: RAGEvaluationSuiteGenerationOptions): RAGEvaluationSuite => {
	const normalizedDocuments = documents
		.filter(
			(document) =>
				typeof document.id === 'string' &&
				document.id.trim().length > 0 &&
				typeof document.source === 'string' &&
				document.source.trim().length > 0 &&
				typeof document.title === 'string' &&
				document.title.trim().length > 0
		)
		.sort((left, right) =>
			`${left.source}\u0000${left.title}\u0000${left.id}`.localeCompare(
				`${right.source}\u0000${right.title}\u0000${right.id}`
			)
		)
		.slice(0, Math.max(0, Math.trunc(maxCases)));

	const cases = normalizedDocuments.map((document, index) => {
		const negativeCandidates = normalizedDocuments
			.slice(index + 1)
			.concat(normalizedDocuments.slice(0, index))
			.filter((candidate) => candidate.id !== document.id);
		const hardNegativeDocumentIds = negativeCandidates
			.slice(0, Math.max(0, Math.trunc(hardNegativePerCase)))
			.map((candidate) => candidate.id);
		const hardNegativeSources = negativeCandidates
			.slice(0, Math.max(0, Math.trunc(hardNegativePerCase)))
			.map((candidate) => candidate.source);

		return {
			corpusKey: document.corpusKey,
			expectedDocumentIds: [document.id],
			expectedSources: [document.source],
			...(includeGoldenSet ? { goldenSet: true } : {}),
			...(hardNegativeDocumentIds.length > 0
				? { hardNegativeDocumentIds }
				: {}),
			...(hardNegativeSources.length > 0 ? { hardNegativeSources } : {}),
			id: `synthetic-${document.id}`,
			label: document.title,
			query: buildSyntheticEvaluationQuery(document)
		} satisfies RAGEvaluationCase;
	});

	return createRAGEvaluationSuite({
		description,
		id: suiteId,
		input: {
			cases,
			...(filter ? { filter: { ...filter } } : {}),
			...(typeof scoreThreshold === 'number' ? { scoreThreshold } : {}),
			...(typeof topK === 'number' ? { topK } : {}),
			...(retrieval ? { retrieval } : {})
		},
		label,
		metadata
	});
};

const DEFAULT_NATIVE_PLANNER_BENCHMARK_SUITE_ID =
	'rag-native-planner-larger-corpus';
const DEFAULT_NATIVE_PLANNER_BENCHMARK_LABEL =
	'Adaptive Native Planner Benchmark';
const DEFAULT_NATIVE_BACKEND_COMPARISON_BENCHMARK_SUITE_ID =
	'rag-native-backend-larger-corpus';
const DEFAULT_NATIVE_BACKEND_COMPARISON_BENCHMARK_LABEL =
	'Native Backend Comparison Benchmark';
const DEFAULT_PRESENTATION_CUE_BENCHMARK_SUITE_ID =
	'rag-presentation-cue-parity';
const DEFAULT_PRESENTATION_CUE_BENCHMARK_LABEL = 'Presentation Cue Benchmark';
const DEFAULT_SPREADSHEET_CUE_BENCHMARK_SUITE_ID = 'rag-spreadsheet-cue-parity';
const DEFAULT_SPREADSHEET_CUE_BENCHMARK_LABEL = 'Spreadsheet Cue Benchmark';
const DEFAULT_NATIVE_PLANNER_BENCHMARK_QUERY =
	'Which launch checklist phrase is exact wording?';
const DEFAULT_NATIVE_BACKEND_HYBRID_QUERY =
	'aurora promotion checklist wording';
const DEFAULT_NATIVE_BACKEND_FILTERED_QUERY =
	'focus lane launch checklist wording';
const DEFAULT_NATIVE_BACKEND_REORDERED_QUERY =
	'exact aurora focus lane checklist wording';
const DEFAULT_NATIVE_BACKEND_GUIDE_QUERY =
	'which focus lane guide contains exact aurora promotion wording';
const DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER = {
	lane: 'focus'
} satisfies Record<string, unknown>;
const DEFAULT_NATIVE_PLANNER_HARD_NEGATIVE_DOCUMENT_IDS = [
	'focus-distractor-0',
	'focus-distractor-1',
	'focus-distractor-2'
] as const;

export const createRAGNativeBackendBenchmarkMockEmbedding = async (
	text: string
): Promise<number[]> => {
	const normalized = text.toLowerCase();
	if (
		normalized.includes(
			'launch checklist exact wording for aurora promotion'
		) ||
		normalized.includes('launch checklist exact wording')
	) {
		return [0.995, 0.005];
	}

	if (
		normalized.includes('aurora') ||
		normalized.includes('checklist') ||
		normalized.includes('focus lane') ||
		normalized.includes('exact wording') ||
		normalized.includes('guide')
	) {
		return [1, 0];
	}

	return [0, 1];
};

export const createRAGNativeBackendBenchmarkCorpus = (input?: {
	backend?: 'generic' | 'sqlite-native' | 'postgres';
	noiseCount?: number;
}): RAGDocumentChunk[] => {
	const noiseCount = input?.noiseCount ?? 5_001;
	const backend = input?.backend ?? 'generic';
	const genericChunks = [
		...Array.from({ length: noiseCount }, (_, index) => ({
			chunkId: `noise:${index}`,
			corpusKey: 'noise',
			embedding: [0, 1] as number[],
			metadata: {
				corpusKey: 'noise',
				documentId: `noise-${index}`,
				lane: 'noise'
			},
			source: `noise/${index}.md`,
			text: `Background operations note ${index}.`
		})),
		...Array.from({ length: 3 }, (_, index) => ({
			chunkId: `focus:distractor:${index}`,
			corpusKey: 'focus',
			embedding: [1, 0] as number[],
			metadata: {
				corpusKey: 'focus',
				documentId: `focus-distractor-${index}`,
				lane: 'focus'
			},
			source: `focus/distractor-${index}.md`,
			text:
				index === 0
					? 'aurora promotion checklist overview'
					: index === 1
						? 'launch checklist wording draft'
						: 'focus lane promotion runbook notes'
		})),
		{
			chunkId: 'focus:target',
			corpusKey: 'focus',
			embedding: [0.995, 0.005] as number[],
			metadata: {
				corpusKey: 'focus',
				documentId: 'focus-target',
				lane: 'focus'
			},
			source: 'guide/planner-depth.md',
			text: 'launch checklist exact wording for aurora promotion in the focus lane'
		}
	] satisfies RAGDocumentChunk[];

	const backendSpecificChunks =
		backend === 'sqlite-native'
			? [
					{
						chunkId: 'focus:sqlite:phrase-matrix',
						corpusKey: 'focus',
						embedding: [1, 0] as number[],
						metadata: {
							backendFixture: 'sqlite-native',
							corpusKey: 'focus',
							documentId: 'focus-sqlite-phrase-matrix',
							lane: 'focus'
						},
						source: 'guide/sqlite-phrase-matrix.md',
						text: 'exact aurora focus lane checklist wording matrix for sqlite validation'
					},
					{
						chunkId: 'focus:sqlite:guide-table',
						corpusKey: 'focus',
						embedding: [1, 0] as number[],
						metadata: {
							backendFixture: 'sqlite-native',
							corpusKey: 'focus',
							documentId: 'focus-sqlite-guide-table',
							lane: 'focus'
						},
						source: 'guide/sqlite-guide-table.md',
						text: 'which focus lane guide contains aurora promotion wording draft table for sqlite operators'
					}
				]
			: backend === 'postgres'
				? [
						{
							chunkId: 'focus:postgres:appendix',
							corpusKey: 'focus',
							embedding: [1, 0] as number[],
							metadata: {
								backendFixture: 'postgres',
								corpusKey: 'focus',
								documentId: 'focus-postgres-appendix',
								lane: 'focus'
							},
							source: 'guide/postgres-appendix.md',
							text: 'which focus lane guide contains exact aurora promotion wording appendix for postgres release review'
						},
						{
							chunkId: 'focus:postgres:alternatives',
							corpusKey: 'focus',
							embedding: [1, 0] as number[],
							metadata: {
								backendFixture: 'postgres',
								corpusKey: 'focus',
								documentId: 'focus-postgres-alternatives',
								lane: 'focus'
							},
							source: 'guide/postgres-alternatives.md',
							text: 'aurora promotion checklist wording alternatives and exact focus lane phrasing for postgres audits'
						}
					]
				: [];

	return [...genericChunks, ...backendSpecificChunks];
};

export const createRAGAdaptiveNativePlannerBenchmarkSuite = (input?: {
	id?: string;
	label?: string;
	description?: string;
	topK?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuite =>
	createRAGEvaluationSuite({
		description:
			input?.description ??
			'Stress-tests larger-corpus native planner selection, candidate-budget pressure, and transformed-query recovery on filtered retrieval.',
		id: input?.id ?? DEFAULT_NATIVE_PLANNER_BENCHMARK_SUITE_ID,
		input: {
			cases: [
				{
					expectedDocumentIds: ['focus-target'],
					filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
					hardNegativeDocumentIds: [
						'focus-distractor-0',
						'focus-distractor-1',
						'focus-distractor-2'
					],
					id: 'planner-pressure-exact-phrase',
					label: 'Exact phrase survives larger-corpus native pressure',
					query: DEFAULT_NATIVE_PLANNER_BENCHMARK_QUERY,
					topK: input?.topK ?? 1
				}
			],
			filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
			retrieval: 'vector',
			topK: input?.topK ?? 1
		},
		label: input?.label ?? DEFAULT_NATIVE_PLANNER_BENCHMARK_LABEL,
		metadata: {
			benchmarkKind: 'adaptive_native_planner',
			benchmarkScope: 'larger_corpus',
			expectedSignals: [
				'selected native planner profile',
				'candidate-budget exhaustion',
				'underfilled topk'
			],
			recommendedGroupKey: 'runtime-native-planner',
			recommendedTags: ['runtime', 'native', 'planner'],
			...input?.metadata
		}
	});

export const createRAGAdaptiveNativePlannerBenchmarkSnapshot = (input?: {
	suite?: RAGEvaluationSuite;
	id?: string;
	version?: number;
	createdAt?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuiteSnapshot => {
	const suite =
		input?.suite ?? createRAGAdaptiveNativePlannerBenchmarkSuite();

	return createRAGEvaluationSuiteSnapshot({
		createdAt: input?.createdAt,
		id: input?.id,
		metadata: {
			artifactKind: 'adaptive_native_planner_benchmark',
			persistForReleaseHistory: true,
			...input?.metadata
		},
		suite,
		version: input?.version
	});
};

export const createRAGNativeBackendComparisonBenchmarkSuite = (input?: {
	id?: string;
	label?: string;
	description?: string;
	topK?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuite =>
	createRAGEvaluationSuite({
		description:
			input?.description ??
			'Captures larger-corpus native backend parity with filtered vector pressure and harder hybrid retrieval cases so sqlite-native and postgres runs can be compared over time.',
		id: input?.id ?? DEFAULT_NATIVE_BACKEND_COMPARISON_BENCHMARK_SUITE_ID,
		input: {
			cases: [
				{
					expectedDocumentIds: ['focus-target'],
					filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
					hardNegativeDocumentIds: [
						...DEFAULT_NATIVE_PLANNER_HARD_NEGATIVE_DOCUMENT_IDS
					],
					id: 'planner-pressure-exact-phrase',
					label: 'Exact phrase survives larger-corpus native pressure',
					query: DEFAULT_NATIVE_PLANNER_BENCHMARK_QUERY,
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['focus-target'],
					filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
					hardNegativeDocumentIds: [
						...DEFAULT_NATIVE_PLANNER_HARD_NEGATIVE_DOCUMENT_IDS
					],
					id: 'planner-pressure-hybrid-phrase',
					label: 'Hybrid retrieval survives filtered lexical pressure',
					query: DEFAULT_NATIVE_BACKEND_HYBRID_QUERY,
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['focus-target'],
					filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
					hardNegativeDocumentIds: [
						...DEFAULT_NATIVE_PLANNER_HARD_NEGATIVE_DOCUMENT_IDS
					],
					id: 'planner-pressure-filtered-lane-query',
					label: 'Filtered lane query survives broader corpus noise',
					query: DEFAULT_NATIVE_BACKEND_FILTERED_QUERY,
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['focus-target'],
					filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
					hardNegativeDocumentIds: [
						...DEFAULT_NATIVE_PLANNER_HARD_NEGATIVE_DOCUMENT_IDS
					],
					id: 'planner-pressure-reordered-phrase',
					label: 'Reordered phrase survives transform pressure',
					query: DEFAULT_NATIVE_BACKEND_REORDERED_QUERY,
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['focus-target'],
					filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
					hardNegativeDocumentIds: [
						...DEFAULT_NATIVE_PLANNER_HARD_NEGATIVE_DOCUMENT_IDS
					],
					id: 'planner-pressure-guide-query',
					label: 'Guide attribution survives filtered corpus pressure',
					query: DEFAULT_NATIVE_BACKEND_GUIDE_QUERY,
					topK: input?.topK ?? 1
				}
			],
			filter: { ...DEFAULT_NATIVE_PLANNER_BENCHMARK_FILTER },
			retrieval: 'vector',
			topK: input?.topK ?? 1
		},
		label:
			input?.label ?? DEFAULT_NATIVE_BACKEND_COMPARISON_BENCHMARK_LABEL,
		metadata: {
			benchmarkKind: 'native_backend_comparison',
			benchmarkScope: 'larger_corpus',
			expectedSignals: [
				'backend-tagged runtime artifacts',
				'selected native planner profile',
				'hybrid filtered retrieval',
				'candidate-budget exhaustion',
				'underfilled topk',
				'query transform pressure'
			],
			recommendedGroupKey: 'runtime-native-backend-parity',
			recommendedTags: ['runtime', 'backend', 'native'],
			...input?.metadata
		}
	});

export const createRAGNativeBackendComparisonBenchmarkSnapshot = (input?: {
	suite?: RAGEvaluationSuite;
	id?: string;
	version?: number;
	createdAt?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuiteSnapshot => {
	const suite =
		input?.suite ?? createRAGNativeBackendComparisonBenchmarkSuite();

	return createRAGEvaluationSuiteSnapshot({
		createdAt: input?.createdAt,
		id: input?.id,
		metadata: {
			artifactKind: 'native_backend_comparison_benchmark',
			persistForReleaseHistory: true,
			...input?.metadata
		},
		suite,
		version: input?.version
	});
};

export const createRAGPresentationCueBenchmarkSuite = (input?: {
	id?: string;
	label?: string;
	description?: string;
	topK?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuite =>
	createRAGEvaluationSuite({
		description:
			input?.description ??
			'Captures repeated-title presentation retrieval parity with explicit title-led, body-led, and notes-led slide cases so presentation cue weighting can be benchmarked over time.',
		id: input?.id ?? DEFAULT_PRESENTATION_CUE_BENCHMARK_SUITE_ID,
		input: {
			cases: [
				{
					expectedDocumentIds: ['slide-title-doc'],
					hardNegativeDocumentIds: [
						'slide-body-doc',
						'slide-notes-doc'
					],
					id: 'presentation-title-led',
					label: 'Repeated-title deck selects title-led slide evidence',
					query: 'Which presentation title covers the release handoff summary?',
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['slide-body-doc'],
					hardNegativeDocumentIds: [
						'slide-title-doc',
						'slide-notes-doc'
					],
					id: 'presentation-body-led',
					label: 'Repeated-title deck selects body-led slide evidence',
					query: 'Which slide mentions escalation review in the body?',
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['slide-notes-doc'],
					hardNegativeDocumentIds: [
						'slide-title-doc',
						'slide-body-doc'
					],
					id: 'presentation-notes-led',
					label: 'Repeated-title deck selects notes-led slide evidence',
					query: 'Which slide notes are the primary handoff evidence?',
					topK: input?.topK ?? 1
				}
			],
			retrieval: 'hybrid',
			topK: input?.topK ?? 1
		},
		label: input?.label ?? DEFAULT_PRESENTATION_CUE_BENCHMARK_LABEL,
		metadata: {
			benchmarkKind: 'presentation_cue',
			benchmarkScope: 'repeated_title_slides',
			expectedSignals: [
				'presentation title cue',
				'presentation body cue',
				'presentation notes cue'
			],
			recommendedGroupKey: 'presentation-cue-parity',
			recommendedTags: ['presentation', 'cue', 'slides'],
			...input?.metadata
		}
	});

export const createRAGPresentationCueBenchmarkSnapshot = (input?: {
	suite?: RAGEvaluationSuite;
	id?: string;
	version?: number;
	createdAt?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuiteSnapshot => {
	const suite = input?.suite ?? createRAGPresentationCueBenchmarkSuite();

	return createRAGEvaluationSuiteSnapshot({
		createdAt: input?.createdAt,
		id: input?.id,
		metadata: {
			artifactKind: 'presentation_cue_benchmark',
			persistForReleaseHistory: true,
			...input?.metadata
		},
		suite,
		version: input?.version
	});
};

export const createRAGSpreadsheetCueBenchmarkSuite = (input?: {
	id?: string;
	label?: string;
	description?: string;
	topK?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuite =>
	createRAGEvaluationSuite({
		description:
			input?.description ??
			'Captures repeated spreadsheet-family retrieval parity with explicit sheet-led, table-led, and column-led workbook cases so spreadsheet cue weighting can be benchmarked over time.',
		id: input?.id ?? DEFAULT_SPREADSHEET_CUE_BENCHMARK_SUITE_ID,
		input: {
			cases: [
				{
					expectedDocumentIds: ['sheet-led-doc'],
					hardNegativeDocumentIds: [
						'table-led-doc',
						'column-led-doc'
					],
					id: 'spreadsheet-sheet-led',
					label: 'Workbook selects sheet-led spreadsheet evidence',
					query: 'Which spreadsheet sheet lists owner status and due date?',
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['table-led-doc'],
					hardNegativeDocumentIds: [
						'sheet-led-doc',
						'column-led-doc'
					],
					id: 'spreadsheet-table-led',
					label: 'Workbook selects table-led spreadsheet evidence',
					query: 'Which spreadsheet table lists the escalation status rows?',
					topK: input?.topK ?? 1
				},
				{
					expectedDocumentIds: ['column-led-doc'],
					hardNegativeDocumentIds: ['sheet-led-doc', 'table-led-doc'],
					id: 'spreadsheet-column-led',
					label: 'Workbook selects column-led spreadsheet evidence',
					query: 'Which spreadsheet columns cover owner due date?',
					topK: input?.topK ?? 1
				}
			],
			retrieval: 'hybrid',
			topK: input?.topK ?? 1
		},
		label: input?.label ?? DEFAULT_SPREADSHEET_CUE_BENCHMARK_LABEL,
		metadata: {
			benchmarkKind: 'spreadsheet_cue',
			benchmarkScope: 'repeated_sheet_tables',
			expectedSignals: [
				'spreadsheet sheet cue',
				'spreadsheet table cue',
				'spreadsheet column cue'
			],
			recommendedGroupKey: 'spreadsheet-cue-parity',
			recommendedTags: ['spreadsheet', 'cue', 'workbook'],
			...input?.metadata
		}
	});

export const createRAGSpreadsheetCueBenchmarkSnapshot = (input?: {
	suite?: RAGEvaluationSuite;
	id?: string;
	version?: number;
	createdAt?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuiteSnapshot => {
	const suite = input?.suite ?? createRAGSpreadsheetCueBenchmarkSuite();

	return createRAGEvaluationSuiteSnapshot({
		createdAt: input?.createdAt,
		id: input?.id,
		metadata: {
			artifactKind: 'spreadsheet_cue_benchmark',
			persistForReleaseHistory: true,
			...input?.metadata
		},
		suite,
		version: input?.version
	});
};

export const createRAGEvaluationSuiteSnapshot = ({
	suite,
	id,
	version = 1,
	createdAt = Date.now(),
	metadata
}: {
	suite: RAGEvaluationSuite;
	id?: string;
	version?: number;
	createdAt?: number;
	metadata?: Record<string, unknown>;
}): RAGEvaluationSuiteSnapshot => {
	const normalizedSuite = createRAGEvaluationSuite(suite);
	return {
		caseCount: normalizedSuite.input.cases.length,
		createdAt,
		id: id ?? `${normalizedSuite.id}:snapshot:${String(version)}`,
		label: normalizedSuite.label,
		description: normalizedSuite.description,
		metadata: metadata ? { ...metadata } : undefined,
		suite: normalizedSuite,
		suiteId: normalizedSuite.id,
		version
	};
};

const stableStringifyEvaluationCase = (entry: RAGEvaluationCase) =>
	JSON.stringify({
		...entry,
		expectedChunkIds: entry.expectedChunkIds ?? [],
		expectedDocumentIds: entry.expectedDocumentIds ?? [],
		expectedSources: entry.expectedSources ?? [],
		goldenSet: entry.goldenSet === true,
		hardNegativeChunkIds: entry.hardNegativeChunkIds ?? [],
		hardNegativeDocumentIds: entry.hardNegativeDocumentIds ?? [],
		hardNegativeSources: entry.hardNegativeSources ?? [],
		filter: entry.filter ?? {},
		metadata: entry.metadata ?? {},
		retrieval: entry.retrieval ?? null
	});

export const buildRAGEvaluationSuiteSnapshotDiff = ({
	current,
	previous
}: {
	current: RAGEvaluationSuiteSnapshot;
	previous?: RAGEvaluationSuiteSnapshot;
}): RAGEvaluationSuiteSnapshotDiff => {
	const currentCases = current.suite.input.cases;
	const previousCases = previous?.suite.input.cases ?? [];
	const currentMap = new Map<string, RAGEvaluationCase>(
		currentCases.map((entry: RAGEvaluationCase) => [entry.id, entry])
	);
	const previousMap = new Map<string, RAGEvaluationCase>(
		previousCases.map((entry: RAGEvaluationCase) => [entry.id, entry])
	);
	const currentIds = currentCases.map((entry: RAGEvaluationCase) => entry.id);
	const previousIds = previousCases.map(
		(entry: RAGEvaluationCase) => entry.id
	);

	const addedCaseIds = currentIds.filter(
		(id: string) => !previousMap.has(id)
	);
	const removedCaseIds = previousIds.filter(
		(id: string) => !currentMap.has(id)
	);
	const changedCaseIds = currentIds.filter((id: string) => {
		const currentCase = currentMap.get(id);
		const previousCase = previousMap.get(id);
		if (!currentCase || !previousCase) {
			return false;
		}
		return (
			stableStringifyEvaluationCase(currentCase) !==
			stableStringifyEvaluationCase(previousCase)
		);
	});
	const unchangedCaseIds = currentIds.filter((id: string) => {
		const currentCase = currentMap.get(id);
		const previousCase = previousMap.get(id);
		if (!currentCase || !previousCase) {
			return false;
		}
		return (
			stableStringifyEvaluationCase(currentCase) ===
			stableStringifyEvaluationCase(previousCase)
		);
	});
	const sharedIds = currentIds.filter((id: string) => previousMap.has(id));
	const orderChanged =
		sharedIds.length > 0 &&
		JSON.stringify(sharedIds) !==
			JSON.stringify(
				previousIds.filter((id: string) => currentMap.has(id))
			);

	return {
		addedCaseIds,
		caseCountDelta: current.caseCount - (previous?.caseCount ?? 0),
		changedCaseIds,
		currentSnapshotId: current.id,
		orderChanged,
		previousSnapshotId: previous?.id,
		removedCaseIds,
		suiteId: current.suiteId,
		unchangedCaseIds
	};
};
export const evaluateRAGCollection = async ({
	collection,
	input,
	defaultTopK = DEFAULT_TOP_K,
	rerank
}: {
	collection: RAGCollection;
	input: RAGEvaluationInput;
	defaultTopK?: number;
	rerank?: RAGRerankerProviderLike;
}) => {
	const evaluated = await evaluateRAGCollectionCases({
		collection,
		defaultTopK,
		includeTrace: false,
		input,
		rerank
	});

	return buildRAGEvaluationResponse(
		evaluated.map((entry) => entry.caseResult)
	);
};
export const executeDryRunRAGEvaluation = (
	input: RAGEvaluationInput,
	defaultTopK = DEFAULT_TOP_K
): RAGEvaluationCaseResult[] =>
	input.cases.map((caseInput, caseIndex) => {
		const mode = resolveEvaluationMode(caseInput);
		const expectedIds = normalizeExpectedIds(
			mode === 'chunkId'
				? (caseInput.expectedChunkIds ?? [])
				: mode === 'source'
					? (caseInput.expectedSources ?? [])
					: (caseInput.expectedDocumentIds ?? [])
		);
		const effectiveTopK =
			typeof caseInput.topK === 'number'
				? caseInput.topK
				: typeof input.topK === 'number'
					? input.topK
					: defaultTopK;

		return {
			caseId: caseInput.id ?? `case-${caseIndex + 1}`,
			elapsedMs: 0,
			expectedCount: expectedIds.length,
			expectedIds,
			failureClasses: classifyRAGEvaluationFailure({
				expectedCount: expectedIds.length,
				matchedCount: 0,
				missingIds: expectedIds,
				retrievedCount: 0,
				retrievedIds: []
			}),
			f1: 0,
			label: caseInput.label,
			matchedCount: 0,
			matchedIds: [],
			missingIds: expectedIds,
			mode,
			precision: 0,
			query: caseInput.query,
			recall: 0,
			retrievedCount: 0,
			retrievedIds: [],
			status: expectedIds.length === 0 ? 'partial' : 'fail',
			topK: effectiveTopK
		};
	});
export const runRAGEvaluationSuite = async ({
	suite,
	evaluate,
	overrides,
	artifacts
}: {
	suite: RAGEvaluationSuite;
	evaluate: (input: RAGEvaluationInput) => Promise<RAGEvaluationResponse>;
	overrides?: Partial<RAGEvaluationInput>;
	artifacts?: Pick<
		RAGEvaluationSuiteRun,
		'traceSummary' | 'caseTraceSnapshots'
	>;
}) => {
	const startedAt = Date.now();
	const response = await evaluate({
		...suite.input,
		...overrides,
		cases: overrides?.cases ?? suite.input.cases
	});
	const finishedAt = Date.now();

	return {
		caseTraceSnapshots: artifacts?.caseTraceSnapshots,
		elapsedMs: finishedAt - startedAt,
		finishedAt,
		id: generateId(),
		label: suite.label ?? suite.id,
		metadata: suite.metadata,
		response,
		startedAt,
		suiteId: suite.id,
		traceSummary: artifacts?.traceSummary
	} satisfies RAGEvaluationSuiteRun;
};
export const summarizeRAGEvaluationCase = ({
	caseIndex,
	caseInput,
	query,
	mode,
	retrievedIds,
	expectedIds,
	elapsedMs,
	retrievedSources,
	trace
}: {
	caseIndex: number;
	caseInput: RAGEvaluationCase;
	mode: 'chunkId' | 'source' | 'documentId';
	query: string;
	retrievedIds: string[];
	expectedIds: string[];
	elapsedMs: number;
	retrievedSources?: RAGSource[];
	trace?: RAGSearchTraceRecord | RAGRetrievalTrace;
}): RAGEvaluationCaseResult => {
	const expectedSet = new Set(expectedIds);
	const retrievedSet = new Set(retrievedIds);
	const matchedIds = normalizeExpectedIds(
		[...expectedSet].filter((id) => retrievedSet.has(id))
	);
	const missingIds = normalizeExpectedIds(
		[...expectedSet].filter((id) => !retrievedSet.has(id))
	);
	const matchedCount = matchedIds.length;
	const retrievedCount = retrievedIds.length;
	const expectedCount = expectedIds.length;
	const precision = retrievedCount > 0 ? matchedCount / retrievedCount : 0;
	const recall = expectedCount > 0 ? matchedCount / expectedCount : 0;
	const f1 =
		precision + recall > 0
			? (2 * precision * recall) / (precision + recall)
			: 0;
	const status: RAGEvaluationCaseResult['status'] =
		expectedCount === 0
			? 'partial'
			: matchedCount === expectedCount
				? 'pass'
				: matchedCount > 0
					? 'partial'
					: 'fail';

	return {
		caseId: caseInput.id ?? `case-${caseIndex + 1}`,
		corpusKey: caseInput.corpusKey,
		elapsedMs,
		expectedCount,
		expectedIds,
		failureClasses: classifyRAGEvaluationFailure({
			expectedCount,
			matchedCount,
			missingIds,
			retrievedCount,
			retrievedIds,
			retrievedSources,
			trace
		}),
		f1,
		label: caseInput.label,
		matchedCount,
		matchedIds,
		metadata: caseInput.metadata,
		missingIds,
		mode,
		precision,
		query,
		recall,
		retrievedCount,
		retrievedIds,
		status,
		topK:
			typeof caseInput.topK === 'number' ? caseInput.topK : DEFAULT_TOP_K
	};
};
export const summarizeRAGRerankerComparison = (
	entries: RAGRerankerComparisonEntry[]
): RAGRerankerComparisonSummary => {
	return summarizeEvaluationResponseComparison(
		entries,
		'rerankerId'
	) satisfies RAGRerankerComparisonSummary;
};
export const summarizeRAGRetrievalComparison = (
	entries: RAGRetrievalComparisonEntry[]
): RAGRetrievalComparisonSummary => ({
	...summarizeEvaluationResponseComparison(entries, 'retrievalId'),
	bestByPresentationTitleCueCases:
		selectComparisonEntryByPresentationCueCases(
			entries,
			'retrievalId',
			'title'
		),
	bestByPresentationBodyCueCases: selectComparisonEntryByPresentationCueCases(
		entries,
		'retrievalId',
		'body'
	),
	bestByPresentationNotesCueCases:
		selectComparisonEntryByPresentationCueCases(
			entries,
			'retrievalId',
			'notes'
		),
	bestBySpreadsheetSheetCueCases: selectComparisonEntryBySpreadsheetCueCases(
		entries,
		'retrievalId',
		'sheet'
	),
	bestBySpreadsheetTableCueCases: selectComparisonEntryBySpreadsheetCueCases(
		entries,
		'retrievalId',
		'table'
	),
	bestBySpreadsheetColumnCueCases: selectComparisonEntryBySpreadsheetCueCases(
		entries,
		'retrievalId',
		'column'
	),
	bestByMultivectorCollapsedCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'multiVectorCollapsedCases'
	),
	bestByMultivectorLexicalHitCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'multiVectorLexicalHitCases'
	),
	bestByMultivectorVectorHitCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'multiVectorVectorHitCases'
	),
	bestByEvidenceReconcileCases: selectComparisonEntryByTraceStageCount(
		entries,
		'retrievalId',
		'evidence_reconcile'
	),
	bestByOfficeEvidenceReconcileCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'officeEvidenceReconcileCases'
	),
	bestByOfficeParagraphEvidenceReconcileCases:
		selectComparisonEntryByTraceMetric(
			entries,
			'retrievalId',
			'officeParagraphEvidenceReconcileCases'
		),
	bestByOfficeListEvidenceReconcileCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'officeListEvidenceReconcileCases'
	),
	bestByOfficeTableEvidenceReconcileCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'officeTableEvidenceReconcileCases'
	),
	bestByPDFEvidenceReconcileCases: selectComparisonEntryByTraceMetric(
		entries,
		'retrievalId',
		'pdfEvidenceReconcileCases'
	),
	bestByLowestRuntimeCandidateBudgetExhaustedCases:
		selectComparisonEntryByLowestTraceMetric(
			entries,
			'retrievalId',
			'runtimeCandidateBudgetExhaustedCases'
		),
	bestByLowestRuntimeUnderfilledTopKCases:
		selectComparisonEntryByLowestTraceMetric(
			entries,
			'retrievalId',
			'runtimeUnderfilledTopKCases'
		)
});
