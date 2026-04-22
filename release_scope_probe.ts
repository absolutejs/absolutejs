import { Elysia } from 'elysia';
import type {
	RAGRetrievalIncidentRemediationExecutionHistoryRecord,
	RAGRetrievalReleaseIncidentRecord
} from './types/ai';
import { ragChat } from './src/ai/rag/chat';
import { createRAGAccessControl } from './src/ai/rag/accessControl';

const provider = () => ({ async *stream() {} });

const retrievalReleaseIncidentStore = {
	incidents: [
		{
			id: 'incident-alpha',
			groupKey: 'alpha-release',
			severity: 'warning',
			status: 'open',
			kind: 'gate_failure',
			targetRolloutLabel: 'stable',
			message: 'alpha release blocked',
			triggeredAt: 1
		},
		{
			id: 'incident-beta',
			groupKey: 'beta-release',
			severity: 'critical',
			status: 'resolved',
			kind: 'approval_expired',
			targetRolloutLabel: 'canary',
			message: 'beta release completed',
			triggeredAt: 2,
			resolvedAt: 3
		}
	] as Array<RAGRetrievalReleaseIncidentRecord>,
	saveIncident(record: RAGRetrievalReleaseIncidentRecord) {
		this.incidents.push(record);
	},
	listIncidents(
		input: {
			groupKey?: string;
			corpusGroupKey?: string;
			limit?: number;
			targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
			status?: RAGRetrievalReleaseIncidentRecord['status'];
			severity?: RAGRetrievalReleaseIncidentRecord['severity'];
		} = {}
	) {
		const { groupKey } = input;
		return groupKey
			? this.incidents.filter(
					(incident) => incident.groupKey === groupKey
				)
			: this.incidents;
	}
};

const retrievalIncidentRemediationExecutionHistoryStore = {
	records: [
		{
			id: 'exec-alpha-1',
			executedAt: 10,
			groupKey: 'alpha-release',
			incidentId: 'incident-alpha',
			incidentKind: 'gate_failure',
			remediationKind: 'review_readiness',
			action: {
				kind: 'view_release_status',
				label: 'View release status',
				method: 'GET',
				path: '/rag/status/release'
			},
			code: 'guardrail_blocked',
			blockedByGuardrail: true,
			ok: false
		},
		{
			id: 'exec-beta-1',
			executedAt: 10,
			groupKey: 'beta-release',
			incidentId: 'incident-beta',
			incidentKind: 'approval_expired',
			remediationKind: 'record_approval',
			action: {
				kind: 'view_release_status',
				label: 'View release status',
				method: 'GET',
				path: '/rag/status/release'
			},
			code: 'idempotent_replay',
			idempotentReplay: true,
			mutationSkipped: true,
			ok: true
		}
	] as Array<RAGRetrievalIncidentRemediationExecutionHistoryRecord>,
	saveRecord(record: RAGRetrievalIncidentRemediationExecutionHistoryRecord) {
		this.records.push(record);
	},
	listRecords(
		input: {
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			actionKind?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['action']['kind'];
			code?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['code'];
			blockedByGuardrail?: boolean;
			idempotentReplay?: boolean;
			targetRolloutLabel?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['targetRolloutLabel'];
		} = {}
	) {
		const { groupKey } = input;
		return groupKey
			? this.records.filter((r) => r.groupKey === groupKey)
			: this.records;
	}
};

const accessControl = createRAGAccessControl<{ workspace: string }>({
	resolveContext(request) {
		return {
			workspace: request.headers.get('x-workspace') ?? 'alpha'
		};
	},
	resolveScope({ context }) {
		return {
			allowedComparisonGroupKeys: [
				context?.workspace === 'beta' ? 'beta-release' : 'alpha-release'
			]
		};
	}
});

const app = new Elysia().use(
	ragChat({
		...accessControl,
		path: '/rag',
		provider,
		retrievalReleaseIncidentStore,
		retrievalIncidentRemediationExecutionHistoryStore
	})
);

for (const workspace of ['alpha', 'beta']) {
	const incidentStatusResponse = await app.handle(
		new Request('http://localhost/rag/status/release/incidents', {
			headers: { 'x-workspace': workspace }
		})
	);
	const incidentBody = (await incidentStatusResponse.json()) as any;
	console.log(workspace, 'incidentSummary', incidentBody.incidentSummary);
	console.log(workspace, 'recentIncidents', incidentBody.recentIncidents);

	const releaseStatusResponse = await app.handle(
		new Request('http://localhost/rag/status/release', {
			headers: { 'x-workspace': workspace }
		})
	);
	const releaseBody = (await releaseStatusResponse.json()) as any;
	console.log(
		workspace,
		'releaseSummary',
		releaseBody.retrievalComparisons?.incidentSummary
	);
	console.log(
		workspace,
		'release incidents',
		releaseBody.retrievalComparisons?.recentIncidents
	);
}
