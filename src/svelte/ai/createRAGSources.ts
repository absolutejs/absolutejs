import { derived, get, type Readable } from 'svelte/store';
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
	const sectionDiagnostics = derived(
		[sources, latestAssistantMessage],
		([$sources, $latestAssistantMessage]) =>
			buildRAGSectionRetrievalDiagnostics(
				$sources,
				$latestAssistantMessage?.retrievalTrace
			)
	);
	const chunkGraph = derived(sources, ($sources) =>
		buildRAGChunkGraph($sources)
	);
	const citationReferenceMap = derived(sourceSummaries, ($sourceSummaries) =>
		buildRAGCitationReferenceMap(
			$sourceSummaries.flatMap((summary) => summary.citations)
		)
	);
	const hasSources = derived(sources, ($sources) => $sources.length > 0);
	const navigationForChunk = (chunkId?: string | null) =>
		buildRAGChunkGraphNavigation(get(chunkGraph), chunkId ?? undefined);

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

export type CreateRAGSourcesResult = ReturnType<typeof createRAGSources>;
