import type { AIAttachment, RAGAnswerWorkflowState } from '../../../types/ai';
import { buildRAGAnswerWorkflowState } from '../rag/presentation';
import { createAIStream } from './createAIStream';

export const createRAGAnswerWorkflow = (
	path: string,
	conversationId?: string
) => {
	const stream = createAIStream(path, conversationId);

	const getState = (): RAGAnswerWorkflowState =>
		buildRAGAnswerWorkflowState({
			error: stream.error,
			isStreaming: stream.isStreaming,
			messages: stream.messages
		});

	const query = (content: string, attachments?: AIAttachment[]) => {
		stream.send(content, attachments);
	};

	return {
		...stream,
		get state() {
			return getState();
		},
		get latestAssistantMessage() {
			return getState().latestAssistantMessage;
		},
		get retrieval() {
			return getState().retrieval;
		},
		get sources() {
			return getState().sources;
		},
		get sourceGroups() {
			return getState().sourceGroups;
		},
		get sourceSummaries() {
			return getState().sourceSummaries;
		},
		get citations() {
			return getState().citations;
		},
		get citationReferenceMap() {
			return getState().citationReferenceMap;
		},
		get groundingReferences() {
			return getState().groundingReferences;
		},
		get groundedAnswer() {
			return getState().groundedAnswer;
		},
		get stage() {
			return getState().stage;
		},
		get isRunning() {
			return getState().isRunning;
		},
		get isRetrieving() {
			return getState().isRetrieving;
		},
		get isRetrieved() {
			return getState().isRetrieved;
		},
		get isAnswerStreaming() {
			return getState().isAnswerStreaming;
		},
		get isComplete() {
			return getState().isComplete;
		},
		get isError() {
			return getState().isError;
		},
		get hasSources() {
			return getState().hasSources;
		},
		get hasRetrieved() {
			return getState().hasRetrieved;
		},
		query
	};
};

export type RAGAnswerWorkflow = ReturnType<typeof createRAGAnswerWorkflow>;
