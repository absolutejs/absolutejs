/* Bun.build replaces a literal `process.env.NODE_ENV` with the build-time
 * value, and with no define that value is "development". Every library
 * bundle in dist/ would then carry dev-only branches as constants
 * (`isDev = () => true`), so `absolute start` and compiled binaries ran
 * development code paths: error pages with stacks, the inline dev reload
 * client, per-request file stats.
 *
 * Defining the expression as itself leaves it a runtime read. The server
 * bundles read the consumer's NODE_ENV when they run; the browser bundles
 * keep the expression for the consumer's own build to define. */
export const RUNTIME_NODE_ENV_DEFINE: Record<string, string> = {
	'process.env.NODE_ENV': 'process.env.NODE_ENV'
};
