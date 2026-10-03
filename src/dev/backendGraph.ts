import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { isAbsoluteServerEntryCopyPath } from './serverEntryCopies';

/* The import graph of the server's own code, as this process loaded it.
 *
 * Backend HMR walks it upward from an edited module to find the importers
 * that may need a new version (docs/BACKEND_HMR.md). Bun does not expose its
 * module graph, so this rebuilds the edges from what Bun reports as loaded
 * (`require.cache`, which lists static and dynamic imports alike) and each
 * file's own import statements. Edges are cached per file and re-read only
 * when the file changes on disk. Packages under `node_modules` are leaves. */

type GraphFile = { mtimeMs: number; imports: string[] };

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|mts|cts)$/;
const VENDORED = /[\\/]node_modules[\\/]/;
const LOADERS: Record<string, 'js' | 'jsx' | 'ts' | 'tsx'> = {
	'.cjs': 'js',
	'.cts': 'ts',
	'.js': 'js',
	'.jsx': 'jsx',
	'.mjs': 'js',
	'.mts': 'ts',
	'.ts': 'ts',
	'.tsx': 'tsx'
};

const fileCache = new Map<string, GraphFile>();
const transpilers = new Map<string, InstanceType<typeof Bun.Transpiler>>();

const transpilerFor = (path: string) => {
	const loader = LOADERS[extname(path)] ?? 'ts';
	const existing = transpilers.get(loader);
	if (existing) return existing;
	const created = new Bun.Transpiler({ loader });
	transpilers.set(loader, created);

	return created;
};

const realPath = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** True for the app's own source modules: loaded, under the project, and
 *  not a package. */
export const isProjectModule = (path: string, root = process.cwd()) =>
	SOURCE_FILE.test(path) &&
	!VENDORED.test(path) &&
	resolve(path).startsWith(resolve(root));

const resolveImport = (specifier: string, fromFile: string) => {
	try {
		return realPath(Bun.resolveSync(specifier, dirname(fromFile)));
	} catch {
		return undefined;
	}
};

const readImports = (path: string) => {
	let mtimeMs: number;
	try {
		({ mtimeMs } = statSync(path));
	} catch {
		fileCache.delete(path);

		return [];
	}
	const cached = fileCache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.imports;
	let imports: string[] = [];
	try {
		const source = readFileSync(path, 'utf-8');
		imports = transpilerFor(path)
			.scanImports(source)
			.map((entry) => resolveImport(entry.path, path))
			.filter((target): target is string => target !== undefined);
	} catch {
		// Unparseable mid-edit: no edges until it parses again.
	}
	fileCache.set(path, { imports, mtimeMs });

	return imports;
};

/** Project modules this process has loaded. The server entry is loaded
 *  through short-lived sibling copies (`.absolutejs-hmr-*`); those count as
 *  the entry itself. */
export const importersOf = (
	target: string,
	entry: string,
	loaded: Set<string> = loadedProjectModules(entry)
) => {
	const goal = realPath(resolve(target));
	const importers: string[] = [];
	for (const file of loaded)
		if (readImports(file).includes(goal)) importers.push(file);

	return importers;
};
export const loadedProjectModules = (
	entry: string,
	loaded: Iterable<string> = Object.keys(require.cache),
	root = process.cwd()
) => {
	const entryPath = realPath(resolve(entry));
	const modules = new Set<string>([entryPath]);
	for (const path of loaded) {
		if (isAbsoluteServerEntryCopyPath(path)) continue;
		if (isProjectModule(path, root)) modules.add(realPath(path));
	}

	return modules;
};
