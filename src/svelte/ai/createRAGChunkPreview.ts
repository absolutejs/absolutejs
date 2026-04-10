import { writable } from 'svelte/store';
import type { RAGDocumentChunkPreview } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGChunkPreview = (path: string) => {
	const client = createRAGClient({ path });
	const preview = writable<RAGDocumentChunkPreview | null>(null);
	const error = writable<string | null>(null);
	const isLoading = writable(false);

	const inspect = async (id: string) => {
		isLoading.set(true);
		error.set(null);

		try {
			const response = await client.documentChunks(id);
			if (!response.ok) {
				throw new Error(response.error);
			}

			preview.set(response);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isLoading.set(false);
		}
	};

	const clear = () => {
		error.set(null);
		isLoading.set(false);
		preview.set(null);
	};

	return {
		clear,
		error,
		inspect,
		isLoading,
		preview
	};
};

export type CreateRAGChunkPreviewResult = ReturnType<
	typeof createRAGChunkPreview
>;
