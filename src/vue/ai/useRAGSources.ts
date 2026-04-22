import { computed, type Ref } from 'vue';
import type { AIMessage } from '../../../types/ai';
import {
	buildRAGCitationReferenceMap,
	buildRAGChunkGraph,
	buildRAGChunkGraphNavigation,
	buildRAGSectionRetrievalDiagnostics,
	buildRAGSourceGroups,
	buildRAGSourceSummaries
} from '../../ai/rag/ui';
import {
	getLatestAssistantMessage,
	getLatestRAGSources
} from '../../ai/rag/workflowState';

export const useRAGSources = (messages: Ref<AIMessage[]>) => {
	const latestAssistantMessage = computed(() =>
		getLatestAssistantMessage(messages.value)
	);
	const sources = computed(() => getLatestRAGSources(messages.value));
	const sourceGroups = computed(() => buildRAGSourceGroups(sources.value));
	const sourceSummaries = computed(() =>
		buildRAGSourceSummaries(sources.value)
	);
	const sectionDiagnostics = computed(() =>
		buildRAGSectionRetrievalDiagnostics(
			sources.value,
			latestAssistantMessage.value?.retrievalTrace
		)
	);
	const chunkGraph = computed(() => buildRAGChunkGraph(sources.value));
	const citationReferenceMap = computed(() =>
		buildRAGCitationReferenceMap(
			sourceSummaries.value.flatMap((summary) => summary.citations)
		)
	);
	const hasSources = computed(() => sources.value.length > 0);
	const navigationForChunk = (chunkId?: string | null) =>
		buildRAGChunkGraphNavigation(chunkGraph.value, chunkId ?? undefined);

	return {
		citationReferenceMap,
		chunkGraph,
		hasSources,
		latestAssistantMessage,
		navigationForChunk,
		sectionDiagnostics,
		sourceGroups,
		sources,
		sourceSummaries
	};
};

export type UseRAGSourcesResult = ReturnType<typeof useRAGSources>;
