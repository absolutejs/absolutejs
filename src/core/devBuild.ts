import { readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import {
	getAngularVendorPaths,
	getDevVendorPaths,
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
import {
	adoptDependencyGraph,
	collectConfigVendorSourceDirs,
	prescanVendorPaths,
	readDevPrescan
} from '../dev/devPrescan';
import { addFileWatchers, startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { drainPendingQueue, queueFileChange } from '../dev/rebuildTrigger';
import { logServerReload } from '../utils/logger';
import { logStartupTimingBlock } from '../utils/startupTimings';
import { deferUntilServing, setBootPhase } from '../dev/bootLifecycle';
import {
	createLazyPageRegistry,
	createOnDemandPageBuilder,
	lazyPagesEnabled,
	updateLazyPageRegistry
} from '../dev/lazyPages';
import { setDevPageWarmer } from './requestContext';

const FRAMEWORK_DIR_KEYS = [
	'reactDirectory',
	'svelteDirectory',
	'vueDirectory',
	'htmlDirectory',
	'htmxDirectory',
	'angularDirectory'
] as const;

/* The browser HMR runtime has its own package imports (for example Sync
 * diagnostics). They join the same vendor/rewrite graph as application
 * imports so split dev chunks never leak bare specifiers. Resolved
 * relative to this bundle, which is why it is scanned separately from the
 * config-derived directories the CLI's pre-scan covers — the two
 * processes load different bundles. */
const devClientVendorSourceDir = () =>
	resolve(import.meta.dir, '../dev/client');

export const collectDepVendorSourceDirs = (config: BuildConfig) => {
	const configuredDirs = [
		...collectConfigVendorSourceDirs(config),
		devClientVendorSourceDir()
	];

	// Only scan the configured framework directories themselves. Including the
	// parent dir would sweep in sibling backend code (e.g. src/backend when
	// angularDirectory is src/frontend), and the dep vendor build targets the
	// browser — bundling Node-only deps like postgres/firebase-admin from there
	// fails with "Browser build cannot import Node.js builtin: tls/http2/...".
	return Array.from(new Set(configuredDirs));
};

/** Individual sources that join the dependency-vendor graph on top of the
 *  scanned directories. The mobile preview client (served at
 *  `/__absolute/mobile-preview-client.js`) imports `@absolutejs/devices`,
 *  `@absolutejs/devices/testing`, and `@absolutejs/http`; vendoring them lets
 *  the preview share module instances with page code, and skipping the scan
 *  for web-only projects keeps every mobile package out of their vendor set. */
const collectDepVendorSourceFiles = async (config: BuildConfig) => {
	if (!config.mobile) return [];
	const { resolveAbsoluteMobilePreviewClientEntry } = await import(
		'../mobile/mobilePreviewClientBundle'
	);

	return [await resolveAbsoluteMobilePreviewClientEntry()];
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

	const added: (typeof FRAMEWORK_DIR_KEYS)[number][] = [];
	const removed: (typeof FRAMEWORK_DIR_KEYS)[number][] = [];
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
export const applyConfigChanges = async () => {
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
	// Queue entries that exist BEFORE the full build starts are guaranteed
	// to be consumed by it — their writes completed before the build began,
	// so every pass reads post-edit content. Clear them now; only edits
	// arriving DURING the build (which the build may have read too late)
	// stay queued for the post-build drain in `finally`.
	state.fileChangeQueue.clear();

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
		if (state.lazyPages && buildResult.pageEntries) {
			updateLazyPageRegistry(
				state.lazyPages.registry,
				buildResult.pageEntries
			);
		}

		// Track partial-build failures so a reconnecting browser still sees
		// the overlay; clear them when the build is fully clean again.
		state.lastBuildErrors =
			buildResult.errors && buildResult.errors.length > 0
				? buildResult.errors
				: undefined;

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
		// Edits saved while the full build ran may have been read too late
		// to be included (the build reads each source file at an unknowable
		// point mid-build) — drain them into a follow-up rebuild instead of
		// assuming the build consumed them. No-ops when the queue is empty.
		drainPendingQueue(state, state.config, (newBuildResult) => {
			Object.assign(cached.manifest, newBuildResult.manifest);
			state.manifest = cached.manifest;
		});
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
	// The on-demand page warmer closes over the moduleServer module
	// instance; re-point the ambient registry at the fresh one.
	if (cached?.hmrState.lazyPages) {
		const { createDevPageWarmer } = await import('../dev/moduleServer');
		setDevPageWarmer(createDevPageWarmer());
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

	// Pin the server-side React instance before Bun.build can invalidate or
	// replace package modules. Page components are imported before prepare(),
	// so this reference shares their hook dispatcher and is the canonical side
	// of bridgeReactInternals() throughout the dev session.
	if (config.reactDirectory && !globalThis.__reactModuleRef) {
		globalThis.__reactModuleRef = await import('react');
	}

	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	/* On-demand pages (default): the boot build skips every page entry and
	 * each page is bundled by its first request. `warmedPages` is the live
	 * set of pages built so far — shared by identity with the build option
	 * so every later full rebuild (server entry reload, cold-start
	 * recovery) re-emits exactly those pages. `--eager` /
	 * `ABSOLUTE_DEV_EAGER=1` restores the full boot build. */
	const lazyPages = lazyPagesEnabled();
	const warmedPages = new Set<string>();
	if (lazyPages) {
		config.options = {
			...config.options,
			deferPageEntries: { except: warmedPages }
		};
	}

	// Create initial HMR state with config
	let stepStartedAt = performance.now();
	const state = createHMRState(config);
	// Make the build dir discoverable to the runtime (e.g. getAngularDeps
	// looks for `<buildDir>/angular/vendor/server/*.js`). The CLI's start
	// script sets this for prod; dev runs in the same process as build, so
	// set it here.
	process.env.ABSOLUTE_BUILD_DIR ??= state.resolvedPaths.buildDir;
	recordStep('create HMR state', stepStartedAt);

	// The CLI parent scans the source tree for us while this process is
	// still evaluating the user's import graph — see `dev/devPrescan.ts`.
	// Started here, awaited a few steps down, so the cheap local setup
	// runs during whatever is left of the parent's scan.
	setBootPhase('scan source tree');
	const prescanPromise = readDevPrescan();

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
	recordStep('prepare framework vendor paths', stepStartedAt);

	stepStartedAt = performance.now();
	await resolveAbsoluteVersion();
	recordStep('resolve version', stepStartedAt);

	// Everything below falls back to scanning here when the handshake is
	// off, late, or covered a different set of directories.
	stepStartedAt = performance.now();
	const prescan = await prescanPromise;
	recordStep('adopt CLI pre-scan', stepStartedAt);

	// Initialize dependency graph by scanning all source files
	stepStartedAt = performance.now();
	const watchPaths = getWatchPaths(config, state.resolvedPaths);
	if (prescan?.dependencies) {
		adoptDependencyGraph(state.dependencyGraph, prescan.dependencies);
	} else {
		buildInitialDependencyGraph(state.dependencyGraph, watchPaths);
	}
	recordStep('initialize dependency graph', stepStartedAt);

	stepStartedAt = performance.now();
	const sourceFiles = await collectDepVendorSourceFiles(config);
	const configVendorDirs = collectConfigVendorSourceDirs(config);
	const prescannedVendorPaths = prescanVendorPaths(prescan, configVendorDirs);
	// A hit still has to cover whatever the parent could not agree on:
	// the framework's own browser-runtime directory (resolved relative to
	// each process's bundle) and any mobile preview entry. Specifier
	// discovery is per-source and transitive expansion is monotone, so
	// scanning the remainder and merging gives the set one combined scan
	// would have produced — and when the remainder is empty (the common
	// case: a published package whose runtime directory sits inside the
	// bundle dir) there is nothing left to scan at all.
	const remainingVendorDirs = prescannedVendorPaths
		? sourceDirs.filter(
				(dir) => !configVendorDirs.includes(dir) && existsSync(dir)
			)
		: sourceDirs;
	if (
		prescannedVendorPaths &&
		remainingVendorDirs.length === 0 &&
		sourceFiles.length === 0
	) {
		globalThis.__depVendorPaths = prescannedVendorPaths;
	} else {
		const { computeDepVendorPaths } = await import(
			'../build/buildDepVendor'
		);
		const scanned = await computeDepVendorPaths(
			remainingVendorDirs,
			sourceFiles
		);
		globalThis.__depVendorPaths = prescannedVendorPaths
			? { ...prescannedVendorPaths, ...scanned }
			: scanned;
	}
	recordStep('prepare dep vendor paths', stepStartedAt);

	/* Created BEFORE the initial build so the file watcher (started below,
	 * also before the build) can close over a stable object identity. The
	 * initial build's manifest is merged in after `build()` returns. */
	const manifest: Record<string, string> = {};

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
	const onWatcherRebuildComplete = (newBuildResult: {
		manifest: Record<string, string>;
	}) => {
		Object.assign(manifest, newBuildResult.manifest);
		state.manifest = manifest;
	};
	const settleRecoveryQueue = () => {
		if (state.initialBuildFailed) {
			// Still broken — the next watcher event retries the full
			// recovery build; fast-path entries queued mid-recovery
			// would run against a broken manifest anyway.
			state.fileChangeQueue.clear();

			return;
		}
		// Edits saved while the recovery build ran may have been
		// read too late to be included — drain, don't discard.
		drainPendingQueue(state, config, onWatcherRebuildComplete);
	};
	const recoverFromColdStartFailure = async () => {
		await waitForRebuild(state);
		state.isRebuilding = true;
		// Same pre-build guarantee as `rebuildManifest`: entries queued
		// before the recovery build starts are consumed by it.
		state.fileChangeQueue.clear();
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
				if (state.lazyPages && recoveryResult.pageEntries) {
					updateLazyPageRegistry(
						state.lazyPages.registry,
						recoveryResult.pageEntries
					);
				}
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
			settleRecoveryQueue();
		}
	};

	/* Start watching BEFORE the initial build (the boot-window race):
	 * watchers used to start only after the build + asset-store population
	 * + compiler warming, so an edit saved during that window produced NO
	 * watcher event at all. The build itself reads each source file at an
	 * unknowable point mid-build, so such an edit could be consumed by
	 * some passes and missed by others — a mixed first build that nothing
	 * ever healed (the next event for the file only comes when the user
	 * edits it again).
	 *
	 * `isRebuilding` is held for the entire boot sequence so the watcher
	 * debounce's `drainQueueAndRebuild` bails with the queue intact (the
	 * same contract as mid-session rebuilds); the queue is drained
	 * explicitly once boot completes. Build outputs don't feed back into
	 * the watcher — the same filters already keep mid-session full
	 * rebuilds (which also run with live watchers) from self-triggering. */
	state.isRebuilding = true;
	startFileWatching(state, config, (filePath: string) => {
		if (state.initialBuildFailed) {
			void recoverFromColdStartFailure();

			return;
		}
		queueFileChange(state, filePath, config, onWatcherRebuildComplete);
	});
	console.log(
		'[hmr] watching for file changes — edits saved during the boot build are queued.'
	);
	recordStep('start file watching', stepStartedAt);

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
	setBootPhase('initial build');
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
	Object.assign(manifest, buildResult?.manifest ?? {});
	const conventions = buildResult?.conventions ?? {};

	/* A dev build no longer aborts on a single unresolvable reference —
	 * it returns a partial manifest plus the failed passes. Stash them so
	 * the WebSocket connect handler can show the error overlay to the
	 * browser (which connects only after the server boots, so there is no
	 * live `rebuild-error` broadcast for the cold-start build). */
	if (buildResult?.errors && buildResult.errors.length > 0) {
		state.lastBuildErrors = buildResult.errors;
		console.error(
			`[hmr] initial build completed with ${buildResult.errors.length} unresolved ` +
				`reference(s) — affected routes are degraded, the rest are serving. ` +
				`Fix and save to recover:`
		);
		for (const passError of buildResult.errors) {
			console.error(`  • ${passError.label}: ${passError.message}`);
		}
	}
	recordStep('initial build', buildStart);

	if (Object.keys(manifest).length === 0 && !lazyPages) {
		console.log(
			'⚠️ Manifest is empty - this is OK for HTML/HTMX-only projects'
		);
	}

	// Populate in-memory asset store so client assets are served from memory
	stepStartedAt = performance.now();
	setBootPhase('populate asset store');
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

	if (lazyPages) {
		const pageEntries = buildResult?.pageEntries ?? [];
		const { createDevPageWarmer, runOnDemandPageBuild } = await import(
			'../dev/moduleServer'
		);
		state.lazyPages = {
			buildCount: 0,
			builder: createOnDemandPageBuilder(runOnDemandPageBuild),
			onRebuildComplete: onWatcherRebuildComplete,
			registry: createLazyPageRegistry(pageEntries),
			warmed: warmedPages
		};
		setDevPageWarmer(createDevPageWarmer());
		console.log(
			`[hmr] ${pageEntries.length} page${pageEntries.length === 1 ? '' : 's'} build on first request — pass --eager (or ABSOLUTE_DEV_EAGER=1) to build them all at boot.`
		);
	}

	// Build vendor files in parallel now that the build directory exists.
	// Each task only BUILDS — file rewriting + asset-store loading happen below
	// in a centralized post-step so cross-framework specifier rewrites can use
	// the FULL combined path map (react ∪ angular ∪ svelte ∪ vue ∪ dep).
	stepStartedAt = performance.now();
	setBootPhase('build vendor bundles');
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

	const activeVendorDirs = [
		config.reactDirectory ? reactVendorDir : null,
		config.angularDirectory ? angularVendorDir : null,
		config.svelteDirectory ? svelteVendorDir : null,
		config.vueDirectory ? vueVendorDir : null,
		depVendorDir
	].filter((dir): dir is string => dir !== null);

	// Restart-surviving vendor cache. The bundles below are a pure
	// function of the installed dependency tree, the framework/Bun
	// versions and the scanned specifier set, so an unchanged project
	// restores them (already cross-rewritten) instead of rebuilding.
	const {
		computeVendorCacheKey,
		readLockfileHash,
		restoreVendorCache,
		saveVendorCache,
		vendorCacheEnabled
	} = await import('../build/vendorCache');
	const lockfileHash = vendorCacheEnabled() ? readLockfileHash() : null;
	const vendorCacheKey =
		lockfileHash === null
			? null
			: computeVendorCacheKey({
					frameworkVersion: globalThis.__absoluteVersion ?? 'unknown',
					lockfileHash,
					runtimeVersion: Bun.version,
					sourceDirs,
					specifiers: [
						...Object.keys(globalThis.__depVendorPaths ?? {}),
						...Object.keys(getDevVendorPaths() ?? {}),
						...Object.keys(getAngularVendorPaths() ?? {}),
						...Object.keys(getSvelteVendorPaths() ?? {}),
						...Object.keys(getVueVendorPaths() ?? {})
					],
					vendorDirs: activeVendorDirs
				});
	const restoredVendor = vendorCacheKey
		? await restoreVendorCache(vendorCacheKey, activeVendorDirs)
		: null;
	if (restoredVendor) {
		globalThis.__depVendorPaths = restoredVendor.depPaths;
		if (restoredVendor.angularSpecifiers) {
			globalThis.__angularVendorSpecifiers =
				restoredVendor.angularSpecifiers;
		}
		if (config.emberDirectory) {
			setEmberVendorPaths(computeEmberVendorPaths());
		}
	}

	// §1.1 — dev mode SKIPS `buildAngularServerVendor`. The build was the
	// load-bearing source of two `@angular/core` instances co-existing in
	// the SSR runtime after an HMR cycle (NG0203 / `currentInjector ===
	// undefined`). Without the server vendor on disk, every Angular import
	// — from page bundles, from `getAngularDeps()`, from
	// `@angular/platform-server` — resolves through Bun's normal
	// node_modules path, giving exactly one instance per process. The
	// production path in `core/build.ts` still builds + uses the server
	// vendor (linker pre-link perf win at prod start time).
	const buildAllVendors = () =>
		Promise.all([
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
			buildDepVendor(
				state.resolvedPaths.buildDir,
				sourceDirs,
				sourceFiles
			)
		]);

	const builtVendors = restoredVendor ? [] : await buildAllVendors();
	const [, angularSpecs, , , , , builtDepPaths] = builtVendors;
	const depPaths = restoredVendor
		? restoredVendor.depPaths
		: (builtDepPaths ?? {});
	if (angularSpecs) globalThis.__angularVendorSpecifiers = angularSpecs;
	// Intentionally NOT calling setAngularServerVendorPaths in dev — the
	// absence of these paths is what makes `compileAngular`'s server-bundle
	// rewrite step skip and leave bare `@angular/*` specifiers, and what
	// makes `resolveAngularRuntimePath` fall through to node_modules.
	if (config.emberDirectory) {
		setEmberVendorPaths(computeEmberVendorPaths());
	}
	globalThis.__depVendorPaths = depPaths;
	recordStep(
		restoredVendor
			? 'restore vendor bundles (cached)'
			: 'build vendor bundles',
		stepStartedAt
	);

	// Cross-vendor specifier rewriting: a vendor file may externalize packages
	// owned by a different vendor pipeline (e.g. /vendor/sentry_angular.js
	// externalizes @angular/core; /vendor/firebase_auth_compat.js externalizes
	// @firebase/auth). Without rewriting these to their vendor paths, the
	// browser fetches the vendor file at runtime and chokes on bare specifiers.
	// Run AFTER all vendor builds so every framework's path map is included.
	stepStartedAt = performance.now();
	setBootPhase('rewrite vendor cross-references');
	const combinedVendorPaths: Record<string, string> = {
		...(getDevVendorPaths() ?? {}),
		...(getAngularVendorPaths() ?? {}),
		...(getSvelteVendorPaths() ?? {}),
		...(getVueVendorPaths() ?? {}),
		...depPaths
	};
	if (!restoredVendor) {
		const { rewriteVendorDirectories } = await import(
			'../build/rewriteImportsPlugin'
		);
		await rewriteVendorDirectories(activeVendorDirs, combinedVendorPaths);
		recordStep('rewrite vendor cross-references', stepStartedAt);
		// Cache the rewritten result, so a restart restores exactly what
		// the browser would have been served this run.
		if (vendorCacheKey) {
			// After the port is serving: the copy is pure I/O that must
			// not sit on the boot path.
			deferUntilServing(() =>
				saveVendorCache(vendorCacheKey, activeVendorDirs, {
					...(angularSpecs
						? { angularSpecifiers: angularSpecs }
						: {}),
					depPaths
				})
			);
		}
	}

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
	recordStep('load vendor files', stepStartedAt);

	// Pre-warm framework compilers so the first HMR edit is fast.
	// Sets the module-level compiler references in moduleServer.ts
	// so transformSvelteFile/transformVueFile skip the dynamic import.
	stepStartedAt = performance.now();
	setBootPhase('warm compilers');
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

	/* Boot complete — release the rebuild lock held since before the
	 * initial build and heal any edits saved while it ran. */
	state.isRebuilding = false;
	if (state.fileChangeQueue.size > 0 && state.initialBuildFailed) {
		// Cold-start contract: a failed initial build recovers via a
		// FULL rebuild, not the fast path the queue would take.
		state.fileChangeQueue.clear();
		void recoverFromColdStartFailure();
	} else if (state.fileChangeQueue.size > 0) {
		console.log(
			'[hmr] edits landed during the boot build — rebuilding to pick them up.'
		);
		drainPendingQueue(state, config, onWatcherRebuildComplete);
	}

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
