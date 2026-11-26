import { CLIENT_MODULE_PREFIX } from '../dev/clientModuleHmr';
import { setRenderTimeout } from './renderTimeout';
import { createHash } from 'node:crypto';
import {
	clientModuleManifestKey,
	resolveClientModules
} from '../build/clientModules';
import { runUntracked } from '../dev/hotResources';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { filenameToRoute } from './prerenderPaths';
import { join, relative, resolve as resolvePath, sep } from 'node:path';
import { encodeSrcPath } from '../dev/srcPath';
import { Elysia, ElysiaError, InternalServerError, NotFound } from 'elysia';
import type { staticPlugin } from '@elysia/static';
import type { BuildConfig, MobileConfig } from '../../types/build';
import type { ConventionsMap } from '../../types/conventions';
import type { RevalidationOutcome } from '../../types/revalidate';
import { HTTP_STATUS_INTERNAL_SERVER_ERROR } from '../constants';
import { withOpenApi } from '../plugins/openApiPlugin';
import { withTelemetry } from '../plugins/telemetryPlugin';
import { loadConfig } from '../utils/loadConfig';
import { publishTlsConfig } from '../runtime/productionTls';
import { readProductionRuntime } from './productionRuntime';
import { installAngularZoneRuntime } from '../angular/zoneRuntime';
import { setIconVersionResolver } from '../utils/iconVersion';
import { setCurrentIslandManifest } from './islandPageContext';
import { absoluteRequestContext } from './requestContext';
import { cacheTagEmitter, routesTagged } from './cacheTags';
import { revalidateEndpoint } from './revalidateEndpoint';
import {
	isRevalidateTokenMissing,
	REVALIDATE_TOKEN_ENV,
	revalidateTokenFor,
	staticDirectoryFor
} from './staticRuntimeOptions';
import {
	prerenderDirectoryProblem,
	usablePrerenderDirectory
} from './prerenderDirectory';
import { health, resolveHealthConfig } from '../plugins/health';
import { rateLimit } from '../plugins/rateLimit';
import { routingRules } from '../plugins/routingRules';
import { requestLog } from '../plugins/requestLog';
import { shutdown } from '../plugins/shutdown';
import { hasForeignErrorHook } from './appErrorHooks';
import { formActionRuntime } from './formActionFlash';
import { formActionMacro, type FormActionsPlugin } from './formActions';
import { loadIslandRegistry } from './loadIslandRegistry';
import { setCurrentIslandRegistry } from './currentIslandRegistry';
import {
	loadPageIslandMetadata,
	setCurrentPageIslandMetadata
} from '../islands/pageMetadata';
import {
	setConventions,
	isPageRequest,
	renderFirstNotFound,
	renderStaticRouteError
} from '../utils/resolveConvention';
import { setSpaRouteManifest } from '../utils/spaRouteManifest';
import { logStartupTimingBlock } from '../utils/startupTimings';
import { markBoot } from '../utils/bootTimeline';
import { logWarn } from '../utils/logger';
import { deferUntilServing, setBootPhase } from '../dev/bootLifecycle';
import { createLoadingIndicatorPlugin } from './loadingIndicator';
import {
	createAssetCachePlugin,
	createPrecompressedPlugin
} from './precompressed';
import { devServerBusy } from '../dev/devActivity';
import { dependencyOrderedSequence, runWhenIdle } from '../dev/idleScheduler';
import { productionStaticIgnorePatterns } from './serverOnlyStaticFiles';
import { getCspNonce } from './cspNonce';
import { servePrerenderedPage } from './prerenderNonce';
import { activeSecurityHeadersFor } from '../plugins/secureHeaders';

const MS_PER_SECOND = 1000;
const DEFAULT_PORT = 3000;
const MAX_STATIC_ROUTE_COUNT = Number.MAX_SAFE_INTEGER;
const STATIC_PLUGIN_RETRY_DELAY_MS = 50;
const waitForStaticPluginRetry = () =>
	new Promise((resolve) => {
		setTimeout(resolve, STATIC_PLUGIN_RETRY_DELAY_MS);
	});

const retryStaticPlugin = async (
	createStaticPlugin: typeof staticPlugin,
	options: Parameters<typeof staticPlugin>[0]
) => {
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
};

/* A generated asset's directory name can contain an encoded separator (Vue
 * builds before beta.173 mirrored sources under a directory literally named
 * `%2F`; build/vueModuleOutputPath.ts now uses project-relative paths).
 * Elysia's decoded `*` param turns `%2F` into a slash, which made such a
 * lazy route chunk 404. Decode each segment of the raw path, but keep a
 * segment that decodes to a separator in its encoded form, which is how it
 * was written. */
const generatedAssetRelativePath = (pathname: string) =>
	pathname
		.replace(/^\/\.absolutejs\/?/, '')
		.split('/')
		.map((segment) => {
			try {
				const decoded = decodeURIComponent(segment);

				return /[\\/]/.test(decoded)
					? encodeURIComponent(decoded)
					: decoded;
			} catch {
				return segment;
			}
		})
		.join('/');

// `@elysia/static` builds its routes by walking `assets` and reading each file
// up front (we pass `alwaysStatic: true`). In dev the build dir is live, so a
// content-hashed bundle can be mid-write — or just pruned — when the walk
// reaches it, and the read can throw. Retry once after a short delay (the
// rebuild settles within a tick), then degrade to an empty plugin so a
// transient miss never takes down the server with an unhandled rejection.
/* Whether a request path names a file in the build directory — the
 * files the static plugin below answers. Resolved and checked against
 * the directory, so `/../server.js` is not mistaken for one. */
const servedFromBuildDirectory = (buildDir: string) => {
	const root = resolvePath(buildDir);

	return (pathname: string) => {
		const target = resolvePath(root, `.${safeDecodePath(pathname)}`);

		return target.startsWith(`${root}${sep}`) && existsSync(target);
	};
};

const safeDecodePath = (pathname: string) => {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
};

const mountStaticPlugin = async (
	createStaticPlugin: typeof staticPlugin,
	options: Parameters<typeof staticPlugin>[0]
) => {
	try {
		return await createStaticPlugin(options);
	} catch {
		await waitForStaticPluginRetry();

		return retryStaticPlugin(createStaticPlugin, options);
	}
};

const MOBILE_DEV_MODULE_HEADERS: HeadersInit = {
	'Cache-Control': 'no-store',
	'Content-Type': 'text/javascript; charset=utf-8'
};
const NATIVE_DEVICE_ADAPTER_PATH = '/__absolute/native-device-adapter.js';
const MOBILE_PREVIEW_CLIENT_PATH = '/__absolute/mobile-preview-client.js';

/** Every mobile development route hangs off `config.mobile`. Without it the
 *  runtime mounts an empty plugin and never evaluates a mobile module, so a
 *  web-only project pays nothing for the association files, the preview
 *  shell, or the browser modules the HMR client fetches on native targets. */
const loadMobileDevPlugin = async (mobile: MobileConfig | undefined) => {
	if (!mobile) return new Elysia({ name: 'absolutejs-mobile-disabled' });
	const [
		{ createAbsoluteMobileAssociationPlugin },
		{ createAbsoluteMobilePreviewPlugin }
	] = await Promise.all([
		import('../mobile/associationFiles'),
		import('../mobile/mobilePreview')
	]);
	let nativeDevAdapterBundle: Promise<string> | undefined;
	const getNativeDevAdapterBundle = () =>
		(nativeDevAdapterBundle ??= import('../mobile/devDeviceAdapter').then(
			({ buildAbsoluteNativeDevAdapter }) =>
				buildAbsoluteNativeDevAdapter(process.cwd(), mobile)
		));
	const getMobilePreviewClientBundle = () =>
		import('../mobile/mobilePreviewClientBundle').then(
			({ getAbsoluteMobilePreviewClientBundle }) =>
				getAbsoluteMobilePreviewClientBundle()
		);

	return new Elysia({ name: 'absolutejs-mobile-dev' })
		.use(createAbsoluteMobileAssociationPlugin(mobile, process.cwd()))
		.use(createAbsoluteMobilePreviewPlugin(mobile))
		.get(
			NATIVE_DEVICE_ADAPTER_PATH,
			async () =>
				new Response(await getNativeDevAdapterBundle(), {
					headers: MOBILE_DEV_MODULE_HEADERS
				})
		)
		.get(
			MOBILE_PREVIEW_CLIENT_PATH,
			async () =>
				new Response(await getMobilePreviewClientBundle(), {
					headers: MOBILE_DEV_MODULE_HEADERS
				})
		);
};

const loadMobileAssociationPlugin = async (
	mobile: MobileConfig | undefined
) => {
	if (!mobile) {
		return new Elysia({ name: 'absolutejs-mobile-associations-disabled' });
	}
	const { createAbsoluteMobileAssociationPlugin } =
		await import('../mobile/associationFiles');

	return createAbsoluteMobileAssociationPlugin(mobile, process.cwd(), {
		requireAll: true
	});
};

const loadMobileUpdatePlugin = async (
	mobile: MobileConfig | undefined,
	production: boolean
) => {
	if (!mobile?.updates)
		return new Elysia({ name: 'absolutejs-mobile-updates-unconfigured' });
	const [
		{ normalizeAbsoluteMobileConfig },
		{ createAbsoluteMobileUpdateServerPlugin }
	] = await Promise.all([
		import('../mobile/config'),
		import('../mobile/updateServer')
	]);
	const normalized = normalizeAbsoluteMobileConfig(mobile, process.cwd());

	return createAbsoluteMobileUpdateServerPlugin(normalized, process.cwd(), {
		production
	});
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
			...glob.scanSync({ absolute: true, cwd: resolvePath(dir) })
		];
		files.push(...matches);
	}

	return files;
};

/** A page build must never be interrupted by warm-up work, so the pause
 *  budget is generous: the prewarm is pure optimisation and can wait out
 *  any burst of real traffic. */
const PREWARM_MAX_PAUSE_MS = 60_000;

/** One warm-up task per source file: transpile it into the module
 *  server's transform cache under its `/@src/` URL. */
const toWarmTasks = function* (
	files: Iterable<string>,
	warmCache: (url: string) => Promise<void> | void,
	srcUrlPrefix: string
) {
	for (const file of files) {
		const rel = relative(process.cwd(), file).replace(/\\/g, '/');
		yield () => warmCache(`${srcUrlPrefix}${rel}`);
	}
};

/** Source files of the pages that have already been built, so their
 *  module graph is warmed before anything else. */
const builtPageSources = () => {
	const lazy = globalThis.__hmrDevResult?.hmrState.lazyPages;
	if (!lazy) return [];

	return [...lazy.warmed];
};

/** Warm the transform cache for every framework source file — but only
 *  while the server is idle, in small batches, starting with the modules
 *  the pages built so far import. `ABSOLUTE_DEV_PREWARM=0` skips it. */
const warmPrewarmDirs = async (
	prewarmDirs: PrewarmEntry[],
	warmCache: (url: string) => Promise<void> | void,
	SRC_URL_PREFIX: string
) => {
	if (process.env.ABSOLUTE_DEV_PREWARM === '0') return 0;
	const files = (await collectPrewarmFiles(prewarmDirs)).filter(
		(file) => !file.includes('/node_modules/')
	);
	const ordered = dependencyOrderedSequence(
		files,
		builtPageSources,
		() =>
			globalThis.__hmrDevResult?.hmrState.dependencyGraph.dependencies ??
			new Map()
	);
	const tasks = toWarmTasks(ordered, warmCache, SRC_URL_PREFIX);

	return runWhenIdle(tasks, {
		isBusy: devServerBusy,
		maxPauseMs: PREWARM_MAX_PAUSE_MS
	}).done;
};

const resolveDevIndexFileName = (manifestValue: string, baseName: string) => {
	if (manifestValue.includes('/react/')) return `${baseName}.tsx`;
	if (manifestValue.includes('/svelte/')) return `${baseName}.svelte.js`;
	if (manifestValue.includes('/vue/')) return `${baseName}.vue.js`;

	return null;
};

export const patchManifestIndexes = (
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

		const srcPath = resolvePath(devIndexDir, fileName);
		if (!existsSync(srcPath)) continue;

		manifest[key] =
			`${SRC_URL_PREFIX}${encodeSrcPath(relative(process.cwd(), srcPath))}`;
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
): Promise<PrepareResult> => {
	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	let stepStartedAt = performance.now();
	setBootPhase('patch route registration');
	const { patchElysiaRouteRegistrationCallsites } =
		await import('./devRouteRegistrationCallsite');
	patchElysiaRouteRegistrationCallsites();
	recordStep('patch route registration', stepStartedAt);

	stepStartedAt = performance.now();
	setBootPhase('build');
	const { devBuild } = await import('./devBuild');
	const result = await devBuild(config);
	recordStep('devBuild', stepStartedAt);
	markBoot('devBuild done');

	stepStartedAt = performance.now();
	setBootPhase('load dev runtime');
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
	const { createStyleTransformConfig } =
		await import('../build/stylePreprocessor');
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
			config.postcss,
			{ autoprefixer: config.autoprefixer, browsers: config.browsers }
		),
		vendorPaths: allVendorPaths
	});
	setGlobalModuleServer(moduleHandler);
	recordStep('create module server', stepStartedAt);

	// Pre-compile all framework source files into the transform cache
	// so the first HMR edit hits a warm cache and the runtime import
	// graph is populated (needed for findNearestComponent). This is
	// warm-up, not a prerequisite for serving: the module server
	// transforms on demand, so it runs AFTER the port is serving real
	// traffic (see `deferUntilServing`) instead of holding up boot.
	const { warmCache, SRC_URL_PREFIX } = await import('../dev/moduleServer');
	const prewarmDirs = buildPrewarmDirs(config);
	stepStartedAt = performance.now();
	deferUntilServing(async () => {
		const prewarmStartedAt = performance.now();
		const warmed = await warmPrewarmDirs(
			prewarmDirs,
			warmCache,
			SRC_URL_PREFIX
		);
		logStartupTimingBlock('AbsoluteJS deferred boot timing', [
			{
				durationMs: performance.now() - prewarmStartedAt,
				label: `prewarm ${warmed} source modules (idle, after listen)`
			}
		]);
	});
	recordStep('schedule source module prewarm', stepStartedAt);

	stepStartedAt = performance.now();
	setBootPhase('configure dev plugins');
	const hmrPlugin = hmr(result.hmrState, result.manifest, moduleHandler);
	const { devtoolsJson } = await import('../plugins/devtoolsJson');

	// Override index manifest entries to /@src/ URLs so the initial
	// page load uses the module server (same module system as HMR).
	// This ensures page refreshes after HMR load fresh code.
	const devIndexDir = resolvePath(buildDir, '_src_indexes');
	patchManifestIndexes(result.manifest, devIndexDir, SRC_URL_PREFIX);
	// Client modules load from source too, so an edit reaches whatever page
	// imports one (build/clientModules.ts).
	for (const { name, source } of resolveClientModules(
		config.clientModules,
		process.cwd()
	))
		result.manifest[clientModuleManifestKey(name)] =
			`${CLIENT_MODULE_PREFIX}${encodeSrcPath(relative(process.cwd(), source))}`;
	recordStep('configure dev plugins', stepStartedAt);

	// Load convention files (error/loading/not-found) into the runtime registry
	stepStartedAt = performance.now();
	setBootPhase('load runtime metadata');
	if (result.conventions) setConventions(result.conventions);
	/* Set from the config on every boot, dev and production alike: a
	 * render budget that applied in one and not the other would be worse
	 * than none, since the case it exists for only happens in production. */
	setRenderTimeout(config.rendering?.timeout);
	setCurrentIslandManifest(result.manifest, buildDir);
	if (config.islands?.registry) {
		setCurrentIslandRegistry(
			await loadIslandRegistry(config.islands.registry)
		);
	}
	setCurrentPageIslandMetadata(await loadPageIslandMetadata(config));
	recordStep('load runtime metadata', stepStartedAt);

	stepStartedAt = performance.now();
	setBootPhase('assemble dev runtime');
	const { imageOptimizer } = await import('../plugins/imageOptimizer');
	const { requestInspector } = await import('../dev/requestInspector');
	const { serverTiming } = await import('@elysia/server-timing');
	const mobileDevPlugin = await loadMobileDevPlugin(config.mobile);
	const mobileUpdatePlugin = await loadMobileUpdatePlugin(
		config.mobile,
		false
	);
	// Typed with the `form` route option (formActions.ts), and nothing
	// else: see PrepareResult.
	const absolutejs: FormActionsPlugin = new Elysia({
		name: 'absolutejs-runtime'
	}).use(formActionMacro());
	absolutejs
		// Must be first: the inspector's global request/afterResponse hooks
		// only reach routes compiled after them, so it has to precede the
		// page/static/user routes (which mount after `.use(absolutejs)`).
		.use(requestInspector)
		.use(absoluteRequestContext)
		.use(cacheTagEmitter())
		.use(requestLog(config.logging))
		.use(
			rateLimit({
				config: config.rateLimit,
				exemptPaths: healthPaths(config),
				vitalsPath: await resolveVitalsPath(config, true),
				vitalsSummaryPath: await resolveVitalsSummaryPath(config, true)
			})
		)
		// After the rate limit, so a redirect is not a way around it;
		// before every route, so a rule can answer for a path none serves.
		.use(
			routingRules(config, {
				isFrameworkFile: servedFromBuildDirectory(buildDir)
			})
		)
		.use(health(config.health))
		// Renders and clears form-action results (formActionFlash.ts).
		.use(formActionRuntime())
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
		.use(mobileDevPlugin)
		.use(mobileUpdatePlugin)
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
		.use(await loadVitalsPlugin(config, true))
		.use(createLoadingIndicatorPlugin())
		.use(createStaticErrorPlugin(() => absolutejs))
		.use(createNotFoundPlugin());
	await withOpenApi(absolutejs, config, process.cwd(), true);
	await withTelemetry(absolutejs, config, process.cwd());
	recordStep('assemble dev runtime', stepStartedAt);
	markBoot('dev plugins assembled');
	setBootPhase('starting server');
	logStartupTimingBlock('AbsoluteJS prepareDev timing', startupSteps);

	return {
		absolutejs,
		manifest: result.manifest
	};
};

/** Load pre-rendered HTML files from disk into a route → filepath map */
/* Recursive, because a pre-rendered route is a path now
 * (`docs/guide.html`), not a flattened name. Reading only the top level
 * would silently drop every nested route from the map — which is what the
 * flattened layout did by another route. */
const prerenderedFiles = (directory: string, prefix = ''): string[] => {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		/* unreadable directory: nothing to serve from it */
		return [];
	}

	return entries.flatMap((entry) => {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory())
			return prerenderedFiles(join(directory, entry.name), relativePath);

		return entry.name.endsWith('.html') ? [relativePath] : [];
	});
};

/* A re-render that cannot write used to fail without a word: the call
 * resolved `false`, the interval's background render was swallowed, and
 * the page stayed as the build left it. Said once, at startup, to an app
 * that has asked for its pages to change — one that only pre-renders at
 * build time never writes here and is told nothing. */
const warnIfPagesCannotBeUpdated = (
	prerenderDir: string,
	staticConfig: BuildConfig['static']
) => {
	if (staticConfig === undefined) return;
	const problem = prerenderDirectoryProblem(prerenderDir);
	if (problem === undefined) return;
	logWarn(
		`Pre-rendered pages cannot be updated: ${prerenderDir} is not writable (${problem}). revalidatePath, revalidateTag and static.revalidate will leave every page as it is. Set static.directory to a writable path.`
	);
};

const loadPrerenderMap = (prerenderDir: string) => {
	const map = new Map<string, string>();
	if (!existsSync(prerenderDir)) return map;
	for (const relativePath of prerenderedFiles(prerenderDir)) {
		map.set(
			filenameToRoute(relativePath),
			join(prerenderDir, relativePath)
		);
	}

	return map;
};

const loadMobileCompatibilityPlugin = async (buildDir: string) => {
	const root = join(buildDir, '.absolutejs', 'mobile-compatibility');
	if (!existsSync(join(root, 'current.json'))) {
		return new Elysia({ name: 'absolutejs-mobile-compatibility-empty' });
	}
	const [
		{ loadAbsoluteMobileMaterializedBundle },
		{ createAbsoluteMobileCompatibilityDispatcher }
	] = await Promise.all([
		import('../mobile/materializedBundle'),
		import('../mobile/compatibilityDispatcher')
	]);
	const options = await loadAbsoluteMobileMaterializedBundle(root);

	return createAbsoluteMobileCompatibilityDispatcher(options);
};

/* The health endpoints' paths, which a global rate limit must not cover:
 * refusing a readiness probe is how a burst of probes becomes an outage. */
const healthPaths = (config: BuildConfig) => {
	if (config.health === false) return [];
	const { liveness, readiness } = resolveHealthConfig(config.health);

	return [liveness, readiness];
};

/* The vitals endpoint's path when this app serves one, so the rate
 * limiter can protect it by default. Mirrors `loadVitalsPlugin`'s own
 * enablement test: off, disabled for this mode, or posting to another
 * origin all mean there is nothing here to limit. */
const resolveVitalsPath = async (config: BuildConfig, isDev: boolean) => {
	const { isVitalsEnabled, resolveVitalsConfig } =
		await import('../build/vitals');
	if (!config.vitals || !isVitalsEnabled(config.vitals, isDev))
		return undefined;
	const { endpoint } = resolveVitalsConfig(config.vitals);

	return endpoint.startsWith('/') ? endpoint : undefined;
};

/* The summary endpoint's path when this app serves one. Nothing when the
 * batches post to another origin: the aggregation is of what arrives here,
 * so a summary alongside a remote endpoint would be permanently empty, and
 * an empty report reads as "the site is fast" rather than "nothing is being
 * measured here". */
const resolveVitalsSummaryPath = async (
	config: BuildConfig,
	isDev: boolean
) => {
	const path = await resolveVitalsPath(config, isDev);
	if (path === undefined || !config.vitals) return undefined;
	const { resolveVitalsSummary } = await import('../build/vitals');

	return resolveVitalsSummary(config.vitals, isDev)?.path;
};

/* The built-in web vitals endpoint, when `vitals` is on for this mode and
 * its endpoint is a path on this server (see src/build/vitals.ts). */
const loadVitalsPlugin = async (config: BuildConfig, isDev: boolean) => {
	const [
		{ isVitalsEnabled, resolveVitalsConfig, resolveVitalsSummary },
		{ createVitalsPlugin }
	] = await Promise.all([import('../build/vitals'), import('./vitals')]);
	if (!config.vitals || !isVitalsEnabled(config.vitals, isDev))
		return new Elysia({ name: 'absolutejs-vitals-disabled' });
	const { endpoint } = resolveVitalsConfig(config.vitals);
	if (!endpoint.startsWith('/'))
		return new Elysia({ name: 'absolutejs-vitals-remote' });

	return createVitalsPlugin({
		path: endpoint,
		summary: resolveVitalsSummary(config.vitals, isDev)
	});
};

const createNotFoundPlugin = () =>
	new Elysia({ name: 'absolutejs-not-found' }).onError(
		'global',
		NotFound,
		async ({ request }) => {
			/* The conventions are HTML pages: only navigations and HTMX
			 * requests get them, as with error.html. A client asking for
			 * JSON (or anything else) keeps Elysia's JSON 404. */
			if (!isPageRequest(request)) return undefined;
			const response = await renderFirstNotFound({
				preferHtmx: request.headers.get('hx-request') === 'true'
			});
			if (response) return response;

			return undefined;
		}
	);

/* A route handler that throws (before or around handleHTMLPageRequest /
 * handleHTMXPageRequest, which render their own errors) would otherwise get
 * Elysia's JSON 500. Log it, whatever the request, and for page navigations
 * and HTMX requests render the HTML/HTMX error.html instead
 * (renderStaticRouteError). Only unexpected
 * throws qualify: Elysia's own errors (not found, validation, parse) and
 * thrown `status(...)` responses keep their status and handlers. Returns
 * undefined otherwise so later onError handlers still run. */
const isUnexpectedRouteError = (
	error: unknown,
	statusCode: unknown
): error is Error => {
	if (!(error instanceof Error)) return false;
	if (error instanceof ElysiaError && !(error instanceof InternalServerError))
		return false;

	return (
		statusCode === undefined ||
		statusCode === HTTP_STATUS_INTERNAL_SERVER_ERROR
	);
};

/* A fallback only: when the app registers its own onError (anywhere, before
 * or after `.use(absolutejs)`), this hook does nothing and the app's handler
 * decides, as it did before error.html covered thrown routes. `owner` is the
 * AbsoluteJS runtime plugin, whose own hooks (not-found, telemetry, …) don't
 * count. The app is read when an error happens, so in dev a handler added by
 * a backend HMR edit takes effect without a restart. */
const createStaticErrorPlugin = (owner: () => unknown) => {
	let startedApp: unknown;
	/* Elysia can run global onError more than once for one failure (an error
	 * rethrown from a later lifecycle hook); log each error object once. */
	const loggedErrors = new WeakSet<Error>();

	return new Elysia({ name: 'absolutejs-static-error' })
		.onStart((app) => {
			startedApp = app;
		})
		.onError('global', async ({ error, request, set }) => {
			if (!isUnexpectedRouteError(error, set.status)) return undefined;
			const app = globalThis.__absoluteLiveApp ?? startedApp;
			if (hasForeignErrorHook(app, owner())) return undefined;
			/* With no app onError nothing else reports the throw, so log it
			 * (server-side only, with its stack) for every request, not just
			 * page and HTMX ones: a fetch or curl client (any Accept, JSON
			 * included) still gets Elysia's generic JSON 500, and without
			 * this line the failure left no trace. Framework page
			 * handlers catch and log their own render errors and return a
			 * response, so those never reach here and aren't logged twice. */
			if (!loggedErrors.has(error)) {
				loggedErrors.add(error);
				console.error(
					`[SSR] ${request.method} ${new URL(request.url).pathname} threw:`,
					error
				);
			}

			return (await renderStaticRouteError(request, error)) ?? undefined;
		});
};

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
		'global',
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
			const { buildErrorPage } = await import('../utils/ssrErrorPage');
			const { getDevPageWarmer } = await import('./requestContext');
			const html = buildErrorPage(
				framework,
				missingAsset,
				getDevPageWarmer()?.lastError?.()
			);

			return new Response(html, {
				headers: { 'content-type': 'text/html; charset=utf-8' },
				status: 500
			});
		}
	);

const runPrepare = async (configOrPath?: string): Promise<PrepareResult> => {
	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	let stepStartedAt = performance.now();
	const nodeEnv = process.env['NODE_ENV'];
	const isDev = nodeEnv === 'development';
	// A production build carries the config it was built with
	// (productionRuntime.ts), so the server never imports absolute.config.ts
	// and everything it pulls in a second time beside its own bundle.
	const builtDir = process.env.ABSOLUTE_BUILD_DIR;
	const built =
		!isDev && builtDir
			? readProductionRuntime(resolvePath(builtDir))
			: null;
	const config = built ?? (await loadConfig(configOrPath));
	recordStep(built ? 'load built config' : 'load config', stepStartedAt);
	// The base path the browser reaches the app under: the environment's,
	// else the config's (read everywhere through getBasePath()).
	if (process.env.ABSOLUTE_BASE_PATH === undefined && config.basePath)
		process.env.ABSOLUTE_BASE_PATH = config.basePath;
	if (
		process.env.ABSOLUTE_BASE_PATH_SHARED === undefined &&
		config.basePathShared
	)
		process.env.ABSOLUTE_BASE_PATH_SHARED = config.basePathShared.join(',');
	// Read through isProxyTrusted() by everything that needs the browser's
	// own host or address; the environment's wins.
	if (process.env.ABSOLUTE_TRUST_PROXY === undefined && config.trustProxy)
		process.env.ABSOLUTE_TRUST_PROXY = '1';
	// `networking()` reads TLS from the environment, and it runs after this.
	if (!isDev) publishTlsConfig(config.tls);
	// Angular zone.js mode must patch the process before the app listens.
	if (config.angular?.changeDetection === 'zone')
		await installAngularZoneRuntime();

	const buildDir = resolvePath(
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
	setCurrentIslandManifest(manifest, buildDir);
	if (config.islands?.registry) {
		setCurrentIslandRegistry(
			await loadIslandRegistry(config.islands.registry)
		);
	}
	// Page island metadata maps island sources to the pages that use them,
	// for dev rebuilds only (rebuildTrigger.ts); production never reads it,
	// and building it scanned and read every page source at each boot.
	recordStep('load production manifest and island registry', stepStartedAt);

	// Load convention files (error/loading/not-found) for production
	stepStartedAt = performance.now();
	const conventionsPath = join(buildDir, 'conventions.json');
	if (existsSync(conventionsPath)) {
		const conventions: ConventionsMap = JSON.parse(
			readFileSync(conventionsPath, 'utf-8')
		);
		setConventions(conventions);
	}
	const spaRoutesPath = join(buildDir, 'spa-routes.json');
	if (existsSync(spaRoutesPath)) {
		setSpaRouteManifest(JSON.parse(readFileSync(spaRoutesPath, 'utf-8')));
	}
	recordStep('load production conventions', stepStartedAt);

	stepStartedAt = performance.now();
	const { staticPlugin } = await import('@elysia/static');
	const ignorePatterns = productionStaticIgnorePatterns(buildDir, Bun.main);
	const staticFiles = await mountStaticPlugin(staticPlugin, {
		alwaysStatic: true,
		assets: buildDir,
		ignorePatterns,
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
	}).get('/.absolutejs/*', async ({ request, set }) => {
		const requestedPath = resolvePath(
			generatedAssetsRoot,
			generatedAssetRelativePath(new URL(request.url).pathname)
		);
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
	// Cache policy for static assets. A path the build hashed — every value
	// in `manifest.json`, plus the `/.absolutejs/*` hydration bundles and the
	// bundler's own `chunk-<hash>.js` — is safe to cache forever, because its
	// URL changes when its content does. Everything else revalidates,
	// including a user asset whose name merely looks hashed: this used to be
	// guessed from the name, which pinned `icon-512x512.png` for a year.
	const hashedAssetPaths = new Set(
		Object.values(manifest).filter((value) => typeof value === 'string')
	);
	// Both static paths get the same set, or the policy depends on whether
	// the client accepted an encoding.
	const precompressedFiles = await createPrecompressedPlugin(
		buildDir,
		ignorePatterns,
		hashedAssetPaths
	);
	recordStep('create static plugin', stepStartedAt);

	const assetCachePlugin = createAssetCachePlugin(hashedAssetPaths);

	// Check for pre-rendered pages (from SSG or compile)
	stepStartedAt = performance.now();
	// The build's own `_prerendered/`, or this build's folder under
	// `static.directory` (prerenderDirectory.ts).
	const prerenderDir = usablePrerenderDirectory(
		buildDir,
		staticDirectoryFor(config.static),
		logWarn
	);
	const prerenderMap = loadPrerenderMap(prerenderDir);
	const mobileCompatibilityPlugin =
		await loadMobileCompatibilityPlugin(buildDir);
	const mobileAssociationPlugin = await loadMobileAssociationPlugin(
		config.mobile
	);
	const mobileUpdatePlugin = await loadMobileUpdatePlugin(
		config.mobile,
		true
	);
	recordStep('load prerender map', stepStartedAt);

	/* Also for an app that pre-rendered nothing but is configured to: a
	 * blog built before its first post has no pages yet, and the first
	 * one `revalidatePath` creates needs somewhere to be served from. */
	if (prerenderMap.size > 0 || config.static !== undefined) {
		warnIfPagesCannotBeUpdated(prerenderDir, config.static);
		if (isRevalidateTokenMissing(config.static))
			logWarn(
				`static.revalidateToken was set when this app was built, but a token is never stored in build output. Set ${REVALIDATE_TOKEN_ENV} to enable /__absolute/revalidate.`
			);
		const {
			PRERENDER_BYPASS_HEADER,
			PRERENDER_BYPASS_TOKEN,
			readTimestamp,
			removePrerendered,
			rerenderRoute,
			routeToFilename,
			shouldSkipPrerendered
		} = await import('./prerender');

		const revalidateMs = config.static?.revalidate
			? config.static.revalidate * MS_PER_SECOND
			: 0;
		const port = Number(process.env.PORT) || DEFAULT_PORT;

		// One render per route at a time, shared by the interval below
		// and by `revalidatePath` (revalidate.ts).
		const {
			createRevalidationQueue,
			createStaticRouteMatcher,
			registerRevalidator
		} = await import('./revalidate');
		/* The map of pre-rendered routes is no longer fixed at startup:
		 * a page a re-render produced is added to it, and one that is
		 * no longer a page is taken out — before its file is deleted,
		 * so no request is handed a file that has gone. */
		const canCreate = createStaticRouteMatcher(config.static?.routes);
		const { createPrerenderLookup } = await import('./prerenderLookup');
		const prerendered = createPrerenderLookup({
			canCreate,
			prerenderDir,
			routes: prerenderMap
		});
		const bringUpToDate = async (route: string) => {
			const rendered = await rerenderRoute(route, port, prerenderDir);
			const failed: RevalidationOutcome = 'failed';
			const removed: RevalidationOutcome = 'removed';
			const replaced: RevalidationOutcome = 'replaced';
			if (rendered === 'failed') return failed;
			if (rendered === 'replaced') {
				prerenderMap.set(
					route,
					join(prerenderDir, routeToFilename(route))
				);

				return replaced;
			}
			// Nothing was cached and nothing is: not a change. Asked
			// of the disk as well as the list, so a page another
			// worker created can be taken down from this one.
			if (!prerendered.has(route)) return failed;
			prerenderMap.delete(route);
			removePrerendered(prerenderDir, route);

			return removed;
		};
		const failedOutcome: RevalidationOutcome = 'failed';
		const revalidation = createRevalidationQueue(
			bringUpToDate,
			failedOutcome
		);
		registerRevalidator({
			canCreate,
			revalidate: revalidation.revalidate,
			routes: () => [...prerenderMap.keys()],
			routesTagged: (tags) => routesTagged(prerenderDir, tags)
		});
		// Partial prerendering renders a shell's dynamic holes through the
		// app itself (partialPrerenderServe.ts), captured once it starts.
		const { readPartialHoles } = await import('./partialPrerender');
		const { servePartialPrerender } =
			await import('./partialPrerenderServe');
		let appHandle: ((request: Request) => Promise<Response>) | undefined;

		const prerenderPlugin = new Elysia({
			name: 'prerendered-pages'
		}).onRequest(({ request, set }) => {
			const url = new URL(request.url);

			// The server's own re-render and hole requests, and a form
			// posted without JavaScript whose result rides in a cookie the
			// cached file predates (prerender.ts).
			if (shouldSkipPrerendered(request)) return undefined;

			// Checked against the disk: another worker may have taken
			// this page down, or put one here (prerenderLookup.ts).
			const filePath = prerendered.fileFor(url.pathname);
			if (!filePath) return undefined;

			// ISR: check if page is stale and trigger background re-render
			const renderedAt =
				revalidateMs > 0 && !revalidation.isBusy(url.pathname)
					? readTimestamp(filePath)
					: 0;
			const age = Date.now() - renderedAt;
			// In the background: a failed re-render leaves the stale
			// page, which is what this request is served either way.
			if (revalidateMs > 0 && renderedAt > 0 && age > revalidateMs)
				void revalidation.revalidate(url.pathname);

			// Under secureHeaders(), swap the nonce the page was rendered
			// with for this request's (prerenderNonce.ts).
			const securityHeaders = activeSecurityHeadersFor(request);
			const nonce = securityHeaders ? getCspNonce(request) : undefined;

			// Partial prerendering: a shell with dynamic holes streams them
			// in per request. Without the app's handler (never started, as
			// in app.handle() tests) the route renders fully instead.
			const holes =
				request.method === 'GET' ? readPartialHoles(filePath) : [];
			if (holes.length > 0 && !appHandle) return undefined;
			if (holes.length > 0 && appHandle) {
				return servePartialPrerender({
					bypassHeader: PRERENDER_BYPASS_HEADER,
					bypassValue: PRERENDER_BYPASS_TOKEN,
					filePath,
					handle: appHandle,
					holes,
					nonce,
					request,
					securityHeaders: securityHeaders ?? undefined
				}).then(({ dropHeaders, response }) => {
					for (const name of dropHeaders) delete set.headers[name];

					return response;
				});
			}

			if (securityHeaders && nonce) {
				return servePrerenderedPage(
					filePath,
					nonce,
					securityHeaders
				).then(({ dropHeaders, response }) => {
					for (const name of dropHeaders) delete set.headers[name];

					return response;
				});
			}

			// Serve the cached page immediately (even if stale)
			return new Response(Bun.file(filePath), {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			});
		});
		prerenderPlugin.onStart((app) => {
			appHandle = (request) => app.handle(request);
		});

		stepStartedAt = performance.now();
		const { imageOptimizer } = await import('../plugins/imageOptimizer');
		// Typed with the `form` route option (formActions.ts), and nothing
		// else: see PrepareResult.
		const absolutejs: FormActionsPlugin = new Elysia({
			name: 'absolutejs-runtime'
		}).use(formActionMacro());
		absolutejs
			.use(absoluteRequestContext)
			.use(cacheTagEmitter())
			.use(requestLog(config.logging))
			.use(
				rateLimit({
					config: config.rateLimit,
					exemptPaths: healthPaths(config),
					vitalsPath: await resolveVitalsPath(config, false),
					vitalsSummaryPath: await resolveVitalsSummaryPath(
						config,
						false
					)
				})
			)
			// After the rate limit, so a redirect is not a way around it;
			// before every route, so a rule can answer for a path none serves.
			.use(
				routingRules(config, {
					isFrameworkFile: servedFromBuildDirectory(buildDir)
				})
			)
			.use(health(config.health))
			// Renders and clears form-action results (formActionFlash.ts).
			.use(formActionRuntime())
			.use(mobileAssociationPlugin)
			.use(mobileCompatibilityPlugin)
			.use(mobileUpdatePlugin)
			.use(assetCachePlugin)
			.use(imageOptimizer(config.images, buildDir))
			// Before the pre-rendered pages, behind the rate limiter.
			.use(revalidateEndpoint(revalidateTokenFor(config.static)))
			.use(prerenderPlugin)
			.use(precompressedFiles)
			.use(staticFiles)
			.use(generatedAssetsPlugin)
			.use(await loadVitalsPlugin(config, false))
			.use(createLoadingIndicatorPlugin())
			.use(shutdown(config.shutdown))
			.use(createStaticErrorPlugin(() => absolutejs))
			.use(createNotFoundPlugin());
		await withOpenApi(absolutejs, config, process.cwd(), false);
		await withTelemetry(absolutejs, config, process.cwd());
		recordStep('assemble production runtime', stepStartedAt);
		logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

		return { absolutejs, manifest };
	}

	stepStartedAt = performance.now();
	const { imageOptimizer } = await import('../plugins/imageOptimizer');
	// Typed with the `form` route option (formActions.ts), and nothing
	// else: see PrepareResult.
	const absolutejs: FormActionsPlugin = new Elysia({
		name: 'absolutejs-runtime'
	}).use(formActionMacro());
	absolutejs
		.use(absoluteRequestContext)
		.use(cacheTagEmitter())
		.use(requestLog(config.logging))
		.use(
			rateLimit({
				config: config.rateLimit,
				exemptPaths: healthPaths(config),
				vitalsPath: await resolveVitalsPath(config, isDev),
				vitalsSummaryPath: await resolveVitalsSummaryPath(config, isDev)
			})
		)
		// After the rate limit, so a redirect is not a way around it;
		// before every route, so a rule can answer for a path none serves.
		.use(
			routingRules(config, {
				isFrameworkFile: servedFromBuildDirectory(buildDir)
			})
		)
		.use(health(config.health))
		// Renders and clears form-action results (formActionFlash.ts).
		.use(formActionRuntime())
		.use(mobileAssociationPlugin)
		.use(mobileCompatibilityPlugin)
		.use(mobileUpdatePlugin)
		.use(assetCachePlugin)
		.use(imageOptimizer(config.images, buildDir))
		.use(precompressedFiles)
		.use(staticFiles)
		.use(generatedAssetsPlugin)
		.use(await loadVitalsPlugin(config, false))
		.use(createLoadingIndicatorPlugin())
		.use(shutdown(config.shutdown))
		.use(createStaticErrorPlugin(() => absolutejs))
		.use(createNotFoundPlugin());
	await withOpenApi(absolutejs, config, process.cwd(), false);
	await withTelemetry(absolutejs, config, process.cwd());
	recordStep('assemble production runtime', stepStartedAt);
	logStartupTimingBlock('AbsoluteJS prepare timing', startupSteps);

	return { absolutejs, manifest };
};

/** Stable framework infrastructure boundary. Internal development and production
 * routes must not become alternatives in every consumer's application route type.
 * User routes added after mounting this plugin retain their complete Elysia types. */
export type PrepareResult = {
	/** Also gives the app's routes the `form` option (form actions). */
	absolutejs: FormActionsPlugin;
	manifest: Record<string, string>;
};

const resolveConfigKey = (configOrPath?: string) =>
	resolvePath(
		configOrPath ?? process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
	);

/** Join an in-flight prebuild, or `undefined` when this `prepare()` has
 *  to do the work itself. A prebuild started against a different config
 *  is awaited (so two builds never run at once) and then discarded. */
const claimDevPrebuild = async (key: string) => {
	const pending = globalThis.__absoluteDevPrepare;
	if (!pending || pending.claimed) return undefined;
	pending.claimed = true;
	if (pending.key === key) {
		const prepared = await pending.promise;
		markBoot('prepare() joined prebuild');

		return prepared;
	}
	// `prepare()` was handed a different config than the one the dev
	// bootstrap prebuilt against. Let the prebuild settle, then drop its
	// cached result and build the requested config from scratch.
	await pending.promise.catch(() => undefined);
	globalThis.__hmrDevResult = undefined;
	logWarn(
		`prepare() was called with a different config than ${pending.key}; rebuilding.`
	);

	return undefined;
};

export const prepare = async (configOrPath?: string) => {
	markBoot('prepare() entered');
	const key = resolveConfigKey(configOrPath);
	const joined = await claimDevPrebuild(key);
	if (joined) return joined;
	// Publish this run so a prebuild that only gets its turn on the event
	// loop now (the user's entry finished importing first) joins it instead
	// of starting a second build.
	// Framework infrastructure (watchers, locks, signal handlers) belongs to
	// no top-level statement of the app, even when one calls prepare().
	const promise = runUntracked(() => runPrepare(configOrPath));
	globalThis.__absoluteDevPrepare = { claimed: true, key, promise };

	return promise;
};

/** Start the dev runtime's boot work (config load, build, plugin assembly)
 *  WITHOUT waiting for the user's server entry to finish importing.
 *
 *  On a large app the entry's own import graph is seconds of module
 *  evaluation before `prepare()` is even called, and the framework build is
 *  mostly I/O plus native `Bun.build` work — so the two overlap well. The
 *  dev bootstrap calls this right after the early listener binds; the
 *  user's later `prepare()` joins this promise instead of starting a second
 *  build. Dev only, and `ABSOLUTE_DEV_PREBUILD=0` opts out. */
export const startDevPrebuild = (configOrPath?: string) => {
	const existing = globalThis.__absoluteDevPrepare;
	if (existing) return existing.promise;
	const promise = runPrepare(configOrPath);
	globalThis.__absoluteDevPrepare = {
		claimed: false,
		key: resolveConfigKey(configOrPath),
		promise
	};

	return promise;
};
