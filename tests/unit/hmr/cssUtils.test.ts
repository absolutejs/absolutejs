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
GlobalRegistrator.register({
	settings: {
		fetch: {
			interceptor: {
				beforeAsyncRequest: ({ window: browserWindow }) =>
					Promise.resolve(
						new browserWindow.Response('body {}', {
							headers: {
								'access-control-allow-origin': '*',
								'content-type': 'text/css'
							}
						})
					)
			}
		}
	},
	url: cssOrigin
});

afterAll(async () => {
	await waitForDOMTasks();
	await GlobalRegistrator.unregister();
});

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
		expect(original.isConnected).toBe(false);
	});

	test('preserves the old stylesheet when replacement loading fails', async () => {
		document.head.innerHTML = '';
		const original = stylesheet(`${cssOrigin}/indexes/example.css`);
		const pending = reloadCSSStylesheets({});
		document
			.querySelectorAll('link[rel="stylesheet"]')[1]
			?.dispatchEvent(new Event('error'));
		document
			.querySelectorAll('link[rel="stylesheet"]')[1]
			?.dispatchEvent(new Event('error'));
		expect(await pending).toBe(false);
		expect(original.isConnected).toBe(true);
		expect(document.querySelectorAll('link[rel="stylesheet"]').length).toBe(
			1
		);
	});

	test('retries one transient stylesheet loading failure', async () => {
		document.head.innerHTML = '';
		const original = stylesheet(`${cssOrigin}/indexes/example.css`);
		const pending = reloadCSSStylesheets({});
		document
			.querySelectorAll('link[rel="stylesheet"]')[1]
			?.dispatchEvent(new Event('error'));
		const [, retry] = document.querySelectorAll('link[rel="stylesheet"]');
		expect(retry?.getAttribute('href')).toContain('retry=');
		retry?.dispatchEvent(new Event('load'));
		expect(await pending).toBe(true);
		expect(original.isConnected).toBe(false);
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
