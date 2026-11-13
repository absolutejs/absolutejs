import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHeadElement } from '../../../src/utils/generateHeadElement';
import { generateSitemap } from '../../../src/utils/generateSitemap';

const outDir = mkdtempSync(join(tmpdir(), 'absolute-i18n-sitemap-'));
afterAll(() => rmSync(outDir, { force: true, recursive: true }));

const pageRoute = (path: string) => ({
	handlerSource: `.get('${path}', () => handleReactPageRequest({ Page }))`,
	method: 'GET',
	path
});

describe('generateHeadElement alternates', () => {
	test('renders escaped hreflang links after the canonical', () => {
		const head = generateHeadElement({
			alternates: [
				{ href: 'https://x.com/about', hreflang: 'en' },
				{ href: 'https://x.com/fr/about?a=1&b="2"', hreflang: 'fr' }
			],
			canonical: 'https://x.com/about'
		});
		expect(head).toContain(
			'<link rel="alternate" hreflang="en" href="https://x.com/about">'
		);
		expect(head).toContain(
			'<link rel="alternate" hreflang="fr" href="https://x.com/fr/about?a=1&amp;b=&quot;2&quot;">'
		);
		expect(head.indexOf('rel="canonical"')).toBeLessThan(
			head.indexOf('rel="alternate"')
		);
	});

	test('renders nothing without alternates', () => {
		expect(generateHeadElement()).not.toContain('rel="alternate"');
	});
});

describe('generateSitemap i18n', () => {
	test('lists each page per locale with xhtml:link alternates', async () => {
		await generateSitemap(
			[
				pageRoute('/:locale?'),
				pageRoute('/:locale?/about'),
				pageRoute('/fr/contact'),
				pageRoute('/:locale/:slug'),
				pageRoute('/admin')
			],
			'http://localhost:3000',
			outDir,
			{
				baseUrl: 'https://example.com',
				i18n: { defaultLocale: 'en', locales: ['en', 'fr'] }
			}
		);
		const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
		expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
			(match) => match[1]
		);
		expect(locs).toEqual([
			'https://example.com/',
			'https://example.com/fr',
			'https://example.com/about',
			'https://example.com/fr/about',
			'https://example.com/contact',
			'https://example.com/fr/contact',
			'https://example.com/admin'
		]);
		expect(xml).toContain(
			'<loc>https://example.com/admin</loc>\n    <changefreq>'
		);
		expect(xml).toContain(
			'<loc>https://example.com/fr/about</loc>\n    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/about"/>\n    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/about"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/about"/>'
		);
	});

	test('negotiate: one URL per page, every page kept', async () => {
		await generateSitemap(
			[pageRoute('/about'), pageRoute('/contact')],
			'https://e.com',
			outDir,
			{
				i18n: {
					defaultLocale: 'en',
					locales: ['en', 'fr'],
					strategy: 'negotiate'
				}
			}
		);
		const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
		expect(xml).toContain('<loc>https://e.com/about</loc>');
		expect(xml).toContain('<loc>https://e.com/contact</loc>');
		expect(xml).not.toContain('xhtml:link');
	});

	test('domain: every page on every locale host', async () => {
		await generateSitemap([pageRoute('/about')], 'https://e.com', outDir, {
			i18n: {
				defaultLocale: 'en',
				domains: { en: 'example.com', fr: 'example.fr' },
				locales: ['en', 'fr'],
				strategy: 'domain'
			}
		});
		const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
		expect(xml).toContain('<loc>https://example.com/about</loc>');
		expect(xml).toContain('<loc>https://example.fr/about</loc>');
	});

	test('without i18n the sitemap is unchanged', async () => {
		await generateSitemap([pageRoute('/about')], 'https://e.com', outDir);
		const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
		expect(xml).toContain(
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
		);
		expect(xml).not.toContain('xhtml:link');
		expect(xml).toContain('<loc>https://e.com/about</loc>');
	});
});
