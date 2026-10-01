/** True only in the temporary server used by build/start/compile to render pages.
 * Guard background workers and irreversible startup effects with this check.
 * Read at runtime: a compiled deployment is not a prerender process.
 */
export const isPrerendering = () => process.env.ABSOLUTE_PRERENDER === '1';
