import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { staticPlugin } from '@elysia/static';
import type { ConventionsMap } from '../../types/conventions';
import { withOpenApi } from '../plugins/openApiPlugin';
import { withTelemetry } from '../plugins/telemetryPlugin';
import { loadConfig } from '../utils/loadConfig';
import { setIconVersionResolver } from '../utils/iconVersion';
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
import { logWarn } from '../utils/logger';

const MS_PER_SECOND = 1000;
const DEFAULT_PORT = 3000;
const MAX_STATIC_ROUTE_COUNT = Number.MAX_SAFE_INTEGER;
const STATIC_PLUGIN_RETRY_DELAY_MS = 50;

// `@elysia/static` builds its routes by walking `assets` and reading each file
// up front (we pass `alwaysStatic: true`). In dev the build dir is live, so a
// content-hashed bundle can be mid-write — or just pruned — when the walk
// reaches it, and the read can throw. Retry once after a short delay (the
// rebuild settles within a tick), then degrade to an empty plugin so a
// transient miss never takes down the server with an unhandled rejection.
const mountStaticPlugin = async (
	createStaticPlugin: typeof staticPlugin,
	options: Parameters<typeof staticPlugin>[0]
) => {
	try {
		return await createStaticPlugin(options);
	} catch {
		await new Promise((resolveDelay) => {
			setTimeout(resolveDelay, STATIC_PLUGIN_RETRY_DELAY_MS);
		});
		try {
			return await createStaticPlugin(options);
		} catch (error) {
			logWarn(
				`Static asset routes were skipped this cycle — a build file was unavailable mid-rebuild: ${
					error instanceof Error ? error.message : String(error)
				}`
			);

			return new Elysia({ name: 'absolutejs-static-fallback' });
		}
	}
};

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

// Register the favicon cache-buster: map a local `/assets/...` icon href to
// `<href>?v=<content-hash>` so the URL changes when the icon bytes change and
// browsers' sticky favicon caches re-fetch — no manual file renames. Hashes
// are memoized per href (icon files don't change during a process lifetime),
// and external/off-disk hrefs pass through unchanged.
const ICON_HASH_LENGTH = 8;
const registerIconVersioning = (buildDir: string) => {
	const cache = new Map<string, string>();
	setIconVersionResolver((href) => {
		if (!href.startsWith('/') || href.startsWith('//')) return href;
		const cached = cache.get(href);
		if (cached !== undefined) return cached;

		const path = href.split('?')[0] ?? href;
		const filePath = join(buildDir, path);
		let versioned = href;
		if (existsSync(filePath)) {
			const hash = createHash('sha256')
				.update(readFileSync(filePath))
				.digest('hex')
				.slice(0, ICON_HASH_LENGTH);
			versioned = href.includes('?')
				? `${href}&v=${hash}`
				: `${href}?v=${hash}`;
		}
		cache.set(href, versioned);

		return versioned;
	});
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
	const { staticPlugin } = await import('@elysia/static');
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
	const { requestInspector } = await import('../dev/requestInspector');
	const { serverTiming } = await import('@elysiajs/server-timing');
	const absolutejs = new Elysia({ name: 'absolutejs-runtime' })
		// Must be first: the inspector's global onRequest/onAfterResponse hooks
		// only reach routes compiled after them, so it has to precede the
		// page/static/user routes (which mount after `.use(absolutejs)`).
		.use(requestInspector)
		// Server-Timing per lifecycle phase (dev only) — powers the per-phase
		// timing breakdown in `absolute inspect`.
		.use(serverTiming())
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
			await mountStaticPlugin(staticPlugin, {
				alwaysStatic: true,
				assets: buildDir,
				directive: 'no-cache',
				maxAge: null,
				prefix: '',
				staticLimit: MAX_STATIC_ROUTE_COUNT
			})
		)
		.use(hmrPlugin)
		.use(createBuildErrorRecoveryPlugin())
		.use(createNotFoundPlugin());
	await withOpenApi(absolutejs, config, process.cwd(), true);
	await withTelemetry(absolutejs, config, process.cwd());
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

/* Dev-only error renderer for routes that throw "Asset ... not
 * found in manifest." — the most common failure mode when a build
 * error left the dev server with a partially-populated manifest
 * (cold-start with a broken page; mid-session build failure that
 * caused the rebuild to bail). Without this, Elysia surfaces the
 * raw error string as a plain-text 500 plus a `Server error on
 * GET <url>: undefined` log; with it, the user gets the same
 * styled `ssrErrorPage` they already know from SSR-throw cases,
 * and the terminal log carries the actual missing-asset name
 * instead of `undefined`. The plugin returns `undefined` for any
 * other error so the default chain still runs. */
const createBuildErrorRecoveryPlugin = () =>
	new Elysia({ name: 'absolutejs-build-error-recovery' }).onError(
		{ as: 'global' },
		async ({ error }) => {
			const message =
				error instanceof Error ? error.message : String(error);
			const assetMatch = /^Asset "(.+)" not found in manifest\.$/.exec(
				message
			);
			if (!assetMatch) return undefined;
			const missingAsset = assetMatch[1] ?? '';
			const framework =
				/^(?:[A-Z][a-z]*)*?(Angular|Vue|Svelte|React|Html|Htmx|Ember)/
					.exec(missingAsset)?.[1]
					?.toLowerCase() ?? 'absolutejs';
			console.error(
				`[hmr] Build artifact "${missingAsset}" missing from manifest — ` +
					`the user likely has a build-time error. Save a fix to trigger ` +
					`a recovery rebuild.`
			);
			const { ssrErrorPage } = await import('../utils/ssrErrorPage');
			const html = ssrErrorPage(
				framework,
				new Error(
					`Build artifact "${missingAsset}" missing from manifest.\n\n` +
						'This usually means a build-time error in a source file. ' +
						'Check the dev-server terminal for the underlying error, ' +
						'fix the file, and save to trigger a recovery rebuild.'
				)
			);

			return new Response(html, {
				headers: { 'content-type': 'text/html; charset=utf-8' },
				status: 500
			});
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
	registerIconVersioning(buildDir);

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
	const { staticPlugin } = await import('@elysia/static');
	const staticFiles = await mountStaticPlugin(staticPlugin, {
		alwaysStatic: true,
		assets: buildDir,
		prefix: '',
		staticLimit: MAX_STATIC_ROUTE_COUNT
	});

	// `@elysia/static` skips dot-directories when walking `assets`, so the
	// content-hashed client hydration bundles emitted to
	// `<buildDir>/.absolutejs/generated/**` never get static routes and 404 in
	// production (only dev served them, via the HMR disk fallback). Serve that
	// one directory explicitly, with a path-traversal guard. The files are
	// hash-named, so they are safe to cache immutably.
	const generatedAssetsRoot = join(buildDir, '.absolutejs');
	const generatedAssetsPlugin = new Elysia({
		name: 'absolutejs-generated-assets'
	}).get('/.absolutejs/*', async ({ params, set }) => {
		const requestedPath = resolve(generatedAssetsRoot, params['*']);
		if (relative(generatedAssetsRoot, requestedPath).startsWith('..')) {
			set.status = 404;

			return 'Not Found';
		}

		const file = Bun.file(requestedPath);
		if (!(await file.exists())) {
			set.status = 404;

			return 'Not Found';
		}

		set.headers['cache-control'] = 'public, max-age=31536000, immutable';

		return file;
	});
	recordStep('create static plugin', stepStartedAt);

	// Cache policy for static assets. Content-hashed filenames (e.g.
	// `Page.a1b2c3d4.js`, `/chunk-xxxxxxxx.js`, and the `/.absolutejs/*` hydration
	// bundles) are safe to cache forever; their URL changes when the content
	// does. Stable-named-but-content-variable files (Tailwind's
	// `tailwind.generated.css`, vendor bundles like `vue.js`, user assets) must
	// revalidate, or a deploy's CSS/asset changes never reach returning visitors
	// (their URL never changes but `immutable` tells the browser never to check).
	// Without this, @elysiajs/static + the generated-assets handler apply one
	// blanket policy and stale non-hashed assets get pinned for up to a year.
	// A content-hashed filename always mixes letters AND digits in its hash
	// segment (e.g. `a1b2c3d4`); dictionary-word segments (`generated`, `vue`,
	// `iconfont`) never do, so they correctly fall through to revalidation.
	const isFingerprintedAsset = (pathname: string) => {
		if (pathname.startsWith('/.absolutejs/')) return true;
		const base = pathname.slice(pathname.lastIndexOf('/') + 1);
		const hash = base.match(/[.-]([0-9a-z]{6,12})\.[0-9a-z]+$/i)?.[1];

		return hash ? /[0-9]/.test(hash) && /[a-z]/i.test(hash) : false;
	};
	const assetCachePlugin = new Elysia({
		name: 'absolutejs-asset-cache'
	}).onAfterHandle({ as: 'global' }, ({ request, response }) => {
		if (!(response instanceof Response)) return;
		if (request.method !== 'GET' && request.method !== 'HEAD') return;
		const { pathname } = new URL(request.url);
		// Only touch real static files (have an extension) — never pages/APIs.
		if (pathname.endsWith('/') || !/\.[0-9a-z]+$/i.test(pathname)) return;
		// Replace (not append) whatever blanket policy @elysiajs/static set.
		response.headers.set(
			'cache-control',
			isFingerprintedAsset(pathname)
				? 'public, max-age=31536000, immutable'
				: 'public, max-age=0, must-revalidate'
		);
	});

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
			.use(assetCachePlugin)
			.use(imageOptimizer(config.images, buildDir))
			.use(prerenderPlugin)
			.use(staticFiles)
			.use(generatedAssetsPlugin)
			.use(createNotFoundPlugin());
		await withOpenApi(absolutejs, config, process.cwd(), false);
		await withTelemetry(absolutejs, config, process.cwd());
		recordStep('assemble production runtime', stepStartedAt);
		logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

		return { absolutejs, manifest };
	}

	stepStartedAt = performance.now();
	const { imageOptimizer } = await import('../plugins/imageOptimizer');
	const absolutejs = new Elysia({ name: 'absolutejs-runtime' })
		.use(assetCachePlugin)
		.use(imageOptimizer(config.images, buildDir))
		.use(staticFiles)
		.use(generatedAssetsPlugin)
		.use(createNotFoundPlugin());
	await withOpenApi(absolutejs, config, process.cwd(), false);
	await withTelemetry(absolutejs, config, process.cwd());
	recordStep('assemble production runtime', stepStartedAt);
	logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

	return { absolutejs, manifest };
};
