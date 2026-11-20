import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A soft navigation replaces the document body, and the islands in the body it replaced were never unmounted: their React roots, Svelte instances, Vue apps and Angular component refs stayed alive with their effects, timers, subscriptions and listeners, attached to nodes no longer in the document — and it compounded, every navigation leaving another page's worth. The navigation layer now tears down each island inside the body it is about to replace, before the page's own teardown. That order matters: a framework page root may own the markup an island is mounted into, so tearing the page down first detaches the island's host element and the island then unmounts against nodes that are already gone. An island outside the swapped region is left mounted, which is the shape persistent layouts need. The registry lives on a `Symbol.for` key rather than in a module, because each framework's client pass bundles its own copy of the client runtime and a React page's navigation layer has to see the disposer its Svelte island registered; and each hydrator registers its own disposer, so nothing in the registry imports a framework. Verified in a browser with a Svelte island on a React page, asserting that the island's interval stops rather than only that its teardown hook ran.",
	kind: 'fixed',
	summary:
		'Islands are unmounted when a soft navigation swaps their page away'
};
