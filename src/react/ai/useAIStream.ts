import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { AIAttachment } from '../../../types/ai';
import { serverMessageToAction } from '../../ai/client/actions';
import { createAIConnection } from '../../ai/client/connection';
import { createAIMessageStore } from '../../ai/client/messageStore';
import { generateId } from '../../ai/protocol';
import { useAIStreamContext } from './AIStreamProvider';

export const useAIStream = (path?: string, conversationId?: string) => {
	const context = useAIStreamContext();
	const standaloneRef = useRef<{
		connection: ReturnType<typeof createAIConnection>;
		store: ReturnType<typeof createAIMessageStore>;
	} | null>(null);

	const isStandalone = !context;

	if (isStandalone && !standaloneRef.current && path) {
		const connection = createAIConnection(path);
		const store = createAIMessageStore();
		standaloneRef.current = { connection, store };
	}

	const resolved = context ?? standaloneRef.current;
	if (!resolved) {
		throw new Error(
			'useAIStream requires either an AIStreamProvider or a path argument'
		);
	}

	const { connection, store } = resolved;

	useEffect(() => {
		if (!isStandalone) {
			return undefined;
		}

		const unsubscribe = connection.subscribe((message) => {
			const action = serverMessageToAction(message);
			if (action) {
				store.dispatch(action);
			}
		});

		return () => {
			unsubscribe();
			connection.close();
		};
	}, [connection, isStandalone, store]);

	const state = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getServerSnapshot
	);

	const activeConvId = conversationId ?? state.activeConversationId;
	const conversation = activeConvId
		? state.conversations.get(activeConvId)
		: undefined;
	const messages = conversation?.messages ?? [];

	const send = useCallback(
		(content: string, attachments?: AIAttachment[]) => {
			const convId = activeConvId ?? generateId();
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
		},
		[activeConvId, connection, store]
	);

	const cancel = useCallback(() => {
		if (activeConvId) {
			store.dispatch({ type: 'cancel' });
			connection.send({ conversationId: activeConvId, type: 'cancel' });
		}
	}, [activeConvId, connection, store]);

	const branch = useCallback(
		(messageId: string, content: string) => {
			if (activeConvId) {
				connection.send({
					content,
					conversationId: activeConvId,
					messageId,
					type: 'branch'
				});
			}
		},
		[activeConvId, connection]
	);

	return {
		branch,
		cancel,
		error: state.error,
		isStreaming: state.isStreaming,
		messages,
		send
	};
};
