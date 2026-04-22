import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import type {
	RAGRetrievalBaselineRecord,
	RAGRetrievalComparisonRun,
	RAGRetrievalIncidentRemediationExecutionHistoryRecord,
	RAGRetrievalReleaseIncidentRecord,
	RAGRetrievalReleaseDecisionRecord
} from '../../../../types/ai';
import { ragChat } from '../../../../src/ai/rag/chat';
import { createRAGAccessControl } from '../../../../src/ai/rag/accessControl';
import { createRAGCollection } from '../../../../src/ai/rag/collection';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import {
	createRAGFileRetrievalBaselineStore,
	createRAGFileRetrievalComparisonHistoryStore,
	createRAGFileRetrievalLaneHandoffDecisionStore,
	createRAGFileRetrievalLaneHandoffAutoCompletePolicyHistoryStore,
	createRAGFileRetrievalLaneHandoffIncidentStore,
	createRAGFileRetrievalLaneHandoffIncidentHistoryStore,
	createRAGFileRetrievalIncidentRemediationDecisionStore,
	createRAGFileRetrievalIncidentRemediationExecutionHistoryStore,
	createRAGFileRetrievalReleaseLanePolicyHistoryStore,
	createRAGFileRetrievalBaselineGatePolicyHistoryStore,
	createRAGFileRetrievalReleaseLaneEscalationPolicyHistoryStore,
	createRAGFileEvaluationSuiteSnapshotHistoryStore,
	createRAGFileRetrievalReleaseDecisionStore,
	createRAGFileRetrievalReleaseIncidentStore,
	createRAGFileSearchTracePruneHistoryStore,
	createRAGFileSearchTraceStore,
	persistRAGRetrievalComparisonRun,
	persistRAGRetrievalReleaseIncident
} from '../../../../src/ai/rag/quality';

describe('ragChat evaluation workflow', () => {
	const provider = () => ({
		async *stream() {}
	});

	it('evaluates retrieval cases through the /evaluate route', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];
				if (text.includes('question about alpha')) return [1, 0];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'guide-1:001',
					metadata: { documentId: 'guide-1' },
					source: 'guide-1',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'guide-2:001',
					metadata: { documentId: 'guide-2' },
					source: 'guide-2',
					text: 'beta ingestion workflow'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					cases: [
						{
							expectedDocumentIds: ['guide-1'],
							id: 'alpha-doc',
							query: 'question about alpha',
							topK: 2
						}
					]
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			cases: Array<{
				caseId: string;
				mode: string;
				status: string;
				matchedIds: string[];
			}>;
			summary: { passedCases: number };
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.summary.passedCases).toBe(1);
		expect(body.cases[0]?.caseId).toBe('alpha-doc');
		expect(body.cases[0]?.mode).toBe('documentId');
		expect(body.cases[0]?.status).toBe('pass');
		expect(body.cases[0]?.matchedIds).toEqual(['guide-1']);
	});

	it('includes explicit corpus keys in evaluation and retrieval comparison responses', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];
				if (text.includes('question about alpha')) return [1, 0];
				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'guide-1:001',
					corpusKey: 'alpha',
					metadata: { corpusKey: 'alpha', documentId: 'guide-1' },
					source: 'guide-1',
					text: 'alpha retrieval workflow'
				},
				{
					chunkId: 'guide-2:001',
					corpusKey: 'beta',
					metadata: { corpusKey: 'beta', documentId: 'guide-2' },
					source: 'guide-2',
					text: 'beta ingestion workflow'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const evaluationResponse = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							corpusKey: 'alpha',
							expectedDocumentIds: ['guide-1'],
							id: 'alpha-doc',
							query: 'question about alpha',
							topK: 2
						}
					]
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const evaluationBody = (await evaluationResponse.json()) as {
			ok: boolean;
			cases: Array<{ corpusKey?: string; matchedIds: string[] }>;
			corpusKeys?: string[];
		};

		expect(evaluationResponse.status).toBe(200);
		expect(evaluationBody.ok).toBe(true);
		expect(evaluationBody.corpusKeys).toEqual(['alpha']);
		expect(evaluationBody.cases[0]?.corpusKey).toBe('alpha');
		expect(evaluationBody.cases[0]?.matchedIds).toEqual(['guide-1']);

		const comparisonResponse = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					cases: [
						{
							corpusKey: 'alpha',
							expectedDocumentIds: ['guide-1'],
							id: 'alpha-doc',
							query: 'question about alpha'
						}
					],
					retrievals: [
						{ id: 'vector', retrieval: 'vector' },
						{ id: 'lexical', retrieval: 'lexical' }
					]
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const comparisonBody = (await comparisonResponse.json()) as {
			ok: boolean;
			comparison?: {
				corpusKeys?: string[];
				entries: Array<{
					response: {
						cases: Array<{ corpusKey?: string }>;
						corpusKeys?: string[];
					};
				}>;
			};
		};

		expect(comparisonResponse.status).toBe(200);
		expect(comparisonBody.ok).toBe(true);
		expect(comparisonBody.comparison?.corpusKeys).toEqual(['alpha']);
		expect(
			comparisonBody.comparison?.entries[0]?.response.corpusKeys
		).toEqual(['alpha']);
		expect(
			comparisonBody.comparison?.entries[0]?.response.cases[0]?.corpusKey
		).toBe('alpha');
	});

	it('threads explicit corpus group identity through retrieval governance records', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'guide-1:001',
					corpusKey: 'alpha',
					metadata: { corpusKey: 'alpha', documentId: 'guide-1' },
					source: 'guide-1',
					text: 'alpha retrieval workflow'
				}
			]
		});

		const runs: RAGRetrievalComparisonRun[] = [];
		const baselines: RAGRetrievalBaselineRecord[] = [];
		const decisions: RAGRetrievalReleaseDecisionRecord[] = [];
		const incidents: RAGRetrievalReleaseIncidentRecord[] = [];
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalBaselineStore: {
					listBaselines(input) {
						return baselines.filter((entry) => {
							if (
								typeof input?.corpusGroupKey === 'string' &&
								entry.corpusGroupKey !== input.corpusGroupKey
							) {
								return false;
							}
							if (
								typeof input?.groupKey === 'string' &&
								entry.groupKey !== input.groupKey
							) {
								return false;
							}
							return true;
						});
					},
					saveBaseline(record) {
						baselines.unshift(record);
					}
				},
				retrievalComparisonHistoryStore: {
					listRuns(input) {
						return runs.filter((entry) => {
							if (
								typeof input?.corpusGroupKey === 'string' &&
								entry.corpusGroupKey !== input.corpusGroupKey
							) {
								return false;
							}
							if (
								typeof input?.groupKey === 'string' &&
								entry.groupKey !== input.groupKey
							) {
								return false;
							}
							return true;
						});
					},
					saveRun(run) {
						runs.unshift(run);
					}
				},
				retrievalReleaseDecisionStore: {
					listDecisions(input) {
						return decisions.filter((entry) => {
							if (
								typeof input?.corpusGroupKey === 'string' &&
								entry.corpusGroupKey !== input.corpusGroupKey
							) {
								return false;
							}
							if (
								typeof input?.groupKey === 'string' &&
								entry.groupKey !== input.groupKey
							) {
								return false;
							}
							return true;
						});
					},
					saveDecision(record) {
						decisions.unshift(record);
					}
				},
				retrievalReleaseIncidentStore: {
					listIncidents(input) {
						return incidents.filter((entry) => {
							if (
								typeof input?.corpusGroupKey === 'string' &&
								entry.corpusGroupKey !== input.corpusGroupKey
							) {
								return false;
							}
							if (
								typeof input?.groupKey === 'string' &&
								entry.groupKey !== input.groupKey
							) {
								return false;
							}
							return true;
						});
					},
					saveIncident(record) {
						incidents.unshift(record);
					}
				}
			})
		);

		const comparisonResponse = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					cases: [
						{
							corpusKey: 'alpha',
							expectedDocumentIds: ['guide-1'],
							id: 'alpha-doc',
							query: 'question about alpha'
						}
					],
					groupKey: 'docs-release',
					persistRun: true,
					retrievals: [
						{ id: 'vector', retrieval: 'vector' },
						{ id: 'lexical', retrieval: 'lexical' }
					]
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const comparisonBody = (await comparisonResponse.json()) as {
			ok: boolean;
			comparison?: { corpusGroupKey?: string };
		};
		expect(comparisonResponse.status).toBe(200);
		expect(comparisonBody.comparison?.corpusGroupKey).toBe('alpha');

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/history?groupKey=docs-release&corpusGroupKey=alpha'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			runs?: Array<{ id: string; corpusGroupKey?: string }>;
		};
		expect(historyResponse.status).toBe(200);
		expect(historyBody.runs?.[0]?.corpusGroupKey).toBe('alpha');

		const promotionResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote-run',
				{
					body: JSON.stringify({
						groupKey: 'docs-release',
						sourceRunId: historyBody.runs?.[0]?.id
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const promotionBody = (await promotionResponse.json()) as {
			ok: boolean;
			baseline?: { corpusGroupKey?: string };
		};
		expect(promotionResponse.status).toBe(200);
		expect(promotionBody.baseline?.corpusGroupKey).toBe('alpha');

		const baselineListResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines?groupKey=docs-release&corpusGroupKey=alpha'
			)
		);
		const baselineListBody = (await baselineListResponse.json()) as {
			ok: boolean;
			baselines?: Array<{ corpusGroupKey?: string }>;
		};
		expect(baselineListResponse.status).toBe(200);
		expect(baselineListBody.baselines?.[0]?.corpusGroupKey).toBe('alpha');

		const decisionListResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/decisions?groupKey=docs-release&corpusGroupKey=alpha'
			)
		);
		const decisionListBody = (await decisionListResponse.json()) as {
			ok: boolean;
			decisions?: Array<{ corpusGroupKey?: string }>;
		};
		expect(decisionListResponse.status).toBe(200);
		expect(decisionListBody.decisions?.[0]?.corpusGroupKey).toBe('alpha');

		incidents.unshift({
			corpusGroupKey: 'alpha',
			groupKey: 'docs-release',
			id: 'alpha-incident',
			kind: 'gate_failure',
			message: 'alpha incident',
			severity: 'critical',
			status: 'open',
			targetRolloutLabel: 'stable',
			triggeredAt: Date.now()
		});

		const incidentListResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents?groupKey=docs-release&corpusGroupKey=alpha'
			)
		);
		const incidentListBody = (await incidentListResponse.json()) as {
			ok: boolean;
			incidents?: Array<{ corpusGroupKey?: string }>;
		};
		expect(incidentListResponse.status).toBe(200);
		expect(incidentListBody.incidents?.[0]?.corpusGroupKey).toBe('alpha');
	});

	it('supports dry-run evaluation payloads without querying the collection', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({ dimensions: 2 })
		});
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedSources: ['docs/demo.md'],
							id: 'source-dry-run',
							query: 'anything'
						}
					],
					dryRun: true
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			cases: Array<{
				retrievedCount: number;
				status: string;
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.cases[0]?.retrievedCount).toBe(0);
		expect(body.cases[0]?.status).toBe('fail');
	});

	it('completes ready lane handoffs with promotion and opens stale handoff incidents', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc:001',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-handoff-history-${Date.now()}.json`
		);
		const baselineStore = createRAGFileRetrievalBaselineStore(
			`/tmp/rag-retrieval-handoff-baselines-${Date.now()}.json`
		);
		const decisionStore = createRAGFileRetrievalReleaseDecisionStore(
			`/tmp/rag-retrieval-handoff-decisions-${Date.now()}.json`
		);
		const handoffDecisionStore =
			createRAGFileRetrievalLaneHandoffDecisionStore(
				`/tmp/rag-retrieval-handoff-workflow-${Date.now()}.json`
			);
		const handoffIncidentStore =
			createRAGFileRetrievalLaneHandoffIncidentStore(
				`/tmp/rag-retrieval-handoff-incident-workflow-${Date.now()}.json`
			);
		const handoffIncidentHistoryStore =
			createRAGFileRetrievalLaneHandoffIncidentHistoryStore(
				`/tmp/rag-retrieval-handoff-incident-history-${Date.now()}.json`
			);
		const handoffPolicyHistoryStore =
			createRAGFileRetrievalLaneHandoffAutoCompletePolicyHistoryStore(
				`/tmp/rag-retrieval-handoff-policy-history-${Date.now()}.json`
			);
		const releaseLanePolicyHistoryStore =
			createRAGFileRetrievalReleaseLanePolicyHistoryStore(
				`/tmp/rag-retrieval-release-lane-policy-history-${Date.now()}.json`
			);
		const baselineGatePolicyHistoryStore =
			createRAGFileRetrievalBaselineGatePolicyHistoryStore(
				`/tmp/rag-retrieval-gate-policy-history-${Date.now()}.json`
			);
		const releaseLaneEscalationPolicyHistoryStore =
			createRAGFileRetrievalReleaseLaneEscalationPolicyHistoryStore(
				`/tmp/rag-retrieval-escalation-policy-history-${Date.now()}.json`
			);
		const incidentStore = createRAGFileRetrievalReleaseIncidentStore(
			`/tmp/rag-retrieval-handoff-incidents-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalBaselineStore: baselineStore,
				retrievalComparisonHistoryStore: historyStore,
				retrievalLaneHandoffAutoCompletePoliciesByGroupAndTargetRolloutLabel:
					{
						'docs-auto': {
							stable: {
								enabled: true,
								maxApprovedDecisionAgeMs: 60_000
							}
						}
					},
				retrievalLaneHandoffDecisionStore: handoffDecisionStore,
				retrievalLaneHandoffIncidentStore: handoffIncidentStore,
				retrievalLaneHandoffIncidentHistoryStore:
					handoffIncidentHistoryStore,
				retrievalLaneHandoffAutoCompletePolicyHistoryStore:
					handoffPolicyHistoryStore,
				retrievalReleaseLanePolicyHistoryStore:
					releaseLanePolicyHistoryStore,
				retrievalBaselineGatePolicyHistoryStore:
					baselineGatePolicyHistoryStore,
				retrievalReleaseLaneEscalationPolicyHistoryStore:
					releaseLaneEscalationPolicyHistoryStore,
				retrievalReleaseDecisionStore: decisionStore,
				retrievalReleaseIncidentStore: incidentStore,
				retrievalReleasePoliciesByGroupAndRolloutLabel: {
					'docs-ready': {
						canary: { requireApprovalBeforePromotion: false },
						stable: {
							approvalMaxAgeMs: 60_000,
							requireApprovalBeforePromotion: true
						}
					},
					'docs-stale': {
						canary: { requireApprovalBeforePromotion: false },
						stable: {
							approvalMaxAgeMs: 1_000,
							requireApprovalBeforePromotion: true
						}
					}
				},
				retrievalBaselineGatePoliciesByRolloutLabel: {
					canary: { minPassingRateDelta: 0, severity: 'warn' }
				}
			})
		);

		for (const groupKey of ['docs-ready', 'docs-stale', 'docs-auto']) {
			await app.handle(
				new Request(
					'http://localhost/rag/compare/retrieval/baselines/promote-lane',
					{
						body: JSON.stringify({
							approvedBy: 'alex',
							groupKey,
							retrievalId: 'lexical',
							rolloutLabel: 'canary'
						}),
						headers: { 'Content-Type': 'application/json' },
						method: 'POST'
					}
				)
			);

			const now = Date.now();
			await persistRAGRetrievalComparisonRun({
				run: {
					comparison: {
						entries: [
							{
								averageF1: 1,
								elapsedMs: 1,
								label: 'Lexical',
								passingRate: 100,
								retrievalId: 'lexical'
							}
						] as any,
						leaderboard: [
							{
								averageF1: 1,
								elapsedMs: 1,
								label: 'Lexical',
								passingRate: 100,
								retrievalId: 'lexical'
							}
						] as any,
						summary: {
							bestByAverageF1: 'lexical',
							bestByPassingRate: 'lexical',
							fastest: 'lexical'
						},
						suiteId: `${groupKey}-suite`,
						suiteLabel: `${groupKey} suite`
					},
					decisionSummary: {
						baselineRetrievalId: 'lexical',
						candidateRetrievalId: 'lexical',
						delta: {
							averageF1Delta: 0,
							elapsedMsDelta: 0,
							passingRateDelta: 0
						},
						gate: {
							policy: {
								minPassingRateDelta: 0,
								severity: 'fail'
							},
							reasons: [],
							status: 'pass'
						},
						winnerByAverageF1: 'lexical',
						winnerByPassingRate: 'lexical'
					},
					elapsedMs: 1,
					finishedAt: groupKey === 'docs-stale' ? now - 5_000 : now,
					groupKey,
					id: `${groupKey}-run`,
					label: `${groupKey} run`,
					startedAt: now - 6_000,
					suiteId: `${groupKey}-suite`,
					suiteLabel: `${groupKey} suite`
				},
				store: historyStore
			});

			await app.handle(
				new Request(
					'http://localhost/rag/compare/retrieval/baselines/approve',
					{
						body: JSON.stringify({
							decidedAt: now,
							decidedBy: 'alex',
							groupKey,
							sourceRunId: `${groupKey}-run`,
							targetRolloutLabel: 'stable'
						}),
						headers: { 'Content-Type': 'application/json' },
						method: 'POST'
					}
				)
			);
		}

		const readyHandoffsResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs?groupKey=docs-ready&sourceRolloutLabel=canary&targetRolloutLabel=stable&limit=5'
			)
		);
		const readyHandoffsBody = (await readyHandoffsResponse.json()) as {
			handoffs?: Array<{ readyForHandoff: boolean }>;
			ok: boolean;
		};
		expect(readyHandoffsBody.handoffs?.[0]?.readyForHandoff).toBe(true);

		const completeHandoffResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/decide',
				{
					body: JSON.stringify({
						decidedBy: 'alex',
						executePromotion: true,
						groupKey: 'docs-ready',
						kind: 'complete',
						sourceRolloutLabel: 'canary',
						targetRolloutLabel: 'stable'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const completeHandoffBody = (await completeHandoffResponse.json()) as {
			baseline?: { retrievalId?: string; rolloutLabel?: string };
			decision?: { kind?: string };
			ok: boolean;
			rolloutState?: {
				targetRolloutLabel?: string;
				remediationActions?: string[];
			};
		};
		expect(completeHandoffResponse.status).toBe(200);
		expect(completeHandoffBody.ok).toBe(true);
		expect(completeHandoffBody.decision?.kind).toBe('complete');
		expect(completeHandoffBody.baseline).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				rolloutLabel: 'stable'
			})
		);
		expect(completeHandoffBody.rolloutState).toEqual(
			expect.objectContaining({
				remediationActions: expect.arrayContaining([
					expect.any(String)
				]),
				targetRolloutLabel: 'stable'
			})
		);

		const autoCompleteApproveResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/decide',
				{
					body: JSON.stringify({
						decidedAt: Date.now(),
						decidedBy: 'alex',
						groupKey: 'docs-auto',
						kind: 'approve',
						sourceRolloutLabel: 'canary',
						targetRolloutLabel: 'stable'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const autoCompleteApproveBody =
			(await autoCompleteApproveResponse.json()) as {
				baseline?: { rolloutLabel?: string };
				ok: boolean;
				rolloutState?: {
					targetRolloutLabel?: string;
					remediationActions?: string[];
				};
			};
		expect(autoCompleteApproveResponse.status).toBe(200);
		expect(autoCompleteApproveBody.baseline).toEqual(
			expect.objectContaining({
				rolloutLabel: 'stable'
			})
		);
		expect(autoCompleteApproveBody.rolloutState).toEqual(
			expect.objectContaining({
				remediationActions: expect.arrayContaining([
					expect.any(String)
				]),
				targetRolloutLabel: 'stable'
			})
		);

		const approveStaleHandoffResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/decide',
				{
					body: JSON.stringify({
						decidedAt: Date.now() - 5_000,
						decidedBy: 'alex',
						groupKey: 'docs-stale',
						kind: 'approve',
						sourceRolloutLabel: 'canary',
						targetRolloutLabel: 'stable'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(approveStaleHandoffResponse.status).toBe(200);

		const releaseStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release')
		);
		const releaseDriftStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/drift')
		);
		const releaseStatusBody = (await releaseStatusResponse.json()) as {
			ok: boolean;
			retrievalComparisons?: {
				incidentSummary?: {
					acknowledgedOpenCount?: number;
					openCount?: number;
					resolvedCount?: number;
					unacknowledgedOpenCount?: number;
				};
				alerts?: Array<{ kind?: string }>;
				handoffAutoComplete?: Array<{
					enabled?: boolean;
					groupKey?: string;
					ready?: boolean;
				}>;
				handoffDriftRollups?: Array<{
					count?: number;
					kind?: string;
					remediationHints?: string[];
					targetRolloutLabel?: string;
				}>;
				handoffAutoCompletePolicies?: Array<{
					enabled?: boolean;
					groupKey?: string;
					safe?: boolean;
					targetRolloutLabel?: string;
				}>;
				recentHandoffAutoCompletePolicyHistory?: Array<{
					changeKind?: string;
					groupKey?: string;
					targetRolloutLabel?: string;
				}>;
				recentReleaseLanePolicyHistory?: Array<{
					changeKind?: string;
					groupKey?: string;
					rolloutLabel?: string;
				}>;
				recentBaselineGatePolicyHistory?: Array<{
					changeKind?: string;
					rolloutLabel?: string;
					scope?: string;
				}>;
				recentReleaseLaneEscalationPolicyHistory?: Array<{
					changeKind?: string;
					groupKey?: string;
					targetRolloutLabel?: string;
				}>;
				handoffDriftCountsByLane?: Array<{
					targetRolloutLabel?: string;
					totalCount?: number;
					countsByKind?: Record<string, number>;
				}>;
				releaseGroups?: Array<{
					groupKey?: string;
					openIncidentCount?: number;
					acknowledgedOpenIncidentCount?: number;
					unacknowledgedOpenIncidentCount?: number;
				}>;
				handoffAutoCompleteSafety?: Array<{
					groupKey?: string;
					safe?: boolean;
					targetRolloutLabel?: string;
				}>;
				recentIncidents?: Array<{
					kind?: string;
					targetRolloutLabel?: string;
				}>;
			};
		};
		expect(releaseStatusResponse.status).toBe(200);
		expect(releaseDriftStatusResponse.status).toBe(200);
		expect(releaseStatusBody.retrievalComparisons?.recentIncidents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'handoff_stale',
					status: 'open',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(releaseStatusBody.retrievalComparisons?.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: 1,
				resolvedCount: 0
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.releaseGroups?.find(
				(group) => group.groupKey === 'docs-stale'
			)
		).toEqual(
			expect.objectContaining({
				groupKey: 'docs-stale',
				openIncidentCount: 1
			})
		);
		const releaseIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/incidents')
		);
		const releaseIncidentStatusBody =
			(await releaseIncidentStatusResponse.json()) as {
				ok: boolean;
				incidentSummary?: { openCount: number; resolvedCount: number };
				releaseLaneIncidentSummaries?: Array<{
					groupKey: string;
					openCount?: number;
					targetRolloutLabel?: string;
				}>;
			};
		expect(releaseIncidentStatusResponse.status).toBe(200);
		expect(releaseIncidentStatusBody.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: 0,
				resolvedCount: 1
			})
		);
		expect(releaseIncidentStatusBody.releaseLaneIncidentSummaries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-stale',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(
			releaseStatusBody.retrievalComparisons?.handoffAutoComplete?.find(
				(entry) => entry.groupKey === 'docs-auto'
			)
		).toEqual(
			expect.objectContaining({
				candidateRetrievalId: 'lexical',
				enabled: true,
				freshnessStatus: 'fresh',
				groupKey: 'docs-auto',
				ready: true,
				reasons: [],
				sourceRolloutLabel: 'canary',
				sourceRunId: 'docs-auto-run',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.handoffAutoCompletePolicies?.find(
				(entry) => entry.groupKey === 'docs-auto'
			)
		).toEqual(
			expect.objectContaining({
				enabled: true,
				groupKey: 'docs-auto',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.handoffAutoCompleteSafety?.find(
				(entry) => entry.groupKey === 'docs-auto'
			)
		).toEqual(
			expect.objectContaining({
				candidateRetrievalId: 'lexical',
				enabled: true,
				freshnessStatus: 'fresh',
				groupKey: 'docs-auto',
				reasons: [],
				safe: true,
				sourceRunId: 'docs-auto-run',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.recentHandoffAutoCompletePolicyHistory?.find(
				(entry) => entry.groupKey === 'docs-auto'
			)
		).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-auto',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.handoffDriftRollups
		).toEqual(expect.any(Array));
		expect(
			releaseStatusBody.retrievalComparisons?.recentReleaseLanePolicyHistory?.find(
				(entry) =>
					entry.groupKey === 'docs-ready' &&
					entry.rolloutLabel === 'stable'
			)
		).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-ready',
				rolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.recentBaselineGatePolicyHistory?.find(
				(entry) => entry.rolloutLabel === 'canary'
			)
		).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				rolloutLabel: 'canary',
				scope: 'rollout_label'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.recentReleaseLaneEscalationPolicyHistory?.find(
				(entry) =>
					entry.groupKey === 'docs-ready' &&
					entry.targetRolloutLabel === 'stable'
			)
		).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-ready',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatusBody.retrievalComparisons?.handoffDriftCountsByLane?.find(
				(entry) => entry.targetRolloutLabel === 'stable'
			)
		).toEqual(undefined);
		const releaseDriftStatusBody =
			(await releaseDriftStatusResponse.json()) as {
				handoffDriftCountsByLane?: Array<{
					targetRolloutLabel?: string;
					totalCount?: number;
				}>;
				handoffDriftRollups?: Array<{
					kind?: string;
					targetRolloutLabel?: string;
				}>;
				ok: boolean;
			};
		expect(releaseDriftStatusBody.handoffDriftCountsByLane).toEqual(
			expect.any(Array)
		);
		expect(releaseDriftStatusBody.handoffDriftRollups).toEqual(
			expect.any(Array)
		);
		const handoffPolicyHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/policies/history?groupKey=docs-auto&targetRolloutLabel=stable&limit=5'
			)
		);
		const handoffPolicyHistoryBody =
			(await handoffPolicyHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{ changeKind?: string; groupKey?: string }>;
			};
		expect(handoffPolicyHistoryResponse.status).toBe(200);
		expect(handoffPolicyHistoryBody.records?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-auto'
			})
		);
		const releaseLanePolicyHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/release-policies/history?groupKey=docs-ready&rolloutLabel=stable&scope=group_rollout_label&limit=5'
			)
		);
		const releaseLanePolicyHistoryBody =
			(await releaseLanePolicyHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{
					changeKind?: string;
					groupKey?: string;
					rolloutLabel?: string;
				}>;
			};
		expect(releaseLanePolicyHistoryResponse.status).toBe(200);
		expect(releaseLanePolicyHistoryBody.records?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-ready',
				rolloutLabel: 'stable'
			})
		);
		const gatePolicyHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/gate-policies/history?rolloutLabel=canary&scope=rollout_label&limit=5'
			)
		);
		const gatePolicyHistoryBody =
			(await gatePolicyHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{
					changeKind?: string;
					rolloutLabel?: string;
					scope?: string;
				}>;
			};
		expect(gatePolicyHistoryResponse.status).toBe(200);
		expect(gatePolicyHistoryBody.records?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				rolloutLabel: 'canary',
				scope: 'rollout_label'
			})
		);
		const escalationPolicyHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/escalation-policies/history?groupKey=docs-ready&targetRolloutLabel=stable&limit=5'
			)
		);
		const escalationPolicyHistoryBody =
			(await escalationPolicyHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{
					changeKind?: string;
					groupKey?: string;
					targetRolloutLabel?: string;
				}>;
			};
		expect(escalationPolicyHistoryResponse.status).toBe(200);
		expect(escalationPolicyHistoryBody.records?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-ready',
				targetRolloutLabel: 'stable'
			})
		);
		const incidentPolicyHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incident-policies/history?groupKey=docs-ready&targetRolloutLabel=stable&limit=5'
			)
		);
		const incidentPolicyHistoryBody =
			(await incidentPolicyHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{
					changeKind?: string;
					groupKey?: string;
					targetRolloutLabel?: string;
				}>;
			};
		expect(incidentPolicyHistoryResponse.status).toBe(200);
		expect(incidentPolicyHistoryBody.records?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-ready',
				targetRolloutLabel: 'stable'
			})
		);
		const handoffStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/handoffs')
		);
		const handoffStatusBody = (await handoffStatusResponse.json()) as {
			autoComplete?: Array<{
				enabled?: boolean;
				groupKey?: string;
				ready?: boolean;
			}>;
			freshnessWindows?: Array<{
				freshnessStatus?: string;
				groupKey?: string;
			}>;
			incidentSummary?: {
				openCount?: number;
				resolvedCount?: number;
				staleOpenCount?: number;
				unacknowledgedOpenCount?: number;
			};
			incidents?: Array<{ kind?: string }>;
			recentHistory?: Array<{ action?: string; incidentId?: string }>;
			ok: boolean;
		};
		expect(handoffStatusResponse.status).toBe(200);
		expect(handoffStatusBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_stale'
			})
		);
		expect(handoffStatusBody.incidentSummary).toEqual(
			expect.objectContaining({
				acknowledgedOpenCount: 0,
				resolvedCount: 1,
				staleOpenCount: 0
			})
		);
		expect(
			handoffStatusBody.autoComplete?.find(
				(entry) => entry.groupKey === 'docs-auto'
			)
		).toEqual(
			expect.objectContaining({
				candidateRetrievalId: 'lexical',
				enabled: true,
				freshnessStatus: 'fresh',
				groupKey: 'docs-auto',
				ready: true,
				reasons: [],
				sourceRolloutLabel: 'canary',
				sourceRunId: 'docs-auto-run',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			handoffStatusBody.freshnessWindows?.find(
				(entry) => entry.groupKey === 'docs-stale'
			)
		).toEqual(
			expect.objectContaining({
				freshnessStatus: 'expired',
				groupKey: 'docs-stale'
			})
		);
		expect((handoffStatusBody.recentHistory?.length ?? 0) > 0).toBe(true);
		const handoffIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/handoffs/incidents')
		);
		const handoffIncidentStatusBody =
			(await handoffIncidentStatusResponse.json()) as {
				freshnessWindows?: Array<{
					freshnessStatus?: string;
					groupKey?: string;
				}>;
				incidentSummary?: {
					openCount?: number;
					resolvedCount?: number;
					staleOpenCount?: number;
				};
				incidents?: Array<{ kind?: string }>;
				recentHistory?: Array<{ action?: string; incidentId?: string }>;
				ok: boolean;
			};
		expect(handoffIncidentStatusResponse.status).toBe(200);
		expect(handoffIncidentStatusBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_stale'
			})
		);
		expect(handoffIncidentStatusBody.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: 0,
				resolvedCount: 1,
				staleOpenCount: 0
			})
		);
		expect(
			handoffIncidentStatusBody.freshnessWindows?.find(
				(entry) => entry.groupKey === 'docs-stale'
			)
		).toEqual(
			expect.objectContaining({
				freshnessStatus: 'expired',
				groupKey: 'docs-stale'
			})
		);
		expect((handoffIncidentStatusBody.recentHistory?.length ?? 0) > 0).toBe(
			true
		);
		const handoffIncidentListResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/incidents?groupKey=docs-stale&status=resolved&targetRolloutLabel=stable&limit=5'
			)
		);
		const handoffIncidentListBody =
			(await handoffIncidentListResponse.json()) as {
				incidents?: Array<{
					id?: string;
					kind?: string;
					status?: string;
					targetRolloutLabel?: string;
				}>;
				ok: boolean;
			};
		expect(handoffIncidentListResponse.status).toBe(200);
		expect(handoffIncidentListBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_stale',
				status: 'resolved',
				targetRolloutLabel: 'stable'
			})
		);
		const handoffIncidentId = handoffIncidentListBody.incidents?.[0]?.id;
		expect(typeof handoffIncidentId).toBe('string');
		const acknowledgeHandoffIncidentResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/incidents/acknowledge',
				{
					body: JSON.stringify({
						acknowledgedBy: 'alex',
						acknowledgementNotes:
							'resolved handoff incident reviewed',
						incidentId: handoffIncidentId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const acknowledgeHandoffIncidentBody =
			(await acknowledgeHandoffIncidentResponse.json()) as {
				incidents?: Array<{ acknowledgedBy?: string; id?: string }>;
				ok: boolean;
			};
		expect(acknowledgeHandoffIncidentResponse.status).toBe(200);
		expect(acknowledgeHandoffIncidentBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				acknowledgedBy: 'alex',
				id: handoffIncidentId
			})
		);
		const unacknowledgeHandoffIncidentResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/incidents/unacknowledge',
				{
					body: JSON.stringify({
						incidentId: handoffIncidentId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(unacknowledgeHandoffIncidentResponse.status).toBe(200);
		const resolveHandoffIncidentResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/incidents/resolve',
				{
					body: JSON.stringify({
						incidentId: handoffIncidentId,
						resolutionNotes: 'resolved handoff incident archived',
						resolvedBy: 'alex'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const resolveHandoffIncidentBody =
			(await resolveHandoffIncidentResponse.json()) as {
				incidents?: Array<{
					id?: string;
					notes?: string;
					status?: string;
				}>;
				ok: boolean;
			};
		expect(resolveHandoffIncidentResponse.status).toBe(200);
		expect(resolveHandoffIncidentBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				id: handoffIncidentId,
				notes: 'resolved handoff incident archived',
				status: 'resolved'
			})
		);
		const handoffIncidentHistoryResponse = await app.handle(
			new Request(
				`http://localhost/rag/compare/retrieval/handoffs/incidents/history?incidentId=${handoffIncidentId}&groupKey=docs-stale&targetRolloutLabel=stable&limit=5`
			)
		);
		const handoffIncidentHistoryBody =
			(await handoffIncidentHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{ action?: string; incidentId?: string }>;
			};
		expect(handoffIncidentHistoryResponse.status).toBe(200);
		expect(handoffIncidentHistoryBody.records?.[0]).toEqual(
			expect.objectContaining({
				action: 'resolved',
				incidentId: handoffIncidentId
			})
		);
	});

	it('uses global retrieval when case-level retrieval is omitted', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('question about alpha')) return [0, 1];
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'beta',
					text: 'beta guide'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['alpha-doc'],
							id: 'global-retrieval-lexical',
							query: 'question about alpha'
						}
					],
					retrieval: 'lexical'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			cases: Array<{ matchedIds: string[]; status: string }>;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.cases[0]?.status).toBe('pass');
		expect(body.cases[0]?.matchedIds).toEqual(['alpha-doc']);
	});

	it('uses case retrieval to override global retrieval settings', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('question about alpha')) return [0, 1];
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'beta',
					text: 'beta guide'
				}
			]
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['beta-doc'],
							id: 'case-overrides-global',
							query: 'question about alpha',
							retrieval: {
								mode: 'vector'
							}
						}
					],
					retrieval: 'lexical'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			cases: Array<{ matchedIds: string[]; status: string }>;
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.cases[0]?.status).toBe('pass');
		expect(body.cases[0]?.matchedIds).toEqual(['beta-doc']);
	});

	it('rejects invalid global retrieval values on evaluate', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({ dimensions: 2 })
		});
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedSources: ['source'],
							id: 'bad-retrieval',
							query: 'anything'
						}
					],
					retrieval: 'vectorish'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);

		const body = (await response.json()) as { ok: boolean; error: string };

		expect(response.status).toBe(400);
		expect(body.ok).toBe(false);
		expect(body.error).toBe(
			'Expected payload shape: { cases: [{ id, query, expectedChunkIds|expectedSources|expectedDocumentIds }] }'
		);
	});

	it('rejects invalid per-case retrieval payloads on evaluate', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({ dimensions: 2 })
		});
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/evaluate', {
				body: JSON.stringify({
					cases: [
						{
							expectedSources: ['source'],
							id: 'bad-case-retrieval',
							query: 'anything',
							retrieval: {
								typo: 'vector'
							}
						}
					]
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);

		const body = (await response.json()) as { ok: boolean; error: string };

		expect(response.status).toBe(400);
		expect(body.ok).toBe(false);
		expect(body.error).toBe(
			'Expected payload shape: { cases: [{ id, query, expectedChunkIds|expectedSources|expectedDocumentIds }] }'
		);
	});

	it('compares retrieval strategies and persists comparison history', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('question about alpha')) return [0, 1];
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'beta',
					text: 'beta guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-history-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalComparisonHistoryStore: historyStore
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					cases: [
						{
							expectedDocumentIds: ['alpha-doc'],
							id: 'alpha-case',
							query: 'question about alpha'
						}
					],
					groupKey: 'docs-release',
					label: 'Docs retrieval benchmark',
					persistRun: true,
					retrievals: [
						{ id: 'vector', retrieval: 'vector' },
						{ id: 'lexical', retrieval: 'lexical' }
					],
					tags: ['docs', 'release']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		const body = (await response.json()) as {
			ok: boolean;
			comparison?: {
				entries: Array<{ retrievalId: string }>;
				summary: { bestByPassingRate?: string };
			};
		};

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.comparison?.entries).toHaveLength(2);
		expect(body.comparison?.summary.bestByPassingRate).toBe('lexical');

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/history?limit=5&label=docs&winnerId=lexical&groupKey=docs-release&tag=release'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			runs?: Array<{
				groupKey?: string;
				label: string;
				tags?: string[];
				decisionSummary?: {
					baselineRetrievalId?: string;
					candidateRetrievalId?: string;
					delta?: { passingRateDelta: number };
				};
				comparison: { summary: { bestByPassingRate?: string } };
			}>;
		};

		expect(historyResponse.status).toBe(200);
		expect(historyBody.runs?.[0]).toEqual(
			expect.objectContaining({
				decisionSummary: expect.objectContaining({
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					delta: expect.objectContaining({
						passingRateDelta: 0
					})
				}),
				groupKey: 'docs-release',
				label: 'Docs retrieval benchmark',
				tags: ['docs', 'release'],
				comparison: expect.objectContaining({
					summary: expect.objectContaining({
						bestByPassingRate: 'lexical'
					})
				})
			})
		);
	});

	it('fails adaptive planner benchmark regressions against the active runtime baseline', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('question about alpha')) return [1, 0];
				if (text.includes('alpha release guide')) return [0, 1];
				if (text.includes('beta fallback note')) return [1, 0];
				return [0, 0];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'guide/alpha.md',
					text: 'alpha release guide'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'guide/beta.md',
					text: 'beta fallback note'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-runtime-benchmark-history-${Date.now()}.json`
		);
		const baselineStore = createRAGFileRetrievalBaselineStore(
			`/tmp/rag-runtime-benchmark-baselines-${Date.now()}.json`
		);
		await baselineStore.saveBaseline({
			approvedAt: 1,
			approvedBy: 'alex',
			groupKey: 'runtime-native-planner',
			id: 'runtime-baseline-1',
			label: 'Runtime baseline',
			promotedAt: 1,
			retrievalId: 'lexical',
			status: 'active',
			version: 1
		});

		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalBaselineStore: baselineStore,
				retrievalComparisonHistoryStore: historyStore
			})
		);

		const response = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					baselineRetrievalId: 'lexical',
					candidateRetrievalId: 'vector',
					cases: [
						{
							expectedDocumentIds: ['alpha-doc'],
							id: 'runtime-case',
							query: 'question about alpha',
							topK: 1
						}
					],
					groupKey: 'runtime-native-planner',
					label: 'Adaptive Native Planner Benchmark',
					persistRun: true,
					retrievals: [
						{ id: 'lexical', retrieval: 'lexical' },
						{ id: 'vector', retrieval: 'vector' }
					],
					suiteId: 'rag-native-planner-larger-corpus'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(200);

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/history?groupKey=runtime-native-planner&suiteId=rag-native-planner-larger-corpus&limit=1'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			runs?: Array<{
				releaseVerdict?: { status?: string };
				decisionSummary?: {
					gate?: { status?: string; reasons?: string[] };
				};
			}>;
		};
		expect(historyResponse.status).toBe(200);
		expect(historyBody.runs?.[0]).toEqual(
			expect.objectContaining({
				decisionSummary: expect.objectContaining({
					gate: expect.objectContaining({
						reasons: expect.arrayContaining([
							expect.stringContaining('passing rate delta'),
							expect.stringContaining('average F1 delta')
						]),
						status: 'fail'
					})
				}),
				releaseVerdict: expect.objectContaining({
					status: 'fail'
				})
			})
		);
	});

	it('surfaces retrieval comparison summaries in ops and status', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('question about alpha')) return [0, 1];
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'beta',
					text: 'beta guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-ops-history-${Date.now()}.json`
		);
		const traceStore = createRAGFileSearchTraceStore(
			`/tmp/rag-retrieval-comparison-ops-traces-${Date.now()}.json`
		);
		const pruneHistoryStore = createRAGFileSearchTracePruneHistoryStore(
			`/tmp/rag-retrieval-comparison-ops-prunes-${Date.now()}.json`
		);
		const evaluationSuiteSnapshotHistoryStore =
			createRAGFileEvaluationSuiteSnapshotHistoryStore(
				`/tmp/rag-retrieval-comparison-ops-snapshots-${Date.now()}.json`
			);
		const app = new Elysia().use(
			ragChat({
				collection,
				evaluationSuiteSnapshotHistoryStore,
				path: '/rag',
				provider,
				retrievalComparisonHistoryStore: historyStore,
				searchTracePruneHistoryStore: pruneHistoryStore,
				searchTraceStore: traceStore
			})
		);

		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'lexical',
						bestByPassingRate: 'lexical',
						fastest: 'lexical'
					},
					suiteId: 'comparison-suite-1',
					suiteLabel: 'Docs retrieval benchmark'
				},
				decisionSummary: {
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					delta: {
						averageF1Delta: 0.2,
						elapsedMsDelta: -1,
						passingRateDelta: 10
					},
					winnerByAverageF1: 'lexical',
					winnerByPassingRate: 'lexical'
				},
				elapsedMs: 10,
				finishedAt: 100,
				groupKey: 'docs-release',
				id: 'seed-run-1',
				label: 'Docs retrieval benchmark',
				startedAt: 90,
				suiteId: 'comparison-suite-1',
				suiteLabel: 'Docs retrieval benchmark',
				tags: ['docs', 'release']
			},
			store: historyStore
		});
		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'lexical',
						bestByPassingRate: 'lexical',
						fastest: 'lexical'
					},
					suiteId: 'comparison-suite-2',
					suiteLabel: 'Docs retrieval benchmark'
				},
				decisionSummary: {
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					delta: {
						averageF1Delta: 0.1,
						elapsedMsDelta: -1,
						passingRateDelta: 0
					},
					winnerByAverageF1: 'lexical',
					winnerByPassingRate: 'lexical'
				},
				elapsedMs: 9,
				finishedAt: 200,
				groupKey: 'docs-release',
				id: 'seed-run-2',
				label: 'Docs retrieval benchmark',
				startedAt: 191,
				suiteId: 'comparison-suite-2',
				suiteLabel: 'Docs retrieval benchmark',
				tags: ['docs', 'release']
			},
			store: historyStore
		});

		const searchResponse = await app.handle(
			new Request('http://localhost/rag/search', {
				body: JSON.stringify({
					includeTrace: true,
					persistTrace: true,
					query: 'alpha',
					topK: 1,
					traceGroupKey: 'docs-search',
					traceTags: ['docs']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(searchResponse.status).toBe(200);

		const pruneResponse = await app.handle(
			new Request('http://localhost/rag/traces/prune', {
				body: JSON.stringify({
					maxRecordsPerGroup: 1,
					tag: 'docs'
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(pruneResponse.status).toBe(200);

		const comparisonResponse = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['alpha-doc'],
							id: 'alpha-case',
							query: 'question about alpha'
						}
					],
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					groupKey: 'docs-release',
					label: 'Docs retrieval benchmark',
					persistRun: true,
					retrievals: [
						{ id: 'vector', retrieval: 'vector' },
						{ id: 'lexical', retrieval: 'lexical' }
					],
					tags: ['docs', 'release']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(comparisonResponse.status).toBe(200);

		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'vector',
						bestByMultivectorCollapsedCases: 'vector',
						bestByMultivectorLexicalHitCases: 'lexical',
						bestByMultivectorVectorHitCases: 'vector',
						bestByPassingRate: 'vector',
						fastest: 'vector'
					},
					suiteId: 'comparison-suite-3',
					suiteLabel: 'Docs retrieval benchmark gate'
				},
				decisionSummary: {
					baselineRetrievalId: 'lexical',
					candidateRetrievalId: 'vector',
					delta: {
						averageF1Delta: -0.2,
						elapsedMsDelta: 1,
						multiVectorLexicalHitCasesDelta: -1,
						passingRateDelta: -10
					},
					gate: {
						policy: {
							minMultiVectorLexicalHitCasesDelta: 0,
							severity: 'fail'
						},
						reasons: [
							'multivector lexical-hit delta -1 is below 0'
						],
						status: 'fail'
					},
					winnerByMultivectorCollapsedCases: 'vector',
					winnerByMultivectorLexicalHitCases: 'lexical',
					winnerByMultivectorVectorHitCases: 'vector',
					winnerByAverageF1: 'vector',
					winnerByPassingRate: 'vector'
				},
				elapsedMs: 11,
				finishedAt: 9999999999999,
				groupKey: 'docs-release',
				id: 'seed-run-3',
				label: 'Docs retrieval benchmark gate',
				startedAt: 9999999999988,
				suiteId: 'comparison-suite-3',
				suiteLabel: 'Docs retrieval benchmark gate',
				tags: ['docs', 'release', 'gate'],
				releaseVerdict: {
					status: 'fail',
					summary: 'Candidate failed the active baseline gate.'
				}
			},
			store: historyStore
		});

		for (const endpoint of ['/rag/ops', '/rag/status']) {
			const response = await app.handle(
				new Request(`http://localhost${endpoint}`)
			);
			const body = (await response.json()) as {
				ok: boolean;
				retrievalComparisons?: {
					adaptiveNativePlannerBenchmark?: {
						suiteId: string;
						snapshotHistoryPresentation?: { summary: string };
					};
					presentationCueBenchmark?: {
						suiteId: string;
						snapshotHistoryPresentation?: { summary: string };
					};
					alerts?: Array<{
						kind: string;
						severity: string;
						groupKey?: string;
						message?: string;
					}>;
					configured: boolean;
					releaseGroups?: Array<{
						groupKey: string;
						classification?: string;
					}>;
					recentRuns?: Array<{ label: string }>;
					latest?: {
						groupKey?: string;
						label: string;
						bestByPassingRate?: string;
						bestByAverageF1?: string;
						bestByMultivectorCollapsedCases?: string;
						bestByMultivectorLexicalHitCases?: string;
						bestByMultivectorVectorHitCases?: string;
						decisionSummary?: {
							baselineRetrievalId?: string;
							candidateRetrievalId?: string;
						};
						tags?: string[];
					};
					stableWinnerByPassingRate?: {
						retrievalId: string;
						runCount: number;
					};
					relatedSearchTraces?: { totalTraces: number };
					relatedPruneRun?: { trigger: string };
				};
			};

			expect(response.status).toBe(200);
			expect(body.retrievalComparisons).toEqual(
				expect.objectContaining({
					adaptiveNativePlannerBenchmark: expect.objectContaining({
						snapshotHistoryPresentation: expect.objectContaining({
							summary: 'No saved suite snapshots yet.'
						}),
						suiteId: 'rag-native-planner-larger-corpus'
					}),
					presentationCueBenchmark: expect.objectContaining({
						snapshotHistoryPresentation: expect.objectContaining({
							summary: 'No saved suite snapshots yet.'
						}),
						suiteId: 'rag-presentation-cue-parity'
					}),
					configured: true,
					alerts: expect.arrayContaining([
						expect.objectContaining({
							groupKey: 'docs-release',
							kind: 'stable_winner_changed',
							severity: 'warning'
						}),
						expect.objectContaining({
							groupKey: 'docs-release',
							kind: 'baseline_regression',
							severity: 'warning'
						}),
						expect.objectContaining({
							classification: 'multivector',
							groupKey: 'docs-release',
							kind: 'baseline_gate_failed',
							message: expect.stringContaining(
								'multivector lexical-hit delta -1 is below 0'
							),
							severity: 'warning'
						})
					]),
					latest: expect.objectContaining({
						bestByMultivectorCollapsedCases: 'vector',
						bestByMultivectorLexicalHitCases: 'lexical',
						bestByMultivectorVectorHitCases: 'vector',
						decisionSummary: expect.objectContaining({
							baselineRetrievalId: 'lexical',
							candidateRetrievalId: 'vector'
						}),
						groupKey: 'docs-release',
						label: 'Docs retrieval benchmark gate',
						bestByAverageF1: 'vector',
						bestByPassingRate: 'vector',
						tags: ['docs', 'release', 'gate']
					}),
					stableWinnerByPassingRate: expect.objectContaining({
						retrievalId: 'lexical',
						runCount: 3
					}),
					relatedPruneRun: expect.objectContaining({
						trigger: 'manual'
					}),
					relatedSearchTraces: expect.objectContaining({
						totalTraces: 1
					}),
					releaseGroups: expect.arrayContaining([
						expect.objectContaining({
							classification: 'multivector',
							groupKey: 'docs-release'
						})
					])
				})
			);
			expect(body.retrievalComparisons?.recentRuns?.[0]).toEqual(
				expect.objectContaining({
					label: 'Docs retrieval benchmark gate'
				})
			);
		}
	});

	it('classifies runtime planner regressions in ops and release incident status payloads', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				return [0, 1];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-runtime-history-${Date.now()}.json`
		);
		const incidentStore = createRAGFileRetrievalReleaseIncidentStore(
			`/tmp/rag-retrieval-runtime-incidents-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalComparisonHistoryStore: historyStore,
				retrievalReleaseIncidentStore: incidentStore
			})
		);

		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'balanced',
						bestByEvidenceReconcileCases: 'balanced',
						bestByLowestRuntimeCandidateBudgetExhaustedCases:
							'balanced',
						bestByLowestRuntimeUnderfilledTopKCases: 'balanced',
						bestByPassingRate: 'balanced',
						fastest: 'latency'
					},
					suiteId: 'runtime-suite',
					suiteLabel: 'Runtime Suite'
				},
				decisionSummary: {
					baselineRetrievalId: 'balanced',
					candidateRetrievalId: 'latency',
					delta: {
						averageF1Delta: -0.05,
						evidenceReconcileCasesDelta: -1,
						elapsedMsDelta: -5,
						passingRateDelta: -5,
						runtimeCandidateBudgetExhaustedCasesDelta: 2,
						runtimeUnderfilledTopKCasesDelta: 1
					},
					gate: {
						policy: {
							minEvidenceReconcileCasesDelta: 0,
							maxRuntimeCandidateBudgetExhaustedCasesDelta: 0,
							maxRuntimeUnderfilledTopKCasesDelta: 0,
							severity: 'fail'
						},
						reasons: [
							'runtime candidate-budget-exhausted delta 2 exceeds 0',
							'runtime underfilled-topk delta 1 exceeds 0'
						],
						status: 'fail'
					},
					winnerByAverageF1: 'balanced',
					winnerByEvidenceReconcileCases: 'balanced',
					winnerByLowestRuntimeCandidateBudgetExhaustedCases:
						'balanced',
					winnerByLowestRuntimeUnderfilledTopKCases: 'balanced',
					winnerByPassingRate: 'balanced'
				},
				elapsedMs: 12,
				finishedAt: 400,
				groupKey: 'docs-runtime',
				id: 'runtime-run-1',
				label: 'Runtime planner benchmark',
				startedAt: 388,
				suiteId: 'runtime-suite',
				suiteLabel: 'Runtime Suite',
				tags: ['runtime']
			},
			store: historyStore
		});
		await persistRAGRetrievalReleaseIncident({
			record: {
				baselineRetrievalId: 'balanced',
				candidateRetrievalId: 'latency',
				classification: 'runtime',
				groupKey: 'docs-runtime',
				id: 'runtime-incident-1',
				kind: 'gate_failure',
				message: 'runtime candidate-budget-exhausted delta 2 exceeds 0',
				severity: 'warning',
				sourceRunId: 'runtime-run-1',
				status: 'open',
				targetRolloutLabel: 'canary',
				triggeredAt: 401
			},
			store: incidentStore
		});

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			ok: boolean;
			retrievalComparisons?: {
				alerts?: Array<{
					classification?: string;
					kind: string;
				}>;
				latest?: {
					bestByEvidenceReconcileCases?: string;
					bestByLowestRuntimeCandidateBudgetExhaustedCases?: string;
					bestByLowestRuntimeUnderfilledTopKCases?: string;
					groupKey?: string;
				};
				releaseGroups?: Array<{
					classification?: string;
					groupKey: string;
				}>;
			};
		};

		expect(opsResponse.status).toBe(200);
		expect(opsBody.retrievalComparisons).toEqual(
			expect.objectContaining({
				alerts: expect.arrayContaining([
					expect.objectContaining({
						classification: 'runtime',
						kind: 'baseline_gate_failed'
					})
				]),
				latest: expect.objectContaining({
					bestByEvidenceReconcileCases: 'balanced',
					bestByLowestRuntimeCandidateBudgetExhaustedCases:
						'balanced',
					bestByLowestRuntimeUnderfilledTopKCases: 'balanced',
					groupKey: 'docs-runtime'
				}),
				releaseGroups: expect.arrayContaining([
					expect.objectContaining({
						classification: 'runtime',
						groupKey: 'docs-runtime'
					})
				])
			})
		);

		const releaseIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/incidents')
		);
		const releaseIncidentStatusBody =
			(await releaseIncidentStatusResponse.json()) as {
				ok: boolean;
				incidentClassificationSummary?: {
					openRuntimeCount?: number;
					resolvedRuntimeCount?: number;
					totalRuntimeCount?: number;
				};
				recentIncidents?: Array<{
					classification?: string;
					groupKey?: string;
				}>;
			};

		expect(releaseIncidentStatusResponse.status).toBe(200);
		expect(releaseIncidentStatusBody.incidentClassificationSummary).toEqual(
			expect.objectContaining({
				openRuntimeCount: 0,
				resolvedRuntimeCount: 1,
				totalRuntimeCount: 1
			})
		);
		expect(releaseIncidentStatusBody.recentIncidents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					classification: 'runtime',
					groupKey: 'docs-runtime'
				})
			])
		);
	});

	it('classifies evidence reconcile regressions in ops and release incident status payloads', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				return [0, 1];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-evidence-history-${Date.now()}.json`
		);
		const incidentStore = createRAGFileRetrievalReleaseIncidentStore(
			`/tmp/rag-retrieval-evidence-incidents-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalComparisonHistoryStore: historyStore,
				retrievalReleaseIncidentStore: incidentStore
			})
		);

		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'hybrid-native',
						bestByEvidenceReconcileCases: 'hybrid-native',
						bestByOfficeEvidenceReconcileCases: 'hybrid-native',
						bestByOfficeParagraphEvidenceReconcileCases:
							'hybrid-native',
						bestByPresentationTitleCueCases: 'ocr-only',
						bestByPresentationBodyCueCases: 'hybrid-native',
						bestByPresentationNotesCueCases: 'ocr-only',
						bestByPassingRate: 'hybrid-native',
						fastest: 'ocr-only'
					},
					suiteId: 'evidence-suite',
					suiteLabel: 'Evidence Suite'
				},
				decisionSummary: {
					baselineRetrievalId: 'hybrid-native',
					candidateRetrievalId: 'ocr-only',
					delta: {
						averageF1Delta: 0,
						evidenceReconcileCasesDelta: -2,
						officeParagraphEvidenceReconcileCasesDelta: -2,
						elapsedMsDelta: -3,
						passingRateDelta: 0
					},
					gate: {
						policy: {
							minEvidenceReconcileCasesDelta: 0,
							severity: 'fail'
						},
						reasons: ['evidence reconcile delta -2 is below 0'],
						status: 'fail'
					},
					winnerByAverageF1: 'hybrid-native',
					winnerByEvidenceReconcileCases: 'hybrid-native',
					winnerByPassingRate: 'hybrid-native'
				},
				elapsedMs: 12,
				finishedAt: 400,
				groupKey: 'docs-evidence',
				id: 'evidence-run-1',
				label: 'Evidence reconcile benchmark',
				startedAt: 388,
				suiteId: 'evidence-suite',
				suiteLabel: 'Evidence Suite',
				tags: ['evidence']
			},
			store: historyStore
		});
		await persistRAGRetrievalReleaseIncident({
			record: {
				baselineRetrievalId: 'hybrid-native',
				candidateRetrievalId: 'ocr-only',
				classification: 'evidence',
				groupKey: 'docs-evidence',
				id: 'evidence-incident-1',
				kind: 'gate_failure',
				message: 'evidence reconcile delta -2 is below 0',
				severity: 'warning',
				sourceRunId: 'evidence-run-1',
				status: 'open',
				targetRolloutLabel: 'canary',
				triggeredAt: 401
			},
			store: incidentStore
		});

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			ok: boolean;
			retrievalComparisons?: {
				alerts?: Array<{
					classification?: string;
					kind: string;
				}>;
				latest?: {
					bestByEvidenceReconcileCases?: string;
					bestByOfficeEvidenceReconcileCases?: string;
					bestByOfficeParagraphEvidenceReconcileCases?: string;
					bestByPresentationTitleCueCases?: string;
					bestByPresentationBodyCueCases?: string;
					bestByPresentationNotesCueCases?: string;
					groupKey?: string;
				};
				releaseGroups?: Array<{
					classification?: string;
					groupKey: string;
				}>;
			};
		};

		expect(opsResponse.status).toBe(200);
		expect(opsBody.retrievalComparisons).toEqual(
			expect.objectContaining({
				alerts: expect.arrayContaining([
					expect.objectContaining({
						classification: 'evidence',
						kind: 'baseline_gate_failed'
					})
				]),
				latest: expect.objectContaining({
					bestByEvidenceReconcileCases: 'hybrid-native',
					bestByOfficeEvidenceReconcileCases: 'hybrid-native',
					bestByOfficeParagraphEvidenceReconcileCases:
						'hybrid-native',
					bestByPresentationTitleCueCases: 'ocr-only',
					bestByPresentationBodyCueCases: 'hybrid-native',
					bestByPresentationNotesCueCases: 'ocr-only',
					groupKey: 'docs-evidence'
				}),
				releaseGroups: expect.arrayContaining([
					expect.objectContaining({
						classification: 'evidence',
						groupKey: 'docs-evidence'
					})
				])
			})
		);

		const releaseIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/incidents')
		);
		const releaseIncidentStatusBody =
			(await releaseIncidentStatusResponse.json()) as {
				ok: boolean;
				incidentClassificationSummary?: {
					openEvidenceCount?: number;
					resolvedEvidenceCount?: number;
					totalEvidenceCount?: number;
				};
				recentIncidents?: Array<{
					classification?: string;
					groupKey?: string;
				}>;
			};

		expect(releaseIncidentStatusResponse.status).toBe(200);
		expect(releaseIncidentStatusBody.incidentClassificationSummary).toEqual(
			expect.objectContaining({
				openEvidenceCount: 0,
				resolvedEvidenceCount: 1,
				totalEvidenceCount: 1
			})
		);
		expect(releaseIncidentStatusBody.recentIncidents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					classification: 'evidence',
					groupKey: 'docs-evidence'
				})
			])
		);
	});

	it('promotes retrieval baselines and applies active group baselines automatically', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('question about alpha')) return [0, 1];
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('beta')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha guide'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'beta',
					text: 'beta guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-baseline-history-${Date.now()}.json`
		);
		const baselineStore = createRAGFileRetrievalBaselineStore(
			`/tmp/rag-retrieval-comparison-baseline-store-${Date.now()}.json`
		);
		const decisionStore = createRAGFileRetrievalReleaseDecisionStore(
			`/tmp/rag-retrieval-comparison-decision-store-${Date.now()}.json`
		);
		const handoffDecisionStore =
			createRAGFileRetrievalLaneHandoffDecisionStore(
				`/tmp/rag-retrieval-handoff-decision-store-${Date.now()}.json`
			);
		const incidentStore = createRAGFileRetrievalReleaseIncidentStore(
			`/tmp/rag-retrieval-comparison-incident-store-${Date.now()}.json`
		);
		const incidentRemediationStore =
			createRAGFileRetrievalIncidentRemediationDecisionStore(
				`/tmp/rag-retrieval-incident-remediation-store-${Date.now()}.json`
			);
		const incidentRemediationExecutionHistoryStore =
			createRAGFileRetrievalIncidentRemediationExecutionHistoryStore(
				`/tmp/rag-retrieval-incident-remediation-execution-history-store-${Date.now()}.json`
			);
		const evaluationSuiteSnapshotHistoryStore =
			createRAGFileEvaluationSuiteSnapshotHistoryStore(
				`/tmp/rag-evaluation-suite-snapshot-history-${Date.now()}.json`
			);
		const releaseEvents: string[] = [];
		const app = new Elysia().use(
			ragChat({
				collection,
				onRetrievalReleaseEvent: (event) => {
					releaseEvents.push(
						`${event.kind}:${event.incident.groupKey}:${event.incident.kind}`
					);
				},
				path: '/rag',
				provider,
				retrievalBaselineStore: baselineStore,
				retrievalBaselineGatePoliciesByRolloutLabel: {
					canary: {
						minPassingRateDelta: 0,
						severity: 'warn'
					},
					stable: {
						minPassingRateDelta: 1,
						severity: 'fail'
					}
				},
				retrievalComparisonHistoryStore: historyStore,
				retrievalIncidentRemediationDecisionStore:
					incidentRemediationStore,
				retrievalIncidentRemediationExecutionHistoryStore:
					incidentRemediationExecutionHistoryStore,
				evaluationSuiteSnapshotHistoryStore,
				retrievalReleaseDecisionStore: decisionStore,
				retrievalLaneHandoffDecisionStore: handoffDecisionStore,
				retrievalReleaseIncidentStore: incidentStore,
				retrievalReleasePolicies: {
					'docs-release': {
						requireApprovalBeforePromotion: true
					}
				},
				retrievalReleasePoliciesByGroupAndRolloutLabel: {
					'docs-release': {
						canary: {
							requireApprovalBeforePromotion: false
						},
						stable: {
							approvalMaxAgeMs: 60_000,
							requireApprovalBeforePromotion: true
						}
					}
				}
			})
		);

		const promoteResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote',
				{
					body: JSON.stringify({
						approvedAt: 123,
						approvedBy: 'alex',
						approvalNotes: 'release gate baseline',
						groupKey: 'docs-release',
						label: 'Lexical release baseline',
						policy: {
							minAverageF1Delta: 0,
							minPassingRateDelta: 0,
							severity: 'fail'
						},
						retrievalId: 'lexical',
						rolloutLabel: 'stable',
						tags: ['docs', 'release']
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const promoteBody = (await promoteResponse.json()) as {
			ok: boolean;
			baseline?: {
				retrievalId: string;
				groupKey: string;
				approvedBy?: string;
				policy?: { minAverageF1Delta?: number };
			};
			rolloutState?: {
				targetRolloutLabel?: string;
				requiresApproval?: boolean;
				ready: boolean;
				remediationActions?: string[];
			};
		};
		expect(promoteResponse.status).toBe(200);
		expect(promoteBody.baseline).toEqual(
			expect.objectContaining({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				rolloutLabel: 'stable',
				policy: expect.objectContaining({
					minAverageF1Delta: 0
				}),
				retrievalId: 'lexical'
			})
		);
		expect(promoteBody.rolloutState).toEqual(
			expect.objectContaining({
				ready: true,
				remediationActions: expect.arrayContaining([
					expect.stringContaining('Monitor')
				]),
				requiresApproval: true,
				targetRolloutLabel: 'stable'
			})
		);

		const lanePromoteResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote-lane',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						groupKey: 'docs-release',
						retrievalId: 'lexical',
						rolloutLabel: 'canary',
						tags: ['docs', 'release']
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const lanePromoteBody = (await lanePromoteResponse.json()) as {
			ok: boolean;
			baseline?: { retrievalId: string; rolloutLabel?: string };
			rolloutState?: {
				targetRolloutLabel?: string;
				requiresApproval?: boolean;
				ready: boolean;
				gateStatus?: string;
				remediationActions?: string[];
			};
		};
		expect(lanePromoteResponse.status).toBe(200);
		expect(lanePromoteBody.baseline).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				rolloutLabel: 'canary'
			})
		);
		expect(lanePromoteBody.rolloutState).toEqual(
			expect.objectContaining({
				ready: true,
				remediationActions: expect.arrayContaining([
					expect.stringContaining('Monitor')
				]),
				requiresApproval: false,
				targetRolloutLabel: 'canary'
			})
		);

		const baselinesResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines?groupKey=docs-release&tag=release&limit=5&status=active'
			)
		);
		const baselinesBody = (await baselinesResponse.json()) as {
			ok: boolean;
			baselines?: Array<{
				retrievalId: string;
				groupKey: string;
				approvedBy?: string;
			}>;
		};
		expect(baselinesResponse.status).toBe(200);
		expect(baselinesBody.baselines?.[0]).toEqual(
			expect.objectContaining({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				retrievalId: 'lexical'
			})
		);

		const secondPromoteResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						groupKey: 'docs-release',
						label: 'Vector release baseline',
						policy: {
							minPassingRateDelta: 1,
							severity: 'fail'
						},
						retrievalId: 'vector',
						rolloutLabel: 'canary',
						tags: ['docs', 'release']
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(secondPromoteResponse.status).toBe(200);

		const baselineHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines?groupKey=docs-release&limit=5'
			)
		);
		const baselineHistoryBody = (await baselineHistoryResponse.json()) as {
			ok: boolean;
			baselines?: Array<{
				retrievalId: string;
				status: string;
				version: number;
			}>;
		};
		expect(
			baselineHistoryBody.baselines?.map((entry) => entry.retrievalId)
		).toEqual(['vector', 'lexical', 'lexical']);
		expect(
			baselineHistoryBody.baselines?.map((entry) => entry.status)
		).toEqual(['active', 'superseded', 'active']);
		expect(
			baselineHistoryBody.baselines?.map((entry) => entry.version)
		).toEqual([3, 2, 1]);

		const compareResponse = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['alpha-doc'],
							id: 'alpha-case',
							query: 'question about alpha'
						}
					],
					candidateRetrievalId: 'lexical',
					groupKey: 'docs-release',
					label: 'Docs release candidate gate',
					persistRun: true,
					retrievals: [
						{ id: 'vector', retrieval: 'vector' },
						{ id: 'lexical', retrieval: 'lexical' }
					],
					tags: ['docs', 'release', 'gate']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(compareResponse.status).toBe(200);

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/history?groupKey=docs-release&tag=gate&limit=5'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			ok: boolean;
			runs?: Array<{
				id: string;
				decisionSummary?: {
					baselineRetrievalId?: string;
					candidateRetrievalId?: string;
					gate?: { status: string; reasons: string[] };
				};
				releaseVerdict?: { status: string; summary: string };
			}>;
		};
		expect(historyResponse.status).toBe(200);
		expect(historyBody.runs?.[0]?.decisionSummary).toEqual(
			expect.objectContaining({
				baselineRetrievalId: 'vector',
				candidateRetrievalId: 'lexical',
				gate: expect.objectContaining({
					status: 'fail'
				})
			})
		);
		expect(historyBody.runs?.[0]?.releaseVerdict).toEqual(
			expect.objectContaining({
				status: 'fail'
			})
		);

		const blockedPromoteFromRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote-run',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						approvalNotes: 'promote candidate from comparison run',
						groupKey: 'docs-release',
						sourceRunId: historyBody.runs?.[0]?.id,
						retrievalId: 'lexical'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const blockedPromoteFromRunBody =
			(await blockedPromoteFromRunResponse.json()) as {
				ok: boolean;
				error?: string;
			};
		expect(blockedPromoteFromRunResponse.status).toBe(400);
		expect(blockedPromoteFromRunBody.error).toContain(
			'Set overrideGate to true to force promotion'
		);

		const blockedApprovalPromoteFromRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote-run',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						approvalNotes: 'promote candidate from comparison run',
						groupKey: 'docs-release',
						overrideGate: true,
						overrideReason:
							'approved override for release candidate',
						sourceRunId: historyBody.runs?.[0]?.id,
						retrievalId: 'lexical'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const blockedApprovalPromoteFromRunBody =
			(await blockedApprovalPromoteFromRunResponse.json()) as {
				ok: boolean;
				error?: string;
			};
		expect(blockedApprovalPromoteFromRunResponse.status).toBe(400);
		expect(blockedApprovalPromoteFromRunBody.error).toContain(
			'explicit approval decision before promotion'
		);

		const promotionCandidatesResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/candidates?groupKey=docs-release&tag=gate&targetRolloutLabel=stable&limit=5&approved=false&ready=false&blocked=true&reviewStatus=blocked&freshnessStatus=not_applicable&sortBy=gateSeverity&sortDirection=desc'
			)
		);
		const promotionCandidatesBody =
			(await promotionCandidatesResponse.json()) as {
				ok: boolean;
				candidates?: Array<{
					approvalFreshnessStatus?: string;
					candidateRetrievalId?: string;
					delta?: {
						averageF1Delta?: number;
						passingRateDelta?: number;
					};
					effectiveBaselineGatePolicy?: {
						minPassingRateDelta?: number;
						severity?: string;
					};
					effectiveReleasePolicy?: {
						approvalMaxAgeMs?: number;
						requireApprovalBeforePromotion?: boolean;
					};
					priority?: string;
					priorityScore?: number;
					ready: boolean;
					releaseVerdictStatus?: string;
					requiresApproval: boolean;
					approved: boolean;
					reviewStatus?: string;
					sortReason?: string;
					targetRolloutLabel?: string;
				}>;
			};
		expect(promotionCandidatesResponse.status).toBe(200);
		expect(promotionCandidatesBody.candidates?.[0]).toEqual(
			expect.objectContaining({
				approvalFreshnessStatus: 'not_applicable',
				approved: false,
				candidateRetrievalId: 'lexical',
				delta: expect.objectContaining({
					averageF1Delta: expect.any(Number),
					passingRateDelta: expect.any(Number)
				}),
				effectiveBaselineGatePolicy: expect.objectContaining({
					minPassingRateDelta: 1,
					severity: 'fail'
				}),
				effectiveReleasePolicy: expect.objectContaining({
					approvalMaxAgeMs: 60_000,
					requireApprovalBeforePromotion: true
				}),
				priority: 'gate_fail',
				priorityScore: 2,
				ready: false,
				releaseVerdictStatus: 'fail',
				requiresApproval: true,
				reviewStatus: 'blocked',
				sortReason: 'candidate is blocked by a gate failure',
				targetRolloutLabel: 'stable'
			})
		);

		const approveResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/approve',
				{
					body: JSON.stringify({
						decidedBy: 'alex',
						groupKey: 'docs-release',
						overrideGate: true,
						overrideReason: 'accepted despite gate failure',
						sourceRunId: historyBody.runs?.[0]?.id
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(approveResponse.status).toBe(200);

		const promoteFromRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote-run',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						approvalNotes: 'promote candidate from comparison run',
						groupKey: 'docs-release',
						overrideGate: true,
						overrideReason:
							'approved override for release candidate',
						sourceRunId: historyBody.runs?.[0]?.id,
						retrievalId: 'lexical'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const promoteFromRunBody = (await promoteFromRunResponse.json()) as {
			ok: boolean;
			baseline?: {
				retrievalId: string;
				version: number;
				sourceRunId?: string;
			};
		};
		expect(promoteFromRunResponse.status).toBe(200);
		expect(promoteFromRunBody.baseline).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				sourceRunId: historyBody.runs?.[0]?.id
			})
		);
		expect(promoteFromRunBody.baseline?.version).toBeGreaterThan(3);

		const revertResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/revert',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						approvalNotes: 'rollback to version 2',
						groupKey: 'docs-release',
						version: 2
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const revertBody = (await revertResponse.json()) as {
			ok: boolean;
			baseline?: { retrievalId: string; version: number };
		};
		expect(revertResponse.status).toBe(200);
		expect(revertBody.baseline).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical'
			})
		);
		expect(revertBody.baseline?.version).toBeGreaterThan(4);

		const decisionHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/decisions?groupKey=docs-release&limit=5&freshnessStatus=not_applicable'
			)
		);
		const decisionHistoryBody = (await decisionHistoryResponse.json()) as {
			ok: boolean;
			decisions?: Array<{
				kind: string;
				retrievalId: string;
				version: number;
				restoredFromVersion?: number;
				overrideGate?: boolean;
				overrideReason?: string;
			}>;
		};
		expect(decisionHistoryResponse.status).toBe(200);
		expect(
			decisionHistoryBody.decisions?.map(
				(entry) =>
					`${entry.kind}:${entry.retrievalId}:${entry.version}:${entry.restoredFromVersion ?? 'na'}:${entry.overrideGate === true ? 'override' : 'normal'}`
			)
		).toEqual([
			'revert:lexical:5:2:normal',
			'promote:lexical:4:na:override',
			'approve:lexical:undefined:na:override',
			'promote:vector:3:na:normal',
			'promote:lexical:2:na:normal'
		]);

		const rejectResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/reject',
				{
					body: JSON.stringify({
						decidedBy: 'alex',
						groupKey: 'docs-release',
						notes: 'candidate regressed against baseline',
						sourceRunId: historyBody.runs?.[0]?.id
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(rejectResponse.status).toBe(200);

		const decisionHistoryAfterActionsResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/decisions?groupKey=docs-release&limit=6'
			)
		);
		const decisionHistoryAfterActionsBody =
			(await decisionHistoryAfterActionsResponse.json()) as {
				ok: boolean;
				decisions?: Array<{
					kind: string;
					retrievalId: string;
					notes?: string;
					overrideGate?: boolean;
				}>;
			};
		expect(
			decisionHistoryAfterActionsBody.decisions?.map(
				(entry) =>
					`${entry.kind}:${entry.retrievalId}:${entry.overrideGate === true ? 'override' : 'normal'}:${entry.notes ?? 'na'}`
			)
		).toEqual([
			'reject:lexical:normal:candidate regressed against baseline',
			'revert:lexical:normal:rollback to version 2',
			'promote:lexical:override:promote candidate from comparison run',
			'approve:lexical:override:na',
			'promote:vector:normal:na',
			'promote:lexical:normal:na'
		]);

		const benchmarkSnapshotResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/adaptive-native-planner/snapshots',
				{
					body: JSON.stringify({ limit: 3 }),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const benchmarkSnapshotBody =
			(await benchmarkSnapshotResponse.json()) as {
				ok: boolean;
				suite?: { id: string };
				snapshot?: { version: number };
				snapshotHistoryPresentation?: {
					summary: string;
					snapshots: Array<{ version: number }>;
				};
			};
		expect(benchmarkSnapshotResponse.status).toBe(200);
		expect(benchmarkSnapshotBody).toEqual(
			expect.objectContaining({
				ok: true,
				snapshot: expect.objectContaining({ version: 1 }),
				suite: expect.objectContaining({
					id: 'rag-native-planner-larger-corpus'
				}),
				snapshotHistoryPresentation: expect.objectContaining({
					summary: 'v1'
				})
			})
		);

		const benchmarkHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/adaptive-native-planner?limit=3'
			)
		);
		const benchmarkHistoryBody =
			(await benchmarkHistoryResponse.json()) as {
				ok: boolean;
				groupKey?: string;
				historyPresentation?: {
					summary: string;
				};
				snapshotHistoryPresentation?: {
					summary: string;
					snapshots: Array<{ version: number }>;
				};
			};
		expect(benchmarkHistoryResponse.status).toBe(200);
		expect(benchmarkHistoryBody.snapshotHistoryPresentation).toEqual(
			expect.objectContaining({
				summary: 'v1',
				snapshots: [expect.objectContaining({ version: 1 })]
			})
		);

		const benchmarkRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/adaptive-native-planner/run',
				{
					body: JSON.stringify({
						limit: 3,
						runLimit: 3
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const benchmarkRunBody = (await benchmarkRunResponse.json()) as {
			ok: boolean;
			groupKey?: string;
			fixtureVariants?: string[];
			latestFixtureVariant?: string;
			comparison?: {
				suiteId?: string;
				entries?: Array<{ retrievalId: string }>;
			};
			latestRun?: {
				groupKey?: string;
				suiteId?: string;
			};
			recentRuns?: Array<{
				groupKey?: string;
				suiteId?: string;
			}>;
			historyPresentation?: {
				summary: string;
			};
		};
		expect(benchmarkRunResponse.status).toBe(200);
		expect(benchmarkRunBody).toEqual(
			expect.objectContaining({
				comparison: expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({
							retrievalId: 'native-latency'
						}),
						expect.objectContaining({
							retrievalId: 'native-adaptive'
						})
					])
				}),
				fixtureVariants: ['current-collection'],
				groupKey: 'runtime-native-planner',
				historyPresentation: expect.objectContaining({
					summary: '1 recent runs'
				}),
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					groupKey: 'runtime-native-planner',
					suiteId: 'rag-native-planner-larger-corpus'
				}),
				ok: true,
				recentRuns: [
					expect.objectContaining({
						groupKey: 'runtime-native-planner',
						suiteId: 'rag-native-planner-larger-corpus'
					})
				]
			})
		);

		const backendBenchmarkHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/native-backend-comparison?limit=3'
			)
		);
		const backendBenchmarkHistoryBody =
			(await backendBenchmarkHistoryResponse.json()) as {
				ok: boolean;
				fixtureVariants?: string[];
				latestFixtureVariant?: string;
				groupKey?: string;
				snapshotHistoryPresentation?: {
					summary: string;
				};
			};
		expect(backendBenchmarkHistoryResponse.status).toBe(200);
		expect(backendBenchmarkHistoryBody).toEqual(
			expect.objectContaining({
				groupKey: 'runtime-native-backend-parity',
				ok: true
			})
		);

		const backendBenchmarkRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/native-backend-comparison/run',
				{
					body: JSON.stringify({
						limit: 3,
						runLimit: 3
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const backendBenchmarkRunBody =
			(await backendBenchmarkRunResponse.json()) as {
				ok: boolean;
				fixtureVariants?: string[];
				comparison?: {
					entries?: Array<{ retrievalId?: string }>;
				};
				groupKey?: string;
				latestFixtureVariant?: string;
				latestRun?: {
					decisionSummary?: {
						gate?: {
							policy?: {
								maxRuntimeCandidateBudgetExhaustedCasesDelta?: number;
								maxRuntimeUnderfilledTopKCasesDelta?: number;
								minAverageF1Delta?: number;
								minPassingRateDelta?: number;
								severity?: string;
							};
						};
					};
					groupKey?: string;
					suiteId?: string;
					tags?: string[];
				};
				recentRuns?: Array<{
					groupKey?: string;
					suiteId?: string;
					tags?: string[];
				}>;
			};
		expect(backendBenchmarkRunResponse.status).toBe(200);
		expect(backendBenchmarkRunBody).toEqual(
			expect.objectContaining({
				comparison: expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({
							retrievalId: 'native-latency'
						}),
						expect.objectContaining({
							retrievalId: 'native-adaptive'
						}),
						expect.objectContaining({
							retrievalId: 'hybrid-adaptive'
						}),
						expect.objectContaining({
							retrievalId: 'hybrid-transform'
						})
					])
				}),
				fixtureVariants: ['current-collection'],
				groupKey: 'runtime-native-backend-parity',
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					decisionSummary: expect.objectContaining({
						gate: expect.objectContaining({
							policy: expect.objectContaining({
								minEvidenceReconcileCasesDelta: 0,
								maxRuntimeCandidateBudgetExhaustedCasesDelta: 0,
								maxRuntimeUnderfilledTopKCasesDelta: 0,
								minAverageF1Delta: 0,
								minPassingRateDelta: 0,
								severity: 'fail'
							})
						})
					}),
					groupKey: 'runtime-native-backend-parity',
					suiteId: 'rag-native-backend-larger-corpus',
					tags: expect.arrayContaining([
						'runtime',
						'backend',
						'native',
						'backend:in_memory',
						'vector-mode:in_memory'
					])
				}),
				ok: true,
				recentRuns: [
					expect.objectContaining({
						groupKey: 'runtime-native-backend-parity',
						suiteId: 'rag-native-backend-larger-corpus'
					})
				]
			})
		);

		const presentationBenchmarkHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/presentation-cue?limit=3'
			)
		);
		const presentationBenchmarkHistoryBody =
			(await presentationBenchmarkHistoryResponse.json()) as {
				ok: boolean;
				groupKey?: string;
				snapshotHistoryPresentation?: {
					summary: string;
				};
			};
		expect(presentationBenchmarkHistoryResponse.status).toBe(200);
		expect(presentationBenchmarkHistoryBody).toEqual(
			expect.objectContaining({
				groupKey: 'presentation-cue-parity',
				ok: true
			})
		);

		const presentationBenchmarkRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/presentation-cue/run',
				{
					body: JSON.stringify({
						limit: 3,
						runLimit: 3
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const presentationBenchmarkRunBody =
			(await presentationBenchmarkRunResponse.json()) as {
				ok: boolean;
				fixtureVariants?: string[];
				comparison?: {
					entries?: Array<{ retrievalId?: string }>;
				};
				groupKey?: string;
				latestFixtureVariant?: string;
				latestRun?: {
					decisionSummary?: {
						gate?: {
							policy?: {
								minPresentationTitleCueCasesDelta?: number;
								minPresentationBodyCueCasesDelta?: number;
								minPresentationNotesCueCasesDelta?: number;
								severity?: string;
							};
						};
					};
					groupKey?: string;
					suiteId?: string;
					tags?: string[];
				};
				recentRuns?: Array<{
					groupKey?: string;
					suiteId?: string;
				}>;
			};
		expect(presentationBenchmarkRunResponse.status).toBe(200);
		expect(presentationBenchmarkRunBody).toEqual(
			expect.objectContaining({
				comparison: expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({
							retrievalId: 'presentation-baseline'
						}),
						expect.objectContaining({
							retrievalId: 'presentation-cue-aware'
						})
					])
				}),
				fixtureVariants: ['current-collection'],
				groupKey: 'presentation-cue-parity',
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					decisionSummary: expect.objectContaining({
						gate: expect.objectContaining({
							policy: expect.objectContaining({
								minPresentationTitleCueCasesDelta: 0,
								minPresentationBodyCueCasesDelta: 0,
								minPresentationNotesCueCasesDelta: 0,
								severity: 'fail'
							})
						})
					}),
					groupKey: 'presentation-cue-parity',
					suiteId: 'rag-presentation-cue-parity',
					tags: expect.arrayContaining([
						'presentation',
						'cue',
						'slides'
					])
				}),
				ok: true,
				recentRuns: [
					expect.objectContaining({
						groupKey: 'presentation-cue-parity',
						suiteId: 'rag-presentation-cue-parity'
					})
				]
			})
		);

		const spreadsheetBenchmarkHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/spreadsheet-cue?limit=3'
			)
		);
		const spreadsheetBenchmarkHistoryBody =
			(await spreadsheetBenchmarkHistoryResponse.json()) as {
				ok: boolean;
				groupKey?: string;
				snapshotHistoryPresentation?: {
					summary: string;
				};
			};
		expect(spreadsheetBenchmarkHistoryResponse.status).toBe(200);
		expect(spreadsheetBenchmarkHistoryBody).toEqual(
			expect.objectContaining({
				groupKey: 'spreadsheet-cue-parity',
				ok: true
			})
		);

		const spreadsheetBenchmarkRunResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/benchmarks/spreadsheet-cue/run',
				{
					body: JSON.stringify({
						limit: 3,
						runLimit: 3
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const spreadsheetBenchmarkRunBody =
			(await spreadsheetBenchmarkRunResponse.json()) as {
				ok: boolean;
				fixtureVariants?: string[];
				comparison?: {
					entries?: Array<{ retrievalId?: string }>;
				};
				groupKey?: string;
				latestFixtureVariant?: string;
				latestRun?: {
					decisionSummary?: {
						gate?: {
							policy?: {
								minSpreadsheetSheetCueCasesDelta?: number;
								minSpreadsheetTableCueCasesDelta?: number;
								minSpreadsheetColumnCueCasesDelta?: number;
								severity?: string;
							};
						};
					};
					groupKey?: string;
					suiteId?: string;
					tags?: string[];
				};
				recentRuns?: Array<{
					groupKey?: string;
					suiteId?: string;
				}>;
			};
		expect(spreadsheetBenchmarkRunResponse.status).toBe(200);
		expect(spreadsheetBenchmarkRunBody).toEqual(
			expect.objectContaining({
				comparison: expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({
							retrievalId: 'spreadsheet-baseline'
						}),
						expect.objectContaining({
							retrievalId: 'spreadsheet-cue-aware'
						})
					])
				}),
				fixtureVariants: ['current-collection'],
				groupKey: 'spreadsheet-cue-parity',
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					decisionSummary: expect.objectContaining({
						gate: expect.objectContaining({
							policy: expect.objectContaining({
								minSpreadsheetSheetCueCasesDelta: 0,
								minSpreadsheetTableCueCasesDelta: 0,
								minSpreadsheetColumnCueCasesDelta: 0,
								severity: 'fail'
							})
						})
					}),
					groupKey: 'spreadsheet-cue-parity',
					suiteId: 'rag-spreadsheet-cue-parity',
					tags: expect.arrayContaining([
						'spreadsheet',
						'cue',
						'workbook'
					])
				}),
				ok: true,
				recentRuns: [
					expect.objectContaining({
						groupKey: 'spreadsheet-cue-parity',
						suiteId: 'rag-spreadsheet-cue-parity'
					})
				]
			})
		);

		const releaseHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/release-history?groupKey=docs-release&decisionLimit=6&baselineLimit=4&runLimit=3&targetRolloutLabel=canary'
			)
		);
		const releaseHistoryBody = (await releaseHistoryResponse.json()) as {
			ok: boolean;
			groupKey?: string;
			decisions?: Array<{ kind: string; targetRolloutLabel?: string }>;
			baselines?: Array<{
				retrievalId: string;
				version: number;
				rolloutLabel?: string;
			}>;
			runs?: Array<{ id: string }>;
			timeline?: {
				groupKey: string;
				latestDecisionKind?: string;
			};
			presentation?: {
				summary: string;
				rows: Array<{ label: string; value: string }>;
				recentRuns: Array<{
					runId: string;
					rows: Array<{ label: string; value: string }>;
				}>;
			};
			adaptiveNativePlannerBenchmark?: {
				suiteId: string;
				fixtureVariants?: string[];
				latestFixtureVariant?: string;
				groupKey?: string;
				latestRun?: {
					groupKey?: string;
					suiteId?: string;
				};
				historyPresentation?: {
					summary: string;
				};
				snapshotHistoryPresentation?: {
					summary: string;
				};
			};
			nativeBackendComparisonBenchmark?: {
				suiteId: string;
				fixtureVariants?: string[];
				latestFixtureVariant?: string;
				groupKey?: string;
				latestRun?: {
					groupKey?: string;
					suiteId?: string;
					tags?: string[];
				};
			};
			presentationCueBenchmark?: {
				suiteId: string;
				fixtureVariants?: string[];
				latestFixtureVariant?: string;
				groupKey?: string;
				latestRun?: {
					groupKey?: string;
					suiteId?: string;
				};
			};
		};
		expect(releaseHistoryResponse.status).toBe(200);
		expect(releaseHistoryBody.groupKey).toBe('docs-release');
		expect(releaseHistoryBody.decisions?.[0]).toEqual(
			expect.objectContaining({
				kind: 'revert',
				targetRolloutLabel: 'canary'
			})
		);
		expect(releaseHistoryBody.baselines?.[0]).toEqual(
			expect.objectContaining({
				rolloutLabel: 'canary',
				retrievalId: 'lexical'
			})
		);
		expect(
			releaseHistoryBody.decisions?.every(
				(entry) => entry.targetRolloutLabel === 'canary'
			)
		).toBe(true);
		expect(releaseHistoryBody.baselines?.[0]?.version).toBeGreaterThan(4);
		expect(releaseHistoryBody.runs?.[0]).toEqual(
			expect.objectContaining({
				id: historyBody.runs?.[0]?.id
			})
		);
		expect(releaseHistoryBody.timeline).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				latestDecisionKind: 'revert'
			})
		);
		expect(releaseHistoryBody.presentation).toEqual(
			expect.objectContaining({
				recentRuns: expect.arrayContaining([
					expect.objectContaining({
						rows: expect.arrayContaining([
							expect.objectContaining({
								label: 'Lowest runtime budget exhaustion'
							}),
							expect.objectContaining({
								label: 'Lowest runtime underfilled TopK'
							}),
							expect.objectContaining({
								label: 'Runtime gate failures'
							})
						])
					})
				])
			})
		);
		expect(releaseHistoryBody.adaptiveNativePlannerBenchmark).toEqual(
			expect.objectContaining({
				fixtureVariants: ['current-collection'],
				groupKey: 'runtime-native-planner',
				historyPresentation: expect.objectContaining({
					summary: '1 recent runs'
				}),
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					groupKey: 'runtime-native-planner',
					suiteId: 'rag-native-planner-larger-corpus'
				}),
				suiteId: 'rag-native-planner-larger-corpus',
				snapshotHistoryPresentation: expect.objectContaining({
					summary: 'v1'
				})
			})
		);
		expect(releaseHistoryBody.nativeBackendComparisonBenchmark).toEqual(
			expect.objectContaining({
				fixtureVariants: ['current-collection'],
				groupKey: 'runtime-native-backend-parity',
				latestFixtureVariant: 'current-collection',
				suiteId: 'rag-native-backend-larger-corpus'
			})
		);
		expect(releaseHistoryBody.presentationCueBenchmark).toEqual(
			expect.objectContaining({
				fixtureVariants: ['current-collection'],
				groupKey: 'presentation-cue-parity',
				latestFixtureVariant: 'current-collection',
				suiteId: 'rag-presentation-cue-parity'
			})
		);
		const handoffsResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs?groupKey=docs-release&sourceRolloutLabel=canary&targetRolloutLabel=stable&limit=5'
			)
		);
		const handoffsBody = (await handoffsResponse.json()) as {
			ok: boolean;
			handoffs?: Array<{
				groupKey: string;
				sourceRolloutLabel: string;
				targetRolloutLabel: string;
				readyForHandoff: boolean;
				reasons: string[];
			}>;
		};
		expect(handoffsResponse.status).toBe(200);
		expect(handoffsBody.handoffs?.[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable',
				readyForHandoff: false
			})
		);
		const handoffDecisionResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/decide',
				{
					body: JSON.stringify({
						decidedBy: 'alex',
						groupKey: 'docs-release',
						kind: 'reject',
						notes: 'stable handoff is blocked until gate and approval pass',
						sourceRolloutLabel: 'canary',
						targetRolloutLabel: 'stable'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const handoffDecisionBody = (await handoffDecisionResponse.json()) as {
			ok: boolean;
			decision?: {
				groupKey: string;
				kind: string;
				sourceRolloutLabel: string;
				targetRolloutLabel: string;
				notes?: string;
			};
		};
		expect(handoffDecisionResponse.status).toBe(200);
		expect(handoffDecisionBody.decision).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				kind: 'reject',
				notes: 'stable handoff is blocked until gate and approval pass',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);
		const handoffDecisionHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/handoffs/decisions?groupKey=docs-release&sourceRolloutLabel=canary&targetRolloutLabel=stable&limit=5'
			)
		);
		const handoffDecisionHistoryBody =
			(await handoffDecisionHistoryResponse.json()) as {
				ok: boolean;
				decisions?: Array<{
					groupKey: string;
					kind: string;
					sourceRolloutLabel: string;
					targetRolloutLabel: string;
				}>;
			};
		expect(handoffDecisionHistoryResponse.status).toBe(200);
		expect(handoffDecisionHistoryBody.decisions?.[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				kind: 'reject',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			ok: boolean;
			admin?: { canManageRetrievalBaselines?: boolean };
			retrievalComparisons?: {
				alerts?: Array<{ kind: string }>;
				activeBaselines?: Array<{
					groupKey: string;
					retrievalId: string;
					approvedBy?: string;
				}>;
				baselineHistory?: Array<{
					retrievalId: string;
					status: string;
					version: number;
				}>;
				recentDecisions?: Array<{
					kind: string;
					retrievalId: string;
					freshnessStatus?: string;
				}>;
				latestRejectedCandidate?: {
					kind: string;
					retrievalId: string;
					notes?: string;
				};
				readyToPromote?: {
					ready: boolean;
					requiresOverride?: boolean;
					gateStatus?: string;
				};
				readyToPromoteByLane?: Array<{
					targetRolloutLabel?: string;
					ready: boolean;
					requiresApproval?: boolean;
					requiresOverride?: boolean;
					gateStatus?: string;
					effectiveReleasePolicy?: {
						requireApprovalBeforePromotion?: boolean;
					};
				}>;
				promotionCandidates?: Array<{
					approvalFreshnessStatus?: string;
					candidateRetrievalId?: string;
					priority?: string;
					ready: boolean;
					approved: boolean;
					requiresApproval: boolean;
					sortReason?: string;
				}>;
				releaseGroups?: Array<{
					groupKey: string;
					actionRequired: boolean;
					actionRequiredReasons: string[];
					activeBaselineRolloutLabel?: string;
					activeBaselineGatePolicy?: {
						minPassingRateDelta?: number;
						severity?: string;
					};
					acknowledgedOpenIncidentCount?: number;
					escalationSeverity?: string;
					openIncidentCount?: number;
					recommendedAction?: string;
					recommendedActionReasons?: string[];
					approvalRequired: boolean;
					approvalMaxAgeMs?: number;
					blockedReasons: string[];
					pendingCandidateCount: number;
					unacknowledgedOpenIncidentCount?: number;
				}>;
				releasePolicies?: Array<{
					groupKey: string;
					requireApprovalBeforePromotion?: boolean;
					approvalMaxAgeMs?: number;
				}>;
				releaseLanePolicies?: Array<{
					groupKey?: string;
					rolloutLabel: string;
					scope: string;
					requireApprovalBeforePromotion?: boolean;
					approvalMaxAgeMs?: number;
				}>;
				releaseGatePolicies?: Array<{
					groupKey?: string;
					rolloutLabel: string;
					scope: string;
					policy: {
						minPassingRateDelta?: number;
						severity?: string;
					};
				}>;
				releaseTimelines?: Array<{
					groupKey: string;
					lastApprovedAt?: number;
					lastPromotedAt?: number;
					lastRejectedAt?: number;
					lastRevertedAt?: number;
					latestDecisionKind?: string;
					latestDecisionFreshnessStatus?: string;
				}>;
				releaseLaneTimelines?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					lastApprovedAt?: number;
					lastPromotedAt?: number;
					lastRejectedAt?: number;
					lastRevertedAt?: number;
					latestDecisionKind?: string;
					latestDecisionFreshnessStatus?: string;
				}>;
				releaseLaneDecisions?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					decisionCount: number;
					approvalCount: number;
					promotionCount: number;
					rejectionCount: number;
					revertCount: number;
					latestDecisionKind?: string;
				}>;
				approvalScopes?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					status: string;
					latestDecisionKind?: string;
				}>;
				releaseLaneEscalationPolicies?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					openIncidentSeverity?: string;
					regressionSeverity?: string;
					gateFailureSeverity?: string;
					approvalExpiredSeverity?: string;
				}>;
				releaseLaneAudits?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					activeBaselineRetrievalId?: string;
					latestDecisionKind?: string;
					lastPromotedAt?: number;
					lastRevertedAt?: number;
				}>;
				releaseLaneRecommendations?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					classification?: string;
					recommendedAction?: string;
					recommendedActionReasons?: string[];
					remediationActions?: string[];
					ready: boolean;
					gateStatus?: string;
					candidateRetrievalId?: string;
				}>;
				releaseLaneIncidentSummaries?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
					openCount: number;
					acknowledgedOpenCount: number;
					unacknowledgedOpenCount: number;
					highestSeverity?: string;
					latestKind?: string;
				}>;
				releaseLaneHandoffs?: Array<{
					groupKey: string;
					sourceRolloutLabel: string;
					targetRolloutLabel: string;
					sourceBaselineRetrievalId?: string;
					targetBaselineRetrievalId?: string;
					candidateRetrievalId?: string;
					sourceActive: boolean;
					targetActive: boolean;
					readyForHandoff: boolean;
					reasons: string[];
					policyDelta?: {
						requireApprovalBeforePromotionChanged?: boolean;
						approvalMaxAgeMsDelta?: number;
						gateSeverityChanged?: boolean;
					};
					targetReadiness?: {
						targetRolloutLabel?: string;
						ready: boolean;
						requiresApproval?: boolean;
					};
				}>;
				recentLaneHandoffDecisions?: Array<{
					groupKey: string;
					kind: string;
					sourceRolloutLabel: string;
					targetRolloutLabel: string;
					notes?: string;
				}>;
				recentIncidents?: Array<{
					groupKey: string;
					kind: string;
					severity: string;
					status: string;
				}>;
				incidentSummary?: {
					openCount: number;
					resolvedCount: number;
					acknowledgedOpenCount: number;
					unacknowledgedOpenCount: number;
				};
				latest?: {
					groupKey?: string;
					label?: string;
					decisionSummary?: {
						gate?: { status: string };
					};
					releaseVerdict?: { status: string };
				};
			};
		};
		expect(opsResponse.status).toBe(200);
		expect(opsBody.admin?.canManageRetrievalBaselines).toBe(true);
		expect(opsBody.retrievalComparisons?.latest?.groupKey).toMatch(
			/-cue-parity$/
		);
		expect(opsBody.retrievalComparisons?.latest?.label).toMatch(
			/Cue Benchmark$/
		);
		expect(opsBody.retrievalComparisons?.activeBaselines?.[0]).toEqual(
			expect.objectContaining({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				retrievalId: 'lexical'
			})
		);
		expect(
			opsBody.retrievalComparisons?.baselineHistory?.map(
				(entry) =>
					`${entry.retrievalId}:${entry.status}:${entry.version}`
			)
		).toEqual([
			'lexical:active:5',
			'lexical:active:4',
			'vector:superseded:3',
			'lexical:superseded:2',
			'lexical:active:1'
		]);
		expect(
			opsBody.retrievalComparisons?.recentDecisions?.map(
				(entry) =>
					`${entry.kind}:${entry.retrievalId}:${entry.freshnessStatus ?? 'na'}`
			)
		).toEqual([
			'reject:lexical:not_applicable',
			'revert:lexical:not_applicable',
			'promote:lexical:not_applicable',
			'approve:lexical:not_applicable',
			'promote:vector:not_applicable',
			'promote:lexical:not_applicable',
			'promote:lexical:not_applicable'
		]);
		expect(opsBody.retrievalComparisons?.latestRejectedCandidate).toEqual(
			expect.objectContaining({
				kind: 'reject',
				notes: 'candidate regressed against baseline',
				retrievalId: 'lexical'
			})
		);
		expect(opsBody.retrievalComparisons?.promotionCandidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					approvalFreshnessStatus: 'not_applicable',
					approved: false,
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical',
					delta: expect.objectContaining({
						averageF1Delta: expect.any(Number),
						passingRateDelta: expect.any(Number)
					}),
					effectiveBaselineGatePolicy: expect.objectContaining({
						minPassingRateDelta: 0,
						severity: 'warn'
					}),
					effectiveReleasePolicy: expect.objectContaining({
						requireApprovalBeforePromotion: false
					}),
					groupKey: 'docs-release',
					priority: 'gate_fail',
					priorityScore: 2,
					ready: false,
					requiresApproval: false,
					reviewStatus: 'blocked',
					sortReason: 'candidate is blocked by a gate failure',
					targetRolloutLabel: 'canary'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseGroups).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					classification: 'general',
					activeBaselineGatePolicy: expect.objectContaining({
						minPassingRateDelta: 0,
						severity: 'warn'
					}),
					activeBaselineRolloutLabel: 'canary',
					acknowledgedOpenIncidentCount: 0,
					actionRequired: true,
					actionRequiredReasons: expect.arrayContaining([
						expect.stringContaining('passing rate delta')
					]),
					escalationSeverity: 'critical',
					openIncidentCount: 1,
					recommendedAction: 'investigate_regression',
					recommendedActionReasons: expect.arrayContaining([
						expect.stringContaining('passing rate delta')
					]),
					approvalRequired: true,
					blockedReasons: expect.arrayContaining([
						expect.stringContaining('passing rate delta')
					]),
					groupKey: 'docs-release',
					pendingCandidateCount: 0,
					unacknowledgedOpenIncidentCount: 1
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releasePolicies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					requireApprovalBeforePromotion: true
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseLanePolicies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					rolloutLabel: 'canary',
					scope: 'group_rollout_label',
					requireApprovalBeforePromotion: false
				}),
				expect.objectContaining({
					groupKey: 'docs-release',
					rolloutLabel: 'stable',
					scope: 'group_rollout_label',
					approvalMaxAgeMs: 60_000,
					requireApprovalBeforePromotion: true
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseGatePolicies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rolloutLabel: 'canary',
					scope: 'rollout_label',
					policy: expect.objectContaining({
						minPassingRateDelta: 0,
						severity: 'warn'
					})
				})
			])
		);
		expect(opsBody.retrievalComparisons?.incidentSummary).toEqual(
			expect.objectContaining({
				acknowledgedOpenCount: 0,
				openCount: 1,
				unacknowledgedOpenCount: 1
			})
		);
		expect(opsBody.retrievalComparisons?.releaseTimelines).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					lastApprovedAt: expect.any(Number),
					lastPromotedAt: expect.any(Number),
					lastRejectedAt: expect.any(Number),
					lastRevertedAt: expect.any(Number),
					latestDecisionFreshnessStatus: 'not_applicable',
					latestDecisionKind: 'reject'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseLaneTimelines).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					lastPromotedAt: expect.any(Number),
					lastRevertedAt: expect.any(Number),
					latestDecisionKind: 'revert',
					targetRolloutLabel: 'canary'
				}),
				expect.objectContaining({
					groupKey: 'docs-release',
					lastPromotedAt: expect.any(Number),
					latestDecisionKind: 'promote',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseLaneDecisions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					decisionCount: expect.any(Number),
					groupKey: 'docs-release',
					latestDecisionKind: 'revert',
					promotionCount: expect.any(Number),
					revertCount: expect.any(Number),
					targetRolloutLabel: 'canary'
				}),
				expect.objectContaining({
					approvalCount: expect.any(Number),
					groupKey: 'docs-release',
					latestDecisionKind: 'promote',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.approvalScopes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					targetRolloutLabel: 'stable',
					status: 'none'
				}),
				expect.objectContaining({
					groupKey: 'docs-release',
					targetRolloutLabel: 'canary',
					status: 'none'
				}),
				expect.objectContaining({
					groupKey: 'docs-release',
					targetRolloutLabel: 'rollback_target',
					status: 'none'
				})
			])
		);
		expect(
			opsBody.retrievalComparisons?.releaseLaneEscalationPolicies
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					approvalExpiredSeverity: 'warning',
					gateFailureSeverity: 'warning',
					groupKey: 'docs-release',
					openIncidentSeverity: 'warning',
					regressionSeverity: 'warning',
					targetRolloutLabel: 'canary'
				}),
				expect.objectContaining({
					approvalExpiredSeverity: 'critical',
					gateFailureSeverity: 'critical',
					groupKey: 'docs-release',
					openIncidentSeverity: 'critical',
					regressionSeverity: 'critical',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseLaneAudits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					activeBaselineRetrievalId: 'lexical',
					groupKey: 'docs-release',
					lastPromotedAt: expect.any(Number),
					lastRevertedAt: expect.any(Number),
					latestDecisionKind: 'revert',
					targetRolloutLabel: 'canary'
				}),
				expect.objectContaining({
					groupKey: 'docs-release',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(
			opsBody.retrievalComparisons?.releaseLaneRecommendations
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					candidateRetrievalId: 'lexical',
					classification: 'general',
					gateStatus: 'fail',
					groupKey: 'docs-release',
					ready: false,
					remediationActions: expect.arrayContaining([
						'Inspect the latest retrieval comparison deltas and resolve the gate failure before promotion.'
					]),
					recommendedAction: 'investigate_regression',
					recommendedActionReasons: expect.arrayContaining([
						expect.stringContaining('passing rate delta')
					]),
					targetRolloutLabel: 'canary'
				}),
				expect.objectContaining({
					groupKey: 'docs-release',
					ready: false,
					recommendedAction: 'monitor',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(
			opsBody.retrievalComparisons?.releaseLaneIncidentSummaries
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					acknowledgedOpenCount: 0,
					groupKey: 'docs-release',
					highestSeverity: 'warning',
					latestKind: 'gate_failure',
					openCount: 1,
					targetRolloutLabel: 'canary',
					unacknowledgedOpenCount: 1
				}),
				expect.objectContaining({
					acknowledgedOpenCount: 0,
					groupKey: 'docs-release',
					openCount: 0,
					targetRolloutLabel: 'stable',
					unacknowledgedOpenCount: 0
				})
			])
		);
		expect(opsBody.retrievalComparisons?.releaseLaneHandoffs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					candidateRetrievalId: 'lexical',
					groupKey: 'docs-release',
					policyDelta: expect.objectContaining({
						approvalMaxAgeMsDelta: 60_000,
						gateSeverityChanged: true,
						minPassingRateDeltaDelta: 1,
						requireApprovalBeforePromotionChanged: true
					}),
					readyForHandoff: false,
					reasons: expect.arrayContaining([
						expect.stringContaining('passing rate delta'),
						expect.stringContaining('explicit approval')
					]),
					sourceActive: true,
					sourceBaselineRetrievalId: 'lexical',
					sourceRolloutLabel: 'canary',
					targetActive: true,
					targetBaselineRetrievalId: 'lexical',
					targetReadiness: expect.objectContaining({
						ready: false,
						requiresApproval: true,
						targetRolloutLabel: 'stable'
					}),
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(
			opsBody.retrievalComparisons?.recentLaneHandoffDecisions
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					kind: 'reject',
					notes: 'stable handoff is blocked until gate and approval pass',
					sourceRolloutLabel: 'canary',
					targetRolloutLabel: 'stable'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.recentIncidents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					classification: 'general',
					groupKey: 'docs-release',
					kind: 'gate_failure',
					severity: 'warning',
					status: 'open'
				})
			])
		);
		expect(opsBody.retrievalComparisons?.readyToPromote).toEqual(
			expect.objectContaining({
				baselineRetrievalId: expect.stringMatching(/-baseline$/),
				candidateRetrievalId: expect.stringMatching(/-cue-aware$/),
				ready: true,
				requiresOverride: false
			})
		);
		expect(opsBody.retrievalComparisons?.readyToPromoteByLane).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					targetRolloutLabel: 'canary',
					ready: true,
					requiresApproval: false,
					requiresOverride: false,
					baselineRetrievalId: expect.stringMatching(/-baseline$/),
					candidateRetrievalId: expect.stringMatching(/-cue-aware$/)
				}),
				expect.objectContaining({
					targetRolloutLabel: 'stable',
					ready: true,
					requiresApproval: false,
					requiresOverride: false,
					baselineRetrievalId: expect.stringMatching(/-baseline$/),
					candidateRetrievalId: expect.stringMatching(/-cue-aware$/)
				})
			])
		);
		expect(releaseEvents).toContain(
			'incident_opened:docs-release:gate_failure'
		);

		const incidentsResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents?groupKey=docs-release&status=open&severity=warning&kind=gate_failure&acknowledged=false&targetRolloutLabel=canary&limit=5'
			)
		);
		const incidentsBody = (await incidentsResponse.json()) as {
			ok: boolean;
			incidents?: Array<{
				classification?: string;
				id: string;
				groupKey: string;
				kind: string;
				severity: string;
				status: string;
				targetRolloutLabel?: string;
			}>;
		};
		expect(incidentsResponse.status).toBe(200);
		expect(incidentsBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				classification: 'general',
				groupKey: 'docs-release',
				kind: 'gate_failure',
				severity: 'warning',
				status: 'open',
				targetRolloutLabel: 'canary'
			})
		);
		const releaseIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/incidents')
		);
		const releaseIncidentStatusBody =
			(await releaseIncidentStatusResponse.json()) as {
				ok: boolean;
				incidentSummary?: { openCount: number };
				releaseLaneIncidentSummaries?: Array<{
					groupKey: string;
					targetRolloutLabel: string;
				}>;
			};
		expect(releaseIncidentStatusResponse.status).toBe(200);
		expect(releaseIncidentStatusBody.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: 1
			})
		);
		expect(releaseIncidentStatusBody.releaseLaneIncidentSummaries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'docs-release',
					targetRolloutLabel: 'canary'
				})
			])
		);
		const remediationRecordResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/remediations',
				{
					body: JSON.stringify({
						decidedBy: 'alex',
						incidentId: incidentsBody.incidents?.[0]?.id,
						notes: 'approval renewal is the next operator action',
						remediationKind: 'renew_approval',
						status: 'planned'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const remediationRecordBody =
			(await remediationRecordResponse.json()) as {
				ok: boolean;
				records?: Array<{
					decidedBy?: string;
					remediationKind?: string;
					status?: string;
				}>;
			};
		expect(remediationRecordResponse.status).toBe(200);
		expect(remediationRecordBody.records?.[0]).toEqual(
			expect.objectContaining({
				decidedBy: 'alex',
				remediationKind: 'renew_approval',
				status: 'planned'
			})
		);
		const remediationListResponse = await app.handle(
			new Request(
				`http://localhost/rag/compare/retrieval/incidents/remediations?incidentId=${incidentsBody.incidents?.[0]?.id}&status=planned&limit=5`
			)
		);
		const remediationListBody =
			(await remediationListResponse.json()) as typeof remediationRecordBody;
		expect(remediationListResponse.status).toBe(200);
		expect(remediationListBody.records?.[0]).toEqual(
			expect.objectContaining({
				remediationKind: 'renew_approval',
				status: 'planned'
			})
		);
		const remediationExecuteResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/remediations/execute',
				{
					body: JSON.stringify({
						action: {
							kind: 'acknowledge_incident',
							label: 'Acknowledge this release incident.',
							method: 'POST',
							path: '/rag/compare/retrieval/incidents/acknowledge',
							payload: {
								acknowledgedBy: 'alex',
								acknowledgementNotes:
									'triaged from remediation action',
								incidentId: incidentsBody.incidents?.[0]?.id
							}
						},
						decidedBy: 'alex',
						incidentId: incidentsBody.incidents?.[0]?.id,
						idempotencyKey: 'incident-ack-1',
						notes: 'executed acknowledgement from remediation action',
						persistDecision: true,
						remediationKind: 'review_readiness'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const remediationExecuteBody =
			(await remediationExecuteResponse.json()) as {
				ok: boolean;
				record?: {
					decidedBy?: string;
					remediationKind?: string;
					status?: string;
				};
				execution?: {
					action?: { kind?: string };
					incidents?: Array<{
						acknowledgedBy?: string;
						acknowledgementNotes?: string;
					}>;
				};
			};
		expect(remediationExecuteResponse.status).toBe(200);
		expect(remediationExecuteBody.execution).toEqual(
			expect.objectContaining({
				action: expect.objectContaining({
					kind: 'acknowledge_incident'
				}),
				code: 'incident_acknowledged',
				followUpSteps: expect.arrayContaining([
					expect.objectContaining({
						kind: 'inspect_gate'
					})
				]),
				incidents: expect.arrayContaining([
					expect.objectContaining({
						acknowledgedBy: 'alex',
						acknowledgementNotes: 'triaged from remediation action'
					})
				])
			})
		);
		expect(remediationExecuteBody.record).toEqual(
			expect.objectContaining({
				decidedBy: 'alex',
				remediationKind: 'review_readiness',
				status: 'applied'
			})
		);
		const remediationReplayResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/remediations/execute',
				{
					body: JSON.stringify({
						action: {
							kind: 'acknowledge_incident',
							label: 'Acknowledge this release incident.',
							method: 'POST',
							path: '/rag/compare/retrieval/incidents/acknowledge',
							payload: {
								acknowledgedBy: 'alex',
								acknowledgementNotes:
									'triaged from remediation action',
								incidentId: incidentsBody.incidents?.[0]?.id
							}
						},
						decidedBy: 'alex',
						incidentId: incidentsBody.incidents?.[0]?.id,
						idempotencyKey: 'incident-ack-1',
						notes: 'executed acknowledgement from remediation action',
						persistDecision: true,
						remediationKind: 'review_readiness'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const remediationReplayBody =
			(await remediationReplayResponse.json()) as {
				ok: boolean;
				execution?: { code?: string; idempotentReplay?: boolean };
				record?: { idempotencyKey?: string };
			};
		expect(remediationReplayResponse.status).toBe(200);
		expect(remediationReplayBody.execution).toEqual(
			expect.objectContaining({
				code: 'idempotent_replay',
				idempotentReplay: true
			})
		);
		expect(remediationReplayBody.record).toEqual(
			expect.objectContaining({
				idempotencyKey: 'incident-ack-1'
			})
		);
		const bulkRemediationExecuteResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/remediations/execute/bulk',
				{
					body: JSON.stringify({
						allowMutationExecution: true,
						items: [
							{
								action: {
									kind: 'view_release_status',
									label: 'Inspect release readiness before deciding.',
									method: 'GET',
									path: '/rag/status/release'
								},
								incidentId: incidentsBody.incidents?.[0]?.id,
								remediationKind: 'review_readiness'
							},
							{
								action: {
									kind: 'resolve_incident',
									label: 'Resolve this release incident.',
									method: 'POST',
									path: '/rag/compare/retrieval/incidents/resolve',
									payload: {
										incidentId:
											incidentsBody.incidents?.[0]?.id,
										resolutionNotes:
											'resolved from bulk remediation execution'
									}
								},
								decidedBy: 'alex',
								incidentId: incidentsBody.incidents?.[0]?.id,
								idempotencyKey: 'incident-resolve-bulk-1',
								persistDecision: true,
								remediationKind: 'review_readiness'
							}
						]
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const bulkRemediationExecuteBody =
			(await bulkRemediationExecuteResponse.json()) as {
				ok: boolean;
				results?: Array<{
					index: number;
					ok: boolean;
					execution?: { code?: string };
					record?: { status?: string };
				}>;
			};
		expect(bulkRemediationExecuteResponse.status).toBe(200);
		expect(bulkRemediationExecuteBody.results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					index: 0,
					ok: true,
					execution: expect.objectContaining({
						code: 'release_status_loaded'
					})
				}),
				expect.objectContaining({
					index: 1,
					ok: true,
					execution: expect.objectContaining({
						code: 'incident_resolved',
						followUpSteps: expect.arrayContaining([
							expect.objectContaining({
								kind: 'monitor_lane'
							})
						])
					}),
					record: expect.objectContaining({
						status: 'applied'
					})
				})
			])
		);
		const blockedBulkRemediationResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/remediations/execute/bulk',
				{
					body: JSON.stringify({
						items: [
							{
								action: {
									kind: 'resolve_incident',
									label: 'Resolve this release incident.',
									method: 'POST',
									path: '/rag/compare/retrieval/incidents/resolve',
									payload: {
										incidentId:
											incidentsBody.incidents?.[0]?.id
									}
								},
								incidentId: incidentsBody.incidents?.[0]?.id,
								remediationKind: 'review_readiness'
							}
						]
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const blockedBulkRemediationBody =
			(await blockedBulkRemediationResponse.json()) as {
				ok: boolean;
				error?: string;
			};
		expect(blockedBulkRemediationResponse.status).toBe(400);
		expect(blockedBulkRemediationBody).toEqual(
			expect.objectContaining({
				error: 'Bulk remediation execution requires allowMutationExecution: true when mutation actions are included',
				ok: false
			})
		);
		const remediationExecutionHistoryResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/remediations/executions?incidentId=' +
					incidentsBody.incidents?.[0]?.id +
					'&limit=10'
			)
		);
		const remediationExecutionHistoryBody =
			(await remediationExecutionHistoryResponse.json()) as {
				ok: boolean;
				records?: Array<{
					blockedByGuardrail?: boolean;
					code?: string;
					idempotentReplay?: boolean;
					mutationSkipped?: boolean;
				}>;
			};
		expect(remediationExecutionHistoryResponse.status).toBe(200);
		expect(remediationExecutionHistoryBody.records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockedByGuardrail: true,
					code: 'guardrail_blocked'
				}),
				expect.objectContaining({
					code: 'idempotent_replay',
					idempotentReplay: true,
					mutationSkipped: true
				})
			])
		);
		const remediationStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/remediations')
		);
		const remediationStatusBody =
			(await remediationStatusResponse.json()) as {
				ok: boolean;
				incidentClassificationSummary?: {
					openGeneralCount?: number;
					totalGeneralCount?: number;
					totalMultiVectorCount?: number;
				};
				incidentRemediationExecutionSummary?: {
					guardrailBlockedCount?: number;
					mutationSkippedReplayCount?: number;
					replayCount?: number;
				};
				recentIncidentRemediationExecutions?: Array<{
					code?: string;
				}>;
			};
		expect(remediationStatusResponse.status).toBe(200);
		expect(
			remediationStatusBody.incidentRemediationExecutionSummary
		).toEqual(
			expect.objectContaining({
				guardrailBlockedCount: 1,
				mutationSkippedReplayCount: 1,
				replayCount: 1
			})
		);
		expect(remediationStatusBody.incidentClassificationSummary).toEqual(
			expect.objectContaining({
				resolvedGeneralCount: 1,
				totalGeneralCount: 1,
				totalMultiVectorCount: 0
			})
		);
		expect(
			remediationStatusBody.recentIncidentRemediationExecutions
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'guardrail_blocked'
				}),
				expect.objectContaining({
					code: 'idempotent_replay'
				})
			])
		);
		const acknowledgeIncidentResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/acknowledge',
				{
					body: JSON.stringify({
						acknowledgedBy: 'alex',
						acknowledgementNotes:
							'investigating candidate regression',
						incidentId: incidentsBody.incidents?.[0]?.id
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const acknowledgeIncidentBody =
			(await acknowledgeIncidentResponse.json()) as {
				ok: boolean;
				incidents?: Array<{
					acknowledgedBy?: string;
					acknowledgementNotes?: string;
					id?: string;
				}>;
			};
		expect(acknowledgeIncidentResponse.status).toBe(200);
		expect(acknowledgeIncidentBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				acknowledgedBy: 'alex',
				acknowledgementNotes: 'investigating candidate regression',
				id: incidentsBody.incidents?.[0]?.id
			})
		);
		const opsAfterAcknowledgeResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsAfterAcknowledgeBody =
			(await opsAfterAcknowledgeResponse.json()) as typeof opsBody;
		expect(
			opsAfterAcknowledgeBody.retrievalComparisons?.incidentSummary
		).toEqual(
			expect.objectContaining({
				acknowledgedOpenCount: 0,
				openCount: 0,
				resolvedCount: expect.any(Number),
				unacknowledgedOpenCount: 0
			})
		);
		expect(
			opsAfterAcknowledgeBody.retrievalComparisons?.releaseGroups
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					acknowledgedOpenIncidentCount: 0,
					groupKey: 'docs-release',
					openIncidentCount: 0,
					unacknowledgedOpenIncidentCount: 0
				})
			])
		);
		expect(
			(
				opsAfterAcknowledgeBody.retrievalComparisons as
					| {
							recentIncidentRemediationDecisions?: Array<{
								decidedBy?: string;
								remediationKind?: string;
								status?: string;
							}>;
					  }
					| undefined
			)?.recentIncidentRemediationDecisions
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					decidedBy: 'alex',
					remediationKind: 'renew_approval',
					status: 'planned'
				})
			])
		);
		const unacknowledgeIncidentResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/unacknowledge',
				{
					body: JSON.stringify({
						incidentId: incidentsBody.incidents?.[0]?.id
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(unacknowledgeIncidentResponse.status).toBe(200);
		const resolveIncidentResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/incidents/resolve',
				{
					body: JSON.stringify({
						incidentId: incidentsBody.incidents?.[0]?.id,
						resolutionNotes:
							'rollback completed and regression contained',
						resolvedBy: 'alex'
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const resolveIncidentBody = (await resolveIncidentResponse.json()) as {
			ok: boolean;
			incidents?: Array<{
				notes?: string;
				status?: string;
			}>;
		};
		expect(resolveIncidentResponse.status).toBe(200);
		expect(resolveIncidentBody.incidents?.[0]).toEqual(
			expect.objectContaining({
				notes: 'rollback completed and regression contained',
				status: 'resolved'
			})
		);
		const opsAfterResolveResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsAfterResolveBody =
			(await opsAfterResolveResponse.json()) as typeof opsBody;
		expect(
			opsAfterResolveBody.retrievalComparisons?.incidentSummary
		).toEqual(
			expect.objectContaining({
				acknowledgedOpenCount: 0,
				openCount: 0,
				resolvedCount: expect.any(Number),
				unacknowledgedOpenCount: 0
			})
		);
	});

	it('scopes release status and remediation data by allowed comparison group keys', async () => {
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
			listIncidents({
				groupKey
			}: {
				groupKey?: string;
				corpusGroupKey?: string;
				limit?: number;
				targetRolloutLabel?: RAGRetrievalReleaseIncidentRecord['targetRolloutLabel'];
				status?: RAGRetrievalReleaseIncidentRecord['status'];
				severity?: RAGRetrievalReleaseIncidentRecord['severity'];
			} = {}) {
				const matching = groupKey
					? this.incidents.filter(
							(incident) => incident.groupKey === groupKey
						)
					: this.incidents;
				return matching;
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
			saveRecord(
				record: RAGRetrievalIncidentRemediationExecutionHistoryRecord
			) {
				this.records.push(record);
			},
			listRecords({
				groupKey
			}: {
				groupKey?: string;
				incidentId?: string;
				limit?: number;
				actionKind?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['action']['kind'];
				code?: RAGRetrievalIncidentRemediationExecutionHistoryRecord['code'];
				blockedByGuardrail?: boolean;
				idempotentReplay?: boolean;
				targetRolloutLabel?:
					| RAGRetrievalReleaseIncidentRecord['targetRolloutLabel']
					| undefined;
			} = {}) {
				const matching = groupKey
					? this.records.filter(
							(record) => record.groupKey === groupKey
						)
					: this.records;
				return matching;
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
						context?.workspace === 'beta'
							? 'beta-release'
							: 'alpha-release'
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

		const alphaIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/incidents', {
				headers: { 'x-workspace': 'alpha' }
			})
		);
		const alphaIncidentStatusBody =
			(await alphaIncidentStatusResponse.json()) as {
				ok: boolean;
				incidentSummary?: { openCount: number; resolvedCount: number };
				recentIncidents?: Array<{
					groupKey: string;
					status: 'open' | 'resolved';
				}>;
				releaseLaneIncidentSummaries?: Array<{
					groupKey: string;
				}>;
			};
		expect(alphaIncidentStatusResponse.status).toBe(200);
		const alphaIncidentEntries =
			alphaIncidentStatusBody.recentIncidents ?? [];
		const alphaScopedIncidentEntries = alphaIncidentEntries.filter(
			(entry) => entry.groupKey === 'alpha-release'
		);
		const alphaScopedOpenCount = alphaScopedIncidentEntries.filter(
			(entry) => entry.status === 'open'
		).length;
		expect(alphaIncidentStatusBody.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: alphaScopedOpenCount
			})
		);
		expect(
			alphaScopedIncidentEntries.filter(
				(entry) => entry.status === 'open'
			).length
		).toBe(1);
		expect(alphaIncidentStatusBody.recentIncidents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ groupKey: 'alpha-release' })
			])
		);
		expect(
			(alphaIncidentStatusBody.recentIncidents ?? []).map(
				(incident) => incident.groupKey
			)
		).not.toContain('beta-release');

		const betaIncidentStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/incidents', {
				headers: { 'x-workspace': 'beta' }
			})
		);
		const betaIncidentStatusBody =
			(await betaIncidentStatusResponse.json()) as {
				ok: boolean;
				incidentSummary?: { openCount: number; resolvedCount: number };
				recentIncidents?: Array<{
					groupKey: string;
					status: 'open' | 'resolved';
				}>;
				releaseLaneIncidentSummaries?: Array<{
					groupKey: string;
				}>;
			};
		expect(betaIncidentStatusResponse.status).toBe(200);
		const betaIncidentEntries =
			betaIncidentStatusBody.recentIncidents ?? [];
		const betaScopedIncidentEntries = betaIncidentEntries.filter(
			(entry) => entry.groupKey === 'beta-release'
		);
		const betaScopedOpenCount = betaScopedIncidentEntries.filter(
			(entry) => entry.status === 'open'
		).length;
		expect(betaIncidentStatusBody.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: betaScopedOpenCount
			})
		);
		expect(
			betaScopedIncidentEntries.filter(
				(entry) => entry.status === 'resolved'
			).length
		).toBe(1);
		expect(
			betaScopedIncidentEntries.filter((entry) => entry.status === 'open')
				.length
		).toBe(0);
		expect(betaIncidentStatusBody.recentIncidents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ groupKey: 'beta-release' })
			])
		);
		expect(
			(betaIncidentStatusBody.recentIncidents ?? []).map(
				(incident) => incident.groupKey
			)
		).not.toContain('alpha-release');

		const alphaReleaseStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release', {
				headers: { 'x-workspace': 'alpha' }
			})
		);
		const alphaReleaseStatusBody =
			(await alphaReleaseStatusResponse.json()) as {
				ok: boolean;
				retrievalComparisons?: {
					incidentSummary?: {
						openCount: number;
						resolvedCount: number;
					};
					recentIncidents?: Array<{
						groupKey: string;
					}>;
				};
			};
		expect(alphaReleaseStatusResponse.status).toBe(200);
		expect(
			alphaReleaseStatusBody.retrievalComparisons?.incidentSummary
		).toEqual(
			expect.objectContaining({
				openCount: 1
			})
		);
		expect(
			(
				alphaReleaseStatusBody.retrievalComparisons?.recentIncidents ??
				[]
			).map((incident) => incident.groupKey)
		).toEqual(expect.arrayContaining(['alpha-release']));
		expect(
			(
				alphaReleaseStatusBody.retrievalComparisons?.recentIncidents ??
				[]
			).map((incident) => incident.groupKey)
		).not.toContain('beta-release');

		const betaReleaseStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release', {
				headers: { 'x-workspace': 'beta' }
			})
		);
		const betaReleaseStatusBody =
			(await betaReleaseStatusResponse.json()) as {
				ok: boolean;
				retrievalComparisons?: {
					incidentSummary?: {
						openCount: number;
						resolvedCount: number;
					};
					recentIncidents?: Array<{
						groupKey: string;
					}>;
				};
			};
		expect(betaReleaseStatusResponse.status).toBe(200);
		expect(
			betaReleaseStatusBody.retrievalComparisons?.incidentSummary
		).toEqual(
			expect.objectContaining({
				openCount: 0
			})
		);
		expect(
			(
				betaReleaseStatusBody.retrievalComparisons?.recentIncidents ??
				[]
			).map((incident) => incident.groupKey)
		).toEqual(expect.arrayContaining(['beta-release']));
		expect(
			(
				betaReleaseStatusBody.retrievalComparisons?.recentIncidents ??
				[]
			).map((incident) => incident.groupKey)
		).not.toContain('alpha-release');

		const alphaRemediationStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/remediations', {
				headers: { 'x-workspace': 'alpha' }
			})
		);
		const alphaRemediationStatusBody =
			(await alphaRemediationStatusResponse.json()) as {
				ok: boolean;
				incidentRemediationExecutionSummary?: {
					guardrailBlockedCount?: number;
					mutationSkippedReplayCount?: number;
					replayCount?: number;
				};
				recentIncidentRemediationExecutions?: Array<{
					groupKey?: string;
					code?: string;
				}>;
			};
		expect(alphaRemediationStatusResponse.status).toBe(200);
		expect(
			alphaRemediationStatusBody.incidentRemediationExecutionSummary
		).toEqual(
			expect.objectContaining({
				guardrailBlockedCount: 1,
				mutationSkippedReplayCount: 0,
				replayCount: 0
			})
		);
		expect(
			alphaRemediationStatusBody.recentIncidentRemediationExecutions
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'alpha-release',
					code: 'guardrail_blocked'
				})
			])
		);
		expect(
			alphaRemediationStatusBody.recentIncidentRemediationExecutions
		).toEqual(
			expect.not.arrayContaining([
				expect.objectContaining({ groupKey: 'beta-release' })
			])
		);

		const betaRemediationStatusResponse = await app.handle(
			new Request('http://localhost/rag/status/release/remediations', {
				headers: { 'x-workspace': 'beta' }
			})
		);
		const betaRemediationStatusBody =
			(await betaRemediationStatusResponse.json()) as {
				ok: boolean;
				incidentRemediationExecutionSummary?: {
					guardrailBlockedCount?: number;
					mutationSkippedReplayCount?: number;
					replayCount?: number;
				};
				recentIncidentRemediationExecutions?: Array<{
					groupKey?: string;
					code?: string;
				}>;
			};
		expect(betaRemediationStatusResponse.status).toBe(200);
		expect(
			betaRemediationStatusBody.incidentRemediationExecutionSummary
		).toEqual(
			expect.objectContaining({
				guardrailBlockedCount: 0,
				mutationSkippedReplayCount: 1,
				replayCount: 1
			})
		);
		expect(
			betaRemediationStatusBody.recentIncidentRemediationExecutions
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupKey: 'beta-release',
					code: 'idempotent_replay'
				})
			])
		);
		expect(
			betaRemediationStatusBody.recentIncidentRemediationExecutions
		).toEqual(
			expect.not.arrayContaining([
				expect.objectContaining({ groupKey: 'alpha-release' })
			])
		);
	});

	it('requires fresh approval for direct promotion when release policy enforces it', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('alpha')) return [1, 0];
				if (text.includes('question about alpha')) return [1, 0];
				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha-doc',
					metadata: { documentId: 'alpha-doc' },
					source: 'alpha',
					text: 'alpha knowledge'
				},
				{
					chunkId: 'beta-doc',
					metadata: { documentId: 'beta-doc' },
					source: 'beta',
					text: 'beta guide'
				}
			]
		});

		const historyStore = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-governed-history-${Date.now()}.json`
		);
		const baselineStore = createRAGFileRetrievalBaselineStore(
			`/tmp/rag-retrieval-comparison-governed-baseline-store-${Date.now()}.json`
		);
		const decisionStore = createRAGFileRetrievalReleaseDecisionStore(
			`/tmp/rag-retrieval-comparison-governed-decision-store-${Date.now()}.json`
		);
		const app = new Elysia().use(
			ragChat({
				collection,
				path: '/rag',
				provider,
				retrievalBaselineStore: baselineStore,
				retrievalComparisonHistoryStore: historyStore,
				retrievalReleaseDecisionStore: decisionStore,
				retrievalReleasePolicies: {
					governed: {
						approvalMaxAgeMs: 100,
						requireApprovalBeforePromotion: true
					}
				}
			})
		);

		for (const retrievalId of ['lexical', 'vector']) {
			const response = await app.handle(
				new Request(
					'http://localhost/rag/compare/retrieval/baselines/promote',
					{
						body: JSON.stringify({
							approvedBy: 'alex',
							groupKey: 'governed',
							retrievalId
						}),
						headers: { 'Content-Type': 'application/json' },
						method: 'POST'
					}
				)
			);
			expect(response.status).toBe(200);
		}

		const compareResponse = await app.handle(
			new Request('http://localhost/rag/compare/retrieval', {
				body: JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['alpha-doc'],
							id: 'alpha-case',
							query: 'question about alpha'
						}
					],
					candidateRetrievalId: 'lexical',
					groupKey: 'governed',
					label: 'Governed release candidate gate',
					persistRun: true,
					retrievals: [
						{ id: 'vector', retrieval: 'vector' },
						{ id: 'lexical', retrieval: 'lexical' }
					],
					tags: ['governed']
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			})
		);
		expect(compareResponse.status).toBe(200);

		const historyResponse = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/history?groupKey=governed&limit=5'
			)
		);
		const historyBody = (await historyResponse.json()) as {
			runs?: Array<{ id: string }>;
		};
		const runId = historyBody.runs?.[0]?.id;
		expect(runId).toBeDefined();

		const blockedPromotion = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						groupKey: 'governed',
						retrievalId: 'lexical',
						sourceRunId: runId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const blockedPromotionBody = (await blockedPromotion.json()) as {
			error?: string;
		};
		expect(blockedPromotion.status).toBe(400);
		expect(blockedPromotionBody.error).toContain(
			'explicit approval is required before promotion'
		);

		const expiredApproval = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/approve',
				{
					body: JSON.stringify({
						decidedAt: Date.now() - 1000,
						decidedBy: 'alex',
						groupKey: 'governed',
						overrideGate: true,
						overrideReason: 'accepted for governed release',
						sourceRunId: runId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(expiredApproval.status).toBe(200);

		const expiredPromotion = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						groupKey: 'governed',
						retrievalId: 'lexical',
						sourceRunId: runId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		const expiredPromotionBody = (await expiredPromotion.json()) as {
			error?: string;
		};
		expect(expiredPromotion.status).toBe(400);
		expect(expiredPromotionBody.error).toContain('approval has expired');

		const freshApproval = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/approve',
				{
					body: JSON.stringify({
						decidedAt: Date.now(),
						decidedBy: 'alex',
						groupKey: 'governed',
						overrideGate: true,
						overrideReason: 'renewed approval for governed release',
						sourceRunId: runId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(freshApproval.status).toBe(200);

		const successfulPromotion = await app.handle(
			new Request(
				'http://localhost/rag/compare/retrieval/baselines/promote',
				{
					body: JSON.stringify({
						approvedBy: 'alex',
						groupKey: 'governed',
						retrievalId: 'lexical',
						sourceRunId: runId
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(successfulPromotion.status).toBe(200);

		const opsResponse = await app.handle(
			new Request('http://localhost/rag/ops')
		);
		const opsBody = (await opsResponse.json()) as {
			retrievalComparisons?: {
				releaseGroups?: Array<{
					groupKey: string;
					approvalRequired: boolean;
					approvalMaxAgeMs?: number;
					blockedReasons: string[];
				}>;
			};
		};
		expect(opsBody.retrievalComparisons?.releaseGroups).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					approvalMaxAgeMs: 100,
					approvalRequired: true,
					blockedReasons: expect.any(Array),
					groupKey: 'governed'
				})
			])
		);
	});
});
