import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Every `{#await}` with a pending branch was rewritten into a streaming slot, and any page containing one had hydration switched off. Buttons on such a page never worked; without `collectStreamingSlots: true` the pending branch showed forever; with it, a component in the `then` branch arrived as literal text; `{#if}` inside a branch failed to compile; and a shorthand `{#await x then y}` followed by a normal block failed with "Unterminated regular expression", because the pattern matched across both. A plain `{#await}` is now left to Svelte, which renders the pending branch on the server and resolves and hydrates it in the browser. Streaming is opt-in with `<!-- absolute:stream -->` directly before the block. A streamed block\'s branches are sent as HTML, so a component or logic block inside one is a build error, and only pages that stream a block skip hydration.',
	kind: 'breaking',
	migration: {
		instruction:
			'To keep server-side streaming for an `{#await}` block, put `<!-- absolute:stream -->` directly before it and keep its branches to elements and `{expressions}`. Unmarked blocks now render the pending branch on the server and resolve in the browser.',
		manual: true
	},
	summary:
		'Svelte `{#await}` blocks render and hydrate natively; server streaming is opt-in with `<!-- absolute:stream -->`',
	symbols: ['handleSveltePageRequest']
};
