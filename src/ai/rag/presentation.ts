import type {
	RAGAdminActionPresentation,
	RAGAdminActionRecord,
	RAGAdminJobPresentation,
	RAGAdminJobRecord,
	AIMessage,
	RAGAnswerGroundingCaseSnapshotPresentation,
	RAGAnswerGroundingEvaluationCaseDiff,
	RAGAnswerGroundingEvaluationHistory,
	RAGAnswerGroundingEntityQualitySummary,
	RAGAnswerGroundingEntityQualityView,
	RAGAnswerGroundingEvaluationResponse,
	RAGCorpusHealth,
	RAGCorpusHealthPresentation,
	RAGExtractorReadiness,
	RAGReadinessPresentation,
	RAGGroundingOverviewPresentation,
	RAGGroundingProviderCaseComparisonPresentation,
	RAGGroundingProviderOverviewPresentation,
	RAGGroundingProviderPresentation,
	RAGComparisonOverviewPresentation,
	RAGComparisonPresentation,
	RAGChunkGraph,
	RAGChunkExcerpts,
	RAGExcerptModeCounts,
	RAGExcerptPromotionReason,
	RAGExcerptSelection,
	RAGChunkGraphEdge,
	RAGChunkGraphNavigation,
	RAGChunkGraphNode,
	RAGChunkGraphSectionGroup,
	RAGChunkStructure,
	RAGDocumentChunkPreview,
	RAGLabelValueRow,
	RAGRerankerComparisonEntry,
	RAGRetrievalComparison,
	RAGRetrievalComparisonEntry,
	RAGRetrievalComparisonRun,
	RAGRetrievalReleaseGroupHistoryPresentation,
	RAGRetrievalReleaseHistoryRunPresentation,
	RAGRetrievalReleaseTimelineSummary,
	RAGRetrievalTraceHistoryWindow,
	RAGRetrievalTraceStep,
	RAGRetrievalTrace,
	RAGHybridRetrievalMode,
	RAGSourceBalanceStrategy,
	RAGQualityOverviewPresentation,
	RAGSectionRetrievalDiagnostic,
	RAGEvaluationCaseDiff,
	RAGEvaluationCaseTracePresentation,
	RAGEvaluationEntityQualitySummary,
	RAGEvaluationEntityQualityView,
	RAGEvaluationHistory,
	RAGAnswerGroundingHistoryPresentation,
	RAGEvaluationResponse,
	RAGEvaluationHistoryPresentation,
	RAGEvaluationHistoryStore,
	RAGEvaluationSuiteSnapshotHistory,
	RAGEvaluationSuiteSnapshotHistoryPresentation,
	RAGEvaluationSuiteSnapshotPresentation,
	RAGEntityQualityPresentation,
	RAGEntityQualityViewPresentation,
	RAGRerankerComparison,
	RAGAnswerWorkflowState,
	RAGRetrievalTracePresentation,
	RAGSource,
	RAGSourceLabels,
	RAGSourceGroup,
	RAGSourceSummary,
	RAGStreamStage,
	RAGSyncOverviewPresentation,
	RAGSyncSourcePresentation,
	RAGSyncSourceRecord,
	RAGSyncSourceRunPresentation
} from '../../../types/ai';
import {
	buildRAGCitationReferenceMap,
	buildRAGCitations,
	buildRAGGroundedAnswer,
	buildRAGGroundedAnswerSectionSummaries,
	buildRAGGroundingReferences
} from './grounding';
import {
	buildRAGAnswerGroundingEntityQualityView,
	buildRAGEvaluationEntityQualityView
} from './quality';

export {
	buildRAGCitationReferenceMap,
	buildRAGCitations,
	buildRAGGroundedAnswer,
	buildRAGGroundedAnswerSectionSummaries,
	buildRAGGroundingReferences
};

const buildSourceGroupKey = (source: RAGSource) =>
	source.source ?? source.title ?? source.chunkId;

const buildSourceLabel = (source: RAGSource) =>
	source.source ?? source.title ?? source.chunkId;

const getContextNumber = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getContextString = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;

const isRAGRetrievalTrace = (value: unknown): value is RAGRetrievalTrace => {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (
		typeof candidate.query === 'string' &&
		typeof candidate.transformedQuery === 'string' &&
		Array.isArray(candidate.variantQueries) &&
		Array.isArray(candidate.steps)
	);
};

const formatTimestampLabel = (value: unknown) => {
	const timestamp =
		typeof value === 'number' && Number.isFinite(value)
			? value
			: typeof value === 'string'
				? Date.parse(value)
				: Number.NaN;
	if (!Number.isFinite(timestamp)) {
		return undefined;
	}

	return new Date(timestamp).toLocaleString('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
};

const formatRAGTraceValue = (value: unknown): string => {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.join(', ');
	}
	if (value && typeof value === 'object') {
		return JSON.stringify(value);
	}
	return 'n/a';
};

const formatLeadContinuityCue = (value: unknown) => {
	const cue = getContextString(value);
	switch (cue) {
		case 'immediate_follow_up':
			return 'Immediate follow-up';
		case 'near_follow_up':
			return 'Near follow-up';
		case 'close_follow_up':
			return 'Close follow-up';
		case 'delayed_follow_up':
			return 'Delayed follow-up';
		case 'immediate_prior':
			return 'Immediate prior segment';
		case 'near_prior':
			return 'Near prior segment';
		case 'close_prior':
			return 'Close prior segment';
		case 'delayed_prior':
			return 'Delayed prior segment';
		default:
			return undefined;
	}
};

const formatLeadSpeakerAttributionCue = (value: unknown) => {
	const cue = getContextString(value);
	switch (cue) {
		case 'quoted_match':
			return 'Quoted speaker match';
		default:
			return undefined;
	}
};

const formatLeadChannelAttributionCue = (value: unknown) => {
	const cue = getContextString(value);
	switch (cue) {
		case 'quoted_match':
			return 'Quoted channel match';
		default:
			return undefined;
	}
};

const formatLeadMediaCueSummary = (input?: {
	leadSpeakerCue?: string;
	leadSpeakerAttributionCue?: string;
	leadChannelCue?: string;
	leadChannelAttributionCue?: string;
	leadContinuityCue?: string;
}) => {
	const parts = [
		input?.leadSpeakerCue ? `speaker ${input.leadSpeakerCue}` : undefined,
		input?.leadSpeakerAttributionCue === 'quoted_match'
			? 'quoted speaker match'
			: undefined,
		input?.leadChannelCue ? `channel ${input.leadChannelCue}` : undefined,
		input?.leadChannelAttributionCue === 'quoted_match'
			? 'quoted channel match'
			: undefined,
		formatLeadContinuityCue(input?.leadContinuityCue)
	].filter(
		(value): value is string =>
			typeof value === 'string' && value.length > 0
	);

	return parts.length > 0 ? parts.join(' · ') : 'none';
};

const formatRAGTraceMetadataRow = (
	key: string,
	value: unknown
): RAGLabelValueRow => ({
	label:
		key === 'sqliteQueryMode'
			? 'SQLite query mode'
			: key === 'postgresQueryMode'
				? 'Postgres query mode'
				: key === 'sqliteQueryPushdownMode'
					? 'SQLite pushdown mode'
					: key === 'postgresQueryPushdownMode'
						? 'Postgres pushdown mode'
						: key === 'sqliteQueryPushdownApplied'
							? 'SQLite pushdown applied'
							: key === 'postgresQueryPushdownApplied'
								? 'Postgres pushdown applied'
								: key === 'sqliteQueryPushdownClauseCount'
									? 'SQLite pushdown clauses'
									: key === 'postgresQueryPushdownClauseCount'
										? 'Postgres pushdown clauses'
										: key ===
											  'sqliteQueryPushdownCoverageRatio'
											? 'SQLite pushdown coverage'
											: key ===
												  'postgresQueryPushdownCoverageRatio'
												? 'Postgres pushdown coverage'
												: key ===
													  'sqliteQueryTotalFilterClauseCount'
													? 'SQLite total filter clauses'
													: key ===
														  'postgresQueryTotalFilterClauseCount'
														? 'Postgres total filter clauses'
														: key ===
															  'sqliteQueryJsRemainderClauseCount'
															? 'SQLite JS remainder clauses'
															: key ===
																  'sqliteQueryMultiplierUsed'
																? 'SQLite query multiplier'
																: key ===
																	  'sqliteQueryPlannerProfileUsed'
																	? 'SQLite query profile'
																	: key ===
																		  'sqliteQueryCandidateLimitUsed'
																		? 'SQLite candidate limit'
																		: key ===
																			  'sqliteQueryMaxBackfillsUsed'
																			? 'SQLite max backfills'
																			: key ===
																				  'sqliteQueryMinResultsUsed'
																				? 'SQLite min results'
																				: key ===
																					  'sqliteQueryFillPolicyUsed'
																					? 'SQLite fill policy'
																					: key ===
																						  'postgresQueryJsRemainderClauseCount'
																						? 'Postgres JS remainder clauses'
																						: key ===
																							  'postgresQueryMultiplierUsed'
																							? 'Postgres query multiplier'
																							: key ===
																								  'postgresQueryPlannerProfileUsed'
																								? 'Postgres query profile'
																								: key ===
																									  'postgresQueryCandidateLimitUsed'
																									? 'Postgres candidate limit'
																									: key ===
																										  'postgresQueryMaxBackfillsUsed'
																										? 'Postgres max backfills'
																										: key ===
																											  'postgresQueryMinResultsUsed'
																											? 'Postgres min results'
																											: key ===
																												  'postgresQueryFillPolicyUsed'
																												? 'Postgres fill policy'
																												: key ===
																													  'sqliteQueryJsRemainderRatio'
																													? 'SQLite JS remainder share'
																													: key ===
																														  'postgresQueryJsRemainderRatio'
																														? 'Postgres JS remainder share'
																														: key ===
																															  'sqliteQueryFilteredCandidates'
																															? 'SQLite filtered candidates'
																															: key ===
																																  'postgresQueryFilteredCandidates'
																																? 'Postgres filtered candidates'
																																: key ===
																																	  'sqliteQueryInitialSearchK'
																																	? 'SQLite initial searchK'
																																	: key ===
																																		  'postgresQueryInitialSearchK'
																																		? 'Postgres initial searchK'
																																		: key ===
																																			  'sqliteQueryFinalSearchK'
																																			? 'SQLite final searchK'
																																			: key ===
																																				  'postgresQueryFinalSearchK'
																																				? 'Postgres final searchK'
																																				: key ===
																																					  'sqliteQuerySearchExpansionRatio'
																																					? 'SQLite search expansion'
																																					: key ===
																																						  'postgresQuerySearchExpansionRatio'
																																						? 'Postgres search expansion'
																																						: key ===
																																							  'sqliteQueryBackfillCount'
																																							? 'SQLite backfill count'
																																							: key ===
																																								  'sqliteQueryBackfillLimitReached'
																																								? 'SQLite backfill limit reached'
																																								: key ===
																																									  'sqliteQueryMinResultsSatisfied'
																																									? 'SQLite min results satisfied'
																																									: key ===
																																										  'postgresQueryBackfillCount'
																																										? 'Postgres backfill count'
																																										: key ===
																																											  'postgresQueryBackfillLimitReached'
																																											? 'Postgres backfill limit reached'
																																											: key ===
																																												  'postgresQueryMinResultsSatisfied'
																																												? 'Postgres min results satisfied'
																																												: key ===
																																													  'sqliteQueryReturnedCount'
																																													? 'SQLite returned hits'
																																													: key ===
																																														  'postgresQueryReturnedCount'
																																														? 'Postgres returned hits'
																																														: key ===
																																															  'sqliteQueryCandidateYieldRatio'
																																															? 'SQLite candidate yield'
																																															: key ===
																																																  'postgresQueryCandidateYieldRatio'
																																																? 'Postgres candidate yield'
																																																: key ===
																																																	  'sqliteQueryTopKFillRatio'
																																																	? 'SQLite topK fill rate'
																																																	: key ===
																																																		  'postgresQueryTopKFillRatio'
																																																		? 'Postgres topK fill rate'
																																																		: key ===
																																																			  'sqliteQueryUnderfilledTopK'
																																																			? 'SQLite underfilled topK'
																																																			: key ===
																																																				  'postgresQueryUnderfilledTopK'
																																																				? 'Postgres underfilled topK'
																																																				: key ===
																																																					  'sqliteQueryCandidateBudgetExhausted'
																																																					? 'SQLite candidate budget exhausted'
																																																					: key ===
																																																						  'postgresQueryCandidateBudgetExhausted'
																																																						? 'Postgres candidate budget exhausted'
																																																						: key ===
																																																							  'sqliteQueryCandidateCoverage'
																																																							? 'SQLite candidate coverage'
																																																							: key ===
																																																								  'postgresQueryCandidateCoverage'
																																																								? 'Postgres candidate coverage'
																																																								: key ===
																																																									  'postgresIndexType'
																																																									? 'Postgres index type'
																																																									: key ===
																																																										  'postgresIndexName'
																																																										? 'Postgres index name'
																																																										: key ===
																																																											  'postgresIndexPresent'
																																																											? 'Postgres index present'
																																																											: key ===
																																																												  'postgresEstimatedRowCount'
																																																												? 'Postgres estimated rows'
																																																												: key ===
																																																													  'postgresTableBytes'
																																																													? 'Postgres table bytes'
																																																													: key ===
																																																														  'postgresIndexBytes'
																																																														? 'Postgres index bytes'
																																																														: key ===
																																																															  'postgresTotalBytes'
																																																															? 'Postgres total bytes'
																																																															: key ===
																																																																  'postgresIndexStorageRatio'
																																																																? 'Postgres index storage ratio'
																																																																: key ===
																																																																	  'leadSpeakerCue'
																																																																	? 'Lead speaker cue'
																																																																	: key ===
																																																																		  'leadSpeakerAttributionCue'
																																																																		? 'Lead speaker attribution'
																																																																		: key ===
																																																																			  'leadChannelAttributionCue'
																																																																			? 'Lead channel attribution'
																																																																			: key ===
																																																																				  'leadChannelCue'
																																																																				? 'Lead channel cue'
																																																																				: key ===
																																																																					  'leadContinuityCue'
																																																																					? 'Lead continuity cue'
																																																																					: key,
	value:
		key === 'sourceAwareChunkReason'
			? (formatSourceAwareChunkReason(value) ??
				formatRAGTraceValue(value))
			: key === 'leadSpeakerAttributionCue'
				? (formatLeadSpeakerAttributionCue(value) ??
					formatRAGTraceValue(value))
				: key === 'leadChannelAttributionCue'
					? (formatLeadChannelAttributionCue(value) ??
						formatRAGTraceValue(value))
					: key === 'leadContinuityCue'
						? (formatLeadContinuityCue(value) ??
							formatRAGTraceValue(value))
						: formatRAGTraceValue(value)
});

export const buildRAGRetrievalTracePresentation = (
	trace?: RAGRetrievalTrace
): RAGRetrievalTracePresentation => {
	if (!trace) {
		return {
			details: [],
			stats: [],
			steps: []
		};
	}

	const stats: RAGLabelValueRow[] = [
		{ label: 'Mode', value: trace.mode },
		{ label: 'Final Results', value: String(trace.resultCounts.final) },
		{
			label: 'Vector Candidates',
			value: String(trace.resultCounts.vector)
		},
		{
			label: 'Lexical Candidates',
			value: String(trace.resultCounts.lexical)
		}
	];
	const details: RAGLabelValueRow[] = [
		{ label: 'Transformed query', value: trace.transformedQuery },
		...(trace.queryTransformLabel || trace.queryTransformProvider
			? [
					{
						label: 'Query transform',
						value:
							trace.queryTransformLabel ??
							trace.queryTransformProvider ??
							'configured'
					},
					...(trace.queryTransformReason
						? [
								{
									label: 'Query transform reason',
									value: trace.queryTransformReason
								}
							]
						: [])
				]
			: []),
		{
			label: 'Variant queries',
			value:
				trace.variantQueries.length > 0
					? trace.variantQueries.join(' · ')
					: 'none'
		},
		...(trace.requestedMode && trace.requestedMode !== trace.mode
			? [{ label: 'Requested mode', value: trace.requestedMode }]
			: []),
		...(trace.routingLabel || trace.routingProvider
			? [
					{
						label: 'Routing decision',
						value:
							trace.routingLabel ??
							trace.routingProvider ??
							'configured'
					},
					...(trace.routingReason
						? [
								{
									label: 'Routing reason',
									value: trace.routingReason
								}
							]
						: [])
				]
			: []),
		{ label: 'Candidate topK', value: String(trace.candidateTopK) },
		{ label: 'Lexical topK', value: String(trace.lexicalTopK) }
	];
	const steps = trace.steps.map((step) => {
		const sqlitePlannerCues = formatSQLitePlannerCueSummary(step.metadata);
		const postgresPlannerCues = formatPostgresPlannerCueSummary(
			step.metadata
		);

		return {
			count: step.count,
			label: step.label,
			rows: [
				{ label: 'stage', value: step.stage },
				...(typeof step.count === 'number'
					? [{ label: 'count', value: String(step.count) }]
					: []),
				...(typeof step.durationMs === 'number'
					? [{ label: 'durationMs', value: String(step.durationMs) }]
					: []),
				...(sqlitePlannerCues !== 'none'
					? [
							{
								label: 'SQLite planner cues',
								value: sqlitePlannerCues
							}
						]
					: []),
				...(postgresPlannerCues !== 'none'
					? [
							{
								label: 'Postgres planner cues',
								value: postgresPlannerCues
							}
						]
					: []),
				...Object.entries(step.metadata ?? {}).map(([key, value]) =>
					formatRAGTraceMetadataRow(key, value)
				)
			],
			stage: step.stage
		};
	});

	return {
		details,
		stats,
		steps
	};
};

const formatCompactList = (values?: string[]) =>
	values && values.length > 0 ? values.join(', ') : 'none';

const formatCoverageMap = (entries?: Record<string, number>) => {
	if (!entries) {
		return 'none';
	}

	const values = Object.entries(entries);
	return values.length > 0
		? values.map(([key, value]) => `${key} ${value}`).join(' · ')
		: 'none';
};

const formatByteSizeLabel = (value?: number) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return 'n/a';
	}

	if (value < 1024) {
		return `${Math.round(value)} B`;
	}

	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KiB`;
	}

	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(
			value >= 10 * 1024 * 1024 ? 0 : 1
		)} MiB`;
	}

	return `${(value / (1024 * 1024 * 1024)).toFixed(
		value >= 10 * 1024 * 1024 * 1024 ? 0 : 1
	)} GiB`;
};

const formatDurationLabel = (value?: number) => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 'n/a';
	}

	if (value < 1000) {
		return `${value}ms`;
	}

	if (value < 60000) {
		return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
	}

	if (value < 3600000) {
		return `${(value / 60000).toFixed(value >= 600000 ? 0 : 1)}m`;
	}

	return `${(value / 3600000).toFixed(value >= 36000000 ? 0 : 1)}h`;
};

const formatDateLabel = (value?: number) =>
	typeof value === 'number' && Number.isFinite(value)
		? new Date(value).toLocaleString('en-US')
		: 'n/a';

const formatAgeLabel = (value?: number) => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 'n/a';
	}

	if (value < 1000) {
		return `${Math.round(value)}ms`;
	}

	if (value < 60000) {
		return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
	}

	if (value < 3600000) {
		return `${(value / 60000).toFixed(value >= 600000 ? 0 : 1)}m`;
	}

	if (value < 86400000) {
		return `${(value / 3600000).toFixed(value >= 36000000 ? 0 : 1)}h`;
	}

	return `${(value / 86400000).toFixed(value >= 864000000 ? 0 : 1)}d`;
};

const formatSourceAwareChunkReason = (value: unknown) => {
	const reason = getContextString(value);
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

const buildSourceAwareUnitScopeLabel = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const sectionKind = getContextString(metadata.sectionKind);
	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const sectionTitle =
		getContextString(metadata.sectionTitle) ?? sectionPath.at(-1);
	const pdfSemanticRole = getContextString(metadata.pdfSemanticRole);
	const pdfTextKind = getContextString(metadata.pdfTextKind);
	const officeBlockKindValue = getContextString(metadata.officeBlockKind);
	const officeBlockKind =
		officeBlockKindValue === 'table' ||
		officeBlockKindValue === 'list' ||
		officeBlockKindValue === 'paragraph'
			? officeBlockKindValue
			: undefined;
	const sheetName = getContextString(metadata.sheetName);
	const spreadsheetTableLabel = formatSpreadsheetTableLabel(
		getContextNumber(metadata.spreadsheetTableIndex),
		getContextNumber(metadata.spreadsheetTableCount)
	);
	const slideTitle = getContextString(metadata.slideTitle);
	const slideNumber =
		getContextNumber(metadata.slideNumber) ??
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
		if (pdfSemanticRole === 'figure_caption' && sectionTitle) {
			return `Source-aware PDF figure caption ${sectionTitle}`;
		}
		if (pdfSemanticRole === 'figure_body' && sectionTitle) {
			return `Source-aware PDF figure body ${sectionTitle}`;
		}
		if (pdfTextKind === 'table_like' && sectionTitle) {
			return `Source-aware PDF table block ${sectionTitle}`;
		}
		if (sectionTitle) {
			return `Source-aware PDF block ${sectionTitle}`;
		}
		return 'Source-aware PDF block';
	}

	if (sectionKind === 'office_block') {
		const officeSectionLabel =
			sectionPath.length > 0 ? sectionPath.join(' > ') : sectionTitle;
		if (officeBlockKind && officeSectionLabel) {
			return `Source-aware office ${officeBlockKind} block ${officeSectionLabel}`;
		}
		if (officeSectionLabel) {
			return `Source-aware office block ${officeSectionLabel}`;
		}
		return 'Source-aware office block';
	}

	if (
		sectionKind === 'spreadsheet_rows' ||
		(sectionKind === undefined &&
			(sheetName ||
				spreadsheetTableLabel ||
				getContextNumber(metadata.spreadsheetRowStart) !== undefined ||
				getContextNumber(metadata.spreadsheetRowEnd) !== undefined))
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

const buildSyncOverviewLatestRow = (sources: RAGSyncSourceRecord[]) => {
	const latest = [...sources]
		.filter(
			(record) =>
				typeof record.lastSuccessfulSyncAt === 'number' ||
				typeof record.lastSyncedAt === 'number'
		)
		.sort(
			(left, right) =>
				(right.lastSuccessfulSyncAt ?? right.lastSyncedAt ?? 0) -
				(left.lastSuccessfulSyncAt ?? left.lastSyncedAt ?? 0)
		)[0];

	if (!latest) {
		return {
			label: 'Latest sync',
			value: 'No completed run yet'
		};
	}

	return {
		label: 'Latest sync',
		value: [
			latest.label,
			typeof latest.documentCount === 'number'
				? `${latest.documentCount} docs`
				: '',
			typeof latest.chunkCount === 'number'
				? `${latest.chunkCount} chunks`
				: '',
			typeof latest.lastSyncDurationMs === 'number'
				? formatDurationLabel(latest.lastSyncDurationMs)
				: '',
			typeof latest.lastSuccessfulSyncAt === 'number'
				? formatDateLabel(latest.lastSuccessfulSyncAt)
				: typeof latest.lastSyncedAt === 'number'
					? formatDateLabel(latest.lastSyncedAt)
					: ''
		]
			.filter(Boolean)
			.join(' · ')
	};
};

const formatAdminActionLabel = (
	value: RAGAdminActionRecord['action'] | RAGAdminJobRecord['action']
) => value.replaceAll('_', ' ');

const buildAdminTimingLabel = (input: {
	elapsedMs?: number;
	startedAt: number;
}) =>
	typeof input.elapsedMs === 'number'
		? formatDurationLabel(input.elapsedMs)
		: formatDateLabel(input.startedAt);

export const buildRAGAdminJobPresentation = (
	job: RAGAdminJobRecord
): RAGAdminJobPresentation => ({
	id: job.id,
	action: job.action,
	status: job.status,
	summary: [
		job.status.toUpperCase(),
		formatAdminActionLabel(job.action),
		job.target,
		buildAdminTimingLabel(job)
	]
		.filter(Boolean)
		.join(' · '),
	rows: [
		{ label: 'Action', value: formatAdminActionLabel(job.action) },
		{ label: 'Status', value: job.status },
		...(job.target ? [{ label: 'Target', value: job.target }] : []),
		{ label: 'Timing', value: buildAdminTimingLabel(job) },
		...(job.error ? [{ label: 'Error', value: job.error }] : [])
	]
});

export const buildRAGAdminJobPresentations = (
	jobs?: RAGAdminJobRecord[]
): RAGAdminJobPresentation[] =>
	(jobs ?? []).slice(0, 3).map(buildRAGAdminJobPresentation);

export const buildRAGAdminActionPresentation = (
	action: RAGAdminActionRecord
): RAGAdminActionPresentation => ({
	id: action.id,
	action: action.action,
	status: action.status,
	summary: [
		action.status.toUpperCase(),
		formatAdminActionLabel(action.action),
		action.documentId ?? action.target,
		buildAdminTimingLabel(action)
	]
		.filter(Boolean)
		.join(' · '),
	rows: [
		{ label: 'Action', value: formatAdminActionLabel(action.action) },
		{ label: 'Status', value: action.status },
		...(action.documentId
			? [{ label: 'Document', value: action.documentId }]
			: action.target
				? [{ label: 'Target', value: action.target }]
				: []),
		{ label: 'Timing', value: buildAdminTimingLabel(action) },
		...(action.error ? [{ label: 'Error', value: action.error }] : [])
	]
});

export const buildRAGAdminActionPresentations = (
	actions?: RAGAdminActionRecord[]
): RAGAdminActionPresentation[] =>
	(actions ?? []).slice(0, 3).map(buildRAGAdminActionPresentation);

const buildRAGSyncSourceRunPresentations = (
	source: RAGSyncSourceRecord
): RAGSyncSourceRunPresentation[] => {
	if (!Array.isArray(source.metadata?.recentRuns)) {
		return [];
	}

	return (source.metadata.recentRuns as Array<Record<string, unknown>>)
		.slice(0, 3)
		.map((entry, index) => {
			const trigger =
				typeof entry.trigger === 'string' ? entry.trigger : 'sync';
			const status =
				typeof entry.status === 'string' ? entry.status : 'unknown';
			const finishedAt =
				typeof entry.finishedAt === 'number'
					? formatDateLabel(entry.finishedAt)
					: 'n/a';
			const duration =
				typeof entry.durationMs === 'number'
					? formatDurationLabel(entry.durationMs)
					: 'n/a';
			const docs =
				typeof entry.documentCount === 'number'
					? `${entry.documentCount} docs`
					: 'n/a';
			const chunks =
				typeof entry.chunkCount === 'number'
					? `${entry.chunkCount} chunks`
					: 'n/a';
			const error =
				typeof entry.error === 'string' && entry.error.length > 0
					? entry.error
					: undefined;

			return {
				label: `Run ${index + 1}`,
				status,
				summary: `${trigger} · ${status} · ${docs} · ${chunks} · ${duration} · ${finishedAt}`,
				rows: [
					{ label: 'Trigger', value: trigger },
					{ label: 'Status', value: status },
					{ label: 'Output', value: `${docs} · ${chunks}` },
					{ label: 'Duration', value: duration },
					{ label: 'Finished', value: finishedAt },
					...(error ? [{ label: 'Error', value: error }] : [])
				]
			};
		});
};

export const buildRAGSyncSourcePresentation = (
	source: RAGSyncSourceRecord
): RAGSyncSourcePresentation => {
	const provider =
		typeof source.metadata?.provider === 'string'
			? source.metadata.provider
			: undefined;
	const accountMode =
		typeof source.metadata?.accountMode === 'string'
			? source.metadata.accountMode
			: undefined;
	const schedule =
		typeof source.metadata?.schedule === 'string'
			? source.metadata.schedule
			: undefined;
	const lastTrigger =
		typeof source.metadata?.lastTrigger === 'string'
			? source.metadata.lastTrigger
			: undefined;
	const liveReady =
		typeof source.metadata?.liveReady === 'string'
			? source.metadata.liveReady
			: undefined;
	const diagnosticSummary = source.diagnostics?.summary;
	const diagnosticTags =
		source.diagnostics?.entries.map((entry) =>
			entry.code
				.replace(/_/g, ' ')
				.replace(/\b\w/g, (letter) => letter.toUpperCase())
		) ?? [];
	const retryGuidance = source.diagnostics?.retryGuidance;

	return {
		id: source.id,
		label: source.label,
		kind: source.kind,
		status: source.status,
		summary: [
			source.kind,
			source.status,
			typeof source.documentCount === 'number'
				? `${source.documentCount} docs`
				: '',
			typeof source.chunkCount === 'number'
				? `${source.chunkCount} chunks`
				: '',
			typeof source.lastSyncDurationMs === 'number'
				? formatDurationLabel(source.lastSyncDurationMs)
				: '',
			typeof source.lastSuccessfulSyncAt === 'number'
				? `last success ${formatDateLabel(source.lastSuccessfulSyncAt)}`
				: typeof source.lastSyncedAt === 'number'
					? `last sync ${formatDateLabel(source.lastSyncedAt)}`
					: ''
		]
			.filter(Boolean)
			.join(' · '),
		rows: [
			...(source.target
				? [{ label: 'Target', value: source.target }]
				: []),
			...(provider ? [{ label: 'Provider', value: provider }] : []),
			...(accountMode
				? [{ label: 'Account mode', value: accountMode }]
				: []),
			...(schedule ? [{ label: 'Schedule', value: schedule }] : []),
			...(lastTrigger
				? [{ label: 'Last trigger', value: lastTrigger }]
				: []),
			...(typeof source.lastSuccessfulSyncAt === 'number'
				? [
						{
							label: 'Last success',
							value: formatDateLabel(source.lastSuccessfulSyncAt)
						}
					]
				: []),
			...(typeof source.nextRetryAt === 'number'
				? [
						{
							label: 'Next retry',
							value: formatDateLabel(source.nextRetryAt)
						}
					]
				: []),
			...(source.lastError
				? [{ label: 'Last error', value: source.lastError }]
				: []),
			...(diagnosticSummary
				? [{ label: 'Diagnostics', value: diagnosticSummary }]
				: []),
			...(retryGuidance
				? [{ label: 'Retry guidance', value: retryGuidance.reason }]
				: [])
		],
		tags: [
			provider,
			accountMode ? `mode ${accountMode}` : undefined,
			liveReady,
			...diagnosticTags
		].filter((value): value is string => Boolean(value)),
		extendedSummary: diagnosticSummary ?? source.description ?? liveReady,
		runs: buildRAGSyncSourceRunPresentations(source)
	};
};

export const buildRAGSyncSourcePresentations = (
	sources?: RAGSyncSourceRecord[]
): RAGSyncSourcePresentation[] =>
	(sources ?? []).map(buildRAGSyncSourcePresentation);

export const buildRAGReadinessPresentation = (
	readiness?: RAGExtractorReadiness
): RAGReadinessPresentation => {
	if (!readiness) {
		return {
			sections: [
				{
					label: 'Provider',
					title: 'Unavailable',
					summary: 'Readiness data is not available yet.'
				}
			]
		};
	}

	return {
		sections: [
			{
				label: 'Provider',
				title: readiness.providerConfigured
					? (readiness.providerName ?? 'Runtime provider routing')
					: 'Not configured',
				summary: readiness.providerConfigured
					? readiness.model
						? `Requests route through ${readiness.providerName ?? 'the runtime provider registry'} with default model ${readiness.model}.`
						: `Requests route through ${readiness.providerName ?? 'the runtime provider registry'}.`
					: 'Provider-backed retrieval is not configured yet.'
			},
			{
				label: 'Embeddings',
				title: readiness.embeddingConfigured
					? readiness.embeddingModel ===
						'collection-managed embeddings'
						? 'Collection-managed'
						: 'Configured'
					: 'Missing',
				summary: readiness.embeddingConfigured
					? readiness.embeddingModel ===
						'collection-managed embeddings'
						? 'Embeddings come from the collection and vector store layer, so retrieval stays vector-backed without a separate top-level embedding provider.'
						: (readiness.embeddingModel ??
							'Embedding model configured.')
					: 'Embeddings are not configured yet.'
			},
			{
				label: 'Retrieval Stack',
				title: readiness.rerankerConfigured
					? 'Reranker ready'
					: 'Vector only',
				summary: readiness.indexManagerConfigured
					? 'Index manager configured.'
					: 'Index manager not configured.'
			},
			{
				label: 'Extractors',
				title: readiness.extractorsConfigured
					? `${readiness.extractorNames.length} configured`
					: 'None configured',
				summary: readiness.extractorsConfigured
					? `Configured extractors: ${formatCompactList(readiness.extractorNames)}`
					: 'No extractors configured.',
				tags:
					readiness.extractorNames.length > 0
						? readiness.extractorNames
						: ['No extractors configured']
			}
		]
	};
};

export const buildRAGCorpusHealthPresentation = (
	health?: RAGCorpusHealth
): RAGCorpusHealthPresentation => {
	if (!health) {
		return {
			sections: [
				{
					label: 'Corpus health',
					title: 'Unavailable',
					summary: 'Corpus health is not available yet.'
				}
			]
		};
	}

	return {
		sections: [
			{
				label: 'Corpus coverage',
				title: `Formats: ${formatCoverageMap(health.coverageByFormat)}`,
				summary: `Kinds: ${formatCoverageMap(health.coverageByKind)}`,
				rows: [
					{
						label: 'Average chunks per document',
						value: health.averageChunksPerDocument.toFixed(2)
					}
				]
			},
			{
				label: 'Chunk quality',
				title: `${health.averageChunksPerDocument.toFixed(2)} avg chunks/doc`,
				summary: `Empty docs ${health.emptyDocuments} · empty chunks ${health.emptyChunks} · low signal ${health.lowSignalChunks}`,
				rows: [
					{
						label: 'Missing source',
						value: String(health.documentsMissingSource)
					},
					{
						label: 'Missing title',
						value: String(health.documentsMissingTitle)
					},
					{
						label: 'Missing metadata',
						value: String(health.documentsMissingMetadata)
					}
				]
			},
			{
				label: 'Freshness',
				title: `${health.staleDocuments.length} stale docs`,
				summary: `Stale threshold ${formatAgeLabel(health.staleAfterMs)}`,
				rows: [
					{
						label: 'Oldest age',
						value: formatAgeLabel(health.oldestDocumentAgeMs)
					},
					{
						label: 'Newest age',
						value: formatAgeLabel(health.newestDocumentAgeMs)
					}
				]
			},
			{
				label: 'Failures',
				title: `${health.failedIngestJobs} ingest · ${health.failedAdminJobs} admin`,
				summary: `Duplicate sources ${health.duplicateSourceGroups.length} · duplicate ids ${health.duplicateDocumentIdGroups.length}`,
				rows: [
					{
						label: 'Failures by input',
						value: formatCoverageMap(health.failuresByInputKind)
					},
					{
						label: 'Failures by extractor',
						value: formatCoverageMap(health.failuresByExtractor)
					},
					{
						label: 'Failures by admin action',
						value: formatCoverageMap(health.failuresByAdminAction)
					}
				]
			}
		]
	};
};

export const buildRAGSyncOverviewPresentation = (
	sources?: RAGSyncSourceRecord[]
): RAGSyncOverviewPresentation => {
	const records = sources ?? [];
	if (records.length === 0) {
		return {
			rows: [
				{ label: 'Configured sync sources', value: '0' },
				{
					label: 'Latest sync',
					value: 'No sync sources configured yet.'
				}
			],
			sections: [
				{
					label: 'Sync overview',
					title: 'No sync sources configured',
					summary:
						'Add sync sources to monitor directories, URLs, storage, or mailboxes.'
				}
			]
		};
	}

	const countByStatus = (status: RAGSyncSourceRecord['status']) =>
		records.filter((record) => record.status === status).length;

	return {
		rows: [
			{ label: 'Configured sync sources', value: String(records.length) },
			{ label: 'Completed', value: String(countByStatus('completed')) },
			{ label: 'Running', value: String(countByStatus('running')) },
			{
				label: 'Failed',
				value: String(countByStatus('failed'))
			},
			buildSyncOverviewLatestRow(records)
		],
		sections: [
			{
				label: 'Sync overview',
				title: `${records.length} configured`,
				summary: `${countByStatus('completed')} completed · ${countByStatus('running')} running · ${countByStatus('failed')} failed`
			},
			{
				label: 'Latest sync',
				title: buildSyncOverviewLatestRow(records).value,
				summary: 'Most recent completed or last-known sync activity.'
			}
		]
	};
};

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

const getAttachmentName = (source?: string, title?: string) => {
	const sourceAttachment = source?.split('/').at(-1);
	if (sourceAttachment && sourceAttachment.includes('.')) {
		return sourceAttachment;
	}

	const titleAttachment = title?.split(' · ').at(-1);
	if (titleAttachment && titleAttachment.includes('.')) {
		return titleAttachment;
	}

	return undefined;
};

const getSpreadsheetHeaders = (metadata?: Record<string, unknown>) =>
	Array.isArray(metadata?.spreadsheetHeaders)
		? metadata.spreadsheetHeaders
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];

const formatSpreadsheetColumnRange = (
	columnStart?: string,
	columnEnd?: string
) => {
	if (typeof columnStart !== 'string' || columnStart.length === 0) {
		return undefined;
	}
	if (typeof columnEnd !== 'string' || columnEnd.length === 0) {
		return `Columns ${columnStart}`;
	}
	if (columnStart === columnEnd) {
		return `Columns ${columnStart}`;
	}

	return `Columns ${columnStart}-${columnEnd}`;
};

const formatSpreadsheetRowRange = (rowStart?: number, rowEnd?: number) => {
	if (typeof rowStart !== 'number' || !Number.isFinite(rowStart)) {
		return undefined;
	}
	if (
		typeof rowEnd !== 'number' &&
		typeof rowStart === 'number' &&
		Number.isFinite(rowStart)
	) {
		return `Rows ${rowStart}`;
	}
	if (rowStart === rowEnd) {
		return `Rows ${rowStart}`;
	}

	return `Rows ${rowStart}-${rowEnd}`;
};

const formatSpreadsheetTableLabel = (
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

const formatOfficeListLevelsLabel = (value: unknown) => {
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}

	const levels = value
		.map((entry) => getContextNumber(entry))
		.filter((entry): entry is number => typeof entry === 'number')
		.sort((left, right) => left - right);

	if (levels.length === 0) {
		return undefined;
	}

	const minLevel = levels[0];
	const maxLevel = levels[levels.length - 1];

	return minLevel === maxLevel
		? `Office list level ${minLevel}`
		: `Office list levels ${minLevel}-${maxLevel}`;
};

const formatMediaDurationLabel = (value: unknown) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	return formatMediaTimestamp(value);
};

const buildContextLabel = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const pdfTextKind = getContextString(metadata.pdfTextKind);
	const pdfSemanticRole = getContextString(metadata.pdfSemanticRole);
	const pdfTableBodyRowStart = getContextNumber(
		metadata.pdfTableBodyRowStart
	);
	const pdfTableBodyRowEnd = getContextNumber(metadata.pdfTableBodyRowEnd);
	const officeBlockKindValue = getContextString(metadata.officeBlockKind);
	const officeBlockKind =
		officeBlockKindValue === 'table' ||
		officeBlockKindValue === 'list' ||
		officeBlockKindValue === 'paragraph'
			? officeBlockKindValue
			: undefined;
	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const sectionTitle =
		getContextString(metadata.sectionTitle) ?? sectionPath.at(-1);
	if (pdfSemanticRole === 'figure_caption' && sectionTitle) {
		return `PDF figure caption ${sectionTitle}`;
	}
	if (pdfSemanticRole === 'figure_body' && sectionTitle) {
		return `PDF figure body ${sectionTitle}`;
	}
	if (pdfTextKind === 'table_like' && sectionTitle) {
		return `PDF table block ${sectionTitle}`;
	}
	if (pdfTextKind === 'paragraph' && sectionTitle) {
		return `PDF text block ${sectionTitle}`;
	}
	if (officeBlockKind === 'table' && sectionTitle) {
		return `Office table block ${sectionPath.join(' > ') || sectionTitle}`;
	}
	if (officeBlockKind === 'list' && sectionTitle) {
		return `Office list block ${sectionPath.join(' > ') || sectionTitle}`;
	}
	if (officeBlockKind === 'paragraph' && sectionTitle) {
		return `Office paragraph block ${sectionPath.join(' > ') || sectionTitle}`;
	}

	const emailKind = getContextString(metadata.emailKind);
	if (emailKind === 'attachment') {
		const attachmentName = getContextString(metadata.attachmentName);
		const threadTopic = getContextString(metadata.threadTopic);
		return attachmentName
			? threadTopic
				? `Attachment evidence ${attachmentName} in ${threadTopic}`
				: `Attachment evidence ${attachmentName}`
			: 'Attachment evidence';
	}

	if (emailKind === 'message') {
		const threadTopic = getContextString(metadata.threadTopic);
		const from = getContextString(metadata.from);
		if (threadTopic) {
			return from
				? `Message in ${threadTopic} from ${from}`
				: `Message in ${threadTopic}`;
		}
		return from ? `Message from ${from}` : 'Message evidence';
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
	const hasOCRTrace =
		typeof metadata.ocrRegionConfidence === 'number' ||
		typeof metadata.ocrConfidence === 'number' ||
		getContextString(metadata.pdfTextMode) === 'ocr' ||
		typeof metadata.ocrRegionCount === 'number';
	const ocrPageStart = getContextNumber(metadata.ocrPageStart);
	const ocrPageEnd = getContextNumber(metadata.ocrPageEnd);
	if (page && region) {
		if (hasOCRTrace) {
			return `OCR page ${page} region ${region}`;
		}
		return `Page ${page} region ${region}`;
	}
	if (page) {
		if (hasOCRTrace) {
			return `OCR page ${page}`;
		}
		return `Page ${page}`;
	}
	if (
		hasOCRTrace &&
		typeof ocrPageStart === 'number' &&
		typeof ocrPageEnd === 'number'
	) {
		return ocrPageStart === ocrPageEnd
			? `OCR page ${ocrPageStart}`
			: `OCR pages ${ocrPageStart}-${ocrPageEnd}`;
	}

	const sheet =
		getContextString(metadata.sheetName) ??
		(Array.isArray(metadata.sheetNames)
			? getContextString(metadata.sheetNames[0])
			: undefined);
	if (sheet) {
		const tableLabel = formatSpreadsheetTableLabel(
			getContextNumber(metadata.spreadsheetTableIndex),
			getContextNumber(metadata.spreadsheetTableCount)
		);
		const columnRange = formatSpreadsheetColumnRange(
			getContextString(metadata.spreadsheetColumnStart),
			getContextString(metadata.spreadsheetColumnEnd)
		);
		const rowRange = formatSpreadsheetRowRange(
			getContextNumber(metadata.spreadsheetRowStart),
			getContextNumber(metadata.spreadsheetRowEnd)
		);
		const headers = getSpreadsheetHeaders(metadata);
		if (tableLabel && rowRange && columnRange) {
			return `Sheet ${sheet} ${tableLabel} ${rowRange} ${columnRange}`;
		}
		if (tableLabel && rowRange) {
			return `Sheet ${sheet} ${tableLabel} ${rowRange}`;
		}
		if (tableLabel && columnRange) {
			return `Sheet ${sheet} ${tableLabel} ${columnRange}`;
		}
		if (tableLabel) {
			return `Sheet ${sheet} ${tableLabel}`;
		}
		if (rowRange && columnRange) {
			return `Sheet ${sheet} ${rowRange} ${columnRange}`;
		}
		if (rowRange) {
			return `Sheet ${sheet} ${rowRange}`;
		}
		if (columnRange) {
			return `Sheet ${sheet} ${columnRange}`;
		}
		if (headers.length > 0) {
			return `Sheet ${sheet} by ${headers.slice(0, 2).join(', ')}`;
		}
		return `Sheet ${sheet}`;
	}

	const slide =
		getContextNumber(metadata.slide) ??
		getContextNumber(metadata.slideNumber) ??
		(typeof metadata.slideIndex === 'number'
			? metadata.slideIndex + 1
			: undefined);
	const slideTitle = getContextString(metadata.slideTitle);
	if (slide) {
		if (slideTitle) {
			return `Slide ${slide} ${slideTitle}`;
		}
		return `Slide ${slide}`;
	}

	const archiveEntry =
		getContextString(metadata.archiveFullPath) ??
		getContextString(metadata.archivePath) ??
		getContextString(metadata.archiveEntryPath) ??
		getContextString(metadata.entryPath);
	if (archiveEntry) {
		return `Archive entry ${archiveEntry}`;
	}

	const threadTopic = getContextString(metadata.threadTopic);
	if (threadTopic) {
		return `Thread ${threadTopic}`;
	}

	const speaker = getContextString(metadata.speaker);
	if (speaker) {
		return `Speaker ${speaker}`;
	}
	if (sectionTitle) {
		return `Section ${sectionTitle}`;
	}

	return undefined;
};

const buildLocatorLabel = (
	metadata?: Record<string, unknown>,
	source?: string,
	title?: string
) => {
	if (!metadata) {
		return undefined;
	}

	const pdfTextKind = getContextString(metadata.pdfTextKind);
	const pdfSemanticRole = getContextString(metadata.pdfSemanticRole);
	const officeBlockKind = getContextString(metadata.officeBlockKind);
	const pdfBlockNumber = getContextNumber(metadata.pdfBlockNumber);
	const pdfTableBodyRowStart = getContextNumber(
		metadata.pdfTableBodyRowStart
	);
	const pdfTableBodyRowEnd = getContextNumber(metadata.pdfTableBodyRowEnd);
	const officeBlockNumber = getContextNumber(metadata.officeBlockNumber);
	const officeTableBodyRowStart = getContextNumber(
		metadata.officeTableBodyRowStart
	);
	const officeTableBodyRowEnd = getContextNumber(
		metadata.officeTableBodyRowEnd
	);
	const spreadsheetRowStart = getContextNumber(metadata.spreadsheetRowStart);
	const spreadsheetRowEnd = getContextNumber(metadata.spreadsheetRowEnd);
	const slideTitle = getContextString(metadata.slideTitle);

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
	const ocrPageStart = getContextNumber(metadata.ocrPageStart);
	const ocrPageEnd = getContextNumber(metadata.ocrPageEnd);
	if (page && region) {
		return `Page ${page} · Region ${region}`;
	}
	if (page && pdfBlockNumber && pdfSemanticRole === 'figure_caption') {
		return `Page ${page} · Figure Caption ${pdfBlockNumber}`;
	}
	if (page && pdfBlockNumber && pdfSemanticRole === 'figure_body') {
		return `Page ${page} · Figure Body ${pdfBlockNumber}`;
	}
	if (page && pdfBlockNumber && pdfTextKind === 'table_like') {
		if (
			typeof pdfTableBodyRowStart === 'number' &&
			typeof pdfTableBodyRowEnd === 'number'
		) {
			return pdfTableBodyRowStart === pdfTableBodyRowEnd
				? `Page ${page} · Table Block ${pdfBlockNumber} · Row ${pdfTableBodyRowStart}`
				: `Page ${page} · Table Block ${pdfBlockNumber} · Rows ${pdfTableBodyRowStart}-${pdfTableBodyRowEnd}`;
		}
		return `Page ${page} · Table Block ${pdfBlockNumber}`;
	}
	if (page && pdfBlockNumber) {
		return `Page ${page} · Text Block ${pdfBlockNumber}`;
	}
	if (page) {
		return `Page ${page}`;
	}
	if (typeof ocrPageStart === 'number' && typeof ocrPageEnd === 'number') {
		return ocrPageStart === ocrPageEnd
			? `Page ${ocrPageStart}`
			: `Pages ${ocrPageStart}-${ocrPageEnd}`;
	}

	const sheet =
		getContextString(metadata.sheetName) ??
		(Array.isArray(metadata.sheetNames)
			? getContextString(metadata.sheetNames[0])
			: undefined);
	if (sheet) {
		const tableLabel = formatSpreadsheetTableLabel(
			getContextNumber(metadata.spreadsheetTableIndex),
			getContextNumber(metadata.spreadsheetTableCount)
		);
		const columnRange = formatSpreadsheetColumnRange(
			getContextString(metadata.spreadsheetColumnStart),
			getContextString(metadata.spreadsheetColumnEnd)
		);
		const rowRange = formatSpreadsheetRowRange(
			spreadsheetRowStart,
			spreadsheetRowEnd
		);
		if (tableLabel && rowRange && columnRange) {
			return `Sheet ${sheet} · ${tableLabel} · ${rowRange} · ${columnRange}`;
		}
		if (tableLabel && rowRange) {
			return `Sheet ${sheet} · ${tableLabel} · ${rowRange}`;
		}
		if (tableLabel && columnRange) {
			return `Sheet ${sheet} · ${tableLabel} · ${columnRange}`;
		}
		if (tableLabel) {
			return `Sheet ${sheet} · ${tableLabel}`;
		}
		if (rowRange && columnRange) {
			return `Sheet ${sheet} · ${rowRange} · ${columnRange}`;
		}
		if (rowRange) {
			return `Sheet ${sheet} · ${rowRange}`;
		}
		return columnRange
			? `Sheet ${sheet} · ${columnRange}`
			: `Sheet ${sheet}`;
	}

	const slide =
		getContextNumber(metadata.slide) ??
		getContextNumber(metadata.slideNumber) ??
		(typeof metadata.slideIndex === 'number'
			? metadata.slideIndex + 1
			: undefined);
	if (slide) {
		return slideTitle ? `Slide ${slide} · ${slideTitle}` : `Slide ${slide}`;
	}

	const archiveEntry =
		getContextString(metadata.archiveFullPath) ??
		getContextString(metadata.archivePath) ??
		getContextString(metadata.archiveEntryPath) ??
		getContextString(metadata.entryPath);
	if (archiveEntry) {
		return `Archive entry ${archiveEntry}`;
	}

	const emailKind = getContextString(metadata.emailKind);
	if (emailKind === 'attachment') {
		const attachmentName =
			getContextString(metadata.attachmentName) ??
			getAttachmentName(source, title);
		const replyDepth = getContextNumber(metadata.replyDepth);
		if (attachmentName && replyDepth && replyDepth > 0) {
			return `Attachment ${attachmentName} · Reply depth ${replyDepth}`;
		}
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

	if (officeBlockNumber && officeBlockKind === 'table') {
		if (
			typeof officeTableBodyRowStart === 'number' &&
			typeof officeTableBodyRowEnd === 'number'
		) {
			return officeTableBodyRowStart === officeTableBodyRowEnd
				? `Office table block ${officeBlockNumber} · Row ${officeTableBodyRowStart}`
				: `Office table block ${officeBlockNumber} · Rows ${officeTableBodyRowStart}-${officeTableBodyRowEnd}`;
		}
		return `Office table block ${officeBlockNumber}`;
	}
	if (officeBlockNumber && officeBlockKind === 'list') {
		return `Office list block ${officeBlockNumber}`;
	}
	if (officeBlockNumber && officeBlockKind === 'paragraph') {
		return `Office paragraph block ${officeBlockNumber}`;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	if (sectionPath.length > 0) {
		return `Section ${sectionPath.join(' > ')}`;
	}

	return undefined;
};

const buildProvenanceLabel = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const threadTopic = getContextString(metadata.threadTopic);
	const replyDepth = getContextNumber(metadata.replyDepth);
	const threadMessageCount = getContextNumber(metadata.threadMessageCount);
	const threadRootMessageId = getContextString(metadata.threadRootMessageId);
	const from = getContextString(metadata.from);
	const sentAt =
		formatTimestampLabel(metadata.sentAt) ??
		formatTimestampLabel(metadata.receivedAt);
	const speaker = getContextString(metadata.speaker);
	const mediaKind = getContextString(metadata.mediaKind);
	const transcriptSource = getContextString(metadata.transcriptSource);
	const mediaSpeakerCount = getContextNumber(metadata.mediaSpeakerCount);
	const mediaSegmentCount = getContextNumber(metadata.mediaSegmentCount);
	const mediaSegmentGroupSize = getContextNumber(
		metadata.mediaSegmentGroupSize
	);
	const mediaSegmentGroupIndex = getContextNumber(
		metadata.mediaSegmentGroupIndex
	);
	const mediaChannel = getContextString(metadata.mediaChannel);
	const mediaDurationLabel = formatMediaDurationLabel(
		metadata.mediaDurationMs
	);
	const mediaSegmentWindowDurationLabel = formatMediaDurationLabel(
		metadata.mediaSegmentGroupDurationMs
	);
	const mediaSegmentGapLabel = formatMediaDurationLabel(
		metadata.mediaSegmentGapFromPreviousMs
	);
	const spreadsheetHeaders = getSpreadsheetHeaders(metadata);
	const pdfTableHeaders = Array.isArray(metadata.pdfTableHeaders)
		? metadata.pdfTableHeaders
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const pdfTableColumnCount = getContextNumber(metadata.pdfTableColumnCount);
	const pdfTableBodyRowCount = getContextNumber(
		metadata.pdfTableBodyRowCount
	);
	const spreadsheetColumnRange = formatSpreadsheetColumnRange(
		getContextString(metadata.spreadsheetColumnStart),
		getContextString(metadata.spreadsheetColumnEnd)
	);
	const slideNotesText = getContextString(metadata.slideNotesText);
	const pdfTextMode = getContextString(metadata.pdfTextMode);
	const pdfEvidenceMode = getContextString(metadata.pdfEvidenceMode);
	const pdfEvidenceOrigin = getContextString(metadata.pdfEvidenceOrigin);
	const pdfEvidenceSupplement = getContextString(
		metadata.pdfEvidenceSupplement
	);
	const pdfTextKind = getContextString(metadata.pdfTextKind);
	const pdfSemanticRole = getContextString(metadata.pdfSemanticRole);
	const officeBlockKind = getContextString(metadata.officeBlockKind);
	const officeListContextText = getContextString(
		metadata.officeListContextText
	);
	const officeListGroupItemCount = getContextNumber(
		metadata.officeListGroupItemCount
	);
	const officeListLevelsLabel = formatOfficeListLevelsLabel(
		metadata.officeListLevels
	);
	const officeTableHeaders = Array.isArray(metadata.officeTableHeaders)
		? metadata.officeTableHeaders
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const officeTableColumnCount = getContextNumber(
		metadata.officeTableColumnCount
	);
	const officeTableBodyRowCount = getContextNumber(
		metadata.officeTableBodyRowCount
	);
	const officeTableBodyRowStart = getContextNumber(
		metadata.officeTableBodyRowStart
	);
	const officeTableBodyRowEnd = getContextNumber(
		metadata.officeTableBodyRowEnd
	);
	const officeTableContextText = getContextString(
		metadata.officeTableContextText
	);
	const officeTableFollowUpText = getContextString(
		metadata.officeTableFollowUpText
	);
	const ocrEngine = getContextString(metadata.ocrEngine);
	const extractorRegistryMatch = getContextString(
		metadata.extractorRegistryMatch
	);
	const chunkingProfile = getContextString(metadata.chunkingProfile);
	const archiveDepth = getContextNumber(metadata.archiveDepth);
	const archiveNestedDepth = getContextNumber(metadata.archiveNestedDepth);
	const archiveContainerPath = getContextString(
		metadata.archiveContainerPath
	);
	const archiveRootName = getContextString(metadata.archiveRootName);
	const sourceAwareChunkReason = formatSourceAwareChunkReason(
		metadata.sourceAwareChunkReason
	);
	const sourceAwareUnitScope = buildSourceAwareUnitScopeLabel(metadata);
	const spreadsheetTableLabel = formatSpreadsheetTableLabel(
		getContextNumber(metadata.spreadsheetTableIndex),
		getContextNumber(metadata.spreadsheetTableCount)
	);
	const ocrConfidence =
		getContextNumber(metadata.ocrRegionConfidence) ??
		getContextNumber(metadata.ocrConfidence);
	const ocrAverageConfidence =
		getContextNumber(metadata.ocrPageAverageConfidence) ??
		getContextNumber(metadata.ocrAverageConfidence);
	const ocrMinConfidence =
		getContextNumber(metadata.ocrPageMinConfidence) ??
		getContextNumber(metadata.ocrMinConfidence);
	const ocrMaxConfidence =
		getContextNumber(metadata.ocrPageMaxConfidence) ??
		getContextNumber(metadata.ocrMaxConfidence);
	const ocrRegionCount = getContextNumber(metadata.ocrRegionCount);
	const pdfTableBodyRowStart = getContextNumber(
		metadata.pdfTableBodyRowStart
	);
	const pdfTableBodyRowEnd = getContextNumber(metadata.pdfTableBodyRowEnd);

	const labels = [
		pdfTextMode ? `PDF ${pdfTextMode}` : '',
		pdfEvidenceMode ? `PDF evidence ${pdfEvidenceMode}` : '',
		pdfEvidenceOrigin ? `PDF origin ${pdfEvidenceOrigin}` : '',
		pdfEvidenceSupplement ? `PDF supplement ${pdfEvidenceSupplement}` : '',
		pdfSemanticRole === 'figure_caption' ? 'PDF figure caption' : '',
		pdfSemanticRole === 'figure_body' ? 'PDF figure body' : '',
		pdfSemanticRole === 'figure_caption'
			? ''
			: pdfSemanticRole === 'figure_body'
				? ''
				: pdfTextKind === 'table_like'
					? 'PDF table block'
					: pdfTextKind === 'paragraph'
						? 'PDF text block'
						: '',
		officeBlockKind ? `Office ${officeBlockKind}` : '',
		typeof officeListGroupItemCount === 'number'
			? `Office list ${officeListGroupItemCount} items`
			: '',
		officeListLevelsLabel ?? '',
		ocrEngine ? `OCR ${ocrEngine}` : '',
		extractorRegistryMatch ? `Extractor ${extractorRegistryMatch}` : '',
		chunkingProfile ? `Chunking ${chunkingProfile}` : '',
		sourceAwareChunkReason ?? '',
		sourceAwareUnitScope ?? '',
		typeof ocrConfidence === 'number'
			? `Confidence ${ocrConfidence.toFixed(2)}`
			: '',
		typeof ocrAverageConfidence === 'number' &&
		ocrAverageConfidence !== ocrConfidence
			? `Average ${ocrAverageConfidence.toFixed(2)}`
			: '',
		typeof ocrMinConfidence === 'number' &&
		typeof ocrMaxConfidence === 'number' &&
		ocrMinConfidence !== ocrMaxConfidence
			? `Range ${ocrMinConfidence.toFixed(2)}-${ocrMaxConfidence.toFixed(
					2
				)}`
			: '',
		typeof ocrRegionCount === 'number' ? `${ocrRegionCount} regions` : '',
		pdfTableHeaders.length > 0
			? `PDF table ${pdfTableHeaders.join(', ')}`
			: '',
		typeof pdfTableColumnCount === 'number'
			? `PDF table ${pdfTableColumnCount} cols`
			: '',
		typeof pdfTableBodyRowCount === 'number'
			? `PDF table ${pdfTableBodyRowCount} body rows`
			: '',
		typeof pdfTableBodyRowStart === 'number' &&
		typeof pdfTableBodyRowEnd === 'number'
			? pdfTableBodyRowStart === pdfTableBodyRowEnd
				? `PDF table row ${pdfTableBodyRowStart}`
				: `PDF table rows ${pdfTableBodyRowStart}-${pdfTableBodyRowEnd}`
			: '',
		officeListContextText
			? `Office list context ${officeListContextText}`
			: '',
		officeTableHeaders.length > 0
			? `Office table ${officeTableHeaders.join(', ')}`
			: '',
		typeof officeTableColumnCount === 'number'
			? `Office table ${officeTableColumnCount} cols`
			: '',
		typeof officeTableBodyRowCount === 'number'
			? `Office table ${officeTableBodyRowCount} body rows`
			: '',
		typeof officeTableBodyRowStart === 'number' &&
		typeof officeTableBodyRowEnd === 'number'
			? officeTableBodyRowStart === officeTableBodyRowEnd
				? `Office table row ${officeTableBodyRowStart}`
				: `Office table rows ${officeTableBodyRowStart}-${officeTableBodyRowEnd}`
			: '',
		officeTableContextText
			? `Office table context ${officeTableContextText}`
			: '',
		officeTableFollowUpText
			? `Office table follow-up ${officeTableFollowUpText}`
			: '',
		spreadsheetHeaders.length > 0
			? `Spreadsheet ${spreadsheetHeaders.join(', ')}`
			: '',
		spreadsheetColumnRange ? `Spreadsheet ${spreadsheetColumnRange}` : '',
		spreadsheetTableLabel ? `Spreadsheet ${spreadsheetTableLabel}` : '',
		mediaKind ? `Media ${mediaKind}` : '',
		mediaSegmentCount ? `${mediaSegmentCount} segments` : '',
		mediaSegmentGroupSize
			? `${mediaSegmentGroupSize} grouped segments`
			: '',
		mediaSegmentGroupIndex !== undefined
			? `Segment group ${mediaSegmentGroupIndex + 1}`
			: '',
		mediaChannel ? `Channel ${mediaChannel}` : '',
		mediaSpeakerCount ? `${mediaSpeakerCount} speakers` : '',
		mediaDurationLabel ? `Duration ${mediaDurationLabel}` : '',
		mediaSegmentWindowDurationLabel
			? `Segment window ${mediaSegmentWindowDurationLabel}`
			: '',
		mediaSegmentGapLabel
			? `Gap ${mediaSegmentGapLabel} from previous window`
			: '',
		transcriptSource ? `Transcript ${transcriptSource}` : '',
		threadTopic ? `Thread ${threadTopic}` : '',
		threadRootMessageId ? `Thread root ${threadRootMessageId}` : '',
		threadMessageCount ? `${threadMessageCount} thread messages` : '',
		replyDepth ? `Reply depth ${replyDepth}` : '',
		slideNotesText ? 'Speaker notes' : '',
		archiveDepth ? `Archive depth ${archiveDepth}` : '',
		archiveNestedDepth ? `Archive nested depth ${archiveNestedDepth}` : '',
		archiveContainerPath ? `Archive container ${archiveContainerPath}` : '',
		archiveRootName ? `Archive root ${archiveRootName}` : '',
		speaker ? `Speaker ${speaker}` : '',
		from ? `Sender ${from}` : '',
		sentAt ? `Sent ${sentAt}` : ''
	].filter((value) => value.length > 0);

	return labels.length > 0 ? labels.join(' · ') : undefined;
};

export const buildRAGSourceLabels = ({
	metadata,
	source,
	title
}: {
	metadata?: Record<string, unknown>;
	source?: string;
	title?: string;
}): RAGSourceLabels | undefined => {
	const contextLabel = buildContextLabel(metadata);
	const locatorLabel = buildLocatorLabel(metadata, source, title);
	const provenanceLabel = buildProvenanceLabel(metadata);

	if (!contextLabel && !locatorLabel && !provenanceLabel) {
		return undefined;
	}

	return {
		contextLabel,
		locatorLabel,
		provenanceLabel
	};
};

export const buildRAGChunkStructure = (
	metadata?: Record<string, unknown>
): RAGChunkStructure | undefined => {
	if (!metadata) {
		return undefined;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: undefined;
	const sectionKind =
		metadata.sectionKind === 'markdown_heading' ||
		metadata.sectionKind === 'html_heading' ||
		metadata.sectionKind === 'office_heading' ||
		metadata.sectionKind === 'office_block' ||
		metadata.sectionKind === 'pdf_block' ||
		metadata.sectionKind === 'spreadsheet_rows' ||
		metadata.sectionKind === 'presentation_slide'
			? metadata.sectionKind
			: undefined;
	const section: NonNullable<RAGChunkStructure['section']> = {
		depth: getContextNumber(metadata.sectionDepth),
		kind: sectionKind,
		path: sectionPath && sectionPath.length > 0 ? sectionPath : undefined,
		title: getContextString(metadata.sectionTitle)
	};
	const sequence: NonNullable<RAGChunkStructure['sequence']> = {
		nextChunkId: getContextString(metadata.nextChunkId),
		previousChunkId: getContextString(metadata.previousChunkId),
		sectionChunkCount: getContextNumber(metadata.sectionChunkCount),
		sectionChunkId: getContextString(metadata.sectionChunkId),
		sectionChunkIndex: getContextNumber(metadata.sectionChunkIndex)
	};

	if (
		!section.title &&
		(!section.path || section.path.length === 0) &&
		typeof section.depth !== 'number' &&
		!section.kind &&
		!sequence.nextChunkId &&
		!sequence.previousChunkId &&
		typeof sequence.sectionChunkCount !== 'number' &&
		!sequence.sectionChunkId &&
		typeof sequence.sectionChunkIndex !== 'number'
	) {
		return undefined;
	}

	return {
		section:
			section.title ||
			(section.path && section.path.length > 0) ||
			typeof section.depth === 'number' ||
			section.kind
				? section
				: undefined,
		sequence:
			sequence.nextChunkId ||
			sequence.previousChunkId ||
			typeof sequence.sectionChunkCount === 'number' ||
			sequence.sectionChunkId ||
			typeof sequence.sectionChunkIndex === 'number'
				? sequence
				: undefined
	};
};

const buildExcerpt = (text: string, maxLength = 160) => {
	const normalized = text.replaceAll(/\s+/g, ' ').trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

type ExcerptChunkInput = Pick<
	RAGSource,
	'chunkId' | 'metadata' | 'structure' | 'text'
>;

export const buildRAGChunkExcerpts = (
	chunks: ExcerptChunkInput[],
	activeChunkId?: string
): RAGChunkExcerpts | undefined => {
	if (chunks.length === 0) {
		return undefined;
	}

	const graph = buildRAGChunkGraph(
		chunks.map((chunk) => ({
			chunkId: chunk.chunkId,
			metadata: chunk.metadata,
			structure: chunk.structure
		}))
	);
	const navigation = buildRAGChunkGraphNavigation(graph, activeChunkId);
	const activeChunk =
		chunks.find((chunk) => chunk.chunkId === navigation.activeChunkId) ??
		chunks[0];
	if (!activeChunk) {
		return undefined;
	}

	const chunkMap = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
	const orderedSectionIds =
		navigation.sectionNodes.length > 0
			? navigation.sectionNodes.map((node) => node.chunkId)
			: [activeChunk.chunkId];
	const orderedWindowIds =
		navigation.sectionNodes.length > 0
			? (() => {
					const activeIndex = navigation.sectionNodes.findIndex(
						(node) => node.chunkId === activeChunk.chunkId
					);
					const startIndex = Math.max(0, activeIndex - 2);
					const endIndex = Math.min(
						navigation.sectionNodes.length,
						activeIndex + 3
					);
					return navigation.sectionNodes
						.slice(startIndex, endIndex)
						.map((node) => node.chunkId);
				})()
			: [
					navigation.previousNode?.chunkId,
					activeChunk.chunkId,
					navigation.nextNode?.chunkId
				].filter(
					(chunkId, index, ids): chunkId is string =>
						Boolean(chunkId) && ids.indexOf(chunkId) === index
				);

	const collectText = (chunkIds: string[]) =>
		chunkIds
			.map((chunkId) => chunkMap.get(chunkId)?.text)
			.filter((text): text is string => typeof text === 'string')
			.join('\n\n');

	return {
		chunkExcerpt: buildExcerpt(activeChunk.text, 160),
		sectionExcerpt: buildExcerpt(collectText(orderedSectionIds), 320),
		windowExcerpt: buildExcerpt(collectText(orderedWindowIds), 240)
	};
};

export const buildRAGPreferredExcerpt = (
	excerpts?: RAGChunkExcerpts,
	structure?: RAGChunkStructure
) => {
	const selection = buildRAGExcerptSelection(excerpts, structure);
	return selection.excerpt;
};

export const buildRAGExcerptSelection = (
	excerpts?: RAGChunkExcerpts,
	structure?: RAGChunkStructure
): RAGExcerptSelection & { excerpt: string } => {
	if (!excerpts) {
		return {
			excerpt: '',
			mode: 'chunk',
			reason: 'single_chunk'
		};
	}

	const chunkLength = excerpts.chunkExcerpt.trim().length;
	const sectionChunkCount = structure?.sequence?.sectionChunkCount ?? 1;
	if (sectionChunkCount > 1 && chunkLength > 0 && chunkLength < 72) {
		if (
			sectionChunkCount <= 3 &&
			excerpts.sectionExcerpt.trim().length > 0
		) {
			return {
				excerpt: excerpts.sectionExcerpt,
				mode: 'section',
				reason: 'section_small_enough'
			};
		}
		if (excerpts.windowExcerpt.trim().length > 0) {
			return {
				excerpt: excerpts.windowExcerpt,
				mode: 'window',
				reason: 'section_too_large_use_window'
			};
		}

		return {
			excerpt: excerpts.chunkExcerpt,
			mode: 'chunk',
			reason: 'chunk_too_narrow'
		};
	}

	return {
		excerpt: excerpts.chunkExcerpt,
		mode: 'chunk',
		reason: sectionChunkCount > 1 ? 'chunk_too_narrow' : 'single_chunk'
	};
};

export const buildRAGExcerptModeCounts = (
	selections: Array<RAGExcerptSelection | undefined>
): RAGExcerptModeCounts =>
	selections.reduce<RAGExcerptModeCounts>(
		(counts, selection) => {
			if (selection) {
				counts[selection.mode] += 1;
			}
			return counts;
		},
		{ chunk: 0, section: 0, window: 0 }
	);

type GraphChunkInput = Pick<
	RAGSource,
	'chunkId' | 'metadata' | 'source' | 'title' | 'labels' | 'structure'
> &
	Partial<Pick<RAGSource, 'score'>>;

export const buildRAGChunkGraph = (
	chunks: GraphChunkInput[]
): RAGChunkGraph => {
	const nodes: RAGChunkGraphNode[] = [];
	const edges: RAGChunkGraphEdge[] = [];
	const edgeKeys = new Set<string>();
	const sections = new Map<string, RAGChunkGraphSectionGroup>();

	for (const chunk of chunks) {
		const labels =
			chunk.labels ??
			buildRAGSourceLabels({
				metadata: chunk.metadata,
				source: chunk.source,
				title: chunk.title
			});
		const structure =
			chunk.structure ?? buildRAGChunkStructure(chunk.metadata);

		nodes.push({
			chunkId: chunk.chunkId,
			contextLabel: labels?.contextLabel,
			label: chunk.source ?? chunk.title ?? chunk.chunkId,
			locatorLabel: labels?.locatorLabel,
			provenanceLabel: labels?.provenanceLabel,
			score: chunk.score,
			source: chunk.source,
			structure,
			title: chunk.title
		});

		const previousChunkId = structure?.sequence?.previousChunkId;
		if (previousChunkId) {
			const key = `previous:${previousChunkId}:${chunk.chunkId}`;
			if (!edgeKeys.has(key)) {
				edgeKeys.add(key);
				edges.push({
					fromChunkId: previousChunkId,
					relation: 'previous',
					toChunkId: chunk.chunkId
				});
			}
		}

		const nextChunkId = structure?.sequence?.nextChunkId;
		if (nextChunkId) {
			const key = `next:${chunk.chunkId}:${nextChunkId}`;
			if (!edgeKeys.has(key)) {
				edgeKeys.add(key);
				edges.push({
					fromChunkId: chunk.chunkId,
					relation: 'next',
					toChunkId: nextChunkId
				});
			}
		}

		const sectionId = structure?.sequence?.sectionChunkId;
		if (sectionId) {
			const existing = sections.get(sectionId);
			if (!existing) {
				sections.set(sectionId, {
					childSectionIds: [],
					chunkCount: structure.sequence?.sectionChunkCount ?? 1,
					chunkIds: [chunk.chunkId],
					depth: structure.section?.depth,
					id: sectionId,
					kind: structure.section?.kind,
					leadChunkId: chunk.chunkId,
					path: structure.section?.path,
					title: structure.section?.title
				});
				continue;
			}

			if (!existing.chunkIds.includes(chunk.chunkId)) {
				existing.chunkIds.push(chunk.chunkId);
			}
			existing.chunkCount = Math.max(
				existing.chunkCount,
				structure.sequence?.sectionChunkCount ?? existing.chunkCount
			);
		}
	}

	for (const section of sections.values()) {
		section.chunkIds.sort((left, right) => {
			const leftNode = nodes.find((node) => node.chunkId === left);
			const rightNode = nodes.find((node) => node.chunkId === right);
			const leftIndex =
				leftNode?.structure?.sequence?.sectionChunkIndex ??
				Number.MAX_SAFE_INTEGER;
			const rightIndex =
				rightNode?.structure?.sequence?.sectionChunkIndex ??
				Number.MAX_SAFE_INTEGER;
			if (leftIndex !== rightIndex) {
				return leftIndex - rightIndex;
			}

			return left.localeCompare(right);
		});
		section.leadChunkId = section.chunkIds[0];
	}

	const sectionPathIndex = new Map<string, RAGChunkGraphSectionGroup>();
	for (const section of sections.values()) {
		const path =
			section.path && section.path.length > 0
				? section.path
				: section.title
					? [section.title]
					: undefined;
		if (path && path.length > 0) {
			sectionPathIndex.set(path.join('\u0000'), section);
		}
	}

	for (const section of sections.values()) {
		const path =
			section.path && section.path.length > 0
				? section.path
				: section.title
					? [section.title]
					: undefined;
		if (!path || path.length < 2) {
			continue;
		}

		const parent = sectionPathIndex.get(path.slice(0, -1).join('\u0000'));
		if (!parent || parent.id === section.id) {
			continue;
		}

		section.parentSectionId = parent.id;
		if (!parent.childSectionIds.includes(section.id)) {
			parent.childSectionIds.push(section.id);
		}

		if (parent.leadChunkId && section.leadChunkId) {
			const parentKey = `section_parent:${section.leadChunkId}:${parent.leadChunkId}`;
			if (!edgeKeys.has(parentKey)) {
				edgeKeys.add(parentKey);
				edges.push({
					fromChunkId: section.leadChunkId,
					relation: 'section_parent',
					toChunkId: parent.leadChunkId
				});
			}

			const childKey = `section_child:${parent.leadChunkId}:${section.leadChunkId}`;
			if (!edgeKeys.has(childKey)) {
				edgeKeys.add(childKey);
				edges.push({
					fromChunkId: parent.leadChunkId,
					relation: 'section_child',
					toChunkId: section.leadChunkId
				});
			}
		}
	}

	nodes.sort((left, right) => {
		const leftSection =
			left.structure?.sequence?.sectionChunkIndex ??
			Number.MAX_SAFE_INTEGER;
		const rightSection =
			right.structure?.sequence?.sectionChunkIndex ??
			Number.MAX_SAFE_INTEGER;
		if (leftSection !== rightSection) {
			return leftSection - rightSection;
		}

		const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
		const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
		if (leftScore !== rightScore) {
			return rightScore - leftScore;
		}

		return left.label.localeCompare(right.label);
	});

	return {
		edges,
		nodes,
		sections: [...sections.values()].sort((left, right) =>
			(left.title ?? left.id).localeCompare(right.title ?? right.id)
		)
	};
};

export const buildRAGChunkPreviewGraph = (
	preview: Pick<RAGDocumentChunkPreview, 'chunks' | 'document'>
): RAGChunkGraph =>
	buildRAGChunkGraph(
		preview.chunks.map((chunk) => ({
			chunkId: chunk.chunkId,
			labels: chunk.labels,
			metadata: chunk.metadata,
			source: chunk.source ?? preview.document.source,
			structure: chunk.structure,
			title: chunk.title ?? preview.document.title
		}))
	);

export const buildRAGChunkPreviewNavigation = (
	preview: Pick<RAGDocumentChunkPreview, 'chunks' | 'document'>,
	activeChunkId?: string
): RAGChunkGraphNavigation =>
	buildRAGChunkGraphNavigation(
		buildRAGChunkPreviewGraph(preview),
		activeChunkId
	);

export const buildRAGChunkGraphNavigation = (
	graph: RAGChunkGraph,
	activeChunkId?: string
): RAGChunkGraphNavigation => {
	if (graph.nodes.length === 0) {
		return {
			activeChunkId,
			childSections: [],
			siblingSections: [],
			sectionNodes: []
		};
	}

	const activeNode =
		(activeChunkId
			? graph.nodes.find((node) => node.chunkId === activeChunkId)
			: undefined) ?? graph.nodes[0];
	const resolvedActiveChunkId = activeNode?.chunkId;
	const previousNode = activeNode?.structure?.sequence?.previousChunkId
		? graph.nodes.find(
				(node) =>
					node.chunkId ===
					activeNode.structure?.sequence?.previousChunkId
			)
		: undefined;
	const nextNode = activeNode?.structure?.sequence?.nextChunkId
		? graph.nodes.find(
				(node) =>
					node.chunkId === activeNode.structure?.sequence?.nextChunkId
			)
		: undefined;
	const section = activeNode?.structure?.sequence?.sectionChunkId
		? graph.sections.find(
				(entry) =>
					entry.id === activeNode.structure?.sequence?.sectionChunkId
			)
		: undefined;
	const parentSection = section?.parentSectionId
		? graph.sections.find((entry) => entry.id === section.parentSectionId)
		: undefined;
	const childSections = section
		? section.childSectionIds
				.map((sectionId) =>
					graph.sections.find((entry) => entry.id === sectionId)
				)
				.filter((entry): entry is RAGChunkGraphSectionGroup =>
					Boolean(entry)
				)
		: [];
	const siblingSections = section?.parentSectionId
		? graph.sections.filter(
				(entry) =>
					entry.parentSectionId === section.parentSectionId &&
					entry.id !== section.id
			)
		: [];
	const sectionNodes = section
		? section.chunkIds
				.map((chunkId) =>
					graph.nodes.find((node) => node.chunkId === chunkId)
				)
				.filter((node): node is RAGChunkGraphNode => Boolean(node))
		: activeNode
			? [activeNode]
			: [];

	return {
		activeChunkId: resolvedActiveChunkId,
		activeNode,
		childSections,
		nextNode,
		parentSection,
		previousNode,
		section,
		siblingSections,
		sectionNodes
	};
};
export const buildRAGRetrievedState = (messages: AIMessage[]) => {
	const message = getLatestRetrievedMessage(messages);

	if (!message) {
		return null;
	}

	const sources = message.sources ?? [];
	const citations = buildRAGCitations(sources);
	const sectionDiagnostics = buildRAGSectionRetrievalDiagnostics(
		sources,
		isRAGRetrievalTrace(message.retrievalTrace)
			? message.retrievalTrace
			: undefined
	);
	const sourceSummaries = buildRAGSourceSummaries(sources);
	const groundedAnswer = buildRAGGroundedAnswer(message.content, sources);

	return {
		citationReferenceMap: buildRAGCitationReferenceMap(citations),
		citations,
		conversationId: message.conversationId,
		excerptModeCounts: buildRAGExcerptModeCounts([
			...citations.map((citation) => citation.excerptSelection),
			...sourceSummaries.map((summary) => summary.excerptSelection)
		]),
		groundedAnswer,
		messageId: message.id,
		retrievalDurationMs: message.retrievalDurationMs,
		retrievalStartedAt: message.retrievalStartedAt,
		retrievedAt: message.retrievedAt,
		trace: isRAGRetrievalTrace(message.retrievalTrace)
			? message.retrievalTrace
			: undefined,
		sectionDiagnostics,
		sourceGroups: buildRAGSourceGroups(sources),
		sourceSummaries,
		sources
	};
};
export const buildRAGSourceSummaries = (sources: RAGSource[]) => {
	const sourceGroups = buildRAGSourceGroups(sources);
	const citations = buildRAGCitations(sources);
	const citationReferenceMap = buildRAGCitationReferenceMap(citations);

	return sourceGroups.map<RAGSourceSummary>((group) => {
		const groupCitations = citations.filter((citation) =>
			group.chunks.some((chunk) => chunk.chunkId === citation.chunkId)
		);
		const leadChunk = getPreferredSourceLeadChunk(group.chunks);
		const excerpts = leadChunk
			? buildRAGChunkExcerpts(group.chunks, leadChunk.chunkId)
			: undefined;
		const structure =
			leadChunk?.structure ?? buildRAGChunkStructure(leadChunk?.metadata);
		const excerptSelection = buildRAGExcerptSelection(excerpts, structure);

		return {
			bestScore: group.bestScore,
			citationNumbers: groupCitations.map(
				(citation) => citationReferenceMap[citation.chunkId] ?? 0
			),
			citations: groupCitations,
			chunkIds: group.chunks.map((chunk) => chunk.chunkId),
			contextLabel:
				leadChunk?.labels?.contextLabel ??
				buildContextLabel(leadChunk?.metadata),
			count: group.count,
			excerpt:
				excerptSelection.excerpt || buildExcerpt(leadChunk?.text ?? ''),
			excerpts,
			excerptSelection,
			key: group.key,
			label: group.label,
			locatorLabel:
				leadChunk?.labels?.locatorLabel ??
				buildLocatorLabel(
					leadChunk?.metadata,
					leadChunk?.source,
					leadChunk?.title
				),
			provenanceLabel:
				leadChunk?.labels?.provenanceLabel ??
				buildProvenanceLabel(leadChunk?.metadata),
			structure,
			source: group.source,
			title: group.title
		};
	});
};

const getSectionPathFromSource = (source: RAGSource) => {
	const path =
		source.structure?.section?.path ??
		(Array.isArray(source.metadata?.sectionPath)
			? source.metadata.sectionPath
					.map((value) => getContextString(value))
					.filter(
						(value): value is string => typeof value === 'string'
					)
			: []);

	return path.length > 0 ? path : undefined;
};

const isBlockAwareContextLabel = (value?: string) =>
	typeof value === 'string' &&
	(value.startsWith('PDF ') ||
		value.startsWith('Office ') ||
		value.startsWith('Slide '));

const getStructuredSectionScoreWeight = (
	metadata?: Record<string, unknown>
) => {
	if (!metadata) {
		return 1;
	}

	const pdfTextKind = getContextString(metadata.pdfTextKind);
	const officeBlockKind = getContextString(metadata.officeBlockKind);
	const sectionKind = getContextString(metadata.sectionKind);
	const slideTitle = getContextString(metadata.slideTitle);
	const slideNotesText = getContextString(metadata.slideNotesText);

	if (pdfTextKind === 'table_like') {
		return 1.28;
	}
	if (officeBlockKind === 'table' || officeBlockKind === 'list') {
		return 1.24;
	}
	if (
		sectionKind === 'pdf_block' ||
		sectionKind === 'office_block' ||
		officeBlockKind === 'paragraph' ||
		pdfTextKind === 'paragraph'
	) {
		return 1.12;
	}
	if (sectionKind === 'presentation_slide' && slideNotesText) {
		return 1.2;
	}
	if (sectionKind === 'presentation_slide' && slideTitle) {
		return 1.14;
	}

	return 1;
};

const getStructuredSourceLeadScore = (source: RAGSource) =>
	source.score * getStructuredSectionScoreWeight(source.metadata);

const getPDFLeadEvidencePreference = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return 0;
	}

	const pdfEvidenceMode = getContextString(metadata.pdfEvidenceMode);
	const pdfEvidenceOrigin = getContextString(metadata.pdfEvidenceOrigin);
	const pdfEvidenceSupplement = getContextString(
		metadata.pdfEvidenceSupplement
	);

	if (
		pdfEvidenceMode === 'hybrid' &&
		pdfEvidenceOrigin === 'native' &&
		pdfEvidenceSupplement === 'ocr'
	) {
		return 3;
	}
	if (pdfEvidenceMode === 'native' && pdfEvidenceOrigin === 'native') {
		return 2;
	}
	if (pdfEvidenceMode === 'ocr' && pdfEvidenceOrigin === 'ocr') {
		return 1;
	}

	return 0;
};

const getPDFLeadScope = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const pageNumber =
		getContextNumber(metadata.pageNumber) ??
		getContextNumber(metadata.page) ??
		(typeof metadata.pageIndex === 'number'
			? metadata.pageIndex + 1
			: undefined);
	const sectionTitle = getContextString(metadata.sectionTitle);
	const sourceNativeKind = getContextString(metadata.sourceNativeKind);

	if (typeof pageNumber !== 'number' && !sectionTitle && !sourceNativeKind) {
		return undefined;
	}

	return {
		pageNumber,
		sectionTitle,
		sourceNativeKind
	};
};

type OfficeLeadScope = {
	blockKind: 'list' | 'paragraph' | 'table';
	familyPath: string[];
	hasContext: boolean;
	ordinalPath: number[];
	pathDepth: number;
	sectionFamilyKey: string;
	sectionOrdinal: number;
	sectionTitle: string;
};

type GenericStructuredLeadScope = {
	familyPath: string[];
	kind: 'presentation_slide' | 'spreadsheet_rows';
	ordinalPath: number[];
	pathDepth: number;
	sectionFamilyKey: string;
	sectionOrdinal: number;
};

const getOfficeLeadScope = (
	metadata?: Record<string, unknown>
): OfficeLeadScope | undefined => {
	if (!metadata) {
		return undefined;
	}

	const officeBlockKindValue = getContextString(metadata.officeBlockKind);
	const officeBlockKind =
		officeBlockKindValue === 'table' ||
		officeBlockKindValue === 'list' ||
		officeBlockKindValue === 'paragraph'
			? officeBlockKindValue
			: undefined;
	if (
		officeBlockKind !== 'table' &&
		officeBlockKind !== 'list' &&
		officeBlockKind !== 'paragraph'
	) {
		return undefined;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const sectionTitle =
		getContextString(metadata.sectionTitle) ?? sectionPath.at(-1);
	const officeContextText =
		officeBlockKind === 'table'
			? getContextString(metadata.officeTableContextText)
			: officeBlockKind === 'list'
				? getContextString(metadata.officeListContextText)
				: undefined;

	if (!sectionTitle) {
		return undefined;
	}

	return {
		blockKind: officeBlockKind,
		familyPath: (() => {
			const explicitGenericFamilyPath = Array.isArray(
				metadata.sectionFamilyPath
			)
				? metadata.sectionFamilyPath
						.map((value) => getContextString(value))
						.filter(
							(value): value is string =>
								typeof value === 'string'
						)
				: [];
			const explicitGenericOrdinalPath = Array.isArray(
				metadata.sectionOrdinalPath
			)
				? metadata.sectionOrdinalPath
						.map((value) => getContextNumber(value))
						.filter(
							(value): value is number =>
								typeof value === 'number'
						)
				: [];
			if (
				explicitGenericFamilyPath.length > 0 &&
				explicitGenericFamilyPath.length ===
					explicitGenericOrdinalPath.length
			) {
				return explicitGenericFamilyPath;
			}

			const explicitOfficeFamilyPath = Array.isArray(
				metadata.officeFamilyPath
			)
				? metadata.officeFamilyPath
						.map((value) => getContextString(value))
						.filter(
							(value): value is string =>
								typeof value === 'string'
						)
				: [];
			return explicitOfficeFamilyPath.length > 0
				? explicitOfficeFamilyPath
				: sectionPath.map((value) =>
						value.replace(/\s+\((\d+)\)$/, '').trim()
					);
		})(),
		pathDepth: sectionPath.length,
		ordinalPath: (() => {
			const explicitGenericFamilyPath = Array.isArray(
				metadata.sectionFamilyPath
			)
				? metadata.sectionFamilyPath
						.map((value) => getContextString(value))
						.filter(
							(value): value is string =>
								typeof value === 'string'
						)
				: [];
			const explicitGenericOrdinalPath = Array.isArray(
				metadata.sectionOrdinalPath
			)
				? metadata.sectionOrdinalPath
						.map((value) => getContextNumber(value))
						.filter(
							(value): value is number =>
								typeof value === 'number'
						)
				: [];
			if (
				explicitGenericFamilyPath.length > 0 &&
				explicitGenericFamilyPath.length ===
					explicitGenericOrdinalPath.length
			) {
				return explicitGenericOrdinalPath;
			}

			const explicitOfficeOrdinalPath = Array.isArray(
				metadata.officeOrdinalPath
			)
				? metadata.officeOrdinalPath
						.map((value) =>
							typeof value === 'number' && Number.isFinite(value)
								? value
								: undefined
						)
						.filter(
							(value): value is number =>
								typeof value === 'number'
						)
				: [];
			return explicitOfficeOrdinalPath.length > 0
				? explicitOfficeOrdinalPath
				: sectionPath.map((value) => {
						const match = value.match(/\((\d+)\)$/);
						return match ? Number.parseInt(match[1] ?? '1', 10) : 1;
					});
		})(),
		sectionFamilyKey:
			getContextString(metadata.sectionSiblingFamilyKey) ??
			getContextString(metadata.officeSiblingFamilyKey) ??
			sectionPath
				.at(-1)
				?.replace(/\s+\((\d+)\)$/, '')
				.trim() ??
			sectionTitle,
		sectionOrdinal:
			getContextNumber(metadata.sectionSiblingOrdinal) ??
			getContextNumber(metadata.officeSiblingOrdinal) ??
			(() => {
				const match = sectionTitle.match(/\((\d+)\)$/);
				return match ? Number.parseInt(match[1] ?? '1', 10) : 1;
			})(),
		sectionTitle,
		hasContext: typeof officeContextText === 'string'
	};
};

const areOfficeLeadScopesComparable = (
	left:
		| {
				blockKind: 'list' | 'paragraph' | 'table';
				familyPath: string[];
				hasContext: boolean;
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				sectionTitle: string;
		  }
		| undefined,
	right:
		| {
				blockKind: 'list' | 'paragraph' | 'table';
				familyPath: string[];
				hasContext: boolean;
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				sectionTitle: string;
		  }
		| undefined
) => {
	if (!left || !right) {
		return false;
	}
	if (
		left.blockKind !== right.blockKind ||
		left.sectionFamilyKey !== right.sectionFamilyKey ||
		left.sectionOrdinal !== right.sectionOrdinal
	) {
		return false;
	}
	const leftAncestorFamilyPath = left.familyPath.slice(0, -1);
	const rightAncestorFamilyPath = right.familyPath.slice(0, -1);
	const leftAncestorOrdinalPath = left.ordinalPath.slice(0, -1);
	const rightAncestorOrdinalPath = right.ordinalPath.slice(0, -1);
	const sharedDepth = Math.min(
		leftAncestorFamilyPath.length,
		rightAncestorFamilyPath.length
	);
	for (let index = 0; index < sharedDepth; index += 1) {
		if (
			leftAncestorFamilyPath[index] !== rightAncestorFamilyPath[index] ||
			leftAncestorOrdinalPath[index] !== rightAncestorOrdinalPath[index]
		) {
			return false;
		}
	}
	return true;
};

const getGenericStructuredLeadScope = (
	metadata?: Record<string, unknown>
): GenericStructuredLeadScope | undefined => {
	if (!metadata || metadata.officeBlockKind || metadata.pageNumber) {
		return undefined;
	}

	const kind =
		metadata.sectionKind === 'spreadsheet_rows' ||
		metadata.sectionKind === 'presentation_slide'
			? metadata.sectionKind
			: undefined;
	if (!kind) {
		return undefined;
	}

	const explicitFamilyPath = Array.isArray(metadata.sectionFamilyPath)
		? metadata.sectionFamilyPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const explicitOrdinalPath = Array.isArray(metadata.sectionOrdinalPath)
		? metadata.sectionOrdinalPath
				.map((value) => getContextNumber(value))
				.filter((value): value is number => typeof value === 'number')
		: [];
	let familyPath =
		explicitFamilyPath.length > 0 &&
		explicitFamilyPath.length === explicitOrdinalPath.length
			? explicitFamilyPath
			: [];
	let ordinalPath =
		explicitFamilyPath.length > 0 &&
		explicitFamilyPath.length === explicitOrdinalPath.length
			? explicitOrdinalPath
			: [];

	if (familyPath.length === 0) {
		if (kind === 'spreadsheet_rows') {
			const sheetName = getContextString(metadata.sheetName) ?? 'Sheet';
			const tableIndex =
				getContextNumber(metadata.spreadsheetTableIndex) ?? 1;
			familyPath = [sheetName, 'Spreadsheet Table'];
			ordinalPath = [1, tableIndex];
		} else {
			const slideFamily =
				getContextString(metadata.slideTitle) ?? 'Slide';
			const slideOrdinal =
				getContextNumber(metadata.slideNumber) ??
				(typeof metadata.slideIndex === 'number'
					? metadata.slideIndex + 1
					: 1);
			familyPath = [slideFamily];
			ordinalPath = [slideOrdinal];
		}
	}

	const sectionFamilyKey =
		getContextString(metadata.sectionSiblingFamilyKey) ?? familyPath.at(-1);
	const sectionOrdinal =
		getContextNumber(metadata.sectionSiblingOrdinal) ?? ordinalPath.at(-1);
	if (!sectionFamilyKey || typeof sectionOrdinal !== 'number') {
		return undefined;
	}

	return {
		familyPath,
		kind,
		ordinalPath,
		pathDepth: familyPath.length,
		sectionFamilyKey,
		sectionOrdinal
	};
};

const areGenericStructuredLeadScopesComparable = (
	left: GenericStructuredLeadScope | undefined,
	right: GenericStructuredLeadScope | undefined
) => {
	if (!left || !right) {
		return false;
	}
	if (
		left.kind !== right.kind ||
		left.sectionFamilyKey !== right.sectionFamilyKey ||
		left.sectionOrdinal !== right.sectionOrdinal
	) {
		return false;
	}
	const leftAncestorFamilyPath = left.familyPath.slice(0, -1);
	const rightAncestorFamilyPath = right.familyPath.slice(0, -1);
	const leftAncestorOrdinalPath = left.ordinalPath.slice(0, -1);
	const rightAncestorOrdinalPath = right.ordinalPath.slice(0, -1);
	const sharedDepth = Math.min(
		leftAncestorFamilyPath.length,
		rightAncestorFamilyPath.length
	);
	for (let index = 0; index < sharedDepth; index += 1) {
		if (
			leftAncestorFamilyPath[index] !== rightAncestorFamilyPath[index] ||
			leftAncestorOrdinalPath[index] !== rightAncestorOrdinalPath[index]
		) {
			return false;
		}
	}
	return true;
};

const getOfficeLeadEvidencePreference = (
	metadata?: Record<string, unknown>
) => {
	const scope = getOfficeLeadScope(metadata);
	if (!scope) {
		return 0;
	}

	return (
		scope.pathDepth * 10 +
		(scope.hasContext ? 1 : 0) +
		(scope.blockKind === 'list' &&
		typeof metadata?.officeListGroupItemCount === 'number' &&
		metadata.officeListGroupItemCount > 1
			? 1
			: 0)
	);
};

const getGenericStructuredLeadPreference = (
	metadata?: Record<string, unknown>
) => {
	const scope = getGenericStructuredLeadScope(metadata);
	if (!scope) {
		return 0;
	}

	return (
		scope.pathDepth * 10 +
		(scope.kind === 'spreadsheet_rows' &&
		typeof metadata?.spreadsheetTableIndex === 'number'
			? 2
			: 0) +
		(Array.isArray(metadata?.spreadsheetHeaders) &&
		metadata.spreadsheetHeaders.length > 0
			? 1
			: 0) +
		(typeof metadata?.slideNotesText === 'string' &&
		metadata.slideNotesText.trim().length > 0
			? 1
			: 0)
	);
};

const getPreferredSourceLeadChunk = (chunks: RAGSource[]) =>
	chunks.slice().sort((left, right) => {
		const leftOfficeScope = getOfficeLeadScope(left.metadata);
		const rightOfficeScope = getOfficeLeadScope(right.metadata);
		if (
			left.source === right.source &&
			areOfficeLeadScopesComparable(leftOfficeScope, rightOfficeScope)
		) {
			const leftOfficePreference = getOfficeLeadEvidencePreference(
				left.metadata
			);
			const rightOfficePreference = getOfficeLeadEvidencePreference(
				right.metadata
			);
			if (rightOfficePreference !== leftOfficePreference) {
				return rightOfficePreference - leftOfficePreference;
			}
		}
		const leftGenericScope = getGenericStructuredLeadScope(left.metadata);
		const rightGenericScope = getGenericStructuredLeadScope(right.metadata);
		if (
			left.source === right.source &&
			areGenericStructuredLeadScopesComparable(
				leftGenericScope,
				rightGenericScope
			)
		) {
			const leftGenericPreference = getGenericStructuredLeadPreference(
				left.metadata
			);
			const rightGenericPreference = getGenericStructuredLeadPreference(
				right.metadata
			);
			if (rightGenericPreference !== leftGenericPreference) {
				return rightGenericPreference - leftGenericPreference;
			}
		}
		const leftWeightedScore = getStructuredSourceLeadScore(left);
		const rightWeightedScore = getStructuredSourceLeadScore(right);
		if (rightWeightedScore !== leftWeightedScore) {
			return rightWeightedScore - leftWeightedScore;
		}
		const leftScope = getPDFLeadScope(left.metadata);
		const rightScope = getPDFLeadScope(right.metadata);
		if (
			left.source === right.source &&
			leftScope &&
			rightScope &&
			((leftScope.sectionTitle &&
				rightScope.sectionTitle &&
				leftScope.sectionTitle === rightScope.sectionTitle) ||
				(typeof leftScope.pageNumber === 'number' &&
					typeof rightScope.pageNumber === 'number' &&
					leftScope.pageNumber === rightScope.pageNumber))
		) {
			const leftEvidencePreference = getPDFLeadEvidencePreference(
				left.metadata
			);
			const rightEvidencePreference = getPDFLeadEvidencePreference(
				right.metadata
			);
			if (rightEvidencePreference !== leftEvidencePreference) {
				return rightEvidencePreference - leftEvidencePreference;
			}
		}
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.chunkId.localeCompare(right.chunkId);
	})[0];

export const buildRAGSectionRetrievalDiagnostics = (
	sources: RAGSource[],
	trace?: RAGRetrievalTrace
): RAGSectionRetrievalDiagnostic[] => {
	const totalScore = sources.reduce(
		(sum, source) =>
			sum +
			source.score * getStructuredSectionScoreWeight(source.metadata),
		0
	);
	if (sources.length === 0 || totalScore <= 0) {
		return [];
	}

	const sections = new Map<
		string,
		{
			key: string;
			label: string;
			path?: string[];
			parentLabel?: string;
			count: number;
			bestScore: number;
			totalScore: number;
			topChunkId?: string;
			topSource?: string;
			vectorHits: number;
			lexicalHits: number;
			hybridHits: number;
			primaryHits: number;
			transformedHits: number;
			variantHits: number;
			sourceSet: Set<string>;
		}
	>();

	for (const source of sources) {
		const structuredScore =
			source.score * getStructuredSectionScoreWeight(source.metadata);
		const path = getSectionPathFromSource(source);
		if (!path) {
			continue;
		}

		const key = path.join(' > ');
		const label = path.at(-1) ?? key;
		const parentLabel =
			path.length > 1 ? path.slice(0, -1).join(' > ') : undefined;
		const existing = sections.get(key);
		const channels = Array.isArray(source.metadata?.retrievalChannels)
			? source.metadata.retrievalChannels.filter(
					(value): value is 'vector' | 'lexical' =>
						value === 'vector' || value === 'lexical'
				)
			: [];
		const isHybrid =
			channels.includes('vector') && channels.includes('lexical');
		const vectorHits = channels.includes('vector') ? 1 : 0;
		const lexicalHits = channels.includes('lexical') ? 1 : 0;
		const hybridHits = isHybrid ? 1 : 0;
		const queryOrigins = Array.isArray(
			source.metadata?.retrievalQueryOrigins
		)
			? source.metadata.retrievalQueryOrigins.filter(
					(value): value is 'primary' | 'transformed' | 'variant' =>
						value === 'primary' ||
						value === 'transformed' ||
						value === 'variant'
				)
			: source.metadata?.retrievalQueryOrigin === 'primary' ||
				  source.metadata?.retrievalQueryOrigin === 'transformed' ||
				  source.metadata?.retrievalQueryOrigin === 'variant'
				? [source.metadata.retrievalQueryOrigin]
				: [];
		const primaryHits = queryOrigins.includes('primary') ? 1 : 0;
		const transformedHits = queryOrigins.includes('transformed') ? 1 : 0;
		const variantHits = queryOrigins.includes('variant') ? 1 : 0;
		if (!existing) {
			sections.set(key, {
				bestScore: source.score,
				count: 1,
				hybridHits,
				key,
				label,
				lexicalHits,
				parentLabel,
				path,
				primaryHits,
				sourceSet: new Set(source.source ? [source.source] : []),
				topChunkId: source.chunkId,
				topSource: source.source,
				totalScore: structuredScore,
				transformedHits,
				variantHits,
				vectorHits
			});
			continue;
		}

		existing.count += 1;
		existing.totalScore += structuredScore;
		if (source.source) {
			existing.sourceSet.add(source.source);
		}
		existing.vectorHits += vectorHits;
		existing.lexicalHits += lexicalHits;
		existing.hybridHits += hybridHits;
		existing.primaryHits += primaryHits;
		existing.transformedHits += transformedHits;
		existing.variantHits += variantHits;
		if (source.score > existing.bestScore) {
			existing.bestScore = source.score;
			existing.topChunkId = source.chunkId;
			existing.topSource = source.source;
		}
	}

	const diagnostics = [...sections.values()];
	const strongestBestHit = diagnostics.reduce(
		(highest, section) => Math.max(highest, section.bestScore),
		0
	);
	const parentLabelByKey = new Map(
		diagnostics.map(
			(section) => [section.key, section.parentLabel] as const
		)
	);
	const stageSectionCounts = new Map(
		(trace?.steps ?? [])
			.filter(
				(step) =>
					Array.isArray(step.sectionCounts) &&
					step.sectionCounts.length > 0
			)
			.map((step) => [step.stage, step.sectionCounts ?? []] as const)
	);
	const stageSectionScores = new Map(
		(trace?.steps ?? [])
			.filter(
				(step) =>
					Array.isArray(step.sectionScores) &&
					step.sectionScores.length > 0
			)
			.map((step) => [step.stage, step.sectionScores ?? []] as const)
	);

	return diagnostics
		.map<RAGSectionRetrievalDiagnostic>((section) => {
			const siblingPool = diagnostics.filter(
				(entry) => entry.parentLabel === section.parentLabel
			);
			const siblings = siblingPool.filter(
				(entry) => entry.key !== section.key
			);
			const strongestSibling = siblings
				.slice()
				.sort((left, right) => right.totalScore - left.totalScore)[0];
			const parentTotal = siblingPool.reduce(
				(sum, entry) => sum + entry.totalScore,
				0
			);
			const scoreShare = section.totalScore / totalScore;
			const parentShare =
				parentTotal > 0 ? section.totalScore / parentTotal : undefined;
			const topChunk = sources.find(
				(source) => source.chunkId === section.topChunkId
			);
			const topContextLabel =
				topChunk?.labels?.contextLabel ??
				buildContextLabel(topChunk?.metadata);
			const topLocatorLabel =
				topChunk?.labels?.locatorLabel ??
				buildLocatorLabel(
					topChunk?.metadata,
					topChunk?.source,
					topChunk?.title
				);
			const sourceAwareChunkReason = formatSourceAwareChunkReason(
				topChunk?.metadata?.sourceAwareChunkReason
			);
			const sourceAwareUnitScopeLabel = buildSourceAwareUnitScopeLabel(
				topChunk?.metadata
			);
			const parentDistribution =
				parentTotal > 0
					? siblingPool
							.map((entry) => ({
								count: entry.count,
								isActive: entry.key === section.key,
								key: entry.key,
								label: entry.label,
								parentShare: entry.totalScore / parentTotal,
								totalScore: entry.totalScore
							}))
							.sort(
								(left, right) =>
									right.totalScore - left.totalScore
							)
					: [];
			const reasons: RAGSectionRetrievalDiagnostic['reasons'] = [];
			const stageCounts =
				trace?.steps
					.map((step) => ({
						count:
							step.sectionCounts?.find(
								(entry) => entry.key === section.key
							)?.count ?? 0,
						stage: step.stage
					}))
					.filter((entry) => entry.count > 0) ?? [];
			const stageWeights = stageCounts.map((entry) => {
				const previousStageEntry =
					stageCounts[
						stageCounts.findIndex(
							(candidate) => candidate.stage === entry.stage
						) - 1
					];
				const stageEntries =
					stageSectionCounts
						.get(entry.stage)
						?.filter((candidate) => candidate.count > 0) ?? [];
				const stageScoreEntries =
					stageSectionScores
						.get(entry.stage)
						?.filter((candidate) => candidate.totalScore > 0) ?? [];
				const stageTotal = stageEntries.reduce(
					(sum, candidate) => sum + candidate.count,
					0
				);
				const stageScoreTotal = stageScoreEntries.reduce(
					(sum, candidate) => sum + candidate.totalScore,
					0
				);
				const siblingStageEntries = stageEntries.filter(
					(candidate) =>
						candidate.key !== section.key &&
						parentLabelByKey.get(candidate.key) ===
							section.parentLabel
				);
				const parentStageEntries = stageEntries.filter(
					(candidate) =>
						parentLabelByKey.get(candidate.key) ===
						section.parentLabel
				);
				const siblingStageScoreEntries = stageScoreEntries.filter(
					(candidate) =>
						candidate.key !== section.key &&
						parentLabelByKey.get(candidate.key) ===
							section.parentLabel
				);
				const parentStageScoreEntries = stageScoreEntries.filter(
					(candidate) =>
						parentLabelByKey.get(candidate.key) ===
						section.parentLabel
				);
				const strongestStageSibling = siblingStageEntries
					.slice()
					.sort((left, right) => right.count - left.count)[0];
				const parentStageTotal = parentStageEntries.reduce(
					(sum, candidate) => sum + candidate.count,
					0
				);
				const activeStageScore = stageScoreEntries.find(
					(candidate) => candidate.key === section.key
				)?.totalScore;
				const strongestStageScoreSibling = siblingStageScoreEntries
					.slice()
					.sort(
						(left, right) => right.totalScore - left.totalScore
					)[0];
				const parentStageScoreTotal = parentStageScoreEntries.reduce(
					(sum, candidate) => sum + candidate.totalScore,
					0
				);
				const stageShare =
					stageTotal > 0 ? entry.count / stageTotal : 0;
				const retentionRate =
					typeof previousStageEntry?.count === 'number' &&
					previousStageEntry.count > 0
						? entry.count / previousStageEntry.count
						: undefined;
				const countDelta =
					typeof previousStageEntry?.count === 'number'
						? entry.count - previousStageEntry.count
						: undefined;
				const parentStageShare =
					parentStageTotal > 0
						? entry.count / parentStageTotal
						: undefined;
				const stageScoreShare =
					typeof activeStageScore === 'number' && stageScoreTotal > 0
						? activeStageScore / stageScoreTotal
						: undefined;
				const parentStageScoreShare =
					typeof activeStageScore === 'number' &&
					parentStageScoreTotal > 0
						? activeStageScore / parentStageScoreTotal
						: undefined;
				const stageShareGap =
					stageTotal > 0 && strongestStageSibling
						? entry.count / stageTotal -
							strongestStageSibling.count / stageTotal
						: undefined;
				const parentStageShareGap =
					parentStageTotal > 0 && strongestStageSibling
						? entry.count / parentStageTotal -
							strongestStageSibling.count / parentStageTotal
						: undefined;
				const stageScoreShareGap =
					typeof activeStageScore === 'number' &&
					stageScoreTotal > 0 &&
					strongestStageScoreSibling
						? activeStageScore / stageScoreTotal -
							strongestStageScoreSibling.totalScore /
								stageScoreTotal
						: undefined;
				const parentStageScoreShareGap =
					typeof activeStageScore === 'number' &&
					parentStageScoreTotal > 0 &&
					strongestStageScoreSibling
						? activeStageScore / parentStageScoreTotal -
							strongestStageScoreSibling.totalScore /
								parentStageScoreTotal
						: undefined;
				const reasons: RAGSectionRetrievalDiagnostic['stageWeights'][number]['reasons'] =
					[];
				if (
					entry.stage === 'rerank' &&
					stageShare > 0.5 &&
					(typeof stageShareGap !== 'number' || stageShareGap > 0)
				) {
					reasons.push('rerank_preserved_lead');
				}
				if (entry.stage === 'finalize' && stageShare >= 0.5) {
					reasons.push('final_stage_concentration');
				}
				if (
					entry.stage === 'finalize' &&
					typeof parentStageShare === 'number' &&
					parentStageShare >= 0.6 &&
					(typeof parentStageShareGap !== 'number' ||
						parentStageShareGap > 0)
				) {
					reasons.push('final_stage_dominant_within_parent');
				}
				if (
					strongestStageSibling &&
					((typeof stageShareGap === 'number' &&
						stageShareGap <= 0.1) ||
						(typeof parentStageShareGap === 'number' &&
							parentStageShareGap <= 0.1))
				) {
					reasons.push('stage_runner_up_pressure');
				}
				if (typeof countDelta === 'number') {
					if (countDelta > 0) {
						reasons.push('stage_expanded');
					} else if (countDelta < 0) {
						reasons.push('stage_narrowed');
					} else {
						reasons.push('stage_held');
					}
				}

				return {
					count: entry.count,
					countDelta,
					parentStageScoreShare,
					parentStageShare,
					parentStageShareGap,
					previousCount: previousStageEntry?.count,
					previousStage: previousStageEntry?.stage,
					reasons,
					retentionRate,
					stage: entry.stage,
					stageScoreShare,
					stageScoreShareGap,
					stageShare,
					stageShareGap,
					totalScore: activeStageScore,
					strongestSiblingCount: strongestStageSibling?.count,
					strongestSiblingLabel: strongestStageSibling
						? (diagnostics.find(
								(candidate) =>
									candidate.key === strongestStageSibling.key
							)?.label ?? strongestStageSibling.key)
						: undefined
				};
			});
			const firstSeenStage = stageCounts[0]?.stage;
			const lastSeenStage = stageCounts.at(-1)?.stage;
			const peakStageEntry = stageCounts.reduce<
				(typeof stageCounts)[number] | undefined
			>(
				(highest, entry) =>
					!highest || entry.count > highest.count ? entry : highest,
				undefined
			);
			const finalStageEntry = stageCounts.at(-1);
			const peakCount = peakStageEntry?.count ?? section.count;
			const finalCount = finalStageEntry?.count;
			const finalRetentionRate =
				typeof finalCount === 'number' && peakCount > 0
					? finalCount / peakCount
					: undefined;
			const dropFromPeak =
				typeof finalCount === 'number'
					? peakCount - finalCount
					: undefined;
			const queryAttributionReasons: RAGSectionRetrievalDiagnostic['queryAttribution']['reasons'] =
				[];
			const queryAttributionMode =
				section.primaryHits > 0 &&
				section.transformedHits === 0 &&
				section.variantHits === 0
					? 'primary'
					: section.transformedHits > 0 &&
						  section.primaryHits === 0 &&
						  section.variantHits === 0
						? 'transformed'
						: section.variantHits > 0 &&
							  section.primaryHits === 0 &&
							  section.transformedHits === 0
							? 'variant'
							: 'mixed';
			if (queryAttributionMode === 'primary') {
				queryAttributionReasons.push('base_query_only');
			}
			if (queryAttributionMode === 'transformed') {
				queryAttributionReasons.push('transformed_query_only');
				queryAttributionReasons.push('transform_introduced');
			}
			if (queryAttributionMode === 'variant') {
				queryAttributionReasons.push('variant_only');
				queryAttributionReasons.push('variant_supported');
			}
			if (queryAttributionMode === 'mixed') {
				queryAttributionReasons.push('mixed_query_sources');
				if (section.variantHits > 0) {
					queryAttributionReasons.push('variant_supported');
				}
				if (section.transformedHits > 0 && section.primaryHits === 0) {
					queryAttributionReasons.push('transform_introduced');
				}
			}

			if (section.bestScore >= strongestBestHit) {
				reasons.push('best_hit');
			}
			if (section.count > 1) {
				reasons.push('multi_hit_section');
			}
			if (siblings.length === 0) {
				reasons.push('only_section_in_parent');
			} else if (
				!strongestSibling ||
				section.totalScore >= strongestSibling.totalScore
			) {
				reasons.push('dominant_within_parent');
			}
			if (scoreShare >= 0.5 || (parentShare ?? 0) >= 0.6) {
				reasons.push('concentrated_evidence');
			}

			const summaryParts = [
				isBlockAwareContextLabel(topContextLabel)
					? topContextLabel
					: '',
				`${section.count} hit${section.count === 1 ? '' : 's'}`,
				`${(scoreShare * 100).toFixed(0)}% score share`,
				`vector ${section.vectorHits} · lexical ${section.lexicalHits} · hybrid ${section.hybridHits}`,
				typeof parentShare === 'number'
					? `${(parentShare * 100).toFixed(0)}% of parent section set`
					: '',
				sourceAwareChunkReason
					? `boundary ${sourceAwareChunkReason}`
					: '',
				sourceAwareUnitScopeLabel
					? `scope ${sourceAwareUnitScopeLabel}`
					: '',
				strongestSibling
					? `ahead of ${strongestSibling.label} by ${(section.totalScore - strongestSibling.totalScore).toFixed(2)}`
					: 'no sibling competition'
			].filter(Boolean);

			return {
				averageScore: section.totalScore / section.count,
				bestScore: section.bestScore,
				count: section.count,
				key: section.key,
				label: section.label,
				parentLabel: section.parentLabel,
				parentDistribution,
				parentShare,
				parentShareGap:
					typeof parentShare === 'number' &&
					strongestSibling &&
					parentTotal > 0
						? parentShare -
							strongestSibling.totalScore / parentTotal
						: undefined,
				path: section.path,
				firstSeenStage,
				finalCount,
				finalRetentionRate,
				lastSeenStage,
				dropFromPeak,
				peakCount,
				peakStage: peakStageEntry?.stage,
				queryAttribution: {
					mode: queryAttributionMode,
					primaryHits: section.primaryHits,
					reasons: queryAttributionReasons,
					transformedHits: section.transformedHits,
					variantHits: section.variantHits
				},
				requestedMode: trace?.requestedMode,
				retrievalMode: trace?.mode,
				routingLabel: trace?.routingLabel,
				routingProvider: trace?.routingProvider,
				routingReason: trace?.routingReason,
				queryTransformLabel: trace?.queryTransformLabel,
				queryTransformProvider: trace?.queryTransformProvider,
				queryTransformReason: trace?.queryTransformReason,
				reasons,
				evidenceReconcileApplied: trace?.steps.some(
					(step) => step.stage === 'evidence_reconcile'
				),
				rerankApplied: trace?.steps.some(
					(step) =>
						step.stage === 'rerank' &&
						step.metadata?.applied === true
				),
				scoreShare,
				scoreThresholdApplied: trace?.steps.some(
					(step) => step.stage === 'score_filter'
				),
				stageCounts,
				stageWeights,
				siblingCount: siblings.length,
				siblingScoreGap: strongestSibling
					? section.totalScore - strongestSibling.totalScore
					: undefined,
				sourceCount: section.sourceSet.size,
				sourceAwareChunkReasonLabel: sourceAwareChunkReason,
				sourceAwareUnitScopeLabel,
				topContextLabel,
				topLocatorLabel,
				sourceBalanceApplied: trace?.steps.some(
					(step) => step.stage === 'source_balance'
				),
				strongestSiblingLabel: strongestSibling?.label,
				strongestSiblingScore: strongestSibling?.totalScore,
				summary: summaryParts.join(' · '),
				topChunkId: section.topChunkId,
				topSource: section.topSource,
				totalScore: section.totalScore,
				hybridHits: section.hybridHits,
				lexicalHits: section.lexicalHits,
				vectorHits: section.vectorHits
			};
		})
		.sort((left, right) => {
			if (right.totalScore !== left.totalScore) {
				return right.totalScore - left.totalScore;
			}
			if (right.bestScore !== left.bestScore) {
				return right.bestScore - left.bestScore;
			}
			return left.label.localeCompare(right.label);
		});
};

export type RAGStreamProgress = {
	stage: RAGStreamStage;
	conversationId?: string;
	messageId?: string;
	retrievalStartedAt?: number;
	retrievedAt?: number;
	retrievalDurationMs?: number;
	hasContent: boolean;
	hasRetrieved: boolean;
	hasSources: boolean;
	hasThinking: boolean;
	hasToolCalls: boolean;
	isComplete: boolean;
	isError: boolean;
	isIdle: boolean;
	isRetrieving: boolean;
	isRetrieved: boolean;
	isStreaming: boolean;
	isSubmitting: boolean;
	sourceCount: number;
	latestMessage: AIMessage | undefined;
};

const buildStreamProgressState = (messages: AIMessage[]) => {
	const latestMessage = getLatestAssistantMessage(messages);
	const retrieved = latestMessage
		? buildRAGRetrievedState(messages)
		: undefined;

	return {
		conversationId: latestMessage?.conversationId,
		latestMessage,
		messageId: latestMessage?.id,
		retrieved,
		sourceCount:
			retrieved?.sources.length ?? latestMessage?.sources?.length ?? 0
	};
};

export const buildRAGStreamProgress = ({
	error,
	isStreaming,
	messages
}: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}): RAGStreamProgress => {
	const stage = resolveRAGStreamStage({
		error,
		isStreaming,
		messages
	});
	const state = buildStreamProgressState(messages);
	const hasSources = state.sourceCount > 0;
	const hasRetrieved =
		stage === 'retrieved' ||
		state.retrieved !== undefined ||
		state.latestMessage?.retrievedAt !== undefined;
	const hasThinking =
		typeof state.latestMessage?.thinking === 'string' &&
		state.latestMessage.thinking.length > 0;
	const hasToolCalls = (state.latestMessage?.toolCalls?.length ?? 0) > 0;

	return {
		conversationId: state.conversationId,
		hasContent:
			typeof state.latestMessage?.content === 'string' &&
			state.latestMessage.content.length > 0,
		hasRetrieved,
		hasSources,
		hasThinking,
		hasToolCalls,
		isComplete: stage === 'complete',
		isError: stage === 'error',
		isIdle: stage === 'idle',
		isRetrieved: stage === 'retrieved',
		isRetrieving: stage === 'submitting' || stage === 'retrieving',
		isStreaming: stage === 'streaming',
		isSubmitting: stage === 'submitting',
		latestMessage: state.latestMessage,
		messageId: state.messageId,
		retrievalDurationMs: state.retrieved?.retrievalDurationMs,
		retrievalStartedAt: state.retrieved?.retrievalStartedAt,
		retrievedAt: state.retrieved?.retrievedAt,
		sourceCount: state.sourceCount,
		stage
	};
};

export type RAGStreamProgressState = ReturnType<typeof buildRAGStreamProgress>;
export const buildRAGAnswerWorkflowState = ({
	error,
	isStreaming,
	messages
}: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}): RAGAnswerWorkflowState => {
	const latestAssistantMessage = getLatestAssistantMessage(messages);
	const sources = getLatestRAGSources(messages);
	const sourceGroups = buildRAGSourceGroups(sources);
	const citations = buildRAGCitations(sources);
	const citationReferenceMap = buildRAGCitationReferenceMap(citations);
	const sourceSummaries = buildRAGSourceSummaries(sources);
	const groundingReferences = buildRAGGroundingReferences(sources);
	const groundedAnswer = buildRAGGroundedAnswer(
		latestAssistantMessage?.content ?? '',
		sources
	);
	const retrieval = buildRAGRetrievedState(messages);
	const sectionDiagnostics = buildRAGSectionRetrievalDiagnostics(
		sources,
		retrieval?.trace
	);
	const progress = buildRAGStreamProgress({
		error,
		isStreaming,
		messages
	});

	return {
		excerptModeCounts: buildRAGExcerptModeCounts([
			...citations.map((citation) => citation.excerptSelection),
			...sourceSummaries.map((summary) => summary.excerptSelection),
			...groundingReferences.map(
				(reference) => reference.excerptSelection
			),
			...groundedAnswer.sectionSummaries.map(
				(summary) => summary.excerptSelection
			)
		]),
		citationReferenceMap,
		citations,
		coverage: groundedAnswer.coverage,
		error,
		groundedAnswer,
		groundingReferences,
		hasCitations: groundedAnswer.hasCitations,
		hasGrounding: groundingReferences.length > 0,
		hasRetrieved: progress.hasRetrieved,
		hasSources: sources.length > 0,
		isAnswerStreaming: progress.isStreaming,
		isComplete: progress.isComplete,
		isError: progress.isError,
		isIdle: progress.isIdle,
		isRetrieved: progress.isRetrieved,
		isRetrieving: progress.isRetrieving,
		isRunning:
			progress.isSubmitting ||
			progress.isRetrieving ||
			progress.isStreaming,
		isSubmitting: progress.isSubmitting,
		latestAssistantMessage,
		messages,
		retrieval,
		retrievalDurationMs: retrieval?.retrievalDurationMs,
		retrievalStartedAt: retrieval?.retrievalStartedAt,
		retrievedAt: retrieval?.retrievedAt,
		sectionDiagnostics,
		sourceGroups,
		sourceSummaries,
		sources,
		stage: progress.stage,
		ungroundedReferenceNumbers: groundedAnswer.ungroundedReferenceNumbers
	};
};

export const buildRAGSourceGroups = (sources: RAGSource[]) => {
	const groups = new Map<string, RAGSourceGroup>();

	for (const source of sources) {
		updateSourceGroup(groups, source);
	}

	return [...groups.values()].sort((left, right) => {
		if (right.bestScore !== left.bestScore) {
			return right.bestScore - left.bestScore;
		}

		return left.label.localeCompare(right.label);
	});
};

const buildSourceGroup = (source: RAGSource, key: string): RAGSourceGroup => ({
	bestScore: source.score,
	chunks: [source],
	count: 1,
	key,
	label: buildSourceLabel(source),
	labels:
		source.labels ??
		buildRAGSourceLabels({
			metadata: source.metadata,
			source: source.source,
			title: source.title
		}),
	structure: source.structure ?? buildRAGChunkStructure(source.metadata),
	source: source.source,
	title: source.title
});

const updateSourceGroup = (
	groups: Map<string, RAGSourceGroup>,
	source: RAGSource
) => {
	const key = buildSourceGroupKey(source);
	const existing = groups.get(key);
	if (!existing) {
		groups.set(key, buildSourceGroup(source, key));

		return;
	}

	existing.bestScore = Math.max(existing.bestScore, source.score);
	existing.count += 1;
	existing.chunks.push(source);
	const leadChunk = getPreferredSourceLeadChunk(existing.chunks);
	if (leadChunk) {
		existing.label = buildSourceLabel(leadChunk);
		existing.labels =
			leadChunk.labels ??
			buildRAGSourceLabels({
				metadata: leadChunk.metadata,
				source: leadChunk.source,
				title: leadChunk.title
			});
		existing.structure =
			leadChunk.structure ?? buildRAGChunkStructure(leadChunk.metadata);
		existing.source = leadChunk.source;
		existing.title = leadChunk.title;
	}
};
export const getLatestAssistantMessage = (messages: AIMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === 'assistant') {
			return message;
		}
	}

	return undefined;
};
export const getLatestRAGSources = (messages: AIMessage[]) =>
	getLatestAssistantMessage(messages)?.sources ?? [];
export const getLatestRetrievedMessage = (messages: AIMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === 'assistant' &&
			(typeof message.retrievedAt === 'number' ||
				(message.sources?.length ?? 0) > 0)
		) {
			return message;
		}
	}

	return undefined;
};
export const resolveRAGStreamStage = ({
	error,
	isStreaming,
	messages
}: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}) => {
	if (error) {
		return 'error';
	}

	const assistantMessage = getLatestAssistantMessage(messages);
	if (!assistantMessage) {
		return isStreaming ? 'submitting' : 'idle';
	}

	const isRetrieving =
		typeof assistantMessage.retrievalStartedAt === 'number' &&
		typeof assistantMessage.retrievedAt !== 'number';

	if (isRetrieving) {
		return 'retrieving';
	}

	if (!isStreaming) {
		return 'complete';
	}

	const hasRetrieved = typeof assistantMessage.retrievedAt === 'number';
	const hasContent =
		assistantMessage.content.trim().length > 0 ||
		assistantMessage.thinking?.trim().length ||
		(assistantMessage.toolCalls?.length ?? 0) > 0 ||
		(assistantMessage.images?.length ?? 0) > 0;

	if (hasRetrieved && !hasContent) {
		return 'retrieved';
	}

	return 'streaming';
};

const formatSignedDelta = (value: number, decimals = 0, suffix = '') =>
	`${value >= 0 ? '+' : ''}${value.toFixed(decimals)}${suffix}`;

const formatEvaluationPassingRate = (value: number) => `${value.toFixed(1)}%`;

const formatEvaluationSummary = (response: RAGEvaluationResponse) =>
	`${response.summary.totalCases} total · f1 ${response.summary.averageF1.toFixed(
		3
	)} · latency ${response.summary.averageLatencyMs.toFixed(1)}ms`;

const formatGroundingHistorySummaryValue = (response: {
	summary: {
		passedCases: number;
		totalCases: number;
		groundedCases: number;
		partialCases: number;
		ungroundedCases: number;
		averageResolvedCitationRate: number;
		averageCitationF1: number;
	};
}) =>
	`${response.summary.passedCases}/${response.summary.totalCases} pass · grounded ${response.summary.groundedCases} · partial ${response.summary.partialCases} · ungrounded ${response.summary.ungroundedCases} · resolved citations ${(response.summary.averageResolvedCitationRate * 100).toFixed(1)}% · citation f1 ${response.summary.averageCitationF1.toFixed(3)}`;

const formatHistoryCaseLabels = (cases: RAGEvaluationCaseDiff[]) =>
	cases.length > 0
		? cases.map((entry) => entry.label ?? entry.caseId).join(', ')
		: 'none';

const buildComparisonCaseLeadLabel = (snapshot?: {
	topLocatorLabel?: string;
	topContextLabel?: string;
	sourceAwareUnitScopeLabel?: string;
	sourceAwareChunkReasonLabel?: string;
}) =>
	snapshot?.topLocatorLabel ??
	snapshot?.topContextLabel ??
	snapshot?.sourceAwareUnitScopeLabel ??
	snapshot?.sourceAwareChunkReasonLabel;

const formatComparisonLeadCueSummary = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const labels = Array.from(
		new Set(
			(entry.caseTraceSnapshots ?? [])
				.map((snapshot) => buildComparisonCaseLeadLabel(snapshot))
				.filter((value): value is string => typeof value === 'string')
		)
	).slice(0, 3);

	return labels.length > 0 ? labels.join(' · ') : 'none';
};

const formatComparisonLeadMediaCueSummary = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const labels = Array.from(
		new Set(
			(entry.caseTraceSnapshots ?? [])
				.map((snapshot) =>
					formatLeadMediaCueSummary({
						leadSpeakerCue: snapshot.leadSpeakerCue,
						leadSpeakerAttributionCue:
							snapshot.leadSpeakerAttributionCue,
						leadChannelCue: snapshot.leadChannelCue,
						leadChannelAttributionCue:
							snapshot.leadChannelAttributionCue,
						leadContinuityCue: snapshot.leadContinuityCue
					})
				)
				.filter(
					(value): value is string =>
						typeof value === 'string' && value !== 'none'
				)
		)
	).slice(0, 3);

	return labels.length > 0 ? labels.join(' · ') : 'none';
};

const formatComparisonPresentationCueSummary = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const labels = Array.from(
		new Set(
			(entry.caseTraceSnapshots ?? [])
				.map((snapshot) => snapshot.leadPresentationCue)
				.filter(
					(value): value is 'body' | 'notes' | 'title' =>
						value === 'body' ||
						value === 'notes' ||
						value === 'title'
				)
		)
	).map((value) =>
		value === 'notes' ? 'notes' : value === 'title' ? 'title' : 'body'
	);

	return labels.length > 0 ? labels.join(' / ') : 'none';
};

const formatLeadPresentationCue = (
	cue?: 'body' | 'notes' | 'title'
): string => {
	if (cue === 'notes' || cue === 'title' || cue === 'body') {
		return cue;
	}

	return 'none';
};

const formatSQLitePlannerCueSummary = (input?: {
	sqliteQueryMode?: string;
	sqliteQueryPushdownMode?: string;
	sqliteQueryPushdownApplied?: boolean;
	sqliteQueryPushdownClauseCount?: number;
	sqliteQueryPushdownCoverageRatio?: number;
	sqliteQueryTotalFilterClauseCount?: number;
	sqliteQueryJsRemainderClauseCount?: number;
	sqliteQueryPlannerProfileUsed?: string;
	sqliteQueryMultiplierUsed?: number;
	sqliteQueryCandidateLimitUsed?: number;
	sqliteQueryMaxBackfillsUsed?: number;
	sqliteQueryMinResultsUsed?: number;
	sqliteQueryFillPolicyUsed?: string;
	sqliteQueryJsRemainderRatio?: number;
	sqliteQueryFilteredCandidates?: number;
	sqliteQueryInitialSearchK?: number;
	sqliteQueryFinalSearchK?: number;
	sqliteQuerySearchExpansionRatio?: number;
	sqliteQueryBackfillCount?: number;
	sqliteQueryBackfillLimitReached?: boolean;
	sqliteQueryMinResultsSatisfied?: boolean;
	sqliteQueryReturnedCount?: number;
	sqliteQueryCandidateYieldRatio?: number;
	sqliteQueryTopKFillRatio?: number;
	sqliteQueryUnderfilledTopK?: boolean;
	sqliteQueryCandidateBudgetExhausted?: boolean;
	sqliteQueryCandidateCoverage?: string;
}) => {
	const plannerJudgment =
		typeof input?.sqliteQuerySearchExpansionRatio === 'number' &&
		typeof input?.sqliteQueryCandidateYieldRatio === 'number' &&
		input.sqliteQuerySearchExpansionRatio >= 2 &&
		input.sqliteQueryCandidateYieldRatio < 0.25
			? 'expensive backfill'
			: typeof input?.sqliteQueryTopKFillRatio === 'number' &&
				  typeof input?.sqliteQueryCandidateYieldRatio === 'number' &&
				  input.sqliteQueryTopKFillRatio >= 1 &&
				  input.sqliteQueryCandidateYieldRatio >= 0.5
				? 'efficient fill'
				: input?.sqliteQueryPushdownMode === 'full' &&
					  typeof input?.sqliteQueryPushdownCoverageRatio ===
							'number' &&
					  input.sqliteQueryPushdownCoverageRatio >= 1
					? 'full pushdown'
					: input?.sqliteQueryPushdownMode === 'partial' &&
						  typeof input?.sqliteQueryJsRemainderRatio ===
								'number' &&
						  input.sqliteQueryJsRemainderRatio >= 0.5
						? 'heavy js remainder'
						: undefined;

	const parts = [
		input?.sqliteQueryMode ? `mode ${input.sqliteQueryMode}` : undefined,
		input?.sqliteQueryPushdownMode
			? `pushdown ${input.sqliteQueryPushdownMode}`
			: undefined,
		typeof input?.sqliteQueryPushdownApplied === 'boolean'
			? input.sqliteQueryPushdownApplied
				? 'pushdown applied'
				: 'pushdown skipped'
			: undefined,
		typeof input?.sqliteQueryPushdownClauseCount === 'number'
			? `clauses ${input.sqliteQueryPushdownClauseCount}`
			: undefined,
		typeof input?.sqliteQueryPushdownCoverageRatio === 'number'
			? `pushdown ${(input.sqliteQueryPushdownCoverageRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.sqliteQueryJsRemainderClauseCount === 'number'
			? `js remainder ${input.sqliteQueryJsRemainderClauseCount}`
			: undefined,
		input?.sqliteQueryPlannerProfileUsed
			? `profile ${input.sqliteQueryPlannerProfileUsed}`
			: undefined,
		typeof input?.sqliteQueryMultiplierUsed === 'number'
			? `x${input.sqliteQueryMultiplierUsed}`
			: undefined,
		typeof input?.sqliteQueryCandidateLimitUsed === 'number'
			? `cap ${input.sqliteQueryCandidateLimitUsed}`
			: undefined,
		typeof input?.sqliteQueryMaxBackfillsUsed === 'number'
			? `backfills ${input.sqliteQueryMaxBackfillsUsed}`
			: undefined,
		typeof input?.sqliteQueryMinResultsUsed === 'number'
			? `min ${input.sqliteQueryMinResultsUsed}`
			: undefined,
		input?.sqliteQueryFillPolicyUsed
			? `fill ${input.sqliteQueryFillPolicyUsed}`
			: undefined,
		typeof input?.sqliteQueryJsRemainderRatio === 'number'
			? `js ${(input.sqliteQueryJsRemainderRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.sqliteQueryTotalFilterClauseCount === 'number'
			? `total clauses ${input.sqliteQueryTotalFilterClauseCount}`
			: undefined,
		typeof input?.sqliteQueryFilteredCandidates === 'number'
			? `filtered ${input.sqliteQueryFilteredCandidates}`
			: undefined,
		typeof input?.sqliteQueryInitialSearchK === 'number' &&
		typeof input?.sqliteQueryFinalSearchK === 'number'
			? `searchK ${input.sqliteQueryInitialSearchK}->${input.sqliteQueryFinalSearchK}`
			: typeof input?.sqliteQueryFinalSearchK === 'number'
				? `searchK ${input.sqliteQueryFinalSearchK}`
				: undefined,
		typeof input?.sqliteQuerySearchExpansionRatio === 'number'
			? `expand ${(input.sqliteQuerySearchExpansionRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.sqliteQueryBackfillCount === 'number'
			? `backfill ${input.sqliteQueryBackfillCount}`
			: undefined,
		typeof input?.sqliteQueryBackfillLimitReached === 'boolean' &&
		input.sqliteQueryBackfillLimitReached
			? 'backfill limit reached'
			: undefined,
		typeof input?.sqliteQueryMinResultsSatisfied === 'boolean' &&
		input.sqliteQueryMinResultsSatisfied
			? 'min satisfied'
			: undefined,
		typeof input?.sqliteQueryReturnedCount === 'number'
			? `returned ${input.sqliteQueryReturnedCount}`
			: undefined,
		typeof input?.sqliteQueryCandidateYieldRatio === 'number'
			? `yield ${(input.sqliteQueryCandidateYieldRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.sqliteQueryTopKFillRatio === 'number'
			? `fill ${(input.sqliteQueryTopKFillRatio * 100).toFixed(0)}%`
			: undefined,
		input?.sqliteQueryCandidateCoverage
			? `coverage ${input.sqliteQueryCandidateCoverage}`
			: undefined,
		typeof input?.sqliteQueryUnderfilledTopK === 'boolean' &&
		input.sqliteQueryUnderfilledTopK
			? 'underfilled topK'
			: undefined,
		typeof input?.sqliteQueryCandidateBudgetExhausted === 'boolean' &&
		input.sqliteQueryCandidateBudgetExhausted
			? 'budget exhausted'
			: undefined,
		plannerJudgment
	].filter((value): value is string => typeof value === 'string');

	return parts.length > 0 ? parts.join(' · ') : 'none';
};

const formatPostgresPlannerCueSummary = (input?: {
	postgresQueryMode?: string;
	postgresQueryPushdownMode?: string;
	postgresQueryPushdownApplied?: boolean;
	postgresQueryPushdownClauseCount?: number;
	postgresQueryPushdownCoverageRatio?: number;
	postgresQueryTotalFilterClauseCount?: number;
	postgresQueryJsRemainderClauseCount?: number;
	postgresQueryPlannerProfileUsed?: string;
	postgresQueryMultiplierUsed?: number;
	postgresQueryCandidateLimitUsed?: number;
	postgresQueryMaxBackfillsUsed?: number;
	postgresQueryMinResultsUsed?: number;
	postgresQueryFillPolicyUsed?: string;
	postgresQueryJsRemainderRatio?: number;
	postgresQueryFilteredCandidates?: number;
	postgresQueryInitialSearchK?: number;
	postgresQueryFinalSearchK?: number;
	postgresQuerySearchExpansionRatio?: number;
	postgresQueryBackfillCount?: number;
	postgresQueryBackfillLimitReached?: boolean;
	postgresQueryMinResultsSatisfied?: boolean;
	postgresQueryReturnedCount?: number;
	postgresQueryCandidateYieldRatio?: number;
	postgresQueryTopKFillRatio?: number;
	postgresQueryUnderfilledTopK?: boolean;
	postgresQueryCandidateBudgetExhausted?: boolean;
	postgresQueryCandidateCoverage?: string;
	postgresIndexType?: string;
	postgresIndexName?: string;
	postgresIndexPresent?: boolean;
	postgresEstimatedRowCount?: number;
	postgresTableBytes?: number;
	postgresIndexBytes?: number;
	postgresTotalBytes?: number;
	postgresIndexStorageRatio?: number;
}) => {
	const plannerJudgment =
		typeof input?.postgresQuerySearchExpansionRatio === 'number' &&
		typeof input?.postgresQueryCandidateYieldRatio === 'number' &&
		input.postgresQuerySearchExpansionRatio >= 2 &&
		input.postgresQueryCandidateYieldRatio < 0.25
			? 'expensive backfill'
			: typeof input?.postgresQueryTopKFillRatio === 'number' &&
				  typeof input?.postgresQueryCandidateYieldRatio === 'number' &&
				  input.postgresQueryTopKFillRatio >= 1 &&
				  input.postgresQueryCandidateYieldRatio >= 0.5
				? 'efficient fill'
				: input?.postgresQueryPushdownMode === 'full' &&
					  typeof input?.postgresQueryPushdownCoverageRatio ===
							'number' &&
					  input.postgresQueryPushdownCoverageRatio >= 1
					? 'full pushdown'
					: input?.postgresQueryPushdownMode === 'partial' &&
						  typeof input?.postgresQueryJsRemainderRatio ===
								'number' &&
						  input.postgresQueryJsRemainderRatio >= 0.5
						? 'heavy js remainder'
						: undefined;
	const healthJudgment =
		input?.postgresIndexPresent === false
			? 'index missing'
			: typeof input?.postgresIndexStorageRatio === 'number' &&
				  input.postgresIndexStorageRatio >= 0.7
				? 'index-heavy storage'
				: typeof input?.postgresEstimatedRowCount === 'number' &&
					  input.postgresEstimatedRowCount >= 1000 &&
					  input.postgresIndexPresent === true
					? 'indexed larger corpus'
					: undefined;

	const parts = [
		input?.postgresQueryMode
			? `mode ${input.postgresQueryMode}`
			: undefined,
		input?.postgresIndexType
			? `index ${input.postgresIndexType}`
			: undefined,
		typeof input?.postgresIndexPresent === 'boolean'
			? input.postgresIndexPresent
				? 'index present'
				: 'index missing'
			: undefined,
		typeof input?.postgresEstimatedRowCount === 'number'
			? `rows ${input.postgresEstimatedRowCount}`
			: undefined,
		typeof input?.postgresTableBytes === 'number'
			? `table ${formatByteSizeLabel(input.postgresTableBytes)}`
			: undefined,
		typeof input?.postgresIndexBytes === 'number'
			? `index ${formatByteSizeLabel(input.postgresIndexBytes)}`
			: undefined,
		typeof input?.postgresIndexStorageRatio === 'number'
			? `index share ${(input.postgresIndexStorageRatio * 100).toFixed(0)}%`
			: undefined,
		input?.postgresQueryPushdownMode
			? `pushdown ${input.postgresQueryPushdownMode}`
			: undefined,
		typeof input?.postgresQueryPushdownApplied === 'boolean'
			? input.postgresQueryPushdownApplied
				? 'pushdown on'
				: 'pushdown off'
			: undefined,
		typeof input?.postgresQueryPushdownClauseCount === 'number'
			? `clauses ${input.postgresQueryPushdownClauseCount}`
			: undefined,
		typeof input?.postgresQueryPushdownCoverageRatio === 'number'
			? `pushdown ${(input.postgresQueryPushdownCoverageRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.postgresQueryJsRemainderClauseCount === 'number'
			? `js remainder ${input.postgresQueryJsRemainderClauseCount}`
			: undefined,
		input?.postgresQueryPlannerProfileUsed
			? `profile ${input.postgresQueryPlannerProfileUsed}`
			: undefined,
		typeof input?.postgresQueryMultiplierUsed === 'number'
			? `x${input.postgresQueryMultiplierUsed}`
			: undefined,
		typeof input?.postgresQueryCandidateLimitUsed === 'number'
			? `cap ${input.postgresQueryCandidateLimitUsed}`
			: undefined,
		typeof input?.postgresQueryMaxBackfillsUsed === 'number'
			? `backfills ${input.postgresQueryMaxBackfillsUsed}`
			: undefined,
		typeof input?.postgresQueryMinResultsUsed === 'number'
			? `min ${input.postgresQueryMinResultsUsed}`
			: undefined,
		input?.postgresQueryFillPolicyUsed
			? `fill ${input.postgresQueryFillPolicyUsed}`
			: undefined,
		typeof input?.postgresQueryJsRemainderRatio === 'number'
			? `js ${(input.postgresQueryJsRemainderRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.postgresQueryTotalFilterClauseCount === 'number'
			? `total clauses ${input.postgresQueryTotalFilterClauseCount}`
			: undefined,
		typeof input?.postgresQueryFilteredCandidates === 'number'
			? `filtered ${input.postgresQueryFilteredCandidates}`
			: undefined,
		typeof input?.postgresQueryInitialSearchK === 'number' &&
		typeof input?.postgresQueryFinalSearchK === 'number'
			? `searchK ${input.postgresQueryInitialSearchK}->${input.postgresQueryFinalSearchK}`
			: typeof input?.postgresQueryFinalSearchK === 'number'
				? `searchK ${input.postgresQueryFinalSearchK}`
				: undefined,
		typeof input?.postgresQuerySearchExpansionRatio === 'number'
			? `expand ${(input.postgresQuerySearchExpansionRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.postgresQueryBackfillCount === 'number'
			? `backfill ${input.postgresQueryBackfillCount}`
			: undefined,
		typeof input?.postgresQueryBackfillLimitReached === 'boolean' &&
		input.postgresQueryBackfillLimitReached
			? 'backfill limit reached'
			: undefined,
		typeof input?.postgresQueryMinResultsSatisfied === 'boolean' &&
		input.postgresQueryMinResultsSatisfied
			? 'min satisfied'
			: undefined,
		typeof input?.postgresQueryReturnedCount === 'number'
			? `returned ${input.postgresQueryReturnedCount}`
			: undefined,
		typeof input?.postgresQueryCandidateYieldRatio === 'number'
			? `yield ${(input.postgresQueryCandidateYieldRatio * 100).toFixed(0)}%`
			: undefined,
		typeof input?.postgresQueryTopKFillRatio === 'number'
			? `fill ${(input.postgresQueryTopKFillRatio * 100).toFixed(0)}%`
			: undefined,
		input?.postgresQueryCandidateCoverage
			? `coverage ${input.postgresQueryCandidateCoverage}`
			: undefined,
		typeof input?.postgresQueryUnderfilledTopK === 'boolean' &&
		input.postgresQueryUnderfilledTopK
			? 'underfilled topK'
			: undefined,
		typeof input?.postgresQueryCandidateBudgetExhausted === 'boolean' &&
		input.postgresQueryCandidateBudgetExhausted
			? 'budget exhausted'
			: undefined,
		plannerJudgment,
		healthJudgment
	].filter((value): value is string => typeof value === 'string');

	return parts.length > 0 ? parts.join(' · ') : 'none';
};

const formatComparisonSQLitePlannerCueSummary = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const labels = Array.from(
		new Set(
			(entry.caseTraceSnapshots ?? [])
				.map((snapshot) =>
					formatSQLitePlannerCueSummary({
						sqliteQueryBackfillCount:
							snapshot.sqliteQueryBackfillCount,
						sqliteQueryCandidateBudgetExhausted:
							snapshot.sqliteQueryCandidateBudgetExhausted,
						sqliteQueryCandidateCoverage:
							snapshot.sqliteQueryCandidateCoverage,
						sqliteQueryFilteredCandidates:
							snapshot.sqliteQueryFilteredCandidates,
						sqliteQueryFinalSearchK:
							snapshot.sqliteQueryFinalSearchK,
						sqliteQueryInitialSearchK:
							snapshot.sqliteQueryInitialSearchK,
						sqliteQuerySearchExpansionRatio:
							snapshot.sqliteQuerySearchExpansionRatio,
						sqliteQueryJsRemainderClauseCount:
							snapshot.sqliteQueryJsRemainderClauseCount,
						sqliteQueryCandidateLimitUsed:
							snapshot.sqliteQueryCandidateLimitUsed,
						sqliteQueryMaxBackfillsUsed:
							snapshot.sqliteQueryMaxBackfillsUsed,
						sqliteQueryMinResultsUsed:
							snapshot.sqliteQueryMinResultsUsed,
						sqliteQueryFillPolicyUsed:
							snapshot.sqliteQueryFillPolicyUsed,
						sqliteQueryMode: snapshot.sqliteQueryMode,
						sqliteQueryPushdownApplied:
							snapshot.sqliteQueryPushdownApplied,
						sqliteQueryPushdownClauseCount:
							snapshot.sqliteQueryPushdownClauseCount,
						sqliteQueryPushdownCoverageRatio:
							snapshot.sqliteQueryPushdownCoverageRatio,
						sqliteQueryPushdownMode:
							snapshot.sqliteQueryPushdownMode,
						sqliteQueryTotalFilterClauseCount:
							snapshot.sqliteQueryTotalFilterClauseCount,
						sqliteQueryReturnedCount:
							snapshot.sqliteQueryReturnedCount,
						sqliteQueryBackfillLimitReached:
							snapshot.sqliteQueryBackfillLimitReached,
						sqliteQueryMinResultsSatisfied:
							snapshot.sqliteQueryMinResultsSatisfied,
						sqliteQueryCandidateYieldRatio:
							snapshot.sqliteQueryCandidateYieldRatio,
						sqliteQueryTopKFillRatio:
							snapshot.sqliteQueryTopKFillRatio,
						sqliteQueryJsRemainderRatio:
							snapshot.sqliteQueryJsRemainderRatio,
						sqliteQueryUnderfilledTopK:
							snapshot.sqliteQueryUnderfilledTopK
					})
				)
				.filter(
					(value): value is string =>
						typeof value === 'string' && value !== 'none'
				)
		)
	).slice(0, 3);

	return labels.length > 0 ? labels.join(' · ') : 'none';
};

const formatComparisonPostgresPlannerCueSummary = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const labels = Array.from(
		new Set(
			(entry.caseTraceSnapshots ?? [])
				.map((snapshot) =>
					formatPostgresPlannerCueSummary({
						postgresQueryBackfillCount:
							snapshot.postgresQueryBackfillCount,
						postgresQueryCandidateBudgetExhausted:
							snapshot.postgresQueryCandidateBudgetExhausted,
						postgresQueryCandidateCoverage:
							snapshot.postgresQueryCandidateCoverage,
						postgresQueryFilteredCandidates:
							snapshot.postgresQueryFilteredCandidates,
						postgresQueryFinalSearchK:
							snapshot.postgresQueryFinalSearchK,
						postgresQueryInitialSearchK:
							snapshot.postgresQueryInitialSearchK,
						postgresQuerySearchExpansionRatio:
							snapshot.postgresQuerySearchExpansionRatio,
						postgresQueryJsRemainderClauseCount:
							snapshot.postgresQueryJsRemainderClauseCount,
						postgresQueryCandidateLimitUsed:
							snapshot.postgresQueryCandidateLimitUsed,
						postgresQueryMaxBackfillsUsed:
							snapshot.postgresQueryMaxBackfillsUsed,
						postgresQueryMinResultsUsed:
							snapshot.postgresQueryMinResultsUsed,
						postgresQueryFillPolicyUsed:
							snapshot.postgresQueryFillPolicyUsed,
						postgresQueryMultiplierUsed:
							snapshot.postgresQueryMultiplierUsed,
						postgresQueryMode: snapshot.postgresQueryMode,
						postgresQueryPushdownApplied:
							snapshot.postgresQueryPushdownApplied,
						postgresQueryPushdownClauseCount:
							snapshot.postgresQueryPushdownClauseCount,
						postgresQueryPushdownCoverageRatio:
							snapshot.postgresQueryPushdownCoverageRatio,
						postgresQueryPushdownMode:
							snapshot.postgresQueryPushdownMode,
						postgresQueryTotalFilterClauseCount:
							snapshot.postgresQueryTotalFilterClauseCount,
						postgresQueryReturnedCount:
							snapshot.postgresQueryReturnedCount,
						postgresQueryBackfillLimitReached:
							snapshot.postgresQueryBackfillLimitReached,
						postgresQueryMinResultsSatisfied:
							snapshot.postgresQueryMinResultsSatisfied,
						postgresQueryCandidateYieldRatio:
							snapshot.postgresQueryCandidateYieldRatio,
						postgresQueryTopKFillRatio:
							snapshot.postgresQueryTopKFillRatio,
						postgresQueryJsRemainderRatio:
							snapshot.postgresQueryJsRemainderRatio,
						postgresEstimatedRowCount:
							snapshot.postgresEstimatedRowCount,
						postgresIndexBytes: snapshot.postgresIndexBytes,
						postgresIndexName: snapshot.postgresIndexName,
						postgresIndexPresent: snapshot.postgresIndexPresent,
						postgresIndexStorageRatio:
							snapshot.postgresIndexStorageRatio,
						postgresIndexType: snapshot.postgresIndexType,
						postgresTableBytes: snapshot.postgresTableBytes,
						postgresTotalBytes: snapshot.postgresTotalBytes,
						postgresQueryUnderfilledTopK:
							snapshot.postgresQueryUnderfilledTopK
					})
				)
				.filter(
					(value): value is string =>
						typeof value === 'string' && value !== 'none'
				)
		)
	).slice(0, 3);

	return labels.length > 0 ? labels.join(' · ') : 'none';
};

const formatComparisonLeadDrift = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry,
	leader?: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	if (
		!leader?.caseTraceSnapshots?.length ||
		!entry.caseTraceSnapshots?.length
	) {
		return 'none';
	}

	const leaderCases = new Map(
		leader.caseTraceSnapshots.map((snapshot) => [snapshot.caseId, snapshot])
	);

	const drift = entry.caseTraceSnapshots
		.map((snapshot) => {
			const leaderSnapshot = leaderCases.get(snapshot.caseId);
			const currentLead = buildComparisonCaseLeadLabel(snapshot);
			const leaderLead = buildComparisonCaseLeadLabel(leaderSnapshot);
			if (!currentLead || !leaderLead || currentLead === leaderLead) {
				return undefined;
			}

			return `${snapshot.label ?? snapshot.caseId} ${leaderLead}→${currentLead}`;
		})
		.filter((value): value is string => typeof value === 'string')
		.slice(0, 3);

	return drift.length > 0 ? drift.join(' · ') : 'none';
};

const formatComparisonLeadMediaDrift = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry,
	leader?: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	if (
		!leader?.caseTraceSnapshots?.length ||
		!entry.caseTraceSnapshots?.length
	) {
		return 'none';
	}

	const leaderCases = new Map(
		leader.caseTraceSnapshots.map((snapshot) => [snapshot.caseId, snapshot])
	);

	const drift = entry.caseTraceSnapshots
		.map((snapshot) => {
			const leaderSnapshot = leaderCases.get(snapshot.caseId);
			const currentMediaCues = formatLeadMediaCueSummary({
				leadSpeakerCue: snapshot.leadSpeakerCue,
				leadSpeakerAttributionCue: snapshot.leadSpeakerAttributionCue,
				leadChannelCue: snapshot.leadChannelCue,
				leadChannelAttributionCue: snapshot.leadChannelAttributionCue,
				leadContinuityCue: snapshot.leadContinuityCue
			});
			const leaderMediaCues = formatLeadMediaCueSummary({
				leadSpeakerCue: leaderSnapshot?.leadSpeakerCue,
				leadSpeakerAttributionCue:
					leaderSnapshot?.leadSpeakerAttributionCue,
				leadChannelCue: leaderSnapshot?.leadChannelCue,
				leadChannelAttributionCue:
					leaderSnapshot?.leadChannelAttributionCue,
				leadContinuityCue: leaderSnapshot?.leadContinuityCue
			});
			if (
				currentMediaCues === 'none' ||
				leaderMediaCues === 'none' ||
				currentMediaCues === leaderMediaCues
			) {
				return undefined;
			}

			return `${snapshot.label ?? snapshot.caseId} ${leaderMediaCues}→${currentMediaCues}`;
		})
		.filter((value): value is string => typeof value === 'string')
		.slice(0, 3);

	return drift.length > 0 ? drift.join(' · ') : 'none';
};

const formatComparisonSQLitePlannerDrift = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry,
	leader?: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	if (
		!leader?.caseTraceSnapshots?.length ||
		!entry.caseTraceSnapshots?.length
	) {
		return 'none';
	}

	const leaderCases = new Map(
		leader.caseTraceSnapshots.map((snapshot) => [snapshot.caseId, snapshot])
	);

	const drift = entry.caseTraceSnapshots
		.map((snapshot) => {
			const leaderSnapshot = leaderCases.get(snapshot.caseId);
			const currentPlanner = formatSQLitePlannerCueSummary(snapshot);
			const leaderPlanner = formatSQLitePlannerCueSummary(leaderSnapshot);
			if (
				currentPlanner === 'none' ||
				leaderPlanner === 'none' ||
				currentPlanner === leaderPlanner
			) {
				return undefined;
			}

			return `${snapshot.label ?? snapshot.caseId} ${leaderPlanner}→${currentPlanner}`;
		})
		.filter((value): value is string => typeof value === 'string')
		.slice(0, 3);

	return drift.length > 0 ? drift.join(' · ') : 'none';
};

const formatComparisonPostgresPlannerDrift = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry,
	leader?: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	if (
		!leader?.caseTraceSnapshots?.length ||
		!entry.caseTraceSnapshots?.length
	) {
		return 'none';
	}

	const leaderCases = new Map(
		leader.caseTraceSnapshots.map((snapshot) => [snapshot.caseId, snapshot])
	);

	const drift = entry.caseTraceSnapshots
		.map((snapshot) => {
			const leaderSnapshot = leaderCases.get(snapshot.caseId);
			const currentPlanner = formatPostgresPlannerCueSummary(snapshot);
			const leaderPlanner =
				formatPostgresPlannerCueSummary(leaderSnapshot);
			if (
				currentPlanner === 'none' ||
				leaderPlanner === 'none' ||
				currentPlanner === leaderPlanner
			) {
				return undefined;
			}

			return `${snapshot.label ?? snapshot.caseId} ${leaderPlanner}→${currentPlanner}`;
		})
		.filter((value): value is string => typeof value === 'string')
		.slice(0, 3);

	return drift.length > 0 ? drift.join(' · ') : 'none';
};

const formatComparisonRoutingCueSummary = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const trace = entry.traceSummary;
	if (!trace) {
		return 'none';
	}

	const parts = [
		`modes ${formatTraceModes(trace.modes)}`,
		`balance ${formatSourceBalanceStrategies(trace.sourceBalanceStrategies)}`,
		`rewrites ${formatTraceRatio(trace.transformedCases, trace.totalCases)}`,
		`variants ${formatTraceRatio(trace.variantCases, trace.totalCases)}`
	].filter((value) => !value.endsWith('n/a'));

	return parts.length > 0 ? parts.join(' · ') : 'none';
};

const formatComparisonRoutingDrift = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry,
	leader?: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
) => {
	const trace = entry.traceSummary;
	const leaderTrace = leader?.traceSummary;
	if (!trace || !leaderTrace || entry === leader) {
		return 'none';
	}

	const deltas: string[] = [];
	const currentModes = formatTraceModes(trace.modes);
	const previousModes = formatTraceModes(leaderTrace.modes);
	if (currentModes !== previousModes) {
		deltas.push(`modes ${previousModes}→${currentModes}`);
	}

	const currentBalance = formatSourceBalanceStrategies(
		trace.sourceBalanceStrategies
	);
	const previousBalance = formatSourceBalanceStrategies(
		leaderTrace.sourceBalanceStrategies
	);
	if (currentBalance !== previousBalance) {
		deltas.push(`balance ${previousBalance}→${currentBalance}`);
	}

	const transformedDelta =
		trace.transformedCases - leaderTrace.transformedCases;
	if (transformedDelta !== 0) {
		deltas.push(`rewrites ${formatTraceCountDelta(transformedDelta)}`);
	}

	const variantDelta = trace.variantCases - leaderTrace.variantCases;
	if (variantDelta !== 0) {
		deltas.push(`variants ${formatTraceCountDelta(variantDelta)}`);
	}

	return deltas.length > 0 ? deltas.slice(0, 3).join(' · ') : 'none';
};

const formatHistoryRoutingShift = (history?: RAGEvaluationHistory) => {
	const delta = history?.diff?.traceSummaryDelta;
	if (!delta) {
		return 'none';
	}

	const shifts: string[] = [];
	if (delta.modesChanged) {
		shifts.push('modes changed');
	}
	if (delta.sourceBalanceStrategiesChanged) {
		shifts.push('balance changed');
	}
	if (delta.transformedCases !== 0) {
		shifts.push(
			`rewrites ${formatTraceCountDelta(delta.transformedCases)}`
		);
	}
	if (delta.variantCases !== 0) {
		shifts.push(`variants ${formatTraceCountDelta(delta.variantCases)}`);
	}

	return shifts.length > 0 ? shifts.join(' · ') : 'none';
};

const formatHistorySQLitePlannerShift = (history?: RAGEvaluationHistory) => {
	if (!history?.caseTraceSnapshots.length) {
		return 'none';
	}

	const shifts = history.caseTraceSnapshots
		.map((entry) => {
			const previousPlanner = formatSQLitePlannerCueSummary({
				sqliteQueryBackfillCount:
					entry.previousSqliteQueryBackfillCount,
				sqliteQueryCandidateBudgetExhausted:
					entry.previousSqliteQueryCandidateBudgetExhausted,
				sqliteQueryCandidateCoverage:
					entry.previousSqliteQueryCandidateCoverage,
				sqliteQueryFilteredCandidates:
					entry.previousSqliteQueryFilteredCandidates,
				sqliteQueryFinalSearchK: entry.previousSqliteQueryFinalSearchK,
				sqliteQueryInitialSearchK:
					entry.previousSqliteQueryInitialSearchK,
				sqliteQuerySearchExpansionRatio:
					entry.previousSqliteQuerySearchExpansionRatio,
				sqliteQueryJsRemainderClauseCount:
					entry.previousSqliteQueryJsRemainderClauseCount,
				sqliteQueryCandidateLimitUsed:
					entry.previousSqliteQueryCandidateLimitUsed,
				sqliteQueryMaxBackfillsUsed:
					entry.previousSqliteQueryMaxBackfillsUsed,
				sqliteQueryMinResultsUsed:
					entry.previousSqliteQueryMinResultsUsed,
				sqliteQueryFillPolicyUsed:
					entry.previousSqliteQueryFillPolicyUsed,
				sqliteQueryMode: entry.previousSqliteQueryMode,
				sqliteQueryPushdownApplied:
					entry.previousSqliteQueryPushdownApplied,
				sqliteQueryPushdownClauseCount:
					entry.previousSqliteQueryPushdownClauseCount,
				sqliteQueryPushdownCoverageRatio:
					entry.previousSqliteQueryPushdownCoverageRatio,
				sqliteQueryPushdownMode: entry.previousSqliteQueryPushdownMode,
				sqliteQueryTotalFilterClauseCount:
					entry.previousSqliteQueryTotalFilterClauseCount,
				sqliteQueryJsRemainderRatio:
					entry.previousSqliteQueryJsRemainderRatio,
				sqliteQueryReturnedCount:
					entry.previousSqliteQueryReturnedCount,
				sqliteQueryBackfillLimitReached:
					entry.previousSqliteQueryBackfillLimitReached,
				sqliteQueryMinResultsSatisfied:
					entry.previousSqliteQueryMinResultsSatisfied,
				sqliteQueryCandidateYieldRatio:
					entry.previousSqliteQueryCandidateYieldRatio,
				sqliteQueryTopKFillRatio:
					entry.previousSqliteQueryTopKFillRatio,
				sqliteQueryUnderfilledTopK:
					entry.previousSqliteQueryUnderfilledTopK
			});
			const currentPlanner = formatSQLitePlannerCueSummary(entry);

			if (
				previousPlanner === 'none' ||
				currentPlanner === 'none' ||
				previousPlanner === currentPlanner
			) {
				return undefined;
			}

			return `${entry.label ?? entry.caseId} ${previousPlanner}→${currentPlanner}`;
		})
		.filter((value): value is string => typeof value === 'string')
		.slice(0, 3);

	return shifts.length > 0 ? shifts.join(' · ') : 'none';
};

const formatHistoryPostgresPlannerShift = (history?: RAGEvaluationHistory) => {
	if (!history?.caseTraceSnapshots.length) {
		return 'none';
	}

	const shifts = history.caseTraceSnapshots
		.map((entry) => {
			const previousPlanner = formatPostgresPlannerCueSummary({
				postgresQueryBackfillCount:
					entry.previousPostgresQueryBackfillCount,
				postgresQueryCandidateBudgetExhausted:
					entry.previousPostgresQueryCandidateBudgetExhausted,
				postgresQueryCandidateCoverage:
					entry.previousPostgresQueryCandidateCoverage,
				postgresQueryFilteredCandidates:
					entry.previousPostgresQueryFilteredCandidates,
				postgresQueryFinalSearchK:
					entry.previousPostgresQueryFinalSearchK,
				postgresQueryInitialSearchK:
					entry.previousPostgresQueryInitialSearchK,
				postgresQuerySearchExpansionRatio:
					entry.previousPostgresQuerySearchExpansionRatio,
				postgresQueryJsRemainderClauseCount:
					entry.previousPostgresQueryJsRemainderClauseCount,
				postgresQueryCandidateLimitUsed:
					entry.previousPostgresQueryCandidateLimitUsed,
				postgresQueryMaxBackfillsUsed:
					entry.previousPostgresQueryMaxBackfillsUsed,
				postgresQueryMinResultsUsed:
					entry.previousPostgresQueryMinResultsUsed,
				postgresQueryFillPolicyUsed:
					entry.previousPostgresQueryFillPolicyUsed,
				postgresQueryMultiplierUsed:
					entry.previousPostgresQueryMultiplierUsed,
				postgresQueryMode: entry.previousPostgresQueryMode,
				postgresQueryPushdownApplied:
					entry.previousPostgresQueryPushdownApplied,
				postgresQueryPushdownClauseCount:
					entry.previousPostgresQueryPushdownClauseCount,
				postgresQueryPushdownCoverageRatio:
					entry.previousPostgresQueryPushdownCoverageRatio,
				postgresQueryPushdownMode:
					entry.previousPostgresQueryPushdownMode,
				postgresQueryTotalFilterClauseCount:
					entry.previousPostgresQueryTotalFilterClauseCount,
				postgresQueryJsRemainderRatio:
					entry.previousPostgresQueryJsRemainderRatio,
				postgresQueryReturnedCount:
					entry.previousPostgresQueryReturnedCount,
				postgresQueryBackfillLimitReached:
					entry.previousPostgresQueryBackfillLimitReached,
				postgresQueryMinResultsSatisfied:
					entry.previousPostgresQueryMinResultsSatisfied,
				postgresQueryCandidateYieldRatio:
					entry.previousPostgresQueryCandidateYieldRatio,
				postgresQueryTopKFillRatio:
					entry.previousPostgresQueryTopKFillRatio,
				postgresQueryUnderfilledTopK:
					entry.previousPostgresQueryUnderfilledTopK
			});
			const currentPlanner = formatPostgresPlannerCueSummary(entry);
			if (
				previousPlanner === 'none' ||
				currentPlanner === 'none' ||
				previousPlanner === currentPlanner
			) {
				return undefined;
			}

			return `${entry.label ?? entry.caseId} ${previousPlanner}→${currentPlanner}`;
		})
		.filter((value): value is string => typeof value === 'string')
		.slice(0, 3);

	return shifts.length > 0 ? shifts.join(' · ') : 'none';
};

const formatTraceLeadChanges = (
	changes?: Array<{
		caseId: string;
		label?: string;
		previousLead?: string;
		currentLead: string;
	}>
) =>
	changes && changes.length > 0
		? changes
				.slice(0, 3)
				.map((entry) => {
					const label = entry.label ?? entry.caseId;
					const previousLead = entry.previousLead ?? 'n/a';
					return `${label} ${previousLead}→${entry.currentLead}`;
				})
				.join(' · ')
		: 'none';

const formatGroundingHistoryCaseLabels = (
	cases: RAGAnswerGroundingEvaluationCaseDiff[]
) =>
	cases.length > 0
		? cases.map((entry) => entry.label ?? entry.caseId).join(', ')
		: 'none';

const formatRerankerComparisonHeadline = (entry: RAGRerankerComparisonEntry) =>
	[
		entry.label,
		`passing ${formatEvaluationPassingRate(entry.response.passingRate)}`,
		`f1 ${entry.response.summary.averageF1.toFixed(3)}`,
		`latency ${entry.response.summary.averageLatencyMs.toFixed(1)}ms`
	].join(' · ');

const formatRetrievalComparisonHeadline = (
	entry: RAGRetrievalComparisonEntry
) =>
	[
		entry.label,
		`mode ${entry.retrievalMode}`,
		`passing ${formatEvaluationPassingRate(entry.response.passingRate)}`,
		`f1 ${entry.response.summary.averageF1.toFixed(3)}`,
		`latency ${entry.response.summary.averageLatencyMs.toFixed(1)}ms`
	].join(' · ');

const formatTraceModes = (modes: RAGHybridRetrievalMode[]) =>
	modes.length > 0 ? modes.join(' / ') : 'n/a';

const formatSourceBalanceStrategies = (
	strategies: RAGSourceBalanceStrategy[]
) => (strategies.length > 0 ? strategies.join(' / ') : 'n/a');

const formatTraceStageSummary = (
	stageCounts: Partial<
		Record<RAGRetrievalTrace['steps'][number]['stage'], number>
	>
) => {
	const topStages = Object.entries(stageCounts)
		.sort((left, right) => right[1] - left[1])
		.slice(0, 3);

	return topStages.length > 0
		? topStages.map(([stage, count]) => `${stage} ${count}`).join(' · ')
		: 'n/a';
};

const formatTraceRatio = (count: number, total: number) => `${count}/${total}`;

const formatTraceCountDelta = (value: number) =>
	`${value >= 0 ? '+' : ''}${value}`;

const buildComparisonOverviewPresentation = <
	TEntry extends {
		label: string;
		response: {
			passingRate: number;
			summary: {
				averageF1: number;
				averageLatencyMs: number;
			};
		};
	}
>(input: {
	entries: TEntry[];
	summary: {
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
	resolveLabel: (id?: string) => string;
	resolveEntry: (id?: string) => TEntry | undefined;
}): RAGComparisonOverviewPresentation => {
	const winnerLabel = input.resolveLabel(input.summary.bestByPassingRate);
	const winnerEntry = input.resolveEntry(input.summary.bestByPassingRate);
	const rows: RAGLabelValueRow[] = [
		{
			label: 'Best passing rate',
			value: input.resolveLabel(input.summary.bestByPassingRate)
		},
		{
			label: 'Best average F1',
			value: input.resolveLabel(input.summary.bestByAverageF1)
		},
		{
			label: 'Fastest',
			value: input.resolveLabel(input.summary.fastest)
		}
	];

	if (input.summary.bestByMultivectorCollapsedCases) {
		rows.push({
			label: 'Best multivector collapse',
			value: input.resolveLabel(
				input.summary.bestByMultivectorCollapsedCases
			)
		});
	}
	if (input.summary.bestByMultivectorLexicalHitCases) {
		rows.push({
			label: 'Best multivector lexical hits',
			value: input.resolveLabel(
				input.summary.bestByMultivectorLexicalHitCases
			)
		});
	}
	if (input.summary.bestByMultivectorVectorHitCases) {
		rows.push({
			label: 'Best multivector vector hits',
			value: input.resolveLabel(
				input.summary.bestByMultivectorVectorHitCases
			)
		});
	}
	if (input.summary.bestByEvidenceReconcileCases) {
		rows.push({
			label: 'Best evidence reconcile',
			value: input.resolveLabel(
				input.summary.bestByEvidenceReconcileCases
			)
		});
	}
	if (input.summary.bestByPresentationTitleCueCases) {
		rows.push({
			label: 'Best presentation title cue',
			value: input.resolveLabel(
				input.summary.bestByPresentationTitleCueCases
			)
		});
	}
	if (input.summary.bestByPresentationBodyCueCases) {
		rows.push({
			label: 'Best presentation body cue',
			value: input.resolveLabel(
				input.summary.bestByPresentationBodyCueCases
			)
		});
	}
	if (input.summary.bestByPresentationNotesCueCases) {
		rows.push({
			label: 'Best presentation notes cue',
			value: input.resolveLabel(
				input.summary.bestByPresentationNotesCueCases
			)
		});
	}
	if (input.summary.bestBySpreadsheetSheetCueCases) {
		rows.push({
			label: 'Best spreadsheet sheet cue',
			value: input.resolveLabel(
				input.summary.bestBySpreadsheetSheetCueCases
			)
		});
	}
	if (input.summary.bestBySpreadsheetTableCueCases) {
		rows.push({
			label: 'Best spreadsheet table cue',
			value: input.resolveLabel(
				input.summary.bestBySpreadsheetTableCueCases
			)
		});
	}
	if (input.summary.bestBySpreadsheetColumnCueCases) {
		rows.push({
			label: 'Best spreadsheet column cue',
			value: input.resolveLabel(
				input.summary.bestBySpreadsheetColumnCueCases
			)
		});
	}
	if (input.summary.bestByOfficeEvidenceReconcileCases) {
		rows.push({
			label: 'Best office structure reconcile (docx/xlsx/pptx)',
			value: input.resolveLabel(
				input.summary.bestByOfficeEvidenceReconcileCases
			)
		});
	}
	if (input.summary.bestByOfficeParagraphEvidenceReconcileCases) {
		rows.push({
			label: 'Best office narrative reconcile',
			value: input.resolveLabel(
				input.summary.bestByOfficeParagraphEvidenceReconcileCases
			)
		});
	}
	if (input.summary.bestByOfficeListEvidenceReconcileCases) {
		rows.push({
			label: 'Best office checklist reconcile',
			value: input.resolveLabel(
				input.summary.bestByOfficeListEvidenceReconcileCases
			)
		});
	}
	if (input.summary.bestByOfficeTableEvidenceReconcileCases) {
		rows.push({
			label: 'Best office table reconcile',
			value: input.resolveLabel(
				input.summary.bestByOfficeTableEvidenceReconcileCases
			)
		});
	}
	if (input.summary.bestByPDFEvidenceReconcileCases) {
		rows.push({
			label: 'Best PDF native evidence',
			value: input.resolveLabel(
				input.summary.bestByPDFEvidenceReconcileCases
			)
		});
	}
	if (input.summary.bestByLowestRuntimeCandidateBudgetExhaustedCases) {
		rows.push({
			label: 'Lowest runtime budget exhaustion',
			value: input.resolveLabel(
				input.summary.bestByLowestRuntimeCandidateBudgetExhaustedCases
			)
		});
	}
	if (input.summary.bestByLowestRuntimeUnderfilledTopKCases) {
		rows.push({
			label: 'Lowest runtime underfilled TopK',
			value: input.resolveLabel(
				input.summary.bestByLowestRuntimeUnderfilledTopKCases
			)
		});
	}

	return {
		rows,
		winnerLabel,
		summary: winnerEntry
			? `passing ${formatEvaluationPassingRate(winnerEntry.response.passingRate)} · f1 ${winnerEntry.response.summary.averageF1.toFixed(3)} · latency ${winnerEntry.response.summary.averageLatencyMs.toFixed(1)}ms`
			: 'Stored benchmark comparison'
	};
};

export const buildRAGComparisonTraceSummaryRows = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
): RAGLabelValueRow[] => {
	const trace = entry.traceSummary;
	const rows: RAGLabelValueRow[] = [
		{
			label: 'Lead cues',
			value: formatComparisonLeadCueSummary(entry)
		},
		{
			label: 'Lead media cues',
			value: formatComparisonLeadMediaCueSummary(entry)
		},
		{
			label: 'Presentation cues',
			value: formatComparisonPresentationCueSummary(entry)
		},
		{
			label: 'SQLite planner cues',
			value: formatComparisonSQLitePlannerCueSummary(entry)
		},
		{
			label: 'Postgres planner cues',
			value: formatComparisonPostgresPlannerCueSummary(entry)
		},
		{
			label: 'Routing cues',
			value: formatComparisonRoutingCueSummary(entry)
		}
	];

	if (!trace) {
		rows.unshift({ label: 'Trace', value: 'Unavailable' });
		return rows;
	}

	rows.push(
		{ label: 'Modes', value: formatTraceModes(trace.modes) },
		{
			label: 'Balance',
			value: formatSourceBalanceStrategies(trace.sourceBalanceStrategies)
		},
		{ label: 'Avg final', value: trace.averageFinalCount.toFixed(1) },
		{ label: 'Avg vector', value: trace.averageVectorCount.toFixed(1) },
		{ label: 'Avg lexical', value: trace.averageLexicalCount.toFixed(1) },
		{
			label: 'Balanced',
			value: formatTraceRatio(trace.balancedCases, trace.totalCases)
		},
		{
			label: 'Round robin',
			value: formatTraceRatio(trace.roundRobinCases, trace.totalCases)
		},
		{
			label: 'Transforms',
			value: formatTraceRatio(trace.transformedCases, trace.totalCases)
		},
		{
			label: 'Variants',
			value: formatTraceRatio(trace.variantCases, trace.totalCases)
		},
		{
			label: 'Multivector',
			value: `${formatTraceRatio(
				trace.multiVectorCases,
				trace.totalCases
			)} · collapse ${formatTraceRatio(
				trace.multiVectorCollapsedCases,
				trace.totalCases
			)} · lexical ${formatTraceRatio(
				trace.multiVectorLexicalHitCases,
				trace.totalCases
			)} · vector ${formatTraceRatio(
				trace.multiVectorVectorHitCases,
				trace.totalCases
			)}`
		},
		{
			label: 'Runtime',
			value: `budget ${formatTraceRatio(
				trace.runtimeCandidateBudgetExhaustedCases,
				trace.totalCases
			)} · underfilled ${formatTraceRatio(
				trace.runtimeUnderfilledTopKCases,
				trace.totalCases
			)}`
		},
		{
			label: 'Evidence reconcile (office/pdf)',
			value: `all ${formatTraceRatio(
				trace.stageCounts.evidence_reconcile ?? 0,
				trace.totalCases
			)} · office structure ${formatTraceRatio(
				trace.officeEvidenceReconcileCases,
				trace.totalCases
			)} · narrative ${formatTraceRatio(
				trace.officeParagraphEvidenceReconcileCases ?? 0,
				trace.totalCases
			)} · checklist ${formatTraceRatio(
				trace.officeListEvidenceReconcileCases ?? 0,
				trace.totalCases
			)} · table ${formatTraceRatio(
				trace.officeTableEvidenceReconcileCases ?? 0,
				trace.totalCases
			)} · pdf native ${formatTraceRatio(
				trace.pdfEvidenceReconcileCases,
				trace.totalCases
			)}`
		},
		{
			label: 'TopK',
			value: `${trace.averageCandidateTopK.toFixed(
				1
			)} / ${trace.averageLexicalTopK.toFixed(1)}`
		},
		{
			label: 'Stages',
			value: formatTraceStageSummary(trace.stageCounts)
		}
	);

	return rows;
};

export const buildRAGComparisonTraceDiffRows = (
	entry: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry,
	leader?: RAGRerankerComparisonEntry | RAGRetrievalComparisonEntry
): RAGLabelValueRow[] => {
	const trace = entry.traceSummary;
	const leadDriftRow = {
		label: 'Lead drift vs leader',
		value: formatComparisonLeadDrift(entry, leader)
	} satisfies RAGLabelValueRow;
	const leadMediaDriftRow = {
		label: 'Lead media shift vs leader',
		value: formatComparisonLeadMediaDrift(entry, leader)
	} satisfies RAGLabelValueRow;
	const sqlitePlannerDriftRow = {
		label: 'SQLite planner shift vs leader',
		value: formatComparisonSQLitePlannerDrift(entry, leader)
	} satisfies RAGLabelValueRow;
	const postgresPlannerDriftRow = {
		label: 'Postgres planner shift vs leader',
		value: formatComparisonPostgresPlannerDrift(entry, leader)
	} satisfies RAGLabelValueRow;
	const routingDriftRow = {
		label: 'Routing shift vs leader',
		value: formatComparisonRoutingDrift(entry, leader)
	} satisfies RAGLabelValueRow;

	if (!trace) {
		return [
			{ label: 'Trace', value: 'Unavailable for comparison' },
			leadDriftRow,
			leadMediaDriftRow,
			sqlitePlannerDriftRow,
			postgresPlannerDriftRow,
			routingDriftRow
		];
	}

	const leaderTrace = leader?.traceSummary;
	if (!leaderTrace) {
		return [
			{ label: 'Baseline', value: 'Leader trace unavailable' },
			leadDriftRow,
			leadMediaDriftRow,
			sqlitePlannerDriftRow,
			postgresPlannerDriftRow,
			routingDriftRow
		];
	}

	if (entry === leader) {
		return [
			{ label: 'Baseline', value: 'Leader strategy' },
			leadDriftRow,
			leadMediaDriftRow,
			sqlitePlannerDriftRow,
			postgresPlannerDriftRow,
			routingDriftRow
		];
	}

	const stageDelta = Object.keys({
		...leaderTrace.stageCounts,
		...trace.stageCounts
	})
		.map((stage) => {
			const typedStage = stage as RAGRetrievalTraceStep['stage'];
			const delta =
				(trace.stageCounts[typedStage] ?? 0) -
				(leaderTrace.stageCounts[typedStage] ?? 0);
			return delta === 0
				? null
				: `${typedStage} ${formatTraceCountDelta(delta)}`;
		})
		.filter((value): value is string => Boolean(value))
		.slice(0, 3)
		.join(' · ');

	const rows: RAGLabelValueRow[] = [
		{ label: 'Baseline', value: leader.label }
	];

	if (formatTraceModes(trace.modes) !== formatTraceModes(leaderTrace.modes)) {
		rows.push({
			label: 'Modes vs leader',
			value: `${formatTraceModes(trace.modes)} vs ${formatTraceModes(
				leaderTrace.modes
			)}`
		});
	}

	if (
		formatSourceBalanceStrategies(trace.sourceBalanceStrategies) !==
		formatSourceBalanceStrategies(leaderTrace.sourceBalanceStrategies)
	) {
		rows.push({
			label: 'Balance vs leader',
			value: `${formatSourceBalanceStrategies(
				trace.sourceBalanceStrategies
			)} vs ${formatSourceBalanceStrategies(
				leaderTrace.sourceBalanceStrategies
			)}`
		});
	}

	rows.push(
		leadDriftRow,
		leadMediaDriftRow,
		sqlitePlannerDriftRow,
		postgresPlannerDriftRow,
		routingDriftRow
	);

	rows.push(
		{
			label: 'Final delta',
			value: formatSignedDelta(
				trace.averageFinalCount - leaderTrace.averageFinalCount,
				1
			)
		},
		{
			label: 'Vector delta',
			value: formatSignedDelta(
				trace.averageVectorCount - leaderTrace.averageVectorCount,
				1
			)
		},
		{
			label: 'Lexical delta',
			value: formatSignedDelta(
				trace.averageLexicalCount - leaderTrace.averageLexicalCount,
				1
			)
		},
		{
			label: 'Transform delta',
			value: formatTraceCountDelta(
				trace.transformedCases - leaderTrace.transformedCases
			)
		},
		{
			label: 'Balanced delta',
			value: formatTraceCountDelta(
				trace.balancedCases - leaderTrace.balancedCases
			)
		},
		{
			label: 'Round robin delta',
			value: formatTraceCountDelta(
				trace.roundRobinCases - leaderTrace.roundRobinCases
			)
		},
		{
			label: 'Runtime budget delta',
			value: formatTraceCountDelta(
				trace.runtimeCandidateBudgetExhaustedCases -
					leaderTrace.runtimeCandidateBudgetExhaustedCases
			)
		},
		{
			label: 'Runtime underfilled delta',
			value: formatTraceCountDelta(
				trace.runtimeUnderfilledTopKCases -
					leaderTrace.runtimeUnderfilledTopKCases
			)
		}
	);

	if (stageDelta) {
		rows.push({ label: 'Stage delta', value: stageDelta });
	}

	return rows;
};

export const buildRAGRetrievalComparisonPresentations = (
	comparison: RAGRetrievalComparison
): RAGComparisonPresentation[] => {
	const leader = comparison.entries[0];
	return comparison.entries.map((entry) => ({
		diffLabel: leader?.label ?? 'Leader',
		diffRows: buildRAGComparisonTraceDiffRows(entry, leader),
		summary: formatRetrievalComparisonHeadline(entry),
		id: entry.retrievalId,
		label: entry.label,
		traceSummaryRows: buildRAGComparisonTraceSummaryRows(entry)
	}));
};

export const buildRAGRetrievalComparisonOverviewPresentation = (
	comparison: RAGRetrievalComparison
): RAGComparisonOverviewPresentation =>
	buildComparisonOverviewPresentation({
		entries: comparison.entries,
		resolveEntry: (id?: string) =>
			comparison.entries.find((entry) => entry.retrievalId === id),
		resolveLabel: (id?: string) =>
			comparison.entries.find((entry) => entry.retrievalId === id)
				?.label ??
			id ??
			'n/a',
		summary: comparison.summary
	});

export const buildRAGRerankerComparisonPresentations = (
	comparison: RAGRerankerComparison
): RAGComparisonPresentation[] => {
	const leader = comparison.entries[0];
	return comparison.entries.map((entry) => ({
		diffLabel: leader?.label ?? 'Leader',
		diffRows: buildRAGComparisonTraceDiffRows(entry, leader),
		summary: formatRerankerComparisonHeadline(entry),
		id: entry.rerankerId,
		label: entry.label,
		traceSummaryRows: buildRAGComparisonTraceSummaryRows(entry)
	}));
};

export const buildRAGRerankerComparisonOverviewPresentation = (
	comparison: RAGRerankerComparison
): RAGComparisonOverviewPresentation =>
	buildComparisonOverviewPresentation({
		entries: comparison.entries,
		resolveEntry: (id?: string) =>
			comparison.entries.find((entry) => entry.rerankerId === id),
		resolveLabel: (id?: string) =>
			comparison.entries.find((entry) => entry.rerankerId === id)
				?.label ??
			id ??
			'n/a',
		summary: comparison.summary
	});

export const buildRAGGroundingProviderPresentations = (
	entries: Array<{
		providerKey: string;
		label: string;
		elapsedMs: number;
		response: RAGAnswerGroundingEvaluationResponse;
	}>
): RAGGroundingProviderPresentation[] =>
	entries.map((entry) => ({
		summary: [
			entry.label,
			`passing ${formatEvaluationPassingRate(entry.response.passingRate)}`,
			`citation f1 ${entry.response.summary.averageCitationF1.toFixed(3)}`,
			`resolved ${formatEvaluationPassingRate(
				entry.response.summary.averageResolvedCitationRate
			)}`,
			`latency ${entry.elapsedMs.toFixed(1)}ms`
		].join(' · '),
		id: entry.providerKey,
		label: entry.label
	}));

export const buildRAGGroundingProviderOverviewPresentation = (input: {
	entries: Array<{
		providerKey: string;
		label: string;
		elapsedMs: number;
		response: RAGAnswerGroundingEvaluationResponse;
	}>;
	summary: {
		bestByPassingRate?: string;
		bestByAverageCitationF1?: string;
		bestByResolvedCitationRate?: string;
		fastest?: string;
	};
}): RAGGroundingProviderOverviewPresentation => {
	const resolveLabel = (key?: string) =>
		input.entries.find((entry) => entry.providerKey === key)?.label ??
		key ??
		'n/a';
	const winnerLabel = resolveLabel(input.summary.bestByPassingRate);
	const winnerEntry = input.entries.find(
		(entry) => entry.providerKey === input.summary.bestByPassingRate
	);

	return {
		rows: [
			{
				label: 'Best passing rate',
				value: resolveLabel(input.summary.bestByPassingRate)
			},
			{
				label: 'Best citation F1',
				value: resolveLabel(input.summary.bestByAverageCitationF1)
			},
			{
				label: 'Best resolved citations',
				value: resolveLabel(input.summary.bestByResolvedCitationRate)
			},
			{
				label: 'Fastest',
				value: resolveLabel(input.summary.fastest)
			}
		],
		winnerLabel,
		summary: winnerEntry
			? `passing ${formatEvaluationPassingRate(winnerEntry.response.passingRate)} · citation f1 ${winnerEntry.response.summary.averageCitationF1.toFixed(3)} · resolved ${formatEvaluationPassingRate(winnerEntry.response.summary.averageResolvedCitationRate)}`
			: 'Stored workflow evaluation'
	};
};

export const buildRAGRetrievalOverviewPresentation = (
	comparison: RAGRetrievalComparison
): RAGQualityOverviewPresentation => ({
	rows: buildRAGRetrievalComparisonOverviewPresentation(comparison).rows
});

export const buildRAGRerankerOverviewPresentation = (
	comparison: RAGRerankerComparison
): RAGQualityOverviewPresentation => ({
	rows: buildRAGRerankerComparisonOverviewPresentation(comparison).rows
});

export const buildRAGGroundingOverviewPresentation = (input: {
	groundingEvaluation: RAGAnswerGroundingEvaluationResponse;
	groundingProviderOverview?: RAGGroundingProviderOverviewPresentation | null;
}): RAGGroundingOverviewPresentation => ({
	rows: [
		{
			label: 'Grounding',
			value: formatGroundingHistorySummaryValue(input.groundingEvaluation)
		},
		...(input.groundingProviderOverview?.rows ?? [
			{
				label: 'Grounding providers',
				value: 'Configure an AI provider to compare grounded answers.'
			}
		])
	]
});

export const buildRAGQualityOverviewPresentation = (input: {
	retrievalComparison: RAGRetrievalComparison;
	rerankerComparison: RAGRerankerComparison;
	groundingEvaluation: RAGAnswerGroundingEvaluationResponse;
	groundingProviderOverview?: RAGGroundingProviderOverviewPresentation | null;
}): RAGQualityOverviewPresentation => ({
	rows: [
		...buildRAGRetrievalOverviewPresentation(input.retrievalComparison)
			.rows,
		...buildRAGRerankerOverviewPresentation(input.rerankerComparison).rows,
		...buildRAGGroundingOverviewPresentation({
			groundingEvaluation: input.groundingEvaluation,
			groundingProviderOverview: input.groundingProviderOverview
		}).rows
	]
});

export const buildRAGGroundingProviderCaseComparisonPresentations = (
	comparisons: Array<{
		caseId: string;
		label: string;
		entries: Array<{
			providerKey: string;
			label: string;
			status: string;
			coverage: string;
			citationF1: number;
			resolvedCitationRate: number;
			matchedIds: string[];
			missingIds: string[];
			extraIds: string[];
			answerExcerpt: string;
		}>;
		summary: {
			bestByStatus?: string;
			bestByCitationF1?: string;
			bestByResolvedCitationRate?: string;
		};
	}>
): RAGGroundingProviderCaseComparisonPresentation[] =>
	comparisons.map((comparison) => {
		const resolveLabel = (key?: string) =>
			comparison.entries.find((entry) => entry.providerKey === key)
				?.label ??
			key ??
			'n/a';

		return {
			caseId: comparison.caseId,
			label: comparison.label,
			rows: [
				{
					label: 'Best grounded',
					value: resolveLabel(comparison.summary.bestByStatus)
				},
				{
					label: 'Best citation F1',
					value: resolveLabel(comparison.summary.bestByCitationF1)
				},
				{
					label: 'Best resolved citations',
					value: resolveLabel(
						comparison.summary.bestByResolvedCitationRate
					)
				},
				...comparison.entries.map((entry) => ({
					label: entry.label,
					value: [
						entry.status.toUpperCase(),
						`coverage ${entry.coverage}`,
						`f1 ${entry.citationF1.toFixed(3)}`,
						`resolved ${formatEvaluationPassingRate(
							entry.resolvedCitationRate
						)}`,
						`matched ${entry.matchedIds.join(', ') || 'none'}`,
						`missing ${entry.missingIds.join(', ') || 'none'}`,
						`extra ${entry.extraIds.join(', ') || 'none'}`,
						`answer ${entry.answerExcerpt || 'n/a'}`
					].join(' · ')
				}))
			],
			summary: [
				`Best grounded: ${resolveLabel(comparison.summary.bestByStatus)}`,
				`Best citation F1: ${resolveLabel(
					comparison.summary.bestByCitationF1
				)}`,
				`Best resolved citations: ${resolveLabel(
					comparison.summary.bestByResolvedCitationRate
				)}`
			].join(' · ')
		};
	});

export const buildRAGEvaluationHistoryRows = (
	history?: RAGEvaluationHistory
): RAGLabelValueRow[] => {
	if (!history?.latestRun) {
		return [
			{ label: 'History', value: 'No persisted benchmark runs yet.' }
		];
	}

	const rows: RAGLabelValueRow[] = [
		{ label: 'Runs recorded', value: String(history.runs.length) },
		{
			label: 'Latest',
			value: `${history.latestRun.label} · ${formatEvaluationSummary(
				history.latestRun.response
			)}`
		}
	];

	if (history.latestRun.traceSummary) {
		rows.push({
			label: 'Latest trace',
			value: `${formatTraceModes(
				history.latestRun.traceSummary.modes
			)} · balance ${formatSourceBalanceStrategies(
				history.latestRun.traceSummary.sourceBalanceStrategies
			)} · final ${history.latestRun.traceSummary.averageFinalCount.toFixed(
				1
			)} · vector ${history.latestRun.traceSummary.averageVectorCount.toFixed(
				1
			)} · lexical ${history.latestRun.traceSummary.averageLexicalCount.toFixed(
				1
			)}`
		});
	}

	if (history.previousRun) {
		rows.push({
			label: 'Previous',
			value: `${history.previousRun.label} · ${formatEvaluationSummary(
				history.previousRun.response
			)}`
		});
	}

	if (!history.diff) {
		rows.push({
			label: 'History diff',
			value: 'Run the benchmark again to diff regressions over time.'
		});
		return rows;
	}

	rows.push(
		{
			label: 'Passing delta',
			value: formatSignedDelta(
				history.diff.summaryDelta.passingRate,
				1,
				'%'
			)
		},
		{
			label: 'Average F1 delta',
			value: formatSignedDelta(history.diff.summaryDelta.averageF1, 3)
		},
		{
			label: 'Latency delta',
			value: formatSignedDelta(
				history.diff.summaryDelta.averageLatencyMs,
				1,
				'ms'
			)
		},
		{
			label: 'Improved',
			value: formatHistoryCaseLabels(history.diff.improvedCases)
		},
		{
			label: 'Regressed',
			value: formatHistoryCaseLabels(history.diff.regressedCases)
		},
		{
			label: 'Lead drift',
			value: formatTraceLeadChanges(history.diff.traceLeadChanges)
		},
		{
			label: 'SQLite planner shift',
			value: formatHistorySQLitePlannerShift(history)
		},
		{
			label: 'Postgres planner shift',
			value: formatHistoryPostgresPlannerShift(history)
		},
		{
			label: 'Trace routing shift',
			value: formatHistoryRoutingShift(history)
		}
	);

	if (history.previousRun) {
		const currentEntityView = buildRAGEvaluationEntityQualityView(
			history.latestRun.response
		);
		const previousEntityView = buildRAGEvaluationEntityQualityView(
			history.previousRun.response
		);
		rows.push(
			{
				label: 'Source regression hotspots',
				value: formatEntityRegressionHotspots(
					currentEntityView.bySource,
					previousEntityView.bySource,
					(entry) => entry.averageF1,
					'f1'
				)
			},
			{
				label: 'Document regression hotspots',
				value: formatEntityRegressionHotspots(
					currentEntityView.byDocument,
					previousEntityView.byDocument,
					(entry) => entry.averageF1,
					'f1'
				)
			}
		);
	}

	if (history.diff.traceSummaryDelta) {
		rows.push(
			{
				label: 'Trace mode shift',
				value: history.diff.traceSummaryDelta.modesChanged
					? 'changed'
					: 'stable'
			},
			{
				label: 'Trace balance shift',
				value: history.diff.traceSummaryDelta
					.sourceBalanceStrategiesChanged
					? 'changed'
					: 'stable'
			},
			{
				label: 'Trace final delta',
				value: formatSignedDelta(
					history.diff.traceSummaryDelta.averageFinalCount,
					1
				)
			},
			{
				label: 'Trace vector delta',
				value: formatSignedDelta(
					history.diff.traceSummaryDelta.averageVectorCount,
					1
				)
			},
			{
				label: 'Trace lexical delta',
				value: formatSignedDelta(
					history.diff.traceSummaryDelta.averageLexicalCount,
					1
				)
			},
			{
				label: 'Trace balanced delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta.balancedCases
				)
			},
			{
				label: 'Trace round robin delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta.roundRobinCases
				)
			},
			{
				label: 'Trace transform delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta.transformedCases
				)
			},
			{
				label: 'Trace variant delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta.variantCases
				)
			}
		);

		const evidenceReconcileDelta =
			history.diff.traceSummaryDelta.stageCounts?.evidence_reconcile;
		if (typeof evidenceReconcileDelta === 'number') {
			rows.push({
				label: 'Trace evidence reconcile delta (all)',
				value: formatTraceCountDelta(evidenceReconcileDelta)
			});
		}
		if (
			typeof history.diff.traceSummaryDelta
				.officeEvidenceReconcileCasesDelta === 'number'
		) {
			rows.push({
				label: 'Trace office structure evidence reconcile delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta
						.officeEvidenceReconcileCasesDelta
				)
			});
		}
		if (
			typeof history.diff.traceSummaryDelta
				.officeParagraphEvidenceReconcileCasesDelta === 'number'
		) {
			rows.push({
				label: 'Trace office narrative evidence reconcile delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta
						.officeParagraphEvidenceReconcileCasesDelta
				)
			});
		}
		if (
			typeof history.diff.traceSummaryDelta
				.officeListEvidenceReconcileCasesDelta === 'number'
		) {
			rows.push({
				label: 'Trace office checklist evidence reconcile delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta
						.officeListEvidenceReconcileCasesDelta
				)
			});
		}
		if (
			typeof history.diff.traceSummaryDelta
				.officeTableEvidenceReconcileCasesDelta === 'number'
		) {
			rows.push({
				label: 'Trace office table evidence reconcile delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta
						.officeTableEvidenceReconcileCasesDelta
				)
			});
		}
		const officeReconcileDeltas = [
			typeof history.diff.traceSummaryDelta
				.officeParagraphEvidenceReconcileCasesDelta === 'number'
				? `narrative=${formatTraceCountDelta(
						history.diff.traceSummaryDelta
							.officeParagraphEvidenceReconcileCasesDelta
					)}`
				: null,
			typeof history.diff.traceSummaryDelta
				.officeListEvidenceReconcileCasesDelta === 'number'
				? `checklist=${formatTraceCountDelta(
						history.diff.traceSummaryDelta
							.officeListEvidenceReconcileCasesDelta
					)}`
				: null,
			typeof history.diff.traceSummaryDelta
				.officeTableEvidenceReconcileCasesDelta === 'number'
				? `table=${formatTraceCountDelta(
						history.diff.traceSummaryDelta
							.officeTableEvidenceReconcileCasesDelta
					)}`
				: null
		].filter((value): value is string => Boolean(value));
		if (officeReconcileDeltas.length > 0) {
			rows.push({
				label: 'Trace office reconcile deltas',
				value: officeReconcileDeltas.join(', ')
			});
		}
		if (
			typeof history.diff.traceSummaryDelta
				.pdfEvidenceReconcileCasesDelta === 'number'
		) {
			rows.push({
				label: 'Trace PDF native evidence reconcile delta',
				value: formatTraceCountDelta(
					history.diff.traceSummaryDelta
						.pdfEvidenceReconcileCasesDelta
				)
			});
		}

		const stageDelta = Object.entries(
			history.diff.traceSummaryDelta.stageCounts ?? {}
		)
			.map(([stage, count]) => `${stage} ${formatTraceCountDelta(count)}`)
			.join(', ');

		if (stageDelta) {
			rows.push({ label: 'Trace stage delta', value: stageDelta });
		}
	}

	if (history.caseTraceSnapshots.length > 0) {
		const changedCases = history.caseTraceSnapshots.filter(
			(entry) => entry.traceChange === 'changed'
		);
		rows.push({
			label: 'Trace drift cases',
			value:
				changedCases.length > 0
					? changedCases
							.map((entry) => entry.label ?? entry.caseId)
							.slice(0, 4)
							.join(', ')
					: 'none'
		});
		rows.push({
			label: 'Lead media cues',
			value:
				Array.from(
					new Set(
						history.caseTraceSnapshots
							.map((entry) =>
								formatLeadMediaCueSummary({
									leadChannelAttributionCue:
										entry.leadChannelAttributionCue,
									leadChannelCue: entry.leadChannelCue,
									leadContinuityCue: entry.leadContinuityCue,
									leadSpeakerAttributionCue:
										entry.leadSpeakerAttributionCue,
									leadSpeakerCue: entry.leadSpeakerCue
								})
							)
							.filter((value) => value !== 'none')
					)
				)
					.slice(0, 3)
					.join(' · ') || 'none'
		});
		rows.push({
			label: 'Presentation cues',
			value:
				Array.from(
					new Set(
						history.caseTraceSnapshots
							.map((entry) =>
								formatLeadPresentationCue(
									entry.leadPresentationCue
								)
							)
							.filter((value) => value !== 'none')
					)
				)
					.slice(0, 3)
					.join(' / ') || 'none'
		});
	}

	return rows;
};

export const buildRAGEvaluationCaseTracePresentations = (
	history?: RAGEvaluationHistory
): RAGEvaluationCaseTracePresentation[] => {
	if (!history?.caseTraceSnapshots.length) {
		return [];
	}

	return history.caseTraceSnapshots.map((entry) => {
		const label = entry.label ?? entry.caseId;
		const currentMode = entry.traceMode ?? 'no-trace';
		const previousMode = entry.previousTraceMode ?? 'n/a';
		const currentBalance = entry.sourceBalanceStrategy ?? 'cap';
		const previousBalance = entry.previousSourceBalanceStrategy ?? 'n/a';
		const currentVariants =
			entry.variantQueries.length > 0
				? entry.variantQueries.join(', ')
				: 'none';
		const previousVariants =
			entry.previousVariantQueries.length > 0
				? entry.previousVariantQueries.join(', ')
				: 'none';
		const currentStages =
			Object.keys(entry.stageCounts).length > 0
				? Object.entries(entry.stageCounts)
						.map(([stage, count]) => `${stage} ${count}`)
						.join(', ')
				: 'none';
		const previousStages =
			Object.keys(entry.previousStageCounts).length > 0
				? Object.entries(entry.previousStageCounts)
						.map(([stage, count]) => `${stage} ${count}`)
						.join(', ')
				: 'none';
		const currentLeadContext = entry.topContextLabel ?? 'n/a';
		const previousLeadContext = entry.previousTopContextLabel ?? 'n/a';
		const currentLeadLocation = entry.topLocatorLabel ?? 'n/a';
		const previousLeadLocation = entry.previousTopLocatorLabel ?? 'n/a';
		const currentBoundary = entry.sourceAwareChunkReasonLabel ?? 'n/a';
		const previousBoundary =
			entry.previousSourceAwareChunkReasonLabel ?? 'n/a';
		const currentScope = entry.sourceAwareUnitScopeLabel ?? 'n/a';
		const previousScope = entry.previousSourceAwareUnitScopeLabel ?? 'n/a';
		const currentMediaCues = formatLeadMediaCueSummary({
			leadChannelAttributionCue: entry.leadChannelAttributionCue,
			leadChannelCue: entry.leadChannelCue,
			leadContinuityCue: entry.leadContinuityCue,
			leadSpeakerAttributionCue: entry.leadSpeakerAttributionCue,
			leadSpeakerCue: entry.leadSpeakerCue
		});
		const previousMediaCues = formatLeadMediaCueSummary({
			leadChannelAttributionCue: entry.previousLeadChannelAttributionCue,
			leadChannelCue: entry.previousLeadChannelCue,
			leadContinuityCue: entry.previousLeadContinuityCue,
			leadSpeakerAttributionCue: entry.previousLeadSpeakerAttributionCue,
			leadSpeakerCue: entry.previousLeadSpeakerCue
		});
		const currentPresentationCue = formatLeadPresentationCue(
			entry.leadPresentationCue
		);
		const previousPresentationCue = formatLeadPresentationCue(
			entry.previousLeadPresentationCue
		);
		const leadSummary =
			entry.topLocatorLabel ??
			entry.topContextLabel ??
			entry.sourceAwareUnitScopeLabel ??
			'n/a';
		const previousLeadSummary =
			entry.previousTopLocatorLabel ??
			entry.previousTopContextLabel ??
			entry.previousSourceAwareUnitScopeLabel ??
			'n/a';

		return {
			caseId: entry.caseId,
			label,
			summary: `${entry.traceChange} · ${previousMode}→${currentMode} · ${previousBalance}→${currentBalance} · lead ${previousLeadSummary}→${leadSummary} · final ${
				entry.previousFinalCount ?? 0
			}→${entry.finalCount}`,
			traceChange: entry.traceChange,
			rows: [
				{ label: 'Query', value: entry.query },
				{ label: 'Trace change', value: entry.traceChange },
				{ label: 'Mode', value: `${previousMode}→${currentMode}` },
				{
					label: 'Balance',
					value: `${previousBalance}→${currentBalance}`
				},
				{
					label: 'Transformed query',
					value: `${
						entry.previousTransformedQuery?.trim() || 'n/a'
					}→${entry.transformedQuery?.trim() || 'n/a'}`
				},
				{
					label: 'Final',
					value: `${entry.previousFinalCount ?? 0}→${entry.finalCount}`
				},
				{
					label: 'Vector',
					value: `${entry.previousVectorCount ?? 0}→${entry.vectorCount}`
				},
				{
					label: 'Lexical',
					value: `${entry.previousLexicalCount ?? 0}→${entry.lexicalCount}`
				},
				{
					label: 'Candidate topK',
					value: `${entry.previousCandidateTopK ?? 0}→${entry.candidateTopK}`
				},
				{
					label: 'Lexical topK',
					value: `${entry.previousLexicalTopK ?? 0}→${entry.lexicalTopK}`
				},
				{
					label: 'Variants',
					value: `${previousVariants}→${currentVariants}`
				},
				{
					label: 'Lead context',
					value: `${previousLeadContext}→${currentLeadContext}`
				},
				{
					label: 'Lead location',
					value: `${previousLeadLocation}→${currentLeadLocation}`
				},
				{
					label: 'Chunk boundary',
					value: `${previousBoundary}→${currentBoundary}`
				},
				{
					label: 'Source-aware scope',
					value: `${previousScope}→${currentScope}`
				},
				{
					label: 'Lead media cues',
					value: `${previousMediaCues}→${currentMediaCues}`
				},
				{
					label: 'Lead presentation cues',
					value: `${previousPresentationCue}→${currentPresentationCue}`
				},
				{
					label: 'Stages',
					value: `${previousStages}→${currentStages}`
				},
				{ label: 'Status', value: entry.status }
			]
		};
	});
};

export const buildRAGEvaluationHistoryPresentation = (
	history?: RAGEvaluationHistory
): RAGEvaluationHistoryPresentation => ({
	caseTraces: buildRAGEvaluationCaseTracePresentations(history),
	rows: buildRAGEvaluationHistoryRows(history),
	summary: history?.latestRun
		? history.latestRun.label
		: 'No persisted benchmark runs yet.'
});

export const buildRAGEvaluationSuiteSnapshotRows = (
	history?: RAGEvaluationSuiteSnapshotHistory
): RAGLabelValueRow[] => {
	if (!history?.latestSnapshot) {
		return [
			{ label: 'Suite snapshots', value: 'No saved suite snapshots yet.' }
		];
	}

	const rows: RAGLabelValueRow[] = [
		{
			label: 'Snapshots recorded',
			value: String(history.snapshots.length)
		},
		{
			label: 'Latest snapshot',
			value: `v${history.latestSnapshot.version} · ${history.latestSnapshot.caseCount} cases`
		}
	];

	if (history.previousSnapshot) {
		rows.push({
			label: 'Previous snapshot',
			value: `v${history.previousSnapshot.version} · ${history.previousSnapshot.caseCount} cases`
		});
	}

	if (!history.diff) {
		rows.push({
			label: 'Snapshot diff',
			value: 'Save another suite snapshot to compare dataset changes.'
		});
		return rows;
	}

	rows.push(
		{
			label: 'Case count change',
			value: formatSignedDelta(history.diff.caseCountDelta)
		},
		{
			label: 'Added cases',
			value:
				history.diff.addedCaseIds.length > 0
					? history.diff.addedCaseIds.join(', ')
					: 'none'
		},
		{
			label: 'Removed cases',
			value:
				history.diff.removedCaseIds.length > 0
					? history.diff.removedCaseIds.join(', ')
					: 'none'
		},
		{
			label: 'Changed cases',
			value:
				history.diff.changedCaseIds.length > 0
					? history.diff.changedCaseIds.join(', ')
					: 'none'
		},
		{
			label: 'Order changed',
			value: history.diff.orderChanged ? 'changed' : 'stable'
		}
	);

	return rows;
};

export const buildRAGEvaluationSuiteSnapshotPresentations = (
	history?: RAGEvaluationSuiteSnapshotHistory
): RAGEvaluationSuiteSnapshotPresentation[] =>
	(history?.snapshots ?? []).map((snapshot) => ({
		id: snapshot.id,
		label: snapshot.label ?? snapshot.suiteId,
		rows: [
			{ label: 'Version', value: `v${snapshot.version}` },
			{ label: 'Created', value: formatDateLabel(snapshot.createdAt) },
			{ label: 'Cases', value: String(snapshot.caseCount) },
			{
				label: 'Case ids',
				value:
					snapshot.suite.input.cases
						.map((entry) => entry.id)
						.join(', ') || 'none'
			}
		],
		summary: `v${snapshot.version} · ${snapshot.caseCount} cases`,
		version: snapshot.version
	}));

export const buildRAGEvaluationSuiteSnapshotHistoryPresentation = (
	history?: RAGEvaluationSuiteSnapshotHistory
): RAGEvaluationSuiteSnapshotHistoryPresentation => ({
	rows: buildRAGEvaluationSuiteSnapshotRows(history),
	snapshots: buildRAGEvaluationSuiteSnapshotPresentations(history),
	summary: history?.latestSnapshot
		? `v${history.latestSnapshot.version}`
		: 'No saved suite snapshots yet.'
});

const isRuntimeGateReason = (reason: string) =>
	/runtime|candidate-budget|underfilled/i.test(reason);

const getFixtureVariantsFromRunTags = (tags?: string[]): string[] =>
	(tags ?? [])
		.filter((tag) => tag.startsWith('fixture:'))
		.map((tag) => tag.slice('fixture:'.length))
		.filter(
			(tag, index, all) => tag.length > 0 && all.indexOf(tag) === index
		);

const buildRAGRetrievalReleaseHistoryRunPresentation = (
	run: RAGRetrievalComparisonRun
): RAGRetrievalReleaseHistoryRunPresentation => {
	const runtimeGateReasons = (
		run.decisionSummary?.gate?.reasons ??
		run.releaseVerdict?.gate?.reasons ??
		[]
	).filter(isRuntimeGateReason);
	const rows: RAGLabelValueRow[] = [
		{ label: 'Finished', value: formatDateLabel(run.finishedAt) },
		{
			label: 'Passing-rate winner',
			value: run.comparison.summary.bestByPassingRate ?? 'n/a'
		},
		{
			label: 'Average F1 winner',
			value: run.comparison.summary.bestByAverageF1 ?? 'n/a'
		}
	];
	const fixtureVariants = getFixtureVariantsFromRunTags(run.tags);

	if (fixtureVariants.length > 0) {
		rows.push({
			label: 'Fixture variant',
			value: fixtureVariants.join(', ')
		});
	}
	const officeWinnerSummaries = [
		run.comparison.summary.bestByOfficeParagraphEvidenceReconcileCases
			? `narrative=${run.comparison.summary.bestByOfficeParagraphEvidenceReconcileCases}`
			: null,
		run.comparison.summary.bestByOfficeListEvidenceReconcileCases
			? `checklist=${run.comparison.summary.bestByOfficeListEvidenceReconcileCases}`
			: null,
		run.comparison.summary.bestByOfficeTableEvidenceReconcileCases
			? `table=${run.comparison.summary.bestByOfficeTableEvidenceReconcileCases}`
			: null
	].filter((value): value is string => Boolean(value));
	if (officeWinnerSummaries.length > 0) {
		rows.push({
			label: 'Office reconcile winners (docx/xlsx/pptx)',
			value: officeWinnerSummaries.join(', ')
		});
	}
	const presentationCueWinners = [
		run.comparison.summary.bestByPresentationTitleCueCases
			? `title=${run.comparison.summary.bestByPresentationTitleCueCases}`
			: null,
		run.comparison.summary.bestByPresentationBodyCueCases
			? `body=${run.comparison.summary.bestByPresentationBodyCueCases}`
			: null,
		run.comparison.summary.bestByPresentationNotesCueCases
			? `notes=${run.comparison.summary.bestByPresentationNotesCueCases}`
			: null
	].filter((value): value is string => Boolean(value));
	if (presentationCueWinners.length > 0) {
		rows.push({
			label: 'Presentation cue winners',
			value: presentationCueWinners.join(', ')
		});
	}
	const spreadsheetCueWinners = [
		run.comparison.summary.bestBySpreadsheetSheetCueCases
			? `sheet=${run.comparison.summary.bestBySpreadsheetSheetCueCases}`
			: null,
		run.comparison.summary.bestBySpreadsheetTableCueCases
			? `table=${run.comparison.summary.bestBySpreadsheetTableCueCases}`
			: null,
		run.comparison.summary.bestBySpreadsheetColumnCueCases
			? `column=${run.comparison.summary.bestBySpreadsheetColumnCueCases}`
			: null
	].filter((value): value is string => Boolean(value));
	if (spreadsheetCueWinners.length > 0) {
		rows.push({
			label: 'Spreadsheet cue winners',
			value: spreadsheetCueWinners.join(', ')
		});
	}
	if (run.comparison.summary.bestByPresentationTitleCueCases) {
		rows.push({
			label: 'Best presentation title cue',
			value: run.comparison.summary.bestByPresentationTitleCueCases
		});
	}
	if (run.comparison.summary.bestByPresentationBodyCueCases) {
		rows.push({
			label: 'Best presentation body cue',
			value: run.comparison.summary.bestByPresentationBodyCueCases
		});
	}
	if (run.comparison.summary.bestByPresentationNotesCueCases) {
		rows.push({
			label: 'Best presentation notes cue',
			value: run.comparison.summary.bestByPresentationNotesCueCases
		});
	}
	if (run.comparison.summary.bestBySpreadsheetSheetCueCases) {
		rows.push({
			label: 'Best spreadsheet sheet cue',
			value: run.comparison.summary.bestBySpreadsheetSheetCueCases
		});
	}
	if (run.comparison.summary.bestBySpreadsheetTableCueCases) {
		rows.push({
			label: 'Best spreadsheet table cue',
			value: run.comparison.summary.bestBySpreadsheetTableCueCases
		});
	}
	if (run.comparison.summary.bestBySpreadsheetColumnCueCases) {
		rows.push({
			label: 'Best spreadsheet column cue',
			value: run.comparison.summary.bestBySpreadsheetColumnCueCases
		});
	}
	if (run.comparison.summary.bestByOfficeParagraphEvidenceReconcileCases) {
		rows.push({
			label: 'Best office narrative reconcile',
			value: run.comparison.summary
				.bestByOfficeParagraphEvidenceReconcileCases
		});
	}
	if (run.comparison.summary.bestByOfficeListEvidenceReconcileCases) {
		rows.push({
			label: 'Best office checklist reconcile',
			value: run.comparison.summary.bestByOfficeListEvidenceReconcileCases
		});
	}
	if (run.comparison.summary.bestByOfficeTableEvidenceReconcileCases) {
		rows.push({
			label: 'Best office table reconcile',
			value: run.comparison.summary
				.bestByOfficeTableEvidenceReconcileCases
		});
	}

	if (
		run.comparison.summary.bestByLowestRuntimeCandidateBudgetExhaustedCases
	) {
		rows.push({
			label: 'Lowest runtime budget exhaustion',
			value: run.comparison.summary
				.bestByLowestRuntimeCandidateBudgetExhaustedCases
		});
	}

	if (run.comparison.summary.bestByLowestRuntimeUnderfilledTopKCases) {
		rows.push({
			label: 'Lowest runtime underfilled TopK',
			value: run.comparison.summary
				.bestByLowestRuntimeUnderfilledTopKCases
		});
	}

	rows.push(
		{
			label: 'Gate status',
			value:
				run.decisionSummary?.gate?.status ??
				run.releaseVerdict?.gate?.status ??
				'n/a'
		},
		{
			label: 'Runtime gate failures',
			value:
				runtimeGateReasons.length > 0
					? runtimeGateReasons.join('; ')
					: 'none'
		}
	);

	return {
		label: run.label,
		rows,
		runId: run.id,
		summary:
			runtimeGateReasons.length > 0
				? `${run.label} · runtime gate blocked`
				: `${run.label} · ${run.comparison.summary.bestByPassingRate ?? 'n/a'} leads passing rate`
	};
};

export const buildRAGRetrievalReleaseGroupHistoryPresentation = (input: {
	timeline?: RAGRetrievalReleaseTimelineSummary;
	runs?: RAGRetrievalComparisonRun[];
}): RAGRetrievalReleaseGroupHistoryPresentation => {
	const recentRuns = (input.runs ?? []).map(
		buildRAGRetrievalReleaseHistoryRunPresentation
	);
	const fixtureVariants = (input.runs ?? [])
		.flatMap((run) => getFixtureVariantsFromRunTags(run.tags))
		.filter((tag, index, all) => all.indexOf(tag) === index);
	const runtimeBlockedRuns = recentRuns.filter((entry) =>
		entry.rows.some(
			(row) =>
				row.label === 'Runtime gate failures' && row.value !== 'none'
		)
	).length;
	const rows: RAGLabelValueRow[] = [
		{
			label: 'Latest decision',
			value: input.timeline?.latestDecisionKind ?? 'none'
		},
		{
			label: 'Latest decision at',
			value: formatDateLabel(input.timeline?.latestDecisionAt)
		},
		{
			label: 'Last promoted',
			value: formatDateLabel(input.timeline?.lastPromotedAt)
		},
		{
			label: 'Last reverted',
			value: formatDateLabel(input.timeline?.lastRevertedAt)
		},
		{
			label: 'Recent runtime-blocked runs',
			value: String(runtimeBlockedRuns)
		}
	];

	if (fixtureVariants.length > 0) {
		rows.push({
			label: 'Fixture variants',
			value: fixtureVariants.join(', ')
		});
	}

	return {
		recentRuns,
		rows,
		summary: input.timeline?.latestDecisionKind
			? `${input.timeline.latestDecisionKind} · ${recentRuns.length} recent runs`
			: recentRuns.length > 0
				? `${recentRuns.length} recent runs`
				: 'No release history yet.'
	};
};

export const buildRAGAnswerGroundingCaseSnapshotPresentations = (
	history?: RAGAnswerGroundingEvaluationHistory
): RAGAnswerGroundingCaseSnapshotPresentation[] => {
	if (!history?.caseSnapshots.length) {
		return [];
	}

	return history.caseSnapshots.map((entry) => {
		const label = entry.label ?? entry.caseId;
		return {
			answerChange: entry.answerChange,
			caseId: entry.caseId,
			label,
			rows: [
				{
					label: 'Query',
					value: entry.query?.trim().length ? entry.query : 'n/a'
				},
				{ label: 'Answer change', value: entry.answerChange },
				{ label: 'Coverage', value: entry.coverage },
				{
					label: 'Resolved citations',
					value: `${entry.resolvedCitationCount}/${entry.citationCount}`
				},
				{
					label: 'Resolved citation rate',
					value: entry.resolvedCitationRate.toFixed(3)
				},
				{ label: 'Citation F1', value: entry.citationF1.toFixed(3) },
				{
					label: 'Reference count',
					value: String(entry.referenceCount)
				},
				{
					label: 'Cited IDs',
					value:
						entry.citedIds.length > 0
							? entry.citedIds.join(', ')
							: 'none'
				},
				{
					label: 'Matched IDs',
					value:
						entry.matchedIds.length > 0
							? entry.matchedIds.join(', ')
							: 'none'
				},
				{
					label: 'Missing IDs',
					value:
						entry.missingIds.length > 0
							? entry.missingIds.join(', ')
							: 'none'
				},
				{
					label: 'Extra IDs',
					value:
						entry.extraIds.length > 0
							? entry.extraIds.join(', ')
							: 'none'
				},
				{
					label: 'Unresolved refs',
					value:
						entry.ungroundedReferenceNumbers.length > 0
							? entry.ungroundedReferenceNumbers.join(', ')
							: 'none'
				},
				{
					label: 'Answer',
					value: entry.answer.trim().length > 0 ? entry.answer : 'n/a'
				},
				{
					label: 'Previous answer',
					value:
						entry.previousAnswer &&
						entry.previousAnswer.trim().length > 0
							? entry.previousAnswer
							: 'n/a'
				}
			],
			summary: `${entry.answerChange} · ${entry.coverage} · resolved ${entry.resolvedCitationCount}/${entry.citationCount} · refs ${entry.referenceCount}`
		};
	});
};

export const buildRAGAnswerGroundingHistoryRows = (
	history?: RAGAnswerGroundingEvaluationHistory
): RAGLabelValueRow[] => {
	if (!history?.latestRun) {
		return [{ label: 'History', value: 'No persisted provider runs yet.' }];
	}

	const rows: RAGLabelValueRow[] = [
		{ label: 'Runs recorded', value: String(history.runs.length) },
		{
			label: 'Latest',
			value: `${history.latestRun.label} · ${formatGroundingHistorySummaryValue(
				history.latestRun.response
			)}`
		}
	];

	if (history.previousRun) {
		rows.push({
			label: 'Previous',
			value: `${history.previousRun.label} · ${formatGroundingHistorySummaryValue(
				history.previousRun.response
			)}`
		});
	}

	if (history.leaderboard[0]) {
		rows.push({
			label: 'Best recorded',
			value: `#${history.leaderboard[0].rank} · ${history.leaderboard[0].label} · passing ${formatEvaluationPassingRate(
				history.leaderboard[0].passingRate
			)} · citation f1 ${history.leaderboard[0].averageCitationF1.toFixed(
				3
			)} · resolved ${formatEvaluationPassingRate(
				history.leaderboard[0].averageResolvedCitationRate
			)}`
		});
	}

	if (history.caseSnapshots.length > 0) {
		const changedAnswers = history.caseSnapshots.filter(
			(entry) => entry.answerChange === 'changed'
		).length;
		rows.push({
			label: 'Answer drift',
			value: `${changedAnswers}/${history.caseSnapshots.length} changed`
		});
	}

	if (!history.diff) {
		rows.push({
			label: 'History diff',
			value: 'Run the provider comparison again to diff grounding regressions over time.'
		});
		return rows;
	}

	rows.push(
		{
			label: 'Passing delta',
			value: formatSignedDelta(
				history.diff.summaryDelta.passingRate,
				1,
				'%'
			)
		},
		{
			label: 'Citation F1 delta',
			value: formatSignedDelta(
				history.diff.summaryDelta.averageCitationF1,
				3
			)
		},
		{
			label: 'Resolved citation delta',
			value: formatSignedDelta(
				history.diff.summaryDelta.averageResolvedCitationRate * 100,
				1,
				'%'
			)
		},
		{
			label: 'Improved',
			value: formatGroundingHistoryCaseLabels(history.diff.improvedCases)
		},
		{
			label: 'Regressed',
			value: formatGroundingHistoryCaseLabels(history.diff.regressedCases)
		}
	);

	if (history.previousRun) {
		const currentEntityView = buildRAGAnswerGroundingEntityQualityView(
			history.latestRun.response
		);
		const previousEntityView = buildRAGAnswerGroundingEntityQualityView(
			history.previousRun.response
		);
		rows.push(
			{
				label: 'Source regression hotspots',
				value: formatEntityRegressionHotspots(
					currentEntityView.bySource,
					previousEntityView.bySource,
					(entry) => entry.averageCitationF1,
					'citation f1'
				)
			},
			{
				label: 'Document regression hotspots',
				value: formatEntityRegressionHotspots(
					currentEntityView.byDocument,
					previousEntityView.byDocument,
					(entry) => entry.averageCitationF1,
					'citation f1'
				)
			}
		);
	}

	return rows;
};

export const buildRAGAnswerGroundingHistoryPresentation = (
	history?: RAGAnswerGroundingEvaluationHistory
): RAGAnswerGroundingHistoryPresentation => ({
	caseSnapshots: buildRAGAnswerGroundingCaseSnapshotPresentations(history),
	rows: buildRAGAnswerGroundingHistoryRows(history),
	summary: history?.latestRun
		? history.latestRun.label
		: 'No persisted provider runs yet.'
});

const formatFailureCounts = (failureCounts: Record<string, number>) => {
	const entries = Object.entries(failureCounts).sort((left, right) => {
		if (right[1] !== left[1]) {
			return right[1] - left[1];
		}

		return left[0].localeCompare(right[0]);
	});

	return entries.length > 0
		? entries.map(([key, count]) => `${key} ${count}`).join(' · ')
		: 'none';
};

const formatFailureCountDelta = (
	current: Record<string, number>,
	previous: Record<string, number>
) => {
	const deltas = Object.keys({ ...current, ...previous })
		.map((key) => ({
			delta: (current[key] ?? 0) - (previous[key] ?? 0),
			key
		}))
		.filter((entry) => entry.delta > 0)
		.sort((left, right) => {
			if (right.delta !== left.delta) {
				return right.delta - left.delta;
			}

			return left.key.localeCompare(right.key);
		});

	return deltas.length > 0
		? deltas
				.slice(0, 3)
				.map((entry) => `${entry.key} +${entry.delta}`)
				.join(' · ')
		: 'stable';
};

const formatEntityRegressionHotspots = <
	T extends {
		key: string;
		label: string;
		passingRate: number;
		failureCounts: Record<string, number>;
	}
>(
	currentEntries: T[],
	previousEntries: T[],
	metricSelector: (entry: T) => number,
	metricLabel: string
) => {
	const previousMap = new Map(
		previousEntries.map((entry) => [entry.key, entry])
	);
	const regressions = currentEntries
		.map((entry) => {
			const previous = previousMap.get(entry.key);
			const passDelta = entry.passingRate - (previous?.passingRate ?? 0);
			const metricDelta =
				metricSelector(entry) -
				(previous ? metricSelector(previous) : 0);
			const failureDelta = formatFailureCountDelta(
				entry.failureCounts,
				previous?.failureCounts ?? {}
			);

			return {
				entry,
				failureDelta,
				metricDelta,
				passDelta
			};
		})
		.filter(
			(entry) =>
				entry.passDelta < 0 ||
				entry.metricDelta < 0 ||
				entry.failureDelta !== 'stable'
		)
		.sort((left, right) => {
			if (left.passDelta !== right.passDelta) {
				return left.passDelta - right.passDelta;
			}
			if (left.metricDelta !== right.metricDelta) {
				return left.metricDelta - right.metricDelta;
			}

			return left.entry.label.localeCompare(right.entry.label);
		});

	return regressions.length > 0
		? regressions
				.slice(0, 3)
				.map(
					({ entry, failureDelta, metricDelta, passDelta }) =>
						`${entry.label} pass ${formatSignedDelta(
							passDelta,
							1,
							'%'
						)} · ${metricLabel} ${formatSignedDelta(
							metricDelta,
							3
						)} · ${failureDelta}`
				)
				.join(' | ')
		: 'none';
};

const buildEvaluationEntityPresentation = (
	entry: RAGEvaluationEntityQualitySummary
): RAGEntityQualityPresentation => ({
	key: entry.key,
	label: entry.label,
	rows: [
		{ label: 'Entity type', value: entry.entityType },
		{ label: 'Cases', value: String(entry.totalCases) },
		{
			label: 'Status mix',
			value: `${entry.passedCases} pass · ${entry.partialCases} partial · ${entry.failedCases} fail`
		},
		{
			label: 'Passing rate',
			value: formatEvaluationPassingRate(entry.passingRate)
		},
		{ label: 'Average F1', value: entry.averageF1.toFixed(3) },
		{
			label: 'Failure classes',
			value: formatFailureCounts(entry.failureCounts)
		},
		{
			label: 'Cases',
			value: entry.caseIds.length > 0 ? entry.caseIds.join(', ') : 'none'
		}
	],
	summary: `${entry.entityType} · passing ${formatEvaluationPassingRate(
		entry.passingRate
	)} · f1 ${entry.averageF1.toFixed(3)} · failures ${formatFailureCounts(
		entry.failureCounts
	)}`
});

const buildGroundingEntityPresentation = (
	entry: RAGAnswerGroundingEntityQualitySummary
): RAGEntityQualityPresentation => ({
	key: entry.key,
	label: entry.label,
	rows: [
		{ label: 'Entity type', value: entry.entityType },
		{ label: 'Cases', value: String(entry.totalCases) },
		{
			label: 'Status mix',
			value: `${entry.passedCases} pass · ${entry.partialCases} partial · ${entry.failedCases} fail`
		},
		{
			label: 'Passing rate',
			value: formatEvaluationPassingRate(entry.passingRate)
		},
		{
			label: 'Average citation F1',
			value: entry.averageCitationF1.toFixed(3)
		},
		{
			label: 'Average resolved citation rate',
			value: formatEvaluationPassingRate(
				entry.averageResolvedCitationRate * 100
			)
		},
		{
			label: 'Failure classes',
			value: formatFailureCounts(entry.failureCounts)
		},
		{
			label: 'Cases',
			value: entry.caseIds.length > 0 ? entry.caseIds.join(', ') : 'none'
		}
	],
	summary: `${entry.entityType} · passing ${formatEvaluationPassingRate(
		entry.passingRate
	)} · citation f1 ${entry.averageCitationF1.toFixed(
		3
	)} · failures ${formatFailureCounts(entry.failureCounts)}`
});

export const buildRAGEvaluationEntityQualityPresentation = (
	view: RAGEvaluationEntityQualityView,
	entityType: 'source' | 'document'
): RAGEntityQualityViewPresentation => {
	const entities =
		entityType === 'source'
			? view.bySource.map(buildEvaluationEntityPresentation)
			: view.byDocument.map(buildEvaluationEntityPresentation);

	return {
		entities,
		rows: [
			{ label: 'Entity type', value: entityType },
			{ label: 'Entities tracked', value: String(entities.length) },
			{
				label: 'Best coverage',
				value: entities[0]?.summary ?? 'No entity quality data yet.'
			}
		],
		summary:
			entities[0]?.label ??
			`No ${entityType === 'source' ? 'source' : 'document'} quality data yet.`
	};
};

export const buildRAGAnswerGroundingEntityQualityPresentation = (
	view: RAGAnswerGroundingEntityQualityView,
	entityType: 'source' | 'document'
): RAGEntityQualityViewPresentation => {
	const entities =
		entityType === 'source'
			? view.bySource.map(buildGroundingEntityPresentation)
			: view.byDocument.map(buildGroundingEntityPresentation);

	return {
		entities,
		rows: [
			{ label: 'Entity type', value: entityType },
			{ label: 'Entities tracked', value: String(entities.length) },
			{
				label: 'Best coverage',
				value: entities[0]?.summary ?? 'No entity quality data yet.'
			}
		],
		summary:
			entities[0]?.label ??
			`No ${entityType === 'source' ? 'source' : 'document'} quality data yet.`
	};
};
