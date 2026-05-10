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

	// Bun caches `import()` results AND module source code by resolved
	// path. Neither query strings nor `delete require.cache[path]`
	// followed by `await import(path)` actually re-reads the file from
	// disk — the second-load module's top-level runs but with stale
	// source. (Verified Bun 1.3.13.)
	//
	// Workaround: copy the entry to a unique sibling path on each
	// reload and import that copy. Different paths bypass Bun's
	// content cache, and putting the copy in the same directory keeps
	// the entry's relative imports (`./angular/...`,
	// `./absolute.config`, etc.) resolving to the same files. Delete
	// the copy in `finally` so the project tree stays clean.

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
			// handler via `app.server.reload({ fetch })`.
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
