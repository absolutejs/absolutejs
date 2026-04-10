import type {
	RAGBackendsResponse,
	RAGDocumentChunksResponse,
	RAGEvaluationInput,
	RAGEvaluationResponse,
	RAGDocumentIngestInput,
	RAGDocumentChunk,
	RAGDocumentsResponse,
	RAGDocumentUrlIngestInput,
	RAGDocumentUploadIngestInput,
	RAGIngestResponse,
	RAGMutationResponse,
	RAGOperationsResponse,
	RAGSearchRequest,
	RAGSource,
	RAGStatusResponse,
	RAGSyncRunOptions,
	RAGSyncResponse
} from '../../../types/ai';
import { UNFOUND_INDEX } from '../../constants';

type FetchLike = typeof fetch;

export type RAGClientOptions = {
	path: string;
	fetch?: FetchLike;
};

const jsonHeaders: { 'Content-Type': string } = {
	'Content-Type': 'application/json'
};

const normalizeBasePath = (path: string) =>
	path.endsWith('/') ? path.slice(0, UNFOUND_INDEX) : path;

const parseJson = async <T>(response: Response) => {
	const payload: T = JSON.parse(await response.text());

	return payload;
};

const isErrorPayload = (value: unknown): value is { error?: string } => {
	if (!value || typeof value !== 'object') {
		return false;
	}

	return !('error' in value) || typeof value.error === 'string';
};

const toErrorMessage = async (response: Response) => {
	try {
		const payload = JSON.parse(await response.text());
		if (
			isErrorPayload(payload) &&
			typeof payload.error === 'string' &&
			payload.error
		) {
			return payload.error;
		}
	} catch {
		// fall through
	}

	return `Request failed with status ${response.status}`;
};

export const createRAGClient = (options: RAGClientOptions) => {
	const basePath = normalizeBasePath(options.path);
	const fetchImpl = options.fetch ?? fetch;

	return {
		async backends() {
			const response = await fetchImpl(`${basePath}/backends`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGBackendsResponse>(response);
		},
		async clearIndex() {
			const response = await fetchImpl(`${basePath}/index`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<{ ok: boolean }>(response);
		},
		async createDocument(
			input: RAGDocumentIngestInput['documents'][number]
		) {
			const response = await fetchImpl(`${basePath}/documents`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGMutationResponse>(response);
		},
		async deleteDocument(id: string) {
			const response = await fetchImpl(
				`${basePath}/documents/${encodeURIComponent(id)}`,
				{
					method: 'DELETE'
				}
			);

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGMutationResponse>(response);
		},
		async documentChunks(id: string) {
			const response = await fetchImpl(
				`${basePath}/documents/${encodeURIComponent(id)}/chunks`
			);

			if (!response.ok) {
				const error = await toErrorMessage(response);

				const errorResponse: RAGDocumentChunksResponse = {
					error,
					ok: false
				};

				return errorResponse;
			}

			return parseJson<RAGDocumentChunksResponse>(response);
		},
		async documents(kind?: string) {
			const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
			const response = await fetchImpl(`${basePath}/documents${query}`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGDocumentsResponse>(response);
		},
		async evaluate(input: RAGEvaluationInput) {
			const response = await fetchImpl(`${basePath}/evaluate`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGEvaluationResponse>(response);
		},
		async ingest(chunks: RAGDocumentChunk[]) {
			const response = await fetchImpl(`${basePath}/ingest`, {
				body: JSON.stringify({ chunks }),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGIngestResponse>(response);
		},
		async ingestDocuments(input: RAGDocumentIngestInput) {
			const response = await fetchImpl(`${basePath}/ingest`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGIngestResponse>(response);
		},
		async ingestUploads(input: RAGDocumentUploadIngestInput) {
			const response = await fetchImpl(`${basePath}/ingest`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGIngestResponse>(response);
		},
		async ingestUrls(input: RAGDocumentUrlIngestInput) {
			const response = await fetchImpl(`${basePath}/ingest`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGIngestResponse>(response);
		},
		async ops() {
			const response = await fetchImpl(`${basePath}/ops`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGOperationsResponse>(response);
		},
		async syncSources() {
			const response = await fetchImpl(`${basePath}/sync`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGSyncResponse>(response);
		},
		async syncAllSources(options?: RAGSyncRunOptions) {
			const response = await fetchImpl(`${basePath}/sync`, {
				body:
					options?.background === true
						? JSON.stringify({ background: true })
						: undefined,
				headers: options?.background === true ? jsonHeaders : undefined,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				} satisfies RAGSyncResponse;
			}

			return parseJson<RAGSyncResponse>(response);
		},
		async syncSource(id: string, options?: RAGSyncRunOptions) {
			const response = await fetchImpl(
				`${basePath}/sync/${encodeURIComponent(id)}`,
				{
					body:
						options?.background === true
							? JSON.stringify({ background: true })
							: undefined,
					headers:
						options?.background === true ? jsonHeaders : undefined,
					method: 'POST'
				}
			);

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				} satisfies RAGSyncResponse;
			}

			return parseJson<RAGSyncResponse>(response);
		},
		async reindexDocument(id: string) {
			const response = await fetchImpl(
				`${basePath}/reindex/documents/${encodeURIComponent(id)}`,
				{
					method: 'POST'
				}
			);

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGMutationResponse>(response);
		},
		async reindexSource(source: string) {
			const response = await fetchImpl(`${basePath}/reindex/source`, {
				body: JSON.stringify({ source }),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGMutationResponse>(response);
		},
		async reseed() {
			const response = await fetchImpl(`${basePath}/reseed`, {
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGMutationResponse>(response);
		},
		async reset() {
			const response = await fetchImpl(`${basePath}/reset`, {
				method: 'POST'
			});

			if (!response.ok) {
				return {
					error: await toErrorMessage(response),
					ok: false
				};
			}

			return parseJson<RAGMutationResponse>(response);
		},
		async search(input: RAGSearchRequest) {
			const response = await fetchImpl(`${basePath}/search`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload = await parseJson<{
				ok: boolean;
				results?: RAGSource[];
				error?: string;
			}>(response);

			if (!payload.ok) {
				throw new Error(payload.error ?? 'RAG search failed');
			}

			return payload.results ?? [];
		},
		async status() {
			const response = await fetchImpl(`${basePath}/status`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGStatusResponse>(response);
		}
	};
};

export type RAGClient = ReturnType<typeof createRAGClient>;
