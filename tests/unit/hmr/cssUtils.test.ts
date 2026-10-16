import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	reloadCSSStylesheets,
	swapCSSStylesheet
} from '../../../src/dev/client/cssUtils';

const waitForDOMTasks = async () => {
	if (!('happyDOM' in window))
		throw new Error('Happy DOM API is unavailable');
	const { happyDOM } = window;
	if (typeof happyDOM !== 'object' || happyDOM === null)
		throw new Error('Happy DOM API is invalid');
	const waitUntilComplete = Reflect.get(happyDOM, 'waitUntilComplete');
	if (typeof waitUntilComplete !== 'function')
		throw new Error('Happy DOM task waiter is unavailable');
	await Reflect.apply(waitUntilComplete, happyDOM, []);
};
const cssOrigin = 'http://localhost';
// Status the fake server answers for a path; anything unlisted is a 200.
const statusByPath = new Map<string, number>();
const requestedPaths: string[] = [];
GlobalRegistrator.register({
	settings: {
		fetch: {
			interceptor: {
				beforeAsyncRequest: ({ request, window: browserWindow }) => {
					const { pathname } = new URL(request.url);
					requestedPaths.push(pathname);
					const status = statusByPath.get(pathname) ?? 200;

					return Promise.resolve(
						new browserWindow.Response(
							status === 200 ? 'body {}' : 'Not Found',
							{
								headers: {
									'access-control-allow-origin': '*',
									'content-type': 'text/css'
								},
								status
							}
						)
					);
				}
			}
		}
	},
	url: cssOrigin
});

afterAll(async () => {
	await waitForDOMTasks();
	await GlobalRegistrator.unregister();
});

const stylesheetLinks = () =>
	document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');

// Records every stylesheet link appended to `<head>`, including a retry
// that loads (or fails) and is removed again before a test could read it.
const recordAddedStylesheets = () => {
	const added: HTMLLinkElement[] = [];
	const observer = new MutationObserver((records) => {
		records.forEach((record) =>
			record.addedNodes.forEach((node) => {
				if (node instanceof HTMLLinkElement) added.push(node);
			})
		);
	});
	observer.observe(document.head, { childList: true });

	return { added, stop: () => observer.disconnect() };
};

const stylesheet = (href: string) => {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	document.head.appendChild(link);

	return link;
};

describe('CSS HMR completion', () => {
	test('keeps the old stylesheet until its replacement loads', async () => {
		document.head.innerHTML = '';
		const original = stylesheet(`${cssOrigin}/indexes/example.old.css`);
		const pending = swapCSSStylesheet('/indexes/example.new.css', (href) =>
			href.includes('example.old')
		);
		const links = document.head.querySelectorAll('link[rel="stylesheet"]');
		const [, replacement] = links;
		expect(links.length).toBe(2);
		expect(original.isConnected).toBe(true);
		expect(replacement).toBeInstanceOf(HTMLLinkElement);
		replacement?.dispatchEvent(new Event('load'));
		expect(await pending).toBe(true);
		// The original node stays (a framework may own it) and takes the
		// new stylesheet; the copy goes once the original has loaded it.
		expect(original.isConnected).toBe(true);
		expect(original.getAttribute('href')).toContain('example.new.css');
		original.dispatchEvent(new Event('load'));
		expect(replacement?.isConnected).toBe(false);
		expect(document.querySelectorAll('link[rel="stylesheet"]').length).toBe(
			1
		);
	});

	test('preserves the old stylesheet when replacement loading fails', async () => {
		document.head.innerHTML = '';
		statusByPath.set('/indexes/unavailable.css', 503);
		const original = stylesheet(`${cssOrigin}/indexes/unavailable.css`);
		const pending = reloadCSSStylesheets({});
		stylesheetLinks()[1]?.dispatchEvent(new Event('error'));
		expect(await pending).toBe(false);
		statusByPath.clear();
		expect(original.isConnected).toBe(true);
		expect(document.querySelectorAll('link[rel="stylesheet"]').length).toBe(
			1
		);
	});

	test('retries one transient stylesheet loading failure', async () => {
		document.head.innerHTML = '';
		const original = stylesheet(`${cssOrigin}/indexes/example.css`);
		const recorder = recordAddedStylesheets();
		const pending = reloadCSSStylesheets({});
		stylesheetLinks()[1]?.dispatchEvent(new Event('error'));
		expect(await pending).toBe(true);
		recorder.stop();
		const [, retry] = recorder.added;
		expect(recorder.added.length).toBe(2);
		expect(retry?.getAttribute('href')).toContain('retry=');
		expect(original.isConnected).toBe(true);
		expect(original.getAttribute('href')).toContain('retry=');
		original.dispatchEvent(new Event('load'));
		expect(retry?.isConnected).toBe(false);
	});

	test('disables a stylesheet that 404s instead of refetching it on every update', async () => {
		document.head.innerHTML = '';
		statusByPath.set('/indexes/deleted.abc123.css', 404);
		const original = stylesheet(`${cssOrigin}/indexes/deleted.abc123.css`);
		const pending = reloadCSSStylesheets({});
		stylesheetLinks()[1]?.dispatchEvent(new Event('error'));
		expect(await pending).toBe(false);
		// Gone: no retry, the original stays in place (a framework may own
		// it) but is disabled.
		expect(stylesheetLinks().length).toBe(1);
		expect(original.isConnected).toBe(true);
		expect(original.disabled).toBe(true);

		const requestsBefore = requestedPaths.length;
		const updates = Array.from({ length: 20 }, () =>
			reloadCSSStylesheets({})
		);
		expect(stylesheetLinks().length).toBe(1);
		expect(await Promise.all(updates)).toEqual(Array(20).fill(true));
		expect(requestedPaths.length).toBe(requestsBefore);
		statusByPath.clear();
	});

	test('re-enables a gone stylesheet once the manifest names a new file', async () => {
		document.head.innerHTML = '';
		statusByPath.set('/indexes/restored.abc123.css', 404);
		const original = stylesheet(`${cssOrigin}/indexes/restored.abc123.css`);
		const gone = reloadCSSStylesheets({});
		stylesheetLinks()[1]?.dispatchEvent(new Event('error'));
		expect(await gone).toBe(false);
		expect(original.disabled).toBe(true);

		const restored = reloadCSSStylesheets({
			RestoredCSS: '/indexes/restored.def456.css'
		});
		const [, replacement] = stylesheetLinks();
		expect(replacement?.getAttribute('href')).toContain(
			'/indexes/restored.def456.css'
		);
		replacement?.dispatchEvent(new Event('load'));
		expect(await restored).toBe(true);
		expect(original.disabled).toBe(false);
		expect(original.getAttribute('href')).toContain('restored.def456.css');
		statusByPath.clear();
	});

	test('backs off a stylesheet after a transient failure', async () => {
		document.head.innerHTML = '';
		statusByPath.set('/indexes/limited.abc123.css', 429);
		const original = stylesheet(`${cssOrigin}/indexes/limited.abc123.css`);
		const recorder = recordAddedStylesheets();
		const pending = reloadCSSStylesheets({});
		stylesheetLinks()[1]?.dispatchEvent(new Event('error'));
		expect(await pending).toBe(false);
		recorder.stop();
		// The clone, then one retry after the probe saw a 429.
		expect(recorder.added.length).toBe(2);
		// Rate limited, not gone: still enabled, but the next update inside
		// the backoff window does not refetch it.
		expect(original.disabled).toBeFalsy();
		expect(await reloadCSSStylesheets({})).toBe(false);
		expect(stylesheetLinks().length).toBe(1);
		statusByPath.clear();
	});

	test('does not refetch unrelated cross-origin stylesheets', async () => {
		document.head.innerHTML = '';
		const external = stylesheet(
			'https://fonts.googleapis.com/css2?family=Poppins'
		);
		expect(await reloadCSSStylesheets({})).toBe(true);
		expect(
			document.head.querySelectorAll('link[rel="stylesheet"]').length
		).toBe(1);
		expect(external.isConnected).toBe(true);
	});
});
