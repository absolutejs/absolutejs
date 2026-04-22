import type { AIServerMessage } from '../../../types/ai';

export const serverMessageToAction = (message: AIServerMessage) => {
	switch (message.type) {
		case 'chunk':
			return {
				content: message.content,
				conversationId: message.conversationId,
				messageId: message.messageId,
				type: 'chunk' as const
			};
		case 'thinking':
			return {
				content: message.content,
				conversationId: message.conversationId,
				messageId: message.messageId,
				type: 'thinking' as const
			};
		case 'tool_status':
			return {
				conversationId: message.conversationId,
				input: message.input,
				messageId: message.messageId,
				name: message.name,
				result: message.result,
				status: message.status,
				type: 'tool_status' as const
			};
		case 'image':
			return {
				conversationId: message.conversationId,
				data: message.data,
				format: message.format,
				imageId: message.imageId,
				isPartial: message.isPartial,
				messageId: message.messageId,
				revisedPrompt: message.revisedPrompt,
				type: 'image' as const
			};
		case 'complete':
			return {
				conversationId: message.conversationId,
				durationMs: message.durationMs,
				messageId: message.messageId,
				model: message.model,
				sources: message.sources,
				type: 'complete' as const,
				usage: message.usage
			};
		case 'rag_retrieving':
			return {
				conversationId: message.conversationId,
				messageId: message.messageId,
				retrievalStartedAt: message.retrievalStartedAt,
				type: 'rag_retrieving' as const
			};
		case 'rag_retrieved':
			return {
				conversationId: message.conversationId,
				messageId: message.messageId,
				retrievalDurationMs: message.retrievalDurationMs,
				retrievalStartedAt: message.retrievalStartedAt,
				retrievedAt: message.retrievedAt,
				sources: message.sources,
				trace: message.trace,
				type: 'rag_retrieved' as const
			};
		case 'error':
			return { message: message.message, type: 'error' as const };
		default:
			return null;
	}
};
