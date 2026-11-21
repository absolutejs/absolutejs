import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An island on an Angular page is now covered by a browser test against a real app: it hydrates, it is interactive, and it still is after a soft navigation into the page. Two faults were measured while writing it, both recorded in the cross-framework navigation plan rather than fixed here, because the fix is a design question. An Angular page hydrates its island twice and leaves the first instance running on detached nodes (two disposers for one element) — the same fault beta.252 fixed for Svelte pages, by a different route: Angular's island component renders its container with `ngSkipHydration`, so Angular client-renders that subtree and the server's container, holding the island the islands bootstrap already hydrated, is discarded. That is also why a `persist` key does not survive a navigation into an Angular page: the live island the layer moves in sits in the container Angular throws away. The `persist` input is declared on the Angular island component so the key is in place for whichever fix lands.",
	kind: 'internal',
	summary:
		'An island on an Angular page has a browser test, and its double-hydration is measured'
};
