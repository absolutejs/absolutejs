import { writable } from 'svelte/store';
import type {
	RAGAdminActionRecord,
	RAGAdminJobRecord,
	RAGAdminCapabilities,
	RAGBackendCapabilities,
	RAGBackendMaintenanceSummary,
	RAGCorpusHealth,
	RAGDocumentSummary,
	RAGExtractorReadiness,
	RAGIngestJobRecord,
	RAGOperationsResponse,
	RAGSyncSourceRecord,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const createRAGOps = (path: string, autoLoad = true) => {
	const client = createRAGClient({ path });
	const operations = writable<RAGOperationsResponse | undefined>(undefined);
	const admin = writable<RAGAdminCapabilities | undefined>(undefined);
	const adminActions = writable<RAGAdminActionRecord[]>([]);
	const adminJobs = writable<RAGAdminJobRecord[]>([]);
	const status = writable<RAGVectorStoreStatus | undefined>(undefined);
	const capabilities = writable<RAGBackendCapabilities | undefined>(
		undefined
	);
	const maintenance = writable<RAGBackendMaintenanceSummary | undefined>(
		undefined
	);
	const health = writable<RAGCorpusHealth | undefined>(undefined);
	const readiness = writable<RAGExtractorReadiness | undefined>(undefined);
	const documents = writable<RAGDocumentSummary | undefined>(undefined);
	const ingestJobs = writable<RAGIngestJobRecord[]>([]);
	const syncSources = writable<RAGSyncSourceRecord[]>([]);
	const error = writable<string | null>(null);
	const isLoading = writable(autoLoad);

	const refresh = async () => {
		isLoading.set(true);
		error.set(null);

		try {
			const response = await client.ops();
			operations.set(response);
			admin.set(response.admin);
			adminActions.set(response.adminActions);
			adminJobs.set(response.adminJobs ?? []);
			status.set(response.status);
			capabilities.set(response.capabilities);
			maintenance.set(response.maintenance);
			health.set(response.health);
			readiness.set(response.readiness);
			documents.set(response.documents);
			ingestJobs.set(response.ingestJobs ?? []);
			syncSources.set(response.syncSources ?? []);

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
		operations.set(undefined);
		admin.set(undefined);
		adminActions.set([]);
		adminJobs.set([]);
		capabilities.set(undefined);
		documents.set(undefined);
		error.set(null);
		health.set(undefined);
		ingestJobs.set([]);
		isLoading.set(false);
		maintenance.set(undefined);
		readiness.set(undefined);
		syncSources.set([]);
		status.set(undefined);
	};

	if (autoLoad) {
		void refresh();
	} else {
		isLoading.set(false);
	}

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
		maintenance,
		operations,
		readiness,
		refresh,
		reset,
		status,
		syncSources
	};
};

export type CreateRAGOpsResult = ReturnType<typeof createRAGOps>;
