import type {
	AIConversation,
	AIMessage,
	AIProviderMessage
} from '../../types/ai';
import { generateId } from './protocol';

const NOT_FOUND = -1;
const TITLE_MAX_LENGTH = 80;

export const createConversationManager = () => {
	const conversations = new Map<string, AIConversation>();

	const getOrCreate = (conversationId?: string) => {
		const id = conversationId ?? generateId();
		let conversation = conversations.get(id);

		if (!conversation) {
			conversation = { createdAt: Date.now(), id, messages: [] };
			conversations.set(id, conversation);
		}

		return conversation;
	};

	const appendMessage = (conversationId: string, message: AIMessage) => {
		const conversation = getOrCreate(conversationId);
		conversation.messages.push(message);
		conversation.lastMessageAt = Date.now();

		if (!conversation.title && message.role === 'user') {
			conversation.title = message.content.slice(0, TITLE_MAX_LENGTH);
		}
	};

	const branch = (fromMessageId: string, sourceConversationId: string) => {
		const source = conversations.get(sourceConversationId);

		if (!source) {
			return null;
		}

		const cutoffIndex = source.messages.findIndex(
			(msg) => msg.id === fromMessageId
		);

		if (cutoffIndex === NOT_FOUND) {
			return null;
		}

		const newId = generateId();
		const branchedMessages = source.messages
			.slice(0, cutoffIndex + 1)
			.map((msg) => ({ ...msg, conversationId: newId }));

		const newConversation: AIConversation = {
			createdAt: Date.now(),
			id: newId,
			messages: branchedMessages
		};
		conversations.set(newId, newConversation);

		return newId;
	};

	const emptyHistory: AIProviderMessage[] = [];

	const getHistory = (conversationId: string) => {
		const conversation = conversations.get(conversationId);

		if (!conversation) {
			return emptyHistory;
		}

		const history: AIProviderMessage[] = conversation.messages.map(
			(msg) => ({
				content: msg.content,
				role: msg.role
			})
		);

		return history;
	};

	const getAbortController = (conversationId: string) => {
		const conversation = getOrCreate(conversationId);
		const controller = new AbortController();
		conversation.activeStreamAbort = controller;

		return controller;
	};

	const abort = (conversationId: string) => {
		const conversation = conversations.get(conversationId);

		if (conversation?.activeStreamAbort) {
			conversation.activeStreamAbort.abort();
			conversation.activeStreamAbort = undefined;
		}
	};

	const get = (conversationId: string) => conversations.get(conversationId);

	const remove = (conversationId: string) =>
		conversations.delete(conversationId);

	const list = () =>
		Array.from(conversations.values())
			.map((conv) => ({
				createdAt: conv.createdAt,
				id: conv.id,
				lastMessageAt: conv.lastMessageAt,
				messageCount: conv.messages.length,
				title: conv.title ?? 'Untitled'
			}))
			.sort(
				(first, second) =>
					(second.lastMessageAt ?? second.createdAt) -
					(first.lastMessageAt ?? first.createdAt)
			);

	const getMessages = (conversationId: string) => {
		const conversation = conversations.get(conversationId);

		if (!conversation) {
			return [];
		}

		return conversation.messages;
	};

	return {
		abort,
		appendMessage,
		branch,
		get,
		getAbortController,
		getHistory,
		getMessages,
		getOrCreate,
		list,
		remove
	};
};
