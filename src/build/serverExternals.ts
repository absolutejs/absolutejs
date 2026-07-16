/** Cross-framework externals for SERVER (Bun-target) page bundles.
 *
 *  `@absolutejs/absolute`'s internals reference every framework's runtime
 *  transitively (react-dom/server, svelte/server, @angular/core, …). A
 *  single-framework project only has its own framework installed, so these
 *  specifiers must stay bare — resolved (or harmlessly absent) at runtime —
 *  instead of failing the bundle at build time with "Could not resolve".
 *
 *  The initial build always used this list (core/build.ts); the dev bundle
 *  rebuilds only externalized their own framework's packages, which meant a
 *  vue-only project's SSR rebuild failed on react/svelte/angular imports on
 *  EVERY edit — silently, before soft-failure logging landed — and the dev
 *  server served boot-time SSR bundles until restart. */
export const buildServerBundleExternals = (
	angularVendorPaths?: Record<string, string> | null
) => {
	// Third-party Angular libraries with linked partial declarations get a
	// vendor bundle — keep their bare specifiers intact so `rewriteImports`
	// can retarget them (see core/build.ts for the full rationale).
	const angularPartialDeclSpecs = Object.keys(angularVendorPaths ?? {})
		.filter((spec) => !spec.startsWith('@angular/'))
		.flatMap((spec) => [spec, `${spec}/*`]);

	return [
		'react',
		'react/*',
		'react-dom',
		'react-dom/*',
		'svelte',
		'svelte/*',
		'vue',
		'vue/*',
		// vue-demi's `export * from 'vue'` re-export breaks under Bun's
		// bundler rewrite — externalize so ESM semantics handle it.
		'vue-demi',
		'@vue/*',
		'@angular/*',
		...angularPartialDeclSpecs,
		'typescript'
	];
};
