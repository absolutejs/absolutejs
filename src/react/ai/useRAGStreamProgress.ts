import { useMemo } from 'react';
import type { AIMessage } from '../../../types/ai';
import {
	buildRAGStreamProgress,
	type RAGStreamProgress
} from '../../ai/rag/presentation';

export const useRAGStreamProgress = (params: {
	error: string | null;
	isStreaming: boolean;
	messages: AIMessage[];
}) =>
	useMemo(
		() =>
			buildRAGStreamProgress({
				error: params.error,
				isStreaming: params.isStreaming,
				messages: params.messages
			}),
		[params.error, params.isStreaming, params.messages]
	);

export type UseRAGStreamProgressResult = ReturnType<
	typeof useRAGStreamProgress
>;
export type { RAGStreamProgress };
