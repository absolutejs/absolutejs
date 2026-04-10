import { useCallback, useMemo, useState } from 'react';
import type {
	RAGBackendsResponse,
	RAGMutationResponse,
	RAGSyncResponse,
	RAGSyncRunOptions
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client';

export const useRAGIndexAdmin = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastMutation, setLastMutation] =
		useState<RAGMutationResponse | null>(null);
	const [backends, setBackends] = useState<RAGBackendsResponse | null>(null);
	const [syncSources, setSyncSources] = useState<RAGSyncResponse | null>(
		null
	);

	const run = useCallback(async <T>(operation: () => Promise<T>) => {
		setIsLoading(true);
		setError(null);

		try {
			return await operation();
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: 'RAG index administration failed';
			setError(message);
			throw err;
		} finally {
			setIsLoading(false);
		}
	}, []);

	const deleteDocument = useCallback(
		async (id: string) =>
			run(async () => {
				const response = await client.deleteDocument(id);
				setLastMutation(response);
				if (!response.ok) {
					throw new Error(
						response.error ?? 'Failed to delete document'
					);
				}

				return response;
			}),
		[client, run]
	);

	const createDocument = useCallback(
		async (input: {
			id?: string;
			title?: string;
			source?: string;
			text: string;
			format?: 'text' | 'markdown' | 'html';
			metadata?: Record<string, unknown>;
			chunking?: {
				maxChunkLength?: number;
				chunkOverlap?: number;
				minChunkLength?: number;
				strategy?:
					| 'paragraphs'
					| 'sentences'
					| 'fixed'
					| 'source_aware';
			};
		}) =>
			run(async () => {
				const response = await client.createDocument(input);
				setLastMutation(response);
				if (!response.ok) {
					throw new Error(
						response.error ?? 'Failed to create document'
					);
				}

				return response;
			}),
		[client, run]
	);

	const reseed = useCallback(
		async () =>
			run(async () => {
				const response = await client.reseed();
				setLastMutation(response);
				if (!response.ok) {
					throw new Error(response.error ?? 'Failed to reseed index');
				}

				return response;
			}),
		[client, run]
	);

	const reindexDocument = useCallback(
		async (id: string) =>
			run(async () => {
				const response = await client.reindexDocument(id);
				setLastMutation(response);
				if (!response.ok) {
					throw new Error(
						response.error ?? 'Failed to reindex document'
					);
				}

				return response;
			}),
		[client, run]
	);

	const reindexSource = useCallback(
		async (source: string) =>
			run(async () => {
				const response = await client.reindexSource(source);
				setLastMutation(response);
				if (!response.ok) {
					throw new Error(
						response.error ?? 'Failed to reindex source'
					);
				}

				return response;
			}),
		[client, run]
	);

	const reset = useCallback(
		async () =>
			run(async () => {
				const response = await client.reset();
				setLastMutation(response);
				if (!response.ok) {
					throw new Error(response.error ?? 'Failed to reset index');
				}

				return response;
			}),
		[client, run]
	);

	const loadBackends = useCallback(
		async () =>
			run(async () => {
				const response = await client.backends();
				setBackends(response);

				return response;
			}),
		[client, run]
	);

	const loadSyncSources = useCallback(
		async () =>
			run(async () => {
				const response = await client.syncSources();
				setSyncSources(response);

				return response;
			}),
		[client, run]
	);

	const syncAllSources = useCallback(
		async (options?: RAGSyncRunOptions) =>
			run(async () => {
				const response = await client.syncAllSources(options);
				setSyncSources(response);
				if (!response.ok) {
					throw new Error(response.error ?? 'Failed to sync sources');
				}

				return response;
			}),
		[client, run]
	);

	const syncSource = useCallback(
		async (id: string, options?: RAGSyncRunOptions) =>
			run(async () => {
				const response = await client.syncSource(id, options);
				setSyncSources(response);
				if (!response.ok) {
					throw new Error(response.error ?? 'Failed to sync source');
				}

				return response;
			}),
		[client, run]
	);

	const clearIndex = useCallback(
		async () =>
			run(async () => {
				const response = await client.clearIndex();
				const mutation = {
					ok: response.ok
				} satisfies RAGMutationResponse;
				setLastMutation(mutation);

				return mutation;
			}),
		[client, run]
	);

	const resetState = useCallback(() => {
		setIsLoading(false);
		setError(null);
		setLastMutation(null);
		setBackends(null);
		setSyncSources(null);
	}, []);

	return {
		backends,
		clearIndex,
		createDocument,
		deleteDocument,
		error,
		isLoading,
		lastMutation,
		loadBackends,
		reindexDocument,
		reindexSource,
		reseed,
		reset,
		resetState,
		loadSyncSources,
		syncAllSources,
		syncSource,
		syncSources
	};
};

export type UseRAGIndexAdminResult = ReturnType<typeof useRAGIndexAdmin>;
