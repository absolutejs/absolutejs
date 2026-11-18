import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A React SuspenseSlot rendered through children(value) now renders inside the page's own tree, under a native React Suspense boundary, rather than in a separate render. Its content keeps every context above it (router, data cache, theme), React streams it in the same response, and it no longer needs collectStreamingSlots. The settled value streams with the content, so the browser hydrates from it without resolving again; a slot mounted later resolves in the browser behind the same boundary. Values must be JSON, with Dates kept as Dates. Slot ids must be unique per value. dynamic slots (partial prerendering) and slots inside React Server Components stream through the slot collector as before.",
	kind: 'changed',
	summary:
		'React SuspenseSlot streams inside the page tree, keeping context, with no collector needed',
	symbols: ['SuspenseSlot']
};
