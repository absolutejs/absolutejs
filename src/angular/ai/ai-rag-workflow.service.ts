import { computed, Injectable } from '@angular/core';
import { RAGStreamService } from './ai-rag-stream.service';

@Injectable({ providedIn: 'root' })
export class RAGWorkflowService extends RAGStreamService {
	connect(path: string, conversationId?: string) {
		const stream = super.connect(path, conversationId);

		return {
			...stream,
			state: computed(() => stream.workflow())
		};
	}
}
