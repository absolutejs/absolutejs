/* Parent-side dev pre-scan handshake.
 *
 * `absolute dev` runs in two processes: the CLI parent and the `bun --hot`
 * child that serves. The child's boot is single-threaded and CPU bound —
 * the user's server entry evaluates its whole import graph on the same
 * thread the framework build runs on, so starting the build earlier only
 * interleaves the two, it does not make them cheaper (see
 * `docs/DEV_PERFORMANCE.md`). The one genuinely free resource in that
 * window is the CLI parent: from the moment it has spawned the child until
 * the child prints `ready`, it does nothing but forward stdout.
 *
 * Two of the child's boot steps are pure functions of what is on disk, so
 * they can run over there instead:
 *
 *   - the dependency-vendor specifier scan, which reads every source file
 *     under the configured framework directories and then walks the
 *     matching packages in `node_modules`;
 *   - the initial HMR dependency graph, which reads every watched source
 *     file and extracts its imports.
 *
 * Neither depends on process state and both serialise to plain JSON, so
 * the parent computes them, writes one file, and the child adopts the
 * result instead of repeating the work. The child never *needs* the file:
 * a missing, malformed, mismatched or late payload just means it scans for
 * itself, so a failure here can only cost the optimisation, never the
 * boot.
 *
 * Off by default: scanning in the parent delays the child spawn, and the
 * child cannot adopt the result until the user's own import graph has
 * finished evaluating anyway. Measured on a 74-page app it cost more than
 * it saved (first paint 3.8s without it, 8.5s with it). Opt in with
 * `ABSOLUTE_DEV_PRESCAN=1` for a project whose source tree is slow to scan
 * but whose server entry imports little. */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildConfig } from '../../types/build';
import { resolveBuildPaths } from './configResolver';
import {
	buildInitialDependencyGraph,
	type DependencyGraph
} from './dependencyGraph';
import { getWatchPaths } from './pathUtils';

const PRESCAN_DIR = join('.absolutejs', 'dev-prescan');
const PAYLOAD_VERSION = 1;
const POLL_INTERVAL_MS = 10;
const DEFAULT_WAIT_MS = 2000;

export type DevPrescanPayload = {
	version: number;
	/** `false` when the parent's scan threw — the child stops waiting and
	 *  scans for itself instead of polling out its whole budget. */
	ok: boolean;
	/** The directories the vendor scan covered. The child re-derives the
	 *  same list from its own config and only adopts the paths when the
	 *  two agree, so a config change between spawn and boot can never be
	 *  papered over by a stale payload. */
	vendorSourceDirs: string[];
	depVendorPaths: Record<string, string> | null;
	/** The `dependencies` side of the graph only; `dependents` is its
	 *  exact inverse and is rebuilt in memory, which is cheaper than
	 *  shipping it. */
	dependencies: Record<string, string[]> | null;
};

/** The dependency-vendor scan directories that come straight from the
 *  config. `core/devBuild` adds the framework's own browser-runtime
 *  directory on top; that one is resolved relative to whichever bundle is
 *  running, so it is deliberately NOT part of the handshake — the parent
 *  and the child load different bundles and would disagree about it.
 *  The child scans it separately and merges; specifier discovery is
 *  per-directory and transitive expansion is monotone, so the union is
 *  the same set a single scan would produce. */
export const collectConfigVendorSourceDirs = (config: BuildConfig) =>
	Array.from(
		new Set(
			[
				config.reactDirectory,
				config.svelteDirectory,
				config.vueDirectory,
				config.angularDirectory,
				config.htmlDirectory,
				config.htmxDirectory
			].filter((dir): dir is string => Boolean(dir))
		)
	);

export const devPrescanEnabled = () => process.env.ABSOLUTE_DEV_PRESCAN === '1';

const prescanPath = (projectRoot: string, token: string) =>
	join(projectRoot, PRESCAN_DIR, `${token}.json`);

const processIsAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const listPayloads = (directory: string) => {
	try {
		return readdirSync(directory);
	} catch {
		/* nothing to prune */
		return [];
	}
};

/** A CLI killed with SIGKILL cannot run its exit hook, so its payload
 *  stays behind. Drop the leftovers of processes that are gone; several
 *  dev servers can share a project root, so a live one's file is left
 *  alone. */
const pruneStalePayloads = (directory: string) => {
	for (const name of listPayloads(directory)) {
		const pid = Number(name.replace(/\.json(\.tmp)?$/, ''));
		if (!Number.isInteger(pid) || processIsAlive(pid)) continue;
		rmSync(join(directory, name), { force: true });
	}
};

const serializeDependencies = (graph: DependencyGraph) => {
	const dependencies: Record<string, string[]> = {};
	for (const [file, deps] of graph.dependencies) {
		dependencies[file] = [...deps];
	}

	return dependencies;
};

const computePayload = async (
	config: BuildConfig,
	vendorSourceDirs: string[]
): Promise<DevPrescanPayload> => {
	const { computeDepVendorPaths } = await import('../build/buildDepVendor');
	// The vendor scan is I/O bound and the graph walk is a synchronous
	// parse loop, so start the vendor reads first and let the graph hold
	// the thread while they land.
	const vendors = computeDepVendorPaths(vendorSourceDirs);
	const graph: DependencyGraph = {
		dependencies: new Map(),
		dependents: new Map()
	};
	buildInitialDependencyGraph(
		graph,
		getWatchPaths(config, resolveBuildPaths(config))
	);

	return {
		dependencies: serializeDependencies(graph),
		depVendorPaths: await vendors,
		ok: true,
		vendorSourceDirs,
		version: PAYLOAD_VERSION
	};
};

export type DevPrescan = {
	/** Path the child reads; goes into its environment before the spawn. */
	path: string;
	/** Begin scanning. Called after the spawn so the scan can never delay
	 *  the child's start. Never throws. */
	start: () => void;
};

export const createDevPrescan = (
	config: BuildConfig,
	projectRoot = process.cwd()
): DevPrescan | null => {
	if (!devPrescanEnabled()) return null;
	const path = prescanPath(projectRoot, String(process.pid));

	const write = async () => {
		let payload: DevPrescanPayload;
		const vendorSourceDirs = collectConfigVendorSourceDirs(config);
		try {
			payload = await computePayload(config, vendorSourceDirs);
		} catch {
			payload = {
				dependencies: null,
				depVendorPaths: null,
				ok: false,
				vendorSourceDirs,
				version: PAYLOAD_VERSION
			};
		}
		try {
			const directory = join(projectRoot, PRESCAN_DIR);
			await mkdir(directory, { recursive: true });
			pruneStalePayloads(directory);
			const temporary = `${path}.tmp`;
			await writeFile(temporary, JSON.stringify(payload));
			await rename(temporary, path);
		} catch {
			/* the child scans for itself when the file never lands */
		}
	};

	return {
		path,
		start: () => {
			// The payload is only meaningful to the child this CLI just
			// spawned, so it leaves with the CLI.
			process.once('exit', () => {
				try {
					rmSync(path, { force: true });
				} catch {
					/* nothing left to clean up */
				}
			});
			void write();
		}
	};
};

const sleep = (delayMs: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, delayMs);
	});

const isPayload = (value: unknown): value is DevPrescanPayload =>
	typeof value === 'object' &&
	value !== null &&
	'version' in value &&
	value.version === PAYLOAD_VERSION;

/** One attempt at the handshake file. `undefined` means "not there (or
 *  not whole) yet, try again"; `null` means the parent reported failure
 *  and there is nothing to wait for. */
const tryReadPrescan = async (path: string) => {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
		if (!isPayload(parsed)) return undefined;

		return parsed.ok ? parsed : null;
	} catch {
		/* a torn read of a file mid-rename — the caller retries */
		return undefined;
	}
};

const pollForPrescan = async (
	path: string,
	deadline: number
): Promise<DevPrescanPayload | null> => {
	const payload = await tryReadPrescan(path);
	if (payload !== undefined) return payload;
	if (Date.now() >= deadline) return null;
	await sleep(POLL_INTERVAL_MS);

	return pollForPrescan(path, deadline);
};

/** Child side: adopt the parent's scan if it is (or becomes) available.
 *  Polls, because the child usually reaches this point while the parent is
 *  still scanning; the wait is bounded by
 *  `ABSOLUTE_DEV_PRESCAN_WAIT_MS` (default 2s) and a timeout simply means
 *  the child does the work itself. */
export const readDevPrescan = async (
	waitMs = Number(process.env.ABSOLUTE_DEV_PRESCAN_WAIT_MS) || DEFAULT_WAIT_MS
) => {
	const path = process.env.ABSOLUTE_DEV_PRESCAN;
	if (!path || !devPrescanEnabled()) return null;
	// Consume-once: the payload describes the tree as it was when this
	// process was spawned. A later `devBuild` in the same child (a config
	// change, a cold-start recovery) has to scan the tree as it is now.
	delete process.env.ABSOLUTE_DEV_PRESCAN;

	return pollForPrescan(path, Date.now() + waitMs);
};

const sameDirs = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((value, index) => value === right[index]);

const addDependent = (
	graph: DependencyGraph,
	dependency: string,
	dependent: string
) => {
	const dependents = graph.dependents.get(dependency) ?? new Set<string>();
	dependents.add(dependent);
	graph.dependents.set(dependency, dependents);
};

/** Rebuild a `DependencyGraph` from the parent's serialized dependencies.
 *  `dependents` is the exact inverse of `dependencies`, so it is
 *  reconstructed here instead of being shipped. */
export const adoptDependencyGraph = (
	graph: DependencyGraph,
	dependencies: Record<string, string[]>
) => {
	graph.dependencies = new Map();
	graph.dependents = new Map();
	for (const [source, deps] of Object.entries(dependencies)) {
		graph.dependencies.set(source, new Set(deps));
		deps.forEach((dependency) => addDependent(graph, dependency, source));
	}

	return graph;
};

/** The prescan's vendor paths are usable only when the parent scanned
 *  exactly the directories this process would have scanned. */
export const prescanVendorPaths = (
	payload: DevPrescanPayload | null,
	vendorSourceDirs: readonly string[]
) => {
	if (!payload?.depVendorPaths) return null;
	if (!sameDirs(payload.vendorSourceDirs, vendorSourceDirs)) return null;

	return payload.depVendorPaths;
};
