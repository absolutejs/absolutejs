import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	auditLinks,
	collectLinks,
	deadLinkWarning,
	pathMatchesPattern
} from '../../../src/build/auditLinks';

/* The dead-link check: the typo `route()` cannot catch, because a
 * template attribute is not a typed position and an HTML route is not a
 * typed language.
 *
 * Both of the false positives it produced before these tests existed are
 * pinned here: an `href` on a `<link rel>` element, and a file under the
 * project's own `build/` output. */

const roots: string[] = [];

const makeProject = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-audit-links-'));
	roots.push(root);
	await Promise.all(
		Object.entries(files).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);

	return root;
};

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('pathMatchesPattern', () => {
	test('matches exactly, by param and by wildcard', () => {
		expect(pathMatchesPattern('/pricing', '/pricing')).toBe(true);
		expect(pathMatchesPattern('/blog/:slug', '/blog/hello')).toBe(true);
		expect(pathMatchesPattern('/docs/*', '/docs/a/b/c')).toBe(true);
		expect(pathMatchesPattern('/', '/')).toBe(true);
	});

	test('does not match a different path, depth or empty segment', () => {
		expect(pathMatchesPattern('/pricing', '/pricng')).toBe(false);
		expect(pathMatchesPattern('/blog/:slug', '/blog')).toBe(false);
		expect(pathMatchesPattern('/blog/:slug', '/blog/a/b')).toBe(false);
		expect(pathMatchesPattern('/blog/:slug', '/blog/')).toBe(false);
	});
});

describe('collectLinks', () => {
	test('finds a link in each kind of source, with its line', async () => {
		const root = await makeProject({
			'html/pages/Home.html':
				'<!doctype html>\n<a href="/html-target">x</a>\n',
			'react/pages/Home.tsx':
				'export const H = () => (\n\t<a href="/react-target">x</a>\n);\n',
			'svelte/pages/Home.svelte': "<a href='/svelte-target'>x</a>\n",
			'vue/pages/Home.vue':
				'<template>\n\t<Link href="/vue-target">x</Link>\n</template>\n'
		});
		const links = collectLinks(root);

		expect(
			links
				.map((link) => `${link.href}@${link.line}`)
				.sort()
				.join(' ')
		).toBe(
			'/html-target@2 /react-target@2 /svelte-target@1 /vue-target@2'
		);
		expect(links.map((link) => link.file).sort()).toEqual([
			'html/pages/Home.html',
			'react/pages/Home.tsx',
			'svelte/pages/Home.svelte',
			'vue/pages/Home.vue'
		]);
	});

	/* The first version of this matched any `href=` and reported three
	 * stylesheet and favicon URLs as dead links. */
	test('ignores an href on a non-navigating element', async () => {
		const root = await makeProject({
			'html/pages/Home.html': `<link rel="stylesheet" href="/styles/app.css" />
<link rel="icon" href="/assets/favicon.ico" />
<a href="/real">x</a>
`
		});

		expect(collectLinks(root).map((link) => link.href)).toEqual(['/real']);
	});

	/* The first version also scanned the project's own output and
	 * reported hashed CSS paths out of it. */
	test('ignores build output and dependencies', async () => {
		const root = await makeProject({
			'build/pages/Home.html': '<a href="/from-build">x</a>',
			'dist/Home.html': '<a href="/from-dist">x</a>',
			'node_modules/pkg/Home.html': '<a href="/from-deps">x</a>',
			'react/pages/Home.tsx': '<a href="/from-source">x</a>'
		});

		expect(collectLinks(root).map((link) => link.href)).toEqual([
			'/from-source'
		]);
	});

	test('ignores a link that is not a same-origin path', async () => {
		const root = await makeProject({
			'react/pages/Home.tsx': `<a href="https://example.com/x">x</a>
<a href="//cdn.example.com/x">x</a>
<a href="#section">x</a>
<a href="mailto:a@b.c">x</a>
<a href="about">x</a>
<a href={userPath}>x</a>
<a href="/kept">x</a>
`
		});

		expect(collectLinks(root).map((link) => link.href)).toEqual(['/kept']);
	});
});

describe('auditLinks', () => {
	const config = { fileRoutes: true, reactDirectory: 'react' };

	test('reports a link no route serves, and accepts the ones that are served', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].tsx': 'export default () => null;',
			'react/routes/pricing.tsx': 'export default () => null;',
			'server.ts': `new Elysia().get('/legacy', () => 'x');`,
			'src/Nav.tsx': `export const Nav = () => (
	<nav>
		<a href="/pricing">a</a>
		<a href="/blog/hello">b</a>
		<a href="/legacy">c</a>
		<a href="/pricng">d</a>
	</nav>
);
`
		});
		const dead = auditLinks(config, root);

		/* One finding, and it names where to look — a count alone would
		 * pass with the wrong link reported. */
		expect(dead.map((link) => `${link.file}:${link.line} ${link.path}`)).toEqual(
			['src/Nav.tsx:6 /pricng']
		);
	});

	/* Served by the asset plugin, not by a route, so no route table will
	 * ever contain it. */
	test('skips a path with a file extension', async () => {
		const root = await makeProject({
			'src/Nav.tsx': '<a href="/assets/brochure.pdf">x</a>'
		});

		expect(auditLinks(config, root)).toEqual([]);
	});

	/* The case that makes this a warning rather than an error: a route an
	 * installed plugin mounts cannot be seen by a scan of the project. */
	test('skips what links.ignore names, by path and by prefix', async () => {
		const root = await makeProject({
			'src/Nav.tsx': `<a href="/auth/sign-in">a</a>
<a href="/auth/callback/google">b</a>
<a href="/status">c</a>
<a href="/still-dead">d</a>
`
		});
		const dead = auditLinks(
			{ ...config, links: { ignore: ['/auth/*', '/status'] } },
			root
		);

		expect(dead.map((link) => link.path)).toEqual(['/still-dead']);
	});

	test('checks the path, not the query or fragment', async () => {
		const root = await makeProject({
			'react/routes/pricing.tsx': 'export default () => null;',
			'src/Nav.tsx': '<a href="/pricing?plan=pro#features">x</a>'
		});

		expect(auditLinks(config, root)).toEqual([]);
	});
});

describe('deadLinkWarning', () => {
	test('is null for no findings', () => {
		expect(deadLinkWarning([])).toBeNull();
	});

	test('names each link and how to silence a plugin route', () => {
		const warning =
			deadLinkWarning([
				{ file: 'src/Nav.tsx', href: '/pricng', line: 7, path: '/pricng' }
			]) ?? '';

		expect(warning).toContain('1 link points at a path no route serves');
		expect(warning).toContain('src/Nav.tsx:7 → /pricng');
		expect(warning).toContain('links.ignore');
	});
});
