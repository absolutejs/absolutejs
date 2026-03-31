import type { AIServerMessage } from '../../../types/ai';

export const serverMessageToAction = (msg: AIServerMessage) => {
	switch (msg.type) {
		case 'chunk':
			return {
				content: msg.content,
				conversationId: msg.conversationId,
				messageId: msg.messageId,
				type: 'chunk' as const
			};
		case 'thinking':
			return {
				content: msg.content,
				conversationId: msg.conversationId,
				messageId: msg.messageId,
				type: 'thinking' as const
			};
		case 'tool_status':
			return {
				conversationId: msg.conversationId,
				input: msg.input,
				messageId: msg.messageId,
				name: msg.name,
				result: msg.result,
				status: msg.status,
				type: 'tool_status' as const
			};
		case 'image':
			return {
				conversationId: msg.conversationId,
				data: msg.data,
				format: msg.format,
				imageId: msg.imageId,
				isPartial: msg.isPartial,
				messageId: msg.messageId,
				revisedPrompt: msg.revisedPrompt,
				type: 'image' as const
			};
		case 'complete':
			return {
				conversationId: msg.conversationId,
				durationMs: msg.durationMs,
				messageId: msg.messageId,
				model: msg.model,
				type: 'complete' as const,
				usage: msg.usage
			};
		case 'error':
			return { message: msg.message, type: 'error' as const };
		default:
			return null;
	}
};
