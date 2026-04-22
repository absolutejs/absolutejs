import { useCallback, useMemo } from 'react';
import type { AIMessage } from '../../../types/ai';
import {
	getLatestAssistantMessage,
	getLatestRAGSources
} from '../../ai/rag/workflowState';
import {
	buildRAGCitationReferenceMap,
	buildRAGChunkGraph,
	buildRAGChunkGraphNavigation,
	buildRAGSectionRetrievalDiagnostics,
	buildRAGSourceGroups,
	buildRAGSourceSummaries
} from '../../ai/rag/ui';

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
	const sectionDiagnostics = useMemo(
		() =>
			buildRAGSectionRetrievalDiagnostics(
				sources,
				latestAssistantMessage?.retrievalTrace
			),
		[sources, latestAssistantMessage]
	);
	const chunkGraph = useMemo(() => buildRAGChunkGraph(sources), [sources]);
	const citationReferenceMap = useMemo(
		() =>
			buildRAGCitationReferenceMap(
				sourceSummaries.flatMap((summary) => summary.citations)
			),
		[sourceSummaries]
	);
	const navigationForChunk = useCallback(
		(chunkId?: string | null) =>
			buildRAGChunkGraphNavigation(chunkGraph, chunkId ?? undefined),
		[chunkGraph]
	);

	return {
		citationReferenceMap,
		chunkGraph,
		hasSources: sources.length > 0,
		latestAssistantMessage,
		navigationForChunk,
		sectionDiagnostics,
		sourceGroups,
		sources,
		sourceSummaries
	};
};

export type UseRAGSourcesResult = ReturnType<typeof useRAGSources>;
