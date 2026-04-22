import { computed, type Ref } from 'vue';
import type { RAGSource } from '../../../types/ai';
import {
	buildRAGCitations,
	buildRAGCitationReferenceMap,
	buildRAGSourceSummaries,
	buildRAGSourceGroups
} from '../../ai/rag/ui';

export const useRAGCitations = (sources: Ref<RAGSource[]>) => {
	const citations = computed(() => buildRAGCitations(sources.value));
	const citationReferenceMap = computed(() =>
		buildRAGCitationReferenceMap(citations.value)
	);
	const sourceGroups = computed(() => buildRAGSourceGroups(sources.value));
	const sourceSummaries = computed(() =>
		buildRAGSourceSummaries(sources.value)
	);
	const hasCitations = computed(() => citations.value.length > 0);

	return {
		citationReferenceMap,
		citations,
		hasCitations,
		sourceGroups,
		sourceSummaries
	};
};

export type UseRAGCitationsResult = ReturnType<typeof useRAGCitations>;
