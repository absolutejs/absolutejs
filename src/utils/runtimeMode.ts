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

/* These helpers are written for server code, but a shared module can pull
 * them into a browser bundle (the Angular defer slot did, through the
 * streaming-slot registrar). Browsers have no `process`, and a bare
 * `process.env` read there throws `ReferenceError: process is not defined`,
 * so read through a guard: with no `process`, NODE_ENV is simply unset. */
const readEnv = () =>
	typeof process === 'undefined' ? undefined : process.env?.[ENV_VAR];

export const getNodeEnv = () => readEnv();
export const isDevelopmentRuntime = () => readEnv() === 'development';
export const isProductionRuntime = () => readEnv() === 'production';
