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

const INTERNAL_RETRIEVAL_METADATA_KEYS = new Set([
	'retrievalChannels',
	'retrievalQuery',
	'retrievalQueryIndex',
	'retrievalQueryOrigin',
	'retrievalQueryOrigins'
]);

const collectMetadataStrings = (value: unknown, key?: string): string[] => {
	if (typeof key === 'string' && INTERNAL_RETRIEVAL_METADATA_KEYS.has(key)) {
		return [];
	}

	if (typeof value === 'string' || typeof value === 'number') {
		return [String(value)];
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry) => collectMetadataStrings(entry));
	}
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([entryKey, entry]) =>
			collectMetadataStrings(entry, entryKey)
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

const extractQuotedPhrases = (query: string) =>
	Array.from(
		query.matchAll(/["']([^"']{2,})["']/g),
		(match) => match[1]?.trim() ?? ''
	).filter((value) => value.length > 0);

const queryHasQuotedPhraseMatch = (query: string, text: string) => {
	const normalizedText = normalizeLooseText(text);
	if (normalizedText.length === 0) {
		return false;
	}

	return extractQuotedPhrases(query).some((phrase) => {
		const normalizedPhrase = normalizeLooseText(phrase);
		return (
			normalizedPhrase.length > 0 &&
			normalizedText.includes(normalizedPhrase)
		);
	});
};

const queryHasAnyToken = (
	queryTokens: string[],
	candidates: readonly string[]
) => candidates.some((candidate) => queryTokens.includes(candidate));

const metadataString = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? value.trim().toLowerCase()
		: undefined;

const countDistinctTokenMatches = (
	queryTokens: string[],
	candidates: Array<string | undefined>
) => {
	const normalizedCandidates = candidates.filter(
		(value): value is string =>
			typeof value === 'string' && value.length > 0
	);
	if (normalizedCandidates.length === 0 || queryTokens.length === 0) {
		return 0;
	}

	return new Set(
		queryTokens.filter((token) =>
			normalizedCandidates.some((candidate) => candidate.includes(token))
		)
	).size;
};

const scoreFeatureFamilyMatches = ({
	queryTokens,
	candidates,
	enabled,
	presenceBonus = 0,
	matchBase = 0,
	matchWeight = 0,
	matchCap = 0
}: {
	queryTokens: string[];
	candidates: Array<string | undefined>;
	enabled: boolean;
	presenceBonus?: number;
	matchBase?: number;
	matchWeight?: number;
	matchCap?: number;
}) => {
	const normalizedCandidates = candidates.filter(
		(value): value is string =>
			typeof value === 'string' && value.length > 0
	);
	if (!enabled || normalizedCandidates.length === 0) {
		return { matchCount: 0, score: 0 };
	}

	const matchCount = countDistinctTokenMatches(
		queryTokens,
		normalizedCandidates
	);
	let score = presenceBonus;
	if (matchCount > 0) {
		score += matchBase + Math.min(matchCap, matchCount * matchWeight);
	}

	return { matchCount, score };
};

const scoreOrdinalPreference = ({
	baseScore = 0,
	firstScore,
	latestScore,
	ordinal,
	prefersFirst,
	prefersLatest,
	prefersSecond,
	prefersThird,
	secondScore,
	thirdScore,
	total
}: {
	ordinal: number | undefined;
	total?: number;
	prefersFirst: boolean;
	prefersSecond: boolean;
	prefersThird: boolean;
	prefersLatest: boolean;
	baseScore?: number;
	firstScore: number;
	secondScore: number;
	thirdScore: number;
	latestScore: number;
}) => {
	if (typeof ordinal !== 'number') {
		return 0;
	}

	let score = baseScore;
	if (prefersFirst && ordinal === 1) {
		score += firstScore;
	}
	if (prefersSecond && ordinal === 2) {
		score += secondScore;
	}
	if (prefersThird && ordinal === 3) {
		score += thirdScore;
	}
	if (
		prefersLatest &&
		typeof total === 'number' &&
		total > 0 &&
		ordinal === total
	) {
		score += latestScore;
	}

	return score;
};

const scoreBoundedMagnitude = (
	value: number | undefined,
	weight: number,
	cap: number
) =>
	typeof value === 'number' && Number.isFinite(value)
		? Math.min(cap, Math.max(0, value) * weight)
		: 0;

const scoreActiveSignals = (
	signals: ReadonlyArray<{
		active: boolean | string | undefined;
		score: number;
	}>
) =>
	signals.reduce(
		(score, signal) => score + (signal.active ? signal.score : 0),
		0
	);

const spreadsheetColumnIndex = (label: string | undefined) => {
	if (typeof label !== 'string' || label.length === 0) {
		return undefined;
	}

	let index = 0;
	for (const character of label.toUpperCase()) {
		const code = character.charCodeAt(0);
		if (code < 65 || code > 90) {
			return undefined;
		}
		index = index * 26 + (code - 64);
	}

	return index > 0 ? index : undefined;
};

const extractSpreadsheetColumnMentions = (query: string) => {
	const mentions = new Set<string>();
	for (const match of query.matchAll(
		/\bcolumns?\s+([a-z]+)(?:\s*(?:to|-|through|and)\s*([a-z]+))?/gi
	)) {
		const first = match[1]?.toUpperCase();
		const second = match[2]?.toUpperCase();
		if (first) {
			mentions.add(first);
		}
		if (second) {
			mentions.add(second);
		}
	}

	return [...mentions];
};

const getEmailMessageLineageCount = (metadata: Record<string, unknown>) => {
	if (
		typeof metadata.emailMessageLineageCount === 'number' &&
		Number.isFinite(metadata.emailMessageLineageCount)
	) {
		return metadata.emailMessageLineageCount;
	}

	if (Array.isArray(metadata.emailMessageLineage)) {
		return metadata.emailMessageLineage.filter(
			(entry) => entry && typeof entry === 'object'
		).length;
	}

	if (
		typeof metadata.emailMessageDepth === 'number' &&
		Number.isFinite(metadata.emailMessageDepth)
	) {
		return metadata.emailMessageDepth;
	}

	return undefined;
};

const scoreStructuredEvidenceMatch = (
	query: string,
	queryTokens: string[],
	result: RAGQueryResult
) => {
	const metadata = result.metadata ?? {};
	const pdfTextKind =
		typeof metadata.pdfTextKind === 'string'
			? metadata.pdfTextKind
			: undefined;
	const officeBlockKind =
		typeof metadata.officeBlockKind === 'string'
			? metadata.officeBlockKind
			: undefined;
	const slideTitle = metadataString(metadata.slideTitle);
	const slideNotesText = metadataString(metadata.slideNotesText);
	const threadTopic = metadataString(metadata.threadTopic);
	const threadIndex = metadataString(metadata.threadIndex);
	const threadRootMessageId = metadataString(metadata.threadRootMessageId);
	const threadMessageIds = Array.isArray(metadata.threadMessageIds)
		? metadata.threadMessageIds
				.map((value) => metadataString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const references = metadataString(metadata.references);
	const replyDepth =
		typeof metadata.replyDepth === 'number' &&
		Number.isFinite(metadata.replyDepth)
			? metadata.replyDepth
			: undefined;
	const replyReferenceCount =
		typeof metadata.replyReferenceCount === 'number' &&
		Number.isFinite(metadata.replyReferenceCount)
			? metadata.replyReferenceCount
			: undefined;
	const emailSectionKind =
		metadata.emailSectionKind === 'authored_text' ||
		metadata.emailSectionKind === 'quoted_history' ||
		metadata.emailSectionKind === 'forwarded_headers'
			? metadata.emailSectionKind
			: undefined;
	const emailQuotedDepth =
		typeof metadata.emailQuotedDepth === 'number' &&
		Number.isFinite(metadata.emailQuotedDepth)
			? metadata.emailQuotedDepth
			: undefined;
	const emailForwardedOrdinal =
		typeof metadata.emailForwardedOrdinal === 'number' &&
		Number.isFinite(metadata.emailForwardedOrdinal)
			? metadata.emailForwardedOrdinal
			: undefined;
	const emailForwardedChainCount =
		typeof metadata.emailForwardedChainCount === 'number' &&
		Number.isFinite(metadata.emailForwardedChainCount)
			? metadata.emailForwardedChainCount
			: undefined;
	const emailMessageLineageCount = getEmailMessageLineageCount(metadata);
	const emailMessageSourceKind = metadataString(
		metadata.emailMessageSourceKind
	);
	const emailAttachmentSource = metadataString(
		metadata.emailAttachmentSource
	);
	const attachmentContentId = metadataString(metadata.attachmentContentId);
	const attachmentContentLocation = metadataString(
		metadata.attachmentContentLocation
	);
	const attachmentEmbeddedReferenceMatched =
		metadata.attachmentEmbeddedReferenceMatched === true;
	const attachmentIndex =
		typeof metadata.attachmentIndex === 'number' &&
		Number.isFinite(metadata.attachmentIndex)
			? metadata.attachmentIndex
			: undefined;
	const attachmentCount =
		typeof metadata.attachmentCount === 'number' &&
		Number.isFinite(metadata.attachmentCount)
			? metadata.attachmentCount
			: undefined;
	const emailMailboxContainerSource = metadataString(
		metadata.emailMailboxContainerSource
	);
	const emailMailboxFamilyKey = metadataString(
		metadata.emailMailboxFamilyKey
	);
	const emailMailboxFolder = metadataString(metadata.emailMailboxFolder);
	const emailMailboxFormat = metadataString(metadata.emailMailboxFormat);
	const emailMailboxLeaf = metadataString(metadata.emailMailboxLeaf);
	const emailMailboxStateFlags = Array.isArray(
		metadata.emailMailboxStateFlags
	)
		? metadata.emailMailboxStateFlags
				.map((value) => metadataString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const emailMailboxIsDraft = metadata.emailMailboxIsDraft === true;
	const emailMailboxIsFlagged = metadata.emailMailboxIsFlagged === true;
	const emailMailboxIsPassed = metadata.emailMailboxIsPassed === true;
	const emailMailboxIsRead = metadata.emailMailboxIsRead === true;
	const emailMailboxIsReplied = metadata.emailMailboxIsReplied === true;
	const emailMailboxIsTrashed = metadata.emailMailboxIsTrashed === true;
	const emailMailboxIsUnread = metadata.emailMailboxIsUnread === true;
	const emailMailboxPathSegments = Array.isArray(
		metadata.emailMailboxPathSegments
	)
		? metadata.emailMailboxPathSegments
				.map((value) => metadataString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const emailMailboxPathDepth =
		typeof metadata.emailMailboxPathDepth === 'number' &&
		Number.isFinite(metadata.emailMailboxPathDepth)
			? metadata.emailMailboxPathDepth
			: emailMailboxPathSegments.length > 0
				? emailMailboxPathSegments.length
				: undefined;
	const emailMailboxMessageCount =
		typeof metadata.emailMailboxMessageCount === 'number' &&
		Number.isFinite(metadata.emailMailboxMessageCount)
			? metadata.emailMailboxMessageCount
			: undefined;
	const emailMailboxMessageOrdinal =
		typeof metadata.emailMailboxMessageOrdinal === 'number' &&
		Number.isFinite(metadata.emailMailboxMessageOrdinal)
			? metadata.emailMailboxMessageOrdinal
			: undefined;
	const emailCategories = Array.isArray(metadata.emailCategories)
		? metadata.emailCategories
				.map((value) => metadataString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const emailImportance = metadataString(metadata.emailImportance);
	const emailNormalizedSubject = metadataString(
		metadata.emailNormalizedSubject
	);
	const emailSensitivity = metadataString(metadata.emailSensitivity);
	const emailSentAt = metadataString(metadata.emailSentAt);
	const emailReceivedAt = metadataString(metadata.emailReceivedAt);
	const emailClientSubmitTime = metadataString(
		metadata.emailClientSubmitTime
	);
	const emailDeliveryTime = metadataString(metadata.emailDeliveryTime);
	const emailCreationTime = metadataString(metadata.emailCreationTime);
	const emailLastModifiedTime = metadataString(
		metadata.emailLastModifiedTime
	);
	const emailConversationIndex = metadataString(
		metadata.emailConversationIndex
	);
	const emailConversationTopic = metadataString(
		metadata.emailConversationTopic
	);
	const emailConversationId = metadataString(metadata.emailConversationId);
	const inReplyTo = metadataString(metadata.inReplyTo);
	const messageId = metadataString(metadata.messageId);
	const emailInternetMessageId = metadataString(
		metadata.emailInternetMessageId
	);
	const emailMessageClass = metadataString(metadata.emailMessageClass);
	const emailAttachmentRole = metadataString(metadata.emailAttachmentRole);
	const emailMessageSource = metadataString(metadata.emailMessageSource);
	const emailMessageLineageAttachmentSources = Array.isArray(
		metadata.emailMessageLineageAttachmentSources
	)
		? metadata.emailMessageLineageAttachmentSources
				.map((value) => metadataString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const emailReplySiblingCount =
		typeof metadata.emailReplySiblingCount === 'number' &&
		Number.isFinite(metadata.emailReplySiblingCount)
			? metadata.emailReplySiblingCount
			: undefined;
	const emailReplySiblingParentMessageId = metadataString(
		metadata.emailReplySiblingParentMessageId
	);
	const emailReplySiblingOrdinal =
		typeof metadata.emailReplySiblingOrdinal === 'number' &&
		Number.isFinite(metadata.emailReplySiblingOrdinal)
			? metadata.emailReplySiblingOrdinal
			: undefined;
	const threadMessageCount =
		typeof metadata.threadMessageCount === 'number'
			? metadata.threadMessageCount
			: undefined;
	const attachmentName = metadataString(metadata.attachmentName);
	const archivePath = metadataString(metadata.archivePath);
	const archiveFullPath = metadataString(metadata.archiveFullPath);
	const archiveContainerPath = metadataString(metadata.archiveContainerPath);
	const archiveNestedDepth =
		typeof metadata.archiveNestedDepth === 'number'
			? metadata.archiveNestedDepth
			: undefined;
	const mediaSpeakerCount =
		typeof metadata.mediaSpeakerCount === 'number'
			? metadata.mediaSpeakerCount
			: undefined;
	const mediaSegmentCount =
		typeof metadata.mediaSegmentCount === 'number'
			? metadata.mediaSegmentCount
			: undefined;
	const mediaSegmentGroupSize =
		typeof metadata.mediaSegmentGroupSize === 'number'
			? metadata.mediaSegmentGroupSize
			: undefined;
	const mediaSegmentGroupStartMs =
		typeof metadata.mediaSegmentGroupStartMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGroupStartMs)
			? metadata.mediaSegmentGroupStartMs
			: typeof metadata.mediaSegmentStartMs === 'number' &&
				  Number.isFinite(metadata.mediaSegmentStartMs)
				? metadata.mediaSegmentStartMs
				: undefined;
	const mediaSegmentGroupEndMs =
		typeof metadata.mediaSegmentGroupEndMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGroupEndMs)
			? metadata.mediaSegmentGroupEndMs
			: typeof metadata.mediaSegmentEndMs === 'number' &&
				  Number.isFinite(metadata.mediaSegmentEndMs)
				? metadata.mediaSegmentEndMs
				: undefined;
	const mediaSegmentGroupDurationMs =
		typeof metadata.mediaSegmentGroupDurationMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGroupDurationMs)
			? metadata.mediaSegmentGroupDurationMs
			: typeof mediaSegmentGroupStartMs === 'number' &&
				  typeof mediaSegmentGroupEndMs === 'number' &&
				  mediaSegmentGroupEndMs >= mediaSegmentGroupStartMs
				? mediaSegmentGroupEndMs - mediaSegmentGroupStartMs
				: undefined;
	const mediaSegmentGapFromPreviousMs =
		typeof metadata.mediaSegmentGapFromPreviousMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGapFromPreviousMs)
			? metadata.mediaSegmentGapFromPreviousMs
			: undefined;
	const mediaSegmentGapToNextMs =
		typeof metadata.mediaSegmentGapToNextMs === 'number' &&
		Number.isFinite(metadata.mediaSegmentGapToNextMs)
			? metadata.mediaSegmentGapToNextMs
			: undefined;
	const mediaChannel = metadataString(metadata.mediaChannel);
	const speaker = metadataString(metadata.speaker);
	const ocrConfidence =
		typeof metadata.ocrRegionConfidence === 'number'
			? metadata.ocrRegionConfidence
			: typeof metadata.ocrPageAverageConfidence === 'number'
				? metadata.ocrPageAverageConfidence
				: typeof metadata.ocrAverageConfidence === 'number'
					? metadata.ocrAverageConfidence
					: typeof metadata.ocrConfidence === 'number'
						? metadata.ocrConfidence
						: undefined;
	const isOCREvidence =
		typeof ocrConfidence === 'number' ||
		metadataString(metadata.pdfTextMode) === 'ocr';
	const spreadsheetHeaders = Array.isArray(metadata.spreadsheetHeaders)
		? metadata.spreadsheetHeaders
				.map((value) => metadataString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const spreadsheetColumnStart = metadataString(
		metadata.spreadsheetColumnStart
	)?.toUpperCase();
	const spreadsheetColumnEnd = metadataString(
		metadata.spreadsheetColumnEnd
	)?.toUpperCase();
	const spreadsheetTableIndex =
		typeof metadata.spreadsheetTableIndex === 'number'
			? metadata.spreadsheetTableIndex
			: undefined;
	const spreadsheetTableCount =
		typeof metadata.spreadsheetTableCount === 'number'
			? metadata.spreadsheetTableCount
			: undefined;
	const hasSpreadsheetRows =
		typeof metadata.spreadsheetRowStart === 'number' ||
		typeof metadata.spreadsheetRowEnd === 'number';
	const hasBlockMetadata =
		typeof metadata.pdfBlockNumber === 'number' ||
		typeof metadata.officeBlockNumber === 'number';

	let score = 0;

	if (hasBlockMetadata) {
		score += 0.12;
	}

	if (
		pdfTextKind === 'table_like' &&
		queryHasAnyToken(queryTokens, [
			'table',
			'row',
			'rows',
			'column',
			'columns',
			'spreadsheet',
			'sheet',
			'workbook'
		])
	) {
		score += 0.65;
	}

	if (
		officeBlockKind === 'table' &&
		queryHasAnyToken(queryTokens, [
			'table',
			'row',
			'rows',
			'column',
			'columns',
			'matrix',
			'grid'
		])
	) {
		score += 0.55;
	}

	if (
		officeBlockKind === 'list' &&
		queryHasAnyToken(queryTokens, [
			'list',
			'checklist',
			'bullet',
			'bullets',
			'step',
			'steps',
			'task',
			'tasks',
			'item',
			'items'
		])
	) {
		score += 0.55;
	}

	if (
		spreadsheetHeaders.length > 0 &&
		(queryHasAnyToken(queryTokens, [
			'sheet',
			'spreadsheet',
			'workbook',
			'column',
			'columns',
			'row',
			'rows'
		]) ||
			queryTokens.some((token) =>
				spreadsheetHeaders.some((header) => header.includes(token))
			))
	) {
		score += 0.45;
	}

	if (
		hasSpreadsheetRows &&
		queryHasAnyToken(queryTokens, ['row', 'rows', 'sheet', 'spreadsheet'])
	) {
		score += 0.18;
	}

	if (
		typeof spreadsheetTableIndex === 'number' &&
		queryHasAnyToken(queryTokens, [
			'table',
			'tables',
			'sheet',
			'spreadsheet'
		])
	) {
		score += 0.16;
		if (
			typeof spreadsheetTableCount === 'number' &&
			spreadsheetTableCount > 1
		) {
			score += 0.08;
		}
	}

	const spreadsheetColumnMentions = extractSpreadsheetColumnMentions(query);
	if (
		spreadsheetColumnMentions.length > 0 &&
		typeof spreadsheetColumnStart === 'string' &&
		typeof spreadsheetColumnEnd === 'string'
	) {
		const startIndex = spreadsheetColumnIndex(spreadsheetColumnStart);
		const endIndex = spreadsheetColumnIndex(spreadsheetColumnEnd);
		if (
			typeof startIndex === 'number' &&
			typeof endIndex === 'number' &&
			spreadsheetColumnMentions.every((label) => {
				const columnIndex = spreadsheetColumnIndex(label);
				return (
					typeof columnIndex === 'number' &&
					columnIndex >= startIndex &&
					columnIndex <= endIndex
				);
			})
		) {
			score += 0.18;
		}
	}

	if (
		slideTitle &&
		(queryHasAnyToken(queryTokens, [
			'slide',
			'slides',
			'deck',
			'presentation'
		]) ||
			queryTokens.some((token) => slideTitle.includes(token)))
	) {
		score += 0.4;
	}

	if (
		slideNotesText &&
		queryHasAnyToken(queryTokens, [
			'notes',
			'speaker',
			'speakers',
			'talking'
		])
	) {
		score += 0.2;
	}

	if (
		speaker &&
		queryHasAnyToken(queryTokens, ['speaker', 'speakers', 'said', 'says'])
	) {
		score += 0.22;
	}

	if (speaker) {
		if (queryHasQuotedPhraseMatch(query, speaker)) {
			score += 0.42;
			if (
				queryHasAnyToken(queryTokens, [
					'speaker',
					'speakers',
					'said',
					'says'
				])
			) {
				score += 0.08;
			}
		}

		const speakerPhraseScore = scoreLoosePhraseMatch(query, speaker);
		if (speakerPhraseScore > 0) {
			score += 0.32 * speakerPhraseScore;
			if (
				queryHasAnyToken(queryTokens, [
					'speaker',
					'speakers',
					'said',
					'says'
				])
			) {
				score += 0.08;
			}
		}
	}

	if (
		typeof mediaSpeakerCount === 'number' &&
		mediaSpeakerCount > 1 &&
		queryHasAnyToken(queryTokens, [
			'speaker',
			'speakers',
			'conversation',
			'dialogue'
		])
	) {
		score += 0.12;
	}

	if (
		typeof mediaSegmentCount === 'number' &&
		mediaSegmentCount > 1 &&
		queryHasAnyToken(queryTokens, [
			'timestamp',
			'segment',
			'segments',
			'audio',
			'video'
		])
	) {
		score += 0.08;
	}

	if (
		typeof mediaSegmentGroupSize === 'number' &&
		mediaSegmentGroupSize > 1 &&
		queryHasAnyToken(queryTokens, [
			'segment',
			'segments',
			'timestamp',
			'group',
			'audio',
			'video'
		])
	) {
		score += 0.06;
	}

	if (
		typeof mediaSegmentGroupStartMs === 'number' &&
		typeof mediaSegmentGroupEndMs === 'number' &&
		queryHasAnyToken(queryTokens, [
			'timestamp',
			'segment',
			'segments',
			'audio',
			'video',
			'window',
			'start',
			'end'
		])
	) {
		score += 0.05;
	}

	if (
		typeof mediaSegmentGroupDurationMs === 'number' &&
		queryHasAnyToken(queryTokens, ['duration', 'timestamp', 'segment'])
	) {
		score += 0.06;
		if (
			queryHasAnyToken(queryTokens, ['long', 'longer', 'longest']) &&
			mediaSegmentGroupDurationMs >= 10_000
		) {
			score += 0.12;
		}
		if (
			queryHasAnyToken(queryTokens, ['short', 'shorter', 'shortest']) &&
			mediaSegmentGroupDurationMs <= 5000
		) {
			score += 0.12;
		}
	}

	if (
		queryHasAnyToken(queryTokens, ['continuous', 'gap', 'gaps']) &&
		typeof mediaSegmentGapFromPreviousMs === 'number'
	) {
		if (mediaSegmentGapFromPreviousMs === 0) {
			score += 0.2;
		} else if (mediaSegmentGapFromPreviousMs <= 1_000) {
			score += 0.14;
		} else if (mediaSegmentGapFromPreviousMs <= 3_000) {
			score += 0.06;
		}
	}

	if (
		typeof mediaSegmentGapFromPreviousMs === 'number' &&
		queryHasAnyToken(queryTokens, [
			'next',
			'after',
			'following',
			'follows',
			'followup',
			'follow-up'
		])
	) {
		if (mediaSegmentGapFromPreviousMs === 0) {
			score += 0.24;
		} else if (mediaSegmentGapFromPreviousMs <= 1_000) {
			score += 0.18;
		} else if (mediaSegmentGapFromPreviousMs <= 3_000) {
			score += 0.1;
		}

		if (speaker && scoreLoosePhraseMatch(query, speaker) > 0) {
			score += 0.16;
		}

		if (
			mediaChannel &&
			queryHasAnyToken(queryTokens, ['left', 'right', 'mono', 'channel'])
		) {
			if (queryHasQuotedPhraseMatch(query, mediaChannel)) {
				score += 0.16;
			}
			const channelPhraseScore = scoreLoosePhraseMatch(
				query,
				mediaChannel
			);
			if (channelPhraseScore > 0) {
				score += 0.12 * channelPhraseScore;
			}
		}
	}

	if (
		typeof mediaSegmentGapToNextMs === 'number' &&
		queryHasAnyToken(queryTokens, [
			'before',
			'previous',
			'prior',
			'earlier'
		])
	) {
		if (mediaSegmentGapToNextMs === 0) {
			score += 0.24;
		} else if (mediaSegmentGapToNextMs <= 1_000) {
			score += 0.18;
		} else if (mediaSegmentGapToNextMs <= 3_000) {
			score += 0.1;
		}

		if (speaker && scoreLoosePhraseMatch(query, speaker) > 0) {
			score += 0.16;
		}

		if (
			mediaChannel &&
			queryHasAnyToken(queryTokens, ['left', 'right', 'mono', 'channel'])
		) {
			if (queryHasQuotedPhraseMatch(query, mediaChannel)) {
				score += 0.16;
			}
			const channelPhraseScore = scoreLoosePhraseMatch(
				query,
				mediaChannel
			);
			if (channelPhraseScore > 0) {
				score += 0.12 * channelPhraseScore;
			}
		}
	}

	if (
		mediaChannel &&
		queryHasAnyToken(queryTokens, [
			'channel',
			'channels',
			'left',
			'right',
			'audio',
			'video'
		])
	) {
		score += 0.12;
		if (queryHasQuotedPhraseMatch(query, mediaChannel)) {
			score += 0.22;
		}
	}

	if (
		threadTopic &&
		(queryHasAnyToken(queryTokens, [
			'email',
			'emails',
			'thread',
			'reply',
			'replies',
			'attachment'
		]) ||
			queryTokens.some((token) => threadTopic.includes(token)))
	) {
		score += 0.34;
	}

	if (
		typeof threadMessageCount === 'number' &&
		threadMessageCount > 1 &&
		queryHasAnyToken(queryTokens, [
			'thread',
			'reply',
			'replies',
			'attachment'
		])
	) {
		score += 0.08;
	}

	if (
		attachmentName &&
		queryHasAnyToken(queryTokens, [
			'attachment',
			'attachments',
			'file',
			'files'
		])
	) {
		score += 0.18;
	}

	if (
		(emailAttachmentRole === 'inline_resource' ||
			attachmentContentId ||
			attachmentContentLocation ||
			attachmentEmbeddedReferenceMatched) &&
		queryHasAnyToken(queryTokens, [
			'inline',
			'cid',
			'embedded',
			'embed',
			'image',
			'logo',
			'preview'
		])
	) {
		const inlineReferenceValues = [
			...(attachmentContentId ? [attachmentContentId] : []),
			...(attachmentContentLocation ? [attachmentContentLocation] : []),
			...(attachmentName ? [attachmentName] : []),
			...(emailAttachmentSource ? [emailAttachmentSource] : [])
		];
		const inlineReferenceMatchCount = new Set(
			queryTokens.filter((token) =>
				inlineReferenceValues.some((value) => value.includes(token))
			)
		).size;
		score += 0.04;
		score += 0.16;
		if (attachmentEmbeddedReferenceMatched) {
			score += 0.14;
		}
		if (inlineReferenceMatchCount > 0) {
			score += 0.02 + Math.min(inlineReferenceMatchCount * 0.06, 0.36);
		}
	}

	const hasEmailCue = queryHasAnyToken(queryTokens, [
		'email',
		'emails',
		'message',
		'messages',
		'thread',
		'reply',
		'replies',
		'attachment',
		'attachments',
		'forwarded',
		'quoted',
		'quote',
		'history'
	]);
	const prefersAuthoredEmailEvidence = queryHasAnyToken(queryTokens, [
		'authored',
		'author',
		'actual',
		'local',
		'latest',
		'current',
		'reply',
		'response',
		'summary'
	]);
	const prefersQuotedEmailEvidence = queryHasAnyToken(queryTokens, [
		'quoted',
		'quote',
		'history',
		'previous',
		'prior',
		'earlier',
		'wrote'
	]);
	const prefersForwardedEmailEvidence = queryHasAnyToken(queryTokens, [
		'forwarded',
		'forward',
		'fwd',
		'header',
		'headers',
		'sender',
		'original'
	]);
	const prefersAttachedEmailLineage = queryHasAnyToken(queryTokens, [
		'attachment',
		'attachments',
		'attached',
		'forwarded',
		'nested',
		'deep',
		'deeper',
		'deepest',
		'ancestor',
		'ancestry',
		'lineage',
		'chain'
	]);
	const prefersMailboxLocality = queryHasAnyToken(queryTokens, [
		'mailbox',
		'folder',
		'inbox',
		'archive',
		'archived',
		'pst',
		'ost',
		'maildir',
		'mbox',
		'emlx',
		'apple',
		'mail'
	]);
	const prefersMailboxFormat = queryHasAnyToken(queryTokens, [
		'pst',
		'ost',
		'maildir',
		'mbox',
		'emlx'
	]);
	const prefersMailboxState = queryHasAnyToken(queryTokens, [
		'unread',
		'read',
		'seen',
		'unseen',
		'flagged',
		'starred',
		'important',
		'replied',
		'answered',
		'draft',
		'trashed',
		'trash',
		'deleted',
		'passed',
		'forwarded'
	]);
	const prefersFirstReplySibling = queryHasAnyToken(queryTokens, [
		'first',
		'earliest',
		'initial'
	]);
	const prefersSecondReplySibling = queryHasAnyToken(queryTokens, ['second']);
	const prefersThirdReplySibling = queryHasAnyToken(queryTokens, ['third']);
	const prefersLatestReplySibling = queryHasAnyToken(queryTokens, [
		'latest',
		'last',
		'final',
		'newest'
	]);
	const prefersReplySibling = queryHasAnyToken(queryTokens, [
		'reply',
		'replies',
		'branch',
		'branches',
		'sibling',
		'followup',
		'follow-up'
	]);
	const prefersMailboxMessage = queryHasAnyToken(queryTokens, [
		'message',
		'messages',
		'mailbox',
		'container',
		'pst',
		'ost',
		'mbox'
	]);
	const prefersEmailImportance = queryHasAnyToken(queryTokens, [
		'important',
		'priority',
		'urgent',
		'high'
	]);
	const prefersEmailNormalizedSubject =
		normalizeLooseText(query).includes('normalized subject') ||
		queryTokens.includes('normalizedsubject');
	const prefersEmailSensitivity = queryHasAnyToken(queryTokens, [
		'private',
		'confidential',
		'sensitive'
	]);
	const prefersEmailConversationIndex = queryHasAnyToken(queryTokens, [
		'conversation',
		'index'
	]);
	const prefersEmailConversationId =
		normalizeLooseText(query).includes('conversation id') ||
		queryTokens.includes('conversationid');
	const prefersEmailThreadIndex =
		normalizeLooseText(query).includes('thread index') ||
		queryTokens.includes('threadindex');
	const prefersEmailMessageClass = queryHasAnyToken(queryTokens, [
		'class',
		'note',
		'meeting',
		'appointment',
		'task',
		'contact',
		'report'
	]);
	const prefersEmailMessageId = queryHasAnyToken(queryTokens, [
		'message-id',
		'messageid',
		'internet-message-id',
		'internet',
		'id'
	]);
	const prefersEmailReplyParent = queryHasAnyToken(queryTokens, [
		'parent',
		'root',
		'ancestor',
		'reply',
		'thread'
	]);
	const prefersEmailReferenceChain =
		normalizeLooseText(query).includes('reference chain') ||
		queryHasAnyToken(queryTokens, [
			'reference',
			'references',
			'chain',
			'chains'
		]);
	const prefersEmailRootId =
		normalizeLooseText(query).includes('root message') ||
		normalizeLooseText(query).includes('thread root') ||
		queryHasAnyToken(queryTokens, ['root', 'ancestor']);
	const prefersEmailThreadAncestry =
		prefersEmailReplyParent ||
		prefersEmailReferenceChain ||
		prefersEmailRootId ||
		queryHasAnyToken(queryTokens, [
			'thread',
			'reply',
			'replies',
			'chain',
			'chains',
			'ancestor',
			'ancestors',
			'lineage'
		]);
	const prefersEmailSentTime = queryHasAnyToken(queryTokens, [
		'sent',
		'submit',
		'submitted'
	]);
	const prefersEmailReceivedTime = queryHasAnyToken(queryTokens, [
		'received',
		'delivered',
		'inbox'
	]);
	const prefersEmailCreatedTime = queryHasAnyToken(queryTokens, [
		'created',
		'creation'
	]);
	const prefersEmailModifiedTime = queryHasAnyToken(queryTokens, [
		'modified',
		'updated',
		'edited'
	]);
	const prefersInlineEmailResource = queryHasAnyToken(queryTokens, [
		'inline',
		'cid',
		'embedded',
		'embed',
		'image',
		'logo',
		'preview'
	]);
	const prefersAttachmentOrdinal = queryHasAnyToken(queryTokens, [
		'attachment',
		'attachments',
		'inline',
		'cid',
		'embedded',
		'embed',
		'image',
		'logo',
		'preview',
		'resource',
		'resources'
	]);
	const prefersDeeperQuotedHistory =
		prefersQuotedEmailEvidence &&
		queryHasAnyToken(queryTokens, [
			'deep',
			'deeper',
			'deepest',
			'older',
			'earlier'
		]);
	const mailboxStateSignals = [
		{
			active:
				emailMailboxIsUnread ||
				emailMailboxStateFlags.includes('unread'),
			queryTokens: ['unread', 'new', 'unseen'],
			score: 0.2
		},
		{
			active:
				emailMailboxIsRead || emailMailboxStateFlags.includes('read'),
			queryTokens: ['read', 'seen'],
			score: 0.18
		},
		{
			active:
				emailMailboxIsFlagged ||
				emailMailboxStateFlags.includes('flagged'),
			queryTokens: ['flagged', 'starred', 'important'],
			score: 0.2
		},
		{
			active:
				emailMailboxIsReplied ||
				emailMailboxStateFlags.includes('replied'),
			queryTokens: ['replied', 'answered'],
			score: 0.18
		},
		{
			active:
				emailMailboxIsDraft || emailMailboxStateFlags.includes('draft'),
			queryTokens: ['draft'],
			score: 0.18
		},
		{
			active:
				emailMailboxIsTrashed ||
				emailMailboxStateFlags.includes('trashed'),
			queryTokens: ['trash', 'trashed', 'deleted', 'bin'],
			score: 0.18
		},
		{
			active:
				emailMailboxIsPassed ||
				emailMailboxStateFlags.includes('passed'),
			queryTokens: ['passed', 'forwarded'],
			score: 0.18
		}
	] as const;
	const mailboxIdentitySignals = [
		{
			active:
				emailNormalizedSubject &&
				(prefersEmailNormalizedSubject ||
					queryTokens.some((token) =>
						emailNormalizedSubject.includes(token)
					)),
			score: 0.14
		},
		{
			active:
				emailSensitivity &&
				(prefersEmailSensitivity ||
					queryTokens.some((token) =>
						emailSensitivity.includes(token)
					)),
			score: 0.16
		},
		{
			active:
				emailConversationTopic &&
				queryTokens.some((token) =>
					emailConversationTopic.includes(token)
				),
			score: 0.12
		},
		{
			active:
				emailConversationId &&
				(prefersEmailConversationId ||
					queryTokens.some((token) =>
						emailConversationId.includes(token)
					)),
			score: 0.12
		},
		{
			active:
				emailConversationIndex &&
				(prefersEmailConversationIndex ||
					queryTokens.some((token) =>
						emailConversationIndex.includes(token)
					)),
			score: 0.12
		},
		{
			active:
				threadIndex &&
				(prefersEmailThreadIndex ||
					queryTokens.some((token) => threadIndex.includes(token))),
			score: 0.12
		},
		{
			active:
				inReplyTo &&
				(prefersEmailReplyParent ||
					queryTokens.some((token) => inReplyTo.includes(token))),
			score: 0.12
		},
		{
			active:
				emailReplySiblingParentMessageId &&
				(prefersEmailReplyParent ||
					queryTokens.some((token) =>
						emailReplySiblingParentMessageId.includes(token)
					)),
			score: 0.14
		},
		{
			active:
				messageId &&
				(prefersEmailMessageId ||
					queryTokens.some((token) => messageId.includes(token))),
			score: 0.12
		},
		{
			active:
				emailInternetMessageId &&
				(prefersEmailMessageId ||
					queryTokens.some((token) =>
						emailInternetMessageId.includes(token)
					)),
			score: 0.14
		},
		{
			active:
				emailMessageClass &&
				(prefersEmailMessageClass ||
					queryTokens.some((token) =>
						emailMessageClass.includes(token)
					)),
			score: 0.14
		}
	] as const;
	const mailboxTimeSignals = [
		{
			active:
				(emailSentAt || emailClientSubmitTime) && prefersEmailSentTime,
			score: 0.12
		},
		{
			active:
				(emailReceivedAt || emailDeliveryTime) &&
				prefersEmailReceivedTime,
			score: 0.12
		},
		{
			active: emailCreationTime && prefersEmailCreatedTime,
			score: 0.12
		},
		{
			active: emailLastModifiedTime && prefersEmailModifiedTime,
			score: 0.12
		}
	] as const;
	const mailboxFormatSignals = [
		{
			active:
				emailMailboxFormat === 'pst' &&
				queryHasAnyToken(queryTokens, ['outlook']),
			score: 0.08
		},
		{
			active:
				emailMailboxFormat === 'ost' &&
				queryHasAnyToken(queryTokens, ['outlook', 'offline']),
			score: 0.08
		},
		{
			active:
				emailMailboxFormat === 'emlx' &&
				queryHasAnyToken(queryTokens, ['apple', 'mail']),
			score: 0.08
		}
	] as const;
	const mailboxAncestrySignals = [
		{
			active: threadRootMessageId && prefersEmailRootId,
			score: 0.12
		},
		{
			active:
				typeof replyDepth === 'number' && prefersEmailThreadAncestry,
			score: 0.06 + scoreBoundedMagnitude(replyDepth, 0.05, 0.16)
		},
		{
			active: threadMessageIds.length > 0 && prefersEmailThreadAncestry,
			score:
				0.04 +
				scoreBoundedMagnitude(threadMessageIds.length, 0.04, 0.18)
		},
		{
			active:
				typeof replyReferenceCount === 'number' &&
				prefersEmailThreadAncestry,
			score: scoreBoundedMagnitude(replyReferenceCount, 0.04, 0.14)
		}
	] as const;

	if (emailSectionKind === 'authored_text') {
		score += 0.1;
		if (hasEmailCue) {
			score += 0.14;
		}
		if (prefersAuthoredEmailEvidence) {
			score += 0.22;
		}
		if (prefersForwardedEmailEvidence) {
			score -= 0.14;
		}
	}

	if (emailSectionKind === 'quoted_history') {
		if (hasEmailCue) {
			score += 0.06;
		}
		if (prefersQuotedEmailEvidence) {
			score += 0.24;
		}
		if (typeof emailQuotedDepth === 'number') {
			score -= Math.min(0.12, Math.max(0, emailQuotedDepth - 1) * 0.03);
			if (prefersQuotedEmailEvidence) {
				score += Math.min(0.1, emailQuotedDepth * 0.02);
			}
			if (prefersDeeperQuotedHistory) {
				score += Math.min(0.16, emailQuotedDepth * 0.05);
			}
		}
	}

	if (emailSectionKind === 'forwarded_headers') {
		if (hasEmailCue) {
			score += 0.02;
		}
		if (prefersForwardedEmailEvidence) {
			score += 0.3;
		}
		if (typeof emailForwardedOrdinal === 'number') {
			score -= Math.min(
				0.12,
				Math.max(0, emailForwardedOrdinal - 1) * 0.03
			);
		}
		if (
			prefersForwardedEmailEvidence &&
			typeof emailForwardedChainCount === 'number' &&
			emailForwardedChainCount > 1
		) {
			score += 0.08;
		}
	}

	if (
		typeof emailMessageLineageCount === 'number' &&
		emailMessageLineageCount > 0
	) {
		if (prefersAttachedEmailLineage) {
			score += 0.1 + Math.min(0.22, emailMessageLineageCount * 0.04);
		}
		if (
			prefersAuthoredEmailEvidence ||
			queryHasAnyToken(queryTokens, ['local', 'latest', 'current'])
		) {
			score -= Math.min(0.15, emailMessageLineageCount * 0.04);
		}
	}

	if (
		emailMessageSourceKind === 'attached_message' &&
		queryHasAnyToken(queryTokens, ['attachment', 'attachments', 'attached'])
	) {
		score += 0.08;
	}

	if (
		(emailMailboxContainerSource ||
			emailMailboxFamilyKey ||
			emailMailboxFolder ||
			emailMailboxFormat ||
			typeof emailMailboxMessageCount === 'number' ||
			typeof emailMailboxMessageOrdinal === 'number' ||
			emailMailboxStateFlags.length > 0 ||
			emailMailboxLeaf ||
			emailMailboxPathSegments.length > 0) &&
		(hasEmailCue || prefersMailboxLocality)
	) {
		const mailboxLocalityFamily = scoreFeatureFamilyMatches({
			candidates: [
				emailMailboxContainerSource,
				emailMailboxFamilyKey,
				emailMailboxFolder,
				emailMailboxFormat,
				emailMailboxLeaf,
				...emailMailboxPathSegments
			],
			enabled: true,
			matchBase: 0.1,
			matchCap: 0.16,
			matchWeight: 0.08,
			presenceBonus: 0.04,
			queryTokens
		});
		score += mailboxLocalityFamily.score;

		const mailboxPathFamily = scoreFeatureFamilyMatches({
			candidates: emailMailboxPathSegments,
			enabled: emailMailboxPathSegments.length > 0,
			matchBase: 0.08,
			matchCap: 0.12,
			matchWeight: 0.04,
			queryTokens
		});
		score += mailboxPathFamily.score;
		if (
			mailboxPathFamily.matchCount > 0 &&
			typeof emailMailboxPathDepth === 'number' &&
			emailMailboxPathDepth > 1
		) {
			score += Math.min(0.08, emailMailboxPathDepth * 0.01);
		}
	}

	if (emailMailboxFormat && prefersMailboxFormat) {
		if (queryTokens.includes(emailMailboxFormat)) {
			score += 0.18;
		}
		score += scoreActiveSignals(mailboxFormatSignals);
	}

	if (
		typeof emailMailboxMessageCount === 'number' &&
		emailMailboxMessageCount > 1 &&
		typeof emailMailboxMessageOrdinal === 'number' &&
		(prefersMailboxLocality || prefersMailboxMessage)
	) {
		score += scoreOrdinalPreference({
			baseScore: 0.03,
			firstScore: 0.18,
			latestScore: 0.2,
			ordinal: emailMailboxMessageOrdinal,
			prefersFirst: prefersFirstReplySibling,
			prefersLatest: prefersLatestReplySibling,
			prefersSecond: prefersSecondReplySibling,
			prefersThird: prefersThirdReplySibling,
			secondScore: 0.18,
			thirdScore: 0.18,
			total: emailMailboxMessageCount
		});
	}

	if (
		(emailMailboxStateFlags.length > 0 ||
			emailMailboxIsDraft ||
			emailMailboxIsFlagged ||
			emailMailboxIsPassed ||
			emailMailboxIsRead ||
			emailMailboxIsReplied ||
			emailMailboxIsTrashed ||
			emailMailboxIsUnread) &&
		(hasEmailCue || prefersMailboxLocality || prefersMailboxState)
	) {
		score += 0.03;
		score += scoreActiveSignals(
			mailboxStateSignals.map((signal) => ({
				active:
					signal.active &&
					queryHasAnyToken(queryTokens, signal.queryTokens),
				score: signal.score
			}))
		);
	}

	if (
		(emailCategories.length > 0 ||
			emailImportance ||
			emailNormalizedSubject ||
			emailSensitivity ||
			emailSentAt ||
			emailReceivedAt ||
			emailClientSubmitTime ||
			emailDeliveryTime ||
			emailCreationTime ||
			emailLastModifiedTime ||
			emailConversationTopic ||
			emailConversationId ||
			emailConversationIndex ||
			inReplyTo ||
			messageId ||
			references ||
			emailReplySiblingParentMessageId ||
			threadIndex ||
			emailMessageClass) &&
		(hasEmailCue || prefersMailboxLocality)
	) {
		const mailboxDescriptorFamily = scoreFeatureFamilyMatches({
			candidates: [...emailCategories, emailImportance, emailSensitivity],
			enabled:
				emailCategories.length > 0 ||
				typeof emailImportance === 'string' ||
				typeof emailSensitivity === 'string',
			matchBase: 0.04,
			matchCap: 0.18,
			matchWeight: 0.04,
			presenceBonus: 0.03,
			queryTokens
		});
		score += mailboxDescriptorFamily.score;
		const mailboxIdentityFamily = scoreFeatureFamilyMatches({
			candidates: [
				emailNormalizedSubject,
				emailConversationTopic,
				emailConversationId,
				emailConversationIndex,
				threadIndex,
				inReplyTo,
				references,
				emailReplySiblingParentMessageId,
				messageId,
				emailInternetMessageId,
				emailMessageClass
			],
			enabled: true,
			matchBase: 0.04,
			matchCap: 0.18,
			matchWeight: 0.04,
			presenceBonus: 0.03,
			queryTokens
		});
		score += mailboxIdentityFamily.score;
		const mailboxAncestryFamily = scoreFeatureFamilyMatches({
			candidates: [
				threadRootMessageId,
				...threadMessageIds,
				inReplyTo,
				references,
				emailReplySiblingParentMessageId
			],
			enabled: prefersEmailThreadAncestry,
			matchBase: 0.04,
			matchCap: 0.18,
			matchWeight: 0.04,
			presenceBonus: 0.03,
			queryTokens
		});
		score += mailboxAncestryFamily.score;
		if (
			references &&
			(prefersEmailReferenceChain ||
				queryTokens.some((token) => references.includes(token)))
		) {
			score += 0.12;
		}
		score += scoreActiveSignals(mailboxIdentitySignals);
		score += scoreActiveSignals(mailboxAncestrySignals);
		score += scoreActiveSignals(mailboxTimeSignals);
	}

	if (
		typeof attachmentIndex === 'number' &&
		(prefersAttachmentOrdinal || prefersInlineEmailResource)
	) {
		const attachmentOrdinal = attachmentIndex + 1;
		score += scoreOrdinalPreference({
			baseScore: 0.02,
			firstScore: 0.18,
			latestScore: 0.2,
			ordinal: attachmentOrdinal,
			prefersFirst: prefersFirstReplySibling,
			prefersLatest: prefersLatestReplySibling,
			prefersSecond: prefersSecondReplySibling,
			prefersThird: prefersThirdReplySibling,
			secondScore: 0.18,
			thirdScore: 0.18,
			total: attachmentCount
		});
	}

	if (
		(emailAttachmentSource ||
			emailMailboxContainerSource ||
			emailMailboxFamilyKey ||
			emailMailboxFolder ||
			emailMailboxLeaf ||
			emailMailboxPathSegments.length > 0 ||
			emailMessageSource ||
			emailMessageLineageAttachmentSources.length > 0) &&
		queryHasAnyToken(queryTokens, [
			'attachment',
			'attachments',
			'attached',
			'nested',
			'branch',
			'chain',
			'forwarded',
			'mailbox',
			'folder'
		])
	) {
		const lineageSources = [
			...(emailMailboxContainerSource
				? [emailMailboxContainerSource]
				: []),
			...(emailMailboxFamilyKey ? [emailMailboxFamilyKey] : []),
			...(emailMailboxFolder ? [emailMailboxFolder] : []),
			...(emailMailboxLeaf ? [emailMailboxLeaf] : []),
			...emailMailboxPathSegments,
			...(emailAttachmentSource ? [emailAttachmentSource] : []),
			...(emailMessageSource ? [emailMessageSource] : []),
			...emailMessageLineageAttachmentSources
		];
		const lineageMatchCount = countDistinctTokenMatches(
			queryTokens,
			lineageSources
		);
		if (lineageMatchCount > 0) {
			score += 0.1 + Math.min(lineageMatchCount * 0.03, 0.18);
		}
	}

	if (
		typeof emailReplySiblingCount === 'number' &&
		emailReplySiblingCount > 1 &&
		typeof emailReplySiblingOrdinal === 'number' &&
		prefersReplySibling
	) {
		score += scoreOrdinalPreference({
			baseScore: 0.04,
			firstScore: 0.2,
			latestScore: 0.22,
			ordinal: emailReplySiblingOrdinal,
			prefersFirst: prefersFirstReplySibling,
			prefersLatest: prefersLatestReplySibling,
			prefersSecond: prefersSecondReplySibling,
			prefersThird: prefersThirdReplySibling,
			secondScore: 0.2,
			thirdScore: 0.2,
			total: emailReplySiblingCount
		});
	}

	if (
		(archiveFullPath || archivePath) &&
		(queryHasAnyToken(queryTokens, [
			'archive',
			'archives',
			'entry',
			'entries',
			'bundle',
			'zip'
		]) ||
			queryTokens.some((token) =>
				(archiveFullPath ?? archivePath ?? '').includes(token)
			))
	) {
		score += 0.34;
	}

	if (
		archiveContainerPath &&
		queryHasAnyToken(queryTokens, [
			'nested',
			'inner',
			'container',
			'archive'
		])
	) {
		score += 0.12;
	}

	if (
		typeof archiveNestedDepth === 'number' &&
		archiveNestedDepth > 1 &&
		queryHasAnyToken(queryTokens, ['nested', 'inner', 'archive'])
	) {
		score += 0.08;
	}

	if (
		isOCREvidence &&
		queryHasAnyToken(queryTokens, [
			'ocr',
			'scan',
			'scanned',
			'image',
			'photo',
			'region',
			'regions',
			'page',
			'pages'
		])
	) {
		if (typeof ocrConfidence === 'number' && ocrConfidence >= 0.9) {
			score += 0.12;
		} else if (typeof ocrConfidence === 'number' && ocrConfidence >= 0.75) {
			score += 0.05;
		} else if (typeof ocrConfidence === 'number' && ocrConfidence < 0.55) {
			score -= 0.05;
		}
	}

	return score;
};

const scoreMultivectorEvidenceMatch = (
	query: string,
	queryTokens: string[],
	result: RAGQueryResult
) => {
	const metadata = result.metadata ?? {};
	const matchedVariantCount =
		typeof metadata.multivectorMatchedVariantCount === 'number'
			? metadata.multivectorMatchedVariantCount
			: 0;
	const matchedVariantLabel = metadataString(
		metadata.multivectorMatchedVariantLabel
	);
	const matchedVariantText = metadataString(
		metadata.multivectorMatchedVariantText
	);
	if (
		matchedVariantCount === 0 &&
		!matchedVariantLabel &&
		!matchedVariantText
	) {
		return 0;
	}

	let score = 0;
	const exactPhraseIntent = queryHasAnyToken(queryTokens, [
		'phrase',
		'phrasing',
		'wording',
		'verbatim',
		'quote',
		'quoted',
		'precise',
		'exact'
	]);

	if (matchedVariantCount > 0) {
		score += Math.min(0.18, matchedVariantCount * 0.06);
	}

	if (matchedVariantLabel) {
		score += 0.18 * scoreLoosePhraseMatch(query, matchedVariantLabel);
		if (
			exactPhraseIntent &&
			queryTokens.some((token) => matchedVariantLabel.includes(token))
		) {
			score += 0.08;
		}
	}

	if (matchedVariantText) {
		const phraseScore = scoreLoosePhraseMatch(query, matchedVariantText);
		score += exactPhraseIntent ? 1.1 * phraseScore : 0.6 * phraseScore;
		if (queryHasQuotedPhraseMatch(query, matchedVariantText)) {
			score += 0.45;
		}
	}

	return score;
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
	const structuredEvidenceBoost = scoreStructuredEvidenceMatch(
		query,
		queryTokens,
		result
	);
	const multivectorEvidenceBoost = scoreMultivectorEvidenceMatch(
		query,
		queryTokens,
		result
	);

	return (
		result.score +
		overlapBoost +
		exactPhraseBoost +
		sourcePathBoost +
		metadataBoost +
		structuredEvidenceBoost +
		multivectorEvidenceBoost
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
