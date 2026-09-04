import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Head } from '../../../src/react/components/Head';

describe('React Head preload + speculation rules', () => {
	test('renders preload, modulepreload and speculationrules tags', () => {
		const html = renderToStaticMarkup(
			<Head
				preload={[
					{ as: 'style', href: '/styles/main.css' },
					{ href: '/react/indexes/Home.js', module: true },
					{
						as: 'font',
						crossorigin: 'anonymous',
						href: '/fonts/a.woff2'
					}
				]}
				speculationRules={{ prerender: ['/pricing'] }}
			/>
		);
		expect(html).toContain(
			'<link as="style" href="/styles/main.css" rel="preload"/>'
		);
		expect(html).toContain(
			'<link href="/react/indexes/Home.js" rel="modulepreload"/>'
		);
		expect(html).toContain(
			'<link as="font" crossorigin="anonymous" href="/fonts/a.woff2" rel="preload"/>'
		);
		expect(html).toContain(
			'<script type="speculationrules">{"prerender":[{"urls":["/pricing"]}]}</script>'
		);
	});

	test('renders nothing extra without preload or speculation rules', () => {
		const html = renderToStaticMarkup(<Head title="Plain" />);
		expect(html).not.toContain('rel="preload"');
		expect(html).not.toContain('speculationrules');
	});
});
