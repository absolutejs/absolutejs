import { describe, expect, it } from 'bun:test';
import { resolveRAGWorkflowRenderers } from '../../../../src/ai/rag/htmxWorkflowRenderers';

describe('resolveRAGWorkflowRenderers', () => {
	it('renders workflow fragments with sane defaults', () => {
		const renderers = resolveRAGWorkflowRenderers();

		expect(
			renderers.status({
				retrievalComparisons: {
					configured: true,
					alerts: [
						{
							candidateRetrievalId: 'hybrid',
							classification: 'multivector',
							groupKey: 'docs-release',
							kind: 'baseline_gate_failed',
							latestRunId: 'run-1',
							message:
								'Candidate retrieval failed the active baseline gate. multivector lexical-hit delta -1 is below 0',
							severity: 'warning'
						}
					],
					latest: {
						bestByAverageF1: 'hybrid',
						bestByMultivectorCollapsedCases: 'hybrid',
						bestByMultivectorLexicalHitCases: 'hybrid',
						bestByMultivectorVectorHitCases: 'vector',
						bestByPassingRate: 'hybrid',
						elapsedMs: 12,
						finishedAt: 1713523200000,
						groupKey: 'docs-release',
						id: 'run-1',
						label: 'Docs retrieval benchmark',
						suiteId: 'suite-1',
						suiteLabel: 'Docs retrieval benchmark'
					},
					releaseGroups: [
						{
							actionRequired: true,
							actionRequiredReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							approvalRequired: false,
							blockedReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							classification: 'multivector',
							escalationSeverity: 'critical',
							groupKey: 'docs-release',
							acknowledgedOpenIncidentCount: 0,
							openIncidentCount: 1,
							pendingCandidateCount: 0,
							recommendedAction: 'investigate_regression',
							recommendedActionReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							unacknowledgedOpenIncidentCount: 1
						}
					]
				},
				capabilities: {
					backend: 'sqlite',
					nativeVectorSearch: true,
					persistence: 'embedded',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				status: {
					backend: 'sqlite',
					dimensions: 24,
					native: {
						active: true,
						available: true,
						databaseBytes: 16384,
						distanceMetric: 'cosine',
						freelistCount: 6,
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'vec0',
						pageCount: 20,
						requested: true,
						rowCount: 12,
						tableName: 'rag_chunks_vec0'
					},
					vectorMode: 'native_vec0'
				}
			})
		).toContain('rag_chunks_vec0');
		expect(
			renderers.status({
				retrievalComparisons: {
					configured: true,
					alerts: [
						{
							classification: 'multivector',
							groupKey: 'docs-release',
							kind: 'baseline_gate_failed',
							latestRunId: 'run-1',
							message:
								'Candidate retrieval failed the active baseline gate. multivector lexical-hit delta -1 is below 0',
							severity: 'warning'
						}
					],
					latest: {
						bestByAverageF1: 'hybrid',
						bestByMultivectorCollapsedCases: 'hybrid',
						bestByMultivectorLexicalHitCases: 'hybrid',
						bestByMultivectorVectorHitCases: 'vector',
						bestByPassingRate: 'hybrid',
						elapsedMs: 12,
						finishedAt: 1713523200000,
						groupKey: 'docs-release',
						id: 'run-1',
						label: 'Docs retrieval benchmark',
						suiteId: 'suite-1',
						suiteLabel: 'Docs retrieval benchmark'
					},
					releaseGroups: [
						{
							actionRequired: true,
							actionRequiredReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							approvalRequired: false,
							blockedReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							classification: 'multivector',
							escalationSeverity: 'critical',
							groupKey: 'docs-release',
							acknowledgedOpenIncidentCount: 0,
							openIncidentCount: 1,
							pendingCandidateCount: 0,
							recommendedAction: 'investigate_regression',
							recommendedActionReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							unacknowledgedOpenIncidentCount: 1
						}
					]
				},
				status: {
					backend: 'sqlite',
					dimensions: 24,
					vectorMode: 'native_vec0'
				}
			})
		).toContain('Best multivector lexical hits');
		expect(
			renderers.status({
				retrievalComparisons: {
					configured: true,
					alerts: [
						{
							classification: 'multivector',
							groupKey: 'docs-release',
							kind: 'baseline_gate_failed',
							latestRunId: 'run-1',
							message:
								'Candidate retrieval failed the active baseline gate. multivector lexical-hit delta -1 is below 0',
							severity: 'warning'
						}
					],
					releaseGroups: [
						{
							actionRequired: true,
							actionRequiredReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							approvalRequired: false,
							blockedReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							classification: 'multivector',
							escalationSeverity: 'critical',
							groupKey: 'docs-release',
							acknowledgedOpenIncidentCount: 0,
							openIncidentCount: 1,
							pendingCandidateCount: 0,
							recommendedAction: 'investigate_regression',
							recommendedActionReasons: [
								'multivector lexical-hit delta -1 is below 0'
							],
							unacknowledgedOpenIncidentCount: 1
						}
					]
				},
				status: {
					backend: 'sqlite',
					dimensions: 24,
					vectorMode: 'native_vec0'
				}
			})
		).toContain('multivector regression');
		expect(
			renderers.status({
				retrievalComparisons: {
					configured: true,
					alerts: [
						{
							classification: 'cue',
							groupKey: 'slides-release',
							kind: 'baseline_gate_failed',
							latestRunId: 'run-2',
							message:
								'Candidate retrieval failed the active baseline gate. presentation notes cue delta -1 is below 0',
							severity: 'warning'
						}
					],
					releaseGroups: [
						{
							actionRequired: true,
							actionRequiredReasons: [
								'presentation notes cue delta -1 is below 0'
							],
							approvalRequired: false,
							blockedReasons: [
								'presentation notes cue delta -1 is below 0'
							],
							classification: 'cue',
							escalationSeverity: 'warning',
							groupKey: 'slides-release',
							acknowledgedOpenIncidentCount: 0,
							openIncidentCount: 1,
							pendingCandidateCount: 0,
							recommendedAction: 'investigate_regression',
							recommendedActionReasons: [
								'presentation notes cue delta -1 is below 0'
							],
							unacknowledgedOpenIncidentCount: 1
						}
					]
				},
				status: {
					backend: 'sqlite',
					dimensions: 24,
					vectorMode: 'native_vec0'
				}
			})
		).toContain('cue regression');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: false,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'sqlite',
					nativeVectorSearch: true,
					persistence: 'embedded',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'sqlite',
					dimensions: 24,
					native: {
						active: true,
						available: true,
						databaseBytes: 16384,
						distanceMetric: 'cosine',
						freelistCount: 6,
						lastHealthCheckAt: 1713523200000,
						mode: 'vec0',
						pageCount: 20,
						requested: true
					},
					vectorMode: 'native_vec0'
				}
			})
		).toContain(
			'Run backend analyze to refresh SQLite planner statistics and optimize storage.'
		);
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				adminActions: [
					{
						action: 'analyze_backend',
						finishedAt: 1713526900000,
						id: 'action-analyze',
						startedAt: 1713526800000,
						status: 'completed'
					},
					{
						action: 'rebuild_native_index',
						error: 'lock timeout',
						finishedAt: 1713527000000,
						id: 'action-reindex',
						startedAt: 1713526950000,
						status: 'failed'
					}
				],
				adminJobs: [
					{
						action: 'rebuild_native_index',
						id: 'job-reindex',
						startedAt: 1713527100000,
						status: 'running'
					}
				],
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('Analyze backend');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('/rag/status/maintenance');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('rag:mutated from:body');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				adminActions: [
					{
						action: 'analyze_backend',
						finishedAt: 1713526900000,
						id: 'action-analyze',
						startedAt: 1713526800000,
						status: 'completed'
					},
					{
						action: 'rebuild_native_index',
						error: 'lock timeout',
						finishedAt: 1713527000000,
						id: 'action-reindex',
						startedAt: 1713526950000,
						status: 'failed'
					}
				],
				adminJobs: [
					{
						action: 'rebuild_native_index',
						id: 'job-reindex',
						startedAt: 1713527100000,
						status: 'running'
					}
				],
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('Backend maintenance');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				adminActions: [
					{
						action: 'analyze_backend',
						finishedAt: 1713526900000,
						id: 'action-analyze',
						startedAt: 1713526800000,
						status: 'completed'
					},
					{
						action: 'rebuild_native_index',
						error: 'lock timeout',
						finishedAt: 1713527000000,
						id: 'action-reindex',
						startedAt: 1713526950000,
						status: 'failed'
					}
				],
				adminJobs: [
					{
						action: 'rebuild_native_index',
						id: 'job-reindex',
						startedAt: 1713527100000,
						status: 'running'
					}
				],
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('Index is missing. Rebuild the native index now.');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				adminActions: [
					{
						action: 'analyze_backend',
						finishedAt: 1713526900000,
						id: 'action-analyze',
						startedAt: 1713526800000,
						status: 'completed'
					},
					{
						action: 'rebuild_native_index',
						error: 'lock timeout',
						finishedAt: 1713527000000,
						id: 'action-reindex',
						startedAt: 1713526950000,
						status: 'failed'
					}
				],
				adminJobs: [
					{
						action: 'rebuild_native_index',
						id: 'job-reindex',
						startedAt: 1713527100000,
						status: 'running'
					}
				],
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('Running');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				adminActions: [
					{
						action: 'analyze_backend',
						finishedAt: 1713526900000,
						id: 'action-analyze',
						startedAt: 1713526800000,
						status: 'completed'
					},
					{
						action: 'rebuild_native_index',
						error: 'lock timeout',
						finishedAt: 1713527000000,
						id: 'action-reindex',
						startedAt: 1713526950000,
						status: 'failed'
					}
				],
				adminJobs: [
					{
						action: 'rebuild_native_index',
						id: 'job-reindex',
						startedAt: 1713527100000,
						status: 'running'
					}
				],
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('lock timeout');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('Index missing');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('Index-heavy storage footprint');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('768 KiB');
		expect(
			renderers.status({
				admin: {
					canAnalyzeBackend: true,
					canClearIndex: false,
					canCreateDocument: false,
					canDeleteDocument: false,
					canListSyncSources: false,
					canManageRetrievalBaselines: false,
					canPruneSearchTraces: false,
					canRebuildNativeIndex: true,
					canReindexDocument: false,
					canReindexSource: false,
					canReseed: false,
					canReset: false,
					canSyncAllSources: false,
					canSyncSource: false
				},
				capabilities: {
					backend: 'postgres',
					nativeVectorSearch: true,
					persistence: 'external',
					serverSideFiltering: true,
					streamingIngestStatus: false
				},
				path: '/rag',
				status: {
					backend: 'postgres',
					dimensions: 1536,
					native: {
						active: true,
						available: true,
						distanceMetric: 'cosine',
						estimatedRowCount: 1200,
						indexBytes: 786432,
						indexName: 'public_rag_chunks_embedding_hnsw_idx',
						indexPresent: false,
						indexType: 'hnsw',
						lastAnalyzeAt: 1713526800000,
						lastHealthCheckAt: 1713523200000,
						mode: 'pgvector',
						requested: true,
						tableBytes: 262144,
						totalBytes: 1048576
					},
					vectorMode: 'native_pgvector'
				}
			})
		).toContain('/rag/backend/reindex-native');

		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							sectionChunkCount: 1,
							sectionChunkId: 'doc-1:section:release-ops',
							sectionChunkIndex: 0,
							sectionPath: ['Release Ops Overview'],
							sectionTitle: 'Release Ops Overview'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Release overview.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							sectionChunkCount: 1,
							sectionChunkId: 'doc-1:section:metadata-filters',
							sectionChunkIndex: 0,
							sectionPath: [
								'Release Ops Overview',
								'Metadata filters'
							],
							sectionTitle: 'Metadata filters'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Metadata filters narrow retrieval.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							sectionChunkCount: 1,
							sectionChunkId: 'doc-1:section:search-quality',
							sectionChunkIndex: 0,
							sectionPath: [
								'Release Ops Overview',
								'Search quality'
							],
							sectionTitle: 'Search quality'
						},
						score: 0.9,
						source: 'guide/demo.md',
						text: 'Search quality improves rankings.'
					}
				]
			})
		).toContain('Metadata filters narrow retrieval.');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 3,
					diversityStrategy: 'none',
					lexicalTopK: 3,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 1,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'vector_search'
						},
						{
							count: 3,
							label: 'Fused retrieval candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'fusion'
						},
						{
							count: 3,
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'rerank'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Section diagnostics');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane',
							sourceAwareChunkReason: 'section_boundary'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					}
				]
			})
		).toContain('Chunk boundary</strong> Chunk boundary section');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane',
							sourceAwareChunkReason: 'section_boundary'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					}
				]
			})
		).toContain(
			'Source-aware scope</strong> Source-aware section Release Ops Overview &gt; Stable Lane'
		);
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane',
							sourceAwareChunkReason: 'section_boundary'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					}
				]
			})
		).toContain('Lead context</strong> Section Stable Lane');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane',
							sourceAwareChunkReason: 'section_boundary'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					}
				]
			})
		).toContain(
			'Lead location</strong> Section Release Ops Overview &gt; Stable Lane'
		);
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 3,
					diversityStrategy: 'none',
					lexicalTopK: 3,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 1,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'vector_search'
						},
						{
							count: 3,
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'rerank'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('rerank');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 3,
					diversityStrategy: 'none',
					lexicalTopK: 3,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 1,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('67% of stage');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 3,
					diversityStrategy: 'none',
					lexicalTopK: 3,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 1,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'vector_search'
						},
						{
							count: 3,
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'rerank'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('rerank_preserved_lead');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 3,
					diversityStrategy: 'none',
					lexicalTopK: 3,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 1,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('final_stage_concentration');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				]
			})
		).toContain('Strongest sibling');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 1,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 1,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								}
							],
							stage: 'vector_search'
						},
						{
							count: 1,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 1,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 1,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Stage flow');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 2,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							stage: 'rerank'
						},
						{
							label: 'Balanced candidates across sources',
							metadata: { strategy: 'round_robin' },
							stage: 'source_balance'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Parent share gap');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 2,
						fused: 2,
						lexical: 2,
						reranked: 2,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [],
					topK: 2,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Peer section');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 2,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							stage: 'rerank'
						},
						{
							label: 'Balanced candidates across sources',
							metadata: { strategy: 'round_robin' },
							stage: 'source_balance'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Channels');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 1,
						fused: 1,
						lexical: 1,
						reranked: 1,
						vector: 1
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							stage: 'rerank'
						}
					],
					topK: 1,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Trace mode');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 2,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								}
							],
							stage: 'vector_search'
						},
						{
							count: 2,
							label: 'Collected lexical candidates',
							sectionCounts: [
								{
									count: 1,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'lexical_search'
						},
						{
							count: 3,
							label: 'Fused retrieval candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'fusion'
						},
						{
							count: 3,
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'rerank'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('Final retention');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 2,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								}
							],
							stage: 'vector_search'
						},
						{
							count: 2,
							label: 'Collected lexical candidates',
							sectionCounts: [
								{
									count: 1,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'lexical_search'
						},
						{
							count: 3,
							label: 'Fused retrieval candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'fusion'
						},
						{
							count: 3,
							label: 'Reranked retrieval candidates',
							metadata: { applied: true },
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'rerank'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters',
					variantQueries: []
				}
			})
		).toContain('retained from lexical_search');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							retrievalQueryOrigin: 'transformed',
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							retrievalQueryOrigin: 'variant',
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							retrievalQueryOrigin: 'primary',
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 2,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								}
							],
							sectionScores: [
								{
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane',
									totalScore: 1.93
								}
							],
							stage: 'vector_search'
						},
						{
							count: 2,
							label: 'Collected lexical candidates',
							sectionCounts: [
								{
									count: 1,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							sectionScores: [
								{
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane',
									totalScore: 0.99
								},
								{
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane',
									totalScore: 0.6
								}
							],
							stage: 'lexical_search'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							sectionScores: [
								{
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane',
									totalScore: 1.93
								},
								{
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane',
									totalScore: 0.6
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters expanded',
					variantQueries: ['approval gates']
				}
			})
		).toContain('Query attribution');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							retrievalChannels: ['vector', 'lexical'],
							retrievalQueryOrigin: 'transformed',
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Stable lane is strongly grounded.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							retrievalChannels: ['vector'],
							retrievalQueryOrigin: 'variant',
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Stable lane keeps multiple hits.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							retrievalChannels: ['lexical'],
							retrievalQueryOrigin: 'primary',
							sectionPath: [
								'Release Ops Overview',
								'Canary Lane'
							],
							sectionTitle: 'Canary Lane'
						},
						score: 0.6,
						source: 'guide/demo.md',
						text: 'Canary lane trails.'
					}
				],
				trace: {
					candidateTopK: 6,
					lexicalTopK: 6,
					mode: 'hybrid',
					query: 'metadata filters',
					resultCounts: {
						final: 3,
						fused: 3,
						lexical: 2,
						reranked: 3,
						vector: 2
					},
					runLexical: true,
					runVector: true,
					steps: [
						{
							count: 2,
							label: 'Collected vector candidates',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								}
							],
							sectionScores: [
								{
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane',
									totalScore: 1.93
								}
							],
							stage: 'vector_search'
						},
						{
							count: 2,
							label: 'Collected lexical candidates',
							sectionCounts: [
								{
									count: 1,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							sectionScores: [
								{
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane',
									totalScore: 0.99
								},
								{
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane',
									totalScore: 0.6
								}
							],
							stage: 'lexical_search'
						},
						{
							count: 3,
							label: 'Finalized retrieval results',
							sectionCounts: [
								{
									count: 2,
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane'
								},
								{
									count: 1,
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane'
								}
							],
							sectionScores: [
								{
									key: 'Release Ops Overview > Stable Lane',
									label: 'Stable Lane',
									totalScore: 1.93
								},
								{
									key: 'Release Ops Overview > Canary Lane',
									label: 'Canary Lane',
									totalScore: 0.6
								}
							],
							stage: 'finalize'
						}
					],
					topK: 3,
					transformedQuery: 'metadata filters expanded',
					variantQueries: ['approval gates']
				}
			})
		).toContain('of stage score');
		expect(
			renderers.searchResults({
				query: 'metadata filters',
				results: [
					{
						chunkId: 'doc-1:000',
						metadata: {
							sectionChunkCount: 1,
							sectionChunkId: 'doc-1:section:release-ops',
							sectionChunkIndex: 0,
							sectionPath: ['Release Ops Overview'],
							sectionTitle: 'Release Ops Overview'
						},
						score: 0.99,
						source: 'guide/demo.md',
						text: 'Release overview.'
					},
					{
						chunkId: 'doc-1:001',
						metadata: {
							sectionChunkCount: 1,
							sectionChunkId: 'doc-1:section:metadata-filters',
							sectionChunkIndex: 0,
							sectionPath: [
								'Release Ops Overview',
								'Metadata filters'
							],
							sectionTitle: 'Metadata filters'
						},
						score: 0.94,
						source: 'guide/demo.md',
						text: 'Metadata filters narrow retrieval.'
					},
					{
						chunkId: 'doc-1:002',
						metadata: {
							sectionChunkCount: 1,
							sectionChunkId: 'doc-1:section:search-quality',
							sectionChunkIndex: 0,
							sectionPath: [
								'Release Ops Overview',
								'Search quality'
							],
							sectionTitle: 'Search quality'
						},
						score: 0.9,
						source: 'guide/demo.md',
						text: 'Search quality improves rankings.'
					}
				]
			})
		).toContain('Sibling section');

		expect(
			renderers.documents({
				documents: [
					{
						chunkCount: 3,
						chunkStrategy: 'source_aware',
						format: 'markdown',
						id: 'doc-1',
						source: 'guide/demo.md',
						title: 'Demo Guide'
					}
				]
			})
		).toContain('Demo Guide');

		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:001',
						structure: {
							section: {
								path: ['Release Ops Overview'],
								title: 'Release Ops Overview'
							},
							sequence: {
								sectionChunkCount: 1,
								sectionChunkId: 'doc-1:section:release-ops',
								sectionChunkIndex: 0
							}
						},
						text: 'Overview section.'
					},
					{
						chunkId: 'doc-1:002',
						excerpts: {
							chunkExcerpt: 'Stable blockers stay explicit.',
							sectionExcerpt:
								'Overview section. Stable blockers stay explicit.',
							windowExcerpt:
								'Overview section. Stable blockers stay explicit.'
						},
						excerptSelection: {
							mode: 'section',
							reason: 'section_small_enough'
						},
						structure: {
							section: {
								path: [
									'Release Ops Overview',
									'Stable blockers'
								],
								title: 'Stable blockers'
							},
							sequence: {
								nextChunkId: 'doc-1:003',
								previousChunkId: 'doc-1:001',
								sectionChunkCount: 3,
								sectionChunkId: 'doc-1:section:stable-blockers',
								sectionChunkIndex: 1
							}
						},
						text: 'Stable blockers stay explicit.'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.md',
					title: 'Demo Guide'
				},
				normalizedText: 'Stable blockers stay explicit.'
			})
		).toContain('Section path');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:001',
						text: 'Overview section.'
					},
					{
						chunkId: 'doc-1:002',
						excerptSelection: {
							mode: 'section',
							reason: 'section_small_enough'
						},
						excerpts: {
							chunkExcerpt: 'Stable blockers stay explicit.',
							sectionExcerpt:
								'Overview section. Stable blockers stay explicit.',
							windowExcerpt:
								'Overview section. Stable blockers stay explicit.'
						},
						text: 'Stable blockers stay explicit.'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.md',
					title: 'Demo Guide'
				},
				normalizedText: 'Stable blockers stay explicit.'
			})
		).toContain('Preferred excerpt');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:001',
						text: 'Overview section.'
					},
					{
						chunkId: 'doc-1:002',
						excerptSelection: {
							mode: 'section',
							reason: 'section_small_enough'
						},
						excerpts: {
							chunkExcerpt: 'Stable blockers stay explicit.',
							sectionExcerpt:
								'Overview section. Stable blockers stay explicit.',
							windowExcerpt:
								'Overview section. Stable blockers stay explicit.'
						},
						text: 'Stable blockers stay explicit.'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.md',
					title: 'Demo Guide'
				},
				normalizedText: 'Stable blockers stay explicit.'
			})
		).toContain('section small enough');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:001',
						text: 'Overview section.'
					},
					{
						chunkId: 'doc-1:002',
						excerpts: {
							chunkExcerpt: 'Stable blockers stay explicit.',
							sectionExcerpt:
								'Overview section. Stable blockers stay explicit.',
							windowExcerpt:
								'Overview section. Stable blockers stay explicit.'
						},
						text: 'Stable blockers stay explicit.'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.md',
					title: 'Demo Guide'
				},
				normalizedText: 'Stable blockers stay explicit.'
			})
		).toContain('Neighbor window');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:001',
						structure: {
							section: {
								path: ['Release Ops Overview'],
								title: 'Release Ops Overview'
							},
							sequence: {
								sectionChunkCount: 1,
								sectionChunkId: 'doc-1:section:release-ops',
								sectionChunkIndex: 0
							}
						},
						text: 'Overview section.'
					},
					{
						chunkId: 'doc-1:002',
						structure: {
							section: {
								path: [
									'Release Ops Overview',
									'Stable blockers'
								],
								title: 'Stable blockers'
							},
							sequence: {
								nextChunkId: 'doc-1:003',
								previousChunkId: 'doc-1:001',
								sectionChunkCount: 3,
								sectionChunkId: 'doc-1:section:stable-blockers',
								sectionChunkIndex: 1
							}
						},
						text: 'Stable blockers stay explicit.'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.md',
					title: 'Demo Guide'
				},
				normalizedText: 'Stable blockers stay explicit.'
			})
		).toContain('Previous');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:001',
						structure: {
							section: {
								path: ['Release Ops Overview'],
								title: 'Release Ops Overview'
							},
							sequence: {
								sectionChunkCount: 1,
								sectionChunkId: 'doc-1:section:release-ops',
								sectionChunkIndex: 0
							}
						},
						text: 'Overview section.'
					},
					{
						chunkId: 'doc-1:002',
						structure: {
							section: {
								path: [
									'Release Ops Overview',
									'Stable blockers'
								],
								title: 'Stable blockers'
							},
							sequence: {
								nextChunkId: 'doc-1:003',
								previousChunkId: 'doc-1:001',
								sectionChunkCount: 3,
								sectionChunkId: 'doc-1:section:stable-blockers',
								sectionChunkIndex: 1
							}
						},
						text: 'Stable blockers stay explicit.'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.md',
					title: 'Demo Guide'
				},
				normalizedText: 'Stable blockers stay explicit.'
			})
		).toContain('Child section');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:010',
						labels: {
							contextLabel: 'PDF table block Page 2 Table Block',
							locatorLabel: 'Page 2 · Table Block 3',
							provenanceLabel: 'PDF native · PDF table block'
						},
						structure: {
							section: {
								kind: 'pdf_block',
								path: ['Page 2 Table Block'],
								title: 'Page 2 Table Block'
							}
						},
						text: 'Metric | Status'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.pdf',
					title: 'Demo PDF'
				},
				normalizedText: 'Metric | Status'
			})
		).toContain('Kind');
		expect(
			renderers.chunkPreview({
				chunks: [
					{
						chunkId: 'doc-1:010',
						labels: {
							contextLabel: 'PDF table block Page 2 Table Block',
							locatorLabel: 'Page 2 · Table Block 3',
							provenanceLabel: 'PDF native · PDF table block'
						},
						structure: {
							section: {
								kind: 'pdf_block',
								path: ['Page 2 Table Block'],
								title: 'Page 2 Table Block'
							}
						},
						text: 'Metric | Status'
					}
				],
				document: {
					id: 'doc-1',
					source: 'guide/demo.pdf',
					title: 'Demo PDF'
				},
				normalizedText: 'Metric | Status'
			})
		).toContain('PDF block');

		expect(
			renderers.evaluateResult({
				cases: [
					{
						caseId: 'doc-hit',
						elapsedMs: 12,
						expectedCount: 1,
						expectedIds: ['guide/demo.md'],
						f1: 1,
						label: 'Demo guide',
						matchedCount: 1,
						matchedIds: ['guide/demo.md'],
						missingIds: [],
						mode: 'source',
						precision: 1,
						query: 'retrieval workflow',
						recall: 1,
						retrievedCount: 1,
						retrievedIds: ['guide/demo.md'],
						status: 'pass',
						topK: 3
					}
				],
				summary: {
					averageF1: 1,
					averageLatencyMs: 12,
					averagePrecision: 1,
					averageRecall: 1,
					failedCases: 0,
					partialCases: 0,
					passedCases: 1,
					totalCases: 1
				}
			})
		).toContain('Evaluation');

		expect(
			renderers.adaptiveNativePlannerBenchmark({
				ok: true,
				suite: {
					id: 'rag-native-planner-larger-corpus',
					input: { cases: [] },
					label: 'Adaptive native planner benchmark'
				},
				historyPresentation: {
					recentRuns: [
						{
							label: 'Run A',
							rows: [],
							runId: 'run-a',
							summary: 'Run A · runtime gate blocked'
						}
					],
					rows: [
						{ label: 'Latest decision', value: 'blocked' },
						{ label: 'Recent runtime-blocked runs', value: '1' }
					],
					summary: 'blocked · 1 recent runs'
				},
				snapshotHistoryPresentation: {
					rows: [
						{ label: 'Snapshots recorded', value: '1' },
						{ label: 'Latest snapshot', value: 'v1 · 3 cases' }
					],
					snapshots: [
						{
							id: 'snapshot-1',
							label: 'Adaptive suite',
							rows: [],
							summary: 'v1 · 3 cases',
							version: 1
						}
					],
					summary: 'v1'
				}
			})
		).toContain('Adaptive native planner benchmark');
		expect(
			renderers.adaptiveNativePlannerBenchmarkSnapshot({
				ok: true,
				suite: {
					id: 'rag-native-planner-larger-corpus',
					input: { cases: [] },
					label: 'Adaptive native planner benchmark'
				},
				snapshotHistoryPresentation: {
					rows: [
						{
							label: 'Suite snapshots',
							value: 'No saved suite snapshots yet.'
						}
					],
					snapshots: [],
					summary: 'No saved suite snapshots yet.'
				}
			})
		).toContain('No saved suite snapshots yet.');
		expect(
			renderers.spreadsheetCueBenchmark({
				ok: true,
				suite: {
					id: 'rag-spreadsheet-cue-parity',
					input: { cases: [] },
					label: 'Spreadsheet Cue Benchmark'
				},
				historyPresentation: {
					recentRuns: [
						{
							label: 'Run A',
							rows: [],
							runId: 'run-a',
							summary: 'Run A · cue gate blocked'
						}
					],
					rows: [
						{ label: 'Latest decision', value: 'blocked' },
						{ label: 'Recent cue-blocked runs', value: '1' }
					],
					summary: 'blocked · 1 recent runs'
				},
				snapshotHistoryPresentation: {
					rows: [
						{ label: 'Snapshots recorded', value: '1' },
						{ label: 'Latest snapshot', value: 'v1 · 3 cases' }
					],
					snapshots: [
						{
							id: 'snapshot-1',
							label: 'Spreadsheet suite',
							rows: [],
							summary: 'v1 · 3 cases',
							version: 1
						}
					],
					summary: 'v1'
				}
			})
		).toContain('Spreadsheet Cue Benchmark');
	});

	it('supports overriding individual renderers', () => {
		const renderers = resolveRAGWorkflowRenderers({
			error: (message) => `<p>${message}</p>`
		});

		expect(renderers.error('broken')).toBe('<p>broken</p>');
	});
});
