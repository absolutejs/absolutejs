/** Generate a vendor entry source that re-exports both named AND default
 *  exports robustly, regardless of whether the source is ESM or CJS.
 *
 *  Why this is non-trivial:
 *  - Per ECMA spec, `export *` re-exports only NAMED exports — never the
 *    default. So a vendor wrapping `firebase/compat/app` (whose entire
 *    surface is `export { default } from '@firebase/app-compat'`) ends up
 *    completely empty, breaking `import firebase from "/vendor/X.js"`.
 *  - `export { foo } from 'X'` makes Bun.build statically check that `foo`
 *    is a real named export of X. For CJS packages, packages whose runtime
 *    surface lives on `default` (e.g. `@daily-co/daily-js`'s call methods),
 *    or Node-builtin polyfills (e.g. `events` — Bun's runtime sees Node's
 *    full surface but the browser polyfill exposes a smaller set), the
 *    static check fails: "No matching export for 'X'".
 *  - Bun's tree-shaker drops aliased re-exports like `export { X as Y }`
 *    when the source is only consumed via `export *` — emits `Y` in the
 *    export list but never declares the underlying `X` symbol, producing
 *    "Export 'X' is not defined in module" at load time. Seen with
 *    `react-router`'s `Action as NavigationType`. Holding the whole
 *    namespace object via a named export pins every transitive
 *    declaration as live so the tree-shaker can't drop them.
 *
 *  Solution: dynamically import the package at vendor-entry-generation
 *  time, read its actual export keys, and re-export each one via a
 *  local-const alias bound to a namespace property read
 *  (`const __abs_0 = __abs_ns.foo; export { __abs_0 as foo }`). Bun.build
 *  only has to resolve the namespace import — never a per-name static
 *  check — so packages whose runtime keys diverge from their file-level
 *  static exports build cleanly, and missing keys resolve to `undefined`
 *  at init (matching what the consumer would get importing from the
 *  package directly).
 *
 *  We deliberately omit `export *` — the dynamic-import key list already
 *  enumerates every namespace property (ES module namespaces are required
 *  to be enumerable), and combining `export *` with an explicit
 *  `export { … as key }` for an overlapping name is a duplicate-export
 *  SyntaxError.
 *
 *  The function is async because it must import the package; callers
 *  must `await` it. Failure to import a package is treated as fatal —
 *  vendoring a broken package was always going to fail downstream. */
const RESERVED_KEYS = new Set([
	'default',
	'__esModule',
	'__ABSOLUTE_VENDOR_NAMESPACE__'
]);

// JS identifiers allow Unicode letters anywhere a Latin letter is allowed.
// Angular's privacy convention prefixes private exports with ɵ (U+0275),
// so an ASCII-only check would silently drop ɵɵFactoryTarget,
// ɵɵngDeclareFactory, etc. and break SSR rendering of any Angular app.
const VALID_IDENTIFIER = /^[$_\p{L}][$_\p{L}\p{N}]*$/u;

export const generateVendorEntrySource = async (specifier: string) => {
	const mod = (await import(specifier)) as Record<string, unknown>;
	const exportKeys = Object.keys(mod).filter(
		(key) => !RESERVED_KEYS.has(key) && VALID_IDENTIFIER.test(key)
	);

	const localBindings = exportKeys
		.map(
			(key, i) =>
				`const __abs_${i} = __abs_ns[${JSON.stringify(key)}];`
		)
		.join('\n');
	const reExportClause =
		exportKeys.length > 0
			? `export { ${exportKeys
					.map((key, i) => `__abs_${i} as ${key}`)
					.join(', ')} };\n`
			: '';

	return (
		`import * as __abs_ns from '${specifier}';\n` +
		(localBindings ? `${localBindings}\n` : '') +
		reExportClause +
		`export default __abs_ns.default;\n` +
		// Pin the namespace so Bun's tree-shaker preserves every
		// transitive declaration the package re-exports — including
		// aliased exports (`export { X as Y }`) where the underlying X
		// is otherwise dropped.
		`export const __ABSOLUTE_VENDOR_NAMESPACE__ = __abs_ns;\n`
	);
};
