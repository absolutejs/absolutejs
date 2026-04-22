import { describe, expect, it } from 'bun:test';
import type { RAGQueryResult } from '../../../../types/ai';
import { buildRAGContext } from '../../../../src/ai/rag/types';

const buildHit = (overrides: Partial<RAGQueryResult> = {}): RAGQueryResult => ({
	chunkId: 'chunk-1',
	score: 0.9,
	source: 'docs/example.md',
	title: 'Example title',
	chunkText: 'Example chunk text',
	...overrides
});

describe('RAG context prompt builder', () => {
	it('includes source-native location and provenance cues', () => {
		const context = buildRAGContext([
			buildHit({
				chunkId: 'pdf-chunk',
				source: 'docs/guide.pdf',
				title: 'Guide page 7',
				chunkText: 'PDF evidence for the workflow.',
				metadata: {
					page: 7,
					pdfTextMode: 'native_text',
					ocrEngine: 'demo_pdf_ocr'
				}
			}),
			buildHit({
				chunkId: 'pdf-region',
				source: 'docs/guide.pdf',
				title: 'Guide page 7 region 2',
				chunkText: 'Region-level PDF evidence for the workflow.',
				metadata: {
					pageNumber: 7,
					regionNumber: 2,
					pdfTextMode: 'ocr',
					ocrEngine: 'demo_pdf_ocr',
					ocrRegionConfidence: 0.91
				}
			}),
			buildHit({
				chunkId: 'sheet-chunk',
				source: 'docs/report.xlsx',
				title: 'Regional Growth',
				chunkText: 'Spreadsheet evidence for the revenue benchmark.',
				metadata: {
					sheetName: 'Regional Growth'
				}
			}),
			buildHit({
				chunkId: 'media-chunk',
				source: 'docs/daily-standup.mp3',
				title: 'Daily standup transcript',
				chunkText: 'Audio evidence for the handoff decision.',
				metadata: {
					startMs: 12000,
					endMs: 34500,
					mediaKind: 'audio',
					transcriptSource: 'fixture_whisper'
				}
			}),
			buildHit({
				chunkId: 'email-attachment',
				source: 'sync/email/gmail/thread-1/attachments/refund-policy.md',
				title: 'Refund policy attachment',
				chunkText: 'Attachment evidence for the refund workflow.',
				metadata: {
					emailKind: 'attachment',
					attachmentName: 'refund-policy.md',
					from: 'ops@absolutejs.dev',
					threadTopic: 'Refund workflow escalation'
				}
			})
		]);

		expect(context).toContain('[1] Guide page 7 (docs/guide.pdf)');
		expect(context).toContain('Location: Page 7');
		expect(context).toContain(
			'Provenance: PDF native_text · OCR demo_pdf_ocr'
		);
		expect(context).toContain('Location: Page 7 · Region 2');
		expect(context).toContain(
			'Provenance: PDF ocr · OCR demo_pdf_ocr · Confidence 0.91'
		);
		expect(context).toContain('Location: Sheet Regional Growth');
		expect(context).toContain('Location: Timestamp 00:12.000 - 00:34.500');
		expect(context).toContain(
			'Provenance: Media audio · Transcript fixture_whisper'
		);
		expect(context).toContain('Location: Attachment refund-policy.md');
		expect(context).toContain(
			'Provenance: Thread Refund workflow escalation · Sender ops@absolutejs.dev'
		);
		expect(context).toContain(
			'Prefer the most specific evidence available and preserve page, sheet, slide, timestamp, attachment, archive entry, or thread cues'
		);
		expect(context).toContain(
			'For PDF evidence, keep the cited page number in the answer when the context includes one.'
		);
		expect(context).toContain(
			'For spreadsheet evidence, name the worksheet when the context identifies a sheet.'
		);
		expect(context).toContain(
			'For media evidence, preserve the cited timestamp range in the answer.'
		);
		expect(context).toContain(
			'For email attachment evidence, distinguish the attachment from the parent message.'
		);
		expect(context).toContain(
			'For email message evidence, preserve sender or thread cues when they matter to the claim.'
		);
	});

	it('adds archive and slide-specific citation guidance when that evidence exists', () => {
		const context = buildRAGContext([
			buildHit({
				chunkId: 'archive-chunk',
				source: 'archives/support-bundle.zip#runbooks/recovery.md',
				title: 'Recovery runbook',
				chunkText: 'Archive entry evidence for recovery.',
				metadata: {
					archiveEntryPath: 'runbooks/recovery.md'
				}
			}),
			buildHit({
				chunkId: 'slide-chunk',
				source: 'files/workflow-roadmap.pptx',
				title: 'Workflow roadmap',
				chunkText: 'Presentation evidence for the rollout.',
				metadata: {
					slideNumber: 5
				}
			})
		]);

		expect(context).toContain(
			'Location: Archive entry runbooks/recovery.md'
		);
		expect(context).toContain('Location: Slide 5');
		expect(context).toContain(
			'For archive evidence, identify the archive entry path instead of only naming the outer archive.'
		);
		expect(context).toContain(
			'For presentation evidence, keep the slide number in the answer when the context provides it.'
		);
	});

	it('returns an empty string when there are no hits', () => {
		expect(buildRAGContext([])).toBe('');
	});
});
