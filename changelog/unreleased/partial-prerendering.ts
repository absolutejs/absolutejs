import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A pre-rendered page used to be either fully cached or fully rendered per request. Now a streaming slot marked `dynamic` (`<StreamSlot dynamic>` or `<SuspenseSlot dynamic>` in React, the `dynamic` prop or `<!-- absolute:stream dynamic -->` in Svelte) stays a hole in the pre-rendered page. On a route listed in `static.routes`, the build stores the page as a static shell: other slots are resolved into it, and dynamic slots keep their fallback. Each request gets the cached shell at once, before the route handler runs. Only the dynamic slots are then rendered, with the visitor's cookies and headers, and streamed into the page, carrying the request's CSP nonce under `secureHeaders()`. Revalidation (`static.revalidate`) re-captures the shell. Pages without a dynamic slot are pre-rendered as before. Vue and Angular support comes later.",
	kind: 'added',
	summary:
		'Partial prerendering: pre-rendered React and Svelte pages serve a cached shell instantly and stream their `dynamic` slots per request',
	symbols: ['StreamSlot', 'SuspenseSlot', 'StreamingSlot']
};
