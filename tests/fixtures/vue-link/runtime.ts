// Runs in a clean Bun process: Vue's runtime-dom captures `document` when
// it is first evaluated, so happy-dom must be registered before the first
// `import('vue')`. The test spawns this file and asserts on the JSON it
// prints. See tests/unit/vue/link.test.ts.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:3000/one' });

const fetched: string[] = [];
const fakeFetch = (input: string | URL | Request) => {
	fetched.push(typeof input === 'string' ? input : input.toString());

	return Promise.resolve(new Response('<html></html>', { status: 200 }));
};
globalThis.fetch = Object.assign(fakeFetch, {
	preconnect: globalThis.fetch.preconnect
});

const { createApp, h } = await import('vue');
const { resetPrefetchState } = await import('../../../src/client/prefetch');
const { Link } = await import('../../../src/vue/router/Link');

type LinkAttrs = {
	href: string;
	prefetch?: 'hover' | 'viewport' | 'none';
	prerender?: boolean;
	replace?: boolean;
	target?: string;
	download?: string | boolean;
};

type FakeRouter = {
	push: (to: string) => void;
	replace: (to: string) => void;
	resolve: (to: string) => { matched: unknown[] };
};

let app: ReturnType<typeof createApp> | undefined;

const mountLink = (attrs: LinkAttrs, label: string, router?: FakeRouter) => {
	const container = document.createElement('div');
	document.body.append(container);
	app = createApp({
		render: () => h(Link, attrs, { default: () => label })
	});
	if (router) Reflect.set(app.config.globalProperties, '$router', router);
	app.mount(container);
	const link = container.querySelector('a');
	if (!link) throw new Error('anchor missing');

	return link;
};

const teardown = () => {
	app?.unmount();
	app = undefined;
	document.body.innerHTML = '';
	resetPrefetchState();
	fetched.length = 0;
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

const fakeRouter = () => {
	const pushed: string[] = [];
	const replaced: string[] = [];
	const router: FakeRouter = {
		push: (to) => {
			pushed.push(to);
		},
		replace: (to) => {
			replaced.push(to);
		},
		resolve: (to) => ({ matched: to === '/two' ? [{}] : [] })
	};

	return { pushed, replaced, router };
};

const results: Record<string, unknown> = {};

const rendered = mountLink({ href: '/pricing', prefetch: 'none' }, 'Pricing');
results.render = {
	href: rendered.getAttribute('href'),
	text: rendered.textContent
};
teardown();

const pointer = mountLink({ href: '/pricing', prefetch: 'hover' }, 'Go');
pointer.dispatchEvent(new Event('pointerdown'));
await Bun.sleep(0);
results.pointerdown = [...fetched];
teardown();

const hover = mountLink({ href: '/docs', prefetch: 'hover' }, 'Go');
hover.dispatchEvent(new Event('pointerenter'));
const hoverBefore = [...fetched];
await Bun.sleep(320);
results.hover = { after: [...fetched], before: hoverBefore };
teardown();

const quiet = mountLink({ href: '/quiet', prefetch: 'none' }, 'Go');
quiet.dispatchEvent(new Event('pointerenter'));
quiet.dispatchEvent(new Event('pointerdown'));
await Bun.sleep(320);
results.none = [...fetched];
teardown();

const external = mountLink(
	{ href: 'https://example.com/', prefetch: 'hover' },
	'Go'
);
external.dispatchEvent(new Event('pointerdown'));
await Bun.sleep(0);
results.external = [...fetched];
teardown();

const plain = mountLink({ href: '/two', prefetch: 'none' }, 'Go');
results.plainClickPrevented = click(plain);
teardown();

const pushCase = fakeRouter();
const matched = mountLink(
	{ href: '/two', prefetch: 'none' },
	'Go',
	pushCase.router
);
results.push = { prevented: click(matched), pushed: pushCase.pushed };
teardown();

const replaceCase = fakeRouter();
const replacing = mountLink(
	{ href: '/two', prefetch: 'none', replace: true },
	'Go',
	replaceCase.router
);
results.replace = {
	prevented: click(replacing),
	pushed: replaceCase.pushed,
	replaced: replaceCase.replaced
};
teardown();

const passthrough = fakeRouter();
const modifier = mountLink(
	{ href: '/two', prefetch: 'none' },
	'Go',
	passthrough.router
);
const metaPrevented = click(modifier, { metaKey: true });
const middlePrevented = click(modifier, { button: 1 });
teardown();
const blank = mountLink(
	{ href: '/two', prefetch: 'none', target: '_blank' },
	'Go',
	passthrough.router
);
const blankPrevented = click(blank);
teardown();
const unmatched = mountLink(
	{ href: '/elsewhere', prefetch: 'none' },
	'Go',
	passthrough.router
);
const unmatchedPrevented = click(unmatched);
teardown();
results.passthrough = {
	blankPrevented,
	metaPrevented,
	middlePrevented,
	pushed: passthrough.pushed,
	unmatchedPrevented
};

console.log(JSON.stringify(results));
GlobalRegistrator.unregister();
