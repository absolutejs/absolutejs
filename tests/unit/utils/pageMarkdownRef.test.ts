import { describe, expect, test } from 'bun:test';
import {
	enablePageMarkdown,
	MARKDOWN_SOURCE_HEADER,
	markdownAddressOf,
	markdownAlternateLink
} from '../../../src/utils/pageMarkdownRef';

/* Where a page's Markdown is, and when a page says so. */

describe('a page’s Markdown address', () => {
	test('is the page’s with .md after it, and /index.md for the root', () => {
		expect(markdownAddressOf('/about')).toBe('/about.md');
		expect(markdownAddressOf('/blog/hello/')).toBe('/blog/hello.md');
		expect(markdownAddressOf('/')).toBe('/index.md');
	});
});

describe('the Link header naming it', () => {
	const request = (path: string, headers: Record<string, string> = {}) =>
		new Request(`http://localhost${path}`, { headers });

	test('is written once pages are served as Markdown', () => {
		enablePageMarkdown();

		expect(markdownAlternateLink(request('/about?x=1'))).toBe(
			'</about.md>; rel="alternate"; type="text/markdown"'
		);
	});

	test('not for the plugin’s own request, a file’s address, or no request', () => {
		enablePageMarkdown();

		expect(
			markdownAlternateLink(
				request('/about', { [MARKDOWN_SOURCE_HEADER]: '1' })
			)
		).toBeUndefined();
		expect(markdownAlternateLink(request('/feed.xml'))).toBeUndefined();
		expect(markdownAlternateLink(undefined)).toBeUndefined();
	});
});
