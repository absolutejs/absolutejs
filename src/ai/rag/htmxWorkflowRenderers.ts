import type {
	RAGEvaluationCaseResult,
	RAGEvaluationSummary,
	RAGBackendCapabilities,
	RAGDocumentChunkPreview,
	RAGDocumentSummary,
	RAGHTMXWorkflowRenderConfig,
	RAGIndexedDocument,
	RAGMutationResponse,
	RAGSource,
	RAGVectorStoreStatus
} from '../../../types/ai';
import { RAG_SEARCH_SCORE_DECIMAL_PLACES } from '../../constants';

export type ResolvedRAGWorkflowRenderers =
	Required<RAGHTMXWorkflowRenderConfig>;

const escapeHtml = (text: string) =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

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

const defaultStatus = ({
	status,
	capabilities,
	documents
}: {
	status?: RAGVectorStoreStatus;
	capabilities?: RAGBackendCapabilities;
	documents?: RAGDocumentSummary;
}) => {
	if (!status) {
		return renderEmptyState('status');
	}

	return (
		`<dl class="rag-status">` +
		`<div><dt>Backend</dt><dd>${escapeHtml(status.backend)}</dd></div>` +
		`<div><dt>Vector mode</dt><dd>${escapeHtml(status.vectorMode)}</dd></div>` +
		`<div><dt>Embedding dimensions</dt><dd>${status.dimensions ?? 'n/a'}</dd></div>` +
		`<div><dt>Vector acceleration</dt><dd>${status.native?.active ? 'active' : 'inactive'}</dd></div>` +
		`<div><dt>Documents</dt><dd>${documents?.total ?? 'n/a'}</dd></div>` +
		`<div><dt>Total chunks</dt><dd>${documents?.chunkCount ?? 'n/a'}</dd></div>` +
		`<div><dt>Seed docs</dt><dd>${documents?.byKind.seed ?? 0}</dd></div>` +
		`<div><dt>Custom docs</dt><dd>${documents?.byKind.custom ?? 0}</dd></div>` +
		`</dl>${renderCapabilityList(capabilities)}`
	);
};

const defaultSearchResultItem = (source: RAGSource, index: number) =>
	'<article class="rag-search-result">' +
	`<h3>${escapeHtml(source.title ?? source.chunkId ?? `Result ${index + 1}`)}</h3>` +
	`<p class="rag-search-source">${escapeHtml(source.source ?? 'unknown source')}</p>` +
	`<p class="rag-search-score">score ${source.score.toFixed(RAG_SEARCH_SCORE_DECIMAL_PLACES)}</p>` +
	`<p class="rag-search-text">${escapeHtml(source.text)}</p>` +
	'</article>';

const defaultSearchResults = ({
	query,
	results
}: {
	query: string;
	results: RAGSource[];
}) =>
	results.length === 0
		? renderEmptyState('searchResults')
		: `<section class="rag-search-results">` +
			`<p class="rag-search-summary">${results.length} results for ${escapeHtml(query)}</p>${results
				.map((result, index) => defaultSearchResultItem(result, index))
				.join('')}</section>`;

const defaultDocumentItem = (document: RAGIndexedDocument, index: number) =>
	'<article class="rag-document">' +
	`<h3>${escapeHtml(document.title || `Document ${index + 1}`)}</h3>` +
	`<p class="rag-document-id">${escapeHtml(document.id)}</p>` +
	`<p class="rag-document-source">${escapeHtml(document.source)}</p>` +
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

const defaultChunkPreview = (input: RAGDocumentChunkPreview) =>
	`<section class="rag-chunk-preview">` +
	`<h3>${escapeHtml(input.document.title)}</h3>` +
	`<p class="rag-chunk-preview-source">${escapeHtml(input.document.source)}</p>` +
	`<article class="rag-chunk-normalized">` +
	`<h4>Normalized text</h4>` +
	`<pre>${escapeHtml(input.normalizedText)}</pre>` +
	`</article>${input.chunks
		.map(
			(chunk) =>
				'<article class="rag-chunk">' +
				`<h4>${escapeHtml(chunk.chunkId)}</h4>` +
				`<p class="rag-chunk-meta">chunk ${typeof chunk.metadata?.chunkIndex === 'number' ? chunk.metadata.chunkIndex : 0} of ${typeof chunk.metadata?.chunkCount === 'number' ? chunk.metadata.chunkCount : input.chunks.length}</p>` +
				`<pre>${escapeHtml(chunk.text)}</pre>` +
				'</article>'
		)
		.join('')}</section>`;

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

export const resolveRAGWorkflowRenderers = (
	custom?: RAGHTMXWorkflowRenderConfig
): ResolvedRAGWorkflowRenderers => ({
	chunkPreview: custom?.chunkPreview ?? defaultChunkPreview,
	documentItem: custom?.documentItem ?? defaultDocumentItem,
	documents: custom?.documents ?? defaultDocuments,
	emptyState: custom?.emptyState ?? renderEmptyState,
	error: custom?.error ?? defaultError,
	mutationResult: custom?.mutationResult ?? defaultMutationResult,
	evaluateResult: custom?.evaluateResult ?? defaultEvaluateResult,
	searchResultItem: custom?.searchResultItem ?? defaultSearchResultItem,
	searchResults: custom?.searchResults ?? defaultSearchResults,
	status: custom?.status ?? defaultStatus
});
