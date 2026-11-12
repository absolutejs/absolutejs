import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fontCacheKey } from '../../../src/build/fonts/buildFonts';
import { googleFontsCssUrl } from '../../../src/build/fonts/googleFonts';
import { build } from '../../../src/core/build';
import { assetCacheControl } from '../../../src/core/precompressed';
import { fontAssets } from '../../../src/utils/fontAssets';
import type { FontFamilyConfig } from '../../../types/fonts';

const FIXTURE = resolve(
	import.meta.dir,
	'../../fixtures/fonts/poppins-latin-400-normal.woff2'
);
const WOFF2_URL = 'https://fonts.gstatic.com/s/poppins/test/latin-400.woff2';

/* The build downloads nothing here: the font cache is seeded with the css2
 * response and the woff2, as if an earlier build had fetched them. */
test('a production build self-hosts fonts and links them from static pages', async () => {
	const root = await mkdtemp(
		join(resolve(import.meta.dir, '../../..'), '.fonts-build-')
	);
	try {
		const cache = join(root, 'font-cache');
		const family: FontFamilyConfig = { family: 'Poppins', weights: [400] };
		await mkdir(cache, { recursive: true });
		await writeFile(
			join(cache, fontCacheKey(googleFontsCssUrl(family, 'swap'))),
			`/* latin */\n@font-face {\n  font-family: 'Poppins';\n  font-style: normal;\n  font-weight: 400;\n  src: url(${WOFF2_URL}) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`
		);
		await writeFile(
			join(cache, fontCacheKey(WOFF2_URL)),
			await readFile(FIXTURE)
		);
		const html = join(root, 'html');
		await mkdir(join(html, 'pages'), { recursive: true });
		await writeFile(
			join(html, 'pages', 'Home.html'),
			'<html><head><title>Fonts</title></head><body class="font-poppins">Hello</body></html>'
		);

		const result = await build({
			buildDirectory: join(root, 'build'),
			fonts: { cacheDirectory: cache, families: [family] },
			htmlDirectory: html,
			mode: 'production',
			options: { throwOnError: true }
		});
		if (!result) throw new Error('build failed');

		const fonts = fontAssets(result.manifest);
		expect(fonts.preload).toHaveLength(1);
		expect(fonts.stylesheets).toHaveLength(1);
		const [stylesheet = ''] = fonts.stylesheets;
		const [woff2 = ''] = fonts.preload;
		expect(assetCacheControl(stylesheet)).toContain('immutable');
		expect(assetCacheControl(woff2)).toContain('immutable');

		const css = await readFile(join(root, 'build', stylesheet), 'utf8');
		expect(css).toContain("font-family: 'Poppins Fallback';");
		expect(css).toContain('size-adjust:');
		expect(css).not.toContain('gstatic');
		expect(await readFile(join(root, 'build', woff2))).toEqual(
			await readFile(FIXTURE)
		);

		const manifest = JSON.parse(
			await readFile(join(root, 'build', 'manifest.json'), 'utf8')
		);
		expect(fontAssets(manifest)).toEqual(fonts);

		const page = await readFile(result.manifest.Home ?? '', 'utf8');
		expect(page).toContain(
			`<link rel="preload" href="${woff2}" as="font" type="font/woff2" crossorigin>`
		);
		expect(page).toContain(
			`<link rel="stylesheet" href="${stylesheet}" data-absolute-fonts>`
		);
		expect(page).not.toContain('fonts.googleapis.com');
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}, 60_000);
