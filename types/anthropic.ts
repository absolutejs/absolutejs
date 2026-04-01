export type AnthropicConfig = {
	apiKey: string;
	baseUrl?: string;
};

export type AnthropicMessage = {
	content: string | Array<Record<string, unknown>>;
	role: 'user' | 'assistant';
};

export type AnthropicSSEState = {
	buffer: string;
	currentToolId: string;
	currentToolName: string;
	isThinkingBlock: boolean;
	thinkingSignature: string;
	toolInputJson: string;
	usage: { inputTokens: number; outputTokens: number } | undefined;
};
