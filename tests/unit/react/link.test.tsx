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
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Route, Routes } from 'react-router';
import {
	resetPrefetchState,
	ROUTE_DATA_MEDIA_TYPE
} from '../../../src/client/prefetch';
import { Link } from '../../../src/react/router/Link';
import { UniversalRouter } from '../../../src/react/router/UniversalRouter';

const fetched: string[] = [];
const accepted: (string | null)[] = [];
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let container: HTMLElement | undefined;

const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
	fetched.push(typeof input === 'string' ? input : input.toString());
	accepted.push(new Headers(init?.headers).get('accept'));

	return Promise.resolve(new Response('<html></html>', { status: 200 }));
};

beforeAll(() =>
	GlobalRegistrator.register({ url: 'http://localhost:3000/one' })
);
afterAll(async () => {
	await Bun.sleep(10);
	GlobalRegistrator.unregister();
});

beforeEach(() => {
	fetched.length = 0;
	accepted.length = 0;
	globalThis.fetch = Object.assign(mock(fakeFetch), {
		preconnect: originalFetch.preconnect
	});
	container = document.createElement('div');
	document.body.append(container);
});

afterEach(async () => {
	flushSync(() => root?.unmount());
	root = undefined;
	container?.remove();
	resetPrefetchState();
	globalThis.fetch = originalFetch;
	window.history.replaceState(null, '', '/one');
	// Let React's scheduler drain unmount work before the next test (and
	// before happy-dom is unregistered in afterAll).
	await Bun.sleep(0);
});

const render = (element: ReactNode) => {
	if (!container) throw new Error('container missing');
	const target = container;
	flushSync(() => {
		root = createRoot(target);
		root?.render(element);
	});

	return target;
};

const anchor = (target: HTMLElement) => {
	const link = target.querySelector('a');
	if (!link) throw new Error('anchor missing');

	return link;
};

/** Dispatch a click and report whether a handler called preventDefault.
 *  A document-level listener then cancels the event itself so happy-dom
 *  never performs the anchor's default navigation. */
const click = (element: HTMLElement, init: MouseEventInit = {}) => {
	let prevented = false;
	const stop = (event: Event) => {
		prevented = event.defaultPrevented;
		event.preventDefault();
	};
	document.addEventListener('click', stop);
	element.dispatchEvent(
		new MouseEvent('click', {
			bubbles: true,
			button: 0,
			cancelable: true,
			...init
		})
	);
	document.removeEventListener('click', stop);

	return prevented;
};

describe('React <Link>', () => {
	test('renders an anchor with the href and forwards attributes', () => {
		const target = render(
			<Link className="nav" href="/pricing" prefetch="none">
				Pricing
			</Link>
		);
		const link = anchor(target);
		expect(link.getAttribute('href')).toBe('/pricing');
		expect(link.className).toBe('nav');
		expect(link.textContent).toBe('Pricing');
	});

	test('pointerdown prefetches the target document immediately', async () => {
		const target = render(
			<Link href="/pricing" prefetch="hover">
				Pricing
			</Link>
		);
		anchor(target).dispatchEvent(
			new Event('pointerdown', { bubbles: true })
		);
		await Bun.sleep(0);
		// A deliberate trigger warms the document AND the route data, so
		// the click has the page's props, modules and CSS too.
		expect(fetched).toEqual(['/pricing', '/pricing']);
		expect(accepted).toEqual([null, ROUTE_DATA_MEDIA_TYPE]);
	});

	test('hover prefetches after the debounce window', async () => {
		const target = render(
			<Link href="/docs" prefetch="hover">
				Docs
			</Link>
		);
		anchor(target).dispatchEvent(
			new Event('pointerover', { bubbles: true })
		);
		expect(fetched).toEqual([]);
		await Bun.sleep(320);
		expect(fetched).toEqual(['/docs', '/docs']);
		expect(accepted).toEqual([null, ROUTE_DATA_MEDIA_TYPE]);
	});

	test('prefetch="none" never fetches', async () => {
		const target = render(
			<Link href="/quiet" prefetch="none">
				Quiet
			</Link>
		);
		const link = anchor(target);
		link.dispatchEvent(new Event('pointerover', { bubbles: true }));
		link.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await Bun.sleep(320);
		expect(fetched).toEqual([]);
	});

	test('external hrefs are never prefetched', async () => {
		const target = render(
			<Link href="https://example.com/" prefetch="hover">
				Out
			</Link>
		);
		anchor(target).dispatchEvent(
			new Event('pointerdown', { bubbles: true })
		);
		await Bun.sleep(0);
		expect(fetched).toEqual([]);
	});

	test('outside a router a click is a plain navigation', () => {
		const target = render(
			<Link href="/pricing" prefetch="none">
				Pricing
			</Link>
		);
		expect(click(anchor(target))).toBe(false);
	});

	test('inside UniversalRouter a matched route navigates client-side', async () => {
		const target = render(
			<UniversalRouter>
				<Link href="/two" prefetch="none">
					Two
				</Link>
				<Routes>
					<Route element={<p>page one</p>} path="/one" />
					<Route element={<p>page two</p>} path="/two" />
				</Routes>
			</UniversalRouter>
		);
		expect(target.textContent).toContain('page one');
		let prevented = false;
		flushSync(() => {
			prevented = click(anchor(target));
		});
		expect(prevented).toBe(true);
		expect(window.location.pathname).toBe('/two');
		// react-router commits the location change in a transition.
		await Bun.sleep(20);
		expect(target.textContent).toContain('page two');
	});

	test('inside UniversalRouter modifier clicks and unmatched hrefs pass through', () => {
		const target = render(
			<UniversalRouter>
				<Link href="/two" prefetch="none">
					Two
				</Link>
				<Link href="/elsewhere" prefetch="none">
					Elsewhere
				</Link>
				<Routes>
					<Route element={<p>page one</p>} path="/one" />
					<Route element={<p>page two</p>} path="/two" />
				</Routes>
			</UniversalRouter>
		);
		const [matched, unmatched] = Array.from(target.querySelectorAll('a'));
		if (!matched || !unmatched) throw new Error('anchors missing');
		expect(click(matched, { metaKey: true })).toBe(false);
		expect(click(matched, { button: 1 })).toBe(false);
		expect(click(unmatched)).toBe(false);
		expect(window.location.pathname).toBe('/one');
	});
});
