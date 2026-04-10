import { useCallback, useMemo, useState } from 'react';
import type { RAGSearchRequest, RAGSource } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGSearch = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [results, setResults] = useState<RAGSource[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	const [hasSearched, setHasSearched] = useState(false);
	const [lastRequest, setLastRequest] = useState<RAGSearchRequest | null>(
		null
	);

	const search = useCallback(
		async (input: RAGSearchRequest) => {
			setIsSearching(true);
			setError(null);
			setLastRequest(input);

			try {
				const nextResults = await client.search(input);
				setResults(nextResults);
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

	const reset = useCallback(() => {
		setError(null);
		setHasSearched(false);
		setLastRequest(null);
		setResults([]);
	}, []);

	return {
		error,
		hasSearched,
		isSearching,
		lastRequest,
		reset,
		results,
		search,
		setResults
	};
};

export type UseRAGSearchResult = ReturnType<typeof useRAGSearch>;
