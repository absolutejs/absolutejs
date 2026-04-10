import type {
	RAGQueryResult,
	RAGReranker,
	RAGRerankerInput,
	RAGRerankerProvider,
	RAGRerankerProviderLike
} from '../../../types/ai';

export type CreateRAGRerankerOptions = {
	rerank: RAGReranker;
	defaultModel?: string;
	providerName?: string;
};

export type HeuristicRAGRerankerOptions = {
	defaultModel?: string;
	providerName?: string;
};

const tokenize = (value: string) =>
	value
		.toLowerCase()
		.split(/[^a-z0-9]+/i)
		.map((token) => token.trim())
		.filter((token) => !STOP_WORDS.has(token))
		.map((token) =>
			token.endsWith('ies') && token.length > 3
				? `${token.slice(0, -3)}y`
				: token.endsWith('ing') && token.length > 5
					? token.slice(0, -3)
					: token.endsWith('ed') && token.length > 4
						? token.slice(0, -2)
						: token.endsWith('es') && token.length > 4
							? token.slice(0, -2)
							: token.endsWith('s') && token.length > 3
								? token.slice(0, -1)
								: token
		)
		.map((token) =>
			token.endsWith('ck') && token.length > 4
				? token.slice(0, -1)
				: token
		)
		.map((token) =>
			token.endsWith('ay') && token.length > 4
				? `${token.slice(0, -2)}i`
				: token
		)
		.filter((token) => token.length > 1);

const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'by',
	'does',
	'every',
	'explain',
	'explains',
	'for',
	'how',
	'in',
	'is',
	'it',
	'of',
	'on',
	'or',
	'say',
	'says',
	'should',
	'stay',
	'the',
	'this',
	'to',
	'track',
	'what',
	'which',
	'why'
]);

const collectMetadataStrings = (value: unknown): string[] => {
	if (typeof value === 'string' || typeof value === 'number') {
		return [String(value)];
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry) => collectMetadataStrings(entry));
	}
	if (value && typeof value === 'object') {
		return Object.values(value).flatMap((entry) =>
			collectMetadataStrings(entry)
		);
	}

	return [];
};

const normalizeLooseText = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');

const scoreLoosePhraseMatch = (query: string, text: string) => {
	const normalizedQuery = normalizeLooseText(query);
	const normalizedText = normalizeLooseText(text);
	if (normalizedQuery.length === 0 || normalizedText.length === 0) {
		return 0;
	}

	if (normalizedText.includes(normalizedQuery)) {
		return 1;
	}

	const words = normalizedQuery.split(' ').filter(Boolean);
	for (let size = Math.min(5, words.length); size >= 2; size -= 1) {
		for (let index = 0; index <= words.length - size; index += 1) {
			const phraseWords = words.slice(index, index + size);
			if (phraseWords.every((word) => STOP_WORDS.has(word))) {
				continue;
			}

			const phrase = phraseWords.join(' ');
			if (normalizedText.includes(phrase)) {
				return Math.min(1, size / 4);
			}
		}
	}

	return 0;
};

const scoreHeuristicMatch = ({
	query,
	queryTokens,
	result
}: {
	query: string;
	queryTokens: string[];
	result: RAGQueryResult;
}) => {
	if (queryTokens.length === 0) {
		return result.score;
	}

	const metadataValues = collectMetadataStrings(result.metadata);
	const haystack = tokenize(
		[result.title, result.source, result.chunkText, ...metadataValues]
			.filter(Boolean)
			.join(' ')
	);
	const haystackSet = new Set(haystack);
	const overlap = queryTokens.filter((token) =>
		haystackSet.has(token)
	).length;
	const overlapBoost = overlap / queryTokens.length;
	const exactPhraseBoost = Math.max(
		normalizeText(
			[result.title, result.source, result.chunkText, ...metadataValues]
				.filter(Boolean)
				.join(' ')
		).includes(queryTokens.join(' '))
			? 1
			: 0,
		scoreLoosePhraseMatch(
			query,
			[result.title, result.source, result.chunkText, ...metadataValues]
				.filter(Boolean)
				.join(' ')
		)
	);
	const sourcePathBoost =
		typeof result.source === 'string' &&
		queryTokens.some((token) =>
			result.source?.toLowerCase().includes(token)
		)
			? 0.5
			: 0;
	const metadataBoost =
		metadataValues.length > 0
			? queryTokens.filter((token) =>
					metadataValues.some((value) =>
						value.toLowerCase().includes(token)
					)
				).length / queryTokens.length
			: 0;

	return (
		result.score +
		overlapBoost +
		exactPhraseBoost +
		sourcePathBoost +
		metadataBoost
	);
};

const normalizeText = (value: string) => tokenize(value).join(' ');

export const applyRAGReranking = async ({
	input,
	reranker
}: {
	input: RAGRerankerInput;
	reranker?: RAGRerankerProviderLike;
}) => {
	const resolved = resolveRAGReranker(reranker);
	if (!resolved) {
		return input.results;
	}

	const effectiveModel = input.model ?? resolved.defaultModel;

	return Promise.resolve(
		resolved.rerank({
			...input,
			model: effectiveModel
		})
	);
};
export const createHeuristicRAGReranker = (
	options: HeuristicRAGRerankerOptions = {}
) =>
	createRAGReranker({
		defaultModel: options.defaultModel ?? 'absolute-heuristic-reranker',
		providerName: options.providerName ?? 'absolute_heuristic',
		rerank: ({ query, results }) => {
			const queryTokens = tokenize(query);

			return [...results]
				.map((result, index) => ({
					index,
					result,
					score: scoreHeuristicMatch({
						query,
						queryTokens,
						result
					})
				}))
				.sort((left, right) => {
					if (right.score !== left.score) {
						return right.score - left.score;
					}

					return left.index - right.index;
				})
				.map(({ result, score }) => ({
					...result,
					score
				}));
		}
	});
export const createRAGReranker = (
	options: CreateRAGRerankerOptions
): RAGRerankerProvider => ({
	defaultModel: options.defaultModel,
	providerName: options.providerName,
	rerank: options.rerank
});
export const resolveRAGReranker = (
	reranker: RAGRerankerProviderLike | undefined
) => {
	if (!reranker) {
		return null;
	}

	if (typeof reranker === 'function') {
		return {
			defaultModel: undefined,
			providerName: undefined,
			rerank: reranker
		} satisfies RAGRerankerProvider;
	}

	return reranker;
};
