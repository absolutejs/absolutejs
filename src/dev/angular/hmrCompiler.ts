/* AOT-incremental Angular compile, dev/HMR only.
 *
 * Owns the program lifecycle that surgical HMR needs:
 *   1. First call: full `performCompilation({ enableHmr: true, ... })`
 *      so every emitted component .js gets a `${ClassName}_HmrLoad`
 *      listener baked in by `compileHmrInitializer`.
 *   2. Subsequent calls: pass `oldProgram` so TypeScript +
 *      compiler-cli reuse type-checked AST nodes and only re-analyze
 *      what changed (~100-300ms per touched component vs the ~5-10s
 *      cold start).
 *   3. Caches the resulting `program: NgtscProgram` on
 *      `globalThis.__ABSOLUTE_ANGULAR_HMR_PROGRAM__` so the
 *      `/@ng/component?c=<id>` endpoint can call
 *      `program.compiler.emitHmrUpdateModule(node)` without piping
 *      the program through every layer.
 *
 * This module sits ALONGSIDE the existing `compileAngularFileJIT`
 * path — production unchanged, the JIT path still produces page
 * chunks for now. Once §3.3 lands and the surgical pipeline is the
 * primary HMR mechanism, this becomes the only Angular dev compile
 * path and `compileAngularFileJIT` can be deleted.
 *
 * See SURGICAL_HMR.md for the architecture; §9 (spike findings) for
 * why the `enableHmr: true` flag matters and what the emit produces. */

import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { CompilerOptions } from '@angular/compiler-cli';

type NgtscProgramLike = {
	compiler: {
		emitHmrUpdateModule(node: ts.Node): string | null;
		getCurrentProgram(): ts.Program;
	};
};

type CompileResult = {
	program: NgtscProgramLike;
	emitted: Record<string, string>;
	diagnostics: readonly ts.Diagnostic[];
};

type GlobalCache = typeof globalThis & {
	__ABSOLUTE_ANGULAR_HMR_PROGRAM__?: NgtscProgramLike;
};

const globalCache = globalThis as GlobalCache;

export const getCachedHmrProgram = (): NgtscProgramLike | null =>
	globalCache.__ABSOLUTE_ANGULAR_HMR_PROGRAM__ ?? null;

const setCachedHmrProgram = (program: NgtscProgramLike) => {
	globalCache.__ABSOLUTE_ANGULAR_HMR_PROGRAM__ = program;
};

let resolveTypescriptLibDirCached: string | null = null;
const resolveTypescriptLibDir = () => {
	if (resolveTypescriptLibDirCached) return resolveTypescriptLibDirCached;
	const tsPath = require.resolve('typescript');
	const tsRootDir = dirname(tsPath);
	resolveTypescriptLibDirCached = tsRootDir.endsWith('lib')
		? tsRootDir
		: resolve(tsRootDir, 'lib');

	return resolveTypescriptLibDirCached;
};

const buildHmrCompilerOptions = (base: CompilerOptions): CompilerOptions => ({
	...base,
	emitDecoratorMetadata: true,
	esModuleInterop: true,
	experimentalDecorators: true,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	newLine: ts.NewLineKind.LineFeed,
	noEmit: false,
	noLib: false,
	rootDir: process.cwd(),
	skipLibCheck: true,
	target: ts.ScriptTarget.ES2022,
	// Critical: this is the flag that turns on HMR-aware emit. Without
	// it, `compileFull` skips `compileHmrInitializer` (no _HmrLoad
	// listener in the output) and `emitHmrUpdateModule` returns null.
	// Discovered during the §3.1 spike — the silent-null gotcha.
	_enableHmr: true,
	enableHmr: true
});

const ANGULAR_COMPILER_OPTIONS_CACHE: { value: CompilerOptions | null } = {
	value: null
};

const loadAngularCompilerOptions = async () => {
	if (ANGULAR_COMPILER_OPTIONS_CACHE.value) {
		return ANGULAR_COMPILER_OPTIONS_CACHE.value;
	}
	const { readConfiguration } = await import('@angular/compiler-cli');
	const config = readConfiguration('./tsconfig.json');
	ANGULAR_COMPILER_OPTIONS_CACHE.value = config.options;

	return config.options;
};

/* Hash function for cache invalidation. Deliberately not cryptographic:
 * we just need to detect when the consumer's tsconfig.json changed
 * since we last loaded compiler options, so the cached options don't
 * persist across config edits. */
let cachedTsconfigMtime = 0;
const refreshAngularCompilerOptionsIfStale = async () => {
	const tsconfigPath = resolve(process.cwd(), 'tsconfig.json');
	if (!existsSync(tsconfigPath)) return;
	const stat = await import('node:fs/promises').then((m) =>
		m.stat(tsconfigPath)
	);
	if (stat.mtimeMs > cachedTsconfigMtime) {
		ANGULAR_COMPILER_OPTIONS_CACHE.value = null;
		cachedTsconfigMtime = stat.mtimeMs;
	}
};

/* Run one AOT-incremental compilation pass for HMR.
 *
 * `inputPaths` is the list of TS source files to feed in. The compiler
 * walks their import graph internally, so passing just the changed
 * files isn't enough — pass the full set of Angular pages + their
 * dependencies. In practice the rebuild trigger feeds in the affected
 * page entries (which is what `compileAngularFileJIT` is given today).
 *
 * `outDir` is where emitted .js files would go IF we wrote them to
 * disk. We don't — the emit is captured in memory and returned in
 * `result.emitted`. The dev pipeline writes to
 * `<projectRoot>/.absolutejs/generated/angular/...` via its own
 * post-processing.
 *
 * After this call, `getCachedHmrProgram()` returns the new program
 * for the endpoint to query. */
export const compileAngularForHmr = async (
	inputPaths: string[],
	outDir: string,
	modifiedResourceFiles: ReadonlySet<string> | null = null
): Promise<CompileResult> => {
	await refreshAngularCompilerOptionsIfStale();
	// `@angular/compiler` must be loaded before `@angular/compiler-cli`
	// — same `publishFacade(globalThis)` requirement as the existing
	// AOT path in `compileAngularFiles`.
	await import('@angular/compiler');
	const { performCompilation, EmitFlags } = await import(
		'@angular/compiler-cli'
	);

	const baseOptions = await loadAngularCompilerOptions();
	const options = buildHmrCompilerOptions(baseOptions);
	options.outDir = outDir;
	options.target = ts.ScriptTarget.ES2022;
	options.experimentalDecorators = true;
	options.emitDecoratorMetadata = true;
	options.newLine = ts.NewLineKind.LineFeed;
	options.incremental = false;
	options.tsBuildInfoFile = undefined;

	const tsLibDir = resolveTypescriptLibDir();
	const host = ts.createCompilerHost(options);

	// Lib resolution overrides — same as `compileAngularFiles`.
	const originalGetDefaultLibLocation = host.getDefaultLibLocation;
	host.getDefaultLibLocation = () =>
		tsLibDir ||
		(originalGetDefaultLibLocation ? originalGetDefaultLibLocation() : '');

	const originalGetDefaultLibFileName = host.getDefaultLibFileName;
	host.getDefaultLibFileName = (opts: ts.CompilerOptions) => {
		const fileName = originalGetDefaultLibFileName
			? originalGetDefaultLibFileName(opts)
			: 'lib.d.ts';

		return basename(fileName);
	};

	const originalGetSourceFile = host.getSourceFile;
	host.getSourceFile = (
		fileName: string,
		languageVersion: ts.ScriptTarget,
		onError?: (message: string) => void
	) => {
		if (
			fileName.startsWith('lib.') &&
			fileName.endsWith('.d.ts') &&
			tsLibDir
		) {
			return originalGetSourceFile?.call(
				host,
				join(tsLibDir, fileName),
				languageVersion,
				onError
			);
		}

		return originalGetSourceFile?.call(
			host,
			fileName,
			languageVersion,
			onError
		);
	};

	const emitted: Record<string, string> = {};
	const resolvedOutDir = resolve(outDir);
	host.writeFile = (fileName, text) => {
		const normalized = fileName.replace(/\\/g, '/');
		const rel = normalized.startsWith(resolvedOutDir.replace(/\\/g, '/'))
			? relative(resolvedOutDir, normalized).replace(/\\/g, '/')
			: relative(process.cwd(), normalized).replace(/\\/g, '/');
		emitted[rel] = text;
	};

	const oldProgram = getCachedHmrProgram();

	// Pass `modifiedResourceFiles` as a direct `performCompilation`
	// argument (the documented public API). performCompilation sets
	// `host.getModifiedResourceFiles = () => modifiedResourceFiles`
	// itself; the chain `updateWithChangedResources` →
	// `getComponentsWithStyleFile` → `traitCompiler.updateResources`
	// then invalidates and re-analyzes any component whose styleUrl /
	// templateUrl appears in this set. `forceEmit: true` belt-and-
	// suspenders past `safeToSkipEmit` — every source file gets
	// re-emitted regardless of incremental optimization, so the
	// `program.compiler.emitHmrUpdateModule(node)` call after this
	// reads from up-to-date metadata.
	const performArgs: Parameters<typeof performCompilation>[0] = {
		emitFlags: EmitFlags.Default,
		forceEmit: true,
		host,
		options,
		rootNames: inputPaths
	};
	if (modifiedResourceFiles && modifiedResourceFiles.size > 0) {
		performArgs.modifiedResourceFiles = new Set(modifiedResourceFiles);
	}
	if (oldProgram) {
		// Only pass `oldProgram` when we actually have one — ngtsc's
		// internals access `oldProgram.incrementalStrategy` without
		// a null-guard, so a literal `null` throws.
		performArgs.oldProgram = oldProgram as unknown as Parameters<
			typeof performCompilation
		>[0]['oldProgram'];
	}
	const compileResult = performCompilation(performArgs);

	const program = compileResult.program as unknown as NgtscProgramLike;
	if (program) setCachedHmrProgram(program);

	return {
		program,
		emitted,
		diagnostics: compileResult.diagnostics ?? []
	};
};

/* Decode the encoded-id form Angular's `_HmrLoad` listener uses, then
 * walk the cached program's source files for the matching class.
 * Returns null when the id can't be resolved — the caller should turn
 * that into a 404.
 *
 * The id is `encodeURIComponent('${projectRel}@${className}')` (see
 * `compileHmrInitializer` in @angular/compiler). TypeScript's
 * `getSourceFile` keys by absolute path with forward slashes, so we
 * resolve the relative path against `process.cwd()` before lookup
 * AND fall back to a linear scan of all source files in case
 * Angular's rel-path normalization differs from ours. The fallback
 * is cheap — ngtsc programs in dev contain at most a few hundred
 * source files. */
export const findClassNodeById = (
	program: NgtscProgramLike,
	encodedId: string
): ts.ClassDeclaration | null => {
	const decoded = decodeURIComponent(encodedId);
	const at = decoded.lastIndexOf('@');
	if (at === -1) return null;
	const filePath = decoded.slice(0, at);
	const className = decoded.slice(at + 1);

	const tsProgram = program.compiler.getCurrentProgram();
	const absoluteCandidate = resolve(process.cwd(), filePath).replace(
		/\\/g,
		'/'
	);

	const matchesPath = (sourceFileName: string) => {
		const normalized = sourceFileName.replace(/\\/g, '/');
		if (normalized === absoluteCandidate) return true;
		if (normalized === filePath) return true;
		// Suffix match handles leading "./" / drive-letter / case
		// quirks that don't change the trailing relative path.
		return (
			normalized.endsWith('/' + filePath) ||
			normalized.endsWith(filePath)
		);
	};

	let sourceFile = tsProgram.getSourceFile(absoluteCandidate) ?? null;
	if (!sourceFile) {
		for (const candidate of tsProgram.getSourceFiles()) {
			if (matchesPath(candidate.fileName)) {
				sourceFile = candidate;
				break;
			}
		}
	}
	if (!sourceFile) return null;

	let found: ts.ClassDeclaration | null = null;
	const walk = (node: ts.Node) => {
		if (found) return;
		if (ts.isClassDeclaration(node) && node.name?.text === className) {
			found = node;

			return;
		}
		ts.forEachChild(node, walk);
	};
	walk(sourceFile);

	return found;
};

/* Top-level helper for the `/@ng/component?c=<id>` endpoint. Returns
 * the JS module string or null (→ 404). The string is what
 * `NgCompiler.emitHmrUpdateModule` produces; default-export is the
 * `${ClassName}_UpdateMetadata` callback Angular's `_HmrLoad` listener
 * passes to `ɵɵreplaceMetadata`. */
export const getApplyMetadataModule = (encodedId: string): string | null => {
	const program = getCachedHmrProgram();
	if (!program) return null;
	const node = findClassNodeById(program, encodedId);
	if (!node) return null;

	return program.compiler.emitHmrUpdateModule(node);
};

/* Encode form matching what `compileHmrInitializer` emits on the
 * caller side: `encodeURIComponent('${filePath}@${className}')`,
 * where `filePath` is RELATIVE to the project root in Angular CLI's
 * convention. We mirror that so the broadcast id matches what
 * Angular's listener expects. */
export const encodeHmrComponentId = (
	absoluteFilePath: string,
	className: string
): string => {
	const projectRel = relative(process.cwd(), absoluteFilePath).replace(
		/\\/g,
		'/'
	);

	return encodeURIComponent(`${projectRel}@${className}`);
};
