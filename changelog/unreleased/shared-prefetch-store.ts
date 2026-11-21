import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Each framework's client pass bundles its own copy of `@absolutejs/absolute/client`, and the prefetch cache was module-level, so it was one cache per copy. A Svelte `<Link>` hover warmed the Svelte copy while the navigation layer doing the swap — whichever copy called `enableNavigation()` first, which on a React-entry session is React's — looked in its own and missed, and the document was fetched a second time. The hover bought nothing but an HTTP-cache revalidation. The state now lives on a `Symbol.for` key, so there is one store per document. Everything a document can only sensibly have one of moved with it: the in-flight budget was also per copy, so two copies could run twice `MAX_IN_FLIGHT` requests at once on a page already fetching its own assets, and the `<link>` and speculation-rule bookkeeping could inject the same hint twice. No call site changed — the shared Maps, Sets and array are destructured once at module init, so each copy refers to the same objects; only the in-flight count needed a box, since a number cannot be shared by reference.",
	kind: 'fixed',
	summary: 'A prefetch from one framework warms the navigation in every other'
};
