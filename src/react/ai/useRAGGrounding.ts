import { useMemo } from 'react';
import type { RAGSource } from '../../../types/ai';
import {
	buildRAGGroundedAnswer,
	buildRAGGroundingReferences
} from '../../ai/rag/ui';

export const useRAGGrounding = (content: string, sources: RAGSource[]) => {
	const groundedAnswer = useMemo(
		() => buildRAGGroundedAnswer(content, sources),
		[content, sources]
	);
	const references = useMemo(
		() => buildRAGGroundingReferences(sources),
		[sources]
	);

	return {
		coverage: groundedAnswer.coverage,
		groundedAnswer,
		hasCitations: groundedAnswer.hasCitations,
		hasGrounding: references.length > 0,
		references,
		ungroundedReferenceNumbers: groundedAnswer.ungroundedReferenceNumbers
	};
};

export type UseRAGGroundingResult = ReturnType<typeof useRAGGrounding>;
