import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
	RAGEvaluationCase,
	RAGEvaluationCaseDiff,
	RAGEvaluationCaseResult,
	RAGEvaluationHistory,
	RAGEvaluationHistoryStore,
	RAGEvaluationInput,
	RAGEvaluationLeaderboardEntry,
	RAGEvaluationResponse,
	RAGEvaluationRunDiff,
	RAGEvaluationSuite,
	RAGEvaluationSuiteRun,
	RAGHybridRetrievalMode,
	RAGRetrievalCandidate,
	RAGRetrievalComparison,
	RAGRetrievalComparisonEntry,
	RAGRetrievalComparisonSummary,
	RAGRerankerCandidate,
	RAGRerankerComparison,
	RAGRerankerComparisonEntry,
	RAGRerankerComparisonSummary,
	RAGRerankerProviderLike,
	RAGSource
} from '../../../types/ai';
import { generateId } from '../protocol';
import { buildRAGGroundedAnswer } from './presentation';

const DEFAULT_TOP_K = 6;
const DEFAULT_HISTORY_LIMIT = 20;

const normalizeStringArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((candidate) => typeof candidate === 'string')
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0);
};

const normalizeExpectedIds = (input: string[]) =>
	Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)));

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

const toGroundingHistorySortOrder = (
	left: RAGAnswerGroundingEvaluationRun,
	right: RAGAnswerGroundingEvaluationRun
) => right.finishedAt - left.finishedAt;

const normalizeGroundingHistoryRuns = (
	runs: RAGAnswerGroundingEvaluationRun[]
) => [...runs].sort(toGroundingHistorySortOrder);

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
	query: currentCase.query
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
	previousMatchedIds: previousCase?.matchedIds ?? [],
	previousMissingIds: previousCase?.missingIds ?? [],
	previousReferenceCount: previousCase?.referenceCount,
	previousResolvedCitationCount: previousCase?.resolvedCitationCount,
	previousStatus: previousCase?.status,
	previousUngroundedReferenceNumbers:
		previousCase?.groundedAnswer.ungroundedReferenceNumbers ?? [],
	previousUnresolvedCitationCount: previousCase?.unresolvedCitationCount,
	query: currentCase.query
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

const getStatusRank = (status: RAGEvaluationCaseResult['status']) =>
	status === 'pass' ? 2 : status === 'partial' ? 1 : 0;

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

	return {
		currentRunId: current.id,
		improvedCases,
		previousRunId: previous?.id,
		regressedCases,
		suiteId: current.suiteId,
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
	}
});

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
export const buildRAGEvaluationResponse = (
	cases: RAGEvaluationCaseResult[]
): RAGEvaluationResponse => {
	const totalCases = cases.length;
	const passedCases = cases.filter((entry) => entry.status === 'pass').length;
	const partialCases = cases.filter(
		(entry) => entry.status === 'partial'
	).length;
	const failedCases = cases.filter((entry) => entry.status === 'fail').length;

	return {
		cases,
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
			const response = await evaluateRAGCollection({
				collection,
				defaultTopK,
				input: suite.input,
				rerank: candidate.rerank
			});

			return {
				label: candidate.label ?? candidate.id,
				providerName:
					typeof candidate.rerank === 'function'
						? undefined
						: candidate.rerank?.providerName,
				response,
				rerankerId: candidate.id
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
			suiteId: suite.id
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
			const response = await evaluateRAGCollection({
				collection: {
					...collection,
					search: (input) =>
						collection.search({
							...input,
							queryTransform:
								candidate.queryTransform ??
								input.queryTransform,
							rerank: candidate.rerank ?? input.rerank,
							retrieval: candidate.retrieval ?? input.retrieval
						})
				},
				defaultTopK,
				input: suite.input,
				rerank: candidate.rerank
			});

			return {
				label: candidate.label ?? candidate.id,
				response,
				retrievalId: candidate.id,
				retrievalMode: resolveRetrievalMode(candidate)
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
			suiteId: suite.id
		}))
	);

	return {
		entries,
		leaderboard,
		summary: summarizeRAGRetrievalComparison(entries),
		suiteId: suite.id,
		suiteLabel: suite.label ?? suite.id
	};
};
export const createRAGEvaluationSuite = (
	suite: RAGEvaluationSuite
): RAGEvaluationSuite => suite;
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
	if (input.dryRun) {
		return buildRAGEvaluationResponse(
			executeDryRunRAGEvaluation(input, defaultTopK)
		);
	}

	const evaluated = await Promise.all(
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
			const searchResults = await collection.search({
				filter:
					typeof caseInput.filter === 'object'
						? caseInput.filter
						: input.filter,
				model: caseInput.model ?? input.model,
				query,
				rerank,
				scoreThreshold:
					typeof caseInput.scoreThreshold === 'number'
						? caseInput.scoreThreshold
						: input.scoreThreshold,
				topK
			});
			const sources = buildSources(searchResults);
			const elapsedMs = Date.now() - startedAt;
			const retrievedIds = normalizeExpectedIds(
				sources.map((source) => extractExpectedId(source, mode))
			);

			return summarizeRAGEvaluationCase({
				caseIndex,
				caseInput: { ...caseInput, topK },
				elapsedMs,
				expectedIds,
				mode,
				query,
				retrievedIds
			});
		})
	);

	return buildRAGEvaluationResponse(evaluated);
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
	overrides
}: {
	suite: RAGEvaluationSuite;
	evaluate: (input: RAGEvaluationInput) => Promise<RAGEvaluationResponse>;
	overrides?: Partial<RAGEvaluationInput>;
}) => {
	const startedAt = Date.now();
	const response = await evaluate({
		...suite.input,
		...overrides,
		cases: overrides?.cases ?? suite.input.cases
	});
	const finishedAt = Date.now();

	return {
		elapsedMs: finishedAt - startedAt,
		finishedAt,
		id: generateId(),
		label: suite.label ?? suite.id,
		metadata: suite.metadata,
		response,
		startedAt,
		suiteId: suite.id
	} satisfies RAGEvaluationSuiteRun;
};
export const summarizeRAGEvaluationCase = ({
	caseIndex,
	caseInput,
	query,
	mode,
	retrievedIds,
	expectedIds,
	elapsedMs
}: {
	caseIndex: number;
	caseInput: RAGEvaluationCase;
	mode: 'chunkId' | 'source' | 'documentId';
	query: string;
	retrievedIds: string[];
	expectedIds: string[];
	elapsedMs: number;
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
		elapsedMs,
		expectedCount,
		expectedIds,
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
): RAGRetrievalComparisonSummary =>
	summarizeEvaluationResponseComparison(
		entries,
		'retrievalId'
	) satisfies RAGRetrievalComparisonSummary;
