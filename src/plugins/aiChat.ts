import { Elysia } from 'elysia';
import type { AIChatPluginConfig } from '../../types/ai';
import { createConversationManager } from '../ai/conversationManager';
import { parseAIMessage } from '../ai/protocol';
import { streamAI } from '../ai/streamAI';

const DEFAULT_PATH = '/chat';
const MAX_PREFIX_LEN = 12;

const defaultParseProvider = (content: string) => {
	const colonIdx = content.indexOf(':');
	const hasPrefix = colonIdx > 0 && colonIdx < MAX_PREFIX_LEN;

	return {
		content: hasPrefix ? content.slice(colonIdx + 1) : content,
		providerName: hasPrefix ? content.slice(0, colonIdx) : 'anthropic'
	};
};

export const aiChat = (config: AIChatPluginConfig) => {
	const path = config.path ?? DEFAULT_PATH;
	const conversations = createConversationManager();
	const parseProvider = config.parseProvider ?? defaultParseProvider;

	const handleCancel = (conversationId: string) => {
		conversations.abort(conversationId);
	};

	const handleBranch = (
		ws: { send: (data: string) => void },
		messageId: string,
		conversationId: string
	) => {
		const newConvId = conversations.branch(messageId, conversationId);

		if (newConvId) {
			ws.send(
				JSON.stringify({ conversationId: newConvId, type: 'branched' })
			);
		}
	};

	const handleUserMessage = async (
		ws: { readyState: number; send: (data: string) => void },
		rawContent: string,
		rawConversationId?: string,
		attachments?: Array<{
			data: string;
			media_type:
				| 'image/png'
				| 'image/jpeg'
				| 'image/gif'
				| 'image/webp'
				| 'application/pdf';
			name?: string;
		}>
	) => {
		const conversationId = rawConversationId ?? crypto.randomUUID();
		const messageId = crypto.randomUUID();
		const parsed: {
			content: string;
			model?: string;
			providerName: string;
		} = parseProvider(rawContent);
		const { content, providerName } = parsed;

		conversations.getOrCreate(conversationId);
		const history = conversations.getHistory(conversationId);
		const controller = conversations.getAbortController(conversationId);

		conversations.appendMessage(conversationId, {
			attachments,
			content,
			conversationId,
			id: messageId,
			role: 'user',
			timestamp: Date.now()
		});

		const resolveModel = () => {
			if (parsed.model) {
				return parsed.model;
			}

			if (typeof config.model === 'string') {
				return config.model;
			}

			if (typeof config.model === 'function') {
				return config.model(providerName);
			}

			return providerName;
		};

		const model = resolveModel();

		const resolvedTools =
			typeof config.tools === 'function'
				? config.tools(providerName, model)
				: config.tools;

		const userMessage =
			attachments && attachments.length > 0
				? {
						content: [
							...attachments.map((att) => {
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
							}),
							{ content, type: 'text' as const }
						],
						role: 'user' as const
					}
				: { content, role: 'user' as const };

		const resolvedThinking =
			typeof config.thinking === 'function'
				? config.thinking(providerName, model)
				: config.thinking;

		await streamAI(ws, conversationId, messageId, {
			maxTurns: config.maxTurns,
			messages: [...history, userMessage],
			model,
			provider: config.provider(providerName),
			signal: controller.signal,
			systemPrompt: config.systemPrompt,
			thinking: resolvedThinking,
			tools: resolvedTools,
			onComplete: (fullResponse, usage) => {
				conversations.appendMessage(conversationId, {
					content: fullResponse,
					conversationId,
					id: crypto.randomUUID(),
					role: 'assistant',
					timestamp: Date.now()
				});
				config.onComplete?.(conversationId, fullResponse, usage);
			}
		});
	};

	return new Elysia()
		.ws(path, {
			message: async (ws, raw) => {
				const msg = parseAIMessage(raw);

				if (!msg) {
					return;
				}

				if (msg.type === 'cancel' && msg.conversationId) {
					handleCancel(msg.conversationId);

					return;
				}

				if (msg.type === 'branch') {
					handleBranch(ws, msg.messageId, msg.conversationId);

					return;
				}

				if (msg.type === 'message') {
					await handleUserMessage(
						ws,
						msg.content,
						msg.conversationId,
						msg.attachments
					);
				}
			}
		})
		.get(`${path}/conversations`, () => conversations.list())
		.get(`${path}/conversations/:id`, ({ params }) => {
			const conv = conversations.get(params.id);

			if (!conv) {
				return new Response('Not found', { status: 404 });
			}

			return {
				id: conv.id,
				messages: conv.messages,
				title: conv.title ?? 'Untitled'
			};
		})
		.delete(`${path}/conversations/:id`, ({ params }) => {
			conversations.remove(params.id);

			return { ok: true };
		});
};
