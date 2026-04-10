import { ref } from 'vue';
import type {
	RAGDocumentsResponse,
	RAGIndexedDocument
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGDocuments = (path: string) => {
	const client = createRAGClient({ path });
	const documents = ref<RAGIndexedDocument[]>([]);
	const error = ref<string | null>(null);
	const isLoading = ref(false);
	const lastResponse = ref<RAGDocumentsResponse | null>(null);

	const load = async (kind?: string) => {
		isLoading.value = true;
		error.value = null;

		try {
			const response = await client.documents(kind);
			documents.value = response.documents;
			lastResponse.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isLoading.value = false;
		}
	};

	const reset = () => {
		documents.value = [];
		error.value = null;
		isLoading.value = false;
		lastResponse.value = null;
	};

	return {
		documents,
		error,
		isLoading,
		lastResponse,
		load,
		reset
	};
};

export type UseRAGDocumentsResult = ReturnType<typeof useRAGDocuments>;
