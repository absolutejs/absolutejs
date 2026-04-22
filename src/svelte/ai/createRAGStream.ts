import { derived, readable } from 'svelte/store';
import type { AIAttachment } from '../../../types/ai';
import { buildRAGAnswerWorkflowState } from '../../ai/rag/workflowState';
import { createAIStream } from './createAIStream';
import { createRAGStreamProgress } from './createRAGStreamProgress';

export const createRAGStream = (path: string, conversationId?: string) => {
	const stream = createAIStream(path, conversationId);

	const messages = readable(stream.messages, (set) => {
		set(stream.messages);

		return stream.subscribe(() => set(stream.messages));
	});
	const error = readable(stream.error, (set) => {
		set(stream.error);

		return stream.subscribe(() => set(stream.error));
	});
	const isStreaming = readable(stream.isStreaming, (set) => {
		set(stream.isStreaming);

		return stream.subscribe(() => set(stream.isStreaming));
	});

	const workflow = derived(
		[messages, error, isStreaming],
		([$messages, $error, $isStreaming]) =>
			buildRAGAnswerWorkflowState({
				error: $error,
				isStreaming: $isStreaming,
				messages: $messages
			})
	);
	const progress = createRAGStreamProgress({
		error,
		isStreaming,
		messages
	});
	const latestAssistantMessage = derived(
		workflow,
		($workflow) => $workflow.latestAssistantMessage
	);
	const sources = derived(workflow, ($workflow) => $workflow.sources);
	const sourceGroups = derived(
		workflow,
		($workflow) => $workflow.sourceGroups
	);
	const citations = derived(workflow, ($workflow) => $workflow.citations);
	const sourceSummaries = derived(
		workflow,
		($workflow) => $workflow.sourceSummaries
	);
	const retrieval = derived(workflow, ($workflow) => $workflow.retrieval);
	const groundedAnswer = derived(
		workflow,
		($workflow) => $workflow.groundedAnswer
	);
	const groundingReferences = derived(
		workflow,
		($workflow) => $workflow.groundingReferences
	);
	const stage = derived(workflow, ($workflow) => $workflow.stage);
	const hasRetrieved = derived(
		workflow,
		($workflow) => $workflow.hasRetrieved
	);
	const hasSources = derived(workflow, ($workflow) => $workflow.hasSources);
	const isRetrieving = derived(
		workflow,
		($workflow) => $workflow.isRetrieving
	);
	const isRetrieved = derived(workflow, ($workflow) => $workflow.isRetrieved);
	const isAnswerStreaming = derived(
		workflow,
		($workflow) => $workflow.isAnswerStreaming
	);
	const isComplete = derived(workflow, ($workflow) => $workflow.isComplete);

	const query = (content: string, attachments?: AIAttachment[]) => {
		stream.send(content, attachments);
	};

	return {
		...stream,
		citations,
		groundedAnswer,
		groundingReferences,
		error,
		hasRetrieved,
		hasSources,
		isAnswerStreaming,
		isComplete,
		isRetrieved,
		isRetrieving,
		isStreaming,
		latestAssistantMessage,
		messages,
		progress,
		query,
		retrieval,
		sourceGroups,
		sourceSummaries,
		sources,
		stage,
		workflow
	};
};

export type CreateRAGStreamResult = ReturnType<typeof createRAGStream>;
