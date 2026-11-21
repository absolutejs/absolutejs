import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A GET form submission and a `location.assign()` now soft-navigate like a link click, where the browser has a Navigation API to tell the layer about them (Chromium today; Safari and Firefox still load a document, which is what they did before). Until now the layer only saw clicks and history traversals, so an app that submitted a search form paid for a fresh document — and lost its island state, its scroll map and its prefetch cache — on a navigation that could have been a swap. Clicks still go through the click listener, so `download`, `target`, `rel="external"` and `data-absolute-navigation="off"` keep being read off the anchor; an opted-out form is honoured too, through the event\'s source element and the click listener\'s own record of what it declined. Deliberately left alone: a POST form, because the swap fetches the target with GET and taking a submission over would turn it into a read of the action URL (form actions are how a POST stays on the page); back, forward and reloads, which the traversal listener and the browser already own; a download; and — the one that matters most — a page\'s own `history.pushState` or `history.replaceState`, which fire the same event. Every framework router changes route by calling `pushState`, so an in-router navigation must never be answered with a cross-framework document swap.',
	kind: 'added',
	summary:
		'Form submissions and location.assign() soft-navigate instead of loading a document'
};
