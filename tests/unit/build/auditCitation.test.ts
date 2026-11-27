import { describe, expect, test } from 'bun:test';
import type { RouteMetadata } from '../../../types/routeMetadata';
import { auditCitation } from '../../../src/build/auditCitation';
import { auditContent } from '../../../src/build/auditContent';
import { clientOnlyDocument } from '../../../src/core/clientOnlyPage';
import { jsonLd } from '../../../src/utils/jsonLd';
import {
	mergeRouteMetadata,
	routeHeadTags
} from '../../../src/utils/routeMetadata';

/* What a page is missing to be cited. The heads here are the ones the
 * framework writes from a route's metadata, so the check reads what a
 * page is really sent with. */

const page = (head: string, body = '<main>Words to quote.</main>') =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const headOf = (metadata: RouteMetadata) =>
	routeHeadTags(mergeRouteMetadata([metadata]))
		.map((tag) => tag.html)
		.join('');

const FULL: RouteMetadata = {
	canonical: 'https://acme.test/post',
	description: 'A post.',
	title: 'Post'
};

describe('a page’s head', () => {
	test('with a title, a description and a canonical address lacks nothing', () => {
		expect(auditCitation(page(headOf(FULL)))).toEqual([]);
	});

	test('is told what it lacks', () => {
		expect(auditCitation(page('<title> </title>'))).toEqual([
			'no title',
			'no description',
			'no canonical address'
		]);
		expect(auditCitation(page(headOf({ title: 'Post' })))).toEqual([
			'no description',
			'no canonical address'
		]);
	});
});

describe('an article', () => {
	const withArticle = (article: Record<string, unknown>) =>
		page(
			`${headOf(FULL)}<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', ...article })}</script>`
		);

	test('with an author and its dates lacks nothing', () => {
		expect(
			auditCitation(
				page(
					headOf({
						...FULL,
						jsonLd: {
							'@type': 'BlogPosting',
							author: { '@type': 'Person', name: 'Ada' },
							dateModified: '2026-02-01',
							datePublished: '2026-01-01',
							headline: 'Post'
						}
					})
				)
			)
		).toEqual([]);
	});

	test('is told what it lacks to be attributed', () => {
		expect(auditCitation(withArticle({ headline: 'Post' }))).toEqual([
			'its Article has no named author, no datePublished, no dateModified'
		]);
	});

	test('with an author who has no name has none', () => {
		expect(
			auditCitation(
				withArticle({
					author: [{ '@type': 'Person' }],
					dateModified: '2026-02-01',
					datePublished: '2026-01-01',
					headline: 'Post'
				})
			)
		).toEqual(['its Article has no named author']);
	});

	test('is found in a graph, written by the JsonLd helper', () => {
		const html = page(
			`${headOf(FULL)}${jsonLd([
				{ '@type': 'WebSite', name: 'Acme', url: 'https://acme.test' },
				{ '@type': 'NewsArticle', headline: 'News' }
			])}`
		);

		expect(auditCitation(html)).toEqual([
			'its NewsArticle has no named author, no datePublished, no dateModified'
		]);
	});
});

describe('JSON-LD that is not JSON', () => {
	test('is said to be unreadable', () => {
		expect(
			auditCitation(
				page(
					`${headOf(FULL)}<script type="application/ld+json">{ not json</script>`
				)
			)
		).toEqual(['1 JSON-LD block that could not be parsed']);
	});
});

describe('a page with nothing to quote', () => {
	test('is not also told what it lacks to be cited', () => {
		expect(auditContent(page('', '<main></main>')).citation).toEqual([]);
		expect(
			auditContent(
				clientOnlyDocument({
					bootstrap: '',
					head: '<head></head>',
					root: '<div id="root"></div>'
				})
			).citation
		).toEqual([]);
	});
});
