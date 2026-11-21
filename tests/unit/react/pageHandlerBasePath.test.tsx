import { afterEach, describe, expect, test } from 'bun:test';
import { ABSOLUTE_ROUTE_DATA_MEDIA_TYPE } from '../../../src/mobile/pageProtocol';
import { handleReactPageRequest } from '../../../src/react';

const previous = process.env.ABSOLUTE_BASE_PATH;
afterEach(() => {
	if (previous === undefined) delete process.env.ABSOLUTE_BASE_PATH;
	else process.env.ABSOLUTE_BASE_PATH = previous;
});

const Shell = () => (
	<html lang="en">
		<head>
			<title>Under a base</title>
		</head>
		<body>
			<main>hello</main>
		</body>
	</html>
);

describe('handleReactPageRequest under a base path', () => {
	test('the import map leads <head>, before the entry preload, and the entry is prefixed', async () => {
		process.env.ABSOLUTE_BASE_PATH = '/studio/projects/abc';
		const response = await handleReactPageRequest({
			index: '/react/indexes/Shell.abc.js',
			Page: Shell,
			request: new Request('https://portal.test/')
		});
		const html = await response.text();
		const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'));
		const map = head.indexOf('<script type="importmap"');
		const preload = head.indexOf('rel="modulepreload"');

		expect(map).toBeGreaterThan(-1);
		expect(preload === -1 || map < preload).toBe(true);
		expect(head).toContain(
			'"/react/vendor/":"/studio/projects/abc/react/vendor/"'
		);
		expect(head).toContain(
			'window.__ABSOLUTE_BASE_PATH__="/studio/projects/abc"'
		);
		expect(html).toContain(
			'/studio/projects/abc/react/indexes/Shell.abc.js'
		);
		expect(html).not.toMatch(/src="\/react\/indexes\/Shell/);
	});

	test('route data hands out the entry under the base', async () => {
		process.env.ABSOLUTE_BASE_PATH = '/studio/projects/abc';
		const response = await handleReactPageRequest({
			index: '/react/indexes/Shell.abc.js',
			Page: Shell,
			request: new Request('https://portal.test/', {
				headers: { accept: ABSOLUTE_ROUTE_DATA_MEDIA_TYPE }
			})
		});

		expect((await response.json()).assets.index).toBe(
			'/studio/projects/abc/react/indexes/Shell.abc.js'
		);
	});

	test('without a base the page is unchanged', async () => {
		delete process.env.ABSOLUTE_BASE_PATH;
		const html = await (
			await handleReactPageRequest({
				index: '/react/indexes/Shell.abc.js',
				Page: Shell,
				request: new Request('https://portal.test/')
			})
		).text();

		expect(html).not.toContain('importmap');
		expect(html).not.toContain('__ABSOLUTE_BASE_PATH__');
	});
});
