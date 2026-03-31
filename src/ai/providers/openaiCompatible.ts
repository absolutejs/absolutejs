import { openai } from './openai';

/**
 * Creates a provider for any OpenAI-compatible API.
 * Many providers (Google, xAI, DeepSeek, Mistral, etc.)
 * expose OpenAI-compatible chat completion endpoints.
 */
export const alibaba = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode'
	});
export const deepseek = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://api.deepseek.com'
	});
export const google = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
	});
export const meta = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://api.llama.com/compat/v1'
	});
export const mistralai = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://api.mistral.ai'
	});
export const moonshot = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://api.moonshot.ai'
	});
export const openaiCompatible = (config: { apiKey: string; baseUrl: string }) =>
	openai({ apiKey: config.apiKey, baseUrl: config.baseUrl });
export const xai = (config: { apiKey: string }) =>
	openaiCompatible({
		apiKey: config.apiKey,
		baseUrl: 'https://api.x.ai'
	});
