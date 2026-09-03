import { describe, expect, test } from 'bun:test';
import * as shared from '../../../../src/client/prefetch';
import * as svelte from '../../../../src/svelte/router/prefetchCache';

describe('svelte router prefetchCache', () => {
	test('re-exports the shared framework-neutral prefetch primitive', () => {
		expect(svelte.prefetch).toBe(shared.prefetch);
		expect(svelte.consumePrefetch).toBe(shared.consumePrefetch);
		expect(svelte.clearPrefetchCache).toBe(shared.clearPrefetchCache);
		expect(svelte.scheduleHoverPrefetch).toBe(shared.scheduleHoverPrefetch);
		expect(svelte.observeViewport).toBe(shared.observeViewport);
		expect(svelte.speculate).toBe(shared.speculate);
	});

	test('scheduleHoverPrefetch is a no-op handle without a window', () => {
		expect(typeof window).toBe('undefined');
		const handle = svelte.scheduleHoverPrefetch('/anywhere');
		expect(() => handle.cancel()).not.toThrow();
	});
});
