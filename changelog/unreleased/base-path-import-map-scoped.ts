import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An app served under a base path puts an import map first in its pages, so its root-absolute module paths (`/@src/…`, `/react/vendor/…`) resolve under the base. That map applied to every module in the document: a module another app on the same origin serves at its own root, imported into the page (Studio, under `/studio/projects/<id>`, mounting the portal's Settings module), had its imports sent to the base app instead. The map is now scoped to the base path (both the page at the bare base and everything under it), so the base app's modules resolve exactly as before and another app's module keeps its own paths.",
	kind: 'fixed',
	summary:
		"A base path's import map applies only to that app's modules, not to another app's module imported into its page"
};
