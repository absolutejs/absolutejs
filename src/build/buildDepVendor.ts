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
	'svelte/server',
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

// Scan source files to find all bare import specifiers
const scanBareImports = async (directories: string[]) => {
	const specifiers = new Set<string>();
	const transpiler = new Bun.Transpiler({ loader: 'tsx' });

	for (const dir of directories) {
		const glob = new Glob('**/*.{ts,tsx,js,jsx}');
		try {
			for await (const file of glob.scan({
				absolute: true,
				cwd: dir
			})) {
				if (file.includes('node_modules')) continue;
				if (file.includes('/build/')) continue;
				if (file.includes('/dist/')) continue;
				if (file.includes('/indexes/')) continue;

				try {
					const content = await Bun.file(file).text();
					const imports = transpiler.scanImports(content);
					for (const imp of imports) {
						if (
							isBareSpecifier(imp.path) &&
							!FRAMEWORK_SPECIFIERS.has(imp.path)
						) {
							specifiers.add(imp.path);
						}
					}
				} catch {
					// skip files that can't be parsed
				}
			}
		} catch {
			// skip directories that don't exist
		}
	}

	return Array.from(specifiers).filter(isResolvable);
};

const generateEntrySource = (specifier: string) =>
	`export * from '${specifier}';\n`;

export const computeDepVendorPaths = async (directories: string[]) => {
	const specifiers = await scanBareImports(directories);
	const paths: Record<string, string> = {};

	for (const specifier of specifiers) {
		paths[specifier] = `/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
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

	const result = await bunBuild({
		entrypoints,
		format: 'esm',
		minify: false,
		naming: '[name].[ext]',
		outdir: vendorDir,
		splitting: true,
		target: 'browser',
		throw: false
	});

	await rm(tmpDir, { force: true, recursive: true });

	if (!result.success) {
		console.warn('⚠️ Dependency vendor build had errors:', result.logs);
	}

	const paths: Record<string, string> = {};
	for (const specifier of specifiers) {
		paths[specifier] = `/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
