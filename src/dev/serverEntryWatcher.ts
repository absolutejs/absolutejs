/* Path B (framework-owned backend HMR — see
 * docs/ABSOLUTE_CONFIG_TOGGLE_LIMITATION.md): watch the user's entry file
 * (`ABSOLUTE_SERVER_ENTRY`) AND `absolute.config.ts` from inside the bun
 * child. The framework-owned bootstrap is Bun.main so the original entry is
 * not also re-evaluated concurrently by Bun's automatic hot loader.
 *
 * Entry edits → cache-busted dynamic import through a unique sibling copy.
 * The fresh module's `networking` plugin call detects the live
 * `Bun.serve` instance on globalThis and calls
 * `.reload({ fetch, routes: {} })` to swap the handler atomically
 * without rebinding the port.
 *
 * `absolute.config.ts` edits →
 *   - Pure framework-dir addition: `applyConfigChanges()` updates
 *     `state.config` in place, sets vendor paths for the new
 *     framework, and starts watchers for the new directory. No
 *     restart needed — the user's running server keeps serving its
 *     existing routes; the new framework's pages become buildable
 *     immediately, and the server.ts edit that adds
 *     `handleXPageRequest` for those pages will hot-reload via the
 *     entry watcher.
 *   - Framework-dir removal (or rename): emit `[abs:restart]`
 *     marker. Elysia has no clean route-removal API; the
 *     framework's vendor paths and per-framework watchers also
 *     don't cleanly tear down, so a full child restart is the
 *     correct path.
 *   - Non-framework-key change (port, buildDirectory, tailwind,
 *     etc.): we can't differentiate at this level (reloadConfig
 *     only parses framework dirs). Emit `[abs:restart]` and let
 *     the parent CLI's `refreshDevConfigForSpawn` apply the new
 *     values on respawn.
 *
 * Errors during entry re-import (syntax error, runtime throw at top
 * level) are caught and printed; we fall back to emitting `[abs:restart]`
 * so the parent CLI does a full child restart. The OLD app keeps
 * serving until the restart kicks in.
 */

import {
	copyFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	watch
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { applyConfigChanges } from '../core/devBuild';

const ATOMIC_RECOVERY_WINDOW_MS = 1000;
const RELOAD_DEBOUNCE_MS = 80;
const ENTRY_IMPORT_RETRY_DELAY_MS = 250;
const MAX_ENTRY_IMPORT_ATTEMPTS = 3;
const WATCH_FALLBACK_INTERVAL_MS = 250;

const ATOMIC_WRITE_TEMP_PATTERNS: RegExp[] = [/^sed[A-Za-z0-9]{6,}$/, /^4913$/];

/* Detect filenames produced by atomic-rename editors. These files
 * appear briefly on disk during a save (the editor writes the new
 * content to a tmp sibling, then renames it over the original)
 * and would otherwise trigger a spurious HMR cycle. Patterns:
 *   - `.tmp` suffix or `.tmp.` substring (generic + Prettier)
 *   - `~` suffix (Emacs, Vim, some IDEs)
 *   - `.#…` prefix (Emacs lockfiles)
 *   - `sed<random>` (in-place `sed -i` tmp)
 *   - `4913` (vim's preflight write probe)
 *
 * Exported for direct unit testing — the integration suite can
 * assert the regex set without spinning up a dev server. */
export const isAtomicWriteTemp = (filename: string) =>
	filename.endsWith('.tmp') ||
	filename.includes('.tmp.') ||
	filename.endsWith('~') ||
	filename.startsWith('.#') ||
	filename.startsWith('.absolutejs-hmr-') ||
	ATOMIC_WRITE_TEMP_PATTERNS.some((pattern) => pattern.test(filename));

const fileHash = (path: string) => {
	try {
		return createHash('sha256').update(readFileSync(path)).digest('hex');
	} catch {
		return null;
	}
};

export const startFilePollingFallback = (
	path: string,
	onChange: () => void,
	interval = WATCH_FALLBACK_INTERVAL_MS
) => {
	let previousHash = fileHash(path);
	const timer = setInterval(() => {
		const nextHash = fileHash(path);
		if (!nextHash || nextHash === previousHash) return;
		previousHash = nextHash;
		onChange();
	}, interval);
	timer.unref();

	return {
		close: () => clearInterval(timer)
	};
};

export const startServerEntryWatcher = () => {
	if (globalThis.__absoluteEntryWatcherStarted) return;
	const originalEntry = process.env.ABSOLUTE_SERVER_ENTRY ?? Bun.main;
	if (!originalEntry || !existsSync(originalEntry)) return;
	globalThis.__absoluteEntryWatcherStarted = true;
	globalThis.__absoluteEntryWatcherReady = false;

	const entryPath = resolve(originalEntry);
	const entryDir = dirname(entryPath);
	const entryBase = entryPath.slice(entryDir.length + 1);

	const configPath = resolve(
		process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
	);
	const configDir = dirname(configPath);
	const configBase = configPath.slice(configDir.length + 1);

	const recentlyHandled = new Map<string, number>();
	let entryReloadTimer: ReturnType<typeof setTimeout> | null = null;
	let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
	let acceptedEntryHash = fileHash(entryPath);
	let entryReloadInFlight = false;
	let pendingEntryCause: string | null = null;
	let siblingSequence = 0;

	// Bun can intermittently retain or partially instantiate the pinned entry
	// module under `bun --hot`, even after the source was atomically replaced.
	// Import a unique same-directory sibling so Bun parses complete fresh bytes
	// under a new module URL while relative imports keep their original base.
	const importFreshEntry = async (attempt = 1): Promise<void> => {
		const siblingPath = join(
			entryDir,
			`.absolutejs-hmr-${process.pid}-${siblingSequence++}.ts`
		);
		let failure: unknown;
		try {
			copyFileSync(entryPath, siblingPath);
			globalThis.__absoluteEntryCopies?.add(siblingPath);
			await import(siblingPath);
		} catch (error) {
			failure = error;
		}
		if (failure === undefined) return;
		const message =
			failure instanceof Error ? failure.message : String(failure);
		if (
			message.includes('Unexpected end of file') &&
			attempt < MAX_ENTRY_IMPORT_ATTEMPTS
		) {
			await Bun.sleep(ENTRY_IMPORT_RETRY_DELAY_MS);

			await importFreshEntry(attempt + 1);

			return;
		}
		throw failure;
	};

	const triggerEntryReload = async (cause: string) => {
		const nextHash = fileHash(entryPath);
		if (!nextHash || nextHash === acceptedEntryHash) return;
		if (entryReloadInFlight) {
			pendingEntryCause = cause;

			return;
		}
		entryReloadInFlight = true;
		acceptedEntryHash = nextHash;

		try {
			console.log(`[hmr] reloading server entry (${cause})`);
			await importFreshEntry();
			// On success, the new module's `networking` plugin call
			// has already swapped the running Bun.serve's fetch
			// handler via `app.server.reload({ fetch, routes: {} })`.
			// Broadcast a completion signal so dev clients (and tests)
			// can react to the swap deterministically instead of
			// polling for stdout markers or sleeping.
			const hmrState = globalThis.__hmrDevResult?.hmrState;
			if (hmrState) {
				const { broadcastToClients } = await import('./webSocket');
				broadcastToClients(hmrState, {
					data: { cause, entryPath },
					type: 'server-entry-reloaded'
				});
			}
		} catch (err) {
			console.error(
				`[hmr] entry re-evaluation failed: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			console.log(`[abs:restart] ${entryPath}`);
		} finally {
			entryReloadInFlight = false;
			if (pendingEntryCause) {
				const pendingCause = pendingEntryCause;
				pendingEntryCause = null;
				void triggerEntryReload(pendingCause);
			}
		}
	};

	const triggerConfigChange = async (cause: string) => {
		const now = Date.now();
		const last = recentlyHandled.get(`config:${cause}`) ?? 0;
		if (now - last < 100) return;
		recentlyHandled.set(`config:${cause}`, now);

		try {
			const diff = await applyConfigChanges();
			if (!diff) {
				// No live dev runtime (compiled production build).
				// Shouldn't happen in this codepath since the
				// watcher only runs in dev, but be safe.
				return;
			}
			if (diff.removed.length === 0 && diff.added.length === 0) {
				// reloadConfig succeeded but no framework dir keys
				// changed. The file changed (we got a watch event)
				// so a non-framework key (port, buildDirectory,
				// tailwind input/output, dev.host, dev.https, etc.)
				// must have. We can't apply those in-place from
				// inside the child; emit the marker so the parent
				// CLI's refreshDevConfigForSpawn picks them up on
				// respawn.
				console.log(
					'[hmr] absolute.config.ts changed (non-framework keys) — restarting'
				);
				console.log(`[abs:restart] ${configPath}`);

				return;
			}
			if (diff.removed.length > 0) {
				// Framework dir removed (or renamed). Restart so
				// stale watchers, generated files, and routes get
				// cleared.
				console.log(
					`[hmr] absolute.config.ts removed framework(s) ${diff.removed.join(', ')} — restarting`
				);
				console.log(`[abs:restart] ${configPath}`);

				return;
			}
			// Pure addition. `applyConfigChanges` set up vendor paths
			// and watchers for the new dir, but the dev build's
			// entry sets are pinned at boot — pages in the new
			// framework's dir won't appear in the manifest until a
			// full rebuild. The cleanest path is a restart so the
			// fresh build picks them up; otherwise the user's next
			// `server.ts` edit (registering a route for the new
			// framework) would fail with `asset(manifest, X)`
			// returning undefined, *then* fall back to restart
			// anyway. Better to do it now.
			console.log(
				`[hmr] absolute.config.ts added framework(s) ${diff.added.join(', ')} — restarting (initial build needed)`
			);
			console.log(`[abs:restart] ${configPath}`);
		} catch (err) {
			console.error(
				`[hmr] config change handling failed: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			console.log(`[abs:restart] ${configPath}`);
		}
	};

	const scheduleEntryReload = (cause: string) => {
		if (entryReloadTimer) return;
		entryReloadTimer = setTimeout(() => {
			entryReloadTimer = null;
			void triggerEntryReload(cause);
		}, RELOAD_DEBOUNCE_MS);
	};

	const scheduleConfigChange = (cause: string) => {
		if (configReloadTimer) return;
		configReloadTimer = setTimeout(() => {
			configReloadTimer = null;
			void triggerConfigChange(cause);
		}, RELOAD_DEBOUNCE_MS);
	};

	// Atomic-rename recovery: Linux/Node `fs.watch` drops IN_MOVED_TO
	// for the destination when it already existed. We recover by
	// scanning the dir for files with fresh ctime after a temp-file
	// event fires and dispatching to the entry/config handlers as
	// appropriate. (See fileWatcher.ts for the longer-form comment.)
	const recoveryScan = (dir: string) => {
		let entries: import('node:fs').Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		const now = Date.now();
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const isEntry = dir === entryDir && entry.name === entryBase;
			const isConfig = dir === configDir && entry.name === configBase;
			if (!isEntry && !isConfig) continue;
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(join(dir, entry.name));
			} catch {
				continue;
			}
			if (now - st.ctimeMs > ATOMIC_RECOVERY_WINDOW_MS) continue;
			if (isEntry) scheduleEntryReload(entry.name);
			if (isConfig) scheduleConfigChange(entry.name);
		}
	};

	const handleEvent = (
		dir: string,
		_event: string,
		filename: string | null
	) => {
		if (!filename) return;
		if (isAtomicWriteTemp(filename)) {
			recoveryScan(dir);

			return;
		}
		if (dir === entryDir && filename === entryBase) {
			scheduleEntryReload(filename);

			return;
		}
		if (dir === configDir && filename === configBase) {
			scheduleConfigChange(filename);
		}
	};

	const entryWatcher = watch(entryDir, { recursive: false }, (event, file) =>
		handleEvent(entryDir, event, file)
	);

	// If absolute.config.ts is in the same dir as the entry, the
	// single recursive=false watcher above sees it. Otherwise we
	// need a second watcher on configDir.
	let configWatcher: ReturnType<typeof watch> | null = null;
	if (configDir !== entryDir) {
		configWatcher = watch(configDir, { recursive: false }, (event, file) =>
			handleEvent(configDir, event, file)
		);
	}
	// Directory watches can still miss writes on some filesystems and under
	// bursty editor/test activity. The stat watcher is a bounded fallback; all
	// notifications converge through the content-hash gate above, so native
	// and polling events for the same bytes reload only once.
	const fallbackWatcher = startFilePollingFallback(entryPath, () =>
		scheduleEntryReload(entryBase)
	);
	const postInstallEntryHash = fileHash(entryPath);
	if (postInstallEntryHash && postInstallEntryHash !== acceptedEntryHash) {
		scheduleEntryReload(entryBase);
	}
	globalThis.__absoluteEntryWatcherReady = true;

	const closeAll = () => {
		fallbackWatcher.close();
		try {
			entryWatcher.close();
		} catch {
			/* already closed */
		}
		if (configWatcher) {
			try {
				configWatcher.close();
			} catch {
				/* already closed */
			}
		}
	};
	process.once('exit', closeAll);
	process.once('SIGINT', closeAll);
	process.once('SIGTERM', closeAll);
};
