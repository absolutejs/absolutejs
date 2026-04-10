import { derived, type Readable } from 'svelte/store';
import type { AIMessage } from '../../../types/ai';
import {
	buildRAGCitationReferenceMap,
	buildRAGSourceGroups,
	buildRAGSourceSummaries,
	getLatestAssistantMessage,
	getLatestRAGSources
} from '../../ai/rag/presentation';

export const createRAGSources = (messages: Readable<AIMessage[]>) => {
	const latestAssistantMessage = derived(messages, ($messages) =>
		getLatestAssistantMessage($messages)
	);
	const sources = derived(messages, ($messages) =>
		getLatestRAGSources($messages)
	);
	const sourceGroups = derived(sources, ($sources) =>
		buildRAGSourceGroups($sources)
	);
	const sourceSummaries = derived(sources, ($sources) =>
		buildRAGSourceSummaries($sources)
	);
	const citationReferenceMap = derived(sourceSummaries, ($sourceSummaries) =>
		buildRAGCitationReferenceMap(
			$sourceSummaries.flatMap((summary) => summary.citations)
		)
	);
	const hasSources = derived(sources, ($sources) => $sources.length > 0);

	return {
		citationReferenceMap,
		hasSources,
		latestAssistantMessage,
		sourceGroups,
		sources,
		sourceSummaries
	};
};

export type CreateRAGSourcesResult = ReturnType<typeof createRAGSources>;
