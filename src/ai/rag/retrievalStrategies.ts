import type {
	RAGRetrievalStrategyProvider,
	RAGRetrievalStrategyInput
} from '../../../types/ai';

export type HeuristicRAGRetrievalStrategyOptions = {
	providerName?: string;
	defaultLabel?: string;
};

const tokenize = (value: string) =>
	value
		.toLowerCase()
		.split(/[^a-z0-9]+/i)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);

const hasAnyToken = (tokens: string[], values: string[]) =>
	values.some((value) => tokens.includes(value));

const buildSelectorMetadata = (
	selector: string,
	extra: Record<string, string | number | boolean | null> = {}
) => ({
	selector,
	...extra
});

const countLongTokens = (tokens: string[]) =>
	tokens.filter((token) => token.length >= 5).length;

const hasExactPhraseIntent = (tokens: string[]) => {
	const exactPhraseCue = hasAnyToken(tokens, [
		'phrase',
		'phrasing',
		'wording',
		'verbatim',
		'quoted',
		'quote',
		'snippet',
		'precise',
		'exact'
	]);
	if (!exactPhraseCue) {
		return false;
	}

	return tokens.length >= 6 || countLongTokens(tokens) >= 4;
};

export const createHeuristicRAGRetrievalStrategy = (
	options: HeuristicRAGRetrievalStrategyOptions = {}
): RAGRetrievalStrategyProvider => ({
	defaultLabel: options.defaultLabel ?? 'Heuristic retrieval routing',
	providerName: options.providerName ?? 'heuristic_retrieval_strategy',
	select: (input: RAGRetrievalStrategyInput) => {
		const scopedSource =
			typeof input.filter?.source === 'string' &&
			input.filter.source.trim().length > 0;
		const scopedDocumentId =
			typeof input.filter?.documentId === 'string' &&
			input.filter.documentId.trim().length > 0;
		if (
			(scopedSource || scopedDocumentId) &&
			input.retrieval.mode !== 'vector'
		) {
			return {
				label: 'Scoped direct route',
				mode: 'vector',
				reason: scopedDocumentId
					? 'documentId filter narrows retrieval to one target document'
					: 'source filter narrows retrieval to one source family',
				metadata: buildSelectorMetadata('scoped_direct_route')
			};
		}

		const tokens = tokenize(input.query);
		const transformedTokens = tokenize(input.transformedQuery);
		const combined = Array.from(new Set([...tokens, ...transformedTokens]));
		const hasVariants = input.variantQueries.length > 0;
		const exactPhraseHybrid =
			!hasVariants && hasExactPhraseIntent(combined);
		const supportLexical =
			hasAnyToken(combined, ['faq', 'policy', 'password', 'billing']) &&
			!hasVariants;
		if (supportLexical) {
			return {
				label: 'Support lexical route',
				mode: 'lexical',
				reason: 'faq/support phrase matched',
				metadata: buildSelectorMetadata('support_lexical')
			};
		}

		if (exactPhraseHybrid && input.retrieval.mode === 'vector') {
			return {
				label: 'Exact phrase hybrid route',
				mode: 'hybrid',
				lexicalTopK: Math.max(
					input.topK,
					Math.floor(
						input.retrieval.lexicalTopK ?? input.candidateTopK
					)
				),
				reason: 'exact sub-span wording benefits from lexical evidence',
				metadata: buildSelectorMetadata('exact_phrase_hybrid', {
					exactPhraseIntent: true
				})
			};
		}

		const sourceNativeHybrid =
			hasVariants ||
			hasAnyToken(combined, [
				'sheet',
				'worksheet',
				'workbook',
				'spreadsheet',
				'timestamp',
				'transcript',
				'attachment',
				'archive'
			]);
		if (sourceNativeHybrid && input.retrieval.mode === 'vector') {
			return {
				label: 'Source-native hybrid route',
				mode: 'hybrid',
				lexicalTopK: Math.max(
					input.topK,
					Math.floor(
						input.retrieval.lexicalTopK ?? input.candidateTopK
					)
				),
				reason: hasVariants
					? 'query expansion introduced source-native variants'
					: 'source-native terminology benefits from hybrid retrieval',
				metadata: buildSelectorMetadata('source_native_hybrid')
			};
		}

		return undefined;
	}
});
