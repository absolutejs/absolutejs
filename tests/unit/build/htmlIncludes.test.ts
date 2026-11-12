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

	test('leaves a page without includes untouched', () => {
		const page = '<p>plain <abs-slot></abs-slot></p>';

		expect(expand(page, {})).toEqual({ dependencies: [], html: page });
	});
});
