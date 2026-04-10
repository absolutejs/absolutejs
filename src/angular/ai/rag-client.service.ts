import { Injectable } from '@angular/core';
import type {
	RAGEvaluationInput,
	RAGDocumentChunk,
	RAGDocumentIngestInput,
	RAGDocumentUploadIngestInput,
	RAGDocumentUrlIngestInput,
	RAGSearchRequest,
	RAGSyncRunOptions
} from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';

@Injectable({ providedIn: 'root' })
export class RAGClientService {
	private clients = new Map<string, ReturnType<typeof createRAGClient>>();

	private client(path: string) {
		const existing = this.clients.get(path);
		if (existing) {
			return existing;
		}

		const created = createRAGClient({ path });
		this.clients.set(path, created);

		return created;
	}

	ingest(path: string, chunks: RAGDocumentChunk[]) {
		return this.client(path).ingest(chunks);
	}

	ingestDocuments(path: string, input: RAGDocumentIngestInput) {
		return this.client(path).ingestDocuments(input);
	}

	ingestUrls(path: string, input: RAGDocumentUrlIngestInput) {
		return this.client(path).ingestUrls(input);
	}

	ingestUploads(path: string, input: RAGDocumentUploadIngestInput) {
		return this.client(path).ingestUploads(input);
	}

	search(path: string, input: RAGSearchRequest) {
		return this.client(path).search(input);
	}

	evaluate(path: string, input: RAGEvaluationInput) {
		return this.client(path).evaluate(input);
	}

	status(path: string) {
		return this.client(path).status();
	}

	ops(path: string) {
		return this.client(path).ops();
	}

	syncSources(path: string) {
		return this.client(path).syncSources();
	}

	syncAllSources(path: string, options?: RAGSyncRunOptions) {
		return this.client(path).syncAllSources(options);
	}

	syncSource(path: string, id: string, options?: RAGSyncRunOptions) {
		return this.client(path).syncSource(id, options);
	}

	documents(path: string, kind?: string) {
		return this.client(path).documents(kind);
	}

	documentChunks(path: string, id: string) {
		return this.client(path).documentChunks(id);
	}

	createDocument(
		path: string,
		input: RAGDocumentIngestInput['documents'][number]
	) {
		return this.client(path).createDocument(input);
	}

	deleteDocument(path: string, id: string) {
		return this.client(path).deleteDocument(id);
	}

	reseed(path: string) {
		return this.client(path).reseed();
	}

	reset(path: string) {
		return this.client(path).reset();
	}

	reindexDocument(path: string, id: string) {
		return this.client(path).reindexDocument(id);
	}

	reindexSource(path: string, source: string) {
		return this.client(path).reindexSource(source);
	}

	backends(path: string) {
		return this.client(path).backends();
	}

	clearIndex(path: string) {
		return this.client(path).clearIndex();
	}
}
