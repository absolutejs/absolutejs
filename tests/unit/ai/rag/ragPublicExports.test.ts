import { describe, expect, it } from 'bun:test';
import * as rag from '../../../../src/ai';
import * as ragUi from '../../../../src/ai/rag/ui';
import * as ragQuality from '../../../../src/ai/rag/quality';
import * as ragClient from '../../../../src/ai/client';
import * as ragClientUi from '../../../../src/ai/client/ui';

describe('RAG public API boundary', () => {
	const uiExports = Object.keys(ragUi).filter(
		(name) =>
			(name.startsWith('buildRAG') &&
				![
					'buildRAGEvaluationLeaderboard',
					'buildRAGEvaluationResponse'
				].includes(name)) ||
			name.startsWith('getLatest') ||
			name.startsWith('resolveRAG')
	);

	it('keeps UI helpers off the core ai export', () => {
		for (const name of uiExports) {
			expect(Object.prototype.hasOwnProperty.call(rag, name)).toBe(false);
		}
	});

	it('exposes UI helpers from the dedicated ui module', () => {
		for (const name of uiExports) {
			expect(Object.prototype.hasOwnProperty.call(ragUi, name)).toBe(
				true
			);
		}
	});
});

describe('RAG client API boundary', () => {
	const clientUiExports = [
		'buildRAGAnswerWorkflowState',
		'buildRAGCitationReferenceMap',
		'buildRAGGroundedAnswer',
		'buildRAGGroundingReferences',
		'buildRAGSourceGroups',
		'buildRAGSourceSummaries',
		'buildRAGStreamProgress',
		'getLatestAssistantMessage',
		'getRAGStreamProgress',
		'resolveRAGStreamStage'
	];

	it('keeps UI/quality helpers off the client core export', () => {
		for (const name of clientUiExports) {
			expect(Object.prototype.hasOwnProperty.call(ragClient, name)).toBe(
				false
			);
		}
	});

	it('exposes UI/quality helpers from the dedicated client ui module', () => {
		for (const name of clientUiExports) {
			expect(
				Object.prototype.hasOwnProperty.call(ragClientUi, name)
			).toBe(true);
		}
	});
});

describe('RAG quality API boundary', () => {
	const qualityExports = [
		'buildRAGEvaluationLeaderboard',
		'buildRAGEvaluationResponse',
		'buildRAGEvaluationRunDiff',
		'buildRAGAnswerGroundingCaseDifficultyLeaderboard',
		'buildRAGAnswerGroundingCaseDifficultyRunDiff',
		'buildRAGAnswerGroundingEvaluationLeaderboard',
		'buildRAGAnswerGroundingEvaluationResponse',
		'buildRAGAnswerGroundingEvaluationRunDiff',
		'buildRAGRetrievalComparisonDecisionSummary',
		'buildRAGRetrievalReleaseVerdict',
		'buildRAGSearchTraceDiff',
		'buildRAGSearchTraceRecord',
		'compareRAGRetrievalStrategies',
		'compareRAGRerankers',
		'createRAGEvaluationSuite',
		'createRAGFileRetrievalBaselineStore',
		'createRAGFileRetrievalComparisonHistoryStore',
		'createRAGFileRetrievalLaneHandoffDecisionStore',
		'createRAGFileRetrievalLaneHandoffIncidentStore',
		'createRAGFileRetrievalLaneHandoffIncidentHistoryStore',
		'createRAGFileRetrievalIncidentRemediationDecisionStore',
		'createRAGFileRetrievalIncidentRemediationExecutionHistoryStore',
		'createRAGFileRetrievalLaneHandoffAutoCompletePolicyHistoryStore',
		'createRAGFileRetrievalReleaseLanePolicyHistoryStore',
		'createRAGFileRetrievalBaselineGatePolicyHistoryStore',
		'createRAGFileRetrievalReleaseLaneEscalationPolicyHistoryStore',
		'createRAGFileRetrievalReleaseDecisionStore',
		'createRAGFileRetrievalReleaseIncidentStore',
		'createRAGFileSearchTraceStore',
		'createRAGFileSearchTracePruneHistoryStore',
		'createRAGSQLiteGovernanceStores',
		'createRAGSQLiteRetrievalBaselineStore',
		'createRAGSQLiteRetrievalComparisonHistoryStore',
		'createRAGSQLiteRetrievalLaneHandoffDecisionStore',
		'createRAGSQLiteRetrievalLaneHandoffIncidentStore',
		'createRAGSQLiteRetrievalLaneHandoffIncidentHistoryStore',
		'createRAGSQLiteRetrievalLaneHandoffAutoCompletePolicyHistoryStore',
		'createRAGSQLiteRetrievalIncidentRemediationDecisionStore',
		'createRAGSQLiteRetrievalIncidentRemediationExecutionHistoryStore',
		'createRAGSQLiteRetrievalReleaseLanePolicyHistoryStore',
		'createRAGSQLiteRetrievalBaselineGatePolicyHistoryStore',
		'createRAGSQLiteRetrievalReleaseLaneEscalationPolicyHistoryStore',
		'createRAGSQLiteRetrievalReleaseIncidentStore',
		'createRAGSQLiteRetrievalReleaseDecisionStore',
		'createRAGSQLiteSearchTraceStore',
		'createRAGSQLiteSearchTracePruneHistoryStore',
		'evaluateRAGCollection',
		'executeDryRunRAGEvaluation',
		'loadRAGRetrievalBaselines',
		'loadRAGRetrievalComparisonHistory',
		'loadRAGRetrievalLaneHandoffDecisions',
		'loadRAGRetrievalLaneHandoffIncidents',
		'loadRAGRetrievalLaneHandoffIncidentHistory',
		'loadRAGRetrievalIncidentRemediationDecisions',
		'loadRAGRetrievalIncidentRemediationExecutionHistory',
		'loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory',
		'loadRAGRetrievalReleaseLanePolicyHistory',
		'loadRAGRetrievalBaselineGatePolicyHistory',
		'loadRAGRetrievalReleaseLaneEscalationPolicyHistory',
		'loadRAGRetrievalReleaseDecisions',
		'loadRAGRetrievalReleaseIncidents',
		'loadRAGSearchTraceGroupHistory',
		'loadRAGSearchTraceHistory',
		'loadRAGSearchTracePruneHistory',
		'previewRAGSearchTraceStorePrune',
		'persistRAGRetrievalBaseline',
		'persistRAGRetrievalComparisonRun',
		'persistRAGRetrievalLaneHandoffDecision',
		'persistRAGRetrievalLaneHandoffIncident',
		'persistRAGRetrievalLaneHandoffIncidentHistory',
		'persistRAGRetrievalIncidentRemediationDecision',
		'persistRAGRetrievalIncidentRemediationExecutionHistory',
		'persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory',
		'persistRAGRetrievalReleaseLanePolicyHistory',
		'persistRAGRetrievalBaselineGatePolicyHistory',
		'persistRAGRetrievalReleaseLaneEscalationPolicyHistory',
		'persistRAGRetrievalReleaseDecision',
		'persistRAGRetrievalReleaseIncident',
		'persistRAGSearchTraceRecord',
		'persistRAGSearchTracePruneRun',
		'pruneRAGSearchTraceStore',
		'summarizeRAGSearchTraceStore',
		'runRAGEvaluationSuite',
		'createRAGAdaptiveNativePlannerBenchmarkSuite',
		'createRAGAdaptiveNativePlannerBenchmarkSnapshot',
		'createRAGNativeBackendBenchmarkCorpus',
		'createRAGNativeBackendBenchmarkMockEmbedding',
		'createRAGNativeBackendComparisonBenchmarkSuite',
		'createRAGNativeBackendComparisonBenchmarkSnapshot',
		'createRAGPresentationCueBenchmarkSuite',
		'createRAGPresentationCueBenchmarkSnapshot',
		'createRAGSpreadsheetCueBenchmarkSuite',
		'createRAGSpreadsheetCueBenchmarkSnapshot',
		'summarizeRAGEvaluationCase',
		'summarizeRAGRerankerComparison'
	];

	const qualityPresentationExports = [
		'buildRAGAnswerGroundingCaseSnapshotPresentations',
		'buildRAGAnswerGroundingHistoryPresentation',
		'buildRAGAnswerGroundingHistoryRows',
		'buildRAGComparisonTraceDiffRows',
		'buildRAGComparisonTraceSummaryRows',
		'buildRAGGroundingOverviewPresentation',
		'buildRAGGroundingProviderCaseComparisonPresentations',
		'buildRAGGroundingProviderOverviewPresentation',
		'buildRAGGroundingProviderPresentations',
		'buildRAGRetrievalComparisonOverviewPresentation',
		'buildRAGRetrievalComparisonPresentations',
		'buildRAGRetrievalOverviewPresentation',
		'buildRAGRerankerComparisonOverviewPresentation',
		'buildRAGRerankerComparisonPresentations',
		'buildRAGRerankerOverviewPresentation',
		'buildRAGEvaluationCaseTracePresentations',
		'buildRAGEvaluationHistoryPresentation',
		'buildRAGEvaluationHistoryRows',
		'buildRAGQualityOverviewPresentation'
	];

	it('keeps core quality helpers in rag scope', () => {
		for (const name of qualityExports) {
			expect(Object.prototype.hasOwnProperty.call(rag, name)).toBe(true);
			expect(Object.prototype.hasOwnProperty.call(ragQuality, name)).toBe(
				true
			);
		}

		for (const name of qualityExports) {
			expect(
				Object.prototype.hasOwnProperty.call(ragClientUi, name)
			).toBe(false);
		}
	});

	it('keeps quality presentation helpers in the rag ui surface', () => {
		for (const name of qualityPresentationExports) {
			expect(Object.prototype.hasOwnProperty.call(rag, name)).toBe(false);
			expect(Object.prototype.hasOwnProperty.call(ragUi, name)).toBe(
				true
			);
		}
	});
});
