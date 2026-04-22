import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';
import { scopedState } from 'elysia-scoped-state';
import type * as AngularExamplePage from './angular/pages/angular-example';
import type SvelteExample from './svelte/pages/SvelteExample.svelte';
import type VueExample from './vue/pages/VueExample.vue';
import { generateHeadElement } from '../src/utils/generateHeadElement';
import { ReactExample } from './react/pages/ReactExample';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	handleReactPageRequest,
	prepare
} from '../src';
import { handleAngularPageRequest } from '../src/angular';
import { networking } from '../src/plugins/networking';
import { handleSveltePageRequest } from '../src/svelte';
import { handleVuePageRequest } from '../src/vue';
import {
	createHeuristicRAGQueryTransform,
	createHeuristicRAGReranker,
	createRAGCollection,
	createRAGFileEvaluationSuiteSnapshotHistoryStore,
	createRAGFileRetrievalComparisonHistoryStore,
	createSQLiteRAGStore,
	ragChat
} from '../src/ai';

const { absolutejs, manifest } = await prepare();

const ragProvider = () => ({
	async *stream() {}
});

const ragComparisonHistoryStore = createRAGFileRetrievalComparisonHistoryStore(
	'/tmp/absolutejs-example-rag-comparisons.json'
);
const ragSuiteSnapshotHistoryStore =
	createRAGFileEvaluationSuiteSnapshotHistoryStore(
		'/tmp/absolutejs-example-rag-benchmark-snapshots.json'
	);

const ragStore = createSQLiteRAGStore({
	db: new Database(':memory:'),
	dimensions: 2,
	mockEmbedding: async (text) => {
		const normalized = text.toLowerCase();
		if (
			normalized.includes('launch checklist exact wording') ||
			normalized.includes('aurora promotion checklist wording') ||
			normalized.includes('focus lane launch checklist wording')
		) {
			return [0.995, 0.005];
		}

		return [0, 1];
	},
	native: {
		mode: 'vec0'
	}
});

const ragCollection = createRAGCollection({
	queryTransform: createHeuristicRAGQueryTransform(),
	rerank: createHeuristicRAGReranker(),
	store: ragStore
});

await ragCollection.ingest({
	chunks: [
		...Array.from({ length: 5_001 }, (_, index) => ({
			chunkId: `noise:${index}`,
			corpusKey: 'noise',
			embedding: [0, 1] as number[],
			metadata: {
				corpusKey: 'noise',
				documentId: `noise-${index}`,
				lane: 'noise'
			},
			source: `noise/${index}.md`,
			text: `Background operations note ${index}.`
		})),
		...Array.from({ length: 3 }, (_, index) => ({
			chunkId: `focus:distractor:${index}`,
			corpusKey: 'focus',
			embedding: [1, 0] as number[],
			metadata: {
				corpusKey: 'focus',
				documentId: `focus-distractor-${index}`,
				lane: 'focus'
			},
			source: `focus/distractor-${index}.md`,
			text:
				index === 0
					? 'aurora promotion checklist overview'
					: index === 1
						? 'launch checklist wording draft'
						: 'focus lane promotion runbook notes'
		})),
		{
			chunkId: 'focus:target',
			corpusKey: 'focus',
			embedding: [0.995, 0.005] as number[],
			metadata: {
				corpusKey: 'focus',
				documentId: 'focus-target',
				lane: 'focus'
			},
			source: 'guide/planner-depth.md',
			text: 'launch checklist exact wording for aurora promotion in the focus lane'
		}
	]
});
await ragStore.analyze?.();

export const server = new Elysia()
	.use(absolutejs)
	.use(
		ragChat({
			collection: ragCollection,
			evaluationSuiteSnapshotHistoryStore: ragSuiteSnapshotHistoryStore,
			path: '/rag',
			provider: ragProvider,
			retrievalComparisonHistoryStore: ragComparisonHistoryStore
		})
	)
	.use(
		scopedState({
			count: { value: 0 }
		})
	)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
	.get('/react', () =>
		handleReactPageRequest({
			Page: ReactExample,
			index: asset(manifest, 'ReactExampleIndex'),
			props: {
				cssPath: asset(manifest, 'ReactExampleCSS'),
				initialCount: 0
			}
		})
	)
	.get('/svelte', () =>
		handleSveltePageRequest<typeof SvelteExample>({
			indexPath: asset(manifest, 'SvelteExampleIndex'),
			pagePath: asset(manifest, 'SvelteExample'),
			props: {
				cssPath: asset(manifest, 'SvelteExampleCSS'),
				initialCount: 0
			}
		})
	)
	.get('/vue', () =>
		handleVuePageRequest<typeof VueExample>({
			headTag: generateHeadElement({
				cssPath: [
					asset(manifest, 'VueExampleCSS'),
					asset(manifest, 'VueExampleCompiledCSS')
				],
				title: 'AbsoluteJS + Vue'
			}),
			indexPath: asset(manifest, 'VueExampleIndex'),
			pagePath: asset(manifest, 'VueExample'),
			props: { initialCount: 0 }
		})
	)
	.get('/angular', async () =>
		handleAngularPageRequest<typeof AngularExamplePage>({
			headTag: generateHeadElement({
				cssPath: asset(manifest, 'AngularExampleCSS'),
				title: 'AbsoluteJS + Angular'
			}),
			indexPath: asset(manifest, 'AngularExampleIndex'),
			pagePath: asset(manifest, 'AngularExample'),
			props: { initialCount: 0 }
		})
	)
	.get('/htmx', () => handleHTMXPageRequest(asset(manifest, 'HTMXExample')))
	.post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
	.get('/htmx/count', ({ scopedStore }) => scopedStore.count)
	.post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	})
	.use(networking);
