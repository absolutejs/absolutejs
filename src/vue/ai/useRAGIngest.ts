import { ref } from 'vue';
import type {
	RAGDocumentChunk,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGIngestResponse
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGIngest = (path: string) => {
	const client = createRAGClient({ path });
	const error = ref<string | null>(null);
	const isIngesting = ref(false);
	const lastIngestCount = ref<number | null>(null);
	const lastDocumentCount = ref<number | null>(null);
	const lastResponse = ref<RAGIngestResponse | null>(null);

	const ingestChunks = async (chunks: RAGDocumentChunk[]) => {
		isIngesting.value = true;
		error.value = null;

		try {
			const response = await client.ingest(chunks);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG ingest failed');
			}

			lastIngestCount.value = response.count ?? chunks.length;
			lastDocumentCount.value = null;
			lastResponse.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isIngesting.value = false;
		}
	};

	const ingestDocuments = async (input: RAGDocumentIngestInput) => {
		isIngesting.value = true;
		error.value = null;

		try {
			const response = await client.ingestDocuments(input);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG document ingest failed');
			}

			lastDocumentCount.value =
				response.documentCount ?? input.documents.length;
			lastIngestCount.value = response.count ?? null;
			lastResponse.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isIngesting.value = false;
		}
	};

	const ingestUrls = async (input: RAGDocumentUrlIngestInput) => {
		isIngesting.value = true;
		error.value = null;

		try {
			const response = await client.ingestUrls(input);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG URL ingest failed');
			}

			lastIngestCount.value = response.count ?? null;
			lastDocumentCount.value =
				response.documentCount ?? input.urls.length;
			lastResponse.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isIngesting.value = false;
		}
	};

	const ingestUploads = async (input: RAGDocumentUploadIngestInput) => {
		isIngesting.value = true;
		error.value = null;

		try {
			const response = await client.ingestUploads(input);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG upload ingest failed');
			}

			lastIngestCount.value = response.count ?? null;
			lastDocumentCount.value =
				response.documentCount ?? input.uploads.length;
			lastResponse.value = response;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isIngesting.value = false;
		}
	};

	const clearIndex = async () => {
		isIngesting.value = true;
		error.value = null;

		try {
			return await client.clearIndex();
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isIngesting.value = false;
		}
	};

	const reset = () => {
		error.value = null;
		isIngesting.value = false;
		lastDocumentCount.value = null;
		lastIngestCount.value = null;
		lastResponse.value = null;
	};

	return {
		clearIndex,
		error,
		ingest: ingestChunks,
		ingestChunks,
		ingestDocuments,
		ingestUploads,
		ingestUrls,
		isIngesting,
		lastDocumentCount,
		lastIngestCount,
		lastResponse,
		reset
	};
};
