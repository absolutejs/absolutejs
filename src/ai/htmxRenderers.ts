import type {
	AIHTMXRenderConfig,
	AIUsage,
	RAGRetrievalTrace,
	RAGSource
} from '../../types/ai';
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

const defaultMessageStart = ({
	cancelUrl,
	content,
	messageId,
	sseUrl
}: {
	conversationId: string;
	messageId: string;
	content: string;
	sseUrl: string;
	cancelUrl: string;
}) =>
	`<div id="msg-${messageId}" class="message user">` +
	`<div>${escapeHtml(content)}</div>` +
	`</div>` +
	`<div id="response-${messageId}" ` +
	`hx-ext="sse" ` +
	`sse-connect="${escapeHtml(sseUrl)}" ` +
	`hx-swap="innerHTML">` +
	`<div id="sse-retrieval-${messageId}" sse-swap="retrieval" hx-swap="innerHTML"></div>` +
	`<div id="sse-sources-${messageId}" sse-swap="sources" hx-swap="innerHTML"></div>` +
	`<div id="sse-content-${messageId}" sse-swap="content" hx-swap="innerHTML"></div>` +
	`<div id="sse-thinking-${messageId}" sse-swap="thinking" hx-swap="innerHTML"></div>` +
	`<div id="sse-tools-${messageId}" sse-swap="tools" hx-swap="innerHTML"></div>` +
	`<div id="sse-images-${messageId}" sse-swap="images" hx-swap="innerHTML"></div>` +
	`<div id="sse-status-${messageId}" sse-swap="status" hx-swap="innerHTML">` +
	`<button type="button" class="ai-cancel-button" hx-post="${escapeHtml(cancelUrl)}" hx-target="#sse-status-${messageId}" hx-swap="innerHTML">Cancel</button>` +
	`</div>` +
	`</div>`;

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

const defaultCanceled = () => `<div class="ai-canceled">Canceled.</div>`;

const defaultRAGRetrieving = () =>
	`<div class="ai-retrieving">Retrieving sources...</div>`;

const renderTraceSummary = (trace?: RAGRetrievalTrace) => {
	if (!trace) {
		return '';
	}

	return (
		`<div class="ai-trace-summary">` +
		`Mode: ${escapeHtml(trace.mode)} · Final: ${trace.resultCounts.final} · Vector: ${trace.resultCounts.vector} · Lexical: ${trace.resultCounts.lexical}` +
		`</div>`
	);
};

const defaultRAGRetrieved = (
	sources: RAGSource[],
	input?: { trace?: RAGRetrievalTrace }
) =>
	sources.length === 0
		? ''
		: `<div class="ai-sources">` +
			`<h4>Citations</h4>` +
			renderTraceSummary(input?.trace) +
			`<ul>` +
			`${sources
				.map(
					(source) =>
						`<li>[${source.chunkId}] ${escapeHtml(source.text)}${
							source.source
								? ` (${escapeHtml(source.source)})`
								: ''
						}</li>`
				)
				.join('')}` +
			`</ul>` +
			`</div>`;

export const resolveRenderers = (
	custom?: AIHTMXRenderConfig
): ResolvedRenderers => ({
	chunk: custom?.chunk ?? defaultChunk,
	messageStart: custom?.messageStart ?? defaultMessageStart,
	complete: custom?.complete ?? defaultComplete,
	canceled: custom?.canceled ?? defaultCanceled,
	error: custom?.error ?? defaultError,
	image: custom?.image ?? defaultImage,
	ragRetrieving: custom?.ragRetrieving ?? defaultRAGRetrieving,
	ragRetrieved: custom?.ragRetrieved ?? defaultRAGRetrieved,
	thinking: custom?.thinking ?? defaultThinking,
	toolComplete: custom?.toolComplete ?? defaultToolComplete,
	toolRunning: custom?.toolRunning ?? defaultToolRunning
});
