import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import {
	getAngularVendorPaths,
	getDevVendorPaths,
	getEmberVendorPaths,
	getSvelteVendorPaths,
	getVueVendorPaths,
	setDevVendorPaths,
	setAngularVendorPaths,
	setEmberVendorPaths,
	setSvelteVendorPaths,
	setVueVendorPaths
} from './devVendorPaths';
import type { BuildConfig } from '../../types/build';
import {
	buildReactVendor,
	computeVendorPaths
} from '../build/buildReactVendor';
import {
	buildAngularVendor,
	computeAngularVendorPaths,
	computeAngularVendorPathsAsync
} from '../build/buildAngularVendor';
import {
	buildSvelteVendor,
	computeSvelteVendorPaths
} from '../build/buildSvelteVendor';
import { buildVueVendor, computeVueVendorPaths } from '../build/buildVueVendor';
import {
	buildEmberVendor,
	computeEmberVendorPaths
} from '../build/buildEmberVendor';
import { createHMRState } from '../dev/clientManager';
import { resolveBuildPaths } from '../dev/configResolver';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { addFileWatchers, startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { queueFileChange } from '../dev/rebuildTrigger';
import { logServerReload } from '../utils/logger';
import { logStartupTimingBlock } from '../utils/startupTimings';

const FRAMEWORK_DIR_KEYS = [
	'reactDirectory',
	'svelteDirectory',
	'vueDirectory',
	'htmlDirectory',
	'htmxDirectory',
	'angularDirectory'
] as const;

const collectDepVendorSourceDirs = (config: BuildConfig) => {
	const configuredDirs = [
		config.reactDirectory,
		config.svelteDirectory,
		config.vueDirectory,
		config.angularDirectory,
		config.htmlDirectory,
		config.htmxDirectory
	].filter((dir): dir is string => Boolean(dir));

	// Only scan the configured framework directories themselves. Including the
	// parent dir would sweep in sibling backend code (e.g. src/backend when
	// angularDirectory is src/frontend), and the dep vendor build targets the
	// browser — bundling Node-only deps like postgres/firebase-admin from there
	// fails with "Browser build cannot import Node.js builtin: tls/http2/...".
	return Array.from(new Set(configuredDirs));
};

/** Parse directory keys from config source text */
const parseDirectoryConfig = (source: string) => {
	const config: Partial<BuildConfig> = {};
	const dirPattern = /(\w+Directory)\s*:\s*['"]([^'"]+)['"]/g;
	let match;
	while ((match = dirPattern.exec(source)) !== null) {
		const [, key, value] = match;
		if (key && value) Object.assign(config, { [key]: value });
	}

	return Object.keys(config).length > 0 ? config : null;
};

/** Re-read absolute.config.ts bypassing Bun's module cache by parsing the file directly */
const reloadConfig = async () => {
	try {
		const configPath = resolve(
			process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
		);
		const source = await Bun.file(configPath).text();

		return parseDirectoryConfig(source);
	} catch {
		return null;
	}
};

/** Result of `detectConfigChanges`: which framework dir keys were
 *  added and which were removed in the new config. The additive case
 *  is handled in-place by this function (vendor paths set, watchers
 *  started); removals are reported but NOT torn down here — Elysia
 *  has no clean route-removal API, so callers should fall back to a
 *  child restart when `removed.length > 0`. */
export type ConfigChangeDiff = {
	added: Array<(typeof FRAMEWORK_DIR_KEYS)[number]>;
	removed: Array<(typeof FRAMEWORK_DIR_KEYS)[number]>;
};

/** Detect framework-dir changes in absolute.config.ts and update
 *  watchers / vendor paths for newly-added frameworks in place.
 *  Returns the diff so the caller can decide whether to also restart
 *  (for removal or non-framework key changes). */
const detectConfigChanges = async (
	cached: NonNullable<typeof globalThis.__hmrDevResult>
): Promise<ConfigChangeDiff> => {
	const newConfig = await reloadConfig();
	if (!newConfig) return { added: [], removed: [] };

	const state = cached.hmrState;
	const oldConfig = state.config;

	const added: typeof FRAMEWORK_DIR_KEYS[number][] = [];
	const removed: typeof FRAMEWORK_DIR_KEYS[number][] = [];
	for (const key of FRAMEWORK_DIR_KEYS) {
		const oldVal = oldConfig[key];
		const newVal = newConfig[key];
		if (oldVal === newVal) continue;
		// Pure add: previously unset, now set.
		if (!oldVal && newVal) added.push(key);
		// Pure remove: previously set, now unset.
		else if (oldVal && !newVal) removed.push(key);
		// Rename (both set, different value): treat as remove of the
		// old dir AND add of the new. The caller will restart on
		// removal, which is the right call for a rename anyway —
		// stale watchers, generated artifacts, and cached vendor
		// paths from the old dir don't get torn down here.
		else if (oldVal && newVal) {
			removed.push(key);
			added.push(key);
		}
	}
	if (added.length === 0 && removed.length === 0) {
		return { added: [], removed: [] };
	}

	// Snapshot old watch paths before updating config
	const oldWatchPaths = new Set(
		getWatchPaths(oldConfig, state.resolvedPaths)
	);

	// Update config in-place so all references stay valid
	for (const key of FRAMEWORK_DIR_KEYS) {
		state.config[key] = newConfig[key];
	}
	state.resolvedPaths = resolveBuildPaths(state.config);

	// Set up vendor paths for newly added frameworks
	if (!oldConfig.reactDirectory && Boolean(newConfig.reactDirectory)) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (!oldConfig.angularDirectory && Boolean(newConfig.angularDirectory)) {
		setAngularVendorPaths(computeAngularVendorPaths());
	}
	if (!oldConfig.svelteDirectory && Boolean(newConfig.svelteDirectory)) {
		setSvelteVendorPaths(computeSvelteVendorPaths());
	}
	if (!oldConfig.vueDirectory && Boolean(newConfig.vueDirectory)) {
		setVueVendorPaths(computeVueVendorPaths());
	}
	if (!oldConfig.emberDirectory && Boolean(newConfig.emberDirectory)) {
		setEmberVendorPaths(computeEmberVendorPaths());
	}

	// Compute new watch paths and start watchers for additions.
	const newWatchPaths = getWatchPaths(state.config, state.resolvedPaths);
	const addedPaths = newWatchPaths.filter((path) => !oldWatchPaths.has(path));

	if (addedPaths.length > 0) {
		buildInitialDependencyGraph(state.dependencyGraph, addedPaths);
		addFileWatchers(state, addedPaths, (filePath: string) => {
			queueFileChange(state, filePath, state.config, (newBuildResult) => {
				Object.assign(cached.manifest, newBuildResult.manifest);
				state.manifest = cached.manifest;
			});
		});
	}

	// NOTE: this only sets up vendor paths + watchers. It does NOT
	// build the new framework's pages — the dev pipeline's entry
	// sets (`svelteEntries`, `vueEntries`, …) are computed at boot
	// from the initial config, and the rebuild plumbing assumes
	// they're stable. Adding a framework dir in-place leaves the
	// manifest without entries for that framework. In practice the
	// user will edit server.ts next to register a route, the entry
	// watcher will fail to resolve `asset(manifest, NewPage)` (it'll
	// be undefined), and the entry-reload error handler emits
	// `[abs:restart]` which the parent CLI picks up — so a full
	// restart kicks in. That restart's fresh build sees the new
	// framework dir and compiles pages correctly.
	//
	// The "in-place, no restart" log message is misleading for the
	// add case; in real use it almost always becomes a restart at
	// the next server.ts edit. Tracked as #197.

	return { added, removed };
};

/** Public entry point for the in-place absolute.config.ts handler in
 *  `serverEntryWatcher`. Returns null if there's no live dev runtime
 *  (e.g. compiled production), or the diff that `detectConfigChanges`
 *  applied. */
export const applyConfigChanges = async (): Promise<ConfigChangeDiff | null> => {
	const cached = globalThis.__hmrDevResult;
	if (!cached) return null;
	return detectConfigChanges(cached);
};

/** Remove keys from target that don't exist in source */
const removeStaleKeys = (
	target: Record<string, string>,
	source: Record<string, string>
) => {
	for (const key of Object.keys(target)) {
		if (!(key in source)) delete target[key];
	}
};

const REBUILD_POLL_MS = 10;

/** Wait for any in-flight file-watcher build to finish */
const waitForRebuild = async (state: { isRebuilding: boolean }) => {
	if (!state.isRebuilding) {
		return;
	}

	await Bun.sleep(REBUILD_POLL_MS);
	await waitForRebuild(state);
};

/** Rebuild manifest and update asset store — called on every server.ts HMR reload.
 *  Sets isRebuilding to prevent the file-watcher fast path from running concurrently,
 *  which would delete the indexes directory mid-build and cause ModuleNotFound errors. */
const rebuildManifest = async (
	cached: NonNullable<typeof globalThis.__hmrDevResult>
) => {
	const state = cached.hmrState;

	// Without this, a concurrent fast-path build (React, Vue, Svelte) can
	// delete intermediate directories (indexes/, server/) while this full
	// build is trying to read from them, causing ModuleNotFound errors.
	await waitForRebuild(state);

	state.isRebuilding = true;

	try {
		const buildResult = await build({
			...state.config,
			mode: 'development',
			options: {
				...state.config.options,
				injectHMR: true,
				throwOnError: true
			}
		});
		if (!buildResult?.manifest) return;
		const newManifest = buildResult.manifest;

		// Replace manifest contents instead of just merging.
		// Object.assign only adds/updates keys — it never removes them,
		// so deleted pages would leave dead keys in the manifest forever.
		removeStaleKeys(cached.manifest, newManifest);
		Object.assign(cached.manifest, newManifest);
		state.manifest = cached.manifest;

		await populateAssetStore(
			state.assetStore,
			cached.manifest,
			state.resolvedPaths.buildDir
		);
		await cleanStaleAssets(
			state.assetStore,
			cached.manifest,
			state.resolvedPaths.buildDir
		);
	} catch {
		// Build errors are logged by build() itself
	} finally {
		state.rebuildCount++;
		state.isRebuilding = false;
		// Clear any file-change queue entries that accumulated during the full build —
		// the full build already picked up those files, so they don't need rebuilding.
		state.fileChangeQueue.clear();
	}
};

const handleCachedReload = async () => {
	const serverMtime = statSync(resolve(Bun.main)).mtimeMs;
	const lastMtime = globalThis.__hmrServerMtime;
	globalThis.__hmrServerMtime = serverMtime;

	/* Restore vendor paths — module-level state is reset on --hot reload
	   but devBuild() returns early from cache, skipping setDevVendorPaths.
	   Without this, HMR rebuilds bundle React inline instead of externalizing. */
	const cached = globalThis.__hmrDevResult;
	if (cached?.hmrState.config.reactDirectory) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (cached?.hmrState.config.angularDirectory) {
		// Use cached transitive specifiers if available — reverting to defaults
		// would drop subpaths discovered through deps (e.g. @angular/core/rxjs-interop
		// imported by @angular/fire) and leave them as bare specifiers in rebuilds.
		setAngularVendorPaths(
			computeAngularVendorPaths(globalThis.__angularVendorSpecifiers)
		);
	}
	if (cached?.hmrState.config.svelteDirectory) {
		setSvelteVendorPaths(computeSvelteVendorPaths());
	}
	if (cached?.hmrState.config.vueDirectory) {
		setVueVendorPaths(computeVueVendorPaths());
	}
	if (cached?.hmrState.config.emberDirectory) {
		setEmberVendorPaths(computeEmberVendorPaths());
	}

	if (serverMtime === lastMtime) {
		globalThis.__hmrSkipServerRestart = true;

		return;
	}

	logServerReload();
	if (!cached) return;

	// Detect config changes (new framework directories) and update watchers
	await detectConfigChanges(cached);
	// Always rebuild when server.ts changes — new pages/routes may have been added
	// even if config directories haven't changed
	await rebuildManifest(cached);
};

const tryReadPackageVersion = async (path: string) => {
	const pkg = await Bun.file(path)
		.json()
		.catch(() => null);
	if (!pkg || pkg.name !== '@absolutejs/absolute') {
		return false;
	}
	globalThis.__absoluteVersion = pkg.version;

	return true;
};

const resolveAbsoluteVersion = async () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	const [candidate, ...remaining] = candidates;
	if (!candidate) {
		return;
	}

	const found = await tryReadPackageVersion(candidate);
	if (found) {
		return;
	}

	await resolveAbsoluteVersionFromCandidates(remaining);
};

const resolveAbsoluteVersionFromCandidates = async (candidates: string[]) => {
	const [candidate, ...remaining] = candidates;
	if (!candidate) {
		return;
	}

	const found = await tryReadPackageVersion(candidate);
	if (found) {
		return;
	}

	await resolveAbsoluteVersionFromCandidates(remaining);
};

const loadVendorFiles = async (
	assetStore: Map<string, Uint8Array>,
	vendorDir: string,
	framework: string
) => {
	const emptyStringArray: string[] = [];
	const entries = await readdir(vendorDir).catch(() => emptyStringArray);
	await Promise.all(
		entries
			.filter((entry) => entry.endsWith('.js'))
			.map(async (entry) => {
				const webPath = `/${framework}/vendor/${entry}`;
				const bytes = await Bun.file(resolve(vendorDir, entry)).bytes();
				assetStore.set(webPath, bytes);
			})
	);
};

/* Development mode function - replaces build() during development
   Returns DevResult with manifest, buildDir, asset(), and hmrState for use with the hmr() plugin */
export const devBuild = async (config: BuildConfig) => {
	// On Bun --hot reload, return cached result instead of rebuilding
	const cached = globalThis.__hmrDevResult;
	if (cached) {
		await handleCachedReload();

		return cached;
	}

	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	// Create initial HMR state with config
	let stepStartedAt = performance.now();
	const state = createHMRState(config);
	// Make the build dir discoverable to the runtime (e.g. getAngularDeps
	// looks for `<buildDir>/angular/vendor/server/*.js`). The CLI's start
	// script sets this for prod; dev runs in the same process as build, so
	// set it here.
	process.env.ABSOLUTE_BUILD_DIR ??= state.resolvedPaths.buildDir;
	recordStep('create HMR state', stepStartedAt);

	// Initialize dependency graph by scanning all source files
	stepStartedAt = performance.now();
	const watchPaths = getWatchPaths(config, state.resolvedPaths);
	buildInitialDependencyGraph(state.dependencyGraph, watchPaths);
	recordStep('initialize dependency graph', stepStartedAt);

	// Pre-compute vendor paths so build() can externalize frameworks.
	// The actual vendor files are built after build() creates the output dir.
	stepStartedAt = performance.now();
	if (config.reactDirectory) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (config.svelteDirectory) {
		setSvelteVendorPaths(computeSvelteVendorPaths());
	}
	if (config.vueDirectory) {
		setVueVendorPaths(computeVueVendorPaths());
	}
	if (config.emberDirectory) {
		setEmberVendorPaths(computeEmberVendorPaths());
	}
	const sourceDirs = collectDepVendorSourceDirs(config);
	if (config.angularDirectory) {
		setAngularVendorPaths(await computeAngularVendorPathsAsync(sourceDirs));
		// §1.1 — dev mode does not vendor the server-side Angular packages.
		// `compileAngular`'s SSR rewrite is gated on these paths being set,
		// so leaving it null preserves bare `@angular/*` specifiers in the
		// server bundle, which Bun resolves through node_modules — one
		// canonical instance per process across HMR cycles.
	}
	const { computeDepVendorPaths } = await import('../build/buildDepVendor');
	globalThis.__depVendorPaths = await computeDepVendorPaths(sourceDirs);
	recordStep('prepare vendor paths', stepStartedAt);

	stepStartedAt = performance.now();
	await resolveAbsoluteVersion();
	recordStep('resolve version', stepStartedAt);

	const buildStart = performance.now();

	// Initial build (HMR client is baked into index files and HTML/HTMX pages).
	//
	// `throwOnError: true` so a broken page in the user's source tree
	// throws rather than calling `exit(1)` from inside `extractBuildError`.
	// We catch it here and continue with an empty manifest: the dev
	// server still binds its port, the file watcher still starts, and
	// the user's next edit triggers `rebuildManifest` which converges
	// to a working state — mirror of the mid-session build-error
	// recovery contract. Without this, a single syntax error at cold
	// start kills boot and leaves the user without live-reload
	// feedback to find their mistake.
	let buildResult: Awaited<ReturnType<typeof build>> | null = null;
	try {
		buildResult = await build({
			...config,
			mode: 'development',
			options: {
				...config.options,
				injectHMR: true,
				throwOnError: true
			}
		});
	} catch (err) {
		console.error(
			'[hmr] initial build failed — starting dev server with an empty manifest.\n' +
				'      Fix the error above and save the file to trigger a recovery rebuild.'
		);
		if (err instanceof Error && err.stack) {
			console.error(err.stack);
		}
		state.initialBuildFailed = true;
	}
	const manifest = buildResult?.manifest ?? {};
	const conventions = buildResult?.conventions ?? {};
	recordStep('initial build', buildStart);

	if (Object.keys(manifest).length === 0) {
		console.log(
			'⚠️ Manifest is empty - this is OK for HTML/HTMX-only projects'
		);
	}

	// Populate in-memory asset store so client assets are served from memory
	stepStartedAt = performance.now();
	await populateAssetStore(
		state.assetStore,
		manifest,
		state.resolvedPaths.buildDir
	);
	void cleanStaleAssets(
		state.assetStore,
		manifest,
		state.resolvedPaths.buildDir
	);
	recordStep('populate asset store', stepStartedAt);

	// Build vendor files in parallel now that the build directory exists.
	// Each task only BUILDS — file rewriting + asset-store loading happen below
	// in a centralized post-step so cross-framework specifier rewrites can use
	// the FULL combined path map (react ∪ angular ∪ svelte ∪ vue ∪ dep).
	stepStartedAt = performance.now();
	const reactVendorDir = resolve(
		state.resolvedPaths.buildDir,
		'react',
		'vendor'
	);
	const angularVendorDir = resolve(
		state.resolvedPaths.buildDir,
		'angular',
		'vendor'
	);
	const svelteVendorDir = resolve(
		state.resolvedPaths.buildDir,
		'svelte',
		'vendor'
	);
	const vueVendorDir = resolve(state.resolvedPaths.buildDir, 'vue', 'vendor');
	const depVendorDir = resolve(state.resolvedPaths.buildDir, 'vendor');

	const { buildDepVendor } = await import('../build/buildDepVendor');

	// §1.1 — dev mode SKIPS `buildAngularServerVendor`. The build was the
	// load-bearing source of two `@angular/core` instances co-existing in
	// the SSR runtime after an HMR cycle (NG0203 / `currentInjector ===
	// undefined`). Without the server vendor on disk, every Angular import
	// — from page bundles, from `getAngularDeps()`, from
	// `@angular/platform-server` — resolves through Bun's normal
	// node_modules path, giving exactly one instance per process. The
	// production path in `core/build.ts` still builds + uses the server
	// vendor (linker pre-link perf win at prod start time).
	const [, angularSpecs, , , , , depPaths] = await Promise.all([
		config.reactDirectory
			? buildReactVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		config.angularDirectory
			? buildAngularVendor(
					state.resolvedPaths.buildDir,
					sourceDirs,
					/* linkerJitMode */ true,
					/* depVendorSpecifiers */ Object.keys(
						globalThis.__depVendorPaths ?? {}
					)
				)
			: Promise.resolve(undefined),
		Promise.resolve(undefined),
		config.svelteDirectory
			? buildSvelteVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		config.vueDirectory
			? buildVueVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		config.emberDirectory
			? buildEmberVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		buildDepVendor(state.resolvedPaths.buildDir, sourceDirs)
	]);
	if (angularSpecs) globalThis.__angularVendorSpecifiers = angularSpecs;
	// Intentionally NOT calling setAngularServerVendorPaths in dev — the
	// absence of these paths is what makes `compileAngular`'s server-bundle
	// rewrite step skip and leave bare `@angular/*` specifiers, and what
	// makes `resolveAngularRuntimePath` fall through to node_modules.
	if (config.emberDirectory) {
		setEmberVendorPaths(computeEmberVendorPaths());
	}
	globalThis.__depVendorPaths = depPaths;
	recordStep('build vendor bundles', stepStartedAt);

	// Cross-vendor specifier rewriting: a vendor file may externalize packages
	// owned by a different vendor pipeline (e.g. /vendor/sentry_angular.js
	// externalizes @angular/core; /vendor/firebase_auth_compat.js externalizes
	// @firebase/auth). Without rewriting these to their vendor paths, the
	// browser fetches the vendor file at runtime and chokes on bare specifiers.
	// Run AFTER all vendor builds so every framework's path map is included.
	stepStartedAt = performance.now();
	const combinedVendorPaths: Record<string, string> = {
		...(getDevVendorPaths() ?? {}),
		...(getAngularVendorPaths() ?? {}),
		...(getSvelteVendorPaths() ?? {}),
		...(getVueVendorPaths() ?? {}),
		...depPaths
	};
	const activeVendorDirs = [
		config.reactDirectory ? reactVendorDir : null,
		config.angularDirectory ? angularVendorDir : null,
		config.svelteDirectory ? svelteVendorDir : null,
		config.vueDirectory ? vueVendorDir : null,
		depVendorDir
	].filter((d): d is string => d !== null);
	const { rewriteVendorDirectories } = await import(
		'../build/rewriteImportsPlugin'
	);
	await rewriteVendorDirectories(activeVendorDirs, combinedVendorPaths);
	recordStep('rewrite vendor cross-references', stepStartedAt);

	// Load the (now-rewritten) vendor files into the in-memory asset store.
	stepStartedAt = performance.now();
	await Promise.all([
		config.reactDirectory
			? loadVendorFiles(state.assetStore, reactVendorDir, 'react')
			: Promise.resolve(),
		config.angularDirectory
			? loadVendorFiles(state.assetStore, angularVendorDir, 'angular')
			: Promise.resolve(),
		config.svelteDirectory
			? loadVendorFiles(state.assetStore, svelteVendorDir, 'svelte')
			: Promise.resolve(),
		config.vueDirectory
			? loadVendorFiles(state.assetStore, vueVendorDir, 'vue')
			: Promise.resolve(),
		loadVendorFiles(state.assetStore, depVendorDir, 'vendor')
	]);
	if (config.reactDirectory && !globalThis.__reactModuleRef) {
		globalThis.__reactModuleRef = await import('react');
	}
	recordStep('load vendor files', stepStartedAt);

	// Pre-warm framework compilers so the first HMR edit is fast.
	// Sets the module-level compiler references in moduleServer.ts
	// so transformSvelteFile/transformVueFile skip the dynamic import.
	stepStartedAt = performance.now();
	const { warmCompilers } = await import('../dev/moduleServer');
	await warmCompilers({
		svelte: Boolean(config.svelteDirectory),
		vue: Boolean(config.vueDirectory)
	});
	recordStep('warm compilers', stepStartedAt);

	// Pre-build the persistent Tailwind compiler so the first HMR tick
	// after server start doesn't pay the parse + initial-scan cost.
	if (config.tailwind) {
		stepStartedAt = performance.now();
		const [{ warmTailwindCompiler }, { computeFrameworkTailwindSources }] =
			await Promise.all([
				import('../build/tailwindCompiler'),
				import('../build/compileTailwind')
			]);
		await warmTailwindCompiler(
			config.tailwind,
			computeFrameworkTailwindSources(config)
		);
		recordStep('warm tailwind compiler', stepStartedAt);
	}

	// Store initial manifest on HMR state for Angular fast-path HMR
	state.manifest = manifest;

	stepStartedAt = performance.now();
	// Cold-start recovery: if the initial `build()` threw, route the
	// next file change through a FULL `build()` (the same call as the
	// initial one) so the manifest, asset store, and on-disk
	// intermediates all repopulate from scratch. The fast-path
	// `queueFileChange` only updates the directly-edited file's
	// manifest entry — fine on a healthy session, but here it leaves
	// e.g. `VueExampleCSS` / `VueExampleIndex` undefined and the
	// route's `asset(...)` call still throws "not found." After a
	// successful recovery build, clear the flag and fall back to the
	// fast path for subsequent edits.
	const recoverFromColdStartFailure = async () => {
		await waitForRebuild(state);
		state.isRebuilding = true;
		try {
			const recoveryResult = await build({
				...config,
				mode: 'development',
				options: {
					...config.options,
					injectHMR: true,
					throwOnError: true
				}
			});
			if (recoveryResult?.manifest) {
				Object.assign(manifest, recoveryResult.manifest);
				state.manifest = manifest;
				await populateAssetStore(
					state.assetStore,
					manifest,
					state.resolvedPaths.buildDir
				);
				state.initialBuildFailed = false;
				console.log(
					'[hmr] cold-start recovery rebuild succeeded — manifest populated.'
				);
			}
		} catch {
			/* still broken — leave the flag set; next file change
			 * retries. The build logs its own error output. */
		} finally {
			state.rebuildCount++;
			state.isRebuilding = false;
			state.fileChangeQueue.clear();
		}
	};
	startFileWatching(state, config, (filePath: string) => {
		if (state.initialBuildFailed) {
			void recoverFromColdStartFailure();
			return;
		}
		queueFileChange(state, filePath, config, (newBuildResult) => {
			Object.assign(manifest, newBuildResult.manifest);
			state.manifest = manifest;
		});
	});
	recordStep('start file watching', stepStartedAt);

	// Store build duration for the startup banner (printed by networking plugin)
	globalThis.__hmrBuildDuration = performance.now() - buildStart;
	logStartupTimingBlock('AbsoluteJS devBuild timing', startupSteps);

	const result: NonNullable<typeof globalThis.__hmrDevResult> = {
		conventions,
		hmrState: state,
		manifest
	};

	// Cache for Bun --hot reloads
	globalThis.__hmrDevResult = result;
	globalThis.__hmrServerMtime = statSync(resolve(Bun.main)).mtimeMs;

	return result;
};
