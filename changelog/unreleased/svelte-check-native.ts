import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "With the Bun checker, absolute typecheck runs svelte-check with --tsgo-experimental-api, which hands the type-checking to TypeScript 7's native checker, when the project has svelte-check 4.7 or newer and TypeScript 7 installed as @typescript/native (bun add -d @typescript/native@npm:typescript@7) or @typescript/native-preview. On a 772-component application it reported the same errors in about 25 s where plain svelte-check took 70 to 83 s. Plain svelte-check still runs without those packages, when Svelte islands live outside the configured svelteDirectory (the native mode skips files matched by a *.svelte include as of svelte-check 4.7.8), and when the native run ends without a summary.",
	kind: 'changed',
	summary:
		'absolute typecheck checks Svelte with the native TypeScript when it is installed'
};
