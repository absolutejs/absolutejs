import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
	buildRAGUpsertInputFromDirectory,
	buildRAGUpsertInputFromDocuments,
	buildRAGUpsertInputFromUploads,
	buildRAGUpsertInputFromURLs,
	createBuiltinArchiveExpander,
	createEmailExtractor,
	createEPUBExtractor,
	createLegacyDocumentExtractor,
	createRAGArchiveExpander,
	createRAGArchiveFileExtractor,
	createRAGFileExtractor,
	createRAGImageOCRExtractor,
	createRAGMediaFileExtractor,
	createRAGMediaTranscriber,
	createRAGPDFOCRExtractor,
	createRAGOCRProvider,
	createOfficeDocumentExtractor,
	loadRAGDocumentFromURL,
	loadRAGDocumentsFromDirectory,
	loadRAGDocumentUpload,
	loadRAGDocumentsFromUploads,
	loadRAGDocumentFile,
	prepareRAGDirectoryDocuments,
	prepareRAGDocument
} from '../../../../src/ai/rag/ingestion';

const createMockFetch = (response: Response): typeof fetch =>
	Object.assign(
		(..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
			Promise.resolve(response),
		{ preconnect: fetch.preconnect }
	) as typeof fetch;

const encodeUInt16LE = (value: number) =>
	Buffer.from([value & 0xff, (value >> 8) & 0xff]);
const encodeUInt32LE = (value: number) =>
	Buffer.from([
		value & 0xff,
		(value >> 8) & 0xff,
		(value >> 16) & 0xff,
		(value >> 24) & 0xff
	]);

const createStoredZip = (files: Record<string, string | Uint8Array>) => {
	const chunks: Buffer[] = [];

	for (const [name, content] of Object.entries(files)) {
		const nameBuffer = Buffer.from(name, 'utf8');
		const data =
			typeof content === 'string'
				? Buffer.from(content, 'utf8')
				: Buffer.from(content);
		chunks.push(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
		chunks.push(encodeUInt16LE(20));
		chunks.push(encodeUInt16LE(0));
		chunks.push(encodeUInt16LE(0));
		chunks.push(encodeUInt16LE(0));
		chunks.push(encodeUInt16LE(0));
		chunks.push(encodeUInt32LE(0));
		chunks.push(encodeUInt32LE(data.length));
		chunks.push(encodeUInt32LE(data.length));
		chunks.push(encodeUInt16LE(nameBuffer.length));
		chunks.push(encodeUInt16LE(0));
		chunks.push(nameBuffer);
		chunks.push(data);
	}

	return Buffer.concat(chunks);
};

describe('RAG ingestion helpers', () => {
	it('normalizes markdown and creates deterministic chunk ids', () => {
		const prepared = prepareRAGDocument({
			source: 'guides/retrieval.md',
			text: '# Retrieval\n\nUse **metadata** filters to narrow results.\n\n- Keep ids stable\n- Reuse source labels'
		});

		expect(prepared.documentId).toBe('guides-retrieval-md');
		expect(prepared.format).toBe('markdown');
		expect(prepared.normalizedText).toContain('Retrieval');
		expect(prepared.normalizedText).toContain('Use metadata filters');
		expect(prepared.chunks[0]?.chunkId).toBe('guides-retrieval-md:001');
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			documentId: 'guides-retrieval-md',
			format: 'markdown',
			source: 'guides/retrieval.md',
			title: 'guides-retrieval-md'
		});
	});

	it('strips html and chunks long content with overlap', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				chunkOverlap: 20,
				maxChunkLength: 80,
				strategy: 'sentences'
			},
			source: 'docs/demo.html',
			text: `
				<section>
					<h1>Demo</h1>
					<p>AbsoluteJS lets retrieval UI and backend logic stay aligned.</p>
					<p>Metadata filters, source labels, and deterministic ids make the demo easy to verify.</p>
				</section>
			`
		});

		expect(prepared.format).toBe('html');
		expect(prepared.normalizedText).toContain(
			'AbsoluteJS lets retrieval UI'
		);
		expect(prepared.chunks.length).toBeGreaterThan(1);
		expect(prepared.chunks[1]?.text).toContain('Metadata filters');
	});

	it('builds an upsert payload from document inputs', () => {
		const prepared = buildRAGUpsertInputFromDocuments({
			documents: [
				{
					chunking: {
						chunkOverlap: 0,
						maxChunkLength: 120,
						minChunkLength: 1,
						strategy: 'fixed'
					},
					id: 'faq',
					source: 'faq.txt',
					text: 'One. '.repeat(40)
				}
			]
		});

		expect(prepared.chunks.length).toBeGreaterThan(1);
		expect(prepared.chunks[0]?.chunkId).toBe('faq:001');
	});

	it('uses source-aware splitting for markdown headings', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 200,
				strategy: 'source_aware'
			},
			source: 'guides/structure.md',
			text: '# Intro\n\nalpha\n\n## Details\n\nbeta\n\n## Final\n\ngamma'
		});

		expect(prepared.chunks.length).toBe(3);
		expect(prepared.chunks[0]?.text).toContain('Intro');
		expect(prepared.chunks[1]?.text).toContain('Details');
		expect(prepared.chunks[2]?.text).toContain('Final');
	});

	it('loads and prepares documents from a directory', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-ingest-'));

		try {
			writeFileSync(
				join(tempDir, 'guide.md'),
				'# Guide\n\nAbsoluteJS keeps ingestion and retrieval aligned.'
			);
			mkdirSync(join(tempDir, 'nested'));
			writeFileSync(
				join(tempDir, 'nested', 'docs.html'),
				'<section><h1>Docs</h1><p>Filters stay readable.</p></section>'
			);

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { corpus: 'demo' },
				directory: tempDir
			});
			const prepared = await prepareRAGDirectoryDocuments({
				baseMetadata: { corpus: 'demo' },
				directory: tempDir
			});
			const upsert = await buildRAGUpsertInputFromDirectory({
				baseMetadata: { corpus: 'demo' },
				directory: tempDir
			});

			expect(loaded.documents).toHaveLength(2);
			expect(loaded.documents[0]?.source).toBe('guide.md');
			expect(loaded.documents[1]?.source).toBe('nested/docs.html');
			expect(prepared[0]?.metadata).toMatchObject({ corpus: 'demo' });
			expect(upsert.chunks.length).toBeGreaterThanOrEqual(2);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('loads documents from a URL and preserves metadata', async () => {
		const fetchOriginal = globalThis.fetch;
		const url = 'https://example.com/docs/guide.md';
		const response = new Response(
			'# URL Guide\n\nThis content came from a URL.',
			{
				headers: {
					'content-type': 'text/markdown'
				},
				status: 200
			}
		);
		globalThis.fetch = createMockFetch(response);

		try {
			const loaded = await loadRAGDocumentFromURL({
				chunking: { strategy: 'paragraphs' },
				format: 'markdown',
				metadata: { source: 'external' },
				url
			});

			expect(loaded.source).toBe(url);
			expect(loaded.format).toBe('markdown');
			expect(loaded.text).toContain('URL Guide');
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('loads and decodes base64 uploads', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from('# Uploaded', 'utf8').toString('base64'),
			contentType: 'text/markdown',
			encoding: 'base64',
			name: 'uploaded.md',
			title: 'Uploaded'
		});

		expect(loaded.source).toBe('uploaded.md');
		expect(loaded.format).toBe('markdown');
		expect(loaded.text).toBe('# Uploaded');
		expect(loaded.title).toBe('Uploaded');
	});

	it('extracts text from simple PDF uploads through the built-in extractor', async () => {
		const pdfBytes = Buffer.from(
			'%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT\n(AbsoluteJS PDF evidence) Tj\nET\nendstream\nendobj\n/Type /Page\n/Type /Page\n%%EOF',
			'latin1'
		).toString('base64');

		const loaded = await loadRAGDocumentUpload({
			content: pdfBytes,
			contentType: 'application/pdf',
			encoding: 'base64',
			name: 'evidence.pdf'
		});

		expect(loaded.text).toContain('AbsoluteJS PDF evidence');
		expect(loaded.metadata?.fileKind).toBe('pdf');
		expect(loaded.metadata?.extractor).toBe('absolute_pdf');
		expect(loaded.metadata?.pageCount).toBe(2);
	});

	it('supports custom binary extractors for non-text files', async () => {
		const transcriber = createRAGFileExtractor({
			name: 'mock_audio_transcriber',
			extract: (input) => ({
				format: 'text',
				metadata: {
					...(input.metadata ?? {}),
					transcriptSource: 'mock'
				},
				source: input.source,
				text: 'Transcribed meeting notes from audio.',
				title: input.title ?? 'meeting audio'
			}),
			supports: (input) => input.contentType === 'audio/mpeg'
		});

		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from([1, 2, 3, 4]).toString('base64'),
			contentType: 'audio/mpeg',
			encoding: 'base64',
			extractors: [transcriber],
			name: 'meeting.mp3'
		});

		expect(loaded.text).toContain('Transcribed meeting notes');
		expect(loaded.metadata?.extractor).toBe('mock_audio_transcriber');
		expect(loaded.metadata?.transcriptSource).toBe('mock');
	});

	it('supports first-party media extractor families for audio and video files', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'mock_media',
			transcribe: () => ({
				metadata: { transcriptSource: 'media-provider' },
				segments: [{ endMs: 1000, startMs: 0, text: 'scene one' }],
				text: 'Transcript from mp4 input.'
			})
		});

		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from([1, 2, 3]).toString('base64'),
			contentType: 'video/mp4',
			encoding: 'base64',
			extractors: [createRAGMediaFileExtractor(transcriber)],
			name: 'demo.mp4'
		});

		expect(loaded.text).toContain('Transcript from mp4 input');
		expect(loaded.metadata?.fileKind).toBe('media');
		expect(loaded.metadata?.transcriptSource).toBe('media-provider');
	});

	it('emits source-native media segment documents in batch upload ingest', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						endMs: 900,
						startMs: 0,
						text: 'Regional growth is tracked in Overview.'
					},
					{
						endMs: 1800,
						startMs: 900,
						text: 'The workflow stays aligned across every frontend.'
					}
				],
				text: 'Regional growth is tracked in Overview. The workflow stays aligned across every frontend.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [createRAGMediaFileExtractor(transcriber)],
			uploads: [
				{
					content: Buffer.from([1, 2, 3]).toString('base64'),
					contentType: 'audio/mpeg',
					encoding: 'base64',
					name: 'standup.mp3'
				}
			]
		});

		expect(loaded.documents).toHaveLength(3);
		expect(
			loaded.documents.some(
				(document) => document.metadata?.mediaSegmentIndex === 1
			)
		).toBe(true);
		const segmentDocument = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentIndex === 0
		);
		expect(segmentDocument?.title).toContain('segment 1');
		expect(segmentDocument?.text).toContain('timestamp');
	});

	it('supports first-party OCR extractor families for image files', async () => {
		const ocr = createRAGOCRProvider({
			name: 'mock_ocr',
			extractText: () => ({
				metadata: { ocrEngine: 'mock' },
				text: 'Extracted receipt text'
			})
		});

		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from([255, 216, 255]).toString('base64'),
			contentType: 'image/jpeg',
			encoding: 'base64',
			extractors: [createRAGImageOCRExtractor(ocr)],
			name: 'receipt.jpg'
		});

		expect(loaded.text).toBe('Extracted receipt text');
		expect(loaded.metadata?.fileKind).toBe('image');
		expect(loaded.metadata?.ocrEngine).toBe('mock');
	});

	it('supports first-party archive extractor families for zip-like bundles', async () => {
		const archive = createRAGArchiveExpander({
			name: 'mock_zip',
			expand: () => ({
				entries: [
					{
						data: Buffer.from('# Nested doc', 'utf8'),
						path: 'docs/nested.md'
					},
					{
						data: Buffer.from('meeting audio', 'utf8'),
						path: 'media/meeting.mp3',
						contentType: 'audio/mpeg'
					}
				],
				metadata: { archiveSource: 'bundle' }
			})
		});
		const transcriber = createRAGMediaTranscriber({
			name: 'archive_media',
			transcribe: () => ({
				text: 'Transcribed archive audio'
			})
		});

		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from([80, 75, 3, 4]).toString('base64'),
			contentType: 'application/zip',
			encoding: 'base64',
			extractors: [
				createRAGArchiveFileExtractor(archive, {
					entryExtractors: [createRAGMediaFileExtractor(transcriber)]
				})
			],
			name: 'bundle.zip'
		});

		expect(loaded.text).toContain('Nested doc');
		expect(loaded.metadata?.archiveSource).toBe('bundle');
		expect(loaded.metadata?.fileKind).toBe('archive');
	});

	it('supports built-in docx extraction', async () => {
		const docx = createStoredZip({
			'word/document.xml':
				'<w:document><w:body><w:p><w:t>AbsoluteJS docx text</w:t></w:p><w:p><w:t>Second paragraph</w:t></w:p></w:body></w:document>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			encoding: 'base64',
			name: 'spec.docx'
		});

		expect(loaded.text).toContain('AbsoluteJS docx text');
		expect(loaded.metadata?.fileKind).toBe('office');
		expect(loaded.metadata?.extractor).toBe('absolute_office_document');
		expect(loaded.metadata?.sectionCount).toBe(2);
	});

	it('supports built-in xlsx extraction', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Alpha</t></si><si><t>Beta</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row></sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: xlsx.toString('base64'),
			encoding: 'base64',
			name: 'sheet.xlsx'
		});

		expect(loaded.text).toContain('Alpha');
		expect(loaded.text).toContain('Beta');
		expect(loaded.metadata?.fileKind).toBe('office');
		expect(loaded.metadata?.sheetNames).toEqual(['Overview', 'Details']);
	});

	it('emits source-native spreadsheet sheet documents in batch upload ingest', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Regional growth</t></si><si><t>Escalation checklist</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>',
			'xl/worksheets/sheet2.xml':
				'<worksheet><sheetData><row><c t="s"><v>1</v></c></row></sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'forecast.xlsx'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(3);
		expect(
			loaded.documents.some(
				(document) => document.metadata?.sheetName === 'Overview'
			)
		).toBe(true);
		expect(
			loaded.documents.some(
				(document) => document.metadata?.sheetName === 'Details'
			)
		).toBe(true);
		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);
		expect(overviewDocument?.title).toBe('Sheet Overview');
		expect(overviewDocument?.text).toContain(
			'Workbook sheet named Overview'
		);
	});

	it('supports built-in pptx extraction', async () => {
		const pptx = createStoredZip({
			'ppt/slides/slide1.xml': '<p:sld><a:t>Slide one</a:t></p:sld>',
			'ppt/slides/slide2.xml': '<p:sld><a:t>Slide two</a:t></p:sld>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: pptx.toString('base64'),
			encoding: 'base64',
			name: 'deck.pptx'
		});

		expect(loaded.text).toContain('Slide one');
		expect(loaded.text).toContain('Slide two');
		expect(loaded.metadata?.slideCount).toBe(2);
	});

	it('supports built-in epub extraction', async () => {
		const epub = createStoredZip({
			'OEBPS/chapter1.xhtml':
				'<html><body><h1>Chapter</h1><p>AbsoluteJS EPUB</p></body></html>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: epub.toString('base64'),
			encoding: 'base64',
			name: 'book.epub'
		});

		expect(loaded.text).toContain('AbsoluteJS EPUB');
		expect(loaded.metadata?.fileKind).toBe('epub');
	});

	it('supports built-in email extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content:
				'Subject: Hello\nFrom: test@example.com\nTo: team@example.com\n\nThis is the email body.',
			name: 'note.eml'
		});

		expect(loaded.title).toBe('Hello');
		expect(loaded.text).toContain('This is the email body');
		expect(loaded.metadata?.fileKind).toBe('email');
		expect(loaded.metadata?.from).toBe('test@example.com');
		expect(loaded.metadata?.to).toBe('team@example.com');
		expect(loaded.metadata?.threadTopic).toBe('Hello');
	});

	it('supports built-in rtf extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content:
				'{\\rtf1\\ansi\\b AbsoluteJS RTF\\b0\\par Retrieval workflow}',
			name: 'notes.rtf'
		});

		expect(loaded.text).toContain('AbsoluteJS RTF');
		expect(loaded.text).toContain('Retrieval workflow');
		expect(loaded.metadata?.fileKind).toBe('rtf');
	});

	it('supports built-in legacy doc extraction through text heuristics', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from(
				'WordDocument AbsoluteJS legacy doc support',
				'latin1'
			).toString('base64'),
			encoding: 'base64',
			name: 'report.doc'
		});

		expect(loaded.text).toContain('AbsoluteJS legacy doc support');
		expect(loaded.metadata?.fileKind).toBe('legacy_office');
		expect(loaded.metadata?.legacyFormat).toBe('doc');
	});

	it('supports built-in legacy msg extraction through text heuristics', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from(
				'Subject Test Message AbsoluteJS msg extraction body',
				'utf8'
			).toString('base64'),
			encoding: 'base64',
			name: 'mail.msg'
		});

		expect(loaded.text).toContain('AbsoluteJS msg extraction body');
		expect(loaded.metadata?.fileKind).toBe('email');
		expect(loaded.metadata?.legacyFormat).toBe('msg');
	});

	it('supports built-in archive expansion for zip files', async () => {
		const zip = createStoredZip({
			'docs/guide.md': '# Guide\n\nArchive text'
		});

		const loaded = await loadRAGDocumentUpload({
			content: zip.toString('base64'),
			encoding: 'base64',
			name: 'bundle.zip'
		});

		expect(loaded.text).toContain('Guide');
		expect(loaded.metadata?.archiveType).toBe('zip');
		expect(loaded.metadata?.fileKind).toBe('archive');
	});

	it('preserves multiple archive entry documents during batch upload ingest', async () => {
		const zip = createStoredZip({
			'docs/escalation.md':
				'# Escalation\n\nEscalate to the support lead.',
			'runbooks/recovery.md':
				'# Recovery\n\nRecovery procedures live here.'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: zip.toString('base64'),
					encoding: 'base64',
					name: 'bundle.zip'
				}
			]
		});

		expect(loaded.documents).toHaveLength(2);
		expect(loaded.documents.map((document) => document.source)).toEqual([
			'bundle.zip#docs/escalation.md',
			'bundle.zip#runbooks/recovery.md'
		]);
		expect(loaded.documents.map((document) => document.title)).toEqual([
			'escalation.md',
			'recovery.md'
		]);
	});

	it('builds upload-oriented upsert payloads', async () => {
		const encodedText = Buffer.from(
			'Upload chunking content.',
			'utf8'
		).toString('base64');

		const upsert = await buildRAGUpsertInputFromUploads({
			baseMetadata: { sourceKind: 'upload' },
			uploads: [
				{
					content: encodedText,
					encoding: 'base64',
					metadata: {
						source: 'local'
					},
					name: 'ingest.txt'
				}
			]
		});

		expect(upsert.chunks).toHaveLength(1);
		expect(upsert.chunks[0]?.source).toBe('ingest.txt');
		expect(upsert.chunks[0]?.metadata?.uploadFile).toBe('ingest.txt');
		expect(upsert.chunks[0]?.metadata?.sourceKind).toBe('upload');
	});

	it('loads upload metadata through directory-style helper', async () => {
		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: 'just text',
					name: 'notes.txt'
				}
			]
		});

		expect(loaded.documents[0]?.source).toBe('notes.txt');
		expect(loaded.documents[0]?.metadata).toMatchObject({
			uploadFile: 'notes.txt'
		});
	});

	it('builds URL ingest payloads through the batch helper', async () => {
		const fetchOriginal = globalThis.fetch;
		const response = new Response('URL data for chunking.', {
			headers: { 'content-type': 'text/plain' },
			status: 200
		});
		globalThis.fetch = createMockFetch(response);

		try {
			const upsert = await buildRAGUpsertInputFromURLs({
				baseMetadata: { corpus: 'docs' },
				urls: [
					{
						url: 'https://example.com/guide.txt'
					}
				]
			});

			expect(upsert.chunks).toHaveLength(1);
			expect(upsert.chunks[0]?.source).toMatch(
				'https://example.com/guide.txt'
			);
			expect(upsert.chunks[0]?.metadata?.sourceUrl).toBe(
				'https://example.com/guide.txt'
			);
		} finally {
			globalThis.fetch = fetchOriginal;
		}
	});

	it('loads file documents through extractors instead of assuming utf8 text', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-file-'));

		try {
			const path = join(tempDir, 'notes.mp3');
			writeFileSync(path, Buffer.from([5, 4, 3, 2]));
			const extractor = createRAGFileExtractor({
				name: 'mp3_test',
				extract: () => ({
					format: 'text',
					text: 'Binary audio transcript'
				}),
				supports: (input) => input.path?.endsWith('.mp3') === true
			});

			const loaded = await loadRAGDocumentFile({
				extractors: [extractor],
				path
			});

			expect(loaded.text).toBe('Binary audio transcript');
			expect(loaded.metadata?.extractor).toBe('mp3_test');
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('lets directory ingest include custom binary files when extractors are registered', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-dir-binary-'));

		try {
			writeFileSync(join(tempDir, 'meeting.mp3'), Buffer.from([9, 8, 7]));
			const extractor = createRAGFileExtractor({
				name: 'dir_audio',
				extract: () => ({
					format: 'text',
					text: 'Directory audio transcript'
				}),
				supports: (input) => input.path?.endsWith('.mp3') === true
			});

			const loaded = await loadRAGDocumentsFromDirectory({
				directory: tempDir,
				extractors: [extractor]
			});

			expect(loaded.documents).toHaveLength(1);
			expect(loaded.documents[0]?.text).toBe(
				'Directory audio transcript'
			);
			expect(loaded.documents[0]?.metadata?.extractor).toBe('dir_audio');
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('supports scanned PDF OCR fallback through a first-class extractor', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_ocr',
			extractText: () => ({
				metadata: { ocrEngine: 'mock-pdf' },
				text: 'OCR text from scanned PDF'
			})
		});

		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from('%PDF-1.4\n%%EOF', 'latin1').toString(
				'base64'
			),
			contentType: 'application/pdf',
			encoding: 'base64',
			extractors: [createRAGPDFOCRExtractor({ provider: ocr })],
			name: 'scan.pdf'
		});

		expect(loaded.text).toBe('OCR text from scanned PDF');
		expect(loaded.metadata?.pdfTextMode).toBe('ocr');
		expect(loaded.metadata?.ocrEngine).toBe('mock-pdf');
		expect(loaded.metadata?.pageCount).toBe(1);
	});

	it('supports custom legacy extractor wiring explicitly', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from('Legacy worksheet text', 'utf8').toString(
				'base64'
			),
			encoding: 'base64',
			extractors: [createLegacyDocumentExtractor()],
			name: 'sheet.xls'
		});

		expect(loaded.text).toContain('Legacy worksheet text');
		expect(loaded.metadata?.legacyFormat).toBe('xls');
	});
});
