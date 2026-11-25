import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync
} from 'node:fs';
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

/* A chunk holding one framework's island hydrator imports that
 * framework's runtime by specifier (`from "svelte"`, `await
 * import("@angular/core")`). Those resolve in the browser only after
 * `rewriteClientOutputs` has turned them into the app's vendor path, and
 * there IS no vendor path for a framework the app does not configure. So
 * such a chunk is skipped for an unconfigured framework: nothing can
 * reach it anyway, because the only thing that imports it is an island of
 * that framework.
 *
 * Classified by what a chunk IMPORTS rather than by its file name. The
 * name is the module's basename, and `src/angular/islands.ts` is named
 * `islands` — so a name-based rule ("skip `angular-*`") copied Angular's
 * hydrator into every app, bare `@angular/core` imports and all, and the
 * nightly's `missing-client-frameworks` suite caught it on a React-only
 * project. The names of the other three happen to match their frameworks;
 * that was luck, not a contract. */
const FRAMEWORK_PACKAGES: Record<string, readonly string[]> = {
	angular: ['@angular'],
	react: ['react', 'react-dom'],
	svelte: ['svelte'],
	vue: ['vue', '@vue']
};

const SPECIFIER_RE = /["']((?:@[\w.-]+\/)?[\w.-]+)(?:\/[^"']*)?["']/g;

/* `@angular/core` belongs to `@angular`, and `svelte/internal/client` to
 * `svelte`: the comparison is on the package ROOT, not on the whole
 * specifier. An equality check reads `@angular/core` as belonging to no
 * framework at all, which makes the chunk look framework-agnostic and
 * copies it everywhere — the bug this filter exists to prevent. */
const ownsSpecifier = (packages: readonly string[], specifier: string) =>
	packages.some(
		(name) => specifier === name || specifier.startsWith(`${name}/`)
	);

const frameworkOwnersOf = (source: string) => {
	const specifiers = new Set<string>();
	for (const match of source.matchAll(SPECIFIER_RE)) {
		const specifier = match[1];
		if (specifier !== undefined) specifiers.add(specifier);
	}
	const owners = new Set<string>();
	for (const [framework, packages] of Object.entries(FRAMEWORK_PACKAGES)) {
		for (const specifier of specifiers) {
			if (ownsSpecifier(packages, specifier)) owners.add(framework);
		}
	}

	return owners;
};

/** Where the installed `@absolutejs/absolute/client` keeps its chunks, or
 *  `null` when the package resolves without them (a consumer that bundled
 *  the runtime flat, or a layout this does not recognise). */
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
		const owners = frameworkOwnersOf(
			readFileSync(join(source, name), 'utf8')
		);
		/* Skipped only when every framework it needs is unconfigured: a
		 * framework-agnostic chunk (no owners) is always copied, and one
		 * that somehow needed two frameworks is copied if either is
		 * configured rather than being dropped on a guess. */
		if (owners.size > 0 && ![...owners].some((f) => configured.has(f)))
			continue;
		const target = join(destination, name);
		cpSync(join(source, name), target, { force: true });
		copied.push(target);
	}

	return copied;
};
export const findClientRuntimeChunks = () => {
	const entry = resolvePackageImport('@absolutejs/absolute/client', [
		'browser',
		'import'
	]);
	if (!entry) return null;
	const chunks = join(dirname(entry), CHUNKS_DIRECTORY);

	return existsSync(chunks) ? chunks : null;
};
