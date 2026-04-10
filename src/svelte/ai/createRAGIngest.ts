import { writable } from 'svelte/store';
import type {
	RAGDocumentChunk,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGIngestResponse
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGIngest = (path: string) => {
	const client = createRAGClient({ path });
	const error = writable<string | null>(null);
	const isIngesting = writable(false);
	const lastIngestCount = writable<number | null>(null);
	const lastDocumentCount = writable<number | null>(null);
	const lastResponse = writable<RAGIngestResponse | null>(null);

	const ingestChunks = async (chunks: RAGDocumentChunk[]) => {
		isIngesting.set(true);
		error.set(null);

		try {
			const response = await client.ingest(chunks);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG ingest failed');
			}

			lastIngestCount.set(response.count ?? chunks.length);
			lastDocumentCount.set(null);
			lastResponse.set(response);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isIngesting.set(false);
		}
	};

	const ingestDocuments = async (input: RAGDocumentIngestInput) => {
		isIngesting.set(true);
		error.set(null);

		try {
			const response = await client.ingestDocuments(input);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG document ingest failed');
			}

			lastDocumentCount.set(
				response.documentCount ?? input.documents.length
			);
			lastIngestCount.set(response.count ?? null);
			lastResponse.set(response);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isIngesting.set(false);
		}
	};

	const ingestUrls = async (input: RAGDocumentUrlIngestInput) => {
		isIngesting.set(true);
		error.set(null);

		try {
			const response = await client.ingestUrls(input);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG URL ingest failed');
			}

			lastIngestCount.set(response.count ?? null);
			lastDocumentCount.set(response.documentCount ?? input.urls.length);
			lastResponse.set(response);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isIngesting.set(false);
		}
	};

	const ingestUploads = async (input: RAGDocumentUploadIngestInput) => {
		isIngesting.set(true);
		error.set(null);

		try {
			const response = await client.ingestUploads(input);
			if (!response.ok) {
				throw new Error(response.error ?? 'RAG upload ingest failed');
			}

			lastIngestCount.set(response.count ?? null);
			lastDocumentCount.set(
				response.documentCount ?? input.uploads.length
			);
			lastResponse.set(response);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isIngesting.set(false);
		}
	};

	const clearIndex = async () => {
		isIngesting.set(true);
		error.set(null);

		try {
			return await client.clearIndex();
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isIngesting.set(false);
		}
	};

	const reset = () => {
		error.set(null);
		isIngesting.set(false);
		lastDocumentCount.set(null);
		lastIngestCount.set(null);
		lastResponse.set(null);
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
