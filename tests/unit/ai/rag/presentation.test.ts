import { describe, expect, it } from 'bun:test';
import type { AIMessage, RAGSource } from '../../../../types/ai';
import {
	buildRAGAdminActionPresentations,
	buildRAGAdminJobPresentations,
	buildRAGAnswerWorkflowState,
	buildRAGChunkGraph,
	buildRAGChunkGraphNavigation,
	buildRAGChunkStructure,
	buildRAGChunkPreviewGraph,
	buildRAGChunkPreviewNavigation,
	buildRAGRetrievedState,
	buildRAGCitations,
	buildRAGCitationReferenceMap,
	buildRAGChunkExcerpts,
	buildRAGGroundedAnswer,
	buildRAGGroundedAnswerSectionSummaries,
	buildRAGGroundingReferences,
	buildRAGSectionRetrievalDiagnostics,
	buildRAGSyncSourcePresentation,
	buildRAGSourceLabels,
	buildRAGRetrievalTracePresentation,
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

const buildRepeatedClosureOfficeSource = ({
	chunkId,
	branchOrdinal,
	familyName,
	familyOrdinal,
	score,
	text
}: {
	chunkId: string;
	branchOrdinal: number;
	familyName: string;
	familyOrdinal: number;
	score: number;
	text: string;
}): RAGSource => {
	const closureTitle =
		branchOrdinal === 1
			? 'Closure Notes'
			: `Closure Notes (${branchOrdinal})`;
	const familyTitle =
		familyOrdinal === 1 ? familyName : `${familyName} (${familyOrdinal})`;

	return buildSource({
		chunkId,
		metadata: {
			officeBlockKind: 'table',
			officeFamilyPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review',
				'Review Notes',
				'Closure Notes',
				familyName
			],
			officeOrdinalPath: [1, 1, 2, 2, branchOrdinal, familyOrdinal],
			officeSiblingFamilyKey: familyName,
			officeSiblingOrdinal: familyOrdinal,
			officeTableBodyRowCount: 1,
			officeTableColumnCount: 2,
			officeTableContextText: `Use this table to track stable branch ${branchOrdinal} ${familyName.toLowerCase()} evidence by artifact.`,
			officeTableHeaders: ['Artifact', 'State'],
			sectionKind: 'office_block',
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				closureTitle,
				familyTitle
			],
			sectionTitle: familyTitle
		},
		score,
		source: 'docs/scope-slices.docx',
		text
	});
};

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

	it('carries best-hit source labels into grouped retrieval summaries', () => {
		const groups = buildRAGSourceGroups([
			buildSource({
				chunkId: 'chunk-a',
				labels: {
					contextLabel: 'Page 2',
					locatorLabel: 'Page 2',
					provenanceLabel: 'PDF native_text'
				},
				score: 0.7,
				source: 'docs/a.pdf'
			}),
			buildSource({
				chunkId: 'chunk-b',
				labels: {
					contextLabel: 'Page 7 region 2',
					locatorLabel: 'Page 7 · Region 2',
					provenanceLabel: 'OCR demo_pdf_ocr · Confidence 0.91'
				},
				score: 0.95,
				source: 'docs/a.pdf'
			})
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.bestScore).toBe(0.95);
		expect(groups[0]?.labels).toMatchObject({
			contextLabel: 'Page 7 region 2',
			locatorLabel: 'Page 7 · Region 2',
			provenanceLabel: 'OCR demo_pdf_ocr · Confidence 0.91'
		});
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

	it('surfaces sync discovery diagnostics in sync source presentations', () => {
		const presentation = buildRAGSyncSourcePresentation({
			chunkCount: 3,
			consecutiveFailures: 0,
			description: 'Site discovery source',
			diagnostics: {
				entries: [
					{
						code: 'canonical_dedupe_applied',
						severity: 'info',
						summary:
							'2 discovered page candidates were collapsed onto canonical URLs'
					},
					{
						code: 'robots_blocked',
						severity: 'info',
						summary: '1 page candidate was skipped by robots rules'
					},
					{
						code: 'noindex_skipped',
						severity: 'info',
						summary: '1 page was excluded because of noindex'
					}
				],
				retryGuidance: {
					action: 'inspect_source',
					reason: 'Inspect discovery rules before rerunning sync.'
				},
				summary:
					'2 discovered page candidates were collapsed onto canonical URLs | 1 page candidate was skipped by robots rules | 1 page was excluded because of noindex'
			},
			documentCount: 2,
			id: 'site-discovery',
			kind: 'url',
			label: 'Site discovery',
			lastSuccessfulSyncAt: 1_776_610_000_000,
			lastSyncDurationMs: 1_250,
			metadata: {},
			status: 'completed',
			target: 'https://example.com/blog'
		});

		expect(presentation.extendedSummary).toContain('canonical URLs');
		expect(presentation.tags).toEqual(
			expect.arrayContaining([
				'Canonical Dedupe Applied',
				'Robots Blocked',
				'Noindex Skipped'
			])
		);
		expect(presentation.rows).toEqual(
			expect.arrayContaining([
				{
					label: 'Diagnostics',
					value: '2 discovered page candidates were collapsed onto canonical URLs | 1 page candidate was skipped by robots rules | 1 page was excluded because of noindex'
				},
				{
					label: 'Retry guidance',
					value: 'Inspect discovery rules before rerunning sync.'
				}
			])
		);
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
					nextChunkId: 'chunk-b',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-a:section:thread',
					sectionChunkIndex: 0,
					threadTopic: 'Refund workflow escalation'
				},
				score: 0.91,
				source: 'docs/a.md',
				text: 'This is the strongest excerpt for document A and it should appear in the summary.'
			}),
			buildSource({
				chunkId: 'chunk-b',
				metadata: {
					previousChunkId: 'chunk-a',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-a:section:thread',
					sectionChunkIndex: 1
				},
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
		expect(summaries[0]?.excerpts).toMatchObject({
			chunkExcerpt:
				'This is the strongest excerpt for document A and it should appear in the summary.',
			sectionExcerpt:
				'This is the strongest excerpt for document A and it should appear in the summary. Another chunk for the same source.',
			windowExcerpt:
				'This is the strongest excerpt for document A and it should appear in the summary. Another chunk for the same source.'
		});
		expect(summaries[0]?.excerptSelection).toMatchObject({
			mode: 'chunk',
			reason: 'chunk_too_narrow'
		});
		expect(summaries[0]?.provenanceLabel).toContain(
			'Thread Refund workflow escalation'
		);
		expect(summaries[1]?.citationNumbers).toEqual([3]);
	});

	it('builds source summaries with block-aware labels when a pdf block leads', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'pdf-block-lead',
				metadata: {
					pageNumber: 2,
					pdfBlockNumber: 3,
					pdfTextKind: 'table_like',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Page 2 Table Block'
				},
				score: 0.97,
				source: 'docs/report.pdf',
				text: 'Metric | Status'
			}),
			buildSource({
				chunkId: 'pdf-block-peer',
				score: 0.72,
				source: 'docs/report.pdf',
				text: 'Approval | Blocked'
			})
		]);

		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF table block Page 2 Table Block',
			locatorLabel: 'Page 2 · Table Block 3',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Page 2 Table Block',
			label: 'docs/report.pdf'
		});
	});

	it('builds heading-derived labels for contextual pdf paragraph blocks', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'pdf-heading-block',
				metadata: {
					pageNumber: 1,
					pdfBlockNumber: 1,
					pdfTextKind: 'paragraph',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Page One Summary'
				},
				score: 0.94,
				source: 'docs/release-summary.pdf',
				text: 'Page One Summary\nStable rollout remains blocked.'
			})
		]);

		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF text block Page One Summary',
			locatorLabel: 'Page 1 · Text Block 1',
			provenanceLabel:
				'PDF native · PDF text block · Source-aware PDF block Page One Summary',
			label: 'docs/release-summary.pdf'
		});
	});

	it('builds figure-caption-aware labels when a semantic pdf caption block leads', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'pdf-figure-caption',
				metadata: {
					pageNumber: 1,
					pdfBlockNumber: 1,
					pdfSemanticRole: 'figure_caption',
					pdfTextKind: 'paragraph',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Page 1 Figure Caption'
				},
				score: 0.95,
				source: 'docs/approval-figures.pdf',
				text: 'Figure 2\nStable approval gate by release lane.'
			})
		]);

		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF figure caption Page 1 Figure Caption',
			locatorLabel: 'Page 1 · Figure Caption 1',
			provenanceLabel:
				'PDF native · PDF figure caption · Source-aware PDF figure caption Page 1 Figure Caption',
			label: 'docs/approval-figures.pdf'
		});
	});

	it('builds figure-body-aware labels when a semantic pdf body block follows a caption', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'pdf-figure-body',
				metadata: {
					pageNumber: 1,
					pdfBlockNumber: 2,
					pdfFigureCaptionBlockNumber: 1,
					pdfFigureLabel: 'Figure 2',
					pdfSemanticRole: 'figure_body',
					pdfTextKind: 'paragraph',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Figure 2 Body'
				},
				score: 0.92,
				source: 'docs/approval-figures.pdf',
				text: 'Stable lane remains blocked until explicit approval is recorded.'
			})
		]);

		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF figure body Figure 2 Body',
			locatorLabel: 'Page 1 · Figure Body 2',
			provenanceLabel:
				'PDF native · PDF figure body · Source-aware PDF figure body Figure 2 Body',
			label: 'docs/approval-figures.pdf'
		});
	});

	it('prefers nearby heading-derived titles for contextual pdf table blocks', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'pdf-contextual-table',
				metadata: {
					pageNumber: 1,
					pdfBlockNumber: 2,
					pdfTableBodyRowCount: 2,
					pdfTableBodyRowEnd: 2,
					pdfTableBodyRowStart: 1,
					pdfTableColumnCount: 2,
					pdfTableHeaders: ['Metric', 'Status'],
					pdfTextKind: 'table_like',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Release Readiness'
				},
				score: 0.93,
				source: 'docs/readiness.pdf',
				text: 'Metric | Status'
			})
		]);

		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF table block Release Readiness',
			locatorLabel: 'Page 1 · Table Block 2 · Rows 1-2',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Release Readiness · PDF table Metric, Status · PDF table 2 cols · PDF table 2 body rows · PDF table rows 1-2',
			label: 'docs/readiness.pdf'
		});
	});

	it('prefers structured block leads for grouped source labels and summaries', () => {
		const groups = buildRAGSourceGroups([
			buildSource({
				chunkId: 'generic-lead',
				score: 0.96,
				source: 'docs/release-notes.pdf',
				text: 'General release overview paragraph.'
			}),
			buildSource({
				chunkId: 'pdf-table-lead',
				metadata: {
					pageNumber: 4,
					pdfBlockNumber: 2,
					pdfTextKind: 'table_like',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Approval Matrix'
				},
				score: 0.9,
				source: 'docs/release-notes.pdf',
				text: 'Lane | Status'
			})
		]);
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'generic-lead',
				score: 0.96,
				source: 'docs/release-notes.pdf',
				text: 'General release overview paragraph.'
			}),
			buildSource({
				chunkId: 'pdf-table-lead',
				metadata: {
					pageNumber: 4,
					pdfBlockNumber: 2,
					pdfTextKind: 'table_like',
					pdfTextMode: 'native',
					sectionKind: 'pdf_block',
					sectionTitle: 'Approval Matrix'
				},
				score: 0.9,
				source: 'docs/release-notes.pdf',
				text: 'Lane | Status'
			})
		]);

		expect(groups[0]?.bestScore).toBe(0.96);
		expect(groups[0]?.labels).toMatchObject({
			contextLabel: 'PDF table block Approval Matrix',
			locatorLabel: 'Page 4 · Table Block 2',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Approval Matrix'
		});
		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF table block Approval Matrix',
			locatorLabel: 'Page 4 · Table Block 2',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Approval Matrix'
		});
	});

	it('prefers hybrid native-layout PDF evidence over OCR-only page evidence for the same page', () => {
		const groups = buildRAGSourceGroups([
			buildSource({
				chunkId: 'ocr-page-lead',
				metadata: {
					ocrEngine: 'hybrid-pdf',
					pageNumber: 2,
					pdfEvidenceMode: 'ocr',
					pdfEvidenceOrigin: 'ocr',
					pdfTextMode: 'ocr',
					sourceNativeKind: 'pdf_page'
				},
				score: 0.96,
				source: 'docs/hybrid.pdf',
				text: 'OCR-only late-page supplement.'
			}),
			buildSource({
				chunkId: 'hybrid-native-lead',
				metadata: {
					pageNumber: 2,
					pdfBlockNumber: 3,
					pdfEvidenceMode: 'hybrid',
					pdfEvidenceOrigin: 'native',
					pdfEvidenceSupplement: 'ocr',
					pdfTextKind: 'paragraph',
					pdfTextMode: 'hybrid',
					sectionKind: 'pdf_block',
					sectionTitle: 'Escalation Matrix'
				},
				score: 0.9,
				source: 'docs/hybrid.pdf',
				text: 'Escalation matrix native block.'
			})
		]);
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'ocr-page-lead',
				metadata: {
					ocrEngine: 'hybrid-pdf',
					pageNumber: 2,
					pdfEvidenceMode: 'ocr',
					pdfEvidenceOrigin: 'ocr',
					pdfTextMode: 'ocr',
					sourceNativeKind: 'pdf_page'
				},
				score: 0.96,
				source: 'docs/hybrid.pdf',
				text: 'OCR-only late-page supplement.'
			}),
			buildSource({
				chunkId: 'hybrid-native-lead',
				metadata: {
					pageNumber: 2,
					pdfBlockNumber: 3,
					pdfEvidenceMode: 'hybrid',
					pdfEvidenceOrigin: 'native',
					pdfEvidenceSupplement: 'ocr',
					pdfTextKind: 'paragraph',
					pdfTextMode: 'hybrid',
					sectionKind: 'pdf_block',
					sectionTitle: 'Escalation Matrix'
				},
				score: 0.9,
				source: 'docs/hybrid.pdf',
				text: 'Escalation matrix native block.'
			})
		]);

		expect(groups[0]?.bestScore).toBe(0.96);
		expect(groups[0]?.labels).toMatchObject({
			contextLabel: 'PDF text block Escalation Matrix',
			locatorLabel: 'Page 2 · Text Block 3',
			provenanceLabel:
				'PDF hybrid · PDF evidence hybrid · PDF origin native · PDF supplement ocr · PDF text block · Source-aware PDF block Escalation Matrix'
		});
		expect(summaries[0]).toMatchObject({
			contextLabel: 'PDF text block Escalation Matrix',
			locatorLabel: 'Page 2 · Text Block 3',
			provenanceLabel:
				'PDF hybrid · PDF evidence hybrid · PDF origin native · PDF supplement ocr · PDF text block · Source-aware PDF block Escalation Matrix'
		});
	});

	it('builds chunk, window, and section excerpts from section-local navigation', () => {
		const excerpts = buildRAGChunkExcerpts(
			[
				buildSource({
					chunkId: 'chunk-1',
					metadata: {
						nextChunkId: 'chunk-2',
						sectionChunkCount: 3,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 0,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk one carries the stable lane introduction.'
				}),
				buildSource({
					chunkId: 'chunk-2',
					metadata: {
						nextChunkId: 'chunk-3',
						previousChunkId: 'chunk-1',
						sectionChunkCount: 3,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 1,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk two carries the approval gate details.'
				}),
				buildSource({
					chunkId: 'chunk-3',
					metadata: {
						previousChunkId: 'chunk-2',
						sectionChunkCount: 3,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 2,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk three carries the incident review detail.'
				})
			],
			'chunk-2'
		);

		expect(excerpts).toMatchObject({
			chunkExcerpt: 'Chunk two carries the approval gate details.',
			windowExcerpt:
				'Chunk one carries the stable lane introduction. Chunk two carries the approval gate details. Chunk three carries the incident review detail.',
			sectionExcerpt:
				'Chunk one carries the stable lane introduction. Chunk two carries the approval gate details. Chunk three carries the incident review detail.'
		});
	});

	it('builds an active-centered excerpt window across a larger related section', () => {
		const excerpts = buildRAGChunkExcerpts(
			[
				buildSource({
					chunkId: 'chunk-1',
					metadata: {
						nextChunkId: 'chunk-2',
						sectionChunkCount: 5,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 0,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk one introduces the stable lane.'
				}),
				buildSource({
					chunkId: 'chunk-2',
					metadata: {
						nextChunkId: 'chunk-3',
						previousChunkId: 'chunk-1',
						sectionChunkCount: 5,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 1,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk two describes the approval gate.'
				}),
				buildSource({
					chunkId: 'chunk-3',
					metadata: {
						nextChunkId: 'chunk-4',
						previousChunkId: 'chunk-2',
						sectionChunkCount: 5,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 2,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk three explains the incident threshold.'
				}),
				buildSource({
					chunkId: 'chunk-4',
					metadata: {
						nextChunkId: 'chunk-5',
						previousChunkId: 'chunk-3',
						sectionChunkCount: 5,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 3,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk four records the handoff readiness details.'
				}),
				buildSource({
					chunkId: 'chunk-5',
					metadata: {
						previousChunkId: 'chunk-4',
						sectionChunkCount: 5,
						sectionChunkId: 'section:stable-lane',
						sectionChunkIndex: 4,
						sectionPath: ['Release Operations', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'Chunk five captures the post-release follow-up.'
				})
			],
			'chunk-3'
		);

		expect(excerpts?.windowExcerpt).toBe(
			'Chunk one introduces the stable lane. Chunk two describes the approval gate. Chunk three explains the incident threshold. Chunk four records the handoff readiness details. Chunk five captures the post-release follow-up.'
		);
		expect(excerpts?.sectionExcerpt).toBe(excerpts?.windowExcerpt);
	});

	it('prefers a section excerpt when a grouped chunk excerpt is too narrow', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'chunk-1',
				metadata: {
					nextChunkId: 'chunk-2',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-a:section:stable',
					sectionChunkIndex: 0,
					sectionPath: ['Release Operations', 'Stable Lane'],
					sectionTitle: 'Stable Lane'
				},
				score: 0.91,
				source: 'docs/a.md',
				text: 'Blocked.'
			}),
			buildSource({
				chunkId: 'chunk-2',
				metadata: {
					previousChunkId: 'chunk-1',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-a:section:stable',
					sectionChunkIndex: 1,
					sectionPath: ['Release Operations', 'Stable Lane'],
					sectionTitle: 'Stable Lane'
				},
				score: 0.85,
				source: 'docs/a.md',
				text: 'Approval remains pending until the stable gate recovers.'
			})
		]);

		expect(summaries[0]?.excerpt).toBe(
			'Blocked. Approval remains pending until the stable gate recovers.'
		);
		expect(summaries[0]?.excerpts?.chunkExcerpt).toBe('Blocked.');
		expect(summaries[0]?.excerptSelection).toMatchObject({
			mode: 'section',
			reason: 'section_small_enough'
		});
	});

	it('builds grounding references with metadata-aware context labels', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'chunk-a',
				metadata: {
					nextChunkId: 'chunk-b',
					page: 4,
					sectionChunkCount: 2,
					sectionChunkId: 'pdf:page:4',
					sectionChunkIndex: 0
				},
				score: 0.91,
				source: 'docs/guide.pdf',
				text: 'Grounding excerpt from a PDF page.'
			}),
			buildSource({
				chunkId: 'chunk-b',
				metadata: {
					page: 4,
					previousChunkId: 'chunk-a',
					sectionChunkCount: 2,
					sectionChunkId: 'pdf:page:4',
					sectionChunkIndex: 1,
					sheetName: 'Revenue'
				},
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
		expect(references[0]?.excerpts).toMatchObject({
			chunkExcerpt: 'Grounding excerpt from a PDF page.',
			sectionExcerpt:
				'Grounding excerpt from a PDF page. Grounding excerpt from a spreadsheet.',
			windowExcerpt:
				'Grounding excerpt from a PDF page. Grounding excerpt from a spreadsheet.'
		});
		expect(references[0]?.excerptSelection).toMatchObject({
			mode: 'section',
			reason: 'section_small_enough'
		});
		expect(references[1]).toMatchObject({
			chunkId: 'chunk-b',
			contextLabel: 'Page 4',
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
				chunkId: 'chunk-pdf-region',
				metadata: {
					ocrEngine: 'demo_pdf_ocr',
					ocrRegionConfidence: 0.91,
					pageNumber: 7,
					pdfTextMode: 'ocr',
					regionNumber: 2
				},
				score: 0.89,
				source: 'files/native-handbook.pdf',
				text: 'Region-level diagnostics stay inspectable in the OCR layer.'
			}),
			buildSource({
				chunkId: 'chunk-media',
				metadata: {
					endMs: 34500,
					mediaKind: 'audio',
					mediaSegmentGroupIndex: 4,
					mediaSegmentGroupSize: 3,
					mediaChannel: 'left',
					mediaDurationMs: 34500,
					mediaSegmentCount: 3,
					mediaSpeakerCount: 2,
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
		expect(references[1]?.locatorLabel).toBe('Page 7 · Region 2');
		expect(references[1]?.provenanceLabel).toContain('PDF ocr');
		expect(references[1]?.provenanceLabel).toContain('Confidence 0.91');
		expect(references[2]?.locatorLabel).toBe(
			'Timestamp 00:12.000 - 00:34.500'
		);
		expect(references[2]?.provenanceLabel).toContain('Media audio');
		expect(references[2]?.provenanceLabel).toContain('3 grouped segments');
		expect(references[2]?.provenanceLabel).toContain('Segment group 5');
		expect(references[2]?.provenanceLabel).toContain('Channel left');
		expect(references[2]?.provenanceLabel).toContain('3 segments');
		expect(references[2]?.provenanceLabel).toContain('2 speakers');
		expect(references[2]?.provenanceLabel).toContain('Duration 00:34.500');
		expect(references[2]?.provenanceLabel).toContain(
			'Transcript demo_media_transcriber'
		);
	});

	it('surfaces hybrid pdf evidence provenance directly in labels', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				pageNumber: 1,
				pdfEvidenceMode: 'hybrid',
				pdfEvidenceOrigin: 'native',
				pdfEvidenceSupplement: 'ocr',
				pdfTextKind: 'paragraph',
				pdfTextMode: 'hybrid',
				sectionKind: 'pdf_block',
				sectionTitle: 'Release Readiness'
			},
			source: 'docs/hybrid.pdf'
		});

		expect(labels).toMatchObject({
			contextLabel: 'PDF text block Release Readiness',
			locatorLabel: 'Page 1',
			provenanceLabel:
				'PDF hybrid · PDF evidence hybrid · PDF origin native · PDF supplement ocr · PDF text block · Source-aware PDF block Release Readiness'
		});
	});

	it('builds source labels from section-aware chunk metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				chunkingProfile: 'markdown-source-aware',
				extractorRegistryMatch: 'markdown-registry-override',
				sourceAwareChunkReason: 'section_boundary',
				sectionPath: ['Release Ops Overview', 'Stable blockers'],
				sectionTitle: 'Stable blockers'
			},
			source: 'docs/release.html',
			title: 'docs-release-html · Stable blockers'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Section Stable blockers',
			locatorLabel: 'Section Release Ops Overview > Stable blockers',
			provenanceLabel:
				'Extractor markdown-registry-override · Chunking markdown-source-aware · Chunk boundary section · Source-aware section Release Ops Overview > Stable blockers'
		});
	});

	it('includes source-aware size-limit reasons in provenance labels', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				chunkingProfile: 'markdown-source-aware',
				sourceAwareChunkReason: 'size_limit',
				sectionPath: ['Release Ops Overview', 'Stable blockers'],
				sectionTitle: 'Stable blockers'
			},
			source: 'docs/release.html'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Section Stable blockers',
			locatorLabel: 'Section Release Ops Overview > Stable blockers',
			provenanceLabel:
				'Chunking markdown-source-aware · Chunk boundary size limit · Source-aware section Release Ops Overview > Stable blockers'
		});
	});

	it('builds source labels from block-aware pdf metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				pageNumber: 2,
				pdfBlockNumber: 3,
				pdfTextKind: 'table_like',
				pdfTextMode: 'native',
				sectionKind: 'pdf_block',
				sectionTitle: 'Page 2 Table Block'
			},
			source: 'docs/report.pdf'
		});

		expect(labels).toMatchObject({
			contextLabel: 'PDF table block Page 2 Table Block',
			locatorLabel: 'Page 2 · Table Block 3',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Page 2 Table Block'
		});
	});

	it('adds row ranges to block-aware pdf table locator labels', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				pageNumber: 2,
				pdfBlockNumber: 3,
				pdfTableBodyRowEnd: 4,
				pdfTableBodyRowStart: 3,
				pdfTextKind: 'table_like',
				pdfTextMode: 'native',
				sectionKind: 'pdf_block',
				sectionTitle: 'Approval Matrix Table'
			},
			source: 'docs/report.pdf'
		});

		expect(labels).toMatchObject({
			contextLabel: 'PDF table block Approval Matrix Table',
			locatorLabel: 'Page 2 · Table Block 3 · Rows 3-4',
			provenanceLabel:
				'PDF native · PDF table block · Source-aware PDF table block Approval Matrix Table · PDF table rows 3-4'
		});
	});

	it('builds source labels from block-aware office metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				officeBlockKind: 'list',
				officeBlockNumber: 2,
				officeListGroupItemCount: 2,
				officeListLevels: [0, 1],
				sectionKind: 'office_block',
				sectionPath: ['Release Checklist'],
				sectionTitle: 'Release Checklist'
			},
			source: 'docs/checklist.docx'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Office list block Release Checklist',
			locatorLabel: 'Office list block 2',
			provenanceLabel:
				'Office list · Office list 2 items · Office list levels 0-1 · Source-aware office list block Release Checklist'
		});
	});

	it('builds source labels from block-aware office table metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				officeBlockKind: 'table',
				officeBlockNumber: 8,
				officeTableBodyRowCount: 2,
				officeTableBodyRowEnd: 2,
				officeTableBodyRowStart: 1,
				officeTableColumnCount: 2,
				officeTableContextText:
					'Use this table to track lane readiness by environment.',
				officeTableHeaders: ['Environment', 'Status'],
				sectionKind: 'office_block',
				sectionPath: ['Release Checklist'],
				sectionTitle: 'Release Checklist'
			},
			source: 'docs/checklist.docx'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Office table block Release Checklist',
			locatorLabel: 'Office table block 8 · Rows 1-2',
			provenanceLabel:
				'Office table · Source-aware office table block Release Checklist · Office table Environment, Status · Office table 2 cols · Office table 2 body rows · Office table rows 1-2 · Office table context Use this table to track lane readiness by environment.'
		});
	});

	it('keeps same-name office table grounding labels distinct across heading scopes', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-stable',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 6,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Evidence Table'],
					sectionTitle: 'Evidence Table'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Stable evidence table slice'
			}),
			buildSource({
				chunkId: 'office-ready',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 11,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track ready evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: ['Ready Lane', 'Evidence Table'],
					sectionTitle: 'Evidence Table'
				},
				score: 0.89,
				source: 'docs/scope-slices.docx',
				text: 'Ready evidence table slice'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office table block Stable Lane > Evidence Table'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Evidence Table'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office table block Ready Lane > Evidence Table'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office table block Ready Lane > Evidence Table'
		);
	});

	it('keeps same-name office checklist grounding labels distinct across heading scopes', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-stable-list',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 4,
					officeListContextText:
						'Use this checklist to verify stable ownership before rollout.\n\nOnly promote stable evidence that already matches the blocked rollout state.',
					officeListGroupItemCount: 2,
					officeListLevels: [0, 1],
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Checklist'],
					sectionTitle: 'Checklist'
				},
				score: 0.88,
				source: 'docs/scope-slices.docx',
				text: 'Attach stable evidence'
			}),
			buildSource({
				chunkId: 'office-ready-list',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 10,
					officeListContextText:
						'Use this checklist to verify ready ownership before handoff.\n\nOnly promote ready evidence that already matches the handoff state.',
					officeListGroupItemCount: 2,
					officeListLevels: [0, 1],
					sectionKind: 'office_block',
					sectionPath: ['Ready Lane', 'Checklist'],
					sectionTitle: 'Checklist'
				},
				score: 0.86,
				source: 'docs/scope-slices.docx',
				text: 'Attach ready evidence'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office list block Stable Lane > Checklist'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office list block Stable Lane > Checklist'
		);
		expect(references[0]?.provenanceLabel).toContain('Office list 2 items');
		expect(references[0]?.provenanceLabel).toContain(
			'Office list levels 0-1'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Office list context Use this checklist to verify stable ownership before rollout.'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Only promote stable evidence that already matches the blocked rollout state.'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office list block Ready Lane > Checklist'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office list block Ready Lane > Checklist'
		);
		expect(references[1]?.provenanceLabel).toContain('Office list 2 items');
		expect(references[1]?.provenanceLabel).toContain(
			'Office list levels 0-1'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Office list context Use this checklist to verify ready ownership before handoff.'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Only promote ready evidence that already matches the handoff state.'
		);
	});

	it('keeps same-name office checklist grounding labels distinct inside one repeated subsection branch', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-review-notes-1',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 41,
					officeListContextText:
						'Keep stable duplicate note packets scoped to the first repeated review notes branch.',
					officeListGroupItemCount: 2,
					officeListLevels: [0, 1],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes'
					],
					sectionTitle: 'Review Notes'
				},
				score: 0.82,
				source: 'docs/scope-slices.docx',
				text: 'Attach stable duplicate note evidence'
			}),
			buildSource({
				chunkId: 'office-review-notes-2',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 44,
					officeListContextText:
						'Keep stable final note packets scoped to the second repeated review notes branch.',
					officeListGroupItemCount: 2,
					officeListLevels: [0, 1],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)'
					],
					sectionTitle: 'Review Notes (2)'
				},
				score: 0.8,
				source: 'docs/scope-slices.docx',
				text: 'Attach stable final note evidence'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office list block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office list block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office list block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2)'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office list block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2)'
		);
	});

	it('keeps same-name office paragraph grounding labels distinct inside one repeated subsection branch', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-review-notes-paragraph-1',
				metadata: {
					officeBlockKind: 'paragraph',
					officeBlockNumber: 40,
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes'
					],
					sectionTitle: 'Review Notes'
				},
				score: 0.82,
				source: 'docs/scope-slices.docx',
				text: 'Stable duplicate review note paragraph'
			}),
			buildSource({
				chunkId: 'office-review-notes-paragraph-2',
				metadata: {
					officeBlockKind: 'paragraph',
					officeBlockNumber: 43,
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)'
					],
					sectionTitle: 'Review Notes (2)'
				},
				score: 0.8,
				source: 'docs/scope-slices.docx',
				text: 'Stable final review note paragraph'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2)'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2)'
		);
	});

	it('keeps same-name office table grounding labels distinct inside one repeated subsection branch', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-review-notes-table-1',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 45,
					officeTableBodyRowCount: 2,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable duplicate note evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.8,
				source: 'docs/scope-slices.docx',
				text: 'Stable duplicate note table hit'
			}),
			buildSource({
				chunkId: 'office-review-notes-table-2',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 49,
					officeTableBodyRowCount: 2,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable final note evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.78,
				source: 'docs/scope-slices.docx',
				text: 'Stable final note table hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes > Evidence Table'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes > Evidence Table'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Evidence Table'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Evidence Table'
		);
	});

	it('keeps deep same-name office table grounding labels distinct inside repeated review notes second branches', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-closure-notes-table-1',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 58,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable first closure evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)',
						'Closure Notes',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.76,
				source: 'docs/scope-slices.docx',
				text: 'Stable first closure table hit'
			}),
			buildSource({
				chunkId: 'office-closure-notes-table-2',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 62,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable second closure evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)',
						'Closure Notes (2)',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.75,
				source: 'docs/scope-slices.docx',
				text: 'Stable second closure table hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Evidence Table'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Evidence Table'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Evidence Table'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Evidence Table'
		);
	});

	for (const familyOrdinal of Array.from(
		{ length: 11 },
		(_, index) => index + 2
	)) {
		const ordinalLabel = `ordinal ${familyOrdinal} disambiguated sibling`;
		const title =
			familyOrdinal === 1
				? 'Evidence Table'
				: `Evidence Table (${familyOrdinal})`;
		const scoreBase = 0.76 - familyOrdinal * 0.02;

		it(`keeps ${ordinalLabel} office table families distinct inside closure notes branches`, () => {
			const references = buildRAGGroundingReferences([
				buildRepeatedClosureOfficeSource({
					branchOrdinal: 1,
					chunkId: `office-closure-notes-${familyOrdinal}-table-1`,
					familyName: 'Evidence Table',
					familyOrdinal,
					score: scoreBase,
					text: `Stable closure branch 1 ${title} hit`
				}),
				buildRepeatedClosureOfficeSource({
					branchOrdinal: 2,
					chunkId: `office-closure-notes-${familyOrdinal}-table-2`,
					familyName: 'Evidence Table',
					familyOrdinal,
					score: scoreBase - 0.01,
					text: `Stable closure branch 2 ${title} hit`
				})
			]);

			expect(references[0]?.contextLabel).toBe(
				`Office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > ${title}`
			);
			expect(references[1]?.contextLabel).toBe(
				`Office table block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > ${title}`
			);
		});
	}

	it('prefers deeper lineage-aware spreadsheet table leads in grouped source summaries', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'spreadsheet-shallow',
				metadata: {
					sectionFamilyPath: ['Release Tracker', 'Spreadsheet Table'],
					sectionKind: 'spreadsheet_rows',
					sectionOrdinalPath: [1, 2],
					sectionSiblingFamilyKey: 'Spreadsheet Table',
					sectionSiblingOrdinal: 2,
					sheetName: 'Release Tracker',
					spreadsheetHeaders: ['Owner', 'Status'],
					spreadsheetTableCount: 2,
					spreadsheetTableIndex: 2
				},
				score: 0.93,
				source: 'docs/tracker.xlsx',
				text: 'Spreadsheet shallow table hit'
			}),
			buildSource({
				chunkId: 'spreadsheet-deep',
				metadata: {
					sectionFamilyPath: [
						'Release Tracker',
						'Operations',
						'Spreadsheet Table'
					],
					sectionKind: 'spreadsheet_rows',
					sectionOrdinalPath: [1, 1, 2],
					sectionSiblingFamilyKey: 'Spreadsheet Table',
					sectionSiblingOrdinal: 2,
					sheetName: 'Release Tracker',
					spreadsheetHeaders: ['Owner', 'Status'],
					spreadsheetTableCount: 2,
					spreadsheetTableIndex: 2
				},
				score: 0.91,
				source: 'docs/tracker.xlsx',
				text: 'Spreadsheet deep table hit'
			})
		]);

		expect(summaries[0]?.excerpt).toContain('Spreadsheet deep table hit');
	});

	it('prefers deeper lineage-aware spreadsheet table citations in grounding references', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'spreadsheet-shallow-citation',
				metadata: {
					sectionFamilyPath: ['Release Tracker', 'Spreadsheet Table'],
					sectionKind: 'spreadsheet_rows',
					sectionOrdinalPath: [1, 2],
					sectionSiblingFamilyKey: 'Spreadsheet Table',
					sectionSiblingOrdinal: 2,
					sheetName: 'Release Tracker',
					spreadsheetHeaders: ['Owner', 'Status'],
					spreadsheetTableCount: 2,
					spreadsheetTableIndex: 2
				},
				score: 0.93,
				source: 'docs/tracker.xlsx',
				text: 'Spreadsheet shallow table hit'
			}),
			buildSource({
				chunkId: 'spreadsheet-deep-citation',
				metadata: {
					sectionFamilyPath: [
						'Release Tracker',
						'Operations',
						'Spreadsheet Table'
					],
					sectionKind: 'spreadsheet_rows',
					sectionOrdinalPath: [1, 1, 2],
					sectionSiblingFamilyKey: 'Spreadsheet Table',
					sectionSiblingOrdinal: 2,
					sheetName: 'Release Tracker',
					spreadsheetHeaders: ['Owner', 'Status'],
					spreadsheetTableCount: 2,
					spreadsheetTableIndex: 2
				},
				score: 0.91,
				source: 'docs/tracker.xlsx',
				text: 'Spreadsheet deep table hit'
			})
		]);

		expect(references[0]?.chunkId).toBe('spreadsheet-deep-citation');
	});

	it('prefers deeper office table citations when only generic lineage metadata is present', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-generic-shallow-citation',
				metadata: {
					officeBlockKind: 'table',
					sectionFamilyPath: ['Stable Lane', 'Evidence Table'],
					sectionKind: 'office_block',
					sectionOrdinalPath: [1, 1],
					sectionPath: ['Stable Lane', 'Evidence Table'],
					sectionSiblingFamilyKey: 'Evidence Table',
					sectionSiblingOrdinal: 1,
					sectionTitle: 'Evidence Table'
				},
				score: 0.94,
				source: 'docs/release-scope.docx',
				text: 'Shallow office table lineage hit'
			}),
			buildSource({
				chunkId: 'office-generic-deep-citation',
				metadata: {
					officeBlockKind: 'table',
					sectionFamilyPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Table'
					],
					sectionKind: 'office_block',
					sectionOrdinalPath: [1, 1, 1],
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Table'
					],
					sectionSiblingFamilyKey: 'Evidence Table',
					sectionSiblingOrdinal: 1,
					sectionTitle: 'Evidence Table'
				},
				score: 0.92,
				source: 'docs/release-scope.docx',
				text: 'Deep office table lineage hit'
			})
		]);

		expect(references[0]?.chunkId).toBe('office-generic-deep-citation');
	});

	it('keeps disambiguated sibling office checklist families distinct inside closure notes branches', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-closure-notes-checklist-1',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 66,
					officeListContextText:
						'Use this checklist to verify stable sibling closure before sibling evidence routing.',
					officeListGroupItemCount: 2,
					officeListLevels: [0, 1],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)',
						'Closure Notes',
						'Checklist (2)'
					],
					sectionTitle: 'Checklist (2)'
				},
				score: 0.72,
				source: 'docs/scope-slices.docx',
				text: 'Attach stable sibling closure evidence'
			}),
			buildSource({
				chunkId: 'office-closure-notes-checklist-2',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 78,
					officeListContextText:
						'Use this checklist to verify stable second sibling closure before sibling evidence routing.',
					officeListGroupItemCount: 2,
					officeListLevels: [0, 1],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes (2)',
						'Closure Notes (2)',
						'Checklist (2)'
					],
					sectionTitle: 'Checklist (2)'
				},
				score: 0.71,
				source: 'docs/scope-slices.docx',
				text: 'Attach stable second sibling closure evidence'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office list block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Checklist (2)'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office list block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Checklist (2)'
		);
	});

	it('prefers deeper repeated-scope office table leads in grouped source summaries', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'office-root-evidence',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 11,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Evidence Table'],
					sectionTitle: 'Evidence Table'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'Root evidence table hit'
			}),
			buildSource({
				chunkId: 'office-nested-evidence',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 23,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Only escalate stable validation evidence that already passed blocked-lane review.\n\nEscalate stable validation blockers through the nested evidence path.\n\nUse this table to track stable validation evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Nested evidence table hit'
			})
		]);

		expect(summaries[0]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Table'
		);
		expect(summaries[0]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Table'
		);
	});

	it('prefers deeper repeated-scope office table citations in grounding references', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-root-citation',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 11,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Use this table to track stable evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Evidence Table'],
					sectionTitle: 'Evidence Table'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'Root evidence table hit'
			}),
			buildSource({
				chunkId: 'office-nested-citation',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 23,
					officeTableBodyRowCount: 1,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Only escalate stable validation evidence that already passed blocked-lane review.\n\nEscalate stable validation blockers through the nested evidence path.\n\nUse this table to track stable validation evidence by artifact.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Nested evidence table hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Table'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Table'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office table block Stable Lane > Evidence Table'
		);
	});

	it('prefers deeper repeated-scope office checklist leads in grouped source summaries', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'office-root-checklist',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 7,
					officeListContextText:
						'Use this checklist to verify stable rollout readiness.',
					officeListGroupItemCount: 2,
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Checklist'],
					sectionTitle: 'Checklist'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'Root checklist hit'
			}),
			buildSource({
				chunkId: 'office-nested-checklist',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 19,
					officeListContextText:
						'Only promote stable validation evidence after the nested checklist clears handoff readiness.',
					officeListGroupItemCount: 2,
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Checklist'
					],
					sectionTitle: 'Checklist'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Nested checklist hit'
			})
		]);

		expect(summaries[0]?.contextLabel).toBe(
			'Office list block Stable Lane > Validation Pack > Checklist'
		);
		expect(summaries[0]?.provenanceLabel).toContain(
			'Source-aware office list block Stable Lane > Validation Pack > Checklist'
		);
	});

	it('prefers deeper repeated-scope office checklist citations in grounding references', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-root-checklist-citation',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 7,
					officeListContextText:
						'Use this checklist to verify stable rollout readiness.',
					officeListGroupItemCount: 2,
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Checklist'],
					sectionTitle: 'Checklist'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'Root checklist hit'
			}),
			buildSource({
				chunkId: 'office-nested-checklist-citation',
				metadata: {
					officeBlockKind: 'list',
					officeBlockNumber: 19,
					officeListContextText:
						'Only promote stable validation evidence after the nested checklist clears handoff readiness.',
					officeListGroupItemCount: 2,
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Checklist'
					],
					sectionTitle: 'Checklist'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Nested checklist hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office list block Stable Lane > Validation Pack > Checklist'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office list block Stable Lane > Validation Pack > Checklist'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office list block Stable Lane > Checklist'
		);
	});

	it('prefers deeper repeated-scope office paragraph leads in grouped source summaries', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'office-root-review-notes',
				metadata: {
					officeBlockKind: 'paragraph',
					officeBlockNumber: 9,
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Review Notes'],
					sectionTitle: 'Review Notes'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'Root review notes hit'
			}),
			buildSource({
				chunkId: 'office-nested-review-notes',
				metadata: {
					officeBlockKind: 'paragraph',
					officeBlockNumber: 41,
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes'
					],
					sectionTitle: 'Review Notes'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Nested review notes hit'
			})
		]);

		expect(summaries[0]?.contextLabel).toBe(
			'Office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(summaries[0]?.provenanceLabel).toContain(
			'Source-aware office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
	});

	it('prefers deeper repeated-scope office paragraph citations in grounding references', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-root-review-notes-citation',
				metadata: {
					officeBlockKind: 'paragraph',
					officeBlockNumber: 9,
					sectionKind: 'office_block',
					sectionPath: ['Stable Lane', 'Review Notes'],
					sectionTitle: 'Review Notes'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'Root review notes hit'
			}),
			buildSource({
				chunkId: 'office-nested-review-notes-citation',
				metadata: {
					officeBlockKind: 'paragraph',
					officeBlockNumber: 41,
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Review Notes'
					],
					sectionTitle: 'Review Notes'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Nested review notes hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office paragraph block Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office paragraph block Stable Lane > Review Notes'
		);
	});

	it('keeps disambiguated sibling office table labels distinct inside one repeated subsection', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'office-sibling-table-1',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 58,
					officeTableBodyRowCount: 2,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Keep stable sibling follow-up evidence isolated from the first follow-up evidence table.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Evidence Table'
					],
					sectionTitle: 'Evidence Table'
				},
				score: 0.93,
				source: 'docs/scope-slices.docx',
				text: 'First sibling evidence table hit'
			}),
			buildSource({
				chunkId: 'office-sibling-table-2',
				metadata: {
					officeBlockKind: 'table',
					officeBlockNumber: 67,
					officeTableBodyRowCount: 2,
					officeTableColumnCount: 2,
					officeTableContextText:
						'Keep stable sibling follow-up evidence isolated from the duplicate follow-up evidence table.',
					officeTableHeaders: ['Artifact', 'State'],
					sectionKind: 'office_block',
					sectionPath: [
						'Stable Lane',
						'Validation Pack',
						'Evidence Review (2)',
						'Evidence Table (2)'
					],
					sectionTitle: 'Evidence Table (2)'
				},
				score: 0.91,
				source: 'docs/scope-slices.docx',
				text: 'Second sibling evidence table hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Review (2) > Evidence Table'
		);
		expect(references[1]?.contextLabel).toBe(
			'Office table block Stable Lane > Validation Pack > Evidence Review (2) > Evidence Table (2)'
		);
		expect(references[0]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Review (2) > Evidence Table'
		);
		expect(references[1]?.provenanceLabel).toContain(
			'Source-aware office table block Stable Lane > Validation Pack > Evidence Review (2) > Evidence Table (2)'
		);
	});

	it('surfaces office table follow-up notes in provenance labels', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				officeBlockKind: 'table',
				officeBlockNumber: 71,
				officeTableBodyRowCount: 1,
				officeTableColumnCount: 2,
				officeTableContextText:
					'Record stable sibling follow-up evidence notes after this table before owner routing.',
				officeTableFollowUpText:
					'Archive stable sibling follow-up owner notes with this table.',
				officeTableHeaders: ['Owner', 'State'],
				sectionKind: 'office_block',
				sectionPath: [
					'Stable Lane',
					'Validation Pack',
					'Evidence Review (2)',
					'Owner Table (2)'
				],
				sectionTitle: 'Owner Table (2)'
			},
			source: 'docs/scope-slices.docx'
		});

		expect(labels?.provenanceLabel).toContain(
			'Office table follow-up Archive stable sibling follow-up owner notes with this table.'
		);
	});

	it('builds source labels from spreadsheet row and header metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				sheetName: 'Release Tracker',
				spreadsheetHeaders: ['Owner', 'Status', 'Due date'],
				spreadsheetRowEnd: 18,
				spreadsheetRowStart: 12
			},
			source: 'docs/tracker.xlsx'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Sheet Release Tracker Rows 12-18',
			locatorLabel: 'Sheet Release Tracker · Rows 12-18',
			provenanceLabel:
				'Source-aware spreadsheet Release Tracker · Spreadsheet Owner, Status, Due date'
		});
	});

	it('builds source labels from spreadsheet table-local metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				sheetName: 'Release Tracker',
				spreadsheetColumnEnd: 'D',
				spreadsheetColumnStart: 'C',
				spreadsheetHeaders: ['Owner', 'Status'],
				spreadsheetRowEnd: 4,
				spreadsheetRowStart: 3,
				spreadsheetTableCount: 2,
				spreadsheetTableIndex: 2
			},
			source: 'docs/tracker.xlsx'
		});

		expect(labels).toMatchObject({
			contextLabel:
				'Sheet Release Tracker Table 2 of 2 Rows 3-4 Columns C-D',
			locatorLabel:
				'Sheet Release Tracker · Table 2 of 2 · Rows 3-4 · Columns C-D',
			provenanceLabel:
				'Source-aware spreadsheet Release Tracker Table 2 of 2 · Spreadsheet Owner, Status · Spreadsheet Columns C-D · Spreadsheet Table 2 of 2'
		});
	});

	it('builds source labels from presentation slide metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				slideNotesText:
					'Review stable blockers before the rollout meeting.',
				slideNumber: 3,
				slideTitle: 'Release handoff summary'
			},
			source: 'slides/release-handoff.pptx'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Slide 3 Release handoff summary',
			locatorLabel: 'Slide 3 · Release handoff summary',
			provenanceLabel: 'Speaker notes'
		});
	});

	it('keeps repeated-title presentation slide citations distinct by slide ordinal', () => {
		const references = buildRAGGroundingReferences([
			buildSource({
				chunkId: 'slide-one-citation',
				metadata: {
					sectionFamilyPath: ['Release handoff summary'],
					sectionKind: 'presentation_slide',
					sectionOrdinalPath: [1],
					sectionSiblingFamilyKey: 'Release handoff summary',
					sectionSiblingOrdinal: 1,
					slideNumber: 1,
					slideTitle: 'Release handoff summary'
				},
				score: 0.93,
				source: 'slides/release-handoff.pptx',
				text: 'Slide one repeated title hit'
			}),
			buildSource({
				chunkId: 'slide-two-citation',
				metadata: {
					sectionFamilyPath: ['Release handoff summary'],
					sectionKind: 'presentation_slide',
					sectionOrdinalPath: [2],
					sectionSiblingFamilyKey: 'Release handoff summary',
					sectionSiblingOrdinal: 2,
					slideNumber: 2,
					slideTitle: 'Release handoff summary'
				},
				score: 0.91,
				source: 'slides/release-handoff.pptx',
				text: 'Slide two repeated title hit'
			}),
			buildSource({
				chunkId: 'slide-three-citation',
				metadata: {
					sectionFamilyPath: ['Release handoff summary'],
					sectionKind: 'presentation_slide',
					sectionOrdinalPath: [3],
					sectionSiblingFamilyKey: 'Release handoff summary',
					sectionSiblingOrdinal: 3,
					slideNumber: 3,
					slideTitle: 'Release handoff summary'
				},
				score: 0.89,
				source: 'slides/release-handoff.pptx',
				text: 'Slide three repeated title hit'
			}),
			buildSource({
				chunkId: 'slide-four-citation',
				metadata: {
					sectionFamilyPath: ['Release handoff summary'],
					sectionKind: 'presentation_slide',
					sectionOrdinalPath: [4],
					sectionSiblingFamilyKey: 'Release handoff summary',
					sectionSiblingOrdinal: 4,
					slideNumber: 4,
					slideTitle: 'Release handoff summary',
					slideNotesText:
						'Use the speaker notes as the primary handoff evidence when the audit handoff slide body is terse.'
				},
				score: 0.88,
				source: 'slides/release-handoff.pptx',
				text: 'Slide four repeated title hit'
			})
		]);

		expect(references[0]?.contextLabel).toBe(
			'Slide 1 · Release handoff summary'
		);
		expect(references[1]?.contextLabel).toBe(
			'Slide 2 · Release handoff summary'
		);
		expect(references[2]?.contextLabel).toBe(
			'Slide 3 · Release handoff summary'
		);
		expect(references[3]?.contextLabel).toBe(
			'Slide 4 · Release handoff summary'
		);
		expect(references[0]?.locatorLabel).toBe(
			'Slide 1 · Release handoff summary'
		);
		expect(references[1]?.locatorLabel).toBe(
			'Slide 2 · Release handoff summary'
		);
		expect(references[2]?.locatorLabel).toBe(
			'Slide 3 · Release handoff summary'
		);
		expect(references[3]?.locatorLabel).toBe(
			'Slide 4 · Release handoff summary'
		);
	});

	it('builds source labels from email thread lineage metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				attachmentName: 'checklist.md',
				emailKind: 'attachment',
				from: 'ops@example.com',
				replyDepth: 2,
				threadMessageCount: 2,
				threadRootMessageId: '<thread-root@example.com>',
				threadTopic: 'Attachment recap'
			},
			source: 'thread.eml#attachments/checklist.md'
		});

		expect(labels).toMatchObject({
			contextLabel:
				'Attachment evidence checklist.md in Attachment recap',
			locatorLabel: 'Attachment checklist.md · Reply depth 2',
			provenanceLabel:
				'Thread Attachment recap · Thread root <thread-root@example.com> · 2 thread messages · Reply depth 2 · Sender ops@example.com'
		});
	});

	it('builds source labels from archive lineage metadata', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				archiveContainerPath: 'nested/inner.zip',
				archiveDepth: 2,
				archiveFullPath: 'nested/inner.zip!docs/guide.md',
				archiveLineage: ['nested', 'inner.zip', 'docs', 'guide.md'],
				archiveNestedDepth: 3,
				archivePath: 'docs/guide.md',
				archiveRootName: 'bundle.zip'
			},
			source: 'bundle.zip#docs/guide.md'
		});

		expect(labels).toMatchObject({
			contextLabel: 'Archive entry nested/inner.zip!docs/guide.md',
			locatorLabel: 'Archive entry nested/inner.zip!docs/guide.md',
			provenanceLabel:
				'Archive depth 2 · Archive nested depth 3 · Archive container nested/inner.zip · Archive root bundle.zip'
		});
	});

	it('builds source labels from OCR page and region metadata', () => {
		const pageLabels = buildRAGSourceLabels({
			metadata: {
				ocrEngine: 'mock-pdf',
				ocrPageAverageConfidence: 0.89,
				ocrRegionCount: 2,
				pageNumber: 1,
				pdfTextMode: 'ocr'
			},
			source: 'docs/scan.pdf'
		});
		const regionLabels = buildRAGSourceLabels({
			metadata: {
				ocrEngine: 'mock-pdf',
				ocrRegionConfidence: 0.91,
				pageNumber: 1,
				pdfTextMode: 'ocr',
				regionNumber: 2
			},
			source: 'docs/scan.pdf'
		});

		expect(pageLabels).toMatchObject({
			contextLabel: 'OCR page 1',
			locatorLabel: 'Page 1',
			provenanceLabel: 'PDF ocr · OCR mock-pdf · Average 0.89 · 2 regions'
		});
		expect(regionLabels).toMatchObject({
			contextLabel: 'OCR page 1 region 2',
			locatorLabel: 'Page 1 · Region 2',
			provenanceLabel: 'PDF ocr · OCR mock-pdf · Confidence 0.91'
		});
	});

	it('builds source labels from OCR document metadata with page spans and confidence ranges', () => {
		const labels = buildRAGSourceLabels({
			metadata: {
				ocrAverageConfidence: 0.88,
				ocrEngine: 'mock-pdf',
				ocrMaxConfidence: 0.93,
				ocrMinConfidence: 0.81,
				ocrPageCount: 2,
				ocrPageEnd: 2,
				ocrPageStart: 1,
				ocrRegionCount: 5,
				pdfTextMode: 'ocr'
			},
			source: 'docs/scan.pdf'
		});

		expect(labels).toMatchObject({
			contextLabel: 'OCR pages 1-2',
			locatorLabel: 'Pages 1-2',
			provenanceLabel:
				'PDF ocr · OCR mock-pdf · Average 0.88 · Range 0.81-0.93 · 5 regions'
		});
	});

	it('builds first-class chunk structure from section-aware metadata', () => {
		const structure = buildRAGChunkStructure({
			nextChunkId: 'docs-release-html:003',
			previousChunkId: 'docs-release-html:001',
			sectionChunkCount: 3,
			sectionChunkId:
				'docs-release-html:section:release-ops-overview-stable-blockers',
			sectionChunkIndex: 1,
			sectionDepth: 2,
			sectionKind: 'html_heading',
			sectionPath: ['Release Ops Overview', 'Stable blockers'],
			sectionTitle: 'Stable blockers'
		});

		expect(structure).toMatchObject({
			section: {
				depth: 2,
				kind: 'html_heading',
				path: ['Release Ops Overview', 'Stable blockers'],
				title: 'Stable blockers'
			},
			sequence: {
				nextChunkId: 'docs-release-html:003',
				previousChunkId: 'docs-release-html:001',
				sectionChunkCount: 3,
				sectionChunkId:
					'docs-release-html:section:release-ops-overview-stable-blockers',
				sectionChunkIndex: 1
			}
		});
	});

	it('builds first-class chunk structure from block-aware metadata', () => {
		const pdfStructure = buildRAGChunkStructure({
			sectionDepth: 1,
			sectionKind: 'pdf_block',
			sectionPath: ['Page 2 Table Block'],
			sectionTitle: 'Page 2 Table Block'
		});
		const officeStructure = buildRAGChunkStructure({
			sectionDepth: 1,
			sectionKind: 'office_block',
			sectionPath: ['Release Checklist'],
			sectionTitle: 'Release Checklist'
		});

		expect(pdfStructure?.section).toMatchObject({
			kind: 'pdf_block',
			path: ['Page 2 Table Block'],
			title: 'Page 2 Table Block'
		});
		expect(officeStructure?.section).toMatchObject({
			kind: 'office_block',
			path: ['Release Checklist'],
			title: 'Release Checklist'
		});
	});

	it('builds a first-class chunk graph from section-aware sources', () => {
		const graph = buildRAGChunkGraph([
			buildSource({
				chunkId: 'docs-release-html:000',
				metadata: {
					sectionChunkCount: 1,
					sectionChunkId:
						'docs-release-html:section:release-ops-overview',
					sectionChunkIndex: 0,
					sectionDepth: 1,
					sectionKind: 'html_heading',
					sectionPath: ['Release Ops Overview'],
					sectionTitle: 'Release Ops Overview'
				},
				score: 0.97,
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'docs-release-html:001',
				metadata: {
					nextChunkId: 'docs-release-html:002',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 0,
					sectionDepth: 2,
					sectionKind: 'html_heading',
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				score: 0.94,
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'docs-release-html:002',
				metadata: {
					previousChunkId: 'docs-release-html:001',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 1,
					sectionDepth: 2,
					sectionKind: 'html_heading',
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				score: 0.91,
				source: 'docs/release.html'
			})
		]);

		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				{
					fromChunkId: 'docs-release-html:000',
					relation: 'section_child',
					toChunkId: 'docs-release-html:001'
				},
				{
					fromChunkId: 'docs-release-html:001',
					relation: 'next',
					toChunkId: 'docs-release-html:002'
				},
				{
					fromChunkId: 'docs-release-html:001',
					relation: 'previous',
					toChunkId: 'docs-release-html:002'
				},
				{
					fromChunkId: 'docs-release-html:001',
					relation: 'section_parent',
					toChunkId: 'docs-release-html:000'
				}
			])
		);
		expect(graph.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					childSectionIds: [
						'docs-release-html:section:stable-blockers'
					],
					chunkCount: 1,
					chunkIds: ['docs-release-html:000'],
					id: 'docs-release-html:section:release-ops-overview',
					leadChunkId: 'docs-release-html:000',
					path: ['Release Ops Overview'],
					title: 'Release Ops Overview'
				}),
				expect.objectContaining({
					childSectionIds: [],
					chunkCount: 2,
					chunkIds: [
						'docs-release-html:001',
						'docs-release-html:002'
					],
					id: 'docs-release-html:section:stable-blockers',
					leadChunkId: 'docs-release-html:001',
					parentSectionId:
						'docs-release-html:section:release-ops-overview',
					path: ['Release Ops Overview', 'Stable blockers'],
					title: 'Stable blockers'
				})
			])
		);
	});

	it('builds a chunk graph directly from chunk preview payloads', () => {
		const graph = buildRAGChunkPreviewGraph({
			chunks: [
				{
					chunkId: 'doc-1:001',
					labels: {
						contextLabel: 'Section Stable blockers',
						locatorLabel:
							'Section Release Ops Overview > Stable blockers'
					},
					source: 'docs/release.html',
					structure: {
						section: {
							path: ['Release Ops Overview', 'Stable blockers'],
							title: 'Stable blockers'
						},
						sequence: {
							nextChunkId: 'doc-1:002',
							sectionChunkCount: 2,
							sectionChunkId: 'doc-1:section:stable-blockers',
							sectionChunkIndex: 0
						}
					},
					text: 'Chunk one',
					title: 'Release guide'
				},
				{
					chunkId: 'doc-1:002',
					source: 'docs/release.html',
					structure: {
						section: {
							path: ['Release Ops Overview', 'Stable blockers'],
							title: 'Stable blockers'
						},
						sequence: {
							previousChunkId: 'doc-1:001',
							sectionChunkCount: 2,
							sectionChunkId: 'doc-1:section:stable-blockers',
							sectionChunkIndex: 1
						}
					},
					text: 'Chunk two',
					title: 'Release guide'
				}
			],
			document: {
				id: 'doc-1',
				source: 'docs/release.html',
				title: 'Release guide'
			}
		});

		expect(graph.sections[0]).toMatchObject({
			chunkCount: 2,
			id: 'doc-1:section:stable-blockers'
		});
		expect(graph.nodes[0]?.locatorLabel).toBe(
			'Section Release Ops Overview > Stable blockers'
		);
	});

	it('builds default chunk navigation from the first available graph node', () => {
		const graph = buildRAGChunkGraph([
			buildSource({
				chunkId: 'docs-release-html:000',
				metadata: {
					sectionChunkCount: 1,
					sectionChunkId:
						'docs-release-html:section:release-ops-overview',
					sectionChunkIndex: 0,
					sectionPath: ['Release Ops Overview'],
					sectionTitle: 'Release Ops Overview'
				},
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'docs-release-html:001',
				metadata: {
					nextChunkId: 'docs-release-html:002',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 0,
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'docs-release-html:002',
				metadata: {
					previousChunkId: 'docs-release-html:001',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 1,
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				source: 'docs/release.html'
			})
		]);
		const navigation = buildRAGChunkGraphNavigation(graph);

		expect(navigation.activeChunkId).toBe('docs-release-html:000');
		expect(navigation.nextNode).toBeUndefined();
		expect(navigation.previousNode).toBeUndefined();
		expect(navigation.section?.id).toBe(
			'docs-release-html:section:release-ops-overview'
		);
		expect(navigation.sectionNodes.map((node) => node.chunkId)).toEqual([
			'docs-release-html:000'
		]);
		expect(navigation.parentSection).toBeUndefined();
		expect(navigation.childSections.map((section) => section.id)).toEqual([
			'docs-release-html:section:stable-blockers'
		]);
	});

	it('builds section hierarchy navigation for nested sections', () => {
		const graph = buildRAGChunkGraph([
			buildSource({
				chunkId: 'docs-release-html:000',
				metadata: {
					sectionChunkCount: 1,
					sectionChunkId:
						'docs-release-html:section:release-ops-overview',
					sectionChunkIndex: 0,
					sectionPath: ['Release Ops Overview'],
					sectionTitle: 'Release Ops Overview'
				},
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'docs-release-html:001',
				metadata: {
					nextChunkId: 'docs-release-html:002',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 0,
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'docs-release-html:002',
				metadata: {
					previousChunkId: 'docs-release-html:001',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 1,
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				source: 'docs/release.html'
			})
		]);
		const navigation = buildRAGChunkGraphNavigation(
			graph,
			'docs-release-html:001'
		);

		expect(navigation.section?.id).toBe(
			'docs-release-html:section:stable-blockers'
		);
		expect(navigation.parentSection?.id).toBe(
			'docs-release-html:section:release-ops-overview'
		);
		expect(navigation.childSections).toEqual([]);
		expect(navigation.sectionNodes.map((node) => node.chunkId)).toEqual([
			'docs-release-html:001',
			'docs-release-html:002'
		]);
	});

	it('builds selected chunk navigation directly from preview payloads', () => {
		const navigation = buildRAGChunkPreviewNavigation(
			{
				chunks: [
					{
						chunkId: 'doc-1:001',
						source: 'docs/release.html',
						structure: {
							section: {
								path: [
									'Release Ops Overview',
									'Stable blockers'
								],
								title: 'Stable blockers'
							},
							sequence: {
								nextChunkId: 'doc-1:002',
								sectionChunkCount: 2,
								sectionChunkId: 'doc-1:section:stable-blockers',
								sectionChunkIndex: 0
							}
						},
						text: 'Chunk one',
						title: 'Release guide'
					},
					{
						chunkId: 'doc-1:002',
						source: 'docs/release.html',
						structure: {
							section: {
								path: [
									'Release Ops Overview',
									'Stable blockers'
								],
								title: 'Stable blockers'
							},
							sequence: {
								previousChunkId: 'doc-1:001',
								sectionChunkCount: 2,
								sectionChunkId: 'doc-1:section:stable-blockers',
								sectionChunkIndex: 1
							}
						},
						text: 'Chunk two',
						title: 'Release guide'
					}
				],
				document: {
					id: 'doc-1',
					source: 'docs/release.html',
					title: 'Release guide'
				}
			},
			'doc-1:002'
		);

		expect(navigation.activeChunkId).toBe('doc-1:002');
		expect(navigation.activeNode?.chunkId).toBe('doc-1:002');
		expect(navigation.previousNode?.chunkId).toBe('doc-1:001');
		expect(navigation.nextNode).toBeUndefined();
		expect(navigation.sectionNodes.map((node) => node.chunkId)).toEqual([
			'doc-1:001',
			'doc-1:002'
		]);
	});

	it('includes locator context in grounding evidence summaries for section-aware chunks', () => {
		const grounded = buildRAGGroundedAnswer(
			'Stable rollout blockers stay visible [1].',
			[
				buildSource({
					chunkId: 'chunk-section',
					labels: {
						contextLabel: 'Section Stable blockers',
						locatorLabel:
							'Section Release Ops Overview > Stable blockers'
					},
					score: 0.91,
					source: 'docs/release.html',
					text: 'Stable rollout blockers stay visible to operators.'
				})
			]
		);

		expect(grounded.parts[1]).toMatchObject({
			referenceDetails: [
				{
					evidenceSummary:
						'docs/release.html · Section Release Ops Overview > Stable blockers · Section Stable blockers'
				}
			]
		});
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
					evidenceSummary: 'docs/guide.pdf · Page 2',
					excerpts: {
						chunkExcerpt:
							'AbsoluteJS keeps citations first-class for grounded answers.'
					},
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
					evidenceSummary: 'docs/report.xlsx · Sheet Revenue',
					number: 2
				}
			],
			referenceNumbers: [2],
			text: '[2]',
			type: 'citation'
		});
		expect(grounded.sectionSummaries).toEqual([
			expect.objectContaining({
				excerpts: expect.objectContaining({
					chunkExcerpt:
						'AbsoluteJS keeps citations first-class for grounded answers.'
				}),
				label: 'Page 2',
				referenceNumbers: [1]
			}),
			expect.objectContaining({
				excerpts: expect.objectContaining({
					chunkExcerpt:
						'Spreadsheet context remains visible in source inspection.'
				}),
				label: 'Sheet Revenue',
				referenceNumbers: [2]
			})
		]);
		expect(grounded.excerptModeCounts).toEqual({
			chunk: 4,
			section: 0,
			window: 0
		});
		expect(grounded.ungroundedReferenceNumbers).toEqual([]);
	});

	it('groups grounding references into section-level answer summaries', () => {
		const summaries = buildRAGGroundedAnswerSectionSummaries([
			{
				chunkId: 'chunk-a',
				contextLabel: 'Section Stable Lane',
				excerpt: 'Stable lane excerpt.',
				label: 'guide/release-hierarchy.md',
				locatorLabel: 'Section Release Operations > Stable Lane',
				number: 1,
				score: 0.91,
				source: 'guide/release-hierarchy.md',
				text: 'Stable lane text.'
			},
			{
				chunkId: 'chunk-b',
				contextLabel: 'Section Stable Lane',
				excerpt: 'Approval gate excerpt.',
				label: 'guide/release-hierarchy.md',
				locatorLabel:
					'Section Release Operations > Stable Lane > Approval Gates',
				number: 2,
				score: 0.87,
				source: 'guide/release-hierarchy.md',
				text: 'Approval gate text.'
			}
		]);

		expect(summaries).toEqual([
			expect.objectContaining({
				count: 2,
				excerpt: 'Stable lane excerpt.',
				excerptSelection: undefined,
				label: 'Section Stable Lane',
				referenceNumbers: [1, 2],
				summary:
					'guide/release-hierarchy.md · Section Release Operations > Stable Lane · Section Stable Lane'
			})
		]);
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
		expect(workflow.groundedAnswer.sectionSummaries).toEqual([
			expect.objectContaining({
				label: 'Page 2',
				referenceNumbers: [1]
			})
		]);
		expect(workflow.excerptModeCounts).toEqual({
			chunk: 4,
			section: 0,
			window: 0
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
						metadata: {
							sectionPath: [
								'Release Ops Overview',
								'Stable Lane'
							],
							sectionTitle: 'Stable Lane'
						},
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
		expect(retrieved?.sourceGroups[0]?.labels).toMatchObject({
			contextLabel: 'Section Stable Lane',
			locatorLabel: 'Section Release Ops Overview > Stable Lane'
		});
		expect(retrieved?.sourceSummaries[0]?.label).toBe('guide/demo.md');
		expect(retrieved?.sectionDiagnostics[0]?.label).toBe('Stable Lane');
		expect(retrieved?.citations[0]?.chunkId).toBe('chunk-new');
		expect(retrieved?.citationReferenceMap['chunk-new']).toBe(1);
		expect(retrieved?.excerptModeCounts).toEqual({
			chunk: 2,
			section: 0,
			window: 0
		});
		expect(retrieved?.groundedAnswer.coverage).toBe('ungrounded');
	});

	it('carries best-hit chunk structure into grouped source summaries', () => {
		const groups = buildRAGSourceGroups([
			buildSource({
				chunkId: 'chunk-section-1',
				metadata: {
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				score: 0.95,
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'chunk-section-2',
				score: 0.7,
				source: 'docs/release.html'
			})
		]);
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'chunk-section-1',
				metadata: {
					nextChunkId: 'chunk-section-2',
					sectionChunkCount: 2,
					sectionChunkId: 'docs-release-html:section:stable-blockers',
					sectionChunkIndex: 0,
					sectionPath: ['Release Ops Overview', 'Stable blockers'],
					sectionTitle: 'Stable blockers'
				},
				score: 0.95,
				source: 'docs/release.html'
			}),
			buildSource({
				chunkId: 'chunk-section-2',
				score: 0.7,
				source: 'docs/release.html'
			})
		]);

		expect(groups[0]?.structure).toMatchObject({
			section: {
				path: ['Release Ops Overview', 'Stable blockers'],
				title: 'Stable blockers'
			}
		});
		expect(summaries[0]?.structure).toMatchObject({
			section: {
				path: ['Release Ops Overview', 'Stable blockers'],
				title: 'Stable blockers'
			},
			sequence: {
				nextChunkId: 'chunk-section-2',
				sectionChunkCount: 2,
				sectionChunkId: 'docs-release-html:section:stable-blockers',
				sectionChunkIndex: 0
			}
		});
	});

	it('builds section-level retrieval diagnostics with sibling comparison', () => {
		const diagnostics = buildRAGSectionRetrievalDiagnostics(
			[
				buildSource({
					chunkId: 'stable-a',
					metadata: {
						retrievalQueryOrigin: 'transformed',
						retrievalChannels: ['vector', 'lexical'],
						sourceAwareChunkReason: 'section_boundary',
						sectionPath: ['Release Ops Overview', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					score: 0.96,
					source: 'docs/release-hierarchy.md'
				}),
				buildSource({
					chunkId: 'stable-b',
					metadata: {
						retrievalQueryOrigin: 'variant',
						retrievalChannels: ['vector'],
						sectionPath: ['Release Ops Overview', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					score: 0.91,
					source: 'docs/release-hierarchy.md'
				}),
				buildSource({
					chunkId: 'canary-a',
					metadata: {
						retrievalQueryOrigin: 'primary',
						retrievalChannels: ['lexical'],
						sectionPath: ['Release Ops Overview', 'Canary Lane'],
						sectionTitle: 'Canary Lane'
					},
					score: 0.62,
					source: 'docs/release-hierarchy.md'
				})
			],
			{
				candidateTopK: 6,
				lexicalTopK: 6,
				mode: 'hybrid',
				query: 'release ops',
				resultCounts: {
					final: 3,
					fused: 3,
					lexical: 2,
					reranked: 3,
					vector: 2
				},
				runLexical: true,
				runVector: true,
				steps: [
					{
						count: 2,
						label: 'Collected vector candidates',
						sectionCounts: [
							{
								count: 2,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 1.87
							}
						],
						stage: 'vector_search'
					},
					{
						count: 2,
						label: 'Collected lexical candidates',
						sectionCounts: [
							{
								count: 1,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							},
							{
								count: 1,
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 0.91
							},
							{
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane',
								totalScore: 0.62
							}
						],
						stage: 'lexical_search'
					},
					{
						count: 3,
						label: 'Fused retrieval candidates',
						sectionCounts: [
							{
								count: 2,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							},
							{
								count: 1,
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 1.87
							},
							{
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane',
								totalScore: 0.62
							}
						],
						stage: 'fusion'
					},
					{
						count: 3,
						label: 'Reranked retrieval candidates',
						metadata: { applied: true },
						sectionCounts: [
							{
								count: 2,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							},
							{
								count: 1,
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 1.87
							},
							{
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane',
								totalScore: 0.62
							}
						],
						stage: 'rerank'
					},
					{
						count: 3,
						label: 'Balanced candidates across sources',
						metadata: { strategy: 'round_robin' },
						sectionCounts: [
							{
								count: 2,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							},
							{
								count: 1,
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 1.87
							},
							{
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane',
								totalScore: 0.62
							}
						],
						stage: 'source_balance'
					},
					{
						count: 3,
						label: 'Preferred stronger structured evidence within matching sections',
						metadata: {
							affectedScopes: 1,
							reorderedResults: 2
						},
						sectionCounts: [
							{
								count: 2,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							},
							{
								count: 1,
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 1.87
							},
							{
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane',
								totalScore: 0.62
							}
						],
						stage: 'evidence_reconcile'
					},
					{
						count: 3,
						label: 'Finalized retrieval results',
						sectionCounts: [
							{
								count: 2,
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane'
							},
							{
								count: 1,
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane'
							}
						],
						sectionScores: [
							{
								key: 'Release Ops Overview > Stable Lane',
								label: 'Stable Lane',
								totalScore: 1.87
							},
							{
								key: 'Release Ops Overview > Canary Lane',
								label: 'Canary Lane',
								totalScore: 0.62
							}
						],
						stage: 'finalize'
					}
				],
				topK: 3,
				transformedQuery: 'release ops',
				variantQueries: []
			}
		);

		expect(diagnostics[0]).toMatchObject({
			label: 'Stable Lane',
			lexicalHits: 1,
			parentLabel: 'Release Ops Overview',
			parentDistribution: [
				expect.objectContaining({
					isActive: true,
					label: 'Stable Lane'
				}),
				expect.objectContaining({
					isActive: false,
					label: 'Canary Lane'
				})
			],
			retrievalMode: 'hybrid',
			evidenceReconcileApplied: true,
			rerankApplied: true,
			sourceBalanceApplied: true,
			firstSeenStage: 'vector_search',
			lastSeenStage: 'finalize',
			count: 2,
			sourceCount: 1,
			sourceAwareChunkReasonLabel: 'Chunk boundary section',
			sourceAwareUnitScopeLabel:
				'Source-aware section Release Ops Overview > Stable Lane',
			topContextLabel: 'Section Stable Lane',
			topLocatorLabel: 'Section Release Ops Overview > Stable Lane',
			strongestSiblingLabel: 'Canary Lane',
			topChunkId: 'stable-a',
			vectorHits: 2,
			hybridHits: 1
		});
		expect(diagnostics[0]?.reasons).toEqual(
			expect.arrayContaining([
				'best_hit',
				'multi_hit_section',
				'dominant_within_parent',
				'concentrated_evidence'
			])
		);
		expect(diagnostics[0]?.scoreShare).toBeGreaterThan(0.7);
		expect(diagnostics[0]?.parentShare).toBeGreaterThan(0.7);
		expect(diagnostics[0]?.parentShareGap).toBeGreaterThan(0.4);
		expect(diagnostics[0]?.peakStage).toBe('vector_search');
		expect(diagnostics[0]?.peakCount).toBe(2);
		expect(diagnostics[0]?.finalCount).toBe(2);
		expect(diagnostics[0]?.finalRetentionRate).toBe(1);
		expect(diagnostics[0]?.dropFromPeak).toBe(0);
		expect(diagnostics[0]?.summary).toContain(
			'boundary Chunk boundary section'
		);
		expect(diagnostics[0]?.summary).toContain(
			'scope Source-aware section Release Ops Overview > Stable Lane'
		);
		expect(diagnostics[0]?.queryAttribution).toEqual({
			mode: 'mixed',
			primaryHits: 0,
			reasons: [
				'mixed_query_sources',
				'variant_supported',
				'transform_introduced'
			],
			transformedHits: 1,
			variantHits: 1
		});
		expect(diagnostics[0]?.stageCounts).toEqual([
			{ count: 2, stage: 'vector_search' },
			{ count: 1, stage: 'lexical_search' },
			{ count: 2, stage: 'fusion' },
			{ count: 2, stage: 'rerank' },
			{ count: 2, stage: 'source_balance' },
			{ count: 2, stage: 'evidence_reconcile' },
			{ count: 2, stage: 'finalize' }
		]);
		expect(diagnostics[0]?.stageWeights).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					count: 2,
					stage: 'vector_search',
					stageScoreShare: 1,
					stageShare: 1,
					totalScore: 1.87,
					parentStageShare: 1,
					parentStageScoreShare: 1,
					reasons: [],
					stageShareGap: undefined,
					parentStageShareGap: undefined,
					strongestSiblingCount: undefined,
					strongestSiblingLabel: undefined
				}),
				expect.objectContaining({
					count: 1,
					countDelta: -1,
					retentionRate: 0.5,
					stage: 'lexical_search',
					stageScoreShare: expect.closeTo(0.5947712418300654, 12),
					stageShare: 0.5,
					totalScore: 0.91,
					parentStageShare: 0.5,
					parentStageScoreShare: expect.closeTo(
						0.5947712418300654,
						12
					),
					reasons: ['stage_runner_up_pressure', 'stage_narrowed'],
					stageScoreShareGap: expect.closeTo(0.18954248366013066, 12),
					stageShareGap: 0,
					parentStageShareGap: 0,
					previousCount: 2,
					previousStage: 'vector_search',
					strongestSiblingCount: 1,
					strongestSiblingLabel: 'Canary Lane'
				}),
				expect.objectContaining({
					count: 2,
					countDelta: 1,
					retentionRate: 2,
					stage: 'fusion',
					stageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					stageShare: 2 / 3,
					totalScore: 1.87,
					parentStageShare: 2 / 3,
					parentStageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					reasons: ['stage_expanded'],
					stageScoreShareGap: expect.closeTo(
						(1.87 - 0.62) / 2.49,
						12
					),
					stageShareGap: 1 / 3,
					parentStageShareGap: 1 / 3,
					previousCount: 1,
					previousStage: 'lexical_search',
					strongestSiblingCount: 1,
					strongestSiblingLabel: 'Canary Lane'
				}),
				expect.objectContaining({
					count: 2,
					countDelta: 0,
					retentionRate: 1,
					stage: 'rerank',
					stageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					stageShare: 2 / 3,
					totalScore: 1.87,
					parentStageShare: 2 / 3,
					parentStageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					reasons: ['rerank_preserved_lead', 'stage_held'],
					stageScoreShareGap: expect.closeTo(
						(1.87 - 0.62) / 2.49,
						12
					),
					stageShareGap: 1 / 3,
					parentStageShareGap: 1 / 3,
					previousCount: 2,
					previousStage: 'fusion',
					strongestSiblingCount: 1,
					strongestSiblingLabel: 'Canary Lane'
				}),
				expect.objectContaining({
					count: 2,
					countDelta: 0,
					retentionRate: 1,
					stage: 'source_balance',
					stageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					stageShare: 2 / 3,
					totalScore: 1.87,
					parentStageShare: 2 / 3,
					parentStageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					reasons: ['stage_held'],
					stageScoreShareGap: expect.closeTo(
						(1.87 - 0.62) / 2.49,
						12
					),
					stageShareGap: 1 / 3,
					parentStageShareGap: 1 / 3,
					previousCount: 2,
					previousStage: 'rerank',
					strongestSiblingCount: 1,
					strongestSiblingLabel: 'Canary Lane'
				}),
				expect.objectContaining({
					count: 2,
					countDelta: 0,
					retentionRate: 1,
					stage: 'evidence_reconcile',
					stageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					stageShare: 2 / 3,
					totalScore: 1.87,
					parentStageShare: 2 / 3,
					parentStageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					reasons: ['stage_held'],
					stageScoreShareGap: expect.closeTo(
						(1.87 - 0.62) / 2.49,
						12
					),
					stageShareGap: 1 / 3,
					parentStageShareGap: 1 / 3,
					previousCount: 2,
					previousStage: 'source_balance',
					strongestSiblingCount: 1,
					strongestSiblingLabel: 'Canary Lane'
				}),
				expect.objectContaining({
					count: 2,
					countDelta: 0,
					retentionRate: 1,
					stage: 'finalize',
					stageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					stageShare: 2 / 3,
					totalScore: 1.87,
					parentStageShare: 2 / 3,
					parentStageScoreShare: expect.closeTo(1.87 / 2.49, 12),
					reasons: [
						'final_stage_concentration',
						'final_stage_dominant_within_parent',
						'stage_held'
					],
					stageScoreShareGap: expect.closeTo(
						(1.87 - 0.62) / 2.49,
						12
					),
					stageShareGap: 1 / 3,
					parentStageShareGap: 1 / 3,
					previousCount: 2,
					previousStage: 'evidence_reconcile',
					strongestSiblingCount: 1,
					strongestSiblingLabel: 'Canary Lane'
				})
			])
		);
	});

	it('mentions block-aware winning evidence in section retrieval summaries', () => {
		const diagnostics = buildRAGSectionRetrievalDiagnostics([
			buildSource({
				chunkId: 'pdf-block-lead',
				metadata: {
					pageNumber: 2,
					pdfBlockNumber: 3,
					pdfTextKind: 'table_like',
					pdfTextMode: 'native',
					retrievalChannels: ['vector'],
					sectionKind: 'pdf_block',
					sectionPath: ['Page 2 Table Block'],
					sectionTitle: 'Page 2 Table Block'
				},
				score: 0.97,
				source: 'docs/report.pdf',
				text: 'Metric | Status'
			}),
			buildSource({
				chunkId: 'pdf-block-peer',
				metadata: {
					retrievalChannels: ['lexical'],
					sectionKind: 'pdf_block',
					sectionPath: ['Page 2 Table Block'],
					sectionTitle: 'Page 2 Table Block'
				},
				score: 0.72,
				source: 'docs/report.pdf',
				text: 'Approval | Blocked'
			})
		]);

		expect(diagnostics[0]?.summary).toContain(
			'PDF table block Page 2 Table Block'
		);
	});

	it('weights structured block evidence in section aggregation', () => {
		const diagnostics = buildRAGSectionRetrievalDiagnostics([
			buildSource({
				chunkId: 'generic-paragraph',
				metadata: {
					retrievalChannels: ['vector'],
					sectionKind: 'html_heading',
					sectionPath: ['Release Notes', 'Overview'],
					sectionTitle: 'Overview'
				},
				score: 1,
				source: 'docs/release-notes.html',
				text: 'General release overview paragraph.'
			}),
			buildSource({
				chunkId: 'pdf-table-block',
				metadata: {
					pageNumber: 4,
					pdfBlockNumber: 2,
					pdfTextKind: 'table_like',
					retrievalChannels: ['vector'],
					sectionKind: 'pdf_block',
					sectionPath: ['Release Notes', 'Approval Matrix'],
					sectionTitle: 'Approval Matrix'
				},
				score: 0.9,
				source: 'docs/release-notes.pdf',
				text: 'Lane | Status'
			})
		]);

		expect(diagnostics[0]?.label).toBe('Approval Matrix');
		expect(diagnostics[0]?.summary).toContain(
			'PDF table block Approval Matrix'
		);
		expect(diagnostics[0]?.scoreShare).toBeGreaterThan(
			diagnostics[1]?.scoreShare ?? 0
		);
		expect(diagnostics[0]?.reasons).toContain('dominant_within_parent');
	});

	it('prefers presentation slide evidence in grouped source summaries', () => {
		const summaries = buildRAGSourceSummaries([
			buildSource({
				chunkId: 'generic-slide-paragraph',
				metadata: {
					sectionKind: 'html_heading',
					sectionPath: ['Release packet', 'Overview'],
					sectionTitle: 'Overview'
				},
				score: 0.96,
				source: 'slides/release-handoff.pptx',
				text: 'General rollout overview paragraph.'
			}),
			buildSource({
				chunkId: 'slide-structured-hit',
				metadata: {
					sectionKind: 'presentation_slide',
					sectionPath: ['Release handoff summary'],
					sectionTitle: 'Release handoff summary',
					slideNotesText:
						'Review stable blockers before the rollout meeting.',
					slideNumber: 3,
					slideTitle: 'Release handoff summary'
				},
				score: 0.91,
				source: 'slides/release-handoff.pptx',
				text: 'Release handoff summary\nStable blockers\nSpeaker notes: Review stable blockers before the rollout meeting.'
			})
		]);

		expect(summaries[0]?.contextLabel).toBe(
			'Slide 3 Release handoff summary'
		);
		expect(summaries[0]?.locatorLabel).toBe(
			'Slide 3 · Release handoff summary'
		);
		expect(summaries[0]?.provenanceLabel).toContain('Speaker notes');
	});

	it('weights presentation slide evidence in section aggregation', () => {
		const diagnostics = buildRAGSectionRetrievalDiagnostics([
			buildSource({
				chunkId: 'generic-overview',
				metadata: {
					retrievalChannels: ['vector'],
					sectionKind: 'html_heading',
					sectionPath: ['Release packet', 'Overview'],
					sectionTitle: 'Overview'
				},
				score: 1,
				source: 'slides/release-handoff-notes.md',
				text: 'General release overview paragraph.'
			}),
			buildSource({
				chunkId: 'slide-notes-hit',
				metadata: {
					retrievalChannels: ['vector'],
					sectionKind: 'presentation_slide',
					sectionPath: ['Release handoff summary'],
					sectionTitle: 'Release handoff summary',
					slideNotesText:
						'Review stable blockers before the rollout meeting.',
					slideNumber: 3,
					slideTitle: 'Release handoff summary'
				},
				score: 0.88,
				source: 'slides/release-handoff.pptx',
				text: 'Release handoff summary\nStable blockers\nSpeaker notes: Review stable blockers before the rollout meeting.'
			})
		]);

		expect(diagnostics[0]?.label).toBe('Release handoff summary');
		expect(diagnostics[0]?.summary).toContain(
			'Slide 3 Release handoff summary'
		);
		expect(diagnostics[0]?.scoreShare).toBeGreaterThan(
			diagnostics[1]?.scoreShare ?? 0
		);
	});

	it('treats sections as mixed when a surviving hit carries multiple query origins', () => {
		const diagnostics = buildRAGSectionRetrievalDiagnostics([
			buildSource({
				chunkId: 'regional-growth-mixed',
				metadata: {
					retrievalChannels: ['vector', 'lexical'],
					retrievalQueryOrigin: 'primary',
					retrievalQueryOrigins: ['primary', 'variant'],
					sectionPath: [
						'Query Attribution Guide',
						'Regional Growth Workbook'
					],
					sectionTitle: 'Regional Growth Workbook'
				},
				score: 0.96,
				source: 'guide/query-attribution.md'
			})
		]);

		expect(diagnostics[0]?.queryAttribution).toEqual({
			mode: 'mixed',
			primaryHits: 1,
			reasons: ['mixed_query_sources', 'variant_supported'],
			transformedHits: 0,
			variantHits: 1
		});
	});

	it('carries routing context into section retrieval diagnostics', () => {
		const diagnostics = buildRAGSectionRetrievalDiagnostics(
			[
				{
					chunkId: 'alpha',
					metadata: {
						sectionPath: ['Stable Lane', 'Approval Gates']
					},
					score: 0.92,
					source: 'guide/release-hierarchy.md',
					text: 'Approval gates stay visible.'
				}
			],
			{
				candidateTopK: 8,
				lexicalTopK: 4,
				mode: 'hybrid',
				query: 'approval gates',
				queryTransformLabel: 'Spreadsheet rewrite',
				queryTransformProvider: 'heuristic_transform',
				queryTransformReason: 'spreadsheet terms detected',
				requestedMode: 'vector',
				resultCounts: {
					final: 1,
					fused: 1,
					lexical: 0,
					reranked: 1,
					vector: 1
				},
				routingLabel: 'Source-native hybrid route',
				routingProvider: 'heuristic_retrieval_strategy',
				routingReason:
					'query expansion introduced source-native variants',
				runLexical: true,
				runVector: true,
				steps: [
					{
						label: 'Routing',
						metadata: {
							selectedMode: 'hybrid'
						},
						stage: 'routing'
					},
					{
						label: 'Rerank',
						metadata: {
							applied: true
						},
						stage: 'rerank'
					}
				],
				topK: 1,
				transformedQuery: 'approval gates workbook',
				variantQueries: ['approval gates worksheet']
			}
		);

		expect(diagnostics[0]).toEqual(
			expect.objectContaining({
				queryTransformLabel: 'Spreadsheet rewrite',
				queryTransformProvider: 'heuristic_transform',
				queryTransformReason: 'spreadsheet terms detected',
				requestedMode: 'vector',
				retrievalMode: 'hybrid',
				routingLabel: 'Source-native hybrid route',
				routingProvider: 'heuristic_retrieval_strategy',
				routingReason:
					'query expansion introduced source-native variants'
			})
		);
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

	it('builds reusable retrieval trace presentation rows', () => {
		const presentation = buildRAGRetrievalTracePresentation({
			candidateTopK: 8,
			lexicalTopK: 4,
			mode: 'hybrid',
			query: 'alpha',
			queryTransformLabel: 'Spreadsheet rewrite',
			queryTransformProvider: 'heuristic_transform',
			queryTransformReason: 'spreadsheet terms detected',
			resultCounts: {
				final: 3,
				fused: 3,
				lexical: 2,
				reranked: 3,
				vector: 5
			},
			requestedMode: 'vector',
			routingLabel: 'Source-native hybrid route',
			routingProvider: 'heuristic_retrieval_strategy',
			routingReason: 'query expansion introduced source-native variants',
			runLexical: true,
			runVector: true,
			steps: [
				{
					count: 3,
					label: 'Fusion',
					metadata: {
						algorithm: 'rrf',
						sqliteQueryBackfillCount: 1,
						sqliteQueryBackfillLimitReached: true,
						sqliteQueryMinResultsSatisfied: true,
						sqliteQueryCandidateBudgetExhausted: true,
						sqliteQueryCandidateCoverage: 'under_target',
						sqliteQueryFilteredCandidates: 12,
						sqliteQueryFinalSearchK: 12,
						sqliteQueryInitialSearchK: 6,
						sqliteQuerySearchExpansionRatio: 2,
						sqliteQueryJsRemainderClauseCount: 1,
						sqliteQueryPlannerProfileUsed: 'latency',
						sqliteQueryCandidateLimitUsed: 9,
						sqliteQueryFillPolicyUsed: 'strict_topk',
						sqliteQueryMaxBackfillsUsed: 2,
						sqliteQueryMinResultsUsed: 2,
						sqliteQueryMultiplierUsed: 4,
						sqliteQueryJsRemainderRatio: 1 / 3,
						sqliteQueryMode: 'native_vec0',
						sqliteQueryPushdownApplied: true,
						sqliteQueryPushdownClauseCount: 2,
						sqliteQueryPushdownCoverageRatio: 2 / 3,
						sqliteQueryPushdownMode: 'partial',
						sqliteQueryReturnedCount: 2,
						sqliteQueryCandidateYieldRatio: 2 / 12,
						sqliteQueryTopKFillRatio: 2 / 3,
						sqliteQueryTotalFilterClauseCount: 3,
						sqliteQueryUnderfilledTopK: true,
						postgresQueryBackfillCount: 0,
						postgresQueryBackfillLimitReached: true,
						postgresQueryMinResultsSatisfied: true,
						postgresQueryCandidateBudgetExhausted: false,
						postgresQueryCandidateCoverage: 'under_target',
						postgresQueryFilteredCandidates: 3,
						postgresQueryFinalSearchK: 3,
						postgresQueryInitialSearchK: 3,
						postgresQuerySearchExpansionRatio: 1,
						postgresQueryJsRemainderClauseCount: 2,
						postgresQueryPlannerProfileUsed: 'recall',
						postgresQueryCandidateLimitUsed: 5,
						postgresQueryFillPolicyUsed: 'satisfy_min_results',
						postgresQueryMaxBackfillsUsed: 1,
						postgresQueryMinResultsUsed: 1,
						postgresQueryMultiplierUsed: 6,
						postgresQueryJsRemainderRatio: 1,
						postgresQueryMode: 'native_pgvector',
						postgresQueryPushdownApplied: false,
						postgresQueryPushdownClauseCount: 0,
						postgresQueryPushdownCoverageRatio: 0,
						postgresQueryPushdownMode: 'none',
						postgresQueryReturnedCount: 1,
						postgresQueryCandidateYieldRatio: 1 / 3,
						postgresQueryTopKFillRatio: 0.5,
						postgresQueryTotalFilterClauseCount: 2,
						postgresQueryUnderfilledTopK: true,
						postgresEstimatedRowCount: 1200,
						postgresIndexBytes: 786432,
						postgresIndexName:
							'public_rag_chunks_embedding_hnsw_idx',
						postgresIndexPresent: true,
						postgresIndexStorageRatio: 0.75,
						postgresIndexType: 'hnsw',
						postgresTableBytes: 262144,
						postgresTotalBytes: 1048576,
						sourceAwareChunkReason: 'size_limit',
						sources: 2
					},
					stage: 'fusion'
				}
			],
			topK: 3,
			transformedQuery: 'alpha rewritten',
			variantQueries: ['alpha alt']
		});

		expect(presentation.stats).toEqual(
			expect.arrayContaining([
				{ label: 'Mode', value: 'hybrid' },
				{ label: 'Final Results', value: '3' }
			])
		);
		expect(presentation.details).toEqual(
			expect.arrayContaining([
				{ label: 'Query transform', value: 'Spreadsheet rewrite' },
				{
					label: 'Query transform reason',
					value: 'spreadsheet terms detected'
				},
				{ label: 'Requested mode', value: 'vector' },
				{
					label: 'Routing decision',
					value: 'Source-native hybrid route'
				},
				{
					label: 'Routing reason',
					value: 'query expansion introduced source-native variants'
				},
				{ label: 'Candidate topK', value: '8' },
				{ label: 'Variant queries', value: 'alpha alt' }
			])
		);
		expect(presentation.steps[0]).toMatchObject({
			label: 'Fusion',
			stage: 'fusion'
		});
		expect(presentation.steps[0]?.rows).toEqual(
			expect.arrayContaining([
				{ label: 'stage', value: 'fusion' },
				{ label: 'algorithm', value: 'rrf' },
				{
					label: 'SQLite planner cues',
					value: expect.stringContaining('mode native_vec0')
				},
				{
					label: 'Postgres planner cues',
					value: expect.stringContaining('index-heavy storage')
				},
				{ label: 'SQLite query mode', value: 'native_vec0' },
				{ label: 'Postgres query mode', value: 'native_pgvector' },
				{ label: 'Postgres index type', value: 'hnsw' },
				{
					label: 'Postgres index name',
					value: 'public_rag_chunks_embedding_hnsw_idx'
				},
				{ label: 'Postgres index present', value: 'true' },
				{ label: 'Postgres estimated rows', value: '1200' },
				{ label: 'Postgres table bytes', value: '262144' },
				{ label: 'Postgres index bytes', value: '786432' },
				{ label: 'Postgres total bytes', value: '1048576' },
				{ label: 'Postgres index storage ratio', value: '0.75' },
				{ label: 'SQLite pushdown mode', value: 'partial' },
				{ label: 'Postgres pushdown mode', value: 'none' },
				{ label: 'SQLite pushdown applied', value: 'true' },
				{ label: 'Postgres pushdown applied', value: 'false' },
				{ label: 'SQLite pushdown clauses', value: '2' },
				{ label: 'Postgres pushdown clauses', value: '0' },
				{
					label: 'SQLite pushdown coverage',
					value: '0.6666666666666666'
				},
				{ label: 'Postgres pushdown coverage', value: '0' },
				{ label: 'SQLite total filter clauses', value: '3' },
				{ label: 'Postgres total filter clauses', value: '2' },
				{ label: 'SQLite JS remainder clauses', value: '1' },
				{ label: 'Postgres JS remainder clauses', value: '2' },
				{ label: 'SQLite query profile', value: 'latency' },
				{ label: 'SQLite query multiplier', value: '4' },
				{ label: 'SQLite candidate limit', value: '9' },
				{ label: 'SQLite fill policy', value: 'strict_topk' },
				{ label: 'SQLite max backfills', value: '2' },
				{ label: 'SQLite min results', value: '2' },
				{ label: 'Postgres query profile', value: 'recall' },
				{ label: 'Postgres query multiplier', value: '6' },
				{ label: 'Postgres candidate limit', value: '5' },
				{ label: 'Postgres fill policy', value: 'satisfy_min_results' },
				{ label: 'Postgres max backfills', value: '1' },
				{ label: 'Postgres min results', value: '1' },
				{
					label: 'SQLite JS remainder share',
					value: '0.3333333333333333'
				},
				{ label: 'Postgres JS remainder share', value: '1' },
				{ label: 'SQLite filtered candidates', value: '12' },
				{ label: 'Postgres filtered candidates', value: '3' },
				{ label: 'SQLite initial searchK', value: '6' },
				{ label: 'Postgres initial searchK', value: '3' },
				{ label: 'SQLite final searchK', value: '12' },
				{ label: 'Postgres final searchK', value: '3' },
				{ label: 'SQLite search expansion', value: '2' },
				{ label: 'Postgres search expansion', value: '1' },
				{ label: 'SQLite backfill count', value: '1' },
				{ label: 'SQLite backfill limit reached', value: 'true' },
				{ label: 'SQLite min results satisfied', value: 'true' },
				{ label: 'Postgres backfill count', value: '0' },
				{ label: 'Postgres backfill limit reached', value: 'true' },
				{ label: 'Postgres min results satisfied', value: 'true' },
				{ label: 'SQLite returned hits', value: '2' },
				{ label: 'Postgres returned hits', value: '1' },
				{
					label: 'SQLite candidate yield',
					value: '0.16666666666666666'
				},
				{
					label: 'Postgres candidate yield',
					value: '0.3333333333333333'
				},
				{ label: 'SQLite topK fill rate', value: '0.6666666666666666' },
				{ label: 'Postgres topK fill rate', value: '0.5' },
				{ label: 'SQLite underfilled topK', value: 'true' },
				{ label: 'Postgres underfilled topK', value: 'true' },
				{
					label: 'SQLite candidate budget exhausted',
					value: 'true'
				},
				{
					label: 'Postgres candidate budget exhausted',
					value: 'false'
				},
				{ label: 'SQLite candidate coverage', value: 'under_target' },
				{ label: 'Postgres candidate coverage', value: 'under_target' },
				{
					label: 'sourceAwareChunkReason',
					value: 'Chunk boundary size limit'
				},
				{ label: 'sources', value: '2' }
			])
		);
		expect(presentation.steps[0]?.rows).toEqual(
			expect.arrayContaining([{ label: 'sources', value: '2' }])
		);

		const mediaCuePresentation = buildRAGRetrievalTracePresentation({
			query: 'alpha',
			mode: 'hybrid',
			transformedQuery: 'alpha',
			variantQueries: [],
			candidateTopK: 4,
			lexicalTopK: 2,
			runLexical: true,
			runVector: true,
			topK: 1,
			resultCounts: {
				final: 1,
				fused: 2,
				lexical: 1,
				reranked: 2,
				vector: 2
			},
			steps: [
				{
					count: 2,
					label: 'Reranked retrieval candidates',
					metadata: {
						applied: true,
						leadSpeakerCue: 'Alex',
						leadChannelCue: 'left',
						leadContinuityCue: 'immediate_prior'
					},
					stage: 'rerank'
				}
			]
		});
		expect(mediaCuePresentation.steps[0]?.rows).toEqual(
			expect.arrayContaining([
				{ label: 'Lead speaker cue', value: 'Alex' },
				{ label: 'Lead channel cue', value: 'left' },
				{
					label: 'Lead continuity cue',
					value: 'Immediate prior segment'
				}
			])
		);

		const quotedSpeakerPresentation = buildRAGRetrievalTracePresentation({
			query: 'alpha',
			mode: 'hybrid',
			transformedQuery: 'alpha',
			variantQueries: [],
			candidateTopK: 4,
			lexicalTopK: 2,
			runLexical: true,
			runVector: true,
			topK: 1,
			resultCounts: {
				final: 1,
				fused: 2,
				lexical: 1,
				reranked: 2,
				vector: 2
			},
			steps: [
				{
					count: 2,
					label: 'Reranked retrieval candidates',
					metadata: {
						applied: true,
						leadSpeakerCue: 'Alex K',
						leadSpeakerAttributionCue: 'quoted_match'
					},
					stage: 'rerank'
				}
			]
		});
		expect(quotedSpeakerPresentation.steps[0]?.rows).toEqual(
			expect.arrayContaining([
				{ label: 'Lead speaker cue', value: 'Alex K' },
				{
					label: 'Lead speaker attribution',
					value: 'Quoted speaker match'
				}
			])
		);

		const quotedChannelPresentation = buildRAGRetrievalTracePresentation({
			query: 'alpha',
			mode: 'hybrid',
			transformedQuery: 'alpha',
			variantQueries: [],
			candidateTopK: 4,
			lexicalTopK: 2,
			runLexical: true,
			runVector: true,
			topK: 1,
			resultCounts: {
				final: 1,
				fused: 2,
				lexical: 1,
				reranked: 2,
				vector: 2
			},
			steps: [
				{
					count: 2,
					label: 'Reranked retrieval candidates',
					metadata: {
						applied: true,
						leadChannelCue: 'left',
						leadChannelAttributionCue: 'quoted_match'
					},
					stage: 'rerank'
				}
			]
		});
		expect(quotedChannelPresentation.steps[0]?.rows).toEqual(
			expect.arrayContaining([
				{ label: 'Lead channel cue', value: 'left' },
				{
					label: 'Lead channel attribution',
					value: 'Quoted channel match'
				}
			])
		);

		const variantPresentation = buildRAGRetrievalTracePresentation({
			query: 'alpha',
			mode: 'hybrid',
			transformedQuery: 'alpha',
			variantQueries: ['a', 'b'],
			topK: 2,
			candidateTopK: 2,
			lexicalTopK: 0,
			runVector: true,
			runLexical: false,
			resultCounts: {
				final: 2,
				fused: 2,
				lexical: 0,
				reranked: 2,
				vector: 2
			},
			steps: [
				{
					label: 'Query transform',
					metadata: {
						variants: 'a, b'
					},
					stage: 'query_transform'
				}
			]
		});
		expect(variantPresentation.steps[0]?.rows).toEqual(
			expect.arrayContaining([{ label: 'variants', value: 'a, b' }])
		);
	});

	it('builds semantic admin job and action presentations', () => {
		const jobs = buildRAGAdminJobPresentations([
			{
				action: 'sync_source',
				elapsedMs: 206,
				id: 'job-1',
				startedAt: 1,
				status: 'completed',
				target: 'gmail://support/refunds'
			}
		]);
		const actions = buildRAGAdminActionPresentations([
			{
				action: 'delete_document',
				documentId: 'doc-1',
				elapsedMs: 14,
				id: 'action-1',
				startedAt: 1,
				status: 'failed',
				error: 'missing document'
			}
		]);

		expect(jobs[0]?.summary).toContain('COMPLETED');
		expect(jobs[0]?.summary).toContain('sync source');
		expect(jobs[0]?.rows).toEqual(
			expect.arrayContaining([
				{ label: 'Target', value: 'gmail://support/refunds' }
			])
		);
		expect(actions[0]?.summary).toContain('FAILED');
		expect(actions[0]?.rows).toEqual(
			expect.arrayContaining([
				{ label: 'Document', value: 'doc-1' },
				{ label: 'Error', value: 'missing document' }
			])
		);
	});
});
