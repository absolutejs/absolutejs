import { useCallback, useMemo, useState } from 'react';
import type { RAGDocumentChunkPreview } from '../../../types/ai';
import { createRAGClient } from '../../ai/client';

export const useRAGChunkPreview = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [preview, setPreview] = useState<RAGDocumentChunkPreview | null>(
		null
	);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const inspect = useCallback(
		async (id: string) => {
			setIsLoading(true);
			setError(null);

			try {
				const response = await client.documentChunks(id);
				if (!response.ok) {
					throw new Error(response.error);
				}

				setPreview(response);

				return response;
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: 'Failed to load RAG chunk preview';
				setError(message);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[client]
	);

	const clear = useCallback(() => {
		setPreview(null);
		setError(null);
		setIsLoading(false);
	}, []);

	return {
		clear,
		error,
		inspect,
		isLoading,
		preview
	};
};

export type UseRAGChunkPreviewResult = ReturnType<typeof useRAGChunkPreview>;
