import { BASE_36_RADIX } from '../constants';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve
} from 'node:path';
import type {
	SFCDescriptor,
	compileScript as CompileScriptFn,
	compileStyle as CompileStyleFn,
	compileTemplate as CompileTemplateFn,
	parse as ParseFn
} from '@vue/compiler-sfc';
import { file, write } from 'bun';
import type {
	TsHelperEmitInput,
	VueSfcCompileInput,
	VueSfcCompileOutput
} from '../../types/workerPool';
import { toKebab } from '../utils/stringModifiers';
import { loadVueCompiler } from '../utils/vueCompiler';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';
import { resolvePackageImport } from './resolvePackageImport';
import { parseVueSpaRoutes, type ParsedVueSpaRoute } from './parseVueSpaRoutes';
import { addAutoRouterSetupApp } from './vueAutoRouterTransform';
import { getBuildWorkerPool } from './workerPool';
import { devProfileEnabled } from '../utils/startupTimings';
import {
	addStyleImporter,
	compileStyleSource,
	isStylePath
} from './stylePreprocessor';
import type { StylePreprocessorConfig } from '../../types/build';
import {
	hashParts,
	readVueCompileCacheEntry,
	vueCompileCacheEnabled,
	vueCompileCacheFingerprint,
	writeVueCompileCacheEntry,
	type VueCompileCacheEntry
} from './vueCompileCache';

const resolveDevClientDir = () => {
	const projectRoot = process.cwd();
	const fromSource = resolve(import.meta.dir, '../dev/client');

	if (existsSync(fromSource) && fromSource.startsWith(projectRoot)) {
		return fromSource;
	}

	const fromNodeModules = resolve(
		projectRoot,
		'node_modules/@absolutejs/absolute/dist/dev/client'
	);
	if (existsSync(fromNodeModules)) return fromNodeModules;

	return resolve(import.meta.dir, './dev/client');
};

const devClientDir = resolveDevClientDir();

const hmrClientPath = join(devClientDir, 'hmrClient.ts').replace(/\\/g, '/');

type BuildResult = {
	clientPath: string;
	serverPath: string;
	cssPaths: string[];
	cssCodes: string[];
	tsHelperPaths: string[];
	hmrId: string;
	/** Entries from `export const routes = defineRoutes([...])` when
	 *  this Vue file is an SPA-shell page. Drives the SSR child-route
	 *  CSS side manifest in `core/build.ts`. Empty/undefined for non-
	 *  entry-point files and entries that don't register routes. */
	spaRoutes?: ParsedVueSpaRoute[];
	/** Restart-surviving cache key (see `vueCompileCache.ts`). Unset when
	 *  the component is not cacheable (external style dependencies) or
	 *  the cache is disabled; parents of an uncacheable child are
	 *  uncacheable too. */
	cacheKey?: string;
};

// HMR change type detection
export type VueChangeType = 'style-only' | 'template-only' | 'script' | 'full';

// Descriptor caches for change detection
const scriptCache = new Map<string, string>();
const scriptSetupCache = new Map<string, string>();
const templateCache = new Map<string, string>();
const styleCache = new Map<string, string>();

// Persistent build result cache across HMR cycles — avoids recompiling unchanged Vue components
const persistentBuildCache = new Map<string, BuildResult>();

// Source content hash cache to detect unchanged files
const vueSourceHashCache = new Map<string, string>();

// HMR metadata storage (exported for rebuildTrigger to access)
export const vueHmrMetadata = new Map<
	string,
	{ hmrId: string; changeType: VueChangeType }
>();
export const clearVueHmrCaches = () => {
	scriptCache.clear();
	scriptSetupCache.clear();
	templateCache.clear();
	styleCache.clear();
	vueHmrMetadata.clear();
	persistentBuildCache.clear();
	vueSourceHashCache.clear();
};

export const detectVueChangeType = (
	filePath: string,
	descriptor: SFCDescriptor
) => {
	const prevScript = scriptCache.get(filePath);
	const prevScriptSetup = scriptSetupCache.get(filePath);
	const prevTemplate = templateCache.get(filePath);
	const prevStyle = styleCache.get(filePath);

	const currentScript = descriptor.script?.content ?? '';
	const currentScriptSetup = descriptor.scriptSetup?.content ?? '';
	const currentTemplate = descriptor.template?.content ?? '';
	// Serialize styles: include scoped flag and content for each style block
	// Uses ||| delimiter to detect changes to any block, additions, removals, or reordering
	const currentStyle = descriptor.styles
		.map((s) => `${s.scoped ? 'scoped:' : ''}${s.content}`)
		.join('|||');

	// Update caches with current values
	scriptCache.set(filePath, currentScript);
	scriptSetupCache.set(filePath, currentScriptSetup);
	templateCache.set(filePath, currentTemplate);
	styleCache.set(filePath, currentStyle);

	// First compile - no previous data
	if (prevScript === undefined && prevScriptSetup === undefined) {
		return 'full';
	}

	const scriptChanged = prevScript !== currentScript;
	const scriptSetupChanged = prevScriptSetup !== currentScriptSetup;
	const templateChanged = prevTemplate !== currentTemplate;
	const styleChanged = prevStyle !== currentStyle;

	// Priority order:
	// 1. Script changes → 'script' (requires reload)
	// 2. Template-only (no script, no style) → 'template-only' (rerender)
	// 3. Style-only (no script, no template) → 'style-only' (CSS hot-swap, state preserved)
	// 4. Template + style → 'template-only' (CSS swapped alongside rerender)

	// Script change: script or scriptSetup changed (may also include template/style)
	if (scriptChanged || scriptSetupChanged) {
		return 'script';
	}

	// Style-only change: only styles changed, no script or template
	if (styleChanged && !templateChanged) {
		return 'style-only';
	}

	// Template-only change: template changed (with or without styles), script unchanged
	if (templateChanged) {
		return 'template-only';
	}

	// No changes detected (shouldn't happen in practice)
	return 'full';
};
export const generateVueHmrId = (sourceFilePath: string, vueRootDir: string) =>
	relative(vueRootDir, sourceFilePath)
		.replace(/\\/g, '/')
		.replace(/\.vue$/, '');

const extractImports = (sourceCode: string) => {
	const staticImports = Array.from(
		sourceCode.matchAll(/import\s+[\s\S]+?['"]([^'"]+)['"]/g)
	);
	const dynamicImports = Array.from(
		sourceCode.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
	);

	return Array.from(
		new Set(
			[...staticImports, ...dynamicImports]
				.map((match) => match[1])
				.filter(
					(importPath): importPath is string =>
						importPath !== undefined
				)
		)
	);
};

// Resolve a relative .ts helper import to an actual file path. Mirrors
// node's resolution: if `<dir>/<helper>.ts` doesn't exist, try
// `<dir>/<helper>/index.ts` so callers can import a directory module.
const resolveHelperTsPath = (sourceDir: string, helper: string) => {
	if (helper.endsWith('.ts')) return resolve(sourceDir, helper);
	const direct = resolve(sourceDir, `${helper}.ts`);
	if (existsSync(direct)) return direct;
	const indexed = resolve(sourceDir, helper, 'index.ts');
	if (existsSync(indexed)) return indexed;

	return direct;
};

type VueCompiler = {
	parse: typeof ParseFn;
	compileScript: typeof CompileScriptFn;
	compileTemplate: typeof CompileTemplateFn;
	compileStyle: typeof CompileStyleFn;
	/** `@vue/compiler-sfc` version — part of the compile-cache key. */
	version?: string;
};

/** Runs the pure per-SFC compile (`compileVueSfc`) — on a build worker
 *  or inline; decided once per `compileVue` call (see `selectSfcRunner`). */
type SfcRunner = (input: VueSfcCompileInput) => Promise<VueSfcCompileOutput>;

/** Batches below the pool's threshold (a single HMR edit) compile on the
 *  main thread; a cold dev boot or `absolute build` fans the SFCs out
 *  across the worker pool. Jobs carry the source directory as affinity
 *  so a worker keeps seeing the same imported-type files. */
/* Helper batches: one job per worker rather than one per file, so a
 * few hundred helpers cost a handful of `postMessage` round trips. Small
 * batches (a single-component HMR edit) stay inline — the pool's own
 * `shouldUse` makes that call. */
const HELPER_JOB_MIN_BATCH = 24;

const runHelperEmit = async (files: TsHelperEmitInput['files']) => {
	if (files.length === 0) return;
	const pool = getBuildWorkerPool();
	const inline = !pool.shouldUse(files.length);
	if (inline) {
		const { emitTsHelpers } = await import('./emitTsHelpers');
		await emitTsHelpers({ files });

		return;
	}
	pool.warm('ts-helper-emit');
	const chunkSize = Math.max(
		HELPER_JOB_MIN_BATCH,
		Math.ceil(files.length / Math.max(1, pool.size))
	);
	const batches: TsHelperEmitInput['files'][] = [];
	for (let index = 0; index < files.length; index += chunkSize) {
		batches.push(files.slice(index, index + chunkSize));
	}
	await Promise.all(
		batches.map((batch) => pool.run('ts-helper-emit', { files: batch }))
	);
};

const selectSfcRunner = (entryCount: number) => {
	const pool = getBuildWorkerPool();
	const inline = !pool.shouldUse(entryCount);
	// Each worker's first job would otherwise pay the ~1s
	// `@vue/compiler-sfc` + `typescript` load; start that now so it
	// overlaps the main thread's own compiler load and entry scan.
	if (!inline) pool.warm('vue-sfc');
	const runSfc: SfcRunner = (input) =>
		pool.run('vue-sfc', input, {
			affinity: dirname(input.sourceFilePath),
			inline
		});

	return runSfc;
};

// addAutoRouterSetupApp moved to ./vueAutoRouterTransform — shared
// with the dev module server (src/dev/moduleServer.ts) so the auto
// router is present in every served version of a page module.

const EXTERNAL_STYLE_DEPENDENCY = /@(?:import|use|forward)\b/;

/** `<style>` blocks that pull in other files (preprocessor `lang`, or
 *  `@import`/`@use`/`@forward`) make the output depend on content the
 *  cache key cannot see — such components are compiled every time. */
const hasExternalStyleDependency = (descriptor: SFCDescriptor) =>
	descriptor.styles.some(
		(styleBlock) =>
			Boolean(styleBlock.lang) ||
			EXTERNAL_STYLE_DEPENDENCY.test(styleBlock.content)
	);

const fingerprintCache = new Map<string, string | null>();
const currentVueCompileFingerprint = (
	compiler: VueCompiler,
	outputDirs: { client: string; server: string; css: string },
	vueRootDir: string,
	stylePreprocessors: StylePreprocessorConfig | undefined
) => {
	const memoKey = JSON.stringify([
		outputDirs,
		vueRootDir,
		stylePreprocessors
	]);
	const memoised = fingerprintCache.get(memoKey);
	if (memoised !== undefined) return memoised;
	const fingerprint = vueCompileCacheFingerprint({
		compilerVersion: compiler.version,
		outputDirs,
		stylePreprocessors,
		vueRootDir
	});
	fingerprintCache.set(memoKey, fingerprint);

	return fingerprint;
};

const computeVueCompileCacheKey = (parts: {
	childResults: BuildResult[];
	contentHash: string;
	descriptor: SFCDescriptor;
	fingerprint: string | null;
	isEntryPoint: boolean;
	relativeWithoutExtension: string;
}) => {
	if (!parts.fingerprint || !vueCompileCacheEnabled()) return undefined;
	if (hasExternalStyleDependency(parts.descriptor)) return undefined;
	const childKeys: string[] = [];
	for (const child of parts.childResults) {
		if (!child.cacheKey) return undefined;
		childKeys.push(child.cacheKey);
	}

	return hashParts([
		parts.fingerprint,
		parts.relativeWithoutExtension,
		parts.isEntryPoint ? 'entry' : 'child',
		parts.contentHash,
		...childKeys
	]);
};

/** Re-create the on-disk intermediates for a cache hit. The entry CSS
 *  file is `cssCodes` joined exactly as the compile path writes it. */
const materialiseVueCompileCacheEntry = async (
	entry: VueCompileCacheEntry,
	cacheKey: string,
	isEntryPoint: boolean,
	outputDirs: { client: string; server: string; css: string },
	fileBaseName: string
): Promise<BuildResult> => {
	const { result } = entry;
	const cssOutputFile =
		isEntryPoint && result.cssCodes.length > 0
			? join(outputDirs.css, `${toKebab(fileBaseName)}-compiled.css`)
			: null;
	trackWrite(
		writeVueOutputs({
			clientCode: entry.clientCode,
			clientPath: result.clientPath,
			css: cssOutputFile
				? { code: result.cssCodes.join('\n'), path: cssOutputFile }
				: null,
			serverCode: entry.serverCode,
			serverPath: result.serverPath
		})
	);

	return { ...result, cacheKey };
};

/** Per-`compileVue` memo: a settled `BuildResult`, or the in-flight
 *  compile of a component that several parents import. Without the
 *  in-flight entry every parent that reaches a shared child before the
 *  first compile finishes starts its own (identical) compile — on a
 *  400-SFC app that was ~3x the necessary work. */
type CompileMemo = Map<string, BuildResult | Promise<BuildResult>>;

/** Output and compile-cache writes in flight. A component's result
 *  (paths, CSS) is known before its files hit disk, so the writes are
 *  started and tracked rather than awaited on the spot — otherwise every
 *  child → parent hand-off waits several filesystem round trips while the
 *  worker pool sits idle. `compileVue` drains the set before returning,
 *  so nothing downstream (bundling, the next process's cache) ever
 *  observes a partial write. */
const pendingWrites = new Set<Promise<void>>();
const trackWrite = (writeOperation: Promise<void>) => {
	const tracked: Promise<void> = writeOperation.finally(() =>
		pendingWrites.delete(tracked)
	);
	pendingWrites.add(tracked);
};

type VueOutputFiles = {
	clientCode: string;
	clientPath: string;
	/** Entry CSS file — `null` for child components. */
	css: { code: string; path: string } | null;
	serverCode: string;
	serverPath: string;
};

const writeVueOutputs = async ({
	clientCode,
	clientPath,
	css,
	serverCode,
	serverPath
}: VueOutputFiles) => {
	await Promise.all([
		mkdir(dirname(clientPath), { recursive: true }),
		mkdir(dirname(serverPath), { recursive: true }),
		...(css ? [mkdir(dirname(css.path), { recursive: true })] : [])
	]);
	await Promise.all([
		write(clientPath, clientCode),
		write(serverPath, serverCode),
		...(css ? [write(css.path, css.code)] : [])
	]);
};

/* `ABSOLUTE_DEV_PROFILE=1` breakdown of one `compileVue` call: how many
 * SFCs the pass touched, how many came back from the restart-surviving
 * cache, and where the wall time went. The counters are always updated
 * (the adds are noise next to the work they measure); only the printing
 * is gated. */
type VueCompileProfile = {
	files: number;
	memoHits: number;
	diskHits: number;
	compiles: number;
	readMs: number;
	parseMs: number;
	keyMs: number;
	materialiseMs: number;
	sfcMs: number;
	/** Sequential stages of `compileVue` itself. Unlike the buckets above
	 *  (awaited operations that overlap), these partition the phase's wall
	 *  clock, so they add up to the reported total. */
	stageCompilerMs: number;
	stageExpandMs: number;
	stagePagesMs: number;
	stageHelperScanMs: number;
	stageHelperEmitMs: number;
	stageFlushMs: number;
	helpers: number;
};

const newVueCompileProfile = (): VueCompileProfile => ({
	compiles: 0,
	diskHits: 0,
	files: 0,
	helpers: 0,
	keyMs: 0,
	materialiseMs: 0,
	memoHits: 0,
	parseMs: 0,
	readMs: 0,
	sfcMs: 0,
	stageCompilerMs: 0,
	stageExpandMs: 0,
	stageFlushMs: 0,
	stageHelperEmitMs: 0,
	stageHelperScanMs: 0,
	stagePagesMs: 0
});

let vueCompileProfile = newVueCompileProfile();

const timed = async <Value>(
	bucket: keyof VueCompileProfile,
	operation: () => Promise<Value>
) => {
	const startedAt = performance.now();
	const value = await operation();
	vueCompileProfile[bucket] += performance.now() - startedAt;

	return value;
};

const timedSync = <Value>(
	bucket: keyof VueCompileProfile,
	operation: () => Value
) => {
	const startedAt = performance.now();
	const value = operation();
	vueCompileProfile[bucket] += performance.now() - startedAt;

	return value;
};

const compileVueFile = async (
	sourceFilePath: string,
	outputDirs: { client: string; server: string; css: string },
	cacheMap: CompileMemo,
	isEntryPoint: boolean,
	vueRootDir: string,
	compiler: VueCompiler,
	runSfc: SfcRunner,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const memoised = cacheMap.get(sourceFilePath);
	if (memoised) {
		vueCompileProfile.memoHits += 1;

		return memoised;
	}
	const compilation = compileVueFileUncached(
		sourceFilePath,
		outputDirs,
		cacheMap,
		isEntryPoint,
		vueRootDir,
		compiler,
		runSfc,
		stylePreprocessors
	);
	cacheMap.set(sourceFilePath, compilation);
	try {
		return await compilation;
	} catch (error) {
		cacheMap.delete(sourceFilePath);
		throw error;
	}
};

const compileVueFileUncached = async (
	sourceFilePath: string,
	outputDirs: { client: string; server: string; css: string },
	cacheMap: CompileMemo,
	isEntryPoint: boolean,
	vueRootDir: string,
	compiler: VueCompiler,
	runSfc: SfcRunner,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const relativeFilePath = relative(vueRootDir, sourceFilePath).replace(
		/\\/g,
		'/'
	);
	const relativeWithoutExtension = relativeFilePath.replace(/\.vue$/, '');
	const fileBaseName = basename(sourceFilePath, '.vue');
	const componentId = toKebab(fileBaseName);

	vueCompileProfile.files += 1;
	const rawSourceContent = await timed('readMs', () =>
		file(sourceFilePath).text()
	);
	// Pages exporting `routes` get an auto-synthesized setupApp that owns
	// the vue-router lifecycle, using the page bundle's own vue-router
	// instance (avoids dual-instance provide/inject mismatches).
	const sourceContent = isEntryPoint
		? addAutoRouterSetupApp(rawSourceContent)
		: rawSourceContent;

	// Check persistent cache — skip recompilation if source unchanged AND
	// the compiled outputs still exist on disk. The disk check matters
	// because an outer process (incremental build, test cleanup, manual
	// clean of `.absolutejs/generated`) can remove intermediates while
	// the in-memory cache still believes they're present; bundling the
	// entry would then fail with `Could not resolve "../components/..."`.
	const contentHash = Bun.hash(sourceContent).toString(BASE_36_RADIX);
	const prevHash = vueSourceHashCache.get(sourceFilePath);
	const persistent = persistentBuildCache.get(sourceFilePath);

	if (
		prevHash === contentHash &&
		persistent &&
		existsSync(persistent.clientPath) &&
		existsSync(persistent.serverPath)
	) {
		cacheMap.set(sourceFilePath, persistent);

		return persistent;
	}

	vueSourceHashCache.set(sourceFilePath, contentHash);
	const { descriptor } = timedSync('parseMs', () =>
		compiler.parse(sourceContent, {
			filename: sourceFilePath
		})
	);

	// `export const routes = defineRoutes([...])` declarations live in the
	// module-level `<script>` block. Parse them so core/build.ts can emit
	// the per-route CSS side manifest (see ParsedVueSpaRoute).
	const spaRoutes = isEntryPoint
		? parseVueSpaRoutes(descriptor.script?.content ?? '')
		: [];

	// Generate HMR ID and detect change type
	const hmrId = generateVueHmrId(sourceFilePath, vueRootDir);
	const changeType = detectVueChangeType(sourceFilePath, descriptor);

	// Store HMR metadata for rebuildTrigger to access
	vueHmrMetadata.set(sourceFilePath, { changeType, hmrId });

	const scriptSource =
		descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';

	// SFCs may declare BOTH `<script>` (module-level — exports like `routes`
	// or `setupApp`) and `<script setup>` (component-scoped). Both can pull
	// in further .vue components or helpers that need to be in the build
	// graph, so collect imports from both blocks even though only setupApp
	// is what runs at component creation time.
	const moduleScriptSource =
		descriptor.script?.content && descriptor.scriptSetup
			? descriptor.script.content
			: '';
	const importPaths = [
		...extractImports(scriptSource),
		...extractImports(moduleScriptSource)
	];

	// Resolve bare module imports that point to .vue files
	const resolvedPackageVueImports = new Map<string, string>();
	const bareImports = importPaths.filter(
		(p) => !p.startsWith('.') && !p.startsWith('/')
	);
	for (const importPath of bareImports) {
		const resolved = resolvePackageImport(importPath);
		if (!resolved?.endsWith('.vue')) continue;
		resolvedPackageVueImports.set(importPath, resolved);
	}

	const childComponentPaths = importPaths.filter(
		(path) => path.startsWith('.') && path.endsWith('.vue')
	);
	const packageComponentPaths = Array.from(
		resolvedPackageVueImports.entries()
	);
	// Helper modules are TS/JS imports that need to be transpiled and copied
	// alongside the component (e.g. shared utilities). Style imports including
	// CSS modules (.module.scss / .module.less / .module.styl / .module.css)
	// are handled by the bun-side style preprocessor plugin and must not be
	// treated as TS helpers — otherwise we'd try to read the source as a `.ts`
	// file and crash at build time.
	const helperModulePaths = importPaths.filter(
		(path) =>
			path.startsWith('.') && !path.endsWith('.vue') && !isStylePath(path)
	);

	// Record JS → CSS-module imports for HMR dep tracking. When a Vue
	// component imports a `.module.scss`, an edit to that style file
	// has to invalidate the importing component's bundle so the new
	// hashed class names land in the served output.
	const stylePathsImported = importPaths
		.filter(
			(path) =>
				(path.startsWith('.') || isAbsolute(path)) && isStylePath(path)
		)
		.map((path) =>
			isAbsolute(path) ? path : resolve(dirname(sourceFilePath), path)
		);
	for (const stylePath of stylePathsImported) {
		addStyleImporter(sourceFilePath, stylePath);
	}

	const childBuildResults: BuildResult[] = await Promise.all([
		...childComponentPaths.map((relativeChildPath) =>
			compileVueFile(
				resolve(dirname(sourceFilePath), relativeChildPath),
				outputDirs,
				cacheMap,
				false,
				vueRootDir,
				compiler,
				runSfc,
				stylePreprocessors
			)
		),
		...packageComponentPaths.map(([, absolutePath]) =>
			compileVueFile(
				absolutePath,
				outputDirs,
				cacheMap,
				false,
				vueRootDir,
				compiler,
				runSfc,
				stylePreprocessors
			)
		)
	]);

	// Restart-surviving cache lookup. Runs AFTER the child recursion so the
	// key can fold in every child's key — a child edit invalidates all of
	// its ancestors, exactly like a fresh compile would re-emit them. All
	// in-memory side effects (HMR metadata, style importers) were already
	// applied above, so a hit only has to re-materialise the outputs.
	const cacheKeyStartedAt = performance.now();
	const cacheKey = computeVueCompileCacheKey({
		childResults: childBuildResults,
		contentHash,
		descriptor,
		fingerprint: currentVueCompileFingerprint(
			compiler,
			outputDirs,
			vueRootDir,
			stylePreprocessors
		),
		isEntryPoint,
		relativeWithoutExtension
	});
	const restored = cacheKey
		? readVueCompileCacheEntry(sourceFilePath, cacheKey)
		: undefined;
	vueCompileProfile.keyMs += performance.now() - cacheKeyStartedAt;
	if (cacheKey) {
		if (restored) {
			vueCompileProfile.diskHits += 1;
			const result = await timed('materialiseMs', () =>
				materialiseVueCompileCacheEntry(
					restored,
					cacheKey,
					isEntryPoint,
					outputDirs,
					fileBaseName
				)
			);
			cacheMap.set(sourceFilePath, result);
			persistentBuildCache.set(sourceFilePath, result);

			return result;
		}
	}

	const clientOutputPath = join(
		outputDirs.client,
		`${relativeWithoutExtension}.js`
	);
	const serverOutputPath = join(
		outputDirs.server,
		`${relativeWithoutExtension}.js`
	);

	// Preprocessor `<style lang>` blocks compile here, not on a worker:
	// `compileStyleSource` records the partials it read on the dev
	// server's style dependency graph, and its config may hold functions
	// (custom sass importers) that cannot cross a thread boundary.
	const styleSources = await Promise.all(
		descriptor.styles.map((styleBlock) =>
			styleBlock.lang
				? compileStyleSource(
						sourceFilePath,
						styleBlock.content,
						styleBlock.lang,
						stylePreprocessors
					)
				: Promise.resolve(styleBlock.content)
		)
	);

	// Bare module .vue imports → compiled output paths. The package
	// children follow the relative children in `childBuildResults`.
	const packageImportRewrites: VueSfcCompileInput['packageImportRewrites'] =
		[];
	packageComponentPaths.forEach(([bareImport], index) => {
		const childResult =
			childBuildResults[childComponentPaths.length + index];
		if (!childResult) return;
		packageImportRewrites.push([
			bareImport,
			{ client: childResult.clientPath, server: childResult.serverPath }
		]);
	});

	vueCompileProfile.compiles += 1;
	const { clientOutput, localCss, serverOutput, typeDepHashes } =
		await timed('sfcMs', () =>
			runSfc({
				clientOutputPath,
				componentId,
				hmrId,
				packageImportRewrites,
				serverOutputPath,
				sourceContent,
				sourceFilePath,
				styleSources
			})
		);

	const allCss = [
		...localCss,
		...childBuildResults.flatMap((result) => result.cssCodes)
	];

	const cssOutputFile =
		isEntryPoint && allCss.length
			? join(outputDirs.css, `${toKebab(fileBaseName)}-compiled.css`)
			: null;
	const cssOutputPaths = cssOutputFile ? [cssOutputFile] : [];
	trackWrite(
		writeVueOutputs({
			clientCode: clientOutput,
			clientPath: clientOutputPath,
			css: cssOutputFile
				? { code: allCss.join('\n'), path: cssOutputFile }
				: null,
			serverCode: serverOutput,
			serverPath: serverOutputPath
		})
	);

	const cacheableResult: VueCompileCacheEntry['result'] = {
		clientPath: clientOutputPath,
		cssCodes: allCss,
		cssPaths: cssOutputPaths,
		hmrId,
		serverPath: serverOutputPath,
		spaRoutes: spaRoutes.length > 0 ? spaRoutes : undefined,
		tsHelperPaths: [
			...helperModulePaths.map((helper) =>
				resolveHelperTsPath(dirname(sourceFilePath), helper)
			),
			...childBuildResults.flatMap((child) => child.tsHelperPaths)
		]
	};
	const result: BuildResult = { ...cacheableResult, cacheKey };

	cacheMap.set(sourceFilePath, result);
	persistentBuildCache.set(sourceFilePath, result);
	if (cacheKey) {
		trackWrite(
			writeVueCompileCacheEntry(sourceFilePath, {
				clientCode: clientOutput,
				key: cacheKey,
				result: cacheableResult,
				serverCode: serverOutput,
				typeDeps: typeDepHashes
			})
		);
	}

	return result;
};

export const compileVue = async (
	entryPoints: string[],
	vueRootDir: string,
	isDev = false,
	stylePreprocessors?: StylePreprocessorConfig,
	ssrOnlyEntries?: ReadonlySet<string>
) => {
	const compileStartedAt = performance.now();
	vueCompileProfile = newVueCompileProfile();
	const runSfc = selectSfcRunner(entryPoints.length);
	const compilerLoadStartedAt = performance.now();
	const compiler: VueCompiler = await loadVueCompiler();
	const compilerLoadMs = performance.now() - compilerLoadStartedAt;
	vueCompileProfile.stageCompilerMs = compilerLoadMs;

	// Generated output lives at <projectRoot>/.absolutejs/generated/vue/.
	// See `src/utils/generatedDir.ts` for rationale (keeps `src/` clean).
	const generatedDir = getFrameworkGeneratedDir('vue');
	const clientOutputDir = join(generatedDir, 'client');
	const indexOutputDir = join(generatedDir, 'indexes');
	const serverOutputDir = join(generatedDir, 'server');
	const cssOutputDir = join(generatedDir, 'compiled');

	await Promise.all([
		mkdir(clientOutputDir, { recursive: true }),
		mkdir(indexOutputDir, { recursive: true }),
		mkdir(serverOutputDir, { recursive: true }),
		mkdir(cssOutputDir, { recursive: true })
	]);

	const buildCache: CompileMemo = new Map();
	const allTsHelperPaths = new Set<string>();

	// SPA entries lazily import sibling route pages (`component: () =>
	// import('./Child.vue')`), and their compiled intermediates reference the
	// children's intermediates (`./Child.js`) — so the children MUST compile
	// in the same pass. Full builds get this for free (every page is an
	// entry); the dev bundle rebuild passes only the changed subset, and
	// without this expansion bundling the shell fails with "Could not
	// resolve ./Child.js" and the served bundles silently stay stale.
	const expandSpaRouteChildren = async (entries: string[]) => {
		const expanded = new Set(entries.map((entry) => resolve(entry)));
		const queue = [...expanded];
		while (queue.length > 0) {
			const entryPath = queue.pop();
			if (!entryPath) continue;
			let source: string;
			try {
				source = await file(entryPath).text();
			} catch {
				continue;
			}
			const { descriptor } = compiler.parse(source, {
				filename: entryPath
			});
			const routes = parseVueSpaRoutes(descriptor.script?.content ?? '');
			for (const { importPath } of routes) {
				const childPath = resolve(dirname(entryPath), importPath);
				if (expanded.has(childPath) || !existsSync(childPath)) {
					continue;
				}
				expanded.add(childPath);
				queue.push(childPath);
			}
		}

		return [...expanded];
	};
	let stageStartedAt = performance.now();
	const expandedEntryPoints = await expandSpaRouteChildren(entryPoints);
	vueCompileProfile.stageExpandMs = performance.now() - stageStartedAt;

	stageStartedAt = performance.now();

	const compiledPages = await Promise.all(
		expandedEntryPoints.map(async (entryPath) => {
			const resolvedEntryPath = resolve(entryPath);
			const result = await compileVueFile(
				resolvedEntryPath,
				{
					client: clientOutputDir,
					css: cssOutputDir,
					server: serverOutputDir
				},
				buildCache,
				true,
				vueRootDir,
				compiler,
				runSfc,
				stylePreprocessors
			);

			result.tsHelperPaths.forEach((path) => allTsHelperPaths.add(path));

			// SSR-only entries (flagged `client: 'none'` at registration
			// time, see `scanVueSsrOnlyPages`) skip the per-page client
			// hydration index entirely — no `<script type="module">`
			// ships, no manifest entry, no bundler work for the client
			// path. The server bundle and per-page CSS still emit so the
			// SSR handler can render the page.
			if (ssrOnlyEntries?.has(resolvedEntryPath)) {
				return {
					clientPath: null,
					cssPaths: result.cssPaths,
					indexPath: null,
					serverPath: result.serverPath,
					sourcePath: resolvedEntryPath,
					spaRoutes: result.spaRoutes
				};
			}

			const entryBaseName = basename(entryPath, '.vue');
			const indexOutputFile = join(indexOutputDir, `${entryBaseName}.js`);
			const clientOutputFile = join(
				clientOutputDir,
				relative(vueRootDir, entryPath)
					.replace(/\\/g, '/')
					.replace(/\.vue$/, '.js')
			);

			await mkdir(dirname(indexOutputFile), { recursive: true });
			const vueHmrImports = isDev
				? [
						`window.__HMR_FRAMEWORK__ = "vue";`,
						`import "${hmrClientPath}";`
					]
				: [];
			await write(
				indexOutputFile,
				[
					...vueHmrImports,
					`import Comp, * as PageModule from "${relative(dirname(indexOutputFile), clientOutputFile).replace(/\\/g, '/')}";`,
					'import { createSSRApp, createApp } from "vue";',
					'import { prepareBrowserTranslationHydration } from "@absolutejs/absolute/vue";',
					'',
					'// HMR State Preservation: Check for preserved state from HMR',
					'let preservedState = (typeof window !== "undefined" && window.__HMR_PRESERVED_STATE__) ? window.__HMR_PRESERVED_STATE__ : {};',
					'',
					'// Fallback: check sessionStorage if window state is empty (only during active HMR, not full page refresh)',
					'if (typeof window !== "undefined" && Object.keys(preservedState).length === 0 && sessionStorage.getItem("__HMR_ACTIVE__")) {',
					'  try {',
					'    const stored = sessionStorage.getItem("__VUE_HMR_STATE__");',
					'    if (stored) {',
					'      preservedState = JSON.parse(stored);',
					'      sessionStorage.removeItem("__VUE_HMR_STATE__");',
					'    }',
					'  } catch (e) {}',
					'}',
					'// Clean up stale HMR state on full page refresh',
					'if (typeof window !== "undefined" && !sessionStorage.getItem("__HMR_ACTIVE__")) {',
					'  sessionStorage.removeItem("__VUE_HMR_STATE__");',
					'}',
					'',
					'const initialProps = window.__INITIAL_PROPS__ ?? {};',
					'// Only merge preserved state keys that match declared props (avoids passing refs/components as attributes)',
					'const mergedProps = { ...initialProps };',
					'Object.keys(preservedState).forEach(function(key) {',
					'  if (key in initialProps) {',
					'    mergedProps[key] = preservedState[key];',
					'  }',
					'});',
					'',
					"// `setupApp` hook. Reflect.get hides the lookup from Bun's",
					"// static analyzer so non-SPA pages without it don't trigger",
					'// "always undefined" warnings. Pages that export `routes`',
					'// have their setupApp auto-synthesized at compile time by',
					'// compileVue (see addAutoRouterSetupApp below) — that wrapper',
					"// uses the page-bundle's own vue-router instance so",
					'// provide/inject symbols match between the router and the',
					"// page's `useRoute()` calls.",
					'const setupAppHook = Reflect.get(PageModule, "setupApp");',
					'const hasSpaRoutes = Array.isArray(Reflect.get(PageModule, "routes"));',
					'',
					'// During HMR, after SSR dirty, or for routed SPA shells, use',
					'// createApp (fresh mount) to avoid hydration attaching event',
					'// listeners to stale SSR nodes. The router still handles',
					'// client-side navigation after mount.',
					'const isHMR = typeof window !== "undefined" && sessionStorage.getItem("__HMR_ACTIVE__");',
					'const isSsrDirty = typeof window !== "undefined" && window.__SSR_DIRTY__;',
					'const isClientRender = typeof window !== "undefined" && window.__ABSOLUTE_PAGE_RENDER_MODE__ === "client";',
					'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || hasSpaRoutes || isClientRender);',
					'const app = shouldHydrate ? createSSRApp(Comp, mergedProps) : createApp(Comp, mergedProps);',
					'',
					'async function bootstrapApp() {',
					'  if (typeof setupAppHook === "function") {',
					'    const clientUrl = typeof window !== "undefined"',
					'      ? window.location.pathname + window.location.search',
					'      : "/";',
					'    await setupAppHook(app, {',
					'      isServer: false,',
					'      router: null,',
					'      setNotFound: () => {},',
					'      setRedirect: () => {},',
					'      url: clientUrl',
					'    });',
					'  }',
					'  const restoreBrowserTranslation = shouldHydrate',
					'    ? prepareBrowserTranslationHydration(document.querySelector("#root"))',
					'    : () => undefined;',
					'  try {',
					'    app.mount("#root");',
					'  } finally {',
					'    restoreBrowserTranslation();',
					'  }',
					'}',
					'const absolutePageReady = bootstrapApp();',
					'',
					'// Store app instance for HMR - used for manual component updates',
					'if (typeof window !== "undefined") {',
					'  window.__VUE_APP__ = app;',
					'  window.__ABSOLUTE_PAGE_READY__ = absolutePageReady;',
					'  window.__ABSOLUTE_PAGE_DISPOSE__ = async function() {',
					'    await absolutePageReady;',
					'    app.unmount();',
					'    window.__VUE_APP__ = undefined;',
					'  };',
					'}',
					'',
					'// Post-mount: Apply preserved state to reactive refs in component tree',
					'// This restores state that lives in refs (like count) rather than props',
					'if (typeof window !== "undefined" && Object.keys(preservedState).length > 0) {',
					'  requestAnimationFrame(function() {',
					'    if (window.__VUE_APP__ && window.__VUE_APP__._instance) {',
					'      applyPreservedState(window.__VUE_APP__._instance, preservedState);',
					'    }',
					'  });',
					'}',
					'',
					'function applyPreservedState(instance, state) {',
					'  // Apply to root component setupState',
					'  if (instance.setupState) {',
					'    Object.keys(state).forEach(function(key) {',
					'      const ref = instance.setupState[key];',
					'      if (ref && typeof ref === "object" && "value" in ref) {',
					'        ref.value = state[key];',
					'      }',
					'    });',
					'  }',
					'  // Also apply to child components',
					'  if (instance.subTree) {',
					'    walkAndApply(instance.subTree, state);',
					'  }',
					'}',
					'',
					'function walkAndApply(vnode, state) {',
					'  if (!vnode) return;',
					'  if (vnode.component && vnode.component.setupState) {',
					'    Object.keys(state).forEach(function(key) {',
					'      const ref = vnode.component.setupState[key];',
					'      if (ref && typeof ref === "object" && "value" in ref) {',
					'        ref.value = state[key];',
					'      }',
					'    });',
					'  }',
					'  if (vnode.children && Array.isArray(vnode.children)) {',
					'    vnode.children.forEach(function(child) { walkAndApply(child, state); });',
					'  }',
					'  if (vnode.component && vnode.component.subTree) {',
					'    walkAndApply(vnode.component.subTree, state);',
					'  }',
					'}',
					'',
					'// Clear preserved state after applying',
					'if (typeof window !== "undefined") {',
					'  window.__ABS_SLOT_HYDRATION_PENDING__ = shouldHydrate;',
					'  var releaseStreamingSlots = function() {',
					'    window.__ABS_SLOT_HYDRATION_PENDING__ = false;',
					'    if (typeof window.__ABS_SLOT_FLUSH__ === "function") {',
					'      window.__ABS_SLOT_FLUSH__();',
					'    }',
					'  };',
					'  if (shouldHydrate && typeof requestAnimationFrame === "function") {',
					'    requestAnimationFrame(function() {',
					'      requestAnimationFrame(releaseStreamingSlots);',
					'    });',
					'  } else if (typeof window.__ABS_SLOT_FLUSH__ === "function") {',
					'    window.__ABS_SLOT_FLUSH__();',
					'  } else if (typeof setTimeout === "function") {',
					'    setTimeout(releaseStreamingSlots, 0);',
					'  }',
					'}',
					'if (typeof window !== "undefined") {',
					'  window.__HMR_PRESERVED_STATE__ = undefined;',
					'}'
				].join('\n')
			);

			return {
				clientPath: clientOutputFile,
				cssPaths: result.cssPaths,
				indexPath: indexOutputFile,
				serverPath: result.serverPath,
				sourcePath: resolvedEntryPath,
				spaRoutes: result.spaRoutes
			};
		})
	);

	vueCompileProfile.stagePagesMs = performance.now() - stageStartedAt;
	stageStartedAt = performance.now();

	// Recursively trace .ts helpers. Helpers can import other helpers
	// (e.g. `state/index.ts` re-exports `./auth`, `./profile`), and those
	// transitive dependencies need to be transpiled + copied too so their
	// relative `import "./auth"` resolves in the generated tree.
	// Breadth-first in waves: a helper graph is hundreds of files wide on
	// a real app and reading them one await at a time serialised hundreds
	// of filesystem round trips into the critical path.
	const helperDependencies = (tsPath: string, sourceCode: string) =>
		extractImports(sourceCode)
			.filter(
				(dep) =>
					dep.startsWith('.') &&
					!isStylePath(dep) &&
					!dep.endsWith('.vue')
			)
			.map((dep) => resolveHelperTsPath(dirname(tsPath), dep))
			.filter(
				(resolved) =>
					existsSync(resolved) && !allTsHelperPaths.has(resolved)
			);
	const readHelperWave = (paths: readonly string[]) =>
		Promise.all(
			paths.map((tsPath) =>
				file(tsPath)
					.text()
					.then((sourceCode) => helperDependencies(tsPath, sourceCode))
					.catch(() => [])
			)
		);
	const expandHelpers = async (
		frontier: readonly string[]
	): Promise<void> => {
		if (frontier.length === 0) return;
		const nextFrontier: string[] = [];
		for (const discovered of await readHelperWave(frontier)) {
			for (const resolved of discovered) {
				if (allTsHelperPaths.has(resolved)) continue;
				allTsHelperPaths.add(resolved);
				nextFrontier.push(resolved);
			}
		}
		await expandHelpers(nextFrontier);
	};
	await expandHelpers(Array.from(allTsHelperPaths));

	vueCompileProfile.stageHelperScanMs = performance.now() - stageStartedAt;
	vueCompileProfile.helpers = allTsHelperPaths.size;
	stageStartedAt = performance.now();

	// Transpile every helper into both generated trees. Pure per-file
	// work, so it fans out across the build worker pool exactly like the
	// SFC compiles do; `emitTsHelpers` is the same handler either way, so
	// the emitted bytes do not depend on which thread ran it.
	const helperFiles = Array.from(allTsHelperPaths).map((tsPath) => {
		const relativeJsPath = relative(vueRootDir, tsPath).replace(
			/\.ts$/,
			'.js'
		);

		return {
			clientOutputPath: join(clientOutputDir, relativeJsPath),
			serverOutputPath: join(serverOutputDir, relativeJsPath),
			sourcePath: tsPath
		};
	});
	await runHelperEmit(helperFiles);

	vueCompileProfile.stageHelperEmitMs = performance.now() - stageStartedAt;
	stageStartedAt = performance.now();

	await Promise.all(pendingWrites);
	vueCompileProfile.stageFlushMs = performance.now() - stageStartedAt;

	if (devProfileEnabled) {
		const profile = vueCompileProfile;
		console.error(
			`[profile] compileVue ${entryPoints.length} entr${
				entryPoints.length === 1 ? 'y' : 'ies'
			} → ${profile.files} SFCs (${profile.diskHits} cache hits, ` +
				`${profile.compiles} compiled, ${profile.memoHits} memo hits) in ` +
				`${Math.round(performance.now() - compileStartedAt)}ms: ` +
				`compiler load ${Math.round(compilerLoadMs)}ms, ` +
				`read ${Math.round(profile.readMs)}ms, ` +
				`parse ${Math.round(profile.parseMs)}ms, ` +
				`key+cache read ${Math.round(profile.keyMs)}ms, ` +
				`materialise ${Math.round(profile.materialiseMs)}ms, ` +
				`sfc compile ${Math.round(profile.sfcMs)}ms` +
				` | stages: compiler ${Math.round(profile.stageCompilerMs)}ms, ` +
				`expand ${Math.round(profile.stageExpandMs)}ms, ` +
				`pages ${Math.round(profile.stagePagesMs)}ms, ` +
				`helper scan ${Math.round(profile.stageHelperScanMs)}ms ` +
				`(${profile.helpers} helpers), ` +
				`helper emit ${Math.round(profile.stageHelperEmitMs)}ms, ` +
				`flush ${Math.round(profile.stageFlushMs)}ms`
		);
	}

	const isString = (value: string | null): value is string => value !== null;

	// Per-entry SPA route info keyed by the .vue source path. Consumed by
	// core/build.ts to emit per-route CSS side-manifests next to the SSR
	// JS, so the Vue page handler can inline the matched child route's
	// styles on first paint instead of waiting for the lazy JS chunk to
	// arrive.
	const vueSpaRoutesBySource = new Map<string, ParsedVueSpaRoute[]>();
	for (const page of compiledPages) {
		if (page.spaRoutes && page.spaRoutes.length > 0) {
			vueSpaRoutesBySource.set(page.sourcePath, page.spaRoutes);
		}
	}

	return {
		// Export HMR metadata from vueHmrMetadata map (populated during compilation)
		hmrMetadata: new Map(vueHmrMetadata),
		vueClientPaths: compiledPages.map((p) => p.clientPath).filter(isString),
		vueCssPaths: compiledPages.flatMap((result) => result.cssPaths),
		vueIndexPaths: compiledPages.map((p) => p.indexPath).filter(isString),
		vueServerPaths: compiledPages.map((result) => result.serverPath),
		vueSpaRoutesBySource
	};
};
