import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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
	createRAGChunkingRegistry,
	createRAGFileExtractor,
	createRAGFileExtractorRegistry,
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
import type { RAGContentFormat } from '../../../../types/ai';
import {
	MIXED_MAILBOX_BRANCH_KEYS,
	MIXED_MAILBOX_DEEP_CHILD_KEYS,
	MIXED_MAILBOX_INLINE_RESOURCE_KEYS,
	MIXED_MAILBOX_NESTED_REPLY_ORDINALS,
	MIXED_MAILBOX_REPLY_SPECS,
	MIXED_MAILBOX_THREAD_INDEX_DRIFT_KEYS,
	RECOVERED_PST_CASE_KEYS,
	RECOVERED_PST_BRANCH_KEYS,
	RECOVERED_PST_FAMILY_KEYS,
	buildRecoveredPstMailboxMessage,
	recoveredPstMailboxMetadata,
	recoveredPstMessageAttachmentSource,
	recoveredPstMessageSource,
	recoveredPstStateFlags,
	mixedMailboxExpectedChildSource,
	mixedMailboxExpectedDeepChildSource,
	mixedMailboxExpectedDeepInlineSource,
	mixedMailboxExpectedNestedReplySource
} from './emailMailboxAdversary';

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

const EXTRACTION_FIXTURE_DIRECTORY = resolve(
	import.meta.dir,
	'../../../fixtures/ai/rag/extraction'
);

const loadExtractionFixture = (relativePath: string) =>
	readFileSync(join(EXTRACTION_FIXTURE_DIRECTORY, relativePath));

const buildRecoveredPstMailboxMetadata = ({
	caseKey,
	containerSource,
	ordinal,
	stateFlags = recoveredPstStateFlags(ordinal)
}: {
	caseKey: string;
	containerSource: string;
	ordinal: number;
	stateFlags?: string[];
}) =>
	recoveredPstMailboxMetadata({
		caseKey,
		containerSource,
		ordinal,
		stateFlags
	});

type ExtractionFixtureScorecard = {
	documents: {
		path: string;
		expectedFormat?: RAGContentFormat;
		expectedText: string[];
		excludedText?: string[];
		expectedMetadata?: Record<string, unknown>;
	}[];
	officeArchives: {
		tree: string;
		fileName: string;
		expectedText: string[];
		expectedMetadata?: Record<string, unknown>;
	}[];
};

const EXTRACTION_FIXTURE_SCORECARD = JSON.parse(
	loadExtractionFixture('scorecard.json').toString('utf8')
) as ExtractionFixtureScorecard;

const readFixtureTree = (
	directory: string
): Record<string, string | Uint8Array> => {
	const root = join(EXTRACTION_FIXTURE_DIRECTORY, directory);
	const entries: Record<string, string | Uint8Array> = {};
	const visit = (currentPath: string) => {
		for (const entry of readdirSync(currentPath)) {
			const fullPath = join(currentPath, entry);
			if (statSync(fullPath).isDirectory()) {
				visit(fullPath);
				continue;
			}

			entries[relative(root, fullPath).replace(/\\/g, '/')] =
				readFileSync(fullPath);
		}
	};

	visit(root);

	return entries;
};

const withTempFixtureFile = async <T>(
	fileName: string,
	content: Uint8Array,
	callback: (path: string) => Promise<T>
) => {
	const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-fixture-'));

	try {
		const path = join(tempDir, fileName);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);

		return await callback(path);
	} finally {
		rmSync(tempDir, { force: true, recursive: true });
	}
};

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

const buildRecoveredPstNestedAttachedEmail = ({
	branchKey,
	depth,
	familyKey,
	maxDepth,
	messageIdPrefix,
	ordinal,
	parentMessageId
}: {
	branchKey?: string;
	depth: number;
	familyKey: string;
	maxDepth: number;
	messageIdPrefix: string;
	ordinal: number;
	parentMessageId: string;
}): string => {
	const branchSegment = branchKey ? `-${branchKey}` : '';
	const branchText = branchKey ? ` ${branchKey}` : '';
	const nestedArchive = createStoredZip({
		[`docs/${familyKey}${branchSegment}-level-${depth}.md`]: `# ${familyKey}${branchText} level ${depth}\n\nRecovered PST nested attached ${familyKey}${branchText} text ${ordinal} depth ${depth}`
	});
	const messageId = `<${messageIdPrefix}-${ordinal}-${familyKey}${branchSegment}-level-${depth}@example.com>`;
	const boundary = `pst-attached-${messageIdPrefix}-${ordinal}-${familyKey}${branchSegment}-${depth}`;
	const nextAttachmentName =
		depth < maxDepth
			? `thread-${familyKey}${branchSegment}-level-${depth + 1}.eml`
			: undefined;

	return [
		`Subject: PST attached child ${familyKey}${branchText} ${ordinal} level ${depth}`,
		`From: child-${familyKey}${branchSegment}-${ordinal}-${depth}@example.com`,
		'To: ops@example.com',
		`Message-ID: ${messageId}`,
		`In-Reply-To: ${parentMessageId}`,
		`References: ${parentMessageId} ${messageId}`,
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/plain; charset=utf-8',
		'',
		`Recovered PST nested attached child body ${familyKey}${branchText} ${ordinal} level ${depth}.`,
		`--${boundary}`,
		`Content-Type: application/zip; name="nested-${familyKey}${branchSegment}-level-${depth}.zip"`,
		`Content-Disposition: attachment; filename="nested-${familyKey}${branchSegment}-level-${depth}.zip"`,
		'Content-Transfer-Encoding: base64',
		'',
		Buffer.from(nestedArchive).toString('base64'),
		...(typeof nextAttachmentName === 'string'
			? [
					`--${boundary}`,
					`Content-Type: message/rfc822; name="${nextAttachmentName}"`,
					`Content-Disposition: attachment; filename="${nextAttachmentName}"`,
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(
						buildRecoveredPstNestedAttachedEmail({
							branchKey,
							depth: depth + 1,
							familyKey,
							maxDepth,
							messageIdPrefix,
							ordinal,
							parentMessageId: messageId
						}),
						'utf8'
					).toString('base64')
				]
			: []),
		`--${boundary}--`
	].join('\n');
};

const buildRecoveredPstReplyParentEmail = ({
	familyKey,
	forwarded = false,
	ordinal,
	parentMessageId,
	replyCount
}: {
	familyKey: string;
	forwarded?: boolean;
	ordinal: number;
	parentMessageId: string;
	replyCount: number;
}): string => {
	const parentBoundary = forwarded
		? `pst-forwarded-parent-${ordinal}-${familyKey}`
		: `pst-parent-${ordinal}-${familyKey}`;
	const childBoundaryPrefix = forwarded
		? 'pst-forwarded-sibling'
		: 'pst-attached-sibling';
	const replyAttachmentPrefix = forwarded ? 'forwarded-reply' : 'reply';
	const replyIdPrefix = forwarded
		? 'pst-generated-forwarded-reply'
		: 'pst-generated-sibling-reply';
	const replySubjectPrefix = forwarded
		? 'PST forwarded attached reply'
		: 'PST attached reply';
	const replyBodyPrefix = forwarded
		? 'Recovered PST forwarded attached sibling reply body'
		: 'Recovered PST attached sibling reply body';
	const archiveTextPrefix = forwarded
		? 'Recovered PST forwarded attached reply'
		: 'Recovered PST attached reply';
	const parentSubjectPrefix = forwarded
		? 'PST forwarded attached parent'
		: 'PST attached parent';
	const parentBodyPrefix = forwarded
		? 'Recovered PST forwarded attached parent body'
		: 'Recovered PST attached parent body';

	const replyBlocks = Array.from({ length: replyCount }, (_, index) => {
		const replyOrdinal = index + 1;
		const replyArchive = createStoredZip({
			[`docs/${familyKey}${forwarded ? '-forwarded' : ''}-reply-${replyOrdinal}.md`]: `# ${familyKey}${forwarded ? ' forwarded' : ''} reply ${replyOrdinal}\n\n${archiveTextPrefix} ${familyKey} text ${ordinal} reply ${replyOrdinal}`
		});
		const replyMessageId = `<${replyIdPrefix}-${ordinal}-${familyKey}-${replyOrdinal}@example.com>`;
		const childBoundary = `${childBoundaryPrefix}-${ordinal}-${familyKey}-${replyOrdinal}`;
		const replyEmail = [
			`Subject: ${replySubjectPrefix} ${familyKey} ${ordinal} ${replyOrdinal}`,
			`From: child-${familyKey}-${ordinal}-${replyOrdinal}@example.com`,
			'To: ops@example.com',
			`Message-ID: ${replyMessageId}`,
			`In-Reply-To: ${parentMessageId}`,
			`References: ${parentMessageId} ${replyMessageId}`,
			`Content-Type: multipart/mixed; boundary="${childBoundary}"`,
			'',
			`--${childBoundary}`,
			'Content-Type: text/plain; charset=utf-8',
			'',
			`${replyBodyPrefix} ${familyKey} ${ordinal} reply ${replyOrdinal}.`,
			...(forwarded
				? [
						'',
						'---------- Forwarded message ----------',
						`From: forwarded-${familyKey}-${replyOrdinal}@example.com`,
						'Date: Tue, Apr 21, 2026 at 9:15 AM',
						`Subject: Forwarded ${familyKey} review ${replyOrdinal}`,
						'To: ops@example.com',
						'',
						'---------- Forwarded message ----------',
						`From: forwarded-${familyKey}-${replyOrdinal}-prior@example.com`,
						'Date: Tue, Apr 21, 2026 at 8:00 AM',
						`Subject: Prior forwarded ${familyKey} review ${replyOrdinal}`,
						'To: ops@example.com'
					]
				: []),
			`--${childBoundary}`,
			`Content-Type: application/zip; name="nested-${familyKey}${forwarded ? '-forwarded' : ''}-reply-${replyOrdinal}.zip"`,
			`Content-Disposition: attachment; filename="nested-${familyKey}${forwarded ? '-forwarded' : ''}-reply-${replyOrdinal}.zip"`,
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(replyArchive).toString('base64'),
			`--${childBoundary}--`
		].join('\n');

		return [
			`--${parentBoundary}`,
			`Content-Type: message/rfc822; name="${replyAttachmentPrefix}-${familyKey}-${replyOrdinal}.eml"`,
			`Content-Disposition: attachment; filename="${replyAttachmentPrefix}-${familyKey}-${replyOrdinal}.eml"`,
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(replyEmail, 'utf8').toString('base64')
		];
	}).flat();

	return [
		`Subject: ${parentSubjectPrefix} ${familyKey} ${ordinal}`,
		`From: parent-${familyKey}-${ordinal}@example.com`,
		'To: ops@example.com',
		`Message-ID: ${parentMessageId}`,
		`Content-Type: multipart/mixed; boundary="${parentBoundary}"`,
		'',
		`--${parentBoundary}`,
		'Content-Type: text/plain; charset=utf-8',
		'',
		`${parentBodyPrefix} ${familyKey} ${ordinal}.`,
		...replyBlocks,
		`--${parentBoundary}--`
	].join('\n');
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

	it('applies chunking registry profiles before default chunking', () => {
		const registry = createRAGChunkingRegistry([
			{
				name: 'markdown_source_aware',
				resolve: ({ format }) =>
					format === 'markdown'
						? {
								chunkOverlap: 0,
								maxChunkLength: 80,
								minChunkLength: 1,
								strategy: 'source_aware'
							}
						: undefined
			}
		]);

		const prepared = prepareRAGDocument(
			{
				source: 'notes.md',
				text: '# Alpha\n\nFirst section body.\n\n## Beta\n\nSecond section body.'
			},
			undefined,
			registry
		);

		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionKind: 'markdown_heading',
			sectionTitle: 'Alpha'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			sectionKind: 'markdown_heading',
			sectionPath: ['Alpha', 'Beta'],
			sectionTitle: 'Beta'
		});
	});

	it('uses source-aware splitting for jsonl records', () => {
		const prepared = prepareRAGDocument(
			{
				source: 'events.jsonl',
				text: [
					'{"tenant":"acme","status":"ready","tags":["release","ops"]}',
					'{"tenant":"beta","status":"blocked","tags":["finance"]}'
				].join('\n')
			},
			{
				chunkOverlap: 0,
				maxChunkLength: 120,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		);

		expect(prepared.format).toBe('jsonl');
		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionKind: 'jsonl_record',
			sectionPath: ['Record 1'],
			sectionTitle: 'Record 1',
			sourceAwareChunkReason: 'source_native_unit'
		});
		expect(prepared.chunks[0]?.text).toContain('tenant: acme');
		expect(prepared.chunks[0]?.text).toContain('tags: release, ops');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			sectionKind: 'jsonl_record',
			sectionPath: ['Record 2'],
			sectionTitle: 'Record 2'
		});
		expect(prepared.chunks[1]?.text).toContain('status: blocked');
	});

	it('uses source-aware splitting for tsv rows', () => {
		const prepared = prepareRAGDocument(
			{
				source: 'events.tsv',
				text: [
					'tenant\tstatus\ttags',
					'acme\tready\t"release, ops"',
					'beta\tblocked\tfinance'
				].join('\n')
			},
			{
				chunkOverlap: 0,
				maxChunkLength: 120,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		);

		expect(prepared.format).toBe('tsv');
		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionKind: 'tsv_row',
			sectionPath: ['Row 1'],
			sectionTitle: 'Row 1',
			sourceAwareChunkReason: 'source_native_unit'
		});
		expect(prepared.chunks[0]?.text).toContain('tenant: acme');
		expect(prepared.chunks[0]?.text).toContain('status: ready');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			sectionKind: 'tsv_row',
			sectionPath: ['Row 2'],
			sectionTitle: 'Row 2'
		});
		expect(prepared.chunks[1]?.text).toContain('tags: finance');
	});

	it('uses source-aware splitting for csv rows', () => {
		const prepared = prepareRAGDocument(
			{
				source: 'events.csv',
				text: [
					'tenant,status,tags',
					'acme,ready,"release, ops"',
					'beta,blocked,finance'
				].join('\n')
			},
			{
				chunkOverlap: 0,
				maxChunkLength: 120,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		);

		expect(prepared.format).toBe('csv');
		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionKind: 'csv_row',
			sectionPath: ['Row 1'],
			sectionTitle: 'Row 1',
			sourceAwareChunkReason: 'source_native_unit'
		});
		expect(prepared.chunks[0]?.text).toContain('tenant: acme');
		expect(prepared.chunks[0]?.text).toContain('tags: release, ops');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			sectionKind: 'csv_row',
			sectionPath: ['Row 2'],
			sectionTitle: 'Row 2'
		});
		expect(prepared.chunks[1]?.text).toContain('status: blocked');
	});

	it('uses source-aware splitting for xml nodes', () => {
		const prepared = prepareRAGDocument(
			{
				source: 'feed.xml',
				text: [
					'<feed>',
					'  <entry><title>Release</title><status>ready</status></entry>',
					'  <entry><title>Finance</title><status>blocked</status></entry>',
					'</feed>'
				].join('\n')
			},
			{
				chunkOverlap: 0,
				maxChunkLength: 140,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		);

		expect(prepared.format).toBe('xml');
		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionKind: 'xml_node',
			sectionPath: ['entry'],
			sectionTitle: 'entry',
			sourceAwareChunkReason: 'source_native_unit'
		});
		expect(prepared.chunks[0]?.text).toContain('Release');
		expect(prepared.chunks[1]?.text).toContain('blocked');
	});

	it('uses source-aware splitting for yaml sections', () => {
		const prepared = prepareRAGDocument(
			{
				source: 'config.yaml',
				text: [
					'tenant: acme',
					'status: ready',
					'pipeline:',
					'  stage: release',
					'  owner: ops'
				].join('\n')
			},
			{
				chunkOverlap: 0,
				maxChunkLength: 140,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		);

		expect(prepared.format).toBe('yaml');
		expect(prepared.chunks).toHaveLength(3);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionKind: 'yaml_section',
			sectionPath: ['tenant'],
			sectionTitle: 'tenant',
			sourceAwareChunkReason: 'source_native_unit'
		});
		expect(prepared.chunks[0]?.text).toContain('tenant');
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			sectionKind: 'yaml_section',
			sectionPath: ['pipeline'],
			sectionTitle: 'pipeline'
		});
		expect(prepared.chunks[2]?.text).toContain('owner: ops');
	});

	it('lets explicit document chunking override the chunking registry', () => {
		const registry = createRAGChunkingRegistry([
			{
				name: 'sentence_chunks',
				resolve: () => ({
					chunkOverlap: 0,
					maxChunkLength: 24,
					minChunkLength: 1,
					strategy: 'sentences'
				})
			}
		]);

		const prepared = prepareRAGDocument(
			{
				chunking: {
					chunkOverlap: 0,
					maxChunkLength: 200,
					minChunkLength: 1,
					strategy: 'paragraphs'
				},
				source: 'notes.txt',
				text: 'Alpha first sentence. Beta second sentence.'
			},
			undefined,
			registry
		);

		expect(prepared.chunks).toHaveLength(1);
		expect(prepared.chunks[0]?.text).toBe(
			'Alpha first sentence. Beta second sentence.'
		);
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
		expect(prepared.chunks[1]?.title).toBe('guides-structure-md · Details');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			sectionDepth: 2,
			sectionChunkCount: 1,
			sectionChunkIndex: 0,
			sectionKind: 'markdown_heading',
			sectionPath: ['Intro', 'Details'],
			sectionTitle: 'Details',
			sourceAwareChunkReason: 'section_boundary',
			previousChunkId: 'guides-structure-md:001',
			sectionChunkId: 'guides-structure-md:section:intro-details'
		});
		expect(prepared.chunks[1]?.metadata?.nextChunkId).toBe(
			'guides-structure-md:003'
		);
	});

	it('uses source-aware splitting for html headings while preserving hierarchy', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 200,
				strategy: 'source_aware'
			},
			source: 'docs/release.html',
			text: loadExtractionFixture('sample.html').toString('utf8')
		});

		expect(prepared.chunks.length).toBeGreaterThanOrEqual(2);
		expect(prepared.chunks[0]?.text).toContain('Release Ops Overview');
		expect(prepared.chunks[0]?.text).toContain(
			'AbsoluteJS surfaces release incidents'
		);
		const stableChunk = prepared.chunks.find((chunk) =>
			chunk.text.includes('Stable blockers')
		);
		expect(stableChunk?.text).toContain('Release Ops Overview');
		expect(stableChunk?.text).toContain(
			'Stable blockers should explain the failing gate'
		);
		expect(stableChunk?.title).toBe('docs-release-html · Stable blockers');
		expect(stableChunk?.metadata).toMatchObject({
			sectionDepth: 2,
			sectionChunkCount: 2,
			sectionChunkIndex: 0,
			sectionKind: 'html_heading',
			sectionPath: ['Release Ops Overview', 'Stable blockers'],
			sectionTitle: 'Stable blockers',
			sectionChunkId:
				'docs-release-html:section:release-ops-overview-stable-blockers'
		});
		expect(
			prepared.chunks.some((chunk) =>
				chunk.text.includes(
					'release control guide (absolutejs.dev/docs/release-control)'
				)
			)
		).toBe(true);
		expect(
			prepared.chunks.some((chunk) =>
				chunk.text.includes('handoff playbook (/docs/handoffs)')
			)
		).toBe(true);
		expect(
			prepared.chunks.some((chunk) =>
				chunk.text.includes('Docs | Pricing | Sign in')
			)
		).toBe(false);
	});

	it('splits long source-aware sections into stable paragraph groups without overlap carry', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 140,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			source: 'guides/stable-section.md',
			text: [
				'# Release Ops',
				'',
				'## Stable Lane',
				'',
				'Paragraph one keeps the stable lane summary explicit for citations and review.',
				'',
				'Paragraph two explains the approval gate and should become its own stable chunk boundary.',
				'',
				'Paragraph three records the handoff readiness signal without inheriting overlap text from the prior paragraph.',
				'',
				'## Canary Lane',
				'',
				'Canary text stays separate.'
			].join('\n')
		});

		const stableChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.sectionChunkId ===
				'guides-stable-section-md:section:release-ops-stable-lane'
		);

		expect(stableChunks).toHaveLength(3);
		expect(
			stableChunks.map((chunk) => chunk.metadata?.sectionChunkIndex)
		).toEqual([0, 1, 2]);
		expect(
			stableChunks.map((chunk) => chunk.metadata?.sourceAwareChunkReason)
		).toEqual(['size_limit', 'size_limit', 'size_limit']);
		expect(
			stableChunks.map((chunk) => chunk.metadata?.sectionChunkCount)
		).toEqual([3, 3, 3]);
		expect(stableChunks[0]?.text).toContain(
			'Paragraph one keeps the stable lane summary explicit'
		);
		expect(stableChunks[1]?.text).toContain(
			'Paragraph two explains the approval gate'
		);
		expect(stableChunks[1]?.text).not.toContain(
			'Paragraph one keeps the stable lane summary explicit'
		);
		expect(stableChunks[2]?.text).toContain(
			'Paragraph three records the handoff readiness signal'
		);
		expect(stableChunks[2]?.text).not.toContain(
			'Paragraph two explains the approval gate'
		);
	});

	it('keeps fenced markdown code blocks intact as source-aware chunk units', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 120,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			source: 'guides/code-sample.md',
			text: [
				'# SDK Guide',
				'',
				'## Client Setup',
				'',
				'Use the client exactly as shown below when configuring the release workflow.',
				'',
				'```ts',
				'const client = createClient({ apiKey: env.API_KEY });',
				'client.release("stable");',
				'```',
				'',
				'Keep the stable rollout separate from canary experiments.'
			].join('\n')
		});

		const clientSetupChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.sectionChunkId ===
				'guides-code-sample-md:section:sdk-guide-client-setup'
		);

		expect(clientSetupChunks.length).toBeGreaterThanOrEqual(2);
		const codeChunk = clientSetupChunks.find(
			(chunk) =>
				chunk.text.includes(
					'const client = createClient({ apiKey: env.API_KEY });'
				) && chunk.text.includes('client.release("stable");')
		);
		expect(codeChunk).toBeDefined();
		expect(codeChunk?.text).not.toContain(
			'Use the client exactly as shown below'
		);
		expect(codeChunk?.text).not.toContain(
			'Keep the stable rollout separate from canary experiments.'
		);
		expect(codeChunk?.metadata).toMatchObject({
			sectionKind: 'markdown_heading',
			sectionPath: ['SDK Guide', 'Client Setup'],
			sourceAwareChunkReason: 'size_limit'
		});
	});

	it('uses source-aware splitting for code-like files by top-level declaration', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 220,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			source: 'src/release.ts',
			text: [
				"import { createClient } from './client';",
				'',
				'export const buildReleasePlan = (input: string) => {',
				'  return `plan:${input}`;',
				'};',
				'',
				'export async function runRelease(id: string) {',
				'  const client = createClient();',
				'  return client.run(id);',
				'}'
			].join('\n')
		});

		expect(prepared.chunks.length).toBeGreaterThanOrEqual(3);
		expect(
			prepared.chunks.some(
				(chunk) =>
					chunk.text.includes(
						"import { createClient } from './client';"
					) &&
					chunk.metadata?.sectionKind === 'code_block' &&
					chunk.metadata?.sectionTitle ===
						"import { createClient } from './client';"
			)
		).toBe(true);
		expect(
			prepared.chunks.some(
				(chunk) =>
					chunk.text.includes('export const buildReleasePlan') &&
					chunk.text.includes('return `plan:${input}`;') &&
					chunk.metadata?.sectionKind === 'code_block' &&
					chunk.metadata?.sectionTitle === 'buildReleasePlan'
			)
		).toBe(true);
		expect(
			prepared.chunks.some(
				(chunk) =>
					chunk.text.includes('export async function runRelease') &&
					chunk.text.includes('return client.run(id);') &&
					chunk.metadata?.sectionKind === 'code_block' &&
					chunk.metadata?.sectionTitle === 'runRelease'
			)
		).toBe(true);
	});

	it('keeps earlier source-aware section chunk ids stable when a later section changes', () => {
		const base = prepareRAGDocument({
			chunking: {
				maxChunkLength: 140,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			source: 'guides/stability.md',
			text: [
				'# Release Ops',
				'',
				'## Stable Lane',
				'',
				'Paragraph one keeps the stable lane summary explicit for citations and review.',
				'',
				'Paragraph two explains the approval gate and should become its own stable chunk boundary.',
				'',
				'## Canary Lane',
				'',
				'Canary paragraph one.'
			].join('\n')
		});
		const changedLater = prepareRAGDocument({
			chunking: {
				maxChunkLength: 140,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			source: 'guides/stability.md',
			text: [
				'# Release Ops',
				'',
				'## Stable Lane',
				'',
				'Paragraph one keeps the stable lane summary explicit for citations and review.',
				'',
				'Paragraph two explains the approval gate and should become its own stable chunk boundary.',
				'',
				'## Canary Lane',
				'',
				'Canary paragraph one.',
				'',
				'Canary paragraph two expands only the later section.'
			].join('\n')
		});

		const baseStable = base.chunks.filter(
			(chunk) =>
				chunk.metadata?.sectionChunkId ===
				'guides-stability-md:section:release-ops-stable-lane'
		);
		const changedStable = changedLater.chunks.filter(
			(chunk) =>
				chunk.metadata?.sectionChunkId ===
				'guides-stability-md:section:release-ops-stable-lane'
		);

		expect(changedStable.map((chunk) => chunk.chunkId)).toEqual(
			baseStable.map((chunk) => chunk.chunkId)
		);
		expect(changedStable.map((chunk) => chunk.text)).toEqual(
			baseStable.map((chunk) => chunk.text)
		);
	});

	it('applies source-aware heading sections to docx documents', async () => {
		const docx = createStoredZip(readFixtureTree('office/docx'));
		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			contentType:
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			encoding: 'base64',
			name: 'structured.docx'
		});
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 120,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});

		const stableLane = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.sectionKind === 'office_heading' &&
				chunk.metadata?.sectionTitle === 'Stable Lane'
		);
		const approvalPath = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.sectionKind === 'office_heading' &&
				chunk.metadata?.sectionTitle === 'Approval Path'
		);

		expect(stableLane?.title).toBe('structured-docx · Stable Lane');
		expect(stableLane?.text).toContain('Stable Lane');
		expect(stableLane?.text).toContain('AbsoluteJS fixture docx text');
		expect(stableLane?.metadata).toMatchObject({
			sectionChunkCount: 1,
			sectionChunkIndex: 0,
			sectionDepth: 1,
			sectionKind: 'office_heading',
			sectionPath: ['Stable Lane'],
			sectionTitle: 'Stable Lane'
		});
		expect(approvalPath?.text).toContain('Stable handoff notes');
	});

	it('uses native office blocks for source-aware docx chunk structure', async () => {
		const docx = createStoredZip({
			'word/document.xml':
				'<w:document><w:body>' +
				'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:t>Release Checklist</w:t></w:p>' +
				'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:t>Confirm stable gate</w:t></w:p>' +
				'<w:tbl>' +
				'<w:tr><w:tc><w:p><w:t>Metric</w:t></w:p></w:tc><w:tc><w:p><w:t>Status</w:t></w:p></w:tc></w:tr>' +
				'<w:tr><w:tc><w:p><w:t>Approval</w:t></w:p></w:tc><w:tc><w:p><w:t>Blocked</w:t></w:p></w:tc></w:tr>' +
				'</w:tbl>' +
				'</w:body></w:document>'
		});
		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			encoding: 'base64',
			name: 'structure.docx'
		});
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 120,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		expect(prepared.chunks).toHaveLength(3);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'heading',
			officeBlockNumber: 1,
			sectionKind: 'office_heading',
			sectionPath: ['Release Checklist'],
			sectionTitle: 'Release Checklist'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeBlockNumber: 2,
			sectionKind: 'office_block',
			sectionPath: ['Release Checklist'],
			sectionTitle: 'Release Checklist'
		});
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeBlockNumber: 3,
			officeTableBodyRowCount: 1,
			officeTableColumnCount: 2,
			officeTableHeaderText: 'Metric | Status',
			officeTableHeaders: ['Metric', 'Status'],
			officeTableRowCount: 2,
			officeTableSignature: 'Metric | Status',
			sectionKind: 'office_block',
			sectionPath: ['Release Checklist'],
			sectionTitle: 'Release Checklist'
		});
		expect(prepared.chunks[2]?.text).toContain(
			'Row 1. A: Metric | B: Status'
		);
	});

	it('applies stable row-group chunking to spreadsheet sheet documents', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 80,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			metadata: {
				fileKind: 'office',
				sheetColumnEnd: 'B',
				sheetColumnStart: 'A',
				sheetName: 'Overview',
				sheetHeaders: ['Metric', 'Status'],
				sourceNativeKind: 'spreadsheet_sheet'
			},
			source: 'fixtures/context.xlsx#Overview',
			text: [
				'Sheet Overview',
				'Row 1. A: Metric | B: Status',
				'Row 2. Metric: Overview heading | Status: Ready',
				'Row 3. Metric: Escalation checklist | Status: Blocked',
				'Row 4. Metric: Approval gates | Status: Watch'
			].join('\n'),
			title: 'Overview'
		});

		expect(prepared.chunks.length).toBeGreaterThan(1);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Overview', 'Spreadsheet Table'],
			spreadsheetColumnEnd: 'B',
			spreadsheetColumnStart: 'A',
			spreadsheetHeaders: ['Metric', 'Status'],
			sectionOrdinalPath: [1, 1],
			spreadsheetRowEnd: 2,
			spreadsheetRowStart: 1,
			sectionSiblingFamilyKey: 'Spreadsheet Table',
			sectionSiblingOrdinal: 1,
			sectionKind: 'spreadsheet_rows',
			sectionPath: ['Overview'],
			sectionTitle: 'Overview'
		});
		expect(prepared.chunks[0]?.text).toContain('Sheet Overview');
		expect(prepared.chunks[0]?.text).toContain('Row 1.');
		expect(prepared.chunks[0]?.text).toContain('Row 2.');
		expect(prepared.chunks[1]?.text).toContain('Sheet Overview');
		expect(prepared.chunks[1]?.text).toContain('Row 3.');
		expect(prepared.chunks[1]?.text).toContain('Row 4.');
		expect(prepared.chunks[1]?.text).not.toContain('Row 2.');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			sectionFamilyPath: ['Overview', 'Spreadsheet Table'],
			spreadsheetColumnEnd: 'B',
			spreadsheetColumnStart: 'A',
			spreadsheetHeaders: ['Metric', 'Status'],
			sectionOrdinalPath: [1, 1],
			spreadsheetRowEnd: 4,
			spreadsheetRowStart: 3,
			sectionSiblingFamilyKey: 'Spreadsheet Table',
			sectionSiblingOrdinal: 1
		});
	});

	it('splits spreadsheet chunks at repeated header table boundaries', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 200,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			metadata: {
				fileKind: 'office',
				repeatedHeaderRowNumbers: [3],
				sheetColumnEnd: 'D',
				sheetColumnStart: 'A',
				sheetHeaders: ['Metric', 'Status'],
				sheetName: 'Overview',
				sheetTableHeaders: [
					{
						spreadsheetHeaders: ['Metric', 'Status'],
						tableIndex: 1
					},
					{
						spreadsheetHeaders: ['Owner', 'Due date'],
						tableIndex: 2
					}
				],
				sheetTableColumnRanges: [
					{
						spreadsheetColumnEnd: 'B',
						spreadsheetColumnStart: 'A',
						tableIndex: 1
					},
					{
						spreadsheetColumnEnd: 'D',
						spreadsheetColumnStart: 'C',
						tableIndex: 2
					}
				],
				sheetTableCount: 2,
				sourceNativeKind: 'spreadsheet_sheet'
			},
			source: 'fixtures/context.xlsx#Overview',
			text: [
				'Sheet Overview',
				'Row 1. A: Metric | B: Status',
				'Row 2. Metric: Approval | Status: Blocked',
				'Row 3. C: Owner | D: Due date',
				'Row 4. Owner: Escalation | Due date: Ready'
			].join('\n'),
			title: 'Overview'
		});

		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.text).toContain('Row 1.');
		expect(prepared.chunks[0]?.text).toContain('Row 2.');
		expect(prepared.chunks[0]?.text).not.toContain('Row 3.');
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			spreadsheetColumnStart: 'A',
			spreadsheetColumnEnd: 'B',
			spreadsheetHeaders: ['Metric', 'Status'],
			spreadsheetRowEnd: 2,
			spreadsheetRowStart: 1,
			spreadsheetTableCount: 2,
			spreadsheetTableIndex: 1
		});
		expect(prepared.chunks[1]?.text).toContain('Row 3.');
		expect(prepared.chunks[1]?.text).toContain('Row 4.');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			spreadsheetColumnEnd: 'D',
			spreadsheetColumnStart: 'C',
			spreadsheetHeaders: ['Owner', 'Due date'],
			spreadsheetRowEnd: 4,
			spreadsheetRowStart: 3,
			spreadsheetTableCount: 2,
			spreadsheetTableIndex: 2
		});
	});

	it('splits spreadsheet chunks at blank-row-separated header restarts', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 200,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			metadata: {
				fileKind: 'office',
				repeatedHeaderRowNumbers: [4],
				sheetColumnEnd: 'B',
				sheetColumnStart: 'A',
				sheetHeaders: ['Metric', 'Status'],
				sheetName: 'Overview',
				sheetTableHeaders: [
					{
						spreadsheetHeaders: ['Metric', 'Status'],
						tableIndex: 1
					},
					{
						spreadsheetHeaders: ['Owner', 'Due date'],
						tableIndex: 2
					}
				],
				sheetTableColumnRanges: [
					{
						spreadsheetColumnEnd: 'B',
						spreadsheetColumnStart: 'A',
						tableIndex: 1
					},
					{
						spreadsheetColumnEnd: 'B',
						spreadsheetColumnStart: 'A',
						tableIndex: 2
					}
				],
				sheetTableCount: 2,
				sourceNativeKind: 'spreadsheet_sheet'
			},
			source: 'fixtures/context.xlsx#Overview',
			text: [
				'Sheet Overview',
				'Row 1. A: Metric | B: Status',
				'Row 2. Metric: Approval | Status: Blocked',
				'Row 4. A: Owner | B: Due date',
				'Row 5. Owner: Escalation | Due date: Ready'
			].join('\n'),
			title: 'Overview'
		});

		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.text).toContain('Row 1.');
		expect(prepared.chunks[0]?.text).toContain('Row 2.');
		expect(prepared.chunks[0]?.text).not.toContain('Row 4.');
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			spreadsheetColumnEnd: 'B',
			spreadsheetColumnStart: 'A',
			spreadsheetHeaders: ['Metric', 'Status'],
			spreadsheetRowEnd: 2,
			spreadsheetRowStart: 1,
			spreadsheetTableCount: 2,
			spreadsheetTableIndex: 1
		});
		expect(prepared.chunks[1]?.text).toContain('Row 4.');
		expect(prepared.chunks[1]?.text).toContain('Row 5.');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			spreadsheetColumnEnd: 'B',
			spreadsheetColumnStart: 'A',
			spreadsheetHeaders: ['Owner', 'Due date'],
			spreadsheetRowEnd: 5,
			spreadsheetRowStart: 4,
			spreadsheetTableCount: 2,
			spreadsheetTableIndex: 2
		});
	});

	it('splits spreadsheet chunks at blank-gap shifted table restarts without header-like text', () => {
		const prepared = prepareRAGDocument({
			chunking: {
				maxChunkLength: 200,
				minChunkLength: 20,
				strategy: 'source_aware'
			},
			metadata: {
				fileKind: 'office',
				repeatedHeaderRowNumbers: [4],
				sheetColumnEnd: 'D',
				sheetColumnStart: 'A',
				sheetHeaders: ['Metric', 'Status'],
				sheetName: 'Overview',
				sheetTableHeaders: [
					{
						spreadsheetHeaders: ['Metric', 'Status'],
						tableIndex: 1
					},
					{
						spreadsheetHeaders: ['Q1', 'Q2'],
						tableIndex: 2
					}
				],
				sheetTableColumnRanges: [
					{
						spreadsheetColumnEnd: 'B',
						spreadsheetColumnStart: 'A',
						tableIndex: 1
					},
					{
						spreadsheetColumnEnd: 'D',
						spreadsheetColumnStart: 'C',
						tableIndex: 2
					}
				],
				sheetTableCount: 2,
				sourceNativeKind: 'spreadsheet_sheet'
			},
			source: 'fixtures/context.xlsx#Overview',
			text: [
				'Sheet Overview',
				'Row 1. A: Metric | B: Status',
				'Row 2. Metric: Approval | Status: Blocked',
				'Row 4. C: Q1 | D: Q2',
				'Row 5. Q1: 12 | Q2: 15'
			].join('\n'),
			title: 'Overview'
		});

		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			spreadsheetColumnEnd: 'B',
			spreadsheetColumnStart: 'A',
			spreadsheetHeaders: ['Metric', 'Status'],
			spreadsheetRowEnd: 2,
			spreadsheetRowStart: 1,
			spreadsheetTableCount: 2,
			spreadsheetTableIndex: 1
		});
		expect(prepared.chunks[1]?.text).toContain('Row 4.');
		expect(prepared.chunks[1]?.text).toContain('Row 5.');
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			spreadsheetColumnEnd: 'D',
			spreadsheetColumnStart: 'C',
			spreadsheetHeaders: ['Q1', 'Q2'],
			spreadsheetRowEnd: 5,
			spreadsheetRowStart: 4,
			spreadsheetTableCount: 2,
			spreadsheetTableIndex: 2
		});
	});

	it('applies slide-scoped source-aware chunking to presentation slide documents', async () => {
		const pptx = createStoredZip(readFixtureTree('office/pptx'));
		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: pptx.toString('base64'),
					contentType:
						'application/vnd.openxmlformats-officedocument.presentationml.presentation',
					encoding: 'base64',
					name: 'notes-deck.pptx'
				}
			]
		});
		const slideOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'presentation_slide'
		);
		expect(slideOne).toBeDefined();

		const prepared = prepareRAGDocument({
			...slideOne!,
			chunking: {
				maxChunkLength: 120,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});

		expect(slideOne?.metadata).toMatchObject({
			slideNotesText:
				'Review stable blockers before the rollout meeting.',
			slideNumber: 1,
			slideTitle: 'Release handoff summary',
			sourceNativeKind: 'presentation_slide'
		});
		expect(prepared.chunks[0]?.title).toContain('Release handoff summary');
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Release handoff summary'],
			sectionKind: 'presentation_slide',
			sectionOrdinalPath: [1],
			sectionPath: ['Release handoff summary'],
			sectionSiblingFamilyKey: 'Release handoff summary',
			sectionSiblingOrdinal: 1,
			sectionTitle: 'Release handoff summary'
		});
		expect(prepared.chunks[0]?.title).toBe(
			'Slide 1 · Release handoff summary'
		);
		expect(prepared.chunks[0]?.text).toContain('Release handoff summary');
		expect(
			prepared.chunks.some((chunk) =>
				chunk.text.includes('Speaker notes:')
			)
		).toBe(true);
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

	it('suppresses link-dominated sidebar blocks from native PDF extraction', async () => {
		const pdfBytes = Buffer.from(
			[
				'%PDF-1.4',
				'1 0 obj',
				'<<>>',
				'stream',
				'BT',
				'(Related links) Tj',
				'T*',
				'(/docs/release-gates) Tj',
				'T*',
				'(/docs/approval-lanes) Tj',
				'ET',
				'endstream',
				'endobj',
				'2 0 obj',
				'<<>>',
				'stream',
				'BT',
				'(Release Summary) Tj',
				'T*',
				'(Stable rollout remains blocked until approval is recorded.) Tj',
				'ET',
				'endstream',
				'endobj',
				'/Type /Page',
				'%%EOF'
			].join('\n'),
			'latin1'
		).toString('base64');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: pdfBytes,
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'sidebar-links.pdf'
				}
			]
		});

		expect(loaded.documents).toHaveLength(1);
		expect(loaded.documents[0]?.text).toBe(
			[
				'Release Summary',
				'Stable rollout remains blocked until approval is recorded.'
			].join('\n')
		);
		expect(loaded.documents[0]?.text).not.toContain('/docs/release-gates');
		expect(loaded.documents[0]?.metadata?.pdfTextBlockCount).toBe(1);
		expect(loaded.documents[0]?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Release Summary',
					'Stable rollout remains blocked until approval is recorded.'
				].join('\n'),
				textKind: 'paragraph'
			}
		]);
	});

	it('suppresses promo-style sidebar blocks without harming nearby content blocks', async () => {
		const pdfBytes = Buffer.from(
			[
				'%PDF-1.4',
				'1 0 obj',
				'<<>>',
				'stream',
				'BT',
				'(Start free trial) Tj',
				'T*',
				'(Book demo with enterprise support) Tj',
				'T*',
				'(Learn more at /pricing) Tj',
				'ET',
				'endstream',
				'endobj',
				'2 0 obj',
				'<<>>',
				'stream',
				'BT',
				'(Release Summary) Tj',
				'T*',
				'(Stable rollout remains blocked until approval is recorded.) Tj',
				'ET',
				'endstream',
				'endobj',
				'/Type /Page',
				'%%EOF'
			].join('\n'),
			'latin1'
		).toString('base64');

		const loaded = await loadRAGDocumentUpload({
			content: pdfBytes,
			contentType: 'application/pdf',
			encoding: 'base64',
			name: 'sidebar-promo.pdf'
		});

		expect(loaded.text).toBe(
			[
				'Release Summary',
				'Stable rollout remains blocked until approval is recorded.'
			].join('\n')
		);
		expect(loaded.text).not.toContain('Start free trial');
		expect(loaded.metadata?.pdfTextBlockCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Release Summary',
					'Stable rollout remains blocked until approval is recorded.'
				].join('\n'),
				textKind: 'paragraph'
			}
		]);
	});

	it('preserves figure caption-body association across multiple figures on the same page', async () => {
		const pdfBytes = Buffer.from(
			[
				'%PDF-1.4',
				'1 0 obj',
				'<<>>',
				'stream',
				'BT',
				'(Figure 1) Tj',
				'T*',
				'(Approval gate by stable lane.) Tj',
				'T*',
				'(Stable rollout remains blocked until approval is recorded.) Tj',
				'T*',
				'(Figure 2) Tj',
				'T*',
				'(Remediation ownership by environment.) Tj',
				'T*',
				'(Canary remediation stays local until the stable gate clears.) Tj',
				'ET',
				'endstream',
				'endobj',
				'/Type /Page',
				'%%EOF'
			].join('\n'),
			'latin1'
		).toString('base64');

		const loaded = await loadRAGDocumentUpload({
			content: pdfBytes,
			contentType: 'application/pdf',
			encoding: 'base64',
			name: 'multi-figure.pdf'
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 200,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.metadata?.pdfTextBlockCount).toBe(4);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				semanticRole: 'figure_caption',
				text: ['Figure 1', 'Approval gate by stable lane.'].join('\n')
			},
			{
				blockNumber: 2,
				semanticRole: 'figure_body',
				text: 'Stable rollout remains blocked until approval is recorded.'
			},
			{
				blockNumber: 3,
				semanticRole: 'figure_caption',
				text: [
					'Figure 2',
					'Remediation ownership by environment.'
				].join('\n')
			},
			{
				blockNumber: 4,
				semanticRole: 'figure_body',
				text: 'Canary remediation stays local until the stable gate clears.'
			}
		]);
		expect(prepared.chunks).toHaveLength(4);
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pdfBlockNumber: 2,
			pdfFigureCaptionBlockNumber: 1,
			pdfFigureLabel: 'Figure 1',
			pdfSemanticRole: 'figure_body',
			sectionTitle: 'Figure 1 Body'
		});
		expect(prepared.chunks[3]?.metadata).toMatchObject({
			pdfBlockNumber: 4,
			pdfFigureCaptionBlockNumber: 3,
			pdfFigureLabel: 'Figure 2',
			pdfSemanticRole: 'figure_body',
			sectionTitle: 'Figure 2 Body'
		});
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
				segments: [
					{
						endMs: 1000,
						speaker: 'Alex',
						startMs: 0,
						text: 'scene one'
					},
					{
						endMs: 2400,
						speaker: 'Sam',
						startMs: 1000,
						text: 'scene two'
					}
				],
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
		expect(loaded.metadata?.mediaDurationMs).toBe(2400);
		expect(loaded.metadata?.mediaSegmentCount).toBe(2);
		expect(loaded.metadata?.mediaSpeakerCount).toBe(2);
		expect(loaded.metadata?.mediaSpeakers).toEqual(['Alex', 'Sam']);
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

		expect(loaded.documents).toHaveLength(2);
		const segmentDocument = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentIndex === 0
		);
		expect(segmentDocument?.title).toContain('segment 1');
		expect(segmentDocument?.text).toContain('timestamp');
		expect(segmentDocument?.metadata).toMatchObject({
			mediaDurationMs: 1800,
			mediaSegmentCount: 2,
			mediaSegmentGroupSize: 2,
			sourceNativeKind: 'media_segment'
		});
	});

	it('groups consecutive transcript segments by speaker and channel', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 600,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead topic one.'
					},
					{
						channel: 'left',
						endMs: 1200,
						speaker: 'Alex',
						startMs: 600,
						text: 'Follow-up from Alex.'
					},
					{
						channel: 'left',
						endMs: 1700,
						speaker: 'Sam',
						startMs: 1200,
						text: 'Sam responds with context.'
					},
					{
						channel: 'left',
						endMs: 2200,
						speaker: '',
						startMs: 1700,
						text: ''
					},
					{
						channel: 'right',
						endMs: 2600,
						speaker: 'Sam',
						startMs: 2200,
						text: 'Final right-channel answer.'
					}
				],
				text: 'Lead topic one. Follow-up from Alex. Sam responds with context. Final right-channel answer.'
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

		const summary = loaded.documents.find(
			(document) =>
				document.metadata?.fileKind === 'media' &&
				document.metadata?.mediaSegmentIndex === undefined
		);
		expect(summary?.metadata?.mediaSegmentCount).toBe(4);
		expect(summary?.metadata?.mediaSegments).toHaveLength(4);

		const firstGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const secondGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);
		const thirdGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 2
		);

		expect(firstGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 2,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left',
			mediaSegmentCount: 4,
			mediaSegments: [
				expect.objectContaining({ speaker: 'Alex', channel: 'left' }),
				expect.objectContaining({ speaker: 'Alex', channel: 'left' })
			]
		});
		expect(secondGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 1,
			mediaSegmentGroupSpeaker: 'Sam',
			mediaChannel: 'left',
			mediaSegments: [
				expect.objectContaining({ speaker: 'Sam', channel: 'left' })
			]
		});
		expect(thirdGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 1,
			mediaChannel: 'right',
			mediaSegmentGroupSpeaker: 'Sam'
		});
		expect(loaded.documents).toHaveLength(4);
	});

	it('normalizes media channel aliases to canonical side labels', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: ' L ',
						endMs: 450,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead with an alias.'
					},
					{
						channel: 'rIGht',
						endMs: 900,
						speaker: 'Alex',
						startMs: 450,
						text: 'A right-side interjection.'
					},
					{
						channel: 'right',
						endMs: 1450,
						speaker: 'Alex',
						startMs: 900,
						text: 'Continued on the right.'
					}
				],
				text: 'Lead with an alias. A right-side interjection. Continued on the right.'
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

		const aliasGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const rightGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);

		expect(aliasGroup?.metadata).toMatchObject({
			mediaChannel: 'left'
		});
		expect(
			(aliasGroup?.metadata?.mediaSegments as any[] | undefined)?.[0]
		).toMatchObject({
			channel: 'left'
		});
		expect(rightGroup?.metadata).toMatchObject({
			mediaChannel: 'right'
		});
		expect(
			(rightGroup?.metadata?.mediaSegments as any[] | undefined)?.[0]
		).toMatchObject({
			channel: 'right'
		});
		expect(
			(rightGroup?.metadata?.mediaSegments as any[] | undefined)?.[1]
		).toMatchObject({
			channel: 'right'
		});
		expect(loaded.documents).toHaveLength(3);
	});

	it('normalizes center-channel aliases to mono', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'center',
						endMs: 450,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead with center alias.'
					},
					{
						channel: ' Centre ',
						endMs: 900,
						speaker: 'Alex',
						startMs: 450,
						text: 'Follow-up with British spelling.'
					},
					{
						channel: 'middle',
						endMs: 1450,
						speaker: 'Alex',
						startMs: 900,
						text: 'Final follow-up with middle alias.'
					}
				],
				text: 'Lead with center alias. Follow-up with British spelling. Final follow-up with middle alias.'
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

		const monoGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(loaded.documents).toHaveLength(2);
		expect(monoGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 3,
			mediaChannel: 'mono',
			mediaSegmentGroupSpeaker: 'Alex'
		});
		expect(monoGroup?.metadata?.mediaSegments).toEqual([
			expect.objectContaining({ channel: 'mono', speaker: 'Alex' }),
			expect.objectContaining({ channel: 'mono', speaker: 'Alex' }),
			expect.objectContaining({ channel: 'mono', speaker: 'Alex' })
		]);
	});

	it('groups speaker aliases with casing and whitespace differences into one media group', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 450,
						speaker: ' Alex ',
						startMs: 0,
						text: 'Lead with normalized speaker formatting.'
					},
					{
						channel: 'left',
						endMs: 900,
						speaker: 'alex',
						startMs: 450,
						text: 'Follow-up with lowercase speaker alias.'
					},
					{
						channel: 'left',
						endMs: 1450,
						speaker: 'ALEX',
						startMs: 900,
						text: 'Final follow-up with uppercase alias.'
					}
				],
				text: 'Lead with normalized speaker formatting. Follow-up with lowercase speaker alias. Final follow-up with uppercase alias.'
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

		const onlyGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(loaded.documents).toHaveLength(2);
		expect(onlyGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 3,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left'
		});
		expect(onlyGroup?.metadata?.mediaSegments).toEqual([
			expect.objectContaining({ speaker: 'Alex', channel: 'left' }),
			expect.objectContaining({ speaker: 'alex', channel: 'left' }),
			expect.objectContaining({ speaker: 'ALEX', channel: 'left' })
		]);
	});

	it('groups speaker aliases with punctuation and separator differences into one media group', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'mono',
						endMs: 450,
						speaker: 'Alex-K.',
						startMs: 0,
						text: 'Lead with punctuation in the speaker name.'
					},
					{
						channel: 'mono',
						endMs: 900,
						speaker: 'alex k',
						startMs: 450,
						text: 'Follow-up with spaces instead of punctuation.'
					},
					{
						channel: 'mono',
						endMs: 1450,
						speaker: 'ALEX_K',
						startMs: 900,
						text: 'Final follow-up with underscore separator.'
					}
				],
				text: 'Lead with punctuation in the speaker name. Follow-up with spaces instead of punctuation. Final follow-up with underscore separator.'
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

		const onlyGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(loaded.documents).toHaveLength(2);
		expect(onlyGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 3,
			mediaSegmentGroupSpeaker: 'Alex-K.',
			mediaChannel: 'mono'
		});
		expect(onlyGroup?.metadata?.mediaSegments).toEqual([
			expect.objectContaining({ speaker: 'Alex-K.', channel: 'mono' }),
			expect.objectContaining({ speaker: 'alex k', channel: 'mono' }),
			expect.objectContaining({ speaker: 'ALEX_K', channel: 'mono' })
		]);
	});

	it('bridges a single unknown-speaker segment when surrounding segments clearly match the same speaker and channel', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 450,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead from Alex.'
					},
					{
						channel: 'left',
						endMs: 900,
						speaker: '',
						startMs: 450,
						text: 'Brief diarization miss in the middle.'
					},
					{
						channel: 'left',
						endMs: 1450,
						speaker: 'alex',
						startMs: 900,
						text: 'Alex resumes immediately after.'
					}
				],
				text: 'Lead from Alex. Brief diarization miss in the middle. Alex resumes immediately after.'
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

		const onlyGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(loaded.documents).toHaveLength(2);
		expect(onlyGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 3,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left'
		});
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[0]
		).toMatchObject({ speaker: 'Alex', channel: 'left' });
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[1]
		).toMatchObject({ speaker: undefined, channel: 'left' });
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[2]
		).toMatchObject({ speaker: 'alex', channel: 'left' });
	});

	it('bridges a single unknown-channel segment when surrounding segments clearly match the same speaker and channel', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 450,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead from Alex on the left channel.'
					},
					{
						channel: '',
						endMs: 900,
						speaker: 'alex',
						startMs: 450,
						text: 'Brief channel-label miss in the middle.'
					},
					{
						channel: ' L ',
						endMs: 1450,
						speaker: 'Alex',
						startMs: 900,
						text: 'Alex resumes with the same channel alias.'
					}
				],
				text: 'Lead from Alex on the left channel. Brief channel-label miss in the middle. Alex resumes with the same channel alias.'
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

		const onlyGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(loaded.documents).toHaveLength(2);
		expect(onlyGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 3,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left'
		});
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[0]
		).toMatchObject({ speaker: 'Alex', channel: 'left' });
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[1]
		).toMatchObject({ speaker: 'alex', channel: '' });
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[2]
		).toMatchObject({ speaker: 'Alex', channel: 'left' });
	});

	it('bridges short runs of unknown speaker and channel labels when surrounding segments clearly match', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 450,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead from Alex.'
					},
					{
						channel: '',
						endMs: 900,
						speaker: '',
						startMs: 450,
						text: 'First unlabeled middle segment.'
					},
					{
						channel: '',
						endMs: 1300,
						speaker: '',
						startMs: 900,
						text: 'Second unlabeled middle segment.'
					},
					{
						channel: ' L ',
						endMs: 1800,
						speaker: 'alex',
						startMs: 1300,
						text: 'Alex resumes with matching speaker and channel.'
					}
				],
				text: 'Lead from Alex. First unlabeled middle segment. Second unlabeled middle segment. Alex resumes with matching speaker and channel.'
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

		const onlyGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(loaded.documents).toHaveLength(2);
		expect(onlyGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 4,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left'
		});
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[1]
		).toMatchObject({ speaker: undefined, channel: '' });
		expect(
			(onlyGroup?.metadata?.mediaSegments as any[] | undefined)?.[2]
		).toMatchObject({ speaker: undefined, channel: '' });
	});

	it('does not bridge long runs of unknown speaker and channel labels', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 450,
						speaker: 'Alex',
						startMs: 0,
						text: 'Lead from Alex.'
					},
					{
						channel: '',
						endMs: 900,
						speaker: '',
						startMs: 450,
						text: 'First unlabeled middle segment.'
					},
					{
						channel: '',
						endMs: 1300,
						speaker: '',
						startMs: 900,
						text: 'Second unlabeled middle segment.'
					},
					{
						channel: '',
						endMs: 1700,
						speaker: '',
						startMs: 1300,
						text: 'Third unlabeled middle segment.'
					},
					{
						channel: '',
						endMs: 2100,
						speaker: '',
						startMs: 1700,
						text: 'Fourth unlabeled middle segment.'
					},
					{
						channel: 'left',
						endMs: 2600,
						speaker: 'alex',
						startMs: 2100,
						text: 'Alex resumes after a long unlabeled stretch.'
					}
				],
				text: 'Lead from Alex. First unlabeled middle segment. Second unlabeled middle segment. Third unlabeled middle segment. Fourth unlabeled middle segment. Alex resumes after a long unlabeled stretch.'
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

		const mediaGroups = loaded.documents.filter(
			(document) =>
				document.metadata?.mediaSegmentGroupIndex !== undefined
		);

		expect(loaded.documents).toHaveLength(4);
		expect(mediaGroups).toHaveLength(3);
		expect(mediaGroups[0]?.metadata).toMatchObject({
			mediaSegmentGroupSize: 1,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left'
		});
		expect(mediaGroups[1]?.metadata).toMatchObject({
			mediaSegmentGroupSize: 4,
			mediaSegmentGroupSpeaker: undefined,
			mediaChannel: ''
		});
		expect(mediaGroups[2]?.metadata).toMatchObject({
			mediaSegmentGroupSize: 1,
			mediaSegmentGroupSpeaker: 'alex',
			mediaChannel: 'left'
		});
	});

	it('uses transcript segment windows based on min start and max end, including gaps', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 1200,
						speaker: 'Alex',
						startMs: 1000,
						text: 'Second segment for Alex.'
					},
					{
						channel: 'left',
						endMs: 3000,
						speaker: 'Alex',
						startMs: 500,
						text: 'First segment for Alex, arriving late.'
					},
					{
						channel: 'right',
						endMs: 3400,
						speaker: 'Sam',
						startMs: 3000,
						text: 'A right-side follow-up.'
					}
				],
				text: 'Second segment for Alex. First segment for Alex, arriving late. A right-side follow-up.'
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

		const firstGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const secondGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);

		expect(firstGroup?.metadata).toMatchObject({
			mediaSegmentGroupStartMs: 500,
			mediaSegmentGroupEndMs: 3000,
			mediaSegmentGroupDurationMs: 2500,
			mediaSegmentGapToNextMs: 0
		});
		expect(secondGroup?.metadata).toMatchObject({
			mediaSegmentGroupStartMs: 3000,
			mediaSegmentGapFromPreviousMs: 0,
			mediaSegmentGapToNextMs: undefined
		});
	});

	it('sorts out-of-order media segments before grouping and summary metadata', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 2400,
						speaker: 'Alex',
						startMs: 1800,
						text: 'Third timeline segment.'
					},
					{
						channel: 'left',
						endMs: 600,
						speaker: 'Alex',
						startMs: 0,
						text: 'First timeline segment.'
					},
					{
						channel: 'left',
						endMs: 1200,
						speaker: 'Alex',
						startMs: 600,
						text: 'Second timeline segment.'
					},
					{
						channel: 'right',
						endMs: undefined,
						speaker: 'Sam',
						startMs: undefined,
						text: 'Untimed follow-up.'
					}
				],
				text: 'Third timeline segment. First timeline segment. Second timeline segment. Untimed follow-up.'
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

		const summary = loaded.documents.find(
			(document) =>
				document.metadata?.fileKind === 'media' &&
				document.metadata?.mediaSegmentIndex === undefined
		);
		const firstGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const secondGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);

		expect(
			(
				summary?.metadata?.mediaSegments as
					| Array<{ text?: string }>
					| undefined
			)?.map((segment) => segment.text)
		).toEqual([
			'First timeline segment.',
			'Second timeline segment.',
			'Third timeline segment.',
			'Untimed follow-up.'
		]);
		expect(firstGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 3,
			mediaSegmentGroupStartMs: 0,
			mediaSegmentGroupEndMs: 2400
		});
		expect(firstGroup?.text).toContain(
			'First timeline segment. Second timeline segment. Third timeline segment.'
		);
		expect(secondGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 1,
			mediaSegmentGroupStartMs: undefined,
			mediaSegmentGroupEndMs: undefined,
			mediaSegmentGapFromPreviousMs: undefined
		});
	});

	it('splits same-speaker media groups when a large timed gap breaks continuity', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 1000,
						speaker: 'Alex',
						startMs: 0,
						text: 'Opening timeline note.'
					},
					{
						channel: 'left',
						endMs: 1800,
						speaker: 'Alex',
						startMs: 1000,
						text: 'Still in the first continuous window.'
					},
					{
						channel: 'left',
						endMs: 10_200,
						speaker: 'Alex',
						startMs: 9800,
						text: 'Alex resumes much later.'
					}
				],
				text: 'Opening timeline note. Still in the first continuous window. Alex resumes much later.'
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

		const firstGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const secondGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);

		expect(firstGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 2,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left',
			mediaSegmentGroupStartMs: 0,
			mediaSegmentGroupEndMs: 1800,
			mediaSegmentGapToNextMs: 8000
		});
		expect(secondGroup?.metadata).toMatchObject({
			mediaSegmentGroupSize: 1,
			mediaSegmentGroupSpeaker: 'Alex',
			mediaChannel: 'left',
			mediaSegmentGroupStartMs: 9800,
			mediaSegmentGroupEndMs: 10_200,
			mediaSegmentGapFromPreviousMs: 8000,
			mediaSegmentGapToNextMs: undefined
		});
		expect(loaded.documents).toHaveLength(3);
	});

	it('normalizes malformed media segment windows before persisting chunk metadata', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'mono',
						endMs: 1000,
						speaker: 'Alex',
						startMs: 2000,
						text: 'Malformed segment with inverted timing.'
					},
					{
						channel: 'mono',
						endMs: 1400,
						speaker: 'Alex',
						startMs: 1500,
						text: 'Another malformed segment with inverted timing.'
					}
				],
				text: 'Malformed segment with inverted timing. Another malformed segment with inverted timing.'
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

		const malformedGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);

		expect(malformedGroup?.metadata).toMatchObject({
			mediaSegmentCount: 2,
			mediaSegmentGroupSize: 2,
			mediaSegmentGroupStartMs: undefined,
			mediaSegmentGroupEndMs: undefined,
			mediaSegmentGroupDurationMs: undefined,
			mediaSegmentGapFromPreviousMs: undefined,
			mediaSegmentStartMs: undefined,
			mediaSegmentEndMs: undefined
		});
		expect(malformedGroup?.metadata?.mediaSegments).toHaveLength(2);
		expect(
			(malformedGroup?.metadata?.mediaSegments as any[] | undefined)?.[0]
		).toMatchObject({
			startMs: undefined,
			endMs: undefined
		});
		expect(
			(malformedGroup?.metadata?.mediaSegments as any[] | undefined)?.[1]
		).toMatchObject({
			startMs: undefined,
			endMs: undefined
		});
	});

	it('normalizes non-finite and non-numeric media timestamps before persisting', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'mono',
						endMs: Number.NaN,
						speaker: 'Alex',
						startMs: Number.NaN,
						text: 'Non-finite timing in transcript segment.'
					},
					{
						channel: 'mono',
						endMs: Number.POSITIVE_INFINITY,
						speaker: 'Alex',
						startMs: 1500,
						text: 'Infinite ending timestamp in transcript segment.'
					},
					{
						channel: 'mono',
						// cast keeps this case aligned with real-world malformed transcriber payloads
						endMs: 2500,
						speaker: 'Alex',
						startMs: null as unknown as number,
						text: 'Null starting timestamp in transcript segment.'
					}
				],
				text: 'Non-finite timing in transcript segment. Infinite ending timestamp in transcript segment. Null starting timestamp in transcript segment.'
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

		const malformedGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const untimedMalformedGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);

		expect(malformedGroup?.metadata).toMatchObject({
			mediaSegmentCount: 3,
			mediaSegmentGroupSize: 1,
			mediaSegmentGroupStartMs: undefined,
			mediaSegmentGroupEndMs: undefined,
			mediaSegmentGroupDurationMs: undefined,
			mediaSegmentGapFromPreviousMs: undefined,
			mediaSegmentStartMs: undefined,
			mediaSegmentEndMs: undefined
		});
		expect(malformedGroup?.metadata?.mediaSegments).toHaveLength(1);
		expect(
			(malformedGroup?.metadata?.mediaSegments as any[] | undefined)?.[0]
		).toMatchObject({
			endMs: undefined
		});
		expect(untimedMalformedGroup?.metadata).toMatchObject({
			mediaSegmentCount: 3,
			mediaSegmentGroupSize: 2,
			startMs: 1500,
			endMs: 2500,
			mediaSegmentStartMs: 1500,
			mediaSegmentEndMs: 2500
		});
		expect(untimedMalformedGroup?.metadata?.mediaSegments).toHaveLength(2);
		expect(
			(
				untimedMalformedGroup?.metadata?.mediaSegments as
					| any[]
					| undefined
			)?.[0]
		).toMatchObject({
			startMs: 1500,
			endMs: undefined
		});
		expect(
			(
				untimedMalformedGroup?.metadata?.mediaSegments as
					| any[]
					| undefined
			)?.[1]
		).toMatchObject({
			startMs: undefined,
			endMs: 2500
		});
	});

	it('splits same-speaker media groups when transcript timing disappears or reappears', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'timing_mode_switch',
			transcribe: () => ({
				segments: [
					{
						channel: 'mono',
						endMs: 1200,
						speaker: 'Alex',
						startMs: 0,
						text: 'Timed opening segment.'
					},
					{
						channel: 'mono',
						speaker: 'Alex',
						text: 'Untimed follow-up transcript segment.'
					},
					{
						channel: 'mono',
						endMs: 2800,
						speaker: 'Alex',
						startMs: 1800,
						text: 'Timed transcript resumes.'
					}
				],
				text: 'Timed opening segment. Untimed follow-up transcript segment. Timed transcript resumes.'
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

		const groupedDocuments = loaded.documents.filter(
			(document) =>
				document.metadata?.mediaSegmentGroupIndex !== undefined
		);

		expect(groupedDocuments).toHaveLength(3);
		expect(groupedDocuments[0]?.metadata).toMatchObject({
			mediaSegmentCount: 3,
			mediaSegmentGroupIndex: 0,
			mediaSegmentGroupSize: 1,
			mediaSegmentStartMs: 0,
			mediaSegmentEndMs: 1200
		});
		expect(groupedDocuments[1]?.metadata).toMatchObject({
			mediaSegmentCount: 3,
			mediaSegmentGroupIndex: 1,
			mediaSegmentGroupSize: 1,
			mediaSegmentStartMs: undefined,
			mediaSegmentEndMs: undefined
		});
		expect(groupedDocuments[2]?.metadata).toMatchObject({
			mediaSegmentCount: 3,
			mediaSegmentGroupIndex: 2,
			mediaSegmentGroupSize: 1,
			mediaSegmentStartMs: 1800,
			mediaSegmentEndMs: 2800
		});
	});

	it('does not normalize overlapping media groups into a fake zero-gap continuity signal', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'segmented_media',
			transcribe: () => ({
				segments: [
					{
						channel: 'left',
						endMs: 1200,
						speaker: 'Alex',
						startMs: 0,
						text: 'Alex opens the timeline.'
					},
					{
						channel: 'right',
						endMs: 1800,
						speaker: 'Sam',
						startMs: 900,
						text: 'Sam overlaps before Alex finishes.'
					}
				],
				text: 'Alex opens the timeline. Sam overlaps before Alex finishes.'
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

		const firstGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 0
		);
		const overlappingGroup = loaded.documents.find(
			(document) => document.metadata?.mediaSegmentGroupIndex === 1
		);

		expect(firstGroup?.metadata).toMatchObject({
			mediaSegmentGroupStartMs: 0,
			mediaSegmentGroupEndMs: 1200
		});
		expect(overlappingGroup?.metadata).toMatchObject({
			mediaSegmentGroupStartMs: 900,
			mediaSegmentGroupEndMs: 1800,
			mediaSegmentGapFromPreviousMs: undefined
		});
	});

	it('supports first-party OCR extractor families for image files', async () => {
		const ocr = createRAGOCRProvider({
			name: 'mock_ocr',
			extractText: () => ({
				confidence: 0.96,
				metadata: { ocrEngine: 'mock' },
				regions: [
					{
						confidence: 0.98,
						height: 24,
						page: 1,
						text: 'Receipt total',
						width: 100,
						x: 10,
						y: 20
					},
					{
						confidence: 0.94,
						height: 24,
						page: 1,
						text: '$42.00',
						width: 60,
						x: 10,
						y: 48
					}
				],
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

		expect(loaded.text).toBe('Receipt total\n$42.00');
		expect(loaded.metadata?.fileKind).toBe('image');
		expect(loaded.metadata?.ocrConfidence).toBe(0.96);
		expect(loaded.metadata?.ocrPageCount).toBe(1);
		expect(loaded.metadata?.ocrPageStart).toBe(1);
		expect(loaded.metadata?.ocrPageEnd).toBe(1);
		expect(loaded.metadata?.ocrPageNumbers).toEqual([1]);
		expect(loaded.metadata?.ocrRegionCount).toBe(2);
		expect(loaded.metadata?.ocrAverageConfidence).toBeCloseTo(0.96, 5);
		expect(loaded.metadata?.ocrMinConfidence).toBeCloseTo(0.94, 5);
		expect(loaded.metadata?.ocrMaxConfidence).toBeCloseTo(0.98, 5);
		expect(loaded.metadata?.ocrEngine).toBe('mock');
		expect(loaded.metadata?.sourceNativeKind).toBe('image_ocr');
		expect(loaded.metadata?.ocrRegions).toMatchObject([
			{ page: 1, text: 'Receipt total', x: 10, y: 20 },
			{ page: 1, text: '$42.00', x: 10, y: 48 }
		]);
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
		expect(loaded.metadata?.archiveParentName).toBe('bundle.zip');
		expect(loaded.metadata?.archiveParentSource).toBe('bundle.zip');
	});

	it('supports built-in docx extraction', async () => {
		const docx = createStoredZip({
			'word/document.xml':
				'<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:t>Overview</w:t></w:p><w:p><w:t>AbsoluteJS docx text</w:t></w:p><w:p><w:t>Second paragraph</w:t></w:p></w:body></w:document>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			encoding: 'base64',
			name: 'spec.docx'
		});

		expect(loaded.text).toContain('Overview');
		expect(loaded.text).toContain('AbsoluteJS docx text');
		expect(loaded.metadata?.fileKind).toBe('office');
		expect(loaded.metadata?.extractor).toBe('absolute_office_document');
		expect(loaded.metadata?.sectionCount).toBe(3);
	});

	it('preserves docx list and table structure in built-in extraction', async () => {
		const docx = createStoredZip({
			'word/document.xml':
				'<w:document><w:body>' +
				'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:t>Release Checklist</w:t></w:p>' +
				'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:t>Confirm stable gate</w:t></w:p>' +
				'<w:tbl>' +
				'<w:tr><w:tc><w:p><w:t>Metric</w:t></w:p></w:tc><w:tc><w:p><w:t>Status</w:t></w:p></w:tc></w:tr>' +
				'<w:tr><w:tc><w:p><w:t>Approval</w:t></w:p></w:tc><w:tc><w:p><w:t>Blocked</w:t></w:p></w:tc></w:tr>' +
				'</w:tbl>' +
				'</w:body></w:document>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			encoding: 'base64',
			name: 'structure.docx'
		});

		expect(loaded.text).toContain('Release Checklist');
		expect(loaded.text).toContain('- Confirm stable gate');
		expect(loaded.text).toContain('Row 1. A: Metric | B: Status');
		expect(loaded.text).toContain('Row 2. A: Approval | B: Blocked');
		expect(loaded.metadata?.officeBlocks).toMatchObject([
			{
				blockKind: 'heading',
				blockNumber: 1,
				text: 'Release Checklist'
			},
			{
				blockKind: 'list',
				blockNumber: 2,
				text: '- Confirm stable gate'
			},
			{
				blockKind: 'table',
				blockNumber: 3,
				tableBodyRowCount: 1,
				tableColumnCount: 2,
				tableHeaderText: 'Metric | Status',
				tableHeaders: ['Metric', 'Status'],
				tableRowCount: 2,
				tableSignature: 'Metric | Status',
				text: [
					'Row 1. A: Metric | B: Status',
					'Row 2. A: Approval | B: Blocked'
				].join('\n')
			}
		]);
	});

	it('preserves nested docx list depth in built-in extraction and source-aware chunks', async () => {
		const docx = createStoredZip({
			'word/document.xml':
				'<w:document><w:body>' +
				'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:t>Rollout Plan</w:t></w:p>' +
				'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:t>Confirm release lane</w:t></w:p>' +
				'<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:t>Verify handoff evidence</w:t></w:p>' +
				'</w:body></w:document>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			encoding: 'base64',
			name: 'nested-list.docx'
		});
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 120,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		expect(loaded.text).toContain('- Confirm release lane');
		expect(loaded.text).toContain('- Verify handoff evidence');
		expect(loaded.metadata?.officeBlocks).toMatchObject([
			{
				blockKind: 'heading',
				blockNumber: 1,
				text: 'Rollout Plan'
			},
			{
				blockKind: 'list',
				blockNumber: 2,
				listLevel: 0,
				text: '- Confirm release lane'
			},
			{
				blockKind: 'list',
				blockNumber: 3,
				listLevel: 1,
				text: '  - Verify handoff evidence'
			}
		]);
		const listChunk = prepared.chunks.find(
			(chunk) => chunk.metadata?.officeBlockKind === 'list'
		);
		expect(listChunk?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeBlockNumber: 2,
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionKind: 'office_block',
			sectionPath: ['Rollout Plan'],
			sectionTitle: 'Rollout Plan'
		});
		expect(listChunk?.text).toContain('Confirm release lane');
		expect(listChunk?.text).toContain('Verify handoff evidence');
	});

	it('slices oversized docx tables with repeated headers and attached intro context', async () => {
		const docx = createStoredZip({
			'word/document.xml':
				'<w:document><w:body>' +
				'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:t>Release Checklist</w:t></w:p>' +
				'<w:p><w:t>Use this table to track lane readiness by environment.</w:t></w:p>' +
				'<w:tbl>' +
				'<w:tr><w:tc><w:p><w:t>Environment</w:t></w:p></w:tc><w:tc><w:p><w:t>Status</w:t></w:p></w:tc></w:tr>' +
				'<w:tr><w:tc><w:p><w:t>Alpha</w:t></w:p></w:tc><w:tc><w:p><w:t>Blocked</w:t></w:p></w:tc></w:tr>' +
				'<w:tr><w:tc><w:p><w:t>Beta</w:t></w:p></w:tc><w:tc><w:p><w:t>Ready</w:t></w:p></w:tc></w:tr>' +
				'<w:tr><w:tc><w:p><w:t>Gamma</w:t></w:p></w:tc><w:tc><w:p><w:t>Watch</w:t></w:p></w:tc></w:tr>' +
				'<w:tr><w:tc><w:p><w:t>Delta</w:t></w:p></w:tc><w:tc><w:p><w:t>Ready</w:t></w:p></w:tc></w:tr>' +
				'</w:tbl>' +
				'</w:body></w:document>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: docx.toString('base64'),
			encoding: 'base64',
			name: 'sliced-table.docx'
		});
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 100,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		const tableSlices = prepared.chunks.filter(
			(chunk) => chunk.metadata?.officeTableChunkKind === 'table_slice'
		);

		expect(tableSlices.length).toBeGreaterThan(1);
		expect(tableSlices[0]?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableBodyRowStart: 1,
			officeTableChunkKind: 'table_slice',
			officeTableColumnCount: 2,
			officeTableContextText:
				'Use this table to track lane readiness by environment.',
			officeTableHeaderText: 'Environment | Status',
			officeTableHeaders: ['Environment', 'Status'],
			officeTableSignature: 'Environment | Status',
			sectionPath: ['Release Checklist']
		});
		expect(tableSlices[0]?.text).toContain(
			'Use this table to track lane readiness by environment.'
		);
		expect(tableSlices[0]?.text).toContain('Environment | Status');
		expect(tableSlices[0]?.text).toContain('Row 2. A: Alpha | B: Blocked');
		expect(tableSlices[1]?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableChunkKind: 'table_slice'
		});
		expect(tableSlices[1]?.text).toContain('Environment | Status');
	});

	it('supports built-in xlsx extraction', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Alpha</t></si><si><t>Beta</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: xlsx.toString('base64'),
			encoding: 'base64',
			name: 'sheet.xlsx'
		});

		expect(loaded.text).toContain('Sheet Overview');
		expect(loaded.text).toContain('Row 1. A: Metric | B: Status');
		expect(loaded.text).toContain('Row 2. Metric: Alpha | Status: Beta');
		expect(loaded.metadata?.fileKind).toBe('office');
		expect(loaded.metadata?.sheetNames).toEqual(['Overview', 'Details']);
	});

	it('emits source-native spreadsheet sheet documents in batch upload ingest', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Regional growth</t></si><si><t>Ready</t></si><si><t>Escalation checklist</t></si><si><t>Blocked</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row></sheetData></worksheet>',
			'xl/worksheets/sheet2.xml':
				'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c></row></sheetData></worksheet>'
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
		expect(overviewDocument?.text).toContain(
			'Row 2. Metric: Regional growth | Status: Ready'
		);
		expect(overviewDocument?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [],
			sheetColumnEnd: 'C',
			sheetColumnStart: 'A',
			sheetHeaders: ['Metric', 'Status'],
			sheetName: 'Overview',
			sheetRowCount: 2,
			sheetTableCount: 1,
			sourceNativeKind: 'spreadsheet_sheet'
		});
	});

	it('detects repeated spreadsheet headers as multi-table boundaries', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si><si><t>Owner</t></si><si><t>Due date</t></si><si><t>Escalation</t></si><si><t>Ready</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
				'<row><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
				'<row><c r="C3" t="s"><v>4</v></c><c r="D3" t="s"><v>5</v></c></row>' +
				'<row><c r="C4" t="s"><v>6</v></c><c r="D4" t="s"><v>7</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 1. A: Metric | B: Status'
		);
		expect(overviewDocument?.text).toContain(
			'Row 3. C: Owner | D: Due date'
		);
		expect(overviewDocument?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [3],
			sheetColumnEnd: 'D',
			sheetColumnStart: 'A',
			sheetHeaders: ['Metric', 'Status'],
			sheetName: 'Overview',
			sheetRowCount: 4,
			sheetTableCount: 2,
			sourceNativeKind: 'spreadsheet_sheet'
		});
		expect(overviewDocument?.metadata?.sheetTableColumnRanges).toEqual([
			{
				spreadsheetColumnEnd: 'B',
				spreadsheetColumnStart: 'A',
				tableIndex: 1
			},
			{
				spreadsheetColumnEnd: 'D',
				spreadsheetColumnStart: 'C',
				tableIndex: 2
			}
		]);
		expect(overviewDocument?.metadata?.sheetTableHeaders).toEqual([
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 1
			},
			{
				spreadsheetHeaders: ['Owner', 'Due date'],
				tableIndex: 2
			}
		]);
	});

	it('detects blank-row-separated spreadsheet header restarts as multi-table boundaries', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si><si><t>Owner</t></si><si><t>Due date</t></si><si><t>Escalation</t></si><si><t>Ready</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
				'<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
				'<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>5</v></c></row>' +
				'<row r="5"><c r="A5" t="s"><v>6</v></c><c r="B5" t="s"><v>7</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 1. A: Metric | B: Status'
		);
		expect(overviewDocument?.text).toContain(
			'Row 4. A: Owner | B: Due date'
		);
		expect(overviewDocument?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4],
			sheetColumnEnd: 'B',
			sheetColumnStart: 'A',
			sheetHeaders: ['Metric', 'Status'],
			sheetName: 'Overview',
			sheetRowCount: 4,
			sheetTableCount: 2,
			sourceNativeKind: 'spreadsheet_sheet'
		});
		expect(overviewDocument?.metadata?.sheetTableColumnRanges).toEqual([
			{
				spreadsheetColumnEnd: 'B',
				spreadsheetColumnStart: 'A',
				tableIndex: 1
			},
			{
				spreadsheetColumnEnd: 'B',
				spreadsheetColumnStart: 'A',
				tableIndex: 2
			}
		]);
		expect(overviewDocument?.metadata?.sheetTableHeaders).toEqual([
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 1
			},
			{
				spreadsheetHeaders: ['Owner', 'Due date'],
				tableIndex: 2
			}
		]);
	});

	it('detects blank-gap shifted spreadsheet table restarts without header-like text', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si><si><t>Q1</t></si><si><t>Q2</t></si><si><t>12</t></si><si><t>15</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
				'<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
				'<row r="4"><c r="C4" t="s"><v>4</v></c><c r="D4" t="s"><v>5</v></c></row>' +
				'<row r="5"><c r="C5" t="s"><v>6</v></c><c r="D5" t="s"><v>7</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 1. A: Metric | B: Status'
		);
		expect(overviewDocument?.text).toContain('Row 4. C: Q1 | D: Q2');
		expect(overviewDocument?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4],
			sheetColumnEnd: 'D',
			sheetColumnStart: 'A',
			sheetHeaders: ['Metric', 'Status'],
			sheetName: 'Overview',
			sheetRowCount: 4,
			sheetTableCount: 2,
			sourceNativeKind: 'spreadsheet_sheet'
		});
		expect(overviewDocument?.metadata?.sheetTableColumnRanges).toEqual([
			{
				spreadsheetColumnEnd: 'B',
				spreadsheetColumnStart: 'A',
				tableIndex: 1
			},
			{
				spreadsheetColumnEnd: 'D',
				spreadsheetColumnStart: 'C',
				tableIndex: 2
			}
		]);
		expect(overviewDocument?.metadata?.sheetTableHeaders).toEqual([
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 1
			},
			{
				spreadsheetHeaders: ['Q1', 'Q2'],
				tableIndex: 2
			}
		]);
	});

	it('detects blank-gap same-span spreadsheet table restarts with weak header rows', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si><si><t>Metric</t></si><si><t>2025</t></si><si><t>Escalation</t></si><si><t>Ready</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
				'<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
				'<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>5</v></c></row>' +
				'<row r="5"><c r="A5" t="s"><v>6</v></c><c r="B5" t="s"><v>7</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 1. A: Metric | B: Status'
		);
		expect(overviewDocument?.text).toContain('Row 4. A: Metric | B: 2025');
		expect(overviewDocument?.text).toContain(
			'Row 5. Metric: Escalation | 2025: Ready'
		);
		expect(overviewDocument?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4],
			sheetHeaders: ['Metric', 'Status'],
			sheetTableCount: 2
		});
		expect(overviewDocument?.metadata?.sheetTableHeaders).toEqual([
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 1
			},
			{
				spreadsheetHeaders: ['Metric', '2025'],
				tableIndex: 2
			}
		]);
	});

	it('normalizes spreadsheet cell order from XML references before deriving headers and row text', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="B1" t="s"><v>1</v></c><c r="A1" t="s"><v>0</v></c></row>' +
				'<row r="2"><c r="B2" t="s"><v>3</v></c><c r="A2" t="s"><v>2</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 1. A: Metric | B: Status'
		);
		expect(overviewDocument?.text).toContain(
			'Row 2. Metric: Approval | Status: Blocked'
		);
		expect(overviewDocument?.metadata).toMatchObject({
			sheetHeaders: ['Metric', 'Status'],
			sheetColumnStart: 'A',
			sheetColumnEnd: 'B'
		});
	});

	it('aligns sparse spreadsheet row values to headers by column reference', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Owner</t></si><si><t>Blocked</t></si><si><t>Alex</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
				'<row r="2"><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'sparse.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 2. Status: Blocked | Owner: Alex'
		);
		expect(overviewDocument?.text).not.toContain(
			'Row 2. Metric: Blocked | Status: Alex'
		);
	});

	it('inherits blank cells in repeated spreadsheet restart headers from the previous table headers', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si><si><t>Metric</t></si><si><t>Escalation</t></si><si><t>Ready</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
				'<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
				'<row r="4"><c r="A4" t="s"><v>4</v></c></row>' +
				'<row r="5"><c r="A5" t="s"><v>5</v></c><c r="B5" t="s"><v>6</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 5. Metric: Escalation | Status: Ready'
		);
		expect(overviewDocument?.metadata?.sheetTableHeaders).toEqual([
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 1
			},
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 2
			}
		]);
	});

	it('inherits blank cells in shifted spreadsheet restart headers while preserving the shifted column span', async () => {
		const xlsx = createStoredZip({
			'xl/sharedStrings.xml':
				'<sst><si><t>Metric</t></si><si><t>Status</t></si><si><t>Approval</t></si><si><t>Blocked</t></si><si><t>Metric</t></si><si><t>Escalation</t></si><si><t>Ready</t></si></sst>',
			'xl/workbook.xml':
				'<workbook><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData>' +
				'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
				'<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
				'<row r="4"><c r="C4" t="s"><v>4</v></c></row>' +
				'<row r="5"><c r="C5" t="s"><v>5</v></c><c r="D5" t="s"><v>6</v></c></row>' +
				'</sheetData></worksheet>'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'tables.xlsx'
				}
			]
		});

		const overviewDocument = loaded.documents.find(
			(document) => document.metadata?.sheetName === 'Overview'
		);

		expect(overviewDocument?.text).toContain(
			'Row 5. Metric: Escalation | Status: Ready'
		);
		expect(overviewDocument?.metadata?.sheetTableColumnRanges).toEqual([
			{
				spreadsheetColumnEnd: 'B',
				spreadsheetColumnStart: 'A',
				tableIndex: 1
			},
			{
				spreadsheetColumnEnd: 'D',
				spreadsheetColumnStart: 'C',
				tableIndex: 2
			}
		]);
		expect(overviewDocument?.metadata?.sheetTableHeaders).toEqual([
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 1
			},
			{
				spreadsheetHeaders: ['Metric', 'Status'],
				tableIndex: 2
			}
		]);
	});

	it('supports built-in pptx extraction', async () => {
		const pptx = createStoredZip({
			'ppt/slides/slide1.xml': '<p:sld><a:t>Slide one</a:t></p:sld>',
			'ppt/slides/slide2.xml': '<p:sld><a:t>Slide two</a:t></p:sld>',
			'ppt/notesSlides/notesSlide1.xml':
				'<p:notes><a:t>Note one</a:t></p:notes>'
		});

		const loaded = await loadRAGDocumentUpload({
			content: pptx.toString('base64'),
			encoding: 'base64',
			name: 'deck.pptx'
		});

		expect(loaded.text).toContain('Slide one');
		expect(loaded.text).toContain('Slide two');
		expect(loaded.text).toContain('Speaker notes: Note one');
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

	it('supports built-in jsonl extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content:
				'{"tenant":"acme","status":"ready"}\n{"tenant":"beta","status":"blocked"}',
			contentType: 'application/x-ndjson',
			name: 'events.jsonl'
		});

		expect(loaded.format).toBe('jsonl');
		expect(loaded.text).toContain('"tenant":"acme"');
	});

	it('supports built-in tsv extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: 'tenant\tstatus\nacme\tready\nbeta\tblocked',
			contentType: 'text/tab-separated-values',
			name: 'events.tsv'
		});

		expect(loaded.format).toBe('tsv');
		expect(loaded.text).toContain('tenant\tstatus');
	});

	it('supports built-in csv extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: 'tenant,status\nacme,ready\nbeta,blocked',
			contentType: 'text/csv',
			name: 'events.csv'
		});

		expect(loaded.format).toBe('csv');
		expect(loaded.text).toContain('tenant,status');
	});

	it('supports built-in xml extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: '<feed><entry><title>Release</title></entry></feed>',
			contentType: 'application/xml',
			name: 'feed.xml'
		});

		expect(loaded.format).toBe('xml');
		expect(loaded.text).toContain('Release');
	});

	it('supports built-in yaml extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: 'tenant: acme\nstatus: ready\npipeline:\n  owner: ops',
			contentType: 'application/yaml',
			name: 'config.yaml'
		});

		expect(loaded.format).toBe('yaml');
		expect(loaded.text).toContain('tenant: acme');
	});

	it('rejects malformed jsonl extraction with a line-specific error', async () => {
		await expect(
			loadRAGDocumentUpload({
				content: '{"tenant":"acme"}\n{"tenant":',
				contentType: 'application/x-ndjson',
				name: 'broken.jsonl'
			})
		).rejects.toThrow('malformed JSONL at line 2');
	});

	it('rejects malformed csv extraction with a quoted-field error', async () => {
		await expect(
			loadRAGDocumentUpload({
				content: 'tenant,status\nacme,"ready',
				contentType: 'text/csv',
				name: 'broken.csv'
			})
		).rejects.toThrow('malformed CSV at line 2');
	});

	it('rejects malformed tsv extraction with a quoted-field error', async () => {
		await expect(
			loadRAGDocumentUpload({
				content: 'tenant\tstatus\nacme\t"ready',
				contentType: 'text/tab-separated-values',
				name: 'broken.tsv'
			})
		).rejects.toThrow('malformed TSV at line 2');
	});

	it('rejects malformed xml extraction with a tag-balance error', async () => {
		await expect(
			loadRAGDocumentUpload({
				content: '<feed><entry><title>Release</title></feed>',
				contentType: 'application/xml',
				name: 'broken.xml'
			})
		).rejects.toThrow('malformed XML');
	});

	it('rejects malformed yaml extraction with a nesting error', async () => {
		await expect(
			loadRAGDocumentUpload({
				content: '  owner: ops\npipeline:\n  stage: release',
				contentType: 'application/yaml',
				name: 'broken.yaml'
			})
		).rejects.toThrow('malformed YAML at line 1');
	});

	it('supports built-in email extraction', async () => {
		const loaded = await loadRAGDocumentUpload({
			content:
				'Subject: Hello\nFrom: test@example.com\nTo: team@example.com\nMessage-ID: <hello@example.com>\nIn-Reply-To: <root@example.com>\nReferences: <root@example.com> <hello@example.com>\n\nThis is the email body.',
			name: 'note.eml'
		});

		expect(loaded.title).toBe('Hello');
		expect(loaded.text).toContain('This is the email body');
		expect(loaded.metadata?.fileKind).toBe('email');
		expect(loaded.metadata?.from).toBe('test@example.com');
		expect(loaded.metadata?.messageId).toBe('<hello@example.com>');
		expect(loaded.metadata?.inReplyTo).toBe('<root@example.com>');
		expect(loaded.metadata?.references).toBe(
			'<root@example.com> <hello@example.com>'
		);
		expect(loaded.metadata?.to).toBe('team@example.com');
		expect(loaded.metadata?.threadTopic).toBe('Hello');
		expect(loaded.metadata?.threadKey).toBe('hello');
		expect(loaded.metadata?.replyDepth).toBe(2);
		expect(loaded.metadata?.replyReferenceCount).toBe(2);
		expect(loaded.metadata?.threadRootMessageId).toBe('<root@example.com>');
		expect(loaded.metadata?.threadMessageCount).toBe(2);
		expect(loaded.metadata?.threadMessageIds).toEqual([
			'<root@example.com>',
			'<hello@example.com>'
		]);
		expect(loaded.metadata?.emailKind).toBe('message');
		expect(loaded.metadata?.emailBodySectionCount).toBe(1);
		expect(loaded.metadata?.emailAuthoredSectionCount).toBe(1);
		expect(loaded.metadata?.emailQuotedSectionCount).toBe(0);
		expect(loaded.metadata?.emailForwardedHeaderSectionCount).toBe(0);
	});

	it('supports emlx extraction with trailing apple-mail metadata ignored', async () => {
		const rawEmail = [
			'Subject: Apple Mail export',
			'From: apple@example.com',
			'To: ops@example.com',
			'Message-ID: <apple-export@example.com>',
			'',
			'Apple Mail body.',
			'Quoted tail.'
		].join('\n');
		const emlxContent = [
			String(Buffer.byteLength(rawEmail, 'utf8')),
			rawEmail,
			'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
		].join('\n');

		const loaded = await loadRAGDocumentUpload({
			content: emlxContent,
			name: 'message.emlx'
		});

		expect(loaded.text).toContain('Apple Mail body.');
		expect(loaded.text).not.toContain('<plist>');
		expect(loaded.metadata).toMatchObject({
			emailMailboxContainerSource: 'message.emlx',
			emailMailboxFormat: 'emlx',
			emailMailboxHasTrailingMetadata: true,
			emailMailboxMessageByteLength: Buffer.byteLength(rawEmail, 'utf8'),
			emailMailboxMessageCount: 1,
			emailMailboxMessageIndex: 0,
			emailMailboxMessageOrdinal: 1,
			messageId: '<apple-export@example.com>'
		});
	});

	it('fans out pst uploads into message documents with mailbox metadata and thread reconstruction', async () => {
		const pstContent = [
			'Subject: PST root thread',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <pst-root@example.com>',
			'',
			'PST root body.',
			'',
			'Subject: PST root thread',
			'From: reply@example.com',
			'To: ops@example.com',
			'Message-ID: <pst-reply@example.com>',
			'In-Reply-To: <pst-root@example.com>',
			'References: <pst-root@example.com> <pst-reply@example.com>',
			'',
			'PST reply body.'
		].join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'thread.pst'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<pst-root@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const replyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<pst-reply@example.com>' &&
				document.metadata?.emailKind === 'message'
		);

		expect(loaded.documents).toHaveLength(2);
		expect(rootDocument?.source).toBe('thread.pst#messages/1');
		expect(rootDocument?.metadata).toMatchObject({
			emailMailboxContainerSource: 'thread.pst',
			emailMailboxFormat: 'pst',
			emailMailboxMessageCount: 2,
			emailMailboxMessageIndex: 0,
			emailMailboxMessageOrdinal: 1,
			threadKnownMessageCount: 2,
			threadLoadedMessageCount: 2
		});
		expect(replyDocument?.source).toBe('thread.pst#messages/2');
		expect(replyDocument?.metadata).toMatchObject({
			emailMailboxContainerSource: 'thread.pst',
			emailMailboxFormat: 'pst',
			emailMailboxMessageCount: 2,
			emailMailboxMessageIndex: 1,
			emailMailboxMessageOrdinal: 2,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<pst-root@example.com>',
			emailReplyParentSource: 'thread.pst#messages/1',
			threadKnownMessageCount: 2,
			threadLoadedMessageCount: 2
		});
	});

	it('fans out arbitrary pst mailbox message counts without hardcoded depth assumptions', async () => {
		const messageCount = 5;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-ordinal-${ordinal}@example.com>`;
			return buildRecoveredPstMailboxMessage({
				bodyLines: [`PST ordinal body ${ordinal}.`],
				folder: ['Ops', 'Recovered', 'Ordinal'],
				from: `pst-${ordinal}@example.com`,
				inReplyTo:
					ordinal > 1
						? `<pst-ordinal-${ordinal - 1}@example.com>`
						: undefined,
				messageId,
				references:
					ordinal > 1
						? `<pst-ordinal-1@example.com> ${Array.from(
								{ length: ordinal - 1 },
								(_, referenceIndex) =>
									`<pst-ordinal-${referenceIndex + 1}@example.com>`
							).join(' ')} ${messageId}`
						: undefined,
				subject: 'PST ordinal thread'
			});
		}).join('\n\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'ordinal-thread.pst'
				}
			]
		});

		expect(loaded.documents).toHaveLength(messageCount);
		for (const ordinal of Array.from(
			{ length: messageCount },
			(_, index) => index + 1
		)) {
			const document = loaded.documents.find(
				(entry) =>
					entry.metadata?.messageId ===
						`<pst-ordinal-${ordinal}@example.com>` &&
					entry.metadata?.emailKind === 'message'
			);

			expect(document?.source).toBe(
				`ordinal-thread.pst#messages/${ordinal}`
			);
			expect(document?.metadata).toMatchObject({
				emailMailboxContainerSource: 'ordinal-thread.pst',
				emailMailboxFormat: 'pst',
				emailMailboxMessageCount: messageCount,
				emailMailboxMessageIndex: ordinal - 1,
				emailMailboxMessageOrdinal: ordinal,
				threadLoadedMessageCount: messageCount
			});
		}
	});

	it('preserves pst mailbox folder lineage and state semantics on emitted messages', async () => {
		const pstContent = [
			buildRecoveredPstMailboxMessage({
				bodyLines: ['PST folder lineage body.'],
				decoratorLines: [
					'Categories: Release; Escalation',
					'Importance: high',
					'Attachment: escalation.log; owner.csv',
					'Conversation-Topic: Regional release incident',
					'Conversation-Index: pst-conv-01'
				],
				folder: ['Ops', 'Release', 'Escalations'],
				from: 'pst-folder@example.com',
				messageId: '<pst-folder@example.com>',
				stateFlags: ['flagged', 'read'],
				subject: 'PST folder lineage thread'
			}),
			buildRecoveredPstMailboxMessage({
				bodyLines: ['PST draft lineage body.'],
				decoratorLines: ['Draft: true', 'Sensitivity: confidential'],
				folder: ['Ops', 'Release', 'Drafts'],
				from: 'pst-draft@example.com',
				inReplyTo: '<pst-folder@example.com>',
				messageId: '<pst-draft@example.com>',
				references: '<pst-folder@example.com> <pst-draft@example.com>',
				subject: 'PST folder lineage thread'
			})
		].join('\n\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'folder-thread.pst'
				}
			]
		});

		const escalationsMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<pst-folder@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const draftsMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<pst-draft@example.com>' &&
				document.metadata?.emailKind === 'message'
		);

		expect(escalationsMessage?.metadata).toMatchObject({
			attachmentCount: 2,
			attachmentNames: ['escalation.log', 'owner.csv'],
			emailCategories: ['Release', 'Escalation'],
			emailConversationIndex: 'pst-conv-01',
			emailConversationTopic: 'Regional release incident',
			emailMailboxFamilyKey: 'ops/release/escalations',
			emailMailboxFolder: 'Escalations',
			emailMailboxLeaf: 'Escalations',
			emailImportance: 'high',
			emailMailboxPathDepth: 3,
			emailMailboxPathSegments: ['Ops', 'Release', 'Escalations'],
			emailMailboxStateFlags: ['flagged', 'read'],
			emailMailboxIsFlagged: true,
			emailMailboxIsRead: true,
			emailMailboxIsUnread: false
		});
		expect(draftsMessage?.metadata).toMatchObject({
			emailMailboxFamilyKey: 'ops/release/drafts',
			emailMailboxFolder: 'Drafts',
			emailMailboxLeaf: 'Drafts',
			emailMailboxPathDepth: 3,
			emailMailboxPathSegments: ['Ops', 'Release', 'Drafts'],
			emailSensitivity: 'confidential',
			emailMailboxStateFlags: ['draft', 'unread'],
			emailMailboxIsDraft: true,
			emailMailboxIsUnread: true,
			emailReplyParentLoaded: true
		});
	});

	it('synthesizes sender recipient and sent-date headers from pst container decorators before email extraction', async () => {
		const pstContent = buildRecoveredPstMailboxMessage({
			bodyLines: ['PST synthesized message body.'],
			decoratorLines: [
				'Sender-Name: Lantern Owner',
				'Sender-Email: lantern.owner@example.com',
				'To-Recipients: ops@example.com, release@example.com',
				'Cc-Recipients: audit@example.com',
				'Reply-To-Recipients: replies@example.com',
				'Internet-Message-Id: <pst-synthesized@example.com>',
				'Conversation-Id: pst-conversation-lantern-001',
				'Client-Submit-Time: Tue, 21 Apr 2026 09:45:00 -0400',
				'Delivery-Time: Tue, 21 Apr 2026 09:46:15 -0400',
				'Creation-Time: Tue, 21 Apr 2026 09:40:00 -0400',
				'Last-Modified-Time: Tue, 21 Apr 2026 09:50:00 -0400',
				'Message-Class: IPM.Note',
				'Conversation-Index: AQHTHREAD.001',
				'Conversation-Topic: Lantern regional recovery'
			],
			folder: ['Ops', 'Recovered', 'Special'],
			subject: 'PST synthesized routing',
			to: ''
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'synthesized.pst'
				}
			]
		});

		const messageDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<pst-synthesized@example.com>' &&
				document.metadata?.emailKind === 'message'
		);

		expect(messageDocument?.metadata).toMatchObject({
			emailClientSubmitTime: 'Tue, 21 Apr 2026 09:45:00 -0400',
			emailCreationTime: 'Tue, 21 Apr 2026 09:40:00 -0400',
			emailConversationId: 'pst-conversation-lantern-001',
			emailDeliveryTime: 'Tue, 21 Apr 2026 09:46:15 -0400',
			emailInternetMessageId: '<pst-synthesized@example.com>',
			emailLastModifiedTime: 'Tue, 21 Apr 2026 09:50:00 -0400',
			emailMailboxContainerSource: 'synthesized.pst',
			emailMailboxFormat: 'pst',
			emailMailboxFamilyKey: 'ops/recovered/special',
			emailMailboxLeaf: 'Special',
			emailMailboxPathSegments: ['Ops', 'Recovered', 'Special'],
			emailMessageClass: 'IPM.Note',
			emailReceivedAt: 'Tue, 21 Apr 2026 09:46:15 -0400',
			emailSentAt: 'Tue, 21 Apr 2026 09:45:00 -0400',
			emailConversationIndex: 'AQHTHREAD.001',
			emailConversationTopic: 'Lantern regional recovery',
			fromAddress: 'lantern.owner@example.com',
			fromDisplayName: 'Lantern Owner',
			messageId: '<pst-synthesized@example.com>',
			replyToAddresses: ['replies@example.com'],
			threadKey: 'lantern regional recovery',
			threadTopic: 'Lantern regional recovery',
			toAddresses: ['ops@example.com', 'release@example.com'],
			ccAddresses: ['audit@example.com']
		});
		expect(messageDocument?.metadata?.threadIndex).toBe('AQHTHREAD.001');
		expect(messageDocument?.text).toContain(
			'PST synthesized message body.'
		);
	});

	it('falls back thread identity to conversation-id for sparse pst container decorators when conversation-topic is absent', async () => {
		const pstContent = buildRecoveredPstMailboxMessage({
			bodyLines: ['PST sparse conversation-id fallback body.'],
			decoratorLines: [
				'Sender-Email: lantern.owner@example.com',
				'To-Recipients: ops@example.com',
				'Conversation-Id: pst-conversation-lantern-fallback-007',
				'Internet-Message-Id: <pst-conversation-fallback@example.com>'
			],
			folder: ['Ops', 'Recovered', 'Special'],
			to: ''
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'conversation-id-fallback.pst'
				}
			]
		});

		const messageDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<pst-conversation-fallback@example.com>' &&
				document.metadata?.emailKind === 'message'
		);

		expect(messageDocument?.metadata).toMatchObject({
			emailConversationId: 'pst-conversation-lantern-fallback-007',
			messageId: '<pst-conversation-fallback@example.com>',
			threadKey: 'pst-conversation-lantern-fallback-007'
		});
	});

	it('falls back subject and thread topic to normalized-subject for sparse pst container decorators when subject is absent', async () => {
		const pstContent = buildRecoveredPstMailboxMessage({
			bodyLines: ['PST normalized subject fallback body.'],
			decoratorLines: [
				'Sender-Email: lantern.owner@example.com',
				'To-Recipients: ops@example.com',
				'Normalized-Subject: Lantern normalized outage followup',
				'Internet-Message-Id: <pst-normalized-subject@example.com>'
			],
			folder: ['Ops', 'Recovered', 'Special'],
			to: ''
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'normalized-subject-fallback.pst'
				}
			]
		});

		const messageDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<pst-normalized-subject@example.com>' &&
				document.metadata?.emailKind === 'message'
		);

		expect(messageDocument?.metadata).toMatchObject({
			emailNormalizedSubject: 'Lantern normalized outage followup',
			messageId: '<pst-normalized-subject@example.com>',
			threadKey: 'lantern normalized outage followup',
			threadTopic: 'Lantern normalized outage followup'
		});
	});

	it('synthesizes reply-chain headers from pst container decorators before email extraction', async () => {
		const rootMessageId = '<pst-synthesized-root@example.com>';
		const replyMessageId = '<pst-synthesized-reply@example.com>';
		const pstContent = [
			buildRecoveredPstMailboxMessage({
				bodyLines: ['PST synthesized root message body.'],
				decoratorLines: [
					'Conversation-Topic: Lantern regional recovery',
					`Internet-Message-Id: ${rootMessageId}`,
					'Client-Submit-Time: Tue, 21 Apr 2026 09:40:00 -0400'
				],
				folder: ['Ops', 'Recovered', 'Special'],
				subject: 'PST synthesized routing root',
				to: ''
			}),
			buildRecoveredPstMailboxMessage({
				bodyLines: ['PST synthesized reply message body.'],
				decoratorLines: [
					'Conversation-Topic: Lantern regional recovery',
					`Internet-Message-Id: ${replyMessageId}`,
					`Parent-Message-Id: ${rootMessageId}`,
					`Reference-Chain: ${rootMessageId} ${replyMessageId}`,
					'Client-Submit-Time: Tue, 21 Apr 2026 09:45:00 -0400'
				],
				folder: ['Ops', 'Recovered', 'Special'],
				subject: 'PST synthesized routing reply',
				to: ''
			})
		].join('\n\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'synthesized-thread.pst'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === rootMessageId &&
				document.metadata?.emailKind === 'message'
		);
		const replyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === replyMessageId &&
				document.metadata?.emailKind === 'message'
		);

		expect(rootDocument?.metadata).toMatchObject({
			emailMailboxContainerSource: 'synthesized-thread.pst',
			emailMailboxFormat: 'pst',
			messageId: rootMessageId,
			threadKey: 'lantern regional recovery',
			threadKnownMessageCount: 2,
			threadLoadedMessageCount: 2,
			threadRootMessageId: rootMessageId,
			threadTopic: 'Lantern regional recovery'
		});
		expect(replyDocument?.metadata).toMatchObject({
			emailMailboxContainerSource: 'synthesized-thread.pst',
			emailMailboxFormat: 'pst',
			inReplyTo: rootMessageId,
			messageId: replyMessageId,
			references: `${rootMessageId} ${replyMessageId}`,
			threadKey: 'lantern regional recovery',
			threadLoadedMessageCount: 2,
			threadRootMessageId: rootMessageId,
			threadTopic: 'Lantern regional recovery',
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: rootMessageId,
			emailReplyParentSource: 'synthesized-thread.pst#messages/1'
		});
	});

	it('routes recoverable pst attachment payloads through shared absolutejs ingestors', async () => {
		const nestedArchive = createStoredZip({
			'docs/guide.md': '# Guide\n\nRecovered PST archive text'
		});
		const attachedEmail = [
			'Subject: PST recovered child',
			'From: child@example.com',
			'To: ops@example.com',
			'Message-ID: <pst-recovered-child@example.com>',
			'',
			'Recovered PST attached child body.'
		].join('\n');
		const pstContent = buildRecoveredPstMailboxMessage({
			attachments: [
				{
					content: nestedArchive,
					contentType: 'application/zip',
					name: 'recovered.zip'
				},
				{
					content: 'Recovered PST inline note',
					contentId: '<pst-inline-note@example.com>',
					contentLocation: 'attachments/pst-inline-note.txt',
					contentType: 'text/plain',
					disposition: 'inline',
					name: 'inline-note.txt'
				},
				{
					content: attachedEmail,
					contentType: 'message/rfc822',
					name: 'nested-child.eml'
				}
			],
			bodyLines: [
				'PST recoverable attachment root body.',
				'See cid:pst-inline-note@example.com for the inline note.',
				'Attachment path: attachments/pst-inline-note.txt'
			],
			folder: ['Ops', 'Recovered'],
			from: 'pst-recovered@example.com',
			messageId: '<pst-recovered@example.com>',
			stateFlags: ['flagged', 'read'],
			subject: 'PST recoverable attachments'
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-attachments.pst'
				}
			]
		});

		const rootMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<pst-recovered@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const recoveredArchiveChild = loaded.documents.find(
			(document) =>
				document.source ===
				'recoverable-attachments.pst#messages/1#attachments/recovered.zip#docs/guide.md'
		);
		const recoveredInlineNote = loaded.documents.find(
			(document) =>
				document.source ===
				'recoverable-attachments.pst#messages/1#attachments/inline-note.txt'
		);
		const recoveredChildMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<pst-recovered-child@example.com>' &&
				document.source ===
					'recoverable-attachments.pst#messages/1#attachments/nested-child.eml'
		);

		expect(rootMessage?.metadata).toMatchObject({
			attachmentCount: 3,
			attachmentNames: [
				'recovered.zip',
				'inline-note.txt',
				'nested-child.eml'
			],
			emailMailboxContainerSource: 'recoverable-attachments.pst',
			emailMailboxFamilyKey: 'ops/recovered',
			emailMailboxFormat: 'pst',
			emailMailboxStateFlags: ['flagged', 'read']
		});
		expect(recoveredArchiveChild?.metadata).toMatchObject({
			attachmentRecoveredFromMailboxContainer: true,
			emailAttachmentRole: 'file_attachment',
			emailAttachmentSource:
				'recoverable-attachments.pst#messages/1#attachments/recovered.zip',
			emailMailboxContainerSource: 'recoverable-attachments.pst',
			emailMailboxFamilyKey: 'ops/recovered',
			emailMailboxStateFlags: ['flagged', 'read']
		});
		expect(recoveredInlineNote?.metadata).toMatchObject({
			attachmentContentId: '<pst-inline-note@example.com>',
			attachmentContentLocation: 'attachments/pst-inline-note.txt',
			attachmentDisposition: 'inline',
			attachmentEmbeddedReferenceMatched: true,
			attachmentRecoveredFromMailboxContainer: true,
			emailAttachmentRole: 'inline_resource',
			emailAttachmentSource:
				'recoverable-attachments.pst#messages/1#attachments/inline-note.txt',
			emailMailboxContainerSource: 'recoverable-attachments.pst',
			emailMailboxFamilyKey: 'ops/recovered',
			emailMailboxStateFlags: ['flagged', 'read']
		});
		expect(recoveredChildMessage?.metadata).toMatchObject({
			attachmentRecoveredFromMailboxContainer: true,
			emailAttachmentRole: 'attached_message',
			emailAttachmentSource:
				'recoverable-attachments.pst#messages/1#attachments/nested-child.eml',
			emailKind: 'message',
			emailMailboxContainerSource: 'recoverable-attachments.pst',
			emailMailboxFamilyKey: 'ops/recovered',
			emailMailboxFormat: 'pst',
			emailMessageSource:
				'recoverable-attachments.pst#messages/1#attachments/nested-child.eml'
		});
	});

	it('preserves repeated recoverable pst attachment families across multiple mailbox messages', async () => {
		const messageSpecs: Array<{
			archiveText: string;
			childMessageId: string;
			familyKey: string;
			folder: string;
			inlineContentId: string;
			messageId: string;
			ordinal: number;
			replyTo?: string;
			stateFlags: string;
		}> = [
			{
				archiveText: 'First recovered PST archive text',
				childMessageId: '<pst-recovered-multi-child-1@example.com>',
				familyKey: 'first',
				folder: 'Ops/Recovered/First',
				inlineContentId: '<pst-recovered-inline-1@example.com>',
				messageId: '<pst-recovered-multi-1@example.com>',
				ordinal: 1,
				stateFlags: 'flagged read'
			},
			{
				archiveText: 'Second recovered PST archive text',
				childMessageId: '<pst-recovered-multi-child-2@example.com>',
				familyKey: 'second',
				folder: 'Ops/Recovered/Second',
				inlineContentId: '<pst-recovered-inline-2@example.com>',
				messageId: '<pst-recovered-multi-2@example.com>',
				ordinal: 2,
				replyTo: '<pst-recovered-multi-1@example.com>',
				stateFlags: 'passed unread'
			}
		];
		const pstContent = messageSpecs
			.flatMap((spec, index) => {
				const nestedArchive = createStoredZip({
					'docs/guide.md': `# Guide\n\n${spec.archiveText}`
				});
				const attachedEmail = [
					`Subject: PST recovered child ${spec.ordinal}`,
					`From: child-${spec.ordinal}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${spec.childMessageId}`,
					...(typeof spec.replyTo === 'string'
						? [
								`In-Reply-To: ${spec.replyTo}`,
								`References: ${spec.replyTo} ${spec.childMessageId}`
							]
						: []),
					'',
					`Recovered PST attached child body ${spec.ordinal}.`
				].join('\n');

				return [
					buildRecoveredPstMailboxMessage({
						attachments: [
							{
								content: nestedArchive,
								contentType: 'application/zip',
								name: 'recovered.zip'
							},
							{
								content: `${spec.familyKey} recovered PST inline note`,
								contentId: spec.inlineContentId,
								contentLocation: `attachments/${spec.familyKey}/inline-note.txt`,
								contentType: 'text/plain',
								disposition: 'inline',
								name: 'inline-note.txt'
							},
							{
								content: attachedEmail,
								contentType: 'message/rfc822',
								name: 'nested-child.eml'
							}
						],
						bodyLines: [
							`PST recoverable multi root body ${spec.ordinal}.`,
							`See cid:${spec.inlineContentId.replace(/^<|>$/g, '')} for the inline note.`,
							`Attachment path: attachments/${spec.familyKey}/inline-note.txt`
						],
						folder: spec.folder,
						from: `pst-recovered-${spec.ordinal}@example.com`,
						inReplyTo: spec.replyTo,
						messageId: spec.messageId,
						references:
							typeof spec.replyTo === 'string'
								? `${spec.replyTo} ${spec.messageId}`
								: undefined,
						stateFlags: spec.stateFlags.split(' '),
						subject: `PST recovered multi ${spec.ordinal}`
					}),
					...(index === messageSpecs.length - 1 ? [] : [''])
				];
			})
			.join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-multi.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(8);
		for (const spec of messageSpecs) {
			const messageSource = recoveredPstMessageSource({
				containerSource: 'recoverable-multi.pst',
				ordinal: spec.ordinal
			});
			const rootMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId === spec.messageId &&
					document.metadata?.emailKind === 'message'
			);
			const recoveredArchiveChild = loaded.documents.find(
				(document) =>
					document.source ===
					`${messageSource}#attachments/recovered.zip#docs/guide.md`
			);
			const recoveredInlineNote = loaded.documents.find(
				(document) =>
					document.source ===
					`${messageSource}#attachments/inline-note.txt`
			);
			const recoveredChildMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId === spec.childMessageId &&
					document.source ===
						`${messageSource}#attachments/nested-child.eml`
			);

			expect(rootMessage?.metadata).toMatchObject({
				attachmentCount: 3,
				attachmentNames: [
					'recovered.zip',
					'inline-note.txt',
					'nested-child.eml'
				],
				emailMailboxContainerSource: 'recoverable-multi.pst',
				emailMailboxFamilyKey: spec.folder.toLowerCase(),
				emailMailboxFormat: 'pst',
				emailMailboxMessageOrdinal: spec.ordinal
			});
			expect(recoveredArchiveChild?.metadata).toMatchObject({
				attachmentRecoveredFromMailboxContainer: true,
				emailAttachmentRole: 'file_attachment',
				emailAttachmentSource: recoveredPstMessageAttachmentSource({
					attachmentName: 'recovered.zip',
					containerSource: 'recoverable-multi.pst',
					ordinal: spec.ordinal
				}),
				emailMailboxContainerSource: 'recoverable-multi.pst',
				emailMailboxFamilyKey: spec.folder.toLowerCase(),
				emailMailboxMessageOrdinal: spec.ordinal
			});
			expect(recoveredInlineNote?.metadata).toMatchObject({
				attachmentContentId: spec.inlineContentId,
				attachmentContentLocation: `attachments/${spec.familyKey}/inline-note.txt`,
				attachmentDisposition: 'inline',
				attachmentEmbeddedReferenceMatched: true,
				attachmentRecoveredFromMailboxContainer: true,
				emailAttachmentRole: 'inline_resource',
				emailAttachmentSource: recoveredPstMessageAttachmentSource({
					attachmentName: 'inline-note.txt',
					containerSource: 'recoverable-multi.pst',
					ordinal: spec.ordinal
				}),
				emailMailboxContainerSource: 'recoverable-multi.pst',
				emailMailboxFamilyKey: spec.folder.toLowerCase(),
				emailMailboxMessageOrdinal: spec.ordinal
			});
			expect(recoveredChildMessage?.metadata).toMatchObject({
				attachmentRecoveredFromMailboxContainer: true,
				emailAttachmentRole: 'attached_message',
				emailAttachmentSource: recoveredPstMessageAttachmentSource({
					attachmentName: 'nested-child.eml',
					containerSource: 'recoverable-multi.pst',
					ordinal: spec.ordinal
				}),
				emailKind: 'message',
				emailMailboxContainerSource: 'recoverable-multi.pst',
				emailMailboxFamilyKey: spec.folder.toLowerCase(),
				emailMailboxFormat: 'pst',
				emailMailboxMessageOrdinal: spec.ordinal,
				emailMessageSource: `${messageSource}#attachments/nested-child.eml`
			});
		}

		const secondRootMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<pst-recovered-multi-2@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		expect(secondRootMessage?.metadata).toMatchObject({
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<pst-recovered-multi-1@example.com>',
			threadLoadedMessageCount: 3
		});
	});

	it('preserves arbitrary recovered pst descendant families across multiple mailbox messages without depth-specific handling', async () => {
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const messageCount = 4;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-generated-${ordinal}@example.com>`;
			const replyTo =
				ordinal > 1
					? `<pst-generated-${ordinal - 1}@example.com>`
					: undefined;
			const descendantBlocks = familyKeys.flatMap((familyKey) => {
				const nestedArchive = createStoredZip({
					[`docs/${familyKey}.md`]: `# ${familyKey}\n\nRecovered PST ${familyKey} text ${ordinal}`
				});
				return [
					`Attachment: bundle-${familyKey}.zip`,
					'Attachment-Content-Type: application/zip',
					'Attachment-Transfer-Encoding: base64',
					`Attachment-Data: ${Buffer.from(nestedArchive).toString('base64')}`
				];
			});

			return [
				`Folder: Ops/Recovered/Case${ordinal}`,
				`Flags: ${ordinal % 2 === 0 ? 'passed unread' : 'flagged read'}`,
				...descendantBlocks,
				`Subject: PST generated ${ordinal}`,
				`From: pst-generated-${ordinal}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${messageId}`,
				...(typeof replyTo === 'string'
					? [
							`In-Reply-To: ${replyTo}`,
							`References: ${replyTo} ${messageId}`
						]
					: []),
				'',
				`Generated PST root body ${ordinal}.`,
				''
			].join('\n');
		}).join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-generated.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			messageCount * familyKeys.length
		);
		for (let ordinal = 1; ordinal <= messageCount; ordinal += 1) {
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			for (const familyKey of familyKeys) {
				const descendant = loaded.documents.find(
					(document) =>
						document.source ===
						`${recoveredPstMessageAttachmentSource({
							attachmentName: `bundle-${familyKey}.zip`,
							containerSource: 'recoverable-generated.pst',
							ordinal
						})}#docs/${familyKey}.md`
				);

				expect(descendant?.metadata).toMatchObject({
					attachmentRecoveredFromMailboxContainer: true,
					emailAttachmentRole: 'file_attachment',
					emailAttachmentSource: recoveredPstMessageAttachmentSource({
						attachmentName: `bundle-${familyKey}.zip`,
						containerSource: 'recoverable-generated.pst',
						ordinal
					}),
					...buildRecoveredPstMailboxMetadata({
						caseKey: `Case${ordinal}`,
						containerSource: 'recoverable-generated.pst',
						ordinal,
						stateFlags: expectedStateFlags
					})
				});
				expect(descendant?.text).toContain(
					`Recovered PST ${familyKey} text ${ordinal}`
				);
			}
		}
	});

	it('preserves arbitrary recovered pst attached-message descendant trees across multiple mailbox messages without depth-specific handling', async () => {
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const messageCount = 4;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-generated-attached-${ordinal}@example.com>`;
			const replyTo =
				ordinal > 1
					? `<pst-generated-attached-${ordinal - 1}@example.com>`
					: undefined;
			return buildRecoveredPstMailboxMessage({
				attachments: familyKeys.flatMap((familyKey) => {
					const nestedArchive = createStoredZip({
						[`docs/${familyKey}.md`]: `# ${familyKey}\n\nRecovered PST root ${familyKey} text ${ordinal}`
					});
					const nestedChildArchive = createStoredZip({
						[`docs/${familyKey}-child.md`]: `# ${familyKey} child\n\nRecovered PST attached ${familyKey} text ${ordinal}`
					});
					const nestedChildEmail = [
						`Subject: PST attached child ${familyKey} ${ordinal}`,
						`From: child-${familyKey}-${ordinal}@example.com`,
						'To: ops@example.com',
						`Message-ID: <pst-generated-attached-${ordinal}-${familyKey}@example.com>`,
						`In-Reply-To: ${messageId}`,
						`References: ${messageId} <pst-generated-attached-${ordinal}-${familyKey}@example.com>`,
						`Content-Type: multipart/mixed; boundary="pst-attached-${ordinal}-${familyKey}"`,
						'',
						`--pst-attached-${ordinal}-${familyKey}`,
						'Content-Type: text/plain; charset=utf-8',
						'',
						`Recovered PST attached child body ${familyKey} ${ordinal}.`,
						`--pst-attached-${ordinal}-${familyKey}`,
						`Content-Type: application/zip; name="nested-${familyKey}.zip"`,
						`Content-Disposition: attachment; filename="nested-${familyKey}.zip"`,
						'Content-Transfer-Encoding: base64',
						'',
						Buffer.from(nestedChildArchive).toString('base64'),
						`--pst-attached-${ordinal}-${familyKey}--`
					].join('\n');
					return [
						{
							content: nestedArchive,
							contentType: 'application/zip',
							name: `bundle-${familyKey}.zip`
						},
						{
							content: nestedChildEmail,
							contentType: 'message/rfc822',
							name: `thread-${familyKey}.eml`
						}
					];
				}),
				bodyLines: [`Generated PST attached root body ${ordinal}.`],
				folder: ['Ops', 'Recovered', `AttachedCase${ordinal}`],
				from: `pst-generated-attached-${ordinal}@example.com`,
				inReplyTo: replyTo,
				messageId,
				references:
					typeof replyTo === 'string'
						? `${replyTo} ${messageId}`
						: undefined,
				stateFlags: recoveredPstStateFlags(ordinal),
				subject: `PST attached generated ${ordinal}`
			});
		}).join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-generated-attached.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			messageCount * familyKeys.length * 2
		);
		for (let ordinal = 1; ordinal <= messageCount; ordinal += 1) {
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			const rootMessageId = `<pst-generated-attached-${ordinal}@example.com>`;
			for (const familyKey of familyKeys) {
				const messageSource = recoveredPstMessageSource({
					containerSource: 'recoverable-generated-attached.pst',
					ordinal
				});
				const attachedMessageSource =
					recoveredPstMessageAttachmentSource({
						attachmentName: `thread-${familyKey}.eml`,
						containerSource: 'recoverable-generated-attached.pst',
						ordinal
					});
				const rootArchiveDescendant = loaded.documents.find(
					(document) =>
						document.source ===
						`${messageSource}#attachments/bundle-${familyKey}.zip#docs/${familyKey}.md`
				);
				const attachedMessage = loaded.documents.find(
					(document) =>
						document.metadata?.messageId ===
							`<pst-generated-attached-${ordinal}-${familyKey}@example.com>` &&
						document.source === attachedMessageSource
				);
				const attachedArchiveDescendant = loaded.documents.find(
					(document) =>
						document.source ===
						`${attachedMessageSource}#attachments/nested-${familyKey}.zip#docs/${familyKey}-child.md`
				);

				expect(rootArchiveDescendant?.metadata).toMatchObject({
					attachmentRecoveredFromMailboxContainer: true,
					emailAttachmentRole: 'file_attachment',
					emailAttachmentSource: recoveredPstMessageAttachmentSource({
						attachmentName: `bundle-${familyKey}.zip`,
						containerSource: 'recoverable-generated-attached.pst',
						ordinal
					}),
					...buildRecoveredPstMailboxMetadata({
						caseKey: `AttachedCase${ordinal}`,
						containerSource: 'recoverable-generated-attached.pst',
						ordinal,
						stateFlags: expectedStateFlags
					})
				});
				expect(attachedMessage?.metadata).toMatchObject({
					attachmentRecoveredFromMailboxContainer: true,
					emailAttachmentRole: 'attached_message',
					emailAttachmentSource: attachedMessageSource,
					emailKind: 'message',
					emailMailboxContainerSource:
						'recoverable-generated-attached.pst',
					emailMailboxFamilyKey:
						`ops/recovered/attachedcase${ordinal}`.toLowerCase(),
					emailMailboxFormat: 'pst',
					emailMailboxMessageOrdinal: ordinal,
					emailMailboxStateFlags: expectedStateFlags,
					emailMessageDepth: 1,
					emailMessageLineageAttachmentSources: [
						attachedMessageSource
					],
					emailMessageLineageCount: 1,
					emailMessageLineageMessageIds: [rootMessageId],
					emailMessageLineageSources: [messageSource],
					emailMessageSource: attachedMessageSource,
					emailMessageSourceKind: 'attached_message'
				});
				expect(attachedArchiveDescendant?.metadata).toMatchObject({
					emailAttachmentSource: `${attachedMessageSource}#attachments/nested-${familyKey}.zip`,
					emailMailboxContainerSource:
						'recoverable-generated-attached.pst',
					emailMailboxFamilyKey:
						`ops/recovered/attachedcase${ordinal}`.toLowerCase(),
					emailMailboxMessageOrdinal: ordinal,
					emailMailboxStateFlags: expectedStateFlags,
					emailMessageLineageAttachmentSources: [
						attachedMessageSource
					],
					emailMessageLineageCount: 1,
					emailMessageSource: attachedMessageSource,
					emailMessageSourceKind: 'attached_message'
				});
				expect(attachedArchiveDescendant?.text).toContain(
					`Recovered PST attached ${familyKey} text ${ordinal}`
				);
			}
		}
	});

	it('preserves arbitrary nested recovered pst attached-message levels across multiple mailbox messages without depth-specific handling', async () => {
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const messageCount = 3;
		const depthCount = 3;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-generated-attached-nested-${ordinal}@example.com>`;
			const replyTo =
				ordinal > 1
					? `<pst-generated-attached-nested-${ordinal - 1}@example.com>`
					: undefined;
			const descendantBlocks = familyKeys.flatMap((familyKey) => [
				`Attachment: thread-${familyKey}-level-1.eml`,
				'Attachment-Content-Type: message/rfc822',
				'Attachment-Transfer-Encoding: base64',
				`Attachment-Data: ${Buffer.from(
					buildRecoveredPstNestedAttachedEmail({
						depth: 1,
						familyKey,
						maxDepth: depthCount,
						messageIdPrefix: 'pst-generated-attached',
						ordinal,
						parentMessageId: messageId
					}),
					'utf8'
				).toString('base64')}`
			]);

			return buildRecoveredPstMailboxMessage({
				attachments: familyKeys.map((familyKey) => ({
					content: buildRecoveredPstNestedAttachedEmail({
						depth: 1,
						familyKey,
						maxDepth: depthCount,
						messageIdPrefix: 'pst-generated-attached',
						ordinal,
						parentMessageId: messageId
					}),
					contentType: 'message/rfc822',
					name: `thread-${familyKey}-level-1.eml`
				})),
				bodyLines: [
					`Generated PST nested attached root body ${ordinal}.`
				],
				folder: ['Ops', 'Recovered', `NestedAttachedCase${ordinal}`],
				from: `pst-generated-nested-${ordinal}@example.com`,
				inReplyTo: replyTo,
				messageId,
				references:
					typeof replyTo === 'string'
						? `${replyTo} ${messageId}`
						: undefined,
				stateFlags: recoveredPstStateFlags(ordinal),
				subject: `PST nested attached generated ${ordinal}`
			});
		}).join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-generated-attached-nested.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			messageCount * familyKeys.length * depthCount
		);
		for (let ordinal = 1; ordinal <= messageCount; ordinal += 1) {
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			const rootMessageId = `<pst-generated-attached-nested-${ordinal}@example.com>`;
			const rootMessageSource = recoveredPstMessageSource({
				containerSource: 'recoverable-generated-attached-nested.pst',
				ordinal
			});
			for (const familyKey of familyKeys) {
				let attachedMessageSource = `${rootMessageSource}#attachments/thread-${familyKey}-level-1.eml`;
				const expectedLineageAttachmentSources: string[] = [];
				const expectedLineageMessageIds: string[] = [rootMessageId];
				const expectedLineageSources: string[] = [rootMessageSource];
				for (let depth = 1; depth <= depthCount; depth += 1) {
					const messageId = `<pst-generated-attached-${ordinal}-${familyKey}-level-${depth}@example.com>`;
					expectedLineageAttachmentSources.push(
						attachedMessageSource
					);
					const attachedMessage = loaded.documents.find(
						(document) =>
							document.metadata?.messageId === messageId &&
							document.source === attachedMessageSource
					);
					const attachedArchiveDescendant = loaded.documents.find(
						(document) =>
							document.source ===
							`${attachedMessageSource}#attachments/nested-${familyKey}-level-${depth}.zip#docs/${familyKey}-level-${depth}.md`
					);

					expect(attachedMessage?.metadata).toMatchObject({
						...(depth === 1
							? {
									attachmentRecoveredFromMailboxContainer:
										true,
									emailAttachmentRole: 'attached_message'
								}
							: {}),
						emailAttachmentSource: attachedMessageSource,
						emailKind: 'message',
						emailMailboxContainerSource:
							'recoverable-generated-attached-nested.pst',
						emailMailboxFamilyKey:
							`ops/recovered/nestedattachedcase${ordinal}`.toLowerCase(),
						emailMailboxFormat: 'pst',
						emailMailboxMessageOrdinal: ordinal,
						emailMailboxStateFlags: expectedStateFlags,
						emailMessageDepth: depth,
						emailMessageLineageAttachmentSources:
							expectedLineageAttachmentSources,
						emailMessageLineageCount: depth,
						emailMessageLineageMessageIds:
							expectedLineageMessageIds,
						emailMessageLineageSources: expectedLineageSources,
						emailMessageSource: attachedMessageSource,
						emailMessageSourceKind: 'attached_message'
					});
					expect(attachedArchiveDescendant?.metadata).toMatchObject({
						emailAttachmentSource: `${attachedMessageSource}#attachments/nested-${familyKey}-level-${depth}.zip`,
						emailMailboxContainerSource:
							'recoverable-generated-attached-nested.pst',
						emailMailboxFamilyKey:
							`ops/recovered/nestedattachedcase${ordinal}`.toLowerCase(),
						emailMailboxMessageOrdinal: ordinal,
						emailMailboxStateFlags: expectedStateFlags,
						emailMessageLineageAttachmentSources:
							expectedLineageAttachmentSources,
						emailMessageLineageCount: depth,
						emailMessageSource: attachedMessageSource,
						emailMessageSourceKind: 'attached_message'
					});
					expect(attachedArchiveDescendant?.text).toContain(
						`Recovered PST nested attached ${familyKey} text ${ordinal} depth ${depth}`
					);

					if (depth < depthCount) {
						expectedLineageMessageIds.push(messageId);
						expectedLineageSources.push(attachedMessageSource);
						attachedMessageSource = `${attachedMessageSource}#attachments/thread-${familyKey}-level-${depth + 1}.eml`;
					}
				}
			}
		}
	});

	it('preserves arbitrary nested recovered pst sibling branches within one mailbox family without depth-specific handling', async () => {
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const branchKeys = RECOVERED_PST_BRANCH_KEYS;
		const messageCount = 3;
		const depthCount = 3;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-generated-attached-sibling-${ordinal}@example.com>`;
			const replyTo =
				ordinal > 1
					? `<pst-generated-attached-sibling-${ordinal - 1}@example.com>`
					: undefined;
			const descendantBlocks = familyKeys.flatMap((familyKey) =>
				branchKeys.flatMap((branchKey) => [
					`Attachment: thread-${familyKey}-${branchKey}-level-1.eml`,
					'Attachment-Content-Type: message/rfc822',
					'Attachment-Transfer-Encoding: base64',
					`Attachment-Data: ${Buffer.from(
						buildRecoveredPstNestedAttachedEmail({
							branchKey,
							depth: 1,
							familyKey,
							maxDepth: depthCount,
							messageIdPrefix: 'pst-generated-attached',
							ordinal,
							parentMessageId: messageId
						}),
						'utf8'
					).toString('base64')}`
				])
			);

			return buildRecoveredPstMailboxMessage({
				attachments: familyKeys.flatMap((familyKey) =>
					branchKeys.map((branchKey) => ({
						content: buildRecoveredPstNestedAttachedEmail({
							branchKey,
							depth: 1,
							familyKey,
							maxDepth: depthCount,
							messageIdPrefix: 'pst-generated-attached',
							ordinal,
							parentMessageId: messageId
						}),
						contentType: 'message/rfc822',
						name: `thread-${familyKey}-${branchKey}-level-1.eml`
					}))
				),
				bodyLines: [
					`Generated PST nested sibling root body ${ordinal}.`
				],
				folder: ['Ops', 'Recovered', `NestedSiblingCase${ordinal}`],
				from: `pst-generated-sibling-${ordinal}@example.com`,
				inReplyTo: replyTo,
				messageId,
				references:
					typeof replyTo === 'string'
						? `${replyTo} ${messageId}`
						: undefined,
				stateFlags: recoveredPstStateFlags(ordinal),
				subject: `PST nested sibling generated ${ordinal}`
			});
		}).join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-generated-attached-sibling.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			messageCount * familyKeys.length * branchKeys.length * depthCount
		);
		for (let ordinal = 1; ordinal <= messageCount; ordinal += 1) {
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			const rootMessageId = `<pst-generated-attached-sibling-${ordinal}@example.com>`;
			const rootMessageSource = `recoverable-generated-attached-sibling.pst#messages/${ordinal}`;
			for (const familyKey of familyKeys) {
				for (const branchKey of branchKeys) {
					let attachedMessageSource = `${rootMessageSource}#attachments/thread-${familyKey}-${branchKey}-level-1.eml`;
					const expectedLineageAttachmentSources: string[] = [];
					const expectedLineageMessageIds: string[] = [rootMessageId];
					const expectedLineageSources: string[] = [
						rootMessageSource
					];
					for (let depth = 1; depth <= depthCount; depth += 1) {
						const messageId = `<pst-generated-attached-${ordinal}-${familyKey}-${branchKey}-level-${depth}@example.com>`;
						expectedLineageAttachmentSources.push(
							attachedMessageSource
						);
						const attachedMessage = loaded.documents.find(
							(document) =>
								document.metadata?.messageId === messageId &&
								document.source === attachedMessageSource
						);
						const attachedArchiveDescendant = loaded.documents.find(
							(document) =>
								document.source ===
								`${attachedMessageSource}#attachments/nested-${familyKey}-${branchKey}-level-${depth}.zip#docs/${familyKey}-${branchKey}-level-${depth}.md`
						);

						expect(attachedMessage?.metadata).toMatchObject({
							...(depth === 1
								? {
										attachmentRecoveredFromMailboxContainer:
											true,
										emailAttachmentRole: 'attached_message'
									}
								: {}),
							emailAttachmentSource: attachedMessageSource,
							emailKind: 'message',
							emailMailboxContainerSource:
								'recoverable-generated-attached-sibling.pst',
							emailMailboxFamilyKey:
								`ops/recovered/nestedsiblingcase${ordinal}`.toLowerCase(),
							emailMailboxFormat: 'pst',
							emailMailboxMessageOrdinal: ordinal,
							emailMailboxStateFlags: expectedStateFlags,
							emailMessageDepth: depth,
							emailMessageLineageAttachmentSources:
								expectedLineageAttachmentSources,
							emailMessageLineageCount: depth,
							emailMessageLineageMessageIds:
								expectedLineageMessageIds,
							emailMessageLineageSources: expectedLineageSources,
							emailMessageSource: attachedMessageSource,
							emailMessageSourceKind: 'attached_message'
						});
						expect(
							attachedArchiveDescendant?.metadata
						).toMatchObject({
							emailAttachmentSource: `${attachedMessageSource}#attachments/nested-${familyKey}-${branchKey}-level-${depth}.zip`,
							emailMailboxContainerSource:
								'recoverable-generated-attached-sibling.pst',
							emailMailboxFamilyKey:
								`ops/recovered/nestedsiblingcase${ordinal}`.toLowerCase(),
							emailMailboxMessageOrdinal: ordinal,
							emailMailboxStateFlags: expectedStateFlags,
							emailMessageLineageAttachmentSources:
								expectedLineageAttachmentSources,
							emailMessageLineageCount: depth,
							emailMessageSource: attachedMessageSource,
							emailMessageSourceKind: 'attached_message'
						});
						expect(attachedArchiveDescendant?.text).toContain(
							`Recovered PST nested attached ${familyKey} ${branchKey} text ${ordinal} depth ${depth}`
						);

						if (depth < depthCount) {
							expectedLineageMessageIds.push(messageId);
							expectedLineageSources.push(attachedMessageSource);
							attachedMessageSource = `${attachedMessageSource}#attachments/thread-${familyKey}-${branchKey}-level-${depth + 1}.eml`;
						}
					}
				}
			}
		}
	});

	it('preserves arbitrary recovered pst attached-message sibling replies across mailbox messages without depth-specific handling', async () => {
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const messageCount = 3;
		const replyCount = 3;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-generated-sibling-root-${ordinal}@example.com>`;
			const replyTo =
				ordinal > 1
					? `<pst-generated-sibling-root-${ordinal - 1}@example.com>`
					: undefined;
			const descendantBlocks = familyKeys.flatMap((familyKey) => {
				const parentMessageId = `<pst-generated-sibling-parent-${ordinal}-${familyKey}@example.com>`;
				return [
					`Attachment: thread-${familyKey}-parent.eml`,
					'Attachment-Content-Type: message/rfc822',
					'Attachment-Transfer-Encoding: base64',
					`Attachment-Data: ${Buffer.from(
						buildRecoveredPstReplyParentEmail({
							familyKey,
							ordinal,
							parentMessageId,
							replyCount
						}),
						'utf8'
					).toString('base64')}`
				];
			});

			return buildRecoveredPstMailboxMessage({
				attachments: familyKeys.map((familyKey) => {
					const parentMessageId = `<pst-generated-sibling-parent-${ordinal}-${familyKey}@example.com>`;
					return {
						content: buildRecoveredPstReplyParentEmail({
							familyKey,
							ordinal,
							parentMessageId,
							replyCount
						}),
						contentType: 'message/rfc822',
						name: `thread-${familyKey}-parent.eml`
					};
				}),
				bodyLines: [
					`Generated PST sibling reply root body ${ordinal}.`
				],
				folder: ['Ops', 'Recovered', `SiblingReplyCase${ordinal}`],
				from: `pst-generated-sibling-${ordinal}@example.com`,
				inReplyTo: replyTo,
				messageId,
				references:
					typeof replyTo === 'string'
						? `${replyTo} ${messageId}`
						: undefined,
				stateFlags: recoveredPstStateFlags(ordinal),
				subject: `PST sibling reply generated ${ordinal}`
			});
		}).join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-generated-sibling-replies.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			messageCount * familyKeys.length * (replyCount + 1)
		);
		for (let ordinal = 1; ordinal <= messageCount; ordinal += 1) {
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			const rootMessageSource = recoveredPstMessageSource({
				containerSource: 'recoverable-generated-sibling-replies.pst',
				ordinal
			});
			for (const familyKey of familyKeys) {
				const parentMessageId = `<pst-generated-sibling-parent-${ordinal}-${familyKey}@example.com>`;
				const parentMessageSource = `${rootMessageSource}#attachments/thread-${familyKey}-parent.eml`;
				for (
					let replyOrdinal = 1;
					replyOrdinal <= replyCount;
					replyOrdinal += 1
				) {
					const replyMessageId = `<pst-generated-sibling-reply-${ordinal}-${familyKey}-${replyOrdinal}@example.com>`;
					const replyMessageSource = `${parentMessageSource}#attachments/reply-${familyKey}-${replyOrdinal}.eml`;
					const replyMessage = loaded.documents.find(
						(document) =>
							document.metadata?.messageId === replyMessageId &&
							document.source === replyMessageSource
					);
					const replyArchiveDescendant = loaded.documents.find(
						(document) =>
							document.source ===
							`${replyMessageSource}#attachments/nested-${familyKey}-reply-${replyOrdinal}.zip#docs/${familyKey}-reply-${replyOrdinal}.md`
					);

					expect(replyMessage?.metadata).toMatchObject({
						emailAttachmentSource: replyMessageSource,
						emailKind: 'message',
						emailMailboxContainerSource:
							'recoverable-generated-sibling-replies.pst',
						emailMailboxFamilyKey:
							`ops/recovered/siblingreplycase${ordinal}`.toLowerCase(),
						emailMailboxFormat: 'pst',
						emailMailboxMessageOrdinal: ordinal,
						emailMailboxStateFlags: expectedStateFlags,
						emailMessageDepth: 2,
						emailMessageLineageAttachmentSources: [
							parentMessageSource,
							replyMessageSource
						],
						emailMessageLineageCount: 2,
						emailMessageLineageMessageIds: [
							`<pst-generated-sibling-root-${ordinal}@example.com>`,
							parentMessageId
						],
						emailMessageLineageSources: [
							rootMessageSource,
							parentMessageSource
						],
						emailMessageSource: replyMessageSource,
						emailMessageSourceKind: 'attached_message',
						emailReplyParentLoaded: true,
						emailReplyParentMessageId: parentMessageId,
						emailReplyParentSource: parentMessageSource,
						emailReplySiblingCount: replyCount,
						emailReplySiblingIndex: replyOrdinal - 1,
						emailReplySiblingOrdinal: replyOrdinal,
						emailReplySiblingParentMessageId: parentMessageId,
						emailReplySiblingMessageIds: Array.from(
							{ length: replyCount },
							(_, siblingIndex) =>
								`<pst-generated-sibling-reply-${ordinal}-${familyKey}-${siblingIndex + 1}@example.com>`
						),
						emailReplySiblingSources: Array.from(
							{ length: replyCount },
							(_, siblingIndex) =>
								`${parentMessageSource}#attachments/reply-${familyKey}-${siblingIndex + 1}.eml`
						)
					});
					expect(replyArchiveDescendant?.metadata).toMatchObject({
						emailAttachmentSource: `${replyMessageSource}#attachments/nested-${familyKey}-reply-${replyOrdinal}.zip`,
						emailMailboxContainerSource:
							'recoverable-generated-sibling-replies.pst',
						emailMailboxFamilyKey:
							`ops/recovered/siblingreplycase${ordinal}`.toLowerCase(),
						emailMailboxMessageOrdinal: ordinal,
						emailMailboxStateFlags: expectedStateFlags,
						emailMessageLineageAttachmentSources: [
							parentMessageSource,
							replyMessageSource
						],
						emailMessageLineageCount: 2,
						emailMessageSource: replyMessageSource,
						emailMessageSourceKind: 'attached_message'
					});
					expect(replyArchiveDescendant?.text).toContain(
						`Recovered PST attached reply ${familyKey} text ${ordinal} reply ${replyOrdinal}`
					);
				}
			}
		}
	});

	it('preserves arbitrary recovered pst forwarded reply siblings across mailbox messages without depth-specific handling', async () => {
		const familyKeys = RECOVERED_PST_FAMILY_KEYS;
		const messageCount = 3;
		const replyCount = 3;
		const pstContent = Array.from({ length: messageCount }, (_, index) => {
			const ordinal = index + 1;
			const messageId = `<pst-generated-forwarded-sibling-root-${ordinal}@example.com>`;
			const replyTo =
				ordinal > 1
					? `<pst-generated-forwarded-sibling-root-${ordinal - 1}@example.com>`
					: undefined;
			const descendantBlocks = familyKeys.flatMap((familyKey) => {
				const parentMessageId = `<pst-generated-forwarded-sibling-parent-${ordinal}-${familyKey}@example.com>`;
				return [
					`Attachment: thread-${familyKey}-forwarded-parent.eml`,
					'Attachment-Content-Type: message/rfc822',
					'Attachment-Transfer-Encoding: base64',
					`Attachment-Data: ${Buffer.from(
						buildRecoveredPstReplyParentEmail({
							familyKey,
							ordinal,
							parentMessageId,
							replyCount,
							forwarded: true
						}),
						'utf8'
					).toString('base64')}`
				];
			});

			return buildRecoveredPstMailboxMessage({
				attachments: familyKeys.map((familyKey) => {
					const parentMessageId = `<pst-generated-forwarded-sibling-parent-${ordinal}-${familyKey}@example.com>`;
					return {
						content: buildRecoveredPstReplyParentEmail({
							familyKey,
							forwarded: true,
							ordinal,
							parentMessageId,
							replyCount
						}),
						contentType: 'message/rfc822',
						name: `thread-${familyKey}-forwarded-parent.eml`
					};
				}),
				bodyLines: [
					`Generated PST forwarded sibling reply root body ${ordinal}.`
				],
				folder: [
					'Ops',
					'Recovered',
					`ForwardedSiblingReplyCase${ordinal}`
				],
				from: `pst-generated-forwarded-sibling-${ordinal}@example.com`,
				inReplyTo: replyTo,
				messageId,
				references:
					typeof replyTo === 'string'
						? `${replyTo} ${messageId}`
						: undefined,
				stateFlags: recoveredPstStateFlags(ordinal),
				subject: `PST forwarded sibling reply generated ${ordinal}`
			});
		}).join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-generated-forwarded-sibling-replies.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			messageCount * familyKeys.length * (replyCount + 1)
		);
		for (let ordinal = 1; ordinal <= messageCount; ordinal += 1) {
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			const rootMessageSource = recoveredPstMessageSource({
				containerSource:
					'recoverable-generated-forwarded-sibling-replies.pst',
				ordinal
			});
			for (const familyKey of familyKeys) {
				const parentMessageId = `<pst-generated-forwarded-sibling-parent-${ordinal}-${familyKey}@example.com>`;
				const parentMessageSource = `${rootMessageSource}#attachments/thread-${familyKey}-forwarded-parent.eml`;
				for (
					let replyOrdinal = 1;
					replyOrdinal <= replyCount;
					replyOrdinal += 1
				) {
					const replyMessageId = `<pst-generated-forwarded-reply-${ordinal}-${familyKey}-${replyOrdinal}@example.com>`;
					const replyMessageSource = `${parentMessageSource}#attachments/forwarded-reply-${familyKey}-${replyOrdinal}.eml`;
					const replyMessage = loaded.documents.find(
						(document) =>
							document.metadata?.messageId === replyMessageId &&
							document.source === replyMessageSource
					);
					const replyArchiveDescendant = loaded.documents.find(
						(document) =>
							document.source ===
							`${replyMessageSource}#attachments/nested-${familyKey}-forwarded-reply-${replyOrdinal}.zip#docs/${familyKey}-forwarded-reply-${replyOrdinal}.md`
					);

					expect(replyMessage?.metadata).toMatchObject({
						emailAttachmentSource: replyMessageSource,
						emailForwardedChainCount: 2,
						emailForwardedFromAddress: `forwarded-${familyKey}-${replyOrdinal}@example.com`,
						emailForwardedSubject: `Forwarded ${familyKey} review ${replyOrdinal}`,
						emailKind: 'message',
						emailMailboxContainerSource:
							'recoverable-generated-forwarded-sibling-replies.pst',
						emailMailboxFamilyKey:
							`ops/recovered/forwardedsiblingreplycase${ordinal}`.toLowerCase(),
						emailMailboxFormat: 'pst',
						emailMailboxMessageOrdinal: ordinal,
						emailMailboxStateFlags: expectedStateFlags,
						emailMessageDepth: 2,
						emailMessageLineageAttachmentSources: [
							parentMessageSource,
							replyMessageSource
						],
						emailMessageLineageCount: 2,
						emailMessageLineageMessageIds: [
							`<pst-generated-forwarded-sibling-root-${ordinal}@example.com>`,
							parentMessageId
						],
						emailMessageLineageSources: [
							rootMessageSource,
							parentMessageSource
						],
						emailMessageSource: replyMessageSource,
						emailMessageSourceKind: 'attached_message',
						emailReplyParentLoaded: true,
						emailReplyParentMessageId: parentMessageId,
						emailReplyParentSource: parentMessageSource,
						emailReplySiblingCount: replyCount,
						emailReplySiblingIndex: replyOrdinal - 1,
						emailReplySiblingOrdinal: replyOrdinal,
						emailReplySiblingParentMessageId: parentMessageId
					});
					expect(replyArchiveDescendant?.metadata).toMatchObject({
						emailAttachmentSource: `${replyMessageSource}#attachments/nested-${familyKey}-forwarded-reply-${replyOrdinal}.zip`,
						emailMailboxContainerSource:
							'recoverable-generated-forwarded-sibling-replies.pst',
						emailMailboxFamilyKey:
							`ops/recovered/forwardedsiblingreplycase${ordinal}`.toLowerCase(),
						emailMailboxMessageOrdinal: ordinal,
						emailMailboxStateFlags: expectedStateFlags,
						emailMessageLineageAttachmentSources: [
							parentMessageSource,
							replyMessageSource
						],
						emailMessageLineageCount: 2,
						emailMessageSource: replyMessageSource,
						emailMessageSourceKind: 'attached_message'
					});
					expect(replyArchiveDescendant?.text).toContain(
						`Recovered PST forwarded attached reply ${familyKey} text ${ordinal} reply ${replyOrdinal}`
					);
				}
			}
		}
	});

	it('preserves replicated recovered pst descendant family names across mailbox branches without collapsing mailbox-local scope', async () => {
		const branchKeys = RECOVERED_PST_CASE_KEYS.slice(0, 3);
		const sharedAttachmentName = 'shared-guide.zip';
		const sharedDocPath = 'docs/guide.md';
		const pstContent = branchKeys
			.flatMap((branchKey, index) => {
				const ordinal = index + 1;
				const messageId = `<pst-replicated-${branchKey}@example.com>`;
				const nestedArchive = createStoredZip({
					[sharedDocPath]: `# Shared guide\n\nRecovered PST shared descendant text for ${branchKey}`
				});
				return [
					buildRecoveredPstMailboxMessage({
						attachments: [
							{
								content: nestedArchive,
								contentType: 'application/zip',
								name: sharedAttachmentName
							}
						],
						bodyLines: [`Replicated PST root body ${branchKey}.`],
						folder: ['Ops', 'Recovered', branchKey],
						from: `${branchKey}@example.com`,
						messageId,
						stateFlags: recoveredPstStateFlags(ordinal),
						subject: `PST replicated ${branchKey}`
					}),
					''
				];
			})
			.join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: Buffer.from(pstContent, 'utf8').toString('base64'),
					encoding: 'base64',
					name: 'recoverable-replicated.pst'
				}
			]
		});

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			branchKeys.length * 2
		);
		for (const [index, branchKey] of branchKeys.entries()) {
			const ordinal = index + 1;
			const expectedStateFlags = recoveredPstStateFlags(ordinal);
			const descendant = loaded.documents.find(
				(document) =>
					document.source ===
					`${recoveredPstMessageAttachmentSource({
						attachmentName: sharedAttachmentName,
						containerSource: 'recoverable-replicated.pst',
						ordinal
					})}#${sharedDocPath}`
			);

			expect(descendant?.metadata).toMatchObject({
				attachmentRecoveredFromMailboxContainer: true,
				emailAttachmentRole: 'file_attachment',
				emailAttachmentSource: recoveredPstMessageAttachmentSource({
					attachmentName: sharedAttachmentName,
					containerSource: 'recoverable-replicated.pst',
					ordinal
				}),
				...buildRecoveredPstMailboxMetadata({
					caseKey: branchKey,
					containerSource: 'recoverable-replicated.pst',
					ordinal,
					stateFlags: expectedStateFlags
				})
			});
			expect(descendant?.text).toContain(
				`Recovered PST shared descendant text for ${branchKey}`
			);
		}
	});

	it('preserves replicated recovered descendant family names across multiple mailbox containers without collapsing container-local scope', async () => {
		const containerSpecs = [
			{
				expectedStateFlags: ['flagged', 'read'],
				familyKey: 'ops/recovered/shared',
				fileName: 'shared-lantern.pst',
				formatLabel: 'pst',
				messageId: '<shared-lantern@example.com>',
				sourceKey: 'lantern'
			},
			{
				expectedStateFlags: ['passed', 'unread'],
				familyKey: 'ops/recovered/shared',
				fileName: 'shared-quartz.ost',
				formatLabel: 'ost',
				messageId: '<shared-quartz@example.com>',
				sourceKey: 'quartz'
			}
		] as const;
		const sharedAttachmentName = 'shared-guide.zip';
		const sharedDocPath = 'docs/guide.md';

		const uploads = containerSpecs.map((spec) => {
			const nestedArchive = createStoredZip({
				[sharedDocPath]: `# Shared guide\n\nRecovered shared descendant text for ${spec.sourceKey}`
			});
			const content = [
				'Folder: Ops/Recovered/Shared',
				`Flags: ${spec.expectedStateFlags.join(' ')}`,
				`Attachment: ${sharedAttachmentName}`,
				'Attachment-Content-Type: application/zip',
				'Attachment-Transfer-Encoding: base64',
				`Attachment-Data: ${Buffer.from(nestedArchive).toString('base64')}`,
				`Subject: Shared ${spec.formatLabel} descendant`,
				`From: ${spec.sourceKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${spec.messageId}`,
				'',
				`Shared ${spec.formatLabel} mailbox root for ${spec.sourceKey}.`
			].join('\n');
			return {
				content: Buffer.from(content, 'utf8').toString('base64'),
				encoding: 'base64' as const,
				name: spec.fileName
			};
		});

		const loaded = await loadRAGDocumentsFromUploads({ uploads });

		expect(loaded.documents.length).toBeGreaterThanOrEqual(
			containerSpecs.length * 2
		);
		for (const spec of containerSpecs) {
			const descendant = loaded.documents.find(
				(document) =>
					document.source ===
					`${spec.fileName}#messages/1#attachments/${sharedAttachmentName}#${sharedDocPath}`
			);

			expect(descendant?.metadata).toMatchObject({
				attachmentRecoveredFromMailboxContainer: true,
				emailAttachmentRole: 'file_attachment',
				emailAttachmentSource: `${spec.fileName}#messages/1#attachments/${sharedAttachmentName}`,
				emailMailboxContainerSource: spec.fileName,
				emailMailboxFamilyKey: spec.familyKey,
				emailMailboxFormat: spec.formatLabel,
				emailMailboxMessageOrdinal: 1,
				emailMailboxStateFlags: spec.expectedStateFlags
			});
			expect(descendant?.text).toContain(
				`Recovered shared descendant text for ${spec.sourceKey}`
			);
		}
	});

	it('preserves replicated descendant family names across arbitrary mailbox container formats without collapsing format-local scope', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-containers-')
		);
		const sharedAttachmentName = 'shared-guide.zip';
		const sharedDocPath = 'docs/guide.md';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const containerSpecs = [
			{
				containerSource: 'shared-lantern.pst',
				expectedSource:
					'shared-lantern.pst#messages/1#attachments/shared-guide.zip#docs/guide.md',
				fileName: 'shared-lantern.pst',
				formatLabel: 'pst',
				messageOrdinal: 1,
				sourceKey: 'lantern',
				stateFlags: ['flagged', 'read']
			},
			{
				containerSource: 'shared-quartz.ost',
				expectedSource:
					'shared-quartz.ost#messages/1#attachments/shared-guide.zip#docs/guide.md',
				fileName: 'shared-quartz.ost',
				formatLabel: 'ost',
				messageOrdinal: 1,
				sourceKey: 'quartz',
				stateFlags: ['passed', 'unread']
			},
			{
				containerSource: 'shared-thread.mbox',
				expectedSource:
					'shared-thread.mbox#messages/1#attachments/shared-guide.zip#docs/guide.md',
				fileName: 'shared-thread.mbox',
				formatLabel: 'mbox',
				messageOrdinal: 1,
				sourceKey: 'ember',
				stateFlags: [] as string[]
			},
			{
				containerSource: 'shared-apple.emlx',
				expectedSource:
					'shared-apple.emlx#attachments/shared-guide.zip#docs/guide.md',
				fileName: 'shared-apple.emlx',
				formatLabel: 'emlx',
				messageOrdinal: 1,
				sourceKey: 'fable',
				stateFlags: [] as string[]
			},
			{
				containerSource: familySegments.join('/'),
				expectedSource:
					'Ops/Recovered/Shared/cur/1713890004.M4P4.mailhost:2,FS#attachments/shared-guide.zip#docs/guide.md',
				fileName: '1713890004.M4P4.mailhost:2,FS',
				formatLabel: 'maildir',
				messageOrdinal: 1,
				sourceKey: 'glyph',
				stateFlags: ['flagged', 'read']
			}
		] as const;

		try {
			for (const spec of containerSpecs) {
				const nestedArchive = createStoredZip({
					[sharedDocPath]: `# Shared guide\n\nMixed mailbox descendant text for ${spec.sourceKey}`
				});
				const attachmentPayload =
					Buffer.from(nestedArchive).toString('base64');
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							`Attachment: ${sharedAttachmentName}`,
							'Attachment-Content-Type: application/zip',
							'Attachment-Transfer-Encoding: base64',
							`Attachment-Data: ${attachmentPayload}`,
							`Subject: Shared ${spec.formatLabel} descendant`,
							`From: ${spec.sourceKey}@example.com`,
							'To: ops@example.com',
							`Message-ID: <${spec.sourceKey}-${spec.formatLabel}@example.com>`,
							'',
							`Shared ${spec.formatLabel} mailbox root for ${spec.sourceKey}.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const rawMessage = [
					`Subject: Shared ${spec.formatLabel} descendant`,
					`From: ${spec.sourceKey}@example.com`,
					'To: ops@example.com',
					`Message-ID: <${spec.sourceKey}-${spec.formatLabel}@example.com>`,
					'Content-Type: multipart/mixed; boundary="shared-boundary"',
					'',
					'--shared-boundary',
					'Content-Type: text/plain; charset=utf-8',
					'',
					`Shared ${spec.formatLabel} mailbox root for ${spec.sourceKey}.`,
					'--shared-boundary',
					`Content-Type: application/zip; name="${sharedAttachmentName}"`,
					`Content-Disposition: attachment; filename="${sharedAttachmentName}"`,
					'Content-Transfer-Encoding: base64',
					'',
					attachmentPayload,
					'--shared-boundary--'
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.sourceKey}@example.com Tue Apr 21 09:00:00 2026`,
							rawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(Buffer.byteLength(rawMessage, 'utf8')),
							rawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					rawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-mixed-containers-temp' },
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of containerSpecs) {
				const descendant = loaded.documents.find(
					(document) =>
						document.metadata?.emailMailboxFormat ===
							spec.formatLabel &&
						document.text.includes(
							`Mixed mailbox descendant text for ${spec.sourceKey}`
						)
				);

				expect(descendant?.source).toContain(sharedAttachmentName);
				expect(descendant?.source).toContain(sharedDocPath);
				expect(descendant?.metadata).toMatchObject({
					emailMailboxContainerSource: spec.containerSource,
					emailMailboxFormat: spec.formatLabel
				});
				expect(
					String(descendant?.metadata?.emailAttachmentSource)
				).toContain(sharedAttachmentName);
				if (spec.formatLabel !== 'maildir') {
					expect(descendant?.metadata).toMatchObject({
						emailMailboxMessageOrdinal: spec.messageOrdinal
					});
				}
				if (spec.formatLabel === 'maildir') {
					expect(descendant?.metadata).toMatchObject({
						emailMailboxFamilyKey: 'ops/recovered/shared',
						emailMailboxStateFlags: spec.stateFlags
					});
				}
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					expect(descendant?.metadata).toMatchObject({
						attachmentRecoveredFromMailboxContainer: true,
						emailMailboxFamilyKey: 'ops/recovered/shared',
						emailMailboxStateFlags: spec.stateFlags
					});
				}
				expect(descendant?.text).toContain(
					`Mixed mailbox descendant text for ${spec.sourceKey}`
				);
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('reconstructs shared loaded email threads across arbitrary mailbox container formats without collapsing unrelated container scope', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-thread-')
		);
		const rootMessageId = '<mixed-format-root@example.com>';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const replySpecs = [
			{
				expectedSource: 'thread-pst.pst#messages/1',
				fileName: 'thread-pst.pst',
				formatLabel: 'pst',
				messageId: '<mixed-format-pst@example.com>',
				stateFlags: ['flagged', 'read']
			},
			{
				expectedSource: 'thread-ost.ost#messages/1',
				fileName: 'thread-ost.ost',
				formatLabel: 'ost',
				messageId: '<mixed-format-ost@example.com>',
				stateFlags: ['passed', 'unread']
			},
			{
				expectedSource: 'thread.mbox#messages/1',
				fileName: 'thread.mbox',
				formatLabel: 'mbox',
				messageId: '<mixed-format-mbox@example.com>',
				stateFlags: [] as string[]
			},
			{
				expectedSource:
					'Ops/Recovered/Shared/cur/1713890010.M10P10.mailhost:2,FS',
				fileName: '1713890010.M10P10.mailhost:2,FS',
				formatLabel: 'maildir',
				messageId: '<mixed-format-maildir@example.com>',
				stateFlags: ['flagged', 'read']
			}
		] as const;
		const expectedSources = [
			'root.emlx',
			...replySpecs.map((spec) => spec.expectedSource)
		].sort();

		try {
			const rootRawMessage = [
				'Subject: Mixed container shared thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root shared thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							'Subject: Mixed container shared thread',
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: ${spec.messageId}`,
							`In-Reply-To: ${rootMessageId}`,
							`References: ${rootMessageId} ${spec.messageId}`,
							'',
							`${spec.formatLabel} shared reply body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const rawMessage = [
					'Subject: Mixed container shared thread',
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${spec.messageId}`,
					`In-Reply-To: ${rootMessageId}`,
					`References: ${rootMessageId} ${spec.messageId}`,
					'',
					`${spec.formatLabel} shared reply body.`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							rawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					rawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-mixed-thread-temp' },
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			const rootDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId === rootMessageId &&
					document.metadata?.emailKind === 'message'
			);

			expect(rootDocument?.metadata).toMatchObject({
				emailMailboxContainerSource: 'root.emlx',
				emailMailboxFormat: 'emlx',
				threadLoadedMessageCount: replySpecs.length + 1
			});
			expect(
				[
					...(rootDocument?.metadata
						?.threadLoadedMessageSources as string[])
				].sort()
			).toEqual(expectedSources);

			for (const spec of replySpecs) {
				const document = loaded.documents.find(
					(entry) =>
						entry.metadata?.messageId === spec.messageId &&
						entry.metadata?.emailKind === 'message'
				);

				expect(document?.source).toBe(spec.expectedSource);
				expect(document?.metadata).toMatchObject({
					emailMailboxContainerSource:
						spec.formatLabel === 'maildir'
							? familySegments.join('/')
							: spec.fileName,
					emailMailboxFormat: spec.formatLabel,
					emailReplyParentLoaded: true,
					emailReplyParentMessageId: rootMessageId,
					threadLoadedMessageCount: replySpecs.length + 1
				});
				if (spec.formatLabel === 'maildir') {
					expect(document?.metadata).toMatchObject({
						emailMailboxFamilyKey: 'ops/recovered/shared',
						emailMailboxStateFlags: spec.stateFlags
					});
				}
				expect(
					[
						...(document?.metadata
							?.threadLoadedMessageSources as string[])
					].sort()
				).toEqual(expectedSources);
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('tracks sibling reply ordinals across arbitrary mailbox container formats on one shared thread', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-siblings-')
		);
		const rootMessageId = '<mixed-format-sibling-root@example.com>';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const replySpecs = [
			{
				expectedSource: 'reply-emlx.emlx',
				fileName: 'reply-emlx.emlx',
				formatLabel: 'emlx',
				messageId: '<mixed-sibling-emlx@example.com>',
				stateFlags: [] as string[]
			},
			{
				expectedSource: 'thread-pst.pst#messages/1',
				fileName: 'thread-pst.pst',
				formatLabel: 'pst',
				messageId: '<mixed-sibling-pst@example.com>',
				stateFlags: ['flagged', 'read']
			},
			{
				expectedSource: 'thread-ost.ost#messages/1',
				fileName: 'thread-ost.ost',
				formatLabel: 'ost',
				messageId: '<mixed-sibling-ost@example.com>',
				stateFlags: ['passed', 'unread']
			},
			{
				expectedSource: 'thread.mbox#messages/1',
				fileName: 'thread.mbox',
				formatLabel: 'mbox',
				messageId: '<mixed-sibling-mbox@example.com>',
				stateFlags: [] as string[]
			},
			{
				expectedSource:
					'Ops/Recovered/Shared/cur/1713890011.M11P11.mailhost:2,FS',
				fileName: '1713890011.M11P11.mailhost:2,FS',
				formatLabel: 'maildir',
				messageId: '<mixed-sibling-maildir@example.com>',
				stateFlags: ['flagged', 'read']
			}
		] as const;
		const orderedSources = replySpecs
			.map((spec) => spec.expectedSource)
			.sort((left, right) => left.localeCompare(right));

		try {
			const rootRawMessage = [
				'Subject: Mixed container sibling thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root sibling thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							'Subject: Mixed container sibling thread',
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: ${spec.messageId}`,
							`In-Reply-To: ${rootMessageId}`,
							`References: ${rootMessageId} ${spec.messageId}`,
							'',
							`${spec.formatLabel} sibling reply body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const rawMessage = [
					'Subject: Mixed container sibling thread',
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${spec.messageId}`,
					`In-Reply-To: ${rootMessageId}`,
					`References: ${rootMessageId} ${spec.messageId}`,
					'',
					`${spec.formatLabel} sibling reply body.`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							rawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(Buffer.byteLength(rawMessage, 'utf8')),
							rawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					rawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-mixed-siblings-temp' },
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of replySpecs) {
				const document = loaded.documents.find(
					(entry) =>
						entry.metadata?.messageId === spec.messageId &&
						entry.metadata?.emailKind === 'message'
				);
				const expectedIndex = orderedSources.indexOf(
					spec.expectedSource
				);

				expect(document?.source).toBe(spec.expectedSource);
				expect(document?.metadata).toMatchObject({
					emailReplySiblingCount: replySpecs.length,
					emailReplySiblingIndex: expectedIndex,
					emailReplySiblingOrdinal: expectedIndex + 1,
					emailReplySiblingParentMessageId: rootMessageId,
					emailReplySiblingSources: orderedSources
				});
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves attached-message descendants across arbitrary mailbox container formats on one shared sibling thread', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-descendants-')
		);
		const rootMessageId = '<mixed-format-descendant-root@example.com>';
		const sharedAttachmentName = 'shared-guide.zip';
		const sharedDocPath = 'docs/guide.md';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const replySpecs = [
			{
				containerSource: 'reply-emlx.emlx',
				expectedChildSource:
					'reply-emlx.emlx#attachments/shared-child.eml',
				fileName: 'reply-emlx.emlx',
				formatLabel: 'emlx',
				stateFlags: [] as string[]
			},
			{
				containerSource: 'thread-pst.pst',
				expectedChildSource:
					'thread-pst.pst#messages/1#attachments/shared-child.eml',
				fileName: 'thread-pst.pst',
				formatLabel: 'pst',
				stateFlags: ['flagged', 'read'] as string[]
			},
			{
				containerSource: 'thread-ost.ost',
				expectedChildSource:
					'thread-ost.ost#messages/1#attachments/shared-child.eml',
				fileName: 'thread-ost.ost',
				formatLabel: 'ost',
				stateFlags: ['passed', 'unread'] as string[]
			},
			{
				containerSource: 'thread.mbox',
				expectedChildSource:
					'thread.mbox#messages/1#attachments/shared-child.eml',
				fileName: 'thread.mbox',
				formatLabel: 'mbox',
				stateFlags: [] as string[]
			},
			{
				containerSource: familySegments.join('/'),
				expectedChildSource:
					'Ops/Recovered/Shared/cur/1713890012.M12P12.mailhost:2,FS#attachments/shared-child.eml',
				fileName: '1713890012.M12P12.mailhost:2,FS',
				formatLabel: 'maildir',
				stateFlags: ['flagged', 'read'] as string[]
			}
		] as const;
		const orderedSources = replySpecs
			.map((spec) => spec.expectedChildSource)
			.sort((left, right) => left.localeCompare(right));
		const expectedThreadSources = ['root.emlx', ...orderedSources].sort(
			(left, right) => left.localeCompare(right)
		);

		const buildAttachedChildEmail = (spec: (typeof replySpecs)[number]) => {
			const nestedArchive = createStoredZip({
				[sharedDocPath]: `# Shared guide\n\nMixed descendant archive text for ${spec.formatLabel}`
			});
			const childMessageId = `<mixed-descendant-${spec.formatLabel}@example.com>`;
			return {
				childMessageId,
				raw: [
					`Subject: Mixed container descendant thread`,
					`From: child-${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${childMessageId}`,
					`In-Reply-To: ${rootMessageId}`,
					`References: ${rootMessageId} ${childMessageId}`,
					`Content-Type: multipart/mixed; boundary="mixed-descendant-${spec.formatLabel}"`,
					'',
					`--mixed-descendant-${spec.formatLabel}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} local attached child summary.`,
					'',
					'---------- Forwarded message ----------',
					`From: forwarded-${spec.formatLabel}@example.com`,
					'Date: Tue, Apr 21, 2026 at 9:15 AM',
					`Subject: Forwarded ${spec.formatLabel} child history`,
					'To: ops@example.com',
					'',
					'---------- Forwarded message ----------',
					`From: forwarded-${spec.formatLabel}-prior@example.com`,
					'Date: Tue, Apr 21, 2026 at 8:00 AM',
					`Subject: Prior forwarded ${spec.formatLabel} child history`,
					'To: ops@example.com',
					`--mixed-descendant-${spec.formatLabel}`,
					`Content-Type: application/zip; name="${sharedAttachmentName}"`,
					`Content-Disposition: attachment; filename="${sharedAttachmentName}"`,
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(nestedArchive).toString('base64'),
					`--mixed-descendant-${spec.formatLabel}--`
				].join('\n')
			};
		};

		try {
			const rootRawMessage = [
				'Subject: Mixed container descendant thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root descendant thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				const childEmail = buildAttachedChildEmail(spec);
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							'Attachment: shared-child.eml',
							'Attachment-Content-Type: message/rfc822',
							'Attachment-Transfer-Encoding: base64',
							`Attachment-Data: ${Buffer.from(
								childEmail.raw,
								'utf8'
							).toString('base64')}`,
							`Subject: ${spec.formatLabel} container wrapper`,
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: <mixed-wrapper-${spec.formatLabel}@example.com>`,
							'',
							`${spec.formatLabel} wrapper body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const wrapperRawMessage = [
					`Subject: ${spec.formatLabel} container wrapper`,
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: <mixed-wrapper-${spec.formatLabel}@example.com>`,
					`Content-Type: multipart/mixed; boundary="mixed-wrapper-${spec.formatLabel}"`,
					'',
					`--mixed-wrapper-${spec.formatLabel}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} wrapper body.`,
					`--mixed-wrapper-${spec.formatLabel}`,
					'Content-Type: message/rfc822; name="shared-child.eml"',
					'Content-Disposition: attachment; filename="shared-child.eml"',
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(childEmail.raw, 'utf8').toString('base64'),
					`--mixed-wrapper-${spec.formatLabel}--`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							wrapperRawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(
								Buffer.byteLength(wrapperRawMessage, 'utf8')
							),
							wrapperRawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					wrapperRawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-mixed-descendants-temp' },
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of replySpecs) {
				const childMessageId = `<mixed-descendant-${spec.formatLabel}@example.com>`;
				const childMessage = loaded.documents.find(
					(document) =>
						document.metadata?.messageId === childMessageId &&
						document.source === spec.expectedChildSource
				);
				const childArchiveDescendant = loaded.documents.find(
					(document) =>
						document.source ===
						`${spec.expectedChildSource}#attachments/${sharedAttachmentName}#${sharedDocPath}`
				);
				const expectedIndex = orderedSources.indexOf(
					spec.expectedChildSource
				);

				expect(childMessage?.metadata).toMatchObject({
					emailAttachmentSource: spec.expectedChildSource,
					emailForwardedChainCount: 2,
					emailForwardedFromAddress: `forwarded-${spec.formatLabel}@example.com`,
					emailForwardedSubject: `Forwarded ${spec.formatLabel} child history`,
					emailKind: 'message',
					emailMailboxContainerSource: spec.containerSource,
					emailMailboxFormat: spec.formatLabel,
					emailMessageDepth: 1,
					emailMessageLineageAttachmentSources: [
						spec.expectedChildSource
					],
					emailMessageLineageCount: 1,
					emailMessageSource: spec.expectedChildSource,
					emailMessageSourceKind: 'attached_message',
					emailReplyParentLoaded: true,
					emailReplyParentMessageId: rootMessageId,
					emailReplySiblingCount: replySpecs.length,
					emailReplySiblingIndex: expectedIndex,
					emailReplySiblingOrdinal: expectedIndex + 1,
					emailReplySiblingSources: orderedSources,
					threadLoadedMessageCount: replySpecs.length + 1
				});
				expect(
					childMessage?.metadata?.threadLoadedMessageSources
				).toEqual(expect.arrayContaining(expectedThreadSources));
				expect(childArchiveDescendant?.metadata).toMatchObject({
					emailAttachmentSource: `${spec.expectedChildSource}#attachments/${sharedAttachmentName}`,
					emailMailboxContainerSource: spec.containerSource,
					emailMailboxFormat: spec.formatLabel,
					emailMessageLineageAttachmentSources: [
						spec.expectedChildSource
					],
					emailMessageLineageCount: 1,
					emailMessageSource: spec.expectedChildSource,
					emailMessageSourceKind: 'attached_message',
					threadLoadedMessageCount: replySpecs.length + 1
				});
				expect(
					childArchiveDescendant?.metadata?.threadLoadedMessageSources
				).toEqual(expect.arrayContaining(expectedThreadSources));
				if (spec.formatLabel === 'maildir') {
					expect(childMessage?.metadata).toMatchObject({
						emailMailboxFamilyKey: 'ops/recovered/shared'
					});
					expect(childArchiveDescendant?.metadata).toMatchObject({
						emailMailboxFamilyKey: 'ops/recovered/shared'
					});
				}
				expect(childArchiveDescendant?.text).toContain(
					`Mixed descendant archive text for ${spec.formatLabel}`
				);
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves arbitrary attached-message child branches across mailbox container formats on one shared sibling thread', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-descendant-branches-')
		);
		const rootMessageId =
			'<mixed-format-descendant-branches-root@example.com>';
		const sharedDocPath = 'docs/guide.md';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const branchKeys = ['alpha', 'beta', 'gamma'];
		const replySpecs = [
			{
				containerSource: 'reply-emlx.emlx',
				fileName: 'reply-emlx.emlx',
				formatLabel: 'emlx',
				stateFlags: [] as string[]
			},
			{
				containerSource: 'thread-pst.pst',
				fileName: 'thread-pst.pst',
				formatLabel: 'pst',
				stateFlags: ['flagged', 'read'] as string[]
			},
			{
				containerSource: 'thread-ost.ost',
				fileName: 'thread-ost.ost',
				formatLabel: 'ost',
				stateFlags: ['passed', 'unread'] as string[]
			},
			{
				containerSource: 'thread.mbox',
				fileName: 'thread.mbox',
				formatLabel: 'mbox',
				stateFlags: [] as string[]
			},
			{
				containerSource: familySegments.join('/'),
				fileName: '1713890013.M13P13.mailhost:2,FS',
				formatLabel: 'maildir',
				stateFlags: ['flagged', 'read'] as string[]
			}
		] as const;
		const expectedChildSource = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) =>
			spec.formatLabel === 'emlx'
				? `reply-emlx.emlx#attachments/shared-child-${branchKey}.eml`
				: spec.formatLabel === 'pst'
					? `thread-pst.pst#messages/1#attachments/shared-child-${branchKey}.eml`
					: spec.formatLabel === 'ost'
						? `thread-ost.ost#messages/1#attachments/shared-child-${branchKey}.eml`
						: spec.formatLabel === 'mbox'
							? `thread.mbox#messages/1#attachments/shared-child-${branchKey}.eml`
							: `Ops/Recovered/Shared/cur/1713890013.M13P13.mailhost:2,FS#attachments/shared-child-${branchKey}.eml`;
		const orderedChildSources = replySpecs
			.flatMap((spec) =>
				branchKeys.map((branchKey) =>
					expectedChildSource(spec, branchKey)
				)
			)
			.sort((left, right) => left.localeCompare(right));
		const expectedThreadSources = [
			'root.emlx',
			...orderedChildSources
		].sort((left, right) => left.localeCompare(right));

		const buildAttachedChildEmail = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) => {
			const attachmentName = `shared-guide-${branchKey}.zip`;
			const nestedArchive = createStoredZip({
				[sharedDocPath]: `# Shared guide\n\nMixed descendant branch text for ${spec.formatLabel} ${branchKey}`
			});
			const childMessageId = `<mixed-descendant-${spec.formatLabel}-${branchKey}@example.com>`;
			return {
				attachmentName,
				childMessageId,
				raw: [
					'Subject: Mixed container descendant branches thread',
					`From: child-${spec.formatLabel}-${branchKey}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${childMessageId}`,
					`In-Reply-To: ${rootMessageId}`,
					`References: ${rootMessageId} ${childMessageId}`,
					`Content-Type: multipart/mixed; boundary="mixed-descendant-${spec.formatLabel}-${branchKey}"`,
					'',
					`--mixed-descendant-${spec.formatLabel}-${branchKey}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} ${branchKey} local attached child summary.`,
					'',
					'---------- Forwarded message ----------',
					`From: forwarded-${spec.formatLabel}-${branchKey}@example.com`,
					'Date: Tue, Apr 21, 2026 at 9:15 AM',
					`Subject: Forwarded ${spec.formatLabel} ${branchKey} child history`,
					'To: ops@example.com',
					'',
					'---------- Forwarded message ----------',
					`From: forwarded-${spec.formatLabel}-${branchKey}-prior@example.com`,
					'Date: Tue, Apr 21, 2026 at 8:00 AM',
					`Subject: Prior forwarded ${spec.formatLabel} ${branchKey} child history`,
					'To: ops@example.com',
					`--mixed-descendant-${spec.formatLabel}-${branchKey}`,
					`Content-Type: application/zip; name="${attachmentName}"`,
					`Content-Disposition: attachment; filename="${attachmentName}"`,
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(nestedArchive).toString('base64'),
					`--mixed-descendant-${spec.formatLabel}-${branchKey}--`
				].join('\n')
			};
		};

		try {
			const rootRawMessage = [
				'Subject: Mixed container descendant branches thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root descendant branches thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				const childEmails = branchKeys.map((branchKey) =>
					buildAttachedChildEmail(spec, branchKey)
				);
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							...childEmails.flatMap((child) => [
								`Attachment: shared-child-${child.childMessageId.match(/-(alpha|beta|gamma)@/)?.[1]}.eml`,
								'Attachment-Content-Type: message/rfc822',
								'Attachment-Transfer-Encoding: base64',
								`Attachment-Data: ${Buffer.from(child.raw, 'utf8').toString('base64')}`
							]),
							`Subject: ${spec.formatLabel} container wrapper branches`,
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: <mixed-wrapper-branches-${spec.formatLabel}@example.com>`,
							'',
							`${spec.formatLabel} wrapper body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const wrapperRawMessage = [
					`Subject: ${spec.formatLabel} container wrapper branches`,
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: <mixed-wrapper-branches-${spec.formatLabel}@example.com>`,
					`Content-Type: multipart/mixed; boundary="mixed-wrapper-branches-${spec.formatLabel}"`,
					'',
					`--mixed-wrapper-branches-${spec.formatLabel}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} wrapper body.`,
					...childEmails.flatMap((child) => {
						const branchKey =
							child.childMessageId.match(
								/-(alpha|beta|gamma)@/
							)?.[1] ?? 'child';
						return [
							`--mixed-wrapper-branches-${spec.formatLabel}`,
							`Content-Type: message/rfc822; name="shared-child-${branchKey}.eml"`,
							`Content-Disposition: attachment; filename="shared-child-${branchKey}.eml"`,
							'Content-Transfer-Encoding: base64',
							'',
							Buffer.from(child.raw, 'utf8').toString('base64')
						];
					}),
					`--mixed-wrapper-branches-${spec.formatLabel}--`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							wrapperRawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(
								Buffer.byteLength(wrapperRawMessage, 'utf8')
							),
							wrapperRawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					wrapperRawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-mixed-descendant-branches-temp'
				},
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of replySpecs) {
				for (const branchKey of branchKeys) {
					const childMessageId = `<mixed-descendant-${spec.formatLabel}-${branchKey}@example.com>`;
					const childSource = expectedChildSource(spec, branchKey);
					const childMessage = loaded.documents.find(
						(document) =>
							document.metadata?.messageId === childMessageId &&
							document.source === childSource
					);
					const childArchiveDescendant = loaded.documents.find(
						(document) =>
							document.source ===
							`${childSource}#attachments/shared-guide-${branchKey}.zip#${sharedDocPath}`
					);
					const expectedIndex =
						orderedChildSources.indexOf(childSource);

					expect(childMessage?.metadata).toMatchObject({
						emailAttachmentSource: childSource,
						emailForwardedChainCount: 2,
						emailForwardedFromAddress: `forwarded-${spec.formatLabel}-${branchKey}@example.com`,
						emailForwardedSubject: `Forwarded ${spec.formatLabel} ${branchKey} child history`,
						emailKind: 'message',
						emailMailboxContainerSource: spec.containerSource,
						emailMailboxFormat: spec.formatLabel,
						emailMessageDepth: 1,
						emailMessageLineageAttachmentSources: [childSource],
						emailMessageLineageCount: 1,
						emailMessageSource: childSource,
						emailMessageSourceKind: 'attached_message',
						emailReplyParentLoaded: true,
						emailReplyParentMessageId: rootMessageId,
						emailReplySiblingCount: orderedChildSources.length,
						emailReplySiblingIndex: expectedIndex,
						emailReplySiblingOrdinal: expectedIndex + 1,
						threadLoadedMessageCount: orderedChildSources.length + 1
					});
					expect(
						childMessage?.metadata?.threadLoadedMessageSources
					).toEqual(expect.arrayContaining(expectedThreadSources));
					expect(childArchiveDescendant?.metadata).toMatchObject({
						emailAttachmentSource: `${childSource}#attachments/shared-guide-${branchKey}.zip`,
						emailMailboxContainerSource: spec.containerSource,
						emailMailboxFormat: spec.formatLabel,
						emailMessageLineageAttachmentSources: [childSource],
						emailMessageLineageCount: 1,
						emailMessageSource: childSource,
						emailMessageSourceKind: 'attached_message'
					});
					expect(childArchiveDescendant?.text).toContain(
						`Mixed descendant branch text for ${spec.formatLabel} ${branchKey}`
					);
				}
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves arbitrary nested attached-message child depth across mixed-format child branches on one shared thread', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-descendant-nested-')
		);
		const rootMessageId =
			'<mixed-format-descendant-nested-root@example.com>';
		const sharedDocPath = 'docs/guide.md';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const branchKeys = ['alpha', 'beta', 'gamma'];
		const replySpecs = [
			{
				containerSource: 'reply-emlx.emlx',
				fileName: 'reply-emlx.emlx',
				formatLabel: 'emlx',
				stateFlags: [] as string[]
			},
			{
				containerSource: 'thread-pst.pst',
				fileName: 'thread-pst.pst',
				formatLabel: 'pst',
				stateFlags: ['flagged', 'read'] as string[]
			},
			{
				containerSource: 'thread-ost.ost',
				fileName: 'thread-ost.ost',
				formatLabel: 'ost',
				stateFlags: ['passed', 'unread'] as string[]
			},
			{
				containerSource: 'thread.mbox',
				fileName: 'thread.mbox',
				formatLabel: 'mbox',
				stateFlags: [] as string[]
			},
			{
				containerSource: familySegments.join('/'),
				fileName: '1713890014.M14P14.mailhost:2,FS',
				formatLabel: 'maildir',
				stateFlags: ['flagged', 'read'] as string[]
			}
		] as const;
		const expectedChildSource = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) =>
			spec.formatLabel === 'emlx'
				? `reply-emlx.emlx#attachments/shared-child-${branchKey}.eml`
				: spec.formatLabel === 'pst'
					? `thread-pst.pst#messages/1#attachments/shared-child-${branchKey}.eml`
					: spec.formatLabel === 'ost'
						? `thread-ost.ost#messages/1#attachments/shared-child-${branchKey}.eml`
						: spec.formatLabel === 'mbox'
							? `thread.mbox#messages/1#attachments/shared-child-${branchKey}.eml`
							: `Ops/Recovered/Shared/cur/1713890014.M14P14.mailhost:2,FS#attachments/shared-child-${branchKey}.eml`;
		const expectedNestedSource = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) =>
			`${expectedChildSource(spec, branchKey)}#attachments/nested-child-${branchKey}.eml`;

		const buildBranchEmails = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) => {
			const nestedAttachmentName = `nested-guide-${branchKey}.zip`;
			const nestedArchive = createStoredZip({
				[sharedDocPath]: `# Shared guide\n\nMixed nested descendant text for ${spec.formatLabel} ${branchKey}`
			});
			const topMessageId = `<mixed-descendant-top-${spec.formatLabel}-${branchKey}@example.com>`;
			const nestedMessageId = `<mixed-descendant-deep-${spec.formatLabel}-${branchKey}@example.com>`;
			const nestedRaw = [
				'Subject: Mixed container descendant nested thread',
				`From: nested-${spec.formatLabel}-${branchKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${nestedMessageId}`,
				`In-Reply-To: ${topMessageId}`,
				`References: ${rootMessageId} ${topMessageId} ${nestedMessageId}`,
				`Content-Type: multipart/mixed; boundary="mixed-descendant-deep-${spec.formatLabel}-${branchKey}"`,
				'',
				`--mixed-descendant-deep-${spec.formatLabel}-${branchKey}`,
				'Content-Type: text/plain; charset=utf-8',
				'',
				`${spec.formatLabel} ${branchKey} nested attached child summary.`,
				'',
				'---------- Forwarded message ----------',
				`From: forwarded-deep-${spec.formatLabel}-${branchKey}@example.com`,
				'Date: Tue, Apr 21, 2026 at 9:25 AM',
				`Subject: Forwarded deep ${spec.formatLabel} ${branchKey} child history`,
				'To: ops@example.com',
				`--mixed-descendant-deep-${spec.formatLabel}-${branchKey}`,
				`Content-Type: application/zip; name="${nestedAttachmentName}"`,
				`Content-Disposition: attachment; filename="${nestedAttachmentName}"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(nestedArchive).toString('base64'),
				`--mixed-descendant-deep-${spec.formatLabel}-${branchKey}--`
			].join('\n');
			const topRaw = [
				'Subject: Mixed container descendant nested thread',
				`From: child-${spec.formatLabel}-${branchKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${topMessageId}`,
				`In-Reply-To: ${rootMessageId}`,
				`References: ${rootMessageId} ${topMessageId}`,
				`Content-Type: multipart/mixed; boundary="mixed-descendant-top-${spec.formatLabel}-${branchKey}"`,
				'',
				`--mixed-descendant-top-${spec.formatLabel}-${branchKey}`,
				'Content-Type: text/plain; charset=utf-8',
				'',
				`${spec.formatLabel} ${branchKey} top attached child summary.`,
				`--mixed-descendant-top-${spec.formatLabel}-${branchKey}`,
				`Content-Type: message/rfc822; name="nested-child-${branchKey}.eml"`,
				`Content-Disposition: attachment; filename="nested-child-${branchKey}.eml"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(nestedRaw, 'utf8').toString('base64'),
				`--mixed-descendant-top-${spec.formatLabel}-${branchKey}--`
			].join('\n');

			return { nestedMessageId, topRaw };
		};

		try {
			const rootRawMessage = [
				'Subject: Mixed container descendant nested thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root descendant nested thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				const topEmails = branchKeys.map((branchKey) =>
					buildBranchEmails(spec, branchKey)
				);
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							...topEmails.flatMap((email, index) => [
								`Attachment: shared-child-${branchKeys[index]}.eml`,
								'Attachment-Content-Type: message/rfc822',
								'Attachment-Transfer-Encoding: base64',
								`Attachment-Data: ${Buffer.from(email.topRaw, 'utf8').toString('base64')}`
							]),
							`Subject: ${spec.formatLabel} container wrapper nested`,
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: <mixed-wrapper-nested-${spec.formatLabel}@example.com>`,
							'',
							`${spec.formatLabel} wrapper body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const wrapperRawMessage = [
					`Subject: ${spec.formatLabel} container wrapper nested`,
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: <mixed-wrapper-nested-${spec.formatLabel}@example.com>`,
					`Content-Type: multipart/mixed; boundary="mixed-wrapper-nested-${spec.formatLabel}"`,
					'',
					`--mixed-wrapper-nested-${spec.formatLabel}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} wrapper body.`,
					...topEmails.flatMap((email, index) => [
						`--mixed-wrapper-nested-${spec.formatLabel}`,
						`Content-Type: message/rfc822; name="shared-child-${branchKeys[index]}.eml"`,
						`Content-Disposition: attachment; filename="shared-child-${branchKeys[index]}.eml"`,
						'Content-Transfer-Encoding: base64',
						'',
						Buffer.from(email.topRaw, 'utf8').toString('base64')
					]),
					`--mixed-wrapper-nested-${spec.formatLabel}--`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							wrapperRawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(
								Buffer.byteLength(wrapperRawMessage, 'utf8')
							),
							wrapperRawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					wrapperRawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-mixed-descendant-nested-temp'
				},
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of replySpecs) {
				for (const branchKey of branchKeys) {
					const nestedMessageId = `<mixed-descendant-deep-${spec.formatLabel}-${branchKey}@example.com>`;
					const nestedSource = expectedNestedSource(spec, branchKey);
					const nestedMessage = loaded.documents.find(
						(document) =>
							document.metadata?.messageId === nestedMessageId &&
							document.source === nestedSource
					);
					const nestedArchiveDescendant = loaded.documents.find(
						(document) =>
							document.source ===
							`${nestedSource}#attachments/nested-guide-${branchKey}.zip#${sharedDocPath}`
					);

					expect(nestedMessage?.metadata).toMatchObject({
						emailAttachmentSource: nestedSource,
						emailForwardedChainCount: 1,
						emailForwardedFromAddress: `forwarded-deep-${spec.formatLabel}-${branchKey}@example.com`,
						emailForwardedSubject: `Forwarded deep ${spec.formatLabel} ${branchKey} child history`,
						emailMailboxContainerSource: spec.containerSource,
						emailMailboxFormat: spec.formatLabel,
						emailMessageDepth: 2,
						emailMessageLineageAttachmentSources: [
							expectedChildSource(spec, branchKey),
							nestedSource
						],
						emailMessageLineageCount: 2,
						emailMessageSource: nestedSource,
						emailMessageSourceKind: 'attached_message',
						emailReplyParentLoaded: true
					});
					expect(nestedArchiveDescendant?.metadata).toMatchObject({
						emailAttachmentSource: `${nestedSource}#attachments/nested-guide-${branchKey}.zip`,
						emailMailboxContainerSource: spec.containerSource,
						emailMailboxFormat: spec.formatLabel,
						emailMessageLineageAttachmentSources: [
							expectedChildSource(spec, branchKey),
							nestedSource
						],
						emailMessageLineageCount: 2,
						emailMessageSource: nestedSource,
						emailMessageSourceKind: 'attached_message'
					});
					expect(nestedArchiveDescendant?.text).toContain(
						`Mixed nested descendant text for ${spec.formatLabel} ${branchKey}`
					);
				}
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves nested attached-message sibling replies across mixed-format child branches on one shared thread', async () => {
		const tempDir = mkdtempSync(
			join(
				tmpdir(),
				'absolute-rag-email-mixed-descendant-nested-siblings-'
			)
		);
		const rootMessageId =
			'<mixed-format-descendant-nested-siblings-root@example.com>';
		const sharedDocPath = 'docs/guide.md';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const branchKeys = ['alpha', 'beta', 'gamma'];
		const nestedReplyOrdinals = [1, 2];
		const replySpecs = [
			{
				containerSource: 'reply-emlx.emlx',
				fileName: 'reply-emlx.emlx',
				formatLabel: 'emlx',
				stateFlags: [] as string[]
			},
			{
				containerSource: 'thread-pst.pst',
				fileName: 'thread-pst.pst',
				formatLabel: 'pst',
				stateFlags: ['flagged', 'read'] as string[]
			},
			{
				containerSource: 'thread-ost.ost',
				fileName: 'thread-ost.ost',
				formatLabel: 'ost',
				stateFlags: ['passed', 'unread'] as string[]
			},
			{
				containerSource: 'thread.mbox',
				fileName: 'thread.mbox',
				formatLabel: 'mbox',
				stateFlags: [] as string[]
			},
			{
				containerSource: familySegments.join('/'),
				fileName: '1713890015.M15P15.mailhost:2,FS',
				formatLabel: 'maildir',
				stateFlags: ['flagged', 'read'] as string[]
			}
		] as const;
		const expectedChildSource = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) =>
			spec.formatLabel === 'emlx'
				? `reply-emlx.emlx#attachments/shared-child-${branchKey}.eml`
				: spec.formatLabel === 'pst'
					? `thread-pst.pst#messages/1#attachments/shared-child-${branchKey}.eml`
					: spec.formatLabel === 'ost'
						? `thread-ost.ost#messages/1#attachments/shared-child-${branchKey}.eml`
						: spec.formatLabel === 'mbox'
							? `thread.mbox#messages/1#attachments/shared-child-${branchKey}.eml`
							: `Ops/Recovered/Shared/cur/1713890015.M15P15.mailhost:2,FS#attachments/shared-child-${branchKey}.eml`;
		const expectedNestedReplySource = (
			spec: (typeof replySpecs)[number],
			branchKey: string,
			replyOrdinal: number
		) =>
			`${expectedChildSource(spec, branchKey)}#attachments/nested-reply-${branchKey}-${replyOrdinal}.eml`;

		const buildBranchTopEmail = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) => {
			const topMessageId = `<mixed-descendant-top-sibling-${spec.formatLabel}-${branchKey}@example.com>`;
			const replyBlocks = nestedReplyOrdinals.flatMap((replyOrdinal) => {
				const replyMessageId = `<mixed-descendant-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com>`;
				const nestedArchive = createStoredZip({
					[sharedDocPath]: `# Shared guide\n\nMixed nested sibling descendant text for ${spec.formatLabel} ${branchKey} ${replyOrdinal}`
				});
				const nestedReplyRaw = [
					'Subject: Mixed container descendant nested sibling thread',
					`From: nested-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${replyMessageId}`,
					`In-Reply-To: ${topMessageId}`,
					`References: ${rootMessageId} ${topMessageId} ${replyMessageId}`,
					`Content-Type: multipart/mixed; boundary="mixed-descendant-nested-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}"`,
					'',
					`--mixed-descendant-nested-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} ${branchKey} nested reply ${replyOrdinal} summary.`,
					'',
					'---------- Forwarded message ----------',
					`From: forwarded-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com`,
					'Date: Tue, Apr 21, 2026 at 9:25 AM',
					`Subject: Forwarded sibling ${spec.formatLabel} ${branchKey} ${replyOrdinal} child history`,
					'To: ops@example.com',
					`--mixed-descendant-nested-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}`,
					`Content-Type: application/zip; name="nested-sibling-guide-${branchKey}-${replyOrdinal}.zip"`,
					`Content-Disposition: attachment; filename="nested-sibling-guide-${branchKey}-${replyOrdinal}.zip"`,
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(nestedArchive).toString('base64'),
					`--mixed-descendant-nested-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}--`
				].join('\n');

				return [
					`--mixed-descendant-top-siblings-${spec.formatLabel}-${branchKey}`,
					`Content-Type: message/rfc822; name="nested-reply-${branchKey}-${replyOrdinal}.eml"`,
					`Content-Disposition: attachment; filename="nested-reply-${branchKey}-${replyOrdinal}.eml"`,
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(nestedReplyRaw, 'utf8').toString('base64')
				];
			});

			return [
				'Subject: Mixed container descendant nested sibling thread',
				`From: child-${spec.formatLabel}-${branchKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${topMessageId}`,
				`In-Reply-To: ${rootMessageId}`,
				`References: ${rootMessageId} ${topMessageId}`,
				`Content-Type: multipart/mixed; boundary="mixed-descendant-top-siblings-${spec.formatLabel}-${branchKey}"`,
				'',
				`--mixed-descendant-top-siblings-${spec.formatLabel}-${branchKey}`,
				'Content-Type: text/plain; charset=utf-8',
				'',
				`${spec.formatLabel} ${branchKey} top attached child summary.`,
				...replyBlocks,
				`--mixed-descendant-top-siblings-${spec.formatLabel}-${branchKey}--`
			].join('\n');
		};

		try {
			const rootRawMessage = [
				'Subject: Mixed container descendant nested sibling thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root descendant nested sibling thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				const topEmails = branchKeys.map((branchKey) =>
					buildBranchTopEmail(spec, branchKey)
				);
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							...topEmails.flatMap((email, index) => [
								`Attachment: shared-child-${branchKeys[index]}.eml`,
								'Attachment-Content-Type: message/rfc822',
								'Attachment-Transfer-Encoding: base64',
								`Attachment-Data: ${Buffer.from(email, 'utf8').toString('base64')}`
							]),
							`Subject: ${spec.formatLabel} container wrapper nested siblings`,
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: <mixed-wrapper-nested-siblings-${spec.formatLabel}@example.com>`,
							'',
							`${spec.formatLabel} wrapper body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const wrapperRawMessage = [
					`Subject: ${spec.formatLabel} container wrapper nested siblings`,
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: <mixed-wrapper-nested-siblings-${spec.formatLabel}@example.com>`,
					`Content-Type: multipart/mixed; boundary="mixed-wrapper-nested-siblings-${spec.formatLabel}"`,
					'',
					`--mixed-wrapper-nested-siblings-${spec.formatLabel}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} wrapper body.`,
					...topEmails.flatMap((email, index) => [
						`--mixed-wrapper-nested-siblings-${spec.formatLabel}`,
						`Content-Type: message/rfc822; name="shared-child-${branchKeys[index]}.eml"`,
						`Content-Disposition: attachment; filename="shared-child-${branchKeys[index]}.eml"`,
						'Content-Transfer-Encoding: base64',
						'',
						Buffer.from(email, 'utf8').toString('base64')
					]),
					`--mixed-wrapper-nested-siblings-${spec.formatLabel}--`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							wrapperRawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(
								Buffer.byteLength(wrapperRawMessage, 'utf8')
							),
							wrapperRawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					wrapperRawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-mixed-descendant-nested-siblings-temp'
				},
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of replySpecs) {
				for (const branchKey of branchKeys) {
					const topMessageId = `<mixed-descendant-top-sibling-${spec.formatLabel}-${branchKey}@example.com>`;
					const siblingSources = nestedReplyOrdinals.map(
						(replyOrdinal) =>
							expectedNestedReplySource(
								spec,
								branchKey,
								replyOrdinal
							)
					);
					for (const [
						index,
						replyOrdinal
					] of nestedReplyOrdinals.entries()) {
						const nestedMessageId = `<mixed-descendant-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com>`;
						const nestedSource = expectedNestedReplySource(
							spec,
							branchKey,
							replyOrdinal
						);
						const nestedMessage = loaded.documents.find(
							(document) =>
								document.metadata?.messageId ===
									nestedMessageId &&
								document.source === nestedSource
						);
						const nestedArchiveDescendant = loaded.documents.find(
							(document) =>
								document.source ===
								`${nestedSource}#attachments/nested-sibling-guide-${branchKey}-${replyOrdinal}.zip#${sharedDocPath}`
						);
						const expectedMailboxStateMetadata =
							spec.formatLabel === 'pst' ||
							spec.formatLabel === 'ost'
								? { emailMailboxStateFlags: spec.stateFlags }
								: {};

						expect(nestedMessage?.metadata).toMatchObject({
							emailAttachmentSource: nestedSource,
							emailForwardedChainCount: 1,
							emailForwardedFromAddress: `forwarded-sibling-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com`,
							emailForwardedSubject: `Forwarded sibling ${spec.formatLabel} ${branchKey} ${replyOrdinal} child history`,
							emailMailboxContainerSource: spec.containerSource,
							emailMailboxFormat: spec.formatLabel,
							...expectedMailboxStateMetadata,
							emailMessageDepth: 2,
							emailMessageLineageAttachmentSources: [
								expectedChildSource(spec, branchKey),
								nestedSource
							],
							emailMessageLineageCount: 2,
							emailMessageSource: nestedSource,
							emailMessageSourceKind: 'attached_message',
							emailReplyParentLoaded: true,
							emailReplyParentMessageId: topMessageId,
							emailReplySiblingCount: nestedReplyOrdinals.length,
							emailReplySiblingIndex: index,
							emailReplySiblingOrdinal: index + 1,
							emailReplySiblingParentMessageId: topMessageId,
							emailReplySiblingSources: siblingSources
						});
						expect(nestedArchiveDescendant?.metadata).toMatchObject(
							{
								emailAttachmentSource: `${nestedSource}#attachments/nested-sibling-guide-${branchKey}-${replyOrdinal}.zip`,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFormat: spec.formatLabel,
								...expectedMailboxStateMetadata,
								emailMessageLineageAttachmentSources: [
									expectedChildSource(spec, branchKey),
									nestedSource
								],
								emailMessageLineageCount: 2,
								emailMessageSource: nestedSource,
								emailMessageSourceKind: 'attached_message'
							}
						);
						expect(nestedArchiveDescendant?.text).toContain(
							`Mixed nested sibling descendant text for ${spec.formatLabel} ${branchKey} ${replyOrdinal}`
						);
					}
				}
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves arbitrary nested child families under mixed-format nested sibling replies on one shared thread', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-mixed-descendant-deep-children-')
		);
		const rootMessageId = '<mixed-format-deep-child-root@example.com>';
		const sharedDocPath = 'docs/deep-guide.md';
		const familySegments = ['Ops', 'Recovered', 'Shared'];
		const branchKeys = MIXED_MAILBOX_BRANCH_KEYS;
		const nestedReplyOrdinals = MIXED_MAILBOX_NESTED_REPLY_ORDINALS;
		const deepChildKeys = MIXED_MAILBOX_DEEP_CHILD_KEYS;
		const threadIndexDriftKeys = MIXED_MAILBOX_THREAD_INDEX_DRIFT_KEYS;
		const inlineResourceKeys = MIXED_MAILBOX_INLINE_RESOURCE_KEYS;
		const replySpecs = MIXED_MAILBOX_REPLY_SPECS;

		const buildBranchTopEmail = (
			spec: (typeof replySpecs)[number],
			branchKey: string
		) => {
			const topMessageId = `<mixed-deep-top-${spec.formatLabel}-${branchKey}@example.com>`;
			const replyBlocks = nestedReplyOrdinals.flatMap((replyOrdinal) => {
				const nestedReplyMessageId = `<mixed-deep-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com>`;
				const deepChildBlocks = deepChildKeys.flatMap((childKey) => {
					const childIndex = deepChildKeys.indexOf(childKey);
					const deepChildMessageId = `<mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com>`;
					const deepThreadIndex = threadIndexDriftKeys[childIndex]!;
					const inlineContentIds = inlineResourceKeys.map(
						(inlineKey) =>
							`<deep-inline-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}-${inlineKey}@example.com>`
					);
					const deepArchive = createStoredZip({
						[sharedDocPath]: `# Deep guide\n\nMixed deep child descendant text for ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey}`
					});
					const deepChildRaw = [
						'Subject: Mixed deep child descendant thread',
						`From: deep-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com`,
						'To: ops@example.com',
						`Message-ID: ${deepChildMessageId}`,
						`In-Reply-To: ${nestedReplyMessageId}`,
						`References: ${rootMessageId} ${topMessageId} ${nestedReplyMessageId} ${deepChildMessageId}`,
						`Thread-Index: ${deepThreadIndex}`,
						`Content-Type: multipart/mixed; boundary="mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}"`,
						'',
						`--mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}`,
						'Content-Type: text/html; charset=utf-8',
						'',
						[
							'<html><body>',
							`<p>${spec.formatLabel} ${branchKey} nested reply ${replyOrdinal} ${childKey} deep child summary.</p>`,
							...inlineContentIds.map(
								(inlineContentId, inlineIndex) =>
									`<p><img alt="${inlineResourceKeys[inlineIndex]}" src="cid:${inlineContentId.replace(/^<|>$/g, '')}" /></p>`
							),
							`<p>On Tue, Apr 21, 2026 at 9:30 AM prior-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com wrote:</p>`,
							`<blockquote><p>&gt; Prior quoted ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey} owner note.</p><p>&gt;&gt; Earlier quoted ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey} archive note.</p></blockquote>`,
							'<p>---------- Forwarded message ----------</p>',
							`<p>From: forwarded-deep-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com</p>`,
							'<p>Date: Tue, Apr 21, 2026 at 9:45 AM</p>',
							`<p>Subject: Forwarded deep child ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey} history</p>`,
							'<p>To: ops@example.com</p>',
							'<p>---------- Forwarded message ----------</p>',
							`<p>From: forwarded-deep-archive-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com</p>`,
							'<p>Date: Tue, Apr 21, 2026 at 9:47 AM</p>',
							`<p>Subject: Forwarded deep child ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey} archive history</p>`,
							'<p>To: archive@example.com</p>',
							'</body></html>'
						].join(''),
						...inlineResourceKeys.flatMap(
							(inlineKey, inlineIndex) => [
								`--mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}`,
								`Content-Type: text/plain; name="deep-inline-${branchKey}-${replyOrdinal}-${childKey}-${inlineKey}.txt"`,
								`Content-Disposition: inline; filename="deep-inline-${branchKey}-${replyOrdinal}-${childKey}-${inlineKey}.txt"`,
								`Content-ID: ${inlineContentIds[inlineIndex]}`,
								'Content-Transfer-Encoding: base64',
								'',
								Buffer.from(
									`Inline ${inlineKey} deep note for ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey}.`,
									'utf8'
								).toString('base64')
							]
						),
						`--mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}`,
						`Content-Type: application/zip; name="deep-child-guide-${branchKey}-${replyOrdinal}-${childKey}.zip"`,
						`Content-Disposition: attachment; filename="deep-child-guide-${branchKey}-${replyOrdinal}-${childKey}.zip"`,
						'Content-Transfer-Encoding: base64',
						'',
						Buffer.from(deepArchive).toString('base64'),
						`--mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}--`
					].join('\n');

					return [
						`--mixed-descendant-deep-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}`,
						`Content-Type: message/rfc822; name="deep-child-${childKey}.eml"`,
						`Content-Disposition: attachment; filename="deep-child-${childKey}.eml"`,
						'Content-Transfer-Encoding: base64',
						'',
						Buffer.from(deepChildRaw, 'utf8').toString('base64')
					];
				});

				const nestedReplyRaw = [
					'Subject: Mixed container descendant deep child thread',
					`From: nested-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com`,
					'To: ops@example.com',
					`Message-ID: ${nestedReplyMessageId}`,
					`In-Reply-To: ${topMessageId}`,
					`References: ${rootMessageId} ${topMessageId} ${nestedReplyMessageId}`,
					`Content-Type: multipart/mixed; boundary="mixed-descendant-deep-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}"`,
					'',
					`--mixed-descendant-deep-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} ${branchKey} nested reply ${replyOrdinal} summary.`,
					...deepChildBlocks,
					`--mixed-descendant-deep-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}--`
				].join('\n');

				return [
					`--mixed-descendant-top-deep-children-${spec.formatLabel}-${branchKey}`,
					`Content-Type: message/rfc822; name="nested-reply-${branchKey}-${replyOrdinal}.eml"`,
					`Content-Disposition: attachment; filename="nested-reply-${branchKey}-${replyOrdinal}.eml"`,
					'Content-Transfer-Encoding: base64',
					'',
					Buffer.from(nestedReplyRaw, 'utf8').toString('base64')
				];
			});

			return [
				'Subject: Mixed container descendant deep child thread',
				`From: child-${spec.formatLabel}-${branchKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${topMessageId}`,
				`In-Reply-To: ${rootMessageId}`,
				`References: ${rootMessageId} ${topMessageId}`,
				`Content-Type: multipart/mixed; boundary="mixed-descendant-top-deep-children-${spec.formatLabel}-${branchKey}"`,
				'',
				`--mixed-descendant-top-deep-children-${spec.formatLabel}-${branchKey}`,
				'Content-Type: text/plain; charset=utf-8',
				'',
				`${spec.formatLabel} ${branchKey} top deep child summary.`,
				...replyBlocks,
				`--mixed-descendant-top-deep-children-${spec.formatLabel}-${branchKey}--`
			].join('\n');
		};

		try {
			const rootRawMessage = [
				'Subject: Mixed container descendant deep child thread',
				'From: root@example.com',
				'To: ops@example.com',
				`Message-ID: ${rootMessageId}`,
				'',
				'Root deep child descendant thread body.'
			].join('\n');
			writeFileSync(
				join(tempDir, 'root.emlx'),
				[
					String(Buffer.byteLength(rootRawMessage, 'utf8')),
					rootRawMessage,
					'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
				].join('\n'),
				'utf8'
			);

			for (const spec of replySpecs) {
				const topEmails = branchKeys.map((branchKey) =>
					buildBranchTopEmail(spec, branchKey)
				);
				if (spec.formatLabel === 'pst' || spec.formatLabel === 'ost') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							'Folder: Ops/Recovered/Shared',
							`Flags: ${spec.stateFlags.join(' ')}`,
							...topEmails.flatMap((email, index) => [
								`Attachment: shared-child-${branchKeys[index]}.eml`,
								'Attachment-Content-Type: message/rfc822',
								'Attachment-Transfer-Encoding: base64',
								`Attachment-Data: ${Buffer.from(email, 'utf8').toString('base64')}`
							]),
							`Subject: ${spec.formatLabel} container wrapper deep children`,
							`From: ${spec.formatLabel}@example.com`,
							'To: ops@example.com',
							`Message-ID: <mixed-wrapper-deep-children-${spec.formatLabel}@example.com>`,
							'',
							`${spec.formatLabel} wrapper body.`
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const wrapperRawMessage = [
					`Subject: ${spec.formatLabel} container wrapper deep children`,
					`From: ${spec.formatLabel}@example.com`,
					'To: ops@example.com',
					`Message-ID: <mixed-wrapper-deep-children-${spec.formatLabel}@example.com>`,
					`Content-Type: multipart/mixed; boundary="mixed-wrapper-deep-children-${spec.formatLabel}"`,
					'',
					`--mixed-wrapper-deep-children-${spec.formatLabel}`,
					'Content-Type: text/plain; charset=utf-8',
					'',
					`${spec.formatLabel} wrapper body.`,
					...topEmails.flatMap((email, index) => [
						`--mixed-wrapper-deep-children-${spec.formatLabel}`,
						`Content-Type: message/rfc822; name="shared-child-${branchKeys[index]}.eml"`,
						`Content-Disposition: attachment; filename="shared-child-${branchKeys[index]}.eml"`,
						'Content-Transfer-Encoding: base64',
						'',
						Buffer.from(email, 'utf8').toString('base64')
					]),
					`--mixed-wrapper-deep-children-${spec.formatLabel}--`
				].join('\n');

				if (spec.formatLabel === 'mbox') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							`From ${spec.formatLabel}@example.com Tue Apr 21 09:00:00 2026`,
							wrapperRawMessage
						].join('\n'),
						'utf8'
					);
					continue;
				}

				if (spec.formatLabel === 'emlx') {
					writeFileSync(
						join(tempDir, spec.fileName),
						[
							String(
								Buffer.byteLength(wrapperRawMessage, 'utf8')
							),
							wrapperRawMessage,
							'<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>flags</key><integer>1</integer></dict></plist>'
						].join('\n'),
						'utf8'
					);
					continue;
				}

				const familyDir = join(tempDir, ...familySegments, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(familyDir, spec.fileName),
					wrapperRawMessage,
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-mixed-descendant-deep-children-temp'
				},
				directory: tempDir,
				includeExtensions: ['.pst', '.ost', '.mbox', '.emlx']
			});

			for (const spec of replySpecs) {
				for (const branchKey of branchKeys) {
					for (const replyOrdinal of nestedReplyOrdinals) {
						const nestedReplyMessageId = `<mixed-deep-reply-${spec.formatLabel}-${branchKey}-${replyOrdinal}@example.com>`;
						const nestedSource =
							mixedMailboxExpectedNestedReplySource(
								spec,
								branchKey,
								replyOrdinal
							);
						const deepSiblingSources = deepChildKeys.map(
							(childKey) =>
								mixedMailboxExpectedDeepChildSource(
									spec,
									branchKey,
									replyOrdinal,
									childKey
								)
						);
						for (const [
							index,
							childKey
						] of deepChildKeys.entries()) {
							const deepChildMessageId = `<mixed-deep-child-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com>`;
							const deepChildSource =
								mixedMailboxExpectedDeepChildSource(
									spec,
									branchKey,
									replyOrdinal,
									childKey
								);
							const deepThreadIndex =
								threadIndexDriftKeys[index]!;
							const deepChildMessage = loaded.documents.find(
								(document) =>
									document.metadata?.messageId ===
										deepChildMessageId &&
									document.source === deepChildSource
							);
							const deepChildArchiveDescendant =
								loaded.documents.find(
									(document) =>
										document.source ===
										`${deepChildSource}#attachments/deep-child-guide-${branchKey}-${replyOrdinal}-${childKey}.zip#${sharedDocPath}`
								);
							const expectedMailboxStateMetadata =
								spec.formatLabel === 'pst' ||
								spec.formatLabel === 'ost'
									? {
											emailMailboxStateFlags:
												spec.stateFlags
										}
									: {};

							expect(deepChildMessage?.metadata).toMatchObject({
								emailAttachmentSource: deepChildSource,
								emailForwardedChainCount: 2,
								emailForwardedFromAddress: `forwarded-deep-${spec.formatLabel}-${branchKey}-${replyOrdinal}-${childKey}@example.com`,
								emailForwardedSubject: `Forwarded deep child ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey} history`,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFormat: spec.formatLabel,
								...expectedMailboxStateMetadata,
								emailMessageDepth: 3,
								emailMessageLineageAttachmentSources: [
									mixedMailboxExpectedChildSource(
										spec,
										branchKey
									),
									nestedSource,
									deepChildSource
								],
								emailMessageLineageCount: 3,
								emailMessageSource: deepChildSource,
								emailMessageSourceKind: 'attached_message',
								emailQuotedMaxDepth: 1,
								messageId: deepChildMessageId,
								emailReplyParentLoaded: true,
								emailReplyParentMessageId: nestedReplyMessageId,
								emailReplySiblingCount: deepChildKeys.length,
								emailReplySiblingIndex: index,
								emailReplySiblingOrdinal: index + 1,
								emailReplySiblingParentMessageId:
									nestedReplyMessageId,
								emailReplySiblingSources: deepSiblingSources,
								replyReferenceCount: 4,
								references: `${rootMessageId} <mixed-deep-top-${spec.formatLabel}-${branchKey}@example.com> ${nestedReplyMessageId} ${deepChildMessageId}`,
								threadIndex: deepThreadIndex
							});
							const deepChildBodySections = Array.isArray(
								deepChildMessage?.metadata?.emailBodySections
							)
								? deepChildMessage.metadata.emailBodySections
								: [];
							expect(
								deepChildBodySections.some(
									(section: unknown) =>
										section &&
										typeof section === 'object' &&
										(section as { kind?: string }).kind ===
											'quoted_history'
								)
							).toBe(true);
							expect(
								deepChildArchiveDescendant?.metadata
							).toMatchObject({
								emailAttachmentSource: `${deepChildSource}#attachments/deep-child-guide-${branchKey}-${replyOrdinal}-${childKey}.zip`,
								emailMailboxContainerSource:
									spec.containerSource,
								emailMailboxFormat: spec.formatLabel,
								...expectedMailboxStateMetadata,
								emailMessageLineageAttachmentSources: [
									mixedMailboxExpectedChildSource(
										spec,
										branchKey
									),
									nestedSource,
									deepChildSource
								],
								emailMessageLineageCount: 3,
								emailMessageSource: deepChildSource,
								emailMessageSourceKind: 'attached_message'
							});
							expect(deepChildArchiveDescendant?.text).toContain(
								`Mixed deep child descendant text for ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey}`
							);
							for (const [
								inlineIndex,
								inlineKey
							] of inlineResourceKeys.entries()) {
								const deepChildInlineResource =
									loaded.documents.find(
										(document) =>
											document.source ===
											mixedMailboxExpectedDeepInlineSource(
												spec,
												branchKey,
												replyOrdinal,
												childKey,
												inlineKey
											)
									);
								expect(
									deepChildInlineResource?.metadata
								).toMatchObject({
									attachmentEmbeddedReferenceMatched: true,
									attachmentIndex: inlineIndex,
									emailAttachmentRole: 'inline_resource',
									emailAttachmentSource:
										mixedMailboxExpectedDeepInlineSource(
											spec,
											branchKey,
											replyOrdinal,
											childKey,
											inlineKey
										),
									emailMailboxContainerSource:
										spec.containerSource,
									emailMailboxFormat: spec.formatLabel,
									...expectedMailboxStateMetadata,
									emailMessageLineageAttachmentSources: [
										mixedMailboxExpectedChildSource(
											spec,
											branchKey
										),
										nestedSource,
										deepChildSource
									],
									emailMessageLineageCount: 3,
									emailMessageSource: deepChildSource,
									emailMessageSourceKind: 'attached_message',
									threadIndex: deepThreadIndex
								});
								expect(deepChildInlineResource?.text).toContain(
									`Inline ${inlineKey} deep note for ${spec.formatLabel} ${branchKey} ${replyOrdinal} ${childKey}.`
								);
							}
						}
					}
				}
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('fans out mbox uploads into message documents with mailbox metadata and thread reconstruction', async () => {
		const attachmentPayload = Buffer.from(
			'Mbox attachment body.',
			'utf8'
		).toString('base64');
		const mboxContent = [
			'From root@example.com Tue Apr 21 09:00:00 2026',
			'Subject: Mailbox thread',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <mbox-root@example.com>',
			'',
			'Root mailbox body.',
			'>From preserved body line.',
			'',
			'From reply@example.com Tue Apr 21 10:00:00 2026',
			'Subject: Mailbox thread',
			'From: reply@example.com',
			'To: ops@example.com',
			'Message-ID: <mbox-reply@example.com>',
			'In-Reply-To: <mbox-root@example.com>',
			'References: <mbox-root@example.com> <mbox-reply@example.com>',
			'Content-Type: multipart/mixed; boundary="mbox-boundary"',
			'',
			'--mbox-boundary',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Reply mailbox body.',
			'--mbox-boundary',
			'Content-Type: text/plain; name="note.txt"',
			'Content-Disposition: attachment; filename="note.txt"',
			'Content-Transfer-Encoding: base64',
			'',
			attachmentPayload,
			'--mbox-boundary--'
		].join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [{ content: mboxContent, name: 'thread.mbox' }]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<mbox-root@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const replyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<mbox-reply@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const attachmentDocument = loaded.documents.find(
			(document) =>
				document.metadata?.attachmentName === 'note.txt' &&
				document.metadata?.emailKind === 'attachment'
		);

		expect(loaded.documents).toHaveLength(3);
		expect(rootDocument?.source).toBe('thread.mbox#messages/1');
		expect(rootDocument?.text).toContain('Root mailbox body.');
		expect(rootDocument?.text).toContain('From preserved body line.');
		expect(rootDocument?.metadata).toMatchObject({
			emailMailboxContainerSource: 'thread.mbox',
			emailMailboxFormat: 'mbox',
			emailMailboxMessageCount: 2,
			emailMailboxMessageIndex: 0,
			emailMailboxMessageOrdinal: 1,
			threadKnownMessageCount: 2,
			threadLoadedMessageCount: 2,
			threadLoadedAttachmentCount: 1
		});
		expect(replyDocument?.source).toBe('thread.mbox#messages/2');
		expect(replyDocument?.metadata).toMatchObject({
			emailMailboxContainerSource: 'thread.mbox',
			emailMailboxFormat: 'mbox',
			emailMailboxMessageCount: 2,
			emailMailboxMessageIndex: 1,
			emailMailboxMessageOrdinal: 2,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<mbox-root@example.com>',
			emailReplyParentSource: 'thread.mbox#messages/1',
			threadKnownMessageCount: 2,
			threadLoadedMessageCount: 2,
			threadLoadedAttachmentCount: 1
		});
		expect(attachmentDocument?.source).toBe(
			'thread.mbox#messages/2#attachments/note.txt'
		);
		expect(attachmentDocument?.text).toContain('Mbox attachment body.');
		expect(attachmentDocument?.metadata).toMatchObject({
			attachmentName: 'note.txt',
			emailMailboxContainerSource: 'thread.mbox',
			emailMailboxFormat: 'mbox',
			emailMailboxMessageCount: 2,
			emailMailboxMessageIndex: 1,
			emailMailboxMessageOrdinal: 2,
			emailMessageSource: 'thread.mbox#messages/2',
			threadKnownMessageCount: 2,
			threadLoadedMessageCount: 2,
			threadLoadedAttachmentCount: 1
		});
	});

	it('loads maildir message files from cur and new directories with normalized maildir metadata', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-maildir-')
		);
		const attachmentPayload = Buffer.from(
			'Maildir attachment body.',
			'utf8'
		).toString('base64');
		const rootEmail = [
			'Subject: Maildir thread',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <maildir-root@example.com>',
			'',
			'Maildir root body.'
		].join('\n');
		const replyEmail = [
			'Subject: Maildir thread',
			'From: reply@example.com',
			'To: ops@example.com',
			'Message-ID: <maildir-reply@example.com>',
			'In-Reply-To: <maildir-root@example.com>',
			'References: <maildir-root@example.com> <maildir-reply@example.com>',
			'Content-Type: multipart/mixed; boundary="maildir-boundary"',
			'',
			'--maildir-boundary',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Maildir reply body.',
			'--maildir-boundary',
			'Content-Type: text/plain; name="maildir-note.txt"',
			'Content-Disposition: attachment; filename="maildir-note.txt"',
			'Content-Transfer-Encoding: base64',
			'',
			attachmentPayload,
			'--maildir-boundary--'
		].join('\n');

		try {
			mkdirSync(join(tempDir, 'cur'));
			mkdirSync(join(tempDir, 'new'));
			writeFileSync(
				join(tempDir, 'new', '1713890000.M1P1.mailhost'),
				rootEmail,
				'utf8'
			);
			writeFileSync(
				join(tempDir, 'cur', '1713893600.M2P2.mailhost:2,RS'),
				replyEmail,
				'utf8'
			);

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-maildir-temp' },
				directory: tempDir
			});

			const rootDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<maildir-root@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const replyDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<maildir-reply@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const attachmentDocument = loaded.documents.find(
				(document) =>
					document.metadata?.attachmentName === 'maildir-note.txt' &&
					document.metadata?.emailKind === 'attachment'
			);

			expect(loaded.documents).toHaveLength(3);
			expect(rootDocument?.source).toBe('new/1713890000.M1P1.mailhost');
			expect(rootDocument?.metadata).toMatchObject({
				emailMailboxFormat: 'maildir',
				emailMailboxFolder: 'new',
				emailMailboxIsDraft: false,
				emailMailboxIsFlagged: false,
				emailMailboxIsPassed: false,
				emailMailboxIsRead: false,
				emailMailboxIsReplied: false,
				emailMailboxIsTrashed: false,
				emailMailboxIsUnread: true,
				emailMailboxKey: '1713890000.M1P1.mailhost',
				emailMailboxStateFlags: ['unread'],
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2,
				threadLoadedAttachmentCount: 1
			});
			expect(replyDocument?.source).toBe(
				'cur/1713893600.M2P2.mailhost:2,RS'
			);
			expect(replyDocument?.metadata).toMatchObject({
				emailMailboxFlags: ['R', 'S'],
				emailMailboxFormat: 'maildir',
				emailMailboxFolder: 'cur',
				emailMailboxIsDraft: false,
				emailMailboxIsFlagged: false,
				emailMailboxIsPassed: false,
				emailMailboxIsRead: true,
				emailMailboxIsReplied: true,
				emailMailboxIsTrashed: false,
				emailMailboxIsUnread: false,
				emailMailboxKey: '1713893600.M2P2.mailhost',
				emailMailboxStateFlags: ['replied', 'read'],
				emailReplyParentLoaded: true,
				emailReplyParentMessageId: '<maildir-root@example.com>',
				emailReplyParentSource: 'new/1713890000.M1P1.mailhost',
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2,
				threadLoadedAttachmentCount: 1
			});
			expect(attachmentDocument?.metadata).toMatchObject({
				attachmentName: 'maildir-note.txt',
				emailMailboxFlags: ['R', 'S'],
				emailMailboxFormat: 'maildir',
				emailMailboxFolder: 'cur',
				emailMailboxIsDraft: false,
				emailMailboxIsFlagged: false,
				emailMailboxIsPassed: false,
				emailMailboxIsRead: true,
				emailMailboxIsReplied: true,
				emailMailboxIsTrashed: false,
				emailMailboxIsUnread: false,
				emailMailboxKey: '1713893600.M2P2.mailhost',
				emailMailboxStateFlags: ['replied', 'read'],
				emailMessageSource: 'cur/1713893600.M2P2.mailhost:2,RS',
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2,
				threadLoadedAttachmentCount: 1
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves rich sibling maildir branches across mailbox families with inline resources, forwarded headers, nested archives, and attached messages', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-maildir-rich-')
		);
		const buildRichMaildirBranch = (input: {
			mailboxKey: string;
			forwardedFrom: string;
			forwardedSubject: string;
			messageId: string;
			nestedChildMessageId: string;
			parentMessageId: string;
		}) => {
			const inlineContentId = `<${input.mailboxKey}-inline@example.com>`;
			const nestedArchive = createStoredZip({
				'docs/guide.md': `${input.mailboxKey} nested archive text`
			});
			const nestedChildEmail = [
				`Subject: ${input.mailboxKey} mailbox child`,
				`From: ${input.mailboxKey}-child@example.com`,
				'To: ops@example.com',
				`Message-ID: ${input.nestedChildMessageId}`,
				'',
				`${input.mailboxKey} attached child body.`
			].join('\n');

			return [
				'Subject: Maildir collision thread',
				`From: ${input.mailboxKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${input.messageId}`,
				`In-Reply-To: ${input.parentMessageId}`,
				`References: ${input.parentMessageId} ${input.messageId}`,
				'Content-Type: multipart/mixed; boundary="mixed"',
				'',
				'--mixed',
				'Content-Type: multipart/related; boundary="related"',
				'',
				'--related',
				'Content-Type: text/html; charset=utf-8',
				'',
				[
					`<p>${input.mailboxKey} authored mailbox summary.</p>`,
					`<p><img src="cid:${inlineContentId.replace(/^<|>$/g, '')}" /></p>`,
					'<blockquote>',
					`<p>${input.mailboxKey} quoted mailbox note.</p>`,
					'</blockquote>',
					'<p>---------- Forwarded message ----------<br/>',
					`From: ${input.forwardedFrom}<br/>`,
					'Date: Tue, Apr 21, 2026 at 9:15 AM<br/>',
					`Subject: ${input.forwardedSubject}<br/>`,
					'To: ops@example.com</p>'
				].join(''),
				'--related',
				`Content-Type: text/plain; name="${input.mailboxKey}-inline-note.txt"`,
				`Content-ID: ${inlineContentId}`,
				`Content-Disposition: inline; filename="${input.mailboxKey}-inline-note.txt"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(
					`${input.mailboxKey} inline resource text`,
					'utf8'
				).toString('base64'),
				'--related--',
				'--mixed',
				`Content-Type: application/zip; name="${input.mailboxKey}.zip"`,
				`Content-Disposition: attachment; filename="${input.mailboxKey}.zip"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(nestedArchive).toString('base64'),
				'--mixed',
				`Content-Type: message/rfc822; name="${input.mailboxKey}-child.eml"`,
				`Content-Disposition: attachment; filename="${input.mailboxKey}-child.eml"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(nestedChildEmail, 'utf8').toString('base64'),
				'--mixed--'
			].join('\n');
		};

		const rootMessageId = '<maildir-family-root@example.com>';
		const rootEmail = [
			'Subject: Maildir collision thread',
			'From: root@example.com',
			'To: ops@example.com',
			`Message-ID: ${rootMessageId}`,
			'',
			'Mailbox family root body.'
		].join('\n');

		try {
			mkdirSync(join(tempDir, 'Inbox'));
			mkdirSync(join(tempDir, 'Inbox', 'new'));
			mkdirSync(join(tempDir, 'Lantern'));
			mkdirSync(join(tempDir, 'Lantern', 'cur'));
			mkdirSync(join(tempDir, 'Quartz'));
			mkdirSync(join(tempDir, 'Quartz', 'cur'));
			writeFileSync(
				join(tempDir, 'Inbox', 'new', '1713890000.M1P1.mailhost'),
				rootEmail,
				'utf8'
			);
			writeFileSync(
				join(
					tempDir,
					'Lantern',
					'cur',
					'1713893600.M2P2.mailhost:2,RS'
				),
				buildRichMaildirBranch({
					forwardedFrom: 'lantern-prior@example.com',
					forwardedSubject: 'Lantern forwarded review',
					mailboxKey: 'lantern',
					messageId: '<maildir-lantern@example.com>',
					nestedChildMessageId: '<maildir-lantern-child@example.com>',
					parentMessageId: rootMessageId
				}),
				'utf8'
			);
			writeFileSync(
				join(tempDir, 'Quartz', 'cur', '1713897200.M3P3.mailhost:2,RS'),
				buildRichMaildirBranch({
					forwardedFrom: 'quartz-prior@example.com',
					forwardedSubject: 'Quartz forwarded review',
					mailboxKey: 'quartz',
					messageId: '<maildir-quartz@example.com>',
					nestedChildMessageId: '<maildir-quartz-child@example.com>',
					parentMessageId: rootMessageId
				}),
				'utf8'
			);

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-maildir-rich-temp' },
				directory: tempDir
			});

			const lanternMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<maildir-lantern@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const quartzMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<maildir-quartz@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const lanternInline = loaded.documents.find(
				(document) =>
					document.metadata?.attachmentName ===
					'lantern-inline-note.txt'
			);
			const quartzInline = loaded.documents.find(
				(document) =>
					document.metadata?.attachmentName ===
					'quartz-inline-note.txt'
			);
			const lanternArchiveChild = loaded.documents.find(
				(document) =>
					document.source ===
					'Lantern/cur/1713893600.M2P2.mailhost:2,RS#attachments/lantern.zip#docs/guide.md'
			);
			const quartzArchiveChild = loaded.documents.find(
				(document) =>
					document.source ===
					'Quartz/cur/1713897200.M3P3.mailhost:2,RS#attachments/quartz.zip#docs/guide.md'
			);
			const lanternChildMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<maildir-lantern-child@example.com>'
			);
			const quartzChildMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<maildir-quartz-child@example.com>'
			);

			expect(loaded.documents).toHaveLength(9);
			expect(lanternMessage?.metadata).toMatchObject({
				attachmentCount: 3,
				attachmentNames: [
					'lantern-inline-note.txt',
					'lantern.zip',
					'lantern-child.eml'
				],
				emailForwardedChainCount: 1,
				emailForwardedFromAddress: 'lantern-prior@example.com',
				emailForwardedSubject: 'Lantern forwarded review',
				emailMailboxContainerSource: 'Lantern',
				emailMailboxFlags: ['R', 'S'],
				emailMailboxFolder: 'cur',
				emailMailboxFormat: 'maildir',
				hasInlineResources: true,
				threadLoadedMessageCount: 3
			});
			expect(quartzMessage?.metadata).toMatchObject({
				attachmentCount: 3,
				attachmentNames: [
					'quartz-inline-note.txt',
					'quartz.zip',
					'quartz-child.eml'
				],
				emailForwardedChainCount: 1,
				emailForwardedFromAddress: 'quartz-prior@example.com',
				emailForwardedSubject: 'Quartz forwarded review',
				emailMailboxContainerSource: 'Quartz',
				emailMailboxFlags: ['R', 'S'],
				emailMailboxFolder: 'cur',
				emailMailboxFormat: 'maildir',
				hasInlineResources: true,
				threadLoadedMessageCount: 3
			});
			expect(lanternInline?.metadata).toMatchObject({
				attachmentDisposition: 'inline',
				attachmentEmbeddedReferenceMatched: true,
				emailAttachmentRole: 'inline_resource',
				emailMailboxContainerSource: 'Lantern',
				emailMailboxFolder: 'cur',
				emailMessageSource: 'Lantern/cur/1713893600.M2P2.mailhost:2,RS'
			});
			expect(quartzInline?.metadata).toMatchObject({
				attachmentDisposition: 'inline',
				attachmentEmbeddedReferenceMatched: true,
				emailAttachmentRole: 'inline_resource',
				emailMailboxContainerSource: 'Quartz',
				emailMailboxFolder: 'cur',
				emailMessageSource: 'Quartz/cur/1713897200.M3P3.mailhost:2,RS'
			});
			expect(lanternArchiveChild?.metadata).toMatchObject({
				emailAttachmentSource:
					'Lantern/cur/1713893600.M2P2.mailhost:2,RS#attachments/lantern.zip',
				emailMailboxContainerSource: 'Lantern',
				emailMailboxFolder: 'cur',
				emailMessageSource: 'Lantern/cur/1713893600.M2P2.mailhost:2,RS'
			});
			expect(quartzArchiveChild?.metadata).toMatchObject({
				emailAttachmentSource:
					'Quartz/cur/1713897200.M3P3.mailhost:2,RS#attachments/quartz.zip',
				emailMailboxContainerSource: 'Quartz',
				emailMailboxFolder: 'cur',
				emailMessageSource: 'Quartz/cur/1713897200.M3P3.mailhost:2,RS'
			});
			expect(lanternChildMessage?.metadata).toMatchObject({
				emailMailboxContainerSource: 'Lantern',
				emailMailboxFlags: ['R', 'S'],
				emailMailboxFolder: 'cur',
				emailMailboxFormat: 'maildir',
				emailMessageLineageCount: 1
			});
			expect(quartzChildMessage?.metadata).toMatchObject({
				emailMailboxContainerSource: 'Quartz',
				emailMailboxFlags: ['R', 'S'],
				emailMailboxFolder: 'cur',
				emailMailboxFormat: 'maildir',
				emailMessageLineageCount: 1
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves maildir mailbox lineage for arbitrary nested mailbox-family depth', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-maildir-lineage-')
		);
		const familyPaths = [
			['Inbox'],
			['Ops', 'Release'],
			['Ops', 'Release', 'Escalations'],
			['Ops', 'Release', 'Escalations', 'Nightly']
		];

		try {
			for (const [index, familyPath] of familyPaths.entries()) {
				const familyDir = join(tempDir, ...familyPath, 'cur');
				mkdirSync(familyDir, { recursive: true });
				writeFileSync(
					join(
						familyDir,
						`171389${index}.M${index}P${index}.mailhost:2,S`
					),
					[
						'Subject: Maildir lineage thread',
						`From: family-${index}@example.com`,
						'To: ops@example.com',
						`Message-ID: <maildir-lineage-${index}@example.com>`,
						'',
						`${familyPath.join('/')} body.`
					].join('\n'),
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-maildir-lineage-temp' },
				directory: tempDir
			});

			expect(loaded.documents).toHaveLength(familyPaths.length);
			for (const [index, familyPath] of familyPaths.entries()) {
				const source = `${familyPath.join('/')}/cur/171389${index}.M${index}P${index}.mailhost:2,S`;
				const document = loaded.documents.find(
					(entry) =>
						entry.metadata?.messageId ===
							`<maildir-lineage-${index}@example.com>` &&
						entry.metadata?.emailKind === 'message'
				);

				expect(document?.source).toBe(source);
				expect(document?.metadata).toMatchObject({
					emailMailboxContainerSource: familyPath.join('/'),
					emailMailboxFamilyKey: familyPath
						.map((segment) => segment.toLowerCase())
						.join('/'),
					emailMailboxFlags: ['S'],
					emailMailboxFolder: 'cur',
					emailMailboxFormat: 'maildir',
					emailMailboxLeaf: familyPath.at(-1),
					emailMailboxPathDepth: familyPath.length,
					emailMailboxPathSegments: familyPath
				});
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('tracks sibling reply ordering and state semantics across maildir replies in one mailbox family', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-maildir-siblings-')
		);
		const rootMessageId = '<maildir-sibling-root@example.com>';
		const replyMessages = [
			{
				body: 'First unread sibling reply.',
				fileName: '1713893600.M2P2.mailhost:2,',
				messageId: '<maildir-sibling-first@example.com>'
			},
			{
				body: 'Second flagged replied sibling reply.',
				fileName: '1713897200.M3P3.mailhost:2,FRS',
				messageId: '<maildir-sibling-second@example.com>'
			},
			{
				body: 'Third draft sibling reply.',
				fileName: '1713900800.M4P4.mailhost:2,D',
				messageId: '<maildir-sibling-third@example.com>'
			}
		];

		try {
			mkdirSync(join(tempDir, 'Ops', 'Release', 'cur'), {
				recursive: true
			});
			mkdirSync(join(tempDir, 'Ops', 'Release', 'new'), {
				recursive: true
			});
			writeFileSync(
				join(
					tempDir,
					'Ops',
					'Release',
					'new',
					'1713890000.M1P1.mailhost'
				),
				[
					'Subject: Maildir sibling thread',
					'From: root@example.com',
					'To: ops@example.com',
					`Message-ID: ${rootMessageId}`,
					'',
					'Root mailbox message.'
				].join('\n'),
				'utf8'
			);
			for (const reply of replyMessages) {
				writeFileSync(
					join(tempDir, 'Ops', 'Release', 'cur', reply.fileName),
					[
						'Subject: Maildir sibling thread',
						`From: ${reply.messageId.replace(/[<>]/g, '')}`,
						'To: ops@example.com',
						`Message-ID: ${reply.messageId}`,
						`In-Reply-To: ${rootMessageId}`,
						`References: ${rootMessageId} ${reply.messageId}`,
						'',
						reply.body
					].join('\n'),
					'utf8'
				);
			}

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-maildir-siblings-temp' },
				directory: tempDir
			});

			expect(loaded.documents).toHaveLength(4);
			const siblingDocuments = replyMessages.map((reply) =>
				loaded.documents.find(
					(document) =>
						document.metadata?.messageId === reply.messageId &&
						document.metadata?.emailKind === 'message'
				)
			);

			for (const [index, document] of siblingDocuments.entries()) {
				expect(document?.metadata).toMatchObject({
					emailMailboxContainerSource: 'Ops/Release',
					emailMailboxFamilyKey: 'ops/release',
					emailMailboxFolder: 'cur',
					emailMailboxFormat: 'maildir',
					emailReplyParentLoaded: true,
					emailReplyParentMessageId: rootMessageId,
					emailReplySiblingCount: 3,
					emailReplySiblingIndex: index,
					emailReplySiblingOrdinal: index + 1,
					emailReplySiblingParentMessageId: rootMessageId,
					emailReplySiblingMessageIds: replyMessages.map(
						(reply) => reply.messageId
					),
					emailReplySiblingSources: replyMessages.map(
						(reply) => `Ops/Release/cur/${reply.fileName}`
					)
				});
			}

			expect(siblingDocuments[0]?.metadata).toMatchObject({
				emailMailboxIsDraft: false,
				emailMailboxIsFlagged: false,
				emailMailboxIsPassed: false,
				emailMailboxIsRead: false,
				emailMailboxIsReplied: false,
				emailMailboxIsTrashed: false,
				emailMailboxIsUnread: true,
				emailMailboxStateFlags: ['unread']
			});
			expect(siblingDocuments[1]?.metadata).toMatchObject({
				emailMailboxFlags: ['F', 'R', 'S'],
				emailMailboxIsDraft: false,
				emailMailboxIsFlagged: true,
				emailMailboxIsPassed: false,
				emailMailboxIsRead: true,
				emailMailboxIsReplied: true,
				emailMailboxIsTrashed: false,
				emailMailboxIsUnread: false,
				emailMailboxStateFlags: ['flagged', 'replied', 'read']
			});
			expect(siblingDocuments[2]?.metadata).toMatchObject({
				emailMailboxFlags: ['D'],
				emailMailboxIsDraft: true,
				emailMailboxIsFlagged: false,
				emailMailboxIsPassed: false,
				emailMailboxIsRead: false,
				emailMailboxIsReplied: false,
				emailMailboxIsTrashed: false,
				emailMailboxIsUnread: true,
				emailMailboxStateFlags: ['draft', 'unread']
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('normalizes named email addresses across from to cc bcc and reply-to headers', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: [
				'Subject: Named headers',
				'From: \"Release Owner\" <owner@example.com>',
				'To: Ops Team <ops@example.com>, Reviewer <reviewer@example.com>',
				'Cc: Release Manager <manager@example.com>',
				'Bcc: Audit Trail <audit@example.com>',
				'Reply-To: Incident Desk <reply@example.com>',
				'Message-ID: <named-headers@example.com>',
				'',
				'Named header body.'
			].join('\n'),
			name: 'named-headers.eml'
		});

		expect(loaded.metadata?.fromAddress).toBe('owner@example.com');
		expect(loaded.metadata?.fromDisplayName).toBe('Release Owner');
		expect(loaded.metadata?.toAddresses).toEqual([
			'ops@example.com',
			'reviewer@example.com'
		]);
		expect(loaded.metadata?.ccAddresses).toEqual(['manager@example.com']);
		expect(loaded.metadata?.bccAddresses).toEqual(['audit@example.com']);
		expect(loaded.metadata?.replyToAddresses).toEqual([
			'reply@example.com'
		]);
		expect(loaded.metadata?.participantAddresses).toEqual([
			'owner@example.com',
			'ops@example.com',
			'reviewer@example.com',
			'manager@example.com',
			'audit@example.com',
			'reply@example.com'
		]);
		expect(loaded.metadata?.participantDisplayNames).toEqual([
			'Release Owner',
			'Ops Team',
			'Reviewer',
			'Release Manager',
			'Audit Trail',
			'Incident Desk'
		]);
	});

	it('segments authored text, quoted history, and forwarded headers in email bodies', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: [
				'Subject: Escalation recap',
				'From: author@example.com',
				'To: team@example.com',
				'Message-ID: <segmented@example.com>',
				'',
				'Authored incident summary.',
				'',
				'On Tue, Apr 21, 2026 at 9:00 AM ops@example.com wrote:',
				'> Quoted owner update.',
				'> Quoted release note.',
				'',
				'---------- Forwarded message ----------',
				'From: escalations@example.com',
				'Date: Tue, Apr 21, 2026 at 8:00 AM',
				'Subject: Prior escalation',
				'To: team@example.com'
			].join('\n'),
			name: 'segmented.eml'
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 180,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.metadata?.emailBodySectionCount).toBe(3);
		expect(loaded.metadata?.emailAuthoredSectionCount).toBe(1);
		expect(loaded.metadata?.emailQuotedSectionCount).toBe(1);
		expect(loaded.metadata?.emailQuotedMaxDepth).toBe(1);
		expect(loaded.metadata?.emailForwardedHeaderSectionCount).toBe(1);
		expect(loaded.metadata?.emailForwardedHeaderFieldCount).toBe(4);
		expect(loaded.metadata?.emailForwardedHeaderFieldNames).toEqual([
			'from',
			'date',
			'subject',
			'to'
		]);
		expect(loaded.metadata?.emailBodySections).toEqual([
			{
				kind: 'authored_text',
				text: 'Authored incident summary.'
			},
			{
				kind: 'quoted_history',
				quotedDepth: 1,
				text: [
					'On Tue, Apr 21, 2026 at 9:00 AM ops@example.com wrote:',
					'> Quoted owner update.',
					'> Quoted release note.'
				].join('\n')
			},
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 8:00 AM',
				forwardedFromAddress: 'escalations@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 8:00 AM',
					from: 'escalations@example.com',
					subject: 'Prior escalation',
					to: 'team@example.com'
				},
				forwardedParticipantAddresses: [
					'escalations@example.com',
					'team@example.com'
				],
				forwardedSubject: 'Prior escalation',
				forwardedTimestamp: '2026-04-21T08:00:00.000Z',
				forwardedToAddresses: ['team@example.com'],
				kind: 'forwarded_headers',
				text: [
					'---------- Forwarded message ----------',
					'From: escalations@example.com',
					'Date: Tue, Apr 21, 2026 at 8:00 AM',
					'Subject: Prior escalation',
					'To: team@example.com'
				].join('\n')
			}
		]);

		expect(prepared.chunks).toHaveLength(3);
		expect(
			prepared.chunks.map((chunk) => chunk.metadata?.emailSectionKind)
		).toEqual(['authored_text', 'quoted_history', 'forwarded_headers']);
		expect(
			prepared.chunks.map((chunk) => chunk.metadata?.sectionKind)
		).toEqual(['email_block', 'email_block', 'email_block']);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			emailSectionKind: 'authored_text',
			sectionPath: ['Escalation recap', 'Authored Text'],
			sectionTitle: 'Authored Text'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			emailQuotedDepth: 1,
			emailSectionKind: 'quoted_history'
		});
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			emailForwardedDate: 'Tue, Apr 21, 2026 at 8:00 AM',
			emailForwardedFromAddress: 'escalations@example.com',
			emailForwardedHeaderFields: {
				date: 'Tue, Apr 21, 2026 at 8:00 AM',
				from: 'escalations@example.com',
				subject: 'Prior escalation',
				to: 'team@example.com'
			},
			emailForwardedParticipantAddresses: [
				'escalations@example.com',
				'team@example.com'
			],
			emailSectionKind: 'forwarded_headers'
		});
		expect(prepared.chunks[1]?.text).toContain('Quoted History');
		expect(prepared.chunks[2]?.text).toContain('Forwarded Headers');
	});

	it('captures nested quoted depth in segmented email bodies', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: [
				'Subject: Nested quotes',
				'From: author@example.com',
				'To: team@example.com',
				'Message-ID: <nested-quotes@example.com>',
				'',
				'Current incident summary.',
				'',
				'On Tue, Apr 21, 2026 at 9:15 AM ops@example.com wrote:',
				'> Prior owner update.',
				'>> Earlier owner note.'
			].join('\n'),
			name: 'nested-quotes.eml'
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 180,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.metadata?.emailQuotedMaxDepth).toBe(2);
		expect(loaded.metadata?.emailBodySections).toEqual([
			{
				kind: 'authored_text',
				text: 'Current incident summary.'
			},
			{
				kind: 'quoted_history',
				quotedDepth: 2,
				text: [
					'On Tue, Apr 21, 2026 at 9:15 AM ops@example.com wrote:',
					'> Prior owner update.',
					'>> Earlier owner note.'
				].join('\n')
			}
		]);
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			emailQuotedDepth: 2,
			emailSectionKind: 'quoted_history'
		});
	});

	it('segments multiple forwarded header groups in one email body as a forwarded chain', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: [
				'Subject: Forwarded chain',
				'From: author@example.com',
				'To: team@example.com',
				'Message-ID: <forwarded-chain@example.com>',
				'',
				'Current incident summary.',
				'',
				'---------- Forwarded message ----------',
				'From: escalations@example.com',
				'Date: Tue, Apr 21, 2026 at 8:00 AM',
				'Subject: Prior escalation',
				'To: team@example.com',
				'',
				'---------- Forwarded message ----------',
				'From: archive@example.com',
				'Date: Tue, Apr 21, 2026 at 7:45 AM',
				'Subject: Earlier archived escalation',
				'To: team@example.com'
			].join('\n'),
			name: 'forwarded-chain.eml'
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 220,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.metadata?.emailForwardedChainCount).toBe(2);
		expect(loaded.metadata?.emailForwardedHeaderSectionCount).toBe(2);
		expect(loaded.metadata?.emailForwardedFromAddress).toBe(
			'escalations@example.com'
		);
		expect(loaded.metadata?.emailForwardedSubject).toBe('Prior escalation');
		expect(loaded.metadata?.emailForwardedChains).toEqual([
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 8:00 AM',
				forwardedFromAddress: 'escalations@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 8:00 AM',
					from: 'escalations@example.com',
					subject: 'Prior escalation',
					to: 'team@example.com'
				},
				forwardedParticipantAddresses: [
					'escalations@example.com',
					'team@example.com'
				],
				forwardedSubject: 'Prior escalation',
				forwardedTimestamp: '2026-04-21T08:00:00.000Z',
				forwardedToAddresses: ['team@example.com'],
				ordinal: 1,
				text: [
					'---------- Forwarded message ----------',
					'From: escalations@example.com',
					'Date: Tue, Apr 21, 2026 at 8:00 AM',
					'Subject: Prior escalation',
					'To: team@example.com'
				].join('\n')
			},
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 7:45 AM',
				forwardedFromAddress: 'archive@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 7:45 AM',
					from: 'archive@example.com',
					subject: 'Earlier archived escalation',
					to: 'team@example.com'
				},
				forwardedParticipantAddresses: [
					'archive@example.com',
					'team@example.com'
				],
				forwardedSubject: 'Earlier archived escalation',
				forwardedTimestamp: '2026-04-21T07:45:00.000Z',
				forwardedToAddresses: ['team@example.com'],
				ordinal: 2,
				text: [
					'---------- Forwarded message ----------',
					'From: archive@example.com',
					'Date: Tue, Apr 21, 2026 at 7:45 AM',
					'Subject: Earlier archived escalation',
					'To: team@example.com'
				].join('\n')
			}
		]);
		expect(
			prepared.chunks.map((chunk) => chunk.metadata?.emailSectionKind)
		).toEqual(['authored_text', 'forwarded_headers', 'forwarded_headers']);
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			emailForwardedChainCount: 2,
			emailForwardedFromAddress: 'escalations@example.com',
			emailForwardedOrdinal: 1,
			emailSectionKind: 'forwarded_headers'
		});
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			emailForwardedChainCount: 2,
			emailForwardedFromAddress: 'archive@example.com',
			emailForwardedOrdinal: 2,
			emailSectionKind: 'forwarded_headers'
		});
	});

	it('segments html-only email bodies into authored text, quoted history, and forwarded headers', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: [
				'Subject: HTML-only thread',
				'From: html-author@example.com',
				'To: team@example.com',
				'Message-ID: <html-only-thread@example.com>',
				'Content-Type: text/html; charset=utf-8',
				'',
				'<html><body>',
				'<p>HTML-only authored summary.</p>',
				'<blockquote>',
				'<div>On Tue, Apr 21, 2026 at 9:30 AM Ops Team &lt;ops@example.com&gt; wrote:</div>',
				'<div>Prior html owner note.</div>',
				'<blockquote><div>Earlier html owner note.</div></blockquote>',
				'</blockquote>',
				'<div>---------- Forwarded message ----------</div>',
				'<div>From: escalations@example.com</div>',
				'<div>Date: Tue, Apr 21, 2026 at 8:00 AM</div>',
				'<div>Subject: HTML prior escalation</div>',
				'<div>To: team@example.com</div>',
				'</body></html>'
			].join('\n'),
			name: 'html-only-thread.eml'
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 220,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.metadata?.emailBodySectionCount).toBe(3);
		expect(loaded.metadata?.emailQuotedMaxDepth).toBe(2);
		expect(loaded.metadata?.emailBodySections).toEqual([
			{
				kind: 'authored_text',
				text: 'HTML-only authored summary.'
			},
			{
				kind: 'quoted_history',
				quotedDepth: 2,
				text: [
					'> On Tue, Apr 21, 2026 at 9:30 AM Ops Team <ops@example.com> wrote:',
					'> Prior html owner note.',
					'>> Earlier html owner note.'
				].join('\n')
			},
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 8:00 AM',
				forwardedFromAddress: 'escalations@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 8:00 AM',
					from: 'escalations@example.com',
					subject: 'HTML prior escalation',
					to: 'team@example.com'
				},
				forwardedParticipantAddresses: [
					'escalations@example.com',
					'team@example.com'
				],
				forwardedSubject: 'HTML prior escalation',
				forwardedTimestamp: '2026-04-21T08:00:00.000Z',
				forwardedToAddresses: ['team@example.com'],
				kind: 'forwarded_headers',
				text: [
					'---------- Forwarded message ----------',
					'From: escalations@example.com',
					'Date: Tue, Apr 21, 2026 at 8:00 AM',
					'Subject: HTML prior escalation',
					'To: team@example.com'
				].join('\n')
			}
		]);
		expect(
			prepared.chunks.map((chunk) => chunk.metadata?.emailSectionKind)
		).toEqual(['authored_text', 'quoted_history', 'forwarded_headers']);
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			emailQuotedDepth: 2,
			emailSectionKind: 'quoted_history'
		});
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			emailForwardedFromAddress: 'escalations@example.com',
			emailForwardedSubject: 'HTML prior escalation',
			emailSectionKind: 'forwarded_headers'
		});
	});

	it('fans out multipart email attachments with thread lineage metadata', async () => {
		const rawEmail = [
			'Subject: Attachment recap',
			'From: ops@example.com',
			'To: team@example.com',
			'Message-ID: <attachment-recap@example.com>',
			'In-Reply-To: <thread-root@example.com>',
			'References: <thread-root@example.com> <attachment-recap@example.com>',
			'Content-Type: multipart/mixed; boundary="boundary-42"',
			'',
			'--boundary-42',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'The attachment carries the release checklist.',
			'--boundary-42',
			'Content-Type: text/markdown; name="checklist.md"',
			'Content-Disposition: attachment; filename="checklist.md"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(
				'# Checklist\n\nKeep attachment lineage and thread metadata visible.',
				'utf8'
			).toString('base64'),
			'--boundary-42--'
		].join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: rawEmail,
					name: 'thread.eml'
				}
			]
		});

		expect(loaded.documents).toHaveLength(2);
		const messageDocument = loaded.documents.find(
			(document) => document.metadata?.emailKind === 'message'
		);
		const attachmentDocument = loaded.documents.find(
			(document) => document.metadata?.emailKind === 'attachment'
		);
		expect(messageDocument?.text).toContain(
			'The attachment carries the release checklist.'
		);
		expect(messageDocument?.metadata).toMatchObject({
			hasAttachments: true,
			inReplyTo: '<thread-root@example.com>',
			messageId: '<attachment-recap@example.com>',
			replyDepth: 2,
			replyReferenceCount: 2,
			threadMessageCount: 2,
			threadMessageIds: [
				'<thread-root@example.com>',
				'<attachment-recap@example.com>'
			],
			threadKey: 'attachment recap',
			threadRootMessageId: '<thread-root@example.com>',
			threadTopic: 'Attachment recap'
		});
		expect(attachmentDocument?.source).toBe(
			'thread.eml#attachments/checklist.md'
		);
		expect(attachmentDocument?.text).toContain('Checklist');
		expect(attachmentDocument?.metadata).toMatchObject({
			attachmentIndex: 0,
			attachmentName: 'checklist.md',
			emailKind: 'attachment',
			inReplyTo: '<thread-root@example.com>',
			messageId: '<attachment-recap@example.com>',
			replyDepth: 2,
			replyReferenceCount: 2,
			threadMessageCount: 2,
			threadMessageIds: [
				'<thread-root@example.com>',
				'<attachment-recap@example.com>'
			],
			threadKey: 'attachment recap',
			threadRootMessageId: '<thread-root@example.com>',
			threadTopic: 'Attachment recap'
		});
	});

	it('preserves inline-resource and archive attachment lineage across nested email extraction paths', async () => {
		const nestedArchive = createStoredZip({
			'nested/inner.zip': createStoredZip({
				'docs/guide.md': '# Guide\n\nNested attachment archive text'
			})
		});
		const rawEmail = [
			'Subject: Nested attachment lineage',
			'From: ops@example.com',
			'To: team@example.com',
			'Message-ID: <nested-lineage@example.com>',
			'In-Reply-To: <thread-root@example.com>',
			'References: <thread-root@example.com> <nested-lineage@example.com>',
			'Content-Type: multipart/mixed; boundary="outer-42"',
			'',
			'--outer-42',
			'Content-Type: multipart/related; boundary="related-42"',
			'',
			'--related-42',
			'Content-Type: multipart/alternative; boundary="alt-42"',
			'',
			'--alt-42',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Inline archive overview.',
			'--alt-42',
			'Content-Type: text/html; charset=utf-8',
			'',
			'<html><body><p>Inline archive overview.</p><p><img src="cid:inline-note@example.com" /></p></body></html>',
			'--alt-42--',
			'--related-42',
			'Content-Type: text/plain; name="inline-note.txt"',
			'Content-Disposition: inline; filename="inline-note.txt"',
			'Content-ID: <inline-note@example.com>',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from('Inline note payload', 'utf8').toString('base64'),
			'--related-42--',
			'--outer-42',
			'Content-Type: application/zip; name="bundle.zip"',
			'Content-Disposition: attachment; filename="bundle.zip"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(nestedArchive).toString('base64'),
			'--outer-42--'
		].join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [{ content: rawEmail, name: 'thread.eml' }]
		});

		const messageDocument = loaded.documents.find(
			(document) => document.metadata?.emailKind === 'message'
		);
		const inlineDocument = loaded.documents.find(
			(document) =>
				document.metadata?.emailKind === 'attachment' &&
				document.metadata?.attachmentName === 'inline-note.txt'
		);
		const nestedArchiveChild = loaded.documents.find(
			(document) =>
				document.metadata?.emailKind === 'attachment' &&
				document.metadata?.attachmentName === 'bundle.zip' &&
				document.metadata?.archiveEntryName === 'guide.md'
		);

		expect(loaded.documents).toHaveLength(3);
		expect(messageDocument?.text).toContain('Inline archive overview.');
		expect(messageDocument?.metadata).toMatchObject({
			attachmentCount: 2,
			attachmentNames: ['inline-note.txt', 'bundle.zip'],
			emailKind: 'message',
			embeddedResourceContentIds: ['<inline-note@example.com>'],
			embeddedResourceCount: 1,
			hasAttachments: true,
			hasInlineResources: true
		});
		expect(inlineDocument?.metadata).toMatchObject({
			attachmentContentId: '<inline-note@example.com>',
			attachmentDisposition: 'inline',
			attachmentEmbeddedReferenceMatched: true,
			attachmentName: 'inline-note.txt',
			emailAttachmentRole: 'inline_resource',
			emailAttachmentSource: 'thread.eml#attachments/inline-note.txt',
			emailKind: 'attachment',
			emailMessageSource: 'thread.eml'
		});
		expect(nestedArchiveChild?.metadata).toMatchObject({
			attachmentDisposition: 'attachment',
			attachmentEmbeddedReferenceMatched: false,
			attachmentName: 'bundle.zip',
			archiveContainerPath: 'nested/inner.zip',
			archiveFullPath: 'nested/inner.zip!docs/guide.md',
			archiveRootName: 'bundle.zip',
			archiveRootSource: 'thread.eml#attachments/bundle.zip',
			emailAttachmentRole: 'file_attachment',
			emailAttachmentSource: 'thread.eml#attachments/bundle.zip',
			emailKind: 'attachment',
			emailMessageSource: 'thread.eml'
		});
		expect(nestedArchiveChild?.text).toContain(
			'Nested attachment archive text'
		);
	});

	it('reconstructs loaded email threads across multiple message uploads', async () => {
		const rootEmail = [
			'Subject: Incident thread',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <root-thread@example.com>',
			'',
			'Root thread body.'
		].join('\n');
		const replyEmail = [
			'Subject: Incident thread',
			'From: reply@example.com',
			'To: ops@example.com',
			'Message-ID: <reply-thread@example.com>',
			'In-Reply-To: <root-thread@example.com>',
			'References: <root-thread@example.com> <reply-thread@example.com>',
			'',
			'Reply thread body.'
		].join('\n');
		const replyWithAttachment = [
			'Subject: Incident thread',
			'From: attachment@example.com',
			'To: ops@example.com',
			'Message-ID: <attachment-thread@example.com>',
			'In-Reply-To: <reply-thread@example.com>',
			'References: <root-thread@example.com> <reply-thread@example.com> <attachment-thread@example.com>',
			'Content-Type: multipart/mixed; boundary="thread-attachments"',
			'',
			'--thread-attachments',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Attachment reply body.',
			'--thread-attachments',
			'Content-Type: text/plain; name="owner.txt"',
			'Content-Disposition: attachment; filename="owner.txt"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from('Owner attachment', 'utf8').toString('base64'),
			'--thread-attachments--'
		].join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{ content: rootEmail, name: 'root.eml' },
				{ content: replyEmail, name: 'reply.eml' },
				{ content: replyWithAttachment, name: 'attachment.eml' }
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<root-thread@example.com>'
		);
		const replyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<reply-thread@example.com>'
		);
		const attachmentReplyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<attachment-thread@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const attachmentDocument = loaded.documents.find(
			(document) =>
				document.metadata?.emailKind === 'attachment' &&
				document.metadata?.attachmentName === 'owner.txt'
		);

		expect(loaded.documents).toHaveLength(4);
		expect(rootDocument?.metadata).toMatchObject({
			threadKnownMessageCount: 3,
			threadKnownMessageIds: [
				'<root-thread@example.com>',
				'<reply-thread@example.com>',
				'<attachment-thread@example.com>'
			],
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 3,
			threadLoadedMessageIds: [
				'<root-thread@example.com>',
				'<reply-thread@example.com>',
				'<attachment-thread@example.com>'
			],
			threadLoadedMessageSources: [
				'root.eml',
				'reply.eml',
				'attachment.eml'
			],
			threadParticipants: [
				'root@example.com',
				'ops@example.com',
				'reply@example.com',
				'attachment@example.com'
			],
			threadRootMessageId: '<root-thread@example.com>'
		});
		expect(replyDocument?.metadata).toMatchObject({
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<root-thread@example.com>',
			emailReplyParentSource: 'root.eml',
			threadLoadedMessageCount: 3
		});
		expect(attachmentReplyDocument?.metadata).toMatchObject({
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<reply-thread@example.com>',
			emailReplyParentSource: 'reply.eml',
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 3
		});
		expect(attachmentDocument?.metadata).toMatchObject({
			emailMessageSource: 'attachment.eml',
			threadKnownMessageCount: 3,
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 3
		});
	});

	it('preserves attached email ancestry and thread linkage for forwarded rfc822 attachments', async () => {
		const rootEmail = [
			'Subject: Incident thread',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <root-thread@example.com>',
			'',
			'Root thread body.'
		].join('\n');
		const forwardedEmail = [
			'Subject: Incident thread',
			'From: forwarded@example.com',
			'To: ops@example.com',
			'Message-ID: <forwarded-thread@example.com>',
			'In-Reply-To: <root-thread@example.com>',
			'References: <root-thread@example.com> <forwarded-thread@example.com>',
			'Content-Type: multipart/mixed; boundary="forwarded-attachments"',
			'',
			'--forwarded-attachments',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Forwarded reply body.',
			'--forwarded-attachments',
			'Content-Type: text/plain; name="owner.txt"',
			'Content-Disposition: attachment; filename="owner.txt"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from('Forwarded owner attachment', 'utf8').toString(
				'base64'
			),
			'--forwarded-attachments--'
		].join('\n');
		const outerEmail = [
			'Subject: Incident bundle',
			'From: bundle@example.com',
			'To: ops@example.com',
			'Message-ID: <bundle@example.com>',
			'Content-Type: multipart/mixed; boundary="bundle-attachments"',
			'',
			'--bundle-attachments',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Forwarded incident thread attached.',
			'--bundle-attachments',
			'Content-Type: message/rfc822; name="forwarded.eml"',
			'Content-Disposition: attachment; filename="forwarded.eml"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(forwardedEmail, 'utf8').toString('base64'),
			'--bundle-attachments--'
		].join('\n');

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{ content: rootEmail, name: 'root.eml' },
				{ content: outerEmail, name: 'bundle.eml' }
			]
		});

		const outerMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<bundle@example.com>'
		);
		const forwardedMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<forwarded-thread@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const forwardedAttachment = loaded.documents.find(
			(document) =>
				document.metadata?.emailKind === 'attachment' &&
				document.metadata?.attachmentName === 'owner.txt'
		);

		expect(loaded.documents).toHaveLength(4);
		expect(outerMessage?.metadata).toMatchObject({
			attachmentCount: 1,
			attachmentNames: ['forwarded.eml'],
			messageId: '<bundle@example.com>',
			threadKey: 'incident bundle'
		});
		expect(forwardedMessage?.source).toBe(
			'bundle.eml#attachments/forwarded.eml'
		);
		expect(forwardedMessage?.text).toContain('Forwarded reply body.');
		expect(forwardedMessage?.metadata).toMatchObject({
			attachmentCount: 1,
			attachmentNames: ['owner.txt'],
			emailAncestorMessageIds: ['<bundle@example.com>'],
			emailAncestorMessageSources: ['bundle.eml'],
			emailContainerAttachmentSource:
				'bundle.eml#attachments/forwarded.eml',
			emailContainerMessageId: '<bundle@example.com>',
			emailContainerMessageSource: 'bundle.eml',
			emailContainerThreadKey: 'incident bundle',
			emailMessageDepth: 1,
			emailMessageSource: 'bundle.eml#attachments/forwarded.eml',
			emailMessageSourceKind: 'attached_message',
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<root-thread@example.com>',
			emailReplyParentSource: 'root.eml',
			inReplyTo: '<root-thread@example.com>',
			threadKnownMessageCount: 2,
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 2,
			threadRootMessageId: '<root-thread@example.com>'
		});
		const forwardedLoadedMessageIds = Array.isArray(
			forwardedMessage?.metadata?.threadLoadedMessageIds
		)
			? forwardedMessage.metadata.threadLoadedMessageIds
			: [];
		const forwardedLoadedMessageSources = Array.isArray(
			forwardedMessage?.metadata?.threadLoadedMessageSources
		)
			? forwardedMessage.metadata.threadLoadedMessageSources
			: [];
		expect([...forwardedLoadedMessageIds].sort()).toEqual([
			'<forwarded-thread@example.com>',
			'<root-thread@example.com>'
		]);
		expect([...forwardedLoadedMessageSources].sort()).toEqual([
			'bundle.eml',
			'bundle.eml#attachments/forwarded.eml',
			'root.eml'
		]);
		expect(forwardedAttachment?.source).toBe(
			'bundle.eml#attachments/forwarded.eml#attachments/owner.txt'
		);
		expect(forwardedAttachment?.text).toContain(
			'Forwarded owner attachment'
		);
		expect(forwardedAttachment?.metadata).toMatchObject({
			attachmentName: 'owner.txt',
			emailAncestorMessageIds: ['<bundle@example.com>'],
			emailAncestorMessageSources: ['bundle.eml'],
			emailContainerAttachmentSource:
				'bundle.eml#attachments/forwarded.eml',
			emailContainerMessageId: '<bundle@example.com>',
			emailContainerMessageSource: 'bundle.eml',
			emailMessageLineage: [
				{
					attachmentSource: 'bundle.eml#attachments/forwarded.eml',
					messageId: '<bundle@example.com>',
					messageSource: 'bundle.eml',
					messageSourceKind: 'root_message',
					threadKey: 'incident bundle'
				}
			],
			emailMessageLineageAttachmentSources: [
				'bundle.eml#attachments/forwarded.eml'
			],
			emailMessageLineageCount: 1,
			emailMessageLineageMessageIds: ['<bundle@example.com>'],
			emailMessageLineageSources: ['bundle.eml'],
			emailMessageDepth: 1,
			emailMessageSource: 'bundle.eml#attachments/forwarded.eml',
			emailMessageSourceKind: 'attached_message',
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<root-thread@example.com>',
			emailReplyParentSource: 'root.eml',
			threadKnownMessageCount: 2,
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 2
		});
	});

	it('preserves attached email ancestry as an ordered lineage for arbitrary nested rfc822 depth', async () => {
		const buildNestedAttachedEmail = (
			level: number,
			maxDepth: number
		): string => {
			const childName = `forwarded-${level + 1}.eml`;
			const childBoundary = `nested-${level}`;
			const baseHeaders = [
				`Subject: Nested level ${level}`,
				`From: level${level}@example.com`,
				'To: ops@example.com',
				`Message-ID: <nested-level-${level}@example.com>`
			];

			if (level >= maxDepth) {
				return [...baseHeaders, '', `Nested body level ${level}.`].join(
					'\n'
				);
			}

			const childEmail = buildNestedAttachedEmail(level + 1, maxDepth);
			return [
				...baseHeaders,
				`Content-Type: multipart/mixed; boundary="${childBoundary}"`,
				'',
				`--${childBoundary}`,
				'Content-Type: text/plain; charset=utf-8',
				'',
				`Nested body level ${level}.`,
				`--${childBoundary}`,
				`Content-Type: message/rfc822; name="${childName}"`,
				`Content-Disposition: attachment; filename="${childName}"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(childEmail, 'utf8').toString('base64'),
				`--${childBoundary}--`
			].join('\n');
		};

		const maxDepth = 5;
		const rootEmail = buildNestedAttachedEmail(1, maxDepth);
		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [{ content: rootEmail, name: 'nested.eml' }]
		});

		for (let level = 1; level <= maxDepth; level += 1) {
			const expectedLineageDepth = level - 1;
			const expectedMessageIds = Array.from(
				{ length: expectedLineageDepth },
				(_, index) => `<nested-level-${index + 1}@example.com>`
			);
			const expectedSources = Array.from(
				{ length: expectedLineageDepth },
				(_, index) =>
					index === 0
						? 'nested.eml'
						: `${'nested.eml'}${Array.from(
								{ length: index },
								(_, attachmentIndex) =>
									`#attachments/forwarded-${attachmentIndex + 2}.eml`
							).join('')}`
			);
			const expectedAttachmentSources = Array.from(
				{ length: expectedLineageDepth },
				(_, index) =>
					`${expectedSources[index]}#attachments/forwarded-${index + 2}.eml`
			);
			const expectedSource =
				level === 1
					? 'nested.eml'
					: (expectedAttachmentSources.at(-1) ?? 'nested.eml');
			const messageDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						`<nested-level-${level}@example.com>` &&
					document.metadata?.emailKind === 'message'
			);

			expect(messageDocument?.source).toBe(expectedSource);
			expect(messageDocument?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: expectedAttachmentSources,
				emailMessageLineageCount: expectedLineageDepth,
				emailMessageLineageMessageIds: expectedMessageIds,
				emailMessageLineageSources: expectedSources,
				emailMessageDepth: expectedLineageDepth
			});
			expect(
				Array.isArray(messageDocument?.metadata?.emailMessageLineage)
					? messageDocument.metadata.emailMessageLineage
					: []
			).toHaveLength(expectedLineageDepth);
		}
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

	it('builds distinct chunk ids for uploaded media summary and segment documents', async () => {
		const transcriber = createRAGMediaTranscriber({
			name: 'upload_media_segments',
			transcribe: () => ({
				segments: [
					{
						endMs: 8000,
						speaker: 'Alex',
						startMs: 0,
						text: 'At timestamp 00:00 to 00:08, the daily standup audio says retrieval, citations, evaluation, and ingest workflows stay aligned across every frontend.'
					},
					{
						endMs: 18000,
						speaker: 'Jordan',
						startMs: 8000,
						text: 'At timestamp 00:08 to 00:18, the follow-up segment says timestamp-aware evidence should remain visible when React users inspect grounded answers.'
					}
				],
				text: 'Audio transcript summary.'
			})
		});

		const upsert = await buildRAGUpsertInputFromUploads({
			extractors: [createRAGMediaFileExtractor(transcriber)],
			uploads: [
				{
					content: Buffer.from([1, 2, 3]).toString('base64'),
					contentType: 'audio/mpeg',
					encoding: 'base64',
					name: 'daily-standup.mp3',
					source: 'uploads/daily-standup.mp3',
					title: 'Uploaded daily standup audio'
				}
			]
		});

		expect(upsert.chunks).toHaveLength(3);
		expect(new Set(upsert.chunks.map((chunk) => chunk.chunkId)).size).toBe(
			3
		);
		expect(
			upsert.chunks.some((chunk) =>
				chunk.text.includes(
					'At timestamp 00:00 to 00:08, the daily standup audio says retrieval, citations, evaluation, and ingest workflows stay aligned across every frontend.'
				)
			)
		).toBe(true);
		expect(
			upsert.chunks.some((chunk) =>
				chunk.text.includes(
					'At timestamp 00:08 to 00:18, the follow-up segment says timestamp-aware evidence should remain visible when React users inspect grounded answers.'
				)
			)
		).toBe(true);
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

	it('uses extractor registry matches before default extractors', async () => {
		const registry = createRAGFileExtractorRegistry([
			{
				name: 'markdown-registry-override',
				contentTypes: ['text/markdown'],
				extractor: createRAGFileExtractor({
					name: 'demo_markdown_override',
					supports: () => true,
					extract: (input) => ({
						format: 'markdown',
						source: input.source ?? input.path ?? input.name,
						text: '# Registry\n\nHandled by the extractor registry.',
						title: 'registry-markdown'
					})
				}),
				extensions: ['.md'],
				priority: 10
			}
		]);

		await withTempFixtureFile(
			'registry.md',
			Buffer.from('# Original\n\nThis should not survive.', 'utf8'),
			async (path) => {
				const loaded = await loadRAGDocumentFile({
					contentType: 'text/markdown',
					extractorRegistry: registry,
					path
				});

				expect(loaded.text).toContain(
					'Handled by the extractor registry.'
				);
				expect(loaded.title).toBe('registry-markdown');
				expect(loaded.metadata?.extractor).toBe(
					'demo_markdown_override'
				);
				expect(loaded.metadata?.extractorRegistryMatch).toBe(
					'markdown-registry-override'
				);
			}
		);
	});

	it('respects defaults-first extractor registry ordering', async () => {
		const registry = createRAGFileExtractorRegistry({
			defaultOrder: 'defaults_first',
			registrations: [
				{
					name: 'markdown-registry-late',
					contentTypes: ['text/markdown'],
					extractor: createRAGFileExtractor({
						name: 'demo_markdown_late',
						supports: () => true,
						extract: (input) => ({
							format: 'markdown',
							source: input.source ?? input.path ?? input.name,
							text: '# Registry Late\n\nThis should lose to defaults.',
							title: 'registry-late'
						})
					}),
					extensions: ['.md'],
					priority: 10
				}
			]
		});

		await withTempFixtureFile(
			'defaults-first.md',
			Buffer.from('# Original\n\nBuilt-in markdown should win.', 'utf8'),
			async (path) => {
				const loaded = await loadRAGDocumentFile({
					contentType: 'text/markdown',
					extractorRegistry: registry,
					path
				});

				expect(loaded.text).toContain('Built-in markdown should win.');
				expect(loaded.metadata?.extractor).not.toBe(
					'demo_markdown_late'
				);
				expect(loaded.metadata?.extractorRegistryMatch).toBeUndefined();
			}
		);
	});

	it('uses extractor registries to include custom extensions during directory ingest', async () => {
		const registry = createRAGFileExtractorRegistry([
			{
				extensions: ['.note'],
				extractor: createRAGFileExtractor({
					name: 'demo_note_extractor',
					supports: () => true,
					extract: (input) => ({
						format: 'text',
						source: input.source ?? input.path ?? input.name,
						text: 'Custom note registry document.',
						title: 'custom-note'
					})
				}),
				priority: 5
			}
		]);
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-registry-'));

		try {
			writeFileSync(
				join(tempDir, 'custom.note'),
				'ignored fallback body',
				'utf8'
			);

			const loaded = await loadRAGDocumentsFromDirectory({
				directory: tempDir,
				extractorRegistry: registry
			});

			expect(loaded.documents).toHaveLength(1);
			expect(loaded.documents[0]?.source).toBe('custom.note');
			expect(loaded.documents[0]?.text).toBe(
				'Custom note registry document.'
			);
			expect(loaded.documents[0]?.metadata?.extractor).toBe(
				'demo_note_extractor'
			);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('supports registry-only extractor chains when defaults are disabled', async () => {
		const registry = createRAGFileExtractorRegistry({
			includeDefaults: false,
			registrations: [
				{
					name: 'note-only',
					extensions: ['.note'],
					extractor: createRAGFileExtractor({
						name: 'note_only_extractor',
						supports: () => true,
						extract: (input) => ({
							format: 'text',
							source: input.source ?? input.path ?? input.name,
							text: 'registry only note',
							title: 'registry-only'
						})
					})
				}
			]
		});

		await withTempFixtureFile(
			'no-default.txt',
			Buffer.from('plain text', 'utf8'),
			async (path) => {
				await expect(
					loadRAGDocumentFile({
						contentType: 'text/plain',
						extractorRegistry: registry,
						path
					})
				).rejects.toThrow(
					'No RAG file extractor matched no-default.txt'
				);
			}
		);
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
				confidence: 0.9,
				metadata: { ocrEngine: 'mock-pdf' },
				regions: [
					{
						confidence: 0.92,
						page: 1,
						text: 'OCR text from scanned PDF',
						x: 12,
						y: 18
					}
				],
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
		expect(loaded.metadata?.ocrConfidence).toBe(0.9);
		expect(loaded.metadata?.ocrPageCount).toBe(1);
		expect(loaded.metadata?.ocrPageStart).toBe(1);
		expect(loaded.metadata?.ocrPageEnd).toBe(1);
		expect(loaded.metadata?.ocrPageNumbers).toEqual([1]);
		expect(loaded.metadata?.ocrRegionCount).toBe(1);
		expect(loaded.metadata?.ocrAverageConfidence).toBeCloseTo(0.91, 5);
		expect(loaded.metadata?.ocrMinConfidence).toBeCloseTo(0.9, 5);
		expect(loaded.metadata?.ocrMaxConfidence).toBeCloseTo(0.92, 5);
		expect(loaded.metadata?.ocrEngine).toBe('mock-pdf');
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.ocrRegions).toMatchObject([
			{ page: 1, text: 'OCR text from scanned PDF', x: 12, y: 18 }
		]);
	});

	it('keeps native PDF structure and attaches OCR evidence for partially readable PDFs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_ocr',
			extractText: () => ({
				confidence: 0.9,
				metadata: { ocrEngine: 'mock-hybrid-pdf' },
				regions: [
					{
						confidence: 0.94,
						page: 1,
						text: 'Stable lane blocked pending remediation.',
						x: 12,
						y: 18
					},
					{
						confidence: 0.89,
						page: 1,
						text: 'Canary lane ready for approval.',
						x: 12,
						y: 34
					}
				],
				text: [
					'Stable lane blocked pending remediation.',
					'Canary lane ready for approval.'
				].join('\n')
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 120,
					provider: ocr
				})
			],
			uploads: [
				{
					content: Buffer.from(
						[
							'%PDF-1.4',
							'1 0 obj',
							'<<>>',
							'stream',
							'BT',
							'(Stable lane) Tj',
							'ET',
							'endstream',
							'endobj',
							'/Type /Page',
							'%%EOF'
						].join('\n'),
						'latin1'
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'hybrid.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);
		const regionOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_region' &&
				document.metadata?.pageNumber === 1 &&
				document.metadata?.regionNumber === 1
		);

		expect(rootDocument?.text).toBe('Stable lane');
		expect(rootDocument?.metadata).toMatchObject({
			ocrEngine: 'mock-hybrid-pdf',
			ocrRegionCount: 2,
			pageCount: 1,
			pdfHybridOCRSupplement: true,
			pdfNativeTextBlockCount: 1,
			pdfNativeTextLength: 11,
			pdfOCRFallbackReason: 'native_below_min_length',
			pdfOCRTextLength: [
				'Stable lane blocked pending remediation.',
				'Canary lane ready for approval.'
			].join('\n').length,
			pdfTextBlockCount: 1,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				text: 'Stable lane',
				textKind: 'paragraph'
			}
		]);
		expect(pageOne?.text).toContain(
			'Stable lane blocked pending remediation.'
		);
		expect(pageOne?.text).toContain('Canary lane ready for approval.');
		expect(pageOne?.metadata).toMatchObject({
			ocrPageAverageConfidence: 0.915,
			ocrRegionCount: 2,
			pageNumber: 1,
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});
		expect(regionOne?.text).toContain(
			'Stable lane blocked pending remediation.'
		);
		expect(regionOne?.metadata).toMatchObject({
			ocrRegionConfidence: 0.94,
			pageNumber: 1,
			pdfTextMode: 'ocr',
			regionNumber: 1,
			sourceNativeKind: 'pdf_region'
		});
	});

	it('keeps native fixture-backed PDF structure while attaching OCR evidence for partially readable PDFs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_fixture_ocr',
			extractText: () => ({
				confidence: 0.91,
				metadata: { ocrEngine: 'fixture-hybrid-pdf' },
				regions: [
					{
						confidence: 0.95,
						page: 1,
						text: 'Stable lane blocked pending remediation closure.',
						x: 12,
						y: 18
					},
					{
						confidence: 0.9,
						page: 1,
						text: 'Lane ownership remains local until approval completes.',
						x: 12,
						y: 34
					}
				],
				text: [
					'Stable lane blocked pending remediation closure.',
					'Lane ownership remains local until approval completes.'
				].join('\n')
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 120,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_partial_native.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_partial_native.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);

		expect(rootDocument?.text).toBe(
			'Stable lane\n\nLane | Status\nStable | Blocked'
		);
		expect(rootDocument?.metadata).toMatchObject({
			ocrEngine: 'fixture-hybrid-pdf',
			pdfHybridOCRSupplement: true,
			pdfOCRFallbackReason: 'native_below_min_length',
			pdfTextBlockCount: 2,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				text: 'Stable lane',
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				text: ['Lane | Status', 'Stable | Blocked'].join('\n'),
				textKind: 'table_like'
			}
		]);
		expect(pageOne?.text).toContain(
			'Stable lane blocked pending remediation closure.'
		);
		expect(pageOne?.text).toContain(
			'Lane ownership remains local until approval completes.'
		);
		expect(pageOne?.metadata).toMatchObject({
			ocrPageAverageConfidence: 0.925,
			ocrRegionCount: 2,
			pageNumber: 1,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});
	});

	it('marks prepared hybrid PDF chunks as native layout with OCR supplement when OCR fills missing evidence', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_mixed_layout_ocr',
			extractText: () => ({
				confidence: 0.92,
				metadata: { ocrEngine: 'mixed-layout-hybrid' },
				regions: [
					{
						confidence: 0.95,
						page: 1,
						text: 'Stable release approval remains blocked until remediation closes.',
						x: 12,
						y: 18
					},
					{
						confidence: 0.89,
						page: 1,
						text: 'Escalation ownership remains local pending approval recovery.',
						x: 12,
						y: 36
					}
				],
				text: [
					'Stable release approval remains blocked until remediation closes.',
					'Escalation ownership remains local pending approval recovery.'
				].join('\n')
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 120,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_mixed_layout.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_mixed_layout.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);
		expect(rootDocument).toBeDefined();
		expect(pageOne?.metadata).toMatchObject({
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});

		const prepared = prepareRAGDocument(rootDocument!, {
			strategy: 'source_aware'
		});
		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextMode: 'hybrid',
			sectionKind: 'pdf_block',
			sectionTitle: 'Release Readiness'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextKind: 'table_like',
			pdfTextMode: 'hybrid',
			sectionKind: 'pdf_block',
			sectionTitle: 'Release Readiness Table'
		});
		expect(prepared.chunks[1]?.text).toContain('Lane | Status');
		expect(rootDocument?.metadata).toMatchObject({
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfHybridOCRSupplement: true,
			pdfTextMode: 'hybrid'
		});
	});

	it('preserves multi-page native PDF structure while OCR supplements the document in hybrid mode', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_multipage_ocr',
			extractText: () => ({
				confidence: 0.9,
				metadata: { ocrEngine: 'multipage-hybrid' },
				regions: [
					{
						confidence: 0.94,
						page: 1,
						text: 'Approval note remains missing on page one.',
						x: 12,
						y: 18
					},
					{
						confidence: 0.91,
						page: 2,
						text: 'Escalation ownership remains local until acknowledgement.',
						x: 12,
						y: 18
					}
				],
				text: [
					'Approval note remains missing on page one.',
					'Escalation ownership remains local until acknowledgement.'
				].join('\n')
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 1000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_multipage.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_multipage.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				text: 'Release Readiness\nStable release approval remains blocked.',
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				text: 'Lane | Status\nStable | Blocked\nCanary | Ready'
			},
			{
				blockNumber: 3,
				pageNumber: 2,
				text: 'Escalation Matrix',
				textKind: 'paragraph'
			},
			{
				blockNumber: 4,
				pageNumber: 2,
				text: 'Environment | Owner\nStable | Release lead\nCanary | On-call'
			}
		]);
		expect(pageOne?.metadata).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});
		expect(pageTwo?.metadata).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});

		const prepared = prepareRAGDocument(rootDocument!, {
			strategy: 'source_aware'
		});
		expect(prepared.chunks).toHaveLength(4);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			sectionTitle: 'Release Readiness'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextKind: 'table_like',
			sectionTitle: 'Release Readiness Table'
		});
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			sectionTitle: 'Escalation Matrix'
		});
		expect(prepared.chunks[3]?.metadata).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextKind: 'table_like',
			sectionTitle: 'Escalation Matrix Table'
		});
	});

	it('keeps figure and table native structure while OCR supplements later-page body evidence in hybrid PDFs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_figure_late_pages_ocr',
			extractText: () => ({
				confidence: 0.91,
				metadata: { ocrEngine: 'figure-late-pages-hybrid' },
				regions: [
					{
						confidence: 0.93,
						page: 2,
						text: 'Escalation ownership remains local until rollback is acknowledged.',
						x: 12,
						y: 20
					}
				],
				text: 'Escalation ownership remains local until rollback is acknowledged.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 1000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_figure_late_pages.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_figure_late_pages.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				semanticRole: 'figure_caption',
				text: 'Figure 4\nStable rollout dependencies.',
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				semanticRole: 'figure_body',
				text: 'Figure body explains the stable rollout path.',
				textKind: 'paragraph'
			},
			{
				blockNumber: 3,
				pageNumber: 1,
				text: 'Lane | Status\nStable | Blocked\nCanary | Ready',
				textKind: 'table_like'
			},
			{
				blockNumber: 4,
				pageNumber: 2,
				text: 'Escalation Matrix',
				textKind: 'paragraph'
			},
			{
				blockNumber: 5,
				pageNumber: 2,
				text: 'Environment | Owner\nStable | Release lead\nCanary | On-call',
				textKind: 'table_like'
			}
		]);
		expect(pageTwo?.text).toContain(
			'Escalation ownership remains local until rollback is acknowledged.'
		);
		expect(pageTwo?.metadata).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});

		const prepared = prepareRAGDocument(rootDocument!, {
			strategy: 'source_aware'
		});
		expect(prepared.chunks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					metadata: expect.objectContaining({
						pageNumber: 1,
						pdfEvidenceMode: 'hybrid',
						pdfEvidenceOrigin: 'native',
						pdfEvidenceSupplement: 'ocr',
						pdfFigureCaptionBlockNumber: 1,
						pdfFigureLabel: 'Figure 4',
						pdfSemanticRole: 'figure_caption',
						sectionTitle: 'Page 1 Figure Caption'
					})
				}),
				expect.objectContaining({
					metadata: expect.objectContaining({
						pageNumber: 1,
						pdfEvidenceMode: 'hybrid',
						pdfEvidenceOrigin: 'native',
						pdfEvidenceSupplement: 'ocr',
						pdfFigureCaptionBlockNumber: 1,
						pdfFigureLabel: 'Figure 4',
						pdfSemanticRole: 'figure_body',
						sectionTitle: 'Figure 4 Body'
					})
				}),
				expect.objectContaining({
					metadata: expect.objectContaining({
						pageNumber: 1,
						pdfEvidenceMode: 'hybrid',
						pdfEvidenceOrigin: 'native',
						pdfEvidenceSupplement: 'ocr',
						pdfTableHeaderText: 'Lane | Status',
						pdfTextKind: 'table_like',
						sectionTitle: 'Page 1 Table Block'
					})
				}),
				expect.objectContaining({
					metadata: expect.objectContaining({
						pageNumber: 2,
						pdfEvidenceMode: 'hybrid',
						pdfEvidenceOrigin: 'native',
						pdfEvidenceSupplement: 'ocr',
						sectionTitle: 'Escalation Matrix'
					})
				}),
				expect.objectContaining({
					metadata: expect.objectContaining({
						pageNumber: 2,
						pdfEvidenceMode: 'hybrid',
						pdfEvidenceOrigin: 'native',
						pdfEvidenceSupplement: 'ocr',
						pdfTableHeaderText: 'Environment | Owner',
						pdfTextKind: 'table_like',
						sectionTitle: 'Escalation Matrix Table'
					})
				})
			])
		);
	});

	it('keeps sliced native PDF tables while OCR supplements later-page evidence in hybrid mode', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_table_slices_ocr',
			extractText: () => ({
				confidence: 0.9,
				metadata: { ocrEngine: 'hybrid-table-slices' },
				regions: [
					{
						confidence: 0.92,
						page: 2,
						text: 'Escalation acknowledgement remains pending until rollback review completes.',
						x: 12,
						y: 18
					}
				],
				text: 'Escalation acknowledgement remains pending until rollback review completes.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 1000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_table_slices.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_table_slices.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextBlockCount: 3,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				text: 'Approval Matrix',
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				text: [
					'Lane | Status',
					'Stable | Blocked pending remediation review',
					'Canary | Ready after approval verification',
					'Rollback | Review after runbook confirmation',
					'Hotfix | Ready once release signoff lands'
				].join('\n'),
				textKind: 'table_like'
			},
			{
				blockNumber: 3,
				pageNumber: 2,
				text: 'Escalation Notes\nFollow-up ownership remains local.',
				textKind: 'paragraph'
			}
		]);
		expect(pageTwo?.text).toContain(
			'Escalation acknowledgement remains pending until rollback review completes.'
		);
		expect(pageTwo?.metadata).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr',
			sourceNativeKind: 'pdf_page'
		});

		const prepared = prepareRAGDocument(rootDocument!, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});
		expect(prepared.chunks).toMatchObject([
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfEvidenceOrigin: 'native',
					pdfEvidenceSupplement: 'ocr',
					sectionTitle: 'Approval Matrix'
				}
			},
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfEvidenceOrigin: 'native',
					pdfEvidenceSupplement: 'ocr',
					pdfTableBodyRowStart: 1,
					pdfTableBodyRowEnd: 2,
					pdfTableChunkKind: 'table_slice',
					pdfTableHeaderText: 'Lane | Status',
					pdfTextKind: 'table_like',
					sectionTitle: 'Approval Matrix Table'
				}
			},
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfEvidenceOrigin: 'native',
					pdfEvidenceSupplement: 'ocr',
					pdfTableBodyRowStart: 3,
					pdfTableBodyRowEnd: 4,
					pdfTableChunkKind: 'table_slice',
					pdfTableHeaderText: 'Lane | Status',
					pdfTextKind: 'table_like',
					sectionTitle: 'Approval Matrix Table'
				}
			},
			{
				metadata: {
					pageNumber: 2,
					pdfEvidenceMode: 'hybrid',
					pdfEvidenceOrigin: 'native',
					pdfEvidenceSupplement: 'ocr',
					sectionTitle: 'Escalation Notes'
				}
			}
		]);
	});

	it('preserves figures, sliced tables, and sidebar suppression together in noisy hybrid PDFs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_sliced_tables_noise_ocr',
			extractText: () => ({
				confidence: 0.91,
				metadata: { ocrEngine: 'hybrid-sliced-tables-noise' },
				regions: [
					{
						confidence: 0.93,
						page: 2,
						text: 'Escalation acknowledgement remains pending until the release lead confirms rollback ownership.',
						x: 12,
						y: 18
					}
				],
				text: 'Escalation acknowledgement remains pending until the release lead confirms rollback ownership.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 1000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_sliced_tables_noise.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_sliced_tables_noise.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.text).not.toContain('Example Report Header');
		expect(rootDocument?.text).not.toContain('Related links');
		expect(rootDocument?.text).not.toContain('Start free trial');
		expect(rootDocument?.text).not.toContain('Contact sales');
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				semanticRole: 'figure_caption',
				text: 'Figure 6\nApproval topology by rollout lane.'
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				semanticRole: 'figure_body',
				text: 'Figure body explains the stable rollout dependency path.'
			},
			{
				blockNumber: 3,
				pageNumber: 1,
				text: 'Approval Matrix',
				textKind: 'paragraph'
			},
			{
				blockNumber: 4,
				pageNumber: 1,
				text: [
					'Lane | Status',
					'Stable | Blocked pending remediation review',
					'Canary | Ready after approval verification',
					'Rollback | Review after runbook confirmation',
					'Hotfix | Ready once release signoff lands'
				].join('\n'),
				textKind: 'table_like'
			},
			{
				blockNumber: 5,
				pageNumber: 2,
				semanticRole: 'figure_caption',
				text: 'Figure 7\nRemediation owner by environment.'
			},
			{
				blockNumber: 6,
				pageNumber: 2,
				semanticRole: 'figure_body',
				text: 'Figure body explains late-page ownership and rollback flow.'
			},
			{
				blockNumber: 7,
				pageNumber: 2,
				text: 'Escalation Matrix',
				textKind: 'paragraph'
			},
			{
				blockNumber: 8,
				pageNumber: 2,
				text: 'Environment | Owner\nStable | Release lead\nCanary | On-call',
				textKind: 'table_like'
			}
		]);
		expect(pageTwo?.text).toContain(
			'Escalation acknowledgement remains pending until the release lead confirms rollback ownership.'
		);

		const prepared = prepareRAGDocument(rootDocument!, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});
		expect(
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Page 1 Figure Caption'
			)?.metadata
		).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 6',
			pdfSemanticRole: 'figure_caption'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Figure 6 Body'
			)?.metadata
		).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 6',
			pdfSemanticRole: 'figure_body'
		});
		expect(
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Approval Matrix Table'
			)
		).toMatchObject([
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfTableBodyRowStart: 1,
					pdfTableBodyRowEnd: 2,
					pdfTableChunkKind: 'table_slice'
				}
			},
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfTableBodyRowStart: 3,
					pdfTableBodyRowEnd: 4,
					pdfTableChunkKind: 'table_slice'
				}
			}
		]);
		expect(
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Page 2 Figure Caption'
			)?.metadata
		).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 7',
			pdfSemanticRole: 'figure_caption'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Figure 7 Body'
			)?.metadata
		).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 7',
			pdfSemanticRole: 'figure_body'
		});
		expect(
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Escalation Matrix Table'
			)?.metadata
		).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfTextKind: 'table_like'
		});
	});

	it('preserves repeated figures and tables while suppressing sidebar noise in noisy hybrid pdfs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_noisy_repeated_pages_ocr',
			extractText: () => ({
				confidence: 0.9,
				metadata: { ocrEngine: 'noisy-repeated-pages-hybrid' },
				regions: [
					{
						confidence: 0.92,
						page: 2,
						text: 'Escalation acknowledgement remains pending on the stable lane.',
						x: 12,
						y: 20
					}
				],
				text: 'Escalation acknowledgement remains pending on the stable lane.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 1000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_noisy_repeated_pages.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_noisy_repeated_pages.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextBlockCount: 7,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.text).not.toContain('Example Report Header');
		expect(rootDocument?.text).not.toContain('Related links');
		expect(rootDocument?.text).not.toContain('Start free trial');
		expect(rootDocument?.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				semanticRole: 'figure_caption',
				text: 'Figure 4\nStable rollout dependencies.'
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				semanticRole: 'figure_body',
				text: 'Figure body explains the stable rollout path.'
			},
			{
				blockNumber: 3,
				pageNumber: 1,
				text: 'Lane | Status\nStable | Blocked\nCanary | Ready',
				textKind: 'table_like'
			},
			{
				blockNumber: 4,
				pageNumber: 2,
				semanticRole: 'figure_caption',
				text: 'Figure 5\nRemediation owner by environment.'
			},
			{
				blockNumber: 5,
				pageNumber: 2,
				semanticRole: 'figure_body',
				text: 'Environment escalation stays local until the stable gate clears.'
			},
			{
				blockNumber: 6,
				pageNumber: 2,
				text: 'Escalation Matrix'
			},
			{
				blockNumber: 7,
				pageNumber: 2,
				text: 'Environment | Owner\nStable | Release lead\nCanary | On-call',
				textKind: 'table_like'
			}
		]);
		expect(pageTwo?.text).toContain(
			'Escalation acknowledgement remains pending on the stable lane.'
		);

		const prepared = prepareRAGDocument(rootDocument!, {
			strategy: 'source_aware'
		});
		expect(prepared.chunks).toMatchObject([
			{
				metadata: {
					pageNumber: 1,
					pdfFigureLabel: 'Figure 4',
					pdfSemanticRole: 'figure_caption',
					sectionTitle: 'Page 1 Figure Caption'
				}
			},
			{
				metadata: {
					pageNumber: 1,
					pdfFigureLabel: 'Figure 4',
					pdfSemanticRole: 'figure_body',
					sectionTitle: 'Figure 4 Body'
				}
			},
			{
				metadata: {
					pageNumber: 1,
					pdfTextKind: 'table_like',
					sectionTitle: 'Page 1 Table Block'
				}
			},
			{
				metadata: {
					pageNumber: 2,
					pdfFigureLabel: 'Figure 5',
					pdfSemanticRole: 'figure_caption',
					sectionTitle: 'Page 2 Figure Caption'
				}
			},
			{
				metadata: {
					pageNumber: 2,
					pdfFigureLabel: 'Figure 5',
					pdfSemanticRole: 'figure_body',
					sectionTitle: 'Figure 5 Body'
				}
			},
			{
				metadata: {
					pageNumber: 2,
					sectionTitle: 'Escalation Matrix'
				}
			},
			{
				metadata: {
					pageNumber: 2,
					pdfTableHeaderText: 'Environment | Owner',
					pdfTextKind: 'table_like',
					sectionTitle: 'Escalation Matrix Table'
				}
			}
		]);
	});

	it('preserves repeated sliced tables and figures across multiple noisy hybrid pdf pages', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_multipage_sliced_tables_noise_ocr',
			extractText: () => ({
				confidence: 0.91,
				metadata: { ocrEngine: 'hybrid-multipage-sliced-tables-noise' },
				regions: [
					{
						confidence: 0.93,
						page: 3,
						text: 'Handoff acknowledgement remains pending until release management confirms rollback coverage.',
						x: 12,
						y: 18
					}
				],
				text: 'Handoff acknowledgement remains pending until release management confirms rollback coverage.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 2000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_multipage_sliced_tables_noise.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_multipage_sliced_tables_noise.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageThree = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 3
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 3,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextBlockCount: 12,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.text).not.toContain('Example Report Header');
		expect(rootDocument?.text).not.toContain('Related links');
		expect(rootDocument?.text).not.toContain('Start free trial');
		expect(rootDocument?.text).not.toContain('Contact sales');
		expect(rootDocument?.text).not.toContain('Upgrade now');
		expect(rootDocument?.metadata?.pdfTextBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockNumber: 1,
					pageNumber: 1,
					semanticRole: 'figure_caption',
					text: 'Figure 8\nApproval flow by rollout lane.'
				}),
				expect.objectContaining({
					blockNumber: 5,
					pageNumber: 2,
					semanticRole: 'figure_caption',
					text: 'Figure 9\nRemediation owner by environment.'
				}),
				expect.objectContaining({
					blockNumber: 9,
					pageNumber: 3,
					semanticRole: 'figure_caption',
					text: 'Figure 10\nHandoff verification by environment.'
				})
			])
		);
		expect(pageThree?.text).toContain(
			'Handoff acknowledgement remains pending until release management confirms rollback coverage.'
		);
		expect(pageThree?.metadata).toMatchObject({
			pageNumber: 3,
			pdfEvidenceMode: 'ocr',
			pdfEvidenceOrigin: 'ocr',
			pdfTextMode: 'ocr'
		});

		const prepared = prepareRAGDocument(rootDocument!, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});
		expect(
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Page 1 Figure Caption'
			)?.metadata
		).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 8',
			pdfSemanticRole: 'figure_caption'
		});
		expect(
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Page 2 Figure Caption'
			)?.metadata
		).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 9',
			pdfSemanticRole: 'figure_caption'
		});
		expect(
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Page 3 Figure Caption'
			)?.metadata
		).toMatchObject({
			pageNumber: 3,
			pdfEvidenceMode: 'hybrid',
			pdfFigureLabel: 'Figure 10',
			pdfSemanticRole: 'figure_caption'
		});

		expect(
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.sectionTitle === 'Approval Matrix Table'
			)
		).toMatchObject([
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfTableBodyRowStart: 1,
					pdfTableBodyRowEnd: 2,
					pdfTableChunkKind: 'table_slice'
				}
			},
			{
				metadata: {
					pageNumber: 1,
					pdfEvidenceMode: 'hybrid',
					pdfTableBodyRowStart: 3,
					pdfTableBodyRowEnd: 4,
					pdfTableChunkKind: 'table_slice'
				}
			}
		]);
		const escalationTableChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.sectionTitle === 'Escalation Matrix Table'
		);
		expect(
			escalationTableChunks.map((chunk) => ({
				end: chunk.metadata?.pdfTableBodyRowEnd,
				mode: chunk.metadata?.pdfEvidenceMode,
				pageNumber: chunk.metadata?.pageNumber,
				start: chunk.metadata?.pdfTableBodyRowStart,
				kind: chunk.metadata?.pdfTableChunkKind
			}))
		).toEqual([
			{
				end: 1,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 2,
				start: 1
			},
			{
				end: 2,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 2,
				start: 2
			},
			{
				end: 3,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 2,
				start: 3
			},
			{
				end: 4,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 2,
				start: 4
			}
		]);
		const handoffTableChunks = prepared.chunks.filter(
			(chunk) => chunk.metadata?.sectionTitle === 'Handoff Matrix Table'
		);
		expect(
			handoffTableChunks.map((chunk) => ({
				end: chunk.metadata?.pdfTableBodyRowEnd,
				mode: chunk.metadata?.pdfEvidenceMode,
				pageNumber: chunk.metadata?.pageNumber,
				start: chunk.metadata?.pdfTableBodyRowStart,
				kind: chunk.metadata?.pdfTableChunkKind
			}))
		).toEqual([
			{
				end: 1,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 3,
				start: 1
			},
			{
				end: 2,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 3,
				start: 2
			},
			{
				end: 3,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 3,
				start: 3
			},
			{
				end: 4,
				kind: 'table_slice',
				mode: 'hybrid',
				pageNumber: 3,
				start: 4
			}
		]);
	});

	it('preserves mixed multi-column layout with sliced tables and OCR supplement in hybrid PDFs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_multicolumn_sliced_tables_noise_ocr',
			extractText: () => ({
				confidence: 0.91,
				metadata: {
					ocrEngine: 'hybrid-multicolumn-sliced-tables-noise'
				},
				regions: [
					{
						confidence: 0.93,
						page: 2,
						text: 'Late-page OCR supplement keeps acknowledgement evidence visible when native layout is incomplete.',
						x: 12,
						y: 18
					}
				],
				text: 'Late-page OCR supplement keeps acknowledgement evidence visible when native layout is incomplete.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 2000,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_multicolumn_sliced_tables_noise.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_multicolumn_sliced_tables_noise.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 2,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextBlockCount: 12,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.text).not.toContain('Example Report Header');
		expect(rootDocument?.text).not.toContain('Related links');
		expect(rootDocument?.text).not.toContain('Start free trial');
		expect(rootDocument?.text).not.toContain('Contact sales');
		expect(rootDocument?.metadata?.pdfTextBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockNumber: 1,
					pageNumber: 1,
					text: [
						'Overview Column',
						'Stable approval evidence stays attached to the blocking gate.'
					].join('\n'),
					textKind: 'paragraph'
				}),
				expect.objectContaining({
					blockNumber: 2,
					pageNumber: 1,
					text: [
						'Details Column',
						'Candidate evidence should keep native layout ahead of OCR supplement.'
					].join('\n'),
					textKind: 'paragraph'
				}),
				expect.objectContaining({
					blockNumber: 7,
					pageNumber: 2,
					text: [
						'Operations Column',
						'Escalation evidence should stay local to the late-page control plane.'
					].join('\n'),
					textKind: 'paragraph'
				}),
				expect.objectContaining({
					blockNumber: 8,
					pageNumber: 2,
					text: [
						'Evidence Column',
						'Hybrid PDF reconciliation should keep native sections ahead of OCR-only passages.'
					].join('\n'),
					textKind: 'paragraph'
				})
			])
		);
		expect(pageTwo?.text).toContain(
			'Late-page OCR supplement keeps acknowledgement evidence visible when native layout is incomplete.'
		);

		const prepared = prepareRAGDocument(rootDocument!, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Overview Column'
			)?.metadata
		).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid',
			pdfTextKind: 'paragraph'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Operations Column'
			)?.metadata
		).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid',
			pdfTextKind: 'paragraph'
		});
		expect(
			prepared.chunks
				.filter(
					(chunk) =>
						chunk.metadata?.sectionTitle === 'Approval Matrix Table'
				)
				.map((chunk) => ({
					end: chunk.metadata?.pdfTableBodyRowEnd,
					pageNumber: chunk.metadata?.pageNumber,
					start: chunk.metadata?.pdfTableBodyRowStart
				}))
		).toEqual([
			{ end: 1, pageNumber: 1, start: 1 },
			{ end: 2, pageNumber: 1, start: 2 },
			{ end: 3, pageNumber: 1, start: 3 },
			{ end: 4, pageNumber: 1, start: 4 }
		]);
		expect(
			prepared.chunks
				.filter(
					(chunk) =>
						chunk.metadata?.sectionTitle ===
						'Escalation Matrix Table'
				)
				.map((chunk) => ({
					end: chunk.metadata?.pdfTableBodyRowEnd,
					pageNumber: chunk.metadata?.pageNumber,
					start: chunk.metadata?.pdfTableBodyRowStart
				}))
		).toEqual([
			{ end: 1, pageNumber: 2, start: 1 },
			{ end: 2, pageNumber: 2, start: 2 },
			{ end: 3, pageNumber: 2, start: 3 },
			{ end: 4, pageNumber: 2, start: 4 }
		]);
	});

	it('preserves repeated mixed columns, figures, and sliced tables across multi-page hybrid stress PDFs', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_hybrid_multicolumn_multipage_stress_ocr',
			extractText: () => ({
				confidence: 0.91,
				metadata: { ocrEngine: 'hybrid-multicolumn-multipage-stress' },
				regions: [
					{
						confidence: 0.93,
						page: 3,
						text: 'Late-page OCR supplement keeps acknowledgement evidence visible beside native handoff structure.',
						x: 12,
						y: 18
					}
				],
				text: 'Late-page OCR supplement keeps acknowledgement evidence visible beside native handoff structure.'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					minExtractedTextLength: 2600,
					provider: ocr
				})
			],
			uploads: [
				{
					content: readFileSync(
						join(
							EXTRACTION_FIXTURE_DIRECTORY,
							'pdf_hybrid_multicolumn_multipage_stress.pdf'
						)
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'pdf_hybrid_multicolumn_multipage_stress.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'hybrid'
		);
		const pageThree = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 3
		);

		expect(rootDocument?.metadata).toMatchObject({
			pageCount: 3,
			pdfEvidenceMode: 'hybrid',
			pdfEvidenceOrigin: 'native',
			pdfEvidenceSupplement: 'ocr',
			pdfTextBlockCount: 18,
			pdfTextMode: 'hybrid'
		});
		expect(rootDocument?.text).not.toContain('Example Report Header');
		expect(rootDocument?.text).not.toContain('Related links');
		expect(rootDocument?.text).not.toContain('Start free trial');
		expect(rootDocument?.text).not.toContain('Contact sales');
		expect(rootDocument?.text).not.toContain('Upgrade now');
		expect(rootDocument?.metadata?.pdfTextBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockNumber: 1,
					pageNumber: 1,
					text: [
						'Overview Column',
						'Stable rollout evidence stays attached to the blocking gate.'
					].join('\n'),
					textKind: 'paragraph'
				}),
				expect.objectContaining({
					blockNumber: 7,
					pageNumber: 2,
					text: [
						'Operations Column',
						'Escalation evidence should stay local to the mid-rollout control plane.'
					].join('\n'),
					textKind: 'paragraph'
				}),
				expect.objectContaining({
					blockNumber: 13,
					pageNumber: 3,
					text: [
						'Handoff Column',
						'Late-page handoff evidence should stay visible with OCR supplement.'
					].join('\n'),
					textKind: 'paragraph'
				})
			])
		);
		expect(pageThree?.text).toContain(
			'Late-page OCR supplement keeps acknowledgement evidence visible beside native handoff structure.'
		);

		const prepared = prepareRAGDocument(rootDocument!, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Overview Column'
			)?.metadata
		).toMatchObject({
			pageNumber: 1,
			pdfEvidenceMode: 'hybrid'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Operations Column'
			)?.metadata
		).toMatchObject({
			pageNumber: 2,
			pdfEvidenceMode: 'hybrid'
		});
		expect(
			prepared.chunks.find(
				(chunk) => chunk.metadata?.sectionTitle === 'Handoff Column'
			)?.metadata
		).toMatchObject({
			pageNumber: 3,
			pdfEvidenceMode: 'hybrid'
		});
		expect(
			prepared.chunks
				.filter(
					(chunk) =>
						chunk.metadata?.sectionTitle === 'Approval Matrix Table'
				)
				.map((chunk) => ({
					end: chunk.metadata?.pdfTableBodyRowEnd,
					pageNumber: chunk.metadata?.pageNumber,
					start: chunk.metadata?.pdfTableBodyRowStart
				}))
		).toEqual([
			{ end: 1, pageNumber: 1, start: 1 },
			{ end: 2, pageNumber: 1, start: 2 },
			{ end: 3, pageNumber: 1, start: 3 },
			{ end: 4, pageNumber: 1, start: 4 }
		]);
		expect(
			prepared.chunks
				.filter(
					(chunk) =>
						chunk.metadata?.sectionTitle ===
						'Escalation Matrix Table'
				)
				.map((chunk) => ({
					end: chunk.metadata?.pdfTableBodyRowEnd,
					pageNumber: chunk.metadata?.pageNumber,
					start: chunk.metadata?.pdfTableBodyRowStart
				}))
		).toEqual([
			{ end: 1, pageNumber: 2, start: 1 },
			{ end: 2, pageNumber: 2, start: 2 },
			{ end: 3, pageNumber: 2, start: 3 },
			{ end: 4, pageNumber: 2, start: 4 }
		]);
		expect(
			prepared.chunks
				.filter(
					(chunk) =>
						chunk.metadata?.sectionTitle === 'Handoff Matrix Table'
				)
				.map((chunk) => ({
					end: chunk.metadata?.pdfTableBodyRowEnd,
					pageNumber: chunk.metadata?.pageNumber,
					start: chunk.metadata?.pdfTableBodyRowStart
				}))
		).toEqual([
			{ end: 1, pageNumber: 3, start: 1 },
			{ end: 2, pageNumber: 3, start: 2 },
			{ end: 3, pageNumber: 3, start: 3 },
			{ end: 4, pageNumber: 3, start: 4 }
		]);
	});

	it('prefers strong OCR regions in the root summary while keeping low-confidence evidence inspectable', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_confidence_aware_ocr',
			extractText: () => ({
				confidence: 0.79,
				metadata: { ocrEngine: 'confidence-aware' },
				regions: [
					{
						confidence: 0.96,
						page: 1,
						text: 'Release approval status',
						x: 10,
						y: 12
					},
					{
						confidence: 0.41,
						page: 1,
						text: 'illegible approval glyphs',
						x: 10,
						y: 28
					},
					{
						confidence: 0.93,
						page: 1,
						text: 'Stable lane blocked pending approval.',
						x: 10,
						y: 44
					}
				],
				text: [
					'Release approval status',
					'illegible approval glyphs',
					'Stable lane blocked pending approval.'
				].join('\n')
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					alwaysOCR: true,
					provider: ocr
				})
			],
			uploads: [
				{
					content: Buffer.from(
						'%PDF-1.4\n/Type /Page\n%%EOF',
						'latin1'
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'confidence-scan.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'ocr'
		);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);
		const lowConfidenceRegion = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_region' &&
				document.metadata?.pageNumber === 1 &&
				document.metadata?.regionNumber === 2
		);

		expect(rootDocument?.text).toBe(
			[
				'Release approval status',
				'Stable lane blocked pending approval.'
			].join('\n')
		);
		expect(rootDocument?.text).not.toContain('illegible approval glyphs');
		expect(rootDocument?.metadata).toMatchObject({
			ocrLowConfidenceRegionCount: 1,
			ocrStrongRegionCount: 2,
			ocrSummaryConfidenceThreshold: 0.75,
			ocrSummaryUsedStrongRegionsOnly: true,
			pdfTextMode: 'ocr'
		});
		expect(pageOne?.text).toContain('illegible approval glyphs');
		expect(lowConfidenceRegion?.text).toContain(
			'illegible approval glyphs'
		);
		expect(lowConfidenceRegion?.metadata).toMatchObject({
			ocrRegionConfidence: 0.41,
			regionNumber: 2,
			sourceNativeKind: 'pdf_region'
		});
	});

	it('emits source-native PDF page documents from OCR regions', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_page_ocr',
			extractText: () => ({
				confidence: 0.88,
				regions: [
					{
						confidence: 0.91,
						page: 1,
						text: 'Page one heading',
						x: 10,
						y: 12
					},
					{
						confidence: 0.87,
						page: 1,
						text: 'Page one body',
						x: 10,
						y: 28
					},
					{
						confidence: 0.86,
						page: 2,
						text: 'Page two heading',
						x: 10,
						y: 12
					}
				],
				text: 'Page one heading Page one body Page two heading'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					alwaysOCR: true,
					provider: ocr
				})
			],
			uploads: [
				{
					content: Buffer.from(
						'%PDF-1.4\n/Type /Page\n/Type /Page\n%%EOF',
						'latin1'
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'scan.pdf'
				}
			]
		});

		expect(loaded.documents).toHaveLength(6);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);
		const pageTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 2
		);
		expect(pageOne?.title).toBe('Page 1');
		expect(pageOne?.text).toContain('PDF page 1 from scan.pdf');
		expect(pageOne?.text).toContain('Page one heading');
		expect(pageOne?.metadata).toMatchObject({
			ocrPageAverageConfidence: 0.89,
			ocrPageConfidence: 0.89,
			ocrPageMaxConfidence: 0.91,
			ocrPageMinConfidence: 0.87,
			ocrRegionCount: 2,
			ocrRegionNumbers: [1, 2],
			pageIndex: 0,
			pageNumber: 1,
			sourceNativeKind: 'pdf_page'
		});
		expect(pageTwo?.text).toContain('Page two heading');
		expect(pageTwo?.metadata).toMatchObject({
			ocrPageAverageConfidence: 0.86,
			ocrPageConfidence: 0.86,
			ocrPageMaxConfidence: 0.86,
			ocrPageMinConfidence: 0.86,
			ocrRegionCount: 1,
			ocrRegionNumbers: [1],
			pageIndex: 1,
			pageNumber: 2,
			sourceNativeKind: 'pdf_page'
		});
		const regionOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_region' &&
				document.metadata?.pageNumber === 1 &&
				document.metadata?.regionNumber === 1
		);
		expect(regionOne?.title).toBe('Page 1 Region 1');
		expect(regionOne?.text).toContain('PDF page 1 region 1 from scan.pdf');
		expect(regionOne?.metadata).toMatchObject({
			ocrPageCount: 1,
			ocrPageNumbers: [1],
			ocrRegionConfidence: 0.91,
			pageIndex: 0,
			pageNumber: 1,
			regionIndex: 0,
			regionNumber: 1,
			sourceNativeKind: 'pdf_region'
		});
		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'ocr'
		);
		expect(rootDocument?.metadata).toMatchObject({
			ocrPageCount: 2,
			ocrPageEnd: 2,
			ocrPageStart: 1
		});
	});

	it('reconstructs OCR page reading order from out-of-order regions', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_reading_order_ocr',
			extractText: () => ({
				confidence: 0.9,
				regions: [
					{
						confidence: 0.9,
						page: 1,
						text: 'right',
						x: 120,
						y: 10
					},
					{
						confidence: 0.9,
						page: 1,
						text: 'left',
						x: 10,
						y: 10
					},
					{
						confidence: 0.88,
						page: 1,
						text: 'next line',
						x: 10,
						y: 40
					}
				],
				text: 'right left next line'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					alwaysOCR: true,
					provider: ocr
				})
			],
			uploads: [
				{
					content: Buffer.from(
						'%PDF-1.4\n/Type /Page\n%%EOF',
						'latin1'
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'reading-order-scan.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'ocr'
		);
		const pageOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'pdf_page' &&
				document.metadata?.pageNumber === 1
		);

		expect(rootDocument?.text).toBe('left right\nnext line');
		expect(pageOne?.text).toContain('left right');
		expect(pageOne?.text).toContain('next line');
		expect(pageOne?.text).not.toContain('right left');
	});

	it('reconstructs clear two-column OCR pages in column order', async () => {
		const ocr = createRAGOCRProvider({
			name: 'pdf_two_column_ocr',
			extractText: () => ({
				confidence: 0.9,
				regions: [
					{ page: 1, text: 'Right top', x: 210, y: 10 },
					{ page: 1, text: 'Left top', x: 10, y: 10 },
					{ page: 1, text: 'Right bottom', x: 210, y: 40 },
					{ page: 1, text: 'Left bottom', x: 10, y: 40 }
				],
				text: 'Right top Left top Right bottom Left bottom'
			})
		});

		const loaded = await loadRAGDocumentsFromUploads({
			extractors: [
				createRAGPDFOCRExtractor({
					alwaysOCR: true,
					provider: ocr
				})
			],
			uploads: [
				{
					content: Buffer.from(
						'%PDF-1.4\n/Type /Page\n%%EOF',
						'latin1'
					).toString('base64'),
					contentType: 'application/pdf',
					encoding: 'base64',
					name: 'two-column-scan.pdf'
				}
			]
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				!document.metadata?.sourceNativeKind &&
				document.metadata?.pdfTextMode === 'ocr'
		);
		expect(rootDocument?.text).toBe(
			'Left top\nLeft bottom\n\nRight top\nRight bottom'
		);
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

	it('loads fixture-backed markdown, html, pdf, email, and rtf files from disk', async () => {
		const markdown = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'sample.md')
		});
		const html = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'sample.html')
		});
		const preparedHtml = prepareRAGDocument(html);
		const pdf = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'evidence.pdf')
		});
		const email = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'message.eml')
		});
		const rtf = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'notes.rtf')
		});

		expect(markdown.text).toContain('Release Control Guide');
		expect(markdown.text).toContain(
			'Stable approvals should stay explicit'
		);
		expect(preparedHtml.normalizedText).toContain('Release Ops Overview');
		expect(preparedHtml.normalizedText).toContain(
			'Stable blockers should explain'
		);
		expect(preparedHtml.normalizedText).toContain(
			'release control guide (absolutejs.dev/docs/release-control)'
		);
		expect(preparedHtml.normalizedText).toContain(
			'handoff playbook (/docs/handoffs)'
		);
		expect(preparedHtml.normalizedText).not.toContain(
			'Docs | Pricing | Sign in'
		);
		expect(preparedHtml.normalizedText).not.toContain(
			'Copyright Example Corp'
		);
		expect(pdf.text).toContain('AbsoluteJS fixture PDF evidence');
		expect(pdf.metadata?.pageCount).toBe(2);
		expect(email.metadata?.threadTopic).toBe('Release incident recap');
		expect(email.metadata?.messageId).toBe('<release-recap@example.com>');
		expect(email.metadata?.inReplyTo).toBe('<incident-root@example.com>');
		expect(email.text).toContain(
			'Stable incident acknowledged and resolved'
		);
		expect(rtf.text).toContain('Fixture RTF');
		expect(rtf.text).toContain('remediation workflows');
	});

	it('preserves simple PDF layout cues from native text operators', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'layout.pdf')
		});

		expect(loaded.text).toBe(
			[
				'Release Summary',
				'Stable gate blocked',
				'Next step: inspect approval state.'
			].join('\n')
		);
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 3,
				pageNumber: 1,
				text: [
					'Release Summary',
					'Stable gate blocked',
					'Next step: inspect approval state.'
				].join('\n'),
				textKind: 'paragraph'
			}
		]);
	});

	it('preserves simple PDF table rows from TJ array gaps', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'table.pdf')
		});

		expect(loaded.text).toBe(
			['Metric | Status', 'Latency | Ready', 'Escalation | Blocked'].join(
				'\n'
			)
		);
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 3,
				pageNumber: 1,
				text: [
					'Metric | Status',
					'Latency | Ready',
					'Escalation | Blocked'
				].join('\n'),
				textKind: 'table_like'
			}
		]);
	});

	it('preserves simple multi-block PDF reading order in fixture coverage', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'pdf_multicolumn_layout.pdf'
			)
		});

		expect(loaded.text).toBe(
			[
				'Overview Column',
				'Stable blockers stay explicit.',
				'',
				'Details Column',
				'Approval state belongs beside the blocking gate.'
			].join('\n')
		);
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Overview Column',
					'Stable blockers stay explicit.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Details Column',
					'Approval state belongs beside the blocking gate.'
				].join('\n'),
				textKind: 'paragraph'
			}
		]);
	});

	it('preserves multi-column reading order in fixture coverage even with sidebar noise', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'pdf_multicolumn_noise.pdf'
			)
		});

		expect(loaded.text).toBe(
			[
				'Overview Column',
				'Stable blockers stay explicit in the rollout record.',
				'',
				'Details Column',
				'Approval state belongs beside the blocking gate.'
			].join('\n')
		);
		expect(loaded.text).not.toContain('Related links');
		expect(loaded.text).not.toContain('/docs/release-gates');
		expect(loaded.text).not.toContain('Start free trial');
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Overview Column',
					'Stable blockers stay explicit in the rollout record.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Details Column',
					'Approval state belongs beside the blocking gate.'
				].join('\n'),
				textKind: 'paragraph'
			}
		]);
	});

	it('preserves mixed paragraph and table region cues in fixture coverage', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_table_regions.pdf')
		});

		expect(loaded.text).toBe(
			[
				'Release Readiness',
				'Stable lane remains blocked until approval is recorded.',
				'',
				'Metric | Status',
				'Approval | Blocked',
				'Latency | Ready',
				'',
				'Next action: inspect release status.'
			].join('\n')
		);
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(3);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 2,
				pageNumber: 1,
				text: [
					'Release Readiness',
					'Stable lane remains blocked until approval is recorded.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				lineCount: 3,
				pageNumber: 1,
				text: [
					'Metric | Status',
					'Approval | Blocked',
					'Latency | Ready'
				].join('\n'),
				textKind: 'table_like'
			},
			{
				blockNumber: 3,
				lineCount: 1,
				pageNumber: 1,
				text: ['Next action: inspect release status.'].join('\n'),
				textKind: 'paragraph'
			}
		]);
	});

	it('uses separate source-aware PDF chunks for paragraph and table regions on the same page', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_table_regions.pdf')
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 160,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(prepared.chunks).toHaveLength(3);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfBlockNumber: 1,
			pdfTextKind: 'paragraph',
			sectionKind: 'pdf_block',
			sectionTitle: 'Release Readiness'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfBlockNumber: 2,
			pdfTableHeaders: ['Metric', 'Status'],
			pdfTableRowCount: 3,
			pdfTextKind: 'table_like',
			sectionKind: 'pdf_block',
			sectionTitle: 'Release Readiness Table'
		});
		expect(prepared.chunks[1]?.text).toContain('Metric | Status');
		expect(prepared.chunks[1]?.text).toContain('Approval | Blocked');
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfBlockNumber: 3,
			pdfTextKind: 'paragraph',
			sectionKind: 'pdf_block',
			sectionTitle: 'Page 1 Text Block'
		});
		expect(prepared.chunks[2]?.text).toContain(
			'Next action: inspect release status.'
		);
	});

	it('preserves repeated same-page heading context across multiple dense pdf tables', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_dense_tables.pdf')
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 220,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.text).not.toContain('Related links');
		expect(loaded.text).not.toContain('Start free trial');
		expect(loaded.metadata?.pdfTextBlockCount).toBe(4);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				text: [
					'Approval Matrix',
					'Stable release approval remains blocked until remediation closes.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				text: [
					'Lane | Status',
					'Stable | Blocked',
					'Canary | Ready'
				].join('\n'),
				textKind: 'table_like'
			},
			{
				blockNumber: 3,
				text: [
					'Escalation Matrix',
					'Escalation ownership stays local until incident acknowledgement completes.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 4,
				text: [
					'Environment | Owner',
					'Stable | Release lead',
					'Canary | On-call'
				].join('\n'),
				textKind: 'table_like'
			}
		]);
		expect(prepared.chunks).toHaveLength(4);
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pdfBlockNumber: 2,
			pdfTableHeaders: ['Lane', 'Status'],
			pdfTableColumnCount: 2,
			pdfTableBodyRowCount: 2,
			pdfTableRowCount: 3,
			pdfTableSignature: 'Lane | Status',
			pdfTextKind: 'table_like',
			sectionTitle: 'Approval Matrix Table'
		});
		expect(prepared.chunks[3]?.metadata).toMatchObject({
			pdfBlockNumber: 4,
			pdfTableHeaders: ['Environment', 'Owner'],
			pdfTableColumnCount: 2,
			pdfTableBodyRowCount: 2,
			pdfTableRowCount: 3,
			pdfTableSignature: 'Environment | Owner',
			pdfTextKind: 'table_like',
			sectionTitle: 'Escalation Matrix Table'
		});
	});

	it('repeats the header row when chunking oversized pdf tables', async () => {
		const loaded = await loadRAGDocumentUpload({
			content: Buffer.from(
				[
					'%PDF-1.4',
					'1 0 obj',
					'<<>>',
					'stream',
					'BT',
					'(Approval Matrix) Tj',
					'T*',
					'(Stable release approval remains blocked until remediation closes.) Tj',
					'ET',
					'endstream',
					'endobj',
					'2 0 obj',
					'<<>>',
					'stream',
					'BT',
					'(Lane | Status) Tj',
					'T*',
					'(Stable | Blocked pending remediation review) Tj',
					'T*',
					'(Canary | Ready after approval verification) Tj',
					'T*',
					'(Rollback | Review after runbook confirmation) Tj',
					'T*',
					'(Hotfix | Ready once release signoff lands) Tj',
					'ET',
					'endstream',
					'endobj',
					'/Type /Page',
					'%%EOF'
				].join('\n'),
				'latin1'
			).toString('base64'),
			contentType: 'application/pdf',
			encoding: 'base64',
			name: 'oversized-table.pdf'
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		const tableChunks = prepared.chunks.filter(
			(chunk) => chunk.metadata?.sectionTitle === 'Approval Matrix Table'
		);
		expect(tableChunks).toHaveLength(2);
		expect(tableChunks[0]?.text).toContain('Lane | Status');
		expect(tableChunks[0]?.text).toContain(
			'Stable | Blocked pending remediation review'
		);
		expect(tableChunks[0]?.text).toContain(
			'Canary | Ready after approval verification'
		);
		expect(tableChunks[1]?.text).toContain('Lane | Status');
		expect(tableChunks[1]?.text).toContain(
			'Rollback | Review after runbook confirmation'
		);
		expect(tableChunks[1]?.text).toContain(
			'Hotfix | Ready once release signoff lands'
		);
		expect(tableChunks[0]?.metadata).toMatchObject({
			pdfTableBodyRowStart: 1,
			pdfTableBodyRowEnd: 2,
			pdfTableBodyRowCount: 2,
			pdfTableChunkKind: 'table_slice',
			pdfTableColumnCount: 2,
			pdfTableHeaderText: 'Lane | Status',
			pdfTableHeaders: ['Lane', 'Status'],
			pdfTableRowCount: 3,
			pdfTableSignature: 'Lane | Status',
			sourceAwareChunkReason: 'size_limit'
		});
		expect(tableChunks[1]?.metadata).toMatchObject({
			pdfTableBodyRowStart: 3,
			pdfTableBodyRowEnd: 4,
			pdfTableBodyRowCount: 2,
			pdfTableChunkKind: 'table_slice',
			pdfTableColumnCount: 2,
			pdfTableHeaderText: 'Lane | Status',
			pdfTableHeaders: ['Lane', 'Status'],
			pdfTableRowCount: 3,
			pdfTableSignature: 'Lane | Status',
			sourceAwareChunkReason: 'size_limit'
		});
	});

	it('preserves figure caption adjacency as a semantic PDF block in fixture coverage', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_figure_caption.pdf')
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 160,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.text).toBe(
			[
				'Figure 2',
				'Stable approval gate by release lane.',
				'',
				'Stable lane remains blocked until explicit approval is recorded.'
			].join('\n')
		);
		expect(loaded.metadata?.pageCount).toBe(1);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				lineCount: 2,
				pageNumber: 1,
				semanticRole: 'figure_caption',
				text: [
					'Figure 2',
					'Stable approval gate by release lane.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				lineCount: 1,
				pageNumber: 1,
				semanticRole: 'figure_body',
				text: 'Stable lane remains blocked until explicit approval is recorded.',
				textKind: 'paragraph'
			}
		]);
		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfBlockNumber: 1,
			pdfSemanticRole: 'figure_caption',
			pdfTextKind: 'paragraph',
			sectionKind: 'pdf_block',
			sectionTitle: 'Page 1 Figure Caption'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfBlockNumber: 2,
			pdfFigureCaptionBlockNumber: 1,
			pdfFigureLabel: 'Figure 2',
			pdfSemanticRole: 'figure_body',
			pdfTextKind: 'paragraph',
			sectionKind: 'pdf_block',
			sectionTitle: 'Figure 2 Body'
		});
	});

	it('suppresses fixture-backed pdf sidebar noise while preserving figure and heading structure', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'pdf_figure_sidebar_noise.pdf'
			)
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 220,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.text).toBe(
			[
				'Figure 3',
				'Canary approval topology by lane.',
				'',
				'Canary remediation stays local until the stable gate clears.',
				'',
				'Rollback Controls',
				'Stable rollback requires incident acknowledgement before promotion.'
			].join('\n')
		);
		expect(loaded.text).not.toContain('Related links');
		expect(loaded.text).not.toContain('/docs/release-gates');
		expect(loaded.text).not.toContain('Start free trial');
		expect(loaded.metadata?.pdfTextBlockCount).toBe(3);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				semanticRole: 'figure_caption',
				text: ['Figure 3', 'Canary approval topology by lane.'].join(
					'\n'
				)
			},
			{
				blockNumber: 2,
				semanticRole: 'figure_body',
				text: 'Canary remediation stays local until the stable gate clears.'
			},
			{
				blockNumber: 3,
				text: [
					'Rollback Controls',
					'Stable rollback requires incident acknowledgement before promotion.'
				].join('\n'),
				textKind: 'paragraph'
			}
		]);
		expect(prepared.chunks).toHaveLength(3);
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pdfBlockNumber: 2,
			pdfFigureCaptionBlockNumber: 1,
			pdfFigureLabel: 'Figure 3',
			pdfSemanticRole: 'figure_body',
			sectionTitle: 'Figure 3 Body'
		});
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			pdfBlockNumber: 3,
			pdfTextKind: 'paragraph',
			sectionKind: 'pdf_block',
			sectionTitle: 'Rollback Controls'
		});
	});

	it('preserves simple multi-page PDF block assignment in fixture coverage', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_multipage_blocks.pdf')
		});

		expect(loaded.text).toBe(
			[
				'Page One Summary',
				'Stable rollout remains blocked.',
				'',
				'Metric | Status',
				'Approval | Blocked'
			].join('\n')
		);
		expect(loaded.metadata?.pageCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				text: [
					'Page One Summary',
					'Stable rollout remains blocked.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				pageNumber: 2,
				text: ['Metric | Status', 'Approval | Blocked'].join('\n'),
				textKind: 'table_like'
			}
		]);
	});

	it('uses native PDF text blocks for source-aware chunk structure', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_multipage_blocks.pdf')
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 120,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(prepared.chunks).toHaveLength(2);
		expect(prepared.chunks[0]?.metadata).toMatchObject({
			pageNumber: 1,
			pdfBlockNumber: 1,
			pdfTextKind: 'paragraph',
			sectionKind: 'pdf_block',
			sectionTitle: 'Page One Summary'
		});
		expect(prepared.chunks[1]?.metadata).toMatchObject({
			pageNumber: 2,
			pdfBlockNumber: 2,
			pdfTextKind: 'table_like',
			sectionKind: 'pdf_block',
			sectionTitle: 'Page 2 Table Block'
		});
		expect(prepared.chunks[1]?.text).toContain('Metric | Status');
		expect(prepared.chunks[1]?.text).toContain('Approval | Blocked');
	});

	it('preserves noisy multi-page pdf figure and table structure with stronger table context inheritance', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_multipage_noise.pdf')
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 220,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.text).not.toContain('Example Report Header');
		expect(loaded.text).not.toContain('Related links');
		expect(loaded.text).not.toContain('Start free trial');
		expect(loaded.text).not.toContain('Page 1');
		expect(loaded.text).not.toContain('Page 2');
		expect(loaded.metadata?.pageCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(6);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				semanticRole: 'figure_caption',
				text: ['Figure 3', 'Canary approval topology by lane.'].join(
					'\n'
				)
			},
			{
				blockNumber: 2,
				pageNumber: 1,
				semanticRole: 'figure_body',
				text: 'Canary remediation stays local until the stable gate clears.'
			},
			{
				blockNumber: 3,
				pageNumber: 2,
				text: [
					'Approval Matrix',
					'Stable release approval remains blocked until remediation closes.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 4,
				pageNumber: 2,
				semanticRole: 'figure_caption',
				text: ['Figure 4', 'Remediation owner by environment.'].join(
					'\n'
				)
			},
			{
				blockNumber: 5,
				pageNumber: 2,
				semanticRole: 'figure_body',
				text: 'Environment escalation stays local until the stable gate clears.'
			},
			{
				blockNumber: 6,
				pageNumber: 2,
				text: [
					'Lane | Status',
					'Stable | Blocked',
					'Canary | Ready'
				].join('\n'),
				textKind: 'table_like'
			}
		]);
		expect(prepared.chunks).toHaveLength(6);
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			pageNumber: 2,
			pdfBlockNumber: 3,
			pdfTextKind: 'paragraph',
			sectionTitle: 'Approval Matrix'
		});
		expect(prepared.chunks[5]?.metadata).toMatchObject({
			pageNumber: 2,
			pdfBlockNumber: 6,
			pdfTableHeaders: ['Lane', 'Status'],
			pdfTableRowCount: 3,
			pdfTextKind: 'table_like',
			sectionKind: 'pdf_block',
			sectionTitle: 'Approval Matrix Table'
		});
	});

	it('preserves a mixed pdf layout with columns, figures, repeated headings, and multiple tables', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'pdf_mixed_layout_stress.pdf'
			)
		});
		const prepared = prepareRAGDocument(loaded, {
			maxChunkLength: 220,
			minChunkLength: 1,
			strategy: 'source_aware'
		});

		expect(loaded.text).not.toContain('Related links');
		expect(loaded.text).not.toContain('/docs/release-gates');
		expect(loaded.text).not.toContain('Start free trial');
		expect(loaded.metadata?.pdfTextBlockCount).toBe(8);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				text: [
					'Overview Column',
					'Stable blockers stay explicit in the rollout record.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 2,
				semanticRole: 'figure_caption',
				text: ['Figure 5', 'Approval topology by rollout lane.'].join(
					'\n'
				)
			},
			{
				blockNumber: 3,
				semanticRole: 'figure_body',
				text: 'Canary remediation stays local until the stable gate clears.'
			},
			{
				blockNumber: 4,
				text: [
					'Approval Matrix',
					'Stable release approval remains blocked until remediation closes.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 5,
				text: [
					'Lane | Status',
					'Stable | Blocked',
					'Canary | Ready'
				].join('\n'),
				textKind: 'table_like'
			},
			{
				blockNumber: 6,
				text: [
					'Details Column',
					'Approval evidence belongs beside the blocking gate.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 7,
				text: [
					'Escalation Matrix',
					'Escalation ownership stays local until incident acknowledgement completes.'
				].join('\n'),
				textKind: 'paragraph'
			},
			{
				blockNumber: 8,
				text: [
					'Environment | Owner',
					'Stable | Release lead',
					'Canary | On-call'
				].join('\n'),
				textKind: 'table_like'
			}
		]);
		expect(prepared.chunks).toHaveLength(8);
		expect(prepared.chunks[2]?.metadata).toMatchObject({
			pdfBlockNumber: 3,
			pdfFigureCaptionBlockNumber: 2,
			pdfFigureLabel: 'Figure 5',
			pdfSemanticRole: 'figure_body',
			sectionTitle: 'Figure 5 Body'
		});
		expect(prepared.chunks[4]?.metadata).toMatchObject({
			pdfBlockNumber: 5,
			pdfTableHeaders: ['Lane', 'Status'],
			pdfTableColumnCount: 2,
			pdfTableBodyRowCount: 2,
			pdfTableSignature: 'Lane | Status',
			sectionTitle: 'Approval Matrix Table'
		});
		expect(prepared.chunks[7]?.metadata).toMatchObject({
			pdfBlockNumber: 8,
			pdfTableHeaders: ['Environment', 'Owner'],
			pdfTableColumnCount: 2,
			pdfTableBodyRowCount: 2,
			pdfTableSignature: 'Environment | Owner',
			sectionTitle: 'Escalation Matrix Table'
		});
	});

	it('preserves denser multi-page PDF blocks even when headers repeat', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(EXTRACTION_FIXTURE_DIRECTORY, 'pdf_headers_footers.pdf')
		});

		expect(loaded.text).not.toContain('Example Report Header');
		expect(loaded.text).not.toContain('Page 1');
		expect(loaded.text).not.toContain('Page 2');
		expect(loaded.text).toContain('Release Summary');
		expect(loaded.text).toContain('Metric | Status');
		expect(loaded.metadata?.pageCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlockCount).toBe(2);
		expect(loaded.metadata?.pdfTextBlocks).toMatchObject([
			{
				blockNumber: 1,
				pageNumber: 1,
				text: [
					'Release Summary',
					'Stable release remains blocked pending approval.'
				].join('\n')
			},
			{
				blockNumber: 2,
				pageNumber: 2,
				textKind: 'table_like'
			}
		]);
	});

	it('strips heavier article boilerplate in fixture-backed HTML coverage', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'html_article_boilerplate.html'
			)
		});
		const prepared = prepareRAGDocument(loaded);

		expect(loaded.format).toBe('html');
		expect(prepared.normalizedText).toContain(
			'Release Operations Deep Dive'
		);
		expect(prepared.normalizedText).toContain(
			'Stable approvals should reference the blocking gate'
		);
		expect(prepared.normalizedText).toContain(
			'Canary handoffs should keep remediation evidence attached'
		);
		expect(prepared.normalizedText).not.toContain(
			'Docs | Pricing | Sign in | Contact sales'
		);
		expect(prepared.normalizedText).not.toContain(
			'Upgrade now for premium sync throughput.'
		);
		expect(prepared.normalizedText).not.toContain(
			'Copyright Example Corp | Privacy | Terms'
		);
	});

	it('extracts content-like html wrappers without leaking surrounding chrome', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'html_content_wrapper.html'
			)
		});
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 160,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		expect(prepared.normalizedText).toContain('Release Wrapper Guide');
		expect(prepared.normalizedText).toContain(
			'Stable release reviews should keep the blocking gate'
		);
		expect(prepared.normalizedText).not.toContain(
			'Docs | Pricing | Sign in | Status'
		);
		expect(prepared.normalizedText).not.toContain(
			'Start a free trial for premium release telemetry.'
		);
		const evidenceChunk = prepared.chunks.find((chunk) =>
			chunk.text.includes('Evidence Handling')
		);
		expect(evidenceChunk?.metadata).toMatchObject({
			sectionKind: 'html_heading',
			sectionPath: ['Release Wrapper Guide', 'Evidence Handling'],
			sectionTitle: 'Evidence Handling'
		});
	});

	it('uses source-aware splitting for heavier article html while preserving heading structure', async () => {
		const loaded = await loadRAGDocumentFile({
			path: join(
				EXTRACTION_FIXTURE_DIRECTORY,
				'html_article_boilerplate.html'
			)
		});
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 160,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		expect(prepared.chunks.length).toBeGreaterThanOrEqual(2);
		const laneReviewChunk = prepared.chunks.find((chunk) =>
			chunk.text.includes('Lane Review')
		);
		expect(prepared.chunks[0]?.text).toContain(
			'Release Operations Deep Dive'
		);
		expect(laneReviewChunk?.text).toContain('Release Operations Deep Dive');
		expect(laneReviewChunk?.text).toContain(
			'Canary handoffs should keep remediation evidence attached'
		);
		expect(laneReviewChunk?.metadata).toMatchObject({
			sectionDepth: 2,
			sectionKind: 'html_heading',
			sectionPath: ['Release Operations Deep Dive', 'Lane Review'],
			sectionTitle: 'Lane Review'
		});
		expect(
			prepared.chunks.some((chunk) =>
				chunk.text.includes('Docs | Pricing | Sign in | Contact sales')
			)
		).toBe(false);
		expect(
			prepared.chunks.some((chunk) =>
				chunk.text.includes('Upgrade now for premium sync throughput.')
			)
		).toBe(false);
	});

	it('matches the extraction fixture scorecard for file-backed fixtures', async () => {
		for (const fixture of EXTRACTION_FIXTURE_SCORECARD.documents) {
			const loaded = await loadRAGDocumentFile({
				path: join(EXTRACTION_FIXTURE_DIRECTORY, fixture.path)
			});
			const prepared = prepareRAGDocument(loaded);

			if (fixture.expectedFormat) {
				expect(loaded.format).toBe(fixture.expectedFormat);
			}

			for (const expectedText of fixture.expectedText) {
				expect(prepared.normalizedText).toContain(expectedText);
			}

			for (const excludedText of fixture.excludedText ?? []) {
				expect(prepared.normalizedText).not.toContain(excludedText);
			}

			if (fixture.expectedMetadata) {
				expect(loaded.metadata).toMatchObject(fixture.expectedMetadata);
			}
		}
	});

	it('loads fixture-backed office documents from disk', async () => {
		const docx = createStoredZip(readFixtureTree('office/docx'));
		const xlsx = createStoredZip(readFixtureTree('office/xlsx'));
		const pptx = createStoredZip(readFixtureTree('office/pptx'));

		const loadedDocx = await withTempFixtureFile(
			'fixtures/spec.docx',
			docx,
			(path) => loadRAGDocumentFile({ path })
		);
		const loadedXlsx = await withTempFixtureFile(
			'fixtures/sheet.xlsx',
			xlsx,
			(path) => loadRAGDocumentFile({ path })
		);
		const loadedPptx = await withTempFixtureFile(
			'fixtures/deck.pptx',
			pptx,
			(path) => loadRAGDocumentFile({ path })
		);

		expect(loadedDocx.text).toContain('Release Control Brief');
		expect(loadedDocx.text).toContain('Stable Lane');
		expect(loadedDocx.text).toContain('AbsoluteJS fixture docx text');
		expect(loadedDocx.text).toContain('Approval Path');
		expect(loadedDocx.metadata?.sectionCount).toBe(5);
		expect(loadedXlsx.text).toContain('Overview heading');
		expect(loadedXlsx.text).toContain(
			'Row 2. Metric: Overview heading | Status: Ready'
		);
		expect(loadedXlsx.text).toContain(
			'Row 2. Metric: Escalation checklist | Status: Blocked'
		);
		expect(loadedXlsx.metadata?.sheetNames).toEqual([
			'Overview',
			'Checklist',
			'Operations',
			'Signals',
			'Escalations'
		]);
		expect(loadedPptx.text).toContain('Release handoff summary');
		expect(loadedPptx.text).toContain(
			'Speaker notes: Review stable blockers before the rollout meeting.'
		);
		expect(loadedPptx.metadata?.slideCount).toBe(5);
	});

	it('preserves docx heading structure in extracted text', async () => {
		const docx = createStoredZip(readFixtureTree('office/docx'));
		const loaded = await withTempFixtureFile(
			'fixtures/structured.docx',
			docx,
			(path) => loadRAGDocumentFile({ path })
		);

		expect(loaded.text).toBe(
			[
				'Release Control Brief',
				'Stable Lane',
				'AbsoluteJS fixture docx text',
				'Approval Path',
				'Stable handoff notes'
			].join('\n\n')
		);
	});

	it('preserves nested docx headings, lists, and tables in complex office fixtures', async () => {
		const docx = createStoredZip(readFixtureTree('office/docx_complex'));
		const loaded = await withTempFixtureFile(
			'fixtures/complex.docx',
			docx,
			(path) => loadRAGDocumentFile({ path })
		);
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 140,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		expect(loaded.text).toContain('Release Operations Workbook');
		expect(loaded.text).toContain('Checklist');
		expect(loaded.text).toContain('- Confirm approval state');
		expect(loaded.text).toContain('- Attach remediation evidence');
		expect(loaded.text).toContain('Row 1. A: Metric | B: Status');
		const checklistChunk = prepared.chunks.find((chunk) =>
			chunk.text.includes('Checklist')
		);
		const listGroupChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Checklist'
		);
		const tableChunk = prepared.chunks.find(
			(chunk) => chunk.metadata?.officeBlockKind === 'table'
		);
		expect(checklistChunk?.metadata).toMatchObject({
			sectionPath: ['Stable Lane', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(listGroupChunk?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Stable Lane', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(listGroupChunk?.text).toContain('Confirm approval state');
		expect(listGroupChunk?.text).toContain('Attach remediation evidence');
		expect(tableChunk?.text).toContain('Row 2. A: Approval | B: Blocked');
	});

	it('preserves repeated nested docx sections with adjacent tables across repeated heading scopes', async () => {
		const docx = createStoredZip(readFixtureTree('office/docx_deep'));
		const loaded = await withTempFixtureFile(
			'fixtures/deep-structure.docx',
			docx,
			(path) => loadRAGDocumentFile({ path })
		);
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 140,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		expect(loaded.text).toContain('Checklist');
		expect(loaded.text).toContain('- Attach remediation evidence');
		expect(loaded.text).toContain('Rollback Plan');
		expect(loaded.text).toContain('- Attach rollback trace');
		expect(loaded.text).toContain('Row 2. A: Rollback trace | B: Attached');
		expect(loaded.text).toContain('Ready Lane');
		expect(loaded.text).toContain('- Attach handoff evidence');
		expect(loaded.text).toContain(
			'Use this table to track handoff owners by state.'
		);
		expect(loaded.text).toContain('Row 2. A: Release manager | B: Ready');

		const checklistListChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Checklist'
		);
		const rollbackListChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Rollback Plan'
		);
		const metricsTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Metrics Table'
		);
		const evidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Evidence Table'
		);
		const readyChecklistListChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Checklist'
		);
		const handoffTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Handoff Table'
		);

		expect(checklistListChunk?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Stable Lane', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(rollbackListChunk?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Stable Lane', 'Rollback Plan'],
			sectionTitle: 'Rollback Plan'
		});
		expect(readyChecklistListChunk?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Ready Lane', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(metricsTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableBodyRowCount: 1,
			officeTableColumnCount: 2,
			officeTableHeaderText: 'Metric | Status',
			officeTableHeaders: ['Metric', 'Status'],
			officeTableRowCount: 2,
			officeTableSignature: 'Metric | Status',
			sectionPath: ['Stable Lane', 'Metrics Table'],
			sectionTitle: 'Metrics Table'
		});
		expect(evidenceTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableBodyRowCount: 1,
			officeTableColumnCount: 2,
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			officeTableRowCount: 2,
			officeTableSignature: 'Artifact | State',
			sectionPath: ['Stable Lane', 'Evidence Table'],
			sectionTitle: 'Evidence Table'
		});
		expect(handoffTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableBodyRowCount: 1,
			officeTableColumnCount: 2,
			officeTableContextText:
				'Use this table to track handoff owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			officeTableRowCount: 2,
			officeTableSignature: 'Owner | State',
			sectionPath: ['Ready Lane', 'Handoff Table'],
			sectionTitle: 'Handoff Table'
		});
		expect(metricsTableChunk?.text).toContain(
			'Row 2. A: Approval | B: Blocked'
		);
		expect(evidenceTableChunk?.text).toContain(
			'Row 2. A: Rollback trace | B: Attached'
		);
		expect(handoffTableChunk?.text).toContain(
			'Use this table to track handoff owners by state.'
		);
		expect(handoffTableChunk?.text).toContain(
			'Row 2. A: Release manager | B: Ready'
		);
	});

	it('keeps repeated same-name docx table sections separated across oversized slices', async () => {
		const docx = createStoredZip(
			readFixtureTree('office/docx_scope_slices')
		);
		const loaded = await withTempFixtureFile(
			'fixtures/scope-slices.docx',
			docx,
			(path) => loadRAGDocumentFile({ path })
		);
		const prepared = prepareRAGDocument({
			...loaded,
			chunking: {
				maxChunkLength: 120,
				minChunkLength: 1,
				strategy: 'source_aware'
			}
		});

		const evidenceTableSlices = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				chunk.metadata?.officeTableChunkKind === 'table_slice' &&
				chunk.metadata?.sectionTitle === 'Evidence Table'
		);
		const stableSlices = evidenceTableSlices.filter(
			(chunk) =>
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Evidence Table'
		);
		const readySlices = evidenceTableSlices.filter(
			(chunk) =>
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Evidence Table'
		);
		const stableChecklistListChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Checklist'
		);
		const readyChecklistListChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Checklist'
		);
		const stableOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Owner Table'
		);
		const readyOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Owner Table'
		);
		const nestedEvidenceTableSlices = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				chunk.metadata?.officeTableChunkKind === 'table_slice' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.at(-1) === 'Evidence Table' &&
				chunk.metadata.sectionPath.includes('Validation Pack')
		);
		const stableValidationSlices = nestedEvidenceTableSlices.filter(
			(chunk) =>
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Table'
		);
		const readyValidationSlices = nestedEvidenceTableSlices.filter(
			(chunk) =>
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Table'
		);
		const stableValidationChecklistChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Checklist'
		);
		const readyValidationChecklistChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Checklist'
		);
		const stableValidationOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Owner Table'
		);
		const readyValidationOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Owner Table'
		);
		const deepEvidenceReviewTableSlices = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				chunk.metadata?.officeTableChunkKind === 'table_slice' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.at(-1) === 'Evidence Table' &&
				chunk.metadata.sectionPath.some(
					(entry) =>
						typeof entry === 'string' &&
						entry.startsWith('Evidence Review')
				)
		);
		const stableEvidenceReviewSlices = deepEvidenceReviewTableSlices.filter(
			(chunk) =>
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review > Evidence Table'
		);
		const readyEvidenceReviewSlices = deepEvidenceReviewTableSlices.filter(
			(chunk) =>
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review > Evidence Table'
		);
		const stableEvidenceReviewChecklistChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review > Checklist'
		);
		const readyEvidenceReviewChecklistChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review > Checklist'
		);
		const stableEvidenceReviewOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review > Owner Table'
		);
		const readyEvidenceReviewOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review > Owner Table'
		);
		const stableEvidenceReviewNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review'
		);
		const readyEvidenceReviewNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review'
		);
		const stableEvidenceReviewFollowUpSlices =
			deepEvidenceReviewTableSlices.filter(
				(chunk) =>
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Evidence Table'
			);
		const readyEvidenceReviewFollowUpSlices =
			deepEvidenceReviewTableSlices.filter(
				(chunk) =>
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Evidence Table'
			);
		const stableEvidenceReviewFollowUpChecklistChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Checklist'
			);
		const readyEvidenceReviewFollowUpChecklistChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Checklist'
			);
		const stableEvidenceReviewFollowUpOwnerTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Owner Table'
			);
		const readyEvidenceReviewFollowUpOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Owner Table'
		);
		const stableEvidenceReviewFollowUpSiblingSlices =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					chunk.metadata?.officeTableChunkKind === 'table_slice' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Evidence Table (2)'
			);
		const readyEvidenceReviewFollowUpSiblingSlices = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				chunk.metadata?.officeTableChunkKind === 'table_slice' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Evidence Table (2)'
		);
		const stableEvidenceReviewFollowUpSiblingOwnerTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Owner Table (2)'
			);
		const readyEvidenceReviewFollowUpSiblingOwnerTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Owner Table (2)'
			);
		const stableEvidenceReviewFollowUpNarrativeChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'paragraph' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2)'
			);
		const readyEvidenceReviewFollowUpNarrativeChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'paragraph' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2)'
			);
		const stableEvidenceReviewFollowUpReviewNotesChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes'
			);
		const stableEvidenceReviewFollowUpReviewNotesSecondChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2)'
			);
		const readyEvidenceReviewFollowUpReviewNotesChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes'
			);
		const readyEvidenceReviewFollowUpReviewNotesSecondChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2)'
			);
		const stableReviewNotesEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes > Evidence Table'
		);
		const stableReviewNotesOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes > Owner Table'
		);
		const stableReviewNotesSecondEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Evidence Table'
		);
		const stableReviewNotesSecondOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Owner Table'
		);
		const readyReviewNotesEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes > Evidence Table'
		);
		const readyReviewNotesOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes > Owner Table'
		);
		const readyReviewNotesSecondEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Evidence Table'
		);
		const readyReviewNotesSecondOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Owner Table'
		);
		const stableClosureNotesChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Checklist'
		);
		const stableClosureNotesSiblingChecklistChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Checklist (2)'
		);
		const stableClosureNotesSecondChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Checklist'
		);
		const stableClosureNotesSecondSiblingChecklistChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Checklist (2)'
			);
		const readyClosureNotesChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Checklist'
		);
		const readyClosureNotesSiblingChecklistChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Checklist (2)'
		);
		const readyClosureNotesSecondChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'list' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Checklist'
		);
		const readyClosureNotesSecondSiblingChecklistChunks =
			prepared.chunks.filter(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'list' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Checklist (2)'
			);
		const stableClosureNotesNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes'
		);
		const stableClosureNotesSecondNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2)'
		);
		const readyClosureNotesNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes'
		);
		const readyClosureNotesSecondNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2)'
		);
		const stableClosureNotesNarrativeText =
			stableClosureNotesNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n');
		const stableClosureNotesSecondNarrativeText =
			stableClosureNotesSecondNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n');
		const readyClosureNotesNarrativeText = readyClosureNotesNarrativeChunks
			.map((chunk) => chunk.text)
			.join('\n');
		const readyClosureNotesSecondNarrativeText =
			readyClosureNotesSecondNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n');
		const stableClosureNotesEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Evidence Table'
		);
		const stableClosureNotesOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Owner Table'
		);
		const stableClosureNotesSecondEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Evidence Table'
		);
		const stableClosureNotesSecondOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Owner Table'
		);
		const readyClosureNotesEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Evidence Table'
		);
		const readyClosureNotesOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Owner Table'
		);
		const readyClosureNotesSecondEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Evidence Table'
		);
		const readyClosureNotesSecondOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Owner Table'
		);
		const stableClosureNotesSiblingEvidenceTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Evidence Table (2)'
			);
		const stableClosureNotesSiblingOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Owner Table (2)'
		);
		const stableClosureNotesSecondSiblingEvidenceTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Evidence Table (2)'
			);
		const stableClosureNotesSecondSiblingOwnerTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Stable Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Owner Table (2)'
			);
		const readyClosureNotesSiblingEvidenceTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Evidence Table (2)'
		);
		const readyClosureNotesSiblingOwnerTableChunk = prepared.chunks.find(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'table' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes > Owner Table (2)'
		);
		const readyClosureNotesSecondSiblingEvidenceTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Evidence Table (2)'
			);
		const readyClosureNotesSecondSiblingOwnerTableChunk =
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						'Ready Lane > Validation Pack > Evidence Review (2) > Review Notes (2) > Closure Notes (2) > Owner Table (2)'
			);
		const stableValidationNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Stable Lane > Validation Pack'
		);
		const readyValidationNarrativeChunks = prepared.chunks.filter(
			(chunk) =>
				chunk.metadata?.officeBlockKind === 'paragraph' &&
				Array.isArray(chunk.metadata?.sectionPath) &&
				chunk.metadata.sectionPath.join(' > ') ===
					'Ready Lane > Validation Pack'
		);

		expect(loaded.text).toContain(
			'Use this table to track stable evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify stable ownership before rollout.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify ready ownership before handoff.'
		);
		expect(loaded.text).toContain(
			'Only promote stable evidence that already matches the blocked rollout state.'
		);
		expect(loaded.text).toContain(
			'Only promote ready evidence that already matches the handoff state.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify stable validation before release signoff.'
		);
		expect(loaded.text).toContain(
			'Review stable validation ownership before signoff.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify ready validation before handoff signoff.'
		);
		expect(loaded.text).toContain(
			'Keep stable evidence review isolated to the nested validation scope.'
		);
		expect(loaded.text).toContain(
			'Record stable review notes before routing ownership updates.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify stable evidence review before routing blockers.'
		);
		expect(loaded.text).toContain('Confirm stable review owner');
		expect(loaded.text).toContain('Attach stable review evidence');
		expect(loaded.text).toContain(
			'Only route stable review evidence that already matches the blocked validation state.'
		);
		expect(loaded.text).toContain(
			'Escalate stable review blockers through the nested review evidence table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable review evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Route unresolved stable review owners through this table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable review owners by state.'
		);
		expect(loaded.text).toContain(
			'Keep stable follow-up evidence review isolated to the nested validation scope.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify stable follow-up review before final route confirmation.'
		);
		expect(loaded.text).toContain('Confirm stable follow-up review owner');
		expect(loaded.text).toContain(
			'Attach stable follow-up review evidence'
		);
		expect(loaded.text).toContain(
			'Only route stable follow-up review evidence after the first nested review table is complete.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable follow-up review evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Route unresolved stable follow-up review owners through this table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable follow-up review owners by state.'
		);
		expect(loaded.text).toContain(
			'Keep stable sibling follow-up evidence isolated from the first follow-up evidence table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable sibling follow-up evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Archive stable sibling follow-up owner notes with this table.'
		);
		expect(loaded.text).toContain(
			'Review ready validation ownership before handoff signoff.'
		);
		expect(loaded.text).toContain(
			'Keep ready evidence review isolated to the nested validation scope.'
		);
		expect(loaded.text).toContain(
			'Record ready review notes before routing ownership updates.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify ready evidence review before routing blockers.'
		);
		expect(loaded.text).toContain('Confirm ready review owner');
		expect(loaded.text).toContain('Attach ready review evidence');
		expect(loaded.text).toContain(
			'Only route ready review evidence that already matches the handoff validation state.'
		);
		expect(loaded.text).toContain(
			'Escalate ready review blockers through the nested review evidence table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready review evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Route unresolved ready review owners through this table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready review owners by state.'
		);
		expect(loaded.text).toContain(
			'Keep ready follow-up evidence review isolated to the nested validation scope.'
		);
		expect(loaded.text).toContain(
			'Use this checklist to verify ready follow-up review before final route confirmation.'
		);
		expect(loaded.text).toContain('Confirm ready follow-up review owner');
		expect(loaded.text).toContain('Attach ready follow-up review evidence');
		expect(loaded.text).toContain(
			'Only route ready follow-up review evidence after the first nested review table is complete.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready follow-up review evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Route unresolved ready follow-up review owners through this table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready follow-up review owners by state.'
		);
		expect(loaded.text).toContain(
			'Keep ready sibling follow-up evidence isolated from the first follow-up evidence table.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready sibling follow-up evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Archive ready sibling follow-up owner notes with this table.'
		);
		expect(loaded.text).toContain(
			'Keep stable duplicate note packets scoped to the first repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Record stable duplicate note evidence separately from the final note branch.'
		);
		expect(loaded.text).toContain('Confirm stable duplicate note owner');
		expect(loaded.text).toContain('Attach stable duplicate note evidence');
		expect(loaded.text).toContain(
			'Archive stable duplicate note blockers before the second repeated review notes branch begins.'
		);
		expect(loaded.text).toContain(
			'Keep stable final note packets scoped to the second repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Record stable final note evidence separately from the duplicate note branch.'
		);
		expect(loaded.text).toContain('Confirm stable final note owner');
		expect(loaded.text).toContain('Attach stable final note evidence');
		expect(loaded.text).toContain(
			'Archive stable final note blockers after the second repeated review notes branch closes.'
		);
		expect(loaded.text).toContain(
			'Keep ready duplicate note packets scoped to the first repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Record ready duplicate note evidence separately from the final note branch.'
		);
		expect(loaded.text).toContain('Confirm ready duplicate note owner');
		expect(loaded.text).toContain('Attach ready duplicate note evidence');
		expect(loaded.text).toContain(
			'Archive ready duplicate note blockers before the second repeated review notes branch begins.'
		);
		expect(loaded.text).toContain(
			'Keep ready final note packets scoped to the second repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Record ready final note evidence separately from the duplicate note branch.'
		);
		expect(loaded.text).toContain('Confirm ready final note owner');
		expect(loaded.text).toContain('Attach ready final note evidence');
		expect(loaded.text).toContain(
			'Archive ready final note blockers after the second repeated review notes branch closes.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable duplicate note evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable duplicate note owners by state.'
		);
		expect(loaded.text).toContain(
			'Archive stable duplicate owner follow-up notes with this repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable final note evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Use this table to track stable final note owners by state.'
		);
		expect(loaded.text).toContain(
			'Archive stable final owner follow-up notes with this repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready duplicate note evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready duplicate note owners by state.'
		);
		expect(loaded.text).toContain(
			'Archive ready duplicate owner follow-up notes with this repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready final note evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Use this table to track ready final note owners by state.'
		);
		expect(loaded.text).toContain(
			'Archive ready final owner follow-up notes with this repeated review notes branch.'
		);
		expect(loaded.text).toContain(
			'Keep stable first closure packets scoped to the first closure notes branch under repeated review notes.'
		);
		expect(loaded.text).toContain('Confirm stable first closure owner');
		expect(loaded.text).toContain(
			'Use this table to track stable first closure evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Archive stable first closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep stable second closure packets scoped to the second closure notes branch under repeated review notes.'
		);
		expect(loaded.text).toContain('Confirm stable second closure owner');
		expect(loaded.text).toContain(
			'Use this table to track stable second closure evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Archive stable second closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep ready first closure packets scoped to the first closure notes branch under repeated review notes.'
		);
		expect(loaded.text).toContain('Confirm ready first closure owner');
		expect(loaded.text).toContain(
			'Use this table to track ready first closure evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Archive ready first closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep ready second closure packets scoped to the second closure notes branch under repeated review notes.'
		);
		expect(loaded.text).toContain('Confirm ready second closure owner');
		expect(loaded.text).toContain(
			'Use this table to track ready second closure evidence by artifact.'
		);
		expect(loaded.text).toContain(
			'Archive ready second closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep stable sibling closure evidence isolated from the first closure evidence table.'
		);
		expect(loaded.text).toContain(
			'Archive stable sibling closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep stable second sibling closure evidence isolated from the first second-closure evidence table.'
		);
		expect(loaded.text).toContain(
			'Archive stable second sibling closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep ready sibling closure evidence isolated from the first closure evidence table.'
		);
		expect(loaded.text).toContain(
			'Archive ready sibling closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Keep ready second sibling closure evidence isolated from the first second-closure evidence table.'
		);
		expect(loaded.text).toContain(
			'Archive ready second sibling closure owner notes with this closure branch.'
		);
		expect(loaded.text).toContain(
			'Only escalate stable validation evidence that already passed blocked-lane review.'
		);
		expect(loaded.text).toContain(
			'Escalate stable validation blockers through the nested evidence path.'
		);
		expect(loaded.text).toContain(
			'Only escalate ready validation evidence that already passed handoff review.'
		);
		expect(loaded.text).toContain(
			'Escalate ready validation blockers through the nested evidence path.'
		);
		expect(loaded.text).toContain('- Attach stable evidence');
		expect(loaded.text).toContain('- Attach ready evidence');
		expect(stableSlices.length).toBeGreaterThan(1);
		expect(readySlices.length).toBeGreaterThan(1);
		expect(stableValidationSlices.length).toBeGreaterThan(1);
		expect(readyValidationSlices.length).toBeGreaterThan(1);
		expect(stableEvidenceReviewSlices.length).toBeGreaterThan(1);
		expect(readyEvidenceReviewSlices.length).toBeGreaterThan(1);
		expect(stableEvidenceReviewFollowUpSlices.length).toBeGreaterThan(1);
		expect(readyEvidenceReviewFollowUpSlices.length).toBeGreaterThan(1);
		expect(
			stableEvidenceReviewFollowUpSiblingSlices.length
		).toBeGreaterThan(1);
		expect(readyEvidenceReviewFollowUpSiblingSlices.length).toBeGreaterThan(
			1
		);
		expect(stableChecklistListChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify stable ownership before rollout.\n\nOnly promote stable evidence that already matches the blocked rollout state.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Stable Lane', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(readyChecklistListChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify ready ownership before handoff.\n\nOnly promote ready evidence that already matches the handoff state.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Ready Lane', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(stableSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only promote stable evidence that already matches the blocked rollout state.\n\nUse this table to track stable evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: ['Stable Lane', 'Evidence Table'],
			sectionTitle: 'Evidence Table'
		});
		expect(readySlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only promote ready evidence that already matches the handoff state.\n\nUse this table to track ready evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: ['Ready Lane', 'Evidence Table'],
			sectionTitle: 'Evidence Table'
		});
		expect(stableOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: ['Stable Lane', 'Owner Table'],
			sectionTitle: 'Owner Table'
		});
		expect(readyOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: ['Ready Lane', 'Owner Table'],
			sectionTitle: 'Owner Table'
		});
		expect(stableValidationChecklistChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify stable validation before release signoff.\n\nOnly escalate stable validation evidence that already passed blocked-lane review.\n\nEscalate stable validation blockers through the nested evidence path.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Stable Lane', 'Validation Pack', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(readyValidationChecklistChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify ready validation before handoff signoff.\n\nOnly escalate ready validation evidence that already passed handoff review.\n\nEscalate ready validation blockers through the nested evidence path.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: ['Ready Lane', 'Validation Pack', 'Checklist'],
			sectionTitle: 'Checklist'
		});
		expect(stableValidationNarrativeChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'paragraph',
			sectionPath: ['Stable Lane', 'Validation Pack'],
			sectionTitle: 'Validation Pack'
		});
		expect(readyValidationNarrativeChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'paragraph',
			sectionPath: ['Ready Lane', 'Validation Pack'],
			sectionTitle: 'Validation Pack'
		});
		expect(stableValidationSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only escalate stable validation evidence that already passed blocked-lane review.\n\nEscalate stable validation blockers through the nested evidence path.\n\nUse this table to track stable validation evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: ['Stable Lane', 'Validation Pack', 'Evidence Table'],
			sectionTitle: 'Evidence Table'
		});
		expect(readyValidationSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only escalate ready validation evidence that already passed handoff review.\n\nEscalate ready validation blockers through the nested evidence path.\n\nUse this table to track ready validation evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: ['Ready Lane', 'Validation Pack', 'Evidence Table'],
			sectionTitle: 'Evidence Table'
		});
		expect(stableValidationOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Route unresolved stable validation owners through this table.\n\nUse this table to track stable validation owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: ['Stable Lane', 'Validation Pack', 'Owner Table'],
			sectionTitle: 'Owner Table'
		});
		expect(readyValidationOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Route unresolved ready validation owners through this table.\n\nUse this table to track ready validation owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: ['Ready Lane', 'Validation Pack', 'Owner Table'],
			sectionTitle: 'Owner Table'
		});
		expect(stableEvidenceReviewChecklistChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify stable evidence review before routing blockers.\n\nOnly route stable review evidence that already matches the blocked validation state.\n\nEscalate stable review blockers through the nested review evidence table.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(readyEvidenceReviewChecklistChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify ready evidence review before routing blockers.\n\nOnly route ready review evidence that already matches the handoff validation state.\n\nEscalate ready review blockers through the nested review evidence table.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(stableEvidenceReviewNarrativeChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'paragraph',
			sectionPath: ['Stable Lane', 'Validation Pack', 'Evidence Review'],
			sectionTitle: 'Evidence Review'
		});
		expect(readyEvidenceReviewNarrativeChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'paragraph',
			sectionPath: ['Ready Lane', 'Validation Pack', 'Evidence Review'],
			sectionTitle: 'Evidence Review'
		});
		expect(stableEvidenceReviewSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only route stable review evidence that already matches the blocked validation state.\n\nEscalate stable review blockers through the nested review evidence table.\n\nUse this table to track stable review evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(readyEvidenceReviewSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only route ready review evidence that already matches the handoff validation state.\n\nEscalate ready review blockers through the nested review evidence table.\n\nUse this table to track ready review evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(stableEvidenceReviewOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Route unresolved stable review owners through this table.\n\nUse this table to track stable review owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(readyEvidenceReviewOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Route unresolved ready review owners through this table.\n\nUse this table to track ready review owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			stableEvidenceReviewFollowUpChecklistChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify stable follow-up review before final route confirmation.\n\nOnly route stable follow-up review evidence after the first nested review table is complete.\n\nEscalate stable follow-up review blockers through the second nested review evidence table.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(
			readyEvidenceReviewFollowUpChecklistChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListContextText:
				'Use this checklist to verify ready follow-up review before final route confirmation.\n\nOnly route ready follow-up review evidence after the first nested review table is complete.\n\nEscalate ready follow-up review blockers through the second nested review evidence table.',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(
			stableEvidenceReviewFollowUpNarrativeChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'paragraph',
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)'
			],
			sectionTitle: 'Evidence Review (2)'
		});
		expect(
			readyEvidenceReviewFollowUpNarrativeChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'paragraph',
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)'
			],
			sectionTitle: 'Evidence Review (2)'
		});
		expect(stableEvidenceReviewFollowUpSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only route stable follow-up review evidence after the first nested review table is complete.\n\nEscalate stable follow-up review blockers through the second nested review evidence table.\n\nKeep stable follow-up review artifacts grouped under the second nested evidence table.\n\nUse this table to track stable follow-up review evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(
			stableEvidenceReviewFollowUpSiblingSlices[0]?.metadata
		).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Archive stable follow-up owner notes with this owner table before the duplicate evidence family begins.\n\nKeep stable sibling follow-up evidence isolated from the first follow-up evidence table.\n\nUse this table to track stable sibling follow-up evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Evidence Table (2)'
			],
			sectionTitle: 'Evidence Table (2)'
		});
		expect(readyEvidenceReviewFollowUpSlices[0]?.metadata).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Only route ready follow-up review evidence after the first nested review table is complete.\n\nEscalate ready follow-up review blockers through the second nested review evidence table.\n\nKeep ready follow-up review artifacts grouped under the second nested evidence table.\n\nUse this table to track ready follow-up review evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(
			readyEvidenceReviewFollowUpSiblingSlices[0]?.metadata
		).toMatchObject({
			officeTableChunkKind: 'table_slice',
			officeTableContextText:
				'Archive ready follow-up owner notes with this owner table before the duplicate evidence family begins.\n\nKeep ready sibling follow-up evidence isolated from the first follow-up evidence table.\n\nUse this table to track ready sibling follow-up evidence by artifact.',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Evidence Table (2)'
			],
			sectionTitle: 'Evidence Table (2)'
		});
		expect(
			stableEvidenceReviewFollowUpOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Route unresolved stable follow-up review owners through this table.\n\nUse this table to track stable follow-up review owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			readyEvidenceReviewFollowUpOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Route unresolved ready follow-up review owners through this table.\n\nUse this table to track ready follow-up review owners by state.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			stableEvidenceReviewFollowUpSiblingOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Record stable sibling follow-up evidence notes after this table before owner routing.\n\nUse this table to track stable sibling follow-up owners by state.',
			officeTableFollowUpText:
				'Archive stable sibling follow-up owner notes with this table.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Owner Table (2)'
			],
			sectionTitle: 'Owner Table (2)'
		});
		expect(
			readyEvidenceReviewFollowUpSiblingOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableContextText:
				'Record ready sibling follow-up evidence notes after this table before owner routing.\n\nUse this table to track ready sibling follow-up owners by state.',
			officeTableFollowUpText:
				'Archive ready sibling follow-up owner notes with this table.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Owner Table (2)'
			],
			sectionTitle: 'Owner Table (2)'
		});
		expect(
			stableEvidenceReviewFollowUpReviewNotesChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes'
			],
			sectionTitle: 'Review Notes'
		});
		expect(
			stableEvidenceReviewFollowUpReviewNotesChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Keep stable duplicate note packets scoped to the first repeated review notes branch.'
		);
		expect(
			stableEvidenceReviewFollowUpReviewNotesChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Record stable duplicate note evidence separately from the final note branch.'
		);
		expect(
			stableEvidenceReviewFollowUpReviewNotesSecondChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)'
			],
			sectionTitle: 'Review Notes (2)'
		});
		expect(
			stableEvidenceReviewFollowUpReviewNotesSecondChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Keep stable final note packets scoped to the second repeated review notes branch.'
		);
		expect(
			stableEvidenceReviewFollowUpReviewNotesSecondChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Record stable final note evidence separately from the duplicate note branch.'
		);
		expect(
			readyEvidenceReviewFollowUpReviewNotesChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes'
			],
			sectionTitle: 'Review Notes'
		});
		expect(
			readyEvidenceReviewFollowUpReviewNotesChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Keep ready duplicate note packets scoped to the first repeated review notes branch.'
		);
		expect(
			readyEvidenceReviewFollowUpReviewNotesChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Record ready duplicate note evidence separately from the final note branch.'
		);
		expect(
			readyEvidenceReviewFollowUpReviewNotesSecondChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)'
			],
			sectionTitle: 'Review Notes (2)'
		});
		expect(
			readyEvidenceReviewFollowUpReviewNotesSecondChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Keep ready final note packets scoped to the second repeated review notes branch.'
		);
		expect(
			readyEvidenceReviewFollowUpReviewNotesSecondChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Record ready final note evidence separately from the duplicate note branch.'
		);
		expect(stableReviewNotesEvidenceTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(stableReviewNotesOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableFollowUpText:
				'Archive stable duplicate owner follow-up notes with this repeated review notes branch.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			stableReviewNotesSecondEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(stableReviewNotesSecondOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableFollowUpText:
				'Archive stable final owner follow-up notes with this repeated review notes branch.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(readyReviewNotesEvidenceTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(readyReviewNotesOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableFollowUpText:
				'Archive ready duplicate owner follow-up notes with this repeated review notes branch.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			readyReviewNotesSecondEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(readyReviewNotesSecondOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableFollowUpText:
				'Archive ready final owner follow-up notes with this repeated review notes branch.',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(stableClosureNotesChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(
			stableClosureNotesChunks[0]?.metadata?.officeListContextText
		).toContain(
			'Use this checklist to verify stable first closure before owner confirmation.'
		);
		expect(
			stableClosureNotesSiblingChecklistChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Checklist (2)'
			],
			sectionTitle: 'Checklist (2)'
		});
		expect(
			stableClosureNotesSiblingChecklistChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Use this checklist to verify stable sibling closure before sibling evidence routing.'
		);
		expect(stableClosureNotesSecondChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(
			stableClosureNotesSecondChunks[0]?.metadata?.officeListContextText
		).toContain(
			'Use this checklist to verify stable second closure before owner confirmation.'
		);
		expect(
			stableClosureNotesSecondSiblingChecklistChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Checklist (2)'
			],
			sectionTitle: 'Checklist (2)'
		});
		expect(
			stableClosureNotesSecondSiblingChecklistChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Use this checklist to verify stable second sibling closure before sibling evidence routing.'
		);
		expect(readyClosureNotesChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(
			readyClosureNotesChunks[0]?.metadata?.officeListContextText
		).toContain(
			'Use this checklist to verify ready first closure before owner confirmation.'
		);
		expect(
			readyClosureNotesSiblingChecklistChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Checklist (2)'
			],
			sectionTitle: 'Checklist (2)'
		});
		expect(
			readyClosureNotesSiblingChecklistChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Use this checklist to verify ready sibling closure before sibling evidence routing.'
		);
		expect(readyClosureNotesSecondChunks[0]?.metadata).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Checklist'
			],
			sectionTitle: 'Checklist'
		});
		expect(
			readyClosureNotesSecondChunks[0]?.metadata?.officeListContextText
		).toContain(
			'Use this checklist to verify ready second closure before owner confirmation.'
		);
		expect(
			readyClosureNotesSecondSiblingChecklistChunks[0]?.metadata
		).toMatchObject({
			officeBlockKind: 'list',
			officeListGroupItemCount: 2,
			officeListLevels: [0, 1],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Checklist (2)'
			],
			sectionTitle: 'Checklist (2)'
		});
		expect(
			readyClosureNotesSecondSiblingChecklistChunks[0]?.metadata
				?.officeListContextText
		).toContain(
			'Use this checklist to verify ready second sibling closure before sibling evidence routing.'
		);
		expect(stableClosureNotesNarrativeText).toContain(
			'Keep stable first closure narrative scoped before the first checklist handoff.'
		);
		expect(stableClosureNotesSecondNarrativeText).toContain(
			'Keep stable second closure narrative scoped before the second checklist handoff.'
		);
		expect(readyClosureNotesNarrativeText).toContain(
			'Keep ready first closure narrative scoped before the first checklist handoff.'
		);
		expect(readyClosureNotesSecondNarrativeText).toContain(
			'Keep ready second closure narrative scoped before the second checklist handoff.'
		);
		expect(stableClosureNotesEvidenceTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(stableClosureNotesOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			stableClosureNotesSecondEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(stableClosureNotesSecondOwnerTableChunk?.metadata).toMatchObject(
			{
				officeBlockKind: 'table',
				officeTableHeaderText: 'Owner | State',
				officeTableHeaders: ['Owner', 'State'],
				sectionPath: [
					'Stable Lane',
					'Validation Pack',
					'Evidence Review (2)',
					'Review Notes (2)',
					'Closure Notes (2)',
					'Owner Table'
				],
				sectionTitle: 'Owner Table'
			}
		);
		expect(readyClosureNotesEvidenceTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(readyClosureNotesOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			readyClosureNotesSecondEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Evidence Table'
			],
			sectionTitle: 'Evidence Table'
		});
		expect(readyClosureNotesSecondOwnerTableChunk?.metadata).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Owner Table'
			],
			sectionTitle: 'Owner Table'
		});
		expect(
			stableClosureNotesSiblingEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Evidence Table (2)'
			],
			sectionTitle: 'Evidence Table (2)'
		});
		expect(
			stableClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep stable sibling closure evidence isolated from the first closure evidence table.'
		);
		expect(
			stableClosureNotesEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry stable first closure evidence only after the first checklist clears.'
		);
		expect(
			stableClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry stable sibling closure evidence only after the sibling checklist clears.'
		);
		expect(
			stableClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue stable sibling closure artifact review before the sibling evidence table opens.'
		);
		expect(
			stableClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep stable sibling closure artifact packet scoped to the sibling evidence table family.'
		);
		expect(
			stableClosureNotesSiblingOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Owner Table (2)'
			],
			sectionTitle: 'Owner Table (2)'
		});
		expect(
			stableClosureNotesSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue stable sibling closure owner review before the sibling owner table opens.'
		);
		expect(
			stableClosureNotesSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep stable sibling closure owner packet scoped to the sibling owner table family.'
		);
		expect(
			stableClosureNotesSiblingOwnerTableChunk?.metadata
				?.officeTableFollowUpText
		).toBeUndefined();
		expect(
			stableClosureNotesSecondSiblingEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Evidence Table (2)'
			],
			sectionTitle: 'Evidence Table (2)'
		});
		expect(
			stableClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep stable second sibling closure evidence isolated from the first second-closure evidence table.'
		);
		expect(
			stableClosureNotesSecondEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry stable second closure evidence only after the second checklist clears.'
		);
		expect(
			stableClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry stable second sibling closure evidence only after the sibling checklist clears.'
		);
		expect(
			stableClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue stable second sibling closure artifact review before the sibling evidence table opens.'
		);
		expect(
			stableClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep stable second sibling closure artifact packet scoped to the sibling evidence table family.'
		);
		expect(
			stableClosureNotesSecondSiblingOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Stable Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Owner Table (2)'
			],
			sectionTitle: 'Owner Table (2)'
		});
		expect(
			stableClosureNotesSecondSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue stable second sibling closure owner review before the sibling owner table opens.'
		);
		expect(
			stableClosureNotesSecondSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep stable second sibling closure owner packet scoped to the sibling owner table family.'
		);
		expect(
			stableClosureNotesSecondSiblingOwnerTableChunk?.metadata
				?.officeTableFollowUpText
		).toBeUndefined();
		expect(
			readyClosureNotesSiblingEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes',
				'Evidence Table (2)'
			],
			sectionTitle: 'Evidence Table (2)'
		});
		expect(
			readyClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep ready sibling closure evidence isolated from the first closure evidence table.'
		);
		expect(
			readyClosureNotesEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry ready first closure evidence only after the first checklist clears.'
		);
		expect(
			readyClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry ready sibling closure evidence only after the sibling checklist clears.'
		);
		expect(
			readyClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue ready sibling closure artifact review before the sibling evidence table opens.'
		);
		expect(
			readyClosureNotesSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep ready sibling closure artifact packet scoped to the sibling evidence table family.'
		);
		expect(readyClosureNotesSiblingOwnerTableChunk?.metadata).toMatchObject(
			{
				officeBlockKind: 'table',
				officeTableHeaderText: 'Owner | State',
				officeTableHeaders: ['Owner', 'State'],
				sectionPath: [
					'Ready Lane',
					'Validation Pack',
					'Evidence Review (2)',
					'Review Notes (2)',
					'Closure Notes',
					'Owner Table (2)'
				],
				sectionTitle: 'Owner Table (2)'
			}
		);
		expect(
			readyClosureNotesSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue ready sibling closure owner review before the sibling owner table opens.'
		);
		expect(
			readyClosureNotesSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep ready sibling closure owner packet scoped to the sibling owner table family.'
		);
		expect(
			readyClosureNotesSiblingOwnerTableChunk?.metadata
				?.officeTableFollowUpText
		).toBeUndefined();
		expect(
			readyClosureNotesSecondSiblingEvidenceTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Artifact | State',
			officeTableHeaders: ['Artifact', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Evidence Table (2)'
			],
			sectionTitle: 'Evidence Table (2)'
		});
		expect(
			readyClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep ready second sibling closure evidence isolated from the first second-closure evidence table.'
		);
		expect(
			readyClosureNotesSecondEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry ready second closure evidence only after the second checklist clears.'
		);
		expect(
			readyClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Carry ready second sibling closure evidence only after the sibling checklist clears.'
		);
		expect(
			readyClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue ready second sibling closure artifact review before the sibling evidence table opens.'
		);
		expect(
			readyClosureNotesSecondSiblingEvidenceTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep ready second sibling closure artifact packet scoped to the sibling evidence table family.'
		);
		expect(
			readyClosureNotesSecondSiblingOwnerTableChunk?.metadata
		).toMatchObject({
			officeBlockKind: 'table',
			officeTableHeaderText: 'Owner | State',
			officeTableHeaders: ['Owner', 'State'],
			sectionPath: [
				'Ready Lane',
				'Validation Pack',
				'Evidence Review (2)',
				'Review Notes (2)',
				'Closure Notes (2)',
				'Owner Table (2)'
			],
			sectionTitle: 'Owner Table (2)'
		});
		expect(
			readyClosureNotesSecondSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Queue ready second sibling closure owner review before the sibling owner table opens.'
		);
		expect(
			readyClosureNotesSecondSiblingOwnerTableChunk?.metadata
				?.officeTableContextText
		).toContain(
			'Keep ready second sibling closure owner packet scoped to the sibling owner table family.'
		);
		expect(
			readyClosureNotesSecondSiblingOwnerTableChunk?.metadata
				?.officeTableFollowUpText
		).toBeUndefined();
		const getClosureTableChunk = ({
			familyName,
			familyOrdinal,
			lane,
			branchOrdinal
		}: {
			familyName: 'Evidence Table' | 'Owner Table';
			familyOrdinal: number;
			lane: 'Ready Lane' | 'Stable Lane';
			branchOrdinal: 1 | 2;
		}) =>
			prepared.chunks.find(
				(chunk) =>
					chunk.metadata?.officeBlockKind === 'table' &&
					Array.isArray(chunk.metadata?.sectionPath) &&
					chunk.metadata.sectionPath.join(' > ') ===
						[
							lane,
							'Validation Pack',
							'Evidence Review (2)',
							'Review Notes (2)',
							branchOrdinal === 1
								? 'Closure Notes'
								: 'Closure Notes (2)',
							`${familyName} (${familyOrdinal})`
						].join(' > ')
			);
		const closureFamilyExpectations = [
			{
				familyOrdinal: 3,
				familyText: 'tertiary',
				reviewLabel: 'archive',
				reviewWord: ' review',
				previousLabel: 'earlier',
				hasFamilyLineage: false,
				hasFollowUp: false
			},
			{
				familyOrdinal: 4,
				familyText: 'quaternary',
				reviewLabel: 'audit',
				reviewWord: ' review',
				previousLabel: 'tertiary',
				hasFamilyLineage: false,
				hasFollowUp: false
			},
			{
				familyOrdinal: 5,
				familyText: 'fifth',
				reviewLabel: 'final audit',
				reviewWord: '',
				previousLabel: 'quaternary',
				hasFamilyLineage: false,
				hasFollowUp: false
			},
			{
				familyOrdinal: 6,
				familyText: 'sixth',
				reviewLabel: 'terminal audit',
				reviewWord: '',
				previousLabel: 'fifth',
				hasFamilyLineage: true,
				hasFollowUp: true
			}
		] as const;
		const closureLaneExpectations = [
			{ lane: 'Stable Lane', laneText: 'stable' },
			{ lane: 'Ready Lane', laneText: 'ready' }
		] as const;
		const closureBranchExpectations = [
			{
				branchOrdinal: 1,
				branchText: 'sibling',
				branchScopeText: 'sibling'
			},
			{
				branchOrdinal: 2,
				branchText: 'second sibling',
				branchScopeText: 'second-sibling'
			}
		] as const;

		for (const family of closureFamilyExpectations) {
			for (const lane of closureLaneExpectations) {
				for (const branch of closureBranchExpectations) {
					const evidenceChunk = getClosureTableChunk({
						branchOrdinal: branch.branchOrdinal,
						familyName: 'Evidence Table',
						familyOrdinal: family.familyOrdinal,
						lane: lane.lane
					});
					const ownerChunk = getClosureTableChunk({
						branchOrdinal: branch.branchOrdinal,
						familyName: 'Owner Table',
						familyOrdinal: family.familyOrdinal,
						lane: lane.lane
					});

					expect(evidenceChunk?.metadata).toMatchObject({
						officeBlockKind: 'table',
						...(family.hasFamilyLineage &&
						lane.lane === 'Stable Lane'
							? {
									officeFamilyPath: [
										'Stable Lane',
										'Validation Pack',
										'Evidence Review',
										'Review Notes',
										'Closure Notes',
										'Evidence Table'
									],
									officeOrdinalPath: [
										1,
										1,
										2,
										2,
										branch.branchOrdinal,
										family.familyOrdinal
									],
									officeSiblingFamilyKey: 'Evidence Table',
									officeSiblingOrdinal: family.familyOrdinal
								}
							: {}),
						officeTableHeaderText: 'Artifact | State',
						officeTableHeaders: ['Artifact', 'State'],
						sectionPath: [
							lane.lane,
							'Validation Pack',
							'Evidence Review (2)',
							'Review Notes (2)',
							branch.branchOrdinal === 1
								? 'Closure Notes'
								: 'Closure Notes (2)',
							`Evidence Table (${family.familyOrdinal})`
						],
						sectionTitle: `Evidence Table (${family.familyOrdinal})`
					});
					expect(
						evidenceChunk?.metadata?.officeTableContextText
					).toContain(
						`Queue ${lane.laneText} ${branch.branchText} closure ${family.reviewLabel}${family.reviewWord} before the ${family.familyText} sibling evidence table opens.`
					);
					expect(
						evidenceChunk?.metadata?.officeTableContextText
					).toContain(
						`Keep ${lane.laneText} ${family.familyText} ${branch.branchScopeText} closure evidence isolated from the ${family.previousLabel} ${branch.branchScopeText} closure tables.`
					);

					expect(ownerChunk?.metadata).toMatchObject({
						officeBlockKind: 'table',
						...(family.hasFamilyLineage &&
						lane.lane === 'Stable Lane'
							? {
									officeFamilyPath: [
										'Stable Lane',
										'Validation Pack',
										'Evidence Review',
										'Review Notes',
										'Closure Notes',
										'Owner Table'
									],
									officeOrdinalPath: [
										1,
										1,
										2,
										2,
										branch.branchOrdinal,
										family.familyOrdinal
									],
									officeSiblingFamilyKey: 'Owner Table',
									officeSiblingOrdinal: family.familyOrdinal
								}
							: {}),
						officeTableHeaderText: 'Owner | State',
						officeTableHeaders: ['Owner', 'State'],
						sectionPath: [
							lane.lane,
							'Validation Pack',
							'Evidence Review (2)',
							'Review Notes (2)',
							branch.branchOrdinal === 1
								? 'Closure Notes'
								: 'Closure Notes (2)',
							`Owner Table (${family.familyOrdinal})`
						],
						sectionTitle: `Owner Table (${family.familyOrdinal})`
					});
					expect(
						ownerChunk?.metadata?.officeTableContextText
					).toContain(
						`Queue ${lane.laneText} ${family.familyText} ${branch.branchScopeText} closure owner review before the ${family.familyText} sibling owner table opens.`
					);
					if (family.hasFollowUp) {
						expect(
							ownerChunk?.metadata?.officeTableFollowUpText
						).toContain(
							`Archive ${lane.laneText} sixth ${branch.branchScopeText} closure owner notes with this closure branch.`
						);
						expect(
							ownerChunk?.metadata?.officeTableFollowUpText
						).toContain(
							`Keep ${lane.laneText} sixth ${branch.branchScopeText} closure summary scoped to this branch after sixth owner routing.`
						);
					} else {
						expect(
							ownerChunk?.metadata?.officeTableFollowUpText
						).toBeUndefined();
					}
				}
			}
		}
		expect(
			stableSlices.map((chunk) => chunk.metadata?.officeTableBodyRowStart)
		).toEqual([1, 2, 3, 4]);
		expect(
			readySlices.map((chunk) => chunk.metadata?.officeTableBodyRowStart)
		).toEqual([1, 2, 3, 4]);
		expect(
			stableValidationSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			readyValidationSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			stableEvidenceReviewSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			readyEvidenceReviewSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			stableEvidenceReviewFollowUpSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			readyEvidenceReviewFollowUpSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			stableEvidenceReviewFollowUpSiblingSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(
			readyEvidenceReviewFollowUpSiblingSlices.map(
				(chunk) => chunk.metadata?.officeTableBodyRowStart
			)
		).toEqual([1, 2, 3, 4]);
		expect(stableSlices[0]?.text).toContain(
			'Only promote stable evidence that already matches the blocked rollout state.'
		);
		expect(stableSlices[0]?.text).toContain(
			'Use this table to track stable evidence by artifact.'
		);
		expect(readySlices[0]?.text).toContain(
			'Only promote ready evidence that already matches the handoff state.'
		);
		expect(readySlices[0]?.text).toContain(
			'Use this table to track ready evidence by artifact.'
		);
		expect(stableChecklistListChunks.length).toBeGreaterThan(0);
		expect(readyChecklistListChunks.length).toBeGreaterThan(0);
		const stableChecklistText = stableChecklistListChunks
			.map((chunk) => chunk.text)
			.join('\n\n');
		const readyChecklistText = readyChecklistListChunks
			.map((chunk) => chunk.text)
			.join('\n\n');
		expect(stableChecklistText).toContain(
			'Use this checklist to verify stable ownership before rollout.'
		);
		expect(stableChecklistText).toContain(
			'Only promote stable evidence that already matches the blocked rollout state.'
		);
		expect(readyChecklistText).toContain(
			'Use this checklist to verify ready ownership before handoff.'
		);
		expect(readyChecklistText).toContain(
			'Only promote ready evidence that already matches the handoff state.'
		);
		expect(stableChecklistText).toContain('Confirm stable owner');
		expect(stableChecklistText).toContain('Attach stable evidence');
		expect(readyChecklistText).toContain('Confirm ready owner');
		expect(readyChecklistText).toContain('Attach ready evidence');
		expect(stableSlices[0]?.text).toContain(
			'Row 2. A: Approval trace | B: Blocked'
		);
		expect(readySlices[0]?.text).toContain(
			'Row 2. A: Handoff trace | B: Ready'
		);
		expect(stableOwnerTableChunk?.text).toContain(
			'Row 2. A: Stable lead | B: Blocked'
		);
		expect(readyOwnerTableChunk?.text).toContain(
			'Row 2. A: Ready lead | B: Ready'
		);
		const stableValidationChecklistText = stableValidationChecklistChunks
			.map((chunk) => chunk.text)
			.join('\n\n');
		const readyValidationChecklistText = readyValidationChecklistChunks
			.map((chunk) => chunk.text)
			.join('\n\n');
		expect(stableValidationChecklistText).toContain(
			'Use this checklist to verify stable validation before release signoff.'
		);
		expect(stableValidationChecklistText).toContain(
			'Confirm stable validation owner'
		);
		expect(stableValidationChecklistText).toContain(
			'Attach stable validation evidence'
		);
		const stableValidationNarrativeText = stableValidationNarrativeChunks
			.map((chunk) => chunk.text)
			.join('\n\n');
		const readyValidationNarrativeText = readyValidationNarrativeChunks
			.map((chunk) => chunk.text)
			.join('\n\n');
		expect(stableValidationNarrativeText).toContain(
			'Keep validation evidence nested under the stable lane.'
		);
		expect(stableValidationNarrativeText).toContain(
			'Review stable validation ownership before signoff.'
		);
		expect(readyValidationChecklistText).toContain(
			'Use this checklist to verify ready validation before handoff signoff.'
		);
		expect(readyValidationChecklistText).toContain(
			'Confirm ready validation owner'
		);
		expect(readyValidationChecklistText).toContain(
			'Attach ready validation evidence'
		);
		expect(readyValidationNarrativeText).toContain(
			'Keep validation evidence nested under the ready lane.'
		);
		expect(readyValidationNarrativeText).toContain(
			'Review ready validation ownership before handoff signoff.'
		);
		const stableEvidenceReviewChecklistText =
			stableEvidenceReviewChecklistChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		const readyEvidenceReviewChecklistText =
			readyEvidenceReviewChecklistChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		const stableEvidenceReviewNarrativeText =
			stableEvidenceReviewNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		const readyEvidenceReviewNarrativeText =
			readyEvidenceReviewNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		expect(stableEvidenceReviewChecklistText).toContain(
			'Use this checklist to verify stable evidence review before routing blockers.'
		);
		expect(stableEvidenceReviewChecklistText).toContain(
			'Confirm stable review owner'
		);
		expect(stableEvidenceReviewChecklistText).toContain(
			'Attach stable review evidence'
		);
		expect(readyEvidenceReviewChecklistText).toContain(
			'Use this checklist to verify ready evidence review before routing blockers.'
		);
		expect(readyEvidenceReviewChecklistText).toContain(
			'Confirm ready review owner'
		);
		expect(readyEvidenceReviewChecklistText).toContain(
			'Attach ready review evidence'
		);
		expect(stableEvidenceReviewNarrativeText).toContain(
			'Keep stable evidence review isolated to the nested validation scope.'
		);
		expect(stableEvidenceReviewNarrativeText).toContain(
			'Record stable review notes before routing ownership updates.'
		);
		expect(readyEvidenceReviewNarrativeText).toContain(
			'Keep ready evidence review isolated to the nested validation scope.'
		);
		expect(readyEvidenceReviewNarrativeText).toContain(
			'Record ready review notes before routing ownership updates.'
		);
		const stableEvidenceReviewFollowUpChecklistText =
			stableEvidenceReviewFollowUpChecklistChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		const readyEvidenceReviewFollowUpChecklistText =
			readyEvidenceReviewFollowUpChecklistChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		const stableEvidenceReviewFollowUpNarrativeText =
			stableEvidenceReviewFollowUpNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		const readyEvidenceReviewFollowUpNarrativeText =
			readyEvidenceReviewFollowUpNarrativeChunks
				.map((chunk) => chunk.text)
				.join('\n\n');
		expect(stableEvidenceReviewFollowUpChecklistText).toContain(
			'Use this checklist to verify stable follow-up review before final route confirmation.'
		);
		expect(stableEvidenceReviewFollowUpChecklistText).toContain(
			'Confirm stable follow-up review owner'
		);
		expect(stableEvidenceReviewFollowUpChecklistText).toContain(
			'Attach stable follow-up review evidence'
		);
		expect(readyEvidenceReviewFollowUpChecklistText).toContain(
			'Use this checklist to verify ready follow-up review before final route confirmation.'
		);
		expect(readyEvidenceReviewFollowUpChecklistText).toContain(
			'Confirm ready follow-up review owner'
		);
		expect(readyEvidenceReviewFollowUpChecklistText).toContain(
			'Attach ready follow-up review evidence'
		);
		expect(stableEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Keep stable follow-up review artifacts grouped under the second nested evidence table.'
		);
		expect(readyEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Keep ready follow-up review artifacts grouped under the second nested evidence table.'
		);
		expect(stableEvidenceReviewFollowUpNarrativeText).toContain(
			'Keep stable follow-up evidence review isolated to the nested validation scope.'
		);
		expect(stableEvidenceReviewFollowUpNarrativeText).toContain(
			'Record stable follow-up review notes before final route confirmation.'
		);
		expect(readyEvidenceReviewFollowUpNarrativeText).toContain(
			'Keep ready follow-up evidence review isolated to the nested validation scope.'
		);
		expect(readyEvidenceReviewFollowUpNarrativeText).toContain(
			'Record ready follow-up review notes before final route confirmation.'
		);
		expect(stableValidationSlices[0]?.text).toContain(
			'Escalate stable validation blockers through the nested evidence path.'
		);
		expect(stableValidationSlices[0]?.text).toContain(
			'Use this table to track stable validation evidence by artifact.'
		);
		expect(stableValidationSlices[0]?.text).toContain(
			'Row 2. A: Stable validation trace | B: Blocked'
		);
		expect(readyValidationSlices[0]?.text).toContain(
			'Escalate ready validation blockers through the nested evidence path.'
		);
		expect(readyValidationSlices[0]?.text).toContain(
			'Use this table to track ready validation evidence by artifact.'
		);
		expect(readyValidationSlices[0]?.text).toContain(
			'Row 2. A: Ready validation trace | B: Ready'
		);
		expect(stableEvidenceReviewSlices[0]?.text).toContain(
			'Escalate stable review blockers through the nested review evidence table.'
		);
		expect(stableEvidenceReviewSlices[0]?.text).toContain(
			'Use this table to track stable review evidence by artifact.'
		);
		expect(stableEvidenceReviewSlices[0]?.text).toContain(
			'Row 2. A: Stable review trace | B: Blocked'
		);
		expect(readyEvidenceReviewSlices[0]?.text).toContain(
			'Escalate ready review blockers through the nested review evidence table.'
		);
		expect(readyEvidenceReviewSlices[0]?.text).toContain(
			'Use this table to track ready review evidence by artifact.'
		);
		expect(readyEvidenceReviewSlices[0]?.text).toContain(
			'Row 2. A: Ready review trace | B: Ready'
		);
		expect(stableEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Escalate stable follow-up review blockers through the second nested review evidence table.'
		);
		expect(stableEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Use this table to track stable follow-up review evidence by artifact.'
		);
		expect(stableEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Row 2. A: Stable follow-up review trace | B: Blocked'
		);
		expect(readyEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Escalate ready follow-up review blockers through the second nested review evidence table.'
		);
		expect(readyEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Use this table to track ready follow-up review evidence by artifact.'
		);
		expect(readyEvidenceReviewFollowUpSlices[0]?.text).toContain(
			'Row 2. A: Ready follow-up review trace | B: Ready'
		);
		expect(stableEvidenceReviewFollowUpSiblingSlices[0]?.text).toContain(
			'Archive stable follow-up owner notes with this owner table before the duplicate evidence family begins.'
		);
		expect(stableEvidenceReviewFollowUpSiblingSlices[0]?.text).toContain(
			'Use this table to track stable sibling follow-up evidence by artifact.'
		);
		expect(stableEvidenceReviewFollowUpSiblingSlices[0]?.text).toContain(
			'Row 2. A: Stable sibling review trace | B: Watch'
		);
		expect(readyEvidenceReviewFollowUpSiblingSlices[0]?.text).toContain(
			'Archive ready follow-up owner notes with this owner table before the duplicate evidence family begins.'
		);
		expect(readyEvidenceReviewFollowUpSiblingSlices[0]?.text).toContain(
			'Use this table to track ready sibling follow-up evidence by artifact.'
		);
		expect(readyEvidenceReviewFollowUpSiblingSlices[0]?.text).toContain(
			'Row 2. A: Ready sibling review trace | B: Watch'
		);
		expect(stableValidationOwnerTableChunk?.text).toContain(
			'Route unresolved stable validation owners through this table.'
		);
		expect(stableValidationOwnerTableChunk?.text).toContain(
			'Row 2. A: Stable validation lead | B: Blocked'
		);
		expect(readyValidationOwnerTableChunk?.text).toContain(
			'Route unresolved ready validation owners through this table.'
		);
		expect(readyValidationOwnerTableChunk?.text).toContain(
			'Row 2. A: Ready validation lead | B: Ready'
		);
		expect(stableEvidenceReviewOwnerTableChunk?.text).toContain(
			'Route unresolved stable review owners through this table.'
		);
		expect(stableEvidenceReviewOwnerTableChunk?.text).toContain(
			'Row 2. A: Stable review lead | B: Blocked'
		);
		expect(readyEvidenceReviewOwnerTableChunk?.text).toContain(
			'Route unresolved ready review owners through this table.'
		);
		expect(readyEvidenceReviewOwnerTableChunk?.text).toContain(
			'Row 2. A: Ready review lead | B: Ready'
		);
		expect(stableEvidenceReviewFollowUpOwnerTableChunk?.text).toContain(
			'Route unresolved stable follow-up review owners through this table.'
		);
		expect(stableEvidenceReviewFollowUpOwnerTableChunk?.text).toContain(
			'Row 2. A: Stable follow-up review lead | B: Blocked'
		);
		expect(readyEvidenceReviewFollowUpOwnerTableChunk?.text).toContain(
			'Route unresolved ready follow-up review owners through this table.'
		);
		expect(readyEvidenceReviewFollowUpOwnerTableChunk?.text).toContain(
			'Row 2. A: Ready follow-up review lead | B: Ready'
		);
		expect(
			stableEvidenceReviewFollowUpSiblingOwnerTableChunk?.text
		).toContain(
			'Record stable sibling follow-up evidence notes after this table before owner routing.'
		);
		expect(
			stableEvidenceReviewFollowUpSiblingOwnerTableChunk?.text
		).toContain(
			'Archive stable sibling follow-up owner notes with this table.'
		);
		expect(
			stableEvidenceReviewFollowUpSiblingOwnerTableChunk?.text
		).toContain('Row 2. A: Stable sibling follow-up lead | B: Watch');
		expect(
			readyEvidenceReviewFollowUpSiblingOwnerTableChunk?.text
		).toContain(
			'Record ready sibling follow-up evidence notes after this table before owner routing.'
		);
		expect(
			readyEvidenceReviewFollowUpSiblingOwnerTableChunk?.text
		).toContain(
			'Archive ready sibling follow-up owner notes with this table.'
		);
		expect(
			readyEvidenceReviewFollowUpSiblingOwnerTableChunk?.text
		).toContain('Row 2. A: Ready sibling follow-up lead | B: Watch');
	});

	it('preserves spreadsheet row and header context in extracted text', async () => {
		const xlsx = createStoredZip(readFixtureTree('office/xlsx'));
		const loaded = await withTempFixtureFile(
			'fixtures/context.xlsx',
			xlsx,
			(path) => loadRAGDocumentFile({ path })
		);

		expect(loaded.text).toContain('Sheet Overview');
		expect(loaded.text).toContain('Row 1. A: Metric | B: Status');
		expect(loaded.text).toContain(
			'Row 2. Metric: Overview heading | Status: Ready'
		);
		expect(loaded.text).toContain('Row 3. C: Owner | D: Due date');
		expect(loaded.text).toContain(
			'Row 4. Owner: Ready ops lead | Due date: 2026-04-21'
		);
		expect(loaded.text).toContain('Row 6. E: Metric | F: Status');
		expect(loaded.text).toContain(
			'Row 7. Metric: Overview rollback proof | Status: Watch'
		);
		expect(loaded.text).toContain(
			'Row 2. Metric: Escalation checklist | Status: Blocked'
		);
		expect(loaded.text).toContain(
			'Row 5. Metric: Checklist gate | Status: Watch'
		);
		expect(loaded.text).toContain('Row 7. C: Owner | D: Due date');
		expect(loaded.text).toContain(
			'Row 8. Owner: Incident commander | Due date: 2026-04-22'
		);
		expect(loaded.text).toContain('Sheet Operations');
		expect(loaded.text).toContain(
			'Row 2. Metric: Rollback checkpoint | Status: Approved'
		);
		expect(loaded.text).toContain(
			'Row 5. Owner: Audit owner | Due date: 2026-04-23'
		);
		expect(loaded.text).toContain(
			'Row 8. Metric: Closure packet | Status: Archive'
		);
		expect(loaded.text).toContain('Sheet Signals');
		expect(loaded.text).toContain(
			'Row 2. Gate: Stable | Severity: High | Owner: Ops lead'
		);
		expect(loaded.text).toContain('Row 4. A: Gate | C: Owner');
		expect(loaded.text).toContain(
			'Row 5. Gate: Closure | Severity: Medium | Owner: Audit lead'
		);
		expect(loaded.text).toContain('Row 7. D: Gate | F: Owner');
		expect(loaded.text).toContain(
			'Row 8. Gate: Archive | Severity: Ready | Owner: Release lead'
		);
		expect(loaded.text).toContain('Sheet Escalations');
		expect(loaded.text).toContain(
			'Row 2. Gate: Pager | Severity: High | Owner: Incident lead'
		);
		expect(loaded.text).toContain('Row 7. E: Gate | G: Owner');
		expect(loaded.text).toContain(
			'Row 8. Gate: Closure | Severity: Archive | Owner: Audit lead'
		);
		expect(loaded.metadata).toMatchObject({
			sheetNames: [
				'Overview',
				'Checklist',
				'Operations',
				'Signals',
				'Escalations'
			]
		});
	});

	it('preserves fixture-backed spreadsheet table lineage across repeated table families', async () => {
		const xlsx = createStoredZip(readFixtureTree('office/xlsx'));
		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: xlsx.toString('base64'),
					encoding: 'base64',
					name: 'fixture.xlsx'
				}
			]
		});
		const overviewSheet = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'spreadsheet_sheet' &&
				document.metadata?.sheetName === 'Overview'
		);
		const checklistSheet = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'spreadsheet_sheet' &&
				document.metadata?.sheetName === 'Checklist'
		);
		const operationsSheet = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'spreadsheet_sheet' &&
				document.metadata?.sheetName === 'Operations'
		);
		const signalsSheet = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'spreadsheet_sheet' &&
				document.metadata?.sheetName === 'Signals'
		);
		const escalationsSheet = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'spreadsheet_sheet' &&
				document.metadata?.sheetName === 'Escalations'
		);

		expect(overviewSheet?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [3, 6],
			sheetTableCount: 3
		});
		expect(checklistSheet?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4, 7],
			sheetTableCount: 3
		});
		expect(operationsSheet?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4, 7],
			sheetTableCount: 3
		});
		expect(signalsSheet?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4, 7],
			sheetTableCount: 3
		});
		expect(escalationsSheet?.metadata).toMatchObject({
			repeatedHeaderRowNumbers: [4, 7],
			sheetTableCount: 3
		});

		const preparedOverview = prepareRAGDocument({
			...overviewSheet!,
			chunking: {
				maxChunkLength: 240,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedChecklist = prepareRAGDocument({
			...checklistSheet!,
			chunking: {
				maxChunkLength: 240,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedOperations = prepareRAGDocument({
			...operationsSheet!,
			chunking: {
				maxChunkLength: 240,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedSignals = prepareRAGDocument({
			...signalsSheet!,
			chunking: {
				maxChunkLength: 240,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedEscalations = prepareRAGDocument({
			...escalationsSheet!,
			chunking: {
				maxChunkLength: 240,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});

		expect(
			preparedOverview.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Overview', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 2],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 2,
				spreadsheetTableIndex: 2
			})
		);
		expect(
			preparedOverview.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Overview', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 3],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 3,
				spreadsheetTableIndex: 3
			})
		);
		expect(
			preparedChecklist.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Checklist', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 2],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 2,
				spreadsheetTableIndex: 2
			})
		);
		expect(
			preparedChecklist.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Checklist', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 3],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 3,
				spreadsheetTableIndex: 3
			})
		);
		expect(
			preparedOperations.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Operations', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 2],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 2,
				spreadsheetTableIndex: 2
			})
		);
		expect(
			preparedOperations.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Operations', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 3],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 3,
				spreadsheetTableIndex: 3
			})
		);
		expect(
			preparedSignals.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Signals', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 2],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 2,
				spreadsheetTableIndex: 2
			})
		);
		expect(
			preparedSignals.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Signals', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 3],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 3,
				spreadsheetTableIndex: 3
			})
		);
		expect(
			preparedEscalations.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Escalations', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 2],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 2,
				spreadsheetTableIndex: 2
			})
		);
		expect(
			preparedEscalations.chunks.map((chunk) => chunk.metadata)
		).toContainEqual(
			expect.objectContaining({
				sectionFamilyPath: ['Escalations', 'Spreadsheet Table'],
				sectionOrdinalPath: [1, 3],
				sectionSiblingFamilyKey: 'Spreadsheet Table',
				sectionSiblingOrdinal: 3,
				spreadsheetTableIndex: 3
			})
		);
	});

	it('preserves pptx speaker notes in extracted text', async () => {
		const pptx = createStoredZip(readFixtureTree('office/pptx'));
		const loaded = await withTempFixtureFile(
			'fixtures/notes-deck.pptx',
			pptx,
			(path) => loadRAGDocumentFile({ path })
		);

		expect(loaded.text).toContain('Release handoff summary');
		expect(loaded.text).toContain('Stable blockers');
		expect(loaded.text).toContain('Title anchor');
		expect(loaded.text).toContain('Follow-up owners');
		expect(loaded.text).toContain('Escalation review');
		expect(loaded.text).toContain('Closure evidence');
		expect(loaded.text).toContain('Remediation archive');
		expect(loaded.text).toContain('Audit handoff');
		expect(loaded.text).toContain('Notes-first handoff');
		expect(loaded.text).toContain('Title-led checkpoint');
		expect(loaded.text).toContain('Deck title review');
		expect(loaded.text).toContain(
			'Speaker notes: Review stable blockers before the rollout meeting.'
		);
		expect(loaded.text).toContain(
			'Speaker notes: Confirm remediation history is attached to the release incident and the follow-up owner is recorded.'
		);
		expect(loaded.text).toContain(
			'Speaker notes: Confirm the release archive includes the closure evidence bundle and the remediation owner handoff.'
		);
		expect(loaded.text).toContain(
			'Speaker notes: Use the speaker notes as the primary handoff evidence when the audit handoff slide body is terse.'
		);
		expect(loaded.text).toContain(
			'Speaker notes: Keep the repeated slide title stable when the deck title is the strongest handoff cue.'
		);
		expect(loaded.metadata).toMatchObject({
			slideCount: 5
		});
	});

	it('preserves fixture-backed presentation slide lineage across repeated slide titles', async () => {
		const pptx = createStoredZip(readFixtureTree('office/pptx'));
		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: pptx.toString('base64'),
					encoding: 'base64',
					name: 'fixture.pptx'
				}
			]
		});
		const slideOne = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'presentation_slide' &&
				document.metadata?.slideNumber === 1
		);
		const slideTwo = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'presentation_slide' &&
				document.metadata?.slideNumber === 2
		);
		const slideThree = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'presentation_slide' &&
				document.metadata?.slideNumber === 3
		);
		const slideFour = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'presentation_slide' &&
				document.metadata?.slideNumber === 4
		);
		const slideFive = loaded.documents.find(
			(document) =>
				document.metadata?.sourceNativeKind === 'presentation_slide' &&
				document.metadata?.slideNumber === 5
		);
		const preparedOne = prepareRAGDocument({
			...slideOne!,
			chunking: {
				maxChunkLength: 180,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedTwo = prepareRAGDocument({
			...slideTwo!,
			chunking: {
				maxChunkLength: 180,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedThree = prepareRAGDocument({
			...slideThree!,
			chunking: {
				maxChunkLength: 180,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedFour = prepareRAGDocument({
			...slideFour!,
			chunking: {
				maxChunkLength: 180,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});
		const preparedFive = prepareRAGDocument({
			...slideFive!,
			chunking: {
				maxChunkLength: 180,
				minChunkLength: 20,
				strategy: 'source_aware'
			}
		});

		expect(slideOne?.metadata).toMatchObject({
			slideNumber: 1,
			slideTitle: 'Release handoff summary'
		});
		expect(slideTwo?.metadata).toMatchObject({
			slideNumber: 2,
			slideTitle: 'Release handoff summary'
		});
		expect(slideThree?.metadata).toMatchObject({
			slideNumber: 3,
			slideTitle: 'Release handoff summary'
		});
		expect(slideFour?.metadata).toMatchObject({
			slideNumber: 4,
			slideTitle: 'Release handoff summary'
		});
		expect(slideFive?.metadata).toMatchObject({
			slideNumber: 5,
			slideTitle: 'Release handoff summary'
		});
		expect(preparedOne.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Release handoff summary'],
			sectionOrdinalPath: [1],
			sectionSiblingFamilyKey: 'Release handoff summary',
			sectionSiblingOrdinal: 1
		});
		expect(preparedTwo.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Release handoff summary'],
			sectionOrdinalPath: [2],
			sectionSiblingFamilyKey: 'Release handoff summary',
			sectionSiblingOrdinal: 2
		});
		expect(preparedThree.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Release handoff summary'],
			sectionOrdinalPath: [3],
			sectionSiblingFamilyKey: 'Release handoff summary',
			sectionSiblingOrdinal: 3
		});
		expect(preparedFour.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Release handoff summary'],
			sectionOrdinalPath: [4],
			sectionSiblingFamilyKey: 'Release handoff summary',
			sectionSiblingOrdinal: 4
		});
		expect(preparedFive.chunks[0]?.metadata).toMatchObject({
			sectionFamilyPath: ['Release handoff summary'],
			sectionOrdinalPath: [5],
			sectionSiblingFamilyKey: 'Release handoff summary',
			sectionSiblingOrdinal: 5
		});
	});

	it('matches the extraction fixture scorecard for office archive fixtures', async () => {
		for (const fixture of EXTRACTION_FIXTURE_SCORECARD.officeArchives) {
			const zipped = createStoredZip(readFixtureTree(fixture.tree));
			const loaded = await withTempFixtureFile(
				fixture.fileName,
				zipped,
				(path) => loadRAGDocumentFile({ path })
			);

			for (const expectedText of fixture.expectedText) {
				expect(loaded.text).toContain(expectedText);
			}

			if (fixture.expectedMetadata) {
				expect(loaded.metadata).toMatchObject(fixture.expectedMetadata);
			}
		}
	});

	it('uses fixture-backed sources in directory ingest regression coverage', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-fixture-dir-')
		);

		try {
			writeFileSync(
				join(tempDir, 'sample.md'),
				loadExtractionFixture('sample.md')
			);
			writeFileSync(
				join(tempDir, 'sample.html'),
				loadExtractionFixture('sample.html')
			);
			writeFileSync(
				join(tempDir, 'message.eml'),
				loadExtractionFixture('message.eml')
			);

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'extraction-v1' },
				directory: tempDir,
				includeExtensions: ['.md', '.html', '.eml']
			});

			expect(loaded.documents).toHaveLength(3);
			expect(
				loaded.documents.every(
					(document) =>
						document.metadata?.fixturePack === 'extraction-v1'
				)
			).toBe(true);
			expect(
				loaded.documents.map((document) => document.source).sort()
			).toEqual(['message.eml', 'sample.html', 'sample.md']);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('reconstructs email threads from real fixture-backed eml directories', async () => {
		const loaded = await loadRAGDocumentsFromDirectory({
			baseMetadata: { fixturePack: 'extraction-email-thread' },
			directory: join(EXTRACTION_FIXTURE_DIRECTORY, 'email_thread'),
			includeExtensions: ['.eml']
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<root-thread@example.com>'
		);
		const replyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<reply-thread@example.com>'
		);
		const attachmentReplyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<attachment-thread@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const attachmentDocument = loaded.documents.find(
			(document) =>
				document.metadata?.emailKind === 'attachment' &&
				document.metadata?.attachmentName === 'owner.txt'
		);

		expect(loaded.documents).toHaveLength(4);
		expect(
			loaded.documents.every(
				(document) =>
					document.metadata?.fixturePack === 'extraction-email-thread'
			)
		).toBe(true);
		expect(
			loaded.documents.map((document) => document.source).sort()
		).toEqual([
			'attachment.eml',
			'attachment.eml#attachments/owner.txt',
			'reply.eml',
			'root.eml'
		]);
		expect(rootDocument?.metadata).toMatchObject({
			threadKnownMessageCount: 3,
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 3,
			threadRootMessageId: '<root-thread@example.com>'
		});
		const rootKnownMessageIds = Array.isArray(
			rootDocument?.metadata?.threadKnownMessageIds
		)
			? rootDocument.metadata.threadKnownMessageIds
			: [];
		const rootLoadedMessageIds = Array.isArray(
			rootDocument?.metadata?.threadLoadedMessageIds
		)
			? rootDocument.metadata.threadLoadedMessageIds
			: [];
		const rootLoadedMessageSources = Array.isArray(
			rootDocument?.metadata?.threadLoadedMessageSources
		)
			? rootDocument.metadata.threadLoadedMessageSources
			: [];
		const rootThreadParticipants = Array.isArray(
			rootDocument?.metadata?.threadParticipants
		)
			? rootDocument.metadata.threadParticipants
			: [];
		expect([...rootKnownMessageIds].sort()).toEqual([
			'<attachment-thread@example.com>',
			'<reply-thread@example.com>',
			'<root-thread@example.com>'
		]);
		expect([...rootLoadedMessageIds].sort()).toEqual([
			'<attachment-thread@example.com>',
			'<reply-thread@example.com>',
			'<root-thread@example.com>'
		]);
		expect([...rootLoadedMessageSources].sort()).toEqual([
			'attachment.eml',
			'reply.eml',
			'root.eml'
		]);
		expect([...rootThreadParticipants].sort()).toEqual([
			'attachment@example.com',
			'ops@example.com',
			'reply@example.com',
			'root@example.com'
		]);
		expect(replyDocument?.metadata).toMatchObject({
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<root-thread@example.com>',
			emailReplyParentSource: 'root.eml',
			threadLoadedMessageCount: 3
		});
		expect(attachmentReplyDocument?.metadata).toMatchObject({
			attachmentCount: 1,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<reply-thread@example.com>',
			emailReplyParentSource: 'reply.eml',
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 3
		});
		expect(attachmentDocument?.metadata).toMatchObject({
			attachmentName: 'owner.txt',
			emailAttachmentRole: 'file_attachment',
			emailMessageSource: 'attachment.eml',
			threadKnownMessageCount: 3,
			threadLoadedAttachmentCount: 1,
			threadLoadedMessageCount: 3
		});
	});

	it('reconstructs real mailbox-style email chains with named headers, attached eml messages, and nested archive descendants', async () => {
		const loaded = await loadRAGDocumentsFromDirectory({
			baseMetadata: { fixturePack: 'extraction-email-mailbox' },
			directory: join(EXTRACTION_FIXTURE_DIRECTORY, 'email_mailbox'),
			includeExtensions: ['.eml']
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<mailbox-root@example.com>'
		);
		const bundleDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<mailbox-bundle@example.com>'
		);
		const forwardedMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<mailbox-forwarded@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const nestedArchiveChild = loaded.documents.find(
			(document) =>
				document.metadata?.archiveEntryName === 'guide.md' &&
				document.source ===
					'bundle.eml#attachments/forwarded.eml#attachments/bundle.zip#docs/guide.md'
		);

		expect(loaded.documents).toHaveLength(4);
		expect(
			loaded.documents.every(
				(document) =>
					document.metadata?.fixturePack ===
					'extraction-email-mailbox'
			)
		).toBe(true);
		expect(bundleDocument?.metadata).toMatchObject({
			bccAddresses: ['audit@example.com'],
			ccAddresses: ['manager@example.com', 'reviewer@example.com'],
			fromAddress: 'bundle@example.com',
			fromDisplayName: 'Bundle Owner',
			participantAddresses: [
				'bundle@example.com',
				'ops@example.com',
				'manager@example.com',
				'reviewer@example.com',
				'audit@example.com',
				'bundle-reply@example.com'
			],
			participantDisplayNames: [
				'Bundle Owner',
				'Ops Team',
				'Release Manager',
				'Reviewer',
				'Audit Trail',
				'Bundle Desk'
			],
			replyToAddresses: ['bundle-reply@example.com'],
			toAddresses: ['ops@example.com']
		});
		expect(forwardedMessage?.metadata).toMatchObject({
			ccAddresses: ['manager@example.com'],
			emailAncestorMessageIds: ['<mailbox-bundle@example.com>'],
			emailAncestorMessageSources: ['bundle.eml'],
			emailForwardedHeaderFieldNames: ['from', 'date', 'subject', 'to'],
			emailMessageDepth: 1,
			emailQuotedMaxDepth: 2,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<mailbox-root@example.com>',
			emailReplyParentSource: 'root.eml',
			fromAddress: 'forwarded@example.com',
			fromDisplayName: 'Release Escalations',
			participantAddresses: [
				'forwarded@example.com',
				'ops@example.com',
				'manager@example.com',
				'reply@example.com'
			],
			participantDisplayNames: [
				'Release Escalations',
				'Ops Team',
				'Release Manager',
				'Incident Desk'
			],
			replyToAddresses: ['reply@example.com'],
			threadParticipantAddresses: [
				'forwarded@example.com',
				'ops@example.com',
				'manager@example.com',
				'reply@example.com',
				'root@example.com'
			],
			threadParticipantDisplayNames: [
				'Release Escalations',
				'Ops Team',
				'Release Manager',
				'Incident Desk',
				'Root Sender'
			]
		});
		expect(rootDocument?.metadata).toMatchObject({
			fromAddress: 'root@example.com',
			fromDisplayName: 'Root Sender',
			threadParticipantAddresses: [
				'forwarded@example.com',
				'ops@example.com',
				'manager@example.com',
				'reply@example.com',
				'root@example.com'
			]
		});
		expect(nestedArchiveChild?.metadata).toMatchObject({
			archiveEntryName: 'guide.md',
			archiveRootSource:
				'bundle.eml#attachments/forwarded.eml#attachments/bundle.zip',
			emailAncestorMessageIds: ['<mailbox-bundle@example.com>'],
			emailAncestorMessageSources: ['bundle.eml'],
			emailAttachmentSource:
				'bundle.eml#attachments/forwarded.eml#attachments/bundle.zip',
			emailMessageDepth: 1,
			emailMessageSource: 'bundle.eml#attachments/forwarded.eml'
		});
		expect(nestedArchiveChild?.text).toContain(
			'Mailbox attachment archive text'
		);
	});

	it('reconstructs html-heavy mailbox chains with inline resources, attached eml messages, and nested archive descendants', async () => {
		const loaded = await loadRAGDocumentsFromDirectory({
			baseMetadata: { fixturePack: 'extraction-email-mailbox-html' },
			directory: join(EXTRACTION_FIXTURE_DIRECTORY, 'email_mailbox_html'),
			includeExtensions: ['.eml']
		});

		const rootDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<html-root@example.com>'
		);
		const replyDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<html-reply@example.com>'
		);
		const bundleDocument = loaded.documents.find(
			(document) =>
				document.metadata?.messageId === '<html-bundle@example.com>'
		);
		const inlineDocument = loaded.documents.find(
			(document) =>
				document.metadata?.emailKind === 'attachment' &&
				document.metadata?.attachmentName === 'inline-note.txt'
		);
		const forwardedMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<html-forwarded@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const followupMessage = loaded.documents.find(
			(document) =>
				document.metadata?.messageId ===
					'<html-followup@example.com>' &&
				document.metadata?.emailKind === 'message'
		);
		const nestedArchiveChild = loaded.documents.find(
			(document) =>
				document.source ===
				'bundle.eml#attachments/forwarded.eml#attachments/bundle.zip#docs/guide.md'
		);
		const preparedForwarded = forwardedMessage
			? prepareRAGDocument(forwardedMessage, {
					maxChunkLength: 220,
					minChunkLength: 1,
					strategy: 'source_aware'
				})
			: undefined;
		const preparedFollowup = followupMessage
			? prepareRAGDocument(followupMessage, {
					maxChunkLength: 220,
					minChunkLength: 1,
					strategy: 'source_aware'
				})
			: undefined;
		const forwardedHeaderChunk = preparedForwarded?.chunks.find(
			(chunk) => chunk.metadata?.emailSectionKind === 'forwarded_headers'
		);
		const followupForwardedChunks =
			preparedFollowup?.chunks.filter(
				(chunk) =>
					chunk.metadata?.emailSectionKind === 'forwarded_headers'
			) ?? [];

		expect(loaded.documents).toHaveLength(7);
		expect(bundleDocument?.text).toContain(
			'HTML mailbox summary with inline note.'
		);
		expect(replyDocument?.metadata).toMatchObject({
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<html-root@example.com>',
			emailReplyParentSource: 'root.eml',
			fromAddress: 'html-responder@example.com',
			fromDisplayName: 'HTML Responder',
			threadLoadedMessageCount: 5,
			threadLoadedMessageIds: [
				'<html-bundle@example.com>',
				'<html-forwarded@example.com>',
				'<html-followup@example.com>',
				'<html-reply@example.com>',
				'<html-root@example.com>'
			]
		});
		expect(bundleDocument?.metadata).toMatchObject({
			attachmentCount: 3,
			attachmentNames: [
				'inline-note.txt',
				'forwarded.eml',
				'followup.eml'
			],
			embeddedResourceContentIds: ['<inline-html@example.com>'],
			embeddedResourceCount: 1,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<html-reply@example.com>',
			emailReplyParentSource: 'reply.eml',
			fromAddress: 'html-bundle@example.com',
			fromDisplayName: 'HTML Bundle Owner',
			hasInlineResources: true,
			replyToAddresses: ['html-desk@example.com'],
			threadLoadedMessageCount: 5,
			toAddresses: ['ops@example.com']
		});
		expect(inlineDocument?.metadata).toMatchObject({
			attachmentContentId: '<inline-html@example.com>',
			attachmentDisposition: 'inline',
			attachmentEmbeddedReferenceMatched: true,
			attachmentName: 'inline-note.txt',
			emailAttachmentRole: 'inline_resource',
			emailAttachmentSource: 'bundle.eml#attachments/inline-note.txt'
		});
		expect(forwardedMessage?.metadata).toMatchObject({
			emailAncestorMessageIds: ['<html-bundle@example.com>'],
			emailAncestorMessageSources: ['bundle.eml'],
			emailAttachmentRole: 'attached_message',
			emailAttachmentSource: 'bundle.eml#attachments/forwarded.eml',
			emailBodySectionCount: 3,
			emailForwardedHeaderFieldCount: 4,
			emailForwardedHeaderFieldNames: ['from', 'date', 'subject', 'to'],
			emailForwardedDate: 'Tue, Apr 21, 2026 at 9:15 AM',
			emailForwardedFromAddress: 'prior@example.com',
			emailForwardedParticipantAddresses: [
				'prior@example.com',
				'ops@example.com'
			],
			emailForwardedSubject: 'Earlier html escalation',
			emailForwardedTimestamp: '2026-04-21T09:15:00.000Z',
			emailForwardedToAddresses: ['ops@example.com'],
			emailMessageDepth: 1,
			emailMessageSource: 'bundle.eml#attachments/forwarded.eml',
			emailMessageSourceKind: 'attached_message',
			emailQuotedMaxDepth: 2,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<html-bundle@example.com>',
			emailReplyParentSource: 'bundle.eml',
			fromAddress: 'html-forwarded@example.com',
			fromDisplayName: 'HTML Forwarder',
			participantAddresses: [
				'html-forwarded@example.com',
				'ops@example.com',
				'manager@example.com',
				'reply@example.com'
			],
			replyToAddresses: ['reply@example.com'],
			threadLoadedMessageCount: 5,
			threadLoadedMessageIds: [
				'<html-bundle@example.com>',
				'<html-forwarded@example.com>',
				'<html-followup@example.com>',
				'<html-reply@example.com>',
				'<html-root@example.com>'
			]
		});
		expect(followupMessage?.metadata).toMatchObject({
			emailAttachmentRole: 'attached_message',
			emailAttachmentSource: 'bundle.eml#attachments/followup.eml',
			emailForwardedChainCount: 2,
			emailForwardedDate: 'Tue, Apr 21, 2026 at 9:45 AM',
			emailForwardedFromAddress: 'prior-followup@example.com',
			emailForwardedParticipantAddresses: [
				'prior-followup@example.com',
				'ops@example.com'
			],
			emailForwardedSubject: 'Earlier followup escalation',
			emailForwardedTimestamp: '2026-04-21T09:45:00.000Z',
			emailMessageDepth: 1,
			emailReplyParentLoaded: true,
			emailReplyParentMessageId: '<html-bundle@example.com>',
			emailReplyParentSource: 'bundle.eml',
			fromAddress: 'html-followup@example.com',
			fromDisplayName: 'HTML Followup',
			threadLoadedMessageCount: 5,
			threadLoadedMessageIds: [
				'<html-bundle@example.com>',
				'<html-forwarded@example.com>',
				'<html-followup@example.com>',
				'<html-reply@example.com>',
				'<html-root@example.com>'
			]
		});
		expect(followupMessage?.metadata?.emailForwardedChains).toEqual([
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 9:45 AM',
				forwardedFromAddress: 'prior-followup@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 9:45 AM',
					from: 'prior-followup@example.com',
					subject: 'Earlier followup escalation',
					to: 'ops@example.com'
				},
				forwardedParticipantAddresses: [
					'prior-followup@example.com',
					'ops@example.com'
				],
				forwardedSubject: 'Earlier followup escalation',
				forwardedTimestamp: '2026-04-21T09:45:00.000Z',
				forwardedToAddresses: ['ops@example.com'],
				ordinal: 1,
				text: [
					'---------- Forwarded message ----------',
					'From: prior-followup@example.com',
					'Date: Tue, Apr 21, 2026 at 9:45 AM',
					'Subject: Earlier followup escalation',
					'To: ops@example.com'
				].join('\n')
			},
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 9:30 AM',
				forwardedFromAddress: 'archive-followup@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 9:30 AM',
					from: 'archive-followup@example.com',
					subject: 'Earlier archived followup',
					to: 'ops@example.com'
				},
				forwardedParticipantAddresses: [
					'archive-followup@example.com',
					'ops@example.com'
				],
				forwardedSubject: 'Earlier archived followup',
				forwardedTimestamp: '2026-04-21T09:30:00.000Z',
				forwardedToAddresses: ['ops@example.com'],
				ordinal: 2,
				text: [
					'---------- Forwarded message ----------',
					'From: archive-followup@example.com',
					'Date: Tue, Apr 21, 2026 at 9:30 AM',
					'Subject: Earlier archived followup',
					'To: ops@example.com'
				].join('\n')
			}
		]);
		expect(followupForwardedChunks).toHaveLength(2);
		expect(followupForwardedChunks[0]?.metadata).toMatchObject({
			emailForwardedChainCount: 2,
			emailForwardedFromAddress: 'prior-followup@example.com',
			emailForwardedOrdinal: 1,
			emailForwardedSubject: 'Earlier followup escalation',
			emailSectionKind: 'forwarded_headers'
		});
		expect(followupForwardedChunks[1]?.metadata).toMatchObject({
			emailForwardedChainCount: 2,
			emailForwardedFromAddress: 'archive-followup@example.com',
			emailForwardedOrdinal: 2,
			emailForwardedSubject: 'Earlier archived followup',
			emailSectionKind: 'forwarded_headers'
		});
		expect(forwardedMessage?.metadata?.emailBodySections).toEqual([
			{
				kind: 'authored_text',
				text: 'Forwarded html authored summary.'
			},
			{
				kind: 'quoted_history',
				quotedDepth: 2,
				text: [
					'> On Tue, Apr 21, 2026 at 10:00 AM Ops Team <ops@example.com> wrote:',
					'> Prior html quoted note.',
					'>> Earlier html quoted note.'
				].join('\n')
			},
			{
				forwardedDate: 'Tue, Apr 21, 2026 at 9:15 AM',
				forwardedFromAddress: 'prior@example.com',
				forwardedHeaderFields: {
					date: 'Tue, Apr 21, 2026 at 9:15 AM',
					from: 'prior@example.com',
					subject: 'Earlier html escalation',
					to: 'ops@example.com'
				},
				forwardedParticipantAddresses: [
					'prior@example.com',
					'ops@example.com'
				],
				forwardedSubject: 'Earlier html escalation',
				forwardedTimestamp: '2026-04-21T09:15:00.000Z',
				forwardedToAddresses: ['ops@example.com'],
				kind: 'forwarded_headers',
				text: [
					'---------- Forwarded message ----------',
					'From: prior@example.com',
					'Date: Tue, Apr 21, 2026 at 9:15 AM',
					'Subject: Earlier html escalation',
					'To: ops@example.com'
				].join('\n')
			}
		]);
		expect(forwardedHeaderChunk?.metadata).toMatchObject({
			emailForwardedDate: 'Tue, Apr 21, 2026 at 9:15 AM',
			emailForwardedFromAddress: 'prior@example.com',
			emailForwardedHeaderFields: {
				date: 'Tue, Apr 21, 2026 at 9:15 AM',
				from: 'prior@example.com',
				subject: 'Earlier html escalation',
				to: 'ops@example.com'
			},
			emailForwardedParticipantAddresses: [
				'prior@example.com',
				'ops@example.com'
			],
			emailForwardedSubject: 'Earlier html escalation',
			emailForwardedTimestamp: '2026-04-21T09:15:00.000Z',
			emailSectionKind: 'forwarded_headers',
			sectionKind: 'email_block'
		});
		expect(nestedArchiveChild?.metadata).toMatchObject({
			archiveRootSource:
				'bundle.eml#attachments/forwarded.eml#attachments/bundle.zip',
			emailAncestorMessageIds: ['<html-bundle@example.com>'],
			emailAttachmentSource:
				'bundle.eml#attachments/forwarded.eml#attachments/bundle.zip',
			emailMessageDepth: 1,
			emailMessageSource: 'bundle.eml#attachments/forwarded.eml',
			threadLoadedMessageCount: 5
		});
		expect(rootDocument?.metadata).toMatchObject({
			threadLoadedMessageCount: 5,
			threadLoadedMessageIds: [
				'<html-bundle@example.com>',
				'<html-forwarded@example.com>',
				'<html-followup@example.com>',
				'<html-reply@example.com>',
				'<html-root@example.com>'
			]
		});
		expect(nestedArchiveChild?.text).toContain(
			'HTML mailbox nested archive text'
		);
	});

	it('reconstructs sibling attached-email chains independently in mailbox directory ingest', async () => {
		const buildBranchEmail = (
			branchKey: string,
			level: number,
			maxDepth: number,
			parentMessageId: string
		): string => {
			const boundary = `${branchKey}-nested-${level}`;
			const messageId = `<${branchKey}-level-${level}@example.com>`;
			const childName = `${branchKey}-level-${level + 1}.eml`;
			const headers = [
				`Subject: ${branchKey} mailbox branch`,
				`From: ${branchKey}-level-${level}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${messageId}`,
				`In-Reply-To: ${parentMessageId}`,
				`References: ${parentMessageId} ${messageId}`
			];

			if (level >= maxDepth) {
				return [
					...headers,
					'',
					`${branchKey} authored body level ${level}.`
				].join('\n');
			}

			const childEmail = buildBranchEmail(
				branchKey,
				level + 1,
				maxDepth,
				messageId
			);
			return [
				...headers,
				`Content-Type: multipart/mixed; boundary="${boundary}"`,
				'',
				`--${boundary}`,
				'Content-Type: text/plain; charset=utf-8',
				'',
				`${branchKey} authored body level ${level}.`,
				`--${boundary}`,
				`Content-Type: message/rfc822; name="${childName}"`,
				`Content-Disposition: attachment; filename="${childName}"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(childEmail, 'utf8').toString('base64'),
				`--${boundary}--`
			].join('\n');
		};

		const rootMessageId = '<sibling-root@example.com>';
		const branchAEmail = buildBranchEmail('branch-a', 1, 2, rootMessageId);
		const branchBEmail = buildBranchEmail('branch-b', 1, 2, rootMessageId);
		const bundleEmail = [
			'Subject: Sibling mailbox bundle',
			'From: bundle@example.com',
			'To: ops@example.com',
			'Message-ID: <sibling-bundle@example.com>',
			'Content-Type: multipart/mixed; boundary="sibling-bundle"',
			'',
			'--sibling-bundle',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Sibling mailbox bundle body.',
			'--sibling-bundle',
			'Content-Type: message/rfc822; name="branch-a.eml"',
			'Content-Disposition: attachment; filename="branch-a.eml"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(branchAEmail, 'utf8').toString('base64'),
			'--sibling-bundle',
			'Content-Type: message/rfc822; name="branch-b.eml"',
			'Content-Disposition: attachment; filename="branch-b.eml"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(branchBEmail, 'utf8').toString('base64'),
			'--sibling-bundle--'
		].join('\n');
		const rootEmail = [
			'Subject: Sibling mailbox root',
			'From: root@example.com',
			'To: ops@example.com',
			`Message-ID: ${rootMessageId}`,
			'',
			'Root mailbox body.'
		].join('\n');

		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-sibling-')
		);
		try {
			writeFileSync(join(tempDir, 'root.eml'), rootEmail, 'utf8');
			writeFileSync(join(tempDir, 'bundle.eml'), bundleEmail, 'utf8');

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-sibling-chains-temp' },
				directory: tempDir,
				includeExtensions: ['.eml']
			});

			const branchALevelOne = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<branch-a-level-1@example.com>'
			);
			const branchALevelTwo = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<branch-a-level-2@example.com>'
			);
			const branchBLevelOne = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<branch-b-level-1@example.com>'
			);
			const branchBLevelTwo = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<branch-b-level-2@example.com>'
			);

			expect(loaded.documents).toHaveLength(6);
			expect(branchALevelOne?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-a.eml'
				],
				emailMessageLineageCount: 1,
				emailMessageLineageMessageIds: ['<sibling-bundle@example.com>'],
				emailMessageLineageSources: ['bundle.eml'],
				emailMessageDepth: 1
			});
			expect(branchALevelTwo?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-a.eml',
					'bundle.eml#attachments/branch-a.eml#attachments/branch-a-level-2.eml'
				],
				emailMessageLineageCount: 2,
				emailMessageLineageMessageIds: [
					'<sibling-bundle@example.com>',
					'<branch-a-level-1@example.com>'
				],
				emailMessageLineageSources: [
					'bundle.eml',
					'bundle.eml#attachments/branch-a.eml'
				],
				emailMessageDepth: 2
			});
			expect(branchBLevelOne?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-b.eml'
				],
				emailMessageLineageCount: 1,
				emailMessageLineageMessageIds: ['<sibling-bundle@example.com>'],
				emailMessageLineageSources: ['bundle.eml'],
				emailMessageDepth: 1
			});
			expect(branchBLevelTwo?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-b.eml',
					'bundle.eml#attachments/branch-b.eml#attachments/branch-b-level-2.eml'
				],
				emailMessageLineageCount: 2,
				emailMessageLineageMessageIds: [
					'<sibling-bundle@example.com>',
					'<branch-b-level-1@example.com>'
				],
				emailMessageLineageSources: [
					'bundle.eml',
					'bundle.eml#attachments/branch-b.eml'
				],
				emailMessageDepth: 2
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('loads mbox files from directory ingest and preserves mailbox thread metadata', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-email-mbox-'));
		const mboxContent = [
			'From root@example.com Tue Apr 21 09:00:00 2026',
			'Subject: Directory mailbox',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <directory-mbox-root@example.com>',
			'',
			'Directory root mailbox body.',
			'',
			'From reply@example.com Tue Apr 21 10:00:00 2026',
			'Subject: Directory mailbox',
			'From: reply@example.com',
			'To: ops@example.com',
			'Message-ID: <directory-mbox-reply@example.com>',
			'In-Reply-To: <directory-mbox-root@example.com>',
			'References: <directory-mbox-root@example.com> <directory-mbox-reply@example.com>',
			'',
			'Directory reply mailbox body.'
		].join('\n');

		try {
			writeFileSync(join(tempDir, 'thread.mbox'), mboxContent, 'utf8');

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-mbox-directory-temp' },
				directory: tempDir,
				includeExtensions: ['.mbox']
			});

			const rootDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<directory-mbox-root@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const replyDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<directory-mbox-reply@example.com>' &&
					document.metadata?.emailKind === 'message'
			);

			expect(loaded.documents).toHaveLength(2);
			expect(rootDocument?.metadata).toMatchObject({
				emailMailboxContainerSource: 'thread.mbox',
				emailMailboxFormat: 'mbox',
				emailMailboxMessageCount: 2,
				emailMailboxMessageIndex: 0,
				emailMailboxMessageOrdinal: 1,
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2
			});
			expect(replyDocument?.metadata).toMatchObject({
				emailMailboxContainerSource: 'thread.mbox',
				emailMailboxFormat: 'mbox',
				emailMailboxMessageCount: 2,
				emailMailboxMessageIndex: 1,
				emailMailboxMessageOrdinal: 2,
				emailReplyParentLoaded: true,
				emailReplyParentMessageId: '<directory-mbox-root@example.com>',
				emailReplyParentSource: 'thread.mbox#messages/1',
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('loads ost files from directory ingest and preserves mailbox thread metadata', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-email-ost-'));
		const ostContent = [
			'Subject: Directory ost mailbox',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <directory-ost-root@example.com>',
			'',
			'Directory OST root mailbox body.',
			'',
			'Subject: Directory ost mailbox',
			'From: reply@example.com',
			'To: ops@example.com',
			'Message-ID: <directory-ost-reply@example.com>',
			'In-Reply-To: <directory-ost-root@example.com>',
			'References: <directory-ost-root@example.com> <directory-ost-reply@example.com>',
			'',
			'Directory OST reply mailbox body.'
		].join('\n');

		try {
			writeFileSync(join(tempDir, 'thread.ost'), ostContent, 'utf8');

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: { fixturePack: 'email-ost-directory-temp' },
				directory: tempDir,
				includeExtensions: ['.ost']
			});

			const rootDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<directory-ost-root@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const replyDocument = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<directory-ost-reply@example.com>' &&
					document.metadata?.emailKind === 'message'
			);

			expect(loaded.documents).toHaveLength(2);
			expect(rootDocument?.metadata).toMatchObject({
				emailMailboxContainerSource: 'thread.ost',
				emailMailboxFormat: 'ost',
				emailMailboxMessageCount: 2,
				emailMailboxMessageIndex: 0,
				emailMailboxMessageOrdinal: 1,
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2
			});
			expect(replyDocument?.metadata).toMatchObject({
				emailMailboxContainerSource: 'thread.ost',
				emailMailboxFormat: 'ost',
				emailMailboxMessageCount: 2,
				emailMailboxMessageIndex: 1,
				emailMailboxMessageOrdinal: 2,
				emailReplyParentLoaded: true,
				emailReplyParentMessageId: '<directory-ost-root@example.com>',
				emailReplyParentSource: 'thread.ost#messages/1',
				threadKnownMessageCount: 2,
				threadLoadedMessageCount: 2
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves sibling reply ordering across ost mailbox container replies', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-ost-siblings-')
		);
		const rootMessageId = '<directory-ost-sibling-root@example.com>';
		const replyMessages = [
			{
				fileOrdinal: 2,
				messageId: '<directory-ost-sibling-first@example.com>',
				text: 'First OST sibling reply.'
			},
			{
				fileOrdinal: 3,
				messageId: '<directory-ost-sibling-second@example.com>',
				text: 'Second OST sibling reply.'
			},
			{
				fileOrdinal: 4,
				messageId: '<directory-ost-sibling-third@example.com>',
				text: 'Third OST sibling reply.'
			}
		];
		const ostContent = [
			'Subject: Directory ost sibling mailbox',
			'From: root@example.com',
			'To: ops@example.com',
			`Message-ID: ${rootMessageId}`,
			'',
			'Directory OST sibling root mailbox body.',
			'',
			...replyMessages.flatMap((reply) => [
				'Subject: Directory ost sibling mailbox',
				`From: reply-${reply.fileOrdinal}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${reply.messageId}`,
				`In-Reply-To: ${rootMessageId}`,
				`References: ${rootMessageId} ${reply.messageId}`,
				'',
				reply.text,
				''
			])
		].join('\n');

		try {
			writeFileSync(join(tempDir, 'siblings.ost'), ostContent, 'utf8');

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-ost-siblings-directory-temp'
				},
				directory: tempDir,
				includeExtensions: ['.ost']
			});

			expect(loaded.documents).toHaveLength(4);
			for (const [index, reply] of replyMessages.entries()) {
				const document = loaded.documents.find(
					(entry) =>
						entry.metadata?.messageId === reply.messageId &&
						entry.metadata?.emailKind === 'message'
				);

				expect(document?.metadata).toMatchObject({
					emailMailboxContainerSource: 'siblings.ost',
					emailMailboxFormat: 'ost',
					emailMailboxMessageCount: 4,
					emailMailboxMessageIndex: index + 1,
					emailMailboxMessageOrdinal: index + 2,
					emailReplyParentLoaded: true,
					emailReplyParentMessageId: rootMessageId,
					emailReplySiblingCount: 3,
					emailReplySiblingIndex: index,
					emailReplySiblingOrdinal: index + 1,
					emailReplySiblingParentMessageId: rootMessageId,
					emailReplySiblingMessageIds: replyMessages.map(
						(candidate) => candidate.messageId
					)
				});
			}
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves ost mailbox folder lineage and state semantics on emitted messages', async () => {
		const tempDir = mkdtempSync(
			join(tmpdir(), 'absolute-rag-email-ost-folders-')
		);
		const ostContent = [
			'Mailbox: Inbox/Regional/West',
			'Flags: read flagged',
			'Categories: Inbox; Priority-West',
			'Importance: high',
			'Subject: Directory ost folder mailbox',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <directory-ost-folder-root@example.com>',
			'',
			'Directory OST folder root mailbox body.',
			'',
			'Mailbox: Archive/Regional/West',
			'Passed: true',
			'Attachments: archive.zip',
			'Sensitivity: private',
			'Subject: Directory ost folder mailbox',
			'From: archive@example.com',
			'To: ops@example.com',
			'Message-ID: <directory-ost-folder-archive@example.com>',
			'In-Reply-To: <directory-ost-folder-root@example.com>',
			'References: <directory-ost-folder-root@example.com> <directory-ost-folder-archive@example.com>',
			'',
			'Directory OST archive mailbox body.'
		].join('\n');

		try {
			writeFileSync(join(tempDir, 'folders.ost'), ostContent, 'utf8');

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-ost-folders-directory-temp'
				},
				directory: tempDir,
				includeExtensions: ['.ost']
			});

			const inboxMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<directory-ost-folder-root@example.com>' &&
					document.metadata?.emailKind === 'message'
			);
			const archiveMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
						'<directory-ost-folder-archive@example.com>' &&
					document.metadata?.emailKind === 'message'
			);

			expect(inboxMessage?.metadata).toMatchObject({
				emailCategories: ['Inbox', 'Priority-West'],
				emailMailboxFamilyKey: 'inbox/regional/west',
				emailMailboxFolder: 'West',
				emailMailboxLeaf: 'West',
				emailImportance: 'high',
				emailMailboxPathDepth: 3,
				emailMailboxPathSegments: ['Inbox', 'Regional', 'West'],
				emailMailboxStateFlags: ['read', 'flagged'],
				emailMailboxIsFlagged: true,
				emailMailboxIsRead: true,
				emailMailboxIsUnread: false
			});
			expect(archiveMessage?.metadata).toMatchObject({
				attachmentCount: 1,
				attachmentNames: ['archive.zip'],
				emailMailboxFamilyKey: 'archive/regional/west',
				emailMailboxFolder: 'West',
				emailMailboxLeaf: 'West',
				emailSensitivity: 'private',
				emailMailboxPathDepth: 3,
				emailMailboxPathSegments: ['Archive', 'Regional', 'West'],
				emailMailboxStateFlags: ['passed', 'unread'],
				emailMailboxIsPassed: true,
				emailMailboxIsUnread: true,
				emailReplyParentLoaded: true
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves forwarded chains, inline resources, nested archives, and nested attached messages across sibling email branches', async () => {
		const buildRichBranchEmail = (input: {
			branchKey: string;
			forwardedFrom: string;
			forwardedSubject: string;
			nestedChildMessageId: string;
			parentMessageId: string;
		}) => {
			const inlineContentId = `<${input.branchKey}-inline@example.com>`;
			const nestedArchive = createStoredZip({
				'docs/guide.md': `${input.branchKey} nested archive text`
			});
			const nestedChildEmail = [
				`Subject: ${input.branchKey} nested child`,
				`From: ${input.branchKey}-child@example.com`,
				'To: ops@example.com',
				`Message-ID: ${input.nestedChildMessageId}`,
				`In-Reply-To: ${input.parentMessageId}`,
				`References: ${input.parentMessageId} ${input.nestedChildMessageId}`,
				'',
				`${input.branchKey} nested child authored body.`
			].join('\n');

			return [
				`Subject: ${input.branchKey} branch review`,
				`From: ${input.branchKey}@example.com`,
				'To: ops@example.com',
				`Message-ID: ${input.parentMessageId}`,
				'Content-Type: multipart/mixed; boundary="mixed"',
				'',
				'--mixed',
				'Content-Type: multipart/related; boundary="related"',
				'',
				'--related',
				'Content-Type: text/html; charset=utf-8',
				'',
				[
					`<p>${input.branchKey} authored summary.</p>`,
					`<p><img src="cid:${inlineContentId.replace(/^<|>$/g, '')}" /></p>`,
					'<blockquote>',
					'<p>Prior quoted branch note.</p>',
					'</blockquote>',
					'<p>---------- Forwarded message ----------<br/>',
					`From: ${input.forwardedFrom}<br/>`,
					'Date: Tue, Apr 21, 2026 at 9:15 AM<br/>',
					`Subject: ${input.forwardedSubject}<br/>`,
					'To: ops@example.com</p>'
				].join(''),
				'--related',
				`Content-Type: text/plain; name="${input.branchKey}-inline-note.txt"`,
				`Content-ID: ${inlineContentId}`,
				`Content-Disposition: inline; filename="${input.branchKey}-inline-note.txt"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(
					`${input.branchKey} inline resource text`,
					'utf8'
				).toString('base64'),
				'--related--',
				'--mixed',
				`Content-Type: application/zip; name="${input.branchKey}.zip"`,
				`Content-Disposition: attachment; filename="${input.branchKey}.zip"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(nestedArchive).toString('base64'),
				'--mixed',
				`Content-Type: message/rfc822; name="${input.branchKey}-child.eml"`,
				`Content-Disposition: attachment; filename="${input.branchKey}-child.eml"`,
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(nestedChildEmail, 'utf8').toString('base64'),
				'--mixed--'
			].join('\n');
		};

		const rootEmail = [
			'Subject: Branch root',
			'From: root@example.com',
			'To: ops@example.com',
			'Message-ID: <rich-root@example.com>',
			'',
			'Root body.'
		].join('\n');
		const branchAParentMessageId = '<rich-branch-a@example.com>';
		const branchBParentMessageId = '<rich-branch-b@example.com>';
		const bundleEmail = [
			'Subject: Rich sibling bundle',
			'From: bundle@example.com',
			'To: ops@example.com',
			'Message-ID: <rich-bundle@example.com>',
			'Content-Type: multipart/mixed; boundary="bundle-rich"',
			'',
			'--bundle-rich',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Rich sibling mailbox bundle body.',
			'--bundle-rich',
			'Content-Type: message/rfc822; name="branch-a.eml"',
			'Content-Disposition: attachment; filename="branch-a.eml"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(
				buildRichBranchEmail({
					branchKey: 'branch-a',
					forwardedFrom: 'branch-a-prior@example.com',
					forwardedSubject: 'Branch A forwarded review',
					nestedChildMessageId: '<rich-branch-a-child@example.com>',
					parentMessageId: branchAParentMessageId
				}),
				'utf8'
			).toString('base64'),
			'--bundle-rich',
			'Content-Type: message/rfc822; name="branch-b.eml"',
			'Content-Disposition: attachment; filename="branch-b.eml"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(
				buildRichBranchEmail({
					branchKey: 'branch-b',
					forwardedFrom: 'branch-b-prior@example.com',
					forwardedSubject: 'Branch B forwarded review',
					nestedChildMessageId: '<rich-branch-b-child@example.com>',
					parentMessageId: branchBParentMessageId
				}),
				'utf8'
			).toString('base64'),
			'--bundle-rich--'
		].join('\n');

		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-rag-email-rich-'));
		try {
			writeFileSync(join(tempDir, 'root.eml'), rootEmail, 'utf8');
			writeFileSync(join(tempDir, 'bundle.eml'), bundleEmail, 'utf8');

			const loaded = await loadRAGDocumentsFromDirectory({
				baseMetadata: {
					fixturePack: 'email-rich-sibling-branches-temp'
				},
				directory: tempDir,
				includeExtensions: ['.eml']
			});

			const branchAMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId === branchAParentMessageId
			);
			const branchBMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId === branchBParentMessageId
			);
			const branchAInline = loaded.documents.find(
				(document) =>
					document.metadata?.attachmentName ===
					'branch-a-inline-note.txt'
			);
			const branchBInline = loaded.documents.find(
				(document) =>
					document.metadata?.attachmentName ===
					'branch-b-inline-note.txt'
			);
			const branchAArchiveChild = loaded.documents.find(
				(document) =>
					document.source ===
					'bundle.eml#attachments/branch-a.eml#attachments/branch-a.zip#docs/guide.md'
			);
			const branchBArchiveChild = loaded.documents.find(
				(document) =>
					document.source ===
					'bundle.eml#attachments/branch-b.eml#attachments/branch-b.zip#docs/guide.md'
			);
			const branchAChildMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<rich-branch-a-child@example.com>'
			);
			const branchBChildMessage = loaded.documents.find(
				(document) =>
					document.metadata?.messageId ===
					'<rich-branch-b-child@example.com>'
			);
			const preparedBranchA = branchAMessage
				? prepareRAGDocument(branchAMessage, {
						maxChunkLength: 220,
						minChunkLength: 1,
						strategy: 'source_aware'
					})
				: undefined;
			const preparedBranchB = branchBMessage
				? prepareRAGDocument(branchBMessage, {
						maxChunkLength: 220,
						minChunkLength: 1,
						strategy: 'source_aware'
					})
				: undefined;

			expect(loaded.documents).toHaveLength(10);
			expect(branchAMessage?.metadata).toMatchObject({
				attachmentCount: 3,
				attachmentNames: [
					'branch-a-inline-note.txt',
					'branch-a.zip',
					'branch-a-child.eml'
				],
				emailForwardedChainCount: 1,
				emailForwardedFromAddress: 'branch-a-prior@example.com',
				emailForwardedSubject: 'Branch A forwarded review',
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-a.eml'
				],
				embeddedResourceCount: 1,
				hasInlineResources: true
			});
			expect(branchBMessage?.metadata).toMatchObject({
				attachmentCount: 3,
				attachmentNames: [
					'branch-b-inline-note.txt',
					'branch-b.zip',
					'branch-b-child.eml'
				],
				emailForwardedChainCount: 1,
				emailForwardedFromAddress: 'branch-b-prior@example.com',
				emailForwardedSubject: 'Branch B forwarded review',
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-b.eml'
				],
				embeddedResourceCount: 1,
				hasInlineResources: true
			});
			expect(branchAInline?.metadata).toMatchObject({
				attachmentDisposition: 'inline',
				attachmentEmbeddedReferenceMatched: true,
				emailAttachmentRole: 'inline_resource',
				emailAttachmentSource:
					'bundle.eml#attachments/branch-a.eml#attachments/branch-a-inline-note.txt',
				emailMessageSource: 'bundle.eml#attachments/branch-a.eml'
			});
			expect(branchBInline?.metadata).toMatchObject({
				attachmentDisposition: 'inline',
				attachmentEmbeddedReferenceMatched: true,
				emailAttachmentRole: 'inline_resource',
				emailAttachmentSource:
					'bundle.eml#attachments/branch-b.eml#attachments/branch-b-inline-note.txt',
				emailMessageSource: 'bundle.eml#attachments/branch-b.eml'
			});
			expect(branchAArchiveChild?.metadata).toMatchObject({
				emailAttachmentSource:
					'bundle.eml#attachments/branch-a.eml#attachments/branch-a.zip',
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-a.eml'
				],
				emailMessageSource: 'bundle.eml#attachments/branch-a.eml'
			});
			expect(branchBArchiveChild?.metadata).toMatchObject({
				emailAttachmentSource:
					'bundle.eml#attachments/branch-b.eml#attachments/branch-b.zip',
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-b.eml'
				],
				emailMessageSource: 'bundle.eml#attachments/branch-b.eml'
			});
			expect(branchAChildMessage?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-a.eml',
					'bundle.eml#attachments/branch-a.eml#attachments/branch-a-child.eml'
				],
				emailMessageLineageCount: 2
			});
			expect(branchBChildMessage?.metadata).toMatchObject({
				emailMessageLineageAttachmentSources: [
					'bundle.eml#attachments/branch-b.eml',
					'bundle.eml#attachments/branch-b.eml#attachments/branch-b-child.eml'
				],
				emailMessageLineageCount: 2
			});
			expect(
				preparedBranchA?.chunks.find(
					(chunk) =>
						chunk.metadata?.emailSectionKind === 'forwarded_headers'
				)?.metadata
			).toMatchObject({
				emailForwardedFromAddress: 'branch-a-prior@example.com',
				emailForwardedSubject: 'Branch A forwarded review'
			});
			expect(
				preparedBranchB?.chunks.find(
					(chunk) =>
						chunk.metadata?.emailSectionKind === 'forwarded_headers'
				)?.metadata
			).toMatchObject({
				emailForwardedFromAddress: 'branch-b-prior@example.com',
				emailForwardedSubject: 'Branch B forwarded review'
			});
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it('preserves archive parent-child linkage on expanded child documents', async () => {
		const zip = createStoredZip({
			'docs/guide.md': '# Guide\n\nArchive text'
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

		const childDocument = loaded.documents.find((document) =>
			document.source?.includes('#docs/guide.md')
		);

		expect(childDocument?.metadata).toMatchObject({
			archiveContainerPath: undefined,
			archiveDepth: 2,
			archiveEntryName: 'guide.md',
			archiveFullPath: 'docs/guide.md',
			archiveLineage: ['docs', 'guide.md'],
			archiveNestedDepth: 1,
			archiveParentName: 'bundle.zip',
			archiveParentSource: 'bundle.zip',
			archivePath: 'docs/guide.md',
			archiveRootName: 'bundle.zip',
			archiveRootSource: 'bundle.zip'
		});
	});

	it('preserves nested archive lineage across recursive archive expansion', async () => {
		const innerZip = createStoredZip({
			'docs/guide.md': '# Guide\n\nNested archive text'
		});
		const outerZip = createStoredZip({
			'nested/inner.zip': innerZip
		});

		const loaded = await loadRAGDocumentsFromUploads({
			uploads: [
				{
					content: outerZip.toString('base64'),
					encoding: 'base64',
					name: 'bundle.zip'
				}
			]
		});

		const nestedChildDocument = loaded.documents.find((document) =>
			document.source?.includes('#docs/guide.md')
		);

		expect(nestedChildDocument?.metadata).toMatchObject({
			archiveContainerPath: 'nested/inner.zip',
			archiveDepth: 4,
			archiveEntryName: 'guide.md',
			archiveFullPath: 'nested/inner.zip!docs/guide.md',
			archiveLineage: ['nested', 'inner.zip', 'docs', 'guide.md'],
			archiveNestedDepth: 3,
			archivePath: 'docs/guide.md',
			archiveRootName: 'bundle.zip',
			archiveRootSource: 'bundle.zip'
		});
	});
});
