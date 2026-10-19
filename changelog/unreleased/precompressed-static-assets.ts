import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Production served every asset uncompressed, so browsers downloaded scripts, stylesheets and HTML files at full size: about three times the bytes, which on a slow network is most of the wait. Production builds now write brotli (quality 9) and gzip copies beside each text asset that compression shrinks by at least a tenth (about a second for the example app), and the production server sends a copy to a browser that accepts it, with `Content-Encoding`, the original `Content-Type`, `Vary: Accept-Encoding` and the asset's cache policy. React's vendor bundle goes from 181 KB to 53 KB. Nothing is compressed on the fly, so streamed responses (server-sent events, streamed pages) are untouched.",
	kind: 'added',
	summary:
		'Production serves brotli and gzip copies of static text assets, written at build time'
};
