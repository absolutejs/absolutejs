import { describe, expect, test } from 'bun:test';
import { rewriteHead, withRouteHead } from '../../../src/core/routeHead';
import { runWithAbsoluteRequest } from '../../../src/core/requestContext';
import { markCurrentRouteHead } from '../../../src/utils/fileRouteRef';
import {
	mergeRouteMetadata,
	routeHeadTags
} from '../../../src/utils/routeMetadata';
import type { RouteMetadata } from '../../../types/routeMetadata';

/* A route's metadata going into the document it is for: added to the
 * head, and replacing whatever the page wrote that says the same
 * thing. */

const tagsOf = (metadata: RouteMetadata) =>
	routeHeadTags(mergeRouteMetadata([metadata]));

const rewrite = (html: string, metadata: RouteMetadata) =>
	rewriteHead(html, tagsOf(metadata));

describe('a route’s tags in a document’s head', () => {
	test('are added at the end of it, the body untouched', () => {
		const { dropped, html } = rewrite(
			'<!doctype html><html><head><meta charset="utf-8"></head><body><title>not this</title></body></html>',
			{ title: 'About' }
		);

		expect(html).toBe(
			'<!doctype html><html><head><meta charset="utf-8"><title data-absolute-meta="">About</title></head><body><title>not this</title></body></html>'
		);
		expect(dropped).toEqual([]);
	});

	test('replace the page’s own title', () => {
		const { dropped, html } = rewrite(
			'<html><head><title>Hand written</title></head><body></body></html>',
			{ title: 'About' }
		);

		expect(html).toBe(
			'<html><head><title data-absolute-meta="">About</title></head><body></body></html>'
		);
		expect(dropped).toEqual(['title']);
	});

	test('replace the page’s tag of the same name, however it was written', () => {
		const { dropped, html } = rewrite(
			`<html><head><meta name="description" content="one"/><meta content='two' name='description'><META NAME=description CONTENT=three><meta name="viewport" content="w"></head></html>`,
			{ description: 'from the route' }
		);

		expect(html.match(/description/gi)).toHaveLength(1);
		expect(html).toContain('content="from the route"');
		// A tag the route says nothing about stays.
		expect(html).toContain('<meta name="viewport" content="w">');
		expect(dropped).toEqual(['meta:name:description']);
	});

	test('tell a name from another that starts the same', () => {
		const { html } = rewrite(
			'<html><head><meta name="description-long" content="keep"><meta name="description" content="go"></head></html>',
			{ description: 'new' }
		);

		expect(html).toContain('name="description-long" content="keep"');
		expect(html).not.toContain('content="go"');
	});

	test('replace a canonical link and leave other links alone', () => {
		const { html } = rewrite(
			'<html><head><link rel="stylesheet" href="/a.css"><link href="/old" rel="canonical"></head></html>',
			{ canonical: '/new' }
		);

		expect(html).toContain('<link rel="stylesheet" href="/a.css">');
		expect(html).not.toContain('/old');
		expect(html).toContain('href="/new"');
	});

	test('replace an Open Graph tag by its property', () => {
		const { html } = rewrite(
			'<html><head><meta property="og:title" content="old"><meta property="og:image" content="/keep.png"></head></html>',
			{ openGraph: { title: 'new' } }
		);

		expect(html).not.toContain('content="old"');
		expect(html).toContain('property="og:image" content="/keep.png"');
	});

	test('leave alone what the route does not set', () => {
		const head =
			'<html><head><title>Mine</title><meta name="description" content="mine"></head></html>';

		expect(rewrite(head, { canonical: '/x' }).dropped).toEqual([]);
		expect(rewrite(head, { canonical: '/x' }).html).toContain(
			'<title>Mine</title>'
		);
	});

	test('a document with no head is returned as it is', () => {
		expect(rewrite('<p>fragment</p>', { title: 'x' })).toEqual({
			dropped: [],
			html: '<p>fragment</p>'
		});
	});
});

/* A response whose body arrives in pieces: a React page is streamed, in
 * chunks of a fixed size that take no notice of where the head ends. */
const inPieces = (pieces: string[], status = 200) =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				pieces.forEach((piece) =>
					controller.enqueue(encoder.encode(piece))
				);
				controller.close();
			}
		}),
		{ headers: { 'content-type': 'text/html' }, status }
	);

const served = (response: () => Response, metadata?: RouteMetadata) =>
	runWithAbsoluteRequest(new Request('http://localhost/x'), async () => {
		if (metadata) markCurrentRouteHead(tagsOf(metadata));

		return withRouteHead(response()).text();
	});

describe('a page response given its route’s head', () => {
	test('whose head is split across pieces of the stream', async () => {
		const html = await served(
			() =>
				inPieces([
					'<!doctype html><html><head><title>Ha',
					'nd written</title><meta char',
					'set="utf-8"></he',
					'ad><body><p>one</p>',
					'<p>two</p></body></html>'
				]),
			{ title: 'About' }
		);

		expect(html).toBe(
			'<!doctype html><html><head><meta charset="utf-8"><title data-absolute-meta="">About</title></head><body><p>one</p><p>two</p></body></html>'
		);
	});

	test('is untouched when its route asked for nothing', async () => {
		const page =
			'<html><head><title>Mine</title></head><body></body></html>';

		expect(await served(() => inPieces([page]))).toBe(page);
	});

	/* An error page is not the page the metadata describes. */
	test('is untouched when it is not the page that was asked for', async () => {
		const page =
			'<html><head><title>Error</title></head><body></body></html>';

		expect(
			await served(() => inPieces([page], 500), { title: 'About' })
		).toBe(page);
	});

	test('with no head at all, arrives whole and unchanged', async () => {
		expect(
			await served(() => inPieces(['<p>a ', 'fragment</p>']), {
				title: 'About'
			})
		).toBe('<p>a fragment</p>');
	});

	test('keeps characters that are split across pieces', async () => {
		const bytes = new TextEncoder().encode(
			'<html><head><title>x</title></head><body>café — naïve</body></html>'
		);
		const cut = bytes.indexOf(0xc3) + 1;
		const response = () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(bytes.slice(0, cut));
						controller.enqueue(bytes.slice(cut));
						controller.close();
					}
				}),
				{ headers: { 'content-type': 'text/html' } }
			);

		expect(await served(response, { title: 'y' })).toContain(
			'café — naïve'
		);
	});
});
