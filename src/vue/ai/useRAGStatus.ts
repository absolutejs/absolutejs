import { onMounted, ref } from 'vue';
import type {
	RAGBackendCapabilities,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGStatus = (path: string, autoLoad = true) => {
	const client = createRAGClient({ path });
	const status = ref<RAGVectorStoreStatus | undefined>();
	const capabilities = ref<RAGBackendCapabilities | undefined>();
	const error = ref<string | null>(null);
	const isLoading = ref(autoLoad);

	const refresh = async () => {
		isLoading.value = true;
		error.value = null;

		try {
			const response = await client.status();
			status.value = response.status;
			capabilities.value = response.capabilities;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isLoading.value = false;
		}
	};

	const reset = () => {
		capabilities.value = undefined;
		error.value = null;
		isLoading.value = false;
		status.value = undefined;
	};

	onMounted(() => {
		if (!autoLoad) {
			isLoading.value = false;

			return;
		}

		void refresh();
	});

	return {
		capabilities,
		error,
		isLoading,
		refresh,
		reset,
		status
	};
};
