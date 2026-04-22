import { derived, type Readable } from 'svelte/store';
import type { RAGSource } from '../../../types/ai';
import {
	buildRAGCitations,
	buildRAGCitationReferenceMap,
	buildRAGSourceSummaries,
	buildRAGSourceGroups
} from '../../ai/rag/ui';

export const createRAGCitations = (sources: Readable<RAGSource[]>) => {
	const citations = derived(sources, ($sources) =>
		buildRAGCitations($sources)
	);
	const sourceGroups = derived(sources, ($sources) =>
		buildRAGSourceGroups($sources)
	);
	const sourceSummaries = derived(sources, ($sources) =>
		buildRAGSourceSummaries($sources)
	);
	const citationReferenceMap = derived(citations, ($citations) =>
		buildRAGCitationReferenceMap($citations)
	);
	const hasCitations = derived(
		citations,
		($citations) => $citations.length > 0
	);

	return {
		citationReferenceMap,
		citations,
		hasCitations,
		sourceGroups,
		sourceSummaries
	};
};

export type CreateRAGCitationsResult = ReturnType<typeof createRAGCitations>;
