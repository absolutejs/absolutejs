import { afterEach, describe, expect, it, mock } from 'bun:test';
import { computed, signal } from '@angular/core';
import { get, readable, type Readable } from 'svelte/store';

const aiIndexPath = new URL('../../../../src/ai/index.ts', import.meta.url)
	.href;
const aiClientIndexPath = new URL(
	'../../../../src/ai/client/index.ts',
	import.meta.url
).href;
const reactWorkflowPath = new URL(
	'../../../../src/react/ai/useRAGWorkflow.ts',
	import.meta.url
).href;
const reactStreamPath = new URL(
	'../../../../src/react/ai/useRAGStream.ts',
	import.meta.url
).href;
const vueWorkflowPath = new URL(
	'../../../../src/vue/ai/useRAGWorkflow.ts',
	import.meta.url
).href;
const vueStreamPath = new URL(
	'../../../../src/vue/ai/useRAGStream.ts',
	import.meta.url
).href;
const svelteWorkflowPath = new URL(
	'../../../../src/svelte/ai/createRAGWorkflow.ts',
	import.meta.url
).href;
const svelteStreamPath = new URL(
	'../../../../src/svelte/ai/createRAGStream.ts',
	import.meta.url
).href;

afterEach(() => {
	mock.restore();
});

describe('RAG public export contract', () => {
	it('keeps workflow names canonical on root AI exports', async () => {
		const ai = await import(aiIndexPath);

		expect(ai.createRAGWorkflow).toBeFunction();
		expect(ai.createRAGStream).toBeFunction();
		expect('createRAGAnswerWorkflow' in ai).toBe(false);
	});

	it('keeps workflow names canonical on AI client exports', async () => {
		const aiClient = await import(aiClientIndexPath);

		expect(aiClient.createRAGWorkflow).toBeFunction();
		expect(aiClient.createRAGStream).toBeFunction();
		expect('createRAGAnswerWorkflow' in aiClient).toBe(false);
	});
});

describe('RAG workflow wrapper parity', () => {
	it('react workflow adds state on top of the stream contract', async () => {
		const workflowState = { stage: 'complete', sources: ['a'] };
		const fakeStream = {
			isStreaming: false,
			messages: [],
			send: mock(() => {}),
			workflow: workflowState
		};

		mock.module(reactStreamPath, () => ({
			useRAGStream: () => fakeStream
		}));

		const React = await import('react');
		const { renderToStaticMarkup } = await import('react-dom/server');
		const { useRAGWorkflow } = await import(reactWorkflowPath);

		let result: ReturnType<typeof useRAGWorkflow> | undefined;

		const TestComponent = () => {
			result = useRAGWorkflow('/rag', 'conv-1');
			return React.createElement('div');
		};

		renderToStaticMarkup(React.createElement(TestComponent));

		expect(result).toBeDefined();
		expect(result?.workflow).toBe(workflowState);
		expect(result?.state).toBe(workflowState);
		expect('state' in fakeStream).toBe(false);
	});

	it('vue workflow adds state on top of the stream contract', async () => {
		const { ref } = await import('vue');
		const workflowState = { stage: 'retrieved', sources: ['a'] };
		const fakeStream = {
			error: ref<string | null>(null),
			isStreaming: ref(false),
			messages: ref([]),
			send: mock(() => {}),
			workflow: ref(workflowState)
		};

		mock.module(vueStreamPath, () => ({
			useRAGStream: () => fakeStream
		}));

		const { useRAGWorkflow } = await import(vueWorkflowPath);
		const result = useRAGWorkflow('/rag', 'conv-1');

		expect(result.workflow.value).toEqual(workflowState);
		expect(result.state.value).toEqual(workflowState);
		expect(result.state.value).toEqual(result.workflow.value);
		expect('state' in fakeStream).toBe(false);
	});

	it('svelte workflow adds state on top of the stream contract', async () => {
		const workflowState = { stage: 'streaming', sources: ['a'] };
		const fakeStream = {
			messages: readable([]),
			send: mock(() => {}),
			subscribe: mock(() => () => {}),
			workflow: readable(workflowState)
		};

		mock.module(svelteStreamPath, () => ({
			createRAGStream: () => fakeStream
		}));

		const { createRAGWorkflow } = await import(svelteWorkflowPath);
		const result = createRAGWorkflow('/rag', 'conv-1');

		expect(get(result.workflow as Readable<typeof workflowState>)).toBe(
			workflowState
		);
		expect(get(result.state as Readable<typeof workflowState>)).toBe(
			workflowState
		);
		expect('state' in fakeStream).toBe(false);
	});

	it('angular workflow adds state on top of the stream contract', async () => {
		const baseStream = {
			branch: mock(() => {}),
			cancel: mock(() => {}),
			error: signal<string | null>(null),
			isStreaming: signal(false),
			messages: signal([
				{
					content: 'Grounded answer [1]',
					conversationId: 'conv-1',
					id: 'assistant-1',
					role: 'assistant' as const,
					sources: [
						{
							chunkId: 'chunk-1',
							score: 0.91,
							source: 'docs/guide.md',
							text: 'AbsoluteJS keeps workflow naming explicit.'
						}
					],
					timestamp: 1
				}
			]),
			send: mock(() => {})
		};
		const { AIStreamService } = await import(
			'../../../../src/angular/ai/ai-stream.service'
		);
		const originalConnect = AIStreamService.prototype.connect;
		AIStreamService.prototype.connect = function () {
			return baseStream;
		};

		try {
			const { RAGWorkflowService } = await import(
				'../../../../src/angular/ai/ai-rag-workflow.service'
			);
			const service = new RAGWorkflowService();
			const result = service.connect('/rag', 'conv-1');

			expect(result.workflow()).toEqual(result.state());
			expect(result.workflow().stage).toBe('complete');
			expect(result.workflow().hasSources).toBe(true);
			expect('state' in baseStream).toBe(false);
		} finally {
			AIStreamService.prototype.connect = originalConnect;
		}
	});
});
