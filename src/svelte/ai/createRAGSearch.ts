import { writable } from 'svelte/store';
import type { RAGSearchRequest, RAGSource } from '../../../types/ai';
import {
	createRAGClient,
	type RAGDetailedSearchResponse
} from '../../ai/client/ragClient';

type SearchRequest = Omit<RAGSearchRequest, 'includeTrace'>;

export const createRAGSearch = (path: string) => {
	const client = createRAGClient({ path });
	const results = writable<RAGSource[]>([]);
	const trace = writable<RAGDetailedSearchResponse['trace'] | undefined>(
		undefined
	);
	const error = writable<string | null>(null);
	const isSearching = writable(false);
	const hasSearched = writable(false);
	const lastRequest = writable<RAGSearchRequest | null>(null);

	const search = async (input: SearchRequest) => {
		isSearching.set(true);
		error.set(null);
		lastRequest.set(input);

		try {
			const nextResults = await client.search<false>({
				...input,
				includeTrace: false
			});
			results.set(nextResults);
			trace.set(undefined);
			hasSearched.set(true);

			return nextResults;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isSearching.set(false);
		}
	};

	const searchWithTrace = async (input: SearchRequest) => {
		isSearching.set(true);
		error.set(null);
		lastRequest.set(input);

		try {
			const response = await client.searchWithTrace(input);
			results.set(response.results);
			trace.set(response.trace);
			hasSearched.set(true);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isSearching.set(false);
		}
	};

	const reset = () => {
		error.set(null);
		hasSearched.set(false);
		isSearching.set(false);
		lastRequest.set(null);
		results.set([]);
		trace.set(undefined);
	};

	return {
		error,
		hasSearched,
		isSearching,
		lastRequest,
		reset,
		results,
		search,
		searchWithTrace,
		trace
	};
};
