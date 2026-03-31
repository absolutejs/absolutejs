import type { AIClientMessage, AIServerMessage } from './ai';
import type { HMRClientMessage } from './messages';

/* Type guard for AI client messages */
export const isValidAIClientMessage = (
	data: unknown
): data is AIClientMessage => {
	if (!data || typeof data !== 'object') {
		return false;
	}

	if (!('type' in data) || typeof data.type !== 'string') {
		return false;
	}

	switch (data.type) {
		case 'message':
			return 'content' in data && typeof data.content === 'string';
		case 'cancel':
			return (
				'conversationId' in data &&
				typeof data.conversationId === 'string'
			);
		case 'branch':
			return (
				'messageId' in data &&
				typeof data.messageId === 'string' &&
				'content' in data &&
				typeof data.content === 'string' &&
				'conversationId' in data &&
				typeof data.conversationId === 'string'
			);
		default:
			return false;
	}
};

/* Type guard for AI server messages */
export const isValidAIServerMessage = (
	data: unknown
): data is AIServerMessage => {
	if (!data || typeof data !== 'object') {
		return false;
	}

	if (!('type' in data) || typeof data.type !== 'string') {
		return false;
	}

	switch (data.type) {
		case 'chunk':
			return (
				'content' in data &&
				typeof data.content === 'string' &&
				'messageId' in data &&
				'conversationId' in data
			);
		case 'thinking':
			return (
				'content' in data &&
				typeof data.content === 'string' &&
				'messageId' in data &&
				'conversationId' in data
			);
		case 'tool_status':
			return (
				'name' in data &&
				'status' in data &&
				'messageId' in data &&
				'conversationId' in data
			);
		case 'image':
			return (
				'data' in data &&
				typeof data.data === 'string' &&
				'format' in data &&
				typeof data.format === 'string' &&
				'isPartial' in data &&
				typeof data.isPartial === 'boolean' &&
				'messageId' in data &&
				'conversationId' in data
			);
		case 'complete':
			return 'messageId' in data && 'conversationId' in data;
		case 'error':
			return 'message' in data && typeof data.message === 'string';
		default:
			return false;
	}
};

/* Type guard for HMR client messages */
export const isValidHMRClientMessage = (
	data: unknown
): data is HMRClientMessage => {
	if (!data || typeof data !== 'object') {
		return false;
	}

	if (!('type' in data) || typeof data.type !== 'string') {
		return false;
	}

	switch (data.type) {
		case 'ping':
			return true;
		case 'ready':
			return true;
		case 'request-rebuild':
			return true;
		case 'hydration-error':
			return true;
		case 'hmr-timing':
			return true;
		default:
			return false;
	}
};
