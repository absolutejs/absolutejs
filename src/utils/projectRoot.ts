import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CONFIG_CANDIDATES = [
	'absolute.config.ts',
	'absolute.config.js',
	'absolute.config.mjs',
	'absolute.config.cjs',
	'absolute.config.mts',
	'absolute.config.cts'
];
const hasAbsoluteConfig = (directory: string) =>
	CONFIG_CANDIDATES.some((name) => existsSync(resolve(directory, name)));

const findProjectRoot = () => {
	const start = process.cwd();
	let packageRoot: string | null = null;
	let directory = start;

	for (;;) {
		if (hasAbsoluteConfig(directory)) {
			return directory;
		}
		if (
			packageRoot === null &&
			existsSync(resolve(directory, 'package.json'))
		) {
			packageRoot = directory;
		}
		const parent = dirname(directory);
		if (parent === directory) {
			return packageRoot ?? start;
		}
		directory = parent;
	}
};

/**
 * Absolute path to the project root — the directory holding your
 * `absolute.config.*` (falling back to the nearest `package.json`, then
 * `process.cwd()`). Resolved once at import.
 *
 * Anchor runtime and data paths to this instead of `import.meta.dir` /
 * `import.meta.url`. Those resolve the *current module's* location, which is
 * your `src/` tree under `absolute dev` but the bundled `dist/` under
 * `absolute start` — so module-relative paths silently point somewhere else in
 * production. `projectRoot` is identical in both modes because the CLI runs
 * from the project root in both.
 *
 * @example
 * import { projectRoot } from '@absolutejs/absolute';
 * const dbPath = resolve(projectRoot, '.data', 'app.sqlite');
 */
export const projectRoot = findProjectRoot();
