import { onUnmounted, ref, shallowRef, type InjectionKey, type Ref } from 'vue';
import type {
	AIAttachment,
	AIMessage,
	AIServerMessage
} from '../../../types/ai';
import { serverMessageToAction } from '../../ai/client/actions';
import { createAIConnection } from '../../ai/client/connection';
import { createAIMessageStore } from '../../ai/client/messageStore';
import { generateId } from '../../ai/protocol';

type AIStreamReturn = {
	branch: (messageId: string, content: string) => void;
	cancel: () => void;
	destroy: () => void;
	error: Ref<string | null>;
	isStreaming: Ref<boolean>;
	messages: Ref<AIMessage[]>;
	send: (content: string, attachments?: AIAttachment[]) => void;
};

export const AIStreamKey: InjectionKey<AIStreamReturn> = Symbol('ai-stream');

export const useAIStream = (path: string, conversationId?: string) => {
	const connection = createAIConnection(path);
	const store = createAIMessageStore();

	const messages = shallowRef<AIMessage[]>([]);
	const isStreaming = ref(false);
	const error = ref<string | null>(null);
	const activeConversationId = ref<string | null>(conversationId ?? null);

	let unsubscribeConnection: (() => void) | null = null;
	let unsubscribeStore: (() => void) | null = null;

	const syncState = () => {
		const snapshot = store.getSnapshot();
		const convId =
			activeConversationId.value ?? snapshot.activeConversationId;
		const conversation = convId
			? snapshot.conversations.get(convId)
			: undefined;
		messages.value = conversation?.messages ?? [];
		isStreaming.value = snapshot.isStreaming;
		error.value = snapshot.error;
		if (convId) {
			activeConversationId.value = convId;
		}
	};

	unsubscribeStore = store.subscribe(syncState);

	unsubscribeConnection = connection.subscribe((message: AIServerMessage) => {
		const action = serverMessageToAction(message);
		if (action) {
			store.dispatch(action);
		}
	});

	const send = (content: string, attachments?: AIAttachment[]) => {
		const convId = activeConversationId.value ?? generateId();
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
		if (activeConversationId.value) {
			store.dispatch({ type: 'cancel' });
			connection.send({
				conversationId: activeConversationId.value,
				type: 'cancel'
			});
		}
	};

	const branch = (messageId: string, content: string) => {
		if (activeConversationId.value) {
			connection.send({
				content,
				conversationId: activeConversationId.value,
				messageId,
				type: 'branch'
			});
		}
	};

	const destroy = () => {
		unsubscribeConnection?.();
		unsubscribeStore?.();
		connection.close();
	};

	onUnmounted(destroy);

	return {
		branch,
		cancel,
		destroy,
		error,
		isStreaming,
		messages,
		send
	};
};
