import type { AIMessage, AIServerMessage } from '../../../types/ai';
import { serverMessageToAction } from '../../ai/client/actions';
import { createAIConnection } from '../../ai/client/connection';
import { createAIMessageStore } from '../../ai/client/messageStore';
import { generateId } from '../../ai/protocol';

export const createAIStream = (path: string, conversationId?: string) => {
	const connection = createAIConnection(path);
	const store = createAIMessageStore();

	let currentError: string | null = null;
	let currentIsStreaming = false;
	let currentMessages: AIMessage[] = [];
	let activeConversationId: string | null = conversationId ?? null;

	const syncState = () => {
		const snapshot = store.getSnapshot();
		const convId = activeConversationId ?? snapshot.activeConversationId;
		const conversation = convId
			? snapshot.conversations.get(convId)
			: undefined;
		activeConversationId = convId ?? snapshot.activeConversationId;
		currentError = snapshot.error;
		currentIsStreaming = snapshot.isStreaming;
		currentMessages = conversation?.messages ?? [];
	};

	store.subscribe(syncState);

	connection.subscribe((msg: AIServerMessage) => {
		const action = serverMessageToAction(msg);
		if (action) {
			store.dispatch(action);
		}
	});

	const branch = (messageId: string, content: string) => {
		if (activeConversationId) {
			connection.send({
				content,
				conversationId: activeConversationId,
				messageId,
				type: 'branch'
			});
		}
	};

	const cancel = () => {
		if (activeConversationId) {
			store.dispatch({ type: 'cancel' });
			connection.send({
				conversationId: activeConversationId,
				type: 'cancel'
			});
		}
	};

	const destroy = () => {
		connection.close();
	};

	const send = (content: string) => {
		const convId = activeConversationId ?? generateId();
		const msgId = generateId();

		store.dispatch({
			content,
			conversationId: convId,
			messageId: msgId,
			type: 'send'
		});

		connection.send({
			content,
			conversationId: convId,
			type: 'message'
		});
	};

	return {
		branch,
		cancel,
		destroy,
		send,
		get error() {
			return currentError;
		},
		get isStreaming() {
			return currentIsStreaming;
		},
		get messages() {
			return currentMessages;
		}
	};
};
