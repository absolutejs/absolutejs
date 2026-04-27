import { existsSync, readFileSync, promises as fs } from 'fs';
import { join, basename, sep, dirname, resolve, relative } from 'path';
import type { CompilerOptions } from '@angular/compiler-cli';
import ts from 'typescript';
import { BASE_36_RADIX } from '../constants';
import { toPascal } from '../utils/stringModifiers';
import { createHash } from 'crypto';
import { buildIslandMetadataExports } from '../islands/sourceMetadata';
import {
	lowerAngularDeferSyntax,
	type LoweredAngularDeferSlot
} from '../angular/lowerDeferSyntax';
import {
	compileStyleFileIfNeeded,
	compileStyleFileIfNeededSync
} from './stylePreprocessor';
import type { StylePreprocessorConfig } from '../../types/build';

type SyncReadFile = (fileName: string) => string | undefined;

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
};

type TsconfigPathAlias = {
	pattern: string;
	replacements: string[];
};

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
		const baseUrl = resolve(
			process.cwd(),
			compilerOptions.baseUrl ?? '.'
		);
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

		const prefix = exactMatch ? alias.pattern : alias.pattern.slice(0, wildcardIndex);
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

// Angular HMR Runtime Layer (Level 3) — Path to runtime module
const hmrRuntimePath = join(
	devClientDir,
	'handlers',
	'angularRuntime.ts'
).replace(/\\/g, '/');

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
	const registrations = componentNames
		.map(
			(name) =>
				`  if (typeof ${name} === 'function') window.__ANGULAR_HMR__.register('${sourceId}#${name}', ${name});`
		)
		.join('\n');

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

const precomputeAotResourceTransforms = async (
	inputPath: string,
	readFile: SyncReadFile | undefined,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const transformedSources = new Map<string, string>();
	const visited = new Set<string>();

	const transformFile = async (filePath: string) => {
		const resolvedPath = resolve(filePath);
		if (visited.has(resolvedPath)) return;
		visited.add(resolvedPath);
		if (!existsSync(resolvedPath) || resolvedPath.endsWith('.d.ts')) return;

		const source = await readFileForAotTransform(resolvedPath, readFile);
		const transformed = await inlineResources(
			source,
			dirname(resolvedPath),
			stylePreprocessors
		);
		transformedSources.set(resolvedPath, transformed.source);

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

	await transformFile(inputPath);

	return transformedSources;
};

export const compileAngularFile = async (
	inputPath: string,
	outDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const islandMetadataExports = buildIslandMetadataExports(
		readFileSync(inputPath, 'utf-8')
	);
	const { readConfiguration, performCompilation, EmitFlags } = await import(
		'@angular/compiler-cli'
	);

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
		tsLibDir = tsRootDir.endsWith('lib')
			? tsRootDir
			: resolve(tsRootDir, 'lib');

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
			newLine: ts.NewLineKind.LineFeed, // Set FIRST - critical for createCompilerHost
			noLib: false,
			outDir,
			skipLibCheck: true,
			target: ts.ScriptTarget.ES2022, // Use ES2022 instead of ESNext to avoid hardcoded lib paths
			...config.options // Spread AFTER to add Angular options
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

		// Production examples commonly use noEmit=true for editor/typecheck flows.
		// AOT compilation must override that or Angular silently produces no JS.
		options.noEmit = false;

		// Explicit rootDir prevents TypeScript from computing it from the single entry file,
		// which would cause imports from other directories to get absolute-path-based output
		options.rootDir = process.cwd();

		// Use TypeScript's createCompilerHost directly
		host = ts.createCompilerHost(options);

		// Override lib resolution to use dynamic paths
		const originalGetDefaultLibLocation = host.getDefaultLibLocation;
		host.getDefaultLibLocation = () =>
			tsLibDir ||
			(originalGetDefaultLibLocation
				? originalGetDefaultLibLocation()
				: '');

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
		const relativePath = resolveRelativePath(
			fileName,
			resolvedOutDir,
			outDir
		);
		emitted[relativePath] = text;
	};
	const originalReadFile = host.readFile;
	const aotTransformedSources = await precomputeAotResourceTransforms(
		inputPath,
		originalReadFile?.bind(host),
		stylePreprocessors
	);
	host.readFile = (fileName: string) => {
		const source = originalReadFile
			? originalReadFile.call(host, fileName)
			: undefined;
		if (typeof source !== 'string') return source;
		if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) {
			return source;
		}
		const resolvedPath = resolve(fileName);

		return aotTransformedSources.get(resolvedPath) ?? source;
	};
	const originalGetSourceFileForCompile = host.getSourceFile;
	host.getSourceFile = (
		fileName: string,
		languageVersion: ts.ScriptTarget,
		onError?: (message: string) => void
	) => {
		const source = host.readFile(fileName);
		if (typeof source === 'string') {
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
		({ diagnostics } = performCompilation({
			emitFlags: EmitFlags.Default,
			host,
			options,
			rootNames: [inputPath]
		}));
	} finally {
		host.readFile = originalReadFile;
		host.getSourceFile = originalGetSourceFileForCompile;
	}

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
			processedContent += islandMetadataExports;

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
const wrapperOutputCache = new Map<
	string,
	{ serverHash: string; indexHash: string }
>();

const escapeTemplateContent = (content: string) =>
	content
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/\$\{/g, '\\${');

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
	const templateUrlMatch = source.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
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
		const replacedSource = source.replace(
			/templateUrl\s*:\s*['"][^'"]+['"]/,
			`template: \`${escaped}\``
		);

		return {
			deferSlots: lowered.slots,
			source: injectDeferSlotFields(
				replacedSource,
				lowered.slots,
				resolveAngularDeferImportSpecifier()
			)
		};
	}

	const inlineTemplateMatch = source.match(
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
	const replacedSource = source.replace(
		/template\s*:\s*(`([\s\S]*?)`|'([^']*)'|"([^"]*)")/,
		`template: \`${escaped}\``
	);

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
	const templateUrlMatch = source.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
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
		const replacedSource = source.replace(
			/templateUrl\s*:\s*['"][^'"]+['"]/,
			`template: \`${escaped}\``
		);

		return {
			deferSlots: lowered.slots,
			source: injectDeferSlotFields(
				replacedSource,
				lowered.slots,
				resolveAngularDeferImportSpecifier()
			)
		};
	}

	const inlineTemplateMatch = source.match(
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
	const replacedSource = source.replace(
		/template\s*:\s*(`([\s\S]*?)`|'([^']*)'|"([^"]*)")/,
		`template: \`${escaped}\``
	);

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
	const content = compileStyleFileIfNeededSync(
		filePath,
		stylePreprocessors
	);

	return escapeTemplateContent(content);
};

const inlineStyleUrlsSync = (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlsMatch = source.match(/styleUrls\s*:\s*\[([^\]]+)\]/);
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

	return source.replace(
		/styleUrls\s*:\s*\[[^\]]+\]/,
		`styles: [${inlinedStyles.join(', ')}]`
	);
};

const inlineSingleStyleUrlSync = (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlMatch = source.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/);
	if (!styleUrlMatch?.[1]) return source;

	const escaped = readAndEscapeFileSync(
		join(fileDir, styleUrlMatch[1]),
		stylePreprocessors
	);
	if (!escaped) return source;

	return source.replace(
		/styleUrl\s*:\s*['"][^'"]+['"]/,
		`styles: [\`${escaped}\`]`
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
	const styleUrlsMatch = source.match(/styleUrls\s*:\s*\[([^\]]+)\]/);
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

	return source.replace(
		/styleUrls\s*:\s*\[[^\]]+\]/,
		`styles: [${inlinedStyles.join(', ')}]`
	);
};

const inlineSingleStyleUrl = async (
	source: string,
	fileDir: string,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const styleUrlMatch = source.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/);
	if (!styleUrlMatch?.[1]) return source;

	const escaped = await readAndEscapeFile(
		join(fileDir, styleUrlMatch[1]),
		stylePreprocessors
	);
	if (!escaped) return source;

	return source.replace(
		/styleUrl\s*:\s*['"][^'"]+['"]/,
		`styles: [\`${escaped}\`]`
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
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const entryPath = resolve(inputPath);
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
	const tsconfigAliases = readTsconfigPathAliases();

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
		const fileBase = basename(sourcePath).replace(/\.[cm]?[tj]sx?$/, '.js');

		return join(outDir, relativeDir, fileBase);
	};

	const transpileAndRewrite = (
		sourceCode: string,
		relativeDir: string,
		actualPath: string,
		importRewrites: Map<string, string>
	) => {
		let processedContent = angularTranspiler.transformSync(sourceCode);
		const rewriteBareImport = (
			prefix: string,
			specifier: string,
			suffix: string
		) => {
			const rewritten = importRewrites.get(specifier);
			if (rewritten) {
				return `${prefix}${rewritten}${suffix}`;
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
				if (!path.match(/\.(js|ts|mjs|cjs)$/)) {
					return `from ${quote}${path}.js${quote}`;
				}
				if (path.endsWith('.ts')) {
					return `from ${quote}${path.replace(/\.ts$/, '.js')}${quote}`;
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
		const localImportPaths = localImports
			.map((specifier) => {
				const resolved = resolveLocalImport(specifier, inputDir);
				if (!resolved) return null;
				const relativeImport = relative(targetDir, toOutputPath(resolved))
					.replace(/\\/g, '/')
					.replace(/\.js$/, '');
				importRewrites.set(
					specifier,
					relativeImport.startsWith('.')
						? relativeImport
						: `./${relativeImport}`
				);

				return resolved;
			})
			.filter((path): path is string => Boolean(path));

		// Skip transpilation if source content hasn't changed — the
		// compiled output on disk is already up-to-date. This avoids
		// unnecessary disk writes that trigger bun --hot re-evaluation
		// and cause progressively slower compile times.
		const contentHash = Bun.hash(sourceCode).toString(BASE_36_RADIX);
		const cacheKey = actualPath;
		if (
			jitContentCache.get(cacheKey) === contentHash &&
			existsSync(targetPath)
		) {
			allOutputs.push(targetPath);
		} else {
			const processedContent = transpileAndRewrite(
				sourceCode,
				relativeDir,
				actualPath,
				importRewrites
			);

			await fs.mkdir(targetDir, { recursive: true });
			await fs.writeFile(targetPath, processedContent, 'utf-8');
			allOutputs.push(targetPath);
			jitContentCache.set(cacheKey, contentHash);
		}

		// Recursively transpile local imports
		await Promise.all(
			localImportPaths.map((importPath) => transpileFile(importPath))
		);
	};

	await transpileFile(inputPath);

	return allOutputs;
};

export const compileAngular = async (
	entryPoints: string[],
	outRoot: string,
	hmr = false,
	stylePreprocessors?: StylePreprocessorConfig
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
		const resolvedEntry = resolve(entry);
		const relativeEntry = relative(outRoot, resolvedEntry).replace(
			/\.[tj]s$/,
			'.js'
		);
		const compileEntry = () =>
			hmr
				? compileAngularFileJIT(
						resolvedEntry,
						compiledRoot,
						outRoot,
						stylePreprocessors
					)
				: compileAngularFile(
						resolvedEntry,
						compiledRoot,
						stylePreprocessors
					);

		// Angular HMR Runtime Layer (Level 3) — Use JIT compilation for dev/HMR builds.
		// JIT uses ts.transpileModule() with template/style inlining (~50-100ms)
		// instead of AOT performCompilation() (~500-700ms).
		let outputs = await compileEntry();
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
			let candidate = normalizedCandidates.find(
				(file) =>
					existsSync(file) &&
					file.endsWith(`${sep}pages${sep}${jsName}`)
			);
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

		let rawServerFile = resolveRawServerFile(outputs);
		if (!rawServerFile) {
			rawServerFile = resolveRawServerFile([]);
		}
		if (rawServerFile && !existsSync(rawServerFile)) {
			outputs = await compileEntry();
			rawServerFile = resolveRawServerFile(outputs);
		}

		if (!rawServerFile || !existsSync(rawServerFile)) {
			throw new Error(
				`Compiled output not found for ${entry}. Looking for: ${jsName}. Available: ${[
					...outputs,
					...compiledFallbackPaths
				].join(', ')}`
			);
		}

		const original = await fs.readFile(rawServerFile, 'utf-8');
		const componentClassName = `${toPascal(fileBase)}Component`;

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
			existsSync(clientFile)
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
		if (!rewritten.includes(`import '@angular/compiler';`)) {
			rewritten = `import '@angular/compiler';\n${rewritten}`;
		}

		// Replace templateUrl if it exists
		rewritten = rewritten.replace(
			new RegExp(`templateUrl:\\s*['"]\\.\\/${fileBase}\\.html['"]`),
			`templateUrl: '../../pages/${fileBase}.html'`
		);

		// Only add default export if one doesn't already exist
		if (!rewritten.includes('export default')) {
			rewritten += `\nexport default ${componentClassName};\n`;
		}

		// Angular HMR Runtime Layer (Level 3) — Inject HMR registration in dev mode
		if (hmr) {
			rewritten = injectHMRRegistration(rewritten, resolvedEntry);

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
			? `window.__HMR_FRAMEWORK__ = "angular";\nimport "${hmrRuntimePath}";\nimport "${hmrClientPath}";\n`
			: '';
		const hydration = hmr
			? `${hmrPreamble}
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
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
if (!window.__HMR_SKIP_HYDRATION__ && !pageHasIslands) {
    providers.push(provideClientHydration());
}
delete window.__HMR_SKIP_HYDRATION__;
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

enableProdMode();

var providers = [provideZonelessChangeDetection()].concat(propProviders);
if (!pageHasIslands) {
    providers.unshift(provideClientHydration());
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

		await fs.writeFile(clientFile, hydration, 'utf-8');

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
