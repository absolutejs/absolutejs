import { useMemo } from 'react';
import type { AIMessage } from '../../../types/ai';
import {
	buildRAGCitationReferenceMap,
	buildRAGSourceGroups,
	buildRAGSourceSummaries,
	getLatestAssistantMessage,
	getLatestRAGSources
} from '../../ai/rag/presentation';

export const useRAGSources = (messages: AIMessage[]) => {
	const latestAssistantMessage = useMemo(
		() => getLatestAssistantMessage(messages),
		[messages]
	);
	const sources = useMemo(() => getLatestRAGSources(messages), [messages]);
	const sourceGroups = useMemo(
		() => buildRAGSourceGroups(sources),
		[sources]
	);
	const sourceSummaries = useMemo(
		() => buildRAGSourceSummaries(sources),
		[sources]
	);
	const citationReferenceMap = useMemo(
		() =>
			buildRAGCitationReferenceMap(
				sourceSummaries.flatMap((summary) => summary.citations)
			),
		[sourceSummaries]
	);

	return {
		citationReferenceMap,
		hasSources: sources.length > 0,
		latestAssistantMessage,
		sourceGroups,
		sources,
		sourceSummaries
	};
};

export type UseRAGSourcesResult = ReturnType<typeof useRAGSources>;
