import { ref } from 'vue';
import type { RAGSearchRequest, RAGSource } from '../../../types/ai';
import {
	createRAGClient,
	type RAGDetailedSearchResponse
} from '../../ai/client/ragClient';

type SearchRequest = Omit<RAGSearchRequest, 'includeTrace'>;

export const useRAGSearch = (path: string) => {
	const client = createRAGClient({ path });
	const results = ref<RAGSource[]>([]);
	const trace = ref<RAGDetailedSearchResponse['trace'] | undefined>();
	const error = ref<string | null>(null);
	const isSearching = ref(false);
	const hasSearched = ref(false);
	const lastRequest = ref<RAGSearchRequest | null>(null);

	const search = async (input: SearchRequest) => {
		isSearching.value = true;
		error.value = null;
		lastRequest.value = input;

		try {
			const nextResults = await client.search<false>({
				...input,
				includeTrace: false
			});
			results.value = nextResults;
			trace.value = undefined;
			hasSearched.value = true;

			return nextResults;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isSearching.value = false;
		}
	};

	const searchWithTrace = async (input: SearchRequest) => {
		isSearching.value = true;
		error.value = null;
		lastRequest.value = input;

		try {
			const response = await client.searchWithTrace(input);
			results.value = response.results;
			trace.value = response.trace;
			hasSearched.value = true;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isSearching.value = false;
		}
	};

	const reset = () => {
		error.value = null;
		hasSearched.value = false;
		isSearching.value = false;
		lastRequest.value = null;
		results.value = [];
		trace.value = undefined;
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
