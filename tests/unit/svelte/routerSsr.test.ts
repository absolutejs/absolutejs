import { describe, expect, test } from 'bun:test';
import { createSvelteRouterSsr } from '../../../src/svelte/routerSsr';
import type { SvelteRouterSsrState } from '../../../types/svelteRouter';

/* The page handler's side of the Svelte router: guards queued by a render
 * pass run before the next one, lazy route loads are awaited, and a guard
 * decision becomes the response. */

const stateOf = (ssr: ReturnType<typeof createSvelteRouterSsr>) => {
	const state = ssr.context.get(Symbol.for('absolutejs.svelte-router.ssr'));
	if (!isState(state)) throw new Error('missing router SSR state');

	return state;
};

const isState = (value: unknown): value is SvelteRouterSsrState =>
	typeof value === 'object' && value !== null && 'afterRender' in value;

const FakeComponent = () => ({});

describe('createSvelteRouterSsr', () => {
	test('a page without a router settles after one pass', async () => {
		const ssr = createSvelteRouterSsr(undefined);

		expect(await ssr.settle()).toBe(false);
		expect(ssr.response()).toBeUndefined();
		expect(ssr.bootstrapScript()).toBe('');
	});

	test('a lazy route load asks for another pass and records its source', async () => {
		const ssr = createSvelteRouterSsr(undefined);
		const state = stateOf(ssr);
		state.load('/editor', async () => ({
			__ABSOLUTE_SVELTE_SOURCE__: 'src/Editor.svelte',
			default: FakeComponent
		}));
		// A second registration of the same route doesn't load twice.
		state.load('/editor', () => Promise.reject(new Error('loaded twice')));

		expect(await ssr.settle()).toBe(true);
		expect(state.resolved.get('/editor')).toEqual({
			component: FakeComponent,
			source: 'src/Editor.svelte'
		});
		expect(await ssr.settle()).toBe(false);
		expect(ssr.bootstrapScript()).toBe(
			'window.__ABS_SVELTE_LAZY_ROUTES__={"/editor":"src/Editor.svelte"};'
		);
	});

	test('a failed lazy load is recorded as an error', async () => {
		const ssr = createSvelteRouterSsr(undefined);
		const state = stateOf(ssr);
		const failure = new Error('chunk missing');
		state.load('/broken', () => Promise.reject(failure));
		state.load('/not-a-component', async () => ({ default: 42 }));
		await ssr.settle();

		expect(state.resolved.get('/broken')).toEqual({ error: failure });
		expect(state.resolved.get('/not-a-component')).toHaveProperty('error');
		expect(ssr.bootstrapScript()).toBe('');
	});

	test('guards run in order; a redirect ends the render with a 302', async () => {
		const ssr = createSvelteRouterSsr(new Request('http://localhost/x'));
		const state = stateOf(ssr);
		const ran: string[] = [];
		state.afterRender(async () => {
			ran.push('outer');
			state.setOutcome({ kind: 'redirect', location: '/login' });
		});
		state.afterRender(async () => {
			ran.push('inner');
		});
		state.load('/x', async () => ({ default: FakeComponent }));

		expect(await ssr.settle()).toBe(false);
		expect(ran).toEqual(['outer', 'inner']);
		const response = ssr.response();
		expect(response?.status).toBe(302);
		expect(response?.headers.get('location')).toBe('/login');
	});

	test('the first decision wins and a cancel is a 403', async () => {
		const ssr = createSvelteRouterSsr(undefined);
		const state = stateOf(ssr);
		state.setOutcome({ kind: 'cancel' });
		state.setOutcome({ kind: 'redirect', location: '/ignored' });

		expect(ssr.response()?.status).toBe(403);
	});
});
