import { describe, expect, test } from 'bun:test';
import {
	auditContent,
	sitemapPaths,
	uncoveredRoutes,
	visibleText
} from '../../../src/build/auditContent';
import { clientOnlyDocument } from '../../../src/core/clientOnlyPage';
import { HOLES_QUERY } from '../../../src/core/partialPrerenderEdge';
import {
	renderStreamingSlotPatchTag,
	renderStreamingSlotPlaceholder
} from '../../../src/utils/streamingSlots';

/* What a page says to a reader that runs no JavaScript. The markers are
 * taken from the functions that write them, so a change to what the
 * framework sends is a failure here and not a silent miss. */

const doc = (body: string) =>
	`<!DOCTYPE html><html><head><title>Not body text</title><style>p{color:red}</style></head><body>${body}</body></html>`;

describe('the text a reader is shown', () => {
	test('is the body’s, without scripts, styles, templates and markup', () => {
		expect(
			visibleText(
				doc(
					'<h1>Acme &amp; sons</h1><!-- a comment --><script>var hidden = "words";</script><template><p>later</p></template><p>Made&nbsp;to order.</p>'
				)
			)
		).toBe('Acme & sons Made to order.');
	});

	test('includes what a noscript element says', () => {
		expect(visibleText(doc('<noscript>Turn scripts on</noscript>'))).toBe(
			'Turn scripts on'
		);
	});

	test('counts words, not punctuation', () => {
		expect(auditContent(doc('<p>One — two, three!</p>')).words).toBe(3);
	});
});

describe('a page', () => {
	test('rendered in full has no findings', () => {
		expect(auditContent(doc('<main>Plenty to read here</main>'))).toEqual({
			findings: [],
			notes: [],
			words: 4
		});
	});

	test('with ssr: false is said to be client-only, and not also empty', () => {
		const html = clientOnlyDocument({
			bootstrap: 'window.__INITIAL_PROPS__={}',
			head: '<head><title>App</title></head>',
			root: '<div id="root"></div>'
		});

		expect(auditContent(html).findings.map(({ kind }) => kind)).toEqual([
			'client-only'
		]);
	});

	test('with nothing in it is empty', () => {
		expect(
			auditContent(doc('<main></main>')).findings.map(({ kind }) => kind)
		).toEqual(['empty']);
	});

	test('below the minimum asked for is a finding', () => {
		const html = doc('<main>Three short words</main>');

		expect(auditContent(html, { minWords: 3 }).findings).toEqual([]);
		expect(
			auditContent(html, { minWords: 4 }).findings.map(({ kind }) => kind)
		).toEqual(['below-minimum']);
	});
});

describe('a streamed slot', () => {
	const slot = renderStreamingSlotPlaceholder('latest', '<p>loading</p>');
	const patch = renderStreamingSlotPatchTag('latest', {
		html: '<p>the content, which is in a script</p>'
	});

	test('whose content follows in a script is a finding', () => {
		const result = auditContent(doc(`<h1>Feed</h1>${slot}${patch}`));

		expect(result.words).toBe(2);
		expect(result.findings.map(({ kind }) => kind)).toEqual(['slots']);
		expect(result.findings[0]?.message).toStartWith('1 streamed slot ');
	});

	/* A slot's element also wraps content rendered in place. */
	test('rendered in place is not', () => {
		expect(
			auditContent(
				doc(
					'<div data-absolute-slot="true" id="a"><p>here already</p></div>'
				)
			).findings
		).toEqual([]);
	});

	test('of a page served in edge mode is a hole', () => {
		const loader = `<script>u.searchParams.set(${JSON.stringify(HOLES_QUERY)},"1")</script>`;
		const result = auditContent(
			doc(`<h1>Account</h1>${slot}${slot}${loader}`)
		);

		expect(result.findings.map(({ kind }) => kind)).toEqual(['holes']);
		expect(result.findings[0]?.message).toStartWith('2 dynamic parts ');
	});
});

describe('a Suspense boundary streamed after the shell', () => {
	test('is a note, since its content is in the HTML', () => {
		const result = auditContent(
			doc(
				'<!--$?--><template id="B:0"></template><p>wait</p><!--/$--><div hidden id="S:0"><p>the real content</p></div>'
			)
		);

		expect(result.findings).toEqual([]);
		expect(result.notes).toHaveLength(1);
		expect(result.words).toBe(4);
	});
});

describe('what an audit did not cover', () => {
	test('is the dynamic routes none of the pages checked belongs to', () => {
		expect(
			uncoveredRoutes(
				['/', '/blog/:slug', '/docs/*', '/shop/:id?', '/users/:id'],
				['/', '/blog/hello?ref=1', '/docs/a/b']
			)
		).toEqual(['/shop/:id?', '/users/:id']);
	});
});

describe('a sitemap', () => {
	test('gives its paths, whatever origin it was written with', () => {
		expect(
			sitemapPaths(
				'<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/a?b=1&amp;c=2</loc></url></urlset>'
			)
		).toEqual(['/', '/a?b=1&c=2']);
	});
});
