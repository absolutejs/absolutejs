import { useCallback, useMemo, useState } from 'react';
import type {
	RAGDocumentChunk,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGIngestResponse
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGIngest = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [error, setError] = useState<string | null>(null);
	const [isIngesting, setIsIngesting] = useState(false);
	const [lastIngestCount, setLastIngestCount] = useState<number | null>(null);
	const [lastDocumentCount, setLastDocumentCount] = useState<number | null>(
		null
	);
	const [lastResponse, setLastResponse] = useState<RAGIngestResponse | null>(
		null
	);

	const ingestChunks = useCallback(
		async (chunks: RAGDocumentChunk[]) => {
			setIsIngesting(true);
			setError(null);

			try {
				const response = await client.ingest(chunks);
				if (!response.ok) {
					throw new Error(response.error ?? 'RAG ingest failed');
				}

				setLastIngestCount(response.count ?? chunks.length);
				setLastDocumentCount(null);
				setLastResponse(response);

				return response;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsIngesting(false);
			}
		},
		[client]
	);

	const ingestDocuments = useCallback(
		async (input: RAGDocumentIngestInput) => {
			setIsIngesting(true);
			setError(null);

			try {
				const response = await client.ingestDocuments(input);
				if (!response.ok) {
					throw new Error(response.error ?? 'RAG ingest failed');
				}

				setLastIngestCount(response.count ?? null);
				setLastDocumentCount(
					response.documentCount ?? input.documents.length
				);
				setLastResponse(response);

				return response;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsIngesting(false);
			}
		},
		[client]
	);

	const ingestUrls = useCallback(
		async (input: RAGDocumentUrlIngestInput) => {
			setIsIngesting(true);
			setError(null);

			try {
				const response = await client.ingestUrls(input);
				if (!response.ok) {
					throw new Error(response.error ?? 'RAG URL ingest failed');
				}

				setLastIngestCount(response.count ?? null);
				setLastDocumentCount(
					response.documentCount ?? input.urls.length
				);
				setLastResponse(response);

				return response;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsIngesting(false);
			}
		},
		[client]
	);

	const ingestUploads = useCallback(
		async (input: RAGDocumentUploadIngestInput) => {
			setIsIngesting(true);
			setError(null);

			try {
				const response = await client.ingestUploads(input);
				if (!response.ok) {
					throw new Error(
						response.error ?? 'RAG upload ingest failed'
					);
				}

				setLastIngestCount(response.count ?? null);
				setLastDocumentCount(
					response.documentCount ?? input.uploads.length
				);
				setLastResponse(response);

				return response;
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				setError(message);
				throw caught;
			} finally {
				setIsIngesting(false);
			}
		},
		[client]
	);

	const clearIndex = useCallback(async () => {
		setIsIngesting(true);
		setError(null);

		try {
			await client.clearIndex();
			setLastIngestCount(0);
			setLastDocumentCount(0);
			setLastResponse(null);
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			setError(message);
			throw caught;
		} finally {
			setIsIngesting(false);
		}
	}, [client]);

	const reset = useCallback(() => {
		setError(null);
		setLastDocumentCount(null);
		setLastIngestCount(null);
		setLastResponse(null);
	}, []);

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

export type UseRAGIngestResult = ReturnType<typeof useRAGIngest>;
