/* AI/LLM streaming types for WebSocket-based AI communication */

/* ─── Provider types ─── */

export type AIUsage = {
	inputTokens: number;
	outputTokens: number;
};

export type AITextChunk = {
	type: 'text';
	content: string;
};

export type AIToolUseChunk = {
	type: 'tool_use';
	id: string;
	name: string;
	input: unknown;
};

export type AIDoneChunk = {
	type: 'done';
	usage?: AIUsage;
};

export type AIThinkingChunk = {
	type: 'thinking';
	content: string;
};

export type AIImageChunk = {
	type: 'image';
	data: string;
	format: string;
	isPartial: boolean;
	revisedPrompt?: string;
	imageId?: string;
};

export type AIChunk =
	| AITextChunk
	| AIThinkingChunk
	| AIToolUseChunk
	| AIImageChunk
	| AIDoneChunk;

export type AIProviderStreamParams = {
	model: string;
	messages: AIProviderMessage[];
	tools?: AIProviderToolDefinition[];
	systemPrompt?: string;
	thinking?: { type: string; budget_tokens: number };
	signal?: AbortSignal;
};

export type AIProviderMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string | AIProviderContentBlock[];
};

export type AIImageSource = {
	type: 'base64';
	data: string;
	media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
};

export type AIDocumentSource = {
	type: 'base64';
	data: string;
	media_type: 'application/pdf';
};

export type AIProviderContentBlock =
	| { type: 'text'; content: string }
	| { type: 'image'; source: AIImageSource }
	| { type: 'document'; source: AIDocumentSource; name?: string }
	| { type: 'tool_use'; id: string; name: string; input: unknown }
	| { type: 'tool_result'; tool_use_id: string; content: string };

export type AIProviderToolDefinition = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
};

export type AIProviderConfig = {
	stream: (params: AIProviderStreamParams) => AsyncIterable<AIChunk>;
};

/* ─── Tool types ─── */

export type AIToolDefinition = {
	description: string;
	input: Record<string, unknown>;
	handler: (input: unknown) => Promise<string> | string;
};

export type AIToolMap = Record<string, AIToolDefinition>;

/* ─── Wire protocol: Client → Server ─── */

export type AIAttachment = {
	data: string;
	media_type:
		| 'image/png'
		| 'image/jpeg'
		| 'image/gif'
		| 'image/webp'
		| 'application/pdf';
	name?: string;
};

export type AIMessageRequest = {
	type: 'message';
	content: string;
	conversationId?: string;
	attachments?: AIAttachment[];
};

export type AICancelRequest = {
	type: 'cancel';
	conversationId: string;
};

export type AIBranchRequest = {
	type: 'branch';
	messageId: string;
	content: string;
	conversationId: string;
};

export type AIClientMessage =
	| AIMessageRequest
	| AICancelRequest
	| AIBranchRequest;

/* ─── Wire protocol: Server → Client ─── */

export type AIChunkMessage = {
	type: 'chunk';
	content: string;
	messageId: string;
	conversationId: string;
};

export type AIThinkingMessage = {
	type: 'thinking';
	content: string;
	messageId: string;
	conversationId: string;
};

export type AIToolStatusMessage = {
	type: 'tool_status';
	name: string;
	status: 'running' | 'complete';
	input?: unknown;
	result?: string;
	messageId: string;
	conversationId: string;
};

export type AICompleteMessage = {
	type: 'complete';
	durationMs?: number;
	messageId: string;
	model?: string;
	conversationId: string;
	usage?: AIUsage;
};

export type AIImageMessage = {
	type: 'image';
	data: string;
	format: string;
	isPartial: boolean;
	revisedPrompt?: string;
	imageId?: string;
	messageId: string;
	conversationId: string;
};

export type AIErrorMessage = {
	type: 'error';
	message: string;
	messageId?: string;
	conversationId?: string;
};

export type AIServerMessage =
	| AIChunkMessage
	| AIThinkingMessage
	| AIToolStatusMessage
	| AIImageMessage
	| AICompleteMessage
	| AIErrorMessage;

/* ─── Conversation state ─── */

export type AIRole = 'user' | 'assistant' | 'system';

export type AIToolCall = {
	id: string;
	name: string;
	input: unknown;
	result?: string;
};

export type AIImageData = {
	data: string;
	format: string;
	isPartial: boolean;
	revisedPrompt?: string;
	imageId?: string;
};

export type AIMessage = {
	id: string;
	role: AIRole;
	content: string;
	conversationId: string;
	parentId?: string;
	attachments?: AIAttachment[];
	thinking?: string;
	toolCalls?: AIToolCall[];
	images?: AIImageData[];
	isStreaming?: boolean;
	model?: string;
	usage?: AIUsage;
	durationMs?: number;
	timestamp: number;
};

export type AIConversation = {
	id: string;
	title?: string;
	messages: AIMessage[];
	activeStreamAbort?: AbortController;
	createdAt: number;
	lastMessageAt?: number;
};

export type AIConversationSummary = {
	id: string;
	title: string;
	messageCount: number;
	createdAt: number;
	lastMessageAt?: number;
};

/* ─── Configuration ─── */

export type StreamAIOptions = {
	provider: AIProviderConfig;
	model: string;
	messages?: AIProviderMessage[];
	systemPrompt?: string;
	tools?: AIToolMap;
	thinking?: boolean | { budgetTokens: number };
	onChunk?: (chunk: AITextChunk) => AITextChunk | void;
	onComplete?: (fullResponse: string, usage?: AIUsage) => void;
	onToolUse?: (name: string, input: unknown, result: string) => void;
	onImage?: (imageData: AIImageData) => void;
	maxTurns?: number;
	signal?: AbortSignal;
};

/* ─── Client-side state ─── */

export type AIStreamState = {
	conversations: Map<string, AIConversation>;
	activeConversationId: string | null;
	isStreaming: boolean;
	error: string | null;
};

export type AIStoreAction =
	| {
			type: 'chunk';
			conversationId: string;
			messageId: string;
			content: string;
	  }
	| {
			type: 'thinking';
			conversationId: string;
			messageId: string;
			content: string;
	  }
	| {
			type: 'tool_status';
			conversationId: string;
			messageId: string;
			name: string;
			status: 'running' | 'complete';
			input?: unknown;
			result?: string;
	  }
	| {
			type: 'complete';
			conversationId: string;
			durationMs?: number;
			messageId: string;
			model?: string;
			usage?: AIUsage;
	  }
	| {
			type: 'image';
			conversationId: string;
			messageId: string;
			data: string;
			format: string;
			isPartial: boolean;
			revisedPrompt?: string;
			imageId?: string;
	  }
	| { type: 'error'; message: string }
	| {
			type: 'send';
			content: string;
			conversationId: string;
			messageId: string;
			attachments?: AIAttachment[];
	  }
	| { type: 'cancel' }
	| {
			type: 'branch';
			oldConversationId: string;
			newConversationId: string;
			fromMessageId: string;
	  }
	| { type: 'set_conversation'; conversationId: string };

/* ─── WebSocket interface ─── */

export type AIWebSocket = {
	send(data: string): void;
	readyState: number;
};

/* ─── Plugin config ─── */

export type AIChatPluginConfig = {
	path?: string;
	provider: (providerName: string) => AIProviderConfig;
	model?: string | ((providerName: string) => string);
	tools?:
		| AIToolMap
		| ((providerName: string, model: string) => AIToolMap | undefined);
	thinking?:
		| boolean
		| { budgetTokens: number }
		| ((
				providerName: string,
				model: string
		  ) => boolean | { budgetTokens: number } | undefined);
	systemPrompt?: string;
	maxTurns?: number;
	parseProvider?: (content: string) => {
		content: string;
		model?: string;
		providerName: string;
	};
	onComplete?: (
		conversationId: string,
		fullResponse: string,
		usage?: AIUsage
	) => void;
};

/* ─── Connection options ─── */

export type AIConnectionOptions = {
	protocols?: string[];
	reconnect?: boolean;
	pingInterval?: number;
	maxReconnectAttempts?: number;
};
