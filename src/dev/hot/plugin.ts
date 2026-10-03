import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { Loader } from 'bun';
import type * as TS from 'typescript';
import { isAbsoluteServerEntryCopyPath } from '../serverEntryCopies';
import {
	analyzeModule,
	ANALYZER_VERSION,
	facadeSource,
	resolveFrom,
	type HotModuleAnalysis,
	type HotModuleRejection
} from './analyze';
import { currentTag, installHotRuntime, setAnalysis } from './runtime';

/* Serves the app's server modules through the hot runtime: importers get a
 * facade, `?absolute-hot=N` loads get the rewritten implementation (see
 * docs/BACKEND_HMR.md). Packages, AbsoluteJS itself, build output,
 * framework page directories, the config and tests load untouched. */

type HotPluginOptions = {
	root: string;
	entryPath: string;
	configPath: string;
	/** Directories whose files are never managed (framework pages, build
	 *  output, assets). */
	excludedDirs: string[];
};

type Analysis = HotModuleAnalysis | HotModuleRejection;
type InstalledOptions = HotPluginOptions & { cacheDir: string };

const HOT_QUERY = /^absolute-hot=(\d+)$/;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /(?:\.(?:spec|test)\.[cm]?[jt]sx?$)|(?:[\\/]__tests__[\\/])/;
const GENERATED =
	/(?:^|[\\/])(?:build|generated|compiled|indexes|\.absolutejs|node_modules|dist)(?:[\\/]|$)/;
const ABSOLUTE_ROOT = resolve(import.meta.dir, '..', '..', '..');

const TS_LOADER: Loader = 'ts';
const LOADERS: Record<string, Loader> = {
	'.cjs': 'js',
	'.js': 'js',
	'.jsx': 'jsx',
	'.mjs': 'js',
	'.tsx': 'tsx'
};
const loaderFor = (path: string) => LOADERS[extname(path)] ?? TS_LOADER;

const realPath = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let typescript: typeof TS | undefined;
const loadTypescript = async () => {
	typescript ??= await import('typescript');

	return typescript;
};

let state: InstalledOptions | undefined;
const analyses = new Map<string, { source: string; analysis: Analysis }>();

/** Whether the hot runtime manages `path` (an absolute file path). */
export const isHotManaged = (path: string) => {
	if (!state) return false;
	const file = realPath(path);
	if (!SOURCE.test(file)) return false;
	if (!file.startsWith(`${state.root}${sep}`)) return false;
	if (file.startsWith(`${ABSOLUTE_ROOT}${sep}src${sep}`)) return false;
	if (file.startsWith(`${ABSOLUTE_ROOT}${sep}dist${sep}`)) return false;
	if (GENERATED.test(file.slice(state.root.length))) return false;
	if (TEST_FILE.test(file)) return false;
	if (file === state.configPath) return false;
	if (isAbsoluteServerEntryCopyPath(file)) return false;

	return !state.excludedDirs.some(
		(dir) => file === dir || file.startsWith(`${dir}${sep}`)
	);
};

const isAnalysis = (value: unknown): value is Analysis => {
	if (typeof value !== 'object' || value === null) return false;
	const status = Reflect.get(value, 'ok');
	if (status === false)
		return typeof Reflect.get(value, 'reason') === 'string';

	return (
		status === true &&
		typeof Reflect.get(value, 'code') === 'string' &&
		typeof Reflect.get(value, 'exports') === 'object' &&
		Array.isArray(Reflect.get(value, 'reexports')) &&
		Array.isArray(Reflect.get(value, 'plan'))
	);
};

const cachePath = (cacheDir: string, key: string) =>
	join(cacheDir, `${key}.json`);

const readCached = (key: string) => {
	if (!state) return undefined;
	try {
		const cached: unknown = JSON.parse(
			readFileSync(cachePath(state.cacheDir, key), 'utf-8')
		);

		return isAnalysis(cached) ? cached : undefined;
	} catch {
		return undefined;
	}
};

const writeCached = (key: string, analysis: Analysis) => {
	if (!state) return;
	try {
		writeFileSync(cachePath(state.cacheDir, key), JSON.stringify(analysis));
	} catch {
		// A cache write failure only costs the next boot a parse.
	}
};

const analyzeFresh = async (canonicalPath: string, source: string) => {
	const typescriptModule = await loadTypescript();

	return analyzeModule(
		typescriptModule,
		canonicalPath,
		source,
		resolveFrom(canonicalPath, isHotManaged)
	);
};

/** Analyse `source` as module `canonicalPath`, from the disk cache when the
 *  same source was analysed before. */
export const analyzeSource = async (canonicalPath: string, source: string) => {
	const memo = analyses.get(canonicalPath);
	if (memo && memo.source === source) return memo.analysis;
	const key = Bun.hash(
		`${ANALYZER_VERSION}\u0000${canonicalPath}\u0000${source}`
	).toString(36);
	const cached = readCached(key);
	const analysis = cached ?? (await analyzeFresh(canonicalPath, source));
	if (!cached) writeCached(key, analysis);
	analyses.set(canonicalPath, { analysis, source });

	return analysis;
};

const loadImplementation = async (canonicalPath: string, filePath: string) => {
	const source = readFileSync(filePath, 'utf-8');
	const analysis = await analyzeSource(canonicalPath, source);
	if (!analysis.ok) return { contents: source, loader: loaderFor(filePath) };
	setAnalysis(canonicalPath, analysis, source);

	return { contents: analysis.code, loader: loaderFor(filePath) };
};

const loadFacade = async (path: string) => {
	const source = readFileSync(path, 'utf-8');
	const analysis = await analyzeSource(path, source);
	if (!analysis.ok) return { contents: source, loader: loaderFor(path) };

	return {
		contents: facadeSource(
			path,
			`${path}?absolute-hot=${currentTag(path)}`,
			analysis
		),
		// The module's own loader: re-exports are copied as written, and
		// may carry TypeScript (`export { x, type T } from`).
		loader: loaderFor(path)
	};
};

const SEPARATOR = '[\\\\/]';

/** A filter matching exactly the files this plugin manages. Bun's `onLoad`
 *  cannot hand a file back to the default loader once matched — and a
 *  CommonJS package served as module source loses its named exports — so
 *  everything unmanaged must not match at all. */
export const installHotModulePlugin = async (options: HotPluginOptions) => {
	try {
		await loadTypescript();
	} catch {
		return false;
	}
	const root = realPath(resolve(options.root));
	const cacheDir = join(root, '.absolutejs', 'hot');
	mkdirSync(cacheDir, { recursive: true });
	const installed: InstalledOptions = {
		...options,
		cacheDir,
		configPath: realPath(resolve(options.configPath)),
		entryPath: realPath(resolve(options.entryPath)),
		excludedDirs: options.excludedDirs.map((dir) => realPath(resolve(dir))),
		root
	};
	state = installed;
	installHotRuntime();
	const { entryPath } = installed;
	Bun.plugin({
		name: 'absolute-backend-hmr',
		setup(build) {
			build.onLoad({ filter: managedFilter(installed) }, async (args) => {
				const queryStart = args.path.indexOf('?');
				const filePath =
					queryStart === -1
						? args.path
						: args.path.slice(0, queryStart);
				const query =
					queryStart === -1 ? '' : args.path.slice(queryStart + 1);
				if (isAbsoluteServerEntryCopyPath(filePath))
					return loadImplementation(entryPath, filePath);
				if (
					!isHotManaged(filePath) ||
					(query && !HOT_QUERY.test(query))
				)
					return {
						contents: readFileSync(filePath, 'utf-8'),
						loader: loaderFor(filePath)
					};
				const canonical = realPath(filePath);
				if (query) return loadImplementation(canonical, filePath);

				return loadFacade(canonical);
			});
		}
	});

	return true;
};
export const managedFilter = (options: HotPluginOptions & { root: string }) => {
	const under = (dir: string) => {
		const rel = relative(options.root, dir);
		if (rel === '' || rel.startsWith('..')) return undefined;

		return `(?!${escapeRegex(rel).split(sep).join(SEPARATOR)}(?:${SEPARATOR}|\\?|$))`;
	};
	const excluded = [
		...options.excludedDirs,
		join(ABSOLUTE_ROOT, 'src'),
		join(ABSOLUTE_ROOT, 'dist')
	]
		.map(under)
		.filter((pattern): pattern is string => pattern !== undefined);
	const config = relative(options.root, options.configPath);
	const configPattern =
		config && !config.startsWith('..')
			? `(?!${escapeRegex(config).split(sep).join(SEPARATOR)}(?:\\?|$))`
			: '';

	return new RegExp(
		[
			`^${escapeRegex(options.root)}${SEPARATOR}`,
			`(?!(?:[^?]*${SEPARATOR})?(?:node_modules|build|dist|generated|compiled|indexes|\\.absolutejs)${SEPARATOR})`,
			`(?![^?]*(?:\\.(?:spec|test)\\.[cm]?[jt]sx?|${SEPARATOR}__tests__${SEPARATOR}))`,
			...excluded,
			configPattern,
			`[^?]*\\.(?:m?[jt]sx?|mts|cts)(?:\\?.*)?$`
		].join('')
	);
};
