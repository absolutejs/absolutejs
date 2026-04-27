import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { SitemapConfig } from '../../types/sitemap';
import type { ConventionsMap } from '../../types/conventions';
import { loadConfig } from '../utils/loadConfig';
import { setCurrentIslandManifest } from './islandPageContext';
import { loadIslandRegistry } from './loadIslandRegistry';
import { setCurrentIslandRegistry } from './currentIslandRegistry';
import {
	loadPageIslandMetadata,
	setCurrentPageIslandMetadata
} from '../islands/pageMetadata';
import {
	setConventions,
	renderFirstNotFound
} from '../utils/resolveConvention';
import { logStartupTimingBlock } from '../utils/startupTimings';

const MS_PER_SECOND = 1000;
const DEFAULT_PORT = 3000;
const MAX_STATIC_ROUTE_COUNT = Number.MAX_SAFE_INTEGER;

type PrewarmEntry = { dir: string; pattern: string };

const buildPrewarmDirs = (config: Awaited<ReturnType<typeof loadConfig>>) => {
	const dirs: PrewarmEntry[] = [];
	if (config.svelteDirectory) {
		dirs.push({
			dir: config.svelteDirectory,
			pattern: '**/*.{svelte,svelte.ts,svelte.js}'
		});
	}
	if (config.vueDirectory) {
		dirs.push({ dir: config.vueDirectory, pattern: '**/*.{vue}' });
	}
	if (config.reactDirectory) {
		dirs.push({
			dir: config.reactDirectory,
			pattern: '**/*.{ts,tsx,js,jsx}'
		});
	}

	return dirs;
};

const collectPrewarmFiles = async (prewarmDirs: PrewarmEntry[]) => {
	const { Glob } = await import('bun');
	const files: string[] = [];
	for (const { dir, pattern } of prewarmDirs) {
		const glob = new Glob(pattern);
		const matches = [
			...glob.scanSync({ absolute: true, cwd: resolve(dir) })
		];
		files.push(...matches);
	}

	return files;
};

const warmPrewarmDirs = async (
	prewarmDirs: PrewarmEntry[],
	warmCache: (url: string) => void,
	SRC_URL_PREFIX: string
) => {
	const files = await collectPrewarmFiles(prewarmDirs);
	for (const file of files) {
		if (file.includes('/node_modules/')) continue;
		const rel = relative(process.cwd(), file).replace(/\\/g, '/');
		warmCache(`${SRC_URL_PREFIX}${rel}`);
	}
};

const resolveDevIndexFileName = (manifestValue: string, baseName: string) => {
	if (manifestValue.includes('/react/')) return `${baseName}.tsx`;
	if (manifestValue.includes('/svelte/')) return `${baseName}.svelte.js`;
	if (manifestValue.includes('/vue/')) return `${baseName}.vue.js`;

	return null;
};

const patchManifestIndexes = (
	manifest: Record<string, string>,
	devIndexDir: string,
	SRC_URL_PREFIX: string
) => {
	for (const key of Object.keys(manifest)) {
		if (!key.endsWith('Index')) continue;
		if (typeof manifest[key] !== 'string') continue;
		if (!manifest[key].includes('/indexes/')) continue;

		const baseName = key.replace(/Index$/, '');
		const fileName = resolveDevIndexFileName(manifest[key], baseName);
		if (!fileName) continue;

		const srcPath = resolve(devIndexDir, fileName);
		if (!existsSync(srcPath)) continue;

		const rel = relative(process.cwd(), srcPath).replace(/\\/g, '/');
		manifest[key] = `${SRC_URL_PREFIX}${rel}`;
	}
};

const prepareDev = async (
	config: Awaited<ReturnType<typeof loadConfig>>,
	buildDir: string
) => {
	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	let stepStartedAt = performance.now();
	const { patchElysiaRouteRegistrationCallsites } = await import(
		'./devRouteRegistrationCallsite'
	);
	patchElysiaRouteRegistrationCallsites();
	recordStep('patch route registration', stepStartedAt);

	stepStartedAt = performance.now();
	const { devBuild } = await import('./devBuild');
	const result = await devBuild(config);
	recordStep('devBuild', stepStartedAt);

	stepStartedAt = performance.now();
	const { hmr } = await import('../plugins/hmr');
	const { staticPlugin } = await import('@elysiajs/static');
	const { createModuleServer } = await import('../dev/moduleServer');
	const {
		getDevVendorPaths,
		getAngularVendorPaths,
		getSvelteVendorPaths,
		getVueVendorPaths
	} = await import('./devVendorPaths');
	recordStep('load dev runtime modules', stepStartedAt);

	// Combine all vendor paths: React + Angular + Svelte + Vue + npm deps
	stepStartedAt = performance.now();
	const depVendorPaths = globalThis.__depVendorPaths ?? {};
	const allVendorPaths: Record<string, string> = {
		...(getDevVendorPaths() ?? {}),
		...(getAngularVendorPaths() ?? {}),
		...(getSvelteVendorPaths() ?? {}),
		...(getVueVendorPaths() ?? {}),
		...depVendorPaths
	};

	const { setGlobalModuleServer } = await import('../dev/moduleServer');
	const { createStyleTransformConfig } = await import(
		'../build/stylePreprocessor'
	);
	const moduleHandler = createModuleServer({
		frameworkDirs: {
			angular: config.angularDirectory,
			react: config.reactDirectory,
			svelte: config.svelteDirectory,
			vue: config.vueDirectory
		},
		projectRoot: process.cwd(),
		stylePreprocessors: createStyleTransformConfig(
			config.stylePreprocessors,
			config.postcss
		),
		vendorPaths: allVendorPaths
	});
	setGlobalModuleServer(moduleHandler);
	recordStep('create module server', stepStartedAt);

	// Pre-compile all framework source files into the transform cache
	// so the first HMR edit hits a warm cache and the runtime import
	// graph is populated (needed for findNearestComponent).
	const { warmCache, SRC_URL_PREFIX } = await import('../dev/moduleServer');
	const prewarmDirs = buildPrewarmDirs(config);
	stepStartedAt = performance.now();
	await warmPrewarmDirs(prewarmDirs, warmCache, SRC_URL_PREFIX);
	recordStep('prewarm source modules', stepStartedAt);

	// Expose HMR state for the HTTP/2 bridge (networking.ts reads this
	// to attach WebSocket handling on the HTTP/2 server).
	// Only set when HTTPS is enabled — otherwise Elysia's native .ws() is used.
	if (config.dev?.https) {
		globalThis.__http2Config = {
			hmrState: result.hmrState,
			manifest: result.manifest
		};
	}

	stepStartedAt = performance.now();
	const hmrPlugin = hmr(result.hmrState, result.manifest, moduleHandler);
	const { devtoolsJson } = await import('../plugins/devtoolsJson');

	// Override index manifest entries to /@src/ URLs so the initial
	// page load uses the module server (same module system as HMR).
	// This ensures page refreshes after HMR load fresh code.
	const devIndexDir = resolve(buildDir, '_src_indexes');
	patchManifestIndexes(result.manifest, devIndexDir, SRC_URL_PREFIX);
	recordStep('configure dev plugins', stepStartedAt);

	// Load convention files (error/loading/not-found) into the runtime registry
	stepStartedAt = performance.now();
	if (result.conventions) setConventions(result.conventions);
	setCurrentIslandManifest(result.manifest);
	if (config.islands?.registry) {
		setCurrentIslandRegistry(
			await loadIslandRegistry(config.islands.registry)
		);
	}
	setCurrentPageIslandMetadata(await loadPageIslandMetadata(config));
	recordStep('load runtime metadata', stepStartedAt);

	stepStartedAt = performance.now();
	const { imageOptimizer } = await import('../plugins/imageOptimizer');
	const absolutejs = new Elysia({ name: 'absolutejs-runtime' })
		.use(
			devtoolsJson(buildDir, {
				normalizeForWindowsContainer:
					config.dev?.devtools?.normalizeForWindowsContainer,
				projectRoot: config.dev?.devtools?.projectRoot,
				uuid: config.dev?.devtools?.uuid,
				uuidCachePath: config.dev?.devtools?.uuidCachePath
			})
		)
		.use(imageOptimizer(config.images, buildDir))
		.use(
			staticPlugin({
				alwaysStatic: true,
				assets: buildDir,
				directive: 'no-cache',
				maxAge: null,
				prefix: '',
				staticLimit: MAX_STATIC_ROUTE_COUNT
			})
		)
		.use(hmrPlugin)
		.use(createSitemapPlugin(buildDir, config.sitemap))
		.use(createNotFoundPlugin());
	recordStep('assemble dev runtime', stepStartedAt);
	logStartupTimingBlock('AbsoluteJS prepareDev timing', startupSteps);

	return {
		absolutejs,
		manifest: result.manifest
	};
};

/** Load pre-rendered HTML files from disk into a route → filepath map */
const loadPrerenderMap = (prerenderDir: string) => {
	const map = new Map<string, string>();
	if (!existsSync(prerenderDir)) return map;

	let entries: string[];
	try {
		entries = readdirSync(prerenderDir);
	} catch {
		/* directory doesn't exist or can't be read */
		return map;
	}

	for (const entry of entries) {
		if (!entry.endsWith('.html')) continue;
		const name = basename(entry, '.html');
		const route = name === 'index' ? '/' : `/${name}`;
		map.set(route, join(prerenderDir, entry));
	}

	return map;
};

const createSitemapPlugin = (buildDir: string, sitemapConfig?: SitemapConfig) =>
	new Elysia({ name: 'absolutejs-sitemap' }).onStart((started) => {
		const { server } = started;
		if (!server) return;

		import('../utils/generateSitemap')
			.then(({ generateSitemap }) =>
				generateSitemap(
					started.routes,
					server.url.origin,
					buildDir,
					sitemapConfig
				)
			)
			.catch((err) => console.error('[sitemap] Generation failed:', err));
	});

const createNotFoundPlugin = () =>
	new Elysia({ name: 'absolutejs-not-found' }).onError(
		{ as: 'global' },
		async ({ code }) => {
			if (code !== 'NOT_FOUND') return undefined;
			const response = await renderFirstNotFound();
			if (response) return response;

			return undefined;
		}
	);

export const prepare = async (configOrPath?: string) => {
	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	let stepStartedAt = performance.now();
	const config = await loadConfig(configOrPath);
	recordStep('load config', stepStartedAt);

	const nodeEnv = process.env['NODE_ENV'];
	const isDev = nodeEnv === 'development';
	const buildDir = resolve(
		process.env.ABSOLUTE_BUILD_DIR ?? config.buildDirectory ?? 'build'
	);

	if (isDev) {
		stepStartedAt = performance.now();
		const result = await prepareDev(config, buildDir);
		recordStep('prepare dev runtime', stepStartedAt);
		logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

		return result;
	}

	stepStartedAt = performance.now();
	const manifest: Record<string, string> = JSON.parse(
		readFileSync(`${buildDir}/manifest.json`, 'utf-8')
	);
	setCurrentIslandManifest(manifest);
	if (config.islands?.registry) {
		setCurrentIslandRegistry(
			await loadIslandRegistry(config.islands.registry)
		);
	}
	setCurrentPageIslandMetadata(await loadPageIslandMetadata(config));
	recordStep('load production manifest and island metadata', stepStartedAt);

	// Load convention files (error/loading/not-found) for production
	stepStartedAt = performance.now();
	const conventionsPath = join(buildDir, 'conventions.json');
	if (existsSync(conventionsPath)) {
		const conventions: ConventionsMap = JSON.parse(
			readFileSync(conventionsPath, 'utf-8')
		);
		setConventions(conventions);
	}
	recordStep('load production conventions', stepStartedAt);

	stepStartedAt = performance.now();
	const { staticPlugin } = await import('@elysiajs/static');
	const staticFiles = staticPlugin({
		alwaysStatic: true,
		assets: buildDir,
		prefix: '',
		staticLimit: MAX_STATIC_ROUTE_COUNT
	});
	recordStep('create static plugin', stepStartedAt);

	// Check for pre-rendered pages (from SSG or compile)
	stepStartedAt = performance.now();
	const prerenderDir = join(buildDir, '_prerendered');
	const prerenderMap = loadPrerenderMap(prerenderDir);
	recordStep('load prerender map', stepStartedAt);

	if (prerenderMap.size > 0) {
		const { PRERENDER_BYPASS_HEADER, readTimestamp, rerenderRoute } =
			await import('./prerender');

		const revalidateMs = config.static?.revalidate
			? config.static.revalidate * MS_PER_SECOND
			: 0;
		const port = Number(process.env.PORT) || DEFAULT_PORT;

		// Track routes currently being re-rendered to avoid duplicate work
		const rerendering = new Set<string>();

		const prerenderPlugin = new Elysia({
			name: 'prerendered-pages'
		}).onRequest(({ request }) => {
			const url = new URL(request.url);

			// Allow bypass for ISR re-render requests
			if (request.headers.get(PRERENDER_BYPASS_HEADER)) return undefined;

			const filePath = prerenderMap.get(url.pathname);
			if (!filePath) return undefined;

			// ISR: check if page is stale and trigger background re-render
			const renderedAt =
				revalidateMs > 0 && !rerendering.has(url.pathname)
					? readTimestamp(filePath)
					: 0;
			const age = Date.now() - renderedAt;
			if (revalidateMs > 0 && renderedAt > 0 && age > revalidateMs) {
				rerendering.add(url.pathname);
				void rerenderRoute(url.pathname, port, prerenderDir)
					.catch(
						() =>
							/* background re-render failed, stale page still served */

							undefined
					)
					.finally(() => rerendering.delete(url.pathname));
			}

			// Serve the cached page immediately (even if stale)
			return new Response(Bun.file(filePath), {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			});
		});

		stepStartedAt = performance.now();
		const { imageOptimizer } = await import('../plugins/imageOptimizer');
		const absolutejs = new Elysia({ name: 'absolutejs-runtime' })
			.use(imageOptimizer(config.images, buildDir))
			.use(prerenderPlugin)
			.use(staticFiles)
			.use(createSitemapPlugin(buildDir, config.sitemap))
			.use(createNotFoundPlugin());
		recordStep('assemble production runtime', stepStartedAt);
		logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

		return { absolutejs, manifest };
	}

	stepStartedAt = performance.now();
	const { imageOptimizer } = await import('../plugins/imageOptimizer');
	const absolutejs = new Elysia({ name: 'absolutejs-runtime' })
		.use(imageOptimizer(config.images, buildDir))
		.use(staticFiles)
		.use(createSitemapPlugin(buildDir, config.sitemap))
		.use(createNotFoundPlugin());
	recordStep('assemble production runtime', stepStartedAt);
	logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

	return { absolutejs, manifest };
};
