import { writable } from 'svelte/store';
import type { RAGSearchRequest, RAGSource } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGSearch = (path: string) => {
	const client = createRAGClient({ path });
	const results = writable<RAGSource[]>([]);
	const error = writable<string | null>(null);
	const isSearching = writable(false);
	const hasSearched = writable(false);
	const lastRequest = writable<RAGSearchRequest | null>(null);

	const search = async (input: RAGSearchRequest) => {
		isSearching.set(true);
		error.set(null);
		lastRequest.set(input);

		try {
			const nextResults = await client.search(input);
			results.set(nextResults);
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

	const reset = () => {
		error.set(null);
		hasSearched.set(false);
		isSearching.set(false);
		lastRequest.set(null);
		results.set([]);
	};

	return {
		error,
		hasSearched,
		isSearching,
		lastRequest,
		reset,
		results,
		search
	};
};
