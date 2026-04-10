import { useMemo } from 'react';
import { useRAGStream } from './useRAGStream';

export const useRAGWorkflow = (path?: string, conversationId?: string) => {
	const stream = useRAGStream(path, conversationId);

	return useMemo(
		() => ({
			...stream,
			state: stream.workflow
		}),
		[stream]
	);
};

export type UseRAGWorkflowResult = ReturnType<typeof useRAGWorkflow>;
