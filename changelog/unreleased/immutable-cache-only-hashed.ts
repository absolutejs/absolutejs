import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A static file was served `public, max-age=31536000, immutable` when its name looked content-hashed, and that was guessed from the name: any 6-12 character segment mixing letters and digits counted. It caught the most conventional hand-named assets there are — `icon-192x192.png`, `icon-512x512.png`, `icons-sprite24.svg`, `clip-1080p60.mp4`, `photo-v2final.jpg` — so replacing a PWA icon on a rebrand reached nobody: `immutable` tells a browser not to revalidate at all, and the pin lasts a year. The build is now asked instead of guessed at. A path is cached forever when it is one of the hashed paths in manifest.json, a `/.absolutejs/*` hydration bundle, a `chunk-<hash>.js` the bundler emitted, or carries this framework's own eight-hex-character fingerprint (fontAssets). Everything else revalidates, which costs one conditional request answered 304 and cannot serve a stale year. The compiled standalone binary carries the same rule with the manifest's paths inlined at compile time, and a table-driven test holds the two copies to the same answers.",
	kind: 'fixed',
	summary: 'Only a file the build hashed is cached immutably'
};
