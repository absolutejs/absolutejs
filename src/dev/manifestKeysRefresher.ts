import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';

/* Keeps the generated manifest-key declaration (build/manifestKeys.ts)
 * current while `absolute dev` runs: a page, stylesheet or island added or
 * removed changes the keys `asset(manifest, key)` accepts, and an editor
 * that reads the declaration should see that without a restart. Only a
 * file appearing or disappearing (or an edit to the island registry, which
 * lists islands by name) can change the key set, so plain edits cost a
 * `Set` lookup. Off the critical path: debounced, one derivation at a time,
 * never fails the dev server. The initial declaration is written by the
 * boot build. */

const REFRESH_DEBOUNCE_MS = 300;

export const createManifestKeysRefresher = (config: BuildConfig) => {
	const projectRoot = process.cwd();
	const registry = config.islands?.registry
		? resolve(projectRoot, config.islands.registry)
		: undefined;
	/* Paths seen to exist. The first event for a file that already existed
	 * refreshes once; the write is skipped when nothing changed. */
	const present = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running = false;
	let pending = false;

	const run = async () => {
		if (running) {
			pending = true;

			return;
		}
		running = true;
		try {
			const { writeManifestKeysDeclaration } =
				await import('../build/manifestKeys');
			const { writeRouteMapDeclaration } =
				await import('../build/routeMap');
			await Promise.all([
				writeManifestKeysDeclaration(config, projectRoot),
				writeRouteMapDeclaration(config, projectRoot)
			]);
		} catch {
			/* type declarations are a convenience; never at the cost of dev */
		} finally {
			running = false;
			rerunIfPending();
		}
	};

	const rerunIfPending = () => {
		if (!pending) return;
		pending = false;
		schedule();
	};

	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void run(), REFRESH_DEBOUNCE_MS);
	};

	return {
		refresh: schedule,
		/** Call for every watcher event. */
		onFileChange: (filePath: string) => {
			const path = resolve(filePath);
			const exists = existsSync(path);
			if (path === registry) {
				schedule();

				return;
			}
			if (exists === present.has(path)) return;
			if (exists) present.add(path);
			else present.delete(path);
			schedule();
		}
	};
};
