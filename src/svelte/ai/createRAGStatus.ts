import { writable } from 'svelte/store';
import type {
	RAGBackendCapabilities,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGStatus = (path: string, autoLoad = true) => {
	const client = createRAGClient({ path });
	const status = writable<RAGVectorStoreStatus | undefined>(undefined);
	const capabilities = writable<RAGBackendCapabilities | undefined>(
		undefined
	);
	const error = writable<string | null>(null);
	const isLoading = writable(autoLoad);

	const refresh = async () => {
		isLoading.set(true);
		error.set(null);

		try {
			const response = await client.status();
			status.set(response.status);
			capabilities.set(response.capabilities);

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
		capabilities.set(undefined);
		error.set(null);
		isLoading.set(false);
		status.set(undefined);
	};

	if (autoLoad) {
		void refresh();
	} else {
		isLoading.set(false);
	}

	return {
		capabilities,
		error,
		isLoading,
		refresh,
		reset,
		status
	};
};
