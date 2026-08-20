import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	reloadCSSStylesheets,
	swapCSSStylesheet
} from '../../../src/dev/client/cssUtils';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(() => GlobalRegistrator.unregister());

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
		const original = stylesheet('http://localhost/indexes/example.old.css');
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
		const original = stylesheet('http://localhost/indexes/example.css');
		const pending = reloadCSSStylesheets({});
		const links = document.head.querySelectorAll('link[rel="stylesheet"]');
		links[1]?.dispatchEvent(new Event('error'));
		expect(await pending).toBe(false);
		expect(original.isConnected).toBe(true);
		expect(links[1]?.isConnected).toBe(false);
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
