import { describe, expect, test } from 'bun:test';
import { blurPlaceholdersForHtml } from '../../../src/build/blurPlaceholders';
import {
	blurPlaceholderFor,
	setBlurPlaceholders
} from '../../../src/utils/imageClient';

/* `types/image.ts` always said `blurDataURL` was "auto-generated for
 * build-time images". Nothing generated it, so `placeholder="blur"` was a
 * prop you could pass that did nothing at all. These cover the two pieces
 * that make the promise true without putting every image in the project
 * into every page. */

const PLACEHOLDERS = {
	'/assets/png/hero.png': 'data:image/webp;base64,HERO',
	'/assets/png/logo.png': 'data:image/webp;base64,LOGO',
	'/assets/png/unused.png': 'data:image/webp;base64,UNUSED'
};

describe('which blurs a page carries', () => {
	/* The reason this is filtered at all. The browser manifest already
	 * ships the whole app's entries on every page; doing that here would
	 * add 255 bytes per image in the project to every page's HTML, for
	 * images most pages never show. */
	test('only the images the page actually renders', () => {
		const html = '<img src="/assets/png/hero.png" alt="" />';

		expect(blurPlaceholdersForHtml(html, PLACEHOLDERS)).toEqual({
			'/assets/png/hero.png': 'data:image/webp;base64,HERO'
		});
	});

	test('several, when the page shows several', () => {
		const html =
			'<img src="/assets/png/hero.png"><img src=\'/assets/png/logo.png\'>';

		expect(
			Object.keys(blurPlaceholdersForHtml(html, PLACEHOLDERS)).sort()
		).toEqual(['/assets/png/hero.png', '/assets/png/logo.png']);
	});

	/* An optimized `src` points at the image endpoint with the original in
	 * a query parameter, so the raw path is not the whole attribute. */
	test('an optimized src still finds its image', () => {
		const html =
			'<img src="/_absolute/image?url=%2Fassets%2Fpng%2Fhero.png&w=640&q=75">';

		expect(
			Object.keys(blurPlaceholdersForHtml(html, PLACEHOLDERS))
		).toEqual(['/assets/png/hero.png']);
	});

	test('a page with no images carries nothing', () => {
		expect(blurPlaceholdersForHtml('<p>words</p>', PLACEHOLDERS)).toEqual(
			{}
		);
	});

	test('nothing generated means nothing to carry', () => {
		expect(
			blurPlaceholdersForHtml('<img src="/assets/png/hero.png">', {})
		).toEqual({});
	});
});

describe('looking a blur up at render time', () => {
	/* The same function runs on the server and after hydration. If only
	 * the server could resolve a blur, the client would recompute the
	 * style without it and strip the placeholder the server just painted. */
	test('by the exact path', () => {
		setBlurPlaceholders(PLACEHOLDERS);

		expect(blurPlaceholderFor('/assets/png/hero.png')).toBe(
			'data:image/webp;base64,HERO'
		);
	});

	test('through an optimized url', () => {
		setBlurPlaceholders(PLACEHOLDERS);

		expect(
			blurPlaceholderFor(
				'/_absolute/image?url=%2Fassets%2Fpng%2Flogo.png&w=640'
			)
		).toBe('data:image/webp;base64,LOGO');
	});

	/* A remote image, one added at runtime, an SVG: no placeholder, and
	 * the component renders as it did before. */
	test('an image with no generated blur resolves to nothing', () => {
		setBlurPlaceholders(PLACEHOLDERS);

		expect(
			blurPlaceholderFor('https://cdn.example.com/photo.jpg')
		).toBeUndefined();
		expect(blurPlaceholderFor(undefined)).toBeUndefined();
		expect(blurPlaceholderFor('')).toBeUndefined();
	});

	test('nothing registered resolves to nothing', () => {
		setBlurPlaceholders({});

		expect(blurPlaceholderFor('/assets/png/hero.png')).toBeUndefined();
	});
});
