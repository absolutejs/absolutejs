import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A new `fonts` option in `absolute.config.ts` downloads Google Fonts (or copies local font files) at build time and serves them from your own origin with content-hashed names and a one-year immutable cache. The build writes one linked stylesheet with `font-display: swap`, a size-adjusted fallback face per family so text does not shift while the font loads, and a `--font-<family>` variable and `.font-<family>` class. Pass `fontAssets(manifest)` to the `fonts` option of `Head` (React, Svelte) or `generateHeadElement`; HTML and HTMX pages get the preload and stylesheet tags automatically. Downloads are cached between builds; a failed download stops the build unless `fallbackToRemote` is set. Hashed static files served by a plain GET now also get the immutable cache header; before, only precompressed copies did.',
	kind: 'added',
	summary:
		'Self-hosted, preloaded fonts with layout-stable fallbacks from the `fonts` config'
};
