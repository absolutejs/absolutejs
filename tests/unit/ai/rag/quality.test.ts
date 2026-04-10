import { afterEach, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import {
	buildRAGAnswerGroundingCaseDifficultyLeaderboard,
	buildRAGAnswerGroundingCaseDifficultyRunDiff,
	buildRAGAnswerGroundingEvaluationResponse,
	buildRAGAnswerGroundingEvaluationLeaderboard,
	buildRAGAnswerGroundingEvaluationRunDiff,
	buildRAGEvaluationLeaderboard,
	buildRAGEvaluationResponse,
	buildRAGEvaluationRunDiff,
	compareRAGRetrievalStrategies,
	createHeuristicRAGQueryTransform,
	compareRAGRerankers,
	createHeuristicRAGReranker,
	createRAGCollection,
	createRAGFileAnswerGroundingCaseDifficultyHistoryStore,
	createRAGFileAnswerGroundingEvaluationHistoryStore,
	createRAGFileEvaluationHistoryStore,
	createRAGEvaluationSuite,
	evaluateRAGAnswerGroundingCase,
	evaluateRAGCollection,
	loadRAGAnswerGroundingCaseDifficultyHistory,
	loadRAGAnswerGroundingEvaluationHistory,
	loadRAGEvaluationHistory,
	persistRAGAnswerGroundingCaseDifficultyRun,
	persistRAGAnswerGroundingEvaluationRun,
	persistRAGEvaluationSuiteRun,
	runRAGEvaluationSuite
} from '../../../../src/ai';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';

const tempPaths = new Set<string>();

afterEach(() => {
	for (const path of tempPaths) {
		rmSync(path, { force: true });
	}
	tempPaths.clear();
});

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
		const previousRun = await runRAGEvaluationSuite({
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
		const currentRun = await runRAGEvaluationSuite({
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
		const diff = buildRAGEvaluationRunDiff({
			current: currentRun,
			previous: previousRun
		});
		expect(diff.improvedCases).toHaveLength(1);
		expect(diff.regressedCases).toHaveLength(0);
		expect(diff.summaryDelta.passingRate).toBe(100);

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
			comparison.entries.find((entry) => entry.retrievalId === 'hybrid')
				?.response.summary.passedCases
		).toBe(1);
		expect(comparison.leaderboard[0]).toMatchObject({
			label: 'hybrid',
			rank: 1,
			runId: 'hybrid'
		});
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
});
