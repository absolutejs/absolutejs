import { describe, expect, test } from 'bun:test';
import { generateHeadElement } from '../../../src/utils/generateHeadElement';

describe('generateHeadElement', () => {
	test('generates head with defaults', () => {
		const head = generateHeadElement();
		expect(head).toContain('<title>AbsoluteJS</title>');
		expect(head).toContain('content="A page created using AbsoluteJS"');
		expect(head).toContain('favicon.ico');
		expect(head).toContain('<meta charset="UTF-8">');
		expect(head).toContain('viewport');
	});

	test('uses custom title', () => {
		const head = generateHeadElement({ title: 'My App' });
		expect(head).toContain('<title>My App</title>');
	});

	test('uses custom description', () => {
		const head = generateHeadElement({ description: 'A cool app' });
		expect(head).toContain('content="A cool app"');
	});

	test('includes single CSS path', () => {
		const head = generateHeadElement({ cssPath: '/styles/main.css' });
		expect(head).toContain(
			'<link rel="stylesheet" href="/styles/main.css" type="text/css">'
		);
	});

	test('includes multiple CSS paths', () => {
		const head = generateHeadElement({
			cssPath: ['/styles/a.css', '/styles/b.css']
		});
		expect(head).toContain('href="/styles/a.css"');
		expect(head).toContain('href="/styles/b.css"');
	});

	test('includes font preconnect when font provided', () => {
		const head = generateHeadElement({ font: 'Inter' });
		expect(head).toContain('fonts.googleapis.com');
		expect(head).toContain('fonts.gstatic.com');
		expect(head).toContain('family=Inter');
	});

	test('omits font when not provided', () => {
		const head = generateHeadElement();
		expect(head).not.toContain('fonts.googleapis.com');
	});

	test('uses custom icon', () => {
		const head = generateHeadElement({ icon: '/custom-icon.png' });
		expect(head).toContain('href="/custom-icon.png"');
	});

	test('omits CSS link when no cssPath', () => {
		const head = generateHeadElement();
		expect(head).not.toContain('rel="stylesheet"');
	});
});

describe('generateHeadElement preload + speculation rules', () => {
	test('emits preload and modulepreload links next to the preconnect block', () => {
		const head = generateHeadElement({
			font: 'Inter',
			preload: [
				{ as: 'style', href: '/styles/main.css' },
				{ href: '/react/indexes/Home.js', module: true },
				{ as: 'font', crossorigin: 'anonymous', href: '/fonts/a.woff2' }
			]
		});
		expect(head).toContain(
			'<link rel="preload" href="/styles/main.css" as="style">'
		);
		expect(head).toContain(
			'<link rel="modulepreload" href="/react/indexes/Home.js">'
		);
		expect(head).toContain(
			'<link rel="preload" href="/fonts/a.woff2" as="font" crossorigin="anonymous">'
		);
		expect(head.indexOf('rel="preconnect"')).toBeLessThan(
			head.indexOf('rel="preload"')
		);
	});

	test('emits a speculationrules script with prerender and prefetch lists', () => {
		const head = generateHeadElement({
			speculationRules: { prefetch: ['/about'], prerender: ['/pricing'] }
		});
		expect(head).toContain(
			'<script type="speculationrules">{"prerender":[{"urls":["/pricing"]}],"prefetch":[{"urls":["/about"]}]}</script>'
		);
	});

	test('drops empty speculation rules and escapes < in URLs', () => {
		expect(generateHeadElement({ speculationRules: {} })).not.toContain(
			'speculationrules'
		);
		expect(
			generateHeadElement({ speculationRules: { prerender: [] } })
		).not.toContain('speculationrules');
		const head = generateHeadElement({
			speculationRules: { prerender: ['/a</script>'] }
		});
		expect(head).toContain('\\u003c/script>');
		expect(head).not.toContain('/a</script>');
	});

	test('omits preload and speculation output when neither is configured', () => {
		const head = generateHeadElement({ title: 'Plain' });
		expect(head).not.toContain('rel="preload"');
		expect(head).not.toContain('modulepreload');
		expect(head).not.toContain('speculationrules');
	});
});

/* Everything a page passes as metadata ends up inside this string, and
 * most of it is not written by the developer: a product name becomes the
 * title, a post's summary the description, a slug the canonical URL. None
 * of it was escaped — only the `hreflang` links were.
 *
 * These parse the output rather than search it for a substring, because
 * "the payload text is absent" and "the payload did not become markup"
 * are different claims and only the second one is the point. */
describe('metadata that is not the developer’s own text', () => {
	const elementsOf = (head: string, tag: string) =>
		[...head.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, 'giu'))].map(
			(match) => match[0]
		);

	test('a title cannot close its element and open another', () => {
		const head = generateHeadElement({
			title: 'Shoes</title><script>alert(1)</script>'
		});

		expect(elementsOf(head, 'script')).toHaveLength(0);
		expect(head.match(/<\/title>/gu)).toHaveLength(1);
		expect(head).toContain(
			'<title>Shoes&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>'
		);
	});

	/* The description is repeated into Open Graph and Twitter tags when
	 * those are on, so one unescaped value was three ways out. */
	test('a quote in a description stays inside its attribute', () => {
		const head = generateHeadElement({
			description: 'Size 9" wide" onload="alert(2)',
			openGraph: {},
			twitter: {}
		});
		const metas = elementsOf(head, 'meta').filter((meta) =>
			meta.includes('Size 9')
		);

		expect(metas).toHaveLength(3);
		for (const meta of metas) {
			expect(meta).toContain(
				'content="Size 9&quot; wide&quot; onload=&quot;alert(2)"'
			);
			// exactly the two attributes it should have, and no third
			expect(meta).toMatch(
				/^<meta (?:name|property)="[^"]*" content="[^"]*">$/u
			);
		}
	});

	test('a URL cannot break out of href', () => {
		const head = generateHeadElement({
			canonical: 'https://x.test/p?q="><script>alert(3)</script>'
		});

		expect(elementsOf(head, 'script')).toHaveLength(0);
		expect(head).toContain(
			'href="https://x.test/p?q=&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;"'
		);
	});

	test.each([
		['openGraph.title', { openGraph: { title: 'a"><script>x</script>' } }],
		['openGraph.image', { openGraph: { image: 'a"><script>x</script>' } }],
		['twitter.site', { twitter: { site: 'a"><script>x</script>' } }],
		[
			'meta content',
			{ meta: [{ content: 'a"><script>x</script>', name: 'author' }] }
		],
		[
			'meta name',
			{ meta: [{ content: 'ok', name: 'a"><script>x</script>' }] }
		],
		['cssPath', { cssPath: 'a"><script>x</script>' }],
		['icon', { icon: 'a"><script>x</script>' }],
		['font', { font: 'a"><script>x</script>' }],
		['preload href', { preload: [{ href: 'a"><script>x</script>' }] }]
	])('%s cannot inject markup', (_label, metadata) => {
		expect(
			elementsOf(generateHeadElement(metadata), 'script')
		).toHaveLength(0);
	});

	test('an ampersand in ordinary text is escaped', () => {
		const head = generateHeadElement({
			canonical: 'https://x.test/?a=1&b=2',
			title: 'Fish & Chips'
		});

		expect(head).toContain('<title>Fish &amp; Chips</title>');
		expect(head).toContain('href="https://x.test/?a=1&amp;b=2"');
	});

	/* Until now the only way to get a safe title was to escape it by
	 * hand. Re-escaping those would turn every `&amp;` on such a site
	 * into a visible `&amp;amp;`. A reference left in place decodes to a
	 * character and never to markup, so leaving it is safe. */
	test('text that was already escaped by hand is not escaped twice', () => {
		const head = generateHeadElement({
			description: 'A &quot;quoted&quot; &#8212; &#x2014; thing',
			title: 'Tom &amp; Jerry &copy; 2026'
		});

		expect(head).toContain('<title>Tom &amp; Jerry &copy; 2026</title>');
		expect(head).toContain(
			'content="A &quot;quoted&quot; &#8212; &#x2014; thing"'
		);
		expect(head).not.toContain('&amp;amp;');
		expect(head).not.toContain('&amp;quot;');
	});

	test('plain metadata comes out exactly as before', () => {
		const head = generateHeadElement({
			canonical: 'https://x.test/pricing',
			description: 'Plans and pricing',
			title: 'Pricing'
		});

		expect(head).toContain('<title>Pricing</title>');
		expect(head).toContain(
			'<meta name="description" content="Plans and pricing">'
		);
		expect(head).toContain(
			'<link rel="canonical" href="https://x.test/pricing">'
		);
	});
});
