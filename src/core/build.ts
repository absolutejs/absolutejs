import { UNFOUND_INDEX } from '../constants';
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { build as bunBuild, type BuildArtifact, Glob } from 'bun';
import { generateManifest } from '../build/generateManifest';
import {
	collectIslandFrameworkSources,
	generateIslandEntryPoints,
	loadIslandRegistryBuildInfo
} from '../build/islandEntries';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { createHTMLScriptHMRPlugin } from '../build/htmlScriptHMRPlugin';
import { transformStaticPagesWithIslands } from '../build/staticIslandPages';
import { outputLogs } from '../build/outputLogs';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { scanConventions } from '../build/scanConventions';
import type {
	ConventionsMap,
	FrameworkConventionEntry
} from '../../types/conventions';
import { scanCssEntryPoints } from '../build/scanCssEntryPoints';
import {
	createStyleTransformConfig,
	createStylePreprocessorPlugin,
	isStylePath
} from '../build/stylePreprocessor';
import { compileTailwindConfig } from '../build/compileTailwind';
import { optimizeHtmlImages } from '../build/optimizeHtmlImages';
import { updateAssetPaths } from '../build/updateAssetPaths';
import { buildHMRClient } from '../dev/buildHMRClient';
import {
	patchRefreshGlobals,
	rewriteReactImports
} from '../build/rewriteReactImports';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import {
	getAngularVendorPaths,
	getDevVendorPaths,
	getSvelteVendorPaths,
	getVueVendorPaths,
	setAngularVendorPaths,
	setDevVendorPaths,
	setSvelteVendorPaths,
	setVueVendorPaths
} from './devVendorPaths';
import type {
	BuildConfig,
	BunBuildConfigOverride,
	BunBuildPassConfig,
	BunBuildPassKey
} from '../../types/build';
import { createAngularLinkerPlugin } from '../build/angularLinkerPlugin';
import { cleanStaleOutputs } from '../utils/cleanStaleOutputs';
import { cleanup } from '../utils/cleanup';
import { commonAncestor } from '../utils/commonAncestor';
import { logError, logWarn } from '../utils/logger';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';
import { validateSafePath } from '../utils/validateSafePath';

const isDev = env.NODE_ENV === 'development';

type BuildTraceEvent = {
	durationMs: number;
	metadata?: Record<string, unknown>;
	name: string;
	ok: boolean;
	startMs: number;
};

type BuildTracePhase = <T>(
	name: string,
	fn: () => Promise<T> | T,
	metadata?: Record<string, unknown>
) => Promise<T>;

const isBuildTraceEnabled = () => {
	const value = env.ABSOLUTE_BUILD_TRACE?.toLowerCase();

	return value === '1' || value === 'true' || value === 'yes';
};

const collectConventionSourceFiles = (
	entry: FrameworkConventionEntry | undefined
) => {
	if (!entry) return [];
	const files: string[] = [];
	if (entry.defaults?.error) files.push(entry.defaults.error);
	if (entry.defaults?.loading) files.push(entry.defaults.loading);
	if (entry.defaults?.notFound) files.push(entry.defaults.notFound);
	if (!entry.pages) return files;
	for (const page of Object.values(entry.pages)) {
		if (page.error) files.push(page.error);
		if (page.loading) files.push(page.loading);
	}

	return files;
};

const updateConventionCompiledPaths = (
	entry: FrameworkConventionEntry | undefined,
	sourcePaths: string[],
	compiledPaths: string[]
) => {
	if (!entry || sourcePaths.length !== compiledPaths.length) return;
	const pathMap = new Map<string, string>();
	for (let idx = 0; idx < sourcePaths.length; idx++) {
		const src = sourcePaths[idx];
		const compiled = compiledPaths[idx];
		if (src && compiled) pathMap.set(src, compiled);
	}

	if (entry.defaults) {
		const errorPath = entry.defaults.error
			? pathMap.get(entry.defaults.error)
			: undefined;
		if (errorPath) entry.defaults.error = errorPath;

		const loadingPath = entry.defaults.loading
			? pathMap.get(entry.defaults.loading)
			: undefined;
		if (loadingPath) entry.defaults.loading = loadingPath;

		const notFoundPath = entry.defaults.notFound
			? pathMap.get(entry.defaults.notFound)
			: undefined;
		if (notFoundPath) entry.defaults.notFound = notFoundPath;
	}
	if (!entry.pages) return;
	for (const page of Object.values(entry.pages)) {
		const errorPath = page.error ? pathMap.get(page.error) : undefined;
		if (errorPath) page.error = errorPath;

		const loadingPath = page.loading
			? pathMap.get(page.loading)
			: undefined;
		if (loadingPath) page.loading = loadingPath;
	}
};

const extractBuildError = (
	logs: (BuildMessage | ResolveMessage)[],
	pass: string,
	label: string,
	frameworkNames: string[],
	isIncremental: boolean | 0 | undefined,
	throwOnError: boolean
) => {
	const errLog = logs.find((log) => log.level === 'error') ?? logs[0];
	if (!errLog) {
		exit(1);

		return;
	}
	const err = new Error(
		typeof errLog.message === 'string'
			? errLog.message
			: String(errLog.message)
	);
	Object.assign(err, { logs });
	sendTelemetryEvent('build:error', {
		frameworks: frameworkNames,
		incremental: Boolean(isIncremental),
		message: err.message,
		pass
	});
	logError(`${label} build failed`, err);
	if (throwOnError) throw err;
	exit(1);
};

const copyHtmxVendor = (htmxDir: string, htmxDestDir: string) => {
	mkdirSync(htmxDestDir, { recursive: true });
	const glob = new Glob('htmx*.min.js');
	for (const relPath of glob.scanSync({ cwd: htmxDir })) {
		const src = join(htmxDir, relPath);
		const dest = join(htmxDestDir, 'htmx.min.js');
		copyFileSync(src, dest);

		return;
	}
};

const tryReadPackageJson = async (path: string) => {
	try {
		return await Bun.file(path).json();
	} catch {
		return null;
	}
};

const resolveAbsoluteVersion = async () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	const resolveCandidate = async (remaining: string[]) => {
		const [candidate, ...rest] = remaining;
		if (!candidate) {
			return;
		}

		const pkg = await tryReadPackageJson(candidate);
		if (!pkg || pkg.name !== '@absolutejs/absolute') {
			await resolveCandidate(rest);

			return;
		}

		globalThis.__absoluteVersion = pkg.version;
	};

	await resolveCandidate(candidates);
};

/** Scan source directories for files referenced by new URL('./path', import.meta.url) */
const SKIP_DIRS = new Set([
	'build',
	'node_modules',
	'.absolutejs',
	'generated'
]);
const addWorkerPathIfExists = (
	file: string,
	relPath: string,
	workerPaths: Set<string>
) => {
	const absPath = resolve(file, '..', relPath);
	try {
		statSync(absPath);
		workerPaths.add(absPath);
	} catch {
		// Referenced file doesn't exist, skip
	}
};

const collectWorkerPathsFromContent = (
	content: string,
	pattern: RegExp,
	file: string,
	workerPaths: Set<string>
) => {
	pattern.lastIndex = 0;
	let match;
	while ((match = pattern.exec(content)) !== null) {
		const [, relPath] = match;
		if (!relPath) continue;
		addWorkerPathIfExists(file, relPath, workerPaths);
	}
};

const collectWorkerPathsFromFile = (
	file: string,
	patterns: RegExp[],
	workerPaths: Set<string>
) => {
	const content = readFileSync(file, 'utf-8');
	for (const pattern of patterns) {
		collectWorkerPathsFromContent(content, pattern, file, workerPaths);
	}
};

const scanWorkerReferencesInDir = async (
	dir: string,
	patterns: RegExp[],
	workerPaths: Set<string>
) => {
	const glob = new Glob('**/*.{ts,tsx,js,jsx,svelte,vue}');
	for await (const file of glob.scan({ absolute: true, cwd: dir })) {
		// Skip build-generated directories
		const relToDir = file.slice(dir.length + 1);
		const [firstSegment] = relToDir.split('/');
		if (firstSegment && SKIP_DIRS.has(firstSegment)) continue;

		collectWorkerPathsFromFile(file, patterns, workerPaths);
	}
};

const scanWorkerReferences = async (dirs: string[]) => {
	const urlPattern =
		/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
	const resolvePattern =
		/import\.meta\.resolve\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
	const workerPaths = new Set<string>();

	await Promise.all(
		dirs.map((dir) =>
			scanWorkerReferencesInDir(
				dir,
				[urlPattern, resolvePattern],
				workerPaths
			)
		)
	);

	return [...workerPaths];
};

const copyDevIndexes = async ({
	buildPath,
	reactIndexesPath,
	reactPagesPath,
	svelteDir,
	svelteEntries,
	sveltePagesPath,
	vueDir,
	vueEntries,
	vuePagesPath
}: {
	buildPath: string;
	reactIndexesPath: string | false | undefined;
	reactPagesPath: string | false | undefined;
	svelteDir: string | false | undefined;
	svelteEntries: string[];
	sveltePagesPath: string | false | undefined;
	vueDir: string | false | undefined;
	vueEntries: string[];
	vuePagesPath: string | false | undefined;
}) => {
	const { readdirSync: readDir } = await import('node:fs');
	const devIndexDir = join(buildPath, '_src_indexes');
	mkdirSync(devIndexDir, { recursive: true });

	if (reactIndexesPath && reactPagesPath) {
		copyReactDevIndexes(
			reactIndexesPath,
			reactPagesPath,
			devIndexDir,
			readDir
		);
	}

	if (svelteDir && sveltePagesPath) {
		copySvelteDevIndexes(
			svelteDir,
			sveltePagesPath,
			svelteEntries,
			devIndexDir
		);
	}

	if (vueDir && vuePagesPath) {
		copyVueDevIndexes(vueDir, vuePagesPath, vueEntries, devIndexDir);
	}
};

const copyReactDevIndexes = (
	reactIndexesPath: string,
	reactPagesPath: string,
	devIndexDir: string,
	readDir: (path: string) => string[]
) => {
	if (!existsSync(reactIndexesPath)) {
		return;
	}

	const indexFiles = readDir(reactIndexesPath).filter((file: string) =>
		file.endsWith('.tsx')
	);
	const pagesRel = relative(process.cwd(), resolve(reactPagesPath)).replace(
		/\\/g,
		'/'
	);

	for (const file of indexFiles) {
		let content = readFileSync(join(reactIndexesPath, file), 'utf-8');
		content = content.replace(
			/from\s*['"]([^'"]*\/pages\/([^'"]+))['"]/g,
			(_match, _fullPath, componentName) =>
				`from '/@src/${pagesRel}/${componentName}'`
		);
		writeFileSync(join(devIndexDir, file), content);
	}
};

const copySvelteDevIndexes = (
	svelteDir: string,
	sveltePagesPath: string,
	svelteEntries: string[],
	devIndexDir: string
) => {
	const svelteIndexDir = join(svelteDir, 'generated', 'indexes');
	const sveltePageEntries = svelteEntries.filter((file) =>
		resolve(file).startsWith(resolve(sveltePagesPath))
	);
	for (const entry of sveltePageEntries) {
		const name = basename(entry).replace(/\.svelte(\.(ts|js))?$/, '');
		const indexFile = join(svelteIndexDir, 'pages', `${name}.js`);
		if (!existsSync(indexFile)) continue;
		let content = readFileSync(indexFile, 'utf-8');
		const srcRel = relative(process.cwd(), resolve(entry)).replace(
			/\\/g,
			'/'
		);
		content = content.replace(
			/import\s+Component\s+from\s+['"]([^'"]+)['"]/,
			`import Component from "/@src/${srcRel}"`
		);
		writeFileSync(join(devIndexDir, `${name}.svelte.js`), content);
	}
};

const copyVueDevIndexes = (
	vueDir: string,
	vuePagesPath: string,
	vueEntries: string[],
	devIndexDir: string
) => {
	const vueIndexDir = join(vueDir, 'generated', 'indexes');
	const vuePageEntries = vueEntries.filter((file) =>
		resolve(file).startsWith(resolve(vuePagesPath))
	);
	for (const entry of vuePageEntries) {
		const name = basename(entry, '.vue');
		const indexFile = join(vueIndexDir, `${name}.js`);
		if (!existsSync(indexFile)) continue;
		let content = readFileSync(indexFile, 'utf-8');
		const srcRel = relative(process.cwd(), resolve(entry)).replace(
			/\\/g,
			'/'
		);
		content = content.replace(
			/import\s+Comp\s+from\s+['"]([^'"]+)['"]/,
			`import Comp from "/@src/${srcRel}"`
		);
		writeFileSync(join(devIndexDir, `${name}.vue.js`), content);
	}
};

const resolveVueRuntimeId = (
	content: string,
	firstUseName: string,
	outputPath: string,
	projectRoot: string
) => {
	const varIdx = content.indexOf(`var ${firstUseName} =`);
	if (varIdx <= 0) return JSON.stringify(outputPath);
	// Find all // src/...js comments before the var declaration
	const before = content.slice(0, varIdx);
	const allComments = [...before.matchAll(/\/\/\s*(src\/[^\n]*\.js)\s*\n/g)];
	// Use the last one (closest to the var declaration)
	const last = allComments[allComments.length - 1];
	if (!last?.[1]) return JSON.stringify(outputPath);
	const srcPath = resolve(
		projectRoot,
		last[1].replace('/client/', '/').replace(/\.js$/, '.ts')
	);

	return JSON.stringify(srcPath);
};

const QUOTE_CHARS = new Set(['"', "'", '`']);
const OPEN_BRACES = new Set(['{', '(']);
const CLOSE_BRACES = new Set(['}', ')']);

const findFunctionExpressionEnd = (content: string, startPos: number) => {
	let depth = 0;
	let inStr: string | false = false;
	for (let i = startPos; i < content.length; i++) {
		const char = content[i] ?? '';
		if (inStr && char === inStr && content[i - 1] !== '\\') inStr = false;
		if (inStr) continue;
		if (QUOTE_CHARS.has(char)) inStr = char;
		if (QUOTE_CHARS.has(char)) continue;
		if (OPEN_BRACES.has(char)) depth++;
		if (CLOSE_BRACES.has(char)) depth--;
		if (depth === 0 && char === ';') return i;
	}

	return startPos;
};

const wrapUseFunctions = (content: string, useNames: string[]) => {
	let result = content;
	for (const name of useNames) {
		const marker = `var ${name} = `;
		const pos = result.indexOf(marker);
		if (pos === UNFOUND_INDEX) continue;
		const afterMarker = pos + marker.length;
		const endPos = findFunctionExpressionEnd(result, afterMarker);
		const funcBody = result.slice(afterMarker, endPos);
		result = `${result.slice(0, afterMarker)}__hmr_wrap(${JSON.stringify(name)}, ${funcBody})${result.slice(endPos)}`;
	}

	return result;
};

const VUE_HMR_RUNTIME = [
	`var __hmr_cs=(globalThis.__HMR_COMPOSABLE_STATE__??={});`,
	`var __hmr_mid=__HMR_MID__;`,
	`var __hmr_prev_refs=__hmr_cs[__hmr_mid];`,
	`var __hmr_idx={};`,
	`__hmr_cs[__hmr_mid]={};`,
	`function __hmr_wrap(n,fn){return function(){`,
	`var i=(__hmr_idx[n]=(__hmr_idx[n]??-1)+1);`,
	`var r=fn.apply(this,arguments);`,
	`if(r&&typeof r==="object"){`,
	`var refs={};for(var k in r){var v=r[k];`,
	`if(v&&typeof v==="object"&&"value"in v&&!v.effect&&typeof v.value!=="function")refs[k]=v;}`,
	`(__hmr_cs[__hmr_mid][n]??=[])[i]=refs;`,
	`if(__hmr_prev_refs&&__hmr_prev_refs[n]&&__hmr_prev_refs[n][i]){`,
	`var old=__hmr_prev_refs[n][i];`,
	`for(var k in old){var nv=r[k],ov=old[k];`,
	`if(nv&&ov&&typeof nv==="object"&&"value"in nv&&!nv.effect&&typeof nv.value===typeof ov.value)nv.value=ov.value;}`,
	`}}return r;};}`
].join('');

const injectVueComposableTracking = (
	outputPath: string,
	projectRoot: string
) => {
	let content = readFileSync(outputPath, 'utf-8');
	// Find `var useXxx = (` patterns and the source file comment above them
	const usePattern = /^var\s+(use[A-Z]\w*)\s*=/gm;
	const useNames: string[] = [];
	let match;
	while ((match = usePattern.exec(content)) !== null) {
		if (match[1]) useNames.push(match[1]);
	}
	if (useNames.length === 0) return;

	const [firstUseName] = useNames;
	if (!firstUseName) return;

	const runtimeId = resolveVueRuntimeId(
		content,
		firstUseName,
		outputPath,
		projectRoot
	);
	const runtime = VUE_HMR_RUNTIME.replace('__HMR_MID__', runtimeId);

	// Insert runtime before the first use* function
	const firstUseIdx = content.indexOf(`var ${firstUseName} =`);
	if (firstUseIdx === UNFOUND_INDEX) return;
	content = `${content.slice(0, firstUseIdx) + runtime}\n${content.slice(firstUseIdx)}`;

	content = wrapUseFunctions(content, useNames);
	writeFileSync(outputPath, content);
};

const buildDevUrlFileMap = (
	urlReferencedFiles: string[],
	projectRoot: string
) => {
	const urlFileMap = new Map<string, string>();
	for (const srcPath of urlReferencedFiles) {
		const rel = relative(projectRoot, srcPath).replace(/\\/g, '/');
		const name = basename(srcPath);
		const mtime = Math.round(statSync(srcPath).mtimeMs);
		const url = `/@src/${rel}?v=${mtime}`;
		urlFileMap.set(name, url);
		// Also map .js variant for when Bun rewrites .ts → .js
		urlFileMap.set(name.replace(/\.tsx?$/, '.js'), url);
	}

	return urlFileMap;
};

const buildProdUrlFileMap = (
	urlReferencedFiles: string[],
	buildPath: string,
	nonReactClientOutputs: BuildArtifact[]
) => {
	const urlFileMap = new Map<string, string>();
	for (const srcPath of urlReferencedFiles) {
		const srcBase = basename(srcPath).replace(/\.[^.]+$/, '');
		const output = nonReactClientOutputs.find((artifact) =>
			basename(artifact.path).startsWith(`${srcBase}.`)
		);
		if (!output) continue;
		urlFileMap.set(
			basename(srcPath),
			`/${relative(buildPath, output.path).replace(/\\/g, '/')}`
		);
	}

	return urlFileMap;
};

const buildUrlFileMap = (
	urlReferencedFiles: string[],
	hmr: boolean,
	projectRoot: string,
	buildPath: string,
	nonReactClientOutputs: BuildArtifact[]
) => {
	if (hmr) return buildDevUrlFileMap(urlReferencedFiles, projectRoot);

	return buildProdUrlFileMap(
		urlReferencedFiles,
		buildPath,
		nonReactClientOutputs
	);
};

const rewriteUrlReferences = (
	outputPaths: string[],
	urlFileMap: Map<string, string>
) => {
	const urlPattern =
		/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
	for (const outputPath of outputPaths) {
		let content = readFileSync(outputPath, 'utf-8');
		let changed = false;
		content = content.replace(urlPattern, (_match, relPath) => {
			const targetName = basename(relPath);
			const resolvedPath = urlFileMap.get(targetName);
			if (!resolvedPath) return _match;
			changed = true;

			return `new URL('${resolvedPath}', import.meta.url)`;
		});
		if (changed) writeFileSync(outputPath, content);
	}
};

const vueFeatureFlags: Record<string, string> = {
	__VUE_OPTIONS_API__: 'true',
	__VUE_PROD_DEVTOOLS__: isDev ? 'true' : 'false',
	__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: isDev ? 'true' : 'false'
};

const bunBuildPassKeys: BunBuildPassKey[] = [
	'server',
	'reactClient',
	'nonReactClient',
	'islandClient',
	'globalCss',
	'vueCss'
];
const bunBuildPassKeySet = new Set<string>(['default', ...bunBuildPassKeys]);
const reservedBunBuildConfigKeys = new Set<string>([
	'entrypoints',
	'outdir',
	'outfile',
	'root',
	'target',
	'format',
	'throw',
	'compile'
]);

type BunBuildOptions = Parameters<typeof bunBuild>[0];

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isBunBuildPassConfig = (
	config: BuildConfig['bunBuild']
): config is BunBuildPassConfig =>
	isObject(config) &&
	Object.keys(config).some((key) => bunBuildPassKeySet.has(key));

const sanitizeBunBuildOverride = (
	override: BunBuildConfigOverride | undefined
): BunBuildConfigOverride => {
	if (!override) return {};
	const sanitized: Record<string, unknown> = { ...override };
	for (const key of reservedBunBuildConfigKeys) {
		delete sanitized[key];
	}

	return sanitized as BunBuildConfigOverride;
};

export const resolveBunBuildOverride = (
	config: BuildConfig['bunBuild'],
	pass: BunBuildPassKey
): BunBuildConfigOverride => {
	if (!config) return {};
	if (!isBunBuildPassConfig(config)) {
		return sanitizeBunBuildOverride(config);
	}

	return sanitizeBunBuildOverride({
		...(config.default ?? {}),
		...(config[pass] ?? {})
	});
};

const dedupe = <T>(values: T[]) => [...new Set(values)];

export const mergeBunBuildConfig = (
	base: BunBuildOptions,
	override: BunBuildConfigOverride
): BunBuildOptions => {
	const sanitized = sanitizeBunBuildOverride(override);
	const merged = {
		...base,
		...sanitized
	} as BunBuildOptions;

	return {
		...merged,
		define:
			base.define || sanitized.define
				? {
						...(sanitized.define ?? {}),
						...(base.define ?? {})
					}
				: undefined,
		external: dedupe([
			...(base.external ?? []),
			...(sanitized.external ?? [])
		]),
		plugins: [...(base.plugins ?? []), ...(sanitized.plugins ?? [])]
	} as BunBuildOptions;
};

export const build = async ({
	buildDirectory = 'build',
	assetsDirectory,
	publicDirectory,
	islands,
	reactDirectory,
	htmlDirectory,
	htmxDirectory,
	angularDirectory,
	svelteDirectory,
	vueDirectory,
	stylesConfig,
	stylePreprocessors,
	postcss,
	tailwind,
	bunBuild: bunBuildConfig,
	options,
	incrementalFiles,
	mode
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();
	const traceEnabled = isBuildTraceEnabled();
	const traceEvents: BuildTraceEvent[] = [];
	let traceFrameworkNames: string[] = [];
	const traceGlobal = globalThis as typeof globalThis & {
		__absoluteBuildTracePhase?: BuildTracePhase;
	};
	const previousTracePhase = traceGlobal.__absoluteBuildTracePhase;
	const restoreTracePhase = () => {
		if (previousTracePhase) {
			traceGlobal.__absoluteBuildTracePhase = previousTracePhase;
		} else {
			delete traceGlobal.__absoluteBuildTracePhase;
		}
	};
	const tracePhase: BuildTracePhase = async <T>(
		name: string,
		fn: () => Promise<T> | T,
		metadata?: Record<string, unknown>
	): Promise<T> => {
		if (!traceEnabled) return await fn();
		const phaseStart = performance.now();
		try {
			const result = await fn();
			traceEvents.push({
				durationMs: performance.now() - phaseStart,
				metadata,
				name,
				ok: true,
				startMs: phaseStart - buildStart
			});

			return result;
		} catch (error) {
			traceEvents.push({
				durationMs: performance.now() - phaseStart,
				metadata: {
					...metadata,
					error:
						error instanceof Error ? error.message : String(error)
				},
				name,
				ok: false,
				startMs: phaseStart - buildStart
			});
			throw error;
		}
	};
	if (traceEnabled) {
		traceGlobal.__absoluteBuildTracePhase = tracePhase;
	}
	const writeBuildTrace = (buildPath: string) => {
		if (!traceEnabled) {
			restoreTracePhase();

			return;
		}
		const traceDir = join(buildPath, '.absolute-trace');
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		mkdirSync(traceDir, { recursive: true });
		writeFileSync(
			join(traceDir, `build-trace-${timestamp}.json`),
			JSON.stringify(
				{
					events: traceEvents,
					frameworks: traceFrameworkNames,
					generatedAt: new Date().toISOString(),
					mode: mode ?? (isDev ? 'development' : 'production'),
					totalDurationMs: performance.now() - buildStart,
					version: 1
				},
				null,
				2
			)
		);
		restoreTracePhase();
	};

	await tracePhase('absolute/version', () => resolveAbsoluteVersion());
	const isIncremental = incrementalFiles && incrementalFiles.length > 0;
	const styleTransformConfig = createStyleTransformConfig(
		stylePreprocessors,
		postcss
	);
	const stylePreprocessorPlugin =
		createStylePreprocessorPlugin(styleTransformConfig);

	// Normalize incrementalFiles for consistent cross-platform path checking
	const normalizedIncrementalFiles = incrementalFiles?.map(normalizePath);

	const throwOnError = options?.throwOnError === true;
	const hmr = options?.injectHMR === true;
	const buildPath = validateSafePath(buildDirectory, projectRoot);
	const assetsPath =
		assetsDirectory && validateSafePath(assetsDirectory, projectRoot);
	const reactDir =
		reactDirectory && validateSafePath(reactDirectory, projectRoot);
	const htmlDir =
		htmlDirectory && validateSafePath(htmlDirectory, projectRoot);
	const htmxDir =
		htmxDirectory && validateSafePath(htmxDirectory, projectRoot);
	const svelteDir =
		svelteDirectory && validateSafePath(svelteDirectory, projectRoot);
	const vueDir = vueDirectory && validateSafePath(vueDirectory, projectRoot);
	const angularDir =
		angularDirectory && validateSafePath(angularDirectory, projectRoot);
	const islandBootstrapPath =
		islands?.bootstrap && validateSafePath(islands.bootstrap, projectRoot);
	const islandRegistryPath =
		islands?.registry && validateSafePath(islands.registry, projectRoot);
	const stylesPath =
		typeof stylesConfig === 'string' ? stylesConfig : stylesConfig?.path;
	const stylesIgnore =
		typeof stylesConfig === 'object' ? stylesConfig.ignore : undefined;
	const stylesDir = stylesPath && validateSafePath(stylesPath, projectRoot);

	const reactIndexesPath = reactDir && join(reactDir, 'generated', 'indexes');
	const reactPagesPath = reactDir && join(reactDir, 'pages');
	const htmlPagesPath = htmlDir && join(htmlDir, 'pages');
	const htmlScriptsPath = htmlDir && join(htmlDir, 'scripts');
	const sveltePagesPath = svelteDir && join(svelteDir, 'pages');
	const vuePagesPath = vueDir && join(vueDir, 'pages');
	const htmxPagesPath = htmxDir && join(htmxDir, 'pages');
	const angularPagesPath = angularDir && join(angularDir, 'pages');

	const frontends = [
		reactDir,
		htmlDir,
		htmxDir,
		svelteDir,
		vueDir,
		angularDir
	].filter(Boolean);
	const isSingle = frontends.length === 1;

	const frameworkNames = [
		reactDir && 'react',
		htmlDir && 'html',
		htmxDir && 'htmx',
		svelteDir && 'svelte',
		vueDir && 'vue',
		angularDir && 'angular'
	].filter((name): name is string => Boolean(name));
	traceFrameworkNames = frameworkNames;
	sendTelemetryEvent('build:start', {
		framework: frameworkNames[0],
		frameworks: frameworkNames,
		mode: mode ?? (isDev ? 'development' : 'production'),
		tailwind: Boolean(tailwind)
	});

	// Compute client root from source framework dirs. Generated intermediate files
	// are placed under {frameworkDir}/generated/ so Bun.build's root stripping
	// produces correct output paths (react/generated/indexes/, svelte/generated/client/, etc.).
	const sourceClientRoots: string[] = [
		reactDir,
		svelteDir,
		htmlDir,
		vueDir,
		angularDir,
		islandBootstrapPath && dirname(islandBootstrapPath)
	].filter((dir): dir is string => Boolean(dir));
	const clientRoot = isSingle
		? (sourceClientRoots[0] ?? projectRoot)
		: commonAncestor(sourceClientRoots, projectRoot);

	const serverDirMap: { dir: string; subdir: string }[] = [];
	if (svelteDir)
		serverDirMap.push({
			dir: svelteDir,
			subdir: join('generated', 'server')
		});
	if (vueDir)
		serverDirMap.push({
			dir: vueDir,
			subdir: join('generated', 'server')
		});
	if (angularDir) serverDirMap.push({ dir: angularDir, subdir: 'generated' });

	let serverOutDir: string | undefined;
	let serverRoot: string | undefined;

	if (serverDirMap.length === 1) {
		const [firstEntry] = serverDirMap;
		if (!firstEntry)
			throw new Error('Expected at least one server directory entry');
		serverRoot = join(firstEntry.dir, firstEntry.subdir);
		serverOutDir = join(buildPath, basename(firstEntry.dir));
	} else if (serverDirMap.length > 1) {
		// Use framework dirs (not generated subdirs) as input to commonAncestor
		// so the root directory actually exists on disk.
		serverRoot = commonAncestor(
			serverDirMap.map((entry) => entry.dir),
			projectRoot
		);
		serverOutDir = buildPath;
	}

	const publicPath =
		publicDirectory && validateSafePath(publicDirectory, projectRoot);
	await tracePhase('build-dir/create', () =>
		mkdirSync(buildPath, { recursive: true })
	);

	if (publicPath)
		await tracePhase('public/copy', () =>
			cpSync(publicPath, buildPath, { force: true, recursive: true })
		);

	// Helper to find matching entry points for incremental files
	// The dependency graph already includes all dependent files in incrementalFiles
	const filterToIncrementalEntries = (
		entryPoints: string[],
		mapToSource: (entry: string) => string | null
	) => {
		if (!isIncremental || !incrementalFiles) return entryPoints;

		const normalizedIncremental = new Set(
			incrementalFiles.map((f) => resolve(f))
		);
		const matchingEntries: string[] = [];

		for (const entry of entryPoints) {
			const sourceFile = mapToSource(entry);
			if (!sourceFile) continue;
			if (!normalizedIncremental.has(resolve(sourceFile))) continue;
			matchingEntries.push(entry);
		}

		return matchingEntries;
	};

	// For incremental React builds, only generate indexes for changed files
	// NOTE: We always regenerate index files to ensure they have the latest hydration error handling logic
	if (reactIndexesPath && reactPagesPath) {
		// Always regenerate React index files to ensure latest error handling is included
		// This is safe because index files are small and generation is fast
		await tracePhase('react/index-generation', () =>
			generateReactIndexFiles(reactPagesPath, reactIndexesPath, hmr)
		);
	}

	// Copy assets on full builds or if assets changed
	if (
		assetsPath &&
		(!isIncremental ||
			normalizedIncrementalFiles?.some((f) => f.includes('/assets/')))
	) {
		await tracePhase('assets/copy', () =>
			cpSync(assetsPath, join(buildPath, 'assets'), {
				force: true,
				recursive: true
			})
		);
	}

	// Tailwind + entry point scanning run in parallel (they're independent)
	const tailwindPromise =
		tailwind &&
		(!isIncremental || normalizedIncrementalFiles?.some(isStylePath))
			? tracePhase('tailwind/build', () =>
					compileTailwindConfig(
						tailwind,
						buildPath,
						styleTransformConfig
					)
				)
			: undefined;

	const emptyConventionResult: {
		conventions: undefined;
		pageFiles: string[];
	} = {
		conventions: undefined,
		pageFiles: []
	};
	const [
		,
		allReactEntries,
		allHtmlEntries,
		reactConventionResult,
		svelteConventionResult,
		vueConventionResult,
		angularConventionResult,
		allGlobalCssEntries
	] = await Promise.all([
		tailwindPromise,
		reactIndexesPath
			? tracePhase('scan/react-indexes', () =>
					scanEntryPoints(reactIndexesPath, '*.tsx')
				)
			: [],
		htmlScriptsPath
			? tracePhase('scan/html-scripts', () =>
					scanEntryPoints(htmlScriptsPath, '*.{js,ts}')
				)
			: [],
		reactPagesPath
			? tracePhase('scan/react-conventions', () =>
					scanConventions(reactPagesPath, '*.tsx')
				)
			: emptyConventionResult,
		sveltePagesPath
			? tracePhase('scan/svelte-conventions', () =>
					scanConventions(sveltePagesPath, '*.svelte')
				)
			: emptyConventionResult,
		vuePagesPath
			? tracePhase('scan/vue-conventions', () =>
					scanConventions(vuePagesPath, '*.vue')
				)
			: emptyConventionResult,
		angularPagesPath
			? tracePhase('scan/angular-conventions', () =>
					scanConventions(angularPagesPath, '*.ts')
				)
			: emptyConventionResult,
		stylesDir
			? tracePhase('scan/css', () =>
					scanCssEntryPoints(stylesDir, stylesIgnore)
				)
			: []
	]);

	// Convention files (colocated with pages) for error/loading/not-found
	const allSvelteEntries = svelteConventionResult.pageFiles;
	const allVueEntries = vueConventionResult.pageFiles;
	const allAngularEntries = angularConventionResult.pageFiles;

	const conventionsMap: ConventionsMap = {};
	if (reactConventionResult.conventions)
		conventionsMap.react = reactConventionResult.conventions;
	if (svelteConventionResult.conventions)
		conventionsMap.svelte = svelteConventionResult.conventions;
	if (vueConventionResult.conventions)
		conventionsMap.vue = vueConventionResult.conventions;
	if (angularConventionResult.conventions)
		conventionsMap.angular = angularConventionResult.conventions;

	// Warn if multiple frameworks define not-found convention files
	const notFoundFrameworks = (
		['react', 'svelte', 'vue', 'angular'] as const
	).filter((framework) => conventionsMap[framework]?.defaults?.notFound);
	if (notFoundFrameworks.length > 1) {
		logWarn(
			`Multiple frameworks define not-found convention files: ${notFoundFrameworks.join(', ')}. ` +
				`Only one will be used (priority: ${notFoundFrameworks[0]}). ` +
				`Remove not-found files from other frameworks to avoid ambiguity.`
		);
	}
	// When HTML/HTMX pages change, we must include their CSS and scripts in the build
	// so the manifest has those entries for updateAssetPaths. Otherwise incremental
	// builds drop them and updateAssetPaths fails with "no manifest entry".
	const shouldIncludeHtmlAssets =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/html/') && (f.endsWith('.html') || isStylePath(f))
		);
	// Filter entries for incremental builds
	// For React: map index entries back to their source pages
	const reactEntries =
		isIncremental && reactIndexesPath && reactPagesPath
			? filterToIncrementalEntries(allReactEntries, (entry) => {
					// Map index entry (indexes/ReactExample.tsx) to source page (pages/ReactExample.tsx)
					if (entry.startsWith(resolve(reactIndexesPath))) {
						const pageName = basename(entry, '.tsx');

						return join(reactPagesPath, `${pageName}.tsx`);
					}

					return null;
				})
			: allReactEntries;

	const htmlEntries =
		isIncremental && htmlScriptsPath && !shouldIncludeHtmlAssets
			? filterToIncrementalEntries(allHtmlEntries, (entry) => entry)
			: allHtmlEntries;

	// For Svelte/Vue/Angular: entries are the page files themselves
	const svelteEntries = isIncremental
		? filterToIncrementalEntries(allSvelteEntries, (entry) => entry)
		: allSvelteEntries;

	const vueEntries = isIncremental
		? filterToIncrementalEntries(allVueEntries, (entry) => entry)
		: allVueEntries;

	const angularEntries = isIncremental
		? filterToIncrementalEntries(allAngularEntries, (entry) => entry)
		: allAngularEntries;

	// CSS entries - entries are the style files themselves
	const globalCssEntries = isIncremental
		? filterToIncrementalEntries(allGlobalCssEntries, (entry) => entry)
		: allGlobalCssEntries;

	// Start HMR client build early — it has no dependency on compile/bunBuild
	// results and will resolve during the compile phase for free.
	const hmrClientBundlePromise =
		hmr && (htmlDir || htmxDir) ? buildHMRClient() : undefined;
	const allFrameworkDirs = [
		reactDir,
		svelteDir,
		vueDir,
		angularDir,
		htmlDir,
		htmxDir
	].filter((dir): dir is string => Boolean(dir));
	const urlReferencedFilesPromise = tracePhase('scan/worker-references', () =>
		scanWorkerReferences(allFrameworkDirs)
	);

	// Angular HMR Optimization — Skip Svelte/Vue compilation when their entries are
	// empty during incremental builds (avoids importing/initializing unused compilers)
	const shouldCompileSvelte = svelteDir && svelteEntries.length > 0;
	const shouldCompileVue = vueDir && vueEntries.length > 0;
	const shouldCompileAngular = angularDir && angularEntries.length > 0;

	const emptyStringArray: string[] = [];
	const islandBuildInfo = islandRegistryPath
		? await tracePhase('islands/registry', () =>
				loadIslandRegistryBuildInfo(islandRegistryPath)
			)
		: null;
	const islandFrameworkSources = islandBuildInfo
		? collectIslandFrameworkSources(islandBuildInfo)
		: {};
	const islandSvelteSources =
		islandFrameworkSources.svelte ?? emptyStringArray;
	const islandVueSources = islandFrameworkSources.vue ?? emptyStringArray;
	const islandAngularSources =
		islandFrameworkSources.angular ?? emptyStringArray;
	const shouldCompileIslandSvelte =
		svelteDir && islandSvelteSources.length > 0;
	const shouldCompileIslandVue = vueDir && islandVueSources.length > 0;
	const shouldCompileIslandAngular =
		angularDir && islandAngularSources.length > 0;

	const [
		{ svelteServerPaths, svelteIndexPaths, svelteClientPaths },
		{ vueServerPaths, vueIndexPaths, vueClientPaths, vueCssPaths },
		{ clientPaths: angularClientPaths, serverPaths: angularServerPaths },
		{ svelteClientPaths: islandSvelteClientPaths },
		{ vueClientPaths: islandVueClientPaths },
		{ clientPaths: islandAngularClientPaths }
	] = await Promise.all([
		shouldCompileSvelte
			? tracePhase('compile/svelte', () =>
					import('../build/compileSvelte').then((mod) =>
						mod.compileSvelte(
							svelteEntries,
							svelteDir,
							new Map(),
							hmr,
							styleTransformConfig
						)
					)
				)
			: {
					svelteClientPaths: [...emptyStringArray],
					svelteIndexPaths: [...emptyStringArray],
					svelteServerPaths: [...emptyStringArray]
				},
		shouldCompileVue
			? tracePhase('compile/vue', () =>
					import('../build/compileVue').then((mod) =>
						mod.compileVue(
							vueEntries,
							vueDir,
							hmr,
							styleTransformConfig
						)
					)
				)
			: {
					vueClientPaths: [...emptyStringArray],
					vueCssPaths: [...emptyStringArray],
					vueIndexPaths: [...emptyStringArray],
					vueServerPaths: [...emptyStringArray]
				},
		shouldCompileAngular
			? tracePhase('compile/angular', () =>
					import('../build/compileAngular').then((mod) =>
						mod.compileAngular(
							angularEntries,
							angularDir,
							hmr,
							styleTransformConfig
						)
					)
				)
			: {
					clientPaths: [...emptyStringArray],
					serverPaths: [...emptyStringArray]
				},
		shouldCompileIslandSvelte
			? tracePhase('compile/island-svelte', () =>
					import('../build/compileSvelte').then((mod) =>
						mod.compileSvelte(
							islandSvelteSources,
							svelteDir,
							new Map(),
							hmr,
							styleTransformConfig
						)
					)
				)
			: {
					svelteClientPaths: [...emptyStringArray]
				},
		shouldCompileIslandVue
			? tracePhase('compile/island-vue', () =>
					import('../build/compileVue').then((mod) =>
						mod.compileVue(
							islandVueSources,
							vueDir,
							hmr,
							styleTransformConfig
						)
					)
				)
			: {
					vueClientPaths: [...emptyStringArray]
				},
		shouldCompileIslandAngular
			? tracePhase('compile/island-angular', () =>
					import('../build/compileAngular').then((mod) =>
						mod.compileAngular(
							islandAngularSources,
							angularDir,
							hmr,
							styleTransformConfig
						)
					)
				)
			: {
					clientPaths: [...emptyStringArray]
				}
	]);

	const islandSvelteClientPathMap = new Map<string, string>();
	for (let idx = 0; idx < islandSvelteSources.length; idx++) {
		const sourcePath = islandSvelteSources[idx];
		const clientPath = islandSvelteClientPaths[idx];
		if (!sourcePath || !clientPath) continue;
		islandSvelteClientPathMap.set(resolve(sourcePath), clientPath);
	}

	const islandVueClientPathMap = new Map<string, string>();
	for (let idx = 0; idx < islandVueSources.length; idx++) {
		const sourcePath = islandVueSources[idx];
		const clientPath = islandVueClientPaths[idx];
		if (!sourcePath || !clientPath) continue;
		islandVueClientPathMap.set(resolve(sourcePath), clientPath);
	}

	const islandAngularClientPathMap = new Map<string, string>();
	for (let idx = 0; idx < islandAngularSources.length; idx++) {
		const sourcePath = islandAngularSources[idx];
		const clientPath = islandAngularClientPaths[idx];
		if (!sourcePath || !clientPath) continue;
		islandAngularClientPathMap.set(resolve(sourcePath), clientPath);
	}

	// Compile convention files (error/loading/not-found) for Svelte and Vue.
	// React and Angular convention files are plain .tsx/.ts — Bun imports them natively.
	const svelteConventionSources = collectConventionSourceFiles(
		conventionsMap.svelte
	);
	const vueConventionSources = collectConventionSourceFiles(
		conventionsMap.vue
	);

	if (svelteConventionSources.length > 0 || vueConventionSources.length > 0) {
		const [svelteConvResult, vueConvResult] = await Promise.all([
			svelteConventionSources.length > 0 && svelteDir
				? tracePhase('compile/convention-svelte', () =>
						import('../build/compileSvelte').then((mod) =>
							mod.compileSvelte(
								svelteConventionSources,
								svelteDir,
								new Map(),
								false,
								styleTransformConfig
							)
						)
					)
				: { svelteServerPaths: emptyStringArray },
			vueConventionSources.length > 0 && vueDir
				? tracePhase('compile/convention-vue', () =>
						import('../build/compileVue').then((mod) =>
							mod.compileVue(
								vueConventionSources,
								vueDir,
								false,
								styleTransformConfig
							)
						)
					)
				: { vueServerPaths: emptyStringArray }
		]);

		// Copy compiled convention files to build/conventions/{framework}/
		// so they survive the cleanup step that removes generated/ directories.
		// Each framework gets its own subdirectory to avoid name collisions.
		const copyConventionFiles = (
			framework: string,
			sources: string[],
			compiledPaths: string[]
		) => {
			const destDir = join(buildPath, 'conventions', framework);
			mkdirSync(destDir, { recursive: true });
			const destPaths: string[] = [];
			for (const compiledPath of compiledPaths) {
				const dest = join(destDir, basename(compiledPath));
				copyFileSync(compiledPath, dest);
				destPaths.push(dest);
			}

			return destPaths;
		};

		const svelteDests = copyConventionFiles(
			'svelte',
			svelteConventionSources,
			svelteConvResult.svelteServerPaths
		);
		const vueDests = copyConventionFiles(
			'vue',
			vueConventionSources,
			vueConvResult.vueServerPaths
		);

		updateConventionCompiledPaths(
			conventionsMap.svelte,
			svelteConventionSources,
			svelteDests
		);
		updateConventionCompiledPaths(
			conventionsMap.vue,
			vueConventionSources,
			vueDests
		);
	}

	const serverEntryPoints = [
		...svelteServerPaths,
		...vueServerPaths,
		...angularServerPaths
	];
	const reactClientEntryPoints = [...reactEntries];
	// Scan for files referenced by new URL('./path', import.meta.url) — these
	// are regular files (e.g. workers) that Bun.build won't follow automatically.
	const urlReferencedFiles = await urlReferencedFilesPromise;

	const nonReactClientEntryPoints = [
		...svelteIndexPaths,
		...svelteClientPaths,
		...htmlEntries,
		...vueIndexPaths,
		...vueClientPaths,
		...angularClientPaths,
		...(islandBootstrapPath ? [islandBootstrapPath] : []),
		...urlReferencedFiles
	];
	const islandEntryResult = islandBuildInfo
		? await tracePhase('islands/client-entry-generation', () =>
				generateIslandEntryPoints({
					buildInfo: islandBuildInfo,
					buildPath,
					clientPathMaps: {
						angular: islandAngularClientPathMap,
						svelte: islandSvelteClientPathMap,
						vue: islandVueClientPathMap
					}
				})
			)
		: {
				entries: [],
				generatedRoot: join(buildPath, '_island_entries')
			};
	const islandClientEntryPoints = islandEntryResult.entries.map(
		(entry) => entry.entryPath
	);

	if (
		serverEntryPoints.length === 0 &&
		reactClientEntryPoints.length === 0 &&
		nonReactClientEntryPoints.length === 0 &&
		islandClientEntryPoints.length === 0 &&
		htmxDir === undefined &&
		htmlDir === undefined
	) {
		logWarn('No entry points found, manifest will be empty');
		sendTelemetryEvent('build:empty', {
			configuredDirs: {
				angular: Boolean(angularDir),
				html: Boolean(htmlDir),
				htmx: Boolean(htmxDir),
				react: Boolean(reactDir),
				svelte: Boolean(svelteDir),
				vue: Boolean(vueDir)
			},
			filteredEntries: {
				angular: angularEntries.length,
				html: htmlEntries.length,
				react: reactEntries.length,
				svelte: svelteEntries.length,
				vue: vueEntries.length
			},
			frameworks: frameworkNames,
			incremental: Boolean(isIncremental),
			mode: mode ?? (isDev ? 'development' : 'production'),
			scannedEntries: {
				angular: allAngularEntries.length,
				html: allHtmlEntries.length,
				react: allReactEntries.length,
				svelte: allSvelteEntries.length,
				vue: allVueEntries.length
			}
		});
		writeBuildTrace(buildPath);

		return {};
	}

	// In dev, add the _refresh entry to force React into a shared chunk
	// so HMR can re-import component entries without duplicating React.
	// Only add when React entries exist (i.e. React files actually changed
	// or this is a full build) to avoid producing stale React outputs
	// during non-React incremental rebuilds.
	if (hmr && reactIndexesPath && reactClientEntryPoints.length > 0) {
		const refreshEntry = join(reactIndexesPath, '_refresh.tsx');
		if (!reactClientEntryPoints.includes(refreshEntry))
			reactClientEntryPoints.push(refreshEntry);
	}

	// In dev mode, externalize React so imports get rewritten to stable
	// vendor file paths. If module-level state was lost (Bun --hot
	// re-evaluated devVendorPaths.ts), recompute and restore it.
	let vendorPaths = getDevVendorPaths();
	if (!vendorPaths && hmr && reactDir) {
		const { computeVendorPaths } = await import(
			'../build/buildReactVendor'
		);
		vendorPaths = computeVendorPaths();
		setDevVendorPaths(vendorPaths);
	}
	let angularVendorPaths = getAngularVendorPaths();
	if (!angularVendorPaths && hmr && angularDir) {
		const { computeAngularVendorPaths } = await import(
			'../build/buildAngularVendor'
		);
		angularVendorPaths = computeAngularVendorPaths(
			globalThis.__angularVendorSpecifiers
		);
		setAngularVendorPaths(angularVendorPaths);
	}
	let vueVendorPaths = getVueVendorPaths();
	if (!vueVendorPaths && hmr && vueDir) {
		const { computeVueVendorPaths } = await import(
			'../build/buildVueVendor'
		);
		vueVendorPaths = computeVueVendorPaths();
		setVueVendorPaths(vueVendorPaths);
	}
	let svelteVendorPaths = getSvelteVendorPaths();
	if (!svelteVendorPaths && hmr && svelteDir) {
		const { computeSvelteVendorPaths } = await import(
			'../build/buildSvelteVendor'
		);
		svelteVendorPaths = computeSvelteVendorPaths();
		setSvelteVendorPaths(svelteVendorPaths);
	}
	const depVendorPaths =
		hmr && globalThis.__depVendorPaths ? globalThis.__depVendorPaths : {};
	const reactExternalPaths: Record<string, string> = {
		...(vendorPaths ?? {}),
		...depVendorPaths
	};
	const nonReactExternalPaths: Record<string, string> = {
		...reactExternalPaths,
		...(angularVendorPaths ?? {}),
		...(vueVendorPaths ?? {}),
		...(svelteVendorPaths ?? {})
	};

	const htmlScriptPlugin = hmr
		? createHTMLScriptHMRPlugin(htmlDir, htmxDir)
		: undefined;
	const reactBuildConfig: Parameters<typeof bunBuild>[0] | undefined =
		reactClientEntryPoints.length > 0
			? mergeBunBuildConfig(
					{
						entrypoints: reactClientEntryPoints,
						...(Object.keys(reactExternalPaths).length > 0
							? { external: Object.keys(reactExternalPaths) }
							: {}),
						format: 'esm',
						minify: !isDev,
						naming: `[dir]/[name].[hash].[ext]`,
						outdir: buildPath,
						...(hmr
							? {
									jsx: { development: true },
									reactFastRefresh: true
								}
							: {}),
						plugins: [stylePreprocessorPlugin],
						root: clientRoot,
						splitting: true,
						target: 'browser',
						throw: false
					},
					resolveBunBuildOverride(bunBuildConfig, 'reactClient')
				)
			: undefined;

	// Remove old hashed indexes before bundling so stale files
	// from previous builds don't accumulate in dist/.
	if (reactDir && reactClientEntryPoints.length > 0) {
		rmSync(join(buildPath, 'react', 'generated', 'indexes'), {
			force: true,
			recursive: true
		});
	}
	if (angularDir && angularClientPaths.length > 0) {
		rmSync(join(buildPath, 'angular', 'indexes'), {
			force: true,
			recursive: true
		});
	}
	if (islandClientEntryPoints.length > 0) {
		rmSync(join(buildPath, 'islands'), {
			force: true,
			recursive: true
		});
	}

	// Run all 4 Bun.build passes in parallel — they write to different
	// directories and have independent entry points.
	const [
		serverResult,
		reactClientResult,
		nonReactClientResult,
		islandClientResult,
		globalCssResult,
		vueCssResult
	] = await Promise.all([
		serverEntryPoints.length > 0
			? tracePhase('bun/server', () =>
					bunBuild(
						mergeBunBuildConfig(
							{
								entrypoints: serverEntryPoints,
								external: [
									'react',
									'react/*',
									'react-dom',
									'react-dom/*',
									'svelte',
									'svelte/*',
									'vue',
									'vue/*',
									'@angular/*',
									'typescript'
								],
								format: 'esm',
								naming: `[dir]/[name].[hash].[ext]`,
								outdir: serverOutDir,
								plugins: [stylePreprocessorPlugin],
								root: serverRoot,
								target: 'bun',
								throw: false,
								tsconfig: './tsconfig.json'
							},
							resolveBunBuildOverride(bunBuildConfig, 'server')
						)
					)
				)
			: undefined,
		reactBuildConfig
			? tracePhase('bun/react-client', () => bunBuild(reactBuildConfig))
			: undefined,
		nonReactClientEntryPoints.length > 0
			? tracePhase('bun/non-react-client', () =>
					bunBuild(
						mergeBunBuildConfig(
							{
								define: vueDirectory
									? vueFeatureFlags
									: undefined,
								entrypoints: nonReactClientEntryPoints,
								external: Object.keys(nonReactExternalPaths),
								format: 'esm',
								minify: !isDev,
								naming: `[dir]/[name].[hash].[ext]`,
								outdir: buildPath,
								plugins: [
									stylePreprocessorPlugin,
									...(angularDir
										? [createAngularLinkerPlugin(hmr)]
										: []),
									...(htmlScriptPlugin
										? [htmlScriptPlugin]
										: [])
								],
								root: clientRoot,
								splitting: !isDev,
								target: 'browser',
								throw: false,
								tsconfig: './tsconfig.json'
							},
							resolveBunBuildOverride(
								bunBuildConfig,
								'nonReactClient'
							)
						)
					)
				)
			: undefined,
		islandClientEntryPoints.length > 0
			? tracePhase('bun/island-client', () =>
					bunBuild(
						mergeBunBuildConfig(
							{
								define: vueDirectory
									? vueFeatureFlags
									: undefined,
								entrypoints: islandClientEntryPoints,
								external: Object.keys(nonReactExternalPaths),
								format: 'esm',
								minify: !isDev,
								naming: `[dir]/[name].[hash].[ext]`,
								outdir: buildPath,
								plugins: [
									stylePreprocessorPlugin,
									...(angularDir
										? [createAngularLinkerPlugin(hmr)]
										: [])
								],
								root: islandEntryResult.generatedRoot,
								splitting: !isDev,
								target: 'browser',
								throw: false,
								tsconfig: './tsconfig.json'
							},
							resolveBunBuildOverride(
								bunBuildConfig,
								'islandClient'
							)
						)
					)
				)
			: undefined,
		globalCssEntries.length > 0
			? tracePhase('bun/global-css', () =>
					bunBuild(
						mergeBunBuildConfig(
							{
								entrypoints: globalCssEntries,
								naming: `[dir]/[name].[hash].[ext]`,
								outdir: stylesDir
									? join(buildPath, basename(stylesDir))
									: buildPath,
								plugins: [stylePreprocessorPlugin],
								root: stylesDir || clientRoot,
								target: 'browser',
								throw: false
							},
							resolveBunBuildOverride(bunBuildConfig, 'globalCss')
						)
					)
				)
			: undefined,
		vueCssPaths.length > 0
			? tracePhase('bun/vue-css', () =>
					bunBuild(
						mergeBunBuildConfig(
							{
								entrypoints: vueCssPaths,
								naming: `[name].[hash].[ext]`,
								outdir: join(
									buildPath,
									assetsPath
										? basename(assetsPath)
										: 'assets',
									'css'
								),
								target: 'browser',
								throw: false
							},
							resolveBunBuildOverride(bunBuildConfig, 'vueCss')
						)
					)
				)
			: undefined
	]);

	const serverLogs = serverResult?.logs ?? [];
	const serverOutputs = serverResult?.outputs ?? [];

	if (serverResult && !serverResult.success && serverLogs.length > 0) {
		extractBuildError(
			serverLogs,
			'server',
			'Server',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	const reactClientLogs = reactClientResult?.logs ?? [];
	const reactClientOutputs = reactClientResult?.outputs ?? [];

	if (
		reactClientResult &&
		!reactClientResult.success &&
		reactClientLogs.length > 0
	) {
		extractBuildError(
			reactClientLogs,
			'react-client',
			'React client',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	const reactClientOutputPaths = reactClientOutputs.map(
		(artifact) => artifact.path
	);

	if (vendorPaths && reactClientOutputPaths.length > 0) {
		await tracePhase('postprocess/react-imports', () =>
			rewriteReactImports(reactClientOutputPaths, vendorPaths)
		);
	}

	if (hmr && reactClientOutputPaths.length > 0) {
		await tracePhase('postprocess/react-refresh-globals', () =>
			patchRefreshGlobals(reactClientOutputPaths)
		);
	}

	const nonReactClientLogs = nonReactClientResult?.logs ?? [];
	const nonReactClientOutputs = nonReactClientResult?.outputs ?? [];
	const nonReactClientOutputPaths = nonReactClientOutputs.map(
		(artifact) => artifact.path
	);
	const islandClientLogs = islandClientResult?.logs ?? [];
	const islandClientOutputs = islandClientResult?.outputs ?? [];
	const islandClientOutputPaths = islandClientOutputs.map(
		(artifact) => artifact.path
	);

	if (vendorPaths && nonReactClientOutputPaths.length > 0) {
		await tracePhase('postprocess/non-react-react-imports', () =>
			rewriteReactImports(nonReactClientOutputPaths, vendorPaths)
		);
	}
	if (hmr && nonReactClientOutputPaths.length > 0) {
		await tracePhase('postprocess/non-react-refresh-globals', () =>
			patchRefreshGlobals(nonReactClientOutputPaths)
		);
	}

	if (vendorPaths && islandClientOutputPaths.length > 0) {
		await tracePhase('postprocess/island-react-imports', () =>
			rewriteReactImports(islandClientOutputPaths, vendorPaths)
		);
	}
	if (hmr && islandClientOutputPaths.length > 0) {
		await tracePhase('postprocess/island-refresh-globals', () =>
			patchRefreshGlobals(islandClientOutputPaths)
		);
	}

	if (
		nonReactClientResult &&
		!nonReactClientResult.success &&
		nonReactClientLogs.length > 0
	) {
		extractBuildError(
			nonReactClientLogs,
			'non-react-client',
			'Non-React client',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}
	if (
		islandClientResult &&
		!islandClientResult.success &&
		islandClientLogs.length > 0
	) {
		extractBuildError(
			islandClientLogs,
			'island-client',
			'Island client',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	// Post-process: rewrite bare Angular/Vue specifiers to vendor paths.
	const allNonReactVendorPaths: Record<string, string> = {
		...depVendorPaths,
		...(angularVendorPaths ?? {}),
		...(vueVendorPaths ?? {}),
		...(svelteVendorPaths ?? {})
	};
	const allIslandVendorPaths: Record<string, string> = {
		...reactExternalPaths,
		...allNonReactVendorPaths
	};
	if (
		nonReactClientOutputs.length > 0 &&
		Object.keys(allNonReactVendorPaths).length > 0
	) {
		const { rewriteImports } = await import('../build/rewriteImports');
		await tracePhase('postprocess/non-react-vendor-imports', () =>
			rewriteImports(
				nonReactClientOutputs.map((artifact) => artifact.path),
				allNonReactVendorPaths
			)
		);
	}
	if (
		islandClientOutputs.length > 0 &&
		Object.keys(allIslandVendorPaths).length > 0
	) {
		const { rewriteImports } = await import('../build/rewriteImports');
		await tracePhase('postprocess/island-vendor-imports', () =>
			rewriteImports(
				islandClientOutputs.map((artifact) => artifact.path),
				allIslandVendorPaths
			)
		);
	}

	const cssLogs: (BuildMessage | ResolveMessage)[] = [
		...(globalCssResult?.logs ?? []),
		...(vueCssResult?.logs ?? [])
	];
	const cssOutputs: BuildArtifact[] = [
		...(globalCssResult?.outputs ?? []),
		...(vueCssResult?.outputs ?? [])
	];

	if (
		globalCssResult &&
		!globalCssResult.success &&
		globalCssResult.logs.length > 0
	) {
		extractBuildError(
			globalCssResult.logs,
			'global-css',
			'Global CSS',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	if (vueCssResult && !vueCssResult.success && vueCssResult.logs.length > 0) {
		extractBuildError(
			vueCssResult.logs,
			'vue-css',
			'Vue CSS',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	// In dev mode, rewrite new URL('./path', import.meta.url) in all bundled
	// client outputs to /@src/ URLs so workers resolve through the module server.
	// In prod mode, rewrite to the hashed output path from the build.
	const allClientOutputPaths = [
		...reactClientOutputPaths,
		...nonReactClientOutputs.map((artifact) => artifact.path)
	];
	if (urlReferencedFiles.length > 0) {
		const urlFileMap = buildUrlFileMap(
			urlReferencedFiles,
			hmr,
			projectRoot,
			buildPath,
			nonReactClientOutputs
		);
		await tracePhase('postprocess/url-references', () =>
			rewriteUrlReferences(allClientOutputPaths, urlFileMap)
		);
	}

	// In dev mode, inject composable state tracking into Vue bundled output
	// so the first HMR cycle can preserve ref values.
	const vueOutputPaths = nonReactClientOutputs
		.map((artifact) => artifact.path)
		.filter((path) => path.includes('/vue/'));
	if (hmr && vueDirectory) {
		await tracePhase('postprocess/vue-hmr', () =>
			vueOutputPaths.forEach((outputPath) =>
				injectVueComposableTracking(outputPath, projectRoot)
			)
		);
	}

	const allLogs = [
		...serverLogs,
		...reactClientLogs,
		...nonReactClientLogs,
		...islandClientLogs,
		...cssLogs
	];
	outputLogs(allLogs);

	const manifest: Record<string, string> = {
		...(options?.baseManifest || {}),
		...generateManifest(
			[
				...serverOutputs,
				...reactClientOutputs,
				...nonReactClientOutputs,
				...islandClientOutputs,
				...cssOutputs
			],
			buildPath
		)
	};

	// Server pages (Svelte, Vue, Angular) need absolute file paths for SSR
	// import(), not web-relative paths. Overwrite with absolute paths.
	for (const artifact of serverOutputs) {
		const fileWithHash = basename(artifact.path);
		const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
		if (!baseName) continue;
		manifest[toPascal(baseName)] = artifact.path;
	}

	const shouldCopyHtmx =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) => f.includes('/htmx/') && f.endsWith('.html')
		);

	// Update asset paths if CSS changed (even if HTML files didn't change)
	const shouldUpdateHtmlAssetPaths =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/html/') && (f.endsWith('.html') || isStylePath(f))
		);
	const shouldUpdateHtmxAssetPaths =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/htmx/') && (f.endsWith('.html') || isStylePath(f))
		);

	// Await the HMR client bundle that was started before the compile phase
	const hmrClientBundle = hmrClientBundlePromise
		? await hmrClientBundlePromise
		: null;

	const injectHMRIntoHTMLFile = (filePath: string, framework: string) => {
		if (!hmrClientBundle) return;
		let html = readFileSync(filePath, 'utf-8');
		if (html.includes('data-hmr-client')) return;
		const tag =
			`<script>window.__HMR_FRAMEWORK__="${framework}";</script>` +
			`<script data-hmr-client>${hmrClientBundle}</script>`;
		const bodyClose = /<\/body\s*>/i.exec(html);
		html = bodyClose
			? html.slice(0, bodyClose.index) + tag + html.slice(bodyClose.index)
			: html + tag;
		writeFileSync(filePath, html);
	};

	// HTML + HTMX post-processing run in parallel (independent directories)
	const processHtmlPages = async () => {
		if (!(htmlDir && htmlPagesPath)) return;
		const outputHtmlPages = isSingle
			? join(buildPath, 'pages')
			: join(buildPath, basename(htmlDir), 'pages');

		mkdirSync(outputHtmlPages, { recursive: true });
		cpSync(htmlPagesPath, outputHtmlPages, {
			force: true,
			recursive: true
		});

		// Update asset paths if HTML files changed OR CSS changed
		if (shouldUpdateHtmlAssetPaths) {
			await updateAssetPaths(manifest, outputHtmlPages);
			await optimizeHtmlImages(outputHtmlPages);
		}

		// Add HTML pages to manifest (absolute paths for Bun.file())
		const htmlPageFiles = await scanEntryPoints(outputHtmlPages, '*.html');
		await transformStaticPagesWithIslands(
			islandRegistryPath,
			htmlPageFiles
		);
		for (const htmlFile of htmlPageFiles) {
			if (hmr) injectHMRIntoHTMLFile(htmlFile, 'html');
			const fileName = basename(htmlFile, '.html');
			manifest[fileName] = htmlFile;
		}
	};

	const processHtmxPages = async () => {
		if (!(htmxDir && htmxPagesPath)) return;
		const outputHtmxPages = isSingle
			? join(buildPath, 'pages')
			: join(buildPath, basename(htmxDir), 'pages');

		mkdirSync(outputHtmxPages, { recursive: true });
		cpSync(htmxPagesPath, outputHtmxPages, {
			force: true,
			recursive: true
		});

		if (shouldCopyHtmx) {
			const htmxDestDir = isSingle
				? buildPath
				: join(buildPath, basename(htmxDir));
			copyHtmxVendor(htmxDir, htmxDestDir);
		}

		// Update asset paths if HTMX files changed OR CSS changed
		if (shouldUpdateHtmxAssetPaths) {
			await updateAssetPaths(manifest, outputHtmxPages);
			await optimizeHtmlImages(outputHtmxPages);
		}

		// Add HTMX pages to manifest (absolute paths for Bun.file())
		const htmxPageFiles = await scanEntryPoints(outputHtmxPages, '*.html');
		await transformStaticPagesWithIslands(
			islandRegistryPath,
			htmxPageFiles
		);
		for (const htmxFile of htmxPageFiles) {
			if (hmr) injectHMRIntoHTMLFile(htmxFile, 'htmx');
			const fileName = basename(htmxFile, '.html');
			manifest[fileName] = htmxFile;
		}
	};

	await Promise.all([
		tracePhase('postprocess/html-pages', processHtmlPages),
		tracePhase('postprocess/htmx-pages', processHtmxPages)
	]);

	if (!isIncremental) {
		await tracePhase('cleanup/stale-outputs', () =>
			cleanStaleOutputs(buildPath, [
				...serverOutputs.map((a) => a.path),
				...reactClientOutputs.map((a) => a.path),
				...nonReactClientOutputs.map((a) => a.path),
				...islandClientOutputs.map((a) => a.path),
				...cssOutputs.map((a) => a.path)
			])
		);
	}

	// In dev mode, copy source indexes to build dir before cleanup.
	// Rewrite relative page imports to absolute /@src/ paths since
	// the indexes are moved from src/frontend/indexes/ to build/_src_indexes/
	if (hmr) {
		await tracePhase('dev/copy-indexes', () =>
			copyDevIndexes({
				buildPath,
				reactIndexesPath,
				reactPagesPath,
				svelteDir,
				svelteEntries,
				sveltePagesPath,
				vueDir,
				vueEntries,
				vuePagesPath
			})
		);
	}

	await tracePhase('cleanup/generated', () =>
		cleanup({
			angularDir,
			reactDir,
			svelteDir,
			vueDir
		})
	);

	if (!isIncremental) {
		globalThis.__hmrBuildDuration = performance.now() - buildStart;
	}

	sendTelemetryEvent('build:complete', {
		durationMs: Math.round(performance.now() - buildStart),
		frameworks: frameworkNames,
		mode: mode ?? (isDev ? 'development' : 'production')
	});

	// Skip manifest.json disk write during incremental (HMR) builds —
	// the in-memory manifest is authoritative and writing to disk on
	// every keystroke adds unnecessary I/O latency.
	if (isIncremental) {
		writeBuildTrace(buildPath);

		return { conventions: conventionsMap, manifest };
	}

	writeFileSync(
		join(buildPath, 'manifest.json'),
		JSON.stringify(manifest, null, '\t')
	);

	// Write convention files map (error/loading/not-found) if any exist
	if (Object.keys(conventionsMap).length > 0) {
		writeFileSync(
			join(buildPath, 'conventions.json'),
			JSON.stringify(conventionsMap, null, '\t')
		);
	}

	writeBuildTrace(buildPath);

	return { conventions: conventionsMap, manifest };
};
