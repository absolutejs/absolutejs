import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
	RAGBackendCapabilities,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

export const useRAGStatus = (path: string, autoLoad = true) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [status, setStatus] = useState<RAGVectorStoreStatus | undefined>();
	const [capabilities, setCapabilities] = useState<
		RAGBackendCapabilities | undefined
	>();
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(autoLoad);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);

		try {
			const response = await client.status();
			setStatus(response.status);
			setCapabilities(response.capabilities);

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
		setCapabilities(undefined);
		setError(null);
		setIsLoading(false);
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
		capabilities,
		error,
		isLoading,
		refresh,
		reset,
		status
	};
};

export type UseRAGStatusResult = ReturnType<typeof useRAGStatus>;
