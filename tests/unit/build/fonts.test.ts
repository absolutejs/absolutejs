import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { buildFonts, fingerprint } from '../../../src/build/fonts/buildFonts';
import {
	computeFallbackOverrides,
	inferFallbackCategory
} from '../../../src/build/fonts/fallbackMetrics';
import {
	googleFontsCssUrl,
	parseGoogleFontsCss
} from '../../../src/build/fonts/googleFonts';
import { injectFontHead } from '../../../src/build/fonts/injectFontTags';
import { parseFontMetrics } from '../../../src/build/fonts/parseFontMetrics';
import { isFingerprintedAsset } from '../../../src/core/precompressed';
import { cleanStaleOutputs } from '../../../src/utils/cleanStaleOutputs';
import { fontAssets, renderFontTags } from '../../../src/utils/fontAssets';
import { generateHeadElement } from '../../../src/utils/generateHeadElement';
import type { FontAssets, FontFetch } from '../../../types/fonts';

const FIXTURE = resolve(
	import.meta.dir,
	'../../fixtures/fonts/poppins-latin-400-normal.woff2'
);
const fixtureBytes = () => new Uint8Array(readFileSync(FIXTURE));

const LATIN_URL = 'https://fonts.gstatic.com/s/poppins/test/latin-400.woff2';
const LATIN_EXT_URL =
	'https://fonts.gstatic.com/s/poppins/test/latin-ext-400.woff2';
const LATIN_700_URL =
	'https://fonts.gstatic.com/s/poppins/test/latin-700.woff2';

const googleCss = `/* latin-ext */
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${LATIN_EXT_URL}) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${LATIN_URL}) format('woff2');
  unicode-range: U+0000-00FF, U+2122;
}
/* latin */
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(${LATIN_700_URL}) format('woff2');
  unicode-range: U+0000-00FF, U+2122;
}
`;

/* A fake Google Fonts: the css2 endpoint answers with `googleCss`, every
 * gstatic URL with the fixture woff2. Records each request. */
const fakeGoogle = () => {
	const requests: Array<{ url: string; userAgent?: string }> = [];
	const fetchFont: FontFetch = async (url, init) => {
		requests.push({ url, userAgent: init?.headers?.['user-agent'] });
		if (url.startsWith('https://fonts.googleapis.com/css2')) {
			return new Response(googleCss);
		}

		return new Response(fixtureBytes());
	};

	return { fetchFont, requests };
};

const offline: FontFetch = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));

/* Minimal sfnt with head, hhea and OS/2 (no cmap, so the average width
 * comes from OS/2 xAvgCharWidth). */
const buildSfnt = () => {
	const head = new DataView(new ArrayBuffer(54));
	head.setUint16(18, 2048);
	const hhea = new DataView(new ArrayBuffer(36));
	hhea.setInt16(4, 1900);
	hhea.setInt16(6, -500);
	hhea.setInt16(8, 0);
	const os2 = new DataView(new ArrayBuffer(78));
	os2.setInt16(2, 1000);
	const tables: Array<[string, DataView]> = [
		['OS/2', os2],
		['head', head],
		['hhea', hhea]
	];
	const headerSize = 12 + tables.length * 16;
	const total =
		headerSize + tables.reduce((sum, [, view]) => sum + view.byteLength, 0);
	const font = new DataView(new ArrayBuffer(total));
	font.setUint32(0, 0x00010000);
	font.setUint16(4, tables.length);
	let offset = headerSize;
	tables.forEach(([tag, view], index) => {
		const record = 12 + index * 16;
		[...tag].forEach((char, position) =>
			font.setUint8(record + position, char.charCodeAt(0))
		);
		font.setUint32(record + 8, offset);
		font.setUint32(record + 12, view.byteLength);
		new Uint8Array(font.buffer).set(new Uint8Array(view.buffer), offset);
		offset += view.byteLength;
	});

	return { bytes: new Uint8Array(font.buffer), tables };
};

/* Wraps the same tables as WOFF 1.0, zlib-compressed. */
const buildWoff = () => {
	const { tables } = buildSfnt();
	const compressed = tables.map(
		([tag, view]) =>
			[tag, new Uint8Array(view.buffer), deflateSync(new Uint8Array(view.buffer))] as const
	);
	const headerSize = 44 + tables.length * 20;
	const total =
		headerSize +
		compressed.reduce((sum, [, , data]) => sum + data.byteLength, 0);
	const font = new DataView(new ArrayBuffer(total));
	[...'wOFF'].forEach((char, position) =>
		font.setUint8(position, char.charCodeAt(0))
	);
	font.setUint16(12, tables.length);
	let offset = headerSize;
	compressed.forEach(([tag, original, data], index) => {
		const record = 44 + index * 20;
		[...tag].forEach((char, position) =>
			font.setUint8(record + position, char.charCodeAt(0))
		);
		font.setUint32(record + 4, offset);
		font.setUint32(record + 8, data.byteLength);
		font.setUint32(record + 12, original.byteLength);
		new Uint8Array(font.buffer).set(data, offset);
		offset += data.byteLength;
	});

	return new Uint8Array(font.buffer);
};

describe('parseFontMetrics', () => {
	test('reads vertical metrics and weighted width from a real WOFF2', () => {
		const metrics = parseFontMetrics(fixtureBytes());
		expect(metrics.unitsPerEm).toBe(1000);
		expect(metrics.ascent).toBe(1050);
		expect(metrics.descent).toBe(-350);
		expect(metrics.lineGap).toBe(100);
		// Weighted from the cmap + hmtx advances of a-z and space.
		expect(metrics.averageWidth).toBeGreaterThan(450);
		expect(metrics.averageWidth).toBeLessThan(560);
	});

	test('reads a TrueType sfnt, falling back to OS/2 average width', () => {
		expect(parseFontMetrics(buildSfnt().bytes)).toEqual({
			ascent: 1900,
			averageWidth: 1000,
			descent: -500,
			lineGap: 0,
			unitsPerEm: 2048
		});
	});

	test('reads a zlib-compressed WOFF', () => {
		expect(parseFontMetrics(buildWoff())).toEqual(
			parseFontMetrics(buildSfnt().bytes)
		);
	});
});

describe('fallback metrics', () => {
	test('scales Arial to the web font width and vertical metrics', () => {
		const overrides = computeFallbackOverrides(
			{
				ascent: 1050,
				averageWidth: 510,
				descent: -350,
				lineGap: 100,
				unitsPerEm: 1000
			},
			'sans-serif'
		);
		const sizeAdjust = 510 / 1000 / (915.53 / 2048);
		expect(overrides.sizeAdjust).toBe(
			`${Math.round(sizeAdjust * 10000) / 100}%`
		);
		expect(overrides.ascentOverride).toBe(
			`${Math.round((1.05 / sizeAdjust) * 10000) / 100}%`
		);
		expect(overrides.descentOverride).toBe(
			`${Math.round((0.35 / sizeAdjust) * 10000) / 100}%`
		);
		expect(overrides.lineGapOverride).toBe(
			`${Math.round((0.1 / sizeAdjust) * 10000) / 100}%`
		);
		expect(overrides.local).toContain('Arial');
	});

	test('infers the fallback category from the family name', () => {
		expect(inferFallbackCategory('Roboto Mono')).toBe('monospace');
		expect(inferFallbackCategory('JetBrains Mono')).toBe('monospace');
		expect(inferFallbackCategory('Noto Serif')).toBe('serif');
		expect(inferFallbackCategory('PT Sans')).toBe('sans-serif');
		expect(inferFallbackCategory('IBM Plex Sans')).toBe('sans-serif');
	});
});

describe('Google Fonts CSS', () => {
	test('builds sorted css2 URLs', () => {
		expect(
			googleFontsCssUrl({ family: 'Open Sans', weights: [700, 400] }, 'swap')
		).toBe(
			'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap'
		);
		expect(
			googleFontsCssUrl(
				{ family: 'Poppins', styles: ['italic', 'normal'], weights: [400, 700] },
				'optional'
			)
		).toBe(
			'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,700;1,400;1,700&display=optional'
		);
		expect(
			googleFontsCssUrl({ family: 'Inter', weights: '100..900' }, 'swap')
		).toBe(
			'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'
		);
	});

	test('parses faces with their subsets', () => {
		const faces = parseGoogleFontsCss(googleCss);
		expect(faces).toHaveLength(3);
		expect(faces[1]).toEqual({
			family: 'Poppins',
			style: 'normal',
			subset: 'latin',
			unicodeRange: 'U+0000-00FF, U+2122',
			url: LATIN_URL,
			weight: '400'
		});
	});
});

describe('fingerprint', () => {
	test('always mixes letters and digits so the server caches it immutably', () => {
		for (const content of ['a', 'b', 'font', 'x'.repeat(100), '']) {
			const hash = fingerprint(content);
			expect(hash).toMatch(/^[0-9a-f]{8}$/);
			expect(isFingerprintedAsset(`/assets/fonts/x.${hash}.woff2`)).toBe(
				true
			);
		}
	});
});

describe('buildFonts', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'absolute-fonts-'));
	});

	afterEach(() => {
		rmSync(root, { force: true, recursive: true });
	});

	const run = (fetchFont: FontFetch, overrides: Record<string, unknown> = {}) =>
		buildFonts({
			buildPath: join(root, 'build'),
			config: {
				cacheDirectory: join(root, 'cache'),
				families: [{ family: 'Poppins', weights: [400, 700] }],
				...overrides
			},
			fetch: fetchFont,
			projectRoot: root
		});

	test('self-hosts the requested subset with hashed names and a linked stylesheet', async () => {
		const google = fakeGoogle();
		const result = await run(google.fetchFont);

		// The CSS request carries a modern browser UA so Google serves woff2.
		expect(google.requests[0]?.userAgent).toContain('Chrome/');
		// latin-ext was filtered out: only latin 400 + latin 700 downloaded.
		expect(google.requests.map((request) => request.url)).not.toContain(
			LATIN_EXT_URL
		);

		const stylesheet = result.manifest.AbsoluteFontsCSS;
		expect(stylesheet).toMatch(/^\/assets\/fonts\/fonts\.[0-9a-f]{8}\.css$/);
		const css = readFileSync(join(root, 'build', stylesheet ?? ''), 'utf8');
		expect(css).not.toContain('fonts.gstatic.com');
		expect(css).not.toContain('latin-ext');
		expect(css).toMatch(
			/src: url\(poppins-latin-400-normal\.[0-9a-f]{8}\.woff2\) format\('woff2'\);/
		);
		expect(css).toContain('font-display: swap;');
		expect(css).toContain('unicode-range: U+0000-00FF, U+2122;');
		// Metric-matched fallback face.
		expect(css).toContain("font-family: 'Poppins Fallback';");
		expect(css).toContain("src: local('Arial'), local('ArialMT');");
		expect(css).toMatch(/size-adjust: \d+(\.\d+)?%;/);
		expect(css).toMatch(/ascent-override: \d+(\.\d+)?%;/);
		expect(css).toMatch(/descent-override: \d+(\.\d+)?%;/);
		expect(css).toMatch(/line-gap-override: \d+(\.\d+)?%;/);
		// Variable + class.
		expect(css).toContain(
			"--font-poppins: 'Poppins', 'Poppins Fallback', sans-serif;"
		);
		expect(css).toContain('.font-poppins {\n  font-family: var(--font-poppins);\n}');

		// Only the first weight/style in latin is preloaded.
		expect(fontAssets(result.manifest).preload).toHaveLength(1);
		expect(result.manifest.AbsoluteFontPreload0).toMatch(
			/^\/assets\/fonts\/poppins-latin-400-normal\.[0-9a-f]{8}\.woff2$/
		);
		for (const path of result.outputPaths) expect(existsSync(path)).toBe(true);
		expect(result.outputPaths).toHaveLength(3);
	});

	test('keeps the outputs through stale-output cleanup', async () => {
		const result = await run(fakeGoogle().fetchFont);
		await cleanStaleOutputs(join(root, 'build'), result.outputPaths);
		for (const path of result.outputPaths) expect(existsSync(path)).toBe(true);
	});

	test('reuses cached downloads, so a second build works offline', async () => {
		const first = await run(fakeGoogle().fetchFont);
		const second = await run(offline);
		expect(second.manifest).toEqual(first.manifest);
	});

	test('fails clearly when offline with nothing cached', async () => {
		await expect(run(offline)).rejects.toThrow(
			/Could not download Google font "Poppins" \(getaddrinfo ENOTFOUND\).*fallbackToRemote/
		);
	});

	test('falls back to the remote stylesheet when asked', async () => {
		const warnings: string[] = [];
		const result = await buildFonts({
			buildPath: join(root, 'build'),
			config: {
				cacheDirectory: join(root, 'cache'),
				fallbackToRemote: true,
				families: [{ family: 'Poppins' }]
			},
			fetch: offline,
			projectRoot: root,
			warn: (message) => warnings.push(message)
		});
		const assets = fontAssets(result.manifest);
		expect(assets.preload).toEqual([]);
		expect(assets.stylesheets[0]).toBe(
			'https://fonts.googleapis.com/css2?family=Poppins:wght@400&display=swap'
		);
		// The variable and class still come from the local stylesheet.
		expect(assets.stylesheets[1]).toBe(result.manifest.AbsoluteFontsCSS);
		const css = readFileSync(join(root, 'build', assets.stylesheets[1] ?? ''), 'utf8');
		expect(css).toContain("--font-poppins: 'Poppins', sans-serif;");
		expect(warnings[0]).toContain('linking https://fonts.googleapis.com');
	});

	test('self-hosts local font files', async () => {
		writeFileSync(join(root, 'Brand.woff2'), fixtureBytes());
		const result = await buildFonts({
			buildPath: join(root, 'build'),
			config: {
				display: 'optional',
				families: [
					{
						className: 'brand',
						family: 'Brand Sans',
						src: [{ path: 'Brand.woff2', weight: '100 900' }],
						variable: '--brand'
					}
				]
			},
			fetch: offline,
			projectRoot: root
		});
		const css = readFileSync(
			join(root, 'build', result.manifest.AbsoluteFontsCSS ?? ''),
			'utf8'
		);
		expect(css).toMatch(
			/src: url\(brand-sans-100-900-normal\.[0-9a-f]{8}\.woff2\) format\('woff2'\);/
		);
		expect(css).toContain('font-weight: 100 900;');
		expect(css).toContain('font-display: optional;');
		expect(css).toContain("--brand: 'Brand Sans', 'Brand Sans Fallback', sans-serif;");
		expect(css).toContain('.brand {');
		expect(result.manifest.AbsoluteFontPreload0).toMatch(
			/brand-sans-100-900-normal\.[0-9a-f]{8}\.woff2$/
		);
	});

	test('reports a missing local file', async () => {
		await expect(
			buildFonts({
				buildPath: join(root, 'build'),
				config: { families: [{ family: 'Brand', src: [{ path: 'nope.woff2' }] }] },
				projectRoot: root
			})
		).rejects.toThrow('font file not found: nope.woff2');
	});

	test('preloads explicitly selected faces, or none', async () => {
		const selected = await run(fakeGoogle().fetchFont, {
			families: [
				{ family: 'Poppins', preload: [{ weight: 700 }], weights: [400, 700] }
			]
		});
		expect(fontAssets(selected.manifest).preload).toEqual([
			expect.stringMatching(/poppins-latin-700-normal/)
		]);
		const none = await run(fakeGoogle().fetchFont, {
			families: [{ family: 'Poppins', preload: false }]
		});
		expect(fontAssets(none.manifest).preload).toEqual([]);
	});
});

describe('font head tags', () => {
	const fonts: FontAssets = {
		preload: ['/assets/fonts/a.1a2b3c4d.woff2'],
		stylesheets: ['/assets/fonts/fonts.1a2b3c4d.css']
	};

	test('fontAssets reads the manifest in order and is empty without fonts', () => {
		expect(
			fontAssets({
				AbsoluteFontPreload0: '/a.woff2',
				AbsoluteFontPreload1: '/b.woff2',
				AbsoluteFontsCSS: '/fonts.css',
				Other: '/x.js'
			})
		).toEqual({ preload: ['/a.woff2', '/b.woff2'], stylesheets: ['/fonts.css'] });
		expect(fontAssets({})).toEqual({ preload: [], stylesheets: [] });
	});

	test('generateHeadElement links preloads and the stylesheet before page CSS', () => {
		const head = generateHeadElement({ cssPath: '/page.css', fonts });
		const preload =
			'<link rel="preload" href="/assets/fonts/a.1a2b3c4d.woff2" as="font" type="font/woff2" crossorigin>';
		const stylesheet =
			'<link rel="stylesheet" href="/assets/fonts/fonts.1a2b3c4d.css" data-absolute-fonts>';
		expect(head).toContain(preload);
		expect(head).toContain(stylesheet);
		expect(head.indexOf(stylesheet)).toBeLessThan(head.indexOf('/page.css'));
		expect(head).not.toContain('fonts.googleapis.com');
		expect(head).not.toContain('<style');
	});

	test('remote fallback stylesheets get preconnects and escaped URLs', () => {
		const tags = renderFontTags({
			preload: [],
			stylesheets: ['https://fonts.googleapis.com/css2?family=A&display=swap']
		});
		expect(tags).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
		expect(tags).toContain(
			'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=A&amp;display=swap" data-absolute-fonts>'
		);
	});

	test('injectFontHead puts the tags before the first stylesheet, once', () => {
		const page =
			'<html><head><title>x</title><link rel="stylesheet" href="/page.css"></head><body></body></html>';
		const injected = injectFontHead(page, fonts);
		expect(injected.indexOf('fonts.1a2b3c4d.css')).toBeLessThan(
			injected.indexOf('/page.css')
		);
		expect(injectFontHead(injected, fonts)).toBe(injected);
		expect(injectFontHead('<p>no head</p>', fonts)).toBe('<p>no head</p>');
	});
});
