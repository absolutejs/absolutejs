import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { morphBody } from '../../../src/client/morph';

/* Morphing a document into a newer copy of itself: what must change,
 * and — the reason it exists — what must be left exactly as it was.
 * A node that is kept is the SAME node afterwards, which is what these
 * check by holding on to it across the morph. */

beforeAll(() => GlobalRegistrator.register({ url: 'http://localhost/page' }));
afterAll(() => GlobalRegistrator.unregister());

beforeEach(() => {
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	Array.from(document.body.attributes).forEach(({ name }) =>
		document.body.removeAttribute(name)
	);
});

const page = (body: string, attributes = '') =>
	new DOMParser().parseFromString(
		`<!doctype html><html><head><title>t</title></head><body ${attributes}>${body}</body></html>`,
		'text/html'
	);

const show = (body: string) => {
	document.body.innerHTML = body;
};

const morphTo = (body: string, attributes = '') =>
	morphBody(page(body, attributes));

const node = <Kind extends Element = HTMLElement>(selector: string) => {
	const found = document.querySelector<Kind>(selector);
	if (!found) throw new Error(`no ${selector} in the document`);

	return found;
};

const texts = (selector: string) =>
	Array.from(document.querySelectorAll(selector)).map(
		(element) => element.textContent
	);

describe('what changes', () => {
	test('text, in the node that already held it', () => {
		show('<p id="count">1 item</p>');
		const paragraph = node('#count');

		morphTo('<p id="count">2 items</p>');

		expect(paragraph.textContent).toBe('2 items');
		expect(node('#count')).toBe(paragraph);
	});

	test('attributes: added, changed and removed', () => {
		show('<a id="link" href="/old" class="quiet" title="gone">x</a>');

		morphTo('<a id="link" href="/new" class="loud" rel="next">x</a>');

		const link = node('#link');
		expect(link.getAttribute('href')).toBe('/new');
		expect(link.className).toBe('loud');
		expect(link.getAttribute('rel')).toBe('next');
		expect(link.hasAttribute('title')).toBe(false);
	});

	test('the body’s own attributes', () => {
		morphTo('<p>x</p>', 'class="signed-in" data-theme="dark"');

		expect(document.body.className).toBe('signed-in');
		expect(document.body.getAttribute('data-theme')).toBe('dark');
	});

	test('an element whose tag changed is replaced', () => {
		show('<p id="note">text</p>');

		morphTo('<div id="note">text</div>');

		expect(node('#note').tagName).toBe('DIV');
	});
});

describe('a list', () => {
	const rows = '<li id="a">A</li><li id="b">B</li>';

	/* The case the dev server's patcher gets wrong: it puts a new node
	 * where its OLD neighbours were. */
	test('an item added at the top goes to the top, and the rest are kept', () => {
		show(`<ul>${rows}</ul>`);
		const [first, second] = [node('#a'), node('#b')];

		morphTo(`<ul><li id="new">NEW</li>${rows}</ul>`);

		expect(texts('li')).toEqual(['NEW', 'A', 'B']);
		expect(node('#a')).toBe(first);
		expect(node('#b')).toBe(second);
	});

	test('an item added in the middle and one at the end', () => {
		show(`<ul>${rows}</ul>`);

		morphTo(
			'<ul><li id="a">A</li><li id="m">M</li><li id="b">B</li><li id="z">Z</li></ul>'
		);

		expect(texts('li')).toEqual(['A', 'M', 'B', 'Z']);
	});

	test('an item that is gone is removed, and its neighbours are kept', () => {
		show('<ul><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>');
		const last = node('#c');

		morphTo('<ul><li id="a">A</li><li id="c">C</li></ul>');

		expect(texts('li')).toEqual(['A', 'C']);
		expect(node('#c')).toBe(last);
	});

	/* Rows that changed places are MOVED. Rewriting each row into its
	 * neighbour would give the same text and lose what each row held. */
	test('reordered items are moved, not rewritten into each other', () => {
		show('<ul><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>');
		const [first, second, third] = [node('#a'), node('#b'), node('#c')];

		morphTo('<ul><li id="c">C</li><li id="a">A</li><li id="b">B</li></ul>');

		expect(texts('li')).toEqual(['C', 'A', 'B']);
		expect(
			Array.from(document.querySelectorAll<HTMLElement>('li'))
		).toEqual([third, first, second]);
	});

	test('data-key identifies a row as an id does', () => {
		show('<ul><li data-key="1">one</li><li data-key="2">two</li></ul>');
		const two = node('[data-key="2"]');

		morphTo('<ul><li data-key="2">two</li><li data-key="1">one</li></ul>');

		expect(texts('li')).toEqual(['two', 'one']);
		expect(node('[data-key="2"]')).toBe(two);
	});

	test('rows with no identity are updated where they stand', () => {
		show('<ul><li>one</li><li>two</li></ul>');
		const first = node('li');

		morphTo('<ul><li>uno</li><li>dos</li><li>tres</li></ul>');

		expect(texts('li')).toEqual(['uno', 'dos', 'tres']);
		expect(node('li')).toBe(first);
	});
});

describe('what the visitor did is left alone', () => {
	test('text typed into a field', () => {
		show(
			'<form><input id="note" type="text"><p id="status">old</p></form>'
		);
		const field = node<HTMLInputElement>('#note');
		field.value = 'half-typed';

		morphTo(
			'<form><input id="note" type="text"><p id="status">new</p></form>'
		);

		expect(node<HTMLInputElement>('#note')).toBe(field);
		expect(field.value).toBe('half-typed');
		expect(node('#status').textContent).toBe('new');
	});

	/* Open is the element's state AND its attribute. The server's copy
	 * has no `open`, so syncing it would shut whatever was opened. */
	test('a details element they opened', () => {
		show('<details id="more"><summary>More</summary><p>old</p></details>');
		node<HTMLDetailsElement>('#more').open = true;

		morphTo(
			'<details id="more"><summary>More</summary><p>new</p></details>'
		);

		expect(node<HTMLDetailsElement>('#more').open).toBe(true);
		expect(node('#more p').textContent).toBe('new');
	});

	test('what a script attached to a node', () => {
		show('<button id="save">Save</button><p id="count">1</p>');
		const clicks: number[] = [];
		node('#save').addEventListener('click', () => clicks.push(1));

		morphTo('<button id="save">Save</button><p id="count">2</p>');
		node('#save').click();

		expect(clicks).toEqual([1]);
	});
});

describe('what is not the morph’s to touch', () => {
	/* A framework renders inside an island; the server's copy of it is
	 * the markup from before it hydrated. */
	test('the inside of an island', () => {
		show(
			'<div id="island" data-island="true"><button>clicked 3 times</button></div><p id="count">1</p>'
		);
		const button = node('#island button');

		morphTo(
			'<div id="island" data-island="true"><button>clicked 0 times</button></div><p id="count">2</p>'
		);

		expect(node('#island button')).toBe(button);
		expect(button.textContent).toBe('clicked 3 times');
		expect(node('#count').textContent).toBe('2');
	});

	test.each(['data-absolute-preserve', 'hx-preserve'])(
		'an element marked %s',
		(attribute) => {
			show(`<video id="player" ${attribute} data-at="42"></video>`);
			const player = node('#player');

			morphTo(`<video id="player" ${attribute} data-at="0"></video>`);

			expect(node('#player')).toBe(player);
			expect(player.getAttribute('data-at')).toBe('42');
		}
	);

	test('an island the new copy does not mention is not removed', () => {
		show('<div id="island" data-island="true">live</div><p>x</p>');

		morphTo('<p>x</p>');

		expect(document.querySelector('#island')).not.toBeNull();
	});

	/* A refresh is new data, not new behaviour. */
	test('scripts: one that is there stays, a new one is not added', () => {
		show('<script id="boot">window.__booted = true;</script><p>x</p>');
		const boot = node('#boot');

		morphTo('<script id="other">window.__ran = true;</script><p>y</p>');

		expect(node('#boot')).toBe(boot);
		expect(document.querySelector('#other')).toBeNull();
		expect(Reflect.get(window, '__ran')).toBeUndefined();
	});
});

describe('markup that arrives', () => {
	/* A nonce in fetched HTML is that response's. The browser would
	 * refuse the element under this document's policy. */
	test('carries this document’s nonce, not the response’s', () => {
		document.head.innerHTML = '<style nonce="page-nonce"></style>';
		const style = document.head.querySelector('style');
		if (style) style.nonce = 'page-nonce';

		morphTo('<style id="extra" nonce="response-nonce">p{}</style>');

		expect(node('#extra').getAttribute('nonce')).toBe('page-nonce');
	});

	test('nested markup arrives whole', () => {
		show('<main id="main"></main>');

		morphTo(
			'<main id="main"><section id="s"><h2>Title</h2><p>Body</p></section></main>'
		);

		expect(node('#s h2').textContent).toBe('Title');
		expect(node('#s p').textContent).toBe('Body');
	});
});
