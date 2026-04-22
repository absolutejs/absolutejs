import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import {
	createHeuristicRAGQueryTransform,
	createHeuristicRAGRetrievalStrategy,
	createHeuristicRAGReranker,
	createRAGCollection,
	ingestRAGDocuments
} from '../../../../src/ai';
import { createSQLiteRAGStore } from '../../../../src/ai/rag/adapters/sqlite';
import { createPostgresRAGStore } from '../../../../src/ai/rag/adapters/postgres';
import { createRAGEmbeddingProvider } from '../../../../src/ai/rag/embedding';
import { createInMemoryRAGStore } from '../../../../src/ai/rag/adapters/inMemory';
import type { RAGQueryInput, RAGVectorStore } from '../../../../types/ai';
import {
	MIXED_MAILBOX_BRANCH_KEYS,
	MIXED_MAILBOX_BRANCH_PATHS,
	MIXED_MAILBOX_BRANCH_STATE_FLAG_SETS,
	MIXED_MAILBOX_CONVERSATION_DRIFT_KEYS,
	MIXED_MAILBOX_CONVERSATION_ID_DRIFT_KEYS,
	MIXED_MAILBOX_DEEP_CHILD_KEYS,
	MIXED_MAILBOX_INLINE_RESOURCE_KEYS,
	MIXED_MAILBOX_MESSAGE_DRIFT_KEYS,
	MIXED_MAILBOX_NESTED_REPLY_KEYS,
	MIXED_MAILBOX_PARENT_DRIFT_KEYS,
	MIXED_MAILBOX_QUOTED_HISTORY_KEYS,
	MIXED_MAILBOX_REFERENCE_DRIFT_KEYS,
	MIXED_MAILBOX_REPLY_SPECS,
	MIXED_MAILBOX_ROOT_DRIFT_KEYS,
	MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
	MIXED_MAILBOX_THREAD_INDEX_DRIFT_KEYS,
	mixedMailboxExpectedChildSource,
	mixedMailboxExpectedDeepChildSource,
	mixedMailboxExpectedNestedReplySource,
	mixedMailboxFolder,
	mixedMailboxFamilyKey,
	RECOVERED_PST_BRANCH_KEYS,
	RECOVERED_PST_CASE_KEYS,
	RECOVERED_PST_FAMILY_KEYS,
	recoveredPstMailboxMetadata,
	recoveredPstMessageAttachmentSource,
	recoveredPstStateCue,
	recoveredPstStateFlags
} from './emailMailboxAdversary';

const POSTGRES_URL =
	process.env.RAG_POSTGRES_TEST_URL ??
	process.env.RAG_POSTGRES_URL ??
	process.env.DATABASE_URL ??
	'postgres://postgres:postgres@localhost:55433/absolute_rag_demo';

const canConnectToPostgres = async () => {
	try {
		const db = new Bun.SQL(POSTGRES_URL);
		await db`select 1 as ok`;
		await db.close?.();
		return true;
	} catch {
		return false;
	}
};

const postgresAvailable = await canConnectToPostgres();
const itIfPostgres = postgresAvailable ? it : it.skip;
const openPostgresStores: Array<ReturnType<typeof createPostgresRAGStore>> = [];
const trackPostgresStore = (
	store: ReturnType<typeof createPostgresRAGStore>
) => {
	openPostgresStores.push(store);
	return store;
};

const multivectorParityEmbedding = async (text: string) => {
	if (text === 'Which aurora launch packet phrase shows exact wording?') {
		return [1, 0];
	}
	if (text === 'Generic operational summary.') {
		return [1, 0];
	}
	if (text === 'release-readiness callouts and operator recovery drills') {
		return [0, 1];
	}

	return [0.9, 0.1];
};

const buildMultivectorParityChunks = () => [
	{
		chunkId: 'generic:001',
		embedding: [1, 0] as number[],
		text: 'Generic operational summary.'
	},
	{
		chunkId: 'target:001',
		embedding: [0, 1] as number[],
		metadata: { documentId: 'target' },
		source: 'guide/multivector-release-guide.md',
		text: 'release-readiness callouts and operator recovery drills',
		embeddingVariants: [
			{
				embedding: [0.9, 0.1] as number[],
				id: 'launch-checklist',
				label: 'Launch checklist',
				text: 'aurora launch packet sign-off checklist'
			}
		]
	}
];

const buildRepeatedClosureOfficeMetadata = ({
	blockKind = 'table',
	branchOrdinal,
	familyName,
	familyOrdinal
}: {
	blockKind?: 'list' | 'paragraph' | 'table';
	branchOrdinal: number;
	familyName: string;
	familyOrdinal: number;
}) => {
	const closureTitle =
		branchOrdinal === 1
			? 'Closure Notes'
			: `Closure Notes (${branchOrdinal})`;
	const familyTitle =
		familyOrdinal === 1 ? familyName : `${familyName} (${familyOrdinal})`;

	return {
		officeBlockKind: blockKind,
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
	};
};

const buildRecoveredPstMailboxMetadata = ({
	caseKey,
	containerSource,
	ordinal
}: {
	caseKey: string;
	containerSource: string;
	ordinal: number;
}) => ({
	...recoveredPstMailboxMetadata({
		caseKey,
		containerSource,
		ordinal
	})
});

const assertMultivectorRerankParity = async ({
	store
}: {
	store: RAGVectorStore;
}) => {
	const collection = createRAGCollection({
		rerank: createHeuristicRAGReranker(),
		store
	});

	await collection.ingest({
		chunks: buildMultivectorParityChunks()
	});

	const traced = await collection.searchWithTrace({
		query: 'Which aurora launch packet phrase shows exact wording?',
		retrieval: 'vector',
		topK: 1
	});

	expect(traced.results[0]?.chunkId).toBe('target:001');
	expect(traced.results[0]?.metadata).toEqual(
		expect.objectContaining({
			multivectorMatchedVariantId: 'launch-checklist',
			multivectorMatchedVariantLabel: 'Launch checklist',
			multivectorMatchedVariantText:
				'aurora launch packet sign-off checklist'
		})
	);
	expect(traced.trace.multiVector).toEqual(
		expect.objectContaining({
			collapsedParents: 1,
			configured: true,
			vectorVariantHits: 1
		})
	);
	expect(
		traced.trace.steps.find((step) => step.stage === 'rerank')?.metadata
	).toEqual(
		expect.objectContaining({
			leadMultivectorVariantCue: 'phrase_match',
			leadMultivectorVariantId: 'launch-checklist',
			leadMultivectorVariantLabel: 'Launch checklist'
		})
	);
};

afterEach(async () => {
	while (openPostgresStores.length > 0) {
		await openPostgresStores.pop()?.close?.();
	}
});

describe('createRAGCollection', () => {
	it('passes store status and capabilities through the collection', () => {
		const store = createInMemoryRAGStore({ dimensions: 16 });
		const collection = createRAGCollection({ store });

		expect(collection.getCapabilities?.()).toEqual({
			backend: 'in_memory',
			nativeVectorSearch: false,
			persistence: 'memory_only',
			serverSideFiltering: false,
			streamingIngestStatus: false
		});
		expect(collection.getStatus?.()).toEqual({
			backend: 'in_memory',
			dimensions: 16,
			vectorMode: 'in_memory'
		});
	});

	it('applies collection-level score filtering above the store', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'alpha') return [1, 0];
				if (text === 'beta') return [0, 1];
				if (text === 'query') return [1, 0];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({
			defaultTopK: 5,
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'a', text: 'alpha' },
				{ chunkId: 'b', text: 'beta' }
			]
		});

		const results = await collection.search({
			query: 'query',
			scoreThreshold: 0.9
		});

		expect(results.map((entry) => entry.chunkId)).toEqual(['a']);
	});

	it('prefers native-layout hybrid pdf evidence over ocr-only page hits within the same page scope', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'ocr-page',
					chunkText: 'OCR-only late-page supplement.',
					metadata: {
						pageNumber: 2,
						pdfEvidenceMode: 'ocr',
						pdfEvidenceOrigin: 'ocr',
						pdfTextMode: 'ocr',
						sourceNativeKind: 'pdf_page'
					},
					score: 0.96,
					source: 'docs/hybrid.pdf'
				},
				{
					chunkId: 'hybrid-native',
					chunkText: 'Escalation matrix native block.',
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
					source: 'docs/hybrid.pdf'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'who owns escalation',
			retrieval: 'vector',
			topK: 1
		});

		expect(traced.results[0]?.chunkId).toBe('hybrid-native');
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toMatchObject({
			label: 'Preferred native-layout PDF evidence within matching sections',
			metadata: {
				affectedScopes: 1,
				officeAffectedScopes: 0,
				pdfAffectedScopes: 1,
				reorderedResults: 2
			}
		});
	});

	it('prefers deeper repeated-scope office table evidence within the same source and title', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'root-evidence-table',
					chunkText: 'Stable lane evidence table root scope.',
					metadata: {
						officeBlockKind: 'table',
						officeTableContextText:
							'Use this table to track stable lane evidence.',
						sectionKind: 'office_block',
						sectionPath: ['Stable Lane', 'Evidence Table'],
						sectionTitle: 'Evidence Table'
					},
					score: 0.93,
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'nested-evidence-table',
					chunkText: 'Stable lane validation pack evidence table.',
					metadata: {
						officeBlockKind: 'table',
						officeTableContextText:
							'Use this table to track stable validation evidence.',
						sectionKind: 'office_block',
						sectionPath: [
							'Stable Lane',
							'Validation Pack',
							'Evidence Table'
						],
						sectionTitle: 'Evidence Table'
					},
					score: 0.91,
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which evidence table covers stable validation artifacts',
			retrieval: 'vector',
			topK: 1
		});

		expect(traced.results[0]?.chunkId).toBe('nested-evidence-table');
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toMatchObject({
			label: 'Preferred deeper office-structure evidence within matching sections',
			metadata: {
				affectedScopes: 2,
				officeAffectedScopes: 2,
				officeTableAffectedScopes: 2,
				pdfAffectedScopes: 0,
				reorderedResults: 2
			}
		});
	});

	it('prefers deeper repeated-scope office checklist evidence within the same source and title', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'root-checklist',
					chunkText: 'Stable lane checklist root scope.',
					metadata: {
						officeBlockKind: 'list',
						officeListContextText:
							'Use this checklist to verify stable lane rollout readiness.',
						officeListGroupItemCount: 2,
						sectionKind: 'office_block',
						sectionPath: ['Stable Lane', 'Checklist'],
						sectionTitle: 'Checklist'
					},
					score: 0.93,
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'nested-checklist',
					chunkText: 'Stable lane validation checklist nested scope.',
					metadata: {
						officeBlockKind: 'list',
						officeListContextText:
							'Use this checklist to verify stable validation readiness before handoff.',
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
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which checklist covers stable validation readiness',
			retrieval: 'vector',
			topK: 1
		});

		expect(traced.results[0]?.chunkId).toBe('nested-checklist');
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toMatchObject({
			label: 'Preferred deeper office-structure evidence within matching sections',
			metadata: {
				affectedScopes: 2,
				officeAffectedScopes: 2,
				officeListAffectedScopes: 2,
				pdfAffectedScopes: 0,
				reorderedResults: 2
			}
		});
	});

	it('prefers deeper repeated-scope office paragraph evidence within the same source and title', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'root-review-notes',
					chunkText: 'Stable lane review notes root scope.',
					metadata: {
						officeBlockKind: 'paragraph',
						sectionKind: 'office_block',
						sectionPath: ['Stable Lane', 'Review Notes'],
						sectionTitle: 'Review Notes'
					},
					score: 0.93,
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'nested-review-notes',
					chunkText: 'Stable lane nested review notes scope.',
					metadata: {
						officeBlockKind: 'paragraph',
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
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which review notes cover stable validation evidence',
			retrieval: 'vector',
			topK: 1
		});

		expect(traced.results[0]?.chunkId).toBe('nested-review-notes');
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toMatchObject({
			label: 'Preferred deeper office-structure evidence within matching sections',
			metadata: {
				affectedScopes: 2,
				officeAffectedScopes: 2,
				officeParagraphAffectedScopes: 2,
				pdfAffectedScopes: 0,
				reorderedResults: 2
			}
		});
	});

	it('does not reconcile disambiguated sibling office table families inside the same repeated subsection', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'first-sibling-evidence-table',
					chunkText:
						'Stable lane repeated review evidence table primary sibling.',
					metadata: {
						officeBlockKind: 'table',
						officeTableContextText:
							'Keep stable sibling follow-up evidence isolated from the first follow-up evidence table.',
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
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'second-sibling-evidence-table',
					chunkText:
						'Stable lane repeated review evidence table second sibling.',
					metadata: {
						officeBlockKind: 'table',
						officeTableContextText:
							'Keep stable sibling follow-up evidence isolated from the duplicate follow-up evidence table.',
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
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which repeated review evidence table is primary',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'first-sibling-evidence-table',
			'second-sibling-evidence-table'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeUndefined();
	});

	it('does not reconcile disambiguated sibling office paragraph branches inside the same repeated subsection', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'first-sibling-review-notes',
					chunkText:
						'Stable lane repeated review notes primary sibling narrative.',
					metadata: {
						officeBlockKind: 'paragraph',
						sectionKind: 'office_block',
						sectionPath: [
							'Stable Lane',
							'Validation Pack',
							'Evidence Review (2)',
							'Review Notes'
						],
						sectionTitle: 'Review Notes'
					},
					score: 0.93,
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'second-sibling-review-notes',
					chunkText:
						'Stable lane repeated review notes second sibling narrative.',
					metadata: {
						officeBlockKind: 'paragraph',
						sectionKind: 'office_block',
						sectionPath: [
							'Stable Lane',
							'Validation Pack',
							'Evidence Review (2)',
							'Review Notes (2)'
						],
						sectionTitle: 'Review Notes (2)'
					},
					score: 0.91,
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which repeated review notes branch is primary',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'first-sibling-review-notes',
			'second-sibling-review-notes'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeUndefined();
	});

	it('does not reconcile disambiguated sibling office table branches inside repeated review notes second branches', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'first-closure-notes-table',
					chunkText: 'Stable first closure table evidence.',
					metadata: {
						officeBlockKind: 'table',
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
					score: 0.92,
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'second-closure-notes-table',
					chunkText: 'Stable second closure table evidence.',
					metadata: {
						officeBlockKind: 'table',
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
					score: 0.9,
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which repeated closure table is primary',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'first-closure-notes-table',
			'second-closure-notes-table'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeUndefined();
	});

	for (const familyOrdinal of Array.from(
		{ length: 11 },
		(_, index) => index + 2
	)) {
		const ordinalLabel = `ordinal ${familyOrdinal} disambiguated sibling`;
		const queryLabel = `ordinal ${familyOrdinal} sibling`;
		const chunkPrefix = `ordinal-${familyOrdinal}-sibling`;
		const scoreBase = 0.91 - familyOrdinal * 0.02;

		it(`does not reconcile ${ordinalLabel} office table families inside closure notes branches`, async () => {
			const store: RAGVectorStore = {
				embed: async () => [1, 0],
				query: async () => [
					{
						chunkId: `first-closure-${chunkPrefix}-table`,
						chunkText: `Stable ${queryLabel} closure table evidence.`,
						metadata: buildRepeatedClosureOfficeMetadata({
							blockKind: 'table',
							branchOrdinal: 1,
							familyName: 'Evidence Table',
							familyOrdinal
						}),
						score: scoreBase,
						source: 'docs/release-scope.docx'
					},
					{
						chunkId: `second-closure-${chunkPrefix}-table`,
						chunkText: `Stable ${queryLabel} second-branch closure table evidence.`,
						metadata: buildRepeatedClosureOfficeMetadata({
							blockKind: 'table',
							branchOrdinal: 2,
							familyName: 'Evidence Table',
							familyOrdinal
						}),
						score: scoreBase - 0.01,
						source: 'docs/release-scope.docx'
					}
				],
				upsert: async () => {}
			};
			const collection = createRAGCollection({ store });

			const traced = await collection.searchWithTrace({
				query: `which ${queryLabel} closure table is primary`,
				retrieval: 'vector',
				topK: 2
			});

			expect(traced.results.map((entry) => entry.chunkId)).toEqual([
				`first-closure-${chunkPrefix}-table`,
				`second-closure-${chunkPrefix}-table`
			]);
			expect(
				traced.trace.steps.find(
					(step) => step.stage === 'evidence_reconcile'
				)
			).toBeUndefined();
		});
	}

	it('prefers deeper lineage-aware spreadsheet table evidence within matching spreadsheet families', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'sheet-table-shallow',
					chunkText:
						'Spreadsheet table summary with shallow lineage.',
					metadata: {
						sectionKind: 'spreadsheet_rows',
						sectionFamilyPath: [
							'Release Tracker',
							'Spreadsheet Table'
						],
						sectionOrdinalPath: [1, 2],
						sectionSiblingFamilyKey: 'Spreadsheet Table',
						sectionSiblingOrdinal: 2,
						sheetName: 'Release Tracker',
						spreadsheetHeaders: ['Owner', 'Status'],
						spreadsheetTableCount: 2,
						spreadsheetTableIndex: 2
					},
					score: 0.93,
					source: 'docs/tracker.xlsx'
				},
				{
					chunkId: 'sheet-table-deep',
					chunkText:
						'Spreadsheet table summary with workbook-scoped lineage.',
					metadata: {
						sectionKind: 'spreadsheet_rows',
						sectionFamilyPath: [
							'Release Tracker',
							'Operations',
							'Spreadsheet Table'
						],
						sectionOrdinalPath: [1, 1, 2],
						sectionSiblingFamilyKey: 'Spreadsheet Table',
						sectionSiblingOrdinal: 2,
						sheetName: 'Release Tracker',
						spreadsheetHeaders: ['Owner', 'Status'],
						spreadsheetTableCount: 2,
						spreadsheetTableIndex: 2
					},
					score: 0.91,
					source: 'docs/tracker.xlsx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which spreadsheet table has the most local release tracker scope',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'sheet-table-deep',
			'sheet-table-shallow'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeDefined();
	});

	it('prefers deeper office table evidence when only generic lineage metadata is present', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'office-generic-shallow',
					chunkText: 'Shallow office table lineage hit.',
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
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'office-generic-deep',
					chunkText: 'Deep office table lineage hit.',
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
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which evidence table has the most local stable lane scope',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'office-generic-deep',
			'office-generic-shallow'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeDefined();
	});

	it('does not reconcile disambiguated sibling office checklist families inside closure notes branches', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'first-closure-sibling-checklist',
					chunkText: 'Stable sibling closure checklist evidence.',
					metadata: {
						officeBlockKind: 'list',
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
					score: 0.87,
					source: 'docs/release-scope.docx'
				},
				{
					chunkId: 'second-closure-sibling-checklist',
					chunkText:
						'Stable second sibling closure checklist evidence.',
					metadata: {
						officeBlockKind: 'list',
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
					score: 0.86,
					source: 'docs/release-scope.docx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which sibling closure checklist is primary',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'first-closure-sibling-checklist',
			'second-closure-sibling-checklist'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeUndefined();
	});

	it('applies native query profiles before store search and keeps explicit overrides', async () => {
		const seen: RAGQueryInput[] = [];
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			getCapabilities: () => ({
				backend: 'custom',
				nativeVectorSearch: true,
				persistence: 'external',
				serverSideFiltering: true,
				streamingIngestStatus: false
			}),
			getStatus: () => ({
				backend: 'postgres',
				dimensions: 2,
				vectorMode: 'native_pgvector'
			}),
			query: async (input) => {
				seen.push(input);
				return [];
			},
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		await collection.searchWithTrace({
			nativeQueryProfile: 'latency',
			query: 'alpha',
			retrieval: { mode: 'vector' },
			topK: 4
		});

		expect(seen[0]).toMatchObject({
			candidateLimit: 4,
			fillPolicy: 'satisfy_min_results',
			maxBackfills: 0,
			minResults: 1,
			plannerProfile: 'latency',
			queryMultiplier: 1,
			topK: 4
		});

		await collection.searchWithTrace({
			nativeCandidateLimit: 9,
			nativeFillPolicy: 'strict_topk',
			nativeMaxBackfills: 2,
			nativeMinResults: 3,
			nativeQueryMultiplier: 6,
			nativeQueryProfile: 'latency',
			query: 'beta',
			retrieval: { mode: 'vector' },
			topK: 4
		});

		expect(seen[1]).toMatchObject({
			candidateLimit: 9,
			fillPolicy: 'strict_topk',
			maxBackfills: 2,
			minResults: 3,
			plannerProfile: 'latency',
			queryMultiplier: 6,
			topK: 4
		});
	});

	it('auto-selects a balanced native planner profile for larger native corpora', async () => {
		const seen: RAGQueryInput[] = [];
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			getCapabilities: () => ({
				backend: 'custom',
				nativeVectorSearch: true,
				persistence: 'external',
				serverSideFiltering: true,
				streamingIngestStatus: false
			}),
			getStatus: () => ({
				backend: 'postgres',
				dimensions: 2,
				native: {
					active: true,
					available: true,
					estimatedRowCount: 12000,
					mode: 'pgvector',
					requested: true
				},
				vectorMode: 'native_pgvector'
			}),
			query: async (input) => {
				seen.push(input);
				return [];
			},
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'alpha',
			retrieval: { mode: 'vector' },
			topK: 4
		});

		expect(seen[0]).toMatchObject({
			fillPolicy: 'satisfy_min_results',
			maxBackfills: 1,
			minResults: 2,
			plannerProfile: 'balanced',
			queryMultiplier: 4,
			topK: 4
		});
		expect(traced.trace.steps).toContainEqual(
			expect.objectContaining({
				label: 'Selected native planner profile',
				metadata: expect.objectContaining({
					autoSelected: true,
					filterClauseCount: 0,
					rowEstimate: 12000,
					selectedProfile: 'balanced'
				}),
				stage: 'routing'
			})
		);
	});

	it('auto-selects a recall native planner profile for larger complex native searches', async () => {
		const seen: RAGQueryInput[] = [];
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			getCapabilities: () => ({
				backend: 'custom',
				nativeVectorSearch: true,
				persistence: 'external',
				serverSideFiltering: true,
				streamingIngestStatus: false
			}),
			getStatus: () => ({
				backend: 'postgres',
				dimensions: 2,
				native: {
					active: true,
					available: true,
					estimatedRowCount: 40000,
					mode: 'pgvector',
					requested: true
				},
				vectorMode: 'native_pgvector'
			}),
			query: async (input) => {
				seen.push(input);
				return [];
			},
			upsert: async () => {}
		};
		const collection = createRAGCollection({
			queryTransform: async (input) => ({
				query: input.query,
				variants: ['launch checklist exact wording']
			}),
			store
		});

		const traced = await collection.searchWithTrace({
			filter: {
				$and: [
					{ source: 'guide/release.md' },
					{ 'metadata.workspace': 'alpha' },
					{ 'metadata.kind': 'guide' }
				]
			},
			query: 'Which launch checklist phrase is exact wording?',
			retrieval: { mode: 'vector' },
			topK: 4
		});

		expect(seen[0]).toMatchObject({
			fillPolicy: 'strict_topk',
			maxBackfills: 4,
			minResults: 4,
			plannerProfile: 'recall',
			queryMultiplier: 8
		});
		expect(traced.trace.steps).toContainEqual(
			expect.objectContaining({
				label: 'Selected native planner profile',
				metadata: expect.objectContaining({
					autoSelected: true,
					filterClauseCount: 3,
					rowEstimate: 40000,
					selectedProfile: 'recall'
				}),
				stage: 'routing'
			})
		);
	});

	it('returns structured retrieval traces for collection searches', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'alpha') return [1, 0];
				if (text === 'beta') return [0, 1];
				if (text === 'query') return [1, 0];

				return [0.5, 0.5];
			}
		});
		const collection = createRAGCollection({
			defaultTopK: 2,
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'a', text: 'alpha' },
				{ chunkId: 'b', text: 'beta' }
			]
		});

		const result = await collection.searchWithTrace({
			query: 'query',
			scoreThreshold: 0.5,
			topK: 2
		});

		expect(result.results.map((entry) => entry.chunkId)).toEqual(['a']);
		expect(result.trace.query).toBe('query');
		expect(result.trace.mode).toBe('vector');
		expect(result.trace.resultCounts.final).toBe(1);
		expect(result.trace.steps.map((step) => step.stage)).toEqual([
			'input',
			'embed',
			'vector_search',
			'fusion',
			'rerank',
			'score_filter',
			'finalize'
		]);
		expect(result.results[0]?.metadata).toMatchObject({
			retrievalChannels: ['vector']
		});
	});

	it('annotates final hits with vector and lexical retrieval channels', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'alpha',
					embedding: [1, 0],
					text: 'alpha retrieval match'
				},
				{
					chunkId: 'beta',
					embedding: [0, 1],
					text: 'beta only'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'alpha',
			retrieval: { mode: 'hybrid' },
			topK: 2
		});

		const alpha = traced.results.find((entry) => entry.chunkId === 'alpha');
		expect(alpha?.metadata).toMatchObject({
			retrievalChannels: ['vector', 'lexical']
		});
	});

	it('collapses multivector variant hits back to a single parent chunk', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('launch checklist')) return [1, 0];
				if (text.includes('deployment rollback')) return [0, 1];
				if (text.includes('release playbook')) return [0.8, 0.2];
				if (text.includes('launch plan')) return [1, 0];
				return [0.1, 0.1];
			}
		});
		const collection = createRAGCollection({
			defaultTopK: 4,
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'ops-parent',
					embeddingVariants: [
						{
							id: 'launch-checklist',
							label: 'Launch checklist',
							text: 'launch checklist for release readiness'
						},
						{
							id: 'rollback',
							label: 'Rollback steps',
							text: 'deployment rollback procedure'
						}
					],
					metadata: {
						documentId: 'release-playbook'
					},
					source: 'ops/release-playbook.md',
					text: 'release playbook for launch plan'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'launch checklist',
			retrieval: { mode: 'hybrid' },
			topK: 3
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'ops-parent'
		]);
		expect(traced.results[0]?.metadata).toMatchObject({
			multivectorMatchedVariantId: 'launch-checklist',
			multivectorMatchedVariantLabel: 'Launch checklist',
			retrievalChannels: ['vector', 'lexical']
		});
		expect(
			Number(traced.results[0]?.metadata?.multivectorMatchedVariantCount)
		).toBeGreaterThanOrEqual(1);
		expect(traced.trace.multiVector).toBeDefined();
		expect(traced.trace.multiVector?.configured).toBe(true);
		expect(traced.trace.multiVector?.collapsedParents).toBe(1);
		expect(
			Number(traced.trace.multiVector?.vectorVariantHits ?? 0)
		).toBeGreaterThanOrEqual(1);
		expect(
			Number(traced.trace.multiVector?.lexicalVariantHits ?? 0)
		).toBeGreaterThanOrEqual(1);
		expect(
			Number(
				traced.trace.steps.find(
					(step) => step.stage === 'vector_search'
				)?.metadata?.multiVectorVariantHits ?? 0
			)
		).toBeGreaterThanOrEqual(1);
		expect(
			Number(
				traced.trace.steps.find(
					(step) => step.stage === 'lexical_search'
				)?.metadata?.multiVectorVariantHits ?? 0
			)
		).toBeGreaterThanOrEqual(1);
	});

	it('records section counts on retrieval trace stages', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'stable',
					embedding: [1, 0],
					metadata: {
						sectionPath: ['Release Ops Overview', 'Stable Lane'],
						sectionTitle: 'Stable Lane'
					},
					text: 'stable retrieval match'
				},
				{
					chunkId: 'canary',
					embedding: [0.9, 0],
					metadata: {
						sectionPath: ['Release Ops Overview', 'Canary Lane'],
						sectionTitle: 'Canary Lane'
					},
					text: 'canary retrieval match'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'stable lane',
			retrieval: { mode: 'hybrid' },
			topK: 2
		});

		const vectorStage = traced.trace.steps.find(
			(step) => step.stage === 'vector_search'
		);
		const finalStage = traced.trace.steps.find(
			(step) => step.stage === 'finalize'
		);

		expect(vectorStage?.sectionCounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: 'Release Ops Overview > Stable Lane',
					label: 'Stable Lane'
				})
			])
		);
		expect(finalStage?.sectionCounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: 'Release Ops Overview > Stable Lane',
					label: 'Stable Lane'
				})
			])
		);
		expect(vectorStage?.sectionScores).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: 'Release Ops Overview > Stable Lane',
					label: 'Stable Lane'
				})
			])
		);
		expect(
			traced.results.every(
				(result) =>
					typeof result.metadata?.retrievalQueryIndex === 'number' &&
					(result.metadata?.retrievalQueryOrigin === 'primary' ||
						result.metadata?.retrievalQueryOrigin ===
							'transformed' ||
						result.metadata?.retrievalQueryOrigin === 'variant')
			)
		).toBe(true);
	});

	it('preserves all contributing query origins on merged chunks', async () => {
		const collection = createRAGCollection({
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async () => [1, 0]
			}),
			queryTransform: {
				transform: ({ query }) => ({
					query,
					variants: ['variant spreadsheet query']
				})
			}
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'shared-chunk',
					embedding: [1, 0],
					metadata: {},
					source: 'docs/query-attribution.md',
					text: 'Regional growth workbook and spreadsheet language stay in the same section.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'Which workbook titled Regional Growth explains rollout posture?'
		});

		expect(traced.results[0]?.metadata?.retrievalQueryOrigins).toEqual(
			expect.arrayContaining(['primary', 'variant'])
		);
	});

	it('records sqlite query-plan metadata on vector trace stages', async () => {
		const store = createSQLiteRAGStore({
			db: new Database(':memory:'),
			dimensions: 2,
			native: { mode: 'vec0' },
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'release-acme',
					embedding: [1, 0],
					metadata: { labels: ['release'], tenant: 'acme' },
					text: 'release candidate for acme'
				},
				{
					chunkId: 'backlog-acme',
					embedding: [0.9, 0],
					metadata: { labels: ['backlog'], tenant: 'acme' },
					text: 'backlog candidate for acme'
				},
				{
					chunkId: 'release-beta',
					embedding: [0.8, 0],
					metadata: { labels: ['release'], tenant: 'beta' },
					text: 'release candidate for beta'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			filter: {
				tenant: 'acme',
				labels: { $contains: 'release' }
			},
			nativeMinResults: 1,
			nativeQueryMultiplier: 6,
			nativeMaxBackfills: 0,
			query: 'release candidate',
			retrieval: { mode: 'vector' },
			topK: 2
		});

		const vectorStage = traced.trace.steps.find(
			(step) => step.stage === 'vector_search'
		);

		expect(vectorStage?.metadata).toMatchObject({
			sqliteQueryBackfillCount: 0,
			sqliteQueryBackfillLimitReached: null,
			sqliteQueryCandidateBudgetExhausted: false,
			sqliteQueryCandidateCoverage: 'target_sized',
			sqliteQueryFilteredCandidates: 2,
			sqliteQueryJsRemainderClauseCount: 1,
			sqliteQueryJsRemainderRatio: 0.5,
			sqliteQueryMode: 'json_fallback',
			sqliteQueryFillPolicyUsed: null,
			sqliteQueryMinResultsSatisfied: null,
			sqliteQueryMinResultsUsed: null,
			sqliteQueryPushdownApplied: true,
			sqliteQueryPushdownClauseCount: 1,
			sqliteQueryPushdownCoverageRatio: 0.5,
			sqliteQueryPushdownMode: 'partial',
			sqliteQueryMaxBackfillsUsed: null,
			sqliteQueryMultiplierUsed: 6,
			sqliteQueryReturnedCount: 1,
			sqliteQueryCandidateYieldRatio: 0.5,
			sqliteQuerySearchExpansionRatio: 1,
			sqliteQueryTopKFillRatio: 0.5,
			sqliteQueryTotalFilterClauseCount: 2,
			sqliteQueryUnderfilledTopK: true
		});
	});

	itIfPostgres(
		'records postgres query-plan metadata on vector trace stages',
		async () => {
			const store = trackPostgresStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === 'release candidate'
							? [1, 0]
							: text === 'release candidate for acme'
								? [1, 0]
								: text === 'backlog candidate for acme'
									? [0.9, 0]
									: [0.8, 0],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);
			const collection = createRAGCollection({ store });

			await collection.ingest({
				chunks: [
					{
						chunkId: 'release-acme',
						embedding: [1, 0],
						metadata: {
							labels: ['release'],
							scope: { region: 'us' },
							tenant: 'acme'
						},
						source: 'acme-feed',
						text: 'release candidate for acme'
					},
					{
						chunkId: 'backlog-acme',
						embedding: [0.9, 0],
						metadata: {
							labels: ['backlog'],
							scope: { region: 'us' },
							tenant: 'acme'
						},
						source: 'acme-feed',
						text: 'backlog candidate for acme'
					},
					{
						chunkId: 'release-beta',
						embedding: [0.8, 0],
						metadata: {
							labels: ['release'],
							scope: { region: 'eu' },
							tenant: 'beta'
						},
						source: 'beta-feed',
						text: 'release candidate for beta'
					}
				]
			});

			const traced = await collection.searchWithTrace({
				filter: {
					'scope.region': 'us',
					labels: { $contains: 'release' }
				},
				nativeCandidateLimit: 2,
				nativeFillPolicy: 'satisfy_min_results',
				nativeMaxBackfills: 0,
				nativeMinResults: 1,
				query: 'release candidate',
				retrieval: { mode: 'vector' },
				topK: 2
			});

			const vectorStage = traced.trace.steps.find(
				(step) => step.stage === 'vector_search'
			);

			expect(vectorStage?.metadata).toMatchObject({
				postgresEstimatedRowCount: expect.any(Number),
				postgresIndexBytes: expect.any(Number),
				postgresIndexName: expect.stringContaining(
					'_embedding_hnsw_idx'
				),
				postgresIndexPresent: true,
				postgresIndexStorageRatio: expect.any(Number),
				postgresIndexType: 'hnsw',
				postgresTableBytes: expect.any(Number),
				postgresTotalBytes: expect.any(Number),
				postgresQueryBackfillCount: 0,
				postgresQueryBackfillLimitReached: false,
				postgresQueryCandidateBudgetExhausted: false,
				postgresQueryCandidateCoverage: 'under_target',
				postgresQueryCandidateLimitUsed: 1,
				postgresQueryFilteredCandidates: 1,
				postgresQueryFinalSearchK: 1,
				postgresQueryInitialSearchK: 1,
				postgresQueryMaxBackfillsUsed: 0,
				postgresQueryFillPolicyUsed: 'satisfy_min_results',
				postgresQueryMinResultsSatisfied: true,
				postgresQueryMinResultsUsed: 1,
				postgresQueryMultiplierUsed: 4,
				postgresQueryJsRemainderClauseCount: 0,
				postgresQueryJsRemainderRatio: 0,
				postgresQueryMode: 'native_pgvector',
				postgresQueryPushdownApplied: true,
				postgresQueryPushdownClauseCount: 2,
				postgresQueryPushdownCoverageRatio: 1,
				postgresQueryPushdownMode: 'full',
				postgresQueryReturnedCount: 1,
				postgresQueryCandidateYieldRatio: 1,
				postgresQuerySearchExpansionRatio: 1,
				postgresQueryTopKFillRatio: 0.5,
				postgresQueryTotalFilterClauseCount: 2,
				postgresQueryUnderfilledTopK: true
			});
		}
	);

	itIfPostgres(
		'records postgres metadata-operator pushdown on vector trace stages',
		async () => {
			const store = trackPostgresStore(
				createPostgresRAGStore({
					connectionString: POSTGRES_URL,
					dimensions: 2,
					mockEmbedding: async (text) =>
						text === 'priority release alpha'
							? [1, 0]
							: text === 'priority release beta'
								? [0.85, 0]
								: [0.2, 1],
					tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
				})
			);
			const collection = createRAGCollection({ store });

			await collection.ingest({
				chunks: [
					{
						chunkId: 'priority-alpha',
						embedding: [1, 0],
						metadata: {
							labels: ['release'],
							priority: { rank: 3 },
							scope: { region: 'us' }
						},
						source: 'priority-feed',
						text: 'priority release alpha'
					},
					{
						chunkId: 'priority-beta',
						embedding: [0.85, 0],
						metadata: {
							labels: ['release'],
							priority: { rank: 1 }
						},
						source: 'priority-feed',
						text: 'priority release beta'
					},
					{
						chunkId: 'priority-gamma',
						embedding: [0.2, 1],
						metadata: {
							labels: ['backlog'],
							priority: { rank: 5 },
							scope: { region: 'eu' }
						},
						source: 'priority-feed',
						text: 'priority backlog gamma'
					}
				]
			});

			const traced = await collection.searchWithTrace({
				filter: {
					'priority.rank': { $gte: 2 },
					'scope.region': { $exists: true },
					labels: { $contains: 'release' }
				},
				nativeQueryMultiplier: 6,
				query: 'priority release',
				retrieval: { mode: 'vector' },
				topK: 2
			});

			const vectorStage = traced.trace.steps.find(
				(step) => step.stage === 'vector_search'
			);

			expect(vectorStage?.metadata).toMatchObject({
				postgresEstimatedRowCount: expect.any(Number),
				postgresIndexBytes: expect.any(Number),
				postgresIndexName: expect.stringContaining(
					'_embedding_hnsw_idx'
				),
				postgresIndexPresent: true,
				postgresIndexStorageRatio: expect.any(Number),
				postgresIndexType: 'hnsw',
				postgresTableBytes: expect.any(Number),
				postgresTotalBytes: expect.any(Number),
				postgresQueryCandidateCoverage: 'under_target',
				postgresQueryFilteredCandidates: 1,
				postgresQueryJsRemainderClauseCount: 0,
				postgresQueryJsRemainderRatio: 0,
				postgresQueryCandidateBudgetExhausted: true,
				postgresQueryCandidateLimitUsed: 1,
				postgresQueryFinalSearchK: 1,
				postgresQueryInitialSearchK: 1,
				postgresQueryBackfillCount: 0,
				postgresQueryBackfillLimitReached: false,
				postgresQueryFillPolicyUsed: 'satisfy_min_results',
				postgresQueryMinResultsSatisfied: false,
				postgresQueryMinResultsUsed: 2,
				postgresQueryMultiplierUsed: 6,
				postgresQueryPushdownApplied: true,
				postgresQueryPushdownClauseCount: 3,
				postgresQueryPushdownCoverageRatio: 1,
				postgresQueryPushdownMode: 'full',
				postgresQuerySearchExpansionRatio: 1,
				postgresQueryTopKFillRatio: 0.5,
				postgresQueryUnderfilledTopK: true,
				postgresQueryReturnedCount: 1,
				postgresQueryCandidateYieldRatio: 1,
				postgresQueryTotalFilterClauseCount: 3
			});
		}
	);

	it('supports retrieval strategy selectors that route queries per request', async () => {
		const seenModes: string[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		const originalLexical = store.queryLexical?.bind(store);
		store.query = async (input) => {
			seenModes.push('vector');
			return originalQuery(input);
		};
		store.queryLexical = async (input) => {
			seenModes.push('lexical');
			return originalLexical?.(input) ?? Promise.resolve([]);
		};
		const collection = createRAGCollection({
			retrievalStrategy: {
				providerName: 'test_router',
				defaultLabel: 'Support lexical route',
				select: ({ query }) =>
					query.includes('reset password')
						? {
								label: 'Support lexical route',
								mode: 'lexical',
								reason: 'faq phrase matched'
							}
						: undefined
			},
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'faq-hit',
					embedding: [1, 0],
					text: 'Reset password instructions for support operators.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'reset password',
			retrieval: 'vector'
		});

		expect(seenModes).toEqual(['lexical']);
		expect(traced.trace.requestedMode).toBe('vector');
		expect(traced.trace.mode).toBe('lexical');
		expect(traced.trace.routingProvider).toBe('test_router');
		expect(traced.trace.routingLabel).toBe('Support lexical route');
		expect(traced.trace.routingReason).toBe('faq phrase matched');
		expect(
			traced.trace.steps.find((step) => step.stage === 'routing')
				?.metadata
		).toEqual(
			expect.objectContaining({
				providerName: 'test_router',
				requestedMode: 'vector',
				selectedMode: 'lexical'
			})
		);
	});

	it('surfaces query transform metadata in the trace', async () => {
		const collection = createRAGCollection({
			queryTransform: {
				providerName: 'heuristic_transform',
				transform: ({ query }) => ({
					label: 'Spreadsheet rewrite',
					query: 'regional growth workbook',
					reason: 'spreadsheet terms detected',
					variants: ['regional growth worksheet']
				})
			},
			store: createInMemoryRAGStore({
				dimensions: 2,
				mockEmbedding: async () => [1, 0]
			})
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'sheet-hit',
					embedding: [1, 0],
					text: 'Regional growth workbook evidence.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'regional growth sheet'
		});

		expect(traced.trace.queryTransformProvider).toBe('heuristic_transform');
		expect(traced.trace.queryTransformLabel).toBe('Spreadsheet rewrite');
		expect(traced.trace.queryTransformReason).toBe(
			'spreadsheet terms detected'
		);
		expect(
			traced.trace.steps.find((step) => step.stage === 'query_transform')
				?.metadata
		).toEqual(
			expect.objectContaining({
				label: 'Spreadsheet rewrite',
				providerName: 'heuristic_transform',
				reason: 'spreadsheet terms detected',
				transformedQuery: 'regional growth workbook',
				variantCount: 1
			})
		);
	});

	it('provides a built-in heuristic retrieval strategy helper', async () => {
		const seenModes: string[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		const originalLexical = store.queryLexical?.bind(store);
		store.query = async (input) => {
			seenModes.push('vector');
			return originalQuery(input);
		};
		store.queryLexical = async (input) => {
			seenModes.push('lexical');
			return originalLexical?.(input) ?? Promise.resolve([]);
		};
		const collection = createRAGCollection({
			retrievalStrategy: createHeuristicRAGRetrievalStrategy(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'faq-hit',
					embedding: [1, 0],
					text: 'Reset password policy for support operators.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'reset password policy',
			retrieval: 'vector'
		});

		expect(seenModes).toEqual(['lexical']);
		expect(traced.trace.routingLabel).toBe('Support lexical route');
		expect(traced.trace.routingProvider).toBe(
			'heuristic_retrieval_strategy'
		);
	});

	it('uses the built-in heuristic retrieval strategy for scoped direct routes', async () => {
		const seenModes: string[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		const originalLexical = store.queryLexical?.bind(store);
		store.query = async (input) => {
			seenModes.push('vector');
			return originalQuery(input);
		};
		store.queryLexical = async (input) => {
			seenModes.push('lexical');
			return originalLexical?.(input) ?? Promise.resolve([]);
		};
		const collection = createRAGCollection({
			retrievalStrategy: createHeuristicRAGRetrievalStrategy(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'scoped-hit',
					embedding: [1, 0],
					source: 'docs/runbook.md',
					text: 'Runbook section for direct scoped retrieval.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			filter: { source: 'docs/runbook.md' },
			query: 'runbook retrieval',
			retrieval: 'hybrid'
		});

		expect(seenModes).toEqual(['vector']);
		expect(traced.trace.requestedMode).toBe('hybrid');
		expect(traced.trace.mode).toBe('vector');
		expect(traced.trace.routingLabel).toBe('Scoped direct route');
	});

	it('uses the built-in heuristic retrieval strategy for exact phrase hybrid routes', async () => {
		const seenModes: string[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text.includes('Generic')) return [1, 0];
				if (text.includes('release-readiness')) return [0, 1];
				if (text.includes('aurora launch packet')) return [1, 0];

				return [0.5, 0.5];
			}
		});
		const originalQuery = store.query.bind(store);
		const originalLexical = store.queryLexical?.bind(store);
		store.query = async (input) => {
			seenModes.push('vector');
			return originalQuery(input);
		};
		store.queryLexical = async (input) => {
			seenModes.push('lexical');
			return originalLexical?.(input) ?? Promise.resolve([]);
		};
		const collection = createRAGCollection({
			retrievalStrategy: createHeuristicRAGRetrievalStrategy(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					metadata: { documentId: 'generic' },
					source: 'generic',
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: { documentId: 'target' },
					source: 'guide/multivector.md',
					text: 'release-readiness callouts and operator recovery drills',
					embeddingVariants: [
						{
							id: 'launch-checklist',
							label: 'Launch checklist',
							text: 'aurora launch packet sign-off checklist'
						}
					]
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'Which aurora launch packet phrase shows exact wording?',
			retrieval: 'vector',
			topK: 1
		});

		expect(seenModes).toHaveLength(2);
		expect(seenModes.sort()).toEqual(['lexical', 'vector']);
		expect(traced.results[0]?.chunkId).toBe('target:001');
		expect(traced.trace.requestedMode).toBe('vector');
		expect(traced.trace.mode).toBe('hybrid');
		expect(traced.trace.routingLabel).toBe('Exact phrase hybrid route');
		expect(traced.trace.multiVector?.configured).toBe(true);
		expect(traced.trace.multiVector?.lexicalVariantHits).toBeGreaterThan(0);
		expect(
			traced.trace.steps.find((step) => step.stage === 'routing')
				?.metadata
		).toEqual(
			expect.objectContaining({
				exactPhraseIntent: true,
				reason: 'exact sub-span wording benefits from lexical evidence',
				selectedMode: 'hybrid',
				selector: 'exact_phrase_hybrid'
			})
		);
	});

	it('applies reranking before the final topK slice', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text === 'search query' ? [1, 0] : [0, 1]
		});
		const callArgs: Array<{ model?: string; topK: number }> = [];
		const collection = createRAGCollection({
			defaultModel: 'rerank-model',
			store,
			rerank: ({ model, topK, results }) => {
				callArgs.push({ model, topK });

				return [...results].reverse();
			}
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'first', embedding: [1, 0], text: 'one' },
				{ chunkId: 'second', embedding: [0, 1], text: 'two' },
				{ chunkId: 'third', embedding: [-1, 0], text: 'three' }
			]
		});

		const results = await collection.search({
			query: 'search query',
			topK: 3
		});

		expect(callArgs).toEqual([{ model: 'rerank-model', topK: 3 }]);
		expect(results.map((entry) => entry.chunkId)).toEqual([
			'third',
			'second',
			'first'
		]);
	});

	it('retrieves a larger candidate pool before reranking', async () => {
		const seenQueryTopK: number[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		store.query = async (input) => {
			seenQueryTopK.push(input.topK);

			return originalQuery(input);
		};
		const collection = createRAGCollection({
			rerank: ({ results }) => [...results].reverse(),
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'one', embedding: [1, 0], text: 'one' },
				{ chunkId: 'two', embedding: [1, 0], text: 'two' },
				{ chunkId: 'three', embedding: [1, 0], text: 'three' },
				{ chunkId: 'four', embedding: [1, 0], text: 'four' }
			]
		});

		const results = await collection.search({
			query: 'one',
			topK: 2
		});

		expect(seenQueryTopK).toEqual([8]);
		expect(results).toHaveLength(2);
	});

	it('retrieves a larger candidate pool for hybrid and transformed retrieval', async () => {
		const seenVectorTopK: number[] = [];
		const seenLexicalTopK: number[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const originalQuery = store.query.bind(store);
		const originalLexical = store.queryLexical?.bind(store);
		store.query = async (input) => {
			seenVectorTopK.push(input.topK);

			return originalQuery(input);
		};
		store.queryLexical = async (input) => {
			seenLexicalTopK.push(input.topK);

			return originalLexical?.(input) ?? Promise.resolve([]);
		};
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'one', embedding: [1, 0], text: 'one' },
				{ chunkId: 'two', embedding: [1, 0], text: 'two' },
				{ chunkId: 'three', embedding: [1, 0], text: 'three' },
				{ chunkId: 'four', embedding: [1, 0], text: 'four' }
			]
		});

		await collection.search({
			query: 'regional growth sheet',
			retrieval: 'hybrid',
			topK: 2
		});

		expect(seenVectorTopK.every((value) => value === 8)).toBe(true);
		expect(seenLexicalTopK.every((value) => value === 8)).toBe(true);
		expect(seenVectorTopK.length).toBeGreaterThan(0);
		expect(seenLexicalTopK.length).toBeGreaterThan(0);
	});

	it('uses reranker provider defaults when no search model is supplied', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const seenModels: string[] = [];
		const collection = createRAGCollection({
			rerank: {
				defaultModel: 'provider-rerank-model',
				providerName: 'demo-reranker',
				rerank: ({ model, results }) => {
					seenModels.push(model ?? 'missing');

					return results;
				}
			},
			store
		});

		await collection.ingest({
			chunks: [{ chunkId: 'alpha', embedding: [1, 0], text: 'alpha' }]
		});

		await collection.search({ query: 'alpha' });
		expect(seenModels).toEqual(['provider-rerank-model']);
	});

	it('ships a first-party heuristic reranker that can reorder lexical matches', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'A generic chunk with weaker lexical overlap.'
				},
				{
					chunkId: 'metadata',
					embedding: [1, 0],
					text: 'Metadata filters improve retrieval quality and metadata discipline.'
				}
			]
		});

		const results = await collection.search({
			query: 'metadata filters'
		});

		expect(results[0]?.chunkId).toBe('metadata');
	});

	it('scores metadata-aware matches in the heuristic reranker', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General workflow summary.'
				},
				{
					chunkId: 'sheet-hit',
					embedding: [1, 0],
					metadata: { sheetName: 'Regional Growth' },
					source: 'files/revenue-forecast.xlsx',
					text: 'Quarterly planning workbook.'
				}
			]
		});

		const results = await collection.search({
			query: 'regional growth sheet'
		});

		expect(results[0]?.chunkId).toBe('sheet-hit');
	});

	it('prefers matched multivector variant text in the heuristic reranker', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (
					text ===
					'Which aurora launch packet phrase shows exact wording?'
				) {
					return [1, 0];
				}
				if (text === 'Generic operational summary.') {
					return [1, 0];
				}
				if (
					text ===
					'release-readiness callouts and operator recovery drills'
				) {
					return [0, 1];
				}

				return [0.9, 0.1];
			}
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					text: 'Generic operational summary.'
				},
				{
					chunkId: 'target:001',
					embedding: [0, 1],
					metadata: { documentId: 'target' },
					source: 'guide/multivector-release-guide.md',
					text: 'release-readiness callouts and operator recovery drills',
					embeddingVariants: [
						{
							embedding: [0.9, 0.1],
							id: 'launch-checklist',
							label: 'Launch checklist',
							text: 'aurora launch packet sign-off checklist'
						}
					]
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'Which aurora launch packet phrase shows exact wording?',
			retrieval: 'vector',
			topK: 1
		});

		expect(traced.results[0]?.chunkId).toBe('target:001');
		expect(traced.results[0]?.metadata).toEqual(
			expect.objectContaining({
				multivectorMatchedVariantId: 'launch-checklist',
				multivectorMatchedVariantLabel: 'Launch checklist',
				multivectorMatchedVariantText:
					'aurora launch packet sign-off checklist'
			})
		);
		expect(
			traced.trace.steps.find((step) => step.stage === 'rerank')?.metadata
		).toEqual(
			expect.objectContaining({
				leadMultivectorVariantCue: 'phrase_match',
				leadMultivectorVariantId: 'launch-checklist',
				leadMultivectorVariantLabel: 'Launch checklist'
			})
		);
	});

	it('recovers multivector exact-phrase vector cases across sqlite fallback and native stores', async () => {
		const stores: RAGVectorStore[] = [
			createSQLiteRAGStore({
				db: new Database(':memory:'),
				dimensions: 2,
				mockEmbedding: multivectorParityEmbedding
			}),
			createSQLiteRAGStore({
				db: new Database(':memory:'),
				dimensions: 2,
				native: { mode: 'vec0' },
				mockEmbedding: multivectorParityEmbedding
			})
		];

		for (const store of stores) {
			await assertMultivectorRerankParity({ store });
		}
	});

	itIfPostgres(
		'recovers multivector exact-phrase vector cases on postgres stores',
		async () => {
			await assertMultivectorRerankParity({
				store: trackPostgresStore(
					createPostgresRAGStore({
						connectionString: POSTGRES_URL,
						dimensions: 2,
						mockEmbedding: multivectorParityEmbedding,
						tableName: `rag_pg_${randomUUID().replaceAll('-', '_')}`
					})
				)
			});
		}
	);

	it('weights structured section scores in trace stages', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic-overview',
					embedding: [1, 0],
					metadata: {
						sectionKind: 'html_heading',
						sectionPath: ['Release Notes', 'Overview'],
						sectionTitle: 'Overview'
					},
					text: 'General release notes overview.'
				},
				{
					chunkId: 'pdf-table',
					embedding: [0.9, 0],
					metadata: {
						pageNumber: 4,
						pdfBlockNumber: 2,
						pdfTextKind: 'table_like',
						sectionKind: 'pdf_block',
						sectionPath: ['Release Notes', 'Approval Matrix'],
						sectionTitle: 'Approval Matrix'
					},
					text: 'Lane | Status'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'approval matrix table',
			topK: 2
		});

		const rerankStage = traced.trace.steps.find(
			(step) => step.stage === 'rerank'
		);
		const finalizeStage = traced.trace.steps.find(
			(step) => step.stage === 'finalize'
		);

		expect(rerankStage?.sectionScores?.[0]).toMatchObject({
			key: 'Release Notes > Approval Matrix',
			label: 'Approval Matrix'
		});
		expect(finalizeStage?.sectionScores?.[0]).toMatchObject({
			key: 'Release Notes > Approval Matrix',
			label: 'Approval Matrix'
		});
		expect(
			(rerankStage?.sectionScores?.[0]?.totalScore ?? 0) >
				(rerankStage?.sectionScores?.[1]?.totalScore ?? 0)
		).toBe(true);
	});

	it('prefers pdf table blocks for table-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'paragraph-hit',
					embedding: [1, 0],
					text: 'Quarterly revenue overview and forecast summary.'
				},
				{
					chunkId: 'table-hit',
					embedding: [1, 0],
					metadata: {
						pageNumber: 2,
						pdfBlockNumber: 3,
						pdfTextKind: 'table_like',
						sectionKind: 'pdf_block'
					},
					text: 'North America | Q1 | $2.1M\nEurope | Q1 | $1.7M'
				}
			]
		});

		const results = await collection.search({
			query: 'Which table shows the quarterly revenue rows?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('table-hit');
	});

	it('prefers office list blocks for checklist-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'paragraph-hit',
					embedding: [1, 0],
					text: 'Release readiness overview for the launch plan.'
				},
				{
					chunkId: 'list-hit',
					embedding: [1, 0],
					metadata: {
						officeBlockKind: 'list',
						officeBlockNumber: 2,
						sectionKind: 'office_block'
					},
					text: '1. Run smoke tests\n2. Approve rollout gate\n3. Notify support'
				}
			]
		});

		const results = await collection.search({
			query: 'Which checklist lists the rollout steps?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('list-hit');
	});

	it('prefers spreadsheet header-aware chunks for sheet-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General quarterly planning notes and staffing overview.'
				},
				{
					chunkId: 'sheet-hit',
					embedding: [1, 0],
					metadata: {
						sheetName: 'Release Tracker',
						spreadsheetHeaders: ['Owner', 'Status', 'Due date'],
						spreadsheetRowEnd: 18,
						spreadsheetRowStart: 12
					},
					text: 'Owner | Status | Due date\nOps | Ready | 2026-04-20'
				}
			]
		});

		const results = await collection.search({
			query: 'Which spreadsheet rows list owner status and due date?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('sheet-hit');
	});

	it('prefers spreadsheet table-local chunks for table-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'sheet-overview',
					embedding: [1, 0],
					metadata: {
						sheetName: 'Release Tracker',
						spreadsheetHeaders: ['Owner', 'Status'],
						spreadsheetRowEnd: 2,
						spreadsheetRowStart: 1
					},
					text: 'Owner | Status\nOps | Ready'
				},
				{
					chunkId: 'table-two',
					embedding: [1, 0],
					metadata: {
						sheetName: 'Release Tracker',
						spreadsheetHeaders: ['Owner', 'Status'],
						spreadsheetRowEnd: 4,
						spreadsheetRowStart: 3,
						spreadsheetTableCount: 2,
						spreadsheetTableIndex: 2
					},
					text: 'Owner | Status\nEscalation | Blocked'
				}
			]
		});

		const results = await collection.search({
			query: 'Which spreadsheet table lists the escalation status rows?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('table-two');
	});

	it('prefers spreadsheet chunks whose column span matches column-oriented queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'columns-ab',
					embedding: [1, 0],
					metadata: {
						sheetName: 'Release Tracker',
						spreadsheetColumnEnd: 'B',
						spreadsheetColumnStart: 'A',
						spreadsheetHeaders: ['Metric', 'Status'],
						spreadsheetTableCount: 2,
						spreadsheetTableIndex: 1
					},
					text: 'Metric | Status\nApproval | Blocked'
				},
				{
					chunkId: 'columns-cd',
					embedding: [1, 0],
					metadata: {
						sheetName: 'Release Tracker',
						spreadsheetColumnEnd: 'D',
						spreadsheetColumnStart: 'C',
						spreadsheetHeaders: ['Owner', 'Due date'],
						spreadsheetTableCount: 2,
						spreadsheetTableIndex: 2
					},
					text: 'Owner | Due date\nOps | 2026-04-20'
				}
			]
		});

		const results = await collection.search({
			query: 'Which spreadsheet table covers columns C and D for owner due date?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('columns-cd');
	});

	it('prefers presentation slide titles and notes for slide-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General release coordination overview for launch planning.'
				},
				{
					chunkId: 'slide-hit',
					embedding: [1, 0],
					metadata: {
						slideNotesText:
							'Review stable blockers before the rollout meeting.',
						slideNumber: 3,
						slideTitle: 'Release handoff summary'
					},
					text: 'Release handoff summary\nStable blockers\nSpeaker notes: Review stable blockers before the rollout meeting.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which slide notes review the stable blockers before rollout?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('slide-hit');
	});

	it('prefers the right presentation cue family for title, body, and notes queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'slide-title',
					embedding: [1, 0],
					metadata: {
						sectionKind: 'presentation_slide',
						slideNumber: 1,
						slideTitle: 'Release handoff summary'
					},
					text: 'Release handoff summary\nTitle anchor'
				},
				{
					chunkId: 'slide-body',
					embedding: [1, 0],
					metadata: {
						sectionKind: 'presentation_slide',
						slideNumber: 2,
						slideTitle: 'Release handoff summary'
					},
					text: 'Release handoff summary\nEscalation review'
				},
				{
					chunkId: 'slide-notes',
					embedding: [1, 0],
					metadata: {
						sectionKind: 'presentation_slide',
						slideNotesText:
							'Use the speaker notes as the primary handoff evidence when the audit handoff slide body is terse.',
						slideNumber: 4,
						slideTitle: 'Release handoff summary'
					},
					text: 'Release handoff summary\nAudit handoff\nNotes-first handoff'
				}
			]
		});

		const titleTrace = await collection.searchWithTrace({
			query: 'Which presentation title covers the release handoff summary?',
			topK: 1
		});
		const bodyTrace = await collection.searchWithTrace({
			query: 'Which slide mentions escalation review in the body?',
			topK: 1
		});
		const notesTrace = await collection.searchWithTrace({
			query: 'Which slide notes are the primary handoff evidence?',
			topK: 1
		});

		expect(titleTrace.results[0]?.chunkId).toBe('slide-title');
		expect(
			titleTrace.trace.steps.find((step) => step.stage === 'rerank')
				?.metadata?.leadPresentationCue
		).toBe('title');
		expect(bodyTrace.results[0]?.chunkId).toBe('slide-body');
		expect(
			bodyTrace.trace.steps.find((step) => step.stage === 'rerank')
				?.metadata?.leadPresentationCue
		).toBe('body');
		expect(notesTrace.results[0]?.chunkId).toBe('slide-notes');
		expect(
			notesTrace.trace.steps.find((step) => step.stage === 'rerank')
				?.metadata?.leadPresentationCue
		).toBe('notes');
	});

	it('does not reconcile repeated-title presentation slides across slide ordinals', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'slide-1',
					chunkText: 'Repeated title slide one evidence.',
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
					source: 'slides/release-handoff.pptx'
				},
				{
					chunkId: 'slide-2',
					chunkText: 'Repeated title slide two evidence.',
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
					source: 'slides/release-handoff.pptx'
				},
				{
					chunkId: 'slide-4',
					chunkText: 'Repeated title slide four evidence.',
					metadata: {
						sectionFamilyPath: ['Release handoff summary'],
						sectionKind: 'presentation_slide',
						sectionOrdinalPath: [4],
						sectionSiblingFamilyKey: 'Release handoff summary',
						sectionSiblingOrdinal: 4,
						slideNotesText:
							'Use the speaker notes as the primary handoff evidence when the audit handoff slide body is terse.',
						slideNumber: 4,
						slideTitle: 'Release handoff summary'
					},
					score: 0.89,
					source: 'slides/release-handoff.pptx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which release handoff summary slide is first',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'slide-1',
			'slide-2'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeUndefined();
	});

	it('does not reconcile repeated spreadsheet tables across table ordinals', async () => {
		const store: RAGVectorStore = {
			embed: async () => [1, 0],
			query: async () => [
				{
					chunkId: 'sheet-table-ordinal-two',
					chunkText: 'Spreadsheet table ordinal two hit.',
					metadata: {
						sectionFamilyPath: ['Checklist', 'Spreadsheet Table'],
						sectionKind: 'spreadsheet_rows',
						sectionOrdinalPath: [1, 2],
						sectionSiblingFamilyKey: 'Spreadsheet Table',
						sectionSiblingOrdinal: 2,
						sheetName: 'Checklist',
						spreadsheetHeaders: ['Metric', 'Status'],
						spreadsheetTableCount: 3,
						spreadsheetTableIndex: 2
					},
					score: 0.93,
					source: 'docs/tracker.xlsx'
				},
				{
					chunkId: 'sheet-table-ordinal-three',
					chunkText: 'Spreadsheet table ordinal three hit.',
					metadata: {
						sectionFamilyPath: ['Checklist', 'Spreadsheet Table'],
						sectionKind: 'spreadsheet_rows',
						sectionOrdinalPath: [1, 3],
						sectionSiblingFamilyKey: 'Spreadsheet Table',
						sectionSiblingOrdinal: 3,
						sheetName: 'Checklist',
						spreadsheetHeaders: ['Owner', 'Due date'],
						spreadsheetTableCount: 3,
						spreadsheetTableIndex: 3
					},
					score: 0.91,
					source: 'docs/tracker.xlsx'
				}
			],
			upsert: async () => {}
		};
		const collection = createRAGCollection({ store });

		const traced = await collection.searchWithTrace({
			query: 'which checklist spreadsheet table is latest',
			retrieval: 'vector',
			topK: 2
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'sheet-table-ordinal-two',
			'sheet-table-ordinal-three'
		]);
		expect(
			traced.trace.steps.find(
				(step) => step.stage === 'evidence_reconcile'
			)
		).toBeUndefined();
	});

	it('prefers email thread-local evidence for reply-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General release communication guidance and response process.'
				},
				{
					chunkId: 'thread-hit',
					embedding: [1, 0],
					metadata: {
						attachmentName: 'checklist.md',
						emailKind: 'attachment',
						replyDepth: 2,
						threadTopic: 'Attachment recap'
					},
					text: 'Keep attachment lineage and thread metadata visible.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which email thread attachment contains the recap checklist reply?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('thread-hit');
	});

	it('prefers richer email thread-chain evidence for reply-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'simple-email',
					embedding: [1, 0],
					metadata: {
						threadTopic: 'Attachment recap'
					},
					text: 'Keep attachment lineage visible.'
				},
				{
					chunkId: 'thread-root-hit',
					embedding: [1, 0],
					metadata: {
						replyDepth: 1,
						threadMessageCount: 2,
						threadRootMessageId: '<thread-root@example.com>',
						threadTopic: 'Attachment recap'
					},
					text: 'Keep attachment lineage visible.'
				},
				{
					chunkId: 'thread-chain-hit',
					embedding: [1, 0],
					metadata: {
						replyDepth: 3,
						threadMessageCount: 4,
						threadMessageIds: [
							'<thread-root@example.com>',
							'<thread-parent@example.com>',
							'<thread-middle@example.com>',
							'<thread-leaf@example.com>'
						],
						threadRootMessageId: '<thread-root@example.com>',
						threadTopic: 'Attachment recap'
					},
					text: 'Keep attachment lineage visible.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which email thread ancestor chain reply explains the older attachment recap lineage?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('thread-chain-hit');
	});

	it('prefers authored email body evidence over quoted and forwarded sections for generic reply queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'forwarded-section',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 2,
						emailForwardedOrdinal: 2,
						emailSectionKind: 'forwarded_headers',
						sectionKind: 'email_block',
						threadMessageCount: 3,
						threadTopic: 'Incident reply summary'
					},
					text: 'Forwarded header block for an earlier escalation.'
				},
				{
					chunkId: 'quoted-section',
					embedding: [1, 0],
					metadata: {
						emailQuotedDepth: 2,
						emailSectionKind: 'quoted_history',
						sectionKind: 'email_block',
						threadMessageCount: 3,
						threadTopic: 'Incident reply summary'
					},
					text: 'Quoted prior response from the thread history.'
				},
				{
					chunkId: 'authored-section',
					embedding: [1, 0],
					metadata: {
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadMessageCount: 3,
						threadTopic: 'Incident reply summary'
					},
					text: 'Current authored reply with the actual incident summary.'
				}
			]
		});

		const results = await collection.search({
			query: 'What does the latest email reply actually say in the incident thread summary?',
			topK: 3
		});

		expect(results.map((result) => result.chunkId)).toEqual([
			'authored-section',
			'quoted-section',
			'forwarded-section'
		]);
	});

	it('prefers forwarded email header evidence for sender-oriented forwarded queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'authored-section',
					embedding: [1, 0],
					metadata: {
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Forwarded incident chain'
					},
					text: 'Authored reply that references the forwarded incident chain.'
				},
				{
					chunkId: 'forwarded-section',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 2,
						emailForwardedFromAddress: 'origin@example.com',
						emailForwardedOrdinal: 1,
						emailForwardedSubject: 'Original forwarded incident',
						emailSectionKind: 'forwarded_headers',
						sectionKind: 'email_block',
						threadTopic: 'Forwarded incident chain'
					},
					text: 'Forwarded headers for the original sender.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which forwarded email headers show the original sender in the incident chain?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('forwarded-section');
	});

	it('uses attached-message lineage depth instead of hardcoded email nesting levels', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: Array.from({ length: 5 }, (_, index) => ({
				chunkId: `attached-lineage-${index + 1}`,
				embedding: [1, 0] as [number, number],
				metadata: {
					emailMessageLineage: Array.from(
						{ length: index + 1 },
						(_, lineageIndex) => ({
							attachmentSource:
								lineageIndex === 0
									? 'bundle.eml#attachments/forwarded-2.eml'
									: `bundle.eml#attachments/forwarded-2.eml${Array.from(
											{ length: lineageIndex },
											(_, attachmentIndex) =>
												`#attachments/forwarded-${attachmentIndex + 3}.eml`
										).join('')}`,
							messageId: `<ancestor-${lineageIndex + 1}@example.com>`,
							messageSource:
								lineageIndex === 0
									? 'bundle.eml'
									: `bundle.eml${Array.from(
											{ length: lineageIndex },
											(_, attachmentIndex) =>
												`#attachments/forwarded-${attachmentIndex + 2}.eml`
										).join('')}`,
							messageSourceKind:
								lineageIndex === 0
									? 'root_message'
									: 'attached_message'
						})
					),
					emailMessageLineageCount: index + 1,
					emailSectionKind: 'authored_text',
					sectionKind: 'email_block',
					threadTopic: 'Nested forwarded incident chain'
				},
				text: `Nested attached authored message depth ${index + 1}.`
			}))
		});

		const results = await collection.search({
			query: 'Which nested attached forwarded email in the chain contains the ancestry context?',
			topK: 5
		});

		expect(results.map((result) => result.chunkId)).toEqual([
			'attached-lineage-5',
			'attached-lineage-4',
			'attached-lineage-3',
			'attached-lineage-2',
			'attached-lineage-1'
		]);
	});

	it('prefers authored attached-email evidence over forwarded headers within matching sibling branches', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'branch-a-authored',
					embedding: [1, 0],
					metadata: {
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/quartz-branch.eml'
						],
						emailMessageLineageCount: 1,
						emailMessageSourceKind: 'attached_message',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Sibling attached incident branch'
					},
					text: 'Branch A authored reply with the actual attached summary.'
				},
				{
					chunkId: 'branch-a-forwarded',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 2,
						emailForwardedOrdinal: 1,
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/branch-a.eml'
						],
						emailMessageLineageCount: 1,
						emailMessageSourceKind: 'attached_message',
						emailSectionKind: 'forwarded_headers',
						sectionKind: 'email_block',
						threadTopic: 'Sibling attached incident branch'
					},
					text: 'Branch A forwarded headers for an older escalation.'
				},
				{
					chunkId: 'branch-b-authored',
					embedding: [1, 0],
					metadata: {
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/branch-b.eml'
						],
						emailMessageLineageCount: 1,
						emailMessageSourceKind: 'attached_message',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Sibling attached incident branch'
					},
					text: 'Branch B authored reply with the actual attached summary.'
				},
				{
					chunkId: 'branch-b-forwarded',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 2,
						emailForwardedOrdinal: 1,
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/branch-b.eml'
						],
						emailMessageLineageCount: 1,
						emailMessageSourceKind: 'attached_message',
						emailSectionKind: 'forwarded_headers',
						sectionKind: 'email_block',
						threadTopic: 'Sibling attached incident branch'
					},
					text: 'Branch B forwarded headers for an older escalation.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which branch-a attached email reply has the actual local authored summary?',
			topK: 2
		});

		expect(results[0]?.chunkId).toBe('branch-a-authored');
		expect(
			results.some((result) => result.chunkId === 'branch-b-forwarded')
		).toBe(false);
	});

	it('prefers the right sibling branch and email section family across authored, quoted, and forwarded evidence', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'branch-a-authored',
					embedding: [1, 0],
					metadata: {
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/branch-a.eml'
						],
						emailMessageLineageCount: 1,
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Sibling branch incident'
					},
					text: 'Branch A authored summary for the active escalation.'
				},
				{
					chunkId: 'branch-a-forwarded',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 1,
						emailForwardedFromAddress: 'branch-a-prior@example.com',
						emailForwardedOrdinal: 1,
						emailSectionKind: 'forwarded_headers',
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/quartz-branch.eml'
						],
						emailMessageLineageCount: 1,
						sectionKind: 'email_block',
						threadTopic: 'Sibling branch incident'
					},
					text: 'Forwarded Branch A sender headers.'
				},
				{
					chunkId: 'branch-b-authored',
					embedding: [1, 0],
					metadata: {
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/lantern-branch.eml'
						],
						emailMessageLineageCount: 1,
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Sibling branch incident'
					},
					text: 'Branch B authored summary for the active escalation.'
				},
				{
					chunkId: 'branch-b-quoted',
					embedding: [1, 0],
					metadata: {
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/lantern-branch.eml'
						],
						emailMessageLineageCount: 1,
						emailQuotedDepth: 2,
						emailSectionKind: 'quoted_history',
						sectionKind: 'email_block',
						threadTopic: 'Sibling branch incident'
					},
					text: '> Lantern-only quoted escalation note for branch B.'
				},
				{
					chunkId: 'branch-b-forwarded',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 1,
						emailForwardedFromAddress: 'branch-b-prior@example.com',
						emailForwardedOrdinal: 1,
						emailSectionKind: 'forwarded_headers',
						emailMessageLineageAttachmentSources: [
							'bundle.eml#attachments/lantern-branch.eml'
						],
						emailMessageLineageCount: 1,
						sectionKind: 'email_block',
						threadTopic: 'Sibling branch incident'
					},
					text: 'Forwarded Branch B sender headers.'
				}
			]
		});

		const authoredResults = await collection.search({
			query: 'Which branch-a attached email has the actual authored escalation summary?',
			topK: 1
		});
		const quotedResults = await collection.search({
			query: 'Which lantern attached email quoted history shows "Lantern-only quoted escalation note for branch B"?',
			topK: 1
		});
		const forwardedResults = await collection.search({
			query: 'Which branch-a attached email forwarded headers show the original sender?',
			topK: 1
		});

		expect(authoredResults[0]?.chunkId).toBe('branch-a-authored');
		expect(quotedResults[0]?.chunkId).toBe('branch-b-quoted');
		expect(forwardedResults[0]?.chunkId).toBe('branch-a-forwarded');
	});

	it('prefers mailbox-local email evidence when mailbox container and folder cues match the query', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'lantern-mailbox-hit',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-mailbox',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Mailbox-local incident summary'
					},
					text: 'Lantern mailbox authored summary for the active incident.'
				},
				{
					chunkId: 'quartz-mailbox-hit',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'quartz-mailbox',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Mailbox-local incident summary'
					},
					text: 'Quartz mailbox authored summary for the active incident.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which lantern mailbox folder reply has the actual local incident summary?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('lantern-mailbox-hit');
	});

	it('prefers the right mailbox family and email section under maildir thread collisions', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'lantern-authored',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'Lantern',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Maildir collision thread'
					},
					text: 'Lantern mailbox authored summary for the active incident.'
				},
				{
					chunkId: 'lantern-forwarded',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 1,
						emailForwardedFromAddress: 'lantern-prior@example.com',
						emailForwardedOrdinal: 1,
						emailMailboxContainerSource: 'Lantern',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailSectionKind: 'forwarded_headers',
						sectionKind: 'email_block',
						threadTopic: 'Maildir collision thread'
					},
					text: 'Lantern mailbox forwarded sender headers.'
				},
				{
					chunkId: 'quartz-authored',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'Quartz',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Maildir collision thread'
					},
					text: 'Quartz mailbox authored summary for the active incident.'
				},
				{
					chunkId: 'quartz-forwarded',
					embedding: [1, 0],
					metadata: {
						emailForwardedChainCount: 1,
						emailForwardedFromAddress: 'quartz-prior@example.com',
						emailForwardedOrdinal: 1,
						emailMailboxContainerSource: 'Quartz',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailSectionKind: 'forwarded_headers',
						sectionKind: 'email_block',
						threadTopic: 'Maildir collision thread'
					},
					text: 'Quartz mailbox forwarded sender headers.'
				}
			]
		});

		const authoredResults = await collection.search({
			query: 'Which Lantern maildir mailbox folder has the actual local incident summary?',
			topK: 1
		});
		const forwardedResults = await collection.search({
			query: 'Which Quartz maildir mailbox folder forwarded headers show the original sender?',
			topK: 1
		});

		expect(authoredResults[0]?.chunkId).toBe('lantern-authored');
		expect(forwardedResults[0]?.chunkId).toBe('quartz-forwarded');
	});

	it('prefers the right nested mailbox family using mailbox lineage metadata instead of hardcoded folder levels', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		const families = [
			['Inbox'],
			['Ops', 'Release'],
			['Ops', 'Release', 'Escalations'],
			['Ops', 'Release', 'Escalations', 'Nightly']
		];

		await collection.ingest({
			chunks: families.map((familyPath, index) => ({
				chunkId: `mailbox-family-${index + 1}`,
				embedding: [1, 0] as [number, number],
				metadata: {
					emailMailboxContainerSource: familyPath.join('/'),
					emailMailboxFamilyKey: familyPath
						.map((segment) => segment.toLowerCase())
						.join('/'),
					emailMailboxFolder: 'cur',
					emailMailboxFormat: 'maildir',
					emailMailboxLeaf: familyPath.at(-1),
					emailMailboxPathDepth: familyPath.length,
					emailMailboxPathSegments: familyPath,
					emailSectionKind: 'authored_text',
					sectionKind: 'email_block',
					threadTopic: 'Nested mailbox lineage thread'
				},
				text: `${familyPath.join('/')} authored mailbox summary.`
			}))
		});

		const results = await collection.search({
			query: 'Which nightly escalations maildir mailbox folder has the authored summary?',
			topK: families.length
		});

		expect(results[0]?.chunkId).toBe('mailbox-family-4');
		expect(results[1]?.chunkId).toBe('mailbox-family-3');
		expect(
			new Set(results.slice(2).map((result) => result.chunkId))
		).toEqual(new Set(['mailbox-family-1', 'mailbox-family-2']));
	});

	it('prefers mailbox-state-matching email evidence within the same mailbox family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'mailbox-passed',
					embedding: [1, 0],
					metadata: {
						emailMailboxFamilyKey: 'ops/release',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailMailboxIsPassed: true,
						emailMailboxIsRead: true,
						emailMailboxStateFlags: ['passed', 'read'],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Release mailbox state thread'
					},
					text: 'Passed authored reply for the release mailbox.'
				},
				{
					chunkId: 'mailbox-flagged',
					embedding: [1, 0],
					metadata: {
						emailMailboxFamilyKey: 'ops/release',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailMailboxIsFlagged: true,
						emailMailboxIsRead: true,
						emailMailboxStateFlags: ['flagged', 'read'],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Release mailbox state thread'
					},
					text: 'Flagged authored reply for the release mailbox.'
				},
				{
					chunkId: 'mailbox-draft',
					embedding: [1, 0],
					metadata: {
						emailMailboxFamilyKey: 'ops/release',
						emailMailboxFolder: 'cur',
						emailMailboxFormat: 'maildir',
						emailMailboxIsDraft: true,
						emailMailboxIsUnread: true,
						emailMailboxStateFlags: ['draft', 'unread'],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Release mailbox state thread'
					},
					text: 'Draft authored reply for the release mailbox.'
				}
			]
		});

		const passedResults = await collection.search({
			query: 'Which passed ops release maildir reply has the local authored summary?',
			topK: 1
		});
		const flaggedResults = await collection.search({
			query: 'Which flagged ops release maildir reply has the local authored summary?',
			topK: 1
		});
		const draftResults = await collection.search({
			query: 'Which draft ops release maildir reply has the local authored summary?',
			topK: 1
		});

		expect(passedResults[0]?.chunkId).toBe('mailbox-passed');
		expect(flaggedResults[0]?.chunkId).toBe('mailbox-flagged');
		expect(draftResults[0]?.chunkId).toBe('mailbox-draft');
	});

	it('prefers sibling reply ordinals within the same mailbox family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [1, 2, 3].map((ordinal) => ({
				chunkId: `reply-sibling-${ordinal}`,
				embedding: [1, 0] as [number, number],
				metadata: {
					emailMailboxFamilyKey: 'ops/release',
					emailMailboxFolder: 'cur',
					emailMailboxFormat: 'maildir',
					emailReplySiblingCount: 3,
					emailReplySiblingIndex: ordinal - 1,
					emailReplySiblingOrdinal: ordinal,
					emailSectionKind: 'authored_text',
					sectionKind: 'email_block',
					threadTopic: 'Sibling reply mailbox thread'
				},
				text: `Sibling reply ${ordinal} authored summary for the release mailbox.`
			}))
		});

		const secondReplyResults = await collection.search({
			query: 'Which second ops release maildir reply has the authored summary?',
			topK: 1
		});
		const latestReplyResults = await collection.search({
			query: 'Which latest ops release maildir reply has the authored summary?',
			topK: 1
		});

		expect(secondReplyResults[0]?.chunkId).toBe('reply-sibling-2');
		expect(latestReplyResults[0]?.chunkId).toBe('reply-sibling-3');
	});

	it('prefers pst mailbox message ordinals within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [1, 2, 3, 4].map((ordinal) => ({
				chunkId: `pst-message-${ordinal}`,
				embedding: [1, 0] as [number, number],
				metadata: {
					emailMailboxContainerSource: 'incident-thread.pst',
					emailMailboxFormat: 'pst',
					emailMailboxMessageCount: 4,
					emailMailboxMessageIndex: ordinal - 1,
					emailMailboxMessageOrdinal: ordinal,
					emailSectionKind: 'authored_text',
					sectionKind: 'email_block',
					threadTopic: 'Incident mailbox thread'
				},
				text: `PST authored message ${ordinal} summary.`
			}))
		});

		const secondMessageResults = await collection.search({
			query: 'Which second pst mailbox message has the authored summary?',
			topK: 1
		});
		const latestMessageResults = await collection.search({
			query: 'Which latest pst mailbox message has the authored summary?',
			topK: 1
		});

		expect(secondMessageResults[0]?.chunkId).toBe('pst-message-2');
		expect(latestMessageResults[0]?.chunkId).toBe('pst-message-4');
	});

	it('prefers ost sibling replies within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [1, 2, 3].map((ordinal) => ({
				chunkId: `ost-sibling-${ordinal}`,
				embedding: [1, 0] as [number, number],
				metadata: {
					emailMailboxContainerSource: 'incident-thread.ost',
					emailMailboxFormat: 'ost',
					emailMailboxMessageCount: 4,
					emailMailboxMessageIndex: ordinal,
					emailMailboxMessageOrdinal: ordinal + 1,
					emailReplySiblingCount: 3,
					emailReplySiblingIndex: ordinal - 1,
					emailReplySiblingOrdinal: ordinal,
					emailSectionKind: 'authored_text',
					sectionKind: 'email_block',
					threadTopic: 'OST sibling mailbox thread'
				},
				text: `OST sibling reply ${ordinal} authored summary.`
			}))
		});

		const firstSiblingResults = await collection.search({
			query: 'Which first ost reply branch has the authored summary?',
			topK: 1
		});
		const latestSiblingResults = await collection.search({
			query: 'Which latest ost reply branch has the authored summary?',
			topK: 1
		});

		expect(firstSiblingResults[0]?.chunkId).toBe('ost-sibling-1');
		expect(latestSiblingResults[0]?.chunkId).toBe('ost-sibling-3');
	});

	it('prefers pst mailbox folder-local evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-escalations',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.pst',
						emailMailboxFamilyKey: 'ops/release/escalations',
						emailMailboxFolder: 'Escalations',
						emailMailboxFormat: 'pst',
						emailMailboxLeaf: 'Escalations',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments: [
							'Ops',
							'Release',
							'Escalations'
						],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'PST folder mailbox thread'
					},
					text: 'PST escalations folder authored summary.'
				},
				{
					chunkId: 'pst-drafts',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.pst',
						emailMailboxFamilyKey: 'ops/release/drafts',
						emailMailboxFolder: 'Drafts',
						emailMailboxFormat: 'pst',
						emailMailboxLeaf: 'Drafts',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments: ['Ops', 'Release', 'Drafts'],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'PST folder mailbox thread'
					},
					text: 'PST drafts folder authored summary.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which escalations pst mailbox folder has the authored summary?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('pst-escalations');
	});

	it('prefers ost mailbox-state and folder-local evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'ost-flagged-inbox',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.ost',
						emailMailboxFamilyKey: 'inbox/regional/west',
						emailMailboxFolder: 'West',
						emailMailboxFormat: 'ost',
						emailMailboxLeaf: 'West',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments: ['Inbox', 'Regional', 'West'],
						emailMailboxIsFlagged: true,
						emailMailboxIsRead: true,
						emailMailboxStateFlags: ['flagged', 'read'],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'OST folder mailbox thread'
					},
					text: 'OST inbox west flagged authored summary.'
				},
				{
					chunkId: 'ost-passed-archive',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.ost',
						emailMailboxFamilyKey: 'archive/regional/west',
						emailMailboxFolder: 'West',
						emailMailboxFormat: 'ost',
						emailMailboxLeaf: 'West',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments: [
							'Archive',
							'Regional',
							'West'
						],
						emailMailboxIsPassed: true,
						emailMailboxIsUnread: true,
						emailMailboxStateFlags: ['passed', 'unread'],
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'OST folder mailbox thread'
					},
					text: 'OST archive west passed authored summary.'
				}
			]
		});

		const flaggedResults = await collection.search({
			query: 'Which flagged inbox west ost mailbox folder has the authored summary?',
			topK: 1
		});
		const passedResults = await collection.search({
			query: 'Which passed archive west ost mailbox folder has the authored summary?',
			topK: 1
		});

		expect(flaggedResults[0]?.chunkId).toBe('ost-flagged-inbox');
		expect(passedResults[0]?.chunkId).toBe('ost-passed-archive');
	});

	it('prefers pst mailbox importance and category-local evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-high-escalation',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.pst',
						emailMailboxFormat: 'pst',
						emailCategories: ['Release', 'Escalation'],
						emailImportance: 'high',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Regional release incident'
					},
					text: 'High-importance escalation authored summary.'
				},
				{
					chunkId: 'pst-normal-draft',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.pst',
						emailMailboxFormat: 'pst',
						emailCategories: ['Draft'],
						emailImportance: 'normal',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Regional release incident'
					},
					text: 'Normal-importance draft authored summary.'
				}
			]
		});

		const importanceResults = await collection.search({
			query: 'Which high priority pst escalation message has the authored summary?',
			topK: 1
		});

		expect(importanceResults[0]?.chunkId).toBe('pst-high-escalation');
	});

	it('prefers pst mailbox message-class and conversation-index evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-note-lantern',
					embedding: [1, 0],
					metadata: {
						emailConversationIndex: 'lantern-conv-07',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailMessageClass: 'IPM.Note',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern authored note summary.'
				},
				{
					chunkId: 'pst-task-lantern',
					embedding: [1, 0],
					metadata: {
						emailConversationIndex: 'lantern-conv-11',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailMessageClass: 'IPM.Task',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern authored task summary.'
				}
			]
		});

		const classResults = await collection.search({
			query: 'Which pst mailbox note class message has the authored summary for lantern regional recovery?',
			topK: 1
		});
		expect(classResults[0]?.chunkId).toBe('pst-note-lantern');

		const conversationIndexResults = await collection.search({
			query: 'Which pst mailbox conversation index lantern conv 11 message has the authored summary?',
			topK: 1
		});
		expect(conversationIndexResults[0]?.chunkId).toBe('pst-task-lantern');
	});

	it('prefers pst mailbox normalized-subject evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-normalized-lantern',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailNormalizedSubject:
							'Lantern regional recovery followup',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern normalized subject authored summary.'
				},
				{
					chunkId: 'pst-normalized-quartz',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailNormalizedSubject: 'Quartz incident fallback',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz normalized subject authored summary.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which pst mailbox normalized subject quartz incident fallback has the authored summary?',
			topK: 1
		});
		expect(results[0]?.chunkId).toBe('pst-normalized-quartz');
	});

	it('prefers pst mailbox conversation-id evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-conversation-alpha',
					embedding: [1, 0],
					metadata: {
						emailConversationId: 'pst-conversation-alpha-001',
						emailMailboxContainerSource: 'incident-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'PST conversation identity thread'
					},
					text: 'Alpha conversation authored summary.'
				},
				{
					chunkId: 'pst-conversation-beta',
					embedding: [1, 0],
					metadata: {
						emailConversationId: 'pst-conversation-beta-002',
						emailMailboxContainerSource: 'incident-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'PST conversation identity thread'
					},
					text: 'Beta conversation authored summary.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which pst mailbox conversation id beta 002 has the authored summary?',
			topK: 1
		});
		expect(results[0]?.chunkId).toBe('pst-conversation-beta');
	});

	it('prefers pst mailbox timestamp cues within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-delivered-lantern',
					embedding: [1, 0],
					metadata: {
						emailDeliveryTime: 'Tue, 21 Apr 2026 09:46:15 -0400',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailReceivedAt: 'Tue, 21 Apr 2026 09:46:15 -0400',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern delivered authored summary.'
				},
				{
					chunkId: 'pst-modified-lantern',
					embedding: [1, 0],
					metadata: {
						emailCreationTime: 'Tue, 21 Apr 2026 09:40:00 -0400',
						emailLastModifiedTime:
							'Tue, 21 Apr 2026 09:50:00 -0400',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern modified authored summary.'
				}
			]
		});

		const deliveredResults = await collection.search({
			query: 'Which pst delivered message has the authored summary for lantern regional recovery?',
			topK: 1
		});
		expect(deliveredResults[0]?.chunkId).toBe('pst-delivered-lantern');

		const modifiedResults = await collection.search({
			query: 'Which pst modified message has the authored summary for lantern regional recovery?',
			topK: 1
		});
		expect(modifiedResults[0]?.chunkId).toBe('pst-modified-lantern');
	});

	it('prefers pst mailbox internet-message-id evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-message-id-lantern',
					embedding: [1, 0],
					metadata: {
						emailInternetMessageId:
							'<lantern-route-77@example.com>',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern internet message id authored summary.'
				},
				{
					chunkId: 'pst-message-id-quartz',
					embedding: [1, 0],
					metadata: {
						emailInternetMessageId: '<quartz-route-12@example.com>',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz internet message id authored summary.'
				}
			]
		});

		const messageIdResults = await collection.search({
			query: 'Which pst internet message id lantern route 77 message has the authored summary?',
			topK: 1
		});
		expect(messageIdResults[0]?.chunkId).toBe('pst-message-id-lantern');
	});

	it('prefers pst mailbox message-id evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-raw-message-id-lantern',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						messageId: '<lantern-raw-route-31@example.com>',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern raw message id authored summary.'
				},
				{
					chunkId: 'pst-raw-message-id-quartz',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						messageId: '<quartz-raw-route-84@example.com>',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz raw message id authored summary.'
				}
			]
		});

		const messageIdResults = await collection.search({
			query: 'Which pst message id lantern raw route 31 message has the authored summary?',
			topK: 1
		});
		expect(messageIdResults[0]?.chunkId).toBe('pst-raw-message-id-lantern');
	});

	it('prefers pst mailbox thread-index evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-thread-index-lantern',
					embedding: [1, 0],
					metadata: {
						emailConversationIndex: 'AQHTHREAD.001',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadIndex: 'AQHTHREAD.001',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern thread index authored summary.'
				},
				{
					chunkId: 'pst-thread-index-quartz',
					embedding: [1, 0],
					metadata: {
						emailConversationIndex: 'AQHTHREAD.009',
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadIndex: 'AQHTHREAD.009',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz thread index authored summary.'
				}
			]
		});

		const threadIndexResults = await collection.search({
			query: 'Which pst thread index AQHTHREAD.001 message has the authored summary?',
			topK: 1
		});
		expect(threadIndexResults[0]?.chunkId).toBe('pst-thread-index-lantern');
	});

	it('prefers pst mailbox reply-parent evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-parent-lantern',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						inReplyTo: '<lantern-root@example.com>',
						sectionKind: 'email_block',
						threadRootMessageId: '<lantern-root@example.com>',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern reply-parent authored summary.'
				},
				{
					chunkId: 'pst-parent-quartz',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						inReplyTo: '<quartz-root@example.com>',
						sectionKind: 'email_block',
						threadRootMessageId: '<quartz-root@example.com>',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz reply-parent authored summary.'
				}
			]
		});

		const parentResults = await collection.search({
			query: 'Which pst reply parent lantern root message has the authored summary?',
			topK: 1
		});
		expect(parentResults[0]?.chunkId).toBe('pst-parent-lantern');
	});

	it('prefers pst mailbox reference-chain evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-reference-lantern',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						replyReferenceCount: 3,
						references:
							'<lantern-root@example.com> <lantern-parent@example.com> <lantern-reference-anchor@example.com>',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern reference-chain authored summary.'
				},
				{
					chunkId: 'pst-reference-quartz',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						replyReferenceCount: 3,
						references:
							'<quartz-root@example.com> <quartz-parent@example.com> <quartz-reference-anchor@example.com>',
						sectionKind: 'email_block',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz reference-chain authored summary.'
				}
			]
		});

		const referenceResults = await collection.search({
			query: 'Which pst reference chain lantern reference anchor has the authored summary?',
			topK: 1
		});
		expect(referenceResults[0]?.chunkId).toBe('pst-reference-lantern');
	});

	it('prefers pst mailbox thread-root evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-root-lantern',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadRootMessageId: '<lantern-root@example.com>',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Lantern thread-root authored summary.'
				},
				{
					chunkId: 'pst-root-quartz',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'lantern-thread.pst',
						emailMailboxFormat: 'pst',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadRootMessageId: '<quartz-root@example.com>',
						threadTopic: 'Lantern regional recovery'
					},
					text: 'Quartz thread-root authored summary.'
				}
			]
		});

		const rootResults = await collection.search({
			query: 'Which pst thread root lantern root message has the authored summary?',
			topK: 1
		});
		expect(rootResults[0]?.chunkId).toBe('pst-root-lantern');
	});

	it('prefers deeper quoted email history when the query explicitly asks for older thread context', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'quoted-shallow',
					embedding: [1, 0],
					metadata: {
						emailQuotedDepth: 1,
						emailSectionKind: 'quoted_history',
						sectionKind: 'email_block',
						threadTopic: 'Quoted depth incident thread'
					},
					text: 'Shallow quoted owner recap.'
				},
				{
					chunkId: 'quoted-deep',
					embedding: [1, 0],
					metadata: {
						emailQuotedDepth: 3,
						emailSectionKind: 'quoted_history',
						sectionKind: 'email_block',
						threadTopic: 'Quoted depth incident thread'
					},
					text: 'Deeper quoted escalation archive history.'
				}
			]
		});

		const quotedDepthResults = await collection.search({
			query: 'Which deeper older quoted history has the prior escalation archive context for the email thread?',
			topK: 1
		});
		expect(quotedDepthResults[0]?.chunkId).toBe('quoted-deep');
	});

	it('prefers inline email attachment ordinals within one attached-message branch', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'email-inline-first',
					embedding: [1, 0],
					metadata: {
						attachmentContentId: '<inline-hero@example.com>',
						attachmentEmbeddedReferenceMatched: true,
						attachmentIndex: 0,
						emailAttachmentRole: 'inline_resource',
						emailAttachmentSource:
							'incident.eml#attachments/child.eml#attachments/inline-hero.txt',
						emailMessageLineageAttachmentSources: [
							'incident.eml#attachments/child.eml'
						],
						emailMessageLineageCount: 1,
						emailMessageSource:
							'incident.eml#attachments/child.eml',
						emailMessageSourceKind: 'attached_message',
						threadTopic: 'Inline branch ordinal thread'
					},
					text: 'Hero inline preview note.'
				},
				{
					chunkId: 'email-inline-second',
					embedding: [1, 0],
					metadata: {
						attachmentContentId: '<inline-badge@example.com>',
						attachmentEmbeddedReferenceMatched: true,
						attachmentIndex: 1,
						emailAttachmentRole: 'inline_resource',
						emailAttachmentSource:
							'incident.eml#attachments/child.eml#attachments/inline-badge.txt',
						emailMessageLineageAttachmentSources: [
							'incident.eml#attachments/child.eml'
						],
						emailMessageLineageCount: 1,
						emailMessageSource:
							'incident.eml#attachments/child.eml',
						emailMessageSourceKind: 'attached_message',
						threadTopic: 'Inline branch ordinal thread'
					},
					text: 'Badge inline preview note.'
				}
			]
		});

		const secondInlineResults = await collection.search({
			query: 'Which second inline cid resource shows the badge preview note for the attached email branch?',
			topK: 1
		});
		expect(secondInlineResults[0]?.chunkId).toBe('email-inline-second');
	});

	it('prefers the right recovered pst attachment branch within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'pst-recovered-first',
					embedding: [1, 0],
					metadata: {
						archiveLineage: ['docs', 'guide.md'],
						emailAttachmentSource:
							recoveredPstMessageAttachmentSource({
								attachmentName: 'recovered.zip',
								containerSource: 'recoverable-multi.pst',
								ordinal: 1
							}),
						...buildRecoveredPstMailboxMetadata({
							caseKey: 'first',
							containerSource: 'recoverable-multi.pst',
							ordinal: 1
						})
					},
					text: 'First recovered pst guide attachment.'
				},
				{
					chunkId: 'pst-recovered-second',
					embedding: [1, 0],
					metadata: {
						archiveLineage: ['docs', 'guide.md'],
						emailAttachmentSource:
							recoveredPstMessageAttachmentSource({
								attachmentName: 'recovered.zip',
								containerSource: 'recoverable-multi.pst',
								ordinal: 2
							}),
						...buildRecoveredPstMailboxMetadata({
							caseKey: 'second',
							containerSource: 'recoverable-multi.pst',
							ordinal: 2
						})
					},
					text: 'Second recovered pst guide attachment.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which second pst recovered guide attachment is in the second mailbox branch?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('pst-recovered-second');
	});

	it('prefers arbitrary recovered pst descendant families with mailbox-family and state cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const caseCount = RECOVERED_PST_CASE_KEYS.length;
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const caseKeys = RECOVERED_PST_CASE_KEYS;

		await collection.ingest({
			chunks: Array.from({ length: caseCount }, (_, index) => {
				const ordinal = index + 1;
				const caseKey = caseKeys[index]!;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return familyKeys.map((familyKey) => ({
					chunkId: `pst-${caseKey}-${familyKey}`,
					embedding: [1, 0] as [number, number],
					metadata: {
						archiveLineage: ['docs', `${familyKey}.md`],
						emailAttachmentSource:
							recoveredPstMessageAttachmentSource({
								attachmentName: `bundle-${familyKey}.zip`,
								containerSource: 'recoverable-generated.pst',
								ordinal
							}),
						...recoveredPstMailboxMetadata({
							caseKey,
							containerSource: 'recoverable-generated.pst',
							ordinal,
							stateFlags
						})
					},
					text: `${caseKey} ${familyKey} recovered pst descendant guide for ${caseKey}.`
				}));
			}).flat()
		});

		for (let ordinal = 1; ordinal <= caseCount; ordinal += 1) {
			const caseKey = caseKeys[ordinal - 1]!;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			for (const familyKey of familyKeys) {
				const results = await collection.search({
					query: `Which ${expectedStateToken} ${caseKey} ${familyKey} pst recovered attachment guide matches this branch?`,
					topK: caseCount * familyKeys.length
				});

				expect(results[0]?.chunkId).toBe(`pst-${caseKey}-${familyKey}`);
			}
		}
	});

	it('prefers arbitrary recovered pst attached-message descendants with mailbox-family and state cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const caseCount = RECOVERED_PST_CASE_KEYS.length;
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const caseKeys = RECOVERED_PST_CASE_KEYS;

		await collection.ingest({
			chunks: Array.from({ length: caseCount }, (_, index) => {
				const ordinal = index + 1;
				const caseKey = caseKeys[index]!;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return familyKeys.flatMap((familyKey) => {
					const attachedMessageSource =
						recoveredPstMessageAttachmentSource({
							attachmentName: `thread-${familyKey}.eml`,
							containerSource:
								'recoverable-generated-attached.pst',
							ordinal
						});
					return [
						{
							chunkId: `pst-attached-${caseKey}-${familyKey}-authored`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: attachedMessageSource,
								...recoveredPstMailboxMetadata({
									caseKey,
									containerSource:
										'recoverable-generated-attached.pst',
									ordinal,
									stateFlags
								}),
								emailMessageLineageAttachmentSources: [
									attachedMessageSource
								],
								emailMessageLineageCount: 1,
								emailMessageSource: attachedMessageSource,
								emailMessageSourceKind: 'attached_message',
								emailSectionKind: 'authored_text',
								sectionKind: 'email_block',
								threadTopic:
									'Recovered PST attached descendant branches'
							},
							text: `${caseKey} ${familyKey} local attached child authored summary for the active mailbox branch.`
						},
						{
							chunkId: `pst-attached-${caseKey}-${familyKey}-forwarded`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: attachedMessageSource,
								emailForwardedChainCount: 2,
								emailForwardedOrdinal: 1,
								...recoveredPstMailboxMetadata({
									caseKey,
									containerSource:
										'recoverable-generated-attached.pst',
									ordinal,
									stateFlags
								}),
								emailMessageLineageAttachmentSources: [
									attachedMessageSource
								],
								emailMessageLineageCount: 1,
								emailMessageSource: attachedMessageSource,
								emailMessageSourceKind: 'attached_message',
								emailSectionKind: 'forwarded_headers',
								sectionKind: 'email_block',
								threadTopic:
									'Recovered PST attached descendant branches'
							},
							text: `${caseKey} ${familyKey} forwarded headers for an older attached mailbox branch.`
						}
					];
				});
			}).flat()
		});

		for (let ordinal = 1; ordinal <= caseCount; ordinal += 1) {
			const caseKey = caseKeys[ordinal - 1]!;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			for (const familyKey of familyKeys) {
				const results = await collection.search({
					query: `Which ${expectedStateToken} ${caseKey} ${familyKey} attached pst branch has the local authored child summary?`,
					topK: caseCount * familyKeys.length * 2
				});

				expect(results[0]?.chunkId).toBe(
					`pst-attached-${caseKey}-${familyKey}-authored`
				);
			}
		}
	});

	it('prefers arbitrary nested recovered pst attached-message depths with mailbox-family and state cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const caseCount = 5;
		const depthCount = 4;
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const caseKeys = RECOVERED_PST_CASE_KEYS.slice(0, caseCount);

		const buildLineageAttachmentSources = (input: {
			caseKey: string;
			depth: number;
			familyKey: string;
			ordinal: number;
		}) =>
			Array.from({ length: input.depth }, (_, index) =>
				index === 0
					? `recoverable-generated-attached-nested.pst#messages/${input.ordinal}#attachments/thread-${input.familyKey}-level-1.eml`
					: `recoverable-generated-attached-nested.pst#messages/${input.ordinal}#attachments/thread-${input.familyKey}-level-1.eml${Array.from(
							{ length: index },
							(_, nestedIndex) =>
								`#attachments/thread-${input.familyKey}-level-${nestedIndex + 2}.eml`
						).join('')}`
			);

		await collection.ingest({
			chunks: Array.from({ length: caseCount }, (_, index) => {
				const ordinal = index + 1;
				const caseKey = caseKeys[index]!;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return familyKeys.flatMap((familyKey) =>
					Array.from({ length: depthCount }, (_, depthIndex) => {
						const depth = depthIndex + 1;
						const lineageAttachmentSources =
							buildLineageAttachmentSources({
								caseKey,
								depth,
								familyKey,
								ordinal
							});
						const attachedMessageSource =
							lineageAttachmentSources[
								lineageAttachmentSources.length - 1
							]!;
						return {
							chunkId: `pst-attached-nested-${caseKey}-${familyKey}-${depth}`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: attachedMessageSource,
								...recoveredPstMailboxMetadata({
									caseKey,
									containerSource:
										'recoverable-generated-attached-nested.pst',
									ordinal,
									stateFlags
								}),
								emailMessageLineageAttachmentSources:
									lineageAttachmentSources,
								emailMessageLineageCount: depth,
								emailMessageSource: attachedMessageSource,
								emailMessageSourceKind: 'attached_message',
								emailSectionKind: 'authored_text',
								sectionKind: 'email_block',
								threadTopic:
									'Recovered PST nested attached descendant branches'
							},
							text: `${caseKey} ${familyKey} nested attached authored summary depth ${depth}.`
						};
					})
				);
			}).flat()
		});

		for (let ordinal = 1; ordinal <= caseCount; ordinal += 1) {
			const caseKey = caseKeys[ordinal - 1]!;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			for (const familyKey of familyKeys) {
				const results = await collection.search({
					query: `Which ${expectedStateToken} ${caseKey} ${familyKey} nested attached pst chain carries the deepest branch ancestry summary?`,
					topK: caseCount * familyKeys.length * depthCount
				});

				expect(results[0]?.chunkId).toBe(
					`pst-attached-nested-${caseKey}-${familyKey}-${depthCount}`
				);
			}
		}
	});

	it('prefers arbitrary nested recovered pst sibling branches with mailbox-family, branch, and state cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const caseCount = 5;
		const depthCount = 4;
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const branchKeys = RECOVERED_PST_BRANCH_KEYS;
		const caseKeys = RECOVERED_PST_CASE_KEYS.slice(0, caseCount);

		const buildLineageAttachmentSources = (input: {
			branchKey: string;
			depth: number;
			familyKey: string;
			ordinal: number;
		}) =>
			Array.from({ length: input.depth }, (_, index) =>
				index === 0
					? `recoverable-generated-attached-sibling.pst#messages/${input.ordinal}#attachments/thread-${input.familyKey}-${input.branchKey}-level-1.eml`
					: `recoverable-generated-attached-sibling.pst#messages/${input.ordinal}#attachments/thread-${input.familyKey}-${input.branchKey}-level-1.eml${Array.from(
							{ length: index },
							(_, nestedIndex) =>
								`#attachments/thread-${input.familyKey}-${input.branchKey}-level-${nestedIndex + 2}.eml`
						).join('')}`
			);

		await collection.ingest({
			chunks: Array.from({ length: caseCount }, (_, index) => {
				const ordinal = index + 1;
				const caseKey = caseKeys[index]!;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return familyKeys.flatMap((familyKey) =>
					branchKeys.flatMap((branchKey) =>
						Array.from({ length: depthCount }, (_, depthIndex) => {
							const depth = depthIndex + 1;
							const lineageAttachmentSources =
								buildLineageAttachmentSources({
									branchKey,
									depth,
									familyKey,
									ordinal
								});
							const attachedMessageSource =
								lineageAttachmentSources[
									lineageAttachmentSources.length - 1
								]!;
							return {
								chunkId: `pst-attached-sibling-${caseKey}-${familyKey}-${branchKey}-${depth}`,
								embedding: [1, 0] as [number, number],
								metadata: {
									emailAttachmentSource:
										attachedMessageSource,
									...recoveredPstMailboxMetadata({
										caseKey,
										containerSource:
											'recoverable-generated-attached-sibling.pst',
										ordinal,
										stateFlags
									}),
									emailMessageLineageAttachmentSources:
										lineageAttachmentSources,
									emailMessageLineageCount: depth,
									emailMessageSource: attachedMessageSource,
									emailMessageSourceKind: 'attached_message',
									emailSectionKind: 'authored_text',
									sectionKind: 'email_block',
									threadTopic:
										'Recovered PST nested sibling attached descendant branches'
								},
								text: `${caseKey} ${familyKey} ${branchKey} nested attached authored summary depth ${depth}.`
							};
						})
					)
				);
			}).flat()
		});

		for (let ordinal = 1; ordinal <= caseCount; ordinal += 1) {
			const caseKey = caseKeys[ordinal - 1]!;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			for (const familyKey of familyKeys) {
				for (const branchKey of branchKeys) {
					const results = await collection.search({
						query: `Which ${expectedStateToken} ${caseKey} ${familyKey} ${branchKey} nested attached pst branch carries the deepest local ancestry summary?`,
						topK:
							caseCount *
							familyKeys.length *
							branchKeys.length *
							depthCount
					});

					expect(results[0]?.chunkId).toBe(
						`pst-attached-sibling-${caseKey}-${familyKey}-${branchKey}-${depthCount}`
					);
				}
			}
		}
	});

	it('prefers arbitrary recovered pst descendant reply siblings with mailbox-family, state, and ordinal cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const caseCount = 5;
		const replyCount = 3;
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const caseKeys = RECOVERED_PST_CASE_KEYS.slice(0, caseCount);

		await collection.ingest({
			chunks: Array.from({ length: caseCount }, (_, index) => {
				const ordinal = index + 1;
				const caseKey = caseKeys[index]!;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return familyKeys.flatMap((familyKey) =>
					Array.from({ length: replyCount }, (_, replyIndex) => {
						const replyOrdinal = replyIndex + 1;
						const parentMessageSource = `recoverable-generated-sibling-replies.pst#messages/${ordinal}#attachments/thread-${familyKey}-parent.eml`;
						const replyMessageSource = `${parentMessageSource}#attachments/reply-${familyKey}-${replyOrdinal}.eml`;
						return {
							chunkId: `pst-sibling-reply-${caseKey}-${familyKey}-${replyOrdinal}`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: replyMessageSource,
								...recoveredPstMailboxMetadata({
									caseKey,
									containerSource:
										'recoverable-generated-sibling-replies.pst',
									ordinal,
									stateFlags
								}),
								emailMessageLineageAttachmentSources: [
									parentMessageSource,
									replyMessageSource
								],
								emailMessageLineageCount: 2,
								emailMessageSource: replyMessageSource,
								emailMessageSourceKind: 'attached_message',
								emailReplySiblingCount: replyCount,
								emailReplySiblingIndex: replyOrdinal - 1,
								emailReplySiblingOrdinal: replyOrdinal,
								emailSectionKind: 'authored_text',
								sectionKind: 'email_block',
								threadTopic:
									'Recovered PST descendant reply sibling branches'
							},
							text: `${caseKey} ${familyKey} attached reply authored summary ordinal ${replyOrdinal}.`
						};
					})
				);
			}).flat()
		});

		for (let ordinal = 1; ordinal <= caseCount; ordinal += 1) {
			const caseKey = caseKeys[ordinal - 1]!;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			for (const familyKey of familyKeys) {
				for (const queryTarget of [
					{ label: 'first', ordinal: 1 },
					{ label: 'second', ordinal: 2 },
					{ label: 'latest', ordinal: replyCount }
				]) {
					const results = await collection.search({
						query: `Which ${expectedStateToken} ${queryTarget.label} ${caseKey} ${familyKey} attached reply branch has the authored summary?`,
						topK: caseCount * familyKeys.length * replyCount
					});

					expect(results[0]?.chunkId).toBe(
						`pst-sibling-reply-${caseKey}-${familyKey}-${queryTarget.ordinal}`
					);
				}
			}
		}
	});

	it('prefers arbitrary recovered pst forwarded descendant reply siblings with mailbox-family, state, ordinal, and forwarded cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const caseCount = 5;
		const replyCount = 3;
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const caseKeys = RECOVERED_PST_CASE_KEYS.slice(0, caseCount);

		await collection.ingest({
			chunks: Array.from({ length: caseCount }, (_, index) => {
				const ordinal = index + 1;
				const caseKey = caseKeys[index]!;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return familyKeys.flatMap((familyKey) =>
					Array.from({ length: replyCount }, (_, replyIndex) => {
						const replyOrdinal = replyIndex + 1;
						const parentMessageSource = `recoverable-generated-forwarded-sibling-replies.pst#messages/${ordinal}#attachments/thread-${familyKey}-forwarded-parent.eml`;
						const replyMessageSource = `${parentMessageSource}#attachments/forwarded-reply-${familyKey}-${replyOrdinal}.eml`;
						return [
							{
								chunkId: `pst-forwarded-sibling-${caseKey}-${familyKey}-${replyOrdinal}-authored`,
								embedding: [1, 0] as [number, number],
								metadata: {
									emailAttachmentSource: replyMessageSource,
									...recoveredPstMailboxMetadata({
										caseKey,
										containerSource:
											'recoverable-generated-forwarded-sibling-replies.pst',
										ordinal,
										stateFlags
									}),
									emailMessageLineageAttachmentSources: [
										parentMessageSource,
										replyMessageSource
									],
									emailMessageLineageCount: 2,
									emailMessageSource: replyMessageSource,
									emailMessageSourceKind: 'attached_message',
									emailReplySiblingCount: replyCount,
									emailReplySiblingIndex: replyOrdinal - 1,
									emailReplySiblingOrdinal: replyOrdinal,
									emailSectionKind: 'authored_text',
									sectionKind: 'email_block',
									threadTopic:
										'Recovered PST forwarded descendant reply sibling branches'
								},
								text: `${caseKey} ${familyKey} forwarded attached reply authored summary ordinal ${replyOrdinal}.`
							},
							{
								chunkId: `pst-forwarded-sibling-${caseKey}-${familyKey}-${replyOrdinal}-headers`,
								embedding: [1, 0] as [number, number],
								metadata: {
									emailAttachmentSource: replyMessageSource,
									emailForwardedChainCount: 2,
									emailForwardedFromAddress: `forwarded-${familyKey}-${replyOrdinal}@example.com`,
									emailForwardedOrdinal: 1,
									emailForwardedSubject: `Forwarded ${familyKey} review ${replyOrdinal}`,
									...recoveredPstMailboxMetadata({
										caseKey,
										containerSource:
											'recoverable-generated-forwarded-sibling-replies.pst',
										ordinal,
										stateFlags
									}),
									emailMessageLineageAttachmentSources: [
										parentMessageSource,
										replyMessageSource
									],
									emailMessageLineageCount: 2,
									emailMessageSource: replyMessageSource,
									emailMessageSourceKind: 'attached_message',
									emailReplySiblingCount: replyCount,
									emailReplySiblingIndex: replyOrdinal - 1,
									emailReplySiblingOrdinal: replyOrdinal,
									emailSectionKind: 'forwarded_headers',
									sectionKind: 'email_block',
									threadTopic:
										'Recovered PST forwarded descendant reply sibling branches'
								},
								text: `${caseKey} ${familyKey} forwarded reply headers ordinal ${replyOrdinal}.`
							}
						];
					}).flat()
				);
			}).flat()
		});

		for (let ordinal = 1; ordinal <= caseCount; ordinal += 1) {
			const caseKey = caseKeys[ordinal - 1]!;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			for (const familyKey of familyKeys) {
				for (const queryTarget of [
					{ label: 'first', ordinal: 1 },
					{ label: 'second', ordinal: 2 },
					{ label: 'latest', ordinal: replyCount }
				]) {
					const authoredResults = await collection.search({
						query: `Which ${expectedStateToken} ${queryTarget.label} ${caseKey} ${familyKey} forwarded attached reply branch has the local authored summary?`,
						topK: caseCount * familyKeys.length * replyCount * 2
					});

					expect(authoredResults[0]?.chunkId).toBe(
						`pst-forwarded-sibling-${caseKey}-${familyKey}-${queryTarget.ordinal}-authored`
					);

					const forwardedResults = await collection.search({
						query: `Which ${expectedStateToken} ${queryTarget.label} ${caseKey} ${familyKey} forwarded attached reply headers show the original sender?`,
						topK: caseCount * familyKeys.length * replyCount * 2
					});

					expect(forwardedResults[0]?.chunkId).toBe(
						`pst-forwarded-sibling-${caseKey}-${familyKey}-${queryTarget.ordinal}-headers`
					);
				}
			}
		}
	});

	it('prefers replicated recovered pst descendant families by mailbox branch and state instead of shared attachment names', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const branchKeys = RECOVERED_PST_CASE_KEYS.slice(0, 5);

		await collection.ingest({
			chunks: branchKeys.map((branchKey, index) => {
				const ordinal = index + 1;
				const stateFlags = recoveredPstStateFlags(ordinal);
				return {
					chunkId: `pst-replicated-${branchKey}`,
					embedding: [1, 0] as [number, number],
					metadata: {
						archiveLineage: ['docs', 'guide.md'],
						emailAttachmentSource:
							recoveredPstMessageAttachmentSource({
								attachmentName: 'shared-guide.zip',
								containerSource: 'recoverable-replicated.pst',
								ordinal
							}),
						...recoveredPstMailboxMetadata({
							caseKey: branchKey,
							containerSource: 'recoverable-replicated.pst',
							ordinal,
							stateFlags
						})
					},
					text: `${branchKey} replicated recovered pst shared guide descendant.`
				};
			})
		});

		for (const [index, branchKey] of branchKeys.entries()) {
			const ordinal = index + 1;
			const expectedStateToken = recoveredPstStateCue(ordinal);
			const results = await collection.search({
				query: `Which ${expectedStateToken} ${branchKey} mailbox branch contains the replicated shared pst guide descendant?`,
				topK: branchKeys.length
			});

			expect(results[0]?.chunkId).toBe(`pst-replicated-${branchKey}`);
		}
	});

	it('prefers replicated recovered descendant families by mailbox container and state instead of shared attachment names', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const replicatedSourceKeyByFormat = {
			pst: 'lantern',
			ost: 'quartz'
		} as const;
		const replicatedContainerSourceByFormat = {
			pst: 'shared-lantern.pst',
			ost: 'shared-quartz.ost'
		} as const;
		const containerSpecs = MIXED_MAILBOX_REPLY_SPECS.filter(
			(spec) => spec.formatLabel === 'pst' || spec.formatLabel === 'ost'
		).map((spec) => ({
			chunkId: `shared-${replicatedSourceKeyByFormat[spec.formatLabel]}-${spec.formatLabel}`,
			containerSource:
				replicatedContainerSourceByFormat[spec.formatLabel],
			familyKey: mixedMailboxFamilyKey(
				MIXED_SHARED_MAILBOX_PATH_SEGMENTS
			),
			formatLabel: spec.formatLabel,
			stateFlags: spec.stateFlags,
			textKey: replicatedSourceKeyByFormat[spec.formatLabel]
		}));

		await collection.ingest({
			chunks: containerSpecs.map((spec) => ({
				chunkId: spec.chunkId,
				embedding: [1, 0] as [number, number],
				metadata: {
					archiveLineage: ['docs', 'guide.md'],
					emailAttachmentSource: `${spec.containerSource}#messages/1#attachments/shared-guide.zip`,
					emailMailboxContainerSource: spec.containerSource,
					emailMailboxFamilyKey: spec.familyKey,
					emailMailboxFolder: mixedMailboxFolder(spec.formatLabel),
					emailMailboxFormat: spec.formatLabel,
					emailMailboxLeaf: 'Shared',
					emailMailboxMessageOrdinal: 1,
					emailMailboxPathDepth: 3,
					emailMailboxPathSegments:
						MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
					emailMailboxStateFlags: spec.stateFlags
				},
				text: `${spec.textKey} replicated recovered shared guide descendant.`
			}))
		});

		for (const spec of containerSpecs) {
			const expectedStateToken = spec.stateFlags.includes('unread')
				? 'unread'
				: 'flagged';
			const results = await collection.search({
				query: `Which ${expectedStateToken} ${spec.formatLabel} mailbox container has the replicated shared guide descendant for ${spec.textKey}?`,
				topK: containerSpecs.length
			});

			expect(results[0]?.chunkId).toBe(spec.chunkId);
		}
	});

	it('prefers replicated descendant families across arbitrary mailbox container formats by format and container cues', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const sourceKeyByFormat = {
			pst: 'lantern',
			ost: 'quartz',
			mbox: 'ember',
			emlx: 'fable',
			maildir: 'glyph'
		} as const;
		const containerSourceByFormat = {
			pst: 'shared-lantern.pst',
			ost: 'shared-quartz.ost',
			mbox: 'shared-thread.mbox',
			emlx: 'shared-apple.emlx',
			maildir: 'Ops/Recovered/Shared'
		} as const;
		const containerSpecs = MIXED_MAILBOX_REPLY_SPECS.map((spec) => ({
			chunkId: `shared-${sourceKeyByFormat[spec.formatLabel]}-${spec.formatLabel}`,
			containerSource: containerSourceByFormat[spec.formatLabel],
			familyKey: mixedMailboxFamilyKey(
				MIXED_SHARED_MAILBOX_PATH_SEGMENTS
			),
			formatLabel: spec.formatLabel,
			sourceKey: sourceKeyByFormat[spec.formatLabel],
			stateFlags: spec.stateFlags
		}));

		await collection.ingest({
			chunks: containerSpecs.map((spec) => ({
				chunkId: spec.chunkId,
				embedding: [1, 0] as [number, number],
				metadata: {
					archiveLineage: ['docs', 'guide.md'],
					emailAttachmentSource:
						spec.formatLabel === 'maildir'
							? `${spec.containerSource}/cur/shared-${spec.sourceKey}:2,FS#attachments/shared-guide.zip`
							: spec.formatLabel === 'emlx'
								? `${spec.containerSource}#attachments/shared-guide.zip`
								: `${spec.containerSource}#messages/1#attachments/shared-guide.zip`,
					emailMailboxContainerSource: spec.containerSource,
					emailMailboxFamilyKey: spec.familyKey,
					emailMailboxFolder: mixedMailboxFolder(spec.formatLabel),
					emailMailboxFormat: spec.formatLabel,
					emailMailboxLeaf: 'Shared',
					emailMailboxMessageOrdinal: 1,
					emailMailboxPathDepth: 3,
					emailMailboxPathSegments:
						MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
					emailMailboxStateFlags: spec.stateFlags
				},
				text: `${spec.sourceKey} replicated mixed-format shared guide descendant.`
			}))
		});

		for (const spec of containerSpecs) {
			const queryPrefix = spec.stateFlags.includes('unread')
				? 'Which unread'
				: spec.stateFlags.includes('flagged')
					? 'Which flagged'
					: 'Which';
			const results = await collection.search({
				query: `${queryPrefix} ${spec.formatLabel} mailbox container has the replicated shared guide descendant for ${spec.sourceKey}?`,
				topK: containerSpecs.length
			});

			expect(results[0]?.chunkId).toBe(spec.chunkId);
		}
	});

	it('prefers the right mailbox format and section family across mixed-format thread collisions', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const containerSourceByFormat = {
			emlx: 'shared-apple.emlx',
			pst: 'shared-lantern.pst',
			ost: 'shared-quartz.ost',
			mbox: 'shared-thread.mbox',
			maildir: 'Ops/Recovered/Shared'
		} as const;
		const containerSpecs = MIXED_MAILBOX_REPLY_SPECS.map((spec) => ({
			authoredChunkId: `mixed-${spec.formatLabel}-authored`,
			containerSource: containerSourceByFormat[spec.formatLabel],
			familyKey: mixedMailboxFamilyKey(
				MIXED_SHARED_MAILBOX_PATH_SEGMENTS
			),
			formatLabel: spec.formatLabel,
			forwardedChunkId: `mixed-${spec.formatLabel}-forwarded`,
			stateFlags: spec.stateFlags
		}));

		await collection.ingest({
			chunks: containerSpecs.flatMap((spec) => [
				{
					chunkId: spec.authoredChunkId,
					embedding: [1, 0] as [number, number],
					metadata: {
						emailMailboxContainerSource: spec.containerSource,
						emailMailboxFamilyKey: spec.familyKey,
						emailMailboxFolder: mixedMailboxFolder(
							spec.formatLabel
						),
						emailMailboxFormat: spec.formatLabel,
						emailMailboxLeaf: 'Shared',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments:
							MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
						emailMailboxStateFlags: spec.stateFlags,
						emailSectionKind: 'authored_text',
						threadTopic: 'Mixed container shared thread'
					},
					text: 'Shared incident authored summary for the mixed mailbox thread.'
				},
				{
					chunkId: spec.forwardedChunkId,
					embedding: [1, 0] as [number, number],
					metadata: {
						emailForwardedFromAddress:
							'original-sender@example.com',
						emailForwardedSubject: 'Shared incident history',
						emailMailboxContainerSource: spec.containerSource,
						emailMailboxFamilyKey: spec.familyKey,
						emailMailboxFolder: mixedMailboxFolder(
							spec.formatLabel
						),
						emailMailboxFormat: spec.formatLabel,
						emailMailboxLeaf: 'Shared',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments:
							MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
						emailMailboxStateFlags: spec.stateFlags,
						emailSectionKind: 'forwarded_headers',
						threadTopic: 'Mixed container shared thread'
					},
					text: 'Shared incident forwarded headers for the mixed mailbox thread.'
				}
			])
		});

		for (const spec of containerSpecs) {
			const statePrefix = spec.stateFlags.includes('unread')
				? 'unread '
				: spec.stateFlags.includes('flagged')
					? 'flagged '
					: '';
			const authoredResults = await collection.search({
				query: `Which ${statePrefix}${spec.formatLabel} mailbox has the local authored summary for the mixed container shared thread?`,
				topK: containerSpecs.length * 2
			});
			expect(authoredResults[0]?.chunkId).toBe(spec.authoredChunkId);

			const forwardedResults = await collection.search({
				query: `Which ${statePrefix}${spec.formatLabel} mailbox forwarded headers show the original sender for the mixed container shared thread?`,
				topK: containerSpecs.length * 2
			});
			expect(forwardedResults[0]?.chunkId).toBe(spec.forwardedChunkId);
		}
	});

	it('prefers the right mixed-format sibling reply ordinal and section family on one shared thread', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const expectedSiblingSourceByFormat = {
			emlx: 'reply-emlx.emlx',
			pst: 'thread-pst.pst#messages/1',
			ost: 'thread-ost.ost#messages/1',
			mbox: 'thread.mbox#messages/1',
			maildir: 'Ops/Recovered/Shared/cur/1713890011.M11P11.mailhost:2,FS'
		} as const;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS.map((spec) => ({
			authoredChunkId: `mixed-sibling-${spec.formatLabel}-authored`,
			containerSource: spec.containerSource,
			expectedSource: expectedSiblingSourceByFormat[spec.formatLabel],
			formatLabel: spec.formatLabel,
			forwardedChunkId: `mixed-sibling-${spec.formatLabel}-forwarded`,
			stateFlags: spec.stateFlags
		}));
		const orderedSources = replySpecs
			.map((spec) => spec.expectedSource)
			.sort((left, right) => left.localeCompare(right));
		const ordinalLabelBySource = new Map(
			orderedSources.map((source, index) => [
				source,
				['first', 'second', 'third', 'fourth', 'fifth'][index] ??
					`reply-${index + 1}`
			])
		);

		await collection.ingest({
			chunks: replySpecs.flatMap((spec) => {
				const expectedIndex = orderedSources.indexOf(
					spec.expectedSource
				);
				return [
					{
						chunkId: spec.authoredChunkId,
						embedding: [1, 0] as [number, number],
						metadata: {
							emailMailboxContainerSource: spec.containerSource,
							emailMailboxFamilyKey: 'ops/recovered/shared',
							emailMailboxFolder: mixedMailboxFolder(
								spec.formatLabel
							),
							emailMailboxFormat: spec.formatLabel,
							emailMailboxLeaf: 'Shared',
							emailMailboxPathDepth: 3,
							emailMailboxPathSegments:
								MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
							emailMailboxStateFlags: spec.stateFlags,
							emailReplySiblingCount: replySpecs.length,
							emailReplySiblingIndex: expectedIndex,
							emailReplySiblingOrdinal: expectedIndex + 1,
							emailSectionKind: 'authored_text',
							threadTopic: 'Mixed container sibling thread'
						},
						text: `${spec.formatLabel} mixed sibling authored summary.`
					},
					{
						chunkId: spec.forwardedChunkId,
						embedding: [1, 0] as [number, number],
						metadata: {
							emailForwardedFromAddress:
								'original-sender@example.com',
							emailForwardedSubject:
								'Mixed container sibling history',
							emailMailboxContainerSource: spec.containerSource,
							emailMailboxFamilyKey: 'ops/recovered/shared',
							emailMailboxFolder: mixedMailboxFolder(
								spec.formatLabel
							),
							emailMailboxFormat: spec.formatLabel,
							emailMailboxLeaf: 'Shared',
							emailMailboxPathDepth: 3,
							emailMailboxPathSegments:
								MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
							emailMailboxStateFlags: spec.stateFlags,
							emailReplySiblingCount: replySpecs.length,
							emailReplySiblingIndex: expectedIndex,
							emailReplySiblingOrdinal: expectedIndex + 1,
							emailSectionKind: 'forwarded_headers',
							threadTopic: 'Mixed container sibling thread'
						},
						text: `${spec.formatLabel} mixed sibling forwarded headers.`
					}
				];
			})
		});

		for (const spec of replySpecs) {
			const statePrefix = spec.stateFlags.includes('unread')
				? 'unread '
				: spec.stateFlags.includes('flagged')
					? 'flagged '
					: '';
			const ordinalLabel =
				ordinalLabelBySource.get(spec.expectedSource) ?? 'reply';

			const authoredResults = await collection.search({
				query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox reply has the local authored summary for the mixed container sibling thread?`,
				topK: replySpecs.length * 2
			});
			expect(authoredResults[0]?.chunkId).toBe(spec.authoredChunkId);

			const forwardedResults = await collection.search({
				query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox reply forwarded headers show the original sender for the mixed container sibling thread?`,
				topK: replySpecs.length * 2
			});
			expect(forwardedResults[0]?.chunkId).toBe(spec.forwardedChunkId);
		}
	});

	it('prefers the right mixed-format forwarded-chain sibling reply by ordinal and format', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const expectedForwardedSourceByFormat = {
			emlx: 'reply-emlx.emlx',
			pst: 'thread-pst.pst#messages/1',
			ost: 'thread-ost.ost#messages/1',
			mbox: 'thread.mbox#messages/1',
			maildir: 'Ops/Recovered/Shared/cur/1713890011.M11P11.mailhost:2,FS'
		} as const;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS.map((spec) => ({
			chunkId: `mixed-forwarded-${spec.formatLabel}`,
			expectedSource: expectedForwardedSourceByFormat[spec.formatLabel],
			formatLabel: spec.formatLabel,
			stateFlags: spec.stateFlags
		}));
		const orderedSources = replySpecs
			.map((spec) => spec.expectedSource)
			.sort((left, right) => left.localeCompare(right));
		const ordinalLabelBySource = new Map(
			orderedSources.map((source, index) => [
				source,
				['first', 'second', 'third', 'fourth', 'fifth'][index] ??
					`reply-${index + 1}`
			])
		);

		await collection.ingest({
			chunks: replySpecs.map((spec) => {
				const expectedIndex = orderedSources.indexOf(
					spec.expectedSource
				);
				return {
					chunkId: spec.chunkId,
					embedding: [1, 0] as [number, number],
					metadata: {
						emailForwardedChainCount: 2,
						emailForwardedFromAddress:
							'original-sender@example.com',
						emailForwardedOrdinal: 1,
						emailForwardedSubject: 'Mixed sibling escalations',
						emailMailboxContainerSource:
							spec.formatLabel === 'maildir'
								? 'Ops/Recovered/Shared'
								: (spec.expectedSource.split('#messages/')[0] ??
									spec.expectedSource),
						emailMailboxFamilyKey: 'ops/recovered/shared',
						emailMailboxFolder: mixedMailboxFolder(
							spec.formatLabel
						),
						emailMailboxFormat: spec.formatLabel,
						emailMailboxLeaf: 'Shared',
						emailMailboxPathDepth: 3,
						emailMailboxPathSegments:
							MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
						emailMailboxStateFlags: spec.stateFlags,
						emailReplySiblingCount: replySpecs.length,
						emailReplySiblingIndex: expectedIndex,
						emailReplySiblingOrdinal: expectedIndex + 1,
						emailSectionKind: 'forwarded_headers',
						threadTopic: 'Mixed container sibling thread'
					},
					text: `${spec.formatLabel} mixed sibling forwarded chain headers.`
				};
			})
		});

		for (const spec of replySpecs) {
			const statePrefix = spec.stateFlags.includes('unread')
				? 'unread '
				: spec.stateFlags.includes('flagged')
					? 'flagged '
					: '';
			const ordinalLabel =
				ordinalLabelBySource.get(spec.expectedSource) ?? 'reply';

			const results = await collection.search({
				query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox reply forwarded chain headers show the original sender for the mixed container sibling thread?`,
				topK: replySpecs.length
			});
			expect(results[0]?.chunkId).toBe(spec.chunkId);
		}
	});

	it('prefers the right mixed-format attached-message descendant by ordinal format and section family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const expectedDescendantSourceByFormat = {
			emlx: 'reply-emlx.emlx#attachments/shared-child.eml',
			pst: 'thread-pst.pst#messages/1#attachments/shared-child.eml',
			ost: 'thread-ost.ost#messages/1#attachments/shared-child.eml',
			mbox: 'thread.mbox#messages/1#attachments/shared-child.eml',
			maildir:
				'Ops/Recovered/Shared/cur/1713890012.M12P12.mailhost:2,FS#attachments/shared-child.eml'
		} as const;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS.map((spec) => ({
			authoredChunkId: `mixed-descendant-${spec.formatLabel}-authored`,
			containerSource: spec.containerSource,
			expectedChildSource:
				expectedDescendantSourceByFormat[spec.formatLabel],
			formatLabel: spec.formatLabel,
			forwardedChunkId: `mixed-descendant-${spec.formatLabel}-forwarded`,
			stateFlags: spec.stateFlags
		}));
		const orderedSources = replySpecs
			.map((spec) => spec.expectedChildSource)
			.sort((left, right) => left.localeCompare(right));
		const ordinalLabelBySource = new Map(
			orderedSources.map((source, index) => [
				source,
				['first', 'second', 'third', 'fourth', 'fifth'][index] ??
					`reply-${index + 1}`
			])
		);

		await collection.ingest({
			chunks: replySpecs.flatMap((spec) => {
				const expectedIndex = orderedSources.indexOf(
					spec.expectedChildSource
				);
				return [
					{
						chunkId: spec.authoredChunkId,
						embedding: [1, 0] as [number, number],
						metadata: {
							emailAttachmentSource: spec.expectedChildSource,
							emailMailboxContainerSource: spec.containerSource,
							emailMailboxFamilyKey: 'ops/recovered/shared',
							emailMailboxFolder: mixedMailboxFolder(
								spec.formatLabel
							),
							emailMailboxFormat: spec.formatLabel,
							emailMailboxLeaf: 'Shared',
							emailMailboxPathDepth: 3,
							emailMailboxPathSegments:
								MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
							emailMailboxStateFlags: spec.stateFlags,
							emailMessageLineageAttachmentSources: [
								spec.expectedChildSource
							],
							emailMessageLineageCount: 1,
							emailMessageSource: spec.expectedChildSource,
							emailMessageSourceKind: 'attached_message',
							emailReplySiblingCount: replySpecs.length,
							emailReplySiblingIndex: expectedIndex,
							emailReplySiblingOrdinal: expectedIndex + 1,
							emailSectionKind: 'authored_text',
							threadTopic: 'Mixed container descendant thread'
						},
						text: `${spec.formatLabel} local attached child summary.`
					},
					{
						chunkId: spec.forwardedChunkId,
						embedding: [1, 0] as [number, number],
						metadata: {
							emailAttachmentSource: spec.expectedChildSource,
							emailForwardedChainCount: 2,
							emailForwardedFromAddress: `forwarded-${spec.formatLabel}@example.com`,
							emailForwardedOrdinal: 1,
							emailForwardedSubject: `Forwarded ${spec.formatLabel} child history`,
							emailMailboxContainerSource: spec.containerSource,
							emailMailboxFamilyKey: 'ops/recovered/shared',
							emailMailboxFolder: mixedMailboxFolder(
								spec.formatLabel
							),
							emailMailboxFormat: spec.formatLabel,
							emailMailboxLeaf: 'Shared',
							emailMailboxPathDepth: 3,
							emailMailboxPathSegments:
								MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
							emailMailboxStateFlags: spec.stateFlags,
							emailMessageLineageAttachmentSources: [
								spec.expectedChildSource
							],
							emailMessageLineageCount: 1,
							emailMessageSource: spec.expectedChildSource,
							emailMessageSourceKind: 'attached_message',
							emailReplySiblingCount: replySpecs.length,
							emailReplySiblingIndex: expectedIndex,
							emailReplySiblingOrdinal: expectedIndex + 1,
							emailSectionKind: 'forwarded_headers',
							threadTopic: 'Mixed container descendant thread'
						},
						text: `${spec.formatLabel} forwarded child history headers.`
					}
				];
			})
		});

		for (const spec of replySpecs) {
			const statePrefix = spec.stateFlags.includes('unread')
				? 'unread '
				: spec.stateFlags.includes('flagged')
					? 'flagged '
					: '';
			const ordinalLabel =
				ordinalLabelBySource.get(spec.expectedChildSource) ?? 'reply';

			const authoredResults = await collection.search({
				query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox attached child reply has the local authored summary for the mixed container descendant thread?`,
				topK: replySpecs.length * 2
			});
			expect(authoredResults[0]?.chunkId).toBe(spec.authoredChunkId);

			const forwardedResults = await collection.search({
				query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox attached child reply forwarded chain headers show the original sender for the mixed container descendant thread?`,
				topK: replySpecs.length * 2
			});
			expect(forwardedResults[0]?.chunkId).toBe(spec.forwardedChunkId);
		}
	});

	it('prefers arbitrary mixed-format attached-message child branches by branch ordinal format and section family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const branchKeys = MIXED_MAILBOX_BRANCH_KEYS;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS;
		const orderedChildSources = replySpecs
			.flatMap((spec) =>
				branchKeys.map((branchKey) =>
					mixedMailboxExpectedChildSource(spec, branchKey)
				)
			)
			.sort((left, right) => left.localeCompare(right));
		const ordinalLabelBySource = new Map(
			orderedChildSources.map((source, index) => [
				source,
				[
					'first',
					'second',
					'third',
					'fourth',
					'fifth',
					'sixth',
					'seventh',
					'eighth',
					'ninth',
					'tenth',
					'eleventh',
					'twelfth',
					'thirteenth',
					'fourteenth',
					'fifteenth'
				][index] ?? `reply-${index + 1}`
			])
		);

		await collection.ingest({
			chunks: replySpecs.flatMap((spec) =>
				branchKeys.flatMap((branchKey) => {
					const childSource = mixedMailboxExpectedChildSource(
						spec,
						branchKey
					);
					const expectedIndex =
						orderedChildSources.indexOf(childSource);
					return [
						{
							chunkId: `mixed-descendant-branches-${spec.formatLabel}-${branchKey}-authored`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: childSource,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFamilyKey: 'ops/recovered/shared',
								emailMailboxFolder: mixedMailboxFolder(
									spec.formatLabel
								),
								emailMailboxFormat: spec.formatLabel,
								emailMailboxLeaf: 'Shared',
								emailMailboxPathDepth: 3,
								emailMailboxPathSegments:
									MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
								emailMailboxStateFlags: spec.stateFlags,
								emailMessageLineageAttachmentSources: [
									childSource
								],
								emailMessageLineageCount: 1,
								emailMessageSource: childSource,
								emailMessageSourceKind: 'attached_message',
								emailReplySiblingCount:
									orderedChildSources.length,
								emailReplySiblingIndex: expectedIndex,
								emailReplySiblingOrdinal: expectedIndex + 1,
								emailSectionKind: 'authored_text',
								threadTopic:
									'Mixed container descendant branches thread'
							},
							text: `${spec.formatLabel} ${branchKey} local attached child summary.`
						},
						{
							chunkId: `mixed-descendant-branches-${spec.formatLabel}-${branchKey}-forwarded`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: childSource,
								emailForwardedChainCount: 2,
								emailForwardedFromAddress: `forwarded-${spec.formatLabel}-${branchKey}@example.com`,
								emailForwardedOrdinal: 1,
								emailForwardedSubject: `Forwarded ${spec.formatLabel} ${branchKey} child history`,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFamilyKey: 'ops/recovered/shared',
								emailMailboxFolder: mixedMailboxFolder(
									spec.formatLabel
								),
								emailMailboxFormat: spec.formatLabel,
								emailMailboxLeaf: 'Shared',
								emailMailboxPathDepth: 3,
								emailMailboxPathSegments:
									MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
								emailMailboxStateFlags: spec.stateFlags,
								emailMessageLineageAttachmentSources: [
									childSource
								],
								emailMessageLineageCount: 1,
								emailMessageSource: childSource,
								emailMessageSourceKind: 'attached_message',
								emailReplySiblingCount:
									orderedChildSources.length,
								emailReplySiblingIndex: expectedIndex,
								emailReplySiblingOrdinal: expectedIndex + 1,
								emailSectionKind: 'forwarded_headers',
								threadTopic:
									'Mixed container descendant branches thread'
							},
							text: `${spec.formatLabel} ${branchKey} forwarded child history headers.`
						}
					];
				})
			)
		});

		for (const spec of replySpecs) {
			for (const branchKey of branchKeys) {
				const childSource = mixedMailboxExpectedChildSource(
					spec,
					branchKey
				);
				const statePrefix = spec.stateFlags.includes('unread')
					? 'unread '
					: spec.stateFlags.includes('flagged')
						? 'flagged '
						: '';
				const ordinalLabel =
					ordinalLabelBySource.get(childSource) ?? 'reply';

				const authoredResults = await collection.search({
					query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox attached child ${branchKey} reply has the local authored summary for the mixed container descendant branches thread?`,
					topK: orderedChildSources.length * 2
				});
				expect(authoredResults[0]?.chunkId).toBe(
					`mixed-descendant-branches-${spec.formatLabel}-${branchKey}-authored`
				);

				const forwardedResults = await collection.search({
					query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox attached child ${branchKey} reply forwarded chain headers show the original sender for the mixed container descendant branches thread?`,
					topK: orderedChildSources.length * 2
				});
				expect(forwardedResults[0]?.chunkId).toBe(
					`mixed-descendant-branches-${spec.formatLabel}-${branchKey}-forwarded`
				);
			}
		}
	});

	it('prefers arbitrary mixed-format nested attached-message child depth by branch format and section family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const branchKeys = MIXED_MAILBOX_BRANCH_KEYS;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS;
		const expectedNestedSource = (
			spec: (typeof replySpecs)[number],
			branchKey: (typeof branchKeys)[number]
		) =>
			`${mixedMailboxExpectedChildSource(spec, branchKey)}#attachments/nested-child-${branchKey}.eml`;

		await collection.ingest({
			chunks: replySpecs.flatMap((spec) =>
				branchKeys.flatMap((branchKey) => {
					const nestedSource = expectedNestedSource(spec, branchKey);
					return [
						{
							chunkId: `mixed-descendant-nested-${spec.formatLabel}-${branchKey}-authored`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: nestedSource,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFamilyKey: 'ops/recovered/shared',
								emailMailboxFolder: mixedMailboxFolder(
									spec.formatLabel
								),
								emailMailboxFormat: spec.formatLabel,
								emailMailboxLeaf: 'Shared',
								emailMailboxPathDepth: 3,
								emailMailboxPathSegments:
									MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
								emailMailboxStateFlags: spec.stateFlags,
								emailMessageLineageAttachmentSources: [
									mixedMailboxExpectedChildSource(
										spec,
										branchKey
									),
									nestedSource
								],
								emailMessageLineageCount: 2,
								emailMessageSource: nestedSource,
								emailMessageSourceKind: 'attached_message',
								emailSectionKind: 'authored_text',
								threadTopic:
									'Mixed container descendant nested thread'
							},
							text: `${spec.formatLabel} ${branchKey} nested attached child summary.`
						},
						{
							chunkId: `mixed-descendant-nested-${spec.formatLabel}-${branchKey}-forwarded`,
							embedding: [1, 0] as [number, number],
							metadata: {
								emailAttachmentSource: nestedSource,
								emailForwardedChainCount: 1,
								emailForwardedFromAddress: `forwarded-deep-${spec.formatLabel}-${branchKey}@example.com`,
								emailForwardedOrdinal: 1,
								emailForwardedSubject: `Forwarded deep ${spec.formatLabel} ${branchKey} child history`,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFamilyKey: 'ops/recovered/shared',
								emailMailboxFolder: mixedMailboxFolder(
									spec.formatLabel
								),
								emailMailboxFormat: spec.formatLabel,
								emailMailboxLeaf: 'Shared',
								emailMailboxPathDepth: 3,
								emailMailboxPathSegments:
									MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
								emailMailboxStateFlags: spec.stateFlags,
								emailMessageLineageAttachmentSources: [
									mixedMailboxExpectedChildSource(
										spec,
										branchKey
									),
									nestedSource
								],
								emailMessageLineageCount: 2,
								emailMessageSource: nestedSource,
								emailMessageSourceKind: 'attached_message',
								emailSectionKind: 'forwarded_headers',
								threadTopic:
									'Mixed container descendant nested thread'
							},
							text: `${spec.formatLabel} ${branchKey} forwarded deep child history headers.`
						}
					];
				})
			)
		});

		for (const spec of replySpecs) {
			for (const branchKey of branchKeys) {
				const statePrefix = spec.stateFlags.includes('unread')
					? 'unread '
					: spec.stateFlags.includes('flagged')
						? 'flagged '
						: '';
				const authoredResults = await collection.search({
					query: `Which ${statePrefix}deepest ${spec.formatLabel} mailbox attached child ${branchKey} reply has the local authored summary for the mixed container descendant nested thread?`,
					topK: replySpecs.length * branchKeys.length * 2
				});
				expect(authoredResults[0]?.chunkId).toBe(
					`mixed-descendant-nested-${spec.formatLabel}-${branchKey}-authored`
				);

				const forwardedResults = await collection.search({
					query: `Which ${statePrefix}deepest ${spec.formatLabel} mailbox attached child ${branchKey} reply forwarded headers show the original sender for the mixed container descendant nested thread?`,
					topK: replySpecs.length * branchKeys.length * 2
				});
				expect(forwardedResults[0]?.chunkId).toBe(
					`mixed-descendant-nested-${spec.formatLabel}-${branchKey}-forwarded`
				);
			}
		}
	});

	it('prefers arbitrary mixed-format nested attached-message sibling replies by branch ordinal format and section family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const branchKeys = MIXED_MAILBOX_BRANCH_KEYS;
		const nestedReplyOrdinals = [1, 2];
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS;
		const expectedNestedReplySource = (
			spec: (typeof replySpecs)[number],
			branchKey: (typeof branchKeys)[number],
			replyOrdinal: number
		) =>
			`${mixedMailboxExpectedChildSource(spec, branchKey)}#attachments/nested-reply-${branchKey}-${replyOrdinal}.eml`;

		await collection.ingest({
			chunks: replySpecs.flatMap((spec) =>
				branchKeys.flatMap((branchKey) => {
					const topMessageId = `<mixed-descendant-top-sibling-${spec.formatLabel}-${branchKey}@example.com>`;
					const siblingSources = nestedReplyOrdinals.map(
						(replyOrdinal) =>
							expectedNestedReplySource(
								spec,
								branchKey,
								replyOrdinal
							)
					);
					return nestedReplyOrdinals.flatMap(
						(replyOrdinal, index) => {
							const nestedSource = expectedNestedReplySource(
								spec,
								branchKey,
								replyOrdinal
							);
							return [
								{
									chunkId: `mixed-descendant-nested-siblings-${spec.formatLabel}-${branchKey}-${replyOrdinal}-authored`,
									embedding: [1, 0] as [number, number],
									metadata: {
										emailAttachmentSource: nestedSource,
										emailMailboxContainerSource:
											spec.containerSource,
										emailMailboxFamilyKey:
											'ops/recovered/shared',
										emailMailboxFolder: mixedMailboxFolder(
											spec.formatLabel
										),
										emailMailboxFormat: spec.formatLabel,
										emailMailboxLeaf: 'Shared',
										emailMailboxPathDepth: 3,
										emailMailboxPathSegments:
											MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
										emailMailboxStateFlags: spec.stateFlags,
										emailMessageLineageAttachmentSources: [
											mixedMailboxExpectedChildSource(
												spec,
												branchKey
											),
											nestedSource
										],
										emailMessageLineageCount: 2,
										emailMessageSource: nestedSource,
										emailMessageSourceKind:
											'attached_message',
										emailReplySiblingCount:
											nestedReplyOrdinals.length,
										emailReplySiblingIndex: index,
										emailReplySiblingOrdinal: index + 1,
										emailReplySiblingParentMessageId:
											topMessageId,
										emailReplySiblingSources:
											siblingSources,
										emailSectionKind: 'authored_text',
										threadTopic:
											'Mixed container descendant nested sibling thread'
									},
									text: `${spec.formatLabel} ${branchKey} nested reply ${replyOrdinal} summary.`
								},
								{
									chunkId: `mixed-descendant-nested-siblings-${spec.formatLabel}-${branchKey}-${replyOrdinal}-forwarded`,
									embedding: [1, 0] as [number, number],
									metadata: {
										emailAttachmentSource: nestedSource,
										emailForwardedChainCount: 1,
										emailForwardedFromAddress: `forwarded-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com`,
										emailForwardedOrdinal: 1,
										emailForwardedSubject: `Forwarded sibling ${spec.formatLabel} ${branchKey} ${replyOrdinal} child history`,
										emailMailboxContainerSource:
											spec.containerSource,
										emailMailboxFamilyKey:
											'ops/recovered/shared',
										emailMailboxFolder: mixedMailboxFolder(
											spec.formatLabel
										),
										emailMailboxFormat: spec.formatLabel,
										emailMailboxLeaf: 'Shared',
										emailMailboxPathDepth: 3,
										emailMailboxPathSegments:
											MIXED_SHARED_MAILBOX_PATH_SEGMENTS,
										emailMailboxStateFlags: spec.stateFlags,
										emailMessageLineageAttachmentSources: [
											mixedMailboxExpectedChildSource(
												spec,
												branchKey
											),
											nestedSource
										],
										emailMessageLineageCount: 2,
										emailMessageSource: nestedSource,
										emailMessageSourceKind:
											'attached_message',
										emailReplySiblingCount:
											nestedReplyOrdinals.length,
										emailReplySiblingIndex: index,
										emailReplySiblingOrdinal: index + 1,
										emailReplySiblingParentMessageId:
											topMessageId,
										emailReplySiblingSources:
											siblingSources,
										emailSectionKind: 'forwarded_headers',
										threadTopic:
											'Mixed container descendant nested sibling thread'
									},
									text: `${spec.formatLabel} ${branchKey} nested reply ${replyOrdinal} forwarded headers.`
								}
							];
						}
					);
				})
			)
		});

		for (const spec of replySpecs) {
			for (const branchKey of branchKeys) {
				for (const replyOrdinal of nestedReplyOrdinals) {
					const statePrefix = spec.stateFlags.includes('unread')
						? 'unread '
						: spec.stateFlags.includes('flagged')
							? 'flagged '
							: '';
					const ordinalLabel =
						replyOrdinal === 1 ? 'first' : 'second';
					const authoredResults = await collection.search({
						query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox nested attached child ${branchKey} reply has the local authored summary for the mixed container descendant nested sibling thread?`,
						topK:
							replySpecs.length *
							branchKeys.length *
							nestedReplyOrdinals.length *
							2
					});
					expect(authoredResults[0]?.chunkId).toBe(
						`mixed-descendant-nested-siblings-${spec.formatLabel}-${branchKey}-${replyOrdinal}-authored`
					);

					const forwardedResults = await collection.search({
						query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox nested attached child ${branchKey} reply forwarded headers show the original sender for the mixed container descendant nested sibling thread?`,
						topK:
							replySpecs.length *
							branchKeys.length *
							nestedReplyOrdinals.length *
							2
					});
					expect(forwardedResults[0]?.chunkId).toBe(
						`mixed-descendant-nested-siblings-${spec.formatLabel}-${branchKey}-${replyOrdinal}-forwarded`
					);

					if (spec.stateFlags.length > 0) {
						const stateFocusedResults = await collection.search({
							query: `Which ${statePrefix}${ordinalLabel} ${spec.formatLabel} mailbox nested attached child ${branchKey} reply keeps the mailbox state local authored summary for the mixed container descendant nested sibling thread?`,
							topK:
								replySpecs.length *
								branchKeys.length *
								nestedReplyOrdinals.length *
								2
						});
						expect(stateFocusedResults[0]?.chunkId).toBe(
							`mixed-descendant-nested-siblings-${spec.formatLabel}-${branchKey}-${replyOrdinal}-authored`
						);
					}
				}
			}
		}
	});

	it('prefers arbitrary mixed-format nested child families under sibling replies by branch child ordinal format and section family', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});
		const branchKeys = MIXED_MAILBOX_BRANCH_KEYS;
		const branchMailboxPaths = MIXED_MAILBOX_BRANCH_PATHS;
		const rootDriftKeys = MIXED_MAILBOX_ROOT_DRIFT_KEYS;
		const nestedReplyKeys = MIXED_MAILBOX_NESTED_REPLY_KEYS;
		const parentDriftKeys = MIXED_MAILBOX_PARENT_DRIFT_KEYS;
		const deepChildKeys = MIXED_MAILBOX_DEEP_CHILD_KEYS;
		const referenceDriftKeys = MIXED_MAILBOX_REFERENCE_DRIFT_KEYS;
		const messageDriftKeys = MIXED_MAILBOX_MESSAGE_DRIFT_KEYS;
		const conversationIdDriftKeys =
			MIXED_MAILBOX_CONVERSATION_ID_DRIFT_KEYS;
		const conversationDriftKeys = MIXED_MAILBOX_CONVERSATION_DRIFT_KEYS;
		const threadIndexDriftKeys = MIXED_MAILBOX_THREAD_INDEX_DRIFT_KEYS;
		const quotedHistoryKeys = MIXED_MAILBOX_QUOTED_HISTORY_KEYS;
		const inlineResourceKeys = MIXED_MAILBOX_INLINE_RESOURCE_KEYS;
		const branchStateFlagSets = MIXED_MAILBOX_BRANCH_STATE_FLAG_SETS;
		const childOrdinalLabels = ['first', 'second', 'third'] as const;
		const inlineOrdinalLabels = ['first', 'second'] as const;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS;
		const buildDeepChildContext = (
			spec: (typeof replySpecs)[number],
			branchKey: (typeof branchKeys)[number],
			replyKey: (typeof nestedReplyKeys)[number],
			childKey: (typeof deepChildKeys)[number],
			childIndex: number
		) => {
			const branchIndex = branchKeys.indexOf(branchKey);
			const replyIndex = nestedReplyKeys.indexOf(replyKey);
			const branchMailboxPathSegments = branchMailboxPaths[branchIndex]!;
			const branchMailboxLeaf =
				branchMailboxPathSegments[
					branchMailboxPathSegments.length - 1
				]!;
			const branchMailboxFamilyKey = mixedMailboxFamilyKey(
				branchMailboxPathSegments
			);
			const nestedSource = mixedMailboxExpectedNestedReplySource(
				spec,
				branchKey,
				replyKey
			);
			const deepChildSource = mixedMailboxExpectedDeepChildSource(
				spec,
				branchKey,
				replyKey,
				childKey
			);
			const deepSiblingSources = deepChildKeys.map((candidateChildKey) =>
				mixedMailboxExpectedDeepChildSource(
					spec,
					branchKey,
					replyKey,
					candidateChildKey
				)
			);
			const rootDriftKey = rootDriftKeys[branchIndex]!;
			const parentDriftKey = parentDriftKeys[replyIndex]!;
			const branchStateFlags = branchStateFlagSets[branchIndex]!;
			const combinedStateFlags = [
				...new Set([...spec.stateFlags, ...branchStateFlags])
			];
			const referenceDriftKey = referenceDriftKeys[childIndex]!;
			const messageDriftKey = messageDriftKeys[childIndex]!;
			const conversationIdDriftKey = conversationIdDriftKeys[childIndex]!;
			const conversationDriftKey = conversationDriftKeys[childIndex]!;
			const threadIndexDriftKey = threadIndexDriftKeys[childIndex]!;
			const nestedReplyMessageId = `<mixed-deep-parent-${spec.formatLabel}-${rootDriftKey}-${parentDriftKey}@example.com>`;
			const deepThreadRootMessageId = `<mixed-deep-root-${spec.formatLabel}-${rootDriftKey}@example.com>`;
			const deepReferenceId = `<mixed-deep-reference-${spec.formatLabel}-${referenceDriftKey}@example.com>`;
			const deepMessageId = `<mixed-deep-message-${spec.formatLabel}-${messageDriftKey}@example.com>`;
			const deepInternetMessageId = `<mixed-deep-internet-${spec.formatLabel}-${messageDriftKey}@example.com>`;
			const deepThreadMessageIds = [
				deepThreadRootMessageId,
				nestedReplyMessageId,
				deepReferenceId
			];
			const deepReferences = deepThreadMessageIds.join(' ');
			const buildBaseMetadata = (
				overrides: Record<string, unknown> = {}
			) => ({
				emailAttachmentSource: deepChildSource,
				emailMailboxContainerSource: spec.containerSource,
				emailMailboxFamilyKey: branchMailboxFamilyKey,
				emailMailboxFolder: mixedMailboxFolder(spec.formatLabel),
				emailMailboxFormat: spec.formatLabel,
				emailMailboxLeaf: branchMailboxLeaf,
				emailMailboxPathDepth: branchMailboxPathSegments.length,
				emailMailboxPathSegments: branchMailboxPathSegments,
				emailMailboxStateFlags: combinedStateFlags,
				emailConversationId: conversationIdDriftKey,
				emailConversationIndex: conversationDriftKey,
				emailMessageLineageAttachmentSources: [
					mixedMailboxExpectedChildSource(spec, branchKey),
					nestedSource,
					deepChildSource
				],
				emailMessageLineageCount: 3,
				emailInternetMessageId: deepInternetMessageId,
				emailMessageSource: deepChildSource,
				emailMessageSourceKind: 'attached_message',
				messageId: deepMessageId,
				references: deepReferences,
				replyReferenceCount: deepThreadMessageIds.length,
				emailReplySiblingCount: deepChildKeys.length,
				emailReplySiblingIndex: childIndex,
				emailReplySiblingOrdinal: childIndex + 1,
				emailReplySiblingParentMessageId: nestedReplyMessageId,
				emailReplySiblingSources: deepSiblingSources,
				inReplyTo: nestedReplyMessageId,
				threadIndex: threadIndexDriftKey,
				threadMessageIds: deepThreadMessageIds,
				threadRootMessageId: deepThreadRootMessageId,
				threadTopic: 'Mixed deep child descendant thread',
				...overrides
			});

			return {
				branchMailboxPathSegments,
				branchStateFlags,
				buildBaseMetadata,
				childIndex,
				combinedStateFlags,
				conversationDriftKey,
				conversationIdDriftKey,
				deepChildSource,
				deepInternetMessageId,
				deepMessageId,
				deepReferences,
				deepSiblingSources,
				deepThreadMessageIds,
				deepThreadRootMessageId,
				messageDriftKey,
				nestedReplyMessageId,
				nestedSource,
				threadIndexDriftKey
			};
		};

		await collection.ingest({
			chunks: replySpecs.flatMap((spec) =>
				branchKeys.flatMap((branchKey) =>
					nestedReplyKeys.flatMap((replyKey) => {
						return deepChildKeys.flatMap((childKey, index) => {
							const context = buildDeepChildContext(
								spec,
								branchKey,
								replyKey,
								childKey,
								index
							);
							return [
								{
									chunkId: `mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`,
									embedding: [1, 0] as [number, number],
									metadata: context.buildBaseMetadata({
										emailSectionKind: 'authored_text'
									}),
									text: `${spec.formatLabel} ${branchKey} nested reply ${replyKey} ${childKey} deep child summary.`
								},
								{
									chunkId: `mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-forwarded`,
									embedding: [1, 0] as [number, number],
									metadata: context.buildBaseMetadata({
										emailForwardedChainCount: 2,
										emailForwardedFromAddress: `forwarded-deep-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}@example.com`,
										emailForwardedOrdinal: 1,
										emailForwardedSubject: `Forwarded deep child ${spec.formatLabel} ${branchKey} ${replyKey} ${childKey} history`,
										emailSectionKind: 'forwarded_headers'
									}),
									text: `${spec.formatLabel} ${branchKey} nested reply ${replyKey} ${childKey} deep child forwarded headers.`
								},
								...quotedHistoryKeys.map(
									(quotedKey, quotedIndex) => ({
										chunkId: `mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-quoted-${quotedKey}`,
										embedding: [1, 0] as [number, number],
										metadata: context.buildBaseMetadata({
											emailQuotedDepth:
												quotedKey === 'older'
													? index + quotedIndex + 3
													: index + quotedIndex + 1,
											emailSectionKind: 'quoted_history'
										}),
										text:
											quotedKey === 'older'
												? `${spec.formatLabel} ${branchKey} nested reply ${replyKey} ${childKey} older archive quoted escalation history.`
												: `${spec.formatLabel} ${branchKey} nested reply ${replyKey} ${childKey} recent quoted owner recap.`
									})
								),
								...inlineResourceKeys.map(
									(inlineKey, inlineIndex) => ({
										chunkId: `mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-inline-${inlineKey}`,
										embedding: [1, 0] as [number, number],
										metadata: context.buildBaseMetadata({
											attachmentContentId: `<deep-inline-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-${inlineKey}@example.com>`,
											attachmentEmbeddedReferenceMatched:
												true,
											attachmentIndex: inlineIndex,
											emailAttachmentRole:
												'inline_resource',
											emailAttachmentSource: `${context.deepChildSource}#attachments/deep-inline-${branchKey}-${replyKey}-${childKey}-${inlineKey}.txt`
										}),
										text: `${spec.formatLabel} ${branchKey} nested reply ${replyKey} ${childKey} ${inlineKey} inline deep note.`
									})
								)
							];
						});
					})
				)
			)
		});

		for (const [specIndex, spec] of replySpecs.entries()) {
			const branchKey = branchKeys[specIndex % branchKeys.length]!;
			const replyKey =
				nestedReplyKeys[specIndex % nestedReplyKeys.length]!;
			const childIndex = specIndex % deepChildKeys.length;
			const childKey = deepChildKeys[childIndex]!;
			const inlineIndex = specIndex % inlineResourceKeys.length;
			const inlineKey = inlineResourceKeys[inlineIndex]!;
			const inlineChildKey = deepChildKeys[0];
			const inlineMessageDriftKey = messageDriftKeys[0]!;
			const inlineConversationIdDriftKey = conversationIdDriftKeys[0]!;
			const inlineConversationDriftKey = conversationDriftKeys[0]!;
			const inlineThreadIndexDriftKey = threadIndexDriftKeys[0]!;
			const branchStateFlags =
				branchStateFlagSets[branchKeys.indexOf(branchKey)]!;
			const mailboxStateCue =
				branchStateFlags.find(
					(flag) => !['read', 'passed'].includes(flag)
				) ??
				branchStateFlags[0] ??
				'';
			const statePrefix = mailboxStateCue ? `${mailboxStateCue} ` : '';
			const childOrdinalLabel = childOrdinalLabels[childIndex];
			const inlineOrdinalLabel = inlineOrdinalLabels[inlineIndex];
			const inlineChildOrdinalLabel = childOrdinalLabels[0];
			const branchMailboxPathSegments =
				branchMailboxPaths[branchKeys.indexOf(branchKey)]!;
			const branchMailboxLeaf =
				branchMailboxPathSegments[
					branchMailboxPathSegments.length - 1
				]!;
			const branchMailboxPathCue =
				branchMailboxPathSegments.length > 3
					? branchMailboxPathSegments[
							branchMailboxPathSegments.length - 2
						]!
					: branchMailboxLeaf;
			const rootDriftKey = rootDriftKeys[branchKeys.indexOf(branchKey)]!;
			const parentDriftKey =
				parentDriftKeys[nestedReplyKeys.indexOf(replyKey)]!;
			const referenceDriftKey = referenceDriftKeys[childIndex]!;
			const messageDriftKey = messageDriftKeys[childIndex]!;
			const conversationIdDriftKey = conversationIdDriftKeys[childIndex]!;
			const conversationDriftKey = conversationDriftKeys[childIndex]!;
			const threadIndexDriftKey = threadIndexDriftKeys[childIndex]!;
			const authoredResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child ${childKey} under nested reply ${replyKey} for ${branchKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(authoredResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const parentRootResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child ${childKey} under parent ${parentDriftKey} and root ${rootDriftKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(parentRootResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const referenceChainResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child under reference chain ${referenceDriftKey} for nested reply ${replyKey} and branch ${branchKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(referenceChainResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const messageIdResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child with message id ${messageDriftKey} under nested reply ${replyKey} and branch ${branchKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(messageIdResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const conversationIdResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child with conversation id ${conversationIdDriftKey} under nested reply ${replyKey} and branch ${branchKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(conversationIdResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const conversationIndexResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child with conversation index ${conversationDriftKey} under nested reply ${replyKey} and branch ${branchKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(conversationIndexResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const threadIndexResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child with thread index ${threadIndexDriftKey} under nested reply ${replyKey} and branch ${branchKey} has the local authored summary for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(threadIndexResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-authored`
			);

			const forwardedResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child ${childKey} under nested reply ${replyKey} for ${branchKey} forwarded chain headers show the original sender for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					2
			});
			expect(forwardedResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-forwarded`
			);
			if (mailboxStateCue) {
				const forwardedStateResults = await collection.search({
					query: `Which ${mailboxStateCue} ${childOrdinalLabel} ${spec.formatLabel} mailbox path ${branchMailboxPathCue} leaf ${branchMailboxLeaf} deep child ${childKey} under nested reply ${replyKey} forwarded chain headers show the original sender for the mixed deep child descendant thread?`,
					topK:
						replySpecs.length *
						branchKeys.length *
						nestedReplyKeys.length *
						deepChildKeys.length *
						2
				});
				expect(forwardedStateResults[0]?.chunkId).toBe(
					`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-forwarded`
				);
			}

			const quotedResults = await collection.search({
				query: `Which ${statePrefix}${childOrdinalLabel} ${spec.formatLabel} mailbox deep child ${childKey} under nested reply ${replyKey} for ${branchKey} quoted history shows the recent owner recap for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					(2 + quotedHistoryKeys.length)
			});
			expect(quotedResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-quoted-recent`
			);

			const deepestQuotedResults = await collection.search({
				query: `Which ${statePrefix}deeper older quoted history for the ${childOrdinalLabel} ${spec.formatLabel} mailbox deep child ${childKey} under nested reply ${replyKey} for ${branchKey} shows the archive escalation history for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					(2 + quotedHistoryKeys.length)
			});
			expect(deepestQuotedResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-quoted-older`
			);
			if (mailboxStateCue) {
				const quotedStateResults = await collection.search({
					query: `Which ${mailboxStateCue} ${childOrdinalLabel} ${spec.formatLabel} mailbox path ${branchMailboxPathCue} leaf ${branchMailboxLeaf} deep child ${childKey} under nested reply ${replyKey} quoted history shows the recent owner recap for the mixed deep child descendant thread?`,
					topK:
						replySpecs.length *
						branchKeys.length *
						nestedReplyKeys.length *
						deepChildKeys.length *
						(2 + quotedHistoryKeys.length)
				});
				expect(quotedStateResults[0]?.chunkId).toBe(
					`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${childKey}-quoted-recent`
				);
			}

			const inlineResults = await collection.search({
				query: `Which ${statePrefix}${inlineOrdinalLabel} inline cid resource for the ${inlineChildOrdinalLabel} ${spec.formatLabel} mailbox deep child ${inlineChildKey} with message id ${inlineMessageDriftKey}, conversation index ${inlineConversationDriftKey}, and thread index ${inlineThreadIndexDriftKey} under nested reply ${replyKey} for ${branchKey} shows the ${inlineKey} embedded deep note for the mixed deep child descendant thread?`,
				topK:
					replySpecs.length *
					branchKeys.length *
					nestedReplyKeys.length *
					deepChildKeys.length *
					inlineResourceKeys.length *
					3
			});
			expect(inlineResults[0]?.chunkId).toBe(
				`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${inlineChildKey}-inline-${inlineKey}`
			);
			if (mailboxStateCue) {
				const inlineStateResults = await collection.search({
					query: `Which ${mailboxStateCue} ${inlineOrdinalLabel} inline cid resource for the ${inlineChildOrdinalLabel} ${spec.formatLabel} mailbox path ${branchMailboxPathCue} leaf ${branchMailboxLeaf} deep child ${inlineChildKey} with message id ${inlineMessageDriftKey}, conversation id ${inlineConversationIdDriftKey}, conversation index ${inlineConversationDriftKey}, and thread index ${inlineThreadIndexDriftKey} under nested reply ${replyKey} shows the ${inlineKey} embedded deep note for the mixed deep child descendant thread?`,
					topK:
						replySpecs.length *
						branchKeys.length *
						nestedReplyKeys.length *
						deepChildKeys.length *
						inlineResourceKeys.length *
						3
				});
				expect(inlineStateResults[0]?.chunkId).toBe(
					`mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyKey}-${inlineChildKey}-inline-${inlineKey}`
				);
			}
		}
	}, 30000);

	it('prefers ost mailbox sensitivity and category-local evidence within one mailbox container', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'ost-private-archive',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.ost',
						emailMailboxFormat: 'ost',
						emailCategories: ['Archive', 'West'],
						emailSensitivity: 'private',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'OST folder mailbox thread'
					},
					text: 'Private archive west authored summary.'
				},
				{
					chunkId: 'ost-public-inbox',
					embedding: [1, 0],
					metadata: {
						emailMailboxContainerSource: 'incident-thread.ost',
						emailMailboxFormat: 'ost',
						emailCategories: ['Inbox', 'West'],
						emailSensitivity: 'normal',
						emailSectionKind: 'authored_text',
						sectionKind: 'email_block',
						threadTopic: 'OST folder mailbox thread'
					},
					text: 'Normal inbox west authored summary.'
				}
			]
		});

		const sensitivityResults = await collection.search({
			query: 'Which private archive west ost message has the authored summary?',
			topK: 1
		});

		expect(sensitivityResults[0]?.chunkId).toBe('ost-private-archive');
	});

	it('prefers archive lineage evidence for archive-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General recovery overview and support packaging notes.'
				},
				{
					chunkId: 'archive-hit',
					embedding: [1, 0],
					metadata: {
						archiveDepth: 2,
						archivePath: 'runbooks/recovery.md'
					},
					text: 'Escalation and packaging notes.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which archive entry under runbooks explains recovery?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('archive-hit');
	});

	it('prefers nested archive locality evidence for nested archive queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'archive-top-level',
					embedding: [1, 0],
					metadata: {
						archivePath: 'docs/guide.md'
					},
					text: 'Nested guide recovery notes.'
				},
				{
					chunkId: 'archive-nested',
					embedding: [1, 0],
					metadata: {
						archiveContainerPath: 'nested/inner.zip',
						archiveFullPath: 'nested/inner.zip!docs/guide.md',
						archiveNestedDepth: 3,
						archivePath: 'docs/guide.md'
					},
					text: 'Nested guide recovery notes.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which nested inner archive entry contains the guide recovery notes?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('archive-nested');
	});

	it('prefers higher-confidence OCR evidence for OCR-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'low-confidence-ocr',
					embedding: [1, 0],
					metadata: {
						ocrRegionConfidence: 0.51,
						pageNumber: 1,
						pdfTextMode: 'ocr',
						regionNumber: 1
					},
					text: 'OCR text for recovery procedure.'
				},
				{
					chunkId: 'high-confidence-ocr',
					embedding: [1, 0],
					metadata: {
						ocrRegionConfidence: 0.93,
						pageNumber: 1,
						pdfTextMode: 'ocr',
						regionNumber: 2
					},
					text: 'OCR text for recovery procedure.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which OCR region on the scanned page explains the recovery procedure?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('high-confidence-ocr');
	});

	it('prefers archive entry paths over generic chunk text in lexical retrieval', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General recovery notes and generic archive guidance.'
				},
				{
					chunkId: 'archive-hit',
					embedding: [1, 0],
					metadata: {
						archivePath: 'runbooks/recovery.md',
						fileKind: 'archive'
					},
					source: 'archives/support-bundle.zip#runbooks/recovery.md',
					text: 'Escalation and packaging notes.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which archive entry explains recovery procedures?',
			retrieval: 'lexical',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('archive-hit');
	});

	it('prefers media transcript segments over generic workflow chunks in lexical retrieval', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'Generic workflow overview for the product demo.'
				},
				{
					chunkId: 'media-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						sourceNativeKind: 'media_segment',
						mediaSegmentStartMs: 0,
						mediaSegmentEndMs: 8000,
						mediaSegments: [
							{
								speaker: 'Alex',
								text: 'AbsoluteJS keeps retrieval and evaluation aligned across every frontend.'
							}
						]
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:08.000. Daily standup transcript.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which source says the workflow stays aligned across every frontend?',
			retrieval: 'lexical',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-hit');
	});

	it('prefers media timestamp evidence for timestamp-oriented lexical queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'Generic workflow overview for the product demo.'
				},
				{
					chunkId: 'media-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						sourceNativeKind: 'media_segment',
						mediaSegmentStartMs: 0,
						mediaSegmentEndMs: 8000,
						mediaSegments: [
							{
								endMs: 8000,
								speaker: 'Alex',
								startMs: 0,
								text: 'Retrieval, citations, evaluation, and ingest workflows stay aligned across every frontend.'
							}
						]
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:08.000 from daily-standup.mp3. Audio timestamp evidence.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which audio timestamp says retrieval, citations, evaluation, and ingest workflows stay aligned across every frontend?',
			retrieval: 'lexical',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-hit');
	});

	it('prefers speaker-rich media segment evidence for speaker-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General product demo overview.'
				},
				{
					chunkId: 'media-speaker-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentCount: 3,
						mediaSpeakerCount: 2,
						sourceNativeKind: 'media_segment',
						speaker: 'Alex'
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:08.000. Alex says the workflow stays aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which speaker says the workflow stays aligned across every frontend?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-speaker-hit');
	});

	it('prefers channel-targeted media evidence for channel-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General product demo overview.'
				},
				{
					chunkId: 'media-right-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupSize: 2,
						mediaChannel: 'right',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio segment at channel right says the workflow stays aligned across every frontend.'
				},
				{
					chunkId: 'media-left-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupSize: 2,
						mediaChannel: 'left',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio segment at channel left says the workflow stays aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which left channel says the workflow stays aligned across every frontend?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-left-hit');
	});

	it('prefers continuous, long media segment windows for timeline-oriented heuristic reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-brief',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 4000,
						mediaSegmentGapFromPreviousMs: 8000,
						mediaSegmentGroupStartMs: 0,
						mediaSegmentGroupEndMs: 4000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:04.000 says retrieval stays aligned across every frontend.'
				},
				{
					chunkId: 'media-continuous',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaSegmentGroupDurationMs: 15000,
						mediaSegmentGapFromPreviousMs: 0,
						mediaSegmentGroupStartMs: 0,
						mediaSegmentGroupEndMs: 15000,
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Audio transcript segment at timestamp 00:00.000 to 00:15.000 says retrieval stays aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which continuous audio timestamp has the long duration and no gap in the workflow?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-continuous');
	});

	it('prefers media segments whose speaker metadata matches the query', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-alex-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex says the workflow stays aligned across every frontend.'
				},
				{
					chunkId: 'media-sam-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Sam',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Sam says the workflow stays aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'What did Alex say about the workflow staying aligned across every frontend?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-alex-hit');
	});

	it('prefers quoted speaker attribution matches in media reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-alex-k-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex K',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex K says the stable rollout stays aligned across every frontend.'
				},
				{
					chunkId: 'media-alex-m-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex M',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex M says the stable rollout stays aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'What did "Alex K" say about the stable rollout staying aligned across every frontend?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-alex-k-hit');
	});

	it('records quoted speaker attribution cues in rerank trace metadata', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-alex-k-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex K',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex K says the stable rollout stays aligned across every frontend.'
				},
				{
					chunkId: 'media-alex-m-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex M',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex M says the stable rollout stays aligned across every frontend.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'What did "Alex K" say about the stable rollout staying aligned across every frontend?',
			topK: 1
		});

		const rerankStage = traced.trace.steps.find(
			(step) => step.stage === 'rerank'
		);

		expect(rerankStage?.metadata).toMatchObject({
			applied: true,
			leadSpeakerCue: 'Alex K',
			leadSpeakerAttributionCue: 'quoted_match'
		});
	});

	it('prefers quoted channel attribution matches in media reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-left-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex says the stable rollout stays aligned across every frontend.'
				},
				{
					chunkId: 'media-right-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'right',
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex says the stable rollout stays aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'What did Alex say on the "left" channel about the stable rollout staying aligned across every frontend?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-left-hit');
	});

	it('records quoted channel attribution cues in rerank trace metadata', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-left-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex says the stable rollout stays aligned across every frontend.'
				},
				{
					chunkId: 'media-right-hit',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'right',
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex says the stable rollout stays aligned across every frontend.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'What did Alex say on the "left" channel about the stable rollout staying aligned across every frontend?',
			topK: 1
		});

		const rerankStage = traced.trace.steps.find(
			(step) => step.stage === 'rerank'
		);

		expect(rerankStage?.metadata).toMatchObject({
			applied: true,
			leadChannelCue: 'left',
			leadChannelAttributionCue: 'quoted_match'
		});
	});

	it('prefers continuous follow-up media segments for next/after queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-follow-up-gapless',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						mediaSegmentGapFromPreviousMs: 0,
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex immediately follows with the next segment about the rollout staying aligned.'
				},
				{
					chunkId: 'media-follow-up-gapped',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						mediaSegmentGapFromPreviousMs: 9000,
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex follows later with a delayed segment about the rollout staying aligned.'
				}
			]
		});

		const results = await collection.search({
			query: 'What does Alex say in the next left channel segment after the rollout update?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-follow-up-gapless');
	});

	it('prefers continuous prior media segments for before/previous queries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-prior-gapless',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						mediaSegmentGapToNextMs: 0,
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex speaks immediately before the rollout update in the prior left channel segment.'
				},
				{
					chunkId: 'media-prior-gapped',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						mediaSegmentGapToNextMs: 9000,
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex speaks much earlier before the rollout update in a delayed prior segment.'
				}
			]
		});

		const results = await collection.search({
			query: 'What did Alex say in the previous left channel segment before the rollout update?',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-prior-gapless');
	});

	it('records media speaker, channel, and continuity cues in rerank trace metadata', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-prior-gapless',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						mediaSegmentGapToNextMs: 0,
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex speaks immediately before the rollout update in the prior left channel segment.'
				},
				{
					chunkId: 'media-prior-gapped',
					embedding: [1, 0],
					metadata: {
						fileKind: 'media',
						mediaKind: 'audio',
						mediaChannel: 'left',
						mediaSegmentGapToNextMs: 9000,
						speaker: 'Alex',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'Alex speaks much earlier before the rollout update in a delayed prior segment.'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'What did Alex say in the previous left channel segment before the rollout update?',
			topK: 1
		});

		const rerankStage = traced.trace.steps.find(
			(step) => step.stage === 'rerank'
		);

		expect(rerankStage?.metadata).toMatchObject({
			applied: true,
			leadSpeakerCue: 'Alex',
			leadChannelCue: 'left',
			leadContinuityCue: 'immediate_prior'
		});
	});

	it('supports first-class hybrid retrieval with lexical fusion', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) => {
				if (text === 'regional growth sheet') return [1, 0];
				if (text.includes('generic')) return [1, 0];
				if (text.includes('Spreadsheet workbook')) return [0.2, 0.8];

				return [0, 1];
			}
		});
		const collection = createRAGCollection({
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic:001',
					embedding: [1, 0],
					text: 'generic generic generic'
				},
				{
					chunkId: 'target:001',
					embedding: [0.2, 0.8],
					metadata: { sheetName: 'Regional Growth' },
					source: 'files/revenue-forecast.xlsx',
					text: 'Spreadsheet workbook.'
				}
			]
		});

		const vectorOnly = await collection.search({
			query: 'regional growth sheet',
			retrieval: 'vector',
			topK: 1
		});
		const hybrid = await collection.search({
			query: 'regional growth sheet',
			retrieval: 'hybrid',
			topK: 1
		});

		expect(vectorOnly[0]?.chunkId).toBe('generic:001');
		expect(hybrid[0]?.chunkId).toBe('target:001');
		expect(hybrid[0]?.metadata).toMatchObject({
			retrievalSignals: {
				lexical: true
			}
		});
	});

	it('caps final retrieval results per source when source diversity is enabled', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [1, 0]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'a-1',
					embedding: [1, 0],
					metadata: { documentId: 'doc-a-1' },
					source: 'source-a',
					text: 'alpha one'
				},
				{
					chunkId: 'a-2',
					embedding: [1, 0],
					metadata: { documentId: 'doc-a-2' },
					source: 'source-a',
					text: 'alpha two'
				},
				{
					chunkId: 'b-1',
					embedding: [0.99, 0.01],
					metadata: { documentId: 'doc-b-1' },
					source: 'source-b',
					text: 'beta one'
				}
			]
		});

		const results = await collection.search({
			query: 'alpha',
			retrieval: {
				maxResultsPerSource: 1,
				mode: 'vector'
			},
			topK: 3
		});

		expect(results.map((entry) => entry.source)).toEqual([
			'source-a',
			'source-b'
		]);

		const traced = await collection.searchWithTrace({
			query: 'alpha',
			retrieval: {
				maxResultsPerSource: 1,
				mode: 'vector'
			},
			topK: 3
		});

		expect(traced.trace.maxResultsPerSource).toBe(1);
		expect(traced.trace.steps.map((step) => step.stage)).toContain(
			'source_balance'
		);
	});

	it('can interleave sources with round-robin source balancing', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'a-1',
					embedding: [1, 0],
					source: 'source-a',
					text: 'alpha one'
				},
				{
					chunkId: 'a-2',
					embedding: [0.99, 0.01],
					source: 'source-a',
					text: 'alpha two'
				},
				{
					chunkId: 'b-1',
					embedding: [0.98, 0.02],
					source: 'source-b',
					text: 'beta one'
				},
				{
					chunkId: 'b-2',
					embedding: [0.97, 0.03],
					source: 'source-b',
					text: 'beta two'
				}
			]
		});

		const traced = await collection.searchWithTrace({
			query: 'alpha',
			retrieval: {
				maxResultsPerSource: 2,
				mode: 'vector',
				sourceBalanceStrategy: 'round_robin'
			},
			topK: 4
		});

		expect(traced.results.map((entry) => entry.source)).toEqual([
			'source-b',
			'source-a',
			'source-b',
			'source-a'
		]);
		expect(traced.trace.sourceBalanceStrategy).toBe('round_robin');
		expect(
			traced.trace.steps.find((step) => step.stage === 'source_balance')
				?.metadata?.strategy
		).toBe('round_robin');
	});

	it('can apply MMR diversity reordering to reduce redundant vector hits', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [0.7071, 0.7071]
		});
		const collection = createRAGCollection({ store });

		await collection.ingest({
			chunks: [
				{
					chunkId: 'a-1',
					embedding: [1, 0],
					source: 'source-a',
					text: 'alpha one'
				},
				{
					chunkId: 'a-2',
					embedding: [1, 0],
					source: 'source-a',
					text: 'alpha two'
				},
				{
					chunkId: 'b-1',
					embedding: [0, 1],
					source: 'source-b',
					text: 'beta one'
				}
			]
		});

		const baseline = await collection.search({
			query: 'alpha beta',
			retrieval: { mode: 'vector' },
			topK: 3
		});
		expect(baseline.map((entry) => entry.chunkId)).toEqual([
			'a-1',
			'a-2',
			'b-1'
		]);

		const traced = await collection.searchWithTrace({
			query: 'alpha beta',
			retrieval: {
				mode: 'vector',
				diversityStrategy: 'mmr',
				mmrLambda: 0.5
			},
			topK: 3
		});

		expect(traced.results.map((entry) => entry.chunkId)).toEqual([
			'a-1',
			'b-1',
			'a-2'
		]);
		expect(traced.trace.diversityStrategy).toBe('mmr');
		expect(
			traced.trace.steps.find((step) => step.stage === 'diversity')
				?.metadata?.mmrLambda
		).toBe(0.5);
	});

	it('ingests document inputs through the collection helper', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('glacier-fox-9182') ? [1, 0] : [0, 1]
		});
		const collection = createRAGCollection({ store });

		await ingestRAGDocuments(collection, {
			documents: [
				{
					id: 'launch-checklist',
					source: 'notes/launch-checklist.md',
					text: '# Launch Checklist\n\nAbsoluteJS demo verification phrase: glacier-fox-9182.'
				}
			]
		});

		const results = await collection.search({
			query: 'glacier-fox-9182'
		});

		expect(results[0]?.chunkId).toBe('launch-checklist:001');
		expect(results[0]?.source).toBe('notes/launch-checklist.md');
		expect(results[0]?.metadata).toMatchObject({
			documentId: 'launch-checklist',
			format: 'markdown'
		});
	});

	it('uses an explicit embedding provider for search', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [0, 1]
		});
		const collection = createRAGCollection({
			embedding: createRAGEmbeddingProvider({
				dimensions: 2,
				embed: async () => [1, 0]
			}),
			store
		});

		await collection.ingest({
			chunks: [
				{ chunkId: 'alpha', embedding: [1, 0], text: 'alpha' },
				{ chunkId: 'beta', embedding: [0, 1], text: 'beta' }
			]
		});

		const results = await collection.search({
			query: 'which one is alpha?'
		});

		expect(results[0]?.chunkId).toBe('alpha');
	});

	it('uses an explicit embedding provider for ingest and respects collection model defaults', async () => {
		const seenModels: string[] = [];
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async () => [0, 1]
		});
		const collection = createRAGCollection({
			defaultModel: 'demo-embed-small',
			embedding: createRAGEmbeddingProvider({
				defaultModel: 'provider-default',
				dimensions: 2,
				embed: async ({ model, text }) => {
					seenModels.push(model ?? 'missing');

					return text.includes('glacier-fox-9182') ? [1, 0] : [0, 1];
				}
			}),
			store
		});

		await ingestRAGDocuments(collection, {
			documents: [
				{
					id: 'provider-proof',
					source: 'notes/provider-proof.md',
					text: '# Provider Proof\n\nglacier-fox-9182'
				}
			]
		});

		const results = await collection.search({
			model: 'query-override',
			query: 'glacier-fox-9182'
		});

		expect(results[0]?.chunkId).toBe('provider-proof:001');
		expect(seenModels).toContain('demo-embed-small');
		expect(seenModels).toContain('query-override');
	});

	it('rejects embedding vectors with mismatched dimensions', async () => {
		const collection = createRAGCollection({
			embedding: createRAGEmbeddingProvider({
				dimensions: 3,
				embed: async () => [1, 0]
			}),
			store: createInMemoryRAGStore({ dimensions: 3 })
		});

		await expect(
			collection.search({ query: 'bad dimensions' })
		).rejects.toThrow(
			'RAG query embedding dimension mismatch. Expected 3, received 2.'
		);
	});

	it('supports first-party query transforms before retrieval and reranking', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('workbook') ? [0, 1] : [1, 0]
		});
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			rerank: createHeuristicRAGReranker(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'generic',
					embedding: [1, 0],
					text: 'General workflow summary.'
				},
				{
					chunkId: 'sheet-hit',
					embedding: [0, 1],
					metadata: { sheetName: 'Regional Growth' },
					source: 'files/revenue-forecast.xlsx',
					text: 'Quarterly planning workbook.'
				}
			]
		});

		const results = await collection.search({
			query: 'regional growth sheet',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('sheet-hit');
	});

	it('treats transformed query variants as fallback candidates instead of co-equal primaries', async () => {
		const store = createInMemoryRAGStore({
			dimensions: 2,
			mockEmbedding: async (text) =>
				text.includes('00:00') ? [0, 1] : [1, 0]
		});
		const collection = createRAGCollection({
			queryTransform: createHeuristicRAGQueryTransform(),
			store
		});

		await collection.ingest({
			chunks: [
				{
					chunkId: 'media-hit',
					embedding: [0, 1],
					metadata: {
						mediaKind: 'audio',
						sourceNativeKind: 'media_segment'
					},
					source: 'files/daily-standup.mp3',
					text: 'At timestamp 00:00 to 00:08, the daily standup audio says retrieval stays aligned across every frontend.'
				},
				{
					chunkId: 'generic-hit',
					embedding: [1, 0],
					source: 'playbook/ops.md',
					text: 'Retrieval and evaluation workflows stay aligned across every frontend.'
				}
			]
		});

		const results = await collection.search({
			query: 'Which daily standup audio timestamp 00:00 to 00:08 says retrieval stays aligned across every frontend?',
			retrieval: 'hybrid',
			topK: 1
		});

		expect(results[0]?.chunkId).toBe('media-hit');
	});

	it('leans harder into sheet-named workbook queries and media timestamp queries', async () => {
		const queryTransform = createHeuristicRAGQueryTransform();
		const spreadsheet = await queryTransform.transform({
			query: 'Which workbook sheet is named Regional Growth?',
			topK: 4
		});
		const media = await queryTransform.transform({
			query: 'Which audio timestamp says the workflow stays aligned?',
			topK: 4
		});

		expect(
			(spreadsheet.variants ?? []).some(
				(variant) =>
					variant.includes('regional') &&
					variant.includes('growth') &&
					variant.includes('spreadsheet') &&
					variant.includes('worksheet') &&
					variant.includes('named')
			)
		).toBe(true);
		expect(
			(media.variants ?? []).some(
				(variant) =>
					variant.includes('audio') &&
					variant.includes('timestamp') &&
					variant.includes('media') &&
					variant.includes('transcript') &&
					variant.includes('segment')
			)
		).toBe(true);
	});

	it('preserves exact source-native queries as the primary query', async () => {
		const queryTransform = createHeuristicRAGQueryTransform();
		const spreadsheet = await queryTransform.transform({
			query: 'Which revenue forecast workbook sheet named Regional Growth tracks market expansion by territory?',
			topK: 4
		});
		const media = await queryTransform.transform({
			query: 'Which daily standup audio timestamp 00:00 to 00:08 says retrieval stays aligned across every frontend?',
			topK: 4
		});

		expect(spreadsheet.query).toBe(
			'Which revenue forecast workbook sheet named Regional Growth tracks market expansion by territory?'
		);
		expect(media.query).toBe(
			'Which daily standup audio timestamp 00:00 to 00:08 says retrieval stays aligned across every frontend?'
		);
		expect((spreadsheet.variants ?? []).length).toBeGreaterThan(0);
		expect(media.variants ?? []).toHaveLength(0);
	});
});
