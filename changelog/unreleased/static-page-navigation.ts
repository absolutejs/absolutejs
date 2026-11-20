import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Soft navigation refuses to swap a page that registered no `__ABSOLUTE_PAGE_DISPOSE__` hook, which is right for a framework page whose hydration index never finished — there is a half-mounted app whose markup must not be pulled out from under it — and wrong for a static HTML or HTMX page, where there is nothing to tear down. Static pages could therefore be navigated to and never from: a React to HTML trip swapped in place and the link back did a full document load. A page is now marked as having nothing to tear down in the two cases where that is known: when the document the layer just swapped in has no module script and no inline `import()`, so no index is coming; and when `enableNavigation()` finds no hook already registered, which is the static page that installs the layer itself. A page that does load modules is left alone, so a framework index that failed still falls back to a full load. The mark never replaces a real hook, and the two cannot race on a framework page: an index registers at module evaluation and `enableNavigation()` is documented to be called from a component, which runs after that.',
	kind: 'fixed',
	summary: 'A static page can be navigated away from without a full page load'
};
