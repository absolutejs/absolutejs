import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { join, basename, sep, dirname, resolve, relative } from 'path';
import {
	readConfiguration,
	performCompilation,
	EmitFlags
} from '@angular/compiler-cli';
import type { CompilerOptions } from '@angular/compiler-cli';
import ts from 'typescript';
import { toPascal } from '../utils/stringModifiers';
import { createHash } from 'crypto';

// Angular HMR Optimization — Compiler cache interface
// Persists compiler host and options across incremental rebuilds to avoid
// expensive re-creation of TypeScript compiler host (lib dir resolution,
// source file overrides). Only used during dev/HMR; production always fresh.
interface AngularCompilerCache {
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
const computeConfigHash = (): string => {
	try {
		const content = readFileSync('./tsconfig.json', 'utf-8');
		return createHash('md5').update(content).digest('hex');
	} catch {
		return '';
	}
};

const devClientDir = (() => {
	const fromSource = resolve(import.meta.dir, '../dev/client');
	if (existsSync(fromSource)) return fromSource;

	return resolve(import.meta.dir, './dev/client');
})();

const hmrClientPath = join(devClientDir, 'hmrClient.ts').replace(/\\/g, '/');

// Angular HMR Runtime Layer (Level 3) — Path to runtime module
const hmrRuntimePath = join(devClientDir, 'handlers', 'angularRuntime.ts').replace(/\\/g, '/');

/** Angular HMR Runtime Layer (Level 3) — Inject HMR registration calls into compiled component JS.
 *  Detects exported Angular component classes and appends register() calls.
 *  Only active when hmr=true (dev mode). */
const injectHMRRegistration = (content: string, sourceId: string): string => {
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

export const compileAngularFile = async (inputPath: string, outDir: string) => {
	// Angular HMR Optimization — Reuse cached compiler host/options when tsconfig unchanged
	const configHash = computeConfigHash();
	const cached = globalThis.__angularCompilerCache;

	let host: ts.CompilerHost;
	let options: CompilerOptions;
	let tsLibDir: string;

	if (cached && cached.configHash === configHash) {
		// Cache hit — reuse host and options, only update outDir
		host = cached.host;
		options = { ...cached.options, outDir, rootDir: process.cwd() };
		tsLibDir = cached.tsLibDir;
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
			newLine: ts.NewLineKind.LineFeed,  // Set FIRST - critical for createCompilerHost
			target: ts.ScriptTarget.ES2022, // Use ES2022 instead of ESNext to avoid hardcoded lib paths
			module: ts.ModuleKind.ESNext,
			outDir,
			experimentalDecorators: false,
			emitDecoratorMetadata: false,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			esModuleInterop: true,
			skipLibCheck: true,
			noLib: false,
			...config.options  // Spread AFTER to add Angular options
		};

		// CRITICAL: Force target to ES2022 AFTER spread to ensure it's not overwritten
		// ESNext target causes hardcoded lib.esnext.full.d.ts path issues
		options.target = ts.ScriptTarget.ES2022;

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
		host.getDefaultLibLocation = () => {
			return tsLibDir || (originalGetDefaultLibLocation ? originalGetDefaultLibLocation() : '');
		};

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
			host,
			options: { ...options },
			configHash,
			tsLibDir,
			lastUsed: Date.now()
		};
	}

	const emitted: Record<string, string> = {};
	const resolvedOutDir = resolve(outDir);
	host.writeFile = (fileName, text) => {
		const relativePath = fileName.startsWith(resolvedOutDir)
			? fileName.substring(resolvedOutDir.length + 1)
			: fileName.startsWith(outDir)
				? fileName.substring(outDir.length + 1)
				: fileName;
		emitted[relativePath] = text;
	};

	const { diagnostics } = performCompilation({
		emitFlags: EmitFlags.Default,
		host,
		options,
		rootNames: [inputPath]
	});

	if (diagnostics?.length) {
		const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
		if (errors.length) {
			const errorMessages: string[] = [];
			for (const diagnostic of errors) {
				try {
					const message = ts.flattenDiagnosticMessageText(
						diagnostic.messageText,
						'\n'
					);
					errorMessages.push(message);
				} catch (e) {
					errorMessages.push(String(diagnostic.messageText || 'Unknown error'));
				}
			}
			const fullMessage = errorMessages.join('\n');
			console.error('Angular compilation errors:', fullMessage);
			throw new Error(fullMessage);
		}
	}

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

/** Angular HMR Runtime Layer (Level 3) — JIT-mode compilation for dev/HMR builds.
 *  Uses ts.transpileModule() instead of Angular AOT performCompilation().
 *  Inlines templateUrl → template and styleUrls → styles from disk.
 *  Recursively transpiles all local imports so Bun's bundler can resolve them.
 *  ~50-100ms for a tree of ~10 files vs ~500-700ms for AOT. */
export const compileAngularFileJIT = async (inputPath: string, outDir: string) => {
	const allOutputs: string[] = [];
	const visited = new Set<string>();

	const transpileOpts: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		experimentalDecorators: true,
		emitDecoratorMetadata: true,
		esModuleInterop: true,
		skipLibCheck: true,
		declaration: false,
		sourceMap: false
	};

	const cwd = process.cwd();

	/** Inline templateUrl and styleUrls/styleUrl from external files */
	const inlineResources = async (source: string, fileDir: string): Promise<string> => {
		let result = source;

		// Inline templateUrl: './foo.html' → template: `<content>`
		const templateUrlMatch = result.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
		if (templateUrlMatch && templateUrlMatch[1]) {
			const templatePath = join(fileDir, templateUrlMatch[1]);
			if (existsSync(templatePath)) {
				const templateContent = await fs.readFile(templatePath, 'utf-8');
				// Escape backticks and ${} in template content
				const escaped = templateContent
					.replace(/\\/g, '\\\\')
					.replace(/`/g, '\\`')
					.replace(/\$\{/g, '\\${');
				result = result.replace(
					/templateUrl\s*:\s*['"][^'"]+['"]/,
					`template: \`${escaped}\``
				);
			}
		}

		// Inline styleUrls: ['./foo.css'] → styles: [`<content>`]
		const styleUrlsMatch = result.match(/styleUrls\s*:\s*\[([^\]]+)\]/);
		if (styleUrlsMatch && styleUrlsMatch[1]) {
			const urlMatches = styleUrlsMatch[1].match(/['"]([^'"]+)['"]/g);
			if (urlMatches) {
				const inlinedStyles: string[] = [];
				for (const urlMatch of urlMatches) {
					const styleUrl = urlMatch.replace(/['"]/g, '');
					const stylePath = join(fileDir, styleUrl);
					if (existsSync(stylePath)) {
						const styleContent = await fs.readFile(stylePath, 'utf-8');
						const escaped = styleContent
							.replace(/\\/g, '\\\\')
							.replace(/`/g, '\\`')
							.replace(/\$\{/g, '\\${');
						inlinedStyles.push(`\`${escaped}\``);
					}
				}
				if (inlinedStyles.length > 0) {
					result = result.replace(
						/styleUrls\s*:\s*\[[^\]]+\]/,
						`styles: [${inlinedStyles.join(', ')}]`
					);
				}
			}
		}

		// Inline singular styleUrl: './foo.css' → styles: [`<content>`]
		const styleUrlMatch = result.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/);
		if (styleUrlMatch && styleUrlMatch[1]) {
			const stylePath = join(fileDir, styleUrlMatch[1]);
			if (existsSync(stylePath)) {
				const styleContent = await fs.readFile(stylePath, 'utf-8');
				const escaped = styleContent
					.replace(/\\/g, '\\\\')
					.replace(/`/g, '\\`')
					.replace(/\$\{/g, '\\${');
				result = result.replace(
					/styleUrl\s*:\s*['"][^'"]+['"]/,
					`styles: [\`${escaped}\`]`
				);
			}
		}

		return result;
	};

	/** Transpile a single .ts file and recursively process its local imports */
	const transpileFile = async (filePath: string): Promise<void> => {
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

		// Find all relative imports to process recursively
		const importRegex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
		const localImports: string[] = [];
		let importMatch;
		while ((importMatch = importRegex.exec(sourceCode)) !== null) {
			if (importMatch[1]) localImports.push(importMatch[1]);
		}

		// Transpile this file
		const result = ts.transpileModule(sourceCode, {
			compilerOptions: transpileOpts,
			fileName: actualPath
		});

		let processedContent = result.outputText;

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

		// Compute output path preserving directory structure
		const inputDir = dirname(actualPath);
		const relativeDir = inputDir.startsWith(cwd)
			? inputDir.substring(cwd.length + 1)
			: inputDir;
		const fileBase = basename(actualPath).replace(/\.ts$/, '.js');
		const targetDir = join(outDir, relativeDir);
		const targetPath = join(targetDir, fileBase);

		await fs.mkdir(targetDir, { recursive: true });
		await fs.writeFile(targetPath, processedContent, 'utf-8');
		allOutputs.push(targetPath);

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
	const compiledParent = join(outRoot, 'compiled');

	if (entryPoints.length === 0) {
		return { clientPaths: [] as string[], serverPaths: [] as string[] };
	}

	// Unique build ID ensures Bun's ESM cache never returns stale modules
	// during HMR — all file paths are fresh, forcing re-import of the
	// entire dependency chain (not just the top-level page file).
	const buildId = Date.now().toString(36);
	const compiledRoot = join(compiledParent, buildId);
	const indexesDir = join(compiledRoot, 'indexes');

	await fs.mkdir(indexesDir, { recursive: true });

	const compileTasks = entryPoints.map(async (entry) => {
		// Angular HMR Runtime Layer (Level 3) — Use JIT compilation for dev/HMR builds.
		// JIT uses ts.transpileModule() with template/style inlining (~50-100ms)
		// instead of AOT performCompilation() (~500-700ms).
		const outputs = hmr
			? await compileAngularFileJIT(entry, compiledRoot)
			: await compileAngularFile(entry, compiledRoot);
		const fileBase = basename(entry).replace(/\.[tj]s$/, '');
		const jsName = `${fileBase}.js`;

		// Try to find the file in pages/ subdirectory first, then at root
		let rawServerFile = outputs.find((f) =>
			f.endsWith(`${sep}pages${sep}${jsName}`)
		);

		// If not found in pages/, try root level
		if (!rawServerFile) {
			rawServerFile = outputs.find((f) => f.endsWith(`${sep}${jsName}`));
		}

		if (!rawServerFile) {
			throw new Error(`Compiled output not found for ${entry}. Looking for: ${jsName}. Available: ${outputs.join(', ')}`);
		}

		const original = await fs.readFile(rawServerFile, 'utf-8');
		const componentClassName = `${toPascal(fileBase)}Component`;

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
		}

		await fs.writeFile(rawServerFile, rewritten, 'utf-8');

		// Calculate relative path from indexes directory to the server file
		// This handles deeply nested paths that Angular compiler may create
		const relativePath = relative(indexesDir, rawServerFile).replace(/\\/g, '/');
		// Ensure it starts with ./ or ../ for relative imports
		const normalizedImportPath = relativePath.startsWith('.')
			? relativePath
			: './' + relativePath;

		const clientFile = join(indexesDir, jsName);
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

// Angular HMR Runtime Layer (Level 3) — Export component for runtime patcher
export { ${componentClassName} };

// Angular HMR Runtime Layer (Level 3) — Skip bootstrap on re-import when runtime patching
// When __ANGULAR_HMR__ is active and __ANGULAR_APP__ already exists, this is a
// re-import triggered by the runtime patcher. The patcher will read the exported
// component and swap prototypes — no need to destroy/bootstrap.
if (window.__ANGULAR_APP__ && window.__ANGULAR_HMR__) {
    // Re-import: just register the updated component, don't bootstrap
    window.__ANGULAR_HMR__.register('${entry}#${componentClassName}', ${componentClassName});
} else {
    // Initial load: destroy any stale app and bootstrap fresh
    if (window.__ANGULAR_APP__) {
        try { window.__ANGULAR_APP__.destroy(); } catch (_err) { /* ignore */ }
        window.__ANGULAR_APP__ = null;
    }

    bootstrapApplication(${componentClassName}, {
        providers: [provideClientHydration(), provideZonelessChangeDetection()]
    }).then(function (appRef) {
        window.__ANGULAR_APP__ = appRef;
    });
}
`.trim() : `
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import ${componentClassName} from '${normalizedImportPath}';

if (window.__ANGULAR_APP__) {
    try { window.__ANGULAR_APP__.destroy(); } catch (_err) { /* ignore */ }
    window.__ANGULAR_APP__ = null;
}

bootstrapApplication(${componentClassName}, {
    providers: [provideClientHydration(), provideZonelessChangeDetection()]
}).then(function (appRef) {
    window.__ANGULAR_APP__ = appRef;
});
`.trim();
		await fs.writeFile(clientFile, hydration, 'utf-8');

		return { clientPath: clientFile, serverPath: rawServerFile };
	});

	const results = await Promise.all(compileTasks);
	const serverPaths = results.map((r) => r.serverPath);
	const clientPaths = results.map((r) => r.clientPath);

	// Clean up old compiled builds (keep only current)
	try {
		const dirs = await fs.readdir(compiledParent);
		await Promise.all(
			dirs
				.filter((dir) => dir !== buildId)
				.map((dir) =>
					fs.rm(join(compiledParent, dir), {
						recursive: true,
						force: true
					})
				)
		);
	} catch { }

	return { clientPaths, serverPaths };
};
