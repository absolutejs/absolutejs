import { derived } from 'svelte/store';
import { createRAGStream } from './createRAGStream';

export const createRAGWorkflow = (path: string, conversationId?: string) => {
	const stream = createRAGStream(path, conversationId);
	const state = derived(stream.workflow, ($workflow) => $workflow);

	return {
		...stream,
		state
	};
};

export type CreateRAGWorkflowResult = ReturnType<typeof createRAGWorkflow>;
