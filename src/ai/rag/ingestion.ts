import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import type {
	RAGChunkingOptions,
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
	RAGIngestDocument,
	RAGMediaTranscriber,
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
	'.csv',
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
const EMAIL_FILE_EXTENSIONS = new Set(['.eml']);
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

const stripHtml = (value: string) => {
	const withoutTags = value
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|table|tr)>/gi, '\n')
		.replace(/<li\b[^>]*>/gi, '- ')
		.replace(/<[^>]+>/g, ' ');

	return normalizeWhitespace(decodeHtmlEntities(withoutTags));
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

const markdownStructureUnits = (value: string) => {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	const sections: string[] = [];
	let current: string[] = [];
	const flushCurrentSection = () => {
		if (current.length === 0) {
			return;
		}

		sections.push(current.join('\n'));
		current = [];
	};

	for (const line of lines) {
		const startsNewSection =
			/^\s*#{1,6}\s+/.test(line) && current.length > 0;
		if (startsNewSection) flushCurrentSection();

		current.push(line);
	}

	flushCurrentSection();

	return sections
		.map((section) => stripMarkdown(section))
		.map((section) => normalizeWhitespace(section))
		.filter(Boolean);
};

const htmlStructureUnits = (value: string) => {
	const marked = value
		.replace(
			/<(section|article|main|aside|nav|h[1-6])\b[^>]*>/gi,
			'\n\n__ABS_SECTION_BREAK__ '
		)
		.replace(/<\/(section|article|main|aside|nav|h[1-6])>/gi, '\n\n');
	const normalized = stripHtml(marked);

	return normalized
		.split(/__ABS_SECTION_BREAK__/)
		.map((section) => normalizeWhitespace(section))
		.filter(Boolean);
};

const inferFormat = (document: RAGIngestDocument) => {
	if (document.format) {
		return document.format;
	}

	const source = document.source?.toLowerCase() ?? '';
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

const extractTextFromPDFBytes = (data: Uint8Array) => {
	const raw = Buffer.from(data).toString('latin1');
	const matches = [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)];
	const combined = matches
		.map((match) => decodePdfLiteral(match[1] ?? ''))
		.join('\n');

	return normalizeWhitespace(combined);
};

const estimatePDFPageCount = (data: Uint8Array) => {
	const raw = Buffer.from(data).toString('latin1');
	const count = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length;

	return count > 0 ? count : 1;
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

const officeDocumentText = (entries: RAGArchiveEntry[]) => {
	const documentEntry = entries.find(
		(entry) => entry.path === 'word/document.xml'
	);
	if (!documentEntry) {
		return '';
	}

	return extractXmlText(decodeUtf8(documentEntry.data));
};

const officeDocumentSectionCount = (entries: RAGArchiveEntry[]) => {
	const documentEntry = entries.find(
		(entry) => entry.path === 'word/document.xml'
	);
	if (!documentEntry) {
		return undefined;
	}

	const count = [...decodeUtf8(documentEntry.data).matchAll(/<w:p\b/g)]
		.length;

	return count > 0 ? count : undefined;
};

const spreadsheetText = (entries: RAGArchiveEntry[]) => {
	const sharedStrings = entries
		.filter((entry) => entry.path === 'xl/sharedStrings.xml')
		.flatMap((entry) =>
			[
				...decodeUtf8(entry.data).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)
			].map((match) => decodeHtmlEntities(match[1] ?? ''))
		);
	const sheetValues = entries
		.filter(
			(entry) =>
				entry.path.startsWith('xl/worksheets/') &&
				entry.path.endsWith('.xml')
		)
		.flatMap((entry) =>
			[...decodeUtf8(entry.data).matchAll(/<v>([\s\S]*?)<\/v>/g)].map(
				(match) => match[1] ?? ''
			)
		)
		.map((value) => {
			const index = Number(value);

			return Number.isInteger(index) && sharedStrings[index]
				? sharedStrings[index]
				: value;
		});

	return normalizeWhitespace(sheetValues.join('\n'));
};

const spreadsheetSheetTexts = (entries: RAGArchiveEntry[]) => {
	const sharedStrings = entries
		.filter((entry) => entry.path === 'xl/sharedStrings.xml')
		.flatMap((entry) =>
			[
				...decodeUtf8(entry.data).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)
			].map((match) => decodeHtmlEntities(match[1] ?? ''))
		);
	const sheetNames = spreadsheetSheetNames(entries);
	const sheetEntries = entries
		.filter(
			(entry) =>
				entry.path.startsWith('xl/worksheets/') &&
				entry.path.endsWith('.xml')
		)
		.sort((left, right) => left.path.localeCompare(right.path));

	return sheetEntries
		.map((entry, index) => {
			const values = [
				...decodeUtf8(entry.data).matchAll(/<v>([\s\S]*?)<\/v>/g)
			]
				.map((match) => match[1] ?? '')
				.map((value) => {
					const sharedStringIndex = Number(value);

					return Number.isInteger(sharedStringIndex) &&
						sharedStrings[sharedStringIndex]
						? sharedStrings[sharedStringIndex]
						: value;
				});
			const text = normalizeWhitespace(values.join('\n'));
			if (!text) {
				return null;
			}

			return {
				name: sheetNames[index] ?? `Sheet ${index + 1}`,
				text
			};
		})
		.filter((entry): entry is { name: string; text: string } =>
			Boolean(entry)
		);
};

const spreadsheetSheetNames = (entries: RAGArchiveEntry[]) =>
	entries
		.filter((entry) => entry.path === 'xl/workbook.xml')
		.flatMap((entry) =>
			[
				...decodeUtf8(entry.data).matchAll(/<sheet[^>]*name="([^"]+)"/g)
			].map((match) => match[1] ?? '')
		)
		.filter(Boolean);

const presentationText = (entries: RAGArchiveEntry[]) => {
	const slides = entries
		.filter(
			(entry) =>
				entry.path.startsWith('ppt/slides/') &&
				entry.path.endsWith('.xml')
		)
		.map((entry) => extractXmlText(decodeUtf8(entry.data)));

	return normalizeWhitespace(slides.join('\n\n'));
};

const presentationSlides = (entries: RAGArchiveEntry[]) =>
	entries
		.filter(
			(entry) =>
				entry.path.startsWith('ppt/slides/') &&
				entry.path.endsWith('.xml')
		)
		.sort((left, right) => left.path.localeCompare(right.path))
		.map((entry, index) => ({
			index,
			text: normalizeWhitespace(extractXmlText(decodeUtf8(entry.data)))
		}))
		.filter((slide) => Boolean(slide.text));

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

const extractEmailText = (raw: string) => {
	const normalized = raw.replace(/\r\n?/g, '\n');
	const [, ...bodyParts] = normalized.split('\n\n');
	const body = bodyParts.join('\n\n');
	if (!body) {
		return normalizeWhitespace(normalized);
	}

	const htmlMatch = body.match(/<html[\s\S]*<\/html>/i);
	if (htmlMatch) {
		return stripHtml(htmlMatch[0]);
	}

	return normalizeWhitespace(body);
};

const parseEmailHeaders = (raw: string) => {
	const normalized = raw.replace(/\r\n?/g, '\n');
	const [headerBlock = ''] = normalized.split('\n\n');
	const getHeader = (name: string) => {
		const match = headerBlock.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));

		return match?.[1]?.trim();
	};

	return {
		from: getHeader('From'),
		subject: getHeader('Subject'),
		threadTopic: getHeader('Thread-Topic') ?? getHeader('Subject'),
		to: getHeader('To')
	};
};

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

const extractPrintableStrings = (data: Uint8Array) => {
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
	const unique = [...new Set(values)].filter((entry) => entry.length >= 4);

	return unique.join('\n');
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
		contentType.includes('application/eml')
	) {
		return true;
	}

	return EMAIL_FILE_EXTENSIONS.has(inferExtensionFromInput(input));
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
	extract: (input) => {
		const raw = decodeUtf8(input.data);
		const headers = parseEmailHeaders(raw);

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				fileKind: 'email',
				from: headers.from,
				threadTopic: headers.subject,
				to: headers.to
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.eml`,
			text: extractEmailText(raw),
			title: input.title ?? headers.subject
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
			text = officeDocumentText(entries);
			officeMetadata = {
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
					sourceNativeKind: 'spreadsheet_sheet',
					sheetIndex: index,
					sheetName: sheet.name
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
export const createRAGImageOCRExtractor = (
	provider: RAGOCRProvider
): RAGFileExtractor => ({
	name: `absolute_image_ocr:${provider.name}`,
	supports: imageExtractorSupports,
	extract: async (input) => {
		const result = await provider.extractText(input);

		return {
			chunking: input.chunking,
			contentType: input.contentType,
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				...(result.metadata ?? {}),
				fileKind: 'image'
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.image.txt`,
			text: result.text,
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
		const source =
			input.source ??
			input.path ??
			input.name ??
			`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.media.txt`;
		const segmentDocuments: RAGExtractedFileDocument[] = [];
		for (const [index, segment] of (result.segments ?? []).entries()) {
			const text = normalizeWhitespace(segment.text ?? '');
			if (!text) {
				continue;
			}

			const startMs =
				typeof segment.startMs === 'number'
					? segment.startMs
					: undefined;
			const endMs =
				typeof segment.endMs === 'number' ? segment.endMs : undefined;
			const startLabel = formatMediaTimestampForIngest(startMs);
			const endLabel = formatMediaTimestampForIngest(endMs);
			const mediaKind =
				typeof result.metadata?.mediaKind === 'string'
					? result.metadata.mediaKind
					: 'media';

			segmentDocuments.push({
				chunking: input.chunking,
				contentType: input.contentType,
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					...(result.metadata ?? {}),
					fileKind: 'media',
					sourceNativeKind: 'media_segment',
					mediaSegmentIndex: index,
					mediaSegmentStartMs: startMs,
					mediaSegmentEndMs: endMs,
					mediaSegments: [segment],
					speaker:
						typeof segment.speaker === 'string'
							? segment.speaker
							: undefined
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
						`\n${text}`
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
			metadata: {
				...(input.metadata ?? {}),
				...(result.metadata ?? {}),
				fileKind: 'media',
				mediaSegments: result.segments
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
	extract: (input) => ({
		chunking: input.chunking,
		contentType: input.contentType,
		format:
			input.format ??
			inferFormatFromContentType(input.contentType ?? null) ??
			inferFormatFromName(
				input.path ?? input.source ?? input.name ?? input.title
			),
		metadata: input.metadata,
		source: input.source ?? input.path ?? input.name,
		text: Buffer.from(input.data).toString('utf8'),
		title: input.title
	})
});

const expandArchiveEntry = async (
	entry: RAGArchiveEntry,
	archiveInput: RAGFileExtractionInput,
	extractors?: RAGFileExtractor[]
) => {
	const documents = await extractRAGFileDocuments(
		{
			chunking: archiveInput.chunking,
			contentType: entry.contentType,
			data: entry.data,
			format: entry.format,
			metadata: {
				...(archiveInput.metadata ?? {}),
				...(entry.metadata ?? {}),
				archivePath: entry.path,
				fileKind: 'archive_entry'
			},
			name: basename(entry.path),
			source:
				archiveInput.source && !archiveInput.source.startsWith('http')
					? `${archiveInput.source}#${entry.path}`
					: entry.path,
			title: basename(entry.path)
		},
		extractors
	);

	return documents;
};

export const createPDFFileExtractor = (): RAGFileExtractor => ({
	name: 'absolute_pdf',
	supports: pdfExtractorSupports,
	extract: (input) => {
		const text = extractTextFromPDFBytes(input.data);
		if (!text) {
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
				pageCount: estimatePDFPageCount(input.data)
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
			text,
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
		const nativeText = extractTextFromPDFBytes(input.data);
		const minLength = options.minExtractedTextLength ?? 80;
		const shouldUseNativeText =
			!options.alwaysOCR && nativeText.length >= minLength;

		if (shouldUseNativeText) {
			return {
				chunking: input.chunking,
				contentType: input.contentType ?? 'application/pdf',
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					fileKind: 'pdf',
					pageCount: estimatePDFPageCount(input.data),
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

		return {
			chunking: input.chunking,
			contentType: input.contentType ?? 'application/pdf',
			format: 'text',
			metadata: {
				...(input.metadata ?? {}),
				...(ocr.metadata ?? {}),
				fileKind: 'pdf',
				pageCount: estimatePDFPageCount(input.data),
				pdfTextMode: 'ocr'
			},
			source:
				input.source ??
				input.path ??
				input.name ??
				`${slugify(input.title ?? DEFAULT_BINARY_NAME)}.pdf`,
			text: ocr.text,
			title: ocr.title ?? input.title
		};
	}
});

const DEFAULT_FILE_EXTRACTORS = [
	createOfficeDocumentExtractor(),
	createLegacyDocumentExtractor(),
	createEPUBExtractor(),
	createEmailExtractor(),
	createRAGArchiveFileExtractor(createBuiltinArchiveExpander()),
	createPDFFileExtractor(),
	createTextFileExtractor()
] satisfies RAGFileExtractor[];

const resolveFileExtractors = (extractors?: RAGFileExtractor[]) =>
	extractors && extractors.length > 0
		? [...extractors, ...DEFAULT_FILE_EXTRACTORS]
		: DEFAULT_FILE_EXTRACTORS;

const applyExtractorDefaults = (
	document: RAGExtractedFileDocument,
	input: RAGFileExtractionInput,
	extractorName: string
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
		extractor: document.extractor ?? extractorName
	},
	source: document.source ?? input.source ?? input.path ?? input.name,
	text: document.text,
	title: document.title ?? input.title
});

const extractRAGFileDocuments = async (
	input: RAGFileExtractionInput,
	extractors?: RAGFileExtractor[]
) => {
	for (const extractor of resolveFileExtractors(extractors)) {
		if (!(await extractor.supports(input))) {
			continue;
		}

		const extracted = await extractor.extract(input);
		const documents = Array.isArray(extracted) ? extracted : [extracted];

		return documents.map((document) =>
			applyExtractorDefaults(document, input, extractor.name)
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
	extractors?: RAGFileExtractor[]
) => extractRAGFileDocuments(input, extractors);

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
) => {
	const resolveStructuredUnits = (sections: string[]) =>
		sections.length > 0 ? sections : paragraphUnits(normalizedText);

	switch (format) {
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
			return paragraphUnits(normalizedText);
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
	unit: string,
	options: Required<
		Pick<
			RAGChunkingOptions,
			'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
		>
	>
) => {
	if (unit.length <= options.maxChunkLength) {
		return [unit];
	}

	return chunkFromUnits(
		paragraphUnits(unit),
		options.maxChunkLength,
		options.chunkOverlap,
		options.minChunkLength
	);
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

const resolveChunkingOptions = (
	document: RAGIngestDocument,
	defaults?: RAGChunkingOptions
): Required<
	Pick<
		RAGChunkingOptions,
		'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
	>
> => {
	const maxChunkLength =
		document.chunking?.maxChunkLength ??
		defaults?.maxChunkLength ??
		DEFAULT_MAX_CHUNK_LENGTH;
	const chunkOverlap =
		document.chunking?.chunkOverlap ??
		defaults?.chunkOverlap ??
		DEFAULT_CHUNK_OVERLAP;
	const minChunkLength =
		document.chunking?.minChunkLength ??
		defaults?.minChunkLength ??
		DEFAULT_MIN_CHUNK_LENGTH;
	const strategy =
		document.chunking?.strategy ?? defaults?.strategy ?? DEFAULT_STRATEGY;

	return {
		chunkOverlap: Math.max(0, Math.min(chunkOverlap, maxChunkLength - 1)),
		maxChunkLength: Math.max(RAG_MIN_CHUNK_LENGTH_FLOOR, maxChunkLength),
		minChunkLength: Math.max(1, minChunkLength),
		strategy
	};
};

const createChunkTexts = (
	document: RAGIngestDocument,
	format: RAGContentFormat,
	text: string,
	options: Required<
		Pick<
			RAGChunkingOptions,
			'chunkOverlap' | 'maxChunkLength' | 'minChunkLength' | 'strategy'
		>
	>
) => {
	if (
		text.length <= options.maxChunkLength &&
		options.strategy !== 'source_aware'
	) {
		return [text];
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
	);
};

export const prepareRAGDocument = (
	document: RAGIngestDocument,
	defaultChunking?: RAGChunkingOptions
): RAGPreparedDocument => {
	const format = inferFormat(document);
	const normalizedText = normalizeDocumentText(document.text, format);
	const chunking = resolveChunkingOptions(document, defaultChunking);
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
	const metadata: RAGPreparedDocument['metadata'] = {
		...(document.metadata ?? {}),
		documentId,
		format,
		source,
		title
	};
	const chunkTexts = createChunkTexts(
		document,
		format,
		normalizedText,
		chunking
	);
	const chunks: RAGDocumentChunk[] = chunkTexts.map((text, index) => ({
		chunkId: `${documentId}:${String(index + 1).padStart(RAG_CHUNK_ID_PAD_LENGTH, '0')}`,
		metadata: {
			...metadata,
			chunkCount: chunkTexts.length,
			chunkIndex: index
		},
		source,
		text,
		title
	}));

	return {
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
		prepareRAGDocument(document, input.defaultChunking)
	);

const mergeMetadata = (
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
			format: input.format,
			metadata: input.metadata,
			path: input.path,
			source: input.source,
			title: input.title
		},
		input.extractors
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
			format: input.format ?? inferFormatFromUrl(url),
			metadata: input.metadata,
			name: basename(new URL(url).pathname),
			source: input.source ?? url,
			title: input.title
		},
		input.extractors
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
					format: upload.format,
					metadata: upload.metadata,
					name: upload.name,
					source: upload.source ?? upload.name,
					title: upload.title
				},
				input.extractors
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
		documents: documents.flat()
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
					format: urlInput.format ?? inferFormatFromUrl(url),
					metadata: urlInput.metadata,
					name: basename(new URL(url).pathname),
					source: urlInput.source ?? url,
					title: urlInput.title
				},
				urlInput.extractors ?? input.extractors
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
		documents: documents.flat()
	};
};
export const loadRAGDocumentUpload = async (
	input: RAGDocumentUploadInput & { extractors?: RAGFileExtractor[] }
) => {
	const documents = await extractRAGFileDocuments(
		{
			chunking: input.chunking,
			contentType: input.contentType,
			data: decodeUploadContent(input),
			format: input.format,
			metadata: input.metadata,
			name: input.name,
			source: input.source ?? input.name,
			title: input.title
		},
		input.extractors
	);

	return getFirstExtractedDocument(documents, 'for upload input');
};
export const prepareRAGDocumentFile = async (
	input: RAGDocumentFileInput,
	defaultChunking?: RAGChunkingOptions
) => prepareRAGDocument(await loadRAGDocumentFile(input), defaultChunking);

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
	'.pdf'
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
	const shouldIncludeDirectoryFile = (entryName: string) => {
		if (includeExtensions === null) {
			return true;
		}

		const extension = extname(entryName).toLowerCase();

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

		if (!shouldIncludeDirectoryFile(entry.name)) {
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
		input.includeExtensions === undefined && input.extractors?.length
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
					metadata: {
						fileName: basename(path),
						relativePath: source
					},
					path,
					source
				},
				input.extractors
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
		documents: documents.flat()
	};
};
export const prepareRAGDirectoryDocuments = async (
	input: RAGDirectoryIngestInput
) => prepareRAGDocuments(await loadRAGDocumentsFromDirectory(input));
