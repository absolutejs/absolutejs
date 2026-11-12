import type { FontAssets } from '../../types/fonts';

export const FONT_PRELOAD_MANIFEST_PREFIX = 'AbsoluteFontPreload';
export const FONTS_CSS_MANIFEST_KEY = 'AbsoluteFontsCSS';
export const FONTS_REMOTE_CSS_MANIFEST_PREFIX = 'AbsoluteFontsRemoteCSS';

const MIME_BY_EXTENSION: Record<string, string> = {
	otf: 'font/otf',
	ttf: 'font/ttf',
	woff: 'font/woff',
	woff2: 'font/woff2'
};

const numberedValues = (manifest: Record<string, string>, prefix: string) =>
	Object.keys(manifest)
		.filter((key) => key.startsWith(prefix))
		.map((key) => ({
			index: Number(key.slice(prefix.length)),
			value: manifest[key]
		}))
		.filter(
			(entry): entry is { index: number; value: string } =>
				Number.isInteger(entry.index) && entry.value !== undefined
		)
		.sort((left, right) => left.index - right.index)
		.map((entry) => entry.value);

/** The font stylesheet(s) and preloads the build produced from the `fonts`
 *  config, read from the manifest. Pass the result to `Head`'s or
 *  `generateHeadElement`'s `fonts` option. Empty when no fonts are
 *  configured. Plain data, safe to pass as a page prop. */
export const fontAssets = (manifest: Record<string, string>) => {
	const stylesheet = manifest[FONTS_CSS_MANIFEST_KEY];
	const assets: FontAssets = {
		preload: numberedValues(manifest, FONT_PRELOAD_MANIFEST_PREFIX),
		stylesheets: [
			...numberedValues(manifest, FONTS_REMOTE_CSS_MANIFEST_PREFIX),
			...(stylesheet ? [stylesheet] : [])
		]
	};

	return assets;
};

export const fontMimeType = (href: string) => {
	const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i
		.exec(href)?.[1]
		?.toLowerCase();

	return (extension && MIME_BY_EXTENSION[extension]) ?? 'font/woff2';
};

const escapeAttribute = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const isRemote = (href: string) => /^https?:\/\//i.test(href);

/** Origins a font stylesheet loads from, for `preconnect` hints. Only
 *  remote (fallback) stylesheets need them. */
export const fontPreconnectOrigins = (fonts: FontAssets) =>
	fonts.stylesheets.some(isRemote)
		? ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']
		: [];

/** `<link>` tags for a page's `<head>`: preconnects (remote fallback only),
 *  font preloads, then the stylesheets. All linked, never inline, so they
 *  work under a strict Content-Security-Policy. */
export const renderFontTags = (fonts: FontAssets) => [
	...fontPreconnectOrigins(fonts).map((origin) =>
		origin.includes('gstatic')
			? `<link rel="preconnect" href="${origin}" crossorigin>`
			: `<link rel="preconnect" href="${origin}">`
	),
	...fonts.preload.map(
		(href) =>
			`<link rel="preload" href="${escapeAttribute(href)}" as="font" type="${fontMimeType(href)}" crossorigin>`
	),
	...fonts.stylesheets.map(
		(href) =>
			`<link rel="stylesheet" href="${escapeAttribute(href)}" data-absolute-fonts>`
	)
];
