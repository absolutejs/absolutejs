import { useMemo } from 'react';
import type { RAGSource } from '../../../types/ai';
import {
	buildRAGCitations,
	buildRAGCitationReferenceMap,
	buildRAGSourceSummaries,
	buildRAGSourceGroups
} from '../../ai/rag/presentation';

export const useRAGCitations = (sources: RAGSource[]) => {
	const citations = useMemo(() => buildRAGCitations(sources), [sources]);
	const sourceGroups = useMemo(
		() => buildRAGSourceGroups(sources),
		[sources]
	);
	const sourceSummaries = useMemo(
		() => buildRAGSourceSummaries(sources),
		[sources]
	);
	const citationReferenceMap = useMemo(
		() => buildRAGCitationReferenceMap(citations),
		[citations]
	);

	return {
		citationReferenceMap,
		citations,
		hasCitations: citations.length > 0,
		sourceGroups,
		sourceSummaries
	};
};

export type UseRAGCitationsResult = ReturnType<typeof useRAGCitations>;
