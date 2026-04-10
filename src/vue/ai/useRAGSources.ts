import { computed, type Ref } from 'vue';
import type { AIMessage } from '../../../types/ai';
import {
	buildRAGCitationReferenceMap,
	buildRAGSourceGroups,
	buildRAGSourceSummaries,
	getLatestAssistantMessage,
	getLatestRAGSources
} from '../../ai/rag/presentation';

export const useRAGSources = (messages: Ref<AIMessage[]>) => {
	const latestAssistantMessage = computed(() =>
		getLatestAssistantMessage(messages.value)
	);
	const sources = computed(() => getLatestRAGSources(messages.value));
	const sourceGroups = computed(() => buildRAGSourceGroups(sources.value));
	const sourceSummaries = computed(() =>
		buildRAGSourceSummaries(sources.value)
	);
	const citationReferenceMap = computed(() =>
		buildRAGCitationReferenceMap(
			sourceSummaries.value.flatMap((summary) => summary.citations)
		)
	);
	const hasSources = computed(() => sources.value.length > 0);

	return {
		citationReferenceMap,
		hasSources,
		latestAssistantMessage,
		sourceGroups,
		sources,
		sourceSummaries
	};
};

export type UseRAGSourcesResult = ReturnType<typeof useRAGSources>;
