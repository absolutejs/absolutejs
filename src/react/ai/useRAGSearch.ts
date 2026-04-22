import { useCallback, useMemo, useState } from 'react';
import type { RAGSearchRequest, RAGSource } from '../../../types/ai';
import {
	createRAGClient,
	type RAGDetailedSearchResponse
} from '../../ai/client/ragClient';

type SearchRequest = Omit<RAGSearchRequest, 'includeTrace'>;

export const useRAGSearch = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [results, setResults] = useState<RAGSource[]>([]);
	const [trace, setTrace] = useState<
		RAGDetailedSearchResponse['trace'] | undefined
	>();
	const [error, setError] = useState<string | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	const [hasSearched, setHasSearched] = useState(false);
	const [lastRequest, setLastRequest] = useState<RAGSearchRequest | null>(
		null
	);

	const search = useCallback(
		async (input: SearchRequest) => {
			setIsSearching(true);
			setError(null);
			setLastRequest(input);

			try {
				const nextResults = await client.search<false>({
					...input,
					includeTrace: false
				});
				setResults(nextResults);
				setTrace(undefined);
				setHasSearched(true);

				return nextResults;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsSearching(false);
			}
		},
		[client]
	);

	const searchWithTrace = useCallback(
		async (input: SearchRequest) => {
			setIsSearching(true);
			setError(null);
			setLastRequest(input);

			try {
				const response = await client.searchWithTrace(input);
				setResults(response.results);
				setTrace(response.trace);
				setHasSearched(true);

				return response;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsSearching(false);
			}
		},
		[client]
	);

	const reset = useCallback(() => {
		setError(null);
		setHasSearched(false);
		setLastRequest(null);
		setResults([]);
		setTrace(undefined);
	}, []);

	return {
		error,
		hasSearched,
		isSearching,
		lastRequest,
		reset,
		results,
		search,
		searchWithTrace,
		setResults,
		trace
	};
};

export type UseRAGSearchResult = ReturnType<typeof useRAGSearch>;
