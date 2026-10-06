import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Since 0.20.0-beta.126, `absolute start`, `prepare` and `compile` left a dependency's optional peer external whenever it was missing from the project's own `node_modules`. Under Bun's isolated installs a peer the dependency does have is linked beside that dependency instead, and Bun's `external` list applies to every importer, so installed packages (for example `@neondatabase/serverless` and `zod`) were left as bare imports the production server could not resolve, and it exited at startup with `Cannot find module`. Whether an optional peer is missing is now decided for each import, from the importing file: it is bundled when that file can resolve it, and left external only when it truly is not installed.",
	kind: 'fixed',
	summary:
		'Production server bundles inline optional peers that are installed beside their dependency'
};
