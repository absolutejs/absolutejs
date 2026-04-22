import { computed, Injectable } from '@angular/core';
import {
	buildRAGAnswerWorkflowState,
	buildRAGStreamProgress
} from '../../ai/rag/workflowState';
import { AIStreamService } from './ai-stream.service';

@Injectable({ providedIn: 'root' })
export class RAGStreamService extends AIStreamService {
	connect(path: string, conversationId?: string) {
		const stream = super.connect(path, conversationId);

		const workflow = computed(() =>
			buildRAGAnswerWorkflowState({
				error: stream.error(),
				isStreaming: stream.isStreaming(),
				messages: stream.messages()
			})
		);
		const progress = computed(() =>
			buildRAGStreamProgress({
				error: stream.error(),
				isStreaming: stream.isStreaming(),
				messages: stream.messages()
			})
		);
		const latestAssistantMessage = computed(
			() => workflow().latestAssistantMessage
		);
		const sources = computed(() => workflow().sources);
		const sourceGroups = computed(() => workflow().sourceGroups);
		const citations = computed(() => workflow().citations);
		const sourceSummaries = computed(() => workflow().sourceSummaries);
		const citationReferenceMap = computed(
			() => workflow().citationReferenceMap
		);
		const retrieval = computed(() => workflow().retrieval);
		const groundedAnswer = computed(() => workflow().groundedAnswer);
		const groundingReferences = computed(
			() => workflow().groundingReferences
		);
		const hasRetrieved = computed(() => workflow().hasRetrieved);
		const hasSources = computed(() => workflow().hasSources);
		const isRetrieving = computed(() => workflow().isRetrieving);
		const isRetrieved = computed(() => workflow().isRetrieved);
		const isAnswerStreaming = computed(() => workflow().isAnswerStreaming);
		const isComplete = computed(() => workflow().isComplete);
		const isError = computed(() => workflow().isError);
		const isRunning = computed(() => workflow().isRunning);
		const stage = computed(() => workflow().stage);

		return {
			...stream,
			citations,
			citationReferenceMap,
			groundedAnswer,
			groundingReferences,
			hasRetrieved,
			hasSources,
			isAnswerStreaming,
			isComplete,
			isError,
			isRetrieved,
			isRetrieving,
			isRunning,
			latestAssistantMessage,
			progress,
			query: stream.send,
			retrieval,
			sourceGroups,
			sourceSummaries,
			sources,
			stage,
			workflow
		};
	}
}
