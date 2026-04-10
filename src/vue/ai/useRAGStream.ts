import { computed } from 'vue';
import type { AIAttachment } from '../../../types/ai';
import { buildRAGAnswerWorkflowState } from '../../ai/rag/presentation';
import { useAIStream } from './useAIStream';
import { useRAGStreamProgress } from './useRAGStreamProgress';

export const useRAGStream = (path: string, conversationId?: string) => {
	const stream = useAIStream(path, conversationId);

	const workflow = computed(() =>
		buildRAGAnswerWorkflowState({
			error: stream.error.value,
			isStreaming: stream.isStreaming.value,
			messages: stream.messages.value
		})
	);
	const progress = useRAGStreamProgress({
		error: stream.error,
		isStreaming: stream.isStreaming,
		messages: stream.messages
	});

	const query = (content: string, attachments?: AIAttachment[]) => {
		stream.send(content, attachments);
	};

	const hasRetrieved = computed(() => workflow.value.hasRetrieved);
	const isRetrieving = computed(() => workflow.value.isRetrieving);
	const isRetrieved = computed(() => workflow.value.isRetrieved);
	const isAnswerStreaming = computed(() => workflow.value.isAnswerStreaming);
	const isComplete = computed(() => workflow.value.isComplete);
	const hasSources = computed(() => workflow.value.hasSources);

	return {
		...stream,
		citationReferenceMap: computed(
			() => workflow.value.citationReferenceMap
		),
		citations: computed(() => workflow.value.citations),
		coverage: computed(() => workflow.value.coverage),
		groundedAnswer: computed(() => workflow.value.groundedAnswer),
		groundingReferences: computed(() => workflow.value.groundingReferences),
		hasGrounding: computed(() => workflow.value.hasGrounding),
		hasRetrieved,
		hasSources,
		isAnswerStreaming,
		isComplete,
		isError: computed(() => workflow.value.isError),
		isRetrieved,
		isRetrieving,
		isRunning: computed(() => workflow.value.isRunning),
		latestAssistantMessage: computed(
			() => workflow.value.latestAssistantMessage
		),
		progress,
		query,
		retrieval: computed(() => workflow.value.retrieval),
		sourceGroups: computed(() => workflow.value.sourceGroups),
		sourceSummaries: computed(() => workflow.value.sourceSummaries),
		sources: computed(() => workflow.value.sources),
		stage: computed(() => workflow.value.stage),
		ungroundedReferenceNumbers: computed(
			() => workflow.value.ungroundedReferenceNumbers
		),
		workflow
	};
};

export type UseRAGStreamResult = ReturnType<typeof useRAGStream>;
