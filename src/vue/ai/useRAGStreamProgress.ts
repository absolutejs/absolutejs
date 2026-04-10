import { computed, type Ref } from 'vue';
import type { AIMessage } from '../../../types/ai';
import { buildRAGStreamProgress } from '../../ai/rag/presentation';

export const useRAGStreamProgress = (params: {
	error: Ref<string | null>;
	isStreaming: Ref<boolean>;
	messages: Ref<AIMessage[]>;
}) =>
	computed(() =>
		buildRAGStreamProgress({
			error: params.error.value,
			isStreaming: params.isStreaming.value,
			messages: params.messages.value
		})
	);

export type UseRAGStreamProgressResult = ReturnType<
	typeof useRAGStreamProgress
>;
