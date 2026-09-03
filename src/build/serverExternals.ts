import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, join } from 'node:path';
import type { BunPlugin } from 'bun';

/** Packages that must stay inlined even though the runtime could resolve
 *  them. Automatic detection (SFC files, unbuilt TS, Svelte conditions)
 *  covers the known cases, so this is intentionally short — add an entry
 *  here only for a package that needs bundler-only features (e.g. a
 *  `define` substitution or a loader plugin) to work server-side. */
export const DEFAULT_BUNDLED_SERVER_DEPENDENCIES: readonly string[] = [];

export type DevServerExternalsOptions = {
	/** Absolute project root — the directory whose `node_modules` the
	 *  running dev server resolves bare specifiers from. */
	projectRoot: string;
	/** Package names / patterns that must stay bundled, on top of
	 *  `DEFAULT_BUNDLED_SERVER_DEPENDENCIES`. Accepts an exact package name
	 *  (`three`), an exact specifier (`three/examples/jsm`), a package-scoped
	 *  glob (`@scope/*`, `pkg/*`) or `*` for every package (legacy
	 *  inline-everything behaviour). */
	bundleDependencies?: readonly string[];
};

export type DevServerExternalResolver = {
	/** Whether `specifier`, imported from `importer` (absolute path, or
	 *  empty for entry points), should be left as a bare runtime import. */
	isExternal: (specifier: string, importer: string) => boolean;
};

/** Cross-framework externals for SERVER (Bun-target) page bundles.
 *
 *  `@absolutejs/absolute`'s internals reference every framework's runtime
 *  transitively (react-dom/server, svelte/server, @angular/core, …). A
 *  single-framework project only has its own framework installed, so these
 *  specifiers must stay bare — resolved (or harmlessly absent) at runtime —
 *  instead of failing the bundle at build time with "Could not resolve".
 *
 *  The initial build always used this list (core/build.ts); the dev bundle
 *  rebuilds only externalized their own framework's packages, which meant a
 *  vue-only project's SSR rebuild failed on react/svelte/angular imports on
 *  EVERY edit — silently, before soft-failure logging landed — and the dev
 *  server served boot-time SSR bundles until restart. */
export const buildServerBundleExternals = (
	angularVendorPaths?: Record<string, string> | null
) => {
	// Third-party Angular libraries with linked partial declarations get a
	// vendor bundle — keep their bare specifiers intact so `rewriteImports`
	// can retarget them (see core/build.ts for the full rationale).
	const angularPartialDeclSpecs = Object.keys(angularVendorPaths ?? {})
		.filter((spec) => !spec.startsWith('@angular/'))
		.flatMap((spec) => [spec, `${spec}/*`]);

	return [
		'react',
		'react/*',
		'react-dom',
		'react-dom/*',
		'svelte',
		'svelte/*',
		'vue',
		'vue/*',
		// vue-demi's `export * from 'vue'` re-export breaks under Bun's
		// bundler rewrite — externalize so ESM semantics handle it.
		'vue-demi',
		'@vue/*',
		'@angular/*',
		...angularPartialDeclSpecs,
		'typescript'
	];
};

/* ------------------------------------------------------------------------
 * DEV-ONLY node_modules externalization for server (Bun-target) bundles.
 *
 * In development the SSR page bundles are loaded by the very same Bun
 * process that has the project's `node_modules` on its resolution path, so
 * there is no reason to inline third-party packages into every page: a
 * 74-page Vue app measured 10-36 MB per page bundle (366 MB total) because
 * `@sinclair/typebox`, `elysia`, `three`, … were copied into each one, and
 * every later post-processing phase (sourcemap chaining in particular)
 * scaled with those bytes. Leaving the bare specifier in place lets the
 * runtime resolve one shared copy from `node_modules`.
 *
 * A package stays bundled when the runtime could not load it as-is:
 *   - it isn't resolvable from the project root, or resolves to a different
 *     file than from the importing module (nested `node_modules`);
 *   - its resolved entry isn't plain JS/JSON (unbuilt `.ts`, `.vue`,
 *     `.svelte`, CSS, …);
 *   - the resolved entry's subtree ships `.vue`/`.svelte` single-file
 *     components (its JS would import them at runtime, which only the
 *     bundler handles);
 *   - the package declares a Svelte export condition / `svelte` field (the
 *     bundler resolves it under `conditions: ['svelte', 'main']`, the runtime
 *     wouldn't);
 *   - it matches `dev.bundleServerDependencies` (or the built-in defaults).
 *
 * Production builds never use this plugin — their output is unchanged.
 * ---------------------------------------------------------------------- */

/** File types the Bun runtime loads verbatim from `node_modules`. Anything
 *  else (SFCs, stylesheets, unbuilt TypeScript, …) needs the bundler. */
const RUNTIME_LOADABLE_EXTENSIONS = new Set([
	'.cjs',
	'.js',
	'.json',
	'.mjs',
	'.node',
	'.wasm'
]);

const SFC_EXTENSIONS = new Set(['.svelte', '.vue']);

/** Directory-walk budget for the SFC scan of the subtree holding a
 *  package's resolved entry. Hitting the cap means "unknown" → bundle, the
 *  conservative default. */
const ENTRY_SUBTREE_SCAN_BUDGET = 20_000;

type PackageManifest = { exports?: unknown; name?: unknown; svelte?: unknown };

const isBareSpecifier = (specifier: string) => {
	if (specifier.length === 0) return false;
	const [first] = specifier;
	if (first === '.' || first === '/' || first === '#') return false;
	// `node:fs`, `bun:sqlite`, `data:`, `https://…`, Windows drive letters —
	// all handled natively by Bun, never a node_modules package.
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return false;

	return true;
};

/** `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`. */
export const packageNameOf = (specifier: string) => {
	const parts = specifier.split('/');
	if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');

	return parts[0] ?? specifier;
};

const matchesBundlePattern = (
	pattern: string,
	specifier: string,
	packageName: string
) => {
	if (pattern === '*') return true;
	if (pattern.endsWith('/*')) {
		const prefix = pattern.slice(0, pattern.length - 1);

		return (
			specifier.startsWith(prefix) ||
			`${specifier}/`.startsWith(prefix) ||
			`${packageName}/`.startsWith(prefix)
		);
	}

	return pattern === specifier || pattern === packageName;
};

const resolveOrNull = (specifier: string, fromDir: string) => {
	try {
		return Bun.resolveSync(specifier, fromDir);
	} catch {
		return null;
	}
};

const hasPackageName = (manifestPath: string) => {
	try {
		const parsed: PackageManifest = JSON.parse(
			readFileSync(manifestPath, 'utf-8')
		);

		return typeof parsed.name === 'string';
	} catch {
		return false;
	}
};

/** Nearest ancestor directory carrying a NAMED package.json (skips the
 *  `{ "type": "module" }` shims packages drop into `dist/` folders). */
const findPackageRoot = (filePath: string) => {
	let dir = dirname(filePath);
	while (true) {
		const manifestPath = join(dir, 'package.json');
		if (existsSync(manifestPath) && hasPackageName(manifestPath))
			return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

const readManifest = (packageRoot: string) => {
	try {
		const parsed: PackageManifest = JSON.parse(
			readFileSync(join(packageRoot, 'package.json'), 'utf-8')
		);

		return parsed;
	} catch {
		return null;
	}
};

/** Depth-first search of an `exports` map for a `svelte` condition key. */
const hasSvelteCondition = (exportsField: unknown): boolean => {
	if (!exportsField || typeof exportsField !== 'object') return false;
	const entries = Object.entries(exportsField);
	if (entries.some(([key]) => key === 'svelte')) return true;

	return entries.some(([, value]) => hasSvelteCondition(value));
};

/** True when the package publishes a Svelte-specific entry (top-level
 *  `"svelte"` field or a `svelte` export condition — NOT a peer dependency
 *  on svelte, which every framework adapter declares). The server build
 *  resolves those under `conditions: ['svelte', 'main']`; the runtime would
 *  pick a different file (or none), so keep the bundler's resolution. */
const declaresSvelteEntry = (packageRoot: string) => {
	const manifest = readManifest(packageRoot);
	if (!manifest) return false;

	return (
		typeof manifest.svelte === 'string' ||
		hasSvelteCondition(manifest.exports)
	);
};

const listDirectory = (dir: string) => {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
};

const isSfcFile = (entry: Dirent) =>
	entry.isFile() && SFC_EXTENSIONS.has(extname(entry.name));

/** Child directories to keep walking — nested `node_modules` are skipped
 *  (their packages get their own decision). */
const subdirectoriesOf = (dir: string, entries: Dirent[]) =>
	entries
		.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
		.map((entry) => join(dir, entry.name));

/** Bounded depth-first walk looking for `.vue` / `.svelte` files. */
const scanForSfc = (root: string, budget: number) => {
	const pending = [root];
	let visited = 0;
	for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
		const entries = listDirectory(dir);
		visited += entries.length;
		if (visited > budget) return 'capped';
		if (entries.some(isSfcFile)) return 'found';
		pending.push(...subdirectoriesOf(dir, entries));
	}

	return 'none';
};

export const createDevServerExternalResolver = ({
	projectRoot,
	bundleDependencies = []
}: DevServerExternalsOptions): DevServerExternalResolver => {
	const bundlePatterns = [
		...DEFAULT_BUNDLED_SERVER_DEPENDENCIES,
		...bundleDependencies
	];
	const rootResolutions = new Map<string, string | null>();
	const decisions = new Map<string, boolean>();
	const packageDecisions = new Map<string, boolean>();
	const entryDecisions = new Map<string, boolean>();

	const resolveFromRoot = (specifier: string) => {
		const cached = rootResolutions.get(specifier);
		if (cached !== undefined) return cached;
		const resolved = resolveOrNull(specifier, projectRoot);
		rootResolutions.set(specifier, resolved);

		return resolved;
	};

	/** Package-wide verdict: a Svelte export condition means the bundler and
	 *  the runtime would resolve different files. */
	const packageIsRuntimeResolvable = (resolvedPath: string) => {
		const packageRoot = findPackageRoot(resolvedPath);
		if (!packageRoot) return false;
		const cached = packageDecisions.get(packageRoot);
		if (cached !== undefined) return cached;
		const verdict = !declaresSvelteEntry(packageRoot);
		packageDecisions.set(packageRoot, verdict);

		return verdict;
	};

	/** Per-entry verdict: JS next to `.vue`/`.svelte` files is assumed to
	 *  import them, which only the bundler can load. Scoped to the resolved
	 *  entry's subtree so a package that ships several framework adapters
	 *  (`dist/vue`, `dist/svelte`, …) is judged per subpath — its Vue entry
	 *  stays external even though the Svelte one carries SFCs. */
	const entryIsRuntimeLoadable = (resolvedPath: string) => {
		const entryDir = dirname(resolvedPath);
		const cached = entryDecisions.get(entryDir);
		if (cached !== undefined) return cached;
		const verdict =
			scanForSfc(entryDir, ENTRY_SUBTREE_SCAN_BUDGET) === 'none';
		entryDecisions.set(entryDir, verdict);

		return verdict;
	};

	const decide = (specifier: string, importer: string) => {
		if (!isBareSpecifier(specifier) || isBuiltin(specifier)) return false;
		const packageName = packageNameOf(specifier);
		const forcedBundle = bundlePatterns.some((pattern) =>
			matchesBundlePattern(pattern, specifier, packageName)
		);
		if (forcedBundle) return false;
		const fromRoot = resolveFromRoot(specifier);
		if (!fromRoot || !fromRoot.includes('/node_modules/')) return false;
		if (!RUNTIME_LOADABLE_EXTENSIONS.has(extname(fromRoot))) return false;
		const importerDir = importer ? dirname(importer) : projectRoot;
		if (
			importerDir !== projectRoot &&
			resolveOrNull(specifier, importerDir) !== fromRoot
		)
			return false;

		return (
			packageIsRuntimeResolvable(fromRoot) && entryIsRuntimeLoadable(fromRoot)
		);
	};

	return {
		isExternal: (specifier, importer) => {
			const key = `${specifier}\0${importer ? dirname(importer) : ''}`;
			const cached = decisions.get(key);
			if (cached !== undefined) return cached;
			const verdict = decide(specifier, importer);
			decisions.set(key, verdict);

			return verdict;
		}
	};
};

/** Bun plugin: leave resolvable `node_modules` packages as bare imports in
 *  dev server bundles. See the module header for the rules. */
export const createDevServerExternalsPlugin = (
	options: DevServerExternalsOptions
): BunPlugin => {
	const resolver = createDevServerExternalResolver(options);

	return {
		name: 'absolute-dev-server-externals',
		setup(build) {
			build.onResolve({ filter: /^[^./]/ }, (args) => {
				if (args.namespace !== 'file' && args.namespace !== '')
					return undefined;
				if (!resolver.isExternal(args.path, args.importer))
					return undefined;

				return { external: true, path: args.path };
			});
		}
	};
};
