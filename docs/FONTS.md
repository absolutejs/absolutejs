# Fonts

AbsoluteJS can self-host your web fonts at build time. Add a `fonts` block to
`absolute.config.ts` and the build:

- downloads the Google Fonts stylesheet and the `woff2` files it names (or
  copies local font files from your project),
- writes them to `<build>/assets/fonts/` with content-hashed names, so the
  production server caches them for a year (`immutable`),
- writes one linked stylesheet holding the `@font-face` rules, with
  `font-display: swap` by default,
- adds a metric-matched fallback face per family so text doesn't shift when
  the web font arrives,
- defines a CSS variable and a class per family,
- and preloads only the critical faces.

Pages no longer talk to `fonts.googleapis.com` or `fonts.gstatic.com` at all.

## Configure

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	reactDirectory: 'src/frontend/react',
	fonts: {
		families: [
			{ family: 'Poppins', weights: [400, 700] },
			{ family: 'Inter', weights: '100..900', styles: ['normal', 'italic'] },
			{
				family: 'Brand Sans',
				src: [
					{ path: 'src/fonts/BrandSans-Regular.woff2', weight: 400 },
					{ path: 'src/fonts/BrandSans-Bold.woff2', weight: 700 }
				]
			}
		]
	}
});
```

### Family options

| Option           | Default                           | Meaning                                                                                                                         |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `family`         | required                          | Family name, e.g. `'Open Sans'`.                                                                                                |
| `weights`        | `[400]`                           | Google Fonts weights, or one variable range such as `'100..900'`.                                                               |
| `styles`         | `['normal']`                      | `'normal'` and/or `'italic'`.                                                                                                   |
| `subsets`        | `['latin']`                       | Google Fonts subsets to keep (`'latin-ext'`, `'cyrillic'`, ...). Others are dropped.                                            |
| `src`            | none                              | Local files (`.woff2`, `.woff`, `.ttf`, `.otf`), relative to the project root, each with an optional `weight` and `style`.      |
| `display`        | top-level `display`, else `swap`  | `font-display` for the family.                                                                                                  |
| `preload`        | `true`                            | `true` preloads the first weight and style in the latin subset; `false` preloads nothing; a list such as `[{ weight: 700 }]` picks faces. |
| `fallback`       | inferred                          | `'sans-serif'` (Arial), `'serif'` (Times New Roman) or `'monospace'` (Courier New). Names containing "Mono" infer monospace, "Serif" infers serif. |
| `adjustFallback` | `true`                            | Generate the metric-matched fallback face.                                                                                      |
| `variable`       | `--font-<family-kebab>`           | CSS custom property name.                                                                                                       |
| `className`      | `font-<family-kebab>`             | Class that applies the family.                                                                                                  |

### Top-level options

| Option             | Default                    | Meaning                                                                                              |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `display`          | `'swap'`                   | Default `font-display`.                                                                              |
| `fallbackToRemote` | `false`                    | When a download fails, link the Google Fonts stylesheet at runtime instead of failing the build.     |
| `cacheDirectory`   | `.absolutejs/cache/fonts`  | Where downloads are kept between builds.                                                             |
| `injectHtml`       | `true`                     | Add the preloads and stylesheet to the `<head>` of HTML and HTMX pages.                              |

## Use the fonts in a page

The build records the stylesheet and preloads in the manifest. `fontAssets(manifest)`
returns them as plain data, which you pass to the head:

```ts
import { asset, fontAssets, generateHeadElement } from '@absolutejs/absolute';

// React and Svelte: pass it as a prop to the Head component
handleReactPageRequest({
	Page: Home,
	index: asset(manifest, 'HomeIndex'),
	props: { cssPath: asset(manifest, 'HomeCSS'), fonts: fontAssets(manifest) }
});

// Vue and Angular: pass it to generateHeadElement
handleVuePageRequest({
	headTag: generateHeadElement({ fonts: fontAssets(manifest), title: 'Home' }),
	indexPath: asset(manifest, 'HomeIndex'),
	pagePath: asset(manifest, 'Home')
});
```

```tsx
import { Head } from '@absolutejs/absolute/react/components';

export const Home = ({ cssPath, fonts }: HomeProps) => (
	<html>
		<Head cssPath={cssPath} fonts={fonts} />
		<body className="font-poppins">...</body>
	</html>
);
```

HTML and HTMX pages need nothing: the build adds the tags to every page's
`<head>`, ahead of the page's own stylesheets. Set `injectHtml: false` to do it
yourself.

The head gets, in order: a `<link rel="preload" as="font" crossorigin>` for
each critical face, then `<link rel="stylesheet">` for the font stylesheet.
Nothing is inlined, so a strict `style-src` Content-Security-Policy needs no
nonce for fonts.

### In CSS

Each family gets a variable and a class:

```css
:root {
	--font-poppins: 'Poppins', 'Poppins Fallback', sans-serif;
}
.font-poppins {
	font-family: var(--font-poppins);
}
```

Use either one:

```css
body {
	font-family: var(--font-poppins);
}
```

With Tailwind v4, the `--font-poppins` variable also matches the
`font-poppins` utility.

## Fallback metrics

While the web font loads, the browser draws text in the fallback. If the
fallback is wider or taller, the page shifts when the web font arrives. For
each family the build reads the font file (its `head`, `hhea`, `OS/2`, `cmap`
and `hmtx` tables) and writes a fallback face over a local system font:

```css
@font-face {
	font-family: 'Poppins Fallback';
	src: local('Arial'), local('ArialMT');
	size-adjust: 114.11%;
	ascent-override: 92.02%;
	descent-override: 30.67%;
	line-gap-override: 8.76%;
}
```

`size-adjust` matches the average width of English text (letters weighted by
how often they occur), and the overrides match the font's ascent, descent and
line gap. The metrics come from the preloaded face, or the first latin face.
The parser is built in; there is no font library dependency.

## Caching and offline builds

Downloads are cached under `.absolutejs/cache/fonts`, keyed by a hash of the URL
and the User-Agent. Later builds reuse them and work offline. If a family isn't
cached and the download fails, the build stops with an error naming the
family and the reason. With `fallbackToRemote: true` it warns instead and
links the Google Fonts stylesheet for that family; the variable and class
still work, without a fallback face or preload.

## Serving

Font files and the font stylesheet carry content-hashed names, so the
production server sends them with `Cache-Control: public, max-age=31536000, immutable`.
A changed font gets a new name, and a new build removes the old files.
