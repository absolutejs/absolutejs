import { ref } from 'vue';
import type { RAGDocumentChunkPreview } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGChunkPreview = (path: string) => {
	const client = createRAGClient({ path });
	const preview = ref<RAGDocumentChunkPreview | null>(null);
	const error = ref<string | null>(null);
	const isLoading = ref(false);

	const inspect = async (id: string) => {
		isLoading.value = true;
		error.value = null;

		try {
			const response = await client.documentChunks(id);
			if (!response.ok) {
				throw new Error(response.error);
			}

			preview.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isLoading.value = false;
		}
	};

	const clear = () => {
		error.value = null;
		isLoading.value = false;
		preview.value = null;
	};

	return {
		clear,
		error,
		inspect,
		isLoading,
		preview
	};
};

export type UseRAGChunkPreviewResult = ReturnType<typeof useRAGChunkPreview>;
