import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import type {
	BuildConfig,
	DevPageEntry,
	DevPageFramework
} from '../../types/build';
import { toPascal } from '../utils/stringModifiers';

/* On-demand page builds for `absolute dev`.
 *
 * The lazy initial build skips every page entry, so the first request for a
 * page has to (1) map the manifest key the route asked for back to the page
 * source file, (2) build exactly that page through the normal incremental
 * rebuild path, and (3) hand the freshly populated manifest entries back to
 * the handler. This module owns the pure parts of that: the key → source
 * registry and the per-page in-flight deduplication. The dev module server
 * (`warmPage`) wires them to the rebuild machinery. */

export type LazyPageRegistry = {
	byName: Map<string, DevPageEntry[]>;
	bySource: Map<string, DevPageEntry>;
};

export type OnDemandPageBuilder = {
	/** Build the page if no build for it is in flight; otherwise join the
	 *  in-flight build. Resolves `true` once the page's manifest entries
	 *  exist, `false` when the build failed. */
	warm: (entry: DevPageEntry) => Promise<boolean>;
	inFlight: () => string[];
	isInFlight: (source: string) => boolean;
};

export type LazyPageState = {
	registry: LazyPageRegistry;
	/** Resolved sources of every page requested so far. Shared by identity
	 *  with `config.options.deferPageEntries.except`, so full rebuilds only
	 *  re-emit these pages. */
	warmed: Set<string>;
	builder: OnDemandPageBuilder;
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: import('./clientManager').HMRState;
	}) => void;
	/** Number of completed on-demand page builds (success or failure). */
	buildCount: number;
	lastError?: string;
};

type PageProbeDir = { dir: string; framework: DevPageFramework };

const PAGE_EXTENSIONS: Record<DevPageFramework, readonly string[]> = {
	angular: ['.ts'],
	ember: ['.gts', '.gjs', '.ts'],
	react: ['.tsx', '.jsx'],
	svelte: ['.svelte'],
	vue: ['.vue']
};

/* Manifest key suffixes, longest first so `PortalCompiledCSS` strips to
 * `Portal` rather than `PortalCompiled`. `Css` is the per-page sibling
 * stylesheet key written by core/build; `SpaManifest` the SPA child-route
 * side manifest. */
const KEY_SUFFIXES = [
	'CompiledCSS',
	'BundledCSS',
	'SpaManifest',
	'Client',
	'Index',
	'Page',
	'CSS',
	'Css'
] as const;

const SRC_URL_PREFIX = '/@src/';

const isTruthyFlag = (value: string | undefined) =>
	value === '1' || value === 'true';

const looksLikePath = (value: string) =>
	value.includes('/') || value.includes('\\') || value.startsWith('.');

const probeDirForName = ({ dir, framework }: PageProbeDir, name: string) => {
	const extension = PAGE_EXTENSIONS[framework].find((ext) =>
		existsSync(join(dir, `${name}${ext}`))
	);

	return extension === undefined
		? undefined
		: toDevPageEntry(framework, join(dir, `${name}${extension}`));
};

const resolveSourcePath = (keyOrPath: string) => {
	const stripped = keyOrPath.startsWith(SRC_URL_PREFIX)
		? (keyOrPath.slice(SRC_URL_PREFIX.length).split('?')[0] ?? '')
		: keyOrPath;

	return isAbsolute(stripped) ? stripped : resolve(stripped);
};

const firstDefined = <Value>(
	candidates: readonly string[],
	lookup: (name: string) => Value | undefined
) => {
	for (const candidate of candidates) {
		const value = lookup(candidate);
		if (value !== undefined) return value;
	}

	return undefined;
};

export const createLazyPageRegistry = (
	entries: readonly DevPageEntry[] = []
) => {
	const registry: LazyPageRegistry = {
		byName: new Map(),
		bySource: new Map()
	};
	updateLazyPageRegistry(registry, entries);

	return registry;
};

/** One in-flight build per page: concurrent first requests for the same
 *  page share a promise; different pages queue behind each other through
 *  the rebuild lock inside `run`. */
export const createOnDemandPageBuilder = (
	run: (entry: DevPageEntry) => Promise<boolean>
) => {
	const inFlight = new Map<string, Promise<boolean>>();

	const builder: OnDemandPageBuilder = {
		inFlight: () => [...inFlight.keys()],
		isInFlight: (source) => inFlight.has(source),
		warm: (entry) => {
			const existing = inFlight.get(entry.source);
			if (existing) return existing;
			const pending = run(entry)
				.catch(() => false)
				.finally(() => {
					inFlight.delete(entry.source);
				});
			inFlight.set(entry.source, pending);

			return pending;
		}
	};

	return builder;
};

/** Probe the configured page directories for `pages/<Name>.<ext>` when the
 *  registry has never seen the name (a page created after the last build). */
export const createPageProbe = (config: BuildConfig) => {
	const dirs: PageProbeDir[] = [];
	const push = (dir: string | undefined, framework: DevPageFramework) => {
		if (dir) dirs.push({ dir: join(resolve(dir), 'pages'), framework });
	};
	push(config.reactDirectory, 'react');
	push(config.svelteDirectory, 'svelte');
	push(config.vueDirectory, 'vue');
	push(config.angularDirectory, 'angular');
	push(config.emberDirectory, 'ember');

	return (name: string) =>
		dirs.reduce<DevPageEntry | undefined>(
			(found, probeDir) => found ?? probeDirForName(probeDir, name),
			undefined
		);
};

export const isPageBuilt = (
	entry: DevPageEntry,
	manifest: Record<string, string>
) => {
	const value = manifest[primaryManifestKey(entry)];

	return typeof value === 'string' && value.length > 0;
};

/** `ABSOLUTE_DEV_EAGER=1` (or `absolute dev --eager`) restores the full
 *  initial build. Everything else builds pages on demand. */
export const lazyPagesEnabled = () =>
	!isTruthyFlag(process.env.ABSOLUTE_DEV_EAGER);

/** Candidate page names for a manifest key, most specific first: the key
 *  itself (a page may legitimately be called `HomeIndex`), then the key
 *  with one known suffix removed. */
export const pageNameCandidates = (key: string) => {
	const suffix = KEY_SUFFIXES.find(
		(candidate) => key.length > candidate.length && key.endsWith(candidate)
	);

	return suffix === undefined ? [key] : [key, key.slice(0, -suffix.length)];
};

/** The manifest key whose presence means "this page's bundle exists". React
 *  pages are SSR'd from source and only emit a hydration index; every other
 *  framework emits the SSR module under the bare page name. */
export const primaryManifestKey = (entry: DevPageEntry) =>
	entry.framework === 'react' ? `${entry.name}Index` : entry.name;

/** Resolve a manifest key (`PortalIndex`, `Portal`, `PortalCSS`, …), a page
 *  source path, or a `/@src/` URL to its page entry. */
export const resolveLazyPageEntry = (
	registry: LazyPageRegistry,
	keyOrPath: string,
	probe?: (name: string) => DevPageEntry | undefined
) => {
	if (keyOrPath.length === 0) return undefined;
	if (looksLikePath(keyOrPath)) {
		return registry.bySource.get(resolveSourcePath(keyOrPath));
	}
	const candidates = pageNameCandidates(keyOrPath);
	const registered = firstDefined(
		candidates,
		(name) => registry.byName.get(name)?.[0]
	);
	if (registered || !probe) return registered;

	return firstDefined(candidates, probe);
};

export const toDevPageEntry = (framework: DevPageFramework, source: string) => {
	const resolved = resolve(source);
	const entry: DevPageEntry = {
		framework,
		name: toPascal(basename(resolved, extname(resolved))),
		source: resolved
	};

	return entry;
};

/** Replace the registry contents with a fresh scan result (every build
 *  re-scans the page directories, so new/renamed pages show up here). */
export const updateLazyPageRegistry = (
	registry: LazyPageRegistry,
	entries: readonly DevPageEntry[]
) => {
	registry.byName.clear();
	registry.bySource.clear();
	for (const entry of entries) {
		// Generated helper entries (React's `_refresh`) are not pages.
		if (entry.name.startsWith('_') || entry.name.length === 0) continue;
		registry.bySource.set(entry.source, entry);
		const named = registry.byName.get(entry.name);
		if (named) named.push(entry);
		else registry.byName.set(entry.name, [entry]);
	}
};
