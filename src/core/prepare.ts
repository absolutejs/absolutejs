import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadConfig } from '../utils/loadConfig';

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
	const { devBuild } = await import('./devBuild');
	const result = await devBuild(config);
	const { hmr } = await import('../plugins/hmr');
	const { staticPlugin } = await import('@elysiajs/static');
	const { createModuleServer } = await import('../dev/moduleServer');
	const {
		getDevVendorPaths,
		getAngularVendorPaths,
		getSvelteVendorPaths,
		getVueVendorPaths
	} = await import('./devVendorPaths');

	// Combine all vendor paths: React + Angular + Svelte + Vue + npm deps
	const depVendorPaths = globalThis.__depVendorPaths ?? {};
	const allVendorPaths: Record<string, string> = {
		...(getDevVendorPaths() ?? {}),
		...(getAngularVendorPaths() ?? {}),
		...(getSvelteVendorPaths() ?? {}),
		...(getVueVendorPaths() ?? {}),
		...depVendorPaths
	};

	const { setGlobalModuleServer } = await import('../dev/moduleServer');
	const moduleHandler = createModuleServer({
		frameworkDirs: { vue: config.vueDirectory },
		projectRoot: process.cwd(),
		vendorPaths: allVendorPaths
	});
	setGlobalModuleServer(moduleHandler);

	// Pre-compile all framework source files into the transform cache
	// so the first HMR edit hits a warm cache and the runtime import
	// graph is populated (needed for findNearestComponent).
	const { warmCache, SRC_URL_PREFIX } = await import('../dev/moduleServer');
	const prewarmDirs = buildPrewarmDirs(config);
	await warmPrewarmDirs(prewarmDirs, warmCache, SRC_URL_PREFIX);

	// Expose HMR state for the HTTP/2 bridge (networking.ts reads this
	// to attach WebSocket handling on the HTTP/2 server).
	// Only set when HTTPS is enabled — otherwise Elysia's native .ws() is used.
	if (config.dev?.https) {
		globalThis.__http2Config = {
			hmrState: result.hmrState,
			manifest: result.manifest
		};
	}

	const hmrPlugin = hmr(result.hmrState, result.manifest, moduleHandler);

	// Override index manifest entries to /@src/ URLs so the initial
	// page load uses the module server (same module system as HMR).
	// This ensures page refreshes after HMR load fresh code.
	const devIndexDir = resolve(buildDir, '_src_indexes');
	patchManifestIndexes(result.manifest, devIndexDir, SRC_URL_PREFIX);

	return {
		manifest: result.manifest,
		absolutejs: (app: import('elysia').Elysia) =>
			hmrPlugin(app.use(staticPlugin({ assets: buildDir, prefix: '' })))
	};
};

export const prepare = async (configOrPath?: string) => {
	const config = await loadConfig(configOrPath);

	const nodeEnv = process.env['NODE_ENV'];
	const isDev = nodeEnv === 'development';
	const buildDir = resolve(
		isDev
			? (config.buildDirectory ?? 'build')
			: (process.env.ABSOLUTE_BUILD_DIR ??
					config.buildDirectory ??
					'build')
	);

	if (isDev) return prepareDev(config, buildDir);

	const manifest: Record<string, string> = JSON.parse(
		readFileSync(`${buildDir}/manifest.json`, 'utf-8')
	);

	const { staticPlugin } = await import('@elysiajs/static');
	const absolutejs = staticPlugin({ assets: buildDir, prefix: '' });

	return { absolutejs, manifest };
};
