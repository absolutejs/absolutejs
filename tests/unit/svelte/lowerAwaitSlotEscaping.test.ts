import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import {
	AWAIT_HTML_HELPERS_SOURCE,
	AWAIT_SCOPE_CLASS_PLACEHOLDER,
	applyAwaitScopeClass,
	branchMarkupToTemplateLiteral,
	createAwaitScopeClassCapture,
	lowerSvelteAwaitSlotSyntax
} from '../../../src/svelte/lowerAwaitSlotSyntax';

/* A streamed `{#await}` branch becomes an HTML string. Up to beta.181 its
 * `{expressions}` were interpolated raw, so a resolved value like
 * `<img src=x onerror=…>` ran in the browser. Each expression must now be
 * escaped exactly as Svelte's SSR escapes it; these tests render the same
 * markup through Svelte itself and compare. */

const XSS = '<img src=x onerror="window.__xss=1">';
const QUOTES = `"'&<>`;

// Inside the repo so the compiled modules resolve `svelte` from node_modules.
const directory = mkdtempSync(
	join(resolve(import.meta.dir, '../../..'), '.svelte-await-escape-')
);
afterAll(() => rmSync(directory, { force: true, recursive: true }));

/** The helpers as a compile of a component leaves them: with its
 *  scoped-CSS class, or none for a component without a `<style>`. */
const helpersFor = (scopeClass: string) =>
	applyAwaitScopeClass(AWAIT_HTML_HELPERS_SOURCE, scopeClass);

/** Renders branch markup the way the lowered slot does. */
const renderBranch = (markup: string, value: unknown, scopeClass = '') => {
	const run = new Function(
		'value',
		`${helpersFor(scopeClass)}\nreturn ${branchMarkupToTemplateLiteral(markup)};`
	);

	return String(run(value));
};

// A selector matching every element: Svelte gives each one the class.
const STYLE_EVERY_ELEMENT = '<style>* { margin: 0; }</style>';

let componentCount = 0;
/** Renders the same markup through Svelte's own SSR, returning the HTML
 *  and the scoped-CSS class Svelte gave the component. */
const renderWithSvelte = async (markup: string, value: unknown, style = '') => {
	const scopeClass = createAwaitScopeClassCapture();
	const { js } = compile(
		`<script>let { value } = $props();</script>${markup}${style}`,
		{
			cssHash: scopeClass.cssHash,
			filename: 'Reference.svelte',
			generate: 'server'
		}
	);
	componentCount += 1;
	const modulePath = join(directory, `Reference${componentCount}.js`);
	writeFileSync(modulePath, js.code);
	const loaded: { default: Component<{ value: unknown }> } = await import(
		modulePath
	);

	// Svelte marks blocks and `{@html}` with comments; the slot has no
	// hydration to mark for.
	return {
		html: render(loaded.default, { props: { value } }).body.replace(
			/<!--[^>]*-->/g,
			''
		),
		scopeClass: scopeClass.apply(AWAIT_SCOPE_CLASS_PLACEHOLDER)
	};
};

describe('streamed {#await} branch escaping', () => {
	test('escapes an HTML payload in text', () => {
		expect(renderBranch('<p class="done">{value}</p>', XSS)).toBe(
			'<p class="done">&lt;img src=x onerror="window.__xss=1"></p>'
		);
		expect(renderBranch('<p>{value}</p>', QUOTES)).toBe(
			`<p>"'&amp;&lt;></p>`
		);
	});

	test('escapes attribute values and keeps them double-quoted', () => {
		expect(renderBranch('<a href={value}>x</a>', XSS)).toBe(
			'<a href="&lt;img src=x onerror=&quot;window.__xss=1&quot;>">x</a>'
		);
		expect(renderBranch(`<a title='a {value}'>x</a>`, QUOTES)).toBe(
			`<a title="a &quot;'&amp;&lt;>">x</a>`
		);
		expect(
			renderBranch('<p class="x {value}">y</p>', `" onmouseover="x`)
		).toBe('<p class="x &quot; onmouseover=&quot;x">y</p>');
	});

	test('leaves {@html} raw, as Svelte does', () => {
		expect(renderBranch('<div>{@html value}</div>', '<b>bold</b>')).toBe(
			'<div><b>bold</b></div>'
		);
	});

	const markups = [
		'<p class="done">{value}</p>',
		'<a href={value} title="{value}">x</a>',
		`<p class="x {value}" data-x='a{value}"b'>y</p>`,
		'<div class={value} style={value} hidden={value}></div>',
		'<input disabled={value} {value} translate={value}/>',
		'<textarea>{value}</textarea>',
		'<p>{@html value}</p>',
		'<section><h2>{value}</h2><p data-a={value}>{value}!</p></section>',
		'<p class="">a</p><p class="{value}{value}">b</p><br/><img alt=""/>'
	];
	const values: unknown[] = [
		XSS,
		QUOTES,
		'until-found',
		'',
		null,
		undefined,
		0,
		1,
		true,
		false,
		['a', { b: true, c: false }, 0, ['d']],
		{ e: 1, f: 0 }
	];

	/* Each case renders the markup through Svelte and through the slot
	 * with the helpers as that component's compile leaves them: without a
	 * `<style>` (no scoped class), and with one matching every element, so
	 * Svelte adds its class to every element as the slot does. */
	const matchSvelte = async (style: string) => {
		const mismatches: string[] = [];
		for (const markup of markups) {
			for (const value of values) {
				const { html, scopeClass } = await renderWithSvelte(
					markup,
					value,
					style
				);
				const actual = renderBranch(markup, value, scopeClass);
				if (actual !== html) {
					mismatches.push(
						`${markup} with ${JSON.stringify(value)}:\n  svelte: ${html}\n  slot:   ${actual}`
					);
				}
			}
		}

		return mismatches;
	};

	test('matches Svelte SSR output for every value and position', async () => {
		expect(await matchSvelte('')).toEqual([]);
	});

	test('adds the scoped-CSS class wherever Svelte SSR adds it', async () => {
		const { scopeClass } = await renderWithSvelte(
			'<p></p>',
			null,
			STYLE_EVERY_ELEMENT
		);
		expect(scopeClass).toMatch(/^svelte-[a-z0-9]+$/);
		expect(await matchSvelte(STYLE_EVERY_ELEMENT)).toEqual([]);
	});

	test('escapes the pending, then and catch branches of a lowered block', async () => {
		const source = `<script lang="ts">
	let { load }: { load: () => Promise<string> } = $props();
	const label = ${JSON.stringify(XSS)};
</script>

<!-- absolute:stream -->
{#await load()}
	<p class="pending" title={label}>{label}</p>
{:then value}
	<p class="done">{value}</p>
{:catch error}
	<p class="failed">{error.message}</p>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source, 'Page.svelte');
		const resolveBody = lowered.code.match(
			/resolve=\{(async \(\) => \{[\s\S]*\})\} \/>/
		)?.[1];
		const fallback = lowered.code.match(/fallbackHtml=\{(`[^`]*`)\}/)?.[1];
		const evaluate = new Function(
			'load',
			'label',
			`${helpersFor('')}\nreturn { fallback: ${fallback}, resolve: ${resolveBody} };`
		);
		const resolved = evaluate(async () => XSS, XSS);
		const rejected = evaluate(async () => {
			throw new Error(QUOTES);
		}, XSS);

		expect(resolved.fallback).toBe(
			'<p class="pending" title="&lt;img src=x onerror=&quot;window.__xss=1&quot;>">&lt;img src=x onerror="window.__xss=1"></p>'
		);
		expect(await resolved.resolve()).toBe(
			'<p class="done">&lt;img src=x onerror="window.__xss=1"></p>'
		);
		expect(await rejected.resolve()).toBe(
			`<p class="failed">"'&amp;&lt;></p>`
		);
	});

	test('the lowered component compiles with a TS, plain and module script', () => {
		const block = `<!-- absolute:stream -->
{#await load()}
	<p>{label}</p>
{:then value}
	<p class={value}>{@html value}</p>
{/await}`;
		const sources = [
			`<script lang="ts">\n\tconst load = async (): Promise<string> => 'x';\n\tconst label: string = 'y';\n</script>\n${block}`,
			`<script>\n\tconst load = async () => 'x';\n\tconst label = 'y';\n</script>\n${block}`,
			`<script module>\n\texport const label = 'y';\n</script>\n<script>\n\tconst load = async () => 'x';\n</script>\n${block}`,
			block
				.replaceAll('load()', 'Promise.resolve(1)')
				.replace('{label}', 'loading')
		];
		for (const source of sources) {
			const { code } = lowerSvelteAwaitSlotSyntax(source);
			for (const generate of ['server', 'client'] as const) {
				expect(() => compile(code, { generate })).not.toThrow();
			}
		}
	});

	test('rejects expressions that escaping cannot make safe', () => {
		const lower = (branch: string) => () =>
			lowerSvelteAwaitSlotSyntax(
				`<!-- absolute:stream -->\n{#await load()}\n<p>loading</p>\n{:then value}\n${branch}\n{/await}`,
				'Page.svelte'
			);

		expect(lower('<img src="x" onerror={value}>')).toThrow(
			/Page\.svelte: the then branch .*onerror=/
		);
		expect(lower(`<img src="x" onerror="go('{value}')">`)).toThrow(
			/onerror=/
		);
		expect(lower('<button on:click={value}>x</button>')).toThrow(
			/on:click=/
		);
		expect(lower('<p class:active={value}>x</p>')).toThrow(/class:active=/);
		expect(lower('<p {...value}>x</p>')).toThrow(/\{\.\.\.value\}/);
		expect(lower('<p title={@html value}>x</p>')).toThrow(/@html value/);
		expect(lower('{@const doubled = value * 2}<p>{doubled}</p>')).toThrow(
			/Svelte markup \(\{@const/
		);
	});

	test('keeps static markup, comments and raw-text elements verbatim', () => {
		expect(
			renderBranch(
				`<p class='a' data-x=b hidden>{value}</p><!-- {value} --><style>p { color: red; }</style>`,
				'<'
			)
		).toBe(
			`<p class='a' data-x=b hidden>&lt;</p><!-- {value} --><style>p { color: red; }</style>`
		);
		expect(
			renderBranch(
				`<p class='a' data-x=b>{value}</p><b class=c>!</b><style>p { color: red; }</style>`,
				'<',
				'svelte-abc'
			)
		).toBe(
			`<p class='a svelte-abc' data-x=b>&lt;</p><b class="c svelte-abc">!</b><style>p { color: red; }</style>`
		);
	});
});

describe('streamed {#await} branch scoped CSS', () => {
	const source = `<script lang="ts">
	const load = async () => 'ok';
</script>

<main>
	<p class="intro">intro</p>
	<!-- absolute:stream -->
	{#await load()}
		<p class="pending">loading</p>
	{:then value}
		<div><p class="done" data-state={value}>{value}</p></div>
	{:catch error}
		<p class="failed">{error.message}</p>
	{/await}
</main>

<style>
	.intro { color: gray; }
	p.pending { color: blue; }
	div > p.done[data-state] { color: green; }
	.failed { color: red; }
	.nowhere { color: black; }
</style>
`;

	test('Svelte keeps the selectors that only match streamed branch elements', () => {
		const lowered = lowerSvelteAwaitSlotSyntax(source, 'Page.svelte');
		for (const generate of ['server', 'client'] as const) {
			const scopeClass = createAwaitScopeClassCapture();
			const compiled = compile(lowered.code, {
				cssHash: scopeClass.cssHash,
				filename: 'src/Page.svelte',
				generate
			});
			const hash = scopeClass.apply(AWAIT_SCOPE_CLASS_PLACEHOLDER);
			const css = compiled.css?.code ?? '';

			// The same class Svelte's default cssHash gives the component.
			expect(hash).toBe(
				compile(source.replace(/<!--[\s\S]*?\{\/await\}/, ''), {
					filename: 'src/Page.svelte',
					generate
				}).css?.code.match(/svelte-[a-z0-9]+/)?.[0] ?? ''
			);
			expect(css).toContain(`p.pending.${hash}`);
			expect(css).toContain(`p.done[data-state]:where(.${hash})`);
			expect(css).toContain(`.failed.${hash}`);
			expect(css).toContain('(unused) .nowhere');
			expect(
				compiled.warnings
					.filter(({ code }) => code === 'css_unused_selector')
					.map(({ message }) => message)
			).toEqual([expect.stringContaining('.nowhere')]);
			expect(scopeClass.apply(compiled.js.code)).not.toContain(
				AWAIT_SCOPE_CLASS_PLACEHOLDER
			);
		}
	});

	test('a branch may hold elements its page context could not', () => {
		const { code } = lowerSvelteAwaitSlotSyntax(
			`<p>
<!-- absolute:stream -->
{#await load()}<span>…</span>{:then value}<div><p>{value}</p></div>{/await}
</p>
<style>div p { color: red; }</style>`
		);
		for (const generate of ['server', 'client'] as const) {
			expect(() => compile(code, { generate })).not.toThrow();
		}
	});
});
