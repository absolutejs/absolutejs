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
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import type { CompilerOptions } from '@angular/compiler-cli';
import { logInfo, logWarn } from '../../utils/logger';
import { tryFastHmr } from './fastHmrCompiler';

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
 * passes to `ɵɵreplaceMetadata`.
 *
 * Two paths:
 *   1. Fast path (`fastHmrCompiler.tryFastHmr`): single-file metadata
 *      extraction + `compileComponentFromMetadata`, ~4ms median. The
 *      default for any standalone component without inheritance.
 *   2. Slow fallback (ngtsc `emitHmrUpdateModule`): the original
 *      surgical-HMR path, ~1-3s incremental. Only kicks in when the
 *      fast path bails — e.g. NgModule-based components, decorated
 *      inheritance chains, edge cases the metadata extractor can't
 *      cover yet. See ANGULAR_HMR_ARCHITECTURE.md for the categorization.
 *
 * Falling back is safe: it's the path Angular CLI runs by default. */
export const getApplyMetadataModule = async (
	encodedId: string
): Promise<string | null> => {
	const decoded = decodeURIComponent(encodedId);
	const at = decoded.lastIndexOf('@');
	if (at === -1) return null;
	const filePathRel = decoded.slice(0, at);
	const className = decoded.slice(at + 1);
	const componentFilePath = resolve(process.cwd(), filePathRel);

	// Cache hit path: the dispatcher already compiled this exact
	// edit's surgical module (in `decideAngularTier`'s `tryFastHmr`
	// call) and stashed the text under the same key fastHmr uses
	// internally. Serving from cache makes the typical edit's
	// endpoint response near-instant (~0.1ms) instead of re-running
	// the full ~50ms compile pipeline a second time.
	//
	// The cache key mirrors fastHmr's `fingerprintId`:
	// `encodeURIComponent('<project-relative-path>@<className>')`.
	const projectRelPath = relative(process.cwd(), componentFilePath).replace(
		/\\/g,
		'/'
	);
	const cacheKey = encodeURIComponent(`${projectRelPath}@${className}`);
	const { takePendingModule } = await import('./fastHmrCompiler');
	const cached = takePendingModule(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	// Detect entity kind from the file content so the surgical path
	// branches correctly (component → IR + prototype patch; pipe /
	// directive / service → prototype patch only). The dispatcher
	// in rebuildTrigger.ts also passes kind, but the
	// `/@ng/component` endpoint is hit directly by the browser too
	// (via the injected `__ng_hmr_load` listener) and that path has
	// only the encoded id — so we re-detect here.
	const { resolveOwningComponents } = await import(
		'./resolveOwningComponents'
	);
	const owners = resolveOwningComponents({
		changedFilePath: componentFilePath,
		userAngularRoot: dirname(componentFilePath)
	});
	const owner = owners.find((o) => o.className === className);
	const kind = owner?.kind ?? 'component';

	const fastStart = performance.now();
	const fast = await tryFastHmr({ className, componentFilePath, kind });
	if (fast.ok) {
		logInfo(
			`[ng-hmr fast/${kind}] ${className} ${(performance.now() - fastStart).toFixed(1)}ms`
		);

		return fast.moduleText;
	}

	logWarn(
		`[ng-hmr slow] ${className} fast path bailed (${fast.reason}${fast.detail ? `: ${fast.detail}` : ''}), falling back to ngtsc`
	);

	const program = getCachedHmrProgram();
	if (!program) return null;
	const node = findClassNodeById(program, encodedId);
	if (!node) return null;
	const raw = program.compiler.emitHmrUpdateModule(node);
	if (!raw) return raw;
	return rewriteSlowPathLocalsToAbsDeps(raw, className);
};

/* Rough symbol→package mapping for the most common Angular runtime
 * packages ngc references when emitting an HMR update. Used to infer
 * the source module of each `const ɵhmrN = ɵɵnamespaces[N];` slot in
 * the slow-path output. Not exhaustive — only what dealroom-shaped
 * apps need. Add more entries as they come up. `@angular/core` is
 * the catch-all when no other package matches. */
const ANGULAR_PACKAGE_SYMBOLS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
	[
		'@angular/common',
		new Set([
			'NgClass',
			'NgComponentOutlet',
			'NgForOf',
			'NgIf',
			'NgTemplateOutlet',
			'NgStyle',
			'NgSwitch',
			'NgSwitchCase',
			'NgSwitchDefault',
			'NgPlural',
			'NgPluralCase',
			'AsyncPipe',
			'UpperCasePipe',
			'LowerCasePipe',
			'JsonPipe',
			'SlicePipe',
			'DecimalPipe',
			'PercentPipe',
			'TitleCasePipe',
			'CurrencyPipe',
			'DatePipe',
			'I18nPluralPipe',
			'I18nSelectPipe',
			'KeyValuePipe',
			'CommonModule'
		])
	],
	[
		'@angular/forms',
		new Set([
			'NgForm',
			'NgModel',
			'NgModelGroup',
			'FormGroupDirective',
			'FormControlDirective',
			'FormControlName',
			'FormArrayName',
			'FormGroupName',
			'NgSelectOption',
			'NgSelectMultipleOption',
			'DefaultValueAccessor',
			'CheckboxControlValueAccessor',
			'NumberValueAccessor',
			'RadioControlValueAccessor',
			'RangeValueAccessor',
			'SelectControlValueAccessor',
			'SelectMultipleControlValueAccessor',
			'MaxValidator',
			'MinValidator',
			'PatternValidator',
			'EmailValidator',
			'RequiredValidator',
			'CheckboxRequiredValidator',
			'MinLengthValidator',
			'MaxLengthValidator'
		])
	],
	[
		'@angular/router',
		new Set([
			'RouterOutlet',
			'RouterLink',
			'RouterLinkActive',
			'RouterLinkWithHref'
		])
	],
	[
		'@angular/animations',
		new Set(['trigger', 'state', 'style', 'transition', 'animate', 'keyframes', 'group', 'sequence', 'query', 'stagger', 'animateChild', 'useAnimation'])
	]
];

const inferNamespaceModule = (
	body: string,
	hmrName: string
): string => {
	if (hmrName === 'ɵhmr0') return '@angular/core';
	// `\b` in JS treats `ɵ` as a non-word char, so `\bɵhmr1\b`
	// misses; use explicit lookarounds instead.
	const re = new RegExp(
		`(?<![\\w$])${hmrName}\\.([A-Za-z_$][\\w$]*)(?![\\w$])`,
		'g'
	);
	const symbols = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		const sym = m[1];
		if (sym) symbols.add(sym);
	}
	let bestPackage = '@angular/core';
	let bestHits = 0;
	for (const [pkg, exports] of ANGULAR_PACKAGE_SYMBOLS) {
		let hits = 0;
		for (const s of symbols) if (exports.has(s)) hits++;
		if (hits > bestHits) {
			bestHits = hits;
			bestPackage = pkg;
		}
	}
	return bestPackage;
};

/* `emitHmrUpdateModule` emits the surgical-update function with two
 * client-incompatible patterns:
 *
 *   - **Free-variable parameters** for every imported identifier:
 *     `function Foo_UpdateMetadata(Foo, ɵɵnamespaces, CommonModule,
 *      ImageComponent, ...)`. Our `__ng_hmr_load` only passes
 *     `[type, namespaces, ...locals]` with `locals = []`, so the
 *     extras end up `undefined`.
 *   - **Multi-namespace `ɵɵnamespaces[N]`** access. Inside the body:
 *     `const ɵhmr0 = ɵɵnamespaces[0]; const ɵhmr1 = ɵɵnamespaces[1];`.
 *     Each `ɵhmrN` is a distinct angular subpackage namespace
 *     (core, common, forms, …). Our injected loader only passes
 *     `[core]`, so anything past index 0 is `undefined`.
 *
 * Rewrite both:
 *   - Drop the local parameters; destructure them from
 *     `${className}.__abs_deps` (populated by `hmrInjectionPlugin`).
 *   - Replace `const ɵhmrN = ɵɵnamespaces[N];` with a top-level
 *     `import * as ɵhmrN from '<inferred-package>';`. The
 *     `/@ng/component` route already runs `rewriteImportsInContent`
 *     after this, which translates bare `@angular/*` specifiers to
 *     dev-vendor URLs the browser can fetch. */
const rewriteSlowPathLocalsToAbsDeps = (
	moduleText: string,
	className: string
): string => {
	let result = moduleText;

	// Step 1 — strip the local parameters, add `__abs_deps` destructure.
	const fnRe = new RegExp(
		`(export\\s+default\\s+function\\s+${className}_UpdateMetadata\\s*\\()([^)]*)(\\)\\s*\\{)`
	);
	const fnMatch = fnRe.exec(result);
	if (fnMatch) {
		const paramsText = fnMatch[2] ?? '';
		const params = paramsText
			.split(',')
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		const fixedParams = params.slice(0, 2);
		const localParams = params.slice(2);
		if (localParams.length > 0) {
			const newSignature = `${fnMatch[1]}${fixedParams.join(', ')}${fnMatch[3]}`;
			const destructure = `\n  const { ${localParams.join(', ')} } = ${className}.__abs_deps || {};\n`;
			result = result.replace(fnRe, newSignature + destructure);
		}
	}

	// Step 2 — replace each `const ɵhmrN = ɵɵnamespaces[N];` with a
	// module-level static import of the inferred angular package.
	const nsDeclRe = /\n?\s*const\s+(ɵhmr\d+)\s*=\s*ɵɵnamespaces\s*\[\s*\d+\s*\]\s*;\s*/g;
	const namespaceImports: string[] = [];
	const seenHmrNames = new Set<string>();
	result = result.replace(nsDeclRe, (_match, hmrName: string) => {
		if (!seenHmrNames.has(hmrName)) {
			seenHmrNames.add(hmrName);
			const pkg = inferNamespaceModule(result, hmrName);
			namespaceImports.push(`import * as ${hmrName} from '${pkg}';`);
		}
		return '\n';
	});
	if (namespaceImports.length > 0) {
		result = `${namespaceImports.join('\n')}\n${result}`;
	}

	// Step 3 — drop `${className}.ɵfac = ...` assignments. The live
	// class's `ɵfac` is defined via a getter (Angular's compiler does
	// this when class metadata is registered) and direct assignment
	// throws `Cannot set property ɵfac of class … which has only a
	// getter`. Tier 0 surgical updates don't need a new factory: the
	// existing factory keeps working since the constructor signature
	// is fingerprint-stable for a Tier 0 to fire in the first place.
	const facAssignRe = new RegExp(
		`\\s*${className}\\.ɵfac\\s*=\\s*function\\s+${className}_Factory\\s*\\([^)]*\\)\\s*\\{[^}]*\\}\\s*;`
	);
	result = result.replace(facAssignRe, '');

	return result;
};

/* Build the raw HMR component id used for two purposes:
 *   1. Server-side `'angular:component-update'` WS broadcast
 *      payload — compared by string-equality against the bundle's
 *      `__ng_hmr_id` constant in the injected listener.
 *   2. The `?c=<id>` query parameter in the surgical-update URL,
 *      where it gets URL-encoded at request time
 *      (`encodeURIComponent(__ng_hmr_id)`).
 *
 * Earlier this function URL-encoded eagerly to match Angular CLI's
 * convention, but our `hmrInjectionPlugin` stores the id raw and
 * encodes only at URL-construction time. The eager-encode caused
 * a string-mismatch in the bundle's listener — the WS payload had
 * `%2F` / `%40` while `__ng_hmr_id` had `/` / `@` — so the
 * listener never matched and nothing fetched. Returning the raw
 * form aligns server and client. */
export const encodeHmrComponentId = (
	absoluteFilePath: string,
	className: string
): string => {
	const projectRel = relative(process.cwd(), absoluteFilePath).replace(
		/\\/g,
		'/'
	);

	return `${projectRel}@${className}`;
};
