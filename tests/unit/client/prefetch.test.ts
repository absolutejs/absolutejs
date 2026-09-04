import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	canPrefetch,
	consumePrefetch,
	hasPrefetched,
	isDevelopmentClient,
	isPrefetchableHref,
	observeViewport,
	prefetch,
	preloadModule,
	resetPrefetchState,
	resolveDefaultPrefetchMode,
	ROUTE_DATA_MEDIA_TYPE,
	scheduleHoverPrefetch,
	speculate
} from '../../../src/client/prefetch';

type Deferred = {
	resolve: (response: Response) => void;
	signal: AbortSignal | null | undefined;
	url: string;
	headers: HeadersInit | undefined;
};

const pending: Deferred[] = [];

const deferredFetch = (input: string | URL | Request, init?: RequestInit) => {
	let settle: (response: Response) => void = () => undefined;
	const promise = new Promise<Response>((resolve) => {
		settle = resolve;
	});
	const url = typeof input === 'string' ? input : input.toString();
	pending.push({ headers: init?.headers, resolve: settle, signal: init?.signal, url });
	init?.signal?.addEventListener('abort', () =>
		settle(new Response(null, { status: 0 }))
	);

	return promise;
};

const flush = () => Bun.sleep(0);

const originalFetch = globalThis.fetch;
/** Bun's `typeof fetch` also carries `preconnect`; keep the real one. */
const installFetch = (implementation: typeof deferredFetch) => {
	globalThis.fetch = Object.assign(mock(implementation), {
		preconnect: originalFetch.preconnect
	});
};
const setGlobalFlag = (name: string, value: unknown) => {
	Reflect.set(globalThis, name, value);
};
const clearGlobalFlag = (name: string) => {
	Reflect.deleteProperty(globalThis, name);
};

beforeAll(() =>
	GlobalRegistrator.register({ url: 'http://localhost:3000/start' })
);
afterAll(() => GlobalRegistrator.unregister());

beforeEach(() => {
	pending.length = 0;
	installFetch(deferredFetch);
});

afterEach(async () => {
	// Settle every fetch the test left hanging so the in-flight budget is
	// released before the next test starts (a real fetch rejects on abort).
	for (const entry of pending) entry.resolve(new Response(null, { status: 0 }));
	await flush();
	resetPrefetchState();
	await flush();
	globalThis.fetch = originalFetch;
	clearGlobalFlag('__ABSOLUTE_PREFETCH__');
	clearGlobalFlag('__HMR_FRAMEWORK__');
	Object.defineProperty(navigator, 'connection', {
		configurable: true,
		value: undefined
	});
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

describe('prefetch guards', () => {
	test('prefetches same-origin documents with same-origin credentials', async () => {
		prefetch('/about');
		await flush();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.url).toBe('/about');
		expect(hasPrefetched('/about')).toBe(true);
	});

	test('honours the global opt-out window.__ABSOLUTE_PREFETCH__ = false', async () => {
		setGlobalFlag('__ABSOLUTE_PREFETCH__', false);
		expect(canPrefetch()).toBe(false);
		prefetch('/about');
		await flush();
		expect(pending).toHaveLength(0);
	});

	test('does nothing when Save-Data or a 2g connection is reported', async () => {
		Object.defineProperty(navigator, 'connection', {
			configurable: true,
			value: { saveData: true }
		});
		prefetch('/save-data');
		Object.defineProperty(navigator, 'connection', {
			configurable: true,
			value: { effectiveType: '2g', saveData: false }
		});
		prefetch('/slow');
		await flush();
		expect(pending).toHaveLength(0);
		expect(hasPrefetched('/save-data')).toBe(false);
	});

	test('does nothing when prefers-reduced-data matches', async () => {
		const originalMatchMedia = window.matchMedia;
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			value: (query: string) => ({
				matches: query.includes('prefers-reduced-data')
			})
		});
		try {
			prefetch('/reduced');
			await flush();
			expect(pending).toHaveLength(0);
		} finally {
			Object.defineProperty(window, 'matchMedia', {
				configurable: true,
				value: originalMatchMedia
			});
		}
	});

	test('isPrefetchableHref rejects external, hash and non-http targets', () => {
		expect(isPrefetchableHref('/pricing')).toBe(true);
		expect(isPrefetchableHref('http://localhost:3000/pricing')).toBe(true);
		expect(isPrefetchableHref('https://example.com/')).toBe(false);
		expect(isPrefetchableHref('#section')).toBe(false);
		expect(isPrefetchableHref('mailto:hi@example.com')).toBe(false);
		expect(isPrefetchableHref('')).toBe(false);
	});
});

describe('prefetch cache', () => {
	test('dedupes repeated prefetches of the same URL', async () => {
		prefetch('/about');
		prefetch('/about');
		await flush();
		expect(pending).toHaveLength(1);
	});

	test('consumePrefetch hands back the response once', async () => {
		prefetch('/about');
		await flush();
		const promise = consumePrefetch('/about');
		expect(promise).toBeDefined();
		expect(consumePrefetch('/about')).toBeUndefined();
		pending[0]?.resolve(new Response('<html>', { status: 200 }));
		const response = await promise;
		expect(response?.status).toBe(200);
	});

	test('keeps at most 16 entries and aborts the evicted fetch', async () => {
		for (let index = 0; index < 17; index += 1) prefetch(`/page-${index}`);
		await flush();
		expect(hasPrefetched('/page-0')).toBe(false);
		expect(hasPrefetched('/page-1')).toBe(true);
		expect(hasPrefetched('/page-16')).toBe(true);
		expect(pending[0]?.signal?.aborted).toBe(true);
	});

	test('limits in-flight prefetches to two and drains the queue in order', async () => {
		prefetch('/a');
		prefetch('/b');
		prefetch('/c');
		await flush();
		expect(pending.map((entry) => entry.url)).toEqual(['/a', '/b']);

		pending[0]?.resolve(new Response(null, { status: 200 }));
		await flush();
		await flush();
		expect(pending.map((entry) => entry.url)).toEqual(['/a', '/b', '/c']);
	});

	test('a failed fetch resolves to a status-0 response instead of rejecting', async () => {
		installFetch(() => Promise.reject(new Error('offline')));
		prefetch('/broken');
		const response = await consumePrefetch('/broken');
		expect(response?.status).toBe(0);
	});
});

describe('prefetch kinds', () => {
	test('data prefetch sends the route-data Accept header and caches a 404 as no data', async () => {
		prefetch('/about', { kind: 'data' });
		await flush();
		expect(pending).toHaveLength(1);
		const headers = new Headers(pending[0]?.headers);
		expect(headers.get('accept')).toBe(ROUTE_DATA_MEDIA_TYPE);
		pending[0]?.resolve(new Response('nope', { status: 404 }));
		const response = await consumePrefetch('/about', 'data');
		expect(response?.status).toBe(404);
		expect(hasPrefetched('/about')).toBe(false);
	});

	test('data prefetch keeps a matching route-data response', async () => {
		prefetch('/about', { kind: 'data' });
		await flush();
		pending[0]?.resolve(
			new Response('{}', {
				headers: { 'content-type': ROUTE_DATA_MEDIA_TYPE },
				status: 200
			})
		);
		const response = await consumePrefetch('/about', 'data');
		expect(response?.ok).toBe(true);
	});

	test('data prefetch warms the modules and CSS the envelope names', async () => {
		prefetch('/account', { kind: 'data' });
		await flush();
		pending[0]?.resolve(
			new Response(
				JSON.stringify({
					assets: {
						client: '/react/client/Account-def.js',
						css: ['/css/Account-abc.css', ''],
						index: '/react/indexes/Account-abc.js'
					},
					framework: 'react',
					kind: 'route',
					pageId: 'Account',
					props: { displayName: 'Ada' },
					protocol: 1,
					status: 200
				}),
				{
					headers: { 'content-type': ROUTE_DATA_MEDIA_TYPE },
					status: 200
				}
			)
		);
		const response = await consumePrefetch('/account', 'data');

		expect(
			Array.from(
				document.head.querySelectorAll('link[rel="modulepreload"]')
			).map((link) => link.getAttribute('href'))
		).toEqual([
			'/react/indexes/Account-abc.js',
			'/react/client/Account-def.js'
		]);
		expect(
			Array.from(
				document.head.querySelectorAll('link[rel="prefetch"]')
			).map((link) => link.getAttribute('href'))
		).toEqual(['/css/Account-abc.css']);
		// The cached response body is still readable by the navigation.
		expect(await response?.json()).toMatchObject({ kind: 'route' });
	});

	test('a malformed route-data body is ignored, not thrown', async () => {
		prefetch('/broken-data', { kind: 'data' });
		await flush();
		pending[0]?.resolve(
			new Response('not json', {
				headers: { 'content-type': ROUTE_DATA_MEDIA_TYPE },
				status: 200
			})
		);
		const response = await consumePrefetch('/broken-data', 'data');

		expect(response?.ok).toBe(true);
		expect(
			document.head.querySelectorAll('link[rel="modulepreload"]')
		).toHaveLength(0);
	});

	test('route prefetch warms the document and the route data together', async () => {
		prefetch('/pricing', { kind: 'route' });
		await flush();

		expect(pending.map((entry) => entry.url)).toEqual([
			'/pricing',
			'/pricing'
		]);
		expect(
			pending.map((entry) => new Headers(entry.headers).get('accept'))
		).toEqual([null, ROUTE_DATA_MEDIA_TYPE]);
		// The document entry is what a `'route'` lookup reports.
		expect(hasPrefetched('/pricing', 'route')).toBe(true);
		expect(hasPrefetched('/pricing', 'data')).toBe(true);
	});

	test('module prefetch injects one modulepreload link per href', () => {
		expect(preloadModule('/react/indexes/Home.js')).toBe(true);
		prefetch('/react/indexes/Home.js', { kind: 'module' });
		prefetch('http://localhost:3000/react/indexes/Home.js', {
			kind: 'module'
		});
		const links = document.head.querySelectorAll('link[rel="modulepreload"]');
		expect(links).toHaveLength(1);
		expect(links[0]?.getAttribute('href')).toBe('/react/indexes/Home.js');
		expect(pending).toHaveLength(0);
	});

	test('module prefetch respects a modulepreload already in the document', () => {
		document.head.innerHTML =
			'<link rel="modulepreload" href="/vue/vendor/vue.js">';
		expect(preloadModule('/vue/vendor/vue.js')).toBe(false);
		expect(
			document.head.querySelectorAll('link[rel="modulepreload"]')
		).toHaveLength(1);
	});
});

describe('speculation rules', () => {
	let originalSupports: unknown;

	beforeEach(() => {
		originalSupports = Reflect.get(HTMLScriptElement, 'supports');
		Reflect.set(
			HTMLScriptElement,
			'supports',
			(type: string) => type === 'speculationrules'
		);
	});

	afterEach(() => {
		Reflect.set(HTMLScriptElement, 'supports', originalSupports);
	});

	const rules = () =>
		Array.from(
			document.head.querySelectorAll('script[type="speculationrules"]')
		).map((script) => JSON.parse(script.textContent ?? '{}'));

	test('injects an immediate prerender rule, deduped by URL', () => {
		expect(speculate('/pricing')).toBe(true);
		expect(speculate('/pricing')).toBe(false);
		expect(rules()).toEqual([
			{ prerender: [{ eagerness: 'immediate', urls: ['/pricing'] }] }
		]);
	});

	test('caps live rules at two, dropping the oldest', () => {
		speculate('/one');
		speculate('/two');
		speculate('/three');
		expect(rules().map((rule) => rule.prerender[0].urls[0])).toEqual([
			'/two',
			'/three'
		]);
	});

	test('no-ops when the browser lacks speculation rules support', () => {
		Reflect.set(HTMLScriptElement, 'supports', () => false);
		expect(speculate('/pricing')).toBe(false);
		expect(rules()).toHaveLength(0);
	});
});

describe('triggers', () => {
	test('hover prefetch is debounced and cancellable', async () => {
		const handle = scheduleHoverPrefetch('/hover');
		await Bun.sleep(50);
		expect(pending).toHaveLength(0);
		handle.cancel();
		await Bun.sleep(300);
		expect(pending).toHaveLength(0);

		scheduleHoverPrefetch('/hover');
		await Bun.sleep(300);
		// Hover defaults to `kind: 'route'`: the document plus the route
		// data that names the page's modules and stylesheets.
		expect(pending.map((entry) => entry.url)).toEqual(['/hover', '/hover']);
		expect(
			pending.map((entry) => new Headers(entry.headers).get('accept'))
		).toEqual([null, ROUTE_DATA_MEDIA_TYPE]);
	});

	test('an explicit hover kind overrides the route default', async () => {
		scheduleHoverPrefetch('/hover-doc', { kind: 'document' });
		await Bun.sleep(300);
		expect(pending.map((entry) => entry.url)).toEqual(['/hover-doc']);
	});

	test('viewport observation shares one IntersectionObserver and prefetches on intersect', async () => {
		const instances: FakeIntersectionObserver[] = [];
		class FakeIntersectionObserver {
			observed: Element[] = [];
			unobserved: Element[] = [];
			constructor(public callback: IntersectionObserverCallback) {
				instances.push(this);
			}
			observe(element: Element) {
				this.observed.push(element);
			}
			unobserve(element: Element) {
				this.unobserved.push(element);
			}
			disconnect() {
				/* no-op */
			}
		}
		const originalObserver = Reflect.get(globalThis, 'IntersectionObserver');
		Reflect.set(globalThis, 'IntersectionObserver', FakeIntersectionObserver);

		try {
			const first = document.createElement('a');
			const second = document.createElement('a');
			const unobserve = observeViewport(first, '/first');
			observeViewport(second, '/second');
			expect(instances).toHaveLength(1);
			expect(instances[0]?.observed).toEqual([first, second]);

			unobserve();
			expect(instances[0]?.unobserved).toEqual([first]);

			const rect = second.getBoundingClientRect();
			const entry: IntersectionObserverEntry = {
				boundingClientRect: rect,
				intersectionRatio: 1,
				intersectionRect: rect,
				isIntersecting: true,
				rootBounds: null,
				target: second,
				time: 0
			};
			const [observer] = instances;
			if (!observer) throw new Error('observer missing');
			observer.callback([entry], new IntersectionObserver(() => undefined));
			await flush();
			expect(pending.map((item) => item.url)).toEqual(['/second']);
		} finally {
			Reflect.set(globalThis, 'IntersectionObserver', originalObserver);
		}
	});
});

describe('mode defaults', () => {
	test('defaults to viewport in production and hover under the dev server', () => {
		expect(isDevelopmentClient()).toBe(false);
		expect(resolveDefaultPrefetchMode()).toBe('viewport');

		setGlobalFlag('__HMR_FRAMEWORK__', 'react');
		expect(isDevelopmentClient()).toBe(true);
		expect(resolveDefaultPrefetchMode()).toBe('hover');
	});

	test('treats an injected HMR client script as development', () => {
		document.body.innerHTML = '<script data-hmr-client></script>';
		expect(isDevelopmentClient()).toBe(true);
	});
});
