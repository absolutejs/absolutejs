import { Elysia } from 'elysia';
import {
	HTTP_STATUS_BAD_REQUEST,
	HTTP_STATUS_NOT_FOUND,
	HTTP_STATUS_OK
} from '../../constants';
import type {
	AIAttachment,
	AIChatPluginConfig,
	AIConversation,
	AIConversationStore,
	AIMessage,
	AIUsage,
	RAGEvaluationInput,
	RAGEvaluationResponse,
	RAGAdminActionRecord,
	RAGAdminJobRecord,
	RAGBackendsResponse,
	RAGDocumentChunk,
	RAGDocumentChunksResponse,
	RAGDocumentIngestInput,
	RAGDocumentsResponse,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGIndexedDocument,
	RAGChatPluginConfig,
	RAGCorpusHealth,
	RAGIngestJobRecord,
	RAGMutationResponse,
	RAGOperationsResponse,
	RAGSyncResponse,
	RAGSource
} from '../../../types/ai';
import { createMemoryStore } from '../memoryStore';
import { generateId, parseAIMessage } from '../protocol';
import { streamAI } from '../streamAI';
import { streamAIToSSE } from '../streamAIToSSE';
import { resolveRenderers } from '../htmxRenderers';
import { createRAGCollection } from './collection';
import { resolveRAGWorkflowRenderers } from './htmxWorkflowRenderers';
import { evaluateRAGCollection } from './quality';
import {
	buildRAGUpsertInputFromDocuments,
	buildRAGUpsertInputFromUploads,
	buildRAGUpsertInputFromURLs
} from './ingestion';
import { buildRAGContext } from './types';

const DEFAULT_PATH = '/rag';
const DEFAULT_TOP_K = 6;
const DEFAULT_PREFIX_LEN = 12;
const DEFAULT_PROVIDER = 'anthropic';
const TITLE_MAX_LENGTH = 80;
const MAX_INGEST_JOBS = 20;
const MAX_ADMIN_ACTIONS = 20;
const MAX_ADMIN_JOBS = 20;
const DEFAULT_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7;

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' } as const;

const defaultParseProvider = (content: string) => {
	const colonIdx = content.indexOf(':');
	const hasPrefix = colonIdx > 0 && colonIdx < DEFAULT_PREFIX_LEN;

	return {
		content: hasPrefix ? content.slice(colonIdx + 1) : content,
		model: undefined,
		providerName: hasPrefix ? content.slice(0, colonIdx) : DEFAULT_PROVIDER
	};
};

const normalizeScore = (value: number) => (Number.isFinite(value) ? value : 0);

const isHTMXRequest = (request: Request) =>
	request.headers.get('HX-Request') === 'true';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const getStringProperty = (value: unknown, key: string) => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	return typeof value[key] === 'string' ? value[key] : undefined;
};

const getObjectProperty = (value: unknown, key: string) => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	return isObjectRecord(value[key]) ? value[key] : undefined;
};

const getNumberProperty = (value: unknown, key: string) => {
	const candidate = isObjectRecord(value) ? value[key] : undefined;

	return typeof candidate === 'number' ? candidate : undefined;
};

const isMetadataMap = (value: unknown): value is Record<string, unknown> =>
	isObjectRecord(value);

const normalizeStringArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((candidate) => typeof candidate === 'string')
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0);
};

const normalizeChunkingOptions = (value: unknown) =>
	isMetadataMap(value) ? value : undefined;

const getNumericStatus = (status: unknown) =>
	typeof status === 'number' ? status : HTTP_STATUS_OK;

const getBooleanProperty = (value: unknown, key: string) => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	return typeof value[key] === 'boolean' ? value[key] : undefined;
};

const isRAGDocumentChunk = (value: unknown): value is RAGDocumentChunk =>
	isObjectRecord(value) &&
	typeof value.chunkId === 'string' &&
	typeof value.text === 'string';

const isRAGDocument = (
	value: unknown
): value is RAGDocumentIngestInput['documents'][number] =>
	isObjectRecord(value) && typeof value.text === 'string';

const isRAGDocumentUrl = (
	value: unknown
): value is RAGDocumentUrlIngestInput['urls'][number] =>
	isObjectRecord(value) &&
	typeof value.url === 'string' &&
	value.url.trim().length > 0;

const isRAGDocumentArray = (
	value: unknown
): value is RAGDocumentIngestInput['documents'] =>
	Array.isArray(value) && value.every((entry) => isRAGDocument(entry));

const isRAGDocumentUpload = (
	value: unknown
): value is RAGDocumentUploadIngestInput['uploads'][number] =>
	isObjectRecord(value) &&
	typeof value.name === 'string' &&
	typeof value.content === 'string';

const isRAGDocumentUploadArray = (
	value: unknown
): value is RAGDocumentUploadIngestInput['uploads'] =>
	Array.isArray(value) && value.every((entry) => isRAGDocumentUpload(entry));

const isRAGDocumentUrlArray = (
	value: unknown
): value is RAGDocumentUrlIngestInput['urls'] =>
	Array.isArray(value) && value.every((entry) => isRAGDocumentUrl(entry));

const isRAGDocumentChunkArray = (value: unknown): value is RAGDocumentChunk[] =>
	Array.isArray(value) && value.every((entry) => isRAGDocumentChunk(entry));

const buildSources = (
	results: Array<{
		chunkId: string;
		chunkText: string;
		score: number;
		title?: string;
		source?: string;
		metadata?: Record<string, unknown>;
	}>
) =>
	results.map((result) => ({
		chunkId: result.chunkId,
		metadata: result.metadata,
		score: normalizeScore(result.score),
		source: result.source,
		text: result.chunkText,
		title: result.title
	}));

const toAssistantTextBlock = (content: string) => [
	{ content, type: 'text' as const }
];

const resolveTools = (
	config: AIChatPluginConfig,
	providerName: string,
	model: string
) =>
	typeof config.tools === 'function'
		? config.tools(providerName, model)
		: config.tools;

const resolveThinking = (
	config: AIChatPluginConfig,
	providerName: string,
	model: string
) =>
	typeof config.thinking === 'function'
		? config.thinking(providerName, model)
		: config.thinking;

const resolveModel = (
	config: AIChatPluginConfig,
	parsed: { model?: string; providerName: string }
) => {
	if (parsed.model) {
		return parsed.model;
	}

	if (typeof config.model === 'string') {
		return config.model;
	}

	if (typeof config.model === 'function') {
		return config.model(parsed.providerName);
	}

	return parsed.providerName;
};

const buildHistory = (conversation: AIConversation) =>
	conversation.messages.map((msg) => ({
		content: msg.content,
		role: msg.role
	}));

const buildUserMessage = (
	content: string,
	attachments?: AIAttachment[],
	extraContext?: string
) => {
	if (attachments && attachments.length > 0) {
		const contextContent = extraContext
			? `${content}\n\n${extraContext}`
			: content;
		const attachmentsBlocks = attachments.map((att) => {
			if (att.media_type === 'application/pdf') {
				return {
					name: att.name,
					source: {
						data: att.data,
						media_type: att.media_type,
						type: 'base64' as const
					},
					type: 'document' as const
				};
			}

			return {
				source: {
					data: att.data,
					media_type: att.media_type,
					type: 'base64' as const
				},
				type: 'image' as const
			};
		});

		return {
			content: [
				...attachmentsBlocks,
				...toAssistantTextBlock(contextContent)
			],
			role: 'user' as const
		};
	}

	return {
		content: extraContext ? `${content}\n\n${extraContext}` : content,
		role: 'user' as const
	};
};

const branchConversation = (source: AIConversation, fromMessageId: string) => {
	const cutoffIndex = source.messages.findIndex(
		(msg) => msg.id === fromMessageId
	);
	if (cutoffIndex < 0) {
		return null;
	}

	const newId = generateId();
	const branchedMessages = source.messages
		.slice(0, cutoffIndex + 1)
		.map((msg) => ({ ...msg, conversationId: newId }));

	const branchedConversation: AIConversation = {
		createdAt: Date.now(),
		id: newId,
		messages: branchedMessages
	};

	return branchedConversation;
};

type RAGQueryContext = {
	ragContext: string;
	sources: RAGSource[];
};

const buildRAGContextFromQuery = async (
	config: Pick<
		RAGChatPluginConfig,
		'collection' | 'ragStore' | 'embedding' | 'embeddingModel' | 'rerank'
	>,
	topK: number,
	scoreThreshold: number | undefined,
	queryText: string,
	ragModel: string,
	embedding: RAGChatPluginConfig['embedding'] | undefined,
	embeddingModel: string | undefined
): Promise<RAGQueryContext> => {
	const collection =
		config.collection ??
		(config.ragStore
			? createRAGCollection({
					defaultModel: embeddingModel ?? ragModel,
					defaultTopK: topK,
					embedding,
					rerank: config.rerank,
					store: config.ragStore
				})
			: null);

	if (!collection) {
		return {
			ragContext: '',
			sources: []
		};
	}

	const queried = await collection.search({
		model: embeddingModel ?? ragModel,
		query: queryText,
		scoreThreshold,
		topK
	});
	const sources = buildSources(queried);

	return {
		ragContext: buildRAGContext(queried),
		sources
	};
};

export const ragChat = (config: RAGChatPluginConfig) => {
	const path = config.path ?? DEFAULT_PATH;
	const topK = config.topK ?? DEFAULT_TOP_K;
	const { scoreThreshold } = config;
	const { extractors } = config;
	const ragStore = config.ragStore ?? config.collection?.store;
	const parseProvider = config.parseProvider ?? defaultParseProvider;
	const store: AIConversationStore = config.store ?? createMemoryStore();
	const abortControllers = new Map<string, AbortController>();
	const includeCompleteSources = config.ragCompleteSources === true;
	const staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
	const { indexManager } = config;
	const ingestJobs: RAGIngestJobRecord[] = [];
	const adminActions: RAGAdminActionRecord[] = [];
	const adminJobs: RAGAdminJobRecord[] = [];
	const syncJobs: RAGAdminJobRecord[] = [];
	const workflowRenderConfig =
		typeof config.htmx === 'object'
			? (config.htmx.workflowRender ?? config.htmx.workflow?.render)
			: undefined;
	const workflowRenderers = resolveRAGWorkflowRenderers(workflowRenderConfig);

	const createIngestJob = (
		inputKind: RAGIngestJobRecord['inputKind'],
		requestedCount: number
	) => {
		const job: RAGIngestJobRecord = {
			id: generateId(),
			inputKind,
			requestedCount,
			startedAt: Date.now(),
			status: 'running'
		};
		ingestJobs.unshift(job);
		if (ingestJobs.length > MAX_INGEST_JOBS) {
			ingestJobs.length = MAX_INGEST_JOBS;
		}

		return job;
	};

	const completeIngestJob = (
		job: RAGIngestJobRecord,
		input: {
			chunkCount?: number;
			documentCount?: number;
			extractorNames?: string[];
		}
	) => {
		const finishedAt = Date.now();
		job.status = 'completed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		job.chunkCount = input.chunkCount;
		job.documentCount = input.documentCount;
		job.extractorNames = input.extractorNames;
	};

	const failIngestJob = (
		job: RAGIngestJobRecord,
		error: string,
		extractorNames?: string[]
	) => {
		const finishedAt = Date.now();
		job.status = 'failed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		job.error = error;
		job.extractorNames = extractorNames;
	};

	const createAdminAction = (
		action: RAGAdminActionRecord['action'],
		documentId?: string,
		target?: string
	) => {
		const record: RAGAdminActionRecord = {
			action,
			documentId,
			id: generateId(),
			startedAt: Date.now(),
			status: 'completed',
			target
		};
		adminActions.unshift(record);
		if (adminActions.length > MAX_ADMIN_ACTIONS) {
			adminActions.length = MAX_ADMIN_ACTIONS;
		}

		return record;
	};

	const createAdminJob = (
		action: RAGAdminJobRecord['action'],
		target?: string,
		bucket: RAGAdminJobRecord[] = adminJobs
	) => {
		const job: RAGAdminJobRecord = {
			action,
			id: generateId(),
			startedAt: Date.now(),
			status: 'running',
			target
		};
		bucket.unshift(job);
		if (bucket.length > MAX_ADMIN_JOBS) {
			bucket.length = MAX_ADMIN_JOBS;
		}

		return job;
	};

	const completeAdminAction = (record: RAGAdminActionRecord) => {
		const finishedAt = Date.now();
		record.status = 'completed';
		record.finishedAt = finishedAt;
		record.elapsedMs = finishedAt - record.startedAt;
	};

	const failAdminAction = (record: RAGAdminActionRecord, error: string) => {
		const finishedAt = Date.now();
		record.status = 'failed';
		record.finishedAt = finishedAt;
		record.elapsedMs = finishedAt - record.startedAt;
		record.error = error;
	};

	const completeAdminJob = (job: RAGAdminJobRecord) => {
		const finishedAt = Date.now();
		job.status = 'completed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
	};

	const failAdminJob = (job: RAGAdminJobRecord, error: string) => {
		const finishedAt = Date.now();
		job.status = 'failed';
		job.finishedAt = finishedAt;
		job.elapsedMs = finishedAt - job.startedAt;
		job.error = error;
	};

	const buildSyncSources = async () => {
		if (!indexManager?.listSyncSources) {
			return [];
		}

		return await indexManager.listSyncSources();
	};

	const toHTMXResponse = (
		html: string,
		status?: number,
		extraHeaders?: Record<string, string>
	) =>
		new Response(html, {
			headers: {
				...HTML_HEADERS,
				...extraHeaders
			},
			status: typeof status === 'number' ? status : HTTP_STATUS_OK
		});

	const appendMessage = (
		conversation: AIConversation,
		message: AIMessage
	) => {
		conversation.messages.push(message);
		conversation.lastMessageAt = Date.now();

		if (!conversation.title && message.role === 'user') {
			conversation.title = message.content.slice(0, TITLE_MAX_LENGTH);
		}
	};

	const appendAssistantMessage = async (
		conversationId: string,
		messageId: string,
		content: string,
		sources: RAGSource[],
		usage?: AIUsage,
		model?: string,
		retrievalStartedAt?: number,
		retrievedAt?: number,
		retrievalDurationMs?: number
	) => {
		const conv = await store.get(conversationId);
		if (!conv) {
			return;
		}

		appendMessage(conv, {
			content,
			conversationId,
			id: messageId,
			model,
			role: 'assistant',
			retrievalDurationMs,
			retrievalStartedAt,
			retrievedAt,
			sources,
			timestamp: Date.now(),
			usage
		});

		await store.set(conversationId, conv);
	};

	const handleCancel = (conversationId: string) => {
		const controller = abortControllers.get(conversationId);

		if (controller) {
			controller.abort();
			abortControllers.delete(conversationId);
		}
	};

	const handleBranch = async (
		ws: { send: (data: string) => void },
		messageId: string,
		conversationId: string
	) => {
		const source = await store.get(conversationId);
		if (!source) {
			return;
		}

		const branched = branchConversation(source, messageId);
		if (!branched) {
			return;
		}

		await store.set(branched.id, branched);
		ws.send(
			JSON.stringify({
				conversationId: branched.id,
				type: 'branched'
			})
		);
	};

	const handleRAGRetrieved = (
		ws: { send: (data: string) => void },
		conversationId: string,
		messageId: string,
		sources: RAGSource[],
		retrievalStartedAt: number,
		retrievedAt: number,
		retrievalDurationMs: number
	) => {
		ws.send(
			JSON.stringify({
				conversationId,
				messageId,
				retrievalDurationMs: retrievedAt - retrievalStartedAt,
				retrievalStartedAt,
				retrievedAt,
				sources,
				type: 'rag_retrieved'
			})
		);
	};

	const handleRAGRetrieving = (
		ws: { send: (data: string) => void },
		conversationId: string,
		messageId: string,
		retrievalStartedAt: number
	) => {
		ws.send(
			JSON.stringify({
				conversationId,
				messageId,
				retrievalStartedAt,
				type: 'rag_retrieving'
			})
		);
	};

	const handleMessage = async (
		ws: { readyState: number; send: (data: string) => void },
		rawContent: string,
		rawConversationId?: string,
		rawAttachments?: AIAttachment[]
	) => {
		const parsed = parseProvider(rawContent);
		const { content, providerName } = parsed;
		const userMessageId = generateId();
		const assistantMessageId = generateId();
		const conversationId = rawConversationId ?? generateId();
		const conversation = await store.getOrCreate(conversationId);
		const history = buildHistory(conversation);
		const model = resolveModel(config, parsed);
		const ragModel = parsed.model ?? model;

		appendMessage(conversation, {
			attachments: rawAttachments,
			content,
			conversationId,
			id: userMessageId,
			role: 'user',
			timestamp: Date.now()
		});
		await store.set(conversationId, conversation);

		const retrievalStartedAt = Date.now();
		handleRAGRetrieving(
			ws,
			conversationId,
			assistantMessageId,
			retrievalStartedAt
		);
		const provider = config.provider(providerName);
		const rag = await buildRAGContextFromQuery(
			config,
			topK,
			scoreThreshold,
			content,
			ragModel,
			config.embedding,
			config.embeddingModel
		);

		const controller = new AbortController();
		abortControllers.set(conversationId, controller);
		const { ragContext, sources } = rag;
		const retrievedAt = Date.now();
		const retrievalDurationMs = retrievedAt - retrievalStartedAt;

		handleRAGRetrieved(
			ws,
			conversationId,
			assistantMessageId,
			sources,
			retrievalStartedAt,
			retrievedAt,
			retrievalDurationMs
		);

		await streamAI(ws, conversationId, assistantMessageId, {
			completeMeta: includeCompleteSources ? { sources } : undefined,
			maxTurns: config.maxTurns,
			messages: [
				...history,
				buildUserMessage(content, rawAttachments, ragContext)
			],
			model,
			provider,
			signal: controller.signal,
			systemPrompt: config.systemPrompt,
			thinking: resolveThinking(config, providerName, model),
			tools: resolveTools(config, providerName, model),
			onComplete: async (fullResponse, usage) => {
				await appendAssistantMessage(
					conversationId,
					assistantMessageId,
					fullResponse,
					sources,
					usage,
					model,
					retrievalStartedAt,
					retrievedAt,
					retrievalDurationMs
				);

				abortControllers.delete(conversationId);
				config.onComplete?.(
					conversationId,
					fullResponse,
					usage,
					sources
				);
			}
		});
	};

	const resolveCollection = () =>
		config.collection ??
		(ragStore
			? createRAGCollection({
					defaultModel: config.embeddingModel,
					defaultTopK: topK,
					embedding: config.embedding,
					rerank: config.rerank,
					store: ragStore
				})
			: null);

	const toRAGEvaluationInput = (body: unknown) => {
		if (!isObjectRecord(body) || !Array.isArray(body.cases)) {
			return null;
		}

		const parsedCases = body.cases
			.map(
				(
					candidate,
					caseIndex
				): RAGEvaluationInput['cases'][number] | null => {
					if (!isObjectRecord(candidate)) {
						return null;
					}

					const query =
						getStringProperty(candidate, 'query')?.trim() ?? '';
					if (!query) {
						return null;
					}

					const caseMetadata = isObjectRecord(candidate.metadata)
						? candidate.metadata
						: undefined;
					const expectedChunkIds = normalizeStringArray(
						candidate.expectedChunkIds
					);
					const expectedSources = normalizeStringArray(
						candidate.expectedSources
					);
					const expectedDocumentIds = normalizeStringArray(
						candidate.expectedDocumentIds
					);
					if (
						expectedChunkIds.length === 0 &&
						expectedSources.length === 0 &&
						expectedDocumentIds.length === 0
					) {
						return null;
					}

					const caseFilter = getObjectProperty(candidate, 'filter');
					if (caseFilter && !isMetadataMap(caseFilter)) {
						return null;
					}

					return {
						filter: caseFilter,
						id:
							getStringProperty(candidate, 'id') ??
							`case-${caseIndex + 1}`,
						label:
							getStringProperty(candidate, 'label') ?? undefined,
						expectedChunkIds,
						expectedDocumentIds,
						expectedSources,
						metadata: caseMetadata,
						model: getStringProperty(candidate, 'model'),
						query,
						scoreThreshold:
							typeof candidate.scoreThreshold === 'number'
								? candidate.scoreThreshold
								: undefined,
						topK:
							typeof candidate.topK === 'number'
								? candidate.topK
								: undefined
					};
				}
			)
			.filter(
				(value): value is RAGEvaluationInput['cases'][number] =>
					value !== null
			);

		if (parsedCases.length === 0) {
			return null;
		}

		const globalFilter = getObjectProperty(body, 'filter');
		if (globalFilter && !isMetadataMap(globalFilter)) {
			return null;
		}

		return {
			cases: parsedCases,
			topK:
				typeof getNumberProperty(body, 'topK') === 'number'
					? getNumberProperty(body, 'topK')
					: undefined,
			dryRun:
				body.dryRun === true
					? true
					: body.dryRun === false
						? false
						: undefined,
			filter: globalFilter,
			model: getStringProperty(body, 'model'),
			scoreThreshold:
				typeof getNumberProperty(body, 'scoreThreshold') === 'number'
					? getNumberProperty(body, 'scoreThreshold')
					: undefined
		} satisfies RAGEvaluationInput;
	};

	const handleEvaluate = async (
		body: unknown
	): Promise<
		| {
				error: string;
				ok: false;
		  }
		| ({
				ok: true;
		  } & RAGEvaluationResponse)
	> => {
		const input = toRAGEvaluationInput(body);
		if (!input) {
			return {
				error: 'Expected payload shape: { cases: [{ id, query, expectedChunkIds|expectedSources|expectedDocumentIds }] }',
				ok: false
			};
		}

		const collection = resolveCollection();
		if (!collection) {
			return {
				error: 'RAG collection is not configured',
				ok: false
			};
		}

		return evaluateRAGCollection({
			collection,
			defaultTopK: topK,
			input
		});
	};

	const handleIngest = async (
		body: unknown
	): Promise<{
		count?: number;
		documentCount?: number;
		ok: boolean;
		error?: string;
	}> => {
		if (!isObjectRecord(body)) {
			return { error: 'Invalid payload', ok: false };
		}

		if (!ragStore) {
			return { error: 'RAG store is not configured', ok: false };
		}

		const chunksValue = body.chunks;
		if (isRAGDocumentChunkArray(chunksValue)) {
			const job = createIngestJob('chunks', chunksValue.length);
			try {
				await ragStore.upsert({ chunks: chunksValue });
				completeIngestJob(job, { chunkCount: chunksValue.length });

				return { count: chunksValue.length, ok: true };
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				failIngestJob(job, message);

				return { error: message, ok: false };
			}
		}

		const documentsValue = body.documents;
		if (!isRAGDocumentArray(documentsValue)) {
			const urlsValue = body.urls;
			if (isRAGDocumentUrlArray(urlsValue)) {
				const job = createIngestJob('urls', urlsValue.length);
				try {
					const prepared = await buildRAGUpsertInputFromURLs({
						baseMetadata:
							getObjectProperty(body, 'baseMetadata') ??
							undefined,
						defaultChunking: normalizeChunkingOptions(
							getObjectProperty(body, 'defaultChunking')
						),
						extractors,
						urls: urlsValue
					});
					await ragStore.upsert(prepared);
					completeIngestJob(job, {
						chunkCount: prepared.chunks.length,
						documentCount: urlsValue.length,
						extractorNames: Array.from(
							new Set(
								prepared.chunks
									.map((chunk) => chunk.metadata?.extractor)
									.filter(
										(value): value is string =>
											typeof value === 'string'
									)
							)
						)
					});

					return {
						count: prepared.chunks.length,
						documentCount: urlsValue.length,
						ok: true
					};
				} catch (caught) {
					const message =
						caught instanceof Error
							? caught.message
							: String(caught);
					failIngestJob(
						job,
						message,
						(extractors ?? []).map((extractor) => extractor.name)
					);

					return { error: message, ok: false };
				}
			}

			const uploadsValue = body.uploads;
			if (isRAGDocumentUploadArray(uploadsValue)) {
				const job = createIngestJob('uploads', uploadsValue.length);
				try {
					const prepared = await buildRAGUpsertInputFromUploads({
						baseMetadata:
							getObjectProperty(body, 'baseMetadata') ??
							undefined,
						defaultChunking: normalizeChunkingOptions(
							getObjectProperty(body, 'defaultChunking')
						),
						extractors,
						uploads: uploadsValue
					});
					await ragStore.upsert(prepared);
					completeIngestJob(job, {
						chunkCount: prepared.chunks.length,
						documentCount: uploadsValue.length,
						extractorNames: Array.from(
							new Set(
								prepared.chunks
									.map((chunk) => chunk.metadata?.extractor)
									.filter(
										(value): value is string =>
											typeof value === 'string'
									)
							)
						)
					});

					return {
						count: prepared.chunks.length,
						documentCount: uploadsValue.length,
						ok: true
					};
				} catch (caught) {
					const message =
						caught instanceof Error
							? caught.message
							: String(caught);
					failIngestJob(
						job,
						message,
						(extractors ?? []).map((extractor) => extractor.name)
					);

					return { error: message, ok: false };
				}
			}

			return {
				error: 'Expected payload shape: { chunks: [...] } or { documents: [...] } or { urls: [...] } or { uploads: [...] }',
				ok: false
			};
		}

		const job = createIngestJob('documents', documentsValue.length);
		try {
			const prepared = buildRAGUpsertInputFromDocuments({
				documents: documentsValue
			});
			await ragStore.upsert(prepared);
			completeIngestJob(job, {
				chunkCount: prepared.chunks.length,
				documentCount: documentsValue.length
			});

			return {
				count: prepared.chunks.length,
				documentCount: documentsValue.length,
				ok: true
			};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failIngestJob(job, message);

			return { error: message, ok: false };
		}
	};

	const handleSearch = async (
		body: unknown
	): Promise<{ ok: boolean; results?: RAGSource[]; error?: string }> => {
		if (!isObjectRecord(body)) {
			return { error: 'Invalid payload', ok: false };
		}

		const query = (getStringProperty(body, 'query') ?? '').trim();

		if (!query) {
			return {
				error: 'Expected payload shape: { query: string }',
				ok: false
			};
		}

		const collection = resolveCollection();

		if (!collection) {
			return { error: 'RAG collection is not configured', ok: false };
		}

		const results = await collection.search({
			filter: getObjectProperty(body, 'filter'),
			model: getStringProperty(body, 'model'),
			query,
			scoreThreshold:
				typeof body.scoreThreshold === 'number'
					? body.scoreThreshold
					: undefined,
			topK: typeof body.topK === 'number' ? body.topK : undefined
		});

		return { ok: true, results: buildSources(results) };
	};

	const summarizeDocuments = (documents: RAGIndexedDocument[]) => ({
		byKind: documents.reduce<Record<string, number>>((acc, document) => {
			const kind = document.kind ?? 'unknown';
			acc[kind] = (acc[kind] ?? 0) + 1;

			return acc;
		}, {}),
		chunkCount: documents.reduce(
			(sum, document) => sum + (document.chunkCount ?? 0),
			0
		),
		total: documents.length
	});

	const summarizeHealth = async (
		documents: RAGIndexedDocument[]
	): Promise<RAGCorpusHealth> => {
		const sourceCounts = new Map<string, number>();
		const documentIdCounts = new Map<string, number>();
		const coverageByFormat = new Map<string, number>();
		const coverageByKind = new Map<string, number>();
		const failuresByExtractor = new Map<string, number>();
		const failuresByInputKind = new Map<string, number>();
		const failuresByAdminAction = new Map<string, number>();
		let emptyDocuments = 0;
		let emptyChunks = 0;
		let lowSignalChunks = 0;
		let documentsMissingSource = 0;
		let documentsMissingTitle = 0;
		let documentsMissingMetadata = 0;
		let documentsMissingCreatedAt = 0;
		let documentsMissingUpdatedAt = 0;
		let documentsWithoutChunkPreview = 0;
		let inspectedDocuments = 0;
		let inspectedChunks = 0;
		let oldestDocumentAgeMs: number | undefined;
		let newestDocumentAgeMs: number | undefined;
		const staleDocuments: string[] = [];
		const now = Date.now();

		for (const document of documents) {
			documentIdCounts.set(
				document.id,
				(documentIdCounts.get(document.id) ?? 0) + 1
			);
			const source = document.source.trim();
			if (source) {
				sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
			} else {
				documentsMissingSource += 1;
			}
			if (!document.title.trim()) {
				documentsMissingTitle += 1;
			}
			if (
				!document.metadata ||
				Object.keys(document.metadata).length === 0
			) {
				documentsMissingMetadata += 1;
			}
			if (typeof document.createdAt !== 'number') {
				documentsMissingCreatedAt += 1;
			}
			if (typeof document.updatedAt !== 'number') {
				documentsMissingUpdatedAt += 1;
			}
			const latestTimestamp =
				typeof document.updatedAt === 'number'
					? document.updatedAt
					: typeof document.createdAt === 'number'
						? document.createdAt
						: undefined;
			if (typeof latestTimestamp === 'number') {
				const ageMs = Math.max(0, now - latestTimestamp);
				oldestDocumentAgeMs =
					typeof oldestDocumentAgeMs === 'number'
						? Math.max(oldestDocumentAgeMs, ageMs)
						: ageMs;
				newestDocumentAgeMs =
					typeof newestDocumentAgeMs === 'number'
						? Math.min(newestDocumentAgeMs, ageMs)
						: ageMs;
				if (ageMs >= staleAfterMs) {
					staleDocuments.push(document.id);
				}
			}
			const format = document.format?.trim() || 'unknown';
			const kind = document.kind?.trim() || 'unknown';
			coverageByFormat.set(
				format,
				(coverageByFormat.get(format) ?? 0) + 1
			);
			coverageByKind.set(kind, (coverageByKind.get(kind) ?? 0) + 1);
			if ((document.chunkCount ?? 0) === 0) {
				emptyDocuments += 1;
			}

			if (indexManager?.getDocumentChunks) {
				const preview = await indexManager.getDocumentChunks(
					document.id
				);
				if (!preview) {
					documentsWithoutChunkPreview += 1;
					continue;
				}
				inspectedDocuments += 1;
				for (const chunk of preview.chunks) {
					inspectedChunks += 1;
					const normalized = chunk.text.trim();
					if (!normalized) {
						emptyChunks += 1;
						continue;
					}

					const tokenCount = normalized
						.split(/\s+/)
						.filter(Boolean).length;
					if (normalized.length < 24 || tokenCount < 4) {
						lowSignalChunks += 1;
					}
				}
			}
		}

		for (const job of ingestJobs) {
			if (job.status !== 'failed') {
				continue;
			}

			failuresByInputKind.set(
				job.inputKind,
				(failuresByInputKind.get(job.inputKind) ?? 0) + 1
			);
			for (const extractorName of job.extractorNames ?? []) {
				failuresByExtractor.set(
					extractorName,
					(failuresByExtractor.get(extractorName) ?? 0) + 1
				);
			}
		}

		for (const job of adminJobs) {
			if (job.status !== 'failed') {
				continue;
			}

			failuresByAdminAction.set(
				job.action,
				(failuresByAdminAction.get(job.action) ?? 0) + 1
			);
		}

		for (const job of syncJobs) {
			if (job.status !== 'failed') {
				continue;
			}

			failuresByAdminAction.set(
				job.action,
				(failuresByAdminAction.get(job.action) ?? 0) + 1
			);
		}

		return {
			averageChunksPerDocument:
				documents.length > 0
					? Number(
							(
								documents.reduce(
									(sum, document) =>
										sum + (document.chunkCount ?? 0),
									0
								) / documents.length
							).toFixed(2)
						)
					: 0,
			duplicateDocumentIds: [...documentIdCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([id]) => id),
			duplicateDocumentIdGroups: [...documentIdCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([id, count]) => ({ count, id }))
				.sort((left, right) => right.count - left.count),
			duplicateSources: [...sourceCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([source]) => source),
			duplicateSourceGroups: [...sourceCounts.entries()]
				.filter(([, count]) => count > 1)
				.map(([source, count]) => ({ count, source }))
				.sort((left, right) => right.count - left.count),
			documentsMissingMetadata,
			documentsMissingSource,
			documentsMissingTitle,
			documentsMissingCreatedAt,
			documentsMissingUpdatedAt,
			documentsWithoutChunkPreview,
			emptyChunks,
			emptyDocuments,
			coverageByFormat: Object.fromEntries(coverageByFormat.entries()),
			coverageByKind: Object.fromEntries(coverageByKind.entries()),
			failedAdminJobs: adminJobs.filter((job) => job.status === 'failed')
				.length,
			failedIngestJobs: ingestJobs.filter(
				(job) => job.status === 'failed'
			).length,
			failuresByAdminAction: Object.fromEntries(
				failuresByAdminAction.entries()
			),
			failuresByExtractor: Object.fromEntries(
				failuresByExtractor.entries()
			),
			failuresByInputKind: Object.fromEntries(
				failuresByInputKind.entries()
			),
			inspectedChunks,
			inspectedDocuments,
			lowSignalChunks,
			newestDocumentAgeMs,
			oldestDocumentAgeMs,
			staleAfterMs,
			staleDocuments
		} as RAGCorpusHealth;
	};

	const buildReadiness = () => ({
		embeddingConfigured: Boolean(config.embedding ?? config.collection),
		embeddingModel:
			config.embeddingModel ??
			(config.collection ? 'collection-managed embeddings' : undefined),
		extractorNames: (extractors ?? []).map((extractor) => extractor.name),
		extractorsConfigured: (extractors?.length ?? 0) > 0,
		indexManagerConfigured: Boolean(indexManager),
		model: typeof config.model === 'string' ? config.model : undefined,
		providerConfigured: typeof config.provider === 'function',
		providerName:
			typeof config.provider === 'function'
				? config.readinessProviderName
				: undefined,
		rerankerConfigured: Boolean(config.rerank ?? config.collection)
	});

	const buildAdminCapabilities = () => ({
		canClearIndex: Boolean(ragStore?.clear),
		canCreateDocument: Boolean(indexManager?.createDocument),
		canDeleteDocument: Boolean(indexManager?.deleteDocument),
		canListSyncSources: Boolean(indexManager?.listSyncSources),
		canReindexDocument: Boolean(indexManager?.reindexDocument),
		canReindexSource: Boolean(indexManager?.reindexSource),
		canReseed: Boolean(indexManager?.reseed),
		canReset: Boolean(indexManager?.reset),
		canSyncAllSources: Boolean(indexManager?.syncAllSources),
		canSyncSource: Boolean(indexManager?.syncSource)
	});

	const buildOperationsPayload = async (): Promise<RAGOperationsResponse> => {
		const collection =
			config.collection ??
			(ragStore
				? createRAGCollection({
						defaultModel: config.embeddingModel,
						defaultTopK: topK,
						embedding: config.embedding,
						store: ragStore
					})
				: null);
		const indexedDocuments = indexManager
			? await indexManager.listDocuments({})
			: [];

		return {
			admin: buildAdminCapabilities(),
			adminActions: [...adminActions],
			adminJobs: [...adminJobs, ...syncJobs].sort(
				(left, right) => right.startedAt - left.startedAt
			),
			capabilities: collection?.getCapabilities?.(),
			documents: indexManager
				? summarizeDocuments(indexedDocuments)
				: undefined,
			health: await summarizeHealth(indexedDocuments),
			ingestJobs: [...ingestJobs],
			ok: true,
			readiness: buildReadiness(),
			status: collection?.getStatus?.(),
			syncSources: await buildSyncSources()
		};
	};

	const handleStatus = async () => buildOperationsPayload();

	const handleOps = async () => buildOperationsPayload();

	const handleDocuments = async (
		kind?: string
	): Promise<RAGDocumentsResponse | { ok: false; error: string }> => {
		if (!indexManager) {
			return {
				error: 'RAG index document management is not configured',
				ok: false
			};
		}

		const documents = await indexManager.listDocuments({ kind });

		return {
			documents,
			ok: true
		};
	};

	const handleCreateDocument = async (body: unknown) => {
		if (!indexManager?.createDocument) {
			return {
				error: 'RAG document creation is not configured',
				ok: false
			};
		}

		if (!isObjectRecord(body)) {
			return {
				error: 'Invalid payload',
				ok: false
			};
		}

		if (!isRAGDocument(body)) {
			return {
				error: 'Invalid payload',
				ok: false
			};
		}

		const job = createAdminJob('create_document', body.id);

		try {
			const result = await indexManager.createDocument(body);
			const action = createAdminAction('create_document', body.id);
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('create_document', body.id);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleDocumentChunks = async (
		id: string
	): Promise<RAGDocumentChunksResponse> => {
		if (!indexManager) {
			return {
				error: 'RAG chunk preview is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'document id is required',
				ok: false
			};
		}

		const preview = await indexManager.getDocumentChunks(id);

		if (!preview) {
			return {
				error: 'document not found',
				ok: false
			};
		}

		return {
			ok: true,
			...preview
		};
	};

	const handleDeleteDocument = async (
		id: string
	): Promise<RAGMutationResponse> => {
		if (!indexManager?.deleteDocument) {
			return {
				error: 'RAG document deletion is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'document id is required',
				ok: false
			};
		}

		const job = createAdminJob('delete_document', id);
		const deleted = await indexManager.deleteDocument(id);

		if (!deleted) {
			failAdminJob(job, 'document not found');
			const action = createAdminAction('delete_document', id);
			failAdminAction(action, 'document not found');

			return {
				error: 'document not found',
				ok: false
			};
		}

		const action = createAdminAction('delete_document', id);
		completeAdminJob(job);
		completeAdminAction(action);

		return {
			deleted: id,
			ok: true
		};
	};

	const handleReindexDocument = async (
		id: string
	): Promise<RAGMutationResponse> => {
		if (!indexManager?.reindexDocument) {
			return {
				error: 'RAG document reindex is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'document id is required',
				ok: false
			};
		}

		const job = createAdminJob('reindex_document', id);

		try {
			const result = {
				ok: true,
				reindexed: id,
				...(await indexManager.reindexDocument(id))
			};
			const action = createAdminAction('reindex_document', id);
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reindex_document', id);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleReindexSource = async (
		source: string
	): Promise<RAGMutationResponse> => {
		if (!indexManager?.reindexSource) {
			return {
				error: 'RAG source reindex is not configured',
				ok: false
			};
		}

		if (!source) {
			return {
				error: 'source is required',
				ok: false
			};
		}

		const job = createAdminJob('reindex_source', source);

		try {
			const result = {
				ok: true,
				reindexed: source,
				...(await indexManager.reindexSource(source))
			};
			const action = createAdminAction('reindex_source');
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reindex_source');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleReseed = async (): Promise<RAGMutationResponse> => {
		if (!indexManager?.reseed) {
			return {
				error: 'RAG reseed is not configured',
				ok: false
			};
		}

		const job = createAdminJob('reseed');

		try {
			const result = {
				ok: true,
				...(await indexManager.reseed())
			};
			const action = createAdminAction('reseed');
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reseed');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleReset = async (): Promise<RAGMutationResponse> => {
		if (!indexManager?.reset) {
			return {
				error: 'RAG reset is not configured',
				ok: false
			};
		}

		const job = createAdminJob('reset');

		try {
			const result = {
				ok: true,
				...(await indexManager.reset())
			};
			const action = createAdminAction('reset');
			completeAdminJob(job);
			completeAdminAction(action);

			return result;
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			const action = createAdminAction('reset');
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleBackends = async (): Promise<
		RAGBackendsResponse | { ok: false; error: string }
	> => {
		if (!indexManager?.listBackends) {
			return {
				error: 'RAG backend discovery is not configured',
				ok: false
			};
		}

		const result = await indexManager.listBackends();
		const normalized = Array.isArray(result)
			? { backends: result }
			: result;

		return {
			ok: true,
			...normalized
		};
	};

	const handleSyncSources = async (): Promise<RAGSyncResponse> => {
		if (!indexManager?.listSyncSources) {
			return {
				error: 'RAG source sync is not configured',
				ok: false
			};
		}

		return {
			ok: true,
			sources: await indexManager.listSyncSources()
		};
	};

	const handleSyncAllSources = async (options?: {
		background?: boolean;
	}): Promise<RAGSyncResponse> => {
		if (!indexManager?.syncAllSources) {
			return {
				error: 'RAG source sync is not configured',
				ok: false
			};
		}

		const job = createAdminJob('sync_all_sources', undefined, syncJobs);
		const action = createAdminAction('sync_all_sources');

		try {
			const result = await indexManager.syncAllSources(options);
			if (result && 'ok' in result) {
				if (!result.ok) {
					failAdminJob(job, result.error);
					failAdminAction(action, result.error);

					return result;
				}

				if (result.partial) {
					const failedSourceIds =
						'sources' in result
							? result.failedSourceIds
							: undefined;
					const message = failedSourceIds?.length
						? `Partial source sync failure: ${failedSourceIds.join(', ')}`
						: 'Partial source sync failure';
					failAdminJob(job, message);
					failAdminAction(action, message);

					return result;
				}

				completeAdminJob(job);
				completeAdminAction(action);

				return result;
			}

			completeAdminJob(job);
			completeAdminAction(action);

			return {
				ok: true,
				sources: await buildSyncSources()
			};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const handleSyncSource = async (
		id: string,
		options?: {
			background?: boolean;
		}
	): Promise<RAGSyncResponse> => {
		if (!indexManager?.syncSource) {
			return {
				error: 'RAG source sync is not configured',
				ok: false
			};
		}

		if (!id) {
			return {
				error: 'sync source id is required',
				ok: false
			};
		}

		const job = createAdminJob('sync_source', id, syncJobs);
		const action = createAdminAction('sync_source', undefined, id);

		try {
			const result = await indexManager.syncSource(id, options);
			if (result && 'ok' in result) {
				if (!result.ok) {
					failAdminJob(job, result.error);
					failAdminAction(action, result.error);

					return result;
				}

				completeAdminJob(job);
				completeAdminAction(action);

				return result;
			}

			completeAdminJob(job);
			completeAdminAction(action);

			const source = (await buildSyncSources()).find(
				(record) => record.id === id
			);

			return source
				? { ok: true, source }
				: {
						error: 'sync source not found',
						ok: false
					};
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : String(caught);
			failAdminJob(job, message);
			failAdminAction(action, message);
			throw caught;
		}
	};

	const htmxRoutes = () => {
		if (!config.htmx) {
			return new Elysia();
		}

		const renderers = resolveRenderers(
			typeof config.htmx === 'object' ? config.htmx.render : undefined
		);

		return new Elysia()
			.post(`${path}/message`, async ({ body }) => {
				const requestBody =
					body && typeof body === 'object' ? body : {};
				const rawContent =
					'content' in requestBody
						? String(requestBody.content)
						: undefined;
				const rawConversationId =
					'conversationId' in requestBody
						? String(requestBody.conversationId)
						: undefined;
				const rawAttachmentsValue =
					'attachments' in requestBody
						? requestBody.attachments
						: undefined;
				const rawAttachments: AIAttachment[] | undefined =
					Array.isArray(rawAttachmentsValue)
						? rawAttachmentsValue
						: undefined;

				if (!rawContent) {
					return new Response('Missing content', {
						status: HTTP_STATUS_BAD_REQUEST
					});
				}

				const conversationId = rawConversationId || generateId();
				const messageId = generateId();
				const conversation = await store.getOrCreate(conversationId);
				const parsed = parseProvider(rawContent);
				const { content } = parsed;

				appendMessage(conversation, {
					attachments: rawAttachments,
					content,
					conversationId,
					id: messageId,
					role: 'user',
					timestamp: Date.now()
				});
				await store.set(conversationId, conversation);

				const sseUrl = `${path}/sse/${conversationId}/${messageId}`;
				const cancelUrl = `${path}/cancel/${conversationId}/${messageId}`;

				return new Response(
					renderers.messageStart({
						cancelUrl,
						content,
						conversationId,
						messageId,
						sseUrl
					}),
					{ headers: { 'Content-Type': 'text/html' } }
				);
			})
			.post(`${path}/cancel/:conversationId/:messageId`, ({ params }) => {
				handleCancel(params.conversationId);

				return new Response(renderers.canceled(), {
					headers: { 'Content-Type': 'text/html' }
				});
			})
			.get(
				`${path}/sse/:conversationId/:messageId`,
				async function* ({ params }) {
					const { conversationId, messageId } = params;
					const conversation = await store.get(conversationId);

					if (!conversation) {
						yield {
							data: renderers.error('Conversation not found'),
							event: 'status'
						};

						return;
					}

					const lastMessage = conversation.messages.findLast(
						(msg) => msg.id === messageId && msg.role === 'user'
					);

					if (!lastMessage) {
						yield {
							data: renderers.error('Message not found'),
							event: 'status'
						};

						return;
					}

					const parsed = parseProvider(lastMessage.content);
					const { content, providerName } = parsed;
					const model = resolveModel(config, parsed);
					const ragModel = parsed.model ?? model;
					const assistantMessageId = generateId();
					const retrievalStartedAt = Date.now();
					yield {
						data: renderers.ragRetrieving({
							conversationId,
							messageId,
							retrievalStartedAt
						}),
						event: 'retrieval'
					};
					const provider = config.provider(providerName);
					const { ragContext, sources } =
						await buildRAGContextFromQuery(
							config,
							topK,
							scoreThreshold,
							content,
							ragModel,
							config.embedding,
							config.embeddingModel
						);
					const retrievedAt = Date.now();
					const retrievalDurationMs =
						retrievedAt - retrievalStartedAt;

					yield {
						data: '',
						event: 'retrieval'
					};

					yield {
						data: renderers.ragRetrieved(sources, {
							conversationId,
							messageId,
							retrievalDurationMs,
							retrievalStartedAt,
							retrievedAt
						}),
						event: 'sources'
					};

					const controller = new AbortController();
					abortControllers.set(conversationId, controller);

					const history = buildHistory(conversation);
					const lastMessageIndex = conversation.messages.findIndex(
						(msg) => msg.id === messageId
					);
					const userHistory =
						lastMessageIndex >= 0
							? history.slice(0, lastMessageIndex)
							: history;
					const messageWithContext = buildUserMessage(
						content,
						lastMessage.attachments,
						ragContext
					);
					const sseStream = streamAIToSSE(
						conversationId,
						assistantMessageId,
						{
							completeMeta: includeCompleteSources
								? { sources }
								: undefined,
							maxTurns: config.maxTurns,
							messages: [...userHistory, messageWithContext],
							model,
							provider,
							signal: controller.signal,
							systemPrompt: config.systemPrompt,
							thinking: resolveThinking(
								config,
								providerName,
								model
							),
							tools: resolveTools(config, providerName, model),
							onComplete: async (fullResponse, usage) => {
								await appendAssistantMessage(
									conversationId,
									assistantMessageId,
									fullResponse,
									sources,
									usage,
									model,
									retrievalStartedAt,
									retrievedAt,
									retrievalDurationMs
								);
								config.onComplete?.(
									conversationId,
									fullResponse,
									usage,
									sources
								);
								abortControllers.delete(conversationId);
							}
						},
						renderers
					);

					for await (const event of sseStream) {
						yield event;
					}
				}
			);
	};

	return new Elysia()
		.ws(path, {
			message: async (ws, raw) => {
				const msg = parseAIMessage(raw);

				if (!msg) {
					return;
				}

				if (msg.type === 'cancel') {
					handleCancel(msg.conversationId);

					return;
				}

				if (msg.type === 'branch') {
					await handleBranch(ws, msg.messageId, msg.conversationId);

					return;
				}

				if (msg.type === 'message') {
					await handleMessage(
						ws,
						msg.content,
						msg.conversationId,
						msg.attachments
					);
				}
			}
		})
		.post(`${path}/search`, async ({ body, request, set }) => {
			const result = await handleSearch(body);

			if (!result.ok) {
				set.status =
					result.error === 'Invalid payload' ||
					result.error?.startsWith('Expected payload shape:')
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'Search failed'
						),
						getNumericStatus(set.status)
					);
				}

				const query = getStringProperty(body, 'query') ?? '';

				return toHTMXResponse(
					workflowRenderers.searchResults({
						query,
						results: result.results ?? []
					})
				);
			}

			return result;
		})
		.post(`${path}/evaluate`, async ({ body, request, set }) => {
			const result = await handleEvaluate(body);

			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(result.error),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.evaluateResult({
						cases: result.cases,
						summary: result.summary
					}),
					HTTP_STATUS_OK
				);
			}

			return result;
		})
		.get(`${path}/status`, async ({ request }) => {
			const result = await handleStatus();

			if (config.htmx && isHTMXRequest(request)) {
				return toHTMXResponse(
					workflowRenderers.status({
						capabilities: result.capabilities,
						documents: result.documents,
						status: result.status
					})
				);
			}

			return result;
		})
		.get(`${path}/ops`, async ({ request }) => {
			const result = await handleOps();

			if (config.htmx && isHTMXRequest(request)) {
				return toHTMXResponse(
					workflowRenderers.status({
						capabilities: result.capabilities,
						documents: result.documents,
						status: result.status
					})
				);
			}

			return result;
		})
		.get(`${path}/documents`, async ({ query, request, set }) => {
			const result = await handleDocuments(
				getStringProperty(query, 'kind')
			);

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(result.error),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.documents({
						documents: result.documents
					})
				);
			}

			return result;
		})
		.post(`${path}/documents`, async ({ body, request, set }) => {
			const result = await handleCreateDocument(body);

			if (!result.ok) {
				const status = result.error?.includes('not configured')
					? HTTP_STATUS_NOT_FOUND
					: HTTP_STATUS_BAD_REQUEST;
				set.status = status;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to create document'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.get(
			`${path}/documents/:id/chunks`,
			async ({ params, request, set }) => {
				const result = await handleDocumentChunks(
					typeof params.id === 'string' ? params.id.trim() : ''
				);

				if (!result.ok) {
					const status =
						result.error === 'document id is required'
							? HTTP_STATUS_BAD_REQUEST
							: HTTP_STATUS_NOT_FOUND;
					set.status = status;
				}

				if (config.htmx && isHTMXRequest(request)) {
					if (!result.ok) {
						return toHTMXResponse(
							workflowRenderers.error(result.error),
							getNumericStatus(set.status)
						);
					}

					return toHTMXResponse(
						workflowRenderers.chunkPreview(result)
					);
				}

				return result;
			}
		)
		.get(`${path}/backends`, async ({ set }) => {
			const result = await handleBackends();

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			return result;
		})
		.get(`${path}/sync`, async ({ request, set }) => {
			const result = await handleSyncSources();

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(result.error),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.mutationResult({
						ok: true,
						status: `loaded ${
							'sources' in result ? result.sources.length : 1
						} sync sources`
					})
				);
			}

			return result;
		})
		.post(`${path}/sync`, async ({ body, request, set }) => {
			const background = getBooleanProperty(body, 'background');
			const result = await handleSyncAllSources({ background });

			if (!result.ok) {
				set.status = HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult({
							ok: true,
							status:
								background === true
									? 'source sync queued in the background'
									: 'source sync started and completed successfully'
						})
					: workflowRenderers.error(
							result.error ?? 'Failed to sync sources'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/sync/:id`, async ({ body, params, request, set }) => {
			const background = getBooleanProperty(body, 'background');
			const result = await handleSyncSource(
				typeof params.id === 'string' ? params.id.trim() : '',
				{ background }
			);

			if (!result.ok) {
				set.status =
					result.error === 'sync source id is required'
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult({
							ok: true,
							status:
								background === true
									? 'source sync queued in the background'
									: 'source sync started and completed successfully'
						})
					: workflowRenderers.error(
							result.error ?? 'Failed to sync source'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/ingest`, async ({ body, request, set }) => {
			const result = await handleIngest(body);
			if (!result.ok) {
				set.status = HTTP_STATUS_BAD_REQUEST;
			}

			if (config.htmx && isHTMXRequest(request)) {
				if (!result.ok) {
					return toHTMXResponse(
						workflowRenderers.error(
							result.error ?? 'RAG ingest failed'
						),
						getNumericStatus(set.status)
					);
				}

				return toHTMXResponse(
					workflowRenderers.mutationResult(result),
					HTTP_STATUS_OK,
					{ 'HX-Trigger': 'rag:mutated' }
				);
			}

			return result;
		})
		.delete(`${path}/index`, async () => {
			if (!ragStore) {
				return { ok: false };
			}

			const job = createAdminJob('clear_index');
			try {
				await ragStore.clear?.();
				const action = createAdminAction('clear_index');
				completeAdminJob(job);
				completeAdminAction(action);
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : String(caught);
				failAdminJob(job, message);
				const action = createAdminAction('clear_index');
				failAdminAction(action, message);
				throw caught;
			}

			return { ok: true };
		})
		.delete(`${path}/documents/:id`, async ({ params, request, set }) => {
			const result = await handleDeleteDocument(
				typeof params.id === 'string' ? params.id.trim() : ''
			);

			if (!result.ok) {
				const status =
					result.error === 'document id is required'
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
				set.status = status;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to delete document'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(
			`${path}/reindex/documents/:id`,
			async ({ params, request, set }) => {
				const result = await handleReindexDocument(
					typeof params.id === 'string' ? params.id.trim() : ''
				);

				if (!result.ok) {
					set.status =
						result.error === 'document id is required'
							? HTTP_STATUS_BAD_REQUEST
							: HTTP_STATUS_NOT_FOUND;
				}

				if (config.htmx && isHTMXRequest(request)) {
					const html = result.ok
						? workflowRenderers.mutationResult(result)
						: workflowRenderers.error(
								result.error ?? 'Failed to reindex document'
							);

					return toHTMXResponse(html, getNumericStatus(set.status), {
						'HX-Trigger': 'rag:mutated'
					});
				}

				return result;
			}
		)
		.post(`${path}/reindex/source`, async ({ body, request, set }) => {
			const source = getStringProperty(body, 'source')?.trim() ?? '';
			const result = await handleReindexSource(source);

			if (!result.ok) {
				set.status =
					result.error === 'source is required'
						? HTTP_STATUS_BAD_REQUEST
						: HTTP_STATUS_NOT_FOUND;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to reindex source'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/reseed`, async ({ request, set }) => {
			const result = await handleReseed();

			if (!result.ok) {
				set.status = 404;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to reseed index'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.post(`${path}/reset`, async ({ request, set }) => {
			const result = await handleReset();

			if (!result.ok) {
				set.status = 404;
			}

			if (config.htmx && isHTMXRequest(request)) {
				const html = result.ok
					? workflowRenderers.mutationResult(result)
					: workflowRenderers.error(
							result.error ?? 'Failed to reset index'
						);

				return toHTMXResponse(html, getNumericStatus(set.status), {
					'HX-Trigger': 'rag:mutated'
				});
			}

			return result;
		})
		.get(`${path}/conversations`, () => store.list())
		.get(`${path}/conversations/:id`, async ({ params }) => {
			const conv = await store.get(params.id);

			if (!conv) {
				return new Response('Not found', { status: 404 });
			}

			return {
				id: conv.id,
				messages: conv.messages,
				title: conv.title ?? 'Untitled'
			};
		})
		.delete(`${path}/conversations/:id`, async ({ params }) => {
			await store.remove(params.id);

			return { ok: true };
		})
		.use(htmxRoutes());
};
