import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type {
	RAGEvaluationSuiteRun,
	RAGComparisonPresentation,
	RAGQueryInput,
	RAGRetrievalComparison,
	RAGVectorStore
} from '../../../../types/ai';
import {
	buildRAGAnswerGroundingCaseSnapshotPresentations,
	buildRAGAnswerGroundingEntityQualityPresentation,
	buildRAGAnswerGroundingHistoryPresentation,
	buildRAGAnswerGroundingHistoryRows,
	buildRAGComparisonTraceDiffRows,
	buildRAGComparisonTraceSummaryRows,
	buildRAGEvaluationCaseTracePresentations,
	buildRAGEvaluationEntityQualityPresentation,
	buildRAGGroundingOverviewPresentation,
	buildRAGGroundingProviderCaseComparisonPresentations,
	buildRAGGroundingProviderOverviewPresentation,
	buildRAGGroundingProviderPresentations,
	buildRAGEvaluationHistoryPresentation,
	buildRAGEvaluationHistoryRows,
	buildRAGEvaluationSuiteSnapshotHistoryPresentation,
	buildRAGEvaluationSuiteSnapshotPresentations,
	buildRAGEvaluationSuiteSnapshotRows,
	buildRAGQualityOverviewPresentation,
	buildRAGRerankerComparisonOverviewPresentation,
	buildRAGRerankerComparisonPresentations,
	buildRAGRerankerOverviewPresentation,
	buildRAGRetrievalComparisonOverviewPresentation,
	buildRAGRetrievalComparisonPresentations,
	buildRAGRetrievalOverviewPresentation
} from '../../../../src/ai/rag/ui';
import { buildRAGRetrievalReleaseGroupHistoryPresentation } from '../../../../src/ai/rag/presentation';
import {
	buildRAGRetrievalComparisonDecisionSummary,
	buildRAGRetrievalReleaseVerdict,
	buildRAGSearchTraceDiff,
	buildRAGSearchTraceRecord,
	buildRAGAnswerGroundingCaseDifficultyLeaderboard,
	buildRAGAnswerGroundingCaseDifficultyRunDiff,
	buildRAGAnswerGroundingEvaluationLeaderboard,
	buildRAGAnswerGroundingEvaluationResponse,
	buildRAGAnswerGroundingEvaluationRunDiff,
	buildRAGEvaluationLeaderboard,
	buildRAGEvaluationResponse,
	buildRAGEvaluationRunDiff
} from '../../../../src/ai/rag/quality';
import {
	compareRAGRetrievalStrategies,
	buildRAGRetrievalTraceHistoryTrend,
	compareRAGRetrievalTraceSummaries,
	compareRAGRerankers,
	createHeuristicRAGQueryTransform,
	createHeuristicRAGRetrievalStrategy,
	createHeuristicRAGReranker,
	createRAGCollection,
	createRAGFileAnswerGroundingCaseDifficultyHistoryStore,
	createRAGFileAnswerGroundingEvaluationHistoryStore,
	createRAGFileEvaluationHistoryStore,
	createRAGSQLiteAnswerGroundingEvaluationHistoryStore,
	createRAGSQLiteEvaluationHistoryStore,
	createRAGFileRetrievalBaselineStore,
	createRAGFileRetrievalComparisonHistoryStore,
	createRAGFileRetrievalReleaseDecisionStore,
	createRAGFileRetrievalReleaseIncidentStore,
	createRAGFileSearchTracePruneHistoryStore,
	createRAGFileSearchTraceStore,
	createRAGSQLiteGovernanceStores,
	inspectRAGSQLiteStoreMigrations,
	applyRAGSQLiteStoreMigrations,
	createRAGSQLiteRetrievalBaselineStore,
	createRAGSQLiteRetrievalComparisonHistoryStore,
	createRAGSQLiteRetrievalIncidentRemediationDecisionStore,
	createRAGSQLiteRetrievalIncidentRemediationExecutionHistoryStore,
	createRAGSQLiteRetrievalLaneHandoffAutoCompletePolicyHistoryStore,
	createRAGSQLiteRetrievalLaneHandoffDecisionStore,
	createRAGSQLiteRetrievalLaneHandoffIncidentHistoryStore,
	createRAGSQLiteRetrievalLaneHandoffIncidentStore,
	createRAGSQLiteRetrievalBaselineGatePolicyHistoryStore,
	createRAGSQLiteRetrievalReleaseLaneEscalationPolicyHistoryStore,
	createRAGSQLiteRetrievalReleaseLanePolicyHistoryStore,
	createRAGSQLiteRetrievalReleaseIncidentStore,
	createRAGSQLiteRetrievalReleaseDecisionStore,
	createRAGSQLiteSearchTraceStore,
	createRAGSQLiteSearchTracePruneHistoryStore,
	createRAGSQLiteEvaluationSuiteSnapshotHistoryStore,
	createRAGFileEvaluationSuiteSnapshotHistoryStore,
	createRAGEvaluationSuite,
	createRAGAdaptiveNativePlannerBenchmarkSuite,
	createRAGAdaptiveNativePlannerBenchmarkSnapshot,
	createRAGNativeBackendBenchmarkCorpus,
	createRAGNativeBackendBenchmarkMockEmbedding,
	createRAGNativeBackendComparisonBenchmarkSuite,
	createRAGNativeBackendComparisonBenchmarkSnapshot,
	createRAGPresentationCueBenchmarkSuite,
	createRAGPresentationCueBenchmarkSnapshot,
	createRAGSpreadsheetCueBenchmarkSuite,
	createRAGSpreadsheetCueBenchmarkSnapshot,
	addRAGEvaluationSuiteCase,
	addRAGEvaluationSuiteCaseHardNegative,
	createRAGEvaluationSuiteSnapshot,
	buildRAGEvaluationSuiteSnapshotDiff,
	buildRAGEvaluationEntityQualityView,
	generateRAGEvaluationSuiteFromDocuments,
	buildRAGAnswerGroundingEntityQualityView,
	evaluateRAGAnswerGroundingCase,
	evaluateRAGCollection,
	loadRAGAnswerGroundingCaseDifficultyHistory,
	loadRAGAnswerGroundingEvaluationHistory,
	loadRAGEvaluationHistory,
	loadRAGEvaluationSuiteSnapshotHistory,
	loadRAGRetrievalBaselines,
	loadRAGRetrievalComparisonHistory,
	loadRAGRetrievalIncidentRemediationDecisions,
	loadRAGRetrievalIncidentRemediationExecutionHistory,
	loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory,
	loadRAGRetrievalLaneHandoffDecisions,
	loadRAGRetrievalLaneHandoffIncidentHistory,
	loadRAGRetrievalLaneHandoffIncidents,
	loadRAGRetrievalBaselineGatePolicyHistory,
	loadRAGRetrievalReleaseLaneEscalationPolicyHistory,
	loadRAGRetrievalReleaseLanePolicyHistory,
	loadRAGRetrievalReleaseDecisions,
	loadRAGRetrievalReleaseIncidents,
	loadRAGSearchTraceGroupHistory,
	loadRAGSearchTraceHistory,
	loadRAGSearchTracePruneHistory,
	persistRAGAnswerGroundingCaseDifficultyRun,
	persistRAGAnswerGroundingEvaluationRun,
	persistRAGEvaluationSuiteRun,
	persistRAGRetrievalBaseline,
	persistRAGRetrievalComparisonRun,
	persistRAGRetrievalIncidentRemediationDecision,
	persistRAGRetrievalIncidentRemediationExecutionHistory,
	persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory,
	persistRAGRetrievalLaneHandoffDecision,
	persistRAGRetrievalLaneHandoffIncident,
	persistRAGRetrievalLaneHandoffIncidentHistory,
	persistRAGRetrievalBaselineGatePolicyHistory,
	persistRAGRetrievalReleaseLaneEscalationPolicyHistory,
	persistRAGRetrievalReleaseLanePolicyHistory,
	persistRAGRetrievalReleaseDecision,
	persistRAGRetrievalReleaseIncident,
	persistRAGSearchTracePruneRun,
	persistRAGSearchTraceRecord,
	pruneRAGSearchTraceStore,
	removeRAGEvaluationSuiteCase,
	removeRAGEvaluationSuiteCaseHardNegative,
	reorderRAGEvaluationSuiteCases,
	setRAGEvaluationSuiteCaseGoldenSet,
	summarizeRAGRetrievalTraces,
	summarizeRAGEvaluationCase,
	summarizeRAGEvaluationSuiteDataset,
	runRAGEvaluationSuite,
	updateRAGEvaluationSuiteCase
} from '../../../../src/ai';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import { createSQLiteRAGStore } from '../../../../src/ai/rag/adapters/sqlite';
import { createPostgresRAGStore } from '../../../../src/ai/rag/adapters/postgres';

const tempPaths = new Set<string>();
const POSTGRES_URL =
	process.env.RAG_POSTGRES_TEST_URL ??
	process.env.RAG_POSTGRES_URL ??
	process.env.DATABASE_URL ??
	'postgres://postgres:postgres@localhost:55433/absolute_rag_demo';

const canConnectToPostgres = async () => {
	try {
		const db = new Bun.SQL(POSTGRES_URL);
		await db`select 1 as ok`;
		await db.close?.();
		return true;
	} catch {
		return false;
	}
};

const postgresAvailable = await canConnectToPostgres();
const itIfPostgres = postgresAvailable ? it : it.skip;
const sqliteNativeAvailable = (() => {
	const db = new Database(':memory:');
	try {
		createSQLiteRAGStore({
			db,
			dimensions: 2,
			native: {
				mode: 'vec0',
				requireAvailable: true
			}
		});
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
})();
const itIfSQLiteNative = sqliteNativeAvailable ? it : it.skip;
const openPostgresStores: Array<ReturnType<typeof createPostgresRAGStore>> = [];
const trackPostgresStore = (
	store: ReturnType<typeof createPostgresRAGStore>
) => {
	openPostgresStores.push(store);
	return store;
};

afterEach(async () => {
	for (const path of tempPaths) {
		rmSync(path, { force: true });
	}
	tempPaths.clear();
	while (openPostgresStores.length > 0) {
		await openPostgresStores.pop()?.close?.();
	}
});

const adaptiveNativeBenchmarkQuery =
	'Which launch checklist phrase is exact wording?';
const adaptiveNativeBenchmarkVariant = 'launch checklist exact wording';

const buildAdaptiveNativeBenchmarkChunks = () =>
	createRAGNativeBackendBenchmarkCorpus();

const createAdaptiveNativeBenchmarkCollection = (store: RAGVectorStore) =>
	createRAGCollection({
		queryTransform: async (input) => ({
			query: input.query,
			variants: [adaptiveNativeBenchmarkVariant]
		}),
		rerank: createHeuristicRAGReranker(),
		store
	});

const assertAdaptiveNativeBenchmarkParity = async ({
	store,
	expectedVectorMode
}: {
	store: RAGVectorStore;
	expectedVectorMode: 'native_vec0' | 'native_pgvector';
}) => {
	const collection = createAdaptiveNativeBenchmarkCollection(store);

	await collection.ingest({
		chunks: buildAdaptiveNativeBenchmarkChunks()
	});
	await store.analyze?.();

	expect(collection.getStatus?.()?.vectorMode).toBe(expectedVectorMode);

	const forcedLatency = await evaluateRAGCollection({
		collection: {
			...collection,
			search: (input) =>
				collection.search({
					...input,
					nativeQueryProfile: 'latency',
					retrieval: 'vector'
				})
		},
		input: {
			cases: [
				{
					expectedDocumentIds: ['focus-target'],
					id: `adaptive-native-${expectedVectorMode}`,
					query: adaptiveNativeBenchmarkQuery,
					topK: 1
				}
			],
			filter: {
				lane: 'focus'
			}
		}
	});
	const adaptive = await evaluateRAGCollection({
		collection: {
			...collection,
			search: (input) =>
				collection.search({
					...input,
					retrieval: 'vector'
				})
		},
		input: {
			cases: [
				{
					expectedDocumentIds: ['focus-target'],
					id: `adaptive-native-${expectedVectorMode}`,
					query: adaptiveNativeBenchmarkQuery,
					topK: 1
				}
			],
			filter: {
				lane: 'focus'
			}
		}
	});
	const adaptiveTrace = await collection.searchWithTrace({
		filter: {
			lane: 'focus'
		},
		query: adaptiveNativeBenchmarkQuery,
		retrieval: 'vector',
		topK: 1
	});

	expect(forcedLatency.summary.passedCases).toBe(0);
	expect(adaptive.summary.passedCases).toBe(1);
	expect(adaptiveTrace.results[0]?.metadata?.documentId).toBe('focus-target');
	expect(adaptiveTrace.trace.steps).toContainEqual(
		expect.objectContaining({
			label: 'Selected native planner profile',
			metadata: expect.objectContaining({
				autoSelected: true,
				selectedProfile: 'balanced'
			}),
			stage: 'routing'
		})
	);
};

describe('RAG quality helpers', () => {
	it('builds an evaluation response summary from case results', () => {
		const response = buildRAGEvaluationResponse([
			{
				caseId: 'pass',
				elapsedMs: 10,
				expectedCount: 1,
				expectedIds: ['a'],
				f1: 1,
				matchedCount: 1,
				matchedIds: ['a'],
				missingIds: [],
				mode: 'documentId',
				precision: 1,
				query: 'alpha',
				recall: 1,
				retrievedCount: 1,
				retrievedIds: ['a'],
				status: 'pass',
				topK: 2
			},
			{
				caseId: 'partial',
				elapsedMs: 20,
				expectedCount: 2,
				expectedIds: ['a', 'b'],
				f1: 0.5,
				matchedCount: 1,
				matchedIds: ['a'],
				missingIds: ['b'],
				mode: 'documentId',
				precision: 0.5,
				query: 'beta',
				recall: 0.5,
				retrievedCount: 2,
				retrievedIds: ['a', 'c'],
				status: 'partial',
				topK: 2
			}
		]);

		expect(response.summary).toMatchObject({
			averageF1: 0.75,
			averageLatencyMs: 15,
			failedCases: 0,
			partialCases: 1,
			passedCases: 1,
			totalCases: 2
		});
		expect(response.passingRate).toBe(50);
	});

	it('classifies retrieval and grounding failure modes explicitly', () => {
		const retrievalFail = summarizeRAGEvaluationCase({
			caseIndex: 0,
			caseInput: {
				expectedDocumentIds: ['doc-a'],
				id: 'retrieval-fail',
				query: 'missing doc'
			},
			elapsedMs: 12,
			expectedIds: ['doc-a'],
			mode: 'documentId',
			query: 'missing doc',
			retrievedIds: []
		});
		expect(retrievalFail.failureClasses).toEqual([
			'no_results',
			'no_match'
		]);

		const retrievalPartial = summarizeRAGEvaluationCase({
			caseIndex: 1,
			caseInput: {
				expectedSources: ['docs/a.md', 'docs/b.md'],
				id: 'retrieval-partial',
				query: 'partial sources'
			},
			elapsedMs: 9,
			expectedIds: ['docs/a.md', 'docs/b.md'],
			mode: 'source',
			query: 'partial sources',
			retrievedIds: ['docs/a.md', 'docs/extra.md']
		});
		expect(retrievalPartial.failureClasses).toEqual([
			'partial_recall',
			'extra_noise'
		]);

		const retrievalSourceSpecific = summarizeRAGEvaluationCase({
			caseIndex: 2,
			caseInput: {
				expectedSources: ['docs/report.xlsx'],
				id: 'retrieval-source-specific',
				query: 'spreadsheet routing miss'
			},
			elapsedMs: 8,
			expectedIds: ['docs/report.xlsx'],
			mode: 'source',
			query: 'spreadsheet routing miss',
			retrievedIds: ['docs/other.xlsx'],
			retrievedSources: [
				{
					chunkId: 'sheet:1',
					score: 0.7,
					source: 'docs/other.xlsx',
					text: 'Other spreadsheet row.',
					metadata: { sheetName: 'Summary', spreadsheetRowStart: 4 }
				}
			],
			trace: {
				query: 'spreadsheet routing miss',
				topK: 3,
				mode: 'hybrid',
				requestedMode: 'hybrid',
				candidateTopK: 6,
				lexicalTopK: 3,
				sourceBalanceStrategy: 'cap',
				runVector: true,
				runLexical: true,
				resultCounts: {
					vector: 1,
					lexical: 1,
					fused: 1,
					reranked: 1,
					final: 1
				},
				routingLabel: 'Spreadsheet lane',
				routingReason: 'sheet-aware preference',
				steps: [],
				transformedQuery: 'spreadsheet routing miss',
				variantQueries: []
			}
		});
		expect(retrievalSourceSpecific.failureClasses).toEqual([
			'no_match',
			'extra_noise',
			'spreadsheet_evidence_miss',
			'routing_miss'
		]);

		const retrievalSectionSpecific = summarizeRAGEvaluationCase({
			caseIndex: 3,
			caseInput: {
				expectedSources: ['docs/guide.md'],
				id: 'retrieval-section-specific',
				query: 'section graph miss'
			},
			elapsedMs: 7,
			expectedIds: ['docs/guide.md'],
			mode: 'source',
			query: 'section graph miss',
			retrievedIds: ['docs/other-guide.md'],
			retrievedSources: [
				{
					chunkId: 'section:1',
					score: 0.72,
					source: 'docs/other-guide.md',
					text: 'Nested guide section.',
					metadata: {
						sectionChunkCount: 3,
						sectionChunkId: 'other-guide:section:install',
						sectionChunkIndex: 1,
						sectionKind: 'markdown_heading',
						sectionPath: ['Guide', 'Install'],
						sectionTitle: 'Install'
					}
				}
			]
		});
		expect(retrievalSectionSpecific.failureClasses).toEqual([
			'no_match',
			'extra_noise',
			'section_evidence_miss',
			'section_graph_miss',
			'section_hierarchy_miss'
		]);

		const groundingUnresolved = evaluateRAGAnswerGroundingCase({
			caseIndex: 0,
			caseInput: {
				answer: 'See [3].',
				expectedSources: ['docs/guide.pdf'],
				id: 'grounding-unresolved',
				query: 'grounding unresolved',
				sources: [
					{
						chunkId: 'guide:1',
						score: 0.9,
						source: 'docs/guide.pdf',
						text: 'Guide content.'
					},
					{
						chunkId: 'extra:1',
						score: 0.8,
						source: 'docs/extra.pdf',
						text: 'Extra content.'
					}
				]
			}
		});
		expect(groundingUnresolved.failureClasses).toEqual([
			'unresolved_citations',
			'missing_expected_sources'
		]);

		const groundingNoCitations = evaluateRAGAnswerGroundingCase({
			caseIndex: 1,
			caseInput: {
				answer: 'No citations here.',
				expectedSources: ['docs/guide.pdf'],
				id: 'grounding-no-citations',
				query: 'grounding no citations',
				sources: [
					{
						chunkId: 'guide:1',
						score: 0.9,
						source: 'docs/guide.pdf',
						text: 'Guide content.'
					},
					{
						chunkId: 'extra:1',
						score: 0.8,
						source: 'docs/extra.pdf',
						text: 'Extra content.'
					}
				]
			}
		});
		expect(groundingNoCitations.failureClasses).toEqual([
			'no_citations',
			'missing_expected_sources'
		]);

		const groundingOcr = evaluateRAGAnswerGroundingCase({
			caseIndex: 2,
			caseInput: {
				answer: 'No citations here either.',
				expectedSources: ['docs/scanned.pdf'],
				id: 'grounding-ocr',
				query: 'ocr grounding miss',
				sources: [
					{
						chunkId: 'ocr:1',
						score: 0.6,
						source: 'docs/scanned.pdf',
						text: 'Scanned OCR text.',
						metadata: { pdfTextMode: 'ocr', ocrConfidence: 0.81 }
					}
				]
			}
		});
		expect(groundingOcr.failureClasses).toEqual([
			'no_citations',
			'missing_expected_sources',
			'ocr_source_miss'
		]);

		const groundingSection = evaluateRAGAnswerGroundingCase({
			caseIndex: 3,
			caseInput: {
				answer: 'Still no citations.',
				expectedSources: ['docs/guide.md'],
				id: 'grounding-section',
				query: 'section grounding miss',
				sources: [
					{
						chunkId: 'section:guide:1',
						score: 0.61,
						source: 'docs/guide.md',
						text: 'Nested guide section.',
						metadata: {
							sectionChunkCount: 4,
							sectionChunkId: 'guide:section:install',
							sectionChunkIndex: 2,
							sectionKind: 'markdown_heading',
							sectionPath: ['Guide', 'Install'],
							sectionTitle: 'Install'
						}
					}
				]
			}
		});
		expect(groundingSection.failureClasses).toEqual([
			'no_citations',
			'missing_expected_sources',
			'section_source_miss',
			'section_graph_source_miss',
			'section_hierarchy_source_miss'
		]);
	});

	it('builds per-source and per-document quality views from failure-classified results', () => {
		const evaluationView = buildRAGEvaluationEntityQualityView(
			buildRAGEvaluationResponse([
				{
					caseId: 'case-source-a',
					elapsedMs: 5,
					expectedCount: 1,
					expectedIds: ['docs/report.xlsx'],
					f1: 0,
					failureClasses: ['no_match', 'spreadsheet_evidence_miss'],
					matchedCount: 0,
					matchedIds: [],
					missingIds: ['docs/report.xlsx'],
					mode: 'source',
					precision: 0,
					query: 'sheet miss',
					recall: 0,
					retrievedCount: 1,
					retrievedIds: ['docs/other.xlsx'],
					status: 'fail',
					topK: 3
				},
				{
					caseId: 'case-doc-a',
					elapsedMs: 4,
					expectedCount: 1,
					expectedIds: ['doc-1'],
					f1: 0.5,
					failureClasses: ['partial_recall', 'routing_miss'],
					matchedCount: 1,
					matchedIds: ['doc-1'],
					missingIds: [],
					mode: 'documentId',
					precision: 0.5,
					query: 'doc partial',
					recall: 0.5,
					retrievedCount: 2,
					retrievedIds: ['doc-1', 'doc-2'],
					status: 'partial',
					topK: 3
				}
			])
		);
		expect(evaluationView.bySource[0]).toMatchObject({
			key: 'docs/report.xlsx',
			entityType: 'source',
			totalCases: 1,
			passingRate: 0,
			failureCounts: {
				no_match: 1,
				spreadsheet_evidence_miss: 1
			}
		});
		expect(evaluationView.byDocument[0]).toMatchObject({
			key: 'doc-1',
			entityType: 'document',
			totalCases: 1,
			averageF1: 0.5,
			failureCounts: {
				partial_recall: 1,
				routing_miss: 1
			}
		});

		const evaluationPresentation =
			buildRAGEvaluationEntityQualityPresentation(
				evaluationView,
				'source'
			);
		expect(evaluationPresentation.entities[0]).toMatchObject({
			label: 'docs/report.xlsx'
		});
		expect(
			evaluationPresentation.entities[0]?.rows.find(
				(row) => row.label === 'Failure classes'
			)?.value
		).toContain('spreadsheet_evidence_miss 1');

		const groundingView = buildRAGAnswerGroundingEntityQualityView(
			buildRAGAnswerGroundingEvaluationResponse([
				{
					answer: 'Missing OCR citations.',
					caseId: 'grounding-source-a',
					citationCount: 0,
					citationF1: 0,
					citationPrecision: 0,
					citationRecall: 0,
					citedIds: [],
					coverage: 'ungrounded',
					expectedCount: 1,
					expectedIds: ['docs/scanned.pdf'],
					extraIds: [],
					failureClasses: [
						'no_citations',
						'missing_expected_sources',
						'ocr_source_miss'
					],
					groundedAnswer: {
						coverage: 'ungrounded',
						content: 'Missing OCR citations.',
						hasCitations: false,
						parts: [],
						references: [],
						sectionSummaries: [],
						excerptModeCounts: { chunk: 0, window: 0, section: 0 },
						ungroundedReferenceNumbers: []
					},
					hasCitations: false,
					matchedCount: 0,
					matchedIds: [],
					missingIds: ['docs/scanned.pdf'],
					mode: 'source',
					query: 'ocr miss',
					referenceCount: 0,
					resolvedCitationCount: 0,
					resolvedCitationRate: 0,
					status: 'fail',
					unresolvedCitationCount: 0
				}
			])
		);
		expect(groundingView.bySource[0]).toMatchObject({
			key: 'docs/scanned.pdf',
			entityType: 'source',
			failureCounts: {
				no_citations: 1,
				missing_expected_sources: 1,
				ocr_source_miss: 1
			}
		});
		const groundingPresentation =
			buildRAGAnswerGroundingEntityQualityPresentation(
				groundingView,
				'source'
			);
		expect(
			groundingPresentation.entities[0]?.rows.find(
				(row) => row.label === 'Failure classes'
			)?.value
		).toContain('ocr_source_miss 1');
	});

	it('keeps active baselines separate per rollout lane', async () => {
		const path = `/tmp/absolute-rag-baselines-${Date.now()}-${Math.random()}.json`;
		tempPaths.add(path);
		const store = createRAGFileRetrievalBaselineStore(path);

		await persistRAGRetrievalBaseline({
			record: {
				groupKey: 'docs-release',
				id: 'baseline-stable-v1',
				label: 'Vector stable',
				promotedAt: 1,
				retrievalId: 'vector',
				rolloutLabel: 'stable',
				status: 'active',
				version: 1
			},
			store
		});
		await persistRAGRetrievalBaseline({
			record: {
				groupKey: 'docs-release',
				id: 'baseline-canary-v1',
				label: 'Hybrid canary',
				promotedAt: 2,
				retrievalId: 'hybrid',
				rolloutLabel: 'canary',
				status: 'active',
				version: 2
			},
			store
		});

		const activeBaselines = await loadRAGRetrievalBaselines({
			groupKey: 'docs-release',
			status: 'active',
			store
		});

		expect(activeBaselines.map((entry) => entry.id)).toEqual([
			'baseline-canary-v1',
			'baseline-stable-v1'
		]);
		expect(
			activeBaselines.find((entry) => entry.rolloutLabel === 'stable')
				?.status
		).toBe('active');
		expect(
			activeBaselines.find((entry) => entry.rolloutLabel === 'canary')
				?.status
		).toBe('active');
	});

	it('persists retrieval baselines in SQLite-backed stores with rollout-lane superseding', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalBaselineStore({
			db,
			tableName: 'retrieval_baselines'
		});

		await persistRAGRetrievalBaseline({
			record: {
				groupKey: 'docs-release',
				id: 'baseline-stable-v1',
				label: 'Vector stable',
				promotedAt: 1,
				retrievalId: 'vector',
				rolloutLabel: 'stable',
				status: 'active',
				version: 1
			},
			store
		});
		await persistRAGRetrievalBaseline({
			record: {
				groupKey: 'docs-release',
				id: 'baseline-canary-v1',
				label: 'Hybrid canary',
				promotedAt: 2,
				retrievalId: 'hybrid',
				rolloutLabel: 'canary',
				status: 'active',
				version: 2
			},
			store
		});
		await persistRAGRetrievalBaseline({
			record: {
				groupKey: 'docs-release',
				id: 'baseline-stable-v2',
				label: 'Lexical stable',
				promotedAt: 3,
				retrievalId: 'lexical',
				rolloutLabel: 'stable',
				status: 'active',
				version: 3
			},
			store
		});

		const activeBaselines = await loadRAGRetrievalBaselines({
			groupKey: 'docs-release',
			status: 'active',
			store
		});
		const supersededBaselines = await loadRAGRetrievalBaselines({
			groupKey: 'docs-release',
			status: 'superseded',
			store
		});

		expect(activeBaselines.map((entry) => entry.id)).toEqual([
			'baseline-stable-v2',
			'baseline-canary-v1'
		]);
		expect(
			activeBaselines.find((entry) => entry.rolloutLabel === 'stable')
		).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				status: 'active',
				version: 3
			})
		);
		expect(supersededBaselines[0]).toEqual(
			expect.objectContaining({
				id: 'baseline-stable-v1',
				status: 'superseded'
			})
		);
	});

	it('scores grounded answers for citation fidelity against expected sources', () => {
		const result = evaluateRAGAnswerGroundingCase({
			caseIndex: 0,
			caseInput: {
				answer: 'The PDF policy stays inspectable on page 7 [1], and the spreadsheet keeps the Regional Growth sheet named explicitly [2].',
				expectedSources: ['docs/guide.pdf', 'docs/report.xlsx'],
				id: 'grounding-case',
				query: 'Which sources support the answer?',
				sources: [
					{
						chunkId: 'chunk-pdf',
						metadata: { page: 7 },
						score: 0.9,
						source: 'docs/guide.pdf',
						text: 'The policy stays inspectable on page 7.',
						title: 'Guide page 7'
					},
					{
						chunkId: 'chunk-sheet',
						metadata: { sheetName: 'Regional Growth' },
						score: 0.88,
						source: 'docs/report.xlsx',
						text: 'The Regional Growth sheet tracks expansion.',
						title: 'Regional Growth'
					}
				]
			}
		});

		expect(result.status).toBe('pass');
		expect(result.coverage).toBe('grounded');
		expect(result.citationCount).toBe(2);
		expect(result.resolvedCitationCount).toBe(2);
		expect(result.unresolvedCitationCount).toBe(0);
		expect(result.citedIds).toEqual(['docs/guide.pdf', 'docs/report.xlsx']);
		expect(result.citationF1).toBe(1);
	});

	it('tracks unresolved citations and partial grounding accurately', () => {
		const result = evaluateRAGAnswerGroundingCase({
			caseIndex: 0,
			caseInput: {
				answer: 'The answer cites the PDF correctly [1], but it also references an unresolved source [3].',
				expectedSources: ['docs/guide.pdf', 'docs/report.xlsx'],
				id: 'partial-grounding-case',
				sources: [
					{
						chunkId: 'chunk-pdf',
						metadata: { page: 7 },
						score: 0.9,
						source: 'docs/guide.pdf',
						text: 'The policy stays inspectable on page 7.',
						title: 'Guide page 7'
					},
					{
						chunkId: 'chunk-sheet',
						metadata: { sheetName: 'Regional Growth' },
						score: 0.88,
						source: 'docs/report.xlsx',
						text: 'The Regional Growth sheet tracks expansion.',
						title: 'Regional Growth'
					}
				]
			}
		});
		const response = buildRAGAnswerGroundingEvaluationResponse([result]);

		expect(result.status).toBe('partial');
		expect(result.coverage).toBe('partial');
		expect(result.unresolvedCitationCount).toBe(1);
		expect(result.matchedIds).toEqual(['docs/guide.pdf']);
		expect(result.missingIds).toEqual(['docs/report.xlsx']);
		expect(result.citationPrecision).toBe(1);
		expect(result.citationRecall).toBe(0.5);
		expect(response.summary.averageResolvedCitationRate).toBe(0.5);
		expect(response.summary.partiallyGroundedCases).toBe(1);
		expect(response.passingRate).toBe(0);
	});

	it('summarizes raw retrieval traces for observability', () => {
		const summary = summarizeRAGRetrievalTraces([
			{
				candidateTopK: 4,
				lexicalTopK: 4,
				maxResultsPerSource: undefined,
				mmrLambda: undefined,
				mode: 'vector',
				diversityStrategy: undefined,
				query: 'what is retrieval',
				resultCounts: {
					final: 2,
					fused: 3,
					lexical: 0,
					reranked: 2,
					vector: 3
				},
				runLexical: false,
				runVector: true,
				scoreThreshold: 0.2,
				sourceBalanceStrategy: undefined,
				steps: [
					{ stage: 'input', label: 'input', count: 0 },
					{ stage: 'embed', label: 'embed' },
					{ stage: 'vector_search', label: 'search' },
					{ stage: 'fusion', label: 'fuse' },
					{ stage: 'rerank', label: 'rerank' },
					{ stage: 'score_filter', label: 'filter' },
					{ stage: 'finalize', label: 'finalize' }
				],
				topK: 2,
				transformedQuery: 'what is retrieval',
				variantQueries: []
			},
			{
				candidateTopK: 8,
				lexicalTopK: 8,
				maxResultsPerSource: 1,
				mmrLambda: undefined,
				mode: 'hybrid',
				diversityStrategy: 'mmr',
				query: 'retrieval pipeline',
				resultCounts: {
					final: 1,
					fused: 4,
					lexical: 2,
					reranked: 3,
					vector: 2
				},
				runLexical: true,
				runVector: true,
				scoreThreshold: undefined,
				sourceBalanceStrategy: 'round_robin',
				steps: [
					{ stage: 'input', label: 'input', count: 0 },
					{ stage: 'query_transform', label: 'transform' },
					{ stage: 'embed', label: 'embed' },
					{ stage: 'vector_search', label: 'vector search' },
					{ stage: 'lexical_search', label: 'lexical search' },
					{ stage: 'fusion', label: 'fuse' },
					{ stage: 'rerank', label: 'rerank' },
					{ stage: 'diversity', label: 'diversity' },
					{ stage: 'source_balance', label: 'balance' },
					{ stage: 'finalize', label: 'finalize' }
				],
				topK: 1,
				transformedQuery: 'pipeline retrieval',
				variantQueries: ['pipeline retrieval'],
				multiVector: {
					collapsedParents: 1,
					configured: true,
					lexicalVariantHits: 1,
					vectorVariantHits: 1
				}
			}
		]);

		expect(summary?.totalCases).toBe(2);
		expect(summary?.modes).toEqual(['vector', 'hybrid']);
		expect(summary?.vectorCases).toBe(2);
		expect(summary?.lexicalCases).toBe(1);
		expect(summary?.balancedCases).toBe(1);
		expect(summary?.roundRobinCases).toBe(1);
		expect(summary?.transformedCases).toBe(1);
		expect(summary?.variantCases).toBe(1);
		expect(summary?.multiVectorCases).toBe(1);
		expect(summary?.multiVectorVectorHitCases).toBe(1);
		expect(summary?.multiVectorLexicalHitCases).toBe(1);
		expect(summary?.multiVectorCollapsedCases).toBe(1);
		expect(summary?.stageCounts?.fusion).toBe(2);
		expect(summary?.stageCounts?.source_balance).toBe(1);
		expect(summary?.averageCandidateTopK).toBe(6);
		expect(summary?.averageFinalCount).toBe(1.5);
	});

	it('compares retrieval trace summaries to produce a useful delta', () => {
		const current = summarizeRAGRetrievalTraces([
			{
				candidateTopK: 6,
				lexicalTopK: 6,
				maxResultsPerSource: undefined,
				mmrLambda: undefined,
				mode: 'hybrid',
				diversityStrategy: undefined,
				query: 'what is retrieval',
				resultCounts: {
					final: 4,
					fused: 8,
					lexical: 3,
					reranked: 6,
					vector: 5
				},
				runLexical: true,
				runVector: true,
				scoreThreshold: undefined,
				sourceBalanceStrategy: 'cap',
				steps: [
					{ stage: 'input', label: 'input', count: 0 },
					{ stage: 'query_transform', label: 'query transform' },
					{ stage: 'embed', label: 'embed' },
					{ stage: 'vector_search', label: 'vector search' },
					{ stage: 'lexical_search', label: 'lexical search' },
					{ stage: 'fusion', label: 'fuse' },
					{ stage: 'rerank', label: 'rerank' },
					{ stage: 'finalize', label: 'finalize' }
				],
				topK: 4,
				transformedQuery: 'retrieval',
				variantQueries: [],
				multiVector: {
					collapsedParents: 1,
					configured: true,
					lexicalVariantHits: 0,
					vectorVariantHits: 1
				}
			},
			{
				candidateTopK: 8,
				lexicalTopK: 8,
				maxResultsPerSource: 2,
				mmrLambda: undefined,
				mode: 'hybrid',
				diversityStrategy: undefined,
				query: 'how to improve retrieval',
				resultCounts: {
					final: 3,
					fused: 7,
					lexical: 4,
					reranked: 5,
					vector: 6
				},
				runLexical: true,
				runVector: true,
				scoreThreshold: 0.25,
				sourceBalanceStrategy: 'round_robin',
				steps: [
					{ stage: 'input', label: 'input', count: 0 },
					{ stage: 'embed', label: 'embed' },
					{ stage: 'vector_search', label: 'vector search' },
					{ stage: 'lexical_search', label: 'lexical search' },
					{ stage: 'fusion', label: 'fuse' },
					{ stage: 'rerank', label: 'rerank' },
					{ stage: 'source_balance', label: 'source balance' },
					{ stage: 'finalize', label: 'finalize' }
				],
				topK: 2,
				transformedQuery: 'improve retrieval',
				variantQueries: ['improvement retrieval'],
				multiVector: {
					collapsedParents: 1,
					configured: true,
					lexicalVariantHits: 1,
					vectorVariantHits: 1
				}
			}
		]);
		const previous = summarizeRAGRetrievalTraces([
			{
				candidateTopK: 4,
				lexicalTopK: 4,
				maxResultsPerSource: undefined,
				mmrLambda: undefined,
				mode: 'vector',
				diversityStrategy: undefined,
				query: 'what is retrieval',
				resultCounts: {
					final: 2,
					fused: 4,
					lexical: 0,
					reranked: 3,
					vector: 4
				},
				runLexical: false,
				runVector: true,
				scoreThreshold: undefined,
				sourceBalanceStrategy: undefined,
				steps: [
					{ stage: 'input', label: 'input', count: 0 },
					{ stage: 'embed', label: 'embed' },
					{ stage: 'vector_search', label: 'vector search' },
					{ stage: 'fusion', label: 'fuse' },
					{ stage: 'rerank', label: 'rerank' },
					{ stage: 'score_filter', label: 'filter' },
					{ stage: 'finalize', label: 'finalize' }
				],
				topK: 3,
				transformedQuery: 'what is retrieval',
				variantQueries: []
			}
		]);
		if (!current || !previous) {
			throw new Error('Expected trace summaries');
		}

		const diff = compareRAGRetrievalTraceSummaries(current, previous);

		expect(diff.totalCasesDelta).toBe(1);
		expect(diff.vectorCasesDelta).toBe(1);
		expect(diff.lexicalCasesDelta).toBe(2);
		expect(diff.roundRobinCasesDelta).toBe(1);
		expect(diff.transformedCasesDelta).toBe(2);
		expect(diff.variantCasesDelta).toBe(1);
		expect(diff.multiVectorCasesDelta).toBe(2);
		expect(diff.multiVectorVectorHitCasesDelta).toBe(2);
		expect(diff.multiVectorLexicalHitCasesDelta).toBe(1);
		expect(diff.multiVectorCollapsedCasesDelta).toBe(2);
		expect(diff.stageCountsDelta?.source_balance?.delta).toBe(1);
		expect(diff.stageCountsDelta?.score_filter?.delta).toBe(-1);
		expect(diff.modeDelta.added).toEqual(['hybrid']);
		expect(diff.modeDelta.removed).toEqual(['vector']);
		expect(diff.sourceBalanceStrategyDelta.added).toEqual(['round_robin']);
		expect(diff.sourceBalanceStrategyDelta.removed).toEqual([]);
		expect(diff.averageCandidateTopKDelta).toBe(3);
	});

	it('builds a retrieval trace history trend across runs', () => {
		const runs: RAGEvaluationSuiteRun[] = [
			{
				id: 'run-oldest',
				suiteId: 'rag-suite',
				label: 'Run 1',
				startedAt: 10,
				finishedAt: 10,
				elapsedMs: 10,
				response: buildRAGEvaluationResponse([]),
				traceSummary: {
					averageCandidateTopK: 6,
					averageFinalCount: 2,
					averageLexicalCount: 1,
					averageLexicalTopK: 4,
					averageVectorCount: 2,
					balancedCases: 0,
					lexicalCases: 4,
					modes: ['vector'],
					roundRobinCases: 1,
					sourceBalanceStrategies: ['cap'],
					stageCounts: {
						finalize: 4,
						fusion: 2,
						lexical_search: 1,
						rerank: 2,
						vector_search: 6
					},
					totalCases: 6,
					transformedCases: 0,
					vectorCases: 2,
					variantCases: 0,
					multiVectorCases: 0,
					multiVectorVectorHitCases: 0,
					multiVectorLexicalHitCases: 0,
					multiVectorCollapsedCases: 0,
					officeEvidenceReconcileCases: 0,
					pdfEvidenceReconcileCases: 0,
					runtimeCandidateBudgetExhaustedCases: 0,
					runtimeUnderfilledTopKCases: 0
				}
			},
			{
				id: 'run-newest',
				suiteId: 'rag-suite',
				label: 'Run 4',
				startedAt: 100,
				finishedAt: 100,
				elapsedMs: 10,
				response: buildRAGEvaluationResponse([]),
				traceSummary: {
					averageCandidateTopK: 7,
					averageFinalCount: 4,
					averageLexicalCount: 1,
					averageLexicalTopK: 5,
					averageVectorCount: 3,
					balancedCases: 1,
					lexicalCases: 5,
					modes: ['hybrid', 'vector'],
					roundRobinCases: 1,
					sourceBalanceStrategies: ['cap', 'round_robin'],
					stageCounts: {
						fusion: 1,
						finalize: 10,
						lexical_search: 4,
						source_balance: 2,
						vector_search: 6
					},
					totalCases: 10,
					transformedCases: 1,
					vectorCases: 5,
					variantCases: 0,
					multiVectorCases: 0,
					multiVectorVectorHitCases: 0,
					multiVectorLexicalHitCases: 0,
					multiVectorCollapsedCases: 0,
					officeEvidenceReconcileCases: 0,
					pdfEvidenceReconcileCases: 0,
					runtimeCandidateBudgetExhaustedCases: 0,
					runtimeUnderfilledTopKCases: 0
				}
			},
			{
				id: 'run-middle-a',
				suiteId: 'rag-suite',
				label: 'Run 3',
				startedAt: 40,
				finishedAt: 40,
				elapsedMs: 10,
				response: buildRAGEvaluationResponse([]),
				traceSummary: {
					averageCandidateTopK: 5,
					averageFinalCount: 3,
					averageLexicalCount: 1,
					averageLexicalTopK: 4,
					averageVectorCount: 2,
					balancedCases: 1,
					lexicalCases: 4,
					modes: ['hybrid'],
					roundRobinCases: 1,
					sourceBalanceStrategies: ['cap'],
					stageCounts: {
						finalize: 5,
						fusion: 2,
						lexical_search: 3,
						rerank: 1,
						source_balance: 1,
						vector_search: 4
					},
					totalCases: 7,
					transformedCases: 1,
					vectorCases: 3,
					variantCases: 0,
					multiVectorCases: 0,
					multiVectorVectorHitCases: 0,
					multiVectorLexicalHitCases: 0,
					multiVectorCollapsedCases: 0,
					officeEvidenceReconcileCases: 0,
					pdfEvidenceReconcileCases: 0,
					runtimeCandidateBudgetExhaustedCases: 0,
					runtimeUnderfilledTopKCases: 0
				}
			},
			{
				id: 'run-middle-b',
				suiteId: 'rag-suite',
				label: 'Run 2',
				startedAt: 20,
				finishedAt: 20,
				elapsedMs: 10,
				response: buildRAGEvaluationResponse([]),
				traceSummary: {
					averageCandidateTopK: 6,
					averageFinalCount: 3,
					averageLexicalCount: 2,
					averageLexicalTopK: 6,
					averageVectorCount: 2,
					balancedCases: 0,
					lexicalCases: 4,
					modes: ['vector'],
					roundRobinCases: 0,
					sourceBalanceStrategies: ['cap'],
					stageCounts: {
						fusion: 1,
						finalize: 7,
						score_filter: 1,
						vector_search: 4
					},
					totalCases: 8,
					transformedCases: 0,
					vectorCases: 4,
					variantCases: 1,
					multiVectorCases: 0,
					multiVectorVectorHitCases: 0,
					multiVectorLexicalHitCases: 0,
					multiVectorCollapsedCases: 0,
					officeEvidenceReconcileCases: 0,
					pdfEvidenceReconcileCases: 0,
					runtimeCandidateBudgetExhaustedCases: 0,
					runtimeUnderfilledTopKCases: 0
				}
			}
		];
		const trend = buildRAGRetrievalTraceHistoryTrend({
			runs
		});
		const latestToPrevious = trend.latestToPrevious;

		expect(trend.runsWithTraceSummary).toBe(4);
		expect(trend.summaryTrendWindows).toHaveLength(3);
		expect(trend.summaryTrendWindows[0]?.currentRunLabel).toBe('Run 4');
		expect(trend.summaryTrendWindows[0]?.previousRunLabel).toBe('Run 3');
		expect(latestToPrevious?.averageFinalCountDelta).toBe(1);
		expect(latestToPrevious?.totalCasesDelta).toBe(3);
		expect(latestToPrevious?.averageCandidateTopKDelta).toBe(2);
		expect(trend.modeTurnover.current).toEqual(['hybrid', 'vector']);
		expect(trend.modeTurnover.previous).toEqual(['hybrid']);
		expect(trend.modeTurnover.appeared).toEqual(['vector']);
		expect(trend.modeTurnover.disappeared).toEqual([]);
		expect(trend.modeTurnover.stable).toEqual(['hybrid']);
		expect(trend.modeTurnover.frequency).toMatchObject({
			hybrid: 2,
			vector: 3
		});
		expect(trend.sourceBalanceStrategyTurnover.current).toEqual([
			'cap',
			'round_robin'
		]);
		expect(trend.sourceBalanceStrategyTurnover.previous).toEqual(['cap']);
		expect(trend.sourceBalanceStrategyTurnover.appeared).toEqual([
			'round_robin'
		]);
		expect(trend.sourceBalanceStrategyTurnover.stable).toEqual(['cap']);
		expect(trend.sourceBalanceStrategyTurnover.disappeared).toEqual([]);
		expect(trend.sourceBalanceStrategyTurnover.frequency).toEqual({
			cap: 4,
			round_robin: 1
		});
		expect(trend.aggregate).toContainEqual(
			expect.objectContaining({
				metric: 'totalCases',
				current: 10,
				previous: 6,
				delta: 4,
				direction: 'up'
			})
		);
		expect(trend.bestMetric?.metric).toBe('totalCases');
		expect(trend.worstVolatileStage?.stage).toBe('finalize');
		expect(trend.worstVolatileStage?.totalChanges).toBe(10);
	});

	it('builds persisted search trace records and history outside evaluation suites', async () => {
		const storePath = `/tmp/rag-search-traces-${Date.now()}.json`;
		tempPaths.add(storePath);
		const store = createRAGFileSearchTraceStore(storePath);

		const first = buildRAGSearchTraceRecord({
			finishedAt: 200,
			groupKey: 'docs-search',
			id: 'trace-1',
			results: [
				{
					chunkId: 'doc-a:001',
					metadata: { documentId: 'doc-a' },
					score: 0.91,
					source: 'docs/a.md',
					title: 'Doc A'
				}
			],
			startedAt: 100,
			tags: ['docs', 'search'],
			trace: {
				candidateTopK: 4,
				lexicalTopK: 2,
				mode: 'vector',
				query: 'alpha',
				resultCounts: {
					final: 1,
					fused: 1,
					lexical: 0,
					reranked: 1,
					vector: 1
				},
				runLexical: false,
				runVector: true,
				steps: [],
				topK: 1,
				transformedQuery: 'alpha',
				variantQueries: []
			}
		});
		const second = buildRAGSearchTraceRecord({
			finishedAt: 400,
			groupKey: 'docs-search',
			id: 'trace-2',
			results: [
				{
					chunkId: 'doc-b:001',
					metadata: { documentId: 'doc-b' },
					score: 0.95,
					source: 'docs/b.md',
					title: 'Doc B'
				},
				{
					chunkId: 'doc-a:001',
					metadata: { documentId: 'doc-a' },
					score: 0.88,
					source: 'docs/a.md',
					title: 'Doc A'
				}
			],
			startedAt: 320,
			tags: ['docs', 'search', 'hybrid'],
			trace: {
				candidateTopK: 6,
				lexicalTopK: 4,
				mode: 'hybrid',
				query: 'alpha',
				resultCounts: {
					final: 2,
					fused: 2,
					lexical: 1,
					reranked: 2,
					vector: 2
				},
				runLexical: true,
				runVector: true,
				sourceBalanceStrategy: 'round_robin',
				steps: [],
				topK: 2,
				transformedQuery: 'alpha expanded',
				variantQueries: ['alpha alt']
			}
		});

		const diff = buildRAGSearchTraceDiff({
			current: second,
			previous: first
		});
		expect(diff).toMatchObject({
			addedChunkIds: ['doc-b:001'],
			currentTraceId: 'trace-2',
			previousTraceId: 'trace-1',
			retainedChunkIds: ['doc-a:001'],
			topResultChanged: true
		});
		expect(diff.summaryDelta?.modeDelta.added).toEqual(['hybrid']);

		await persistRAGSearchTraceRecord({ record: first, store });
		await persistRAGSearchTraceRecord({ record: second, store });

		const history = await loadRAGSearchTraceHistory({
			groupKey: 'docs-search',
			query: 'alpha',
			store
		});
		expect(history.latestTrace?.id).toBe('trace-2');
		expect(history.previousTrace?.id).toBe('trace-1');
		expect(history.groupKey).toBe('docs-search');
		expect(history.tag).toBeUndefined();
		expect(history.diff?.addedChunkIds).toEqual(['doc-b:001']);
		expect(history.retrievalTraceTrend.runsWithTraceSummary).toBe(2);
		expect(
			history.retrievalTraceTrend.latestToPrevious?.modeDelta.added
		).toEqual(['hybrid']);
		expect(history.latestTrace?.results[0]).toMatchObject({
			chunkId: 'doc-b:001',
			documentId: 'doc-b'
		});
		expect(history.latestTrace?.tags).toEqual(['docs', 'hybrid', 'search']);
	});

	it('loads grouped search trace history by group key and tag', async () => {
		const storePath = `/tmp/rag-search-trace-groups-${Date.now()}.json`;
		tempPaths.add(storePath);
		const store = createRAGFileSearchTraceStore(storePath);

		await persistRAGSearchTraceRecord({
			record: buildRAGSearchTraceRecord({
				finishedAt: 100,
				groupKey: 'docs-search',
				id: 'group-trace-1',
				results: [{ chunkId: 'doc-a:001', score: 0.8 }],
				startedAt: 90,
				tags: ['docs'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'vector',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 0,
						reranked: 1,
						vector: 1
					},
					runLexical: false,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha',
					variantQueries: []
				}
			}),
			store
		});
		await persistRAGSearchTraceRecord({
			record: buildRAGSearchTraceRecord({
				finishedAt: 200,
				groupKey: 'docs-search',
				id: 'group-trace-2',
				results: [{ chunkId: 'doc-b:001', score: 0.9 }],
				startedAt: 180,
				tags: ['docs'],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 4,
					mode: 'hybrid',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha expanded',
					variantQueries: ['alpha alt']
				}
			}),
			store
		});
		await persistRAGSearchTraceRecord({
			record: buildRAGSearchTraceRecord({
				finishedAt: 300,
				groupKey: 'support-search',
				id: 'group-trace-3',
				results: [{ chunkId: 'ticket-1:001', score: 0.85 }],
				startedAt: 280,
				tags: ['support'],
				trace: {
					candidateTopK: 5,
					lexicalTopK: 3,
					mode: 'lexical',
					query: 'reset password',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 0
					},
					runLexical: true,
					runVector: false,
					steps: [],
					topK: 1,
					transformedQuery: 'reset password',
					variantQueries: []
				}
			}),
			store
		});

		const docsGroups = await loadRAGSearchTraceGroupHistory({
			store,
			tag: 'docs'
		});
		expect(docsGroups.tag).toBe('docs');
		expect(docsGroups.groups).toHaveLength(1);
		expect(docsGroups.groups[0]).toMatchObject({
			groupKey: 'docs-search',
			traceCount: 2
		});
		expect(docsGroups.groups[0]?.diff?.topResultChanged).toBe(true);
		expect(
			docsGroups.groups[0]?.retrievalTraceTrend.latestToPrevious
				?.modeDelta.added
		).toEqual(['hybrid']);

		const allGroups = await loadRAGSearchTraceGroupHistory({ store });
		expect(allGroups.groups.map((entry) => entry.groupKey)).toEqual([
			'support-search',
			'docs-search'
		]);
	});

	it('persists search traces in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteSearchTraceStore({
			db,
			tableName: 'search_trace_history'
		});

		await persistRAGSearchTraceRecord({
			record: buildRAGSearchTraceRecord({
				finishedAt: 100,
				groupKey: 'docs-search',
				id: 'sqlite-trace-1',
				results: [
					{
						chunkId: 'doc-a:001',
						metadata: { documentId: 'doc-a' },
						score: 0.87,
						source: 'docs/a.md',
						title: 'Doc A'
					}
				],
				startedAt: 80,
				tags: ['docs', 'sqlite'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'vector',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 0,
						reranked: 1,
						vector: 1
					},
					runLexical: false,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha',
					variantQueries: []
				}
			}),
			store
		});
		await persistRAGSearchTraceRecord({
			record: buildRAGSearchTraceRecord({
				finishedAt: 200,
				groupKey: 'docs-search',
				id: 'sqlite-trace-2',
				results: [
					{
						chunkId: 'doc-b:001',
						metadata: { documentId: 'doc-b' },
						score: 0.93,
						source: 'docs/b.md',
						title: 'Doc B'
					}
				],
				startedAt: 150,
				tags: ['docs', 'hybrid', 'sqlite'],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 4,
					mode: 'hybrid',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha expanded',
					variantQueries: ['alpha alt']
				}
			}),
			store
		});

		const history = await loadRAGSearchTraceHistory({
			groupKey: 'docs-search',
			query: 'alpha',
			store,
			tag: 'sqlite'
		});
		expect(history.latestTrace?.id).toBe('sqlite-trace-2');
		expect(history.previousTrace?.id).toBe('sqlite-trace-1');
		expect(history.diff?.topResultChanged).toBe(true);
		expect(history.latestTrace?.results[0]).toMatchObject({
			chunkId: 'doc-b:001',
			documentId: 'doc-b'
		});

		const grouped = await loadRAGSearchTraceGroupHistory({
			store,
			tag: 'sqlite'
		});
		expect(grouped.groups).toEqual([
			expect.objectContaining({
				groupKey: 'docs-search',
				traceCount: 2
			})
		]);
	});

	it('persists search trace prune history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteSearchTracePruneHistoryStore({
			db,
			tableName: 'search_trace_prune_history'
		});

		await persistRAGSearchTracePruneRun({
			run: {
				elapsedMs: 1,
				finishedAt: 2,
				id: 'sqlite-prune-run-2',
				startedAt: 1,
				trigger: 'manual'
			},
			store
		});
		await persistRAGSearchTracePruneRun({
			run: {
				elapsedMs: 1,
				finishedAt: 1,
				id: 'sqlite-prune-run-1',
				startedAt: 0,
				trigger: 'schedule'
			},
			store
		});

		const runs = await loadRAGSearchTracePruneHistory({
			limit: 5,
			store
		});
		const manualRuns = await loadRAGSearchTracePruneHistory({
			limit: 5,
			store,
			trigger: 'manual'
		});

		expect(
			runs.map((entry) => `${entry.trigger}:${entry.finishedAt}`)
		).toEqual(['manual:2', 'schedule:1']);
		expect(manualRuns[0]?.id).toBe('sqlite-prune-run-2');
	});

	it('builds a SQLite governance store bundle for rag chat config', async () => {
		const db = new Database(':memory:');
		const stores = createRAGSQLiteGovernanceStores({
			db,
			tablePrefix: 'demo'
		});

		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: 'baseline-1',
				decidedAt: 1,
				groupKey: 'docs-release',
				id: 'bundle-decision-1',
				kind: 'promote',
				retrievalId: 'vector',
				version: 1
			},
			store: stores.retrievalReleaseDecisionStore!
		});
		await persistRAGSearchTracePruneRun({
			run: {
				elapsedMs: 1,
				finishedAt: 3,
				id: 'bundle-prune-1',
				startedAt: 2,
				trigger: 'write'
			},
			store: stores.searchTracePruneHistoryStore!
		});

		const decisions = await loadRAGRetrievalReleaseDecisions({
			groupKey: 'docs-release',
			limit: 5,
			store: stores.retrievalReleaseDecisionStore!
		});
		const pruneRuns = await loadRAGSearchTracePruneHistory({
			limit: 5,
			store: stores.searchTracePruneHistoryStore!
		});

		expect(stores.searchTraceStore).toBeDefined();
		expect(stores.retrievalComparisonHistoryStore).toBeDefined();
		expect(decisions[0]?.id).toBe('bundle-decision-1');
		expect(pruneRuns[0]?.id).toBe('bundle-prune-1');
	});

	it('upgrades legacy SQLite governance tables missing corpus group columns', async () => {
		const db = new Database(':memory:');

		db.exec(`
			CREATE TABLE legacy_baselines (
				id TEXT PRIMARY KEY,
				group_key TEXT NOT NULL,
				rollout_label TEXT,
				promoted_at INTEGER NOT NULL,
				status TEXT NOT NULL,
				version INTEGER NOT NULL,
				tags_json TEXT,
				record_json TEXT NOT NULL
			)
		`);
		db.exec(`
			CREATE TABLE legacy_comparisons (
				id TEXT PRIMARY KEY,
				suite_id TEXT NOT NULL,
				suite_label TEXT NOT NULL,
				label TEXT NOT NULL,
				group_key TEXT,
				tags_json TEXT,
				started_at INTEGER NOT NULL,
				finished_at INTEGER NOT NULL,
				elapsed_ms INTEGER NOT NULL,
				comparison_json TEXT NOT NULL,
				decision_summary_json TEXT
			)
		`);
		db.exec(`
			CREATE TABLE legacy_decisions (
				id TEXT PRIMARY KEY,
				group_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				decided_at INTEGER NOT NULL,
				record_json TEXT NOT NULL
			)
		`);

		const baselineStore = createRAGSQLiteRetrievalBaselineStore({
			db,
			tableName: 'legacy_baselines'
		});
		const comparisonStore = createRAGSQLiteRetrievalComparisonHistoryStore({
			db,
			tableName: 'legacy_comparisons'
		});
		const decisionStore = createRAGSQLiteRetrievalReleaseDecisionStore({
			db,
			tableName: 'legacy_decisions'
		});

		await persistRAGRetrievalBaseline({
			record: {
				corpusGroupKey: 'alpha',
				groupKey: 'docs-release',
				id: 'legacy-baseline',
				label: 'Legacy baseline',
				promotedAt: 1,
				retrievalId: 'vector',
				rolloutLabel: 'stable',
				status: 'active',
				version: 1
			},
			store: baselineStore
		});
		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'vector',
						bestByPassingRate: 'vector',
						fastest: 'vector'
					},
					suiteId: 'suite-a',
					suiteLabel: 'Docs Suite'
				},
				corpusGroupKey: 'alpha',
				elapsedMs: 1,
				finishedAt: 2,
				groupKey: 'docs-release',
				id: 'legacy-run',
				label: 'Legacy run',
				startedAt: 1,
				suiteId: 'suite-a',
				suiteLabel: 'Docs Suite'
			},
			store: comparisonStore
		});
		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: 'legacy-baseline',
				corpusGroupKey: 'alpha',
				decidedAt: 3,
				groupKey: 'docs-release',
				id: 'legacy-decision',
				kind: 'promote',
				retrievalId: 'vector',
				version: 1
			},
			store: decisionStore
		});

		expect(
			(
				await loadRAGRetrievalBaselines({
					corpusGroupKey: 'alpha',
					groupKey: 'docs-release',
					store: baselineStore
				})
			)[0]?.id
		).toBe('legacy-baseline');
		expect(
			(
				await loadRAGRetrievalComparisonHistory({
					corpusGroupKey: 'alpha',
					groupKey: 'docs-release',
					store: comparisonStore
				})
			)[0]?.id
		).toBe('legacy-run');
		expect(
			(
				await loadRAGRetrievalReleaseDecisions({
					corpusGroupKey: 'alpha',
					groupKey: 'docs-release',
					store: decisionStore
				})
			)[0]?.id
		).toBe('legacy-decision');
	});

	it('inspects and applies shared SQLite store migrations for legacy governance tables', () => {
		const db = new Database(':memory:');
		db.exec(`
			CREATE TABLE rag_retrieval_baselines (
				id TEXT PRIMARY KEY,
				group_key TEXT NOT NULL,
				label TEXT NOT NULL,
				status TEXT NOT NULL,
				version INTEGER NOT NULL,
				retrieval_id TEXT NOT NULL,
				promoted_at INTEGER NOT NULL,
				record_json TEXT NOT NULL
			)
		`);
		db.exec(`
			CREATE TABLE rag_retrieval_comparison_history (
				id TEXT PRIMARY KEY,
				suite_id TEXT NOT NULL,
				suite_label TEXT NOT NULL,
				label TEXT NOT NULL,
				group_key TEXT,
				tags_json TEXT,
				started_at INTEGER NOT NULL,
				finished_at INTEGER NOT NULL,
				elapsed_ms INTEGER NOT NULL,
				comparison_json TEXT NOT NULL,
				decision_summary_json TEXT
			)
		`);
		db.exec(`
			CREATE TABLE rag_retrieval_release_decisions (
				id TEXT PRIMARY KEY,
				group_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				decided_at INTEGER NOT NULL,
				record_json TEXT NOT NULL
			)
		`);

		expect(inspectRAGSQLiteStoreMigrations({ db })).toEqual({
			issues: [
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_comparison_history'
				},
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_release_decisions'
				},
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_baselines'
				}
			],
			summary: '3 SQLite schema migration issues detected'
		});

		expect(applyRAGSQLiteStoreMigrations({ db })).toEqual({
			applied: [
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_comparison_history'
				},
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_release_decisions'
				},
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_baselines'
				}
			],
			issues: [
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_comparison_history'
				},
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_release_decisions'
				},
				{
					columnName: 'corpus_group_key',
					definition: 'TEXT',
					tableName: 'rag_retrieval_baselines'
				}
			],
			summary: '3 SQLite schema migration issues detected'
		});

		expect(inspectRAGSQLiteStoreMigrations({ db })).toEqual({
			issues: [],
			summary: undefined
		});
	});

	it('persists retrieval comparison history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalComparisonHistoryStore({
			db,
			tableName: 'retrieval_comparison_history'
		});

		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'hybrid',
						bestByPassingRate: 'hybrid',
						fastest: 'vector'
					},
					suiteId: 'suite-a',
					suiteLabel: 'Docs Suite'
				},
				finishedAt: 20,
				groupKey: 'docs-release',
				id: 'sqlite-run-a',
				label: 'Docs benchmark',
				startedAt: 10,
				suiteId: 'suite-a',
				suiteLabel: 'Docs Suite',
				elapsedMs: 10,
				tags: ['docs', 'sqlite']
			},
			store
		});
		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'vector',
						bestByPassingRate: 'vector',
						fastest: 'vector'
					},
					suiteId: 'suite-b',
					suiteLabel: 'Support Suite'
				},
				finishedAt: 40,
				groupKey: 'support-release',
				id: 'sqlite-run-b',
				label: 'Support benchmark',
				startedAt: 30,
				suiteId: 'suite-b',
				suiteLabel: 'Support Suite',
				elapsedMs: 10,
				tags: ['support', 'sqlite']
			},
			store
		});

		const byGroup = await loadRAGRetrievalComparisonHistory({
			groupKey: 'docs-release',
			store
		});
		const byWinner = await loadRAGRetrievalComparisonHistory({
			store,
			winnerId: 'vector'
		});
		const byTag = await loadRAGRetrievalComparisonHistory({
			store,
			tag: 'support'
		});

		expect(byGroup.map((run) => run.id)).toEqual(['sqlite-run-a']);
		expect(byWinner.map((run) => run.id)).toEqual(['sqlite-run-b']);
		expect(byTag.map((run) => run.id)).toEqual(['sqlite-run-b']);
	});

	it('prunes file-backed search trace stores by age and retention caps', async () => {
		const storePath = `/tmp/rag-search-trace-prune-${Date.now()}.json`;
		tempPaths.add(storePath);
		const store = createRAGFileSearchTraceStore(storePath);

		for (const record of [
			buildRAGSearchTraceRecord({
				finishedAt: 100,
				groupKey: 'docs-search',
				id: 'prune-1',
				results: [{ chunkId: 'doc-a:001', score: 0.8 }],
				startedAt: 90,
				tags: ['docs'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'vector',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 0,
						reranked: 1,
						vector: 1
					},
					runLexical: false,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha',
					variantQueries: []
				}
			}),
			buildRAGSearchTraceRecord({
				finishedAt: 200,
				groupKey: 'docs-search',
				id: 'prune-2',
				results: [{ chunkId: 'doc-b:001', score: 0.85 }],
				startedAt: 180,
				tags: ['docs'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'vector',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 0,
						reranked: 1,
						vector: 1
					},
					runLexical: false,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha',
					variantQueries: []
				}
			}),
			buildRAGSearchTraceRecord({
				finishedAt: 300,
				groupKey: 'docs-search',
				id: 'prune-3',
				results: [{ chunkId: 'doc-c:001', score: 0.9 }],
				startedAt: 280,
				tags: ['docs'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'hybrid',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha expanded',
					variantQueries: []
				}
			}),
			buildRAGSearchTraceRecord({
				finishedAt: 310,
				groupKey: 'support-search',
				id: 'prune-4',
				results: [{ chunkId: 'ticket-1:001', score: 0.95 }],
				startedAt: 300,
				tags: ['support'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'lexical',
					query: 'reset password',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 0
					},
					runLexical: true,
					runVector: false,
					steps: [],
					topK: 1,
					transformedQuery: 'reset password',
					variantQueries: []
				}
			})
		]) {
			await persistRAGSearchTraceRecord({ record, store });
		}

		const result = await pruneRAGSearchTraceStore({
			input: {
				maxAgeMs: 150,
				maxRecordsPerGroup: 1,
				maxRecordsPerQuery: 2,
				now: 320,
				tag: 'docs'
			},
			store
		});

		expect(result).toEqual({
			keptCount: 2,
			removedCount: 2
		});

		const docsHistory = await loadRAGSearchTraceHistory({
			groupKey: 'docs-search',
			query: 'alpha',
			store
		});
		expect(docsHistory.traces.map((trace) => trace.id)).toEqual([
			'prune-3'
		]);

		const supportHistory = await loadRAGSearchTraceHistory({
			query: 'reset password',
			store
		});
		expect(supportHistory.traces.map((trace) => trace.id)).toEqual([
			'prune-4'
		]);
	});

	it('prunes SQLite-backed search trace stores by group retention', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteSearchTraceStore({
			db,
			tableName: 'search_trace_prune'
		});

		for (const record of [
			buildRAGSearchTraceRecord({
				finishedAt: 100,
				groupKey: 'docs-search',
				id: 'sqlite-prune-1',
				results: [{ chunkId: 'doc-a:001', score: 0.8 }],
				startedAt: 90,
				tags: ['docs', 'sqlite'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'vector',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 0,
						reranked: 1,
						vector: 1
					},
					runLexical: false,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha',
					variantQueries: []
				}
			}),
			buildRAGSearchTraceRecord({
				finishedAt: 200,
				groupKey: 'docs-search',
				id: 'sqlite-prune-2',
				results: [{ chunkId: 'doc-b:001', score: 0.9 }],
				startedAt: 190,
				tags: ['docs', 'sqlite'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'hybrid',
					query: 'alpha',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'alpha expanded',
					variantQueries: []
				}
			}),
			buildRAGSearchTraceRecord({
				finishedAt: 210,
				groupKey: 'research-search',
				id: 'sqlite-prune-3',
				results: [{ chunkId: 'paper-1:001', score: 0.92 }],
				startedAt: 205,
				tags: ['research', 'sqlite'],
				trace: {
					candidateTopK: 4,
					lexicalTopK: 2,
					mode: 'vector',
					query: 'embedding drift',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 0,
						reranked: 1,
						vector: 1
					},
					runLexical: false,
					runVector: true,
					steps: [],
					topK: 1,
					transformedQuery: 'embedding drift',
					variantQueries: []
				}
			})
		]) {
			await persistRAGSearchTraceRecord({ record, store });
		}

		const result = await pruneRAGSearchTraceStore({
			input: {
				maxRecordsPerGroup: 1
			},
			store
		});

		expect(result).toEqual({
			keptCount: 2,
			removedCount: 1
		});

		const docsHistory = await loadRAGSearchTraceHistory({
			groupKey: 'docs-search',
			query: 'alpha',
			store
		});
		expect(docsHistory.traces.map((trace) => trace.id)).toEqual([
			'sqlite-prune-2'
		]);
	});

	it('persists prune run history for search trace retention workflows', async () => {
		const path = `/tmp/rag-search-trace-prune-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileSearchTracePruneHistoryStore(path);

		await persistRAGSearchTracePruneRun({
			run: {
				elapsedMs: 10,
				finishedAt: 20,
				id: 'prune-run-1',
				result: {
					keptCount: 3,
					removedCount: 2
				},
				startedAt: 10,
				trigger: 'manual'
			},
			store
		});
		await persistRAGSearchTracePruneRun({
			run: {
				elapsedMs: 8,
				finishedAt: 40,
				id: 'prune-run-2',
				startedAt: 32,
				trigger: 'schedule'
			},
			store
		});

		const history = await loadRAGSearchTracePruneHistory({
			limit: 5,
			store,
			trigger: 'manual'
		});

		expect(history).toEqual([
			expect.objectContaining({
				id: 'prune-run-1',
				trigger: 'manual',
				result: {
					keptCount: 3,
					removedCount: 2
				}
			})
		]);
	});

	it('runs saved suites and builds a leaderboard', async () => {
		const suite = createRAGEvaluationSuite({
			id: 'core-suite',
			input: {
				cases: [
					{ expectedDocumentIds: ['a'], id: 'case-a', query: 'alpha' }
				]
			},
			label: 'Core Suite'
		});

		const strongRun = await runRAGEvaluationSuite({
			suite,
			evaluate: async () =>
				buildRAGEvaluationResponse([
					{
						caseId: 'case-a',
						elapsedMs: 8,
						expectedCount: 1,
						expectedIds: ['a'],
						f1: 1,
						matchedCount: 1,
						matchedIds: ['a'],
						missingIds: [],
						mode: 'documentId',
						precision: 1,
						query: 'alpha',
						recall: 1,
						retrievedCount: 1,
						retrievedIds: ['a'],
						status: 'pass',
						topK: 2
					}
				])
		});
		const weakerRun = await runRAGEvaluationSuite({
			suite,
			evaluate: async () =>
				buildRAGEvaluationResponse([
					{
						caseId: 'case-a',
						elapsedMs: 20,
						expectedCount: 1,
						expectedIds: ['a'],
						f1: 0,
						matchedCount: 0,
						matchedIds: [],
						missingIds: ['a'],
						mode: 'documentId',
						precision: 0,
						query: 'alpha',
						recall: 0,
						retrievedCount: 1,
						retrievedIds: ['b'],
						status: 'fail',
						topK: 2
					}
				])
		});

		const leaderboard = buildRAGEvaluationLeaderboard([
			weakerRun,
			strongRun
		]);

		expect(leaderboard[0]).toMatchObject({
			label: 'Core Suite',
			passingRate: 100,
			rank: 1,
			runId: strongRun.id
		});
		expect(leaderboard[1]?.runId).toBe(weakerRun.id);
	});

	it('supports immutable evaluation suite authoring helpers', () => {
		const suite = createRAGEvaluationSuite({
			description: 'Docs benchmark',
			id: 'author-suite',
			input: {
				cases: [
					{
						expectedChunkIds: ['chunk-a'],
						id: 'case-a',
						label: 'Case A',
						query: 'alpha'
					},
					{
						expectedChunkIds: ['chunk-b'],
						id: 'case-b',
						label: 'Case B',
						query: 'beta'
					}
				],
				topK: 4
			},
			label: 'Author Suite',
			metadata: { owner: 'docs' }
		});

		const added = addRAGEvaluationSuiteCase({
			caseInput: {
				expectedChunkIds: ['chunk-c'],
				id: 'case-c',
				label: 'Case C',
				query: 'gamma'
			},
			index: 1,
			suite
		});
		expect(suite.input.cases.map((entry) => entry.id)).toEqual([
			'case-a',
			'case-b'
		]);
		expect(added.input.cases.map((entry) => entry.id)).toEqual([
			'case-a',
			'case-c',
			'case-b'
		]);

		const updated = updateRAGEvaluationSuiteCase({
			caseId: 'case-c',
			caseInput: {
				expectedChunkIds: ['chunk-c2'],
				id: 'case-c',
				label: 'Case C updated',
				query: 'gamma updated'
			},
			suite: added
		});
		expect(
			updated.input.cases.find((entry) => entry.id === 'case-c')
		).toMatchObject({
			expectedChunkIds: ['chunk-c2'],
			label: 'Case C updated',
			query: 'gamma updated'
		});

		const reordered = reorderRAGEvaluationSuiteCases({
			caseIds: ['case-c', 'case-a', 'case-b'],
			suite: updated
		});
		expect(reordered.input.cases.map((entry) => entry.id)).toEqual([
			'case-c',
			'case-a',
			'case-b'
		]);

		const removed = removeRAGEvaluationSuiteCase({
			caseId: 'case-a',
			suite: reordered
		});
		expect(removed.input.cases.map((entry) => entry.id)).toEqual([
			'case-c',
			'case-b'
		]);
		expect(removed.input.topK).toBe(4);
		expect(removed.metadata).toMatchObject({ owner: 'docs' });

		const golden = setRAGEvaluationSuiteCaseGoldenSet({
			caseId: 'case-b',
			goldenSet: true,
			suite: removed
		});
		expect(
			golden.input.cases.find((entry) => entry.id === 'case-b')
		).toMatchObject({
			goldenSet: true
		});

		const withHardNegative = addRAGEvaluationSuiteCaseHardNegative({
			caseId: 'case-b',
			kind: 'source',
			suite: golden,
			value: ' docs/irrelevant.md '
		});
		expect(
			withHardNegative.input.cases.find((entry) => entry.id === 'case-b')
		).toMatchObject({
			goldenSet: true,
			hardNegativeSources: ['docs/irrelevant.md']
		});

		const withoutHardNegative = removeRAGEvaluationSuiteCaseHardNegative({
			caseId: 'case-b',
			kind: 'source',
			suite: withHardNegative,
			value: 'docs/irrelevant.md'
		});
		expect(
			withoutHardNegative.input.cases.find(
				(entry) => entry.id === 'case-b'
			)
		).toMatchObject({
			goldenSet: true,
			hardNegativeSources: undefined
		});

		expect(
			summarizeRAGEvaluationSuiteDataset({ suite: withHardNegative })
		).toMatchObject({
			caseCount: 2,
			goldenSetCount: 1,
			hardNegativeCaseCount: 1,
			hardNegativeSourceCount: 1,
			suiteId: 'author-suite'
		});
	});

	it('validates duplicate and missing ids in evaluation suite authoring helpers', () => {
		expect(() =>
			createRAGEvaluationSuite({
				id: 'dup-suite',
				input: {
					cases: [
						{ expectedChunkIds: ['a'], id: 'case-a', query: 'a' },
						{ expectedChunkIds: ['b'], id: 'case-a', query: 'b' }
					]
				}
			})
		).toThrow(/duplicate case ids/i);

		const suite = createRAGEvaluationSuite({
			id: 'guard-suite',
			input: {
				cases: [{ expectedChunkIds: ['a'], id: 'case-a', query: 'a' }]
			}
		});

		expect(() =>
			addRAGEvaluationSuiteCase({
				caseInput: {
					expectedChunkIds: ['b'],
					id: 'case-a',
					query: 'duplicate'
				},
				suite
			})
		).toThrow(/already contains case id case-a/i);
		expect(() =>
			updateRAGEvaluationSuiteCase({
				caseId: 'missing',
				caseInput: {
					expectedChunkIds: ['b'],
					id: 'missing',
					query: 'missing'
				},
				suite
			})
		).toThrow(/does not contain case id missing/i);
		expect(() =>
			removeRAGEvaluationSuiteCase({
				caseId: 'missing',
				suite
			})
		).toThrow(/does not contain case id missing/i);
		expect(() =>
			reorderRAGEvaluationSuiteCases({
				caseIds: ['case-a', 'extra'],
				suite
			})
		).toThrow(/requires exactly one id per case/i);
	});

	it('builds immutable evaluation suite snapshots and diffs', () => {
		const baseSuite = createRAGEvaluationSuite({
			id: 'snapshot-suite',
			input: {
				cases: [
					{
						expectedChunkIds: ['chunk-a'],
						id: 'case-a',
						label: 'Case A',
						query: 'alpha'
					},
					{
						expectedChunkIds: ['chunk-b'],
						id: 'case-b',
						label: 'Case B',
						query: 'beta'
					}
				]
			},
			label: 'Snapshot Suite'
		});

		const previousSnapshot = createRAGEvaluationSuiteSnapshot({
			createdAt: 1,
			metadata: { author: 'docs' },
			suite: baseSuite,
			version: 1
		});
		expect(previousSnapshot).toMatchObject({
			caseCount: 2,
			createdAt: 1,
			id: 'snapshot-suite:snapshot:1',
			metadata: { author: 'docs' },
			suiteId: 'snapshot-suite',
			version: 1
		});

		const expandedSuite = addRAGEvaluationSuiteCase({
			caseInput: {
				expectedChunkIds: ['chunk-a2'],
				id: 'case-a2',
				label: 'Case A2',
				query: 'alpha-2'
			},
			suite: baseSuite
		});
		const withoutOriginalCase = removeRAGEvaluationSuiteCase({
			caseId: 'case-a',
			suite: expandedSuite
		});
		const updatedSuite = updateRAGEvaluationSuiteCase({
			caseId: 'case-b',
			caseInput: {
				expectedChunkIds: ['chunk-b2'],
				goldenSet: true,
				hardNegativeSources: ['docs/decoy.md'],
				id: 'case-b',
				label: 'Case B updated',
				query: 'beta updated'
			},
			suite: withoutOriginalCase
		});
		const appendedSuite = addRAGEvaluationSuiteCase({
			caseInput: {
				expectedChunkIds: ['chunk-c'],
				id: 'case-c',
				label: 'Case C',
				query: 'gamma'
			},
			suite: updatedSuite
		});
		const changedSuite = reorderRAGEvaluationSuiteCases({
			caseIds: ['case-c', 'case-b', 'case-a2'],
			suite: appendedSuite
		});
		const currentSnapshot = createRAGEvaluationSuiteSnapshot({
			createdAt: 2,
			suite: changedSuite,
			version: 2
		});

		const diff = buildRAGEvaluationSuiteSnapshotDiff({
			current: currentSnapshot,
			previous: previousSnapshot
		});
		expect(diff).toMatchObject({
			addedCaseIds: ['case-c', 'case-a2'],
			caseCountDelta: 1,
			changedCaseIds: ['case-b'],
			currentSnapshotId: 'snapshot-suite:snapshot:2',
			orderChanged: false,
			previousSnapshotId: 'snapshot-suite:snapshot:1',
			removedCaseIds: ['case-a'],
			suiteId: 'snapshot-suite',
			unchangedCaseIds: []
		});
	});

	it('generates deterministic synthetic evaluation suites from indexed documents', () => {
		const suite = generateRAGEvaluationSuiteFromDocuments({
			description: 'Synthetic corpus bootstrap',
			documents: [
				{
					id: 'guide-doc',
					source: 'docs/guide.md',
					text: '# Guide\n\nDirectory sync keeps retrieval aligned for release docs.',
					title: 'Guide'
				},
				{
					id: 'faq-doc',
					source: 'docs/faq.md',
					text: '# FAQ\n\nAnswer common release workflow questions for support teams.',
					title: 'FAQ'
				},
				{
					id: 'ops-doc',
					source: 'docs/ops.md',
					text: '# Ops\n\nOperational handoff guidance keeps incidents visible.',
					title: 'Ops'
				}
			],
			hardNegativePerCase: 1,
			label: 'Synthetic Suite',
			maxCases: 2,
			suiteId: 'synthetic-suite',
			topK: 4
		});

		expect(suite).toMatchObject({
			description: 'Synthetic corpus bootstrap',
			id: 'synthetic-suite',
			input: {
				topK: 4
			},
			label: 'Synthetic Suite'
		});
		expect(suite.input.cases).toHaveLength(2);
		expect(suite.input.cases[0]).toMatchObject({
			expectedDocumentIds: ['faq-doc'],
			expectedSources: ['docs/faq.md'],
			goldenSet: true,
			hardNegativeDocumentIds: ['guide-doc'],
			hardNegativeSources: ['docs/guide.md'],
			id: 'synthetic-faq-doc',
			label: 'FAQ',
			query: 'FAQ Answer common release workflow questions for support teams.'
		});
		expect(suite.input.cases[1]).toMatchObject({
			expectedDocumentIds: ['guide-doc'],
			expectedSources: ['docs/guide.md'],
			goldenSet: true,
			hardNegativeDocumentIds: ['faq-doc'],
			hardNegativeSources: ['docs/faq.md'],
			id: 'synthetic-guide-doc',
			label: 'Guide',
			query: 'Guide Directory sync keeps retrieval aligned for release docs.'
		});
	});

	it('persists and loads evaluation suite snapshot history', async () => {
		const suite = createRAGEvaluationSuite({
			id: 'snapshot-history-suite',
			input: {
				cases: [
					{ expectedChunkIds: ['chunk-a'], id: 'case-a', query: 'a' },
					{ expectedChunkIds: ['chunk-b'], id: 'case-b', query: 'b' }
				]
			},
			label: 'Snapshot History Suite'
		});
		const previousSnapshot = createRAGEvaluationSuiteSnapshot({
			createdAt: 1,
			suite,
			version: 1
		});
		const currentSnapshot = createRAGEvaluationSuiteSnapshot({
			createdAt: 2,
			suite: addRAGEvaluationSuiteCase({
				caseInput: {
					expectedChunkIds: ['chunk-c'],
					id: 'case-c',
					query: 'c'
				},
				suite: updateRAGEvaluationSuiteCase({
					caseId: 'case-b',
					caseInput: {
						expectedChunkIds: ['chunk-b2'],
						id: 'case-b',
						query: 'b updated'
					},
					suite
				})
			}),
			version: 2
		});

		const path = `/tmp/absolute-rag-suite-snapshots-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileEvaluationSuiteSnapshotHistoryStore(path);
		await store.saveSnapshot(previousSnapshot);
		await store.saveSnapshot(currentSnapshot);

		const history = await loadRAGEvaluationSuiteSnapshotHistory({
			store,
			suite
		});
		expect(history.snapshots).toHaveLength(2);
		expect(history.latestSnapshot?.id).toBe(currentSnapshot.id);
		expect(history.previousSnapshot?.id).toBe(previousSnapshot.id);
		expect(history.diff).toMatchObject({
			addedCaseIds: ['case-c'],
			caseCountDelta: 1,
			changedCaseIds: ['case-b'],
			removedCaseIds: [],
			suiteId: 'snapshot-history-suite'
		});
		const snapshotRows = buildRAGEvaluationSuiteSnapshotRows(history);
		expect(snapshotRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'Snapshots recorded',
					value: '2'
				}),
				expect.objectContaining({
					label: 'Latest snapshot',
					value: 'v2 · 3 cases'
				}),
				expect.objectContaining({
					label: 'Added cases',
					value: 'case-c'
				}),
				expect.objectContaining({
					label: 'Changed cases',
					value: 'case-b'
				})
			])
		);
		const snapshotPresentations =
			buildRAGEvaluationSuiteSnapshotPresentations(history);
		expect(snapshotPresentations[0]).toMatchObject({
			id: currentSnapshot.id,
			label: 'Snapshot History Suite',
			summary: 'v2 · 3 cases',
			version: 2
		});
		expect(snapshotPresentations[0]?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Version', value: 'v2' }),
				expect.objectContaining({ label: 'Cases', value: '3' }),
				expect.objectContaining({
					label: 'Case ids',
					value: 'case-a, case-b, case-c'
				})
			])
		);
		const snapshotHistoryPresentation =
			buildRAGEvaluationSuiteSnapshotHistoryPresentation(history);
		expect(snapshotHistoryPresentation.summary).toBe('v2');
		expect(snapshotHistoryPresentation.rows).toEqual(snapshotRows);
		expect(snapshotHistoryPresentation.snapshots[0]?.id).toBe(
			currentSnapshot.id
		);
	});

	it('persists evaluation and grounding histories through SQLite stores', async () => {
		const db = new Database(':memory:');
		const suite = createRAGEvaluationSuite({
			id: 'sqlite-suite',
			input: {
				cases: [
					{
						expectedDocumentIds: ['doc-a'],
						id: 'case-a',
						query: 'alpha'
					}
				]
			},
			label: 'SQLite Suite'
		});

		const evaluationStore = createRAGSQLiteEvaluationHistoryStore({ db });
		const groundingStore =
			createRAGSQLiteAnswerGroundingEvaluationHistoryStore({ db });
		const snapshotStore =
			createRAGSQLiteEvaluationSuiteSnapshotHistoryStore({ db });

		const previousSnapshot = createRAGEvaluationSuiteSnapshot({
			createdAt: 1,
			suite,
			version: 1
		});
		const currentSnapshot = createRAGEvaluationSuiteSnapshot({
			createdAt: 2,
			suite: addRAGEvaluationSuiteCase({
				caseInput: {
					expectedDocumentIds: ['doc-b'],
					id: 'case-b',
					query: 'beta'
				},
				suite
			}),
			version: 2
		});
		await snapshotStore.saveSnapshot(previousSnapshot);
		await snapshotStore.saveSnapshot(currentSnapshot);

		const evaluationRun = {
			elapsedMs: 12,
			finishedAt: 2,
			id: 'sqlite-eval-run',
			label: 'SQLite Eval',
			response: buildRAGEvaluationResponse([
				{
					caseId: 'case-a',
					elapsedMs: 12,
					expectedCount: 1,
					expectedIds: ['doc-a'],
					f1: 1,
					matchedCount: 1,
					matchedIds: ['doc-a'],
					missingIds: [],
					mode: 'documentId',
					precision: 1,
					query: 'alpha',
					recall: 1,
					retrievedCount: 1,
					retrievedIds: ['doc-a'],
					status: 'pass',
					topK: 1
				}
			]),
			startedAt: 1,
			suiteId: suite.id
		};
		await evaluationStore.saveRun(evaluationRun);

		const groundingRun = {
			elapsedMs: 18,
			finishedAt: 4,
			id: 'sqlite-grounding-run',
			label: 'SQLite Grounding',
			response: buildRAGAnswerGroundingEvaluationResponse([
				{
					answer: 'Correct citation [1].',
					caseId: 'case-a',
					citationCount: 1,
					citationF1: 1,
					citationPrecision: 1,
					citationRecall: 1,
					citedIds: ['docs/a.md'],
					coverage: 'grounded',
					expectedCount: 1,
					expectedIds: ['docs/a.md'],
					extraIds: [],
					groundedAnswer: {
						content: 'Correct citation [1].',
						coverage: 'grounded',
						excerptModeCounts: { chunk: 0, section: 0, window: 0 },
						hasCitations: true,
						parts: [],
						references: [],
						sectionSummaries: [],
						ungroundedReferenceNumbers: []
					},
					hasCitations: true,
					matchedCount: 1,
					matchedIds: ['docs/a.md'],
					missingIds: [],
					mode: 'source',
					query: 'alpha',
					referenceCount: 1,
					resolvedCitationCount: 1,
					resolvedCitationRate: 1,
					status: 'pass',
					unresolvedCitationCount: 0
				}
			]),
			startedAt: 3,
			suiteId: suite.id
		};
		await groundingStore.saveRun(groundingRun);

		const evaluationHistory = await loadRAGEvaluationHistory({
			store: evaluationStore,
			suite
		});
		const groundingHistory = await loadRAGAnswerGroundingEvaluationHistory({
			store: groundingStore,
			suite
		});
		const snapshotHistory = await loadRAGEvaluationSuiteSnapshotHistory({
			store: snapshotStore,
			suite
		});

		expect(evaluationHistory.latestRun?.id).toBe(evaluationRun.id);
		expect(groundingHistory.latestRun?.id).toBe(groundingRun.id);
		expect(snapshotHistory.latestSnapshot?.id).toBe(currentSnapshot.id);
		expect(snapshotHistory.previousSnapshot?.id).toBe(previousSnapshot.id);
	});

	it('applies uniform retention pruning across file and SQLite evaluation stores', async () => {
		const filePath = `/tmp/absolute-rag-eval-prune-${Date.now()}.json`;
		tempPaths.add(filePath);
		const fileStore = createRAGFileEvaluationHistoryStore(filePath);
		await fileStore.saveRun({
			elapsedMs: 5,
			finishedAt: 10,
			id: 'file-old',
			label: 'old',
			response: buildRAGEvaluationResponse([]),
			startedAt: 1,
			suiteId: 'suite-a'
		});
		await fileStore.saveRun({
			elapsedMs: 5,
			finishedAt: 20,
			id: 'file-new',
			label: 'new',
			response: buildRAGEvaluationResponse([]),
			startedAt: 2,
			suiteId: 'suite-a'
		});
		const filePrune = await fileStore.pruneRuns?.({
			maxRunsPerSuite: 1
		});
		expect(filePrune).toMatchObject({ keptCount: 1, removedCount: 1 });
		expect(await fileStore.listRuns({ suiteId: 'suite-a' })).toHaveLength(
			1
		);
		expect((await fileStore.listRuns({ suiteId: 'suite-a' }))[0]?.id).toBe(
			'file-new'
		);

		const db = new Database(':memory:');
		const sqliteStore = createRAGSQLiteEvaluationHistoryStore({ db });
		await sqliteStore.saveRun({
			elapsedMs: 5,
			finishedAt: 10,
			id: 'sqlite-old',
			label: 'old',
			response: buildRAGEvaluationResponse([]),
			startedAt: 1,
			suiteId: 'suite-a'
		});
		await sqliteStore.saveRun({
			elapsedMs: 5,
			finishedAt: 20,
			id: 'sqlite-new',
			label: 'new',
			response: buildRAGEvaluationResponse([]),
			startedAt: 2,
			suiteId: 'suite-a'
		});
		const sqlitePrune = sqliteStore.pruneRuns?.({
			maxRunsPerSuite: 1
		});
		expect(sqlitePrune).toMatchObject({ keptCount: 1, removedCount: 1 });
		const sqliteRuns = await Promise.resolve(
			sqliteStore.listRuns({ suiteId: 'suite-a' })
		);
		expect(sqliteRuns).toHaveLength(1);
		expect(sqliteRuns[0]?.id).toBe('sqlite-new');
	});

	it('builds diffs and persisted history for suite runs', async () => {
		const suite = createRAGEvaluationSuite({
			id: 'history-suite',
			input: {
				cases: [
					{ expectedDocumentIds: ['a'], id: 'case-a', query: 'alpha' }
				]
			},
			label: 'History Suite'
		});
		const previousRun: RAGEvaluationSuiteRun = await runRAGEvaluationSuite({
			evaluate: async () =>
				buildRAGEvaluationResponse([
					{
						caseId: 'case-a',
						elapsedMs: 12,
						expectedCount: 1,
						expectedIds: ['a'],
						f1: 0,
						matchedCount: 0,
						matchedIds: [],
						missingIds: ['a'],
						mode: 'documentId',
						precision: 0,
						query: 'alpha',
						recall: 0,
						retrievedCount: 1,
						retrievedIds: ['b'],
						status: 'fail',
						topK: 1
					}
				]),
			suite
		});
		const currentRun: RAGEvaluationSuiteRun = await runRAGEvaluationSuite({
			evaluate: async () =>
				buildRAGEvaluationResponse([
					{
						caseId: 'case-a',
						elapsedMs: 8,
						expectedCount: 1,
						expectedIds: ['a'],
						f1: 1,
						matchedCount: 1,
						matchedIds: ['a'],
						missingIds: [],
						mode: 'documentId',
						precision: 1,
						query: 'alpha',
						recall: 1,
						retrievedCount: 1,
						retrievedIds: ['a'],
						status: 'pass',
						topK: 1
					}
				]),
			suite
		});
		previousRun.traceSummary = {
			averageCandidateTopK: 4,
			averageFinalCount: 1,
			averageLexicalCount: 0,
			averageLexicalTopK: 0,
			averageVectorCount: 1,
			balancedCases: 0,
			lexicalCases: 0,
			modes: ['vector'],
			multiVectorCases: 0,
			multiVectorCollapsedCases: 0,
			multiVectorLexicalHitCases: 0,
			multiVectorVectorHitCases: 0,
			officeEvidenceReconcileCases: 0,
			pdfEvidenceReconcileCases: 0,
			runtimeCandidateBudgetExhaustedCases: 0,
			runtimeUnderfilledTopKCases: 0,
			roundRobinCases: 0,
			sourceBalanceStrategies: ['cap'],
			stageCounts: { finalize: 1, vector_search: 1 },
			totalCases: 1,
			transformedCases: 0,
			variantCases: 0,
			vectorCases: 1
		};
		currentRun.traceSummary = {
			averageCandidateTopK: 6,
			averageFinalCount: 2,
			averageLexicalCount: 1,
			averageLexicalTopK: 4,
			averageVectorCount: 2,
			balancedCases: 1,
			lexicalCases: 1,
			modes: ['hybrid'],
			multiVectorCases: 0,
			multiVectorCollapsedCases: 0,
			multiVectorLexicalHitCases: 0,
			multiVectorVectorHitCases: 0,
			officeEvidenceReconcileCases: 0,
			pdfEvidenceReconcileCases: 0,
			runtimeCandidateBudgetExhaustedCases: 0,
			runtimeUnderfilledTopKCases: 0,
			roundRobinCases: 1,
			sourceBalanceStrategies: ['round_robin'],
			stageCounts: {
				finalize: 1,
				fusion: 1,
				lexical_search: 1,
				vector_search: 1
			},
			totalCases: 1,
			transformedCases: 1,
			variantCases: 1,
			vectorCases: 1
		};
		previousRun.caseTraceSnapshots = [
			{
				candidateTopK: 4,
				caseId: 'case-a',
				finalCount: 1,
				label: 'case-a',
				leadChannelCue: 'left',
				leadContinuityCue: 'immediate_follow_up',
				leadSpeakerCue: 'Alex',
				lexicalCount: 0,
				lexicalTopK: 0,
				previousStageCounts: {},
				previousVariantQueries: [],
				query: 'alpha',
				sourceAwareChunkReasonLabel: 'Chunk boundary section',
				sourceAwareUnitScopeLabel:
					'Source-aware section Release Ops Overview > Stable Lane',
				stageCounts: { finalize: 1, vector_search: 1 },
				status: 'fail',
				topContextLabel: 'Section Stable Lane',
				topLocatorLabel: 'docs/release.md',
				traceChange: 'new',
				traceMode: 'vector',
				transformedQuery: 'alpha',
				variantQueries: [],
				vectorCount: 1
			}
		];
		currentRun.caseTraceSnapshots = [
			{
				candidateTopK: 6,
				caseId: 'case-a',
				finalCount: 2,
				label: 'case-a',
				leadChannelAttributionCue: 'quoted_match',
				leadChannelCue: 'left',
				leadContinuityCue: 'immediate_prior',
				leadSpeakerAttributionCue: 'quoted_match',
				leadSpeakerCue: 'Alex K',
				lexicalCount: 1,
				lexicalTopK: 4,
				previousCandidateTopK: 4,
				previousFinalCount: 1,
				previousLexicalCount: 0,
				previousLexicalTopK: 0,
				previousSourceAwareChunkReasonLabel: 'Chunk boundary section',
				previousStageCounts: { finalize: 1, vector_search: 1 },
				previousTopContextLabel: 'Section Stable Lane',
				previousTopLocatorLabel: 'docs/release.md',
				previousTraceMode: 'vector',
				previousTransformedQuery: 'alpha',
				previousSourceAwareUnitScopeLabel:
					'Source-aware section Release Ops Overview > Stable Lane',
				previousVariantQueries: [],
				previousVectorCount: 1,
				query: 'alpha',
				sourceAwareChunkReasonLabel: 'Chunk boundary size limit',
				sourceAwareUnitScopeLabel:
					'Source-aware section Release Ops Overview > Stable blockers',
				stageCounts: {
					finalize: 1,
					fusion: 1,
					lexical_search: 1,
					vector_search: 1
				},
				status: 'pass',
				topContextLabel: 'Section Stable blockers',
				topLocatorLabel: 'docs/release.md#stable-blockers',
				traceChange: 'changed',
				traceMode: 'hybrid',
				transformedQuery: 'alpha rewritten',
				variantQueries: ['alpha variant'],
				vectorCount: 2
			}
		];
		const diff = buildRAGEvaluationRunDiff({
			current: currentRun,
			previous: previousRun
		});
		expect(diff.improvedCases).toHaveLength(1);
		expect(diff.regressedCases).toHaveLength(0);
		expect(diff.summaryDelta.passingRate).toBe(100);
		expect(diff.traceSummaryDelta).toMatchObject({
			averageFinalCount: 1,
			averageLexicalCount: 1,
			lexicalCases: 1,
			modesChanged: true,
			transformedCases: 1,
			variantCases: 1
		});
		expect(diff.traceLeadChanges).toEqual([
			{
				caseId: 'case-a',
				currentLead: 'docs/release.md#stable-blockers',
				label: 'case-a',
				previousLead: 'docs/release.md'
			}
		]);
		expect(diff.traceSummaryDelta?.stageCounts.lexical_search).toBe(1);

		const path = `/tmp/absolute-rag-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileEvaluationHistoryStore(path);
		await persistRAGEvaluationSuiteRun({ run: previousRun, store });
		await persistRAGEvaluationSuiteRun({ run: currentRun, store });
		const history = await loadRAGEvaluationHistory({ store, suite });
		expect(history.runs).toHaveLength(2);
		expect(history.latestRun?.id).toBe(currentRun.id);
		expect(history.previousRun?.id).toBe(previousRun.id);
		expect(history.diff?.improvedCases).toHaveLength(1);
		expect(history.latestRun?.traceSummary?.modes).toEqual(['hybrid']);
		expect(history.diff?.traceSummaryDelta?.modesChanged).toBe(true);
		expect(history.caseTraceSnapshots).toHaveLength(1);
		expect(history.caseTraceSnapshots[0]).toMatchObject({
			caseId: 'case-a',
			leadChannelAttributionCue: 'quoted_match',
			leadChannelCue: 'left',
			leadContinuityCue: 'immediate_prior',
			leadSpeakerAttributionCue: 'quoted_match',
			leadSpeakerCue: 'Alex K',
			sourceAwareChunkReasonLabel: 'Chunk boundary size limit',
			sourceAwareUnitScopeLabel:
				'Source-aware section Release Ops Overview > Stable blockers',
			traceChange: 'changed',
			traceMode: 'hybrid',
			previousTopLocatorLabel: 'docs/release.md',
			previousTraceMode: 'vector',
			topLocatorLabel: 'docs/release.md#stable-blockers'
		});
		expect(history.leaderboard[0]?.runId).toBe(currentRun.id);

		const singleRunPath = `/tmp/absolute-rag-history-single-${Date.now()}.json`;
		tempPaths.add(singleRunPath);
		const singleRunStore =
			createRAGFileEvaluationHistoryStore(singleRunPath);
		await persistRAGEvaluationSuiteRun({
			run: currentRun,
			store: singleRunStore
		});
		const singleRunHistory = await loadRAGEvaluationHistory({
			store: singleRunStore,
			suite
		});
		expect(singleRunHistory.latestRun?.id).toBe(currentRun.id);
		expect(singleRunHistory.previousRun).toBeUndefined();
		expect(singleRunHistory.diff).toBeUndefined();
	});

	it('builds leaderboards and persisted history for grounding runs', async () => {
		const previousRun = {
			elapsedMs: 120,
			finishedAt: 2,
			id: 'grounding-run-1',
			label: 'Provider A',
			response: buildRAGAnswerGroundingEvaluationResponse([
				{
					answer: 'Missing citations.',
					caseId: 'case-a',
					citationCount: 0,
					citationF1: 0,
					citationPrecision: 0,
					citationRecall: 0,
					citedIds: [],
					coverage: 'ungrounded',
					expectedCount: 1,
					expectedIds: ['a'],
					extraIds: [],
					groundedAnswer: {
						coverage: 'ungrounded',
						content: '',
						hasCitations: false,
						parts: [],
						references: [],
						sectionSummaries: [],
						excerptModeCounts: { chunk: 0, window: 0, section: 0 },
						ungroundedReferenceNumbers: []
					},
					hasCitations: false,
					label: 'Case A',
					matchedCount: 0,
					matchedIds: [],
					missingIds: ['a'],
					mode: 'source',
					query: 'alpha',
					referenceCount: 0,
					resolvedCitationCount: 0,
					resolvedCitationRate: 0,
					status: 'fail',
					unresolvedCitationCount: 0
				}
			]),
			startedAt: 1,
			suiteId: 'provider-suite'
		};
		const currentRun = {
			elapsedMs: 80,
			finishedAt: 4,
			id: 'grounding-run-2',
			label: 'Provider A',
			response: buildRAGAnswerGroundingEvaluationResponse([
				{
					answer: 'Correct citation [1].',
					caseId: 'case-a',
					citationCount: 1,
					citationF1: 1,
					citationPrecision: 1,
					citationRecall: 1,
					citedIds: ['a'],
					coverage: 'grounded',
					expectedCount: 1,
					expectedIds: ['a'],
					extraIds: [],
					groundedAnswer: {
						coverage: 'grounded',
						content: 'Correct citation [1].',
						hasCitations: true,
						parts: [],
						references: [],
						sectionSummaries: [],
						excerptModeCounts: { chunk: 0, window: 0, section: 0 },
						ungroundedReferenceNumbers: []
					},
					hasCitations: true,
					label: 'Case A',
					matchedCount: 1,
					matchedIds: ['a'],
					missingIds: [],
					mode: 'source',
					query: 'alpha',
					referenceCount: 1,
					resolvedCitationCount: 1,
					resolvedCitationRate: 1,
					status: 'pass',
					unresolvedCitationCount: 0
				}
			]),
			startedAt: 3,
			suiteId: 'provider-suite'
		};

		const diff = buildRAGAnswerGroundingEvaluationRunDiff({
			current: currentRun,
			previous: previousRun
		});
		expect(diff.improvedCases).toHaveLength(1);
		expect(diff.summaryDelta.averageCitationF1).toBe(1);
		expect(diff.improvedCases[0]).toMatchObject({
			answerChanged: true,
			currentAnswer: 'Correct citation [1].',
			currentCoverage: 'grounded',
			previousAnswer: 'Missing citations.',
			previousCoverage: 'ungrounded'
		});

		const leaderboard = buildRAGAnswerGroundingEvaluationLeaderboard([
			previousRun,
			currentRun
		]);
		expect(leaderboard[0]).toMatchObject({
			label: 'Provider A',
			passingRate: 100,
			rank: 1,
			runId: currentRun.id
		});

		const path = `/tmp/absolute-rag-grounding-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileAnswerGroundingEvaluationHistoryStore(path);
		await persistRAGAnswerGroundingEvaluationRun({
			run: previousRun,
			store
		});
		await persistRAGAnswerGroundingEvaluationRun({
			run: currentRun,
			store
		});
		const history = await loadRAGAnswerGroundingEvaluationHistory({
			store,
			suite: {
				id: 'provider-suite',
				label: 'Provider grounding suite'
			}
		});
		expect(history.runs).toHaveLength(2);
		expect(history.latestRun?.id).toBe(currentRun.id);
		expect(history.previousRun?.id).toBe(previousRun.id);
		expect(history.diff?.improvedCases).toHaveLength(1);
		expect(history.leaderboard[0]?.runId).toBe(currentRun.id);
		expect(history.caseSnapshots).toHaveLength(1);
		expect(history.caseSnapshots[0]).toMatchObject({
			answer: 'Correct citation [1].',
			answerChange: 'changed',
			caseId: 'case-a',
			citationCount: 1,
			citedIds: ['a'],
			previousAnswer: 'Missing citations.',
			referenceCount: 1,
			resolvedCitationCount: 1,
			ungroundedReferenceNumbers: [],
			unresolvedCitationCount: 0
		});
		expect(history.diff?.improvedCases[0]).toMatchObject({
			caseId: 'case-a',
			currentCitedIds: ['a'],
			currentExtraIds: [],
			currentReferenceCount: 1,
			currentResolvedCitationCount: 1,
			currentUngroundedReferenceNumbers: [],
			currentUnresolvedCitationCount: 0,
			previousCitedIds: [],
			previousExtraIds: [],
			previousMatchedIds: [],
			previousMissingIds: ['a'],
			previousUngroundedReferenceNumbers: []
		});
		const groundingSnapshotPresentations =
			buildRAGAnswerGroundingCaseSnapshotPresentations(history);
		expect(groundingSnapshotPresentations[0]).toMatchObject({
			answerChange: 'changed',
			caseId: 'case-a',
			label: 'Case A'
		});
		expect(groundingSnapshotPresentations[0]?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Coverage' }),
				expect.objectContaining({ label: 'Resolved citations' }),
				expect.objectContaining({ label: 'Answer' })
			])
		);
		const groundingHistoryRows =
			buildRAGAnswerGroundingHistoryRows(history);
		expect(groundingHistoryRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Latest' }),
				expect.objectContaining({ label: 'Answer drift' }),
				expect.objectContaining({ label: 'Citation F1 delta' }),
				expect.objectContaining({
					label: 'Source regression hotspots'
				}),
				expect.objectContaining({
					label: 'Document regression hotspots'
				})
			])
		);
		const groundingHistoryPresentation =
			buildRAGAnswerGroundingHistoryPresentation(history);
		expect(groundingHistoryPresentation.summary).toBe('Provider A');
		expect(groundingHistoryPresentation.rows).toEqual(groundingHistoryRows);
		expect(groundingHistoryPresentation.caseSnapshots[0]?.caseId).toBe(
			'case-a'
		);
		const providerCards = buildRAGGroundingProviderPresentations([
			{
				providerKey: 'provider-a',
				label: 'Provider A',
				elapsedMs: 42,
				response: history.latestRun!.response
			}
		]);
		expect(providerCards[0]).toMatchObject({
			id: 'provider-a',
			label: 'Provider A'
		});
		expect(providerCards[0]?.summary).toContain('citation f1');
		const providerOverview = buildRAGGroundingProviderOverviewPresentation({
			entries: [
				{
					providerKey: 'provider-a',
					label: 'Provider A',
					elapsedMs: 42,
					response: history.latestRun!.response
				}
			],
			summary: {
				bestByPassingRate: 'provider-a',
				bestByAverageCitationF1: 'provider-a',
				bestByResolvedCitationRate: 'provider-a',
				fastest: 'provider-a'
			}
		});
		expect(providerOverview).toMatchObject({
			winnerLabel: 'Provider A'
		});
		expect(providerOverview.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Best passing rate' }),
				expect.objectContaining({ label: 'Fastest' })
			])
		);
		const groundingOverview = buildRAGGroundingOverviewPresentation({
			groundingEvaluation: history.latestRun!.response,
			groundingProviderOverview: providerOverview
		});
		expect(groundingOverview.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Grounding' }),
				expect.objectContaining({ label: 'Best passing rate' })
			])
		);
		const qualityOverview = buildRAGQualityOverviewPresentation({
			retrievalComparison: {
				entries: [],
				leaderboard: [],
				summary: {},
				suiteId: 'suite-a',
				suiteLabel: 'Suite A'
			},
			rerankerComparison: {
				entries: [],
				leaderboard: [],
				summary: {},
				suiteId: 'suite-a',
				suiteLabel: 'Suite A'
			},
			groundingEvaluation: history.latestRun!.response,
			groundingProviderOverview: providerOverview
		});
		expect(qualityOverview.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Grounding' }),
				expect.objectContaining({ label: 'Best passing rate' })
			])
		);
		expect(qualityOverview.rows.length).toBeGreaterThan(0);
		const caseCards = buildRAGGroundingProviderCaseComparisonPresentations([
			{
				caseId: 'case-a',
				label: 'Case A',
				entries: [
					{
						providerKey: 'provider-a',
						label: 'Provider A',
						status: 'pass',
						coverage: 'grounded',
						citationF1: 1,
						resolvedCitationRate: 1,
						matchedIds: ['a'],
						missingIds: [],
						extraIds: [],
						answerExcerpt: 'Correct citation [1].'
					}
				],
				summary: {
					bestByStatus: 'provider-a',
					bestByCitationF1: 'provider-a',
					bestByResolvedCitationRate: 'provider-a'
				}
			}
		]);
		expect(caseCards[0]).toMatchObject({
			caseId: 'case-a',
			label: 'Case A'
		});
		expect(caseCards[0]?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Best grounded' }),
				expect.objectContaining({ label: 'Provider A' })
			])
		);
	});

	it('builds a reusable adaptive native planner benchmark suite artifact', async () => {
		const suite = createRAGAdaptiveNativePlannerBenchmarkSuite();
		const snapshot = createRAGAdaptiveNativePlannerBenchmarkSnapshot({
			suite,
			version: 3
		});
		const path = `/tmp/rag-native-planner-snapshot-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileEvaluationSuiteSnapshotHistoryStore(path);

		await store.saveSnapshot(snapshot);

		const history = await loadRAGEvaluationSuiteSnapshotHistory({
			store,
			suite
		});

		expect(suite).toMatchObject({
			id: 'rag-native-planner-larger-corpus',
			input: expect.objectContaining({
				cases: [
					expect.objectContaining({
						expectedDocumentIds: ['focus-target'],
						filter: { lane: 'focus' },
						hardNegativeDocumentIds: [
							'focus-distractor-0',
							'focus-distractor-1',
							'focus-distractor-2'
						],
						id: 'planner-pressure-exact-phrase'
					})
				],
				filter: { lane: 'focus' },
				retrieval: 'vector',
				topK: 1
			}),
			label: 'Adaptive Native Planner Benchmark',
			metadata: expect.objectContaining({
				benchmarkKind: 'adaptive_native_planner',
				benchmarkScope: 'larger_corpus',
				recommendedGroupKey: 'runtime-native-planner'
			})
		});
		expect(snapshot).toMatchObject({
			caseCount: 1,
			metadata: expect.objectContaining({
				artifactKind: 'adaptive_native_planner_benchmark',
				persistForReleaseHistory: true
			}),
			suiteId: suite.id,
			version: 3
		});
		expect(history.snapshots[0]).toMatchObject({
			id: snapshot.id,
			suiteId: suite.id,
			version: 3
		});
	});

	it('builds backend-specific larger-corpus benchmark fixtures', async () => {
		const generic = createRAGNativeBackendBenchmarkCorpus({
			backend: 'generic',
			noiseCount: 2
		});
		const sqliteNative = createRAGNativeBackendBenchmarkCorpus({
			backend: 'sqlite-native',
			noiseCount: 2
		});
		const postgres = createRAGNativeBackendBenchmarkCorpus({
			backend: 'postgres',
			noiseCount: 2
		});

		expect(generic.map((entry) => entry.chunkId)).toEqual(
			expect.arrayContaining(['focus:target', 'focus:distractor:0'])
		);
		expect(sqliteNative.map((entry) => entry.chunkId)).toEqual(
			expect.arrayContaining([
				'focus:sqlite:phrase-matrix',
				'focus:sqlite:guide-table'
			])
		);
		expect(postgres.map((entry) => entry.chunkId)).toEqual(
			expect.arrayContaining([
				'focus:postgres:appendix',
				'focus:postgres:alternatives'
			])
		);
		expect(
			sqliteNative.find(
				(entry) => entry.chunkId === 'focus:sqlite:phrase-matrix'
			)?.metadata
		).toMatchObject({
			backendFixture: 'sqlite-native',
			documentId: 'focus-sqlite-phrase-matrix'
		});
		expect(
			postgres.find(
				(entry) => entry.chunkId === 'focus:postgres:appendix'
			)?.metadata
		).toMatchObject({
			backendFixture: 'postgres',
			documentId: 'focus-postgres-appendix'
		});
		await expect(
			createRAGNativeBackendBenchmarkMockEmbedding(
				'launch checklist exact wording for aurora promotion'
			)
		).resolves.toEqual([0.995, 0.005]);
		await expect(
			createRAGNativeBackendBenchmarkMockEmbedding(
				'aurora focus lane guide wording draft'
			)
		).resolves.toEqual([1, 0]);
	});

	it('builds a reusable native backend comparison benchmark suite artifact', async () => {
		const suite = createRAGNativeBackendComparisonBenchmarkSuite();
		const snapshot = createRAGNativeBackendComparisonBenchmarkSnapshot({
			suite,
			version: 2
		});
		const path = `/tmp/rag-native-backend-snapshot-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileEvaluationSuiteSnapshotHistoryStore(path);

		await store.saveSnapshot(snapshot);

		const history = await loadRAGEvaluationSuiteSnapshotHistory({
			store,
			suite
		});

		expect(suite).toMatchObject({
			id: 'rag-native-backend-larger-corpus',
			input: expect.objectContaining({
				cases: expect.arrayContaining([
					expect.objectContaining({
						id: 'planner-pressure-exact-phrase',
						query: 'Which launch checklist phrase is exact wording?'
					}),
					expect.objectContaining({
						id: 'planner-pressure-hybrid-phrase',
						query: 'aurora promotion checklist wording'
					}),
					expect.objectContaining({
						id: 'planner-pressure-filtered-lane-query',
						query: 'focus lane launch checklist wording'
					}),
					expect.objectContaining({
						id: 'planner-pressure-reordered-phrase',
						query: 'exact aurora focus lane checklist wording'
					}),
					expect.objectContaining({
						id: 'planner-pressure-guide-query',
						query: 'which focus lane guide contains exact aurora promotion wording'
					})
				])
			}),
			label: 'Native Backend Comparison Benchmark',
			metadata: expect.objectContaining({
				benchmarkKind: 'native_backend_comparison',
				expectedSignals: expect.arrayContaining([
					'hybrid filtered retrieval',
					'query transform pressure'
				]),
				recommendedGroupKey: 'runtime-native-backend-parity'
			})
		});
		expect(snapshot).toMatchObject({
			caseCount: 5,
			metadata: expect.objectContaining({
				artifactKind: 'native_backend_comparison_benchmark',
				persistForReleaseHistory: true
			}),
			suiteId: suite.id,
			version: 2
		});
		expect(history.snapshots[0]).toMatchObject({
			id: snapshot.id,
			suiteId: suite.id,
			version: 2
		});
	});

	it('builds a reusable presentation cue benchmark suite artifact', async () => {
		const suite = createRAGPresentationCueBenchmarkSuite();
		const snapshot = createRAGPresentationCueBenchmarkSnapshot({
			suite,
			version: 4
		});
		const path = `/tmp/rag-presentation-cue-snapshot-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileEvaluationSuiteSnapshotHistoryStore(path);

		await store.saveSnapshot(snapshot);

		const history = await loadRAGEvaluationSuiteSnapshotHistory({
			store,
			suite
		});

		expect(suite).toMatchObject({
			id: 'rag-presentation-cue-parity',
			input: expect.objectContaining({
				cases: expect.arrayContaining([
					expect.objectContaining({
						expectedDocumentIds: ['slide-title-doc'],
						id: 'presentation-title-led',
						query: 'Which presentation title covers the release handoff summary?'
					}),
					expect.objectContaining({
						expectedDocumentIds: ['slide-body-doc'],
						id: 'presentation-body-led',
						query: 'Which slide mentions escalation review in the body?'
					}),
					expect.objectContaining({
						expectedDocumentIds: ['slide-notes-doc'],
						id: 'presentation-notes-led',
						query: 'Which slide notes are the primary handoff evidence?'
					})
				]),
				retrieval: 'hybrid',
				topK: 1
			}),
			label: 'Presentation Cue Benchmark',
			metadata: expect.objectContaining({
				benchmarkKind: 'presentation_cue',
				benchmarkScope: 'repeated_title_slides',
				recommendedGroupKey: 'presentation-cue-parity'
			})
		});
		expect(snapshot).toMatchObject({
			caseCount: 3,
			metadata: expect.objectContaining({
				artifactKind: 'presentation_cue_benchmark',
				persistForReleaseHistory: true
			}),
			suiteId: suite.id,
			version: 4
		});
		expect(history.snapshots[0]).toMatchObject({
			id: snapshot.id,
			suiteId: suite.id,
			version: 4
		});
	});

	it('builds a reusable spreadsheet cue benchmark suite artifact', async () => {
		const suite = createRAGSpreadsheetCueBenchmarkSuite();
		const snapshot = createRAGSpreadsheetCueBenchmarkSnapshot({
			suite,
			version: 5
		});
		const path = `/tmp/rag-spreadsheet-cue-snapshot-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store = createRAGFileEvaluationSuiteSnapshotHistoryStore(path);

		await store.saveSnapshot(snapshot);

		const history = await loadRAGEvaluationSuiteSnapshotHistory({
			store,
			suite
		});

		expect(suite).toMatchObject({
			id: 'rag-spreadsheet-cue-parity',
			input: expect.objectContaining({
				cases: expect.arrayContaining([
					expect.objectContaining({
						expectedDocumentIds: ['sheet-led-doc'],
						id: 'spreadsheet-sheet-led',
						query: 'Which spreadsheet sheet lists owner status and due date?'
					}),
					expect.objectContaining({
						expectedDocumentIds: ['table-led-doc'],
						id: 'spreadsheet-table-led',
						query: 'Which spreadsheet table lists the escalation status rows?'
					}),
					expect.objectContaining({
						expectedDocumentIds: ['column-led-doc'],
						id: 'spreadsheet-column-led',
						query: 'Which spreadsheet columns cover owner due date?'
					})
				]),
				retrieval: 'hybrid',
				topK: 1
			}),
			label: 'Spreadsheet Cue Benchmark',
			metadata: expect.objectContaining({
				benchmarkKind: 'spreadsheet_cue',
				benchmarkScope: 'repeated_sheet_tables',
				recommendedGroupKey: 'spreadsheet-cue-parity'
			})
		});
		expect(snapshot).toMatchObject({
			caseCount: 3,
			metadata: expect.objectContaining({
				artifactKind: 'spreadsheet_cue_benchmark',
				persistForReleaseHistory: true
			}),
			suiteId: suite.id,
			version: 5
		});
		expect(history.snapshots[0]).toMatchObject({
			id: snapshot.id,
			suiteId: suite.id,
			version: 5
		});
	});

	it('ranks grounding cases by difficulty across provider responses', () => {
		const leaderboard = buildRAGAnswerGroundingCaseDifficultyLeaderboard([
			{
				label: 'Provider A',
				response: buildRAGAnswerGroundingEvaluationResponse([
					{
						answer: 'Correct [1].',
						caseId: 'easy',
						citationCount: 1,
						citationF1: 1,
						citationPrecision: 1,
						citationRecall: 1,
						citedIds: ['a'],
						coverage: 'grounded',
						expectedCount: 1,
						expectedIds: ['a'],
						extraIds: [],
						groundedAnswer: {
							coverage: 'grounded',
							content: 'Correct [1].',
							hasCitations: true,
							parts: [],
							references: [],
							sectionSummaries: [],
							excerptModeCounts: {
								chunk: 0,
								window: 0,
								section: 0
							},
							ungroundedReferenceNumbers: []
						},
						hasCitations: true,
						label: 'Easy case',
						matchedCount: 1,
						matchedIds: ['a'],
						missingIds: [],
						mode: 'source',
						query: 'easy',
						referenceCount: 1,
						resolvedCitationCount: 1,
						resolvedCitationRate: 1,
						status: 'pass',
						unresolvedCitationCount: 0
					},
					{
						answer: 'Missing.',
						caseId: 'hard',
						citationCount: 0,
						citationF1: 0,
						citationPrecision: 0,
						citationRecall: 0,
						citedIds: [],
						coverage: 'ungrounded',
						expectedCount: 1,
						expectedIds: ['b'],
						extraIds: [],
						groundedAnswer: {
							coverage: 'ungrounded',
							content: 'Missing.',
							hasCitations: false,
							parts: [],
							references: [],
							sectionSummaries: [],
							excerptModeCounts: {
								chunk: 0,
								window: 0,
								section: 0
							},
							ungroundedReferenceNumbers: []
						},
						hasCitations: false,
						label: 'Hard case',
						matchedCount: 0,
						matchedIds: [],
						missingIds: ['b'],
						mode: 'source',
						query: 'hard',
						referenceCount: 0,
						resolvedCitationCount: 0,
						resolvedCitationRate: 0,
						status: 'fail',
						unresolvedCitationCount: 0
					}
				])
			},
			{
				label: 'Provider B',
				response: buildRAGAnswerGroundingEvaluationResponse([
					{
						answer: 'Correct [1].',
						caseId: 'easy',
						citationCount: 1,
						citationF1: 1,
						citationPrecision: 1,
						citationRecall: 1,
						citedIds: ['a'],
						coverage: 'grounded',
						expectedCount: 1,
						expectedIds: ['a'],
						extraIds: [],
						groundedAnswer: {
							coverage: 'grounded',
							content: 'Correct [1].',
							hasCitations: true,
							parts: [],
							references: [],
							sectionSummaries: [],
							excerptModeCounts: {
								chunk: 0,
								window: 0,
								section: 0
							},
							ungroundedReferenceNumbers: []
						},
						hasCitations: true,
						label: 'Easy case',
						matchedCount: 1,
						matchedIds: ['a'],
						missingIds: [],
						mode: 'source',
						query: 'easy',
						referenceCount: 1,
						resolvedCitationCount: 1,
						resolvedCitationRate: 1,
						status: 'pass',
						unresolvedCitationCount: 0
					},
					{
						answer: 'Partial [1].',
						caseId: 'hard',
						citationCount: 1,
						citationF1: 0.5,
						citationPrecision: 0.5,
						citationRecall: 0.5,
						citedIds: ['b'],
						coverage: 'partial',
						expectedCount: 1,
						expectedIds: ['b'],
						extraIds: ['x'],
						groundedAnswer: {
							coverage: 'partial',
							content: 'Partial [1].',
							hasCitations: true,
							parts: [],
							references: [],
							sectionSummaries: [],
							excerptModeCounts: {
								chunk: 0,
								window: 0,
								section: 0
							},
							ungroundedReferenceNumbers: []
						},
						hasCitations: true,
						label: 'Hard case',
						matchedCount: 1,
						matchedIds: ['b'],
						missingIds: [],
						mode: 'source',
						query: 'hard',
						referenceCount: 1,
						resolvedCitationCount: 1,
						resolvedCitationRate: 1,
						status: 'partial',
						unresolvedCitationCount: 0
					}
				])
			}
		]);

		expect(leaderboard).toHaveLength(2);
		expect(leaderboard[0]).toMatchObject({
			caseId: 'hard',
			failRate: 50,
			passRate: 0,
			partialRate: 50,
			rank: 1,
			totalEvaluations: 2
		});
		expect(leaderboard[1]).toMatchObject({
			caseId: 'easy',
			passRate: 100,
			rank: 2
		});
	});

	it('builds diffs and persisted history for grounding difficulty runs', async () => {
		const previousRun = {
			entries: [
				{
					averageCitationF1: 0.3,
					averageResolvedCitationRate: 0.5,
					caseId: 'hard',
					failRate: 50,
					groundedRate: 50,
					label: 'Hard case',
					passRate: 0,
					partialRate: 50,
					query: 'hard',
					rank: 1,
					totalEvaluations: 2
				},
				{
					averageCitationF1: 1,
					averageResolvedCitationRate: 1,
					caseId: 'easy',
					failRate: 0,
					groundedRate: 100,
					label: 'Easy case',
					passRate: 100,
					partialRate: 0,
					query: 'easy',
					rank: 2,
					totalEvaluations: 2
				}
			],
			finishedAt: 2,
			id: 'difficulty-run-1',
			label: 'Provider difficulty',
			startedAt: 1,
			suiteId: 'provider-difficulty-suite'
		};
		const currentRun = {
			entries: [
				{
					averageCitationF1: 1,
					averageResolvedCitationRate: 1,
					caseId: 'easy',
					failRate: 0,
					groundedRate: 100,
					label: 'Easy case',
					passRate: 100,
					partialRate: 0,
					query: 'easy',
					rank: 1,
					totalEvaluations: 2
				},
				{
					averageCitationF1: 0.3,
					averageResolvedCitationRate: 0.5,
					caseId: 'hard',
					failRate: 50,
					groundedRate: 50,
					label: 'Hard case',
					passRate: 0,
					partialRate: 50,
					query: 'hard',
					rank: 2,
					totalEvaluations: 2
				}
			],
			finishedAt: 4,
			id: 'difficulty-run-2',
			label: 'Provider difficulty',
			startedAt: 3,
			suiteId: 'provider-difficulty-suite'
		};

		const diff = buildRAGAnswerGroundingCaseDifficultyRunDiff({
			current: currentRun,
			previous: previousRun
		});
		expect(diff.harderCases[0]).toMatchObject({
			caseId: 'easy',
			currentRank: 1,
			previousRank: 2
		});
		expect(diff.easierCases[0]).toMatchObject({
			caseId: 'hard',
			currentRank: 2,
			previousRank: 1
		});

		const path = `/tmp/absolute-rag-grounding-difficulty-history-${Date.now()}.json`;
		tempPaths.add(path);
		const store =
			createRAGFileAnswerGroundingCaseDifficultyHistoryStore(path);
		await persistRAGAnswerGroundingCaseDifficultyRun({
			run: previousRun,
			store
		});
		await persistRAGAnswerGroundingCaseDifficultyRun({
			run: currentRun,
			store
		});
		const history = await loadRAGAnswerGroundingCaseDifficultyHistory({
			store,
			suite: {
				id: 'provider-difficulty-suite',
				label: 'Provider difficulty suite'
			}
		});
		expect(history.runs).toHaveLength(2);
		expect(history.latestRun?.id).toBe(currentRun.id);
		expect(history.previousRun?.id).toBe(previousRun.id);
		expect(history.diff?.harderCases[0]?.caseId).toBe('easy');
		expect(history.diff?.easierCases[0]?.caseId).toBe('hard');
		expect(history.trends.hardestCaseIds).toEqual(['easy', 'hard']);
		expect(history.trends.easiestCaseIds).toEqual(['easy', 'hard']);
		expect(history.trends.mostOftenHarderCaseIds).toEqual(['easy']);
		expect(history.trends.mostOftenEasierCaseIds).toEqual(['hard']);
		expect(history.trends.movementCounts.easy).toEqual({
			easier: 0,
			harder: 1,
			unchanged: 0
		});
	});

	it('evaluates a collection and compares rerankers on the same suite', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'A generic retrieval note without the exact phrase.'
				},
				{
					chunkId: 'target:001',
					embedding: [1, 0],
					metadata: { documentId: 'target' },
					source: 'target',
					text: 'Metadata filters improve retrieval quality and metadata discipline.'
				}
			]
		});

		const suite = createRAGEvaluationSuite({
			id: 'reranker-suite',
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'target-case',
						query: 'metadata filters'
					}
				]
			},
			label: 'Reranker Suite'
		});

		const baseline = await evaluateRAGCollection({
			collection,
			input: suite.input
		});
		expect(baseline.totalCases).toBe(1);

		const comparison = await compareRAGRerankers({
			collection,
			rerankers: [
				{ id: 'baseline' },
				{
					id: 'reversed',
					label: 'Reverse order',
					rerank: ({ results }) => [...results].reverse()
				}
			],
			suite
		});

		expect(comparison.entries).toHaveLength(2);
		expect(comparison.summary.bestByPassingRate).toBe(
			comparison.leaderboard[0]?.runId
		);
		expect(comparison.leaderboard[0]?.rank).toBe(1);
		expect(comparison.entries[0]?.traceSummary?.totalCases).toBe(1);
		expect(
			comparison.entries[0]?.traceSummary?.averageFinalCount
		).toBeGreaterThanOrEqual(1);
		expect(
			comparison.entries[1]?.traceSummary?.stageCounts.finalize
		).toBeGreaterThanOrEqual(1);
		expect(comparison.entries[0]?.caseTraceSnapshots).toHaveLength(1);
		expect(
			comparison.entries.find(
				(entry) =>
					entry.rerankerId === comparison.summary.bestByPassingRate
			)?.response.summary.passedCases
		).toBeGreaterThanOrEqual(1);
	});

	it('lets reranking recover relevant results from a larger candidate pool', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'a:001',
					embedding: [1, 0],
					metadata: { documentId: 'a' },
					source: 'generic-a',
					text: 'Generic note A.'
				},
				{
					chunkId: 'b:001',
					embedding: [1, 0],
					metadata: { documentId: 'b' },
					source: 'generic-b',
					text: 'Generic note B.'
				},
				{
					chunkId: 'target:001',
					embedding: [1, 0],
					metadata: {
						documentId: 'target',
						sheetName: 'Regional Growth'
					},
					source: 'files/revenue-forecast.xlsx',
					text: 'Spreadsheet workbook.'
				}
			]
		});

		const response = await evaluateRAGCollection({
			collection,
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'sheet-target',
						query: 'regional growth sheet',
						topK: 1
					}
				]
			}
		});

		expect(response.summary.passedCases).toBe(1);
	});

	it('improves lexical-heavy benchmark cases with hybrid retrieval', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'regional growth sheet') return [1, 0];
				if (text.includes('Generic')) return [1, 0];
				if (text.includes('Workbook')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: {
						documentId: 'target',
						sheetName: 'Regional Growth'
					},
					source: 'files/revenue-forecast.xlsx',
					text: 'Workbook.'
				}
			]
		});

		const vectorResponse = await evaluateRAGCollection({
			collection: {
				...collection,
				search: (input) =>
					collection.search({ ...input, retrieval: 'vector' })
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'sheet-target',
						query: 'regional growth sheet',
						topK: 1
					}
				]
			}
		});
		const hybridResponse = await evaluateRAGCollection({
			collection: {
				...collection,
				search: (input) =>
					collection.search({ ...input, retrieval: 'hybrid' })
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'sheet-target',
						query: 'regional growth sheet',
						topK: 1
					}
				]
			}
		});

		expect(vectorResponse.summary.passedCases).toBe(0);
		expect(hybridResponse.summary.passedCases).toBe(1);
	});

	it('improves multivector exact-phrase benchmark cases with heuristic retrieval routing', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('Generic')) return [1, 0];
				if (text.includes('release-readiness')) return [0, 1];
				if (text.includes('aurora launch packet')) return [1, 0];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		const heuristicCollection = createRAGCollection({
			retrievalStrategy: createHeuristicRAGRetrievalStrategy(),
			store
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: { documentId: 'target' },
					source: 'guide/multivector-release-guide.md',
					text: 'release-readiness callouts and operator recovery drills',
					embeddingVariants: [
						{
							embedding: [0, 1],
							id: 'launch-checklist',
							label: 'Launch checklist',
							text: 'aurora launch packet sign-off checklist'
						}
					]
				}
			]
		});

		const vectorResponse = await evaluateRAGCollection({
			collection: {
				...collection,
				search: (input) =>
					collection.search({ ...input, retrieval: 'vector' })
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'multivector-exact-phrase',
						query: 'Which aurora launch packet phrase shows exact wording?',
						topK: 1
					}
				]
			}
		});
		const heuristicResponse = await evaluateRAGCollection({
			collection: heuristicCollection,
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'multivector-exact-phrase',
						query: 'Which aurora launch packet phrase shows exact wording?',
						topK: 1
					}
				]
			}
		});
		const heuristicTrace = await heuristicCollection.searchWithTrace({
			query: 'Which aurora launch packet phrase shows exact wording?',
			retrieval: 'vector',
			topK: 1
		});

		expect(vectorResponse.summary.passedCases).toBe(0);
		expect(heuristicResponse.summary.passedCases).toBe(1);
		expect(heuristicTrace.trace.routingLabel).toBe(
			'Exact phrase hybrid route'
		);
		expect(heuristicTrace.trace.multiVector).toEqual(
			expect.objectContaining({
				configured: true
			})
		);
	});

	it('improves larger-corpus native benchmark cases with adaptive planner selection', async () => {
		const seen: RAGQueryInput[] = [];
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			getCapabilities: () => ({
				backend: 'custom',
				nativeVectorSearch: true,
				persistence: 'external',
				serverSideFiltering: true,
				streamingIngestStatus: false
			}),
			getStatus: () => ({
				backend: 'postgres',
				dimensions: 2,
				native: {
					active: true,
					available: true,
					estimatedRowCount: 40000,
					mode: 'pgvector',
					requested: true
				},
				vectorMode: 'native_pgvector'
			}),
			query: async (input) => {
				seen.push(input);
				if (input.plannerProfile === 'recall') {
					return [
						{
							chunkId: 'target:001',
							chunkText:
								'Aurora launch checklist exact wording and operator recovery drills.',
							metadata: { documentId: 'target' },
							score: 0.98,
							source: 'guide/multivector-release-guide.md',
							title: 'Target'
						}
					];
				}

				return [
					{
						chunkId: 'generic:001',
						chunkText: 'Generic operational summary.',
						metadata: { documentId: 'generic' },
						score: 0.99,
						source: 'generic',
						title: 'Generic'
					}
				];
			},
			upsert: async () => {}
		};
		const collection = createRAGCollection({
			queryTransform: async (input) => ({
				query: input.query,
				variants: ['launch checklist exact wording']
			}),
			store
		});

		const latencyResponse = await evaluateRAGCollection({
			collection: {
				...collection,
				search: (input) =>
					collection.search({
						...input,
						nativeQueryProfile: 'latency',
						retrieval: 'vector'
					})
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'adaptive-native-budget',
						query: 'Which launch checklist phrase is exact wording?',
						topK: 1
					}
				]
			}
		});
		const adaptiveResponse = await evaluateRAGCollection({
			collection: {
				...collection,
				search: (input) =>
					collection.search({ ...input, retrieval: 'vector' })
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'adaptive-native-budget',
						query: 'Which launch checklist phrase is exact wording?',
						topK: 1
					}
				]
			}
		});
		const adaptiveTrace = await collection.searchWithTrace({
			query: 'Which launch checklist phrase is exact wording?',
			retrieval: 'vector',
			topK: 1
		});

		expect(latencyResponse.summary.passedCases).toBe(0);
		expect(adaptiveResponse.summary.passedCases).toBe(1);
		expect(seen.some((input) => input.plannerProfile === 'latency')).toBe(
			true
		);
		expect(seen.some((input) => input.plannerProfile === 'recall')).toBe(
			true
		);
		expect(adaptiveTrace.trace.steps).toContainEqual(
			expect.objectContaining({
				label: 'Selected native planner profile',
				metadata: expect.objectContaining({
					autoSelected: true,
					selectedProfile: 'recall'
				}),
				stage: 'routing'
			})
		);
	});

	it('lets heuristic reranking recover multivector exact-phrase vector cases', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (
					text ===
					'Which aurora launch packet phrase shows exact wording?'
				) {
					return [1, 0];
				}
				if (text === 'Generic operational summary.') {
					return [1, 0];
				}
				if (
					text ===
					'release-readiness callouts and operator recovery drills'
				) {
					return [0, 1];
				}

				return [0.9, 0.1];
			}
		});
		const collection = createRAGCollection({ store });
		const rerankedCollection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: { documentId: 'target' },
					source: 'guide/multivector-release-guide.md',
					text: 'release-readiness callouts and operator recovery drills',
					embeddingVariants: [
						{
							embedding: [0.9, 0.1],
							id: 'launch-checklist',
							label: 'Launch checklist',
							text: 'aurora launch packet sign-off checklist'
						}
					]
				}
			]
		});

		const vectorResponse = await evaluateRAGCollection({
			collection: {
				...collection,
				search: (input) =>
					collection.search({ ...input, retrieval: 'vector' })
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'multivector-rerank',
						query: 'Which aurora launch packet phrase shows exact wording?',
						topK: 1
					}
				]
			}
		});
		const rerankedResponse = await evaluateRAGCollection({
			collection: {
				...rerankedCollection,
				search: (input) =>
					rerankedCollection.search({ ...input, retrieval: 'vector' })
			},
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'multivector-rerank',
						query: 'Which aurora launch packet phrase shows exact wording?',
						topK: 1
					}
				]
			}
		});
		const rerankedTrace = await rerankedCollection.searchWithTrace({
			query: 'Which aurora launch packet phrase shows exact wording?',
			retrieval: 'vector',
			topK: 1
		});

		expect(vectorResponse.summary.passedCases).toBe(0);
		expect(rerankedResponse.summary.passedCases).toBe(1);
		expect(rerankedTrace.results[0]?.chunkId).toBe('target:001');
		expect(
			rerankedTrace.trace.steps.find((step) => step.stage === 'rerank')
				?.metadata
		).toEqual(
			expect.objectContaining({
				leadMultivectorVariantCue: 'phrase_match',
				leadMultivectorVariantId: 'launch-checklist'
			})
		);
	});

	it('compares retrieval strategies on the same suite', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'regional growth sheet') return [1, 0];
				if (text.includes('Generic')) return [1, 0];
				if (text.includes('Workbook')) return [0, 1];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({ store });
		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: {
						documentId: 'target',
						sheetName: 'Regional Growth'
					},
					source: 'files/revenue-forecast.xlsx',
					text: 'Workbook.'
				}
			]
		});

		const suite = createRAGEvaluationSuite({
			id: 'retrieval-suite',
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'sheet-target',
						query: 'regional growth sheet',
						topK: 1
					}
				]
			},
			label: 'Retrieval Suite'
		});

		const comparison = await compareRAGRetrievalStrategies({
			collection,
			retrievals: [
				{ id: 'vector', retrieval: 'vector' },
				{ id: 'hybrid', retrieval: 'hybrid' }
			],
			suite
		});

		expect(comparison.entries).toHaveLength(2);
		expect(comparison.summary.bestByPassingRate).toBe('hybrid');
		expect(comparison.summary.bestByAverageF1).toBe('hybrid');
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'vector')
				?.response.summary.passedCases
		).toBe(0);
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'vector')
				?.traceSummary?.modes
		).toEqual(['vector']);
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'hybrid')
				?.traceSummary?.modes
		).toEqual(['hybrid']);
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'hybrid')
				?.traceSummary?.lexicalCases
		).toBe(1);
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'hybrid')
				?.response.summary.passedCases
		).toBe(1);
		expect(comparison.leaderboard[0]).toMatchObject({
			label: 'hybrid',
			rank: 1,
			runId: 'hybrid'
		});
	});

	it('surfaces multivector contribution winners in retrieval comparisons', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (
					text ===
					'Which aurora launch packet phrase shows exact wording?'
				) {
					return [1, 0];
				}
				if (text === 'Generic operational summary.') {
					return [1, 0];
				}
				if (
					text ===
					'release-readiness callouts and operator recovery drills'
				) {
					return [0, 1];
				}

				return [0.9, 0.1];
			}
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: { documentId: 'target' },
					source: 'guide/multivector-release-guide.md',
					text: 'release-readiness callouts and operator recovery drills',
					embeddingVariants: [
						{
							embedding: [0.9, 0.1],
							id: 'launch-checklist',
							label: 'Launch checklist',
							text: 'aurora launch packet sign-off checklist'
						}
					]
				}
			]
		});

		const suite = createRAGEvaluationSuite({
			id: 'multivector-comparison-suite',
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'multivector-comparison-case',
						query: 'Which aurora launch packet phrase shows exact wording?',
						topK: 1
					}
				]
			},
			label: 'Multivector Comparison Suite'
		});

		const comparison = await compareRAGRetrievalStrategies({
			collection,
			retrievals: [
				{ id: 'vector', retrieval: 'vector' },
				{ id: 'hybrid', retrieval: 'hybrid' }
			],
			suite
		});

		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'vector')
				?.traceSummary
		).toEqual(
			expect.objectContaining({
				multiVectorCases: 1,
				multiVectorVectorHitCases: 1,
				multiVectorLexicalHitCases: 0,
				multiVectorCollapsedCases: 1
			})
		);
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'hybrid')
				?.traceSummary
		).toEqual(
			expect.objectContaining({
				multiVectorCases: 1,
				multiVectorVectorHitCases: 1,
				multiVectorLexicalHitCases: 1,
				multiVectorCollapsedCases: 1
			})
		);
		expect(comparison.summary.bestByMultivectorCollapsedCases).toBe(
			'hybrid'
		);
		expect(comparison.summary.bestByMultivectorLexicalHitCases).toBe(
			'hybrid'
		);
		expect(comparison.summary.bestByMultivectorVectorHitCases).toBe(
			'hybrid'
		);
	});

	it('builds baseline versus candidate decision summaries for retrieval comparisons', async () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					label: 'Vector',
					response: {
						cases: [],
						elapsedMs: 40,
						ok: true,
						passingRate: 25,
						summary: {
							averageF1: 0.2,
							averageLatencyMs: 40,
							averagePrecision: 0.25,
							averageRecall: 0.25,
							failedCases: 3,
							partialCases: 0,
							passedCases: 1,
							totalCases: 4
						},
						totalCases: 4
					},
					traceSummary: {
						averageCandidateTopK: 4,
						averageFinalCount: 1,
						averageLexicalCount: 0,
						averageLexicalTopK: 0,
						averageVectorCount: 1,
						balancedCases: 0,
						lexicalCases: 0,
						modes: ['vector'],
						multiVectorCases: 1,
						multiVectorCollapsedCases: 1,
						multiVectorLexicalHitCases: 0,
						multiVectorVectorHitCases: 1,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 2,
						runtimeUnderfilledTopKCases: 1,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: {
							evidence_reconcile: 0,
							finalize: 1,
							vector_search: 1
						},
						totalCases: 1,
						transformedCases: 0,
						variantCases: 0,
						vectorCases: 1
					},
					retrievalId: 'vector',
					retrievalMode: 'vector'
				},
				{
					label: 'Hybrid',
					response: {
						cases: [],
						elapsedMs: 55,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 55,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					traceSummary: {
						averageCandidateTopK: 6,
						averageFinalCount: 1,
						averageLexicalCount: 1,
						averageLexicalTopK: 4,
						averageVectorCount: 1,
						balancedCases: 0,
						lexicalCases: 1,
						modes: ['hybrid'],
						multiVectorCases: 1,
						multiVectorCollapsedCases: 1,
						multiVectorLexicalHitCases: 1,
						multiVectorVectorHitCases: 1,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 0,
						runtimeUnderfilledTopKCases: 0,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: {
							evidence_reconcile: 1,
							finalize: 1,
							fusion: 1,
							lexical_search: 1,
							vector_search: 1
						},
						totalCases: 1,
						transformedCases: 0,
						variantCases: 0,
						vectorCases: 1
					},
					retrievalId: 'hybrid',
					retrievalMode: 'hybrid'
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'hybrid',
				bestByMultivectorCollapsedCases: 'hybrid',
				bestByMultivectorLexicalHitCases: 'hybrid',
				bestByMultivectorVectorHitCases: 'hybrid',
				bestByEvidenceReconcileCases: 'hybrid',
				bestByOfficeEvidenceReconcileCases: 'hybrid',
				bestByPDFEvidenceReconcileCases: 'vector',
				bestByLowestRuntimeCandidateBudgetExhaustedCases: 'hybrid',
				bestByLowestRuntimeUnderfilledTopKCases: 'hybrid',
				bestByPassingRate: 'hybrid',
				fastest: 'vector'
			},
			suiteId: 'retrieval-suite',
			suiteLabel: 'Retrieval Suite'
		};

		const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
			baselineRetrievalId: 'vector',
			candidateRetrievalId: 'hybrid',
			comparison,
			policy: {
				minAverageF1Delta: 0.25,
				minPassingRateDelta: 25,
				severity: 'fail'
			}
		});

		expect(decisionSummary).toEqual({
			baseline: {
				averageF1: 0.2,
				elapsedMs: 40,
				label: 'Vector',
				multiVectorCollapsedCases: 1,
				multiVectorLexicalHitCases: 0,
				multiVectorVectorHitCases: 1,
				evidenceReconcileCases: 0,
				officeEvidenceReconcileCases: 0,
				pdfEvidenceReconcileCases: 0,
				runtimeCandidateBudgetExhaustedCases: 2,
				runtimeUnderfilledTopKCases: 1,
				passingRate: 25,
				retrievalId: 'vector'
			},
			baselineRetrievalId: 'vector',
			candidate: {
				averageF1: 0.7,
				elapsedMs: 55,
				label: 'Hybrid',
				multiVectorCollapsedCases: 1,
				multiVectorLexicalHitCases: 1,
				multiVectorVectorHitCases: 1,
				evidenceReconcileCases: 1,
				officeEvidenceReconcileCases: 0,
				pdfEvidenceReconcileCases: 0,
				runtimeCandidateBudgetExhaustedCases: 0,
				runtimeUnderfilledTopKCases: 0,
				passingRate: 75,
				retrievalId: 'hybrid'
			},
			candidateRetrievalId: 'hybrid',
			delta: {
				averageF1Delta: 0.49999999999999994,
				elapsedMsDelta: 15,
				multiVectorCollapsedCasesDelta: 0,
				multiVectorLexicalHitCasesDelta: 1,
				multiVectorVectorHitCasesDelta: 0,
				evidenceReconcileCasesDelta: 1,
				officeEvidenceReconcileCasesDelta: 0,
				pdfEvidenceReconcileCasesDelta: 0,
				runtimeCandidateBudgetExhaustedCasesDelta: -2,
				runtimeUnderfilledTopKCasesDelta: -1,
				passingRateDelta: 50
			},
			fastest: 'vector',
			gate: {
				policy: {
					minAverageF1Delta: 0.25,
					minPassingRateDelta: 25,
					severity: 'fail'
				},
				reasons: [],
				status: 'pass'
			},
			winnerByAverageF1: 'hybrid',
			winnerByMultivectorCollapsedCases: 'hybrid',
			winnerByMultivectorLexicalHitCases: 'hybrid',
			winnerByMultivectorVectorHitCases: 'hybrid',
			winnerByEvidenceReconcileCases: 'hybrid',
			winnerByOfficeEvidenceReconcileCases: 'hybrid',
			winnerByPDFEvidenceReconcileCases: 'vector',
			winnerByLowestRuntimeCandidateBudgetExhaustedCases: 'hybrid',
			winnerByLowestRuntimeUnderfilledTopKCases: 'hybrid',
			winnerByPassingRate: 'hybrid'
		});
		expect(
			buildRAGRetrievalReleaseVerdict({
				decisionSummary,
				groupKey: 'docs-release'
			})
		).toEqual({
			baselineGroupKey: 'docs-release',
			baselineRetrievalId: 'vector',
			candidateRetrievalId: 'hybrid',
			delta: {
				averageF1Delta: 0.49999999999999994,
				elapsedMsDelta: 15,
				multiVectorCollapsedCasesDelta: 0,
				multiVectorLexicalHitCasesDelta: 1,
				multiVectorVectorHitCasesDelta: 0,
				evidenceReconcileCasesDelta: 1,
				officeEvidenceReconcileCasesDelta: 0,
				pdfEvidenceReconcileCasesDelta: 0,
				runtimeCandidateBudgetExhaustedCasesDelta: -2,
				runtimeUnderfilledTopKCasesDelta: -1,
				passingRateDelta: 50
			},
			gate: {
				policy: {
					minAverageF1Delta: 0.25,
					minPassingRateDelta: 25,
					severity: 'fail'
				},
				reasons: [],
				status: 'pass'
			},
			status: 'pass',
			summary: 'Candidate passed the active baseline gate.'
		});
	});

	it('renders multivector winners in retrieval comparison overviews', () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					label: 'Vector',
					response: buildRAGEvaluationResponse([]),
					retrievalId: 'vector',
					retrievalMode: 'vector'
				},
				{
					label: 'Hybrid',
					response: buildRAGEvaluationResponse([]),
					retrievalId: 'hybrid',
					retrievalMode: 'hybrid'
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'hybrid',
				bestByPresentationTitleCueCases: 'vector',
				bestByPresentationBodyCueCases: 'hybrid',
				bestByPresentationNotesCueCases: 'vector',
				bestByMultivectorCollapsedCases: 'hybrid',
				bestByMultivectorLexicalHitCases: 'hybrid',
				bestByMultivectorVectorHitCases: 'vector',
				bestByEvidenceReconcileCases: 'hybrid',
				bestByOfficeEvidenceReconcileCases: 'hybrid',
				bestByOfficeParagraphEvidenceReconcileCases: 'hybrid',
				bestByOfficeListEvidenceReconcileCases: 'vector',
				bestByOfficeTableEvidenceReconcileCases: 'hybrid',
				bestByPDFEvidenceReconcileCases: 'vector',
				bestByLowestRuntimeCandidateBudgetExhaustedCases: 'hybrid',
				bestByLowestRuntimeUnderfilledTopKCases: 'vector',
				bestByPassingRate: 'hybrid',
				fastest: 'vector'
			},
			suiteId: 'retrieval-suite',
			suiteLabel: 'Retrieval Suite'
		};

		const overview =
			buildRAGRetrievalComparisonOverviewPresentation(comparison);

		expect(overview.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'Best multivector collapse',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best multivector lexical hits',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best multivector vector hits',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Best evidence reconcile',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best presentation title cue',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Best presentation body cue',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best presentation notes cue',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Best office structure reconcile (docx/xlsx/pptx)',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best office narrative reconcile',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best office checklist reconcile',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Best office table reconcile',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best PDF native evidence',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Lowest runtime budget exhaustion',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Lowest runtime underfilled TopK',
					value: 'Vector'
				})
			])
		);
	});

	it('renders office reconcile family winners in release group history runs', () => {
		const history = buildRAGRetrievalReleaseGroupHistoryPresentation({
			runs: [
				{
					id: 'run-office-history',
					label: 'Hybrid',
					finishedAt: '2026-04-21T12:00:00.000Z',
					tags: ['fixture:scope-slices'],
					comparison: {
						summary: {
							bestByPassingRate: 'Hybrid',
							bestByAverageF1: 'Hybrid',
							bestByPresentationTitleCueCases: 'Vector',
							bestByPresentationBodyCueCases: 'Hybrid',
							bestByPresentationNotesCueCases: 'Vector',
							bestByOfficeParagraphEvidenceReconcileCases:
								'Hybrid',
							bestByOfficeListEvidenceReconcileCases: 'Vector',
							bestByOfficeTableEvidenceReconcileCases: 'Hybrid'
						}
					}
				} as any
			]
		});

		expect(history.recentRuns[0]?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'Presentation cue winners',
					value: 'title=Vector, body=Hybrid, notes=Vector'
				}),
				expect.objectContaining({
					label: 'Best presentation title cue',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Best presentation body cue',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best presentation notes cue',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Office reconcile winners (docx/xlsx/pptx)',
					value: 'narrative=Hybrid, checklist=Vector, table=Hybrid'
				}),
				expect.objectContaining({
					label: 'Best office narrative reconcile',
					value: 'Hybrid'
				}),
				expect.objectContaining({
					label: 'Best office checklist reconcile',
					value: 'Vector'
				}),
				expect.objectContaining({
					label: 'Best office table reconcile',
					value: 'Hybrid'
				})
			])
		);
	});

	it('applies multivector coverage thresholds in retrieval comparison gates', () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					label: 'Vector',
					response: {
						cases: [],
						elapsedMs: 40,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 40,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					retrievalId: 'vector',
					retrievalMode: 'vector',
					traceSummary: {
						averageCandidateTopK: 4,
						averageFinalCount: 1,
						averageLexicalCount: 0,
						averageLexicalTopK: 0,
						averageVectorCount: 1,
						balancedCases: 0,
						lexicalCases: 0,
						modes: ['vector'],
						multiVectorCases: 1,
						multiVectorCollapsedCases: 1,
						multiVectorLexicalHitCases: 1,
						multiVectorVectorHitCases: 1,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 0,
						runtimeUnderfilledTopKCases: 0,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: { finalize: 1, vector_search: 1 },
						totalCases: 1,
						transformedCases: 0,
						variantCases: 0,
						vectorCases: 1
					}
				},
				{
					label: 'Hybrid',
					response: {
						cases: [],
						elapsedMs: 55,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 55,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					retrievalId: 'hybrid',
					retrievalMode: 'hybrid',
					traceSummary: {
						averageCandidateTopK: 6,
						averageFinalCount: 1,
						averageLexicalCount: 0,
						averageLexicalTopK: 4,
						averageVectorCount: 1,
						balancedCases: 0,
						lexicalCases: 1,
						modes: ['hybrid'],
						multiVectorCases: 1,
						multiVectorCollapsedCases: 1,
						multiVectorLexicalHitCases: 0,
						multiVectorVectorHitCases: 1,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 0,
						runtimeUnderfilledTopKCases: 0,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: {
							finalize: 1,
							fusion: 1,
							lexical_search: 1,
							vector_search: 1
						},
						totalCases: 1,
						transformedCases: 0,
						variantCases: 0,
						vectorCases: 1
					}
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'vector',
				bestByMultivectorCollapsedCases: 'vector',
				bestByMultivectorLexicalHitCases: 'vector',
				bestByMultivectorVectorHitCases: 'vector',
				bestByPassingRate: 'vector',
				fastest: 'vector'
			},
			suiteId: 'retrieval-suite',
			suiteLabel: 'Retrieval Suite'
		};

		const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
			baselineRetrievalId: 'vector',
			candidateRetrievalId: 'hybrid',
			comparison,
			policy: {
				minAverageF1Delta: 0,
				minMultiVectorLexicalHitCasesDelta: 0,
				minPassingRateDelta: 0,
				severity: 'fail'
			}
		});

		expect(decisionSummary?.delta).toEqual(
			expect.objectContaining({
				multiVectorLexicalHitCasesDelta: -1
			})
		);
		expect(decisionSummary?.gate).toEqual({
			policy: {
				minAverageF1Delta: 0,
				minMultiVectorLexicalHitCasesDelta: 0,
				minPassingRateDelta: 0,
				severity: 'fail'
			},
			reasons: ['multivector lexical-hit delta -1 is below 0'],
			status: 'fail'
		});
		expect(
			buildRAGRetrievalReleaseVerdict({
				decisionSummary,
				groupKey: 'docs-release'
			})
		).toEqual(
			expect.objectContaining({
				status: 'fail',
				summary: 'Candidate failed the active baseline gate.'
			})
		);
	});

	it('applies runtime pressure thresholds in retrieval comparison gates', () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					label: 'Balanced',
					response: {
						cases: [],
						elapsedMs: 45,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 45,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					retrievalId: 'balanced',
					retrievalMode: 'vector',
					traceSummary: {
						averageCandidateTopK: 8,
						averageFinalCount: 1,
						averageLexicalCount: 0,
						averageLexicalTopK: 0,
						averageVectorCount: 1,
						balancedCases: 1,
						lexicalCases: 0,
						modes: ['vector'],
						multiVectorCases: 0,
						multiVectorCollapsedCases: 0,
						multiVectorLexicalHitCases: 0,
						multiVectorVectorHitCases: 0,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 0,
						runtimeUnderfilledTopKCases: 0,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: { finalize: 1, vector_search: 1 },
						totalCases: 1,
						transformedCases: 1,
						variantCases: 1,
						vectorCases: 1
					}
				},
				{
					label: 'Latency',
					response: {
						cases: [],
						elapsedMs: 40,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 40,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					retrievalId: 'latency',
					retrievalMode: 'vector',
					traceSummary: {
						averageCandidateTopK: 2,
						averageFinalCount: 1,
						averageLexicalCount: 0,
						averageLexicalTopK: 0,
						averageVectorCount: 1,
						balancedCases: 0,
						lexicalCases: 0,
						modes: ['vector'],
						multiVectorCases: 0,
						multiVectorCollapsedCases: 0,
						multiVectorLexicalHitCases: 0,
						multiVectorVectorHitCases: 0,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 2,
						runtimeUnderfilledTopKCases: 1,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: { finalize: 1, vector_search: 1 },
						totalCases: 1,
						transformedCases: 1,
						variantCases: 1,
						vectorCases: 1
					}
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'balanced',
				bestByLowestRuntimeCandidateBudgetExhaustedCases: 'balanced',
				bestByLowestRuntimeUnderfilledTopKCases: 'balanced',
				bestByPassingRate: 'balanced',
				fastest: 'latency'
			},
			suiteId: 'runtime-suite',
			suiteLabel: 'Runtime Suite'
		};

		const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
			baselineRetrievalId: 'balanced',
			candidateRetrievalId: 'latency',
			comparison,
			policy: {
				maxRuntimeCandidateBudgetExhaustedCasesDelta: 0,
				maxRuntimeUnderfilledTopKCasesDelta: 0,
				severity: 'fail'
			}
		});

		expect(decisionSummary?.delta).toEqual(
			expect.objectContaining({
				runtimeCandidateBudgetExhaustedCasesDelta: 2,
				runtimeUnderfilledTopKCasesDelta: 1
			})
		);
		expect(decisionSummary?.gate).toEqual({
			policy: {
				maxRuntimeCandidateBudgetExhaustedCasesDelta: 0,
				maxRuntimeUnderfilledTopKCasesDelta: 0,
				severity: 'fail'
			},
			reasons: [
				'runtime candidate-budget-exhausted delta 2 exceeds 0',
				'runtime underfilled-topk delta 1 exceeds 0'
			],
			status: 'fail'
		});
		expect(
			decisionSummary?.winnerByLowestRuntimeCandidateBudgetExhaustedCases
		).toBe('balanced');
		expect(decisionSummary?.winnerByLowestRuntimeUnderfilledTopKCases).toBe(
			'balanced'
		);
	});

	it('applies evidence reconcile thresholds in retrieval comparison gates', () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					label: 'Hybrid native',
					response: {
						cases: [],
						elapsedMs: 45,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 45,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					retrievalId: 'hybrid-native',
					retrievalMode: 'hybrid',
					traceSummary: {
						averageCandidateTopK: 8,
						averageFinalCount: 1,
						averageLexicalCount: 1,
						averageLexicalTopK: 2,
						averageVectorCount: 1,
						balancedCases: 1,
						lexicalCases: 0,
						modes: ['hybrid'],
						multiVectorCases: 0,
						multiVectorCollapsedCases: 0,
						multiVectorLexicalHitCases: 0,
						multiVectorVectorHitCases: 0,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 0,
						runtimeUnderfilledTopKCases: 0,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: {
							evidence_reconcile: 2,
							finalize: 1,
							vector_search: 1
						},
						totalCases: 1,
						transformedCases: 1,
						variantCases: 1,
						vectorCases: 1
					}
				},
				{
					label: 'OCR only',
					response: {
						cases: [],
						elapsedMs: 40,
						ok: true,
						passingRate: 75,
						summary: {
							averageF1: 0.7,
							averageLatencyMs: 40,
							averagePrecision: 0.75,
							averageRecall: 0.75,
							failedCases: 1,
							partialCases: 0,
							passedCases: 3,
							totalCases: 4
						},
						totalCases: 4
					},
					retrievalId: 'ocr-only',
					retrievalMode: 'vector',
					traceSummary: {
						averageCandidateTopK: 8,
						averageFinalCount: 1,
						averageLexicalCount: 0,
						averageLexicalTopK: 0,
						averageVectorCount: 1,
						balancedCases: 0,
						lexicalCases: 0,
						modes: ['vector'],
						multiVectorCases: 0,
						multiVectorCollapsedCases: 0,
						multiVectorLexicalHitCases: 0,
						multiVectorVectorHitCases: 0,
						officeEvidenceReconcileCases: 0,
						pdfEvidenceReconcileCases: 0,
						runtimeCandidateBudgetExhaustedCases: 0,
						runtimeUnderfilledTopKCases: 0,
						roundRobinCases: 0,
						sourceBalanceStrategies: ['cap'],
						stageCounts: { finalize: 1, vector_search: 1 },
						totalCases: 1,
						transformedCases: 1,
						variantCases: 1,
						vectorCases: 1
					}
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'hybrid-native',
				bestByEvidenceReconcileCases: 'hybrid-native',
				bestByPassingRate: 'hybrid-native',
				fastest: 'ocr-only'
			},
			suiteId: 'evidence-suite',
			suiteLabel: 'Evidence Suite'
		};

		const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
			baselineRetrievalId: 'hybrid-native',
			candidateRetrievalId: 'ocr-only',
			comparison,
			policy: {
				minEvidenceReconcileCasesDelta: 0,
				severity: 'fail'
			}
		});

		expect(decisionSummary?.delta).toEqual(
			expect.objectContaining({
				evidenceReconcileCasesDelta: -2
			})
		);
		expect(decisionSummary?.gate).toEqual({
			policy: {
				minEvidenceReconcileCasesDelta: 0,
				severity: 'fail'
			},
			reasons: ['evidence reconcile delta -2 is below 0'],
			status: 'fail'
		});
		expect(decisionSummary?.winnerByEvidenceReconcileCases).toBe(
			'hybrid-native'
		);
	});

	it('applies presentation cue thresholds in retrieval comparison gates', () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					caseTraceSnapshots: [
						{
							caseId: 'slide-title',
							leadPresentationCue: 'title',
							query: 'title query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						},
						{
							caseId: 'slide-body',
							leadPresentationCue: 'body',
							query: 'body query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						},
						{
							caseId: 'slide-notes',
							leadPresentationCue: 'notes',
							query: 'notes query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						}
					],
					label: 'Cue aware',
					response: {
						cases: [],
						elapsedMs: 50,
						ok: true,
						passingRate: 100,
						summary: {
							averageF1: 1,
							averageLatencyMs: 50,
							averagePrecision: 1,
							averageRecall: 1,
							failedCases: 0,
							partialCases: 0,
							passedCases: 3,
							totalCases: 3
						},
						totalCases: 3
					},
					retrievalId: 'cue-aware',
					retrievalMode: 'hybrid'
				},
				{
					caseTraceSnapshots: [
						{
							caseId: 'slide-title',
							leadPresentationCue: 'title',
							query: 'title query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						}
					],
					label: 'Title only',
					response: {
						cases: [],
						elapsedMs: 40,
						ok: true,
						passingRate: 100,
						summary: {
							averageF1: 1,
							averageLatencyMs: 40,
							averagePrecision: 1,
							averageRecall: 1,
							failedCases: 0,
							partialCases: 0,
							passedCases: 3,
							totalCases: 3
						},
						totalCases: 3
					},
					retrievalId: 'title-only',
					retrievalMode: 'vector'
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'cue-aware',
				bestByPassingRate: 'cue-aware',
				bestByPresentationTitleCueCases: 'cue-aware',
				bestByPresentationBodyCueCases: 'cue-aware',
				bestByPresentationNotesCueCases: 'cue-aware',
				fastest: 'title-only'
			},
			suiteId: 'presentation-suite',
			suiteLabel: 'Presentation Suite'
		};

		const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
			baselineRetrievalId: 'cue-aware',
			candidateRetrievalId: 'title-only',
			comparison,
			policy: {
				minPresentationBodyCueCasesDelta: 0,
				minPresentationNotesCueCasesDelta: 0,
				severity: 'fail'
			}
		});

		expect(decisionSummary?.delta).toEqual(
			expect.objectContaining({
				presentationBodyCueCasesDelta: -1,
				presentationNotesCueCasesDelta: -1,
				presentationTitleCueCasesDelta: 0
			})
		);
		expect(decisionSummary?.gate).toEqual({
			policy: {
				minPresentationBodyCueCasesDelta: 0,
				minPresentationNotesCueCasesDelta: 0,
				severity: 'fail'
			},
			reasons: [
				'presentation body cue delta -1 is below 0',
				'presentation notes cue delta -1 is below 0'
			],
			status: 'fail'
		});
		expect(decisionSummary?.winnerByPresentationTitleCueCases).toBe(
			'cue-aware'
		);
		expect(decisionSummary?.winnerByPresentationBodyCueCases).toBe(
			'cue-aware'
		);
		expect(decisionSummary?.winnerByPresentationNotesCueCases).toBe(
			'cue-aware'
		);
	});

	it('applies spreadsheet cue thresholds in retrieval comparison gates', () => {
		const comparison: RAGRetrievalComparison = {
			entries: [
				{
					caseTraceSnapshots: [
						{
							caseId: 'sheet-led',
							leadSpreadsheetCue: 'sheet',
							query: 'sheet query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						},
						{
							caseId: 'table-led',
							leadSpreadsheetCue: 'table',
							query: 'table query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						},
						{
							caseId: 'column-led',
							leadSpreadsheetCue: 'column',
							query: 'column query',
							stageCounts: {},
							previousStageCounts: {},
							traceChange: 'unchanged',
							variantQueries: [],
							previousVariantQueries: [],
							status: 'pass',
							finalCount: 1,
							previousFinalCount: 1,
							vectorCount: 1,
							previousVectorCount: 1,
							lexicalCount: 1,
							previousLexicalCount: 1,
							candidateTopK: 1,
							previousCandidateTopK: 1,
							lexicalTopK: 1,
							previousLexicalTopK: 1
						}
					],
					label: 'Spreadsheet aware',
					response: {
						cases: [],
						elapsedMs: 50,
						ok: true,
						passingRate: 100,
						summary: {
							averageF1: 1,
							averageLatencyMs: 50,
							averagePrecision: 1,
							averageRecall: 1,
							failedCases: 0,
							partialCases: 0,
							passedCases: 3,
							totalCases: 3
						},
						totalCases: 3
					},
					retrievalId: 'spreadsheet-aware',
					retrievalMode: 'hybrid'
				},
				{
					caseTraceSnapshots: [],
					label: 'Spreadsheet blind',
					response: {
						cases: [],
						elapsedMs: 40,
						ok: true,
						passingRate: 100,
						summary: {
							averageF1: 1,
							averageLatencyMs: 40,
							averagePrecision: 1,
							averageRecall: 1,
							failedCases: 0,
							partialCases: 0,
							passedCases: 3,
							totalCases: 3
						},
						totalCases: 3
					},
					retrievalId: 'spreadsheet-blind',
					retrievalMode: 'vector'
				}
			],
			leaderboard: [],
			summary: {
				bestByAverageF1: 'spreadsheet-aware',
				bestByPassingRate: 'spreadsheet-aware',
				bestBySpreadsheetSheetCueCases: 'spreadsheet-aware',
				bestBySpreadsheetTableCueCases: 'spreadsheet-aware',
				bestBySpreadsheetColumnCueCases: 'spreadsheet-aware',
				fastest: 'spreadsheet-blind'
			},
			suiteId: 'spreadsheet-suite',
			suiteLabel: 'Spreadsheet Suite'
		};

		const decisionSummary = buildRAGRetrievalComparisonDecisionSummary({
			baselineRetrievalId: 'spreadsheet-aware',
			candidateRetrievalId: 'spreadsheet-blind',
			comparison,
			policy: {
				minSpreadsheetSheetCueCasesDelta: 0,
				minSpreadsheetTableCueCasesDelta: 0,
				minSpreadsheetColumnCueCasesDelta: 0,
				severity: 'fail'
			}
		});

		expect(decisionSummary?.delta).toEqual(
			expect.objectContaining({
				spreadsheetSheetCueCasesDelta: -1,
				spreadsheetTableCueCasesDelta: -1,
				spreadsheetColumnCueCasesDelta: -1
			})
		);
		expect(decisionSummary?.gate).toEqual({
			policy: {
				minSpreadsheetSheetCueCasesDelta: 0,
				minSpreadsheetTableCueCasesDelta: 0,
				minSpreadsheetColumnCueCasesDelta: 0,
				severity: 'fail'
			},
			reasons: [
				'spreadsheet sheet cue delta -1 is below 0',
				'spreadsheet table cue delta -1 is below 0',
				'spreadsheet column cue delta -1 is below 0'
			],
			status: 'fail'
		});
		expect(decisionSummary?.winnerBySpreadsheetSheetCueCases).toBe(
			'spreadsheet-aware'
		);
		expect(decisionSummary?.winnerBySpreadsheetTableCueCases).toBe(
			'spreadsheet-aware'
		);
		expect(decisionSummary?.winnerBySpreadsheetColumnCueCases).toBe(
			'spreadsheet-aware'
		);
	});

	itIfSQLiteNative(
		'proves adaptive larger-corpus native planning on sqlite vec0 stores',
		async () => {
			await assertAdaptiveNativeBenchmarkParity({
				expectedVectorMode: 'native_vec0',
				store: createSQLiteRAGStore({
					db: new Database(':memory:'),
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === adaptiveNativeBenchmarkQuery ? [1, 0] : [0, 1],
					native: {
						mode: 'vec0',
						requireAvailable: true
					}
				})
			});
		}
	);

	itIfPostgres(
		'proves adaptive larger-corpus native planning on postgres stores',
		async () => {
			await assertAdaptiveNativeBenchmarkParity({
				expectedVectorMode: 'native_pgvector',
				store: trackPostgresStore(
					createPostgresRAGStore({
						connectionString: POSTGRES_URL,
						dimensions: 2,
						mockEmbedding: async (text) =>
							text === adaptiveNativeBenchmarkQuery
								? [1, 0]
								: [0, 1],
						tableName: `rag_quality_${randomUUID().replaceAll('-', '_')}`
					})
				)
			});
		},
		35_000
	);

	it('filters persisted retrieval comparison history by label and winner', async () => {
		const store = createRAGFileRetrievalComparisonHistoryStore(
			`/tmp/rag-retrieval-comparison-filter-history-${Date.now()}.json`
		);

		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'hybrid',
						bestByPassingRate: 'hybrid',
						fastest: 'vector'
					},
					suiteId: 'suite-a',
					suiteLabel: 'Docs Suite'
				},
				finishedAt: 20,
				groupKey: 'docs-release',
				id: 'run-a',
				label: 'Docs benchmark',
				startedAt: 10,
				suiteId: 'suite-a',
				suiteLabel: 'Docs Suite',
				elapsedMs: 10,
				tags: ['docs', 'release']
			},
			store
		});
		await persistRAGRetrievalComparisonRun({
			run: {
				comparison: {
					entries: [],
					leaderboard: [],
					summary: {
						bestByAverageF1: 'vector',
						bestByPassingRate: 'vector',
						fastest: 'vector'
					},
					suiteId: 'suite-b',
					suiteLabel: 'Support Suite'
				},
				finishedAt: 40,
				groupKey: 'support-release',
				id: 'run-b',
				label: 'Support benchmark',
				startedAt: 30,
				suiteId: 'suite-b',
				suiteLabel: 'Support Suite',
				elapsedMs: 10,
				tags: ['support', 'release']
			},
			store
		});

		const byLabel = await loadRAGRetrievalComparisonHistory({
			label: 'docs',
			store
		});
		const byGroup = await loadRAGRetrievalComparisonHistory({
			groupKey: 'docs-release',
			store
		});
		const byTag = await loadRAGRetrievalComparisonHistory({
			store,
			tag: 'support'
		});
		const byWinner = await loadRAGRetrievalComparisonHistory({
			store,
			winnerId: 'vector'
		});

		expect(byLabel.map((run) => run.id)).toEqual(['run-a']);
		expect(byGroup.map((run) => run.id)).toEqual(['run-a']);
		expect(byTag.map((run) => run.id)).toEqual(['run-b']);
		expect(byWinner.map((run) => run.id)).toEqual(['run-b']);
	});

	it('persists retrieval release decisions for promotion and rollback audit trails', async () => {
		const store = createRAGFileRetrievalReleaseDecisionStore(
			`/tmp/rag-retrieval-release-decisions-${Date.now()}.json`
		);

		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: 'baseline-2',
				decidedAt: 2,
				decidedBy: 'alex',
				groupKey: 'docs-release',
				id: 'decision-2',
				kind: 'revert',
				restoredFromBaselineId: 'baseline-1',
				restoredFromVersion: 1,
				retrievalId: 'vector',
				version: 2
			},
			store
		});
		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: 'baseline-1',
				decidedAt: 1,
				decidedBy: 'alex',
				groupKey: 'docs-release',
				id: 'decision-1',
				kind: 'promote',
				retrievalId: 'lexical',
				sourceRunId: 'run-1',
				version: 1
			},
			store
		});

		const decisions = await loadRAGRetrievalReleaseDecisions({
			groupKey: 'docs-release',
			limit: 5,
			store
		});
		const reverts = await loadRAGRetrievalReleaseDecisions({
			groupKey: 'docs-release',
			kind: 'revert',
			limit: 5,
			store
		});

		expect(
			decisions.map((entry) => `${entry.kind}:${entry.version}`)
		).toEqual(['revert:2', 'promote:1']);
		expect(reverts[0]).toEqual(
			expect.objectContaining({
				kind: 'revert',
				restoredFromVersion: 1,
				retrievalId: 'vector'
			})
		);
	});

	it('persists retrieval release decisions in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalReleaseDecisionStore({
			db,
			tableName: 'retrieval_release_decisions'
		});

		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: 'baseline-2',
				decidedAt: 2,
				decidedBy: 'alex',
				groupKey: 'docs-release',
				id: 'sqlite-decision-2',
				kind: 'revert',
				restoredFromBaselineId: 'baseline-1',
				restoredFromVersion: 1,
				retrievalId: 'vector',
				version: 2
			},
			store
		});
		await persistRAGRetrievalReleaseDecision({
			record: {
				baselineId: 'baseline-1',
				decidedAt: 1,
				decidedBy: 'alex',
				groupKey: 'docs-release',
				id: 'sqlite-decision-1',
				kind: 'promote',
				retrievalId: 'lexical',
				sourceRunId: 'run-1',
				version: 1
			},
			store
		});

		const decisions = await loadRAGRetrievalReleaseDecisions({
			groupKey: 'docs-release',
			limit: 5,
			store
		});
		const reverts = await loadRAGRetrievalReleaseDecisions({
			groupKey: 'docs-release',
			kind: 'revert',
			limit: 5,
			store
		});

		expect(
			decisions.map((entry) => `${entry.kind}:${entry.version}`)
		).toEqual(['revert:2', 'promote:1']);
		expect(reverts[0]).toEqual(
			expect.objectContaining({
				kind: 'revert',
				restoredFromVersion: 1,
				retrievalId: 'vector'
			})
		);
	});

	it('persists retrieval release incidents for operational alerting', async () => {
		const store = createRAGFileRetrievalReleaseIncidentStore(
			`/tmp/rag-retrieval-release-incidents-${Date.now()}.json`
		);

		await persistRAGRetrievalReleaseIncident({
			record: {
				candidateRetrievalId: 'lexical',
				groupKey: 'docs-release',
				id: 'incident-2',
				kind: 'gate_failure',
				message: 'candidate failed the active release gate',
				severity: 'critical',
				status: 'open',
				triggeredAt: 2
			},
			store
		});
		await persistRAGRetrievalReleaseIncident({
			record: {
				groupKey: 'docs-release',
				id: 'incident-1',
				kind: 'approval_expired',
				message: 'approval needs renewal',
				resolvedAt: 2,
				severity: 'warning',
				status: 'resolved',
				triggeredAt: 1
			},
			store
		});

		const incidents = await loadRAGRetrievalReleaseIncidents({
			groupKey: 'docs-release',
			limit: 5,
			store
		});
		const openCritical = await loadRAGRetrievalReleaseIncidents({
			groupKey: 'docs-release',
			limit: 5,
			severity: 'critical',
			status: 'open',
			store
		});

		expect(
			incidents.map((entry) => `${entry.kind}:${entry.status}`)
		).toEqual(['gate_failure:open', 'approval_expired:resolved']);
		expect(openCritical[0]).toEqual(
			expect.objectContaining({
				kind: 'gate_failure',
				severity: 'critical'
			})
		);
	});

	it('persists retrieval release incidents in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalReleaseIncidentStore({
			db,
			tableName: 'retrieval_release_incidents'
		});

		await persistRAGRetrievalReleaseIncident({
			record: {
				candidateRetrievalId: 'lexical',
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-incident-2',
				kind: 'gate_failure',
				message: 'candidate failed the active release gate',
				severity: 'critical',
				status: 'open',
				targetRolloutLabel: 'stable',
				triggeredAt: 2
			},
			store
		});
		await persistRAGRetrievalReleaseIncident({
			record: {
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-incident-1',
				kind: 'approval_expired',
				message: 'approval needs renewal',
				resolvedAt: 2,
				severity: 'warning',
				status: 'resolved',
				targetRolloutLabel: 'canary',
				triggeredAt: 1
			},
			store
		});

		const incidents = await loadRAGRetrievalReleaseIncidents({
			groupKey: 'docs-release',
			limit: 5,
			store
		});
		const openCritical = await loadRAGRetrievalReleaseIncidents({
			corpusGroupKey: 'docs',
			groupKey: 'docs-release',
			limit: 5,
			severity: 'critical',
			status: 'open',
			store,
			targetRolloutLabel: 'stable'
		});

		expect(
			incidents.map((entry) => `${entry.kind}:${entry.status}`)
		).toEqual(['gate_failure:open', 'approval_expired:resolved']);
		expect(openCritical[0]).toEqual(
			expect.objectContaining({
				corpusGroupKey: 'docs',
				kind: 'gate_failure',
				severity: 'critical',
				targetRolloutLabel: 'stable'
			})
		);
	});

	it('persists retrieval lane handoff decisions in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalLaneHandoffDecisionStore({
			db,
			tableName: 'retrieval_lane_handoff_decisions'
		});

		await persistRAGRetrievalLaneHandoffDecision({
			record: {
				corpusGroupKey: 'docs',
				decidedAt: 2,
				groupKey: 'docs-release',
				id: 'sqlite-handoff-decision-2',
				kind: 'complete',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			},
			store
		});
		await persistRAGRetrievalLaneHandoffDecision({
			record: {
				corpusGroupKey: 'docs',
				decidedAt: 1,
				groupKey: 'docs-release',
				id: 'sqlite-handoff-decision-1',
				kind: 'approve',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			},
			store
		});

		const decisions = await loadRAGRetrievalLaneHandoffDecisions({
			corpusGroupKey: 'docs',
			groupKey: 'docs-release',
			limit: 5,
			store,
			targetRolloutLabel: 'stable'
		});
		const approvals = await loadRAGRetrievalLaneHandoffDecisions({
			groupKey: 'docs-release',
			kind: 'approve',
			limit: 5,
			sourceRolloutLabel: 'canary',
			store,
			targetRolloutLabel: 'stable'
		});

		expect(
			decisions.map((entry) => `${entry.kind}:${entry.decidedAt}`)
		).toEqual(['complete:2', 'approve:1']);
		expect(approvals[0]).toEqual(
			expect.objectContaining({
				corpusGroupKey: 'docs',
				kind: 'approve',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);
	});

	it('persists retrieval lane handoff incidents in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalLaneHandoffIncidentStore({
			db,
			tableName: 'retrieval_lane_handoff_incidents'
		});

		await persistRAGRetrievalLaneHandoffIncident({
			record: {
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-handoff-incident-2',
				kind: 'handoff_stale',
				message: 'Stable handoff is stale',
				severity: 'critical',
				sourceRolloutLabel: 'canary',
				status: 'open',
				targetRolloutLabel: 'stable',
				triggeredAt: 2
			},
			store
		});
		await persistRAGRetrievalLaneHandoffIncident({
			record: {
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-handoff-incident-1',
				kind: 'handoff_stale',
				message: 'Stable handoff was stale',
				severity: 'warning',
				sourceRolloutLabel: 'canary',
				status: 'resolved',
				targetRolloutLabel: 'stable',
				triggeredAt: 1
			},
			store
		});

		const incidents = await loadRAGRetrievalLaneHandoffIncidents({
			corpusGroupKey: 'docs',
			groupKey: 'docs-release',
			limit: 5,
			store,
			targetRolloutLabel: 'stable'
		});
		const openCritical = await loadRAGRetrievalLaneHandoffIncidents({
			groupKey: 'docs-release',
			limit: 5,
			severity: 'critical',
			status: 'open',
			store,
			targetRolloutLabel: 'stable'
		});

		expect(
			incidents.map((entry) => `${entry.kind}:${entry.status}`)
		).toEqual(['handoff_stale:open', 'handoff_stale:resolved']);
		expect(openCritical[0]).toEqual(
			expect.objectContaining({
				corpusGroupKey: 'docs',
				severity: 'critical',
				sourceRolloutLabel: 'canary',
				status: 'open'
			})
		);
	});

	it('persists retrieval lane handoff incident history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalLaneHandoffIncidentHistoryStore({
			db,
			tableName: 'retrieval_lane_handoff_incident_history'
		});

		await persistRAGRetrievalLaneHandoffIncidentHistory({
			record: {
				action: 'acknowledged',
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-handoff-history-2',
				incidentId: 'handoff-1',
				kind: 'handoff_stale',
				recordedAt: 2,
				targetRolloutLabel: 'stable'
			},
			store
		});
		await persistRAGRetrievalLaneHandoffIncidentHistory({
			record: {
				action: 'opened',
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-handoff-history-1',
				incidentId: 'handoff-1',
				kind: 'handoff_stale',
				recordedAt: 1,
				targetRolloutLabel: 'stable'
			},
			store
		});

		const records = await loadRAGRetrievalLaneHandoffIncidentHistory({
			corpusGroupKey: 'docs',
			groupKey: 'docs-release',
			incidentId: 'handoff-1',
			limit: 5,
			store,
			targetRolloutLabel: 'stable'
		});
		const acknowledgements =
			await loadRAGRetrievalLaneHandoffIncidentHistory({
				action: 'acknowledged',
				groupKey: 'docs-release',
				limit: 5,
				store
			});

		expect(
			records.map((entry) => `${entry.action}:${entry.recordedAt}`)
		).toEqual(['acknowledged:2', 'opened:1']);
		expect(acknowledgements[0]).toEqual(
			expect.objectContaining({
				corpusGroupKey: 'docs',
				incidentId: 'handoff-1',
				targetRolloutLabel: 'stable'
			})
		);
	});

	it('persists incident remediation decisions in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalIncidentRemediationDecisionStore({
			db,
			tableName: 'retrieval_incident_remediation_decisions'
		});

		await persistRAGRetrievalIncidentRemediationDecision({
			record: {
				decidedAt: 2,
				groupKey: 'docs-release',
				id: 'sqlite-remediation-decision-2',
				incidentId: 'incident-1',
				remediationKind: 'review_readiness',
				status: 'applied',
				targetRolloutLabel: 'stable'
			},
			store
		});
		await persistRAGRetrievalIncidentRemediationDecision({
			record: {
				decidedAt: 1,
				groupKey: 'docs-release',
				id: 'sqlite-remediation-decision-1',
				incidentId: 'incident-1',
				remediationKind: 'monitor_lane',
				status: 'planned',
				targetRolloutLabel: 'stable'
			},
			store
		});

		const records = await loadRAGRetrievalIncidentRemediationDecisions({
			groupKey: 'docs-release',
			incidentId: 'incident-1',
			limit: 5,
			store,
			targetRolloutLabel: 'stable'
		});
		const applied = await loadRAGRetrievalIncidentRemediationDecisions({
			groupKey: 'docs-release',
			limit: 5,
			remediationKind: 'review_readiness',
			status: 'applied',
			store
		});

		expect(
			records.map((entry) => `${entry.remediationKind}:${entry.status}`)
		).toEqual(['review_readiness:applied', 'monitor_lane:planned']);
		expect(applied[0]).toEqual(
			expect.objectContaining({
				incidentId: 'incident-1',
				targetRolloutLabel: 'stable'
			})
		);
	});

	it('persists incident remediation execution history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store =
			createRAGSQLiteRetrievalIncidentRemediationExecutionHistoryStore({
				db,
				tableName: 'retrieval_incident_remediation_execution_history'
			});

		await persistRAGRetrievalIncidentRemediationExecutionHistory({
			record: {
				action: {
					kind: 'resolve_incident',
					label: 'Resolve incident',
					method: 'POST',
					path: '/rag-demo/incidents/resolve'
				},
				blockedByGuardrail: false,
				code: 'incident_resolved',
				executedAt: 2,
				groupKey: 'docs-release',
				id: 'sqlite-remediation-execution-2',
				idempotentReplay: false,
				incidentId: 'incident-1',
				ok: true,
				targetRolloutLabel: 'stable'
			},
			store
		});
		await persistRAGRetrievalIncidentRemediationExecutionHistory({
			record: {
				action: {
					kind: 'acknowledge_incident',
					label: 'Acknowledge incident',
					method: 'POST',
					path: '/rag-demo/incidents/acknowledge'
				},
				blockedByGuardrail: true,
				code: 'guardrail_blocked',
				executedAt: 1,
				groupKey: 'docs-release',
				id: 'sqlite-remediation-execution-1',
				idempotentReplay: true,
				incidentId: 'incident-1',
				ok: false,
				targetRolloutLabel: 'stable'
			},
			store
		});

		const records =
			await loadRAGRetrievalIncidentRemediationExecutionHistory({
				groupKey: 'docs-release',
				incidentId: 'incident-1',
				limit: 5,
				store,
				targetRolloutLabel: 'stable'
			});
		const guardrailBlocked =
			await loadRAGRetrievalIncidentRemediationExecutionHistory({
				actionKind: 'acknowledge_incident',
				blockedByGuardrail: true,
				code: 'guardrail_blocked',
				groupKey: 'docs-release',
				idempotentReplay: true,
				limit: 5,
				store
			});

		expect(
			records.map((entry) => `${entry.code}:${entry.executedAt}`)
		).toEqual(['incident_resolved:2', 'guardrail_blocked:1']);
		expect(guardrailBlocked[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				incidentId: 'incident-1',
				targetRolloutLabel: 'stable'
			})
		);
	});

	it('persists lane handoff auto-complete policy history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store =
			createRAGSQLiteRetrievalLaneHandoffAutoCompletePolicyHistoryStore({
				db,
				tableName: 'retrieval_lane_handoff_auto_complete_policy_history'
			});

		await persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory({
			record: {
				changeKind: 'changed',
				corpusGroupKey: 'docs',
				enabled: true,
				groupKey: 'docs-release',
				id: 'sqlite-auto-complete-policy-2',
				recordedAt: 2,
				targetRolloutLabel: 'stable'
			},
			store
		});
		await persistRAGRetrievalLaneHandoffAutoCompletePolicyHistory({
			record: {
				changeKind: 'snapshot',
				corpusGroupKey: 'docs',
				enabled: false,
				groupKey: 'docs-release',
				id: 'sqlite-auto-complete-policy-1',
				recordedAt: 1,
				targetRolloutLabel: 'stable'
			},
			store
		});

		const records =
			await loadRAGRetrievalLaneHandoffAutoCompletePolicyHistory({
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				limit: 5,
				store,
				targetRolloutLabel: 'stable'
			});

		expect(
			records.map((entry) => `${entry.changeKind}:${entry.recordedAt}`)
		).toEqual(['changed:2', 'snapshot:1']);
	});

	it('persists release lane policy history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalReleaseLanePolicyHistoryStore({
			db,
			tableName: 'retrieval_release_lane_policy_history'
		});

		await persistRAGRetrievalReleaseLanePolicyHistory({
			record: {
				changeKind: 'changed',
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-release-lane-policy-2',
				recordedAt: 2,
				rolloutLabel: 'stable',
				scope: 'group_rollout_label'
			},
			store
		});
		await persistRAGRetrievalReleaseLanePolicyHistory({
			record: {
				changeKind: 'snapshot',
				corpusGroupKey: 'docs',
				id: 'sqlite-release-lane-policy-1',
				recordedAt: 1,
				rolloutLabel: 'stable',
				scope: 'rollout_label'
			},
			store
		});

		const records = await loadRAGRetrievalReleaseLanePolicyHistory({
			corpusGroupKey: 'docs',
			limit: 5,
			rolloutLabel: 'stable',
			scope: 'group_rollout_label',
			store
		});

		expect(records).toHaveLength(1);
		expect(records[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				scope: 'group_rollout_label'
			})
		);
	});

	it('persists baseline gate policy history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store = createRAGSQLiteRetrievalBaselineGatePolicyHistoryStore({
			db,
			tableName: 'retrieval_baseline_gate_policy_history'
		});

		await persistRAGRetrievalBaselineGatePolicyHistory({
			record: {
				changeKind: 'changed',
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				id: 'sqlite-baseline-gate-policy-2',
				policy: { minAverageF1Delta: 0.7 },
				recordedAt: 2,
				rolloutLabel: 'stable',
				scope: 'group_rollout_label'
			},
			store
		});
		await persistRAGRetrievalBaselineGatePolicyHistory({
			record: {
				changeKind: 'snapshot',
				corpusGroupKey: 'docs',
				id: 'sqlite-baseline-gate-policy-1',
				policy: { minAverageF1Delta: 0.6 },
				recordedAt: 1,
				rolloutLabel: 'stable',
				scope: 'rollout_label'
			},
			store
		});

		const records = await loadRAGRetrievalBaselineGatePolicyHistory({
			corpusGroupKey: 'docs',
			groupKey: 'docs-release',
			limit: 5,
			rolloutLabel: 'stable',
			scope: 'group_rollout_label',
			store
		});

		expect(records).toHaveLength(1);
		expect(records[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				policy: expect.objectContaining({ minAverageF1Delta: 0.7 })
			})
		);
	});

	it('persists release lane escalation policy history in SQLite-backed stores', async () => {
		const db = new Database(':memory:');
		const store =
			createRAGSQLiteRetrievalReleaseLaneEscalationPolicyHistoryStore({
				db,
				tableName: 'retrieval_release_lane_escalation_policy_history'
			});

		await persistRAGRetrievalReleaseLaneEscalationPolicyHistory({
			record: {
				approvalExpiredSeverity: 'critical',
				changeKind: 'changed',
				corpusGroupKey: 'docs',
				gateFailureSeverity: 'critical',
				groupKey: 'docs-release',
				id: 'sqlite-escalation-policy-2',
				openIncidentSeverity: 'warning',
				recordedAt: 2,
				regressionSeverity: 'warning',
				targetRolloutLabel: 'stable'
			},
			store
		});
		await persistRAGRetrievalReleaseLaneEscalationPolicyHistory({
			record: {
				approvalExpiredSeverity: 'warning',
				changeKind: 'snapshot',
				corpusGroupKey: 'docs',
				gateFailureSeverity: 'warning',
				groupKey: 'other-group',
				id: 'sqlite-escalation-policy-1',
				openIncidentSeverity: 'warning',
				recordedAt: 1,
				regressionSeverity: 'warning',
				targetRolloutLabel: 'stable'
			},
			store
		});

		const records =
			await loadRAGRetrievalReleaseLaneEscalationPolicyHistory({
				corpusGroupKey: 'docs',
				groupKey: 'docs-release',
				limit: 5,
				store,
				targetRolloutLabel: 'stable'
			});

		expect(records).toHaveLength(1);
		expect(records[0]).toEqual(
			expect.objectContaining({
				approvalExpiredSeverity: 'critical',
				groupKey: 'docs-release'
			})
		);
	});

	it('surfaces source-balance strategy differences in retrieval comparisons', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'a-1',
					embedding: [1, 0],
					metadata: { documentId: 'doc-a-1' },
					source: 'source-a',
					text: 'alpha one'
				},
				{
					chunkId: 'a-2',
					embedding: [0.99, 0.01],
					metadata: { documentId: 'doc-a-2' },
					source: 'source-a',
					text: 'alpha two'
				},
				{
					chunkId: 'b-1',
					embedding: [0.98, 0.02],
					metadata: { documentId: 'doc-b-1' },
					source: 'source-b',
					text: 'beta one'
				},
				{
					chunkId: 'b-2',
					embedding: [0.97, 0.03],
					metadata: { documentId: 'doc-b-2' },
					source: 'source-b',
					text: 'beta two'
				}
			]
		});

		const suite = createRAGEvaluationSuite({
			id: 'balance-suite',
			input: {
				cases: [
					{
						expectedDocumentIds: ['doc-a-1', 'doc-b-1'],
						id: 'balance-case',
						query: 'alpha',
						topK: 4
					}
				]
			},
			label: 'Balance Suite'
		});

		const comparison = await compareRAGRetrievalStrategies({
			collection,
			retrievals: [
				{
					id: 'cap',
					retrieval: {
						maxResultsPerSource: 2,
						mode: 'vector',
						sourceBalanceStrategy: 'cap'
					}
				},
				{
					id: 'round-robin',
					retrieval: {
						maxResultsPerSource: 2,
						mode: 'vector',
						sourceBalanceStrategy: 'round_robin'
					}
				}
			],
			suite
		});

		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'cap')
				?.traceSummary?.sourceBalanceStrategies
		).toEqual(['cap']);
		expect(
			comparison.entries.find(
				(entry) => entry.retrievalId === 'round-robin'
			)?.traceSummary?.sourceBalanceStrategies
		).toEqual(['round_robin']);
		expect(
			comparison.entries.find(
				(entry) => entry.retrievalId === 'round-robin'
			)?.traceSummary?.roundRobinCases
		).toBe(1);
	});

	it('can benchmark MMR diversity retrieval as a distinct strategy', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [0.7071, 0.7071]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'a-1',
					embedding: [1, 0],
					metadata: { documentId: 'doc-a-1' },
					source: 'source-a',
					text: 'alpha one'
				},
				{
					chunkId: 'a-2',
					embedding: [1, 0],
					metadata: { documentId: 'doc-a-2' },
					source: 'source-a',
					text: 'alpha two'
				},
				{
					chunkId: 'b-1',
					embedding: [0, 1],
					metadata: { documentId: 'doc-b-1' },
					source: 'source-b',
					text: 'beta one'
				}
			]
		});

		const suite = createRAGEvaluationSuite({
			id: 'mmr-suite',
			input: {
				cases: [
					{
						expectedDocumentIds: ['doc-a-1', 'doc-b-1'],
						id: 'mmr-case',
						query: 'alpha beta',
						topK: 2
					}
				]
			},
			label: 'MMR Suite'
		});

		const comparison = await compareRAGRetrievalStrategies({
			collection,
			retrievals: [
				{ id: 'vector', retrieval: 'vector' },
				{
					id: 'mmr',
					retrieval: {
						mode: 'vector',
						diversityStrategy: 'mmr',
						mmrLambda: 0.5
					}
				}
			],
			suite
		});

		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'mmr')
				?.traceSummary?.stageCounts.diversity
		).toBe(1);
		expect(
			comparison.entries.find((entry) => entry.retrievalId === 'mmr')
				?.response.summary.passedCases
		).toBeGreaterThanOrEqual(
			comparison.entries.find((entry) => entry.retrievalId === 'vector')
				?.response.summary.passedCases ?? 0
		);
	});

	it('builds reusable comparison and history rows for trace-aware evaluation UIs', async () => {
		const comparison = await compareRAGRetrievalStrategies({
			collection: createRAGCollection({
				store: createInMemoryRAGStore({
					dimensions: 2,
					mockEmbedding: async (text) =>
						text.includes('sheet') ? [0, 1] : [1, 0]
				})
			}),
			retrievals: [
				{ id: 'vector', retrieval: 'vector' },
				{ id: 'hybrid', retrieval: 'hybrid' }
			],
			suite: createRAGEvaluationSuite({
				id: 'row-suite',
				input: {
					cases: [
						{
							expectedDocumentIds: ['sheet-doc'],
							id: 'sheet-case',
							query: 'regional growth sheet',
							topK: 1
						}
					]
				},
				label: 'Row Suite'
			})
		});
		const hybridEntry = comparison.entries.find(
			(entry) => entry.retrievalId === 'hybrid'
		);
		const vectorEntry = comparison.entries.find(
			(entry) => entry.retrievalId === 'vector'
		);
		expect(hybridEntry).toBeDefined();
		expect(vectorEntry).toBeDefined();
		if (!hybridEntry || !vectorEntry) {
			throw new Error('expected retrieval comparison entries');
		}

		const summaryRows = buildRAGComparisonTraceSummaryRows(hybridEntry);
		expect(summaryRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Balance' }),
				expect.objectContaining({ label: 'Lead cues' }),
				expect.objectContaining({ label: 'Lead media cues' }),
				expect.objectContaining({ label: 'Presentation cues' }),
				expect.objectContaining({ label: 'Multivector' }),
				expect.objectContaining({ label: 'Runtime' }),
				expect.objectContaining({
					label: 'Evidence reconcile (office/pdf)'
				}),
				expect.objectContaining({ label: 'SQLite planner cues' }),
				expect.objectContaining({ label: 'Postgres planner cues' }),
				expect.objectContaining({ label: 'Routing cues' }),
				expect.objectContaining({ label: 'Modes' }),
				expect.objectContaining({ label: 'Avg final' }),
				expect.objectContaining({ label: 'Stages' })
			])
		);
		const retrievalCards =
			buildRAGRetrievalComparisonPresentations(comparison);
		const retrievalOverview =
			buildRAGRetrievalComparisonOverviewPresentation(comparison);
		const hybridCard = retrievalCards.find(
			(entry: RAGComparisonPresentation) => entry.id === 'hybrid'
		);
		expect(hybridCard).toBeDefined();
		expect(hybridCard).toMatchObject({
			id: 'hybrid',
			label: hybridEntry.label
		});
		expect(hybridCard?.summary).toContain('passing');
		expect(hybridCard?.traceSummaryRows).toEqual(summaryRows);
		expect(retrievalOverview).toMatchObject({
			winnerLabel:
				comparison.entries.find(
					(entry) =>
						entry.retrievalId ===
						comparison.summary.bestByPassingRate
				)?.label ?? 'n/a'
		});
		expect(retrievalOverview.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Best passing rate' }),
				expect.objectContaining({ label: 'Best average F1' }),
				expect.objectContaining({ label: 'Fastest' }),
				expect.objectContaining({
					label: 'Lowest runtime budget exhaustion'
				}),
				expect.objectContaining({
					label: 'Lowest runtime underfilled TopK'
				})
			])
		);
		expect(buildRAGRetrievalOverviewPresentation(comparison).rows).toEqual(
			retrievalOverview.rows
		);

		const diffRows = buildRAGComparisonTraceDiffRows(
			vectorEntry,
			hybridEntry
		);
		expect(diffRows[0]).toMatchObject({ label: 'Baseline' });
		expect(diffRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Lead drift vs leader' }),
				expect.objectContaining({
					label: 'Lead media shift vs leader'
				}),
				expect.objectContaining({
					label: 'SQLite planner shift vs leader'
				}),
				expect.objectContaining({
					label: 'Runtime budget delta'
				}),
				expect.objectContaining({
					label: 'Runtime underfilled delta'
				}),
				expect.objectContaining({
					label: 'Postgres planner shift vs leader'
				}),
				expect.objectContaining({ label: 'Routing shift vs leader' })
			])
		);
		const rerankerCards = buildRAGRerankerComparisonPresentations({
			entries: [
				{
					...hybridEntry,
					label: 'Reranker A',
					rerankerId: 'reranker-a'
				},
				{
					...vectorEntry,
					label: 'Reranker B',
					rerankerId: 'reranker-b'
				}
			],
			summary: {
				bestByAverageF1: 'reranker-a',
				bestByPassingRate: 'reranker-a',
				fastest: 'reranker-b'
			},
			suiteId: 'row-suite',
			suiteLabel: 'Row Suite',
			leaderboard: []
		});
		const rerankerOverview = buildRAGRerankerComparisonOverviewPresentation(
			{
				entries: [
					{
						...hybridEntry,
						label: 'Reranker A',
						rerankerId: 'reranker-a'
					},
					{
						...vectorEntry,
						label: 'Reranker B',
						rerankerId: 'reranker-b'
					}
				],
				summary: {
					bestByAverageF1: 'reranker-a',
					bestByPassingRate: 'reranker-a',
					fastest: 'reranker-b'
				},
				suiteId: 'row-suite',
				suiteLabel: 'Row Suite',
				leaderboard: []
			}
		);
		expect(rerankerCards[1]).toMatchObject({
			id: 'reranker-b',
			label: 'Reranker B',
			diffLabel: 'Reranker A'
		});
		expect(rerankerCards[1]?.diffRows[0]).toMatchObject({
			label: 'Baseline'
		});
		expect(rerankerOverview).toMatchObject({
			winnerLabel: 'Reranker A'
		});
		expect(
			buildRAGRerankerOverviewPresentation({
				entries: [
					{
						...hybridEntry,
						label: 'Reranker A',
						rerankerId: 'reranker-a'
					},
					{
						...vectorEntry,
						label: 'Reranker B',
						rerankerId: 'reranker-b'
					}
				],
				summary: {
					bestByAverageF1: 'reranker-a',
					bestByPassingRate: 'reranker-a',
					fastest: 'reranker-b'
				},
				suiteId: 'row-suite',
				suiteLabel: 'Row Suite',
				leaderboard: []
			}).rows
		).toEqual(rerankerOverview.rows);

		const history = await loadRAGEvaluationHistory({
			store: {
				listRuns: () => [
					{
						elapsedMs: hybridEntry.response.elapsedMs,
						finishedAt: 2,
						id: 'hybrid-run',
						label: hybridEntry.label,
						response: hybridEntry.response,
						startedAt: 1,
						suiteId: 'row-suite',
						caseTraceSnapshots: hybridEntry.caseTraceSnapshots,
						traceSummary: hybridEntry.traceSummary
					},
					{
						elapsedMs: vectorEntry.response.elapsedMs,
						finishedAt: 1,
						id: 'vector-run',
						label: vectorEntry.label,
						response: vectorEntry.response,
						startedAt: 0,
						suiteId: 'row-suite',
						caseTraceSnapshots: vectorEntry.caseTraceSnapshots,
						traceSummary: vectorEntry.traceSummary
					}
				],
				saveRun: () => undefined
			},
			suite: {
				id: 'row-suite',
				input: { cases: [] },
				label: 'Row Suite'
			}
		});
		const historyRows = buildRAGEvaluationHistoryRows(history);
		expect(historyRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Latest' }),
				expect.objectContaining({ label: 'Latest trace' }),
				expect.objectContaining({ label: 'Lead media cues' }),
				expect.objectContaining({ label: 'Presentation cues' }),
				expect.objectContaining({ label: 'SQLite planner shift' }),
				expect.objectContaining({ label: 'Postgres planner shift' }),
				expect.objectContaining({
					label: 'Source regression hotspots'
				}),
				expect.objectContaining({
					label: 'Document regression hotspots'
				}),
				expect.objectContaining({ label: 'Trace routing shift' }),
				expect.objectContaining({ label: 'Trace mode shift' }),
				expect.objectContaining({ label: 'Lead drift' }),
				expect.objectContaining({ label: 'Trace drift cases' })
			])
		);
		const caseTracePresentations =
			buildRAGEvaluationCaseTracePresentations(history);
		expect(caseTracePresentations[0]).toMatchObject({
			caseId: 'sheet-case',
			label: 'sheet-case',
			traceChange: 'changed'
		});
		expect(caseTracePresentations[0]?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: 'Mode' }),
				expect.objectContaining({ label: 'Final' }),
				expect.objectContaining({ label: 'Lead context' }),
				expect.objectContaining({ label: 'Lead location' }),
				expect.objectContaining({ label: 'Lead media cues' }),
				expect.objectContaining({ label: 'Lead presentation cues' }),
				expect.objectContaining({ label: 'Chunk boundary' }),
				expect.objectContaining({ label: 'Source-aware scope' }),
				expect.objectContaining({ label: 'Stages' })
			])
		);
		expect(caseTracePresentations[0]?.summary).toContain('lead');
		const historyPresentation =
			buildRAGEvaluationHistoryPresentation(history);
		expect(historyPresentation.summary).toBe(hybridEntry.label);
		expect(historyPresentation.rows).toEqual(historyRows);
		expect(historyPresentation.caseTraces[0]?.caseId).toBe('sheet-case');
		expect(history.caseTraceSnapshots[0]?.caseId).toBe('sheet-case');
	});

	it('surfaces evidence reconcile shifts in evaluation history rows', () => {
		const historyRows = buildRAGEvaluationHistoryRows({
			caseTraceSnapshots: [],
			diff: {
				currentRunId: 'latest',
				improvedCases: [],
				previousRunId: 'previous',
				regressedCases: [],
				suiteId: 'evidence-reconcile-history',
				summaryDelta: {
					averageF1: 0,
					averageLatencyMs: 0,
					failedCases: 0,
					partialCases: 0,
					passedCases: 0,
					passingRate: 0
				},
				traceLeadChanges: [],
				traceSummaryDelta: {
					averageCandidateTopK: 0,
					averageFinalCount: 0,
					averageLexicalCount: 0,
					averageLexicalTopK: 0,
					averageVectorCount: 0,
					balancedCases: 0,
					lexicalCases: 0,
					modesChanged: false,
					officeEvidenceReconcileCasesDelta: 1,
					officeParagraphEvidenceReconcileCasesDelta: 1,
					officeListEvidenceReconcileCasesDelta: 0,
					officeTableEvidenceReconcileCasesDelta: 0,
					pdfEvidenceReconcileCasesDelta: 0,
					roundRobinCases: 0,
					sourceBalanceStrategiesChanged: false,
					stageCounts: {
						evidence_reconcile: 1
					},
					transformedCases: 0,
					variantCases: 0,
					vectorCases: 0
				},
				unchangedCases: []
			},
			latestRun: {
				id: 'latest',
				label: 'Latest run',
				response: {
					summary: {
						averageF1: 1,
						averageLatencyMs: 12,
						averagePrecision: 1,
						averageRecall: 1,
						failedCases: 0,
						passedCases: 1,
						passingRate: 100
					}
				},
				traceSummary: {
					averageCandidateTopK: 4,
					averageFinalCount: 1,
					averageLexicalCount: 1,
					averageLexicalTopK: 4,
					averageVectorCount: 1,
					balancedCases: 0,
					lexicalCases: 1,
					modes: ['hybrid'],
					roundRobinCases: 0,
					runtimeCandidateBudgetExhaustedCases: 0,
					runtimeUnderfilledTopKCases: 0,
					sourceBalanceStrategies: ['cap'],
					stageCounts: {},
					totalCases: 1,
					transformedCases: 0,
					variantCases: 0,
					vectorCases: 1
				}
			} as any,
			previousRun: undefined,
			runs: []
		} as any);

		expect(historyRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'Trace evidence reconcile delta (all)',
					value: '+1'
				}),
				expect.objectContaining({
					label: 'Trace office reconcile deltas',
					value: 'narrative=+1, checklist=+0, table=+0'
				}),
				expect.objectContaining({
					label: 'Trace office narrative evidence reconcile delta',
					value: '+1'
				}),
				expect.objectContaining({
					label: 'Trace office checklist evidence reconcile delta',
					value: '+0'
				}),
				expect.objectContaining({
					label: 'Trace office table evidence reconcile delta',
					value: '+0'
				})
			])
		);
	});

	it('lets first-party query transforms improve evaluation outcomes', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('workbook') ? [0, 1] : [1, 0]
		});
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			rerank: createHeuristicRAGReranker(),
			store
		});
		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic retrieval note.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: {
						documentId: 'target',
						sheetName: 'Regional Growth'
					},
					source: 'files/revenue-forecast.xlsx',
					text: 'Spreadsheet workbook.'
				}
			]
		});

		const response = await evaluateRAGCollection({
			collection,
			input: {
				cases: [
					{
						expectedDocumentIds: ['target'],
						id: 'query-transform-target',
						query: 'regional growth sheet',
						topK: 1
					}
				]
			}
		});

		expect(response.summary.passedCases).toBe(1);
	});

	it('uses media segment duration metadata for continuous/long timeline reranking decisions', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-short',
					embedding: [1, 0],
					metadata: {
						documentId: 'short',
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 3000,
						mediaSegmentGapFromPreviousMs: 8000,
						mediaSegmentGroupStartMs: 0,
						mediaSegmentGroupEndMs: 3000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/standup.mp3',
					text: 'Audio segment at timestamp 00:00.000 to 00:03.000 says review the workflow stays aligned.'
				},
				{
					chunkId: 'media-long',
					embedding: [1, 0],
					metadata: {
						documentId: 'long',
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 15000,
						mediaSegmentGapFromPreviousMs: 0,
						mediaSegmentGroupStartMs: 10000,
						mediaSegmentGroupEndMs: 25000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/standup.mp3',
					text: 'Audio segment at timestamp 00:10.000 to 00:25.000 says review the workflow stays aligned.'
				}
			]
		});

		const longQuery = await collection.search({
			query: 'Which continuous audio timestamp has the long duration and no gap where review happens?'
		});
		expect(longQuery[0]?.chunkId).toBe('media-long');

		const shortQuery = await collection.search({
			query: 'Which short-duration timestamp says review with duration?'
		});
		expect(shortQuery[0]?.chunkId).toBe('media-short');
	});

	it('uses media segment gap metadata for continuity-focused reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-gapless',
					embedding: [1, 0],
					metadata: {
						documentId: 'gapless',
						fileKind: 'media',
						mediaKind: 'video',
						mediaSegmentGroupDurationMs: 8000,
						mediaSegmentGapFromPreviousMs: 0,
						mediaSegmentGroupStartMs: 0,
						mediaSegmentGroupEndMs: 8000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.mp4',
					text: 'Video segment at timestamp 00:00.000 to 00:08.000 says the timeline is continuous.'
				},
				{
					chunkId: 'media-gapped',
					embedding: [1, 0],
					metadata: {
						documentId: 'gapped',
						fileKind: 'media',
						mediaKind: 'video',
						mediaSegmentGroupDurationMs: 8000,
						mediaSegmentGapFromPreviousMs: 2500,
						mediaSegmentGroupStartMs: 10000,
						mediaSegmentGroupEndMs: 18000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.mp4',
					text: 'Video segment at timestamp 00:10.000 to 00:18.000 says the timeline is continuous.'
				}
			]
		});

		const gapQuery = await collection.search({
			query: 'Which continuous media segment has no gap between segments in this timeline?'
		});

		expect(gapQuery[0]?.chunkId).toBe('media-gapless');
	});

	it('does not reward malformed media timing metadata in continuity reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-malformed',
					embedding: [1, 0],
					metadata: {
						documentId: 'bad',
						fileKind: 'media',
						mediaKind: 'video',
						mediaSegmentGroupDurationMs: undefined,
						mediaSegmentGapFromPreviousMs: undefined,
						mediaSegmentGroupStartMs: undefined,
						mediaSegmentGroupEndMs: undefined,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.mp4',
					text: 'Timeline continuity is checked in this malformed media segment.'
				},
				{
					chunkId: 'media-valid',
					embedding: [1, 0],
					metadata: {
						documentId: 'good',
						fileKind: 'media',
						mediaKind: 'video',
						mediaSegmentGroupDurationMs: 12000,
						mediaSegmentGapFromPreviousMs: 0,
						mediaSegmentGroupStartMs: 0,
						mediaSegmentGroupEndMs: 12000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.mp4',
					text: 'Timeline continuity is checked in this valid media segment.'
				}
			]
		});

		const continuityQuery = await collection.search({
			query: 'Which long continuous media segment has no gap and has a long duration?'
		});

		expect(continuityQuery[0]?.chunkId).toBe('media-valid');
	});

	it('does not reward overlapping media windows as gapless continuity', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-overlap',
					embedding: [1, 0],
					metadata: {
						documentId: 'overlap',
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 12000,
						mediaSegmentGapFromPreviousMs: undefined,
						mediaSegmentGroupStartMs: 6000,
						mediaSegmentGroupEndMs: 18000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.m4a',
					text: 'Timeline continuity is checked in this overlapping media segment.'
				},
				{
					chunkId: 'media-gapless',
					embedding: [1, 0],
					metadata: {
						documentId: 'gapless',
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 12000,
						mediaSegmentGapFromPreviousMs: 0,
						mediaSegmentGroupStartMs: 18000,
						mediaSegmentGroupEndMs: 30000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.m4a',
					text: 'Timeline continuity is checked in this gapless media segment.'
				}
			]
		});

		const continuityQuery = await collection.search({
			query: 'Which long continuous media segment has no gap in the timeline?'
		});

		expect(continuityQuery[0]?.chunkId).toBe('media-gapless');
	});

	it('does not reward non-finite media timing metadata in continuity reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-non-finite',
					embedding: [1, 0],
					metadata: {
						documentId: 'non-finite',
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: Number.NaN,
						mediaSegmentGapFromPreviousMs: Number.POSITIVE_INFINITY,
						mediaSegmentGroupStartMs: Number.NEGATIVE_INFINITY,
						mediaSegmentGroupEndMs: Number.NaN,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.m4a',
					text: 'Timeline continuity is checked in this non-finite media segment.'
				},
				{
					chunkId: 'media-valid',
					embedding: [1, 0],
					metadata: {
						documentId: 'good',
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 12000,
						mediaSegmentGapFromPreviousMs: 0,
						mediaSegmentGroupStartMs: 0,
						mediaSegmentGroupEndMs: 12000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/recording.m4a',
					text: 'Timeline continuity is checked in this valid media segment.'
				}
			]
		});

		const continuityQuery = await collection.search({
			query: 'Which long continuous media segment has no gap and has a long duration?'
		});

		expect(continuityQuery[0]?.chunkId).toBe('media-valid');
	});
});
