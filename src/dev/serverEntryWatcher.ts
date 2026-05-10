/* Path B (framework-owned backend HMR — see
 * ABSOLUTE_CONFIG_TOGGLE_LIMITATION.md): watch the user's entry file
 * (`Bun.main`). On change, dynamic-import the entry with a
 * `?t=Date.now()` cache-bust query to force a fresh evaluation. The
 * fresh module's top-level reruns prepare() (returns cached) and
 * constructs a new Elysia app; the `networking` plugin detects the
 * live Bun.serve instance on globalThis and calls `.reload({ fetch })`
 * to swap the handler atomically without rebinding the port.
 *
 * Errors during re-import (syntax error, runtime throw at top level)
 * are caught and printed; we fall back to emitting an `[abs:restart]`
 * marker so the parent CLI does a full child restart. The OLD app
 * keeps serving until the restart kicks in.
 *
 * Scope of this module: ONLY the entry file. `absolute.config.ts`
 * changes still go through the CLI's project-root watcher (full child
 * restart) until Path B Step 3 adds diff-aware in-place handling for
 * framework-dir add/remove. For port / buildDirectory / tailwind
 * changes the CLI restart is the right answer regardless.
 */

import { copyFileSync, existsSync, statSync, unlinkSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

declare global {
	var __absoluteEntryWatcherStarted: boolean | undefined;
}

const ATOMIC_RECOVERY_WINDOW_MS = 1000;
const RELOAD_DEBOUNCE_MS = 80;

const ATOMIC_WRITE_TEMP_PATTERNS: RegExp[] = [
	/^sed[A-Za-z0-9]{6,}$/,
	/^4913$/
];

const isAtomicWriteTemp = (filename: string) =>
	filename.endsWith('.tmp') ||
	filename.includes('.tmp.') ||
	filename.endsWith('~') ||
	filename.startsWith('.#') ||
	ATOMIC_WRITE_TEMP_PATTERNS.some((re) => re.test(filename));

export const startServerEntryWatcher = () => {
	if (globalThis.__absoluteEntryWatcherStarted) return;
	const main = Bun.main;
	if (!main || !existsSync(main)) return;
	globalThis.__absoluteEntryWatcherStarted = true;

	const entryPath = resolve(main);
	const entryDir = dirname(entryPath);
	const entryBase = entryPath.slice(entryDir.length + 1);

	// Atomic-rename recovery (mirrors fileWatcher.ts): Linux/Node
	// `fs.watch` drops IN_MOVED_TO when the destination already
	// existed — we recover by scanning the dir for files with fresh
	// ctime after a temp-file event fires.
	const recentlyHandled = new Map<string, number>();
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;

	const scheduleReload = (cause: string) => {
		if (pendingTimer) return;
		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			void triggerReload(cause);
		}, RELOAD_DEBOUNCE_MS);
	};

	// Bun caches `import()` results by resolved path. Two related
	// behaviors verified empirically on Bun 1.3.13:
	//
	// 1. `?t=Date.now()` query strings do not bust the cache (Node
	//    treats them as unique URLs; Bun ignores them).
	// 2. `delete createRequire(...).cache[path] + await import(path)`
	//    DOES re-evaluate the module's top-level (you see the eval
	//    logs) and produces fresh exports in isolated tests — but in
	//    our framework's setup with `await prepare()` at top level,
	//    something in the cache lifecycle prevents `Bun.serve.reload`
	//    from picking up the new `app.fetch`. PID stays, "[server.ts]
	//    eval" + "server module reloaded" both fire, but external
	//    requests keep hitting the original handler.
	//
	// The reliable workaround is to copy the entry to a unique
	// sibling path on each reload and import that copy. Different
	// paths bypass Bun's per-path cache entirely; same-directory
	// placement keeps the entry's relative imports
	// (`./angular/...`, `./absolute.config`) resolving to their
	// originals. Cleanup in `finally` so the project tree stays
	// clean. The temp filename uses `.absolutejs-hmr-` prefix and
	// both `fileWatcher.ts` and the CLI watcher's
	// `isAtomicWriteTemp` filter skip that pattern so temp creation
	// doesn't itself trigger a restart.

	// Bun cache invalidation under `bun --hot`:
	//
	// The natural pattern is
	//   delete createRequire(import.meta.url).cache[path];
	//   await import(path);
	// which works fine under plain `bun`. Under `bun --hot` (which is
	// what our dev CLI spawns the child with) the second `await import`
	// throws "Requested module is not instantiated yet" — `--hot`'s
	// internal module-record tracking doesn't tolerate userland
	// invalidating the cache out from under it. Tracked as
	// oven-sh/bun#30447. When that's fixed, this whole block reverts
	// to:
	//   delete createRequire(import.meta.url).cache[entryPath];
	//   await import(entryPath);
	// (and the `.absolutejs-hmr-*` filter in fileWatcher.ts and
	// dev.ts's isAtomicWriteTemp can be dropped — see
	// ABSOLUTE_CONFIG_TOGGLE_LIMITATION.md).
	//
	// Workaround until then: copy the entry to a unique sibling path
	// and `await import` the copy. Different path → different module
	// record → not tracked by `--hot`. Same-directory placement keeps
	// the entry's relative imports (`./angular/...`,
	// `./absolute.config`) resolving correctly. Delete the copy in
	// `finally` so the project tree stays clean.

	const triggerReload = async (cause: string) => {
		const now = Date.now();
		const last = recentlyHandled.get(cause) ?? 0;
		if (now - last < 100) return;
		recentlyHandled.set(cause, now);

		const tmpName = `.absolutejs-hmr-${now}-${Math.random()
			.toString(36)
			.slice(2, 8)}.ts`;
		const tmpPath = join(entryDir, tmpName);
		try {
			console.log(`[hmr] reloading server entry (${cause})`);
			copyFileSync(entryPath, tmpPath);
			await import(tmpPath);
			// On success, the new module's `networking` plugin call
			// has already swapped the running Bun.serve's fetch
			// handler via `app.server.reload({ fetch, routes: {} })`.
		} catch (err) {
			console.error(
				`[hmr] entry re-evaluation failed: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			// Fall back to a full child restart via the marker
			// pathway. The parent CLI's handleChunk picks this up and
			// respawns. The OLD app keeps serving until then.
			console.log(`[abs:restart] ${entryPath}`);
		} finally {
			try {
				unlinkSync(tmpPath);
			} catch {
				/* may not exist if copy failed */
			}
		}
	};

	const recoveryScan = () => {
		let entries: import('node:fs').Dirent[];
		try {
			const { readdirSync } = require('node:fs') as typeof import('node:fs');
			entries = readdirSync(entryDir, { withFileTypes: true });
		} catch {
			return;
		}
		const now = Date.now();
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (entry.name !== entryBase) continue;
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(join(entryDir, entry.name));
			} catch {
				continue;
			}
			if (now - st.ctimeMs > ATOMIC_RECOVERY_WINDOW_MS) continue;
			scheduleReload(entry.name);
		}
	};

	const handleEvent = (_event: string, filename: string | null) => {
		if (!filename) return;
		if (isAtomicWriteTemp(filename)) {
			recoveryScan();
			return;
		}
		if (filename !== entryBase) return;
		scheduleReload(filename);
	};

	const entryWatcher = watch(entryDir, { recursive: false }, handleEvent);

	const closeAll = () => {
		try {
			entryWatcher.close();
		} catch {
			/* already closed */
		}
	};
	process.once('exit', closeAll);
	process.once('SIGINT', closeAll);
	process.once('SIGTERM', closeAll);
};
