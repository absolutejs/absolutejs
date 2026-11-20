import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Partial prerendering keeps a page's shell in the cache and renders only the slots marked `dynamic` per request. React's and Svelte's hole primitives have taken that flag since Phase 1, but Vue's `StreamSlot` and `SuspenseSlot` and Angular's `StreamSlotComponent` and `DeferSlotComponent` dropped it: every slot on those pages was resolved into the cached shell, so a per-request greeting or cart was served to everyone from the cache, and partial prerendering could not be used on a Vue or Angular page at all. All four now pass it through to the same registrar React and Svelte use. Angular's `@defer` lowering still has no way to carry the flag, so a `@defer` block cannot yet be a dynamic hole.",
	kind: 'fixed',
	summary: 'Vue and Angular pages can mark a slot as a dynamic hole',
	symbols: [
		'StreamSlot',
		'SuspenseSlot',
		'StreamSlotComponent',
		'DeferSlotComponent'
	]
};
