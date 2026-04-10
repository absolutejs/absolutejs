import { computed, ref } from 'vue';
import type {
	RAGEvaluationInput,
	RAGEvaluationResponse,
	RAGEvaluationSuite,
	RAGEvaluationSuiteRun
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';
import {
	buildRAGEvaluationLeaderboard,
	runRAGEvaluationSuite
} from '../../ai/rag/quality';

export const useRAGEvaluate = (path: string) => {
	const client = createRAGClient({ path });
	const error = ref<string | null>(null);
	const isEvaluating = ref(false);
	const suites = ref<RAGEvaluationSuite[]>([]);
	const suiteRuns = ref<RAGEvaluationSuiteRun[]>([]);
	const lastRequest = ref<RAGEvaluationInput | null>(null);
	const lastResponse = ref<RAGEvaluationResponse | null>(null);

	const evaluate = async (input: RAGEvaluationInput) => {
		isEvaluating.value = true;
		error.value = null;
		lastRequest.value = input;

		try {
			const response = await client.evaluate(input);
			lastResponse.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isEvaluating.value = false;
		}
	};

	const saveSuite = (suite: RAGEvaluationSuite) => {
		suites.value = [
			...suites.value.filter((entry) => entry.id !== suite.id),
			suite
		];

		return suite;
	};

	const removeSuite = (id: string) => {
		suites.value = suites.value.filter((suite) => suite.id !== id);
	};

	const runSuite = async (
		suite: RAGEvaluationSuite,
		overrides?: Partial<RAGEvaluationInput>
	) => {
		isEvaluating.value = true;
		error.value = null;
		lastRequest.value = overrides
			? { ...suite.input, ...overrides }
			: suite.input;

		try {
			const run = await runRAGEvaluationSuite({
				evaluate: client.evaluate,
				overrides,
				suite
			});
			lastResponse.value = run.response;
			suiteRuns.value = [run, ...suiteRuns.value];

			return run;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isEvaluating.value = false;
		}
	};

	const clearRuns = () => {
		suiteRuns.value = [];
	};

	const leaderboard = computed(() =>
		buildRAGEvaluationLeaderboard(suiteRuns.value)
	);

	const reset = () => {
		error.value = null;
		lastRequest.value = null;
		lastResponse.value = null;
		suiteRuns.value = [];
	};

	return {
		clearRuns,
		error,
		evaluate,
		isEvaluating,
		lastRequest,
		lastResponse,
		leaderboard,
		removeSuite,
		reset,
		runSuite,
		saveSuite,
		suiteRuns,
		suites
	};
};

export type UseRAGEvaluateResult = ReturnType<typeof useRAGEvaluate>;
