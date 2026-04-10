import { derived, writable } from 'svelte/store';
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

export const createRAGEvaluate = (path: string) => {
	const client = createRAGClient({ path });
	const error = writable<string | null>(null);
	const isEvaluating = writable(false);
	const suites = writable<RAGEvaluationSuite[]>([]);
	const suiteRuns = writable<RAGEvaluationSuiteRun[]>([]);
	const lastRequest = writable<RAGEvaluationInput | null>(null);
	const lastResponse = writable<RAGEvaluationResponse | null>(null);

	const evaluate = async (input: RAGEvaluationInput) => {
		isEvaluating.set(true);
		error.set(null);
		lastRequest.set(input);

		try {
			const response = await client.evaluate(input);
			lastResponse.set(response);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isEvaluating.set(false);
		}
	};

	const saveSuite = (suite: RAGEvaluationSuite) => {
		suites.update((current) => [
			...current.filter((entry) => entry.id !== suite.id),
			suite
		]);

		return suite;
	};

	const removeSuite = (id: string) => {
		suites.update((current) => current.filter((suite) => suite.id !== id));
	};

	const runSuite = async (
		suite: RAGEvaluationSuite,
		overrides?: Partial<RAGEvaluationInput>
	) => {
		isEvaluating.set(true);
		error.set(null);
		lastRequest.set(
			overrides ? { ...suite.input, ...overrides } : suite.input
		);

		try {
			const run = await runRAGEvaluationSuite({
				evaluate: client.evaluate,
				overrides,
				suite
			});
			lastResponse.set(run.response);
			suiteRuns.update((current) => [run, ...current]);

			return run;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isEvaluating.set(false);
		}
	};

	const clearRuns = () => {
		suiteRuns.set([]);
	};

	const leaderboard = derived(suiteRuns, ($suiteRuns) =>
		buildRAGEvaluationLeaderboard($suiteRuns)
	);

	const reset = () => {
		error.set(null);
		lastRequest.set(null);
		lastResponse.set(null);
		suiteRuns.set([]);
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

export type CreateRAGEvaluateResult = ReturnType<typeof createRAGEvaluate>;
