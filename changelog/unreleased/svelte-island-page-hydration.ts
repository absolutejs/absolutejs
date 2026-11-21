import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A Svelte page that rendered an `<Island>` never hydrated: its `onMount` did not run, its event handlers were never attached and its state was not reactive. The page looked correct, because the server had already rendered it, and the islands on it worked — they are hydrated by their own bootstrap, independently of the page — so the only symptom was a Svelte page that quietly stopped responding to clicks as soon as an island was added to it. Two faults, each hiding the other. The build's `hasAwaitSlot` flag was set by four lowering passes, two of which lower island syntax rather than streamed `{#await}` slots, so an island on the page put it in the branch that answers a streamed await by not hydrating at all. Fixing that reached a second branch, dead until then, which answered island markup with `mount()` instead of `hydrate()` — and `mount` appends, so the server's copy of the page stayed in the document with a live second copy after it: every selector, and every click, found the dead one. Island pages now hydrate, with the server's island markup restored into each slot as the snapshot was always meant to do.",
	kind: 'fixed',
	summary:
		'A Svelte page that renders an island hydrates instead of going inert'
};
