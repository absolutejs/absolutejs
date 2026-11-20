/* The marker a module imports to declare that it must never reach a
 * browser bundle:
 *
 *     import '@absolutejs/absolute/server-only';
 *
 *     export const db = new Database(getEnv('DATABASE_URL'));
 *
 * The build is what enforces it. Every browser bundling pass carries
 * `createServerOnlyPlugin` (src/build/clientServerBoundary.ts), which
 * intercepts this specifier and fails the build naming the file that
 * imported it — so a server module pulled into a page's client bundle by
 * one stray import is a build error rather than something you find out
 * about when a browser evaluates it.
 *
 * The throw below is the backstop for the paths the bundler is not on: the
 * dev module server transpiles per file and serves unbundled ESM, so a
 * module reached only at runtime never passes through a client pass. The
 * check is for a DOM rather than for "not Bun", because SSR runs in Bun
 * with no `document` and this file is imported by server code on purpose.
 *
 * This is the import-time half of a boundary whose other half is data:
 * `serializeInitialProps` refuses a props payload carrying the value of a
 * secret-looking environment variable (src/utils/serverSecrets.ts). */

if ('document' in globalThis || 'window' in globalThis)
	throw new Error(
		'[absolutejs] A module marked "@absolutejs/absolute/server-only" was evaluated in a browser. Something imported server-only code into client code; move it behind a route handler, or pass the values it produces through the page\'s props.'
	);

/** Exported so the marker is never dropped as an empty module. */
export const SERVER_ONLY = true;
