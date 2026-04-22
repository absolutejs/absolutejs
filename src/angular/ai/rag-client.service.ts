import { Injectable } from '@angular/core';
import type {
	RAGEvaluationInput,
	RAGRetrievalBaselineResponse,
	RAGRetrievalLaneHandoffDecisionRequest,
	RAGRetrievalBaselinePromotionFromRunRequest,
	RAGRetrievalBaselinePromotionRequest,
	RAGRetrievalBaselineRevertRequest,
	RAGRetrievalReleaseDecisionActionRequest,
	RAGRetrievalComparisonRequest,
	RAGDocumentChunk,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGRetrievalIncidentRemediationDecisionRequest,
	RAGRetrievalIncidentRemediationBulkExecutionRequest,
	RAGRetrievalIncidentRemediationExecutionRequest,
	RAGSearchRequest,
	RAGSyncRunOptions
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

@Injectable({ providedIn: 'root' })
export class RAGClientService {
	private clients = new Map<string, ReturnType<typeof createRAGClient>>();

	private client(path: string) {
		const existing = this.clients.get(path);
		if (existing) {
			return existing;
		}

		const created = createRAGClient({ path });
		this.clients.set(path, created);

		return created;
	}

	ingest(path: string, chunks: RAGDocumentChunk[]) {
		return this.client(path).ingest(chunks);
	}

	ingestDocuments(path: string, input: RAGDocumentIngestInput) {
		return this.client(path).ingestDocuments(input);
	}

	ingestUrls(path: string, input: RAGDocumentUrlIngestInput) {
		return this.client(path).ingestUrls(input);
	}

	ingestUploads(path: string, input: RAGDocumentUploadIngestInput) {
		return this.client(path).ingestUploads(input);
	}

	search(path: string, input: RAGSearchRequest) {
		return this.client(path).search(input);
	}

	searchWithTrace(path: string, input: RAGSearchRequest) {
		return this.client(path).searchWithTrace(input);
	}

	evaluate(path: string, input: RAGEvaluationInput) {
		return this.client(path).evaluate(input);
	}

	compareRetrievals(path: string, input: RAGRetrievalComparisonRequest) {
		return this.client(path).compareRetrievals(input);
	}

	retrievalComparisonHistory(
		path: string,
		input?: {
			limit?: number;
			suiteId?: string;
			label?: string;
			winnerId?: string;
			groupKey?: string;
			tag?: string;
		}
	) {
		return this.client(path).retrievalComparisonHistory(input);
	}

	retrievalBaselines(
		path: string,
		input?: {
			groupKey?: string;
			tag?: string;
			limit?: number;
			status?: 'active' | 'superseded';
		}
	) {
		return this.client(path).retrievalBaselines(input);
	}

	promoteRetrievalBaseline(
		path: string,
		input: RAGRetrievalBaselinePromotionRequest
	) {
		return this.client(path).promoteRetrievalBaseline(input);
	}

	promoteRetrievalBaselineDetailed(
		path: string,
		input: RAGRetrievalBaselinePromotionRequest
	): Promise<RAGRetrievalBaselineResponse> {
		return this.client(path).promoteRetrievalBaselineDetailed(input);
	}

	promoteRetrievalBaselineToLane(
		path: string,
		input: RAGRetrievalBaselinePromotionRequest & {
			rolloutLabel: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).promoteRetrievalBaselineToLane(input);
	}

	promoteRetrievalBaselineToLaneDetailed(
		path: string,
		input: RAGRetrievalBaselinePromotionRequest & {
			rolloutLabel: 'canary' | 'stable' | 'rollback_target';
		}
	): Promise<RAGRetrievalBaselineResponse> {
		return this.client(path).promoteRetrievalBaselineToLaneDetailed(input);
	}

	promoteRetrievalBaselineFromRun(
		path: string,
		input: RAGRetrievalBaselinePromotionFromRunRequest
	) {
		return this.client(path).promoteRetrievalBaselineFromRun(input);
	}

	promoteRetrievalBaselineFromRunDetailed(
		path: string,
		input: RAGRetrievalBaselinePromotionFromRunRequest
	): Promise<RAGRetrievalBaselineResponse> {
		return this.client(path).promoteRetrievalBaselineFromRunDetailed(input);
	}

	revertRetrievalBaseline(
		path: string,
		input: RAGRetrievalBaselineRevertRequest
	) {
		return this.client(path).revertRetrievalBaseline(input);
	}

	retrievalBaselineDecisions(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			kind?: 'approve' | 'promote' | 'reject' | 'revert';
			freshnessStatus?: 'fresh' | 'expired' | 'not_applicable';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalBaselineDecisions(input);
	}

	retrievalReleaseGroupHistory(
		path: string,
		input: {
			groupKey: string;
			decisionLimit?: number;
			baselineLimit?: number;
			runLimit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalReleaseGroupHistory(input);
	}

	retrievalLaneHandoffs(
		path: string,
		input?: {
			groupKey?: string;
			sourceRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			limit?: number;
		}
	) {
		return this.client(path).retrievalLaneHandoffs(input);
	}

	retrievalLaneHandoffDecisions(
		path: string,
		input?: {
			groupKey?: string;
			sourceRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			kind?: 'approve' | 'reject' | 'complete';
			limit?: number;
		}
	) {
		return this.client(path).retrievalLaneHandoffDecisions(input);
	}

	retrievalLaneHandoffIncidents(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			status?: 'open' | 'resolved';
			severity?: 'warning' | 'critical';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalLaneHandoffIncidents(input);
	}

	retrievalLaneHandoffIncidentHistory(
		path: string,
		input?: {
			action?: 'opened' | 'acknowledged' | 'unacknowledged' | 'resolved';
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalLaneHandoffIncidentHistory(input);
	}

	retrievalLaneHandoffAutoCompletePolicyHistory(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalLaneHandoffAutoCompletePolicyHistory(
			input
		);
	}

	retrievalReleaseLanePolicyHistory(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			scope?: 'rollout_label' | 'group_rollout_label';
		}
	) {
		return this.client(path).retrievalReleaseLanePolicyHistory(input);
	}

	retrievalBaselineGatePolicyHistory(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			scope?: 'rollout_label' | 'group_rollout_label';
		}
	) {
		return this.client(path).retrievalBaselineGatePolicyHistory(input);
	}

	retrievalReleaseLaneEscalationPolicyHistory(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalReleaseLaneEscalationPolicyHistory(
			input
		);
	}

	retrievalReleaseIncidentPolicyHistory(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalReleaseIncidentPolicyHistory(input);
	}

	decideRetrievalLaneHandoff(
		path: string,
		input: RAGRetrievalLaneHandoffDecisionRequest
	) {
		return this.client(path).decideRetrievalLaneHandoff(input);
	}

	decideRetrievalLaneHandoffDetailed(
		path: string,
		input: RAGRetrievalLaneHandoffDecisionRequest
	) {
		return this.client(path).decideRetrievalLaneHandoffDetailed(input);
	}

	retrievalReleaseIncidents(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			status?: 'open' | 'resolved';
			severity?: 'warning' | 'critical';
			kind?:
				| 'approval_expired'
				| 'baseline_regression'
				| 'gate_failure'
				| 'handoff_stale';
			acknowledged?: boolean;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalReleaseIncidents(input);
	}

	retrievalIncidentRemediationDecisions(
		path: string,
		input?: {
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			remediationKind?:
				| 'renew_approval'
				| 'record_approval'
				| 'inspect_gate'
				| 'rerun_comparison'
				| 'restore_source_lane'
				| 'review_readiness'
				| 'monitor_lane';
			status?: 'planned' | 'applied' | 'dismissed';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalIncidentRemediationDecisions(input);
	}

	retrievalIncidentRemediationExecutions(
		path: string,
		input?: {
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			actionKind?: RAGRetrievalIncidentRemediationExecutionRequest['action']['kind'];
			code?:
				| 'approval_recorded'
				| 'incident_acknowledged'
				| 'incident_resolved'
				| 'release_status_loaded'
				| 'release_drift_loaded'
				| 'handoff_status_loaded'
				| 'guardrail_blocked'
				| 'idempotent_replay';
			blockedByGuardrail?: boolean;
			idempotentReplay?: boolean;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}
	) {
		return this.client(path).retrievalIncidentRemediationExecutions(input);
	}

	recordRetrievalIncidentRemediationDecision(
		path: string,
		input: RAGRetrievalIncidentRemediationDecisionRequest
	) {
		return this.client(path).recordRetrievalIncidentRemediationDecision(
			input
		);
	}

	executeRetrievalIncidentRemediation(
		path: string,
		input: RAGRetrievalIncidentRemediationExecutionRequest
	) {
		return this.client(path).executeRetrievalIncidentRemediation(input);
	}

	bulkExecuteRetrievalIncidentRemediations(
		path: string,
		input: RAGRetrievalIncidentRemediationBulkExecutionRequest
	) {
		return this.client(path).bulkExecuteRetrievalIncidentRemediations(
			input
		);
	}

	retrievalReleaseStatus(path: string) {
		return this.client(path).retrievalReleaseStatus();
	}

	retrievalReleaseIncidentStatus(path: string) {
		return this.client(path).retrievalReleaseIncidentStatus();
	}

	retrievalIncidentRemediationStatus(path: string) {
		return this.client(path).retrievalIncidentRemediationStatus();
	}

	retrievalReleaseDriftStatus(path: string) {
		return this.client(path).retrievalReleaseDriftStatus();
	}

	retrievalLaneHandoffStatus(path: string) {
		return this.client(path).retrievalLaneHandoffStatus();
	}

	retrievalLaneHandoffIncidentStatus(path: string) {
		return this.client(path).retrievalLaneHandoffIncidentStatus();
	}

	acknowledgeRetrievalLaneHandoffIncident(
		path: string,
		input: {
			incidentId: string;
			acknowledgedAt?: number;
			acknowledgedBy?: string;
			acknowledgementNotes?: string;
		}
	) {
		return this.client(path).acknowledgeRetrievalLaneHandoffIncident(input);
	}

	unacknowledgeRetrievalLaneHandoffIncident(
		path: string,
		input: {
			incidentId: string;
		}
	) {
		return this.client(path).unacknowledgeRetrievalLaneHandoffIncident(
			input
		);
	}

	resolveRetrievalLaneHandoffIncident(
		path: string,
		input: {
			incidentId: string;
			resolvedAt?: number;
			resolvedBy?: string;
			resolutionNotes?: string;
		}
	) {
		return this.client(path).resolveRetrievalLaneHandoffIncident(input);
	}

	acknowledgeRetrievalReleaseIncident(
		path: string,
		input: {
			incidentId: string;
			acknowledgedAt?: number;
			acknowledgedBy?: string;
			acknowledgementNotes?: string;
		}
	) {
		return this.client(path).acknowledgeRetrievalReleaseIncident(input);
	}

	unacknowledgeRetrievalReleaseIncident(
		path: string,
		input: {
			incidentId: string;
		}
	) {
		return this.client(path).unacknowledgeRetrievalReleaseIncident(input);
	}

	resolveRetrievalReleaseIncident(
		path: string,
		input: {
			incidentId: string;
			resolvedAt?: number;
			resolvedBy?: string;
			resolutionNotes?: string;
		}
	) {
		return this.client(path).resolveRetrievalReleaseIncident(input);
	}

	retrievalPromotionCandidates(
		path: string,
		input?: {
			groupKey?: string;
			limit?: number;
			tag?: string;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			approved?: boolean;
			ready?: boolean;
			blocked?: boolean;
			reviewStatus?: 'approved' | 'blocked' | 'needs_review' | 'ready';
			freshnessStatus?: 'fresh' | 'expired' | 'not_applicable';
			sortBy?:
				| 'approvalFreshness'
				| 'finishedAt'
				| 'gateSeverity'
				| 'priority';
			sortDirection?: 'asc' | 'desc';
		}
	) {
		return this.client(path).retrievalPromotionCandidates(input);
	}

	approveRetrievalCandidate(
		path: string,
		input: RAGRetrievalReleaseDecisionActionRequest
	) {
		return this.client(path).approveRetrievalCandidate(input);
	}

	rejectRetrievalCandidate(
		path: string,
		input: RAGRetrievalReleaseDecisionActionRequest
	) {
		return this.client(path).rejectRetrievalCandidate(input);
	}

	status(path: string) {
		return this.client(path).status();
	}

	ops(path: string) {
		return this.client(path).ops();
	}

	searchTraceHistory(
		path: string,
		input?: {
			query?: string;
			groupKey?: string;
			tag?: string;
			limit?: number;
		}
	) {
		return this.client(path).searchTraceHistory(input);
	}

	searchTraceGroups(
		path: string,
		input?: {
			tag?: string;
			limit?: number;
		}
	) {
		return this.client(path).searchTraceGroups(input);
	}

	searchTraceStats(path: string, input?: { tag?: string }) {
		return this.client(path).searchTraceStats(input);
	}

	previewSearchTracePrune(
		path: string,
		input?: {
			maxAgeMs?: number;
			maxRecordsPerQuery?: number;
			maxRecordsPerGroup?: number;
			now?: number;
			tag?: string;
		}
	) {
		return this.client(path).previewSearchTracePrune(input);
	}

	pruneSearchTraces(
		path: string,
		input?: {
			maxAgeMs?: number;
			maxRecordsPerQuery?: number;
			maxRecordsPerGroup?: number;
			now?: number;
			tag?: string;
		}
	) {
		return this.client(path).pruneSearchTraces(input);
	}

	searchTracePruneHistory(
		path: string,
		input?: {
			limit?: number;
			trigger?: 'manual' | 'write' | 'schedule';
		}
	) {
		return this.client(path).searchTracePruneHistory(input);
	}

	syncSources(path: string) {
		return this.client(path).syncSources();
	}

	syncAllSources(path: string, options?: RAGSyncRunOptions) {
		return this.client(path).syncAllSources(options);
	}

	syncSource(path: string, id: string, options?: RAGSyncRunOptions) {
		return this.client(path).syncSource(id, options);
	}

	documents(path: string, kind?: string) {
		return this.client(path).documents(kind);
	}

	documentChunks(path: string, id: string) {
		return this.client(path).documentChunks(id);
	}

	createDocument(
		path: string,
		input: RAGDocumentIngestInput['documents'][number]
	) {
		return this.client(path).createDocument(input);
	}

	deleteDocument(path: string, id: string) {
		return this.client(path).deleteDocument(id);
	}

	reseed(path: string) {
		return this.client(path).reseed();
	}

	reset(path: string) {
		return this.client(path).reset();
	}

	reindexDocument(path: string, id: string) {
		return this.client(path).reindexDocument(id);
	}

	reindexSource(path: string, source: string) {
		return this.client(path).reindexSource(source);
	}

	backends(path: string) {
		return this.client(path).backends();
	}

	clearIndex(path: string) {
		return this.client(path).clearIndex();
	}
}
