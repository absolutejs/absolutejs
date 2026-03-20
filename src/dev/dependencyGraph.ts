import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/* Dependency graph for tracking file relationships
   This handles the "what depends on what" problem for incremental HMR */
export type DependencyGraph = {
	// filePath -> Set of files that depend on this file
	dependents: Map<string, Set<string>>;
	// filePath -> Set of files this file depends on
	dependencies: Map<string, Set<string>>;
};

export const emptyDependencyGraph: DependencyGraph = {
	dependencies: new Map(),
	dependents: new Map()
};

/* Shared transpiler instance for scanImports(). Bun.Transpiler
   is a native Zig parser — much faster than regex for extracting
   imports from TS/TSX/JS/JSX files. */
const tsTranspiler = new Bun.Transpiler({ loader: 'tsx' });
const jsTranspiler = new Bun.Transpiler({ loader: 'js' });

/* Path resolution cache: maps "fromFile\0importPath" → resolved absolute path or null.
   Persists across HMR cycles to avoid redundant existsSync calls. */
const resolutionCache = new Map<string, string | null>();

/* Reverse index: resolved path → Set of cache keys that resolved to it.
   Enables O(1) invalidation instead of scanning the entire cache. */
const reverseIndex = new Map<string, Set<string>>();

/* Index: fromFile → Set of cache keys originating from it. */
const fromFileIndex = new Map<string, Set<string>>();

/* Content cache: avoids re-reading unchanged files during dependency graph updates. */
const contentCache = new Map<string, { mtime: number; content: string }>();

const addToResolutionCache = (
	cacheKey: string,
	fromFile: string,
	resolved: string | null
) => {
	resolutionCache.set(cacheKey, resolved);
	if (resolved) {
		let keys = reverseIndex.get(resolved);
		if (!keys) {
			keys = new Set();
			reverseIndex.set(resolved, keys);
		}
		keys.add(cacheKey);
	}
	let fromKeys = fromFileIndex.get(fromFile);
	if (!fromKeys) {
		fromKeys = new Set();
		fromFileIndex.set(fromFile, fromKeys);
	}
	fromKeys.add(cacheKey);
};

const deleteFromResolutionCache = (cacheKey: string) => {
	const resolved = resolutionCache.get(cacheKey);
	resolutionCache.delete(cacheKey);
	if (resolved) {
		const keys = reverseIndex.get(resolved);
		if (keys) {
			keys.delete(cacheKey);
			if (keys.size === 0) reverseIndex.delete(resolved);
		}
	}
};

export const invalidateResolutionCache = (filePath: string) => {
	const normalizedPath = resolve(filePath);

	const resolvedKeys = reverseIndex.get(normalizedPath);
	if (resolvedKeys) {
		for (const key of resolvedKeys) resolutionCache.delete(key);
		reverseIndex.delete(normalizedPath);
	}

	const fromKeys = fromFileIndex.get(normalizedPath);
	if (fromKeys) {
		for (const key of fromKeys) deleteFromResolutionCache(key);
		fromFileIndex.delete(normalizedPath);
	}

	contentCache.delete(normalizedPath);
};

const loaderForFile = (filePath: string) => {
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
   existence. Results are cached to avoid repeated filesystem calls. */
const resolveImportPath = (importPath: string, fromFile: string) => {
	// Skip external packages
	if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
		return null;
	}

	const cacheKey = fromFile + '\0' + importPath;
	if (resolutionCache.has(cacheKey)) {
		return resolutionCache.get(cacheKey) ?? null;
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
		if (existsSync(withExt)) {
			addToResolutionCache(cacheKey, fromFile, withExt);
			return withExt;
		}
	}

	// Try without extension (already has one, or is extensionless)
	if (existsSync(normalized)) {
		addToResolutionCache(cacheKey, fromFile, normalized);
		return normalized;
	}

	addToResolutionCache(cacheKey, fromFile, null);
	return null;
};

const clearExistingDependents = (
	graph: DependencyGraph,
	normalizedPath: string
) => {
	const existingDeps = graph.dependencies.get(normalizedPath);
	if (!existingDeps) return;

	for (const dep of existingDeps) {
		const dependents = graph.dependents.get(dep);
		if (!dependents) continue;
		dependents.delete(normalizedPath);
	}
};

/* Extract import/require statements from a file.
   Uses Bun.Transpiler.scanImports() for JS/TS files (native Zig parser)
   and falls back to regex for HTML (stylesheet links) and .vue/.svelte. */
export const addFileToGraph = (graph: DependencyGraph, filePath: string) => {
	const normalizedPath = resolve(filePath);

	if (!existsSync(normalizedPath)) return;

	// Invalidate resolution cache for this file before re-scanning
	invalidateResolutionCache(normalizedPath);

	const dependencies = extractDependencies(normalizedPath);

	clearExistingDependents(graph, normalizedPath);

	const newDeps = new Set(dependencies);
	graph.dependencies.set(normalizedPath, newDeps);

	const addDependent = (dep: string) => {
		if (!graph.dependents.has(dep)) {
			graph.dependents.set(dep, new Set());
		}
		graph.dependents.get(dep)?.add(normalizedPath);
	};

	dependencies.forEach(addDependent);
};

const IGNORED_SEGMENTS = [
	'/node_modules/',
	'/.git/',
	'/build/',
	'/compiled/',
	'/indexes/',
	'/server/',
	'/client/'
];

const SCANNABLE_EXTENSIONS = new Set([
	'ts',
	'tsx',
	'js',
	'jsx',
	'vue',
	'svelte',
	'html',
	'htm'
]);

const isIgnoredPath = (fullPath: string, entryName: string) =>
	entryName.startsWith('.') ||
	IGNORED_SEGMENTS.some((seg) => fullPath.includes(seg));

const isScannableFile = (fileName: string) => {
	const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

	return SCANNABLE_EXTENSIONS.has(ext);
};

const processEntry = (
	graph: DependencyGraph,
	processedFiles: Set<string>,
	scanDir: (dir: string) => void,
	normalizedDir: string,
	entry: { name: string; isDirectory: () => boolean; isFile: () => boolean }
) => {
	const fullPath = resolve(normalizedDir, entry.name);

	if (isIgnoredPath(fullPath, entry.name)) return;

	if (entry.isDirectory()) {
		scanDir(fullPath);

		return;
	}

	if (!entry.isFile()) return;
	if (!isScannableFile(entry.name)) return;
	if (processedFiles.has(fullPath)) return;

	addFileToGraph(graph, fullPath);
	processedFiles.add(fullPath);
};

export const buildInitialDependencyGraph = (
	graph: DependencyGraph,
	directories: string[]
) => {
	const processedFiles = new Set<string>();

	const scanEntries = (normalizedDir: string) => {
		const entries = readdirSync(normalizedDir, {
			withFileTypes: true
		});

		entries.forEach((entry) => {
			processEntry(
				graph,
				processedFiles,
				scanDirectory,
				normalizedDir,
				entry
			);
		});
	};

	const scanDirectory = (dir: string) => {
		const normalizedDir = resolve(dir);
		try {
			scanEntries(normalizedDir);
		} catch {
			/* ignored */
		}
	};

	for (const dir of directories) {
		const resolvedDir = resolve(dir);
		if (!existsSync(resolvedDir)) continue;
		scanDirectory(resolvedDir);
	}
};

const extractHtmlDependencies = (filePath: string, content: string) => {
	const dependencies: string[] = [];
	const linkRegex =
		/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
	let matchLink;
	while ((matchLink = linkRegex.exec(content)) !== null) {
		const [, href] = matchLink;
		if (!href) continue;
		const resolvedHref = resolveImportPath(href, filePath);
		if (resolvedHref) dependencies.push(resolvedHref);
	}

	return dependencies;
};

const resolveRegexMatches = (
	regex: RegExp,
	content: string,
	filePath: string,
	dependencies: string[]
) => {
	let match;
	while ((match = regex.exec(content)) !== null) {
		if (!match[1]) continue;
		const resolved = resolveImportPath(match[1], filePath);
		if (resolved) dependencies.push(resolved);
	}
};

const resolveStyleUrls = (
	matchContent: string,
	filePath: string,
	dependencies: string[]
) => {
	const stringLiteralRegex = /['"]([^'"]+)['"]/g;
	let urlMatch;
	while ((urlMatch = stringLiteralRegex.exec(matchContent)) !== null) {
		if (!urlMatch[1]) continue;
		const resolved = resolveImportPath(urlMatch[1], filePath);
		if (resolved) dependencies.push(resolved);
	}
};

const extractStyleUrlsDependencies = (
	content: string,
	filePath: string,
	dependencies: string[]
) => {
	const styleUrlsRegex = /styleUrls\s*:\s*\[([^\]]*)\]/g;

	let match;
	while ((match = styleUrlsRegex.exec(content)) !== null) {
		if (!match[1]) continue;
		resolveStyleUrls(match[1], filePath, dependencies);
	}
};

const extractAngularDependencies = (
	content: string,
	filePath: string,
	dependencies: string[]
) => {
	const templateUrlRegex = /templateUrl\s*:\s*['"]([^'"]+)['"]/g;
	const styleUrlSingularRegex = /styleUrl\s*:\s*['"]([^'"]+)['"]/g;

	resolveRegexMatches(templateUrlRegex, content, filePath, dependencies);
	resolveRegexMatches(styleUrlSingularRegex, content, filePath, dependencies);
	extractStyleUrlsDependencies(content, filePath, dependencies);
};

const extractJsDependencies = (
	filePath: string,
	content: string,
	loader: 'tsx' | 'js'
) => {
	const transpiler = loader === 'tsx' ? tsTranspiler : jsTranspiler;
	const imports = transpiler.scanImports(content);
	const dependencies: string[] = [];

	for (const imp of imports) {
		const resolved = resolveImportPath(imp.path, filePath);
		if (resolved) dependencies.push(resolved);
	}

	if (content.includes('@Component')) {
		extractAngularDependencies(content, filePath, dependencies);
	}

	return dependencies;
};

const resolveScannedImports = (
	imports: ReturnType<typeof tsTranspiler.scanImports>,
	filePath: string,
	dependencies: string[]
) => {
	for (const imp of imports) {
		const resolved = resolveImportPath(imp.path, filePath);
		if (resolved) dependencies.push(resolved);
	}
};

const extractScriptImports = (
	scriptContent: string,
	filePath: string,
	dependencies: string[]
) => {
	try {
		const imports = tsTranspiler.scanImports(scriptContent);
		resolveScannedImports(imports, filePath, dependencies);
	} catch {
		/* ignored */
	}
};

const extractSvelteVueDependencies = (filePath: string, content: string) => {
	const dependencies: string[] = [];
	const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
	let scriptMatch;
	while ((scriptMatch = scriptRegex.exec(content)) !== null) {
		const [, scriptContent] = scriptMatch;
		if (!scriptContent?.trim()) continue;
		extractScriptImports(scriptContent, filePath, dependencies);
	}

	return dependencies;
};

/* Read file content with mtime-based caching to avoid re-reading unchanged files. */
const readFileCached = (filePath: string) => {
	try {
		const stat = statSync(filePath);
		const mtime = stat.mtimeMs;
		const cached = contentCache.get(filePath);
		if (cached && cached.mtime === mtime) {
			return cached.content;
		}
		const content = readFileSync(filePath, 'utf-8');
		contentCache.set(filePath, { mtime, content });
		return content;
	} catch {
		contentCache.delete(filePath);
		return readFileSync(filePath, 'utf-8');
	}
};

const extractDependenciesForFile = (filePath: string) => {
	const loader = loaderForFile(filePath);
	const lowerPath = filePath.toLowerCase();
	const isSvelteOrVue =
		lowerPath.endsWith('.svelte') || lowerPath.endsWith('.vue');

	if (loader === 'html') {
		const content = readFileCached(filePath);

		return extractHtmlDependencies(filePath, content);
	}

	if (loader === 'tsx' || loader === 'js') {
		const content = readFileCached(filePath);

		return extractJsDependencies(filePath, content, loader);
	}

	if (isSvelteOrVue) {
		const content = readFileCached(filePath);

		return extractSvelteVueDependencies(filePath, content);
	}

	return [];
};

export const extractDependencies = (filePath: string) => {
	try {
		return extractDependenciesForFile(filePath);
	} catch {
		return [];
	}
};

export const getAffectedFiles = (
	graph: DependencyGraph,
	changedFile: string
) => {
	const normalizedPath = resolve(changedFile);
	const affected = new Set<string>();
	const toProcess = [normalizedPath];

	const processNode = (current: string) => {
		if (affected.has(current)) return;

		affected.add(current);

		const dependents = graph.dependents.get(current);
		if (!dependents) return;

		dependents.forEach((dependent) => toProcess.push(dependent));
	};

	while (toProcess.length > 0) {
		const current = toProcess.pop() ?? normalizedPath;
		processNode(current);
	}

	return Array.from(affected);
};

const removeDepsForFile = (graph: DependencyGraph, normalizedPath: string) => {
	const deps = graph.dependencies.get(normalizedPath);
	if (!deps) return;

	for (const dep of deps) {
		const dependents = graph.dependents.get(dep);
		if (!dependents) continue;
		dependents.delete(normalizedPath);
	}
	graph.dependencies.delete(normalizedPath);
};

const removeDependentsForFile = (
	graph: DependencyGraph,
	normalizedPath: string
) => {
	const dependents = graph.dependents.get(normalizedPath);
	if (!dependents) return;

	for (const dependent of dependents) {
		const depList = graph.dependencies.get(dependent);
		if (!depList) continue;
		depList.delete(normalizedPath);
	}
	graph.dependents.delete(normalizedPath);
};

export const removeFileFromGraph = (
	graph: DependencyGraph,
	filePath: string
) => {
	const normalizedPath = resolve(filePath);

	invalidateResolutionCache(normalizedPath);
	removeDepsForFile(graph, normalizedPath);
	removeDependentsForFile(graph, normalizedPath);
};
