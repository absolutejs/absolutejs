import { describe, expect, it } from 'bun:test';
import type { AIMessage, RAGSource } from '../../../../types/ai';
import {
	buildRAGAnswerWorkflowState,
	buildRAGRetrievedState,
	buildRAGCitations,
	buildRAGCitationReferenceMap,
	buildRAGGroundedAnswer,
	buildRAGGroundingReferences,
	buildRAGSourceGroups,
	buildRAGSourceSummaries,
	buildRAGStreamProgress,
	getLatestAssistantMessage,
	getLatestRetrievedMessage,
	getLatestRAGSources,
	resolveRAGStreamStage
} from '../../../../src/ai/rag/presentation';

const buildSource = (overrides: Partial<RAGSource> = {}): RAGSource => ({
	chunkId: 'chunk-1',
	score: 0.9,
	text: 'Chunk text',
	...overrides
});

const buildAssistantMessage = (
	overrides: Partial<AIMessage> = {}
): AIMessage => ({
	content: '',
	conversationId: 'conv-1',
	id: 'assistant-1',
	role: 'assistant',
	timestamp: Date.now(),
	...overrides
});

describe('RAG presentation helpers', () => {
	it('groups sources by source label and sorts by best score', () => {
		const groups = buildRAGSourceGroups([
			buildSource({
				chunkId: 'chunk-a',
				score: 0.71,
				source: 'docs/a.md'
			}),
			buildSource({
				chunkId: 'chunk-b',
				score: 0.95,
				source: 'docs/b.md'
			}),
			buildSource({
				chunkId: 'chunk-c',
				score: 0.88,
				source: 'docs/a.md'
			})
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0]?.label).toBe('docs/b.md');
		expect(groups[0]?.bestScore).toBe(0.95);
		expect(groups[1]?.label).toBe('docs/a.md');
		expect(groups[1]?.count).toBe(2);
		expect(groups[1]?.chunks.map((chunk) => chunk.chunkId)).toEqual([
			'chunk-a',
			'chunk-c'
		]);
	});

	it('dedupes citations by chunk id and keeps the highest score', () => {
		const citations = buildRAGCitations([
			buildSource({
				chunkId: 'chunk-a',
				score: 0.4,
				source: 'docs/a.md',
				text: 'lower'
			}),
			buildSource({
				chunkId: 'chunk-a',
				score: 0.8,
				source: 'docs/a.md',
				text: 'higher'
			}),
			buildSource({
				chunkId: 'chunk-b',
				score: 0.7,
				source: 'docs/b.md'
			})
		]);

		expect(citations).toHaveLength(2);
		expect(citations[0]).toMatchObject({
			chunkId: 'chunk-a',
			score: 0.8,
			text: 'higher'
		});
		expect(citations[1]?.chunkId).toBe('chunk-b');
	});

	it('builds stable citation reference numbers by citation order', () => {
		const citations = buildRAGCitations([
			buildSource({
				chunkId: 'chunk-a',
				score: 0.8,
				source: 'docs/a.md'
			}),
			buildSource({
				chunkId: 'chunk-b',
				score: 0.7,
				source: 'docs/b.md'
			})
		]);

		expect(buildRAGCitationReferenceMap(citations)).toEqual({
			'chunk-a': 1,
			'chunk-b': 2
		});
	});

	it('builds source summaries with excerpts and citation numbers', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'chunk-a',
				metadata: {
					from: 'ops@absolutejs.dev',
					threadTopic: 'Refund workflow escalation'
				},
				score: 0.91,
				source: 'docs/a.md',
				text: 'This is the strongest excerpt for document A and it should appear in the summary.'
			}),
			buildSource({
				chunkId: 'chunk-b',
				score: 0.85,
				source: 'docs/a.md',
				text: 'Another chunk for the same source.'
			}),
			buildSource({
				chunkId: 'chunk-c',
				score: 0.8,
				source: 'docs/b.md',
				text: 'Document B chunk.'
			})
		]);

		expect(summaries).toHaveLength(2);
		expect(summaries[0]).toMatchObject({
			chunkIds: ['chunk-a', 'chunk-b'],
			contextLabel: 'Thread Refund workflow escalation',
			citationNumbers: [1, 2],
			count: 2,
			label: 'docs/a.md'
		});
		expect(summaries[0]?.excerpt).toContain('strongest excerpt');
		expect(summaries[0]?.provenanceLabel).toContain(
			'Thread Refund workflow escalation'
		);
		expect(summaries[1]?.citationNumbers).toEqual([3]);
	});

	it('builds grounding references with metadata-aware context labels', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'chunk-a',
				metadata: { page: 4 },
				score: 0.91,
				source: 'docs/guide.pdf',
				text: 'Grounding excerpt from a PDF page.'
			}),
			buildSource({
				chunkId: 'chunk-b',
				metadata: { sheetName: 'Revenue' },
				score: 0.85,
				source: 'docs/report.xlsx',
				text: 'Grounding excerpt from a spreadsheet.'
			})
		]);

		expect(references).toHaveLength(2);
		expect(references[0]).toMatchObject({
			chunkId: 'chunk-a',
			contextLabel: 'Page 4',
			number: 1
		});
		expect(references[1]).toMatchObject({
			chunkId: 'chunk-b',
			contextLabel: 'Sheet Revenue',
			number: 2
		});
	});

	it('builds email-specific grounding provenance for messages and attachments', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'chunk-email-message',
				metadata: {
					emailKind: 'message',
					from: 'ops@absolutejs.dev',
					sentAt: '2026-04-09T12:30:00.000Z',
					threadTopic: 'Refund workflow escalation'
				},
				score: 0.91,
				source: 'sync/email/gmail/thread-1',
				text: 'The message preserves sender identity and thread lineage.'
			}),
			buildSource({
				chunkId: 'chunk-email-attachment',
				metadata: {
					attachmentId: 'att-1',
					emailKind: 'attachment',
					from: 'ops@absolutejs.dev',
					sentAt: '2026-04-09T12:30:00.000Z',
					threadTopic: 'Refund workflow escalation'
				},
				score: 0.88,
				source: 'sync/email/gmail/thread-1/attachments/refund-policy.md',
				text: 'The attached policy keeps attachment evidence visible.'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Message from ops@absolutejs.dev'
		);
		expect(references[0]?.locatorLabel).toBeUndefined();
		expect(references[0]?.provenanceLabel).toContain(
			'Thread Refund workflow escalation'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Sender ops@absolutejs.dev'
		);
		expect(references[0]?.provenanceLabel).toContain('Sent ');
		expect(references[1]?.contextLabel).toBe('Attachment evidence');
		expect(references[1]?.locatorLabel).toBe('Attachment refund-policy.md');
		expect(references[1]?.provenanceLabel).toContain(
			'Thread Refund workflow escalation'
		);
	});

	it('includes pdf and media provenance labels in grounding references', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'chunk-pdf',
				metadata: {
					page: 7,
					pdfTextMode: 'native_text',
					ocrEngine: 'demo_pdf_ocr'
				},
				score: 0.9,
				source: 'files/native-handbook.pdf',
				text: 'Diagnostics stay inspectable on page seven.'
			}),
			buildSource({
				chunkId: 'chunk-media',
				metadata: {
					endMs: 34500,
					mediaKind: 'audio',
					startMs: 12000,
					transcriptSource: 'demo_media_transcriber'
				},
				score: 0.86,
				source: 'files/daily-standup.mp3',
				text: 'Retrieval, citations, evaluation, and ingest stay aligned.'
			})
		]);

		expect(references[0]?.locatorLabel).toBe('Page 7');
		expect(references[0]?.provenanceLabel).toContain('PDF native_text');
		expect(references[0]?.provenanceLabel).toContain('OCR demo_pdf_ocr');
		expect(references[1]?.locatorLabel).toBe(
			'Timestamp 00:12.000 - 00:34.500'
		);
		expect(references[1]?.provenanceLabel).toContain('Media audio');
		expect(references[1]?.provenanceLabel).toContain(
			'Transcript demo_media_transcriber'
		);
	});

	it('builds grounded answers by resolving citation markers to evidence', () => {
		const grounded = buildRAGGroundedAnswer(
			'AbsoluteJS keeps citations first-class [1] and spreadsheet context visible [2].',
			[
				buildSource({
					chunkId: 'chunk-a',
					metadata: { page: 2 },
					score: 0.91,
					source: 'docs/guide.pdf',
					text: 'AbsoluteJS keeps citations first-class for grounded answers.'
				}),
				buildSource({
					chunkId: 'chunk-b',
					metadata: { sheetName: 'Revenue' },
					score: 0.85,
					source: 'docs/report.xlsx',
					text: 'Spreadsheet context remains visible in source inspection.'
				})
			]
		);

		expect(grounded.hasCitations).toBe(true);
		expect(grounded.coverage).toBe('grounded');
		expect(
			grounded.references.map((reference) => reference.number)
		).toEqual([1, 2]);
		expect(grounded.parts[1]).toMatchObject({
			referenceDetails: [
				{
					contextLabel: 'Page 2',
					evidenceLabel: 'docs/guide.pdf · Page 2',
					evidenceSummary: 'docs/guide.pdf',
					number: 1
				}
			],
			referenceNumbers: [1],
			text: '[1]',
			type: 'citation'
		});
		expect(grounded.parts[3]).toMatchObject({
			referenceDetails: [
				{
					contextLabel: 'Sheet Revenue',
					evidenceLabel: 'docs/report.xlsx · Sheet Revenue',
					evidenceSummary: 'docs/report.xlsx',
					number: 2
				}
			],
			referenceNumbers: [2],
			text: '[2]',
			type: 'citation'
		});
		expect(grounded.ungroundedReferenceNumbers).toEqual([]);
	});

	it('marks partially grounded answers when a citation number cannot be resolved', () => {
		const grounded = buildRAGGroundedAnswer(
			'One claim is grounded [1] and one is not [3].',
			[
				buildSource({
					chunkId: 'chunk-a',
					score: 0.91,
					source: 'docs/guide.md',
					text: 'One claim is grounded.'
				})
			]
		);

		expect(grounded.coverage).toBe('partial');
		expect(grounded.ungroundedReferenceNumbers).toEqual([3]);
		expect(grounded.parts[1]).toMatchObject({
			referenceDetails: [
				{
					evidenceLabel: 'docs/guide.md',
					evidenceSummary: 'docs/guide.md',
					number: 1
				}
			],
			unresolvedReferenceNumbers: []
		});
		expect(grounded.parts[3]).toMatchObject({
			referenceDetails: [],
			referenceNumbers: [3],
			unresolvedReferenceNumbers: [3]
		});
	});

	it('builds a unified answer workflow state from stream state', () => {
		const messages: AIMessage[] = [
			{
				content: 'Explain the workflow.',
				conversationId: 'conv-1',
				id: 'user-1',
				role: 'user',
				timestamp: Date.now()
			},
			buildAssistantMessage({
				content: 'AbsoluteJS keeps answers grounded [1].',
				id: 'assistant-2',
				retrievalDurationMs: 42,
				retrievalStartedAt: 100,
				retrievedAt: 142,
				sources: [
					buildSource({
						chunkId: 'chunk-a',
						metadata: { page: 2 },
						source: 'docs/workflow.pdf',
						text: 'AbsoluteJS keeps answers grounded for inspection.'
					})
				]
			})
		];

		const workflow = buildRAGAnswerWorkflowState({
			error: null,
			isStreaming: false,
			messages
		});

		expect(workflow.stage).toBe('complete');
		expect(workflow.isComplete).toBe(true);
		expect(workflow.hasRetrieved).toBe(true);
		expect(workflow.hasGrounding).toBe(true);
		expect(workflow.coverage).toBe('grounded');
		expect(workflow.citationReferenceMap).toEqual({ 'chunk-a': 1 });
		expect(workflow.groundedAnswer.references[0]).toMatchObject({
			contextLabel: 'Page 2',
			number: 1
		});
		expect(workflow.retrieval?.retrievalDurationMs).toBe(42);
	});

	it('returns the latest assistant message and its sources', () => {
		const latestSources = [
			buildSource({ chunkId: 'chunk-final', source: 'docs/final.md' })
		];
		const messages: AIMessage[] = [
			{
				content: 'hello',
				conversationId: 'conv-1',
				id: 'user-1',
				role: 'user',
				timestamp: Date.now()
			},
			buildAssistantMessage({
				content: 'Earlier answer',
				id: 'assistant-1',
				sources: [buildSource({ chunkId: 'chunk-old' })]
			}),
			buildAssistantMessage({
				content: 'Latest answer',
				id: 'assistant-2',
				sources: latestSources
			})
		];

		expect(getLatestAssistantMessage(messages)?.id).toBe('assistant-2');
		expect(getLatestRetrievedMessage(messages)?.id).toBe('assistant-2');
		expect(getLatestRAGSources(messages)).toEqual(latestSources);
	});

	it('builds first-class retrieved state from the latest retrieved message', () => {
		const messages: AIMessage[] = [
			buildAssistantMessage({
				id: 'assistant-1',
				sources: [
					buildSource({ chunkId: 'chunk-old', source: 'old.md' })
				]
			}),
			buildAssistantMessage({
				content: 'Answer',
				id: 'assistant-2',
				retrievalDurationMs: 34,
				retrievalStartedAt: 1200,
				retrievedAt: 1234,
				sources: [
					buildSource({
						chunkId: 'chunk-new',
						score: 0.95,
						source: 'guide/demo.md'
					})
				]
			})
		];

		const retrieved = buildRAGRetrievedState(messages);
		expect(retrieved?.messageId).toBe('assistant-2');
		expect(retrieved?.retrievalStartedAt).toBe(1200);
		expect(retrieved?.retrievalDurationMs).toBe(34);
		expect(retrieved?.retrievedAt).toBe(1234);
		expect(retrieved?.sourceGroups[0]?.label).toBe('guide/demo.md');
		expect(retrieved?.sourceSummaries[0]?.label).toBe('guide/demo.md');
		expect(retrieved?.citations[0]?.chunkId).toBe('chunk-new');
		expect(retrieved?.citationReferenceMap['chunk-new']).toBe(1);
		expect(retrieved?.groundedAnswer.coverage).toBe('ungrounded');
	});

	it('resolves retrieving stage while retrieval is running', () => {
		const stage = resolveRAGStreamStage({
			error: null,
			isStreaming: true,
			messages: [
				buildAssistantMessage({
					id: 'assistant-1',
					retrievalStartedAt: 1000
				})
			]
		});

		expect(stage).toBe('retrieving');
	});

	it('resolves retrieval stage when sources arrive before answer text', () => {
		const stage = resolveRAGStreamStage({
			error: null,
			isStreaming: true,
			messages: [
				buildAssistantMessage({
					id: 'assistant-1',
					retrievedAt: 1234,
					sources: [buildSource({ chunkId: 'chunk-retrieved' })]
				})
			]
		});

		expect(stage).toBe('retrieved');
	});

	it('resolves streaming and completion stages correctly', () => {
		const streaming = resolveRAGStreamStage({
			error: null,
			isStreaming: true,
			messages: [
				buildAssistantMessage({
					content: 'Answer in progress',
					id: 'assistant-1',
					sources: [buildSource({ chunkId: 'chunk-retrieved' })]
				})
			]
		});

		const complete = resolveRAGStreamStage({
			error: null,
			isStreaming: false,
			messages: [
				buildAssistantMessage({
					content: 'Answer complete',
					id: 'assistant-1'
				})
			]
		});

		const errored = resolveRAGStreamStage({
			error: 'boom',
			isStreaming: false,
			messages: []
		});

		expect(streaming).toBe('streaming');
		expect(complete).toBe('complete');
		expect(errored).toBe('error');
	});

	it('treats zero-source retrieval completion as retrieved state', () => {
		const messages: AIMessage[] = [
			buildAssistantMessage({
				id: 'assistant-1',
				retrievalStartedAt: 1000,
				retrievedAt: 1016,
				sources: []
			})
		];

		expect(getLatestRetrievedMessage(messages)?.id).toBe('assistant-1');
		expect(buildRAGRetrievedState(messages)?.retrievedAt).toBe(1016);
		expect(
			resolveRAGStreamStage({
				error: null,
				isStreaming: true,
				messages
			})
		).toBe('retrieved');
	});

	it('builds retrieval progress for complete answer streaming flow', () => {
		const progress = buildRAGStreamProgress({
			error: null,
			isStreaming: false,
			messages: [
				buildAssistantMessage({
					content: 'Final answer',
					id: 'assistant-complete',
					retrievalDurationMs: 15,
					retrievalStartedAt: 1180,
					retrievedAt: 1200,
					sources: [buildSource({ chunkId: 'chunk-1' })]
				})
			]
		});

		expect(progress.isComplete).toBe(true);
		expect(progress.isRetrieving).toBe(false);
		expect(progress.isRetrieved).toBe(false);
		expect(progress.hasSources).toBe(true);
		expect(progress.sourceCount).toBe(1);
		expect(progress.retrievalDurationMs).toBe(15);
		expect(progress.stage).toBe('complete');
	});

	it('builds retrieving progress while a rag retrieval is in flight', () => {
		const progress = buildRAGStreamProgress({
			error: null,
			isStreaming: true,
			messages: [
				buildAssistantMessage({
					id: 'assistant-retrieving',
					retrievalStartedAt: 2000
				})
			]
		});

		expect(progress.isRetrieving).toBe(true);
		expect(progress.isRetrieved).toBe(false);
		expect(progress.isComplete).toBe(false);
		expect(progress.stage).toBe('retrieving');
		expect(progress.sourceCount).toBe(0);
	});
});
