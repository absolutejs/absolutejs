import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* Dependency graph for tracking file relationships
   This handles the "what depends on what" problem for incremental HMR */
export type DependencyGraph = {
	// filePath -> Set of files that depend on this file
	dependents: Map<string, Set<string>>;
	// filePath -> Set of files this file depends on
	dependencies: Map<string, Set<string>>;
};

export const createDependencyGraph = () => ({
	dependencies: new Map(),
	dependents: new Map()
});

/* Shared transpiler instance for scanImports(). Bun.Transpiler
   is a native Zig parser — much faster than regex for extracting
   imports from TS/TSX/JS/JSX files. */
const tsTranspiler = new Bun.Transpiler({ loader: 'tsx' });
const jsTranspiler = new Bun.Transpiler({ loader: 'js' });

const loaderForFile = (filePath: string): 'tsx' | 'js' | 'html' | null => {
	const lower = filePath.toLowerCase();
	if (
		lower.endsWith('.ts') ||
		lower.endsWith('.tsx') ||
		lower.endsWith('.jsx')
	)
		return 'tsx';
	if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'js';
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';

	return null;
};

/* Resolve relative import paths to absolute paths using existsSync
   instead of readFileSync — avoids reading file content just to check
   existence. */
const resolveImportPath = (importPath: string, fromFile: string) => {
	// Skip external packages
	if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
		return null;
	}

	const fromDir = resolve(fromFile, '..');
	const normalized = resolve(fromDir, importPath);

	// Try common extensions
	const extensions = [
		'.ts',
		'.tsx',
		'.js',
		'.jsx',
		'.vue',
		'.svelte',
		'.css',
		'.html'
	];

	for (const ext of extensions) {
		const withExt = normalized + ext;
		if (existsSync(withExt)) return withExt;
	}

	// Try without extension (already has one, or is extensionless)
	if (existsSync(normalized)) return normalized;

	return null;
};

/* Extract import/require statements from a file.
   Uses Bun.Transpiler.scanImports() for JS/TS files (native Zig parser)
   and falls back to regex for HTML (stylesheet links) and .vue/.svelte. */
export const extractDependencies = (filePath: string) => {
	try {
		const loader = loaderForFile(filePath);
		const lowerPath = filePath.toLowerCase();
		const isSvelteOrVue =
			lowerPath.endsWith('.svelte') || lowerPath.endsWith('.vue');

		// HTML: detect linked stylesheets
		if (loader === 'html') {
			const content = readFileSync(filePath, 'utf-8');
			const dependencies: string[] = [];
			const linkRegex =
				/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
			let matchLink;
			while ((matchLink = linkRegex.exec(content)) !== null) {
				const href = matchLink[1];
				if (!href) continue;
				const resolvedHref = resolveImportPath(href, filePath);
				if (resolvedHref) dependencies.push(resolvedHref);
			}

			return dependencies;
		}

		// JS/TS/JSX/TSX: use Bun.Transpiler.scanImports() — native Zig,
		// much faster than regex. Also handles dynamic imports and require.
		if (loader === 'tsx' || loader === 'js') {
			const content = readFileSync(filePath, 'utf-8');
			const transpiler = loader === 'tsx' ? tsTranspiler : jsTranspiler;
			const imports = transpiler.scanImports(content);
			const dependencies: string[] = [];

			for (const imp of imports) {
				const resolved = resolveImportPath(imp.path, filePath);
				if (resolved) dependencies.push(resolved);
			}

			// Angular: detect templateUrl and styleUrls in @Component
			if (content.includes('@Component')) {
				const templateUrlRegex = /templateUrl\s*:\s*['"]([^'"]+)['"]/g;
				const styleUrlSingularRegex =
					/styleUrl\s*:\s*['"]([^'"]+)['"]/g;
				const styleUrlsRegex = /styleUrls\s*:\s*\[([^\]]*)\]/g;
				const stringLiteralRegex = /['"]([^'"]+)['"]/g;

				let match;
				while ((match = templateUrlRegex.exec(content)) !== null) {
					if (match[1]) {
						const resolved = resolveImportPath(match[1], filePath);
						if (resolved) dependencies.push(resolved);
					}
				}

				while ((match = styleUrlSingularRegex.exec(content)) !== null) {
					if (match[1]) {
						const resolved = resolveImportPath(match[1], filePath);
						if (resolved) dependencies.push(resolved);
					}
				}

				while ((match = styleUrlsRegex.exec(content)) !== null) {
					if (match[1]) {
						let urlMatch;
						while (
							(urlMatch = stringLiteralRegex.exec(match[1])) !==
							null
						) {
							if (urlMatch[1]) {
								const resolved = resolveImportPath(
									urlMatch[1],
									filePath
								);
								if (resolved) dependencies.push(resolved);
							}
						}
					}
				}
			}

			return dependencies;
		}

		// Svelte/Vue: extract <script> content, then use transpiler
		if (isSvelteOrVue) {
			const content = readFileSync(filePath, 'utf-8');
			const dependencies: string[] = [];

			// Extract script blocks and scan their imports
			const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
			let scriptMatch;
			while ((scriptMatch = scriptRegex.exec(content)) !== null) {
				const scriptContent = scriptMatch[1];
				if (!scriptContent?.trim()) continue;
				try {
					const imports = tsTranspiler.scanImports(scriptContent);
					for (const imp of imports) {
						const resolved = resolveImportPath(imp.path, filePath);
						if (resolved) dependencies.push(resolved);
					}
				} catch {
					// Fall through to regex if transpiler fails on script content
				}
			}

			return dependencies;
		}

		return [];
	} catch {
		return [];
	}
};

/* Add a file and its dependencies to the graph
   This handles the "build graph" problem */
export const addFileToGraph = (graph: DependencyGraph, filePath: string) => {
	// Normalize the file path to ensure consistent format
	const normalizedPath = resolve(filePath);

	if (!existsSync(normalizedPath)) {
		return;
	}

	const dependencies = extractDependencies(normalizedPath);

	// Clear existing dependencies for this file
	const existingDeps = graph.dependencies.get(normalizedPath);
	if (existingDeps) {
		for (const dep of existingDeps) {
			const dependents = graph.dependents.get(dep);
			if (dependents) {
				dependents.delete(normalizedPath);
			}
		}
	}

	// Add new dependencies
	const newDeps = new Set(dependencies);
	graph.dependencies.set(normalizedPath, newDeps);

	// Update dependents (reverse relationship)
	for (const dep of dependencies) {
		if (!graph.dependents.has(dep)) {
			graph.dependents.set(dep, new Set());
		}
		graph.dependents.get(dep)!.add(normalizedPath);
	}
};

/* Get all files that depend on a changed file
   This handles the "find affected files" problem */
export const getAffectedFiles = (
	graph: DependencyGraph,
	changedFile: string
) => {
	// Normalize the changed file path to ensure consistent lookup
	const normalizedPath = resolve(changedFile);
	const affected = new Set<string>();
	const toProcess = [normalizedPath];

	while (toProcess.length > 0) {
		const current = toProcess.pop()!;

		if (affected.has(current)) {
			continue;
		}

		affected.add(current);

		const dependents = graph.dependents.get(current);
		if (dependents) {
			for (const dependent of dependents) {
				toProcess.push(dependent);
			}
		}
	}

	return Array.from(affected);
};

/* Remove a file from the graph
   This handles the "cleanup deleted files" problem */
export const removeFileFromGraph = (
	graph: DependencyGraph,
	filePath: string
) => {
	// Normalize the file path to ensure consistent format
	const normalizedPath = resolve(filePath);

	// Remove from dependencies
	const deps = graph.dependencies.get(normalizedPath);
	if (deps) {
		for (const dep of deps) {
			const dependents = graph.dependents.get(dep);
			if (dependents) {
				dependents.delete(normalizedPath);
			}
		}
		graph.dependencies.delete(normalizedPath);
	}

	// Remove from dependents
	const dependents = graph.dependents.get(normalizedPath);
	if (dependents) {
		for (const dependent of dependents) {
			const depList = graph.dependencies.get(dependent);
			if (depList) {
				depList.delete(normalizedPath);
			}
		}
		graph.dependents.delete(normalizedPath);
	}
};

/* Build dependency graph for all files in a directory
   This handles the "initialize graph" problem */
export const buildInitialDependencyGraph = (
	graph: DependencyGraph,
	directories: string[]
) => {
	const processedFiles = new Set<string>();

	const scanDirectory = (dir: string) => {
		// Normalize directory path
		const normalizedDir = resolve(dir);
		try {
			const entries = readdirSync(normalizedDir, {
				withFileTypes: true
			});

			for (const entry of entries) {
				const fullPath = resolve(normalizedDir, entry.name);

				// Skip ignored paths
				if (
					fullPath.includes('/node_modules/') ||
					fullPath.includes('/.git/') ||
					fullPath.includes('/build/') ||
					fullPath.includes('/compiled/') ||
					fullPath.includes('/indexes/') ||
					fullPath.includes('/server/') ||
					fullPath.includes('/client/') ||
					entry.name.startsWith('.')
				) {
					continue;
				}

				if (entry.isDirectory()) {
					scanDirectory(fullPath);
				} else if (entry.isFile()) {
					// Process source files (TypeScript, JavaScript, Vue, Svelte, HTML)
					const ext = entry.name.split('.').pop()?.toLowerCase();
					if (
						[
							'ts',
							'tsx',
							'js',
							'jsx',
							'vue',
							'svelte',
							'html',
							'htm'
						].includes(ext || '')
					) {
						if (!processedFiles.has(fullPath)) {
							addFileToGraph(graph, fullPath);
							processedFiles.add(fullPath);
						}
					}
				}
			}
		} catch {}
	};

	for (const dir of directories) {
		const resolvedDir = resolve(dir);
		// Only scan directories that exist
		if (existsSync(resolvedDir)) {
			scanDirectory(resolvedDir);
		}
	}
};
