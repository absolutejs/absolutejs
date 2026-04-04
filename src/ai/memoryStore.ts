import type { AIConversation, AIConversationStore } from '../../types/ai';

export const createMemoryStore = (): AIConversationStore => {
	const conversations = new Map<string, AIConversation>();

	const get = async (id: string) => conversations.get(id);

	const getOrCreate = async (id: string) => {
		let conversation = conversations.get(id);

		if (!conversation) {
			conversation = { createdAt: Date.now(), id, messages: [] };
			conversations.set(id, conversation);
		}

		return conversation;
	};

	const set = async (id: string, conversation: AIConversation) => {
		conversations.set(id, conversation);
	};

	const list = async () =>
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

	const remove = async (id: string) => {
		conversations.delete(id);
	};

	return { get, getOrCreate, list, remove, set };
};
