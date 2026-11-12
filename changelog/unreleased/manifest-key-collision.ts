import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'An HTML page and an HTMX page with the same file name (both `pages/Home.html`) share the manifest key `Home`. The build only warned "Manifest key collision … overwritten", and both routes then served whichever page was processed last. The build now fails and names both source files. In dev the error is reported like any other failed build pass. Key naming is unchanged.',
	kind: 'breaking',
	migration: {
		instruction:
			'If the build reports "Manifest key \\"…\\" belongs to two pages", rename one of the two files (for example `htmx/pages/Home.html` to `htmx/pages/HtmxHome.html`) and update the `asset(manifest, …)` call in its route. Builds without a collision are unaffected.',
		manual: true
	},
	summary:
		'Two pages with the same name in the HTML and HTMX directories are a build error instead of one silently replacing the other',
	symbols: ['asset', 'build']
};
