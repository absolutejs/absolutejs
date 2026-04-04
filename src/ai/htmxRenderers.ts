import type { AIHTMXRenderConfig, AIUsage } from '../../types/ai';
import { MILLISECONDS_IN_A_SECOND } from '../constants';

export type ResolvedRenderers = Required<AIHTMXRenderConfig>;

const escapeHtml = (text: string) =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const defaultChunk = (_text: string, fullContent: string) =>
	`<div class="ai-content">${escapeHtml(fullContent)}</div>`;

const defaultThinking = (text: string) =>
	`<details class="ai-thinking"><summary>Thinking</summary><p>${escapeHtml(text)}</p></details>`;

const defaultToolRunning = (name: string, _input: unknown) =>
	`<div class="ai-tool running"><span class="tool-name">${escapeHtml(name)}</span> <span class="tool-status">Running...</span></div>`;

const defaultToolComplete = (name: string, result: string) =>
	`<details class="ai-tool complete"><summary>${escapeHtml(name)}</summary><pre>${escapeHtml(result)}</pre></details>`;

const defaultImage = (data: string, format: string, revisedPrompt?: string) =>
	`<figure class="ai-image">` +
	`<img src="data:image/${escapeHtml(format)};base64,${data}" alt="${revisedPrompt ? escapeHtml(revisedPrompt) : 'Generated image'}" />${
		revisedPrompt
			? `<figcaption>${escapeHtml(revisedPrompt)}</figcaption>`
			: ''
	}</figure>`;

const defaultComplete = (
	usage?: AIUsage,
	durationMs?: number,
	model?: string
) => {
	const parts: string[] = [];

	if (model) {
		parts.push(escapeHtml(model));
	}

	if (usage) {
		parts.push(`${usage.inputTokens}in / ${usage.outputTokens}out`);
	}

	if (durationMs !== undefined) {
		const seconds = (durationMs / MILLISECONDS_IN_A_SECOND).toFixed(1);
		parts.push(`${seconds}s`);
	}

	return parts.length > 0
		? `<div class="ai-usage">${parts.join(' · ')}</div>`
		: '';
};

const defaultError = (message: string) =>
	`<div class="ai-error">${escapeHtml(message)}</div>`;

export const resolveRenderers = (
	custom?: AIHTMXRenderConfig
): ResolvedRenderers => ({
	chunk: custom?.chunk ?? defaultChunk,
	complete: custom?.complete ?? defaultComplete,
	error: custom?.error ?? defaultError,
	image: custom?.image ?? defaultImage,
	thinking: custom?.thinking ?? defaultThinking,
	toolComplete: custom?.toolComplete ?? defaultToolComplete,
	toolRunning: custom?.toolRunning ?? defaultToolRunning
});
