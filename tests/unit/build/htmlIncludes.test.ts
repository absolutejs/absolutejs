import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { expandHtmlIncludes } from '../../../src/build/htmlIncludes';

const ROOT = '/project/html';

const filesystem =
	(files: Record<string, string>) => (path: string) => {
		const source = files[path];
		if (source === undefined) throw new Error(`ENOENT ${path}`);

		return source;
	};

const expand = (page: string, files: Record<string, string>) =>
	expandHtmlIncludes(page, resolve(ROOT, 'pages/Home.html'), {
		readFile: filesystem(files),
		root: ROOT
	});

describe('expandHtmlIncludes', () => {
	test('replaces nested includes, resolving each src against its own file', () => {
		const result = expand(
			'<body><abs-include src="../partials/header.html"></abs-include></body>',
			{
				[resolve(ROOT, 'partials/header.html')]:
					'<header><abs-include src="nav/links.html"/></header>',
				[resolve(ROOT, 'partials/nav/links.html')]: '<a href="/">Home</a>'
			}
		);

		expect(result.html).toBe(
			'<body><header><a href="/">Home</a></header></body>'
		);
		expect(result.dependencies.sort()).toEqual([
			resolve(ROOT, 'partials/header.html'),
			resolve(ROOT, 'partials/nav/links.html')
		]);
	});

	test('fills named and default slots, keeping fallbacks for unfilled ones', () => {
		const layout = `<html><head><abs-slot name="head"><title>Default</title></abs-slot></head><body><abs-slot></abs-slot><footer><abs-slot name="footer">FOOTER_FALLBACK</abs-slot></footer></body></html>`;
		const result = expand(
			`<abs-include src="../layouts/base.html">
	<template slot="head"><title>About</title></template>
	<main>ABOUT_BODY <abs-include src="../partials/cta.html"></abs-include></main>
</abs-include>`,
			{
				[resolve(ROOT, 'layouts/base.html')]: layout,
				[resolve(ROOT, 'partials/cta.html')]: '<button>CTA</button>'
			}
		);

		expect(result.html).toContain('<head><title>About</title></head>');
		expect(result.html).not.toContain('Default');
		expect(result.html).toContain(
			'<main>ABOUT_BODY <button>CTA</button></main>'
		);
		expect(result.html).toContain('<footer>FOOTER_FALLBACK</footer>');
		expect(result.html).not.toContain('abs-slot');
		expect(result.html).not.toContain('<template');
	});

	test('a layout can pass its slots on to another layout', () => {
		const result = expand(
			'<abs-include src="../layouts/docs.html"><p>DOC</p></abs-include>',
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<body><abs-slot></abs-slot></body>',
				[resolve(ROOT, 'layouts/docs.html')]:
					'<abs-include src="base.html"><article><abs-slot></abs-slot></article></abs-include>'
			}
		);

		expect(result.html).toBe('<body><article><p>DOC</p></article></body>');
	});

	test('a cycle fails with the include chain', () => {
		expect(() =>
			expand('<abs-include src="../partials/a.html"></abs-include>', {
				[resolve(ROOT, 'partials/a.html')]:
					'<abs-include src="b.html"></abs-include>',
				[resolve(ROOT, 'partials/b.html')]:
					'<abs-include src="a.html"></abs-include>'
			})
		).toThrow(
			/Include cycle: partials\/a\.html[\s\S]*pages\/Home\.html → partials\/a\.html → partials\/b\.html → partials\/a\.html/
		);
	});

	test('a missing file fails naming the tag and the chain', () => {
		expect(() =>
			expand('<abs-include src="../partials/nope.html"></abs-include>', {})
		).toThrow(
			/<abs-include src="\.\.\/partials\/nope\.html"> in pages\/Home\.html: file not found/
		);
	});

	test("a self-closing include inside another include's content expands both", () => {
		const result = expand(
			'<abs-include src="../layouts/base.html"><p>BODY</p><abs-include src="../partials/cta.html" /></abs-include>',
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<body><abs-slot></abs-slot></body>',
				[resolve(ROOT, 'partials/cta.html')]: '<button>CTA</button>'
			}
		);

		expect(result.html).toBe(
			'<body><p>BODY</p><button>CTA</button></body>'
		);
	});

	test("a self-closing include nested in a layout's own include expands", () => {
		const result = expand(
			'<abs-include src="../layouts/base.html"><main>M</main></abs-include>',
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<abs-include src="shell.html"><abs-include src="../partials/nav.html"/><abs-slot></abs-slot></abs-include>',
				[resolve(ROOT, 'layouts/shell.html')]:
					'<body><abs-slot></abs-slot></body>',
				[resolve(ROOT, 'partials/nav.html')]: '<nav>N</nav>'
			}
		);

		expect(result.html).toBe('<body><nav>N</nav><main>M</main></body>');
	});

	test('self-closing includes inside named slot content expand', () => {
		const result = expand(
			`<abs-include src="../layouts/base.html">
	<template slot="head"><abs-include src="../partials/meta.html"/></template>
	<main>BODY</main>
</abs-include>`,
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<head><abs-slot name="head"></abs-slot></head><body><abs-slot></abs-slot></body>',
				[resolve(ROOT, 'partials/meta.html')]: '<meta name="m">'
			}
		);

		expect(result.html).toContain('<head><meta name="m"></head>');
		expect(result.html).toContain('<main>BODY</main>');
		expect(result.html).not.toContain('abs-include');
	});

	test('mixed self-closing and paired forms, several on one line, nested', () => {
		const result = expand(
			'<abs-include src="../layouts/base.html"><abs-include src="../partials/a.html"/><abs-include src="../partials/b.html"></abs-include><abs-include src="../partials/a.html" /><abs-include src="../layouts/box.html"><abs-include src="../partials/b.html"/></abs-include></abs-include>',
			{
				[resolve(ROOT, 'layouts/base.html')]: '[<abs-slot></abs-slot>]',
				[resolve(ROOT, 'layouts/box.html')]: '(<abs-slot></abs-slot>)',
				[resolve(ROOT, 'partials/a.html')]: 'A',
				[resolve(ROOT, 'partials/b.html')]: 'B'
			}
		);

		expect(result.html).toBe('[ABA(B)]');
	});

	test('quoted attributes containing / and > neither end nor self-close the tag', () => {
		const result = expand(
			`<abs-include src="../layouts/base.html" data-x="a>b/"><abs-include data-y='c/>d' src="../partials/a/b.html"/>|<abs-include src="../partials/a/b.html" data-z="/"></abs-include></abs-include>`,
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<div><abs-slot></abs-slot></div>',
				[resolve(ROOT, 'partials/a/b.html')]: 'AB'
			}
		);

		expect(result.html).toBe('<div>AB|AB</div>');
	});

	test('self-closing abs-slot and template tags are empty elements', () => {
		const result = expand(
			'<abs-include src="../layouts/base.html"><template slot="head"/><p>BODY</p></abs-include>',
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<head><abs-slot name="head"/></head><abs-include src="wrap.html"><abs-slot /></abs-include>',
				[resolve(ROOT, 'layouts/wrap.html')]:
					'<body><abs-slot name="x"/><abs-slot></abs-slot></body>'
			}
		);

		expect(result.html).toBe('<head></head><body><p>BODY</p></body>');
	});

	test('an unclosed include fails naming the file and line', () => {
		expect(() =>
			expand('<p>a</p>\n<div>\n<abs-include src="../partials/a.html">\n', {
				[resolve(ROOT, 'partials/a.html')]: 'A'
			})
		).toThrow(
			/Unclosed <abs-include src="\.\.\/partials\/a\.html"> in pages\/Home\.html:3/
		);
	});

	test('an unclosed tag in an included file names that file and its line', () => {
		expect(() =>
			expand('<abs-include src="../layouts/base.html"/>', {
				[resolve(ROOT, 'layouts/base.html')]:
					'<body>\n<abs-slot name="main">\n</body>'
			})
		).toThrow(/Unclosed <abs-slot name="main"> in layouts\/base\.html:2/);
	});

	test('a stray closing tag fails naming the file and line', () => {
		expect(() =>
			expand('<abs-include src="../partials/a.html"/>\n</abs-include>', {
				[resolve(ROOT, 'partials/a.html')]: 'A'
			})
		).toThrow(
			/<\/abs-include> without a matching <abs-include> in pages\/Home\.html:2/
		);
	});

	test('dependencies include files reached through nested self-closing includes', () => {
		const result = expand(
			'<abs-include src="../layouts/base.html"><abs-include src="../partials/a.html"/></abs-include>',
			{
				[resolve(ROOT, 'layouts/base.html')]:
					'<abs-slot/><abs-include src="../partials/b.html" />',
				[resolve(ROOT, 'partials/a.html')]: 'A',
				[resolve(ROOT, 'partials/b.html')]: 'B'
			}
		);

		expect(result.html).toBe('AB');
		expect(result.dependencies.sort()).toEqual([
			resolve(ROOT, 'layouts/base.html'),
			resolve(ROOT, 'partials/a.html'),
			resolve(ROOT, 'partials/b.html')
		]);
	});

	test('leaves a page without includes untouched', () => {
		const page = '<p>plain <abs-slot></abs-slot></p>';

		expect(expand(page, {})).toEqual({ dependencies: [], html: page });
	});
});
