import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A Vue route with named views, `{ components: { default: Main, sidebar: Side }, path }`, now has each view's component split and loaded the first time the route is shown, as a single `component` already was; each view's CSS joins the route's per-route CSS. The server renders every view in full and the browser hydrates them.",
	kind: 'changed',
	summary: 'Vue named views load when first shown, automatically'
};
