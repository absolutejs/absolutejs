import { resolve, sep } from 'node:path';
import type { BuildConfig } from '../../types/build';

/* Keeps the generated Svelte component declarations
 * (build/svelteDeclarations.ts) current while `absolute dev` runs, so an
 * editor whose tsconfig lists the mirror in `rootDirs` shows a server-file
 * prop error as soon as a component's props change — not only after the
 * next `absolute typecheck`. Off the critical path: it waits for a quiet
 * moment, runs one generation at a time, and never fails the dev server. */

const REFRESH_DEBOUNCE_MS = 400;

export const createSvelteDeclarationRefresher = (config: BuildConfig) => {
	const { svelteDirectory } = config;
	if (!svelteDirectory) return null;
	const projectRoot = process.cwd();
	const svelteRoot = resolve(projectRoot, svelteDirectory) + sep;
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
			const { generateSvelteDeclarations } =
				await import('../build/svelteDeclarations');
			await generateSvelteDeclarations({ projectRoot, svelteDirectory });
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
		/** Call for every watcher event; only Svelte-directory sources count. */
		onFileChange: (filePath: string) => {
			if (resolve(filePath).startsWith(svelteRoot)) schedule();
		}
	};
};
