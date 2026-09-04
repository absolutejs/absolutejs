/* Per-file memo for the whole-project scan phases (`scan/worker-references`
 * and `scan/vue-ssr-only`).
 *
 * Dev builds pages on demand, so those two phases re-read and re-parse the
 * entire source tree once per page open even though nothing changed between
 * two opens. This cache keeps the directory walk — it is a few milliseconds
 * and it is what makes the memo sound — and skips only the per-file content
 * work (`readFileSync` + regex, or `readFileSync` + `ts.createSourceFile`)
 * for files whose `(mtimeMs, size)` stamp is unchanged.
 *
 * Why a stamp and not the dev watcher's change stream: the watcher's positive
 * roots are directories (`getWatchPaths`), so files sitting directly at the
 * project root — `server.ts`, `vueImporter.ts` — are never delivered to
 * `queueFileChange`, and `htmlDirectory`/`htmxDirectory` are watched only at
 * `pages/`, `scripts/` and `styles/`. Both scans read outside that coverage
 * (the Vue SSR-only scan walks the entire project root), so an event-driven
 * memo would go stale on exactly the edit that matters — a `client: 'none'`
 * added to a root-level server entry. Re-stat'ing the walked files has no
 * such hole and costs about 1ms per 1500 files.
 *
 * The cached value must be the *content-derived* part of a file's
 * contribution only. Anything that depends on state outside the file (for
 * worker references: whether the referenced path exists on disk) has to be
 * recomputed by the caller on every pass, or the memo changes the result. */

import { statSync } from 'node:fs';

type Stamp = {
	mtimeMs: number;
	size: number;
};

type Entry<T> = Stamp & {
	value: T;
};

export type StampedFileCache<T> = {
	/** Cached value for `path` when its `(mtimeMs, size)` stamp still
	 *  matches, otherwise `compute()`'s result, stored under the new stamp.
	 *  Falls back to an uncached `compute()` when the file cannot be
	 *  stat'ed, so behaviour matches an uncached scan exactly. */
	read: (path: string, compute: () => T) => T;
	/** Drop every entry not read since the previous `endPass()`, so deleted
	 *  files do not pin their contribution in memory forever. */
	endPass: () => void;
};

/* An mtime is only worth trusting once it is safely in the past. Most
 * filesystems a source tree lives on stamp with nanosecond resolution, but a
 * few (ext3, HFS+, some network mounts) round to the second — and there a
 * second edit of the same byte length within the same second would carry the
 * stamp we already recorded. Files modified inside this window are always
 * recomputed and deliberately left out of the cache, so a stamp is only ever
 * stored for a file that has been quiet long enough for the stamp to be
 * unambiguous. The cost is recomputing the handful of files the developer
 * just touched, which is precisely the set that had to be recomputed anyway.
 * This is the same rule `make` and `ccache` apply to mtimes. */
const STAMP_SETTLE_MS = 2000;

export const createStampedFileCache = <T>(): StampedFileCache<T> => {
	const entries = new Map<string, Entry<T>>();
	const seen = new Set<string>();

	const read = (path: string, compute: () => T) => {
		let stamp: Stamp;
		try {
			const stats = statSync(path);
			stamp = { mtimeMs: stats.mtimeMs, size: stats.size };
		} catch {
			return compute();
		}

		seen.add(path);
		if (Date.now() - stamp.mtimeMs < STAMP_SETTLE_MS) {
			entries.delete(path);

			return compute();
		}

		const cached = entries.get(path);
		if (
			cached &&
			cached.mtimeMs === stamp.mtimeMs &&
			cached.size === stamp.size
		) {
			return cached.value;
		}

		const value = compute();
		entries.set(path, { ...stamp, value });

		return value;
	};

	const endPass = () => {
		for (const path of entries.keys()) {
			if (!seen.has(path)) entries.delete(path);
		}
		seen.clear();
	};

	return { endPass, read };
};
