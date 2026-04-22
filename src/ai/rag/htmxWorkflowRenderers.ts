import type {
	RAGAdminActionRecord,
	RAGAdminJobRecord,
	RAGAdaptiveNativePlannerBenchmarkResponse,
	RAGAdaptiveNativePlannerBenchmarkSnapshotResponse,
	RAGBackendMaintenanceSummary,
	RAGEvaluationCaseResult,
	RAGEvaluationSummary,
	RAGBackendCapabilities,
	RAGExcerptSelection,
	RAGChunkStructure,
	RAGDocumentChunkPreview,
	RAGDocumentSummary,
	RAGHTMXWorkflowRenderConfig,
	RAGIndexedDocument,
	RAGNativeBackendComparisonBenchmarkResponse,
	RAGNativeBackendComparisonBenchmarkSnapshotResponse,
	RAGPresentationCueBenchmarkResponse,
	RAGPresentationCueBenchmarkSnapshotResponse,
	RAGSpreadsheetCueBenchmarkResponse,
	RAGSpreadsheetCueBenchmarkSnapshotResponse,
	RAGSectionRetrievalDiagnostic,
	RAGMutationResponse,
	RAGOperationsResponse,
	RAGSearchResponse,
	RAGSource,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { RAG_SEARCH_SCORE_DECIMAL_PLACES } from '../../constants';
import {
	buildRAGSectionRetrievalDiagnostics,
	buildRAGChunkGraph,
	buildRAGChunkGraphNavigation,
	buildRAGChunkPreviewGraph
} from './presentation';

export type ResolvedRAGWorkflowRenderers =
	Required<RAGHTMXWorkflowRenderConfig>;

const escapeHtml = (text: string) =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const renderLabelValueRows = (rows: Array<{ label: string; value: string }>) =>
	rows.length > 0
		? `<dl class="rag-status">${rows
				.map(
					(row) =>
						`<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`
				)
				.join('')}</dl>`
		: '';

const renderBenchmarkRuntimePanel = (input: {
	title: string;
	response:
		| RAGAdaptiveNativePlannerBenchmarkResponse
		| RAGNativeBackendComparisonBenchmarkResponse
		| RAGPresentationCueBenchmarkResponse
		| RAGSpreadsheetCueBenchmarkResponse;
}) => {
	const rows = [
		{
			label: 'Suite',
			value:
				input.response.suite?.label ?? input.response.suite?.id ?? 'n/a'
		},
		input.response.groupKey
			? { label: 'Group', value: input.response.groupKey }
			: undefined,
		input.response.corpusGroupKey
			? { label: 'Corpus group', value: input.response.corpusGroupKey }
			: undefined
	].filter((row): row is { label: string; value: string } => Boolean(row));
	const latestRows = input.response.historyPresentation?.rows ?? [];
	const recentRuns = input.response.historyPresentation?.recentRuns ?? [];
	const snapshotRows = input.response.snapshotHistoryPresentation?.rows ?? [];
	const snapshots =
		input.response.snapshotHistoryPresentation?.snapshots ?? [];

	return (
		`<section class="rag-status-governance"><h3>${escapeHtml(input.title)}</h3>` +
		renderLabelValueRows(rows) +
		`<h4>Run history</h4>` +
		renderLabelValueRows(latestRows) +
		(recentRuns.length > 0
			? `<ul class="rag-status-capabilities">${recentRuns
					.slice(0, 3)
					.map(
						(run) =>
							`<li><strong>${escapeHtml(run.label)}</strong> ${escapeHtml(run.summary)}</li>`
					)
					.join('')}</ul>`
			: `<p class="rag-empty">No persisted benchmark runs yet.</p>`) +
		`<h4>Snapshot history</h4>` +
		renderLabelValueRows(snapshotRows) +
		(snapshots.length > 0
			? `<ul class="rag-status-capabilities">${snapshots
					.slice(0, 3)
					.map(
						(snapshot) =>
							`<li><strong>${escapeHtml(snapshot.label)}</strong> ${escapeHtml(snapshot.summary)}</li>`
					)
					.join('')}</ul>`
			: `<p class="rag-empty">No saved suite snapshots yet.</p>`) +
		`</section>`
	);
};

const renderBenchmarkSnapshotPanel = (input: {
	title: string;
	response:
		| RAGAdaptiveNativePlannerBenchmarkSnapshotResponse
		| RAGNativeBackendComparisonBenchmarkSnapshotResponse
		| RAGPresentationCueBenchmarkSnapshotResponse
		| RAGSpreadsheetCueBenchmarkSnapshotResponse;
}) => {
	const summaryRows = [
		{
			label: 'Suite',
			value:
				input.response.suite?.label ?? input.response.suite?.id ?? 'n/a'
		},
		input.response.snapshot
			? {
					label: 'Saved snapshot',
					value: `${input.response.snapshot.label ?? input.response.snapshot.suiteId} · v${input.response.snapshot.version}`
				}
			: undefined
	].filter((row): row is { label: string; value: string } => Boolean(row));
	const snapshotRows = input.response.snapshotHistoryPresentation?.rows ?? [];
	const snapshots =
		input.response.snapshotHistoryPresentation?.snapshots ?? [];

	return (
		`<section class="rag-status-governance"><h3>${escapeHtml(input.title)}</h3>` +
		renderLabelValueRows(summaryRows) +
		renderLabelValueRows(snapshotRows) +
		(snapshots.length > 0
			? `<ul class="rag-status-capabilities">${snapshots
					.slice(0, 3)
					.map(
						(snapshot) =>
							`<li><strong>${escapeHtml(snapshot.label)}</strong> ${escapeHtml(snapshot.summary)}</li>`
					)
					.join('')}</ul>`
			: `<p class="rag-empty">No saved suite snapshots yet.</p>`) +
		`</section>`
	);
};

const renderSourceLabels = (input?: {
	contextLabel?: string;
	locatorLabel?: string;
	provenanceLabel?: string;
}) => {
	if (!input) {
		return '';
	}

	const rows = [
		input.contextLabel
			? `<li><strong>Context</strong> ${escapeHtml(input.contextLabel)}</li>`
			: '',
		input.locatorLabel
			? `<li><strong>Location</strong> ${escapeHtml(input.locatorLabel)}</li>`
			: '',
		input.provenanceLabel
			? `<li><strong>Provenance</strong> ${escapeHtml(input.provenanceLabel)}</li>`
			: ''
	].filter((row) => row.length > 0);

	return rows.length > 0
		? `<ul class="rag-source-labels">${rows.join('')}</ul>`
		: '';
};

const formatStructureKindLabel = (
	kind?: NonNullable<RAGChunkStructure['section']>['kind']
) => {
	switch (kind) {
		case 'markdown_heading':
			return 'Markdown heading';
		case 'html_heading':
			return 'HTML heading';
		case 'office_heading':
			return 'Office heading';
		case 'office_block':
			return 'Office block';
		case 'pdf_block':
			return 'PDF block';
		case 'spreadsheet_rows':
			return 'Spreadsheet rows';
		case 'presentation_slide':
			return 'Presentation slide';
		default:
			return undefined;
	}
};

const renderChunkStructure = (structure?: RAGChunkStructure) => {
	if (!structure) {
		return '';
	}

	const rows = [
		structure.section?.kind
			? `<li><strong>Kind</strong> ${escapeHtml(formatStructureKindLabel(structure.section.kind) ?? structure.section.kind)}</li>`
			: '',
		structure.section?.title
			? `<li><strong>Section</strong> ${escapeHtml(structure.section.title)}</li>`
			: '',
		structure.section?.path && structure.section.path.length > 1
			? `<li><strong>Section path</strong> ${escapeHtml(structure.section.path.join(' > '))}</li>`
			: '',
		typeof structure.sequence?.sectionChunkIndex === 'number' &&
		typeof structure.sequence?.sectionChunkCount === 'number'
			? `<li><strong>Section chunk</strong> ${structure.sequence.sectionChunkIndex + 1} of ${structure.sequence.sectionChunkCount}</li>`
			: '',
		structure.sequence?.previousChunkId
			? `<li><strong>Previous</strong> ${escapeHtml(structure.sequence.previousChunkId)}</li>`
			: '',
		structure.sequence?.nextChunkId
			? `<li><strong>Next</strong> ${escapeHtml(structure.sequence.nextChunkId)}</li>`
			: ''
	].filter((row) => row.length > 0);

	return rows.length > 0
		? `<ul class="rag-chunk-structure">${rows.join('')}</ul>`
		: '';
};

const renderChunkExcerpts = (input?: {
	chunkExcerpt?: string;
	windowExcerpt?: string;
	sectionExcerpt?: string;
}) => {
	if (!input) {
		return '';
	}

	const rows = [
		input.chunkExcerpt
			? `<li><strong>Chunk excerpt</strong> ${escapeHtml(input.chunkExcerpt)}</li>`
			: '',
		input.windowExcerpt
			? `<li><strong>Neighbor window</strong> ${escapeHtml(input.windowExcerpt)}</li>`
			: '',
		input.sectionExcerpt
			? `<li><strong>Section excerpt</strong> ${escapeHtml(input.sectionExcerpt)}</li>`
			: ''
	].filter((row) => row.length > 0);

	return rows.length > 0
		? `<ul class="rag-chunk-structure">${rows.join('')}</ul>`
		: '';
};

const renderExcerptSelection = (selection?: RAGExcerptSelection) => {
	if (!selection) {
		return '';
	}

	const modeLabel =
		selection.mode === 'chunk'
			? 'Chunk excerpt'
			: selection.mode === 'window'
				? 'Neighbor window'
				: 'Section excerpt';
	const reasonLabel =
		selection.reason === 'single_chunk'
			? 'single chunk'
			: selection.reason === 'chunk_too_narrow'
				? 'chunk too narrow'
				: selection.reason === 'section_small_enough'
					? 'section small enough'
					: 'section too large, used window';

	return `<ul class="rag-chunk-structure"><li><strong>Preferred excerpt</strong> ${escapeHtml(modeLabel)}</li><li><strong>Promotion reason</strong> ${escapeHtml(reasonLabel)}</li></ul>`;
};

const renderSectionJumpList = (
	label: string,
	items: Array<{
		label: string;
		href?: string;
		active?: boolean;
	}>
) => {
	const rows = items
		.map((item) =>
			item.href
				? `<li><strong>${escapeHtml(label)}</strong> <a href="${escapeHtml(item.href)}"${item.active ? ' aria-current="true"' : ''}>${escapeHtml(item.label)}</a></li>`
				: `<li><strong>${escapeHtml(label)}</strong> ${escapeHtml(item.label)}</li>`
		)
		.join('');
	return rows ? `<ul class="rag-chunk-structure">${rows}</ul>` : '';
};

const renderSectionDiagnostics = (
	diagnostics: RAGSectionRetrievalDiagnostic[]
) => {
	if (diagnostics.length === 0) {
		return '';
	}

	return (
		`<section class="rag-search-results"><h3>Section diagnostics</h3>` +
		diagnostics
			.map(
				(diagnostic) =>
					`<article class="rag-search-result" id="rag-section-diagnostic-${escapeHtml(diagnostic.key)}">` +
					`<h4>${escapeHtml(diagnostic.path?.join(' > ') ?? diagnostic.label)}</h4>` +
					`<p class="rag-search-source">${escapeHtml(diagnostic.summary)}</p>` +
					`<ul class="rag-source-labels">` +
					`<li><strong>Top hit</strong> ${diagnostic.bestScore.toFixed(RAG_SEARCH_SCORE_DECIMAL_PLACES)}</li>` +
					`<li><strong>Average</strong> ${diagnostic.averageScore.toFixed(RAG_SEARCH_SCORE_DECIMAL_PLACES)}</li>` +
					`<li><strong>Sources</strong> ${diagnostic.sourceCount}</li>` +
					`<li><strong>Channels</strong> vector ${diagnostic.vectorHits} · lexical ${diagnostic.lexicalHits} · hybrid ${diagnostic.hybridHits}</li>` +
					`${
						diagnostic.topContextLabel
							? `<li><strong>Lead context</strong> ${escapeHtml(diagnostic.topContextLabel)}</li>`
							: ''
					}` +
					`${
						diagnostic.topLocatorLabel
							? `<li><strong>Lead location</strong> ${escapeHtml(diagnostic.topLocatorLabel)}</li>`
							: ''
					}` +
					`${
						diagnostic.sourceAwareChunkReasonLabel
							? `<li><strong>Chunk boundary</strong> ${escapeHtml(diagnostic.sourceAwareChunkReasonLabel)}</li>`
							: ''
					}` +
					`${
						diagnostic.sourceAwareUnitScopeLabel
							? `<li><strong>Source-aware scope</strong> ${escapeHtml(diagnostic.sourceAwareUnitScopeLabel)}</li>`
							: ''
					}` +
					`${
						diagnostic.stageCounts.length > 0
							? `<li><strong>Stage flow</strong> ${escapeHtml(
									diagnostic.stageCounts
										.map(
											(entry) =>
												`${entry.stage} ${entry.count}`
										)
										.join(' → ')
								)}</li>`
							: ''
					}` +
					`${
						diagnostic.firstSeenStage
							? `<li><strong>First seen</strong> ${escapeHtml(diagnostic.firstSeenStage)}</li>`
							: ''
					}` +
					`${
						diagnostic.lastSeenStage
							? `<li><strong>Last seen</strong> ${escapeHtml(diagnostic.lastSeenStage)}</li>`
							: ''
					}` +
					`<li><strong>Query attribution</strong> ${escapeHtml(
						`${diagnostic.queryAttribution.mode} · primary ${diagnostic.queryAttribution.primaryHits} · transformed ${diagnostic.queryAttribution.transformedHits} · variant ${diagnostic.queryAttribution.variantHits}`
					)}</li>` +
					`${
						diagnostic.queryAttribution.reasons.length > 0
							? `<li><strong>Query attribution reasons</strong> ${escapeHtml(
									diagnostic.queryAttribution.reasons.join(
										', '
									)
								)}</li>`
							: ''
					}` +
					`${
						diagnostic.peakStage
							? `<li><strong>Peak stage</strong> ${escapeHtml(diagnostic.peakStage)} (${diagnostic.peakCount})</li>`
							: ''
					}` +
					`${
						typeof diagnostic.finalRetentionRate === 'number'
							? `<li><strong>Final retention</strong> ${(diagnostic.finalRetentionRate * 100).toFixed(0)}%</li>`
							: ''
					}` +
					`${
						typeof diagnostic.dropFromPeak === 'number'
							? `<li><strong>Drop from peak</strong> ${diagnostic.dropFromPeak}</li>`
							: ''
					}` +
					`${
						diagnostic.retrievalMode
							? `<li><strong>Trace mode</strong> ${escapeHtml(diagnostic.retrievalMode)}</li>`
							: ''
					}` +
					`${
						diagnostic.rerankApplied !== undefined
							? `<li><strong>Rerank</strong> ${diagnostic.rerankApplied ? 'applied' : 'skipped'}</li>`
							: ''
					}` +
					`${
						diagnostic.sourceBalanceApplied
							? `<li><strong>Source balance</strong> applied</li>`
							: ''
					}` +
					`${
						diagnostic.scoreThresholdApplied
							? `<li><strong>Score threshold</strong> applied</li>`
							: ''
					}` +
					`<li><strong>Reasons</strong> ${escapeHtml(diagnostic.reasons.join(', ') || 'none')}</li>` +
					`${
						diagnostic.strongestSiblingLabel
							? `<li><strong>Strongest sibling</strong> ${escapeHtml(diagnostic.strongestSiblingLabel)} (${diagnostic.strongestSiblingScore?.toFixed(RAG_SEARCH_SCORE_DECIMAL_PLACES) ?? 'n/a'})</li>`
							: ''
					}` +
					`${
						typeof diagnostic.parentShareGap === 'number'
							? `<li><strong>Parent share gap</strong> ${(diagnostic.parentShareGap * 100).toFixed(0)}%</li>`
							: ''
					}` +
					`</ul>` +
					`${
						diagnostic.stageWeights.length > 0
							? `<ul class="rag-source-labels">${diagnostic.stageWeights
									.map(
										(entry) =>
											`<li><strong>${escapeHtml(entry.stage)}</strong> ${(entry.stageShare * 100).toFixed(0)}% of stage` +
											`${
												typeof entry.retentionRate ===
												'number'
													? ` · ${(entry.retentionRate * 100).toFixed(0)}% retained from ${escapeHtml(entry.previousStage ?? 'previous')}`
													: ''
											}` +
											`${
												typeof entry.countDelta ===
												'number'
													? ` · delta ${entry.countDelta >= 0 ? '+' : ''}${entry.countDelta}`
													: ''
											}` +
											`${
												typeof entry.stageScoreShare ===
												'number'
													? ` · ${(entry.stageScoreShare * 100).toFixed(0)}% of stage score`
													: ''
											}` +
											`${
												typeof entry.parentStageScoreShare ===
												'number'
													? ` · ${(entry.parentStageScoreShare * 100).toFixed(0)}% of parent stage score`
													: ''
											}` +
											`${
												typeof entry.stageScoreShareGap ===
												'number'
													? ` · score gap ${(entry.stageScoreShareGap * 100).toFixed(0)}%`
													: ''
											}` +
											`${
												typeof entry.parentStageShare ===
												'number'
													? ` · ${(entry.parentStageShare * 100).toFixed(0)}% of parent stage`
													: ''
											}` +
											`${
												typeof entry.stageShareGap ===
												'number'
													? ` · gap ${(entry.stageShareGap * 100).toFixed(0)}%`
													: ''
											}` +
											`${
												entry.strongestSiblingLabel
													? ` · runner-up ${escapeHtml(entry.strongestSiblingLabel)}`
													: ''
											}` +
											`${
												entry.reasons.length > 0
													? ` · ${escapeHtml(entry.reasons.join(', '))}`
													: ''
											}</li>`
									)
									.join('')}</ul>`
							: ''
					}` +
					`${
						diagnostic.parentDistribution.length > 0
							? `<ul class="rag-source-labels">${diagnostic.parentDistribution
									.map(
										(entry) =>
											`<li><strong>${entry.isActive ? 'Active section' : 'Peer section'}</strong> ${escapeHtml(entry.label)} · ${(entry.parentShare * 100).toFixed(0)}% · ${entry.count} hit${entry.count === 1 ? '' : 's'}</li>`
									)
									.join('')}</ul>`
							: ''
					}` +
					`</article>`
			)
			.join('') +
		`</section>`
	);
};

const renderEmptyState = (
	kind:
		| 'documents'
		| 'searchResults'
		| 'chunkPreview'
		| 'status'
		| 'evaluation'
) => {
	switch (kind) {
		case 'documents':
			return '<p class="rag-empty">No documents indexed.</p>';
		case 'searchResults':
			return '<p class="rag-empty">No matching chunks.</p>';
		case 'chunkPreview':
			return '<p class="rag-empty">No chunk preview available.</p>';
		case 'status':
			return '<p class="rag-empty">No status available.</p>';
		case 'evaluation':
			return '<p class="rag-empty">No evaluation results yet.</p>';
		default:
			return '<p class="rag-empty">No results available.</p>';
	}
};

const renderCapabilityList = (capabilities?: RAGBackendCapabilities) => {
	if (!capabilities) {
		return '';
	}

	const items = [
		`backend=${capabilities.backend}`,
		`persistence=${capabilities.persistence}`,
		`nativeVectorSearch=${capabilities.nativeVectorSearch ? 'true' : 'false'}`,
		`serverSideFiltering=${capabilities.serverSideFiltering ? 'true' : 'false'}`,
		`streamingIngestStatus=${capabilities.streamingIngestStatus ? 'true' : 'false'}`
	];

	return `<ul class="rag-status-capabilities">${items
		.map((item) => `<li>${escapeHtml(item)}</li>`)
		.join('')}</ul>`;
};

const formatByteSize = (value?: number) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return 'n/a';
	}

	if (value < 1024) {
		return `${Math.round(value)} B`;
	}

	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KiB`;
	}

	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(
			value >= 10 * 1024 * 1024 ? 0 : 1
		)} MiB`;
	}

	return `${(value / (1024 * 1024 * 1024)).toFixed(
		value >= 10 * 1024 * 1024 * 1024 ? 0 : 1
	)} GiB`;
};

const renderPostgresNativeStatus = (status?: RAGVectorStoreStatus) => {
	if (
		status?.backend !== 'postgres' ||
		!status.native ||
		!('mode' in status.native) ||
		status.native.mode !== 'pgvector'
	) {
		return '';
	}

	const warnings = [
		status.native.indexPresent === false ? 'Index missing' : '',
		status.native.lastHealthError
			? `Health check failed: ${status.native.lastHealthError}`
			: '',
		status.native.lastAnalyzeError
			? `Analyze failed: ${status.native.lastAnalyzeError}`
			: '',
		status.native.lastReindexError
			? `Native index rebuild failed: ${status.native.lastReindexError}`
			: '',
		typeof status.native.indexBytes === 'number' &&
		typeof status.native.totalBytes === 'number' &&
		status.native.totalBytes > 0 &&
		status.native.indexBytes / status.native.totalBytes >= 0.7
			? 'Index-heavy storage footprint'
			: ''
	].filter((entry) => entry.length > 0);

	return (
		`<dl class="rag-status">` +
		`<div><dt>Index type</dt><dd>${escapeHtml(status.native.indexType ?? 'n/a')}</dd></div>` +
		`<div><dt>Index name</dt><dd>${escapeHtml(status.native.indexName ?? 'n/a')}</dd></div>` +
		`<div><dt>Index present</dt><dd>${typeof status.native.indexPresent === 'boolean' ? (status.native.indexPresent ? 'true' : 'false') : 'n/a'}</dd></div>` +
		`<div><dt>Estimated rows</dt><dd>${typeof status.native.estimatedRowCount === 'number' ? String(status.native.estimatedRowCount) : 'n/a'}</dd></div>` +
		`<div><dt>Table bytes</dt><dd>${formatByteSize(status.native.tableBytes)}</dd></div>` +
		`<div><dt>Index bytes</dt><dd>${formatByteSize(status.native.indexBytes)}</dd></div>` +
		`<div><dt>Total bytes</dt><dd>${formatByteSize(status.native.totalBytes)}</dd></div>` +
		`<div><dt>Health check</dt><dd>${typeof status.native.lastHealthCheckAt === 'number' ? escapeHtml(new Date(status.native.lastHealthCheckAt).toLocaleString('en-US')) : 'n/a'}</dd></div>` +
		`<div><dt>Last analyze</dt><dd>${typeof status.native.lastAnalyzeAt === 'number' ? escapeHtml(new Date(status.native.lastAnalyzeAt).toLocaleString('en-US')) : 'n/a'}</dd></div>` +
		`<div><dt>Last index rebuild</dt><dd>${typeof status.native.lastReindexAt === 'number' ? escapeHtml(new Date(status.native.lastReindexAt).toLocaleString('en-US')) : 'n/a'}</dd></div>` +
		`</dl>` +
		(warnings.length > 0
			? `<ul class="rag-status-capabilities">${warnings
					.map((warning) => `<li>${escapeHtml(warning)}</li>`)
					.join('')}</ul>`
			: '')
	);
};

const renderSQLiteNativeStatus = (status?: RAGVectorStoreStatus) => {
	if (
		status?.backend !== 'sqlite' ||
		!status.native ||
		!('mode' in status.native) ||
		status.native.mode !== 'vec0'
	) {
		return '';
	}

	const warnings = [
		status.native.lastLoadError
			? `Native sqlite-vec failed to load: ${status.native.lastLoadError}`
			: '',
		status.native.lastHealthError
			? `Health check failed: ${status.native.lastHealthError}`
			: '',
		status.native.lastAnalyzeError
			? `Analyze failed: ${status.native.lastAnalyzeError}`
			: '',
		typeof status.native.pageCount === 'number' &&
		typeof status.native.freelistCount === 'number' &&
		status.native.pageCount > 0 &&
		status.native.freelistCount / status.native.pageCount >= 0.2
			? 'SQLite freelist growth suggests running optimize'
			: ''
	].filter((entry) => entry.length > 0);

	return (
		`<dl class="rag-status">` +
		`<div><dt>Native table</dt><dd>${escapeHtml(status.native.tableName ?? 'n/a')}</dd></div>` +
		`<div><dt>Distance metric</dt><dd>${escapeHtml(status.native.distanceMetric ?? 'n/a')}</dd></div>` +
		`<div><dt>Native active</dt><dd>${status.native.active ? 'true' : 'false'}</dd></div>` +
		`<div><dt>Row count</dt><dd>${typeof status.native.rowCount === 'number' ? String(status.native.rowCount) : 'n/a'}</dd></div>` +
		`<div><dt>Database bytes</dt><dd>${formatByteSize(status.native.databaseBytes)}</dd></div>` +
		`<div><dt>Page count</dt><dd>${typeof status.native.pageCount === 'number' ? String(status.native.pageCount) : 'n/a'}</dd></div>` +
		`<div><dt>Freelist pages</dt><dd>${typeof status.native.freelistCount === 'number' ? String(status.native.freelistCount) : 'n/a'}</dd></div>` +
		`<div><dt>Health check</dt><dd>${typeof status.native.lastHealthCheckAt === 'number' ? escapeHtml(new Date(status.native.lastHealthCheckAt).toLocaleString('en-US')) : 'n/a'}</dd></div>` +
		`<div><dt>Last analyze</dt><dd>${typeof status.native.lastAnalyzeAt === 'number' ? escapeHtml(new Date(status.native.lastAnalyzeAt).toLocaleString('en-US')) : 'n/a'}</dd></div>` +
		`</dl>` +
		(warnings.length > 0
			? `<ul class="rag-status-capabilities">${warnings
					.map((warning) => `<li>${escapeHtml(warning)}</li>`)
					.join('')}</ul>`
			: '')
	);
};

const renderStatusActions = (input: {
	admin?: {
		canAnalyzeBackend?: boolean;
		canRebuildNativeIndex?: boolean;
	};
	path?: string;
	status?: RAGVectorStoreStatus;
}) => {
	if (!input.path) {
		return '';
	}

	const actions = [
		input.admin?.canAnalyzeBackend
			? `<button type="button" hx-post="${escapeHtml(`${input.path}/backend/analyze`)}" hx-target="#rag-status-feedback" hx-swap="innerHTML">Analyze backend</button>`
			: '',
		input.status?.backend === 'postgres' &&
		input.admin?.canRebuildNativeIndex
			? `<button type="button" hx-post="${escapeHtml(`${input.path}/backend/reindex-native`)}" hx-target="#rag-status-feedback" hx-swap="innerHTML">Rebuild native index</button>`
			: ''
	].filter((entry) => entry.length > 0);

	if (actions.length === 0) {
		return '';
	}

	return (
		`<div class="rag-status-actions">${actions.join('')}</div>` +
		`<div id="rag-status-feedback" class="rag-status-feedback"></div>`
	);
};

const renderBackendMaintenance = (input: {
	admin?: {
		canAnalyzeBackend?: boolean;
		canRebuildNativeIndex?: boolean;
	};
	adminActions?: RAGAdminActionRecord[];
	adminJobs?: RAGAdminJobRecord[];
	status?: RAGVectorStoreStatus;
}) => {
	if (!input.status?.native || !('mode' in input.status.native)) {
		return '';
	}

	const recommendations =
		input.status.backend === 'postgres' &&
		input.status.native.mode === 'pgvector'
			? [
					input.status.native.indexPresent === false &&
					input.admin?.canRebuildNativeIndex
						? 'Index is missing. Rebuild the native index now.'
						: '',
					input.status.native.lastHealthError &&
					input.admin?.canAnalyzeBackend
						? 'Health checks are failing. Run analyze after correcting backend state.'
						: '',
					typeof input.status.native.estimatedRowCount === 'number' &&
					input.status.native.estimatedRowCount >= 1000 &&
					typeof input.status.native.lastAnalyzeAt !== 'number' &&
					input.admin?.canAnalyzeBackend
						? 'Larger corpus detected without analyze history. Run analyze to refresh planner statistics.'
						: '',
					typeof input.status.native.lastReindexAt === 'number' &&
					(typeof input.status.native.lastAnalyzeAt !== 'number' ||
						input.status.native.lastAnalyzeAt <
							input.status.native.lastReindexAt) &&
					input.admin?.canAnalyzeBackend
						? 'Analyze is older than the last index rebuild. Refresh planner statistics.'
						: ''
				]
			: input.status.backend === 'sqlite' &&
				  input.status.native.mode === 'vec0'
				? [
						input.status.native.lastLoadError
							? 'Native sqlite-vec is inactive. Fix extension loading before expecting native acceleration.'
							: '',
						input.status.native.active &&
						typeof input.status.native.lastAnalyzeAt !== 'number' &&
						input.admin?.canAnalyzeBackend
							? 'Run backend analyze to refresh SQLite planner statistics and optimize storage.'
							: '',
						typeof input.status.native.pageCount === 'number' &&
						typeof input.status.native.freelistCount === 'number' &&
						input.status.native.pageCount > 0 &&
						input.status.native.freelistCount /
							input.status.native.pageCount >=
							0.2 &&
						input.admin?.canAnalyzeBackend
							? 'SQLite freelist growth is high. Run backend analyze to let SQLite optimize storage.'
							: '',
						(input.status.native.lastQueryError ||
							input.status.native.lastUpsertError) &&
						input.admin?.canAnalyzeBackend
							? 'Native sqlite-vec saw recent errors. Run backend analyze after correcting database state.'
							: ''
					]
				: [];

	const activeJobs = (input.adminJobs ?? []).filter(
		(job) =>
			job.status === 'running' &&
			(job.action === 'analyze_backend' ||
				job.action === 'rebuild_native_index')
	);
	const recentActions = (input.adminActions ?? [])
		.filter(
			(action) =>
				action.action === 'analyze_backend' ||
				action.action === 'rebuild_native_index'
		)
		.slice(0, 4);

	if (
		recommendations.length === 0 &&
		activeJobs.length === 0 &&
		recentActions.length === 0
	) {
		return '';
	}

	return (
		`<section class="rag-status-maintenance">` +
		`<h3>Backend maintenance</h3>` +
		(recommendations.length > 0
			? `<ul class="rag-status-capabilities">${recommendations
					.map((entry) => `<li>${escapeHtml(entry)}</li>`)
					.join('')}</ul>`
			: '<p class="rag-empty">No immediate maintenance recommendations.</p>') +
		(activeJobs.length > 0
			? `<ul class="rag-status-capabilities">${activeJobs
					.map(
						(job) =>
							`<li><strong>Running</strong> ${escapeHtml(job.action)}${job.target ? ` · ${escapeHtml(job.target)}` : ''}</li>`
					)
					.join('')}</ul>`
			: '') +
		(recentActions.length > 0
			? `<ul class="rag-status-capabilities">${recentActions
					.map(
						(action) =>
							`<li><strong>${escapeHtml(action.action)}</strong> ${escapeHtml(action.status)}${typeof action.finishedAt === 'number' ? ` · ${escapeHtml(new Date(action.finishedAt).toLocaleString('en-US'))}` : ''}${action.error ? ` · ${escapeHtml(action.error)}` : ''}</li>`
					)
					.join('')}</ul>`
			: '') +
		`</section>`
	);
};

const renderMaintenancePanel = (input: {
	admin?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['maintenance']>
	>[0]['admin'];
	adminActions?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['maintenance']>
	>[0]['adminActions'];
	adminJobs?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['maintenance']>
	>[0]['adminJobs'];
	maintenance?: RAGBackendMaintenanceSummary;
	path?: string;
	status?: RAGVectorStoreStatus;
}) => {
	void input.maintenance;

	const content =
		renderBackendMaintenance({
			admin: input.admin,
			adminActions: input.adminActions,
			adminJobs: input.adminJobs,
			status: input.status
		}) ||
		(input.status && input.status.backend !== 'in_memory'
			? `<section class="rag-status-maintenance"><h3>Backend maintenance</h3><p class="rag-empty">No immediate maintenance recommendations.</p></section>`
			: renderEmptyState('status'));

	const route = input.path ? `${input.path}/status/maintenance` : undefined;

	return route
		? `<div id="rag-status-maintenance-panel" hx-get="${escapeHtml(route)}" hx-trigger="load, rag:mutated from:body" hx-swap="outerHTML">${content}</div>`
		: `<div id="rag-status-maintenance-panel">${content}</div>`;
};

const renderRetrievalGovernancePanel = (
	retrievalComparisons?: RAGOperationsResponse['retrievalComparisons']
) => {
	if (
		!retrievalComparisons?.latest &&
		!retrievalComparisons?.alerts?.length
	) {
		return '';
	}

	const latest = retrievalComparisons.latest;
	const alerts = (retrievalComparisons.alerts ?? []).slice(0, 3);
	const releaseGroups = (retrievalComparisons.releaseGroups ?? []).slice(
		0,
		2
	);
	const formatClassification = (
		classification?:
			| 'general'
			| 'multivector'
			| 'runtime'
			| 'evidence'
			| 'cue'
	) =>
		classification === 'multivector'
			? 'multivector regression'
			: classification === 'evidence'
				? 'evidence regression'
				: classification === 'cue'
					? 'cue regression'
					: classification === 'runtime'
						? 'runtime regression'
						: classification === 'general'
							? 'general regression'
							: undefined;

	return (
		`<section class="rag-status-governance"><h3>Retrieval governance</h3>` +
		(latest
			? `<dl class="rag-status">` +
				`<div><dt>Latest comparison</dt><dd>${escapeHtml(latest.label)}</dd></div>` +
				(latest.bestByPassingRate
					? `<div><dt>Best passing rate</dt><dd>${escapeHtml(latest.bestByPassingRate)}</dd></div>`
					: '') +
				(latest.bestByAverageF1
					? `<div><dt>Best average F1</dt><dd>${escapeHtml(latest.bestByAverageF1)}</dd></div>`
					: '') +
				(latest.bestByMultivectorCollapsedCases
					? `<div><dt>Best multivector collapse</dt><dd>${escapeHtml(latest.bestByMultivectorCollapsedCases)}</dd></div>`
					: '') +
				(latest.bestByMultivectorLexicalHitCases
					? `<div><dt>Best multivector lexical hits</dt><dd>${escapeHtml(latest.bestByMultivectorLexicalHitCases)}</dd></div>`
					: '') +
				(latest.bestByMultivectorVectorHitCases
					? `<div><dt>Best multivector vector hits</dt><dd>${escapeHtml(latest.bestByMultivectorVectorHitCases)}</dd></div>`
					: '') +
				(latest.decisionSummary?.gate?.status
					? `<div><dt>Gate</dt><dd>${escapeHtml(latest.decisionSummary.gate.status)}</dd></div>`
					: '') +
				(latest.releaseVerdict?.status
					? `<div><dt>Verdict</dt><dd>${escapeHtml(latest.releaseVerdict.status)}</dd></div>`
					: '') +
				`</dl>`
			: '') +
		`<h4>Active alerts</h4>` +
		(alerts.length > 0
			? `<ul class="rag-status-capabilities">${alerts
					.map(
						(alert) =>
							`<li><strong>${escapeHtml(alert.kind)}</strong>${formatClassification(alert.classification) ? ` <span>${escapeHtml(formatClassification(alert.classification) ?? '')}</span>` : ''} ${escapeHtml(alert.message)}</li>`
					)
					.join('')}</ul>`
			: `<p class="rag-empty">No active retrieval comparison alerts.</p>`) +
		(releaseGroups.length > 0
			? `<h4>Release groups</h4><ul class="rag-status-capabilities">${releaseGroups
					.map((group) => {
						const reasons =
							group.recommendedActionReasons
								?.slice(0, 2)
								.join('; ') ?? 'No recommended action.';
						return `<li><strong>${escapeHtml(group.groupKey)}</strong>${formatClassification(group.classification) ? ` <span>${escapeHtml(formatClassification(group.classification) ?? '')}</span>` : ''} ${escapeHtml(group.recommendedAction ?? 'monitor')} · ${escapeHtml(reasons)}</li>`;
					})
					.join('')}</ul>`
			: '') +
		`</section>`
	);
};

const defaultStatus = ({
	admin,
	adminActions,
	adminJobs,
	maintenance,
	retrievalComparisons,
	path,
	status,
	capabilities,
	documents
}: {
	admin?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['status']>
	>[0]['admin'];
	adminActions?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['status']>
	>[0]['adminActions'];
	adminJobs?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['status']>
	>[0]['adminJobs'];
	maintenance?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['status']>
	>[0]['maintenance'];
	retrievalComparisons?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['status']>
	>[0]['retrievalComparisons'];
	path?: string;
	status?: RAGVectorStoreStatus;
	capabilities?: RAGBackendCapabilities;
	documents?: RAGDocumentSummary;
}) => {
	if (!status) {
		return renderEmptyState('status');
	}

	return (
		`<section class="rag-status-panel">` +
		`<dl class="rag-status">` +
		`<div><dt>Backend</dt><dd>${escapeHtml(status.backend)}</dd></div>` +
		`<div><dt>Vector mode</dt><dd>${escapeHtml(status.vectorMode)}</dd></div>` +
		`<div><dt>Embedding dimensions</dt><dd>${status.dimensions ?? 'n/a'}</dd></div>` +
		`<div><dt>Vector acceleration</dt><dd>${status.native?.active ? 'active' : 'inactive'}</dd></div>` +
		`<div><dt>Documents</dt><dd>${documents?.total ?? 'n/a'}</dd></div>` +
		`<div><dt>Total chunks</dt><dd>${documents?.chunkCount ?? 'n/a'}</dd></div>` +
		`<div><dt>Seed docs</dt><dd>${documents?.byKind.seed ?? 0}</dd></div>` +
		`<div><dt>Custom docs</dt><dd>${documents?.byKind.custom ?? 0}</dd></div>` +
		`</dl>${renderPostgresNativeStatus(status)}${renderSQLiteNativeStatus(status)}${renderRetrievalGovernancePanel(retrievalComparisons)}${renderMaintenancePanel(
			{
				admin,
				adminActions,
				adminJobs,
				maintenance,
				path,
				status
			}
		)}${renderCapabilityList(capabilities)}${renderStatusActions({
			admin,
			path,
			status
		})}</section>`
	);
};

const defaultSearchResultItem = (
	source: RAGSource,
	index: number,
	sectionJumps = ''
) =>
	`<article class="rag-search-result" id="rag-search-result-${escapeHtml(source.chunkId)}">` +
	`<h3>${escapeHtml(source.title ?? source.chunkId ?? `Result ${index + 1}`)}</h3>` +
	`<p class="rag-search-source">${escapeHtml(source.source ?? 'unknown source')}</p>` +
	renderSourceLabels(source.labels) +
	renderChunkStructure(source.structure) +
	sectionJumps +
	`<p class="rag-search-score">score ${source.score.toFixed(RAG_SEARCH_SCORE_DECIMAL_PLACES)}</p>` +
	`<p class="rag-search-text">${escapeHtml(source.text)}</p>` +
	'</article>';

const defaultSearchResults = ({
	query,
	results,
	trace
}: {
	query: string;
	results: RAGSource[];
	trace?: RAGSearchResponse['trace'];
}) =>
	results.length === 0
		? renderEmptyState('searchResults')
		: (() => {
				const graph = buildRAGChunkGraph(results);
				const sectionDiagnostics = buildRAGSectionRetrievalDiagnostics(
					results,
					trace
				);
				const availableChunkIds = new Set(
					results.map((result) => result.chunkId)
				);
				return (
					`<section class="rag-search-results">` +
					`<p class="rag-search-summary">${results.length} results for ${escapeHtml(query)}</p>` +
					`<p class="rag-search-summary">sections=${sectionDiagnostics.length}</p>` +
					(trace
						? `<p class="rag-search-summary">mode=${escapeHtml(trace.mode)} · final=${trace.resultCounts.final} · vector=${trace.resultCounts.vector} · lexical=${trace.resultCounts.lexical}</p>`
						: '') +
					renderSectionDiagnostics(sectionDiagnostics) +
					`${results
						.map((result, index) => {
							const navigation = buildRAGChunkGraphNavigation(
								graph,
								result.chunkId
							);
							const sectionJumps = [
								navigation.parentSection?.leadChunkId
									? renderSectionJumpList('Parent section', [
											{
												href: availableChunkIds.has(
													navigation.parentSection
														.leadChunkId
												)
													? `#rag-search-result-${navigation.parentSection.leadChunkId}`
													: undefined,
												label:
													navigation.parentSection
														.title ??
													navigation.parentSection.path?.join(
														' > '
													) ??
													navigation.parentSection.id
											}
										])
									: '',
								navigation.siblingSections.length > 0
									? renderSectionJumpList(
											'Sibling section',
											navigation.siblingSections.map(
												(section) => ({
													active:
														section.id ===
														navigation.section?.id,
													href:
														section.leadChunkId &&
														availableChunkIds.has(
															section.leadChunkId
														)
															? `#rag-search-result-${section.leadChunkId}`
															: undefined,
													label:
														section.title ??
														section.path?.join(
															' > '
														) ??
														section.id
												})
											)
										)
									: '',
								navigation.childSections.length > 0
									? renderSectionJumpList(
											'Child section',
											navigation.childSections.map(
												(section) => ({
													href:
														section.leadChunkId &&
														availableChunkIds.has(
															section.leadChunkId
														)
															? `#rag-search-result-${section.leadChunkId}`
															: undefined,
													label:
														section.title ??
														section.path?.join(
															' > '
														) ??
														section.id
												})
											)
										)
									: ''
							].join('');
							return defaultSearchResultItem(
								result,
								index,
								sectionJumps
							);
						})
						.join('')}</section>`
				);
			})();

const defaultAdaptiveNativePlannerBenchmark = (
	input: RAGAdaptiveNativePlannerBenchmarkResponse
) =>
	renderBenchmarkRuntimePanel({
		response: input,
		title: 'Adaptive native planner benchmark'
	});

const defaultNativeBackendComparisonBenchmark = (
	input: RAGNativeBackendComparisonBenchmarkResponse
) =>
	renderBenchmarkRuntimePanel({
		response: input,
		title: 'Native backend comparison benchmark'
	});

const defaultPresentationCueBenchmark = (
	input: RAGPresentationCueBenchmarkResponse
) =>
	renderBenchmarkRuntimePanel({
		response: input,
		title: 'Presentation cue benchmark'
	});

const defaultSpreadsheetCueBenchmark = (
	input: RAGSpreadsheetCueBenchmarkResponse
) =>
	renderBenchmarkRuntimePanel({
		response: input,
		title: 'Spreadsheet cue benchmark'
	});

const defaultAdaptiveNativePlannerBenchmarkSnapshot = (
	input: RAGAdaptiveNativePlannerBenchmarkSnapshotResponse
) =>
	renderBenchmarkSnapshotPanel({
		response: input,
		title: 'Adaptive native planner snapshots'
	});

const defaultNativeBackendComparisonBenchmarkSnapshot = (
	input: RAGNativeBackendComparisonBenchmarkSnapshotResponse
) =>
	renderBenchmarkSnapshotPanel({
		response: input,
		title: 'Native backend comparison snapshots'
	});

const defaultPresentationCueBenchmarkSnapshot = (
	input: RAGPresentationCueBenchmarkSnapshotResponse
) =>
	renderBenchmarkSnapshotPanel({
		response: input,
		title: 'Presentation cue snapshots'
	});

const defaultSpreadsheetCueBenchmarkSnapshot = (
	input: RAGSpreadsheetCueBenchmarkSnapshotResponse
) =>
	renderBenchmarkSnapshotPanel({
		response: input,
		title: 'Spreadsheet cue snapshots'
	});

const defaultDocumentItem = (document: RAGIndexedDocument, index: number) =>
	'<article class="rag-document">' +
	`<h3>${escapeHtml(document.title || `Document ${index + 1}`)}</h3>` +
	`<p class="rag-document-id">${escapeHtml(document.id)}</p>` +
	`<p class="rag-document-source">${escapeHtml(document.source)}</p>` +
	renderSourceLabels(document.labels) +
	`<p class="rag-document-meta">${escapeHtml(document.format ?? 'text')} · ${escapeHtml(document.chunkStrategy ?? 'paragraphs')} · ${document.chunkCount ?? 0} chunks</p>` +
	'</article>';

const defaultDocuments = ({
	documents
}: {
	documents: RAGIndexedDocument[];
}) =>
	documents.length === 0
		? renderEmptyState('documents')
		: `<section class="rag-documents">${documents
				.map((document, index) => defaultDocumentItem(document, index))
				.join('')}</section>`;

const defaultChunkPreview = (input: RAGDocumentChunkPreview) => {
	const graph = buildRAGChunkPreviewGraph(input);
	const navigation = buildRAGChunkGraphNavigation(graph);
	const groups = input.chunks.reduce<
		Array<{
			key: string;
			title: string;
			chunks: typeof input.chunks;
		}>
	>((acc, chunk) => {
		const metadata = chunk.metadata ?? {};
		const kind =
			typeof metadata.sourceNativeKind === 'string'
				? metadata.sourceNativeKind
				: 'document_chunk';
		const locator = chunk.labels?.locatorLabel ?? '';
		const title =
			kind === 'pdf_page'
				? locator || 'PDF pages'
				: kind === 'pdf_region'
					? locator || 'PDF regions'
					: kind === 'spreadsheet_sheet'
						? locator || 'Spreadsheet sheets'
						: kind === 'presentation_slide'
							? locator || 'Presentation slides'
							: kind === 'attachment'
								? locator || 'Attachments'
								: kind === 'archive_entry'
									? locator || 'Archive entries'
									: 'Chunks';
		const key =
			kind === 'document_chunk' ? 'document_chunk' : `${kind}:${title}`;
		const existing = acc.find((entry) => entry.key === key);
		if (existing) {
			existing.chunks.push(chunk);
			return acc;
		}
		acc.push({
			chunks: [chunk],
			key,
			title
		});
		return acc;
	}, []);
	const groupHtml = groups
		.map((group) => {
			const chunkHtml = group.chunks
				.map(
					(chunk) =>
						'<article class="rag-chunk">' +
						`<h5>${escapeHtml(chunk.chunkId)}</h5>` +
						`<p class="rag-chunk-meta">chunk ${typeof chunk.metadata?.chunkIndex === 'number' ? chunk.metadata.chunkIndex : 0} of ${typeof chunk.metadata?.chunkCount === 'number' ? chunk.metadata.chunkCount : input.chunks.length}</p>` +
						renderSourceLabels(chunk.labels) +
						renderChunkStructure(chunk.structure) +
						renderChunkExcerpts(chunk.excerpts) +
						renderExcerptSelection(chunk.excerptSelection) +
						`<pre>${escapeHtml(chunk.text)}</pre>` +
						'</article>'
				)
				.join('');
			return `<section class="rag-chunk-group"><h4>${escapeHtml(group.title)}</h4>${chunkHtml}</section>`;
		})
		.join('');

	return (
		`<section class="rag-chunk-preview">` +
		`<h3>${escapeHtml(input.document.title)}</h3>` +
		`<p class="rag-chunk-preview-source">${escapeHtml(input.document.source)}</p>` +
		renderSourceLabels(input.document.labels) +
		(navigation.parentSection
			? renderSectionJumpList('Parent section', [
					{
						label:
							navigation.parentSection.title ??
							navigation.parentSection.path?.join(' > ') ??
							navigation.parentSection.id
					}
				])
			: '') +
		(navigation.siblingSections.length > 0
			? renderSectionJumpList(
					'Sibling section',
					navigation.siblingSections.map((section) => ({
						label:
							section.title ??
							section.path?.join(' > ') ??
							section.id
					}))
				)
			: '') +
		(navigation.childSections.length > 0
			? renderSectionJumpList(
					'Child section',
					navigation.childSections.map((section) => ({
						label:
							section.title ??
							section.path?.join(' > ') ??
							section.id
					}))
				)
			: '') +
		`<article class="rag-chunk-normalized">` +
		`<h4>Normalized text</h4>` +
		`<pre>${escapeHtml(input.normalizedText)}</pre>` +
		`</article>${groupHtml}</section>`
	);
};

const defaultMutationResult = (input: RAGMutationResponse) => {
	if (!input.ok) {
		return `<div class="rag-mutation error">${escapeHtml(input.error ?? 'Request failed')}</div>`;
	}

	const details: string[] = [];

	if (input.status) {
		details.push(input.status);
	}

	if (input.inserted) {
		details.push(`inserted=${input.inserted}`);
	}

	if (input.deleted) {
		details.push(`deleted=${input.deleted}`);
	}

	if (typeof input.documents === 'number') {
		details.push(`documents=${input.documents}`);
	}

	return `<div class="rag-mutation ok">${escapeHtml(details.join(' · ') || 'ok')}</div>`;
};

const defaultEvaluateResult = ({
	cases,
	summary
}: {
	cases: RAGEvaluationCaseResult[];
	summary: RAGEvaluationSummary;
}) => {
	if (cases.length === 0) {
		return renderEmptyState('evaluation');
	}

	const caseRows = cases
		.map(
			(entry) =>
				`<tr class="rag-eval-row rag-eval-${entry.status}">` +
				`<td>${escapeHtml(entry.caseId)}</td>` +
				`<td>${escapeHtml(entry.mode)}</td>` +
				`<td>${escapeHtml(entry.status)}</td>` +
				`<td>${entry.elapsedMs}</td>` +
				`<td>${entry.retrievedCount}</td>` +
				`<td>${entry.expectedCount}</td>` +
				`<td>${entry.matchedCount}</td>` +
				`<td>${entry.precision.toFixed(4)}</td>` +
				`<td>${entry.recall.toFixed(4)}</td>` +
				`<td>${entry.f1.toFixed(4)}</td>` +
				`<td>${escapeHtml(entry.label ?? 'n/a')}</td>` +
				`<td>${escapeHtml(entry.missingIds.join(', ') || 'none')}</td>` +
				`</tr>`
		)
		.join('');

	const passingRate =
		summary.totalCases > 0
			? ((summary.passedCases / summary.totalCases) * 100).toFixed(1)
			: '0.0';

	return (
		`<section class="rag-evaluation">` +
		`<h3>Evaluation</h3>` +
		`<p>${summary.totalCases} cases · ${summary.passedCases} pass · ${summary.partialCases} partial · ${summary.failedCases} fail · passing ${passingRate}%</p>` +
		`<table class="rag-eval-table"><thead><tr><th>Case</th><th>Mode</th><th>Status</th><th>ms</th><th>Retrieved</th><th>Expected</th><th>Matched</th><th>Precision</th><th>Recall</th><th>F1</th><th>Label</th><th>Missing</th></tr></thead><tbody>${caseRows}</tbody></table>` +
		`<dl class="rag-eval-summary"><div><dt>Average precision</dt><dd>${summary.averagePrecision.toFixed(
			4
		)}</dd></div><div><dt>Average recall</dt><dd>${summary.averageRecall.toFixed(
			4
		)}</dd></div><div><dt>Average F1</dt><dd>${summary.averageF1.toFixed(
			4
		)}</dd></div><div><dt>Average latency</dt><dd>${summary.averageLatencyMs.toFixed(
			1
		)}ms</dd></div></dl>` +
		`</section>`
	);
};

const defaultError = (message: string) =>
	`<div class="rag-error">${escapeHtml(message)}</div>`;

const defaultMaintenance = (input: {
	admin?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['maintenance']>
	>[0]['admin'];
	adminActions?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['maintenance']>
	>[0]['adminActions'];
	adminJobs?: Parameters<
		NonNullable<RAGHTMXWorkflowRenderConfig['maintenance']>
	>[0]['adminJobs'];
	maintenance?: RAGBackendMaintenanceSummary;
	path?: string;
	status?: RAGVectorStoreStatus;
}) => renderMaintenancePanel(input);

export const resolveRAGWorkflowRenderers = (
	custom?: RAGHTMXWorkflowRenderConfig
): ResolvedRAGWorkflowRenderers => ({
	adaptiveNativePlannerBenchmark:
		custom?.adaptiveNativePlannerBenchmark ??
		defaultAdaptiveNativePlannerBenchmark,
	adaptiveNativePlannerBenchmarkSnapshot:
		custom?.adaptiveNativePlannerBenchmarkSnapshot ??
		defaultAdaptiveNativePlannerBenchmarkSnapshot,
	chunkPreview: custom?.chunkPreview ?? defaultChunkPreview,
	documentItem: custom?.documentItem ?? defaultDocumentItem,
	documents: custom?.documents ?? defaultDocuments,
	emptyState: custom?.emptyState ?? renderEmptyState,
	error: custom?.error ?? defaultError,
	maintenance: custom?.maintenance ?? defaultMaintenance,
	mutationResult: custom?.mutationResult ?? defaultMutationResult,
	nativeBackendComparisonBenchmark:
		custom?.nativeBackendComparisonBenchmark ??
		defaultNativeBackendComparisonBenchmark,
	nativeBackendComparisonBenchmarkSnapshot:
		custom?.nativeBackendComparisonBenchmarkSnapshot ??
		defaultNativeBackendComparisonBenchmarkSnapshot,
	presentationCueBenchmark:
		custom?.presentationCueBenchmark ?? defaultPresentationCueBenchmark,
	presentationCueBenchmarkSnapshot:
		custom?.presentationCueBenchmarkSnapshot ??
		defaultPresentationCueBenchmarkSnapshot,
	spreadsheetCueBenchmark:
		custom?.spreadsheetCueBenchmark ?? defaultSpreadsheetCueBenchmark,
	spreadsheetCueBenchmarkSnapshot:
		custom?.spreadsheetCueBenchmarkSnapshot ??
		defaultSpreadsheetCueBenchmarkSnapshot,
	evaluateResult: custom?.evaluateResult ?? defaultEvaluateResult,
	searchResultItem: custom?.searchResultItem ?? defaultSearchResultItem,
	searchResults: custom?.searchResults ?? defaultSearchResults,
	status: custom?.status ?? defaultStatus
});
