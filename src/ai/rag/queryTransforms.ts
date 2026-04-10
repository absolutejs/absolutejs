import type {
	RAGQueryTransformInput,
	RAGQueryTransformProvider,
	RAGQueryTransformProviderLike,
	RAGQueryTransformResult,
	RAGQueryTransformer
} from '../../../types/ai';

export type CreateRAGQueryTransformOptions = {
	transform: RAGQueryTransformer;
	defaultModel?: string;
	providerName?: string;
};

export type HeuristicRAGQueryTransformOptions = {
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

const DOMAIN_EXPANSIONS: Record<string, string[]> = {
	archive: [
		'archive',
		'zip',
		'bundle',
		'entry',
		'runbook',
		'recovery',
		'procedure',
		'runbooks/recovery'
	],
	audio: [
		'audio',
		'media',
		'recording',
		'speaker',
		'transcript',
		'standup',
		'mp3'
	],
	deck: ['slide', 'deck', 'presentation', 'pptx', 'roadmap'],
	email: ['email', 'mail', 'thread', 'message', 'attachment'],
	frontend: [
		'frontend',
		'framework',
		'react',
		'vue',
		'svelte',
		'angular',
		'html',
		'htmx'
	],
	image: ['image', 'ocr', 'scan', 'screenshot', 'receipt'],
	pdf: ['pdf', 'document', 'page', 'ocr', 'scan'],
	spreadsheet: [
		'sheet',
		'worksheet',
		'workbook',
		'spreadsheet',
		'xlsx',
		'regional',
		'growth'
	],
	video: ['video', 'media', 'recording', 'transcript', 'timestamp']
};

const TERM_EXPANSIONS: Record<string, string[]> = {
	audio: ['timestamp', 'transcript', 'mp3', 'speaker'],
	frontend: [
		'frontend',
		'framework',
		'react',
		'vue',
		'svelte',
		'angular',
		'html',
		'htmx'
	],
	framework: [
		'frontend',
		'framework',
		'react',
		'vue',
		'svelte',
		'angular',
		'html',
		'htmx'
	],
	procedure: ['recovery', 'runbook'],
	procedur: ['recovery', 'runbook'],
	receipt: ['invoice', 'ocr', 'pdf'],
	named: ['sheet', 'worksheet', 'title'],
	sheet: ['worksheet', 'workbook', 'xlsx'],
	timestamp: ['audio', 'media', 'transcript', 'segment'],
	transcript: ['audio', 'video', 'media'],
	workbook: ['sheet', 'spreadsheet', 'xlsx']
};

const detectDomains = (tokens: string[]) => {
	const tokenSet = new Set(tokens);
	const domains = new Set<string>();

	for (const token of tokenSet) {
		if (
			token === 'sheet' ||
			token === 'worksheet' ||
			token === 'workbook' ||
			token === 'spreadsheet' ||
			token === 'xlsx'
		) {
			domains.add('spreadsheet');
		}
		if (token === 'archive' || token === 'zip' || token === 'bundle') {
			domains.add('archive');
		}
		if (token === 'audio' || token === 'speaker') {
			domains.add('audio');
		}
		if (token === 'video' || token === 'timestamp') {
			domains.add('video');
		}
		if (token === 'pdf' || token === 'page' || token === 'ocr') {
			domains.add('pdf');
		}
		if (token === 'slide' || token === 'deck' || token === 'presentation') {
			domains.add('deck');
		}
		if (
			token === 'frontend' ||
			token === 'framework' ||
			token === 'react' ||
			token === 'vue' ||
			token === 'svelte' ||
			token === 'angular' ||
			token === 'html' ||
			token === 'htmx'
		) {
			domains.add('frontend');
		}
		if (token === 'email' || token === 'mail' || token === 'thread') {
			domains.add('email');
		}
		if (token === 'image' || token === 'scan' || token === 'screenshot') {
			domains.add('image');
		}
	}

	return [...domains];
};

const uniqueQueryStrings = (values: string[]) =>
	Array.from(
		new Set(
			values
				.map((value) => value.trim())
				.filter((value) => value.length > 0)
		)
	);

const hasExplicitTimestamp = (query: string) =>
	/\b\d{1,2}:\d{2}\b/.test(query) ||
	/\b\d{1,2}:\d{2}\s*(?:to|-)\s*\d{1,2}:\d{2}\b/i.test(query);

const hasNamedSourcePhrase = (query: string) =>
	/\bnamed\s+[a-z0-9]/i.test(query) || /\btitled\s+[a-z0-9]/i.test(query);

const isExactMediaTimestampQuery = (query: string, domains: string[]) =>
	hasExplicitTimestamp(query) &&
	(domains.includes('audio') || domains.includes('video'));

const isExactNamedSpreadsheetQuery = (query: string, domains: string[]) =>
	hasNamedSourcePhrase(query) && domains.includes('spreadsheet');

export const createHeuristicRAGQueryTransform = (
	options: HeuristicRAGQueryTransformOptions = {}
) =>
	createRAGQueryTransform({
		defaultModel:
			options.defaultModel ?? 'absolute-heuristic-query-transform',
		providerName: options.providerName ?? 'absolute_heuristic',
		transform: ({ query }) => {
			const tokens = tokenize(query);
			const domains = detectDomains(tokens);
			if (domains.length === 0) {
				return { query };
			}

			const expandedTerms = domains.flatMap(
				(domain) => DOMAIN_EXPANSIONS[domain] ?? []
			);
			const tokenExpansions = tokens.flatMap(
				(token) => TERM_EXPANSIONS[token] ?? []
			);
			const spreadsheetNamedVariant = domains.includes('spreadsheet')
				? uniqueQueryStrings([
						...tokens,
						'spreadsheet',
						'workbook',
						'worksheet',
						'sheet',
						'named'
					]).join(' ')
				: '';
			const mediaTimestampVariant =
				domains.includes('audio') || domains.includes('video')
					? uniqueQueryStrings([
							...tokens,
							'audio',
							'media',
							'timestamp',
							'transcript',
							'segment'
						]).join(' ')
					: '';
			const rewrittenQuery = uniqueQueryStrings([
				...tokens,
				...expandedTerms,
				...tokenExpansions
			]).join(' ');
			const variants = domains.map((domain) =>
				uniqueQueryStrings([
					...tokens,
					...(DOMAIN_EXPANSIONS[domain] ?? []),
					...tokenExpansions
				]).join(' ')
			);
			if (spreadsheetNamedVariant.length > 0) {
				variants.push(spreadsheetNamedVariant);
			}
			if (mediaTimestampVariant.length > 0) {
				variants.push(mediaTimestampVariant);
			}
			const exactMediaTimestampQuery = isExactMediaTimestampQuery(
				query,
				domains
			);
			const preservePrimaryQuery =
				exactMediaTimestampQuery ||
				isExactNamedSpreadsheetQuery(query, domains);

			return {
				query: preservePrimaryQuery ? query : rewrittenQuery,
				variants: uniqueQueryStrings(
					exactMediaTimestampQuery
						? []
						: preservePrimaryQuery
							? [rewrittenQuery, ...variants]
							: variants
				)
			} satisfies RAGQueryTransformResult;
		}
	});

export const createRAGQueryTransform = (
	options: CreateRAGQueryTransformOptions
): RAGQueryTransformProvider => ({
	defaultModel: options.defaultModel,
	providerName: options.providerName,
	transform: options.transform
});

export const resolveRAGQueryTransform = (
	queryTransform: RAGQueryTransformProviderLike | undefined
) => {
	if (!queryTransform) {
		return null;
	}

	if (typeof queryTransform === 'function') {
		return {
			defaultModel: undefined,
			providerName: undefined,
			transform: queryTransform
		} satisfies RAGQueryTransformProvider;
	}

	return queryTransform;
};

export const applyRAGQueryTransform = async ({
	input,
	queryTransform
}: {
	input: RAGQueryTransformInput;
	queryTransform?: RAGQueryTransformProviderLike;
}) => {
	const resolved = resolveRAGQueryTransform(queryTransform);
	if (!resolved) {
		return {
			query: input.query,
			variants: []
		} satisfies RAGQueryTransformResult;
	}

	return Promise.resolve(
		resolved.transform({
			...input,
			model: input.model ?? resolved.defaultModel
		})
	);
};
