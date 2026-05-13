import { existsSync, readFileSync, promises as fs } from 'fs';
import { join, basename, sep, dirname, resolve, relative } from 'path';
import type { CompilerOptions } from '@angular/compiler-cli';
import { Glob } from 'bun';
import ts from 'typescript';
import { BASE_36_RADIX } from '../constants';
import { toPascal } from '../utils/stringModifiers';
import { buildIslandMetadataExports } from '../islands/sourceMetadata';
import {
	lowerAngularDeferSyntax,
	type LoweredAngularDeferSlot
} from '../angular/lowerDeferSyntax';
import {
	compileStyleFileIfNeeded,
	compileStyleFileIfNeededSync
} from './stylePreprocessor';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';
import type { StylePreprocessorConfig } from '../../types/build';

type SyncReadFile = (fileName: string) => string | undefined;

type BuildTracePhase = <T>(
	name: string,
	fn: () => Promise<T> | T,
	metadata?: Record<string, unknown>
) => Promise<T>;

const traceAngularPhase: BuildTracePhase = async (name, fn, metadata) => {
	const tracePhase = (
		globalThis as typeof globalThis & {
			__absoluteBuildTracePhase?: BuildTracePhase;
		}
	).__absoluteBuildTracePhase;

	return tracePhase
		? tracePhase(`compile/angular/${name}`, fn, metadata)
		: await fn();
};

type TsconfigPathAlias = {
	pattern: string;
	replacements: string[];
};

const readTsconfigPathAliases = () => {
	try {
		const configPath = resolve(process.cwd(), 'tsconfig.json');
		const config = ts.readConfigFile(configPath, ts.sys.readFile).config as
			| {
					compilerOptions?: {
						baseUrl?: string;
						paths?: Record<string, string[]>;
					};
			  }
			| undefined;
		const compilerOptions = config?.compilerOptions ?? {};
		const baseUrl = resolve(process.cwd(), compilerOptions.baseUrl ?? '.');
		const aliases: TsconfigPathAlias[] = Object.entries(
			compilerOptions.paths ?? {}
		).map(([pattern, replacements]) => ({ pattern, replacements }));

		return { aliases, baseUrl };
	} catch {
		return { aliases: [] as TsconfigPathAlias[], baseUrl: process.cwd() };
	}
};

const matchTsconfigAlias = (
	specifier: string,
	aliases: TsconfigPathAlias[],
	baseUrl: string,
	resolveSourceFile: (candidate: string) => string | undefined
) => {
	for (const alias of aliases) {
		const wildcardIndex = alias.pattern.indexOf('*');
		const exactMatch = wildcardIndex === -1;
		if (exactMatch && specifier !== alias.pattern) continue;

		const prefix = exactMatch
			? alias.pattern
			: alias.pattern.slice(0, wildcardIndex);
		const suffix = exactMatch ? '' : alias.pattern.slice(wildcardIndex + 1);
		if (
			!exactMatch &&
			(!specifier.startsWith(prefix) || !specifier.endsWith(suffix))
		) {
			continue;
		}

		const wildcardValue = exactMatch
			? ''
			: specifier.slice(prefix.length, specifier.length - suffix.length);
		for (const replacement of alias.replacements) {
			const candidate = replacement.replace('*', wildcardValue);
			const resolved = resolveSourceFile(resolve(baseUrl, candidate));
			if (resolved) return resolved;
		}
	}

	return undefined;
};

const resolveSourceFile = (candidate: string) => {
	const candidates = candidate.match(/\.[cm]?[tj]sx?$/)
		? [candidate]
		: [
				`${candidate}.ts`,
				`${candidate}.tsx`,
				`${candidate}.js`,
				`${candidate}.jsx`,
				join(candidate, 'index.ts'),
				join(candidate, 'index.tsx'),
				join(candidate, 'index.js'),
				join(candidate, 'index.jsx')
			];

	return candidates.find((file) => existsSync(file));
};

const createLegacyAngularAnimationUsageResolver = (rootDir: string) => {
	const baseDir = resolve(rootDir);
	const tsconfigAliases = readTsconfigPathAliases();
	const transpiler = new Bun.Transpiler({ loader: 'tsx' });
	const scanCache = new Map<
		string,
		Promise<{ imports: string[]; usesLegacyAnimations: boolean }>
	>();

	const resolveLocalImport = (specifier: string, fromDir: string) => {
		if (specifier.startsWith('.') || specifier.startsWith('/')) {
			return resolveSourceFile(resolve(fromDir, specifier));
		}

		const aliased = matchTsconfigAlias(
			specifier,
			tsconfigAliases.aliases,
			tsconfigAliases.baseUrl,
			resolveSourceFile
		);
		if (aliased) return aliased;

		try {
			const resolved = Bun.resolveSync(specifier, fromDir);
			if (resolved.includes('/node_modules/')) return undefined;
			const absolute = resolve(resolved);
			if (!absolute.startsWith(baseDir)) return undefined;

			return resolveSourceFile(absolute);
		} catch {
			return undefined;
		}
	};

	const scanFile = (filePath: string) => {
		const actualPath = resolveSourceFile(filePath);
		if (!actualPath) {
			return Promise.resolve({
				imports: [],
				usesLegacyAnimations: false
			});
		}
		const resolved = resolve(actualPath);
		const cached = scanCache.get(resolved);
		if (cached) return cached;

		const promise = (async () => {
			let sourceCode: string;
			try {
				sourceCode = await fs.readFile(resolved, 'utf-8');
			} catch {
				return { imports: [], usesLegacyAnimations: false };
			}

			let imports;
			try {
				imports = transpiler.scanImports(sourceCode);
			} catch {
				return { imports: [], usesLegacyAnimations: false };
			}

			return {
				imports: imports.map((imp) => imp.path),
				usesLegacyAnimations: imports.some(
					(imp) => imp.path === '@angular/animations'
				)
			};
		})();

		scanCache.set(resolved, promise);

		return promise;
	};

	const visit = async (
		filePath: string,
		visited = new Set<string>()
	): Promise<boolean> => {
		const actualPath = resolveSourceFile(filePath);
		if (!actualPath) return false;
		const resolved = resolve(actualPath);
		if (visited.has(resolved)) return false;
		visited.add(resolved);

		const scan = await scanFile(resolved);
		if (scan.usesLegacyAnimations) return true;

		for (const specifier of scan.imports) {
			const importedPath = resolveLocalImport(
				specifier,
				dirname(resolved)
			);
			if (importedPath && (await visit(importedPath, visited))) {
				return true;
			}
		}

		return false;
	};

	return (entryPath: string) => visit(entryPath);
};

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

/* Removed in favor of SURGICAL_HMR (§3.3 — Tier 0 / Tier 1
 * dispatch). The old proto-swap pipeline registered every
 * Component / Service / Directive / Pipe class on a global
 * `window.__ANGULAR_HMR__` registry so the client could attempt
 * an in-place prototype patch on edits. With surgical
 * `ɵɵreplaceMetadata` covering component edits and re-bootstrap
 * covering structural changes, neither code path consumes the
 * registry anymore — keeping the injection just produces dead
 * `if (window.__ANGULAR_HMR__) ...` blocks. The Bun loader plugin
 * (`src/dev/angular/hmrInjectionPlugin.ts`) is the only place
 * that still appends per-component HMR scaffolding, and it does
 * so for the surgical `__ng_hmr_load` listener instead. */

const formatDiagnosticMessage = (diagnostic: ts.Diagnostic) => {
	try {
		return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
	} catch {
		return String(diagnostic.messageText || 'Unknown error');
	}
};

const throwOnCompilationErrors = (
	diagnostics: readonly ts.Diagnostic[] | undefined
) => {
	if (!diagnostics?.length) return;

	const errors = diagnostics.filter(
		(diag) => diag.category === ts.DiagnosticCategory.Error
	);
	if (!errors.length) return;

	const fullMessage = errors.map(formatDiagnosticMessage).join('\n');
	console.error('Angular compilation errors:', fullMessage);
	throw new Error(fullMessage);
};

const resolveRelativePath = (
	fileName: string,
	resolvedOutDir: string,
	outDir: string
) => {
	if (fileName.startsWith(resolvedOutDir))
		return fileName.substring(resolvedOutDir.length + 1);
	if (fileName.startsWith(outDir))
		return fileName.substring(outDir.length + 1);

	return fileName;
};

/* Extensions that are valid module-import targets without rewriting.
 * `.json` is included so `import data from './foo.json'` survives the
 * angular compile pipeline's path rewriter — without it, the rewriter
 * would append `.js` to make `./foo.json.js`, which doesn't exist on
 * disk, and the dev module server returns 500 on the resulting URL. */
const hasJsLikeExtension = (path: string) =>
	/\.(js|ts|mjs|cjs|json)$/.test(path);

const splitSpecifierAndQuery = (specifier: string) => {
	const separator = specifier.indexOf('?');
	if (separator === -1) {
		return {
			path: specifier,
			query: ''
		};
	}

	return {
		path: specifier.substring(0, separator),
		query: specifier.substring(separator)
	};
};

const rewriteRelativeJsSpecifier = (
	importerOutputPath: string,
	specifier: string,
	outputFiles?: Set<string>
) => {
	const { path, query } = splitSpecifierAndQuery(specifier);
	if (path.endsWith('.ts')) return `${path.replace(/\.ts$/, '.js')}${query}`;
	if (hasJsLikeExtension(path)) return `${path}${query}`;

	const importerDir = dirname(importerOutputPath);
	const fileCandidate = resolve(importerDir, `${path}.js`);
	if (outputFiles?.has(fileCandidate) || existsSync(fileCandidate)) {
		return `${path}.js${query}`;
	}

	const indexCandidate = resolve(importerDir, path, 'index.js');
	if (outputFiles?.has(indexCandidate) || existsSync(indexCandidate)) {
		return `${path}/index.js${query}`;
	}

	return `${path}.js${query}`;
};

const isRelativeModuleSpecifier = (specifier: string) =>
	specifier.startsWith('./') || specifier.startsWith('../');

const extractLocalImportSpecifiers = (source: string, fileName: string) => {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const specifiers: string[] = [];
	const addSpecifier = (node: ts.Node | undefined) => {
		if (!node || !ts.isStringLiteralLike(node)) return;
		const specifier = node.text;
		if (isRelativeModuleSpecifier(specifier)) specifiers.push(specifier);
	};

	const visit = (node: ts.Node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			addSpecifier(node.moduleSpecifier);
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			addSpecifier(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return specifiers;
};

const resolveLocalTsImport = (fromFile: string, specifier: string) => {
	if (!isRelativeModuleSpecifier(specifier)) return null;
	const basePath = resolve(dirname(fromFile), specifier);
	const candidates = /\.[cm]?[tj]sx?$/.test(basePath)
		? [basePath]
		: [
				`${basePath}.ts`,
				`${basePath}.tsx`,
				`${basePath}.mts`,
				`${basePath}.cts`,
				join(basePath, 'index.ts'),
				join(basePath, 'index.tsx'),
				join(basePath, 'index.mts'),
				join(basePath, 'index.cts')
			];

	return (
		candidates
			.map((candidate) => resolve(candidate))
			.find(
				(candidate) =>
					existsSync(candidate) && !candidate.endsWith('.d.ts')
			) ?? null
	);
};

const readFileForAotTransform = async (
	fileName: string,
	readFile: SyncReadFile | undefined
) => {
	const hostSource = readFile?.(fileName);
	if (typeof hostSource === 'string') return hostSource;

	return fs.readFile(fileName, 'utf-8');
};

type AotResourceTransformCacheEntry = {
	source: string;
	version: 1;
};

type AotResourceTransformStats = {
	cacheHits: number;
	cacheMisses: number;
	filesVisited: number;
	transformedFiles: number;
};

const safeStableStringify = (value: unknown): string => {
	const seen = new WeakSet<object>();

	return JSON.stringify(value, (_key, entry) => {
		if (typeof entry === 'function') return `[Function:${entry.name}]`;
		if (!entry || typeof entry !== 'object') return entry;
		if (seen.has(entry)) return '[Circular]';
		seen.add(entry);

		if (Array.isArray(entry)) return entry;

		return Object.fromEntries(
			Object.entries(entry).sort(([left], [right]) =>
				left.localeCompare(right)
			)
		);
	});
};

const collectAngularResourcePaths = (source: string, fileDir: string) => {
	const paths: string[] = [];
	const templateUrlMatch = findUncommentedMatch(
		source,
		/templateUrl\s*:\s*['"]([^'"]+)['"]/
	);
	if (templateUrlMatch?.[1]) paths.push(join(fileDir, templateUrlMatch[1]));

	const styleUrlMatch = findUncommentedMatch(
		source,
		/styleUrl\s*:\s*['"]([^'"]+)['"]/
	);
	if (styleUrlMatch?.[1]) paths.push(join(fileDir, styleUrlMatch[1]));

	const styleUrlsMatch = findUncommentedMatch(
		source,
		/styleUrls\s*:\s*\[([^\]]+)\]/
	);
	const urlMatches = styleUrlsMatch?.[1]?.match(/['"]([^'"]+)['"]/g);
	if (urlMatches) {
		for (const urlMatch of urlMatches) {
			paths.push(join(fileDir, urlMatch.replace(/['"]/g, '')));
		}
	}

	return paths.map((path) => resolve(path));
};

const readResourceCacheFile = async (cachePath: string) => {
	try {
		const entry = JSON.parse(
			await fs.readFile(cachePath, 'utf-8')
		) as AotResourceTransformCacheEntry;
		if (entry.version !== 1 || typeof entry.source !== 'string') {
			return null;
		}

		return entry;
	} catch {
		return null;
	}
};

const writeResourceCacheFile = async (cachePath: string, source: string) => {
	await fs.mkdir(dirname(cachePath), { recursive: true });
	await fs.writeFile(
		cachePath,
		JSON.stringify({
			source,
			version: 1
		} satisfies AotResourceTransformCacheEntry),
		'utf-8'
	);
};

const resolveResourceTransformCachePath = async (
	filePath: string,
	source: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const resourcePaths = collectAngularResourcePaths(
		source,
		dirname(filePath)
	);
	const resourceContents = await Promise.all(
		resourcePaths.map(async (resourcePath) => {
			const content = await fs.readFile(resourcePath, 'utf-8');

			return `${resourcePath}\0${content}`;
		})
	);
	const cacheInput = [
		'v1',
		filePath,
		source,
		...resourceContents,
		safeStableStringify(stylePreprocessors ?? null)
	].join('\0');
	const cacheKey = Bun.hash(cacheInput).toString(BASE_36_RADIX);

	return join(
		process.cwd(),
		'.absolutejs',
		'cache',
		'angular-resources',
		`${cacheKey}.json`
	);
};

const precomputeAotResourceTransforms = async (
	inputPaths: string[],
	readFile: SyncReadFile | undefined,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const transformedSources = new Map<string, string>();
	const visited = new Set<string>();
	const stats: AotResourceTransformStats = {
		cacheHits: 0,
		cacheMisses: 0,
		filesVisited: 0,
		transformedFiles: 0
	};

	const transformFile = async (filePath: string) => {
		const resolvedPath = resolve(filePath);
		if (visited.has(resolvedPath)) return;
		visited.add(resolvedPath);
		if (!existsSync(resolvedPath) || resolvedPath.endsWith('.d.ts')) return;
		stats.filesVisited += 1;

		const source = await readFileForAotTransform(resolvedPath, readFile);
		const cachePath = await resolveResourceTransformCachePath(
			resolvedPath,
			source,
			stylePreprocessors
		);
		const cached = await readResourceCacheFile(cachePath);
		let transformedSource: string;
		if (cached) {
			stats.cacheHits += 1;
			transformedSource = cached.source;
		} else {
			stats.cacheMisses += 1;
			const transformed = await inlineResources(
				source,
				dirname(resolvedPath),
				stylePreprocessors
			);
			transformedSource = transformed.source;
			await writeResourceCacheFile(cachePath, transformedSource);
		}
		if (transformedSource !== source) {
			stats.transformedFiles += 1;
			transformedSources.set(resolvedPath, transformedSource);
		}

		const imports = extractLocalImportSpecifiers(source, resolvedPath);
		await Promise.all(
			imports.map(async (specifier) => {
				const resolvedImport = resolveLocalTsImport(
					resolvedPath,
					specifier
				);
				if (resolvedImport) await transformFile(resolvedImport);
			})
		);
	};

	await Promise.all(inputPaths.map((inputPath) => transformFile(inputPath)));

	return { stats, transformedSources };
};

export const compileAngularFiles = async (
	inputPaths: string[],
	outDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const islandMetadataByOutputPath = await traceAngularPhase(
		'aot/island-metadata',
		() =>
			new Map(
				inputPaths.map((inputPath) => {
					const outputPath = resolve(
						join(
							outDir,
							relative(process.cwd(), resolve(inputPath)).replace(
								/\.[cm]?[tj]sx?$/,
								'.js'
							)
						)
					);

					return [
						outputPath,
						buildIslandMetadataExports(
							readFileSync(inputPath, 'utf-8')
						)
					] as const;
				})
			),
		{ entries: inputPaths.length }
	);
	// Load `@angular/compiler` BEFORE anything that transitively pulls in
	// `@angular/common` (which `@angular/compiler-cli` does). The compiler's
	// top-level `publishFacade(globalThis)` registers the JIT compiler facade
	// on `globalThis.ng` — without that, partial-AOT chunks like
	// `_platform_location-chunk.mjs` crash on import with
	// "JIT compilation failed for [class PlatformLocation]" because they
	// call `ɵɵngDeclareFactory` at module load time, which requires the
	// facade to be present.
	await traceAngularPhase(
		'aot/preload-compiler',
		() => import('@angular/compiler')
	);
	const { readConfiguration, performCompilation, EmitFlags } =
		await traceAngularPhase(
			'aot/import-compiler-cli',
			() => import('@angular/compiler-cli')
		);

	const tsLibDir = await traceAngularPhase(
		'aot/resolve-typescript-lib',
		() => {
			// Resolve TypeScript lib directory dynamically (prevents hardcoded paths)
			const tsPath = require.resolve('typescript');
			const tsRootDir = dirname(tsPath);

			return tsRootDir.endsWith('lib')
				? tsRootDir
				: resolve(tsRootDir, 'lib');
		}
	);

	// Read configuration from tsconfig.json to get angularCompilerOptions
	const config = await traceAngularPhase('aot/read-configuration', () =>
		readConfiguration('./tsconfig.json')
	);

	// Build options object with newLine FIRST, then spread config.
	// IMPORTANT: target MUST be ES2022 (not ESNext) to avoid hardcoded lib.esnext.full.d.ts path.
	const options: CompilerOptions = {
		emitDecoratorMetadata: true,
		esModuleInterop: true,
		experimentalDecorators: true,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		newLine: ts.NewLineKind.LineFeed, // Set FIRST - critical for createCompilerHost
		noLib: false,
		outDir,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022, // Use ES2022 instead of ESNext to avoid hardcoded lib paths
		...config.options // Spread AFTER to add Angular options
	};

	// CRITICAL: Force target to ES2022 AFTER spread to ensure it's not overwritten.
	// ESNext target causes hardcoded lib.esnext.full.d.ts path issues.
	options.target = ts.ScriptTarget.ES2022;

	// Force TypeScript legacy decorators required by Angular 21's DI system.
	options.experimentalDecorators = true;
	options.emitDecoratorMetadata = true;

	// Force newLine again after spread to ensure it's not overwritten.
	options.newLine = ts.NewLineKind.LineFeed;

	// Force outDir after spread — config.options may contain an absolute "dist" path
	// that overwrites our outDir, causing deeply nested compiled output.
	options.outDir = outDir;

	// Production examples commonly use noEmit=true for editor/typecheck flows.
	// AOT compilation must override that or Angular silently produces no JS.
	options.noEmit = false;

	// AOT emits into a generated directory that may be cleaned between builds.
	// Reusing the project's incremental tsbuildinfo can make TypeScript skip
	// files that need to be emitted again.
	options.incremental = false;
	options.tsBuildInfoFile = undefined;

	// Explicit rootDir prevents TypeScript from computing it from the single entry file,
	// which would cause imports from other directories to get absolute-path-based output.
	options.rootDir = process.cwd();

	// Use TypeScript's createCompilerHost directly. Keep this host local to the
	// current AOT pass because the overrides below mutate host methods.
	const host = await traceAngularPhase('aot/create-compiler-host', () =>
		ts.createCompilerHost(options)
	);

	// Override lib resolution to use dynamic paths.
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
			const resolvedPath = join(tsLibDir, fileName);

			return originalGetSourceFile?.call(
				host,
				resolvedPath,
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
		const relativePath = resolveRelativePath(
			fileName,
			resolvedOutDir,
			outDir
		);
		emitted[relativePath] = text;
	};
	const originalReadFile = host.readFile;
	const { stats: aotResourceTransformStats, transformedSources } =
		await traceAngularPhase(
			'aot/precompute-resources',
			() =>
				precomputeAotResourceTransforms(
					inputPaths,
					originalReadFile?.bind(host),
					stylePreprocessors
				),
			{ entries: inputPaths.length }
		);
	await traceAngularPhase('aot/resource-cache-summary', () => undefined, {
		cacheHits: aotResourceTransformStats.cacheHits,
		cacheMisses: aotResourceTransformStats.cacheMisses,
		filesVisited: aotResourceTransformStats.filesVisited,
		transformedFiles: aotResourceTransformStats.transformedFiles
	});
	host.readFile = (fileName: string) => {
		const source = originalReadFile
			? originalReadFile.call(host, fileName)
			: undefined;
		if (typeof source !== 'string') return source;
		if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) {
			return source;
		}
		const resolvedPath = resolve(fileName);

		return transformedSources.get(resolvedPath) ?? source;
	};
	const originalGetSourceFileForCompile = host.getSourceFile;
	host.getSourceFile = (
		fileName: string,
		languageVersion: ts.ScriptTarget,
		onError?: (message: string) => void
	) => {
		const source = transformedSources.get(resolve(fileName));
		if (source) {
			return ts.createSourceFile(fileName, source, languageVersion, true);
		}

		return originalGetSourceFileForCompile?.call(
			host,
			fileName,
			languageVersion,
			onError
		);
	};

	let diagnostics: readonly ts.Diagnostic[] | undefined;
	try {
		({ diagnostics } = await traceAngularPhase(
			'aot/perform-compilation',
			() =>
				performCompilation({
					emitFlags: EmitFlags.Default,
					host,
					options,
					rootNames: inputPaths
				}),
			{ entries: inputPaths.length }
		));
	} finally {
		host.readFile = originalReadFile;
		host.getSourceFile = originalGetSourceFileForCompile;
	}

	await traceAngularPhase('aot/check-diagnostics', () =>
		throwOnCompilationErrors(diagnostics)
	);

	const entries = await traceAngularPhase(
		'aot/postprocess-emitted-js',
		() => {
			const rawEntries = Object.entries(emitted)
				.filter(([fileName]) => fileName.endsWith('.js'))
				.map(([fileName, content]) => ({
					content,
					target: join(outDir, fileName)
				}));
			const outputFiles = new Set(
				rawEntries.map(({ target }) => resolve(target))
			);

			return rawEntries.map(({ content, target }) => {
				// Post-process the compiled output:
				// 1. Add .js extensions to imports
				let processedContent = content.replace(
					/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
					(match, quote, path) => {
						const rewritten = rewriteRelativeJsSpecifier(
							target,
							path,
							outputFiles
						);
						if (rewritten !== path) {
							return `from ${quote}${rewritten}${quote}`;
						}

						return match;
					}
				);

				// 2. Fix Angular ɵɵdom* functions to standard ɵɵ* functions
				processedContent = processedContent
					.replace(/ɵɵdomElementStart/g, 'ɵɵelementStart')
					.replace(/ɵɵdomElementEnd/g, 'ɵɵelementEnd')
					.replace(/ɵɵdomElement\(/g, 'ɵɵelement(')
					.replace(/ɵɵdomProperty/g, 'ɵɵproperty')
					.replace(/ɵɵdomListener/g, 'ɵɵlistener');

				// 3. Fix InjectFlags -> InternalInjectFlags (Angular 21+ compatibility)
				// Replace in import statements
				processedContent = processedContent.replace(
					/import\s*{\s*([^}]*)\bInjectFlags\b([^}]*)\s*}\s*from\s*['"]@angular\/core['"]/g,
					(match, before, after) => {
						const cleaned = (before + after)
							.replace(/,\s*,/g, ',')
							.replace(/^\s*,\s*/, '')
							.replace(/,\s*$/, '');

						return cleaned
							? `import { ${cleaned}, InternalInjectFlags } from '@angular/core'`
							: `import { InternalInjectFlags } from '@angular/core'`;
					}
				);
				// Replace usage of InjectFlags
				processedContent = processedContent.replace(
					/\b(?<!Internal)InjectFlags\b/g,
					'InternalInjectFlags'
				);
				processedContent +=
					islandMetadataByOutputPath.get(resolve(target)) ?? '';

				return { content: processedContent, target };
			});
		}
	);

	await traceAngularPhase(
		'aot/write-output',
		() =>
			Promise.all(
				entries.map(async ({ target, content }) => {
					await fs.mkdir(dirname(target), { recursive: true });
					await fs.writeFile(target, content, 'utf-8');
				})
			),
		{ outputs: entries.length }
	);

	return await traceAngularPhase(
		'aot/collect-output-paths',
		() => entries.map(({ target }) => target),
		{ outputs: entries.length }
	);
};

export const compileAngularFile = async (
	inputPath: string,
	outDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => compileAngularFiles([inputPath], outDir, stylePreprocessors);

// Module-level cache: source content hash → compiled output path.
// Skips re-transpilation of unchanged files during HMR, preventing
// bun --hot from re-evaluating the growing module graph on each change.
const jitContentCache = new Map<string, string>();

/* Drop the content-hash entry for a single file so the next
 * `compileAngularFileJIT` call re-writes it even if the source
 * .ts hasn't changed. Used by the HMR disk-refresh path when an
 * inlined resource (template/style) changed underneath a stable
 * component .ts — the cache would otherwise short-circuit the
 * rewrite and leave a stale on-disk component.
 *
 * Preferred over passing a `cacheBuster` to compileAngularFileJIT
 * for that case, because cacheBuster has a *second* effect —
 * appending `?t=…` to every import specifier in the emitted
 * file — that wedges any later bundle pass that doesn't know
 * the cacheBuster value (Bun.build can't resolve
 * `../components/Foo.js?t=…`). */
export const invalidateAngularJitCache = (filePath: string) => {
	jitContentCache.delete(resolve(filePath));
};

// Angular HMR Optimization — Cache the wrapper output (server file content
// + index file content) so we can skip re-reading, rewriting, and index
// generation when only transpilation changed but the wrapper output is identical.
const wrapperOutputCache = new Map<
	string,
	{ serverHash: string; indexHash: string }
>();

const escapeTemplateContent = (content: string) =>
	content
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/\$\{/g, '\\${');

/** Find the next templateUrl/styleUrl/styleUrls property reference in `source`
 *  whose line is not commented out with a leading `//`. Returns the match data
 *  in the same shape RegExp.exec produces, or null if none. Catches the most
 *  common case where users prefix the line with `//` to disable inlining
 *  (otherwise our regex-based replacement would inline the template inside the
 *  comment and the rest of the HTML would leak into source). */
const findUncommentedMatch = (source: string, pattern: RegExp) => {
	const re = new RegExp(
		pattern.source,
		pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
	);
	let match: RegExpExecArray | null;
	while ((match = re.exec(source)) !== null) {
		const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
		const beforeMatch = source.slice(lineStart, match.index);
		if (!/^\s*\/\//.test(beforeMatch)) return match;
	}

	return null;
};

const resolveAngularDeferImportSpecifier = () => {
	const sourceEntry = resolve(
		import.meta.dir,
		'../angular/components/index.ts'
	);
	if (existsSync(sourceEntry)) {
		return sourceEntry.replace(/\\/g, '/');
	}

	return '@absolutejs/absolute/angular/components';
};

const ensureDeferSlotImport = (
	source: string,
	importSpecifier = '@absolutejs/absolute/angular/components'
) => {
	if (source.includes('DeferSlotComponent')) return source;
	const resolvedImportSpecifier = JSON.stringify(importSpecifier);
	const importLine = `import { DeferErrorTemplateDirective, DeferFallbackTemplateDirective, DeferResolvedTemplateDirective, DeferSlotComponent } from ${resolvedImportSpecifier};\n`;
	const lastImportMatch = [...source.matchAll(/^import[\s\S]*?;$/gm)].pop();
	if (!lastImportMatch || lastImportMatch.index === undefined) {
		return importLine + source;
	}
	const insertAt = lastImportMatch.index + lastImportMatch[0].length;

	return `${source.slice(0, insertAt)}\n${importLine}${source.slice(insertAt)}`;
};

const ensureComponentImportsHasDeferSlot = (source: string) => {
	const importListMatch = source.match(/imports\s*:\s*\[([\s\S]*?)\]/);
	if (importListMatch) {
		if (
			/\bDeferSlotComponent\b/.test(importListMatch[1] ?? '') &&
			/\bDeferResolvedTemplateDirective\b/.test(
				importListMatch[1] ?? ''
			) &&
			/\bDeferFallbackTemplateDirective\b/.test(
				importListMatch[1] ?? ''
			) &&
			/\bDeferErrorTemplateDirective\b/.test(importListMatch[1] ?? '')
		) {
			return source;
		}

		return source.replace(
			/imports\s*:\s*\[([\s\S]*?)\]/,
			(match, importsContent: string) => {
				const trimmed = importsContent.trim();
				const entries = trimmed
					.split(',')
					.map((entry) => entry.trim())
					.filter(Boolean);
				for (const requiredImport of [
					'DeferSlotComponent',
					'DeferResolvedTemplateDirective',
					'DeferFallbackTemplateDirective',
					'DeferErrorTemplateDirective'
				]) {
					if (!entries.includes(requiredImport)) {
						entries.push(requiredImport);
					}
				}
				const nextContent = entries.join(', ');

				return `imports: [${nextContent}]`;
			}
		);
	}

	return source.replace(
		/@Component\(\s*{/,
		'@Component({\n\timports: [DeferSlotComponent, DeferResolvedTemplateDirective, DeferFallbackTemplateDirective, DeferErrorTemplateDirective],'
	);
};

const escapeTemplateLiteralValue = (value: string) =>
	value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const skipInterpolatedExpression = (value: string, start: number) => {
	const cursor = start + 2;
	while (cursor < value.length - 1) {
		const end = value.indexOf('}}', cursor);
		if (end < 0) {
			return value.length;
		}

		return end + 2;
	}

	return value.length;
};

const buildResolverTemplateLiteral = (value: string) => {
	const parts: string[] = [];
	let cursor = 0;

	while (cursor < value.length) {
		const interpolationStart = value.indexOf('{{', cursor);
		if (interpolationStart < 0) {
			parts.push(escapeTemplateLiteralValue(value.slice(cursor)));

			break;
		}

		parts.push(
			escapeTemplateLiteralValue(value.slice(cursor, interpolationStart))
		);

		const nextCursor = skipInterpolatedExpression(
			value,
			interpolationStart
		);
		if (nextCursor >= value.length) {
			parts.push(
				escapeTemplateLiteralValue(value.slice(interpolationStart))
			);

			break;
		}

		const rawExpression = value
			.slice(interpolationStart + 2, nextCursor - 2)
			.trim();
		const expression = rawExpression.length === 0 ? "''" : rawExpression;
		const expressionLiteral = JSON.stringify(expression);

		parts.push(
			`\${this.__absoluteDeferResolveTemplateExpression(${expressionLiteral})}`
		);
		cursor = nextCursor;
	}

	return parts.join('');
};

const buildDeferSlotTemplateResolver = () =>
	'\t__absoluteDeferTemplateExpressionCache = new Map<string, string>();\n' +
	'\t__absoluteDeferResolveTemplateExpression(expression: string) {\n' +
	'\t\tconst cached = this.__absoluteDeferTemplateExpressionCache.get(expression);\n' +
	'\t\tif (cached !== undefined) return cached;\n' +
	'\n' +
	'\t\tconst scope = new Proxy(this, {\n' +
	'\t\t\tget: (_target, property) => {\n' +
	'\t\t\t\tconst value = (this as Record<PropertyKey, unknown>)[property];\n' +
	'\t\t\t\treturn typeof value === "function" ? value.bind(this) : value;\n' +
	'\t\t\t}\n' +
	'\t\t});\n' +
	"\t\tlet value = '';\n" +
	'\t\ttry {\n' +
	'\t\t\tconst evaluate = new Function(\n' +
	"\t\t\t\t'scope',\n" +
	'\t\t\t\t"with (scope) { return (" + expression + "); }"\n' +
	'\t\t\t);\n' +
	'\n' +
	'\t\t\tconst resolvedValue = evaluate(scope);\n' +
	"\t\t\tvalue = resolvedValue == null ? '' : String(resolvedValue);\n" +
	'\t\t} catch (_error) {\n' +
	"\t\t\tvalue = '';\n" +
	'\t\t}\n' +
	'\t\tthis.__absoluteDeferTemplateExpressionCache.set(expression, value);\n' +
	'\t\treturn value;\n' +
	'\t}\n\n';

const buildDeferSlotFields = (slots: LoweredAngularDeferSlot[]) =>
	[
		buildDeferSlotTemplateResolver(),
		...slots.map((slot, index) => {
			const htmlField = `\t__absoluteDeferHtml${index} = () => \`${buildResolverTemplateLiteral(slot.resolvedHtml)}\`;\n`;
			const dataField =
				slot.resolvedBindings.length > 0
					? `\t__absoluteDeferData${index} = () => ({\n${slot.resolvedBindings
							.map(
								(binding) =>
									`\t\t"${binding.key}": this.__absoluteDeferResolveTemplateExpression(${JSON.stringify(binding.expression)})`
							)
							.join(',\n')}\n\t});\n`
					: `\t__absoluteDeferData${index} = () => ({});\n`;

			return (
				`${
					htmlField + dataField
				}\t__absoluteDeferResolvePayload${index} = () => new Promise<any>((resolve) => {\n` +
				`\t\tsetTimeout(() => resolve({ kind: 'angular-defer', state: 'resolved', html: this.__absoluteDeferHtml${index}(), data: this.__absoluteDeferData${index}() }), ${slot.delayMs});\n` +
				`\t});\n`
			);
		})
	].join('\n');

const injectDeferSlotFields = (
	source: string,
	slots: LoweredAngularDeferSlot[],
	importSpecifier = '@absolutejs/absolute/angular'
) => {
	if (slots.length === 0) return source;
	let rewritten = ensureDeferSlotImport(source, importSpecifier);
	rewritten = ensureComponentImportsHasDeferSlot(rewritten);
	const fields = buildDeferSlotFields(slots);

	return rewritten.replace(
		/export(?:\s+default)?\s+class\s+([A-Za-z_$][\w$]*)\s*{/,
		(match) => `${match}\n${fields}\n`
	);
};

const readAndEscapeFile = async (
	filePath: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	if (!existsSync(filePath)) {
		throw new Error(
			`Unable to inline Angular style resource: file not found at ${filePath}`
		);
	}
	const content = await compileStyleFileIfNeeded(
		filePath,
		stylePreprocessors
	);

	return escapeTemplateContent(content);
};

const inlineTemplateAndLowerDefer = async (source: string, fileDir: string) => {
	const templateUrlMatch = findUncommentedMatch(
		source,
		/templateUrl\s*:\s*['"]([^'"]+)['"]/
	);
	if (templateUrlMatch?.[1]) {
		const templatePath = join(fileDir, templateUrlMatch[1]);
		if (!existsSync(templatePath)) {
			throw new Error(
				`Unable to inline Angular templateUrl "${templateUrlMatch[1]}": file not found at ${templatePath}`
			);
		}
		const templateRaw = await fs.readFile(templatePath, 'utf-8');
		const lowered = lowerAngularDeferSyntax(templateRaw);
		const escaped = escapeTemplateContent(lowered.template);
		const replacedSource =
			source.slice(0, templateUrlMatch.index) +
			`template: \`${escaped}\`` +
			source.slice(templateUrlMatch.index + templateUrlMatch[0].length);

		return {
			deferSlots: lowered.slots,
			source: injectDeferSlotFields(
				replacedSource,
				lowered.slots,
				resolveAngularDeferImportSpecifier()
			)
		};
	}

	const inlineTemplateMatch = findUncommentedMatch(
		source,
		/template\s*:\s*(`([\s\S]*?)`|'([^']*)'|"([^"]*)")/
	);
	if (!inlineTemplateMatch) {
		return { deferSlots: [] as LoweredAngularDeferSlot[], source };
	}
	const templateRaw =
		inlineTemplateMatch[2] ??
		inlineTemplateMatch[3] ??
		inlineTemplateMatch[4] ??
		'';
	const lowered = lowerAngularDeferSyntax(templateRaw);
	if (lowered.slots.length === 0 && lowered.template === templateRaw) {
		return { deferSlots: lowered.slots, source };
	}
	const escaped = escapeTemplateContent(lowered.template);
	const replacedSource =
		source.slice(0, inlineTemplateMatch.index) +
		`template: \`${escaped}\`` +
		source.slice(inlineTemplateMatch.index + inlineTemplateMatch[0].length);

	return {
		deferSlots: lowered.slots,
		source: injectDeferSlotFields(
			replacedSource,
			lowered.slots,
			resolveAngularDeferImportSpecifier()
		)
	};
};

const inlineTemplateAndLowerDeferSync = (source: string, fileDir: string) => {
	const templateUrlMatch = findUncommentedMatch(
		source,
		/templateUrl\s*:\s*['"]([^'"]+)['"]/
	);
	if (templateUrlMatch?.[1]) {
		const templatePath = join(fileDir, templateUrlMatch[1]);
		if (!existsSync(templatePath)) {
			throw new Error(
				`Unable to inline Angular templateUrl "${templateUrlMatch[1]}": file not found at ${templatePath}`
			);
		}
		const templateRaw = readFileSync(templatePath, 'utf-8');
		const lowered = lowerAngularDeferSyntax(templateRaw);
		const escaped = escapeTemplateContent(lowered.template);
		const replacedSource =
			source.slice(0, templateUrlMatch.index) +
			`template: \`${escaped}\`` +
			source.slice(templateUrlMatch.index + templateUrlMatch[0].length);

		return {
			deferSlots: lowered.slots,
			source: injectDeferSlotFields(
				replacedSource,
				lowered.slots,
				resolveAngularDeferImportSpecifier()
			)
		};
	}

	const inlineTemplateMatch = findUncommentedMatch(
		source,
		/template\s*:\s*(`([\s\S]*?)`|'([^']*)'|"([^"]*)")/
	);
	if (!inlineTemplateMatch) {
		return { deferSlots: [] as LoweredAngularDeferSlot[], source };
	}
	const templateRaw =
		inlineTemplateMatch[2] ??
		inlineTemplateMatch[3] ??
		inlineTemplateMatch[4] ??
		'';
	const lowered = lowerAngularDeferSyntax(templateRaw);
	if (lowered.slots.length === 0 && lowered.template === templateRaw) {
		return { deferSlots: lowered.slots, source };
	}
	const escaped = escapeTemplateContent(lowered.template);
	const replacedSource =
		source.slice(0, inlineTemplateMatch.index) +
		`template: \`${escaped}\`` +
		source.slice(inlineTemplateMatch.index + inlineTemplateMatch[0].length);

	return {
		deferSlots: lowered.slots,
		source: injectDeferSlotFields(
			replacedSource,
			lowered.slots,
			resolveAngularDeferImportSpecifier()
		)
	};
};

const readAndEscapeFileSync = (
	filePath: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	if (!existsSync(filePath)) {
		throw new Error(
			`Unable to inline Angular style resource: file not found at ${filePath}`
		);
	}
	const content = compileStyleFileIfNeededSync(filePath, stylePreprocessors);

	return escapeTemplateContent(content);
};

const inlineStyleUrlsSync = (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlsMatch = findUncommentedMatch(
		source,
		/styleUrls\s*:\s*\[([^\]]+)\]/
	);
	if (!styleUrlsMatch?.[1]) return source;

	const urlMatches = styleUrlsMatch[1].match(/['"]([^'"]+)['"]/g);
	if (!urlMatches) return source;

	const inlinedStyles = urlMatches
		.map((urlMatch) => {
			const styleUrl = urlMatch.replace(/['"]/g, '');

			return readAndEscapeFileSync(
				join(fileDir, styleUrl),
				stylePreprocessors
			);
		})
		.filter(Boolean)
		.map((escaped) => `\`${escaped}\``);
	if (inlinedStyles.length === 0) return source;

	return (
		source.slice(0, styleUrlsMatch.index) +
		`styles: [${inlinedStyles.join(', ')}]` +
		source.slice(styleUrlsMatch.index + styleUrlsMatch[0].length)
	);
};

const inlineSingleStyleUrlSync = (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlMatch = findUncommentedMatch(
		source,
		/styleUrl\s*:\s*['"]([^'"]+)['"]/
	);
	if (!styleUrlMatch?.[1]) return source;

	const escaped = readAndEscapeFileSync(
		join(fileDir, styleUrlMatch[1]),
		stylePreprocessors
	);
	if (!escaped) return source;

	return (
		source.slice(0, styleUrlMatch.index) +
		`styles: [\`${escaped}\`]` +
		source.slice(styleUrlMatch.index + styleUrlMatch[0].length)
	);
};

const inlineResourcesSync = (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const inlinedTemplate = inlineTemplateAndLowerDeferSync(source, fileDir);
	let result = inlinedTemplate.source;
	result = inlineStyleUrlsSync(result, fileDir, stylePreprocessors);
	result = inlineSingleStyleUrlSync(result, fileDir, stylePreprocessors);

	return {
		deferSlots: inlinedTemplate.deferSlots,
		source: result
	};
};

const inlineStyleUrls = async (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlsMatch = findUncommentedMatch(
		source,
		/styleUrls\s*:\s*\[([^\]]+)\]/
	);
	if (!styleUrlsMatch?.[1]) return source;

	const urlMatches = styleUrlsMatch[1].match(/['"]([^'"]+)['"]/g);
	if (!urlMatches) return source;

	const stylePromises = urlMatches.map((urlMatch) => {
		const styleUrl = urlMatch.replace(/['"]/g, '');

		return readAndEscapeFile(join(fileDir, styleUrl), stylePreprocessors);
	});
	const results = await Promise.all(stylePromises);
	const inlinedStyles = results
		.filter(Boolean)
		.map((escaped) => `\`${escaped}\``);
	if (inlinedStyles.length === 0) return source;

	return (
		source.slice(0, styleUrlsMatch.index) +
		`styles: [${inlinedStyles.join(', ')}]` +
		source.slice(styleUrlsMatch.index + styleUrlsMatch[0].length)
	);
};

const inlineSingleStyleUrl = async (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlMatch = findUncommentedMatch(
		source,
		/styleUrl\s*:\s*['"]([^'"]+)['"]/
	);
	if (!styleUrlMatch?.[1]) return source;

	const escaped = await readAndEscapeFile(
		join(fileDir, styleUrlMatch[1]),
		stylePreprocessors
	);
	if (!escaped) return source;

	return (
		source.slice(0, styleUrlMatch.index) +
		`styles: [\`${escaped}\`]` +
		source.slice(styleUrlMatch.index + styleUrlMatch[0].length)
	);
};

/** Inline templateUrl and styleUrls/styleUrl from external files */
const inlineResources = async (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const inlinedTemplate = await inlineTemplateAndLowerDefer(source, fileDir);
	let result = inlinedTemplate.source;
	result = await inlineStyleUrls(result, fileDir, stylePreprocessors);
	result = await inlineSingleStyleUrl(result, fileDir, stylePreprocessors);

	return {
		deferSlots: inlinedTemplate.deferSlots,
		source: result
	};
};

/** Angular HMR Runtime Layer (Level 3) — JIT-mode compilation for dev/HMR builds.
 *  Uses ts.transpileModule() instead of Angular AOT performCompilation().
 *  Inlines templateUrl → template and styleUrls → styles from disk.
 *  Recursively transpiles all local imports so Bun's bundler can resolve them.
 *  ~50-100ms for a tree of ~10 files vs ~500-700ms for AOT. */
export const compileAngularFileJIT = async (
	inputPath: string,
	outDir: string,
	rootDir?: string,
	stylePreprocessors?: StylePreprocessorConfig,
	cacheBuster?: string
) => {
	const entryPath = resolve(inputPath);
	const allOutputs: string[] = [];
	const visited = new Set<string>();
	const baseDir = resolve(rootDir ?? process.cwd());
	let usesLegacyAnimations = false;

	const angularTranspiler = new Bun.Transpiler({
		loader: 'ts',
		tsconfig: JSON.stringify({
			compilerOptions: {
				emitDecoratorMetadata: true,
				experimentalDecorators: true
			}
		})
	});
	const tsconfigAliases = readTsconfigPathAliases();

	const resolveSourceFile = (candidate: string) => {
		const candidates = candidate.match(/\.(?:[cm]?[tj]sx?|json)$/)
			? [candidate]
			: [
					`${candidate}.ts`,
					`${candidate}.tsx`,
					`${candidate}.js`,
					`${candidate}.jsx`,
					`${candidate}.json`,
					join(candidate, 'index.ts'),
					join(candidate, 'index.tsx'),
					join(candidate, 'index.js'),
					join(candidate, 'index.jsx')
				];

		return candidates.find((file) => existsSync(file));
	};

	const resolveLocalImport = (specifier: string, fromDir: string) => {
		if (specifier.startsWith('.') || specifier.startsWith('/')) {
			return resolveSourceFile(resolve(fromDir, specifier));
		}

		const aliased = matchTsconfigAlias(
			specifier,
			tsconfigAliases.aliases,
			tsconfigAliases.baseUrl,
			resolveSourceFile
		);
		if (aliased) return aliased;

		try {
			const resolved = Bun.resolveSync(specifier, fromDir);
			if (resolved.includes('/node_modules/')) return undefined;
			const absolute = resolve(resolved);
			if (!absolute.startsWith(baseDir)) return undefined;

			return resolveSourceFile(absolute);
		} catch {
			return undefined;
		}
	};

	const toOutputPath = (sourcePath: string) => {
		const inputDir = dirname(sourcePath);
		const relativeDir = inputDir.startsWith(baseDir)
			? inputDir.substring(baseDir.length + 1)
			: inputDir;
		// `.ts/.tsx/.js/.jsx` → `.js`. `.json` is preserved
		// (the angular generated tree mirrors the source layout for
		// JSON imports so `import x from './x.json'` resolves).
		const fileBase = basename(sourcePath).replace(/\.[cm]?[tj]sx?$/, '.js');

		return join(outDir, relativeDir, fileBase);
	};

	const withCacheBuster = (specifier: string) => {
		if (!cacheBuster) return specifier;
		return specifier.includes('?')
			? `${specifier}&t=${cacheBuster}`
			: `${specifier}?t=${cacheBuster}`;
	};

	const transpileAndRewrite = (
		sourceCode: string,
		relativeDir: string,
		actualPath: string,
		importRewrites: Map<string, string>
	) => {
		let processedContent = angularTranspiler.transformSync(sourceCode);
		const outputPath = toOutputPath(actualPath);
		const rewriteBareImport = (
			prefix: string,
			specifier: string,
			suffix: string
	) => {
			const rewritten = importRewrites.get(specifier);
			if (rewritten) {
				return `${prefix}${withCacheBuster(rewritten)}${suffix}`;
			}
			if (specifier.startsWith('.') || specifier.startsWith('/')) {
				return `${prefix}${specifier}${suffix}`;
			}

			return `${prefix}${specifier}${suffix}`;
		};

		processedContent = processedContent.replace(
			/(from\s+['"])([^'"]+)(['"])/g,
			(_, prefix, specifier, suffix) =>
				rewriteBareImport(prefix, specifier, suffix)
		);
		processedContent = processedContent.replace(
			/(import\s+['"])([^'"]+)(['"])/g,
			(_, prefix, specifier, suffix) =>
				rewriteBareImport(prefix, specifier, suffix)
		);
		processedContent = processedContent.replace(
			/(import\(\s*['"])([^'"]+)(['"]\s*\))/g,
			(_, prefix, specifier, suffix) =>
				rewriteBareImport(prefix, specifier, suffix)
		);

		processedContent = processedContent.replace(
			/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
			(match, quote, path) => {
				const rewritten = rewriteRelativeJsSpecifier(outputPath, path);
				if (rewritten !== path) {
					return `from ${quote}${rewritten}${quote}`;
				}

				return match;
			}
		);

		const relDepth =
			relativeDir === '' || relativeDir === '.'
				? 0
				: relativeDir.split('/').length;
		processedContent = processedContent.replace(
			/(from\s+['"])(\.\.\/(?:\.\.\/)*)/g,
			(_, prefix, dots) => {
				const upCount = dots.split('/').length - 1;
				if (upCount <= relDepth) return `${prefix}${dots}`;

				return `${prefix}../${dots}`;
			}
		);
		if (resolve(actualPath) === entryPath) {
			processedContent += buildIslandMetadataExports(sourceCode);
		}

		return processedContent;
	};

	/** Transpile a single .ts file and recursively process its local imports */
	const transpileFile = async (filePath: string) => {
		const resolved = resolve(filePath);
		if (visited.has(resolved)) return;
		visited.add(resolved);

		// JSON files: copy to the generated tree unchanged so a
		// consumer's `import x from './x.json'` can resolve relative
		// to its compiled `.js` location at SSR / module-server time.
		// No imports inside JSON, so no recursion.
		if (resolved.endsWith('.json') && existsSync(resolved)) {
			const inputDir = dirname(resolved);
			const relativeDir = inputDir.startsWith(baseDir)
				? inputDir.substring(baseDir.length + 1)
				: inputDir;
			const targetDir = join(outDir, relativeDir);
			const targetPath = join(targetDir, basename(resolved));
			await fs.mkdir(targetDir, { recursive: true });
			await fs.copyFile(resolved, targetPath);
			allOutputs.push(targetPath);
			return;
		}

		// Only transpile .ts files that exist
		let actualPath = resolved;
		if (!actualPath.endsWith('.ts')) actualPath += '.ts';
		if (!existsSync(actualPath)) return;

		let sourceCode = await fs.readFile(actualPath, 'utf-8');

		// Angular HMR Runtime Layer (Level 3) — Inline templateUrl and styleUrls
		// This resolves external resources at transpile time so Angular JIT
		// doesn't try to fetch them via HTTP (which fails on the server)
		const inlined = await inlineResources(
			sourceCode,
			dirname(actualPath),
			stylePreprocessors
		);
		sourceCode = inlineTemplateAndLowerDeferSync(
			inlined.source,
			dirname(actualPath)
		).source;

		// Compute output path preserving directory structure
		const inputDir = dirname(actualPath);
		const relativeDir = inputDir.startsWith(baseDir)
			? inputDir.substring(baseDir.length + 1)
			: inputDir;
		const fileBase = basename(actualPath).replace(/\.[cm]?[tj]sx?$/, '.js');
		const targetDir = join(outDir, relativeDir);
		const targetPath = toOutputPath(actualPath);

		// Find all relative imports to process recursively (needed
		// even when skipping transpilation for cache-hit files).
		// Catches: import/export ... from './x', export * from './x',
		// import './x' (side-effect), and dynamic import('./x').
		const localImports: string[] = [];
		const importRewrites = new Map<string, string>();
		const fromRegex =
			/(?:from|import)\s+['"]([^'".][^'"]*|\.\.?\/[^'"]+)['"]/g;
		const dynamicImportRegex =
			/import\(\s*['"]([^'".][^'"]*|\.\.?\/[^'"]+)['"]\s*\)/g;
		let importMatch;
		while ((importMatch = fromRegex.exec(sourceCode)) !== null) {
			if (importMatch[1]) localImports.push(importMatch[1]);
		}
		while ((importMatch = dynamicImportRegex.exec(sourceCode)) !== null) {
			if (importMatch[1]) localImports.push(importMatch[1]);
		}
		if (localImports.includes('@angular/animations')) {
			usesLegacyAnimations = true;
		}
		const localImportPaths = localImports
			.map((specifier) => {
				const resolved = resolveLocalImport(specifier, inputDir);
				if (!resolved) return null;
				const relativeImport = relative(
					targetDir,
					toOutputPath(resolved)
				)
					.replace(/\\/g, '/')
					.replace(/\.js$/, '');
				const relativeRewrite = relativeImport.startsWith('.')
					? relativeImport
					: `./${relativeImport}`;
				importRewrites.set(specifier, relativeRewrite);

				return resolved;
			})
			.filter((path): path is string => Boolean(path));

		// Skip transpilation if source content hasn't changed — the
		// compiled output on disk is already up-to-date. This avoids
		// unnecessary disk writes that trigger bun --hot re-evaluation
		// and cause progressively slower compile times.
		//
		// `cacheBuster` only forces rewrite of the *entry* file, not
		// recursively-traversed imports. The HMR disk-refresh path
		// uses it when an HTML/CSS resource changed without a TS edit
		// (so the TS hash is stale on the inlined-template view); we
		// don't want it to invalidate the whole import graph too.
		const isEntry = resolve(actualPath) === resolve(entryPath);
		const contentHash = Bun.hash(sourceCode).toString(BASE_36_RADIX);
		const cacheKey = actualPath;
		const shouldWriteFile = cacheBuster && isEntry
			? true
			: jitContentCache.get(cacheKey) !== contentHash ||
				!existsSync(targetPath);
		if (shouldWriteFile) {
			const processedContent = transpileAndRewrite(
				sourceCode,
				relativeDir,
				actualPath,
				importRewrites
			);

			// No inline sourcemap on the intermediate for Angular.
			// Bun.Transpiler doesn't emit sourcemaps, and the
			// decorator-metadata rewrite reshapes the class body
			// aggressively enough that content-matching the
			// original .ts to the transpiled output produces only
			// trivial mappings (imports). Server-side stack frames
			// therefore point at the on-disk intermediate `.js`
			// under `.absolutejs/generated/angular/...` — a real
			// file the developer can open. See docs/HMR_COVERAGE.md
			// open-issues for the path forward (switch the per-file
			// transpile to a Bun.build pass so we get its native
			// sourcemap output).
			await fs.mkdir(targetDir, { recursive: true });
			await fs.writeFile(targetPath, processedContent, 'utf-8');
			jitContentCache.set(cacheKey, contentHash);
		}

		allOutputs.push(targetPath);

		// Recursively transpile local imports
		await Promise.all(
			localImportPaths.map((importPath) => transpileFile(importPath))
		);
	};

	await transpileFile(inputPath);

	const entryOutputPath = toOutputPath(entryPath);
	if (existsSync(entryOutputPath)) {
		const entryOutput = await fs.readFile(entryOutputPath, 'utf-8');
		const withoutLegacyFlag = entryOutput.replace(
			/\nexport const __ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ = true;\n?/g,
			'\n'
		);
		const nextEntryOutput = usesLegacyAnimations
			? `${withoutLegacyFlag}\nexport const __ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ = true;\n`
			: withoutLegacyFlag;
		if (nextEntryOutput !== entryOutput) {
			await fs.writeFile(entryOutputPath, nextEntryOutput, 'utf-8');
		}
	}

	return allOutputs;
};

export const compileAngular = async (
	entryPoints: string[],
	outRoot: string,
	hmr = false,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	// Compile to <projectRoot>/.absolutejs/generated/angular/. The
	// previous layout wrote into <angularDir>/generated/, leaking into
	// the user's source tree. Path math inside this function keeps
	// using `outRoot` (the user's angular source dir) for relative
	// computations — only the *destination root* moves.
	const compiledParent = getFrameworkGeneratedDir('angular');

	if (entryPoints.length === 0) {
		const emptyPaths: string[] = [];

		return { clientPaths: [...emptyPaths], serverPaths: [...emptyPaths] };
	}

	// In dev/HMR a fixed path is required: different file paths produce
	// different ESM cache entries in Bun, which would split Angular into
	// duplicate module instances and trip NG0201/NG0203 token-identity
	// mismatches. Pinning to the gitignored `.absolutejs/generated/`
	// satisfies the constraint while keeping `src/` clean.
	const compiledRoot = compiledParent;
	const indexesDir = join(compiledParent, 'indexes');

	await traceAngularPhase('setup/create-indexes-dir', () =>
		fs.mkdir(indexesDir, { recursive: true })
	);

	const aotOutputs = hmr
		? []
		: await traceAngularPhase(
				'aot/compile-files',
				() =>
					compileAngularFiles(
						entryPoints.map((entry) => resolve(entry)),
						compiledRoot,
						stylePreprocessors
					),
				{ entries: entryPoints.length }
			);
	// AOT mirrors the source tree under `compiledRoot/<rel-from-cwd>/`, so
	// `import x from '../data/foo.json'` from a compiled component must
	// resolve a copy of the JSON in the same relative location. The JIT
	// path copies these inline (see `transpileFile` below); AOT skipped
	// them and the prod server bundle then failed with
	// `Could not resolve: "../data/labels.json"`. Walk the user's angular
	// source dir and mirror every `.json` to the AOT tree.
	if (!hmr) {
		await traceAngularPhase('aot/copy-json-resources', async () => {
			const cwd = process.cwd();
			const angularSrcDir = resolve(outRoot);
			if (!existsSync(angularSrcDir)) return;
			const jsonGlob = new Glob('**/*.json');
			for (const rel of jsonGlob.scanSync({
				absolute: false,
				cwd: angularSrcDir
			})) {
				const sourcePath = join(angularSrcDir, rel);
				const cwdRel = relative(cwd, sourcePath);
				const targetPath = join(compiledRoot, cwdRel);
				await fs.mkdir(dirname(targetPath), { recursive: true });
				await fs.copyFile(sourcePath, targetPath);
			}
		});
	}
	const usesLegacyAngularAnimations = await traceAngularPhase(
		'setup/legacy-animation-resolver',
		() => createLegacyAngularAnimationUsageResolver(outRoot)
	);

	const compileTasks = entryPoints.map(async (entry) => {
		const resolvedEntry = resolve(entry);
		const relativeEntry = relative(outRoot, resolvedEntry).replace(
			/\.[tj]s$/,
			'.js'
		);
		const compileEntry = () =>
			compileAngularFileJIT(
				resolvedEntry,
				compiledRoot,
				outRoot,
				stylePreprocessors
			);

		// Angular HMR Runtime Layer (Level 3) — Use JIT compilation for dev/HMR builds.
		// JIT uses ts.transpileModule() with template/style inlining (~50-100ms)
		// instead of AOT performCompilation() (~500-700ms).
		let outputs = hmr
			? await traceAngularPhase('jit/compile-entry', compileEntry, {
					entry: resolvedEntry
				})
			: aotOutputs;
		const fileBase = basename(resolvedEntry).replace(/\.[tj]s$/, '');
		const jsName = `${fileBase}.js`;
		const compiledFallbackPaths = [
			join(compiledRoot, relativeEntry),
			join(compiledRoot, 'pages', jsName),
			join(compiledRoot, jsName)
		].map((file) => resolve(file));
		const resolveRawServerFile = (candidatePaths: string[]) => {
			const normalizedCandidates = [
				...candidatePaths.map((file) => resolve(file)),
				...compiledFallbackPaths
			];
			// Match by the page's full source-relative path (e.g.
			// `src/frontend/pages/admin/admin.js`). Required for the
			// folder-per-page layout, where basename-only matching can
			// collide with same-named files elsewhere in the project
			// (e.g. `src/types/admin/admin.ts`).
			let candidate = normalizedCandidates.find(
				(file) =>
					existsSync(file) &&
					file.endsWith(`${sep}${relativeEntry}`)
			);
			if (!candidate) {
				candidate = normalizedCandidates.find(
					(file) =>
						existsSync(file) &&
						file.endsWith(`${sep}pages${sep}${jsName}`)
				);
			}
			if (!candidate) {
				candidate = normalizedCandidates.find(
					(file) =>
						existsSync(file) && file.endsWith(`${sep}${jsName}`)
				);
			}
			if (!candidate) {
				candidate = normalizedCandidates.find((file) =>
					existsSync(file)
				);
			}

			return candidate;
		};

		let rawServerFile = await traceAngularPhase(
			'wrapper/resolve-server-output',
			() => resolveRawServerFile(outputs),
			{ entry: resolvedEntry }
		);
		if (!rawServerFile) {
			rawServerFile = await traceAngularPhase(
				'wrapper/resolve-server-output-fallback',
				() => resolveRawServerFile([]),
				{ entry: resolvedEntry }
			);
		}
		if (rawServerFile && !existsSync(rawServerFile)) {
			outputs = hmr ? await compileEntry() : aotOutputs;
			rawServerFile = await traceAngularPhase(
				'wrapper/resolve-server-output-retry',
				() => resolveRawServerFile(outputs),
				{ entry: resolvedEntry }
			);
		}

		if (!rawServerFile || !existsSync(rawServerFile)) {
			throw new Error(
				`Compiled output not found for ${entry}. Looking for: ${jsName}. Available: ${[
					...outputs,
					...compiledFallbackPaths
				].join(', ')}`
			);
		}

		const original = await traceAngularPhase(
			'wrapper/read-server-output',
			() => fs.readFile(rawServerFile, 'utf-8'),
			{ entry: resolvedEntry }
		);

		// Detect the actual exported class so the generated `export default`
		// (and the client-bundle wrappers below) reference a real symbol.
		// Without this, files whose class name doesn't follow the
		// `<Pascal(filename)>Component` convention (e.g. resources.ts
		// exporting `ContentComponent`, admin-debug.ts exporting
		// `AdminLogsComponent`) get a dangling `export default
		// ResourcesComponent` appended, which throws
		// `ReferenceError: <X> is not defined` at module-evaluation time.
		// Surfaces immediately on every request as of Bun 1.3.14 (the
		// loader bug oven-sh/bun#29791 that masked it on retries is fixed).
		const detectExportedComponentClass = (
			source: string
		): string | null => {
			const defaultMatch = source.match(
				/export\s+default\s+([A-Za-z_$][\w$]*)\s*;/
			);
			if (defaultMatch) return defaultMatch[1]!;
			const exportClassMatch = source.match(
				/export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/
			);
			if (exportClassMatch) return exportClassMatch[1]!;
			return null;
		};
		const detectedClassName = await traceAngularPhase(
			'wrapper/detect-component-class',
			() => detectExportedComponentClass(original),
			{ entry: resolvedEntry }
		);
		// `not-found.ts` and similar convention pages export a render
		// function (`renderNotFound`/`renderError`/etc.) instead of a
		// component class. Falling back to a guessed `<Pascal>Component`
		// name when nothing is detected emits a dangling
		// `export default NotFoundComponent;` and the bundle throws
		// `ReferenceError: NotFoundComponent is not defined` at module
		// evaluation. Use the fallback ONLY for the bundle-internal
		// references that need *some* placeholder symbol — and skip the
		// trailing default-export append entirely when nothing real was
		// found.
		const componentClassName =
			detectedClassName ?? `${toPascal(fileBase)}Component`;
		const usesLegacyAnimations = await traceAngularPhase(
			'wrapper/detect-legacy-animations',
			() => usesLegacyAngularAnimations(resolvedEntry),
			{ entry: resolvedEntry }
		);

		// Angular HMR Optimization — Hash the compiled server file content.
		// If it hasn't changed since last HMR cycle, skip all the rewriting,
		// HMR registration injection, SSR deps writing, and index regeneration.
		// This eliminates ~100-500ms of wrapper overhead on cache hits.
		const serverContentHash = Bun.hash(original).toString(BASE_36_RADIX);
		const cachedWrapper = wrapperOutputCache.get(resolvedEntry);
		const clientFile = join(indexesDir, jsName);
		if (
			hmr &&
			cachedWrapper &&
			cachedWrapper.serverHash === serverContentHash &&
			existsSync(clientFile) &&
			(usesLegacyAnimations ||
				!original.includes(
					'__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__'
				)) &&
			(!usesLegacyAnimations ||
				original.includes('__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__'))
		) {
			return {
				clientPath: clientFile,
				indexUnchanged: true,
				serverPath: rawServerFile
			};
		}

		// Ensure the JIT compiler side effect runs before any Angular package
		// imports in generated page modules. Consumer pages usually import
		// @angular/common first, which otherwise trips partial-compile JIT mode.
		let rewritten = original;
		rewritten = rewritten.replace(
			/\nexport const __ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ = true;\n?/g,
			'\n'
		);
		if (!rewritten.includes(`import '@angular/compiler';`)) {
			rewritten = `import '@angular/compiler';\n${rewritten}`;
		}

		// Only add default export if one doesn't already exist AND we
		// actually detected a real class to point it at — convention
		// pages that export a render function (e.g. not-found.ts's
		// `renderNotFound`) intentionally have no default class export.
		if (detectedClassName && !rewritten.includes('export default')) {
			rewritten += `\nexport default ${componentClassName};\n`;
		}
		if (usesLegacyAnimations) {
			rewritten +=
				'\nexport const __ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ = true;\n';
		}

		// Note: proto-swap registration was here. SURGICAL_HMR §3.3
		// replaced it with `hmrInjectionPlugin.ts`, which appends a
		// per-component `__ng_hmr_load` listener at bundle time.

		await traceAngularPhase(
			'wrapper/write-server-output',
			() => fs.writeFile(rawServerFile, rewritten, 'utf-8'),
			{ entry: resolvedEntry }
		);

		// Calculate relative path from indexes directory to the server file
		// This handles deeply nested paths that Angular compiler may create
		const relativePath = relative(indexesDir, rawServerFile).replace(
			/\\/g,
			'/'
		);
		// Ensure it starts with ./ or ../ for relative imports
		const normalizedImportPath = relativePath.startsWith('.')
			? relativePath
			: `./${relativePath}`;

		// Angular HMR Runtime Layer (Level 3) — Import runtime before HMR client
		const hmrPreamble = hmr
			? `window.__HMR_FRAMEWORK__ = "angular";\nimport "${hmrClientPath}";\n`
			: '';
		const hydration = hmr
			? `${hmrPreamble}
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import * as pageModule from '${normalizedImportPath}';

var ${componentClassName} = pageModule.default;
var toScreamingSnake = function(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
};
var isInjectionToken = function(value) {
    return Boolean(value) && typeof value === 'object' && value.ngMetadataName === 'InjectionToken';
};
var pageProps = window.__ABS_ANGULAR_PAGE_PROPS__ || {};
var pageHasIslands = Boolean(pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__) || Boolean(document.querySelector('[data-island="true"]'));
var pageHasRawStreamingSlots = Boolean(document.querySelector('[data-absolute-raw-slot="true"]'));
var pageHasStreamingSlots = Boolean(document.querySelector('[data-absolute-slot="true"]'));
var propProviders = Object.entries(pageProps).map(function(entry) {
    var propName = entry[0];
    var propValue = entry[1];
    var token = pageModule[toScreamingSnake(propName)];
    return isInjectionToken(token) ? { provide: token, useValue: propValue } : null;
}).filter(Boolean);
// Page-level providers, opt-in via \`export const providers = [...]\` in the
// page module. Required so DI tokens that the component (or any service it
// injects) needs are available client-side too — without these, services
// that worked in SSR fail with NG0201 after hydration.
var maybePageProviders = Reflect.get(pageModule, 'providers');
var pageProviders = Array.isArray(maybePageProviders) ? maybePageProviders : [];
var absoluteHttpTransferCacheOptions = {
    includePostRequests: false,
    includeRequestsWithAuthHeaders: false,
    filter: function(request) {
        return !request.headers.has('x-skip-transfer-cache');
    }
};

// SURGICAL_HMR Tier 1 — Re-bootstrap hook. The dev client invokes
// \`window.__ABS_ANGULAR_REBOOTSTRAP__()\` when it receives an
// \`angular:rebootstrap\` WS message; the hook looks up this page's
// freshly-built bundle URL (the rebuild already broadcast its
// updated manifest, so window.__HMR_MANIFEST__ is current) and
// dynamic-imports it. Re-importing the chunk re-runs the
// destroy+bootstrap block below — no special path needed because
// chunk eval is the bootstrap.
window.__ABS_ANGULAR_PAGE_BUNDLE_ID__ = '${toPascal(fileBase)}Index';
window.__ABS_ANGULAR_REBOOTSTRAP__ = async function() {
    var id = window.__ABS_ANGULAR_PAGE_BUNDLE_ID__;
    var manifest = window.__HMR_MANIFEST__ || {};
    var newUrl = manifest[id];
    if (!newUrl) {
        console.warn('[absolutejs] no bundle URL in manifest for', id, '— full reload');
        window.location.reload();
        return;
    }
    await import(newUrl + '?t=' + Date.now());
};

if (window.__ANGULAR_APP__) {
    try { window.__ANGULAR_APP__.destroy(); } catch (_err) { /* ignore */ }
    window.__ANGULAR_APP__ = null;
}

// Ensure root element exists after destroy (Angular removes it)
var _sel = ${componentClassName}.ɵcmp?.selectors?.[0]?.[0] || 'ng-app';
if (!document.querySelector(_sel)) {
    (document.getElementById('root') || document.body).appendChild(document.createElement(_sel));
}

var providers = [provideZonelessChangeDetection()];
if (!window.__HMR_SKIP_HYDRATION__ && !pageHasIslands) {
    providers.push(provideClientHydration(withHttpTransferCacheOptions(absoluteHttpTransferCacheOptions)));
}
delete window.__HMR_SKIP_HYDRATION__;
providers.push.apply(providers, pageProviders);
providers.push.apply(providers, propProviders);
window.__ABS_SLOT_HYDRATION_PENDING__ = pageHasRawStreamingSlots;

if (pageHasRawStreamingSlots) {
    window.__ABS_SLOT_HYDRATION_PENDING__ = false;
    if (typeof window.__ABS_SLOT_FLUSH__ === 'function') {
        requestAnimationFrame(function() {
            window.__ABS_SLOT_FLUSH__();
        });
    }
} else {
    bootstrapApplication(${componentClassName}, {
        providers: providers
    }).then(function (appRef) {
        window.__ANGULAR_APP__ = appRef;
        window.__ABS_SLOT_HYDRATION_PENDING__ = false;
        if (typeof window.__ABS_SLOT_FLUSH__ === 'function') {
            requestAnimationFrame(function() {
                window.__ABS_SLOT_FLUSH__();
            });
        }
    });
}
`.trim()
			: `
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { withHttpTransferCacheOptions } from '@angular/platform-browser';
import { enableProdMode, provideZonelessChangeDetection } from '@angular/core';
import * as pageModule from '${normalizedImportPath}';

var ${componentClassName} = pageModule.default;
var toScreamingSnake = function(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
};
var isInjectionToken = function(value) {
    return Boolean(value) && typeof value === 'object' && value.ngMetadataName === 'InjectionToken';
};
var pageProps = window.__ABS_ANGULAR_PAGE_PROPS__ || {};
var pageHasIslands = Boolean(pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__) || Boolean(document.querySelector('[data-island="true"]'));
var pageHasRawStreamingSlots = Boolean(document.querySelector('[data-absolute-raw-slot="true"]'));
var pageHasStreamingSlots = Boolean(document.querySelector('[data-absolute-slot="true"]'));
var propProviders = Object.entries(pageProps).map(function(entry) {
    var propName = entry[0];
    var propValue = entry[1];
    var token = pageModule[toScreamingSnake(propName)];
    return isInjectionToken(token) ? { provide: token, useValue: propValue } : null;
}).filter(Boolean);
// Page-level providers, opt-in via \`export const providers = [...]\` in the
// page module. Required so DI tokens that the component (or any service it
// injects) needs are available client-side too — without these, services
// that worked in SSR fail with NG0201 after hydration.
var maybePageProviders = Reflect.get(pageModule, 'providers');
var pageProviders = Array.isArray(maybePageProviders) ? maybePageProviders : [];
var absoluteHttpTransferCacheOptions = {
    includePostRequests: false,
    includeRequestsWithAuthHeaders: false,
    filter: function(request) {
        return !request.headers.has('x-skip-transfer-cache');
    }
};

enableProdMode();

var providers = [provideZonelessChangeDetection()].concat(pageProviders).concat(propProviders);
if (!pageHasIslands) {
    providers.unshift(provideClientHydration(withHttpTransferCacheOptions(absoluteHttpTransferCacheOptions)));
}
window.__ABS_SLOT_HYDRATION_PENDING__ = pageHasRawStreamingSlots;

if (pageHasRawStreamingSlots) {
    window.__ABS_SLOT_HYDRATION_PENDING__ = false;
    if (typeof window.__ABS_SLOT_FLUSH__ === 'function') {
        requestAnimationFrame(function() {
            window.__ABS_SLOT_FLUSH__();
        });
    }
} else {
    bootstrapApplication(${componentClassName}, {
        providers: providers
    }).then(function (appRef) {
        window.__ANGULAR_APP__ = appRef;
        window.__ABS_SLOT_HYDRATION_PENDING__ = false;
        if (typeof window.__ABS_SLOT_FLUSH__ === 'function') {
            requestAnimationFrame(function() {
                window.__ABS_SLOT_FLUSH__();
            });
        }
    });
}
`.trim();

		// Angular HMR Optimization — Hash index content to detect if bundling
		// can be skipped (index content is deterministic for a given import path).
		const indexHash = Bun.hash(hydration).toString(BASE_36_RADIX);
		const indexUnchanged = cachedWrapper?.indexHash === indexHash;

		await traceAngularPhase(
			'wrapper/write-client-index',
			() => fs.writeFile(clientFile, hydration, 'utf-8'),
			{ entry: resolvedEntry }
		);

		// Update wrapper cache
		wrapperOutputCache.set(resolvedEntry, {
			indexHash,
			serverHash: serverContentHash
		});

		return {
			clientPath: clientFile,
			indexUnchanged,
			serverPath: rawServerFile
		};
	});

	const results = await traceAngularPhase(
		'wrapper/process-entries',
		() => Promise.all(compileTasks),
		{ entries: entryPoints.length }
	);
	const { clientPaths, serverPaths } = await traceAngularPhase(
		'wrapper/collect-paths',
		() => ({
			clientPaths: results.map((r) => r.clientPath),
			serverPaths: results.map((r) => r.serverPath)
		}),
		{ entries: results.length }
	);

	return {
		// Angular HMR Optimization — Signal to rebuildTrigger that bundling
		// can be skipped when all index files are unchanged.
		allIndexesUnchanged: hmr && results.every((r) => r.indexUnchanged),
		clientPaths,
		serverPaths
	};
};
