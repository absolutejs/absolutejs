import type {
	RAGCollection,
	RAGCollectionSearchResult,
	RAGHybridRetrievalMode,
	RAGCollectionSearchParams,
	RAGDocumentChunk,
	RAGNativeQueryProfile,
	RAGRerankerProviderLike,
	RAGDocumentIngestInput,
	RAGEmbeddingInput,
	RAGEmbeddingProviderLike,
	RAGQueryResult,
	RAGQueryTransformProviderLike,
	RAGRetrievalStrategyProviderLike,
	RAGUpsertInput,
	RAGVectorStore
} from '../../../types/ai';
import { fuseRAGQueryResults, resolveRAGHybridSearchOptions } from './lexical';
import {
	applyRAGQueryTransform,
	resolveRAGQueryTransform
} from './queryTransforms';
import { applyRAGReranking } from './reranking';
import {
	resolveRAGEmbeddingProvider,
	validateRAGEmbeddingDimensions
} from './embedding';
import { buildRAGUpsertInputFromDocuments } from './ingestion';

const DEFAULT_TOP_K = 6;
const AUTO_BALANCED_NATIVE_ROW_ESTIMATE = 5_000;
const AUTO_RECALL_NATIVE_ROW_ESTIMATE = 20_000;
const AUTO_RECALL_FILTER_CLAUSE_COUNT = 3;
const MULTIVECTOR_VARIANT_CHUNK_DELIMITER = '__mv__';
const MULTIVECTOR_PARENT_CHUNK_ID = 'absoluteMultivectorParentChunkId';
const MULTIVECTOR_VARIANT_ID = 'absoluteMultivectorVariantId';
const MULTIVECTOR_VARIANT_LABEL = 'absoluteMultivectorVariantLabel';
const MULTIVECTOR_VARIANT_TEXT = 'absoluteMultivectorVariantText';
const MULTIVECTOR_VARIANT_METADATA = 'absoluteMultivectorVariantMetadata';
const MULTIVECTOR_PRIMARY = 'absoluteMultivectorPrimary';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const countSearchFilterClauses = (filter?: Record<string, unknown>): number => {
	if (!filter) {
		return 0;
	}

	let count = 0;
	for (const [key, value] of Object.entries(filter)) {
		if (key === '$and' || key === '$or') {
			if (Array.isArray(value)) {
				count += value.reduce(
					(total, entry) =>
						total +
						(isObjectRecord(entry)
							? countSearchFilterClauses(entry)
							: 0),
					0
				);
			}
			continue;
		}

		if (key === '$not') {
			count += isObjectRecord(value)
				? countSearchFilterClauses(value)
				: 0;
			continue;
		}

		count += 1;
	}

	return count;
};

const getNativeCorpusRowEstimate = (
	store: RAGVectorStore
): number | undefined => {
	const status = store.getStatus?.();
	if (!status?.native || !('mode' in status.native)) {
		return undefined;
	}

	if (
		status.backend === 'postgres' &&
		status.native.mode === 'pgvector' &&
		typeof status.native.estimatedRowCount === 'number' &&
		Number.isFinite(status.native.estimatedRowCount)
	) {
		return Math.max(0, Math.floor(status.native.estimatedRowCount));
	}

	if (
		status.backend === 'sqlite' &&
		status.native.mode === 'vec0' &&
		typeof status.native.rowCount === 'number' &&
		Number.isFinite(status.native.rowCount)
	) {
		return Math.max(0, Math.floor(status.native.rowCount));
	}

	return undefined;
};

const resolveNativeQueryProfile = (input: {
	candidateTopK: number;
	profile?: RAGNativeQueryProfile;
	topK: number;
}) => {
	if (!input.profile) {
		return undefined;
	}

	if (input.profile === 'latency') {
		return {
			candidateLimit: Math.max(
				1,
				Math.min(input.candidateTopK, input.topK)
			),
			fillPolicy: 'satisfy_min_results' as const,
			maxBackfills: 0,
			minResults: 1,
			plannerProfile: input.profile,
			queryMultiplier: 1
		};
	}

	if (input.profile === 'recall') {
		return {
			fillPolicy: 'strict_topk' as const,
			maxBackfills: 4,
			minResults: input.topK,
			plannerProfile: input.profile,
			queryMultiplier: 8
		};
	}

	return {
		fillPolicy: 'satisfy_min_results' as const,
		maxBackfills: 1,
		minResults: Math.max(
			1,
			Math.min(input.topK, Math.ceil(input.topK / 2))
		),
		plannerProfile: input.profile,
		queryMultiplier: 4
	};
};

const resolveNativeQueryProfileSelection = (input: {
	candidateTopK: number;
	explicitProfile?: RAGNativeQueryProfile;
	filter?: Record<string, unknown>;
	retrievalMode: RAGHybridRetrievalMode;
	store: RAGVectorStore;
	topK: number;
	variantQueryCount: number;
}) => {
	if (input.explicitProfile) {
		return {
			filterClauseCount: countSearchFilterClauses(input.filter),
			profile: input.explicitProfile,
			reason: undefined,
			resolved: resolveNativeQueryProfile({
				candidateTopK: input.candidateTopK,
				profile: input.explicitProfile,
				topK: input.topK
			}),
			rowEstimate: getNativeCorpusRowEstimate(input.store),
			selectionMode: 'explicit' as const
		};
	}

	const rowEstimate = getNativeCorpusRowEstimate(input.store);
	const filterClauseCount = countSearchFilterClauses(input.filter);
	let profile: RAGNativeQueryProfile | undefined;
	let reason: string | undefined;

	if (
		typeof rowEstimate === 'number' &&
		rowEstimate >= AUTO_RECALL_NATIVE_ROW_ESTIMATE &&
		(filterClauseCount >= AUTO_RECALL_FILTER_CLAUSE_COUNT ||
			input.variantQueryCount > 0 ||
			input.retrievalMode === 'hybrid')
	) {
		profile = 'recall';
		reason =
			'larger corpus with complex or expanded retrieval benefits from deeper candidate recovery';
	} else if (
		typeof rowEstimate === 'number' &&
		rowEstimate >= AUTO_BALANCED_NATIVE_ROW_ESTIMATE
	) {
		profile = 'balanced';
		reason =
			'larger native corpus benefits from balanced candidate expansion and backfill';
	}

	return {
		filterClauseCount,
		profile,
		reason,
		resolved: resolveNativeQueryProfile({
			candidateTopK: input.candidateTopK,
			profile,
			topK: input.topK
		}),
		rowEstimate,
		selectionMode: profile ? ('auto' as const) : ('default' as const)
	};
};

export type CreateRAGCollectionOptions = {
	store: RAGVectorStore;
	embedding?: RAGEmbeddingProviderLike;
	defaultTopK?: number;
	defaultCandidateMultiplier?: number;
	defaultModel?: string;
	queryTransform?: RAGQueryTransformProviderLike;
	retrievalStrategy?: RAGRetrievalStrategyProviderLike;
	rerank?: RAGRerankerProviderLike;
};

const VARIANT_RESULT_WEIGHT = 0.92;

const normalizeTraceCueText = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');

const queryIncludesTraceCue = (query: string, value: unknown) => {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return false;
	}

	const normalizedQuery = normalizeTraceCueText(query);
	const normalizedValue = normalizeTraceCueText(value);

	return (
		normalizedQuery.length > 0 &&
		normalizedValue.length > 0 &&
		normalizedQuery.includes(normalizedValue)
	);
};

const queryIncludesLooseTraceCue = (query: string, value: unknown) => {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return false;
	}

	const normalizedQuery = normalizeTraceCueText(query);
	const normalizedValue = normalizeTraceCueText(value);
	if (normalizedQuery.length === 0 || normalizedValue.length === 0) {
		return false;
	}

	if (normalizedValue.includes(normalizedQuery)) {
		return true;
	}

	const words = normalizedQuery.split(' ').filter(Boolean);
	for (let size = Math.min(5, words.length); size >= 2; size -= 1) {
		for (let index = 0; index <= words.length - size; index += 1) {
			const phrase = words.slice(index, index + size).join(' ');
			if (phrase.length > 0 && normalizedValue.includes(phrase)) {
				return true;
			}
		}
	}

	return false;
};

const queryHasAnyTraceToken = (query: string, candidates: string[]) => {
	const normalizedQuery = normalizeTraceCueText(query);
	return candidates.some((candidate) =>
		normalizedQuery.includes(normalizeTraceCueText(candidate))
	);
};

const extractQuotedTracePhrases = (query: string) =>
	Array.from(
		query.matchAll(/["']([^"']{2,})["']/g),
		(match) => match[1]?.trim() ?? ''
	).filter((value) => value.length > 0);

const queryIncludesQuotedTraceCue = (query: string, value: unknown) => {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return false;
	}

	const normalizedValue = normalizeTraceCueText(value);
	if (normalizedValue.length === 0) {
		return false;
	}

	return extractQuotedTracePhrases(query).some((phrase) => {
		const normalizedPhrase = normalizeTraceCueText(phrase);
		return (
			normalizedPhrase.length > 0 &&
			normalizedValue.includes(normalizedPhrase)
		);
	});
};

const buildMediaRerankTraceMetadata = (
	query: string,
	result?: RAGQueryResult
) => {
	if (!result?.metadata || result.metadata.fileKind !== 'media') {
		return {};
	}

	const metadata = result.metadata;
	const traceMetadata: Record<string, string | number | boolean | null> = {};

	if (queryIncludesQuotedTraceCue(query, metadata.speaker)) {
		traceMetadata.leadSpeakerAttributionCue = 'quoted_match';
	}

	if (queryIncludesTraceCue(query, metadata.speaker)) {
		traceMetadata.leadSpeakerCue = String(metadata.speaker);
	}

	if (
		queryHasAnyTraceToken(query, ['left', 'right', 'mono', 'channel']) &&
		queryIncludesTraceCue(query, metadata.mediaChannel)
	) {
		traceMetadata.leadChannelCue = String(metadata.mediaChannel);
	}

	if (queryIncludesQuotedTraceCue(query, metadata.mediaChannel)) {
		traceMetadata.leadChannelAttributionCue = 'quoted_match';
	}

	if (
		typeof metadata.mediaSegmentGapFromPreviousMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGapFromPreviousMs) &&
		queryHasAnyTraceToken(query, [
			'next',
			'after',
			'following',
			'follows',
			'followup',
			'follow-up'
		])
	) {
		traceMetadata.leadContinuityCue =
			metadata.mediaSegmentGapFromPreviousMs === 0
				? 'immediate_follow_up'
				: metadata.mediaSegmentGapFromPreviousMs <= 1_000
					? 'near_follow_up'
					: metadata.mediaSegmentGapFromPreviousMs <= 3_000
						? 'close_follow_up'
						: 'delayed_follow_up';
	}

	if (
		typeof metadata.mediaSegmentGapToNextMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGapToNextMs) &&
		queryHasAnyTraceToken(query, ['before', 'previous', 'prior', 'earlier'])
	) {
		traceMetadata.leadContinuityCue =
			metadata.mediaSegmentGapToNextMs === 0
				? 'immediate_prior'
				: metadata.mediaSegmentGapToNextMs <= 1_000
					? 'near_prior'
					: metadata.mediaSegmentGapToNextMs <= 3_000
						? 'close_prior'
						: 'delayed_prior';
	}

	return traceMetadata;
};

const buildMultivectorRerankTraceMetadata = (
	query: string,
	result?: RAGQueryResult
) => {
	if (!result?.metadata) {
		return {};
	}

	const metadata = result.metadata;
	const traceMetadata: Record<string, string | number | boolean | null> = {};
	const matchedVariantId =
		typeof metadata.multivectorMatchedVariantId === 'string'
			? metadata.multivectorMatchedVariantId
			: undefined;
	const matchedVariantLabel =
		typeof metadata.multivectorMatchedVariantLabel === 'string'
			? metadata.multivectorMatchedVariantLabel
			: undefined;
	const matchedVariantText =
		typeof metadata.multivectorMatchedVariantText === 'string'
			? metadata.multivectorMatchedVariantText
			: undefined;
	const matchedVariantCount =
		typeof metadata.multivectorMatchedVariantCount === 'number'
			? metadata.multivectorMatchedVariantCount
			: null;

	if (!matchedVariantId && !matchedVariantLabel && !matchedVariantText) {
		return {};
	}

	traceMetadata.leadMultivectorVariantCount = matchedVariantCount;
	traceMetadata.leadMultivectorVariantId = matchedVariantId ?? null;
	traceMetadata.leadMultivectorVariantLabel = matchedVariantLabel ?? null;

	if (queryIncludesQuotedTraceCue(query, matchedVariantText)) {
		traceMetadata.leadMultivectorVariantCue = 'quoted_match';
	} else if (
		queryIncludesLooseTraceCue(query, matchedVariantText) ||
		queryIncludesTraceCue(query, matchedVariantText)
	) {
		traceMetadata.leadMultivectorVariantCue = 'phrase_match';
	} else if (queryIncludesTraceCue(query, matchedVariantLabel)) {
		traceMetadata.leadMultivectorVariantCue = 'label_match';
	} else {
		traceMetadata.leadMultivectorVariantCue = 'variant_match';
	}

	return traceMetadata;
};

const buildPresentationRerankTraceMetadata = (
	query: string,
	result?: RAGQueryResult
) => {
	if (result?.metadata?.sectionKind !== 'presentation_slide') {
		return {};
	}

	const metadata = result.metadata;
	const traceMetadata: Record<string, string | number | boolean | null> = {};
	const slideTitle =
		typeof metadata.slideTitle === 'string' &&
		metadata.slideTitle.trim().length > 0
			? metadata.slideTitle.trim()
			: undefined;
	const slideNotesText =
		typeof metadata.slideNotesText === 'string' &&
		metadata.slideNotesText.trim().length > 0
			? metadata.slideNotesText.trim()
			: undefined;
	const chunkText =
		typeof result.chunkText === 'string' ? result.chunkText : undefined;

	if (
		slideNotesText &&
		queryHasAnyTraceToken(query, [
			'notes',
			'speaker',
			'speakers',
			'talking'
		])
	) {
		traceMetadata.leadPresentationCue = 'notes';
		return traceMetadata;
	}

	if (
		typeof chunkText === 'string' &&
		chunkText.trim().length > 0 &&
		queryHasAnyTraceToken(query, ['body', 'content', 'text'])
	) {
		traceMetadata.leadPresentationCue = 'body';
		return traceMetadata;
	}

	if (
		slideTitle &&
		(queryHasAnyTraceToken(query, [
			'slide',
			'slides',
			'deck',
			'presentation',
			'title'
		]) ||
			queryIncludesTraceCue(query, slideTitle))
	) {
		traceMetadata.leadPresentationCue = 'title';
		return traceMetadata;
	}

	if (typeof chunkText === 'string' && chunkText.trim().length > 0) {
		traceMetadata.leadPresentationCue = 'body';
	}

	return traceMetadata;
};

const buildSpreadsheetRerankTraceMetadata = (
	query: string,
	result?: RAGQueryResult
) => {
	if (result?.metadata?.sectionKind !== 'spreadsheet_rows') {
		return {};
	}

	const metadata = result.metadata;
	const traceMetadata: Record<string, string | number | boolean | null> = {};
	const sheetName =
		typeof metadata.sheetName === 'string' &&
		metadata.sheetName.trim().length > 0
			? metadata.sheetName.trim()
			: undefined;
	const hasTableIndex =
		typeof metadata.spreadsheetTableIndex === 'number' &&
		Number.isFinite(metadata.spreadsheetTableIndex);
	const hasColumnSpan =
		typeof metadata.spreadsheetColumnStart === 'string' &&
		metadata.spreadsheetColumnStart.trim().length > 0 &&
		typeof metadata.spreadsheetColumnEnd === 'string' &&
		metadata.spreadsheetColumnEnd.trim().length > 0;

	if (
		hasColumnSpan &&
		(queryHasAnyTraceToken(query, ['column', 'columns']) ||
			queryIncludesTraceCue(query, metadata.spreadsheetColumnStart) ||
			queryIncludesTraceCue(query, metadata.spreadsheetColumnEnd))
	) {
		traceMetadata.leadSpreadsheetCue = 'column';
		return traceMetadata;
	}

	if (
		hasTableIndex &&
		queryHasAnyTraceToken(query, ['table', 'tables', 'grid'])
	) {
		traceMetadata.leadSpreadsheetCue = 'table';
		return traceMetadata;
	}

	if (
		sheetName &&
		(queryHasAnyTraceToken(query, [
			'sheet',
			'spreadsheet',
			'workbook',
			'rows'
		]) ||
			queryIncludesTraceCue(query, sheetName))
	) {
		traceMetadata.leadSpreadsheetCue = 'sheet';
		return traceMetadata;
	}

	if (hasTableIndex) {
		traceMetadata.leadSpreadsheetCue = 'table';
		return traceMetadata;
	}

	if (sheetName) {
		traceMetadata.leadSpreadsheetCue = 'sheet';
	}

	return traceMetadata;
};

const mergeQueryResults = (results: RAGQueryResult[]) => {
	const merged = new Map<string, RAGQueryResult>();

	for (const result of results) {
		const existing = merged.get(result.chunkId);
		const existingOrigins = Array.isArray(
			existing?.metadata?.retrievalQueryOrigins
		)
			? existing.metadata.retrievalQueryOrigins.filter(
					(value): value is string => typeof value === 'string'
				)
			: typeof existing?.metadata?.retrievalQueryOrigin === 'string'
				? [existing.metadata.retrievalQueryOrigin]
				: [];
		const resultOrigins = Array.isArray(
			result.metadata?.retrievalQueryOrigins
		)
			? result.metadata.retrievalQueryOrigins.filter(
					(value): value is string => typeof value === 'string'
				)
			: typeof result.metadata?.retrievalQueryOrigin === 'string'
				? [result.metadata.retrievalQueryOrigin]
				: [];
		const mergedOrigins = Array.from(
			new Set([...existingOrigins, ...resultOrigins])
		);
		const preferred =
			!existing || result.score > existing.score ? result : existing;
		merged.set(result.chunkId, {
			...preferred,
			metadata: {
				...(preferred.metadata ?? {}),
				retrievalQueryOrigins: mergedOrigins
			}
		});
	}

	return [...merged.values()].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.chunkId.localeCompare(right.chunkId);
	});
};

const getMultivectorParentChunkId = (result: RAGQueryResult) =>
	typeof result.metadata?.[MULTIVECTOR_PARENT_CHUNK_ID] === 'string'
		? result.metadata[MULTIVECTOR_PARENT_CHUNK_ID]
		: undefined;

const stripMultivectorInternalMetadata = (
	metadata?: Record<string, unknown>
) => {
	if (!metadata) {
		return undefined;
	}

	const cleaned = { ...metadata };
	delete cleaned[MULTIVECTOR_PARENT_CHUNK_ID];
	delete cleaned[MULTIVECTOR_VARIANT_ID];
	delete cleaned[MULTIVECTOR_VARIANT_LABEL];
	delete cleaned[MULTIVECTOR_VARIANT_TEXT];
	delete cleaned[MULTIVECTOR_VARIANT_METADATA];
	delete cleaned[MULTIVECTOR_PRIMARY];

	return cleaned;
};

const collapseMultivectorResults = (results: RAGQueryResult[]) => {
	const grouped = new Map<
		string,
		{
			parentChunkId: string;
			results: RAGQueryResult[];
			variantHits: number;
		}
	>();

	for (const result of results) {
		const parentChunkId =
			getMultivectorParentChunkId(result) ?? result.chunkId;
		const existing = grouped.get(parentChunkId);
		const nextVariantHits = getMultivectorParentChunkId(result) ? 1 : 0;
		if (existing) {
			existing.results.push(result);
			existing.variantHits += nextVariantHits;
			continue;
		}

		grouped.set(parentChunkId, {
			parentChunkId,
			results: [result],
			variantHits: nextVariantHits
		});
	}

	let variantHits = 0;
	let collapsedParents = 0;
	const collapsed = [...grouped.values()]
		.map((entry) => {
			variantHits += entry.variantHits;
			if (entry.variantHits > 0) {
				collapsedParents += 1;
			}

			const preferred = entry.results.reduce((best, current) =>
				current.score > best.score ? current : best
			);
			const variantMatches: Array<{
				id: string;
				label?: string;
				text?: string;
				score: number;
			}> = entry.results
				.map((result) => {
					const variantId = result.metadata?.[MULTIVECTOR_VARIANT_ID];
					if (typeof variantId !== 'string') {
						return undefined;
					}

					return {
						id: variantId,
						label:
							typeof result.metadata?.[
								MULTIVECTOR_VARIANT_LABEL
							] === 'string'
								? String(
										result.metadata?.[
											MULTIVECTOR_VARIANT_LABEL
										]
									)
								: undefined,
						text:
							typeof result.metadata?.[
								MULTIVECTOR_VARIANT_TEXT
							] === 'string'
								? String(
										result.metadata?.[
											MULTIVECTOR_VARIANT_TEXT
										]
									)
								: undefined,
						score: result.score
					};
				})
				.filter((value) => value !== undefined)
				.sort((left, right) => right.score - left.score);
			const cleanedMetadata = stripMultivectorInternalMetadata(
				preferred.metadata
			);

			return {
				...preferred,
				chunkId: entry.parentChunkId,
				metadata: {
					...(cleanedMetadata ?? {}),
					multivectorMatchedVariantCount: variantMatches.length,
					multivectorMatchedVariantId: variantMatches[0]?.id,
					multivectorMatchedVariantLabel: variantMatches[0]?.label,
					multivectorMatchedVariantText: variantMatches[0]?.text,
					multivectorMatchedVariants:
						variantMatches.length > 0
							? variantMatches.map((match) => ({
									id: match.id,
									label: match.label,
									text: match.text,
									score: match.score
								}))
							: undefined
				}
			};
		})
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return left.chunkId.localeCompare(right.chunkId);
		});

	return {
		collapsed,
		collapsedParents,
		variantHits
	};
};

const expandChunkForMultivectorStorage = (chunk: RAGDocumentChunk) => {
	const expanded: RAGDocumentChunk[] = [{ ...chunk }];
	for (const variant of chunk.embeddingVariants ?? []) {
		if (!variant.id) {
			continue;
		}

		expanded.push({
			...chunk,
			chunkId: `${chunk.chunkId}${MULTIVECTOR_VARIANT_CHUNK_DELIMITER}${variant.id}`,
			embedding: variant.embedding,
			metadata: {
				...(chunk.metadata ?? {}),
				[MULTIVECTOR_PARENT_CHUNK_ID]: chunk.chunkId,
				[MULTIVECTOR_PRIMARY]: false,
				[MULTIVECTOR_VARIANT_ID]: variant.id,
				...(variant.label
					? { [MULTIVECTOR_VARIANT_LABEL]: variant.label }
					: {}),
				...(variant.text
					? { [MULTIVECTOR_VARIANT_TEXT]: variant.text }
					: {}),
				...(variant.metadata
					? { [MULTIVECTOR_VARIANT_METADATA]: variant.metadata }
					: {})
			},
			text: variant.text ?? chunk.text
		});
	}

	return expanded;
};

const getRAGSourceDiversityKey = (result: RAGQueryResult) => {
	const documentId =
		typeof result.metadata?.documentId === 'string'
			? result.metadata.documentId
			: undefined;
	return result.source ?? documentId ?? result.title ?? result.chunkId;
};

const applyRAGSourceDiversity = (
	results: RAGQueryResult[],
	maxResultsPerSource?: number,
	strategy: 'cap' | 'round_robin' = 'cap'
) => {
	if (typeof maxResultsPerSource !== 'number') {
		return results;
	}

	if (strategy === 'round_robin') {
		const grouped = new Map<string, RAGQueryResult[]>();
		const order: string[] = [];

		for (const result of results) {
			const key = getRAGSourceDiversityKey(result);
			const entries = grouped.get(key);
			if (entries) {
				entries.push(result);
				continue;
			}
			grouped.set(key, [result]);
			order.push(key);
		}

		const counts = new Map<string, number>();
		const balanced: RAGQueryResult[] = [];
		let remaining = true;

		while (remaining) {
			remaining = false;
			for (const key of order) {
				const entries = grouped.get(key);
				if (!entries || entries.length === 0) {
					continue;
				}
				if ((counts.get(key) ?? 0) >= maxResultsPerSource) {
					continue;
				}
				const next = entries.shift();
				if (!next) {
					continue;
				}
				counts.set(key, (counts.get(key) ?? 0) + 1);
				balanced.push(next);
				remaining = true;
			}
		}

		return balanced;
	}

	const limited: RAGQueryResult[] = [];
	const counts = new Map<string, number>();

	for (const result of results) {
		const key = getRAGSourceDiversityKey(result);
		const count = counts.get(key) ?? 0;
		if (count >= maxResultsPerSource) {
			continue;
		}
		counts.set(key, count + 1);
		limited.push(result);
	}

	return limited;
};

const dotProduct = (left: number[], right: number[]) => {
	const length = Math.min(left.length, right.length);
	let total = 0;
	for (let index = 0; index < length; index += 1) {
		total += (left[index] ?? 0) * (right[index] ?? 0);
	}
	return total;
};

const applyRAGMMRDiversity = (
	results: RAGQueryResult[],
	queryVector: number[],
	lambda: number
) => {
	const withEmbeddings = results.filter(
		(result): result is RAGQueryResult & { embedding: number[] } =>
			Array.isArray(result.embedding) && result.embedding.length > 0
	);

	if (withEmbeddings.length < 2 || queryVector.length === 0) {
		return results;
	}

	const selected: Array<RAGQueryResult & { embedding: number[] }> = [];
	const remaining = [...withEmbeddings];

	while (remaining.length > 0) {
		let bestIndex = 0;
		let bestScore = Number.NEGATIVE_INFINITY;

		for (let index = 0; index < remaining.length; index += 1) {
			const candidate = remaining[index];
			if (!candidate) {
				continue;
			}
			const relevance = dotProduct(queryVector, candidate.embedding);
			const redundancy =
				selected.length > 0
					? Math.max(
							...selected.map((entry) =>
								dotProduct(entry.embedding, candidate.embedding)
							)
						)
					: 0;
			const mmrScore = lambda * relevance - (1 - lambda) * redundancy;
			if (mmrScore > bestScore) {
				bestScore = mmrScore;
				bestIndex = index;
			}
		}

		const next = remaining.splice(bestIndex, 1)[0];
		if (!next) {
			break;
		}
		selected.push(next);
	}

	const selectedIds = new Set(selected.map((entry) => entry.chunkId));
	const tail = results.filter((entry) => !selectedIds.has(entry.chunkId));
	return [...selected, ...tail];
};

const weightQueryResults = (results: RAGQueryResult[], queryIndex: number) => {
	const weight =
		queryIndex === 0 ? 1 : Math.pow(VARIANT_RESULT_WEIGHT, queryIndex);
	return results.map((result) => ({
		...result,
		metadata: {
			...(result.metadata ?? {}),
			retrievalQueryIndex: queryIndex
		},
		score: result.score * weight
	}));
};

const annotateRetrievalChannels = (input: {
	results: RAGQueryResult[];
	vectorResults: RAGQueryResult[];
	lexicalResults: RAGQueryResult[];
}) => {
	const vectorIds = new Set(
		input.vectorResults.map((result) => result.chunkId)
	);
	const lexicalIds = new Set(
		input.lexicalResults.map((result) => result.chunkId)
	);

	return input.results.map((result) => {
		const channels: Array<'vector' | 'lexical'> = [];
		if (vectorIds.has(result.chunkId)) {
			channels.push('vector');
		}
		if (lexicalIds.has(result.chunkId)) {
			channels.push('lexical');
		}

		return {
			...result,
			metadata: {
				...(result.metadata ?? {}),
				retrievalChannels: channels
			}
		};
	});
};

const getPDFRetrievalEvidencePreference = (
	metadata?: Record<string, unknown>
) => {
	if (!metadata) {
		return 0;
	}

	const pdfEvidenceMode =
		typeof metadata.pdfEvidenceMode === 'string'
			? metadata.pdfEvidenceMode
			: undefined;
	const pdfEvidenceOrigin =
		typeof metadata.pdfEvidenceOrigin === 'string'
			? metadata.pdfEvidenceOrigin
			: undefined;
	const pdfEvidenceSupplement =
		typeof metadata.pdfEvidenceSupplement === 'string'
			? metadata.pdfEvidenceSupplement
			: undefined;

	if (
		pdfEvidenceMode === 'hybrid' &&
		pdfEvidenceOrigin === 'native' &&
		pdfEvidenceSupplement === 'ocr'
	) {
		return 3;
	}
	if (pdfEvidenceMode === 'native' && pdfEvidenceOrigin === 'native') {
		return 2;
	}
	if (pdfEvidenceMode === 'ocr' && pdfEvidenceOrigin === 'ocr') {
		return 1;
	}

	return 0;
};

const getPDFRetrievalScope = (
	result: Pick<RAGQueryResult, 'metadata' | 'source'>
) => {
	const metadata = result.metadata;
	if (!metadata) {
		return undefined;
	}

	const pageNumber =
		typeof metadata.pageNumber === 'number'
			? metadata.pageNumber
			: typeof metadata.page === 'number'
				? metadata.page
				: typeof metadata.pageIndex === 'number'
					? metadata.pageIndex + 1
					: undefined;
	const sectionTitle =
		typeof metadata.sectionTitle === 'string' &&
		metadata.sectionTitle.length > 0
			? metadata.sectionTitle
			: undefined;
	const source =
		typeof result.source === 'string' && result.source.length > 0
			? result.source
			: undefined;

	if (!source) {
		return undefined;
	}

	return {
		pageNumber,
		sectionTitle,
		source
	};
};

const getPDFRetrievalComparableScopeKey = (
	scope:
		| {
				pageNumber?: number;
				sectionTitle?: string;
				source: string;
		  }
		| undefined
) => {
	if (!scope) {
		return undefined;
	}
	if (typeof scope.pageNumber === 'number') {
		return `${scope.source}::page:${scope.pageNumber}`;
	}
	if (scope.sectionTitle) {
		return `${scope.source}::section:${scope.sectionTitle}`;
	}

	return undefined;
};

const getOfficeRetrievalScope = (
	result: Pick<RAGQueryResult, 'metadata' | 'source'>
):
	| {
			blockKind: 'list' | 'paragraph' | 'table';
			familyPath: string[];
			hasContext: boolean;
			ordinalPath: number[];
			pathDepth: number;
			sectionFamilyKey: string;
			sectionOrdinal: number;
			sectionTitle: string;
			source: string;
	  }
	| undefined => {
	const metadata = result.metadata;
	if (!metadata) {
		return undefined;
	}

	const officeBlockKind =
		metadata.officeBlockKind === 'table' ||
		metadata.officeBlockKind === 'list' ||
		metadata.officeBlockKind === 'paragraph'
			? metadata.officeBlockKind
			: undefined;
	if (
		officeBlockKind !== 'table' &&
		officeBlockKind !== 'list' &&
		officeBlockKind !== 'paragraph'
	) {
		return undefined;
	}

	const source =
		typeof result.source === 'string' && result.source.length > 0
			? result.source
			: undefined;
	if (!source) {
		return undefined;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const sectionTitle =
		(typeof metadata.sectionTitle === 'string' &&
		metadata.sectionTitle.trim().length > 0
			? metadata.sectionTitle.trim()
			: undefined) ?? sectionPath.at(-1);
	if (!sectionTitle) {
		return undefined;
	}
	const explicitGenericFamilyPath = Array.isArray(metadata.sectionFamilyPath)
		? metadata.sectionFamilyPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const explicitOfficeFamilyPath = Array.isArray(metadata.officeFamilyPath)
		? metadata.officeFamilyPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const explicitGenericOrdinalPath = Array.isArray(
		metadata.sectionOrdinalPath
	)
		? metadata.sectionOrdinalPath.filter(
				(value): value is number =>
					typeof value === 'number' && Number.isFinite(value)
			)
		: [];
	const explicitOfficeOrdinalPath = Array.isArray(metadata.officeOrdinalPath)
		? metadata.officeOrdinalPath.filter(
				(value): value is number =>
					typeof value === 'number' && Number.isFinite(value)
			)
		: [];
	const explicitFamilyPath =
		explicitGenericFamilyPath.length > 0 &&
		explicitGenericFamilyPath.length === explicitGenericOrdinalPath.length
			? explicitGenericFamilyPath
			: explicitOfficeFamilyPath;
	const explicitOrdinalPath =
		explicitGenericFamilyPath.length > 0 &&
		explicitGenericFamilyPath.length === explicitGenericOrdinalPath.length
			? explicitGenericOrdinalPath
			: explicitOfficeOrdinalPath;
	const parsedFamilyPath =
		explicitFamilyPath.length > 0 &&
		explicitFamilyPath.length === explicitOrdinalPath.length
			? explicitFamilyPath
			: sectionPath.map((value) =>
					value.replace(/\s+\((\d+)\)$/, '').trim()
				);
	const parsedOrdinalPath =
		explicitFamilyPath.length > 0 &&
		explicitFamilyPath.length === explicitOrdinalPath.length
			? explicitOrdinalPath
			: sectionPath.map((value) => {
					const match = value.match(/\((\d+)\)$/);
					return match ? Number.parseInt(match[1] ?? '1', 10) : 1;
				});
	const sectionFamilyKey =
		(typeof metadata.sectionSiblingFamilyKey === 'string' &&
		metadata.sectionSiblingFamilyKey.trim().length > 0
			? metadata.sectionSiblingFamilyKey.trim()
			: typeof metadata.officeSiblingFamilyKey === 'string' &&
				  metadata.officeSiblingFamilyKey.trim().length > 0
				? metadata.officeSiblingFamilyKey.trim()
				: undefined) ?? parsedFamilyPath.at(-1);
	const sectionOrdinal =
		(typeof metadata.sectionSiblingOrdinal === 'number' &&
		Number.isFinite(metadata.sectionSiblingOrdinal)
			? metadata.sectionSiblingOrdinal
			: typeof metadata.officeSiblingOrdinal === 'number' &&
				  Number.isFinite(metadata.officeSiblingOrdinal)
				? metadata.officeSiblingOrdinal
				: undefined) ?? parsedOrdinalPath.at(-1);
	if (!sectionFamilyKey || typeof sectionOrdinal !== 'number') {
		return undefined;
	}

	return {
		blockKind: officeBlockKind,
		familyPath: parsedFamilyPath,
		hasContext:
			officeBlockKind === 'table'
				? typeof metadata.officeTableContextText === 'string' &&
					metadata.officeTableContextText.trim().length > 0
				: officeBlockKind === 'list'
					? typeof metadata.officeListContextText === 'string' &&
						metadata.officeListContextText.trim().length > 0
					: false,
		ordinalPath: parsedOrdinalPath,
		pathDepth: sectionPath.length,
		sectionFamilyKey,
		sectionOrdinal,
		sectionTitle,
		source
	};
};

const getOfficeRetrievalComparableScopeKey = (
	scope:
		| {
				blockKind: 'list' | 'paragraph' | 'table';
				familyPath: string[];
				hasContext: boolean;
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				sectionTitle: string;
				source: string;
		  }
		| undefined
) => {
	if (!scope) {
		return undefined;
	}

	return `${scope.source}::office_section:${scope.blockKind}:${scope.familyPath.join('>')}:${scope.ordinalPath.join('>')}`;
};

const getGenericStructuredRetrievalScope = (
	result: Pick<RAGQueryResult, 'metadata' | 'source'>
):
	| {
			familyPath: string[];
			kind: 'presentation_slide' | 'spreadsheet_rows';
			ordinalPath: number[];
			pathDepth: number;
			sectionFamilyKey: string;
			sectionOrdinal: number;
			source: string;
	  }
	| undefined => {
	const metadata = result.metadata;
	if (!metadata || metadata.officeBlockKind || metadata.pageNumber) {
		return undefined;
	}

	const kind =
		metadata.sectionKind === 'spreadsheet_rows' ||
		metadata.sectionKind === 'presentation_slide'
			? metadata.sectionKind
			: undefined;
	if (!kind) {
		return undefined;
	}

	const source =
		typeof result.source === 'string' && result.source.length > 0
			? result.source
			: undefined;
	if (!source) {
		return undefined;
	}

	const explicitFamilyPath = Array.isArray(metadata.sectionFamilyPath)
		? metadata.sectionFamilyPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const explicitOrdinalPath = Array.isArray(metadata.sectionOrdinalPath)
		? metadata.sectionOrdinalPath.filter(
				(value): value is number =>
					typeof value === 'number' && Number.isFinite(value)
			)
		: [];
	let familyPath =
		explicitFamilyPath.length > 0 &&
		explicitFamilyPath.length === explicitOrdinalPath.length
			? explicitFamilyPath
			: [];
	let ordinalPath =
		explicitFamilyPath.length > 0 &&
		explicitFamilyPath.length === explicitOrdinalPath.length
			? explicitOrdinalPath
			: [];

	if (familyPath.length === 0) {
		if (kind === 'spreadsheet_rows') {
			const sheetName =
				typeof metadata.sheetName === 'string' &&
				metadata.sheetName.trim().length > 0
					? metadata.sheetName.trim()
					: 'Sheet';
			const tableIndex =
				typeof metadata.spreadsheetTableIndex === 'number' &&
				Number.isFinite(metadata.spreadsheetTableIndex)
					? metadata.spreadsheetTableIndex
					: 1;
			familyPath = [sheetName, 'Spreadsheet Table'];
			ordinalPath = [1, tableIndex];
		} else {
			const slideFamily =
				typeof metadata.slideTitle === 'string' &&
				metadata.slideTitle.trim().length > 0
					? metadata.slideTitle.trim()
					: 'Slide';
			const slideOrdinal =
				typeof metadata.slideNumber === 'number' &&
				Number.isFinite(metadata.slideNumber)
					? metadata.slideNumber
					: typeof metadata.slideIndex === 'number' &&
						  Number.isFinite(metadata.slideIndex)
						? metadata.slideIndex + 1
						: 1;
			familyPath = [slideFamily];
			ordinalPath = [slideOrdinal];
		}
	}

	const sectionFamilyKey =
		typeof metadata.sectionSiblingFamilyKey === 'string' &&
		metadata.sectionSiblingFamilyKey.trim().length > 0
			? metadata.sectionSiblingFamilyKey.trim()
			: familyPath.at(-1);
	const sectionOrdinal =
		typeof metadata.sectionSiblingOrdinal === 'number' &&
		Number.isFinite(metadata.sectionSiblingOrdinal)
			? metadata.sectionSiblingOrdinal
			: ordinalPath.at(-1);
	if (!sectionFamilyKey || typeof sectionOrdinal !== 'number') {
		return undefined;
	}

	return {
		familyPath,
		kind,
		ordinalPath,
		pathDepth: familyPath.length,
		sectionFamilyKey,
		sectionOrdinal,
		source
	};
};

const areGenericStructuredScopesComparable = (
	left:
		| {
				familyPath: string[];
				kind: 'presentation_slide' | 'spreadsheet_rows';
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				source: string;
		  }
		| undefined,
	right:
		| {
				familyPath: string[];
				kind: 'presentation_slide' | 'spreadsheet_rows';
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				source: string;
		  }
		| undefined
) => {
	if (!left || !right) {
		return false;
	}
	if (
		left.source !== right.source ||
		left.kind !== right.kind ||
		left.sectionFamilyKey !== right.sectionFamilyKey ||
		left.sectionOrdinal !== right.sectionOrdinal
	) {
		return false;
	}

	const leftAncestorFamilyPath = left.familyPath.slice(0, -1);
	const rightAncestorFamilyPath = right.familyPath.slice(0, -1);
	const leftAncestorOrdinalPath = left.ordinalPath.slice(0, -1);
	const rightAncestorOrdinalPath = right.ordinalPath.slice(0, -1);
	const sharedDepth = Math.min(
		leftAncestorFamilyPath.length,
		rightAncestorFamilyPath.length
	);
	for (let index = 0; index < sharedDepth; index += 1) {
		if (
			leftAncestorFamilyPath[index] !== rightAncestorFamilyPath[index] ||
			leftAncestorOrdinalPath[index] !== rightAncestorOrdinalPath[index]
		) {
			return false;
		}
	}

	return true;
};

const getGenericStructuredRetrievalEvidencePreference = (
	metadata?: Record<string, unknown>
) => {
	if (!metadata) {
		return 0;
	}
	const familyPath = Array.isArray(metadata.sectionFamilyPath)
		? metadata.sectionFamilyPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const pathDepth = familyPath.length;
	if (
		pathDepth === 0 &&
		metadata.sectionKind !== 'spreadsheet_rows' &&
		metadata.sectionKind !== 'presentation_slide'
	) {
		return 0;
	}

	return (
		pathDepth * 10 +
		(metadata.sectionKind === 'spreadsheet_rows' &&
		typeof metadata.spreadsheetTableIndex === 'number'
			? 2
			: 0) +
		(Array.isArray(metadata.spreadsheetHeaders) &&
		metadata.spreadsheetHeaders.length > 0
			? 1
			: 0) +
		(typeof metadata.slideNotesText === 'string' &&
		metadata.slideNotesText.trim().length > 0
			? 1
			: 0)
	);
};

const areOfficeScopesComparable = (
	left:
		| {
				blockKind: 'list' | 'paragraph' | 'table';
				familyPath: string[];
				hasContext: boolean;
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				sectionTitle: string;
				source: string;
		  }
		| undefined,
	right:
		| {
				blockKind: 'list' | 'paragraph' | 'table';
				familyPath: string[];
				hasContext: boolean;
				ordinalPath: number[];
				pathDepth: number;
				sectionFamilyKey: string;
				sectionOrdinal: number;
				sectionTitle: string;
				source: string;
		  }
		| undefined
) => {
	if (!left || !right) {
		return false;
	}
	if (
		left.source !== right.source ||
		left.blockKind !== right.blockKind ||
		left.sectionFamilyKey !== right.sectionFamilyKey ||
		left.sectionOrdinal !== right.sectionOrdinal
	) {
		return false;
	}

	const leftAncestorFamilyPath = left.familyPath.slice(0, -1);
	const rightAncestorFamilyPath = right.familyPath.slice(0, -1);
	const leftAncestorOrdinalPath = left.ordinalPath.slice(0, -1);
	const rightAncestorOrdinalPath = right.ordinalPath.slice(0, -1);
	const sharedDepth = Math.min(
		leftAncestorFamilyPath.length,
		rightAncestorFamilyPath.length
	);

	for (let index = 0; index < sharedDepth; index += 1) {
		if (
			leftAncestorFamilyPath[index] !== rightAncestorFamilyPath[index] ||
			leftAncestorOrdinalPath[index] !== rightAncestorOrdinalPath[index]
		) {
			return false;
		}
	}

	return true;
};

const getOfficeRetrievalEvidencePreference = (
	metadata?: Record<string, unknown>
) => {
	if (!metadata) {
		return 0;
	}

	const officeBlockKind =
		metadata.officeBlockKind === 'table' ||
		metadata.officeBlockKind === 'list' ||
		metadata.officeBlockKind === 'paragraph'
			? metadata.officeBlockKind
			: undefined;
	if (
		officeBlockKind !== 'table' &&
		officeBlockKind !== 'list' &&
		officeBlockKind !== 'paragraph'
	) {
		return 0;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];

	return (
		sectionPath.length * 10 +
		((
			officeBlockKind === 'table'
				? typeof metadata.officeTableContextText === 'string' &&
					metadata.officeTableContextText.trim().length > 0
				: officeBlockKind === 'list'
					? typeof metadata.officeListContextText === 'string' &&
						metadata.officeListContextText.trim().length > 0
					: false
		)
			? 1
			: 0) +
		(officeBlockKind === 'list' &&
		typeof metadata.officeListGroupItemCount === 'number' &&
		metadata.officeListGroupItemCount > 1
			? 1
			: 0)
	);
};

const buildStructuredEvidenceReconcileLabel = (input: {
	officeAffectedScopeCount: number;
	pdfAffectedScopeCount: number;
}) => {
	if (
		input.officeAffectedScopeCount > 0 &&
		input.pdfAffectedScopeCount === 0
	) {
		return 'Preferred deeper office-structure evidence within matching sections';
	}

	if (
		input.pdfAffectedScopeCount > 0 &&
		input.officeAffectedScopeCount === 0
	) {
		return 'Preferred native-layout PDF evidence within matching sections';
	}

	return 'Preferred stronger structured evidence within matching sections';
};

const reconcileStructuredEvidenceOrdering = (results: RAGQueryResult[]) => {
	const indexed = results.map((result, index) => ({ index, result }));
	const sorted = [...indexed].sort((leftEntry, rightEntry) => {
		const left = leftEntry.result;
		const right = rightEntry.result;
		const leftOfficeScope = getOfficeRetrievalScope(left);
		const rightOfficeScope = getOfficeRetrievalScope(right);
		if (areOfficeScopesComparable(leftOfficeScope, rightOfficeScope)) {
			const leftPreference = getOfficeRetrievalEvidencePreference(
				left.metadata
			);
			const rightPreference = getOfficeRetrievalEvidencePreference(
				right.metadata
			);
			if (rightPreference !== leftPreference) {
				return rightPreference - leftPreference;
			}
		}

		const leftGenericScope = getGenericStructuredRetrievalScope(left);
		const rightGenericScope = getGenericStructuredRetrievalScope(right);
		if (
			areGenericStructuredScopesComparable(
				leftGenericScope,
				rightGenericScope
			)
		) {
			const leftPreference =
				getGenericStructuredRetrievalEvidencePreference(left.metadata);
			const rightPreference =
				getGenericStructuredRetrievalEvidencePreference(right.metadata);
			if (rightPreference !== leftPreference) {
				return rightPreference - leftPreference;
			}
		}

		const leftScope = getPDFRetrievalScope(left);
		const rightScope = getPDFRetrievalScope(right);
		if (
			leftScope &&
			rightScope &&
			leftScope.source === rightScope.source &&
			((leftScope.sectionTitle &&
				rightScope.sectionTitle &&
				leftScope.sectionTitle === rightScope.sectionTitle) ||
				(typeof leftScope.pageNumber === 'number' &&
					typeof rightScope.pageNumber === 'number' &&
					leftScope.pageNumber === rightScope.pageNumber))
		) {
			const leftPreference = getPDFRetrievalEvidencePreference(
				left.metadata
			);
			const rightPreference = getPDFRetrievalEvidencePreference(
				right.metadata
			);
			if (rightPreference !== leftPreference) {
				return rightPreference - leftPreference;
			}
		}
		return leftEntry.index - rightEntry.index;
	});
	const orderedResults = sorted.map((entry) => entry.result);
	const reorderedResults = sorted.reduce(
		(count, entry, index) =>
			count + (results[index]?.chunkId === entry.result.chunkId ? 0 : 1),
		0
	);
	const officeAffectedScopes = new Set<string>();
	const officeParagraphAffectedScopes = new Set<string>();
	const officeListAffectedScopes = new Set<string>();
	const officeTableAffectedScopes = new Set<string>();
	const pdfAffectedScopes = new Set<string>();
	for (const [index, entry] of sorted.entries()) {
		if (results[index]?.chunkId === entry.result.chunkId) {
			continue;
		}

		const officeScope = getOfficeRetrievalScope(entry.result);
		if (officeScope) {
			const officeScopeKey =
				getOfficeRetrievalComparableScopeKey(officeScope);
			if (officeScopeKey) {
				officeAffectedScopes.add(officeScopeKey);
				if (officeScope.blockKind === 'paragraph') {
					officeParagraphAffectedScopes.add(officeScopeKey);
				}
				if (officeScope.blockKind === 'list') {
					officeListAffectedScopes.add(officeScopeKey);
				}
				if (officeScope.blockKind === 'table') {
					officeTableAffectedScopes.add(officeScopeKey);
				}
			}
			continue;
		}

		const pdfScope = getPDFRetrievalScope(entry.result);
		const pdfScopeKey = getPDFRetrievalComparableScopeKey(pdfScope);
		if (pdfScopeKey) {
			pdfAffectedScopes.add(pdfScopeKey);
		}
	}
	const affectedScopeCount =
		officeAffectedScopes.size + pdfAffectedScopes.size;

	return {
		affectedScopeCount,
		label: buildStructuredEvidenceReconcileLabel({
			officeAffectedScopeCount: officeAffectedScopes.size,
			pdfAffectedScopeCount: pdfAffectedScopes.size
		}),
		applied: reorderedResults > 0,
		officeAffectedScopeCount: officeAffectedScopes.size,
		officeParagraphAffectedScopeCount: officeParagraphAffectedScopes.size,
		officeListAffectedScopeCount: officeListAffectedScopes.size,
		officeTableAffectedScopeCount: officeTableAffectedScopes.size,
		pdfAffectedScopeCount: pdfAffectedScopes.size,
		results: orderedResults,
		reorderedResults
	};
};

const getStructuredSectionScoreWeight = (
	metadata?: Record<string, unknown>
) => {
	const pdfTextKind =
		typeof metadata?.pdfTextKind === 'string'
			? metadata.pdfTextKind
			: undefined;
	const officeBlockKind =
		typeof metadata?.officeBlockKind === 'string'
			? metadata.officeBlockKind
			: undefined;
	const sectionKind =
		typeof metadata?.sectionKind === 'string'
			? metadata.sectionKind
			: undefined;

	if (pdfTextKind === 'table_like') {
		return 1.28;
	}
	if (officeBlockKind === 'table' || officeBlockKind === 'list') {
		return 1.24;
	}
	if (
		sectionKind === 'pdf_block' ||
		sectionKind === 'office_block' ||
		officeBlockKind === 'paragraph' ||
		pdfTextKind === 'paragraph'
	) {
		return 1.12;
	}

	return 1;
};

const buildTraceSectionCounts = (results: RAGQueryResult[]) => {
	const sections = new Map<
		string,
		{ key: string; label: string; count: number }
	>();

	for (const result of results) {
		const weightedScore =
			result.score * getStructuredSectionScoreWeight(result.metadata);
		const path = Array.isArray(result.metadata?.sectionPath)
			? result.metadata.sectionPath.filter(
					(value): value is string =>
						typeof value === 'string' && value.trim().length > 0
				)
			: [];
		if (path.length === 0) {
			continue;
		}

		const key = path.join(' > ');
		const existing = sections.get(key);
		if (existing) {
			existing.count += 1;
			continue;
		}

		sections.set(key, {
			count: 1,
			key,
			label: path.at(-1) ?? key
		});
	}

	return [...sections.values()].sort((left, right) => {
		if (right.count !== left.count) {
			return right.count - left.count;
		}

		return left.key.localeCompare(right.key);
	});
};

const buildTraceSectionScores = (results: RAGQueryResult[]) => {
	const sections = new Map<
		string,
		{ key: string; label: string; totalScore: number }
	>();

	for (const result of results) {
		const weightedScore =
			result.score * getStructuredSectionScoreWeight(result.metadata);
		const path = Array.isArray(result.metadata?.sectionPath)
			? result.metadata.sectionPath.filter(
					(value): value is string =>
						typeof value === 'string' && value.trim().length > 0
				)
			: [];
		if (path.length === 0) {
			continue;
		}

		const key = path.join(' > ');
		const existing = sections.get(key);
		if (existing) {
			existing.totalScore += weightedScore;
			continue;
		}

		sections.set(key, {
			key,
			label: path.at(-1) ?? key,
			totalScore: weightedScore
		});
	}

	return [...sections.values()].sort((left, right) => {
		if (right.totalScore !== left.totalScore) {
			return right.totalScore - left.totalScore;
		}

		return left.key.localeCompare(right.key);
	});
};

const annotateRetrievalQueryOrigin = (input: {
	results: RAGQueryResult[];
	query: string;
	queryIndex: number;
	inputQuery: string;
	transformedQuery: string;
}) => {
	const origin =
		input.queryIndex === 0
			? input.query === input.inputQuery
				? 'primary'
				: 'transformed'
			: 'variant';

	return input.results.map((result) => ({
		...result,
		metadata: {
			...(result.metadata ?? {}),
			retrievalQuery: input.query,
			retrievalQueryOrigin: origin
		}
	}));
};

const shouldRunVectorRetrieval = (mode: RAGHybridRetrievalMode) =>
	mode === 'vector' || mode === 'hybrid';

const shouldRunLexicalRetrieval = (
	mode: RAGHybridRetrievalMode,
	store: RAGVectorStore
) => mode === 'lexical' || (mode === 'hybrid' && Boolean(store.queryLexical));

const resolveRAGRetrievalStrategy = (
	retrievalStrategy: RAGRetrievalStrategyProviderLike | undefined
) => {
	if (!retrievalStrategy) {
		return null;
	}

	if (typeof retrievalStrategy === 'function') {
		return {
			defaultLabel: undefined,
			providerName: undefined,
			select: retrievalStrategy
		};
	}

	return retrievalStrategy;
};

const buildStoreQueryPlanTraceMetadata = (
	store: RAGVectorStore
): Record<string, string | number | boolean | null> => {
	const status = store.getStatus?.();
	const sqliteNativePlan =
		status?.backend === 'sqlite' &&
		status.native &&
		'mode' in status.native &&
		status.native.mode === 'vec0'
			? status.native.lastQueryPlan
			: undefined;

	if (sqliteNativePlan) {
		return {
			sqliteQueryBackfillCount: sqliteNativePlan.backfillCount ?? null,
			sqliteQueryCandidateBudgetExhausted:
				sqliteNativePlan.candidateBudgetExhausted ?? null,
			sqliteQueryCandidateCoverage:
				sqliteNativePlan.candidateCoverage ?? null,
			sqliteQueryFilteredCandidates:
				sqliteNativePlan.filteredCandidateCount ?? null,
			sqliteQueryFinalSearchK: sqliteNativePlan.finalSearchK ?? null,
			sqliteQueryInitialSearchK: sqliteNativePlan.initialSearchK ?? null,
			sqliteQuerySearchExpansionRatio:
				sqliteNativePlan.searchExpansionRatio ?? null,
			sqliteQueryMode: sqliteNativePlan.queryMode,
			sqliteQueryPushdownApplied: sqliteNativePlan.pushdownApplied,
			sqliteQueryPushdownClauseCount:
				sqliteNativePlan.pushdownClauseCount,
			sqliteQueryPushdownCoverageRatio:
				sqliteNativePlan.pushdownCoverageRatio ?? null,
			sqliteQueryPushdownMode: sqliteNativePlan.pushdownMode,
			sqliteQueryTotalFilterClauseCount:
				sqliteNativePlan.totalFilterClauseCount,
			sqliteQueryJsRemainderClauseCount:
				sqliteNativePlan.jsRemainderClauseCount,
			sqliteQueryMultiplierUsed:
				sqliteNativePlan.queryMultiplierUsed ?? null,
			sqliteQueryPlannerProfileUsed:
				sqliteNativePlan.plannerProfileUsed ?? null,
			sqliteQueryCandidateLimitUsed:
				sqliteNativePlan.candidateLimitUsed ?? null,
			sqliteQueryMaxBackfillsUsed:
				sqliteNativePlan.maxBackfillsUsed ?? null,
			sqliteQueryMinResultsUsed: sqliteNativePlan.minResultsUsed ?? null,
			sqliteQueryFillPolicyUsed: sqliteNativePlan.fillPolicyUsed ?? null,
			sqliteQueryJsRemainderRatio:
				sqliteNativePlan.jsRemainderRatio ?? null,
			sqliteQueryCandidateYieldRatio:
				sqliteNativePlan.candidateYieldRatio ?? null,
			sqliteQueryReturnedCount: sqliteNativePlan.returnedCount ?? null,
			sqliteQueryBackfillLimitReached:
				sqliteNativePlan.backfillLimitReached ?? null,
			sqliteQueryMinResultsSatisfied:
				sqliteNativePlan.minResultsSatisfied ?? null,
			sqliteQueryTopKFillRatio: sqliteNativePlan.topKFillRatio ?? null,
			sqliteQueryUnderfilledTopK: sqliteNativePlan.underfilledTopK ?? null
		};
	}

	const postgresNativePlan =
		status?.backend === 'postgres' &&
		status.native &&
		'mode' in status.native &&
		status.native.mode === 'pgvector'
			? status.native.lastQueryPlan
			: undefined;
	const postgresNativeDiagnostics =
		status?.backend === 'postgres' &&
		status.native &&
		'mode' in status.native &&
		status.native.mode === 'pgvector'
			? status.native
			: undefined;

	if (!postgresNativePlan && !postgresNativeDiagnostics) {
		return {};
	}

	return {
		postgresEstimatedRowCount:
			postgresNativeDiagnostics?.estimatedRowCount ?? null,
		postgresIndexBytes: postgresNativeDiagnostics?.indexBytes ?? null,
		postgresIndexName: postgresNativeDiagnostics?.indexName ?? null,
		postgresIndexPresent: postgresNativeDiagnostics?.indexPresent ?? null,
		postgresIndexStorageRatio:
			typeof postgresNativeDiagnostics?.indexBytes === 'number' &&
			typeof postgresNativeDiagnostics?.totalBytes === 'number' &&
			postgresNativeDiagnostics.totalBytes > 0
				? postgresNativeDiagnostics.indexBytes /
					postgresNativeDiagnostics.totalBytes
				: null,
		postgresIndexType: postgresNativeDiagnostics?.indexType ?? null,
		postgresTableBytes: postgresNativeDiagnostics?.tableBytes ?? null,
		postgresTotalBytes: postgresNativeDiagnostics?.totalBytes ?? null,
		postgresQueryBackfillCount: postgresNativePlan?.backfillCount ?? null,
		postgresQueryCandidateBudgetExhausted:
			postgresNativePlan?.candidateBudgetExhausted ?? null,
		postgresQueryCandidateCoverage:
			postgresNativePlan?.candidateCoverage ?? null,
		postgresQueryFilteredCandidates:
			postgresNativePlan?.filteredCandidateCount ?? null,
		postgresQueryFinalSearchK: postgresNativePlan?.finalSearchK ?? null,
		postgresQueryInitialSearchK: postgresNativePlan?.initialSearchK ?? null,
		postgresQuerySearchExpansionRatio:
			postgresNativePlan?.searchExpansionRatio ?? null,
		postgresQueryMode: postgresNativePlan?.queryMode ?? null,
		postgresQueryPushdownApplied:
			postgresNativePlan?.pushdownApplied ?? null,
		postgresQueryPushdownClauseCount:
			postgresNativePlan?.pushdownClauseCount ?? null,
		postgresQueryPushdownCoverageRatio:
			postgresNativePlan?.pushdownCoverageRatio ?? null,
		postgresQueryPushdownMode: postgresNativePlan?.pushdownMode ?? null,
		postgresQueryTotalFilterClauseCount:
			postgresNativePlan?.totalFilterClauseCount ?? null,
		postgresQueryJsRemainderClauseCount:
			postgresNativePlan?.jsRemainderClauseCount ?? null,
		postgresQueryMultiplierUsed:
			postgresNativePlan?.queryMultiplierUsed ?? null,
		postgresQueryPlannerProfileUsed:
			postgresNativePlan?.plannerProfileUsed ?? null,
		postgresQueryCandidateLimitUsed:
			postgresNativePlan?.candidateLimitUsed ?? null,
		postgresQueryMaxBackfillsUsed:
			postgresNativePlan?.maxBackfillsUsed ?? null,
		postgresQueryMinResultsUsed: postgresNativePlan?.minResultsUsed ?? null,
		postgresQueryFillPolicyUsed: postgresNativePlan?.fillPolicyUsed ?? null,
		postgresQueryJsRemainderRatio:
			postgresNativePlan?.jsRemainderRatio ?? null,
		postgresQueryCandidateYieldRatio:
			postgresNativePlan?.candidateYieldRatio ?? null,
		postgresQueryReturnedCount: postgresNativePlan?.returnedCount ?? null,
		postgresQueryBackfillLimitReached:
			postgresNativePlan?.backfillLimitReached ?? null,
		postgresQueryMinResultsSatisfied:
			postgresNativePlan?.minResultsSatisfied ?? null,
		postgresQueryTopKFillRatio: postgresNativePlan?.topKFillRatio ?? null,
		postgresQueryUnderfilledTopK:
			postgresNativePlan?.underfilledTopK ?? null
	};
};

export const createRAGCollection = (
	options: CreateRAGCollectionOptions
): RAGCollection => {
	const defaultTopK = options.defaultTopK ?? DEFAULT_TOP_K;
	const defaultCandidateMultiplier = Math.max(
		1,
		Math.floor(options.defaultCandidateMultiplier ?? 4)
	);
	const { getCapabilities } = options.store;
	const { getStatus } = options.store;
	const embeddingProvider = resolveRAGEmbeddingProvider(
		options.embedding,
		options.store.embed,
		options.defaultModel
	);
	const getExpectedDimensions = () =>
		embeddingProvider.dimensions ?? getStatus?.()?.dimensions;

	const embed = async (
		input: RAGEmbeddingInput,
		context: 'query' | 'chunk'
	) => {
		const vector = await embeddingProvider.embed(input);
		validateRAGEmbeddingDimensions(
			vector,
			getExpectedDimensions(),
			context
		);

		return vector;
	};

	const searchWithTrace = async (
		input: RAGCollectionSearchParams
	): Promise<RAGCollectionSearchResult> => {
		const model = input.model ?? options.defaultModel;
		const topK = input.topK ?? defaultTopK;
		const hasReranker = Boolean(input.rerank ?? options.rerank);
		const requestedRetrieval = resolveRAGHybridSearchOptions(
			input.retrieval
		);
		const hasQueryTransform = Boolean(
			input.queryTransform ?? options.queryTransform
		);
		const shouldExpandCandidates =
			hasReranker ||
			hasQueryTransform ||
			requestedRetrieval.mode !== 'vector';
		const candidateTopK = Math.max(
			topK,
			Math.floor(
				input.candidateTopK ??
					(shouldExpandCandidates
						? topK * defaultCandidateMultiplier
						: topK)
			)
		);
		const resolvedQueryTransform = resolveRAGQueryTransform(
			input.queryTransform ?? options.queryTransform
		);
		const transformed = await applyRAGQueryTransform({
			input: {
				candidateTopK,
				filter: input.filter,
				model,
				query: input.query,
				scoreThreshold: input.scoreThreshold,
				topK
			},
			queryTransform: resolvedQueryTransform ?? undefined
		});
		const searchQueries = Array.from(
			new Set([transformed.query, ...(transformed.variants ?? [])])
		).filter(Boolean);
		const resolvedRetrievalStrategy = resolveRAGRetrievalStrategy(
			input.retrievalStrategy ?? options.retrievalStrategy
		);
		const retrievalDecision = resolvedRetrievalStrategy
			? await Promise.resolve(
					resolvedRetrievalStrategy.select({
						candidateTopK,
						filter: input.filter,
						model,
						query: input.query,
						retrieval: requestedRetrieval,
						scoreThreshold: input.scoreThreshold,
						topK,
						transformedQuery: transformed.query,
						variantQueries: searchQueries.slice(1)
					})
				)
			: undefined;
		const retrieval = retrievalDecision
			? {
					...requestedRetrieval,
					...retrievalDecision
				}
			: requestedRetrieval;
		const runVector = shouldRunVectorRetrieval(retrieval.mode);
		const runLexical = shouldRunLexicalRetrieval(
			retrieval.mode,
			options.store
		);
		const lexicalTopK = Math.max(
			topK,
			Math.floor(retrieval.lexicalTopK ?? candidateTopK)
		);
		const steps: RAGCollectionSearchResult['trace']['steps'] = [
			{
				count: topK,
				label: 'Search input received',
				metadata: {
					candidateTopK,
					hasQueryTransform,
					hasReranker,
					maxResultsPerSource: retrieval.maxResultsPerSource ?? null,
					mmrLambda: retrieval.mmrLambda,
					mode: retrieval.mode,
					diversityStrategy: retrieval.diversityStrategy,
					runLexical,
					runVector,
					sourceBalanceStrategy: retrieval.sourceBalanceStrategy,
					topK
				},
				stage: 'input'
			}
		];
		const queryVector = runVector
			? await embed(
					{
						model,
						signal: input.signal,
						text: input.query
					},
					'query'
				)
			: [];
		if (runVector) {
			steps.push({
				label: 'Embedded primary query',
				metadata: {
					dimensions: queryVector.length,
					query: input.query
				},
				stage: 'embed'
			});
		}
		if (transformed.query !== input.query || searchQueries.length > 1) {
			steps.push({
				label: 'Expanded query variants',
				metadata: {
					label:
						transformed.label ??
						resolvedQueryTransform?.providerName ??
						null,
					providerName: resolvedQueryTransform?.providerName ?? null,
					reason: transformed.reason ?? null,
					transformedQuery: transformed.query,
					variantCount: Math.max(0, searchQueries.length - 1),
					...(transformed.metadata ?? {})
				},
				stage: 'query_transform'
			});
		}
		if (
			retrievalDecision ||
			requestedRetrieval.mode !== retrieval.mode ||
			requestedRetrieval.lexicalTopK !== retrieval.lexicalTopK
		) {
			steps.push({
				label:
					retrievalDecision?.label ?? 'Selected retrieval strategy',
				metadata: {
					applied: Boolean(retrievalDecision),
					label:
						retrievalDecision?.label ??
						resolvedRetrievalStrategy?.defaultLabel ??
						null,
					providerName:
						resolvedRetrievalStrategy?.providerName ?? null,
					reason: retrievalDecision?.reason ?? null,
					requestedMode: requestedRetrieval.mode,
					selectedMode: retrieval.mode,
					...(retrievalDecision?.metadata ?? {})
				},
				stage: 'routing'
			});
		}
		const nativeQueryProfileSelection = resolveNativeQueryProfileSelection({
			candidateTopK,
			explicitProfile: input.nativeQueryProfile,
			filter: input.filter,
			retrievalMode: retrieval.mode,
			store: options.store,
			topK,
			variantQueryCount: Math.max(0, searchQueries.length - 1)
		});
		const nativeQueryProfile = nativeQueryProfileSelection.resolved;
		if (
			runVector &&
			nativeQueryProfileSelection.selectionMode === 'auto' &&
			nativeQueryProfileSelection.profile
		) {
			steps.push({
				label: 'Selected native planner profile',
				metadata: {
					autoSelected: true,
					filterClauseCount:
						nativeQueryProfileSelection.filterClauseCount,
					reason: nativeQueryProfileSelection.reason ?? null,
					rowEstimate:
						nativeQueryProfileSelection.rowEstimate ?? null,
					selectedProfile: nativeQueryProfileSelection.profile
				},
				stage: 'routing'
			});
		}
		const resultGroups = await Promise.all(
			searchQueries.map(async (query, queryIndex) => {
				const [vectorResults, lexicalResults] = await Promise.all([
					runVector
						? embed(
								{
									model,
									signal: input.signal,
									text: query
								},
								'query'
							).then((nextQueryVector) =>
								options.store.query({
									filter: input.filter,
									candidateLimit:
										input.nativeCandidateLimit ??
										nativeQueryProfile?.candidateLimit,
									fillPolicy:
										input.nativeFillPolicy ??
										nativeQueryProfile?.fillPolicy,
									maxBackfills:
										input.nativeMaxBackfills ??
										nativeQueryProfile?.maxBackfills,
									minResults:
										input.nativeMinResults ??
										nativeQueryProfile?.minResults,
									plannerProfile:
										nativeQueryProfile?.plannerProfile,
									queryMultiplier:
										input.nativeQueryMultiplier ??
										nativeQueryProfile?.queryMultiplier,
									queryVector: nextQueryVector,
									topK: candidateTopK
								})
							)
						: Promise.resolve([]),
					runLexical
						? (options.store.queryLexical?.({
								filter: input.filter,
								query,
								topK: lexicalTopK
							}) ?? Promise.resolve([]))
						: Promise.resolve([])
				]);

				const annotatedLexicalResults = annotateRetrievalQueryOrigin({
					inputQuery: input.query,
					query,
					queryIndex,
					results: weightQueryResults(lexicalResults, queryIndex),
					transformedQuery: transformed.query
				});
				const annotatedVectorResults = annotateRetrievalQueryOrigin({
					inputQuery: input.query,
					query,
					queryIndex,
					results: weightQueryResults(vectorResults, queryIndex),
					transformedQuery: transformed.query
				});
				const collapsedLexicalResults = collapseMultivectorResults(
					annotatedLexicalResults
				);
				const collapsedVectorResults = collapseMultivectorResults(
					annotatedVectorResults
				);

				return {
					lexicalResults: collapsedLexicalResults.collapsed,
					lexicalVariantHits: collapsedLexicalResults.variantHits,
					lexicalCollapsedParents:
						collapsedLexicalResults.collapsedParents,
					vectorResults: collapsedVectorResults.collapsed,
					vectorVariantHits: collapsedVectorResults.variantHits,
					vectorCollapsedParents:
						collapsedVectorResults.collapsedParents
				};
			})
		);
		const vectorVariantHits = resultGroups.reduce(
			(total, group) => total + group.vectorVariantHits,
			0
		);
		const lexicalVariantHits = resultGroups.reduce(
			(total, group) => total + group.lexicalVariantHits,
			0
		);
		const collapsedParents = resultGroups.reduce(
			(total, group) =>
				total +
				Math.max(
					group.vectorCollapsedParents,
					group.lexicalCollapsedParents
				),
			0
		);
		const vectorResults = mergeQueryResults(
			resultGroups.flatMap((group) => group.vectorResults)
		);
		if (runVector) {
			const vectorPlanMetadata = buildStoreQueryPlanTraceMetadata(
				options.store
			);
			steps.push({
				count: vectorResults.length,
				label: 'Collected vector candidates',
				metadata: {
					collapsedParents,
					multiVectorVariantHits: vectorVariantHits,
					queryCount: searchQueries.length,
					topK: candidateTopK,
					...vectorPlanMetadata
				},
				sectionCounts: buildTraceSectionCounts(vectorResults),
				sectionScores: buildTraceSectionScores(vectorResults),
				stage: 'vector_search'
			});
		}
		const lexicalResults = mergeQueryResults(
			resultGroups.flatMap((group) => group.lexicalResults)
		);
		if (runLexical) {
			steps.push({
				count: lexicalResults.length,
				label: 'Collected lexical candidates',
				metadata: {
					collapsedParents,
					multiVectorVariantHits: lexicalVariantHits,
					queryCount: searchQueries.length,
					topK: lexicalTopK
				},
				sectionCounts: buildTraceSectionCounts(lexicalResults),
				sectionScores: buildTraceSectionScores(lexicalResults),
				stage: 'lexical_search'
			});
		}
		const results =
			retrieval.mode === 'lexical'
				? lexicalResults
				: retrieval.mode === 'vector'
					? vectorResults
					: fuseRAGQueryResults({
							fusion: retrieval.fusion,
							fusionConstant: retrieval.fusionConstant,
							lexical: lexicalResults,
							lexicalWeight: retrieval.lexicalWeight,
							vector: vectorResults,
							vectorWeight: retrieval.vectorWeight
						});
		steps.push({
			count: results.length,
			label:
				retrieval.mode === 'hybrid'
					? 'Fused retrieval candidates'
					: 'Selected retrieval candidates',
			metadata: {
				mode: retrieval.mode
			},
			sectionCounts: buildTraceSectionCounts(results),
			sectionScores: buildTraceSectionScores(results),
			stage: 'fusion'
		});
		const rerankInput = {
			candidateTopK,
			filter: input.filter,
			model,
			query: transformed.query,
			queryVector,
			results,
			scoreThreshold: input.scoreThreshold,
			topK
		};
		const reranked = await applyRAGReranking({
			input: rerankInput,
			reranker: input.rerank ?? options.rerank
		});
		steps.push({
			count: reranked.length,
			label: hasReranker
				? 'Reranked retrieval candidates'
				: 'Skipped reranking and kept retrieval order',
			metadata: {
				applied: hasReranker,
				...buildMediaRerankTraceMetadata(
					transformed.query,
					reranked[0]
				),
				...buildSpreadsheetRerankTraceMetadata(
					transformed.query,
					reranked[0]
				),
				...buildPresentationRerankTraceMetadata(
					transformed.query,
					reranked[0]
				),
				...buildMultivectorRerankTraceMetadata(
					transformed.query,
					reranked[0]
				)
			},
			sectionCounts: buildTraceSectionCounts(reranked),
			sectionScores: buildTraceSectionScores(reranked),
			stage: 'rerank'
		});
		const diversityAdjusted =
			retrieval.diversityStrategy === 'mmr'
				? applyRAGMMRDiversity(
						reranked,
						queryVector,
						retrieval.mmrLambda
					)
				: reranked;
		if (retrieval.diversityStrategy === 'mmr') {
			steps.push({
				count: diversityAdjusted.length,
				label: 'Applied MMR diversity reordering',
				metadata: {
					applied:
						queryVector.length > 0 &&
						diversityAdjusted.some((entry) =>
							Array.isArray(entry.embedding)
						),
					mmrLambda: retrieval.mmrLambda
				},
				sectionCounts: buildTraceSectionCounts(diversityAdjusted),
				sectionScores: buildTraceSectionScores(diversityAdjusted),
				stage: 'diversity'
			});
		}
		const diversified = applyRAGSourceDiversity(
			diversityAdjusted,
			retrieval.maxResultsPerSource,
			retrieval.sourceBalanceStrategy
		);
		if (typeof retrieval.maxResultsPerSource === 'number') {
			steps.push({
				count: diversified.length,
				label: 'Balanced candidates across sources',
				metadata: {
					maxResultsPerSource: retrieval.maxResultsPerSource,
					strategy: retrieval.sourceBalanceStrategy
				},
				sectionCounts: buildTraceSectionCounts(diversified),
				sectionScores: buildTraceSectionScores(diversified),
				stage: 'source_balance'
			});
		}
		const evidenceReconciled =
			reconcileStructuredEvidenceOrdering(diversified);
		if (evidenceReconciled.applied) {
			steps.push({
				count: evidenceReconciled.results.length,
				label: evidenceReconciled.label,
				metadata: {
					affectedScopes: evidenceReconciled.affectedScopeCount,
					officeAffectedScopes:
						evidenceReconciled.officeAffectedScopeCount,
					officeParagraphAffectedScopes:
						evidenceReconciled.officeParagraphAffectedScopeCount,
					officeListAffectedScopes:
						evidenceReconciled.officeListAffectedScopeCount,
					officeTableAffectedScopes:
						evidenceReconciled.officeTableAffectedScopeCount,
					pdfAffectedScopes: evidenceReconciled.pdfAffectedScopeCount,
					reorderedResults: evidenceReconciled.reorderedResults
				},
				sectionCounts: buildTraceSectionCounts(
					evidenceReconciled.results
				),
				sectionScores: buildTraceSectionScores(
					evidenceReconciled.results
				),
				stage: 'evidence_reconcile'
			});
		}
		const limited = annotateRetrievalChannels({
			lexicalResults,
			results: evidenceReconciled.results.slice(0, topK),
			vectorResults
		});

		if (typeof input.scoreThreshold !== 'number') {
			steps.push({
				count: limited.length,
				label: 'Finalized retrieval results',
				metadata: {
					appliedScoreThreshold: false
				},
				sectionCounts: buildTraceSectionCounts(limited),
				sectionScores: buildTraceSectionScores(limited),
				stage: 'finalize'
			});

			return {
				results: limited,
				trace: {
					candidateTopK,
					lexicalTopK,
					maxResultsPerSource: retrieval.maxResultsPerSource,
					mmrLambda: retrieval.mmrLambda,
					mode: retrieval.mode,
					diversityStrategy: retrieval.diversityStrategy,
					query: input.query,
					queryTransformLabel: transformed.label,
					queryTransformProvider:
						resolvedQueryTransform?.providerName,
					queryTransformReason: transformed.reason,
					multiVector: {
						collapsedParents,
						configured:
							vectorVariantHits > 0 || lexicalVariantHits > 0,
						lexicalVariantHits,
						vectorVariantHits
					},
					resultCounts: {
						final: limited.length,
						fused: results.length,
						lexical: lexicalResults.length,
						reranked: diversified.length,
						vector: vectorResults.length
					},
					requestedMode: requestedRetrieval.mode,
					runLexical,
					runVector,
					routingLabel:
						retrievalDecision?.label ??
						resolvedRetrievalStrategy?.defaultLabel,
					routingProvider: resolvedRetrievalStrategy?.providerName,
					routingReason: retrievalDecision?.reason,
					sourceBalanceStrategy: retrieval.sourceBalanceStrategy,
					steps,
					topK,
					transformedQuery: transformed.query,
					variantQueries: searchQueries.slice(1)
				}
			};
		}

		const { scoreThreshold } = input;
		const filtered = limited.filter(
			(entry) => entry.score >= scoreThreshold
		);
		steps.push({
			count: filtered.length,
			label: 'Applied score threshold',
			metadata: {
				scoreThreshold
			},
			sectionCounts: buildTraceSectionCounts(filtered),
			sectionScores: buildTraceSectionScores(filtered),
			stage: 'score_filter'
		});
		steps.push({
			count: filtered.length,
			label: 'Finalized retrieval results',
			metadata: {
				appliedScoreThreshold: true
			},
			sectionCounts: buildTraceSectionCounts(filtered),
			sectionScores: buildTraceSectionScores(filtered),
			stage: 'finalize'
		});

		return {
			results: filtered,
			trace: {
				candidateTopK,
				lexicalTopK,
				maxResultsPerSource: retrieval.maxResultsPerSource,
				mmrLambda: retrieval.mmrLambda,
				mode: retrieval.mode,
				diversityStrategy: retrieval.diversityStrategy,
				query: input.query,
				queryTransformLabel: transformed.label,
				queryTransformProvider: resolvedQueryTransform?.providerName,
				queryTransformReason: transformed.reason,
				multiVector: {
					collapsedParents,
					configured: vectorVariantHits > 0 || lexicalVariantHits > 0,
					lexicalVariantHits,
					vectorVariantHits
				},
				resultCounts: {
					final: filtered.length,
					fused: results.length,
					lexical: lexicalResults.length,
					reranked: diversified.length,
					vector: vectorResults.length
				},
				requestedMode: requestedRetrieval.mode,
				runLexical,
				runVector,
				routingLabel:
					retrievalDecision?.label ??
					resolvedRetrievalStrategy?.defaultLabel,
				routingProvider: resolvedRetrievalStrategy?.providerName,
				routingReason: retrievalDecision?.reason,
				scoreThreshold,
				sourceBalanceStrategy: retrieval.sourceBalanceStrategy,
				steps,
				topK,
				transformedQuery: transformed.query,
				variantQueries: searchQueries.slice(1)
			}
		};
	};

	const search = async (input: RAGCollectionSearchParams) => {
		const result = await searchWithTrace(input);

		return result.results;
	};

	const ingest = async (input: RAGUpsertInput) => {
		const chunks = (
			await Promise.all(
				input.chunks.map(async (chunk) => {
					const normalizedEmbedding = chunk.embedding
						? (validateRAGEmbeddingDimensions(
								chunk.embedding,
								getExpectedDimensions(),
								'chunk'
							),
							chunk.embedding)
						: await embed(
								{
									model: options.defaultModel,
									text: chunk.text
								},
								'chunk'
							);
					const normalizedVariants = chunk.embeddingVariants
						? await Promise.all(
								chunk.embeddingVariants.map(async (variant) => {
									const embedding = variant.embedding
										? (validateRAGEmbeddingDimensions(
												variant.embedding,
												getExpectedDimensions(),
												'chunk'
											),
											variant.embedding)
										: await embed(
												{
													model: options.defaultModel,
													text:
														variant.text ??
														chunk.text
												},
												'chunk'
											);

									return {
										...variant,
										embedding
									};
								})
							)
						: undefined;

					return expandChunkForMultivectorStorage({
						...chunk,
						embedding: normalizedEmbedding,
						embeddingVariants: normalizedVariants,
						metadata: {
							...(chunk.metadata ?? {}),
							[MULTIVECTOR_PRIMARY]: true
						}
					});
				})
			)
		).flat();

		await options.store.upsert({ chunks });
	};

	return {
		clear:
			typeof options.store.clear === 'function'
				? () => options.store.clear?.()
				: undefined,
		getCapabilities:
			typeof getCapabilities === 'function'
				? () => getCapabilities()
				: undefined,
		getStatus:
			typeof getStatus === 'function' ? () => getStatus() : undefined,
		searchWithTrace,
		search,
		store: options.store,
		ingest
	};
};
export const ingestDocuments = async (
	collection: RAGCollection,
	input: RAGUpsertInput
) => collection.ingest(input);
export const ingestRAGDocuments = async (
	collection: RAGCollection,
	input: RAGDocumentIngestInput
) => collection.ingest(buildRAGUpsertInputFromDocuments(input));
export const searchDocuments = async (
	collection: RAGCollection,
	input: RAGCollectionSearchParams
) => collection.search(input);
