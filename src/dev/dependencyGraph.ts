import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

/* Extract import/require statements from a file
   This handles the "find dependencies" problem */
export const extractDependencies = (filePath: string) => {
	try {
		// Check if file exists before trying to read
		if (!existsSync(filePath)) {
			return [];
		}
		const content = readFileSync(filePath, 'utf-8');
		const dependencies: string[] = [];
		const lowerPath = filePath.toLowerCase();
		const isHtml =
			lowerPath.endsWith('.html') || lowerPath.endsWith('.htm');

		// Special-case HTML/HTMX: detect linked stylesheets so CSS changes map back to pages
		if (isHtml) {
			const linkRegex =
				/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
			let matchLink;
			while ((matchLink = linkRegex.exec(content)) !== null) {
				const href = matchLink[1];
				if (!href) continue;
				// Resolve relative to the HTML file
				const resolvedHref = resolveImportPath(href, filePath);
				if (resolvedHref) {
					dependencies.push(resolvedHref);
				}
			}
			return dependencies;
		}

		// Match various import patterns
		const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
		const importWithoutFromRegex = /import\s+['"]([^'"]+)['"]/g; // For CSS and side-effect imports
		const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
		const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

		let match;

		// Find static imports with 'from'
		while ((match = importRegex.exec(content)) !== null) {
			if (match[1]) {
				const resolved = resolveImportPath(match[1], filePath);
				if (resolved) dependencies.push(resolved);
			}
		}

		// Find imports without 'from' (side-effect imports like CSS)
		while ((match = importWithoutFromRegex.exec(content)) !== null) {
			if (match[1]) {
				const resolved = resolveImportPath(match[1], filePath);
				if (resolved) dependencies.push(resolved);
			}
		}

		// Find require statements
		while ((match = requireRegex.exec(content)) !== null) {
			if (match[1]) {
				const resolved = resolveImportPath(match[1], filePath);
				if (resolved) dependencies.push(resolved);
			}
		}

		// Find dynamic imports
		while ((match = dynamicImportRegex.exec(content)) !== null) {
			if (match[1]) {
				const resolved = resolveImportPath(match[1], filePath);
				if (resolved) dependencies.push(resolved);
			}
		}

		// Angular: detect templateUrl and styleUrls/styleUrl in @Component decorators
		const templateUrlRegex = /templateUrl\s*:\s*['"]([^'"]+)['"]/g;
		const styleUrlSingularRegex = /styleUrl\s*:\s*['"]([^'"]+)['"]/g;
		const styleUrlsRegex = /styleUrls\s*:\s*\[([^\]]*)\]/g;
		const stringLiteralRegex = /['"]([^'"]+)['"]/g;

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
					(urlMatch = stringLiteralRegex.exec(match[1])) !== null
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

		return dependencies;
	} catch {
		return [];
	}
};

/* Resolve relative import paths to absolute paths
   This handles the "resolve imports" problem */
const resolveImportPath = (importPath: string, fromFile: string) => {
	// Skip external packages
	if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
		return null;
	}

	const fromDir = resolve(fromFile, '..');
	const resolved = resolve(fromDir, importPath);

	// Normalize the path to ensure consistent format (absolute path)
	const normalized = resolve(resolved);

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
		try {
			readFileSync(withExt);

			return normalized + ext; // Return absolute path
		} catch {
			// File doesn't exist with this extension
		}
	}

	// Try without extension
	try {
		readFileSync(normalized);

		return normalized; // Return absolute path
	} catch {
		return null;
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
			const entries = readdirSync(normalizedDir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = resolve(normalizedDir, entry.name);

				// Skip ignored paths
				if (
					fullPath.includes('/node_modules/') ||
					fullPath.includes('/.git/') ||
					fullPath.includes('/build/') ||
					fullPath.includes('/compiled/') ||
					fullPath.includes('/indexes/') ||
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
			scanDirectory(resolvedDir); // Normalize directory paths
		}
	}
};
