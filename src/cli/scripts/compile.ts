import { env } from 'bun';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { DEFAULT_PORT } from '../../constants';
import { prerenderWithServer } from '../../core/prerender';
import { getDurationString } from '../../utils/getDurationString';
import { loadConfig } from '../../utils/loadConfig';
import { formatTimestamp } from '../../utils/startupBanner';
import { sendTelemetryEvent } from '../telemetryEvent';
import { killStaleProcesses } from '../utils';

// ── Logging ─────────────────────────────────────────────────────
const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

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
	for (const candidate of candidates) {
		// eslint-disable-next-line no-await-in-loop -- each import depends on the previous failing
		const mod = await tryImportBuild(candidate);
		if (mod) return mod;
	}

	return undefined;
};

// ── Generate the compile entrypoint ─────────────────────────────
const generateEntrypoint = (
	distDir: string,
	serverEntry: string,
	prerenderMap: Map<string, string>, // route -> prerendered file path
	version: string
) => {
	const allFiles = collectFiles(distDir);
	const serverBundleName = `${basename(serverEntry).replace(/\.[^.]+$/, '')}.js`;
	const skip = new Set([
		serverBundleName,
		'manifest.json',
		'_compile_entrypoint.ts'
	]);

	const clientFiles = allFiles.filter((file) => {
		const rel = relative(distDir, file);
		if (skip.has(rel)) return false;
		if (rel.includes('.generated')) return false;
		if (rel.includes('/server/')) return false;

		return true;
	});

	const imports: string[] = [];
	const mappings: string[] = [];

	clientFiles.forEach((filePath, idx) => {
		const rel = relative(distDir, filePath).replace(/\\/g, '/');
		const varName = `__a${idx}`;
		const urlPath = `/${rel}`;

		imports.push(
			`import ${varName} from "./${rel}" with { type: "file" };`
		);
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
		const idx = clientFiles.findIndex(
			(file) => relative(distDir, file).replace(/\\/g, '/') === rel
		);
		if (idx >= 0) pageVarMap.set(route, `__a${idx}`);
	});

	const routeEntries = Array.from(pageVarMap.entries())
		.map(([route, varName]) => `\t"${route}": ${varName},`)
		.join('\n');

	return `// Auto-generated compile entrypoint
import { Elysia } from "elysia";

// ── Embedded asset imports ──────────────────────────────────────
${imports.join('\n')}

// ── Asset URL → embedded path map ───────────────────────────────
const ASSETS: Record<string, string> = {
${mappings.join('\n')}
};

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

const servePage = (path: string) =>
	new Response(Bun.file(path), {
		headers: { "content-type": "text/html; charset=utf-8" },
	});

const app = new Elysia()
	// Static assets from embedded filesystem
	.onRequest(({ request, set }) => {
		const url = new URL(request.url);

		// Check for pre-rendered page
		const page = PAGES[url.pathname];
		if (page) return servePage(page);

		// Check for embedded asset
		const embedded = ASSETS[url.pathname];
		if (!embedded) return;
		set.headers["content-type"] = getMime(url.pathname);
		set.headers["cache-control"] = "public, max-age=31536000, immutable";
		return new Response(Bun.file(embedded));
	})
	.listen(port);

const assetCount = Object.keys(ASSETS).length;
const pageCount = Object.keys(PAGES).length;
console.log(\`
  \\x1b[36m\\x1b[1mABSOLUTEJS\\x1b[0m \\x1b[2mv${version}\\x1b[0m  \\x1b[2mcompiled executable\\x1b[0m

  \\x1b[32m➜\\x1b[0m  \\x1b[1mLocal:\\x1b[0m   http://localhost:\${port}/

  \\x1b[2m\${pageCount} pre-rendered pages, \${assetCount} embedded assets\\x1b[0m
\`);
`;
};

// ── Stub plugin (shared with start.ts) ──────────────────────────
const stubPlugin: import('bun').BunPlugin = {
	name: 'stub-framework-sources',
	setup(bld) {
		bld.onLoad({ filter: /\.(svelte|vue)$/ }, () => ({
			contents: 'export default {}',
			loader: 'js'
		}));
		bld.onLoad({ filter: /devBuild\.ts$/ }, () => ({
			contents: 'export const devBuild = () => {}',
			loader: 'js'
		}));
		bld.onLoad({ filter: /core\/build\.ts$/ }, () => ({
			contents: 'export const build = () => ({})',
			loader: 'js'
		}));
		bld.onLoad({ filter: /src\/build\.ts$/ }, () => ({
			contents:
				'export const build = () => ({}); export const devBuild = () => {};',
			loader: 'js'
		}));
		bld.onLoad({ filter: /plugins\/hmr\.ts$/ }, () => ({
			contents: 'export const hmr = () => (app) => app;',
			loader: 'js'
		}));
		bld.onLoad(
			{
				filter: /dev\/(assetStore|clientManager|webSocket|moduleVersionTracker|buildHMRClient)\.ts$/
			},
			() => ({ contents: 'export {};', loader: 'js' })
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
		bld.onLoad({ filter: /node_modules\/debug/ }, () => ({
			contents:
				'module.exports = () => { const noop = () => {}; noop.enabled = false; return noop; }; module.exports.enable = () => {}; module.exports.disable = () => {}; module.exports.enabled = () => false;',
			loader: 'js'
		}));
		bld.onLoad({ filter: /\.ts$/ }, async (args) => {
			if (args.path.includes('node_modules')) return undefined;
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
};

const FRAMEWORK_EXTERNALS = [
	'react',
	'react/*',
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
	'@angular/platform-server'
];

// ── Main compile command ────────────────────────────────────────
export const compile = async (
	serverEntry: string,
	outdir?: string,
	outfile?: string,
	configPath?: string
) => {
	const prerenderPort =
		Number(env.COMPILE_PORT) || Number(env.PORT) || DEFAULT_PORT + 1;
	killStaleProcesses(prerenderPort);

	const entryName = basename(serverEntry).replace(/\.[^.]+$/, '');
	const resolvedOutdir = resolve(outdir ?? 'dist');
	const resolvedOutfile = resolve(outfile ?? 'compiled-server');

	const absoluteVersion = resolvePackageVersion([
		resolve(import.meta.dir, '..', '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', '..', 'package.json')
	]);

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

	const serverBundle = await Bun.build({
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: [resolve(serverEntry)],
		external: FRAMEWORK_EXTERNALS,
		outdir: resolvedOutdir,
		plugins: [stubPlugin],
		target: 'bun'
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

	console.log(
		` \x1b[2m(${getDurationString(performance.now() - bundleStart)})\x1b[0m`
	);

	// ── Step 3: Pre-render all pages ────────────────────────────
	const prerenderStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Pre-rendering pages'));

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

	// ── Step 4: Generate compile entrypoint ─────────────────────
	const compileStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Compiling standalone executable'));

	const entrypointCode = generateEntrypoint(
		resolvedOutdir,
		serverEntry,
		prerenderMap,
		absoluteVersion
	);

	const entrypointPath = join(resolvedOutdir, '_compile_entrypoint.ts');
	await Bun.write(entrypointPath, entrypointCode);

	// ── Step 5: Compile binary ──────────────────────────────────
	const result = await Bun.build({
		compile: { outfile: resolvedOutfile },
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: [entrypointPath],
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
