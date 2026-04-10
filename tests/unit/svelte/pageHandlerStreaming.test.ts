import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { handleSveltePageRequest } from '../../../src/svelte';

const FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'svelte',
	'StreamingPage.svelte'
);
const AWAIT_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'svelte',
	'AwaitStreamingPage.svelte'
);

describe('handleSveltePageRequest streaming', () => {
	test('injects runtime and appends patches for registered StreamSlot components', async () => {
		const response = await handleSveltePageRequest(
			FIXTURE as never,
			FIXTURE,
			'/svelte-test-index.js',
			{},
			{ collectStreamingSlots: true }
		);
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"svelte-fast"');
		const slowPatchIndex = html.indexOf('"svelte-slow"');
		const runtimeIndex = html.indexOf('__ABS_SLOT_ENQUEUE__');
		const headCloseIndex = html.indexOf('</head>');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(runtimeIndex).toBeGreaterThan(headCloseIndex);
		expect(html).toContain('id="svelte-fast"');
		expect(html).toContain('id="svelte-slow"');
		expect(html).toContain('svelte fast resolved');
		expect(html).toContain('svelte slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('injects runtime and appends patches for lowered #await blocks', async () => {
		const response = await handleSveltePageRequest(
			AWAIT_FIXTURE as never,
			AWAIT_FIXTURE,
			'/svelte-await-test-index.js',
			{},
			{ collectStreamingSlots: true }
		);
		const html = await response.text();
		const fastPatchIndex = html.indexOf('svelte await fast resolved');
		const slowPatchIndex = html.indexOf('svelte await slow resolved');
		const runtimeIndex = html.indexOf('__ABS_SLOT_ENQUEUE__');
		const headCloseIndex = html.indexOf('</head>');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(runtimeIndex).toBeGreaterThan(headCloseIndex);
		expect(html).toContain('fast loading');
		expect(html).toContain('slow loading');
		expect(html).toContain('svelte await fast resolved');
		expect(html).toContain('svelte await slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});
