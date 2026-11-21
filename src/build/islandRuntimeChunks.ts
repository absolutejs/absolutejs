import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolvePackageImport } from './resolvePackageImport';

/* The published client runtime's own chunks, copied next to an island
 * bundle that imports it.
 *
 * `@absolutejs/absolute/client` is itself a SPLIT bundle: its per-framework
 * island hydrators live in `dist/client/chunks/*.js` and are loaded through
 * a generated module map, so the call is `import(map[i])` with a computed
 * argument. Bun cannot statically follow that, so when the islands client
 * pass bundles a bootstrap importing the runtime, those chunk files are
 * never pulled in — and the literal specifiers inside the module map
 * resolve against the bootstrap's own URL at runtime:
 * `/islands/chunks/index-<hash>.js`, which nothing emitted and nothing
 * served. Every island on a static HTML or HTMX page therefore failed to
 * hydrate in a production build, with a single 404 as the only symptom.
 *
 * It had never been caught because the one test for static-page islands
 * asserts the bootstrap `<script>` is in the HTML and never loads the page
 * in a browser, and because the example app has no island on a static
 * page.
 *
 * Bundling the runtime flat instead is not an option: `scripts/build.ts`
 * splits it deliberately so a React-only consumer does not need Svelte
 * installed to compile. So the chunks are copied, and the caller adds them
 * to the island output list that `rewriteClientOutputs` rewrites — they
 * carry bare framework specifiers (`from "svelte"`) that a browser cannot
 * resolve, and that pass is what turns those into the app's vendor
 * paths. */

const CHUNKS_DIRECTORY = 'chunks';

/* Chunk families named after a framework hold that framework's island
 * hydrator and import its runtime by bare specifier (`from "svelte"`).
 * Those only resolve in the browser once `rewriteClientOutputs` has
 * rewritten them to the app's vendor path, and there IS no vendor path
 * for a framework the app does not configure — the build's own
 * `verifyBrowserImportsVendored` guard fails the build on exactly that.
 * So a hydrator for an unconfigured framework is skipped: nothing can
 * reach it anyway, because the only thing that imports it is an island of
 * that framework. Every other family (`index`, `islands`,
 * `islandDisposers`) is framework-agnostic and always copied. */
const FRAMEWORK_CHUNK_FAMILIES = ['angular', 'react', 'svelte', 'vue'];

const familyOf = (fileName: string) =>
	FRAMEWORK_CHUNK_FAMILIES.find((family) =>
		fileName.startsWith(`${family}-`)
	);

/** Where the installed `@absolutejs/absolute/client` keeps its chunks, or
 *  `null` when the package resolves without them (a consumer that bundled
 *  the runtime flat, or a layout this does not recognise). */
export const findClientRuntimeChunks = () => {
	const entry = resolvePackageImport('@absolutejs/absolute/client', [
		'browser',
		'import'
	]);
	if (!entry) return null;
	const chunks = join(dirname(entry), CHUNKS_DIRECTORY);

	return existsSync(chunks) ? chunks : null;
};

/** Copies the runtime's chunks to `<islandsDir>/chunks` and returns the
 *  copied file paths, for the caller to include in the island rewrite
 *  pass. `frameworks` are the ones the app configures; a hydrator chunk
 *  for any other is skipped. Empty when there is nothing to copy. */
export const copyClientRuntimeChunks = (
	islandsDir: string,
	frameworks: readonly string[]
) => {
	const source = findClientRuntimeChunks();
	if (!source) return [];
	const configured = new Set(frameworks);
	const destination = join(islandsDir, CHUNKS_DIRECTORY);
	mkdirSync(destination, { recursive: true });
	const copied: string[] = [];
	for (const name of readdirSync(source)) {
		if (!name.endsWith('.js')) continue;
		const family = familyOf(name);
		if (family !== undefined && !configured.has(family)) continue;
		const target = join(destination, name);
		cpSync(join(source, name), target, { force: true });
		copied.push(target);
	}

	return copied;
};
