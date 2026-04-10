import { computed } from 'vue';
import { useRAGStream } from './useRAGStream';

export const useRAGWorkflow = (path: string, conversationId?: string) => {
	const stream = useRAGStream(path, conversationId);
	const state = computed(() => stream.workflow.value);

	return {
		...stream,
		state
	};
};

export type UseRAGWorkflowResult = ReturnType<typeof useRAGWorkflow>;
