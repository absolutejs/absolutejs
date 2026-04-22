import type {
	RAGAdminCapabilities,
	RAGBackendsResponse,
	RAGBackendMaintenanceRecommendation,
	RAGBackendMaintenanceSummary,
	RAGDocumentChunksResponse,
	RAGEvaluationInput,
	RAGEvaluationResponse,
	RAGRetrievalBaselineListResponse,
	RAGRetrievalBaselinePromotionFromRunRequest,
	RAGRetrievalBaselinePromotionRequest,
	RAGRetrievalBaselineRevertRequest,
	RAGRetrievalReleaseIncidentAcknowledgeRequest,
	RAGRetrievalReleaseDecisionActionRequest,
	RAGRetrievalBaselineResponse,
	RAGRetrievalPromotionCandidateListResponse,
	RAGRetrievalReleaseDecisionListResponse,
	RAGRetrievalLaneHandoffDecisionListResponse,
	RAGRetrievalLaneHandoffDecisionRequest,
	RAGRetrievalLaneHandoffDecisionResponse,
	RAGRetrievalLaneHandoffAutoCompletePolicyHistoryResponse,
	RAGRetrievalReleaseLanePolicyHistoryResponse,
	RAGRetrievalBaselineGatePolicyHistoryResponse,
	RAGRetrievalReleaseLaneEscalationPolicyHistoryResponse,
	RAGRetrievalLaneHandoffIncidentHistoryResponse,
	RAGRetrievalLaneHandoffIncidentListResponse,
	RAGRetrievalLaneHandoffIncidentStatusResponse,
	RAGRetrievalLaneHandoffListResponse,
	RAGRetrievalLaneHandoffStatusResponse,
	RAGRetrievalIncidentRemediationDecisionListResponse,
	RAGRetrievalIncidentRemediationDecisionRequest,
	RAGRetrievalIncidentRemediationExecutionHistoryResponse,
	RAGRetrievalIncidentRemediationBulkExecutionRequest,
	RAGRetrievalIncidentRemediationBulkExecutionResponse,
	RAGRetrievalIncidentRemediationExecutionRequest,
	RAGRetrievalIncidentRemediationExecutionResponse,
	RAGRetrievalIncidentRemediationStatusResponse,
	RAGRetrievalReleaseGroupHistoryResponse,
	RAGRetrievalReleaseIncidentListResponse,
	RAGRetrievalReleaseIncidentStatusResponse,
	RAGRetrievalReleaseDriftStatusResponse,
	RAGRetrievalReleaseStatusResponse,
	RAGRetrievalComparisonHistoryResponse,
	RAGRetrievalComparisonRequest,
	RAGRetrievalComparisonResponse,
	RAGAdaptiveNativePlannerBenchmarkResponse,
	RAGAdaptiveNativePlannerBenchmarkSnapshotResponse,
	RAGNativeBackendComparisonBenchmarkResponse,
	RAGNativeBackendComparisonBenchmarkSnapshotResponse,
	RAGDocumentIngestInput,
	RAGDocumentChunk,
	RAGDocumentsResponse,
	RAGDocumentUrlIngestInput,
	RAGDocumentUploadIngestInput,
	RAGIngestResponse,
	RAGMutationResponse,
	RAGOperationsResponse,
	RAGSearchRequest,
	RAGSearchResponse,
	RAGSearchTracePrunePreviewResponse,
	RAGSearchTracePruneHistoryResponse,
	RAGSearchTracePruneResponse,
	RAGSearchTraceGroupHistoryResponse,
	RAGSearchTraceHistoryResponse,
	RAGSearchTraceStatsResponse,
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

export type RAGDetailedSearchResponse = {
	results: RAGSource[];
	trace?: RAGSearchResponse['trace'];
};

export type RAGMaintenancePayload =
	| Pick<RAGMutationResponse, 'maintenance' | 'admin' | 'workflowStatus'>
	| Pick<RAGOperationsResponse, 'maintenance' | 'admin' | 'status'>
	| Pick<RAGStatusResponse, 'maintenance' | 'admin' | 'status'>
	| null
	| undefined;

export type RAGMaintenanceActionDescriptor = {
	kind: 'analyze_backend' | 'rebuild_native_index';
	label: string;
	available: boolean;
	recommended: boolean;
	reason?: string;
};

export type RAGMaintenanceOverview = {
	activeJobCount: number;
	actions: RAGMaintenanceActionDescriptor[];
	availableActions: RAGMaintenanceActionDescriptor[];
	backend?: RAGBackendMaintenanceSummary['backend'];
	blockingRecommendations: RAGBackendMaintenanceRecommendation[];
	criticalCount: number;
	hasBlockingIssue: boolean;
	infoCount: number;
	primaryRecommendation?: RAGBackendMaintenanceRecommendation;
	recentlyCompletedActions: NonNullable<RAGBackendMaintenanceSummary>['recentActions'];
	recommendationCount: number;
	recommendations: RAGBackendMaintenanceRecommendation[];
	recommendedNow: RAGBackendMaintenanceRecommendation[];
	warningCount: number;
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

const getMaintenanceSummary = (
	payload: RAGMaintenancePayload
): RAGBackendMaintenanceSummary | undefined => payload?.maintenance;

const getMaintenanceAdmin = (
	payload: RAGMaintenancePayload
): RAGAdminCapabilities | undefined => payload?.admin;

export const buildRAGMaintenanceOverview = (
	payload: RAGMaintenancePayload
): RAGMaintenanceOverview => {
	const summary = getMaintenanceSummary(payload);
	const admin = getMaintenanceAdmin(payload);
	const recommendations = summary?.recommendations ?? [];
	const blockingRecommendations = recommendations.filter(
		(entry) => entry.severity === 'error'
	);
	const recommendedNow = recommendations.filter(
		(entry) => entry.severity !== 'info'
	);
	const recommendedActions = new Set(
		recommendations.flatMap((entry) => (entry.action ? [entry.action] : []))
	);
	const actionReason = (kind: 'analyze_backend' | 'rebuild_native_index') =>
		recommendations.find((entry) => entry.action === kind)?.message;

	const actions: RAGMaintenanceActionDescriptor[] = [
		{
			available: admin?.canAnalyzeBackend ?? false,
			kind: 'analyze_backend',
			label: 'Analyze backend',
			reason: actionReason('analyze_backend'),
			recommended: recommendedActions.has('analyze_backend')
		},
		{
			available: admin?.canRebuildNativeIndex ?? false,
			kind: 'rebuild_native_index',
			label: 'Rebuild native index',
			reason: actionReason('rebuild_native_index'),
			recommended: recommendedActions.has('rebuild_native_index')
		}
	];

	return {
		activeJobCount: summary?.activeJobs.length ?? 0,
		actions,
		availableActions: actions.filter((action) => action.available),
		backend: summary?.backend,
		blockingRecommendations,
		criticalCount: blockingRecommendations.length,
		hasBlockingIssue: blockingRecommendations.length > 0,
		infoCount: recommendations.filter((entry) => entry.severity === 'info')
			.length,
		primaryRecommendation: [...recommendations].sort((left, right) => {
			const severityRank = { error: 0, warning: 1, info: 2 } as const;
			return severityRank[left.severity] - severityRank[right.severity];
		})[0],
		recentlyCompletedActions: (summary?.recentActions ?? []).filter(
			(action) => action.status === 'completed'
		),
		recommendationCount: recommendations.length,
		recommendations,
		recommendedNow,
		warningCount: recommendations.filter(
			(entry) => entry.severity === 'warning'
		).length
	};
};

export const createRAGClient = (options: RAGClientOptions) => {
	const basePath = normalizeBasePath(options.path);
	const fetchImpl = options.fetch ?? fetch;

	const search = async <IncludeTrace extends boolean | undefined = undefined>(
		input: RAGSearchRequest & { includeTrace?: IncludeTrace }
	): Promise<
		IncludeTrace extends true ? RAGDetailedSearchResponse : RAGSource[]
	> => {
		const response = await fetchImpl(`${basePath}/search`, {
			body: JSON.stringify(input),
			headers: jsonHeaders,
			method: 'POST'
		});

		if (!response.ok) {
			throw new Error(await toErrorMessage(response));
		}

		const payload = await parseJson<RAGSearchResponse>(response);

		if (!payload.ok) {
			throw new Error(payload.error ?? 'RAG search failed');
		}

		if (input.includeTrace === true) {
			return {
				results: payload.results ?? [],
				trace: payload.trace
			} as IncludeTrace extends true
				? RAGDetailedSearchResponse
				: RAGSource[];
		}

		return (payload.results ?? []) as IncludeTrace extends true
			? RAGDetailedSearchResponse
			: RAGSource[];
	};

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
		async compareRetrievals(input: RAGRetrievalComparisonRequest) {
			const response = await fetchImpl(`${basePath}/compare/retrieval`, {
				body: JSON.stringify(input),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalComparisonResponse>(response);
			if (!payload.ok || !payload.comparison) {
				throw new Error(
					payload.error ?? 'RAG retrieval comparison failed'
				);
			}

			return payload.comparison;
		},
		async retrievalComparisonHistory(input?: {
			limit?: number;
			suiteId?: string;
			label?: string;
			winnerId?: string;
			groupKey?: string;
			tag?: string;
		}) {
			const searchParams = new URLSearchParams();
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (input?.suiteId) {
				searchParams.set('suiteId', input.suiteId);
			}
			if (input?.label) {
				searchParams.set('label', input.label);
			}
			if (input?.winnerId) {
				searchParams.set('winnerId', input.winnerId);
			}
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (input?.tag) {
				searchParams.set('tag', input.tag);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalComparisonHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.runs) {
				throw new Error(
					payload.error ?? 'RAG retrieval comparison history failed'
				);
			}

			return payload.runs;
		},
		async retrievalBaselines(input?: {
			groupKey?: string;
			tag?: string;
			limit?: number;
			status?: 'active' | 'superseded';
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (input?.tag) {
				searchParams.set('tag', input.tag);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (input?.status) {
				searchParams.set('status', input.status);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalBaselineListResponse>(response);
			if (!payload.ok || !payload.baselines) {
				throw new Error(
					payload.error ?? 'RAG retrieval baseline list failed'
				);
			}

			return payload.baselines;
		},
		async promoteRetrievalBaseline(
			input: RAGRetrievalBaselinePromotionRequest
		) {
			const payload = await this.promoteRetrievalBaselineDetailed(input);
			return payload.baseline!;
		},
		async promoteRetrievalBaselineDetailed(
			input: RAGRetrievalBaselinePromotionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/promote`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalBaselineResponse>(response);
			if (!payload.ok || !payload.baseline) {
				throw new Error(
					payload.error ?? 'RAG retrieval baseline promotion failed'
				);
			}

			return payload;
		},
		async promoteRetrievalBaselineToLane(
			input: RAGRetrievalBaselinePromotionRequest & {
				rolloutLabel: 'canary' | 'stable' | 'rollback_target';
			}
		) {
			const payload =
				await this.promoteRetrievalBaselineToLaneDetailed(input);
			return payload.baseline!;
		},
		async promoteRetrievalBaselineToLaneDetailed(
			input: RAGRetrievalBaselinePromotionRequest & {
				rolloutLabel: 'canary' | 'stable' | 'rollback_target';
			}
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/promote-lane`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalBaselineResponse>(response);
			if (!payload.ok || !payload.baseline) {
				throw new Error(
					payload.error ??
						'RAG retrieval rollout-lane promotion failed'
				);
			}

			return payload;
		},
		async promoteRetrievalBaselineFromRun(
			input: RAGRetrievalBaselinePromotionFromRunRequest
		) {
			const payload =
				await this.promoteRetrievalBaselineFromRunDetailed(input);
			return payload.baseline!;
		},
		async promoteRetrievalBaselineFromRunDetailed(
			input: RAGRetrievalBaselinePromotionFromRunRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/promote-run`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalBaselineResponse>(response);
			if (!payload.ok || !payload.baseline) {
				throw new Error(
					payload.error ??
						'RAG retrieval baseline promotion from run failed'
				);
			}

			return payload;
		},
		async revertRetrievalBaseline(
			input: RAGRetrievalBaselineRevertRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/revert`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalBaselineResponse>(response);
			if (!payload.ok || !payload.baseline) {
				throw new Error(
					payload.error ?? 'RAG retrieval baseline revert failed'
				);
			}

			return payload.baseline;
		},
		async retrievalBaselineDecisions(input?: {
			groupKey?: string;
			limit?: number;
			kind?: 'approve' | 'promote' | 'reject' | 'revert';
			freshnessStatus?: 'fresh' | 'expired' | 'not_applicable';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (input?.kind) {
				searchParams.set('kind', input.kind);
			}
			if (input?.freshnessStatus) {
				searchParams.set('freshnessStatus', input.freshnessStatus);
			}
			if (input?.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/decisions${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseDecisionListResponse>(
					response
				);
			if (!payload.ok || !payload.decisions) {
				throw new Error(
					payload.error ??
						'RAG retrieval release decision list failed'
				);
			}

			return payload.decisions;
		},
		async retrievalReleaseGroupHistory(input: {
			groupKey: string;
			decisionLimit?: number;
			baselineLimit?: number;
			benchmarkLimit?: number;
			runLimit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const searchParams = new URLSearchParams();
			searchParams.set('groupKey', input.groupKey);
			if (typeof input.decisionLimit === 'number') {
				searchParams.set('decisionLimit', String(input.decisionLimit));
			}
			if (typeof input.baselineLimit === 'number') {
				searchParams.set('baselineLimit', String(input.baselineLimit));
			}
			if (typeof input.runLimit === 'number') {
				searchParams.set('runLimit', String(input.runLimit));
			}
			if (typeof input.benchmarkLimit === 'number') {
				searchParams.set(
					'benchmarkLimit',
					String(input.benchmarkLimit)
				);
			}
			if (input.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/release-history?${searchParams}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseGroupHistoryResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'RAG retrieval release group history failed'
				);
			}

			return payload;
		},
		async adaptiveNativePlannerBenchmark(input?: {
			limit?: number;
			runLimit?: number;
			label?: string;
			description?: string;
			groupKey?: string;
			corpusGroupKey?: string;
		}) {
			const searchParams = new URLSearchParams();
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (typeof input?.runLimit === 'number') {
				searchParams.set('runLimit', String(input.runLimit));
			}
			if (input?.label) {
				searchParams.set('label', input.label);
			}
			if (input?.description) {
				searchParams.set('description', input.description);
			}
			if (input?.groupKey) {
				searchParams.set('benchmarkGroupKey', input.groupKey);
			}
			if (input?.corpusGroupKey) {
				searchParams.set(
					'benchmarkCorpusGroupKey',
					input.corpusGroupKey
				);
			}
			const suffix = searchParams.size ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/benchmarks/adaptive-native-planner${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGAdaptiveNativePlannerBenchmarkResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'Adaptive native planner benchmark history failed'
				);
			}

			return payload;
		},
		async runAdaptiveNativePlannerBenchmark(input?: {
			limit?: number;
			runLimit?: number;
			topK?: number;
			label?: string;
			description?: string;
			groupKey?: string;
			corpusGroupKey?: string;
			persistRun?: boolean;
			baselineRetrievalId?: string;
			candidateRetrievalId?: string;
			retrievals?: Array<{
				id: string;
				label?: string;
				retrieval?: Record<string, unknown> | string;
			}>;
			tags?: string[];
			metadata?: Record<string, unknown>;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/benchmarks/adaptive-native-planner/run`,
				{
					body: JSON.stringify({
						baselineRetrievalId: input?.baselineRetrievalId,
						candidateRetrievalId: input?.candidateRetrievalId,
						corpusGroupKey: input?.corpusGroupKey,
						description: input?.description,
						groupKey: input?.groupKey,
						label: input?.label,
						limit: input?.limit,
						metadata: input?.metadata,
						persistRun: input?.persistRun,
						retrievals: input?.retrievals,
						runLimit: input?.runLimit,
						tags: input?.tags,
						topK: input?.topK
					}),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGAdaptiveNativePlannerBenchmarkResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'Adaptive native planner benchmark run failed'
				);
			}

			return payload;
		},
		async saveAdaptiveNativePlannerBenchmarkSnapshot(input?: {
			limit?: number;
			label?: string;
			description?: string;
			version?: number;
			createdAt?: number;
			metadata?: Record<string, unknown>;
			snapshotMetadata?: Record<string, unknown>;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/benchmarks/adaptive-native-planner/snapshots`,
				{
					body: JSON.stringify({
						createdAt: input?.createdAt,
						description: input?.description,
						label: input?.label,
						limit: input?.limit,
						metadata: input?.metadata,
						snapshotMetadata: input?.snapshotMetadata,
						version: input?.version
					}),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGAdaptiveNativePlannerBenchmarkSnapshotResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'Adaptive native planner benchmark snapshot failed'
				);
			}

			return payload;
		},
		async nativeBackendComparisonBenchmark(input?: {
			limit?: number;
			runLimit?: number;
			label?: string;
			description?: string;
			groupKey?: string;
			corpusGroupKey?: string;
		}) {
			const searchParams = new URLSearchParams();
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (typeof input?.runLimit === 'number') {
				searchParams.set('runLimit', String(input.runLimit));
			}
			if (input?.label) {
				searchParams.set('label', input.label);
			}
			if (input?.description) {
				searchParams.set('description', input.description);
			}
			if (input?.groupKey) {
				searchParams.set('benchmarkGroupKey', input.groupKey);
			}
			if (input?.corpusGroupKey) {
				searchParams.set(
					'benchmarkCorpusGroupKey',
					input.corpusGroupKey
				);
			}
			const suffix = searchParams.size ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/benchmarks/native-backend-comparison${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGNativeBackendComparisonBenchmarkResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'Native backend comparison benchmark history failed'
				);
			}

			return payload;
		},
		async runNativeBackendComparisonBenchmark(input?: {
			limit?: number;
			runLimit?: number;
			topK?: number;
			label?: string;
			description?: string;
			groupKey?: string;
			corpusGroupKey?: string;
			persistRun?: boolean;
			baselineRetrievalId?: string;
			candidateRetrievalId?: string;
			retrievals?: Array<{
				id: string;
				label?: string;
				retrieval?: Record<string, unknown> | string;
			}>;
			tags?: string[];
			metadata?: Record<string, unknown>;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/benchmarks/native-backend-comparison/run`,
				{
					body: JSON.stringify({
						baselineRetrievalId: input?.baselineRetrievalId,
						candidateRetrievalId: input?.candidateRetrievalId,
						corpusGroupKey: input?.corpusGroupKey,
						description: input?.description,
						groupKey: input?.groupKey,
						label: input?.label,
						limit: input?.limit,
						metadata: input?.metadata,
						persistRun: input?.persistRun,
						retrievals: input?.retrievals,
						runLimit: input?.runLimit,
						tags: input?.tags,
						topK: input?.topK
					}),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGNativeBackendComparisonBenchmarkResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'Native backend comparison benchmark run failed'
				);
			}

			return payload;
		},
		async saveNativeBackendComparisonBenchmarkSnapshot(input?: {
			limit?: number;
			label?: string;
			description?: string;
			version?: number;
			createdAt?: number;
			metadata?: Record<string, unknown>;
			snapshotMetadata?: Record<string, unknown>;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/benchmarks/native-backend-comparison/snapshots`,
				{
					body: JSON.stringify({
						createdAt: input?.createdAt,
						description: input?.description,
						label: input?.label,
						limit: input?.limit,
						metadata: input?.metadata,
						snapshotMetadata: input?.snapshotMetadata,
						version: input?.version
					}),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGNativeBackendComparisonBenchmarkSnapshotResponse>(
					response
				);
			if (!payload.ok) {
				throw new Error(
					payload.error ??
						'Native backend comparison benchmark snapshot failed'
				);
			}

			return payload;
		},
		async retrievalLaneHandoffs(input?: {
			groupKey?: string;
			sourceRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			limit?: number;
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (input?.sourceRolloutLabel) {
				searchParams.set(
					'sourceRolloutLabel',
					input.sourceRolloutLabel
				);
			}
			if (input?.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffListResponse>(response);
			if (!payload.ok || !payload.handoffs) {
				throw new Error(
					payload.error ?? 'RAG retrieval lane handoff list failed'
				);
			}

			return payload.handoffs;
		},
		async retrievalLaneHandoffDecisions(input?: {
			groupKey?: string;
			sourceRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			kind?: 'approve' | 'reject' | 'complete';
			limit?: number;
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (input?.sourceRolloutLabel) {
				searchParams.set(
					'sourceRolloutLabel',
					input.sourceRolloutLabel
				);
			}
			if (input?.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			if (input?.kind) {
				searchParams.set('kind', input.kind);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/decisions${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffDecisionListResponse>(
					response
				);
			if (!payload.ok || !payload.decisions) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff decision list failed'
				);
			}

			return payload.decisions;
		},
		async retrievalLaneHandoffIncidents(input?: {
			groupKey?: string;
			limit?: number;
			status?: 'open' | 'resolved';
			severity?: 'warning' | 'critical';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) searchParams.set('groupKey', input.groupKey);
			if (typeof input?.limit === 'number')
				searchParams.set('limit', String(input.limit));
			if (input?.status) searchParams.set('status', input.status);
			if (input?.severity) searchParams.set('severity', input.severity);
			if (input?.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/incidents${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff incident list failed'
				);
			}

			return payload.incidents;
		},
		async retrievalLaneHandoffIncidentHistory(input?: {
			action?: 'opened' | 'acknowledged' | 'unacknowledged' | 'resolved';
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/incidents/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffIncidentHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff incident history failed'
				);
			}

			return payload.records;
		},
		async retrievalLaneHandoffAutoCompletePolicyHistory(input?: {
			groupKey?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/policies/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffAutoCompletePolicyHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff auto-complete policy history failed'
				);
			}

			return payload.records;
		},
		async retrievalReleaseLanePolicyHistory(input?: {
			groupKey?: string;
			limit?: number;
			rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			scope?: 'rollout_label' | 'group_rollout_label';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/release-policies/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseLanePolicyHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval release lane policy history failed'
				);
			}

			return payload.records;
		},
		async retrievalBaselineGatePolicyHistory(input?: {
			groupKey?: string;
			limit?: number;
			rolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			scope?: 'rollout_label' | 'group_rollout_label';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/gate-policies/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalBaselineGatePolicyHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval baseline gate policy history failed'
				);
			}

			return payload.records;
		},
		async retrievalReleaseLaneEscalationPolicyHistory(input?: {
			groupKey?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/escalation-policies/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseLaneEscalationPolicyHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval release lane escalation policy history failed'
				);
			}

			return payload.records;
		},
		async retrievalReleaseIncidentPolicyHistory(input?: {
			groupKey?: string;
			limit?: number;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incident-policies/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseLaneEscalationPolicyHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval release incident policy history failed'
				);
			}

			return payload.records;
		},
		async retrievalReleaseIncidentStatus() {
			const response = await fetchImpl(
				`${basePath}/status/release/incidents`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGRetrievalReleaseIncidentStatusResponse>(
				response
			);
		},
		async retrievalIncidentRemediationStatus() {
			const response = await fetchImpl(
				`${basePath}/status/release/remediations`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGRetrievalIncidentRemediationStatusResponse>(
				response
			);
		},
		async retrievalLaneHandoffIncidentStatus() {
			const response = await fetchImpl(
				`${basePath}/status/handoffs/incidents`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGRetrievalLaneHandoffIncidentStatusResponse>(
				response
			);
		},
		async acknowledgeRetrievalLaneHandoffIncident(
			input: RAGRetrievalReleaseIncidentAcknowledgeRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/incidents/acknowledge`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff incident acknowledgement failed'
				);
			}

			return payload.incidents;
		},
		async unacknowledgeRetrievalLaneHandoffIncident(input: {
			incidentId: string;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/incidents/unacknowledge`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff incident unacknowledge failed'
				);
			}

			return payload.incidents;
		},
		async resolveRetrievalLaneHandoffIncident(input: {
			incidentId: string;
			resolvedAt?: number;
			resolvedBy?: string;
			resolutionNotes?: string;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/incidents/resolve`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalLaneHandoffIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff incident resolve failed'
				);
			}

			return payload.incidents;
		},
		async decideRetrievalLaneHandoff(
			input: RAGRetrievalLaneHandoffDecisionRequest
		) {
			const payload =
				await this.decideRetrievalLaneHandoffDetailed(input);
			if (!payload.decision) {
				throw new Error(
					payload.error ??
						'RAG retrieval lane handoff decision failed'
				);
			}
			return payload.decision;
		},
		async decideRetrievalLaneHandoffDetailed(
			input: RAGRetrievalLaneHandoffDecisionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/handoffs/decide`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGRetrievalLaneHandoffDecisionResponse>(response);
		},
		async retrievalReleaseIncidents(input?: {
			groupKey?: string;
			limit?: number;
			status?: 'open' | 'resolved';
			severity?: 'warning' | 'critical';
			kind?:
				| 'approval_expired'
				| 'baseline_regression'
				| 'gate_failure'
				| 'handoff_stale';
			acknowledged?: boolean;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (input?.status) {
				searchParams.set('status', input.status);
			}
			if (input?.severity) {
				searchParams.set('severity', input.severity);
			}
			if (input?.kind) {
				searchParams.set('kind', input.kind);
			}
			if (typeof input?.acknowledged === 'boolean') {
				searchParams.set('acknowledged', String(input.acknowledged));
			}
			if (input?.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval release incident list failed'
				);
			}

			return payload.incidents;
		},
		async retrievalIncidentRemediationDecisions(input?: {
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			remediationKind?: RAGRetrievalIncidentRemediationDecisionRequest['remediationKind'];
			status?: 'planned' | 'applied' | 'dismissed';
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/remediations${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalIncidentRemediationDecisionListResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval incident remediation decision list failed'
				);
			}

			return payload.records;
		},
		async retrievalIncidentRemediationExecutions(input?: {
			groupKey?: string;
			incidentId?: string;
			limit?: number;
			actionKind?: RAGRetrievalIncidentRemediationExecutionRequest['action']['kind'];
			code?: NonNullable<
				RAGRetrievalIncidentRemediationExecutionResponse['execution']
			>['code'];
			blockedByGuardrail?: boolean;
			idempotentReplay?: boolean;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
		}) {
			const suffix = input
				? `?${new URLSearchParams(
						Object.entries(input)
							.filter(([, value]) => value !== undefined)
							.map(([key, value]) => [key, String(value)])
					).toString()}`
				: '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/remediations/executions${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalIncidentRemediationExecutionHistoryResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval incident remediation execution history failed'
				);
			}

			return payload.records;
		},
		async recordRetrievalIncidentRemediationDecision(
			input: RAGRetrievalIncidentRemediationDecisionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/remediations`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalIncidentRemediationDecisionListResponse>(
					response
				);
			if (!payload.ok || !payload.records) {
				throw new Error(
					payload.error ??
						'RAG retrieval incident remediation decision record failed'
				);
			}

			return payload.records;
		},
		async executeRetrievalIncidentRemediation(
			input: RAGRetrievalIncidentRemediationExecutionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/remediations/execute`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalIncidentRemediationExecutionResponse>(
					response
				);
			if (!payload.ok || !payload.execution) {
				throw new Error(
					payload.error ??
						'RAG retrieval incident remediation execution failed'
				);
			}

			return payload;
		},
		async bulkExecuteRetrievalIncidentRemediations(
			input: RAGRetrievalIncidentRemediationBulkExecutionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/remediations/execute/bulk`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalIncidentRemediationBulkExecutionResponse>(
					response
				);
			if (!payload.ok || !payload.results) {
				throw new Error(
					payload.error ??
						'Bulk RAG retrieval incident remediation execution failed'
				);
			}

			return payload.results;
		},
		async acknowledgeRetrievalReleaseIncident(
			input: RAGRetrievalReleaseIncidentAcknowledgeRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/acknowledge`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval release incident acknowledgement failed'
				);
			}

			return payload.incidents;
		},
		async unacknowledgeRetrievalReleaseIncident(input: {
			incidentId: string;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/unacknowledge`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval release incident unacknowledge failed'
				);
			}

			return payload.incidents;
		},
		async resolveRetrievalReleaseIncident(input: {
			incidentId: string;
			resolvedAt?: number;
			resolvedBy?: string;
			resolutionNotes?: string;
		}) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/incidents/resolve`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseIncidentListResponse>(
					response
				);
			if (!payload.ok || !payload.incidents) {
				throw new Error(
					payload.error ??
						'RAG retrieval release incident resolve failed'
				);
			}

			return payload.incidents;
		},
		async retrievalPromotionCandidates(input?: {
			groupKey?: string;
			limit?: number;
			tag?: string;
			targetRolloutLabel?: 'canary' | 'stable' | 'rollback_target';
			approved?: boolean;
			ready?: boolean;
			blocked?: boolean;
			reviewStatus?: 'approved' | 'blocked' | 'needs_review' | 'ready';
			freshnessStatus?: 'fresh' | 'expired' | 'not_applicable';
			sortBy?:
				| 'approvalFreshness'
				| 'finishedAt'
				| 'gateSeverity'
				| 'priority';
			sortDirection?: 'asc' | 'desc';
		}) {
			const searchParams = new URLSearchParams();
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (input?.tag) {
				searchParams.set('tag', input.tag);
			}
			if (input?.targetRolloutLabel) {
				searchParams.set(
					'targetRolloutLabel',
					input.targetRolloutLabel
				);
			}
			if (typeof input?.approved === 'boolean') {
				searchParams.set('approved', String(input.approved));
			}
			if (typeof input?.ready === 'boolean') {
				searchParams.set('ready', String(input.ready));
			}
			if (typeof input?.blocked === 'boolean') {
				searchParams.set('blocked', String(input.blocked));
			}
			if (input?.reviewStatus) {
				searchParams.set('reviewStatus', input.reviewStatus);
			}
			if (input?.freshnessStatus) {
				searchParams.set('freshnessStatus', input.freshnessStatus);
			}
			if (input?.sortBy) {
				searchParams.set('sortBy', input.sortBy);
			}
			if (input?.sortDirection) {
				searchParams.set('sortDirection', input.sortDirection);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/candidates${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalPromotionCandidateListResponse>(
					response
				);
			if (!payload.ok || !payload.candidates) {
				throw new Error(
					payload.error ??
						'RAG retrieval promotion candidate list failed'
				);
			}

			return payload.candidates;
		},
		async approveRetrievalCandidate(
			input: RAGRetrievalReleaseDecisionActionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/approve`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseDecisionListResponse>(
					response
				);
			if (!payload.ok || !payload.decisions) {
				throw new Error(
					payload.error ?? 'RAG retrieval approval failed'
				);
			}

			return payload.decisions;
		},
		async rejectRetrievalCandidate(
			input: RAGRetrievalReleaseDecisionActionRequest
		) {
			const response = await fetchImpl(
				`${basePath}/compare/retrieval/baselines/reject`,
				{
					body: JSON.stringify(input),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseDecisionListResponse>(
					response
				);
			if (!payload.ok || !payload.decisions) {
				throw new Error(
					payload.error ?? 'RAG retrieval rejection failed'
				);
			}

			return payload.decisions;
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
		async analyzeBackend() {
			const response = await fetchImpl(`${basePath}/backend/analyze`, {
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
		async ops() {
			const response = await fetchImpl(`${basePath}/ops`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGOperationsResponse>(response);
		},
		async searchTraceHistory(input?: {
			query?: string;
			groupKey?: string;
			tag?: string;
			limit?: number;
		}) {
			const searchParams = new URLSearchParams();
			if (input?.query) {
				searchParams.set('query', input.query);
			}
			if (input?.groupKey) {
				searchParams.set('groupKey', input.groupKey);
			}
			if (input?.tag) {
				searchParams.set('tag', input.tag);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(`${basePath}/traces${suffix}`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGSearchTraceHistoryResponse>(response);
			if (!payload.ok || !payload.history) {
				throw new Error(
					payload.error ?? 'RAG search trace history failed'
				);
			}

			return payload.history;
		},
		async searchTraceGroups(input?: { tag?: string; limit?: number }) {
			const searchParams = new URLSearchParams();
			if (input?.tag) {
				searchParams.set('tag', input.tag);
			}
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/traces/groups${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGSearchTraceGroupHistoryResponse>(response);
			if (!payload.ok || !payload.history) {
				throw new Error(
					payload.error ?? 'RAG search trace group history failed'
				);
			}

			return payload.history;
		},
		async searchTraceStats(input?: { tag?: string }) {
			const searchParams = new URLSearchParams();
			if (input?.tag) {
				searchParams.set('tag', input.tag);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/traces/stats${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGSearchTraceStatsResponse>(response);
			if (!payload.ok || !payload.stats) {
				throw new Error(
					payload.error ?? 'RAG search trace stats failed'
				);
			}

			return payload.stats;
		},
		async previewSearchTracePrune(input?: {
			maxAgeMs?: number;
			maxRecordsPerQuery?: number;
			maxRecordsPerGroup?: number;
			now?: number;
			tag?: string;
		}) {
			const response = await fetchImpl(
				`${basePath}/traces/prune/preview`,
				{
					body: JSON.stringify(input ?? {}),
					headers: jsonHeaders,
					method: 'POST'
				}
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGSearchTracePrunePreviewResponse>(response);
			if (!payload.ok || !payload.preview) {
				throw new Error(
					payload.error ?? 'RAG search trace prune preview failed'
				);
			}

			return payload.preview;
		},
		async pruneSearchTraces(input?: {
			maxAgeMs?: number;
			maxRecordsPerQuery?: number;
			maxRecordsPerGroup?: number;
			now?: number;
			tag?: string;
		}) {
			const response = await fetchImpl(`${basePath}/traces/prune`, {
				body: JSON.stringify(input ?? {}),
				headers: jsonHeaders,
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGSearchTracePruneResponse>(response);
			if (!payload.ok || !payload.result) {
				throw new Error(
					payload.error ?? 'RAG search trace prune failed'
				);
			}

			return payload;
		},
		async searchTracePruneHistory(input?: {
			limit?: number;
			trigger?: 'manual' | 'write' | 'schedule';
		}) {
			const searchParams = new URLSearchParams();
			if (typeof input?.limit === 'number') {
				searchParams.set('limit', String(input.limit));
			}
			if (input?.trigger) {
				searchParams.set('trigger', input.trigger);
			}
			const suffix = searchParams.size > 0 ? `?${searchParams}` : '';
			const response = await fetchImpl(
				`${basePath}/traces/prune/history${suffix}`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGSearchTracePruneHistoryResponse>(response);
			if (!payload.ok || !payload.runs) {
				throw new Error(
					payload.error ?? 'RAG search trace prune history failed'
				);
			}

			return payload.runs;
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
		async rebuildNativeIndex() {
			const response = await fetchImpl(
				`${basePath}/backend/reindex-native`,
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
		search,
		async searchWithTrace(input: RAGSearchRequest) {
			return search({ ...input, includeTrace: true });
		},
		/**
		 * @deprecated Use `searchWithTrace` for trace-aware search responses.
		 */
		async searchDetailed(input: RAGSearchRequest) {
			return search({ ...input, includeTrace: true });
		},
		async status() {
			const response = await fetchImpl(`${basePath}/status`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGStatusResponse>(response);
		},
		async statusMaintenance() {
			const response = await fetchImpl(`${basePath}/status/maintenance`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGStatusResponse>(response);
		},
		async retrievalReleaseStatus() {
			const response = await fetchImpl(`${basePath}/status/release`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			const payload =
				await parseJson<RAGRetrievalReleaseStatusResponse>(response);
			return payload.retrievalComparisons;
		},
		async retrievalReleaseDriftStatus() {
			const response = await fetchImpl(
				`${basePath}/status/release/drift`
			);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGRetrievalReleaseDriftStatusResponse>(response);
		},
		async retrievalLaneHandoffStatus() {
			const response = await fetchImpl(`${basePath}/status/handoffs`);

			if (!response.ok) {
				throw new Error(await toErrorMessage(response));
			}

			return parseJson<RAGRetrievalLaneHandoffStatusResponse>(response);
		}
	};
};

export type RAGClient = ReturnType<typeof createRAGClient>;
