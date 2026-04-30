/** Generate a vendor entry source that re-exports both named AND default
 *  exports robustly, regardless of whether the source has a default export.
 *
 *  Why this is non-trivial:
 *  - Per ECMA spec, `export *` re-exports only NAMED exports — never the
 *    default. So a vendor wrapping `firebase/compat/app` (whose entire
 *    surface is `export { default } from '@firebase/app-compat'`) ends up
 *    completely empty, breaking `import firebase from "/vendor/X.js"`.
 *  - Naively adding `export { default } from 'X'` makes Bun.build fail with
 *    "No matching export for 'default'" when X has no default export.
 *  - Heuristic detection from the resolved file (e.g. checking for
 *    `export default` or `module.exports`) is unreliable because
 *    `Bun.resolveSync` and `Bun.build` can pick different files for the
 *    same specifier (CJS `index.js` vs ESM `index.mjs` via the package's
 *    `exports` map).
 *
 *  Solution: import the package as a namespace and re-export the namespace's
 *  default. Works for every shape:
 *  - ESM with default: `__ns.default` is the original default value
 *  - ESM without default: `__ns.default` is `undefined` (consumer that
 *    imports default would have failed against the original package too)
 *  - CJS: Bun's interop synthesizes a default on the namespace
 *
 *  The namespace import has no compile-time check on `default` existence,
 *  so Bun.build accepts it for all packages. */
export const generateVendorEntrySource = (specifier: string) =>
	`import * as __abs_ns from '${specifier}';\n` +
	`export * from '${specifier}';\n` +
	`export default __abs_ns.default;\n`;
