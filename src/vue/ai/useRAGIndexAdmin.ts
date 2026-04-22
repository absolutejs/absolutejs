import { ref } from 'vue';
import type {
	RAGBackendsResponse,
	RAGContentFormat,
	RAGChunkingStrategy,
	RAGMutationResponse,
	RAGSyncResponse,
	RAGSyncRunOptions
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGIndexAdmin = (path: string) => {
	const client = createRAGClient({ path });
	const isLoading = ref(false);
	const error = ref<string | null>(null);
	const lastMutation = ref<RAGMutationResponse | null>(null);
	const backends = ref<RAGBackendsResponse | null>(null);
	const syncSources = ref<RAGSyncResponse | null>(null);

	const run = async <T>(operation: () => Promise<T>) => {
		isLoading.value = true;
		error.value = null;

		try {
			return await operation();
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isLoading.value = false;
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
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to create document');
			}

			return response;
		});

	const deleteDocument = async (id: string) =>
		run(async () => {
			const response = await client.deleteDocument(id);
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to delete document');
			}

			return response;
		});

	const reseed = async () =>
		run(async () => {
			const response = await client.reseed();
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reseed index');
			}

			return response;
		});

	const analyzeBackend = async () =>
		run(async () => {
			const response = await client.analyzeBackend();
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to analyze backend');
			}

			return response;
		});

	const reindexDocument = async (id: string) =>
		run(async () => {
			const response = await client.reindexDocument(id);
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reindex document');
			}

			return response;
		});

	const reindexSource = async (source: string) =>
		run(async () => {
			const response = await client.reindexSource(source);
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reindex source');
			}

			return response;
		});

	const rebuildNativeIndex = async () =>
		run(async () => {
			const response = await client.rebuildNativeIndex();
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(
					response.error ?? 'Failed to rebuild native index'
				);
			}

			return response;
		});

	const reset = async () =>
		run(async () => {
			const response = await client.reset();
			lastMutation.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to reset index');
			}

			return response;
		});

	const loadBackends = async () =>
		run(async () => {
			const response = await client.backends();
			backends.value = response;

			return response;
		});

	const loadSyncSources = async () =>
		run(async () => {
			const response = await client.syncSources();
			syncSources.value = response;

			return response;
		});

	const syncAllSources = async (options?: RAGSyncRunOptions) =>
		run(async () => {
			const response = await client.syncAllSources(options);
			syncSources.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to sync sources');
			}

			return response;
		});

	const syncSource = async (id: string, options?: RAGSyncRunOptions) =>
		run(async () => {
			const response = await client.syncSource(id, options);
			syncSources.value = response;
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to sync source');
			}

			return response;
		});

	const clearIndex = async () =>
		run(async () => {
			const response = await client.clearIndex();
			const mutation = { ok: response.ok } satisfies RAGMutationResponse;
			lastMutation.value = mutation;

			return mutation;
		});

	const resetState = () => {
		backends.value = null;
		error.value = null;
		isLoading.value = false;
		lastMutation.value = null;
		syncSources.value = null;
	};

	return {
		backends,
		analyzeBackend,
		clearIndex,
		createDocument,
		deleteDocument,
		error,
		isLoading,
		lastMutation,
		loadBackends,
		loadSyncSources,
		rebuildNativeIndex,
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

export type UseRAGIndexAdminResult = ReturnType<typeof useRAGIndexAdmin>;
