import { env } from 'bun';
import { createExternalAssetPlugin } from '../../build/externalAssetPlugin';
import { loadIslandRegistryBuildInfo } from '../../build/islandEntries';
import { createIslandRegistryDefinitionPlugin } from '../../build/islandRegistryTransform';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { BuildConfig } from '../../../types/build';
import { DEFAULT_PORT } from '../../constants';
import { prerenderWithServer } from '../../core/prerender';
import { getDurationString } from '../../utils/getDurationString';
import { withBuildDirectoryLock } from '../../utils/buildDirectoryLock';
import { loadConfig } from '../../utils/loadConfig';
import { formatTimestamp } from '../../utils/startupBanner';
import { sendTelemetryEvent } from '../telemetryEvent';
import { killStaleProcesses } from '../utils';

// ── Logging ─────────────────────────────────────────────────────
const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

const compileBanner = (version: string) => {
	const resolvedVersion = version || 'unknown';
	console.log('');
	console.log(
		`  \x1b[36m\x1b[1mABSOLUTEJS\x1b[0m \x1b[2mv${resolvedVersion}\x1b[0m  \x1b[2mcompile\x1b[0m`
	);
	console.log('');
};

// ── File utilities ──────────────────────────────────────────────
const collectFiles = (dir: string) => {
	const result: string[] = [];
	let pending = readdirSync(dir, { withFileTypes: true });

	while (pending.length > 0) {
		const entry = pending.pop();
		if (!entry) continue;

		const fullPath = join(entry.parentPath, entry.name);
		if (entry.isDirectory())
			pending = pending.concat(
				readdirSync(fullPath, { withFileTypes: true })
			);
		else result.push(fullPath);
	}

	return result;
};

const SERVER_RUNTIME_ASSET_RE =
	/new\s+URL\(\s*["'](\.\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
const SERVER_RUNTIME_IMPORT_META_DIR_JOIN_RE =
	/(?:join|resolve)\(\s*import\.meta\.dir\s*,\s*((?:(?:"[^"]+"|'[^']+')\s*,?\s*)+)\)/g;
const SERVER_RUNTIME_STRING_ARG_RE = /["']([^"']+)["']/g;
const SERVER_RUNTIME_SOURCE_EXTENSIONS = new Set([
	'.cjs',
	'.js',
	'.jsx',
	'.mjs',
	'.ts',
	'.tsx'
]);
const SERVER_RUNTIME_SCAN_SKIP_DIRS = new Set([
	'.absolutejs',
	'.git',
	'build',
	'dist',
	'node_modules'
]);

const hasSourceExtension = (filePath: string) =>
	SERVER_RUNTIME_SOURCE_EXTENSIONS.has(
		filePath.slice(filePath.lastIndexOf('.'))
	);

const normalizeServerRuntimeAssetPath = (parts: string[]) => {
	if (parts.length === 0) return null;
	if (
		parts.some(
			(part) => part === '..' || part.includes('/') || part.includes('\\')
		)
	)
		return null;

	return `./${parts.join('/')}`;
};

const collectProjectSourceFiles = (dir: string) => {
	const result: string[] = [];
	let pending = readdirSync(dir, { withFileTypes: true });

	while (pending.length > 0) {
		const entry = pending.pop();
		if (!entry) continue;

		const fullPath = join(entry.parentPath, entry.name);
		if (entry.isDirectory()) {
			if (SERVER_RUNTIME_SCAN_SKIP_DIRS.has(entry.name)) continue;
			pending = pending.concat(
				readdirSync(fullPath, { withFileTypes: true })
			);
		} else if (hasSourceExtension(fullPath)) {
			result.push(fullPath);
		}
	}

	return result;
};

const copyServerRuntimeAssetReferences = (outdir: string) => {
	const copied = new Set<string>();
	const normalizedOutdir = resolve(outdir);
	const copyReference = (filePath: string, relPath: string) => {
		const assetSource = resolve(dirname(filePath), relPath);
		if (!existsSync(assetSource) || !statSync(assetSource).isFile()) return;

		const assetTarget = resolve(
			normalizedOutdir,
			relPath.replace(/^\.\//, '')
		);
		if (
			assetTarget !== normalizedOutdir &&
			!assetTarget.startsWith(`${normalizedOutdir}/`)
		)
			return;
		if (copied.has(assetTarget)) return;
		copied.add(assetTarget);

		mkdirSync(dirname(assetTarget), { recursive: true });
		cpSync(assetSource, assetTarget, { force: true });
	};

	for (const filePath of collectProjectSourceFiles(process.cwd())) {
		const source = readFileSync(filePath, 'utf-8');
		SERVER_RUNTIME_ASSET_RE.lastIndex = 0;
		let match;
		while ((match = SERVER_RUNTIME_ASSET_RE.exec(source)) !== null) {
			const relPath = match[1];
			if (!relPath) continue;

			copyReference(filePath, relPath);
		}

		SERVER_RUNTIME_IMPORT_META_DIR_JOIN_RE.lastIndex = 0;
		while (
			(match = SERVER_RUNTIME_IMPORT_META_DIR_JOIN_RE.exec(source)) !==
			null
		) {
			const args = match[1];
			if (!args) continue;

			SERVER_RUNTIME_STRING_ARG_RE.lastIndex = 0;
			const parts: string[] = [];
			for (const partMatch of args.matchAll(
				SERVER_RUNTIME_STRING_ARG_RE
			)) {
				const part = partMatch[1];
				if (part) parts.push(part);
			}
			const relPath = normalizeServerRuntimeAssetPath(parts);
			if (!relPath) continue;

			copyReference(filePath, relPath);
		}
	}
};

const readPackageVersion = (candidate: string) => {
	try {
		const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
		if (pkg.name !== '@absolutejs/absolute') return null;
		const ver: string = pkg.version;

		return ver;
	} catch {
		return null;
	}
};

const resolvePackageVersion = (candidates: string[]) => {
	for (const candidate of candidates) {
		const version = readPackageVersion(candidate);
		if (version) return version;
	}

	return '';
};

const tryImportBuild = async (candidate: string) => {
	try {
		const mod = await import(candidate);
		const buildFn: typeof import('../../core/build').build = mod.build;

		return buildFn;
	} catch {
		return null;
	}
};

const resolveBuildModule = async (candidates: string[]) => {
	const [candidate, ...remaining] = candidates;
	if (!candidate) {
		return undefined;
	}

	const mod = await tryImportBuild(candidate);
	if (mod) {
		return mod;
	}

	return resolveBuildModule(remaining);
};

const resolveJsxDevRuntimeCompatPath = () => {
	const candidates = [
		resolve(
			import.meta.dir,
			'..',
			'..',
			'dist',
			'react',
			'jsxDevRuntimeCompat.js'
		),
		resolve(import.meta.dir, '..', '..', 'react', 'jsxDevRuntimeCompat.js'),
		resolve(import.meta.dir, '..', '..', 'react', 'jsxDevRuntimeCompat.ts'),
		resolve(
			import.meta.dir,
			'..',
			'..',
			'..',
			'dist',
			'react',
			'jsxDevRuntimeCompat.js'
		),
		resolve(
			import.meta.dir,
			'..',
			'..',
			'..',
			'react',
			'jsxDevRuntimeCompat.js'
		),
		resolve(
			import.meta.dir,
			'..',
			'..',
			'..',
			'src',
			'react',
			'jsxDevRuntimeCompat.ts'
		)
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return resolve(
		import.meta.dir,
		'..',
		'..',
		'react',
		'jsxDevRuntimeCompat.js'
	);
};

const jsxDevRuntimeCompatPath = resolveJsxDevRuntimeCompatPath();

export const shouldEmbedCompiledAsset = (
	relativePath: string,
	skip: Set<string> = new Set()
) => {
	if (skip.has(relativePath)) return false;
	if (relativePath.split(/[\\/]/).includes('.generated')) return false;
	if (relativePath.split(/[\\/]/).includes('node_modules')) return false;
	if (relativePath.includes('/server/')) return false;

	return true;
};

const tryReadNodePackageJson = (packageDir: string) => {
	try {
		return JSON.parse(
			readFileSync(join(packageDir, 'package.json'), 'utf-8')
		);
	} catch {
		return null;
	}
};

const resolveProjectPackageDir = (specifier: string) =>
	resolve(process.cwd(), 'node_modules', ...specifier.split('/'));

const copyPackageToBuild = (
	specifier: string,
	outdir: string,
	seen: Set<string>
) => {
	if (seen.has(specifier)) return;

	const srcDir = resolveProjectPackageDir(specifier);
	const pkg = tryReadNodePackageJson(srcDir);
	if (!pkg) return;
	seen.add(specifier);

	const destDir = join(outdir, 'node_modules', ...specifier.split('/'));
	rmSync(destDir, { force: true, recursive: true });
	cpSync(srcDir, destDir, {
		filter(source) {
			const rel = relative(srcDir, source);
			const [firstSegment] = rel.split(/[\\/]/);

			return firstSegment !== 'node_modules' && firstSegment !== '.git';
		},
		force: true,
		recursive: true
	});

	const deps = {
		...(pkg.dependencies ?? {}),
		...(pkg.peerDependencies ?? {}),
		...(pkg.optionalDependencies ?? {})
	};
	for (const dep of Object.keys(deps)) {
		copyPackageToBuild(dep, outdir, seen);
	}
};

const copyAngularRuntimePackages = (
	buildConfig: BuildConfig,
	outdir: string
) => {
	if (!buildConfig.angularDirectory) return;

	const angularScopeDir = resolve(process.cwd(), 'node_modules', '@angular');
	const angularPackages = existsSync(angularScopeDir)
		? readdirSync(angularScopeDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.filter((entry) => entry.name !== 'compiler-cli')
				.map((entry) => `@angular/${entry.name}`)
		: [];

	const roots = new Set([...angularPackages, 'rxjs', 'tslib', 'typescript']);
	const seen = new Set<string>();
	for (const specifier of roots) {
		copyPackageToBuild(specifier, outdir, seen);
	}
};

const copyFrameworkRuntimePackages = (
	buildConfig: BuildConfig,
	outdir: string
) => {
	const seen = new Set<string>();

	if (buildConfig.svelteDirectory) {
		copyPackageToBuild('svelte', outdir, seen);
	}

	if (buildConfig.vueDirectory) {
		copyPackageToBuild('vue', outdir, seen);
		copyPackageToBuild('@vue/server-renderer', outdir, seen);
	}

	copyAngularRuntimePackages(buildConfig, outdir);
};

const collectRuntimePackageSpecifiers = (distDir: string) => {
	const nodeModulesDir = join(distDir, 'node_modules');
	if (!existsSync(nodeModulesDir)) return [];

	const specifiers: string[] = [];
	for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith('@')) {
			const scopeDir = join(nodeModulesDir, entry.name);
			for (const scopedEntry of readdirSync(scopeDir, {
				withFileTypes: true
			})) {
				if (scopedEntry.isDirectory()) {
					specifiers.push(`${entry.name}/${scopedEntry.name}`);
				}
			}
			continue;
		}

		specifiers.push(entry.name);
	}

	return specifiers.sort((a, b) => b.length - a.length);
};

const ensureRelativeModuleSpecifier = (fromFile: string, toFile: string) => {
	const rel = relative(dirname(fromFile), toFile).replace(/\\/g, '/');

	return rel.startsWith('.') ? rel : `./${rel}`;
};

const pickExportEntry = (value: unknown): string | undefined => {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return undefined;

	const record = value as Record<string, unknown>;
	for (const key of ['bun', 'node', 'import', 'module', 'default']) {
		const entry = pickExportEntry(record[key]);
		if (entry) return entry;
	}

	return undefined;
};

const resolvePackageEntryFile = (
	distDir: string,
	packageSpecifiers: string[],
	specifier: string
) => {
	const packageSpecifier = packageSpecifiers.find(
		(root) => specifier === root || specifier.startsWith(`${root}/`)
	);
	if (!packageSpecifier) return null;

	const packageDir = join(
		distDir,
		'node_modules',
		...packageSpecifier.split('/')
	);
	const subpath = specifier.slice(packageSpecifier.length);
	const subPackageDir = subpath
		? join(packageDir, ...subpath.slice(1).split('/'))
		: null;
	const resolvedPackageDir =
		subPackageDir && existsSync(join(subPackageDir, 'package.json'))
			? subPackageDir
			: packageDir;
	const packageJsonPath = join(resolvedPackageDir, 'package.json');
	if (!existsSync(packageJsonPath)) return null;

	const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
	const exportKey =
		resolvedPackageDir === subPackageDir
			? '.'
			: subpath
				? `.${subpath}`
				: '.';
	const rootExport = pkg.exports?.[exportKey];
	const entry =
		pickExportEntry(rootExport) ??
		(resolvedPackageDir === subPackageDir || !subpath
			? (pkg.module ?? pkg.main ?? 'index.js')
			: `.${subpath}`);

	return join(resolvedPackageDir, entry);
};

const RUNTIME_JS_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const MODULE_SPECIFIER_RE =
	/(from\s*|import\s*|import\(\s*|require\(\s*)(["'])([^"']+)\2/g;

const isRuntimeJsFile = (filePath: string) =>
	RUNTIME_JS_EXTENSIONS.some((extension) => filePath.endsWith(extension));

const isNodeModulesPath = (filePath: string) =>
	filePath.split(/[\\/]/).includes('node_modules');

const isFile = (filePath: string) => {
	try {
		return statSync(filePath).isFile();
	} catch {
		return false;
	}
};

const resolveRuntimeJsFile = (candidate: string) => {
	if (!candidate) return null;

	const candidates = [
		candidate,
		...RUNTIME_JS_EXTENSIONS.map((extension) => `${candidate}${extension}`),
		...RUNTIME_JS_EXTENSIONS.map((extension) =>
			join(candidate, `index${extension}`)
		)
	];

	return (
		candidates.find(
			(filePath) => isRuntimeJsFile(filePath) && isFile(filePath)
		) ?? null
	);
};

const findContainingRuntimePackageDir = (filePath: string) => {
	let dir = dirname(filePath);

	while (dir !== dirname(dir)) {
		if (isNodeModulesPath(dir) && existsSync(join(dir, 'package.json'))) {
			return dir;
		}
		dir = dirname(dir);
	}

	return null;
};

const resolvePackageImportEntryFile = (fromFile: string, specifier: string) => {
	if (!specifier.startsWith('#')) return null;

	const packageDir = findContainingRuntimePackageDir(fromFile);
	if (!packageDir) return null;

	const pkg = tryReadNodePackageJson(packageDir);
	const entry = pickExportEntry(pkg?.imports?.[specifier]);
	if (!entry) return null;

	return join(packageDir, entry);
};

const collectRuntimeRewriteRoots = (distDir: string) =>
	collectFiles(distDir).filter(
		(filePath) => isRuntimeJsFile(filePath) && !isNodeModulesPath(filePath)
	);

const rewriteRuntimeModuleSpecifiers = (distDir: string) => {
	const packageSpecifiers = collectRuntimePackageSpecifiers(distDir);
	if (packageSpecifiers.length === 0) return;

	const pending = collectRuntimeRewriteRoots(distDir);
	const seen = new Set<string>();
	const enqueue = (filePath: string | null) => {
		if (!filePath || seen.has(filePath) || !isRuntimeJsFile(filePath))
			return;
		if (!isFile(filePath)) return;
		pending.push(filePath);
	};

	for (let index = 0; index < pending.length; index += 1) {
		const filePath = pending[index];
		if (!filePath || seen.has(filePath)) continue;
		seen.add(filePath);

		const source = readFileSync(filePath, 'utf-8');
		const rewritten = source.replace(
			MODULE_SPECIFIER_RE,
			(match, prefix, quote, specifier) => {
				if (
					typeof specifier === 'string' &&
					specifier.startsWith('.')
				) {
					enqueue(
						resolveRuntimeJsFile(
							resolve(dirname(filePath), specifier)
						)
					);

					return match;
				}

				const packageImportTarget = resolveRuntimeJsFile(
					resolvePackageImportEntryFile(filePath, specifier) ?? ''
				);
				if (packageImportTarget) {
					enqueue(packageImportTarget);

					return `${prefix}${quote}${ensureRelativeModuleSpecifier(filePath, packageImportTarget)}${quote}`;
				}

				const target = resolveRuntimeJsFile(
					resolvePackageEntryFile(
						distDir,
						packageSpecifiers,
						specifier
					) ?? ''
				);
				if (!target) return match;
				enqueue(target);

				return `${prefix}${quote}${ensureRelativeModuleSpecifier(filePath, target)}${quote}`;
			}
		);

		if (rewritten !== source) {
			writeFileSync(filePath, rewritten);
		}
	}
};

// ── Generate the compile entrypoint ─────────────────────────────
const generateEntrypoint = (
	distDir: string,
	serverEntry: string,
	prerenderMap: Map<string, string>, // route -> prerendered file path
	version: string,
	buildConfig: BuildConfig
) => {
	const allFiles = collectFiles(distDir);
	const serverBundleName = `${basename(serverEntry).replace(/\.[^.]+$/, '')}.js`;
	const embeddedSkip = new Set(['_compile_entrypoint.ts']);
	const assetSkip = new Set([
		serverBundleName,
		'manifest.json',
		'_compile_entrypoint.ts'
	]);

	const embeddedFiles = allFiles.filter((file) => {
		const rel = relative(distDir, file);
		if (embeddedSkip.has(rel)) return false;

		return true;
	});

	const clientFiles = embeddedFiles.filter((file) =>
		shouldEmbedCompiledAsset(relative(distDir, file), assetSkip)
	);

	const imports: string[] = [];
	const embeddedMappings: string[] = [];
	const mappings: string[] = [];
	const embeddedVarMap = new Map<string, string>();

	embeddedFiles.forEach((filePath, idx) => {
		const rel = relative(distDir, filePath).replace(/\\/g, '/');
		const varName = `__a${idx}`;
		embeddedVarMap.set(rel, varName);

		imports.push(
			`import ${varName} from "./${rel}" with { type: "file" };`
		);
		embeddedMappings.push(`\t["${rel}", ${varName}],`);
	});

	clientFiles.forEach((filePath) => {
		const rel = relative(distDir, filePath).replace(/\\/g, '/');
		const varName = embeddedVarMap.get(rel);
		if (!varName) return;
		const urlPath = `/${rel}`;

		mappings.push(`\t"${urlPath}": ${varName},`);

		// Add unhashed alias for worker files
		const workerParts =
			rel.startsWith('workers/') && rel.endsWith('.js')
				? rel.match(/^(workers\/[^.]+\.worker)\.[a-z0-9]+\.js$/)
				: null;
		if (workerParts) {
			mappings.push(`\t"/${workerParts[1]}.js": ${varName},`);
		}
	});

	// Build route → embedded page mapping
	const pageVarMap = new Map<string, string>();
	const prerenderEntries = Array.from(prerenderMap.entries());
	prerenderEntries.forEach(([route, filePath]) => {
		const rel = relative(distDir, filePath).replace(/\\/g, '/');
		const varName = embeddedVarMap.get(rel);
		if (varName) pageVarMap.set(route, varName);
	});

	const routeEntries = Array.from(pageVarMap.entries())
		.map(([route, varName]) => `\t"${route}": ${varName},`)
		.join('\n');
	const runtimeBuildId = `${version}-${Date.now().toString(36)}`;
	const runtimeConfigSource = JSON.stringify(
		buildConfig,
		(_key, value) =>
			typeof value === 'function' || typeof value === 'symbol'
				? undefined
				: value,
		2
	);
	return `// Auto-generated compile entrypoint
// ── Embedded asset imports ──────────────────────────────────────
${imports.join('\n')}

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SERVER_MODULE = (runtimeDir: string) => import(pathToFileURL(join(runtimeDir, ${JSON.stringify(serverBundleName)})).href);
const RUNTIME_BUILD_ID = ${JSON.stringify(runtimeBuildId)};
const RUNTIME_CONFIG_SOURCE = ${JSON.stringify(runtimeConfigSource)};
const ORIGINAL_BUILD_DIR = ${JSON.stringify(resolve(distDir))};
const ORIGINAL_BUILD_DIR_NORMALIZED = ORIGINAL_BUILD_DIR.replace(/\\\\/g, "/");

// ── Asset URL → embedded path map ───────────────────────────────
const ASSETS: Record<string, string> = {
${mappings.join('\n')}
};

// ── Embedded build files → source paths ─────────────────────────
const EMBEDDED_FILES: Array<[string, string]> = [
${embeddedMappings.join('\n')}
];

// ── Pre-rendered page routes ────────────────────────────────────
const PAGES: Record<string, string> = {
${routeEntries}
};

// ── MIME types ──────────────────────────────────────────────────
const MIME: Record<string, string> = {
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".webp": "image/webp",
	".avif": "image/avif",
};

const getMime = (p: string) =>
	MIME[p.substring(p.lastIndexOf("."))] ?? "application/octet-stream";

// ── Server ──────────────────────────────────────────────────────
const port = Number(process.env.PORT) || ${DEFAULT_PORT};

// Uncaught-error safety net for the compiled binary. \`bun --hot\` and
// \`bun dev\` both keep the process alive on uncaught throws / rejections;
// a standalone executable has no such wrapper, so a stream-error inside
// a route handler (\`controller.error(new Error(...))\`) would otherwise
// kill the server. Log loudly + stay up — same shape as the resilience
// every production HTTP server is expected to have.
process.on("uncaughtException", (err) => {
	console.error("[absolutejs] uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
	console.error("[absolutejs] unhandled rejection:", reason);
});

const servePage = (path: string) =>
	new Response(Bun.file(path), {
		headers: { "content-type": "text/html; charset=utf-8" },
	});

const resolvePage = (url: URL) => PAGES[url.pathname + url.search] ?? PAGES[url.pathname];

let runtimeFetchPromise: Promise<((request: Request) => Response | Promise<Response>) | null> | undefined;

const getRuntimeDir = () => {
	const hash = createHash("sha1")
		.update(import.meta.path)
		.update(RUNTIME_BUILD_ID)
		.digest("hex")
		.slice(0, 12);

	return join(tmpdir(), "absolutejs-compiled-runtime-" + hash);
};

const materializeRuntimeFiles = async () => {
	const runtimeDir = getRuntimeDir();
	const marker = join(runtimeDir, ".ready");
	const configPath = join(runtimeDir, "absolute.config.mjs");

	if (existsSync(marker) && existsSync(configPath)) {
		return { configPath, runtimeDir };
	}

	await mkdir(runtimeDir, { recursive: true });
	await Promise.all(
		EMBEDDED_FILES.map(async ([rel, source]) => {
			const target = join(runtimeDir, rel);
			await mkdir(dirname(target), { recursive: true });
			await Bun.write(target, Bun.file(source));
		})
	);
	writeFileSync(
		configPath,
		"export default " + RUNTIME_CONFIG_SOURCE + ";\\n"
	);
	rewriteRuntimeJsonPaths(runtimeDir, "manifest.json");
	rewriteRuntimeJsonPaths(runtimeDir, "conventions.json");
	writeFileSync(marker, String(Date.now()));

	return { configPath, runtimeDir };
};

const rewriteRuntimePath = (value: string, runtimeDir: string) => {
	const normalized = value.replace(/\\\\/g, "/");
	if (normalized === ORIGINAL_BUILD_DIR_NORMALIZED) return runtimeDir;
	if (!normalized.startsWith(ORIGINAL_BUILD_DIR_NORMALIZED + "/")) return value;

	const rel = normalized.slice(ORIGINAL_BUILD_DIR_NORMALIZED.length + 1);
	return join(runtimeDir, ...rel.split("/"));
};

const rewriteRuntimeJsonValue = (value: unknown, runtimeDir: string): unknown => {
	if (typeof value === "string") return rewriteRuntimePath(value, runtimeDir);
	if (Array.isArray(value))
		return value.map((item) => rewriteRuntimeJsonValue(item, runtimeDir));
	if (!value || typeof value !== "object") return value;

	const next: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		next[key] = rewriteRuntimeJsonValue(child, runtimeDir);
	}

	return next;
};

const rewriteRuntimeJsonPaths = (runtimeDir: string, fileName: string) => {
	const filePath = join(runtimeDir, fileName);
	if (!existsSync(filePath)) return;

	const original = JSON.parse(readFileSync(filePath, "utf-8"));
	const rewritten = rewriteRuntimeJsonValue(original, runtimeDir);
	writeFileSync(filePath, JSON.stringify(rewritten, null, "\\t"));
};

const resolveRuntimeFetch = async () => {
	const { configPath, runtimeDir } = await materializeRuntimeFiles();
	process.env.ABSOLUTE_BUILD_DIR = runtimeDir;
	process.env.ABSOLUTE_CONFIG = configPath;
	process.env.ABSOLUTE_COMPILED_RUNTIME = "1";
	process.env.ABSOLUTE_VERSION = process.env.ABSOLUTE_VERSION || "${version}";
	process.env.NODE_ENV = "production";
	process.chdir(runtimeDir);

	const mod = await SERVER_MODULE(runtimeDir);
	const runtimeServer = mod.server ?? mod.default ?? mod.app;
	const fetchHandler = runtimeServer?.fetch;
	if (typeof fetchHandler !== "function") return null;

	return fetchHandler.bind(runtimeServer);
};

const getRuntimeFetch = () => {
	runtimeFetchPromise ??= resolveRuntimeFetch().catch((error) => {
		console.error("[compile] Failed to load embedded runtime:", error);

		return null;
	});

	return runtimeFetchPromise;
};

const server = Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);

		// Check for pre-rendered page
		const page = resolvePage(url);
		if (page) return servePage(page);

		// Check for embedded asset
		const embedded = ASSETS[url.pathname];
		if (embedded) {
			return new Response(Bun.file(embedded), {
				headers: {
					"cache-control": "public, max-age=31536000, immutable",
					"content-type": getMime(url.pathname),
				},
			});
		}

		const runtimeFetch = await getRuntimeFetch();
		if (runtimeFetch) return runtimeFetch(request);

		return new Response("Not found", { status: 404 });
	},
});

// Register in the global instance registry so 'absolute ls' can see this
// compiled binary. Best-effort; never blocks startup. Dead entries are pruned
// on read, so a hard kill that skips the exit handler is harmless.
try {
	const absInstancesDir = join(homedir(), ".absolutejs", "instances");
	mkdirSync(absInstancesDir, { recursive: true });
	const absInstanceFile = join(absInstancesDir, process.pid + ".json");
	writeFileSync(
		absInstanceFile,
		JSON.stringify(
			{
				// Bun sets process.argv[0] to "bun" in a compiled binary;
				// process.execPath is the real standalone executable path.
				command: process.execPath ? [process.execPath] : [],
				configPath: null,
				controllerPid: process.pid,
				cwd: process.cwd(),
				frameworks: [],
				host: "localhost",
				https: false,
				logFile: null,
				name: basename(process.execPath || "compiled"),
				pid: process.pid,
				port: server.port,
				ppid: process.ppid,
				source: "compiled",
				startedAt: new Date().toISOString()
			},
			null,
			2
		)
	);
	process.on("exit", () => {
		try {
			unlinkSync(absInstanceFile);
		} catch {
			/* already gone */
		}
	});
} catch {
	/* registry is best-effort */
}

const assetCount = Object.keys(ASSETS).length;
const pageCount = Object.keys(PAGES).length;
console.log(\`
  \\x1b[36m\\x1b[1mABSOLUTEJS\\x1b[0m \\x1b[2mv${version}\\x1b[0m  \\x1b[2mcompiled executable\\x1b[0m

  \\x1b[32m➜\\x1b[0m  \\x1b[1mLocal:\\x1b[0m   http://localhost:\${server.port}/

  \\x1b[2m\${pageCount} pre-rendered pages, \${assetCount} embedded assets, runtime fallback\\x1b[0m
\`);
`;
};

type StubPluginOptions = {
	stubAngular?: boolean;
	stubReact?: boolean;
	stubSvelte?: boolean;
	stubVue?: boolean;
};

// ── Stub plugin (shared with start.ts) ──────────────────────────
const createStubPlugin = (
	options: StubPluginOptions = {}
): import('bun').BunPlugin => ({
	name: 'stub-framework-sources',
	setup(bld) {
		const escapeRegex = (value: string) =>
			value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const runtimeStubs = new Map<string, string>();
		if (options.stubReact) {
			runtimeStubs.set(
				'react',
				'export const createElement = () => null; export default { createElement };'
			);
			runtimeStubs.set(
				'react-dom/server',
				'const unavailable = async () => { throw new Error("React runtime is unavailable in this compiled app."); }; export const renderToReadableStream = unavailable; export const renderToString = unavailable; export const renderToStaticMarkup = unavailable;'
			);
			runtimeStubs.set(
				'react-dom',
				'export const createPortal = () => null; export default { createPortal };'
			);
			runtimeStubs.set(
				'react/jsx-runtime',
				'export const jsx = () => null; export const jsxs = () => null; export const Fragment = Symbol.for("react.fragment");'
			);
			runtimeStubs.set(
				'react/jsx-dev-runtime',
				'export const jsxDEV = () => null; export const Fragment = Symbol.for("react.fragment");'
			);
		}
		if (options.stubSvelte) {
			runtimeStubs.set(
				'svelte/server',
				'const unavailable = () => { throw new Error("Svelte runtime is unavailable in this compiled app."); }; export const render = unavailable;'
			);
			runtimeStubs.set('svelte', 'export default {};');
		}
		if (options.stubAngular) {
			const decoratorStub =
				'const decorator = () => (target) => target; export const Component = decorator; export const Directive = decorator; export const Injectable = decorator; export const NgModule = decorator; export const Pipe = decorator;';
			runtimeStubs.set(
				'@angular/core',
				`${decoratorStub} export class InjectionToken { constructor(description) { this._desc = description; this.ngMetadataName = "InjectionToken"; } toString() { return "InjectionToken " + this._desc; } } export class EnvironmentInjector {} export class ErrorHandler {} export const REQUEST = new InjectionToken("REQUEST"); export const REQUEST_CONTEXT = new InjectionToken("REQUEST_CONTEXT"); export const RESPONSE_INIT = new InjectionToken("RESPONSE_INIT"); export const ENVIRONMENT_INITIALIZER = new InjectionToken("ENVIRONMENT_INITIALIZER"); export const Sanitizer = class {}; export const SecurityContext = {}; export const enableProdMode = () => {}; export const inject = () => undefined; export const provideZonelessChangeDetection = () => []; export const reflectComponentType = () => null; export const Type = Function; export default {};`
			);
			runtimeStubs.set(
				'@angular/common',
				'export const APP_BASE_HREF = "APP_BASE_HREF"; export default {};'
			);
			runtimeStubs.set('@angular/compiler', 'export default {};');
			runtimeStubs.set(
				'@angular/platform-browser',
				'const unavailable = async () => { throw new Error("Angular runtime is unavailable in this compiled app."); }; export const bootstrapApplication = unavailable; export class DomSanitizer {} export const provideClientHydration = () => []; export const withHttpTransferCacheOptions = () => []; export default {};'
			);
			runtimeStubs.set(
				'@angular/platform-server',
				'const unavailable = async () => { throw new Error("Angular runtime is unavailable in this compiled app."); }; export const renderApplication = unavailable; export const provideServerRendering = () => []; export class ɵDominoAdapter { static makeCurrent() {} createHtmlDocument() { return null; } getDefaultDocument() { return null; } } export default {};'
			);
		}
		runtimeStubs.set(
			'svelte/compiler',
			'const unavailable = () => { throw new Error("Svelte source compiler is unavailable in compiled production runtime. Use built manifest page paths."); }; export const compile = unavailable; export const compileModule = unavailable; export const preprocess = unavailable;'
		);
		if (options.stubVue) {
			runtimeStubs.set(
				'vue',
				'const unavailable = () => { throw new Error("Vue runtime is unavailable in this compiled app."); }; export const createSSRApp = unavailable; export const h = unavailable; export default {};'
			);
			runtimeStubs.set(
				'vue/server-renderer',
				'const unavailable = async () => { throw new Error("Vue runtime is unavailable in this compiled app."); }; export const renderToString = unavailable;'
			);
		}
		runtimeStubs.set(
			'@vue/compiler-sfc',
			'const unavailable = () => { throw new Error("Vue source compiler is unavailable in compiled production runtime. Use built manifest page paths."); }; export const compileScript = unavailable; export const compileStyle = unavailable; export const compileTemplate = unavailable; export const parse = unavailable;'
		);
		runtimeStubs.set(
			'typescript',
			'const unavailable = () => { throw new Error("TypeScript compiler APIs are unavailable in compiled production runtime. Use built manifest page paths."); }; export const transpileModule = unavailable; export const createProgram = unavailable; export default {};'
		);

		const runtimeStubFilter = new RegExp(
			`^(${Array.from(runtimeStubs.keys()).map(escapeRegex).join('|')})$`
		);
		bld.onResolve({ filter: runtimeStubFilter }, (args) => ({
			namespace: 'absolute-compile-stub',
			path: args.path
		}));
		bld.onLoad(
			{ filter: runtimeStubFilter, namespace: 'absolute-compile-stub' },
			(args) => ({
				contents: runtimeStubs.get(args.path) ?? 'export {};',
				loader: 'js'
			})
		);
		bld.onLoad({ filter: /\.(svelte|vue)$/ }, () => ({
			contents: 'export default {}',
			loader: 'js'
		}));
		bld.onLoad({ filter: /devBuild\.(ts|js)$/ }, () => ({
			contents: 'export const devBuild = () => {}',
			loader: 'js'
		}));
		bld.onLoad({ filter: /core\/build\.(ts|js)$/ }, () => ({
			contents: 'export const build = () => ({})',
			loader: 'js'
		}));
		bld.onLoad({ filter: /src\/build\.(ts|js)$/ }, () => ({
			contents:
				'export const build = () => ({}); export const devBuild = () => {};',
			loader: 'js'
		}));
		bld.onLoad({ filter: /plugins\/hmr\.(ts|js)$/ }, () => ({
			contents: 'export const hmr = () => (app) => app;',
			loader: 'js'
		}));
		bld.onLoad(
			{
				filter: /dev\/(assetStore|clientManager|webSocket|moduleVersionTracker|buildHMRClient|serverEntryWatcher)\.ts$/
			},
			() => ({
				contents:
					'export const startServerEntryWatcher = () => {}; export const isAtomicWriteTemp = () => false;',
				loader: 'js'
			})
		);
		bld.onLoad({ filter: /dev\/moduleServer\.(ts|js)$/ }, () => ({
			contents: 'export {};',
			loader: 'js'
		}));
		bld.onLoad(
			{ filter: /build\/compile(Svelte|Vue|Angular)\.(ts|js)$/ },
			() => ({
				contents:
					'const unavailable = async () => { throw new Error("Framework source compiler fallback is unavailable in compiled production runtime. Use built manifest page paths."); }; export const compileSvelte = unavailable; export const compileVue = unavailable; export const compileAngularFileJIT = unavailable; export const compileAngularFile = unavailable; export const compileAngularFiles = unavailable; export const compileAngular = unavailable;',
				loader: 'js'
			})
		);
		bld.onLoad(
			{ filter: /cli\/(telemetryEvent|scripts\/telemetry)\.ts$/ },
			() => ({
				contents:
					'export const sendTelemetryEvent = () => {}; export const getTelemetryConfig = () => null; export const telemetry = () => {};',
				loader: 'js'
			})
		);
		bld.onLoad(
			{
				filter: /react-dom-server-legacy\.browser\.(production|development)\.js$/
			},
			() => ({
				contents:
					'exports.renderToString = undefined; exports.renderToStaticMarkup = undefined;',
				loader: 'js'
			})
		);
		bld.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
			path: jsxDevRuntimeCompatPath
		}));
		bld.onLoad({ filter: /node_modules\/debug/ }, () => ({
			contents:
				'module.exports = () => { const noop = () => {}; noop.enabled = false; return noop; }; module.exports.enable = () => {}; module.exports.disable = () => {}; module.exports.enabled = () => false;',
			loader: 'js'
		}));
		bld.onLoad({ filter: /\.ts$/ }, async (args) => {
			if (args.path.includes('node_modules')) return undefined;
			const normalizedPath = args.path.replace(/\\/g, '/');
			if (normalizedPath.includes('/src/angular/')) return undefined;
			const text = await Bun.file(args.path).text();
			const stripped = text
				.replace(/`(?:[^`\\]|\\.)*`/gs, '')
				.replace(/'(?:[^'\\]|\\.)*'/g, '')
				.replace(/"(?:[^"\\]|\\.)*"/g, '');
			if (stripped.includes('@Component')) {
				return { contents: 'export default {}', loader: 'js' };
			}

			return undefined;
		});
	}
});

const FRAMEWORK_EXTERNALS = [
	'react',
	'react/jsx-runtime',
	'react-dom',
	'react-dom/*',
	'vue',
	'vue/*',
	'@vue/compiler-sfc',
	'@vue/server-renderer',
	'svelte',
	'svelte/*',
	'@angular/compiler',
	'@angular/compiler-cli',
	'@angular/core',
	'@angular/common',
	'@angular/platform-browser',
	'@angular/platform-server',
	'typescript'
];

const resolveServerBundleExternals = (buildConfig: BuildConfig) =>
	FRAMEWORK_EXTERNALS.filter((specifier) => {
		if (
			buildConfig.reactDirectory &&
			(specifier === 'react' ||
				specifier.startsWith('react/') ||
				specifier.startsWith('react-dom'))
		)
			return false;
		if (
			buildConfig.vueDirectory &&
			(specifier === 'vue' ||
				specifier.startsWith('vue/') ||
				specifier === '@vue/server-renderer')
		)
			return false;
		if (
			buildConfig.svelteDirectory &&
			(specifier === 'svelte' || specifier.startsWith('svelte/'))
		)
			return false;

		return true;
	});

// ── Main compile command ────────────────────────────────────────
export const compile = async (
	serverEntry: string,
	outdir?: string,
	outfile?: string,
	configPath?: string
) => {
	const resolvedOutdir = resolve(outdir ?? 'dist');

	await withBuildDirectoryLock(resolvedOutdir, () =>
		compileUnlocked(serverEntry, resolvedOutdir, outfile, configPath)
	);
};

const compileUnlocked = async (
	serverEntry: string,
	resolvedOutdir: string,
	outfile?: string,
	configPath?: string
) => {
	const prerenderPort =
		Number(env.COMPILE_PORT) || Number(env.PORT) || DEFAULT_PORT + 1;
	killStaleProcesses(prerenderPort);

	const entryName = basename(serverEntry).replace(/\.[^.]+$/, '');
	const resolvedOutfile = resolve(outfile ?? 'compiled-server');

	const absoluteVersion = resolvePackageVersion([
		resolve(import.meta.dir, '..', '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', '..', 'package.json')
	]);

	compileBanner(absoluteVersion);

	const totalStart = performance.now();

	// ── Step 1: Build assets ────────────────────────────────────
	const buildStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Building assets'));

	const buildConfig = await loadConfig(configPath);
	buildConfig.buildDirectory = resolvedOutdir;
	buildConfig.mode = 'production';

	try {
		const build = await resolveBuildModule([
			resolve(import.meta.dir, '..', '..', 'core', 'build'),
			resolve(import.meta.dir, '..', 'build')
		]);
		if (!build) throw new Error('Could not locate build module');
		await build(buildConfig);
	} catch (err) {
		console.error(cliTag('\x1b[31m', 'Build step failed.'));
		console.error(err);
		process.exit(1);
	}

	console.log(
		` \x1b[2m(${getDurationString(performance.now() - buildStart)})\x1b[0m`
	);

	// ── Step 2: Bundle production server ────────────────────────
	const bundleStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Bundling production server'));

	const userSourceRoots = [
		buildConfig.reactDirectory,
		buildConfig.svelteDirectory,
		buildConfig.vueDirectory,
		buildConfig.angularDirectory,
		buildConfig.htmlDirectory,
		buildConfig.htmxDirectory
	].filter((dir): dir is string => Boolean(dir));

	// Rewrite the island registry's eager cross-framework component imports to
	// lazy `{ source, export }` definitions (see start.ts / islandRegistryTransform.ts).
	const islandRegistrySpec = buildConfig.islands?.registry;
	const islandRegistryPlugin = islandRegistrySpec
		? createIslandRegistryDefinitionPlugin(
				await loadIslandRegistryBuildInfo(resolve(islandRegistrySpec))
			)
		: undefined;

	const serverBundle = await Bun.build({
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: [resolve(serverEntry)],
		external: resolveServerBundleExternals(buildConfig),
		outdir: resolvedOutdir,
		plugins: [
			...(islandRegistryPlugin ? [islandRegistryPlugin] : []),
			createStubPlugin({
				stubAngular: !buildConfig.angularDirectory,
				stubReact: !buildConfig.reactDirectory,
				stubSvelte: !buildConfig.svelteDirectory,
				stubVue: !buildConfig.vueDirectory
			}),
			createExternalAssetPlugin(resolvedOutdir, userSourceRoots)
		],
		target: 'bun',
		// Mirror start.ts: surface bundle errors as data so the
		// `if (!serverBundle.success)` branch below can print them.
		// Default `throw: true` on newer Bun yields a useless
		// `AggregateError: Bundle failed`.
		throw: false
	});

	if (!serverBundle.success) {
		serverBundle.logs.forEach((log) => console.error(log));
		console.error(cliTag('\x1b[31m', 'Server bundle failed.'));
		process.exit(1);
	}

	const outputPath = resolve(resolvedOutdir, `${entryName}.js`);
	if (!existsSync(outputPath)) {
		console.error(
			cliTag('\x1b[31m', `Expected output not found: ${outputPath}`)
		);
		process.exit(1);
	}

	// Rewrite the user server bundle's bare `@angular/*` imports to vendor
	// file paths — same fix as in `start.ts`. Without this, the standalone
	// executable's server bundle resolves `@angular/core` from node_modules
	// at startup while SSR page bundles import from vendor, producing the
	// dual-package NG0201 hazard. Use paths relative to the bundle so the
	// rewrite survives the executable extracting itself into a temp dir.
	if (existsSync(resolve(resolvedOutdir, 'angular', 'vendor', 'server'))) {
		const vendorDir = resolve(
			resolvedOutdir,
			'angular',
			'vendor',
			'server'
		);
		const vendorEntries = readdirSync(vendorDir).filter((f) =>
			f.endsWith('.js')
		);
		const angularServerVendorPaths: Record<string, string> = {};
		for (const file of vendorEntries) {
			const stem = file.replace(/\.js$/, '');
			const [scope, ...rest] = stem.split('_');
			if (scope !== 'angular' || rest.length === 0) continue;
			const specifier = `@angular/${rest.join('/')}`;
			const relPath = relative(
				dirname(outputPath),
				resolve(vendorDir, file)
			);
			angularServerVendorPaths[specifier] = relPath.startsWith('.')
				? relPath
				: `./${relPath}`;
		}
		if (Object.keys(angularServerVendorPaths).length > 0) {
			const { rewriteImports } = await import(
				'../../build/rewriteImports'
			);
			await rewriteImports([outputPath], angularServerVendorPaths);
		}
	}

	console.log(
		` \x1b[2m(${getDurationString(performance.now() - bundleStart)})\x1b[0m`
	);

	copyServerRuntimeAssetReferences(resolvedOutdir);

	// ── Step 3: Pre-render all pages ────────────────────────────
	const prerenderStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Pre-rendering pages'));
	rmSync(join(resolvedOutdir, '_prerendered'), {
		force: true,
		recursive: true
	});

	// Compile always pre-renders all routes
	const staticConfig = buildConfig.static ?? { routes: 'all' as const };

	const prerenderResult = await prerenderWithServer(
		outputPath,
		prerenderPort,
		resolvedOutdir,
		staticConfig,
		{
			ABSOLUTE_BUILD_DIR: resolvedOutdir,
			ABSOLUTE_VERSION: absoluteVersion,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			...(configPath ? { ABSOLUTE_CONFIG: configPath } : {})
		}
	);

	const prerenderMap = prerenderResult.routes;

	console.log(
		` \x1b[2m(${prerenderMap.size} pages, ${getDurationString(performance.now() - prerenderStart)})\x1b[0m`
	);

	copyFrameworkRuntimePackages(buildConfig, resolvedOutdir);
	rewriteRuntimeModuleSpecifiers(resolvedOutdir);

	// ── Step 4: Generate compile entrypoint ─────────────────────
	const compileStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Compiling standalone executable'));

	const entrypointCode = generateEntrypoint(
		resolvedOutdir,
		serverEntry,
		prerenderMap,
		absoluteVersion,
		buildConfig
	);

	const entrypointPath = join(resolvedOutdir, '_compile_entrypoint.ts');
	await Bun.write(entrypointPath, entrypointCode);
	mkdirSync(dirname(resolvedOutfile), { recursive: true });

	// ── Step 5: Compile binary ──────────────────────────────────
	const result = await Bun.build({
		compile: { outfile: resolvedOutfile },
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: [entrypointPath],
		plugins: [
			createStubPlugin({
				stubAngular: !buildConfig.angularDirectory,
				stubReact: !buildConfig.reactDirectory,
				stubSvelte: !buildConfig.svelteDirectory,
				stubVue: !buildConfig.vueDirectory
			})
		],
		target: 'bun'
	});

	if (!result.success) {
		result.logs.forEach((log) => console.error(log));
		console.error(cliTag('\x1b[31m', 'Compilation failed.'));
		process.exit(1);
	}

	console.log(
		` \x1b[2m(${getDurationString(performance.now() - compileStart)})\x1b[0m`
	);

	// Clean up generated files
	try {
		unlinkSync(entrypointPath);
	} catch {
		/* best-effort */
	}

	// ── Done ────────────────────────────────────────────────────
	const BYTES_PER_MB = 1_048_576;
	const size = (Bun.file(resolvedOutfile).size / BYTES_PER_MB).toFixed(0);
	const totalDuration = getDurationString(performance.now() - totalStart);

	console.log(
		cliTag(
			'\x1b[32m',
			`Compiled to ${resolvedOutfile} (${size}MB) in ${totalDuration}`
		)
	);
	console.log(cliTag('\x1b[2m', `Run with: ./${basename(resolvedOutfile)}`));

	sendTelemetryEvent('compile:complete', {
		durationMs: Math.round(performance.now() - totalStart),
		entry: serverEntry,
		pages: prerenderMap.size
	});
};
