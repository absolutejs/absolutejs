import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { build } from '../../../src/core/build';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';

/* `streaming: true` on a Vue page, and what each mode guarantees.
 *
 * A Vue page renders atomically by default — the whole document buffered
 * through `renderToString` — which costs it the first byte and buys an
 * error page for a render that fails asynchronously, deep in the page,
 * where nothing has been committed yet. `streaming: true` makes the
 * opposite trade per page: the shell goes out immediately and a failure
 * after the first chunk truncates instead of answering.
 *
 * Both are asserted here, because the whole point of an opt-in is that
 * each mode keeps its own promise. The measurement is time to first byte
 * with the clock started BEFORE the handler call: a buffered handler
 * spends the whole render inside that call, so a clock started after it
 * returns cannot tell the two apart — the first version of this test did
 * that and passed against the behaviour it was measuring. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`vue-streaming-${process.pid}`
);

const BOUNDARY_DELAY_MS = 600;
const STREAM_BUDGET_MS = 400;

const SLOW_PAGE = `<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const Slow = defineAsyncComponent(
	() =>
		new Promise((done) => {
			setTimeout(
				() => done({ template: '<p id="slow">slow</p>' }),
				${BOUNDARY_DELAY_MS}
			);
		})
);
</script>

<template>
	<div id="shell">shell</div>
	<Suspense>
		<Slow />
		<template #fallback><p id="pending">pending</p></template>
	</Suspense>
</template>
`;

const THROWING_PAGE = `<script setup lang="ts">
throw new Error('setup exploded');
</script>

<template>
	<div id="never">never</div>
</template>
`;

let manifest: Record<string, string> = {};

beforeAll(async () => {
	await mkdir(join(fixtureRoot, 'vue', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'SlowPage.vue'),
		SLOW_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'ThrowingPage.vue'),
		THROWING_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		vueDirectory: rel('vue')
	});
	manifest = result?.manifest ?? {};
}, 300_000);

afterAll(async () => {
	await rm(fixtureRoot, { force: true, recursive: true });
});

/** Milliseconds from asking for the page to its first body byte, and the
 *  full text. The clock starts before the handler call on purpose. */
const timeToFirstByte = async (render: () => Promise<Response>) => {
	const started = Date.now();
	const response = await render();
	const reader = response.body?.getReader();
	if (!reader) throw new Error('response has no body');
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let firstChunkAt: number | undefined;
	/* The streaming path enqueues the head and tail as STRINGS around
	 * Vue's byte chunks, so a reader of this body sees both. */
	const asText = (value: unknown) => {
		if (typeof value === 'string') return value;
		if (value instanceof Uint8Array)
			return decoder.decode(value, { stream: true });

		return '';
	};
	const drain = async (): Promise<string[]> => {
		const chunk = await reader.read();
		if (chunk.done) return chunks;
		firstChunkAt ??= Date.now() - started;
		chunks.push(asText(chunk.value));

		return drain();
	};
	await drain();

	return {
		firstChunkAt: firstChunkAt ?? Date.now() - started,
		status: response.status,
		text: chunks.join('')
	};
};

const renderSlowPage = (streaming: boolean) => () =>
	handleVuePageRequest({
		indexPath: manifest.SlowPageIndex ?? '',
		pagePath: manifest.SlowPage ?? '',
		props: {},
		request: new Request('http://absolute.test/slow'),
		streaming
	});

describe('a Vue page with `streaming: true`', () => {
	test('starts arriving before its slow boundary resolves', async () => {
		const { firstChunkAt, text } = await timeToFirstByte(
			renderSlowPage(true)
		);

		expect(firstChunkAt).toBeLessThan(STREAM_BUDGET_MS);
		// The shell is in the first bytes, and the slow part still arrives.
		expect(text).toContain('id="shell"');
		expect(text).toContain('id="slow"');
	}, 120_000);
});

describe('the same page by default', () => {
	test('waits for the boundary, which is the atomic trade', async () => {
		/* The control, and the measurement that makes the opt-in worth
		 * having: without it the test above could pass on a machine fast
		 * enough that nothing is ever slow. */
		const { firstChunkAt, text } = await timeToFirstByte(
			renderSlowPage(false)
		);

		expect(firstChunkAt).toBeGreaterThanOrEqual(BOUNDARY_DELAY_MS);
		expect(text).toContain('id="slow"');
	}, 120_000);
});

describe('a Vue page whose setup throws', () => {
	test('is answered with an error page in both modes', async () => {
		/* A failure before the first chunk is answerable either way: the
		 * streaming path primes the stream before committing a response.
		 * What streaming gives up is the ASYNC failure deep in a render,
		 * which `tests/unit/vue/pageHandlerStreaming` covers for the
		 * default mode. */
		for (const streaming of [false, true]) {
			const response = await handleVuePageRequest({
				indexPath: manifest.ThrowingPageIndex ?? '',
				pagePath: manifest.ThrowingPage ?? '',
				props: {},
				request: new Request('http://absolute.test/throws'),
				streaming
			});
			const text = await response.text();

			expect(response.status).toBe(500);
			expect(text).not.toContain('id="never"');
		}
	}, 120_000);
});
