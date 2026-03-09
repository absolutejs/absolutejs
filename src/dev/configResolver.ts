import { resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';

type ResolvedPaths = {
	buildDir: string;
	assetsDir?: string;
	reactDir?: string;
	svelteDir?: string;
	vueDir?: string;
	angularDir?: string;
	htmlDir?: string;
	htmxDir?: string;
	stylesDir?: string;
};

/** Normalize and default build paths so HMR works outside the example app. */
export const resolveBuildPaths = (config: BuildConfig) => {
	const cwd = process.cwd();
	// Normalize to forward slashes for cross-platform compatibility (Windows uses backslashes)
	const normalize = (path: string) => path.replace(/\\/g, '/');
	const withDefault = (value: string | undefined, fallback: string) =>
		normalize(resolve(cwd, value ?? fallback));
	const optional = (value: string | undefined) =>
		value ? normalize(resolve(cwd, value)) : undefined;

	return {
		angularDir: optional(config.angularDirectory),
		assetsDir: optional(config.assetsDirectory),
		buildDir: withDefault(config.buildDirectory, 'build'),
		htmlDir: optional(config.htmlDirectory),
		htmxDir: optional(config.htmxDirectory),
		reactDir: optional(config.reactDirectory),
		stylesDir: optional(
			typeof config.stylesConfig === 'string'
				? config.stylesConfig
				: config.stylesConfig?.path
		),
		svelteDir: optional(config.svelteDirectory),
		vueDir: optional(config.vueDirectory)
	};
};

export type ResolvedBuildPaths = ReturnType<typeof resolveBuildPaths>;
