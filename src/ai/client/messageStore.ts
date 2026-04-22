import type {
	AIConversation,
	RAGSource,
	AIImageData,
	AIMessage,
	AIStreamState,
	AIStoreAction,
	AIToolCall
} from '../../../types/ai';

const EMPTY_STATE: AIStreamState = {
	activeConversationId: null,
	conversations: new Map(),
	error: null,
	isStreaming: false
};

const initialActiveConversationId: string | null = null;
const initialError: string | null = null;

// eslint-disable-next-line absolute/no-useless-function -- returns a new instance each call
const freshState = () => ({
	activeConversationId: initialActiveConversationId,
	conversations: new Map<string, AIConversation>(),
	error: initialError,
	isStreaming: false
});

const findAssistantMessage = (
	conversation: AIConversation,
	messageId: string
) =>
	conversation.messages.find(
		(msg) => msg.id === messageId && msg.role === 'assistant'
	);

const getOrCreate = (state: AIStreamState, conversationId: string) => {
	let conversation = state.conversations.get(conversationId);

	if (!conversation) {
		conversation = {
			createdAt: Date.now(),
			id: conversationId,
			messages: []
		};
		state.conversations.set(conversationId, conversation);
	}

	return conversation;
};

const handleSend = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'send' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const message: AIMessage = {
		attachments: action.attachments,
		content: action.content,
		conversationId: action.conversationId,
		id: action.messageId,
		role: 'user',
		timestamp: Date.now()
	};

	conversation.messages = [...conversation.messages, message];
	state.activeConversationId = action.conversationId;
	state.error = null;
	state.isStreaming = true;
};

const handleChunk = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'chunk' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const existingIdx = conversation.messages.findIndex(
		(msg) => msg.id === action.messageId && msg.role === 'assistant'
	);

	if (existingIdx >= 0) {
		const prevContent = conversation.messages[existingIdx]?.content ?? '';
		conversation.messages = conversation.messages.map((msg, idx) =>
			idx === existingIdx
				? { ...msg, content: prevContent + action.content }
				: msg
		);

		return;
	}

	const message: AIMessage = {
		content: action.content,
		conversationId: action.conversationId,
		id: action.messageId,
		isStreaming: true,
		role: 'assistant',
		timestamp: Date.now()
	};

	conversation.messages = [...conversation.messages, message];
};

const handleThinking = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'thinking' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const existingIdx = conversation.messages.findIndex(
		(msg) => msg.id === action.messageId && msg.role === 'assistant'
	);

	if (existingIdx >= 0) {
		const prevThinking = conversation.messages[existingIdx]?.thinking ?? '';
		conversation.messages = conversation.messages.map((msg, idx) =>
			idx === existingIdx
				? { ...msg, thinking: prevThinking + action.content }
				: msg
		);

		return;
	}

	const message: AIMessage = {
		content: '',
		conversationId: action.conversationId,
		id: action.messageId,
		isStreaming: true,
		role: 'assistant',
		thinking: action.content,
		timestamp: Date.now()
	};

	conversation.messages = [...conversation.messages, message];
};

const upsertToolCall = (message: AIMessage, toolCall: AIToolCall) => {
	if (!message.toolCalls) {
		message.toolCalls = [toolCall];

		return;
	}

	const existingIdx = message.toolCalls.findIndex(
		(existing) => existing.name === toolCall.name
	);

	if (existingIdx >= 0) {
		message.toolCalls[existingIdx] = toolCall;
	} else {
		message.toolCalls = [...message.toolCalls, toolCall];
	}
};

const getOrCreateAssistantMessage = (
	conversation: AIConversation,
	messageId: string,
	conversationId: string
) => {
	const existing = findAssistantMessage(conversation, messageId);

	if (existing) {
		return existing;
	}

	const message: AIMessage = {
		content: '',
		conversationId,
		id: messageId,
		isStreaming: true,
		role: 'assistant',
		timestamp: Date.now()
	};
	conversation.messages = [...conversation.messages, message];

	return message;
};

const handleRAGRetrieved = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'rag_retrieved' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const message = getOrCreateAssistantMessage(
		conversation,
		action.messageId,
		action.conversationId
	);

	message.sources = action.sources;
	message.retrievalStartedAt =
		action.retrievalStartedAt ?? message.retrievalStartedAt;
	message.retrievedAt = action.retrievedAt;
	message.retrievalDurationMs = action.retrievalDurationMs;
	message.retrievalTrace = action.trace;
	conversation.messages = [...conversation.messages];
};

const handleRAGRetrieving = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'rag_retrieving' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const message = getOrCreateAssistantMessage(
		conversation,
		action.messageId,
		action.conversationId
	);

	message.retrievalStartedAt = action.retrievalStartedAt;
	conversation.messages = [...conversation.messages];
};

const handleToolStatus = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'tool_status' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const message = getOrCreateAssistantMessage(
		conversation,
		action.messageId,
		action.conversationId
	);

	const toolCall: AIToolCall = {
		id: action.messageId,
		input: action.input,
		name: action.name,
		result: action.status === 'complete' ? (action.result ?? '') : undefined
	};

	upsertToolCall(message, toolCall);
	conversation.messages = [...conversation.messages];
};

const markMessageComplete = (
	conversation: AIConversation,
	messageId: string,
	usage?: { inputTokens: number; outputTokens: number },
	durationMs?: number,
	model?: string,
	sources?: RAGSource[]
) => {
	conversation.messages = conversation.messages.map((msg) =>
		msg.id === messageId && msg.role === 'assistant'
			? {
					...msg,
					durationMs,
					isStreaming: false,
					model,
					sources: sources ?? msg.sources,
					usage
				}
			: msg
	);
};

const NOT_FOUND = -1;

const findExistingImageById = (
	images: AIImageData[],
	imageId: string | undefined
) => {
	if (!imageId) return NOT_FOUND;

	return images.findIndex((img) => img.imageId === imageId);
};

const findReplaceablePartialIndex = (images: AIImageData[]) => {
	const lastIdx = images.length - 1;

	if (lastIdx >= 0 && images[lastIdx]?.isPartial) {
		return lastIdx;
	}

	return NOT_FOUND;
};

const upsertImage = (message: AIMessage, imageData: AIImageData) => {
	if (!message.images) {
		message.images = [imageData];

		return;
	}

	const existingIdx = findExistingImageById(
		message.images,
		imageData.imageId
	);

	if (existingIdx >= 0) {
		message.images[existingIdx] = imageData;

		return;
	}

	const replaceableIdx = findReplaceablePartialIndex(message.images);

	if (replaceableIdx >= 0) {
		message.images[replaceableIdx] = imageData;

		return;
	}

	message.images = [...message.images, imageData];
};

const handleImage = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'image' }
) => {
	const conversation = getOrCreate(state, action.conversationId);
	const message = getOrCreateAssistantMessage(
		conversation,
		action.messageId,
		action.conversationId
	);

	upsertImage(message, {
		data: action.data,
		format: action.format,
		imageId: action.imageId,
		isPartial: action.isPartial,
		revisedPrompt: action.revisedPrompt
	});

	conversation.messages = [...conversation.messages];
};

const handleComplete = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'complete' }
) => {
	const conversation = state.conversations.get(action.conversationId);

	if (conversation) {
		markMessageComplete(
			conversation,
			action.messageId,
			action.usage,
			action.durationMs,
			action.model,
			action.sources
		);
	}

	state.isStreaming = false;
};

const markConversationStreamsComplete = (conversation: AIConversation) => {
	const streamingMessages = conversation.messages.filter(
		(msg) => msg.isStreaming
	);

	if (streamingMessages.length === 0) {
		return;
	}

	for (const msg of streamingMessages) {
		msg.isStreaming = false;
	}

	conversation.messages = [...conversation.messages];
};

const markAllStreamsComplete = (state: AIStreamState) => {
	for (const [, conversation] of state.conversations) {
		markConversationStreamsComplete(conversation);
	}
};

const handleBranch = (
	state: AIStreamState,
	action: AIStoreAction & { type: 'branch' }
) => {
	const source = state.conversations.get(action.oldConversationId);

	if (!source) {
		return;
	}

	const cutoffIndex = source.messages.findIndex(
		(msg) => msg.id === action.fromMessageId
	);

	if (cutoffIndex < 0) {
		return;
	}

	const branchedMessages = source.messages
		.slice(0, cutoffIndex + 1)
		.map((msg) => ({ ...msg, conversationId: action.newConversationId }));

	const newConversation: AIConversation = {
		createdAt: Date.now(),
		id: action.newConversationId,
		messages: branchedMessages
	};

	state.conversations.set(action.newConversationId, newConversation);
	state.activeConversationId = action.newConversationId;
};

const applyAction = (state: AIStreamState, action: AIStoreAction) => {
	switch (action.type) {
		case 'send':
			handleSend(state, action);
			break;
		case 'chunk':
			handleChunk(state, action);
			break;
		case 'thinking':
			handleThinking(state, action);
			break;
		case 'tool_status':
			handleToolStatus(state, action);
			break;
		case 'image':
			handleImage(state, action);
			break;
		case 'complete':
			handleComplete(state, action);
			break;
		case 'error':
			state.error = action.message;
			state.isStreaming = false;
			break;
		case 'rag_retrieving':
			handleRAGRetrieving(state, action);
			break;
		case 'rag_retrieved':
			handleRAGRetrieved(state, action);
			break;
		case 'cancel':
			state.isStreaming = false;
			markAllStreamsComplete(state);
			break;
		case 'branch':
			handleBranch(state, action);
			break;
		case 'set_conversation':
			state.activeConversationId = action.conversationId;
			break;
	}
};

export const createAIMessageStore = () => {
	let state = freshState();
	const subscribers = new Set<() => void>();

	return {
		dispatch: (action: AIStoreAction) => {
			applyAction(state, action);
			// New reference so useSyncExternalStore detects the change
			state = { ...state, conversations: new Map(state.conversations) };
			subscribers.forEach((callback) => callback());
		},
		getServerSnapshot: () => EMPTY_STATE,
		getSnapshot: () => state,
		subscribe: (callback: () => void) => {
			subscribers.add(callback);

			return () => {
				subscribers.delete(callback);
			};
		}
	};
};
