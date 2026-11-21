import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An island whose element leaves the document while it is still mounting is now unmounted immediately instead of being registered as a live island. An Angular page removes the server's markup after rendering its own, so the islands runtime's scan finds both copies and starts hydrating the server's one a moment before it is detached: that instance stayed alive on nodes nobody could see, with its effects, timers and subscriptions running, until the next navigation pruned it — two disposers for one element, on every load of every Angular page with an island. The fix is one guard in the disposer registry and is not Angular-specific: any host framework that re-creates the markup an island sits in can detach it mid-hydration. It also removes the wasted work rather than only the leak, because a framework that flushes mount effects asynchronously never finishes mounting an instance that is unmounted in the same turn.",
	kind: 'fixed',
	summary:
		'An island hydrated into markup that was already discarded is unmounted instead of leaking'
};
