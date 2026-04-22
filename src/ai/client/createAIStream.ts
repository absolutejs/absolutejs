import type {
	AIAttachment,
	AIMessage,
	AIServerMessage
} from '../../../types/ai';
import { serverMessageToAction } from './actions';
import { createAIConnection } from './connection';
import { createAIMessageStore } from './messageStore';
import { generateId } from '../protocol';

export const createAIStream = (path: string, conversationId?: string) => {
	const connection = createAIConnection(path);
	const store = createAIMessageStore();
	const listeners = new Set<() => void>();

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
		listeners.forEach((listener) => listener());
	};

	const unsubscribeStore = store.subscribe(syncState);

	const unsubscribeConnection = connection.subscribe(
		(message: AIServerMessage) => {
			const action = serverMessageToAction(message);
			if (action) {
				store.dispatch(action);
			}
		}
	);

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
		unsubscribeStore();
		unsubscribeConnection();
		connection.close();
		listeners.clear();
	};

	const send = (content: string, attachments?: AIAttachment[]) => {
		const convId = activeConversationId ?? generateId();
		const msgId = generateId();

		store.dispatch({
			attachments,
			content,
			conversationId: convId,
			messageId: msgId,
			type: 'send'
		});

		connection.send({
			attachments,
			content,
			conversationId: convId,
			type: 'message'
		});
	};

	const subscribe = (callback: () => void) => {
		listeners.add(callback);

		return () => {
			listeners.delete(callback);
		};
	};

	return {
		branch,
		cancel,
		destroy,
		send,
		subscribe,
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

export type CreateAIStream = typeof createAIStream;
