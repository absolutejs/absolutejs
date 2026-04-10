import { useCallback, useMemo } from 'react';
import type { AIAttachment } from '../../../types/ai';
import { buildRAGAnswerWorkflowState } from '../../ai/rag/presentation';
import { useAIStream } from './useAIStream';

export const useRAGStream = (path?: string, conversationId?: string) => {
	const stream = useAIStream(path, conversationId);

	const workflow = useMemo(
		() =>
			buildRAGAnswerWorkflowState({
				error: stream.error,
				isStreaming: stream.isStreaming,
				messages: stream.messages
			}),
		[stream.error, stream.isStreaming, stream.messages]
	);
	const progress = useMemo(
		() => ({
			conversationId: workflow.latestAssistantMessage?.conversationId,
			hasContent:
				typeof workflow.latestAssistantMessage?.content === 'string' &&
				workflow.latestAssistantMessage.content.length > 0,
			hasRetrieved: workflow.hasRetrieved,
			hasSources: workflow.hasSources,
			hasThinking:
				typeof workflow.latestAssistantMessage?.thinking === 'string' &&
				workflow.latestAssistantMessage.thinking.length > 0,
			hasToolCalls:
				(workflow.latestAssistantMessage?.toolCalls?.length ?? 0) > 0,
			isComplete: workflow.isComplete,
			isError: workflow.isError,
			isIdle: workflow.isIdle,
			isRetrieved: workflow.isRetrieved,
			isRetrieving: workflow.isRetrieving,
			isStreaming: workflow.isAnswerStreaming,
			isSubmitting: workflow.isSubmitting,
			latestMessage: workflow.latestAssistantMessage,
			messageId: workflow.latestAssistantMessage?.id,
			retrievalDurationMs: workflow.retrievalDurationMs,
			retrievalStartedAt: workflow.retrievalStartedAt,
			retrievedAt: workflow.retrievedAt,
			sourceCount: workflow.sources.length,
			stage: workflow.stage
		}),
		[workflow]
	);

	const query = useCallback(
		(content: string, attachments?: AIAttachment[]) => {
			stream.send(content, attachments);
		},
		[stream]
	);

	return {
		...stream,
		citationReferenceMap: workflow.citationReferenceMap,
		citations: workflow.citations,
		coverage: workflow.coverage,
		groundedAnswer: workflow.groundedAnswer,
		groundingReferences: workflow.groundingReferences,
		hasGrounding: workflow.hasGrounding,
		hasRetrieved: workflow.hasRetrieved,
		hasSources: workflow.hasSources,
		isAnswerStreaming: workflow.isAnswerStreaming,
		isComplete: workflow.isComplete,
		isError: workflow.isError,
		isRetrieved: workflow.isRetrieved,
		isRetrieving: workflow.isRetrieving,
		isRunning: workflow.isRunning,
		latestAssistantMessage: workflow.latestAssistantMessage,
		progress,
		query,
		retrieval: workflow.retrieval,
		sourceGroups: workflow.sourceGroups,
		sourceSummaries: workflow.sourceSummaries,
		sources: workflow.sources,
		stage: workflow.stage,
		ungroundedReferenceNumbers: workflow.ungroundedReferenceNumbers,
		workflow
	};
};

export type UseRAGStreamResult = ReturnType<typeof useRAGStream>;
