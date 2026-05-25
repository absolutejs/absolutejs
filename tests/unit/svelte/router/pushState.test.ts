import { afterEach, describe, expect, test } from 'bun:test';

// `page.svelte.ts` uses Svelte 5's `$state` rune. In production it's
// rewritten by Svelte's `compileModule`, but Bun's TS loader doesn't run
// that pass for direct imports — so we shim the rune as an identity
// function before loading the modules under test. Reactivity isn't
// needed for these tests; we only verify the side-effects of pushState /
// replaceState on `page.url` and `page.state`. Dynamic imports are used
// because static imports would hoist above the shim assignment.
(globalThis as { $state?: <T>(initial: T) => T }).$state = <T>(initial: T) =>
	initial;

const { pushState, replaceState } = await import(
	'../../../../src/svelte/router/pushState'
);
const { page } = await import('../../../../src/svelte/router/page.svelte');

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
	if (originalWindow === undefined) {
		delete (globalThis as { window?: unknown }).window;
	} else {
		(globalThis as { window?: unknown }).window = originalWindow;
	}
});

const stripWindow = () => {
	delete (globalThis as { window?: unknown }).window;
};

const installFakeWindow = () => {
	const calls: Array<{
		method: 'pushState' | 'replaceState';
		state: unknown;
		title: string;
		url: string;
	}> = [];
	const fake = {
		history: {
			pushState: (state: unknown, title: string, url: string) => {
				calls.push({ method: 'pushState', state, title, url });
			},
			replaceState: (state: unknown, title: string, url: string) => {
				calls.push({ method: 'replaceState', state, title, url });
			}
		},
		location: { href: 'http://example.test/start' }
	};
	(globalThis as { window?: unknown }).window = fake;

	return { calls, fake };
};

describe('pushState / replaceState — no window (SSR)', () => {
	test('pushState is a no-op when window is undefined', () => {
		stripWindow();
		const before = page.url.href;
		const beforeState = page.state;
		expect(() => pushState('/whatever', { foo: 1 })).not.toThrow();
		expect(page.url.href).toBe(before);
		expect(page.state).toBe(beforeState);
	});

	test('replaceState is a no-op when window is undefined', () => {
		stripWindow();
		const before = page.url.href;
		const beforeState = page.state;
		expect(() => replaceState('/whatever', { foo: 2 })).not.toThrow();
		expect(page.url.href).toBe(before);
		expect(page.state).toBe(beforeState);
	});
});

describe('pushState — with window', () => {
	test('pushState calls window.history.pushState and updates page state', () => {
		const { calls } = installFakeWindow();
		pushState('/photos/42', { id: 42, modal: 'photo' });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe('pushState');
		expect(calls[0]?.state).toEqual({ id: 42, modal: 'photo' });
		expect(calls[0]?.url).toBe('http://example.test/photos/42');
		expect(page.state).toEqual({ id: 42, modal: 'photo' });
		expect(page.url.pathname).toBe('/photos/42');
	});

	test('pushState resolves a relative URL against window.location.href', () => {
		installFakeWindow();
		(
			globalThis as {
				window?: { location: { href: string } };
			}
		).window!.location.href = 'http://example.test/section/inner';
		pushState('sibling', null);
		expect(page.url.href).toBe('http://example.test/section/sibling');
	});

	test('pushState handles absolute URLs', () => {
		const { calls } = installFakeWindow();
		pushState('http://example.test/elsewhere', null);
		expect(calls[0]?.url).toBe('http://example.test/elsewhere');
		expect(page.url.href).toBe('http://example.test/elsewhere');
	});
});

describe('replaceState — with window', () => {
	test('replaceState calls window.history.replaceState and updates page state', () => {
		const { calls } = installFakeWindow();
		replaceState('/login', { redirect: '/dashboard' });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe('replaceState');
		expect(calls[0]?.state).toEqual({ redirect: '/dashboard' });
		expect(calls[0]?.url).toBe('http://example.test/login');
		expect(page.state).toEqual({ redirect: '/dashboard' });
		expect(page.url.pathname).toBe('/login');
	});
});
