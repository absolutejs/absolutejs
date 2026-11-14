import type { Dirent } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { resolvePackageImport } from '../build/resolvePackageImport';
import { lowerSvelteIslandSyntax } from '../svelte/lowerIslandSyntax';
import { lowerSvelteAwaitSlotSyntax } from '../svelte/lowerAwaitSlotSyntax';
import { createSvelteStylePreprocessor } from '../build/stylePreprocessor';
import { LAZY_SOURCE_EXPORT } from '../svelte/router/lazyModule';
import { isDevelopmentRuntime } from '../utils/runtimeMode';
import { createIslandGenerationGuard } from './islandServerGeneration';

const serverCacheRoot = join(process.cwd(), '.absolutejs', 'islands', 'svelte');

const compiledModuleCache = new Map<string, string>();
const originalSourcePathCache = new Map<string, string>();
// Dev: an island edit moves the generation; compile again into new files
// so Bun imports the edit instead of its cached module.
const syncIslandGeneration = createIslandGenerationGuard(() => {
	compiledModuleCache.clear();
	originalSourcePathCache.clear();
});

const transpiler = new Bun.Transpiler({
	loader: 'ts',
	target: 'browser'
});

const ensureRelativeImportPath = (from: string, target: string) => {
	const importPath = relative(dirname(from), target).replace(/\\/g, '/');

	return importPath.startsWith('.') ? importPath : `./${importPath}`;
};

const processDirectoryEntries = (
	entries: Dirent<string>[],
	dir: string,
	targetFileName: string,
	stack: string[]
) => {
	for (const entry of entries) {
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) stack.push(entryPath);

		if (entry.isFile() && entry.name === targetFileName) {
			return entryPath;
		}
	}

	return null;
};

const searchDirectoryLevel = async (dirs: string[], targetFileName: string) => {
	if (dirs.length === 0) return null;

	const nextStack: string[] = [];
	const dirEntries = await Promise.all(
		dirs.map(async (dir) => ({
			dir,
			entries: await readdir(dir, {
				encoding: 'utf-8',
				withFileTypes: true
			})
		}))
	);

	for (const { dir, entries } of dirEntries) {
		const found = processDirectoryEntries(
			entries,
			dir,
			targetFileName,
			nextStack
		);
		if (found) return found;
	}

	return searchDirectoryLevel(nextStack, targetFileName);
};

const findSourceFileByBasename = async (
	searchRoot: string,
	targetFileName: string
) => searchDirectoryLevel([searchRoot], targetFileName);

const normalizeBuiltSvelteFileName = (sourcePath: string) =>
	basename(sourcePath).replace(/-[a-z0-9]{6,}(?=\.svelte$)/i, '');

const resolveOriginalSourcePath = async (sourcePath: string) => {
	const cachedPath = originalSourcePathCache.get(sourcePath);
	if (cachedPath !== undefined) {
		return cachedPath;
	}

	if (
		!sourcePath.includes(
			`${join(process.cwd(), 'build')}${process.platform === 'win32' ? '' : '/'}`
		) &&
		!sourcePath.includes('/build/')
	) {
		originalSourcePathCache.set(sourcePath, sourcePath);

		return sourcePath;
	}

	const resolvedSourcePath = await findSourceFileByBasename(
		join(process.cwd(), 'src'),
		normalizeBuiltSvelteFileName(sourcePath)
	);
	const nextPath = resolvedSourcePath ?? sourcePath;
	originalSourcePathCache.set(sourcePath, nextPath);

	return nextPath;
};

const resolveRelativeModule = async (spec: string, from: string) => {
	if (!spec.startsWith('.')) {
		return null;
	}

	const basePath = resolve(dirname(from), spec);
	const candidates = [
		basePath,
		`${basePath}.ts`,
		`${basePath}.js`,
		`${basePath}.mjs`,
		`${basePath}.cjs`,
		`${basePath}.json`,
		join(basePath, 'index.ts'),
		join(basePath, 'index.js'),
		join(basePath, 'index.mjs'),
		join(basePath, 'index.cjs'),
		join(basePath, 'index.json')
	];

	const existResults = await Promise.all(
		candidates.map((candidate) => Bun.file(candidate).exists())
	);
	const foundIndex = existResults.indexOf(true);

	return foundIndex >= 0 ? (candidates[foundIndex] ?? null) : null;
};

const getCachedModulePath = (sourcePath: string) => {
	const relativeSourcePath = relative(process.cwd(), sourcePath).replace(
		/\\/g,
		'/'
	);
	const normalizedSourcePath = relativeSourcePath.startsWith('..')
		? sourcePath.replace(/[:\\/]/g, '_')
		: relativeSourcePath;

	const generation = syncIslandGeneration();
	const generationSuffix = generation > 0 ? `.g${generation}` : '';

	return join(
		serverCacheRoot,
		`${normalizedSourcePath}${generationSuffix}.server.js`
	);
};

const resolveSvelteImport = async (spec: string, from: string) => {
	if (!spec.startsWith('.') && !spec.startsWith('/')) {
		const resolved = resolvePackageImport(spec);

		return resolved && resolved.endsWith('.svelte') ? resolved : null;
	}

	if (spec.startsWith('/')) {
		return spec;
	}

	if (!spec.startsWith('.')) {
		return null;
	}

	const explicitPath = resolve(dirname(from), spec);
	if (extname(explicitPath) === '.svelte') {
		return explicitPath;
	}

	const candidate = `${explicitPath}.svelte`;
	if ((await Bun.file(candidate).exists()) === true) {
		return candidate;
	}

	return null;
};

const writeIfChanged = async (path: string, content: string) => {
	const targetFile = Bun.file(path);
	const exists = await targetFile.exists();
	if (exists) {
		const currentContent = await targetFile.text();
		if (currentContent === content) {
			return;
		}
	}

	await Bun.write(path, content);
};

export const compileSvelteServerModule = async (sourcePath: string) => {
	syncIslandGeneration();
	const cachedModulePath = compiledModuleCache.get(sourcePath);
	if (cachedModulePath) {
		return cachedModulePath;
	}

	const resolutionSourcePath = await resolveOriginalSourcePath(sourcePath);
	const source = await Bun.file(sourcePath).text();
	const { compile, preprocess } = await import('svelte/compiler');
	const loweredAwaitSource = lowerSvelteAwaitSlotSyntax(source, sourcePath);
	const loweredSource = lowerSvelteIslandSyntax(
		loweredAwaitSource.code,
		'server'
	);
	const preprocessed = await preprocess(
		loweredSource.code,
		createSvelteStylePreprocessor()
	);
	let transpiled =
		sourcePath.endsWith('.ts') || sourcePath.endsWith('.svelte.ts')
			? transpiler.transformSync(preprocessed.code)
			: preprocessed.code;
	// Static imports, plus `import('./Page.svelte')` (a lazy `<Route
	// loader>`), whose child must be compiled too.
	const childImportSpecs = Array.from(
		new Set(
			Array.from(
				transpiled.matchAll(
					/(?:from\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/g
				)
			)
				.map((match) => match[1])
				.filter((value): value is string => value !== undefined)
		)
	);
	const resolvedChildModules = await Promise.all(
		childImportSpecs.map((spec) =>
			resolveSvelteImport(spec, resolutionSourcePath)
		)
	);
	const resolvedModuleImports = await Promise.all(
		childImportSpecs.map((spec) =>
			resolveRelativeModule(spec, resolutionSourcePath)
		)
	);
	const childModulePaths = new Map<string, string>();
	const rewrittenModulePaths = new Map<string, string>();

	const compiledChildren = await Promise.all(
		childImportSpecs.map(async (spec, index) => {
			const resolvedChild = resolvedChildModules[index];
			if (!spec || !resolvedChild) return null;

			return {
				compiledPath: await compileSvelteServerModule(resolvedChild),
				resolvedChild,
				spec
			};
		})
	);

	for (const result of compiledChildren) {
		if (!result) continue;
		childModulePaths.set(result.spec, result.compiledPath);
		childModulePaths.set(result.resolvedChild, result.compiledPath);
	}

	for (let index = 0; index < childImportSpecs.length; index += 1) {
		const spec = childImportSpecs[index];
		const resolvedModuleImport = resolvedModuleImports[index];
		if (!spec || !resolvedModuleImport) continue;
		if (resolvedChildModules[index]) continue;

		rewrittenModulePaths.set(
			spec,
			ensureRelativeImportPath(
				getCachedModulePath(sourcePath),
				resolvedModuleImport
			)
		);
	}

	for (const [spec, resolvedModuleImport] of rewrittenModulePaths) {
		transpiled = transpiled.replaceAll(spec, resolvedModuleImport);
	}

	let compiledCode = compile(transpiled, {
		css: 'injected',
		experimental: {
			async: loweredAwaitSource.transformed || loweredSource.transformed
		},
		filename: resolutionSourcePath,
		generate: 'server',
		// The dev server's client modules are compiled with `hmr`, which
		// changes the anchor comments around a lone component. The server
		// render has to place the same anchors or hydration fails.
		hmr: isDevelopmentRuntime()
	}).js.code;

	for (const [spec, compiledChildPath] of childModulePaths) {
		compiledCode = compiledCode.replaceAll(
			spec,
			ensureRelativeImportPath(
				getCachedModulePath(sourcePath),
				compiledChildPath
			)
		);
	}

	for (const [spec, resolvedModuleImport] of rewrittenModulePaths) {
		compiledCode = compiledCode.replaceAll(spec, resolvedModuleImport);
	}

	// Name the source, as compileSvelte does, so a lazy route rendered
	// from this module can be matched to its client chunk.
	const sourceId = JSON.stringify(
		relative(process.cwd(), resolutionSourcePath).replace(/\\/g, '/')
	);
	const componentName = /export default function ([\w$]+)\s*\(/.exec(
		compiledCode
	)?.[1];
	compiledCode += `\nexport const ${LAZY_SOURCE_EXPORT} = ${sourceId};`;
	if (componentName) {
		compiledCode += `\n${componentName}.${LAZY_SOURCE_EXPORT} = ${sourceId};`;
	}

	const compiledModulePath = getCachedModulePath(sourcePath);
	await mkdir(dirname(compiledModulePath), { recursive: true });
	await writeIfChanged(compiledModulePath, compiledCode);
	compiledModuleCache.set(sourcePath, compiledModulePath);

	return compiledModulePath;
};
