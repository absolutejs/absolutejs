import { useCallback, useMemo, useState } from 'react';
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
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [error, setError] = useState<string | null>(null);
	const [isEvaluating, setIsEvaluating] = useState(false);
	const [suites, setSuites] = useState<RAGEvaluationSuite[]>([]);
	const [suiteRuns, setSuiteRuns] = useState<RAGEvaluationSuiteRun[]>([]);
	const [lastRequest, setLastRequest] = useState<RAGEvaluationInput | null>(
		null
	);
	const [lastResponse, setLastResponse] =
		useState<RAGEvaluationResponse | null>(null);

	const evaluate = useCallback(
		async (input: RAGEvaluationInput) => {
			setIsEvaluating(true);
			setError(null);
			setLastRequest(input);

			try {
				const response = await client.evaluate(input);
				setLastResponse(response);

				return response;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsEvaluating(false);
			}
		},
		[client]
	);

	const saveSuite = useCallback((suite: RAGEvaluationSuite) => {
		setSuites((current) => {
			const next = current.filter((entry) => entry.id !== suite.id);
			next.push(suite);

			return next;
		});

		return suite;
	}, []);

	const removeSuite = useCallback((id: string) => {
		setSuites((current) => current.filter((suite) => suite.id !== id));
	}, []);

	const runSuite = useCallback(
		async (
			suite: RAGEvaluationSuite,
			overrides?: Partial<RAGEvaluationInput>
		) => {
			setIsEvaluating(true);
			setError(null);
			setLastRequest(
				overrides ? { ...suite.input, ...overrides } : suite.input
			);

			try {
				const run = await runRAGEvaluationSuite({
					evaluate: client.evaluate,
					overrides,
					suite
				});
				setLastResponse(run.response);
				setSuiteRuns((current) => [run, ...current]);

				return run;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsEvaluating(false);
			}
		},
		[client]
	);

	const clearRuns = useCallback(() => {
		setSuiteRuns([]);
	}, []);

	const leaderboard = useMemo(
		() => buildRAGEvaluationLeaderboard(suiteRuns),
		[suiteRuns]
	);

	const reset = () => {
		setError(null);
		setLastRequest(null);
		setLastResponse(null);
		setSuiteRuns([]);
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
