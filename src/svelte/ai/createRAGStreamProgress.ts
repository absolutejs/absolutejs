import { derived, type Readable } from 'svelte/store';
import type { AIMessage } from '../../../types/ai';
import { buildRAGStreamProgress } from '../../ai/rag/workflowState';

export const createRAGStreamProgress = (params: {
	error: Readable<string | null>;
	isStreaming: Readable<boolean>;
	messages: Readable<AIMessage[]>;
}) =>
	derived(
		[params.error, params.isStreaming, params.messages],
		([$error, $isStreaming, $messages]) =>
			buildRAGStreamProgress({
				error: $error,
				isStreaming: $isStreaming,
				messages: $messages
			})
	);

export type CreateRAGStreamProgressResult = ReturnType<
	typeof createRAGStreamProgress
>;
