import { onMounted, ref } from 'vue';
import type {
	RAGAdminActionRecord,
	RAGAdminJobRecord,
	RAGAdminCapabilities,
	RAGBackendCapabilities,
	RAGCorpusHealth,
	RAGDocumentSummary,
	RAGExtractorReadiness,
	RAGIngestJobRecord,
	RAGOperationsResponse,
	RAGSyncSourceRecord,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGOps = (path: string, autoLoad = true) => {
	const client = createRAGClient({ path });
	const operations = ref<RAGOperationsResponse | undefined>();
	const admin = ref<RAGAdminCapabilities | undefined>();
	const adminActions = ref<RAGAdminActionRecord[]>([]);
	const adminJobs = ref<RAGAdminJobRecord[]>([]);
	const status = ref<RAGVectorStoreStatus | undefined>();
	const capabilities = ref<RAGBackendCapabilities | undefined>();
	const health = ref<RAGCorpusHealth | undefined>();
	const readiness = ref<RAGExtractorReadiness | undefined>();
	const documents = ref<RAGDocumentSummary | undefined>();
	const ingestJobs = ref<RAGIngestJobRecord[]>([]);
	const syncSources = ref<RAGSyncSourceRecord[]>([]);
	const error = ref<string | null>(null);
	const isLoading = ref(autoLoad);

	const refresh = async () => {
		isLoading.value = true;
		error.value = null;

		try {
			const response = await client.ops();
			operations.value = response;
			admin.value = response.admin;
			adminActions.value = response.adminActions;
			adminJobs.value = response.adminJobs ?? [];
			status.value = response.status;
			capabilities.value = response.capabilities;
			health.value = response.health;
			readiness.value = response.readiness;
			documents.value = response.documents;
			ingestJobs.value = response.ingestJobs ?? [];
			syncSources.value = response.syncSources ?? [];

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
		operations.value = undefined;
		admin.value = undefined;
		adminActions.value = [];
		adminJobs.value = [];
		capabilities.value = undefined;
		documents.value = undefined;
		error.value = null;
		health.value = undefined;
		ingestJobs.value = [];
		isLoading.value = false;
		readiness.value = undefined;
		syncSources.value = [];
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
		admin,
		adminActions,
		adminJobs,
		capabilities,
		documents,
		error,
		health,
		ingestJobs,
		isLoading,
		operations,
		readiness,
		refresh,
		reset,
		status,
		syncSources
	};
};

export type UseRAGOpsResult = ReturnType<typeof useRAGOps>;
