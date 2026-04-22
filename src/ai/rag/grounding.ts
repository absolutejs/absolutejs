import type {
	RAGCitation,
	RAGCitationReferenceMap,
	RAGExcerptModeCounts,
	RAGGroundedAnswer,
	RAGGroundedAnswerCitationDetail,
	RAGGroundedAnswerSectionSummary,
	RAGGroundingReference,
	RAGSource
} from '../../../types/ai';

const getContextString = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;

const getContextNumber = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

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
	const officeBlockKindValue = getContextString(metadata.officeBlockKind);
	const officeBlockKind =
		officeBlockKindValue === 'table' ||
		officeBlockKindValue === 'list' ||
		officeBlockKindValue === 'paragraph'
			? officeBlockKindValue
			: undefined;
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
	const region =
		getContextNumber(metadata.regionNumber) ??
		(typeof metadata.regionIndex === 'number'
			? metadata.regionIndex + 1
			: undefined);
	if (page && region) {
		return `Page ${page} region ${region}`;
	}
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

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const sectionTitle =
		getContextString(metadata.sectionTitle) ?? sectionPath.at(-1);
	const officeSectionLabel =
		sectionPath.length > 0 ? sectionPath.join(' > ') : sectionTitle;
	if (officeBlockKind === 'table' && officeSectionLabel) {
		return `Office table block ${officeSectionLabel}`;
	}
	if (officeBlockKind === 'list' && officeSectionLabel) {
		return `Office list block ${officeSectionLabel}`;
	}
	if (officeBlockKind === 'paragraph' && officeSectionLabel) {
		return `Office paragraph block ${officeSectionLabel}`;
	}
	if (sectionTitle) {
		return `Section ${sectionTitle}`;
	}

	return undefined;
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

const formatMediaDurationLabel = (value: unknown) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	return formatMediaTimestamp(value);
};

const formatOfficeListLevelsLabel = (value: unknown) => {
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}

	const levels = value
		.map((entry) => getContextNumber(entry))
		.filter((entry): entry is number => typeof entry === 'number')
		.sort((left, right) => left - right);

	if (levels.length === 0) {
		return undefined;
	}

	const minLevel = levels[0];
	const maxLevel = levels[levels.length - 1];

	return minLevel === maxLevel
		? `Office list level ${minLevel}`
		: `Office list levels ${minLevel}-${maxLevel}`;
};

type OfficeCitationScope = {
	blockKind: 'list' | 'paragraph' | 'table';
	familyPath: string[];
	hasContext: boolean;
	ordinalPath: number[];
	pathDepth: number;
	sectionFamilyKey: string;
	sectionOrdinal: number;
	sectionTitle: string;
};

type GenericStructuredCitationScope = {
	familyPath: string[];
	kind: 'presentation_slide' | 'spreadsheet_rows';
	ordinalPath: number[];
	pathDepth: number;
	sectionFamilyKey: string;
	sectionOrdinal: number;
};

const getOfficeTableCitationScope = (
	metadata?: Record<string, unknown>
): OfficeCitationScope | undefined => {
	if (!metadata) {
		return undefined;
	}

	const officeBlockKindValue = getContextString(metadata.officeBlockKind);
	const officeBlockKind =
		officeBlockKindValue === 'table' ||
		officeBlockKindValue === 'list' ||
		officeBlockKindValue === 'paragraph'
			? officeBlockKindValue
			: undefined;
	if (
		officeBlockKind !== 'table' &&
		officeBlockKind !== 'list' &&
		officeBlockKind !== 'paragraph'
	) {
		return undefined;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const sectionTitle =
		getContextString(metadata.sectionTitle) ?? sectionPath.at(-1);
	const officeContextText =
		officeBlockKind === 'table'
			? getContextString(metadata.officeTableContextText)
			: officeBlockKind === 'list'
				? getContextString(metadata.officeListContextText)
				: undefined;

	if (!sectionTitle) {
		return undefined;
	}

	return {
		blockKind: officeBlockKind,
		familyPath:
			Array.isArray(metadata.officeFamilyPath) &&
			metadata.officeFamilyPath.length > 0
				? metadata.officeFamilyPath
						.map((value) => getContextString(value))
						.filter((value): value is string => typeof value === 'string')
				: sectionPath.map((value) =>
						value.replace(/\s+\((\d+)\)$/, '').trim()
					),
		pathDepth: sectionPath.length,
		ordinalPath:
			Array.isArray(metadata.officeOrdinalPath) &&
			metadata.officeOrdinalPath.length > 0
				? metadata.officeOrdinalPath
						.map((value) =>
							typeof value === 'number' && Number.isFinite(value)
								? value
								: undefined
						)
						.filter((value): value is number => typeof value === 'number')
				: sectionPath.map((value) => {
						const match = value.match(/\((\d+)\)$/);
						return match ? Number.parseInt(match[1] ?? '1', 10) : 1;
					}),
		sectionFamilyKey:
			getContextString(metadata.officeSiblingFamilyKey) ??
			sectionPath.at(-1)?.replace(/\s+\((\d+)\)$/, '').trim() ??
			sectionTitle,
		sectionOrdinal:
			getContextNumber(metadata.officeSiblingOrdinal) ??
			(() => {
				const match = sectionTitle.match(/\((\d+)\)$/);
				return match ? Number.parseInt(match[1] ?? '1', 10) : 1;
			})(),
		sectionTitle,
		hasContext: typeof officeContextText === 'string'
	};
};

const areOfficeCitationScopesComparable = (
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
		  }
		| undefined
) => {
	if (!left || !right) {
		return false;
	}
	if (
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

const getGenericStructuredCitationScope = (
	metadata?: Record<string, unknown>
): GenericStructuredCitationScope | undefined => {
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

	const explicitFamilyPath = Array.isArray(metadata.sectionFamilyPath)
		? metadata.sectionFamilyPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const explicitOrdinalPath = Array.isArray(metadata.sectionOrdinalPath)
		? metadata.sectionOrdinalPath
				.map((value) => getContextNumber(value))
				.filter((value): value is number => typeof value === 'number')
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
			const sheetName = getContextString(metadata.sheetName) ?? 'Sheet';
			const tableIndex = getContextNumber(metadata.spreadsheetTableIndex) ?? 1;
			familyPath = [sheetName, 'Spreadsheet Table'];
			ordinalPath = [1, tableIndex];
		} else {
			const slideFamily = getContextString(metadata.slideTitle) ?? 'Slide';
			const slideOrdinal =
				getContextNumber(metadata.slideNumber) ??
				(typeof metadata.slideIndex === 'number' ? metadata.slideIndex + 1 : 1);
			familyPath = [slideFamily];
			ordinalPath = [slideOrdinal];
		}
	}

	const sectionFamilyKey =
		getContextString(metadata.sectionSiblingFamilyKey) ?? familyPath.at(-1);
	const sectionOrdinal =
		getContextNumber(metadata.sectionSiblingOrdinal) ?? ordinalPath.at(-1);
	if (!sectionFamilyKey || typeof sectionOrdinal !== 'number') {
		return undefined;
	}

	return {
		familyPath,
		kind,
		ordinalPath,
		pathDepth: familyPath.length,
		sectionFamilyKey,
		sectionOrdinal
	};
};

const areGenericStructuredCitationScopesComparable = (
	left: GenericStructuredCitationScope | undefined,
	right: GenericStructuredCitationScope | undefined
) => {
	if (!left || !right) {
		return false;
	}
	if (
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

const getOfficeTableCitationPreference = (
	metadata?: Record<string, unknown>
) => {
	const scope = getOfficeTableCitationScope(metadata);
	if (!scope) {
		return 0;
	}

	return (
		scope.pathDepth * 10 +
		(scope.hasContext ? 1 : 0) +
		(scope.blockKind === 'list' &&
		typeof metadata?.officeListGroupItemCount === 'number' &&
		metadata.officeListGroupItemCount > 1
			? 1
			: 0)
	);
};

const getGenericStructuredCitationPreference = (
	metadata?: Record<string, unknown>
) => {
	const scope = getGenericStructuredCitationScope(metadata);
	if (!scope) {
		return 0;
	}

	return (
		scope.pathDepth * 10 +
		(scope.kind === 'spreadsheet_rows' &&
		typeof metadata?.spreadsheetTableIndex === 'number'
			? 2
			: 0) +
		(Array.isArray(metadata?.spreadsheetHeaders) &&
		metadata.spreadsheetHeaders.length > 0
			? 1
			: 0) +
		(typeof metadata?.slideNotesText === 'string' &&
		metadata.slideNotesText.trim().length > 0
			? 1
			: 0)
	);
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
	const region =
		getContextNumber(metadata.regionNumber) ??
		(typeof metadata.regionIndex === 'number'
			? metadata.regionIndex + 1
			: undefined);
	if (page && region) {
		return `Page ${page} · Region ${region}`;
	}
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
	const officeBlockKind = getContextString(metadata.officeBlockKind);
	const officeBlockNumber = getContextNumber(metadata.officeBlockNumber);
	const officeTableBodyRowStart = getContextNumber(
		metadata.officeTableBodyRowStart
	);
	const officeTableBodyRowEnd = getContextNumber(
		metadata.officeTableBodyRowEnd
	);
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

	if (officeBlockNumber && officeBlockKind === 'table') {
		if (
			typeof officeTableBodyRowStart === 'number' &&
			typeof officeTableBodyRowEnd === 'number'
		) {
			return officeTableBodyRowStart === officeTableBodyRowEnd
				? `Office table block ${officeBlockNumber} · Row ${officeTableBodyRowStart}`
				: `Office table block ${officeBlockNumber} · Rows ${officeTableBodyRowStart}-${officeTableBodyRowEnd}`;
		}
		return `Office table block ${officeBlockNumber}`;
	}
	if (officeBlockNumber && officeBlockKind === 'list') {
		return `Office list block ${officeBlockNumber}`;
	}
	if (officeBlockNumber && officeBlockKind === 'paragraph') {
		return `Office paragraph block ${officeBlockNumber}`;
	}

	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	if (sectionPath.length > 0) {
		return `Section ${sectionPath.join(' > ')}`;
	}

	return undefined;
};

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
	const mediaSegmentCount = getContextNumber(metadata.mediaSegmentCount);
	const mediaSegmentGroupSize = getContextNumber(
		metadata.mediaSegmentGroupSize
	);
	const mediaSegmentGroupIndex = getContextNumber(
		metadata.mediaSegmentGroupIndex
	);
	const mediaChannel = getContextString(metadata.mediaChannel);
	const mediaSpeakerCount = getContextNumber(metadata.mediaSpeakerCount);
	const mediaDurationLabel = formatMediaDurationLabel(
		metadata.mediaDurationMs
	);
	const transcriptSource = getContextString(metadata.transcriptSource);
	const pdfTextMode = getContextString(metadata.pdfTextMode);
	const officeBlockKind = getContextString(metadata.officeBlockKind);
	const officeListContextText = getContextString(
		metadata.officeListContextText
	);
	const officeListGroupItemCount = getContextNumber(
		metadata.officeListGroupItemCount
	);
	const officeListLevelsLabel = formatOfficeListLevelsLabel(
		metadata.officeListLevels
	);
	const officeTableHeaders = Array.isArray(metadata.officeTableHeaders)
		? metadata.officeTableHeaders
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const officeTableColumnCount = getContextNumber(
		metadata.officeTableColumnCount
	);
	const officeTableBodyRowCount = getContextNumber(
		metadata.officeTableBodyRowCount
	);
	const officeTableBodyRowStart = getContextNumber(
		metadata.officeTableBodyRowStart
	);
	const officeTableBodyRowEnd = getContextNumber(
		metadata.officeTableBodyRowEnd
	);
	const officeTableContextText = getContextString(
		metadata.officeTableContextText
	);
	const officeTableFollowUpText = getContextString(
		metadata.officeTableFollowUpText
	);
	const sectionPath = Array.isArray(metadata.sectionPath)
		? metadata.sectionPath
				.map((value) => getContextString(value))
				.filter((value): value is string => typeof value === 'string')
		: [];
	const ocrEngine = getContextString(metadata.ocrEngine);
	const ocrConfidence =
		getContextNumber(metadata.ocrRegionConfidence) ??
		getContextNumber(metadata.ocrConfidence);

	const labels = [
		pdfTextMode ? `PDF ${pdfTextMode}` : '',
		officeBlockKind ? `Office ${officeBlockKind}` : '',
		typeof officeListGroupItemCount === 'number'
			? `Office list ${officeListGroupItemCount} items`
			: '',
		officeListLevelsLabel ?? '',
		sectionPath.length > 0 && officeBlockKind
			? `Source-aware office ${officeBlockKind} block ${sectionPath.join(' > ')}`
			: '',
		officeListContextText
			? `Office list context ${officeListContextText}`
			: '',
		officeTableHeaders.length > 0
			? `Office table ${officeTableHeaders.join(', ')}`
			: '',
		typeof officeTableColumnCount === 'number'
			? `Office table ${officeTableColumnCount} cols`
			: '',
		typeof officeTableBodyRowCount === 'number'
			? `Office table ${officeTableBodyRowCount} body rows`
			: '',
		typeof officeTableBodyRowStart === 'number' &&
		typeof officeTableBodyRowEnd === 'number'
			? officeTableBodyRowStart === officeTableBodyRowEnd
				? `Office table row ${officeTableBodyRowStart}`
				: `Office table rows ${officeTableBodyRowStart}-${officeTableBodyRowEnd}`
			: '',
		officeTableContextText
			? `Office table context ${officeTableContextText}`
			: '',
		officeTableFollowUpText
			? `Office table follow-up ${officeTableFollowUpText}`
			: '',
		ocrEngine ? `OCR ${ocrEngine}` : '',
		typeof ocrConfidence === 'number'
			? `Confidence ${ocrConfidence.toFixed(2)}`
			: '',
		mediaKind ? `Media ${mediaKind}` : '',
		mediaSegmentCount ? `${mediaSegmentCount} segments` : '',
		mediaSegmentGroupSize
			? `${mediaSegmentGroupSize} grouped segments`
			: '',
		mediaSegmentGroupIndex !== undefined
			? `Segment group ${mediaSegmentGroupIndex + 1}`
			: '',
		mediaChannel ? `Channel ${mediaChannel}` : '',
		mediaSpeakerCount ? `${mediaSpeakerCount} speakers` : '',
		mediaDurationLabel ? `Duration ${mediaDurationLabel}` : '',
		transcriptSource ? `Transcript ${transcriptSource}` : '',
		threadTopic ? `Thread ${threadTopic}` : '',
		speaker ? `Speaker ${speaker}` : '',
		from ? `Sender ${from}` : '',
		sentAt ? `Sent ${sentAt}` : ''
	].filter((value) => value.length > 0);

	return labels.length > 0 ? labels.join(' · ') : undefined;
};

const buildSourceLabel = (source: RAGSource) =>
	source.source ?? source.title ?? source.chunkId;

const buildExcerpt = (text: string, maxLength = 160) => {
	const normalized = text.replaceAll(/\s+/g, ' ').trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const selectPreferredExcerpt = (
	excerpts?: {
		chunkExcerpt?: string;
		windowExcerpt?: string;
		sectionExcerpt?: string;
	},
	sectionChunkCount?: number
) => {
	if (!excerpts) {
		return {
			excerpt: '',
			mode: 'chunk' as const,
			reason: 'single_chunk' as const
		};
	}

	const chunkExcerpt = excerpts.chunkExcerpt?.trim() ?? '';
	const windowExcerpt = excerpts.windowExcerpt?.trim() ?? '';
	const sectionExcerpt = excerpts.sectionExcerpt?.trim() ?? '';
	if (
		sectionChunkCount &&
		sectionChunkCount > 1 &&
		chunkExcerpt.length > 0 &&
		chunkExcerpt.length < 72
	) {
		if (sectionChunkCount <= 3 && sectionExcerpt) {
			return {
				excerpt: sectionExcerpt,
				mode: 'section' as const,
				reason: 'section_small_enough' as const
			};
		}
		if (windowExcerpt) {
			return {
				excerpt: windowExcerpt,
				mode: 'window' as const,
				reason: 'section_too_large_use_window' as const
			};
		}

		return {
			excerpt: chunkExcerpt,
			mode: 'chunk' as const,
			reason: 'chunk_too_narrow' as const
		};
	}

	return {
		excerpt: chunkExcerpt || windowExcerpt || sectionExcerpt,
		mode: 'chunk' as const,
		reason:
			(sectionChunkCount ?? 0) > 1
				? ('chunk_too_narrow' as const)
				: ('single_chunk' as const)
	};
};

const buildExcerptModeCounts = (
	references: Array<
		| { excerptSelection?: { mode: 'chunk' | 'window' | 'section' } }
		| undefined
	>
): RAGExcerptModeCounts =>
	references.reduce<RAGExcerptModeCounts>(
		(counts, reference) => {
			if (reference?.excerptSelection) {
				counts[reference.excerptSelection.mode] += 1;
			}
			return counts;
		},
		{ chunk: 0, section: 0, window: 0 }
	);

const buildGroundingChunkExcerpts = (
	sources: RAGSource[],
	activeChunkId?: string
) => {
	if (sources.length === 0) {
		return undefined;
	}

	const activeSource =
		(activeChunkId
			? sources.find((source) => source.chunkId === activeChunkId)
			: undefined) ?? sources[0];
	if (!activeSource) {
		return undefined;
	}

	const chunkMap = new Map(sources.map((source) => [source.chunkId, source]));
	const activeMetadata = activeSource.metadata ?? {};
	const previousChunkId = getContextString(activeMetadata.previousChunkId);
	const nextChunkId = getContextString(activeMetadata.nextChunkId);
	const sectionChunkId = getContextString(activeMetadata.sectionChunkId);
	const sectionSources = sectionChunkId
		? sources
				.filter(
					(source) =>
						getContextString(source.metadata?.sectionChunkId) ===
						sectionChunkId
				)
				.sort((left, right) => {
					const leftIndex =
						getContextNumber(left.metadata?.sectionChunkIndex) ??
						Number.MAX_SAFE_INTEGER;
					const rightIndex =
						getContextNumber(right.metadata?.sectionChunkIndex) ??
						Number.MAX_SAFE_INTEGER;
					if (leftIndex !== rightIndex) {
						return leftIndex - rightIndex;
					}
					return left.chunkId.localeCompare(right.chunkId);
				})
		: [activeSource];
	const collectText = (chunkIds: string[]) =>
		chunkIds
			.map((chunkId) => chunkMap.get(chunkId)?.text)
			.filter((text): text is string => typeof text === 'string')
			.join('\n\n');
	const orderedWindowIds = [
		previousChunkId,
		activeSource.chunkId,
		nextChunkId
	].filter(
		(chunkId, index, values): chunkId is string =>
			Boolean(chunkId) && values.indexOf(chunkId) === index
	);

	return {
		chunkExcerpt: buildExcerpt(activeSource.text, 160),
		sectionExcerpt: buildExcerpt(
			sectionSources.map((source) => source.text).join('\n\n'),
			320
		),
		windowExcerpt: buildExcerpt(collectText(orderedWindowIds), 240)
	};
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
		reference.locatorLabel,
		reference.contextLabel,
		reference.provenanceLabel
	]
		.filter((value): value is string => Boolean(value && value.length > 0))
		.filter(
			(value, index, values) =>
				values.findIndex((entry) => entry === value) === index
		)
		.join(' · ');

const buildGroundingSectionKey = (reference: RAGGroundingReference) =>
	reference.contextLabel ??
	reference.locatorLabel ??
	reference.label ??
	reference.source ??
	reference.chunkId;

const buildGroundingSectionSummaryLine = (reference: RAGGroundingReference) =>
	[
		reference.source ?? reference.title ?? reference.chunkId,
		reference.locatorLabel,
		reference.contextLabel,
		reference.provenanceLabel
	]
		.filter((value): value is string => Boolean(value && value.length > 0))
		.filter(
			(value, index, values) =>
				values.findIndex((entry) => entry === value) === index
		)
		.join(' · ');

const buildGroundedAnswerCitationDetail = (
	reference: RAGGroundingReference
): RAGGroundedAnswerCitationDetail => ({
	contextLabel: reference.contextLabel,
	evidenceLabel: buildGroundingReferenceEvidenceLabel(reference),
	evidenceSummary: buildGroundingReferenceEvidenceSummary(reference),
	excerpt:
		selectPreferredExcerpt(
			reference.excerpts,
			getContextNumber(reference.metadata?.sectionChunkCount)
		).excerpt || reference.excerpt,
	excerpts: reference.excerpts,
	excerptSelection: reference.excerptSelection,
	label: reference.label,
	locatorLabel: reference.locatorLabel,
	number: reference.number,
	provenanceLabel: reference.provenanceLabel,
	source: reference.source,
	title: reference.title
});

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
		const excerpts = buildGroundingChunkExcerpts(sources, source.chunkId);
		const excerptSelection = selectPreferredExcerpt(
			excerpts,
			getContextNumber(source.metadata?.sectionChunkCount)
		);

		unique.set(key, {
			chunkId: source.chunkId,
			contextLabel:
				source.labels?.contextLabel ??
				buildContextLabel(source.metadata),
			excerpt: excerptSelection.excerpt || buildExcerpt(source.text),
			excerpts,
			excerptSelection,
			key,
			label: buildSourceLabel(source),
			locatorLabel:
				source.labels?.locatorLabel ??
				buildLocatorLabel(source.metadata, source.source, source.title),
			metadata: source.metadata,
			provenanceLabel:
				source.labels?.provenanceLabel ??
				buildProvenanceLabel(source.metadata),
			score: source.score,
			source: source.source,
			text: source.text,
			title: source.title
		});
	}

	return [...unique.values()].sort((left, right) => {
		const leftOfficeScope = getOfficeTableCitationScope(left.metadata);
		const rightOfficeScope = getOfficeTableCitationScope(right.metadata);
		if (
			left.source === right.source &&
			areOfficeCitationScopesComparable(leftOfficeScope, rightOfficeScope)
		) {
			const leftOfficePreference = getOfficeTableCitationPreference(
				left.metadata
			);
			const rightOfficePreference = getOfficeTableCitationPreference(
				right.metadata
			);
			if (rightOfficePreference !== leftOfficePreference) {
				return rightOfficePreference - leftOfficePreference;
			}
		}
		const leftGenericScope = getGenericStructuredCitationScope(left.metadata);
		const rightGenericScope = getGenericStructuredCitationScope(right.metadata);
		if (
			left.source === right.source &&
			areGenericStructuredCitationScopesComparable(
				leftGenericScope,
				rightGenericScope
			)
		) {
			const leftGenericPreference = getGenericStructuredCitationPreference(
				left.metadata
			);
			const rightGenericPreference =
				getGenericStructuredCitationPreference(right.metadata);
			if (rightGenericPreference !== leftGenericPreference) {
				return rightGenericPreference - leftGenericPreference;
			}
		}
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.label.localeCompare(right.label);
	});
};

export const buildRAGGroundedAnswer = (
	content: string,
	sources: RAGSource[]
): RAGGroundedAnswer => {
	const references = buildRAGGroundingReferences(sources);
	const sectionSummaries = buildRAGGroundedAnswerSectionSummaries(references);
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
		excerptModeCounts: buildExcerptModeCounts([
			...references,
			...sectionSummaries
		]),
		hasCitations,
		parts,
		references,
		sectionSummaries,
		ungroundedReferenceNumbers: [...ungroundedReferenceNumbers].sort(
			(left, right) => left - right
		)
	};
};

export const buildRAGGroundedAnswerSectionSummaries = (
	references: RAGGroundingReference[]
): RAGGroundedAnswerSectionSummary[] => {
	const groups = new Map<string, RAGGroundedAnswerSectionSummary>();

	for (const reference of references) {
		const key = buildGroundingSectionKey(reference);
		const existing = groups.get(key);
		if (!existing) {
			const excerpts = reference.excerpts
				? {
						chunkExcerpt: reference.excerpts.chunkExcerpt,
						sectionExcerpt: reference.excerpts.sectionExcerpt,
						windowExcerpt: reference.excerpts.windowExcerpt
					}
				: undefined;
			groups.set(key, {
				chunkIds: [reference.chunkId],
				contextLabel: reference.contextLabel,
				count: 1,
				excerpt:
					selectPreferredExcerpt(
						excerpts,
						getContextNumber(reference.metadata?.sectionChunkCount)
					).excerpt ||
					excerpts?.sectionExcerpt ||
					reference.excerpt,
				excerpts,
				excerptSelection: reference.excerptSelection,
				key,
				label: key,
				locatorLabel: reference.locatorLabel,
				provenanceLabel: reference.provenanceLabel,
				referenceNumbers: [reference.number],
				references: [reference],
				summary:
					buildGroundingSectionSummaryLine(reference) ||
					reference.label ||
					reference.chunkId
			});
			continue;
		}

		existing.count += 1;
		if (!existing.chunkIds.includes(reference.chunkId)) {
			existing.chunkIds.push(reference.chunkId);
		}
		if (!existing.referenceNumbers.includes(reference.number)) {
			existing.referenceNumbers.push(reference.number);
		}
		existing.references.push(reference);
		if (!existing.contextLabel && reference.contextLabel) {
			existing.contextLabel = reference.contextLabel;
		}
		if (!existing.locatorLabel && reference.locatorLabel) {
			existing.locatorLabel = reference.locatorLabel;
		}
		if (!existing.provenanceLabel && reference.provenanceLabel) {
			existing.provenanceLabel = reference.provenanceLabel;
		}
		if (!existing.excerpts && reference.excerpts) {
			existing.excerpts = {
				chunkExcerpt: reference.excerpts.chunkExcerpt,
				sectionExcerpt: reference.excerpts.sectionExcerpt,
				windowExcerpt: reference.excerpts.windowExcerpt
			};
			existing.excerpt = reference.excerpts.sectionExcerpt;
		}
		if (!existing.excerptSelection && reference.excerptSelection) {
			existing.excerptSelection = reference.excerptSelection;
		}
	}

	return [...groups.values()]
		.map((group) => ({
			...group,
			referenceNumbers: [...group.referenceNumbers].sort(
				(left, right) => left - right
			),
			references: group.references
				.slice()
				.sort((left, right) => left.number - right.number)
		}))
		.sort((left, right) => {
			const leftFirst =
				left.referenceNumbers[0] ?? Number.POSITIVE_INFINITY;
			const rightFirst =
				right.referenceNumbers[0] ?? Number.POSITIVE_INFINITY;
			if (leftFirst !== rightFirst) {
				return leftFirst - rightFirst;
			}
			return left.label.localeCompare(right.label);
		});
};

export const buildRAGGroundingReferences = (sources: RAGSource[]) => {
	const citations = buildRAGCitations(sources);
	const citationReferenceMap = buildRAGCitationReferenceMap(citations);

	return citations.map<RAGGroundingReference>((citation) => {
		const excerpts = buildGroundingChunkExcerpts(sources, citation.chunkId);
		const excerptSelection = selectPreferredExcerpt(
			excerpts,
			getContextNumber(citation.metadata?.sectionChunkCount)
		);
		return {
			chunkId: citation.chunkId,
			contextLabel:
				citation.contextLabel ?? buildContextLabel(citation.metadata),
			excerpt:
				excerptSelection.excerpt ||
				excerpts?.chunkExcerpt ||
				buildExcerpt(citation.text),
			excerpts,
			excerptSelection,
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
				citation.provenanceLabel ??
				buildProvenanceLabel(citation.metadata),
			score: citation.score,
			source: citation.source,
			text: citation.text,
			title: citation.title
		};
	});
};
