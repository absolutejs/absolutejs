import { existsSync, readFileSync, promises as fs } from 'fs';
import { join, basename, sep, dirname, resolve, relative } from 'path';
import type { CompilerOptions } from '@angular/compiler-cli';
import ts from 'typescript';
import { BASE_36_RADIX } from '../constants';
import { toPascal } from '../utils/stringModifiers';
import { createHash } from 'crypto';

// Angular HMR Optimization — Compiler cache interface
// Persists compiler host and options across incremental rebuilds to avoid
// expensive re-creation of TypeScript compiler host (lib dir resolution,
// source file overrides). Only used during dev/HMR; production always fresh.
type AngularCompilerCache = {
	host: ts.CompilerHost;
	options: CompilerOptions;
	configHash: string;
	tsLibDir: string;
	lastUsed: number;
}

// Angular HMR Optimization — Global cache for compiler state
declare global {
	var __angularCompilerCache: AngularCompilerCache | undefined;
}

/** Compute a fast hash of tsconfig.json content for cache invalidation */
const computeConfigHash = () => {
	try {
		const content = readFileSync('./tsconfig.json', 'utf-8');

		return createHash('md5').update(content).digest('hex');
	} catch {
		return '';
	}
};

const resolveDevClientDir = () => {
	const fromSource = resolve(import.meta.dir, '../dev/client');
	if (existsSync(fromSource)) return fromSource;

	return resolve(import.meta.dir, './dev/client');
};

const devClientDir = resolveDevClientDir();

const hmrClientPath = join(devClientDir, 'hmrClient.ts').replace(/\\/g, '/');

// Angular HMR Runtime Layer (Level 3) — Path to runtime module
const hmrRuntimePath = join(devClientDir, 'handlers', 'angularRuntime.ts').replace(/\\/g, '/');

/** Angular HMR Runtime Layer (Level 3) — Inject HMR registration calls into compiled component JS.
 *  Detects exported Angular component classes and appends register() calls.
 *  Only active when hmr=true (dev mode). */
const injectHMRRegistration = (content: string, sourceId: string) => {
	// Find exported component classes: `export class XxxComponent` or `class XxxComponent`
	const componentClassRegex = /(?:export\s+)?class\s+(\w+Component)\s/g;
	const componentNames: string[] = [];
	let match;
	while ((match = componentClassRegex.exec(content)) !== null) {
		if (match[1]) componentNames.push(match[1]);
	}

	if (componentNames.length === 0) return content;

	// Build registration code block
	const registrations = componentNames.map(name =>
		`  if (typeof ${name} === 'function') window.__ANGULAR_HMR__.register('${sourceId}#${name}', ${name});`
	).join('\n');

	const hmrBlock = `\n// Angular HMR Runtime Layer (Level 3) — Auto-registration\nif (typeof window !== 'undefined' && window.__ANGULAR_HMR__) {\n${registrations}\n}\n`;

	return content + hmrBlock;
};

const formatDiagnosticMessage = (diagnostic: ts.Diagnostic) => {
	try {
		return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
	} catch {
		return String(diagnostic.messageText || 'Unknown error');
	}
};

const throwOnCompilationErrors = (diagnostics: readonly ts.Diagnostic[] | undefined) => {
	if (!diagnostics?.length) return;

	const errors = diagnostics.filter(diag => diag.category === ts.DiagnosticCategory.Error);
	if (!errors.length) return;

	const fullMessage = errors.map(formatDiagnosticMessage).join('\n');
	console.error('Angular compilation errors:', fullMessage);
	throw new Error(fullMessage);
};

const resolveRelativePath = (fileName: string, resolvedOutDir: string, outDir: string) => {
	if (fileName.startsWith(resolvedOutDir)) return fileName.substring(resolvedOutDir.length + 1);
	if (fileName.startsWith(outDir)) return fileName.substring(outDir.length + 1);

	return fileName;
};

export const compileAngularFile = async (inputPath: string, outDir: string) => {
	const {
		readConfiguration,
		performCompilation,
		EmitFlags
	} = await import('@angular/compiler-cli');

	// Angular HMR Optimization — Reuse cached compiler host/options when tsconfig unchanged
	const configHash = computeConfigHash();
	const cached = globalThis.__angularCompilerCache;

	let host: ts.CompilerHost;
	let options: CompilerOptions;
	let tsLibDir: string;

	if (cached && cached.configHash === configHash) {
		// Cache hit — reuse host and options, only update outDir
		({ host } = cached);
		options = { ...cached.options, outDir, rootDir: process.cwd() };
		({ tsLibDir } = cached);
		cached.lastUsed = Date.now();
	} else {
		// Cache miss — create fresh compiler host and options
		// Resolve TypeScript lib directory dynamically (prevents hardcoded paths)
		const tsPath = require.resolve('typescript');
		const tsRootDir = dirname(tsPath);
		tsLibDir = tsRootDir.endsWith('lib') ? tsRootDir : resolve(tsRootDir, 'lib');

		// Read configuration from tsconfig.json to get angularCompilerOptions
		const config = readConfiguration('./tsconfig.json');

		// Build options object with newLine FIRST, then spread config
		// IMPORTANT: target MUST be ES2022 (not ESNext) to avoid hardcoded lib.esnext.full.d.ts path
		options = {
			emitDecoratorMetadata: true,
			esModuleInterop: true,
			experimentalDecorators: true,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			newLine: ts.NewLineKind.LineFeed,  // Set FIRST - critical for createCompilerHost
			noLib: false,
			outDir,
			skipLibCheck: true,
			target: ts.ScriptTarget.ES2022, // Use ES2022 instead of ESNext to avoid hardcoded lib paths
			...config.options  // Spread AFTER to add Angular options
		};

		// CRITICAL: Force target to ES2022 AFTER spread to ensure it's not overwritten
		// ESNext target causes hardcoded lib.esnext.full.d.ts path issues
		options.target = ts.ScriptTarget.ES2022;

		// Force TypeScript legacy decorators required by Angular 21's DI system
		options.experimentalDecorators = true;
		options.emitDecoratorMetadata = true;

		// Force newLine again after spread to ensure it's not overwritten
		options.newLine = ts.NewLineKind.LineFeed;

		// Force outDir after spread — config.options may contain an absolute "dist" path
		// that overwrites our outDir, causing deeply nested compiled output
		options.outDir = outDir;

		// Explicit rootDir prevents TypeScript from computing it from the single entry file,
		// which would cause imports from other directories to get absolute-path-based output
		options.rootDir = process.cwd();

		// Use TypeScript's createCompilerHost directly
		host = ts.createCompilerHost(options);

		// Override lib resolution to use dynamic paths
		const originalGetDefaultLibLocation = host.getDefaultLibLocation;
		host.getDefaultLibLocation = () => tsLibDir || (originalGetDefaultLibLocation ? originalGetDefaultLibLocation() : '');

		const originalGetDefaultLibFileName = host.getDefaultLibFileName;
		host.getDefaultLibFileName = (opts: ts.CompilerOptions) => {
			const fileName = originalGetDefaultLibFileName ? originalGetDefaultLibFileName(opts) : 'lib.d.ts';

			return basename(fileName);
		};

		const originalGetSourceFile = host.getSourceFile;
		host.getSourceFile = (fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void) => {
			if (fileName.startsWith('lib.') && fileName.endsWith('.d.ts') && tsLibDir) {
				const resolvedPath = join(tsLibDir, fileName);

				return originalGetSourceFile?.call(host, resolvedPath, languageVersion, onError);
			}

			return originalGetSourceFile?.call(host, fileName, languageVersion, onError);
		};

		// Angular HMR Optimization — Persist cache for next rebuild
		globalThis.__angularCompilerCache = {
			configHash,
			host,
			lastUsed: Date.now(),
			options: { ...options },
			tsLibDir
		};
	}

	const emitted: Record<string, string> = {};
	const resolvedOutDir = resolve(outDir);
	host.writeFile = (fileName, text) => {
		const relativePath = resolveRelativePath(fileName, resolvedOutDir, outDir);
		emitted[relativePath] = text;
	};

	const { diagnostics } = performCompilation({
		emitFlags: EmitFlags.Default,
		host,
		options,
		rootNames: [inputPath]
	});

	throwOnCompilationErrors(diagnostics);

	const entries = Object.entries(emitted)
		.filter(([fileName]) => fileName.endsWith('.js'))
		.map(([fileName, content]) => {
			const target = join(outDir, fileName);

			// Post-process the compiled output:
			// 1. Add .js extensions to imports
			let processedContent = content.replace(
				/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
				(match, quote, path) => {
					if (!path.match(/\.(js|ts|mjs|cjs)$/)) {
						return `from ${quote}${path}.js${quote}`;
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
					const cleaned = (before + after).replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').replace(/,\s*$/, '');

					return cleaned ? `import { ${cleaned}, InternalInjectFlags } from '@angular/core'` : `import { InternalInjectFlags } from '@angular/core'`;
				}
			);
			// Replace usage of InjectFlags
			processedContent = processedContent.replace(/\b(?<!Internal)InjectFlags\b/g, 'InternalInjectFlags');

			return { content: processedContent, target };
		});

	await Promise.all(
		entries.map(({ target }) =>
			fs.mkdir(dirname(target), { recursive: true })
		)
	);
	await Promise.all(
		entries.map(({ target, content }) =>
			fs.writeFile(target, content, 'utf-8')
		)
	);

	return entries.map(({ target }) => target);
};

// Module-level cache: source content hash → compiled output path.
// Skips re-transpilation of unchanged files during HMR, preventing
// bun --hot from re-evaluating the growing module graph on each change.
const jitContentCache = new Map<string, string>();

// Angular HMR Optimization — Cache the wrapper output (server file content
// + index file content) so we can skip re-reading, rewriting, and index
// generation when only transpilation changed but the wrapper output is identical.
const wrapperOutputCache = new Map<string, { serverHash: string; indexHash: string }>();

const escapeTemplateContent = (content: string) => content
	.replace(/\\/g, '\\\\')
	.replace(/`/g, '\\`')
	.replace(/\$\{/g, '\\${');

const readAndEscapeFile = async (filePath: string) => {
	if (!existsSync(filePath)) return null;
	const content = await fs.readFile(filePath, 'utf-8');

	return escapeTemplateContent(content);
};

const inlineTemplateUrl = async (source: string, fileDir: string) => {
	const templateUrlMatch = source.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
	if (!templateUrlMatch?.[1]) return source;

	const escaped = await readAndEscapeFile(join(fileDir, templateUrlMatch[1]));
	if (!escaped) return source;

	return source.replace(/templateUrl\s*:\s*['"][^'"]+['"]/, `template: \`${escaped}\``);
};

const inlineStyleUrls = async (source: string, fileDir: string) => {
	const styleUrlsMatch = source.match(/styleUrls\s*:\s*\[([^\]]+)\]/);
	if (!styleUrlsMatch?.[1]) return source;

	const urlMatches = styleUrlsMatch[1].match(/['"]([^'"]+)['"]/g);
	if (!urlMatches) return source;

	const stylePromises = urlMatches.map(urlMatch => {
		const styleUrl = urlMatch.replace(/['"]/g, '');

		return readAndEscapeFile(join(fileDir, styleUrl));
	});
	const results = await Promise.all(stylePromises);
	const inlinedStyles = results.filter(Boolean).map(escaped => `\`${escaped}\``);
	if (inlinedStyles.length === 0) return source;

	return source.replace(/styleUrls\s*:\s*\[[^\]]+\]/, `styles: [${inlinedStyles.join(', ')}]`);
};

const inlineSingleStyleUrl = async (source: string, fileDir: string) => {
	const styleUrlMatch = source.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/);
	if (!styleUrlMatch?.[1]) return source;

	const escaped = await readAndEscapeFile(join(fileDir, styleUrlMatch[1]));
	if (!escaped) return source;

	return source.replace(/styleUrl\s*:\s*['"][^'"]+['"]/, `styles: [\`${escaped}\`]`);
};

/** Inline templateUrl and styleUrls/styleUrl from external files */
const inlineResources = async (source: string, fileDir: string) => {
	let result = await inlineTemplateUrl(source, fileDir);
	result = await inlineStyleUrls(result, fileDir);
	result = await inlineSingleStyleUrl(result, fileDir);

	return result;
};

/** Angular HMR Runtime Layer (Level 3) — JIT-mode compilation for dev/HMR builds.
 *  Uses ts.transpileModule() instead of Angular AOT performCompilation().
 *  Inlines templateUrl → template and styleUrls → styles from disk.
 *  Recursively transpiles all local imports so Bun's bundler can resolve them.
 *  ~50-100ms for a tree of ~10 files vs ~500-700ms for AOT. */
export const compileAngularFileJIT = async (inputPath: string, outDir: string, rootDir?: string) => {
	const allOutputs: string[] = [];
	const visited = new Set<string>();
	const baseDir = resolve(rootDir ?? process.cwd());

	const angularTranspiler = new Bun.Transpiler({
		loader: 'ts',
		tsconfig: JSON.stringify({
			compilerOptions: {
				emitDecoratorMetadata: true,
				experimentalDecorators: true
			}
		})
	});

	/** Transpile a single .ts file and recursively process its local imports */
	const transpileFile = async (filePath: string) => {
		const resolved = resolve(filePath);
		if (visited.has(resolved)) return;
		visited.add(resolved);

		// Only transpile .ts files that exist
		let actualPath = resolved;
		if (!actualPath.endsWith('.ts')) actualPath += '.ts';
		if (!existsSync(actualPath)) return;

		let sourceCode = await fs.readFile(actualPath, 'utf-8');

		// Angular HMR Runtime Layer (Level 3) — Inline templateUrl and styleUrls
		// This resolves external resources at transpile time so Angular JIT
		// doesn't try to fetch them via HTTP (which fails on the server)
		sourceCode = await inlineResources(sourceCode, dirname(actualPath));

		// Compute output path preserving directory structure
		const inputDir = dirname(actualPath);
		const relativeDir = inputDir.startsWith(baseDir)
			? inputDir.substring(baseDir.length + 1)
			: inputDir;
		const fileBase = basename(actualPath).replace(/\.ts$/, '.js');
		const targetDir = join(outDir, relativeDir);
		const targetPath = join(targetDir, fileBase);

		// Find all relative imports to process recursively (needed
		// even when skipping transpilation for cache-hit files)
		const importRegex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
		const localImports: string[] = [];
		let importMatch;
		while ((importMatch = importRegex.exec(sourceCode)) !== null) {
			if (importMatch[1]) localImports.push(importMatch[1]);
		}

		// Skip transpilation if source content hasn't changed — the
		// compiled output on disk is already up-to-date. This avoids
		// unnecessary disk writes that trigger bun --hot re-evaluation
		// and cause progressively slower compile times.
		const contentHash = Bun.hash(sourceCode).toString(BASE_36_RADIX);
		const cacheKey = actualPath;
		if (jitContentCache.get(cacheKey) === contentHash && existsSync(targetPath)) {
			allOutputs.push(targetPath);
		} else {
			// Transpile with Bun.Transpiler (233x faster than ts.transpileModule).
			// Legacy decorators emit bun:wrap imports, resolved by Bun.build.
			let processedContent = angularTranspiler.transformSync(sourceCode);

			// Add .js extensions to relative imports
			processedContent = processedContent.replace(
				/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
				(match, quote, path) => {
					if (!path.match(/\.(js|ts|mjs|cjs)$/)) {
						return `from ${quote}${path}.js${quote}`;
					}
					// Replace .ts extension with .js
					if (path.endsWith('.ts')) {
						return `from ${quote}${path.replace(/\.ts$/, '.js')}${quote}`;
					}

					return match;
				}
			);

			// Rewrite relative imports that escape the framework root.
			// Source is at angularRoot/<relDir>/file.ts, output is at
			// angularRoot/generated/<relDir>/file.js — 1 extra level.
			const relDepth = relativeDir === '' || relativeDir === '.' ? 0 : relativeDir.split('/').length;
			processedContent = processedContent.replace(
				/(from\s+['"])(\.\.\/(?:\.\.\/)*)/g,
				(_, prefix, dots) => {
					const upCount = dots.split('/').length - 1;
					if (upCount <= relDepth) return `${prefix}${dots}`;

					return `${prefix}../${dots}`;
				}
			);

			await fs.mkdir(targetDir, { recursive: true });
			await fs.writeFile(targetPath, processedContent, 'utf-8');
			allOutputs.push(targetPath);
			jitContentCache.set(cacheKey, contentHash);
		}

		// Recursively transpile local imports
		const inputDirForResolve = dirname(actualPath);
		await Promise.all(
			localImports.map((imp) => {
				const importPath = resolve(inputDirForResolve, imp);

				return transpileFile(importPath);
			})
		);
	};

	await transpileFile(inputPath);

	return allOutputs;
};

export const compileAngular = async (
	entryPoints: string[],
	outRoot: string,
	hmr = false
) => {
	const compiledParent = join(outRoot, 'generated');

	if (entryPoints.length === 0) {
		const emptyPaths: string[] = [];

		return { clientPaths: [...emptyPaths], serverPaths: [...emptyPaths] };
	}

	// Compile to .absolutejs/generated/angular/. Server files are bundled by
	// Bun's server pass (same as Svelte/Vue) and cleanup() removes generated/
	// after bundling. In dev/HMR, a fixed path avoids duplicate Angular
	// module instances (different file paths → different ESM cache entries),
	// preventing NG0201/NG0203 token identity mismatches.
	const compiledRoot = compiledParent;
	const indexesDir = join(compiledParent, 'indexes');

	await fs.mkdir(indexesDir, { recursive: true });

	const compileTasks = entryPoints.map(async (entry) => {
		// Angular HMR Runtime Layer (Level 3) — Use JIT compilation for dev/HMR builds.
		// JIT uses ts.transpileModule() with template/style inlining (~50-100ms)
		// instead of AOT performCompilation() (~500-700ms).
		const outputs = hmr
			? await compileAngularFileJIT(entry, compiledRoot, outRoot)
			: await compileAngularFile(entry, compiledRoot);
		const fileBase = basename(entry).replace(/\.[tj]s$/, '');
		const jsName = `${fileBase}.js`;

		// Try to find the file in pages/ subdirectory first, then at root
		let rawServerFile = outputs.find((file) =>
			file.endsWith(`${sep}pages${sep}${jsName}`)
		);

		// If not found in pages/, try root level
		if (!rawServerFile) {
			rawServerFile = outputs.find((file) => file.endsWith(`${sep}${jsName}`));
		}

		if (!rawServerFile) {
			throw new Error(`Compiled output not found for ${entry}. Looking for: ${jsName}. Available: ${outputs.join(', ')}`);
		}

		const original = await fs.readFile(rawServerFile, 'utf-8');
		const componentClassName = `${toPascal(fileBase)}Component`;

		// Angular HMR Optimization — Hash the compiled server file content.
		// If it hasn't changed since last HMR cycle, skip all the rewriting,
		// HMR registration injection, SSR deps writing, and index regeneration.
		// This eliminates ~100-500ms of wrapper overhead on cache hits.
		const serverContentHash = Bun.hash(original).toString(BASE_36_RADIX);
		const cachedWrapper = wrapperOutputCache.get(entry);
		const clientFile = join(indexesDir, jsName);
		if (hmr && cachedWrapper && cachedWrapper.serverHash === serverContentHash && existsSync(clientFile)) {
			return { clientPath: clientFile, indexUnchanged: true, serverPath: rawServerFile };
		}

		// Replace templateUrl if it exists
		let rewritten = original.replace(
			new RegExp(`templateUrl:\\s*['"]\\.\\/${fileBase}\\.html['"]`),
			`templateUrl: '../../pages/${fileBase}.html'`
		);

		// Only add default export if one doesn't already exist
		if (!rewritten.includes('export default')) {
			rewritten += `\nexport default ${componentClassName};\n`;
		}

		// Angular HMR Runtime Layer (Level 3) — Inject HMR registration in dev mode
		if (hmr) {
			rewritten = injectHMRRegistration(rewritten, entry);

			// Write Angular dependency re-exports to a SEPARATE file so
			// they don't leak into the client bundle (require() doesn't
			// work in browsers). handleAngularPageRequest imports this
			// sibling file for identity-safe SSR rendering.
			const ssrDepsFile = rawServerFile.replace(/\.js$/, '.ssr-deps.js');
			const ssrDepsContent = [
				'// HMR SSR: re-export Angular deps for identity-safe SSR rendering.',
				'// Separate file to avoid bundling require() calls into client code.',
				'export const __angularCore = require("@angular/core");',
				'export const __angularPlatformServer = require("@angular/platform-server");',
				'export const __angularPlatformBrowser = require("@angular/platform-browser");',
				'export const __angularCommon = require("@angular/common");',
				''
			].join('\n');
			await fs.writeFile(ssrDepsFile, ssrDepsContent, 'utf-8');
		}

		await fs.writeFile(rawServerFile, rewritten, 'utf-8');

		// Calculate relative path from indexes directory to the server file
		// This handles deeply nested paths that Angular compiler may create
		const relativePath = relative(indexesDir, rawServerFile).replace(/\\/g, '/');
		// Ensure it starts with ./ or ../ for relative imports
		const normalizedImportPath = relativePath.startsWith('.')
			? relativePath
			: `./${  relativePath}`;

		// Angular HMR Runtime Layer (Level 3) — Import runtime before HMR client
		const hmrPreamble = hmr
			? `window.__HMR_FRAMEWORK__ = "angular";\nimport "${hmrRuntimePath}";\nimport "${hmrClientPath}";\n`
			: '';
		const hydration = hmr ? `${hmrPreamble}
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import ${componentClassName} from '${normalizedImportPath}';

// Re-Bootstrap HMR with View Transitions API
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
if (!window.__HMR_SKIP_HYDRATION__) {
    providers.push(provideClientHydration());
}
delete window.__HMR_SKIP_HYDRATION__;

bootstrapApplication(${componentClassName}, {
    providers: providers
}).then(function (appRef) {
    window.__ANGULAR_APP__ = appRef;
});
`.trim() : `
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { enableProdMode, provideZonelessChangeDetection } from '@angular/core';
import ${componentClassName} from '${normalizedImportPath}';

enableProdMode();

bootstrapApplication(${componentClassName}, {
    providers: [provideClientHydration(), provideZonelessChangeDetection()]
}).then(function (appRef) {
    window.__ANGULAR_APP__ = appRef;
});
`.trim();

		// Angular HMR Optimization — Hash index content to detect if bundling
		// can be skipped (index content is deterministic for a given import path).
		const indexHash = Bun.hash(hydration).toString(BASE_36_RADIX);
		const indexUnchanged = cachedWrapper?.indexHash === indexHash;

		await fs.writeFile(clientFile, hydration, 'utf-8');

		// Update wrapper cache
		wrapperOutputCache.set(entry, { indexHash, serverHash: serverContentHash });

		return { clientPath: clientFile, indexUnchanged, serverPath: rawServerFile };
	});

	const results = await Promise.all(compileTasks);
	const serverPaths = results.map((r) => r.serverPath);
	const clientPaths = results.map((r) => r.clientPath);

	return {
		// Angular HMR Optimization — Signal to rebuildTrigger that bundling
		// can be skipped when all index files are unchanged.
		allIndexesUnchanged: hmr && results.every((r) => r.indexUnchanged),
		clientPaths,
		serverPaths
	};
};
