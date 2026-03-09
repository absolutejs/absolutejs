import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
		const hmrPlugin = hmr(result.hmrState, result.manifest);

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
