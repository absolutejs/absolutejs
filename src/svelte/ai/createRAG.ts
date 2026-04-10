import { createRAGChunkPreview } from './createRAGChunkPreview';
import { createRAGCitations } from './createRAGCitations';
import { createRAGDocuments } from './createRAGDocuments';
import { createRAGEvaluate } from './createRAGEvaluate';
import { createRAGGrounding } from './createRAGGrounding';
import { createRAGIngest } from './createRAGIngest';
import { createRAGIndexAdmin } from './createRAGIndexAdmin';
import { createRAGOps } from './createRAGOps';
import { createRAGSearch } from './createRAGSearch';
import { createRAGSources } from './createRAGSources';
import { createRAGStatus } from './createRAGStatus';
import { createRAGWorkflow } from './createRAGWorkflow';
import { derived } from 'svelte/store';

export type CreateRAGOptions = {
	autoLoadOps?: boolean;
	autoLoadStatus?: boolean;
	conversationId?: string;
	streamPath?: string;
};

export const createRAG = (path: string, options: CreateRAGOptions = {}) => {
	const search = createRAGSearch(path);
	const ingest = createRAGIngest(path);
	const status = createRAGStatus(path, options.autoLoadStatus ?? true);
	const ops = createRAGOps(path, options.autoLoadOps ?? true);
	const documents = createRAGDocuments(path);
	const chunkPreview = createRAGChunkPreview(path);
	const evaluate = createRAGEvaluate(path);
	const index = createRAGIndexAdmin(path);
	const workflow = createRAGWorkflow(
		options.streamPath ?? path,
		options.conversationId
	);
	const sources = createRAGSources(workflow.messages);
	const citations = createRAGCitations(sources.sources);
	const grounding = createRAGGrounding(
		derived(
			workflow.latestAssistantMessage,
			($latestAssistantMessage) => $latestAssistantMessage?.content ?? ''
		),
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

export type CreateRAGResult = ReturnType<typeof createRAG>;
