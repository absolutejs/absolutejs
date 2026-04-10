import { computed } from 'vue';
import { useRAGChunkPreview } from './useRAGChunkPreview';
import { useRAGCitations } from './useRAGCitations';
import { useRAGDocuments } from './useRAGDocuments';
import { useRAGEvaluate } from './useRAGEvaluate';
import { useRAGGrounding } from './useRAGGrounding';
import { useRAGIngest } from './useRAGIngest';
import { useRAGIndexAdmin } from './useRAGIndexAdmin';
import { useRAGOps } from './useRAGOps';
import { useRAGSearch } from './useRAGSearch';
import { useRAGSources } from './useRAGSources';
import { useRAGStatus } from './useRAGStatus';
import { useRAGWorkflow } from './useRAGWorkflow';

export type UseRAGOptions = {
	autoLoadOps?: boolean;
	autoLoadStatus?: boolean;
	conversationId?: string;
	streamPath?: string;
};

export const useRAG = (path: string, options: UseRAGOptions = {}) => {
	const search = useRAGSearch(path);
	const ingest = useRAGIngest(path);
	const status = useRAGStatus(path, options.autoLoadStatus ?? true);
	const ops = useRAGOps(path, options.autoLoadOps ?? true);
	const documents = useRAGDocuments(path);
	const chunkPreview = useRAGChunkPreview(path);
	const evaluate = useRAGEvaluate(path);
	const index = useRAGIndexAdmin(path);
	const workflow = useRAGWorkflow(
		options.streamPath ?? path,
		options.conversationId
	);
	const sources = useRAGSources(workflow.messages);
	const citations = useRAGCitations(sources.sources);
	const grounding = useRAGGrounding(
		computed(() => workflow.latestAssistantMessage.value?.content ?? ''),
		sources.sources
	);

	return {
		chunkPreview,
		citations,
		documents,
		evaluate,
		grounding,
		index,
		ingest,
		ops,
		search,
		sources,
		status,
		stream: workflow,
		workflow
	};
};

export type UseRAGResult = ReturnType<typeof useRAG>;
