import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Every Svelte page with an island hydrated that island twice and left the first instance running on nodes no longer in the document — two island instances and two disposers for one element, on every load, with the orphan's effects, timers and subscriptions alive until the next navigation pruned it. A React page with the same island read one and one. The cause was the island slot's client markup: the islands runtime hydrates an island from its own bootstrap, independently of the page, so by the time a Svelte page hydrated, the island in its slot was already a live instance — and the slot's `{@html}` wrote that markup again, which replaced those nodes, after which the runtime hydrated the new copy too. The slot now renders no children on the client and fills itself through an action only when no island is there, so a hydrating page leaves a live island exactly where it is while a client render, a page whose server markup was discarded and an HMR remount still produce theirs. `absoluteIslandSlot` is exported from `@absolutejs/absolute/svelte` for the generated code that uses it.",
	kind: 'fixed',
	summary:
		'A Svelte page hydrates its islands once instead of twice, leaving no orphaned instance',
	symbols: ['absoluteIslandSlot']
};
