import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "svelte-check's native mode checks a component only when the tsconfig's include also matches the .d.svelte.ts declaration it generates for it. absolute typecheck includes an island folder outside svelteDirectory by its .svelte files alone, which that mode skipped without a word, so such a project was kept on plain svelte-check. The generated config now names the .d.svelte.ts pattern beside each .svelte one, and those projects are checked natively too.",
	kind: 'changed',
	summary:
		'Svelte islands outside svelteDirectory are checked with the native TypeScript too'
};
