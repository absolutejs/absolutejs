import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadConfig } from '../utils/loadConfig';

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

	if (isDev) {
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
			frameworkDirs: {
				vue: config.vueDirectory
			},
			projectRoot: process.cwd(),
			vendorPaths: allVendorPaths
		});
		setGlobalModuleServer(moduleHandler);

		// Pre-compile all framework source files into the transform cache
		// so the first HMR edit hits a warm cache and the runtime import
		// graph is populated (needed for findNearestComponent).
		const { warmCache, SRC_URL_PREFIX } = await import(
			'../dev/moduleServer'
		);
		const { Glob } = await import('bun');
		const prewarmDirs: Array<{ dir: string; pattern: string }> = [];
		if (config.svelteDirectory) {
			prewarmDirs.push({
				dir: config.svelteDirectory,
				pattern: '**/*.{svelte,svelte.ts,svelte.js}'
			});
		}
		if (config.vueDirectory) {
			prewarmDirs.push({
				dir: config.vueDirectory,
				pattern: '**/*.{vue}'
			});
		}
		if (config.reactDirectory) {
			prewarmDirs.push({
				dir: config.reactDirectory,
				pattern: '**/*.{ts,tsx,js,jsx}'
			});
		}
		for (const { dir, pattern } of prewarmDirs) {
			const glob = new Glob(pattern);
			for (const file of glob.scanSync({
				absolute: true,
				cwd: resolve(dir)
			})) {
				if (file.includes('/node_modules/')) continue;
				const rel = relative(process.cwd(), file).replace(/\\/g, '/');
				warmCache(`${SRC_URL_PREFIX}${rel}`);
			}
		}

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
		for (const key of Object.keys(result.manifest)) {
			if (
				!key.endsWith('Index') ||
				typeof result.manifest[key] !== 'string' ||
				!result.manifest[key].includes('/indexes/')
			) {
				continue;
			}

			const baseName = key.replace(/Index$/, '');
			let fileName: string | null = null;

			if (result.manifest[key].includes('/react/')) {
				fileName = `${baseName}.tsx`;
			} else if (result.manifest[key].includes('/svelte/')) {
				fileName = `${baseName}.svelte.js`;
			} else if (result.manifest[key].includes('/vue/')) {
				fileName = `${baseName}.vue.js`;
			}

			if (!fileName) continue;

			const srcPath = resolve(devIndexDir, fileName);
			if (!existsSync(srcPath)) continue;

			const rel = relative(process.cwd(), srcPath).replace(/\\/g, '/');
			result.manifest[key] = `${SRC_URL_PREFIX}${rel}`;
		}

		return {
			manifest: result.manifest,
			absolutejs: (app: import('elysia').Elysia) =>
				hmrPlugin(
					app.use(staticPlugin({ assets: buildDir, prefix: '' }))
				)
		};
	}

	const manifest: Record<string, string> = JSON.parse(
		readFileSync(`${buildDir}/manifest.json`, 'utf-8')
	);

	const { staticPlugin } = await import('@elysiajs/static');
	const absolutejs = staticPlugin({ assets: buildDir, prefix: '' });

	return { absolutejs, manifest };
};
