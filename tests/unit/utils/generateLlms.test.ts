import { describe, expect, test } from 'bun:test';
import { llmsPagesFrom } from '../../../src/build/llmsPages';
import {
	generateLlms,
	llmsListedPages,
	llmsTitle,
	type LlmsPage
} from '../../../src/utils/generateLlms';

/* The text of the `llms.txt` the build writes from the `llms` config
 * key: a heading, a quoted summary, and lists of links. */

const PAGES: LlmsPage[] = [
	{
		description: 'What Acme makes.',
		path: '/',
		title: 'Acme',
		url: 'https://acme.test/'
	},
	{ path: '/pricing', title: 'Pricing', url: 'https://acme.test/pricing' },
	{ path: '/blog/hello', url: 'https://acme.test/blog/hello' }
];

describe('llms: true', () => {
	test('names the site after the home page and lists the pages', () => {
		expect(generateLlms(true, PAGES)).toBe(
			[
				'# Acme',
				'',
				'> What Acme makes.',
				'',
				'## Pages',
				'',
				'- [Acme](https://acme.test/): What Acme makes.',
				'- [Pricing](https://acme.test/pricing)',
				'- [/blog/hello](https://acme.test/blog/hello)',
				''
			].join('\n')
		);
	});

	test('falls back to the host name, then to nothing', () => {
		const pages: LlmsPage[] = [{ path: '/pricing', url: '/pricing' }];

		expect(llmsTitle(true, pages, 'https://acme.test')).toBe('acme.test');
		expect(llmsTitle(true, pages)).toBeUndefined();
		expect(generateLlms(true, pages)).toStartWith('# Site\n');
	});

	test('with no pages is a heading alone', () => {
		expect(generateLlms({ title: 'Acme' }, [])).toBe('# Acme\n');
	});
});

describe('the config', () => {
	test('sets the name, the summary and the details', () => {
		const text = generateLlms(
			{
				details: 'Prices are in euros.\n\nSupport is by email.',
				summary: 'Anvils,\nmade to order.',
				title: 'Acme Anvils'
			},
			PAGES
		);

		expect(text).toStartWith(
			'# Acme Anvils\n\n> Anvils, made to order.\n\nPrices are in euros.\n\nSupport is by email.\n\n## Pages\n'
		);
	});

	test('leaves out what exclude names and moves what optional names', () => {
		const text = generateLlms(
			{ exclude: ['/pricing'], optional: [/^\/blog\//] },
			PAGES
		);

		expect(text).not.toContain('Pricing');
		expect(text).toEndWith(
			'## Pages\n\n- [Acme](https://acme.test/): What Acme makes.\n\n## Optional\n\n- [/blog/hello](https://acme.test/blog/hello)\n'
		);
	});

	test('writes hand-made sections before the pages', () => {
		const text = generateLlms(
			{
				sections: [
					{
						links: [
							{
								description: 'Every endpoint.',
								title: 'API reference',
								url: 'https://docs.acme.test/api'
							}
						],
						title: 'Docs'
					},
					{ links: [], title: 'Empty' }
				]
			},
			PAGES
		);

		expect(text).toContain(
			'## Docs\n\n- [API reference](https://docs.acme.test/api): Every endpoint.\n\n## Pages\n'
		);
		expect(text).not.toContain('Empty');
	});

	test('pages: false leaves the site’s own pages out', () => {
		const text = generateLlms(
			{
				pages: false,
				sections: [
					{
						links: [{ title: 'Guide', url: '/guide' }],
						title: 'Docs'
					}
				]
			},
			PAGES
		);

		expect(text).toBe(
			'# Acme\n\n> What Acme makes.\n\n## Docs\n\n- [Guide](/guide)\n'
		);
	});
});

describe('what a value cannot do to the file', () => {
	test('a title cannot end its link or start a line', () => {
		const text = generateLlms({ title: 'Acme' }, [
			{
				description: 'One\n## Two',
				path: '/a',
				title: 'A [b](c)\nd',
				url: '/a b(c)'
			}
		]);

		expect(text).toBe(
			'# Acme\n\n## Pages\n\n- [A \\[b\\](c) d](/a%20b%28c%29): One ## Two\n'
		);
	});
});

describe('the pages, from the sitemap’s list', () => {
	test('take a title and a description from the file route at the path', () => {
		expect(
			llmsPagesFrom(
				[
					{ path: '/', url: 'https://acme.test/' },
					{ path: '/spa', url: 'https://acme.test/spa' }
				],
				[{ description: 'Home.', path: '/', title: 'Acme' }]
			)
		).toEqual([
			{
				description: 'Home.',
				path: '/',
				title: 'Acme',
				url: 'https://acme.test/'
			},
			{ path: '/spa', url: 'https://acme.test/spa' }
		]);
	});

	test('are written from the root when the site’s address is a placeholder', () => {
		expect(
			llmsPagesFrom(
				[
					{ path: '/', url: 'http://localhost:3000' },
					{ path: '/a', url: 'http://localhost:3000/a' }
				],
				[],
				{ placeholderOrigin: 'http://localhost:3000' }
			).map((page) => page.url)
		).toEqual(['/', '/a']);
	});

	test('list a page once under i18n, in the default locale', () => {
		expect(
			llmsPagesFrom(
				[
					{ locale: 'fr', path: '/a', url: 'https://acme.test/fr/a' },
					{ locale: 'en', path: '/a', url: 'https://acme.test/a' },
					{ locale: 'de', path: '/a', url: 'https://acme.test/de/a' }
				],
				[],
				{ defaultLocale: 'en' }
			)
		).toEqual([{ path: '/a', url: 'https://acme.test/a' }]);
	});
});

describe('full', () => {
	test('links llms-full.txt ahead of the pages', () => {
		const text = generateLlms({ full: true, title: 'Acme' }, PAGES);

		expect(text).toContain(
			'## Full text\n\n- [llms-full.txt](/llms-full.txt): The text of every page, in one file.\n\n## Pages'
		);
		expect(
			generateLlms({ full: true }, PAGES, 'https://acme.test/')
		).toContain('(https://acme.test/llms-full.txt)');
	});

	test('is not linked when it is off, or has no pages to hold', () => {
		expect(generateLlms(true, PAGES)).not.toContain('llms-full');
		expect(
			generateLlms({ full: true, pages: false, title: 'Acme' }, PAGES)
		).not.toContain('llms-full');
	});

	test('holds the listed pages, the optional ones last', () => {
		const { main, optional } = llmsListedPages(
			{ exclude: ['/pricing'], optional: ['/'] },
			PAGES
		);

		expect(main.map((page) => page.path)).toEqual(['/blog/hello']);
		expect(optional.map((page) => page.path)).toEqual(['/']);
	});
});
