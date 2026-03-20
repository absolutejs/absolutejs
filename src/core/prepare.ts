import { readFileSync } from 'node:fs';
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

		const hmrPlugin = hmr(result.hmrState, result.manifest, moduleHandler);

		// Override React index manifest entries to /@src/ URLs so the initial
		// page load uses the module server (same module system as HMR).
		// Only applies to React — Svelte/Vue indexes are .js (not .tsx)
		// and use their own bundled index files for initial load.
		const { SRC_URL_PREFIX } = await import('../dev/moduleServer');
		const devIndexDir = resolve(buildDir, '_src_indexes');
		for (const key of Object.keys(result.manifest)) {
			if (
				key.endsWith('Index') &&
				typeof result.manifest[key] === 'string' &&
				result.manifest[key].includes('/react/') &&
				result.manifest[key].includes('/indexes/')
			) {
				const fileName = `${key.replace(/Index$/, '')}.tsx`;
				const srcPath = resolve(devIndexDir, fileName);
				const rel = relative(process.cwd(), srcPath).replace(
					/\\/g,
					'/'
				);
				result.manifest[key] = `${SRC_URL_PREFIX}${rel}`;
			}
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
