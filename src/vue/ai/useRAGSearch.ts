import { ref } from 'vue';
import type { RAGSearchRequest, RAGSource } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGSearch = (path: string) => {
	const client = createRAGClient({ path });
	const results = ref<RAGSource[]>([]);
	const error = ref<string | null>(null);
	const isSearching = ref(false);
	const hasSearched = ref(false);
	const lastRequest = ref<RAGSearchRequest | null>(null);

	const search = async (input: RAGSearchRequest) => {
		isSearching.value = true;
		error.value = null;
		lastRequest.value = input;

		try {
			const nextResults = await client.search(input);
			results.value = nextResults;
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

	const reset = () => {
		error.value = null;
		hasSearched.value = false;
		isSearching.value = false;
		lastRequest.value = null;
		results.value = [];
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
