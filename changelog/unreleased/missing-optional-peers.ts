import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The production server bundle (`absolute prepare`, `absolute start`, `absolute compile`) resolves every import up front, including a dependency\'s guarded dynamic import of an optional peer. An app using `@absolutejs/auth` without its optional `@node-saml/node-saml` failed with `Could not resolve: "@node-saml/node-saml"` and `Server bundle failed`, so it could never start in production. Optional peers of the app\'s direct dependencies that are not installed are now left external: the import fails only if that feature is used.',
	kind: 'fixed',
	summary:
		"Apps that skip a dependency's optional peer bundle for production again"
};
