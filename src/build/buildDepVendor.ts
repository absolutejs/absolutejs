import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild, Glob } from 'bun';

const toSafeFileName = (specifier: string) =>
	specifier.replace(/\//g, '_').replace(/@/g, '').replace(/-/g, '_');

const isResolvable = (specifier: string) => {
	try {
		require.resolve(specifier);

		return true;
	} catch {
		return false;
	}
};

const isBareSpecifier = (spec: string) =>
	!spec.startsWith('.') &&
	!spec.startsWith('/') &&
	!spec.startsWith('@src/');

// Known specifiers that are already handled by framework-specific vendors
const FRAMEWORK_SPECIFIERS = new Set([
	'react',
	'react-dom',
	'react-dom/client',
	'react-dom/server',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	'react-refresh/runtime',
	'svelte',
	'svelte/internal',
	'svelte/internal/client',
	'svelte/internal/disclose-version',
	'svelte/server',
	'svelte/store',
	'svelte/compiler',
	'vue',
	'vue/server-renderer',
	'@vue/compiler-sfc',
	'@angular/core',
	'@angular/common',
	'@angular/compiler',
	'@angular/platform-browser',
	'@angular/platform-server',
	'@angular/ssr'
]);

const isSkippedFile = (file: string) =>
	file.includes('node_modules') ||
	file.includes('/build/') ||
	file.includes('/dist/') ||
	file.includes('/indexes/');

const isDepSpecifier = (path: string) =>
	isBareSpecifier(path) && !FRAMEWORK_SPECIFIERS.has(path);

const readFileSpecifiers = async (
	file: string,
	transpiler: Bun.Transpiler
) => {
	const empty: string[] = [];
	try {
		const content = await Bun.file(file).text();

		return transpiler.scanImports(content).map((imp) => imp.path).filter(isDepSpecifier);
	} catch {
		return empty;
	}
};

const scanDirFiles = async (dir: string) => {
	const empty: string[] = [];
	const glob = new Glob('**/*.{ts,tsx,js,jsx}');
	try {
		const all = await Array.fromAsync(
			glob.scan({ absolute: true, cwd: dir })
		);

		return all.filter((file) => !isSkippedFile(file));
	} catch {
		return empty;
	}
};

const collectDirSpecifiers = async (
	dir: string,
	transpiler: Bun.Transpiler,
	specifiers: Set<string>
) => {
	const files = await scanDirFiles(dir);
	const results = await Promise.all(
		files.map((file) => readFileSpecifiers(file, transpiler))
	);
	for (const spec of results.flat()) {
		specifiers.add(spec);
	}
};

// Scan source files to find all bare import specifiers
const scanBareImports = async (directories: string[]) => {
	const specifiers = new Set<string>();
	const transpiler = new Bun.Transpiler({ loader: 'tsx' });

	await Promise.all(
		directories.map((dir) =>
			collectDirSpecifiers(dir, transpiler, specifiers)
		)
	);

	return Array.from(specifiers).filter(isResolvable);
};

const generateEntrySource = (specifier: string) =>
	`export * from '${specifier}';\n`;

const rewriteVendorFiles = async (vendorDir: string) => {
	const { readdirSync, readFileSync, writeFileSync } = await import('node:fs');
	const { computeVendorPaths } = await import('./buildReactVendor');
	const reactPaths = Object.entries(computeVendorPaths());

	const rewriteContent = (content: string) =>
		reactPaths.reduce((acc, [specifier, webPath]) => {
			const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const re = new RegExp(`(from\\s*["'])${escaped}(["'])`, 'g');

			return acc.replace(re, `$1${webPath}$2`);
		}, content);

	const files = readdirSync(vendorDir).filter((f) => f.endsWith('.js'));
	for (const file of files) {
		const filePath = join(vendorDir, file);
		const original = readFileSync(filePath, 'utf-8');
		const rewritten = rewriteContent(original);

		if (rewritten !== original) writeFileSync(filePath, rewritten);
	}
};

export const buildDepVendor = async (
	buildDir: string,
	directories: string[]
) => {
	const specifiers = await scanBareImports(directories);
	if (specifiers.length === 0) return {};

	const vendorDir = join(buildDir, 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_dep_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const entrypoints = await Promise.all(
		specifiers.map(async (specifier) => {
			const safeName = toSafeFileName(specifier);
			const entryPath = join(tmpDir, `${safeName}.ts`);
			const source = await generateEntrySource(specifier);
			await Bun.write(entryPath, source);

			return entryPath;
		})
	);

	// Externalize framework packages so vendor files import from the
	// same vendor instances — prevents duplicate React/Svelte/Vue/Angular
	const result = await bunBuild({
		entrypoints,
		external: [...FRAMEWORK_SPECIFIERS],
		format: 'esm',
		minify: false,
		naming: '[name].[ext]',
		outdir: vendorDir,
		splitting: true,
		target: 'browser',
		throw: false
	});

	await rm(tmpDir, { force: true, recursive: true });

	// Post-process: rewrite framework bare specifiers in vendor output
	// to their vendor paths so the browser can resolve them
	if (!result.success) {
		console.warn('⚠️ Dependency vendor build had errors:', result.logs);
	}

	if (result.success) await rewriteVendorFiles(vendorDir);

	const paths: Record<string, string> = {};
	for (const specifier of specifiers) {
		paths[specifier] = `/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};

export const computeDepVendorPaths = async (directories: string[]) => {
	const specifiers = await scanBareImports(directories);
	const paths: Record<string, string> = {};

	for (const specifier of specifiers) {
		paths[specifier] = `/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
