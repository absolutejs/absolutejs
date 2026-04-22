import { useCallback, useEffect, useMemo, useState } from 'react';
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

export const useRAGOps = (path: string, autoLoad = true) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [operations, setOperations] = useState<
		RAGOperationsResponse | undefined
	>();
	const [admin, setAdmin] = useState<RAGAdminCapabilities | undefined>();
	const [adminActions, setAdminActions] = useState<RAGAdminActionRecord[]>(
		[]
	);
	const [adminJobs, setAdminJobs] = useState<RAGAdminJobRecord[]>([]);
	const [status, setStatus] = useState<RAGVectorStoreStatus | undefined>();
	const [capabilities, setCapabilities] = useState<
		RAGBackendCapabilities | undefined
	>();
	const [maintenance, setMaintenance] = useState<
		RAGBackendMaintenanceSummary | undefined
	>();
	const [health, setHealth] = useState<RAGCorpusHealth | undefined>();
	const [readiness, setReadiness] = useState<
		RAGExtractorReadiness | undefined
	>();
	const [documents, setDocuments] = useState<
		RAGDocumentSummary | undefined
	>();
	const [ingestJobs, setIngestJobs] = useState<RAGIngestJobRecord[]>([]);
	const [syncSources, setSyncSources] = useState<RAGSyncSourceRecord[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(autoLoad);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);

		try {
			const response = await client.ops();
			setOperations(response);
			setAdmin(response.admin);
			setAdminActions(response.adminActions);
			setAdminJobs(response.adminJobs ?? []);
			setStatus(response.status);
			setCapabilities(response.capabilities);
			setMaintenance(response.maintenance);
			setHealth(response.health);
			setReadiness(response.readiness);
			setDocuments(response.documents);
			setIngestJobs(response.ingestJobs ?? []);
			setSyncSources(response.syncSources ?? []);

			return response;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			setError(message);
			throw caught;
		} finally {
			setIsLoading(false);
		}
	}, [client]);

	const reset = useCallback(() => {
		setOperations(undefined);
		setAdmin(undefined);
		setAdminActions([]);
		setAdminJobs([]);
		setCapabilities(undefined);
		setDocuments(undefined);
		setError(null);
		setHealth(undefined);
		setIngestJobs([]);
		setIsLoading(false);
		setMaintenance(undefined);
		setReadiness(undefined);
		setSyncSources([]);
		setStatus(undefined);
	}, []);

	useEffect(() => {
		if (!autoLoad) {
			setIsLoading(false);

			return;
		}

		void refresh();
	}, [autoLoad, refresh]);

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

export type UseRAGOpsResult = ReturnType<typeof useRAGOps>;
