import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import type {
	AIAttachment,
	AIMessage,
	AIServerMessage
} from '../../../types/ai';
import { serverMessageToAction } from '../../ai/client/actions';
import { createAIConnection } from '../../ai/client/connection';
import { createAIMessageStore } from '../../ai/client/messageStore';
import { generateId } from '../../ai/protocol';

@Injectable({ providedIn: 'root' })
export class AIStreamService implements OnDestroy {
	private connections = new Map<
		string,
		{
			connection: ReturnType<typeof createAIConnection>;
			store: ReturnType<typeof createAIMessageStore>;
			unsubscribeConnection: () => void;
			unsubscribeStore: () => void;
		}
	>();

	connect(path: string, conversationId?: string) {
		const existing = this.connections.get(path);
		if (existing) {
			return this.createHandle(existing, conversationId);
		}

		const connection = createAIConnection(path);
		const store = createAIMessageStore();

		const messagesSignal = signal<AIMessage[]>([]);
		const isStreamingSignal = signal(false);
		const errorSignal = signal<string | null>(null);
		const activeConversationIdSignal = signal<string | null>(
			conversationId ?? null
		);

		const syncState = () => {
			const snapshot = store.getSnapshot();
			const convId =
				activeConversationIdSignal() ?? snapshot.activeConversationId;
			const conversation = convId
				? snapshot.conversations.get(convId)
				: undefined;
			messagesSignal.set(conversation?.messages ?? []);
			isStreamingSignal.set(snapshot.isStreaming);
			errorSignal.set(snapshot.error);
			if (convId) {
				activeConversationIdSignal.set(convId);
			}
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

		const entry: {
			connection: ReturnType<typeof createAIConnection>;
			store: ReturnType<typeof createAIMessageStore>;
			unsubscribeConnection: () => void;
			unsubscribeStore: () => void;
		} = {
			connection,
			store,
			unsubscribeConnection,
			unsubscribeStore
		};
		this.connections.set(path, entry);

		const send = (content: string, attachments?: AIAttachment[]) => {
			const convId = activeConversationIdSignal() ?? generateId();
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

		const cancel = () => {
			const convId = activeConversationIdSignal();
			if (convId) {
				store.dispatch({ type: 'cancel' });
				connection.send({ conversationId: convId, type: 'cancel' });
			}
		};

		const branch = (messageId: string, content: string) => {
			const convId = activeConversationIdSignal();
			if (convId) {
				connection.send({
					content,
					conversationId: convId,
					messageId,
					type: 'branch'
				});
			}
		};

		return {
			branch,
			cancel,
			error: computed(() => errorSignal()),
			isStreaming: computed(() => isStreamingSignal()),
			messages: computed(() => messagesSignal()),
			send
		};
	}

	private createHandle(
		entry: {
			connection: ReturnType<typeof createAIConnection>;
			store: ReturnType<typeof createAIMessageStore>;
		},
		conversationId?: string
	) {
		const { connection, store } = entry;

		const messagesSignal = signal<AIMessage[]>([]);
		const isStreamingSignal = signal(false);
		const errorSignal = signal<string | null>(null);
		const activeConversationIdSignal = signal<string | null>(
			conversationId ?? null
		);

		store.subscribe(() => {
			const snapshot = store.getSnapshot();
			const convId =
				activeConversationIdSignal() ?? snapshot.activeConversationId;
			const conversation = convId
				? snapshot.conversations.get(convId)
				: undefined;
			messagesSignal.set(conversation?.messages ?? []);
			isStreamingSignal.set(snapshot.isStreaming);
			errorSignal.set(snapshot.error);
			if (convId) {
				activeConversationIdSignal.set(convId);
			}
		});

		const send = (content: string, attachments?: AIAttachment[]) => {
			const convId = activeConversationIdSignal() ?? generateId();
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

		const cancel = () => {
			const convId = activeConversationIdSignal();
			if (convId) {
				store.dispatch({ type: 'cancel' });
				connection.send({ conversationId: convId, type: 'cancel' });
			}
		};

		const branch = (messageId: string, content: string) => {
			const convId = activeConversationIdSignal();
			if (convId) {
				connection.send({
					content,
					conversationId: convId,
					messageId,
					type: 'branch'
				});
			}
		};

		return {
			branch,
			cancel,
			error: computed(() => errorSignal()),
			isStreaming: computed(() => isStreamingSignal()),
			messages: computed(() => messagesSignal()),
			send
		};
	}

	ngOnDestroy() {
		for (const [, entry] of this.connections) {
			entry.unsubscribeConnection();
			entry.unsubscribeStore();
			entry.connection.close();
		}
		this.connections.clear();
	}
}
