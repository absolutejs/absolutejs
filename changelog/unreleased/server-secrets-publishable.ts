import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The check that refuses to serialize a server secret into page props failed pages that send a key meant for the browser under its provider's own name. `STRIPE_PUBLISHABLE_KEY` turned every Stripe checkout page into an SSR error on upgrade (embroidery-place's /customize). A name with `PUBLISHABLE` in it, or `PUBLIC` as a word anywhere in it (`VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_…`), now says it's meant to be sent, as the `PUBLIC_` prefix already did. A Stripe publishable value (`pk_live_…`, `pk_test_…`) is exempt under any name. Secret-looking names that say nothing about being public still fail, with the same message telling you to add the `PUBLIC_` prefix.",
	kind: 'fixed',
	summary:
		'Publishable and public keys may reach page props (STRIPE_PUBLISHABLE_KEY no longer fails checkout pages)'
};
