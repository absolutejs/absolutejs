/* Bundler-safe NODE_ENV reader.
 *
 * Bun (like esbuild and most modern bundlers) statically replaces
 * `process.env.NODE_ENV` with the build-time string. When absolutejs
 * itself is bundled (`bun run scripts/build.ts`), NODE_ENV is unset,
 * so every `process.env.NODE_ENV === 'production'` site collapses to
 * `false` and the production branch is dead-code-eliminated from
 * `dist/`. That breaks `bun start`, `bun compile`, and the standalone
 * compiled binary — they all run with NODE_ENV=production but see the
 * dev branches baked in.
 *
 * Computed-property access (`process.env[KEY]`) is NOT constant-folded
 * by Bun, so we read NODE_ENV through a string variable. Both branches
 * stay live in `dist/`, and the consumer's actual runtime NODE_ENV
 * decides which one fires.
 *
 * Verified empirically: Bun's bundler matches the literal AST shape
 * `MemberExpression { object: process.env, property: NODE_ENV }` for
 * its replacement. Computed-key access uses
 * `MemberExpression { computed: true, property: Identifier(KEY) }`,
 * which doesn't match the pattern. */

const ENV_VAR = 'NODE_ENV';

export const getNodeEnv = () => process.env[ENV_VAR];
export const isDevelopmentRuntime = () =>
	process.env[ENV_VAR] === 'development';
export const isProductionRuntime = () => process.env[ENV_VAR] === 'production';
