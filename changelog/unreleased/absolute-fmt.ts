import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute fmt` formats with Bun's built-in `bun fmt` (Bun 1.4.4 or newer). It reads the project's existing Prettier configuration (`.prettierrc*`, overrides, `.prettierignore`, `.editorconfig`) and produces the same output as Prettier 3.9, Svelte included, in milliseconds, so it needs no cache. `absolute fmt --check` exits non-zero when files need formatting. On older Bun it says so and points to `absolute prettier`, which stays for projects whose Prettier plugins `bun fmt` doesn't support.",
	kind: 'added',
	summary: '`absolute fmt` formats with bun fmt, using your Prettier config'
};
