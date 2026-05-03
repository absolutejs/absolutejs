/** Generate a vendor entry source that re-exports both named AND default
 *  exports robustly, regardless of whether the source is ESM or CJS.
 *
 *  Why this is non-trivial:
 *  - Per ECMA spec, `export *` re-exports only NAMED exports — never the
 *    default. So a vendor wrapping `firebase/compat/app` (whose entire
 *    surface is `export { default } from '@firebase/app-compat'`) ends up
 *    completely empty, breaking `import firebase from "/vendor/X.js"`.
 *  - Naively adding `export { default } from 'X'` makes Bun.build fail with
 *    "No matching export for 'default'" when X has no default export.
 *  - For CJS packages, `export * from 'cjs-pkg'` does NOT statically expose
 *    the CJS exports as named ES exports. Bun's CJS-to-ESM bridge puts the
 *    properties on a runtime namespace via `__reExport(...)`, but the
 *    static `export { ... }` clause of the bundle only carries names that
 *    were known at compile time. Consumers that do
 *    `import { parse } from '/vendor/cookie.js'` then fail with
 *    "does not provide an export named 'parse'", because `cookie` is CJS.
 *  - Bun's tree-shaker drops aliased re-exports like `export { X as Y }`
 *    when the source is only consumed via `export *` — emits `Y` in the
 *    export list but never declares the underlying `X` symbol, producing
 *    "Export 'X' is not defined in module" at load time. Seen with
 *    `react-router`'s `Action as NavigationType`. Holding the whole
 *    namespace object via a named export pins every transitive
 *    declaration as live so the tree-shaker can't drop them.
 *
 *  Solution: dynamically import the package at vendor-entry-generation
 *  time, read its actual export keys, and emit explicit re-export
 *  declarations for each one. Adds explicit `default` and the namespace
 *  pin as well. Works for both ESM and CJS shapes because the runtime
 *  import resolves both, and the resulting key list is the source of
 *  truth instead of compile-time `export *` heuristics.
 *
 *  The function is async because it must import the package; callers
 *  must `await` it. Failure to import a package is treated as fatal —
 *  vendoring a broken package was always going to fail downstream. */
const RESERVED_KEYS = new Set([
	'default',
	'__esModule',
	'__ABSOLUTE_VENDOR_NAMESPACE__'
]);

const VALID_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;

export const generateVendorEntrySource = async (specifier: string) => {
	const mod = (await import(specifier)) as Record<string, unknown>;
	const exportKeys = Object.keys(mod).filter(
		(key) => !RESERVED_KEYS.has(key) && VALID_IDENTIFIER.test(key)
	);

	const explicitNamedExports =
		exportKeys.length > 0
			? `export { ${exportKeys.join(', ')} } from '${specifier}';\n`
			: '';

	return (
		`import * as __abs_ns from '${specifier}';\n` +
		// `export *` covers any further-aliased re-exports the package
		// statically declares; the explicit `export { … }` line above
		// covers CJS packages whose exports are runtime-only.
		`export * from '${specifier}';\n` +
		explicitNamedExports +
		`export default __abs_ns.default;\n` +
		// Pin the namespace so Bun's tree-shaker preserves every
		// transitive declaration the package re-exports — including
		// aliased exports (`export { X as Y }`) where the underlying X
		// is otherwise dropped.
		`export const __ABSOLUTE_VENDOR_NAMESPACE__ = __abs_ns;\n`
	);
};
