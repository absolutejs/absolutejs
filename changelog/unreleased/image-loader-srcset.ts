import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An `<Image>` with a custom `loader` used it for its `src` only: the React, Vue and Svelte components built every `srcset` candidate against the `/_absolute/image` endpoint instead, so a browser that picked from the set (a high-density screen, or any `sizes`) asked the endpoint for an image it may not be able to read — a private route, an external CDN — and showed it broken. The set's candidates now go through the loader too, and the image's `quality` reaches them (it was always the default before). Angular passed its loader, but its browser build calls the client `generateSrcSet`, which read that argument as `imageSizes`, so an Angular image with a loader failed when building its set.",
	kind: 'fixed',
	summary: "Image's loader builds its whole srcset, with the image's quality"
};
