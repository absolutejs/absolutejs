/* Path B (framework-owned backend HMR — see
 * docs/ABSOLUTE_CONFIG_TOGGLE_LIMITATION.md): watch the user's entry file
 * (`Bun.main`) AND `absolute.config.ts` from inside the bun child.
 *
 * Entry edits → cache-busted dynamic import via the natural
 * `delete require_.cache[entryPath]; await import(entryPath)` pattern.
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

import { existsSync, statSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { applyConfigChanges } from '../core/devBuild';

declare global {
	var __absoluteEntryWatcherStarted: boolean | undefined;
}

const ATOMIC_RECOVERY_WINDOW_MS = 1000;
const RELOAD_DEBOUNCE_MS = 80;

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
	ATOMIC_WRITE_TEMP_PATTERNS.some((re) => re.test(filename));

export const startServerEntryWatcher = () => {
	if (globalThis.__absoluteEntryWatcherStarted) return;
	const {main} = Bun;
	if (!main || !existsSync(main)) return;
	globalThis.__absoluteEntryWatcherStarted = true;

	const entryPath = resolve(main);
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

	// Bun cache invalidation for the entry path under `bun --hot`.
	// Use the natural pattern: clear the CommonJS-style cache entry
	// for the entry path and re-import. On the current Bun version
	// (verified 1.3.14-canary.1 by
	// `tests/integration/hmr/lifecycle/bun-entry-natural-pattern-sentinel.test.ts`)
	// the re-import reads fresh source bytes after an atomic-rename
	// write — the bun#30447 / bun#30449 chain that previously
	// pinned the entry record has been resolved upstream. If a
	// future Bun regresses entry-record reload, the sentinel test
	// flips and we restore the sibling-copy workaround from git
	// history (see commit history for `serverEntryWatcher.ts`
	// 2026-05-12).
	const require_ = createRequire(import.meta.url);
	const triggerEntryReload = async (cause: string) => {
		const now = Date.now();
		const last = recentlyHandled.get(`entry:${cause}`) ?? 0;
		if (now - last < 100) return;
		recentlyHandled.set(`entry:${cause}`, now);

		try {
			console.log(`[hmr] reloading server entry (${cause})`);
			delete require_.cache[entryPath];
			await import(entryPath);
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
			const { readdirSync } =
				require('node:fs') as typeof import('node:fs');
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

	const closeAll = () => {
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
