import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A Svelte page that streams an `{#await}` block now hydrates like any other. It did not before: the build set `shouldHydrate = false` for any page containing a streamed slot — including one reached through a child component — so the page was never hydrated at all. No `onMount`, no event handlers, no reactivity: the page rendered and then did nothing, which is the worst failure shape there is because it looks finished. The reason given was that the streamed HTML is not Svelte's to claim, and it does not have to cost the page its hydration: the swap runtime already holds a streamed payload while `__ABS_SLOT_HYDRATION_PENDING__` is set and applies it once the page's index releases it after hydrating, which is the machinery the Vue and Angular streaming slots have always relied on. Hydration rewrites the slot with its pending fallback and the held payload is re-applied immediately afterwards, so the resolved content is what stays on the page. The flag that disabled hydration is gone entirely.",
	kind: 'fixed',
	summary:
		'A Svelte page that streams an `{#await}` block hydrates instead of going inert'
};
