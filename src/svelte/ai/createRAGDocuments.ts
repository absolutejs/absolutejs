import { writable } from 'svelte/store';
import type {
	RAGDocumentsResponse,
	RAGIndexedDocument
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGDocuments = (path: string) => {
	const client = createRAGClient({ path });
	const documents = writable<RAGIndexedDocument[]>([]);
	const error = writable<string | null>(null);
	const isLoading = writable(false);
	const lastResponse = writable<RAGDocumentsResponse | null>(null);

	const load = async (kind?: string) => {
		isLoading.set(true);
		error.set(null);

		try {
			const response = await client.documents(kind);
			documents.set(response.documents);
			lastResponse.set(response);

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

	const reset = () => {
		documents.set([]);
		error.set(null);
		isLoading.set(false);
		lastResponse.set(null);
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

export type CreateRAGDocumentsResult = ReturnType<typeof createRAGDocuments>;
