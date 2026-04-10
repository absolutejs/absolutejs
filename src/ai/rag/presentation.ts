import type {
	AIMessage,
	RAGAnswerWorkflowState,
	RAGCitation,
	RAGCitationReferenceMap,
	RAGGroundedAnswer,
	RAGGroundedAnswerCitationDetail,
	RAGGroundingReference,
	RAGSourceSummary,
	RAGStreamStage,
	RAGSource,
	RAGSourceGroup
} from '../../../types/ai';

const buildSourceGroupKey = (source: RAGSource) =>
	source.source ?? source.title ?? source.chunkId;

const buildSourceLabel = (source: RAGSource) =>
	source.source ?? source.title ?? source.chunkId;

const getContextNumber = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getContextString = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;

const formatTimestampLabel = (value: unknown) => {
	const timestamp =
		typeof value === 'number' && Number.isFinite(value)
			? value
			: typeof value === 'string'
				? Date.parse(value)
				: Number.NaN;
	if (!Number.isFinite(timestamp)) {
		return undefined;
	}

	return new Date(timestamp).toLocaleString('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
};

const formatMediaTimestamp = (value: unknown) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	const totalSeconds = Math.floor(value / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const milliseconds = Math.floor(value % 1000);

	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
		2,
		'0'
	)}.${String(milliseconds).padStart(3, '0')}`;
};

const getAttachmentName = (source?: string, title?: string) => {
	const sourceAttachment = source?.split('/').at(-1);
	if (sourceAttachment && sourceAttachment.includes('.')) {
		return sourceAttachment;
	}

	const titleAttachment = title?.split(' · ').at(-1);
	if (titleAttachment && titleAttachment.includes('.')) {
		return titleAttachment;
	}

	return undefined;
};

const buildContextLabel = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const emailKind = getContextString(metadata.emailKind);
	if (emailKind === 'attachment') {
		return 'Attachment evidence';
	}

	if (emailKind === 'message') {
		const from = getContextString(metadata.from);
		return from ? `Message from ${from}` : 'Message evidence';
	}

	const page =
		getContextNumber(metadata.page) ??
		getContextNumber(metadata.pageNumber) ??
		(typeof metadata.pageIndex === 'number'
			? metadata.pageIndex + 1
			: undefined);
	if (page) {
		return `Page ${page}`;
	}

	const sheet =
		getContextString(metadata.sheetName) ??
		(Array.isArray(metadata.sheetNames)
			? getContextString(metadata.sheetNames[0])
			: undefined);
	if (sheet) {
		return `Sheet ${sheet}`;
	}

	const slide =
		getContextNumber(metadata.slide) ??
		getContextNumber(metadata.slideNumber) ??
		(typeof metadata.slideIndex === 'number'
			? metadata.slideIndex + 1
			: undefined);
	if (slide) {
		return `Slide ${slide}`;
	}

	const archiveEntry =
		getContextString(metadata.archiveEntryPath) ??
		getContextString(metadata.entryPath);
	if (archiveEntry) {
		return `Archive entry ${archiveEntry}`;
	}

	const threadTopic = getContextString(metadata.threadTopic);
	if (threadTopic) {
		return `Thread ${threadTopic}`;
	}

	const speaker = getContextString(metadata.speaker);
	if (speaker) {
		return `Speaker ${speaker}`;
	}

	return undefined;
};

const buildLocatorLabel = (
	metadata?: Record<string, unknown>,
	source?: string,
	title?: string
) => {
	if (!metadata) {
		return undefined;
	}

	const page =
		getContextNumber(metadata.page) ??
		getContextNumber(metadata.pageNumber) ??
		(typeof metadata.pageIndex === 'number'
			? metadata.pageIndex + 1
			: undefined);
	if (page) {
		return `Page ${page}`;
	}

	const sheet =
		getContextString(metadata.sheetName) ??
		(Array.isArray(metadata.sheetNames)
			? getContextString(metadata.sheetNames[0])
			: undefined);
	if (sheet) {
		return `Sheet ${sheet}`;
	}

	const slide =
		getContextNumber(metadata.slide) ??
		getContextNumber(metadata.slideNumber) ??
		(typeof metadata.slideIndex === 'number'
			? metadata.slideIndex + 1
			: undefined);
	if (slide) {
		return `Slide ${slide}`;
	}

	const archiveEntry =
		getContextString(metadata.archiveEntryPath) ??
		getContextString(metadata.entryPath);
	if (archiveEntry) {
		return `Archive entry ${archiveEntry}`;
	}

	const emailKind = getContextString(metadata.emailKind);
	if (emailKind === 'attachment') {
		const attachmentName =
			getContextString(metadata.attachmentName) ??
			getAttachmentName(source, title);
		return attachmentName ? `Attachment ${attachmentName}` : 'Attachment';
	}

	const mediaStart = formatMediaTimestamp(metadata.startMs);
	const mediaEnd = formatMediaTimestamp(metadata.endMs);
	if (mediaStart && mediaEnd) {
		return `Timestamp ${mediaStart} - ${mediaEnd}`;
	}

	if (mediaStart) {
		return `Timestamp ${mediaStart}`;
	}

	return undefined;
};

const buildProvenanceLabel = (metadata?: Record<string, unknown>) => {
	if (!metadata) {
		return undefined;
	}

	const threadTopic = getContextString(metadata.threadTopic);
	const from = getContextString(metadata.from);
	const sentAt =
		formatTimestampLabel(metadata.sentAt) ??
		formatTimestampLabel(metadata.receivedAt);
	const speaker = getContextString(metadata.speaker);
	const mediaKind = getContextString(metadata.mediaKind);
	const transcriptSource = getContextString(metadata.transcriptSource);
	const pdfTextMode = getContextString(metadata.pdfTextMode);
	const ocrEngine = getContextString(metadata.ocrEngine);

	const labels = [
		pdfTextMode ? `PDF ${pdfTextMode}` : '',
		ocrEngine ? `OCR ${ocrEngine}` : '',
		mediaKind ? `Media ${mediaKind}` : '',
		transcriptSource ? `Transcript ${transcriptSource}` : '',
		threadTopic ? `Thread ${threadTopic}` : '',
		speaker ? `Speaker ${speaker}` : '',
		from ? `Sender ${from}` : '',
		sentAt ? `Sent ${sentAt}` : ''
	].filter((value) => value.length > 0);

	return labels.length > 0 ? labels.join(' · ') : undefined;
};

export const buildRAGCitationReferenceMap = (
	citations: RAGCitation[]
): RAGCitationReferenceMap =>
	Object.fromEntries(
		citations.map((citation, index) => [citation.chunkId, index + 1])
	);
export const buildRAGCitations = (sources: RAGSource[]) => {
	const unique = new Map<string, RAGCitation>();

	for (const source of sources) {
		const key = source.chunkId;
		const existing = unique.get(key);
		const hasBetterExisting =
			existing !== undefined && existing.score >= source.score;
		if (hasBetterExisting) continue;

		unique.set(key, {
			chunkId: source.chunkId,
			contextLabel: buildContextLabel(source.metadata),
			key,
			label: buildSourceLabel(source),
			locatorLabel: buildLocatorLabel(
				source.metadata,
				source.source,
				source.title
			),
			metadata: source.metadata,
			provenanceLabel: buildProvenanceLabel(source.metadata),
			score: source.score,
			source: source.source,
			text: source.text,
			title: source.title
		});
	}

	return [...unique.values()].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.label.localeCompare(right.label);
	});
};

const buildExcerpt = (text: string, maxLength = 160) => {
	const normalized = text.replaceAll(/\s+/g, ' ').trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const buildGroundingReferenceEvidenceLabel = (
	reference: RAGGroundingReference
) =>
	[reference.label, reference.locatorLabel, reference.contextLabel]
		.filter((value): value is string => Boolean(value && value.length > 0))
		.filter(
			(value, index, values) =>
				values.findIndex((entry) => entry === value) === index
		)
		.join(' · ');

const buildGroundingReferenceEvidenceSummary = (
	reference: RAGGroundingReference
) =>
	[
		reference.source ?? reference.title ?? reference.chunkId,
		reference.provenanceLabel
	]
		.filter((value): value is string => Boolean(value && value.length > 0))
		.join(' · ');

const buildGroundedAnswerCitationDetail = (
	reference: RAGGroundingReference
): RAGGroundedAnswerCitationDetail => ({
	contextLabel: reference.contextLabel,
	evidenceLabel: buildGroundingReferenceEvidenceLabel(reference),
	evidenceSummary: buildGroundingReferenceEvidenceSummary(reference),
	excerpt: reference.excerpt,
	label: reference.label,
	locatorLabel: reference.locatorLabel,
	number: reference.number,
	provenanceLabel: reference.provenanceLabel,
	source: reference.source,
	title: reference.title
});

export const buildRAGGroundedAnswer = (
	content: string,
	sources: RAGSource[]
): RAGGroundedAnswer => {
	const references = buildRAGGroundingReferences(sources);
	const referenceMap = new Map(
		references.map((reference) => [reference.number, reference])
	);
	const parts: RAGGroundedAnswer['parts'] = [];
	const ungroundedReferenceNumbers = new Set<number>();
	const citationPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
	let cursor = 0;

	for (const match of content.matchAll(citationPattern)) {
		const raw = match[0];
		const numbers = (match[1] ?? '')
			.split(',')
			.map((value) => Number.parseInt(value.trim(), 10))
			.filter((value) => Number.isInteger(value) && value > 0);
		const start = match.index ?? cursor;
		if (start > cursor) {
			parts.push({
				text: content.slice(cursor, start),
				type: 'text'
			});
		}

		const resolvedReferences = numbers
			.map((number) => referenceMap.get(number))
			.filter((reference): reference is RAGGroundingReference =>
				Boolean(reference)
			);
		for (const number of numbers) {
			if (!referenceMap.has(number)) {
				ungroundedReferenceNumbers.add(number);
			}
		}
		const unresolvedNumbers = numbers.filter(
			(number) => !referenceMap.has(number)
		);

		parts.push({
			referenceNumbers: numbers,
			referenceDetails: resolvedReferences.map(
				buildGroundedAnswerCitationDetail
			),
			references: resolvedReferences,
			text: raw,
			type: 'citation',
			unresolvedReferenceNumbers: unresolvedNumbers
		});
		cursor = start + raw.length;
	}

	if (cursor < content.length || parts.length === 0) {
		parts.push({
			text: content.slice(cursor),
			type: 'text'
		});
	}

	const hasCitations = parts.some((part) => part.type === 'citation');
	const coverage: RAGGroundedAnswer['coverage'] = !hasCitations
		? 'ungrounded'
		: ungroundedReferenceNumbers.size === 0
			? 'grounded'
			: references.length > 0
				? 'partial'
				: 'ungrounded';

	return {
		content,
		coverage,
		hasCitations,
		parts,
		references,
		ungroundedReferenceNumbers: [...ungroundedReferenceNumbers].sort(
			(left, right) => left - right
		)
	};
};
export const buildRAGGroundingReferences = (sources: RAGSource[]) => {
	const citations = buildRAGCitations(sources);
	const citationReferenceMap = buildRAGCitationReferenceMap(citations);

	return citations.map<RAGGroundingReference>((citation) => ({
		chunkId: citation.chunkId,
		contextLabel: buildContextLabel(citation.metadata),
		excerpt: buildExcerpt(citation.text),
		label: citation.label,
		locatorLabel:
			citation.locatorLabel ??
			buildLocatorLabel(
				citation.metadata,
				citation.source,
				citation.title
			),
		metadata: citation.metadata,
		number: citationReferenceMap[citation.chunkId] ?? 0,
		provenanceLabel:
			citation.provenanceLabel ?? buildProvenanceLabel(citation.metadata),
		score: citation.score,
		source: citation.source,
		text: citation.text,
		title: citation.title
	}));
};
export const buildRAGRetrievedState = (messages: AIMessage[]) => {
	const message = getLatestRetrievedMessage(messages);

	if (!message) {
		return null;
	}

	const sources = message.sources ?? [];
	const groundedAnswer = buildRAGGroundedAnswer(message.content, sources);

	return {
		citationReferenceMap: buildRAGCitationReferenceMap(
			buildRAGCitations(sources)
		),
		citations: buildRAGCitations(sources),
		conversationId: message.conversationId,
		groundedAnswer,
		messageId: message.id,
		retrievalDurationMs: message.retrievalDurationMs,
		retrievalStartedAt: message.retrievalStartedAt,
		retrievedAt: message.retrievedAt,
		sourceGroups: buildRAGSourceGroups(sources),
		sourceSummaries: buildRAGSourceSummaries(sources),
		sources
	};
};
export const buildRAGSourceSummaries = (sources: RAGSource[]) => {
	const sourceGroups = buildRAGSourceGroups(sources);
	const citations = buildRAGCitations(sources);
	const citationReferenceMap = buildRAGCitationReferenceMap(citations);

	return sourceGroups.map<RAGSourceSummary>((group) => {
		const groupCitations = citations.filter((citation) =>
			group.chunks.some((chunk) => chunk.chunkId === citation.chunkId)
		);
		const leadChunk = group.chunks
			.slice()
			.sort((left, right) => right.score - left.score)[0];

		return {
			bestScore: group.bestScore,
			citationNumbers: groupCitations.map(
				(citation) => citationReferenceMap[citation.chunkId] ?? 0
			),
			citations: groupCitations,
			chunkIds: group.chunks.map((chunk) => chunk.chunkId),
			contextLabel: buildContextLabel(leadChunk?.metadata),
			count: group.count,
			excerpt: buildExcerpt(leadChunk?.text ?? ''),
			key: group.key,
			label: group.label,
			locatorLabel: buildLocatorLabel(
				leadChunk?.metadata,
				leadChunk?.source,
				leadChunk?.title
			),
			provenanceLabel: buildProvenanceLabel(leadChunk?.metadata),
			source: group.source,
			title: group.title
		};
	});
};

export type RAGStreamProgress = {
	stage: RAGStreamStage;
	conversationId?: string;
	messageId?: string;
	retrievalStartedAt?: number;
	retrievedAt?: number;
	retrievalDurationMs?: number;
	hasContent: boolean;
	hasRetrieved: boolean;
	hasSources: boolean;
	hasThinking: boolean;
	hasToolCalls: boolean;
	isComplete: boolean;
	isError: boolean;
	isIdle: boolean;
	isRetrieving: boolean;
	isRetrieved: boolean;
	isStreaming: boolean;
	isSubmitting: boolean;
	sourceCount: number;
	latestMessage: AIMessage | undefined;
};

const buildStreamProgressState = (messages: AIMessage[]) => {
	const latestMessage = getLatestAssistantMessage(messages);
	const retrieved = latestMessage
		? buildRAGRetrievedState(messages)
		: undefined;

	return {
		conversationId: latestMessage?.conversationId,
		latestMessage,
		messageId: latestMessage?.id,
		retrieved,
		sourceCount:
			retrieved?.sources.length ?? latestMessage?.sources?.length ?? 0
	};
};

export const buildRAGStreamProgress = ({
	error,
	isStreaming,
	messages
}: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}): RAGStreamProgress => {
	const stage = resolveRAGStreamStage({
		error,
		isStreaming,
		messages
	});
	const state = buildStreamProgressState(messages);
	const hasSources = state.sourceCount > 0;
	const hasRetrieved =
		stage === 'retrieved' ||
		state.retrieved !== undefined ||
		state.latestMessage?.retrievedAt !== undefined;
	const hasThinking =
		typeof state.latestMessage?.thinking === 'string' &&
		state.latestMessage.thinking.length > 0;
	const hasToolCalls = (state.latestMessage?.toolCalls?.length ?? 0) > 0;

	return {
		conversationId: state.conversationId,
		hasContent:
			typeof state.latestMessage?.content === 'string' &&
			state.latestMessage.content.length > 0,
		hasRetrieved,
		hasSources,
		hasThinking,
		hasToolCalls,
		isComplete: stage === 'complete',
		isError: stage === 'error',
		isIdle: stage === 'idle',
		isRetrieved: stage === 'retrieved',
		isRetrieving: stage === 'submitting' || stage === 'retrieving',
		isStreaming: stage === 'streaming',
		isSubmitting: stage === 'submitting',
		latestMessage: state.latestMessage,
		messageId: state.messageId,
		retrievalDurationMs: state.retrieved?.retrievalDurationMs,
		retrievalStartedAt: state.retrieved?.retrievalStartedAt,
		retrievedAt: state.retrieved?.retrievedAt,
		sourceCount: state.sourceCount,
		stage
	};
};

export type RAGStreamProgressState = ReturnType<typeof buildRAGStreamProgress>;
export const buildRAGAnswerWorkflowState = ({
	error,
	isStreaming,
	messages
}: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}): RAGAnswerWorkflowState => {
	const latestAssistantMessage = getLatestAssistantMessage(messages);
	const sources = getLatestRAGSources(messages);
	const sourceGroups = buildRAGSourceGroups(sources);
	const citations = buildRAGCitations(sources);
	const citationReferenceMap = buildRAGCitationReferenceMap(citations);
	const sourceSummaries = buildRAGSourceSummaries(sources);
	const groundingReferences = buildRAGGroundingReferences(sources);
	const groundedAnswer = buildRAGGroundedAnswer(
		latestAssistantMessage?.content ?? '',
		sources
	);
	const retrieval = buildRAGRetrievedState(messages);
	const progress = buildRAGStreamProgress({
		error,
		isStreaming,
		messages
	});

	return {
		citationReferenceMap,
		citations,
		coverage: groundedAnswer.coverage,
		error,
		groundedAnswer,
		groundingReferences,
		hasCitations: groundedAnswer.hasCitations,
		hasGrounding: groundingReferences.length > 0,
		hasRetrieved: progress.hasRetrieved,
		hasSources: sources.length > 0,
		isAnswerStreaming: progress.isStreaming,
		isComplete: progress.isComplete,
		isError: progress.isError,
		isIdle: progress.isIdle,
		isRetrieved: progress.isRetrieved,
		isRetrieving: progress.isRetrieving,
		isRunning:
			progress.isSubmitting ||
			progress.isRetrieving ||
			progress.isStreaming,
		isSubmitting: progress.isSubmitting,
		latestAssistantMessage,
		messages,
		retrieval,
		retrievalDurationMs: retrieval?.retrievalDurationMs,
		retrievalStartedAt: retrieval?.retrievalStartedAt,
		retrievedAt: retrieval?.retrievedAt,
		sourceGroups,
		sourceSummaries,
		sources,
		stage: progress.stage,
		ungroundedReferenceNumbers: groundedAnswer.ungroundedReferenceNumbers
	};
};

export const buildRAGSourceGroups = (sources: RAGSource[]) => {
	const groups = new Map<string, RAGSourceGroup>();

	for (const source of sources) {
		updateSourceGroup(groups, source);
	}

	return [...groups.values()].sort((left, right) => {
		if (right.bestScore !== left.bestScore) {
			return right.bestScore - left.bestScore;
		}

		return left.label.localeCompare(right.label);
	});
};

const buildSourceGroup = (source: RAGSource, key: string): RAGSourceGroup => ({
	bestScore: source.score,
	chunks: [source],
	count: 1,
	key,
	label: buildSourceLabel(source),
	source: source.source,
	title: source.title
});

const updateSourceGroup = (
	groups: Map<string, RAGSourceGroup>,
	source: RAGSource
) => {
	const key = buildSourceGroupKey(source);
	const existing = groups.get(key);
	if (!existing) {
		groups.set(key, buildSourceGroup(source, key));

		return;
	}

	existing.bestScore = Math.max(existing.bestScore, source.score);
	existing.count += 1;
	existing.chunks.push(source);
};
export const getLatestAssistantMessage = (messages: AIMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === 'assistant') {
			return message;
		}
	}

	return undefined;
};
export const getLatestRAGSources = (messages: AIMessage[]) =>
	getLatestAssistantMessage(messages)?.sources ?? [];
export const getLatestRetrievedMessage = (messages: AIMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === 'assistant' &&
			(typeof message.retrievedAt === 'number' ||
				(message.sources?.length ?? 0) > 0)
		) {
			return message;
		}
	}

	return undefined;
};
export const resolveRAGStreamStage = ({
	error,
	isStreaming,
	messages
}: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}) => {
	if (error) {
		return 'error';
	}

	const assistantMessage = getLatestAssistantMessage(messages);
	if (!assistantMessage) {
		return isStreaming ? 'submitting' : 'idle';
	}

	const isRetrieving =
		typeof assistantMessage.retrievalStartedAt === 'number' &&
		typeof assistantMessage.retrievedAt !== 'number';

	if (isRetrieving) {
		return 'retrieving';
	}

	if (!isStreaming) {
		return 'complete';
	}

	const hasRetrieved = typeof assistantMessage.retrievedAt === 'number';
	const hasContent =
		assistantMessage.content.trim().length > 0 ||
		assistantMessage.thinking?.trim().length ||
		(assistantMessage.toolCalls?.length ?? 0) > 0 ||
		(assistantMessage.images?.length ?? 0) > 0;

	if (hasRetrieved && !hasContent) {
		return 'retrieved';
	}

	return 'streaming';
};
