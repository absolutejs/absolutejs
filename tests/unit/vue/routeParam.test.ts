import { describe, expect, test } from 'bun:test';
import { effectScope, watch } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { getRouteParam, useRouteParam } from '../../../src/vue/routeParam';

describe('Vue route parameters', () => {
	test('preserves strings and selects the first repeated parameter without hiding absence', () => {
		expect(getRouteParam('match')).toBe('match');
		expect(getRouteParam('')).toBe('');
		expect(getRouteParam(['first', 'second'])).toBe('first');
		expect(getRouteParam([])).toBeUndefined();
		expect(getRouteParam(undefined)).toBeUndefined();
		expect(getRouteParam(null)).toBeUndefined();
	});

	test('outgoing synchronous watchers see missing params safely and stop on disposal', async () => {
		const router = createRouter({
			history: createMemoryHistory(),
			routes: [
				{ component: {}, path: '/matches/:matchId' },
				{ component: {}, path: '/support' },
				{ component: {}, path: '/files/:parts*' }
			]
		});
		await router.push('/matches/first');
		const scope = effectScope();
		const seen: (string | undefined)[] = [];
		scope.run(() => {
			const id = useRouteParam(
				() => router.currentRoute.value.params.matchId
			);
			watch(id, (value) => seen.push(value), {
				flush: 'sync',
				immediate: true
			});
		});
		try {
			await router.push('/matches/second');
			await router.push('/support');
			expect(seen).toEqual(['first', 'second', undefined]);
			expect(router.currentRoute.value.path).toBe('/support');
			scope.stop();
			await router.push('/matches/third');
			expect(seen).toEqual(['first', 'second', undefined]);
			const first = useRouteParam(
				() => router.currentRoute.value.params.parts
			);
			await router.push('/files/a/b');
			expect(first.value).toBe('a');
			await router.push('/support');
			expect(first.value).toBeUndefined();
		} finally {
			scope.stop();
		}
	});
});

test('helper types require consumers to handle absence', () => {
	const value = useRouteParam(() => 'present');
	// @ts-expect-error a required param can disappear during navigation
	const unchecked: string = value.value;
	const checked = value.value;
	// @ts-expect-error one-time reads must also handle absence
	const uncheckedRead: string = getRouteParam('present');
	expect(checked).toBe('present');
	expect(unchecked).toBe(uncheckedRead);
});
