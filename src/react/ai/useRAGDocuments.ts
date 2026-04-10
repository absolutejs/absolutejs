import { useCallback, useMemo, useState } from 'react';
import type {
	RAGDocumentsResponse,
	RAGIndexedDocument
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client';

export const useRAGDocuments = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [documents, setDocuments] = useState<RAGIndexedDocument[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastResponse, setLastResponse] =
		useState<RAGDocumentsResponse | null>(null);

	const load = useCallback(
		async (kind?: string) => {
			setIsLoading(true);
			setError(null);

			try {
				const response = await client.documents(kind);
				setDocuments(response.documents);
				setLastResponse(response);

				return response;
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: 'Failed to load RAG documents';
				setError(message);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[client]
	);

	const reset = useCallback(() => {
		setDocuments([]);
		setError(null);
		setLastResponse(null);
		setIsLoading(false);
	}, []);

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
