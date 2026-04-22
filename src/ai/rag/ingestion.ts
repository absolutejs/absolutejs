import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import type {
	RAGChunkingOptions,
	RAGChunkingProfile,
	RAGChunkingProfileInput,
	RAGChunkingProfileRegistration,
	RAGChunkingRegistryLike,
	RAGContentFormat,
	RAGArchiveExpander,
	RAGArchiveEntry,
	RAGDirectoryIngestInput,
	RAGDocumentChunk,
	RAGDocumentFileInput,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUploadInput,
	RAGDocumentUrlInput,
	RAGDocumentUrlIngestInput,
	RAGExtractedFileDocument,
	RAGFileExtractionInput,
	RAGFileExtractor,
	RAGFileExtractorRegistration,
	RAGFileExtractorRegistryInput,
	RAGFileExtractorRegistryLike,
	RAGIngestDocument,
	RAGMediaTranscriber,
	RAGMediaTranscriptionResult,
	RAGOCRResult,
	RAGPDFOCRExtractorOptions,
	RAGOCRProvider,
	RAGPreparedDocument
} from '../../../types/ai';
import {
	EXCLUDE_LAST_OFFSET,
	RAG_CHUNK_ID_PAD_LENGTH,
	RAG_DOCUMENT_ID_PREVIEW_LENGTH,
	RAG_DOCUMENT_SLUG_MAX_LENGTH,
	RAG_MIN_CHUNK_LENGTH_FLOOR
} from '../../constants';

const DEFAULT_MAX_CHUNK_LENGTH = 900;
const DEFAULT_CHUNK_OVERLAP = 120;
const DEFAULT_MIN_CHUNK_LENGTH = 80;
const DEFAULT_STRATEGY = 'paragraphs';
const DEFAULT_BINARY_NAME = 'document';

const TEXT_FILE_EXTENSIONS = new Set([
	'.txt',
	'.md',
	'.mdx',
	'.html',
	'.htm',
	'.json',
	'.jsonl',
	'.ndjson',
	'.csv',
	'.tsv',
	'.xml',
	'.yaml',
	'.yml',
	'.log',
	'.ts',
	'.tsx',
	'.js',
	'.jsx'
]);
const OFFICE_FILE_EXTENSIONS = new Set([
	'.docx',
	'.xlsx',
	'.pptx',
	'.odt',
	'.ods',
	'.odp'
]);
const LEGACY_DOCUMENT_FILE_EXTENSIONS = new Set([
	'.rtf',
	'.doc',
	'.xls',
	'.ppt',
	'.msg'
]);
const MAILBOX_CONTAINER_FILE_EXTENSIONS = new Set(['.pst', '.ost']);
const EMAIL_FILE_EXTENSIONS = new Set(['.eml', '.emlx', '.mbox', '.mbx']);
const EPUB_FILE_EXTENSIONS = new Set(['.epub']);

const PDF_FILE_EXTENSIONS = new Set(['.pdf']);
const AUDIO_FILE_EXTENSIONS = new Set([
	'.mp3',
	'.wav',
	'.m4a',
	'.aac',
	'.flac',
	'.ogg',
	'.opus'
]);
const VIDEO_FILE_EXTENSIONS = new Set([
	'.mp4',
	'.mov',
	'.mkv',
	'.webm',
	'.avi',
	'.m4v'
]);
const IMAGE_FILE_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.tiff',
	'.tif',
	'.bmp',
	'.gif',
	'.heic'
]);
const ARCHIVE_FILE_EXTENSIONS = new Set([
	'.zip',
	'.tar',
	'.gz',
	'.tgz',
	'.bz2',
	'.xz'
]);
const TAR_FILE_EXTENSIONS = new Set(['.tar']);
const GZIP_FILE_EXTENSIONS = new Set(['.gz', '.tgz']);

const HTML_ENTITY_REPLACEMENTS = [
	[/&nbsp;/gi, ' '],
	[/&amp;/gi, '&'],
	[/&lt;/gi, '<'],
	[/&gt;/gi, '>'],
	[/&quot;/gi, '"'],
	[/&#39;/gi, "'"],
	[/&#x27;/gi, "'"],
	[/&#x2f;/gi, '/']
] as const;

const MAX_MEDIA_GROUP_CONTINUITY_GAP_MS = 3_000;
const MAX_MEDIA_BRIDGED_UNKNOWN_SEGMENTS = 2;

const normalizeWhitespace = (value: string) =>
	value
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

const formatMediaTimestampForIngest = (value: number | undefined) => {
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

const normalizeMediaSpeaker = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0
		? normalizeWhitespace(value)
		: undefined;

const canonicalMediaSpeakerKey = (value: unknown) => {
	const normalized = normalizeMediaSpeaker(value);
	return typeof normalized === 'string'
		? normalized.toLowerCase().replace(/[^a-z0-9]+/gi, '')
		: undefined;
};

const normalizeMediaTimestamp = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: undefined;

const normalizeMediaSegmentWindow = (
	startMs: number | undefined,
	endMs: number | undefined
) => {
	if (typeof startMs !== 'number' && typeof endMs !== 'number') {
		return { endMs, startMs };
	}

	if (
		typeof startMs === 'number' &&
		typeof endMs === 'number' &&
		endMs < startMs
	) {
		return {
			startMs: undefined,
			endMs: undefined
		};
	}

	return {
		startMs,
		endMs
	};
};

const canonicalMediaChannel = (value: unknown) => {
	if (typeof value !== 'string') {
		return undefined;
	}

	switch (
		value
			.trim()
			.toLowerCase()
			.replace(/[\s_-]+/g, '')
	) {
		case 'l':
		case 'left':
		case 'ch1':
		case 'channel1':
		case 'one':
			return 'left';
		case 'r':
		case 'right':
		case 'ch2':
		case 'channel2':
		case 'two':
			return 'right';
		case 'm':
		case 'mono':
		case 'center':
		case 'centre':
		case 'middle':
			return 'mono';
		default:
			return value.trim().toLowerCase();
	}
};

const normalizeMediaChannel = (value: unknown) => canonicalMediaChannel(value);

type RAGMediaTranscriptSegmentWithText = NonNullable<
	RAGMediaTranscriptionResult['segments']
>[number];

type RAGMediaSegmentGroup = {
	channel?: string;
	endMs?: number;
	segments: RAGMediaTranscriptSegmentWithText[];
	speaker?: string;
	speakerKey?: string;
	startMs?: number;
};

const buildMediaTimestampBoundary = (
	segments: RAGMediaSegmentGroup['segments']
) => {
	let startMs: number | undefined;
	let endMs: number | undefined;

	for (const segment of segments) {
		if (
			typeof segment.startMs === 'number' &&
			Number.isFinite(segment.startMs)
		) {
			startMs =
				typeof startMs === 'number'
					? Math.min(startMs, segment.startMs)
					: segment.startMs;
		}
	}

	for (const segment of segments) {
		if (
			typeof segment.endMs === 'number' &&
			Number.isFinite(segment.endMs)
		) {
			endMs =
				typeof endMs === 'number'
					? Math.max(endMs, segment.endMs)
					: segment.endMs;
		}
	}

	return { endMs, startMs };
};

const buildMediaSegmentGapFromPrevious = (
	startMs: number | undefined,
	previousGroupEndMs: number | undefined
) => {
	if (
		typeof startMs !== 'number' ||
		typeof previousGroupEndMs !== 'number' ||
		!Number.isFinite(startMs) ||
		!Number.isFinite(previousGroupEndMs)
	) {
		return undefined;
	}

	// Only reward true adjacency or forward gaps. Overlaps should not look like
	// gapless continuity because reranking treats a zero gap as the strongest case.
	if (startMs < previousGroupEndMs) {
		return undefined;
	}

	return startMs - previousGroupEndMs;
};

const buildMediaSegmentGapToNext = (
	endMs: number | undefined,
	nextGroupStartMs: number | undefined
) => {
	if (
		typeof endMs !== 'number' ||
		typeof nextGroupStartMs !== 'number' ||
		!Number.isFinite(endMs) ||
		!Number.isFinite(nextGroupStartMs)
	) {
		return undefined;
	}

	// Mirror previous-gap semantics: only reward true forward adjacency or gaps.
	// Overlaps should not look like gapless continuity.
	if (nextGroupStartMs < endMs) {
		return undefined;
	}

	return nextGroupStartMs - endMs;
};

const normalizeMediaSegment = (
	segment: NonNullable<RAGMediaTranscriptionResult['segments']>[number]
): RAGMediaTranscriptSegmentWithText => {
	const normalizedTimestampWindow = normalizeMediaSegmentWindow(
		normalizeMediaTimestamp(segment.startMs),
		normalizeMediaTimestamp(segment.endMs)
	);

	return {
		...segment,
		speaker: normalizeMediaSpeaker(segment.speaker),
		channel: canonicalMediaChannel(segment.channel),
		...normalizedTimestampWindow
	};
};

const hasMediaSegmentTiming = (
	segment:
		| Pick<RAGMediaTranscriptSegmentWithText, 'startMs' | 'endMs'>
		| undefined
) =>
	Boolean(
		segment &&
			((typeof segment.startMs === 'number' &&
				Number.isFinite(segment.startMs)) ||
				(typeof segment.endMs === 'number' &&
					Number.isFinite(segment.endMs)))
	);

const sortMediaTranscriptSegments = (
	segments: RAGMediaTranscriptSegmentWithText[]
) => {
	const sortTimedRun = (
		run: Array<{
			index: number;
			segment: RAGMediaTranscriptSegmentWithText;
		}>
	) =>
		run.sort((left, right) => {
			const leftStart = left.segment.startMs;
			const rightStart = right.segment.startMs;
			const leftHasStart =
				typeof leftStart === 'number' && Number.isFinite(leftStart);
			const rightHasStart =
				typeof rightStart === 'number' && Number.isFinite(rightStart);

			if (leftHasStart && rightHasStart && leftStart !== rightStart) {
				return leftStart - rightStart;
			}

			if (leftHasStart !== rightHasStart) {
				return leftHasStart ? -1 : 1;
			}

			const leftEnd = left.segment.endMs;
			const rightEnd = right.segment.endMs;
			const leftHasEnd =
				typeof leftEnd === 'number' && Number.isFinite(leftEnd);
			const rightHasEnd =
				typeof rightEnd === 'number' && Number.isFinite(rightEnd);

			if (leftHasEnd && rightHasEnd && leftEnd !== rightEnd) {
				return leftEnd - rightEnd;
			}

			if (leftHasEnd !== rightHasEnd) {
				return leftHasEnd ? -1 : 1;
			}

			return left.index - right.index;
		});

	const ordered: RAGMediaTranscriptSegmentWithText[] = [];
	let timedRun: Array<{
		index: number;
		segment: RAGMediaTranscriptSegmentWithText;
	}> = [];

	for (const [index, segment] of segments.entries()) {
		if (hasMediaSegmentTiming(segment)) {
			timedRun.push({ index, segment });
			continue;
		}

		if (timedRun.length > 0) {
			ordered.push(
				...sortTimedRun(timedRun).map((entry) => entry.segment)
			);
			timedRun = [];
		}

		ordered.push(segment);
	}

	if (timedRun.length > 0) {
		ordered.push(...sortTimedRun(timedRun).map((entry) => entry.segment));
	}

	return ordered;
};

const findNextInformativeMediaSegment = (
	segments: RAGMediaTranscriptSegmentWithText[],
	resolveValue: (
		segment: RAGMediaTranscriptSegmentWithText
	) => string | undefined
) => {
	let unknownSegments = 0;

	for (const segment of segments) {
		if (!segment || typeof segment !== 'object') {
			continue;
		}

		if (normalizeWhitespace(segment.text ?? '').length === 0) {
			continue;
		}

		const value = resolveValue(segment);
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}

		unknownSegments += 1;
		if (unknownSegments > MAX_MEDIA_BRIDGED_UNKNOWN_SEGMENTS) {
			return undefined;
		}
	}

	return undefined;
};

const groupTranscriptSegments = (
	segments: RAGMediaTranscriptSegmentWithText[]
) => {
	const groups: RAGMediaSegmentGroup[] = [];

	for (const [index, segment] of segments.entries()) {
		if (!segment || typeof segment !== 'object') {
			continue;
		}

		const text = normalizeWhitespace(segment.text ?? '');
		if (!text) {
			continue;
		}

		let speaker = normalizeMediaSpeaker(segment.speaker);
		let speakerKey = canonicalMediaSpeakerKey(segment.speaker);
		let channel = normalizeMediaChannel(segment.channel);
		const lastGroup = groups.at(-1);
		const remainingSegments = segments.slice(index + 1);
		const nextSpeakerKey = findNextInformativeMediaSegment(
			remainingSegments,
			(candidate) => canonicalMediaSpeakerKey(candidate.speaker)
		);
		const nextChannel = findNextInformativeMediaSegment(
			remainingSegments,
			(candidate) => normalizeMediaChannel(candidate.channel)
		);
		if (
			!speakerKey &&
			!channel &&
			lastGroup?.speakerKey &&
			lastGroup.channel &&
			nextSpeakerKey === lastGroup.speakerKey &&
			nextChannel === lastGroup.channel
		) {
			speakerKey = lastGroup.speakerKey;
			speaker = lastGroup.speaker;
			channel = lastGroup.channel;
		}
		if (
			!speakerKey &&
			lastGroup?.speakerKey &&
			lastGroup.channel === channel &&
			nextSpeakerKey === lastGroup.speakerKey &&
			nextChannel === channel
		) {
			speakerKey = lastGroup.speakerKey;
			speaker = lastGroup.speaker;
		}
		if (
			!channel &&
			lastGroup?.channel &&
			lastGroup.speakerKey === speakerKey &&
			nextChannel === lastGroup.channel &&
			nextSpeakerKey === speakerKey
		) {
			channel = lastGroup.channel;
		}
		const shouldSplitForTimingModeChange =
			hasMediaSegmentTiming(segment) !== hasMediaSegmentTiming(lastGroup);
		const shouldSplitForGap =
			typeof segment.startMs === 'number' &&
			typeof lastGroup?.endMs === 'number' &&
			Number.isFinite(segment.startMs) &&
			Number.isFinite(lastGroup.endMs) &&
			segment.startMs - lastGroup.endMs >
				MAX_MEDIA_GROUP_CONTINUITY_GAP_MS;
		if (
			!lastGroup ||
			lastGroup.speakerKey !== speakerKey ||
			lastGroup.channel !== channel ||
			shouldSplitForTimingModeChange ||
			shouldSplitForGap
		) {
			groups.push({
				channel,
				endMs: segment.endMs,
				segments: [segment],
				speaker,
				speakerKey,
				startMs: segment.startMs
			});
			continue;
		}

		lastGroup.endMs =
			typeof segment.endMs === 'number' && Number.isFinite(segment.endMs)
				? segment.endMs
				: lastGroup.endMs;
		lastGroup.segments.push(segment);
		if (
			typeof segment.startMs === 'number' &&
			Number.isFinite(segment.startMs)
		) {
			if (
				typeof lastGroup.startMs !== 'number' ||
				!Number.isFinite(lastGroup.startMs) ||
				segment.startMs < lastGroup.startMs
			) {
				lastGroup.startMs = segment.startMs;
			}
		}
	}

	return groups;
};

const decodeHtmlEntities = (value: string) => {
	let output = value;
	for (const [pattern, replacement] of HTML_ENTITY_REPLACEMENTS) {
		output = output.replace(pattern, replacement);
	}

	output = output.replace(/&#(\d+);/g, (_, code) =>
		String.fromCodePoint(Number(code))
	);

	return output.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
		String.fromCodePoint(parseInt(code, 16))
	);
};

const formatHtmlLinkContext = (href: string) => {
	const decoded = decodeHtmlEntities(href.trim());
	if (!decoded) {
		return undefined;
	}

	if (decoded.startsWith('#')) {
		return decoded;
	}

	if (/^[a-z]+:/i.test(decoded)) {
		try {
			const url = new URL(decoded);
			const path = url.pathname === '/' ? '' : url.pathname;
			return `${url.hostname}${path}`;
		} catch {
			return decoded;
		}
	}

	return decoded;
};

const stripHtmlTags = (value: string) => {
	const withoutTags = value
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(
			/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
			(_match, _quote: string, href: string, inner: string) => {
				const label = normalizeWhitespace(stripHtmlTags(inner));
				const context = formatHtmlLinkContext(href);
				if (!label) {
					return context ?? ' ';
				}
				if (!context || context === label) {
					return label;
				}

				return `${label} (${context})`;
			}
		)
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|table|tr)>/gi, '\n')
		.replace(/<li\b[^>]*>/gi, '- ')
		.replace(/<[^>]+>/g, ' ');

	return decodeHtmlEntities(withoutTags);
};

const stripHtmlNoiseBlocks = (value: string) =>
	value
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(
			/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,
			' '
		)
		.replace(
			/<([a-z0-9:_-]+)\b[^>]*\b(hidden|aria-hidden=(['"])true\3)[^>]*>[\s\S]*?<\/\1>/gi,
			' '
		)
		.replace(
			/<(nav|footer|header|aside|form|dialog)\b[^>]*>[\s\S]*?<\/\1>/gi,
			' '
		)
		.replace(
			/<([a-z0-9:_-]+)\b[^>]*\b(?:id|class)=(['"])[^'"]*(nav|menu|footer|header|sidebar|promo|banner|cookie|breadcrumb|share|social|subscribe|newsletter|modal)[^'"]*\2[^>]*>[\s\S]*?<\/\1>/gi,
			' '
		);

const collectHtmlContentCandidates = (value: string) => {
	const patterns: Array<{
		contentGroup: number;
		pattern: RegExp;
	}> = [
		{
			contentGroup: 1,
			pattern: /<main\b[^>]*>([\s\S]*?)<\/main>/gi
		},
		{
			contentGroup: 1,
			pattern: /<article\b[^>]*>([\s\S]*?)<\/article>/gi
		},
		{
			contentGroup: 3,
			pattern:
				/<([a-z0-9:_-]+)\b[^>]*\brole=(['"])main\2[^>]*>([\s\S]*?)<\/\1>/gi
		},
		{
			contentGroup: 4,
			pattern:
				/<([a-z0-9:_-]+)\b[^>]*\b(?:id|class)=(['"])[^'"]*(content|article|main|post|body)[^'"]*\2[^>]*>([\s\S]*?)<\/\1>/gi
		}
	];
	const candidates: string[] = [];

	for (const entry of patterns) {
		for (const match of value.matchAll(entry.pattern)) {
			const rawCandidate = match[entry.contentGroup];
			const candidate =
				typeof rawCandidate === 'string' ? rawCandidate : '';
			if (candidate.trim()) {
				candidates.push(candidate.trim());
			}
		}
	}

	return candidates;
};

const extractMainHtmlContent = (value: string) => {
	const trimmed = value.trim();
	if (!/<html\b|<body\b|<main\b|<article\b/i.test(trimmed)) {
		return value;
	}

	const stripped = stripHtmlNoiseBlocks(trimmed);
	const candidates = collectHtmlContentCandidates(stripped);

	if (candidates.length > 0) {
		const bestCandidate = candidates
			.map((candidate) => ({
				candidate,
				score: stripHtmlTags(candidate).replace(/\s+/g, ' ').trim()
					.length
			}))
			.sort((left, right) => right.score - left.score)[0]?.candidate;
		if (bestCandidate) {
			return bestCandidate;
		}
	}

	const bodyMatch = stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	if (bodyMatch?.[1]) {
		return bodyMatch[1];
	}

	return stripped;
};

const stripHtml = (value: string) => {
	const focused = extractMainHtmlContent(value);

	return normalizeWhitespace(stripHtmlTags(focused));
};

const stripMarkdown = (value: string) => {
	const withoutCodeBlocks = value.replace(/```[\s\S]*?```/g, (block) => {
		const lines = block.split('\n').slice(1, EXCLUDE_LAST_OFFSET);

		return lines.join('\n');
	});

	const stripped = withoutCodeBlocks
		.replace(/`([^`]+)`/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/^>\s?/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^[-*+]\s+/gm, '')
		.replace(/^\d+\.\s+/gm, '')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/_([^_]+)_/g, '$1')
		.replace(/^---+$/gm, '\n')
		.replace(/^===+$/gm, '\n');

	return normalizeWhitespace(stripped);
};

const stripMarkdownFence = (value: string) => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	if (lines.length >= 2 && /^```/.test(lines[0] ?? '')) {
		lines.shift();
	}
	if (lines.length >= 1 && /^```/.test(lines[lines.length - 1] ?? '')) {
		lines.pop();
	}

	return lines.join('\n').trim();
};

const splitMarkdownPreferredChunkUnits = (value: string) => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	const units: string[] = [];
	let proseBuffer: string[] = [];
	let fenceBuffer: string[] | undefined;

	const flushProse = () => {
		if (proseBuffer.length === 0) {
			return;
		}

		const text = stripMarkdown(proseBuffer.join('\n'));
		if (text) {
			units.push(text);
		}
		proseBuffer = [];
	};

	const flushFence = () => {
		if (!fenceBuffer || fenceBuffer.length === 0) {
			fenceBuffer = undefined;
			return;
		}

		const text = stripMarkdownFence(fenceBuffer.join('\n'));
		if (text) {
			units.push(text);
		}
		fenceBuffer = undefined;
	};

	for (const line of lines) {
		if (/^```/.test(line.trim())) {
			if (fenceBuffer) {
				fenceBuffer.push(line);
				flushFence();
				continue;
			}

			flushProse();
			fenceBuffer = [line];
			continue;
		}

		if (fenceBuffer) {
			fenceBuffer.push(line);
			continue;
		}

		if (line.trim().length === 0) {
			flushProse();
			continue;
		}

		proseBuffer.push(line);
	}

	flushProse();
	flushFence();

	return units;
};

type StructuredChunkUnit = {
	text: string;
	sourceAwareChunkReason?:
		| 'section_boundary'
		| 'size_limit'
		| 'source_native_unit';
	sectionTitle?: string;
	sectionPath?: string[];
	sectionDepth?: number;
	sectionFamilyPath?: string[];
	sectionOrdinalPath?: number[];
	sectionSiblingFamilyKey?: string;
	sectionSiblingOrdinal?: number;
	spreadsheetHeaders?: string[];
	spreadsheetColumnStart?: string;
	spreadsheetColumnEnd?: string;
	spreadsheetTableCount?: number;
	spreadsheetTableIndex?: number;
	spreadsheetRowEnd?: number;
	spreadsheetRowStart?: number;
	officeBlockNumber?: number;
	officeBlockKind?: 'title' | 'heading' | 'paragraph' | 'list' | 'table';
	officeFamilyPath?: string[];
	officeOrdinalPath?: number[];
	officeSiblingFamilyKey?: string;
	officeSiblingOrdinal?: number;
	officeListContextText?: string;
	officeListGroupItemCount?: number;
	officeListLevel?: number;
	officeListLevels?: number[];
	officeTableBodyRowEnd?: number;
	officeTableBodyRowCount?: number;
	officeTableBodyRowStart?: number;
	officeTableChunkKind?: 'full_table' | 'table_slice';
	officeTableColumnCount?: number;
	officeTableContextText?: string;
	officeTableFollowUpText?: string;
	officeTableHeaderText?: string;
	officeTableHeaders?: string[];
	officeTableRowCount?: number;
	officeTableSignature?: string;
	pageNumber?: number;
	pdfBlockNumber?: number;
	pdfFigureCaptionBlockNumber?: number;
	pdfFigureLabel?: string;
	pdfSemanticRole?: 'figure_caption' | 'figure_body';
	pdfTableBodyRowEnd?: number;
	pdfTableBodyRowCount?: number;
	pdfTableBodyRowStart?: number;
	pdfTableChunkKind?: 'full_table' | 'table_slice';
	pdfTableColumnCount?: number;
	pdfTableHeaderText?: string;
	pdfTableHeaders?: string[];
	pdfTableRowCount?: number;
	pdfTableSignature?: string;
	pdfTextKind?: 'paragraph' | 'table_like';
	emailSectionKind?: 'authored_text' | 'forwarded_headers' | 'quoted_history';
	emailForwardedBccAddresses?: string[];
	emailForwardedCcAddresses?: string[];
	emailForwardedDate?: string;
	emailForwardedFromAddress?: string;
	emailForwardedFromDisplayName?: string;
	emailForwardedChainCount?: number;
	emailForwardedOrdinal?: number;
	emailQuotedDepth?: number;
	emailForwardedHeaderFields?: Record<string, string>;
	emailForwardedParticipantAddresses?: string[];
	emailForwardedReplyToAddresses?: string[];
	emailForwardedSubject?: string;
	emailForwardedTimestamp?: string;
	emailForwardedToAddresses?: string[];
	sectionKind?:
		| 'markdown_heading'
		| 'html_heading'
		| 'jsonl_record'
		| 'tsv_row'
		| 'csv_row'
		| 'xml_node'
		| 'yaml_section'
		| 'office_heading'
		| 'office_block'
		| 'code_block'
		| 'spreadsheet_rows'
		| 'presentation_slide'
		| 'pdf_block'
		| 'email_block';
	preferredChunkUnits?: string[];
};

type EmailBodySection = {
	kind: 'authored_text' | 'forwarded_headers' | 'quoted_history';
	text: string;
	forwardedHeaderFields?: Record<string, string>;
	forwardedFromAddress?: string;
	forwardedFromDisplayName?: string;
	forwardedToAddresses?: string[];
	forwardedCcAddresses?: string[];
	forwardedBccAddresses?: string[];
	forwardedReplyToAddresses?: string[];
	forwardedParticipantAddresses?: string[];
	forwardedSubject?: string;
	forwardedDate?: string;
	forwardedTimestamp?: string;
	quotedDepth?: number;
};

type EmailMessageLineageEntry = {
	attachmentSource?: string;
	messageId?: string;
	messageSource?: string;
	messageSourceKind?: string;
	threadKey?: string;
};

type OfficeDocumentBlock = {
	blockNumber: number;
	blockKind: 'title' | 'heading' | 'paragraph' | 'list' | 'table';
	text: string;
	style?: string;
	headingLevel?: number;
	listLevel?: number;
	tableBodyRowCount?: number;
	tableColumnCount?: number;
	tableHeaderText?: string;
	tableHeaders?: string[];
	tableRowCount?: number;
	tableSignature?: string;
};

const findNearestPDFContextHeading = (
	blockEntries: PDFNativeStructureBlockEntry[],
	pageNumber: number | undefined
) => {
	if (typeof pageNumber !== 'number') {
		return undefined;
	}

	for (let index = blockEntries.length - 1; index >= 0; index -= 1) {
		const entry = blockEntries[index];
		if (!entry || entry.pageNumber !== pageNumber) {
			if (
				entry &&
				typeof entry.pageNumber === 'number' &&
				entry.pageNumber < pageNumber
			) {
				break;
			}
			continue;
		}
		if (entry.pdfSemanticRole || entry.pdfTextKind !== 'paragraph') {
			continue;
		}
		const heading = inferPDFBlockHeading(entry.text);
		if (heading) {
			return heading;
		}
	}

	return undefined;
};

const getPDFTableHeaders = (text: string) => {
	const lines = text
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	const headerLine = lines[0];
	if (!headerLine || !headerLine.includes(' | ')) {
		return undefined;
	}

	const headers = headerLine
		.split(' | ')
		.map((entry) => normalizeWhitespace(entry))
		.filter(Boolean);
	return headers.length >= 2 ? headers : undefined;
};

const pdfNativeStructureUnits = (
	metadata?: Record<string, unknown>
): StructuredChunkUnit[] => {
	const blocks = Array.isArray(metadata?.pdfTextBlocks)
		? metadata.pdfTextBlocks
		: [];
	const blockEntries: PDFNativeStructureBlockEntry[] = [];
	for (const block of blocks) {
		if (!block || typeof block !== 'object') {
			continue;
		}

		const rawText = typeof block.text === 'string' ? block.text : '';
		const pdfTextKind =
			block.textKind === 'table_like' ? 'table_like' : 'paragraph';
		const text =
			pdfTextKind === 'table_like'
				? rawText
						.split('\n')
						.map((line: string) => normalizeWhitespace(line))
						.filter(Boolean)
						.join('\n')
				: normalizeWhitespace(rawText);
		if (!text) {
			continue;
		}

		const pageNumber =
			typeof block.pageNumber === 'number' &&
			Number.isFinite(block.pageNumber)
				? block.pageNumber
				: undefined;
		const pdfBlockNumber =
			typeof block.blockNumber === 'number' &&
			Number.isFinite(block.blockNumber)
				? block.blockNumber
				: undefined;
		const previousBlock = blockEntries.at(-1);
		const previousFigureCaption =
			previousBlock &&
			previousBlock.pageNumber === pageNumber &&
			previousBlock.pdfSemanticRole === 'figure_caption'
				? previousBlock
				: undefined;
		const pdfSemanticRole =
			block.semanticRole === 'figure_caption'
				? 'figure_caption'
				: block.semanticRole === 'figure_body'
					? 'figure_body'
					: pdfTextKind === 'paragraph' &&
						  previousFigureCaption &&
						  !inferPDFBlockHeading(text)
						? 'figure_body'
						: undefined;
		const currentBlockHeading =
			pdfTextKind === 'paragraph' && !pdfSemanticRole
				? inferPDFBlockHeading(text)
				: undefined;
		const contextualHeading =
			pdfTextKind === 'table_like'
				? findNearestPDFContextHeading(blockEntries, pageNumber)
				: undefined;
		const contextualTableTitle =
			contextualHeading && pdfTextKind === 'table_like'
				? /\btable\b/i.test(contextualHeading)
					? contextualHeading
					: `${contextualHeading} Table`
				: undefined;
		const pdfTableHeaders =
			pdfTextKind === 'table_like' ? getPDFTableHeaders(text) : undefined;
		const pdfTableHeaderText =
			pdfTextKind === 'table_like'
				? text
						.split('\n')
						.map((line: string) => normalizeWhitespace(line))
						.filter(Boolean)[0]
				: undefined;
		const pdfTableRowCount =
			pdfTextKind === 'table_like'
				? text
						.split('\n')
						.map((line: string) => normalizeWhitespace(line))
						.filter(Boolean).length
				: undefined;
		const pdfTableBodyRowCount =
			typeof pdfTableRowCount === 'number'
				? Math.max(0, pdfTableRowCount - 1)
				: undefined;
		const pdfTableBodyRowStart =
			typeof pdfTableBodyRowCount === 'number' && pdfTableBodyRowCount > 0
				? 1
				: undefined;
		const pdfTableBodyRowEnd =
			typeof pdfTableBodyRowCount === 'number' && pdfTableBodyRowCount > 0
				? pdfTableBodyRowCount
				: undefined;
		const pdfTableColumnCount = Array.isArray(pdfTableHeaders)
			? pdfTableHeaders.length
			: undefined;
		const pdfTableSignature =
			Array.isArray(pdfTableHeaders) && pdfTableHeaders.length > 0
				? pdfTableHeaders.join(' | ')
				: undefined;
		const pdfFigureLabel =
			pdfSemanticRole === 'figure_caption'
				? extractPDFFigureLabel(text)
				: previousFigureCaption?.pdfFigureLabel;
		const pdfFigureCaptionBlockNumber =
			pdfSemanticRole === 'figure_caption'
				? pdfBlockNumber
				: previousFigureCaption?.pdfFigureCaptionBlockNumber;
		const baseSectionTitle =
			pdfSemanticRole === 'figure_caption'
				? pageNumber
					? `Page ${pageNumber} Figure Caption`
					: 'Figure Caption'
				: pdfSemanticRole === 'figure_body'
					? pdfFigureLabel
						? `${pdfFigureLabel} Body`
						: pageNumber
							? `Page ${pageNumber} Figure Body`
							: 'Figure Body'
					: currentBlockHeading
						? currentBlockHeading
						: contextualTableTitle
							? contextualTableTitle
							: pageNumber
								? pdfTextKind === 'table_like'
									? `Page ${pageNumber} Table Block`
									: `Page ${pageNumber} Text Block`
								: pdfTextKind === 'table_like'
									? 'Table Block'
									: 'Text Block';

		blockEntries.push({
			baseSectionTitle,
			pageNumber,
			pdfBlockNumber,
			...(typeof pdfFigureCaptionBlockNumber === 'number'
				? { pdfFigureCaptionBlockNumber }
				: {}),
			...(pdfFigureLabel ? { pdfFigureLabel } : {}),
			...(pdfSemanticRole ? { pdfSemanticRole } : {}),
			...(typeof pdfTableBodyRowEnd === 'number'
				? { pdfTableBodyRowEnd }
				: {}),
			...(typeof pdfTableBodyRowCount === 'number'
				? { pdfTableBodyRowCount }
				: {}),
			...(typeof pdfTableBodyRowStart === 'number'
				? { pdfTableBodyRowStart }
				: {}),
			...(pdfTextKind === 'table_like'
				? { pdfTableChunkKind: 'full_table' }
				: {}),
			...(typeof pdfTableColumnCount === 'number'
				? { pdfTableColumnCount }
				: {}),
			...(typeof pdfTableHeaderText === 'string'
				? { pdfTableHeaderText }
				: {}),
			...(Array.isArray(pdfTableHeaders) && pdfTableHeaders.length > 0
				? { pdfTableHeaders }
				: {}),
			...(typeof pdfTableRowCount === 'number'
				? { pdfTableRowCount }
				: {}),
			...(pdfTableSignature ? { pdfTableSignature } : {}),
			pdfTextKind,
			text
		});
	}
	const titleCounts = new Map<string, number>();
	for (const block of blockEntries) {
		titleCounts.set(
			block.baseSectionTitle,
			(titleCounts.get(block.baseSectionTitle) ?? 0) + 1
		);
	}
	const units: StructuredChunkUnit[] = [];

	for (const block of blockEntries) {
		const sectionTitle =
			(titleCounts.get(block.baseSectionTitle) ?? 0) > 1 &&
			typeof block.pdfBlockNumber === 'number'
				? `${block.baseSectionTitle} ${block.pdfBlockNumber}`
				: block.baseSectionTitle;

		units.push({
			pageNumber: block.pageNumber,
			pdfBlockNumber: block.pdfBlockNumber,
			...(typeof block.pdfFigureCaptionBlockNumber === 'number'
				? {
						pdfFigureCaptionBlockNumber:
							block.pdfFigureCaptionBlockNumber
					}
				: {}),
			...(block.pdfFigureLabel
				? { pdfFigureLabel: block.pdfFigureLabel }
				: {}),
			...(block.pdfSemanticRole
				? { pdfSemanticRole: block.pdfSemanticRole }
				: {}),
			...(typeof block.pdfTableBodyRowEnd === 'number'
				? { pdfTableBodyRowEnd: block.pdfTableBodyRowEnd }
				: {}),
			...(typeof block.pdfTableBodyRowCount === 'number'
				? { pdfTableBodyRowCount: block.pdfTableBodyRowCount }
				: {}),
			...(typeof block.pdfTableBodyRowStart === 'number'
				? { pdfTableBodyRowStart: block.pdfTableBodyRowStart }
				: {}),
			...(block.pdfTableChunkKind
				? { pdfTableChunkKind: block.pdfTableChunkKind }
				: {}),
			...(typeof block.pdfTableColumnCount === 'number'
				? { pdfTableColumnCount: block.pdfTableColumnCount }
				: {}),
			...(typeof block.pdfTableHeaderText === 'string'
				? { pdfTableHeaderText: block.pdfTableHeaderText }
				: {}),
			...(Array.isArray(block.pdfTableHeaders) &&
			block.pdfTableHeaders.length > 0
				? { pdfTableHeaders: block.pdfTableHeaders }
				: {}),
			...(typeof block.pdfTableRowCount === 'number'
				? { pdfTableRowCount: block.pdfTableRowCount }
				: {}),
			...(block.pdfTableSignature
				? { pdfTableSignature: block.pdfTableSignature }
				: {}),
			pdfTextKind: block.pdfTextKind,
			preferredChunkUnits:
				block.pdfTextKind === 'table_like'
					? block.text.split('\n').filter(Boolean)
					: undefined,
			sectionDepth: 1,
			sectionKind: 'pdf_block',
			sectionPath: [sectionTitle],
			sectionTitle,
			text: block.text
		});
	}

	return units;
};

const officeNativeStructureUnits = (
	metadata?: Record<string, unknown>
): StructuredChunkUnit[] => {
	const blocks = Array.isArray(metadata?.officeBlocks)
		? metadata.officeBlocks
		: [];
	const units: StructuredChunkUnit[] = [];
	const headingStack: string[] = [];
	const headingFamilyStack: string[] = [];
	const headingOrdinalStack: number[] = [];
	const headingSiblingCounts = new Map<string, number>();
	let pendingListContextText: string | undefined;
	let pendingTableContextText: string | undefined;
	let consumedOfficeUntil = -1;
	const decorateOfficeSectionText = (
		text: string,
		sectionTitle: string | undefined
	) => {
		if (!sectionTitle || text.includes(sectionTitle)) {
			return text;
		}

		return normalizeWhitespace(`${sectionTitle}\n${text}`);
	};
	const getOfficeShortParagraphText = (value: unknown) => {
		if (!value || typeof value !== 'object') {
			return undefined;
		}

		const record = value as Record<string, unknown>;
		if (record.blockKind !== 'paragraph') {
			return undefined;
		}

		const paragraphText =
			typeof record.text === 'string'
				? normalizeWhitespace(record.text)
				: '';
		return paragraphText.length > 0 && paragraphText.length <= 200
			? paragraphText
			: undefined;
	};
	const isOfficeTableHeadingBlock = (value: unknown) => {
		if (!value || typeof value !== 'object') {
			return false;
		}

		const record = value as Record<string, unknown>;
		return (
			record.blockKind === 'heading' &&
			typeof record.text === 'string' &&
			/\btable\b/i.test(record.text)
		);
	};
	const collectOfficeLeadingParagraphTexts = (
		startIndex: number,
		maxParagraphs = 3
	) => {
		const texts: string[] = [];
		let cursor = startIndex;

		while (texts.length < maxParagraphs) {
			const paragraphText = getOfficeShortParagraphText(blocks[cursor]);
			if (!paragraphText) {
				break;
			}
			texts.push(paragraphText);
			cursor += 1;
		}

		return { nextIndex: cursor, texts };
	};
	const hasFollowingOfficeTableFamily = (startIndex: number) => {
		let cursor = startIndex;
		const leadingParagraphs = collectOfficeLeadingParagraphTexts(cursor);
		cursor = leadingParagraphs.nextIndex;

		const sawHeading = isOfficeTableHeadingBlock(blocks[cursor]);
		if (sawHeading) {
			cursor += 1;
		}

		const trailingParagraphs = collectOfficeLeadingParagraphTexts(cursor);
		cursor = trailingParagraphs.nextIndex;

		return (
			(leadingParagraphs.texts.length > 0 ||
				sawHeading ||
				trailingParagraphs.texts.length > 0 ||
				blocks[startIndex]?.blockKind === 'table') &&
			blocks[cursor]?.blockKind === 'table'
		);
	};
	const collectOfficeTrailingTableParagraphTexts = (startIndex: number) => {
		const trailingParagraphs = collectOfficeLeadingParagraphTexts(
			startIndex,
			5
		);
		const nextBlock = blocks[trailingParagraphs.nextIndex];
		const nextKind =
			nextBlock && typeof nextBlock === 'object'
				? nextBlock.blockKind
				: undefined;

		if (
			trailingParagraphs.texts.length === 0 ||
			(nextKind !== 'heading' && nextKind !== 'title' && nextBlock) ||
			(nextBlock && isOfficeTableHeadingBlock(nextBlock))
		) {
			return { nextIndex: startIndex, texts: [] as string[] };
		}

		return trailingParagraphs;
	};

	for (const [index, block] of blocks.entries()) {
		if (index <= consumedOfficeUntil) {
			continue;
		}

		if (!block || typeof block !== 'object') {
			continue;
		}

		const text =
			typeof block.text === 'string'
				? normalizeWhitespace(block.text)
				: '';
		if (!text) {
			continue;
		}

		const officeBlockNumber =
			typeof block.blockNumber === 'number' &&
			Number.isFinite(block.blockNumber)
				? block.blockNumber
				: undefined;
		const officeBlockKind =
			block.blockKind === 'title' ||
			block.blockKind === 'heading' ||
			block.blockKind === 'list' ||
			block.blockKind === 'table'
				? block.blockKind
				: 'paragraph';
		const headingLevel =
			typeof block.headingLevel === 'number' &&
			Number.isFinite(block.headingLevel)
				? block.headingLevel
				: undefined;
		const officeListLevel =
			typeof block.listLevel === 'number' &&
			Number.isFinite(block.listLevel)
				? block.listLevel
				: undefined;
		const officeTableBodyRowCount =
			typeof block.tableBodyRowCount === 'number' &&
			Number.isFinite(block.tableBodyRowCount)
				? block.tableBodyRowCount
				: undefined;
		const officeTableColumnCount =
			typeof block.tableColumnCount === 'number' &&
			Number.isFinite(block.tableColumnCount)
				? block.tableColumnCount
				: undefined;
		const officeTableHeaderText =
			typeof block.tableHeaderText === 'string' &&
			block.tableHeaderText.length > 0
				? block.tableHeaderText
				: undefined;
		const officeTableHeaders =
			Array.isArray(block.tableHeaders) && block.tableHeaders.length > 0
				? block.tableHeaders.filter(
						(value: unknown): value is string =>
							typeof value === 'string' && value.length > 0
					)
				: undefined;
		const officeTableRowCount =
			typeof block.tableRowCount === 'number' &&
			Number.isFinite(block.tableRowCount)
				? block.tableRowCount
				: undefined;
		const officeTableSignature =
			typeof block.tableSignature === 'string' &&
			block.tableSignature.length > 0
				? block.tableSignature
				: undefined;

		if (officeBlockKind === 'title' || officeBlockKind === 'heading') {
			const level = officeBlockKind === 'title' ? 1 : (headingLevel ?? 1);
			const parentScope = headingFamilyStack
				.slice(0, Math.max(0, level - 1))
				.join(' > ');
			const parentOrdinalScope = headingOrdinalStack
				.slice(0, Math.max(0, level - 1))
				.join(' > ');
			const headingKey = `${level}:${parentScope}:${parentOrdinalScope}:${text}`;
			const headingCount =
				(headingSiblingCounts.get(headingKey) ?? 0) + 1;
			headingSiblingCounts.set(headingKey, headingCount);
			const resolvedHeadingText =
				headingCount > 1 ? `${text} (${headingCount})` : text;
			headingStack[level - 1] = resolvedHeadingText;
			headingFamilyStack[level - 1] = text;
			headingOrdinalStack[level - 1] = headingCount;
			headingStack.length = level;
			headingFamilyStack.length = level;
			headingOrdinalStack.length = level;
			const nextBlock = blocks[index + 1];
			const nextKind =
				nextBlock && typeof nextBlock === 'object'
					? nextBlock.blockKind
					: undefined;
			if (
				nextKind === 'title' ||
				nextKind === 'heading' ||
				nextKind === 'list' ||
				nextKind === 'table' ||
				!nextBlock
			) {
				units.push({
					officeBlockKind,
					officeListLevel,
					officeBlockNumber,
					...(typeof officeTableBodyRowCount === 'number'
						? { officeTableBodyRowCount }
						: {}),
					...(typeof officeTableColumnCount === 'number'
						? { officeTableColumnCount }
						: {}),
					...(typeof officeTableHeaderText === 'string'
						? { officeTableHeaderText }
						: {}),
					...(Array.isArray(officeTableHeaders) &&
					officeTableHeaders.length > 0
						? { officeTableHeaders }
						: {}),
					...(typeof officeTableRowCount === 'number'
						? { officeTableRowCount }
						: {}),
					...(typeof officeTableSignature === 'string'
						? { officeTableSignature }
						: {}),
					...(headingFamilyStack.length > 0
						? { officeFamilyPath: [...headingFamilyStack] }
						: {}),
					...(headingOrdinalStack.length > 0
						? { officeOrdinalPath: [...headingOrdinalStack] }
						: {}),
					...(headingFamilyStack.length > 0
						? { sectionFamilyPath: [...headingFamilyStack] }
						: {}),
					...(headingOrdinalStack.length > 0
						? { sectionOrdinalPath: [...headingOrdinalStack] }
						: {}),
					officeSiblingFamilyKey: text,
					officeSiblingOrdinal: headingCount,
					sectionSiblingFamilyKey: text,
					sectionSiblingOrdinal: headingCount,
					sectionDepth: headingStack.length,
					sectionKind: 'office_heading',
					sectionPath: [...headingStack],
					sectionTitle: resolvedHeadingText,
					text
				});
			}
			continue;
		}

		const sectionPath =
			headingStack.length > 0 ? [...headingStack] : undefined;
		const officeFamilyPath =
			headingFamilyStack.length > 0 ? [...headingFamilyStack] : undefined;
		const officeOrdinalPath =
			headingOrdinalStack.length > 0
				? [...headingOrdinalStack]
				: undefined;
		const sectionTitle = sectionPath?.at(-1);

		if (officeBlockKind === 'list') {
			const runTexts: string[] = [];
			const runLevels: number[] = [];
			let runEnd = index;

			for (; runEnd < blocks.length; runEnd += 1) {
				const runBlock = blocks[runEnd];
				if (!runBlock || typeof runBlock !== 'object') {
					break;
				}
				if (runBlock.blockKind !== 'list') {
					break;
				}
				const runText =
					typeof runBlock.text === 'string'
						? normalizeWhitespace(runBlock.text)
						: '';
				if (!runText) {
					break;
				}
				runTexts.push(runText);
				if (
					typeof runBlock.listLevel === 'number' &&
					Number.isFinite(runBlock.listLevel)
				) {
					runLevels.push(runBlock.listLevel);
				}
			}
			runEnd -= 1;

			const trailingBridgeParagraphs = collectOfficeLeadingParagraphTexts(
				runEnd + 1
			);
			const trailingTableBridgeText =
				trailingBridgeParagraphs.texts.length > 0 &&
				hasFollowingOfficeTableFamily(runEnd + 1)
					? normalizeWhitespace(
							trailingBridgeParagraphs.texts.join('\n\n')
						)
					: undefined;
			const officeListContextText = normalizeWhitespace(
				[
					...(typeof pendingListContextText === 'string'
						? [pendingListContextText]
						: []),
					...(typeof trailingTableBridgeText === 'string'
						? [trailingTableBridgeText]
						: [])
				].join('\n\n')
			);
			const distinctLevels = [...new Set(runLevels)];
			const officeListLevel =
				distinctLevels.length === 1 ? distinctLevels[0] : undefined;
			const groupedListText = normalizeWhitespace(
				[
					...(officeListContextText ? [officeListContextText] : []),
					...runTexts
				].join('\n\n')
			);

			if (typeof trailingTableBridgeText === 'string') {
				pendingTableContextText = normalizeWhitespace(
					[
						...(typeof pendingTableContextText === 'string'
							? [pendingTableContextText]
							: []),
						trailingTableBridgeText
					].join('\n\n')
				);
				consumedOfficeUntil = trailingBridgeParagraphs.nextIndex - 1;
			} else {
				consumedOfficeUntil = runEnd;
			}
			pendingListContextText = undefined;

			units.push({
				officeBlockKind,
				...(officeListContextText ? { officeListContextText } : {}),
				officeListGroupItemCount: runTexts.length,
				...(typeof officeListLevel === 'number'
					? { officeListLevel }
					: {}),
				...(distinctLevels.length > 0
					? { officeListLevels: distinctLevels }
					: {}),
				officeBlockNumber,
				...(officeFamilyPath && officeFamilyPath.length > 0
					? { officeFamilyPath }
					: {}),
				...(officeOrdinalPath && officeOrdinalPath.length > 0
					? { officeOrdinalPath }
					: {}),
				...(officeFamilyPath && officeFamilyPath.length > 0
					? { sectionFamilyPath: officeFamilyPath }
					: {}),
				...(officeOrdinalPath && officeOrdinalPath.length > 0
					? { sectionOrdinalPath: officeOrdinalPath }
					: {}),
				...(officeFamilyPath?.at(-1)
					? { officeSiblingFamilyKey: officeFamilyPath.at(-1) }
					: {}),
				...(typeof officeOrdinalPath?.at(-1) === 'number'
					? { officeSiblingOrdinal: officeOrdinalPath.at(-1) }
					: {}),
				...(officeFamilyPath?.at(-1)
					? { sectionSiblingFamilyKey: officeFamilyPath.at(-1) }
					: {}),
				...(typeof officeOrdinalPath?.at(-1) === 'number'
					? { sectionSiblingOrdinal: officeOrdinalPath.at(-1) }
					: {}),
				preferredChunkUnits: [
					...(officeListContextText ? [officeListContextText] : []),
					...runTexts
				],
				sectionDepth: sectionPath?.length,
				sectionKind: 'office_block',
				sectionPath,
				sectionTitle,
				text: groupedListText
			});
			continue;
		}
		const nextBlock = blocks[index + 1];
		const nextKind =
			nextBlock && typeof nextBlock === 'object'
				? nextBlock.blockKind
				: undefined;
		const nextNextBlock = blocks[index + 2];
		const nextNextKind =
			nextNextBlock && typeof nextNextBlock === 'object'
				? nextNextBlock.blockKind
				: undefined;

		if (
			officeBlockKind === 'paragraph' &&
			(nextKind === 'list' ||
				(nextKind === 'paragraph' && nextNextKind === 'list')) &&
			text.length <= 200
		) {
			pendingListContextText = normalizeWhitespace(
				[
					...(typeof pendingListContextText === 'string'
						? [pendingListContextText]
						: []),
					text
				].join('\n\n')
			);
			continue;
		}

		if (
			officeBlockKind === 'paragraph' &&
			hasFollowingOfficeTableFamily(index + 1) &&
			text.length <= 200
		) {
			pendingTableContextText = normalizeWhitespace(
				[
					...(typeof pendingTableContextText === 'string'
						? [pendingTableContextText]
						: []),
					text
				].join('\n\n')
			);
			continue;
		}

		const officeListContextText =
			officeBlockKind === 'list' ? pendingListContextText : undefined;
		const officeTableContextText =
			officeBlockKind === 'table' ? pendingTableContextText : undefined;
		const officeTableFollowUpParagraphs =
			officeBlockKind === 'table'
				? collectOfficeTrailingTableParagraphTexts(index + 1)
				: { nextIndex: index + 1, texts: [] as string[] };
		const officeTableFollowUpText =
			officeBlockKind === 'table' &&
			officeTableFollowUpParagraphs.texts.length > 0
				? normalizeWhitespace(
						officeTableFollowUpParagraphs.texts.join('\n\n')
					)
				: undefined;
		if (officeBlockKind !== 'list' || nextKind !== 'list') {
			pendingListContextText = undefined;
		}
		pendingTableContextText = undefined;
		if (
			officeBlockKind === 'table' &&
			typeof officeTableFollowUpText === 'string'
		) {
			consumedOfficeUntil = officeTableFollowUpParagraphs.nextIndex - 1;
		}

		units.push({
			officeBlockKind,
			officeListLevel,
			officeBlockNumber,
			...(officeFamilyPath && officeFamilyPath.length > 0
				? { officeFamilyPath }
				: {}),
			...(officeOrdinalPath && officeOrdinalPath.length > 0
				? { officeOrdinalPath }
				: {}),
			...(officeFamilyPath && officeFamilyPath.length > 0
				? { sectionFamilyPath: officeFamilyPath }
				: {}),
			...(officeOrdinalPath && officeOrdinalPath.length > 0
				? { sectionOrdinalPath: officeOrdinalPath }
				: {}),
			...(officeFamilyPath?.at(-1)
				? { officeSiblingFamilyKey: officeFamilyPath.at(-1) }
				: {}),
			...(typeof officeOrdinalPath?.at(-1) === 'number'
				? { officeSiblingOrdinal: officeOrdinalPath.at(-1) }
				: {}),
			...(officeFamilyPath?.at(-1)
				? { sectionSiblingFamilyKey: officeFamilyPath.at(-1) }
				: {}),
			...(typeof officeOrdinalPath?.at(-1) === 'number'
				? { sectionSiblingOrdinal: officeOrdinalPath.at(-1) }
				: {}),
			...(typeof officeListContextText === 'string'
				? { officeListContextText }
				: {}),
			...(typeof officeTableContextText === 'string'
				? { officeTableContextText }
				: {}),
			...(typeof officeTableFollowUpText === 'string'
				? { officeTableFollowUpText }
				: {}),
			...(typeof officeTableBodyRowCount === 'number'
				? { officeTableBodyRowCount }
				: {}),
			...(typeof officeTableColumnCount === 'number'
				? { officeTableColumnCount }
				: {}),
			...(typeof officeTableHeaderText === 'string'
				? { officeTableHeaderText }
				: {}),
			...(Array.isArray(officeTableHeaders) &&
			officeTableHeaders.length > 0
				? { officeTableHeaders }
				: {}),
			...(typeof officeTableRowCount === 'number'
				? { officeTableRowCount }
				: {}),
			...(typeof officeTableSignature === 'string'
				? { officeTableSignature }
				: {}),
			preferredChunkUnits:
				officeBlockKind === 'table'
					? [
							...(typeof officeTableContextText === 'string'
								? [officeTableContextText]
								: []),
							...text.split('\n').filter(Boolean),
							...(typeof officeTableFollowUpText === 'string'
								? [officeTableFollowUpText]
								: [])
						]
					: officeBlockKind === 'list'
						? [
								...(typeof officeListContextText === 'string'
									? [officeListContextText]
									: []),
								text
							]
						: undefined,
			sectionDepth: sectionPath?.length,
			sectionKind:
				officeBlockKind === 'paragraph'
					? 'office_heading'
					: 'office_block',
			sectionPath,
			sectionTitle,
			text:
				officeBlockKind === 'table' &&
				typeof officeTableContextText === 'string'
					? normalizeWhitespace(
							[
								officeTableContextText,
								text,
								...(typeof officeTableFollowUpText === 'string'
									? [officeTableFollowUpText]
									: [])
							].join('\n\n')
						)
					: officeBlockKind === 'table' &&
						  typeof officeTableFollowUpText === 'string'
						? normalizeWhitespace(
								`${text}\n\n${officeTableFollowUpText}`
							)
						: officeBlockKind === 'list' &&
							  typeof officeListContextText === 'string'
							? normalizeWhitespace(
									`${officeListContextText}\n\n${text}`
								)
							: officeBlockKind === 'paragraph'
								? decorateOfficeSectionText(text, sectionTitle)
								: text
		});
	}

	return units;
};

const markdownStructureUnits = (value: string): StructuredChunkUnit[] => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	const sections: Array<{ lines: string[]; sectionPath: string[] }> = [];
	let current: string[] = [];
	let currentPath: string[] = [];
	const headingStack: string[] = [];
	const flushCurrentSection = () => {
		if (current.length === 0) {
			return;
		}

		sections.push({
			lines: current,
			sectionPath: [...currentPath]
		});
		current = [];
	};

	for (const line of lines) {
		const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			if (current.length > 0) {
				flushCurrentSection();
			}
			const depth = headingMatch[1]?.length ?? 1;
			const headingText = normalizeWhitespace(headingMatch[2] ?? '');
			if (headingText) {
				headingStack[depth - 1] = headingText;
				headingStack.length = depth;
				currentPath = [...headingStack];
			}
		}

		current.push(line);
	}

	flushCurrentSection();

	return sections
		.map(({ lines: sectionLines, sectionPath }) => {
			const sectionText = normalizeWhitespace(
				stripMarkdown(sectionLines.join('\n'))
			);
			const preferredChunkUnits = splitMarkdownPreferredChunkUnits(
				sectionLines.join('\n')
			);

			return {
				...(preferredChunkUnits.length > 0
					? { preferredChunkUnits }
					: {}),
				sectionDepth:
					sectionPath.length > 0 ? sectionPath.length : undefined,
				sectionKind:
					sectionPath.length > 0
						? ('markdown_heading' as const)
						: undefined,
				sectionPath: sectionPath.length > 0 ? sectionPath : undefined,
				sectionTitle: sectionPath.at(-1),
				text: sectionText
			};
		})
		.filter((section) => Boolean(section.text));
};

const joinHtmlHeadingSection = (headings: string[], content: string) => {
	const normalizedHeadings = headings.map((heading) =>
		normalizeWhitespace(heading)
	);
	const combined = [...normalizedHeadings, content]
		.filter(Boolean)
		.join('\n');

	return normalizeWhitespace(combined);
};

const htmlStructureUnits = (value: string): StructuredChunkUnit[] => {
	const focused = extractMainHtmlContent(value);
	const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	const sections: StructuredChunkUnit[] = [];
	const headingStack: string[] = [];
	let cursor = 0;
	let currentContentStart = 0;
	let activeHeadings: string[] = [];

	const flushSection = (end: number) => {
		const content = normalizeWhitespace(
			stripHtmlTags(focused.slice(currentContentStart, end))
		);
		if (!content) {
			return;
		}

		const section = joinHtmlHeadingSection(activeHeadings, content);
		if (section) {
			sections.push({
				sectionDepth:
					activeHeadings.length > 0
						? activeHeadings.length
						: undefined,
				sectionKind:
					activeHeadings.length > 0 ? 'html_heading' : undefined,
				sectionPath:
					activeHeadings.length > 0 ? [...activeHeadings] : undefined,
				sectionTitle: activeHeadings.at(-1),
				text: section
			});
		}
	};

	for (const match of focused.matchAll(headingPattern)) {
		const fullMatch = match[0];
		const start = match.index ?? cursor;
		flushSection(start);

		const level = Number.parseInt(match[1] ?? '1', 10);
		const headingText = normalizeWhitespace(stripHtmlTags(match[2] ?? ''));
		if (headingText) {
			headingStack[level - 1] = headingText;
			headingStack.length = level;
			activeHeadings = [...headingStack];
		}

		cursor = start + fullMatch.length;
		currentContentStart = cursor;
	}

	flushSection(focused.length);

	if (sections.length > 0) {
		return sections;
	}

	return [{ text: normalizeWhitespace(stripHtmlTags(focused)) }].filter(
		(section) => Boolean(section.text)
	);
};

const isLikelyOfficeHeadingParagraph = (value: string) => {
	const normalized = normalizeWhitespace(value);
	if (!normalized || normalized.length > 80) {
		return false;
	}

	if (/[.!?]$/.test(normalized)) {
		return false;
	}

	const words = normalized.split(/\s+/);
	if (words.length > 8) {
		return false;
	}

	const headingLikeWords = words.filter((word) => {
		const stripped = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
		if (!stripped) {
			return false;
		}

		return /^[A-Z0-9]/.test(stripped);
	}).length;

	return headingLikeWords / words.length >= 0.6;
};

const officeHeadingStructureUnits = (value: string): StructuredChunkUnit[] => {
	const paragraphs = paragraphUnits(value);
	const sections: StructuredChunkUnit[] = [];
	let currentHeading: string | undefined;
	let currentParagraphs: string[] = [];

	const flush = () => {
		if (!currentHeading && currentParagraphs.length === 0) {
			return;
		}

		const text = normalizeWhitespace(
			[currentHeading, ...currentParagraphs].filter(Boolean).join('\n\n')
		);
		if (!text) {
			currentHeading = undefined;
			currentParagraphs = [];
			return;
		}

		sections.push({
			sectionDepth: currentHeading ? 1 : undefined,
			sectionKind: currentHeading ? 'office_heading' : undefined,
			sectionPath: currentHeading ? [currentHeading] : undefined,
			sectionTitle: currentHeading,
			text
		});
		currentHeading = undefined;
		currentParagraphs = [];
	};

	for (const paragraph of paragraphs) {
		if (isLikelyOfficeHeadingParagraph(paragraph)) {
			flush();
			currentHeading = paragraph;
			continue;
		}

		currentParagraphs.push(paragraph);
	}

	flush();

	return sections.length > 0
		? sections
		: [{ text: normalizeWhitespace(value) }];
};

const CODE_FILE_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.py',
	'.go',
	'.java',
	'.rb',
	'.rs',
	'.php'
]);

const isCodeLikeSource = (source?: string) => {
	if (!source) {
		return false;
	}

	return CODE_FILE_EXTENSIONS.has(extname(source).toLowerCase());
};

const countBraceDelta = (value: string) => {
	let delta = 0;
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		const previous = index > 0 ? value[index - 1] : '';
		if (char === "'" && !inDouble && !inTemplate && previous !== '\\') {
			inSingle = !inSingle;
			continue;
		}
		if (char === '"' && !inSingle && !inTemplate && previous !== '\\') {
			inDouble = !inDouble;
			continue;
		}
		if (char === '`' && !inSingle && !inDouble && previous !== '\\') {
			inTemplate = !inTemplate;
			continue;
		}
		if (inSingle || inDouble || inTemplate) {
			continue;
		}
		if (char === '{') {
			delta += 1;
		} else if (char === '}') {
			delta -= 1;
		}
	}

	return delta;
};

const extractCodeSectionTitle = (line: string) => {
	const normalized = line.trim();
	const patterns = [
		/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
		/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
		/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
		/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/,
		/^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/,
		/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/,
		/^(?:export\s+)?let\s+([A-Za-z_$][\w$]*)\s*=/,
		/^(?:export\s+)?var\s+([A-Za-z_$][\w$]*)\s*=/,
		/^import\s+.+?\s+from\s+['"][^'"]+['"]/,
		/^export\s+\{.+\}/
	];

	for (const pattern of patterns) {
		const match = normalized.match(pattern);
		if (!match) {
			continue;
		}
		if (match[1]) {
			return match[1];
		}
		return normalized;
	}

	return undefined;
};

const codeStructureUnits = (value: string): StructuredChunkUnit[] => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	const units: StructuredChunkUnit[] = [];
	let currentLines: string[] = [];
	let currentTitle: string | undefined;
	let braceDepth = 0;

	const flush = () => {
		const raw = currentLines.join('\n').trim();
		if (!raw) {
			currentLines = [];
			currentTitle = undefined;
			braceDepth = 0;
			return;
		}

		const preferredChunkUnits = raw
			.split(/\n{2,}/)
			.map((entry) => entry.trim())
			.filter(Boolean);
		units.push({
			...(preferredChunkUnits.length > 0 ? { preferredChunkUnits } : {}),
			sectionDepth: 1,
			sectionKind: 'code_block',
			...(currentTitle
				? {
						sectionPath: [currentTitle],
						sectionTitle: currentTitle
					}
				: {}),
			text: raw
		});
		currentLines = [];
		currentTitle = undefined;
		braceDepth = 0;
	};

	for (const line of lines) {
		const trimmed = line.trim();
		const nextTitle =
			braceDepth <= 0 ? extractCodeSectionTitle(trimmed) : undefined;
		if (nextTitle && currentLines.length > 0) {
			flush();
		}

		if (!currentTitle && nextTitle) {
			currentTitle = nextTitle;
		}

		currentLines.push(line);
		braceDepth += countBraceDelta(line);
		if (braceDepth < 0) {
			braceDepth = 0;
		}
	}

	flush();

	return units.length > 0
		? units
		: [{ sectionDepth: 1, sectionKind: 'code_block', text: value.trim() }];
};

const spreadsheetStructureUnits = (
	value: string,
	metadata?: Record<string, unknown>
): StructuredChunkUnit[] => {
	const lines = value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	if (lines.length === 0) {
		return [];
	}

	const sheetName =
		(typeof metadata?.sheetName === 'string' && metadata.sheetName) ||
		lines[0]!.replace(/^Sheet\s+/i, '');
	const spreadsheetHeaders = Array.isArray(metadata?.sheetHeaders)
		? metadata.sheetHeaders.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const spreadsheetColumnStart =
		typeof metadata?.sheetColumnStart === 'string' &&
		metadata.sheetColumnStart.trim().length > 0
			? metadata.sheetColumnStart.trim().toUpperCase()
			: undefined;
	const spreadsheetColumnEnd =
		typeof metadata?.sheetColumnEnd === 'string' &&
		metadata.sheetColumnEnd.trim().length > 0
			? metadata.sheetColumnEnd.trim().toUpperCase()
			: undefined;
	const repeatedHeaderRowNumbers = Array.isArray(
		metadata?.repeatedHeaderRowNumbers
	)
		? metadata.repeatedHeaderRowNumbers.filter(
				(value): value is number =>
					typeof value === 'number' && Number.isFinite(value)
			)
		: [];
	const spreadsheetTableCount =
		typeof metadata?.sheetTableCount === 'number' &&
		Number.isFinite(metadata.sheetTableCount)
			? metadata.sheetTableCount
			: Math.max(repeatedHeaderRowNumbers.length + 1, 1);
	const sheetTableColumnRanges = Array.isArray(
		metadata?.sheetTableColumnRanges
	)
		? metadata.sheetTableColumnRanges.filter(
				(value): value is SpreadsheetTableColumnRange =>
					Boolean(value) &&
					typeof value === 'object' &&
					typeof value.tableIndex === 'number' &&
					Number.isFinite(value.tableIndex)
			)
		: [];
	const sheetTableHeaders = Array.isArray(metadata?.sheetTableHeaders)
		? metadata.sheetTableHeaders.filter(
				(value): value is SpreadsheetTableHeaders =>
					Boolean(value) &&
					typeof value === 'object' &&
					typeof value.tableIndex === 'number' &&
					Number.isFinite(value.tableIndex) &&
					Array.isArray(value.spreadsheetHeaders)
			)
		: [];
	const rowLines = lines.filter((line) => /^Row \d+\./.test(line));
	if (rowLines.length === 0) {
		return [
			{
				sectionDepth: 1,
				sectionKind: 'spreadsheet_rows',
				sectionFamilyPath: [sheetName, 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 1],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 1,
				...(spreadsheetHeaders.length > 0
					? { spreadsheetHeaders }
					: {}),
				...(typeof spreadsheetColumnStart === 'string'
					? { spreadsheetColumnStart }
					: {}),
				...(typeof spreadsheetColumnEnd === 'string'
					? { spreadsheetColumnEnd }
					: {}),
				...(spreadsheetTableCount > 1
					? { spreadsheetTableCount, spreadsheetTableIndex: 1 }
					: {}),
				sectionPath: [sheetName],
				sectionTitle: sheetName,
				text: normalizeWhitespace(lines.join('\n'))
			}
		];
	}

	const tableSegments: { rows: string[]; tableIndex: number }[] = [];
	let currentTableRows: string[] = [];
	let tableIndex = 1;
	for (const row of rowLines) {
		const rowNumber = Number(row.match(/^Row (\d+)\./)?.[1] ?? NaN);
		if (
			currentTableRows.length > 0 &&
			Number.isFinite(rowNumber) &&
			repeatedHeaderRowNumbers.includes(rowNumber)
		) {
			tableSegments.push({ rows: currentTableRows, tableIndex });
			currentTableRows = [row];
			tableIndex += 1;
			continue;
		}

		currentTableRows.push(row);
	}
	if (currentTableRows.length > 0) {
		tableSegments.push({ rows: currentTableRows, tableIndex });
	}

	const groups: Array<{
		rows: string[];
		tableIndex: number;
	}> = [];
	for (const segment of tableSegments) {
		let current: string[] = [];
		for (const row of segment.rows) {
			const candidate = [...current, row].join('\n');
			if (
				current.length > 0 &&
				candidate.length > DEFAULT_MAX_CHUNK_LENGTH
			) {
				groups.push({ rows: current, tableIndex: segment.tableIndex });
				current = [row];
				continue;
			}

			current.push(row);
		}
		if (current.length > 0) {
			groups.push({ rows: current, tableIndex: segment.tableIndex });
		}
	}

	return groups.map(({ rows, tableIndex }) => {
		const rowNumbers = rows
			.map((row) => Number(row.match(/^Row (\d+)\./)?.[1] ?? NaN))
			.filter((value) => Number.isFinite(value));
		const tableColumnRange = sheetTableColumnRanges.find(
			(entry) => entry.tableIndex === tableIndex
		);
		const tableHeaders = sheetTableHeaders.find(
			(entry) => entry.tableIndex === tableIndex
		);
		const tableSpreadsheetColumnStart =
			typeof tableColumnRange?.spreadsheetColumnStart === 'string'
				? tableColumnRange.spreadsheetColumnStart
				: spreadsheetColumnStart;
		const tableSpreadsheetColumnEnd =
			typeof tableColumnRange?.spreadsheetColumnEnd === 'string'
				? tableColumnRange.spreadsheetColumnEnd
				: spreadsheetColumnEnd;
		const tableSpreadsheetHeaders =
			Array.isArray(tableHeaders?.spreadsheetHeaders) &&
			tableHeaders.spreadsheetHeaders.length > 0
				? tableHeaders.spreadsheetHeaders
				: spreadsheetHeaders;

		return {
			preferredChunkUnits: rows,
			sectionDepth: 1,
			sectionKind: 'spreadsheet_rows' as const,
			sectionFamilyPath: [sheetName, 'Spreadsheet Table'],
			sectionOrdinalPath: [1, tableIndex],
			sectionSiblingFamilyKey: 'Spreadsheet Table',
			sectionSiblingOrdinal: tableIndex,
			sectionPath: [sheetName],
			sectionTitle: sheetName,
			...(tableSpreadsheetHeaders.length > 0
				? { spreadsheetHeaders: tableSpreadsheetHeaders }
				: {}),
			...(typeof tableSpreadsheetColumnStart === 'string'
				? { spreadsheetColumnStart: tableSpreadsheetColumnStart }
				: {}),
			...(typeof tableSpreadsheetColumnEnd === 'string'
				? { spreadsheetColumnEnd: tableSpreadsheetColumnEnd }
				: {}),
			...(spreadsheetTableCount > 1
				? { spreadsheetTableCount, spreadsheetTableIndex: tableIndex }
				: {}),
			...(rowNumbers.length > 0
				? {
						spreadsheetRowEnd: rowNumbers[rowNumbers.length - 1],
						spreadsheetRowStart: rowNumbers[0]
					}
				: {}),
			text: normalizeWhitespace(
				[`Sheet ${sheetName}`, ...rows].join('\n')
			)
		};
	});
};

const presentationStructureUnits = (
	value: string,
	metadata?: Record<string, unknown>
): StructuredChunkUnit[] => {
	const slideNumber =
		typeof metadata?.slideNumber === 'number'
			? metadata.slideNumber
			: typeof metadata?.slideIndex === 'number'
				? metadata.slideIndex + 1
				: undefined;
	const slideTitle =
		typeof metadata?.slideTitle === 'string' && metadata.slideTitle.trim()
			? metadata.slideTitle.trim()
			: undefined;
	const slideBodyText =
		typeof metadata?.slideBodyText === 'string' &&
		metadata.slideBodyText.trim()
			? metadata.slideBodyText.trim()
			: undefined;
	const slideNotesText =
		typeof metadata?.slideNotesText === 'string' &&
		metadata.slideNotesText.trim()
			? metadata.slideNotesText.trim()
			: undefined;
	const slideLabel =
		slideTitle || (slideNumber ? `Slide ${slideNumber}` : 'Slide');
	const paragraphs = [
		slideTitle,
		slideBodyText,
		slideNotesText ? `Speaker notes: ${slideNotesText}` : undefined
	]
		.filter((entry): entry is string => Boolean(entry))
		.flatMap((entry) => paragraphUnits(entry));

	return [
		{
			preferredChunkUnits: paragraphs,
			sectionDepth: 1,
			sectionKind: 'presentation_slide',
			sectionFamilyPath: [slideTitle || 'Slide'],
			sectionOrdinalPath: [slideNumber ?? 1],
			sectionSiblingFamilyKey: slideTitle || 'Slide',
			sectionSiblingOrdinal: slideNumber ?? 1,
			sectionPath: [slideLabel],
			sectionTitle: slideLabel,
			text: normalizeWhitespace([slideLabel, ...paragraphs].join('\n\n'))
		}
	];
};

const emailStructureUnits = (
	value: string,
	metadata?: Record<string, unknown>
): StructuredChunkUnit[] => {
	const emailKind =
		typeof metadata?.emailKind === 'string'
			? metadata.emailKind
			: undefined;
	if (emailKind !== 'message') {
		return [];
	}

	const threadTopic =
		typeof metadata?.threadTopic === 'string' && metadata.threadTopic.trim()
			? metadata.threadTopic.trim()
			: undefined;
	const from =
		typeof metadata?.from === 'string' && metadata.from.trim()
			? metadata.from.trim()
			: undefined;
	const sections = Array.isArray(metadata?.emailBodySections)
		? metadata.emailBodySections
		: [];
	const normalizedSections: EmailBodySection[] = sections
		.map((section) => {
			if (!section || typeof section !== 'object') {
				return undefined;
			}
			const kind =
				section.kind === 'authored_text' ||
				section.kind === 'forwarded_headers' ||
				section.kind === 'quoted_history'
					? section.kind
					: undefined;
			const text =
				typeof section.text === 'string'
					? normalizeWhitespace(section.text)
					: '';
			if (!kind || !text) {
				return undefined;
			}
			return {
				...(Array.isArray(section.forwardedBccAddresses) &&
				section.forwardedBccAddresses.length > 0
					? { forwardedBccAddresses: section.forwardedBccAddresses }
					: {}),
				...(Array.isArray(section.forwardedCcAddresses) &&
				section.forwardedCcAddresses.length > 0
					? { forwardedCcAddresses: section.forwardedCcAddresses }
					: {}),
				...(typeof section.forwardedDate === 'string'
					? { forwardedDate: section.forwardedDate }
					: {}),
				...(typeof section.forwardedFromAddress === 'string'
					? { forwardedFromAddress: section.forwardedFromAddress }
					: {}),
				...(typeof section.forwardedFromDisplayName === 'string'
					? {
							forwardedFromDisplayName:
								section.forwardedFromDisplayName
						}
					: {}),
				...(section.forwardedHeaderFields &&
				typeof section.forwardedHeaderFields === 'object'
					? {
							forwardedHeaderFields:
								section.forwardedHeaderFields as Record<
									string,
									string
								>
						}
					: {}),
				...(Array.isArray(section.forwardedParticipantAddresses) &&
				section.forwardedParticipantAddresses.length > 0
					? {
							forwardedParticipantAddresses:
								section.forwardedParticipantAddresses
						}
					: {}),
				...(Array.isArray(section.forwardedReplyToAddresses) &&
				section.forwardedReplyToAddresses.length > 0
					? {
							forwardedReplyToAddresses:
								section.forwardedReplyToAddresses
						}
					: {}),
				...(typeof section.forwardedSubject === 'string'
					? { forwardedSubject: section.forwardedSubject }
					: {}),
				...(typeof section.forwardedTimestamp === 'string'
					? { forwardedTimestamp: section.forwardedTimestamp }
					: {}),
				...(Array.isArray(section.forwardedToAddresses) &&
				section.forwardedToAddresses.length > 0
					? { forwardedToAddresses: section.forwardedToAddresses }
					: {}),
				...(typeof section.quotedDepth === 'number'
					? { quotedDepth: section.quotedDepth }
					: {}),
				kind,
				text
			};
		})
		.filter((section): section is EmailBodySection => Boolean(section));
	if (normalizedSections.length === 0) {
		return [];
	}

	const labelForSection = (kind: EmailBodySection['kind']) => {
		switch (kind) {
			case 'authored_text':
				return 'Authored Text';
			case 'forwarded_headers':
				return 'Forwarded Headers';
			case 'quoted_history':
				return 'Quoted History';
		}
	};

	const familyKeyBase = threadTopic || from || 'Email Message';
	const pathRoot =
		threadTopic || (from ? `Message from ${from}` : 'Email Message');
	const forwardedChainCount = normalizedSections.filter(
		(section) => section.kind === 'forwarded_headers'
	).length;
	let forwardedOrdinal = 0;

	return normalizedSections.map((section, index) => {
		const sectionTitle = labelForSection(section.kind);
		const sectionForwardedOrdinal =
			section.kind === 'forwarded_headers'
				? (forwardedOrdinal += 1)
				: undefined;
		return {
			...(Array.isArray(section.forwardedBccAddresses) &&
			section.forwardedBccAddresses.length > 0
				? {
						emailForwardedBccAddresses:
							section.forwardedBccAddresses
					}
				: {}),
			...(Array.isArray(section.forwardedCcAddresses) &&
			section.forwardedCcAddresses.length > 0
				? {
						emailForwardedCcAddresses: section.forwardedCcAddresses
					}
				: {}),
			...(typeof section.forwardedDate === 'string'
				? { emailForwardedDate: section.forwardedDate }
				: {}),
			...(typeof section.forwardedFromAddress === 'string'
				? {
						emailForwardedFromAddress: section.forwardedFromAddress
					}
				: {}),
			...(typeof section.forwardedFromDisplayName === 'string'
				? {
						emailForwardedFromDisplayName:
							section.forwardedFromDisplayName
					}
				: {}),
			...(typeof sectionForwardedOrdinal === 'number'
				? { emailForwardedChainCount: forwardedChainCount }
				: {}),
			...(typeof section.quotedDepth === 'number'
				? { emailQuotedDepth: section.quotedDepth }
				: {}),
			...(section.forwardedHeaderFields
				? { emailForwardedHeaderFields: section.forwardedHeaderFields }
				: {}),
			...(Array.isArray(section.forwardedParticipantAddresses) &&
			section.forwardedParticipantAddresses.length > 0
				? {
						emailForwardedParticipantAddresses:
							section.forwardedParticipantAddresses
					}
				: {}),
			...(Array.isArray(section.forwardedReplyToAddresses) &&
			section.forwardedReplyToAddresses.length > 0
				? {
						emailForwardedReplyToAddresses:
							section.forwardedReplyToAddresses
					}
				: {}),
			...(typeof section.forwardedSubject === 'string'
				? { emailForwardedSubject: section.forwardedSubject }
				: {}),
			...(typeof section.forwardedTimestamp === 'string'
				? { emailForwardedTimestamp: section.forwardedTimestamp }
				: {}),
			...(Array.isArray(section.forwardedToAddresses) &&
			section.forwardedToAddresses.length > 0
				? {
						emailForwardedToAddresses: section.forwardedToAddresses
					}
				: {}),
			...(typeof sectionForwardedOrdinal === 'number'
				? { emailForwardedOrdinal: sectionForwardedOrdinal }
				: {}),
			emailSectionKind: section.kind,
			preferredChunkUnits: paragraphUnits(section.text),
			sectionDepth: 1,
			sectionKind: 'email_block',
			sectionFamilyPath: [familyKeyBase, section.kind],
			sectionOrdinalPath: [1, index + 1],
			sectionSiblingFamilyKey: section.kind,
			sectionSiblingOrdinal: index + 1,
			sectionPath: [pathRoot, sectionTitle],
			sectionTitle,
			text: normalizeWhitespace(`${sectionTitle}\n${section.text}`)
		};
	});
};

const inferFormat = (document: RAGIngestDocument) => {
	if (document.format) {
		return document.format;
	}

	const source = document.source?.toLowerCase() ?? '';
	if (source.endsWith('.jsonl') || source.endsWith('.ndjson')) {
		return 'jsonl';
	}
	if (source.endsWith('.xml')) {
		return 'xml';
	}
	if (source.endsWith('.yaml') || source.endsWith('.yml')) {
		return 'yaml';
	}
	if (source.endsWith('.csv')) {
		return 'csv';
	}
	if (source.endsWith('.tsv')) {
		return 'tsv';
	}
	if (source.endsWith('.md') || source.endsWith('.mdx')) {
		return 'markdown';
	}
	if (source.endsWith('.html') || source.endsWith('.htm')) {
		return 'html';
	}

	return 'text';
};

const normalizeDocumentText = (text: string, format: RAGContentFormat) => {
	switch (format) {
		case 'html':
			return stripHtml(text);
		case 'xml':
			return normalizeWhitespace(stripHtmlTags(text));
		case 'jsonl':
		case 'tsv':
		case 'csv':
		case 'yaml':
			return normalizeWhitespace(
				text
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
					.join('\n\n')
			);
		case 'markdown':
			return stripMarkdown(text);
		case 'text':
		default:
			return normalizeWhitespace(text);
	}
};

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, RAG_DOCUMENT_SLUG_MAX_LENGTH) || 'document';

const inferFormatFromPath = (path: string) => {
	const extension = extname(path).toLowerCase();
	if (extension === '.jsonl' || extension === '.ndjson') {
		return 'jsonl';
	}
	if (extension === '.xml') {
		return 'xml';
	}
	if (extension === '.yaml' || extension === '.yml') {
		return 'yaml';
	}
	if (extension === '.csv') {
		return 'csv';
	}
	if (extension === '.tsv') {
		return 'tsv';
	}
	if (extension === '.md' || extension === '.mdx') {
		return 'markdown';
	}
	if (extension === '.html' || extension === '.htm') {
		return 'html';
	}

	return 'text';
};

const inferFormatFromUrl = (input: string) => {
	try {
		return inferFormatFromPath(new URL(input).pathname);
	} catch {
		return 'text';
	}
};

const inferFormatFromName = (value: string | undefined) => {
	if (!value) {
		return 'text';
	}

	return inferFormatFromPath(value);
};

const inferFormatFromContentType = (contentType: string | null) => {
	const normalizedType = (contentType || '').toLowerCase();
	if (normalizedType.includes('xml')) {
		return 'xml';
	}
	if (normalizedType.includes('yaml') || normalizedType.includes('yml')) {
		return 'yaml';
	}
	if (
		normalizedType.includes('text/csv') ||
		normalizedType.includes('application/csv') ||
		normalizedType.includes('comma-separated-values')
	) {
		return 'csv';
	}
	if (
		normalizedType.includes('tab-separated-values') ||
		normalizedType.includes('text/tsv') ||
		normalizedType.includes('text/tab-separated-values')
	) {
		return 'tsv';
	}
	if (
		normalizedType.includes('x-ndjson') ||
		normalizedType.includes('ndjson') ||
		normalizedType.includes('jsonl')
	) {
		return 'jsonl';
	}
	if (normalizedType.includes('text/markdown')) {
		return 'markdown';
	}
	if (normalizedType.includes('text/html')) {
		return 'html';
	}
	if (
		normalizedType.startsWith('text/') ||
		normalizedType.includes('json') ||
		normalizedType.includes('xml') ||
		normalizedType.includes('yaml')
	) {
		return 'text';
	}

	return undefined;
};

const formatJSONLValue = (value: unknown, prefix?: string): string[] => {
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return prefix ? [`${prefix}: []`] : ['[]'];
		}

		const primitiveValues = value.filter(
			(entry) =>
				entry === null ||
				typeof entry === 'string' ||
				typeof entry === 'number' ||
				typeof entry === 'boolean'
		);
		if (primitiveValues.length === value.length) {
			const joined = primitiveValues
				.map((entry) => String(entry))
				.join(', ');
			return prefix ? [`${prefix}: ${joined}`] : [joined];
		}

		return value.flatMap((entry, index) =>
			formatJSONLValue(
				entry,
				prefix ? `${prefix}[${index + 1}]` : `[${index + 1}]`
			)
		);
	}

	if (value && typeof value === 'object') {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			return prefix ? [`${prefix}: {}`] : ['{}'];
		}

		return entries.flatMap(([key, entryValue]) =>
			formatJSONLValue(entryValue, prefix ? `${prefix}.${key}` : key)
		);
	}

	const rendered =
		value === null
			? 'null'
			: typeof value === 'string'
				? value
				: typeof value === 'number' || typeof value === 'boolean'
					? String(value)
					: '';
	if (!rendered) {
		return [];
	}

	return prefix ? [`${prefix}: ${rendered}`] : [rendered];
};

const jsonlStructureUnits = (value: string): StructuredChunkUnit[] => {
	const units: StructuredChunkUnit[] = [];
	const lines = value.split('\n');

	for (const [index, line] of lines.entries()) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		let text = trimmed;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			const formatted = formatJSONLValue(parsed);
			if (formatted.length > 0) {
				text = normalizeWhitespace(formatted.join('\n'));
			}
		} catch {
			text = normalizeWhitespace(trimmed);
		}

		if (!text) {
			continue;
		}

		const recordLabel = `Record ${units.length + 1}`;
		units.push({
			preferredChunkUnits: text.split('\n').filter(Boolean),
			sectionDepth: 1,
			sectionKind: 'jsonl_record',
			sectionPath: [recordLabel],
			sectionTitle: recordLabel,
			sourceAwareChunkReason: 'source_native_unit',
			text: normalizeWhitespace(`${recordLabel}.\n${text}`)
		});
	}

	return units;
};

const parseDelimitedLine = (line: string, delimiter: string) => {
	const cells: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = index + 1 < line.length ? line[index + 1] : '';
		if (char === '"') {
			if (inQuotes && next === '"') {
				current += '"';
				index += 1;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (char === delimiter && !inQuotes) {
			cells.push(current.trim());
			current = '';
			continue;
		}
		current += char;
	}

	cells.push(current.trim());
	return cells;
};

const formatDelimitedValue = (headers: string[], cells: string[]) => {
	const pairs = cells
		.map((value, index) => {
			const normalizedValue = normalizeWhitespace(value);
			if (!normalizedValue) {
				return undefined;
			}

			const header = normalizeWhitespace(headers[index] ?? '');
			return header
				? `${header}: ${normalizedValue}`
				: `${String.fromCharCode(65 + index)}: ${normalizedValue}`;
		})
		.filter((value): value is string => Boolean(value));

	return pairs.length > 0 ? pairs.join(' | ') : undefined;
};

const delimitedStructureUnits = ({
	delimiter,
	rowKind,
	value
}: {
	delimiter: string;
	rowKind: 'tsv_row' | 'csv_row';
	value: string;
}): StructuredChunkUnit[] => {
	const lines = value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return [];
	}

	const headers = parseDelimitedLine(lines[0] ?? '', delimiter).map((entry) =>
		normalizeWhitespace(entry)
	);
	const dataLines =
		headers.length > 0 && lines.length > 1 ? lines.slice(1) : lines;
	const units: StructuredChunkUnit[] = [];

	for (const [index, line] of dataLines.entries()) {
		const cells = parseDelimitedLine(line, delimiter);
		const rowText = formatDelimitedValue(headers, cells);
		if (!rowText) {
			continue;
		}

		const rowLabel = `Row ${index + 1}`;
		units.push({
			preferredChunkUnits: rowText.split(' | '),
			sectionDepth: 1,
			sectionKind: rowKind,
			sectionPath: [rowLabel],
			sectionTitle: rowLabel,
			sourceAwareChunkReason: 'source_native_unit',
			text: normalizeWhitespace(`${rowLabel}.\n${rowText}`)
		});
	}

	return units;
};

const tsvStructureUnits = (value: string) =>
	delimitedStructureUnits({
		delimiter: '\t',
		rowKind: 'tsv_row',
		value
	});

const csvStructureUnits = (value: string) =>
	delimitedStructureUnits({
		delimiter: ',',
		rowKind: 'csv_row',
		value
	});

const xmlStructureUnits = (value: string): StructuredChunkUnit[] => {
	const normalized = value.replace(/\r\n?/g, '\n');
	const units: StructuredChunkUnit[] = [];
	const body = normalized
		.replace(/<\?xml[\s\S]*?\?>/gi, '')
		.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
		.trim();

	const rootMatch = body.match(
		/^<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*)<\/\1>$/
	);
	const inner = rootMatch?.[2] ?? body;
	const nodePattern =
		/<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>|<([A-Za-z_][\w:.-]*)\b[^>]*\/>/g;

	for (const match of inner.matchAll(nodePattern)) {
		const tagName = match[1] ?? match[3];
		if (!tagName) {
			continue;
		}
		const raw = match[0] ?? '';
		const text = normalizeWhitespace(stripHtmlTags(raw));
		if (!text) {
			continue;
		}

		const label = tagName.replace(/^.*:/, '');
		units.push({
			preferredChunkUnits: text.split('\n').filter(Boolean),
			sectionDepth: 1,
			sectionKind: 'xml_node',
			sectionPath: [label],
			sectionTitle: label,
			sourceAwareChunkReason: 'source_native_unit',
			text: normalizeWhitespace(`${label}\n${text}`)
		});
	}

	return units;
};

const yamlStructureUnits = (value: string): StructuredChunkUnit[] => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	const units: StructuredChunkUnit[] = [];
	let currentTitle: string | undefined;
	let currentLines: string[] = [];

	const flush = () => {
		if (!currentTitle && currentLines.length === 0) {
			return;
		}
		const text = normalizeWhitespace(currentLines.join('\n'));
		if (!text) {
			currentTitle = undefined;
			currentLines = [];
			return;
		}
		const title = currentTitle ?? `Section ${units.length + 1}`;
		units.push({
			preferredChunkUnits: currentLines
				.map((entry) => normalizeWhitespace(entry))
				.filter(Boolean),
			sectionDepth: 1,
			sectionKind: 'yaml_section',
			sectionPath: [title],
			sectionTitle: title,
			sourceAwareChunkReason: 'source_native_unit',
			text: normalizeWhitespace(`${title}\n${text}`)
		});
		currentTitle = undefined;
		currentLines = [];
	};

	for (const line of lines) {
		if (!line.trim() || line.trim().startsWith('#')) {
			continue;
		}
		const topLevelKey = line.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
		const topLevelList = line.match(/^-+\s+(.+)$/);
		if (topLevelKey && !line.startsWith(' ')) {
			flush();
			currentTitle = normalizeWhitespace(topLevelKey[1] ?? '');
			currentLines = [line];
			continue;
		}
		if (topLevelList && !line.startsWith(' ')) {
			if (!currentTitle) {
				currentTitle = 'items';
			}
			currentLines.push(line);
			continue;
		}
		currentLines.push(line);
	}

	flush();
	return units;
};

const validateJSONLText = (value: string) => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	for (const [index, line] of lines.entries()) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			JSON.parse(trimmed);
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : String(error);
			throw new Error(
				`AbsoluteJS detected malformed JSONL at line ${index + 1}: ${reason}`
			);
		}
	}
};

const validateDelimitedText = (
	value: string,
	formatLabel: 'CSV' | 'TSV',
	delimiter: string
) => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) {
			continue;
		}
		let inQuotes = false;
		for (
			let characterIndex = 0;
			characterIndex < line.length;
			characterIndex += 1
		) {
			const char = line[characterIndex];
			const next =
				characterIndex + 1 < line.length
					? line[characterIndex + 1]
					: '';
			if (char === '"') {
				if (inQuotes && next === '"') {
					characterIndex += 1;
					continue;
				}
				inQuotes = !inQuotes;
				continue;
			}
			if (char === delimiter && !inQuotes) {
				continue;
			}
		}
		if (inQuotes) {
			throw new Error(
				`AbsoluteJS detected malformed ${formatLabel} at line ${index + 1}: unclosed quoted field`
			);
		}
	}
};

const validateXMLText = (value: string) => {
	const normalized = value
		.replace(/<\?xml[\s\S]*?\?>/gi, '')
		.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	const tokenPattern = /<\/?([A-Za-z_][\w:.-]*)\b[^>]*\/?>/g;
	const stack: string[] = [];

	for (const match of normalized.matchAll(tokenPattern)) {
		const token = match[0] ?? '';
		const name = match[1] ?? '';
		if (!name) {
			continue;
		}
		const selfClosing =
			token.endsWith('/>') ||
			token.startsWith('<?') ||
			token.startsWith('<!');
		if (selfClosing) {
			continue;
		}
		if (token.startsWith('</')) {
			const expected = stack.pop();
			if (expected !== name) {
				throw new Error(
					`AbsoluteJS detected malformed XML: expected closing tag for <${expected ?? 'none'}> but found </${name}>`
				);
			}
			continue;
		}
		stack.push(name);
	}

	if (stack.length > 0) {
		throw new Error(
			`AbsoluteJS detected malformed XML: unclosed tag <${stack[stack.length - 1]}>`
		);
	}
};

const validateYAMLText = (value: string) => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	let seenTopLevelKey = false;

	for (const [index, line] of lines.entries()) {
		if (!line.trim() || line.trim().startsWith('#')) {
			continue;
		}
		if (/^\t+/.test(line)) {
			throw new Error(
				`AbsoluteJS detected malformed YAML at line ${index + 1}: tab indentation is not supported`
			);
		}
		if (/^\s+/.test(line) && !seenTopLevelKey) {
			throw new Error(
				`AbsoluteJS detected malformed YAML at line ${index + 1}: nested content appears before any top-level key`
			);
		}
		if (/^[A-Za-z0-9_.-]+:\s*(.*)?$/.test(line)) {
			seenTopLevelKey = true;
		}
	}
};

const validateStructuredTextInput = (
	value: string,
	format: RAGContentFormat
) => {
	switch (format) {
		case 'jsonl':
			validateJSONLText(value);
			return;
		case 'csv':
			validateDelimitedText(value, 'CSV', ',');
			return;
		case 'tsv':
			validateDelimitedText(value, 'TSV', '\t');
			return;
		case 'xml':
			validateXMLText(value);
			return;
		case 'yaml':
			validateYAMLText(value);
			return;
		default:
			return;
	}
};

const decodeUploadContent = (input: RAGDocumentUploadInput) => {
	if (input.encoding === 'base64') {
		return Buffer.from(input.content, 'base64');
	}

	return Buffer.from(input.content, 'utf8');
};

const inferNameFromInput = (input: {
	path?: string;
	name?: string;
	source?: string;
	title?: string;
}) =>
	input.name ??
	input.path?.split(/[\\/]/).at(-1) ??
	input.source?.split('/').at(-1) ??
	input.title ??
	DEFAULT_BINARY_NAME;

const inferExtensionFromInput = (input: {
	path?: string;
	name?: string;
	source?: string;
}) => {
	const candidate = input.path ?? input.name ?? input.source ?? '';

	return extname(candidate).toLowerCase();
};

const isLikelyTextData = (data: Uint8Array) => {
	if (data.length === 0) {
		return true;
	}

	const sample = data.subarray(0, Math.min(512, data.length));
	let suspicious = 0;
	for (const byte of sample) {
		if (byte === 9 || byte === 10 || byte === 13) {
			continue;
		}

		if (byte < 32 || byte === 127) {
			suspicious += 1;
		}
	}

	return suspicious / sample.length < 0.1;
};

const decodePdfLiteral = (value: string) =>
	value
		.replace(/\\([\\()])/g, '$1')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t')
		.replace(/\\b/g, '\b')
		.replace(/\\f/g, '\f')
		.replace(/\\([0-7]{1,3})/g, (_match, octal: string) =>
			String.fromCharCode(parseInt(octal, 8))
		);

const PDF_TABLE_GAP_THRESHOLD = 120;

const extractPdfArrayText = (value: string) => {
	const parts: string[] = [];
	const tokenPattern = /\(((?:\\.|[^\\)])*)\)|([-+]?\d*\.?\d+)/g;
	let pendingColumnGap = false;

	for (const match of value.matchAll(tokenPattern)) {
		if (match[1] !== undefined) {
			const decoded = decodePdfLiteral(match[1]);
			if (
				pendingColumnGap &&
				decoded &&
				!/^\s/.test(decoded) &&
				parts.at(-1) !== ' | '
			) {
				parts.push(' | ');
			}

			parts.push(decoded);
			pendingColumnGap = false;
			continue;
		}

		const gap = Number(match[2]);
		if (Number.isFinite(gap) && gap >= PDF_TABLE_GAP_THRESHOLD) {
			pendingColumnGap = true;
		}
	}

	return normalizeWhitespace(parts.join(''))
		.replace(/\s+\|\s+/g, ' | ')
		.trim();
};

const appendPdfText = (parts: string[], value: string) => {
	if (!value) {
		return;
	}

	parts.push(value);
};

const appendPdfLineBreak = (parts: string[]) => {
	const last = parts.at(-1);
	if (!last || last.endsWith('\n')) {
		return;
	}

	parts.push('\n');
};

type PDFNativeTextBlock = {
	blockNumber: number;
	lineCount: number;
	pageNumber: number;
	semanticRole?: 'figure_caption' | 'figure_body';
	text: string;
	textKind: 'paragraph' | 'table_like';
};

type PDFNativeTextBlockSeed = Omit<PDFNativeTextBlock, 'blockNumber'>;
type PDFNativeStructureBlockEntry = {
	baseSectionTitle: string;
	pageNumber?: number;
	pdfBlockNumber?: number;
	pdfFigureCaptionBlockNumber?: number;
	pdfFigureLabel?: string;
	pdfSemanticRole?: 'figure_caption' | 'figure_body';
	pdfTableBodyRowEnd?: number;
	pdfTableBodyRowCount?: number;
	pdfTableBodyRowStart?: number;
	pdfTableChunkKind?: 'full_table' | 'table_slice';
	pdfTableColumnCount?: number;
	pdfTableHeaderText?: string;
	pdfTableHeaders?: string[];
	pdfTableRowCount?: number;
	pdfTableSignature?: string;
	pdfTextKind: 'paragraph' | 'table_like';
	text: string;
};

type PDFNativeTextExtraction = {
	pageCount: number;
	text: string;
	textBlockCount: number;
	textBlocks: PDFNativeTextBlock[];
};

const PDF_CHROME_LINE_MAX_LENGTH = 80;
const PDF_LINK_CLUSTER_LINE_MAX_LENGTH = 120;
const PDF_FIGURE_LABEL_PATTERN =
	/^(?:figure|fig\.)\s*\d+[A-Za-z]?(?:\s*[:.-]\s*|\s+|$)/i;
const PDF_LINK_CLUSTER_HEADING_PATTERN =
	/^(?:related|quick|useful|reference|references|resources|links|see also)\b/i;
const PDF_PROMO_HEADING_PATTERN =
	/^(?:start|free trial|upgrade|subscribe|newsletter|contact sales|book demo|try|learn more)\b/i;
const PDF_PROMO_BODY_PATTERN =
	/\b(?:free trial|upgrade|subscribe|newsletter|contact sales|book demo|learn more|pricing|enterprise|demo)\b/i;
const OCR_SUMMARY_CONFIDENCE_THRESHOLD = 0.75;
const OCR_SUMMARY_MIN_STRONG_TEXT_RATIO = 0.6;

const PDF_TEXT_OPERATOR_PATTERN =
	/(\[((?:\\.|[^\]])*)\]\s*TJ)|(\(((?:\\.|[^\\)])*)\)\s*Tj)|([-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+\(((?:\\.|[^\\)])*)\)\s*")|(\(((?:\\.|[^\\)])*)\)\s*')|((?:[-+]?\d*\.?\d+\s+){2}(?:Td|TD))|(T\*)|((?:[-+]?\d*\.?\d+\s+){6}Tm)/g;

const extractTextFromPDFTextObject = (value: string) => {
	const parts: string[] = [];

	for (const match of value.matchAll(PDF_TEXT_OPERATOR_PATTERN)) {
		if (match[2] !== undefined) {
			appendPdfText(parts, extractPdfArrayText(match[2]));
			continue;
		}

		if (match[4] !== undefined) {
			appendPdfText(parts, decodePdfLiteral(match[4]));
			continue;
		}

		if (match[6] !== undefined) {
			appendPdfLineBreak(parts);
			appendPdfText(parts, decodePdfLiteral(match[6]));
			continue;
		}

		if (match[8] !== undefined) {
			appendPdfLineBreak(parts);
			appendPdfText(parts, decodePdfLiteral(match[8]));
			continue;
		}

		if (
			match[9] !== undefined ||
			match[10] !== undefined ||
			match[11] !== undefined
		) {
			appendPdfLineBreak(parts);
		}
	}

	return parts.join('');
};

const buildPDFNativeTextBlockSeed = (
	lines: string[],
	pageNumber: number
): PDFNativeTextBlockSeed | undefined => {
	const normalizedLines = lines
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	if (normalizedLines.length === 0) {
		return undefined;
	}
	const text = normalizedLines.join('\n');
	const semanticRole =
		normalizedLines.length >= 2 &&
		PDF_FIGURE_LABEL_PATTERN.test(normalizedLines[0] ?? '')
			? 'figure_caption'
			: undefined;

	return {
		lineCount: normalizedLines.length,
		pageNumber,
		...(semanticRole ? { semanticRole } : {}),
		text,
		textKind: normalizedLines.some((line) => line.includes(' | '))
			? 'table_like'
			: 'paragraph'
	};
};

const inferPDFBlockHeading = (text: string) => {
	const lines = text
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	const candidate = lines[0];
	if (
		!candidate ||
		candidate.length > 80 ||
		candidate.includes(' | ') ||
		/[.!?]$/.test(candidate)
	) {
		return undefined;
	}

	return candidate;
};

const extractPDFFigureLabel = (text: string) => {
	const lines = text
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	const candidate = lines[0];
	return candidate && PDF_FIGURE_LABEL_PATTERN.test(candidate)
		? candidate
		: undefined;
};

const splitPDFNativeTextBlocks = (
	text: string,
	pageNumber: number
): PDFNativeTextBlockSeed[] => {
	const lines = text
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	if (lines.length === 0) {
		return [];
	}

	const blocks: PDFNativeTextBlockSeed[] = [];
	let currentLines: string[] = [];
	let currentKind: PDFNativeTextBlock['textKind'] | undefined;
	let currentSemanticRole: PDFNativeTextBlock['semanticRole'] | undefined;

	const flush = () => {
		if (currentLines.length === 0) {
			return;
		}

		const block = buildPDFNativeTextBlockSeed(currentLines, pageNumber);
		if (block) {
			blocks.push(block);
		}
		currentLines = [];
		currentKind = undefined;
		currentSemanticRole = undefined;
	};

	for (const [index, line] of lines.entries()) {
		const lineKind: PDFNativeTextBlock['textKind'] = line.includes(' | ')
			? 'table_like'
			: 'paragraph';
		const isFigureLabel = PDF_FIGURE_LABEL_PATTERN.test(line);

		if (isFigureLabel) {
			flush();
			currentKind = 'paragraph';
			currentSemanticRole = 'figure_caption';
			currentLines.push(line);
			continue;
		}

		if (currentSemanticRole === 'figure_caption') {
			if (lineKind === 'paragraph' && currentLines.length < 2) {
				currentLines.push(line);
				continue;
			}
			flush();
		}

		if (currentKind && lineKind !== currentKind) {
			flush();
		}

		currentKind = lineKind;
		currentLines.push(line);
	}

	flush();

	return blocks;
};

const assignPDFBlockNumbers = (blocks: PDFNativeTextBlockSeed[]) =>
	blocks.map((block, index) => ({
		...block,
		blockNumber: index + 1
	}));

const isLikelyPDFPageLabel = (value: string) =>
	/^page\s+\d+(?:\s+of\s+\d+)?$/i.test(value.trim());

const isLikelyPDFChromeLine = (value: string) => {
	const normalized = value.trim();
	if (!normalized) {
		return false;
	}

	return (
		isLikelyPDFPageLabel(normalized) ||
		/\b(?:header|footer)\s*$/i.test(normalized)
	);
};

const isLikelyPDFLinkLine = (value: string) => {
	const normalized = value.trim();
	if (!normalized || normalized.length > PDF_LINK_CLUSTER_LINE_MAX_LENGTH) {
		return false;
	}

	return (
		/^https?:\/\//i.test(normalized) ||
		/^www\./i.test(normalized) ||
		/^\/[A-Za-z0-9/_#?&=%.-]+$/.test(normalized) ||
		/\((?:https?:\/\/|\/)[^)]+\)/i.test(normalized)
	);
};

const isLikelyPDFLinkClusterBlock = (block: PDFNativeTextBlock) => {
	if (block.semanticRole || block.textKind !== 'paragraph') {
		return false;
	}

	const lines = block.text
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	if (lines.length === 1) {
		return isLikelyPDFLinkLine(lines[0] ?? '');
	}
	if (lines.length < 2) {
		return false;
	}

	const heading = lines[0] ?? '';
	const bodyLines = lines.slice(1);
	const linkLikeCount = bodyLines.filter((line) =>
		isLikelyPDFLinkLine(line)
	).length;
	if (
		bodyLines.length > 0 &&
		linkLikeCount === bodyLines.length &&
		PDF_LINK_CLUSTER_HEADING_PATTERN.test(heading)
	) {
		return true;
	}

	return linkLikeCount >= 2 && linkLikeCount >= Math.ceil(lines.length * 0.6);
};

const isLikelyPDFPromoBlock = (block: PDFNativeTextBlock) => {
	if (block.semanticRole || block.textKind !== 'paragraph') {
		return false;
	}

	const lines = block.text
		.split('\n')
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);
	if (lines.length === 1) {
		return PDF_PROMO_HEADING_PATTERN.test(lines[0] ?? '');
	}
	if (lines.length < 2 || lines.length > 4) {
		return false;
	}

	const heading = lines[0] ?? '';
	const bodyLines = lines.slice(1);
	const promoLikeCount = bodyLines.filter(
		(line) =>
			line.length <= PDF_LINK_CLUSTER_LINE_MAX_LENGTH &&
			(PDF_PROMO_BODY_PATTERN.test(line) || isLikelyPDFLinkLine(line))
	).length;

	if (
		PDF_PROMO_HEADING_PATTERN.test(heading) &&
		promoLikeCount >= Math.max(1, bodyLines.length - 1)
	) {
		return true;
	}

	return false;
};

const suppressRepeatedPDFChrome = (blocks: PDFNativeTextBlock[]) => {
	const linePages = new Map<string, Set<number>>();

	for (const block of blocks) {
		for (const line of block.text.split('\n')) {
			const normalized = normalizeWhitespace(line);
			if (!normalized || normalized.length > PDF_CHROME_LINE_MAX_LENGTH) {
				continue;
			}

			const pages = linePages.get(normalized) ?? new Set<number>();
			pages.add(block.pageNumber);
			linePages.set(normalized, pages);
		}
	}

	return blocks
		.map((block) => {
			const keptLines = block.text
				.split('\n')
				.map((line) => normalizeWhitespace(line))
				.filter((line) => {
					if (!line) {
						return false;
					}

					if (isLikelyPDFChromeLine(line)) {
						return false;
					}

					const repeatedPages = linePages.get(line);
					if (
						line.length <= PDF_CHROME_LINE_MAX_LENGTH &&
						repeatedPages &&
						repeatedPages.size > 1
					) {
						return false;
					}

					return true;
				});
			const text = keptLines.join('\n');
			if (!text) {
				return undefined;
			}

			return {
				...block,
				lineCount: text.split('\n').filter(Boolean).length,
				text,
				textKind: text.includes(' | ') ? 'table_like' : 'paragraph'
			};
		})
		.filter((value): value is PDFNativeTextBlock => Boolean(value));
};

const suppressNonContentPDFBlocks = (blocks: PDFNativeTextBlock[]) =>
	blocks.filter(
		(block) =>
			!isLikelyPDFLinkClusterBlock(block) && !isLikelyPDFPromoBlock(block)
	);

const mergePDFHeadingContinuationBlocks = (blocks: PDFNativeTextBlock[]) => {
	const merged: PDFNativeTextBlock[] = [];

	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		if (!block) {
			continue;
		}

		const lines = block.text
			.split('\n')
			.map((line) => normalizeWhitespace(line))
			.filter(Boolean);
		const nextBlock = blocks[index + 1];
		const isHeadingOnlyBlock =
			!block.semanticRole &&
			block.textKind === 'paragraph' &&
			lines.length === 1 &&
			inferPDFBlockHeading(block.text) === lines[0];
		const canMergeWithNext =
			isHeadingOnlyBlock &&
			nextBlock &&
			nextBlock.pageNumber === block.pageNumber &&
			!nextBlock.semanticRole &&
			nextBlock.textKind === 'paragraph' &&
			inferPDFBlockHeading(nextBlock.text) === undefined;

		if (canMergeWithNext) {
			const text = [block.text, nextBlock.text]
				.flatMap((value) => value.split('\n'))
				.map((line) => normalizeWhitespace(line))
				.filter(Boolean)
				.join('\n');
			merged.push({
				...block,
				lineCount: text.split('\n').filter(Boolean).length,
				text
			});
			index += 1;
			continue;
		}

		merged.push(block);
	}

	return merged;
};

const associatePDFNativeFigureBodies = (blocks: PDFNativeTextBlock[]) =>
	blocks.map((block, index) => {
		if (
			block.semanticRole ||
			block.textKind !== 'paragraph' ||
			inferPDFBlockHeading(block.text)
		) {
			return block;
		}

		const previousBlock = index > 0 ? blocks[index - 1] : undefined;
		if (
			!previousBlock ||
			previousBlock.pageNumber !== block.pageNumber ||
			previousBlock.semanticRole !== 'figure_caption'
		) {
			return block;
		}

		return {
			...block,
			semanticRole: 'figure_body' as const
		};
	});

const extractNativePDFText = (data: Uint8Array): PDFNativeTextExtraction => {
	const raw = Buffer.from(data).toString('latin1');
	const count = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length;
	const pageCount = count > 0 ? count : 1;
	const pageMarkers = [...raw.matchAll(/\/Type\s*\/Page\b/g)].map(
		(match) => match.index ?? raw.length
	);
	const blocks = assignPDFBlockNumbers(
		[...raw.matchAll(/BT([\s\S]*?)ET/g)].flatMap((match) => {
			const blockText = extractTextFromPDFTextObject(match[1] ?? '');
			const objectEnd = (match.index ?? 0) + (match[0]?.length ?? 0);
			const pageIndex = pageMarkers.findIndex(
				(marker) => marker >= objectEnd
			);
			const pageNumber = pageIndex >= 0 ? pageIndex + 1 : pageCount;

			return splitPDFNativeTextBlocks(blockText, pageNumber);
		})
	);
	const visibleBlocks = assignPDFBlockNumbers(
		associatePDFNativeFigureBodies(
			mergePDFHeadingContinuationBlocks(
				suppressNonContentPDFBlocks(suppressRepeatedPDFChrome(blocks))
			)
		)
	);
	const fallbackText = [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
		.map((match) => decodePdfLiteral(match[1] ?? ''))
		.join('\n');
	const text =
		visibleBlocks.length > 0
			? normalizeWhitespace(
					visibleBlocks.map((block) => block.text).join('\n\n')
				)
			: normalizeWhitespace(fallbackText);

	return {
		pageCount,
		text,
		textBlockCount: visibleBlocks.length,
		textBlocks: visibleBlocks
	};
};

const readUInt16LE = (data: Uint8Array, offset: number) =>
	data[offset]! | (data[offset + 1]! << 8);

const readUInt32LE = (data: Uint8Array, offset: number) =>
	(data[offset]! |
		(data[offset + 1]! << 8) |
		(data[offset + 2]! << 16) |
		(data[offset + 3]! << 24)) >>>
	0;

const decodeUtf8 = (data: Uint8Array) => Buffer.from(data).toString('utf8');

const isZipData = (data: Uint8Array) =>
	data.length >= 4 &&
	data[0] === 0x50 &&
	data[1] === 0x4b &&
	data[2] === 0x03 &&
	data[3] === 0x04;

const unzipEntries = (data: Uint8Array): RAGArchiveEntry[] => {
	const entries: RAGArchiveEntry[] = [];
	let offset = 0;

	while (offset + 30 <= data.length) {
		const signature = readUInt32LE(data, offset);
		if (signature !== 0x04034b50) {
			break;
		}

		const compressionMethod = readUInt16LE(data, offset + 8);
		const compressedSize = readUInt32LE(data, offset + 18);
		const fileNameLength = readUInt16LE(data, offset + 26);
		const extraFieldLength = readUInt16LE(data, offset + 28);
		const fileNameStart = offset + 30;
		const fileNameEnd = fileNameStart + fileNameLength;
		const fileName = decodeUtf8(data.subarray(fileNameStart, fileNameEnd));
		const dataStart = fileNameEnd + extraFieldLength;
		const dataEnd = dataStart + compressedSize;
		const raw = data.subarray(dataStart, dataEnd);
		let entryData: Uint8Array;

		if (compressionMethod === 0) {
			entryData = raw;
		} else if (compressionMethod === 8) {
			entryData = inflateRawSync(Buffer.from(raw));
		} else {
			throw new Error(
				`Unsupported ZIP compression method ${compressionMethod} for ${fileName}`
			);
		}

		if (!fileName.endsWith('/')) {
			entries.push({
				data: entryData,
				path: fileName
			});
		}

		offset = dataEnd;
	}

	return entries;
};

const untarEntries = (data: Uint8Array): RAGArchiveEntry[] => {
	const entries: RAGArchiveEntry[] = [];
	let offset = 0;

	while (offset + 512 <= data.length) {
		const header = data.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			break;
		}

		const name = decodeUtf8(header.subarray(0, 100)).replace(/\0.*$/, '');
		const sizeText = decodeUtf8(header.subarray(124, 136))
			.replace(/\0.*$/, '')
			.trim();
		const size = sizeText ? parseInt(sizeText, 8) : 0;
		const typeFlag = header[156];
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;

		if (typeFlag !== 53 && typeFlag !== 0 && typeFlag !== 48) {
			offset = dataStart + Math.ceil(size / 512) * 512;
			continue;
		}

		if (name) {
			entries.push({
				data: data.subarray(dataStart, dataEnd),
				path: name
			});
		}

		offset = dataStart + Math.ceil(size / 512) * 512;
	}

	return entries;
};

const decodeGzipEntries = (
	data: Uint8Array,
	input: RAGFileExtractionInput
): RAGArchiveEntry[] => {
	const ungzipped = gunzipSync(Buffer.from(data));
	const sourceName = inferNameFromInput(input);
	const stripped = sourceName.replace(/\.t?gz$/i, '').replace(/\.gz$/i, '');

	if (
		sourceName.toLowerCase().endsWith('.tgz') ||
		sourceName.toLowerCase().endsWith('.tar.gz')
	) {
		return untarEntries(ungzipped);
	}

	return [
		{
			data: ungzipped,
			path: stripped || 'archive-entry'
		}
	];
};

const extractXmlText = (value: string) =>
	normalizeWhitespace(
		decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
	);

const extractOfficeParagraphText = (value: string) =>
	normalizeWhitespace(
		decodeHtmlEntities(
			value
				.replace(/<w:tab\b[^>]*\/>/gi, '\t')
				.replace(/<w:br\b[^>]*\/>/gi, '\n')
				.replace(/<[^>]+>/g, ' ')
		)
	);

const officeDocumentBlocks = (
	entries: RAGArchiveEntry[]
): OfficeDocumentBlock[] => {
	const documentEntry = entries.find(
		(entry) => entry.path === 'word/document.xml'
	);
	if (!documentEntry) {
		return [];
	}

	const xml = decodeUtf8(documentEntry.data);
	const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
	const body = bodyMatch?.[1] ?? xml;
	const blocks: OfficeDocumentBlock[] = [];
	const blockPattern = /<(w:p|w:tbl)\b[\s\S]*?<\/\1>/g;

	for (const match of body.matchAll(blockPattern)) {
		const blockXml = match[0] ?? '';
		if (blockXml.startsWith('<w:tbl')) {
			const tableRows = [...blockXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
				.map((rowMatch) =>
					[
						...(rowMatch[0] ?? '').matchAll(
							/<w:tc\b[\s\S]*?<\/w:tc>/g
						)
					]
						.map((cellMatch) =>
							extractOfficeParagraphText(cellMatch[0] ?? '')
						)
						.filter(Boolean)
				)
				.filter((cells) => cells.length > 0);
			const rows = tableRows
				.map((cells, rowIndex) => {
					return `Row ${rowIndex + 1}. ${cells
						.map(
							(cell, cellIndex) =>
								`${String.fromCharCode(65 + cellIndex)}: ${cell}`
						)
						.join(' | ')}`;
				})
				.filter(Boolean);
			const text = normalizeWhitespace(rows.join('\n'));
			if (!text) {
				continue;
			}
			const tableHeaders = tableRows[0];
			const tableRowCount = tableRows.length;
			const tableBodyRowCount =
				tableRowCount > 0 ? Math.max(0, tableRowCount - 1) : undefined;
			const tableColumnCount =
				Array.isArray(tableHeaders) && tableHeaders.length > 0
					? tableHeaders.length
					: tableRows.reduce(
							(max, row) => Math.max(max, row.length),
							0
						) || undefined;
			const tableHeaderText =
				Array.isArray(tableHeaders) && tableHeaders.length > 0
					? tableHeaders.join(' | ')
					: undefined;
			const tableSignature =
				Array.isArray(tableHeaders) && tableHeaders.length > 0
					? tableHeaders.join(' | ')
					: undefined;

			blocks.push({
				blockKind: 'table',
				blockNumber: blocks.length + 1,
				...(typeof tableBodyRowCount === 'number'
					? { tableBodyRowCount }
					: {}),
				...(typeof tableColumnCount === 'number'
					? { tableColumnCount }
					: {}),
				...(typeof tableHeaderText === 'string'
					? { tableHeaderText }
					: {}),
				...(Array.isArray(tableHeaders) && tableHeaders.length > 0
					? { tableHeaders }
					: {}),
				...(typeof tableRowCount === 'number' ? { tableRowCount } : {}),
				...(typeof tableSignature === 'string'
					? { tableSignature }
					: {}),
				text
			});
			continue;
		}

		const text = extractOfficeParagraphText(blockXml);
		if (!text) {
			continue;
		}

		const styleMatch = blockXml.match(
			/<w:pStyle\b[^>]*w:val="([^"]+)"[^>]*\/?>/i
		);
		const style = (styleMatch?.[1] ?? '').toLowerCase();
		const headingMatch = style.match(/^heading([1-6])$/);
		const isListParagraph =
			/<w:numPr\b/i.test(blockXml) ||
			style.includes('list') ||
			style.includes('bullet');
		const listLevelMatch = blockXml.match(
			/<w:ilvl\b[^>]*w:val="(\d+)"[^>]*\/?>/i
		);
		const listLevel = listLevelMatch
			? Number.parseInt(listLevelMatch[1] ?? '0', 10)
			: undefined;
		const blockKind: OfficeDocumentBlock['blockKind'] =
			style === 'title'
				? 'title'
				: headingMatch
					? 'heading'
					: isListParagraph
						? 'list'
						: 'paragraph';
		const listPrefix =
			blockKind === 'list'
				? `${'  '.repeat(Math.max(0, listLevel ?? 0))}- `
				: '';
		const decoratedText =
			blockKind === 'list' && !/^[-*]\s/.test(text)
				? `${listPrefix}${text}`
				: text;

		blocks.push({
			blockKind,
			blockNumber: blocks.length + 1,
			headingLevel: headingMatch
				? Number.parseInt(headingMatch[1] ?? '1', 10)
				: undefined,
			listLevel:
				blockKind === 'list' && Number.isFinite(listLevel ?? NaN)
					? listLevel
					: undefined,
			style: style || undefined,
			text: decoratedText
		});
	}

	return blocks;
};

const officeDocumentParagraphs = (entries: RAGArchiveEntry[]) => {
	return officeDocumentBlocks(entries)
		.map((block) => block.text)
		.filter(Boolean);
};

const officeDocumentText = (entries: RAGArchiveEntry[]) => {
	const blocks = officeDocumentBlocks(entries);
	if (blocks.length > 0) {
		return normalizeWhitespace(
			blocks.map((block) => block.text).join('\n\n')
		);
	}

	const documentEntry = entries.find(
		(entry) => entry.path === 'word/document.xml'
	);
	if (!documentEntry) {
		return '';
	}

	return extractXmlText(decodeUtf8(documentEntry.data));
};

const officeDocumentSectionCount = (entries: RAGArchiveEntry[]) => {
	const count = officeDocumentBlocks(entries).length;

	return count > 0 ? count : undefined;
};

const spreadsheetSharedStrings = (entries: RAGArchiveEntry[]) =>
	entries
		.filter((entry) => entry.path === 'xl/sharedStrings.xml')
		.flatMap((entry) =>
			[
				...decodeUtf8(entry.data).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)
			].map((match) => decodeHtmlEntities(match[1] ?? ''))
		);

const spreadsheetColumnLabel = (reference: string | undefined) => {
	const match = reference?.match(/([A-Z]+)/i);
	return match?.[1]?.toUpperCase() ?? '';
};

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

const spreadsheetColumnLabelFromIndex = (index: number | undefined) => {
	if (typeof index !== 'number' || !Number.isFinite(index) || index < 1) {
		return undefined;
	}

	let remaining = Math.floor(index);
	let label = '';
	while (remaining > 0) {
		const offset = (remaining - 1) % 26;
		label = String.fromCharCode(65 + offset) + label;
		remaining = Math.floor((remaining - 1) / 26);
	}

	return label || undefined;
};

const spreadsheetColumnRange = (
	rows: Array<{ column: string; reference?: string; value: string }[]>
) => {
	let spreadsheetColumnStart: string | undefined;
	let spreadsheetColumnEnd: string | undefined;
	let startIndex: number | undefined;
	let endIndex: number | undefined;

	for (const row of rows) {
		for (const cell of row) {
			const columnIndex = spreadsheetColumnIndex(cell.column);
			if (
				typeof columnIndex !== 'number' ||
				!Number.isFinite(columnIndex)
			) {
				continue;
			}

			if (typeof startIndex !== 'number' || columnIndex < startIndex) {
				startIndex = columnIndex;
				spreadsheetColumnStart = cell.column;
			}

			if (typeof endIndex !== 'number' || columnIndex > endIndex) {
				endIndex = columnIndex;
				spreadsheetColumnEnd = cell.column;
			}
		}
	}

	return {
		spreadsheetColumnEnd,
		spreadsheetColumnStart
	};
};

const sortSpreadsheetCellsByColumn = <
	TCell extends { column: string; reference?: string }
>(
	cells: TCell[]
) =>
	[...cells].sort((left, right) => {
		const leftIndex = spreadsheetColumnIndex(left.column);
		const rightIndex = spreadsheetColumnIndex(right.column);
		if (
			typeof leftIndex === 'number' &&
			Number.isFinite(leftIndex) &&
			typeof rightIndex === 'number' &&
			Number.isFinite(rightIndex) &&
			leftIndex !== rightIndex
		) {
			return leftIndex - rightIndex;
		}

		return (left.reference ?? left.column).localeCompare(
			right.reference ?? right.column
		);
	});

type SpreadsheetTableColumnRange = {
	tableIndex: number;
	spreadsheetColumnStart?: string;
	spreadsheetColumnEnd?: string;
};

type SpreadsheetTableHeaders = {
	tableIndex: number;
	spreadsheetHeaders: string[];
};

type SpreadsheetWorksheetCell = {
	column: string;
	reference?: string;
	value: string;
};

type SpreadsheetWorksheetRow = {
	cells: SpreadsheetWorksheetCell[];
	rowNumber: number;
};

type SpreadsheetSheetText = {
	headers: string[];
	name: string;
	repeatedHeaderRowNumbers: number[];
	rowCount: number;
	sheetTableHeaders: SpreadsheetTableHeaders[];
	sheetTableColumnRanges: SpreadsheetTableColumnRange[];
	spreadsheetColumnEnd?: string;
	spreadsheetColumnStart?: string;
	tableCount: number;
	text: string;
};

const spreadsheetResolveCellValue = (
	cellXml: string,
	sharedStrings: string[]
) => {
	const inlineMatch = cellXml.match(
		/<is\b[^>]*>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/i
	);
	if (inlineMatch?.[1]) {
		return normalizeWhitespace(decodeHtmlEntities(inlineMatch[1]));
	}

	const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/i);
	if (!valueMatch?.[1]) {
		return '';
	}

	const rawValue = decodeHtmlEntities(valueMatch[1]);
	const typeMatch = cellXml.match(/\bt="([^"]+)"/i);
	if (typeMatch?.[1] === 's') {
		const index = Number(rawValue);
		return Number.isInteger(index) && sharedStrings[index]
			? sharedStrings[index]!
			: rawValue;
	}

	return normalizeWhitespace(rawValue);
};

const spreadsheetWorksheetRows = (
	worksheetXml: string,
	sharedStrings: string[]
) =>
	[...worksheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)]
		.map((rowMatch) => {
			const rowAttributes = rowMatch[1] ?? '';
			const rowXml = rowMatch[2] ?? '';
			const cells = sortSpreadsheetCellsByColumn(
				[...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)]
					.map((cellMatch) => {
						const attributes = cellMatch[1] ?? '';
						const cellBody = cellMatch[2] ?? '';
						const referenceMatch =
							attributes.match(/\br="([^"]+)"/i);
						const reference = referenceMatch?.[1];
						const value = spreadsheetResolveCellValue(
							`<c${attributes}>${cellBody}</c>`,
							sharedStrings
						);

						return {
							column: spreadsheetColumnLabel(reference),
							reference,
							value
						};
					})
					.filter((cell) => cell.value)
			);
			const explicitRowNumber = Number.parseInt(
				rowAttributes.match(/\br="(\d+)"/i)?.[1] ?? '',
				10
			);
			const fallbackRowNumber = Number.parseInt(
				cells[0]?.reference?.match(/\d+/)?.[0] ?? '',
				10
			);

			return {
				cells,
				rowNumber: Number.isInteger(explicitRowNumber)
					? explicitRowNumber
					: Number.isInteger(fallbackRowNumber)
						? fallbackRowNumber
						: 0
			};
		})
		.filter((row) => row.cells.length > 0)
		.map((row, index) => ({
			...row,
			rowNumber: row.rowNumber > 0 ? row.rowNumber : index + 1
		}));

const spreadsheetRowText = (
	row: { column: string; reference?: string; value: string }[],
	headers: string[],
	headerColumns?: string[]
) => {
	const entries = row.map((cell, index) => {
		const exactHeaderIndex = Array.isArray(headerColumns)
			? headerColumns.findIndex((column) => column === cell.column)
			: -1;
		const headerIndex = exactHeaderIndex >= 0 ? exactHeaderIndex : index;
		const header = headers[headerIndex];
		if (header) {
			return `${header}: ${cell.value}`;
		}

		return cell.column ? `${cell.column}: ${cell.value}` : cell.value;
	});

	return normalizeWhitespace(entries.join(' | '));
};

const normalizeSpreadsheetHeaderValue = (value: string) =>
	normalizeWhitespace(value).toLowerCase();

const isSpreadsheetHeaderRow = (row: { value: string }[], headers: string[]) =>
	row.length === headers.length &&
	row.every(
		(cell, index) =>
			normalizeSpreadsheetHeaderValue(cell.value) ===
			normalizeSpreadsheetHeaderValue(headers[index] ?? '')
	);

const isSpreadsheetHeaderLikeRow = (row: { value: string }[]) =>
	row.length > 0 &&
	row.every((cell) => {
		const normalized = normalizeSpreadsheetHeaderValue(cell.value);
		return (
			normalized.length > 0 &&
			/[a-z]/i.test(normalized) &&
			!/^\d+(?:\.\d+)?$/.test(normalized)
		);
	});

const isSpreadsheetWeakHeaderRestartRow = (
	row: { value: string }[],
	headers: string[]
) => {
	if (row.length === 0 || row.length !== headers.length) {
		return false;
	}

	const normalizedRow = row.map((cell) =>
		normalizeSpreadsheetHeaderValue(cell.value)
	);
	const normalizedHeaders = headers.map((value) =>
		normalizeSpreadsheetHeaderValue(value)
	);
	if (
		normalizedRow.every(
			(value, index) => value === (normalizedHeaders[index] ?? '')
		)
	) {
		return false;
	}

	const overlappingHeaderCount = normalizedRow.filter((value, index) => {
		const currentHeader = normalizedHeaders[index] ?? '';
		return value.length > 0 && value === currentHeader;
	}).length;
	const alphaishCellCount = normalizedRow.filter(
		(value) => value.length > 0 && /[a-z]/i.test(value)
	).length;

	return (
		overlappingHeaderCount > 0 &&
		alphaishCellCount > 0 &&
		overlappingHeaderCount + alphaishCellCount >=
			Math.max(1, Math.ceil(row.length / 2))
	);
};

const isSpreadsheetSparseHeaderRestartRow = (
	row: { column: string; value: string }[],
	headers: string[],
	headerColumns: string[]
) => {
	if (
		row.length === 0 ||
		row.length >= headers.length ||
		headerColumns.length !== headers.length
	) {
		return false;
	}

	const headerColumnSet = new Set(headerColumns);
	if (!row.every((cell) => headerColumnSet.has(cell.column))) {
		return false;
	}

	return row.every((cell) => {
		const normalized = normalizeSpreadsheetHeaderValue(cell.value);
		return (
			normalized.length > 0 &&
			/[a-z]/i.test(normalized) &&
			!/^\d+(?:\.\d+)?$/.test(normalized)
		);
	});
};

const isSpreadsheetSparseShiftedHeaderRestartRow = (
	row: { value: string }[],
	headers: string[]
) => {
	if (row.length === 0 || row.length >= headers.length) {
		return false;
	}

	return row.every((cell) => {
		const normalized = normalizeSpreadsheetHeaderValue(cell.value);
		return (
			normalized.length > 0 &&
			/[a-z]/i.test(normalized) &&
			!/^\d+(?:\.\d+)?$/.test(normalized)
		);
	});
};

const buildSpreadsheetShiftedHeaderColumns = (
	row: { column: string; value: string }[],
	headerWidth: number
) => {
	const startIndex = spreadsheetColumnIndex(row[0]?.column);
	if (
		typeof startIndex !== 'number' ||
		!Number.isFinite(startIndex) ||
		headerWidth < 1
	) {
		return row.map((cell) => cell.column);
	}

	return Array.from({ length: headerWidth }, (_, index) =>
		spreadsheetColumnLabelFromIndex(startIndex + index)
	).filter((value): value is string => typeof value === 'string');
};

const mergeSpreadsheetRestartHeaders = (
	row: { column: string; value: string }[],
	previousHeaders: string[],
	previousHeaderColumns: string[]
) =>
	previousHeaderColumns.map((column, index) => {
		const currentCell = row.find((cell) => cell.column === column);
		const normalized = normalizeSpreadsheetHeaderValue(
			currentCell?.value ?? ''
		);
		if (normalized.length > 0) {
			return currentCell!.value;
		}

		return previousHeaders[index] ?? currentCell?.value ?? '';
	});

const spreadsheetSheetTexts = (
	entries: RAGArchiveEntry[]
): SpreadsheetSheetText[] => {
	const sharedStrings = spreadsheetSharedStrings(entries);
	const sheetNames = spreadsheetSheetNames(entries);
	const sheetEntries = entries
		.filter(
			(entry) =>
				entry.path.startsWith('xl/worksheets/') &&
				entry.path.endsWith('.xml')
		)
		.sort((left, right) => left.path.localeCompare(right.path));

	const sheets = sheetEntries.map<SpreadsheetSheetText | null>(
		(entry, index) => {
			const rows = spreadsheetWorksheetRows(
				decodeUtf8(entry.data),
				sharedStrings
			);
			if (rows.length === 0) {
				return null;
			}

			const headers = rows[0]!.cells.map((cell) => cell.value);
			const { spreadsheetColumnEnd, spreadsheetColumnStart } =
				spreadsheetColumnRange(rows.map((row) => row.cells));
			const repeatedHeaderRowNumbers: number[] = [];
			const sheetTableHeaders: SpreadsheetTableHeaders[] = [];
			let tableCount = 1;
			const tableRows: Array<{
				rows: SpreadsheetWorksheetCell[][];
				tableIndex: number;
			}> = [];
			let currentTableRows: SpreadsheetWorksheetCell[][] | undefined;
			let currentTableIndex = 1;
			let currentTableHeaders = headers;
			let currentTableHeaderColumns = rows[0]!.cells.map(
				(cell) => cell.column
			);
			let currentTableColumnStart = spreadsheetColumnRange([
				rows[0]!.cells
			]).spreadsheetColumnStart;
			let currentTableColumnEnd = spreadsheetColumnRange([
				rows[0]!.cells
			]).spreadsheetColumnEnd;
			const rowTexts = rows.map((rowEntry, rowIndex) => {
				const row = rowEntry.cells;
				const rowNumber = rowEntry.rowNumber;
				const rowColumnRange = spreadsheetColumnRange([row]);
				const previousRowNumber = rows[rowIndex - 1]?.rowNumber;
				const hasBlankRowGap =
					typeof previousRowNumber === 'number' &&
					rowNumber > previousRowNumber + 1;
				const isShiftedHeaderRow =
					rowIndex > 0 &&
					row.length === currentTableHeaders.length &&
					isSpreadsheetHeaderLikeRow(row) &&
					(rowColumnRange.spreadsheetColumnStart !==
						currentTableColumnStart ||
						rowColumnRange.spreadsheetColumnEnd !==
							currentTableColumnEnd);
				const isBlankGapShiftedTableRestart =
					rowIndex > 0 &&
					hasBlankRowGap &&
					(rowColumnRange.spreadsheetColumnStart !==
						currentTableColumnStart ||
						rowColumnRange.spreadsheetColumnEnd !==
							currentTableColumnEnd);
				const isBlankGapHeaderRestart =
					rowIndex > 0 &&
					hasBlankRowGap &&
					rowColumnRange.spreadsheetColumnStart ===
						currentTableColumnStart &&
					rowColumnRange.spreadsheetColumnEnd ===
						currentTableColumnEnd &&
					((isSpreadsheetHeaderLikeRow(row) &&
						!isSpreadsheetHeaderRow(row, currentTableHeaders)) ||
						isSpreadsheetWeakHeaderRestartRow(
							row,
							currentTableHeaders
						));
				const isBlankGapSparseHeaderRestart =
					rowIndex > 0 &&
					hasBlankRowGap &&
					isSpreadsheetSparseHeaderRestartRow(
						row,
						currentTableHeaders,
						currentTableHeaderColumns
					);
				const isShiftedSparseHeaderRestart =
					rowIndex > 0 &&
					hasBlankRowGap &&
					(rowColumnRange.spreadsheetColumnStart !==
						currentTableColumnStart ||
						rowColumnRange.spreadsheetColumnEnd !==
							currentTableColumnEnd) &&
					isSpreadsheetSparseShiftedHeaderRestartRow(
						row,
						currentTableHeaders
					);
				const isAnySparseHeaderRestart =
					isBlankGapSparseHeaderRestart ||
					isShiftedSparseHeaderRestart;
				const isHeaderRow =
					rowIndex === 0 ||
					isSpreadsheetHeaderRow(row, currentTableHeaders) ||
					isShiftedHeaderRow ||
					isBlankGapShiftedTableRestart ||
					isBlankGapHeaderRestart ||
					isAnySparseHeaderRestart;
				if (rowIndex > 0 && isHeaderRow) {
					repeatedHeaderRowNumbers.push(rowNumber);
					tableCount += 1;
					if (currentTableRows && currentTableRows.length > 0) {
						tableRows.push({
							rows: currentTableRows,
							tableIndex: currentTableIndex
						});
						sheetTableHeaders.push({
							spreadsheetHeaders: currentTableHeaders,
							tableIndex: currentTableIndex
						});
					}
					currentTableIndex = tableCount;
					const nextTableHeaderColumns = isShiftedSparseHeaderRestart
						? buildSpreadsheetShiftedHeaderColumns(
								row,
								currentTableHeaderColumns.length
							)
						: isBlankGapSparseHeaderRestart
							? currentTableHeaderColumns
							: row.map((cell) => cell.column);
					currentTableHeaders = isAnySparseHeaderRestart
						? mergeSpreadsheetRestartHeaders(
								row,
								currentTableHeaders,
								nextTableHeaderColumns
							)
						: row.map((cell) => cell.value);
					currentTableHeaderColumns = nextTableHeaderColumns;
					currentTableColumnStart = isShiftedSparseHeaderRestart
						? nextTableHeaderColumns[0]
						: isBlankGapSparseHeaderRestart
							? currentTableColumnStart
							: rowColumnRange.spreadsheetColumnStart;
					currentTableColumnEnd = isShiftedSparseHeaderRestart
						? nextTableHeaderColumns.at(-1)
						: isBlankGapSparseHeaderRestart
							? currentTableColumnEnd
							: rowColumnRange.spreadsheetColumnEnd;
					currentTableRows = [row];
				} else {
					currentTableRows = [...(currentTableRows ?? []), row];
				}

				return normalizeWhitespace(
					`Row ${rowNumber}. ${spreadsheetRowText(
						row,
						isHeaderRow ? [] : currentTableHeaders,
						isHeaderRow ? [] : currentTableHeaderColumns
					)}`
				);
			});
			if (currentTableRows && currentTableRows.length > 0) {
				tableRows.push({
					rows: currentTableRows,
					tableIndex: currentTableIndex
				});
				sheetTableHeaders.push({
					spreadsheetHeaders: currentTableHeaders,
					tableIndex: currentTableIndex
				});
			}
			const sheetTableColumnRanges = tableRows.map(
				({ rows, tableIndex }): SpreadsheetTableColumnRange => ({
					tableIndex,
					...spreadsheetColumnRange(rows)
				})
			);
			const text = normalizeWhitespace(rowTexts.join('\n'));
			if (!text) {
				return null;
			}

			return {
				headers,
				name: sheetNames[index] ?? `Sheet ${index + 1}`,
				repeatedHeaderRowNumbers,
				rowCount: rowTexts.length,
				sheetTableHeaders,
				sheetTableColumnRanges,
				spreadsheetColumnEnd,
				spreadsheetColumnStart,
				tableCount,
				text
			};
		}
	);

	return sheets.filter(
		(entry): entry is SpreadsheetSheetText => entry !== null
	);
};

const spreadsheetText = (entries: RAGArchiveEntry[]) =>
	normalizeWhitespace(
		spreadsheetSheetTexts(entries)
			.map((sheet) => `Sheet ${sheet.name}\n${sheet.text}`)
			.join('\n\n')
	);

const spreadsheetSheetNames = (entries: RAGArchiveEntry[]) =>
	entries
		.filter((entry) => entry.path === 'xl/workbook.xml')
		.flatMap((entry) =>
			[
				...decodeUtf8(entry.data).matchAll(/<sheet[^>]*name="([^"]+)"/g)
			].map((match) => match[1] ?? '')
		)
		.filter(Boolean);

const presentationNotesByIndex = (entries: RAGArchiveEntry[]) =>
	new Map(
		entries
			.filter(
				(entry) =>
					entry.path.startsWith('ppt/notesSlides/') &&
					entry.path.endsWith('.xml')
			)
			.sort((left, right) => left.path.localeCompare(right.path))
			.map((entry) => {
				const indexMatch = entry.path.match(/notesSlide(\d+)\.xml$/i);
				const index = Number(indexMatch?.[1] ?? '0') - 1;
				return [
					index,
					normalizeWhitespace(extractXmlText(decodeUtf8(entry.data)))
				] as const;
			})
			.filter((entry) => entry[0] >= 0 && Boolean(entry[1]))
	);

const presentationSlides = (entries: RAGArchiveEntry[]) => {
	const notesByIndex = presentationNotesByIndex(entries);

	return entries
		.filter(
			(entry) =>
				entry.path.startsWith('ppt/slides/') &&
				entry.path.endsWith('.xml')
		)
		.sort((left, right) => left.path.localeCompare(right.path))
		.map((entry, index) => {
			const textRuns = [
				...decodeUtf8(entry.data).matchAll(
					/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi
				)
			]
				.map((match) =>
					normalizeWhitespace(decodeHtmlEntities(match[1] ?? ''))
				)
				.filter(Boolean);
			const slideTitle = textRuns[0];
			const slideBodyText = normalizeWhitespace(
				textRuns.slice(1).join('\n')
			);
			const slideText = normalizeWhitespace(
				[slideTitle, slideBodyText].filter(Boolean).join('\n')
			);
			const notesText = notesByIndex.get(index);
			const text = normalizeWhitespace(
				[slideText, notesText ? `Speaker notes: ${notesText}` : '']
					.filter(Boolean)
					.join('\n')
			);

			return {
				index,
				slideBodyText,
				slideTitle,
				notesText,
				text
			};
		})
		.filter((slide) => Boolean(slide.text));
};

const presentationText = (entries: RAGArchiveEntry[]) =>
	normalizeWhitespace(
		presentationSlides(entries)
			.map((slide) => slide.text)
			.join('\n\n')
	);

const presentationSlideCount = (entries: RAGArchiveEntry[]) =>
	entries.filter(
		(entry) =>
			entry.path.startsWith('ppt/slides/') && entry.path.endsWith('.xml')
	).length;

const epubText = (entries: RAGArchiveEntry[]) => {
	const htmlEntries = entries.filter((entry) =>
		/\.(xhtml|html|htm)$/i.test(entry.path)
	);

	return normalizeWhitespace(
		htmlEntries
			.map((entry) => stripHtml(decodeUtf8(entry.data)))
			.join('\n\n')
	);
};

const splitEmailMessage = (raw: string) => {
	const normalized = raw.replace(/\r\n?/g, '\n');
	const separator = normalized.indexOf('\n\n');
	if (separator < 0) {
		return {
			body: '',
			headerBlock: normalized
		};
	}

	return {
		body: normalized.slice(separator + 2),
		headerBlock: normalized.slice(0, separator)
	};
};

const EMAIL_MBOX_BOUNDARY_PATTERN = /^From [^\s]+ .+$/;

const looksLikeMboxBoundary = (lines: string[], index: number) => {
	const line = lines[index];
	if (!EMAIL_MBOX_BOUNDARY_PATTERN.test(line ?? '')) {
		return false;
	}

	for (let offset = index + 1; offset < lines.length; offset += 1) {
		const candidate = lines[offset]?.trim() ?? '';
		if (!candidate) {
			return false;
		}
		if (/^[A-Za-z-]+:\s+\S+/.test(candidate)) {
			return true;
		}
		if (EMAIL_MBOX_BOUNDARY_PATTERN.test(candidate)) {
			return false;
		}
	}

	return false;
};

const splitMboxMessages = (raw: string) => {
	const normalized = raw.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const messages: string[] = [];
	let currentLines: string[] = [];

	const pushCurrent = () => {
		const text = currentLines.join('\n').trim();
		if (text) {
			messages.push(text);
		}
		currentLines = [];
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (looksLikeMboxBoundary(lines, index)) {
			pushCurrent();
			continue;
		}

		currentLines.push(line.replace(/^>(>*From )/, '$1'));
	}

	pushCurrent();

	return messages;
};

const buildMailboxStateMetadata = (stateFlags: string[]) => ({
	...(stateFlags.length > 0 ? { emailMailboxStateFlags: stateFlags } : {}),
	emailMailboxIsDraft: stateFlags.includes('draft'),
	emailMailboxIsFlagged: stateFlags.includes('flagged'),
	emailMailboxIsPassed: stateFlags.includes('passed'),
	emailMailboxIsRead: stateFlags.includes('read'),
	emailMailboxIsReplied: stateFlags.includes('replied'),
	emailMailboxIsTrashed: stateFlags.includes('trashed'),
	emailMailboxIsUnread: stateFlags.includes('unread')
});

const parseMailboxAttachmentNames = (value: string | undefined) => {
	if (!value) {
		return [];
	}

	return value
		.split(/[;,|]+/g)
		.map((entry) => normalizeWhitespace(entry))
		.filter(Boolean);
};

const parseMailboxStateFlags = (value: string | undefined) => {
	if (!value) {
		return [];
	}

	const tokens = value
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter(Boolean);
	const flags = new Set<string>();
	const add = (flag: string) => flags.add(flag);

	for (const token of tokens) {
		switch (token) {
			case 'read':
			case 'seen':
				add('read');
				break;
			case 'unread':
			case 'unseen':
			case 'new':
				add('unread');
				break;
			case 'flagged':
			case 'starred':
			case 'important':
				add('flagged');
				break;
			case 'replied':
			case 'answered':
				add('replied');
				break;
			case 'draft':
				add('draft');
				break;
			case 'trashed':
			case 'trash':
			case 'deleted':
				add('trashed');
				break;
			case 'passed':
			case 'forwarded':
				add('passed');
				break;
		}
	}

	if (!flags.has('read') && !flags.has('unread')) {
		flags.add('unread');
	}

	return [...flags];
};

const parseMailboxFolderMetadata = (value: string | undefined) => {
	if (!value) {
		return {};
	}

	const pathSegments = value
		.split(/[\\/]+/)
		.map((segment) => normalizeWhitespace(segment))
		.filter(Boolean);
	if (pathSegments.length === 0) {
		return {};
	}

	const familyKey = pathSegments
		.map((segment) => segment.toLowerCase())
		.join('/');
	const leaf = pathSegments.at(-1);

	return {
		emailMailboxFamilyKey: familyKey,
		emailMailboxFolder: leaf,
		emailMailboxLeaf: leaf,
		emailMailboxPathDepth: pathSegments.length,
		emailMailboxPathSegments: pathSegments
	};
};

const MAILBOX_CONTAINER_DECORATOR_KEYS = new Set([
	'folder',
	'mailbox',
	'flags',
	'sender',
	'sender-name',
	'sender-email',
	'recipients',
	'to-recipients',
	'cc-recipients',
	'bcc-recipients',
	'reply-to-recipients',
	'sent',
	'received',
	'internet-message-id',
	'client-submit-time',
	'delivery-time',
	'creation-time',
	'last-modified-time',
	'parent-message-id',
	'reference-chain',
	'message-class',
	'attachment',
	'attachment-content-id',
	'attachment-content-location',
	'attachment-content-type',
	'attachment-data',
	'attachment-disposition',
	'attachment-transfer-encoding',
	'attachments',
	'categories',
	'conversation-index',
	'conversation-topic',
	'has-attachments',
	'importance',
	'normalized-subject',
	'read',
	'unread',
	'flagged',
	'replied',
	'answered',
	'draft',
	'passed',
	'forwarded',
	'sensitivity',
	'thread-topic',
	'trashed',
	'deleted'
]);

const MAILBOX_CONTAINER_EMAIL_HEADER_KEYS = new Set([
	'subject',
	'from',
	'to',
	'cc',
	'bcc',
	'reply-to',
	'thread-topic',
	'date',
	'message-id',
	'in-reply-to',
	'references',
	'content-type'
]);

const buildMailboxContainerSenderHeader = (
	leadingMetadata: Record<string, string>
) => {
	const explicitSender = normalizeWhitespace(leadingMetadata.sender ?? '');
	if (explicitSender) {
		return explicitSender;
	}

	const senderEmail = normalizeWhitespace(
		leadingMetadata['sender-email'] ?? ''
	);
	const senderName = normalizeWhitespace(
		leadingMetadata['sender-name'] ?? ''
	);
	if (senderEmail && senderName) {
		return `${senderName} <${senderEmail}>`;
	}
	return senderEmail || senderName || undefined;
};

const buildMailboxContainerSyntheticHeaders = (
	messageRaw: string,
	leadingMetadata: Record<string, string>
) => {
	const { headerBlock, body } = splitEmailMessage(messageRaw);
	const headers = parseHeaderBlock(headerBlock);
	const syntheticHeaderLines: string[] = [];
	const senderHeader = buildMailboxContainerSenderHeader(leadingMetadata);
	const toHeader = normalizeWhitespace(
		leadingMetadata['to-recipients'] ?? leadingMetadata.recipients ?? ''
	);
	const ccHeader = normalizeWhitespace(
		leadingMetadata['cc-recipients'] ?? ''
	);
	const bccHeader = normalizeWhitespace(
		leadingMetadata['bcc-recipients'] ?? ''
	);
	const replyToHeader = normalizeWhitespace(
		leadingMetadata['reply-to-recipients'] ?? ''
	);
	const threadTopicHeader = normalizeWhitespace(
		leadingMetadata['conversation-topic'] ??
			leadingMetadata['thread-topic'] ??
			''
	);
	const subjectHeader = normalizeWhitespace(
		leadingMetadata['normalized-subject'] ?? ''
	);
	const conversationIdHeader = normalizeWhitespace(
		leadingMetadata['conversation-id'] ?? ''
	);
	const threadIndexHeader = normalizeWhitespace(
		leadingMetadata['conversation-index'] ?? ''
	);
	const inReplyToHeader = normalizeWhitespace(
		leadingMetadata['parent-message-id'] ?? ''
	);
	const referencesHeader = normalizeWhitespace(
		leadingMetadata['reference-chain'] ?? ''
	);
	const sentHeader = normalizeWhitespace(
		leadingMetadata.sent ??
			leadingMetadata['client-submit-time'] ??
			leadingMetadata['creation-time'] ??
			''
	);
	const messageIdHeader = normalizeWhitespace(
		leadingMetadata['internet-message-id'] ?? ''
	);

	if (!headers.has('from') && senderHeader) {
		syntheticHeaderLines.push(`From: ${senderHeader}`);
	}
	if (!headers.has('to') && toHeader) {
		syntheticHeaderLines.push(`To: ${toHeader}`);
	}
	if (!headers.has('cc') && ccHeader) {
		syntheticHeaderLines.push(`Cc: ${ccHeader}`);
	}
	if (!headers.has('bcc') && bccHeader) {
		syntheticHeaderLines.push(`Bcc: ${bccHeader}`);
	}
	if (!headers.has('reply-to') && replyToHeader) {
		syntheticHeaderLines.push(`Reply-To: ${replyToHeader}`);
	}
	if (!headers.has('thread-topic') && threadTopicHeader) {
		syntheticHeaderLines.push(`Thread-Topic: ${threadTopicHeader}`);
	}
	if (!headers.has('subject') && subjectHeader) {
		syntheticHeaderLines.push(`Subject: ${subjectHeader}`);
	}
	if (!headers.has('conversation-id') && conversationIdHeader) {
		syntheticHeaderLines.push(`Conversation-ID: ${conversationIdHeader}`);
	}
	if (!headers.has('thread-index') && threadIndexHeader) {
		syntheticHeaderLines.push(`Thread-Index: ${threadIndexHeader}`);
	}
	if (!headers.has('in-reply-to') && inReplyToHeader) {
		syntheticHeaderLines.push(`In-Reply-To: ${inReplyToHeader}`);
	}
	if (!headers.has('references') && referencesHeader) {
		syntheticHeaderLines.push(`References: ${referencesHeader}`);
	}
	if (!headers.has('date') && sentHeader) {
		syntheticHeaderLines.push(`Date: ${sentHeader}`);
	}
	if (!headers.has('message-id') && messageIdHeader) {
		syntheticHeaderLines.push(`Message-ID: ${messageIdHeader}`);
	}

	if (syntheticHeaderLines.length === 0) {
		return messageRaw;
	}

	const normalizedHeaderBlock = normalizeWhitespace(headerBlock);
	const normalizedBody = normalizeWhitespace(body);
	return [
		...syntheticHeaderLines,
		...(normalizedHeaderBlock ? [normalizedHeaderBlock] : []),
		'',
		...(normalizedBody ? [normalizedBody] : [])
	]
		.join('\n')
		.trim();
};

type ParsedMailboxContainerMessage = {
	attachments?: {
		contentId?: string;
		contentLocation?: string;
		contentType?: string;
		data: Uint8Array;
		dispositionType?: string;
		fileName: string;
		role: 'attached_message' | 'file_attachment' | 'inline_resource';
	}[];
	metadata: Record<string, unknown>;
	raw: string;
};

const decodeMailboxContainerAttachmentData = (
	value: string,
	encoding: string | undefined
) => {
	const normalized = normalizeWhitespace(value);
	if (!normalized) {
		return undefined;
	}

	const format = normalizeWhitespace(encoding ?? '').toLowerCase();
	try {
		if (format === 'base64') {
			return Uint8Array.from(Buffer.from(normalized, 'base64'));
		}
		if (format === 'hex') {
			return Uint8Array.from(Buffer.from(normalized, 'hex'));
		}
		return Uint8Array.from(Buffer.from(value, 'utf8'));
	} catch {
		return undefined;
	}
};

const extractMailboxRecoveredEmbeddedReferences = (raw: string) => {
	const { body } = splitEmailMessage(raw);
	const normalizedBody = body.replace(/\r\n?/g, '\n');
	const contentIds = [
		...new Set(
			Array.from(
				normalizedBody.matchAll(/cid:([A-Za-z0-9._%+\-@:$]+)/gi),
				(match) => normalizeEmailContentId(match[1])
			).filter((value): value is string => typeof value === 'string')
		)
	];

	return {
		contentIds,
		contentLocations: normalizedBody
			.split(/\s+/)
			.map((token) =>
				normalizeWhitespace(
					token.replace(/^[("'`<]+|[)"'`>,.;:!?]+$/g, '')
				)
			)
			.filter((token) => token.includes('/') || token.includes('.'))
	};
};

const splitMailboxContainerMessages = (
	raw: string
): ParsedMailboxContainerMessage[] => {
	const normalized = raw.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const segments: string[] = [];
	let currentLines: string[] = [];
	let sawBody = false;
	let seenEmailHeaders = new Set<string>();

	const pushCurrent = () => {
		const segment = normalizeWhitespace(currentLines.join('\n'));
		if (segment) {
			segments.push(segment);
		}
		currentLines = [];
		sawBody = false;
		seenEmailHeaders = new Set<string>();
	};

	for (const line of lines) {
		const headerMatch = line.match(/^([A-Za-z-]+):\s*(.*)$/);
		const key = headerMatch?.[1]?.toLowerCase() ?? '';
		const isDecorator = MAILBOX_CONTAINER_DECORATOR_KEYS.has(key);
		const isEmailHeader = MAILBOX_CONTAINER_EMAIL_HEADER_KEYS.has(key);
		const startsNewDecoratedMessage =
			isDecorator &&
			currentLines.length > 0 &&
			(seenEmailHeaders.size > 0 || sawBody);
		const startsNewSubjectMessage =
			key === 'subject' &&
			currentLines.length > 0 &&
			(sawBody ||
				(seenEmailHeaders.has('subject') &&
					(seenEmailHeaders.has('message-id') ||
						seenEmailHeaders.has('from'))));

		if (startsNewDecoratedMessage || startsNewSubjectMessage) {
			pushCurrent();
		}

		currentLines.push(line);
		if (isEmailHeader) {
			seenEmailHeaders.add(key);
			continue;
		}
		if (line.trim().length === 0) {
			if (seenEmailHeaders.size > 0) {
				sawBody = true;
			}
			continue;
		}
		if (seenEmailHeaders.size > 0 && !isDecorator) {
			sawBody = true;
		}
	}

	pushCurrent();

	return segments
		.map((segment) => {
			const lines = segment.split('\n');
			const leadingMetadata: Record<string, string> = {};
			const attachmentDescriptorNames: string[] = [];
			const recoverableAttachments: NonNullable<
				ParsedMailboxContainerMessage['attachments']
			> = [];
			let currentAttachment:
				| {
						contentId?: string;
						contentLocation?: string;
						contentType?: string;
						dataValue?: string;
						dispositionType?: string;
						fileName?: string;
						transferEncoding?: string;
				  }
				| undefined;
			const pushCurrentAttachment = () => {
				if (
					!currentAttachment?.fileName ||
					!currentAttachment.dataValue
				) {
					currentAttachment = undefined;
					return;
				}

				const data = decodeMailboxContainerAttachmentData(
					currentAttachment.dataValue,
					currentAttachment.transferEncoding
				);
				if (!data || data.length === 0) {
					currentAttachment = undefined;
					return;
				}

				const normalizedContentType = normalizeWhitespace(
					currentAttachment.contentType ?? ''
				).toLowerCase();
				const role = normalizedContentType.includes('message/rfc822')
					? 'attached_message'
					: currentAttachment.dispositionType === 'inline' ||
						  typeof currentAttachment.contentId === 'string' ||
						  typeof currentAttachment.contentLocation === 'string'
						? 'inline_resource'
						: 'file_attachment';
				recoverableAttachments.push({
					contentId: currentAttachment.contentId,
					contentLocation: currentAttachment.contentLocation,
					contentType: currentAttachment.contentType,
					data,
					dispositionType: currentAttachment.dispositionType,
					fileName: currentAttachment.fileName,
					role
				});
				currentAttachment = undefined;
			};
			let startIndex = 0;
			for (; startIndex < lines.length; startIndex += 1) {
				const line = lines[startIndex] ?? '';
				const headerMatch = line.match(/^([A-Za-z-]+):\s*(.*)$/);
				if (!headerMatch) {
					continue;
				}
				const key = headerMatch[1]?.toLowerCase() ?? '';
				if (
					key === 'subject' ||
					key === 'from' ||
					key === 'to' ||
					key === 'cc' ||
					key === 'bcc' ||
					key === 'reply-to' ||
					key === 'thread-topic' ||
					key === 'date' ||
					key === 'message-id' ||
					key === 'in-reply-to' ||
					key === 'references' ||
					key === 'content-type'
				) {
					pushCurrentAttachment();
					break;
				}
				if (key === 'attachment') {
					const names = parseMailboxAttachmentNames(headerMatch[2]);
					attachmentDescriptorNames.push(...names);
					if (names.length === 1) {
						pushCurrentAttachment();
						currentAttachment = { fileName: names[0] };
					}
					continue;
				}
				if (key === 'attachments') {
					attachmentDescriptorNames.push(
						...parseMailboxAttachmentNames(headerMatch[2])
					);
					leadingMetadata[key] = headerMatch[2] ?? '';
					continue;
				}
				if (key === 'attachment-content-type') {
					if (currentAttachment) {
						currentAttachment.contentType = headerMatch[2] ?? '';
					}
					continue;
				}
				if (key === 'attachment-transfer-encoding') {
					if (currentAttachment) {
						currentAttachment.transferEncoding =
							headerMatch[2] ?? '';
					}
					continue;
				}
				if (key === 'attachment-data') {
					if (currentAttachment) {
						currentAttachment.dataValue = headerMatch[2] ?? '';
					}
					continue;
				}
				if (key === 'attachment-disposition') {
					if (currentAttachment) {
						currentAttachment.dispositionType = normalizeWhitespace(
							headerMatch[2] ?? ''
						).toLowerCase();
					}
					continue;
				}
				if (key === 'attachment-content-id') {
					if (currentAttachment) {
						currentAttachment.contentId = normalizeWhitespace(
							headerMatch[2] ?? ''
						);
					}
					continue;
				}
				if (key === 'attachment-content-location') {
					if (currentAttachment) {
						currentAttachment.contentLocation = normalizeWhitespace(
							headerMatch[2] ?? ''
						);
					}
					continue;
				}
				if (
					key === 'folder' ||
					key === 'mailbox' ||
					key === 'sender' ||
					key === 'sender-name' ||
					key === 'sender-email' ||
					key === 'recipients' ||
					key === 'to-recipients' ||
					key === 'cc-recipients' ||
					key === 'bcc-recipients' ||
					key === 'reply-to-recipients' ||
					key === 'sent' ||
					key === 'received' ||
					key === 'internet-message-id' ||
					key === 'client-submit-time' ||
					key === 'delivery-time' ||
					key === 'creation-time' ||
					key === 'last-modified-time' ||
					key === 'parent-message-id' ||
					key === 'reference-chain' ||
					key === 'message-class' ||
					key === 'categories' ||
					key === 'conversation-id' ||
					key === 'conversation-index' ||
					key === 'conversation-topic' ||
					key === 'flags' ||
					key === 'has-attachments' ||
					key === 'importance' ||
					key === 'normalized-subject' ||
					key === 'read' ||
					key === 'sensitivity' ||
					key === 'thread-topic' ||
					key === 'unread' ||
					key === 'flagged' ||
					key === 'replied' ||
					key === 'answered' ||
					key === 'draft' ||
					key === 'passed' ||
					key === 'forwarded' ||
					key === 'trashed' ||
					key === 'deleted'
				) {
					leadingMetadata[key] = headerMatch[2] ?? '';
				}
			}
			pushCurrentAttachment();

			const messageRaw = buildMailboxContainerSyntheticHeaders(
				normalizeWhitespace(lines.slice(startIndex).join('\n')),
				leadingMetadata
			);
			const mailboxFolderValue =
				leadingMetadata.folder ?? leadingMetadata.mailbox;
			const attachmentNames = [
				...new Set([
					...attachmentDescriptorNames,
					...parseMailboxAttachmentNames(leadingMetadata.attachments)
				])
			];
			const categories = parseMailboxAttachmentNames(
				leadingMetadata.categories
			);
			const explicitStateFlags = parseMailboxStateFlags(
				leadingMetadata.flags
			);
			const booleanStateFlags = parseMailboxStateFlags(
				[
					leadingMetadata.read === 'true' ? 'read' : undefined,
					leadingMetadata.unread === 'true' ? 'unread' : undefined,
					leadingMetadata.flagged === 'true' ? 'flagged' : undefined,
					leadingMetadata.replied === 'true' ||
					leadingMetadata.answered === 'true'
						? 'replied'
						: undefined,
					leadingMetadata.draft === 'true' ? 'draft' : undefined,
					leadingMetadata.passed === 'true' ||
					leadingMetadata.forwarded === 'true'
						? 'passed'
						: undefined,
					leadingMetadata.trashed === 'true' ||
					leadingMetadata.deleted === 'true'
						? 'trashed'
						: undefined
				]
					.filter(
						(value): value is string => typeof value === 'string'
					)
					.join(' ')
			);
			const stateFlags = [
				...new Set([...explicitStateFlags, ...booleanStateFlags])
			];

			return {
				metadata: {
					...parseMailboxFolderMetadata(mailboxFolderValue),
					...buildMailboxStateMetadata(stateFlags),
					...(attachmentNames.length > 0
						? {
								attachmentCount: attachmentNames.length,
								attachmentNames,
								hasAttachments: true
							}
						: leadingMetadata['has-attachments'] === 'true'
							? {
									attachmentCount: 1,
									hasAttachments: true
								}
							: {}),
					...(categories.length > 0
						? { emailCategories: categories }
						: {}),
					...(typeof leadingMetadata.importance === 'string' &&
					leadingMetadata.importance.trim().length > 0
						? {
								emailImportance: normalizeWhitespace(
									leadingMetadata.importance
								)
							}
						: {}),
					...(typeof leadingMetadata['normalized-subject'] ===
						'string' &&
					leadingMetadata['normalized-subject'].trim().length > 0
						? {
								emailNormalizedSubject: normalizeWhitespace(
									leadingMetadata['normalized-subject']
								)
							}
						: {}),
					...(typeof leadingMetadata.sensitivity === 'string' &&
					leadingMetadata.sensitivity.trim().length > 0
						? {
								emailSensitivity: normalizeWhitespace(
									leadingMetadata.sensitivity
								)
							}
						: {}),
					...(typeof leadingMetadata['conversation-topic'] ===
						'string' &&
					leadingMetadata['conversation-topic'].trim().length > 0
						? {
								emailConversationTopic: normalizeWhitespace(
									leadingMetadata['conversation-topic']
								),
								threadTopic: normalizeWhitespace(
									leadingMetadata['conversation-topic']
								)
							}
						: typeof leadingMetadata['thread-topic'] === 'string' &&
							  leadingMetadata['thread-topic'].trim().length > 0
							? {
									threadTopic: normalizeWhitespace(
										leadingMetadata['thread-topic']
									)
								}
							: {}),
					...(typeof leadingMetadata['conversation-id'] ===
						'string' &&
					leadingMetadata['conversation-id'].trim().length > 0
						? {
								emailConversationId: normalizeWhitespace(
									leadingMetadata['conversation-id']
								)
							}
						: {}),
					...(typeof leadingMetadata['conversation-index'] ===
						'string' &&
					leadingMetadata['conversation-index'].trim().length > 0
						? {
								emailConversationIndex: normalizeWhitespace(
									leadingMetadata['conversation-index']
								)
							}
						: {}),
					...(typeof leadingMetadata.sent === 'string' &&
					leadingMetadata.sent.trim().length > 0
						? {
								emailSentAt: normalizeWhitespace(
									leadingMetadata.sent
								)
							}
						: typeof leadingMetadata['client-submit-time'] ===
									'string' &&
							  leadingMetadata['client-submit-time'].trim()
									.length > 0
							? {
									emailSentAt: normalizeWhitespace(
										leadingMetadata['client-submit-time']
									)
								}
							: typeof leadingMetadata['creation-time'] ===
										'string' &&
								  leadingMetadata['creation-time'].trim()
										.length > 0
								? {
										emailSentAt: normalizeWhitespace(
											leadingMetadata['creation-time']
										)
									}
								: {}),
					...(typeof leadingMetadata.received === 'string' &&
					leadingMetadata.received.trim().length > 0
						? {
								emailReceivedAt: normalizeWhitespace(
									leadingMetadata.received
								)
							}
						: typeof leadingMetadata['delivery-time'] ===
									'string' &&
							  leadingMetadata['delivery-time'].trim().length > 0
							? {
									emailReceivedAt: normalizeWhitespace(
										leadingMetadata['delivery-time']
									)
								}
							: {}),
					...(typeof leadingMetadata['internet-message-id'] ===
						'string' &&
					leadingMetadata['internet-message-id'].trim().length > 0
						? {
								emailInternetMessageId: normalizeWhitespace(
									leadingMetadata['internet-message-id']
								)
							}
						: {}),
					...(typeof leadingMetadata['client-submit-time'] ===
						'string' &&
					leadingMetadata['client-submit-time'].trim().length > 0
						? {
								emailClientSubmitTime: normalizeWhitespace(
									leadingMetadata['client-submit-time']
								)
							}
						: {}),
					...(typeof leadingMetadata['delivery-time'] === 'string' &&
					leadingMetadata['delivery-time'].trim().length > 0
						? {
								emailDeliveryTime: normalizeWhitespace(
									leadingMetadata['delivery-time']
								)
							}
						: {}),
					...(typeof leadingMetadata['creation-time'] === 'string' &&
					leadingMetadata['creation-time'].trim().length > 0
						? {
								emailCreationTime: normalizeWhitespace(
									leadingMetadata['creation-time']
								)
							}
						: {}),
					...(typeof leadingMetadata['last-modified-time'] ===
						'string' &&
					leadingMetadata['last-modified-time'].trim().length > 0
						? {
								emailLastModifiedTime: normalizeWhitespace(
									leadingMetadata['last-modified-time']
								)
							}
						: {}),
					...(typeof leadingMetadata['message-class'] === 'string' &&
					leadingMetadata['message-class'].trim().length > 0
						? {
								emailMessageClass: normalizeWhitespace(
									leadingMetadata['message-class']
								)
							}
						: {})
				},
				...(recoverableAttachments.length > 0
					? { attachments: recoverableAttachments }
					: {}),
				raw: messageRaw
			};
		})
		.filter((segment) => {
			const { headerBlock } = splitEmailMessage(segment.raw);
			const headers = parseHeaderBlock(headerBlock);
			return (
				headers.size >= 3 &&
				(headers.has('subject') || headers.has('message-id')) &&
				(headers.has('from') ||
					headers.has('to') ||
					headers.has('date'))
			);
		});
};

const decodeEmlxMessageData = (data: Uint8Array) => {
	if (data.length === 0) {
		return {
			hasTrailingMetadata: false,
			messageByteLength: 0,
			raw: ''
		};
	}

	let lineEnd = data.indexOf(0x0a);
	if (lineEnd < 0) {
		lineEnd = data.length;
	}
	const headerLine = Buffer.from(data.slice(0, lineEnd))
		.toString('utf8')
		.replace(/\r$/, '')
		.trim();
	const messageByteLength = Number.parseInt(headerLine, 10);
	if (!Number.isFinite(messageByteLength) || messageByteLength <= 0) {
		return {
			hasTrailingMetadata: false,
			messageByteLength: undefined,
			raw: decodeUtf8(data)
		};
	}

	let messageOffset = lineEnd;
	while (
		messageOffset < data.length &&
		(data[messageOffset] === 0x0a || data[messageOffset] === 0x0d)
	) {
		messageOffset += 1;
	}
	const messageEnd = Math.min(data.length, messageOffset + messageByteLength);
	return {
		hasTrailingMetadata: messageEnd < data.length,
		messageByteLength,
		raw: decodeUtf8(data.slice(messageOffset, messageEnd))
	};
};

const MAILDIR_FOLDER_NAMES = new Set(['cur', 'new']);

const isLikelyRawEmailData = (raw: string) => {
	const { headerBlock } = splitEmailMessage(raw);
	if (!headerBlock || !headerBlock.includes(':')) {
		return false;
	}

	const headers = parseHeaderBlock(headerBlock);
	let score = 0;
	for (const name of [
		'from',
		'to',
		'subject',
		'date',
		'message-id',
		'in-reply-to',
		'references',
		'content-type',
		'return-path',
		'delivered-to'
	]) {
		if (headers.has(name)) {
			score += 1;
		}
	}

	return score >= 2;
};

const parseMaildirMetadata = (source: string | undefined) => {
	if (!source) {
		return undefined;
	}

	const normalized = source.replace(/\\/g, '/');
	const segments = normalized.split('/').filter(Boolean);
	const folderIndex = segments.findLastIndex((segment) =>
		MAILDIR_FOLDER_NAMES.has(segment)
	);
	if (folderIndex < 0) {
		return undefined;
	}

	const folder = segments[folderIndex];
	const fileName = segments.at(-1);
	if (!folder || !fileName) {
		return undefined;
	}

	const [maildirKey, flagSuffix] = fileName.split(':2,');
	const flags = flagSuffix
		? [...new Set(flagSuffix.split('').filter(Boolean).sort())]
		: [];
	const stateFlags = [
		...(flags.includes('D') ? ['draft'] : []),
		...(flags.includes('F') ? ['flagged'] : []),
		...(flags.includes('P') ? ['passed'] : []),
		...(flags.includes('R') ? ['replied'] : []),
		...(flags.includes('S') ? ['read'] : ['unread']),
		...(flags.includes('T') ? ['trashed'] : [])
	];
	const pathSegments = segments.slice(0, folderIndex);
	const containerSource = pathSegments.join('/');
	const familyKey = pathSegments
		.map((segment) => segment.trim().toLowerCase())
		.filter(Boolean)
		.join('/');
	const leaf = pathSegments.at(-1);

	return {
		emailMailboxFormat: 'maildir',
		emailMailboxFolder: folder,
		...(familyKey ? { emailMailboxFamilyKey: familyKey } : {}),
		...(leaf ? { emailMailboxLeaf: leaf } : {}),
		...(pathSegments.length > 0
			? {
					emailMailboxPathDepth: pathSegments.length,
					emailMailboxPathSegments: pathSegments
				}
			: {}),
		...(containerSource
			? { emailMailboxContainerSource: containerSource }
			: {}),
		...(flags.length > 0 ? { emailMailboxFlags: flags } : {}),
		...(stateFlags.length > 0
			? { emailMailboxStateFlags: stateFlags }
			: {}),
		emailMailboxIsDraft: flags.includes('D'),
		emailMailboxIsFlagged: flags.includes('F'),
		emailMailboxIsPassed: flags.includes('P'),
		emailMailboxIsRead: flags.includes('S'),
		emailMailboxIsReplied: flags.includes('R'),
		emailMailboxIsTrashed: flags.includes('T'),
		emailMailboxIsUnread: !flags.includes('S'),
		...(maildirKey ? { emailMailboxKey: maildirKey } : {})
	};
};

const parseHeaderBlock = (headerBlock: string) => {
	const unfolded = headerBlock.replace(/\n[ \t]+/g, ' ');
	const headers = new Map<string, string>();

	for (const line of unfolded.split('\n')) {
		const separator = line.indexOf(':');
		if (separator < 0) {
			continue;
		}

		headers.set(
			line.slice(0, separator).trim().toLowerCase(),
			line.slice(separator + 1).trim()
		);
	}

	return headers;
};

const decodeQuotedPrintable = (value: string) =>
	value
		.replace(/=\r?\n/g, '')
		.replace(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
			String.fromCharCode(parseInt(hex, 16))
		);

const decodeEmailPartBody = (body: string, encoding: string | undefined) => {
	const normalizedEncoding = encoding?.toLowerCase();
	const trimmed = body.trim();

	if (normalizedEncoding === 'base64') {
		return new Uint8Array(
			Buffer.from(trimmed.replace(/\s+/g, ''), 'base64')
		);
	}

	if (normalizedEncoding === 'quoted-printable') {
		return new Uint8Array(Buffer.from(decodeQuotedPrintable(body), 'utf8'));
	}

	return new Uint8Array(Buffer.from(body, 'utf8'));
};

const parseMimeBoundary = (contentType: string | undefined) => {
	const match = contentType?.match(/boundary="?([^";]+)"?/i);
	return match?.[1];
};

const EMAIL_ATTACHMENT_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
	'application/gzip': '.gz',
	'application/json': '.json',
	'application/pdf': '.pdf',
	'application/rtf': '.rtf',
	'application/zip': '.zip',
	'application/x-gzip': '.gz',
	'application/xml': '.xml',
	'image/gif': '.gif',
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/svg+xml': '.svg',
	'message/rfc822': '.eml',
	'text/csv': '.csv',
	'text/html': '.html',
	'text/markdown': '.md',
	'text/plain': '.txt',
	'text/tsv': '.tsv',
	'text/xml': '.xml'
};

const normalizeEmailContentId = (value: string | undefined) => {
	const normalized = normalizeWhitespace(value ?? '')
		.replace(/^cid:/i, '')
		.replace(/^<|>$/g, '');
	return normalized ? `<${normalized}>` : undefined;
};

const inferEmailAttachmentExtension = (contentType: string | undefined) => {
	if (!contentType) {
		return '.bin';
	}

	const normalized = contentType.split(';')[0]?.trim().toLowerCase();
	return (
		(normalized
			? EMAIL_ATTACHMENT_EXTENSION_BY_CONTENT_TYPE[normalized]
			: undefined) ?? '.bin'
	);
};

const inferEmailAttachmentName = ({
	contentId,
	contentLocation,
	contentType,
	filename
}: {
	contentId?: string;
	contentLocation?: string;
	contentType?: string;
	filename?: string;
}) => {
	if (filename) {
		return filename;
	}

	if (contentLocation) {
		const locationHead = contentLocation.split(/[?#]/)[0];
		const normalizedLocation = locationHead?.split(/[/\\]/).pop()?.trim();
		if (normalizedLocation) {
			return normalizedLocation;
		}
	}

	const contentIdToken = contentId
		?.replace(/^<|>$/g, '')
		.replace(/[^a-z0-9._-]+/gi, '-')
		.replace(/^-+|-+$/g, '');
	if (contentIdToken) {
		return `${contentIdToken}${inferEmailAttachmentExtension(contentType)}`;
	}

	return `email-attachment${inferEmailAttachmentExtension(contentType)}`;
};

const parseEmailEmbeddedResourceReferences = (bodyHtml: string | undefined) => {
	if (!bodyHtml) {
		return {
			contentIds: [] as string[],
			contentLocations: [] as string[]
		};
	}

	const contentIds = [
		...new Set(
			Array.from(bodyHtml.matchAll(/cid:([^"'>\s)]+)/gi), (match) =>
				normalizeEmailContentId(match[1])
			).filter((value): value is string => Boolean(value))
		)
	];
	const contentLocations = [
		...new Set(
			Array.from(
				bodyHtml.matchAll(/\b(?:src|href)=["']([^"'#][^"']*)["']/gi),
				(match) => normalizeWhitespace(match[1] ?? '')
			).filter(
				(value) =>
					Boolean(value) &&
					!/^(?:https?:|mailto:|data:|cid:)/i.test(value)
			)
		)
	];

	return {
		contentIds,
		contentLocations
	};
};

type ParsedEmailAddressEntry = {
	address: string;
	displayName?: string;
	raw: string;
};

const parseEmailAddressList = (value: string | undefined) => {
	if (!value) {
		return {
			addresses: [] as string[],
			displayNames: [] as string[],
			entries: [] as ParsedEmailAddressEntry[]
		};
	}

	const tokens = value
		.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
		.map((entry) => normalizeWhitespace(entry))
		.filter(Boolean);
	const entries = tokens
		.map((entry) => {
			const angleMatch = entry.match(/^(.*?)(?:<([^>]+)>)$/);
			if (angleMatch) {
				const address = normalizeWhitespace(
					angleMatch[2]?.trim().toLowerCase() ?? ''
				);
				if (!address) {
					return undefined;
				}
				const displayName = normalizeWhitespace(
					(angleMatch[1] ?? '').trim().replace(/^"+|"+$/g, '')
				);
				return {
					address,
					...(displayName ? { displayName } : {}),
					raw: entry
				};
			}
			const bareAddressMatch =
				entry.match(
					/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
				)?.[0] ?? '';
			const address = normalizeWhitespace(
				bareAddressMatch.trim().toLowerCase()
			);
			if (!address) {
				return undefined;
			}
			const displayName = normalizeWhitespace(
				entry.replace(bareAddressMatch, '').replace(/[()"]/g, '')
			);
			return {
				address,
				...(displayName ? { displayName } : {}),
				raw: entry
			};
		})
		.filter((entry): entry is ParsedEmailAddressEntry => Boolean(entry));

	return {
		addresses: entries.map((entry) => entry.address),
		displayNames: entries
			.map((entry) => entry.displayName)
			.filter((value): value is string => typeof value === 'string'),
		entries
	};
};

const normalizeEmailTimestamp = (value: string | undefined) => {
	if (!value) {
		return undefined;
	}

	const candidates = [
		value,
		value
			.replace(/\bat\b/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim(),
		`${value
			.replace(/\bat\b/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim()} UTC`
	];

	for (const candidate of candidates) {
		const timestamp = Date.parse(candidate);
		if (Number.isFinite(timestamp)) {
			return new Date(timestamp).toISOString();
		}
	}

	return undefined;
};

const parseEmailMessageLineage = (
	metadata?: Record<string, unknown>
): EmailMessageLineageEntry[] => {
	if (!Array.isArray(metadata?.emailMessageLineage)) {
		return [];
	}

	return metadata.emailMessageLineage
		.map((entry) => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				return undefined;
			}

			const attachmentSource =
				typeof entry.attachmentSource === 'string' &&
				entry.attachmentSource.length > 0
					? entry.attachmentSource
					: undefined;
			const messageId =
				typeof entry.messageId === 'string' &&
				entry.messageId.length > 0
					? entry.messageId
					: undefined;
			const messageSource =
				typeof entry.messageSource === 'string' &&
				entry.messageSource.length > 0
					? entry.messageSource
					: undefined;
			const messageSourceKind =
				typeof entry.messageSourceKind === 'string' &&
				entry.messageSourceKind.length > 0
					? entry.messageSourceKind
					: undefined;
			const threadKey =
				typeof entry.threadKey === 'string' &&
				entry.threadKey.length > 0
					? entry.threadKey
					: undefined;

			if (
				!attachmentSource &&
				!messageId &&
				!messageSource &&
				!messageSourceKind &&
				!threadKey
			) {
				return undefined;
			}

			return {
				...(attachmentSource ? { attachmentSource } : {}),
				...(messageId ? { messageId } : {}),
				...(messageSource ? { messageSource } : {}),
				...(messageSourceKind ? { messageSourceKind } : {}),
				...(threadKey ? { threadKey } : {})
			};
		})
		.filter((entry): entry is EmailMessageLineageEntry => Boolean(entry));
};

const EMAIL_FORWARDED_HEADER_PATTERN =
	/^(?:from|sent|to|cc|bcc|subject|date|reply-to):\s+/i;
const EMAIL_FORWARDED_SEPARATOR_PATTERN =
	/^-{2,}\s*forwarded message\s*-{2,}$/i;
const EMAIL_HTML_QUOTE_OPEN_TOKEN = '[[ABS_EMAIL_QUOTE_OPEN]]';
const EMAIL_HTML_QUOTE_CLOSE_TOKEN = '[[ABS_EMAIL_QUOTE_CLOSE]]';

const classifyEmailBodyLine = (
	line: string,
	currentKind?: EmailBodySection['kind']
): EmailBodySection['kind'] | undefined => {
	const trimmed = line.trim();
	if (!trimmed) {
		return currentKind;
	}
	if (/^>+/.test(trimmed)) {
		return 'quoted_history';
	}
	if (/^on .+wrote:$/i.test(trimmed)) {
		return 'quoted_history';
	}
	if (EMAIL_FORWARDED_SEPARATOR_PATTERN.test(trimmed)) {
		return 'forwarded_headers';
	}
	if (
		currentKind === 'forwarded_headers' &&
		(EMAIL_FORWARDED_HEADER_PATTERN.test(trimmed) ||
			/^[A-Za-z-]+:\s+\S+/.test(trimmed))
	) {
		return 'forwarded_headers';
	}
	if (EMAIL_FORWARDED_HEADER_PATTERN.test(trimmed)) {
		return 'forwarded_headers';
	}
	return 'authored_text';
};

const parseEmailForwardedHeaderFields = (lines: string[]) => {
	const fields: Record<string, string> = {};

	for (const line of lines) {
		const trimmed = line.trim();
		const match = trimmed.match(/^([A-Za-z-]+):\s*(.+)$/);
		if (!match) {
			continue;
		}
		const key = normalizeWhitespace(match[1] ?? '').toLowerCase();
		const value = normalizeWhitespace(match[2] ?? '');
		if (!key || !value) {
			continue;
		}
		fields[key] = value;
	}

	return Object.keys(fields).length > 0 ? fields : undefined;
};

const parseForwardedHeaderMetadata = (lines: string[]) => {
	const forwardedHeaderFields = parseEmailForwardedHeaderFields(lines);
	const from = forwardedHeaderFields?.from;
	const to = forwardedHeaderFields?.to;
	const cc = forwardedHeaderFields?.cc;
	const bcc = forwardedHeaderFields?.bcc;
	const replyTo = forwardedHeaderFields?.['reply-to'];
	const fromParsed = parseEmailAddressList(from);
	const toParsed = parseEmailAddressList(to);
	const ccParsed = parseEmailAddressList(cc);
	const bccParsed = parseEmailAddressList(bcc);
	const replyToParsed = parseEmailAddressList(replyTo);
	const forwardedParticipantAddresses = [
		...new Set([
			...fromParsed.addresses,
			...toParsed.addresses,
			...ccParsed.addresses,
			...bccParsed.addresses,
			...replyToParsed.addresses
		])
	];

	return {
		...(forwardedHeaderFields ? { forwardedHeaderFields } : {}),
		...(fromParsed.addresses[0]
			? { forwardedFromAddress: fromParsed.addresses[0] }
			: {}),
		...(fromParsed.displayNames[0]
			? { forwardedFromDisplayName: fromParsed.displayNames[0] }
			: {}),
		...(toParsed.addresses.length > 0
			? { forwardedToAddresses: toParsed.addresses }
			: {}),
		...(ccParsed.addresses.length > 0
			? { forwardedCcAddresses: ccParsed.addresses }
			: {}),
		...(bccParsed.addresses.length > 0
			? { forwardedBccAddresses: bccParsed.addresses }
			: {}),
		...(replyToParsed.addresses.length > 0
			? { forwardedReplyToAddresses: replyToParsed.addresses }
			: {}),
		...(forwardedParticipantAddresses.length > 0
			? { forwardedParticipantAddresses }
			: {}),
		...(forwardedHeaderFields?.subject
			? { forwardedSubject: forwardedHeaderFields.subject }
			: {}),
		...(forwardedHeaderFields?.date
			? { forwardedDate: forwardedHeaderFields.date }
			: {}),
		...(forwardedHeaderFields?.date
			? {
					forwardedTimestamp: normalizeEmailTimestamp(
						forwardedHeaderFields.date
					)
				}
			: {})
	};
};

const getEmailQuotedDepth = (lines: string[]) => {
	let depth = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^on .+wrote:$/i.test(trimmed)) {
			depth = Math.max(depth, 1);
			continue;
		}
		const quoteDepth = (trimmed.match(/^>+/)?.[0].length ?? 0) || 0;
		depth = Math.max(depth, quoteDepth);
	}
	return depth || undefined;
};

const parseEmailBodySections = (text: string): EmailBodySection[] => {
	const normalized = text.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const sections: EmailBodySection[] = [];
	let currentKind: EmailBodySection['kind'] | undefined;
	let currentLines: string[] = [];

	const pushCurrent = () => {
		if (!currentKind) {
			currentLines = [];
			return;
		}
		const sectionText = normalizeWhitespace(currentLines.join('\n'));
		if (sectionText) {
			sections.push({
				...(currentKind === 'quoted_history'
					? {
							quotedDepth: getEmailQuotedDepth(currentLines)
						}
					: {}),
				...(currentKind === 'forwarded_headers'
					? parseForwardedHeaderMetadata(currentLines)
					: {}),
				kind: currentKind,
				text: sectionText
			});
		}
		currentKind = undefined;
		currentLines = [];
	};

	for (const line of lines) {
		const nextKind = classifyEmailBodyLine(line, currentKind);
		if (!nextKind) {
			continue;
		}
		if (
			currentKind === 'forwarded_headers' &&
			nextKind === 'forwarded_headers' &&
			EMAIL_FORWARDED_SEPARATOR_PATTERN.test(line.trim()) &&
			currentLines.some((entry) => normalizeWhitespace(entry).length > 0)
		) {
			pushCurrent();
			currentKind = 'forwarded_headers';
			currentLines.push(line);
			continue;
		}
		if (!currentKind) {
			currentKind = nextKind;
			currentLines.push(line);
			continue;
		}
		if (nextKind !== currentKind) {
			pushCurrent();
			currentKind = nextKind;
		}
		currentLines.push(line);
	}

	pushCurrent();

	const merged: EmailBodySection[] = [];
	for (const section of sections) {
		const previous = merged.at(-1);
		if (
			previous &&
			previous.kind === section.kind &&
			section.kind !== 'forwarded_headers'
		) {
			previous.text = normalizeWhitespace(
				`${previous.text}\n\n${section.text}`
			);
			if (
				section.kind === 'quoted_history' &&
				typeof section.quotedDepth === 'number'
			) {
				previous.quotedDepth = Math.max(
					previous.quotedDepth ?? 0,
					section.quotedDepth
				);
			}
			continue;
		}
		merged.push({ ...section });
	}

	return merged;
};

const stripEmailHtml = (value: string) => {
	const focused = extractMainHtmlContent(value)
		.replace(/<blockquote\b[^>]*>/gi, `\n${EMAIL_HTML_QUOTE_OPEN_TOKEN}\n`)
		.replace(/<\/blockquote>/gi, `\n${EMAIL_HTML_QUOTE_CLOSE_TOKEN}\n`);
	const stripped = stripHtmlTags(focused);
	const lines = stripped.replace(/\r\n?/g, '\n').split('\n');
	const rendered: string[] = [];
	let quotedDepth = 0;

	for (const line of lines) {
		const trimmed = normalizeWhitespace(line);
		if (!trimmed) {
			if (rendered.at(-1) !== '') {
				rendered.push('');
			}
			continue;
		}
		if (trimmed === EMAIL_HTML_QUOTE_OPEN_TOKEN) {
			quotedDepth += 1;
			continue;
		}
		if (trimmed === EMAIL_HTML_QUOTE_CLOSE_TOKEN) {
			quotedDepth = Math.max(quotedDepth - 1, 0);
			continue;
		}

		const prefixed =
			quotedDepth > 0 ? `${'>'.repeat(quotedDepth)} ${trimmed}` : trimmed;
		rendered.push(prefixed);
	}

	return normalizeWhitespace(rendered.join('\n').replace(/\n{2,}/g, '\n'));
};

const scoreEmailBodyCandidate = (candidate: string | undefined) => {
	if (!candidate) {
		return Number.NEGATIVE_INFINITY;
	}

	const sections = parseEmailBodySections(candidate);
	const structuralScore = sections.reduce((score, section) => {
		if (section.kind === 'forwarded_headers') {
			return score + 8;
		}
		if (section.kind === 'quoted_history') {
			return score + 6 + (section.quotedDepth ?? 0);
		}

		return score + 1;
	}, 0);

	return structuralScore * 10 + Math.min(candidate.length, 5_000) / 100;
};

const choosePreferredEmailBodyText = (
	htmlText: string | undefined,
	plainText: string | undefined
) => {
	const htmlScore = scoreEmailBodyCandidate(htmlText);
	const plainScore = scoreEmailBodyCandidate(plainText);

	return htmlScore >= plainScore ? htmlText : plainText;
};

const chooseEmailBodyCandidate = (
	current: string | undefined,
	candidate: string | undefined
) => {
	if (!candidate) {
		return current;
	}
	if (!current) {
		return candidate;
	}

	return candidate.length > current.length ? candidate : current;
};

const parseEmailMimeParts = (
	body: string,
	contentType: string | undefined
): {
	bodyHtml?: string;
	bodyText?: string;
	attachments: {
		contentId?: string;
		contentLocation?: string;
		contentType?: string;
		data: Uint8Array;
		dispositionType?: string;
		fileName: string;
		role: 'attached_message' | 'file_attachment' | 'inline_resource';
	}[];
} => {
	const attachments: {
		contentId?: string;
		contentLocation?: string;
		contentType?: string;
		data: Uint8Array;
		dispositionType?: string;
		fileName: string;
		role: 'attached_message' | 'file_attachment' | 'inline_resource';
	}[] = [];
	let bodyText: string | undefined;
	let bodyHtml: string | undefined;
	const collectMimeParts = (
		partBody: string,
		partContentType: string | undefined
	) => {
		const boundary = parseMimeBoundary(partContentType);
		if (!boundary) {
			const htmlMatch = partBody.match(/<html[\s\S]*<\/html>/i);
			bodyHtml = chooseEmailBodyCandidate(bodyHtml, htmlMatch?.[0]);
			bodyText = chooseEmailBodyCandidate(
				bodyText,
				htmlMatch ? undefined : partBody
			);
			return;
		}

		for (const rawPart of partBody.split(`--${boundary}`)) {
			const trimmed = rawPart.trim();
			if (!trimmed || trimmed === '--') {
				continue;
			}

			const { body: nestedBody, headerBlock } =
				splitEmailMessage(trimmed);
			const headers = parseHeaderBlock(headerBlock);
			const nestedContentType = headers.get('content-type');
			const disposition = headers.get('content-disposition');
			const dispositionType = disposition
				?.split(';')[0]
				?.trim()
				.toLowerCase();
			const transferEncoding = headers.get('content-transfer-encoding');
			const contentId = normalizeEmailContentId(
				headers.get('content-id')
			);
			const contentLocation = normalizeWhitespace(
				headers.get('content-location') ?? ''
			);
			const filename =
				disposition?.match(/filename="?([^";]+)"?/i)?.[1] ??
				nestedContentType?.match(/name="?([^";]+)"?/i)?.[1];
			const decodedBytes = decodeEmailPartBody(
				nestedBody,
				transferEncoding
			);
			const decodedText = Buffer.from(decodedBytes).toString('utf8');
			const normalizedContentType =
				nestedContentType?.toLowerCase() ?? '';
			const isMultipart = normalizedContentType.startsWith('multipart/');
			const isHtml = normalizedContentType.includes('text/html');
			const isAttachedMessage =
				normalizedContentType.includes('message/rfc822');
			const isPlain = normalizedContentType.includes('text/plain');
			const isBodyLikeTextPart =
				(isHtml || isPlain) &&
				!filename &&
				dispositionType !== 'attachment' &&
				!contentId &&
				!contentLocation;

			if (isMultipart) {
				collectMimeParts(decodedText, nestedContentType);
				continue;
			}

			if (isBodyLikeTextPart) {
				if (isHtml) {
					bodyHtml = chooseEmailBodyCandidate(bodyHtml, decodedText);
					continue;
				}
				if (isPlain) {
					bodyText = chooseEmailBodyCandidate(bodyText, decodedText);
				}
				continue;
			}

			if (
				filename ||
				dispositionType === 'attachment' ||
				dispositionType === 'inline' ||
				contentId ||
				contentLocation
			) {
				attachments.push({
					contentId,
					contentLocation: contentLocation || undefined,
					contentType: nestedContentType,
					data: decodedBytes,
					dispositionType,
					fileName: inferEmailAttachmentName({
						contentId,
						contentLocation: contentLocation || undefined,
						contentType: nestedContentType,
						filename
					}),
					role: isAttachedMessage
						? 'attached_message'
						: dispositionType === 'inline' ||
							  contentId ||
							  contentLocation
							? 'inline_resource'
							: 'file_attachment'
				});
				continue;
			}

			if (isHtml) {
				bodyHtml = chooseEmailBodyCandidate(bodyHtml, decodedText);
				continue;
			}

			if (isPlain) {
				bodyText = chooseEmailBodyCandidate(bodyText, decodedText);
			}
		}
	};

	collectMimeParts(body, contentType);

	return {
		attachments,
		bodyHtml,
		bodyText
	};
};

const extractEmailText = (raw: string) => {
	const { body, headerBlock } = splitEmailMessage(raw);
	const headers = parseHeaderBlock(headerBlock);
	const parsed = parseEmailMimeParts(body, headers.get('content-type'));
	const htmlText = parsed.bodyHtml
		? stripEmailHtml(parsed.bodyHtml)
		: undefined;
	const plainText = parsed.bodyText
		? normalizeWhitespace(parsed.bodyText)
		: undefined;
	const preferredBodyText = choosePreferredEmailBodyText(htmlText, plainText);
	if (preferredBodyText) {
		return preferredBodyText;
	}
	if (!body) {
		return normalizeWhitespace(raw.replace(/\r\n?/g, '\n'));
	}

	const htmlMatch = body.match(/<html[\s\S]*<\/html>/i);
	if (htmlMatch) {
		return stripEmailHtml(htmlMatch[0]);
	}

	return normalizeWhitespace(body);
};

const parseEmailHeaders = (raw: string) => {
	const { headerBlock } = splitEmailMessage(raw);
	const headers = parseHeaderBlock(headerBlock);
	const getHeader = (name: string) => headers.get(name.toLowerCase());
	const from = getHeader('From');
	const to = getHeader('To');
	const cc = getHeader('Cc');
	const bcc = getHeader('Bcc');
	const replyTo = getHeader('Reply-To');
	const fromParsed = parseEmailAddressList(from);
	const toParsed = parseEmailAddressList(to);
	const ccParsed = parseEmailAddressList(cc);
	const bccParsed = parseEmailAddressList(bcc);
	const replyToParsed = parseEmailAddressList(replyTo);
	const participantAddresses = [
		...new Set([
			...fromParsed.addresses,
			...toParsed.addresses,
			...ccParsed.addresses,
			...bccParsed.addresses,
			...replyToParsed.addresses
		])
	];
	const participantDisplayNames = [
		...new Set([
			...fromParsed.displayNames,
			...toParsed.displayNames,
			...ccParsed.displayNames,
			...bccParsed.displayNames,
			...replyToParsed.displayNames
		])
	];

	return {
		bcc,
		bccAddressEntries: bccParsed.entries,
		bccAddresses: bccParsed.addresses,
		cc,
		ccAddressEntries: ccParsed.entries,
		ccAddresses: ccParsed.addresses,
		contentType: getHeader('Content-Type'),
		from,
		fromAddress: fromParsed.addresses[0],
		fromAddressEntries: fromParsed.entries,
		fromDisplayName: fromParsed.displayNames[0],
		inReplyTo: getHeader('In-Reply-To'),
		messageId: getHeader('Message-ID'),
		conversationId: getHeader('Conversation-ID'),
		participantAddresses,
		participantDisplayNames,
		replyTo,
		replyToAddressEntries: replyToParsed.entries,
		replyToAddresses: replyToParsed.addresses,
		references: getHeader('References'),
		subject: getHeader('Subject'),
		threadIndex: getHeader('Thread-Index'),
		threadTopic: getHeader('Thread-Topic') ?? getHeader('Subject'),
		to,
		toAddressEntries: toParsed.entries,
		toAddresses: toParsed.addresses
	};
};

const extractEmailDocumentsFromRawMessage = async (
	input: RAGFileExtractionInput,
	raw: string,
	options?: {
		metadata?: Record<string, unknown>;
		source?: string;
		title?: string;
	}
) => {
	const headers = parseEmailHeaders(raw);
	const { body } = splitEmailMessage(raw);
	const parsed = parseEmailMimeParts(body, headers.contentType);
	const source =
		options?.source ??
		input.source ??
		input.path ??
		input.name ??
		`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.eml`;
	const maildirMetadata = parseMaildirMetadata(source);
	const mergedMetadata = {
		...(input.metadata ?? {}),
		...(options?.metadata ?? {})
	};
	const referenceChain = parseEmailReferenceChain(headers.references);
	const messageId = normalizeEmailMessageId(headers.messageId);
	const inReplyTo = normalizeEmailMessageId(headers.inReplyTo);
	const threadMessageIds = [
		...new Set(
			[
				...referenceChain.map((entry) =>
					normalizeEmailMessageId(entry)
				),
				messageId
			].filter((value): value is string => typeof value === 'string')
		)
	];
	const replyDepth = Math.max(
		referenceChain.length,
		headers.inReplyTo ? 1 : 0
	);
	const threadIndex = headers.threadIndex;
	const threadTopic = headers.threadTopic ?? headers.subject;
	const conversationId =
		headers.conversationId ??
		(typeof mergedMetadata.emailConversationId === 'string' &&
		mergedMetadata.emailConversationId.length > 0
			? mergedMetadata.emailConversationId
			: undefined);
	const threadRootMessageId =
		normalizeEmailMessageId(referenceChain[0]) ?? inReplyTo ?? messageId;
	const threadKey =
		normalizeEmailThreadKey(threadTopic) ??
		normalizeEmailThreadKey(conversationId) ??
		normalizeEmailThreadKey(messageId) ??
		normalizeEmailThreadKey(headers.subject);
	const parentMessageId = normalizeEmailMessageId(
		typeof options?.metadata?.messageId === 'string'
			? options.metadata.messageId
			: typeof input.metadata?.messageId === 'string'
				? input.metadata.messageId
				: undefined
	);
	const parentMessageSource =
		typeof options?.metadata?.emailMessageSource === 'string' &&
		options.metadata.emailMessageSource.length > 0
			? options.metadata.emailMessageSource
			: typeof input.metadata?.emailMessageSource === 'string' &&
				  input.metadata.emailMessageSource.length > 0
				? input.metadata.emailMessageSource
				: undefined;
	const parentThreadKey =
		typeof options?.metadata?.threadKey === 'string' &&
		options.metadata.threadKey.length > 0
			? options.metadata.threadKey
			: typeof input.metadata?.threadKey === 'string' &&
				  input.metadata.threadKey.length > 0
				? input.metadata.threadKey
				: undefined;
	const parentAttachmentSource =
		typeof options?.metadata?.emailAttachmentSource === 'string' &&
		options.metadata.emailAttachmentSource.length > 0
			? options.metadata.emailAttachmentSource
			: typeof input.metadata?.emailAttachmentSource === 'string' &&
				  input.metadata.emailAttachmentSource.length > 0
				? input.metadata.emailAttachmentSource
				: undefined;
	const parentMessageLineage = parseEmailMessageLineage(mergedMetadata);
	const parentAncestorMessageIds = Array.isArray(
		mergedMetadata.emailAncestorMessageIds
	)
		? mergedMetadata.emailAncestorMessageIds.filter(
				(value): value is string =>
					typeof value === 'string' && value.length > 0
			)
		: [];
	const parentAncestorMessageSources = Array.isArray(
		mergedMetadata.emailAncestorMessageSources
	)
		? mergedMetadata.emailAncestorMessageSources.filter(
				(value): value is string =>
					typeof value === 'string' && value.length > 0
			)
		: [];
	const emailMessageLineage = parentAttachmentSource
		? [
				...parentMessageLineage,
				{
					attachmentSource: parentAttachmentSource,
					...(parentMessageId ? { messageId: parentMessageId } : {}),
					...(parentMessageSource
						? { messageSource: parentMessageSource }
						: {}),
					...(typeof mergedMetadata.emailMessageSourceKind ===
						'string' &&
					mergedMetadata.emailMessageSourceKind.length > 0
						? {
								messageSourceKind:
									mergedMetadata.emailMessageSourceKind
							}
						: {}),
					...(parentThreadKey ? { threadKey: parentThreadKey } : {})
				}
			]
		: parentMessageLineage;
	const emailMessageLineageMessageIds = emailMessageLineage
		.map((entry) => entry.messageId)
		.filter((value): value is string => typeof value === 'string');
	const emailMessageLineageSources = emailMessageLineage
		.map((entry) => entry.messageSource)
		.filter((value): value is string => typeof value === 'string');
	const emailMessageLineageAttachmentSources = emailMessageLineage
		.map((entry) => entry.attachmentSource)
		.filter((value): value is string => typeof value === 'string');
	const emailMessageDepth = emailMessageLineage.length;
	const emailAncestorMessageIds = [
		...new Set([
			...parentAncestorMessageIds,
			...emailMessageLineageMessageIds
		])
	];
	const emailAncestorMessageSources = [
		...new Set([
			...parentAncestorMessageSources,
			...emailMessageLineageSources
		])
	];
	const embeddedResourceReferences = parseEmailEmbeddedResourceReferences(
		parsed.bodyHtml
	);
	const messageText = extractEmailText(raw);
	const emailBodySections = parseEmailBodySections(messageText);
	const forwardedSections = emailBodySections.filter(
		(section) => section.kind === 'forwarded_headers'
	);
	const primaryForwardedSection = emailBodySections.find(
		(section) => section.kind === 'forwarded_headers'
	);
	const forwardedHeaderFieldNames = [
		...new Set(
			emailBodySections.flatMap((section) =>
				Object.keys(section.forwardedHeaderFields ?? {})
			)
		)
	];
	const quotedDepths = emailBodySections
		.map((section) =>
			typeof section.quotedDepth === 'number'
				? section.quotedDepth
				: undefined
		)
		.filter((value): value is number => typeof value === 'number');
	const inheritedAttachmentNames = Array.isArray(
		mergedMetadata.attachmentNames
	)
		? mergedMetadata.attachmentNames.filter(
				(value): value is string =>
					typeof value === 'string' && value.length > 0
			)
		: [];
	const attachmentNames =
		parsed.attachments.length > 0
			? parsed.attachments.map((attachment) => attachment.fileName)
			: inheritedAttachmentNames;
	const attachmentCount =
		parsed.attachments.length > 0
			? parsed.attachments.length
			: typeof mergedMetadata.attachmentCount === 'number' &&
				  Number.isFinite(mergedMetadata.attachmentCount)
				? mergedMetadata.attachmentCount
				: attachmentNames.length;
	const messageMetadata = {
		...mergedMetadata,
		...(maildirMetadata ?? {}),
		attachmentCount,
		attachmentNames,
		emailKind: 'message',
		fileKind: 'email',
		...(typeof conversationId === 'string' &&
		conversationId.trim().length > 0
			? { emailConversationId: normalizeWhitespace(conversationId) }
			: {}),
		from: headers.from,
		fromAddress: headers.fromAddress,
		fromAddressEntries: headers.fromAddressEntries,
		fromDisplayName: headers.fromDisplayName,
		inReplyTo,
		messageId,
		emailAncestorMessageIds,
		emailAncestorMessageSources,
		emailContainerAttachmentSource: parentAttachmentSource,
		emailContainerMessageId: parentAttachmentSource
			? parentMessageId
			: undefined,
		emailContainerMessageSource: parentAttachmentSource
			? parentMessageSource
			: undefined,
		emailContainerThreadKey: parentAttachmentSource
			? parentThreadKey
			: undefined,
		emailMessageLineage,
		emailMessageLineageAttachmentSources,
		emailMessageLineageCount: emailMessageLineage.length,
		emailMessageLineageMessageIds,
		emailMessageLineageSources,
		emailMessageDepth,
		emailMessageSourceKind: parentAttachmentSource
			? 'attached_message'
			: 'root_message',
		references: headers.references,
		replyDepth,
		replyReferenceCount: referenceChain.length,
		threadMessageCount: threadMessageIds.length,
		threadMessageIds,
		...(typeof threadIndex === 'string' && threadIndex.trim().length > 0
			? { threadIndex: normalizeWhitespace(threadIndex) }
			: {}),
		threadKey,
		threadRootMessageId,
		threadTopic,
		to: headers.to,
		toAddressEntries: headers.toAddressEntries,
		toAddresses: headers.toAddresses,
		hasAttachments: attachmentCount > 0,
		hasInlineResources: parsed.attachments.some(
			(attachment) => attachment.role === 'inline_resource'
		),
		embeddedResourceCount:
			embeddedResourceReferences.contentIds.length +
			embeddedResourceReferences.contentLocations.length,
		embeddedResourceContentIds: embeddedResourceReferences.contentIds,
		embeddedResourceContentLocations:
			embeddedResourceReferences.contentLocations,
		bcc: headers.bcc,
		bccAddressEntries: headers.bccAddressEntries,
		bccAddresses: headers.bccAddresses,
		cc: headers.cc,
		ccAddressEntries: headers.ccAddressEntries,
		ccAddresses: headers.ccAddresses,
		emailAuthoredSectionCount: emailBodySections.filter(
			(section) => section.kind === 'authored_text'
		).length,
		emailBodySectionCount: emailBodySections.length,
		emailBodySections,
		emailForwardedChainCount: forwardedSections.length,
		emailForwardedChains: forwardedSections.map((section, index) => ({
			...(Array.isArray(section.forwardedBccAddresses) &&
			section.forwardedBccAddresses.length > 0
				? { forwardedBccAddresses: section.forwardedBccAddresses }
				: {}),
			...(Array.isArray(section.forwardedCcAddresses) &&
			section.forwardedCcAddresses.length > 0
				? { forwardedCcAddresses: section.forwardedCcAddresses }
				: {}),
			...(typeof section.forwardedDate === 'string'
				? { forwardedDate: section.forwardedDate }
				: {}),
			...(typeof section.forwardedFromAddress === 'string'
				? { forwardedFromAddress: section.forwardedFromAddress }
				: {}),
			...(typeof section.forwardedFromDisplayName === 'string'
				? {
						forwardedFromDisplayName:
							section.forwardedFromDisplayName
					}
				: {}),
			...(section.forwardedHeaderFields
				? { forwardedHeaderFields: section.forwardedHeaderFields }
				: {}),
			...(Array.isArray(section.forwardedParticipantAddresses) &&
			section.forwardedParticipantAddresses.length > 0
				? {
						forwardedParticipantAddresses:
							section.forwardedParticipantAddresses
					}
				: {}),
			...(Array.isArray(section.forwardedReplyToAddresses) &&
			section.forwardedReplyToAddresses.length > 0
				? {
						forwardedReplyToAddresses:
							section.forwardedReplyToAddresses
					}
				: {}),
			...(typeof section.forwardedSubject === 'string'
				? { forwardedSubject: section.forwardedSubject }
				: {}),
			...(typeof section.forwardedTimestamp === 'string'
				? { forwardedTimestamp: section.forwardedTimestamp }
				: {}),
			...(Array.isArray(section.forwardedToAddresses) &&
			section.forwardedToAddresses.length > 0
				? { forwardedToAddresses: section.forwardedToAddresses }
				: {}),
			ordinal: index + 1,
			text: section.text
		})),
		emailForwardedBccAddresses:
			primaryForwardedSection?.forwardedBccAddresses,
		emailForwardedCcAddresses:
			primaryForwardedSection?.forwardedCcAddresses,
		emailForwardedDate: primaryForwardedSection?.forwardedDate,
		emailForwardedFromAddress:
			primaryForwardedSection?.forwardedFromAddress,
		emailForwardedFromDisplayName:
			primaryForwardedSection?.forwardedFromDisplayName,
		emailForwardedHeaderSectionCount: emailBodySections.filter(
			(section) => section.kind === 'forwarded_headers'
		).length,
		emailForwardedHeaderFieldCount: forwardedHeaderFieldNames.length,
		emailForwardedHeaderFieldNames: forwardedHeaderFieldNames,
		emailForwardedHeaderFields:
			primaryForwardedSection?.forwardedHeaderFields,
		emailForwardedParticipantAddresses:
			primaryForwardedSection?.forwardedParticipantAddresses,
		emailForwardedReplyToAddresses:
			primaryForwardedSection?.forwardedReplyToAddresses,
		emailForwardedSubject: primaryForwardedSection?.forwardedSubject,
		emailForwardedTimestamp: primaryForwardedSection?.forwardedTimestamp,
		emailForwardedToAddresses:
			primaryForwardedSection?.forwardedToAddresses,
		emailQuotedMaxDepth:
			quotedDepths.length > 0 ? Math.max(...quotedDepths) : undefined,
		emailQuotedSectionCount: emailBodySections.filter(
			(section) => section.kind === 'quoted_history'
		).length,
		emailMessageSource: source,
		participantAddresses: headers.participantAddresses,
		participantDisplayNames: headers.participantDisplayNames,
		replyTo: headers.replyTo,
		replyToAddressEntries: headers.replyToAddressEntries,
		replyToAddresses: headers.replyToAddresses
	};
	const attachmentDocuments = await Promise.all(
		parsed.attachments.map(async (attachment, index) => {
			const attachmentSource = `${source}#attachments/${attachment.fileName}`;
			const matchesEmbeddedReference =
				(attachment.contentId
					? embeddedResourceReferences.contentIds.includes(
							attachment.contentId
						)
					: false) ||
				(attachment.contentLocation
					? embeddedResourceReferences.contentLocations.includes(
							attachment.contentLocation
						)
					: false);
			const documents = await extractRAGFileDocuments({
				chunking: input.chunking,
				contentType: attachment.contentType,
				data: attachment.data,
				extractorRegistry: input.extractorRegistry,
				format:
					inferFormatFromContentType(
						attachment.contentType ?? null
					) ?? inferFormatFromName(attachment.fileName),
				metadata: {
					...messageMetadata,
					attachmentIndex: index,
					attachmentContentId: attachment.contentId,
					attachmentContentLocation: attachment.contentLocation,
					attachmentDisposition:
						attachment.dispositionType ?? 'attachment',
					attachmentEmbeddedReferenceMatched:
						matchesEmbeddedReference,
					attachmentName: attachment.fileName,
					emailAttachmentRole: attachment.role,
					emailAttachmentSource: attachmentSource,
					emailKind: 'attachment'
				},
				name: attachment.fileName,
				source: attachmentSource,
				title: headers.subject
					? `${headers.subject} · ${attachment.fileName}`
					: attachment.fileName
			});

			return documents;
		})
	);

	const messageDocument: RAGExtractedFileDocument = {
		chunking: input.chunking,
		contentType: input.contentType,
		format: 'text',
		metadata: messageMetadata,
		source,
		text: messageText,
		title: options?.title ?? input.title ?? headers.subject
	};

	return [messageDocument, ...attachmentDocuments.flat()];
};

const normalizeEmailThreadKey = (value: string | undefined) => {
	const normalized = normalizeWhitespace(
		value
			?.replace(/^(re|fw|fwd)\s*:\s*/gi, '')
			?.replace(/[<>]/g, '')
			?.toLowerCase() ?? ''
	);

	return normalized || undefined;
};

const normalizeEmailMessageId = (value: string | undefined) => {
	const normalized = normalizeWhitespace(value ?? '');
	return normalized || undefined;
};

const parseEmailReferenceChain = (references: string | undefined) =>
	(references?.match(/<[^>]+>/g) ?? [])
		.map((entry) => normalizeWhitespace(entry))
		.filter(Boolean);

const stripRTF = (value: string) => {
	const withoutBinary = value.replace(/\\bin\d+ [\s\S]*?(?=[\\}])/g, ' ');
	const withoutControls = withoutBinary
		.replace(/\\par[d]?/g, '\n')
		.replace(/\\tab/g, '\t')
		.replace(/\\'[0-9a-fA-F]{2}/g, (match) =>
			String.fromCharCode(parseInt(match.slice(2), 16))
		)
		.replace(/\\[a-zA-Z]+\d* ?/g, ' ')
		.replace(/[{}]/g, ' ');

	return normalizeWhitespace(withoutControls);
};

const extractOrderedPrintableStrings = (data: Uint8Array) => {
	const text = Buffer.from(data).toString('latin1');
	const asciiMatches =
		text.match(
			/[A-Za-z0-9][A-Za-z0-9 ,.;:!?@#$%^&*()[\]_\-+/\\'"`~|=<>]{3,}/g
		) ?? [];
	const utf16Matches =
		Buffer.from(data)
			.toString('utf16le')
			.match(
				/[A-Za-z0-9][A-Za-z0-9 ,.;:!?@#$%^&*()[\]_\-+/\\'"`~|=<>]{3,}/g
			) ?? [];

	const values = [...asciiMatches, ...utf16Matches].map((entry) =>
		normalizeWhitespace(entry)
	);
	return values.filter((entry) => entry.length >= 4).join('\n');
};

const extractPrintableStrings = (data: Uint8Array) => {
	const values = extractOrderedPrintableStrings(data)
		.split('\n')
		.filter(Boolean);
	const unique = [...new Set(values)].filter((entry) => entry.length >= 4);
	return unique.join('\n');
};

const ocrMetadata = (result: RAGOCRResult) => {
	const regions = result.regions?.filter(
		(region) => normalizeWhitespace(region.text ?? '').length > 0
	);
	const pageNumbers = [
		...new Set(
			(regions ?? [])
				.map((region) =>
					typeof region.page === 'number' && region.page > 0
						? region.page
						: undefined
				)
				.filter((value): value is number => value !== undefined)
		)
	].sort((left, right) => left - right);
	const confidenceValues = [
		typeof result.confidence === 'number' ? result.confidence : undefined,
		...(regions ?? []).map((region) =>
			typeof region.confidence === 'number'
				? region.confidence
				: undefined
		)
	].filter((value): value is number => value !== undefined);

	const averageConfidence =
		confidenceValues.length > 0
			? confidenceValues.reduce((sum, value) => sum + value, 0) /
				confidenceValues.length
			: undefined;
	const minConfidence =
		confidenceValues.length > 0 ? Math.min(...confidenceValues) : undefined;
	const maxConfidence =
		confidenceValues.length > 0 ? Math.max(...confidenceValues) : undefined;
	const pageStart = pageNumbers[0];
	const pageEnd = pageNumbers.at(-1);

	return {
		...(result.metadata ?? {}),
		ocrConfidence: result.confidence,
		ocrPageCount: pageNumbers.length,
		...(typeof pageStart === 'number' ? { ocrPageStart: pageStart } : {}),
		...(typeof pageEnd === 'number' ? { ocrPageEnd: pageEnd } : {}),
		ocrPageNumbers: pageNumbers,
		ocrRegionCount: regions?.length,
		ocrRegions: regions,
		ocrAverageConfidence: averageConfidence,
		...(typeof minConfidence === 'number'
			? { ocrMinConfidence: minConfidence }
			: {}),
		...(typeof maxConfidence === 'number'
			? { ocrMaxConfidence: maxConfidence }
			: {})
	};
};

const toOCRReadingOrder = (regions: NonNullable<RAGOCRResult['regions']>) =>
	[...regions].sort((left, right) => {
		const leftY =
			typeof left.y === 'number' && Number.isFinite(left.y) ? left.y : 0;
		const rightY =
			typeof right.y === 'number' && Number.isFinite(right.y)
				? right.y
				: 0;
		const leftHeight =
			typeof left.height === 'number' && Number.isFinite(left.height)
				? left.height
				: 0;
		const rightHeight =
			typeof right.height === 'number' && Number.isFinite(right.height)
				? right.height
				: 0;
		const lineThreshold = Math.max(leftHeight, rightHeight, 12) * 0.6;
		if (Math.abs(leftY - rightY) > lineThreshold) {
			return leftY - rightY;
		}

		const leftX =
			typeof left.x === 'number' && Number.isFinite(left.x) ? left.x : 0;
		const rightX =
			typeof right.x === 'number' && Number.isFinite(right.x)
				? right.x
				: 0;
		if (leftX !== rightX) {
			return leftX - rightX;
		}

		return normalizeWhitespace(left.text ?? '').localeCompare(
			normalizeWhitespace(right.text ?? '')
		);
	});

const buildOCRReadingLinesText = (
	regions: NonNullable<RAGOCRResult['regions']>
) => {
	const ordered = toOCRReadingOrder(regions);
	const lines: Array<{
		y: number;
		height: number;
		segments: typeof ordered;
	}> = [];

	for (const region of ordered) {
		const text = normalizeWhitespace(region.text ?? '');
		if (!text) {
			continue;
		}
		const y =
			typeof region.y === 'number' && Number.isFinite(region.y)
				? region.y
				: 0;
		const height =
			typeof region.height === 'number' && Number.isFinite(region.height)
				? region.height
				: 12;
		const line = lines.at(-1);
		const threshold = Math.max(line?.height ?? 0, height, 12) * 0.6;
		if (line && Math.abs(y - line.y) <= threshold) {
			line.segments.push(region);
			line.y = Math.min(line.y, y);
			line.height = Math.max(line.height, height);
			continue;
		}

		lines.push({ height, segments: [region], y });
	}

	return normalizeWhitespace(
		lines
			.map((line) =>
				toOCRReadingOrder(line.segments)
					.map((segment) => normalizeWhitespace(segment.text ?? ''))
					.filter(Boolean)
					.join(' ')
			)
			.filter(Boolean)
			.join('\n')
	);
};

const splitOCRColumns = (regions: NonNullable<RAGOCRResult['regions']>) => {
	if (regions.length < 4) {
		return [regions];
	}

	const xAnchors = regions
		.map((region) =>
			typeof region.x === 'number' && Number.isFinite(region.x)
				? region.x
				: undefined
		)
		.filter((value): value is number => typeof value === 'number')
		.sort((left, right) => left - right);
	if (xAnchors.length < 4) {
		return [regions];
	}

	let largestGap = 0;
	let splitX: number | undefined;
	for (let index = 1; index < xAnchors.length; index += 1) {
		const gap = xAnchors[index]! - xAnchors[index - 1]!;
		if (gap > largestGap) {
			largestGap = gap;
			splitX = xAnchors[index - 1]! + gap / 2;
		}
	}

	if (!(largestGap >= 80) || typeof splitX !== 'number') {
		return [regions];
	}

	const leftColumn = regions.filter((region) => {
		const x =
			typeof region.x === 'number' && Number.isFinite(region.x)
				? region.x
				: 0;
		return x < splitX;
	});
	const rightColumn = regions.filter((region) => {
		const x =
			typeof region.x === 'number' && Number.isFinite(region.x)
				? region.x
				: 0;
		return x >= splitX;
	});

	if (leftColumn.length < 2 || rightColumn.length < 2) {
		return [regions];
	}

	const yRange = (column: NonNullable<RAGOCRResult['regions']>) => {
		const ys = column
			.map((region) =>
				typeof region.y === 'number' && Number.isFinite(region.y)
					? region.y
					: undefined
			)
			.filter((value): value is number => typeof value === 'number');
		return ys.length > 0
			? { max: Math.max(...ys), min: Math.min(...ys) }
			: undefined;
	};
	const leftRange = yRange(leftColumn);
	const rightRange = yRange(rightColumn);
	const overlapsVertically =
		leftRange &&
		rightRange &&
		Math.min(leftRange.max, rightRange.max) >=
			Math.max(leftRange.min, rightRange.min);
	if (!overlapsVertically) {
		return [regions];
	}

	return [leftColumn, rightColumn];
};

const buildOCRReadingText = (regions: NonNullable<RAGOCRResult['regions']>) =>
	normalizeWhitespace(
		splitOCRColumns(regions)
			.map((column) => buildOCRReadingLinesText(column))
			.filter(Boolean)
			.join('\n\n')
	);

const getOCRPrimaryText = (result: RAGOCRResult) => {
	const regions = result.regions?.filter(
		(region) => normalizeWhitespace(region.text ?? '').length > 0
	);
	const reconstructed =
		regions && regions.length > 0 ? buildOCRReadingText(regions) : '';

	return reconstructed || result.text;
};

const buildOCRSummaryText = (result: RAGOCRResult) => {
	const regions =
		result.regions?.filter(
			(region) => normalizeWhitespace(region.text ?? '').length > 0
		) ?? [];
	if (regions.length === 0) {
		return {
			lowConfidenceRegionCount: 0,
			strongRegionCount: 0,
			summaryConfidenceThreshold: OCR_SUMMARY_CONFIDENCE_THRESHOLD,
			text: result.text,
			usedStrongRegionsOnly: false
		};
	}

	const strongRegions = regions.filter(
		(region) =>
			typeof region.confidence !== 'number' ||
			region.confidence >= OCR_SUMMARY_CONFIDENCE_THRESHOLD
	);
	const lowConfidenceRegionCount = regions.length - strongRegions.length;
	const strongTextLength = strongRegions.reduce(
		(sum, region) => sum + normalizeWhitespace(region.text ?? '').length,
		0
	);
	const totalTextLength = regions.reduce(
		(sum, region) => sum + normalizeWhitespace(region.text ?? '').length,
		0
	);
	const strongCoverageRatio =
		totalTextLength > 0 ? strongTextLength / totalTextLength : 0;
	const useStrongRegionsOnly =
		strongRegions.length > 0 &&
		lowConfidenceRegionCount > 0 &&
		strongCoverageRatio >= OCR_SUMMARY_MIN_STRONG_TEXT_RATIO;
	const strongReconstructed = buildOCRReadingText(strongRegions);
	const allReconstructed = buildOCRReadingText(regions);

	return {
		lowConfidenceRegionCount,
		strongRegionCount: strongRegions.length,
		summaryConfidenceThreshold: OCR_SUMMARY_CONFIDENCE_THRESHOLD,
		text:
			(useStrongRegionsOnly ? strongReconstructed : allReconstructed) ||
			result.text,
		usedStrongRegionsOnly: useStrongRegionsOnly
	};
};

const ocrPageDocuments = (
	result: RAGOCRResult,
	input: RAGFileExtractionInput,
	baseMetadata: Record<string, unknown>
): RAGExtractedFileDocument[] => {
	const grouped = new Map<number, NonNullable<RAGOCRResult['regions']>>();
	for (const region of result.regions ?? []) {
		const text = normalizeWhitespace(region.text ?? '');
		if (!text || typeof region.page !== 'number' || region.page < 1) {
			continue;
		}

		const bucket = grouped.get(region.page) ?? [];
		bucket.push({ ...region, text });
		grouped.set(region.page, bucket);
	}

	return [...grouped.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([pageNumber, regions]) => {
			const orderedRegions = toOCRReadingOrder(regions);
			const confidenceValues = regions
				.map((region) =>
					typeof region.confidence === 'number'
						? region.confidence
						: undefined
				)
				.filter((value): value is number => value !== undefined);
			const averageConfidence =
				confidenceValues.length > 0
					? confidenceValues.reduce((sum, value) => sum + value, 0) /
						confidenceValues.length
					: undefined;
			const minConfidence =
				confidenceValues.length > 0
					? Math.min(...confidenceValues)
					: undefined;
			const maxConfidence =
				confidenceValues.length > 0
					? Math.max(...confidenceValues)
					: undefined;

			return {
				chunking: input.chunking,
				contentType: input.contentType,
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					...baseMetadata,
					ocrPageAverageConfidence: averageConfidence,
					ocrPageConfidence: averageConfidence,
					...(typeof minConfidence === 'number'
						? { ocrPageMinConfidence: minConfidence }
						: {}),
					...(typeof maxConfidence === 'number'
						? { ocrPageMaxConfidence: maxConfidence }
						: {}),
					ocrRegionCount: regions.length,
					ocrRegionNumbers: regions.map(
						(_region, index) => index + 1
					),
					ocrRegions: regions,
					pageNumber,
					pageIndex: pageNumber - 1,
					sourceNativeKind: 'pdf_page'
				},
				source:
					input.source ??
					input.path ??
					input.name ??
					`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
				text: normalizeWhitespace(
					`PDF page ${pageNumber} from ${
						input.title ??
						input.name ??
						input.path ??
						DEFAULT_BINARY_NAME
					}.\n${buildOCRReadingText(orderedRegions)}`
				),
				title: input.title
					? `${input.title} · Page ${pageNumber}`
					: `Page ${pageNumber}`
			};
		});
};

const ocrRegionDocuments = (
	result: RAGOCRResult,
	input: RAGFileExtractionInput,
	baseMetadata: Record<string, unknown>
): RAGExtractedFileDocument[] => {
	const documents: RAGExtractedFileDocument[] = [];

	for (const [index, region] of (result.regions ?? []).entries()) {
		const text = normalizeWhitespace(region.text ?? '');
		if (!text || typeof region.page !== 'number' || region.page < 1) {
			continue;
		}

		const pageNumber = region.page;
		const regionNumber = index + 1;

		documents.push({
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				...baseMetadata,
				ocrPageCount: 1,
				ocrPageNumbers: [pageNumber],
				ocrRegionConfidence: region.confidence,
				ocrRegionHeight: region.height,
				ocrRegionWidth: region.width,
				ocrRegionX: region.x,
				ocrRegionY: region.y,
				pageNumber,
				pageIndex: pageNumber - 1,
				regionIndex: index,
				regionNumber,
				sourceNativeKind: 'pdf_region'
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
			text: normalizeWhitespace(
				`PDF page ${pageNumber} region ${regionNumber} from ${
					input.title ??
					input.name ??
					input.path ??
					DEFAULT_BINARY_NAME
				}.\n${text}`
			),
			title: input.title
				? `${input.title} · Page ${pageNumber} Region ${regionNumber}`
				: `Page ${pageNumber} Region ${regionNumber}`
		});
	}

	return documents;
};

const textExtractorSupports = (input: RAGFileExtractionInput) => {
	if (input.format) {
		return true;
	}

	const contentType = (input.contentType ?? '').toLowerCase();
	if (
		contentType.startsWith('text/') ||
		contentType.includes('json') ||
		contentType.includes('xml') ||
		contentType.includes('yaml') ||
		contentType.includes('javascript')
	) {
		return true;
	}

	if (TEXT_FILE_EXTENSIONS.has(inferExtensionFromInput(input))) {
		return true;
	}

	return isLikelyTextData(input.data);
};

const pdfExtractorSupports = (input: RAGFileExtractionInput) => {
	const contentType = (input.contentType ?? '').toLowerCase();
	if (contentType.includes('application/pdf')) {
		return true;
	}

	return PDF_FILE_EXTENSIONS.has(inferExtensionFromInput(input));
};

const mediaExtractorSupports = (input: RAGFileExtractionInput) => {
	const contentType = (input.contentType ?? '').toLowerCase();
	if (contentType.startsWith('audio/') || contentType.startsWith('video/')) {
		return true;
	}

	const extension = inferExtensionFromInput(input);

	return (
		AUDIO_FILE_EXTENSIONS.has(extension) ||
		VIDEO_FILE_EXTENSIONS.has(extension)
	);
};

const officeExtractorSupports = (input: RAGFileExtractionInput) => {
	const extension = inferExtensionFromInput(input);

	return OFFICE_FILE_EXTENSIONS.has(extension);
};

const legacyExtractorSupports = (input: RAGFileExtractionInput) =>
	LEGACY_DOCUMENT_FILE_EXTENSIONS.has(inferExtensionFromInput(input));

const epubExtractorSupports = (input: RAGFileExtractionInput) =>
	EPUB_FILE_EXTENSIONS.has(inferExtensionFromInput(input));

const emailExtractorSupports = (input: RAGFileExtractionInput) => {
	const contentType = (input.contentType ?? '').toLowerCase();
	if (
		contentType.includes('message/rfc822') ||
		contentType.includes('application/eml') ||
		contentType.includes('application/emlx') ||
		contentType.includes('application/x-emlx') ||
		contentType.includes('application/mbox') ||
		contentType.includes('application/x-mbox')
	) {
		return true;
	}

	const extension = inferExtensionFromInput(input);
	if (EMAIL_FILE_EXTENSIONS.has(extension)) {
		return true;
	}

	if (
		parseMaildirMetadata(input.source ?? input.path ?? input.name) &&
		isLikelyRawEmailData(decodeUtf8(input.data))
	) {
		return true;
	}

	return false;
};

const mailboxContainerExtractorSupports = (input: RAGFileExtractionInput) => {
	const extension = inferExtensionFromInput(input);
	return MAILBOX_CONTAINER_FILE_EXTENSIONS.has(extension);
};

const imageExtractorSupports = (input: RAGFileExtractionInput) => {
	const contentType = (input.contentType ?? '').toLowerCase();
	if (contentType.startsWith('image/')) {
		return true;
	}

	return IMAGE_FILE_EXTENSIONS.has(inferExtensionFromInput(input));
};

const archiveExtractorSupports = (input: RAGFileExtractionInput) => {
	const contentType = (input.contentType ?? '').toLowerCase();
	if (
		contentType.includes('zip') ||
		contentType.includes('tar') ||
		contentType.includes('gzip') ||
		contentType.includes('x-gzip')
	) {
		return true;
	}

	return ARCHIVE_FILE_EXTENSIONS.has(inferExtensionFromInput(input));
};

export const createBuiltinArchiveExpander = (): RAGArchiveExpander => ({
	name: 'builtin_archive',
	expand: (input) => {
		const extension = inferExtensionFromInput(input);
		if (isZipData(input.data) || extension === '.zip') {
			return {
				entries: unzipEntries(input.data),
				metadata: { archiveType: 'zip' }
			};
		}

		if (TAR_FILE_EXTENSIONS.has(extension)) {
			return {
				entries: untarEntries(input.data),
				metadata: { archiveType: 'tar' }
			};
		}

		if (GZIP_FILE_EXTENSIONS.has(extension)) {
			return {
				entries: decodeGzipEntries(input.data, input),
				metadata: {
					archiveType:
						extension === '.tgz' ||
						(input.name ?? input.path ?? '')
							.toLowerCase()
							.endsWith('.tar.gz')
							? 'tgz'
							: 'gzip'
				}
			};
		}

		throw new Error(
			`Builtin archive expander does not support ${inferNameFromInput(input)}`
		);
	}
});
export const createEmailExtractor = (): RAGFileExtractor => ({
	name: 'absolute_email',
	supports: emailExtractorSupports,
	extract: async (input) => {
		const source =
			input.source ??
			input.path ??
			input.name ??
			`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.eml`;
		const extension = inferExtensionFromInput(input);
		const emlx =
			extension === '.emlx'
				? decodeEmlxMessageData(input.data)
				: undefined;
		const raw = emlx?.raw ?? decodeUtf8(input.data);
		if (extension === '.emlx') {
			return extractEmailDocumentsFromRawMessage(input, raw, {
				metadata: {
					emailMailboxContainerSource: source,
					emailMailboxFormat: 'emlx',
					emailMailboxMessageCount: 1,
					emailMailboxMessageIndex: 0,
					emailMailboxMessageOrdinal: 1,
					...(typeof emlx?.messageByteLength === 'number'
						? {
								emailMailboxMessageByteLength:
									emlx.messageByteLength
							}
						: {}),
					...(emlx?.hasTrailingMetadata
						? { emailMailboxHasTrailingMetadata: true }
						: {})
				},
				source
			});
		}
		if (extension === '.mbox' || extension === '.mbx') {
			const messages = splitMboxMessages(raw);
			const documents = await Promise.all(
				messages.map((messageRaw, index) =>
					extractEmailDocumentsFromRawMessage(input, messageRaw, {
						metadata: {
							emailMailboxContainerSource: source,
							emailMailboxFormat: 'mbox',
							emailMailboxMessageCount: messages.length,
							emailMailboxMessageIndex: index,
							emailMailboxMessageOrdinal: index + 1
						},
						source: `${source}#messages/${index + 1}`
					})
				)
			);

			return documents.flat();
		}

		return extractEmailDocumentsFromRawMessage(input, raw, { source });
	}
});
export const createMailboxContainerExtractor = (): RAGFileExtractor => ({
	name: 'absolute_mailbox_container',
	supports: mailboxContainerExtractorSupports,
	extract: async (input) => {
		const extension = inferExtensionFromInput(input);
		const format = extension.replace(/^\./, '') || 'mailbox';
		const source =
			input.source ??
			input.path ??
			input.name ??
			`${slugify(input.title ?? DEFAULT_BINARY_NAME)}${extension || '.mailbox'}`;
		const raw = extractOrderedPrintableStrings(input.data);

		if (!raw) {
			throw new Error(
				`AbsoluteJS could not extract readable text from ${inferNameFromInput(input)}`
			);
		}

		const messages = splitMailboxContainerMessages(raw);
		if (messages.length > 0) {
			const documents = await Promise.all(
				messages.map(async (message, index) => {
					const messageSource = `${source}#messages/${index + 1}`;
					const extractedDocuments =
						await extractEmailDocumentsFromRawMessage(
							input,
							message.raw,
							{
								metadata: {
									...message.metadata,
									emailMailboxContainerSource: source,
									emailMailboxFormat: format,
									emailMailboxMessageCount: messages.length,
									emailMailboxMessageIndex: index,
									emailMailboxMessageOrdinal: index + 1
								},
								source: messageSource
							}
						);
					if (
						!message.attachments ||
						message.attachments.length === 0
					) {
						return extractedDocuments;
					}

					const embeddedReferences =
						extractMailboxRecoveredEmbeddedReferences(message.raw);
					const messageDocument = extractedDocuments.find(
						(document) => document.metadata?.emailKind === 'message'
					);
					const baseMetadata = {
						...(messageDocument?.metadata ?? {}),
						emailMailboxContainerSource: source,
						emailMailboxFormat: format,
						emailMailboxMessageCount: messages.length,
						emailMailboxMessageIndex: index,
						emailMailboxMessageOrdinal: index + 1
					};
					const mailboxAttachmentDocuments = await Promise.all(
						message.attachments.map(
							async (attachment, attachmentIndex) =>
								extractRAGFileDocuments({
									chunking: input.chunking,
									contentType: attachment.contentType,
									data: attachment.data,
									extractorRegistry: input.extractorRegistry,
									format:
										inferFormatFromContentType(
											attachment.contentType ?? null
										) ??
										inferFormatFromName(
											attachment.fileName
										),
									metadata: {
										...baseMetadata,
										attachmentIndex,
										attachmentContentId:
											attachment.contentId,
										attachmentContentLocation:
											attachment.contentLocation,
										attachmentDisposition:
											attachment.dispositionType ??
											'attachment',
										attachmentEmbeddedReferenceMatched:
											(attachment.contentId
												? embeddedReferences.contentIds.includes(
														attachment.contentId
													)
												: false) ||
											(attachment.contentLocation
												? embeddedReferences.contentLocations.includes(
														attachment.contentLocation
													) ||
													message.raw.includes(
														attachment.contentLocation
													)
												: false),
										attachmentName: attachment.fileName,
										attachmentRecoveredFromMailboxContainer:
											true,
										emailAttachmentRole: attachment.role,
										emailAttachmentSource: `${messageSource}#attachments/${attachment.fileName}`,
										emailKind: 'attachment'
									},
									name: attachment.fileName,
									source: `${messageSource}#attachments/${attachment.fileName}`,
									title: messageDocument?.title
										? `${messageDocument.title} · ${attachment.fileName}`
										: attachment.fileName
								})
						)
					);

					return [
						...extractedDocuments,
						...mailboxAttachmentDocuments.flat()
					];
				})
			);

			return documents.flat();
		}

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				emailMailboxContainerSource: source,
				emailMailboxFormat: format,
				fileKind: 'email_mailbox'
			},
			source,
			text: raw,
			title: input.title
		};
	}
});
export const createEPUBExtractor = (): RAGFileExtractor => ({
	name: 'absolute_epub',
	supports: epubExtractorSupports,
	extract: (input) => {
		const text = epubText(unzipEntries(input.data));
		if (!text) {
			throw new Error(
				`AbsoluteJS could not extract readable text from ${inferNameFromInput(input)}`
			);
		}

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				fileKind: 'epub'
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.epub`,
			text,
			title: input.title
		};
	}
});
export const createLegacyDocumentExtractor = (): RAGFileExtractor => ({
	name: 'absolute_legacy_document',
	supports: legacyExtractorSupports,
	extract: (input) => {
		const extension = inferExtensionFromInput(input);
		const raw =
			extension === '.rtf'
				? stripRTF(Buffer.from(input.data).toString('latin1'))
				: extractPrintableStrings(input.data);

		if (!raw) {
			throw new Error(
				`AbsoluteJS could not extract readable text from ${inferNameFromInput(input)}`
			);
		}

		const fileKind =
			extension === '.msg'
				? 'email'
				: extension === '.rtf'
					? 'rtf'
					: 'legacy_office';

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				fileKind,
				legacyFormat: extension.replace(/^\./, '')
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}${extension || '.legacy'}`,
			text: raw,
			title: input.title
		};
	}
});
export const createOfficeDocumentExtractor = (): RAGFileExtractor => ({
	name: 'absolute_office_document',
	supports: officeExtractorSupports,
	extract: (input) => {
		const extension = inferExtensionFromInput(input);
		const entries = unzipEntries(input.data);
		let text = '';
		let officeMetadata: Record<string, unknown> = {};
		let structuredDocuments: RAGExtractedFileDocument[] = [];
		if (extension === '.docx' || extension === '.odt') {
			const officeBlocks = officeDocumentBlocks(entries);
			text = officeDocumentText(entries);
			officeMetadata = {
				officeBlocks,
				sectionCount: officeDocumentSectionCount(entries)
			};
		} else if (extension === '.xlsx' || extension === '.ods') {
			text = spreadsheetText(entries);
			const sheets = spreadsheetSheetTexts(entries);
			const workbookLabel =
				input.title ??
				input.name ??
				input.path ??
				input.source ??
				DEFAULT_BINARY_NAME;
			officeMetadata = {
				sheetNames: spreadsheetSheetNames(entries)
			};
			structuredDocuments = sheets.map((sheet, index) => ({
				chunking: input.chunking,
				contentType: input.contentType,
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					fileKind: 'office',
					...officeMetadata,
					repeatedHeaderRowNumbers: sheet.repeatedHeaderRowNumbers,
					sheetColumnEnd: sheet.spreadsheetColumnEnd,
					sheetColumnStart: sheet.spreadsheetColumnStart,
					sheetHeaders: sheet.headers,
					sheetTableHeaders: sheet.sheetTableHeaders,
					sheetTableColumnRanges: sheet.sheetTableColumnRanges,
					sourceNativeKind: 'spreadsheet_sheet',
					sheetIndex: index,
					sheetName: sheet.name,
					sheetRowCount: sheet.rowCount,
					sheetTableCount: sheet.tableCount
				},
				source:
					input.source ??
					input.path ??
					input.name ??
					`${slugify(input.title ?? DEFAULT_BINARY_NAME)}${extension || '.office'}`,
				text: normalizeWhitespace(
					`Spreadsheet workbook ${workbookLabel}. ` +
						`Worksheet ${index + 1}. ` +
						`Workbook sheet named ${sheet.name}. ` +
						`Sheet ${sheet.name} from spreadsheet workbook ${workbookLabel}.` +
						`\n${sheet.text}`
				),
				title: input.title
					? `${input.title} · Sheet ${sheet.name}`
					: `Sheet ${sheet.name}`
			}));
		} else if (extension === '.pptx' || extension === '.odp') {
			text = presentationText(entries);
			const slides = presentationSlides(entries);
			officeMetadata = {
				slideCount: presentationSlideCount(entries)
			};
			structuredDocuments = slides.map((slide) => ({
				chunking: input.chunking,
				contentType: input.contentType,
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					fileKind: 'office',
					...officeMetadata,
					...(slide.slideBodyText
						? { slideBodyText: slide.slideBodyText }
						: {}),
					...(slide.notesText
						? { slideNotesText: slide.notesText }
						: {}),
					...(slide.slideTitle
						? { slideTitle: slide.slideTitle }
						: {}),
					sourceNativeKind: 'presentation_slide',
					slideIndex: slide.index,
					slideNumber: slide.index + 1
				},
				source:
					input.source ??
					input.path ??
					input.name ??
					`${slugify(input.title ?? DEFAULT_BINARY_NAME)}${extension || '.office'}`,
				text: normalizeWhitespace(
					`Presentation slide ${slide.index + 1} from ${
						input.title ??
						input.name ??
						input.path ??
						DEFAULT_BINARY_NAME
					}.\n${slide.text}`
				),
				title: input.title
					? `${input.title} · Slide ${slide.index + 1}`
					: `Slide ${slide.index + 1}`
			}));
		}

		if (!text) {
			throw new Error(
				`AbsoluteJS could not extract readable text from ${inferNameFromInput(input)}`
			);
		}

		const summaryDocument: RAGExtractedFileDocument = {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				fileKind: 'office',
				...officeMetadata
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}${extension || '.office'}`,
			text,
			title: input.title
		};

		return [summaryDocument, ...structuredDocuments];
	}
});
export const createRAGArchiveExpander = (expander: RAGArchiveExpander) =>
	expander;
export const createRAGFileExtractor = (extractor: RAGFileExtractor) =>
	extractor;
export const createRAGFileExtractorRegistry = (
	registry: RAGFileExtractorRegistryLike
) => registry;
export const createRAGChunkingRegistry = (registry: RAGChunkingRegistryLike) =>
	registry;
export const createRAGImageOCRExtractor = (
	provider: RAGOCRProvider
): RAGFileExtractor => ({
	name: `absolute_image_ocr:${provider.name}`,
	supports: imageExtractorSupports,
	extract: async (input) => {
		const result = await provider.extractText(input);
		const summary = buildOCRSummaryText(result);

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				...ocrMetadata(result),
				ocrLowConfidenceRegionCount: summary.lowConfidenceRegionCount,
				ocrStrongRegionCount: summary.strongRegionCount,
				ocrSummaryConfidenceThreshold:
					summary.summaryConfidenceThreshold,
				ocrSummaryUsedStrongRegionsOnly: summary.usedStrongRegionsOnly,
				fileKind: 'image',
				sourceNativeKind: 'image_ocr'
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.image.txt`,
			text: summary.text,
			title: result.title ?? input.title
		};
	}
});
export const createRAGMediaFileExtractor = (
	transcriber: RAGMediaTranscriber
): RAGFileExtractor => ({
	name: `absolute_media:${transcriber.name}`,
	supports: mediaExtractorSupports,
	extract: async (input) => {
		const result = await transcriber.transcribe(input);
		const rawSegments = sortMediaTranscriptSegments(
			(result.segments ?? [])
				.filter(
					(segment): segment is RAGMediaTranscriptSegmentWithText => {
						if (!segment || typeof segment !== 'object') {
							return false;
						}

						return (
							normalizeWhitespace(segment.text ?? '').length > 0
						);
					}
				)
				.map(normalizeMediaSegment)
		);
		const segmentGroups = groupTranscriptSegments(rawSegments);
		const source =
			input.source ??
			input.path ??
			input.name ??
			`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.media.txt`;
		const baseDocumentId = slugify(
			source ||
				input.title ||
				input.name ||
				input.path ||
				DEFAULT_BINARY_NAME
		);
		const segmentCount = rawSegments.length;
		const mediaDurationMs = rawSegments.reduce<number | undefined>(
			(max, segment) => {
				const endMs =
					typeof segment.endMs === 'number'
						? segment.endMs
						: undefined;
				if (typeof endMs !== 'number') {
					return max;
				}
				return typeof max === 'number' ? Math.max(max, endMs) : endMs;
			},
			undefined
		);
		const mediaSpeakers = [
			...new Set(
				rawSegments
					.map((segment) => normalizeMediaSpeaker(segment.speaker))
					.filter(
						(value): value is string => typeof value === 'string'
					)
			)
		];
		const segmentDocuments: RAGExtractedFileDocument[] = [];
		let previousGroupEndMs: number | undefined;
		for (const [index, segmentGroup] of segmentGroups.entries()) {
			const { endMs, startMs } = buildMediaTimestampBoundary(
				segmentGroup.segments
			);
			const groupText = normalizeWhitespace(
				segmentGroup.segments
					.map((segment) => normalizeWhitespace(segment.text ?? ''))
					.filter((value) => value.length > 0)
					.join(' ')
			);
			if (!groupText) {
				continue;
			}

			const mediaSegmentStartMs = startMs;
			const mediaSegmentEndMs = endMs;
			const startLabel = formatMediaTimestampForIngest(startMs);
			const endLabel = formatMediaTimestampForIngest(endMs);
			const mediaKind =
				typeof result.metadata?.mediaKind === 'string'
					? result.metadata.mediaKind
					: 'media';
			const mediaSegmentGapFromPreviousMs =
				buildMediaSegmentGapFromPrevious(startMs, previousGroupEndMs);
			const nextSegmentGroup = segmentGroups[index + 1];
			const nextSegmentGroupStartMs = nextSegmentGroup
				? buildMediaTimestampBoundary(nextSegmentGroup.segments).startMs
				: undefined;
			const mediaSegmentGapToNextMs = buildMediaSegmentGapToNext(
				endMs,
				nextSegmentGroupStartMs
			);
			previousGroupEndMs = endMs;
			const mediaSegmentGroupDurationMs =
				typeof endMs === 'number' &&
				typeof startMs === 'number' &&
				Number.isFinite(endMs) &&
				Number.isFinite(startMs) &&
				endMs >= startMs
					? endMs - startMs
					: undefined;

			segmentDocuments.push({
				chunking: input.chunking,
				contentType: input.contentType,
				format: 'text',
				id: `${baseDocumentId}-segment-${String(index + 1).padStart(2, '0')}`,
				metadata: {
					...(input.metadata ?? {}),
					...(result.metadata ?? {}),
					fileKind: 'media',
					sourceNativeKind: 'media_segment',
					mediaDurationMs,
					mediaSegmentIndex: index,
					mediaSegmentStartMs,
					mediaSegmentEndMs,
					mediaSegmentCount: segmentCount,
					mediaSegmentGroupIndex: index,
					mediaSegmentGroupSize: segmentGroup.segments.length,
					mediaSegmentGroupSpeaker: segmentGroup.speaker,
					mediaChannel: segmentGroup.channel,
					mediaSegmentGroupDurationMs,
					mediaSegmentGapFromPreviousMs,
					mediaSegmentGapToNextMs,
					mediaSegmentGroupStartMs: startMs,
					mediaSegmentGroupEndMs: endMs,
					mediaSegments: segmentGroup.segments,
					startMs: mediaSegmentStartMs,
					endMs: mediaSegmentEndMs,
					...(mediaSpeakers.length > 0
						? {
								mediaSpeakerCount: mediaSpeakers.length,
								mediaSpeakers
							}
						: {}),
					speaker: segmentGroup.speaker
				},
				source,
				text: normalizeWhitespace(
					`${mediaKind} transcript segment${
						startLabel
							? ` at timestamp ${startLabel}${
									endLabel ? ` to ${endLabel}` : ''
								}`
							: ''
					} from ${
						input.title ??
						input.name ??
						input.path ??
						DEFAULT_BINARY_NAME
					}. ` +
						`${mediaKind} timestamp evidence${
							startLabel
								? ` ${startLabel}${endLabel ? ` to ${endLabel}` : ''}`
								: ''
						}.` +
						`\n${groupText}`
				),
				title: input.title
					? `${input.title} · ${
							mediaKind[0]?.toUpperCase() + mediaKind.slice(1)
						} segment ${index + 1}`
					: `${mediaKind[0]?.toUpperCase() + mediaKind.slice(1)} segment ${index + 1}`
			});
		}

		const summaryDocument: RAGExtractedFileDocument = {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			id: baseDocumentId,
			metadata: {
				...(input.metadata ?? {}),
				...(result.metadata ?? {}),
				fileKind: 'media',
				mediaDurationMs,
				mediaSegmentCount: segmentCount,
				mediaSegments: rawSegments,
				...(mediaSpeakers.length > 0
					? {
							mediaSpeakerCount: mediaSpeakers.length,
							mediaSpeakers
						}
					: {})
			},
			source,
			text: result.text,
			title: result.title ?? input.title
		};

		return [summaryDocument, ...segmentDocuments];
	}
});
export const createRAGMediaTranscriber = (transcriber: RAGMediaTranscriber) =>
	transcriber;
export const createRAGOCRProvider = (provider: RAGOCRProvider) => provider;
export const createTextFileExtractor = (): RAGFileExtractor => ({
	name: 'absolute_text',
	supports: textExtractorSupports,
	extract: (input) => {
		const format =
			input.format ??
			inferFormatFromContentType(input.contentType ?? null) ??
			inferFormatFromName(
				input.path ?? input.source ?? input.name ?? input.title
			);
		const text = Buffer.from(input.data).toString('utf8');

		validateStructuredTextInput(text, format);

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format,
			metadata: input.metadata,
			source: input.source ?? input.path ?? input.name,
			text,
			title: input.title
		};
	}
});

const expandArchiveEntry = async (
	entry: RAGArchiveEntry,
	archiveInput: RAGFileExtractionInput,
	extractors?: RAGFileExtractor[],
	registry?: RAGFileExtractorRegistryLike
) => {
	const parentArchiveLineage = Array.isArray(
		archiveInput.metadata?.archiveLineage
	)
		? archiveInput.metadata.archiveLineage.filter(
				(value): value is string =>
					typeof value === 'string' && value.trim().length > 0
			)
		: [];
	const entryArchiveLineage = entry.path
		.split(/[\\/]/)
		.map((segment) => normalizeWhitespace(segment))
		.filter(Boolean);
	const archiveLineage = [...parentArchiveLineage, ...entryArchiveLineage];
	const parentArchivePath =
		typeof archiveInput.metadata?.archivePath === 'string' &&
		archiveInput.metadata.archivePath.trim().length > 0
			? archiveInput.metadata.archivePath.trim()
			: undefined;
	const archiveFullPath = parentArchivePath
		? `${parentArchivePath}!${entry.path}`
		: entry.path;
	const archiveRootName =
		(typeof archiveInput.metadata?.archiveRootName === 'string' &&
		archiveInput.metadata.archiveRootName.trim().length > 0
			? archiveInput.metadata.archiveRootName.trim()
			: undefined) ??
		archiveInput.name ??
		archiveInput.path?.split(/[/\\]/).pop() ??
		archiveInput.source;
	const archiveRootSource =
		(typeof archiveInput.metadata?.archiveRootSource === 'string' &&
		archiveInput.metadata.archiveRootSource.trim().length > 0
			? archiveInput.metadata.archiveRootSource.trim()
			: undefined) ??
		archiveInput.source ??
		archiveInput.path ??
		archiveInput.name;
	const documents = await extractRAGFileDocuments(
		{
			chunking: archiveInput.chunking,
			contentType: entry.contentType,
			data: entry.data,
			extractorRegistry: archiveInput.extractorRegistry,
			format: entry.format,
			metadata: {
				...(archiveInput.metadata ?? {}),
				...(entry.metadata ?? {}),
				archiveEntryName: basename(entry.path),
				archiveParentName:
					archiveInput.name ??
					archiveInput.path?.split(/[/\\]/).pop() ??
					archiveInput.source,
				archiveParentSource:
					archiveInput.source ??
					archiveInput.path ??
					archiveInput.name,
				archiveContainerPath: parentArchivePath,
				archiveDepth: archiveLineage.length,
				archiveFullPath,
				archiveLineage,
				archivePath: entry.path,
				archiveRootName,
				archiveRootSource,
				archiveNestedDepth: parentArchiveLineage.length + 1,
				fileKind: 'archive_entry'
			},
			name: basename(entry.path),
			source:
				archiveInput.source && !archiveInput.source.startsWith('http')
					? `${archiveInput.source}#${entry.path}`
					: entry.path,
			title: basename(entry.path)
		},
		extractors,
		registry
	);

	return documents;
};

export const createPDFFileExtractor = (): RAGFileExtractor => ({
	name: 'absolute_pdf',
	supports: pdfExtractorSupports,
	extract: (input) => {
		const extracted = extractNativePDFText(input.data);
		if (!extracted.text) {
			throw new Error(
				'AbsoluteJS could not extract readable text from this PDF. Supply a custom extractor for scanned or image-only PDFs.'
			);
		}

		return {
			chunking: input.chunking,
			contentType: input.contentType ?? 'application/pdf',
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				fileKind: 'pdf',
				pageCount: extracted.pageCount,
				pdfEvidenceMode: 'native',
				pdfEvidenceOrigin: 'native',
				pdfTextBlockCount: extracted.textBlockCount,
				pdfTextBlocks: extracted.textBlocks
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
			text: extracted.text,
			title: input.title
		};
	}
});
export const createRAGArchiveFileExtractor = (
	expander: RAGArchiveExpander,
	options: {
		entryExtractors?: RAGFileExtractor[];
	} = {}
): RAGFileExtractor => ({
	name: `absolute_archive:${expander.name}`,
	supports: archiveExtractorSupports,
	extract: async (input) => {
		const expanded = await expander.expand(input);
		const documents = await Promise.all(
			expanded.entries.map((entry) =>
				expandArchiveEntry(
					entry,
					input,
					options.entryExtractors ?? DEFAULT_FILE_EXTRACTORS
				)
			)
		);

		return documents.flat().map((document) => ({
			...document,
			metadata: {
				...(expanded.metadata ?? {}),
				...(document.metadata ?? {}),
				fileKind: 'archive'
			}
		}));
	}
});
export const createRAGPDFOCRExtractor = (
	options: RAGPDFOCRExtractorOptions
): RAGFileExtractor => ({
	name: `absolute_pdf_ocr:${options.provider.name}`,
	supports: pdfExtractorSupports,
	extract: async (input) => {
		const extracted = extractNativePDFText(input.data);
		const nativeText = extracted.text;
		const minLength = options.minExtractedTextLength ?? 80;
		const shouldUseNativeText =
			!options.alwaysOCR && nativeText.length >= minLength;
		const shouldUseHybridText =
			!options.alwaysOCR &&
			nativeText.length > 0 &&
			nativeText.length < minLength;

		if (shouldUseNativeText) {
			return {
				chunking: input.chunking,
				contentType: input.contentType ?? 'application/pdf',
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					fileKind: 'pdf',
					pageCount: extracted.pageCount,
					pdfEvidenceMode: 'native',
					pdfEvidenceOrigin: 'native',
					pdfTextBlockCount: extracted.textBlockCount,
					pdfTextBlocks: extracted.textBlocks,
					pdfTextMode: 'native'
				},
				source:
					input.source ??
					input.path ??
					input.name ??
					`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
				text: nativeText,
				title: input.title
			};
		}

		const ocr = await options.provider.extractText({
			...input,
			contentType: input.contentType ?? 'application/pdf'
		});
		const summary = buildOCRSummaryText(ocr);
		const baseMetadata = {
			...ocrMetadata(ocr),
			ocrLowConfidenceRegionCount: summary.lowConfidenceRegionCount,
			ocrStrongRegionCount: summary.strongRegionCount,
			ocrSummaryConfidenceThreshold: summary.summaryConfidenceThreshold,
			ocrSummaryUsedStrongRegionsOnly: summary.usedStrongRegionsOnly,
			fileKind: 'pdf',
			pageCount: extracted.pageCount,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr'
		};

		if (shouldUseHybridText) {
			const hybridMetadata = {
				...(input.metadata ?? {}),
				...baseMetadata,
				pageCount: extracted.pageCount,
				pdfEvidenceMode: 'hybrid',
				pdfEvidenceOrigin: 'native',
				pdfEvidenceSupplement: 'ocr',
				pdfHybridOCRSupplement: true,
				pdfNativeTextBlockCount: extracted.textBlockCount,
				pdfNativeTextLength: nativeText.length,
				pdfOCRFallbackReason: 'native_below_min_length',
				pdfOCRTextLength: summary.text.length,
				pdfTextBlockCount: extracted.textBlockCount,
				pdfTextBlocks: extracted.textBlocks,
				pdfTextMode: 'hybrid'
			};
			const hybridDocument: RAGExtractedFileDocument = {
				chunking: input.chunking,
				contentType: input.contentType ?? 'application/pdf',
				format: 'text',
				metadata: hybridMetadata,
				source:
					input.source ??
					input.path ??
					input.name ??
					`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
				text: nativeText,
				title: input.title
			};
			const pageDocuments = ocrPageDocuments(ocr, input, baseMetadata);
			const regionDocuments = ocrRegionDocuments(
				ocr,
				input,
				baseMetadata
			);

			return [hybridDocument, ...pageDocuments, ...regionDocuments];
		}

		const summaryDocument: RAGExtractedFileDocument = {
			chunking: input.chunking,
			contentType: input.contentType ?? 'application/pdf',
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				...baseMetadata
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
			text: summary.text,
			title: ocr.title ?? input.title
		};
		const pageDocuments = ocrPageDocuments(ocr, input, baseMetadata);
		const regionDocuments = ocrRegionDocuments(ocr, input, baseMetadata);

		return [summaryDocument, ...pageDocuments, ...regionDocuments];
	}
});

const DEFAULT_FILE_EXTRACTORS = [
	createOfficeDocumentExtractor(),
	createMailboxContainerExtractor(),
	createLegacyDocumentExtractor(),
	createEPUBExtractor(),
	createEmailExtractor(),
	createRAGArchiveFileExtractor(createBuiltinArchiveExpander()),
	createPDFFileExtractor(),
	createTextFileExtractor()
] satisfies RAGFileExtractor[];

const resolveExtractorRegistry = (
	registry?: RAGFileExtractorRegistryLike
): {
	defaultOrder: 'registry_first' | 'defaults_first';
	includeDefaults: boolean;
	registrations: RAGFileExtractorRegistration[];
} => {
	if (!registry) {
		return {
			defaultOrder: 'registry_first',
			includeDefaults: true,
			registrations: []
		};
	}

	if (Array.isArray(registry)) {
		return {
			defaultOrder: 'registry_first',
			includeDefaults: true,
			registrations: registry
		};
	}

	return {
		defaultOrder: registry.defaultOrder ?? 'registry_first',
		includeDefaults: registry.includeDefaults ?? true,
		registrations: registry.registrations
	};
};

const createExtractorRegistryInput = (
	input: RAGFileExtractionInput
): RAGFileExtractorRegistryInput => ({
	...input,
	inferredContentType: input.contentType ?? null,
	inferredExtension: inferExtensionFromInput(input) || null,
	inferredFormat:
		input.format ??
		inferFormatFromContentType(input.contentType ?? null) ??
		inferFormatFromName(
			input.path ?? input.source ?? input.name ?? input.title
		)
});

const registrationMatches = async (
	registration: RAGFileExtractorRegistration,
	input: RAGFileExtractorRegistryInput
) => {
	const normalizedContentType = input.inferredContentType?.toLowerCase();
	const normalizedExtension = input.inferredExtension?.toLowerCase();
	const normalizedName = (
		input.path ??
		input.source ??
		input.name ??
		input.title ??
		''
	).toLowerCase();

	if (
		registration.contentTypes?.length &&
		!registration.contentTypes.some(
			(entry) => normalizedContentType === entry.toLowerCase()
		)
	) {
		return false;
	}

	if (
		registration.extensions?.length &&
		!registration.extensions.some(
			(entry) => normalizedExtension === entry.toLowerCase()
		)
	) {
		return false;
	}

	if (
		registration.formats?.length &&
		(!input.inferredFormat ||
			!registration.formats.includes(input.inferredFormat))
	) {
		return false;
	}

	if (
		registration.names?.length &&
		!registration.names.some((entry) =>
			normalizedName.includes(entry.toLowerCase())
		)
	) {
		return false;
	}

	if (registration.match) {
		return registration.match(input);
	}

	return true;
};

const dedupeExtractors = (extractors: RAGFileExtractor[]) => {
	const seen = new Set<string>();
	const ordered: RAGFileExtractor[] = [];

	for (const extractor of extractors) {
		if (seen.has(extractor.name)) {
			continue;
		}
		seen.add(extractor.name);
		ordered.push(extractor);
	}

	return ordered;
};

type ResolvedFileExtractor = {
	extractor: RAGFileExtractor;
	registryMatchName?: string;
};

const dedupeResolvedExtractors = (extractors: ResolvedFileExtractor[]) => {
	const seen = new Set<string>();
	const ordered: ResolvedFileExtractor[] = [];

	for (const entry of extractors) {
		if (seen.has(entry.extractor.name)) {
			continue;
		}
		seen.add(entry.extractor.name);
		ordered.push(entry);
	}

	return ordered;
};

const resolveFileExtractors = async (
	input: RAGFileExtractionInput,
	extractors?: RAGFileExtractor[],
	registry?: RAGFileExtractorRegistryLike
): Promise<ResolvedFileExtractor[]> => {
	const explicit = extractors ?? [];
	const resolvedRegistry = resolveExtractorRegistry(registry);
	const registryInput = createExtractorRegistryInput(input);
	const matchedRegistrations = (
		await Promise.all(
			resolvedRegistry.registrations.map(async (registration) => ({
				matches: await registrationMatches(registration, registryInput),
				priority: registration.priority ?? 0,
				registration
			}))
		)
	)
		.filter((entry) => entry.matches)
		.sort((left, right) => right.priority - left.priority)
		.map((entry) => ({
			extractor: entry.registration.extractor,
			registryMatchName:
				entry.registration.name ?? entry.registration.extractor.name
		}));
	const defaults = resolvedRegistry.includeDefaults
		? DEFAULT_FILE_EXTRACTORS.map((extractor) => ({ extractor }))
		: [];
	const explicitResolved = explicit.map((extractor) => ({ extractor }));

	return dedupeResolvedExtractors(
		resolvedRegistry.defaultOrder === 'defaults_first'
			? [...explicitResolved, ...defaults, ...matchedRegistrations]
			: [...explicitResolved, ...matchedRegistrations, ...defaults]
	);
};

const applyExtractorDefaults = (
	document: RAGExtractedFileDocument,
	input: RAGFileExtractionInput,
	extractorName: string,
	registryMatchName?: string
): RAGIngestDocument => ({
	chunking: document.chunking ?? input.chunking,
	format:
		document.format ??
		input.format ??
		inferFormatFromContentType(
			document.contentType ?? input.contentType ?? null
		) ??
		inferFormatFromName(
			document.source ?? input.source ?? input.path ?? input.name
		),
	id: document.id,
	metadata: {
		...(input.metadata ?? {}),
		...(document.metadata ?? {}),
		contentType: document.contentType ?? input.contentType,
		extractor: document.extractor ?? extractorName,
		...(registryMatchName
			? { extractorRegistryMatch: registryMatchName }
			: {})
	},
	source: document.source ?? input.source ?? input.path ?? input.name,
	text: document.text,
	title: document.title ?? input.title
});

const extractRAGFileDocuments = async (
	input: RAGFileExtractionInput,
	extractors?: RAGFileExtractor[],
	registry?: RAGFileExtractorRegistryLike
) => {
	for (const resolvedExtractor of await resolveFileExtractors(
		input,
		extractors,
		registry
	)) {
		const { extractor, registryMatchName } = resolvedExtractor;
		if (!(await extractor.supports(input))) {
			continue;
		}

		const extracted = await extractor.extract(input);
		const documents = Array.isArray(extracted) ? extracted : [extracted];

		return documents.map((document) =>
			applyExtractorDefaults(
				document,
				input,
				extractor.name,
				registryMatchName
			)
		);
	}

	throw new Error(
		`No RAG file extractor matched ${inferNameFromInput(input)}. Register a custom extractor for this file type.`
	);
};

const getFirstExtractedDocument = (
	documents: RAGIngestDocument[],
	label: string
) => {
	const document = documents[0];
	if (!document) {
		throw new Error(`RAG extractor ${label} did not return a document`);
	}

	return document;
};

const loadExtractedDocuments = async (
	input: RAGFileExtractionInput,
	extractors?: RAGFileExtractor[],
	registry?: RAGFileExtractorRegistryLike
) => extractRAGFileDocuments(input, extractors, registry);

const collectEmailThreadParticipants = (documents: RAGIngestDocument[]) => {
	const participants = new Set<string>();
	const participantAddresses = new Set<string>();
	const participantDisplayNames = new Set<string>();

	for (const document of documents) {
		const parsedParticipantAddresses = Array.isArray(
			document.metadata?.participantAddresses
		)
			? document.metadata.participantAddresses
			: [];
		for (const address of parsedParticipantAddresses) {
			if (typeof address === 'string' && address.trim().length > 0) {
				participantAddresses.add(address.trim());
				participants.add(address.trim());
			}
		}
		const parsedParticipantDisplayNames = Array.isArray(
			document.metadata?.participantDisplayNames
		)
			? document.metadata.participantDisplayNames
			: [];
		for (const name of parsedParticipantDisplayNames) {
			if (typeof name === 'string' && name.trim().length > 0) {
				participantDisplayNames.add(name.trim());
			}
		}

		const from = document.metadata?.from;
		if (typeof from === 'string' && from.trim().length > 0) {
			participants.add(from.trim());
		}

		const to = document.metadata?.to;
		if (typeof to === 'string' && to.trim().length > 0) {
			for (const recipient of to
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean)) {
				participants.add(recipient);
			}
		}
	}

	return {
		participantAddresses: [...participantAddresses],
		participantDisplayNames: [...participantDisplayNames],
		participants: [...participants]
	};
};

const reconcileLoadedEmailThreads = (documents: RAGIngestDocument[]) => {
	const messageDocuments = documents.filter(
		(document) => document.metadata?.emailKind === 'message'
	);
	if (messageDocuments.length === 0) {
		return documents;
	}

	const parent = messageDocuments.map((_, index) => index);
	const find = (index: number): number => {
		let current = index;
		while (parent[current] !== current) {
			parent[current] = parent[parent[current]!]!;
			current = parent[current]!;
		}
		return current;
	};
	const union = (left: number, right: number) => {
		const leftRoot = find(left);
		const rightRoot = find(right);
		if (leftRoot !== rightRoot) {
			parent[rightRoot] = leftRoot;
		}
	};
	const messageIndexById = new Map<string, number>();
	const messageIndexBySource = new Map<string, number>();
	const messageIndexesByThreadKey = new Map<string, number[]>();
	for (const [index, document] of messageDocuments.entries()) {
		const messageId = document.metadata?.messageId;
		if (typeof messageId === 'string' && messageId.length > 0) {
			messageIndexById.set(messageId, index);
		}
		if (typeof document.source === 'string' && document.source.length > 0) {
			messageIndexBySource.set(document.source, index);
		}
		const threadKey = document.metadata?.threadKey;
		if (typeof threadKey === 'string' && threadKey.trim().length > 0) {
			const normalizedThreadKey = threadKey.trim();
			const current = messageIndexesByThreadKey.get(normalizedThreadKey);
			if (current) {
				current.push(index);
			} else {
				messageIndexesByThreadKey.set(normalizedThreadKey, [index]);
			}
		}
	}

	for (const indexes of messageIndexesByThreadKey.values()) {
		for (let index = 1; index < indexes.length; index += 1) {
			union(indexes[0]!, indexes[index]!);
		}
	}
	for (const [index, document] of messageDocuments.entries()) {
		const inReplyTo = document.metadata?.inReplyTo;
		if (typeof inReplyTo === 'string' && inReplyTo.length > 0) {
			const parentIndex = messageIndexById.get(inReplyTo);
			if (typeof parentIndex === 'number') {
				union(index, parentIndex);
			}
		}
		const threadMessageIds = Array.isArray(
			document.metadata?.threadMessageIds
		)
			? document.metadata.threadMessageIds
			: [];
		for (const relatedMessageId of threadMessageIds) {
			if (
				typeof relatedMessageId !== 'string' ||
				relatedMessageId.length === 0
			) {
				continue;
			}
			const relatedIndex = messageIndexById.get(relatedMessageId);
			if (typeof relatedIndex === 'number') {
				union(index, relatedIndex);
			}
		}
	}

	const threadGroups = new Map<number, RAGIngestDocument[]>();
	for (const [index, document] of messageDocuments.entries()) {
		const component = find(index);
		const current = threadGroups.get(component);
		if (current) {
			current.push(document);
		} else {
			threadGroups.set(component, [document]);
		}
	}
	for (const document of documents) {
		if (document.metadata?.emailKind === 'message') {
			continue;
		}
		const messageSource = document.metadata?.emailMessageSource;
		if (typeof messageSource === 'string' && messageSource.length > 0) {
			const messageIndex = messageIndexBySource.get(messageSource);
			if (typeof messageIndex === 'number') {
				const component = find(messageIndex);
				const current = threadGroups.get(component);
				if (current) {
					current.push(document);
				} else {
					threadGroups.set(component, [document]);
				}
				continue;
			}
		}

		const threadKey = document.metadata?.threadKey;
		if (typeof threadKey === 'string' && threadKey.trim().length > 0) {
			const candidateIndexes = messageIndexesByThreadKey.get(
				threadKey.trim()
			);
			const candidateIndex = candidateIndexes?.[0];
			if (typeof candidateIndex === 'number') {
				const component = find(candidateIndex);
				const current = threadGroups.get(component);
				if (current) {
					current.push(document);
				} else {
					threadGroups.set(component, [document]);
				}
			}
		}
	}

	for (const [, threadDocuments] of threadGroups.entries()) {
		const componentMessages = threadDocuments.filter(
			(document) => document.metadata?.emailKind === 'message'
		);
		if (componentMessages.length === 0) {
			continue;
		}
		const threadKey = (() => {
			const rootByReply = componentMessages.find(
				(document) =>
					typeof document.metadata?.inReplyTo !== 'string' ||
					document.metadata.inReplyTo.length === 0
			);
			const rootCandidate = rootByReply ?? componentMessages[0];
			return (
				(typeof rootCandidate?.metadata?.threadKey === 'string' &&
				rootCandidate.metadata.threadKey.trim().length > 0
					? rootCandidate.metadata.threadKey.trim()
					: undefined) ??
				componentMessages
					.map((document) => document.metadata?.threadKey)
					.find(
						(value): value is string =>
							typeof value === 'string' && value.trim().length > 0
					)
					?.trim() ??
				'email-thread'
			);
		})();

		const knownThreadMessageIds: string[] = [];
		const seenKnownThreadMessageIds = new Set<string>();
		for (const document of threadDocuments) {
			const threadMessageIds = Array.isArray(
				document.metadata?.threadMessageIds
			)
				? document.metadata?.threadMessageIds
				: [];
			for (const messageId of threadMessageIds) {
				if (
					typeof messageId === 'string' &&
					messageId.length > 0 &&
					!seenKnownThreadMessageIds.has(messageId)
				) {
					seenKnownThreadMessageIds.add(messageId);
					knownThreadMessageIds.push(messageId);
				}
			}
			const messageId = document.metadata?.messageId;
			if (
				typeof messageId === 'string' &&
				messageId.length > 0 &&
				!seenKnownThreadMessageIds.has(messageId)
			) {
				seenKnownThreadMessageIds.add(messageId);
				knownThreadMessageIds.push(messageId);
			}
		}

		const loadedMessageIds = componentMessages
			.map((document) => document.metadata?.messageId)
			.filter(
				(value): value is string =>
					typeof value === 'string' && value.length > 0
			);
		const loadedMessageIdSet = new Set(loadedMessageIds);
		const loadedMessageSourceById = new Map<string, string>();
		for (const document of componentMessages) {
			const messageId = document.metadata?.messageId;
			if (
				typeof messageId === 'string' &&
				messageId.length > 0 &&
				typeof document.source === 'string' &&
				document.source.length > 0
			) {
				loadedMessageSourceById.set(messageId, document.source);
			}
		}
		const replySiblingGroups = new Map<string, typeof componentMessages>();
		for (const document of componentMessages) {
			const inReplyTo = document.metadata?.inReplyTo;
			if (
				typeof inReplyTo !== 'string' ||
				inReplyTo.length === 0 ||
				!loadedMessageIdSet.has(inReplyTo)
			) {
				continue;
			}

			const current = replySiblingGroups.get(inReplyTo);
			if (current) {
				current.push(document);
			} else {
				replySiblingGroups.set(inReplyTo, [document]);
			}
		}
		const replySiblingMetadataByMessageId = new Map<
			string,
			{
				count: number;
				index: number;
				messageIds: string[];
				parentMessageId: string;
				sources: string[];
			}
		>();
		for (const [
			parentMessageId,
			siblings
		] of replySiblingGroups.entries()) {
			const orderedSiblings = [...siblings].sort((left, right) => {
				const leftSource =
					typeof left.source === 'string' ? left.source : '';
				const rightSource =
					typeof right.source === 'string' ? right.source : '';
				if (leftSource !== rightSource) {
					return leftSource.localeCompare(rightSource);
				}
				const leftMessageId =
					typeof left.metadata?.messageId === 'string'
						? left.metadata.messageId
						: '';
				const rightMessageId =
					typeof right.metadata?.messageId === 'string'
						? right.metadata.messageId
						: '';
				return leftMessageId.localeCompare(rightMessageId);
			});
			const siblingMessageIds = orderedSiblings
				.map((document) => document.metadata?.messageId)
				.filter(
					(value): value is string =>
						typeof value === 'string' && value.length > 0
				);
			const siblingSources = orderedSiblings
				.map((document) => document.source)
				.filter(
					(value): value is string =>
						typeof value === 'string' && value.length > 0
				);
			for (const [index, sibling] of orderedSiblings.entries()) {
				const messageId = sibling.metadata?.messageId;
				if (typeof messageId !== 'string' || messageId.length === 0) {
					continue;
				}
				replySiblingMetadataByMessageId.set(messageId, {
					count: orderedSiblings.length,
					index,
					messageIds: siblingMessageIds,
					parentMessageId,
					sources: siblingSources
				});
			}
		}

		const threadParticipants =
			collectEmailThreadParticipants(threadDocuments);
		const loadedMessageSources = messageDocuments
			.map((document) => document.source)
			.filter(
				(value): value is string =>
					typeof value === 'string' && value.length > 0
			);
		const loadedAttachmentCount = threadDocuments.filter(
			(document) => document.metadata?.emailKind === 'attachment'
		).length;
		const threadRootMessageId = (() => {
			const existingRoot = threadDocuments
				.map((document) => document.metadata?.threadRootMessageId)
				.find(
					(value): value is string =>
						typeof value === 'string' && value.length > 0
				);
			return existingRoot ?? loadedMessageIds[0];
		})();

		for (const document of threadDocuments) {
			const messageId =
				typeof document.metadata?.messageId === 'string'
					? document.metadata.messageId
					: undefined;
			const replySiblingMetadata = messageId
				? replySiblingMetadataByMessageId.get(messageId)
				: undefined;
			document.metadata = {
				...(document.metadata ?? {}),
				...(replySiblingMetadata
					? {
							emailReplySiblingCount: replySiblingMetadata.count,
							emailReplySiblingIndex: replySiblingMetadata.index,
							emailReplySiblingMessageIds:
								replySiblingMetadata.messageIds,
							emailReplySiblingOrdinal:
								replySiblingMetadata.index + 1,
							emailReplySiblingParentMessageId:
								replySiblingMetadata.parentMessageId,
							emailReplySiblingSources:
								replySiblingMetadata.sources
						}
					: {}),
				threadKey,
				threadKnownMessageCount: knownThreadMessageIds.length,
				threadKnownMessageIds: knownThreadMessageIds,
				threadLoadedAttachmentCount: loadedAttachmentCount,
				threadLoadedMessageCount: loadedMessageIds.length,
				threadLoadedMessageIds: loadedMessageIds,
				threadLoadedMessageSources: loadedMessageSources,
				threadParticipantAddresses:
					threadParticipants.participantAddresses,
				threadParticipantDisplayNames:
					threadParticipants.participantDisplayNames,
				threadParticipants: threadParticipants.participants,
				threadRootMessageId
			};

			const inReplyTo = document.metadata?.inReplyTo;
			if (
				typeof inReplyTo === 'string' &&
				inReplyTo.length > 0 &&
				loadedMessageIdSet.has(inReplyTo)
			) {
				document.metadata = {
					...(document.metadata ?? {}),
					emailReplyParentLoaded: true,
					emailReplyParentMessageId: inReplyTo,
					emailReplyParentSource:
						loadedMessageSourceById.get(inReplyTo)
				};
			}
		}
	}

	return documents;
};

const sentenceUnits = (text: string) => {
	const matches = text.match(/[^.!?\n]+(?:[.!?]+|$)/g);
	if (!matches) {
		return [text];
	}

	return matches.map((entry) => entry.trim()).filter(Boolean);
};

const paragraphUnits = (text: string) => {
	const paragraphs = text
		.split(/\n\n+/)
		.map((entry) => entry.trim())
		.filter(Boolean);

	return paragraphs.length > 0 ? paragraphs : sentenceUnits(text);
};

const fixedUnits = (text: string, maxChunkLength: number) => {
	const units: string[] = [];
	let index = 0;
	while (index < text.length) {
		units.push(text.slice(index, index + maxChunkLength));
		index += maxChunkLength;
	}

	return units;
};

const sourceAwareUnits = (
	document: RAGIngestDocument,
	format: RAGContentFormat,
	normalizedText: string
): StructuredChunkUnit[] => {
	const resolveStructuredUnits = (sections: StructuredChunkUnit[]) =>
		sections.length > 0
			? sections
			: paragraphUnits(normalizedText).map((text) => ({ text }));

	switch (format) {
		case 'jsonl': {
			const sections = jsonlStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'tsv': {
			const sections = tsvStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'csv': {
			const sections = csvStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'xml': {
			const sections = xmlStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'yaml': {
			const sections = yamlStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'markdown': {
			const sections = markdownStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'html': {
			const sections = htmlStructureUnits(document.text);

			return resolveStructuredUnits(sections);
		}
		case 'text':
		default:
			if (document.metadata?.fileKind === 'office') {
				const sections = officeNativeStructureUnits(document.metadata);
				if (sections.length > 0) {
					return sections;
				}
			}
			if (document.metadata?.fileKind === 'pdf') {
				const sections = pdfNativeStructureUnits(document.metadata);
				if (sections.length > 0) {
					return sections;
				}
			}
			if (document.metadata?.sourceNativeKind === 'spreadsheet_sheet') {
				return spreadsheetStructureUnits(
					normalizedText,
					document.metadata
				);
			}
			if (document.metadata?.sourceNativeKind === 'presentation_slide') {
				return presentationStructureUnits(
					normalizedText,
					document.metadata
				);
			}
			if (document.metadata?.fileKind === 'email') {
				const sections = emailStructureUnits(
					normalizedText,
					document.metadata
				);
				if (sections.length > 0) {
					return sections;
				}
			}
			if (
				document.source?.toLowerCase().endsWith('.docx') ||
				document.source?.toLowerCase().endsWith('.odt')
			) {
				return officeHeadingStructureUnits(normalizedText);
			}
			if (isCodeLikeSource(document.source)) {
				return codeStructureUnits(document.text);
			}
			return paragraphUnits(normalizedText).map((text) => ({ text }));
	}
};

const overlapTail = (value: string, overlap: number) => {
	if (overlap <= 0 || value.length <= overlap) {
		return value;
	}

	const candidate = value.slice(-overlap);
	const boundary = candidate.search(/[\s,.;:!?-]/);

	return boundary > 0 ? candidate.slice(boundary).trim() : candidate.trim();
};

const chunkFromUnits = (
	units: string[],
	maxChunkLength: number,
	chunkOverlap: number,
	minChunkLength: number
) => {
	const chunks: string[] = [];
	let current = '';
	const appendChunk = (chunk: string) => {
		chunks.push(chunk);
	};
	const mergeSmallChunk = (merged: string[], chunk: string) => {
		const last = merged[merged.length - 1];
		if (!(last && chunk.length < minChunkLength)) {
			merged.push(chunk);

			return;
		}

		merged[merged.length - 1] = normalizeWhitespace(`${last} ${chunk}`);
	};
	const appendUnitToChunk = (trimmed: string) => {
		if (!current) {
			current = trimmed;

			return;
		}

		const separator =
			current.includes('\n') || trimmed.includes('\n') ? '\n\n' : ' ';
		const candidate = `${current}${separator}${trimmed}`;
		if (candidate.length <= maxChunkLength) {
			current = candidate;

			return;
		}

		appendChunk(current);
		const carry = overlapTail(current, chunkOverlap);
		current = carry.length > 0 ? `${carry} ${trimmed}`.trim() : trimmed;
	};

	for (const unit of units) {
		const trimmed = unit.trim();
		if (!trimmed) continue;
		appendUnitToChunk(trimmed);
	}

	if (current) {
		appendChunk(current);
	}

	const normalizedChunks = chunks
		.map((entry) => normalizeWhitespace(entry))
		.filter(Boolean);

	if (normalizedChunks.length <= 1) {
		return normalizedChunks;
	}

	const merged: string[] = [];
	for (const chunk of normalizedChunks) {
		mergeSmallChunk(merged, chunk);
	}

	return merged;
};

const chunkSourceAwareUnit = (
	unit: StructuredChunkUnit,
	options: Required<
		Pick<
			RAGChunkingOptions,
			'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
		>
	>
): StructuredChunkUnit[] => {
	const defaultSourceAwareChunkReason =
		unit.sectionKind === 'markdown_heading' ||
		unit.sectionKind === 'html_heading' ||
		unit.sectionKind === 'office_heading'
			? 'section_boundary'
			: unit.sectionKind
				? 'source_native_unit'
				: unit.sourceAwareChunkReason;
	if (
		unit.officeBlockKind === 'table' &&
		typeof unit.officeTableHeaderText === 'string' &&
		typeof unit.officeTableBodyRowCount === 'number' &&
		unit.officeTableBodyRowCount > 0 &&
		unit.text.length > options.maxChunkLength
	) {
		const headerLine = unit.officeTableHeaderText;
		const contextText =
			typeof unit.officeTableContextText === 'string'
				? unit.officeTableContextText
				: undefined;
		const followUpText =
			typeof unit.officeTableFollowUpText === 'string'
				? unit.officeTableFollowUpText
				: undefined;
		const bodyRows = unit.text
			.split('\n')
			.map((line) => normalizeWhitespace(line))
			.filter((line) => /^Row \d+\./.test(line))
			.slice(1);
		const slices: Array<{
			bodyRowEnd: number;
			bodyRowStart: number;
			text: string;
		}> = [];
		let currentRows: string[] = [];
		let currentStart = 1;

		const pushSlice = () => {
			if (currentRows.length === 0) {
				return;
			}
			slices.push({
				bodyRowEnd: currentStart + currentRows.length - 1,
				bodyRowStart: currentStart,
				text: normalizeWhitespace(
					[
						...(typeof contextText === 'string'
							? [contextText]
							: []),
						headerLine,
						...currentRows,
						...(typeof followUpText === 'string'
							? [followUpText]
							: [])
					].join('\n')
				)
			});
			currentStart += currentRows.length;
			currentRows = [];
		};

		for (const row of bodyRows) {
			const candidateRows = [...currentRows, row];
			const candidateText = normalizeWhitespace(
				[
					...(typeof contextText === 'string' ? [contextText] : []),
					headerLine,
					...candidateRows,
					...(typeof followUpText === 'string' ? [followUpText] : [])
				].join('\n')
			);
			if (
				currentRows.length > 0 &&
				candidateText.length > options.maxChunkLength
			) {
				pushSlice();
			}
			currentRows.push(row);
		}
		pushSlice();

		if (slices.length > 0) {
			return slices.map((slice) => ({
				...unit,
				officeTableBodyRowCount:
					slice.bodyRowEnd - slice.bodyRowStart + 1,
				officeTableBodyRowEnd: slice.bodyRowEnd,
				officeTableBodyRowStart: slice.bodyRowStart,
				officeTableChunkKind:
					slices.length > 1 ? 'table_slice' : 'full_table',
				officeTableRowCount: slice.bodyRowEnd - slice.bodyRowStart + 2,
				sourceAwareChunkReason:
					slices.length > 1
						? 'size_limit'
						: defaultSourceAwareChunkReason,
				text: slice.text
			}));
		}
	}
	if (
		unit.pdfTextKind === 'table_like' &&
		typeof unit.pdfTableHeaderText === 'string' &&
		typeof unit.pdfTableBodyRowCount === 'number' &&
		unit.pdfTableBodyRowCount > 0 &&
		unit.text.length > options.maxChunkLength
	) {
		const headerLine = unit.pdfTableHeaderText;
		const bodyRows = unit.text
			.split('\n')
			.map((line) => normalizeWhitespace(line))
			.filter(Boolean)
			.slice(1);
		const slices: Array<{
			bodyRowEnd: number;
			bodyRowStart: number;
			text: string;
		}> = [];
		let currentRows: string[] = [];
		let currentStart = 1;

		const pushSlice = () => {
			if (currentRows.length === 0) {
				return;
			}
			slices.push({
				bodyRowEnd: currentStart + currentRows.length - 1,
				bodyRowStart: currentStart,
				text: normalizeWhitespace(
					[headerLine, ...currentRows].join('\n')
				)
			});
			currentStart += currentRows.length;
			currentRows = [];
		};

		for (const row of bodyRows) {
			const candidateRows = [...currentRows, row];
			const candidateText = normalizeWhitespace(
				[headerLine, ...candidateRows].join('\n')
			);
			if (
				currentRows.length > 0 &&
				candidateText.length > options.maxChunkLength
			) {
				pushSlice();
			}
			currentRows.push(row);
		}
		pushSlice();

		if (slices.length > 0) {
			return slices.map((slice) => ({
				...unit,
				pdfTableBodyRowCount: slice.bodyRowEnd - slice.bodyRowStart + 1,
				pdfTableBodyRowEnd: slice.bodyRowEnd,
				pdfTableBodyRowStart: slice.bodyRowStart,
				pdfTableChunkKind:
					slices.length > 1 ? 'table_slice' : 'full_table',
				pdfTableRowCount: slice.bodyRowEnd - slice.bodyRowStart + 2,
				sourceAwareChunkReason:
					slices.length > 1
						? 'size_limit'
						: defaultSourceAwareChunkReason,
				text: slice.text
			}));
		}
	}
	if (unit.text.length <= options.maxChunkLength) {
		return [
			{
				...unit,
				...(defaultSourceAwareChunkReason
					? { sourceAwareChunkReason: defaultSourceAwareChunkReason }
					: {})
			}
		];
	}

	const expandOversizedParagraph = (paragraph: string) => {
		if (paragraph.length <= options.maxChunkLength) {
			return [paragraph];
		}

		const isLikelyCodeChunk =
			paragraph.includes('\n') &&
			(/(^|\n)\s{2,}\S/.test(paragraph) ||
				/\b(function|class|const|let|var|import|export|return|if|else|for|while|switch|case|try|catch|interface|type|enum)\b/.test(
					paragraph
				) ||
				/[{}();=>]/.test(paragraph));
		if (isLikelyCodeChunk) {
			const codeUnits = paragraph.includes('\n\n')
				? paragraph.split(/\n{2,}/).filter(Boolean)
				: paragraph.split('\n').filter(Boolean);
			const codeChunks = chunkFromUnits(
				codeUnits,
				options.maxChunkLength,
				0,
				options.minChunkLength
			);
			if (codeChunks.length > 1) {
				return codeChunks;
			}
		}

		const sentenceChunks = chunkFromUnits(
			sentenceUnits(paragraph),
			options.maxChunkLength,
			0,
			options.minChunkLength
		);
		if (sentenceChunks.length > 1) {
			return sentenceChunks;
		}

		return chunkFromUnits(
			fixedUnits(paragraph, options.maxChunkLength),
			options.maxChunkLength,
			0,
			options.minChunkLength
		);
	};

	const stableParagraphs = (
		unit.preferredChunkUnits ?? paragraphUnits(unit.text)
	).flatMap(expandOversizedParagraph);
	const stableChunks: string[] = [];
	let current = '';

	const pushCurrent = () => {
		if (!current) {
			return;
		}

		stableChunks.push(normalizeWhitespace(current));
		current = '';
	};

	for (const paragraph of stableParagraphs) {
		const trimmed = paragraph.trim();
		if (!trimmed) {
			continue;
		}

		if (!current) {
			current = trimmed;
			continue;
		}

		const candidate = `${current}\n\n${trimmed}`;
		if (candidate.length <= options.maxChunkLength) {
			current = candidate;
			continue;
		}

		pushCurrent();
		current = trimmed;
	}

	pushCurrent();

	const merged: string[] = [];
	for (const chunk of stableChunks) {
		const last = merged.at(-1);
		if (
			last &&
			chunk.length < options.minChunkLength &&
			`${last}\n\n${chunk}`.length <= options.maxChunkLength
		) {
			merged[merged.length - 1] = normalizeWhitespace(
				`${last}\n\n${chunk}`
			);
			continue;
		}

		merged.push(chunk);
	}

	const decorateSourceAwareChunkText = (text: string) => {
		if (!unit.preferredChunkUnits || !unit.sectionTitle) {
			return text;
		}

		if (unit.sectionKind === 'spreadsheet_rows') {
			if (text.includes(`Sheet ${unit.sectionTitle}`)) {
				return text;
			}
			return normalizeWhitespace(`Sheet ${unit.sectionTitle}\n${text}`);
		}

		if (unit.sectionKind === 'presentation_slide') {
			if (text.includes(unit.sectionTitle)) {
				return text;
			}
			return normalizeWhitespace(`${unit.sectionTitle}\n${text}`);
		}

		return text;
	};

	const resolveSpreadsheetChunkRowRange = (text: string) => {
		if (unit.sectionKind !== 'spreadsheet_rows') {
			return {};
		}

		const rowNumbers = [...text.matchAll(/^Row (\d+)\./gm)]
			.map((match) => Number(match[1] ?? NaN))
			.filter((value) => Number.isFinite(value));

		if (rowNumbers.length === 0) {
			return {};
		}

		return {
			spreadsheetRowEnd: rowNumbers[rowNumbers.length - 1],
			spreadsheetRowStart: rowNumbers[0]
		};
	};

	return merged.map((text) => {
		const decoratedText = decorateSourceAwareChunkText(text);
		const sourceAwareChunkReason =
			merged.length > 1 ? 'size_limit' : defaultSourceAwareChunkReason;

		return {
			...unit,
			...(sourceAwareChunkReason ? { sourceAwareChunkReason } : {}),
			...resolveSpreadsheetChunkRowRange(decoratedText),
			text: decoratedText
		};
	});
};

const resolveChunkingUnits = (
	text: string,
	options: Required<
		Pick<
			RAGChunkingOptions,
			'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
		>
	>
) => {
	if (options.strategy === 'fixed') {
		return fixedUnits(text, options.maxChunkLength);
	}

	if (options.strategy === 'sentences') {
		return sentenceUnits(text);
	}

	return paragraphUnits(text);
};

const resolveChunkingProfiles = (
	registry?: RAGChunkingRegistryLike
): RAGChunkingProfile[] => {
	if (!registry) {
		return [];
	}

	const profiles = Array.isArray(registry) ? registry : registry.profiles;

	return profiles
		.map((profile, index) => normalizeChunkingProfile(profile, index))
		.sort((left, right) => right.priority - left.priority)
		.map(({ profile }) => profile);
};

const normalizeChunkingProfile = (
	profile: RAGChunkingProfile | RAGChunkingProfileRegistration,
	index: number
) => {
	if ('resolve' in profile) {
		return {
			priority: 0,
			profile
		};
	}

	const options = normalizeChunkingProfileOptions(profile.profile);
	const sourceSet =
		profile.sources?.filter((value) => typeof value === 'string') ?? [];
	const documentIdSet =
		profile.documentIds?.filter((value) => typeof value === 'string') ?? [];
	const formatSet =
		profile.formats?.filter((value) => typeof value === 'string') ?? [];
	const sourceNativeKindSet =
		profile.sourceNativeKinds?.filter(
			(value) => typeof value === 'string'
		) ?? [];

	return {
		priority: profile.priority ?? 0,
		profile: {
			name:
				profile.name ??
				`chunking_profile_${String(index + 1).padStart(2, '0')}`,
			resolve: (input: RAGChunkingProfileInput) => {
				const documentId =
					input.document.id?.trim() ||
					(typeof input.metadata.documentId === 'string'
						? input.metadata.documentId
						: undefined);
				const source = input.document.source?.trim();
				if (formatSet.length > 0 && !formatSet.includes(input.format)) {
					return undefined;
				}
				if (
					sourceNativeKindSet.length > 0 &&
					(!input.sourceNativeKind ||
						!sourceNativeKindSet.includes(input.sourceNativeKind))
				) {
					return undefined;
				}
				if (
					sourceSet.length > 0 &&
					(!source || !sourceSet.includes(source))
				) {
					return undefined;
				}
				if (
					documentIdSet.length > 0 &&
					(!documentId || !documentIdSet.includes(documentId))
				) {
					return undefined;
				}

				return options;
			}
		}
	};
};

const normalizeChunkingProfileOptions = (
	profile:
		| Partial<RAGChunkingOptions>
		| {
				options?: Partial<RAGChunkingOptions>;
		  }
): Partial<RAGChunkingOptions> =>
	isChunkingProfileOptionsWrapper(profile)
		? (profile.options ?? {})
		: profile;

const isChunkingProfileOptionsWrapper = (
	profile:
		| Partial<RAGChunkingOptions>
		| {
				options?: Partial<RAGChunkingOptions>;
		  }
): profile is { options?: Partial<RAGChunkingOptions> } =>
	Object.prototype.hasOwnProperty.call(profile, 'options');

const resolveChunkingProfileOverrides = ({
	defaults,
	document,
	format,
	normalizedText,
	registry
}: {
	defaults?: RAGChunkingOptions;
	document: RAGIngestDocument;
	format: RAGContentFormat;
	normalizedText: string;
	registry?: RAGChunkingRegistryLike;
}) => {
	const metadata = document.metadata ?? {};
	const sourceNativeKind =
		typeof metadata.sourceNativeKind === 'string'
			? metadata.sourceNativeKind
			: undefined;

	for (const profile of resolveChunkingProfiles(registry)) {
		const options = profile.resolve({
			defaults,
			document,
			format,
			metadata,
			normalizedText,
			sourceNativeKind
		});
		if (options) {
			return {
				name: profile.name,
				options
			};
		}
	}

	return undefined;
};

const resolveChunkingOptions = (
	document: RAGIngestDocument,
	defaults?: RAGChunkingOptions,
	registry?: RAGChunkingRegistryLike,
	format?: RAGContentFormat,
	normalizedText?: string
): Required<
	Pick<
		RAGChunkingOptions,
		'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
	>
> => {
	const resolvedFormat = format ?? inferFormat(document);
	const resolvedNormalizedText =
		normalizedText ?? normalizeDocumentText(document.text, resolvedFormat);
	const profileOverrides = resolveChunkingProfileOverrides({
		defaults,
		document,
		format: resolvedFormat,
		normalizedText: resolvedNormalizedText,
		registry
	});
	const maxChunkLength =
		document.chunking?.maxChunkLength ??
		profileOverrides?.options.maxChunkLength ??
		defaults?.maxChunkLength ??
		DEFAULT_MAX_CHUNK_LENGTH;
	const chunkOverlap =
		document.chunking?.chunkOverlap ??
		profileOverrides?.options.chunkOverlap ??
		defaults?.chunkOverlap ??
		DEFAULT_CHUNK_OVERLAP;
	const minChunkLength =
		document.chunking?.minChunkLength ??
		profileOverrides?.options.minChunkLength ??
		defaults?.minChunkLength ??
		DEFAULT_MIN_CHUNK_LENGTH;
	const strategy =
		document.chunking?.strategy ??
		profileOverrides?.options.strategy ??
		defaults?.strategy ??
		DEFAULT_STRATEGY;

	return {
		chunkOverlap: Math.max(0, Math.min(chunkOverlap, maxChunkLength - 1)),
		maxChunkLength: Math.max(RAG_MIN_CHUNK_LENGTH_FLOOR, maxChunkLength),
		minChunkLength: Math.max(1, minChunkLength),
		strategy
	};
};

const createChunkEntries = (
	document: RAGIngestDocument,
	format: RAGContentFormat,
	text: string,
	options: Required<
		Pick<
			RAGChunkingOptions,
			'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
		>
	>
): StructuredChunkUnit[] => {
	if (
		text.length <= options.maxChunkLength &&
		options.strategy !== 'source_aware'
	) {
		return [{ text }];
	}

	if (options.strategy === 'source_aware') {
		return sourceAwareUnits(document, format, text).flatMap((unit) =>
			chunkSourceAwareUnit(unit, options)
		);
	}

	const units = resolveChunkingUnits(text, options);

	return chunkFromUnits(
		units,
		options.maxChunkLength,
		options.chunkOverlap,
		options.minChunkLength
	).map((entry) => ({ text: entry }));
};

export const prepareRAGDocument = (
	document: RAGIngestDocument,
	defaultChunking?: RAGChunkingOptions,
	chunkingRegistry?: RAGChunkingRegistryLike
): RAGPreparedDocument => {
	const format = inferFormat(document);
	const normalizedText = normalizeDocumentText(document.text, format);
	const chunkingProfileOverrides = resolveChunkingProfileOverrides({
		defaults: defaultChunking,
		document,
		format,
		normalizedText,
		registry: chunkingRegistry
	});
	const chunking = resolveChunkingOptions(
		document,
		defaultChunking,
		chunkingRegistry,
		format,
		normalizedText
	);
	const documentId =
		document.id?.trim() ||
		slugify(
			document.source ||
				document.title ||
				normalizedText.slice(0, RAG_DOCUMENT_ID_PREVIEW_LENGTH)
		);
	const title = document.title?.trim() || documentId;
	let sourceExtension = 'txt';
	if (format === 'markdown') {
		sourceExtension = 'md';
	} else if (format === 'html') {
		sourceExtension = 'html';
	}

	const source =
		document.source?.trim() || `${documentId}.${sourceExtension}`;
	const corpusKey =
		document.corpusKey?.trim() ||
		(typeof document.metadata?.corpusKey === 'string'
			? document.metadata.corpusKey.trim()
			: undefined) ||
		undefined;
	const metadata: RAGPreparedDocument['metadata'] = {
		...(document.metadata ?? {}),
		...(corpusKey ? { corpusKey } : {}),
		documentId,
		...(chunkingProfileOverrides?.name
			? { chunkingProfile: chunkingProfileOverrides.name }
			: {}),
		format,
		source,
		title
	};
	const chunkEntries = createChunkEntries(
		document,
		format,
		normalizedText,
		chunking
	);
	const chunks: RAGDocumentChunk[] = chunkEntries.map((entry, index) => {
		const sectionPath = Array.isArray(entry.sectionPath)
			? entry.sectionPath.filter(
					(value) => typeof value === 'string' && value.length > 0
				)
			: undefined;
		const sectionTitle =
			typeof entry.sectionTitle === 'string' &&
			entry.sectionTitle.length > 0
				? entry.sectionTitle
				: sectionPath?.at(-1);
		const chunkTitle =
			sectionTitle && sectionTitle !== title
				? `${title} · ${sectionTitle}`
				: title;
		const sectionChunkId =
			sectionPath && sectionPath.length > 0
				? `${documentId}:section:${slugify(sectionPath.join(' '))}`
				: undefined;
		const sectionSiblingIndexes =
			sectionChunkId === undefined
				? [index]
				: chunkEntries.reduce<number[]>(
						(indexes, candidate, candidateIndex) => {
							const candidatePath = Array.isArray(
								candidate.sectionPath
							)
								? candidate.sectionPath.filter(
										(value) =>
											typeof value === 'string' &&
											value.length > 0
									)
								: undefined;
							const candidateSectionId =
								candidatePath && candidatePath.length > 0
									? `${documentId}:section:${slugify(candidatePath.join(' '))}`
									: undefined;
							if (candidateSectionId === sectionChunkId) {
								indexes.push(candidateIndex);
							}
							return indexes;
						},
						[]
					);
		const sectionChunkIndex = sectionSiblingIndexes.indexOf(index);
		const previousChunkId =
			index > 0
				? `${documentId}:${String(index).padStart(RAG_CHUNK_ID_PAD_LENGTH, '0')}`
				: undefined;
		const nextChunkId =
			index + 1 < chunkEntries.length
				? `${documentId}:${String(index + 2).padStart(RAG_CHUNK_ID_PAD_LENGTH, '0')}`
				: undefined;

		return {
			chunkId: `${documentId}:${String(index + 1).padStart(RAG_CHUNK_ID_PAD_LENGTH, '0')}`,
			...(corpusKey ? { corpusKey } : {}),
			metadata: {
				...metadata,
				chunkCount: chunkEntries.length,
				chunkIndex: index,
				...(sectionTitle ? { sectionTitle } : {}),
				...(sectionPath && sectionPath.length > 0
					? { sectionPath }
					: {}),
				...(typeof entry.sectionDepth === 'number'
					? { sectionDepth: entry.sectionDepth }
					: {}),
				...(Array.isArray(entry.sectionFamilyPath) &&
				entry.sectionFamilyPath.length > 0
					? { sectionFamilyPath: entry.sectionFamilyPath }
					: {}),
				...(Array.isArray(entry.sectionOrdinalPath) &&
				entry.sectionOrdinalPath.length > 0
					? { sectionOrdinalPath: entry.sectionOrdinalPath }
					: {}),
				...(typeof entry.sectionSiblingFamilyKey === 'string'
					? { sectionSiblingFamilyKey: entry.sectionSiblingFamilyKey }
					: {}),
				...(typeof entry.sectionSiblingOrdinal === 'number'
					? { sectionSiblingOrdinal: entry.sectionSiblingOrdinal }
					: {}),
				...(Array.isArray(entry.spreadsheetHeaders) &&
				entry.spreadsheetHeaders.length > 0
					? { spreadsheetHeaders: entry.spreadsheetHeaders }
					: {}),
				...(typeof entry.spreadsheetColumnStart === 'string'
					? { spreadsheetColumnStart: entry.spreadsheetColumnStart }
					: {}),
				...(typeof entry.spreadsheetColumnEnd === 'string'
					? { spreadsheetColumnEnd: entry.spreadsheetColumnEnd }
					: {}),
				...(typeof entry.spreadsheetTableIndex === 'number'
					? { spreadsheetTableIndex: entry.spreadsheetTableIndex }
					: {}),
				...(typeof entry.spreadsheetTableCount === 'number'
					? { spreadsheetTableCount: entry.spreadsheetTableCount }
					: {}),
				...(typeof entry.spreadsheetRowStart === 'number'
					? { spreadsheetRowStart: entry.spreadsheetRowStart }
					: {}),
				...(typeof entry.spreadsheetRowEnd === 'number'
					? { spreadsheetRowEnd: entry.spreadsheetRowEnd }
					: {}),
				...(typeof entry.pageNumber === 'number'
					? { pageNumber: entry.pageNumber }
					: {}),
				...(typeof entry.officeBlockNumber === 'number'
					? { officeBlockNumber: entry.officeBlockNumber }
					: {}),
				...(entry.officeBlockKind
					? { officeBlockKind: entry.officeBlockKind }
					: {}),
				...(Array.isArray(entry.officeFamilyPath) &&
				entry.officeFamilyPath.length > 0
					? { officeFamilyPath: entry.officeFamilyPath }
					: {}),
				...(Array.isArray(entry.officeOrdinalPath) &&
				entry.officeOrdinalPath.length > 0
					? { officeOrdinalPath: entry.officeOrdinalPath }
					: {}),
				...(typeof entry.officeSiblingFamilyKey === 'string'
					? { officeSiblingFamilyKey: entry.officeSiblingFamilyKey }
					: {}),
				...(typeof entry.officeSiblingOrdinal === 'number'
					? { officeSiblingOrdinal: entry.officeSiblingOrdinal }
					: {}),
				...(typeof entry.officeListContextText === 'string'
					? { officeListContextText: entry.officeListContextText }
					: {}),
				...(typeof entry.officeListGroupItemCount === 'number'
					? {
							officeListGroupItemCount:
								entry.officeListGroupItemCount
						}
					: {}),
				...(typeof entry.officeListLevel === 'number'
					? { officeListLevel: entry.officeListLevel }
					: {}),
				...(Array.isArray(entry.officeListLevels) &&
				entry.officeListLevels.length > 0
					? { officeListLevels: entry.officeListLevels }
					: {}),
				...(typeof entry.officeTableBodyRowCount === 'number'
					? { officeTableBodyRowCount: entry.officeTableBodyRowCount }
					: {}),
				...(typeof entry.officeTableBodyRowEnd === 'number'
					? { officeTableBodyRowEnd: entry.officeTableBodyRowEnd }
					: {}),
				...(typeof entry.officeTableBodyRowStart === 'number'
					? { officeTableBodyRowStart: entry.officeTableBodyRowStart }
					: {}),
				...(entry.officeTableChunkKind
					? { officeTableChunkKind: entry.officeTableChunkKind }
					: {}),
				...(typeof entry.officeTableColumnCount === 'number'
					? { officeTableColumnCount: entry.officeTableColumnCount }
					: {}),
				...(typeof entry.officeTableContextText === 'string'
					? { officeTableContextText: entry.officeTableContextText }
					: {}),
				...(typeof entry.officeTableFollowUpText === 'string'
					? { officeTableFollowUpText: entry.officeTableFollowUpText }
					: {}),
				...(typeof entry.officeTableHeaderText === 'string'
					? { officeTableHeaderText: entry.officeTableHeaderText }
					: {}),
				...(Array.isArray(entry.officeTableHeaders) &&
				entry.officeTableHeaders.length > 0
					? { officeTableHeaders: entry.officeTableHeaders }
					: {}),
				...(typeof entry.officeTableRowCount === 'number'
					? { officeTableRowCount: entry.officeTableRowCount }
					: {}),
				...(typeof entry.officeTableSignature === 'string'
					? { officeTableSignature: entry.officeTableSignature }
					: {}),
				...(typeof entry.pdfBlockNumber === 'number'
					? { pdfBlockNumber: entry.pdfBlockNumber }
					: {}),
				...(typeof entry.pdfFigureCaptionBlockNumber === 'number'
					? {
							pdfFigureCaptionBlockNumber:
								entry.pdfFigureCaptionBlockNumber
						}
					: {}),
				...(typeof entry.pdfFigureLabel === 'string'
					? { pdfFigureLabel: entry.pdfFigureLabel }
					: {}),
				...(entry.pdfSemanticRole
					? { pdfSemanticRole: entry.pdfSemanticRole }
					: {}),
				...(typeof entry.pdfTableBodyRowEnd === 'number'
					? { pdfTableBodyRowEnd: entry.pdfTableBodyRowEnd }
					: {}),
				...(typeof entry.pdfTableBodyRowCount === 'number'
					? { pdfTableBodyRowCount: entry.pdfTableBodyRowCount }
					: {}),
				...(typeof entry.pdfTableBodyRowStart === 'number'
					? { pdfTableBodyRowStart: entry.pdfTableBodyRowStart }
					: {}),
				...(entry.pdfTableChunkKind
					? { pdfTableChunkKind: entry.pdfTableChunkKind }
					: {}),
				...(typeof entry.pdfTableColumnCount === 'number'
					? { pdfTableColumnCount: entry.pdfTableColumnCount }
					: {}),
				...(typeof entry.pdfTableHeaderText === 'string'
					? { pdfTableHeaderText: entry.pdfTableHeaderText }
					: {}),
				...(Array.isArray(entry.pdfTableHeaders) &&
				entry.pdfTableHeaders.length > 0
					? { pdfTableHeaders: entry.pdfTableHeaders }
					: {}),
				...(typeof entry.pdfTableRowCount === 'number'
					? { pdfTableRowCount: entry.pdfTableRowCount }
					: {}),
				...(typeof entry.pdfTableSignature === 'string'
					? { pdfTableSignature: entry.pdfTableSignature }
					: {}),
				...(entry.pdfTextKind
					? { pdfTextKind: entry.pdfTextKind }
					: {}),
				...(entry.emailSectionKind
					? { emailSectionKind: entry.emailSectionKind }
					: {}),
				...(Array.isArray(entry.emailForwardedBccAddresses) &&
				entry.emailForwardedBccAddresses.length > 0
					? {
							emailForwardedBccAddresses:
								entry.emailForwardedBccAddresses
						}
					: {}),
				...(Array.isArray(entry.emailForwardedCcAddresses) &&
				entry.emailForwardedCcAddresses.length > 0
					? {
							emailForwardedCcAddresses:
								entry.emailForwardedCcAddresses
						}
					: {}),
				...(typeof entry.emailForwardedDate === 'string'
					? { emailForwardedDate: entry.emailForwardedDate }
					: {}),
				...(typeof entry.emailForwardedFromAddress === 'string'
					? {
							emailForwardedFromAddress:
								entry.emailForwardedFromAddress
						}
					: {}),
				...(typeof entry.emailForwardedFromDisplayName === 'string'
					? {
							emailForwardedFromDisplayName:
								entry.emailForwardedFromDisplayName
						}
					: {}),
				...(typeof entry.emailForwardedChainCount === 'number'
					? {
							emailForwardedChainCount:
								entry.emailForwardedChainCount
						}
					: {}),
				...(typeof entry.emailForwardedOrdinal === 'number'
					? { emailForwardedOrdinal: entry.emailForwardedOrdinal }
					: {}),
				...(typeof entry.emailQuotedDepth === 'number'
					? { emailQuotedDepth: entry.emailQuotedDepth }
					: {}),
				...(entry.emailForwardedHeaderFields
					? {
							emailForwardedHeaderFields:
								entry.emailForwardedHeaderFields
						}
					: {}),
				...(Array.isArray(entry.emailForwardedParticipantAddresses) &&
				entry.emailForwardedParticipantAddresses.length > 0
					? {
							emailForwardedParticipantAddresses:
								entry.emailForwardedParticipantAddresses
						}
					: {}),
				...(Array.isArray(entry.emailForwardedReplyToAddresses) &&
				entry.emailForwardedReplyToAddresses.length > 0
					? {
							emailForwardedReplyToAddresses:
								entry.emailForwardedReplyToAddresses
						}
					: {}),
				...(typeof entry.emailForwardedSubject === 'string'
					? { emailForwardedSubject: entry.emailForwardedSubject }
					: {}),
				...(typeof entry.emailForwardedTimestamp === 'string'
					? { emailForwardedTimestamp: entry.emailForwardedTimestamp }
					: {}),
				...(Array.isArray(entry.emailForwardedToAddresses) &&
				entry.emailForwardedToAddresses.length > 0
					? {
							emailForwardedToAddresses:
								entry.emailForwardedToAddresses
						}
					: {}),
				...(entry.sectionKind
					? { sectionKind: entry.sectionKind }
					: {}),
				...(entry.sourceAwareChunkReason
					? { sourceAwareChunkReason: entry.sourceAwareChunkReason }
					: {}),
				...(sectionChunkId ? { sectionChunkId } : {}),
				...(sectionChunkId && sectionChunkIndex >= 0
					? {
							sectionChunkCount: sectionSiblingIndexes.length,
							sectionChunkIndex
						}
					: {}),
				...(previousChunkId ? { previousChunkId } : {}),
				...(nextChunkId ? { nextChunkId } : {})
			},
			source,
			text: entry.text,
			title: chunkTitle
		};
	});

	return {
		...(corpusKey ? { corpusKey } : {}),
		chunks,
		documentId,
		format,
		metadata,
		normalizedText,
		source,
		title
	};
};

export const prepareRAGDocuments = (input: RAGDocumentIngestInput) =>
	input.documents.map((document) =>
		prepareRAGDocument(
			document,
			input.defaultChunking,
			input.chunkingRegistry
		)
	);

export const mergeMetadata = (
	inputMetadata: Record<string, unknown> | undefined,
	extraMetadata: Record<string, unknown> | undefined,
	baseMetadata: Record<string, unknown> | undefined
) => ({
	...(baseMetadata ?? {}),
	...(inputMetadata ?? {}),
	...(extraMetadata ?? {})
});

export const buildRAGUpsertInputFromURLs = async (
	input: RAGDocumentUrlIngestInput
) => ({
	chunks: prepareRAGDocuments(await loadRAGDocumentsFromURLs(input)).flatMap(
		(document) => document.chunks
	)
});
export const loadRAGDocumentFile = async (input: RAGDocumentFileInput) => {
	const data = await readFile(input.path);
	const documents = await extractRAGFileDocuments(
		{
			chunking: input.chunking,
			contentType: input.contentType,
			data,
			extractorRegistry: input.extractorRegistry,
			format: input.format,
			metadata: input.metadata,
			path: input.path,
			source: input.source,
			title: input.title
		},
		input.extractors,
		input.extractorRegistry
	);

	return getFirstExtractedDocument(documents, 'for file input');
};
export const loadRAGDocumentFromURL = async (input: RAGDocumentUrlInput) => {
	const url = input.url.trim();
	if (!url) {
		throw new Error('RAG URL is required');
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch RAG URL ${url}: ${response.status} ${response.statusText}`
		);
	}

	const data = new Uint8Array(await response.arrayBuffer());
	const documents = await extractRAGFileDocuments(
		{
			chunking: input.chunking,
			contentType:
				input.contentType ??
				response.headers.get('content-type') ??
				undefined,
			data,
			extractorRegistry: input.extractorRegistry,
			format: input.format ?? inferFormatFromUrl(url),
			metadata: input.metadata,
			name: basename(new URL(url).pathname),
			source: input.source ?? url,
			title: input.title
		},
		input.extractors,
		input.extractorRegistry
	);

	return getFirstExtractedDocument(documents, 'for URL input');
};
export const loadRAGDocumentsFromUploads = async (
	input: RAGDocumentUploadIngestInput
) => {
	const documents = await Promise.all(
		input.uploads.map(async (upload) => {
			const loaded = await loadExtractedDocuments(
				{
					chunking: upload.chunking,
					contentType: upload.contentType,
					data: decodeUploadContent(upload),
					extractorRegistry: input.extractorRegistry,
					format: upload.format,
					metadata: upload.metadata,
					name: upload.name,
					source: upload.source ?? upload.name,
					title: upload.title
				},
				input.extractors,
				input.extractorRegistry
			);

			return loaded.map((document) => ({
				...document,
				metadata: mergeMetadata(
					document.metadata,
					{ uploadFile: upload.name },
					input.baseMetadata
				)
			}));
		})
	);

	return {
		defaultChunking: input.defaultChunking,
		chunkingRegistry: input.chunkingRegistry,
		documents: reconcileLoadedEmailThreads(documents.flat())
	};
};
export const loadRAGDocumentsFromURLs = async (
	input: RAGDocumentUrlIngestInput
) => {
	const documents = await Promise.all(
		input.urls.map(async (urlInput) => {
			const url = urlInput.url.trim();
			if (!url) {
				throw new Error('RAG URL is required');
			}

			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch RAG URL ${url}: ${response.status} ${response.statusText}`
				);
			}

			const data = new Uint8Array(await response.arrayBuffer());
			const loaded = await loadExtractedDocuments(
				{
					chunking: urlInput.chunking,
					contentType:
						urlInput.contentType ??
						response.headers.get('content-type') ??
						undefined,
					data,
					extractorRegistry:
						urlInput.extractorRegistry ?? input.extractorRegistry,
					format: urlInput.format ?? inferFormatFromUrl(url),
					metadata: urlInput.metadata,
					name: basename(new URL(url).pathname),
					source: urlInput.source ?? url,
					title: urlInput.title
				},
				urlInput.extractors ?? input.extractors,
				urlInput.extractorRegistry ?? input.extractorRegistry
			);

			return loaded.map((document) => ({
				...document,
				metadata: mergeMetadata(
					document.metadata,
					{ sourceUrl: urlInput.url },
					input.baseMetadata
				)
			}));
		})
	);

	return {
		defaultChunking: input.defaultChunking,
		chunkingRegistry: input.chunkingRegistry,
		documents: reconcileLoadedEmailThreads(documents.flat())
	};
};
export const loadRAGDocumentUpload = async (
	input: RAGDocumentUploadInput & {
		extractors?: RAGFileExtractor[];
		extractorRegistry?: RAGFileExtractorRegistryLike;
	}
) => {
	const documents = await extractRAGFileDocuments(
		{
			chunking: input.chunking,
			contentType: input.contentType,
			data: decodeUploadContent(input),
			extractorRegistry: input.extractorRegistry,
			format: input.format,
			metadata: input.metadata,
			name: input.name,
			source: input.source ?? input.name,
			title: input.title
		},
		input.extractors,
		input.extractorRegistry
	);

	return getFirstExtractedDocument(documents, 'for upload input');
};
export const prepareRAGDocumentFile = async (
	input: RAGDocumentFileInput,
	defaultChunking?: RAGChunkingOptions,
	chunkingRegistry?: RAGChunkingRegistryLike
) =>
	prepareRAGDocument(
		await loadRAGDocumentFile(input),
		defaultChunking,
		chunkingRegistry
	);

const DEFAULT_DIRECTORY_EXTENSIONS = [
	'.txt',
	'.md',
	'.mdx',
	'.html',
	'.htm',
	'.json',
	'.csv',
	'.xml',
	'.yaml',
	'.yml',
	'.pdf',
	'.eml',
	'.emlx',
	'.mbox',
	'.mbx'
];

const collectDirectoryFiles = async (
	directory: string,
	recursive: boolean,
	includeExtensions: Set<string> | null
) => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	const collectNestedDirectoryFiles = (fullPath: string) =>
		collectDirectoryFiles(fullPath, recursive, includeExtensions);
	const shouldIncludeDirectoryFile = (
		entryName: string,
		sourcePath?: string
	) => {
		if (includeExtensions === null) {
			return true;
		}

		const extension = extname(entryName).toLowerCase();
		if (parseMaildirMetadata(sourcePath ?? entryName)) {
			return true;
		}

		return includeExtensions.has(extension);
	};
	const appendNestedDirectoryFiles = async (fullPath: string) => {
		if (!recursive) {
			return;
		}

		files.push(...(await collectNestedDirectoryFiles(fullPath)));
	};
	const processDirectoryEntry = async (
		entry: (typeof entries)[number],
		fullPath: string
	) => {
		if (entry.isDirectory()) {
			await appendNestedDirectoryFiles(fullPath);

			return true;
		}

		if (!entry.isFile()) {
			return true;
		}

		if (!shouldIncludeDirectoryFile(entry.name, fullPath)) {
			return true;
		}

		files.push(fullPath);

		return true;
	};

	await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name);
			await processDirectoryEntry(entry, fullPath);
		})
	);

	return files.sort();
};

export const buildRAGUpsertInputFromDirectory = async (
	input: RAGDirectoryIngestInput
) =>
	buildRAGUpsertInputFromDocuments(
		await loadRAGDocumentsFromDirectory(input)
	);
export const buildRAGUpsertInputFromDocuments = (
	input: RAGDocumentIngestInput
) => ({
	chunks: prepareRAGDocuments(input).flatMap((document) => document.chunks)
});

export const buildRAGUpsertInputFromUploads = async (
	input: RAGDocumentUploadIngestInput
) => ({
	chunks: prepareRAGDocuments(
		await loadRAGDocumentsFromUploads(input)
	).flatMap((document) => document.chunks)
});

export const loadRAGDocumentsFromDirectory = async (
	input: RAGDirectoryIngestInput
) => {
	const root = resolve(input.directory);
	const includeExtensions =
		input.includeExtensions === undefined &&
		(input.extractors?.length || input.extractorRegistry)
			? null
			: new Set(
					(
						input.includeExtensions ?? DEFAULT_DIRECTORY_EXTENSIONS
					).map((entry) =>
						entry.startsWith('.')
							? entry.toLowerCase()
							: `.${entry.toLowerCase()}`
					)
				);
	const files = await collectDirectoryFiles(
		root,
		input.recursive !== false,
		includeExtensions
	);

	const documents = await Promise.all(
		files.map(async (path) => {
			const source = relative(root, path).replace(/\\/g, '/');
			const data = await readFile(path);
			const loaded = await loadExtractedDocuments(
				{
					chunking: input.defaultChunking,
					data,
					extractorRegistry: input.extractorRegistry,
					metadata: {
						fileName: basename(path),
						relativePath: source
					},
					path,
					source
				},
				input.extractors,
				input.extractorRegistry
			);

			return loaded.map((document) => ({
				...document,
				metadata: mergeMetadata(
					document.metadata,
					undefined,
					input.baseMetadata
				)
			}));
		})
	);

	return {
		defaultChunking: input.defaultChunking,
		chunkingRegistry: input.chunkingRegistry,
		documents: reconcileLoadedEmailThreads(documents.flat())
	};
};
export const prepareRAGDirectoryDocuments = async (
	input: RAGDirectoryIngestInput
) => prepareRAGDocuments(await loadRAGDocumentsFromDirectory(input));
