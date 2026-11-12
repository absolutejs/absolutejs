import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Head } from '../../../src/react/components/Head';

describe('React Head fonts', () => {
	test('renders font preloads and the linked font stylesheet before page CSS', () => {
		const html = renderToStaticMarkup(
			<Head
				cssPath="/page.css"
				fonts={{
					preload: [
						'/assets/fonts/poppins-latin-400-normal.1a2b3c4d.woff2'
					],
					stylesheets: ['/assets/fonts/fonts.1a2b3c4d.css']
				}}
			/>
		);
		expect(html).toContain(
			'<link as="font" crossorigin="anonymous" href="/assets/fonts/poppins-latin-400-normal.1a2b3c4d.woff2" rel="preload" type="font/woff2"/>'
		);
		expect(html).toContain(
			'<link data-absolute-fonts="" href="/assets/fonts/fonts.1a2b3c4d.css" rel="stylesheet"/>'
		);
		expect(html.indexOf('fonts.1a2b3c4d.css')).toBeLessThan(
			html.indexOf('/page.css')
		);
		expect(html).not.toContain('fonts.googleapis.com');
		expect(html).not.toContain('<style');
	});

	test('adds preconnects only for a remote fallback stylesheet', () => {
		const html = renderToStaticMarkup(
			<Head
				fonts={{
					preload: [],
					stylesheets: [
						'https://fonts.googleapis.com/css2?family=Poppins:wght@400&display=swap'
					]
				}}
			/>
		);
		expect(html).toContain(
			'<link crossorigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect"/>'
		);
		expect(html).toContain(
			'<link href="https://fonts.googleapis.com" rel="preconnect"/>'
		);
	});
});
