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

export const compileAngularFile = async (inputPath: string, outDir: string) => {
	// Resolve TypeScript lib directory dynamically (prevents hardcoded paths)
	const tsPath = require.resolve('typescript');
	const tsRootDir = dirname(tsPath);
	const tsLibDir = tsRootDir.endsWith('lib') ? tsRootDir : resolve(tsRootDir, 'lib');

	// Read configuration from tsconfig.json to get angularCompilerOptions
	const config = readConfiguration('./tsconfig.json');

	// Build options object with newLine FIRST, then spread config
	// IMPORTANT: target MUST be ES2022 (not ESNext) to avoid hardcoded lib.esnext.full.d.ts path
	const options: CompilerOptions = {
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

	// Use TypeScript's createCompilerHost directly
	const host = ts.createCompilerHost(options);

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

	const emitted: Record<string, string> = {};
	host.writeFile = (fileName, text) => {
		const relativePath = fileName.startsWith(outDir)
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
			processedContent = processedContent.replace(/\bInjectFlags\b/g, 'InternalInjectFlags');

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

export const compileAngular = async (
	entryPoints: string[],
	outRoot: string
) => {
	const compiledRoot = join(outRoot, 'compiled');
	const indexesDir = join(compiledRoot, 'indexes');

	await fs.rm(compiledRoot, { force: true, recursive: true });
	await fs.mkdir(indexesDir, { recursive: true });

	const compileTasks = entryPoints.map(async (entry) => {
		const outputs = await compileAngularFile(entry, compiledRoot);
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
		
		await fs.writeFile(rawServerFile, rewritten, 'utf-8');

		// Calculate relative path from indexes directory to the server file
		// This handles deeply nested paths that Angular compiler may create
		const relativePath = relative(indexesDir, rawServerFile).replace(/\\/g, '/');
		// Ensure it starts with ./ or ../ for relative imports
		const normalizedImportPath = relativePath.startsWith('.') 
			? relativePath 
			: './' + relativePath;

		const clientFile = join(indexesDir, jsName);
		const hydration = `
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import ${componentClassName} from '${normalizedImportPath}';

bootstrapApplication(${componentClassName}, { providers: [provideClientHydration()] });
`.trim();
		await fs.writeFile(clientFile, hydration, 'utf-8');

		return { clientPath: clientFile, serverPath: rawServerFile };
	});

	const results = await Promise.all(compileTasks);
	const serverPaths = results.map((r) => r.serverPath);
	const clientPaths = results.map((r) => r.clientPath);

	return { clientPaths, serverPaths };
};
