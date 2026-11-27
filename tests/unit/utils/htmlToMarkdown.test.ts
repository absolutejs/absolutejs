import { describe, expect, test } from 'bun:test';
import {
	htmlToMarkdown,
	inlineStreamedSlots
} from '../../../src/utils/htmlToMarkdown';
import {
	renderStreamingSlotPatchTag,
	renderStreamingSlotPlaceholder
} from '../../../src/utils/streamingSlots';

/* A page's HTML as Markdown. */

const page = (body: string, title = '') =>
	`<!doctype html><html><head><title>${title}</title><style>p{}</style></head><body>${body}</body></html>`;
const convert = async (body: string, title = '') =>
	(await htmlToMarkdown(page(body, title))).trimEnd();

describe('what is converted', () => {
	test('is the page’s <main>, without the site around it', async () => {
		expect(
			await convert(
				'<header>Acme</header><nav><a href="/">Home</a></nav><main><h1>Anvils</h1><p>Made to order.</p></main><footer>© Acme</footer>'
			)
		).toBe('# Anvils\n\nMade to order.');
	});

	test('or its <article>', async () => {
		expect(
			await convert(
				'<div>around</div><article><p>The post.</p></article>'
			)
		).toBe('The post.');
	});

	test('or its body, without navigation, header, footer, aside and forms', async () => {
		expect(
			await convert(
				'<nav>nav</nav><header>header</header><p>The page.</p><aside>aside</aside><form><input value="x">form</form><footer>footer</footer>'
			)
		).toBe('The page.');
	});

	test('is never a script, a style or a template', async () => {
		expect(
			await convert(
				'<main><p>Text.</p><script>var no = 1;</script><style>p{}</style><template><p>no</p></template></main>'
			)
		).toBe('Text.');
	});

	test('is headed by the title when it has no heading of its own', async () => {
		expect(await convert('<p>Body.</p>', 'Acme &amp; sons')).toBe(
			'# Acme & sons\n\nBody.'
		);
		expect(await convert('<h1>Own</h1><p>Body.</p>', 'Title')).toBe(
			'# Own\n\nBody.'
		);
	});
});

describe('text', () => {
	test('headings, paragraphs and breaks', async () => {
		expect(
			await convert('<h1>One</h1><h3>Three</h3><p>A<br>B</p><hr><p>C</p>')
		).toBe('# One\n\n### Three\n\nA  \nB\n\n---\n\nC');
	});

	test('emphasis, code and links', async () => {
		expect(
			await convert(
				'<h1>t</h1><p>Made to <strong>order</strong>, <em>shipped</em> by <a href="/rail (north)">rail</a>, with <code>x_y</code> and <del>delay</del>.</p>'
			)
		).toBe(
			'# t\n\nMade to **order**, *shipped* by [rail](/rail%20%28north%29), with `x_y` and ~~delay~~.'
		);
	});

	test('has its entities decoded and its own Markdown escaped', async () => {
		expect(
			await convert(
				'<h1>t</h1><p>5 * 3 &lt; [20] &amp; &#8212; &#x2014;</p>'
			)
		).toBe('# t\n\n5 \\* 3 \\< \\[20\\] & — —');
	});

	test('of an element it does not know is still text', async () => {
		expect(
			await convert(
				'<h1>t</h1><div><span>in</span> <mark>line</mark></div>'
			)
		).toBe('# t\n\nin line');
	});

	test('images, and none for a data address', async () => {
		expect(
			await convert(
				'<h1>t</h1><p><img src="/a b.png" alt="An anvil"></p><p><img src="data:image/png;base64,AAAA" alt="Inline"></p>'
			)
		).toBe('# t\n\n![An anvil](/a%20b.png)\n\nInline');
	});
});

describe('blocks', () => {
	test('lists, nested and numbered from where they start', async () => {
		expect(
			await convert(
				'<h1>t</h1><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol start="3"><li>c</li><li>d</li></ol>'
			)
		).toBe('# t\n\n- one\n- two\n  - nested\n\n3. c\n4. d');
	});

	test('quotes', async () => {
		expect(
			await convert(
				'<h1>t</h1><blockquote><p>One</p><p>Two</p></blockquote>'
			)
		).toBe('# t\n\n> One\n>\n> Two');
	});

	test('code blocks keep their text as it is, and their language', async () => {
		expect(
			await convert(
				'<h1>t</h1><pre><code class="language-ts">const a = 1 &lt; 2;\n  b(`x`) * [c]</code></pre>'
			)
		).toBe('# t\n\n```ts\nconst a = 1 < 2;\n  b(`x`) * [c]\n```');
	});

	test('tables', async () => {
		expect(
			await convert(
				'<h1>t</h1><table><thead><tr><th>Name</th><th>Price</th></tr></thead><tbody><tr><td>Anvil</td><td>10 | 20</td></tr><tr><td>Hammer</td></tr></tbody></table>'
			)
		).toBe(
			'# t\n\n| Name | Price |\n| --- | --- |\n| Anvil | 10 \\| 20 |\n| Hammer |  |'
		);
	});
});

describe('end tags left out', () => {
	test('are supplied for list items and paragraphs', async () => {
		expect(await convert('<h1>t</h1><ul><li>one<li>two</ul><p>A<p>B')).toBe(
			'# t\n\n- one\n- two\n\nA\n\nB'
		);
	});

	test('and for table rows and cells', async () => {
		expect(
			await convert(
				'<h1>t</h1><table><tr><th>A<th>B<tr><td>1<td>2</table>'
			)
		).toBe('# t\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
	});
});

describe('a streamed slot', () => {
	const slot = renderStreamingSlotPlaceholder('latest', '<p>loading</p>');

	test('is given the content its script would swap in', async () => {
		const html = page(
			`<main><h1>Feed</h1>${slot}</main>${renderStreamingSlotPatchTag('latest', { html: '<p>The <b>newest</b> post</p>' })}`
		);

		expect(await htmlToMarkdown(await inlineStreamedSlots(html))).toBe(
			'# Feed\n\nThe **newest** post\n'
		);
	});

	test('whose payload is a string, too', async () => {
		const html = page(
			`<main><h1>Feed</h1>${slot}</main>${renderStreamingSlotPatchTag('latest', '<p>A string</p>')}`
		);

		expect(await htmlToMarkdown(await inlineStreamedSlots(html))).toBe(
			'# Feed\n\nA string\n'
		);
	});

	test('with nothing streamed is left as it is', async () => {
		const html = page(`<main>${slot}</main>`);

		expect(await inlineStreamedSlots(html)).toBe(html);
	});
});
