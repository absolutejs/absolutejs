import { describe, expect, test } from 'bun:test';
import type { RouteMetadata } from '../../../types/routeMetadata';
import {
	mergeRouteMetadata,
	routeHeadTags
} from '../../../src/utils/routeMetadata';

/* A file route's metadata: how the levels above a route and the route's
 * own are merged, and the tags the result becomes. */

const titleOf = (...levels: RouteMetadata[]) =>
	mergeRouteMetadata(levels).title;

const htmlOf = (metadata: RouteMetadata) =>
	routeHeadTags(mergeRouteMetadata([metadata])).map((tag) => tag.html);

describe('a route’s title', () => {
	test('is its own, when nothing above it says how titles are formed', () => {
		expect(titleOf({ title: 'About' })).toBe('About');
	});

	test('is formed by the template of a folder above it', () => {
		expect(
			titleOf({ title: { template: '%s | Acme' } }, { title: 'About' })
		).toBe('About | Acme');
	});

	test('is the folder’s default when the route sets none', () => {
		expect(
			titleOf({ title: { default: 'Acme', template: '%s | Acme' } }, {})
		).toBe('Acme');
	});

	/* A template is for the levels below the one that declares it: the
	 * site's own name is not "Acme | Acme". */
	test('a level’s template does not apply to that level’s own default', () => {
		expect(
			titleOf({ title: { default: 'Acme', template: '%s | Acme' } })
		).toBe('Acme');
	});

	test('`absolute` is used exactly, whatever the template', () => {
		expect(
			titleOf(
				{ title: { template: '%s | Acme' } },
				{ title: { absolute: 'Sign in' } }
			)
		).toBe('Sign in');
	});

	test('the nearest template wins', () => {
		expect(
			titleOf(
				{ title: { template: '%s | Acme' } },
				{ title: { default: 'Blog', template: '%s | Acme Blog' } },
				{ title: 'Hello' }
			)
		).toBe('Hello | Acme Blog');
	});

	test('a folder’s plain title is inherited by a route that sets none', () => {
		expect(titleOf({ title: 'Docs' }, {})).toBe('Docs');
	});

	test('no level setting one leaves none', () => {
		expect(titleOf({}, { description: 'x' })).toBeUndefined();
	});
});

describe('merging the rest', () => {
	test('a nearer level replaces a farther one’s value', () => {
		expect(
			mergeRouteMetadata([
				{ canonical: '/a', description: 'site' },
				{ description: 'page' }
			])
		).toMatchObject({ canonical: '/a', description: 'page' });
	});

	/* A layout names the site once; a page adds what is its own. */
	test('Open Graph, Twitter and robots are merged field by field', () => {
		expect(
			mergeRouteMetadata([
				{
					openGraph: { siteName: 'Acme', type: 'website' },
					robots: { follow: true, index: true },
					twitter: { site: '@acme' }
				},
				{
					openGraph: { type: 'article' },
					robots: { index: false },
					twitter: { card: 'summary' }
				}
			])
		).toMatchObject({
			openGraph: { siteName: 'Acme', type: 'article' },
			robots: { follow: true, index: false },
			twitter: { card: 'summary', site: '@acme' }
		});
	});

	test('custom tags accumulate, a nearer one replacing a farther one of the same name', () => {
		expect(
			mergeRouteMetadata([
				{
					meta: [
						{ content: 'a', name: 'author' },
						{ content: 'site', name: 'theme-color' }
					]
				},
				{ meta: [{ content: 'page', name: 'theme-color' }] }
			]).meta
		).toEqual([
			{ content: 'a', name: 'author' },
			{ content: 'page', name: 'theme-color' }
		]);
	});
});

describe('the tags a route’s metadata becomes', () => {
	test('are only what was given: nothing is defaulted', () => {
		expect(htmlOf({ title: 'About' })).toEqual([
			'<title data-absolute-meta="">About</title>'
		]);
		expect(htmlOf({})).toEqual([]);
	});

	test('are each marked, so the browser can replace exactly these', () => {
		const tags = htmlOf({
			canonical: 'https://acme.test/about',
			description: 'About us',
			robots: { index: false },
			title: 'About'
		});

		expect(tags).toHaveLength(4);
		expect(tags.every((tag) => tag.includes('data-absolute-meta'))).toBe(
			true
		);
		expect(tags).toContain(
			'<meta name="description" content="About us" data-absolute-meta="">'
		);
		expect(tags).toContain(
			'<link rel="canonical" href="https://acme.test/about" data-absolute-meta="">'
		);
		expect(tags).toContain(
			'<meta name="robots" content="noindex" data-absolute-meta="">'
		);
	});

	/* A post's title is not written by the developer. */
	test('escape what they are given', () => {
		const [title, description] = htmlOf({
			description: 'a "quoted" <b>claim</b>',
			title: '</title><script>alert(1)</script>'
		});

		expect(title).toBe(
			'<title data-absolute-meta="">&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>'
		);
		expect(description).toContain(
			'content="a &quot;quoted&quot; &lt;b&gt;claim&lt;/b&gt;"'
		);
	});

	test('a card with no title of its own takes the page’s', () => {
		const tags = htmlOf({
			description: 'A post',
			openGraph: { type: 'article' },
			title: 'Hello',
			twitter: { card: 'summary' }
		});

		expect(tags).toContain(
			'<meta property="og:title" content="Hello" data-absolute-meta="">'
		);
		expect(tags).toContain(
			'<meta property="og:description" content="A post" data-absolute-meta="">'
		);
		expect(tags).toContain(
			'<meta name="twitter:title" content="Hello" data-absolute-meta="">'
		);
	});

	test('no card is written for a route that asked for none', () => {
		expect(
			htmlOf({ title: 'Hello' }).some((tag) => tag.includes('og:'))
		).toBe(false);
	});

	test('each tag says what it is the only one of', () => {
		const tags = routeHeadTags(
			mergeRouteMetadata([
				{
					alternates: [{ href: '/fr', hreflang: 'fr' }],
					canonical: '/x',
					description: 'd',
					jsonLd: { '@type': 'Article', headline: 'h' },
					meta: [{ content: 'c', property: 'article:author' }],
					title: 't'
				}
			])
		);

		expect(tags.map((tag) => tag.identity)).toEqual([
			'title',
			'meta:name:description',
			'link:canonical',
			'link:alternate:fr',
			'meta:property:article:author',
			// Structured data is not the only one of anything.
			undefined
		]);
	});
});
