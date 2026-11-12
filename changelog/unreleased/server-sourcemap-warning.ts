import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The production server bundle has no source map, but the AbsoluteJS code inside it builds inline source map comments for Svelte and Vue output. Those were template literals starting with `\\n`, which Bun's bundler emits as a real newline, leaving a line that starts `//# sourceMappingURL=data:…${…}` in the middle of dist/server.js. Bun read that line as the bundle's own source map whenever it built a stack trace, and warned that it couldn't decode it.",
	kind: 'fixed',
	summary:
		'`absolute start` no longer warns "Could not decode sourcemap in dist/server.js" on the first error'
};
