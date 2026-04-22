import type {
	RAGHybridFusionMode,
	RAGHybridRetrievalMode,
	RAGHybridSearchOptions,
	RAGQueryResult
} from '../../../types/ai';

const DEFAULT_FUSION_CONSTANT = 60;
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
		.filter((token) => token.length > 1);

const BM25_K1 = 1.2;
const BM25_B = 0.75;

type LexicalScoringCandidate = {
	chunkId: string;
	text: string;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
};

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

const normalizeSourceForLexical = (source: string) =>
	source
		.replace(/[#/_.-]+/g, ' ')
		.replace(/\bmd\b/g, 'markdown')
		.replace(/\bpptx\b/g, 'presentation')
		.replace(/\bxlsx\b/g, 'spreadsheet workbook sheet')
		.replace(/\bmp3\b/g, 'audio transcript media')
		.replace(/\bmp4\b/g, 'video transcript media')
		.replace(/\bzip\b/g, 'archive bundle');

const toFieldText = (value: unknown) =>
	collectMetadataStrings(value).filter(Boolean).join(' ');

const normalizeLooseText = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');

const scoreLoosePhraseMatch = (query: string, text: string) => {
	const normalizedQuery = normalizeLooseText(query);
	const normalizedText = normalizeLooseText(text ?? '');
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

const scoreTokenCoverage = (queryTokens: string[], text: string) => {
	const normalizedText = (text ?? '').toLowerCase();
	if (normalizedText.length === 0) {
		return 0;
	}

	const tokens = tokenize(normalizedText);
	if (tokens.length === 0) {
		return 0;
	}

	const tokenSet = new Set(tokens);
	const overlap = queryTokens.filter((token) => tokenSet.has(token)).length;
	return overlap / Math.max(1, queryTokens.length);
};

const scorePhraseMatch = (query: string, text: string) => {
	const normalizedQuery = tokenize(query).join(' ');
	const normalizedText = tokenize(text ?? '').join(' ');
	const tokenPhraseMatch =
		normalizedQuery.length > 0 && normalizedText.length > 0
			? normalizedText.includes(normalizedQuery)
				? 1
				: 0
			: 0;

	return Math.max(tokenPhraseMatch, scoreLoosePhraseMatch(query, text ?? ''));
};

const scoreWeightedField = ({
	coverageWeight,
	phraseWeight,
	query,
	queryTokens,
	text
}: {
	query: string;
	queryTokens: string[];
	text: string;
	coverageWeight: number;
	phraseWeight: number;
}) =>
	scoreTokenCoverage(queryTokens, text ?? '') * coverageWeight +
	scorePhraseMatch(query, text ?? '') * phraseWeight;

const extractWeightedLexicalFields = (result: {
	title?: string;
	source?: string;
	text: string;
	metadata?: Record<string, unknown>;
}) => {
	const metadata = result.metadata ?? {};
	const source = result.source ?? '';
	const archivePath =
		typeof metadata.archivePath === 'string'
			? metadata.archivePath
			: source.includes('#')
				? (source.split('#')[1] ?? '')
				: '';
	const mediaSegments = Array.isArray(metadata.mediaSegments)
		? metadata.mediaSegments
				.map((segment) =>
					segment && typeof segment === 'object'
						? toFieldText(segment)
						: ''
				)
				.filter(Boolean)
				.join(' ')
		: '';
	const mediaTimestampFocus =
		metadata.sourceNativeKind === 'media_segment'
			? [
					typeof metadata.mediaKind === 'string'
						? metadata.mediaKind
						: '',
					'audio',
					'video',
					'media',
					'timestamp',
					'segment',
					typeof metadata.mediaSegmentStartMs === 'number'
						? `timestamp ${metadata.mediaSegmentStartMs}`
						: '',
					typeof metadata.mediaSegmentEndMs === 'number'
						? `timestamp ${metadata.mediaSegmentEndMs}`
						: ''
				]
					.filter(Boolean)
					.join(' ')
			: '';
	const spreadsheetFocus =
		metadata.sourceNativeKind === 'spreadsheet_sheet'
			? [
					'spreadsheet',
					'workbook',
					'worksheet',
					'sheet',
					typeof metadata.sheetName === 'string'
						? `sheet named ${metadata.sheetName}`
						: '',
					typeof metadata.sheetIndex === 'number'
						? `worksheet ${metadata.sheetIndex + 1}`
						: ''
				]
					.filter(Boolean)
					.join(' ')
			: '';
	const metadataFocus = [
		metadata.sourceNativeKind,
		mediaTimestampFocus,
		spreadsheetFocus,
		metadata.sheetName,
		metadata.sheetNames,
		metadata.sheetIndex,
		metadata.slideNumber,
		metadata.slideTitle,
		metadata.slideTitles,
		metadata.threadTopic,
		metadata.speaker,
		metadata.fileKind,
		metadata.transcriptSource,
		metadata.archiveType
	]
		.flatMap((value) => collectMetadataStrings(value))
		.join(' ');

	return {
		archivePath,
		chunkText: result.text,
		mediaSegments,
		metadataFocus,
		metadataText: toFieldText(metadata),
		source: source ? normalizeSourceForLexical(source) : '',
		title: result.title ?? ''
	};
};

const FIELD_WEIGHTS = {
	archivePath: 4.2,
	chunkText: 1,
	mediaSegments: 3.8,
	metadataFocus: 4.1,
	metadataText: 1.4,
	source: 3.4,
	title: 2.8
} as const;

type WeightedFieldName = keyof typeof FIELD_WEIGHTS;

const getWeightedFieldTokens = (
	result: LexicalScoringCandidate
): Record<WeightedFieldName, string[]> => {
	const fields = extractWeightedLexicalFields({
		metadata: result.metadata,
		source: result.source,
		text: result.text,
		title: result.title
	});

	return {
		archivePath: tokenize(fields.archivePath ?? ''),
		chunkText: tokenize(fields.chunkText ?? ''),
		mediaSegments: tokenize(fields.mediaSegments ?? ''),
		metadataFocus: tokenize(fields.metadataFocus ?? ''),
		metadataText: tokenize(fields.metadataText ?? ''),
		source: tokenize(fields.source ?? ''),
		title: tokenize(fields.title ?? '')
	};
};

const countWeightedTermFrequency = (
	fieldTokens: Record<WeightedFieldName, string[]>,
	token: string
) =>
	(Object.keys(FIELD_WEIGHTS) as WeightedFieldName[]).reduce(
		(total, fieldName) =>
			total +
			fieldTokens[fieldName].filter((value) => value === token).length *
				FIELD_WEIGHTS[fieldName],
		0
	);

const computeWeightedDocumentLength = (
	fieldTokens: Record<WeightedFieldName, string[]>
) =>
	(Object.keys(FIELD_WEIGHTS) as WeightedFieldName[]).reduce(
		(total, fieldName) =>
			total + fieldTokens[fieldName].length * FIELD_WEIGHTS[fieldName],
		0
	);

export const buildRAGLexicalHaystack = (result: {
	title?: string;
	source?: string;
	chunkText: string;
	metadata?: Record<string, unknown>;
}) =>
	[
		result.title,
		result.source,
		typeof result.source === 'string'
			? normalizeSourceForLexical(result.source)
			: undefined,
		result.chunkText,
		...collectMetadataStrings(result.metadata)
	]
		.filter((value): value is string => Boolean(value))
		.join(' ');

export const scoreRAGLexicalMatch = (
	query: string,
	result: {
		title?: string;
		source?: string;
		chunkText: string;
		metadata?: Record<string, unknown>;
	}
) => {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) {
		return 0;
	}

	const fields = extractWeightedLexicalFields({
		metadata: result.metadata,
		source: result.source,
		text: result.chunkText,
		title: result.title
	});
	const haystack = buildRAGLexicalHaystack(result).toLowerCase();
	const overallCoverage = scoreTokenCoverage(queryTokens, haystack);
	if (overallCoverage === 0) {
		return 0;
	}

	const titleScore = scoreWeightedField({
		coverageWeight: 1.8,
		phraseWeight: 1.2,
		query,
		queryTokens,
		text: fields.title
	});
	const sourceScore = scoreWeightedField({
		coverageWeight: 2.6,
		phraseWeight: 1.4,
		query,
		queryTokens,
		text: fields.source
	});
	const metadataFocusScore = scoreWeightedField({
		coverageWeight: 2.8,
		phraseWeight: 1.6,
		query,
		queryTokens,
		text: fields.metadataFocus
	});
	const archivePathScore = scoreWeightedField({
		coverageWeight: 3.2,
		phraseWeight: 2.2,
		query,
		queryTokens,
		text: fields.archivePath
	});
	const mediaSegmentScore = scoreWeightedField({
		coverageWeight: 3,
		phraseWeight: 1.8,
		query,
		queryTokens,
		text: fields.mediaSegments
	});
	const metadataScore = scoreWeightedField({
		coverageWeight: 1.2,
		phraseWeight: 0.8,
		query,
		queryTokens,
		text: fields.metadataText
	});
	const chunkScore = scoreWeightedField({
		coverageWeight: 0.9,
		phraseWeight: 0.6,
		query,
		queryTokens,
		text: fields.chunkText
	});
	const exactPhraseBoost = scorePhraseMatch(query, haystack);
	const coverageBoost = overallCoverage;
	const fileKindBoost = resolveFileKindBoost(queryTokens, result.metadata);
	const transcriptBoost = resolveTranscriptBoost(
		queryTokens,
		result.metadata
	);
	const archiveBoost = resolveArchiveBoost(queryTokens, result);

	return (
		titleScore +
		sourceScore +
		metadataFocusScore +
		archivePathScore +
		mediaSegmentScore +
		metadataScore +
		chunkScore +
		coverageBoost +
		exactPhraseBoost +
		fileKindBoost +
		transcriptBoost +
		archiveBoost
	);
};

export const rankRAGLexicalMatches = <T extends LexicalScoringCandidate>(
	query: string,
	results: T[]
) => {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0 || results.length === 0) {
		return [];
	}

	const candidates = results.map((result) => {
		const fieldTokens = getWeightedFieldTokens(result);
		return {
			fieldTokens,
			length: computeWeightedDocumentLength(fieldTokens),
			result
		};
	});
	const averageDocumentLength =
		candidates.reduce((total, candidate) => total + candidate.length, 0) /
		Math.max(1, candidates.length);
	const uniqueQueryTokens = [...new Set(queryTokens)];
	const documentFrequency = new Map<string, number>();

	for (const token of uniqueQueryTokens) {
		let seen = 0;
		for (const candidate of candidates) {
			const tf = countWeightedTermFrequency(candidate.fieldTokens, token);
			if (tf > 0) {
				seen += 1;
			}
		}
		documentFrequency.set(token, seen);
	}

	return candidates
		.map((candidate, index) => {
			let bm25Score = 0;

			for (const token of uniqueQueryTokens) {
				const termFrequency = countWeightedTermFrequency(
					candidate.fieldTokens,
					token
				);
				if (termFrequency <= 0) {
					continue;
				}

				const df = documentFrequency.get(token) ?? 0;
				const idf = Math.log(
					1 + (candidates.length - df + 0.5) / (df + 0.5)
				);
				const denominator =
					termFrequency +
					BM25_K1 *
						(1 -
							BM25_B +
							BM25_B *
								(candidate.length /
									Math.max(1, averageDocumentLength)));
				bm25Score +=
					idf *
					((termFrequency * (BM25_K1 + 1)) /
						Math.max(1e-9, denominator));
			}

			const heuristicScore = scoreRAGLexicalMatch(query, {
				chunkText: candidate.result.text,
				metadata: candidate.result.metadata,
				source: candidate.result.source,
				title: candidate.result.title
			});

			return {
				index,
				result: candidate.result,
				score: bm25Score + heuristicScore * 0.35
			};
		})
		.filter((entry) => entry.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return left.index - right.index;
		})
		.map(({ result, score }) => ({
			result,
			score
		}));
};

const hasAnyToken = (tokens: string[], values: string[]) =>
	values.some((value) => tokens.includes(value));

const resolveFileKindBoost = (
	queryTokens: string[],
	metadata?: Record<string, unknown>
) => {
	const fileKind =
		typeof metadata?.fileKind === 'string' ? metadata.fileKind : '';
	if (
		fileKind === 'office' &&
		hasAnyToken(queryTokens, [
			'sheet',
			'worksheet',
			'workbook',
			'spreadsheet'
		])
	) {
		return 0.75;
	}

	if (
		fileKind === 'archive' &&
		hasAnyToken(queryTokens, [
			'archive',
			'bundle',
			'entry',
			'runbook',
			'recovery'
		])
	) {
		return 0.85;
	}

	if (
		fileKind === 'media' &&
		hasAnyToken(queryTokens, [
			'frontend',
			'framework',
			'transcript',
			'audio',
			'video',
			'timestamp',
			'segment'
		])
	) {
		return 0.75;
	}

	return 0;
};

const resolveTranscriptBoost = (
	queryTokens: string[],
	metadata?: Record<string, unknown>
) => {
	const segments = Array.isArray(metadata?.mediaSegments)
		? metadata.mediaSegments
		: [];
	if (segments.length === 0) {
		return 0;
	}

	const segmentText = segments
		.map((segment) =>
			segment && typeof segment === 'object' && 'text' in segment
				? String(segment.text ?? '')
				: ''
		)
		.join(' ')
		.toLowerCase();

	if (segmentText.length === 0) {
		return 0;
	}

	const overlap = queryTokens.filter((token) =>
		segmentText.includes(token)
	).length;
	const timestampBoost = queryTokens.includes('timestamp') ? 0.35 : 0;
	return Math.min(
		1,
		overlap / Math.max(1, queryTokens.length) + timestampBoost
	);
};

const resolveArchiveBoost = (
	queryTokens: string[],
	result: {
		source?: string;
		metadata?: Record<string, unknown>;
	}
) => {
	const archivePath =
		typeof result.metadata?.archivePath === 'string'
			? result.metadata.archivePath.toLowerCase()
			: typeof result.source === 'string' && result.source.includes('#')
				? (result.source.split('#')[1]?.toLowerCase() ?? '')
				: '';
	if (!archivePath) {
		return 0;
	}

	if (queryTokens.includes('recovery') && archivePath.includes('recovery')) {
		return 1;
	}

	if (queryTokens.includes('runbook') && archivePath.includes('runbook')) {
		return 0.8;
	}

	return 0;
};

type RankedResult = {
	rank: number;
	result: RAGQueryResult;
};

const rankResults = (results: RAGQueryResult[]) =>
	results.map((result, index) => ({
		rank: index + 1,
		result
	}));

export const fuseRAGQueryResults = ({
	fusion = 'rrf',
	fusionConstant = DEFAULT_FUSION_CONSTANT,
	lexical = [],
	lexicalWeight = 2,
	vector = [],
	vectorWeight = 1
}: {
	vector?: RAGQueryResult[];
	lexical?: RAGQueryResult[];
	fusion?: RAGHybridFusionMode;
	fusionConstant?: number;
	lexicalWeight?: number;
	vectorWeight?: number;
}) => {
	const merged = new Map<
		string,
		{
			result: RAGQueryResult;
			score: number;
		}
	>();
	const vectorContributionWeight = Math.max(0, vectorWeight);
	const lexicalContributionWeight = Math.max(0, lexicalWeight);

	const applyRanked = (
		ranked: RankedResult[],
		source: 'vector' | 'lexical'
	) => {
		for (const entry of ranked) {
			const existing = merged.get(entry.result.chunkId);
			const weight =
				source === 'lexical'
					? lexicalContributionWeight
					: vectorContributionWeight;
			const contribution =
				fusion === 'max'
					? entry.result.score * weight
					: weight / (fusionConstant + entry.rank);
			const baseResult = existing?.result ?? entry.result;
			const existingSignals =
				existing?.result.metadata &&
				typeof existing.result.metadata.retrievalSignals === 'object' &&
				existing.result.metadata.retrievalSignals !== null
					? (existing.result.metadata.retrievalSignals as Record<
							string,
							unknown
						>)
					: {};
			const nextScore =
				fusion === 'max'
					? Math.max(existing?.score ?? 0, contribution)
					: (existing?.score ?? 0) + contribution;

			merged.set(entry.result.chunkId, {
				result: {
					...baseResult,
					score: nextScore,
					metadata: {
						...baseResult.metadata,
						retrievalSignals: {
							lexical:
								source === 'lexical' ||
								existingSignals.lexical === true,
							vector:
								source === 'vector' ||
								existingSignals.vector === true
						}
					}
				},
				score: nextScore
			});
		}
	};

	applyRanked(rankResults(vector), 'vector');
	applyRanked(rankResults(lexical), 'lexical');

	return [...merged.values()]
		.map(({ result, score }) => ({ ...result, score }))
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return left.chunkId.localeCompare(right.chunkId);
		});
};

export const resolveRAGHybridSearchOptions = (
	retrieval: RAGHybridSearchOptions | RAGHybridRetrievalMode | undefined
): Required<
	Pick<
		RAGHybridSearchOptions,
		| 'fusion'
		| 'fusionConstant'
		| 'lexicalWeight'
		| 'mode'
		| 'diversityStrategy'
		| 'mmrLambda'
		| 'sourceBalanceStrategy'
		| 'vectorWeight'
	>
> &
	Pick<RAGHybridSearchOptions, 'lexicalTopK' | 'maxResultsPerSource'> => {
	if (!retrieval) {
		return {
			fusion: 'rrf' as const,
			fusionConstant: DEFAULT_FUSION_CONSTANT,
			lexicalTopK: undefined,
			lexicalWeight: 2,
			mmrLambda: 0.7,
			sourceBalanceStrategy: 'cap' as const,
			diversityStrategy: 'none' as const,
			mode: 'vector' as const,
			vectorWeight: 1
		};
	}

	if (typeof retrieval === 'string') {
		return {
			fusion: 'rrf' as const,
			fusionConstant: DEFAULT_FUSION_CONSTANT,
			lexicalTopK: undefined,
			lexicalWeight: 2,
			mmrLambda: 0.7,
			sourceBalanceStrategy: 'cap' as const,
			diversityStrategy: 'none' as const,
			mode: retrieval,
			vectorWeight: 1
		};
	}

	return {
		fusion: retrieval.fusion ?? 'rrf',
		fusionConstant: Math.max(
			1,
			Math.floor(retrieval.fusionConstant ?? DEFAULT_FUSION_CONSTANT)
		),
		lexicalTopK: retrieval.lexicalTopK,
		maxResultsPerSource:
			typeof retrieval.maxResultsPerSource === 'number'
				? Math.max(1, Math.floor(retrieval.maxResultsPerSource))
				: undefined,
		lexicalWeight: Math.max(0, retrieval.lexicalWeight ?? 2),
		mmrLambda: Math.min(1, Math.max(0, retrieval.mmrLambda ?? 0.7)),
		mode: retrieval.mode ?? 'vector',
		diversityStrategy:
			retrieval.diversityStrategy === 'mmr' ? 'mmr' : 'none',
		sourceBalanceStrategy:
			retrieval.sourceBalanceStrategy === 'round_robin'
				? 'round_robin'
				: 'cap',
		vectorWeight: Math.max(0, retrieval.vectorWeight ?? 1)
	};
};
