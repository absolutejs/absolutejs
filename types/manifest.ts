/**
 * The keys `asset(manifest, key)` accepts.
 *
 * Empty here. `absolute dev`, `absolute build` and `absolute typecheck`
 * derive the project's keys from its pages, styles and islands (no build
 * needed) and write `.absolutejs/types/manifest.d.ts`, which adds each key
 * to this interface:
 *
 *   declare module '@absolutejs/absolute' {
 *     interface AbsoluteManifestKeys { HomeIndex: true; … }
 *   }
 *
 * `absolute typecheck` always reads that file; for the same checks in an
 * editor, add `.absolutejs/types/manifest.d.ts` to `include` in
 * tsconfig.json.
 */
// An interface, not a type: declaration merging is how the keys get in.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type
export interface AbsoluteManifestKeys {}

/**
 * A manifest key: one of the generated keys once the project has them, any
 * string before (no generated declaration, or a project that never ran an
 * AbsoluteJS command). A key computed at runtime goes through
 * `assetUnchecked`.
 */
export type ManifestKey = [keyof AbsoluteManifestKeys] extends [never]
	? string
	: Extract<keyof AbsoluteManifestKeys, string>;
