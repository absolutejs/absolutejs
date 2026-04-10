import { writable } from 'svelte/store';
import type {
	RAGBackendsResponse,
	RAGChunkingStrategy,
	RAGContentFormat,
	RAGMutationResponse,
	RAGSyncResponse,
	RAGSyncRunOptions
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGIndexAdmin = (path: string) => {
	const client = createRAGClient({ path });
	const isLoading = writable(false);
	const error = writable<string | null>(null);
	const lastMutation = writable<RAGMutationResponse | null>(null);
	const backends = writable<RAGBackendsResponse | null>(null);
	const syncSources = writable<RAGSyncResponse | null>(null);

	const run = async <T>(operation: () => Promise<T>) => {
		isLoading.set(true);
		error.set(null);

		try {
			return await operation();
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isLoading.set(false);
		}
	};

	const createDocument = async (input: {
		id?: string;
		title?: string;
		source?: string;
		text: string;
		format?: RAGContentFormat;
		metadata?: Record<string, unknown>;
		chunking?: {
			maxChunkLength?: number;
			chunkOverlap?: number;
			minChunkLength?: number;
			strategy?: RAGChunkingStrategy;
		};
	}) =>
		run(async () => {
			const response = await client.createDocument(input);
			lastMutation.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to create document');
			}

			return response;
		});

	const deleteDocument = async (id: string) =>
		run(async () => {
			const response = await client.deleteDocument(id);
			lastMutation.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to delete document');
			}

			return response;
		});

	const reseed = async () =>
		run(async () => {
			const response = await client.reseed();
			lastMutation.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reseed index');
			}

			return response;
		});

	const reindexDocument = async (id: string) =>
		run(async () => {
			const response = await client.reindexDocument(id);
			lastMutation.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reindex document');
			}

			return response;
		});

	const reindexSource = async (source: string) =>
		run(async () => {
			const response = await client.reindexSource(source);
			lastMutation.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reindex source');
			}

			return response;
		});

	const reset = async () =>
		run(async () => {
			const response = await client.reset();
			lastMutation.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reset index');
			}

			return response;
		});

	const loadBackends = async () =>
		run(async () => {
			const response = await client.backends();
			backends.set(response);

			return response;
		});

	const loadSyncSources = async () =>
		run(async () => {
			const response = await client.syncSources();
			syncSources.set(response);

			return response;
		});

	const syncAllSources = async (options?: RAGSyncRunOptions) =>
		run(async () => {
			const response = await client.syncAllSources(options);
			syncSources.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to sync sources');
			}

			return response;
		});

	const syncSource = async (id: string, options?: RAGSyncRunOptions) =>
		run(async () => {
			const response = await client.syncSource(id, options);
			syncSources.set(response);
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to sync source');
			}

			return response;
		});

	const clearIndex = async () =>
		run(async () => {
			const response = await client.clearIndex();
			const mutation = { ok: response.ok } satisfies RAGMutationResponse;
			lastMutation.set(mutation);

			return mutation;
		});

	const resetState = () => {
		backends.set(null);
		error.set(null);
		isLoading.set(false);
		lastMutation.set(null);
		syncSources.set(null);
	};

	return {
		backends,
		clearIndex,
		createDocument,
		deleteDocument,
		error,
		isLoading,
		lastMutation,
		loadBackends,
		loadSyncSources,
		reindexDocument,
		reindexSource,
		reseed,
		reset,
		resetState,
		syncAllSources,
		syncSource,
		syncSources
	};
};

export type CreateRAGIndexAdminResult = ReturnType<typeof createRAGIndexAdmin>;
